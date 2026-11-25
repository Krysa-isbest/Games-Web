// The Prism director: runs every robot in a scene, their shots (Fly bolts, Swatter bullets, Roach rockets,
// Scatter bombs), blasts, gas clouds, EMP pulses, drop pods with reinforcements, and the wrecks you search.
// It also runs the player's grenades and answers the player's weapons: what a bullet or a crowbar hits.
// Simulation in step(dt, player), drawing in frame(dt, alpha). Robot and projectile state is plain data.
import * as THREE from 'three';
import { PRISM, REINFORCEMENTS } from './defs.js';
import { BUILD, toWreck } from './models.js';
import { makeRobot, attachRobotBody, detachRobotBody, hitSpheres, becomeHostile, hear, moveRobot, fall, groundBelow, center, damageRobot, GRAVITY } from './robot.js';
import { fink } from './fink.js';
import { fly, swatter } from './fly.js';
import { scatter } from './scatter.js';
import { roach } from './roach.js';
import { Fx } from '../fx.js';
import { applyDamage } from '../damage.js';
import { BODY } from '../stats.js';
import { segDist2 } from '../sentry.js';
import { rollLoot } from '../items.js';
import { makeBox, takeAll } from '../inventory.js';
import { makeWeapon } from '../weapon-models.js';
import { Sfx } from '../sfx.js';
import { Sound } from '../../core/sound.js';
import { bus } from '../../core/events.js';
import { G } from '../../core/physics.js';
import { rng } from '../../core/util.js';

