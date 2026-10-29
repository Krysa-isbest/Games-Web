// models.js — low-poly model library. Everything is built from primitives merged into one
// vertex-colored geometry with flat (faceted) normals, so one material draws almost everything.
'use strict';

const V3 = THREE.Vector3;
const M = {};
M.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
M.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
M.matGlass = new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });

const _c = new THREE.Color(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

class MB {
  constructor() { this.parts = []; }
  // c: hex color, or function(triangleIndex) -> hex. jit: vertex jitter amount for organic shapes
  add(geo, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jit = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.deleteAttribute('uv'); if (g.attributes.uv2) g.deleteAttribute('uv2');
    const pos = g.attributes.position;
    if (jit) {
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const k = Math.round(px * 997) * 3 + Math.round(py * 991) * 7 + Math.round(pz * 983) * 13;
        const h1 = U.hash2(k, 1) - 0.5, h2 = U.hash2(k, 2) - 0.5, h3 = U.hash2(k, 3) - 0.5;
        pos.setXYZ(i, px + h1 * jit, py + h2 * jit, pz + h3 * jit);
      }
    }
    _m4.compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new V3(sx, sy, sz));
    g.applyMatrix4(_m4);
    g.computeVertexNormals();
    const n = pos.count, col = new Float32Array(n * 3);
    const fn = typeof c === 'function' ? c : null;
    for (let t = 0; t < n / 3; t++) {
      _c.setHex(fn ? fn(t) : c);
      const v = 1 + (Math.random() - 0.5) * 0.07; // tiny per-face shade variation
      for (let k = 0; k < 3; k++) { const i = (t * 3 + k) * 3; col[i] = _c.r * v; col[i + 1] = _c.g * v; col[i + 2] = _c.b * v; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }
  box(w, h, d, c, x, y, z, rx, ry, rz) { return this.add(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz); }
  cyl(rt, rb, h, seg, c, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z, rx, ry, rz, sx, sy, sz); }
  cone(r, h, seg, c, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1, jit = 0) { return this.add(new THREE.ConeGeometry(r, h, seg), c, x, y, z, rx, ry, rz, sx, sy, sz, jit); }
  ico(r, det, c, x, y, z, sx = 1, sy = 1, sz = 1, jit = 0, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.IcosahedronGeometry(r, det), c, x, y, z, rx, ry, rz, sx, sy, sz, jit); }
  dod(r, c, x, y, z, sx = 1, sy = 1, sz = 1, jit = 0) { return this.add(new THREE.DodecahedronGeometry(r, 0), c, x, y, z, 0, 0, 0, sx, sy, sz, jit); }
  sph(r, ws, hs, c, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.SphereGeometry(r, ws, hs), c, x, y, z, rx, ry, rz, sx, sy, sz); }
  tor(r, t, rs, ts, c, x, y, z, rx, ry, rz, arc = Math.PI * 2) { return this.add(new THREE.TorusGeometry(r, t, rs, ts, arc), c, x, y, z, rx, ry, rz); }
  // triangular prism along z (for gable roofs): width w at base, height h, length l
  prism(w, h, l, c, x, y, z, rx = 0, ry = 0, rz = 0) {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: l, bevelEnabled: false }); g.translate(0, 0, -l / 2);
    return this.add(g, c, x, y, z, rx, ry, rz);
  }
  merge(other) { this.parts.push(...other.parts); return this; }
  geo() {
    let n = 0; for (const p of this.parts) n += p.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    for (const p of this.parts) {
      P.set(p.attributes.position.array, o); N.set(p.attributes.normal.array, o); C.set(p.attributes.color.array, o);
      o += p.attributes.position.count * 3; p.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    this.parts = [];
    return g;
  }
  mesh(mat = M.mat, shadow = true) {
    const m = new THREE.Mesh(this.geo(), mat);
    m.castShadow = shadow; m.receiveShadow = true;
    return m;
  }
}
M.MB = MB;

const COL = {
  barnRed: 0xb3322b, barnRedDark: 0x8e2621, trim: 0xf3eee2, roof: 0x4a4d57, roofDark: 0x3a3c44,
  wood: 0x8a5a33, woodDark: 0x5e3b22, woodLight: 0xb88456, hay: 0xe2c25a, stone: 0x8d8f94,
  houseWall: 0xf0e2c0, houseBlue: 0x5b87b5, houseRoof: 0x7b3b2b, glass: 0x9fd3f0, skin: 0xf0c49a,
  grass: 0x6fae3d, dirt: 0x6b4a2f, metal: 0xa9b0b8, darkMetal: 0x50555c, army: 0x4f5d3a,
};
M.COL = COL;

// ---------------- crops ----------------
function lerpHex(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }

