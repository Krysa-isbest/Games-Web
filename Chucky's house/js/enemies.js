// Enemies. The host runs the AI; guests only mirror positions/animation states.
// Skulls (difficulty) scale hp, damage, speed, senses, and make stuns shorter.
import * as THREE from 'three';
import { clamp, rand } from './state.js';
import { part } from './data.js';
import { makePerson, animatePerson, poseArms } from './people.js';
import { makeDog, makeRat, animateQuad } from './creatures.js';
import { free, los, bfs, tileOf, randomOpenNear, MAP } from './maps.js';
import { sfx } from './sfx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE = {
  homeless: { name: 'Homeless person', hp: 40, run: 3.0, walk: 1.1, dmg: 10, vision: 8, hear: 8, reach: 1.25, cd: 1.4 },
  rat: { name: 'Rat', hp: 12, run: 4.4, walk: 1.4, dmg: 4, vision: 6, hear: 5, reach: 0.75, cd: 0.9 },
  dog: { name: 'Junkyard dog', hp: 30, run: 5.6, walk: 1.6, dmg: 9, vision: 11, hear: 14, reach: 1.1, cd: 1.0 },
  guard: { name: 'Junkyard owner', hp: 85, run: 2.6, walk: 1.3, dmg: 42, vision: 20, hear: 16, reach: 18, cd: 1.7 },
};
// Stuns are shorter the more skulls tonight has.
export const stunMult = s => 1 / (0.7 + s * 0.3);

function shotgunMesh() {
  const g = new THREE.Group();
  for (const x of [-0.015, 0.015]) part(g, new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8), 0x2a2a2e, x, 0, 0.35, { metalness: 0.7 }).rotation.x = Math.PI / 2;
  part(g, new THREE.BoxGeometry(0.06, 0.08, 0.4), 0x5a3a1a, 0, -0.03, -0.1);
  return g;
}

export function makeEnemy(E, kind, x, z, seed, extra = {}) {
  const s = E.skulls, b = BASE[kind], angry = E.ev.id === 'angry';
  let mesh;
  if (kind === 'homeless') mesh = makePerson({ ragged: true, seed });
  else if (kind === 'guard') {
    mesh = makePerson({ guard: true, seed });
    const gun = shotgunMesh(); gun.position.set(0.12, 1.25, 0.35); mesh.userData.body.add(gun); mesh.userData.gun = gun;
    const fl = new THREE.SpotLight(0xfff0d0, 22, 22, 0.35, 0.5, 1.2); fl.position.set(-0.2, 1.4, 0.3);
    fl.target.position.set(-0.2, 0.6, 6); mesh.add(fl, fl.target); mesh.userData.flash = fl;
  } else if (kind === 'dog') mesh = makeDog(seed);
  else mesh = makeRat();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = (seed % 628) / 100;
  E.scene.add(mesh);
  const hp = Math.round(b.hp * (0.8 + s * 0.25));
  const en = {
    id: E.enemies.length, kind, mesh, hp, maxHp: hp, st: 0,
    run: b.run * (0.95 + s * 0.05) * (angry ? 1.25 : 1), walk: b.walk, dmg: b.dmg * (0.8 + s * 0.2) * (angry ? 1.5 : 1),
    vision: b.vision * (0.9 + s * 0.08), hear: b.hear * (0.9 + s * 0.08), reach: b.reach, cdMax: b.cd,
    state: kind === 'guard' ? 'patrol' : 'wander', path: [], repath: 0, cd: 0, stun: 0, t: Math.random() * 10, lost: 0, idle: extra.idle ? 999 : rand(0, 3),
    atk: 0, shells: 2, aimT: 0, sniff: 0, wp: 0, patrol: extra.patrol || null, target: null, last: null, alerted: false,
  };
  E.enemies.push(en);
  return en;
}

