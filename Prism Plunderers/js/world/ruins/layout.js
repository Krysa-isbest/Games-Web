// The Ruins (DESIGN 11): a ruined desert city of 800 m x 800 m, made from a seed. The same seed builds the same
// city on every computer, so co-op can share it with one number. Plain data only (see kit.js).
//
// North is -z. Eleven streets each way (10 to 20 m wide) cut the city into blocks of about 65 m. Every block is
// built up round its edge, buildings shoulder to shoulder facing the streets, with a courtyard inside that you
// reach through gaps, alleys and ruined lots. The districts:
//   Downtown (red zone, the centre): tall blocks round the plaza with the Collapsed Tower; its fallen top is a
//     ramp up to a room full of loot. A Roach walks the plaza; a Swatter circles it.
//   Midtown and the residential streets: offices and flats, then houses with balconies further out.
//   Industrial yard (yellow, north-east): warehouses, container yards, and the Underground Base (Scatter nests).
//   Old market (yellow, south-west): small houses tight together, a bazaar inside every block.
//   Pod crater (yellow, north-west): a giant crashed Prism pod in a crater that took half a district with it.
//   The highway runs east-west south of downtown on pillars, broken in the middle.
//   The city's edge: sand, wrecks, a few shacks; three extraction points and six drop zones.
import { Kit, K, COL, FLOOR, WALL, containerLook } from './kit.js';
import { building, warehouse, containerStack, stall, addLoot } from './buildings.js';

export const HALF = 400;
// street centre lines (x of the north-south streets, z of the east-west ones) and how wide they are
export const XS = [-372, -300, -228, -150, -70, 0, 70, 150, 226, 300, 372];
export const ZS = [-372, -298, -226, -150, -70, 0, 70, 140, 220, 298, 372];
export const WX = [10, 11, 12, 12, 14, 16, 14, 12, 12, 11, 10];
export const WZ = [10, 11, 12, 12, 14, 16, 14, 20, 12, 11, 10];
export const WALK = 2.5;                                 // the sidewalks round every block
export const STREET_END = 392;                           // the streets run out into the sand here
export const PLAZA = { x0: -63, z0: -63, x1: 63, z1: 63 };
export const HWY = { z: 140, y: 7.2, w: 16, gap: [14, 56], end: 300, foot: 360 };   // the deck along z = 140, 7.2 m up
export const ZONES = [
  { kind: 'red', name: 'Downtown', x: 0, z: 0, r: 130 },
  { kind: 'yellow', name: 'Industrial yard', x: 255, z: -250, r: 115 },
  { kind: 'yellow', name: 'Old market', x: -255, z: 255, r: 115 },
  { kind: 'yellow', name: 'Pod crater', x: -215, z: -215, r: 80 },
];
export function zoneAt(x, z) {
  for (const k of ['red', 'yellow']) for (const zn of ZONES) if (zn.kind === k && Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn;
  return null;
}
export const zoneKind = (x, z) => (zoneAt(x, z) || { kind: 'outer' }).kind;
// the Underground Base: the ramp comes up in the middle of an industrial block, facing the street to its south
const BX = 263, BZ = -236;
export const BUNKER = { x0: BX - 34, z0: BZ - 62, x1: BX + 34, z1: BZ, floor: -6, ramp: { x0: BX - 4, x1: BX + 4, z0: BZ - 18, z1: BZ }, hall: { x: BX, z: BZ - 32 } };
export const TOWER = { x0: -11, z0: -31, x1: 11, z1: -9, breach: 20.4 };
export const CRATER = { x: -215, z: -215, r: 55 };
export const EXTRACTS = [{ id: 'north', name: 'North Relay', x: 0, z: -386 }, { id: 'east', name: 'Rail Yard', x: 386, z: 220 }, { id: 'west', name: 'Dune Pad', x: -386, z: 298 }];
export const DROPS = [[-386, -150], [-150, 386], [150, 386], [386, -70], [150, -386], [-386, 70]];

// what each district builds: lot widths and depths (m), floors, and how often a lot is a building you can enter,
// has a shop, is left open (a way into the courtyard), is a heap of rubble, has balconies, sits behind a front yard
const PROFILES = {
  downtown:    { width: [15, 24], depth: [15, 20], floors: [4, 8], open: 0.45, shop: 0.6, gap: 0.08, ruin: 0.1, balconies: 0, setback: 0, style: ['downtown'] },
  midtown:     { width: [13, 20], depth: [13, 17], floors: [3, 5], open: 0.5, shop: 0.4, gap: 0.1, ruin: 0.1, balconies: 0.3, setback: 0.12, style: ['downtown', 'residential'] },
  residential: { width: [12, 18], depth: [11, 15], floors: [2, 4], open: 0.5, shop: 0.15, gap: 0.14, ruin: 0.12, balconies: 0.45, setback: 0.35, style: ['residential'] },
  market:      { width: [8, 13], depth: [9, 12], floors: [1, 3], open: 0.65, shop: 0.5, gap: 0.1, ruin: 0.12, balconies: 0.15, setback: 0, style: ['market'] },
  crater:      { width: [11, 17], depth: [11, 14], floors: [1, 3], open: 0.45, shop: 0.1, gap: 0.22, ruin: 0.3, balconies: 0.2, setback: 0.15, style: ['residential', 'market'] },
};
const DAMAGE = { red: 0.75, yellow: 0.55, outer: 0.42 };
const NEST = { red: 0.07, yellow: 0.08, outer: 0.03 };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

export function makeRuins(seed = 3000) {
  const kit = new Kit(seed);
  const L = {
    seed, half: HALF,
    boxes: kit.boxes, panes: kit.panes, wedges: kit.wedges,
    containers: [], nestSpots: [], roofs: [], footprints: [], interiors: [], stairs: [], floorSpots: [], heaps: [],
    streets: [], blocks: [], yards: [], ruins: [], vacant: [], alleys: [], squares: [],
    crystals: [], pods: [], signs: [], dunes: [], groundItems: [],
    prism: [], spawns: [], extracts: [], landmarks: [], holes: [], dark: [],
    zones: ZONES, hwy: HWY, tower: TOWER, crater: CRATER, bunker: BUNKER, plaza: PLAZA,
  };
  streets(L);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) block(L, kit, i, j);
  plaza(L, kit);
  highway(L, kit);
  bunker(L, kit);
  crater(L, kit);
  edges(L, kit);
  prismGroups(L, kit);
  looseItems(L, kit);
  pruneBlocked(L);
  L.landmarks.push(
    { name: 'Collapsed Tower', short: 'Tower', x: 0, z: -20, kind: 'landmark' },
    { name: 'Underground Base', short: 'Base', x: BX, z: BZ, kind: 'landmark' },
    { name: 'Pod Crater', short: 'Crater', x: CRATER.x, z: CRATER.z, kind: 'landmark' },
    { name: 'Old Market', short: 'Market', x: -255, z: 255, kind: 'landmark' },
    { name: 'Highway', short: 'Highway', x: 200, z: HWY.z, kind: 'landmark' },
  );
  return L;
}

// ---------- the streets (painted on the ground, see groundmap.js) ----------
function streets(L) {
  const E = STREET_END;
  for (let i = 0; i < XS.length; i++) {
    const x = XS[i], w = WX[i];
    for (const [a, b] of i === 5 ? [[-E, PLAZA.z0], [PLAZA.z1, E]] : [[-E, E]]) L.streets.push({ axis: 'z', at: x, w, x0: x - w / 2, x1: x + w / 2, z0: a, z1: b });
  }
  for (let j = 0; j < ZS.length; j++) {
    const z = ZS[j], w = WZ[j];
    for (const [a, b] of j === 5 ? [[-E, PLAZA.x0], [PLAZA.x1, E]] : [[-E, E]]) L.streets.push({ axis: 'x', at: z, w, x0: a, x1: b, z0: z - w / 2, z1: z + w / 2 });
  }
}
export function onStreet(L, x, z, m = 0) {
  for (const s of L.streets) if (x > s.x0 - m && x < s.x1 + m && z > s.z0 - m && z < s.z1 + m) return true;
  return false;
}