M.cropGeo = function (ci, stage) {
  const cr = CROPS[ci], b = new MB();
  const L = cr.leaf, F = stage === 3 ? cr.fruit : lerpHex(cr.fruit, cr.leaf, 0.55);
  const fs = stage === 3 ? 1 : 0.7; // fruit size factor while unripe
  if (stage === 0) {
    b.box(0.02, 0.12, 0.02, L, 0, 0.06, 0);
    b.box(0.12, 0.015, 0.06, L, 0.06, 0.12, 0, 0, 0, 0.4);
    b.box(0.12, 0.015, 0.06, L, -0.06, 0.12, 0, 0, 0, -0.4);
    return b.geo();
  }
  if (stage === 1) {
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.3;
      b.box(0.22, 0.02, 0.09, L, Math.cos(a) * 0.1, 0.13 + i * 0.02, Math.sin(a) * 0.1, 0, -a, 0.35);
    }
    b.box(0.025, 0.2, 0.025, L, 0, 0.1, 0);
    return b.geo();
  }
  const s = stage === 2 ? 0.8 : 1;
  switch (cr.shape) {
    case 'wheat':
      for (let i = 0; i < 9; i++) {
        const x = (U.hash2(i, ci) - 0.5) * 0.55, z = (U.hash2(i, ci + 9) - 0.5) * 0.55, h = (0.75 + U.hash2(i, 3) * 0.3) * s;
        b.box(0.025, h, 0.025, lerpHex(L, F, stage === 3 ? 0.6 : 0.1), x, h / 2, z, (U.hash2(i, 5) - 0.5) * 0.2, 0, (U.hash2(i, 6) - 0.5) * 0.2);
        b.box(0.06, 0.2 * s, 0.06, F, x, h + 0.05, z);
      }
      break;
    case 'lettuce':
      b.ico(0.26 * s, 1, L, 0, 0.13 * s, 0, 1, 0.6, 1, 0.08);
      b.ico(0.17 * s, 1, F, 0, 0.2 * s, 0, 1, 0.8, 1, 0.06);
      break;
    case 'carrot':
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.cone(0.03, 0.45 * s, 4, L, Math.cos(a) * 0.05, 0.25 * s, Math.sin(a) * 0.05, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); }
      b.cone(0.08 * fs, 0.25, 6, F, 0, 0.03, 0, Math.PI, 0, 0);
      break;
    case 'bush':
      b.ico(0.3 * s, 0, L, 0, 0.25 * s, 0, 1.1, 0.8, 1.1, 0.08);
      b.ico(0.2 * s, 0, lerpHex(L, 0xffffff, 0.1), 0.12, 0.35 * s, 0.05, 1, 0.8, 1, 0.05);
      if (stage === 3) for (let i = 0; i < 4; i++) { const a = i * 1.7; b.dod(0.07, F, Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3, 1.2, 0.9, 1, 0.02); }
      for (let i = 0; i < 3; i++) b.ico(0.035, 0, 0xf2f2f2, Math.cos(i * 2) * 0.18, 0.5 * s, Math.sin(i * 2) * 0.18);
      break;
    case 'tomato':
      b.box(0.035, 1.1 * s, 0.035, COL.woodLight, 0, 0.55 * s, 0);
      for (let i = 0; i < 4; i++) b.ico(0.2 * s, 0, L, (i % 2 - 0.5) * 0.18, (0.25 + i * 0.2) * s, ((i >> 1) - 0.5) * 0.12, 1, 0.8, 1, 0.07);
      for (let i = 0; i < 6; i++) b.ico(0.075 * fs, 1, F, Math.cos(i * 2.3) * 0.2, (0.3 + (i % 3) * 0.22) * s, Math.sin(i * 2.3) * 0.2);
      break;
    case 'corn':
      b.cyl(0.035, 0.05, 1.7 * s, 5, 0x7bab45, 0, 0.85 * s, 0);
      for (let i = 0; i < 5; i++) { const a = i * 2.4; b.box(0.5 * s, 0.015, 0.09, L, Math.cos(a) * 0.2, (0.4 + i * 0.25) * s, Math.sin(a) * 0.2, 0, -a, -0.5); }
      b.cyl(0.07 * fs, 0.06 * fs, 0.32 * fs, 6, F, 0.08, 1.05 * s, 0, 0, 0, -0.35);
      b.cone(0.08, 0.3 * fs, 5, 0x9cc25a, 0.1, 0.92 * s, 0, 0, 0, -0.35 + Math.PI);
      b.cone(0.04, 0.25, 4, 0xd8c47a, 0, 1.8 * s, 0);
      break;
    case 'cabbage':
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; b.ico(0.18 * s, 0, L, Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18, 1.2, 0.4, 1.2, 0.04); }
      b.ico(0.24 * s * fs, 1, F, 0, 0.22 * s, 0, 1, 0.9, 1, 0.05);
      break;
    case 'berry':
      b.ico(0.28 * s, 0, L, 0, 0.2 * s, 0, 1.2, 0.7, 1.2, 0.09);
      for (let i = 0; i < 9; i++) b.ico(0.04 * fs + 0.01, 0, F, Math.cos(i * 2.1) * 0.27 * s, (0.15 + (i % 3) * 0.08) * s, Math.sin(i * 2.1) * 0.27 * s);
      break;
    case 'pepper':
      b.box(0.03, 0.6 * s, 0.03, L, 0, 0.3 * s, 0);
      b.ico(0.27 * s, 0, L, 0, 0.42 * s, 0, 1.1, 0.8, 1.1, 0.08);
      for (let i = 0; i < 4; i++) b.cone(0.06 * fs, 0.22 * fs, 5, F, Math.cos(i * 1.6) * 0.24, 0.3 * s, Math.sin(i * 1.6) * 0.24, Math.PI, 0, 0);
      break;
    case 'eggplant':
      b.ico(0.3 * s, 0, L, 0, 0.45 * s, 0, 1.1, 0.8, 1.1, 0.08);
      b.box(0.03, 0.5 * s, 0.03, L, 0, 0.25 * s, 0);
      for (let i = 0; i < 3; i++) { const a = i * 2.1; b.sph(0.08 * fs, 6, 4, F, Math.cos(a) * 0.2, 0.22 * s, Math.sin(a) * 0.2, 1, 1.9, 1); b.cone(0.05, 0.06, 5, 0x3c6e2a, Math.cos(a) * 0.2, 0.36 * s, Math.sin(a) * 0.2); }
      break;
    case 'sunflower':
      b.cyl(0.035, 0.05, 1.8 * s, 5, 0x6a9e3a, 0, 0.9 * s, 0);
      b.box(0.35, 0.015, 0.15, L, 0.15, 0.6 * s, 0, 0, 0, -0.4); b.box(0.35, 0.015, 0.15, L, -0.15, 0.9 * s, 0, 0, 0, 0.4);
      { const y = 1.8 * s, r = 0.26 * fs;
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; b.box(0.09, r, 0.02, F, Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, 0.06, 0, 0, a - Math.PI / 2); }
        b.cyl(r * 0.6, r * 0.6, 0.06, 8, stage === 3 ? 0x5a3517 : 0x6f7f33, 0, y, 0.08, Math.PI / 2, 0, 0); }
      break;
    case 'pumpkin':
      for (let i = 0; i < 4; i++) { const a = i * 1.6; b.ico(0.16, 0, L, Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32, 1.3, 0.25, 1.3); }
      { const r = 0.26 * fs * s;
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.sph(r * 0.62, 6, 5, F, Math.cos(a) * r * 0.42, r * 0.75, Math.sin(a) * r * 0.42, 0.75, 1, 0.75, 0, -a, 0); }
        b.cyl(0.03, 0.04, 0.14, 5, 0x5b7a2a, 0, r * 1.45, 0); }
      break;
    case 'cauli':
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.box(0.34 * s, 0.02, 0.16, L, Math.cos(a) * 0.17, 0.18, Math.sin(a) * 0.17, 0, -a, 0.6); }
      b.ico(0.18 * s * fs, 1, F, 0, 0.25 * s, 0, 1, 0.75, 1, 0.06);
      break;
    case 'melon': {
      for (let i = 0; i < 4; i++) { const a = i * 1.6 + 0.4; b.ico(0.15, 0, L, Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32, 1.3, 0.25, 1.3); }
      const r = 0.26 * fs * s, dark = lerpHex(F, 0x0b2a10, 0.5);
      b.sph(r, 10, 6, t => ((t >> 1) % 2 ? F : dark), 0, r * 0.8, 0, 1.3, 0.85, 1, 0, 0.4, Math.PI / 2);
      if (cr.moon) b.ico(r * 0.4, 0, 0xeaf4ff, 0.1, r * 1.5, 0, 1, 1, 1, 0, 0, 0, 0);
      break; }
    case 'pineapple': {
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; b.cone(0.05, 0.5 * s, 4, L, Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); }
      const r = 0.13 * fs * s, dk = lerpHex(F, 0x5a3a10, 0.5);
      b.sph(r, 6, 6, t => (t % 3 ? F : dk), 0, 0.3 * s + r, 0, 1, 1.6, 1);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; b.cone(0.03, 0.22, 4, 0x3f7f3f, Math.cos(a) * 0.04, 0.3 * s + r * 2.9, Math.sin(a) * 0.04, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
      break; }
    case 'dragon': {
      b.box(0.12, 0.7 * s, 0.12, L, 0, 0.35 * s, 0);
      b.box(0.1, 0.4 * s, 0.1, L, 0.18, 0.5 * s, 0, 0, 0, -0.6); b.box(0.1, 0.4 * s, 0.1, L, -0.18, 0.55 * s, 0, 0, 0, 0.6);
      const r = 0.12 * fs;
      b.sph(r, 6, 5, F, 0, 0.8 * s, 0, 1, 1.3, 1);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; b.cone(0.035, 0.12, 4, 0x8acb3a, Math.cos(a) * r * 0.8, 0.8 * s + Math.sin(i) * 0.06, Math.sin(a) * r * 0.8, Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2); }
      break; }
  }
  return b.geo();
};

