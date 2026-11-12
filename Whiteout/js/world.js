// Whiteout: the island you walk on. The same look as the menu's island (snow, pines, rocks, the frozen sea,
// the aurora), three times as big, with a collider behind everything: the ground, every tree trunk and rock,
// the ruined shack you can go into, the wreck (hollow: the cabin you wake up in is inside it), the tower, and
// loose things that roll and slide when you push them. The sky, the light, the fog and the snowfall follow the world time (island.js).
// Co-op: the host's physics moves the loose things; on a guest they only follow what the host sends.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, clamp, lerp } from './state.js';
import { glowTex, iceTex, planeTex, paint, fbm, smooth, Smoke } from './scene.js';
import * as ISL from './island.js';
import { makeBody, pose } from './body.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _c = new THREE.Color();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _t = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const quat = q => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const col = h => new THREE.Color(h);
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });

// many boxes, few draw calls: everything of one material is merged into one mesh
class Batch {
  constructor(parent) { this.parent = parent; this.by = new Map(); }
  geo(mat, g, x, y, z, rx = 0, ry = 0, rz = 0) {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), ONE);
    g.applyMatrix4(_m);
    if (!this.by.has(mat)) this.by.set(mat, []);
    this.by.get(mat).push(g);
  }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { this.geo(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  raw(mat, g) { if (!this.by.has(mat)) this.by.set(mat, []); this.by.get(mat).push(g); }
  build() {
    for (const [mat, list] of this.by) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = !mat.transparent; m.receiveShadow = true;
      this.parent.add(m);
      for (const g of list) g.dispose();
    }
  }
}
// static colliders, given in a group's own coordinates
function solids(R, phys, group) {
  group.updateMatrixWorld(true);
  const M = group.matrixWorld.clone();
  const put = (desc, x, y, z, rx, ry, rz, fr) => {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), ONE).premultiply(M);
    _m.decompose(_v, _q, _s);
    return phys.createCollider(desc.setTranslation(_v.x, _v.y, _v.z).setRotation(quat(_q)).setFriction(fr));
  };
  return {
    box: (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, fr = 0.9) => put(R.ColliderDesc.cuboid(w / 2, h / 2, d / 2), x, y, z, rx, ry, rz, fr),
    cyl: (r, h, x, y, z, rx = 0, ry = 0, rz = 0, fr = 0.9) => put(R.ColliderDesc.cylinder(h / 2, r), x, y, z, rx, ry, rz, fr),
    ball: (r, x, y, z, fr = 0.6) => put(R.ColliderDesc.ball(r), x, y, z, 0, 0, 0, fr),
  };
}
// a static collider that matches a box or cylinder mesh where it stands
function solidMesh(R, phys, mesh, fr = 0.7) {
  mesh.updateWorldMatrix(true, false);
  mesh.matrixWorld.decompose(_v, _q, _s);
  const p = mesh.geometry.parameters;
  let d = null;
  if (mesh.geometry.type === 'BoxGeometry') d = R.ColliderDesc.cuboid(p.width / 2 * _s.x, p.height / 2 * _s.y, p.depth / 2 * _s.z);
  else if (mesh.geometry.type === 'CylinderGeometry') d = R.ColliderDesc.cylinder(p.height / 2 * _s.y, Math.max(p.radiusTop, p.radiusBottom) * Math.max(_s.x, _s.z));
  if (d) phys.createCollider(d.setTranslation(_v.x, _v.y, _v.z).setRotation(quat(_q)).setFriction(fr));
}
const snowMat = () => std('#eef3f8', { roughness: 0.9 });
// a low mound of snow: the cap of a sphere, its rim on the ground
function mound(sx, sy, sz) {
  const g = new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, 0.7);
  g.translate(0, -Math.cos(0.7), 0); g.scale(sx / 0.644, sy / 0.235, sz / 0.644);
  return g;
}

// ---------- the ground ----------
function makeTerrain(R, wld, scene, sparkleU) {
  const N = ISL.CELLS, V = N + 1, cs = ISL.CELL, half = ISL.SIZE / 2;
  const hts = new Float32Array(V * V), pos = new Float32Array(V * V * 3), idx = new Uint32Array(N * N * 6);
  for (let j = 0, p = 0; j < V; j++) for (let i = 0; i < V; i++, p++) {
    const x = -half + i * cs, z = -half + j * cs, h = ISL.height(x, z);
    hts[p] = h; pos[p * 3] = x; pos[p * 3 + 1] = h; pos[p * 3 + 2] = z;
  }
  // two triangles per cell: (a, b, d) and (b, c, d). groundY below reads the same two triangles.
  for (let j = 0, t = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * V + i, b = a + V, c = b + 1, d = a + 1;
    idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  wld.groundY = (x, z) => {
    const fx = clamp((x + half) / cs, 0, N - 0.0001), fz = clamp((z + half) / cs, 0, N - 0.0001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, a = j * V + i;
    const ha = hts[a], hd = hts[a + 1], hb = hts[a + V], hc = hts[a + V + 1];
    return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  };
  // how flat the ground is: 1 = level, 0.74 = about 42 degrees
  wld.slopeY = (x, z) => { const gx = wld.groundY(x + 0.5, z) - wld.groundY(x - 0.5, z), gz = wld.groundY(x, z + 0.5) - wld.groundY(x, z - 0.5); return 1 / Math.sqrt(1 + gx * gx + gz * gz); };
  wld.snowDepth = (x, z) => ISL.snowDepth(x, z) * smooth(0.3, 1.6, wld.groundY(x, z));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, cols = new Float32Array(V * V * 3);
  const snowC = col('#eef4fa'), shadeC = col('#c7d6e6'), rockC = col('#4c5866'), iceC = col('#9db4c4'), deepC = col('#fbfdff');
  for (let p = 0; p < V * V; p++) {
    const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2], ny = nrm.getY(p);
    _c.copy(snowC).lerp(shadeC, clamp(fbm(x * 0.03, z * 0.03, 2) * 1.5 - 0.3, 0, 1));
    _c.lerp(deepC, ISL.snowDepth(x, z) * 0.7);                    // deep drifts are the cleanest white
    if (ny < 0.8) _c.lerp(rockC, smooth(0.8, 0.6, ny));
    if (y < 0.6) _c.lerp(iceC, smooth(0.6, -0.5, y));
    cols[p * 3] = _c.r; cols[p * 3 + 1] = _c.g; cols[p * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  // glittering snow, as in the menu
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSpark = sparkleU;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uSpark; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 sc = floor(vWp.xz * 26.0);
      float sr = fract(sin(dot(sc, vec2(12.9898, 78.233))) * 43758.5453);
      float tw = fract(sr * 91.7 + dot(normalize(cameraPosition - vWp), vec3(3.1, 1.7, 5.3)) * 0.6);
      totalEmissiveRadiance += vec3(0.75, 0.85, 1.0) * step(0.985, sr) * pow(tw, 30.0) * 2.5 * uSpark * smoothstep(40.0, 6.0, length(cameraPosition - vWp));`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  wld.phys.createCollider(R.ColliderDesc.trimesh(pos, idx).setFriction(0.9));
  // the frozen sea: a huge slab of ice, slippery for everything that lands on it
  const ice = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: iceTex(), color: '#c8dbe6', roughness: 0.32, metalness: 0.15 }));
  ice.position.y = ISL.SEA; ice.receiveShadow = true;
  scene.add(ice);
  // (a sheet of 16 m triangles: against one enormous slab the character controller's sums go wrong by centimetres)
  const sn = 96, ss = 16, sv = new Float32Array((sn + 1) * (sn + 1) * 3), si = new Uint32Array(sn * sn * 6);
  for (let j = 0, p = 0; j <= sn; j++) for (let i = 0; i <= sn; i++, p += 3) { sv[p] = (i - sn / 2) * ss; sv[p + 1] = ISL.SEA; sv[p + 2] = (j - sn / 2) * ss; }
  for (let j = 0, t = 0; j < sn; j++) for (let i = 0; i < sn; i++) {
    const a = j * (sn + 1) + i, b = a + sn + 1;
    si[t++] = a; si[t++] = b; si[t++] = a + 1; si[t++] = b; si[t++] = b + 1; si[t++] = a + 1;
  }
  wld.phys.createCollider(R.ColliderDesc.trimesh(sv, si).setFriction(0.03).setFrictionCombineRule(R.CoefficientCombineRule.Min));
}

// ---------- pines and rocks ----------
function treeGeo() {
  const parts = [paint(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 5).translate(0, 0.8, 0), () => [0.24, 0.16, 0.1])];
  for (let i = 0; i < 4; i++) {
    const r = 1.5 - i * 0.32, hgt = 1.9 - i * 0.2, y = 1.0 + i * 1.05;
    parts.push(paint(new THREE.ConeGeometry(r, hgt, 7).translate(0, y + hgt / 2, 0), (px, py, pz, nx, ny) => {
      const top = (py - y) / hgt;
      return ny > 0.25 && top < 0.55 && Math.sin(px * 13 + pz * 7) > -0.6 ? [0.88, 0.92, 0.97] : [0.07, 0.17, 0.13];
    }));
  }
  return mergeGeometries(parts);
}
const near = (x, z, p, r) => Math.hypot(x - p.x, z - p.z) < r;
function makeTrees(R, wld, scene, rng) {
  const geo = treeGeo(), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const chunks = new Map(), CH = 160;
  const nx = Math.sin(ISL.WRECK.ry), nz = Math.cos(ISL.WRECK.ry);          // the way the plane's nose points
  for (let gx = -500; gx <= 500; gx += 6.5) for (let gz = -500; gz <= 500; gz += 6.5) {
    const x = gx + (rng() - 0.5) * 6, z = gz + (rng() - 0.5) * 6, pick = rng(), size = rng(), turn = rng(), tall = rng();
    const h = wld.groundY(x, z);
    if (h < 2.2 || h > 50) continue;
    if (near(x, z, ISL.SHACK, 17) || near(x, z, ISL.WRECK, 24) || near(x, z, ISL.TOWER, 13)) continue;
    // the lane the plane tore through the trees as it came down
    const ax = x - ISL.WRECK.x, az = z - ISL.WRECK.z, behind = -(ax * nx + az * nz), aside = Math.abs(ax * nz - az * nx);
    if (behind > 0 && behind < 90 && aside < 8) continue;
    if (wld.slopeY(x, z) < 0.8) continue;
    if (pick > smooth(0.42, 0.6, fbm(x * 0.01 + 40, z * 0.01, 3)) * 0.55 + 0.012) continue;        // forests in clumps, a few lone trees
    const s = (0.7 + size * 0.8) * 1.5;
    const key = ((x + 640) / CH | 0) + ((z + 640) / CH | 0) * 8;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.25, z), new THREE.Quaternion().setFromAxisAngle(UP, turn * 6.28), new THREE.Vector3(s, s * (0.9 + tall * 0.35), s)));
    wld.phys.createCollider(R.ColliderDesc.cylinder(1.5 * s, 0.19 * s).setTranslation(x, h + 1.5 * s - 0.3, z).setFriction(0.8));
  }
  // one instanced mesh per patch of the island, so patches out of sight are not drawn
  for (const list of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  }
}
function makeRocks(R, wld, scene, rng) {
  const base = new THREE.DodecahedronGeometry(1, 0);
  // the corners of the rock, once each, for its collider
  const seen = new Set(), pts = [], bp = base.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const k = `${bp.getX(i).toFixed(3)},${bp.getY(i).toFixed(3)},${bp.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); pts.push(bp.getX(i), bp.getY(i), bp.getZ(i)); }
  }
  const geo = paint(base, (px, py, pz, nx, ny) => ny > 0.45 ? [0.86, 0.9, 0.95] : [0.3, 0.34, 0.4]);
  const n = 460, im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), n);
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0, h = 0, tries = 0;
    do { x = (rng() - 0.5) * 940; z = (rng() - 0.5) * 940; h = wld.groundY(x, z); }
    while (++tries < 40 && (h < 0.5 || near(x, z, ISL.SHACK, 10) || near(x, z, ISL.WRECK, 18) || near(x, z, ISL.TOWER, 8)));
    const s = 0.4 + Math.pow(rng(), 2) * 2.6, sy = s * (0.5 + rng() * 0.5), y = h - s * 0.3;
    _q.setFromEuler(_e.set(rng() * 3, rng() * 3, rng() * 3));
    im.setMatrixAt(i, _m.compose(_v.set(x, y, z), _q, _s.set(s, sy, s)));
    const hull = new Float32Array(pts.length);
    for (let k = 0; k < pts.length; k += 3) { hull[k] = pts[k] * s; hull[k + 1] = pts[k + 1] * sy; hull[k + 2] = pts[k + 2] * s; }
    const desc = R.ColliderDesc.convexHull(hull);
    if (desc) wld.phys.createCollider(desc.setTranslation(x, y, z).setRotation(quat(_q)).setFriction(0.8));
  }
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
  im.castShadow = true; im.receiveShadow = true;
  scene.add(im);
}

