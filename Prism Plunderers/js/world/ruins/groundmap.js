// The ground of The Ruins. Since 5c it is drawn in three layers, so the roads stay sharp right under your feet:
//  1. The streets, the sidewalks with their kerbs, the plaza and the small squares are worked out exactly in the
//     ground's shader from the street plan (layout.js: XS / WX / ZS / WZ), and filled with tiling textures drawn
//     in code: asphalt with stones and hairline cracks, pavement slabs, stone paving. The road markings (centre
//     dashes, crosswalks, stop lines, parking bays) are drawn there too, worn and missing here and there. Edges
//     are box-filtered per pixel, so they are sharp close up and do not flicker far away.
//  2. A small painted base map (1024 px over 820 m) for everything else: sand, lots, courtyards, yards, alleys,
//     the floors of the buildings, with a fine noise close up.
//  3. A painted marks layer (2048 px, transparent) on top of all of it: repair patches, cracks and oil on the
//     streets, scorch, manholes, drains, tree pits, rugs, litter, sand drifting over the streets, the crater's
//     scorch.
// Painting the ground (instead of laying thin boxes on it) keeps your feet exactly on what you see. Without a
// canvas (the offline tests) the ground is plain sand.
import * as THREE from 'three';
import { rng } from '../../core/util.js';
import { XS, WX, ZS, WZ, STREET_END, WALK } from './plan.js';

export const G = 410;                                    // the painted square: -G..G on both axes
const BASE_PX = 1024, MARKS_PX = 2048;