// ---------------- nature ----------------
M.treeGeo = function (type, seed) {
  const b = new MB(), r = U.rng(seed);
  if (type === 0) { // round deciduous
    const h = 2.4 + r() * 1.4;
    b.cyl(0.2, 0.3, h, 6, COL.woodDark, 0, h / 2, 0);
    b.cyl(0.08, 0.12, 1.2, 5, COL.woodDark, 0.4, h * 0.7, 0, 0, 0, -0.8);
    const g = [0x4f8f32, 0x5ea33a, 0x467f2c][Math.floor(r() * 3)];
    b.ico(1.6 + r() * 0.5, 0, g, 0, h + 1.0, 0, 1, 0.85, 1, 0.5);
    b.ico(1.1 + r() * 0.3, 0, lerpHex(g, 0xb5d65a, 0.25), 0.9, h + 0.4, 0.4, 1, 0.85, 1, 0.35);
    b.ico(1.0 + r() * 0.3, 0, lerpHex(g, 0x2d5a1c, 0.2), -0.8, h + 0.6, -0.5, 1, 0.85, 1, 0.35);
  } else if (type === 1) { // pine
    const h = 1.2 + r() * 0.6;
    b.cyl(0.18, 0.26, h + 1, 6, COL.woodDark, 0, (h + 1) / 2, 0);
    const g = [0x2f6b3a, 0x3a7a42, 0x285c33][Math.floor(r() * 3)];
    for (let i = 0; i < 4; i++) b.cone(2.0 - i * 0.42, 1.9, 7, lerpHex(g, 0x1c3f22, i * 0.05), 0, h + 0.8 + i * 1.15, 0, 0, i * 0.5, 0, 1, 1, 1, 0.12);
  } else { // apple tree
    const h = 2.0;
    b.cyl(0.18, 0.26, h, 6, COL.woodDark, 0, h / 2, 0);
    b.ico(1.5, 0, 0x5a9c38, 0, h + 0.9, 0, 1.15, 0.8, 1.15, 0.4);
    for (let i = 0; i < 9; i++) { const a = i * 2.39, rr = 1.2 + r() * 0.4; b.ico(0.12, 0, 0xd92b2b, Math.cos(a) * rr, h + 0.4 + r() * 1.2, Math.sin(a) * rr); }
  }
  return b.geo();
};
M.rockGeo = seed => { const b = new MB(), r = U.rng(seed); b.dod(0.6 + r() * 0.6, lerpHex(COL.stone, 0x6b6e73, r()), 0, 0.2, 0, 1 + r() * 0.5, 0.6 + r() * 0.3, 1 + r() * 0.4, 0.35); return b.geo(); };
M.bushGeo = () => { const b = new MB(); b.ico(0.7, 0, 0x4a8a30, 0, 0.4, 0, 1.2, 0.8, 1, 0.3); b.ico(0.5, 0, 0x5aa03a, 0.5, 0.35, 0.2, 1, 0.8, 1, 0.2); return b.geo(); };
M.grassGeo = () => { const b = new MB(); for (let i = 0; i < 4; i++) { const a = i * 1.7; b.cone(0.05, 0.45, 3, i % 2 ? 0x7cba45 : 0x66a33a, Math.cos(a) * 0.08, 0.2, Math.sin(a) * 0.08, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3); } return b.geo(); };
M.flowerGeo = c => { const b = new MB(); b.box(0.02, 0.3, 0.02, 0x4f8f32, 0, 0.15, 0); b.ico(0.06, 0, c, 0, 0.32, 0); b.ico(0.025, 0, 0xffe066, 0, 0.36, 0.02); return b.geo(); };

