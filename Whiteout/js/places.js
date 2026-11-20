// Whiteout: places out on the island (build step 7a, design.md 5).
//  * The tail section: the back of the plane broke off as it came down through the trees, and lies beside the
//    trail it tore, about 100 m behind the wreck. Its red fin stands above the trees. Inside: the baggage hold, a
//    tipped-over galley cart, the plane's survival pack, the flight recorder; burst luggage in the snow around it.
//  * The camp: the trawler Nordstjerna's crew camped in a clearing to the west and died there. A red rag on a tall
//    pole above the trees, a standing tent and a collapsed one, the dead fire with one of them still sitting at it,
//    a sled, and their supply box. The journal lies in the tent.
// Both are built where island.js says, on the ground as it is. Trees and rocks in the way are hidden (not taken out of
// the list: saves count trees by their place in it). What lies there is remembered in wld.loot, so a game saved
// before these places existed gets it laid out again when it is loaded (sync.js).
// Containers (suitcases, the survival pack, the supply box) are loose things with kind 'case': hold the use key to
// open one (finds.js); the host lets what is inside fall out, and the open lid is shared and saved.
import * as THREE from 'three';
import * as ISL from './island.js';
import { makeBody, pose } from './body.js';
import { planeTex } from './scene.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export function makePlaces(R, wld, scene, K) {
  wld.places = []; wld.loot = [];
  // (each thing laid out is marked with the version that added it: 1 the tail and the camp, 2 the caves, 3 the den plan;
  // a save from before gets what came after it laid out when it is loaded: sync.js)
  let LV = 1;
  const loot = (M, type, x, y, z, rx = 0, ry = 0, rz = 0, extra = {}) => wld.loot.push([LV, M, type, x, y, z, rx, ry, rz, extra]);
  makeTail(R, wld, scene, K, loot);
  makeCamp(R, wld, scene, K, loot);
  LV = 2;
  // the caves (step 7c)
  wld.caves = {};
  makeCave(R, wld, scene, K, loot, { id: 'icecave', at: ISL.ICECAVE, name: 'The ice cave', text: 'A cave in the rocks, out of the wind. Inside, the ice glows blue.', contents: arne });
  makeCave(R, wld, scene, K, loot, { id: 'snowcave', at: ISL.SNOWCAVE, name: 'A cave behind the drift', text: 'The storm has blown the snow out of a cave\'s mouth. Somebody stored things in here, long ago.', blocked: true, contents: cache });
  LV = 3;
  { const M = wld.caves.snowcave.M; loot(M, 'plan', -1.6, 0.08, -8.9, 0, 0.7, 0); }      // step 7e: the old hunter's plan for a winter den, by his cache
  // the watchtower (world.js builds it): a place to find, and its cabin is out of the wind
  wld.places.push({ id: 'tower', name: 'The watchtower', pos: wld.tower.base, r: 30, shelter: 'tower', text: 'An old watchtower on the hill. Stairs wind up round it to a cabin at the top.', inside: wld.tower.inside });
  wld.spawnLoot = (from = 1) => { for (const a of wld.loot) if (a[0] >= from) K.placeItem(wld, ...a.slice(1)); };
  wld.spawnLoot();
  // inside a place out of the wind: 'tail', 'tent' or ''
  wld.shelter = p => { for (const pl of wld.places) if (pl.inside(p)) return pl.shelter; return ''; };
  // a container opens: its lid swings up (everyone); returns where it is (the host lets the loot out there)
  wld.openCase = i => {
    const p = wld.props[i];
    if (!p || p.kind !== 'case' || p.open || p.gone) return null;
    p.open = true;
    const par = p.mesh.geometry?.parameters;
    if (par) {
      const hinge = new THREE.Group(); hinge.position.set(0, par.height / 2, -par.depth / 2); hinge.rotation.x = -1.9;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(par.width, 0.03, par.depth), p.mesh.material); lid.position.set(0, 0.015, par.depth / 2); lid.castShadow = true;
      hinge.add(lid);
      const inside = new THREE.Mesh(new THREE.BoxGeometry(par.width - 0.04, 0.012, par.depth - 0.04), new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 1 }));
      inside.position.y = par.height / 2 - 0.004;
      p.mesh.add(hinge, inside);
    }
    return p.mesh.position.clone();
  };
}

