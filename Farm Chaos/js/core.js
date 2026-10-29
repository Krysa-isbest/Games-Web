// core.js — shared utilities, data tables, settings and input
'use strict';

const U = {
  clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  pick: (arr, r) => arr[Math.floor((r === undefined ? Math.random() : r) * arr.length) % arr.length],
  // seeded PRNG (mulberry32) — events use it so every client simulates the same thing
  rng(seed) {
    let s = seed >>> 0;
    const f = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + f() * (b - a);
    f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
    return f;
  },
  hash2(x, z) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },
  noise2(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const s = t => t * t * (3 - 2 * t);
    const a = U.hash2(xi, zi), b = U.hash2(xi + 1, zi), c = U.hash2(xi, zi + 1), d = U.hash2(xi + 1, zi + 1);
    const u = s(xf), v = s(zf);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  },
  fbm(x, z, oct = 4) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { v += a * U.noise2(x * f, z * f); f *= 2.03; a *= 0.5; }
    return v;
  },
  money: n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'),
  uid: () => Math.random().toString(36).slice(2, 10),
  angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; },
  smooth: t => t * t * (3 - 2 * t),
};

const DAY = 600;            // real seconds per in-game day
const DEBT_START = 120000;  // pay this off to trigger the final day
const MAX_PLAYERS = 4;
const TILE = 1.6;           // field tile size in metres
const PLOT_N = 8;           // tiles per plot side

// shape = which model builder draws it; leaf/fruit = colors
const CROPS = [
  { name: 'Wheat',        cost: 4,   sell: 10,  grow: 70,  day: 1,  shape: 'wheat',   leaf: 0x7fae3e, fruit: 0xe4c25a },
  { name: 'Lettuce',      cost: 6,   sell: 16,  grow: 60,  day: 1,  shape: 'lettuce', leaf: 0x8fd14f, fruit: 0xb5e77a },
  { name: 'Carrot',       cost: 8,   sell: 20,  grow: 90,  day: 1,  shape: 'carrot',  leaf: 0x4f9e35, fruit: 0xf08a24 },
  { name: 'Potato',       cost: 10,  sell: 26,  grow: 110, day: 1,  shape: 'bush',    leaf: 0x5b8f3a, fruit: 0xc9a46a },
  { name: 'Tomato',       cost: 18,  sell: 45,  grow: 150, day: 2,  shape: 'tomato',  leaf: 0x3f8a32, fruit: 0xe23b2e },
  { name: 'Corn',         cost: 22,  sell: 55,  grow: 170, day: 2,  shape: 'corn',    leaf: 0x6aa63a, fruit: 0xf4d03f },
  { name: 'Cabbage',      cost: 20,  sell: 48,  grow: 140, day: 2,  shape: 'cabbage', leaf: 0x7cbf6a, fruit: 0xa8dc8c },
  { name: 'Strawberry',   cost: 30,  sell: 70,  grow: 160, day: 3,  shape: 'berry',   leaf: 0x3c8f3c, fruit: 0xe8283c },
  { name: 'Bell Pepper',  cost: 34,  sell: 80,  grow: 170, day: 3,  shape: 'pepper',  leaf: 0x3d8a2f, fruit: 0xf5a623 },
  { name: 'Eggplant',     cost: 40,  sell: 95,  grow: 190, day: 4,  shape: 'eggplant',leaf: 0x4a7f35, fruit: 0x5b2a6e },
  { name: 'Sunflower',    cost: 45,  sell: 105, grow: 200, day: 4,  shape: 'sunflower',leaf: 0x5c9c34, fruit: 0xf7c531 },
  { name: 'Blueberry',    cost: 55,  sell: 125, grow: 210, day: 5,  shape: 'berry',   leaf: 0x2f7a45, fruit: 0x3f5fd8 },
  { name: 'Pumpkin',      cost: 70,  sell: 165, grow: 240, day: 5,  shape: 'pumpkin', leaf: 0x4c8a2c, fruit: 0xf07a1a },
  { name: 'Cauliflower',  cost: 60,  sell: 140, grow: 220, day: 6,  shape: 'cauli',   leaf: 0x5f9c55, fruit: 0xf2eedc },
  { name: 'Watermelon',   cost: 90,  sell: 210, grow: 260, day: 6,  shape: 'melon',   leaf: 0x3f8a2c, fruit: 0x2f8a3a },
  { name: 'Pineapple',    cost: 110, sell: 260, grow: 280, day: 7,  shape: 'pineapple',leaf: 0x4a8a4a, fruit: 0xe9b730 },
  { name: 'Dragonfruit',  cost: 140, sell: 330, grow: 300, day: 8,  shape: 'dragon',  leaf: 0x56a05a, fruit: 0xe8338c },
  { name: 'Chaos Pepper', cost: 160, sell: 400, grow: 300, day: 9,  shape: 'pepper',  leaf: 0x2c6e2a, fruit: 0xff2a00, chaos: true },
  { name: 'Golden Wheat', cost: 200, sell: 480, grow: 320, day: 10, shape: 'wheat',   leaf: 0x9a9a3a, fruit: 0xffd700 },
  { name: 'Moon Melon',   cost: 260, sell: 620, grow: 340, day: 11, shape: 'melon',   leaf: 0x6a7fa8, fruit: 0xbfd9ff, moon: true },
];

