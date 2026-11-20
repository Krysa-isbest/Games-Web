// Whiteout: things you can pick up. What each kind is, how it looks, the items lying in the world (the stash),
// and what you carry (the inventory: 5 hotbar slots, a 10-slot backpack, the coat you wear).
// Items you drop are physics objects until they come to rest; then they lie still (no physics, so many of them
// cost nothing) and slowly get buried by the snow outside, faster in a storm. You can still dig them out.
// Co-op: the host's stash is the real one; guests draw what the host sends and ask the host to take or drop.
import * as THREE from 'three';
import { SEA, DAY } from './island.js';

// stack: how many fit in one slot. fuel: seconds in the stove (wood: when dry). patch: covers a gap in the shack.
// take: seconds you hold the use key to pick it up. h: half its height lying down.
// tool: { power: how much one blow does, use: how much edge one blow costs, breaks: falls apart at no edge }.
// A thing's "dry" number is its condition: how dry wood is, how sharp a tool is (1 = dry / sharp).
export const TYPES = {
  axe: { name: 'the axe', short: 'Axe', icon: '🪓', stack: 1, take: 0.6, h: 0.03, tool: { power: 1, use: 0.008 } },
  log: { name: 'a log', short: 'Log', icon: '🪵', stack: 2, fuel: 300, wood: true, take: 0.5, h: 0.13 },
  split: { name: 'split wood', short: 'Split wood', icon: '🪵', stack: 4, fuel: 160, wood: true, take: 0.4, h: 0.065 },
  branch: { name: 'a branch', short: 'Branches', icon: '🌿', stack: 6, fuel: 60, take: 0.3, h: 0.035 },
  board: { name: 'a board', short: 'Board', icon: '🟫', stack: 4, fuel: 120, patch: true, take: 0.4, h: 0.015 },
  sheet: { name: 'a sheet of metal', short: 'Metal sheet', icon: '⬜', stack: 2, patch: true, take: 0.5, h: 0.01 },
  pipe: { name: 'the stove pipe', short: 'Stove pipe', icon: '⚫', stack: 1, take: 1.2, h: 0.075 },
  fur: { name: 'the fur coat', short: 'Fur coat', icon: '🧥', stack: 1, wear: 0.75, color: '#e9dfcf', take: 1.5, h: 0.05 },
  wool: { name: 'the wool coat', short: 'Wool coat', icon: '🧥', stack: 1, wear: 0.85, color: '#33465a', take: 1.5, h: 0.05 },
  kit: { name: 'the first aid kit', short: 'First aid kit', icon: '🩹', stack: 1, take: 1.0, h: 0.05 },
  flare: { name: 'the flare gun', short: 'Flare gun', icon: '🔫', stack: 1, take: 2.5, h: 0.035 },
  trunk: { name: 'a felled tree', short: 'Tree', icon: '🌲', stack: 1, noTake: true },
  // (new kinds go at the end: saves and co-op messages use each kind's place in this list)
  saxe: { name: 'the stone axe', short: 'Stone axe', icon: '⛏️', stack: 1, take: 0.5, h: 0.04, tool: { power: 0.5, use: 0.04, breaks: true } },
  stone: { name: 'a stone', short: 'Stone', icon: '🪨', stack: 4, take: 0.4, h: 0.06 },
  // food and water (build step 5). food: what eating it does (hunger, thirst, heat; raw: it can make you sick; cook: what it becomes on the stove)
  rod: { name: 'the old fishing rod', short: 'Fishing rod', icon: '🎣', stack: 1, take: 0.6, h: 0.03 },
  pot: { name: 'the pot', short: 'Pot', icon: '🥘', stack: 1, take: 0.5, h: 0.09 },
  potsnow: { name: 'a pot of snow', short: 'Pot of snow', icon: '🧊', stack: 1, take: 0.5, h: 0.09 },
  potwater: { name: 'a pot of water', short: 'Pot of water', icon: '💧', stack: 1, take: 0.5, h: 0.09 },
  fish: { name: 'a raw fish', short: 'Raw fish', icon: '🐟', stack: 3, take: 0.4, h: 0.04, food: { hunger: 12, thirst: -4, raw: true }, cook: 'fishc' },
  bigfish: { name: 'a big raw fish', short: 'Big raw fish', icon: '🐠', stack: 1, take: 0.5, h: 0.06, food: { hunger: 22, thirst: -6, raw: true }, cook: 'bigfishc' },
  fishc: { name: 'a cooked fish', short: 'Cooked fish', icon: '🍢', stack: 3, take: 0.4, h: 0.04, food: { hunger: 30, thirst: -3, heat: 3 } },
  bigfishc: { name: 'a big cooked fish', short: 'Big cooked fish', icon: '🍖', stack: 1, take: 0.5, h: 0.06, food: { hunger: 55, thirst: -4, heat: 5 } },
  snack: { name: 'a bag of salted nuts', short: 'Salted nuts', icon: '🥜', stack: 3, take: 0.4, h: 0.03, food: { hunger: 18, thirst: -8 } },
  champ: { name: 'a bottle of champagne', short: 'Champagne', icon: '🍾', stack: 1, take: 0.5, h: 0.05, food: { hunger: 3, thirst: 18, heat: -5, drink: true } },
  // step 6: carried anywhere in your things, they help you climb out if the ice breaks under you
  picks: { name: 'a pair of ice picks', short: 'Ice picks', icon: '🔱', stack: 1, take: 0.5, h: 0.04 },
  // step 7a: the tail section and the dead survivors' camp. read: Q opens it. light: burns while you hold it (dry = how much is left)
  shells: { name: 'a flare shell', short: 'Flare shells', icon: '🧨', stack: 3, take: 0.5, h: 0.03 },
  journal: { name: 'a frozen journal', short: 'Journal', icon: '📓', stack: 1, take: 0.6, h: 0.025, read: true },
  blackbox: { name: 'the flight recorder', short: 'Flight recorder', icon: '🟧', stack: 1, take: 1.4, h: 0.09 },
  silk: { name: 'a silk scarf', short: 'Silk scarves', icon: '🧣', stack: 4, fuel: 40, take: 0.3, h: 0.012 },
  parka: { name: 'the old parka', short: 'Parka', icon: '🧥', stack: 1, wear: 0.62, color: '#5b6e3a', take: 1.5, h: 0.06 },
  caviar: { name: 'a tin of caviar', short: 'Caviar', icon: '🥫', stack: 3, take: 0.4, h: 0.02, food: { hunger: 14, thirst: -6 } },
  beans: { name: 'a can of beans', short: 'Beans', icon: '🥫', stack: 3, take: 0.4, h: 0.055, food: { hunger: 32, thirst: -2, heat: 1 } },
  torch: { name: 'a torch', short: 'Torch', icon: '🔥', stack: 1, take: 0.4, h: 0.04, light: true },
  snowshoes: { name: 'a pair of snowshoes', short: 'Snowshoes', icon: '🎾', stack: 1, take: 0.6, h: 0.03 },
  // step 7b: the satellite phone's battery, hidden under the shack's floor
  battery: { name: 'the phone\'s battery', short: 'Phone battery', icon: '🔋', stack: 1, take: 1.0, h: 0.05 },
  // step 7c: what a storm uncovers and what washes ashore (opened where they lie: daily.js), and the skipper's journal
  cache: { name: 'a frozen crate', short: 'Frozen crate', icon: '📦', stack: 1, noTake: true, h: 0.25 },
  flotsam: { name: 'wreckage', short: 'Wreckage', icon: '🧳', stack: 1, noTake: true, h: 0.14 },
  journal2: { name: 'the skipper\'s notebook', short: 'Notebook', icon: '📔', stack: 1, take: 0.6, h: 0.02, read: true },
  // step 7e: shovels (snow off the roof, digging out what is buried, a drift in a cave's mouth), guide ropes, pine tea,
  // and the old hunter's plan for a winter den in the snowed-in cave
  shovel: { name: 'the snow shovel', short: 'Snow shovel', icon: '⛏️', stack: 1, take: 0.6, h: 0.03, dig: 1 },
  wshovel: { name: 'a wooden shovel', short: 'Wooden shovel', icon: '🥄', stack: 1, take: 0.5, h: 0.03, dig: 0.6 },
  rope: { name: 'a coil of rope', short: 'Rope', icon: '🪢', stack: 2, take: 0.5, h: 0.05 },
  pottea: { name: 'a pot of pine tea', short: 'Pine tea', icon: '🍵', stack: 1, take: 0.5, h: 0.09 },
  plan: { name: 'a folded plan', short: 'The den plan', icon: '📜', stack: 1, take: 0.4, h: 0.01, read: true },
};
export const TYPE_LIST = Object.keys(TYPES);
const wet = d => (d >= 0.8 ? 'dry' : d >= 0.45 ? 'damp' : 'wet');
// "a wet log", "the axe", "3 branches"
export function nameOf(type, data = {}, n = 1) {
  const t = TYPES[type];
  if (t.tool) return t.name + edgeWord(type, data.dry ?? 1);
  if (type === 'potwater') return (data.dry ?? 0) > 0.3 ? 'a pot of warm water' : 'a pot of cold water';
  if (t.wood) return n > 1 ? `${n} ${wet(data.dry ?? 1)} ${type === 'log' ? 'logs' : 'pieces of split wood'}` : type === 'log' ? `a ${wet(data.dry ?? 1)} log` : `${wet(data.dry ?? 1)} split wood`;
  if (n > 1) return `${n} ${t.short.toLowerCase()}${type === 'branch' || type === 'board' ? '' : 's'}`;
  return t.name;
}
export const shortOf = (type, data = {}) => (TYPES[type].wood ? `${t0(wet(data.dry ?? 1))} ${TYPES[type].short.toLowerCase()}` : TYPES[type].short + (TYPES[type].tool ? edgeWord(type, data.dry ?? 1) : ''));
// how sharp a tool is, in words: "the axe (dull)"
export const DULL = 0.35;
function edgeWord(type, e) { return TYPES[type].tool.breaks ? (e < 0.3 ? ' (nearly broken)' : '') : e < DULL ? ' (dull)' : ''; }
const t0 = s => s[0].toUpperCase() + s.slice(1);