// clear trees, rocks and the branches and stones lying about out of a place's way
function clear(wld, x, z, r) {
  for (const t of wld.trees) {
    if (!t.up || Math.hypot(t.x - x, t.z - z) > r) continue;
    t.up = false; t.gone = true;
    t.im.setMatrixAt(t.j, HIDE); t.im.instanceMatrix.needsUpdate = true;
    if (t.col) { wld.treeByCol.delete(t.col.handle); wld.phys.removeCollider(t.col, true); t.col = null; }
  }
  for (const k of wld.rocks || []) {
    if (!k.col || Math.hypot(k.x - x, k.z - z) > r + k.s) continue;
    wld.rockIM.setMatrixAt(k.i, HIDE); wld.phys.removeCollider(k.col, true); k.col = null;
    wld.rockIM.instanceMatrix.needsUpdate = true;
  }
  for (const it of [...wld.stash.list.values()]) if (Math.hypot(it.mesh.position.x - x, it.mesh.position.z - z) < r) wld.stash.remove(it.id);
}
// a container: a box you can push about and open
function addCase(R, wld, M, q0, w, h, d, color, lx, ly, lz, yaw, label, items) {
  _v.set(lx, ly, lz).applyMatrix4(M);
  const q = q0.clone().multiply(_q.setFromEuler(_e.set(0, yaw, 0)));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  wld.addProp(mesh, [R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setDensity(110)], _v.x, _v.y + h / 2, _v.z, q);
  Object.assign(wld.props[wld.props.length - 1], { kind: 'case', label, loot: items, open: false });
}
// a dead body, sitting, baked into a batch (it never moves)
function sitter(B, g, look, x, y, z, ry, tilt) {
  const P = makeBody(look);
  P.g.position.set(x, y, z); P.g.rotation.y = ry;
  pose(P, { sit: 1, slump: 1, tilt });
  g.add(P.g); g.updateMatrixWorld(true);
  const toLocal = g.matrixWorld.clone().invert();
  P.g.traverse(o => { if (o.isMesh) B.raw(o.material, o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld))); });
  g.remove(P.g);
}

