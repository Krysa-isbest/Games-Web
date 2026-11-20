// Whiteout: the cold you can see, and guide ropes (step 7e, design.md 7e).
//  * Breath: a puff of steam in front of your face every few breaths (faster when you run), and from your crew.
//  * Footprints: in the snow behind you and your crew; the wind and the snowfall fill them in (fast in a storm).
//  * Frost: things left outside at night get a white crust.
//  * Guide ropes (a rope from the workbench: two silk scarves): hold it and click to tie one end, walk up to 60 m, click
//    again to tie the other. A line on stakes you can follow home in fog or a whiteout. Hold the use key at an end
//    to untie it and take it back. The host keeps the ropes (`gm.ropes`: shared and saved).
import * as THREE from 'three';
import { kn } from './keys.js';
import * as ISL from './island.js';
import * as SFX from './sfx.js';

let H = null;                       // helpers from work.js: { act, hint }
const PRINTS = 260, ROPE_MAX = 60, _v = new THREE.Vector3(), _a = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export function initFx(gm, helpers) {
  H = helpers;
  gm.ropes ??= [];
  gm.fx = { breathT: 1, puffs: [], prints: [], pi: 0, im: null, last: new Map(), frostT: 0, ropeRev: -1, ropeG: null, ropeStart: null };
  if (typeof document === 'undefined') return;
  const pm = new THREE.MeshBasicMaterial({ color: '#7d8fa3', transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const im = gm.fx.im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.27).rotateX(-Math.PI / 2), pm, PRINTS);
  im.count = PRINTS; im.frustumCulled = false; im.renderOrder = 1;
  for (let i = 0; i < PRINTS; i++) { im.setMatrixAt(i, _m.makeScale(0, 0, 0)); gm.fx.prints.push({ t: -1, life: 0 }); }
  gm.scene.add(im);
  const bm = new THREE.SpriteMaterial({ color: '#e8f0f6', transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < 18; i++) { const s = new THREE.Sprite(bm.clone()); s.visible = false; gm.scene.add(s); gm.fx.puffs.push({ s, t: 1, v: new THREE.Vector3() }); }
  gm.fx.ropeG = new THREE.Group(); gm.scene.add(gm.fx.ropeG);
}
// a footprint where a foot came down (yours from player.js's onStep, the crew's from how far they walked)
export function print(gm, x, z, yaw, side) {
  const F = gm.fx;
  if (!F?.im) return;
  const w = gm.world, y = w.groundY(x, z);
  if (y < ISL.SEA + 0.05 || w.inShack(_v.set(x, y, z))) return;
  const ox = Math.cos(yaw) * 0.12 * side, oz = -Math.sin(yaw) * 0.12 * side;
  const i = F.pi = (F.pi + 1) % PRINTS;
  _q.setFromAxisAngle(UP, yaw);
  F.im.setMatrixAt(i, _m.compose(_v.set(x + ox, y + 0.02, z + oz), _q, _s.set(1, 1, 1)));
  F.prints[i] = { t: gm.T, life: 1 };
  F.im.instanceMatrix.needsUpdate = true;
}
function puff(gm, at, dir, k) {
  const P = gm.fx.puffs.find(x => x.t >= 1);
  if (!P) return;
  P.t = 0; P.k = k; P.s.visible = true; P.s.position.copy(at); P.v.copy(dir).multiplyScalar(0.35).add(_a.set(0, 0.25, 0));
}

// ---------- every frame ----------
export function fxTick(gm, dt, env) {
  const F = gm.fx, p = gm.player, cam = gm.camera;
  if (!F) return;
  const cold = env.temp < -2;
  // breath: yours, and your crew's
  if (F.puffs.length && cold && gm.life?.st !== 'dead' && p.mode !== 'swim') {
    F.breathT -= dt * (p.sprinting ? 2.2 : p.moving ? 1.3 : 1);
    if (F.breathT <= 0) {
      F.breathT = 2.8 + Math.random();
      if (!p.mode && !gm.aboard && !gm.life?.st?.startsWith?.('sleep')) { cam.getWorldDirection(_a); puff(gm, _v.copy(cam.position).addScaledVector(_a, 0.3).add(_s.set(0, -0.1, 0)), _a, p.sprinting ? 1.4 : 1); }
      for (const a of gm.avatars.values()) if ((a.to?.ls ?? 0) === 0 && !a.to?.ab && a.pos.distanceTo(cam.position) < 25 && Math.random() < 0.8) { const yaw = a.yaw; _a.set(-Math.sin(yaw), 0, -Math.cos(yaw)); puff(gm, _v.set(a.pos.x, a.pos.y + 1.6 - (a.cr || 0) * 0.45, a.pos.z).addScaledVector(_a, 0.25), _a, 1); }
    }
  }
  for (const P of F.puffs) {
    if (P.t >= 1) continue;
    P.t += dt / 1.6;
    P.s.position.addScaledVector(P.v, dt).add(_a.set(Math.cos(env.wdir), 0, Math.sin(env.wdir)).multiplyScalar(env.wind * 0.04 * dt));
    P.s.scale.setScalar(0.15 + P.t * 0.5 * (P.k || 1));
    P.s.material.opacity = Math.sin(Math.PI * Math.min(1, P.t)) * 0.28;
    if (P.t >= 1) P.s.visible = false;
  }
  // the crew's footprints: one every 0.75 m they walk
  for (const [pid, a] of gm.avatars) {
    if ((a.to?.ls ?? 0) !== 0 || a.to?.ab || a.to?.st) continue;
    const l = F.last.get(pid);
    if (!l) { F.last.set(pid, { x: a.pos.x, z: a.pos.z, side: 1 }); continue; }
    if (Math.hypot(a.pos.x - l.x, a.pos.z - l.z) > 0.75) { l.side = -l.side; print(gm, a.pos.x, a.pos.z, a.yaw, l.side); l.x = a.pos.x; l.z = a.pos.z; }
  }
  // the snow fills them in: a few minutes, much faster in a storm
  if (F.im) {
    const fill = 1 / 240 * (1 + 4 * env.storm) * (gm.ts || 1);
    let any = false;
    for (let i = 0; i < PRINTS; i++) {
      const pr = F.prints[i];
      if (pr.life <= 0) continue;
      pr.life -= dt * fill; any = true;
      if (pr.life <= 0) F.im.setMatrixAt(i, _m.makeScale(0, 0, 0));
      else if (pr.life < 0.5) { F.im.getMatrixAt(i, _m); _m.decompose(_v, _q, _s); _s.setScalar(pr.life * 2); F.im.setMatrixAt(i, _m.compose(_v, _q, _s)); }
    }
    if (any) F.im.instanceMatrix.needsUpdate = true;
  }
  // frost on things left out at night (a crust of white on top of them)
  F.frostT -= dt;
  if (F.frostT <= 0 && typeof document !== 'undefined') {
    F.frostT = 2;
    if (env.light < 0.3) for (const it of gm.world.stash.list.values()) {
      if (it.frost || it.body || !it.rest || it.type === 'trunk' || gm.world.inShack(it.mesh.position) || gm.world.shelter?.(it.mesh.position)) continue;
      const bb = new THREE.Box3().setFromObject(it.mesh), sz = bb.getSize(_a);
      if (sz.x > 3 || sz.z > 3) continue;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.05, sz.x * 0.9), 0.012, Math.max(0.05, sz.z * 0.9)), frostMat());
      cap.position.set((bb.min.x + bb.max.x) / 2, bb.max.y + 0.004, (bb.min.z + bb.max.z) / 2);
      gm.scene.add(cap); it.frost = cap;
    }
    for (const it of gm.world.stash.list.values()) if (it.frost && (it.body || !gm.world.stash.list.has(it.id))) { gm.scene.remove(it.frost); it.frost = null; }
  }
  ropesTick(gm);
}
let FM = null;
const frostMat = () => FM || (FM = new THREE.MeshStandardMaterial({ color: '#f4f8fb', roughness: 0.6, transparent: true, opacity: 0.85 }));
// a thing picked up or gone: its frost goes too (work.js / items.js call this through the stash's remove)
export function unfrost(gm, it) { if (it?.frost) { gm.scene.remove(it.frost); it.frost = null; } }