function canvas(w, h) {
  const doc = typeof document !== 'undefined' ? document : null;
  const c = doc && doc.createElement ? doc.createElement('canvas') : null;
  if (!c || !c.getContext) return null;
  c.width = w; c.height = h;
  return c.getContext('2d') ? c : null;
}
function texOf(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------- the painted layers ----------
export function paintGround(L, seed) {
  const bc = canvas(BASE_PX, BASE_PX), mc = canvas(MARKS_PX, MARKS_PX);
  if (!bc || !mc) return null;
  const R = rng((seed ^ 0x51ed) >>> 0);
  const rr = (a, b) => a + R() * (b - a);
  const pen = (cv, px) => {
    const g = cv.getContext('2d'), k = px / (2 * G);
    const X = x => (x + G) * k, Y = z => (z + G) * k;
    return {
      g, k, X, Y,
      rect: (x0, z0, x1, z1) => g.fillRect(X(x0), Y(z0), (x1 - x0) * k, (z1 - z0) * k),
      blob: (x, z, rx, rz, rot, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(X(x), Y(z), Math.max(0.5, rx * k), Math.max(0.5, rz * k), rot, 0, Math.PI * 2); g.fill(); },
    };
  };
  const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');

  // ---- 2. the base map: what is not road, sidewalk, plaza or square ----
  const B = pen(bc, BASE_PX), b = B.g;
  b.fillStyle = '#cbb38b'; b.fillRect(0, 0, BASE_PX, BASE_PX);
  for (let i = 0; i < 900; i++) B.blob(rr(-G, G), rr(-G, G), rr(6, 60), rr(4, 40), R() * Math.PI, R() < 0.5 ? 'rgba(255,240,210,0.07)' : 'rgba(120,90,55,0.06)');
  for (const k of L.blocks) {
    b.fillStyle = '#b8aa8f'; B.rect(k.x0, k.z0, k.x1, k.z1);                       // (the sidewalk itself is drawn in the shader)
    b.fillStyle = k.kind === 'industrial' ? '#a9a194' : '#c3aa83'; B.rect(k.x0 + WALK, k.z0 + WALK, k.x1 - WALK, k.z1 - WALK);
  }
  for (const y of L.yards) {
    b.fillStyle = y.kind === 'industrial' ? '#a49d91' : y.kind === 'market' ? '#cdb58e' : '#bea37b';
    B.rect(y.x0, y.z0, y.x1, y.z1);
  }
  for (const a of L.alleys || []) { b.fillStyle = '#a99780'; B.rect(a.x0, a.z0, a.x1, a.z1); }
  for (const s of L.squares || []) { b.fillStyle = '#c4b59a'; B.rect(s.x0, s.z0, s.x1, s.z1); }
  for (const r of L.ruins) { b.fillStyle = '#a89881'; B.rect(r.x0, r.z0, r.x1, r.z1); }
  for (const v of L.vacant) { b.fillStyle = '#c8ae86'; B.rect(v.x0, v.z0, v.x1, v.z1); }
  for (const f of L.footprints) if (f.floor !== undefined) { b.fillStyle = hex(f.floor); B.rect(f.x0, f.z0, f.x1, f.z1); }
  for (const s of L.streets) { b.fillStyle = '#4f4842'; B.rect(s.x0, s.z0, s.x1, s.z1); }  // under the shader's streets
  if (L.plaza) { b.fillStyle = '#bdb19b'; B.rect(L.plaza.x0, L.plaza.z0, L.plaza.x1, L.plaza.z1); }

  // ---- 3. the marks on top (a transparent layer) ----
  const M = pen(mc, MARKS_PX), g = M.g, X = M.X, Y = M.Y, k = M.k;
  for (const y of L.yards) if (y.kind === 'industrial') {                         // cracked concrete slabs
    g.strokeStyle = 'rgba(70,64,56,0.28)'; g.lineWidth = 1; g.beginPath();
    for (let x = y.x0 + 6; x < y.x1; x += 6) { g.moveTo(X(x), Y(y.z0)); g.lineTo(X(x), Y(y.z1)); }
    for (let z = y.z0 + 6; z < y.z1; z += 6) { g.moveTo(X(y.x0), Y(z)); g.lineTo(X(y.x1), Y(z)); }
    g.stroke();
  }
  for (const a of L.alleys || []) {                                               // alleys: a gutter, dark patches
    const ns = a.z1 - a.z0 > a.x1 - a.x0;
    g.fillStyle = 'rgba(70,60,50,0.45)';
    if (ns) M.rect((a.x0 + a.x1) / 2 - 0.25, a.z0, (a.x0 + a.x1) / 2 + 0.25, a.z1); else M.rect(a.x0, (a.z0 + a.z1) / 2 - 0.25, a.x1, (a.z0 + a.z1) / 2 + 0.25);
    for (let i = 0; i < 10; i++) M.blob(rr(a.x0, a.x1), rr(a.z0, a.z1), rr(0.6, 1.8), rr(0.6, 1.8), R() * 3, 'rgba(60,50,40,0.25)');
  }
  for (const r of L.ruins) for (let i = 0; i < 6; i++) M.blob(rr(r.x0, r.x1), rr(r.z0, r.z1), rr(1, 3), rr(1, 3), R() * 3, 'rgba(90,80,68,0.35)');
  // the streets: repaired patches, oil stains, cracks
  for (const s of L.streets) {
    const len = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0;
    const along = (t, o) => s.axis === 'z' ? [s.at + o, s.z0 + t] : [s.x0 + t, s.at + o];
    for (let i = 0, n = Math.floor(len / 18); i < n; i++) {
      const [x, z] = along(rr(0, len), rr(-s.w / 2 + 1, s.w / 2 - 1)), w = rr(1.5, 5), d = rr(1.5, 4);
      g.fillStyle = R() < 0.5 ? 'rgba(98,90,82,0.5)' : 'rgba(40,36,33,0.5)';
      g.fillRect(X(x - w / 2), Y(z - d / 2), w * k, d * k);
      g.strokeStyle = 'rgba(25,22,20,0.35)'; g.lineWidth = 1; g.strokeRect(X(x - w / 2), Y(z - d / 2), w * k, d * k);
    }
    for (let i = 0, n = Math.floor(len / 30); i < n; i++) { const [x, z] = along(rr(0, len), rr(-s.w / 2, s.w / 2)); M.blob(x, z, rr(0.6, 2), rr(0.5, 1.5), R() * 3, 'rgba(18,16,15,0.35)'); }
    g.strokeStyle = 'rgba(24,21,19,0.6)'; g.lineWidth = 1.2;
    for (let i = 0, n = Math.floor(len / 12); i < n; i++) {
      let [x, z] = along(rr(0, len), rr(-s.w / 2, s.w / 2));
      g.beginPath(); g.moveTo(X(x), Y(z));
      for (let q = 0, m = 2 + Math.floor(R() * 4); q < m; q++) { x += rr(-2.2, 2.2); z += rr(-2.2, 2.2); g.lineTo(X(x), Y(z)); }
      g.stroke();
    }
  }
  // marks things left: scorch under burnt wrecks and fires, oil, manholes, drains, tree pits, rugs in the bazaars
  for (const d of L.decals || []) {
    if (d.kind === 'scorch') {
      const grd = g.createRadialGradient(X(d.x), Y(d.z), 0, X(d.x), Y(d.z), d.r * k);
      grd.addColorStop(0, 'rgba(20,16,14,0.85)'); grd.addColorStop(0.6, 'rgba(35,28,24,0.5)'); grd.addColorStop(1, 'rgba(35,28,24,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(X(d.x), Y(d.z), d.r * k, 0, Math.PI * 2); g.fill();
    } else if (d.kind === 'oil') M.blob(d.x, d.z, d.r, d.r * 0.7, R() * 3, 'rgba(18,16,15,0.45)');
    else if (d.kind === 'manhole') {
      g.fillStyle = 'rgba(40,38,36,0.95)'; g.beginPath(); g.arc(X(d.x), Y(d.z), 0.45 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(120,112,100,0.7)'; g.lineWidth = 1; g.stroke();
    } else if (d.kind === 'drain') {
      g.fillStyle = 'rgba(25,23,21,0.9)';
      if (d.ax === 'z') M.rect(d.x - 0.18, d.z - 0.45, d.x + 0.18, d.z + 0.45); else M.rect(d.x - 0.45, d.z - 0.18, d.x + 0.45, d.z + 0.18);
    } else if (d.kind === 'pit') { g.fillStyle = 'rgba(92,76,58,0.9)'; M.rect(d.x - 0.65, d.z - 0.65, d.x + 0.65, d.z + 0.65); }
    else if (d.kind === 'rug') {
      const c = Math.cos(d.a), s = Math.sin(d.a), pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [d.x + u * d.w / 2 * c - v * d.d / 2 * s, d.z + u * d.w / 2 * s + v * d.d / 2 * c]);
      g.fillStyle = `rgba(${d.c >> 16 & 255},${d.c >> 8 & 255},${d.c & 255},0.85)`;
      g.beginPath(); pts.forEach(([px, pz], i) => i ? g.lineTo(X(px), Y(pz)) : g.moveTo(X(px), Y(pz))); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,40,30,0.6)'; g.lineWidth = 1; g.stroke();
    }
  }
  // litter: little light specks over the streets and pavements of the city
  for (let i = 0; i < 6000; i++) {
    const x = rr(-380, 380), z = rr(-380, 380);
    g.fillStyle = R() < 0.5 ? 'rgba(235,228,210,0.7)' : 'rgba(150,140,120,0.6)';
    g.fillRect(X(x), Y(z), 1, 1);
  }
  // the plaza: darker round the foot of the tower
  const T = L.tower;
  if (L.plaza && T) { g.fillStyle = 'rgba(70,62,52,0.3)'; M.rect(T.x0 - 6, T.z0 - 6, T.x1 + 6, T.z1 + 6); }
  // the crater: scorched in the middle, ash and cracks out past the rim
  const C = L.crater;
  if (C) {
    const grd = g.createRadialGradient(X(C.x), Y(C.z), 0, X(C.x), Y(C.z), (C.r + 16) * k);
    grd.addColorStop(0, 'rgba(38,30,26,0.95)'); grd.addColorStop(0.45, 'rgba(70,56,44,0.92)'); grd.addColorStop(0.78, 'rgba(125,106,87,0.8)'); grd.addColorStop(1, 'rgba(125,106,87,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(X(C.x), Y(C.z), (C.r + 16) * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,16,14,0.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 90; i++) {
      const a = R() * Math.PI * 2;
      let r = rr(4, C.r * 0.7), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      g.beginPath(); g.moveTo(X(x), Y(z));
      for (let q = 0; q < 4; q++) { r += rr(3, 9); const bb = a + rr(-0.25, 0.25); x = C.x + Math.cos(bb) * r; z = C.z + Math.sin(bb) * r; g.lineTo(X(x), Y(z)); }
      g.stroke();
    }
    for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, r = rr(0, C.r * 0.5); M.blob(C.x + Math.cos(a) * r, C.z + Math.sin(a) * r, rr(1, 4), rr(1, 3), a, 'rgba(150,100,220,0.12)'); }
  }
  // drifts of sand over the streets and sidewalks, thicker towards the edge of the city
  for (let i = 0; i < 1400; i++) {
    const s = L.streets[Math.floor(R() * L.streets.length)];
    const len = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0, t = rr(0, len), side = R() < 0.5 ? -1 : 1;
    const o = side * (s.w / 2 - rr(0, s.w * 0.45));
    const [x, z] = s.axis === 'z' ? [s.at + o, s.z0 + t] : [s.x0 + t, s.at + o];
    const edge = Math.max(Math.abs(x), Math.abs(z)) / 400, a = 0.25 + 0.45 * edge * R();
    const lx = rr(2, 9) * (0.6 + edge), lw = rr(0.6, 2.2) * (0.6 + edge);
    M.blob(x, z, s.axis === 'z' ? lw : lx, s.axis === 'z' ? lx : lw, rr(-0.2, 0.2), `rgba(205,182,140,${a.toFixed(2)})`);
  }
  for (let i = 0; i < 260; i++) {                                                  // the street ends fade into the sand
    const s = L.streets[Math.floor(R() * L.streets.length)], end = R() < 0.5 ? 0 : 1;
    if (s.axis === 'z' && Math.abs(end ? s.z1 : s.z0) < 380) continue;
    if (s.axis === 'x' && Math.abs(end ? s.x1 : s.x0) < 380) continue;
    const t = rr(0, 16), o = rr(-s.w / 2, s.w / 2);
    const [x, z] = s.axis === 'z' ? [s.at + o, end ? s.z1 - t : s.z0 + t] : [end ? s.x1 - t : s.x0 + t, s.at + o];
    M.blob(x, z, rr(2, 6), rr(2, 6), R() * 3, 'rgba(203,179,139,0.8)');
  }
  return { base: texOf(bc, false), marks: texOf(mc, false) };
}