// ---------- the tail section ----------
// Its own coordinates: z along the fuselage, the torn-open front at z = 0 facing the wreck, the hold towards -z, the
// rear bulkhead at z = -5, then the tail cone with the engines and the fin. The floor is at y = 0.12.
function makeTail(R, wld, scene, K, loot) {
  const T = ISL.TAIL, ry = Math.atan2(ISL.WRECK.x - T.x, ISL.WRECK.z - T.z), sy = Math.sin(ry), cy = Math.cos(ry), FL = 0.12, LEN = 5;
  const toW = (lx, lz) => [T.x + lx * cy + lz * sy, T.z - lx * sy + lz * cy];
  { const [cx, cz] = toW(0, -4); clear(wld, cx, cz, 12); }
  // high enough that the snow never comes up through the floor; a ramp at the front if it stands proud
  let y0 = -1e9;
  for (let k = 0; k <= LEN; k++) for (const s of [-1.2, 0, 1.2]) { const [x, z] = toW(s, -k); y0 = Math.max(y0, wld.groundY(x, z)); }
  y0 -= 0.08;
  const g = new THREE.Group(); g.position.set(T.x, y0, T.z); g.rotation.set(0, ry, 0.04); scene.add(g);
  const add = (geo, mat, x, y, z, rx = 0, ry2 = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry2, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const hull = new THREE.MeshStandardMaterial({ map: planeTex(), roughness: 0.45, metalness: 0.55 });
  const lining = K.std('#6e6a63', { roughness: 0.85, side: THREE.BackSide }), metal = K.std('#b9c0c8', { roughness: 0.4, metalness: 0.7 }), charred = K.std('#1c1a19', { roughness: 1 });
  const floorM = K.std('#3b3f44', { roughness: 0.7, metalness: 0.4 }), red = K.std('#9a2b22', { roughness: 0.5, metalness: 0.4 }), dark = K.std('#15181c', { roughness: 0.6, metalness: 0.3 }), snow = K.snowMat();
  const net = K.std('#2a2620', { roughness: 1 }), cart = K.std('#c9ccd0', { roughness: 0.35, metalness: 0.6 });
  const sol = K.solids(R, wld.phys, g), B = new K.Batch(g);
  // the fuselage, its lining, the tail cone, the rear bulkhead
  add(new THREE.CylinderGeometry(1.5, 1.5, LEN, 28, 1, true), hull, 0, 1.0, -LEN / 2, Math.PI / 2);
  add(new THREE.CylinderGeometry(1.45, 1.45, LEN, 28, 1, true), lining, 0, 1.0, -LEN / 2, Math.PI / 2).castShadow = false;
  add(new THREE.CylinderGeometry(0.6, 1.5, 3.6, 24, 1, true), hull, 0, 1.0, -LEN - 1.8, -Math.PI / 2);
  add(new THREE.CircleGeometry(0.6, 20), hull, 0, 1.0, -LEN - 3.6, 0, Math.PI, 0);
  add(new THREE.CircleGeometry(1.46, 28), K.std('#5d5a54', { roughness: 0.9, side: THREE.DoubleSide }), 0, 1.0, -LEN + 0.01);
  B.box(dark, 0.5, 0.6, 0.03, 0.55, FL + 0.9, -LEN + 0.04, 0, 0, 0.12); B.box(K.std('#5d5a54'), 0.5, 0.6, 0.03, 0.95, FL + 0.72, -LEN + 0.25, 0, -1.1, 0);      // the access panel, hanging open
  sol.box(3.0, 2.6, 0.12, 0, 1.0, -LEN);
  sol.cyl(1.15, 3.4, 0, 1.0, -LEN - 1.8, Math.PI / 2, 0, 0);
  // the shell you can't walk through, and the floor (the cargo hold: bare metal with tie-down rails)
  const a0 = Math.asin((FL - 1.0) / 1.55), a1 = Math.PI - a0, n = 14;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n, w = 2 * 1.62 * Math.sin((a1 - a0) / n / 2) + 0.06;
    sol.box(w, 0.12, LEN, Math.cos(a) * 1.62, 1.0 + Math.sin(a) * 1.62, -LEN / 2, 0, 0, a - Math.PI / 2, 0.5);
  }
  B.box(floorM, 2.5, 0.06, LEN - 0.1, 0, FL - 0.03, -LEN / 2); sol.box(2.6, 0.42, LEN, 0, FL - 0.21, -LEN / 2, 0, 0, 0, 0.8);
  for (const x of [-0.8, 0, 0.8]) B.box(dark, 0.05, 0.015, LEN - 0.3, x, FL + 0.007, -LEN / 2);
  // cargo nets on the walls, a tipped-over galley cart by the opening
  for (const s of [-1, 1]) { for (let k = 0; k < 6; k++) B.box(net, 0.02, 1.2, 0.03, s * 1.32, FL + 0.95, -0.8 - k * 0.7); for (const y of [0.55, 1.05, 1.5]) B.box(net, 0.02, 0.03, 3.6, s * 1.32, FL + y, -2.55); }
  B.box(cart, 0.8, 0.42, 0.32, 0.75, FL + 0.21, -1.0, 0, 0.4, 0); sol.box(0.8, 0.42, 0.32, 0.75, FL + 0.21, -1.0, 0, 0.4, 0);
  B.box(cart, 0.3, 0.42, 0.02, 1.2, FL + 0.21, -0.75, 0, 1.4, 0);
  // the torn-open front: ragged metal round the hole
  for (let i = 0; i < 22; i++) {
    const a = a0 + (a1 - a0) * i / 21 + (Math.random() - 0.5) * 0.15, r = 1.47 + Math.random() * 0.12;
    B.box(Math.random() < 0.5 ? charred : metal, 0.12 + Math.random() * 0.3, 0.3 + Math.random() * 0.45, 0.04, Math.cos(a) * r, 1.0 + Math.sin(a) * r, 0.05 + Math.random() * 0.15, (Math.random() - 0.5) * 0.8, 0, a + Math.PI / 2 + (Math.random() - 0.5) * 0.5);
  }
  // the fin (red, like the rest of the livery: it shows above the trees), the T-tail, the two engines
  const fin = add(new THREE.BoxGeometry(0.22, 3.0, 2.2), red, 0, 3.25, -LEN - 2.7, -0.35); K.solidMesh(R, wld.phys, fin);
  add(new THREE.BoxGeometry(5.0, 0.12, 1.1), metal, 0, 4.75, -LEN - 3.4, 0, 0, 0.02);
  for (const s of [-1, 1]) {
    const nac = add(new THREE.CylinderGeometry(0.5, 0.42, 2.2, 16), metal, s * 1.85, 1.5, -LEN - 1.1, Math.PI / 2); K.solidMesh(R, wld.phys, nac);
    add(new THREE.CircleGeometry(0.44, 16), dark, s * 1.85, 1.5, -LEN + 0.01, 0, 0, 0);
    B.box(metal, 0.5, 0.14, 1.0, s * 1.35, 1.4, -LEN - 1.1);
  }
  // snow: on the roof, piled against the sides, blown in through the opening
  B.box(snow, 1.3, 0.28, LEN - 0.3, 0, 2.55, -LEN / 2 + 0.1, 0, 0, 0.1);
  for (const [x, z, a, h] of [[1.9, -1.5, 1.6, 0.55], [-1.9, -3.0, 1.8, 0.65], [1.7, -6.5, 1.5, 0.5], [-1.6, -7.0, 1.4, 0.45], [0, -9.2, 1.3, 0.5]]) B.geo(snow, K.mound(a, h, a * 1.4), x, -0.05, z);
  B.geo(snow, K.mound(0.8, 0.12, 0.6), -0.5, FL, -0.4);
  // the front sits above the snow: a ramp of torn floor down to it
  {
    const [fx, fz] = toW(0, 0.9), drop = y0 + FL - wld.groundY(fx, fz);
    if (drop > 0.08) { const L = Math.max(0.9, drop / 0.4), ang = Math.atan2(drop, L); B.box(floorM, 2.3, 0.06, L, 0, FL - drop / 2 - 0.03, L / 2, ang); sol.box(2.4, 0.1, L + 0.05, 0, FL - drop / 2 - 0.05, L / 2, ang, 0, 0, 0.8); }
  }
  // the wreckage around it, and the luggage that burst out of the hold
  for (const [x, z, w, d, a] of [[3.2, 1.5, 1.0, 0.6, 0.4], [-2.8, 2.6, 0.7, 1.1, 1.3], [2.4, -3.2, 0.5, 0.9, 2.1], [-3.4, -1.6, 1.2, 0.4, 0.2], [4.6, 4.2, 0.8, 0.5, 2.8]]) {
    const [wx, wz] = toW(x, z), gy = wld.groundY(wx, wz) - y0;
    B.box(Math.random() < 0.5 ? metal : charred, w, 0.08, d, x, gy + 0.03, z, 0, a, 0.05);
  }
  B.build();
  g.updateMatrixWorld(true);
  const M = g.matrixWorld.clone(), inv = M.clone().invert(), q0 = new THREE.Quaternion().setFromRotationMatrix(M);
  const gy = (lx, lz) => { const [x, z] = toW(lx, lz); return wld.groundY(x, z) - y0; };
  // the containers: two suitcases in the hold, the plane's orange survival pack by the bulkhead, two burst open in the snow
  addCase(R, wld, M, q0, 0.62, 0.24, 0.42, '#3a2f5a', -0.7, FL + 0.02, -3.5, 0.3, 'the suitcase', [['silk', 2], ['snack', 1]]);
  addCase(R, wld, M, q0, 0.66, 0.26, 0.44, '#7a6a4a', 0.6, FL + 0.02, -2.3, -0.5, 'the suitcase', [['caviar', 2]]);
  addCase(R, wld, M, q0, 0.55, 0.3, 0.35, '#e0601a', 0.6, FL + 0.02, -4.45, 0.1, 'the plane\'s survival pack', [['shells', 1], ['kit', 1], ['shovel', 1]]);
  addCase(R, wld, M, q0, 0.62, 0.24, 0.42, '#22324a', 2.7, gy(2.7, 1.9) + 0.02, 1.9, 1.1, 'the suitcase', [['silk', 1], ['champ', 1]]);
  addCase(R, wld, M, q0, 0.6, 0.24, 0.42, '#5a1e2a', -3.1, gy(-3.1, 3.6) + 0.02, 3.6, 2.4, 'the suitcase', [['snack', 2]]);
  // what lies about: the flight recorder (broken out of its mount behind the bulkhead), caviar from the galley, scarves in the snow
  loot(M, 'blackbox', -0.45, FL + 0.09, -4.7, 0, 0.6, 0);
  loot(M, 'caviar', 0.95, FL + 0.02, -1.45, 0, 1.1, 0);
  loot(M, 'silk', 1.9, gy(1.9, 3.0) + 0.02, 3.0, 0, 0.7, 0);
  loot(M, 'silk', -2.2, gy(-2.2, 4.4) + 0.02, 4.4, 0, 2.2, 0);
  const [px, pz] = toW(0, -3);
  wld.places.push({ id: 'tail', name: 'The tail section', pos: new THREE.Vector3(px, y0, pz), r: 26, shelter: 'tail', wake: new THREE.Vector3(0, FL + 0.05, -2.6).applyMatrix4(M),
    text: 'The back of Flight 2207, torn off as it came down through the trees. The baggage hold is still in one piece.',
    inside: p => { _v.copy(p).applyMatrix4(inv); return Math.abs(_v.x) < 1.35 && _v.z < 0.3 && _v.z > -LEN && _v.y > -0.4 && _v.y < 2.5; } });
}