// crop mutations caused by events
const MUTS = [
  { n: '',       mult: 1,   tint: [1, 1, 1],         scale: 1 },
  { n: 'Acid',   mult: 2.5, tint: [0.55, 1.55, 0.4], scale: 1.1 },
  { n: 'Giant',  mult: 5,   tint: [1.25, 1.5, 0.55], scale: 1.8 },
  { n: 'Alien',  mult: 4,   tint: [1.0, 0.55, 1.7],  scale: 1.15 },
  { n: 'Star',   mult: 8,   tint: [1.7, 1.4, 0.5],   scale: 1.25 },
];

const GOODS = {
  egg:       { name: 'Egg',              value: 15 },
  milk:      { name: 'Milk',             value: 40 },
  wool:      { name: 'Wool',             value: 55 },
  truffle:   { name: 'Truffle',          value: 120 },
  frog:      { name: 'Frog',             value: 8 },
  fish:      { name: 'Fish',             value: 14 },
  meteorite: { name: 'Meteorite chunk',  value: 150 },
  stardust:  { name: 'Stardust',         value: 220 },
  pumpkinbit:{ name: 'Giant pumpkin chunk', value: 25 },
};

function itemValue(key) {
  if (key[0] === 'c') { const [id, m] = key.slice(1).split('_').map(Number); return CROPS[id].sell * MUTS[m || 0].mult; }
  return GOODS[key] ? GOODS[key].value : 0;
}
function itemName(key) {
  if (key[0] === 'c') { const [id, m] = key.slice(1).split('_').map(Number); return (m ? MUTS[m].n + ' ' : '') + CROPS[id].name; }
  return GOODS[key] ? GOODS[key].name : key;
}

const PLOTS = [];
for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) {
  PLOTS.push({ x: -30 + i * 15, z: 4 + j * 15, cost: [0, 1500, 3000, 5000, 8000, 12000, 18000, 25000][PLOTS.length] });
}
const TILES_TOTAL = PLOTS.length * PLOT_N * PLOT_N;