// ---------------- animals ----------------
// each returns {body: geometry, legs: [ {geo, x, y, z} ] } facing +z; legs pivot at their top
M.animal = function (kind) {
  const b = new MB(); const legs = [];
  const leg = (w, h, c, x, y, z, hoof) => { const l = new MB(); l.box(w, h, w, c, 0, -h / 2, 0); if (hoof) l.box(w * 1.05, 0.08, w * 1.05, hoof, 0, -h + 0.04, 0); legs.push({ geo: l.geo(), x, y, z }); };
  if (kind === 'cow') {
    b.box(0.8, 0.75, 1.5, 0xf4f1ea, 0, 1.05, 0);
    b.box(0.82, 0.4, 0.5, 0x2a2a2a, 0.01, 1.2, 0.25); b.box(0.5, 0.5, 0.4, 0x2a2a2a, -0.18, 1.1, -0.45); b.box(0.3, 0.3, 0.3, 0x2a2a2a, 0.3, 1.3, -0.1);
    b.box(0.5, 0.5, 0.55, 0xf4f1ea, 0, 1.35, 0.95); b.box(0.42, 0.25, 0.2, 0xf2a3a8, 0, 1.2, 1.25);
    b.box(0.06, 0.06, 0.02, 0x222222, -0.1, 1.2, 1.36); b.box(0.06, 0.06, 0.02, 0x222222, 0.1, 1.2, 1.36);
    b.box(0.06, 0.08, 0.02, 0x111111, -0.16, 1.45, 1.23); b.box(0.06, 0.08, 0.02, 0x111111, 0.16, 1.45, 1.23);
    b.cone(0.05, 0.22, 4, 0xe8e0c8, -0.2, 1.68, 0.9, 0, 0, 0.5); b.cone(0.05, 0.22, 4, 0xe8e0c8, 0.2, 1.68, 0.9, 0, 0, -0.5);
    b.box(0.2, 0.1, 0.12, 0x2a2a2a, -0.33, 1.5, 0.85, 0, 0, 0.3); b.box(0.2, 0.1, 0.12, 0x2a2a2a, 0.33, 1.5, 0.85, 0, 0, -0.3);
    b.box(0.35, 0.18, 0.35, 0xf2a3a8, 0, 0.62, -0.25);
    b.box(0.05, 0.6, 0.05, 0xf4f1ea, 0, 0.95, -0.77, 0.25, 0, 0); b.box(0.1, 0.15, 0.1, 0x2a2a2a, 0, 0.63, -0.85);
    for (const [x, z] of [[-0.28, 0.55], [0.28, 0.55], [-0.28, -0.55], [0.28, -0.55]]) leg(0.18, 0.7, 0xf4f1ea, x, 0.7, z, 0x333333);
  } else if (kind === 'pig') {
    b.box(0.6, 0.55, 1.0, 0xf2a7b5, 0, 0.62, 0); b.box(0.45, 0.42, 0.35, 0xf2a7b5, 0, 0.72, 0.62);
    b.cyl(0.13, 0.13, 0.1, 8, 0xe58a9c, 0, 0.68, 0.83, Math.PI / 2, 0, 0);
    b.box(0.04, 0.05, 0.02, 0x7a3b47, -0.05, 0.68, 0.885); b.box(0.04, 0.05, 0.02, 0x7a3b47, 0.05, 0.68, 0.885);
    b.box(0.05, 0.05, 0.02, 0x111111, -0.12, 0.82, 0.8); b.box(0.05, 0.05, 0.02, 0x111111, 0.12, 0.82, 0.8);
    b.box(0.14, 0.14, 0.04, 0xe58a9c, -0.17, 0.97, 0.6, 0.4, 0, 0.3); b.box(0.14, 0.14, 0.04, 0xe58a9c, 0.17, 0.97, 0.6, 0.4, 0, -0.3);
    b.tor(0.06, 0.02, 4, 8, 0xe58a9c, 0, 0.75, -0.53, 0, Math.PI / 2, 0);
    for (const [x, z] of [[-0.18, 0.32], [0.18, 0.32], [-0.18, -0.32], [0.18, -0.32]]) leg(0.14, 0.36, 0xf2a7b5, x, 0.36, z, 0xb06a78);
  } else if (kind === 'sheep') {
    for (let i = 0; i < 7; i++) b.ico(0.32, 0, 0xf7f5ee, (U.hash2(i, 1) - 0.5) * 0.45, 0.85 + (U.hash2(i, 2) - 0.5) * 0.25, (i / 6 - 0.5) * 0.85, 1, 1, 1, 0.08);
    b.box(0.3, 0.32, 0.4, 0x2b2b2b, 0, 0.95, 0.6); b.ico(0.18, 0, 0xf7f5ee, 0, 1.15, 0.52);
    b.box(0.05, 0.05, 0.02, 0xffffff, -0.08, 1.0, 0.805); b.box(0.05, 0.05, 0.02, 0xffffff, 0.08, 1.0, 0.805);
    b.box(0.16, 0.07, 0.08, 0x2b2b2b, -0.2, 1.02, 0.55, 0, 0, 0.4); b.box(0.16, 0.07, 0.08, 0x2b2b2b, 0.2, 1.02, 0.55, 0, 0, -0.4);
    for (const [x, z] of [[-0.18, 0.3], [0.18, 0.3], [-0.18, -0.3], [0.18, -0.3]]) leg(0.1, 0.55, 0x2b2b2b, x, 0.55, z);
  } else if (kind === 'chicken') {
    b.ico(0.22, 1, 0xfafafa, 0, 0.42, 0, 0.95, 0.85, 1.25);
    b.ico(0.13, 1, 0xfafafa, 0, 0.66, 0.2);
    b.cone(0.045, 0.11, 4, 0xf5a623, 0, 0.64, 0.36, Math.PI / 2, 0, 0);
    b.box(0.03, 0.09, 0.12, 0xe0282b, 0, 0.8, 0.2); b.box(0.03, 0.07, 0.04, 0xe0282b, 0, 0.57, 0.31);
    b.box(0.03, 0.03, 0.02, 0x111111, -0.07, 0.69, 0.3); b.box(0.03, 0.03, 0.02, 0x111111, 0.07, 0.69, 0.3);
    b.box(0.06, 0.22, 0.14, 0xeeeeee, 0, 0.55, -0.25, -0.5, 0, 0);
    b.box(0.04, 0.18, 0.26, 0xf0f0f0, -0.2, 0.43, -0.02); b.box(0.04, 0.18, 0.26, 0xf0f0f0, 0.2, 0.43, -0.02);
    for (const x of [-0.07, 0.07]) { const l = new MB(); l.box(0.03, 0.22, 0.03, 0xf5a623, 0, -0.11, 0); l.box(0.09, 0.02, 0.12, 0xf5a623, 0, -0.22, 0.03); legs.push({ geo: l.geo(), x, y: 0.24, z: 0 }); }
  } else if (kind === 'gnome') {
    b.cyl(0.16, 0.22, 0.38, 6, 0x2f6fd1, 0, 0.3, 0);
    b.ico(0.14, 1, COL.skin, 0, 0.6, 0);
    b.cone(0.16, 0.26, 6, 0xf2f2f2, 0, 0.47, 0.09, -0.35, 0, 0, 1, 1, 0.7);
    b.ico(0.04, 0, 0xf29b9b, 0, 0.6, 0.14);
    b.cone(0.16, 0.42, 6, 0xd42a2a, 0, 0.88, -0.02, -0.15, 0, 0);
    b.box(0.04, 0.04, 0.02, 0x111111, -0.05, 0.64, 0.13); b.box(0.04, 0.04, 0.02, 0x111111, 0.05, 0.64, 0.13);
    for (const x of [-0.08, 0.08]) { const l = new MB(); l.box(0.08, 0.14, 0.08, 0x6b3e1e, 0, -0.07, 0); legs.push({ geo: l.geo(), x, y: 0.14, z: 0 }); }
  }
  return { body: b.geo(), legs };
};

