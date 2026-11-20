// Whiteout: the winter den (step 7e): a second home in the cave south of the shack, from the old hunter's plan.
// The plan lies in the old cache in that cave (places.js). Once anyone in the crew has read it, the four parts show
// as outlines in the cave: a wall of logs across the mouth with a gap (5 logs), a door in the gap (2 boards), a ring of
// stones for a fire (4 stones), a bed of branches (4 branches). Look at one with what it needs in your things and hold
// the use key. Wall and door: the den is sealed (no wind, the cold at 30 %). The fire: feed it wood and light it, like
// the stove (no pipe: the smoke finds a crack in the roof); it warms the den and lights the cave. The bed: sleep on it.
// It is meant to be worse than a patched shack with its stove: smaller, colder, darker, and it needs a lot of wood.
// If the shack has burned, the dead wake up in the den (life.js). The host runs it (`gm.den`: shared and saved).
import * as THREE from 'three';
import { TYPES, nameOf } from './items.js';
import { glowTex } from './scene.js';
import * as SFX from './sfx.js';

let H = null;                       // helpers from work.js: { act, hint, shout }
const PARTS = [
  { id: 'wall', text: 'Build the log wall across the mouth', need: [['log', 5]], at: [0, 1.2, -0.4], hold: 5 },
  { id: 'door', text: 'Hang a door of boards in the gap', need: [['board', 2]], at: [0, 1.1, -0.45], hold: 3 },
  { id: 'pit', text: 'Lay a ring of stones for a fire', need: [['stone', 4]], at: [0, 0.2, -7.2], hold: 3 },
  { id: 'bed', text: 'Make a bed of branches', need: [['branch', 4]], at: [3.0, 0.2, -6.0], hold: 3 },
];
const _v = new THREE.Vector3();

export function initDen(gm, helpers) {
  H = helpers;
  gm.den ??= { b: [0, 0, 0, 0], fuel: 0, lit: 0, temp: 0, sealed: false };
  gm.denL = { built: [false, false, false, false], ghosts: null, meshes: [], fire: null, cols: [] };
}
const cave = gm => gm.world.caves?.snowcave;
const at = (gm, i) => new THREE.Vector3(...PARTS[i].at).applyMatrix4(cave(gm).M);

// ---------- every frame ----------
export function denTick(gm, dt) {
  const D = gm.den, c = cave(gm);
  if (!D || !c) return;
  D.sealed = !!(D.b[0] && D.b[1]);
  draw(gm);
  // the fire (the host runs it)
  if (gm.role !== 'guest') {
    const ts = gm.ts || 1;
    if (D.lit && D.fuel > 0) { D.fuel = Math.max(0, D.fuel - dt * ts); D.temp = Math.min(1, D.temp + dt * ts / 90); if (D.fuel <= 0) D.lit = 0; }
    else { D.lit = 0; D.temp = Math.max(0, D.temp - dt * ts / 240); }
  }
  // its warmth: near the fire, and all through a sealed den
  const p = gm.player, inDen = c.open && c.inside(p.pos);
  gm.inDen = inDen && D.sealed;
  gm.pitHeat = D.b[2] && inDen ? D.temp * (0.35 + 0.65 * Math.max(0, 1 - p.pos.distanceTo(at(gm, 2)) / 3)) : 0;
  const F = gm.denL.fire;
  if (F) { const t = performance.now() / 1000, k = D.lit ? D.temp * (0.85 + 0.15 * Math.sin(t * 13)) : 0; F.light.intensity = 9 * k; for (const s of F.fl) { const u = s.userData; u.t += dt * 1.4; if (u.t > 1) u.t -= 1; s.position.set(u.x, 0.15 + u.t * 0.7, u.z); s.scale.setScalar((0.45 * (1 - u.t) + 0.1) * k); s.material.opacity = (1 - u.t) * 0.9 * Math.min(1, k * 2); } }
}
// how much the den's fire lights the cave (game.js takes it off the darkness)
export const denLight = gm => (gm.den?.b[2] && gm.den.lit ? gm.den.temp : 0);