// Deterministic spawn (same seed -> same enemies on every machine).
export function spawnEnemies(E, r) {
  const s = E.skulls, day = E.ev.id === 'day', sp = E.enemySpots;
  const seed = () => r() * 1e9 | 0;
  if (E.locId === 'alley') {
    const nH = Math.round((day ? 2.5 : 4) + s * 2.5);
    for (const [x, z] of sp.camps) for (let k = 0; k < 2 && E.enemies.length < nH; k++) makeEnemy(E, 'homeless', x + (r() - 0.5) * 2, z + (r() - 0.5) * 2, seed(), { idle: true });
    let f = 0;
    while (E.enemies.length < nH) { const [x, z] = sp.far[f++ % sp.far.length]; makeEnemy(E, 'homeless', x, z, seed()); }
    const packs = Math.round(1 + s * 1.5);
    for (let p = 0; p < packs; p++) {
      const [x, z] = sp.far[(f++ * 7) % sp.far.length];
      for (let k = 0; k < 3; k++) makeEnemy(E, 'rat', x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2, seed());
    }
  } else {
    makeEnemy(E, 'guard', sp.guard[0], sp.guard[1], seed(), { patrol: sp.patrol });
    const dogs = clamp(Math.round(1 + s), 2, 4);
    for (let k = 0; k < dogs; k++) { const [x, z] = sp.dogs[k % sp.dogs.length]; makeEnemy(E, 'dog', x + (r() - 0.5), z + (r() - 0.5), k); }
  }
}

function nextWaypoint(en) {
  const T = MAP.T;
  while (en.path.length) {
    const [i, j] = en.path[0];
    if (Math.hypot(i * T - en.mesh.position.x, j * T - en.mesh.position.z) < 0.4) en.path.shift();
    else return V(i * T, 0, j * T);
  }
  return null;
}
function step(en, goal, speed, dt) {
  const m = en.mesh, g = V(goal.x - m.position.x, 0, goal.z - m.position.z), gl = g.length();
  if (gl < 0.1) return false;
  m.rotation.y = Math.atan2(g.x, g.z);
  const v = g.normalize().multiplyScalar(Math.min(gl, speed * dt)), r = en.kind === 'rat' ? 0.12 : 0.3;
  if (free(m.position.x + v.x, m.position.z, r)) m.position.x += v.x;
  if (free(m.position.x, m.position.z + v.z, r)) m.position.z += v.z;
  return true;
}

// Something loud happened: everything in range comes to look.
export function noise(E, x, z, radius) {
  for (const en of E.enemies) {
    if (en.dead || en.stun > 0 || en.state === 'chase') continue;
    if (Math.hypot(en.mesh.position.x - x, en.mesh.position.z - z) < radius) { en.state = 'search'; en.last = V(x, 0, z); en.path = []; en.repath = 0; }
  }
}

