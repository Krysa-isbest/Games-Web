// The buildings of The Ruins, as plain data on a Kit (kit.js):
//   enterable(L, kit, b)  doors, windows, a stairwell with ramps up every floor (and to the roof), rooms,
//                         furniture, places for loot and for Scatter nests
//   solid(L, kit, b)      a closed block: window panes, floor bands, a broken top, rooftop clutter
//   warehouse(L, kit, b)  one tall hall with big doorways, shelving and loot (the industrial yard)
// b = { x0, z0, x1, z1, floors, doors: ['n' | 's' | 'e' | 'w'], roof, ruin (0..1), zone, nest }
import { K, FLOOR, WALL, SLAB, COL, containerLook, DEG } from './kit.js';

const RUN = FLOOR / Math.tan(35 * DEG);         // how far a stair ramp runs for one floor (35°)
const SW = 1.7;                                // stairwell width
const DOOR = { w: 1.6, b: 0, t: 2.5 };

// where loot goes: a container record for the layout (rolled when someone searches it)
function addLoot(L, kit, type, x, y, z, ry, zone) {
  containerLook(kit, type, x, y, z, ry);
  L.containers.push({ type, x, y, z, ry, zone });
}

export function enterable(L, kit, b) {
  const R = kit.R, c = b.color ?? kit.pick(b.white ? COL.white : COL.plaster);
  const W = b.x1 - b.x0, D = b.z1 - b.z0, n = b.floors;
  const ix0 = b.x0 + WALL, ix1 = b.x1 - WALL, iz0 = b.z0 + WALL, iz1 = b.z1 - WALL;
  // the stairwell runs north along the west or the east wall
  const west = R() < 0.5;
  const sx0 = west ? ix0 : ix1 - SW, sx1 = sx0 + SW, sz0 = iz0 + 1.4, sz1 = sz0 + RUN;
  const stairs = D >= RUN + 4 && (n > 1 || b.roof);
  // doors: centred on their side, away from the stairwell
  const doorAt = {};
  for (const s of b.doors) {
    if (s === 'n' || s === 's') {
      let x = (b.x0 + b.x1) / 2 + kit.range(-0.2, 0.2) * W;
      if (stairs && x > sx0 - 1.2 && x < sx1 + 1.2 && s === 's') x = west ? sx1 + 1.6 : sx0 - 1.6;
      doorAt[s] = Math.max(b.x0 + 1.4, Math.min(b.x1 - 1.4, x));
    } else doorAt[s] = (b.z0 + b.z1) / 2 + kit.range(-0.2, 0.2) * D;
  }
  // an inside wall splits each floor into a west and an east room, with a doorway
  const part = W >= 9.5 && D >= 7.5;
  const px = west ? Math.max(sx1 + 2.2, b.x0 + W * 0.45) : Math.min(sx0 - 2.2, b.x1 - W * 0.45);
  const pdoor = (b.z0 + b.z1) / 2 + kit.range(-0.25, 0.25) * D;

  for (let f = 0; f < n; f++) {
    const y0 = f * FLOOR, top = f === n - 1;
    const jag = top && b.ruin > 0.45 ? b.ruin * 0.6 : 0;
    const wins = (a0, a1, side) => {
      const out = [];
      const len = a1 - a0, count = Math.max(0, Math.floor((len - 1.5) / 3.4));
      const start = a0 + (len - (count - 1) * 3.4) / 2;
      for (let i = 0; i < count; i++) {
        const a = start + i * 3.4;
        if (f === 0 && doorAt[side] !== undefined && Math.abs(a - doorAt[side]) < 2.2) continue;
        if (R() < 0.22) continue;
        const big = R() < b.ruin * 0.25;                           // a blown-out hole
        out.push({ a, w: big ? 2.4 : 1.3, b: big ? 0.4 : 1.0, t: big ? 2.9 : 2.3 });
      }
      if (f === 0 && doorAt[side] !== undefined) out.push({ a: doorAt[side], ...DOOR });
      return out;
    };
    kit.wall('x', b.z0 + WALL / 2, b.x0, b.x1, y0, FLOOR, wins(b.x0, b.x1, 'n'), c, { jag });
    kit.wall('x', b.z1 - WALL / 2, b.x0, b.x1, y0, FLOOR, wins(b.x0, b.x1, 's'), c, { jag });
    kit.wall('z', b.x0 + WALL / 2, iz0, iz1, y0, FLOOR, wins(iz0, iz1, 'w'), c, { jag });
    kit.wall('z', b.x1 - WALL / 2, iz0, iz1, y0, FLOOR, wins(iz0, iz1, 'e'), c, { jag });
    // the floor of this storey (the ground floor just gets a finish) and the inside wall
    if (f === 0) kit.box((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2, W - 0.1, 0.04, D - 0.1, COL.floor, { col: false });
    else kit.slab(ix0, iz0, ix1, iz1, y0, COL.slab, stairs ? { x0: sx0, z0: sz0 + 1.2, x1: sx1, z1: sz1 } : null);
    if (part) kit.wall('z', px, iz0, iz1, y0, FLOOR - SLAB, [{ a: pdoor, w: 1.4, b: 0, t: 2.4 }], COL.inner, { t: 0.2 });
    // the stair ramp up to the next floor (or the roof), with steps drawn on it
    if (stairs && (f < n - 1 || b.roof)) {
      const xm = (sx0 + sx1) / 2;
      kit.ramp({ x: xm, y: y0, z: sz0 }, { x: xm, y: y0 + FLOOR, z: sz1 }, SW - 0.08, 0.3, COL.slab);
      L.stairs.push({ x: xm, z0: sz0, z1: sz1, y0, y1: y0 + FLOOR, roof: f === n - 1 });
      for (let i = 0; i < 12; i++) {
        const k = (i + 0.5) / 12;
        kit.box(xm, y0 + k * FLOOR - 0.12, sz0 + k * RUN, SW - 0.1, 0.2, RUN / 12, COL.inner, { col: false });
      }
    }
    // furniture and loot, against the walls of the room that has no stairs
    const spots = [];
    const rx0 = part ? (west ? px + 0.6 : ix0 + 0.6) : ix0 + 0.6, rx1 = part ? (west ? ix1 - 0.6 : px - 0.6) : ix1 - 0.6;
    for (let x = rx0 + 0.6; x < rx1 - 0.5; x += 2.4) { spots.push({ x, z: iz0 + 0.55, ry: 0, side: 'n' }); spots.push({ x, z: iz1 - 0.55, ry: Math.PI, side: 's' }); }
    for (let z = iz0 + 1.6; z < iz1 - 1.5; z += 2.4) {
      if (!part || !west) spots.push({ x: ix1 - 0.55, z, ry: -Math.PI / 2, side: 'e' });
      if (!part || west) spots.push({ x: ix0 + 0.55, z, ry: Math.PI / 2, side: 'w' });
    }
    const ok = s => !(stairs && s.x > sx0 - 1 && s.x < sx1 + 1 && s.z > sz0 - 1.5 && s.z < sz1 + 1.5) &&
      !(f === 0 && doorAt[s.side] !== undefined && Math.abs((s.side === 'n' || s.side === 's' ? s.x : s.z) - doorAt[s.side]) < 1.8) &&
      !(part && Math.abs(s.x - px) < 1.2 && Math.abs(s.z - pdoor) < 1.6);
    const free = spots.filter(ok);
    for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
    const loot = Math.min(free.length, (R() < 0.75 ? 1 : 0) + (R() < 0.35 ? 1 : 0) + (b.rich ? 1 : 0));
    for (let i = 0; i < free.length && i < loot + 2; i++) {
      const s = free[i];
      if (i < loot) addLoot(L, kit, pickType(kit, b), s.x, y0, s.z, s.ry, b.zone);
      else if (R() < 0.6) {
        if (R() < 0.5) kit.box(s.x, y0, s.z, s.side === 'n' || s.side === 's' ? 1.8 : 0.5, 1.7, s.side === 'n' || s.side === 's' ? 0.5 : 1.8, 0x6b5a46);  // a shelf
        else kit.box(s.x, y0, s.z, 1.4, 0.8, 0.8, 0x5d4c3c);                                                                                       // a table
      }
    }
    if (f === 0 && b.nest && part) L.nestSpots.push({ x: (rx0 + rx1) / 2, y: 0.1, z: (iz0 + iz1) / 2, zone: b.zone });
    else if (f === 0 && b.nest) L.nestSpots.push({ x: west ? (sx1 + ix1) / 2 : (ix0 + sx0) / 2, y: 0.1, z: (iz0 + iz1) / 2 + 1, zone: b.zone });
  }
  // the roof: a slab (part of it gone on a ruin), parapets you can hide behind, clutter
  const topY = n * FLOOR;
  const hole = stairs && b.roof ? { x0: sx0, z0: sz0 + 1.2, x1: sx1, z1: sz1 } : null;
  if (b.ruin > 0.7 && !b.roof) {
    // a collapsed corner: the roof is missing over a quarter of the building (the sky shows through)
    const cx = R() < 0.5 ? ix0 : (ix0 + ix1) / 2, cz = R() < 0.5 ? iz0 : (iz0 + iz1) / 2;
    kit.slab(ix0, iz0, ix1, iz1, topY, COL.slab, { x0: cx, z0: cz, x1: cx + (ix1 - ix0) / 2, z1: cz + (iz1 - iz0) / 2 });
  } else kit.slab(ix0, iz0, ix1, iz1, topY, COL.slab, hole);
  if (b.roof) {
    kit.wall('x', b.z0 + 0.12, b.x0, b.x1, topY, 1.0, [], c, { t: 0.25 });
    kit.wall('x', b.z1 - 0.12, b.x0, b.x1, topY, 1.0, [], c, { t: 0.25 });
    kit.wall('z', b.x0 + 0.12, b.z0, b.z1, topY, 1.0, [], c, { t: 0.25 });
    kit.wall('z', b.x1 - 0.12, b.z0, b.z1, topY, 1.0, [], c, { t: 0.25 });
    if (R() < 0.6) kit.box(west ? ix1 - 1.5 : ix0 + 1.5, topY, iz1 - 1.6, 1.4, 1.1, 1.0, kit.pick(COL.metal));   // an AC unit
    L.roofs.push({ x: (b.x0 + b.x1) / 2, y: topY, z: (b.z0 + b.z1) / 2, zone: b.zone });
  } else kit.box((b.x0 + b.x1) / 2, topY, (b.z0 + b.z1) / 2, W + 0.4, 0.35, D + 0.4, COL.trim, { col: false });
  // outside: awnings over the doors, rubble against a wall on a ruin
  for (const [s, a] of Object.entries(doorAt)) {
    const aw = kit.pick(COL.awning);
    if (s === 'n') kit.box(a, 2.75, b.z0 - 0.55, 2.4, 0.08, 1.1, aw, { col: false });
    if (s === 's') kit.box(a, 2.75, b.z1 + 0.55, 2.4, 0.08, 1.1, aw, { col: false });
    if (s === 'w') kit.box(b.x0 - 0.55, 2.75, a, 1.1, 0.08, 2.4, aw, { col: false });
    if (s === 'e') kit.box(b.x1 + 0.55, 2.75, a, 1.1, 0.08, 2.4, aw, { col: false });
  }
  if (b.ruin > 0.5) kit.rubble(west ? b.x1 + 1.5 : b.x0 - 1.5, (b.z0 + b.z1) / 2, 2.6, 5);
  L.footprints.push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: topY, open: true });
  L.interiors.push({ x0: ix0, z0: iz0, x1: ix1, z1: iz1, y0: 0, y1: topY });
}

