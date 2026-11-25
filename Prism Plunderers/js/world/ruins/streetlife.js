// Life in the streets of The Ruins (step 5b): wrecks along the kerbs and in the crossings, buses and lorries, street
// lights, trees, traffic lights and signs, benches, bins, bus stops, kiosks and hydrants on the pavements, palms down
// the two avenues, power lines in the older streets, checkpoints at the ways into the plaza and on a few crossings,
// dumpsters and washing in the alleys, junk in the courtyards and yards, fires with smoke (L.fires), and the marks
// all this leaves on the ground (L.decals, painted by groundmap.js).
// Every prop first asks a map of what is already there (every solid box, the floor plans, the doors, the place in
// front of every container, drop zones and extraction pads), so nothing blocks a door, a container or a drop zone.
// L.props lists what went where ({ t, x, z }), for the tests and the map.
import * as P from './props.js';
import { addLoot } from './buildings.js';

const weighted = (opts, R) => { let t = 0; for (const o of opts) t += o[1]; let r = R() * t; for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; } return opts[0][0]; };
const sq = (p, r) => ({ x0: p.x - r, x1: p.x + r, z0: p.z - r, z1: p.z + r });

// ---------- what is already there: boxes with a height range, on an 8 m grid ----------
class Taken {
  constructor(cell = 8) { this.cell = cell; this.map = new Map(); }
  cells(r, fn) {
    const c = this.cell;
    for (let i = Math.floor(r.x0 / c); i <= Math.floor(r.x1 / c); i++) for (let j = Math.floor(r.z0 / c); j <= Math.floor(r.z1 / c); j++) if (fn(i * 8192 + j) === false) return;
  }
  add(r) { this.cells(r, k => { let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(r); }); }
  free(r, y0 = 0, y1 = 2.5) {
    let ok = true;
    this.cells(r, k => {
      const a = this.map.get(k);
      if (a) for (const q of a) if (r.x1 > q.x0 && r.x0 < q.x1 && r.z1 > q.z0 && r.z0 < q.z1 && y1 > q.y0 && y0 < q.y1) { ok = false; return false; }
    });
    return ok;
  }
  claim(r, y0 = 0, y1 = 2.5) { if (!this.free(r, y0, y1)) return false; this.add({ ...r, y0, y1 }); return true; }
}
// the box round a box turned any way (Euler YXZ, as three.js builds the rotation)
function aabb(b) {
  if (!(b.rx || b.ry || b.rz)) return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2 };
  const a = Math.cos(b.rx), s = Math.sin(b.rx), c = Math.cos(b.ry), d = Math.sin(b.ry), e = Math.cos(b.rz), f = Math.sin(b.rz);
  const ce = c * e, cf = c * f, de = d * e, df = d * f, hx = b.w / 2, hy = b.h / 2, hz = b.d / 2;
  const ex = Math.abs(ce + df * s) * hx + Math.abs(de * s - cf) * hy + Math.abs(a * d) * hz;
  const ey = Math.abs(a * f) * hx + Math.abs(a * e) * hy + Math.abs(s) * hz;
  const ez = Math.abs(cf * s - de) * hx + Math.abs(df + ce * s) * hy + Math.abs(a * c) * hz;
  return { x0: b.x - ex, x1: b.x + ex, y0: b.y - ey, y1: b.y + ey, z0: b.z - ez, z1: b.z + ez };
}
function taken(L) {
  const T = new Taken();
  for (const b of L.boxes) if (b.col) T.add(aabb(b));
  for (const f of L.footprints) T.add({ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, y0: -1, y1: f.h + 2 });
  for (const d of L.doors) {                             // the way in: 3.5 m out from every door, a little wider than it
    const hw = d.w / 2 + 0.7, far = 3.5;
    T.add(d.nz ? { x0: d.x - hw, x1: d.x + hw, z0: Math.min(d.z, d.z + d.nz * far), z1: Math.max(d.z, d.z + d.nz * far), y0: -1, y1: 4 }
      : { z0: d.z - hw, z1: d.z + hw, x0: Math.min(d.x, d.x + d.nx * far), x1: Math.max(d.x, d.x + d.nx * far), y0: -1, y1: 4 });
  }
  for (const c of L.containers) {                        // a container and the place you search it from
    if (c.type === 'car') continue;
    const sx = c.x + Math.sin(c.ry) * 1.2, sz = c.z + Math.cos(c.ry) * 1.2;
    T.add({ x0: Math.min(c.x, sx) - 0.9, x1: Math.max(c.x, sx) + 0.9, z0: Math.min(c.z, sz) - 0.9, z1: Math.max(c.z, sz) + 0.9, y0: c.y - 1, y1: c.y + 2.5 });
  }
  for (const e of L.extracts) T.add({ x0: e.x - 11, x1: e.x + 11, z0: e.z - 11, z1: e.z + 11, y0: -1, y1: 30 });
  for (const s of L.spawns) T.add({ x0: s.x - 12, x1: s.x + 12, z0: s.z - 12, z1: s.z + 12, y0: -1, y1: 30 });
  for (const h of L.heaps) T.add({ x0: h.x - h.r, x1: h.x + h.r, z0: h.z - h.r, z1: h.z + h.r, y0: -1, y1: 2 });
  for (const h of L.holes) T.add({ ...h, y0: -10, y1: 10 });
  return T;
}
const zoneOf = (L, x, z) => { for (const k of ['red', 'yellow']) for (const zn of L.zones) if (zn.kind === k && Math.hypot(x - zn.x, z - zn.z) < zn.r) return k; return 'outer'; };
const buildingAt = (L, x, z) => L.footprints.find(f => x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) || null;

