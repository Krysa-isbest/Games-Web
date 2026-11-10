// Levels, Ferryman Tokens (FT), unlocks and the per-mode kit (ship, cannons, upgrades, loadout, attachments, skill).
// FFA and the campaign each have their own level, FT and unlocks. The sandbox owns everything for free.
import { P, saveProfile, newKit } from './state.js';
import { WEAPONS, ATTACH } from './weapons.js';
import { SHIP_TYPES, ARMOR_PER_LVL, PUMP_RATES, ENGINE_LVL } from './ship.js';
import { CANNONS } from './cannons.js';

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
  // deck gun types
  [1, 'deckgun', 0], [4, 'autocannon', 450], [6, 'mortar', 600], [9, 'rockets', 800], [11, 'torpedo', 1000],
  // warships
  [10, 'patrol', 2400], [13, 'corvette', 3800], [16, 'frigate', 5600], [19, 'destroyer', 8000],
];
export const MAX_LEVEL = 20;
// every level makes a difference you can feel; `fx(lv)` is the effect at that level, shown in the Garage
export const UPGRADES = {
  armor: { name: 'Hull plating', desc: 'Every hull block takes more hits before it breaks, so shells punch smaller holes.', price: [300, 650, 1100], fx: lv => lv ? `+${Math.round(lv * ARMOR_PER_LVL * 100)} % hull toughness` : 'standard hull' },
  pump: { name: 'Bilge pump', desc: 'Pumps the water out of the hold by itself, all the time.', price: [250, 550, 950], fx: lv => lv ? `pumps ${PUMP_RATES[lv]} m³/s` : 'no pump' },
  engine: { name: 'Engine tuning', desc: 'More top speed, faster acceleration and tighter turns.', price: [200, 450, 800], fx: lv => lv ? `+${Math.round(lv * ENGINE_LVL.speed * 100)} % speed · +${Math.round(lv * ENGINE_LVL.acc * 100)} % acceleration · +${Math.round(lv * ENGINE_LVL.turn * 100)} % turning` : 'stock engine' },
};
export const gunPrice = n => 150 + 150 * n;

// ---------- crew you hire (per mode). Each has a rank 1..3 (train them for FT); your ship has def.crew berths ----------
// fx(rank) = what they do at that rank (shown in the Garage); the game reads the numbers from CREW_FX
export const CREW_FX = {
  marine: { dmg: [0, 8, 11, 15], acc: [0, 1, 1.25, 1.5] },
  gunner: { err: [0, 1.4, 1.0, 0.6], reload: [0, 1, 0.9, 0.8] },
  carpenter: { every: [0, 1.0, 0.7, 0.45] },
  bailer: { rate: [0, 0.6, 1.0, 1.5] },
  helmsman: { gain: [0, 0.8, 1.1, 1.4] },
};
export const CREW_ROLES = {
  marine: { name: 'Marine', icon: '🎯', level: 2, price: 300, desc: 'Stands on deck and shoots enemy sailors, boarders and sharks.', fx: r => `${CREW_FX.marine.dmg[r]} damage a shot · aim ×${CREW_FX.marine.acc[r]}` },
  gunner: { name: 'Gunner', icon: '💥', level: 4, price: 400, desc: 'Mans the gun pair (or turret) you post him to, and fires at enemy ships. He moves to the side that faces the enemy.', fx: r => `aim ${['', 'rough', 'good', 'sharp'][r]} · reload ×${CREW_FX.gunner.reload[r]}` },
  carpenter: { name: 'Carpenter', icon: '🔨', level: 5, price: 450, desc: 'Works in the hold and puts broken hull blocks back, the ones under water first. Free, no planks needed.', fx: r => `1 block every ${CREW_FX.carpenter.every[r]} s` },
  bailer: { name: 'Bilge hand', icon: '🪣', level: 3, price: 350, desc: 'Bails water out of the fullest compartment all the time.', fx: r => `${CREW_FX.bailer.rate[r]} m³/s` },
  helmsman: { name: 'Helmsman', icon: '🧭', level: 7, price: 500, desc: 'When nobody is at the helm, he steers: turns your broadside to the nearest enemy and keeps off the rocks.', fx: r => `${['', 'steady', 'skilled', 'expert'][r]} hand on the wheel` },
};
export const TRAIN_PRICE = [0, 0, 300, 700];      // to reach rank 2 / 3
const CREW_NAMES = ['Abe', 'Bo', 'Cass', 'Dex', 'Edda', 'Finn', 'Gus', 'Hana', 'Ivo', 'Jules', 'Kip', 'Lou', 'Mags', 'Nell', 'Ozzy', 'Pip', 'Quinn', 'Rory', 'Sven', 'Tilda', 'Ugo', 'Vera', 'Wes', 'Yuri', 'Zed'];
export function crewOf(mode) { const k = kit(mode); if (!Array.isArray(k.crew)) k.crew = []; return k.crew; }
export const berths = key => SHIP_TYPES[key]?.crew || 2;
export function hireCrew(mode, role) {
  const R = CREW_ROLES[role];
  if (!R) return 'no';
  if (mode !== 'sandbox' && level(mode) < R.level) return 'locked';
  const list = crewOf(mode);
  if (list.length >= 8) return 'full';
  if (mode !== 'sandbox') { const p = prog(mode); if (p.ft < R.price) return 'poor'; p.ft -= R.price; }
  const used = new Set(list.map(c => c.name));
  const name = CREW_NAMES.find(n => !used.has(n) && Math.random() < 0.5) || CREW_NAMES.find(n => !used.has(n)) || 'Sailor';
  list.push({ id: Date.now().toString(36) + Math.floor(Math.random() * 1e4), role, rank: 1, name, post: role === 'gunner' ? 0 : null });
  saveProfile();
  return 'ok';
}
export function trainCrew(mode, id) {
  const c = crewOf(mode).find(x => x.id === id);
  if (!c || c.rank >= 3) return 'max';
  const price = TRAIN_PRICE[c.rank + 1];
  if (mode !== 'sandbox') { const p = prog(mode); if (p.ft < price) return 'poor'; p.ft -= price; }
  c.rank++; saveProfile();
  return 'ok';
}
export function dismissCrew(mode, id) { const k = kit(mode); k.crew = crewOf(mode).filter(x => x.id !== id); saveProfile(); }
export function moveCrew(mode, id, dir) {
  const list = crewOf(mode), i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]]; saveProfile();
}
export function setCrewPost(mode, id, post) { const c = crewOf(mode).find(x => x.id === id); if (c) { c.post = post; saveProfile(); } }

