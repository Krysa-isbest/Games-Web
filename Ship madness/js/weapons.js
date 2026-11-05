// Guns (with arms, animations and attachments), hitscan, cannonballs, grenades, C4, airstrikes and the nuke.
import * as THREE from 'three';
import { G, P, rand, clamp, damp, isGuest, isHost, nextId } from './state.js';
import { waveHeight, SKY } from './ocean.js';
import { groundHeight } from './islands.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';
import { IN } from './input.js';
import { hit } from './keys.js';

// att = attachment slots the gun accepts
export const WEAPONS = {
  pistol: { name: 'Pistol', slot: 'secondary', dmg: 26, rate: 0.17, mag: 12, reserve: 84, spread: 0.012, vox: 1, range: 120, reload: 1.2, kick: 0.03, att: ['optic', 'muzzle', 'mag'] },
  revolver: { name: 'Revolver', slot: 'secondary', dmg: 58, rate: 0.42, mag: 6, reserve: 36, spread: 0.007, vox: 2, range: 150, reload: 2.2, kick: 0.075, att: ['optic'] },
  smg: { name: 'SMG', slot: 'primary', dmg: 15, rate: 0.065, mag: 32, reserve: 224, spread: 0.03, auto: true, vox: 1, range: 80, reload: 1.8, kick: 0.013, att: ['optic', 'muzzle', 'mag', 'grip'] },
  ak: { name: 'AK', slot: 'primary', dmg: 24, rate: 0.1, mag: 30, reserve: 180, spread: 0.018, auto: true, vox: 1, range: 170, reload: 2.3, kick: 0.022, att: ['optic', 'muzzle', 'mag', 'grip'] },
  lmg: { name: 'LMG', slot: 'primary', dmg: 22, rate: 0.08, mag: 75, reserve: 225, spread: 0.028, auto: true, vox: 1, range: 160, reload: 4, kick: 0.02, slow: 0.85, att: ['optic', 'grip'] },
  shotgun: { name: 'Shotgun', slot: 'primary', dmg: 12, pellets: 9, rate: 0.85, mag: 6, reserve: 42, spread: 0.075, vox: 1, range: 40, reload: 0.45, shells: true, kick: 0.08, att: ['muzzle', 'grip'] },
  sniper: { name: 'Sniper', slot: 'primary', dmg: 115, rate: 1.3, mag: 5, reserve: 35, spread: 0.0012, scope: 7, vox: 3, range: 450, reload: 2.8, kick: 0.1, att: ['muzzle', 'mag'] },
  grenade: { name: 'Grenades', slot: 'gadget', count: 3 },
  c4: { name: 'C4', slot: 'gadget', count: 3 },
  flare: { name: 'Airstrike flare', slot: 'special' },
  nuke: { name: 'Nuke remote', slot: 'special' },
};
export const PRIMARIES = ['smg', 'ak', 'lmg', 'shotgun', 'sniper'];
export const SECONDARIES = ['pistol', 'revolver'];
export const GADGETS = ['grenade', 'c4'];
export const ATTACH = {
  reddot: { name: 'Red dot sight', slot: 'optic', zoom: 1.3, desc: 'Cleaner aim, a little zoom.' },
  scope4: { name: '4× scope', slot: 'optic', zoom: 4, scope: true, desc: 'Long range zoom.' },
  suppressor: { name: 'Suppressor', slot: 'muzzle', desc: 'Much quieter, smaller flash.' },
  comp: { name: 'Compensator', slot: 'muzzle', kick: 0.6, desc: '40 % less recoil.' },
  extmag: { name: 'Extended mag', slot: 'mag', desc: '+50 % ammo per mag, slower reload.' },
  grip: { name: 'Vertical grip', slot: 'grip', desc: 'Tighter spread, less recoil.' },
};
export const attachFits = (wid, aid) => WEAPONS[wid]?.att?.includes(ATTACH[aid].slot) && !(aid === 'scope4' && !['ak', 'smg', 'lmg'].includes(wid));

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

// ---------- hitscan ----------
// targets (players, bots, sharks): hitTest(origin, dir, max) -> {dist, head} | null, hurt(amount, by, kind), center(out)
export function targets() { return [...G.players, ...G.bots, ...G.sharks].filter(t => t.alive !== false); }

export function insideAnyHull(p) {
  for (const s of G.ships) { if (s.sunk) continue; const lp = s.toLocal(tmp2.copy(p)); if (s.insideHull(lp)) return s; }
  return null;
}
export function waterHit(origin, dir, max) {
  if (dir.y >= -1e-4) return null;
  if (origin.y < waveHeight(origin.x, origin.z)) return null;
  let t = (0 - origin.y) / dir.y;
  for (let i = 0; i < 3; i++) { const p = tmp.copy(origin).addScaledVector(dir, t); t = (waveHeight(p.x, p.z) - origin.y) / dir.y; }
  if (t < 0 || t > max) return null;
  const point = origin.clone().addScaledVector(dir, t);
  if (insideAnyHull(point)) return null;
  return { kind: 'water', dist: t, point };
}
export function hitscan(origin, dir, max, ignore = null) {
  let best = null;
  for (const s of G.ships) {
    if (s.gone) continue;
    if (Math.hypot(s.x - origin.x, s.z - origin.z) > max + s.hl + 5) continue;
    const h = s.raycast(origin, dir, best ? best.dist : max);
    if (h && (!best || h.dist < best.dist)) best = { kind: 'ship', ...h };
  }
  for (const t of targets()) {
    if (t === ignore) continue;
    const d = t.hitTest(origin, dir, best ? best.dist : max);
    if (d != null && (!best || d.dist < best.dist)) best = { kind: 'target', target: t, dist: d.dist, head: d.head, point: origin.clone().addScaledVector(dir, d.dist) };
  }
  const w = waterHit(origin, dir, best ? best.dist : max);
  if (w) best = w;
  const lim = best ? best.dist : max;
  for (let t = 1; t < lim; t += 2) {
    const p = tmp.copy(origin).addScaledVector(dir, t);
    if (groundHeight(p.x, p.z) > p.y) { best = { kind: 'ground', dist: t, point: p.clone() }; break; }
  }
  return best;
}
export function bulletImpact(hit, dmg, vox, by) {
  if (!hit) return 0;
  if (hit.kind === 'ship') {
    if (isGuest()) G.netHit('cell', hit.ship.id, hit.n, vox); else hit.ship.damageCell(hit.n, vox, by);
    const col = new THREE.Color(); hit.ship.mesh.getColorAt(hit.ship.inst[hit.n], col);
    if (Math.random() < 0.5) FX.debris(hit.point.x, hit.point.y, hit.point.z, col, 0.35);
    FX.dust(hit.point.x, hit.point.y, hit.point.z, col);
    sfx.wood(hit.point);
  } else if (hit.kind === 'target') {
    const t = hit.target, amount = dmg * (hit.head ? 2 : 1);
    if (t.isPlayer && by?.isPlayer && !G.ff) return 0;       // no friendly fire
    if (isGuest() && !t.isRemote) G.netHit(t.isShark ? 'shark' : 'bot', t.id, amount, 'bullet');
    else t.hurt(amount, by, 'bullet');
    if (!t.isShark) FX.blood(hit.point.x, hit.point.y, hit.point.z);
    return hit.head ? 2 : 1;
  } else if (hit.kind === 'water') FX.splash(hit.point.x, hit.point.y, hit.point.z, 0.2);
  else FX.dust(hit.point.x, hit.point.y, hit.point.z, new THREE.Color('#9a8a6a'));
  return 0;
}

