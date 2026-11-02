// Shared game state. Functions (save, relock, win, spawnFurniture, endExpedition...) are attached by main.js.
// ACTIONS: every change to the shared world goes through an action, so in co-op the host can run it for a guest.
export const ACTIONS = {};

export const G = {
  mode: 'menu', ended: false, hasSave: false, world: 'shop', // world: shop | exp
  money: 400, day: 1, time: 0, phase: 'prep', // phase: prep | open | closing | evening
  debt: 0, paidWeek: 0, strikes: 0, xp: 0, trust: 0,
  backstock: [], floor: [], market: {}, marketPrev: {}, deals: [], auction: null, night: null,
  // consumables (shared by the whole team)
  gear: { battery: 0, trap: 0, mine: 0, bandage: 0, pepper: 0, taser: 0, ammo9: 0, shells: 0 },
  // things you own once
  tools: { flashlight: 0, radio: 0, screwdriver: 0, wrench: 0, crowbar: 0, magnifier: 0 },
  weapons: { bat: 0, baton: 0, pepper: 0, taser: 0, revolver: 0, shotgun: 0 },
  up: { workshop: false, coop: false, chickens: 0, stand: false, permit: false, binCap: 5, bag: 4 },
  eggs: 0, doorOpen: true, index: {},
  binCount: 0, stats: { sales: 0, sold: 0, spent: 0, eggs: 0 },
  // runtime only
  me: 'p0', players: {}, pending: null,
  spawnT: 3, standT: 20, shelves: [], customers: [], trash: [], interactables: [], chickens: [], eggMeshes: [],
  scene: null, sun: null, openSign: null, binFill: null, carry: null, serving: null, uiOpen: false, running: false,
};

export const pick = (a, r = Math.random) => a[r() * a.length | 0];
export const rand = (a, b, r = Math.random) => a + r() * (b - a);
export const level = () => 1 + Math.floor(Math.sqrt((G.xp || 0) / 150));
export const me = () => G.players[G.me];
export const newUid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Seeded random (mulberry32). Same seed = same map on every player's machine.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ensurePlayer(id, name = 'Player') {
  return G.players[id] ??= { id, name, x: -4.5, y: 1.6, z: 3.6, ry: 0, world: 'shop', hp: 100, down: false, hidden: false, holding: null, talking: false, radio: false, cab: false };
}
