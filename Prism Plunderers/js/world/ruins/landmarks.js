// The landmarks of The Ruins (step 5c): the Collapsed Tower and the wreckage of its top across the plaza, the
// highway jammed with the evacuation that never got out (two off-ramps, one broken off), the Underground Base
// (rooms round a loop of corridors, an escape stair), and the Pod Crater, a real bowl in the ground with the pod
// you can walk into. Plain boxes through the Kit like the rest of the city (kit.js), built by makeRuins
// (layout.js) before the street life, so the props keep clear of them.
import { K, COL, FLOOR, SLAB, STEPS, RISE } from './kit.js';
import { building, containerStack, addLoot, carLoot, crystalsAround } from './buildings.js';
import * as P from './props.js';
import { XS, ZS, WX, WZ } from './plan.js';

const H = FLOOR, SW = 1.6, DET = K.DETAIL;
const DEPTH = { crate: 0.78, locker: 0.5, medcab: 0.3, toolbox: 0.6, case: 0.62, cache: 0.66, safe: 0.6, military: 0.62 };   // how far each container reaches out
const shuffle = (a, R) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- turning boxes (Euler YXZ, the way three.js and the kit turn them) ----------
function rot(ry = 0, rx = 0, rz = 0) {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
  return mul(mul([cy, 0, sy, 0, 1, 0, -sy, 0, cy], [1, 0, 0, 0, cx, -sx, 0, sx, cx]), [cz, -sz, 0, sz, cz, 0, 0, 0, 1]);
}
function mul(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}
const apply = (M, x, y, z) => ({ x: M[0] * x + M[1] * y + M[2] * z, y: M[3] * x + M[4] * y + M[5] * z, z: M[6] * x + M[7] * y + M[8] * z });
function euler(M) {
  const rx = Math.asin(-Math.max(-1, Math.min(1, M[5])));
  return Math.abs(M[5]) < 0.9999999 ? { rx, ry: Math.atan2(M[2], M[8]), rz: Math.atan2(M[3], M[4]) } : { rx, ry: Math.atan2(-M[6], M[0]), rz: 0 };
}
// a box given in a frame (origin o, rotation M; opts.rx/ry/rz turn it inside the frame) put into the world
function fbox(kit, F, lx, ly, lz, w, h, d, c, opts = {}) {
  const p = apply(F.M, lx, ly, lz), e = euler(mul(F.M, rot(opts.ry || 0, opts.rx || 0, opts.rz || 0)));
  return kit.cbox(F.o.x + p.x, F.o.y + p.y, F.o.z + p.z, w, h, d, c, { ...opts, rx: e.rx, ry: e.ry, rz: e.rz });
}
// the frame of a ramp from kit.ramp(p0, p1): x across it, y up from its top surface, z up along it from p0
function rampFrame(p0, p1) {
  const dx = p1.x - p0.x, dz = p1.z - p0.z, dy = p1.y - p0.y, hl = Math.hypot(dx, dz);
  return { o: p0, M: rot(Math.atan2(dx, dz), -Math.atan2(dy, hl), 0), len: Math.hypot(hl, dy) };
}
// a wall in a frame, along its x (at local z = at) from a0 to a1, standing on y0, with openings [{ a, w, b, t }]
function fwall(kit, F, at, a0, a1, y0, h, ops, c, t = 0.3, opts = {}) {
  const piece = (p, q, b0, b1) => { if (q - p > 0.02 && b1 - b0 > 0.02) fbox(kit, F, (p + q) / 2, y0 + (b0 + b1) / 2, at, q - p, b1 - b0, t, c, opts); };
  let cur = a0;
  for (const o of [...ops].sort((p, q) => p.a - q.a)) {
    const l = Math.max(a0, o.a - o.w / 2), r = Math.min(a1, o.a + o.w / 2);
    if (r <= l) continue;
    piece(cur, l, 0, h); piece(l, r, 0, o.b); piece(l, r, o.t, h);
    cur = r;
  }
  piece(cur, a1, 0, h);
}

// =====================================================================================================
// The plaza and the Collapsed Tower
// =====================================================================================================
// The stump: 24 m square, eight floors still standing round a concrete core with stairs all the way up (two
// flights side by side, taking turns, so you go up in a U); open offices with holes in the floors and missing
// front panels; the top floor (7) open to the sky with the best loot. Its top fell south-east: a long strip of its
// front leans on the stump (the climb up to floor 6), three broken pieces lie across the plaza.
export const TOWER = { x0: -12, z0: -36, x1: 12, z1: -12, breach: 6 * FLOOR, top: 7 * FLOOR };
export const FOUNTAIN = { x: -24, z: 20, r: 8 };
export const FRONT = { p0: { x: 52, y: 0, z: 22 }, p1: { x: 12, y: 6 * FLOOR, z: -24 }, w: 10 };
const CORE = { x0: -4, z0: -28, x1: 4, z1: -20 };
const SLOTS = [
  { x: -2.8, z: -26.4, dir: 1, hole: { x0: -3.6, x1: -2.0, z0: -25.5, z1: -21.6 } },    // A: flights 0, 2, 4, 6 go south
  { x: 2.8, z: -21.6, dir: -1, hole: { x0: 2.0, x1: 3.6, z0: -26.4, z1: -22.5 } },      // B: flights 1, 3, 5 go north
];

export function plaza(L, kit) {
  const used = [];
  const take = (x0, z0, x1, z1) => used.push({ x0, z0, x1, z1 });
  const clear = (x, z, m) => used.every(r => x < r.x0 - m || x > r.x1 + m || z < r.z0 - m || z > r.z1 + m);
  tower(L, kit);
  take(TOWER.x0 - 1.5, TOWER.z0 - 1.5, TOWER.x1 + 1.5, TOWER.z1 + 1.5);
  fallenFront(L, kit, take);
  pieceOnSide(L, kit, take);
  pieceTilted(L, kit, take);
  pieceCrown(L, kit, take);
  // the dry fountain, south-west
  const F = FOUNTAIN;
  for (let a = 0; a < 8; a++) kit.cbox(F.x + Math.cos(a * Math.PI / 4) * 5, 0.4, F.z + Math.sin(a * Math.PI / 4) * 5, 4.2, 0.8, 0.6, COL.white[0], { ry: -a * Math.PI / 4 + Math.PI / 2 });
  kit.box(F.x, 0, F.z, 1.4, 2.4, 1.4, COL.stone[1]);
  kit.cbox(F.x + 0.3, 2.75, F.z - 0.2, 0.8, 0.7, 0.8, COL.stone[3], { rz: 0.5, col: false, k: DET });
  take(F.x - 6, F.z - 6, F.x + 6, F.z + 6);
  L.fountain = { ...F };
  // palms along the north and south edges, wrecks along the west, sandbags where someone held out
  for (let k = 0; k < 8; k++) {
    const x = -54 + k * 15 + kit.range(-3, 3), z = k % 2 ? kit.range(-59, -55) : kit.range(55, 59);
    if (clear(x, z, 2)) { kit.palm(x, z, kit.range(7, 11)); take(x - 0.7, z - 0.7, x + 0.7, z + 0.7); }
  }
  for (let k = 0; k < 5; k++) {
    const x = kit.range(-59, -52), z = -46 + k * 21 + kit.range(-3, 3);
    if (clear(x, z, 3)) { carLoot(L, kit, x, z, Math.PI / 2 + kit.range(-0.5, 0.5), 'red'); take(x - 3, z - 3, x + 3, z + 3); }
  }
  for (const [x, z, yaw] of [[-30, -45, 0.3], [-44, -4, Math.PI / 2], [24, 36, -0.6]]) if (clear(x, z, 3)) { P.sandbags(kit, x, z, yaw); take(x - 3, z - 3, x + 3, z + 3); }
  L.signs.push({ title: 'Collapsed Tower', sub: 'Up the fallen front, or the\nstairs inside. Best loot on top.', x: 57.5, y: 2.2, z: 29, ry: -2.3 });
}