// ---------- the caves (step 7c) ----------
// Built on the ground as a hollow outcrop of rock: a tunnel (2.4 m wide) into a chamber (9 × 8 m, 3.4 m high), the
// floor levelled, boulders over the outside, icicles and ice columns inside that glow faintly blue. Deep inside the
// daylight doesn't reach (game.js darkens the world: your lighter or a torch helps). Its own coordinates: the mouth at
// z = 0 facing the shack, the chamber from z = -3 to -11.
function makeCave(R, wld, scene, K, loot, o) {
  const C = o.at, ry = Math.atan2(ISL.SHACK.x - C.x, ISL.SHACK.z - C.z), sy = Math.sin(ry), cy = Math.cos(ry);
  const toW = (lx, lz) => [C.x + lx * cy + lz * sy, C.z - lx * sy + lz * cy];
  { const [cx, cz] = toW(0, -5.5); clear(wld, cx, cz, 11); }
  let y0 = -1e9;
  for (let lx = -4.5; lx <= 4.5; lx += 1.5) for (let lz = 0; lz >= -11; lz -= 1.5) { const [x, z] = toW(lx, lz); y0 = Math.max(y0, wld.groundY(x, z)); }
  const g = new THREE.Group(); g.position.set(C.x, y0, C.z); g.rotation.y = ry; scene.add(g);
  const rock = K.std('#4a4e55', { roughness: 0.95, flatShading: true }), rock2 = K.std('#5d626a', { roughness: 0.95, flatShading: true }), snow = K.snowMat();
  const ice = new THREE.MeshStandardMaterial({ color: '#a8d8f0', emissive: '#3a8cc8', emissiveIntensity: 0.55, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.85 });
  const sol = K.solids(R, wld.phys, g), B = new K.Batch(g);
  const wall = (w, h, d, x, yy, z, rx = 0, ry2 = 0, rz = 0) => { B.box(rock, w, h, d, x, yy, z, rx, ry2, rz); sol.box(w, h, d, x, yy, z, rx, ry2, rz); };
  // the floor, levelled, and the walls and the roof
  wall(9.6, 0.8, 11.6, 0, -0.35, -5.6);
  wall(1.2, 2.6, 3.2, -1.8, 1.3, -1.4); wall(1.2, 2.6, 3.2, 1.8, 1.3, -1.4); wall(4.8, 1.0, 3.2, 0, 3.0, -1.4);
  wall(1.2, 3.5, 8.8, -5.1, 1.75, -7.1); wall(1.2, 3.5, 8.8, 5.1, 1.75, -7.1); wall(11.4, 3.5, 1.2, 0, 1.75, -11.6);
  wall(3.3, 3.5, 1.2, -2.85, 1.75, -2.6); wall(3.3, 3.5, 1.2, 2.85, 1.75, -2.6); wall(11.4, 1.4, 10.2, 0, 4.15, -7.0);
  // lumps of rock along the inside walls, so it isn't a box
  for (let i = 0; i < 16; i++) { const side = i % 2 ? 1 : -1, z = -3.6 - (i >> 1) * 0.95; B.geo(rock2, new THREE.DodecahedronGeometry(0.45 + (i * 37 % 10) / 25, 0), side * 4.45, 0.5 + (i % 3) * 0.9, z, i, i * 2, 0); }
  // boulders over the outside, and snow on top
  const outer = [[-3.2, 0.5], [3.2, 0.5], [-5.6, -2.5], [5.6, -2.5], [-6.0, -6.5], [6.0, -6.5], [-5.4, -10.5], [5.4, -10.5], [0, -12.6], [-3, -12.4], [3, -12.4]];
  outer.forEach(([x, z], i) => { const r = 2.2 + (i * 53 % 10) / 12; B.geo(rock2, new THREE.DodecahedronGeometry(r, 0).scale(1, 0.9, 1), x, r * 0.55, z, i * 0.7, i * 1.3, 0); sol.ball(r * 0.75, x, r * 0.5, z); });
  for (const [x, z, s] of [[0, -7, 5.2], [-2.5, -3.5, 2.6], [2.6, -9.5, 3]]) B.geo(snow, K.mound(s, 0.9, s * 0.8), x, 4.85, z);
  B.geo(snow, K.mound(2.4, 0.6, 1.4), 0, 3.5, -0.4);
  // the ice: icicles from the roof, columns where they reached the floor, a frozen pool
  for (let i = 0; i < 22; i++) { const x = -3.8 + (i * 47 % 76) / 10, z = -3.6 - (i * 29 % 70) / 10, h = 0.4 + (i * 13 % 9) / 10; B.geo(ice, new THREE.ConeGeometry(0.09 + (i % 3) * 0.04, h, 6).rotateX(Math.PI), x, 3.4 - h / 2, z); }
  for (const [x, z] of [[-3.6, -10.4], [3.9, -4.2], [-3.9, -5.0]]) { B.geo(ice, new THREE.CylinderGeometry(0.16, 0.28, 3.4, 7), x, 1.7, z); sol.cyl(0.25, 3.4, x, 1.7, z); }
  B.geo(ice, new THREE.CircleGeometry(1.3, 18).rotateX(-Math.PI / 2), -1.8, 0.07, -8.6);
  const glow = new THREE.PointLight('#5ab4f0', 1.4, 11, 1.5); glow.position.set(0, 2.4, -7.5); g.add(glow);
  // a mouth snowed shut (until a storm blows it clear: daily.js)
  let plug = null, plugCol = null;
  if (o.blocked) {
    plug = new THREE.Mesh(K.mound(2.4, 2.6, 2.2), snow); plug.position.set(0, 0, 0.6); plug.castShadow = true; plug.receiveShadow = true; g.add(plug);
    plugCol = sol.box(3.2, 2.6, 1.6, 0, 1.3, 0.2);
  }
  // the front stands above the ground: a ramp of packed snow down to it
  { const [fx, fz] = toW(0, 1), drop = y0 + 0.05 - wld.groundY(fx, fz);
    if (drop > 0.08) { const Lr = Math.max(0.9, drop / 0.4), ang = Math.atan2(drop, Lr); B.box(snow, 2.4, 0.1, Lr, 0, 0.05 - drop / 2 - 0.05, Lr / 2, ang); sol.box(2.4, 0.12, Lr + 0.05, 0, 0.05 - drop / 2 - 0.06, Lr / 2, ang); } }
  g.updateMatrixWorld(true);
  const M = g.matrixWorld.clone(), inv = M.clone().invert(), q0 = new THREE.Quaternion().setFromRotationMatrix(M);
  o.contents?.(R, wld, g, M, q0, B, sol, loot, K);
  B.build();
  const inside = p => { _v.copy(p).applyMatrix4(inv); return _v.y > -0.5 && _v.y < 3.2 && ((Math.abs(_v.x) < 1.2 && _v.z < 0.2 && _v.z > -3) || (Math.abs(_v.x) < 4.5 && _v.z <= -3 && _v.z > -11)); };
  const cave = wld.caves[o.id] = { open: !o.blocked, M, inside,
    // how dark it is here: none at the mouth, all of it deep in the chamber
    dark: p => { if (!cave.open || !inside(p)) return 0; _v.copy(p).applyMatrix4(inv); return Math.min(1, Math.max(0, (-_v.z - 1) / 4)); },
    setOpen: b => { if (b === cave.open) return; cave.open = b; if (plug) plug.visible = !b; if (b && plugCol) { wld.phys.removeCollider(plugCol, true); plugCol = null; } } };
  const [px, pz] = toW(0, -5);
  wld.places.push({ id: o.id, name: o.name, text: o.text, pos: new THREE.Vector3(px, y0, pz), r: 22, shelter: 'cave', inside: p => cave.open && inside(p), hidden: () => !cave.open, wake: new THREE.Vector3(1.5, 0.1, -6).applyMatrix4(M) });
}
// what lies in the ice cave: Arne, the trawler's skipper, sitting against the back wall, with his notebook and his things
function arne(R, wld, g, M, q0, B, sol, loot, K) {
  B.box(K.std('#4a4e55', { roughness: 0.95, flatShading: true }), 1.1, 0.5, 0.7, 3.0, 0.25, -10.6); sol.box(1.1, 0.5, 0.7, 3.0, 0.25, -10.6);
  sitter(B, g, { coat: '#2f3e52', skin: '#c3ccd3', hair: '#d9e0e4', pants: '#2a2f36' }, 3.0, -0.05, -10.45, 0, -0.3);
  sol.box(0.55, 1.2, 0.55, 3.0, 0.6, -10.25);
  loot(M, 'journal2', 2.35, 0.06, -9.9, 0, 0.5, 0);
  loot(M, 'picks', 3.7, 0.06, -9.7, 0, 1.2, 0);
  loot(M, 'beans', 2.6, 0.08, -10.3, 0, 0, 0);
}
// what lies in the snowed-in cave: an old cache, a few dry logs
function cache(R, wld, g, M, q0, B, sol, loot) {
  addCase(R, wld, M, q0, 0.75, 0.45, 0.5, '#5d4a33', -2.4, 0.06, -8.4, 0.4, 'the old cache', [['shells', 1], ['beans', 2], ['sheet', 1]]);
  for (const k of [0, 1]) loot(M, 'log', 2.5, 0.2 + k * 0.26, -9.8, 0, 0.2 + k * 0.1, 0, { data: { dry: 1 } });
  loot(M, 'stone', 1.2, 0.08, -10.2, 0.3, 0.5, 0);
}