// remote-player farmer avatar; color = shirt
M.farmer = function (color) {
  const g = new THREE.Group();
  const body = new MB();
  body.box(0.5, 0.6, 0.28, color, 0, 1.2, 0);
  body.box(0.52, 0.32, 0.3, 0x3d5f9c, 0, 0.98, 0);          // overalls
  body.box(0.07, 0.35, 0.31, 0x3d5f9c, -0.15, 1.3, 0); body.box(0.07, 0.35, 0.31, 0x3d5f9c, 0.15, 1.3, 0);
  body.box(0.34, 0.34, 0.32, COL.skin, 0, 1.72, 0);
  body.box(0.05, 0.05, 0.02, 0x222222, -0.08, 1.75, 0.165); body.box(0.05, 0.05, 0.02, 0x222222, 0.08, 1.75, 0.165);
  body.box(0.2, 0.04, 0.02, 0x9a5a3a, 0, 1.63, 0.165);
  body.cyl(0.42, 0.42, 0.04, 10, 0xe6c56a, 0, 1.9, 0);           // straw hat
  body.cyl(0.2, 0.22, 0.18, 10, 0xe6c56a, 0, 2.0, 0);
  body.cyl(0.225, 0.225, 0.05, 10, 0xb33a2b, 0, 1.95, 0);
  const bm = new THREE.Mesh(body.geo(), M.mat); bm.castShadow = true; g.add(bm);
  const limb = (w, h, c, x, y) => { const l = new MB(); l.box(w, h, w, c, 0, -h / 2, 0); const m = new THREE.Mesh(l.geo(), M.mat); m.position.set(x, y, 0); m.castShadow = true; g.add(m); return m; };
  g.userData.legs = [limb(0.2, 0.85, 0x3d5f9c, -0.13, 0.85), limb(0.2, 0.85, 0x3d5f9c, 0.13, 0.85)];
  g.userData.arms = [limb(0.15, 0.6, color, -0.33, 1.48), limb(0.15, 0.6, color, 0.33, 1.48)];
  return g;
};

// ---------------- misc props ----------------
M.frog = () => { const b = new MB(); b.ico(0.12, 0, 0x4caf3a, 0, 0.1, 0, 1.2, 0.7, 1.3); b.ico(0.05, 0, 0xffffff, -0.06, 0.18, 0.08); b.ico(0.05, 0, 0xffffff, 0.06, 0.18, 0.08); b.ico(0.025, 0, 0x111111, -0.06, 0.19, 0.12); b.ico(0.025, 0, 0x111111, 0.06, 0.19, 0.12); b.box(0.08, 0.04, 0.16, 0x3d8f2e, -0.12, 0.04, -0.04); b.box(0.08, 0.04, 0.16, 0x3d8f2e, 0.12, 0.04, -0.04); return b.geo(); };
M.fish = () => { const b = new MB(); b.ico(0.14, 0, 0x6f9fc8, 0, 0.08, 0, 0.5, 0.8, 1.6); b.cone(0.1, 0.15, 4, 0x4f7fa8, 0, 0.08, -0.26, -Math.PI / 2, 0, 0, 0.4, 1, 1); b.ico(0.02, 0, 0x111111, 0.05, 0.12, 0.13); return b.geo(); };
M.egg = () => { const b = new MB(); b.ico(0.07, 1, 0xf7ecd8, 0, 0.08, 0, 1, 1.3, 1); return b.geo(); };
M.meteorite = () => { const b = new MB(); b.dod(0.3, 0x3b3330, 0, 0.2, 0, 1, 0.8, 1, 0.15); b.ico(0.12, 0, 0xff7a1a, 0.15, 0.32, 0.1); return b.geo(); };
M.stardust = () => { const b = new MB(); b.add(new THREE.OctahedronGeometry(0.2, 0), 0xfff2a0, 0, 0.35, 0, 0, 0, 0, 1, 1.4, 1); return b.geo(); };
M.bag = () => { const b = new MB(); b.ico(0.3, 0, 0xc9a46a, 0, 0.28, 0, 1, 1.1, 1, 0.06); b.cyl(0.12, 0.16, 0.12, 6, 0xb0884f, 0, 0.62, 0); b.tor(0.1, 0.025, 4, 8, 0x7a5a2a, 0, 0.55, 0, Math.PI / 2, 0, 0); return b.geo(); };
M.wool = () => { const b = new MB(); b.ico(0.18, 0, 0xf7f5ee, 0, 0.18, 0, 1, 0.8, 1, 0.05); return b.geo(); };
M.truffle = () => { const b = new MB(); b.dod(0.1, 0x3a2617, 0, 0.1, 0, 1, 0.9, 1, 0.05); return b.geo(); };
M.pumpkinBit = () => { const b = new MB(); b.box(0.35, 0.25, 0.25, 0xf07a1a, 0, 0.15, 0, 0.2, 0.4, 0.1); return b.geo(); };