// what kind of container a building holds, by where it is
function pickType(kit, b) {
  const r = kit.R();
  if (b.kind === 'shop') return r < 0.45 ? 'locker' : r < 0.75 ? 'medcab' : 'crate';
  if (b.kind === 'office') return r < 0.5 ? 'locker' : r < 0.7 ? 'medcab' : r < 0.9 ? 'case' : 'crate';
  if (b.kind === 'house') return r < 0.4 ? 'locker' : r < 0.65 ? 'medcab' : r < 0.85 ? 'toolbox' : 'crate';
  return r < 0.35 ? 'locker' : r < 0.55 ? 'toolbox' : r < 0.75 ? 'medcab' : r < 0.93 ? 'crate' : 'case';
}

export function solid(L, kit, b) {
  const R = kit.R, c = b.color ?? kit.pick(b.stone ? COL.stone : COL.plaster);
  const W = b.x1 - b.x0, D = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  let n = b.floors;
  const broken = b.ruin > 0.5 && n >= 3;
  const keep = broken ? n - 1 - Math.floor(R() * Math.min(3, n - 2)) : n;      // floors still whole
  kit.box(cx, 0, cz, W, keep * FLOOR, D, c);
  if (broken) {
    // the broken top: a few columns of what is left, at different heights
    const parts = 2 + Math.floor(R() * 3);
    for (let i = 0; i < parts; i++) {
      const w = W * kit.range(0.25, 0.55), d = D * kit.range(0.25, 0.55);
      const x = b.x0 + w / 2 + R() * (W - w), z = b.z0 + d / 2 + R() * (D - d);
      kit.box(x, keep * FLOOR, z, w, FLOOR * kit.range(0.5, n - keep), d, c);
    }
    kit.rubble(R() < 0.5 ? b.x0 - 2 : b.x1 + 2, cz + kit.range(-0.3, 0.3) * D, 3.5, 6);
  }
  // floor bands and windows (dark quads, cheap)
  for (let f = 0; f < keep; f++) {
    const y = f * FLOOR + 1.75;
    if (f % 2 === 1) kit.box(cx, f * FLOOR - 0.12, cz, W + 0.24, 0.24, D + 0.24, COL.trim, { col: false });
    const gap = b.shop && f === 0 ? 4.4 : 3.4, ww = b.shop && f === 0 ? 3.4 : 1.3, wh = b.shop && f === 0 ? 2.4 : 1.5, wy = b.shop && f === 0 ? 1.4 : y;
    const skip = f === 0 && !b.shop ? 0.5 : 0.18;
    kit.panesAlong('n', b.z0, b.x0, b.x1, wy, ww, wh, gap, skip);
    kit.panesAlong('s', b.z1, b.x0, b.x1, wy, ww, wh, gap, skip);
    kit.panesAlong('w', b.x0, b.z0, b.z1, wy, ww, wh, gap, skip);
    kit.panesAlong('e', b.x1, b.z0, b.z1, wy, ww, wh, gap, skip);
  }
  if (!broken) {
    const top = keep * FLOOR;
    kit.box(cx, top, cz, W + 0.3, 0.5, D + 0.3, COL.trim, { col: false });       // the cornice
    if (R() < 0.5) kit.box(cx + kit.range(-0.3, 0.3) * W, top + 0.5, cz + kit.range(-0.3, 0.3) * D, 2.2, 1.6, 2.2, kit.pick(COL.rust), { col: false });
    if (R() < 0.3) kit.box(cx + kit.range(-0.3, 0.3) * W, top + 0.5, cz + kit.range(-0.3, 0.3) * D, 0.15, kit.range(3, 7), 0.15, COL.metal[0], { col: false });
  }
  L.footprints.push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: keep * FLOOR, open: false });
}