function tower(L, kit) {
  const T = TOWER, R = kit.R, N = 6, BW = 4, TOP = 7;
  const X = i => T.x0 + i * BW, Z = j => T.z0 + j * BW, cx = i => X(i) + BW / 2, cz = j => Z(j) + BW / 2;
  const cFrame = 0xb1a590, cSpan = 0x595c60, cCore = COL.concrete[1], cFloor = 0x8a8378;
  const isCore = (i, j) => i >= 2 && i <= 3 && j >= 2 && j <= 3;
  const approach = (i, j) => (i === 2 || i === 3) && (j === 1 || j === 4);               // in front of the core's doors
  const keep = (f, i, j) => isCore(i, j) || approach(i, j) || (f === TOP && i <= 1) || (f === 6 && i >= 4 && j >= 1 && j <= 4);
  // which 4 m cells have a floor on each level (0 is the ground)
  const cell = [];
  for (let f = 0; f <= TOP; f++) cell.push(Array.from({ length: N }, () => Array(N).fill(true)));
  for (let f = 1; f <= TOP; f++) for (let k = 0, n = f === 1 ? 1 : 1 + Math.floor(R() * 2); k < n; k++) {
    const i = Math.floor(R() * N), j = Math.floor(R() * N);
    if (!keep(f, i, j)) cell[f][i][j] = false;
  }
  for (let i = 3; i < N; i++) for (let j = 3; j < N; j++) if (!keep(TOP, i, j)) cell[TOP][i][j] = false;   // the corner that broke away
  cell[1][1][4] = false;                                                                // a hole over the lobby
  const blocked = new Set(), bk = (f, i, j) => f + ':' + i + ':' + j;

  // ---- what to search: against the core's outer walls, facing out (decided first: nothing else goes in front) ----
  const SPOT = [
    { x: CORE.x0, z: -26, nx: -1, nz: 0, cell: [1, 2] }, { x: CORE.x1, z: -22, nx: 1, nz: 0, cell: [4, 3] },
    { x: 2.5, z: CORE.z1, nx: 0, nz: 1, cell: [3, 4] }, { x: -2.5, z: CORE.z0, nx: 0, nz: -1, cell: [2, 1] },
  ];
  const kinds = f => f === 0 ? ['locker'] : f <= 2 ? ['locker', 'medcab', 'locker'] : f <= 4 ? ['case', 'safe', 'locker', 'medcab'] : ['case', 'safe', 'military'];
  const loot = [];
  for (let f = 0; f < TOP; f++) {
    const n = f === 0 ? 1 : 1 + (R() < 0.45 ? 1 : 0);
    let placed = 0;
    for (const s of shuffle(SPOT.slice(), R)) {
      if (placed >= n) break;
      const [i, j] = s.cell;
      if (!cell[f][i][j] || (f === 6 && i >= 4)) continue;
      loot.push({ f, s, type: kit.pick(kinds(f)) });
      blocked.add(bk(f, i, j));
      placed++;
    }
  }
  loot.push({ f: TOP, s: SPOT[0], type: 'case' });
  blocked.add(bk(TOP, 1, 2)); blocked.add(bk(TOP, 0, 0)); blocked.add(bk(TOP, 0, 1)); blocked.add(bk(TOP, 1, 1));

  // ---- floors: 4 m pieces, the core's floor with the stairwell over the flight below; torn edges, what fell ----
  for (let f = 1; f <= TOP; f++) {
    const y = f * H;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!isCore(i, j) && cell[f][i][j]) kit.box(cx(i), y - SLAB, cz(j), BW, SLAB, BW, COL.slab, { top: cFloor });
    kit.slab(CORE.x0, CORE.z0, CORE.x1, CORE.z1, y, COL.slab, SLOTS[(f - 1) % 2].hole, { top: cFloor });
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (isCore(i, j) || cell[f][i][j] || R() > 0.55) continue;
      kit.rebar(cx(i) + kit.range(-1.6, 1.6), y - 0.25, cz(j) + kit.range(-1.6, 1.6), 3);
      if (cell[f - 1][i][j] && !blocked.has(bk(f - 1, i, j)) && !approach(i, j)) { kit.rubble(cx(i), cz(j), 1.5, 3, (f - 1) * H); blocked.add(bk(f - 1, i, j)); }
    }
  }

  // ---- columns: round the front every 4 m and a ring inside; stumps above the summit ----
  const cols = [];
  for (let gi = 0; gi <= N; gi++) for (let gj = 0; gj <= N; gj++) {
    const edge = gi === 0 || gi === N || gj === 0 || gj === N;
    const ring = ((gi === 1 || gi === 5) && gj % 2 === 1) || ((gj === 1 || gj === 5) && gi % 2 === 1);
    if (edge || ring) cols.push([gi, gj]);
  }
  const holds = (f, gi, gj) => [[gi - 1, gj - 1], [gi, gj - 1], [gi - 1, gj], [gi, gj]].some(([i, j]) => i >= 0 && j >= 0 && i < N && j < N && !isCore(i, j) && cell[f][i][j]);
  const colAt = (gi, gj) => ({ x: Math.min(T.x1 - 0.3, Math.max(T.x0 + 0.3, X(gi))), z: Math.min(T.z1 - 0.3, Math.max(T.z0 + 0.3, Z(gj))) });
  for (let f = 0; f < TOP; f++) for (const [gi, gj] of cols) if (holds(f + 1, gi, gj)) { const p = colAt(gi, gj); kit.box(p.x, f * H, p.z, 0.6, H - SLAB, 0.6, cFrame); }
  for (const [gi, gj] of cols) if (holds(TOP, gi, gj) && R() < 0.7) {
    const p = colAt(gi, gj), h = kit.range(0.6, 3.4);
    kit.box(p.x, TOP * H, p.z, 0.6, h, 0.6, cFrame);
    kit.rebar(p.x, TOP * H + h, p.z, 2);
  }

  // ---- the front: a dark band at every floor (waist high: you can lean on it), a few frames left above it ----
  const side = { n: { cell: k => [k, 0], ax: 'x', at: T.z0 + 0.15 }, s: { cell: k => [k, N - 1], ax: 'x', at: T.z1 - 0.15 },
    w: { cell: k => [0, k], ax: 'z', at: T.x0 + 0.15 }, e: { cell: k => [N - 1, k], ax: 'z', at: T.x1 - 0.15 } };
  for (let f = 1; f <= TOP; f++) for (const s of 'nswe') for (let k = 0; k < N; k++) {
    const S = side[s], [i, j] = S.cell(k);
    if (!cell[f][i][j] || (f === 6 && s === 'e' && k >= 1 && k <= 4) || R() < 0.12) continue;      // floor 6, east: where the front came in
    const a0 = (S.ax === 'x' ? X(k) : Z(k)) + 0.3, a1 = a0 + BW - 0.6, m = (a0 + a1) / 2;
    if (S.ax === 'x') kit.box(m, f * H, S.at, a1 - a0, 1.05, 0.3, cSpan); else kit.box(S.at, f * H, m, 0.3, 1.05, a1 - a0, cSpan);
    if (f < TOP && R() < 0.45) {
      const b = a0 + kit.range(0.4, BW - 1.0);
      if (S.ax === 'x') kit.box(b, f * H + 1.05, S.at, 0.09, H - SLAB - 1.05, 0.09, cFrame, { col: false, k: DET });
      else kit.box(S.at, f * H + 1.05, b, 0.09, H - SLAB - 1.05, 0.09, cFrame, { col: false, k: DET });
    }
  }

  // ---- the core: walls with a door north and south on every floor, the lift shafts, the stairs ----
  for (let f = 0; f <= TOP; f++) {
    const y0 = f * H, top = f === TOP, h = top ? kit.range(1.4, 2.8) : H - SLAB, jag = top ? 0.6 : 0;
    const door = [{ a: 0, w: 1.6, b: 0, t: 2.4 }];
    kit.wall('x', CORE.z0 + 0.15, CORE.x0, CORE.x1, y0, h, door, cCore, { jag });
    kit.wall('x', CORE.z1 - 0.15, CORE.x0, CORE.x1, y0, h, door, cCore, { jag });
    kit.wall('z', CORE.x0 + 0.15, CORE.z0 + 0.3, CORE.z1 - 0.3, y0, h, [], cCore, { jag });
    kit.wall('z', CORE.x1 - 0.15, CORE.z0 + 0.3, CORE.z1 - 0.3, y0, h, [], cCore, { jag });
    if (top) continue;
    kit.box(0, y0, -24, 3.6, H - SLAB, 2.8, cCore, { k: DET });
    const sl = SLOTS[f % 2];
    kit.steps('z', sl.x, sl.z, sl.dir, y0, SW, STEPS, COL.slab, cFloor);
  }
  L.stairs.push({ x: SLOTS[0].x, z: SLOTS[0].z - 0.9, yaw: Math.PI, y0: 0, y1: TOP * H, tower: true });

  // ---- the lobby: the glass front is gone; a reception desk, planters, the heap under the hole above ----
  kit.box(-3.2, 0, -17.2, 4.6, 1.1, 0.8, 0x6a5a48, { k: DET });
  kit.box(-5.2, 0, -16.2, 0.8, 1.1, 2.0, 0x6a5a48, { k: DET });
  for (const [x, z] of [[-10.6, -13.4], [10.6, -13.4], [10.6, -34.6], [-10.6, -34.6]]) {
    kit.box(x, 0, z, 1.0, 0.8, 1.0, COL.stone[2], { k: DET });
    kit.box(x, 0.8, z, 0.06, 1.2, 0.06, 0x5a4d40, { col: false, k: DET });
  }
  kit.rubble(cx(1), cz(4), 2.0, 4);
  blocked.add(bk(0, 1, 4));

  // ---- loot, desks, places for things lying about, a nest on floor 3 ----
  for (const { f, s, type } of loot) addLoot(L, kit, type, s.x + s.nx * (DEPTH[type] / 2 + 0.03), f * H, s.z + s.nz * (DEPTH[type] / 2 + 0.03), Math.atan2(s.nx, s.nz), 'red');
  const top = TOP * H;
  addLoot(L, kit, 'cache', -8.5, top, -32.6, 0, 'red');
  crystalsAround(L, kit, -8.5, top, -32.6, 2.4, 14);
  for (let f = 1; f < TOP; f++) {
    const y0 = f * H;
    let nest = f === 3;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (isCore(i, j) || approach(i, j) || !cell[f][i][j] || blocked.has(bk(f, i, j)) || (f === 6 && i >= 4 && j >= 1 && j <= 4)) continue;
      if (nest && i <= 1 && j <= 1) { L.nestSpots.push({ x: cx(i), y: y0 + 0.1, z: cz(j), zone: 'red', tower: true }); nest = false; continue; }
      if (R() < 0.42) {
        const along = R() < 0.5;
        kit.box(cx(i) + kit.range(-0.8, 0.8), y0, cz(j) + kit.range(-0.8, 0.8), along ? 1.5 : 0.75, 0.75, along ? 0.75 : 1.5, kit.pick(COL.furniture), { k: DET });
      } else if (R() < 0.35) L.floorSpots.push({ x: cx(i), y: y0, z: cz(j), zone: 'red' });
    }
  }
  L.footprints.push({ x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1, h: TOP * H + 2, open: true, floor: cFloor, tower: true });
  L.interiors.push({ x0: T.x0 + 0.5, z0: T.z0 + 0.5, x1: T.x1 - 0.5, z1: T.z1 - 0.5, y0: 0, y1: TOP * H });
}