// ---------- explosions ----------
// on guests (or with visualOnly) an explosion is only fire and smoke: the host does the damage
export function explode(pos, { r = 2, power = 6, dmg = 100, owner = null, sound = true, fire = 0.3, fromProj = false, visualOnly = false } = {}) {
  if (!visualOnly && !isGuest()) {
    for (const s of G.ships) if (!s.gone && Math.hypot(s.x - pos.x, s.z - pos.z) < s.hl + r + 2) s.damageSphere(pos, r, power, owner, pos.y > waveHeight(pos.x, pos.z) + 0.3 ? fire : 0);
    for (const t of targets()) {
      const c = t.center(tmp);
      const d = c.distanceTo(pos), R = r * 2.6;
      if (d >= R) continue;
      if (t.isShark) t.stun(8, pos);
      else if (!(t.isPlayer && owner?.isPlayer && owner !== t && !G.ff)) t.hurt(dmg * (1 - d / R), owner, 'boom', pos);
    }
    if (isHost() && !fromProj) G.netFx?.({ k: 'boom', p: [pos.x, pos.y, pos.z], r });
  }
  FX.explosion(pos.x, pos.y, pos.z, r);
  if (sound) sfx.boom(pos, r / 2);
}

// ---------- projectiles ----------
const PROJ = [];
const ballGeo = new THREE.SphereGeometry(0.2, 10, 8);
const ballMat = new THREE.MeshStandardMaterial({ color: '#1b1b1d', metalness: 0.7, roughness: 0.4 });
const flareMat = new THREE.MeshBasicMaterial({ color: '#ff3b2e' });
const bombMat = new THREE.MeshStandardMaterial({ color: '#4a5240', metalness: 0.5, roughness: 0.5 });
const nadeMat = new THREE.MeshStandardMaterial({ color: '#3f4a2c', roughness: 0.6 });
const shellMat = new THREE.MeshStandardMaterial({ color: '#c9a03c', metalness: 0.8, roughness: 0.3 });

export function fireCannon(ship, c, owner, reloadMul = 1) {
  if (c.cd > 0) return false;
  if (isGuest()) {       // the host fires it; we only predict the reload
    c.cd = 2.6 * reloadMul;
    G.netAct?.('fireCannon', ship.id, ship.cannons.indexOf(c), c.yaw, c.pitch, reloadMul);
    return true;
  }
  c.cd = (owner?.isBot ? 4.5 : 2.6) * reloadMul;
  const [pos, dir] = ship.cannonMuzzle(c);
  const vel = dir.clone().multiplyScalar(62).add(ship.velocity(tmp));
  vel.y -= ship.vy;
  addProjectile('ball', pos, vel, owner);
  for (let i = 0; i < 8; i++) FX.smoke(pos.x + dir.x * i * 0.3, pos.y, pos.z + dir.z * i * 0.3, 1.1);
  FX.flash(pos.x, pos.y, pos.z, 14);
  sfx.cannon(pos);
  G.netFx?.({ k: 'cannon', p: [pos.x, pos.y, pos.z], d: [dir.x, dir.y, dir.z] });
  if (G.me && G.camera.position.distanceTo(pos) < 6) G.shake = Math.max(G.shake || 0, 0.5);
  return true;
}
export function addProjectile(kind, pos, vel, owner, extra = {}) {
  const geo = kind === 'bomb' ? new THREE.CylinderGeometry(0.25, 0.25, 1.4, 8) : kind === 'grenade' ? new THREE.SphereGeometry(0.07, 8, 6) : ballGeo;
  const mesh = new THREE.Mesh(geo, kind === 'flare' ? flareMat : kind === 'bomb' ? bombMat : kind === 'grenade' ? nadeMat : kind === 'ball' ? shellMat : ballMat);
  if (kind === 'flare') mesh.scale.setScalar(0.5);
  if (kind === 'ball') mesh.scale.set(0.6, 0.6, 1.4);
  mesh.position.copy(pos); mesh.castShadow = true;
  G.scene.add(mesh);
  PROJ.push({ kind, pos: pos.clone(), vel: vel.clone(), owner, mesh, life: kind === 'grenade' ? 2.6 : 12, ...extra });
  if (isHost()) G.netFx?.({ k: 'proj', kind, p: [pos.x, pos.y, pos.z], v: [vel.x, vel.y, vel.z] });
}
export function arcPoints(pos, vel, n = 60) {
  const pts = [], p = pos.clone(), v = vel.clone();
  for (let i = 0; i < n; i++) {
    pts.push(p.clone());
    v.y -= 9.8 * 0.08; p.addScaledVector(v, 0.08);
    if (p.y < waveHeight(p.x, p.z)) { pts.push(p.clone()); break; }
  }
  return pts;
}
export function updateProjectiles(dt) {
  for (let i = PROJ.length - 1; i >= 0; i--) {
    const pr = PROJ[i];
    const vis = pr.visual || isGuest();
    pr.life -= dt;
    if (pr.kind === 'grenade' && pr.life <= 0) { explode(pr.pos, { r: 1.6, power: 6, dmg: 120, owner: pr.owner, fire: 0.15, fromProj: true, visualOnly: vis }); G.scene.remove(pr.mesh); PROJ.splice(i, 1); continue; }
    const prev = pr.pos.clone();
    pr.vel.y -= (pr.kind === 'bomb' ? 4 : 9.8) * dt;
    pr.pos.addScaledVector(pr.vel, dt);
    const seg = tmp.copy(pr.pos).sub(prev), len = seg.length();
    const dir = seg.clone().divideScalar(len || 1);
    let hit = null;
    for (const s of G.ships) {
      if (s.gone || Math.hypot(s.x - prev.x, s.z - prev.z) > s.hl + len + 3) continue;
      const h = s.raycast(prev, dir, len);
      if (h && (!hit || h.dist < hit.dist)) hit = h;
    }
    if (pr.kind === 'ball' && !vis) for (const t of targets()) {
      if (t.isShark) continue;
      const d = t.hitTest(prev, dir, hit ? hit.dist : len);
      if (d) hit = { dist: d.dist, point: prev.clone().addScaledVector(dir, d.dist), target: t };
    }
    if (pr.kind === 'flare') FX.fire(pr.pos.x, pr.pos.y, pr.pos.z, 0.5);
    if (pr.kind === 'bomb') FX.smoke(pr.pos.x, pr.pos.y + 0.8, pr.pos.z, 0.3);
    if (pr.kind === 'ball' && Math.random() < 0.6) FX.smoke(pr.pos.x, pr.pos.y, pr.pos.z, 0.25);
    const sea = waveHeight(pr.pos.x, pr.pos.z);
    const gr = groundHeight(pr.pos.x, pr.pos.z);
    let done = false;
    if (pr.kind === 'grenade') {
      if (hit) { pr.pos.copy(hit.point).addScaledVector(hit.normal, 0.08); const n = hit.normal; const vn = pr.vel.dot(n); pr.vel.addScaledVector(n, -1.6 * vn).multiplyScalar(0.45); if (Math.abs(vn) > 1.5) sfx.bounce(pr.pos); }
      else if (gr > pr.pos.y) { pr.pos.y = gr + 0.05; pr.vel.y = Math.abs(pr.vel.y) * 0.35; pr.vel.x *= 0.6; pr.vel.z *= 0.6; }
      else if (pr.pos.y < sea && !insideAnyHull(pr.pos)) { if (!pr.wet) { pr.wet = true; FX.splash(pr.pos.x, sea, pr.pos.z, 0.4); } pr.vel.multiplyScalar(0.85); pr.vel.y = Math.max(pr.vel.y, -1); }
      pr.mesh.position.copy(pr.pos);
      continue;
    }
    const boom = (p, o) => explode(p, { ...o, owner: pr.owner, fromProj: true, visualOnly: vis });
    if (hit) {
      const p = hit.point;
      if (pr.kind === 'ball') { if (hit.target && !vis) hit.target.hurt(90, pr.owner, 'cannon'); boom(p, { r: 1.3, power: 8, dmg: 70, fire: 0.25 }); }
      else if (pr.kind === 'bomb') boom(p, { r: 2.6, power: 10, dmg: 150, fire: 0.6 });
      else if (pr.kind === 'flare' && !vis) landFlare(p, hit.ship, pr.owner);
      done = true;
    } else if (pr.pos.y < sea && !insideAnyHull(pr.pos)) {
      if (pr.kind === 'bomb') boom(pr.pos, { r: 2.6, power: 10, dmg: 150 });
      else if (pr.kind === 'flare') { if (!vis) landFlare(pr.pos, null, pr.owner); }
      else { FX.splash(pr.pos.x, sea, pr.pos.z, 2.4); sfx.splash(pr.pos, 2); if (!vis) nearMissDamage(pr); }
      done = true;
    } else if (gr > pr.pos.y) {
      if (pr.kind === 'flare') { if (!vis) landFlare(pr.pos, null, pr.owner); }
      else boom(pr.pos, { r: pr.kind === 'bomb' ? 2.6 : 1.1, power: 1, dmg: pr.kind === 'bomb' ? 150 : 70 });
      done = true;
    }
    if (done || pr.life <= 0) { G.scene.remove(pr.mesh); PROJ.splice(i, 1); continue; }
    pr.mesh.position.copy(pr.pos);
    if (pr.kind === 'bomb' || pr.kind === 'ball') { pr.mesh.lookAt(tmp.copy(pr.pos).add(pr.vel)); if (pr.kind === 'bomb') pr.mesh.rotateX(Math.PI / 2); }
  }
}
function nearMissDamage(pr) {
  for (const s of G.ships) {
    if (s.gone) continue;
    const lp = s.toLocal(tmp2.copy(pr.pos));
    if (s.inBox(lp, 0.8)) s.damageSphere(pr.pos, 1.0, 5, pr.owner);
  }
}
export function clearProjectiles() { for (const p of PROJ) G.scene.remove(p.mesh); PROJ.length = 0; }