// ---------- the shack, as you find it: a ruin ----------
// Gaps between the planks, holes in the roof, a broken window, the door hanging off one hinge, a cold stove
// with no pipe. You can go in: it keeps some of the wind out. x runs along the front, +z is the front.
function makeShack(R, wld, scene, rng) {
  const rnd = (a, b) => a + rng() * (b - a);
  const g = new THREE.Group(), y0 = wld.groundY(ISL.SHACK.x, ISL.SHACK.z);
  g.position.set(ISL.SHACK.x, y0, ISL.SHACK.z); g.rotation.y = ISL.SHACK.ry;
  scene.add(g);
  const sol = solids(R, wld.phys, g), B = new Batch(g);
  const W0 = 5.4, D0 = 4.2, H0 = 2.5, T = 0.14, FL = 0.26, ROW = H0 / 8;
  const woods = ['#8f8676', '#a39783', '#7d7466', '#958a78', '#6f675b'].map(c => std(c, { roughness: 0.92 }));
  const wood = () => woods[rng() * woods.length | 0];
  const dark = std('#3b2a1e', { roughness: 0.9 }), floorM = std('#4f4034', { roughness: 0.95 }), roofM = std('#3d342c', { roughness: 0.9 });
  const iron = std('#1d1f22', { roughness: 0.7, metalness: 0.6 }), iron2 = std('#2b2622', { roughness: 0.8, metalness: 0.5 }), cloth = std('#6b6a5e', { roughness: 1 });
  const snow = snowMat(), glass = std('#bcd7e6', { roughness: 0.1, transparent: true, opacity: 0.35 });

  // the foundation and the floorboards
  B.box(dark, W0 + 0.3, FL, D0 + 0.3, 0, FL / 2, 0); sol.box(W0 + 0.3, FL, D0 + 0.3, 0, FL / 2, 0);
  // an old board laid up to the door: Rapier's step-up doesn't climb the foundation's edge, so without it you had to jump in
  { const run = 0.9, rz = Math.atan2(FL, run), L = Math.hypot(run, FL), cz = D0 / 2 + 0.15 + run / 2;
    B.box(woods[2], 1.0, 0.08, L, 1.3, FL / 2 - 0.04, cz, rz); sol.box(1.1, 0.08, L, 1.3, FL / 2 - 0.04, cz, rz, 0, 0, 0.9); }
  for (let i = 0; i < 14; i++) B.box(i % 3 ? floorM : dark, W0 - 0.3, 0.02, 0.27, 0, FL + 0.01, -D0 / 2 + 0.15 + i * 0.3);

  // a wall of horizontal planks: `holes` are the door and the window, `cuts` are planks that are gone
  const cut = (list, a, b) => list.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, a], [b, e]].filter(([p, q]) => q - p > 0.05)));
  const wall = (alongX, at, from, to, holes, cuts) => {
    for (let r = 0; r < 8; r++) {
      const y = (r + 0.5) * ROW;
      let spans = [[from, to]];
      for (const h of holes) if (y > h.y0 && y < h.y1) spans = cut(spans, h.a, h.b);
      for (const c of cuts) if (c.r === r) spans = cut(spans, c.a, c.b);
      for (const [s, e] of spans) {
        let p = s;
        while (p < e - 0.05) {
          let len = rnd(1.3, 2.6); if (e - p - len < 0.6) len = e - p;
          const mid = p + len / 2, gone = r > 1 && rng() < (r >= 6 ? 0.2 : r >= 4 ? 0.09 : 0.04), th = T * rnd(0.75, 1), tilt = rnd(-0.012, 0.012);
          if (!gone) {
            if (alongX) B.box(wood(), len - 0.02, ROW - 0.025, th, mid, y, at, 0, 0, tilt);
            else B.box(wood(), th, ROW - 0.025, len - 0.02, at, y, mid, tilt, 0, 0);
          }
          p += len;
        }
      }
    }
  };
  const DOOR = { a: 0.8, b: 1.8, y0: 0, y1: 2.2 }, WIN = { a: -1.74, b: -0.46, y0: 0.95, y1: 1.95 };
  const zf = D0 / 2 - T / 2, xs = W0 / 2 - T / 2, doorTop = 7 * ROW, winLo = 3 * ROW, winHi = 6 * ROW;
  wall(true, zf, -W0 / 2, W0 / 2, [DOOR, WIN], [{ r: 7, a: -2.6, b: -1.9 }]);
  wall(true, -zf, -W0 / 2, W0 / 2, [], [{ r: 3, a: 0.6, b: 1.4 }, { r: 4, a: 0.7, b: 1.3 }, { r: 6, a: -2.0, b: -1.2 }, { r: 7, a: -0.5, b: 0.9 }]);
  wall(false, -xs, -D0 / 2 + T, D0 / 2 - T, [], [{ r: 5, a: -0.6, b: 0.3 }, { r: 7, a: -1.9, b: -0.4 }]);
  wall(false, xs, -D0 / 2 + T, D0 / 2 - T, [], [{ r: 2, a: 0.2, b: 0.9 }, { r: 4, a: -1.2, b: -0.5 }, { r: 6, a: 0, b: 1.4 }, { r: 7, a: -1.9, b: 0.6 }]);
  // the walls you bump into (the gaps are too small to get through)
  sol.box(W0, H0, T, 0, H0 / 2, -zf); sol.box(T, H0, D0 - 2 * T, -xs, H0 / 2, 0); sol.box(T, H0, D0 - 2 * T, xs, H0 / 2, 0);
  for (const [a, b] of [[-W0 / 2, WIN.a], [WIN.b, DOOR.a], [DOOR.b, W0 / 2]]) sol.box(b - a, H0, T, (a + b) / 2, H0 / 2, zf);
  sol.box(WIN.b - WIN.a, winLo, T, (WIN.a + WIN.b) / 2, winLo / 2, zf); sol.box(WIN.b - WIN.a, H0 - winHi, T, (WIN.a + WIN.b) / 2, (H0 + winHi) / 2, zf);
  sol.box(DOOR.b - DOOR.a, H0 - doorTop, T, (DOOR.a + DOOR.b) / 2, (H0 + doorTop) / 2, zf);
  // corner posts, the beams on top of the walls, the door frame
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(dark, 0.22, H0 + 0.1, 0.22, x * W0 / 2, H0 / 2, z * D0 / 2);
  for (const s of [1, -1]) B.box(dark, W0 + 0.2, 0.12, 0.16, 0, H0 + 0.02, s * (D0 / 2 - 0.07));
  for (const x of [DOOR.a - 0.04, DOOR.b + 0.04]) B.box(dark, 0.08, doorTop, T + 0.04, x, doorTop / 2, zf);
  // the gables
  for (const s of [1, -1]) for (let k = 0; k < 4; k++) {
    if (s < 0 && k === 2) continue;
    const yc = (k + 0.5) * ROW, hw = (D0 / 2 + 0.05) * (1 - yc / 1.5);
    B.box(wood(), T, ROW - 0.025, 2 * hw, s * xs, H0 + yc, 0);
  }

  // the roof: boards from the ridge down to the eaves, some gone, snow on what is left
  const A = 0.62, rl = Math.hypot(D0 / 2 + 0.5, 1.4), nb = 19, bw = (W0 + 0.9) / nb, cy = H0 + 0.72, cz = D0 / 4 + 0.12, sa = Math.sin(A), ca = Math.cos(A);
  const GONE = { 1: [6, 7], [-1]: [3, 4, 11, 12, 13] }, HALF = { 1: [12], [-1]: [8, 15] };
  for (const s of [1, -1]) {
    for (let i = 0; i < nb; i++) {
      if (GONE[s].includes(i)) continue;
      const x = -(W0 + 0.9) / 2 + (i + 0.5) * bw, len = HALF[s].includes(i) ? rl * rnd(0.4, 0.6) : rl, up = (rl - len) / 2;
      B.box(roofM, bw - 0.02, 0.05, len, x, cy + sa * up, s * (cz - ca * up), s * A);
      if (rng() < 0.85) { const th = rnd(0.2, 0.32); B.box(snow, bw + 0.01, th, len * 0.96, x, cy + sa * up + (0.025 + th / 2) * ca, s * (cz - ca * up + (0.025 + th / 2) * sa), s * A); }
    }
    for (let k = 0; k < 6; k++) B.box(dark, 0.09, 0.12, rl - 0.1, -2.9 + k * 1.16, cy - 0.085 * ca, s * (cz - 0.085 * sa), s * A);
    sol.box(W0 + 0.9, 0.1, rl, 0, cy, s * cz, s * A);
  }
  B.box(dark, W0 + 0.9, 0.12, 0.12, 0, H0 + 1.52, 0);

  // the broken window: a frame, what is left of the cross, a few shards of glass, snow on the sill
  for (const [w, h, x, y] of [[1.36, 0.1, -1.1, winHi + 0.03], [1.36, 0.1, -1.1, winLo - 0.03], [0.1, 1.0, -1.74, 1.41], [0.1, 1.0, -0.46, 1.41], [0.45, 0.06, -1.47, 1.41], [0.06, 0.36, -1.1, 1.68]]) B.box(dark, w, h, 0.08, x, y, zf + 0.04);
  B.box(glass, 0.3, 0.3, 0.012, -1.6, 1.74, zf, 0, 0, 0.78); B.box(glass, 0.24, 0.24, 0.012, -0.6, 1.08, zf, 0, 0, 0.78); B.box(glass, 0.16, 0.2, 0.012, -1.62, 1.04, zf, 0, 0, 0.5);
  B.box(snow, 1.5, 0.08, 0.3, -1.1, winLo - 0.05, zf + 0.14);

  // the door: on one hinge, swung wide open and hanging crooked
  const hinge = new THREE.Group(); hinge.position.set(DOOR.b, 0, D0 / 2 + 0.03); hinge.rotation.set(0, 1.75, 0.13); g.add(hinge);
  const doorM = std('#6b5a48', { roughness: 0.9 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.86, 0.06), doorM); door.position.set(-0.49, FL + 0.95, 0); door.castShadow = true; door.receiveShadow = true; hinge.add(door);
  for (const y of [-0.6, 0.6]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.03), dark); br.position.set(0, y, 0.045); door.add(br); }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), std('#c9a03c', { metalness: 0.8, roughness: 0.3 })); knob.position.set(-0.36, 0, 0.07); door.add(knob);
  solidMesh(R, wld.phys, door);

  // inside: the stove with no pipe, a bunk, a workbench under the window
  const sx = -1.75, sz = -1.25;
  for (const [dx, dz] of [[-0.24, -0.19], [0.24, -0.19], [-0.24, 0.19], [0.24, 0.19]]) B.box(iron, 0.05, 0.14, 0.05, sx + dx, FL + 0.07, sz + dz);
  B.box(iron, 0.6, 0.6, 0.5, sx, FL + 0.44, sz); B.box(iron2, 0.66, 0.04, 0.56, sx, FL + 0.76, sz); B.box(iron2, 0.26, 0.24, 0.03, sx, FL + 0.4, sz + 0.26);
  B.geo(iron2, new THREE.CylinderGeometry(0.085, 0.085, 0.1, 10), sx - 0.12, FL + 0.83, sz - 0.08);        // the collar where the pipe used to go
  B.box(snow, 0.3, 0.05, 0.26, sx + 0.08, FL + 0.8, sz + 0.06);
  sol.box(0.6, 0.78, 0.5, sx, FL + 0.39, sz);
  B.box(dark, 1.9, 0.1, 0.85, 1.6, FL + 0.4, -1.5); B.box(cloth, 1.8, 0.1, 0.75, 1.6, FL + 0.5, -1.5);
  for (const [dx, dz] of [[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]]) B.box(dark, 0.08, 0.4, 0.08, 1.6 + dx, FL + 0.2, -1.5 + dz);
  sol.box(1.9, 0.55, 0.85, 1.6, FL + 0.275, -1.5);
  B.box(woods[1], 1.5, 0.07, 0.6, -1.1, FL + 0.86, 1.62); B.box(dark, 1.4, 0.05, 0.5, -1.1, FL + 0.3, 1.62);
  for (const [dx, dz] of [[-0.7, -0.25], [0.7, -0.25], [-0.7, 0.25], [0.7, 0.25]]) B.box(dark, 0.08, 0.84, 0.08, -1.1 + dx, FL + 0.42, 1.62 + dz);
  B.box(std('#5a2a22'), 0.2, 0.035, 0.28, -0.75, FL + 0.915, 1.58, 0, 0.3, 0);                              // the old owner's notebook
  sol.box(1.5, 0.9, 0.6, -1.1, FL + 0.45, 1.62);
  // snow that came in through the roof, drifts against the walls outside, the chopping stump
  for (const [x, z, a, h] of [[-0.8, 0.5, 0.7, 0.14], [1.0, -0.6, 0.9, 0.18], [-1.9, -0.5, 0.5, 0.1]]) B.geo(snow, mound(a, h, a * 0.8), x, FL + 0.015, z);
  for (const [x, z, a, ry] of [[-3.25, 1.2, 1.5, 1.57], [3.3, -1.2, 1.7, 1.57], [-1.6, -2.75, 1.4, 0], [1.2, -3.0, 1.9, 0], [-1.3, 2.7, 1.2, 0]]) B.geo(snow, mound(a, a * 0.24, a * 0.6), x, 0, z, 0, ry, 0);
  B.geo(dark, new THREE.CylinderGeometry(0.32, 0.36, 0.5, 10), 3.6, 0.25, 2.4); sol.cyl(0.36, 0.5, 3.6, 0.25, 2.4);
  B.build();

  g.updateMatrixWorld(true);
  wld.shack = { M: g.matrixWorld.clone(), inv: g.matrixWorld.clone().invert(), half: new THREE.Vector3(W0 / 2, H0 + 0.9, D0 / 2), y: y0, floor: FL };
  wld.inShack = p => { _v.copy(p).applyMatrix4(wld.shack.inv); return Math.abs(_v.x) < W0 / 2 - 0.05 && Math.abs(_v.z) < D0 / 2 - 0.05 && _v.y > -0.3 && _v.y < H0 - 0.3; };
}