// the strip of the front that came down and leans on the stump: the climb to floor 6, exposed all the way up
function fallenFront(L, kit, take) {
  const { p0, p1, w } = FRONT;
  kit.ramp(p0, p1, w, 1.2, 0x5a5d61, { top: 0x4e5155 });
  const F = rampFrame(p0, p1), len = F.len;
  // its window frames, face up now
  for (let s = 2; s < len - 1; s += 3.4) fbox(kit, F, 0, 0.03, s, w - 0.4, 0.06, 0.16, 0xa9a08e, { col: false, k: DET });
  for (const v of [-w / 2 + 0.25, -1.6, 1.6, w / 2 - 0.25]) fbox(kit, F, v, 0.03, len / 2, 0.16, 0.06, len - 1, 0xa9a08e, { col: false, k: DET });
  // propped on what fell with it
  const at = t => ({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t });
  const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
  for (const [t, s] of [[0.36, 6], [0.68, 6]]) {
    const q = at(t), hgt = q.y - 1.45;
    kit.cbox(q.x, hgt / 2, q.z, s, hgt, s, kit.pick(COL.rubble), { ry: yaw + 0.25 });
  }
  // debris along both sides
  const ax = Math.cos(yaw), az = -Math.sin(yaw);                                    // across it, flat
  for (let k = 0; k < 8; k++) {
    const q = at(kit.range(0.05, 0.6)), off = (k % 2 ? 1 : -1) * kit.range(7, 10);
    kit.rubble(q.x + ax * off, q.z + az * off, kit.range(2.5, 4), 4);
  }
  for (let t = 0; t <= 1.001; t += 0.25) { const q = at(t); take(q.x - 7, q.z - 7, q.x + 7, q.z + 7); }
}