function draw(gm) {
  const D = gm.den, Ld = gm.denL, c = cave(gm), known = gm.known?.has('den');
  if (typeof document === 'undefined') { for (let i = 0; i < 4; i++) if (D.b[i] && !Ld.built[i]) build(gm, i); return; }
  if (!Ld.ghosts) {
    const m = new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.22, depthWrite: false, wireframe: true });
    Ld.ghosts = [new THREE.BoxGeometry(2.4, 2.4, 0.35), new THREE.BoxGeometry(0.9, 1.9, 0.08), new THREE.TorusGeometry(0.45, 0.12, 6, 12).rotateX(Math.PI / 2), new THREE.BoxGeometry(0.9, 0.25, 2.0)].map((geo, i) => {
      const o = new THREE.Mesh(geo, m); o.position.copy(at(gm, i)); o.quaternion.setFromRotationMatrix(c.M); gm.scene.add(o); return o;
    });
  }
  for (let i = 0; i < 4; i++) { Ld.ghosts[i].visible = !!known && c.open && !D.b[i]; if (D.b[i] && !Ld.built[i]) build(gm, i); }
}
// what a built part looks like (and the wall's colliders)
function build(gm, i) {
  const Ld = gm.denL, c = cave(gm), w = gm.world, R = gm.R;
  Ld.built[i] = true;
  const g = new THREE.Group(); g.applyMatrix4(c.M); gm.scene.add(g); Ld.meshes.push(g);
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3626', roughness: 0.95 }), board = new THREE.MeshStandardMaterial({ color: '#7d7466', roughness: 0.92 }), stone = new THREE.MeshStandardMaterial({ color: '#5d6168', roughness: 0.95, flatShading: true }), green = new THREE.MeshStandardMaterial({ color: '#2b4a2e', roughness: 1 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const col = (hw, hh, hd, x, y, z) => { _v.set(x, y, z).applyMatrix4(c.M); const q = new THREE.Quaternion().setFromRotationMatrix(c.M); Ld.cols.push(w.phys.createCollider(R.ColliderDesc.cuboid(hw, hh, hd).setTranslation(_v.x, _v.y, _v.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))); };
  if (i === 0) {                    // logs stacked across the mouth, a gap in the middle for the door
    for (const s of [-1, 1]) { for (let k = 0; k < 9; k++) add(new THREE.CylinderGeometry(0.13, 0.13, 0.78, 8).rotateZ(Math.PI / 2), wood, s * 0.82, 0.14 + k * 0.26, -0.4); col(0.39, 1.2, 0.15, s * 0.82, 1.2, -0.4); }
    add(new THREE.CylinderGeometry(0.13, 0.13, 2.4, 8).rotateZ(Math.PI / 2), wood, 0, 2.2, -0.4);
  } else if (i === 1) {             // boards hung in the gap: you push through them, the wind doesn't
    for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.28, 1.9, 0.03), board, -0.3 + k * 0.3, 1.0, -0.42, 0, 0, (k - 1) * 0.02);
  } else if (i === 2) {             // a ring of stones, ash in the middle, and the fire
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; add(new THREE.DodecahedronGeometry(0.14, 0), stone, Math.cos(a) * 0.45, 0.12, -7.2 + Math.sin(a) * 0.45, k, k, 0); }
    if (typeof document !== 'undefined') {
      const fl = [], fmat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,160,1)', 'rgba(255,110,30,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      for (let k = 0; k < 10; k++) { const s = new THREE.Sprite(fmat.clone()); s.userData = { t: Math.random(), x: (Math.random() - 0.5) * 0.4, z: -7.2 + (Math.random() - 0.5) * 0.4 }; g.add(s); fl.push(s); }
      const light = new THREE.PointLight('#ff8a3a', 0, 10, 1.5); light.position.set(0, 0.8, -7.2); g.add(light);
      Ld.fire = { fl, light };
    }
  } else {                          // a bed of spruce branches along the wall
    for (let k = 0; k < 7; k++) add(new THREE.BoxGeometry(0.85, 0.06, 0.4), green, 3.0 + (Math.random() - 0.5) * 0.1, 0.08 + (k % 2) * 0.04, -6.9 + k * 0.3, 0, (Math.random() - 0.5) * 0.4, 0);
  }
}