// ---------- the dead survivors' camp ----------
// Its own coordinates: the dead fire at the middle; the standing tent to the west of it (-x) with its open end to the
// fire, the collapsed one behind (-z), the sled and the supply box to the east, the pole with the red rag.
function makeCamp(R, wld, scene, K, loot) {
  const C = ISL.CAMP, sy = Math.sin(C.ry), cy = Math.cos(C.ry);
  const toW = (lx, lz) => [C.x + lx * cy + lz * sy, C.z - lx * sy + lz * cy];
  clear(wld, C.x, C.z, 10);
  const y0 = wld.groundY(C.x, C.z), gy = (lx, lz) => { const [x, z] = toW(lx, lz); return wld.groundY(x, z) - y0; };
  const g = new THREE.Group(); g.position.set(C.x, y0, C.z); g.rotation.y = C.ry; scene.add(g);
  const canvas = K.std('#6b6a4a', { roughness: 1, side: THREE.DoubleSide }), canvas2 = K.std('#55543a', { roughness: 1, side: THREE.DoubleSide }), wood = K.std('#4e3a28', { roughness: 0.95 });
  const stone = K.std('#5d6168', { roughness: 0.95, flatShading: true }), coal = K.std('#141210', { roughness: 1 }), rag = K.std('#a3201c', { roughness: 0.9, side: THREE.DoubleSide }), snow = K.snowMat(), bag = K.std('#3d5a7a', { roughness: 0.9 });
  const sol = K.solids(R, wld.phys, g), B = new K.Batch(g);
  // the dead fire: a ring of stones, charcoal, half-burnt sticks
  const f0 = gy(0, 0);
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; B.geo(stone, new THREE.DodecahedronGeometry(0.15, 0).scale(1.2, 0.8, 1), Math.cos(a) * 0.55, f0 + 0.06, Math.sin(a) * 0.55, i, i * 2, 0); }
  B.geo(coal, new THREE.CircleGeometry(0.45, 14).rotateX(-Math.PI / 2), 0, f0 + 0.02, 0);
  for (const a of [0.3, 1.5, 2.6]) B.geo(coal, new THREE.CylinderGeometry(0.04, 0.05, 0.8, 6).rotateZ(Math.PI / 2), 0, f0 + 0.07, 0, 0, a, 0.1);
  // the log by the fire, and the last of them sitting on it, frozen, facing the ashes
  const lx = 1.2, lz = 0.25, l0 = gy(lx, lz);
  B.geo(wood, new THREE.CylinderGeometry(0.22, 0.24, 1.9, 10).rotateX(Math.PI / 2), lx, l0 + 0.2, lz); sol.box(0.46, 0.44, 1.9, lx, l0 + 0.2, lz);
  sitter(B, g, { coat: '#8f99a2', skin: '#c6d0d7', hair: '#dfe6eb', pants: '#3a4048' }, lx + 0.04, l0 - 0.08, lz + 0.3, -Math.PI / 2, 0.35);
  sol.box(0.55, 1.2, 0.55, lx - 0.1, l0 + 0.6, lz + 0.3);
  B.geo(snow, K.mound(0.35, 0.08, 0.3), lx - 0.2, l0 + 0.95, lz + 0.3);       // snow settled on them
  // the standing tent: an A-frame of canvas, open towards the fire, the far end closed
  const tx = -2.6, tz = -0.3, t0 = gy(tx, tz), RL = 2.6, HH = 1.95, HW = 1.35, slant = Math.atan2(HH, HW), plen = Math.hypot(HH, HW);
  for (const s of [-1, 1]) { B.box(canvas, RL, 0.035, plen, tx, t0 + HH / 2, tz + s * HW / 2, s * slant); sol.box(RL, 0.06, plen, tx, t0 + HH / 2, tz + s * HW / 2, s * slant); }
  { const sh = new THREE.Shape(); sh.moveTo(-HW, 0); sh.lineTo(HW, 0); sh.lineTo(0, HH); sh.closePath(); B.geo(canvas2, new THREE.ShapeGeometry(sh).rotateY(Math.PI / 2), tx - RL / 2, t0, tz); sol.box(0.06, HH, HW * 1.6, tx - RL / 2, t0 + HH / 2, tz); }
  B.box(canvas2, 0.04, 1.2, 0.7, tx + RL / 2 + 0.15, t0 + 0.6, tz + 0.75, 0, -0.6, 0.15);        // the flap, tied back
  for (const s of [-1, 1]) B.geo(wood, new THREE.CylinderGeometry(0.025, 0.025, HH + 0.15, 5), tx + s * RL / 2, t0 + (HH + 0.15) / 2, tz);
  B.box(bag, 1.8, 0.12, 0.7, tx - 0.1, t0 + 0.06, tz);
  // the collapsed tent behind, under the snow, one pole still standing crooked
  { const cx = 0.6, cz = -3.4, c0 = gy(cx, cz); B.box(canvas, 2.6, 0.04, 2.0, cx, c0 + 0.12, cz, 0.05, 0.3, -0.04); B.geo(snow, K.mound(1.2, 0.35, 0.9), cx + 0.3, c0 + 0.1, cz - 0.2); B.geo(wood, new THREE.CylinderGeometry(0.025, 0.025, 1.4, 5), cx - 1.1, c0 + 0.6, cz + 0.6, 0.5, 0, 0.3); sol.box(2.4, 0.3, 1.8, cx, c0 + 0.15, cz, 0, 0.3, 0); }
  // the sled, with what is left of their firewood on it
  const sx = 2.4, sz = -2.0, s0 = gy(sx, sz);
  for (const s of [-1, 1]) B.box(wood, 1.9, 0.05, 0.06, sx, s0 + 0.04, sz + s * 0.32, 0, 0, 0);
  for (let k = 0; k < 6; k++) B.box(wood, 0.12, 0.04, 0.75, sx - 0.8 + k * 0.32, s0 + 0.2, sz);
  for (const s of [-1, 1]) for (const k of [-0.6, 0.6]) B.box(wood, 0.04, 0.16, 0.04, sx + k, s0 + 0.12, sz + s * 0.32);
  B.box(wood, 0.05, 0.05, 0.75, sx + 1.02, s0 + 0.22, sz, 0, 0, 0.5);
  sol.box(1.9, 0.24, 0.75, sx, s0 + 0.12, sz);
  // the pole with the red rag, tall enough to show above the trees
  { const px = -1.0, pz = 2.7, p0 = gy(px, pz); B.geo(wood, new THREE.CylinderGeometry(0.045, 0.06, 9, 6), px, p0 + 4.4, pz); sol.cyl(0.06, 9, px, p0 + 4.4, pz); B.box(rag, 0.02, 0.55, 1.1, px, p0 + 8.4, pz + 0.58, 0.08, 0, 0); }
  // drifts round the camp
  for (const [x, z, a, h] of [[-4.6, 1.6, 1.4, 0.4], [3.8, 1.8, 1.2, 0.3], [-1.2, -4.8, 1.6, 0.45], [4.4, -3.6, 1.3, 0.35]]) B.geo(snow, K.mound(a, h, a * 0.8), x, gy(x, z) - 0.02, z);
  B.build();
  g.updateMatrixWorld(true);
  const M = g.matrixWorld.clone(), inv = M.clone().invert(), q0 = new THREE.Quaternion().setFromRotationMatrix(M);
  // their supply box beside the sled, the journal and a folded parka in the tent
  addCase(R, wld, M, q0, 0.7, 0.42, 0.5, '#6d5a3c', 2.9, gy(2.9, -0.8) + 0.02, -0.8, 0.3, 'the supply box', [['shells', 2], ['beans', 2]]);
  loot(M, 'journal', tx + 0.45, t0 + 0.15, tz + 0.1, 0, 0.4, 0);
  loot(M, 'parka', tx - 0.6, t0 + 0.16, tz - 0.1, 0, 0.2, 0);
  for (const k of [0, 1, 2]) loot(M, 'log', sx - 0.5 + k * 0.32, s0 + 0.36, sz, 0, Math.PI / 2, 0, { data: { dry: 1 } });      // what is left of their firewood, on the sled
  wld.places.push({ id: 'camp', name: 'The camp', pos: new THREE.Vector3(C.x, y0, C.z), r: 24, shelter: 'tent',
    text: 'Two tents, a sled and a dead fire. Somebody camped here, a long time ago, and never left.',
    inside: p => { _v.copy(p).applyMatrix4(inv); return Math.abs(_v.x - tx) < RL / 2 && Math.abs(_v.z - tz) < 0.95 && _v.y - t0 < 1.5 && _v.y - t0 > -0.4; } });
}
