// The buildings of The Ruins (boxes from kit.js). Every building is a grid of bays (about 4 m) by floors, and
// damage takes parts of it away: a collapsed corner, a sheared-off top, a split down its middle (cells), blown-out
// holes in the walls (wall bays), part of the roof, a fallen floor. What is left stands around it: broken wall
// stumps, torn slab edges with rebar, rubble on the floors and spilling into the street. Every building loses
// something; the red zone loses the most.
// The floors you can get into (`open`, from the ground up) have doors, windows you can see and shoot through, real
// stairs, rooms, furniture and loot. Above them, and in closed buildings, the walls have window panes and the
// inside is a gutted shell (you only see it where the walls are broken).
//
//   building(L, kit, b)   b = { x0, z0, x1, z1, floors, open (floors you can enter, 0 = closed), front: 'n'|'s'|'e'|'w',
//                               back?, blank: [sides against neighbours], shop, style, zone, damage (0..1), nest, rich,
//                               roof (stairs up to the roof), balconies, color?, sign? }
//   warehouse(L, kit, b), containerStack(kit, ...), stall(kit, ...)
import { FLOOR, WALL, SLAB, TREAD, STEPS, COL, containerLook } from './kit.js';

export const RUN = STEPS * TREAD;               // one flight of stairs: 4.8 m
const SW = 1.6;                                 // stair width
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

export const STYLES = {
  downtown:    { walls: [...COL.concrete, 0xc4b8a2, 0xb8ad9c, 0xa89d8a], trim: 0x7d7468, roof: 0x6e6860, floor: 0x8a8378 },
  residential: { walls: COL.plaster, trim: COL.trim, roof: COL.roof, floor: 0x8c7b64 },
  market:      { walls: [...COL.white, ...COL.ochre], trim: 0x9a8668, roof: 0x8b7c66, floor: 0x9a7f62 },
  industrial:  { walls: COL.concrete, trim: 0x6f685e, roof: 0x6a6660, floor: 0x77706a },
};

export function addLoot(L, kit, type, x, y, z, ry, zone) { containerLook(kit, type, x, y, z, ry); L.containers.push({ type, x, y, z, ry, zone }); }
const weighted = (opts, R) => { let t = 0; for (const o of opts) t += o[1]; let r = R() * t; for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; } return opts[0][0]; };