const UPGRADES = [
  // tools
  { id: 'widehoe',  cat: 'Tools',    name: 'Wide Hoe',        cost: 600,   desc: 'Tills a 3×3 area at once.' },
  { id: 'spreader', cat: 'Tools',    name: 'Seed Spreader',   cost: 900,   desc: 'Plants a 3×3 area at once.' },
  { id: 'scythe',   cat: 'Tools',    name: 'Scythe',          cost: 1200,  desc: 'Harvests a 3×3 area at once.' },
  { id: 'backpack', cat: 'Tools',    name: 'Big Backpack',    cost: 800,   desc: 'Carry 120 items instead of 40.' },
  { id: 'boots',    cat: 'Tools',    name: 'Running Boots',   cost: 700,   desc: 'Everyone runs 30% faster.' },
  { id: 'tractor',  cat: 'Tools',    name: 'Tractor',         cost: 0,     desc: 'Coming in the next update!', soon: true },
  // defenses
  { id: 'rod',      cat: 'Defenses', name: 'Lightning Rods',  cost: 2500,  desc: '80% of lightning hits the rods instead.' },
  { id: 'windfence',cat: 'Defenses', name: 'Wind Fences',     cost: 4000,  desc: 'Tornado, hurricane & sandstorm crop damage halved.' },
  { id: 'hardhat',  cat: 'Defenses', name: 'Hard Hats',       cost: 2000,  desc: 'Hail, frogs, fish and debris hurt half as much.' },
  { id: 'hazmat',   cat: 'Defenses', name: 'Hazmat Suits',    cost: 3000,  desc: 'Immune to acid rain and radiation.' },
  { id: 'scarecrow',cat: 'Defenses', name: 'Scarecrows',      cost: 1500,  desc: 'Locusts and gnomes do half damage.' },
  { id: 'sprinkler',cat: 'Defenses', name: 'Fire Sprinklers', cost: 4500,  desc: 'Fires die out fast, heatwaves hurt crops less.' },
  { id: 'seismic',  cat: 'Defenses', name: 'Shock Absorbers', cost: 5000,  desc: 'Earthquake, sinkhole & mole damage halved.' },
  { id: 'bunker',   cat: 'Defenses', name: 'Bunker',          cost: 5000,  desc: 'Underground room. Safe from everything except the apocalypse.' },
  { id: 'laser',    cat: 'Defenses', name: 'Anti-Alien Laser',cost: 7000,  desc: 'Shoots UFOs and gnomes. Abductions fail 75% of the time.' },
  { id: 'gh0',      cat: 'Greenhouses', name: 'Greenhouse — Field 1', cost: 3000, desc: 'Protects field 1 from rain, hail, snow, heat, frogs, fish & locusts.', plot: 0 },
  { id: 'gh1',      cat: 'Greenhouses', name: 'Greenhouse — Field 2', cost: 3500, desc: 'Same for field 2.', plot: 1 },
  { id: 'gh2',      cat: 'Greenhouses', name: 'Greenhouse — Field 3', cost: 4000, desc: 'Same for field 3.', plot: 2 },
  { id: 'gh3',      cat: 'Greenhouses', name: 'Greenhouse — Field 4', cost: 4500, desc: 'Same for field 4.', plot: 3 },
  { id: 'gh4',      cat: 'Greenhouses', name: 'Greenhouse — Field 5', cost: 5000, desc: 'Same for field 5.', plot: 4 },
  { id: 'gh5',      cat: 'Greenhouses', name: 'Greenhouse — Field 6', cost: 5500, desc: 'Same for field 6.', plot: 5 },
  { id: 'gh6',      cat: 'Greenhouses', name: 'Greenhouse — Field 7', cost: 6000, desc: 'Same for field 7.', plot: 6 },
  { id: 'gh7',      cat: 'Greenhouses', name: 'Greenhouse — Field 8', cost: 6500, desc: 'Same for field 8.', plot: 7 },
];

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff6fb5];

// ---------------- settings ----------------
const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft',
  crouch: 'KeyC', interact: 'KeyE', nextSeed: 'KeyR', ping: 'KeyQ', chat: 'KeyT', scoreboard: 'Tab',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3',
};
const KEY_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump',
  sprint: 'Sprint', crouch: 'Crouch', interact: 'Interact / use', nextSeed: 'Next seed', ping: 'Ping spot',
  chat: 'Chat', scoreboard: 'Scoreboard', slot1: 'Hand / harvest', slot2: 'Hoe', slot3: 'Seeds',
};

