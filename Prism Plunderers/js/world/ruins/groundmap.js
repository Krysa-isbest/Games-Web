// The ground of The Ruins, painted once on a canvas: sand, the streets (asphalt, patches, cracks, faded lane marks,
// crosswalks), the sidewalks round every block, the dusty lots, building floors, courtyards and yards, the plaza's
// paving, the crater's scorch, and drifts of sand over all of it. Painting the ground (instead of laying thin boxes
// on it) keeps your feet exactly on what you see. A small noise texture adds grain close up (detailMaterial).
// Skipped where there is no canvas (the offline tests): the ground is plain sand there.
import * as THREE from 'three';
import { rng } from '../../core/util.js';

export const G = 410;                                    // the painted square: -G..G on both axes
const PX = 2048;

function canvas(w, h) {
  const doc = typeof document !== 'undefined' ? document : null;
  const c = doc && doc.createElement ? doc.createElement('canvas') : null;
  if (!c || !c.getContext) return null;
  c.width = w; c.height = h;
  return c.getContext('2d') ? c : null;
}

export function paintGround(L, seed) {
  const cv = canvas(PX, PX);
  if (!cv) return null;
  const g = cv.getContext('2d'), R = rng((seed ^ 0x51ed) >>> 0);
  const k = PX / (2 * G);
  const X = x => (x + G) * k, Y = z => (z + G) * k;
  const rect = (x0, z0, x1, z1) => g.fillRect(X(x0), Y(z0), (x1 - x0) * k, (z1 - z0) * k);
  const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
  const blob = (x, z, rx, rz, rot, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(X(x), Y(z), Math.max(0.5, rx * k), Math.max(0.5, rz * k), rot, 0, Math.PI * 2); g.fill(); };
  const rr = (a, b) => a + R() * (b - a);

  // sand, with soft light and dark patches
  g.fillStyle = '#cbb38b'; g.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 900; i++) blob(rr(-G, G), rr(-G, G), rr(6, 60), rr(4, 40), R() * Math.PI, R() < 0.5 ? 'rgba(255,240,210,0.07)' : 'rgba(120,90,55,0.06)');

  // the blocks: paved sidewalks with a curb, dusty ground inside
  for (const b of L.blocks) {
    g.fillStyle = '#b8aa8f'; rect(b.x0, b.z0, b.x1, b.z1);
    g.fillStyle = b.kind === 'industrial' ? '#a9a194' : '#c3aa83'; rect(b.x0 + 2.5, b.z0 + 2.5, b.x1 - 2.5, b.z1 - 2.5);
    g.strokeStyle = 'rgba(60,52,44,0.6)'; g.lineWidth = 1.2;
    g.strokeRect(X(b.x0) + 0.5, Y(b.z0) + 0.5, (b.x1 - b.x0) * k - 1, (b.z1 - b.z0) * k - 1);
    g.strokeStyle = 'rgba(80,70,58,0.22)'; g.lineWidth = 1;                // paving joints
    g.beginPath();
    for (let x = b.x0 + 2; x < b.x1; x += 2) { g.moveTo(X(x), Y(b.z0)); g.lineTo(X(x), Y(b.z0 + 2.5)); g.moveTo(X(x), Y(b.z1 - 2.5)); g.lineTo(X(x), Y(b.z1)); }
    for (let z = b.z0 + 2; z < b.z1; z += 2) { g.moveTo(X(b.x0), Y(z)); g.lineTo(X(b.x0 + 2.5), Y(z)); g.moveTo(X(b.x1 - 2.5), Y(z)); g.lineTo(X(b.x1), Y(z)); }
    g.stroke();
  }
  for (const y of L.yards) {
    g.fillStyle = y.kind === 'industrial' ? '#a49d91' : y.kind === 'market' ? '#cdb58e' : '#bea37b';
    rect(y.x0, y.z0, y.x1, y.z1);
    if (y.kind === 'industrial') {                                          // cracked concrete slabs
      g.strokeStyle = 'rgba(70,64,56,0.28)'; g.lineWidth = 1; g.beginPath();
      for (let x = y.x0 + 6; x < y.x1; x += 6) { g.moveTo(X(x), Y(y.z0)); g.lineTo(X(x), Y(y.z1)); }
      for (let z = y.z0 + 6; z < y.z1; z += 6) { g.moveTo(X(y.x0), Y(z)); g.lineTo(X(y.x1), Y(z)); }
      g.stroke();
    }
  }
  for (const a of L.alleys || []) {                                         // alleys: packed dirt, a gutter down the middle
    g.fillStyle = '#a99780'; rect(a.x0, a.z0, a.x1, a.z1);
    const ns = a.z1 - a.z0 > a.x1 - a.x0;
    g.fillStyle = 'rgba(70,60,50,0.45)';
    if (ns) rect((a.x0 + a.x1) / 2 - 0.25, a.z0, (a.x0 + a.x1) / 2 + 0.25, a.z1); else rect(a.x0, (a.z0 + a.z1) / 2 - 0.25, a.x1, (a.z0 + a.z1) / 2 + 0.25);
    for (let i = 0; i < 10; i++) blob(rr(a.x0, a.x1), rr(a.z0, a.z1), rr(0.6, 1.8), rr(0.6, 1.8), R() * 3, 'rgba(60,50,40,0.25)');
  }
  for (const s of L.squares || []) {                                        // squares: paving in a pattern, a ring round the monument
    g.fillStyle = '#c4b59a'; rect(s.x0, s.z0, s.x1, s.z1);
    g.strokeStyle = 'rgba(100,90,74,0.35)'; g.lineWidth = 1; g.beginPath();
    for (let x = s.x0; x <= s.x1; x += 2.5) { g.moveTo(X(x), Y(s.z0)); g.lineTo(X(x), Y(s.z1)); }
    for (let z = s.z0; z <= s.z1; z += 2.5) { g.moveTo(X(s.x0), Y(z)); g.lineTo(X(s.x1), Y(z)); }
    g.stroke();
    g.strokeStyle = 'rgba(120,104,84,0.75)'; g.lineWidth = 3; g.beginPath(); g.arc(X((s.x0 + s.x1) / 2), Y((s.z0 + s.z1) / 2), 6 * k, 0, Math.PI * 2); g.stroke();
  }
  for (const r of L.ruins) { g.fillStyle = '#a89881'; rect(r.x0, r.z0, r.x1, r.z1); for (let i = 0; i < 6; i++) blob(rr(r.x0, r.x1), rr(r.z0, r.z1), rr(1, 3), rr(1, 3), R() * 3, 'rgba(90,80,68,0.35)'); }
  for (const v of L.vacant) { g.fillStyle = '#c8ae86'; rect(v.x0, v.z0, v.x1, v.z1); }
  // building floors (the ground floor of every building is the ground)
  for (const f of L.footprints) if (f.floor !== undefined) { g.fillStyle = hex(f.floor); rect(f.x0, f.z0, f.x1, f.z1); }

  // the streets: asphalt, repaired patches, oil stains, cracks
  for (const s of L.streets) { g.fillStyle = '#4f4842'; rect(s.x0, s.z0, s.x1, s.z1); }
  for (const s of L.streets) {
    const len = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0;
    const along = (t, o) => s.axis === 'z' ? [s.at + o, s.z0 + t] : [s.x0 + t, s.at + o];
    for (let i = 0, n = Math.floor(len / 18); i < n; i++) {
      const [x, z] = along(rr(0, len), rr(-s.w / 2 + 1, s.w / 2 - 1)), w = rr(1.5, 5), d = rr(1.5, 4);
      g.fillStyle = R() < 0.5 ? 'rgba(98,90,82,0.55)' : 'rgba(58,52,47,0.6)';
      g.fillRect(X(x - w / 2), Y(z - d / 2), w * k, d * k);
    }
    for (let i = 0, n = Math.floor(len / 30); i < n; i++) { const [x, z] = along(rr(0, len), rr(-s.w / 2, s.w / 2)); blob(x, z, rr(0.6, 2), rr(0.5, 1.5), R() * 3, 'rgba(25,22,20,0.35)'); }
    g.strokeStyle = 'rgba(32,28,25,0.55)'; g.lineWidth = 1;
    for (let i = 0, n = Math.floor(len / 14); i < n; i++) {
      let [x, z] = along(rr(0, len), rr(-s.w / 2, s.w / 2));
      g.beginPath(); g.moveTo(X(x), Y(z));
      for (let q = 0, m = 2 + Math.floor(R() * 4); q < m; q++) { x += rr(-2.2, 2.2); z += rr(-2.2, 2.2); g.lineTo(X(x), Y(z)); }
      g.stroke();
    }
  }
  // faded lane marks down the middle (not through the crossings), crosswalks at the busier crossings
  const crossings = [];
  for (const a of L.streets) if (a.axis === 'z') for (const b of L.streets) if (b.axis === 'x') {
    if (a.at > b.x0 && a.at < b.x1 && b.at > a.z0 && b.at < a.z1) crossings.push({ x: a.at, z: b.at, wx: a.w, wz: b.w });
  }
  const inCrossing = (x, z) => crossings.some(c => Math.abs(x - c.x) < c.wx / 2 + 3 && Math.abs(z - c.z) < c.wz / 2 + 3);
  g.fillStyle = 'rgba(214,200,160,0.55)';
  for (const s of L.streets) {
    if (s.w < 11) continue;
    const len = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0;
    for (let t = 2; t < len - 3; t += 9) {
      if (R() < 0.3) continue;
      if (s.axis === 'z') { if (!inCrossing(s.at, s.z0 + t + 1.5)) g.fillRect(X(s.at - 0.2), Y(s.z0 + t), 0.4 * k, 3 * k); }
      else if (!inCrossing(s.x0 + t + 1.5, s.at)) g.fillRect(X(s.x0 + t), Y(s.at - 0.2), 3 * k, 0.4 * k);
    }
  }
  g.fillStyle = 'rgba(210,198,165,0.5)';
  for (const c of crossings) {
    if (Math.max(Math.abs(c.x), Math.abs(c.z)) > 240 || R() < 0.25) continue;
    for (const dir of [-1, 1]) {
      const zc = c.z + dir * (c.wz / 2 + 2), xc = c.x + dir * (c.wx / 2 + 2);
      for (let a = -c.wx / 2 + 0.6; a < c.wx / 2 - 0.6; a += 1.6) if (R() > 0.2) g.fillRect(X(c.x + a), Y(zc - 1.5), 0.8 * k, 3 * k);
      for (let a = -c.wz / 2 + 0.6; a < c.wz / 2 - 0.6; a += 1.6) if (R() > 0.2) g.fillRect(X(xc - 1.5), Y(c.z + a), 3 * k, 0.8 * k);
      // stop lines across the half of the street coming in
      g.fillRect(X(c.x + (dir > 0 ? 0.2 : -c.wx / 2 + 0.4)), Y(c.z - dir * (c.wz / 2 + 4.1) - 0.2), (c.wx / 2 - 0.6) * k, 0.4 * k);
      g.fillRect(X(c.x - dir * (c.wx / 2 + 4.1) - 0.2), Y(c.z + (dir > 0 ? -c.wz / 2 + 0.4 : 0.2)), 0.4 * k, (c.wz / 2 - 0.6) * k);
    }
  }
  // parking bays along the kerbs downtown
  g.fillStyle = 'rgba(214,200,160,0.32)';
  for (const s of L.streets) {
    if (s.w < 12) continue;
    const len = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0;
    for (let t = 1; t < len - 1; t += 5.5) {
      const [x, z] = s.axis === 'z' ? [s.at, s.z0 + t] : [s.x0 + t, s.at];
      if (Math.max(Math.abs(x), Math.abs(z)) > 240 || inCrossing(x, z)) continue;
      for (const side of [-1, 1]) {
        const o0 = side * (s.w / 2 - 2.3), o1 = side * (s.w / 2 - 0.15), a = Math.min(o0, o1), b = Math.max(o0, o1);
        if (s.axis === 'z') g.fillRect(X(s.at + a), Y(z - 0.07), (b - a) * k, 0.14 * k + 0.6); else g.fillRect(X(x - 0.07), Y(s.at + a), 0.14 * k + 0.6, (b - a) * k);
      }
    }
  }
  // marks things left: scorch under burnt wrecks and fires, oil, manholes, drains, tree pits, rugs in the bazaars
  for (const d of L.decals || []) {
    if (d.kind === 'scorch') {
      const grd = g.createRadialGradient(X(d.x), Y(d.z), 0, X(d.x), Y(d.z), d.r * k);
      grd.addColorStop(0, 'rgba(20,16,14,0.85)'); grd.addColorStop(0.6, 'rgba(35,28,24,0.5)'); grd.addColorStop(1, 'rgba(35,28,24,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(X(d.x), Y(d.z), d.r * k, 0, Math.PI * 2); g.fill();
    } else if (d.kind === 'oil') blob(d.x, d.z, d.r, d.r * 0.7, R() * 3, 'rgba(18,16,15,0.45)');
    else if (d.kind === 'manhole') {
      g.fillStyle = 'rgba(40,38,36,0.9)'; g.beginPath(); g.arc(X(d.x), Y(d.z), 0.45 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(120,112,100,0.6)'; g.lineWidth = 1; g.stroke();
    } else if (d.kind === 'drain') {
      g.fillStyle = 'rgba(25,23,21,0.85)';
      if (d.ax === 'z') rect(d.x - 0.18, d.z - 0.45, d.x + 0.18, d.z + 0.45); else rect(d.x - 0.45, d.z - 0.18, d.x + 0.45, d.z + 0.18);
    } else if (d.kind === 'pit') { g.fillStyle = 'rgba(92,76,58,0.85)'; rect(d.x - 0.65, d.z - 0.65, d.x + 0.65, d.z + 0.65); }
    else if (d.kind === 'rug') {
      const c = Math.cos(d.a), s = Math.sin(d.a), pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [d.x + u * d.w / 2 * c - v * d.d / 2 * s, d.z + u * d.w / 2 * s + v * d.d / 2 * c]);
      g.fillStyle = `rgba(${d.c >> 16 & 255},${d.c >> 8 & 255},${d.c & 255},0.8)`;
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

  // the plaza: big stone paving, darker round the tower, a ring round the fountain
  const P = L.plaza;
  if (P) {
    g.fillStyle = '#bdb19b'; rect(P.x0, P.z0, P.x1, P.z1);
    for (let i = 0; i < 260; i++) { const x = rr(P.x0, P.x1 - 3), z = rr(P.z0, P.z1 - 3); g.fillStyle = R() < 0.5 ? 'rgba(150,138,118,0.45)' : 'rgba(225,215,195,0.35)'; rect(x, z, x + 3, z + 3); }
    g.strokeStyle = 'rgba(95,86,72,0.4)'; g.lineWidth = 1; g.beginPath();
    for (let x = P.x0; x <= P.x1; x += 3) { g.moveTo(X(x), Y(P.z0)); g.lineTo(X(x), Y(P.z1)); }
    for (let z = P.z0; z <= P.z1; z += 3) { g.moveTo(X(P.x0), Y(z)); g.lineTo(X(P.x1), Y(z)); }
    g.stroke();
    g.strokeStyle = 'rgba(80,70,58,0.7)'; g.lineWidth = 2.5; g.strokeRect(X(P.x0) + 1, Y(P.z0) + 1, (P.x1 - P.x0) * k - 2, (P.z1 - P.z0) * k - 2);
    const T = L.tower;
    if (T) { g.fillStyle = 'rgba(70,62,52,0.35)'; rect(T.x0 - 6, T.z0 - 6, T.x1 + 6, T.z1 + 6); }
    g.strokeStyle = 'rgba(120,108,90,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(X(38), Y(48), 8 * k, 0, Math.PI * 2); g.stroke();
  }
  // the crater: scorched in the middle, ash and cracks out to the rim
  const C = L.crater;
  if (C) {
    const grd = g.createRadialGradient(X(C.x), Y(C.z), 0, X(C.x), Y(C.z), (C.r + 14) * k);
    grd.addColorStop(0, 'rgba(38,30,26,0.95)'); grd.addColorStop(0.45, 'rgba(70,56,44,0.9)'); grd.addColorStop(0.78, 'rgba(125,106,87,0.75)'); grd.addColorStop(1, 'rgba(125,106,87,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(X(C.x), Y(C.z), (C.r + 14) * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,16,14,0.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) {
      const a = R() * Math.PI * 2;
      let r = rr(4, C.r * 0.6), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      g.beginPath(); g.moveTo(X(x), Y(z));
      for (let q = 0; q < 4; q++) { r += rr(3, 9); const b = a + rr(-0.25, 0.25); x = C.x + Math.cos(b) * r; z = C.z + Math.sin(b) * r; g.lineTo(X(x), Y(z)); }
      g.stroke();
    }
    for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, r = rr(0, C.r * 0.5); blob(C.x + Math.cos(a) * r, C.z + Math.sin(a) * r, rr(1, 4), rr(1, 3), a, 'rgba(150,100,220,0.12)'); }
  }
  // drifts of sand over the streets and sidewalks, thicker towards the edge of the city
  for (let i = 0; i < 1400; i++) {
    const s = L.streets[Math.floor(R() * L.streets.length)];
    const len = s.axis === 'z' ? s.z1 - s.z0 : s.x1 - s.x0, t = rr(0, len), side = R() < 0.5 ? -1 : 1;
    const o = side * (s.w / 2 - rr(0, s.w * 0.45));
    const [x, z] = s.axis === 'z' ? [s.at + o, s.z0 + t] : [s.x0 + t, s.at + o];
    const edge = Math.max(Math.abs(x), Math.abs(z)) / 400, a = 0.25 + 0.45 * edge * R();
    const lx = rr(2, 9) * (0.6 + edge), lw = rr(0.6, 2.2) * (0.6 + edge);
    blob(x, z, s.axis === 'z' ? lw : lx, s.axis === 'z' ? lx : lw, rr(-0.2, 0.2), `rgba(205,182,140,${a.toFixed(2)})`);
  }
  for (let i = 0; i < 260; i++) {                                           // the street ends fade into the sand
    const s = L.streets[Math.floor(R() * L.streets.length)], end = R() < 0.5 ? 0 : 1;
    if (s.axis === 'z' && Math.abs(end ? s.z1 : s.z0) < 380) continue;
    if (s.axis === 'x' && Math.abs(end ? s.x1 : s.x0) < 380) continue;
    const t = rr(0, 16), o = rr(-s.w / 2, s.w / 2);
    const [x, z] = s.axis === 'z' ? [s.at + o, end ? s.z1 - t : s.z0 + t] : [end ? s.x1 - t : s.x0 + t, s.at + o];
    blob(x, z, rr(2, 6), rr(2, 6), R() * 3, 'rgba(203,179,139,0.7)');
  }
  // grain over everything
  const grain = canvas(128, 128);
  if (grain) {
    const gg = grain.getContext('2d'), img = gg.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = R() < 0.5 ? 0 : 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = Math.floor(R() * 26); }
    gg.putImageData(img, 0, 0);
    g.fillStyle = g.createPattern(grain, 'repeat'); g.fillRect(0, 0, PX, PX);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
}

// the ground's material: the painted map, with a fine noise multiplied in close up (so it never looks smeared)
export function groundMaterial(map, seed) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  const dc = canvas(256, 256);
  if (!dc) return mat;
  const R = rng((seed ^ 0x2c1b) >>> 0), dg = dc.getContext('2d'), img = dg.createImageData(256, 256), v = new Float32Array(256 * 256);
  for (let i = 0; i < v.length; i++) v[i] = R();
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {        // a soft blur, wrapping round
    const i = y * 256 + x;
    v[i] = (v[i] * 2 + v[y * 256 + ((x + 1) & 255)] + v[((y + 1) & 255) * 256 + x] + v[y * 256 + ((x + 255) & 255)]) / 5;
  }
  for (let i = 0; i < v.length; i++) { const c = Math.floor(v[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255; }
  dg.putImageData(img, 0, 0);
  const detail = new THREE.CanvasTexture(dc);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  mat.userData.detail = detail;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: detail };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D uDetail;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\t{ float dn = texture2D( uDetail, vMapUv * 137.0 ).r * 0.6 + texture2D( uDetail, vMapUv * 29.0 ).r * 0.4;\n\t  diffuseColor.rgb *= 0.78 + 0.44 * dn; }');
  };
  return mat;
}