export function warehouse(L, kit, b) {
  const R = kit.R, c = b.color ?? kit.pick(COL.metal), H = 7.5;
  const W = b.x1 - b.x0, D = b.z1 - b.z0, ix0 = b.x0 + WALL, ix1 = b.x1 - WALL, iz0 = b.z0 + WALL, iz1 = b.z1 - WALL;
  const big = { w: 5.5, b: 0, t: 5.2 };
  const op = s => b.doors.includes(s) ? [{ a: s === 'n' || s === 's' ? (b.x0 + b.x1) / 2 : (b.z0 + b.z1) / 2, ...big }] : [];
  // high windows: a row of dark panes, not openings
  kit.wall('x', b.z0 + WALL / 2, b.x0, b.x1, 0, H, op('n'), c, { jag: b.ruin * 0.3 });
  kit.wall('x', b.z1 - WALL / 2, b.x0, b.x1, 0, H, op('s'), c, { jag: b.ruin * 0.3 });
  kit.wall('z', b.x0 + WALL / 2, iz0, iz1, 0, H, op('w'), c, { jag: b.ruin * 0.3 });
  kit.wall('z', b.x1 - WALL / 2, iz0, iz1, 0, H, op('e'), c, { jag: b.ruin * 0.3 });
  kit.panesAlong('n', b.z0, b.x0, b.x1, 6.2, 2.2, 0.9, 3.2, 0.1);
  kit.panesAlong('s', b.z1, b.x0, b.x1, 6.2, 2.2, 0.9, 3.2, 0.1);
  kit.box((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2, W - 0.1, 0.04, D - 0.1, 0x6f6658, { col: false });
  // the roof, with a few holes the light comes through
  kit.slab(ix0, iz0, ix1, iz1, H, COL.metal[2], R() < 0.7 ? { x0: ix0 + W * 0.3, z0: iz0 + D * 0.35, x1: ix0 + W * 0.45, z1: iz0 + D * 0.6 } : null, { thick: 0.25 });
  // shelving rows (cover) with loot between them
  const rows = Math.max(1, Math.floor((W - 8) / 6));
  for (let i = 0; i < rows; i++) {
    const x = b.x0 + 5 + i * 6 + kit.range(-0.5, 0.5);
    const len = D * kit.range(0.35, 0.55), z = (b.z0 + b.z1) / 2 + kit.range(-0.15, 0.15) * D;
    kit.box(x, 0, z, 1.0, 2.6, len, 0x6b5a46);
    if (R() < 0.6) kit.box(x + 1.4, 0, z - len / 2 + 1, 1.2, 1.2, 1.2, kit.pick(COL.rust));
    if (R() < 0.55) addLoot(L, kit, R() < 0.5 ? 'crate' : 'toolbox', x + 1.4, 0, z + kit.range(-0.3, 0.3) * len, Math.PI / 2, b.zone);
  }
  if (R() < 0.5) addLoot(L, kit, 'locker', ix1 - 0.5, 0, iz1 - 1.5, -Math.PI / 2, b.zone);
  if (b.nest) L.nestSpots.push({ x: b.x1 - 3, y: 0.1, z: (b.z0 + b.z1) / 2 + kit.range(-0.25, 0.25) * D, zone: b.zone });     // past the last shelf row
  L.footprints.push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: H, open: true });
  L.interiors.push({ x0: ix0, z0: iz0, x1: ix1, z1: iz1, y0: 0, y1: H });
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
