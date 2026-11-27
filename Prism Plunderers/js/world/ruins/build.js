// Builds The Ruins from its layout (layout.js): the boxes merged into one mesh per surface kind per 100 m chunk
// (a few draw calls for a whole district; chunks far from you are hidden), the physics colliders, the painted
// ground (groundmap.js) with the hole over the Underground Base ramp, Prism crystals, the crashed pod, dunes, signs,
// and the loot containers you search with E (their contents rolled from the map's seed the first time anyone
// opens them).
import * as THREE from 'three';
import { makeRuins, zoneAt, HALF } from './layout.js';
import { craterY } from './landmarks.js';
import { K, FLOOR, CONTAINER_H } from './kit.js';
import { paintGround, groundMaterial, G } from './groundmap.js';
import { Interactions } from '../../game/interact.js';
import { CONTAINERS, rollContainer } from '../../game/items.js';
import { makeBox } from '../../game/inventory.js';
import { SHARED } from '../../game/loot.js';
import { disposeTree } from '../../core/engine.js';
import { rng } from '../../core/util.js';
import { bus } from '../../core/events.js';
import { wallPieces } from '../../core/physics.js';
import { S } from '../../core/save.js';
import { GFX } from '../../core/engine.js';

// chunks whose nearest edge is further than the View distance (FAR by default) are hidden; detail (in smaller chunks)
// beyond the Detail distance (NEAR by default), and it casts shadows only within SHADOW_NEAR; beyond LOD a solid
// chunk draws only its bigger boxes (the small ones are last in its mesh). Step 5d (v0.5.4) added the last three;
// part 7 the settings (engine.js GFX; world.graphics() applies a change).
const CHUNK = 100, DCHUNK = 50, FAR = 340, NEAR = 150, LOD = 150, SHADOW_NEAR = 45;
const tiny = b => Math.max(b.w * b.h, b.w * b.d, b.h * b.d) < 0.5;       // a box with no face over half a square metre
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.9 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.86 },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.62 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.94 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.9 },
];
const PANE_N = { n: [0, 0, -1], s: [0, 0, 1], w: [-1, 0, 0], e: [1, 0, 0] };