// ---------- the streets: stretches between crossings, points along them ----------
function segments(L, s) {
  const alongZ = s.axis === 'z', a0 = alongZ ? s.z0 : s.x0, a1 = alongZ ? s.z1 : s.x1, cuts = [];
  for (const o of L.streets) {
    if (o.axis === s.axis) continue;
    const covers = alongZ ? o.x0 <= s.at && o.x1 >= s.at : o.z0 <= s.at && o.z1 >= s.at;
    if (covers && o.at + o.w / 2 > a0 && o.at - o.w / 2 < a1) cuts.push([o.at - o.w / 2, o.at + o.w / 2]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const out = [];
  let cur = a0;
  for (const [c0, c1] of cuts) { if (c0 > cur + 1) out.push([cur, c0]); cur = Math.max(cur, c1); }
  if (a1 > cur + 1) out.push([cur, a1]);
  return out;
}
const onS = (s, a, o) => s.axis === 'z' ? { x: s.at + o, z: a } : { x: a, z: s.at + o };      // a along the street, o across it
const yawOf = (s, back = false) => (s.axis === 'z' ? 0 : Math.PI / 2) + (back ? Math.PI : 0);
function crossingList(L) {
  const out = [];
  for (const a of L.streets) if (a.axis === 'z') for (const b of L.streets) if (b.axis === 'x') {
    if (a.at > b.x0 && a.at < b.x1 && b.at > a.z0 && b.at < a.z1) out.push({ x: a.at, z: b.at, wx: a.w, wz: b.w });
  }
  return out;
}
function streetBeside(L, b, side) {
  for (const s of L.streets) {
    if (side === 'n' && s.axis === 'x' && Math.abs(s.z1 - b.z0) < 0.6 && s.x0 <= b.x0 + 1 && s.x1 >= b.x1 - 1) return s;
    if (side === 's' && s.axis === 'x' && Math.abs(s.z0 - b.z1) < 0.6 && s.x0 <= b.x0 + 1 && s.x1 >= b.x1 - 1) return s;
    if (side === 'w' && s.axis === 'z' && Math.abs(s.x1 - b.x0) < 0.6 && s.z0 <= b.z0 + 1 && s.z1 >= b.z1 - 1) return s;
    if (side === 'e' && s.axis === 'z' && Math.abs(s.x0 - b.x1) < 0.6 && s.z0 <= b.z0 + 1 && s.z1 >= b.z1 - 1) return s;
  }
  return null;
}

export function streetLife(L, kit) {
  const S = { L, kit, R: kit.R, T: taken(L), zone: (x, z) => zoneOf(L, x, z), cars: [], crossings: crossingList(L) };
  checkpoints(S);
  medians(S);
  curbs(S);
  crossings(S);
  sidewalks(S);
  power(S);
  alleys(S);
  lots(S);
  plazaLife(S);
  fires(S);
}

// ---------- the two avenues into the plaza: a planted strip down the middle (in pieces, round a checkpoint) ----------
function medians(S) {
  const { L, kit, R, T } = S, w = 2.2;
  for (const s of L.streets) {
    if (s.w < 16) continue;
    if (s.axis === 'x' && Math.abs(s.at - L.hwy.z) < 1) continue;     // not under the highway (its palms grew through the deck)
    for (const [a0, a1] of segments(L, s)) {
      const lo = Math.max(a0, -366) + 4, hi = Math.min(a1, 366) - 4;
      for (let p0 = lo; p0 < hi - 6; p0 += 12) {
        const p1 = Math.min(hi, p0 + 12), m = onS(s, (p0 + p1) / 2, 0), len = p1 - p0;
        const r = s.axis === 'z' ? { x0: m.x - w / 2, x1: m.x + w / 2, z0: p0, z1: p1 } : { x0: p0, x1: p1, z0: m.z - w / 2, z1: m.z + w / 2 };
        if (!T.claim(r, 0, 1)) continue;
        kit.box(m.x, 0, m.z, s.axis === 'z' ? w : len, 0.18, s.axis === 'z' ? len : w, 0x8a8172, { top: 0x6e5c45 });
        const p = onS(s, (p0 + p1) / 2 + kit.range(-2, 2), 0);
        if (R() < 0.8) kit.palm(p.x, p.z, kit.range(7, 11)); else P.deadTree(kit, p.x, p.z, kit.range(4, 6));
        L.props.push({ t: 'tree', x: p.x, z: p.z });
      }
    }
  }
}

// ---------- checkpoints: concrete barriers in a chicane, sandbags, a booth, tank traps, a weapon case ----------
function checkpoints(S) {
  const { L, kit, R } = S, Pz = L.plaza;
  for (const s of L.streets) {                           // the four ways into the plaza, along the avenues
    if (s.w < 16) continue;
    const a0 = s.axis === 'z' ? s.z0 : s.x0, a1 = s.axis === 'z' ? s.z1 : s.x1;
    const lo = s.axis === 'z' ? Pz.z0 : Pz.x0, hi = s.axis === 'z' ? Pz.z1 : Pz.x1;
    if (Math.abs(a1 - lo) < 0.5) for (const d of [22, 27, 32, 37]) if (checkpoint(S, s, lo - d, -1, true)) break;
    if (Math.abs(a0 - hi) < 0.5) for (const d of [22, 27, 32, 37]) if (checkpoint(S, s, hi + d, 1, true)) break;
  }
  const cands = S.crossings.filter(c => {                 // and a few crossings further out
    const d = Math.max(Math.abs(c.x), Math.abs(c.z));
    return d > 140 && d < 340 && Math.hypot(c.x - L.crater.x, c.z - L.crater.z) > 90 && c.wz < 20;
  });
  for (let n = 0, t = 0; n < 6 && t < 40 && cands.length; t++) {
    const c = cands.splice(Math.floor(R() * cands.length), 1)[0], dir = R() < 0.5 ? 1 : -1, alongZ = R() < 0.5;
    const s = L.streets.find(q => alongZ ? q.axis === 'z' && q.at === c.x && c.z > q.z0 && c.z < q.z1 : q.axis === 'x' && q.at === c.z && c.x > q.x0 && c.x < q.x1);
    if (s && checkpoint(S, s, (alongZ ? c.z : c.x) + dir * ((alongZ ? c.wz : c.wx) / 2 + 6), dir, false)) n++;
  }
}
function checkpoint(S, s, t, dir, big) {
  const { L, kit, R, T } = S, w = s.w, along = s.axis === 'z';
  const yawAcross = along ? Math.PI / 2 : 0, yawAlong = along ? 0 : Math.PI / 2;
  const a0 = Math.min(t, t + dir * 8), a1 = Math.max(t, t + dir * 8), hw = w / 2 - 1.6;      // the lanes must be clear (not the kerbs)
  if (!T.free(along ? { x0: s.at - hw, x1: s.at + hw, z0: a0, z1: a1 } : { x0: a0, x1: a1, z0: s.at - hw, z1: s.at + hw }, 0, 2)) return false;
  for (let row = 0; row < 2; row++) {                    // two rows of barriers, each open at the other side
    const a = t + dir * row * 6.5, open = row ? 1 : -1;
    for (let o = -w / 2 + 1.6; o < w / 2 - 1.4; o += 3.1) {
      if (open * o > w / 2 - 5.6) continue;
      const p = onS(s, a, o);
      if (T.claim(P.footprint(p.x, p.z, 0.62, 3.0, yawAcross), 0, 1.2)) P.jersey(kit, p.x, p.z, yawAcross + kit.range(-0.06, 0.06));
    }
    const rw = onS(s, a + dir * 0.9, -open * (w / 4 - 0.6));
    P.razor(kit, rw.x, rw.z, yawAcross, w / 2 - 2);
  }
  for (const side of [-1, 1]) {                          // sandbags on both pavements
    const p = onS(s, t + dir * 2, side * (w / 2 + 1.2));
    if (T.claim(P.footprint(p.x, p.z, 0.8, 5.6, yawAlong), 0, 1.2)) P.sandbags(kit, p.x, p.z, yawAlong + Math.PI / 2, 5, 2);
  }
  const bs = R() < 0.5 ? -1 : 1, bp = onS(s, t + dir * 9, bs * (w / 2 + 1.25));
  if (T.claim(sq(bp, 1.1), 0, 2.6)) P.booth(kit, bp.x, bp.z, yawAlong);
  for (let k = 0; k < 4; k++) {                          // tank traps on the way in
    const p = onS(s, t - dir * kit.range(3, 9), kit.range(-w / 2 + 1, w / 2 - 1));
    if (T.claim(sq(p, 0.7), 0, 1.2)) P.hedgehog(kit, p.x, p.z);
  }
  for (let k = 0; k < 6; k++) {                          // something worth searching behind the sandbags
    const side = k % 2 ? bs : -bs, p = onS(s, t + dir * kit.range(3, 7), side * (w / 2 + kit.range(1.0, 1.6)));
    const face = along ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
    const st = { x: p.x + Math.sin(face) * 1.2, z: p.z + Math.cos(face) * 1.2 };
    if (!T.claim({ x0: Math.min(p.x, st.x) - 0.9, x1: Math.max(p.x, st.x) + 0.9, z0: Math.min(p.z, st.z) - 0.9, z1: Math.max(p.z, st.z) + 0.9 }, 0, 2)) continue;
    addLoot(L, kit, big || R() < 0.5 ? 'military' : 'case', p.x, 0, p.z, face, S.zone(p.x, p.z));
    break;
  }
  if (big) {                                             // at the plaza: a wrecked armoured car, an army lorry, a floodlight
    for (const [back, side] of [[13, 1], [13, -1], [17, 1], [17, -1]]) {
      const ap = onS(s, t - dir * back, side * (w / 2 - 2.7)), ay = yawAlong + 0.3 * side + (dir > 0 ? Math.PI : 0);
      if (!T.claim(P.footprint(ap.x, ap.z, 3.8, 7.0, ay), 0, 3)) continue;
      P.apc(kit, ap.x, ap.z, ay); L.decals.push({ kind: 'scorch', x: ap.x, z: ap.z, r: 4 }); L.props.push({ t: 'apc', x: ap.x, z: ap.z });
      break;
    }
    const tp = onS(s, t + dir * 18, (R() < 0.5 ? -1 : 1) * (w / 2 - 1.8));
    if (T.claim(P.footprint(tp.x, tp.z, 2.7, 8.6, yawAlong), 0, 3.5)) P.truck(kit, tp.x, tp.z, yawAlong + (R() < 0.5 ? Math.PI : 0), { military: true, burnt: R() < 0.4 });
    const fp = onS(s, t + dir * 4, -bs * (w / 2 + 1.0));
    if (T.claim(sq(fp, 0.4), 0, 8)) P.floodlight(kit, fp.x, fp.z, yawAcross + (bs > 0 ? 0 : Math.PI));
  }
  const m = onS(s, t, 0);
  L.props.push({ t: 'checkpoint', x: m.x, z: m.z });
  return true;
}

// ---------- the kerbs: parked wrecks, a bus or a lorry now and then, junk in the gutters ----------
function curbs(S) {
  const { L, kit, R, T } = S;
  let buses = 0, trucks = 0;
  for (const s of L.streets) for (const [a0, a1] of segments(L, s)) {
    if (a1 - a0 < 8) continue;
    const m = onS(s, (a0 + a1) / 2, 0), zone = S.zone(m.x, m.z), edge = Math.max(Math.abs(m.x), Math.abs(m.z)) > 378;
    const fill = edge ? 0.12 : zone === 'red' ? 0.62 : zone === 'yellow' ? 0.4 : 0.34;
    for (const side of [-1, 1]) {
      let a = a0 + kit.range(2, 8);
      while (a < a1 - 4) {
        if (R() > fill) { a += kit.range(6, 18); continue; }
        const r = R();
        if (s.w >= 12 && r < 0.035 && buses < 16 && big(S, s, a, side, 'bus')) { buses++; a += 13; continue; }
        if (r > 0.965 && trucks < 14 && big(S, s, a, side, 'truck')) { trucks++; a += 10; continue; }
        a += (parked(S, s, a, side, zone) || 2.5) + kit.range(0.8, R() < 0.6 ? 3 : 12);
      }
    }
    if (!edge && R() < 0.15) { const p = onS(s, kit.range(a0 + 6, a1 - 6), kit.range(-s.w / 4, s.w / 4)); loose(S, p.x, p.z, zone); }
    for (let k = 0, n = Math.floor((a1 - a0) / 25); k < n; k++) {
      const p = onS(s, kit.range(a0, a1), (R() < 0.5 ? -1 : 1) * (s.w / 2 - kit.range(0.2, 1)));
      if (T.free(sq(p, 0.5), 0, 0.6)) P.bits(kit, p.x, p.z, 0.6, 3);
    }
    if (R() < 0.6) { const p = onS(s, kit.range(a0 + 3, a1 - 3), kit.range(-s.w / 4, s.w / 4)); L.decals.push({ kind: 'manhole', x: p.x, z: p.z }); }
    for (let a = a0 + kit.range(4, 12); a < a1 - 2; a += kit.range(18, 30)) for (const side of [-1, 1]) {
      if (R() < 0.6) { const p = onS(s, a, side * (s.w / 2 - 0.3)); L.decals.push({ kind: 'drain', x: p.x, z: p.z, ax: s.axis }); }
    }
  }
}
function parked(S, s, a, side, zone) {
  const { L, kit, R, T } = S;
  const kind = weighted([['sedan', 30], ['hatch', 22], ['van', 12], ['pickup', 12], ['taxi', zone === 'red' ? 12 : 5], ['police', 2]], R), spec = P.CAR[kind];
  const burnt = R() < (zone === 'red' ? 0.4 : 0.22), flipped = !burnt && R() < 0.05;
  let yaw = yawOf(s, R() < 0.5), off = side * (s.w / 2 - 1.15);
  if (R() < 0.15) { yaw += (R() < 0.5 ? -1 : 1) * kit.range(0.25, 0.8); off -= side * kit.range(0.3, 1.2); }      // crashed into the kerb, or across the lane
  else yaw += kit.range(-0.06, 0.06);
  const p = onS(s, a + spec.len / 2, off);
  if (!T.claim(P.footprint(p.x, p.z, spec.w + 0.3, spec.len + 0.3, yaw), 0, 2)) return 0;
  const boot = P.car(kit, p.x, p.z, yaw, { kind, burnt, flipped });
  S.cars.push({ x: p.x, z: p.z, burnt });
  L.props.push({ t: 'car', x: p.x, z: p.z });
  if (burnt) L.decals.push({ kind: 'scorch', x: p.x, z: p.z, r: kit.range(1.8, 3) });
  else if (R() < 0.3) L.decals.push({ kind: 'oil', x: p.x, z: p.z, r: kit.range(0.6, 1.4) });
  if (boot && !burnt && R() < 0.06) L.containers.push({ type: 'car', x: boot.x, y: 0, z: boot.z, ry: yaw, zone });
  return spec.len;
}
// a car left anywhere, at any angle
function loose(S, x, z, zone) {
  const { L, kit, R, T } = S;
  const kind = kit.pick(['sedan', 'hatch', 'van', 'pickup', 'taxi']), spec = P.CAR[kind], yaw = R() * Math.PI * 2, burnt = R() < (zone === 'red' ? 0.45 : 0.3);
  if (!T.claim(P.footprint(x, z, spec.w + 0.3, spec.len + 0.3, yaw), 0, 2)) return;
  P.car(kit, x, z, yaw, { kind, burnt, flipped: !burnt && R() < 0.1 });
  S.cars.push({ x, z, burnt });
  L.props.push({ t: 'car', x, z });
  if (burnt) L.decals.push({ kind: 'scorch', x, z, r: kit.range(2, 3.2) });
}
function big(S, s, a, side, what) {
  const { L, kit, R, T } = S;
  const len = what === 'bus' ? 11.6 : 8.3, yaw = yawOf(s, R() < 0.5) + kit.range(-0.12, 0.12), p = onS(s, a + len / 2, side * (s.w / 2 - 1.5));
  if (!T.claim(P.footprint(p.x, p.z, 2.9, len + 0.4, yaw), 0, 3.8)) return false;
  const burnt = R() < 0.35;
  if (what === 'bus') P.bus(kit, p.x, p.z, yaw, { burnt }); else P.truck(kit, p.x, p.z, yaw, { burnt, cargo: R() < 0.3 ? 'container' : 'box' });
  S.cars.push({ x: p.x, z: p.z, burnt, big: true });
  L.props.push({ t: what, x: p.x, z: p.z });
  if (burnt) L.decals.push({ kind: 'scorch', x: p.x, z: p.z, r: 4 });
  return true;
}

// ---------- crossings: traffic lights or signs on the corners, a street name, wrecks in the middle ----------
function crossings(S) {
  const { L, kit, R, T } = S;
  for (const c of S.crossings) {
    const d = Math.max(Math.abs(c.x), Math.abs(c.z));
    if (d > 380) continue;
    const zone = S.zone(c.x, c.z), busy = d < 235;
    const cs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ sx, sz, x: c.x + sx * (c.wx / 2 + 0.6), z: c.z + sz * (c.wz / 2 + 0.6) }));
    if (busy && R() < 0.6) {
      for (const k of R() < 0.5 ? [cs[0], cs[3]] : [cs[1], cs[2]]) {
        if (!T.claim(sq(k, 0.35), 0, 6.5)) continue;
        P.trafficLight(kit, k.x, k.z, k.sx > 0 ? -Math.PI / 2 : Math.PI / 2, c.wx / 2 + 0.4, R() < 0.12 ? 'fallen' : 'ok');
        L.props.push({ t: 'lights', x: k.x, z: k.z });
      }
    } else if (R() < 0.6) {
      for (const k of [cs[R() < 0.5 ? 0 : 1], cs[R() < 0.5 ? 2 : 3]]) {
        if (!T.claim(sq(k, 0.25), 0, 3)) continue;
        P.sign(kit, k.x, k.z, k.sz > 0 ? 0 : Math.PI, kit.pick(['stop', 'stop', 'warn', 'round']));
        L.props.push({ t: 'sign', x: k.x, z: k.z });
      }
    }
    if (R() < 0.45) { const k = kit.pick(cs), p = { x: k.x + k.sx * 0.7, z: k.z + k.sz * 0.7 }; if (T.claim(sq(p, 0.25), 0, 3.2)) P.sign(kit, p.x, p.z, k.sz > 0 ? 0 : Math.PI, 'name'); }
    if (R() < (zone === 'red' ? 0.3 : 0.12)) for (let n = 1 + Math.floor(R() * 2); n > 0; n--) loose(S, c.x + kit.range(-c.wx / 3, c.wx / 3), c.z + kit.range(-c.wz / 3, c.wz / 3), zone);
    if (R() < 0.5) L.decals.push({ kind: 'manhole', x: c.x + kit.range(-c.wx / 3, c.wx / 3), z: c.z + kit.range(-c.wz / 3, c.wz / 3) });
    if (busy && R() < 0.25) for (const k of cs) {
      const p = { x: k.x + k.sx * 1.6, z: k.z + k.sz * 0.9 };
      if (R() < 0.5 && T.claim({ x0: p.x - 0.3, x1: p.x + 0.3, z0: p.z - 1.4, z1: p.z + 1.4 }, 0, 1)) P.bollards(kit, p.x, p.z, Math.PI / 2, 3);
    }
  }
}