// ---------- the crashed plane: a hollow wreck with the cabin you wake up in ----------
// Wreck coordinates: x across, y up (the snow is at 0), z along the plane: the cockpit is at +z, the torn-off
// back at -z. The cabin is the cutscene's, turned round: the club four of facing seats around two tables, two
// more seats behind, the cockpit beyond the bulkhead. Every player wakes up in their own seat.
const NPC = [
  { coat: '#e9dfcf', hair: '#d8b878', skin: '#f0c8a8', long: true },
  { coat: '#22262d', hair: '#9a9a9a', skin: '#e3b48f' },
  { coat: '#5a1e2a', hair: '#1c1410', skin: '#c98f6a', long: true },
  { coat: '#33465a', hair: '#5a3d26', skin: '#e8be9a' },
];
const FLOOR = 0.12, BULK = 4.2, TORN = -6.5;
const SEATS = [[0.78, 0.95, -1], [0.78, -0.95, 1], [-0.78, 0.95, -1], [-0.78, -0.95, 1]];     // x, z, facing (-1 = towards the back)
const REAR = [[0.78, -2.9, 1], [-0.78, -2.9, 1]];
function makeWreck(R, wld, scene, crew) {
  const g = new THREE.Group(), y0 = wld.groundY(ISL.WRECK.x, ISL.WRECK.z);
  g.position.set(ISL.WRECK.x, y0, ISL.WRECK.z); g.rotation.y = ISL.WRECK.ry;
  scene.add(g);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, par = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; par.add(m); return m; };
  const hull = new THREE.MeshStandardMaterial({ map: planeTex(), roughness: 0.45, metalness: 0.55 });
  const metal = std('#b9c0c8', { roughness: 0.4, metalness: 0.7 }), charred = std('#1c1a19', { roughness: 1 }), snow = snowMat();
  const lining = std('#7d776d', { roughness: 0.8, side: THREE.BackSide }), carpet = std('#2e2723', { roughness: 1 }), wood = std('#5b3a22', { roughness: 0.4 });
  const leather = std('#b8a484', { roughness: 0.6 }), leatherDark = std('#8a765a', { roughness: 0.65 }), dark = std('#15181c', { roughness: 0.6, metalness: 0.3 }), gold = std('#c9a35a', { roughness: 0.3, metalness: 0.9 });
  const sol = solids(R, wld.phys, g), B = new Batch(g);
  // the fuselage: the outside, a sooty lining inside, the nose
  add(new THREE.CylinderGeometry(1.55, 1.55, 13, 28, 1, true), hull, 0, 1.0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(1.5, 1.5, 13, 28, 1, true), lining, 0, 1.0, 0, Math.PI / 2).castShadow = false;
  add(new THREE.SphereGeometry(1.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: hull.map, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }), 0, 1.0, 6.5, Math.PI / 2, 0, 0).scale.set(1, 1.8, 1);
  sol.ball(1.5, 0, 1.0, 6.7); sol.ball(1.1, 0, 1.0, 8.1);
  // the shell you can't walk through: thin slabs round the sides and the roof (the floor closes the bottom)
  const a0 = Math.asin((FLOOR - 1.0) / 1.55), a1 = Math.PI - a0, n = 16;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n, w = 2 * 1.62 * Math.sin((a1 - a0) / n / 2) + 0.06;
    sol.box(w, 0.12, 13, Math.cos(a) * 1.62, 1.0 + Math.sin(a) * 1.62, 0, 0, 0, a - Math.PI / 2, 0.5);
  }
  B.box(carpet, 2.5, 0.06, 12, 0, FLOOR - 0.03, -0.5); sol.box(2.6, 0.42, 13, 0, FLOOR - 0.21, 0, 0, 0, 0, 0.8);
  B.box(std('#4a3b2f', { roughness: 1 }), 0.5, 0.012, 10, 0, FLOOR + 0.006, -1.5);
  // the end of the floor, bent down onto the snow: a ramp, so you can walk back in (a bare 12 cm edge stops a slow walk)
  const ramp = -Math.atan2(FLOOR, 0.8);
  B.box(carpet, 2.3, 0.06, 0.82, 0, FLOOR / 2 - 0.03, TORN - 0.4, ramp); sol.box(2.4, 0.1, 0.84, 0, FLOOR / 2 - 0.05, TORN - 0.4, ramp, 0, 0, 0.8);
  // windows: dark ovals in the lining, seven a side
  const winG = new THREE.CircleGeometry(0.15, 20).scale(1, 1.35, 1), winM = new THREE.MeshBasicMaterial({ color: '#070b12' });
  for (const s of [-1, 1]) for (const z of [-4.6, -3.0, -1.6, -0.2, 1.2, 2.6, 3.7]) B.geo(winM, winG.clone(), s * 1.47, 1.25, z, 0, -s * Math.PI / 2, 0);
  // overhead bins; the one over the aisle at the back has fallen open
  for (const s of [-1, 1]) for (let z = -4.4; z < 3.7; z += 1.1) if (!(s > 0 && Math.abs(z + 1.1) < 0.1)) B.box(std('#d9d2c4', { roughness: 0.6 }), 0.36, 0.32, 1.0, s * 0.98, FLOOR + 1.84, z);
  B.box(charred, 0.3, 0.3, 0.95, 0.98, FLOOR + 1.84, -1.1);
  B.box(std('#cfc7b9'), 0.03, 0.34, 0.98, 0.75, FLOOR + 1.62, -1.1, 0, 0, 1.2);
  // the bulkhead and the cockpit
  for (const s of [-1, 1]) { B.box(wood, 1.14, 2.4, 0.08, s * 0.93, FLOOR + 1.2, BULK); sol.box(1.14, 2.4, 0.12, s * 0.93, FLOOR + 1.2, BULK); }
  B.box(wood, 0.72, 0.4, 0.08, 0, FLOOR + 2.2, BULK); sol.box(0.72, 0.4, 0.12, 0, FLOOR + 2.2, BULK);
  B.box(dark, 1.5, 0.5, 0.35, 0, FLOOR + 0.75, 5.35, -0.3);
  B.box(std('#0a1220'), 1.4, 0.45, 0.04, 0, FLOOR + 1.35, 5.5, -0.35);
  // the torn-off back: ragged metal round the hole, embers on the floor
  for (let i = 0; i < 24; i++) {
    const a = a0 + (a1 - a0) * i / 23 + (Math.random() - 0.5) * 0.15, r = 1.47 + Math.random() * 0.12;
    B.box(Math.random() < 0.6 ? charred : metal, 0.12 + Math.random() * 0.3, 0.3 + Math.random() * 0.45, 0.04, Math.cos(a) * r, 1.0 + Math.sin(a) * r, TORN - 0.05 - Math.random() * 0.2, (Math.random() - 0.5) * 0.8, 0, a + Math.PI / 2 + (Math.random() - 0.5) * 0.5);
  }
  const ember = new THREE.MeshBasicMaterial({ color: '#ff6a1a' });
  for (let i = 0; i < 7; i++) B.box(ember,0.06 + Math.random() * 0.08, 0.04, 0.2 + Math.random() * 0.3, (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5), FLOOR + 0.02, TORN + 0.2 + Math.random() * 0.8, 0, Math.random() * 3, 0);
  // seats, tables, the pilots' seats; every seat is solid
  const seat = (x, z, face) => {
    const ry = face > 0 ? 0 : Math.PI, c = Math.cos(ry), s = Math.sin(ry), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const part = (m, w, h, d, lx, y, lz, rx = 0) => { const [px, pz] = at(lx, lz); B.box(m, w, h, d, px, FLOOR + y, pz, rx, ry, 0); };
    part(leatherDark, 0.62, 0.4, 0.6, 0, 0.2, 0); part(leather, 0.58, 0.1, 0.56, 0, 0.45, 0.02);
    part(leather, 0.6, 0.8, 0.15, 0, 0.86, -0.3, -0.12); part(leather, 0.42, 0.16, 0.12, 0, 1.32, -0.36, -0.12);
    for (const k of [-1, 1]) part(leatherDark, 0.09, 0.12, 0.56, k * 0.31, 0.62, 0);
    sol.box(0.64, 1.3, 0.64, x, FLOOR + 0.65, z);
  };
  for (const [x, z, f] of SEATS.concat(REAR)) seat(x, z, f);
  for (const s of [-1, 1]) {
    B.box(wood, 0.62, 0.04, 0.74, s * 0.78, FLOOR + 0.72, 0); B.geo(gold, new THREE.CylinderGeometry(0.05, 0.07, 0.7, 10), s * 0.78, FLOOR + 0.35, 0);
    sol.box(0.62, 0.74, 0.74, s * 0.78, FLOOR + 0.37, 0);
    seat(s * 0.42, 4.85, 1);
  }
  // the people who didn't make it: passengers in the seats nobody plays, the pilots
  const sit = (look, x, z, face, tilt) => {
    const P = makeBody(look);
    P.g.position.set(x, FLOOR, z - face * 0.06); P.g.rotation.y = face > 0 ? 0 : Math.PI;
    pose(P, { sit: 1, slump: 1, tilt });
    // they never move: bake the body into the cabin's merged meshes (a handful of draw calls instead of twenty each)
    g.add(P.g); g.updateMatrixWorld(true);
    const toCabin = g.matrixWorld.clone().invert();
    P.g.traverse(o => { if (o.isMesh) B.raw(o.material, o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toCabin, o.matrixWorld))); });
    g.remove(P.g);
  };
  SEATS.forEach(([x, z, f], i) => { if (i >= crew) sit(NPC[i], x, z, f, i % 2 ? -0.3 : 0.3); });
  REAR.forEach(([x, z, f], i) => sit(NPC[(i + 2) % 4], x, z, f, i ? -0.35 : 0.35));
  for (const s of [-1, 1]) sit({ coat: '#e5e9ee', hair: s < 0 ? '#2a2420' : '#6b5a4a', skin: '#e3b48f', pants: '#1d2430' }, s * 0.42, 4.85, 1, s * 0.25);
  // what you can grab on the way out (game.js decides what each one does)
  const items = [];
  const item = (id, kind, name, hold, parts, x, y, z, ry = 0, extra = {}) => {
    const m = new THREE.Group(); m.position.set(x, FLOOR + y, z); m.rotation.y = ry;
    for (const [mat, w, h, d, px, py, pz] of parts) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(px, py, pz); b.castShadow = true; m.add(b); }
    g.add(m);
    items.push({ id, kind, name, hold, mesh: m, pos: new THREE.Vector3(), taken: 0, ...extra });
  };
  const fur = std('#e9dfcf', { roughness: 1 }), wool = std('#33465a', { roughness: 1 }), white = std('#eeeeea', { roughness: 0.5 }), red = std('#c42a1e', { roughness: 0.5 }), orange = std('#e0601a', { roughness: 0.5 });
  item('fur', 'coat', 'the fur coat', 1.5, [[fur, 0.62, 0.07, 0.48, 0, 0.035, 0], [fur, 0.5, 0.06, 0.12, 0, 0.09, -0.2], [fur, 0.14, 0.05, 0.4, 0.34, 0.03, 0.05]], 0.15, 0, -1.75, 0.5, { color: '#e9dfcf', warm: 0.75 });
  item('wool', 'coat', 'the wool coat', 1.5, [[wool, 0.56, 0.08, 0.5, 0, 0.04, 0], [wool, 0.42, 0.06, 0.12, 0, 0.1, -0.2]], 0.45, 0, -3.9, -0.7, { color: '#33465a', warm: 0.85 });
  item('kit', 'kit', 'the first aid kit', 1.0, [[white, 0.32, 0.24, 0.1, 0, 0, 0], [red, 0.06, 0.16, 0.012, 0, 0, -0.055], [red, 0.16, 0.06, 0.012, 0, 0, -0.056]], 0.9, 1.25, BULK - 0.1);
  item('flare', 'flare', 'the flare gun', 2.5, [[orange, 0.38, 0.2, 0.12, 0, 0, 0], [dark, 0.12, 0.03, 0.04, 0, 0.115, 0]], -0.42, 0.95, 4.52);
  // the fire burning in the back of the cabin, the smoke along the ceiling, the red emergency light
  const fmat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,160,1)', 'rgba(255,110,30,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const inFire = [];
  for (let i = 0; i < 22; i++) {
    const s = new THREE.Sprite(fmat.clone()), top = i >= 16, side = i % 2 ? 1 : -1;
    s.userData = { t: Math.random(), bx: top ? side * (0.3 + Math.random() * 0.6) : side * (0.6 + Math.random() * 0.65), by: top ? 1.9 + Math.random() * 0.3 : 0.1 + Math.random() * 0.4, bz: TORN + 0.15 + Math.random() * (top ? 1.6 : 0.9), top };
    g.add(s); inFire.push(s);
  }
  const smat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,0.6)', 'rgba(255,255,255,0.2)'), color: '#1c1a18', transparent: true, depthWrite: false, opacity: 0 });
  const inSmoke = [];
  for (let i = 0; i < 18; i++) { const s = new THREE.Sprite(smat.clone()); s.userData = { t: i / 18, bx: (Math.random() - 0.5) * 1.6, ph: Math.random() * 6 }; g.add(s); inSmoke.push(s); }
  const inLight = new THREE.PointLight('#ff7a2a', 0, 9, 1.5); inLight.position.set(0, 0.9, TORN + 0.9); g.add(inLight);
  const redLight = new THREE.PointLight('#ff2a14', 0, 8, 1.6); redLight.position.set(0, FLOOR + 2.0, 0.6); g.add(redLight);
  B.build();
  // the broken wing stuck in the snow, an engine, the tail further back
  solidMesh(R, wld.phys, add(new THREE.BoxGeometry(9, 0.22, 2.4), metal, 5.5, 0.5, 0.8, 0.05, 0.3, -0.18));
  solidMesh(R, wld.phys, add(new THREE.CylinderGeometry(0.7, 0.6, 2.6, 16), metal, 4.2, 0.4, 1.9, Math.PI / 2, 0, 0.2));
  const tail = new THREE.Group(); tail.position.set(-5, 0, -13); tail.rotation.set(0.1, 0.9, 0.35); g.add(tail);
  solidMesh(R, wld.phys, add(new THREE.CylinderGeometry(1.1, 0.5, 4.5, 18), hull, 0, 0.9, 0, Math.PI / 2, 0, 0, tail));
  solidMesh(R, wld.phys, add(new THREE.BoxGeometry(0.22, 3.2, 2.4), std('#9a2b22', { roughness: 0.5, metalness: 0.4 }), 0, 2.6, -1.2, -0.35, 0, 0, tail));
  add(new THREE.BoxGeometry(1.6, 0.35, 11), snow, 0, 2.55, 0.3, 0, 0, 0.12);
  // the fire outside, beside the torn-off end (the way out is past it), and the snow it has blackened
  const fp = new THREE.Vector3(1.7, 0.5, -7.7);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex('rgba(12,9,7,0.9)', 'rgba(20,16,12,0.5)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  scorch.position.set(fp.x, 0.06, fp.z); g.add(scorch);
  const light = new THREE.PointLight('#ff7a2a', 14, 30, 1.7); light.position.copy(fp).add(new THREE.Vector3(0, 1.2, -0.5)); g.add(light);
  const sprites = [];
  for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(fmat.clone()); s.userData = { t: Math.random(), x: (Math.random() - 0.5) * 1.4, z: (Math.random() - 0.5) * 1.2 }; g.add(s); sprites.push(s); }
  const smoke = new Smoke(fp.clone().add(new THREE.Vector3(0, 1.4, 0)), g, 1.4, '#2a2624', 40);
  g.updateMatrixWorld(true);
  const M = g.matrixWorld.clone(), inv = M.clone().invert(), q = new THREE.Quaternion().setFromRotationMatrix(M);
  for (const it of items) { it.mesh.getWorldPosition(it.pos); it.pos.y += 0.06; }      // aim a little above the floor
  wld.items = items;
  wld.wreck = { M, inv, floorY: y0 + FLOOR, inFire, inSmoke, inLight, redLight };
  wld.fire = { pos: fp.clone().applyMatrix4(M), base: fp, light, sprites, smoke };
  wld.inCabin = p => { _v.copy(p).applyMatrix4(inv); return Math.abs(_v.x) < 1.45 && _v.z > TORN && _v.z < 5.4 && _v.y > -0.4 && _v.y < 2.6; };
  // your seat: where you sit, which way you face, and the spot in the aisle where you stand up
  wld.seat = i => {
    const [x, z, f] = SEATS[i % 4], at = (lx, lz) => _v.set(lx, FLOOR, lz).applyMatrix4(M).clone();
    const p = at(x, z - f * 0.06), aisle = at(0, z), dir = new THREE.Vector3(0, 0, f).applyQuaternion(q);
    return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-dir.x, -dir.z), aisle };
  };
}