// ---------- airstrike ----------
const STRIKES = [];
function landFlare(p, ship, owner) {
  STRIKES.push({ t: 4, owner, ship, lp: ship ? ship.toLocal(p.clone()) : null, wp: p.clone(), bombs: 0, bt: 0 });
  G.announce?.('✈️ Airstrike inbound!', 'warn');
}
function strikePos(s, out) { return s.ship && !s.ship.sunk ? s.ship.toWorld(out.copy(s.lp)) : out.copy(s.wp); }
export function callAirstrike(p, owner) { landFlare(p, null, owner); }
function updateStrikes(dt) {
  for (let i = STRIKES.length - 1; i >= 0; i--) {
    const s = STRIKES[i];
    const p = strikePos(s, tmp);
    if (s.t > 0) {
      s.t -= dt;
      if (Math.random() < dt * 25) { FX.smoke(p.x, p.y + 0.3, p.z, 0.6); FX.fire(p.x, p.y + 0.2, p.z, 0.4); }
      if (s.t <= 0) { sfx.jet(); s.dir = rand(0, Math.PI * 2); }
      continue;
    }
    s.bt -= dt;
    if (s.bt <= 0 && s.bombs < 6) {
      s.bt = 0.18;
      const off = (s.bombs - 2.5) * 3.2;
      addProjectile('bomb', new THREE.Vector3(p.x + Math.cos(s.dir) * off + rand(-1, 1), p.y + 40, p.z + Math.sin(s.dir) * off + rand(-1, 1)), new THREE.Vector3(0, -40, 0), s.owner);
      s.bombs++;
    }
    if (s.bombs >= 6) STRIKES.splice(i, 1);
  }
}

// ---------- nuke ----------
// 15 s warning (red circle = certain death), then: white flash, a fireball that grows into a mushroom cloud,
// a shockwave racing over the water, a blast wave that shoves ships away, an orange sky and falling ash.
// The boom reaches you later the further away you are. Damage fades with distance.
export const NUKE_R = 50;
const NUKE_REACH = 120;
let ring = null;
const BLASTS = [];
function makeRing(x, z) {
  if (ring) G.scene.remove(ring);
  ring = new THREE.Mesh(new THREE.RingGeometry(NUKE_R - 1.5, NUKE_R, 96), new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 1.4, z);
  G.scene.add(ring);
}
export function armNuke(p, owner) {
  if (isGuest()) { G.netAct?.('nuke', [p.x, p.y, p.z]); return true; }
  if (G.nuke) return false;
  G.nuke = { x: p.x, z: p.z, t: 15, owner, siren: 0 };
  makeRing(p.x, p.z);
  G.announce?.('☢️ NUKE INCOMING! Get out of the red circle!', 'bad');
  G.netFx?.({ k: 'nuke', x: p.x, z: p.z, time: 15 });
  return true;
}
export function nukeVisual(x, z, t) { if (!isGuest()) return; G.nuke = { x, z, t, siren: 0, visual: true }; makeRing(x, z); }
export function nukeBoomVisual(x, z) { if (!isGuest()) return; blastVisual(x, z); if (ring) G.scene.remove(ring); ring = null; G.nuke = null; }

const glowMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const SKY0 = { h: null, z: null };
function blastVisual(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glowMat('#fff2c0'));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 1, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#5a4a40', emissive: '#ff5a1a', emissiveIntensity: 1, roughness: 1, transparent: true, side: THREE.DoubleSide }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: '#6b5a50', emissive: '#ff6a2a', emissiveIntensity: 1.2, roughness: 1, transparent: true }));
  const torus = new THREE.Mesh(new THREE.TorusGeometry(1, 0.42, 12, 32), cap.material);
  torus.rotation.x = Math.PI / 2;
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 128), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  shock.rotation.x = -Math.PI / 2; shock.position.y = 1.2;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: '#ffe8c0', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  const light = new THREE.PointLight('#ffb060', 8000, 900, 1.6);
  g.add(fire, stem, cap, torus, shock, dome, light);
  G.scene.add(g);
  G.flashScreen = 1;
  SKY0.h ??= SKY.horizon.clone(); SKY0.z ??= SKY.zenith.clone();
  BLASTS.push({ g, fire, stem, cap, torus, shock, dome, light, t: 0, x, z, boomed: false, ash: 25 });
  // the boom travels at the speed of sound
  const d = G.camera.position.distanceTo(new THREE.Vector3(x, 0, z));
  setTimeout(() => { sfx.boom(null, 4); sfx.thunder(); G.shake = Math.max(G.shake || 0, Math.max(0.4, 2 - d / 300)); }, Math.min(4000, d / 340 * 1000));
  for (let i = 0; i < 12; i++) FX.explosion(x + rand(-18, 18), rand(0, 10), z + rand(-18, 18), 6);
}
function updateBlasts(dt) {
  for (let i = BLASTS.length - 1; i >= 0; i--) {
    const b = BLASTS[i];
    b.t += dt;
    const t = b.t;
    // fireball: grows fast, then rises and cools into the cap
    const fr = Math.min(32, t * 40);
    b.fire.scale.setScalar(fr * Math.max(0.2, 1 - Math.max(0, t - 3) / 8));
    b.fire.position.y = 10 + Math.max(0, t - 0.8) * 9;
    b.fire.material.color.setHSL(0.11 - Math.min(0.1, t * 0.012), 1, Math.max(0.15, 0.85 - t * 0.06));
    b.fire.material.opacity = Math.max(0, 1 - t / 12);
    const capY = Math.min(115, 15 + t * 9);
    b.cap.position.y = capY; b.cap.scale.set(22 + Math.min(30, t * 3), 18 + Math.min(14, t * 1.4), 22 + Math.min(30, t * 3));
    b.torus.position.y = capY - 4; b.torus.scale.setScalar(26 + Math.min(32, t * 3.2));
    b.stem.scale.set(6 + Math.min(6, t * 0.6), capY, 6 + Math.min(6, t * 0.6)); b.stem.position.y = capY / 2;
    const glow = Math.max(0, 1.4 - t * 0.09);
    b.cap.material.emissiveIntensity = glow; b.stem.material.emissiveIntensity = glow * 0.8;
    const fade = t > 22 ? Math.max(0, 1 - (t - 22) / 8) : 1;
    b.cap.material.opacity = fade; b.stem.material.opacity = fade;
    const sr = Math.min(480, t * 130);
    b.shock.scale.setScalar(sr); b.shock.material.opacity = Math.max(0, 0.8 - t / 4);
    b.dome.scale.setScalar(Math.min(220, t * 260)); b.dome.material.opacity = Math.max(0, 0.35 - t * 0.4);
    b.light.intensity = Math.max(0, 8000 * (1 - t / 6));
    // smoke boiling off the cloud, fire in the stem
    if (fade > 0.3) {
      for (let k = 0; k < 4; k++) FX.smoke(b.x + rand(-1, 1) * (20 + t * 2), capY + rand(-8, 10), b.z + rand(-1, 1) * (20 + t * 2), 6, true);
      if (t < 10) for (let k = 0; k < 3; k++) FX.fire(b.x + rand(-6, 6), rand(2, capY * 0.6), b.z + rand(-6, 6), 5);
    }
    // the sky glows orange, then recovers
    const tint = Math.max(0, Math.min(1, t < 2 ? t / 2 : 1 - (t - 6) / 14));
    SKY.horizon.copy(SKY0.h).lerp(new THREE.Color('#ff8a40'), tint * 0.6);
    SKY.zenith.copy(SKY0.z).lerp(new THREE.Color('#b0503a'), tint * 0.45);
    // ash falls around the camera
    if (t > 3 && t < b.ash) { const c = G.camera.position; for (let k = 0; k < 3; k++) FX.ash(c.x + rand(-25, 25), c.y + rand(6, 18), c.z + rand(-25, 25)); }
    if (t > 32) {
      G.scene.remove(b.g); BLASTS.splice(i, 1);
      if (!BLASTS.length && SKY0.h) { SKY.horizon.copy(SKY0.h); SKY.zenith.copy(SKY0.z); }
    }
  }
}
function nukeDamage(n) {
  const c = new THREE.Vector3(n.x, 1, n.z);
  for (const s of G.ships) {
    if (s.gone) continue;
    const d = Math.max(0, Math.hypot(s.x - n.x, s.z - n.z) - s.hl * 0.5);
    // the blast wave shoves and rolls every ship nearby
    if (d < 260) {
      const k = (1 - d / 260) * 16, dx = (s.x - n.x) / (d + 1), dz = (s.z - n.z) / (d + 1);
      s.kx = (s.kx || 0) + dx * k; s.kz = (s.kz || 0) + dz * k;
      s.vr += rand(-1, 1) * k * 0.05; s.vp += rand(-1, 1) * k * 0.03; s.vy += k * 0.3;
    }
    if (d > NUKE_REACH) continue;
    const hard = d < 30 ? 1 : d < 70 ? 0.55 : 0.25;
    const n2 = Math.round(2 + hard * 5);
    for (let i = 0; i < n2; i++) s.damageSphere(tmp.set(s.x + rand(-s.hl, s.hl) * 0.6, s.y + rand(0.5, s.deckTop + 3), s.z + rand(-s.hl, s.hl) * 0.6), 1.5 + hard * 2.2, 5 + hard * 10, n.owner, hard);
    for (const cp of s.comps) cp.vol = Math.min(cp.cap, cp.vol + cp.cap * (d < 30 ? 0.97 : hard * 0.5));
  }
  for (const t of targets()) {
    const p = t.center(tmp), d = Math.hypot(p.x - n.x, p.z - n.z);
    if (d > NUKE_REACH) continue;
    if (t.isShark) t.stun(25, c);
    else t.hurt(d < NUKE_R ? 999 : 160 * (1 - (d - NUKE_R) / (NUKE_REACH - NUKE_R)), n.owner, 'nuke', c);
  }
}
function updateNuke(dt) {
  updateBlasts(dt);
  const n = G.nuke;
  if (!n) return;
  n.t -= dt; n.siren -= dt;
  if (n.siren <= 0) { n.siren = 3.6; sfx.siren(); }
  if (ring) ring.material.opacity = 0.35 + 0.3 * Math.sin(G.t * (n.t < 5 ? 16 : 8));
  if (n.t > 0 || n.visual) return;
  G.netFx?.({ k: 'nukeBoom', x: n.x, z: n.z });
  blastVisual(n.x, n.z);
  nukeDamage(n);
  if (ring) G.scene.remove(ring);
  ring = null;
  G.nuke = null;
}
export function clearBlasts() { for (const b of BLASTS) G.scene.remove(b.g); BLASTS.length = 0; if (SKY0.h) { SKY.horizon.copy(SKY0.h); SKY.zenith.copy(SKY0.z); } }