// ---------- one city block ----------
function district(i, j, cx, cz) {
  if (Math.abs(cx) < 155 && Math.abs(cz) < 155) return 'downtown';
  if (cx > 150 && cz < -150) return 'industrial';
  if (cx < -150 && cz > 150) return 'market';
  if (cx < -150 && cz < -150) return 'crater';
  if (i >= 2 && i <= 7 && j >= 2 && j <= 7) return 'midtown';
  return 'residential';
}
function block(L, kit, i, j) {
  if (i >= 4 && i <= 5 && j >= 4 && j <= 5) return;                         // the plaza
  const A = { x0: XS[i] + WX[i] / 2, x1: XS[i + 1] - WX[i + 1] / 2, z0: ZS[j] + WZ[j] / 2, z1: ZS[j + 1] - WZ[j + 1] / 2 };
  const kind = district(i, j, (A.x0 + A.x1) / 2, (A.z0 + A.z1) / 2);
  L.blocks.push({ ...A, kind });
  const In = { x0: A.x0 + WALK, z0: A.z0 + WALK, x1: A.x1 - WALK, z1: A.z1 - WALK };
  if (i === 8 && j === 1) return baseYard(L, kit, In);
  if (kind === 'industrial') return industrial(L, kit, In);
  const r = kit.R(), W = In.x1 - In.x0, D = In.z1 - In.z0;
  if ((kind === 'residential' || kind === 'midtown') && r < 0.1 && !nearCrater(In.x0, In.z0, In.x1, In.z1, 10)) return square(L, kit, In, kind);
  if (kind !== 'crater' && r < (kind === 'market' ? 0.65 : 0.38) && Math.min(W, D) > 46) {
    // an alley through the middle: two half blocks, built up all round (the buildings face the alley too)
    const a = kit.range(4.5, 6), ns = W > D + 4 || (Math.abs(W - D) <= 4 && kit.R() < 0.5);
    const mid = ns ? (In.x0 + In.x1) / 2 + kit.range(-6, 6) : (In.z0 + In.z1) / 2 + kit.range(-6, 6);
    const halves = ns ? [{ ...In, x1: mid - a / 2 }, { ...In, x0: mid + a / 2 }] : [{ ...In, z1: mid - a / 2 }, { ...In, z0: mid + a / 2 }];
    L.alleys.push(ns ? { x0: mid - a / 2, z0: In.z0, x1: mid + a / 2, z1: In.z1 } : { x0: In.x0, z0: mid - a / 2, x1: In.x1, z1: mid + a / 2 });
    for (const h of halves) ring(L, kit, h, kind);
    return;
  }
  ring(L, kit, In, kind);
}