export function building(L, kit, b) {
  const R = kit.R, st = STYLES[b.style] || STYLES.residential;
  const c = b.color ?? kit.pick(st.walls);
  const W = b.x1 - b.x0, D = b.z1 - b.z0, F = b.floors, H = FLOOR;
  const OPEN = Math.min(F, b.open === true ? F : (b.open | 0));
  const back = b.back ?? OPP[b.front];
  const nx = Math.max(1, Math.round(W / 4.2)), nz = Math.max(1, Math.round(D / 4.2));
  const bw = W / nx, bd = D / nz;
  const X = i => b.x0 + i * bw, Z = j => b.z0 + j * bd;
  const SX = i => i === 0 ? b.x0 + WALL : i === nx ? b.x1 - WALL : X(i);      // slabs stop at the inside of the outer walls (no faces on top of each other)
  const SZ = j => j === 0 ? b.z0 + WALL : j === nz ? b.z1 - WALL : Z(j);
  const key = (...a) => a.join(':');
  const alive = Array.from({ length: F }, () => Array.from({ length: nx }, () => Array(nz).fill(true)));
  const roofOk = Array.from({ length: nx }, () => Array(nz).fill(true));
  const holes = new Set(), floorGone = new Set();
  const blank = new Set(b.blank || []);

  // ---- stairs: where they go, and the cells they need (damage leaves those alone, except a sheared-off top) ----
  const want = OPEN === F && b.roof ? F : Math.max(0, OPEN - 1);
  const slots = want > 0 ? planStair(b, kit, want) : null;
  const guard = new Set();
  if (slots) for (const sl of slots) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (X(i + 1) > sl.x0 - 1 && X(i) < sl.x1 + 1 && Z(j + 1) > sl.z0 - 1 && Z(j) < sl.z1 + 1) guard.add(key(i, j));
  }
  smash(b, kit, F, nx, nz, alive, roofOk, holes, floorGone, guard);
  for (let f = 1; f < F; f++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (!alive[f - 1][i][j]) alive[f][i][j] = false;
  let flights = 0;
  if (slots) {
    const most = slots.length > 1 ? want : Math.min(1, want);
    const cells = [...guard].map(g => g.split(':').map(Number));
    while (flights < most) {
      const f = flights + 1;
      if (!cells.every(([i, j]) => f < F ? alive[f][i][j] : alive[F - 1][i][j] && roofOk[i][j])) break;
      flights++;
    }
  }

  // ---- the facades, floor by floor ----
  const S = {
    n: { along: true, at: b.z0 + WALL / 2, face: b.z0, n: nx, cell: k => [k, 0], lo: b.x0, hi: b.x1, out: -1 },
    s: { along: true, at: b.z1 - WALL / 2, face: b.z1, n: nx, cell: k => [k, nz - 1], lo: b.x0, hi: b.x1, out: 1 },
    w: { along: false, at: b.x0 + WALL / 2, face: b.x0, n: nz, cell: k => [0, k], lo: b.z0 + WALL, hi: b.z1 - WALL, out: -1 },
    e: { along: false, at: b.x1 - WALL / 2, face: b.x1, n: nz, cell: k => [nx - 1, k], lo: b.z0 + WALL, hi: b.z1 - WALL, out: 1 },
  };
  const bayA = (s, k) => [Math.max(S[s].lo, S[s].along ? X(k) : Z(k)), Math.min(S[s].hi, S[s].along ? X(k + 1) : Z(k + 1))];
  const byStair = (s, k) => !!slots && slots.some(sl => {
    const [a0, a1] = bayA(s, k), I = S[s];
    return I.along ? a1 > sl.x0 - 1 && a0 < sl.x1 + 1 && Math.abs(I.at - (sl.z0 + sl.z1) / 2) < SW + 1
      : a1 > sl.z0 - 1 && a0 < sl.z1 + 1 && Math.abs(I.at - (sl.x0 + sl.x1) / 2) < SW + 1;
  });
  const doorBays = {};
  for (const s of 'nswe') {
    const n = S[s].n, set = new Set();
    if (s === b.front) { set.add(Math.floor(n / 2)); if (n >= 5 && R() < 0.5) set.add(1); }
    else if (OPEN > 0 && s === back && !blank.has(s) && R() < 0.6) set.add(Math.floor(R() * n));
    for (const k of [...set]) if (byStair(s, k)) set.delete(k);
    if (s === b.front && !set.size) for (let k = 0; k < n; k++) if (!byStair(s, k)) { set.add(k); break; }
    doorBays[s] = set;
  }
  const kindOf = (s, f, k) => {
    if (blank.has(s)) return 'blank';
    if (f === 0) {
      if (doorBays[s].has(k)) return 'door';
      if (s === b.front && b.shop) return 'shop';
      return R() < 0.75 ? 'window' : 'blank';
    }
    if (s === b.front && b.balconies && R() < 0.35) return 'balcony';
    return R() < 0.82 ? 'window' : 'blank';
  };
  const glass = () => R() < 0.12 ? COL.boarded : kit.pick(COL.glass);
  const box = (s, a0, a1, y0, h, depth, out, col, cc) => {      // a strip along a facade, `out` = how far it stands out
    const I = S[s], len = a1 - a0, mid = (a0 + a1) / 2;
    if (len < 0.05) return;
    const pos = I.face + I.out * (out - depth / 2);
    if (I.along) kit.box(mid, y0, pos, len, h, depth, cc, { col });
    else kit.box(pos, y0, mid, depth, h, len, cc, { col });
  };
  const standing = (f, s, k) => { const [i, j] = S[s].cell(k); return alive[f][i][j] && !holes.has(key(f, s, k)); };
  const closedRuns = [], balconies = [];
  for (let f = 0; f < F; f++) {
    const y0 = f * H, open = f < OPEN;
    for (const s of 'nswe') {
      const I = S[s], axis = I.along ? 'x' : 'z';
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const r0 = run[0].a0, r1 = run[run.length - 1].a1;
        if (open) {
          const ops = [];
          for (const q of run) {
            const len = q.a1 - q.a0, mid = (q.a0 + q.a1) / 2;
            if (q.kind === 'window' && len > 2.2) ops.push({ a: mid, w: Math.min(1.4, len - 1.0), b: 1.0, t: 2.35 });
            else if (q.kind === 'door') ops.push({ a: mid, w: Math.min(1.6, len - 0.6), b: 0, t: 2.5 });
            else if (q.kind === 'shop') ops.push({ a: mid, w: Math.max(1.6, Math.min(3.4, len - 0.8)), b: 0, t: 2.9 });
            else if (q.kind === 'balcony') ops.push({ a: mid, w: Math.min(1.4, len - 1.0), b: 0, t: 2.4 });
          }
          kit.wall(axis, I.at, r0, r1, y0, H, ops, c);
        } else {
          closedRuns.push({ s, r0, r1, f });
          for (const q of run) {
            const len = q.a1 - q.a0, mid = (q.a0 + q.a1) / 2;
            if (q.kind === 'window' && len > 2.2) kit.pane(s, I.face, mid, y0 + 1.65, Math.min(1.3, len - 1.0), 1.4, glass());
            else if (q.kind === 'balcony') kit.pane(s, I.face, mid, y0 + 1.25, Math.min(1.3, len - 1.0), 2.3, glass());
            else if (q.kind === 'shop') kit.pane(s, I.face, mid, y0 + 1.5, Math.min(3.4, len - 0.8), 2.6, R() < 0.5 ? kit.pick(COL.metal) : kit.pick(COL.glass));
            else if (q.kind === 'door') kit.pane(s, I.face, mid, y0 + 1.2, 1.4, 2.4, kit.pick(COL.door));
          }
        }
        // a plinth along the solid stretches at street level, floor bands and a shop sign on the front
        if (f === 0 && (s === b.front || s === back)) {
          let p0 = null;
          for (const q of run) {
            const gap = q.kind === 'door' || q.kind === 'shop';
            if (!gap && p0 === null) p0 = q.a0;
            if (gap && p0 !== null) { box(s, p0, q.a0, 0, 0.55, 0.06, 0.06, false, COL.plinth); p0 = null; }
          }
          if (p0 !== null) box(s, p0, r1, 0, 0.55, 0.06, 0.06, false, COL.plinth);
        }
        if (f > 0 && s === b.front) box(s, r0, r1, y0 - 0.1, 0.2, 0.08, 0.08, false, st.trim);
        if (f === 0 && s === b.front && b.shop) box(s, r0, r1, 2.95, 0.5, 0.12, 0.12, false, b.sign ?? kit.pick(COL.shop));
        run = [];
      };
      for (let k = 0; k < I.n; k++) {
        const [i, j] = I.cell(k), [a0, a1] = bayA(s, k);
        if (standing(f, s, k)) {
          const kind = kindOf(s, f, k);
          if (kind === 'balcony') balconies.push({ s, f, k, open });
          run.push({ k, a0, a1, kind });
          continue;
        }
        flush();
        // what is left of the wall here: a low broken piece, joined to the wall that still stands
        const hole = alive[f][i][j], below = f === 0 || alive[f - 1][i][j];
        if (below && R() < (hole ? 0.6 : 0.8)) {
          const len = (a1 - a0) * kit.range(0.25, 0.8), hh = hole ? kit.range(0.25, 0.8) : kit.range(0.3, 1.6);
          const prev = k > 0 && standing(f, s, k - 1), next = k < I.n - 1 && standing(f, s, k + 1);
          const from = prev && !next ? a0 : next && !prev ? a1 - len : (R() < 0.5 ? a0 : a1 - len);
          if (I.along) kit.box(from + len / 2, y0, I.at, len, hh, WALL, c);
          else kit.box(I.at, y0, from + len / 2, WALL, hh, len, c);
          if (R() < 0.3) kit.rebar(I.along ? from + len / 2 : I.at, y0 + hh + 0.3, I.along ? I.at : from + len / 2, 2);
        }
      }
      flush();
    }
  }
  // closed walls: one box up as many floors as the same stretch stands
  closedRuns.sort((p, q) => (p.s < q.s ? -1 : p.s > q.s ? 1 : 0) || p.r0 - q.r0 || p.r1 - q.r1 || p.f - q.f);
  for (let i = 0; i < closedRuns.length;) {
    const a = closedRuns[i];
    let j = i + 1, top = a.f;
    while (j < closedRuns.length && closedRuns[j].s === a.s && Math.abs(closedRuns[j].r0 - a.r0) < 1e-6 && Math.abs(closedRuns[j].r1 - a.r1) < 1e-6 && closedRuns[j].f === top + 1) { top++; j++; }
    const I = S[a.s];
    kit.wall(I.along ? 'x' : 'z', I.at, a.r0, a.r1, a.f * H, (top - a.f + 1) * H, [], c);
    i = j;
  }
  // balconies (you can step out onto the ones on floors you can get into)
  for (const q of balconies) {
    const [a0, a1] = bayA(q.s, q.k);
    box(q.s, a0 + 0.35, a1 - 0.35, q.f * H - 0.15, 0.15, 1.1, 1.1, q.open, COL.slab);
    box(q.s, a0 + 0.35, a1 - 0.35, q.f * H, 1.0, 0.06, 1.1, q.open, kit.pick(COL.metal));
  }

  // ---- floor slabs (on the floors you can get into) and the roof, with torn edges where cells are gone ----
  let torn = 0;
  for (let f = 1; f <= F; f++) {
    const roof = f === F;
    if (!roof && f > OPEN) continue;
    const present = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && (roof ? alive[F - 1][i][j] && roofOk[i][j] : alive[f - 1][i][j] && !floorGone.has(key(f, i, j)));
    const hole = slots && f <= flights ? slots[(f - 1) % slots.length].hole : null;
    for (const r of rects(nx, nz, present)) kit.slab(SX(r.i0), SZ(r.j0), SX(r.i1), SZ(r.j1), f * H, COL.slab, hole, { top: roof ? st.roof : st.floor });
    for (let i = 0; i < nx && torn < 6; i++) for (let j = 0; j < nz && torn < 6; j++) {
      if (!present(i, j)) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz || present(ni, nj) || R() > 0.4) continue;
        const ex = di ? X(di > 0 ? i + 1 : i) : X(i) + bw * kit.range(0.2, 0.8);
        const ez = dj ? Z(dj > 0 ? j + 1 : j) : Z(j) + bd * kit.range(0.2, 0.8);
        const len = (di ? bd : bw) * kit.range(0.25, 0.6), out = kit.range(0.5, 1.2), tilt = kit.range(0.15, 0.55);
        kit.cbox(ex + di * out * 0.45, f * H - SLAB / 2 - out * 0.2, ez + dj * out * 0.45, di ? out : len, SLAB, dj ? out : len, COL.slab,
          { rx: dj ? dj * tilt : 0, rz: di ? -di * tilt : 0, col: false });
        if (R() < 0.5) kit.rebar(ex + di * 0.3, f * H - 0.2, ez + dj * 0.3, 2);
        torn++;
      }
    }
  }

  // ---- the roof edge: parapets and a cornice; clutter on top ----
  const roofAt = (i, j) => alive[F - 1][i][j] && roofOk[i][j];
  for (const s of 'nswe') {
    const I = S[s];
    let start = -1;
    for (let k = 0; k <= I.n; k++) {
      const on = k < I.n && (() => { const [i, j] = I.cell(k); return roofAt(i, j); })();
      if (on && start < 0) start = k;
      if (!on && start >= 0) {
        const a0 = bayA(s, start)[0], a1 = bayA(s, k - 1)[1];
        box(s, a0, a1, F * H, 0.9, 0.22, 0.22, true, c);
        box(s, a0, a1, F * H - 0.4, 0.42, 0.24, 0.24, false, st.trim);
        start = -1;
      }
    }
  }
  const onRoof = flights === F;
  for (let n = 0, tries = 0, clutter = 1 + Math.floor(R() * 2); n < clutter && tries < 6; tries++) {
    const i = Math.floor(R() * nx), j = Math.floor(R() * nz);
    if (!roofAt(i, j) || guard.has(key(i, j))) continue;
    const x = X(i) + bw / 2, z = Z(j) + bd / 2, y = F * H, r = R();
    if (r < 0.4) kit.box(x, y, z, 1.4, 1.1, 1.0, kit.pick(COL.metal), { col: onRoof });
    else if (r < 0.7) kit.box(x, y, z, 1.4, 1.6, 1.4, kit.pick(COL.rust), { col: onRoof });
    else if (r < 0.85) kit.box(x, y, z, 0.12, kit.range(2.5, 6), 0.12, COL.metal[0], { col: false });
    else kit.cbox(x, y + 1.1, z, 1.2, 0.1, 1.2, COL.metal[1], { rx: 0.6, ry: R() * Math.PI, col: false });
    n++;
  }

  // ---- inside: stairs, a dividing wall with a doorway, furniture, loot (on the floors you can get into) ----
  if (slots && flights) {
    for (let f = 0; f < flights; f++) {
      const sl = slots[f % slots.length];
      kit.steps(sl.axis, sl.sx, sl.sz, sl.dir, f * H, SW, STEPS, COL.slab, st.floor);
    }
    L.stairs.push({ ...slots[0].start, y0: 0, y1: flights * H });
  }
  if (OPEN > 0) inside(L, kit, b, { OPEN, nx, nz, bw, bd, X, Z, alive, holes, floorGone, S, bayA, doorBays, slots, guard, key });
  if (onRoof) L.roofs.push({ x: (b.x0 + b.x1) / 2, y: F * H, z: (b.z0 + b.z1) / 2, zone: b.zone });

  // ---- rubble: where the building came down, and out into the street ----
  let piles = 0;
  for (let i = 0; i < nx && piles < 3; i++) for (let j = 0; j < nz && piles < 3; j++) {
    let top = 0;
    while (top < F && alive[top][i][j]) top++;
    if (top === F || guard.has(key(i, j)) || (top > 0 && top > OPEN)) continue;
    if (R() < 0.65) { kit.rubble(X(i) + bw / 2, Z(j) + bd / 2, Math.min(bw, bd) * 0.4, 3, top * H); piles++; }      // stays inside its own cell
  }
  for (const s of 'nswe') {
    if (piles >= 4 || blank.has(s)) continue;
    const I = S[s];
    for (let k = 0; k < I.n; k++) {
      const [i, j] = I.cell(k);
      if ((alive[F - 1][i][j] && !holes.has(key(0, s, k))) || doorBays[s].has(k)) continue;
      const [a0, a1] = bayA(s, k), mid = (a0 + a1) / 2, sz = kit.range(1.5, 2.4), d = 1.1 * sz + 0.3;
      const x = I.along ? mid : I.face + I.out * d, z = I.along ? I.face + I.out * d : mid;
      if (L.containers.some(q => q.y < 1 && Math.hypot(q.x - x, q.z - z) < 1.1 * sz + 2.4)) break;     // not on top of something to search
      kit.rubble(x, z, sz, 4);
      L.heaps.push({ x, z, r: 1.1 * sz });
      piles++;
      break;
    }
  }
  L.footprints.push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: F * H, open: OPEN > 0, floor: st.floor });
}