// ---------- C4 ----------
const c4Geo = new THREE.BoxGeometry(0.35, 0.2, 0.25);
const c4Mat = new THREE.MeshStandardMaterial({ color: '#c9b98d', roughness: 0.8 });
const ledMat = new THREE.MeshBasicMaterial({ color: '#ff2222' });
export function placeC4(owner, hit) {
  if (isGuest() && owner) {
    G.netAct?.('c4', hit.ship?.id ?? null, [hit.point.x, hit.point.y, hit.point.z], [hit.normal?.x ?? 0, hit.normal?.y ?? 1, hit.normal?.z ?? 0]);
    return;
  }
  const mesh = new THREE.Group();
  mesh.add(new THREE.Mesh(c4Geo, c4Mat));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), ledMat); led.position.set(0.1, 0.12, 0); mesh.add(led);
  const c = { id: hit.id ?? nextId(), owner, ship: hit.ship || null, mesh, led };
  const p = hit.point.clone().addScaledVector(hit.normal || tmp.set(0, 1, 0), 0.08);
  if (c.ship) { c.lp = hit.local ? p.clone() : c.ship.toLocal(p.clone()); mesh.position.copy(c.lp); c.ship.group.add(mesh); }
  else { c.wp = p; mesh.position.copy(p); G.scene.add(mesh); }
  G.c4s.push(c);
  G.netHook?.('spawn', 'c4', c);
}
export function detonateC4(owner) {
  if (isGuest() && owner === G.me) { G.netAct?.('detonate'); return true; }
  const mine = G.c4s.filter(c => c.owner === owner);
  if (!mine.length) return false;
  mine.forEach((c, i) => setTimeout(() => {
    const p = c.ship ? c.ship.toWorld(c.lp.clone()) : c.wp;
    c.mesh.parent?.remove(c.mesh);
    G.netHook?.('despawn', 'c4', c);
    explode(p, { r: 2.2, power: 10, dmg: 140, owner, fire: 0.5 });
  }, i * 120));
  G.c4s = G.c4s.filter(c => c.owner !== owner);
  return true;
}
function updateC4() { for (const c of G.c4s) c.led.visible = Math.sin(G.t * 10) > 0; }

export function updateWeaponsWorld(dt) { updateProjectiles(dt); if (!isGuest()) updateStrikes(dt); updateNuke(dt); updateC4(); }
export function resetWeaponsWorld() {
  clearProjectiles(); STRIKES.length = 0;
  for (const c of G.c4s) c.mesh.parent?.remove(c.mesh);
  G.c4s = [];
  if (ring) G.scene.remove(ring);
  ring = null; G.nuke = null;
  clearBlasts();
}

// ---------- inventory ----------
export function gunState(id, att = {}) {
  const def = WEAPONS[id];
  const mag = Math.round(def.mag * (att.mag === 'extmag' ? 1.5 : 1));
  return { id, att: { ...att }, mag, magMax: mag, reserve: def.reserve };
}
export function makeInventory(kit) {
  const lo = kit.loadout, att = kit.att || {};
  return {
    primary: gunState(lo.primary, att[lo.primary]), secondary: gunState(lo.secondary, att[lo.secondary]),
    gadget: lo.gadget && WEAPONS[lo.gadget] ? { id: lo.gadget, count: WEAPONS[lo.gadget].count } : null,
    special: null,
  };
}
// a gun's numbers after its attachments
export function gunStats(s) {
  const def = WEAPONS[s.id], a = s.att || {};
  const optic = a.optic ? ATTACH[a.optic] : null;
  return {
    def, spread: def.spread * (a.grip ? 0.7 : 1), kick: def.kick * (a.muzzle === 'comp' ? 0.6 : 1) * (a.grip ? 0.85 : 1),
    reload: def.reload * (a.mag === 'extmag' ? 1.15 : 1), quiet: a.muzzle === 'suppressor',
    zoom: def.scope || optic?.zoom || 1.15, scoped: !!def.scope || !!optic?.scope,
  };
}

// ---------- viewmodels ----------
const M = {
  steel: new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0.85, roughness: 0.32 }),
  dark: new THREE.MeshStandardMaterial({ color: '#18191b', metalness: 0.2, roughness: 0.65 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a4a25', roughness: 0.6 }),
  brass: new THREE.MeshStandardMaterial({ color: '#c9a03c', metalness: 0.8, roughness: 0.3 }),
  olive: new THREE.MeshStandardMaterial({ color: '#4a5236', roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: '#3a6a8a', metalness: 0.9, roughness: 0.05 }),
  red: new THREE.MeshBasicMaterial({ color: '#ff2a2a' }),
  skin: new THREE.MeshStandardMaterial({ color: '#c99a74', roughness: 0.75 }),
  sleeve: new THREE.MeshStandardMaterial({ color: '#2f6fb3', roughness: 0.9 }),
  glove: new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8 }),
};
function part(g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; }
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (r, l, s = 10) => new THREE.CylinderGeometry(r, r, l, s).rotateX(Math.PI / 2);