M.meteor = () => { const b = new MB(); b.dod(1, 0x4a3a32, 0, 0, 0, 1, 1, 1, 0.3); b.ico(0.7, 0, 0xff8a2a, 0.25, 0.25, 0.25, 1, 1, 1, 0.2); return b.geo(); };
M.hail = () => { const b = new MB(); b.ico(0.08, 0, 0xe8f4ff, 0, 0, 0); return b.geo(); };
M.lavaBomb = () => { const b = new MB(); b.dod(0.6, 0x2a1a14, 0, 0, 0, 1, 1, 1, 0.2); b.ico(0.5, 0, 0xff4a0a, 0.1, 0.1, 0); return b.geo(); };
M.crate = () => { const b = new MB(); b.box(0.8, 0.8, 0.8, COL.woodLight, 0, 0, 0); b.box(0.84, 0.12, 0.84, COL.wood, 0, 0.3, 0); b.box(0.84, 0.12, 0.84, COL.wood, 0, -0.3, 0); return b.geo(); };
M.plank = () => { const b = new MB(); b.box(0.25, 0.06, 1.6, COL.wood, 0, 0, 0); return b.geo(); };
M.bomb = () => {
  const b = new MB();
  b.cyl(0.55, 0.55, 2.2, 10, 0x3d4a32, 0, 0, 0); b.sph(0.55, 10, 6, 0x3d4a32, 0, 1.1, 0, 1, 1.3, 1);
  b.cone(0.55, 0.9, 10, 0x3d4a32, 0, -1.55, 0, Math.PI, 0, 0);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; b.box(0.04, 0.7, 0.6, 0x2c3624, Math.cos(a) * 0.55, -1.4, Math.sin(a) * 0.55, 0, -a, 0); }
  b.box(1.12, 0.25, 1.12, 0xf2d33a, 0, 0.3, 0);
  return b.geo();
};

M.ufo = () => {
  const b = new MB();
  b.sph(3.2, 16, 6, 0xb8c2cc, 0, 0, 0, 1, 0.22, 1);
  b.cyl(3.0, 3.3, 0.25, 16, 0x7d8894, 0, -0.1, 0);
  b.sph(1.4, 12, 6, 0x7ef0c0, 0, 0.55, 0, 1, 0.75, 1);
  b.cyl(1.0, 1.3, 0.3, 12, 0x59636d, 0, -0.6, 0);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.ico(0.18, 0, i % 2 ? 0xffe14a : 0xff4a8a, Math.cos(a) * 2.9, -0.05, Math.sin(a) * 2.9); }
  return b.geo();
};
M.alien = () => { const b = new MB(); b.ico(0.4, 1, 0x8ee05a, 0, 0, 0, 1, 1.2, 1); b.ico(0.12, 0, 0x111111, -0.15, 0.05, 0.3, 1.3, 0.8, 0.6); b.ico(0.12, 0, 0x111111, 0.15, 0.05, 0.3, 1.3, 0.8, 0.6); return b.geo(); };

M.heli = () => {
  const g = new THREE.Group();
  const b = new MB();
  b.sph(1.6, 10, 8, COL.army, 0, 1.8, 0, 1, 0.9, 1.6);
  b.sph(1.0, 10, 6, 0x88b8d0, 0, 2.1, 1.6, 1.1, 0.8, 0.8);
  b.box(0.5, 0.5, 4.2, COL.army, 0, 2.2, -4);
  b.box(0.15, 1.4, 0.8, COL.army, 0, 2.8, -6.0);
  b.box(0.15, 0.15, 3.8, 0x333333, -1.0, 0.25, 0); b.box(0.15, 0.15, 3.8, 0x333333, 1.0, 0.25, 0);
  b.box(0.1, 0.9, 0.1, 0x333333, -1.0, 0.7, 1); b.box(0.1, 0.9, 0.1, 0x333333, 1.0, 0.7, 1);
  b.box(0.1, 0.9, 0.1, 0x333333, -1.0, 0.7, -1); b.box(0.1, 0.9, 0.1, 0x333333, 1.0, 0.7, -1);
  b.cyl(0.15, 0.15, 0.6, 6, 0x333333, 0, 3.4, 0);
  b.box(0.6, 0.05, 0.8, 0xffffff, 1.55, 2.0, 0.2, 0, 0, Math.PI / 2 - 0.1); b.box(0.02, 0.5, 0.5, 0xffffff, 1.58, 2.0, 0.2);
  const body = new THREE.Mesh(b.geo(), M.mat); body.castShadow = true; g.add(body);
  const r = new MB(); r.box(11, 0.06, 0.4, 0x222222, 0, 0, 0); r.box(0.4, 0.06, 11, 0x222222, 0, 0, 0);
  const rotor = new THREE.Mesh(r.geo(), M.mat); rotor.position.y = 3.7; g.add(rotor);
  const t = new MB(); t.box(0.05, 2.0, 0.25, 0x222222, 0, 0, 0);
  const tail = new THREE.Mesh(t.geo(), M.mat); tail.position.set(0.15, 2.9, -6.1); g.add(tail);
  g.userData.rotor = rotor; g.userData.tail = tail;
  return g;
};