// a growing set of quads for one merged mesh
class Batch {
  constructor() { this.p = new Float32Array(3 * 4096); this.nm = new Float32Array(3 * 4096); this.c = new Float32Array(3 * 4096); this.ix = new Uint32Array(6 * 1024); this.v = 0; this.i = 0; }
  room(nv, ni) {
    if ((this.v + nv) * 3 > this.p.length) {
      const grow = a => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
      this.p = grow(this.p); this.nm = grow(this.nm); this.c = grow(this.c);
    }
    if (this.i + ni > this.ix.length) { const b = new Uint32Array(this.ix.length * 2); b.set(this.ix); this.ix = b; }
  }
  // four corners in order round the face, its normal, its colour
  quad(pts, n, col) {
    this.room(4, 6);
    const v = this.v;
    for (let k = 0; k < 4; k++) {
      const o = (v + k) * 3, q = pts[k];
      this.p[o] = q.x; this.p[o + 1] = q.y; this.p[o + 2] = q.z;
      this.nm[o] = n.x; this.nm[o + 1] = n.y; this.nm[o + 2] = n.z;
      this.c[o] = col.r; this.c[o + 1] = col.g; this.c[o + 2] = col.b;
    }
    // wind the two triangles so they face along the normal
    const ax = pts[1].x - pts[0].x, ay = pts[1].y - pts[0].y, az = pts[1].z - pts[0].z;
    const bx = pts[2].x - pts[0].x, by = pts[2].y - pts[0].y, bz = pts[2].z - pts[0].z;
    const front = (ay * bz - az * by) * n.x + (az * bx - ax * bz) * n.y + (ax * by - ay * bx) * n.z > 0;
    const I = this.ix, i = this.i;
    if (front) { I[i] = v; I[i + 1] = v + 1; I[i + 2] = v + 2; I[i + 3] = v; I[i + 4] = v + 2; I[i + 5] = v + 3; }
    else { I[i] = v; I[i + 1] = v + 2; I[i + 2] = v + 1; I[i + 3] = v; I[i + 4] = v + 3; I[i + 5] = v + 2; }
    this.v += 4; this.i += 6;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, this.v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nm.slice(0, this.v * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, this.v * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.ix.slice(0, this.i), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const corners = Array.from({ length: 4 }, () => new THREE.Vector3());

// one box's faces into a batch (no bottom face for things standing on the ground or on a floor, where nobody can
// see it; the top in its own colour if it has one)
function emitBox(batch, b, rnd) {
  const turned = b.rx || b.ry || b.rz, y0 = b.y - b.h / 2;
  if (turned) { _e.set(b.rx, b.ry, b.rz, 'YXZ'); _m.makeRotationFromEuler(_e); }
  const vary = 0.94 + rnd() * 0.1;
  const standing = !turned && ((y0 < 0.05 && y0 > -0.5) || (y0 > 3 && Math.abs(y0 / FLOOR - Math.round(y0 / FLOOR)) < 0.003));
  for (const f of FACES) {
    if (f.n[1] === -1 && standing) continue;
    for (let k = 0; k < 4; k++) {
      const q = f.c[k];
      corners[k].set((q[0] - 0.5) * b.w, (q[1] - 0.5) * b.h, (q[2] - 0.5) * b.d);
      if (turned) corners[k].applyMatrix4(_m);
      corners[k].x += b.x; corners[k].y += b.y; corners[k].z += b.z;
    }
    _n.set(f.n[0], f.n[1], f.n[2]);
    if (turned) _n.applyMatrix4(_m).normalize();
    _c.setHex(f.n[1] === 1 && b.t !== undefined ? b.t : b.c).multiplyScalar(b.k === K.GLOW ? 1 : f.shade * vary);
    batch.quad(corners, _n, _c);
  }
}
// one box's 8 corners and 12 triangles (facing out) into a chunk's collision mesh
const BOX_TRIS = [0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6];
function boxTriangles(m, b) {
  const turned = b.rx || b.ry || b.rz, base = m.v.length / 3;
  if (turned) { _e.set(b.rx, b.ry, b.rz, 'YXZ'); _m.makeRotationFromEuler(_e); }
  for (let c = 0; c < 8; c++) {
    _v.set((c & 1 ? 0.5 : -0.5) * b.w, (c & 2 ? 0.5 : -0.5) * b.h, (c & 4 ? 0.5 : -0.5) * b.d);
    if (turned) _v.applyMatrix4(_m);
    m.v.push(_v.x + b.x, _v.y + b.y, _v.z + b.z);
  }
  for (const t of BOX_TRIS) m.i.push(base + t);
}
// a flight's wedge: its side profile runs from one tread before the first riser, up through every step's front
// edge to the top step, flat across it, straight down at the back; pushed out to the stair's width
const WEDGE_TRIS = [0, 2, 4, 0, 4, 6, 1, 3, 5, 1, 5, 7, 0, 2, 3, 0, 3, 1, 2, 4, 5, 2, 5, 3, 4, 6, 7, 4, 7, 5, 6, 0, 1, 6, 1, 7];
function wedgeTriangles(m, w) {
  const run = w.n * w.tread, h = w.n * w.rise, base = m.v.length / 3;
  const profile = [[-w.tread, 0], [run - w.tread, h], [run, h], [run, 0]];
  for (const [a, y] of profile) for (const c of [-w.w / 2, w.w / 2]) {
    if (w.axis === 'x') m.v.push(w.x + w.dir * a, w.y0 + y, w.z + c);
    else m.v.push(w.x + c, w.y0 + y, w.z + w.dir * a);
  }
  for (const t of WEDGE_TRIS) m.i.push(base + t);
}
// a window: a frame (light or dark) and the glass in front of it, each one quad on the wall
function emitPane(batch, p) {
  const n = PANE_N[p.n];
  _n.set(n[0], n[1], n[2]);
  const quad = (o, hw, hh, col) => {
    if (p.n === 'n' || p.n === 's') {
      const z = p.z + n[2] * o;
      corners[0].set(p.x - hw, p.y - hh, z); corners[1].set(p.x + hw, p.y - hh, z); corners[2].set(p.x + hw, p.y + hh, z); corners[3].set(p.x - hw, p.y + hh, z);
    } else {
      const x = p.x + n[0] * o;
      corners[0].set(x, p.y - hh, p.z - hw); corners[1].set(x, p.y - hh, p.z + hw); corners[2].set(x, p.y + hh, p.z + hw); corners[3].set(x, p.y + hh, p.z - hw);
    }
    _c.setHex(col);
    batch.quad(corners, _n, _c);
  };
  quad(0.025, p.w / 2 + 0.09, p.h / 2 + 0.09, (Math.floor(p.x * 3.1 + p.z * 1.7) & 1) ? 0xcfc6b4 : 0x4a4036);
  quad(0.035, p.w / 2, p.h / 2, p.c ?? 0x1c1a19);
}

export function buildRuins(scene, phys, glow, seed = 3000) {
  const L = makeRuins(seed);
  const group = new THREE.Group();
  scene.add(group);
  const items = new Interactions();
  const paint = paintGround(L, seed);
  const mats = {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.03 }),
    pane: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.55 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    ground: paint ? groundMaterial(paint, seed, L) : new THREE.MeshStandardMaterial({ color: 0xcbb38b, roughness: 1, metalness: 0 }),
    dune: new THREE.MeshStandardMaterial({ color: 0xcbb38b, roughness: 1, metalness: 0 }),
    crystal: new THREE.MeshStandardMaterial({ color: 0xb98aff, emissive: 0x8a4dff, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.1, flatShading: true }),
    pod: new THREE.MeshStandardMaterial({ color: 0x150c22, roughness: 0.3, metalness: 0.6, flatShading: true, side: THREE.DoubleSide }),
    podEdge: new THREE.LineBasicMaterial({ color: 0xc49bff }),
  };
  mats.detail = mats.solid;                              // the same look; only drawn nearer

  // ---------- the ground: painted sand, with a hole where the ramp goes down, and its colliders ----------
  const E = 1100;
  const shape = new THREE.Shape([new THREE.Vector2(-E, -E), new THREE.Vector2(E, -E), new THREE.Vector2(E, E), new THREE.Vector2(-E, E)]);
  for (const h of L.holes) shape.holes.push(new THREE.Path([new THREE.Vector2(h.x0, -h.z1), new THREE.Vector2(h.x1, -h.z1), new THREE.Vector2(h.x1, -h.z0), new THREE.Vector2(h.x0, -h.z0)]));
  const gg = new THREE.ShapeGeometry(shape);
  gg.rotateX(-Math.PI / 2);
  const pos = gg.attributes.position, uv = gg.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + G) / (2 * G), (G - pos.getZ(i)) / (2 * G));   // the painted map over -G..G
  uv.needsUpdate = true;
  const ground = new THREE.Mesh(gg, mats.ground);
  ground.receiveShadow = true;
  group.add(ground);
  // the ground's collision: 20 m pieces in triangle meshes, with the holes cut out. Not one big box: the
  // character controller sank 15-21 cm into the old 2.2 km ground boxes (the legs "clipping through the road")
  // and fell through them standing still (Physics.ground)
  const B = HALF + 3;
  const groundMeshes = phys.ground(-B - 20, -B - 20, B + 20, B + 20, { holes: L.holes });
  // the map's edge: walls you cannot see, in 20 m pieces for the same reason
  phys.boxes([[0, -B, 2 * B, 4], [0, B, 2 * B, 4], [-B, 0, 4, 2 * B], [B, 0, 4, 2 * B]]
    .flatMap(([x, z, w, d]) => wallPieces(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, 40)));
  // the crater's bowl: a 2 m grid over the hole cut for it, shaped by craterY, painted like the rest of the ground
  // (the same material: the scorch and the streets' remains run on into it), and its own collision mesh
  for (const b of L.bowls) {
    const nx = Math.round((b.x1 - b.x0) / b.cell), nz = Math.round((b.z1 - b.z0) / b.cell);
    const bp = new Float32Array((nx + 1) * (nz + 1) * 3), bu = new Float32Array((nx + 1) * (nz + 1) * 2), bi = [];
    for (let j = 0, k = 0; j <= nz; j++) for (let i = 0; i <= nx; i++, k++) {
      const x = b.x0 + (b.x1 - b.x0) * i / nx, z = b.z0 + (b.z1 - b.z0) * j / nz;
      bp[k * 3] = x; bp[k * 3 + 1] = craterY(x, z); bp[k * 3 + 2] = z;
      bu[k * 2] = (x + G) / (2 * G); bu[k * 2 + 1] = (G - z) / (2 * G);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, c = a + nx + 1; bi.push(a, c, a + 1, a + 1, c, c + 1); }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    bg.setAttribute('uv', new THREE.BufferAttribute(bu, 2));
    bg.setIndex(bi);
    bg.computeVertexNormals();
    const bm = new THREE.Mesh(bg, mats.ground);
    bm.receiveShadow = true;
    group.add(bm);
    phys.mesh(bp, new Uint32Array(bi));
  }

  // ---------- every box: its collider, and its faces into its chunk's mesh ----------
  const batches = new Map();
  const chunkOf = (x, z, s = CHUNK) => [Math.floor((x + 2000) / s), Math.floor((z + 2000) / s)];
  const batchFor = (x, z, kind) => {
    const s = kind === 'detail' ? DCHUNK : CHUNK, [i, j] = chunkOf(x, z, s), key = `${i},${j},${kind}`;
    let b = batches.get(key);
    if (!b) { b = new Batch(); b.ci = i; b.cj = j; b.size = s; batches.set(key, b); }
    return b;
  };
  const vr = rng(seed ^ 0x9e37);
  const solids = new Map();                              // per chunk: the solid boxes as one triangle mesh
  const small = [];
  let colliders = 0;
  for (const b of L.boxes) {
    if (b.col) {
      const [i, j] = chunkOf(b.x, b.z), key = i + ',' + j;
      let m = solids.get(key);
      if (!m) solids.set(key, m = { v: [], i: [] });
      boxTriangles(m, b);
      colliders++;
    }
    if (b.hide) continue;
    const kind = b.k === K.GLOW ? 'glow' : b.k === K.DETAIL ? 'detail' : 'solid';
    if (kind === 'solid' && tiny(b)) { small.push(b); continue; }
    emitBox(batchFor(b.x, b.z, kind), b, vr);
  }
  // the small solid boxes go last in each chunk's mesh: from further than LOD only the part before them is drawn
  for (const bt of batches.values()) bt.bigI = bt.i;
  for (const b of small) emitBox(batchFor(b.x, b.z, 'solid'), b, vr);
  for (const w of L.wedges) {                            // the stairs you walk on (the steps you see are only drawn)
    const run = w.n * w.tread, cx = w.axis === 'x' ? w.x + w.dir * run / 2 : w.x, cz = w.axis === 'z' ? w.z + w.dir * run / 2 : w.z;
    const [i, j] = chunkOf(cx, cz), key = i + ',' + j;
    let m = solids.get(key);
    if (!m) solids.set(key, m = { v: [], i: [] });
    wedgeTriangles(m, w);
  }
  for (const m of solids.values()) phys.mesh(new Float32Array(m.v), new Uint32Array(m.i));
  for (const p of L.panes) emitPane(batchFor(p.x, p.z, 'pane'), p);
  const chunks = [];
  let verts = 0, detailVerts = 0;
  for (const [key, batch] of batches) {
    const kind = key.split(',')[2];
    const mesh = new THREE.Mesh(batch.geometry(), mats[kind]);
    mesh.castShadow = kind === 'solid' || kind === 'detail';
    mesh.receiveShadow = kind === 'solid' || kind === 'detail';
    mesh.matrixAutoUpdate = false;
    mesh.userData.kind = kind;
    group.add(mesh);
    verts += batch.v;
    if (kind === 'detail') detailVerts += batch.v;
    const x0 = batch.ci * batch.size - 2000, z0 = batch.cj * batch.size - 2000;
    chunks.push({ mesh, kind, x0, z0, x1: x0 + batch.size, z1: z0 + batch.size, far: kind === 'detail' ? NEAR : FAR, bigI: batch.bigI ?? 0, lod: false });
  }

  // ---------- fires: flames that flicker, and smoke drifting up from them. Every fire's flames are in one mesh and
  // its smoke in another (camera-facing quads with the glow texture): two draw calls for all of them (v0.5.3 drew
  // each of the 88 sprites on its own) ----------
  const FL = 2, SM = 6, fires = [];
  const flames = glow && L.fires.length ? spriteBatch(L.fires.length * FL, glow, true) : null;
  const smokes = flames ? spriteBatch(L.fires.length * SM, glow, false) : null;
  if (flames) {
    group.add(smokes.mesh, flames.mesh);
    L.fires.forEach((f, i) => fires.push({ x: f.x, y: f.y, z: f.z, s: f.s, seed: i * 1.7, on: true }));
  }
  const FLAME_C = [new THREE.Color(0xff7a2a), new THREE.Color(0xffc060)], SMOKE_C = new THREE.Color(0x2e2a27);
  let fireT = 0;
  const animateFires = dt => {
    if (!flames) return;
    fireT += dt;
    fires.forEach((f, i) => {
      for (let k = 0; k < FL; k++) {
        const t = fireT * (7 + k * 2.3) + f.seed, a = f.on ? (1.3 + 0.35 * Math.sin(t) + 0.2 * Math.sin(t * 2.7)) * f.s : 0;
        flames.set(i * FL + k, f.x + (k - 0.5) * 0.4 * f.s, f.y + 0.3 * k * f.s, f.z, a * 1.1, a * 1.6, FLAME_C[k], 0.6 + 0.25 * Math.sin(t * 1.9));
      }
      for (let k = 0; k < SM; k++) {
        const age = (fireT * 0.07 + k / SM) % 1, sc = f.on ? (2.0 + age * 11) * f.s : 0;
        smokes.set(i * SM + k, f.x + age * 7 * f.s + Math.sin(age * 6 + f.seed) * 0.8, f.y + 1 + age * 26 * f.s, f.z + Math.cos(age * 5 + f.seed) * 0.6,
          sc, sc, SMOKE_C, Math.sin(Math.min(1, age * 1.3) * Math.PI) * 0.45);
      }
    });
    flames.done(); smokes.done();
  };
  animateFires(0);

  // ---------- Prism crystals, the crashed pod, dunes ----------
  if (L.crystals.length) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.32, 1, 0.32);
    const im = new THREE.InstancedMesh(geo, mats.crystal, L.crystals.length);
    L.crystals.forEach((c, i) => {
      _e.set(c.rx, c.ry, c.rz, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_v.set(c.x, c.y + c.s * 0.8, c.z), _q, new THREE.Vector3(c.s, c.s, c.s));
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  // the pod: a four-sided pyramid, sunk and tilted; an open one has three faces (its torn face shows the inside,
  // the material is two-sided) and its core glows. The physics for it are hidden boxes from landmarks.js.
  for (const p of L.pods) {
    const g = new THREE.Group();
    const geo = p.open ? new THREE.ConeGeometry(p.s, p.h, 3, 1, true, p.thetaStart, Math.PI * 1.5) : new THREE.ConeGeometry(p.s, p.h, 4);
    const body = new THREE.Mesh(geo, mats.pod);
    body.position.y = p.open ? p.h / 2 - p.sink : p.h * 0.32; body.castShadow = true; body.receiveShadow = true;
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), mats.podEdge));
    g.add(body);
    if (glow) {
      const sprite = (y, scale, opacity) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xa36bff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.y = y; s.scale.setScalar(scale); g.add(s); };
      sprite(p.open ? p.h - p.sink - 1 : p.h * 0.8, 9, 0.7);
      if (p.open) sprite(1.6, 7, 0.85);                                            // the core inside
    }
    g.position.set(p.x, p.y ?? 0, p.z);
    if (p.open) g.rotation.set(p.tilt, p.ry, 0, 'YXZ'); else g.rotation.set(p.tilt, p.ry, p.tilt * 0.4);
    group.add(g);
  }
  if (L.dunes.length) {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 7), mats.dune, L.dunes.length);
    L.dunes.forEach((d, i) => {
      _q.setFromEuler(_e.set(0, d.ry, 0));
      _m.compose(_v.set(d.x, -d.sy * 0.35, d.z), _q, new THREE.Vector3(d.sx, d.sy, d.sz));
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    group.add(im);
  }
  for (const s of L.signs) sign(group, s);

  // ---------- loot containers ----------
  const opened = new Map();
  const containerBox = i => {
    let b = opened.get(i);
    if (!b) {
      const c = L.containers[i], def = CONTAINERS[c.type], title = def.name[0].toUpperCase() + def.name.slice(1);
      b = makeBox('c' + i, title, rollContainer(c.type, c.zone, rng(((seed * 73856093) ^ (i * 19349663)) >>> 0)), def.size);
      b.pos = { x: c.x, y: c.y, z: c.z }; b.reach = 3.2;
      opened.set(i, b);
    }
    return b;
  };
  L.containers.forEach((c, i) => {
    const def = CONTAINERS[c.type];
    items.add({
      id: 'c' + i, pos: { x: c.x, y: c.y + 0.9, z: c.z }, radius: c.type === 'car' ? 2.2 : 1.8,
      hold: () => opened.has(i) ? 0 : def.hold,
      label: () => { const b = opened.get(i); return b ? (b.slots.some(Boolean) ? `Open the ${def.name}` : null) : `Search the ${def.name}`; },
      use: p => {
        if (SHARED.open) { SHARED.open('c' + i, p, b => opened.set(i, b)); return; }      // (a squad: the leader's crate)
        bus.emit('loot:open', p, containerBox(i), null);
      },
    });
  });

  const dark = pos => {
    for (const d of L.dark) if (pos.x > d.x0 && pos.x < d.x1 && pos.z > d.z0 && pos.z < d.z1) return Math.max(0, Math.min(1, (-pos.y - 0.6) / 3));
    return 0;
  };

  // ---------- footing: the surface you SEE under a point; the raider's feet stand on it (raider.js) ----------
  // A ray down finds what you walk on. On stairs that is the hidden wedge through the steps' front edges, up to
  // a step's height above the step you see, so there the drawn step is used instead.
  const WC = 8, wgrid = new Map(), wkey = (i, j) => i * 4096 + j;
  for (const w of L.wedges) {
    const ax = w.axis === 'x', a0 = -w.tread, a1 = w.n * w.tread;
    const xs = ax ? [w.x + w.dir * a0, w.x + w.dir * a1] : [w.x - w.w / 2, w.x + w.w / 2];
    const zs = ax ? [w.z - w.w / 2, w.z + w.w / 2] : [w.z + w.dir * a0, w.z + w.dir * a1];
    for (let i = Math.floor(Math.min(...xs) / WC); i <= Math.floor(Math.max(...xs) / WC); i++)
      for (let j = Math.floor(Math.min(...zs) / WC); j <= Math.floor(Math.max(...zs) / WC); j++) {
        const k = wkey(i, j);
        if (!wgrid.has(k)) wgrid.set(k, []);
        wgrid.get(k).push(w);
      }
  }
  const stepAt = (x, z, hy) => {
    for (const w of wgrid.get(wkey(Math.floor(x / WC), Math.floor(z / WC))) || []) {
      const ax = w.axis === 'x', a = (ax ? x - w.x : z - w.z) * w.dir, c = ax ? z - w.z : x - w.x, T = w.tread, run = w.n * T;
      if (Math.abs(c) > w.w / 2 || a < -T || a > run) continue;
      const wy = w.y0 + (a <= run - T ? (a + T) * w.rise / T : w.n * w.rise);
      if (Math.abs(hy - wy) > 0.05) continue;                    // the ray hit something else here
      return a < 0 ? w.y0 : w.y0 + (Math.min(w.n - 1, Math.floor(a / T)) + 1) * w.rise;
    }
    return null;
  };
  const DOWN = { x: 0, y: -1, z: 0 };
  const footing = (x, top, z) => {                                 // the first surface below (x, top, z), within 1.6 m
    const r = phys.ray({ x, y: top, z }, DOWN, 1.6, undefined, true);
    if (!r) return null;
    const hy = top - r.t, st = stepAt(x, z, hy), s = r.ny < 0 ? -1 : 1;
    return st !== null ? { y: st, nx: 0, ny: 1, nz: 0 } : { y: hy, nx: r.nx * s, ny: r.ny * s, nz: r.nz * s };
  };
  let cullAt = null;
  return {
    layout: L, group, items, spawns: L.spawns, spawn: L.spawns[0], groundItems: L.groundItems,
    markers: [...L.extracts, ...L.landmarks],
    stats: { boxes: L.boxes.length, panes: L.panes.length, colliders, colliderMeshes: solids.size, groundMeshes, meshes: chunks.length, vertices: verts, detailVertices: detailVerts,
      containers: L.containers.length, fires: fires.length },
    wind: 0.03,
    footing,
    // a drop zone: at random, but after a death not the one closest to where you fell
    opened, containerBox,
    spawnPoint(rnd, p) {
      const list = p ? L.spawns.filter(s => Math.hypot(s.x - p.pos.x, s.z - p.pos.z) > 300) : L.spawns;
      return (list.length ? list : L.spawns)[Math.floor(rnd() * (list.length || L.spawns.length))];
    },
    zoneAt: (x, z) => zoneAt(x, z),
    darkness: dark,
    place(p) {
      if (dark(p.pos) > 0.3) return 'The Ruins · Underground Base · yellow zone';
      const z = zoneAt(p.pos.x, p.pos.z);
      return z ? `The Ruins · ${z.name} · ${z.kind} zone` : 'The Ruins · Outskirts';
    },
    step() {},
    // a graphics setting changed: the ground's marks and its textures' filtering now; the distances and the windows
    // at the next frame (Texture quality needs the map built again)
    graphics() {
      const u = mats.ground.userData?.uniforms;
      if (u?.uMarksK) u.uMarksK.value = S.groundDetail === 'low' ? 0 : 1;
      for (const t of [mats.ground.map, ...(mats.ground.userData?.textures || [])]) if (t && t.anisotropy !== (S.aniso || 1)) { t.anisotropy = S.aniso || 1; t.needsUpdate = true; }
      cullAt = null;
    },
    // the fires burn; chunks far from you are hidden, their detail sooner; beyond LOD a chunk draws only its bigger
    // boxes; only the detail near you casts shadows (checked again whenever you have moved 10 m)
    frame(dt, a, p) {
      animateFires(dt);
      if (!p || (cullAt && Math.hypot(p.pos.x - cullAt.x, p.pos.z - cullAt.z) < 10)) return;
      cullAt = { x: p.pos.x, z: p.pos.z };
      const view = GFX.view[S.view] || FAR, near = GFX.detail[S.detail] || NEAR;
      for (const c of chunks) {
        const dx = Math.max(c.x0 - p.pos.x, 0, p.pos.x - c.x1), dz = Math.max(c.z0 - p.pos.z, 0, p.pos.z - c.z1), d2 = dx * dx + dz * dz;
        const far = c.kind === 'detail' ? Math.min(near, view) : view;
        c.mesh.visible = d2 < far * far && (c.kind !== 'pane' || S.panes !== false);
        if (!c.mesh.visible) continue;
        if (c.kind === 'solid') {
          const lod = d2 > LOD * LOD;
          if (lod !== c.lod) { c.lod = lod; c.mesh.geometry.setDrawRange(0, lod ? c.bigI : Infinity); }
        } else if (c.kind === 'detail') c.mesh.castShadow = d2 < SHADOW_NEAR * SHADOW_NEAR;
      }
      for (const f of fires) f.on = Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < 300;
    },
    dispose() {
      scene.remove(group);
      disposeTree(group);
      for (const m of Object.values(mats)) { m.map?.dispose(); m.userData?.detail?.dispose(); m.userData?.textures?.forEach(t => t?.dispose()); m.dispose(); }
    },
  };
}