export function kindOf(id) {
  if (WEAPONS[id]) return 'weapon';
  if (ATTACH[id]) return 'attachment';
  if (SHIP_TYPES[id]) return 'ship';
  if (SKILLS[id]) return 'skill';
  if (CANNONS[id]) return 'cannon';
  return '?';
}
export function nameOf(id) { return WEAPONS[id]?.name || ATTACH[id]?.name || SHIP_TYPES[id]?.name || SKILLS[id]?.name || CANNONS[id]?.name || id; }
export const unlockOf = id => UNLOCKS.find(u => u[1] === id) || [99, id, 0];

export const xpForLevel = l => 100 + (l - 1) * 60;   // xp needed to go from level l to l+1
export function levelInfo(xp) {
  let l = 1, rest = xp;
  while (l < MAX_LEVEL && rest >= xpForLevel(l)) { rest -= xpForLevel(l); l++; }
  return { level: l, into: rest, need: l >= MAX_LEVEL ? 1 : xpForLevel(l) };
}

export const prog = mode => P.prog[mode];
export function level(mode) { return mode === 'sandbox' ? MAX_LEVEL : levelInfo(prog(mode).xp).level; }
export function owns(mode, id) { return mode === 'sandbox' || id === 'deckgun' || prog(mode).owned.includes(id); }
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
  if (!Array.isArray(k.crew)) k.crew = [];
  if (!k.ships[k.ship]) k.ships[k.ship] = { guns: 0, armor: 0, pump: 0, engine: 0 };
  return k;
}
export function shipCfg(mode, key) {
  const k = kit(mode);
  if (!k.ships[key]) k.ships[key] = { guns: 0, armor: 0, pump: 0, engine: 0 };
  if (!k.ships[key].gunTypes) k.ships[key].gunTypes = [];
  return k.ships[key];
}
// which gun type sits on gun pair n
export const gunTypeOf = (cfg, n) => CANNONS[cfg.gunTypes?.[n]] ? cfg.gunTypes[n] : 'deckgun';
export function setGunType(mode, key, n, type) {
  if (!owns(mode, type)) return false;
  const cfg = shipCfg(mode, key);
  while (cfg.gunTypes.length <= n) cfg.gunTypes.push('deckgun');
  cfg.gunTypes[n] = type;
  saveProfile();
  return true;
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