// a small square instead of a courtyard block: buildings along two sides, paving, palms in rows, benches, a monument
function square(L, kit, In, kind) {
  const R = kit.R, ns = R() < 0.5;                     // ns: the buildings stand along the north and south streets
  const P = PROFILES[kind], d = kit.range(...P.depth);
  const rows = ns ? [{ ...In, z1: In.z0 + d }, { ...In, z0: In.z1 - d }] : [{ ...In, x1: In.x0 + d }, { ...In, x0: In.x1 - d }];
  for (const [k, row] of rows.entries()) {
    const lots = [], along = ns, len = along ? row.x1 - row.x0 : row.z1 - row.z0;
    const side = ns ? (k ? 's' : 'n') : (k ? 'e' : 'w');
    for (const [a, b] of splitRun(kit, len, P.width[0], P.width[1])) lots.push(along ? { side, x0: row.x0 + a, x1: row.x0 + b, z0: row.z0, z1: row.z1, kind: 'building', corner: null }
      : { side, x0: row.x0, x1: row.x1, z0: row.z0 + a, z1: row.z0 + b, kind: 'building', corner: null });
    for (const lot of lots) { lot.front = OPP[side]; lot.f = { x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 }; }
    blanks(lots);
    for (const lot of lots) {                          // facing the square, shops opening onto it
      const zone = zoneKind((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2), floors = irange(kit, P.floors);
      const open = R() < P.open ? (floors <= 3 ? floors : 1 + Math.floor(R() * 3)) : 0;
      building(L, kit, { ...lot.f, floors, open, front: OPP[side], back: side, blank: lot.blank, shop: R() < 0.6, style: kit.pick(P.style), zone,
        damage: Math.max(0.15, Math.min(1, DAMAGE[zone] + kit.range(-0.15, 0.2))), nest: open > 0 && R() < NEST[zone], rich: zone === 'red',
        roof: open === floors && R() < 0.55, balconies: R() < P.balconies });
    }
  }
  // the square itself, between the two rows
  const S =ns ? { x0: In.x0, z0: In.z0 + d + 1, x1: In.x1, z1: In.z1 - d - 1 } : { x0: In.x0 + d + 1, z0: In.z0, x1: In.x1 - d - 1, z1: In.z1 };
  L.squares.push(S);
  const cx = (S.x0 + S.x1) / 2, cz = (S.z0 + S.z1) / 2, zone = zoneKind(cx, cz);
  const taken = [{ x: cx, z: cz, m: 2.4 }, { x: cx + 3.5, z: cz + 2, m: 2 }];
  const clear = (x, z, m) => taken.every(p => Math.hypot(p.x - x, p.z - z) > m + p.m);
  kit.box(cx, 0, cz, 3.2, 0.9, 3.2, COL.stone[2]);                                    // a monument: plinth, column, a broken figure
  kit.box(cx, 0.9, cz, 1.4, 3.2, 1.4, COL.stone[0]);
  kit.cbox(cx + 0.2, 4.6, cz, 0.9, 1.4, 0.7, COL.stone[3], { rz: 0.25, col: false });
  kit.rubble(cx + 3.5, cz + 2, 1.6, 3);
  if (R() < 0.5) { addLoot(L, kit, 'crate', cx - 3, 0, cz, -Math.PI / 2, zone); taken.push({ x: cx - 3.8, z: cz, m: 1.8 }); }   // against the monument
  for (let x = S.x0 + 5; x < S.x1 - 3; x += 9) for (const z of [S.z0 + 4, S.z1 - 4]) {
    const px = ns ? x : z, pz = ns ? z : x;
    if (R() < 0.75 && clear(px, pz, 1)) { kit.palm(px, pz, kit.range(6, 10)); taken.push({ x: px, z: pz, m: 0.6 }); }
  }
  for (let k = 0; k < 6; k++) {                                                        // benches facing the middle
    const a = k / 6 * Math.PI * 2 + 0.4, r = Math.min(S.x1 - S.x0, S.z1 - S.z0) * 0.3, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (R() < 0.8 && clear(x, z, 1.1)) { kit.cbox(x, 0.25, z, 1.8, 0.5, 0.6, 0x6e5a44, { ry: -a + Math.PI / 2 }); taken.push({ x, z, m: 1 }); }
  }
  for (let t = 0; t < 8 && R() < 0.75; t++) {                                          // a wreck somewhere on it
    const x = kit.range(S.x0 + 4, S.x1 - 4), z = kit.range(S.z0 + 4, S.z1 - 4);
    if (!clear(x, z, 3)) continue;
    carLoot(L, kit, x, z, ns ? Math.PI / 2 + 0.3 : 0.3, zone); taken.push({ x, z, m: 3 });
    break;
  }
  if (R() < 0.5 && clear(S.x1 - (S.x1 - S.x0) * 0.25, cz, 3)) sandbags(kit, S.x1 - (S.x1 - S.x0) * 0.25, cz, ns ? Math.PI / 2 : 0);
}

// a length cut into lots between wmin and wmax wide
function splitRun(kit, len, wmin, wmax) {
  const out = [];
  let a = 0;
  while (len - a >= 2 * wmin) {
    const w = Math.min(kit.range(wmin, wmax), len - a - wmin);
    out.push([a, a + w]); a += w;
  }
  if (len - a > 1 || !out.length) out.push([a, len]);
  else out[out.length - 1][1] = len;
  return out;
}
const irange = (kit, [a, b]) => a + Math.floor(kit.R() * (b - a + 1));
const nearCrater = (x0, z0, x1, z1, m) => {
  const cx = Math.max(x0, Math.min(x1, CRATER.x)), cz = Math.max(z0, Math.min(z1, CRATER.z));
  return Math.hypot(cx - CRATER.x, cz - CRATER.z) < CRATER.r + m;
};

// a block built up round its edge: rows along the north and south streets, columns along the west and east ones,
// a courtyard in the middle
function ring(L, kit, In, kind) {
  const P = PROFILES[kind], R = kit.R;
  const W = In.x1 - In.x0, D = In.z1 - In.z0;
  let dN = kit.range(...P.depth), dS = kit.range(...P.depth), dW = kit.range(...P.depth), dE = kit.range(...P.depth);
  if (D < dN + dS + 8) dN = dS = D / 2;
  const lots = [];
  for (const [side, z0, z1] of [['n', In.z0, In.z0 + dN], ['s', In.z1 - dS, In.z1]]) {
    const parts = splitRun(kit, W, P.width[0], P.width[1]);
    parts.forEach(([a, b], k) => lots.push({ side, x0: In.x0 + a, x1: In.x0 + b, z0, z1, corner: k === 0 ? 'w' : k === parts.length - 1 ? 'e' : null }));
  }
  const zA = In.z0 + dN, zB = In.z1 - dS;
  if (zB - zA > 6) {
    if (W < dW + dE + 8) dW = dE = W / 2;
    for (const [side, x0, x1] of [['w', In.x0, In.x0 + dW], ['e', In.x1 - dE, In.x1]]) {
      for (const [a, b] of splitRun(kit, zB - zA, P.width[0], P.width[1])) lots.push({ side, x0, x1, z0: zA + a, z1: zA + b, corner: null });
    }
  }
  const yard = zB - zA > 8 && W - dW - dE > 8 ? { x0: In.x0 + dW, z0: zA, x1: In.x1 - dE, z1: zB } : null;
  // what each lot is; every block with a courtyard gets at least one way in
  for (const lot of lots) {
    if (nearCrater(lot.x0, lot.z0, lot.x1, lot.z1, 5)) { lot.kind = 'void'; continue; }
    const r = R();
    lot.kind = r < P.gap ? 'gap' : r < P.gap + P.ruin ? 'ruin' : 'building';
  }
  if (yard && !lots.some(l => !l.corner && l.kind !== 'building')) {
    const mids = lots.filter(l => !l.corner && l.kind === 'building');
    if (mids.length) kit.pick(mids).kind = 'gap';
  }
  // footprints: some buildings are shallower (the courtyard side gives), some stand behind a front yard
  for (const lot of lots) {
    if (lot.kind !== 'building') continue;
    const f = { x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 };
    const cut = (side, d) => { if (side === 'n') f.z0 += d; else if (side === 's') f.z1 -= d; else if (side === 'w') f.x0 += d; else f.x1 -= d; };
    if (!lot.corner && R() < 0.5) cut(OPP[lot.side], kit.range(0.5, 3));
    if (!lot.corner && R() < P.setback) { lot.setback = kit.range(1.8, 3.2); cut(lot.side, lot.setback); }
    lot.front = lot.corner && R() < 0.3 ? lot.corner : lot.side;
    lot.f = f;
  }
  blanks(lots);
  for (const lot of lots) {
    const zone = zoneKind((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2);
    if (lot.kind === 'building') {
      const f = lot.f, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      let floors = irange(kit, P.floors);
      if (kind === 'downtown' && Math.max(Math.abs(cx), Math.abs(cz)) < 120 && R() < 0.5) floors++;
      const open = R() < P.open ? (floors <= 3 ? floors : 1 + Math.floor(R() * 3)) : 0;
      building(L, kit, {
        ...f, floors, open, front: lot.front, blank: lot.blank, shop: R() < P.shop, style: kit.pick(P.style), zone,
        damage: Math.max(0.15, Math.min(1, DAMAGE[zone] + kit.range(-0.15, 0.2) + (kind === 'crater' ? 0.15 : 0))),
        nest: open > 0 && R() < NEST[zone], rich: zone === 'red', roof: open === floors && R() < 0.55, balconies: R() < P.balconies,
      });
      if (lot.setback) frontYard(kit, lot);
    } else if (lot.kind === 'ruin') ruinLot(L, kit, lot, zone);
    else if (lot.kind === 'gap') gapLot(L, kit, lot, zone);
  }
  if (yard) courtyard(L, kit, yard, kind, zoneKind((yard.x0 + yard.x1) / 2, (yard.z0 + yard.z1) / 2));
}

// which sides of each building stand against a neighbour (no windows there)
function blanks(lots) {
  const B = lots.filter(l => l.kind === 'building');
  for (const a of B) {
    const f = a.f, out = new Set();
    for (const b of B) {
      if (a === b) continue;
      const g = b.f;
      const ovX = Math.min(f.x1, g.x1) - Math.max(f.x0, g.x0), ovZ = Math.min(f.z1, g.z1) - Math.max(f.z0, g.z0);
      if (Math.abs(f.x1 - g.x0) < 0.2 && ovZ > 0.6 * (f.z1 - f.z0)) out.add('e');
      if (Math.abs(f.x0 - g.x1) < 0.2 && ovZ > 0.6 * (f.z1 - f.z0)) out.add('w');
      if (Math.abs(f.z1 - g.z0) < 0.2 && ovX > 0.6 * (f.x1 - f.x0)) out.add('s');
      if (Math.abs(f.z0 - g.z1) < 0.2 && ovX > 0.6 * (f.x1 - f.x0)) out.add('n');
    }
    out.delete(a.front);
    a.blank = [...out];
  }
}

// a low wall along the street in front of a house set back from it, with a gap at the door
function frontYard(kit, lot) {
  const f = lot.f, s = lot.side, c = kit.pick(COL.plaster);
  const along = s === 'n' || s === 's';
  const a0 = along ? lot.x0 : lot.z0, a1 = along ? lot.x1 : lot.z1;
  const n = Math.max(1, Math.round((along ? f.x1 - f.x0 : f.z1 - f.z0) / 4.2)), door = (along ? f.x0 : f.z0) + (Math.floor(n / 2) + 0.5) * (along ? f.x1 - f.x0 : f.z1 - f.z0) / n;
  const at = s === 'n' ? lot.z0 + 0.15 : s === 's' ? lot.z1 - 0.15 : s === 'w' ? lot.x0 + 0.15 : lot.x1 - 0.15;
  kit.wall(along ? 'x' : 'z', at, a0 + 0.3, a1 - 0.3, 0, 1.0, [{ a: door, w: 2.4, b: 0, t: 1.0 }], c, { t: 0.25 });
}

// a building that came down: heaps of rubble, a piece of its front wall, sometimes something worth searching
function ruinLot(L, kit, lot, zone) {
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0, cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const loot = kit.R() < 0.35 && W > 7 && D > 7 && L.heaps.every(h => Math.hypot(h.x - cx, h.z - cz) > h.r + 2.4);
  if (loot) addLoot(L, kit, 'crate', cx, 0, cz, kit.R() * Math.PI * 2, zone);
  // heaps that stay inside the lot (a heap of size s reaches about 1.1 s from its middle) and off the crate
  for (let k = 0, t = 0, n = 2 + Math.floor(kit.R() * 2); k < n && t < 12; t++) {
    const s = kit.range(2.2, 3.8), m = 1.1 * s;
    if (W < 2 * m + 0.5 || D < 2 * m + 0.5) continue;
    const x = kit.range(lot.x0 + m, lot.x1 - m), z = kit.range(lot.z0 + m, lot.z1 - m);
    if (loot && Math.hypot(x - cx, z - cz) < m + 2.4) continue;
    kit.rubble(x, z, s, 4);
    k++;
  }
  const c = kit.pick(COL.plaster), s = lot.side, h = kit.range(1.5, 4.5);
  if (s === 'n' || s === 's') kit.wall('x', s === 'n' ? lot.z0 + 0.15 : lot.z1 - 0.15, lot.x0 + 0.5, lot.x0 + 0.5 + W * kit.range(0.3, 0.6), 0, h, [], c, { jag: 0.7 });
  else kit.wall('z', s === 'w' ? lot.x0 + 0.15 : lot.x1 - 0.15, lot.z0 + 0.5, lot.z0 + 0.5 + D * kit.range(0.3, 0.6), 0, h, [], c, { jag: 0.7 });
  L.ruins.push({ x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
}
// an empty lot (often the way into the courtyard): sand, a wreck, a dead palm, a heap of rubble at the side
function gapLot(L, kit, lot, zone) {
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0, R = kit.R;
  const along = lot.side === 'n' || lot.side === 's';            // the lot runs into the block from that street
  if (R() < 0.4) kit.palm(along ? lot.x0 + 1.5 : kit.range(lot.x0 + 2, lot.x1 - 2), along ? kit.range(lot.z0 + 2, lot.z1 - 2) : lot.z0 + 1.5, kit.range(6, 9));
  if (W > 11 && D > 11 && R() < 0.4) carLoot(L, kit, (lot.x0 + lot.x1) / 2 + (along ? W * 0.2 : 0), (lot.z0 + lot.z1) / 2 + (along ? 0 : D * 0.2), along ? 0.2 : Math.PI / 2 + 0.2, zone);
  else if (R() < 0.45) {
    const s = kit.range(1.8, 3), m = 1.1 * s;
    if ((along ? W : D) > 2 * m + 3) kit.rubble(along ? lot.x1 - m : (lot.x0 + lot.x1) / 2, along ? (lot.z0 + lot.z1) / 2 : lot.z1 - m, s, 4);
  }
  L.vacant.push({ x0: lot.x0, z0: lot.z0, x1: lot.x1, z1: lot.z1 });
}
// the courtyard inside a block: palms, a wreck, a crate, a shed; in the old market, a bazaar
function courtyard(L, kit, Y, kind, zone) {
  const R = kit.R, W = Y.x1 - Y.x0, D = Y.z1 - Y.z0;
  L.yards.push({ ...Y, kind });
  const taken = L.heaps.filter(h => h.x > Y.x0 - h.r && h.x < Y.x1 + h.r && h.z > Y.z0 - h.r && h.z < Y.z1 + h.r).map(h => ({ x: h.x, z: h.z, m: h.r + 0.5 }));
  const place = (m, edge = 3) => {
    for (let t = 0; t < 12; t++) {
      const x = kit.range(Y.x0 + edge, Y.x1 - edge), z = kit.range(Y.z0 + edge, Y.z1 - edge);
      if (taken.every(p => Math.hypot(p.x - x, p.z - z) > m + p.m)) { taken.push({ x, z, m }); return { x, z }; }
    }
    return null;
  };
  if (kind === 'market') {
    for (let x = Y.x0 + 4; x < Y.x1 - 3; x += 7) for (let z = Y.z0 + 4; z < Y.z1 - 3; z += 7) {
      if (R() < 0.45) { stall(kit, x, z, R() < 0.5 ? 0 : Math.PI / 2); taken.push({ x, z, m: 2.2 }); }
    }
  }
  if (W > 22 && D > 22 && kind !== 'market' && R() < 0.6) {              // a shed, or in a big courtyard a workshop
    const big = W > 30 && D > 30 && R() < 0.6, w = big ? 10.5 : 8.6, d = big ? 8.6 : 6.6, west = R() < 0.5;
    const x0 = west ? Y.x0 + 3 : Y.x1 - 3 - w, z0 = Y.z0 + 3 + R() * (D - d - 6);
    building(L, kit, { x0, z0, x1: x0 + w, z1: z0 + d, floors: big ? 2 : 1, open: big ? 2 : 1, front: west ? 'e' : 'w', style: big ? 'industrial' : 'residential', zone, damage: 0.5, roof: big && R() < 0.5 });
    taken.push({ x: x0 + w / 2, z: z0 + d / 2, m: Math.max(w, d) / 2 + 2 });
  }
  for (let k = 0, n = 1 + Math.floor(R() * 2); k < n; k++) { const p = place(2, 2); if (p) kit.palm(p.x, p.z, kit.range(6, 10)); }
  if (R() < 0.45) { const p = place(4, 5); if (p) carLoot(L, kit, p.x, p.z, R() * Math.PI, zone); }
  if (R() < 0.45) { const p = place(2.5, 3); if (p) addLoot(L, kit, 'crate', p.x, 0, p.z, R() * Math.PI * 2, zone); }
  if (R() < 0.4) { const p = place(3, 4); if (p) kit.rubble(p.x, p.z, kit.range(2.5, 4), 4); }
  if (R() < 0.25) { const p = place(4, 4); if (p) sandbags(kit, p.x, p.z, R() * Math.PI); }
}

// ---------- the industrial yard ----------
function industrial(L, kit, In) {
  const R = kit.R, W = In.x1 - In.x0, D = In.z1 - In.z0, cx = (In.x0 + In.x1) / 2, cz = (In.z0 + In.z1) / 2;
  const zone = zoneKind(cx, cz), damage = DAMAGE[zone] + kit.range(-0.1, 0.2);
  L.yards.push({ ...In, kind: 'industrial' });
  const vertical = R() < 0.5, first = R() < 0.5;
  if (R() < 0.6) {
    // a big warehouse on one half, a yard of container stacks on the other
    let f, yard;
    if (vertical) {
      const w = Math.min(kit.range(26, 32), W - 18);
      f = first ? { x0: In.x0, x1: In.x0 + w, z0: In.z0 + 1, z1: In.z1 - 1 } : { x0: In.x1 - w, x1: In.x1, z0: In.z0 + 1, z1: In.z1 - 1 };
      yard = first ? { x0: f.x1 + 3, x1: In.x1, z0: In.z0, z1: In.z1 } : { x0: In.x0, x1: f.x0 - 3, z0: In.z0, z1: In.z1 };
    } else {
      const d = Math.min(kit.range(24, 30), D - 18);
      f = first ? { x0: In.x0 + 1, x1: In.x1 - 1, z0: In.z0, z1: In.z0 + d } : { x0: In.x0 + 1, x1: In.x1 - 1, z0: In.z1 - d, z1: In.z1 };
      yard = first ? { x0: In.x0, x1: In.x1, z0: f.z1 + 3, z1: In.z1 } : { x0: In.x0, x1: In.x1, z0: In.z0, z1: f.z0 - 3 };
    }
    warehouse(L, kit, { ...f, doors: vertical ? ['n', 's'] : ['e', 'w'], damage, zone, nest: R() < 0.3 });
    containerYard(L, kit, yard, zone, damage, vertical ? (first ? 'e' : 'w') : (first ? 's' : 'n'));
  } else {
    // two warehouses with a lane between them
    if (vertical) {
      const mid = cx + kit.range(-4, 4);
      warehouse(L, kit, { x0: In.x0, x1: mid - 3, z0: In.z0 + 2, z1: In.z1 - 2, doors: ['n', 's', 'e'], damage, zone, nest: R() < 0.25 });
      warehouse(L, kit, { x0: mid + 3, x1: In.x1, z0: In.z0 + 2, z1: In.z1 - 2, doors: ['n', 's', 'w'], damage, zone, nest: R() < 0.25 });
      for (let k = 0; k < 2; k++) if (R() < 0.6) addLoot(L, kit, 'crate', mid + kit.range(-1.2, 1.2), 0, kit.range(In.z0 + 8, In.z1 - 8), R() * Math.PI, zone);
    } else {
      const mid = cz + kit.range(-4, 4);
      warehouse(L, kit, { x0: In.x0 + 2, x1: In.x1 - 2, z0: In.z0, z1: mid - 3, doors: ['e', 'w', 's'], damage, zone, nest: R() < 0.25 });
      warehouse(L, kit, { x0: In.x0 + 2, x1: In.x1 - 2, z0: mid + 3, z1: In.z1, doors: ['e', 'w', 'n'], damage, zone, nest: R() < 0.25 });
      for (let k = 0; k < 2; k++) if (R() < 0.6) addLoot(L, kit, 'crate', kit.range(In.x0 + 8, In.x1 - 8), 0, mid + kit.range(-1.2, 1.2), R() * Math.PI, zone);
    }
  }
}
// container stacks in rows, crates, a small office, a fence along the street with a gate
function containerYard(L, kit, Y, zone, damage, street) {
  const R = kit.R, W = Y.x1 - Y.x0, D = Y.z1 - Y.z0;
  const office = W > 20 && D > 20 && R() < 0.6;
  let ox0 = 0, oz0 = 0;
  if (office) {
    ox0 = R() < 0.5 ? Y.x0 + 1 : Y.x1 - 13; oz0 = R() < 0.5 ? Y.z0 + 1 : Y.z1 - 11;
    building(L, kit, { x0: ox0, z0: oz0, x1: ox0 + 12, z1: oz0 + 10, floors: 2, open: 2, front: oz0 < (Y.z0 + Y.z1) / 2 ? 's' : 'n', style: 'industrial', zone, damage, roof: R() < 0.5 });
  }
  const used = office ? [{ x0: ox0, z0: oz0, x1: ox0 + 12, z1: oz0 + 10 }] : [];
  const clearOf = (x, z, m) => used.every(r => x < r.x0 - m || x > r.x1 + m || z < r.z0 - m || z > r.z1 + m);
  for (let x = Y.x0 + 4; x < Y.x1 - 3; x += 8) for (let z = Y.z0 + 5; z < Y.z1 - 4; z += 10) {
    if (R() > 0.55 || !clearOf(x, z, 5)) continue;
    const turned = R() > 0.8, hx = turned ? 3.3 : 1.4, hz = turned ? 1.4 : 3.3;
    containerStack(kit, x, z, turned ? Math.PI / 2 : 0, 1 + Math.floor(R() * 3));
    used.push({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz });
  }
  for (let k = 0, t = 0; k < 2 && t < 10; t++) {                 // crates in the lanes between the stacks
    const x = kit.range(Y.x0 + 2, Y.x1 - 3), z = kit.range(Y.z0 + 2, Y.z1 - 2);
    if (!clearOf(x, z, 1.0) || !clearOf(x + 1.2, z, 0.6)) continue;
    if (R() < 0.6) addLoot(L, kit, R() < 0.6 ? 'crate' : 'toolbox', x, 0, z, Math.PI / 2, zone);
    used.push({ x0: x - 0.8, z0: z - 0.8, x1: x + 0.8, z1: z + 0.8 });
    k++;
  }
  // a low concrete fence along the street side, with a gate
  const at = street === 'n' ? Y.z0 + 0.3 : street === 's' ? Y.z1 - 0.3 : street === 'w' ? Y.x0 + 0.3 : Y.x1 - 0.3;
  const along = street === 'n' || street === 's', a0 = along ? Y.x0 + 1 : Y.z0 + 1, a1 = along ? Y.x1 - 1 : Y.z1 - 1;
  kit.wall(along ? 'x' : 'z', at, a0, a1, 0, 1.4, [{ a: kit.range(a0 + 6, a1 - 6), w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
}

// ---------- props with loot ----------
function carLoot(L, kit, x, z, yaw, zone) {
  const flipped = kit.R() < 0.12;
  const boot = kit.car(x, z, yaw, { flipped });
  if (!flipped && kit.R() < 0.35) L.containers.push({ type: 'car', x: boot.x, y: 0, z: boot.z, ry: yaw, zone });
}
function sandbags(kit, x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  for (let k = -2; k <= 2; k++) kit.cbox(x + c * k * 1.1, 0.45, z - s * k * 1.1, 1.1, 0.9, 0.6, COL.sandbag, { ry: yaw + kit.range(-0.1, 0.1) });
}

// ---------- the plaza and the Collapsed Tower ----------
function plaza(L, kit) {
  const T = TOWER, c = COL.tower;
  // the stump: solid below and above, one storey hollow where the fallen top broke into it
  const cx = 0, cz = (T.z0 + T.z1) / 2, W = T.x1 - T.x0, D = T.z1 - T.z0, b = T.breach;
  kit.box(cx, 0, cz, W, b - 0.3, D, c);
  kit.box(cx, b - 0.3, cz, W, 0.3, D, COL.slab, { top: COL.floor });                  // the room's floor
  kit.wall('x', T.z0 + WALL / 2, T.x0, T.x1, b, 3.4, [{ a: -4, w: 1.4, b: 1, t: 2.3 }, { a: 4, w: 1.4, b: 1, t: 2.3 }], c);
  kit.wall('x', T.z1 - WALL / 2, T.x0, T.x1, b, 3.4, [{ a: 0, w: 1.4, b: 1, t: 2.3 }], c);
  kit.wall('z', T.x0 + WALL / 2, T.z0 + WALL, T.z1 - WALL, b, 3.4, [], c);
  kit.wall('z', T.x1 - WALL / 2, T.z0 + WALL, T.z1 - WALL, b, 3.4, [{ a: -14, w: 10, b: 0, t: 3.4 }], c, { jag: 0.4 });  // the breach
  kit.box(cx, b + 3.4, cz, W, 0.3, D, COL.slab);                                       // its ceiling
  kit.box(cx, b + 3.7, cz, W, 22, D, c);
  for (let k = 0; k < 4; k++) {                                                        // the broken top
    const w = kit.range(5, 11), d = kit.range(5, 11);
    kit.box(T.x0 + w / 2 + kit.R() * (W - w), b + 25.7, T.z0 + d / 2 + kit.R() * (D - d), w, kit.range(4, 18), d, c);
  }
  for (let k = 0; k < 6; k++) kit.box(kit.range(T.x0 + 1, T.x1 - 1), b + 25.7, kit.range(T.z0 + 1, T.z1 - 1), 0.12, kit.range(3, 8), 0.12, COL.rebar, { col: false });
  for (let f = 0; f < 14; f++) {
    if (f === 6) continue;
    const y = f * FLOOR + 1.75;
    kit.panesAlong('n', T.z0, T.x0, T.x1, y, 1.5, 1.7, 3.2, 0.15);
    kit.panesAlong('s', T.z1, T.x0, T.x1, y, 1.5, 1.7, 3.2, 0.15);
    kit.panesAlong('w', T.x0, T.z0, T.z1, y, 1.5, 1.7, 3.2, 0.15);
    if (f < 5 || f > 7) kit.panesAlong('e', T.x1, T.z0, T.z1, y, 1.5, 1.7, 3.2, 0.15);
  }
  L.footprints.push({ x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1, h: 64, open: false, tower: true });
  L.interiors.push({ x0: T.x0 + WALL, z0: T.z0 + WALL, x1: T.x1 - WALL, z1: T.z1 - WALL, y0: b, y1: b + 3.4 });
  // the fallen top: a slab of tower lying from the plaza up to the breach (an 18° climb), propped on its debris
  kit.ramp({ x: 60, y: 0, z: 26 }, { x: T.x1, y: b, z: -14 }, 10, 7, c);
  const yaw = Math.atan2(49, 40);
  kit.cbox(21, 4.3, -5.5, 9, 8.6, 10, kit.pick(COL.rubble), { ry: yaw + 0.3, rz: 0.08 });
  for (let k = 0; k < 6; k++) {                                                        // debris along both sides of it
    const s = kit.range(6, 50), off = (k % 2 ? 1 : -1) * kit.range(7.5, 11);
    kit.rubble(60 - 0.775 * s + 0.632 * off, 26 - 0.632 * s - 0.775 * off, kit.range(3, 4.5), 4);
  }
  for (let k = 0; k < 4; k++) kit.rubble(kit.range(T.x0 - 6, T.x1 + 2), kit.range(T.z1 + 1.5, T.z1 + 8), kit.range(2, 3.5), 4);
  // the loot room at the top of the climb
  const lr = (type, x, z, ry) => { containerLook(kit, type, x, b, z, ry); L.containers.push({ type, x, y: b, z, ry, zone: 'red' }); };
  lr('case', -9.5, -24, Math.PI / 2); lr('cache', -8, -12, Math.PI / 2); lr('crate', 0, -29.5, 0); lr('locker', 6, -29.6, 0);
  crystalsAround(L, kit, -8, b, -12, 1.6, 8);
  // round the plaza: a dry fountain, palms, wrecks, sandbags
  const fx = 38, fz = 48;
  for (let a = 0; a < 8; a++) kit.cbox(fx + Math.cos(a * Math.PI / 4) * 5, 0.4, fz + Math.sin(a * Math.PI / 4) * 5, 4.2, 0.8, 0.6, COL.white[0], { ry: -a * Math.PI / 4 + Math.PI / 2 });
  kit.box(fx, 0, fz, 1.4, 2.4, 1.4, COL.stone[1]);
  for (let k = 0; k < 8; k++) {
    const x = -54 + k * 15 + kit.range(-3, 3), z = k % 2 ? kit.range(-59, -55) : kit.range(55, 59);
    if (Math.hypot(x - fx, z - fz) > 9) kit.palm(x, z, kit.range(7, 11));
  }
  for (let k = 0; k < 5; k++) carLoot(L, kit, kit.range(-59, -52), -46 + k * 21 + kit.range(-3, 3), Math.PI / 2 + kit.range(-0.5, 0.5), 'red');
  sandbags(kit, -30, -45, 0.3); sandbags(kit, 30, -50, -0.4); sandbags(kit, -40, 0, Math.PI / 2);
  L.signs.push({ title: 'Collapsed Tower', sub: 'Climb the fallen top.\nSomething was left up there.', x: 58, y: 2.2, z: 36, ry: -2.2 });
}

// ---------- the highway ----------
function highway(L, kit) {
  const { z, y, w, gap, end, foot } = HWY, t = 1.0;
  const deck = (xa, xb) => {
    for (let x = xa; x < xb - 0.01; x += 32) {
      const len = Math.min(32, xb - x);
      kit.box(x + len / 2, y - t, z, len, t, w, COL.slab, { top: COL.asphalt });
      for (const side of [-1, 1]) if (kit.R() > 0.12) kit.box(x + len / 2, y, z + side * (w / 2 - 0.3), len - kit.range(0, 2), 0.9, 0.5, COL.barrier);
    }
  };
  deck(-end, gap[0]);
  deck(gap[1], end);
  kit.ramp({ x: -foot, y: 0, z }, { x: -end, y, z }, w - 2, t, COL.slab, { top: COL.asphalt });
  kit.ramp({ x: foot, y: 0, z }, { x: end, y, z }, w - 2, t, COL.slab, { top: COL.asphalt });
  kit.ramp({ x: gap[0] + 8, y: 0, z: z + 0.8 }, { x: gap[1], y, z }, w - 3, t, COL.slab, { top: COL.asphalt });   // the collapsed section: the way up
  for (let k = 0; k < 4; k++) kit.rubble(kit.range(gap[0] - 8, gap[0] - 2), z + kit.range(-6, 6), kit.range(2, 3.5), 4);
  for (let k = 0; k < 3; k++) kit.rubble(kit.range(gap[0] + 10, gap[1] - 6), z + (k % 2 ? 1 : -1) * kit.range(8.5, 10), kit.range(2, 3.5), 4);
  for (let k = 0; k < 3; k++) kit.box(gap[0] - 2, y, z + (k - 1) * 4, 0.6, 0.9, 3, COL.barrier);   // warning: the deck ends
  // pillars between the crossings, never on a crossing street
  for (let x = -end + 12; x < end - 6; x += 26) {
    if (x > gap[0] - 4 && x < gap[1] + 4) continue;
    if (XS.some((sx, i) => Math.abs(x - sx) < WX[i] / 2 + 3)) continue;
    kit.box(x, 0, z, 2.4, y - t, 2.4, COL.slab);
  }
  // wrecks on the deck, a jack-knifed truck, sign gantries
  for (let k = 0; k < 24; k++) {
    const x = kit.R() < 0.5 ? kit.range(-end + 10, gap[0] - 8) : kit.range(gap[1] + 6, end - 10);
    deckCar(L, kit, x, z + kit.pick([-5, -1.8, 1.8, 5]), (kit.R() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + kit.range(-0.4, 0.4));
  }
  const tx = kit.range(-250, -120);
  kit.cbox(tx, y + 1.9, z - 1, 2.5, 3.0, 11, 0x6a6e73, { ry: Math.PI / 2 + 0.35 });
  kit.cbox(tx + 6.5, y + 1.4, z + 2.4, 2.4, 2.4, 3, COL.rust[0], { ry: Math.PI / 2 - 0.5 });
  for (const gx of [-262, 118, 240]) {
    for (const s of [-1, 1]) kit.box(gx, y, z + s * (w / 2 - 0.6), 0.5, 6.5, 0.5, COL.metal[1]);
    kit.box(gx, y + 6, z, 0.5, 0.5, w - 0.6, COL.metal[1], { col: false });
    kit.box(gx, y + 4.8, z - 2, 0.2, 1.8, 5.5, 0x2f5a3c, { col: false });
  }
  L.signs.push({ title: 'Highway', sub: 'Broken in the middle.\nUp the collapsed slab.', x: gap[0] + 10, y: 2.2, z: z + 12, ry: Math.PI });
}
function deckCar(L, kit, x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw), y = HWY.y;
  kit.cbox(x, y + 0.72, z, 1.85, 0.85, 4.3, kit.pick(COL.car), { ry: yaw });
  kit.cbox(x - s * 0.2, y + 1.42, z - c * 0.2, 1.62, 0.62, 2.2, kit.pick(COL.car), { ry: yaw, col: false });
  if (kit.R() < 0.3) L.containers.push({ type: 'car', x: x - s * 2.4, y, z: z - c * 2.4, ry: yaw, zone: zoneKind(x, z) });
}

// ---------- the Underground Base: a ramp down into a bunker with Scatter nests ----------
function bunker(L, kit) {
  const B = BUNKER, F = B.floor, H = 5, rp = B.ramp, c = 0x8c8478, cw = 0x6f685e, ox = BX, oz = BZ;
  L.holes.push({ x0: rp.x0, z0: rp.z0, x1: rp.x1, z1: rp.z1 });
  L.dark.push({ x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1 });
  kit.ramp({ x: ox, y: F, z: rp.z0 }, { x: ox, y: 0, z: rp.z1 }, rp.x1 - rp.x0, 0.6, 0x77706a);
  kit.box(rp.x0 - 0.15, F, (rp.z0 + rp.z1) / 2, 0.3, -F, rp.z1 - rp.z0, cw);
  kit.box(rp.x1 + 0.15, F, (rp.z0 + rp.z1) / 2, 0.3, -F, rp.z1 - rp.z0, cw);
  // the blockhouse over the top of the ramp, open to the street in the south
  kit.wall('z', rp.x0 - 1.2, rp.z1 - 8, rp.z1 + 1.5, 0, 3.4, [], 0x9a8f80, { t: 0.6 });
  kit.wall('z', rp.x1 + 1.2, rp.z1 - 8, rp.z1 + 1.5, 0, 3.4, [], 0x9a8f80, { t: 0.6 });
  kit.box(ox, 3.4, rp.z1 - 3.25, rp.x1 - rp.x0 + 3, 0.5, 9.5, 0x8a8072);
  kit.box(ox, 2.6, rp.z1 + 1.45, rp.x1 - rp.x0 + 2.4, 0.8, 0.3, 0x2b2a28, { col: false });
  for (const x of [rp.x0 - 0.7, rp.x1 + 0.7]) kit.box(x, 2.2, rp.z1 + 1.6, 0.3, 0.3, 0.1, COL.lamp, { k: K.GLOW, col: false });
  crystalsAround(L, kit, rp.x0 - 2.5, 0, rp.z1 + 1.2, 1.0, 5);
  L.signs.push({ title: 'Underground Base', sub: 'Dark inside. Use your light (F).\nScatter nests.', x: ox - 6, y: 2.0, z: rp.z1 + 2.2, ry: 0 });
  // the floor, and ceilings you can see from below (the ground above is the real roof)
  kit.slab(B.x0, B.z0, B.x1, rp.z0 + 0.05, F, 0x5f5a53, null, { thick: 0.4 });
  const room = (x0, z0, x1, z1, doors) => {
    kit.box((x0 + x1) / 2, -1.25, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0, 0x4f4a44, { col: false });
    const ops = s => doors.filter(d => d.s === s).map(d => ({ a: d.a, w: d.w || 2.2, b: 0, t: 3 }));
    kit.wall('x', z0, x0, x1, F, H, ops('n'), c);
    kit.wall('x', z1, x0, x1, F, H, ops('s'), c);
    kit.wall('z', x0, z0, z1, F, H, ops('w'), c);
    kit.wall('z', x1, z0, z1, F, H, ops('e'), c);
    for (let x = x0 + 4; x < x1 - 2; x += 7) kit.box(x, -2.6, z0 + 0.2, 0.9, 0.18, 0.1, COL.lamp, { k: K.GLOW, col: false });
  };
  room(ox - 18, oz - 46, ox + 18, rp.z0, [{ s: 's', a: ox, w: rp.x1 - rp.x0 }, { s: 'w', a: oz - 33 }, { s: 'e', a: oz - 35 }, { s: 'n', a: ox - 1, w: 4 }]);   // the hall
  room(ox - 32, oz - 42, ox - 18, oz - 24, [{ s: 'e', a: oz - 33 }]);
  room(ox + 18, oz - 44, ox + 32, oz - 26, [{ s: 'w', a: oz - 35 }]);
  room(ox - 3, oz - 50, ox + 1, oz - 46, [{ s: 'n', a: ox - 1, w: 4 }, { s: 's', a: ox - 1, w: 4 }]);                                         // a short corridor
  room(ox - 14, oz - 60, ox + 14, oz - 50, [{ s: 's', a: ox - 1, w: 4 }]);                                                                     // the nest room
  for (const [dx, dz] of [[-9, -38], [9, -38], [-9, -26], [9, -26]]) kit.box(ox + dx, F, oz + dz, 1, H, 1, 0x7a736a);
  for (let k = 0, t = 0; k < 6 && t < 30; t++) {                                     // crates about the hall, clear of the nests
    const x = ox + (k % 2 ? 1 : -1) * kit.range(5, 14), z = oz + kit.range(-43, -22);
    if (Math.hypot(x - (ox - 14), z - (oz - 42)) < 3.5) continue;
    kit.box(x, F, z, 1.2, 1.2, 1.2, kit.pick(COL.rust));
    k++;
  }
  const lr = (type, dx, dz, ry) => { containerLook(kit, type, ox + dx, F, oz + dz, ry); L.containers.push({ type, x: ox + dx, y: F, z: oz + dz, ry, zone: 'yellow' }); };
  lr('locker', -31, -28, Math.PI / 2); lr('locker', -31, -31, Math.PI / 2); lr('crate', -24, -40.5, 0);
  lr('toolbox', 31, -30, -Math.PI / 2); lr('case', 31, -39, -Math.PI / 2); lr('crate', 14, -44.5, 0);
  lr('cache', -10, -57, 0); lr('cache', 10, -57, 0); lr('crate', -17.2, -20, Math.PI / 2);
  crystalsAround(L, kit, ox, F, oz - 56, 5, 22);
  crystalsAround(L, kit, ox - 28, F, oz - 38, 2.5, 8);
  L.nestSpots.push({ x: ox, y: F + 0.1, z: oz - 56, zone: 'yellow', bunker: true }, { x: ox - 25, y: F + 0.1, z: oz - 35, zone: 'yellow', bunker: true },
    { x: ox - 14, y: F + 0.1, z: oz - 42, zone: 'yellow', bunker: true });
  L.interiors.push({ x0: ox - 18, z0: oz - 46, x1: ox + 18, z1: oz - 18, y0: F, y1: -1 });
}
// up top, the block round the blockhouse: container stacks, an office, a fence
function baseYard(L, kit, In) {
  const R = kit.R;
  L.yards.push({ ...In, kind: 'industrial' });
  containerStack(kit, BX + 20, BZ - 34, 0, 2); containerStack(kit, BX - 21, BZ - 30, Math.PI / 2, 1); containerStack(kit, BX + 23, BZ - 12, Math.PI / 2, 3);
  containerStack(kit, BX + 12, BZ - 50, 0, 1); containerStack(kit, BX - 14, BZ - 20, 0, 2);
  building(L, kit, { x0: In.x0 + 0.5, z0: In.z0 + 0.5, x1: In.x0 + 12.5, z1: In.z0 + 10.5, floors: 2, open: 2, front: 'e', style: 'industrial', zone: 'yellow', damage: 0.6, roof: R() < 0.5 });
  addLoot(L, kit, 'crate', BX + 9, 0, BZ - 6, Math.PI / 2, 'yellow');
  kit.wall('x', In.z0 + 0.3, In.x0 + 15, In.x1 - 1, 0, 1.4, [{ a: BX + 4, w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
  kit.wall('z', In.x1 - 0.3, In.z0 + 1, In.z1 - 1, 0, 1.4, [{ a: BZ - 30, w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
}

// ---------- the Pod Crater ----------
function crater(L, kit) {
  const C = CRATER;
  L.pods.push({ x: C.x - 2, z: C.z + 2, s: 7.5, h: 16, tilt: 0.38, ry: 0.6 });
  // the pod's body, for the physics (a few boxes inside the shape)
  kit.cbox(C.x - 2, 4, C.z + 2, 9, 8, 9, 0, { ry: 0.6 + Math.PI / 4, rx: 0.2, k: K.SOLID }).hide = true;
  kit.cbox(C.x - 0.5, 10, C.z + 4.5, 4.5, 6, 4.5, 0, { ry: 0.6 + Math.PI / 4, rx: 0.3 }).hide = true;
  for (let a = 0; a < 12; a++) {                                                      // the rim (it stays inside the crater)
    const ang = a / 12 * Math.PI * 2 + kit.range(-0.1, 0.1), r = C.r * kit.range(0.7, 0.85);
    kit.rubble(C.x + Math.cos(ang) * r, C.z + Math.sin(ang) * r, kit.range(3, 5.5), 4);
  }
  crystalsAround(L, kit, C.x - 2, 0, C.z + 2, 14, 40);
  for (let k = 0; k < 5; k++) {
    const a = kit.R() * Math.PI * 2, r = kit.range(18, 38);
    kit.wall('x', C.z + Math.sin(a) * r, C.x + Math.cos(a) * r - 3, C.x + Math.cos(a) * r + 3, 0, kit.range(1.5, 3.5), [], kit.pick(COL.plaster), { jag: 0.8 });
  }
  for (const [dx, dz] of [[14, -6], [-12, 13]]) addLoot(L, kit, 'cache', C.x + dx, 0, C.z + dz, 0, 'yellow');
  L.signs.push({ title: 'Pod Crater', sub: 'They landed here first.\nFlies guard it.', x: C.x + 37, y: 2.2, z: C.z + 37, ry: Math.PI / 4 });
}

// ---------- the city's edge: extraction points, drop zones, a few things in the sand, dunes ----------
function edges(L, kit) {
  for (const e of EXTRACTS) {
    kit.box(e.x, 0, e.z, 12, 0.3, 12, 0x8b857c);
    kit.box(e.x + 4.5, 0.3, e.z - 4.5, 0.35, 9, 0.35, COL.metal[1]);
    kit.box(e.x + 4.5, 9.3, e.z - 4.5, 0.7, 0.7, 0.7, COL.green, { k: K.GLOW, col: false });
    kit.box(e.x, 0.3, e.z, 10, 0.01, 0.3, COL.green, { k: K.GLOW, col: false });
    kit.box(e.x, 0.3, e.z, 0.3, 0.01, 10, COL.green, { k: K.GLOW, col: false });
    sandbags(kit, e.x - 7.5, e.z, Math.PI / 2); sandbags(kit, e.x + 7.5, e.z, Math.PI / 2);
    addLoot(L, kit, 'crate', e.x - 4, 0.3, e.z + 4.5, 0, 'outer');
    L.extracts.push({ ...e, kind: 'extract', short: e.name });
    L.signs.push({ title: 'Extraction', sub: `${e.name}\nOpens with the raid rules`, x: e.x - 3, y: 2.3, z: e.z - 6.5, ry: Math.atan2(-e.x, -e.z) + Math.PI });
  }
  for (const [x, z] of DROPS) L.spawns.push({ x, y: 0.05, z, yaw: Math.atan2(x, z) });
  // the strip of sand outside the ring road: ruined corners, rubble, wrecks, dead palms, a shack now and then
  const keep = [...EXTRACTS, ...DROPS.map(([x, z]) => ({ x, z }))], put = [];
  for (let n = 0, t = 0; n < 44 && t < 600; t++) {
    const side = n % 4, a = kit.range(-390, 390), off = kit.range(381, 392);
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (!keep.every(p => Math.hypot(p.x - x, p.z - z) > 16) || onStreet(L, x, z, 4) || !put.every(p => Math.hypot(p.x - x, p.z - z) > 14)) continue;
    put.push({ x, z });
    const r = kit.R();
    if (r < 0.3) {
      const c = kit.pick(COL.plaster);
      kit.wall('x', z, x - kit.range(2, 5), x + kit.range(2, 4), 0, kit.range(1.5, 3.5), [], c, { jag: 0.7 });
      kit.wall('z', x, z, z + (z < 0 ? 1 : -1) * kit.range(3, 5), 0, kit.range(1.2, 3), [], c, { jag: 0.7 });
    } else if (r < 0.55) kit.rubble(x, z, kit.range(2.5, 4.5), 4);
    else if (r < 0.72) carLoot(L, kit, x, z, kit.R() * Math.PI, 'outer');
    else if (r < 0.88) kit.palm(x, z, kit.range(6, 9));
    else {
      const front = side === 0 ? 's' : side === 1 ? 'n' : side === 2 ? 'e' : 'w';
      building(L, kit, { x0: x - 4.3, z0: z - 3.3, x1: x + 4.3, z1: z + 3.3, floors: 1, open: 1, front, style: 'residential', zone: 'outer', damage: 0.55 });
    }
    n++;
  }
  // dunes beyond the edge (only to look at; the map's wall is invisible)
  for (let n = 0; n < 60; n++) {
    const sx = kit.range(40, 110), sz = kit.range(30, 80), sy = kit.range(8, 26), s = Math.max(sx, sz);
    const side = n % 4, t = kit.range(-720, 720), d = HALF + 12 + s + kit.range(0, 260);
    const [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
    L.dunes.push({ x, z, sx, sy, sz, ry: kit.R() * Math.PI });
  }
}

function crystalsAround(L, kit, x, y, z, r, n) {
  for (let k = 0; k < n; k++) {
    const a = kit.R() * Math.PI * 2, d = Math.sqrt(kit.R()) * r;
    L.crystals.push({ x: x + Math.cos(a) * d, y, z: z + Math.sin(a) * d, s: kit.range(0.25, 0.9), rx: kit.range(-0.4, 0.4), ry: kit.R() * Math.PI, rz: kit.range(-0.4, 0.4) });
  }
}

// ---------- the Prism: who lives where, and the routes they patrol ----------
function prismGroups(L, kit) {
  const R = kit.R;
  const P = (kind, members, pos, extra = {}) => L.prism.push({ id: 'g' + L.prism.length, kind, members, pos, zone: zoneKind(pos.x, pos.z), ...extra });
  const pt = (i, j) => ({ x: XS[i], z: ZS[j] });
  // a loop round a rectangle of blocks, along the streets, with a point at every crossing
  // (no loop runs along the highway street, z = 140: its pillars and ramps stand there; none crosses the plaza)
  const loop = (i0, j0, i1, j1) => {
    const out = [];
    for (let i = i0; i < i1; i++) out.push(pt(i, j0));
    for (let j = j0; j < j1; j++) out.push(pt(i1, j));
    for (let i = i1; i > i0; i--) out.push(pt(i, j1));
    for (let j = j1; j > j0; j--) out.push(pt(i0, j));
    return out;
  };
  const at = (route, alt) => ({ x: route[0].x, y: alt, z: route[0].z });
  // Fink patrols: the scouts that call the drop pods
  for (const [i0, j0, i1, j1] of [[1, 1, 3, 3], [7, 0, 9, 2], [0, 8, 2, 10], [7, 8, 9, 10], [3, 1, 7, 3], [3, 8, 7, 10], [0, 3, 2, 6], [8, 3, 10, 6]]) {
    const route = loop(i0, j0, i1, j1);
    P('patrol', ['fink'], at(route, 4.5), { route, alt: 4.5, speed: 2 });
  }
  // Fly groups patrolling round a few blocks
  for (const [i0, j0, i1, j1, n] of [[3, 3, 7, 4, 3], [7, 1, 9, 3, 3], [1, 8, 3, 10, 3], [0, 1, 1, 3, 2], [7, 4, 9, 6, 2], [4, 8, 6, 10, 2], [2, 4, 4, 6, 2]]) {
    const route = loop(i0, j0, i1, j1);
    P('patrol', Array(n).fill('fly'), at(route, 3.5), { route, alt: 3.5, speed: 1.6 });
  }
  // the plaza: Flies over the north of it, a Swatter with two Flies round the whole of it
  P('patrol', ['fly', 'fly', 'fly'], { x: -40, y: 8, z: -50 }, { route: [{ x: -40, z: -50 }, { x: 52, z: -50 }, { x: 52, z: -38 }, { x: -40, z: -38 }], alt: 8, speed: 1.6 });
  P('patrol', ['swatter', 'fly', 'fly'], { x: XS[4], y: 10, z: ZS[4] }, { route: loop(4, 4, 6, 6), alt: 10, speed: 1.8 });
  // a Swatter flies up and down the highway
  P('patrol', ['swatter'], { x: -280, y: HWY.y + 6, z: HWY.z }, { route: [{ x: -280, z: HWY.z }, { x: -120, z: HWY.z }, { x: 120, z: HWY.z }, { x: 280, z: HWY.z }], routeBack: true, alt: 6, speed: 1.8 });
  // Flies circling the crashed pod
  const C = CRATER, ring = [];
  for (let k = 0; k < 6; k++) ring.push({ x: C.x + Math.cos(k / 6 * Math.PI * 2) * 30, z: C.z + Math.sin(k / 6 * Math.PI * 2) * 30 });
  P('patrol', ['fly', 'fly', 'fly', 'fly'], { x: ring[0].x, y: 5, z: ring[0].z }, { route: ring, alt: 5, speed: 1.6 });
  // the Roach: one, in the red zone, walking the open south-west of the plaza
  P('roach', ['roach'], { x: -46, y: 0.1, z: 18 }, { route: [{ x: -46, z: 18 }, { x: -15, z: 48 }, { x: -44, z: 50 }], noRespawn: true, radius: 190 });
  // Scatter nests: in the base, and in some buildings (at most eight)
  const spots = L.nestSpots.filter(s => !s.bunker);
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  for (const s of [...L.nestSpots.filter(q => q.bunker), ...spots.slice(0, 8)]) {
    P('nest', Array(2 + (R() < 0.5 ? 1 : 0)).fill('scatter'), { x: s.x, y: s.y, z: s.z }, { radius: s.bunker ? 70 : 90 });
    crystalsAround(L, kit, s.x, s.y - 0.1, s.z, 1.8, 6);
  }
}

// ---------- the last check: a container nobody could stand in front of stays as scenery ----------
// (with this many random pieces something sometimes lands right in front of one). The test is the raider's
// capsule (0.3 m round, 1.8 m tall) 1.0 and 1.4 m in front, against every solid box near it.
function pruneBlocked(L) {
  const CELL = 8, grid = new Map(), key = (i, j) => i * 4096 + j;
  for (const b of L.boxes) {
    if (!b.col) continue;
    const r = (b.rx || b.rz) ? Math.hypot(b.w, b.h, b.d) / 2 : Math.hypot(b.w, b.d) / 2;
    for (let i = Math.floor((b.x - r) / CELL); i <= Math.floor((b.x + r) / CELL); i++) for (let j = Math.floor((b.z - r) / CELL); j <= Math.floor((b.z + r) / CELL); j++) {
      const k = key(i, j);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
    }
  }
  for (const w of L.wedges) {                              // the stairs, as the box round each flight
    const run = w.n * w.tread, h = w.n * w.rise, ax = w.axis === 'x';
    const b = { x: ax ? w.x + w.dir * (run - w.tread) / 2 : w.x, y: w.y0 + h / 2, z: ax ? w.z : w.z + w.dir * (run - w.tread) / 2, w: ax ? run + w.tread : w.w, h, d: ax ? w.w : run + w.tread, rx: 0, ry: 0, rz: 0 };
    const k = key(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  const hits = (x, y, z) => {
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const b of grid.get(key(i, j)) || []) {
      const a = Math.cos(b.rx), s = Math.sin(b.rx), c = Math.cos(b.ry), d = Math.sin(b.ry), e = Math.cos(b.rz), f = Math.sin(b.rz);
      const ce = c * e, cf = c * f, de = d * e, df = d * f;                       // the box's rotation (Euler YXZ, as three.js builds it)
      const m = [ce + df * s, a * f, cf * s - de, de * s - cf, a * e, df + ce * s, a * d, -s, a * c];
      for (let t = 0; t <= 4; t++) {
        const dx = x - b.x, dy = y + 0.37 + t * 0.29 - b.y, dz = z - b.z;
        const lx = m[0] * dx + m[1] * dy + m[2] * dz, ly = m[3] * dx + m[4] * dy + m[5] * dz, lz = m[6] * dx + m[7] * dy + m[8] * dz;
        const qx = Math.max(Math.abs(lx) - b.w / 2, 0), qy = Math.max(Math.abs(ly) - b.h / 2, 0), qz = Math.max(Math.abs(lz) - b.d / 2, 0);
        if (qx * qx + qy * qy + qz * qz < 0.31 * 0.31) return true;
      }
    }
    return false;
  };
  L.containers = L.containers.filter(c => {
    if (c.type === 'car') return true;
    const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
    return !hits(c.x + fx, c.y + 0.02, c.z + fz) || !hits(c.x + fx * 1.4, c.y + 0.02, c.z + fz * 1.4);
  });
}

// ---------- a few things lying around (on empty bits of floor inside buildings) ----------
function looseItems(L, kit) {
  const pool = [['light_ammo', 12, 30], ['pulse_cell', 15, 35], ['stim', 1, 1], ['scrap_metal', 1, 3], ['wires', 1, 2], ['battery', 1, 1]];
  const spots = [...L.floorSpots];
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(kit.R() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  for (const s of spots.slice(0, 80)) {
    const [id, a, b] = kit.pick(pool);
    L.groundItems.push({ id, n: a + Math.floor(kit.R() * (b - a + 1)), x: s.x, y: s.y + 0.02, z: s.z });
  }
}
