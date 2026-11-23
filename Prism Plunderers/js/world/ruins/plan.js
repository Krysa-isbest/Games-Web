// The street plan of The Ruins and its zones: plain numbers shared by the generator (layout.js, landmarks.js), the
// ground's shader (groundmap.js) and the rest of the game. North is -z.
export const HALF = 400;
// street centre lines (x of the north-south streets, z of the east-west ones) and how wide they are
export const XS = [-372, -300, -228, -150, -70, 0, 70, 150, 226, 300, 372];
export const ZS = [-372, -298, -226, -150, -70, 0, 70, 140, 220, 298, 372];
export const WX = [10, 11, 12, 12, 14, 16, 14, 12, 12, 11, 10];
export const WZ = [10, 11, 12, 12, 14, 16, 14, 20, 12, 11, 10];
export const WALK = 2.5;                                 // the sidewalks round every block
export const STREET_END = 392;                           // the streets run out into the sand here
export const PLAZA = { x0: -63, z0: -63, x1: 63, z1: 63 };
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
export function onStreet(L, x, z, m = 0) {
  for (const s of L.streets) if (x > s.x0 - m && x < s.x1 + m && z > s.z0 - m && z < s.z1 + m) return true;
  return false;
}