// ---------- pavements: lights, trees, and what stands about on them ----------
function sidewalks(S) {
  const { L, kit, R, T } = S;
  for (const b of L.blocks) {
    const kind = b.kind;
    for (const side of 'nswe') {
      const along = side === 'n' || side === 's';
      const curb = side === 'n' ? b.z0 : side === 's' ? b.z1 : side === 'w' ? b.x0 : b.x1, inw = side === 'n' || side === 'w' ? 1 : -1;
      const lo = (along ? b.x0 : b.z0) + 3, hi = (along ? b.x1 : b.z1) - 3;
      const pt = (a, d) => along ? { x: a, z: curb + inw * d } : { x: curb + inw * d, z: a };
      const out = side === 'n' ? Math.PI : side === 's' ? 0 : side === 'w' ? -Math.PI / 2 : Math.PI / 2;    // facing the street
      const street = streetBeside(L, b, side), wide = !!street && street.w >= 12, avenue = !!street && street.w >= 16;
      const lamps = kind === 'market' ? 0.25 : kind === 'crater' ? 0.35 : wide ? 0.85 : 0.55;
      if (R() < lamps) for (let a = lo + kit.range(0, 12); a < hi; a += kit.range(26, 34)) {
        const p = pt(a, 0.55);
        if (!T.claim(sq(p, 0.35), 0, 6.5)) continue;
        const r = R();
        P.lamp(kit, p.x, p.z, out, r < 0.06 ? 'lit' : r < 0.18 ? 'bent' : r < 0.27 ? 'fallen' : r < 0.33 ? 'stump' : 'ok');
        L.props.push({ t: 'lamp', x: p.x, z: p.z });
      }
      if (avenue || kind === 'residential' || kind === 'midtown' || (kind === 'downtown' && R() < 0.5)) {
        for (let a = lo + kit.range(2, 8); a < hi; a += kit.range(11, 17)) {
          const p = pt(a, 0.75);
          if (!T.claim(sq(p, 0.9), 0, 6)) continue;
          if (avenue) kit.palm(p.x, p.z, kit.range(7, 10));
          else if (kind === 'downtown') P.planter(kit, p.x, p.z, R() < 0.3 ? 'palm' : 'shrub');
          else if (R() < 0.85) P.deadTree(kit, p.x, p.z, kit.range(3.5, 6), out);
          else P.bush(kit, p.x, p.z);
          if (kind !== 'downtown') L.decals.push({ kind: 'pit', x: p.x, z: p.z });
          L.props.push({ t: 'tree', x: p.x, z: p.z });
        }
      }
      const things = [
        ['bin', kind === 'industrial' ? 0.3 : 0.8], ['hydrant', 0.5], ['bench', kind === 'downtown' || kind === 'midtown' ? 0.4 : 0.15],
        ['busstop', wide && kind !== 'market' && kind !== 'industrial' ? 0.12 : 0], ['kiosk', kind === 'downtown' ? 0.12 : 0.03],
        ['phone', kind === 'downtown' || kind === 'midtown' ? 0.08 : 0.02], ['bin', 0.4], ['cone', 0.1],
        ['barrel', kind === 'industrial' || kind === 'crater' ? 0.4 : 0.1], ['tyres', 0.08],
        ['crates', kind === 'market' ? 0.5 : 0.06], ['goods', kind === 'market' ? 0.6 : 0], ['cart', kind === 'market' ? 0.3 : 0],
      ];
      for (const [what, p0] of things) {
        if (R() > p0) continue;
        for (let t = 0; t < 4; t++) if (pavement(S, what, pt, kit.range(lo, hi), out)) break;
      }
      for (let k = 0, n = Math.floor((hi - lo) / 20); k < n; k++) {
        const p = pt(kit.range(lo, hi), kit.range(0.4, 2.2));
        if (T.free(sq(p, 0.4), 0, 0.5)) P.bits(kit, p.x, p.z, 0.5, 2);
      }
    }
  }
}
function pavement(S, what, pt, a, out) {
  const { L, kit, R, T } = S;
  let p;
  switch (what) {
    case 'bin': p = pt(a, R() < 0.5 ? 0.6 : 2.0); if (!T.claim(sq(p, 0.4), 0, 1.2)) return false; P.bin(kit, p.x, p.z, R() * 6, R() < 0.2); return true;
    case 'hydrant': p = pt(a, 0.45); if (!T.claim(sq(p, 0.3), 0, 1)) return false; P.hydrant(kit, p.x, p.z); return true;
    case 'bench': p = pt(a, 1.0); if (!T.claim(P.footprint(p.x, p.z, 2.0, 0.8, out), 0, 1.2)) return false; P.bench(kit, p.x, p.z, out); L.props.push({ t: 'bench', x: p.x, z: p.z }); return true;
    case 'busstop': p = pt(a, 1.15); if (!T.claim(P.footprint(p.x, p.z, 3.6, 1.8, out), 0, 2.6)) return false; P.busStop(kit, p.x, p.z, out); L.props.push({ t: 'busstop', x: p.x, z: p.z }); return true;
    case 'kiosk': p = pt(a, 1.2); if (!T.claim(P.footprint(p.x, p.z, 2.6, 2.0, out), 0, 2.8)) return false; P.kiosk(kit, p.x, p.z, out); L.props.push({ t: 'kiosk', x: p.x, z: p.z }); return true;
    case 'phone': p = pt(a, 1.8); if (!T.claim(sq(p, 0.55), 0, 2.4)) return false; P.phoneBooth(kit, p.x, p.z, out); return true;
    case 'cone': p = pt(a, kit.range(0.3, 2)); if (!T.claim(sq(p, 0.25), 0, 0.7)) return false; P.cone(kit, p.x, p.z); return true;
    case 'barrel': {
      p = pt(a, 1.5);
      if (!T.claim(sq(p, 0.95), 0, 1)) return false;
      for (const [dx, dz] of [[0, 0], [0.62, 0.12], [0.2, 0.6]].slice(0, 1 + Math.floor(R() * 3))) P.barrel(kit, p.x + dx - 0.25, p.z + dz - 0.25, { tipped: R() < 0.25 });
      return true;
    }
    case 'tyres': p = pt(a, kit.range(1.2, 2.0)); if (!T.claim(sq(p, 0.5), 0, 1)) return false; P.tyres(kit, p.x, p.z, 1 + Math.floor(R() * 3)); return true;
    case 'crates': p = pt(a, 1.6); if (!T.claim(P.footprint(p.x, p.z, 2.4, 1.3, out), 0, 2.2)) return false; P.crates(kit, p.x, p.z, out + Math.PI / 2 + kit.range(-0.2, 0.2), 1 + Math.floor(R() * 3)); return true;
    case 'goods': p = pt(a, 1.6); if (!T.claim(sq(p, 1.0), 0, 1)) return false; P.goods(kit, p.x, p.z); return true;
    case 'cart': p = pt(a, 1.2); if (!T.claim(P.footprint(p.x, p.z, 1.3, 2.6, out + Math.PI / 2), 0, 1.2)) return false; P.cart(kit, p.x, p.z, out + Math.PI / 2 + kit.range(-0.3, 0.3)); return true;
  }
  return false;
}