// Many camera-facing quads in one draw call, like sprites (the fires' flames and smoke). Each one has its own
// place, size, colour and opacity (set(i, ...) every frame, then done()); a size of 0 hides it. Fog, tone mapping and
// the output colour space work as they do for three's sprites.
const SPRITE_VS = `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iCol;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy + 0.5;
  vCol = iCol;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  mvPosition.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SPRITE_FS = `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(map, vUv) * vCol;
  if (c.a < 0.004) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
function spriteBatch(n, map, additive) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.attributes.position);
  const P = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), S = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const C = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  for (const a of [P, S, C]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', P); g.setAttribute('iSize', S); g.setAttribute('iCol', C);
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
    vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS,
    transparent: true, depthWrite: false, fog: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.uniforms.map.value = map;                          // (after the merge, which would copy the texture)
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;                            // (its bounds are the one quad's, not where the fires are)
  mesh.renderOrder = additive ? 2 : 1;                   // the smoke first, the flames over it
  return {
    mesh,
    set(i, x, y, z, sx, sy, c, a) { P.setXYZ(i, x, y, z); S.setXY(i, sx, sy); C.setXYZW(i, c.r, c.g, c.b, a); },
    done() { P.needsUpdate = true; S.needsUpdate = true; C.needsUpdate = true; },
  };
}

// a sign on a post, drawn on a canvas (skipped where there is no canvas, like the offline tests)
function sign(group, s) {
  const c = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
  if (!c || !c.getContext) return;
  c.width = 512; c.height = 200;
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = 'rgba(14,16,21,0.92)'; g.fillRect(0, 0, 512, 200);
  g.fillStyle = '#ffb224'; g.fillRect(0, 0, 12, 200);
  g.fillStyle = '#ffffff'; g.font = '700 60px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textBaseline = 'top';
  g.fillText(s.title.toUpperCase(), 34, 22);
  g.fillStyle = '#b9bfc8'; g.font = '500 32px Barlow, Arial, sans-serif';
  s.sub.split('\n').forEach((t, i) => g.fillText(t, 34, 104 + i * 40));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.94), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.set(s.x, s.y, s.z); board.rotation.y = s.ry || 0;
  group.add(board);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, s.y - 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x50555d, roughness: 0.6 }));
  post.position.set(s.x, (s.y - 0.4) / 2, s.z);
  group.add(post);
}
export { CONTAINER_H };