// ---------- guide ropes ----------
function ropesTick(gm) {
  const F = gm.fx, held = gm.inv.heldType();
  if (held !== 'rope') F.ropeStart = null;
  const rev = gm.ropes.length + ':' + gm.ropes.map(r => r[0]).join(',');
  if (rev === F.ropeRev || !F.ropeG) return;
  F.ropeRev = rev;
  for (const c of [...F.ropeG.children]) { F.ropeG.remove(c); c.geometry?.dispose(); }
  const lm = new THREE.LineBasicMaterial({ color: '#d8c38f' }), stake = new THREE.MeshStandardMaterial({ color: '#4a3626', roughness: 0.95 }), sg = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5);
  for (const r of gm.ropes) {
    const [, x1, y1, z1, x2, y2, z2] = r, pts = [], n = Math.max(4, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 3));
    for (let k = 0; k <= n; k++) { const u = k / n, x = x1 + (x2 - x1) * u, z = z1 + (z2 - z1) * u; pts.push(new THREE.Vector3(x, Math.max(gm.world.groundY(x, z), ISL.SEA) + 0.85 - Math.sin(Math.PI * (k % 2 ? 0.5 : 0)) * 0.1, z)); }
    F.ropeG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm));
    for (let k = 0; k <= n; k += 2) { const s = new THREE.Mesh(sg, stake); s.position.copy(pts[k]).setY(pts[k].y - 0.35); F.ropeG.add(s); }
  }
}
// holding a rope, the left mouse: tie one end, then the other (work.js calls this on a click)
export function ropeClick(gm) {
  const F = gm.fx, p = gm.player, at = [Math.round(p.pos.x * 10) / 10, Math.round(p.pos.y * 10) / 10, Math.round(p.pos.z * 10) / 10];
  if (!F.ropeStart) { F.ropeStart = at; SFX.grab(); H.hint(gm, 'rope1' + Math.floor(gm.T), `You drive a stake into the snow and tie one end. Walk to where it should lead (up to ${ROPE_MAX} m) and click again.`, 6000, true); return; }
  const d = Math.hypot(at[0] - F.ropeStart[0], at[2] - F.ropeStart[2]);
  if (d < 3) { H.hint(gm, 'rope-short' + Math.floor(gm.T), 'Walk further first.', 2500, true); return; }
  if (d > ROPE_MAX) { H.hint(gm, 'rope-long' + Math.floor(gm.T), `The rope only reaches ${ROPE_MAX} m: you are ${Math.round(d)} m from the stake.`, 3500, true); return; }
  if (!gm.inv.use(t => t === 'rope', 1)) return;
  H.act(gm, { a: 'rope', op: 'tie', r: [...F.ropeStart, ...at] });
  F.ropeStart = null; SFX.grab();
  H.hint(gm, 'rope2', 'The rope is tied. In fog or a whiteout, keep it in sight and follow it.', 6000, true);
}
export function ropeHud(gm) { return gm.fx?.ropeStart ? `Rope tied ${Math.round(Math.hypot(gm.player.pos.x - gm.fx.ropeStart[0], gm.player.pos.z - gm.fx.ropeStart[2]))} m back · ${kn('primary')} ties the other end` : ''; }
export function ropeActs(gm, look, offer) {
  (gm.ropes || []).forEach(r => {
    for (const e of [[r[1], r[2], r[3]], [r[4], r[5], r[6]]]) {
      const sc = look(_v.set(e[0], Math.max(gm.world.groundY(e[0], e[2]), ISL.SEA) + 0.6, e[2]), 2.2, 0.75);
      if (sc) offer(sc, { id: 'rope' + r[0], text: 'Untie the guide rope and take it back', hold: 2, go: () => H.act(gm, { a: 'rope', op: 'untie', id: r[0] }) });
    }
  });
}
// the host: ropes tied and untied (the one who untied it gets the rope back)
export function ropeApply(gm, a, from, give) {
  if (a.op === 'tie' && Array.isArray(a.r) && a.r.length === 6 && gm.ropes.length < 30) gm.ropes.push([(gm.ropeNext = (gm.ropeNext || 0) + 1) + Math.floor(Math.random() * 1000) * 100, ...a.r.map(Number)]);
  if (a.op === 'untie') { const i = gm.ropes.findIndex(r => r[0] === a.id); if (i >= 0) { gm.ropes.splice(i, 1); give(gm, from, 'rope', 1, {}); } }
}