// players: [{ pid, pos, down, hidden, hideId, run, crouch, light }]
// cb: { hurt(pid, n), fx(kind, data), found(pid) }
export function updateEnemiesHost(E, dt, players, cb) {
  for (const en of E.enemies) {
    const m = en.mesh, body = m.userData.body;
    if (en.dead) { en.st = 4; fall(en, dt); continue; }
    en.cd -= dt; en.atk = Math.max(0, en.atk - dt);
    if (en.stun > 0) { en.stun -= dt; en.st = 3; if (body) body.rotation.z = Math.sin(performance.now() * 0.02) * 0.15; if (en.stuck) en.stuck -= dt; continue; }
    if (en.stuck > 0) { en.stuck -= dt; en.st = 3; continue; }
    if (body) body.rotation.z = 0;
    // senses
    let best = null, bd = 1e9, seen = false;
    for (const p of players) {
      if (p.down) continue;
      const d = Math.hypot(p.pos.x - m.position.x, p.pos.z - m.position.z);
      const visR = en.vision * (p.light ? 1.35 : 1) * (p.crouch ? 0.7 : 1) * (E.ev.id === 'fog' ? 0.6 : E.ev.id === 'day' ? 1.4 : 1);
      const sees = !p.hidden && d < visR && los(m.position, p.pos);
      const hears = !p.hidden && d < en.hear * (p.run ? 1 : p.crouch ? 0.2 : 0.4);
      const sniff = p.hidden && en.kind === 'dog' && d < 2.6;
      // it saw you a moment before you got in: it knows where you are
      const sawHide = p.hidden && en.target === p.pid && performance.now() - (en.seenAt || 0) < 1500 + (en.state === 'chase' ? 2500 : 0) && d < 8;
      if (sniff) { en.sniff += dt; if (en.sniff > 3) { en.sniff = 0; cb.found(p.pid); sfx.bark(0.7); } }
      if (sawHide && d < 1.6) { cb.found(p.pid); en.seenAt = performance.now(); }
      if ((sees || hears || sawHide) && d < bd) { bd = d; best = p; seen = sees || sawHide; }
    }
    if (best) {
      if (en.state !== 'chase' && en.state !== 'aim') {
        en.state = 'chase';
        if (en.kind === 'dog') { cb.fx('bark', { x: m.position.x, z: m.position.z }); for (const o of E.enemies) if (o.kind === 'guard' && !o.dead && o.state !== 'chase') { o.state = 'search'; o.last = best.pos.clone(); o.path = []; } }
        else if (en.kind === 'guard') cb.fx('hey', { x: m.position.x, z: m.position.z });
        else if (en.kind === 'homeless') cb.fx('grunt', { x: m.position.x, z: m.position.z });
      }
      en.target = best.pid; en.last = best.pos.clone(); en.lost = 0; en.idle = 0;
      if (seen && !best.hidden) en.seenAt = performance.now();
    } else if (en.state === 'chase') en.lost += dt;

    let goal = null, speed = en.walk, moving = false;
    const tp = players.find(p => p.pid === en.target);
    if (en.state === 'chase' || en.state === 'aim') {
      speed = en.run;
      if (en.lost > (en.kind === 'dog' ? 10 : 7) || !tp || tp.down) { en.state = en.kind === 'guard' ? 'patrol' : 'wander'; en.path = []; en.target = null; }
      else if (en.kind === 'guard') {
        const d = Math.hypot(tp.pos.x - m.position.x, tp.pos.z - m.position.z);
        const canShoot = seen && d < en.reach;
        if (canShoot) {
          m.rotation.y = Math.atan2(tp.pos.x - m.position.x, tp.pos.z - m.position.z);
          if (en.shells <= 0) { if ((en.aimT += dt) > 2.8) { en.shells = 2; en.aimT = 0; sfx.click2(); } }
          else if (en.state !== 'aim') { en.state = 'aim'; en.aimT = 0; }
          else if ((en.aimT += dt) > 0.9 && en.cd <= 0) {
            en.cd = en.cdMax; en.shells--; en.aimT = 0.3; en.atk = 0.3;
            const hit = Math.random() < 0.8 * (1 - d / 30) * (tp.crouch ? 0.75 : 1) * (tp.run ? 0.8 : 1);
            const dmg = Math.round(en.dmg * clamp(1.2 - d / 15, 0.25, 1));
            cb.fx('shot', { x: m.position.x, z: m.position.z, tx: tp.pos.x, tz: tp.pos.z });
            if (hit) cb.hurt(tp.pid, dmg);
            noise(E, m.position.x, m.position.z, 25);
          }
          if (d > 10) goal = tp.pos;
        } else {
          if (en.state === 'aim') en.state = 'chase';
          if ((en.repath -= dt) <= 0) { en.repath = 0.6; en.path = bfs(tileOf(m.position), tileOf(en.last)); }
          goal = nextWaypoint(en) || en.last;
        }
      } else {
        const d = Math.hypot(tp.pos.x - m.position.x, tp.pos.z - m.position.z);
        if (d < en.reach && seen) {
          m.rotation.y = Math.atan2(tp.pos.x - m.position.x, tp.pos.z - m.position.z);
          if (en.cd <= 0) { en.cd = en.cdMax; en.atk = 0.4; cb.hurt(tp.pid, Math.round(en.dmg)); if (en.kind === 'dog') sfx.bark(0.6); }
        } else if (seen) goal = tp.pos;
        else {
          if ((en.repath -= dt) <= 0) { en.repath = 0.6; en.path = bfs(tileOf(m.position), tileOf(en.last)); }
          goal = nextWaypoint(en) || en.last;
        }
      }
    } else if (en.state === 'search') {
      speed = (en.walk + en.run) / 2;
      if ((en.repath -= dt) <= 0 && !en.path.length) { en.repath = 1; en.path = bfs(tileOf(m.position), tileOf(en.last)); }
      goal = nextWaypoint(en);
      if (!goal && Math.hypot(en.last.x - m.position.x, en.last.z - m.position.z) < 1.5) { en.state = en.kind === 'guard' ? 'patrol' : 'wander'; en.idle = rand(2, 4); }
      else if (!goal) goal = en.last;
    } else if (en.state === 'patrol') {
      const wp = en.patrol[en.wp % en.patrol.length], w = V(wp[0], 0, wp[1]);
      if (Math.hypot(w.x - m.position.x, w.z - m.position.z) < 1) { en.wp++; en.path = []; en.idle = rand(1, 3); }
      if (en.idle > 0) en.idle -= dt;
      else {
        if (!en.path.length) en.path = bfs(tileOf(m.position), tileOf(w));
        goal = nextWaypoint(en) || w;
      }
    } else {
      if (!en.path.length) {
        if (en.idle > 0) en.idle -= dt;
        else { en.path = bfs(tileOf(m.position), randomOpenNear(tileOf(m.position), en.kind === 'rat' ? 2 : 4)); en.idle = rand(1, 4); }
      }
      goal = nextWaypoint(en);
    }
    if (goal) moving = step(en, goal, speed, dt);
    en.st = en.state === 'aim' || en.atk > 0 ? 5 : moving ? (speed > en.walk * 1.2 ? 2 : 1) : 0;
    animate(en, dt);
  }
}