// ---------- power lines along the older streets: poles at the kerb, wires between them and to the houses ----------
function power(S) {
  const { L, kit, R, T } = S;
  for (const b of L.blocks) {
    if (!['residential', 'market', 'crater'].includes(b.kind) || R() < 0.3) continue;
    const side = R() < 0.5 ? 'n' : 'w', along = side === 'n', curb = along ? b.z0 : b.x0;
    const lo = (along ? b.x0 : b.z0) + 2, hi = (along ? b.x1 : b.z1) - 2;
    const pt = (a, d) => along ? { x: a, z: curb + d } : { x: curb + d, z: a };
    const end = (p, o, y) => along ? { x: p.x, y, z: p.z + o } : { x: p.x + o, y, z: p.z };    // a point on the crossbar
    let prev = null;
    for (let a = lo + kit.range(0, 8); a < hi; a += kit.range(28, 34)) {
      const p = pt(a, 0.4);
      if (!T.claim(sq(p, 0.3), 0, 8.5)) { prev = null; continue; }
      const lean = R() < 0.1 ? kit.range(0.15, 0.35) : 0;
      P.powerPole(kit, p.x, p.z, along ? Math.PI / 2 : 0, lean);
      L.props.push({ t: 'pole', x: p.x, z: p.z });
      if (lean) { prev = null; continue; }
      if (prev) for (const o of [-0.7, 0.7]) P.wire(kit, end(prev, o, 7.65), end(p, o, 7.65), 0.6);
      if (R() < 0.5) {                                   // a line to the house behind, if one stands there tall enough
        const h = pt(a + kit.range(-2, 2), 2.6), f = buildingAt(L, along ? h.x : h.x + 0.3, along ? h.z + 0.3 : h.z);
        if (f && f.h > 6) P.wire(kit, { x: p.x, y: 7.4, z: p.z }, { x: h.x, y: 5.4, z: h.z }, 0.3);
      }
      prev = p;
    }
  }
}

