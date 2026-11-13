// Whiteout: the island as numbers. Its shape, where things stand, how deep the snow lies, and the clock,
// the daylight, the wind and the storms as plain functions of the world time. No rendering and no physics in
// here, so the host and every guest get exactly the same island and the same weather from the same numbers.
import { clamp, lerp } from './state.js';
import { fbm, smooth } from './scene.js';

export const SIZE = 1280, CELLS = 320, CELL = SIZE / CELLS;
export const SEA = 0.05;          // the top of the sea ice
export const EDGE = 610;          // how far out on the ice you can walk
// the menu's island, three times as big: the shack, the wreck and the tower stand in the same places
export const SHACK = { x: 0, z: 0, ry: 0.35 }, WRECK = { x: 102, z: -78, ry: -0.9 }, TOWER = { x: -276, z: 192 };
const FLAT = [[SHACK, 11, 30, 0], [WRECK, 10, 28, -0.4], [TOWER, 7, 20, 0]];

function rawHeight(x, z) {
  const r = Math.hypot(x, z), ang = Math.atan2(z, x);
  const coast = 450 * (0.78 + 0.4 * fbm(Math.cos(ang) * 1.6 + 3, Math.sin(ang) * 1.6 + 7, 4));
  const land = 1 - smooth(coast * 0.7, coast, r);
  const hills = fbm(x * 0.006 + 11, z * 0.006 - 4) * 24 + Math.pow(fbm(x * 0.002, z * 0.002), 2) * 52;
  // the tower stands on a hill, and the shack on a rise above the wreck
  const knoll = 22 * Math.exp(-((x - TOWER.x) ** 2 + (z - TOWER.z) ** 2) / 14000) + 8 * Math.exp(-(x * x + z * z) / 7000);
  // rocky bluffs further out: flat tops with steep banks you have to walk around (or slide down)
  const bluff = 7 * smooth(0.52, 0.55, fbm(x * 0.008 + 90, z * 0.008 + 50, 3)) * smooth(140, 200, r);
  return land * (2.5 + hills + knoll + bluff) - (1 - land) * 4 + (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 0.9 * land;
}
const flatH = FLAT.map(([p]) => rawHeight(p.x, p.z));
export function height(x, z) {
  let h = rawHeight(x, z);
  for (let i = 0; i < FLAT.length; i++) {
    const [p, a, b, dip] = FLAT[i];
    h = lerp(flatH[i] + dip, h, smooth(a, b, Math.hypot(x - p.x, z - p.z)));
  }
  return h;
}

// 0 = packed or windblown snow, 1 = deep drifts that slow you down (trodden flat around the shack and the wreck)
export function snowDepth(x, z) {
  const d = smooth(0.4, 0.62, fbm(x * 0.021 + 70, z * 0.021 + 13, 3));
  return d * smooth(9, 24, Math.hypot(x - SHACK.x, z - SHACK.z)) * smooth(9, 26, Math.hypot(x - WRECK.x, z - WRECK.z));
}

// a small seeded random generator: the same island for everyone
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- time ----------
// One full day is 20 minutes: 8 of daylight (08:00 to 16:00) and 12 of night. T is the world time in seconds
// and T = 0 is the first sunrise. The game starts at 03:20 in the night of the crash.
export const DAY = 1200, SUN_UP = 480, T_START = -210;
export const DIFF = {          // drain: body heat; food: hunger and thirst; storm: how often storms come
  easy: { name: 'Mild', drain: 0.6, storm: -0.12, food: 0.6 },
  normal: { name: 'Harsh', drain: 1, storm: 0, food: 1 },
  hard: { name: 'Brutal', drain: 1.45, storm: 0.1, food: 1.3 },
  whiteout: { name: 'Whiteout', drain: 2, storm: 0.2, food: 1.6 },
};

// everything the sky and the weather do at the world time T (bias: harder difficulties get more storms)
export function envAt(T, bias = 0, out = {}) {
  const c = ((T % DAY) + DAY) % DAY, d1 = c < 600 ? c : c - DAY;
  out.T = T;
  out.hours = c < SUN_UP ? 8 + c / 60 : (16 + (c - SUN_UP) / 45) % 24;
  out.day = 1 + Math.floor((T + 360) / DAY);                      // a new day starts at midnight
  out.light = Math.min(smooth(-30, 40, d1), 1 - smooth(440, 510, c));   // 0 = night, 1 = day
  // the sun: up in the south-east, low over the south, down in the south-west (north is -z, east is +x)
  const u = clamp((d1 + 30) / 540, 0, 1), az = lerp(-1.05, 1.05, u), el = Math.sin(u * Math.PI) * 0.4 - 0.04, ce = Math.cos(el);
  out.sx = -Math.sin(az) * ce; out.sy = Math.sin(el); out.sz = Math.cos(az) * ce;
  // storms roll in every few minutes; gusts every few seconds
  const s = Math.sin(T * 0.01496 + 2.1) * 0.6 + Math.sin(T * 0.0363 + 0.7) * 0.4;
  out.storm = smooth(0.3, 0.9, s + bias);
  const g = smooth(0.4, 0.62, fbm(T * 0.13, 7.31, 2));
  out.gust = clamp(g * (0.55 + 0.45 * out.storm) + out.storm * 0.45, 0, 1);
  out.wind = 3.5 + g * 10 + out.storm * 13;                       // metres per second
  out.wdir = 0.34 + 0.45 * Math.sin(T * 0.0041 + 1);              // the way it blows, as an angle from +x towards +z
  out.temp = lerp(-29, -13, out.light) - out.storm * 5;           // degrees C
  out.fire = 1 - smooth(-20, 220, T);                             // the wreck burns through the first night
  return out;
}