M.mole = () => { const b = new MB(); b.ico(0.9, 1, 0x4a3b33, 0, 0.5, 0, 1, 0.9, 1.2, 0.1); b.ico(0.2, 0, 0xf29bb0, 0, 0.7, 1.05); b.ico(0.07, 0, 0x111111, -0.3, 0.95, 0.85); b.ico(0.07, 0, 0x111111, 0.3, 0.95, 0.85); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cone(0.06, 0.3, 4, 0xe8e0c8, s * (0.75 + i * 0.07), 0.35, 0.9 + i * 0.05, Math.PI / 2, 0, 0); return b.geo(); };

M.giantPumpkin = () => {
  const b = new MB(); const r = 3.6;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.sph(r * 0.6, 8, 6, i % 2 ? 0xf07a1a : 0xe06a12, Math.cos(a) * r * 0.42, 0, Math.sin(a) * r * 0.42, 0.75, 1, 0.75, 0, -a, 0); }
  b.cyl(0.35, 0.5, 1.2, 6, 0x5b7a2a, 0, r * 0.95, 0);
  // carved angry face
  b.box(0.9, 0.7, 0.3, 0x2a1205, -1.1, 0.8, r * 0.88, 0, 0, 0.3); b.box(0.9, 0.7, 0.3, 0x2a1205, 1.1, 0.8, r * 0.88, 0, 0, -0.3);
  b.box(2.6, 0.6, 0.3, 0x2a1205, 0, -0.9, r * 0.9);
  return b.geo();
};

M.shippingBin = () => {
  const b = new MB();
  b.box(1.8, 0.9, 1.1, COL.wood, 0, 0.45, 0);
  for (let i = 0; i < 3; i++) b.box(1.82, 0.05, 1.12, COL.woodDark, 0, 0.2 + i * 0.28, 0);
  b.box(1.9, 0.1, 1.2, COL.woodLight, 0, 0.95, -0.15, -0.35, 0, 0);
  b.box(0.5, 0.3, 0.02, 0xf3eee2, 0, 0.5, 0.56);
  return b.geo();
};