// ---------- what you can do there (work.js findAct asks) ----------
export function denActs(gm, look, offer, sleepAt) {
  const D = gm.den, c = cave(gm), inv = gm.inv, ht = inv.heldType();
  if (!D || !c || !c.open) return;
  const known = gm.known?.has('den');
  for (let i = 0; i < 4; i++) {
    if (D.b[i] || !known || (i === 1 && !D.b[0])) continue;
    const sc = look(at(gm, i), 2.8, 0.75);
    if (!sc) continue;
    const P = PARTS[i], miss = P.need.find(([t, n]) => inv.count(x => x === t) < n);
    offer(sc + 0.04, miss ? { id: 'den' + i, text: `${P.text}: it needs ${miss[1]} ${TYPES[miss[0]].short.toLowerCase()}`, hold: 0 } : { id: 'den' + i, text: `${P.text} (${P.need.map(([t, n]) => `${n} ${TYPES[t].short.toLowerCase()}`).join(', ')})`, hold: P.hold, go: () => {
      if (!P.need.every(([t, n]) => inv.count(x => x === t) >= n)) return;
      for (const [t, n] of P.need) inv.use(x => x === t, n);
      H.act(gm, { a: 'den', op: 'build', i }); H.shout(gm, 'hammer', at(gm, i));
      if (i === 1) H.hint(gm, 'den-sealed', 'The den is sealed: no wind gets in. Build the fire, and it is a home.', 6000, true);
    } });
  }
  if (D.b[2]) {
    const sc = look(at(gm, 2), 2.2, 0.75);
    if (sc) {
      if (ht && TYPES[ht].fuel) offer(sc + 0.06, D.fuel > 800 ? { id: 'pitfull', text: 'The fire has all the wood it can take', hold: 0 } : { id: 'pitfeed', text: `Put ${nameOf(ht, { dry: inv.held().dry })} on the fire`, hold: 0.6, go: () => { const it = inv.take(inv.sel, 1); if (it) { H.act(gm, { a: 'den', op: 'feed', f: TYPES[it.type].fuel * (TYPES[it.type].wood ? Math.max(0.2, it.data.dry ?? 1) : 1) }); SFX.grab(); } } });
      else if (!D.lit && D.fuel > 0) offer(sc + 0.06, { id: 'pitlight', text: 'Light the fire with your lighter', hold: 2, go: () => { H.act(gm, { a: 'den', op: 'light' }); H.shout(gm, 'ignite', at(gm, 2)); } });
      else offer(sc, { id: 'pit', text: D.lit ? `The fire burns (${Math.ceil(D.fuel / 60)} min of wood)` : 'The fire pit: it needs wood', hold: 0 });
    }
  }
  if (D.b[3]) {
    const sc = look(at(gm, 3), 2.2, 0.75), env = gm.env;
    if (sc && (env.hours >= 18 || env.hours < 6.5)) offer(sc + 0.05, { id: 'denbed', text: 'Lie down on the bed of branches and sleep', hold: 1, go: () => sleepAt(gm, at(gm, 3).setY(at(gm, 3).y - 0.05), 0.85) });
  }
}
export function denApply(gm, a) {
  const D = gm.den;
  if (!D) return;
  if (a.op === 'build' && a.i >= 0 && a.i < 4) D.b[a.i] = 1;
  else if (a.op === 'feed') D.fuel = Math.min(900, D.fuel + (+a.f || 0));
  else if (a.op === 'light' && D.fuel > 0 && D.b[2]) D.lit = 1;
}
export const denSnap = gm => (gm.den ? { b: gm.den.b, fuel: Math.round(gm.den.fuel), lit: gm.den.lit, temp: Math.round(gm.den.temp * 100) / 100 } : null);
export function denLoad(gm, s) { if (gm.den && s) Object.assign(gm.den, { b: Array.isArray(s.b) ? s.b.map(x => x | 0) : [0, 0, 0, 0], fuel: +s.fuel || 0, lit: s.lit | 0, temp: +s.temp || 0 }); }