// ---------- the old watchtower (the satellite phone is up there) ----------
function makeTower(R, wld, scene) {
  const g = new THREE.Group(), y0 = wld.groundY(ISL.TOWER.x, ISL.TOWER.z);
  g.position.set(ISL.TOWER.x, y0, ISL.TOWER.z);
  scene.add(g);
  const steel = std('#3b4048', { roughness: 0.6, metalness: 0.6 }), H = 16;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, H, 0.2), steel); l.position.set(x * 1.7, H / 2, z * 1.7); l.rotation.set(-z * 0.06, 0, x * 0.06); l.castShadow = true; g.add(l);
    solidMesh(R, wld.phys, l);
  }
  for (let y = 2; y < H; y += 3.2) for (const r of [0, Math.PI / 2]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(3.4 - y * 0.05, 0.1, 0.1), steel); b.position.y = y; b.rotation.y = r; g.add(b);
    const b2 = b.clone(); b2.position.z = r ? 0 : 1.6 - y * 0.02; b2.position.x = r ? 1.6 - y * 0.02 : 0; g.add(b2);
  }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 3.6), std('#5a4636', { roughness: 0.9 })); cab.position.y = H + 1.1; cab.castShadow = true; g.add(cab);
  solidMesh(R, wld.phys, cab);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.2, 4), snowMat()); roof.position.y = H + 2.8; roof.rotation.y = Math.PI / 4; g.add(roof);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 4.5, 6), steel); ant.position.y = H + 5.4; g.add(ant);
  const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,80,60,1)', 'rgba(255,30,20,0.35)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  lamp.position.y = H + 7.7; lamp.scale.setScalar(3); g.add(lamp);
  const light = new THREE.PointLight('#ff3a2a', 0, 30, 2); light.position.y = H + 7.5; g.add(light);
  wld.tower = { lamp, light };
}