// ---------- alleys: dumpsters, bags of rubbish, barrels, washing hung across ----------
function alleys(S) {
  const { L, kit, R, T } = S;
  for (const a of L.alleys) {
    const ns = a.z1 - a.z0 > a.x1 - a.x0, len = ns ? a.z1 - a.z0 : a.x1 - a.x0, w = ns ? a.x1 - a.x0 : a.z1 - a.z0;
    const pt = (t, o) => ns ? { x: (a.x0 + a.x1) / 2 + o, z: a.z0 + t } : { x: a.x0 + t, z: (a.z0 + a.z1) / 2 + o };
    const yaw = ns ? Math.PI / 2 : 0;
    for (let t = kit.range(5, 12); t < len - 5; t += kit.range(18, 30)) {
      const side = R() < 0.5 ? -1 : 1, p = pt(t, side * (w / 2 - 0.75));
      if (!T.claim(P.footprint(p.x, p.z, 2.1, 1.3, yaw), 0, 1.6)) continue;
      P.dumpster(kit, p.x, p.z, yaw + (side > 0 ? Math.PI : 0));
      L.props.push({ t: 'dumpster', x: p.x, z: p.z });
    }
    for (let t = kit.range(3, 8); t < len - 3; t += kit.range(6, 12)) {
      const side = R() < 0.5 ? -1 : 1, p = pt(t, side * (w / 2 - 0.5));
      if (!T.claim(sq(p, 0.6), 0, 1)) continue;
      if (R() < 0.6) P.trash(kit, p.x, p.z, 3 + Math.floor(R() * 3)); else P.barrel(kit, p.x, p.z, { tipped: R() < 0.4 });
    }
    for (let t = kit.range(4, 10); t < len - 4; t += kit.range(7, 14)) {
      if (R() < 0.35) continue;
      const y = kit.range(3.6, 6.5), pa = pt(t, -w / 2 - 0.05), pb = pt(t + kit.range(-1.5, 1.5), w / 2 + 0.05);
      const fa = buildingAt(L, ns ? pa.x - 0.3 : pa.x, ns ? pa.z : pa.z - 0.3), fb = buildingAt(L, ns ? pb.x + 0.3 : pb.x, ns ? pb.z : pb.z + 0.3);
      if (!fa || !fb || fa.h < y + 0.5 || fb.h < y + 0.5) continue;
      P.laundry(kit, { ...pa, y }, { ...pb, y: y + kit.range(-0.4, 0.4) });
      L.props.push({ t: 'laundry', x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 });
    }
  }
}