// ---------- how they look (shared geometry and materials; long things lie along x) ----------
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
let MAT = null;
const mats = () => MAT || (MAT = {
  wood: std('#7a4a25'), logBark: std('#4a3626', { roughness: 0.95 }), logEnd: std('#b08a5a', { roughness: 0.9 }), splitIn: std('#c4a072', { roughness: 0.9 }),
  steel: std('#9aa0a6', { metalness: 0.8, roughness: 0.35 }), board: std('#7d7466', { roughness: 0.92 }), sheet: std('#b9c0c8', { roughness: 0.4, metalness: 0.7 }),
  pipe: std('#1d1f22', { roughness: 0.6, metalness: 0.6 }), fur: std('#e9dfcf', { roughness: 1 }), wool: std('#33465a', { roughness: 1 }),
  white: std('#eeeeea', { roughness: 0.5 }), red: std('#c42a1e', { roughness: 0.5 }), orange: std('#e0601a', { roughness: 0.5 }), dark: std('#15181c', { roughness: 0.6 }),
  cork: std('#8a6a48', { roughness: 0.9 }), potM: std('#3a3d42', { roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }), snowTop: std('#eef4fa', { roughness: 1 }),
  water: std('#4a7290', { roughness: 0.1, metalness: 0.2 }), fishM: std('#9fb0bc', { roughness: 0.35, metalness: 0.4 }), fishDark: std('#5d6e66', { roughness: 0.4, metalness: 0.3 }),
  cooked: std('#9a6232', { roughness: 0.7 }), snackM: std('#b8352a', { roughness: 0.5 }), gold: std('#c9a35a', { roughness: 0.3, metalness: 0.9 }), bottle: std('#1d3a2a', { roughness: 0.2, metalness: 0.3 }),
  twig: std('#3a2a1c', { roughness: 1 }), stone: std('#6d727a', { roughness: 0.95, flatShading: true }), lash: std('#8a7350', { roughness: 1 }),
  silkM: std('#7a2f6a', { roughness: 0.35 }), parkaM: std('#5b6e3a', { roughness: 1 }), flame: new THREE.MeshBasicMaterial({ color: '#ffb24a' }),
});
const GEO = {};
const geo = (k, make) => GEO[k] || (GEO[k] = make());
function part(g, geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
export function meshFor(type) {
  const M = mats(), g = new THREE.Group();
  const cylX = (k, r, len, seg = 10) => geo(k, () => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2));
  const box = (k, w, h, d) => geo(k, () => new THREE.BoxGeometry(w, h, d));
  switch (type) {
    case 'axe':
      part(g, cylX('axeH', 0.022, 0.75, 8), M.wood);
      part(g, box('axeB', 0.12, 0.05, 0.2), M.steel, 0.33, 0, 0.04);
      part(g, box('axeE', 0.1, 0.035, 0.05), M.steel, 0.33, 0, 0.16);
      break;
    case 'log':
      part(g, cylX('log', 0.13, 0.9), M.logBark);
      for (const s of [-1, 1]) part(g, geo('logEnd', () => new THREE.CircleGeometry(0.12, 10)), M.logEnd, s * 0.451, 0, 0, 0, s * Math.PI / 2);
      break;
    case 'split':
      part(g, geo('split', () => new THREE.CylinderGeometry(0.13, 0.13, 0.9, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, -0.065, 0)), M.logBark);
      part(g, box('splitIn', 0.9, 0.004, 0.255), M.splitIn, 0, -0.063, 0);
      break;
    case 'branch':
      part(g, cylX('branch', 0.03, 1.1, 6), M.twig);
      part(g, geo('twig', () => new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5).rotateZ(Math.PI / 2)), M.twig, 0.2, 0, 0.1, 0, 0.6, 0);
      part(g, geo('twig', () => new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5).rotateZ(Math.PI / 2)), M.twig, -0.25, 0, -0.08, 0, -0.5, 0);
      break;
    case 'saxe':      // a straight branch with a sharp stone lashed to the end (along x like the axe, the head at +x)
      part(g, cylX('saxeH', 0.024, 0.66, 6), M.twig);
      part(g, geo('saxeS', () => new THREE.DodecahedronGeometry(0.075, 0).scale(1, 0.55, 1.5)), M.stone, 0.29, 0, 0.05);
      part(g, geo('saxeL', () => new THREE.CylinderGeometry(0.032, 0.032, 0.07, 8).rotateZ(Math.PI / 2)), M.lash, 0.28, 0, 0);
      break;
    case 'stone': part(g, geo('stone', () => new THREE.DodecahedronGeometry(0.08, 0).scale(1.2, 0.75, 1)), M.stone); break;
    case 'shells':    // a fat red cartridge with a brass base
      part(g, cylX('shellB', 0.022, 0.09, 10), M.red, 0.01, 0, 0);
      part(g, cylX('shellR', 0.025, 0.02, 10), M.gold, -0.045, 0, 0);
      break;
    case 'journal':   // a small swollen notebook with a strap
      part(g, box('jrnB', 0.17, 0.035, 0.23), M.cork);
      part(g, box('jrnP', 0.162, 0.03, 0.224), M.white, 0.006, 0, 0);
      part(g, box('jrnS', 0.02, 0.037, 0.232), M.dark, -0.05, 0, 0);
      break;
    case 'blackbox':  // orange, with a white stripe and the round beacon at one end
      part(g, box('bbB', 0.34, 0.16, 0.2), M.orange, 0, 0.01, 0);
      part(g, box('bbS', 0.345, 0.03, 0.205), M.white, 0, 0.05, 0);
      part(g, cylX('bbC', 0.07, 0.12, 12), M.orange, 0.16, -0.02, 0);
      break;
    case 'silk': part(g, box('silk', 0.32, 0.024, 0.22), M.silkM); part(g, box('silk2', 0.3, 0.006, 0.05), M.gold, 0, 0.014, 0.07); break;
    case 'caviar': part(g, geo('cavT', () => new THREE.CylinderGeometry(0.06, 0.06, 0.035, 14)), M.gold); part(g, geo('cavL', () => new THREE.CylinderGeometry(0.045, 0.045, 0.037, 14)), M.dark); break;
    case 'beans': part(g, geo('beanC', () => new THREE.CylinderGeometry(0.04, 0.04, 0.11, 12)), M.steel); part(g, geo('beanL', () => new THREE.CylinderGeometry(0.0405, 0.0405, 0.07, 12)), M.snackM); break;
    case 'torch':     // a branch with a scarf wrapped round its end (along x like the axe, the head at +x), and its flame
      part(g, cylX('torchS', 0.022, 0.6, 6), M.twig, -0.05, 0, 0);
      part(g, cylX('torchH', 0.045, 0.14, 8), M.silkM, 0.24, 0, 0);
      part(g, geo('torchF', () => new THREE.ConeGeometry(0.05, 0.16, 7).rotateZ(-Math.PI / 2)), M.flame, 0.37, 0, 0);
      break;
    case 'snowshoes':
      for (const s of [-1, 1]) {
        part(g, geo('shoeF', () => new THREE.TorusGeometry(0.16, 0.012, 5, 16).rotateX(Math.PI / 2).scale(1.8, 1, 1)), M.twig, 0, 0, s * 0.1);
        part(g, box('shoeL', 0.5, 0.006, 0.02), M.lash, 0, 0, s * 0.1); part(g, box('shoeL2', 0.02, 0.006, 0.22), M.lash, 0.04, 0, s * 0.1);
      }
      break;
    case 'shovel': case 'wshovel': {   // a short shaft (along x, the blade at +x)
      const al = type === 'shovel';
      part(g, cylX('shovS', 0.018, 0.75, 6), al ? M.dark : M.twig, -0.1, 0, 0);
      part(g, box('shovB' + type, 0.28, 0.02, 0.24), al ? M.steel : M.board, 0.38, 0, 0);
      part(g, box('shovG', 0.04, 0.03, 0.12), M.dark, -0.47, 0, 0);
      break;
    }
    case 'rope': part(g, geo('ropeC', () => new THREE.TorusGeometry(0.12, 0.03, 6, 16).rotateX(Math.PI / 2)), M.lash); part(g, geo('ropeC2', () => new THREE.TorusGeometry(0.09, 0.025, 6, 14).rotateX(Math.PI / 2)), M.lash, 0, 0.03, 0); break;
    case 'pottea':
      part(g, geo('potB', () => new THREE.CylinderGeometry(0.14, 0.12, 0.17, 16, 1, true)), M.potM);
      part(g, geo('potF', () => new THREE.CircleGeometry(0.12, 16).rotateX(-Math.PI / 2)), M.potM, 0, -0.084, 0);
      part(g, geo('teaT', () => new THREE.CircleGeometry(0.135, 16).rotateX(-Math.PI / 2)), M.cooked, 0, 0.04, 0);
      break;
    case 'plan': part(g, box('planB', 0.22, 0.008, 0.16), M.white); part(g, box('planL', 0.16, 0.009, 0.01), M.dark, 0, 0, 0.02); break;
    case 'cache':     // an old wooden crate, frozen shut, snow on its lid
      part(g, box('cacheB', 0.7, 0.5, 0.5), M.cork);
      part(g, box('cacheS', 0.72, 0.06, 0.52), M.snowTop, 0, 0.27, 0);
      for (const x of [-0.25, 0.25]) part(g, box('cacheR', 0.04, 0.52, 0.52), M.dark, x, 0, 0);
      break;
    case 'flotsam':   // a battered suitcase tangled in a strip of the plane's skin
      part(g, box('flotB', 0.66, 0.24, 0.46), M.snackM);
      part(g, box('flotP', 0.9, 0.02, 0.3), M.sheet, 0.1, 0.13, 0.08, 0, 0.5, 0.15);
      break;
    case 'journal2':  // a small black notebook, its pages warped
      part(g, box('jr2B', 0.14, 0.025, 0.2), M.dark);
      part(g, box('jr2P', 0.132, 0.02, 0.194), M.white, 0.005, 0, 0);
      break;
    case 'battery':   // a heavy black block wrapped in oilcloth, two terminals
      part(g, box('batB', 0.16, 0.1, 0.12), M.dark);
      part(g, box('batC', 0.17, 0.06, 0.125), M.cork, 0, -0.01, 0);
      for (const s of [-1, 1]) part(g, geo('batT', () => new THREE.CylinderGeometry(0.01, 0.01, 0.02, 6)), s < 0 ? M.red : M.steel, s * 0.045, 0.06, 0);
      break;
    case 'picks':     // two short wooden grips with a sharp stone point each, tied together by a cord
      for (const s of [-1, 1]) {
        part(g, cylX('pickH', 0.022, 0.22, 6), M.twig, 0, 0, s * 0.05);
        part(g, geo('pickP', () => new THREE.ConeGeometry(0.02, 0.07, 5).rotateZ(-Math.PI / 2)), M.stone, 0.14, 0, s * 0.05);
      }
      part(g, geo('pickC', () => new THREE.CylinderGeometry(0.004, 0.004, 0.1, 4).rotateX(Math.PI / 2)), M.lash, -0.11, 0, 0);
      break;
    case 'rod':       // a short ice-fishing rod: the grip and reel at -x, the tip at +x
      part(g, geo('rodS', () => new THREE.CylinderGeometry(0.006, 0.014, 0.9, 6).rotateZ(-Math.PI / 2)), M.dark, 0.2, 0, 0);
      part(g, cylX('rodG', 0.02, 0.28, 8), M.cork, -0.36, 0, 0);
      part(g, geo('rodR', () => new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12)), M.steel, -0.3, -0.04, 0);
      break;
    case 'pot': case 'potsnow': case 'potwater': {
      part(g, geo('potB', () => new THREE.CylinderGeometry(0.14, 0.12, 0.17, 16, 1, true)), M.potM);
      part(g, geo('potF', () => new THREE.CircleGeometry(0.12, 16).rotateX(-Math.PI / 2)), M.potM, 0, -0.084, 0);
      part(g, geo('potH', () => new THREE.TorusGeometry(0.13, 0.008, 6, 16, Math.PI)), M.dark, 0, 0.05, 0, 0, 0, 0);
      if (type !== 'pot') part(g, geo('potT', () => new THREE.CircleGeometry(0.135, 16).rotateX(-Math.PI / 2)), type === 'potsnow' ? M.snowTop : M.water, 0, type === 'potsnow' ? 0.07 : 0.04, 0);
      break;
    }
    case 'fish': case 'bigfish': case 'fishc': case 'bigfishc': {
      const big = type.startsWith('big'), m = type.endsWith('c') ? M.cooked : big ? M.fishDark : M.fishM;
      const s = big ? 1.6 : 1;
      part(g, geo('fishB', () => new THREE.SphereGeometry(0.1, 12, 8).scale(1.8, 0.45, 0.6)), m).scale.setScalar(s);
      part(g, geo('fishT', () => new THREE.ConeGeometry(0.06, 0.1, 3).rotateZ(Math.PI / 2).scale(1, 1, 0.3)), m, -0.21 * s, 0, 0).scale.setScalar(s);
      break;
    }
    case 'snack': part(g, box('snack', 0.16, 0.05, 0.11), M.snackM); part(g, box('snackL', 0.1, 0.052, 0.06), M.gold, 0.02, 0.001, 0); break;
    case 'champ':
      part(g, cylX('champB', 0.045, 0.22, 12), M.bottle);
      part(g, geo('champN', () => new THREE.CylinderGeometry(0.016, 0.04, 0.1, 10).rotateZ(-Math.PI / 2)), M.bottle, 0.16, 0, 0);
      part(g, cylX('champC', 0.018, 0.04, 8), M.gold, 0.22, 0, 0);
      break;
    case 'board': part(g, box('board', 1.2, 0.03, 0.18), M.board); break;
    case 'sheet': part(g, box('sheet', 0.8, 0.02, 0.55), M.sheet); break;
    case 'pipe': part(g, cylX('pipe', 0.075, 1.1, 12), M.pipe); break;
    case 'fur': case 'wool': case 'parka': {
      const m = type === 'fur' ? M.fur : type === 'parka' ? M.parkaM : M.wool;
      part(g, box('coatA', 0.62, 0.07, 0.48), m); part(g, box('coatB', 0.5, 0.06, 0.12), m, 0, 0.055, -0.2);
      break;
    }
    case 'kit':
      part(g, box('kit', 0.32, 0.1, 0.24), M.white);
      part(g, box('kitX1', 0.06, 0.012, 0.16), M.red, 0, 0.055, 0); part(g, box('kitX2', 0.16, 0.012, 0.06), M.red, 0, 0.056, 0);
      break;
    case 'flare':     // an orange flare pistol lying on its side: a fat short barrel along x, the grip towards -z
      part(g, geo('flareB', () => new THREE.CylinderGeometry(0.034, 0.034, 0.17, 14).rotateZ(Math.PI / 2)), M.orange, 0.06, 0, 0);
      part(g, geo('flareM', () => new THREE.CircleGeometry(0.026, 14)), M.dark, 0.146, 0, 0, 0, Math.PI / 2, 0);
      part(g, box('flareF', 0.11, 0.05, 0.06), M.orange, -0.05, 0, -0.005);
      part(g, box('flareG', 0.05, 0.045, 0.12), M.orange, -0.07, 0, -0.085, 0, 0.3, 0);
      part(g, box('flareT', 0.035, 0.012, 0.045), M.dark, -0.02, 0, -0.05);
      part(g, box('flareH', 0.02, 0.03, 0.025), M.dark, -0.1, 0, 0.02);
      break;
  }
  return g;
}
// the colliders of a lying item (a dropped one is a physics object until it lies still)
const QX = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
function colliders(R, type, data) {
  const C = R.ColliderDesc, cx = (r, hl) => C.cylinder(hl, r).setRotation(QX);
  switch (type) {
    case 'axe': return [C.cuboid(0.38, 0.03, 0.1).setDensity(400)];
    case 'saxe': return [C.cuboid(0.34, 0.04, 0.08).setDensity(400)];
    case 'stone': return [C.ball(0.07).setDensity(2500)];
    case 'rod': return [cx(0.02, 0.55).setDensity(400)];
    case 'pot': case 'potsnow': case 'potwater': return [C.cylinder(0.085, 0.13).setDensity(600)];
    case 'champ': return [cx(0.045, 0.15).setDensity(900)];
    case 'fish': case 'fishc': return [C.cuboid(0.18, 0.04, 0.06).setDensity(800)];
    case 'bigfish': case 'bigfishc': return [C.cuboid(0.3, 0.06, 0.1).setDensity(800)];
    case 'snack': return [C.cuboid(0.08, 0.025, 0.055).setDensity(300)];
    case 'log': return [cx(0.13, 0.45).setDensity(520)];
    case 'split': return [C.cuboid(0.45, 0.065, 0.13).setDensity(520)];
    case 'branch': return [cx(0.035, 0.55).setDensity(500)];
    case 'board': return [C.cuboid(0.6, 0.015, 0.09).setDensity(500)];
    case 'sheet': return [C.cuboid(0.4, 0.01, 0.275).setDensity(1500)];
    case 'pipe': return [cx(0.075, 0.55).setDensity(400)];
    case 'trunk': { const s = data.s || 1, sy = data.sy || 1; return [C.cylinder(2.3 * s * sy, 0.2 * s).setTranslation(0, 2.3 * s * sy, 0).setDensity(450), C.ball(1.0 * s).setTranslation(0, 2.8 * s * sy, 0).setDensity(60)]; }
    default: { const t = TYPES[type]; return [C.cuboid(0.25, t.h || 0.05, 0.2).setDensity(200)]; }
  }
}

