// Who lives where in The Ruins (step 5d): about 120 Prism in about 60 groups. The spawner (spawner.js) makes the
// groups near you real robots, at most 30 robots at a time (the nearest groups first); asleep, a patrol moves on
// along its route on paper. Plain data, made from the map's seed like the rest of the city.
//
//   patrol  flies a route along the streets (the Roach walks its round): from crossing to crossing, round a loop or
//           there and back; at a lookout ({ wait } on a point) it stops and looks round for a few seconds
//   guard   hovers round one place (hover: { r, alt }): the checkpoints, the small squares, the tower's summit, the
//           army convoy on the highway
//   nest    Scatters on the ground: in buildings, in the old market's bazaars and in alleys, in the tower, in the base
//   roach   the one Roach, walking its round in the plaza (it does not come back once killed)
//
// Hard but fair: nothing within 80 m of a drop zone or an extraction pad (SAFE). The drop zones and pads lie at the
// ends of streets on the edge of the map, so the routes stay inside the second ring of streets (x and z within
// 300 m of the middle: 86 m from the edge at the closest), and a guard or a nest that would be closer is left out.
// The red zone round the plaza is the busiest.
// Where the routes must not go (NEXT-CHAT rule 17): along the highway street (z = 140) or across it at street
// height; along the two avenues between their crossings (palms grow on their planted middle; the Swatters that fly
// them keep over a lane, higher up); through the plaza; through the crater (its rim slabs reach out over the streets
// next to it, so the routes near it keep 84 m or more from its middle).
import { XS, ZS, zoneKind } from './plan.js';
import { TOWER, HWY, CRATER } from './landmarks.js';
import { crystalsAround } from './buildings.js';

export const SAFE = 80;
const FINK = { alt: 4.5, speed: 2 }, FLY = { alt: 3.5, speed: 1.6 };

