// Levels, Ferryman Tokens (FT), unlocks and the per-mode kit (ship, cannons, upgrades, loadout, attachments, skill).
// FFA and the campaign each have their own level, FT and unlocks. The sandbox owns everything for free.
import { P, saveProfile, newKit } from './state.js';
import { WEAPONS, ATTACH } from './weapons.js';
import { SHIP_TYPES } from './ship.js';

export const SKILLS = {
  carpenter: { name: 'Carpenter', desc: 'Planks fix 100 %, furniture patches twice as much.' },
  lungs: { name: 'Iron lungs', desc: 'Hold your breath twice as long.' },
  strong: { name: 'Strong arms', desc: 'Buckets hold twice the water. Heavy items do not slow you down.' },
  sealegs: { name: 'Sea legs', desc: 'Swim and climb 40 % faster.' },
  repel: { name: 'Shark repellent', desc: 'Shot sharks stay away three times longer.' },
  gunner: { name: 'Master gunner', desc: 'Cannons reload 35 % faster.' },
};

// [level, id, price in FT]
export const UNLOCKS = [
  [1, 'pistol', 0], [1, 'smg', 0], [1, 'grenade', 0], [1, 'tug', 0], [1, 'carpenter', 0],
  [2, 'reddot', 120], [2, 'lungs', 150],
  [3, 'ak', 300], [3, 'extmag', 140],
  [4, 'suppressor', 180], [4, 'revolver', 220],
  [5, 'trawler', 900], [3, 'yacht', 500], [8, 'ferry', 1600], [16, 'cruise', 4000], [5, 'shotgun', 350],
  [6, 'grip', 160], [6, 'strong', 250],
  [7, 'comp', 160], [7, 'c4', 300],
  [8, 'sealegs', 300], [8, 'lmg', 500],
  [9, 'sniper', 550], [9, 'scope4', 260],
  [10, 'gunner', 400],
  [12, 'cargo', 2600],
  [14, 'repel', 450],
];
export const MAX_LEVEL = 20;
export const UPGRADES = {
  armor: { name: 'Hull plating', desc: '+1 toughness on every hull block per level.', price: [300, 650, 1100] },
  pump: { name: 'Bilge pump', desc: 'Pumps water out by itself (0.6 / 1.2 / 2 m³/s).', price: [250, 550, 950] },
  engine: { name: 'Better rigging', desc: '+8 % speed per level.', price: [200, 450, 800] },
};
export const PUMP_RATE = [0, 0.6, 1.2, 2];
export const gunPrice = n => 150 + 150 * n;

export function kindOf(id) {
  if (WEAPONS[id]) return 'weapon';
  if (ATTACH[id]) return 'attachment';
  if (SHIP_TYPES[id]) return 'ship';
  if (SKILLS[id]) return 'skill';
  return '?';
}
export function nameOf(id) { return WEAPONS[id]?.name || ATTACH[id]?.name || SHIP_TYPES[id]?.name || SKILLS[id]?.name || id; }
export const unlockOf = id => UNLOCKS.find(u => u[1] === id) || [99, id, 0];

export const xpForLevel = l => 100 + (l - 1) * 60;   // xp needed to go from level l to l+1
export function levelInfo(xp) {
  let l = 1, rest = xp;
  while (l < MAX_LEVEL && rest >= xpForLevel(l)) { rest -= xpForLevel(l); l++; }
  return { level: l, into: rest, need: l >= MAX_LEVEL ? 1 : xpForLevel(l) };
}

export const prog = mode => P.prog[mode];
export function level(mode) { return mode === 'sandbox' ? MAX_LEVEL : levelInfo(prog(mode).xp).level; }
export function owns(mode, id) { return mode === 'sandbox' || prog(mode).owned.includes(id); }
export function unlocked(mode, id) { return level(mode) >= unlockOf(id)[0]; }
export function ft(mode) { return mode === 'sandbox' ? Infinity : prog(mode).ft; }

export function buy(mode, id) {
  if (owns(mode, id)) return 'owned';
  if (!unlocked(mode, id)) return 'locked';
  const p = prog(mode), price = unlockOf(id)[2];
  if (p.ft < price) return 'poor';
  p.ft -= price; p.owned.push(id);
  if (SHIP_TYPES[id] && !p.kit.ships[id]) p.kit.ships[id] = { guns: 0, armor: 0, pump: 0, engine: 0 };
  saveProfile();
  return 'ok';
}

export function kit(mode) {
  const k = mode === 'sandbox' ? P.sandbox : prog(mode).kit;
  if (!k.ships) k.ships = {};
  if (!k.att) k.att = {};
  if (!k.ships[k.ship]) k.ships[k.ship] = { guns: 0, armor: 0, pump: 0, engine: 0 };
  return k;
}
export function shipCfg(mode, key) {
  const k = kit(mode);
  if (!k.ships[key]) k.ships[key] = { guns: 0, armor: 0, pump: 0, engine: 0 };
  return k.ships[key];
}
// cannons and upgrades
export function upgradePrice(mode, key, what) {
  const c = shipCfg(mode, key);
  if (what === 'guns') return c.guns >= SHIP_TYPES[key].maxGuns ? null : gunPrice(c.guns);
  const lv = c[what];
  return lv >= 3 ? null : UPGRADES[what].price[lv];
}
export function buyUpgrade(mode, key, what) {
  const price = upgradePrice(mode, key, what);
  if (price == null) return 'max';
  if (mode !== 'sandbox') {
    const p = prog(mode);
    if (p.ft < price) return 'poor';
    p.ft -= price;
  }
  shipCfg(mode, key)[what]++;
  saveProfile();
  return 'ok';
}
export function sellBack(mode, key, what) {   // sandbox only: lower an upgrade again
  const c = shipCfg(mode, key);
  if (mode !== 'sandbox') return;
  if (what === 'guns') c.guns = Math.max(0, c.guns - 1); else c[what] = Math.max(0, c[what] - 1);
  saveProfile();
}

// after a round: add xp + FT, report level-ups and new unlocks
export function award(mode, xp, ftGain) {
  if (mode === 'sandbox') return { levels: [], unlocks: [] };
  const p = prog(mode), before = levelInfo(p.xp).level;
  p.xp += xp; p.ft += ftGain;
  const after = levelInfo(p.xp).level;
  const levels = [], unlocks = [];
  for (let l = before + 1; l <= after; l++) { levels.push(l); for (const u of UNLOCKS) if (u[0] === l) unlocks.push(nameOf(u[1])); }
  saveProfile();
  return { levels, unlocks };
}

export function resetMode(mode) { if (mode !== 'sandbox') { P.prog[mode] = { xp: 0, ft: 250, owned: ['pistol', 'smg', 'grenade', 'tug', 'carpenter'], kit: newKit() }; saveProfile(); } }