// a piece of the top lying on its side: its old floors stand on edge inside it, you get through where they broke
function pieceOnSide(L, kit, take) {
  const x0 = 33, x1 = 43.2, z0 = -47, z1 = -33, h = 14, mid = (z0 + z1) / 2, R = kit.R;
  const c = COL.tower, cs = 0x595c60;
  for (const z of [z0 + 0.15, z1 - 0.15]) for (let y = 0; y < h - 0.01; y += 3.5) {            // its old fronts: windows on end
    const last = y + 3.5 >= h - 0.01;
    const ops = last ? [] : [0, 1, 2].map(k => ({ a: x0 + 1.7 + k * 3.4, w: 1.5, b: 0.9, t: 2.7 }));
    kit.wall('x', z, x0, x1, y, Math.min(3.5, h - y), ops, Math.floor(y / 3.5) % 2 ? cs : c, { jag: last ? 0.5 : 0 });
  }
  for (let b = 0; b < 4; b++) kit.box((x0 + x1) / 2, h - 0.3, z0 + 0.6 + b * (z1 - z0 - 1.2) / 3, x1 - x0, 0.3, 1.2, cs);   // its top: strips and holes
  for (const x of [x0 + 0.3, x0 + 3.4, x0 + 6.8, x1 - 0.3]) kit.box(x, h - 0.3, mid, 0.6, 0.3, z1 - z0, cs);
  [x0 + 0.15, x0 + 3.4, x0 + 6.8, x1 - 0.15].forEach((x, k) => {
    const end = k === 0 || k === 3;
    const ops = end ? [{ a: mid, w: 6, b: 0, t: 6 }] : [{ a: mid + (k === 1 ? -3 : 3), w: 3.2, b: 0, t: 3.2 }, { a: mid + (k === 1 ? 4 : -4), w: 2.2, b: 6, t: 9 }];
    kit.wall('z', x, z0 + 0.3, z1 - 0.3, 0, h - 0.3, ops, c, { t: 0.3, jag: end ? 0.8 : 0.15 });
  });
  kit.rubble(x0 + 1.9, mid + 4.5, 1.5, 3);
  kit.rubble(x1 - 1.8, mid - 4.8, 1.6, 3);
  for (let k = 0; k < 3; k++) kit.box(x0 + 4.4 + k * 1.1, 0, z0 + 1.3 + R() * 1.5, 0.75, 1.5, 0.75, kit.pick(COL.furniture), { k: DET });   // desks on their ends
  addLoot(L, kit, 'crate', x0 + 1.0, 0, mid - 2.2, Math.PI / 2, 'red');
  addLoot(L, kit, 'toolbox', x0 + 7.6, 0, z1 - 2.6, Math.PI / 2, 'red');
  take(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
}

// two floors that landed upright, tilted and sunk into the paving on one side; you walk in up the tilted floor
function pieceTilted(L, kit, take) {
  const F = { o: { x: 36, y: 0, z: 52 }, M: rot(0, 0.17, 0) }, c = COL.tower, cs = 0x595c60, fl = 0x8a8378, R = kit.R;
  fbox(kit, F, 0, -0.15, -7, 14, 0.3, 14, COL.slab, { top: fl });                  // the floor (tilted: it rises to the north)
  fbox(kit, F, -3.8, 3.25, -7, 6.4, 0.3, 14, COL.slab, { top: fl });               // the next floor up, broken in two
  fbox(kit, F, 4.6, 3.25, -9.5, 4.8, 0.3, 9, COL.slab, { top: fl });
  fbox(kit, F, -2.5, 6.65, -8.5, 9, 0.3, 11, COL.slab, { top: 0x7d7264 });         // what is left of its roof
  const win = y => [-4.5, 0, 4.5].map(a => ({ a, w: 1.6, b: y + 1.0, t: y + 2.4 }));
  fwall(kit, F, -0.15, -7, 7, 0, 6.8, [{ a: -2, w: 3, b: 0, t: 2.6 }], c);         // the south side, with the way in
  fwall(kit, F, -13.85, -7, 7, 0, 3.4, win(0), cs);                               // north
  fwall(kit, F, -13.85, -7, 7, 3.4, 3.4, win(0), c);
  // the west (s = 1) and east (s = -1) sides, each in its own turned frame: there local z = -6.85 is the side and
  // local x runs along it (s = 1: x = -z of the piece, 0..14; s = -1: x = z of the piece, -14..0)
  for (const s of [1, -1]) {
    const G = { o: F.o, M: mul(F.M, rot(s * Math.PI / 2, 0, 0)) }, a0 = s > 0 ? 0 : -14, a1 = s > 0 ? 14 : 0;
    fwall(kit, G, -6.85, a0, a1, 0, 3.4, [3.5, 7, 10.5].map(a => ({ a: s * a, w: 1.6, b: 1.0, t: 2.4 })), cs);
    fwall(kit, G, -6.85, a0, a1, 3.4, 3.4, [], c);
  }
  for (const [x, z] of [[-6.7, -0.3], [6.7, -0.3], [-6.7, -13.7], [6.7, -13.7]]) fbox(kit, F, x, 3.4, z, 0.6, 6.8, 0.6, 0xb1a590);
  for (let k = 0; k < 4; k++) fbox(kit, F, kit.range(-5, 5), 0.4, kit.range(-3.2, -1.6), 1.5, 0.75, 0.75, kit.pick(COL.furniture), { ry: kit.range(-0.4, 0.4), k: DET });   // desks slid to the low side
  addLoot(L, kit, 'crate', 41.5, 0, 55.2, Math.PI, 'red');
  take(28.5, 37.5, 43.5, 53);
}

// the crown of the tower: floors crushed flat on each other, its mast lying across the plaza
function pieceCrown(L, kit, take) {
  const x = 52, z = -12;
  let y = 0;
  for (let k = 0; k < 4; k++) {
    y += k ? kit.range(0.35, 0.8) : 0;
    kit.cbox(x + kit.range(-0.8, 0.8), y + 0.18, z + kit.range(-0.8, 0.8), 12 - k * 0.7, 0.36, 12 - k * 0.5, COL.slab,
      { rx: kit.range(-0.05, 0.05), rz: kit.range(-0.05, 0.05), ry: kit.range(-0.12, 0.12), top: 0x7d7264 });
    if (k < 3) for (let q = 0; q < 5; q++) kit.cbox(x + kit.range(-4.5, 4.5), y + 0.5, z + kit.range(-4.5, 4.5), 0.5, 0.45, 0.5, COL.tower, { ry: kit.range(0, 1.5), col: false, k: DET });
    y += 0.36;
  }
  kit.box(x - 2, y, z + 1.5, 1.8, 1.3, 1.2, COL.metal[0]);                           // what stood on the roof
  P.waterTank(kit, x + 2.5, y, z - 2, true);
  const mp0 = { x: 61, y: 0.25, z: -38 }, mp1 = { x: 56, y: y - 0.1, z: -18.5 }, MF = rampFrame(mp0, mp1);
  fbox(kit, MF, 0, -0.3, MF.len / 2, 0.6, 0.6, MF.len, COL.metal[1]);              // the mast
  for (let s = 1; s < MF.len - 0.5; s += 1.4) fbox(kit, MF, 0, -0.3, s, 1.4, 0.08, 0.08, COL.metal[2], { ry: 0.7, col: false, k: DET });
  addLoot(L, kit, 'cache', x - 7.6, 0, z + 2, -Math.PI / 2, 'red');
  crystalsAround(L, kit, x - 7.6, 0, z + 2, 1.6, 7);
  take(44.5, -19, 59.5, -5);
  take(54.5, -39, 62.5, -17);
}

// =====================================================================================================
// The highway: the evacuation that never got out
// =====================================================================================================
// The deck along z = 140, 7.2 m up, broken between x 14 and 56 (the collapsed slab is the way up). Every lane is
// jammed eastbound, bumper to bumper in stretches (crashes, a burnt-out stretch, buses and lorries, two jack-knifed
// lorries, an army convoy near the east end); a line down the middle always stays wide enough to walk. Two
// off-ramps: west, down to the street at x = XS[2]; east, broken off in mid-air over the street at x = XS[7],
// with a bus hanging over the edge and the fallen piece below it a way up.
export const HWY = {
  z: 140, y: 7.2, w: 16, gap: [14, 56], end: 300, foot: 360,
  west: { x: XS[2], z0: 148, z1: 194, w: 8 },
  east: { x: XS[7], z0: 132, z1: 110, w: 8, fallen: 94 },
};
export function highway(L, kit) {
  const { z, y, w, gap, end, foot } = HWY, t = 1.0, R = kit.R, Wr = HWY.west, Er = HWY.east;
  const slope = y / (Wr.z1 - Wr.z0);
  const joins = [{ side: 1, x0: Wr.x - Wr.w / 2 - 0.4, x1: Wr.x + Wr.w / 2 + 0.4 }, { side: -1, x0: Er.x - Er.w / 2 - 0.4, x1: Er.x + Er.w / 2 + 0.4 }];
  const barrier = (xa, xb, side) => {                    // along an edge, open where an off-ramp leaves
    let pieces = [[xa, xb]];
    for (const j of joins) if (j.side === side) pieces = pieces.flatMap(([a, b]) => j.x1 <= a || j.x0 >= b ? [[a, b]] : [[a, j.x0], [j.x1, b]].filter(([p, q]) => q - p > 0.5));
    for (const [a, b] of pieces) kit.box((a + b) / 2, y, z + side * (w / 2 - 0.3), b - a, 0.9, 0.5, COL.barrier);
  };
  const deck = (xa, xb) => {
    for (let x = xa; x < xb - 0.01; x += 32) {
      const len = Math.min(32, xb - x);
      kit.box(x + len / 2, y - t, z, len, t, w, COL.slab, { top: COL.asphalt });
      for (const side of [-1, 1]) if (R() > 0.12) barrier(x, x + len - kit.range(0, 2), side);
    }
  };
  deck(-end, gap[0]);
  deck(gap[1], end);
  kit.ramp({ x: -foot, y: 0, z }, { x: -end, y, z }, w - 2, t, COL.slab, { top: COL.asphalt });
  kit.ramp({ x: foot, y: 0, z }, { x: end, y, z }, w - 2, t, COL.slab, { top: COL.asphalt });
  kit.ramp({ x: gap[0] + 8, y: 0, z: z + 0.8 }, { x: gap[1], y, z }, w - 3, t, COL.slab, { top: COL.asphalt });   // the collapsed section: the way up
  for (let k = 0; k < 4; k++) kit.rubble(kit.range(gap[0] - 8, gap[0] - 2), z + kit.range(-6, 6), kit.range(2, 3.5), 4);
  for (let k = 0; k < 3; k++) kit.rubble(kit.range(gap[0] + 10, gap[1] - 6), z + (k % 2 ? 1 : -1) * kit.range(8.5, 10), kit.range(2, 3.5), 4);
  for (const dz of [-4.5, 4.5]) kit.box(gap[0] - 2, y, z + dz, 0.6, 0.9, 3, COL.barrier);                        // warning: the deck ends
  for (let x = -end + 12; x < end - 6; x += 26) {                                     // pillars, never on a crossing street
    if (x > gap[0] - 4 && x < gap[1] + 4) continue;
    if (XS.some((sx, i) => Math.abs(x - sx) < WX[i] / 2 + 3)) continue;
    kit.box(x, 0, z, 2.4, y - t, 2.4, COL.slab);
  }
  for (const gx of [-262, 118, 240]) {                                                // sign gantries
    for (const s of [-1, 1]) kit.box(gx, y, z + s * (w / 2 - 0.6), 0.5, 6.5, 0.5, COL.metal[1]);
    kit.box(gx, y + 6, z, 0.5, 0.5, w - 0.6, COL.metal[1], { col: false });
    kit.box(gx, y + 4.8, z - 2, 0.2, 1.8, 5.5, 0x2f5a3c, { col: false });
  }

  // ---- the off-ramps ----
  const wp0 = { x: Wr.x, y: 0, z: Wr.z1 }, wp1 = { x: Wr.x, y, z: Wr.z0 };
  kit.ramp(wp0, wp1, Wr.w, 0.8, COL.slab, { top: COL.asphalt });
  const WF = rampFrame(wp0, wp1);
  for (const s of [-1, 1]) fbox(kit, WF, s * (Wr.w / 2 - 0.25), 0.45, WF.len / 2, 0.5, 0.9, WF.len - 0.6, COL.barrier);
  for (const pz of [160, 176]) kit.box(Wr.x, 0, pz, 1.8, y - (pz - Wr.z0) * slope - 0.8, 1.8, COL.slab);
  kit.box(Wr.x - 3, y + 3.2, Wr.z0 - 2.5, 3.2, 1.4, 0.2, 0x2f5a3c, { col: false });   // an exit sign over the lane
  kit.box(Wr.x - 3, y, Wr.z0 - 2.5, 0.2, 3.2, 0.2, COL.metal[1], { col: false });
  const endY = y - (Er.z0 - Er.z1) * slope, ep0 = { x: Er.x, y: endY, z: Er.z1 }, ep1 = { x: Er.x, y, z: Er.z0 };
  kit.ramp(ep0, ep1, Er.w, 0.8, COL.slab, { top: COL.asphalt });
  const EF = rampFrame(ep0, ep1);
  for (const s of [-1, 1]) fbox(kit, EF, s * (Er.w / 2 - 0.25), 0.45, EF.len / 2 + 1.2, 0.5, 0.9, EF.len - 2.4, COL.barrier);
  kit.box(Er.x, 0, 124, 1.8, y - (Er.z0 - 124) * slope - 0.8, 1.8, COL.slab);
  for (let k = 0; k < 6; k++) fbox(kit, EF, kit.range(-3.6, 3.6), -0.45, kit.range(-0.3, 0.5), kit.range(0.6, 1.4), 0.4, kit.range(0.5, 1.2), COL.slab, { rx: kit.range(-0.6, 0.6), col: false, k: DET });
  for (let k = 0; k < 6; k++) { const p = apply(EF.M, kit.range(-3.6, 3.6), -0.35, 0.1); kit.rebar(EF.o.x + p.x, EF.o.y + p.y, EF.o.z + p.z, 2); }
  kit.ramp({ x: Er.x + 0.4, y: 0, z: Er.fallen }, { x: Er.x + 0.2, y: endY - 0.08, z: Er.z1 + 0.6 }, Er.w - 1.5, 0.7, COL.slab, { top: COL.asphalt });   // the piece that fell: a way up
  fbox(kit, EF, 1.1, 0.35 + 1.375, 2.0, 2.5, 2.75, 11.6, kit.pick(P.PC.bus), { ry: Math.PI });                   // a bus over the edge
  fbox(kit, EF, 1.1, 0.35 + 1.9, 2.0, 2.54, 0.85, 10.2, P.PC.glass, { ry: Math.PI, col: false });
  for (let k = 0; k < 5; k++) kit.rubble(Er.x + (k % 2 ? 1 : -1) * kit.range(6, 9), kit.range(Er.fallen - 3, Er.z1 + 4), kit.range(1.6, 2.6), 3);   // beside it, not on the way up
  L.signs.push({ title: 'Off-ramp', sub: 'Up to the highway.\nJammed all the way east.', x: Wr.x + 5.2, y: 2.2, z: Wr.z1 + 4, ry: 0 });

  // ---- the jam ----
  const lanes = [-5.3, -1.8, 1.8, 5.3];
  const used = [];
  const free = r => used.every(q => r.x1 < q.x0 || r.x0 > q.x1 || r.z1 < q.z0 || r.z0 > q.z1);
  const claim = (x, zz, wd, ln, yaw) => { const r = P.footprint(x, zz, wd, ln, yaw); if (!free(r)) return false; used.push(r); return true; };
  // the convoy that tried to stop it, near the east end, and two lorries that jack-knifed across the south lanes
  const ARMY = [236, 276];
  for (const [x, lz, what] of [[240, 1.8, 'truck'], [254, 5.3, 'truck'], [264, -1.8, 'apc'], [248, -5.3, 'truck']]) {
    const zz = z + lz + Math.sign(lz) * 0.3;
    if (!claim(x, zz, 2.6, 8.4, Math.PI / 2)) continue;
    if (what === 'apc') P.apc(kit, x, zz, Math.PI / 2, { burnt: false, y }); else P.truck(kit, x, zz, Math.PI / 2, { military: true, y });
  }
  for (const dz of [-6.4, -3.6]) { P.jersey(kit, ARMY[1] - 1, z + dz, 0, y); used.push({ x0: ARMY[1] - 1.4, x1: ARMY[1] - 0.6, z0: z + dz - 1.6, z1: z + dz + 1.6 }); }
  P.sandbags(kit, 246, z + 3.6, Math.PI / 2, 4, 2, y); used.push({ x0: 245.4, x1: 246.6, z0: z + 1.8, z1: z + 5.4 });
  addLoot(L, kit, 'case', 258, y, z + 3.9, -Math.PI / 2, 'outer'); used.push({ x0: 256, x1: 259, z0: z + 2.6, z1: z + 5.2 });
  addLoot(L, kit, 'military', 232, y, z - 3.9, Math.PI / 2, 'outer'); used.push({ x0: 231, x1: 234, z0: z - 5.2, z1: z - 2.6 });
  for (const jx of [kit.range(-205, -178), kit.range(170, 205)]) {                    // (clear of the west off-ramp, which joins at x -228)
    kit.cbox(jx, y + 1.9, z + 4.4, 2.5, 3.0, 11, 0x6a6e73, { ry: Math.PI / 2 + 0.2 });            // the trailer
    kit.cbox(jx + 6.6, y + 1.4, z + 2.9, 2.4, 2.4, 3, kit.pick(COL.rust), { ry: Math.PI / 2 - 0.9 });   // its cab, turned in
    used.push({ x0: jx - 6.5, x1: jx + 8.4, z0: z + 1.0, z1: z + 7.7 });
  }
  // a car that went over the broken west edge and hangs there
  const hang = { o: { x: gap[0], y, z: z + 1.8 }, M: rot(Math.PI / 2, 0.42, 0) };
  fbox(kit, hang, 0, 0.62, 0.35, 1.8, 0.78, 4.4, kit.pick(P.PC.car));
  fbox(kit, hang, 0, 1.3, 0.15, 1.55, 0.58, 2.2, P.PC.glass);
  used.push({ x0: gap[0] - 2.5, x1: gap[0] + 0.2, z0: z + 0.6, z1: z + 3.0 });
  const KINDS = [['sedan', 30], ['hatch', 20], ['van', 12], ['pickup', 10], ['taxi', 6], ['police', 3]];
  const pickKind = () => { let s = 0; for (const k of KINDS) s += k[1]; let r = R() * s; for (const [k, wgt] of KINDS) { r -= wgt; if (r <= 0) return k; } return 'sedan'; };
  const spans = [[-end + 12, gap[0] - 4], [gap[1] + 5, end - 12]];
  let wrecks = 0;
  for (const lz of lanes) {
    const inner = Math.abs(lz) < 3;
    for (const [a, b] of spans) {
      let x = a + kit.range(0, 5), dense = R() < 0.65, left = kit.range(25, 75);
      while (x < b) {
        if (left <= 0) { dense = !dense; left = dense ? kit.range(30, 80) : kit.range(12, 35); }
        const r = R(), big = inner ? null : r < 0.035 ? 'bus' : r < 0.08 ? 'truck' : null;     // (long ones only in the outer lanes)
        const kind = big ? null : pickKind(), len = big === 'bus' ? 11.6 : big === 'truck' ? 8.2 : P.CAR[kind].len;
        const cxp = x + len / 2;
        if (cxp + len / 2 > b) break;
        if (!dense && R() < 0.55) { const skip = kit.range(5, 14); x += skip; left -= skip; continue; }
        // the inner lanes only ever drift outwards, so the line down the middle stays open
        const zz = z + lz + (inner ? Math.sign(lz) * kit.range(0, 0.45) : kit.range(-0.4, 0.4));
        const crash = !inner && !big && R() < 0.08;
        const yaw = Math.PI / 2 + (crash ? (R() < 0.5 ? -1 : 1) * kit.range(0.35, 0.8) : kit.range(-1, 1) * (inner ? 0.04 : 0.1));
        const burnt = (cxp > -165 && cxp < -105) || R() < 0.12;
        const wd = big ? 2.6 : (P.CAR[kind].w + 0.1);
        // the convoy's stretch; the outer lane where an off-ramp joins (you can get from the ramp onto the deck)
        const junction = (lz > 3 && Math.abs(cxp - Wr.x) < Wr.w / 2 + 5) || (lz < -3 && Math.abs(cxp - Er.x) < Er.w / 2 + 5);
        if ((cxp > ARMY[0] - 6 && cxp < ARMY[1] + 2) || junction) { x += len + 1; left -= len + 1; continue; }
        if (claim(cxp, zz, wd, len + 0.3, yaw)) {
          if (big === 'bus') P.bus(kit, cxp, zz, yaw, { burnt, y });
          else if (big === 'truck') P.truck(kit, cxp, zz, yaw, { burnt, y });
          else {
            const flipped = !burnt && R() < 0.03;
            const boot = P.car(kit, cxp, zz, yaw, { kind, burnt, flipped, y });
            if (boot && !burnt && R() < 0.1) L.containers.push({ type: 'car', x: boot.x, y, z: boot.z, ry: yaw, zone: 'outer' });
          }
          wrecks++;
        }
        const step = len + (dense ? kit.range(0.5, 1.8) : kit.range(3, 12));
        x += step; left -= step;
      }
    }
  }
  L.props.push({ t: 'jam', x: 0, z, n: wrecks });
  L.signs.push({ title: 'Highway', sub: 'Up the collapsed slab, or\nthe off-ramp at x -228.', x: gap[0] + 10, y: 2.2, z: z + 12, ry: Math.PI });
}

// =====================================================================================================
// The Underground Base
// =====================================================================================================
// A ramp in the middle of an industrial block goes down 6.8 m to a guard post; behind it the vehicle bay, and
// round it a loop of corridors to the barracks, the mess, the med bay, the generator room, the command room, the
// armoury, the stores and, deepest of all, the room the Prism took (crystals everywhere: their nest). From the med
// bay a straight escape stair goes back up to a hatch house in the yard, so the base is no dead end.
const BX = 263, BZ = -236, BF = -6.8;
export const BUNKER = {
  x0: BX - 36, z0: BZ - 78, x1: BX + 36, z1: BZ, floor: BF,
  ramp: { x0: BX - 4, x1: BX + 4, z0: BZ - 20, z1: BZ }, hall: { x: BX, z: BZ - 38 },
  exit: { x0: BX + 24.2, x1: BX + 26.2, z0: BZ - 25.85, z1: BZ - 14.9, bottom: { x: BX + 25.2, z: BZ - 27.5 }, top: { x: BX + 25.2, z: BZ - 13.4 } },
};
export { BX, BZ };
// the rooms: [u0, v0, u1, v1] round (BX, BZ) (u east, v south; the base lies north of the ramp, v < 0)
const ROOMS = {
  check: [-10, -28, 10, -20], hall: [-16, -48, 16, -28], wcor: [-20, -52, -16, -28], ecor: [16, -52, 20, -28], ncor: [-16, -52, 16, -48],
  barr: [-34, -40, -20, -26], mess: [-34, -56, -20, -42], med: [20, -40, 34, -26], gen: [20, -58, 34, -42],
  cmd: [-16, -64, -2, -52], arm: [2, -64, 16, -52], nest: [-16, -76, 16, -64], store: [-34, -70, -20, -56], pass: [-20, -70, -16, -64],
};
// the doorways between them: [room, side, where along the wall, width]; every doorway is listed for both rooms
const DOORS = [
  ['check', 's', 0, 8], ['check', 'n', 0, 4], ['hall', 's', 0, 4],
  ['hall', 'w', -38, 2.4], ['wcor', 'e', -38, 2.4], ['hall', 'e', -38, 2.4], ['ecor', 'w', -38, 2.4],
  ['hall', 'n', 0, 3], ['ncor', 's', 0, 3],
  ['wcor', 'e', -50, 3.4], ['ncor', 'w', -50, 3.4], ['ecor', 'w', -50, 3.4], ['ncor', 'e', -50, 3.4],
  ['wcor', 'w', -33, 1.8], ['barr', 'e', -33, 1.8], ['wcor', 'w', -46, 1.8], ['mess', 'e', -46, 1.8],
  ['ecor', 'e', -33, 1.8], ['med', 'w', -33, 1.8], ['ecor', 'e', -46, 1.8], ['gen', 'w', -46, 1.8],
  ['ncor', 'n', -9, 1.8], ['cmd', 's', -9, 1.8], ['ncor', 'n', 9, 1.8], ['arm', 's', 9, 1.8],
  ['cmd', 'n', -9, 1.8], ['nest', 's', -9, 1.8], ['arm', 'n', 9, 1.8], ['nest', 's', 9, 1.8],
  ['mess', 'n', -27, 1.8], ['store', 's', -27, 1.8], ['store', 'e', -67, 1.8], ['pass', 'w', -67, 1.8], ['pass', 'e', -67, 1.8], ['nest', 'w', -67, 1.8],
  ['med', 's', 25.2, 1.6],
];

export function bunker(L, kit) {
  const B = BUNKER, F = BF, WH = 5, rp = B.ramp, R = kit.R;
  const c = 0x8c8478, cw = 0x6f685e, ceil = 0x4f4a44, fl = 0x5f5a53;
  const ux = u => BX + u, vz = v => BZ + v;
  L.holes.push({ x0: rp.x0, z0: rp.z0, x1: rp.x1, z1: rp.z1 });
  L.dark.push({ x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1 });
  // the ramp down, in a cut with concrete sides, under a blockhouse open to the street in the south
  kit.ramp({ x: BX, y: F, z: rp.z0 }, { x: BX, y: 0, z: rp.z1 }, rp.x1 - rp.x0, 0.6, 0x77706a);
  kit.box(rp.x0 - 0.15, F, (rp.z0 + rp.z1) / 2, 0.3, -F - 0.02, rp.z1 - rp.z0, cw);       // (tops just under the ground: no flicker)
  kit.box(rp.x1 + 0.15, F, (rp.z0 + rp.z1) / 2, 0.3, -F - 0.02, rp.z1 - rp.z0, cw);
  kit.wall('z', rp.x0 - 1.2, rp.z1 - 8, rp.z1 + 1.5, 0, 3.4, [], 0x9a8f80, { t: 0.6 });
  kit.wall('z', rp.x1 + 1.2, rp.z1 - 8, rp.z1 + 1.5, 0, 3.4, [], 0x9a8f80, { t: 0.6 });
  kit.box(BX, 3.4, rp.z1 - 3.25, rp.x1 - rp.x0 + 3, 0.5, 9.5, 0x8a8072);
  kit.box(BX, 2.6, rp.z1 + 1.45, rp.x1 - rp.x0 + 2.4, 0.8, 0.3, 0x2b2a28, { col: false });
  for (const x of [rp.x0 - 0.7, rp.x1 + 0.7]) kit.box(x, 2.2, rp.z1 + 1.6, 0.3, 0.3, 0.1, COL.lamp, { k: K.GLOW, col: false });
  L.doors.push({ x: BX, z: rp.z1 + 1.5, nx: 0, nz: 1, w: rp.x1 - rp.x0 + 2, open: true });
  crystalsAround(L, kit, rp.x0 - 2.5, 0, rp.z1 + 1.2, 1.0, 5);
  L.signs.push({ title: 'Underground Base', sub: 'Dark inside. Use your light (F).\nScatter nests. A way out north-east.', x: BX - 6, y: 2.0, z: rp.z1 + 2.2, ry: 0 });
  // one floor under everything
  kit.slab(B.x0, B.z0, B.x1, rp.z0 + 0.05, F, fl, null, { thick: 0.4 });

  // ---- the rooms: walls just inside each room's edge (two rooms side by side make a thick wall), doorways ----
  for (const [name, [u0, v0, u1, v1]] of Object.entries(ROOMS)) {
    const ops = s => DOORS.filter(d => d[0] === name && d[1] === s).map(d => ({ a: s === 'n' || s === 's' ? ux(d[2]) : vz(d[2]), w: d[3], b: 0, t: name === 'check' && s === 's' ? WH : 3 }));
    kit.wall('x', vz(v0) + 0.15, ux(u0), ux(u1), F, WH, ops('n'), c);
    kit.wall('x', vz(v1) - 0.15, ux(u0), ux(u1), F, WH, ops('s'), c);
    kit.wall('z', ux(u0) + 0.15, vz(v0) + 0.3, vz(v1) - 0.3, F, WH, ops('w'), c);
    kit.wall('z', ux(u1) - 0.15, vz(v0) + 0.3, vz(v1) - 0.3, F, WH, ops('e'), c);
    kit.box(ux((u0 + u1) / 2), F + WH, vz((v0 + v1) / 2), u1 - u0, 0.25, v1 - v0, ceil, { col: false });      // its ceiling
    const lamps = Math.max(1, Math.round((u1 - u0) / 9));
    for (let k = 0; k < lamps; k++) if (R() < 0.75) kit.box(ux(u0 + (k + 0.5) * (u1 - u0) / lamps), F + 3.6, vz(v0) + 0.32, 0.9, 0.18, 0.06, R() < 0.4 ? COL.red : COL.lamp, { k: K.GLOW, col: false });
  }
  L.interiors.push({ x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1, y0: F, y1: F + WH });

  // ---- what is in them ----
  const lr = (type, u, v, ry) => addLoot(L, kit, type, ux(u), F, vz(v), ry, 'yellow');
  const crate = (u, v, s = 1.2) => kit.box(ux(u), F, vz(v), s, s, s, kit.pick(COL.rust));
  const E = -Math.PI / 2, W = Math.PI / 2, N = Math.PI, S = 0;                          // facing west, east, north, south
  // the guard post: sandbags either side of the way in, a booth, a wrecked turret
  P.sandbags(kit, ux(-6.5), vz(-23.5), 0, 4, 2, F); P.sandbags(kit, ux(6.5), vz(-23.5), 0, 4, 2, F);
  P.booth(kit, ux(-7.6), vz(-26.4), 0, F);
  kit.box(ux(7.5), F, vz(-26.3), 1.6, 1.2, 1.6, 0x4d5157);
  kit.cbox(ux(7.5), F + 1.5, vz(-25.6), 0.18, 0.18, 2.2, 0x2b2a28, { rx: -0.2, col: false, k: DET });
  lr('military', 8.9, -22.3, E);
  // the vehicle bay: pillars, an armoured car and a lorry, crates to hide behind, a crane rail
  for (const [u, v] of [[-8, -34], [8, -34], [-8, -42], [8, -42]]) kit.box(ux(u), F, vz(v), 0.9, WH, 0.9, cw);
  P.apc(kit, ux(-4.2), vz(-40.5), 0.3, { burnt: false, y: F });
  P.truck(kit, ux(7.5), vz(-45.2), Math.PI / 2, { military: true, y: F });
  for (const [u, v] of [[-13.5, -31], [-12.8, -44.5], [12.5, -30.5], [13.6, -40.5], [3.2, -36], [-1.5, -45.5]]) crate(u, v);
  kit.box(ux(0), F + 4.55, vz(-38), 32, 0.25, 0.3, COL.metal[0], { col: false, k: DET });
  lr('crate', -14.8, -46.6, S);
  // barracks: bunks along the walls, lockers
  for (let k = 0; k < 4; k++) for (const v of [-38.6, -27.4]) {
    const u = -31.5 + k * 3.2;
    kit.box(ux(u), F, vz(v), 2.0, 0.5, 0.9, 0x55534c, { k: DET });
    kit.box(ux(u), F + 1.3, vz(v), 2.0, 0.15, 0.9, 0x55534c, { col: false, k: DET });
    for (const du of [-0.95, 0.95]) kit.box(ux(u + du), F, vz(v), 0.08, 1.6, 0.08, 0x3d3a35, { col: false, k: DET });
  }
  lr('locker', -33.43, -30.5, W); lr('locker', -33.43, -35.5, W);
  for (const v of [-32.9, -33.6]) kit.box(ux(-33.45), F, vz(v), 0.5, 1.9, 0.6, COL.locker, { k: DET });
  // the mess: long tables, a counter, a crate; Scatters nest under the tables
  for (const v of [-46.5, -51.5]) { kit.box(ux(-26.5), F, vz(v), 7, 0.75, 1.0, 0x6b5a46, { k: DET }); for (const dv of [-0.85, 0.85]) kit.box(ux(-26.5), F, vz(v + dv), 6.6, 0.45, 0.32, 0x5d4c3c, { col: false, k: DET }); }
  kit.box(ux(-33), F, vz(-49), 1.0, 1.0, 6, 0x6b5a46, { k: DET });
  lr('crate', -21.2, -54.8, E);
  L.nestSpots.push({ x: ux(-23), y: F + 0.1, z: vz(-44.2), zone: 'yellow', bunker: true });
  // the med bay: beds, cabinets on the east wall
  for (let k = 0; k < 4; k++) kit.box(ux(22.5 + k * 3), F, vz(-38.4), 1.0, 0.6, 2.1, 0xc9c4b8, { k: DET });
  lr('medcab', 33.53, -30, E); lr('medcab', 33.53, -35, E);
  // the generator room: two big machines, pipes, workbenches; another nest
  kit.box(ux(25), F, vz(-52), 3.6, 2.4, 2.2, 0x5b5f66); kit.box(ux(30.5), F, vz(-52), 3.6, 2.4, 2.2, 0x4d5157);
  kit.box(ux(27.75), F + 3.4, vz(-52), 11, 0.3, 0.3, COL.metal[2], { col: false, k: DET });
  lr('toolbox', 33.38, -45, E); lr('toolbox', 21.2, -56.4, S);
  L.nestSpots.push({ x: ux(27.5), y: F + 0.1, z: vz(-47.5), zone: 'yellow', bunker: true });
  // the command room: consoles with screens still glowing, a map table
  for (const u of [-13.9, -4.6]) {                                                       // (clear of the doorway north, at u -9)
    kit.box(ux(u), F, vz(-63.1), 3.0, 1.0, 0.9, 0x3d4045, { k: DET });
    kit.cbox(ux(u), F + 1.4, vz(-63.3), 1.4, 0.8, 0.06, R() < 0.6 ? 0x5fd4a0 : 0x2b3f5a, { k: K.GLOW, col: false });
  }
  kit.box(ux(-9), F, vz(-57), 3.4, 0.9, 2.2, 0x4f4a44, { k: DET });
  kit.box(ux(-9), F + 0.9, vz(-57), 3.2, 0.03, 2.0, 0x3f6a5a, { k: K.GLOW, col: false });
  lr('case', -15.37, -56, W); lr('safe', -2.72, -58.5, E);
  // the armoury: racks, cases, a crate
  for (const u of [4.3, 13.6]) kit.box(ux(u), F, vz(-63.2), 2.4, 2.0, 0.5, 0x3a3d40, { k: DET });   // (clear of the doorway north, at u 9)
  lr('case', 15.33, -56, E); lr('case', 15.33, -59.5, E); lr('military', 2.9, -54.5, W);
  // the nest: the Prism took this room; crystals everywhere, two caches
  lr('cache', -6, -74.2, S); lr('cache', 7, -74.2, S);
  crystalsAround(L, kit, ux(0), F, vz(-70), 9, 40);
  crystalsAround(L, kit, ux(-12), F, vz(-67), 2.5, 8);
  L.nestSpots.push({ x: ux(-4), y: F + 0.1, z: vz(-69), zone: 'yellow', bunker: true }, { x: ux(9), y: F + 0.1, z: vz(-68), zone: 'yellow', bunker: true });
  // the stores: shelves, crates; the passage broken through to the nest
  for (let k = 0; k < 3; k++) kit.box(ux(-31 + k * 3.6), F, vz(-68.6), 2.6, 2.2, 0.8, 0x6b5a46, { k: DET });
  lr('crate', -33.25, -60, W); lr('crate', -21.2, -60.5, E);
  crate(-30, -62.2); crate(-28.6, -62.4, 0.9);
  kit.rubble(ux(-18), vz(-65), 0.9, 3, F);

  // ---- the escape stair: straight up from the med bay to a hatch house in the yard ----
  const X = B.exit, sx = BX + 25.2;
  L.holes.push({ x0: X.x0, z0: X.z0, x1: X.x1, z1: X.z1 });
  kit.wall('z', X.x0 - 0.15, X.z0, X.z1 + 0.15, F, -F - 0.02, [], cw);
  kit.wall('z', X.x1 + 0.15, X.z0, X.z1 + 0.15, F, -F - 0.02, [], cw);
  kit.box(sx, F, X.z1 + 0.15, X.x1 - X.x0 + 0.6, -F - 0.02, 0.3, cw);
  kit.steps('z', sx, vz(-25.5), 1, F, SW, STEPS, 0x77706a);
  kit.box(sx, F, vz(-20.1), X.x1 - X.x0, -F - STEPS * RISE, 1.2, cw, { top: 0x77706a });       // the landing halfway
  kit.steps('z', sx, vz(-19.5), 1, F + STEPS * RISE, SW, STEPS, 0x77706a);
  kit.box(sx, F + 3.6, vz(-26.6), 0.6, 0.15, 0.06, COL.lamp, { k: K.GLOW, col: false });
  // the hatch house over it
  const hx0 = X.x0 - 0.9, hx1 = X.x1 + 0.9, hz0 = X.z0 - 0.7, hz1 = vz(-12);
  kit.wall('z', hx0 + 0.15, hz0, hz1, 0, 3, [], 0x9a8f80);
  kit.wall('z', hx1 - 0.15, hz0, hz1, 0, 3, [], 0x9a8f80);
  kit.wall('x', hz0 + 0.15, hx0 + 0.3, hx1 - 0.3, 0, 3, [], 0x9a8f80);
  kit.wall('x', hz1 - 0.15, hx0 + 0.3, hx1 - 0.3, 0, 3, [{ a: sx, w: 1.6, b: 0, t: 2.3 }], 0x9a8f80);
  kit.box((hx0 + hx1) / 2, 3, (hz0 + hz1) / 2, hx1 - hx0 + 0.4, 0.3, hz1 - hz0 + 0.4, 0x8a8072);
  kit.box(sx, 2.55, hz1 + 0.05, 0.4, 0.15, 0.08, COL.green, { k: K.GLOW, col: false });
  L.doors.push({ x: sx, z: hz1, nx: 0, nz: 1, w: 1.6, open: true });
  L.signs.push({ title: 'Emergency exit', sub: 'Stairs down to the base.', x: sx + 2.2, y: 2.0, z: hz1 + 0.6, ry: 0 });
}

// up top: the block round the blockhouse and the hatch house (container stacks, an office, a fence)
export function baseYard(L, kit, In) {
  const R = kit.R;
  L.yards.push({ ...In, kind: 'industrial' });
  containerStack(kit, BX + 20, BZ - 34, 0, 2); containerStack(kit, BX - 21, BZ - 30, Math.PI / 2, 1); containerStack(kit, BX + 14, BZ - 11, Math.PI / 2, 3);
  containerStack(kit, BX + 12, BZ - 50, 0, 1); containerStack(kit, BX - 14, BZ - 20, 0, 2);
  building(L, kit, { x0: In.x0 + 0.5, z0: In.z0 + 0.5, x1: In.x0 + 12.5, z1: In.z0 + 10.5, floors: 2, open: 2, front: 'e', style: 'industrial', zone: 'yellow', damage: 0.6, roof: R() < 0.5 });
  addLoot(L, kit, 'crate', BX + 9, 0, BZ - 6, Math.PI / 2, 'yellow');
  kit.wall('x', In.z0 + 0.3, In.x0 + 15, In.x1 - 1, 0, 1.4, [{ a: BX + 4, w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
  kit.wall('z', In.x1 - 0.3, In.z0 + 1, In.z1 - 1, 0, 1.4, [{ a: BZ - 30, w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
}

// =====================================================================================================
// The Pod Crater
// =====================================================================================================
// A real bowl in the ground: 7 m deep in the middle, rising to a lip 1.5 m high at the rim (55 m out), back down to
// the street 6 m further out. Upturned slabs of the old streets stand round the rim (the streets still come in
// where they were). The pod lies tilted at the bottom, sunk in, one face torn away: inside, its core glows over a
// Prism cache. Crystals grow out from it in lines; pieces of its shell lie about; cars were thrown out past the rim.
// way: the way in that stays clear of the debris (5d: random walls and heaps had blocked it), from the street in the
// north, down into the bowl, round the east of the pod and in at its torn face to the core
export const CRATER = { x: -215, z: -215, r: 55, depth: 7, lip: 1.5, lipW: 6, way: [[-228, -290], [-228, -246], [-200, -236], [-196, -203], [-209, -207.5], [-213, -209.6]] };
const onWay = (x, z, m) => CRATER.way.some((b, i) => {
  if (!i) return false;
  const a = CRATER.way[i - 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) < 2.5 + m;
});
// the height of the ground in and round the crater (0 further out)
export function craterY(x, z) {
  const C = CRATER, r = Math.hypot(x - C.x, z - C.z);
  if (r <= C.r) return -C.depth + (C.depth + C.lip) * (r / C.r) * (r / C.r);
  if (r < C.r + C.lipW) { const k = 1 - (r - C.r) / C.lipW; return C.lip * k * k; }
  return 0;
}
export function crater(L, kit) {
  const C = CRATER, R = kit.R, S = C.r + C.lipW + 1;
  L.holes.push({ x0: C.x - S, z0: C.z - S, x1: C.x + S, z1: C.z + S, bowl: true });
  L.bowls.push({ x0: C.x - S, z0: C.z - S, x1: C.x + S, z1: C.z + S, cell: 2 });
  // the pod: a four-sided Prism pod (a pyramid), 22 m tall, sunk 3 m and tilted back, the face toward the south-east torn away
  const px = C.x - 2, pz = C.z + 2, py = craterY(px, pz);
  const pod = { x: px, y: py, z: pz, s: 10, h: 22, sink: 3, tilt: 0.3, ry: Math.PI * 1.25, thetaStart: -Math.PI * 0.75, open: true };
  L.pods.push(pod);
  const PF = { o: { x: px, y: py, z: pz }, M: rot(pod.ry, pod.tilt, 0) };
  const phi = Math.atan2(0.7071 * pod.s, pod.h), slant = Math.hypot(pod.h, 0.7071 * pod.s);
  for (let k = 0; k < 3; k++) {                                                        // the three faces still there (for the physics)
    const tm = pod.thetaStart + k * Math.PI / 2 + Math.PI / 4, rr = 0.354 * pod.s;
    fbox(kit, PF, rr * Math.sin(tm), pod.h / 2 - pod.sink, rr * Math.cos(tm), pod.s * 1.4142, slant, 0.8, 0, { ry: tm, rx: -phi }).hide = true;
  }
  fbox(kit, PF, 0, 1.2, 0, 2.2, 3.0, 2.2, 0, {}).hide = true;                          // its core
  crystalsAround(L, kit, px, py, pz, 2.2, 18);
  const open = Math.PI / 4, ox = Math.sin(open), oz = Math.cos(open);                  // the torn face looks south-east
  addLoot(L, kit, 'cache', px + ox * 3.4, craterY(px + ox * 3.4, pz + oz * 3.4), pz + oz * 3.4, open, 'yellow');
  // the rim: slabs of the old streets turned up on the lip, leaning out (the streets come in through gaps)
  const gaps = [kit.range(0, Math.PI * 2), kit.range(0, Math.PI * 2)];
  for (let k = 0; k < 46; k++) {
    const a = k / 46 * Math.PI * 2 + kit.range(-0.03, 0.03), r = C.r + kit.range(-2.5, 2.0);
    const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    if (Math.abs(x - XS[2]) < WX[2] / 2 + 2.5 || Math.abs(z - ZS[2]) < WZ[2] / 2 + 2.5) continue;
    if (gaps.some(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.13)) continue;
    const w = kit.range(3, 6), len = kit.range(3, 6), tilt = kit.range(0.5, 1.1), yaw = Math.atan2(Math.cos(a), Math.sin(a));
    const by = craterY(x, z) - 0.3;
    kit.cbox(x + Math.cos(a) * Math.sin(tilt) * len / 2, by + Math.cos(tilt) * len / 2, z + Math.sin(a) * Math.sin(tilt) * len / 2,
      w, len, kit.range(0.35, 0.55), kit.pick([COL.asphalt, 0x8f8676, 0xa49c8e, COL.asphalt]), { ry: yaw, rx: tilt });
  }
  // crystals in lines out from the pod, pieces of its shell, heaps, a few walls that stood here
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + kit.range(-0.2, 0.2);
    for (let r = 9; r < 46; r += kit.range(3, 5)) crystalsAround(L, kit, px + Math.cos(a) * r, craterY, pz + Math.sin(a) * r, 0.9, 2);
  }
  // (none of it on the way in: CRATER.way)
  const shells = [];
  for (let k = 0; k < 12; k++) {
    const a = R() * Math.PI * 2, r = kit.range(11, 44), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r, s = kit.range(1.2, 4);
    if (onWay(x, z, s * 0.75)) continue;
    kit.cbox(x, craterY(x, z) + s * 0.12, z, s, s * 0.35, s * kit.range(0.6, 1.2), 0x1b1328, { rx: kit.range(-0.6, 0.6), ry: R() * Math.PI, rz: kit.range(-0.6, 0.6), col: s > 2 });
    shells.push({ x, z, s });
  }
  let caches = 0;
  for (const sh of shells.filter(q => q.s > 2.4)) {                                    // beside a big piece, facing down into the bowl
    const toC = Math.atan2(C.x - sh.x, C.z - sh.z), x = sh.x + Math.sin(toC) * (sh.s * 0.8 + 1.0), z = sh.z + Math.cos(toC) * (sh.s * 0.8 + 1.0);
    if (caches >= 2 || onWay(x, z, 0.8)) continue;
    addLoot(L, kit, 'cache', x, craterY(x, z), z, toC, 'yellow');
    caches++;
  }
  for (let k = 0; k < 8; k++) {
    const a = R() * Math.PI * 2, r = kit.range(14, 48), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r, s = kit.range(2.5, 4.5);
    if (!onWay(x, z, s * 1.1)) kit.rubble(x, z, s, 4, craterY(x, z));
  }
  for (let k = 0; k < 5; k++) {
    const a = R() * Math.PI * 2, r = kit.range(18, 40), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r, h = kit.range(1.5, 3.5);
    if (!onWay(x, z, 3.3)) kit.wall('x', z, x - 3, x + 3, craterY(x, z) - 0.4, h, [], kit.pick(COL.plaster), { jag: 0.8 });
  }
  // cars thrown out past the rim, on their roofs and burnt
  for (let k = 0, t = 0; k < 10 && t < 40; t++) {
    const a = R() * Math.PI * 2, r = kit.range(C.r + C.lipW + 1.5, C.r + 16), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    if (onWay(x, z, 3) || L.footprints.some(f => x > f.x0 - 3 && x < f.x1 + 3 && z > f.z0 - 3 && z < f.z1 + 3)) continue;
    const burnt = R() < 0.5;
    P.car(kit, x, z, R() * Math.PI * 2, { kind: kit.pick(['sedan', 'hatch', 'van', 'pickup']), burnt, flipped: !burnt && R() < 0.6 });
    if (burnt) L.decals.push({ kind: 'scorch', x, z, r: kit.range(2, 3) });
    L.props.push({ t: 'car', x, z });
    k++;
  }
  L.signs.push({ title: 'Pod Crater', sub: 'They landed here first.\nIts heart still glows.', x: C.x + 45.5, y: 2.2, z: C.z + 45.5, ry: Math.PI / 4 });
}