// ---------- the tiling textures (512 px, drawn once) ----------
const TILE = 512;
// one small helper set for drawing something that wraps round the edges of a tile
function tilePen(R) {
  const c = canvas(TILE, TILE);
  if (!c) return null;
  const g = c.getContext('2d');
  const wrap = fn => { for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  // per-pixel grain: n = +-noise, stones = chance of a light speck, pits = chance of a dark one
  const grain = (n, stones = 0, pits = 0, warm = 0) => {
    const img = g.getImageData(0, 0, TILE, TILE), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let v = (R() - 0.5) * n;
      const r = R();
      if (r < stones) v += 30 + R() * 45; else if (r < stones + pits) v -= 22 + R() * 20;
      d[i] = Math.max(0, Math.min(255, d[i] + v + warm)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v - warm));
    }
    g.putImageData(img, 0, 0);
  };
  const crack = (x, y, steps, len, style, w = 1) => {
    const pts = [[x, y]];
    let a = R() * Math.PI * 2;
    for (let s = 0; s < steps; s++) { a += (R() - 0.5) * 1.2; x += Math.cos(a) * len * (0.5 + R()); y += Math.sin(a) * len * (0.5 + R()); pts.push([x, y]); }
    wrap(() => { g.strokeStyle = style; g.lineWidth = w; g.beginPath(); pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.stroke(); });
  };
  return { c, g, wrap, grain, crack };
}
// asphalt: 6 m a tile (85 px a metre): worn grey-brown tar, light stones and dark pits, soft blotches, hairline cracks
function asphaltTile(R) {
  const P = tilePen(R);
  if (!P) return null;
  const { g } = P;
  g.fillStyle = '#4d4743'; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 70; i++) {
    const x = R() * TILE, y = R() * TILE, rx = 18 + R() * 90, ry = 12 + R() * 60, rot = R() * 3, fill = R() < 0.5 ? 'rgba(120,110,100,0.08)' : 'rgba(18,16,14,0.09)';
    P.wrap(() => { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); });
  }
  P.grain(16, 0.045, 0.05, 2);
  for (let i = 0; i < 260; i++) {                                                  // bigger stones, 2-3 px
    const x = Math.floor(R() * TILE), y = Math.floor(R() * TILE), s = 2 + Math.floor(R() * 2), l = 120 + Math.floor(R() * 60);
    P.wrap(() => { g.fillStyle = `rgba(${l},${l - 8},${l - 18},0.7)`; g.fillRect(x, y, s, s); });
  }
  for (let i = 0; i < 9; i++) P.crack(R() * TILE, R() * TILE, 4 + Math.floor(R() * 5), 18, 'rgba(20,17,15,0.6)', 1);
  return texOf(P.c, true);
}
// pavement slabs: 3 m a tile, 5 x 5 slabs of 0.6 m with dark joints; some slabs lighter, darker, cracked or chipped
function slabTile(R) {
  const P = tilePen(R);
  if (!P) return null;
  const { g } = P, n = 5, s = TILE / n;
  g.fillStyle = '#5e564b'; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 0.9 + R() * 0.16, w = (R() - 0.5) * 10;
    g.fillStyle = `rgb(${Math.round(186 * v + w)},${Math.round(172 * v)},${Math.round(146 * v - w)})`;
    g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
    const grd = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s);         // a little wear across each slab
    grd.addColorStop(0, 'rgba(255,245,225,0.06)'); grd.addColorStop(1, 'rgba(40,30,20,0.07)');
    g.fillStyle = grd; g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
    if (R() < 0.12) {                                                              // a chipped corner
      const cx = i * s + (R() < 0.5 ? 1.5 : s - 1.5), cy = j * s + (R() < 0.5 ? 1.5 : s - 1.5), d = 8 + R() * 14;
      g.fillStyle = 'rgba(80,70,58,0.75)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (cx > i * s + s / 2 ? -d : d), cy); g.lineTo(cx, cy + (cy > j * s + s / 2 ? -d : d)); g.closePath(); g.fill();
    }
  }
  P.grain(12, 0.02, 0.02, 1);
  for (let i = 0; i < 6; i++) P.crack(R() * TILE, R() * TILE, 3 + Math.floor(R() * 3), 14, 'rgba(70,60,48,0.7)', 1);
  return texOf(P.c, true);
}
// stone paving: 4 x 4 big slabs a tile (the plaza at 3 m a slab, the squares at 1.5 m)
function stoneTile(R) {
  const P = tilePen(R);
  if (!P) return null;
  const { g } = P, n = 4, s = TILE / n;
  g.fillStyle = '#6c6355'; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 0.86 + R() * 0.2, w = (R() - 0.5) * 14;
    g.fillStyle = `rgb(${Math.round(190 * v + w)},${Math.round(178 * v)},${Math.round(156 * v - w)})`;
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    for (let q = 0; q < 3; q++) {                                                   // stains on the stone
      g.fillStyle = R() < 0.5 ? 'rgba(90,80,64,0.1)' : 'rgba(250,240,220,0.08)';
      g.beginPath(); g.ellipse(i * s + 10 + R() * (s - 20), j * s + 10 + R() * (s - 20), 6 + R() * 20, 4 + R() * 14, R() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  P.grain(10, 0.015, 0.015, 1);
  for (let i = 0; i < 5; i++) P.crack(R() * TILE, R() * TILE, 3 + Math.floor(R() * 4), 20, 'rgba(80,70,56,0.65)', 1);
  return texOf(P.c, true);
}

// ---------- the ground's material ----------
// map = the base map; the shader adds the exact streets, sidewalks, kerbs, plaza and squares with their tiling
// textures and markings, then the marks layer on top. Works on any mesh with UVs made from positions (the flat
// ground and the crater's bowl share it).
export function groundMaterial(paint, seed, L) {
  const mat = new THREE.MeshStandardMaterial({ map: paint.base, roughness: 1, metalness: 0 });
  const R = rng((seed ^ 0x2c1b) >>> 0);
  const dc = canvas(256, 256);
  if (!dc) return mat;
  // a soft noise for grain close up (and for breaking up the repeats of the tiles)
  const dg = dc.getContext('2d'), img = dg.createImageData(256, 256), v = new Float32Array(256 * 256);
  for (let i = 0; i < v.length; i++) v[i] = R();
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = y * 256 + x;
    v[i] = (v[i] * 2 + v[y * 256 + ((x + 1) & 255)] + v[((y + 1) & 255) * 256 + x] + v[y * 256 + ((x + 255) & 255)]) / 5;
  }
  for (let i = 0; i < v.length; i++) { const c = Math.floor(v[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255; }
  dg.putImageData(img, 0, 0);
  const detail = new THREE.CanvasTexture(dc);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  const asph = asphaltTile(R), slab = slabTile(R), stone = stoneTile(R);
  mat.userData.detail = detail;
  mat.userData.textures = [paint.marks, asph, slab, stone];
  const col = h => new THREE.Color(h);                                              // sRGB hex -> the linear working colour
  const P = L.plaza || { x0: 0, z0: 0, x1: 0, z1: 0 }, C = L.crater || { x: 1e5, z: 1e5, r: 0 }, F = L.fountain || { x: 0, z: 0, r: 0 };
  const squares = (L.squares || []).slice(0, 16).map(s => new THREE.Vector4(s.x0, s.z0, s.x1, s.z1));
  while (squares.length < 16) squares.push(new THREE.Vector4(0, 0, 0, 0));
  const inner = XS[XS.length - 1] - WX[WX.length - 1] / 2;                       // the blocks end at the ring streets' inner edges
  const uniforms = {
    uDetail: { value: detail }, uMarks: { value: paint.marks }, uAsph: { value: asph }, uSlab: { value: slab }, uStone: { value: stone },
    uG: { value: G }, uEnd: { value: STREET_END }, uIn: { value: inner }, uWalk: { value: WALK },
    uXS: { value: XS.slice() }, uWX: { value: WX.slice() }, uZS: { value: ZS.slice() }, uWZ: { value: WZ.slice() },
    uPlaza: { value: new THREE.Vector4(P.x0, P.z0, P.x1, P.z1) }, uSq: { value: squares }, uSqN: { value: Math.min(16, (L.squares || []).length) },
    uCrater: { value: new THREE.Vector3(C.x, C.z, C.r + 4) }, uFountain: { value: new THREE.Vector3(F.x, F.z, F.r) },
    uPaint: { value: col(0xd8cba4) }, uKerb: { value: col(0xcabda4) }, uPlazaTint: { value: col(0xffffff) }, uSquareTint: { value: col(0xf2ead8) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\n' + GROUND_PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + GROUND_MAIN);
  };
  mat.customProgramCacheKey = () => 'ruins-ground-5c';
  mat.extensions = { derivatives: true };                                          // fwidth() on WebGL1 (WebGL2 has it built in)
  return mat;
}

// the shader: what is under a pixel of ground, worked out from its place in the world
const GROUND_PARS = /* glsl */`
uniform sampler2D uDetail, uMarks, uAsph, uSlab, uStone;
uniform float uG, uEnd, uIn, uWalk;
uniform float uXS[11], uWX[11], uZS[11], uWZ[11];
uniform vec4 uPlaza, uSq[16];
uniform int uSqN;
uniform vec3 uCrater, uFountain, uPaint, uKerb, uPlazaTint, uSquareTint;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// how many metres one pixel covers here: worked out once per pixel, outside any branch (derivatives inside
// branches are undefined)
float gPF = 0.01;
// how much of this pixel lies within w of d = 0 (box-filtered: sharp close up, no flicker far away)
float gBandF(float d, float w, float f) { f = max(f, 1e-4); return clamp((min(d + 0.5 * f, w) - max(d - 0.5 * f, -w)) / f, 0.0, 1.0); }
float gBand(float d, float w) { return gBandF(d, w, gPF); }
// how much of this pixel is inside (sd < 0)
float gIn(float sd) { return clamp(0.5 - sd / gPF, 0.0, 1.0); }
// the markings of one street: across = from its centre line, along = along it, hw = half its width, gap = how far
// (along) from the edge of the nearest crossing, cxz = that crossing's centre, sid = which street, t0 = along from the
// crossing's centre, fa / fc = a pixel's size along / across
float gMarks(float across, float along, float hw, float gap, vec2 cxz, float sid, float t0, float fa, float fc) {
  float m = 0.0;
  float reach = max(abs(cxz.x), abs(cxz.y));
  if (hw >= 5.5 && gap > 3.0) {                                    // faded dashes down the middle
    float cell = floor((along + 1000.0) / 9.0), f = fract((along + 1000.0) / 9.0) * 9.0;
    float on = gBandF(f - 1.5, 1.5, fa) * gBandF(across, 0.08, fc) * step(0.3, gHash(vec2(cell, sid)));
    m = max(m, on * (0.55 + 0.4 * gHash(vec2(cell, sid + 3.7))));
  }
  if (reach <= 240.0 && gHash(cxz * 0.0137) > 0.25) {              // a crosswalk and a stop line at the busier crossings
    if (gap > 0.5 && gap < 3.5 && abs(across) < hw - 0.6) {
      float u = (across + hw - 0.6) / 1.6, s = floor(u);
      m = max(m, gBandF(fract(u) * 1.6 - 0.4, 0.4, fc) * step(0.2, gHash(vec2(s, cxz.x + cxz.y + sign(t0)))) * 0.85);
    }
    if (gap > 3.9 && gap < 4.3) { float a = -sign(t0) * across; if (a > 0.2 && a < hw - 0.4) m = max(m, 0.8); }
  }
  if (hw >= 6.0 && reach <= 240.0 && gap > 3.0) {                  // parking bays along the kerbs downtown
    float a = abs(across);
    if (a > hw - 2.3 && a < hw - 0.15) m = max(m, gBandF(fract((along + 391.0) / 5.5) * 5.5 - 0.07, 0.07, fa) * 0.55);
  }
  return m;
}
vec3 groundColor(vec3 base, vec2 wp) {
  vec2 fw = fwidth(wp);
  gPF = max(length(fw), 1e-4);
  vec3 stP = texture2D(uStone, wp / 12.0).rgb, stS = texture2D(uStone, wp / 6.0).rgb;   // sampled outside the branches
  // the nearest north-south street (x = XS[i]) and east-west street (z = ZS[j]); distances < 0 are on them
  float dz = 1e5, dx = 1e5, xs = 0.0, wx = 0.0, zs = 0.0, wz = 0.0;
  for (int i = 0; i < 11; i++) {
    float d = abs(wp.x - uXS[i]) - 0.5 * uWX[i];
    if (i == 5 && abs(wp.y) < uPlaza.w) d = 1e5;                   // the avenues stop at the plaza
    if (d < dz) { dz = d; xs = uXS[i]; wx = uWX[i]; }
    float e = abs(wp.y - uZS[i]) - 0.5 * uWZ[i];
    if (i == 5 && abs(wp.x) < uPlaza.z) e = 1e5;
    if (e < dx) { dx = e; zs = uZS[i]; wz = uWZ[i]; }
  }
  dz = max(dz, abs(wp.y) - uEnd); dx = max(dx, abs(wp.x) - uEnd);
  float dRoad = min(dz, dx);
  float keep = smoothstep(uCrater.z, uCrater.z + 8.0, length(wp - uCrater.xy));   // the crater took the streets with it
  float road = gIn(dRoad) * keep;
  bool city = max(abs(wp.x), abs(wp.y)) < uIn;
  bool plaza = wp.x > uPlaza.x && wp.x < uPlaza.z && wp.y > uPlaza.y && wp.y < uPlaza.w;
  float walk = (city && !plaza) ? gIn(dRoad - uWalk) * (1.0 - gIn(dRoad)) * keep : 0.0;
  // what is not street: the base map, with grain close up
  float dn = texture2D(uDetail, wp * 0.17).r * 0.6 + texture2D(uDetail, wp * 0.035).r * 0.4;
  vec3 col = base * (0.8 + 0.4 * dn);
  // sidewalk slabs, and the kerb stones along the street
  vec3 slab = texture2D(uSlab, wp / 3.0).rgb;
  vec3 kerb = uKerb * (0.82 + 0.3 * texture2D(uDetail, wp * 0.9).r);
  col = mix(col, mix(slab, kerb, gIn(dRoad - 0.3)), walk);
  // asphalt (a second, slower noise breaks up the tiles' repeats), darker in the gutter along the kerb
  vec3 asph = texture2D(uAsph, wp / 6.0).rgb * (0.84 + 0.32 * texture2D(uDetail, wp / 37.0).r);
  asph *= 1.0 - 0.22 * gBand(dRoad + 0.2, 0.2);
  col = mix(col, asph, road);
  // markings: on a north-south street (and not in a crossing), or on an east-west one
  float paint = 0.0;
  if (dz < 0.0 && dx >= 0.0) paint = gMarks(wp.x - xs, wp.y, 0.5 * wx, dx, vec2(xs, zs), xs, wp.y - zs, fw.y, fw.x);
  else if (dx < 0.0 && dz >= 0.0) paint = gMarks(wp.y - zs, wp.x, 0.5 * wz, dz, vec2(xs, zs), zs, wp.x - xs, fw.x, fw.y);
  col = mix(col, uPaint, paint * road * 0.62);
  // the small squares: stone paving, a ring round the monument
  for (int k = 0; k < 16; k++) {
    if (k >= uSqN) break;
    vec4 s = uSq[k];
    if (wp.x > s.x && wp.x < s.z && wp.y > s.y && wp.y < s.w) {
      vec3 st = stS * uSquareTint;
      st *= 1.0 - 0.3 * gBand(length(wp - 0.5 * (s.xy + s.zw)) - 6.0, 0.15);
      col = st;
    }
  }
  // the plaza: big stone slabs, a darker border, a ring round the fountain
  if (plaza) {
    vec3 st = stP * uPlazaTint;
    float e = min(min(wp.x - uPlaza.x, uPlaza.z - wp.x), min(wp.y - uPlaza.y, uPlaza.w - wp.y));
    st *= 1.0 - 0.3 * gBand(e - 0.6, 0.25);
    if (uFountain.z > 0.0) st *= 1.0 - 0.3 * gBand(length(wp - uFountain.xy) - uFountain.z, 0.18);
    col = st;
  }
  // the marks on top (patches, oil, scorch, drifts of sand ...)
  vec4 mk = texture2D(uMarks, vec2((wp.x + uG) / (2.0 * uG), (uG - wp.y) / (2.0 * uG)));
  return mix(col, mk.rgb, mk.a);
}
`;
const GROUND_MAIN = /* glsl */`
	{ vec2 gwp = vec2(vMapUv.x * 2.0 * uG - uG, uG - vMapUv.y * 2.0 * uG);
	  diffuseColor.rgb = groundColor(diffuseColor.rgb, gwp); }
`;
