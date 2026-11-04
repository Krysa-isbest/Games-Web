// The local player: first-person movement that rides on moving ships (positions are kept in the ship's
// own space while aboard), swimming, ladders, interaction, the helm, the crane, deck guns, carrying, repairs,
// bailing water and putting out fires. Online, guests ask the host (act) for anything that changes the world.
import * as THREE from 'three';
import { G, P, clamp, S, rand, lerp, isGuest, isOnline } from './state.js';
import { waveHeight } from './ocean.js';
import { groundHeight } from './islands.js';
import { VS, T } from './ship.js';
import { IN } from './input.js';
import { down, hit, kn } from './keys.js';
import { Gunner, makeInventory, WEAPONS, fireCannon, arcPoints, PRIMARIES, gunState, gunStats } from './weapons.js';
import { holdItem, dropItem, destroyItem, setBucket, makeItem, itemWorld, crateWorld, removeCrate, hookCrate, releaseCrate, updateStorage, LOOT, raySphere } from './entities.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';

const HALF = 0.3, HEIGHT = 1.7, EYE = 1.6;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const THROTTLE = ['Reverse', 'Stop', 'Slow ahead', 'Half ahead', 'Full ahead'];
const act = (...a) => G.netAct(...a);
const arr = v => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];

export class Player {
  constructor(kit, name = P.name) {
    this.id = G.net.id; this.name = name; this.isPlayer = true; this.kit = kit; this.skill = kit.loadout.skill; this.team = 'player';
    this.frame = null; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.alive = true; this.respawnT = 0; this.oxygen = 1; this.out = false;
    this.swimming = false; this.inSea = false; this.underwater = false; this.onGround = false; this.climbing = false;
    this.mode = 'walk'; this.station = null; this.holding = null; this.chase = false; this.busy = false;
    this.inv = makeInventory(kit); this.slot = 'primary';
    this.kills = 0; this.sunk = 0; this.home = null; this.fireT = 0;
    this.gun = new Gunner(this);
    this.prompt = ''; this.hurtT = 0;
    this.aim = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.7 }));
    this.aim.frustumCulled = false; this.aim.visible = false;
    G.scene.add(this.aim);
  }
  dispose() { this.gun.dispose(); G.scene.remove(this.aim); }

  // ---------- frames ----------
  worldPos(out = new THREE.Vector3()) { out.copy(this.pos); return this.frame ? this.frame.toWorld(out) : out; }
  eyeWorld(out = new THREE.Vector3()) { out.copy(this.pos); out.y += EYE; return this.frame ? this.frame.toWorld(out) : out; }
  center(out = new THREE.Vector3()) { out.copy(this.pos); out.y += 1.0; return this.frame ? this.frame.toWorld(out) : out; }
  worldYaw() { return this.yaw + (this.frame ? this.frame.yaw : 0); }
  forwardLocal(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  attach(ship) {
    const wp = this.worldPos(v1);
    const wv = v2.copy(this.vel).sub(ship.velocity(v3));
    this.pos.copy(ship.toLocal(wp.clone()));
    const len = wv.length();
    this.vel.copy(ship.dirToLocal(wv.normalize())).multiplyScalar(len);
    this.yaw -= ship.yaw;
    this.frame = ship;
  }
  detach() {
    const s = this.frame;
    if (!s) return;
    const len = this.vel.length();
    const wv = s.dirToWorld(this.vel.clone().normalize()).multiplyScalar(len).add(s.velocity(v3));
    this.pos.copy(s.toWorld(this.pos.clone()));
    this.vel.copy(wv);
    this.yaw += s.yaw;
    this.frame = null;
  }
  // spawn looking at the helm console, so the first thing you see is how to drive
  placeOn(ship, lp) {
    this.frame = ship; this.pos.copy(lp); this.vel.set(0, 0, 0); this.pitch = -0.15;
    const dx = ship.wheelLp.x - lp.x, dz = ship.wheelLp.z - lp.z;
    this.yaw = Math.hypot(dx, dz) > 0.3 ? Math.atan2(-dx, -dz) : Math.PI;
  }

  // ---------- damage ----------
  hitTest(o, d, max) {
    const c = this.center(v1);
    const t = raySphere(o, d, c, 0.45);
    const h = raySphere(o, d, v2.copy(c).add(v3.set(0, 0.62, 0)), 0.22);
    if (h != null && h <= max && (t == null || h < t)) return { dist: h, head: true };
    return t != null && t <= max ? { dist: t } : null;
  }
  hurt(amount, by, kind, from) {
    if (!this.alive || G.admin.god) return;
    this.hp -= amount; this.hurtT = 0.4;
    this.lastHurt = by;
    sfx.hurt();
    if (from && kind === 'boom') {
      const push = this.center(v1).sub(from).normalize().multiplyScalar(Math.min(12, amount * 0.15));
      this.vel.add(this.frame ? this.frame.dirToLocal(push.clone()).multiplyScalar(push.length()) : push);
    }
    if (this.hp <= 0) this.die(by, kind);
  }
  die(by, kind) {
    this.hp = 0; this.alive = false; this.respawnT = 5;
    this.leaveStation();
    if (this.holding) this.drop();
    const how = { shark: 'were eaten by a shark', nuke: 'were nuked', drown: 'drowned', boom: 'were blown up', cannon: 'were hit by a shell', fire: 'burned', storm: 'were caught in the storm' }[kind] || 'were shot';
    G.toast?.(`💀 You ${how}${by?.name ? ' by ' + by.name : ''}.`, 'bad');
    if (isGuest()) { act('died', by?.id ?? null, kind); G.game?.onDeath?.(this, by, kind); }
    else { if (isOnline()) G.announceKill?.(this, by, kind); G.game?.onDeath?.(this, by, kind); }
  }
  respawn() {
    this.hp = 100; this.oxygen = 1; this.alive = true;
    const ship = G.game?.respawnShip?.(this);
    if (ship) this.placeOn(ship, ship.driverLp.clone().add(v1.set(1.2, 0, 0)));
    else { this.frame = null; this.pos.set(0, 2, 0); }
    this.inv = makeInventory(this.kit); this.slot = 'primary';
  }
  leaveStation() {
    if (this.mode === 'wheel' || this.mode === 'crane') {
      const s = this.station;
      if (isGuest()) act('helm', s.id, false);
      else { if (s.driver === this) s.driver = null; s.rudderIn = 0; }
      s.crane.user = null;
    }
    if (this.mode === 'cannon') {
      const { ship, c } = this.station;
      if (isGuest()) act('cannon', ship.id, ship.cannons.indexOf(c), false);
      c.user = null;
    }
    this.mode = 'walk'; this.station = null; this.aim.visible = false;
  }

  // ---------- main update ----------
  update(dt) {
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (!this.alive) {
      if (!this.out) { this.respawnT -= dt; if (this.respawnT <= 0) this.respawn(); }
      this.gun.update(dt, false, false, false);
      return;
    }
    if (this.frame && (this.frame.sunk || this.frame.gone)) { this.leaveStation(); this.detach(); }
    const wasWalk = this.mode === 'walk';
    const st = this.gun.stats();
    const zoom = st ? lerp(1, st.zoom, this.gun.ads) : 1;
    const sens = 0.0022 * S.sens / zoom;
    if (this.mode === 'walk' || this.mode === 'wheel') {
      this.yaw -= IN.mdx * sens; this.pitch = clamp(this.pitch - IN.mdy * sens * (S.invertY ? -1 : 1), -1.5, 1.5);
    }
    if (this.mode === 'wheel') this.updateWheel(dt);
    else if (this.mode === 'crane') this.updateCrane(dt, sens);
    else if (this.mode === 'cannon') this.updateCannon(dt, sens);
    else this.updateWalk(dt);
    this.updateBreath(dt);
    this.updateFire(dt);
    if (wasWalk && this.mode === 'walk') this.prompt = this.findInteract();
    else if (this.mode === 'walk') this.prompt = '';
    const moving = this.mode === 'walk' && (down('forward') || down('left') || down('back') || down('right'));
    this.gun.update(dt, this.mode === 'walk' && !this.holding && !this.climbing, moving, moving && down('sprint') && down('forward') && !this.swimming);
  }

  updateBreath(dt) {
    if (this.underwater) {
      this.oxygen -= dt / (this.skill === 'lungs' ? 36 : 18);
      if (this.oxygen <= 0) { this.oxygen = 0; this.drownT = (this.drownT || 0) - dt; if (this.drownT <= 0) { this.drownT = 1; this.hurt(15, null, 'drown'); } }
    } else this.oxygen = Math.min(1, this.oxygen + dt / 3);
  }
  updateFire(dt) {
    const s = this.frame;
    if (!s || !s.fires.length) return;
    this.fireT -= dt;
    for (const f of s.fires) {
      if (Math.hypot(f.lp.x - this.pos.x, f.lp.z - this.pos.z) < 0.9 && Math.abs(f.lp.y - this.pos.y) < 1.2) {
        if (this.fireT <= 0) { this.fireT = 0.5; this.hurt(6, null, 'fire'); }
        break;
      }
    }
  }

  medium() {
    const wp = this.worldPos(v1);
    const sea = waveHeight(wp.x, wp.z);
    let surface = null, inSea = false;
    if (this.frame && this.frame.insideHull(this.pos) && this.pos.y < this.frame.H * VS) {
      const c = this.frame.compAtLocal(this.pos);
      if (c && c.vol > 0.05) surface = c.level;
    } else if (wp.y < sea) { surface = this.frame ? this.pos.y + (sea - wp.y) : sea; inSea = true; }
    const eyeY = this.pos.y + EYE;
    return { surface, inSea, swim: surface != null && this.pos.y + 1.15 < surface, under: surface != null && eyeY < surface };
  }

  updateWalk(dt) {
    const s = this.frame;
    const m = this.medium();
    this.swimming = m.swim; this.inSea = m.inSea && m.swim; this.underwater = m.under;
    this.underKind = m.under ? (m.inSea ? 'sea' : 'hull') : null; this.underDepth = m.under ? m.surface - (this.pos.y + EYE) : 0;
    const f = this.forwardLocal(v2), r = v3.set(-f.z, 0, f.x);
    let wx = 0, wz = 0;
    if (down('forward')) { wx += f.x; wz += f.z; }
    if (down('back')) { wx -= f.x; wz -= f.z; }
    if (down('right')) { wx += r.x; wz += r.z; }
    if (down('left')) { wx -= r.x; wz -= r.z; }
    const wl = Math.hypot(wx, wz) || 1; wx /= wl; wz /= wl;
    const heavy = this.holding && ['barrel', 'table', 'box', 'chair'].includes(this.holding.kind) && this.skill !== 'strong';
    const sprint = down('sprint') && !heavy;
    const legs = this.skill === 'sealegs' ? 1.4 : 1;
    let speed = this.swimming ? (sprint ? 4.4 : 3.2) * legs : (sprint ? 7 : 4.6);
    if (heavy) speed *= 0.75;
    speed *= 1 - this.gun.ads * 0.4;
    const w = this.inv[this.slot] && WEAPONS[this.inv[this.slot].id];
    if (w?.slow && !this.holding) speed *= w.slow;
    const acc = this.onGround || this.swimming ? 14 : 3;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, acc * dt);

    this.climbing = false;
    if (s) for (const L of s.ladders) {
      const out = (this.pos.x - L.x) * L.side;
      if (Math.abs(this.pos.z - L.z) < 0.8 && out > -0.5 && out < 1.3 && this.pos.y < s.deckTop + 0.1 && this.pos.y > L.bottom - 1.6 && (down('forward') || down('jump'))) {
        this.climbing = true;
        this.vel.set(0, 3.2 * legs, 0);
        this.pos.x += (L.x + L.side * 0.4 - this.pos.x) * Math.min(1, dt * 8);
        this.pos.z += (L.z - this.pos.z) * Math.min(1, dt * 8);
        if (this.pos.y >= s.deckTop - 0.15) { this.pos.y = s.deckTop + 0.02; this.pos.x = L.x - L.side * 0.75; this.vel.set(0, 0, 0); }
      }
    }
    if (!this.climbing) {
      if (this.swimming) {
        let target = m.surface - 1.35;
        if (down('dive')) target = m.surface - 6;
        if (down('jump')) target = m.surface - 0.9;
        this.vel.y += ((target - this.pos.y) * 4 - this.vel.y * 2.5) * dt;
      } else {
        this.vel.y -= 20 * dt;
        if (hit('jump') && this.onGround) this.vel.y = 7;
      }
    }
    this.onGround = false;
    if (s) this.moveInShip(s, dt);
    else this.moveInWorld(dt);
    if (this.frame && !this.frame.inBox(this.pos, 0.7)) this.detach();
    else if (!this.frame) {
      for (const sh of G.ships) {
        if (sh.sunk) continue;
        const lp = sh.toLocal(v1.copy(this.pos));
        if (sh.inBox(lp, 0.3)) { this.attach(sh); break; }
      }
    }
    this.useHands();
  }

  collides(s, x, y, z) {
    const i0 = Math.floor((x - HALF) / VS + s.nx / 2), i1 = Math.floor((x + HALF) / VS + s.nx / 2);
    const k0 = Math.floor((z - HALF) / VS + s.nz / 2), k1 = Math.floor((z + HALF) / VS + s.nz / 2);
    const j0 = Math.floor((y + 0.01) / VS), j1 = Math.floor((y + HEIGHT) / VS);
    let worst = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const t = s.get(i, j, k);
      if (t === T.RAIL) return t;
      if (t) worst = t;
    }
    return worst;
  }
  moveInShip(s, dt) {
    const p = this.pos;
    for (const ax of ['x', 'z']) {
      const d = this.vel[ax] * dt;
      if (!d) continue;
      const nx = ax === 'x' ? p.x + d : p.x, nz = ax === 'z' ? p.z + d : p.z;
      const h = this.collides(s, nx, p.y, nz);
      if (!h) { p[ax] += d; continue; }
      const canStep = (this.onGroundPrev || this.swimming) && h !== T.RAIL && !this.collides(s, nx, p.y + VS + 0.02, nz) && !this.collides(s, p.x, p.y + VS + 0.02, p.z);
      if (canStep) { p.y += VS + 0.02; p[ax] += d; }
      else this.vel[ax] = 0;
    }
    const dy = this.vel.y * dt;
    if (this.collides(s, p.x, p.y + dy, p.z)) {
      if (dy < 0) { this.onGround = true; p.y = (Math.floor((p.y + dy) / VS) + 1) * VS; }
      this.vel.y = 0;
    } else p.y += dy;
    this.onGroundPrev = this.onGround;
  }
  moveInWorld(dt) {
    const p = this.pos;
    p.x += this.vel.x * dt; p.z += this.vel.z * dt; p.y += this.vel.y * dt;
    const g = groundHeight(p.x, p.z);
    if (p.y < g) { p.y = g; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; }
    this.onGroundPrev = this.onGround;
  }

  // ---------- interaction ----------
  helmTaken(s) {
    if (isGuest()) return s.driverId && s.driverId !== this.id;
    return s.driver && s.driver.alive && s.driver !== this;
  }
  interactables() {
    const out = [];
    const s = this.frame;
    const W = (lp, dy) => s.toWorld(new THREE.Vector3().copy(lp).add(new THREE.Vector3(0, dy, 0)));   // fresh vectors for every entry
    if (s) {
      if (!this.helmTaken(s)) out.push({ kind: 'wheel', ship: s, p: W(s.wheelLp, 1.1), label: `Take the helm of the ${s.name}` });
      s.cannons.forEach((c, ci) => { if (!c.user || c.user === this) out.push({ kind: 'cannon', ship: s, c, ci, p: W(c.lp, 0.7), label: 'Man the deck gun' }); });
      if (s.storage) out.push({ kind: 'storage', ship: s, p: W(s.storage.lp, 0.5), label: this.holding?.kind === 'plank' ? 'Put the plank back' : `Take a plank (${s.storage.planks} left)` });
    }
    for (const it of G.items) if (!it.holder) out.push({ kind: 'item', it, p: itemWorld(it, new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)), label: `Pick up the ${it.def.name.toLowerCase()}${it.kind === 'bucket' && it.full ? ' (full)' : ''}${it.def.fix ? ' (patches holes)' : ''}` });
    for (const c of G.crates) if (c.state !== 'fall' && c.state !== 'hook') out.push({ kind: 'crate', c, p: crateWorld(c, new THREE.Vector3()), label: 'Open the supply crate' + (c.loot === 'nuke' ? ' ☢️' : c.loot === 'airstrike' ? ' ✈️' : '') });
    for (const e of G.game?.interactables?.(this) || []) out.push(e);
    return out;
  }
  findInteract() {
    if (!this.alive) return '';
    const eye = this.eyeWorld(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    let best = null, bs = -1;
    for (const o of this.interactables()) {
      const d = o.p.distanceTo(eye);
      if (d > 2.8) continue;
      const dot = v1.copy(o.p).sub(eye).normalize().dot(fwd);
      if (dot < 0.5) continue;
      const score = dot - d * 0.12;
      if (score > bs) { bs = score; best = o; }
    }
    if (hit('use') && best && !this.busy) this.interact(best);
    let hint = best ? `[${kn('use')}] ${best.label}` : '';
    if (this.holding) hint = (hint ? hint + '   ' : '') + this.holdHint();
    return hint;
  }
  holdHint() {
    const h = this.holding;
    if (h.kind === 'plank') return `[LMB] Nail the plank over a hole   [${kn('drop')}] Drop`;
    if (h.kind === 'bucket') return h.full ? `[LMB] Throw it overboard (at the railing) or onto a fire   [${kn('drop')}] Drop` : `[LMB] Fill it (stand in the flood water)   [${kn('drop')}] Drop`;
    return `[LMB] Use it to patch a hole   [${kn('drop')}] Drop`;
  }
  enterHelm(s) {
    if (this.holding) this.drop();
    this.mode = 'wheel'; this.station = s; if (!isGuest()) s.driver = this;
    this.pos.copy(s.driverLp); this.vel.set(0, 0, 0); this.yaw = Math.PI; this.pitch = -0.1;
    G.toast?.(`Helm: ${kn('forward')}/${kn('back')} speed · ${kn('left')}/${kn('right')} steer · ${kn('view')} camera · ${kn('crane')} crane · ${kn('use')} let go`);
  }
  async interact(o) {
    if (o.use) return o.use(this);
    const guest = isGuest();
    this.busy = true;
    try {
      if (o.kind === 'wheel') {
        if (guest) { if (await act('helm', o.ship.id, true)) this.enterHelm(o.ship); else G.toast?.('Someone else is at the helm.'); }
        else this.enterHelm(o.ship);
      } else if (o.kind === 'cannon') {
        if (guest && !(await act('cannon', o.ship.id, o.ci, true))) return G.toast?.('Someone is using that gun.');
        if (this.holding) this.drop();
        this.mode = 'cannon'; this.station = { ship: o.ship, c: o.c }; o.c.user = this;
      } else if (o.kind === 'storage') {
        const st = o.ship.storage;
        if (this.holding?.kind === 'plank') {
          const it = this.holding; this.holding = null;
          if (guest) { it.mesh.parent?.remove(it.mesh); act('returnPlank', o.ship.id, it.id); } else { destroyItem(it); st.planks++; updateStorage(o.ship); }
        } else if (this.holding) G.toast?.(`Your hands are full (${kn('drop')} to drop).`);
        else if (st.planks <= 0) G.toast?.('No planks left. Use furniture, or find planks in supply crates.');
        else if (guest) {
          const id = await act('takePlank', o.ship.id);
          const it = id && G.items.find(i => i.id === id);
          if (it) { holdItem(it, this); this.holding = it; sfx.wood(); }
        } else { st.planks--; const it = makeItem('plank', null, new THREE.Vector3(0, -50, 0)); holdItem(it, this); this.holding = it; sfx.wood(); updateStorage(o.ship); }
      } else if (o.kind === 'item') {
        if (this.holding) this.drop();
        if (guest && !(await act('pickItem', o.it.id))) return;
        holdItem(o.it, this); this.holding = o.it; sfx.pickup();
      } else if (o.kind === 'crate') {
        if (guest) { const loot = await act('openCrate', o.c.id); if (loot) applyLoot(loot, this); }
        else openCrate(o.c, this);
      }
    } finally { this.busy = false; }
  }
  drop() {
    const it = this.holding;
    if (!it) return;
    this.holding = null;
    dropItem(it, this);
    if (isGuest()) act('dropItem', it.id, it.ship?.id ?? null, arr(it.ship ? it.lp : it.wp));
  }

  async useHands() {
    const h = this.holding;
    if (!h) return;
    if (hit('drop')) return this.drop();
    if (!IN.lmbHit || this.busy) return;
    const s = this.frame, guest = isGuest();
    const eye = this.eyeWorld(new THREE.Vector3()), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    if (h.kind === 'bucket') {
      if (!h.full) {
        const c = s && s.compAtLocal(this.pos);
        const amount = this.skill === 'strong' ? 6 : 3;
        if (c && c.vol > 0.05 && c.level > this.pos.y + 0.12) {
          if (guest) act('bail', s.id, c.i, amount, h.id); else c.vol = Math.max(0, c.vol - amount);
          setBucket(h, true); sfx.splash(null, 0.5);
        } else if (this.inSea || (!s && this.swimming)) { setBucket(h, true); if (guest) act('bucket', h.id, true); sfx.splash(null, 0.5); G.toast?.('Sea water: good for fires, useless for bailing.'); }
        else G.toast?.('Stand in the flood water below deck to fill the bucket.');
        return;
      }
      const p = eye.clone().addScaledVector(dir, 2.2);
      for (const sh of G.ships) {
        if (!sh.fires.length) continue;
        const lp = sh.toLocal(p.clone());
        if (!sh.fires.some(f => f.lp.distanceTo(lp) < 2.6)) continue;
        if (guest) act('extinguish', sh.id, arr(p)); else sh.extinguish(p, 2.6);
        setBucket(h, false); if (guest) act('bucket', h.id, false);
        for (let i = 0; i < 7; i++) FX.steam(p.x + rand(-1, 1), p.y, p.z + rand(-1, 1));
        sfx.splash(p, 0.8); G.toast?.('🔥 Fire put out!', 'good');
        return;
      }
      const atRail = !s || this.pos.y >= s.deckTop - 0.1 && Math.abs(this.pos.x) > s.halfAt(1, this.pos.z / s.hl) - 1.4;
      if (atRail || this.pos.y >= s.deckTop + 1) {
        setBucket(h, false); if (guest) act('bucket', h.id, false);
        for (let i = 0; i < 22; i++) FX.spray(eye.x + dir.x * 0.8, eye.y - 0.4, eye.z + dir.z * 0.8, dir.x + rand(-0.3, 0.3), 0.6, dir.z + rand(-0.3, 0.3));
        sfx.splash(null, 0.7);
      } else G.toast?.('Take the bucket up to the railing and throw it overboard (or onto a fire).');
      return;
    }
    const spot = this.repairSpot(eye, dir);
    if (!spot) return G.toast?.('Look at a hole in a ship (up close) to patch it.');
    const carp = this.skill === 'carpenter';
    let fixed;
    if (guest) {
      this.busy = true;
      fixed = await act('repair', h.id, spot.ship.id, arr(spot.p), h.kind === 'plank', carp);
      this.busy = false;
      if (fixed) { h.mesh.parent?.remove(h.mesh); if (this.holding === h) this.holding = null; }
    } else {
      fixed = h.kind === 'plank' ? spot.ship.repairAt(spot.p, 1.2, 60, carp ? 1 : 0.9) : spot.ship.repairAt(spot.p, 0.9, h.def.fix * 4 * (carp ? 2 : 1), 1);
      if (fixed) { destroyItem(h); this.holding = null; }
    }
    if (fixed) { sfx.hammer(spot.p); G.toast?.(`Patched ${fixed} blocks.`); }
  }
  repairSpot(eye, dir) {
    for (const s of G.ships) {
      if (s.sunk || Math.hypot(s.x - eye.x, s.z - eye.z) > s.hl + 5) continue;
      const h = s.raycast(eye, dir, 3.2);
      const lim = h ? Math.min(3.2, h.dist + 0.4) : 3.2;
      for (let t = 0.3; t <= lim; t += 0.12) {
        const p = eye.clone().addScaledVector(dir, t);
        if (s.missingNear(p, 0.45)) return { ship: s, p };
      }
    }
    return null;
  }

  // ---------- stations ----------
  updateWheel() {
    const s = this.station;
    this.swimming = this.inSea = this.underwater = false; this.underKind = null;
    this.pos.copy(s.driverLp);
    if (hit('forward')) s.throttle = Math.min(3, s.throttle + 1);
    if (hit('back')) s.throttle = Math.max(-1, s.throttle - 1);
    s.rudderIn = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    if (hit('view')) this.chase = !this.chase;
    this.prompt = `⚓ ${THROTTLE[s.throttle + 1]}  ·  ${kn('forward')}/${kn('back')} speed  ·  ${kn('left')}/${kn('right')} steer  ·  ${kn('view')} camera  ·  ${kn('crane')} crane  ·  ${kn('use')} let go`;
    if (hit('crane')) { this.mode = 'crane'; s.crane.user = this; s.rudderIn = 0; }
    if (hit('use')) this.leaveStation();
  }
  async updateCrane(dt, sens) {
    const s = this.station, cr = s.crane;
    this.pos.copy(s.driverLp);
    cr.yaw -= IN.mdx * sens * 0.8;
    if (down('left')) cr.yaw += dt * 1.1;
    if (down('right')) cr.yaw -= dt * 1.1;
    if (down('forward')) cr.reach = Math.min(8.5, cr.reach + dt * 2.5);
    if (down('back')) cr.reach = Math.max(2.5, cr.reach - dt * 2.5);
    if (down('craneDown')) cr.drop = Math.min(cr.boomH + s.deckTop + 1.5, cr.drop + dt * 3);
    if (down('craneUp')) cr.drop = Math.max(0.6, cr.drop - dt * 3);
    if ((down('left') || down('right') || down('craneDown') || down('craneUp')) && Math.random() < dt * 8) sfx.crane();
    const hook = s.hookWorld(v1);
    let near = null;
    for (const c of G.crates) {
      if (c.state === 'fall' || c.state === 'hook') continue;
      if (crateWorld(c, v2).distanceTo(hook) < 1.8) { near = c; break; }
    }
    const holding = isGuest() ? G.crates.some(c => c.state === 'hook' && c.wp.distanceTo(hook) < 2) : !!cr.held;
    this.prompt = `🏗️ Crane · ${kn('left')}/${kn('right')} turn · ${kn('forward')}/${kn('back')} reach · ${kn('craneDown')} lower · ${kn('craneUp')} raise · ${kn('grab')} ${holding ? 'release' : near ? 'GRAB' : 'grab'} · ${kn('crane')} back to the helm`;
    if (hit('crane')) { this.mode = 'wheel'; cr.user = null; return; }
    if (hit('grab')) {
      if (isGuest()) { const r = await act('grab', s.id); if (r) sfx[r === 'grabbed' ? 'pickup' : 'wood'](); }
      else if (cr.held) { releaseCrate(cr.held); cr.held = null; sfx.wood(); }
      else if (near) { hookCrate(near, s); cr.held = near; sfx.pickup(); }
    }
  }
  updateCannon(dt, sens) {
    const { ship: s, c } = this.station;
    this.swimming = this.inSea = this.underwater = false; this.underKind = null;
    this.pos.copy(c.lp).add(v1.set(-c.side * 1.0, 0, 0));
    c.yaw = clamp(c.yaw + IN.mdx * sens * 0.7 * c.side, -0.75, 0.75);
    c.pitch = clamp(c.pitch - IN.mdy * sens * 0.7 * (S.invertY ? -1 : 1), -0.12, 0.5);
    const [pos, dir] = s.cannonMuzzle(c);
    const vel = dir.clone().multiplyScalar(62).add(s.velocity(v2)); vel.y -= s.vy;
    this.aim.geometry.setFromPoints(arcPoints(pos, vel)); this.aim.computeLineDistances(); this.aim.visible = true;
    if (IN.lmbHit && !fireCannon(s, c, this, this.skill === 'gunner' ? 0.65 : 1)) G.toast?.('Reloading…');
    this.prompt = `💥 Deck gun · mouse aim · LMB fire${c.cd > 0 ? ` (reloading ${c.cd.toFixed(1)}s)` : ''} · ${kn('use')} leave`;
    if (hit('use')) this.leaveStation();
  }

  // ---------- camera ----------
  updateCamera(cam) {
    const shake = G.shake || 0;
    if (this.mode === 'crane') {
      const s = this.station, cr = s.crane;
      cam.position.copy(s.toWorld(v2.set(cr.base.x - Math.sin(cr.yaw) * 3, cr.base.y + cr.boomH + 4, cr.base.z - Math.cos(cr.yaw) * 3)));
      cam.lookAt(s.hookWorld(v3));
    } else if (this.mode === 'cannon') {
      const { ship: s, c } = this.station;
      const [pos, dir] = s.cannonMuzzle(c, v1, v2);
      cam.position.copy(pos).addScaledVector(dir, -3.6); cam.position.y += 1.3;
      cam.lookAt(v3.copy(pos).addScaledVector(dir, 30));
    } else if (this.mode === 'wheel' && this.chase) {
      // chase camera behind and above the ship, mouse looks around
      const s = this.station, d = s.hl * 1.6 + 10;
      const a = s.yaw + this.yaw - Math.PI;
      cam.position.set(s.x - Math.sin(a) * d, s.y + s.deckTop + 6 + s.hl * 0.25 - this.pitch * 10, s.z - Math.cos(a) * d);
      cam.position.y = Math.max(cam.position.y, waveHeight(cam.position.x, cam.position.z) + 2);
      cam.lookAt(s.x + Math.sin(a) * 10, s.y + s.deckTop + 2, s.z + Math.cos(a) * 10);
    } else if (!this.alive && this.out && G.game?.spectate) {
      G.game.spectate(cam);
    } else {
      this.eyeWorld(cam.position);
      if (!this.alive) cam.position.y -= 1.0;
      cam.rotation.set(this.pitch, this.worldYaw(), 0, 'YXZ');
    }
    if (shake > 0) { cam.position.x += rand(-1, 1) * shake * 0.12; cam.position.y += rand(-1, 1) * shake * 0.12; }
    const st = this.mode === 'walk' ? this.gun.stats() : null;
    const zoom = st ? lerp(1, st.zoom, this.gun.ads) : 1;
    const fov = S.fov / zoom;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.scoped = !!(st && st.scoped && this.gun.ads > 0.9);
  }
  stationShip() { return this.mode === 'wheel' || this.mode === 'crane' ? this.station : this.mode === 'cannon' ? this.station.ship : this.frame; }
}