// ---------- loose things: debris and luggage at the wreck, logs, crates and a barrel at the shack ----------
function makeProps(R, wld, scene, rng, guest) {
  const rnd = (a, b) => a + rng() * (b - a);
  const metal = std('#b9c0c8', { roughness: 0.4, metalness: 0.7 }), charred = std('#1c1a19', { roughness: 1 }), logM = std('#4a3626', { roughness: 0.95 });
  const crateM = std('#8a6f4d', { roughness: 0.9 }), barrelM = std('#47586a', { roughness: 0.5, metalness: 0.5 }), plankM = std('#3d342c', { roughness: 0.9 }), leather = std('#d8c4a2', { roughness: 0.55 });
  const add = (mesh, descs, x, y, z, q) => {
    const bd = guest ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic().setLinearDamping(0.15).setAngularDamping(0.7);
    const body = wld.phys.createRigidBody(bd.setTranslation(x, y, z).setRotation(quat(q)));
    for (const d of descs) wld.phys.createCollider(d.setFriction(0.7).setRestitution(0.05), body);
    mesh.position.set(x, y, z); mesh.quaternion.copy(q);
    mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(mesh);
    wld.props.push({ mesh, body, home: [x, y, z], to: null });
  };
  const yawQ = (a, tip = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, tip));
  const ground = (x, z) => Math.max(wld.groundY(x, z), ISL.SEA);
  const box = (w, h, d, m, dens, x, z, yaw, y0) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), [R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setDensity(dens)], x, (y0 ?? ground(x, z)) + h / 2 + 0.04, z, yawQ(yaw));
  const cyl = (r, len, m, dens, x, z, yaw, lying) => add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m), [R.ColliderDesc.cylinder(len / 2, r).setDensity(dens)], x, ground(x, z) + (lying ? r : len / 2) + 0.04, z, yawQ(yaw, lying ? Math.PI / 2 : 0));
  const at = (M, lx, lz) => { _v.set(lx, 0, lz).applyMatrix4(M); return [_v.x, _v.z]; };

  // around the wreck
  const WM = wld.wreck.M, wy = ISL.WRECK.ry;
  for (let i = 0; i < 14; i++) {
    let lx = 0, lz = 0, tries = 0;
    do { lx = rnd(-9, 11); lz = rnd(-18, 9); }
    while (++tries < 30 && ((Math.abs(lx) < 2.4 && lz > -7.6 && lz < 10) || (lx > 0.5 && lx < 10.6 && lz > -1.3 && lz < 3.3) || Math.hypot(lx - 4.9, lz + 12.2) < 3 || Math.hypot(lx - 1.7, lz + 7.7) < 1.7 || (Math.abs(lx) < 1.6 && lz < -6.4 && lz > -10.5) || Math.hypot(lx + 5, lz + 13) < 3.2));
    const [x, z] = at(WM, lx, lz);
    box(rnd(0.3, 1.1), rnd(0.05, 0.22), rnd(0.3, 1.3), rng() < 0.5 ? metal : charred, 350, x, z, rnd(0, 6.28));
  }
  [['#5a1e2a', 3.4, -8.6, 0.4], ['#22324a', 9.2, -15.4, 1.9], ['#9b8560', -3.2, -10.2, 2.7]].forEach(([c, lx, lz, a]) => { const [x, z] = at(WM, lx, lz); box(0.72, 0.26, 0.5, std(c, { roughness: 0.6 }), 90, x, z, wy + a); });
  {
    // a seat thrown clear of the cabin
    const [x, z] = at(WM, -3.6, -4.4), seat = new THREE.Group();
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.45, 0.6), leather), b2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.14), leather); b2.position.set(0, 0.55, -0.25); seat.add(b1, b2);
    add(seat, [R.ColliderDesc.cuboid(0.31, 0.225, 0.3).setDensity(70), R.ColliderDesc.cuboid(0.3, 0.375, 0.07).setTranslation(0, 0.55, -0.25).setDensity(70)], x, ground(x, z) + 0.27, z, yawQ(wy + 2.2));
    const [x2, z2] = at(WM, 8.6, -6.2); cyl(0.36, 0.24, std('#141414', { roughness: 0.9 }), 300, x2, z2, 0, false);     // a wheel
  }
  // luggage thrown about inside the cabin, in the way out
  [['#7a5a3a', -0.65, -4.7, 0.3], ['#2b2f36', 0.6, -5.5, 1.2]].forEach(([c, lx, lz, a]) => { const [x, z] = at(WM, lx, lz); box(0.62, 0.24, 0.42, std(c, { roughness: 0.6 }), 90, x, z, wy + a, wld.wreck.floorY); });
  // around and inside the shack
  const SM = wld.shack.M, sy = ISL.SHACK.ry;
  for (let i = 0; i < 5; i++) { const [x, z] = at(SM, 3.55 + rnd(-0.15, 0.15), -1.9 + i * 0.37); cyl(0.13, 1.1, logM, 550, x, z, sy + rnd(-0.12, 0.12), true); }
  for (const [lx, lz, a] of [[-3.7, 0.9, 0.2], [-3.6, 1.7, 0.9]]) { const [x, z] = at(SM, lx, lz); box(0.55, 0.55, 0.55, crateM, 120, x, z, sy + a); }
  { const [x, z] = at(SM, -3.5, -1.3); cyl(0.29, 0.9, barrelM, 100, x, z, 0, false); }
  for (const [lx, lz, a] of [[0.2, 0.4, 0.5], [-0.3, -0.9, 2.1], [1.3, 0.9, 1.2]]) { const [x, z] = at(SM, lx, lz); box(1.5, 0.035, 0.2, plankM, 500, x, z, sy + a, wld.shack.y + wld.shack.floor); }   // boards fallen from the roof
}