// builds a gun; returns { g, mag, pump, muzzle (Vector3), sightY, fore (left-hand point), eject }
function buildGun(id, att = {}) {
  const g = new THREE.Group();
  let mag = null, pump = null, muzzle, sightY = 0.07, fore = new THREE.Vector3(0, -0.03, -0.22), eject = new THREE.Vector3(0.03, 0.05, -0.05);
  if (id === 'pistol') {
    part(g, B(0.046, 0.05, 0.2), M.steel, 0, 0.045, -0.06);
    part(g, B(0.042, 0.03, 0.16), M.dark, 0, 0.008, -0.05);
    part(g, B(0.04, 0.11, 0.055), M.dark, 0, -0.05, 0.02, 0.22);
    part(g, B(0.008, 0.012, 0.01), M.steel, 0, 0.076, -0.15);
    mag = part(g, B(0.03, 0.05, 0.04), M.steel, 0, -0.09, 0.025, 0.22);
    muzzle = new THREE.Vector3(0, 0.045, -0.165); fore = null; sightY = 0.078; eject.set(0.03, 0.06, -0.04);
  } else if (id === 'revolver') {
    part(g, CYL(0.016, 0.2), M.steel, 0, 0.045, -0.15);
    part(g, CYL(0.036, 0.07, 6), M.steel, 0, 0.032, -0.03);
    part(g, B(0.03, 0.05, 0.08), M.steel, 0, 0.03, 0.02);
    part(g, B(0.038, 0.11, 0.05), M.wood, 0, -0.045, 0.05, 0.3);
    muzzle = new THREE.Vector3(0, 0.045, -0.255); fore = null; sightY = 0.07;
  } else if (id === 'smg') {
    part(g, B(0.05, 0.07, 0.3), M.dark, 0, 0.03, -0.08);
    part(g, CYL(0.012, 0.12), M.steel, 0, 0.04, -0.28);
    part(g, B(0.04, 0.1, 0.05), M.dark, 0, -0.04, 0.03, 0.25);
    part(g, B(0.012, 0.03, 0.25), M.steel, 0, 0.03, 0.17);
    part(g, B(0.03, 0.06, 0.012), M.steel, 0, 0.0, 0.29);
    mag = part(g, B(0.03, 0.17, 0.04), M.steel, 0, -0.08, -0.12);
    muzzle = new THREE.Vector3(0, 0.04, -0.34); fore.set(0, 0.0, -0.2); sightY = 0.08;
  } else if (id === 'ak') {
    part(g, B(0.055, 0.075, 0.42), M.steel, 0, 0.03, -0.1);
    part(g, B(0.062, 0.062, 0.2), M.wood, 0, 0.022, -0.38);
    part(g, CYL(0.011, 0.26), M.steel, 0, 0.04, -0.6);
    part(g, CYL(0.01, 0.22), M.steel, 0, 0.068, -0.4);
    part(g, B(0.008, 0.04, 0.008), M.steel, 0, 0.065, -0.66);
    part(g, B(0.045, 0.085, 0.27), M.wood, 0, -0.005, 0.24, -0.08);
    part(g, B(0.04, 0.1, 0.045), M.wood, 0, -0.05, 0.04, 0.3);
    mag = new THREE.Group(); mag.position.set(0, -0.03, -0.14);
    part(mag, B(0.032, 0.11, 0.06), M.steel, 0, -0.05, 0, 0.25); part(mag, B(0.032, 0.1, 0.06), M.steel, 0, -0.14, -0.04, 0.55);
    g.add(mag);
    muzzle = new THREE.Vector3(0, 0.04, -0.74); fore.set(0, -0.01, -0.38); sightY = 0.085;
  } else if (id === 'lmg') {
    part(g, B(0.075, 0.09, 0.5), M.dark, 0, 0.035, -0.12);
    part(g, CYL(0.03, 0.4), M.steel, 0, 0.04, -0.55);
    part(g, CYL(0.014, 0.2), M.steel, 0, 0.04, -0.82);
    part(g, B(0.05, 0.09, 0.26), M.dark, 0, 0.0, 0.25);
    part(g, B(0.04, 0.1, 0.045), M.dark, 0, -0.05, 0.05, 0.3);
    part(g, B(0.08, 0.02, 0.2), M.steel, 0, 0.09, -0.1);
    mag = part(g, B(0.11, 0.12, 0.12), M.olive, -0.01, -0.07, -0.12);
    muzzle = new THREE.Vector3(0, 0.04, -0.93); fore.set(0, -0.0, -0.42); sightY = 0.1;
  } else if (id === 'shotgun') {
    part(g, CYL(0.016, 0.62), M.steel, 0, 0.045, -0.4);
    part(g, CYL(0.014, 0.5), M.steel, 0, 0.012, -0.36);
    part(g, B(0.055, 0.07, 0.2), M.steel, 0, 0.03, -0.03);
    pump = part(g, B(0.058, 0.055, 0.17), M.wood, 0, 0.012, -0.36);
    part(g, B(0.05, 0.09, 0.28), M.wood, 0, -0.01, 0.2, -0.1);
    part(g, B(0.04, 0.09, 0.045), M.wood, 0, -0.05, 0.05, 0.3);
    muzzle = new THREE.Vector3(0, 0.045, -0.72); fore.set(0, -0.01, -0.36); sightY = 0.07; eject.set(0.03, 0.04, -0.03);
  } else if (id === 'sniper') {
    part(g, CYL(0.014, 0.6), M.steel, 0, 0.04, -0.55);
    part(g, B(0.055, 0.07, 0.3), M.steel, 0, 0.03, -0.1);
    part(g, B(0.06, 0.09, 0.42), M.olive, 0, 0.0, 0.05);
    part(g, B(0.05, 0.11, 0.3), M.olive, 0, -0.02, 0.32, -0.1);
    part(g, CYL(0.026, 0.34, 14), M.dark, 0, 0.115, -0.08);
    part(g, CYL(0.03, 0.03, 14), M.dark, 0, 0.115, -0.26);
    part(g, CYL(0.024, 0.005, 14), M.glass, 0, 0.115, -0.276);
    part(g, B(0.05, 0.012, 0.012), M.steel, 0.04, 0.05, 0.02);
    mag = part(g, B(0.035, 0.06, 0.08), M.steel, 0, -0.05, -0.06);
    muzzle = new THREE.Vector3(0, 0.04, -0.86); fore.set(0, -0.02, -0.32); sightY = 0.115;
  } else if (id === 'grenade') {
    part(g, new THREE.SphereGeometry(0.045, 10, 8), M.olive, 0, 0, -0.05); part(g, B(0.015, 0.05, 0.02), M.steel, 0.02, 0.04, -0.05);
    muzzle = new THREE.Vector3(0, 0, -0.1); fore = null;
  } else if (id === 'c4') {
    part(g, B(0.16, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: '#c9b98d' }), 0, -0.02, -0.06); part(g, B(0.04, 0.1, 0.025), M.dark, 0.1, 0.0, -0.02); part(g, B(0.012, 0.012, 0.012), M.red, 0.1, 0.055, -0.02);
    muzzle = new THREE.Vector3(0, 0, -0.1); fore = null;
  } else if (id === 'flare') {
    part(g, CYL(0.018, 0.24), new THREE.MeshStandardMaterial({ color: '#d8261c' }), 0, 0, -0.06); muzzle = new THREE.Vector3(0, 0, -0.2); fore = null;
  } else {
    part(g, B(0.1, 0.04, 0.16), new THREE.MeshStandardMaterial({ color: '#e3c228' }), 0, -0.02, -0.05); part(g, CYL(0.022, 0.02), M.red, 0, 0.01, -0.07).rotation.x = 0; muzzle = new THREE.Vector3(0, 0, -0.1); fore = null;
  }
  // attachments
  if (att.optic === 'reddot') { part(g, B(0.035, 0.035, 0.05), M.dark, 0, sightY + 0.02, -0.06); part(g, B(0.004, 0.004, 0.002), M.red, 0, sightY + 0.025, -0.084); sightY += 0.025; }
  if (att.optic === 'scope4') { part(g, CYL(0.022, 0.24, 14), M.dark, 0, sightY + 0.04, -0.07); part(g, CYL(0.02, 0.004, 14), M.glass, 0, sightY + 0.04, -0.19); sightY += 0.04; }
  if (att.muzzle === 'suppressor') { part(g, CYL(0.022, 0.17, 12), M.dark, muzzle.x, muzzle.y, muzzle.z - 0.085); muzzle.z -= 0.17; }
  if (att.muzzle === 'comp') { part(g, CYL(0.018, 0.05, 8), M.steel, muzzle.x, muzzle.y, muzzle.z - 0.025); muzzle.z -= 0.05; }
  if (att.mag === 'extmag' && mag) mag.scale.y = 1.4;
  if (att.grip === 'grip' && fore) { part(g, B(0.03, 0.08, 0.03), M.dark, 0, fore.y - 0.05, fore.z + 0.04); }
  g.traverse(m => { if (m.isMesh) { m.castShadow = false; } });
  return { g, mag, magY: mag ? mag.position.y : 0, pump, pumpZ: pump ? pump.position.z : 0, muzzle, sightY, fore, eject };
}