// ---------- crate loot ----------
export function openCrate(c, p) {
  removeCrate(c);
  G.game?.onCrateOpened?.(c);
  if (c.loot === 'planks') {
    const s = p.frame || p.home;
    if (s && s.storage) { s.storage.planks = Math.min(12, s.storage.planks + 3); updateStorage(s); }
  }
  applyLoot(c.loot, p);
}
export function applyLoot(loot, p) {
  sfx.pickup();
  if (loot === 'ammo') { for (const k of ['primary', 'secondary']) { const s = p.inv[k]; s.reserve = WEAPONS[s.id].reserve; s.mag = s.magMax; } if (p.inv.gadget) p.inv.gadget.count = Math.max(p.inv.gadget.count, WEAPONS[p.inv.gadget.id].count); }
  else if (loot === 'health') p.hp = 100;
  else if (loot === 'weapon') {
    const id = PRIMARIES.filter(w => w !== p.inv.primary.id)[Math.random() * (PRIMARIES.length - 1) | 0];
    p.inv.primary = gunState(id, {}); p.slot = 'primary';
    return G.toast?.(`🎁 You found a ${WEAPONS[id].name}!`, 'good');
  } else if (loot === 'planks') return G.toast?.('🪵 +3 planks in the ship\'s storage.', 'good');
  else if (loot === 'c4') p.inv.gadget = { id: 'c4', count: (p.inv.gadget?.id === 'c4' ? p.inv.gadget.count : 0) + 2 };
  else if (loot === 'airstrike') { p.inv.special = { id: 'flare', count: 1 }; return G.toast?.(`✈️ Airstrike flare! Press ${kn('slot4')}, then throw it at a target.`, 'good'); }
  else if (loot === 'nuke') { p.inv.special = { id: 'nuke', count: 1 }; return G.toast?.(`☢️ NUKE REMOTE! Press ${kn('slot4')}, aim far away and click. Then RUN.`, 'good'); }
  G.toast?.(`${LOOT[loot]}!`, 'good');
}
export { gunStats };