// ---------- damage ----------
function smash(b, kit, F, nx, nz, alive, roofOk, holes, floorGone, guard) {
  const R = kit.R, sev = b.damage ?? 0.5, key = (...a) => a.join(':');
  const opts = [['hole', 3], ['corner', 2.5 + sev * 2], ['roof', 2]];
  if (F >= 3) opts.push(['top', 1.5 + sev * 2]);
  if (F >= 2 && b.open) opts.push(['floor', 1.2]);
  if (F >= 3 && Math.max(nx, nz) >= 3 && sev > 0.5) opts.push(['gash', sev * 1.6]);
  const n = 1 + (R() < sev ? 1 : 0) + (R() < sev * 0.45 ? 1 : 0);
  const kill = (f, i, j) => { if (!guard.has(key(i, j))) alive[f][i][j] = false; };
  for (let k = 0; k < n; k++) {
    const kind = weighted(opts, R);
    if (kind === 'hole') {
      for (let h = 0, c = 1 + Math.floor(R() * 3); h < c; h++) {
        const s = kit.pick(['n', 's', 'e', 'w']), nb = s === 'n' || s === 's' ? nx : nz;
        const k0 = Math.floor(R() * nb), f0 = Math.floor(R() * F), wide = R() < 0.35 ? 2 : 1, tall = R() < 0.3 ? 2 : 1;
        for (let a = 0; a < wide; a++) for (let t = 0; t < tall; t++) if (k0 + a < nb && f0 + t < F) holes.add(key(f0 + t, s, k0 + a));
      }
    } else if (kind === 'corner') {
      const ci = R() < 0.5 ? 0 : nx - 1, cj = R() < 0.5 ? 0 : nz - 1;
      const fs = F <= 2 ? (R() < 0.4 ? 0 : F - 1) : Math.floor(R() * Math.max(1, F - 1)), grow = kit.range(0.6, 1.4);
      for (let f = fs; f < F; f++) {
        const r = 0.9 + (f - fs) * grow;
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (Math.abs(i - ci) + Math.abs(j - cj) + R() * 0.7 < r) kill(f, i, j);
      }
    } else if (kind === 'top') {
      const top = Math.max(1, F - 1 - Math.floor(R() * Math.min(2, F - 2)));
      const stumps = new Set();
      for (let s = 0, c = 1 + Math.floor(R() * 3); s < c; s++) stumps.add(key(R() < 0.5 ? 0 : nx - 1, Math.floor(R() * nz)));
      for (let f = top; f < F; f++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (f === top && stumps.has(key(i, j))) continue;
        alive[f][i][j] = false;
      }
    } else if (kind === 'roof') {
      const w = 1 + Math.floor(R() * Math.ceil(nx / 2)), d = 1 + Math.floor(R() * Math.ceil(nz / 2));
      const i0 = Math.floor(R() * (nx - w + 1)), j0 = Math.floor(R() * (nz - d + 1));
      for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) if (!guard.has(key(i, j))) roofOk[i][j] = false;
    } else if (kind === 'floor') {
      const f = 1 + Math.floor(R() * (F - 1)), i = Math.floor(R() * nx), j = Math.floor(R() * nz);
      if (!guard.has(key(i, j))) floorGone.add(key(f, i, j));
    } else if (kind === 'gash') {
      const fs = 1 + Math.floor(R() * Math.min(2, F - 2));
      if (nx >= nz) { const i = 1 + Math.floor(R() * Math.max(1, nx - 2)); for (let f = fs; f < F; f++) for (let j = 0; j < nz; j++) kill(f, i, j); }
      else { const j = 1 + Math.floor(R() * Math.max(1, nz - 2)); for (let f = fs; f < F; f++) for (let i = 0; i < nx; i++) kill(f, i, j); }
    }
  }
}