// distance (on the ground) from p to the segment a-b
export function segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}
// how close a group comes to a point: anywhere along its route, or its home
export function groupReach(g, p) {
  if (!g.route || g.route.length < 2) return Math.hypot(g.pos.x - p.x, g.pos.z - p.z);
  const n = g.route.length, segs = g.routeBack ? n - 1 : n;
  let best = Infinity;
  for (let i = 0; i < segs; i++) best = Math.min(best, segDist(p, g.route[i], g.route[(i + 1) % n]));
  return best;
}
const mid = r => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
const shuffle = (a, R) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// blocked(x, y, z): would a raider standing there touch something solid (layout.js passes its grid of solid boxes)
export function prismGroups(L, kit, blocked = () => false) {
  const R = kit.R;
  const keep = [...L.spawns, ...L.extracts].map(p => ({ x: p.x, z: p.z }));
  const fairAt = (x, z) => keep.every(p => Math.hypot(p.x - x, p.z - z) >= SAFE);
  // a free spot on the ground at or near p (stalls, junk and dumpsters stand in the bazaars and alleys): a spiral
  // search, each spot tested a little wider than a raider
  const clear = (x, y, z) => !blocked(x, y, z) && [[0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]].every(([dx, dz]) => !blocked(x + dx, y, z + dz));
  const freeNear = p => {
    for (let k = 0; k < 18; k++) {
      const a = k * 2.4, d = k ? 0.8 + k * 0.45 : 0, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (clear(x, p.y, z)) return { x, y: p.y, z };
    }
    return null;
  };
  const add = (kind, members, pos, extra = {}) => {
    const g = { id: 'g' + L.prism.length, kind, members, pos, zone: zoneKind(pos.x, pos.z), ...extra };
    if (keep.some(p => groupReach(g, p) < SAFE)) return null;          // (none of the routes below is; a guard for later changes)
    L.prism.push(g);
    return g;
  };
  // a route through street crossings: [i, j] is (XS[i], ZS[j]); [i, j, s] a lookout there for about s seconds
  const cross = ([i, j, wait]) => wait ? { x: XS[i], z: ZS[j], wait } : { x: XS[i], z: ZS[j] };
  const patrolAt = (members, route, o) => add('patrol', members, { x: route[0].x, y: o.y ?? o.alt, z: route[0].z }, { route, routeBack: !!o.back, alt: o.alt, speed: o.speed });
  const patrol = (members, cells, o) => patrolAt(members, cells.map(cross), o);
  const flies = n => Array(n).fill('fly');

  // ---------- Fink scouts: long rounds across the districts, with lookouts (they call the drop pods) ----------
  const scouts = [
    [[1, 1], [2, 1], [3, 1], [4, 1, 6], [4, 2], [4, 3], [3, 3], [3, 4], [2, 4, 6], [1, 4], [1, 3], [1, 2]],      // north-west, round the crater
    [[6, 1], [7, 1], [8, 1], [9, 1], [9, 2, 6], [9, 3], [9, 4], [8, 4], [7, 4], [6, 4], [6, 3, 6], [6, 2]],      // north-east, the industrial yard
    [[1, 4], [2, 4], [3, 4], [4, 4], [4, 5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [1, 5, 6]],                      // west of the plaza
    [[6, 4], [7, 4], [8, 4], [9, 4], [9, 5, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 5, 6]],                      // east of the plaza
    [[1, 8], [2, 8, 6], [3, 8], [4, 8], [4, 9, 6], [3, 9], [2, 9], [1, 9]],                                      // the old market
    [[6, 8], [7, 8, 6], [8, 8], [9, 8], [9, 9, 6], [8, 9], [7, 9], [6, 9]],                                      // south-east
  ];
  for (const c of scouts) patrol(['fink'], c, FINK);
  patrol(['fink'], [[3, 8, 5], [4, 8], [5, 8, 6], [6, 8], [7, 8, 5]], { ...FINK, back: true });                    // across the south, there and back
  patrol(['fink'], [[4, 2, 5], [5, 2, 6], [6, 2], [7, 2], [8, 2, 6], [9, 2, 5]], { ...FINK, back: true });           // across the north

  // ---------- Fly patrols round blocks (a Swatter with two Flies round the plaza) ----------
  patrol(['swatter', 'fly', 'fly'], [[4, 4], [5, 4], [6, 4], [6, 5, 5], [6, 6], [5, 6], [4, 6], [4, 5, 5]], { alt: 10, speed: 1.8 });
  const loops = [
    [3, [[3, 3], [4, 3], [5, 3, 4], [6, 3], [7, 3], [7, 4], [6, 4], [5, 4], [4, 4], [3, 4]]],   // downtown, north of the plaza
    [2, [[3, 4], [4, 4], [4, 5], [4, 6], [3, 6], [3, 5, 4]]],                                // downtown, west of the plaza
    [2, [[6, 4], [7, 4], [7, 5, 4], [7, 6], [6, 6], [6, 5]]],                                // downtown, east of the plaza
    [3, [[7, 1], [8, 1], [9, 1], [9, 2], [9, 3], [8, 3, 4], [7, 3], [7, 2]]],                // the industrial yard
    [3, [[1, 8], [2, 8], [3, 8], [3, 9, 4], [2, 9], [1, 9]]],                                // the old market
    [2, [[1, 4], [2, 4], [2, 5], [2, 6, 4], [1, 6], [1, 5]]],                                // the west
    [2, [[8, 4], [9, 4], [9, 5], [9, 6], [8, 6, 4], [8, 5]]],                                // the east
    [2, [[4, 8], [5, 8], [6, 8], [6, 9], [5, 9, 4], [4, 9]]],                                // south, across the avenue
    [2, [[4, 1], [5, 1], [6, 1], [6, 2, 4], [5, 2], [4, 2]]],                                // north, across the avenue
    [2, [[7, 8], [8, 8], [9, 8], [9, 9], [8, 9, 4], [7, 9]]],                                // south-east
  ];
  for (const [n, c] of loops) patrol(flies(n), c, FLY);
  patrol(flies(2), [[1, 2], [1, 3], [1, 4], [2, 4], [3, 4, 4], [3, 3]], { ...FLY, back: true });                   // north-west, there and back
  // the plaza: Flies over the north of it (between the tower and the burning bus, clear of the fallen pieces)
  patrolAt(flies(3), [{ x: -44, z: -50 }, { x: 26, z: -50, wait: 4 }, { x: 26, z: -42 }, { x: -44, z: -42, wait: 4 }], { alt: 9, speed: 1.6 });

  // ---------- Swatters: up and down the highway over the jam, up and down two avenues (over a lane: the palms) ----------
  const hy = HWY.y;
  patrolAt(['swatter'], [{ x: -280, y: hy, z: HWY.z, wait: 4 }, { x: -120, y: hy, z: HWY.z }, { x: 120, y: hy, z: HWY.z }, { x: 280, y: hy, z: HWY.z, wait: 4 }],
    { alt: 6, y: hy + 6, speed: 1.8, back: true });
  patrolAt(['swatter'], [{ x: 5.5, z: -78, wait: 5 }, { x: 5.5, z: -150 }, { x: 5.5, z: -226 }, { x: 5.5, z: -296, wait: 5 }], { alt: 8, speed: 1.8, back: true });
  patrolAt(['swatter'], [{ x: 78, z: 5.5, wait: 5 }, { x: 150, z: 5.5 }, { x: 226, z: 5.5 }, { x: 296, z: 5.5, wait: 5 }], { alt: 8, speed: 1.8, back: true });

  // ---------- the crater: Flies circling over the bowl, a Swatter closer in over the pod ----------
  const C = CRATER;
  const ring = (r, n, look) => Array.from({ length: n }, (_, k) => {
    const a = k / n * Math.PI * 2, p = { x: C.x + Math.cos(a) * r, z: C.z + Math.sin(a) * r };
    if (look.includes(k)) p.wait = 5;
    return p;
  });
  patrolAt(flies(4), ring(30, 6, [1, 4]), { alt: 5, speed: 1.6 });
  patrolAt(['swatter'], ring(20, 6, [0, 3]), { alt: 9, speed: 1.8 });

  // ---------- the Roach: one, in the red zone, a long round through the open south-west of the plaza ----------
  add('roach', ['roach'], { x: -48, y: 0.1, z: 10 }, {
    route: [{ x: -48, z: 10 }, { x: -46, z: 42 }, { x: -24, z: 48 }, { x: -2, z: 40 }, { x: -4, z: 8 }, { x: -26, z: 4 }], noRespawn: true, radius: 190,
  });

  // ---------- guards: hovering round one place ----------
  const guard = (members, x, y, z, r, alt) => add('guard', members, { x, y, z }, { hover: { r, alt } });
  guard(flies(3), -6, TOWER.top + 5, -26, 4, 5);                                         // roosting over the tower's summit (above its column stumps)
  for (const c of L.props.filter(p => p.t === 'checkpoint')) if (fairAt(c.x, c.z)) guard(flies(2), c.x, 5, c.z, 4, 5);   // every checkpoint
  const squares = shuffle(L.squares.filter(s => { const m = mid(s); return fairAt(m.x, m.z); }), R);
  for (const s of squares.slice(0, 5)) { const m = mid(s); guard(flies(2), m.x + 5, 6, m.z, 7, 6); }                     // over the small squares (beside the monument)
  guard(flies(2), 256, HWY.y + 4.5, HWY.z, 7, 4.5);                                      // the army convoy on the highway

  // ---------- Scatter nests ----------
  const nest = (s, n, radius) => {
    if (add('nest', Array(n).fill('scatter'), { x: s.x, y: s.y, z: s.z }, { radius })) crystalsAround(L, kit, s.x, s.y - 0.1, s.z, 1.8, 6);
  };
  for (const s of L.nestSpots.filter(q => q.bunker)) nest(s, 2 + (R() < 0.5 ? 1 : 0), 70);   // the base, four rooms
  for (const s of L.nestSpots.filter(q => q.tower)) nest(s, 3, 60);                          // the tower, floor 3
  const spots = shuffle(L.nestSpots.filter(q => !q.bunker && !q.tower && fairAt(q.x, q.z)), R);
  for (const s of spots.slice(0, 8)) nest(s, 2 + (R() < 0.5 ? 1 : 0), 90);                  // in buildings
  // in the old market's bazaars and in alleys: waiting on the ground among the stalls and the junk
  const bazaars = shuffle(L.yards.filter(yd => { const m = mid(yd); return yd.kind === 'market' && fairAt(m.x, m.z); }), R);
  for (const yd of bazaars.slice(0, 4)) { const s = freeNear({ ...mid(yd), y: 0.1 }); if (s) nest(s, 2, 70); }
  const alleys = shuffle(L.alleys.filter(a => { const m = mid(a); return fairAt(m.x, m.z); }), R);
  for (const a of alleys.slice(0, 4)) { const s = freeNear({ ...mid(a), y: 0.1 }); if (s) nest(s, 2, 60); }
}