function arm(from, to, glove) {
  const a = new THREE.Group();
  const len = from.distanceTo(to);
  const sl = part(a, B(0.075, 0.075, len), M.sleeve, 0, 0, len / 2);
  const hand = part(a, B(0.07, 0.07, 0.09), glove ? M.glove : M.skin, 0, 0, 0);
  void sl; void hand;
  a.position.copy(from);
  a.lookAt(to.clone());   // +z (the sleeve) now runs from the hand toward the shoulder
  return a;
}

let flashTex = null;
function muzzleFlash() {
  if (!flashTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,190,80,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = gr; x.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 12 : 32; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.fill();
    flashTex = new THREE.CanvasTexture(c);
  }
  const mat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mat); g.add(a);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.35), mat); b.rotation.y = Math.PI / 2; b.position.z = -0.12; g.add(b);
  const c2 = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.1), mat); c2.rotation.x = Math.PI / 2; c2.position.z = -0.12; g.add(c2);
  g.visible = false;
  return g;
}

const SLOTS = ['primary', 'secondary', 'gadget', 'special'];
export class Gunner {
  constructor(player) {
    this.p = player;
    this.cd = 0; this.reload = 0; this.reloadT = 0; this.ads = 0; this.wantAds = false;
    this.kick = 0; this.kickV = 0; this.rot = 0; this.rotV = 0; this.camKick = 0;
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.equip = 0; this.flashT = 0; this.pumpT = 0; this.sprint = 0;
    this.spread = 0;
    this.root = new THREE.Group();      // follows the camera
    this.holder = new THREE.Group();    // animated
    this.root.add(this.holder);
    G.camera.add(this.root);
    this.flash = muzzleFlash();
    this.models = {};
    this.shown = null;
    M.sleeve.color.set(P.shirt);
  }
  cur() { const s = this.p.inv[this.p.slot]; return s ? s : null; }
  model(s) {
    const key = s.id + JSON.stringify(s.att || {});
    if (!this.models[key]) {
      const m = buildGun(s.id, s.att || {});
      const grip = new THREE.Vector3(0, -0.06, 0.04);
      m.g.add(arm(grip, new THREE.Vector3(0.18, -0.32, 0.55), true));
      m.g.add(arm(m.fore || new THREE.Vector3(-0.02, -0.05, -0.02), new THREE.Vector3(-0.28, -0.35, 0.45), true));
      this.models[key] = m;
    }
    return this.models[key];
  }
  show(visible) {
    const s = this.cur();
    const m = visible && s ? this.model(s) : null;
    if (m !== this.shown) {
      if (this.shown) this.holder.remove(this.shown.g);
      if (m) { this.holder.add(m.g); m.g.add(this.flash); this.flash.position.copy(m.muzzle); this.equip = 1; }
      this.shown = m;
    }
    this.root.visible = !!m && !(this.ads > 0.9 && this.stats()?.scoped);
  }
  stats() { const s = this.cur(); return s && s.mag != null ? gunStats(s) : null; }
  switchTo(slot) {
    if (!this.p.inv[slot] || this.p.slot === slot) return;
    this.p.slot = slot; this.reload = 0; this.cd = Math.max(this.cd, 0.35); this.wantAds = false;
  }
  startReload(st) {
    const s = this.cur();
    if (this.reload > 0 || s.mag >= s.magMax || (s.reserve <= 0 && !G.admin.infAmmo)) return;
    this.reload = st.def.shells ? st.reload : st.reload; this.reloadT = this.reload; sfx.reload(0);
  }
  update(dt, active, moving, sprinting) {
    const p = this.p;
    this.cd -= dt; this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    // springs
    this.kickV += (-this.kick * 160 - this.kickV * 18) * dt; this.kick += this.kickV * dt;
    this.rotV += (-this.rot * 140 - this.rotV * 16) * dt; this.rot += this.rotV * dt;
    const rec = Math.min(this.camKick, dt * 0.35); this.camKick -= rec; p.pitch -= rec * 0.6;
    this.bob += dt * (moving ? (sprinting ? 13 : 9) : 1.5);
    this.swayX = damp(this.swayX, clamp(-IN.mdx * 0.0007, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(IN.mdy * 0.0007, -0.06, 0.06), 10, dt);
    this.equip = Math.max(0, this.equip - dt * 4);
    this.sprint = damp(this.sprint, sprinting && !this.wantAds ? 1 : 0, 10, dt);
    if (!active) { this.wantAds = false; this.ads = damp(this.ads, 0, 14, dt); this.show(false); return; }
    for (let i = 0; i < 4; i++) if (hit('slot' + (i + 1))) this.switchTo(SLOTS[i]);
    if (IN.wheel) {
      const have = SLOTS.filter(s => p.inv[s]);
      const i = have.indexOf(p.slot);
      this.switchTo(have[(i + (IN.wheel > 0 ? 1 : -1) + have.length) % have.length]);
    }
    if (hit('detonate')) detonateC4(p);
    const s = this.cur();
    this.show(true);
    if (!s) return;
    const def = WEAPONS[s.id];
    const isGun = s.mag != null;
    const st = isGun ? gunStats(s) : null;
    this.wantAds = isGun && IN.rmb && this.reload <= 0;
    this.ads = damp(this.ads, this.wantAds ? 1 : 0, def.slow ? 9 : 14, dt);
    // reload
    if (isGun && this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) {
        if (def.shells) {
          if (G.admin.infAmmo || s.reserve > 0) { s.mag++; if (!G.admin.infAmmo) s.reserve--; sfx.reload(1); }
          if (s.mag < s.magMax && (s.reserve > 0 || G.admin.infAmmo) && !IN.lmbHit) { this.reload = st.reload; this.reloadT = st.reload; }
          else { this.reload = 0; sfx.pump(); this.pumpT = 0.35; }
        } else {
          const need = s.magMax - s.mag, take = G.admin.infAmmo ? need : Math.min(need, s.reserve);
          s.mag += take; if (!G.admin.infAmmo) s.reserve -= take; sfx.reload(1);
        }
      }
    } else if (isGun && hit('reload')) this.startReload(st);
    this.animate(dt, s, st, moving);
    if (this.cd > 0) return;
    if (!isGun) { if (IN.lmbHit || (s.id === 'grenade' && IN.rmbHit)) this.useSpecial(s, def); return; }
    if (this.reload > 0 && def.shells && IN.lmbHit && s.mag > 0) this.reload = 0;   // interrupt shell loading
    if (this.reload > 0 || this.sprint > 0.5) return;
    const want = def.auto ? IN.lmb : IN.lmbHit;
    if (!want) return;
    if (s.mag <= 0) { if (IN.lmbHit) sfx.empty(); this.startReload(st); return; }
    this.fire(s, def, st, moving);
  }
  animate(dt, s, st, moving) {
    const m = this.shown;
    if (!m) return;
    const a = this.ads;
    const hip = new THREE.Vector3(0.19, -0.2, -0.42), aim = new THREE.Vector3(0, -m.sightY, -0.3);
    const bobA = moving ? (this.p.onGround || this.p.swimming ? 1 : 0.2) : 0.15;
    const bx = Math.sin(this.bob * 0.5) * 0.012 * bobA * (1 - a * 0.85), by = Math.abs(Math.cos(this.bob * 0.5)) * 0.012 * bobA * (1 - a * 0.85);
    this.root.position.lerpVectors(hip, aim, a);
    this.root.position.x += bx + this.swayX * (1 - a * 0.7);
    this.root.position.y += -by + this.swayY * (1 - a * 0.7) - this.equip * 0.25 - this.sprint * 0.05;
    this.root.position.z += this.kick;
    this.root.rotation.set(this.rot + this.equip * -0.6 - this.sprint * 0.35, this.sprint * 0.7 + this.swayX * 2, this.sprint * 0.25);
    // reload motion
    let rl = 0;
    if (this.reload > 0 && st) {
      const k = 1 - this.reload / this.reloadT;
      rl = st.def.shells ? 0.4 : Math.sin(Math.min(1, k) * Math.PI);
      if (m.mag) m.mag.position.y = m.magY - (st.def.shells ? 0 : Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.25);
    } else if (m.mag) m.mag.position.y = m.magY;
    this.holder.rotation.set(-rl * 0.35, 0, rl * 0.6);
    this.holder.position.set(0, -rl * 0.05, 0);
    if (m.pump) { this.pumpT -= dt; m.pump.position.z = m.pumpZ + (this.pumpT > 0 ? Math.sin((1 - this.pumpT / 0.35) * Math.PI) * 0.09 : 0); }
    if (this.flash.visible) { this.flash.rotation.z = rand(0, 6); this.flash.scale.setScalar(rand(0.8, 1.3) * (st?.quiet ? 0.35 : 1)); }
    // crosshair size
    this.spread = st ? st.spread * (moving ? 1.8 : 1) * (1 - a * 0.6) * (this.p.swimming ? 2 : 1) + this.kick * 0.2 : 0;
  }
  fire(s, def, st, moving) {
    const p = this.p;
    s.mag--;
    this.cd = def.rate;
    this.kickV += st.kick * 9; this.rotV += st.kick * 22;
    const up = st.kick * (0.45 + Math.random() * 0.2) * (this.ads > 0.5 ? 0.7 : 1);
    p.pitch = clamp(p.pitch + up, -1.5, 1.5); this.camKick += up;
    p.yaw += (Math.random() - 0.5) * st.kick * 0.25;
    const cam = G.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const q = cam.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const m = this.shown;
    m.g.updateMatrixWorld(true);
    const muzzle = m.g.localToWorld(m.muzzle.clone());
    const spread = st.spread * (moving ? 1.8 : 1) * (1 - this.ads * 0.6) * (p.swimming ? 2 : 1);
    let hits = 0, head = false, first = null;
    for (let i = 0; i < (def.pellets || 1); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
      const hit = hitscan(origin, dir, def.range, p);
      const end = hit ? hit.point : origin.clone().addScaledVector(dir, def.range);
      if (!st.quiet || Math.random() < 0.3) FX.tracer(muzzle.clone().lerp(end, 0.03), end);
      first ??= end;
      const h = bulletImpact(hit, def.dmg, def.vox, p);
      if (h) { hits++; if (h === 2) head = true; }
    }
    if (hits) { sfx.hit(head); G.hitMarker = 0.18; G.hitHead = head; }
    this.flashT = 0.045;
    if (!st.quiet) FX.flash(muzzle.x, muzzle.y, muzzle.z, 2.5);
    const ej = m.g.localToWorld(m.eject.clone());
    const pf = p.frame;
    FX.casing(ej.x, ej.y, ej.z, right.x * 2 + upv.x * 1.5 + rand(-0.3, 0.3), right.y * 2 + 1.8, right.z * 2 + upv.z * 1.5, pf ? null : null);
    sfx.shot(s.id, null, st.quiet);
    const r2 = v => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
    G.netFx?.({ k: 'shot', w: s.id, a: r2(muzzle), b: r2(first), q: st.quiet });
    if (s.id === 'shotgun') { this.pumpT = 0.35; setTimeout(() => sfx.pump(), 250); }
    if (s.id === 'sniper') setTimeout(() => sfx.reload(0), 450);
  }
  useSpecial(s, def) {
    const p = this.p, cam = G.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3()), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    this.cd = 0.5;
    const out = () => { if (!G.admin.infAmmo) s.count--; };
    if (s.count <= 0 && !G.admin.infAmmo) return G.toast?.(`No ${def.name.toLowerCase()} left.`);
    if (s.id === 'c4') {
      const hit = hitscan(origin, dir, 3.5, p);
      if (!hit || hit.kind === 'water' || hit.kind === 'target') return G.toast?.('Stick the C4 on something (a hull, a deck, a rock).');
      if (!hit.normal) hit.normal = new THREE.Vector3(0, 1, 0);
      placeC4(p, hit); out(); sfx.wood(hit.point);
      G.toast?.('C4 placed. Press F to detonate.');
    } else if (s.id === 'grenade') {
      const under = IN.rmbHit;
      const vel = dir.clone().multiplyScalar(under ? 7 : 17); vel.y += under ? 1 : 3.5;
      if (p.frame) vel.add(p.frame.velocity(tmp));
      const at = origin.clone().addScaledVector(dir, 0.5);
      if (isGuest()) G.netAct?.('throw', 'grenade', [at.x, at.y, at.z], [vel.x, vel.y, vel.z]); else addProjectile('grenade', at, vel, p);
      out(); this.equip = 1; this.cd = 0.8;
    } else if (s.id === 'flare') {
      const vel = dir.clone().multiplyScalar(20); vel.y += 4;
      if (p.frame) vel.add(p.frame.velocity(tmp));
      const at = origin.clone().addScaledVector(dir, 0.6);
      if (isGuest()) G.netAct?.('throw', 'flare', [at.x, at.y, at.z], [vel.x, vel.y, vel.z]); else addProjectile('flare', at, vel, p);
      s.count--;
    } else if (s.id === 'nuke') {
      const hit = hitscan(origin, dir, 500, p);
      if (!hit) return G.toast?.('Aim at the sea or a ship to choose the target.');
      if (!armNuke(hit.point, p)) return G.toast?.('A nuke is already on its way.');
      s.count--;
    }
    if (s.count <= 0 && def.slot === 'special') { p.inv.special = null; this.switchTo('primary'); }
  }
  dispose() { G.camera.remove(this.root); }
}