// rectangles covering the cells where present(i, j) is true (greedy)
function rects(nx, nz, present) {
  const used = Array.from({ length: nx }, () => Array(nz).fill(false)), out = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (used[i][j] || !present(i, j)) continue;
    let i1 = i + 1;
    while (i1 < nx && !used[i1][j] && present(i1, j)) i1++;
    let j1 = j + 1;
    grow: while (j1 < nz) { for (let a = i; a < i1; a++) if (used[a][j1] || !present(a, j1)) break grow; j1++; }
    for (let a = i; a < i1; a++) for (let q = j; q < j1; q++) used[a][q] = true;
    out.push({ i0: i, j0: j, i1, j1 });
  }
  return out;
}

// The stairs: one or two places (slots) for a flight. Flight f uses slot f % 2, so no flight stands right on top of
// the one below it (you would hit your head): two slots one after the other along a wall, or one on the back wall
// and one on a side wall, clear of each other at the corner. With room for one slot only, the stairs go up one floor.
function planStair(b, kit, want) {
  const back = b.back ?? OPP[b.front];
  const ix0 = b.x0 + WALL, ix1 = b.x1 - WALL, iz0 = b.z0 + WALL, iz1 = b.z1 - WALL;
  const range = s => s === 'n' || s === 's' ? [ix0, ix1] : [iz0, iz1];
  const across = s0 => ['n', 's', 'e', 'w'].filter(s => s !== s0 && s !== OPP[s0]);
  const slot = (side, start, dir) => {
    const lo = Math.min(start, start + dir * RUN), hi = Math.max(start, start + dir * RUN);
    const h0 = dir > 0 ? start + 0.9 : start - RUN, h1 = dir > 0 ? start + RUN : start - 0.9;     // the stairwell (your head clears its edge)
    if (side === 'n' || side === 's') {
      const z0 = side === 'n' ? iz0 : iz1 - SW, zc = z0 + SW / 2;
      return { side, axis: 'x', dir, sx: start, sz: zc, x0: lo, x1: hi, z0, z1: z0 + SW, hole: { x0: h0, x1: h1, z0, z1: z0 + SW },
        start: { x: start - dir * 0.9, z: zc, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 } };
    }
    const x0 = side === 'w' ? ix0 : ix1 - SW, xc = x0 + SW / 2;
    return { side, axis: 'z', dir, sx: xc, sz: start, x0, x1: x0 + SW, z0: lo, z1: hi, hole: { x0, x1: x0 + SW, z0: h0, z1: h1 },
      start: { x: xc, z: start - dir * 0.9, yaw: dir > 0 ? Math.PI : 0 } };
  };
  const order = [back, ...across(b.front)];
  if (want > 1) {
    for (const s of order) {                       // two along one wall, the same way, a step apart
      const [a0, a1] = range(s), len = a1 - a0, need = 2 * RUN + 2.1;
      if (len < need) continue;
      if (kit.R() < 0.5) { const p = a0 + 0.9 + kit.R() * (len - need); return [slot(s, p, 1), slot(s, p + RUN + 0.9, 1)]; }
      const q = a1 - 0.9 - kit.R() * (len - need);
      return [slot(s, q, -1), slot(s, q - RUN - 0.9, -1)];
    }
    for (const s2 of across(back)) {               // one on the back wall, one on a side wall
      const [b0, b1] = range(back), [s0, s1] = range(s2), need = SW + 1.9 + RUN + 0.3;
      if (b1 - b0 < need || s1 - s0 < need) continue;
      const lowB = s2 === 'w' || s2 === 'n', lowS = back === 'n' || back === 'w';
      const A = lowB ? slot(back, b0 + SW + 1.9, 1) : slot(back, b1 - SW - 1.9, -1);
      const B = lowS ? slot(s2, s0 + SW + 1.0 + RUN, -1) : slot(s2, s1 - SW - 1.0 - RUN, 1);
      return [A, B];
    }
  }
  for (const s of order) {                         // one flight only
    const [a0, a1] = range(s), len = a1 - a0, need = RUN + 1.2;
    if (len < need) continue;
    if (kit.R() < 0.5) return [slot(s, a0 + 0.9 + kit.R() * (len - need), 1)];
    return [slot(s, a0 + 0.3 + kit.R() * (len - need) + RUN, -1)];
  }
  return null;
}