// ---------- courtyards, yards and empty lots: junk; a bazaar's canvas and goods; hoardings round some ruins ----------
function lots(S) {
  const { L, kit, R, T } = S;
  const scatter = (r, n, fn) => { for (let k = 0, t = 0; k < n && t < n * 4; t++) if (fn(kit.range(r.x0 + 1.5, r.x1 - 1.5), kit.range(r.z0 + 1.5, r.z1 - 1.5))) k++; };
  for (const y of L.yards) {
    if (y.kind === 'industrial') {
      scatter(y, 4, (x, z) => {
        if (!T.claim(sq({ x, z }, 0.9), 0, 1)) return false;
        if (R() < 0.5) P.pallets(kit, x, z, R() * Math.PI, 1 + Math.floor(R() * 4)); else P.barrel(kit, x, z);
        return true;
      });
      scatter(y, R() < 0.5 ? 1 : 0, (x, z) => { const a = R() * Math.PI * 2; if (!T.claim(P.footprint(x, z, 1.5, 3.2, a), 0, 3)) return false; P.forklift(kit, x, z, a); L.props.push({ t: 'forklift', x, z }); return true; });
      scatter(y, R() < 0.5 ? 2 : 0, (x, z) => { if (!T.claim(sq({ x, z }, 0.9), 0, 1.3)) return false; P.reel(kit, x, z, R() * Math.PI); return true; });
      scatter(y, 2, (x, z) => { if (!T.free(sq({ x, z }, 0.6), 0, 0.5)) return false; P.bits(kit, x, z, 0.8, 3); return true; });
      continue;
    }
    scatter(y, 2 + Math.floor(R() * 3), (x, z) => {
      if (!T.claim(sq({ x, z }, 0.7), 0, 1.1)) return false;
      const r = R();
      if (r < 0.3) P.barrel(kit, x, z, { tipped: R() < 0.3 }); else if (r < 0.5) P.tyres(kit, x, z, 1 + Math.floor(R() * 3)); else if (r < 0.75) P.bush(kit, x, z); else P.trash(kit, x, z, 4);
      return true;
    });
    if (R() < 0.3) scatter(y, 1, (x, z) => { const a = R() < 0.5 ? 0 : Math.PI / 2; if (!T.claim(P.footprint(x, z, 2.1, 1.4, a), 0, 1.6)) return false; P.dumpster(kit, x, z, a); return true; });
    if (y.kind === 'market') {
      for (let k = 0; k < 4; k++) P.canopy(kit, kit.range(y.x0 + 4, y.x1 - 4), kit.range(y.z0 + 4, y.z1 - 4), R() * Math.PI, kit.range(3, 6), kit.range(3, 5));
      scatter(y, 3, (x, z) => { if (!T.claim(sq({ x, z }, 1.0), 0, 1.2)) return false; if (R() < 0.6) P.goods(kit, x, z); else P.cart(kit, x, z, R() * Math.PI * 2); return true; });
      for (let k = 0; k < 3; k++) L.decals.push({ kind: 'rug', x: kit.range(y.x0 + 3, y.x1 - 3), z: kit.range(y.z0 + 3, y.z1 - 3), w: kit.range(1.6, 2.6), d: kit.range(2.2, 3.4), c: kit.pick(P.PC.cloth), a: R() * Math.PI });
    }
  }
  for (const v of L.vacant) scatter(v, 2, (x, z) => {
    if (!T.claim(sq({ x, z }, 0.7), 0, 1)) return false;
    if (R() < 0.5) P.bush(kit, x, z); else P.tyres(kit, x, z, 1 + Math.floor(R() * 2));
    return true;
  });
  for (const r of L.ruins) {                             // corrugated hoarding round some of the ruined lots, with a way in
    if (R() > 0.25 || !r.side) continue;
    const along = r.side === 'n' || r.side === 's';
    const at = r.side === 'n' ? r.z0 + 0.1 : r.side === 's' ? r.z1 - 0.1 : r.side === 'w' ? r.x0 + 0.1 : r.x1 - 0.1;
    const a0 = (along ? r.x0 : r.z0) + 0.3, a1 = (along ? r.x1 : r.z1) - 0.3;
    if (a1 - a0 < 7) continue;
    const g = kit.range(a0 + 1.5, a1 - 4.5);
    for (const [p, q] of [[a0, g], [g + 3, a1]]) {
      if (q - p < 1.2) continue;
      const box = along ? { x0: p, x1: q, z0: at - 0.1, z1: at + 0.1 } : { x0: at - 0.1, x1: at + 0.1, z0: p, z1: q };
      if (T.claim(box, 0, 2.2)) P.hoarding(kit, along ? { x: p, z: at } : { x: at, z: p }, along ? { x: q, z: at } : { x: at, z: q });
    }
    L.props.push({ t: 'hoarding', x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  }
}

// ---------- the plaza: lights round its edge, benches and planters, a burning bus, debris ----------
function plazaLife(S) {
  const { L, kit, R, T } = S, Pz = L.plaza;
  for (const [ax, at] of [['x', Pz.z0 + 1.2], ['x', Pz.z1 - 1.2], ['z', Pz.x0 + 1.2], ['z', Pz.x1 - 1.2]]) {
    const inward = ax === 'x' ? (at < 0 ? 0 : Math.PI) : (at < 0 ? Math.PI / 2 : -Math.PI / 2);
    for (let a = (ax === 'x' ? Pz.x0 : Pz.z0) + 6; a < (ax === 'x' ? Pz.x1 : Pz.z1) - 6; a += kit.range(16, 22)) {
      const p = ax === 'x' ? { x: a, z: at } : { x: at, z: a };
      if (T.claim(sq(p, 0.35), 0, 6.5)) { const r = R(); P.lamp(kit, p.x, p.z, inward, r < 0.2 ? 'bent' : r < 0.32 ? 'fallen' : r < 0.4 ? 'lit' : 'ok'); L.props.push({ t: 'lamp', x: p.x, z: p.z }); }
      const q = ax === 'x' ? { x: a + 8, z: at + (at < 0 ? 2 : -2) } : { x: at + (at < 0 ? 2 : -2), z: a + 8 };
      if (R() < 0.5) { if (T.claim(P.footprint(q.x, q.z, 2.0, 0.8, inward), 0, 1.2)) P.bench(kit, q.x, q.z, inward); }
      else if (R() < 0.5 && T.claim(sq(q, 0.8), 0, 1)) P.planter(kit, q.x, q.z);
    }
  }
  const bx = kit.range(-35, 35), bz = Pz.z0 + 9, by = Math.PI / 2 + 0.25;
  if (T.claim(P.footprint(bx, bz, 3, 12.2, by), 0, 3.5)) {
    P.bus(kit, bx, bz, by, { burnt: true });
    L.decals.push({ kind: 'scorch', x: bx, z: bz, r: 5 });
    L.fires.push({ x: bx, y: 2.0, z: bz, s: 1.5 });
    L.props.push({ t: 'bus', x: bx, z: bz });
  }
  for (let k = 0; k < 30; k++) { const x = kit.range(Pz.x0 + 2, Pz.x1 - 2), z = kit.range(Pz.z0 + 2, Pz.z1 - 2); if (T.free(sq({ x, z }, 0.5), 0, 0.5)) P.bits(kit, x, z, 0.8, 3); }
}

// ---------- fires: some burnt wrecks still burn, and oil drums in a few courtyards ----------
function fires(S) {
  const { L, kit, R, T } = S;
  const burnt = S.cars.filter(c => c.burnt);
  for (let i = burnt.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [burnt[i], burnt[j]] = [burnt[j], burnt[i]]; }
  let n = 0;
  for (const c of burnt) {
    if (n >= 6) break;
    if (L.fires.some(f => Math.hypot(f.x - c.x, f.z - c.z) < 90)) continue;
    L.fires.push({ x: c.x, y: c.big ? 2.2 : 1.3, z: c.z, s: c.big ? 1.4 : 1.0 });
    n++;
  }
  const yards = L.yards.filter(y => y.kind !== 'industrial');
  for (let k = 0, t = 0; k < 4 && t < 40 && yards.length; t++) {
    const y = kit.pick(yards), x = kit.range(y.x0 + 3, y.x1 - 3), z = kit.range(y.z0 + 3, y.z1 - 3);
    if (L.fires.some(f => Math.hypot(f.x - x, f.z - z) < 60) || !T.claim(sq({ x, z }, 0.6), 0, 1.5)) continue;
    P.barrel(kit, x, z, { c: 0x3a302a });
    L.fires.push({ x, y: 0.95, z, s: 0.55 });
    L.decals.push({ kind: 'scorch', x, z, r: 1.4 });
    k++;
  }
}
