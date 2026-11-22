// The Ruins (DESIGN 11): a ruined desert city of 1.2 km x 1.2 km, made from a seed. The same seed builds the
// same city on every computer, so co-op can share it with one number. Plain data only (see kit.js).
//
// North is -z. Streets run every 80 m (12 m wide). The districts:
//   Downtown (red zone, the centre): tall blocks around the plaza with the Collapsed Tower; its fallen top is a
//     ramp up to a room full of loot. A Roach walks the plaza; a Swatter circles it.
//   Industrial yard (yellow, north-east): warehouses, container stacks, and the Underground Base (Scatter nests).
//   Old market (yellow, south-west): small houses, alleys and stalls; Scatters in some houses.
//   Pod crater (yellow, north-west): a giant crashed Prism pod with Prism crystals; a Fly roost.
//   The highway runs east-west across the south of downtown on pillars, broken in the middle.
//   The outskirts: scattered houses, sand, wrecks, Fink patrols. Three extraction points and six drop zones
//   sit on the edge of the map.
import { Kit, K, COL, FLOOR, WALL, containerLook, DEG } from './kit.js';
import { enterable, solid, warehouse, containerStack, stall } from './buildings.js';

export const HALF = 600, GRID = 80, STREET = 12;
export const line = i => -560 + GRID * i;               // street centre lines, i = 0..14
export const HWY = { z: 160, y: 7.2, w: 16 };           // the highway deck: along z = 160, its top 7.2 m up
export const ZONES = [
  { kind: 'red', name: 'Downtown', x: 0, z: 0, r: 175 },
  { kind: 'yellow', name: 'Industrial yard', x: 300, z: -280, r: 160 },
  { kind: 'yellow', name: 'Old market', x: -280, z: 280, r: 150 },
  { kind: 'yellow', name: 'Pod crater', x: -320, z: -320, r: 125 },
];
export function zoneAt(x, z) {
  for (const k of ['red', 'yellow']) for (const zn of ZONES) if (zn.kind === k && Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn;
  return null;
}
export const zoneKind = (x, z) => (zoneAt(x, z) || { kind: 'outer' }).kind;
export const BUNKER = { x0: 246, z0: -314, x1: 314, z1: -252, floor: -6, ramp: { x0: 276, x1: 284, z0: -270, z1: -252 } };
export const TOWER = { x0: -11, z0: -31, x1: 11, z1: -9, breach: 20.4 };
export const CRATER = { x: -320, z: -320, r: 62 };

export function makeRuins(seed = 3000) {
  const kit = new Kit(seed);
  const R = kit.R;
  const L = {
    seed, half: HALF, grid: GRID, street: STREET,
    boxes: kit.boxes, panes: kit.panes,
    containers: [], nestSpots: [], roofs: [], footprints: [], interiors: [], stairs: [],
    crystals: [], decals: [], pods: [], signs: [], dunes: [], groundItems: [],
    prism: [], spawns: [], extracts: [], landmarks: [], holes: [], dark: [],
    zones: ZONES, hwy: HWY, tower: TOWER, crater: CRATER, bunker: BUNKER,
  };
  streets(L, kit);
  for (let i = 0; i < 14; i++) for (let j = 0; j < 14; j++) block(L, kit, i, j);
  plaza(L, kit);
  highway(L, kit);
  bunker(L, kit);
  crater(L, kit);
  edges(L, kit);
  prismGroups(L, kit);
  looseItems(L, kit);
  L.landmarks.push(
    { name: 'Collapsed Tower', short: 'Tower', x: 0, z: -20, kind: 'landmark' },
    { name: 'Underground Base', short: 'Base', x: 280, z: -252, kind: 'landmark' },
    { name: 'Pod Crater', short: 'Crater', x: CRATER.x, z: CRATER.z, kind: 'landmark' },
    { name: 'Old Market', short: 'Market', x: -280, z: 280, kind: 'landmark' },
    { name: 'Highway', short: 'Highway', x: 240, z: HWY.z, kind: 'landmark' },
  );
  return L;
}

// ---------- streets: asphalt, lane marks, drifts of sand ----------
function streets(L, kit) {
  const len = 2 * 566;
  for (let i = 0; i <= 14; i++) {
    const a = line(i);
    kit.box(a, 0, 0, STREET, 0.04, len, COL.asphalt, { col: false, k: K.FLAT });
    kit.box(0, 0, a, len, 0.04, STREET, COL.asphalt, { col: false, k: K.FLAT });
    for (let s = -560; s < 560; s += 9) {
      if (kit.R() < 0.25) continue;                       // faded away
      kit.box(a, 0.03, s + 4, 0.18, 0.04, 3, COL.lane, { col: false, k: K.FLAT });
      kit.box(s + 4, 0.03, a, 3, 0.04, 0.18, COL.lane, { col: false, k: K.FLAT });
    }
  }
  // sand blown over the streets and lots (paint on the ground sits a few cm apart, so it never flickers)
  for (let n = 0; n < 340; n++) {
    const x = kit.range(-590, 590), z = kit.range(-590, 590), s = kit.range(4, 16);
    kit.box(x, 0.05, z, s, 0.04, s * kit.range(0.3, 0.7), COL.drift, { col: false, k: K.FLAT, ry: kit.R() * Math.PI });
  }
}

// ---------- one city block ----------
function block(L, kit, i, j) {
  const x0 = line(i) + 6, x1 = line(i + 1) - 6, cx = (x0 + x1) / 2;
  let z0 = line(j) + 6, z1 = line(j + 1) - 6;
  const cz = (z0 + z1) / 2;
  if (i >= 6 && i <= 7 && j >= 6 && j <= 7) return;                      // the plaza
  if (i >= 2 && i <= 3 && j >= 2 && j <= 3) return;                      // the pod crater
  if (i === 10 && j === 3) return;                                       // the Underground Base
  if (j === 8) z1 = HWY.z - HWY.w / 2 - 4;                               // keep clear of the highway deck
  if (j === 9) z0 = HWY.z + HWY.w / 2 + 4;
  const zn = zoneAt(cx, cz), kind = zn ? zn.kind : 'outer';
  const A = { x0, z0, x1, z1, zone: kind };
  const edge = i === 0 || j === 0 || i === 13 || j === 13;
  if (zn && zn.name === 'Downtown') downtown(L, kit, A);
  else if (zn && zn.name === 'Industrial yard') industrial(L, kit, A);
  else if (zn && zn.name === 'Old market') market(L, kit, A);
  else outskirts(L, kit, A, edge || (zn && zn.name === 'Pod crater'));
}

const quads = A => {
  const mx = (A.x0 + A.x1) / 2, mz = (A.z0 + A.z1) / 2;
  return [{ x0: A.x0, z0: A.z0, x1: mx - 1, z1: mz - 1 }, { x0: mx + 1, z0: A.z0, x1: A.x1, z1: mz - 1 },
    { x0: A.x0, z0: mz + 1, x1: mx - 1, z1: A.z1 }, { x0: mx + 1, z0: mz + 1, x1: A.x1, z1: A.z1 }];
};
// a footprint inside a lot: w x d, pushed towards one side of the lot
function inLot(kit, lot, w, d) {
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
  w = Math.min(w, W - 2); d = Math.min(d, D - 2);
  const x0 = lot.x0 + 1 + kit.R() * (W - 2 - w), z0 = lot.z0 + 1 + kit.R() * (D - 2 - d);
  return { x0, z0, x1: x0 + w, z1: z0 + d };
}
const sides = (kit, n) => { const all = ['n', 's', 'e', 'w']; const out = []; while (out.length < n) { const s = kit.pick(all); if (!out.includes(s)) out.push(s); } return out; };

function downtown(L, kit, A) {
  const R = kit.R;
  const lots = R() < 0.55 ? quads(A) : (R() < 0.5
    ? [{ x0: A.x0, z0: A.z0, x1: A.x1, z1: (A.z0 + A.z1) / 2 - 1 }, { x0: A.x0, z0: (A.z0 + A.z1) / 2 + 1, x1: A.x1, z1: A.z1 }]
    : [{ x0: A.x0, z0: A.z0, x1: (A.x0 + A.x1) / 2 - 1, z1: A.z1 }, { x0: (A.x0 + A.x1) / 2 + 1, z0: A.z0, x1: A.x1, z1: A.z1 }]);
  for (const lot of lots) {
    const r = R(), W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
    if (r < 0.12) {                                        // a collapsed building: rubble and wrecks
      for (let k = 0; k < 4; k++) kit.rubble(kit.range(lot.x0 + 3, lot.x1 - 3), kit.range(lot.z0 + 3, lot.z1 - 3), kit.range(3, 5), 6);
      kit.wall('x', lot.z0 + 2, lot.x0 + 2, lot.x0 + W * 0.6, 0, kit.range(2, 5), [], kit.pick(COL.plaster), { jag: 0.8 });
      if (R() < 0.6) carLoot(L, kit, kit.range(lot.x0 + 4, lot.x1 - 4), kit.range(lot.z0 + 4, lot.z1 - 4), R() * Math.PI, A.zone);
    } else if (r < 0.48) {
      const f = inLot(kit, lot, kit.range(13, 20), kit.range(11, 18));
      enterable(L, kit, { ...f, floors: 2 + Math.floor(R() * 2), doors: sides(kit, 2), roof: R() < 0.6, ruin: R() * 0.9, zone: A.zone,
        kind: 'office', rich: A.zone === 'red', nest: R() < 0.18 });
      if (R() < 0.5) carLoot(L, kit, f.x1 + 3 > lot.x1 ? f.x0 - 3 : f.x1 + 3, (f.z0 + f.z1) / 2, kit.range(-0.3, 0.3), A.zone);
    } else {
      const f = inLot(kit, lot, W - kit.range(2, 7), D - kit.range(2, 7));
      solid(L, kit, { ...f, floors: 4 + Math.floor(R() * 6), ruin: R(), shop: R() < 0.55, stone: R() < 0.35 });
    }
  }
  // sandbags and barriers left from a fight
  if (R() < 0.5) sandbags(kit, kit.range(A.x0, A.x1), A.z1 + 3, R() * Math.PI);
}

function industrial(L, kit, A) {
  const R = kit.R;
  if (R() < 0.62) {
    const vertical = R() < 0.5;
    const f = vertical ? inLot(kit, { x0: A.x0, z0: A.z0, x1: A.x0 + 40, z1: A.z1 }, kit.range(26, 34), kit.range(36, 48))
      : inLot(kit, { x0: A.x0, z0: A.z0, x1: A.x1, z1: A.z0 + 38 }, kit.range(36, 48), kit.range(24, 30));
    warehouse(L, kit, { ...f, doors: vertical ? ['n', 's'] : ['e', 'w'], ruin: R() * 0.8, zone: A.zone, nest: R() < 0.3 });
    // the yard: container stacks and a fence
    const yard = vertical ? { x0: f.x1 + 4, z0: A.z0 + 2, x1: A.x1 - 2, z1: A.z1 - 2 } : { x0: A.x0 + 2, z0: f.z1 + 4, x1: A.x1 - 2, z1: A.z1 - 2 };
    for (let k = 0; k < 4; k++) {
      if (yard.x1 - yard.x0 < 8 || yard.z1 - yard.z0 < 8) break;
      containerStack(kit, kit.range(yard.x0 + 3, yard.x1 - 3), kit.range(yard.z0 + 4, yard.z1 - 4), R() < 0.5 ? 0 : Math.PI / 2, 1 + Math.floor(R() * 3));
    }
    if (R() < 0.5) addCrate(L, kit, (yard.x0 + yard.x1) / 2, 0, (yard.z0 + yard.z1) / 2, R() * Math.PI, A.zone);
  } else {
    for (let k = 0; k < 8; k++) containerStack(kit, kit.range(A.x0 + 4, A.x1 - 4), kit.range(A.z0 + 5, A.z1 - 5), R() < 0.5 ? 0 : Math.PI / 2, 1 + Math.floor(R() * 3));
    const f = inLot(kit, { x0: A.x0, z0: A.z0, x1: A.x0 + 20, z1: A.z0 + 20 }, 11, 10);
    enterable(L, kit, { ...f, floors: 1, doors: ['s'], roof: false, ruin: R() * 0.5, zone: A.zone, kind: 'warehouse' });
    addCrate(L, kit, kit.range(A.x0 + 24, A.x1 - 6), 0, kit.range(A.z0 + 24, A.z1 - 6), R() * Math.PI, A.zone);
  }
  // a low concrete fence along one side
  kit.wall('x', A.z1 - 0.5, A.x0 + 2, A.x1 - 2, 0, 1.4, [{ a: kit.range(A.x0 + 10, A.x1 - 10), w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
}

function market(L, kit, A) {
  const R = kit.R;
  for (let li = 0; li < 3; li++) for (let lj = 0; lj < 3; lj++) {
    const lot = { x0: A.x0 + li * 24, z0: A.z0 + lj * 24, x1: A.x0 + li * 24 + 20, z1: A.z0 + lj * 24 + 20 };
    if (lot.z1 > A.z1 + 0.1 || lot.z0 < A.z0 - 0.1) continue;
    const r = R();
    if (r < 0.14) {                                        // a courtyard with stalls
      stall(kit, (lot.x0 + lot.x1) / 2 - 4, (lot.z0 + lot.z1) / 2, R() * Math.PI);
      stall(kit, (lot.x0 + lot.x1) / 2 + 4, (lot.z0 + lot.z1) / 2 + 3, R() * Math.PI);
      if (R() < 0.6) kit.palm((lot.x0 + lot.x1) / 2, lot.z0 + 4, kit.range(6, 9));
      if (R() < 0.5) addCrate(L, kit, lot.x0 + 3, 0, lot.z1 - 3, R() * Math.PI, A.zone);
    } else {
      const f = inLot(kit, lot, kit.range(10, 15), kit.range(10, 14));
      if (R() < 0.78) enterable(L, kit, { ...f, floors: 1 + (R() < 0.5 ? 1 : 0), doors: sides(kit, 1 + (R() < 0.4 ? 1 : 0)), roof: R() < 0.6, ruin: R() * 0.85,
        zone: A.zone, kind: R() < 0.4 ? 'shop' : 'house', white: R() < 0.45, nest: R() < 0.16 });
      else solid(L, kit, { ...f, floors: 2, ruin: R(), white: true });
    }
  }
  for (let k = 0; k < 3; k++) if (R() < 0.6) stall(kit, kit.range(A.x0 + 4, A.x1 - 4), A.z0 + 22, R() < 0.5 ? 0 : Math.PI / 2);
}

function outskirts(L, kit, A, sparse) {
  const R = kit.R;
  for (const q of quads(A)) {
    const r = R();
    if (r < (sparse ? 0.3 : 0.55)) {
      const f = inLot(kit, q, kit.range(9, 16), kit.range(9, 15));
      if (R() < 0.55) enterable(L, kit, { ...f, floors: 1 + (R() < 0.35 ? 1 : 0), doors: sides(kit, 1 + (R() < 0.5 ? 1 : 0)), roof: R() < 0.45, ruin: 0.2 + R() * 0.8,
        zone: A.zone, kind: 'house', white: R() < 0.3 });
      else solid(L, kit, { ...f, floors: 1 + Math.floor(R() * 3), ruin: R(), stone: R() < 0.5 });
    } else if (r < 0.75) {
      // a ruined wall corner: cover in the open
      const x = kit.range(q.x0 + 4, q.x1 - 4), z = kit.range(q.z0 + 4, q.z1 - 4), c = kit.pick(COL.plaster);
      kit.wall('x', z, x - kit.range(3, 7), x + kit.range(2, 5), 0, kit.range(2, 4.5), [], c, { jag: 0.7 });
      kit.wall('z', x, z, z + kit.range(3, 6), 0, kit.range(1.5, 3.5), [], c, { jag: 0.7 });
      if (R() < 0.4) kit.rubble(x + 2, z + 2, 2.5, 4);
    }
    if (R() < 0.3) kit.palm(kit.range(q.x0 + 2, q.x1 - 2), kit.range(q.z0 + 2, q.z1 - 2), kit.range(6, 10));
  }
  if (R() < 0.35) carLoot(L, kit, kit.range(A.x0 + 6, A.x1 - 6), kit.range(A.z0 + 6, A.z1 - 6), R() * Math.PI, A.zone);
}

// ---------- props with loot ----------
function addCrate(L, kit, x, y, z, ry, zone) { containerLook(kit, 'crate', x, y, z, ry); L.containers.push({ type: 'crate', x, y, z, ry, zone }); }
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
  kit.box(0, 0.07, 0, 148, 0.04, 148, COL.plaza, { col: false, k: K.FLAT });
  for (let n = 0; n < 40; n++) kit.box(kit.range(-70, 70), 0.1, kit.range(-70, 70), kit.range(2, 6), 0.04, kit.range(2, 6), COL.paving, { col: false, k: K.FLAT });
  // the stump: solid below and above, one storey hollow where the fallen top broke into it
  const cx = 0, cz = (T.z0 + T.z1) / 2, W = T.x1 - T.x0, D = T.z1 - T.z0, b = T.breach;
  kit.box(cx, 0, cz, W, b - 0.3, D, c);
  kit.box(cx, b - 0.3, cz, W, 0.3, D, COL.slab);                                       // the room's floor
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
  for (let k = 0; k < 6; k++) kit.box(kit.range(T.x0 + 1, T.x1 - 1), b + 25.7, kit.range(T.z0 + 1, T.z1 - 1), 0.12, kit.range(3, 8), 0.12, 0x3d3a37, { col: false });
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
  // the fallen top: a slab of tower lying from the plaza up to the breach (a 18° climb), propped on its debris
  kit.ramp({ x: 60, y: 0, z: 26 }, { x: T.x1, y: b, z: -14 }, 10, 7, c);
  const yaw = Math.atan2(49, 40);
  kit.cbox(21, 4.3, -5.5, 9, 8.6, 10, kit.pick(COL.rubble), { ry: yaw + 0.3, rz: 0.08 });
  for (let k = 0; k < 7; k++) kit.rubble(kit.range(14, 62), kit.range(-8, 34), kit.range(3, 5), 5);
  for (let k = 0; k < 5; k++) kit.rubble(kit.range(T.x0 - 6, T.x1 + 4), kit.range(T.z1 + 1, T.z1 + 8), kit.range(2, 4), 5);
  // the loot room at the top of the climb
  const lr = (type, x, z, ry) => { containerLook(kit, type, x, b, z, ry); L.containers.push({ type, x, y: b, z, ry, zone: 'red' }); };
  lr('case', -9.5, -24, Math.PI / 2); lr('cache', -8, -12, Math.PI / 2); lr('crate', 0, -29.5, 0); lr('locker', 6, -29.6, 0);
  crystalsAround(L, kit, -8, b, -12, 1.6, 8);
  // around the plaza: a dry fountain, palms, wrecks, sandbags
  const fx = 40, fz = 50;
  for (let a = 0; a < 8; a++) kit.cbox(fx + Math.cos(a * Math.PI / 4) * 5, 0.4, fz + Math.sin(a * Math.PI / 4) * 5, 4.2, 0.8, 0.6, COL.white[0], { ry: -a * Math.PI / 4 + Math.PI / 2 });
  kit.box(fx, 0, fz, 1.4, 2.4, 1.4, COL.stone[1]);
  for (let k = 0; k < 10; k++) kit.palm(kit.range(-66, 66), kit.R() < 0.5 ? kit.range(-68, -60) : kit.range(60, 68), kit.range(7, 11));
  for (let k = 0; k < 7; k++) carLoot(L, kit, kit.range(-71, -63), kit.range(-60, 66), Math.PI / 2 + kit.range(-0.5, 0.5), 'red');
  sandbags(kit, -30, -45, 0.3); sandbags(kit, 30, -50, -0.4); sandbags(kit, -45, 0, Math.PI / 2);
  L.signs.push({ title: 'Collapsed Tower', sub: 'Climb the fallen top.\nSomething was left up there.', x: 66, y: 2.2, z: 32, ry: -2.2 });
}

// ---------- the highway ----------
function highway(L, kit) {
  const { z, y, w } = HWY, t = 1.0;
  const deck = (xa, xb) => {
    for (let x = xa; x < xb - 0.01; x += 32) {
      const len = Math.min(32, xb - x);
      kit.box(x + len / 2, y - t, z, len, t, w, COL.slab);
      kit.box(x + len / 2, y, z, len, 0.04, w - 0.6, COL.asphalt, { col: false, k: K.FLAT });
      for (const side of [-1, 1]) if (kit.R() > 0.12) kit.box(x + len / 2, y, z + side * (w / 2 - 0.3), len - kit.range(0, 2), 0.9, 0.5, COL.barrier);
    }
  };
  deck(-480, 20);
  deck(76, 480);
  kit.ramp({ x: -560, y: 0, z }, { x: -480, y, z }, w - 2, t, COL.slab);
  kit.ramp({ x: 560, y: 0, z }, { x: 480, y, z }, w - 2, t, COL.slab);
  kit.ramp({ x: 40, y: 0, z: z + 0.8 }, { x: 76, y, z }, w - 3, t, COL.slab);      // the collapsed section: the way up in the middle
  for (let k = 0; k < 6; k++) kit.rubble(kit.range(20, 44), z + kit.range(-7, 7), kit.range(2, 4), 5);
  for (let k = 0; k < 3; k++) kit.box(18, y, z + (k - 1) * 4, 0.6, 0.9, 3, COL.barrier);   // warning: the deck ends
  // pillars between the crossings, never on a crossing street
  for (let i = 0; i < 14; i++) for (const off of [20, 60]) {
    const x = line(i) + off;
    if (x > -476 && x < 476 && !(x > 16 && x < 80)) kit.box(x, 0, z, 2.4, y - t, 2.4, COL.slab);
  }
  // wrecks on the deck, a jack-knifed truck, sign gantries
  for (let k = 0; k < 36; k++) {
    const x = kit.R() < 0.5 ? kit.range(-470, 10) : kit.range(86, 470);
    const lane = kit.pick([-5, -1.8, 1.8, 5]);
    deckCar(L, kit, x, z + lane, (kit.R() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + kit.range(-0.4, 0.4));
  }
  const tx = kit.range(-300, -150);
  kit.cbox(tx, y + 1.9, z - 1, 2.5, 3.0, 11, 0x6a6e73, { ry: Math.PI / 2 + 0.35 });
  kit.cbox(tx + 6.5, y + 1.4, z + 2.4, 2.4, 2.4, 3, COL.rust[0], { ry: Math.PI / 2 - 0.5 });
  for (const gx of [-320, 220, 400]) {
    for (const s of [-1, 1]) kit.box(gx, y, z + s * (w / 2 - 0.6), 0.5, 6.5, 0.5, COL.metal[1]);
    kit.box(gx, y + 6, z, 0.5, 0.5, w - 0.6, COL.metal[1], { col: false });
    kit.box(gx, y + 4.8, z - 2, 0.2, 1.8, 5.5, 0x2f5a3c, { col: false });
  }
  L.signs.push({ title: 'Highway', sub: 'Broken in the middle.\nUp the collapsed slab.', x: 46, y: 2.2, z: z + 12, ry: Math.PI });
}
function deckCar(L, kit, x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw), y = HWY.y;
  kit.cbox(x, y + 0.72, z, 1.85, 0.85, 4.3, kit.pick(COL.car), { ry: yaw });
  kit.cbox(x - s * 0.2, y + 1.42, z - c * 0.2, 1.62, 0.62, 2.2, kit.pick(COL.car), { ry: yaw, col: false });
  if (kit.R() < 0.3) L.containers.push({ type: 'car', x: x - s * 2.4, y, z: z - c * 2.4, ry: yaw, zone: zoneKind(x, z) });
}

// ---------- the Underground Base: a ramp down into a bunker with Scatter nests ----------
function bunker(L, kit) {
  const B = BUNKER, F = B.floor, H = 5, rp = B.ramp, c = 0x8c8478, cw = 0x6f685e;
  L.holes.push({ x0: rp.x0, z0: rp.z0, x1: rp.x1, z1: rp.z1 });
  L.dark.push({ x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1 });
  kit.ramp({ x: 280, y: F, z: rp.z0 }, { x: 280, y: 0, z: rp.z1 }, rp.x1 - rp.x0, 0.6, 0x77706a);
  kit.box(rp.x0 - 0.15, F, (rp.z0 + rp.z1) / 2, 0.3, -F, rp.z1 - rp.z0, cw);
  kit.box(rp.x1 + 0.15, F, (rp.z0 + rp.z1) / 2, 0.3, -F, rp.z1 - rp.z0, cw);
  // the blockhouse over the top of the ramp, open to the south
  kit.wall('z', rp.x0 - 1.2, rp.z1 - 8, rp.z1 + 1.5, 0, 3.4, [], 0x9a8f80, { t: 0.6 });
  kit.wall('z', rp.x1 + 1.2, rp.z1 - 8, rp.z1 + 1.5, 0, 3.4, [], 0x9a8f80, { t: 0.6 });
  kit.box(280, 3.4, rp.z1 - 3.25, rp.x1 - rp.x0 + 3, 0.5, 9.5, 0x8a8072);
  kit.box(280, 2.6, rp.z1 + 1.45, rp.x1 - rp.x0 + 2.4, 0.8, 0.3, 0x2b2a28, { col: false });
  for (const x of [rp.x0 - 0.7, rp.x1 + 0.7]) kit.box(x, 2.2, rp.z1 + 1.6, 0.3, 0.3, 0.1, COL.lamp, { k: K.GLOW, col: false });
  crystalsAround(L, kit, rp.x0 - 2.5, 0, rp.z1 + 2, 1.2, 5);
  L.signs.push({ title: 'Underground Base', sub: 'Dark inside. Use your light (F).\nScatter nests.', x: 274, y: 2.0, z: rp.z1 + 3.5, ry: 0 });
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
  room(262, -298, 298, rp.z0, [{ s: 's', a: 280, w: rp.x1 - rp.x0 }, { s: 'w', a: -285 }, { s: 'e', a: -287 }, { s: 'n', a: 279, w: 4 }]);   // the hall
  room(248, -294, 262, -276, [{ s: 'e', a: -285 }]);
  room(298, -296, 312, -278, [{ s: 'w', a: -287 }]);
  room(277, -302, 281, -298, [{ s: 'n', a: 279, w: 4 }, { s: 's', a: 279, w: 4 }]);                                                          // a short corridor
  room(266, -312, 294, -302, [{ s: 's', a: 279, w: 4 }]);                                                                                      // the nest room
  for (const [x, z] of [[271, -290], [289, -290], [271, -278], [289, -278]]) kit.box(x, F, z, 1, H, 1, 0x7a736a);
  for (let k = 0; k < 6; k++) kit.box(kit.range(266, 294), F, kit.range(-295, -274), 1.2, 1.2, 1.2, kit.pick(COL.rust));
  const lr = (type, x, z, ry) => { containerLook(kit, type, x, F, z, ry); L.containers.push({ type, x, y: F, z, ry, zone: 'yellow' }); };
  lr('locker', 249.0, -280, Math.PI / 2); lr('locker', 249.0, -283, Math.PI / 2); lr('crate', 256, -292.5, 0);
  lr('toolbox', 311.0, -282, -Math.PI / 2); lr('case', 311.0, -291, -Math.PI / 2); lr('crate', 294, -296.5, 0);
  lr('cache', 270, -309, 0); lr('cache', 290, -309, 0); lr('crate', 262.8, -272, Math.PI / 2);
  crystalsAround(L, kit, 280, F, -308, 5, 22);
  crystalsAround(L, kit, 252, F, -290, 2.5, 8);
  L.nestSpots.push({ x: 280, y: F + 0.1, z: -308, zone: 'yellow', bunker: true }, { x: 255, y: F + 0.1, z: -287, zone: 'yellow', bunker: true },
    { x: 266, y: F + 0.1, z: -294, zone: 'yellow', bunker: true });
  L.interiors.push({ x0: 262, z0: -298, x1: 298, z1: -270, y0: F, y1: -1 });
  // up top, the yard around the blockhouse
  containerStack(kit, 300, -300, 0, 2); containerStack(kit, 256, -300, Math.PI / 2, 1); containerStack(kit, 304, -268, Math.PI / 2, 3);
  kit.wall('x', B.z0 + 0.5, B.x0 + 2, B.x1 - 2, 0, 1.4, [{ a: 262, w: 6, b: 0, t: 1.4 }], COL.barrier, { t: 0.4, jag: 0.25 });
}

// ---------- the Pod Crater ----------
function crater(L, kit) {
  const C = CRATER;
  L.decals.push({ x: C.x, z: C.z, r: C.r, c: 0x7d6a57 }, { x: C.x, z: C.z, r: C.r * 0.72, c: COL.scorch });
  L.pods.push({ x: C.x - 2, z: C.z + 2, s: 7.5, h: 16, tilt: 0.38, ry: 0.6 });
  // the pod's body, for the physics (a few boxes inside the shape)
  kit.cbox(C.x - 2, 4, C.z + 2, 9, 8, 9, 0, { ry: 0.6 + Math.PI / 4, rx: 0.2, k: K.SOLID }).hide = true;
  kit.cbox(C.x - 0.5, 10, C.z + 4.5, 4.5, 6, 4.5, 0, { ry: 0.6 + Math.PI / 4, rx: 0.3 }).hide = true;
  for (let a = 0; a < 14; a++) {
    const ang = a / 14 * Math.PI * 2 + kit.range(-0.1, 0.1), r = C.r * kit.range(0.82, 1.05);
    kit.rubble(C.x + Math.cos(ang) * r, C.z + Math.sin(ang) * r, kit.range(3, 6), 6);
  }
  crystalsAround(L, kit, C.x - 2, 0, C.z + 2, 14, 40);
  for (let k = 0; k < 5; k++) {
    const a = kit.R() * Math.PI * 2, r = kit.range(18, 40);
    kit.wall('x', C.z + Math.sin(a) * r, C.x + Math.cos(a) * r - 3, C.x + Math.cos(a) * r + 3, 0, kit.range(1.5, 3.5), [], kit.pick(COL.plaster), { jag: 0.8 });
  }
  for (const [dx, dz] of [[14, -6], [-12, 13]]) { containerLook(kit, 'cache', C.x + dx, 0, C.z + dz, 0); L.containers.push({ type: 'cache', x: C.x + dx, y: 0, z: C.z + dz, ry: 0, zone: 'yellow' }); }
  L.signs.push({ title: 'Pod Crater', sub: 'They landed here first.\nFlies guard it.', x: C.x + 50, y: 2.2, z: C.z + 40, ry: -0.8 });
}

// ---------- the map's edge: extraction points, drop zones, dunes ----------
function edges(L, kit) {
  const ex = [{ id: 'north', name: 'North Relay', x: 0, z: -584 }, { id: 'east', name: 'Rail Yard', x: 584, z: 290 }, { id: 'west', name: 'Dune Pad', x: -584, z: 470 }];
  for (const e of ex) {
    kit.box(e.x, 0, e.z, 12, 0.3, 12, 0x8b857c);
    kit.box(e.x + 4.5, 0.3, e.z - 4.5, 0.35, 9, 0.35, COL.metal[1]);
    kit.box(e.x + 4.5, 9.3, e.z - 4.5, 0.7, 0.7, 0.7, COL.green, { k: K.GLOW, col: false });
    kit.box(e.x, 0.3, e.z, 10, 0.04, 0.3, COL.green, { k: K.GLOW, col: false });
    kit.box(e.x, 0.3, e.z, 0.3, 0.04, 10, COL.green, { k: K.GLOW, col: false });
    sandbags(kit, e.x - 7.5, e.z, Math.PI / 2); sandbags(kit, e.x + 7.5, e.z, Math.PI / 2);
    addCrate(L, kit, e.x - 4, 0.3, e.z + 4.5, 0, 'outer');
    L.extracts.push({ ...e, kind: 'extract', short: e.name });
    L.signs.push({ title: 'Extraction', sub: `${e.name}\nOpens with the raid rules`, x: e.x - 3, y: 2.3, z: e.z - 6.5, ry: Math.atan2(-e.x, -e.z) + Math.PI });
  }
  const dz = [[-584, -180], [-200, 584], [180, 584], [584, -120], [210, -584], [-584, 140]];
  for (const [x, z] of dz) L.spawns.push({ x, y: 0.05, z, yaw: Math.atan2(x, z) });
  // dunes beyond the edge (only to look at), and the map's invisible wall
  for (let n = 0; n < 70; n++) {
    const a = kit.R() * Math.PI * 2, r = kit.range(640, 980);
    L.dunes.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, sx: kit.range(40, 110), sy: kit.range(8, 26), sz: kit.range(30, 80), ry: kit.R() * Math.PI });
  }
  for (let n = 0; n < 24; n++) {
    const s = n % 4, t = kit.range(-560, 560), off = kit.range(590, 598);
    const [x, z] = s === 0 ? [t, -off] : s === 1 ? [t, off] : s === 2 ? [-off, t] : [off, t];
    kit.rubble(x, z, kit.range(3, 6), 5);
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
  const pt = (i, j) => ({ x: line(i), z: line(j) });
  // a loop round a rectangle of blocks, along the streets, with points every block
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
  for (const [i0, j0, i1, j1] of [[1, 1, 4, 4], [9, 1, 12, 4], [1, 10, 4, 13], [10, 10, 13, 13], [4, 4, 10, 8], [5, 0, 9, 2], [0, 5, 2, 9], [12, 5, 14, 9]]) {
    const route = loop(i0, j0, i1, j1);
    P('patrol', ['fink'], at(route, 4.5), { route, alt: 4.5, speed: 2 });
  }
  // Fly groups patrolling round a few blocks
  // (no loop runs along z = 160: under the highway deck stand its pillars)
  for (const [i0, j0, i1, j1, n] of [[5, 5, 9, 6, 3], [9, 2, 11, 4, 3], [2, 10, 4, 12, 3], [1, 2, 2, 4, 2], [10, 5, 12, 7, 2], [6, 11, 8, 13, 2], [3, 5, 5, 7, 2]]) {
    const route = loop(i0, j0, i1, j1);
    P('patrol', Array(n).fill('fly'), at(route, 3.5), { route, alt: 3.5, speed: 1.6 });
  }
  // the plaza: Flies over the north of it, a Swatter with two Flies round the whole of it
  P('patrol', ['fly', 'fly', 'fly'], { x: -40, y: 8, z: -66 }, { route: [{ x: -40, z: -66 }, { x: 60, z: -66 }, { x: 60, z: -45 }, { x: -40, z: -45 }], alt: 8, speed: 1.6 });
  P('patrol', ['swatter', 'fly', 'fly'], { x: -80, y: 10, z: -80 }, { route: loop(6, 6, 8, 8), alt: 10, speed: 1.8 });
  // a Swatter flies up and down the highway
  P('patrol', ['swatter'], { x: -400, y: HWY.y + 6, z: HWY.z }, { route: [{ x: -400, z: HWY.z }, { x: -150, z: HWY.z }, { x: 150, z: HWY.z }, { x: 400, z: HWY.z }], routeBack: true, alt: 6, speed: 1.8 });
  // Flies circling the crashed pod
  const C = CRATER, ring = [];
  for (let k = 0; k < 6; k++) ring.push({ x: C.x + Math.cos(k / 6 * Math.PI * 2) * 30, z: C.z + Math.sin(k / 6 * Math.PI * 2) * 30 });
  P('patrol', ['fly', 'fly', 'fly', 'fly'], { x: ring[0].x, y: 5, z: ring[0].z }, { route: ring, alt: 5, speed: 1.6 });
  // the Roach: one, in the red zone, walking the open south-west of the plaza
  P('roach', ['roach'], { x: -50, y: 0.1, z: 20 }, { route: [{ x: -50, z: 20 }, { x: -15, z: 55 }, { x: -55, z: 60 }], noRespawn: true, radius: 190 });
  // Scatter nests: in the base, and in some houses (at most eight)
  const spots = L.nestSpots.filter(s => !s.bunker);
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  for (const s of [...L.nestSpots.filter(q => q.bunker), ...spots.slice(0, 8)]) {
    P('nest', Array(2 + (R() < 0.5 ? 1 : 0)).fill('scatter'), { x: s.x, y: s.y, z: s.z }, { radius: s.bunker ? 70 : 90 });
    crystalsAround(L, kit, s.x, s.y - 0.1, s.z, 1.8, 6);
  }
}

// ---------- a few things lying around ----------
function looseItems(L, kit) {
  const pool = [['light_ammo', 12, 30], ['pulse_cell', 15, 35], ['stim', 1, 1], ['scrap_metal', 1, 3], ['wires', 1, 2], ['battery', 1, 1]];
  for (const room of L.interiors) {
    if (kit.R() > 0.18 || room.y0 !== 0) continue;
    const [id, a, b] = kit.pick(pool);
    L.groundItems.push({ id, n: a + Math.floor(kit.R() * (b - a + 1)), x: kit.range(room.x0 + 1, room.x1 - 1), y: room.y0 + 0.02, z: kit.range(room.z0 + 1, room.z1 - 1) });
  }
}