export const BRAINS = { fink, fly, swatter, scatter, roach };
const BOOM = { fink: 0.7, fly: 0.7, swatter: 1.3, scatter: 0.5, roach: 2.4 };
// how far away each kind is still drawn on a big map (the scene's drawRange is the most): a Fly 170 m away is a dot
// a few pixels big in the haze, a Scatter on the ground is behind a wall long before that (step 5d: many more robots)
const SEEN = { fink: 200, fly: 170, scatter: 130, swatter: 240, roach: 240 };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export class PrismDirector {
  // drawRange: robots and wrecks further from the player than this are not drawn (a big map)
  constructor({ scene, phys, items = null, glow = null, seed = 1234, reinforcements = REINFORCEMENTS, drawRange = Infinity }) {
    this.scene = scene; this.phys = phys; this.items = items; this.glow = glow;
    this.drawRange = drawRange;
    this.rnd = rng(seed);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fx = new Fx(scene, glow);
    this.robots = []; this.views = new Map(); this.wrecks = [];
    this.bolts = []; this.rockets = []; this.bombs = []; this.gas = []; this.pods = []; this.grenades = [];
    this.nextId = 1; this.time = 0; this.player = null;
    this.reinforcements = reinforcements;
    this.ctx = { phys, player: null, robots: this.robots, director: this, rnd: this.rnd, time: 0, dt: 0 };
    // shared looks for shots
    this.mat = {
      bolt: new THREE.MeshBasicMaterial({ color: 0xf3e9ff }),
      trail: new THREE.MeshBasicMaterial({ color: 0xb98aff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
      rocket: new THREE.MeshStandardMaterial({ color: 0x2a2731, roughness: 0.5, metalness: 0.4 }),
      ring: new THREE.MeshBasicMaterial({ color: 0xc49bff }),
      gas: new THREE.PointsMaterial({ color: 0x9a66ff, size: 1.3, map: glow || null, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      pod: new THREE.MeshStandardMaterial({ color: 0x150c22, roughness: 0.25, metalness: 0.6, flatShading: true }),
      podEdge: new THREE.LineBasicMaterial({ color: 0xc49bff }),
      podBeam: new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.geo = {
      bolt: new THREE.SphereGeometry(0.07, 8, 6),
      trail: (() => { const g = new THREE.CylinderGeometry(0.015, 0.06, 1, 6, 1, true); g.translate(0, -0.5, 0); g.rotateX(Math.PI / 2); return g; })(),
      rocket: (() => { const g = new THREE.CylinderGeometry(0.06, 0.08, 0.45, 8); g.rotateX(Math.PI / 2); return g; })(),
      bomb: new THREE.SphereGeometry(0.06, 8, 6),
    };
    this.free = { bolt: [], rocket: [], bomb: [], gas: [], nade: [] };
  }

  // ---------- robots ----------
  // route: patrol waypoints [{ x, z, y?, wait? }] (a loop, or back and forth with routeBack; wait: a lookout, seconds);
  // routeOff spreads a group; hover { r, alt }: a guard without a route circles its home that wide and that high
  spawn(type, pos, { yaw = 0, hostile = false, group = null, target = null, route = null, routeBack = false, routeOff = null, routeAlt = null, hover = null } = {}) {
    const r = makeRobot(this.nextId++, type, pos, yaw, this.rnd);
    r.group = group;
    if (route && route.length) {
      r.route = route.map(w => {
        const q = w.y === undefined ? { x: w.x, z: w.z } : { x: w.x, y: w.y, z: w.z };
        if (w.wait) q.wait = w.wait;
        return q;
      });
      r.routeBack = !!routeBack;
      if (routeOff) r.routeOff = { x: routeOff.x, z: routeOff.z };
      if (routeAlt !== null) r.routeAlt = routeAlt;
    }
    if (hover) r.hover = { r: hover.r, alt: hover.alt };
    BRAINS[type].init(r, this.ctx);
    attachRobotBody(r, this.phys);
    this.robots.push(r);
    const view = BUILD[type](this.glow);
    this.group.add(view.root);
    this.views.set(r.id, view);
    if (PRISM[type].flyer && Sound.ctx) view.hum = Sound.loop({ freq: type === 'swatter' ? 150 : type === 'fink' ? 520 : 300, q: 5, filter: 'bandpass' });
    if (hostile) {
      if (target) r.lastSeen = { x: target.x, y: target.y, z: target.z };
      becomeHostile(r, this.ctx, this.player, false);
    }
    BRAINS[type].animate(view, r, 0, 1, this);
    return r;
  }
  // takes a robot out completely (a Scatter that blew up, or clearing the range)
  remove(r) {
    const i = this.robots.indexOf(r);
    if (i >= 0) this.robots.splice(i, 1);
    detachRobotBody(r);
    r.gone = true;
    const v = this.views.get(r.id);
    if (v) this.dropView(v);
    this.views.delete(r.id);
  }
  dropView(v) {
    v.hum?.stop(); v.lockBeam?.dispose(); v.beam?.dispose(); v.aim?.dispose();
    this.group.remove(v.root);
    v.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.isSprite) o.material.dispose(); });
    if (v.visorMat) v.visorMat.dispose();
    if (v.gunGlow) v.gunGlow.dispose();
    if (v.scanMesh) v.scanMesh.material.dispose();
  }
  kill(r, src, how) {
    if (r.dead) return;
    r.dead = true; r.deadT = 0; r.lock = 0; r.beamLen = 0; r.hatchOpen = false; r.hot = false;
    bus.emit('prism:dead', r, src);
    if (r.type === 'scatter') {
      this.boom(center(r), 0.45);
      if (r.state === 'jump' || r.state === 'stuck' || r.state === 'landed') this.remove(r); else this.wreck(r);
      return;
    }
    if (how === 'crash') { this.boom(r.pos, BOOM[r.type]); this.wreck(r); }
  }
  dying(r, dt) {
    r.deadT += dt;
    if (PRISM[r.type].flyer) {
      r.vel.y = Math.max(-30, r.vel.y - GRAVITY * dt);
      r.vel.x *= 1 - dt * 0.5; r.vel.z *= 1 - dt * 0.5;
      r.yaw += dt * 4;
      moveRobot(r, dt);
      if (r.grounded || r.deadT > 5) { this.boom(r.pos, BOOM[r.type]); this.wreck(r); }
    } else {
      r.vel.x *= 1 - Math.min(1, dt * 4); r.vel.z *= 1 - Math.min(1, dt * 4);
      fall(r, dt);
      moveRobot(r, dt);
      if ((r.grounded && r.deadT > (r.type === 'roach' ? 1.2 : 0.4)) || r.deadT > 5) { this.boom(center(r), BOOM[r.type]); this.wreck(r); }
    }
  }
  // a dead robot becomes a wreck on the ground that you can search for loot
  wreck(r) {
    const v = this.views.get(r.id);
    const i = this.robots.indexOf(r);
    if (i >= 0) this.robots.splice(i, 1);
    detachRobotBody(r);
    this.views.delete(r.id);
    if (!v) return;
    v.hum?.stop(); v.lockBeam?.hide(); v.beam?.hide(); v.aim?.hide();
    toWreck(v);
    const d = PRISM[r.type];
    const gy = groundBelow(this.phys, r.pos.x, r.pos.y + 1, r.pos.z);
    const y = d.flyer ? gy + d.radius * 0.55 : gy;
    v.root.position.set(r.pos.x, y, r.pos.z);
    v.root.rotation.set((this.rnd() - 0.5) * 0.5, r.yaw + Math.PI, (this.rnd() - 0.5) * 0.6);
    const w = { id: r.id, type: r.type, view: v, pos: { x: r.pos.x, y, z: r.pos.z }, looted: false, smoke: r.type === 'roach' ? 25 : 8, item: null, box: null };
    if (this.items) {
      const reach = r.type === 'roach' ? 3.2 : 2.2;
      w.item = this.items.add({
        id: 'wreck' + r.id, pos: { x: r.pos.x, y: y + 0.6, z: r.pos.z }, radius: reach,
        hold: () => w.box ? 0 : r.type === 'roach' ? 2.5 : 1.2,               // searching takes a moment; opening again does not
        label: () => w.box ? (w.box.slots.some(Boolean) ? `Open the ${d.name} wreck` : null) : `Search the ${d.name} wreck`,
        use: p => { const box = this.search(w); bus.emit('loot:open', p, box, w); },
      });
    }
    this.wrecks.push(w);
  }
  // A wreck is a container: its loot is rolled the first time it is searched, then it is opened in the
  // inventory screen like a crate.
  search(w) {
    if (!w.box) {
      w.box = makeBox('wreck' + w.id, `${PRISM[w.type].name} wreck`, rollLoot(w.type, this.rnd), 6);
      w.box.pos = { ...w.pos };
      w.box.reach = w.item ? w.item.radius + 1 : 3.2;
      w.looted = true;
      this.sound('loot', w.pos);
    }
    return w.box;
  }
  // takes everything from a wreck that fits in your inventory. Returns what was taken.
  loot(p, w) {
    const box = this.search(w);
    const got = takeAll(p.inv, box);
    bus.emit('prism:loot', p, got, w);
    return got;
  }
  clear() {
    for (const r of [...this.robots]) this.remove(r);
    for (const w of this.wrecks) { this.items?.remove(w.item); this.dropView(w.view); }
    this.wrecks.length = 0;
    for (const g of this.grenades) this.recycle('nade', g); this.grenades.length = 0;
    for (const b of this.bolts) this.recycle('bolt', b); this.bolts.length = 0;
    for (const b of this.rockets) this.recycle('rocket', b); this.rockets.length = 0;
    for (const b of this.bombs) this.recycle('bomb', b); this.bombs.length = 0;
    for (const g of this.gas) this.recycle('gas', g); this.gas.length = 0;
    for (const p of this.pods) this.group.remove(p.view); this.pods.length = 0;
  }

  // ---------- one simulation step ----------
  step(dt, player) {
    this.time += dt; this.player = player;
    const c = this.ctx;
    c.player = player; c.dt = dt; c.time = this.time;
    for (const r of [...this.robots]) {
      if (r.gone) continue;
      r.prev.x = r.pos.x; r.prev.y = r.pos.y; r.prev.z = r.pos.z; r.prevYaw = r.yaw;
      r.st += dt; r.hurtT += dt;
      if (r.dead) this.dying(r, dt);
      else BRAINS[r.type].step(r, c, dt);
    }
    this.stepBolts(dt); this.stepRockets(dt); this.stepBombs(dt); this.stepGas(dt); this.stepPods(dt); this.stepGrenades(dt);
  }

  // ---------- the bullet test for the player's gun: the nearest robot part or wall along a ray ----------
  shoot(o, d, max) {
    const wh = this.phys.ray(o, d, max, G.WORLD);
    let bestT = wh ? wh.t : max, robot = null, part = null;
    const spheres = this._sph || (this._sph = []);
    for (const r of this.robots) {
      if (r.gone) continue;
      if (r.dead && r.type !== 'roach') continue;
      hitSpheres(r, spheres);
      for (const s of spheres) {
        const ox = s.x - o.x, oy = s.y - o.y, oz = s.z - o.z;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const c2 = ox * ox + oy * oy + oz * oz - s.r * s.r;
        const disc = b * b - c2;
        if (disc < 0) continue;
        const t = b - Math.sqrt(disc);
        if (t >= 0 && t < bestT) { bestT = t; robot = r.dead ? null : r; part = s.name; }
      }
    }
    return { t: bestT, robot, part, point: { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT }, wall: !robot && !!wh && bestT >= wh.t - 1e-4 };
  }
  hear(pos, radius, amount) { hear(this.robots, pos, radius, amount); }

  // ---------- the crowbar: the closest robot part within reach, in front of you, with nothing in between ----------
  // o = the chest, dir = { x, z } where you look (level), cosCone = how far to the side still counts
  meleeHit(o, dir, reach, cosCone) {
    let best = null, bestD = Infinity;
    const spheres = this._sph || (this._sph = []);
    for (const r of this.robots) {
      if (r.dead || r.gone) continue;
      hitSpheres(r, spheres);
      for (const s of spheres) {
        const dx = s.x - o.x, dy = s.y - o.y, dz = s.z - o.z, L = Math.hypot(dx, dy, dz), d = L - s.r;
        if (d > reach || d >= bestD) continue;
        const h = Math.hypot(dx, dz);
        if (h > s.r + 0.15 && (dx * dir.x + dz * dir.z) / h < cosCone) continue;
        if (L > 0.05 && this.phys.ray(o, { x: dx / L, y: dy / L, z: dz / L }, Math.max(0, L - s.r), G.WORLD)) continue;
        bestD = d;
        const k = L > 0.05 ? (L - s.r) / L : 0;
        best = { robot: r, part: s.name, point: { x: o.x + dx * k, y: o.y + dy * k, z: o.z + dz * k } };
      }
    }
    return best;
  }
  // an explosion's damage to robots: full within `inner`, less further out, none behind cover
  blastRobots(pos, radius, damage, inner, src) {
    const hits = [];
    for (const r of [...this.robots]) {
      if (r.dead || r.gone) continue;
      const c = center(r), R = PRISM[r.type].radius;
      const dx = c.x - pos.x, dy = c.y - pos.y, dz = c.z - pos.z, L = Math.hypot(dx, dy, dz), d = Math.max(0, L - R);
      if (d > radius) continue;
      if (L > R + 0.1 && this.phys.ray(pos, { x: dx / L, y: dy / L, z: dz / L }, L - R, G.WORLD)) continue;
      const k = d <= inner ? 1 : Math.max(0, 1 - (d - inner) / Math.max(0.01, radius - inner));
      if (k <= 0) continue;
      const res = damageRobot(r, null, damage * k, this.ctx, src);
      if (res) hits.push({ robot: r, res });
    }
    return hits;
  }

  // ---------- the player's grenades: they fly, bounce, roll to a stop and go off when the fuse runs out ----------
  throwGrenade(o, v, T, src) {
    const g = this.take('nade', () => ({ mesh: makeWeapon('grenade', true), pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() }));
    g.pos.set(o.x, o.y, o.z); g.prev.copy(g.pos);
    g.vel.set(v.x, v.y, v.z);
    g.fuse = T.fuse; g.T = T; g.src = src; g.rest = false; g.spin = 0; g.clink = 0;
    this.grenades.push(g);
    return g;
  }
  stepGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.prev.copy(g.pos);
      g.fuse -= dt; g.clink -= dt;
      if (!g.rest) {
        g.vel.y -= GRAVITY * dt;
        let left = dt;
        for (let k = 0; k < 3 && left > 1e-5; k++) {
          const len = g.vel.length() * left;
          if (len < 1e-6) break;
          _w.copy(g.vel).normalize();
          const h = this.phys.ray(g.pos, _w, len + 0.06, G.WORLD, true);
          if (!h) { g.pos.addScaledVector(_w, len); break; }
          const t = Math.max(0, h.t - 0.06);
          g.pos.addScaledVector(_w, t);
          left *= 1 - t / len;
          // bounce: lose most of the speed into the surface and some along it
          const vn = g.vel.x * h.nx + g.vel.y * h.ny + g.vel.z * h.nz;
          if (vn < 0) { g.vel.x -= 1.35 * vn * h.nx; g.vel.y -= 1.35 * vn * h.ny; g.vel.z -= 1.35 * vn * h.nz; }
          g.vel.multiplyScalar(h.ny > 0.6 ? 0.62 : 0.8);
          if (-vn > 2.5 && g.clink <= 0) { g.clink = 0.1; this.sound('clink', g.pos); }
          if (h.ny > 0.6 && g.vel.length() < 1.1) { g.rest = true; g.vel.set(0, 0, 0); break; }
        }
      }
      if (g.fuse <= 0) {
        const T = g.T, pos = { x: g.pos.x, y: g.pos.y + 0.12, z: g.pos.z };
        this.blast(pos, T.radius, T.damage, T.inner, 'blast', 'Your own grenade', pos);
        this.blastRobots(pos, T.radius, T.damage, T.inner, g.src);
        this.boom(pos, 1.25, 0xffa860);
        bus.emit('wpn:grenade', pos, T);
        this.recycle('nade', g); this.grenades[i] = this.grenades[this.grenades.length - 1]; this.grenades.pop();
      }
    }
  }

  // ---------- shots ----------
  take(kind, make) {
    const o = this.free[kind].pop() || make();
    o.mesh.visible = true;
    this.group.add(o.mesh);
    return o;
  }
  recycle(kind, o) { o.mesh.visible = false; this.group.remove(o.mesh); this.free[kind].push(o); }

  fireBolt(o, d, speed, damage, src) {
    const b = this.take('bolt', () => {
      const mesh = new THREE.Mesh(this.geo.bolt, this.mat.bolt);
      const tr = new THREE.Mesh(this.geo.trail, this.mat.trail); tr.scale.set(1, 1, 1.4); mesh.add(tr);
      return { mesh, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() };
    });
    b.pos.set(o.x + d.x * 0.3, o.y + d.y * 0.3, o.z + d.z * 0.3); b.prev.copy(b.pos);
    b.vel.set(d.x * speed, d.y * speed, d.z * speed);
    b.life = 2.2; b.damage = damage; b.passed = false;
    b.from = { x: o.x, y: o.y, z: o.z }; b.source = PRISM[src.type].name;
    this.bolts.push(b);
    this.fx.flash(b.pos, 0xd7b8ff, 0.35, 0.06);
    this.sound('bolt', o);
  }
  stepBolts(dt) {
    const p = this.player;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.prev.copy(b.pos); b.pos.addScaledVector(b.vel, dt); b.life -= dt;
      let end = b.life <= 0;
      const seg = _v.subVectors(b.pos, b.prev), len = seg.length();
      if (!end && len > 1e-6) {
        const h = this.phys.ray(b.prev, seg.divideScalar(len), len, G.WORLD);
        if (h) { this.fx.sparks(b.pos, 0xd7b8ff, 4, 3); end = true; }
      }
      if (!end && !b.passed && p && !p.dead && hitsBody(p, b.prev, b.pos, 0.08)) {
        const res = applyDamage(p, { amount: b.damage, type: 'bolt', from: b.from, source: b.source });
        if (res.dodged) b.passed = true; else end = true;
      }
      if (end) { this.recycle('bolt', b); this.bolts[i] = this.bolts[this.bolts.length - 1]; this.bolts.pop(); }
    }
  }
  // a minigun bullet: instant, along a line; it hits the first wall or you
  fireBullet(o, d, range, damage, src) {
    const h = this.phys.ray(o, d, range, G.WORLD);
    let len = h ? h.t : range;
    const p = this.player;
    let hit = false;
    if (p && !p.dead) {
      const e = { x: o.x + d.x * len, y: o.y + d.y * len, z: o.z + d.z * len };
      if (hitsBody(p, o, e, 0.03)) {
        hit = true;
        const t = (p.pos.x - o.x) * d.x + (p.pos.y + p.height * 0.5 - o.y) * d.y + (p.pos.z - o.z) * d.z;
        len = Math.max(0.5, Math.min(len, t));
        applyDamage(p, { amount: damage, type: 'bullet', from: { x: o.x, y: o.y, z: o.z }, source: PRISM[src.type].name });
      }
    }
    _a.set(o.x, o.y, o.z); _b.set(o.x + d.x * len, o.y + d.y * len, o.z + d.z * len);
    this.fx.tracer(_a, _b, 0xffc08a, 0.022, 0.06);
    if (this.rnd() < 0.5) this.fx.flash(_a, 0xffb070, 0.5, 0.04);
    if (!hit && h) this.fx.sparks(_b, 0xffc08a, 2, 3);
    this.sound('mini', o);
  }
  fireRocket(from, aim, src) {
    const r = this.take('rocket', () => {
      const mesh = new THREE.Mesh(this.geo.rocket, this.mat.rocket);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 12), this.mat.ring); ring.position.z = -0.12; mesh.add(ring);
      if (this.glow) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xa36bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.z = -0.28; s.scale.setScalar(0.6); mesh.add(s); }
      return { mesh, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() };
    });
    const gy = groundBelow(this.phys, aim.x, aim.y + 2, aim.z);
    const T = 1.6 + this.rnd() * 0.5;
    r.pos.set(from.x, from.y, from.z); r.prev.copy(r.pos);
    r.vel.set((aim.x - from.x) / T, (gy - from.y) / T + 0.5 * GRAVITY * T, (aim.z - from.z) / T);
    r.life = T + 2; r.trailT = 0;
    this.rockets.push(r);
    this.fx.flash(r.pos, 0xc49bff, 1.2, 0.12);
    this.fx.smoke(r.pos, 0.9, 1.2, 0x3a3540, 1.5);
    this.sound('rocket', from);
  }
  stepRockets(dt) {
    const p = this.player, D = PRISM.roach;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.prev.copy(r.pos);
      r.vel.y -= GRAVITY * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.life -= dt;
      const seg = _v.subVectors(r.pos, r.prev), len = seg.length();
      let at = null;
      if (len > 1e-6) { const h = this.phys.ray(r.prev, _w.copy(seg).divideScalar(len), len, G.WORLD); if (h) at = _a.copy(r.prev).addScaledVector(_w, h.t); }
      if (!at && p && !p.dead && hitsBody(p, r.prev, r.pos, 0.45)) at = _a.copy(r.pos);
      if (!at && r.life <= 0) at = _a.copy(r.pos);
      if (at) {
        const pos = { x: at.x, y: at.y + 0.1, z: at.z };
        this.blast(pos, D.rocketRadius, D.rocketDamage, 0.8, 'blast', 'Gas rocket', pos);
        this.boom(pos, 1.1, 0xb48aff);
        this.gasCloud({ x: at.x, y: at.y, z: at.z }, D.gasRadius, D.gasTime);
        this.recycle('rocket', r); this.rockets[i] = this.rockets[this.rockets.length - 1]; this.rockets.pop();
      }
    }
  }
  // a missed Scatter bursts into small bombs thrown around it
  cluster(pos, total, n, src) {
    const start = { x: pos.x, y: pos.y + 0.3, z: pos.z };
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, dist = 0.6 + this.rnd() * (PRISM.scatter.spread - 0.6);
      const tx = pos.x + Math.cos(a) * dist, tz = pos.z + Math.sin(a) * dist;
      const gy = groundBelow(this.phys, tx, pos.y + 2, tz);
      const T = 0.45 + this.rnd() * 0.3;
      const b = this.take('bomb', () => ({ mesh: new THREE.Mesh(this.geo.bomb, this.mat.bolt), pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() }));
      b.pos.set(start.x, start.y, start.z); b.prev.copy(b.pos);
      b.vel.set((tx - start.x) / T, (gy - start.y) / T + 0.5 * GRAVITY * T, (tz - start.z) / T);
      b.life = T + 1; b.damage = total / n;
      this.bombs.push(b);
    }
    this.fx.flash({ x: start.x, y: start.y, z: start.z }, 0xffd0a0, 1.4, 0.1);
    this.sound('cluster', pos);
  }
  stepBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.prev.copy(b.pos);
      b.vel.y -= GRAVITY * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      const seg = _v.subVectors(b.pos, b.prev), len = seg.length();
      const h = len > 1e-6 ? this.phys.ray(b.prev, _w.copy(seg).divideScalar(len), len, G.WORLD) : null;
      if (h || b.life <= 0) {
        const at = h ? { x: b.prev.x + _w.x * h.t, y: b.prev.y + _w.y * h.t + 0.1, z: b.prev.z + _w.z * h.t } : { x: b.pos.x, y: b.pos.y, z: b.pos.z };
        this.blast(at, 1.6, b.damage, 0.5, 'blast', 'Scatter cluster', at);
        this.boom(at, 0.55, 0xffc08a, true);
        this.recycle('bomb', b); this.bombs[i] = this.bombs[this.bombs.length - 1]; this.bombs.pop();
      }
    }
  }

  // ---------- area effects ----------
  // damage to the player if within `radius` of pos (full within `inner`, less further out) and not behind cover
  blast(pos, radius, damage, inner, type, source, from) {
    const p = this.player;
    if (!p || p.dead) return null;
    const ay = clamp(pos.y, p.pos.y + BODY.radius, p.pos.y + p.height - BODY.radius);
    const dx = p.pos.x - pos.x, dy = ay - pos.y, dz = p.pos.z - pos.z, L = Math.hypot(dx, dy, dz);
    const d = Math.max(0, L - BODY.radius);
    if (d > radius) return null;
    if (L > 0.35) {
      const o = { x: pos.x, y: pos.y + 0.15, z: pos.z };
      const tx = p.pos.x - o.x, ty = ay - o.y, tz = p.pos.z - o.z, tl = Math.hypot(tx, ty, tz);
      const h = this.phys.ray(o, { x: tx / tl, y: ty / tl, z: tz / tl }, tl, G.WORLD);
      if (h && h.t < tl - BODY.radius - 0.05) return null;            // cover took it
    }
    const k = d <= inner ? 1 : Math.max(0, 1 - (d - inner) / Math.max(0.01, radius - inner));
    if (k <= 0) return null;
    return applyDamage(p, { amount: damage * k, type, source, from: from || pos });
  }
  boom(pos, size, color = 0xc49bff, quiet = false) {
    _a.set(pos.x, pos.y, pos.z);
    this.fx.explosion(_a, size, color);
    this.sound(quiet ? 'pop' : size > 1.8 ? 'boom_big' : 'boom', pos);
    hear(this.robots, pos, 22, 0.5);
    bus.emit('prism:boom', pos, size);
  }
  warn(pos, radius, time) { this.fx.ring(pos, radius, 0xff4d3d, time, 'hold'); }
  emp(pos, radius, time, src) {
    this.fx.ring({ x: pos.x, y: pos.y, z: pos.z }, radius, 0x7fd0ff, 0.9);
    _a.set(pos.x, pos.y + 1, pos.z);
    this.fx.flash(_a, 0x9fdcff, radius * 0.8, 0.25);
    this.sound('emp', pos);
    const p = this.player;
    if (p && !p.dead && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < radius && Math.abs(p.pos.y - pos.y) < 4) {
      p.emp = time;
      bus.emit('prism:emp', p, src);
    }
  }
  gasCloud(pos, radius, time) {
    const g = this.take('gas', () => {
      const N = 160, arr = new Float32Array(N * 3), seed = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { seed[i * 3] = Math.random() * Math.PI * 2; seed[i * 3 + 1] = Math.sqrt(Math.random()); seed[i * 3 + 2] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      return { mesh: new THREE.Points(geo, this.mat.gas.clone()), seed };
    });
    g.pos = { x: pos.x, y: pos.y, z: pos.z }; g.r = radius; g.t = time; g.life = time; g.acc = 0;
    this.gas.push(g);
  }
  // gas clouds: inside one (or several overlapping: they do not stack) you take 2 damage every 0.1 s
  stepGas(dt) {
    const p = this.player;
    for (let i = this.gas.length - 1; i >= 0; i--) {
      const g = this.gas[i];
      g.t -= dt;
      if (g.t <= 0) { this.recycle('gas', g); this.gas[i] = this.gas[this.gas.length - 1]; this.gas.pop(); }
    }
    if (p && !p.dead && this.playerInGas(p)) {
      this.gasAcc = (this.gasAcc || 0) + dt;
      while (this.gasAcc >= 0.1) { this.gasAcc -= 0.1; applyDamage(p, { amount: 2, type: 'gas', source: 'Roach gas', from: null }); }
    } else this.gasAcc = 0;
  }
  playerInGas(p) { return this.gas.some(g => Math.hypot(p.pos.x - g.pos.x, p.pos.z - g.pos.z) < g.r && p.pos.y < g.pos.y + 2.8 && p.pos.y > g.pos.y - 1.5); }

  // ---------- drop pods ----------
  reinforce(target, caller) {
    // somewhere open 12-20 m from the target
    let at = null;
    for (let i = 0; i < 14 && !at; i++) {
      const a = this.rnd() * Math.PI * 2, d = 12 + this.rnd() * 8;
      const x = target.x + Math.cos(a) * d, z = target.z + Math.sin(a) * d;
      const gy = groundBelow(this.phys, x, target.y + 6, z);
      if (Math.abs(gy - target.y) > 4) continue;
      if (this.phys.free({ x, y: gy + 1.9, z }, 1.2, 1.4)) at = { x, y: gy, z };
    }
    if (!at) at = { x: target.x + 8, y: target.y, z: target.z };
    const view = new THREE.Group();
    const geo = new THREE.ConeGeometry(1.7, 3.4, 4);
    const body = new THREE.Mesh(geo, this.mat.pod);
    body.position.y = 1.7; body.rotation.y = Math.PI / 4; body.castShadow = true;
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.mat.podEdge));
    view.add(body);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 120, 12, 1, true), this.mat.podBeam);
    beam.position.y = 60;
    view.add(beam);
    view.position.set(at.x, at.y + 70, at.z);
    this.group.add(view);
    const pod = { pos: at, y: at.y + 70, t: 0, phase: 'falling', types: [...this.reinforcements], target: { ...target }, view, beam, id: this.nextId++ };
    this.pods.push(pod);
    bus.emit('prism:pod', pod, caller);
    this.sound('pod', at);
    return pod;
  }
  stepPods(dt) {
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const pod = this.pods[i];
      pod.t += dt;
      if (pod.phase === 'falling') {
        pod.y = Math.max(pod.pos.y, pod.pos.y + 70 - pod.t * pod.t * 30);
        if (pod.y <= pod.pos.y) {
          pod.phase = 'open'; pod.t = 0;
          this.boom({ x: pod.pos.x, y: pod.pos.y + 0.5, z: pod.pos.z }, 1.6, 0xb48aff);
          this.fx.ring(pod.pos, 7, 0xc49bff, 0.8);
          this.blast({ x: pod.pos.x, y: pod.pos.y + 0.5, z: pod.pos.z }, 2.5, 60, 1.5, 'blast', 'Drop pod', pod.pos);
          bus.emit('prism:podland', pod);
        }
      } else if (pod.phase === 'open' && pod.t >= 0.5) {
        pod.types.forEach((type, k) => {
          const a = k / pod.types.length * Math.PI * 2;
          const fly = PRISM[type].flyer;
          this.spawn(type, { x: pod.pos.x + Math.cos(a) * 2.6, y: pod.pos.y + (fly ? 2.5 : 0.1), z: pod.pos.z + Math.sin(a) * 2.6 },
            { yaw: Math.atan2(-(pod.target.x - pod.pos.x), -(pod.target.z - pod.pos.z)), hostile: true, target: pod.target, group: 'pod' + pod.id });
        });
        pod.phase = 'idle'; pod.t = 0;
      } else if (pod.phase === 'idle' && pod.t > 25) { pod.phase = 'sink'; pod.t = 0; }
      else if (pod.phase === 'sink') {
        pod.y = pod.pos.y - pod.t * 2;
        if (pod.t > 2) { this.group.remove(pod.view); this.pods.splice(i, 1); }
      }
    }
  }

  // ---------- sound: quieter with distance from the player ----------
  sound(name, pos, extra) {
    const p = this.player;
    const d = p && pos ? Math.hypot(pos.x - p.pos.x, pos.y - p.pos.y - 1, pos.z - p.pos.z) : 0;
    Sfx.robot(name, d, extra);
  }

  // ---------- drawing ----------
  frame(dt, alpha) {
    this.fx.update(dt);
    const p = this.player, far = this.drawRange;
    const away = (pos, type) => p && far < Infinity && Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) > Math.min(far, SEEN[type] || far);
    for (const w of this.wrecks) { const hide = away(w.pos, w.type); if (w.view.root.visible === hide) w.view.root.visible = !hide; }
    for (const r of this.robots) {
      const v = this.views.get(r.id);
      if (!v) continue;
      const hide = away(r.pos, r.type);
      if (v.root.visible === hide) v.root.visible = !hide;
      if (hide) { v.hum?.set(0, 0); continue; }
      BRAINS[r.type].animate(v, r, dt, alpha, this);
      if (v.hum) {
        const d = p ? Math.hypot(r.pos.x - p.pos.x, r.pos.y - p.pos.y, r.pos.z - p.pos.z) : 99;
        v.hum.set(r.dead || r.falling ? 0 : 0.05 * Math.max(0, 1 - d / 28) * (r.type === 'swatter' ? 1.4 : 1), 0);
      }
    }
    for (const w of this.wrecks) {
      if (w.smoke <= 0) continue;
      w.smoke -= dt;
      w.puff = (w.puff || 0) - dt;
      if (w.puff <= 0) { w.puff = w.type === 'roach' ? 0.12 : 0.25; _a.set(w.pos.x + (Math.random() - 0.5) * 0.4, w.pos.y + 0.4, w.pos.z + (Math.random() - 0.5) * 0.4); this.fx.smoke(_a, w.type === 'roach' ? 1.4 : 0.6, 2, 0x1f1c21, 1.1); }
    }
    for (const b of this.bolts) { b.mesh.position.lerpVectors(b.prev, b.pos, alpha); b.mesh.lookAt(_a.copy(b.mesh.position).sub(b.vel)); }
    for (const b of this.bombs) b.mesh.position.lerpVectors(b.prev, b.pos, alpha);
    for (const g of this.grenades) {
      g.mesh.position.lerpVectors(g.prev, g.pos, alpha);
      if (!g.rest) g.spin += dt * 11;
      g.mesh.rotation.set(g.spin, g.spin * 0.6, 0);
    }
    for (const r of this.rockets) {
      r.mesh.position.lerpVectors(r.prev, r.pos, alpha);
      r.mesh.lookAt(_a.copy(r.mesh.position).add(r.vel));
      r.trailT -= dt;
      if (r.trailT <= 0) { r.trailT = 0.03; this.fx.smoke(r.mesh.position, 0.45, 0.9, 0x6a5f78, 0.3); }
    }
    for (const g of this.gas) {
      const a = g.mesh.geometry.attributes.position, s = g.seed, n = a.count, age = g.life - g.t;
      const fade = Math.min(1, age * 2) * Math.min(1, g.t / 1.5);
      g.mesh.material.opacity = 0.55 * fade;
      for (let i = 0; i < n; i++) {
        const k = (s[i * 3 + 2] + age * 0.1) % 1;
        const ang = s[i * 3] + age * 0.2 + k * 2, rad = s[i * 3 + 1] * g.r * (0.6 + 0.4 * Math.min(1, age * 1.5));
        a.setXYZ(i, g.pos.x + Math.cos(ang) * rad, g.pos.y + k * 2.6, g.pos.z + Math.sin(ang) * rad);
      }
      a.needsUpdate = true;
    }
    for (const pod of this.pods) {
      pod.view.position.set(pod.pos.x, pod.y, pod.pos.z);
      pod.beam.visible = pod.phase === 'falling' || (pod.phase === 'open') || (pod.phase === 'idle' && pod.t < 1.2);
      pod.beam.material.opacity = pod.phase === 'falling' ? 0.35 : 0.2;
    }
  }

  // for the HUD and the debug overlay
  get alerts() { return this.robots.filter(r => !r.dead && !r.hostile && r.aware > 0.02); }
  counts() {
    const c = {};
    for (const r of this.robots) if (!r.dead) c[r.type] = (c[r.type] || 0) + 1;
    return c;
  }
  dispose() {
    this.clear();
    this.fx.dispose();
    this.scene.remove(this.group);
  }
}

// does a short segment come within `pad` of the player's body (a capsule)?
function hitsBody(p, a, b, pad) {
  const c0 = { x: p.pos.x, y: p.pos.y + BODY.radius, z: p.pos.z }, c1 = { x: p.pos.x, y: p.pos.y + p.height - BODY.radius, z: p.pos.z };
  const rr = BODY.radius + pad;
  return segDist2(a, b, c0, c1) < rr * rr;
}
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