// furniture, loot, a dividing wall and a place for a nest, inside a building you can enter
function inside(L, kit, b, g) {
  const R = kit.R, { OPEN, nx, nz, bw, bd, X, Z, alive, holes, floorGone, S, bayA, doorBays, slots, guard, key } = g;
  const H = FLOOR;
  const inStair = (x, z, m = 0.9) => !!slots && slots.some(s => x > s.x0 - m && x < s.x1 + m && z > s.z0 - m && z < s.z1 + m);
  // nothing stands on the stairs or where you walk up to them: a box (centre, half sizes) against every flight's
  // place grown by 1.4 m all round
  const onStairs = (x, z, hw, hd) => !!slots && slots.some(s => x + hw > s.x0 - 1.4 && x - hw < s.x1 + 1.4 && z + hd > s.z0 - 1.4 && z - hd < s.z1 + 1.4);
  const cellOf = (x, z) => [Math.min(nx - 1, Math.max(0, Math.floor((x - b.x0) / bw))), Math.min(nz - 1, Math.max(0, Math.floor((z - b.z0) / bd)))];
  const floorAt = (f, x, z) => { const [i, j] = cellOf(x, z); return alive[f][i][j] && (f === 0 || !floorGone.has(key(f, i, j))); };
  const alongX = nx >= nz, cut = Math.floor((alongX ? nx : nz) / 2);
  for (let f = 0; f < OPEN; f++) {
    const y0 = f * H;
    // what is already taken on this floor (a box, or the place you search it from), as rectangles
    const taken = [];
    const free = (x, z, hw, hd) => !onStairs(x, z, hw, hd) && taken.every(r => x + hw <= r.x0 || x - hw >= r.x1 || z + hd <= r.z0 || z - hd >= r.z1);
    const take = (x, z, hw, hd) => taken.push({ x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd });
    const clearOf = (x, z, m) => taken.every(r => Math.max(r.x0 - x, 0, x - r.x1) ** 2 + Math.max(r.z0 - z, 0, z - r.z1) ** 2 > m * m);
    // a dividing wall across the longer side, with a doorway in every stretch
    if (Math.max(nx, nz) >= 3) {
      const n = alongX ? nz : nx;
      let run0 = -1;
      for (let k = 0; k <= n; k++) {
        const ok = k < n && (alongX ? alive[f][cut - 1][k] && alive[f][cut][k] && !guard.has(key(cut, k)) && !guard.has(key(cut - 1, k))
          : alive[f][k][cut - 1] && alive[f][k][cut] && !guard.has(key(k, cut)) && !guard.has(key(k, cut - 1)));
        if (ok && run0 < 0) run0 = k;
        if (!ok && run0 >= 0) {
          const a0 = alongX ? Z(run0) + WALL : X(run0) + WALL, a1 = alongX ? Z(k) - WALL : X(k) - WALL;
          if (a1 - a0 > 2.2) kit.wall(alongX ? 'z' : 'x', alongX ? X(cut) : Z(cut), a0, a1, y0, H - SLAB, [{ a: (a0 + a1) / 2, w: 1.3, b: 0, t: 2.4 }], COL.inner, { t: 0.18 });
          run0 = -1;
        }
      }
    }
    // places along the inside of the outer walls
    const spots = [];
    for (const s of 'nswe') {
      const I = S[s];
      for (let k = 0; k < I.n; k++) {
        const [i, j] = I.cell(k);
        if (!alive[f][i][j] || holes.has(key(f, s, k)) || (f === 0 && doorBays[s].has(k)) || (f > 0 && floorGone.has(key(f, i, j)))) continue;
        const [a0, a1] = bayA(s, k), mid = (a0 + a1) / 2, inward = 0.6;
        const x = I.along ? mid : I.face - I.out * inward, z = I.along ? I.face - I.out * inward : mid;
        if (inStair(x, z)) continue;
        if (Math.max(nx, nz) >= 3 && Math.abs(alongX ? x - X(cut) : z - Z(cut)) < 1.0) continue;
        const ry = s === 'n' ? 0 : s === 's' ? Math.PI : s === 'w' ? Math.PI / 2 : -Math.PI / 2;
        spots.push({ x, z, ry, side: s, fx: I.along ? 0 : -I.out, fz: I.along ? -I.out : 0 });
      }
    }
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    const loot = Math.min(spots.length, (R() < 0.55 ? 1 : 0) + (R() < 0.2 ? 1 : 0) + (b.rich && R() < 0.6 ? 1 : 0));
    let placed = 0;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i], wide = s.side === 'n' || s.side === 's';
      if (placed < loot) {
        // the box and the place in front of it you search it from
        const cx = s.x + s.fx * 0.8, cz = s.z + s.fz * 0.8, hw = wide ? 0.75 : 1.0, hd = wide ? 1.0 : 0.75;
        if (!free(cx, cz, hw, hd)) continue;
        addLoot(L, kit, lootType(kit, b), s.x, y0, s.z, s.ry, b.zone);
        take(cx, cz, hw, hd);
        placed++;
        continue;
      }
      if (placed < loot + 3 && R() < 0.7) {
        const r = R(), res = b.style === 'residential' || b.style === 'market';
        // a shelf, a table, a bed or a counter: [width along the wall, height, depth, how far from the wall, colour]
        const [len, ht, dep, off, col] = r < 0.35 ? [1.8, 1.7, 0.5, 0, kit.pick(COL.furniture)] : r < 0.65 ? [1.4, 0.8, 0.8, 0.3, kit.pick(COL.furniture)]
          : res ? [2.0, 0.5, 1.0, 0.45, 0x7a6a5a] : [2.2, 1.0, 0.7, 0, kit.pick(COL.furniture)];
        const x = s.x + s.fx * off, z = s.z + s.fz * off, w = wide ? len : dep, d = wide ? dep : len;
        if (!free(x, z, w / 2 + 0.1, d / 2 + 0.1)) continue;
        kit.box(x, y0, z, w, ht, d, col);
        take(x, z, w / 2 + 0.1, d / 2 + 0.1);
        placed++;
        continue;
      }
      // an empty place on the floor in front of the wall: somewhere for things lying around
      const fx = s.x + s.fx * 1.3, fz = s.z + s.fz * 1.3;
      if (!inStair(fx, fz, 1.2) && floorAt(f, fx, fz) && clearOf(fx, fz, 0.4)) L.floorSpots.push({ x: fx, y: y0, z: fz, zone: b.zone });
    }
    // a Scatter nest on the ground floor, in a room away from the doors, the stairs and the furniture
    if (f === 0 && b.nest) {
      for (let t = 0; t < 12; t++) {
        const i = Math.floor(R() * nx), j = Math.floor(R() * nz), x = X(i) + bw / 2, z = Z(j) + bd / 2;
        if (!alive[0][i][j] || guard.has(key(i, j)) || inStair(x, z, 1.5) || !clearOf(x, z, 1.0)) continue;
        L.nestSpots.push({ x, y: 0.1, z, zone: b.zone });
        break;
      }
    }
  }
  L.interiors.push({ x0: b.x0 + WALL + 0.5, z0: b.z0 + WALL + 0.5, x1: b.x1 - WALL - 0.5, z1: b.z1 - WALL - 0.5, y0: 0, y1: OPEN * H });
}