// ---------- the sky: the menu's night with its aurora, and a pale cold day ----------
function makeSky(scene, fogColor, moon) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uDay: { value: 0 }, uStorm: { value: 0 }, uMoon: { value: moon }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uFog: { value: fogColor } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uTime; uniform float uDay; uniform float uStorm; uniform vec3 uMoon; uniform vec3 uSun; uniform vec3 uFog; varying vec3 vDir;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0), night = 1.0 - uDay;
        // the night: stars, the aurora, the moon
        vec3 col = mix(vec3(0.07, 0.13, 0.19), vec3(0.008, 0.018, 0.045), pow(up, 0.55));
        col += vec3(0.05, 0.08, 0.1) * pow(1.0 - abs(d.y), 8.0);
        vec2 su = vec2(atan(d.z, d.x) * 160.0, asin(clamp(d.y, -1.0, 1.0)) * 160.0);
        float s = h21(floor(su));
        float star = smoothstep(0.9955, 1.0, s) * smoothstep(0.02, 0.3, up) * (0.6 + 0.4 * sin(uTime * (2.0 + s * 9.0) + s * 60.0));
        col += vec3(0.85, 0.9, 1.0) * star * 1.4;
        vec3 acol = vec3(0.0);
        if (d.y > 0.02 && night > 0.01) {
          vec2 p = d.xz / (d.y + 0.12);
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float wave = sin(p.x * (0.35 + fi * 0.13) + uTime * (0.05 + fi * 0.02) + n2(p * 0.25 + uTime * 0.03) * 3.0) * 1.2;
            float band = exp(-pow((p.y + 1.2 + fi * 0.9 - wave) * 1.6, 2.0));
            float rays = 0.55 + 0.45 * sin(p.x * 22.0 + n2(vec2(p.x * 3.0, uTime * 0.4)) * 6.0);
            float a = band * rays * smoothstep(0.02, 0.25, d.y) * (0.6 - fi * 0.15);
            acol += mix(vec3(0.12, 1.0, 0.55), vec3(0.55, 0.3, 1.0), clamp(fi * 0.35 + (d.y - 0.2) * 1.6, 0.0, 1.0)) * a;
          }
        }
        col += acol * 0.55;
        float m = max(dot(d, uMoon), 0.0);
        col += vec3(0.55, 0.65, 0.8) * (pow(m, 900.0) * 3.0 + pow(m, 40.0) * 0.12);
        // the day: pale and cold, with a low sun
        vec3 day = mix(vec3(0.6, 0.72, 0.84), vec3(0.14, 0.32, 0.62), pow(up, 0.5));
        float sn = max(dot(d, uSun), 0.0);
        day += vec3(1.0, 0.92, 0.78) * (pow(sn, 1500.0) * 6.0 + pow(sn, 80.0) * 0.35 + pow(sn, 8.0) * 0.12);
        col = mix(col, day, uDay);
        // dawn and dusk: a warm band low on the sun's side
        float side = 0.3 + 0.7 * pow(max(dot(normalize(d.xz + 0.00001), normalize(uSun.xz + 0.00001)), 0.0), 2.0);
        col += vec3(1.0, 0.5, 0.22) * pow(1.0 - abs(d.y), 5.0) * side * uDay * night * 2.8;
        // haze on the horizon, and storm clouds closing the sky
        col = mix(col, uFog, clamp(pow(1.0 - up, 12.0) * 0.85 + uStorm * 0.93, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

// ---------- building it all ----------
export function buildWorld(R, scene, renderer, guest, crew = 1) {
  const rng = ISL.mulberry(2207);
  const phys = new R.World({ x: 0, y: -12, z: 0 });
  const wld = { phys, props: [], guest };
  const sparkleU = { value: 1 };
  makeTerrain(R, wld, scene, sparkleU);
  makeTrees(R, wld, scene, rng);
  makeRocks(R, wld, scene, rng);
  makeShack(R, wld, scene, rng);
  makeWreck(R, wld, scene, crew);
  makeTower(R, wld, scene);
  makeProps(R, wld, scene, rng, guest);

  // where the survivors stand when the game starts: in the snow by the torn-off end, looking at the fire
  wld.spawn = i => {
    _v.set(4.9 + (i % 2) * 1.5, 0, -12.2 - (i >> 1) * 1.6).applyMatrix4(wld.wreck.M);
    const x = _v.x, z = _v.z;
    return { x, y: wld.groundY(x, z) + 0.15, z, yaw: Math.atan2(x - wld.fire.pos.x, z - wld.fire.pos.z) };
  };

  // light
  scene.fog = new THREE.FogExp2('#0d1a28', 0.008);
  const MOON = new THREE.Vector3(-60, 70, -100).normalize(), SH = 55;
  const hemi = new THREE.HemisphereLight('#5a7aa0', '#1a2230', 0.75), amb = new THREE.AmbientLight('#2b3a55', 0.35);
  const dl = new THREE.DirectionalLight('#b8cbe8', 1.5), dir = MOON.clone();
  dl.castShadow = true;
  Object.assign(dl.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 320 });
  dl.shadow.bias = -0.0004; dl.shadow.normalBias = 0.04;
  scene.add(hemi, amb, dl, dl.target);
  const sky = makeSky(scene, scene.fog.color, MOON);
  const cFogN = col('#0d1a28'), cFogD = col('#a9bccd'), cFogSN = col('#121a23'), cFogSD = col('#c2cbd3'), cDusk = col('#c98a6a');
  const cHemiN = col('#5a7aa0'), cHemiD = col('#dbe8f5'), cGndN = col('#1a2230'), cGndD = col('#93a4b8'), cAmbN = col('#2b3a55'), cAmbD = col('#b3c0cf');
  const cMoon = col('#b8cbe8'), cSunLow = col('#ffb27a'), cSunHigh = col('#fff1dc');

  // falling snow (moved in the shader, wrapped around the camera; none under the shack's roof)
  let snow = null, fogBase = 0.008;
  const drift = new THREE.Vector3();
  function makeSnow() {
    const n = { low: 1500, medium: 3200, high: 6000, ultra: 10000 }[S.snow] || 6000;
    if (snow) { scene.remove(snow); snow.geometry.dispose(); snow.material.dispose(); }
    const box = 70, pos = new Float32Array(n * 3), spd = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * box; pos[i * 3 + 1] = (Math.random() - 0.5) * box; pos[i * 3 + 2] = (Math.random() - 0.5) * box; spd[i] = 0.6 + Math.random() * 0.8; ph[i] = Math.random() * 100; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uDrift: { value: drift }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uTime: { value: 0 }, uSize: { value: 70 * renderer.getPixelRatio() }, uAmount: { value: 0.3 },
        uShackInv: { value: wld.shack.inv }, uShackHalf: { value: wld.shack.half }, uCabInv: { value: wld.wreck.inv } },
      vertexShader: `uniform vec3 uDrift; uniform vec3 uCam; uniform float uBox; uniform float uTime; uniform float uSize; uniform float uAmount; uniform mat4 uShackInv; uniform vec3 uShackHalf; uniform mat4 uCabInv;
        attribute float aSpeed; attribute float aPhase; varying float vA;
        void main(){
          vec3 p = position + uDrift * aSpeed;
          p.x += sin(uTime * 1.3 + aPhase) * 0.5; p.z += cos(uTime * 1.1 + aPhase * 1.7) * 0.5;
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min(uSize * (0.55 + aSpeed * 0.45) / -mv.z, uSize * 0.22);
          vA = smoothstep(uBox * 0.5, uBox * 0.25, length(p - uCam)) * smoothstep(1.2, 4.0, -mv.z) * step(fract(aPhase * 0.618), uAmount);
          vec3 ls = (uShackInv * vec4(p, 1.0)).xyz;
          if (abs(ls.x) < uShackHalf.x && abs(ls.z) < uShackHalf.z && ls.y < uShackHalf.y) vA = 0.0;
          vec3 lc = (uCabInv * vec4(p, 1.0)).xyz;                                   // and none inside the plane
          if (abs(lc.x) < 1.55 && lc.y < 2.6 && lc.z > -6.3 && lc.z < 6.5) vA = 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA * 0.9; if (a < 0.01) discard; gl_FragColor = vec4(0.9, 0.95, 1.0, a); }`,
    });
    snow = new THREE.Points(geo, mat);
    snow.frustumCulled = false;
    scene.add(snow);
  }
  // big soft clouds of snow blowing along the ground, kept around the camera
  const drifts = [], dmat = new THREE.SpriteMaterial({ map: glowTex('rgba(230,240,255,0.5)', 'rgba(220,235,255,0.15)'), transparent: true, depthWrite: false, opacity: 0.18 });
  for (let i = 0; i < 36; i++) {
    const s = new THREE.Sprite(dmat.clone());
    s.userData = { x: (Math.random() - 0.5) * 220, z: (Math.random() - 0.5) * 220, o: 0.08 + Math.random() * 0.14, init: false };
    s.scale.set(14 + Math.random() * 12, 3 + Math.random() * 3, 1);
    scene.add(s); drifts.push(s);
  }

  wld.applyGfx = () => {
    fogBase = ({ low: 0.0045, medium: 0.008, high: 0.012 }[S.fog] || 0.008) + ({ near: 0.004, mid: 0.0015, far: 0 }[S.view] || 0);
    const sh = { low: 1024, high: 2048, ultra: 4096 }[S.shadows];
    renderer.shadowMap.enabled = !!sh; dl.castShadow = !!sh;
    if (sh && dl.shadow.mapSize.x !== sh) { dl.shadow.mapSize.set(sh, sh); dl.shadow.map?.dispose(); dl.shadow.map = null; }
    makeSnow();
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  };

  let t = 0;
  // every frame: the light, the sky, the snow, the fire, and the loose things following their bodies
  wld.update = (dt, env, cam) => {
    t += dt;
    const L = env.light, st = env.storm, tw = L * (1 - L) * 4;
    const fog = scene.fog;
    fog.color.copy(cFogN).lerp(cFogD, L); _c.copy(cFogSN).lerp(cFogSD, L); fog.color.lerp(_c, st).lerp(cDusk, tw * 0.22 * (1 - st));
    fog.density = fogBase * lerp(0.8, 0.42, L) * (1 + 2.4 * st);
    hemi.color.copy(cHemiN).lerp(cHemiD, L); hemi.groundColor.copy(cGndN).lerp(cGndD, L); hemi.intensity = lerp(0.75, 1.25, L) * (1 - 0.3 * st);
    amb.color.copy(cAmbN).lerp(cAmbD, L);
    if (L > 0.35) {        // the sun
      dir.set(env.sx, Math.max(env.sy, 0.07), env.sz).normalize();
      dl.color.copy(cSunLow).lerp(cSunHigh, smooth(0.03, 0.22, env.sy)); dl.intensity = 2.6 * smooth(0.35, 0.9, L) * (1 - 0.8 * st);
    } else {               // the moon
      dir.copy(MOON);
      dl.color.copy(cMoon); dl.intensity = 1.5 * (1 - smooth(0, 0.35, L)) * (1 - 0.55 * st);
    }
    // the shadows follow you, moved in whole texels of the shadow map so their edges don't crawl
    const tex = 2 * SH / dl.shadow.mapSize.x;
    _x.crossVectors(UP, dir).normalize(); _y.crossVectors(dir, _x);
    _t.copy(cam.position);
    const a = _t.dot(_x), b = _t.dot(_y);
    _t.addScaledVector(_x, Math.round(a / tex) * tex - a).addScaledVector(_y, Math.round(b / tex) * tex - b);
    dl.target.position.copy(_t); dl.position.copy(_t).addScaledVector(dir, 140);
    sky.position.copy(cam.position);
    const su = sky.material.uniforms;
    su.uTime.value = t; su.uDay.value = L; su.uStorm.value = st; su.uSun.value.set(env.sx, env.sy, env.sz);
    sparkleU.value = lerp(1, 1.5, L) * (1 - st * 0.7);

    // snow in the air and along the ground
    const wx = Math.cos(env.wdir) * env.wind, wz = Math.sin(env.wdir) * env.wind;
    drift.x += wx * dt; drift.z += wz * dt; drift.y -= (1.6 + env.gust * 0.8) * dt;
    const nu = snow.material.uniforms;
    nu.uCam.value.copy(cam.position); nu.uTime.value = t; nu.uAmount.value = clamp(0.3 + st * 0.7 + env.gust * 0.15, 0, 1);
    for (const s of drifts) {
      const u = s.userData;
      if (!u.init) { u.init = true; u.x += cam.position.x; u.z += cam.position.z; }
      u.x += wx * dt * 1.4; u.z += wz * dt * 1.4;
      const dx = u.x - cam.position.x, dz = u.z - cam.position.z;
      if (dx > 110) u.x -= 220; else if (dx < -110) u.x += 220;
      if (dz > 110) u.z -= 220; else if (dz < -110) u.z += 220;
      s.position.set(u.x, Math.max(wld.groundY(u.x, u.z), ISL.SEA) + 1.4, u.z);
      s.material.opacity = u.o * (0.4 + env.gust + st * 1.2) * smooth(9, 18, Math.hypot(u.x - ISL.SHACK.x, u.z - ISL.SHACK.z)) * smooth(5, 16, Math.hypot(dx, dz));
    }

    // the wreck's fire: it burns through the first night, then only smokes
    const f = env.fire, fr = wld.fire, flick = 0.75 + 0.25 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1) + Math.random() * 0.12;
    fr.light.intensity = 16 * flick * f;
    for (const s of fr.sprites) {
      const u = s.userData; u.t += dt * 1.4;
      if (u.t > 1) { u.t -= 1; u.x = (Math.random() - 0.5) * 1.4; u.z = (Math.random() - 0.5) * 1.2; }
      s.position.set(fr.base.x + u.x * (1 - u.t) + u.t * env.wind * 0.1, fr.base.y + u.t * 2.4, fr.base.z + u.z * (1 - u.t));
      s.scale.setScalar((1.3 * (1 - u.t) + 0.2) * (0.35 + 0.65 * f));
      s.material.opacity = (1 - u.t) * 0.9 * f;
    }
    fr.smoke.update(dt);
    for (const s of fr.smoke.list) s.material.opacity *= 0.3 + 0.7 * f;
    // inside the plane: the fire in the back, smoke rolling along the ceiling and out of the hole, the red light
    const wr = wld.wreck, fi = smooth(0.15, 0.6, f);
    wr.inLight.intensity = 7 * flick * fi;
    wr.redLight.intensity = f > 0.2 ? (Math.random() < 0.06 ? 0.3 : 1.5) * smooth(0.2, 0.5, f) : 0;
    for (const s of wr.inFire) {
      const u = s.userData; u.t += dt * (u.top ? 1.0 : 1.5); if (u.t > 1) u.t -= 1;
      s.position.set(u.bx + Math.sin(u.t * 5 + u.bz) * 0.05, FLOOR + u.by + u.t * (u.top ? 0.25 : 0.7), u.bz - u.t * 0.25);
      s.scale.setScalar(((u.top ? 0.35 : 0.55) * (1 - u.t) + 0.12) * fi + 0.001);
      s.material.opacity = (1 - u.t) * 0.85 * fi;
    }
    for (const s of wr.inSmoke) {
      const u = s.userData; u.t += dt * 0.07; if (u.t > 1) { u.t -= 1; u.bx = (Math.random() - 0.5) * 1.6; }
      s.position.set(u.bx * 0.7 + Math.sin(u.t * 3 + u.ph) * 0.2, FLOOR + 2.0 - u.t * 0.1 + Math.sin(u.t * 5 + u.ph) * 0.05, 4.0 - u.t * 11);
      s.scale.setScalar(0.6 + u.t * 1.8);
      s.material.opacity = Math.sin(Math.PI * u.t) * 0.6 * fi;
    }
    const blink = (t % 1.6) < 0.25;
    wld.tower.lamp.material.opacity = blink ? 1 : 0.08; wld.tower.light.intensity = blink ? 6 : 0;

    // loose things
    for (const p of wld.props) {
      if (guest) {            // follow what the host sent
        if (!p.to) continue;
        const k = 1 - Math.exp(-14 * dt);
        p.mesh.position.x += (p.to[0] - p.mesh.position.x) * k; p.mesh.position.y += (p.to[1] - p.mesh.position.y) * k; p.mesh.position.z += (p.to[2] - p.mesh.position.z) * k;
        p.mesh.quaternion.slerp(_q.set(p.to[3], p.to[4], p.to[5], p.to[6]), k);
        p.body.setNextKinematicTranslation(p.mesh.position); p.body.setNextKinematicRotation(quat(p.mesh.quaternion));
      } else if (!p.body.isSleeping()) {
        const tr = p.body.translation(), ro = p.body.rotation();
        p.mesh.position.set(tr.x, tr.y, tr.z); p.mesh.quaternion.set(ro.x, ro.y, ro.z, ro.w);
        if (tr.y < Math.max(wld.groundY(tr.x, tr.z), ISL.SEA) - 1.5) {   // fell through the ground or the ice: put it back
          p.body.setTranslation({ x: p.home[0], y: p.home[1] + 0.5, z: p.home[2] }, true);
          p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
  };

  wld.applyGfx();
  phys.step();          // one step so the first ray casts and the first footstep see every collider
  return wld;
}