// ---------- the stash: everything lying in the world ----------
export class Stash {
  // make: { trunk(data) -> Object3D } for the kinds the world draws itself
  constructor(R, phys, scene, guest, make = {}) {
    Object.assign(this, { R, phys, scene, guest, make });
    this.list = new Map(); this.next = 1; this.byCol = new Map();
    this.rev = 0;            // goes up whenever something appears, goes away or comes to rest: the host sends the list when it has
  }
  // a saved game (the host or solo): throw away what lies here and lay out what the save says
  load(list, next) {
    for (const id of [...this.list.keys()]) this.remove(id);
    for (const a of list) {
      const [id, ti, n, x, y, z, qx, qy, qz, qw, buried, dry, hp, s, sy] = a, type = TYPE_LIST[ti];
      if (!type) continue;
      const data = { dry }; if (hp >= 0) data.hp = hp; if (s) { data.s = s; data.sy = sy; }
      this.spawn({ id, type, n, data, p: [x, y, z], q: [qx, qy, qz, qw], rest: type !== 'trunk', buried });      // a felled tree is solid again
    }
    this.next = Math.max(this.next, next || 1);
  }
  get(id) { return this.list.get(id); }
  // o: { id?, type, n?, data?, p: [x, y, z], q?: [x, y, z, w], v?: [vx, vy, vz], w?: [wx, wy, wz], rest?, buried? }
  spawn(o) {
    const id = o.id ?? this.next;
    this.next = Math.max(this.next, id + 1);
    if (this.list.has(id)) return this.list.get(id);
    const data = { ...(o.data || {}) };
    const mesh = this.make[o.type] ? this.make[o.type](data) : meshFor(o.type);
    mesh.position.fromArray(o.p); if (o.q) mesh.quaternion.fromArray(o.q);
    this.scene.add(mesh);
    const it = { id, type: o.type, n: o.n || 1, data, mesh, body: null, rest: !!o.rest, buried: o.buried || 0, base: mesh.position.y, sleepT: 0, to: null, hidden: false, hideAt: 0 };
    this.list.set(id, it); this.rev++;
    if (!it.rest && !this.guest) this.physical(it, o.v, o.w);
    return it;
  }
  physical(it, v, w) {
    const R = this.R, m = it.mesh;
    m.position.y = it.base;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(m.position.x, m.position.y, m.position.z)
      .setRotation({ x: m.quaternion.x, y: m.quaternion.y, z: m.quaternion.z, w: m.quaternion.w }).setLinearDamping(0.25).setAngularDamping(0.6).setCcdEnabled(true);
    const body = this.phys.createRigidBody(bd);
    for (const d of colliders(R, it.type, it.data)) { const c = this.phys.createCollider(d.setFriction(0.7).setRestitution(0.05), body); this.byCol.set(c.handle, it.id); }
    if (v) body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    if (w) body.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
    it.body = body; it.rest = false; it.sleepT = 0; it.buried = 0;
    if (it.frost) { this.scene.remove(it.frost); it.frost = null; }
  }
  // it lies still: no more physics
  settle(it) {
    if (!it.body) return;
    for (let i = 0; i < it.body.numColliders(); i++) this.byCol.delete(it.body.collider(i).handle);
    this.phys.removeRigidBody(it.body);
    it.body = null; it.rest = true; it.base = it.mesh.position.y; this.rev++;
  }
  remove(id) {
    const it = this.list.get(id);
    if (!it) return null;
    if (it.body) { for (let i = 0; i < it.body.numColliders(); i++) this.byCol.delete(it.body.collider(i).handle); this.phys.removeRigidBody(it.body); it.body = null; }
    this.scene.remove(it.mesh);
    if (it.frost) { this.scene.remove(it.frost); it.frost = null; }          // (step 7e: the frost on it, fx.js)
    this.list.delete(id); this.rev++;
    return it;
  }
  update(dt, wld, env) {
    const k = 1 - Math.exp(-14 * dt);
    for (const it of this.list.values()) {
      const m = it.mesh;
      if (it.body) {
        const tr = it.body.translation(), ro = it.body.rotation();
        m.position.set(tr.x, tr.y, tr.z); m.quaternion.set(ro.x, ro.y, ro.z, ro.w);
        const top = Math.max(wld.groundY(tr.x, tr.z), SEA);
        if (tr.y < top - 1.5) { it.body.setTranslation({ x: tr.x, y: top + 0.6, z: tr.z }, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        if (it.type !== 'trunk') {
          if (it.body.isSleeping() || (it.body.linvel().y ** 2 + it.body.linvel().x ** 2 + it.body.linvel().z ** 2) < 0.0004) it.sleepT += dt; else it.sleepT = 0;
          if (it.sleepT > 1.2) this.settle(it);
        }
      } else if (this.guest) {
        // we asked the host for it and hid it; if the host didn't give it to us, it shows again
        if (it.hidden && performance.now() - it.hideAt > 2500) { it.hidden = false; it.mesh.visible = true; }
        if (it.to) {
          m.position.x += (it.to[0] - m.position.x) * k; m.position.y += (it.to[1] - m.position.y) * k; m.position.z += (it.to[2] - m.position.z) * k;
          m.quaternion.slerp(_q.set(it.to[3], it.to[4], it.to[5], it.to[6]), k);
        }
      } else if (it.rest && it.type !== 'trunk') {
        // the snow slowly covers things left outside (a day and a bit, three times faster in a storm)
        const p = m.position, g = wld.groundY(p.x, p.z);
        if (g > SEA + 0.2 && p.y - g < 0.5 && !wld.inShack(p) && !wld.inCabin(p)) it.buried = Math.min(1, it.buried + dt / (DAY * 1.2) * (1 + 3 * env.storm));
        p.y = it.base - it.buried * (0.04 + (TYPES[it.type].h || 0.05) * 1.6);
      }
    }
  }
  // for co-op: everything (a few times a second), and what is moving (often)
  snap() {
    const r3 = v => Math.round(v * 1000) / 1000, out = [];
    for (const it of this.list.values()) {
      const p = it.mesh.position, q = it.mesh.quaternion;
      out.push([it.id, TYPE_LIST.indexOf(it.type), it.n, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), Math.round(it.buried * 100) / 100, Math.round((it.data.dry ?? 1) * 100) / 100, it.data.hp ?? -1, it.data.s ?? 0, it.data.sy ?? 0]);
    }
    return out;
  }
  moving() {
    const r3 = v => Math.round(v * 1000) / 1000, out = [];
    for (const it of this.list.values()) if (it.body && !it.body.isSleeping()) { const p = it.mesh.position, q = it.mesh.quaternion; out.push([it.id, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]); }
    return out;
  }
  // a guest: make our stash what the host says it is
  applySnap(list) {
    const seen = new Set();
    for (const a of list) {
      const [id, ti, n, x, y, z, qx, qy, qz, qw, buried, dry, hp, s, sy] = a;
      seen.add(id);
      let it = this.list.get(id);
      if (!it) {
        const data = { dry }; if (hp >= 0) data.hp = hp; if (s) { data.s = s; data.sy = sy; }
        it = this.spawn({ id, type: TYPE_LIST[ti], n, data, p: [x, y, z], q: [qx, qy, qz, qw], rest: true, buried });
      }
      it.n = n; it.buried = buried; it.data.dry = dry; if (hp >= 0) it.data.hp = hp;
      it.to = [x, y, z, qx, qy, qz, qw];
    }
    for (const id of [...this.list.keys()]) if (!seen.has(id)) this.remove(id);
  }
  applyMoving(list) { for (const a of list) { const it = this.list.get(a[0]); if (it) it.to = a.slice(1); } }
}
const _q = new THREE.Quaternion();

// ---------- what you carry ----------
export const HOT = 5, BAG = 10;
export class Inventory {
  constructor() { this.slots = new Array(HOT + BAG).fill(null); this.sel = 0; this.coat = null; this.ver = 0; }
  held() { return this.slots[this.sel]; }
  heldType() { return this.slots[this.sel]?.type || null; }
  // is there room for it?
  room(type, n = 1) {
    if (TYPES[type].wear && !this.coat) return true;
    const st = TYPES[type].stack || 1;
    let left = n;
    for (const s of this.slots) { if (!s) left -= st; else if (s.type === type) left -= st - s.n; if (left <= 0) return true; }
    return false;
  }
  // put it away; returns how many didn't fit
  add(type, n = 1, data = {}) {
    if (TYPES[type].wear && !this.coat) { this.coat = type; this.ver++; return n - 1; }
    const st = TYPES[type].stack || 1, dry = data.dry ?? 1;
    let left = n;
    for (const s of this.slots) {
      if (!left) break;
      if (s && s.type === type && s.n < st) { const k = Math.min(st - s.n, left); s.dry = (s.dry * s.n + dry * k) / (s.n + k); s.n += k; left -= k; }
    }
    const order = [this.sel, ...this.slots.keys()].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of order) {
      if (!left) break;
      if (!this.slots[i]) { const k = Math.min(st, left); this.slots[i] = { type, n: k, dry }; left -= k; }
    }
    this.ver++;
    return left;
  }
  // take n out of a slot: { type, n, data }
  take(i = this.sel, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.n);
    s.n -= k; if (s.n <= 0) this.slots[i] = null;
    this.ver++;
    return { type: s.type, n: k, data: { dry: s.dry ?? 1 } };
  }
  count(pred) { let c = 0; for (const s of this.slots) if (s && pred(s.type)) c += s.n; return c; }
  // use up n things that match, the held slot first
  use(pred, n) {
    if (this.count(pred) < n) return false;
    const order = [this.sel, ...this.slots.keys()];
    for (const i of order) { const s = this.slots[i]; while (n > 0 && s && s.n > 0 && pred(s.type)) { s.n--; n--; } if (s && s.n <= 0) this.slots[i] = null; if (!n) break; }
    this.ver++;
    return true;
  }
  swap(a, b) {
    const A = this.slots[a], B = this.slots[b];
    if (A && B && A.type === B.type && B.n < (TYPES[B.type].stack || 1)) {        // stack them
      const k = Math.min((TYPES[B.type].stack || 1) - B.n, A.n); B.dry = (B.dry * B.n + A.dry * k) / (B.n + k); B.n += k; A.n -= k; if (!A.n) this.slots[a] = null;
    } else { this.slots[a] = B; this.slots[b] = A; }
    this.ver++;
  }
  // wear the coat in slot i (the old one goes there)
  wear(i) {
    const s = this.slots[i];
    if (!s || !TYPES[s.type].wear) return;
    this.slots[i] = this.coat ? { type: this.coat, n: 1, dry: 1 } : null;
    this.coat = s.type; this.ver++;
  }
  undress() {
    const i = this.slots.findIndex(s => !s);
    return i >= 0 && this.undressTo(i);
  }
  // take the coat off into slot i: an empty slot, or swap with the coat lying there
  undressTo(i) {
    if (!this.coat) return false;
    const s = this.slots[i];
    if (s && !TYPES[s.type].wear) return false;
    this.slots[i] = { type: this.coat, n: 1, dry: 1 };
    this.coat = s ? s.type : null; this.ver++;
    return true;
  }
}