const S = {
  d: {
    name: 'Farmer' + Math.floor(Math.random() * 90 + 10), color: Math.floor(Math.random() * 8),
    quality: 'medium', renderScale: 1, viewDist: 260, particles: 1, fov: 80, sens: 1, invertY: false,
    sprintMode: 'hold', crouchMode: 'hold', vol: 0.8, sfxVol: 1, warnVol: 1, ambVol: 0.7,
    shake: 1, reduceFlash: false, camTilt: true, showFps: false,
    keys: Object.assign({}, DEFAULT_KEYS),
    host: { freq: 1, apoc: 'rare', calmDay1: true },
  },
  load() {
    try {
      const j = JSON.parse(localStorage.getItem('farmchaos_settings') || 'null');
      if (j) {
        const keys = Object.assign({}, DEFAULT_KEYS, j.keys || {});
        const host = Object.assign({}, this.d.host, j.host || {});
        Object.assign(this.d, j); this.d.keys = keys; this.d.host = host;
      }
    } catch (e) { }
  },
  save() { try { localStorage.setItem('farmchaos_settings', JSON.stringify(this.d)); } catch (e) { } },
};
S.load();

// ---------------- input ----------------
const K = {
  held: new Set(), pressed: new Set(), mouse: [false, false, false], mouseClicked: [false, false, false],
  dx: 0, dy: 0, wheel: 0, locked: false, typing: false, rebinding: null,
  down(action) { return this.held.has(S.d.keys[action]); },
  hit(action) { return this.pressed.has(S.d.keys[action]); },
  endFrame() { this.pressed.clear(); this.mouseClicked = [false, false, false]; this.dx = 0; this.dy = 0; this.wheel = 0; },
  keyName(code) {
    if (!code) return '—';
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$/, ' L').replace(/Right$/, ' R');
  },
};
addEventListener('keydown', e => {
  if (K.rebinding) {
    e.preventDefault();
    if (e.code !== 'Escape') { S.d.keys[K.rebinding] = e.code; S.save(); }
    K.rebinding = null; if (window.UI) UI.renderKeybinds();
    return;
  }
  if (K.typing) return;
  if (e.code === 'Tab' || e.code === 'Space' || (e.code.startsWith('Arrow'))) e.preventDefault();
  if (!K.held.has(e.code)) K.pressed.add(e.code);
  K.held.add(e.code);
});
addEventListener('keyup', e => { K.held.delete(e.code); });
addEventListener('blur', () => { K.held.clear(); K.mouse = [false, false, false]; });
addEventListener('mousedown', e => { if (K.locked) { K.mouse[e.button] = true; K.mouseClicked[e.button] = true; } });
addEventListener('mouseup', e => { K.mouse[e.button] = false; });
addEventListener('mousemove', e => { if (K.locked) { K.dx += e.movementX; K.dy += e.movementY; } });
addEventListener('wheel', e => { if (K.locked) K.wheel += Math.sign(e.deltaY); }, { passive: true });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { K.locked = !!document.pointerLockElement; });

// ---------------- global game state ----------------
// G holds everything that is shared/synced. The host is the authority for it.
const G = {
  mode: 'menu',          // menu | solo | host | client
  isHost: true,
  myId: 'local',
  time: 0,               // game seconds since farm start (day = floor(time / DAY) + 1)
  money: 250, debt: DEBT_START,
  seeds: CROPS.map((c, i) => i === 0 ? 20 : i === 2 ? 6 : 0),
  upgrades: {},
  plots: PLOTS.map((p, i) => i === 0),
  bin: 0, binItems: 0,
  priceMult: 1,
  stats: { earned: 0, harvested: 0, destroyed: 0, deaths: 0, abducted: 0, events: 0, pieces: 0, days: 1 },
  destroyedToday: 0, insured: false,
  final: null,           // final day state
  endless: false,
  players: {},           // id -> remote player info (+ self)
  paused: false,
  started: false,
};
G.day = () => Math.floor(G.time / DAY) + 1;
G.hour = () => ((G.time % DAY) / DAY * 24 + 6) % 24; // day starts at 06:00
G.has = id => !!G.upgrades[id];
G.solo = () => G.mode === 'solo';