M.stall = () => {
  const b = new MB();
  b.box(4, 1.0, 1.6, COL.wood, 0, 0.5, 0);
  b.box(4.1, 0.08, 1.7, COL.woodLight, 0, 1.02, 0);
  for (const x of [-1.9, 1.9]) for (const z of [-0.7, 0.7]) b.box(0.12, 2.8, 0.12, COL.woodDark, x, 1.4, z);
  for (let i = 0; i < 6; i++) b.box(0.7, 0.06, 2.2, i % 2 ? 0xf3eee2 : 0xd63a2e, -1.75 + i * 0.7, 2.9, 0.2, 0.2, 0, 0);
  // produce crates on the counter
  const cols = [0xe23b2e, 0xf08a24, 0xf4d03f, 0x8fd14f];
  for (let i = 0; i < 4; i++) { b.box(0.7, 0.25, 0.5, COL.woodLight, -1.4 + i * 0.93, 1.17, 0.3); for (let k = 0; k < 4; k++) b.ico(0.09, 0, cols[i], -1.6 + i * 0.93 + (k % 2) * 0.3, 1.33, 0.2 + (k >> 1) * 0.2); }
  b.box(1.6, 0.5, 0.06, 0xf3eee2, 0, 3.4, 0.9);
  return b.geo();
};
M.merchant = () => {
  const b = new MB();
  b.box(0.6, 0.7, 0.35, 0x2e7d5b, 0, 1.25, 0); b.box(0.62, 0.45, 0.37, 0xf3eee2, 0, 1.2, 0.01);
  b.box(0.38, 0.38, 0.36, COL.skin, 0, 1.82, 0);
  b.box(0.3, 0.07, 0.04, 0x4a2a14, 0, 1.73, 0.19);  // mustache
  b.box(0.05, 0.05, 0.02, 0x222222, -0.08, 1.88, 0.185); b.box(0.05, 0.05, 0.02, 0x222222, 0.08, 1.88, 0.185);
  b.cyl(0.24, 0.24, 0.22, 8, 0x2a2a2a, 0, 2.1, 0); b.cyl(0.36, 0.36, 0.04, 10, 0x2a2a2a, 0, 2.0, 0);
  b.box(0.18, 0.65, 0.18, 0x2e7d5b, -0.4, 1.3, 0.05, 0, 0, 0.15); b.box(0.18, 0.65, 0.18, 0x2e7d5b, 0.4, 1.3, 0.05, 0, 0, -0.15);
  b.box(0.22, 0.9, 0.22, 0x3a3a4a, -0.14, 0.45, 0); b.box(0.22, 0.9, 0.22, 0x3a3a4a, 0.14, 0.45, 0);
  return b.geo();
};
M.bed = () => {
  const b = new MB();
  b.box(1.4, 0.35, 2.1, COL.woodDark, 0, 0.25, 0); b.box(1.3, 0.2, 2.0, 0xf3eee2, 0, 0.5, 0);
  b.box(1.32, 0.12, 1.4, 0xc2453a, 0, 0.62, -0.3); for (let i = 0; i < 3; i++) b.box(1.33, 0.13, 0.12, 0xf3eee2, 0, 0.62, -0.8 + i * 0.4);
  b.box(0.9, 0.15, 0.4, 0xffffff, 0, 0.66, 0.75); b.box(1.4, 0.9, 0.1, COL.woodDark, 0, 0.6, 1.05);
  return b.geo();
};
M.hatch = () => { const b = new MB(); b.cyl(0.9, 1.0, 0.3, 10, 0x6b7076, 0, 0.15, 0); b.cyl(0.75, 0.75, 0.08, 10, 0x50555c, 0, 0.33, 0); b.tor(0.3, 0.05, 4, 10, 0xd8c040, 0, 0.4, 0, Math.PI / 2, 0, 0); b.box(0.06, 0.06, 0.7, 0xd8c040, 0, 0.4, 0); b.box(0.7, 0.06, 0.06, 0xd8c040, 0, 0.4, 0); return b.geo(); };
M.turret = () => { const b = new MB(); b.cyl(0.6, 0.8, 0.6, 8, COL.darkMetal, 0, 0.3, 0); b.box(0.2, 1.8, 0.2, COL.metal, 0, 1.5, 0); b.sph(0.5, 8, 6, 0x5b6470, 0, 2.5, 0); b.cyl(0.08, 0.12, 1.4, 6, 0x333333, 0, 2.6, 0.7, Math.PI / 2, 0, 0); b.ico(0.12, 0, 0xff3030, 0, 2.6, 1.42); return b.geo(); };
M.rod = () => { const b = new MB(); b.cyl(0.05, 0.08, 7, 5, COL.metal, 0, 3.5, 0); b.cone(0.1, 0.5, 5, 0xd8a040, 0, 7.2, 0); b.tor(0.18, 0.03, 4, 8, 0xd8a040, 0, 6.5, 0, Math.PI / 2, 0, 0); return b.geo(); };
M.scarecrow = () => {
  const b = new MB(); b.box(0.1, 2.2, 0.1, COL.woodDark, 0, 1.1, 0); b.box(1.7, 0.1, 0.1, COL.woodDark, 0, 1.65, 0);
  b.box(0.6, 0.7, 0.3, 0x8a3a2a, 0, 1.45, 0); b.box(1.5, 0.22, 0.24, 0x8a3a2a, 0, 1.65, 0);
  b.ico(0.26, 0, 0xd9b46a, 0, 2.05, 0); b.cyl(0.42, 0.42, 0.04, 9, 0xe6c56a, 0, 2.27, 0); b.cone(0.22, 0.35, 8, 0xe6c56a, 0, 2.43, 0);
  b.box(0.06, 0.06, 0.02, 0x111111, -0.09, 2.08, 0.25); b.box(0.06, 0.06, 0.02, 0x111111, 0.09, 2.08, 0.25);
  for (const s of [-1, 1]) b.cone(0.08, 0.3, 4, 0xe2c25a, s * 0.85, 1.6, 0, 0, 0, s * Math.PI / 2);
  return b.geo();
};
M.fence = (len) => {
  const b = new MB(), n = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i <= n; i++) b.box(0.14, 1.1, 0.14, COL.woodLight, -len / 2 + i * len / n, 0.55, 0);
  b.box(len, 0.1, 0.06, COL.woodLight, 0, 0.8, 0); b.box(len, 0.1, 0.06, COL.woodLight, 0, 0.45, 0);
  return b.geo();
};
M.sign = (text, w = 2.4) => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const x = cv.getContext('2d');
  x.fillStyle = '#e9d7a8'; x.fillRect(0, 0, 256, 96); x.strokeStyle = '#6b4523'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 88);
  x.fillStyle = '#4a2a14'; x.font = 'bold 34px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const lines = text.split('\n'); lines.forEach((l, i) => x.fillText(l, 128, 48 + (i - (lines.length - 1) / 2) * 34));
  const g = new THREE.Group();
  const bm = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), bm);
  board.position.set(0, 1.3, 0.01); g.add(board);
  const back = new THREE.Mesh(board.geometry, bm); back.position.set(0, 1.3, -0.01); back.rotation.y = Math.PI; g.add(back);
  const p = new MB(); p.box(0.1, 1.3, 0.1, COL.woodDark, -w * 0.4, 0.65, -0.03); p.box(0.1, 1.3, 0.1, COL.woodDark, w * 0.4, 0.65, -0.03);
  g.add(new THREE.Mesh(p.geo(), M.mat));
  return g;
};
M.nameTag = (text, color) => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const x = cv.getContext('2d');
  x.font = 'bold 30px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.45)'; const w = Math.min(250, x.measureText(text).width + 24); x.fillRect(128 - w / 2, 10, w, 44);
  x.fillStyle = '#' + new THREE.Color(color).getHexString(); x.fillText(text, 128, 33);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  s.scale.set(2, 0.5, 1); s.renderOrder = 10;
  return s;
};

// ---------------- first-person tools ----------------
M.tool = function (kind) {
  const b = new MB();
  if (kind === 'hand') { b.box(0.11, 0.11, 0.24, 0xc8834a, 0, 0, 0); b.box(0.12, 0.12, 0.1, 0x9a6438, 0, 0, -0.14); b.box(0.035, 0.05, 0.1, 0xc8834a, -0.06, 0.02, 0.1, 0, 0.5, 0); }
  else if (kind === 'hoe') { b.box(0.035, 0.035, 1.1, COL.woodLight, 0, 0, 0); b.box(0.22, 0.03, 0.12, COL.metal, 0, -0.06, 0.55, 0.5, 0, 0); b.box(0.06, 0.08, 0.06, COL.darkMetal, 0, -0.02, 0.52); }
  else if (kind === 'scythe') { b.box(0.035, 0.035, 1.2, COL.woodLight, 0, 0, 0); b.box(0.6, 0.02, 0.1, COL.metal, 0.28, -0.03, 0.6, 0, 0.35, 0); b.box(0.12, 0.03, 0.03, COL.woodDark, 0.06, 0, 0.1); }
  else if (kind === 'seeds') { b.ico(0.13, 0, 0xc9a46a, 0, 0, 0, 1, 1.15, 0.9, 0.03); b.cyl(0.05, 0.08, 0.08, 6, 0xb0884f, 0, 0.15, 0); b.box(0.12, 0.12, 0.01, 0x5a9c38, 0, 0, 0.115); }
  else if (kind === 'wide') { b.box(0.035, 0.035, 1.1, COL.woodLight, 0, 0, 0); b.box(0.5, 0.03, 0.12, COL.metal, 0, -0.06, 0.55, 0.5, 0, 0); for (let i = 0; i < 5; i++) b.box(0.03, 0.03, 0.1, COL.metal, -0.2 + i * 0.1, -0.1, 0.62); }
  const m = new THREE.Mesh(b.geo(), M.mat); return m;
};