function fall(en, dt) {
  en.fall = Math.min(1, (en.fall || 0) + dt * 3);
  en.mesh.rotation.x = -en.fall * Math.PI / 2 * (en.kind === 'dog' || en.kind === 'rat' ? 0 : 1);
  if (en.kind === 'dog' || en.kind === 'rat') en.mesh.rotation.z = en.fall * Math.PI / 2;
  if (en.mesh.userData.flash) en.mesh.userData.flash.intensity = 0;
}

// Animation from the state only (so guests animate the same way).
export function animate(en, dt) {
  const m = en.mesh, st = en.st;
  if (st === 4) return fall(en, dt);
  const speed = st === 2 ? en.run : en.walk;
  en.t += dt * (st === 1 || st === 2 ? speed * (en.kind === 'rat' ? 6 : en.kind === 'dog' ? 3.5 : 3) : 0);
  if (en.kind === 'dog' || en.kind === 'rat') {
    animateQuad(m, en.t, st === 1 || st === 2, st === 2 ? 1.3 : 0.8);
    if (m.userData.jaw) m.userData.jaw.rotation.x = st === 5 ? 0.5 : 0;
  } else {
    animatePerson(m, en.t, st === 1 || st === 2, st === 2 ? 1.2 : 0.8);
    if (en.kind === 'guard') { poseArms(m, -1.35, -0.4); m.userData.gun.rotation.x = st === 5 ? -0.05 : 0.5; }
    else if (st === 2 || st === 5) poseArms(m, -1.3 - (st === 5 ? Math.sin(performance.now() * 0.03) * 0.5 : 0), -0.2);
  }
  if (st === 3 && m.userData.body) m.userData.body.rotation.z = Math.sin(performance.now() * 0.02) * 0.15;
  else if (m.userData.body) m.userData.body.rotation.z = 0;
}

// ---------- co-op mirror ----------
export const enemySnap = E => E.enemies.map(en => [en.id, +en.mesh.position.x.toFixed(2), +en.mesh.position.z.toFixed(2), +en.mesh.rotation.y.toFixed(2), en.st]);
export function mirrorEnemies(E, list) {
  for (const [id, x, z, ry, st] of list) {
    const en = E.enemies[id];
    if (!en) continue;
    en.tgt = [x, z, ry]; en.st = st;
    if (st === 4) en.dead = true;
  }
}
export function lerpEnemies(E, dt) {
  const k = Math.min(1, dt * 10);
  for (const en of E.enemies) {
    if (en.tgt) {
      const m = en.mesh;
      m.position.x += (en.tgt[0] - m.position.x) * k; m.position.z += (en.tgt[1] - m.position.z) * k;
      if (en.st !== 4) m.rotation.y = en.tgt[2];
    }
    animate(en, dt);
  }
}