// what kind of container a building holds, by what it was
function lootType(kit, b) {
  const r = kit.R();
  if (b.shop) return r < 0.4 ? 'locker' : r < 0.7 ? 'medcab' : r < 0.9 ? 'crate' : 'toolbox';
  if (b.style === 'downtown') return r < 0.45 ? 'locker' : r < 0.65 ? 'medcab' : r < 0.85 ? 'case' : 'crate';
  if (b.style === 'industrial') return r < 0.4 ? 'toolbox' : r < 0.75 ? 'crate' : 'locker';
  return r < 0.38 ? 'locker' : r < 0.62 ? 'medcab' : r < 0.84 ? 'toolbox' : 'crate';
}

// ---------- other kinds of buildings ----------
// one tall hall with big doorways, shelving and loot (the industrial yard); part of its roof is gone
export function warehouse(L, kit, b) {
  const R = kit.R, c = b.color ?? kit.pick(COL.concrete), H = 7.5;
  const W = b.x1 - b.x0, D = b.z1 - b.z0, ix0 = b.x0 + WALL, ix1 = b.x1 - WALL, iz0 = b.z0 + WALL, iz1 = b.z1 - WALL;
  const big = { w: 5.5, b: 0, t: 5.2 };
  const op = s => b.doors.includes(s) ? [{ a: s === 'n' || s === 's' ? (b.x0 + b.x1) / 2 : (b.z0 + b.z1) / 2, ...big }] : [];
  const jag = 0.25 + (b.damage ?? 0.5) * 0.4;
  kit.wall('x', b.z0 + WALL / 2, b.x0, b.x1, 0, H, op('n'), c, { jag });
  kit.wall('x', b.z1 - WALL / 2, b.x0, b.x1, 0, H, op('s'), c, { jag });
  kit.wall('z', b.x0 + WALL / 2, iz0, iz1, 0, H, op('w'), c, { jag });
  kit.wall('z', b.x1 - WALL / 2, iz0, iz1, 0, H, op('e'), c, { jag });
  kit.panesAlong('n', b.z0, b.x0, b.x1, 6.2, 2.2, 0.9, 3.2, 0.25);
  kit.panesAlong('s', b.z1, b.x0, b.x1, 6.2, 2.2, 0.9, 3.2, 0.25);
  const hx = ix0 + W * kit.range(0.2, 0.5), hz = iz0 + D * kit.range(0.2, 0.5);
  kit.slab(b.x0 + WALL / 2, b.z0 + WALL / 2, b.x1 - WALL / 2, b.z1 - WALL / 2, H, COL.metal[2],
    { x0: hx, z0: hz, x1: hx + W * kit.range(0.15, 0.35), z1: hz + D * kit.range(0.2, 0.4) }, { thick: 0.25, top: 0x5e5a55 });
  const rx = hx + W * 0.1, rz = hz + D * 0.12;                           // the heap under the hole in the roof
  kit.rubble(rx, rz, 3, 4);
  const crates = [];
  const clear = (x, z) => Math.hypot(x - rx, z - rz) > 4.5 && crates.every(q => Math.hypot(q.x - x, q.z - z) > 2.2);
  const rows = Math.max(1, Math.floor((W - 8) / 6));
  for (let i = 0; i < rows; i++) {
    const x = b.x0 + 5 + i * 6 + kit.range(-0.5, 0.5);
    const len = D * kit.range(0.35, 0.55), z = (b.z0 + b.z1) / 2 + kit.range(-0.15, 0.15) * D;
    kit.box(x, 0, z, 1.0, 2.6, len, 0x6b5a46);
    const cz = z - len / 2 + 1;
    if (R() < 0.6 && clear(x + 1.4, cz)) { kit.box(x + 1.4, 0, cz, 1.2, 1.2, 1.2, kit.pick(COL.rust)); crates.push({ x: x + 1.4, z: cz }); }
    const lz = z + kit.range(-0.3, 0.3) * len;                           // loot in the aisle, searched from further along it
    if (R() < 0.5 && clear(x + 1.4, lz) && clear(x + 2.6, lz)) addLoot(L, kit, R() < 0.5 ? 'crate' : 'toolbox', x + 1.4, 0, lz, Math.PI / 2, b.zone);
  }
  if (R() < 0.5 && clear(ix1 - 1.7, iz1 - 1.5)) addLoot(L, kit, 'locker', ix1 - 0.5, 0, iz1 - 1.5, -Math.PI / 2, b.zone);
  if (b.nest) L.nestSpots.push({ x: b.x1 - 3, y: 0.1, z: (b.z0 + b.z1) / 2 + kit.range(-0.25, 0.25) * D, zone: b.zone });
  L.floorSpots.push({ x: b.x1 - 3.5, y: 0, z: iz0 + 2.5, zone: b.zone });
  L.footprints.push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: H, open: true, floor: 0x77706a });
  L.interiors.push({ x0: ix0 + 0.5, z0: iz0 + 0.5, x1: ix1 - 0.5, z1: iz1 - 0.5, y0: 0, y1: H });
}
// a stack of shipping containers (cover in the industrial yard)
export function containerStack(kit, x, z, yaw, levels) {
  for (let i = 0; i < levels; i++) {
    const s = Math.sin(yaw), c = Math.cos(yaw), off = kit.range(-0.4, 0.4);
    kit.cbox(x + c * off, 1.3 + i * 2.6, z - s * off, 2.44, 2.6, 6.1, kit.pick(COL.container), { ry: yaw + kit.range(-0.05, 0.05) });
  }
}
// a market stall: posts, a counter and a canvas roof
export function stall(kit, x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const at = (f, r) => ({ x: x + s * f + c * r, z: z + c * f - s * r });
  for (const [f, r] of [[-1, -1.3], [-1, 1.3], [1, -1.3], [1, 1.3]]) { const p = at(f, r); kit.cbox(p.x, 1.2, p.z, 0.12, 2.4, 0.12, 0x5d4c3c, { ry: yaw, col: false }); }
  kit.cbox(x, 0.45, z, 2.8, 0.9, 0.7, 0x6e5a44, { ry: yaw });
  kit.cbox(x, 2.45, z, 3.0, 0.06, 2.4, kit.pick(COL.awning), { ry: yaw, rx: 0.12, col: false });
}
