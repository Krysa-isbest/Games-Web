// Every item in the game: what it is, how it stacks, what it weighs (kg), what the Trader pays (Scrap Credits),
// and what it does. Inventory rules live in inventory.js, weapon behaviour in weapons.js.
//
// cat: weapon | melee | ammo | heal | shieldtool | throwable | shield | material | valuable
// quick: true when it can sit in a quick-use slot (the Q wheel)
export const RARITY = {
  common:    { name: 'Common',    color: '#c9ced6' },
  uncommon:  { name: 'Uncommon',  color: '#6fd88f' },
  rare:      { name: 'Rare',      color: '#5aa9ff' },
  epic:      { name: 'Epic',      color: '#b77dff' },
  legendary: { name: 'Legendary', color: '#ffb224' },
};

export const CATEGORY = {
  weapon: 'Weapon', melee: 'Melee weapon', ammo: 'Ammo', heal: 'Healing', shieldtool: 'Shield tool',
  throwable: 'Throwable', shield: 'Shield', material: 'Crafting material', valuable: 'Valuable',
};

export const ITEMS = {
  // ---------- weapons (DESIGN 9) ----------
  scrap_pistol: {
    name: 'Scrap Pistol', cat: 'weapon', rarity: 'common', value: 120, weight: 1.2, icon: 'pistol', model: 'pistol',
    desc: 'A sidearm hammered together from salvage. One shot per pull of the trigger.',
    weapon: { mode: 'semi', damage: 22, interval: 0.3, mag: 12, reload: 1.4, ammo: 'light_ammo', spreadHip: 1.5, spreadAim: 0.35, bloom: 0.9, recoil: 0.022, range: 90, noise: 30 },
  },
  pulse_carbine: {
    name: 'Pulse Carbine', cat: 'weapon', rarity: 'uncommon', value: 420, weight: 3.4, icon: 'carbine', model: 'carbine',
    desc: 'An automatic carbine with a Prism coil. Fast, accurate when aimed, hungry for cells.',
    weapon: { mode: 'auto', damage: 18, interval: 0.12, mag: 30, reload: 2.2, ammo: 'pulse_cell', spreadHip: 2.4, spreadAim: 0.45, bloom: 0.35, recoil: 0.011, range: 130, noise: 34 },
  },
  crowbar: {
    name: 'Crowbar', cat: 'melee', rarity: 'common', value: 40, weight: 1.5, icon: 'crowbar', model: 'crowbar',
    desc: 'Opens crates. Also opens Scatters.',
    melee: { damage: 35, swing: 0.8, hitAt: 0.38, reach: 2.3 },
  },
  // ---------- ammo ----------
  light_ammo: { name: 'Light ammo', cat: 'ammo', rarity: 'common', value: 2, weight: 0.02, stack: 60, icon: 'ammo', desc: 'Rounds for the Scrap Pistol.' },
  pulse_cell: { name: 'Pulse cells', cat: 'ammo', rarity: 'common', value: 3, weight: 0.03, stack: 90, icon: 'cells', desc: 'Charge cells for the Pulse Carbine.' },
  // ---------- quick use ----------
  medkit: { name: 'Medkit', cat: 'heal', rarity: 'uncommon', value: 80, weight: 0.6, stack: 3, quick: true, icon: 'medkit', use: { time: 3, heal: 150 }, desc: 'Heals 150 health. Takes 3 s; getting hit stops it.' },
  stim: { name: 'Stim', cat: 'heal', rarity: 'common', value: 50, weight: 0.2, stack: 5, quick: true, icon: 'stim', use: { time: 1, heal: 60, stamina: 20 }, desc: 'Heals 60 health and gives 20 stamina. Takes 1 s.' },
  repair_kit: { name: 'Repair Kit', cat: 'shieldtool', rarity: 'common', value: 90, weight: 0.8, stack: 3, quick: true, icon: 'wrench', use: { time: 8, shield: ['light'] }, desc: 'Repairs a light shield to full. Takes 8 s; getting hit stops it.' },
  shield_cell: { name: 'Shield Cell', cat: 'shieldtool', rarity: 'uncommon', value: 70, weight: 0.4, stack: 5, quick: true, icon: 'cell', use: { time: 4, shield: ['medium', 'heavy'] }, desc: 'Recharges a medium or heavy shield to full. Takes 4 s; getting hit stops it.' },
  frag_grenade: { name: 'Frag Grenade', cat: 'throwable', rarity: 'common', value: 60, weight: 0.5, stack: 3, quick: true, icon: 'grenade', throw: { damage: 90, radius: 5, inner: 1.5, fuse: 4, speed: 17 }, desc: '90 damage within 5 m, 4 s after you throw it. It bounces. It hurts you too.' },
  // ---------- shields (DESIGN 7.2) ----------
  shield_light: { name: 'Light Shield', cat: 'shield', rarity: 'common', value: 150, weight: 2, icon: 'shield', shield: 'light', desc: '30% defence, 200 shield health. Repaired with a Repair Kit.' },
  shield_medium: { name: 'Medium Shield', cat: 'shield', rarity: 'uncommon', value: 350, weight: 3, icon: 'shield', shield: 'medium', desc: '40% defence, 300 shield health. Recharged with a Shield Cell.' },
  shield_heavy: { name: 'Heavy Shield', cat: 'shield', rarity: 'rare', value: 700, weight: 4.5, icon: 'shield', shield: 'heavy', desc: '50% defence, 400 shield health. Recharged with a Shield Cell.' },
  // ---------- Prism parts: crafting materials and valuables ----------
  prism_alloy:    { name: 'Prism alloy',          cat: 'material', rarity: 'common',    value: 35,   weight: 0.5, stack: 10, icon: 'alloy',   desc: 'Hard, light metal from a Prism shell. Used for crafting.' },
  prism_circuit:  { name: 'Prism circuit',        cat: 'material', rarity: 'uncommon',  value: 80,   weight: 0.2, stack: 10, icon: 'circuit', desc: 'Still warm. Used for crafting.' },
  thruster_coil:  { name: 'Thruster coil',        cat: 'material', rarity: 'uncommon',  value: 95,   weight: 0.4, stack: 5,  icon: 'coil',    desc: 'The coil that kept a flyer in the air.' },
  prism_optic:    { name: 'Prism optic',          cat: 'material', rarity: 'uncommon',  value: 110,  weight: 0.2, stack: 5,  icon: 'optic',   desc: 'A robot eye. It looks back.' },
  fink_lens:      { name: 'Fink scanner lens',    cat: 'valuable', rarity: 'rare',      value: 260,  weight: 0.3, stack: 3,  icon: 'lens',    desc: 'The lens a Fink scans you with. Collectors pay well.' },
  swatter_barrel: { name: 'Swatter barrel',       cat: 'valuable', rarity: 'rare',      value: 240,  weight: 2.5, stack: 1,  icon: 'barrel',  desc: 'A minigun barrel, still blackened.' },
  scatter_core:   { name: 'Scatter charge core',  cat: 'valuable', rarity: 'rare',      value: 190,  weight: 0.6, stack: 3,  icon: 'core',    desc: 'The charge a Scatter did not get to use. Handle gently.' },
  roach_plate:    { name: 'Roach carapace plate', cat: 'material', rarity: 'epic',      value: 320,  weight: 3,   stack: 3,  icon: 'plate',   desc: 'Armour plating off a Roach. Top-tier crafting material.' },
  roach_reactor:  { name: 'Roach Reactor',        cat: 'valuable', rarity: 'legendary', value: 2500, weight: 6,   stack: 1,  icon: 'reactor', desc: 'The heart of a Roach. The most valuable thing you can carry out of the ruins.' },
  // ---------- found in the city ----------
  scrap_metal:    { name: 'Scrap metal',          cat: 'material', rarity: 'common',    value: 12,   weight: 0.8, stack: 20, icon: 'scrap',   desc: 'Bent steel from the old city. The workshop melts it down.' },
  wires:          { name: 'Wires',                cat: 'material', rarity: 'common',    value: 18,   weight: 0.3, stack: 15, icon: 'wires',   desc: 'Copper, stripped from the walls.' },
  battery:        { name: 'Battery',              cat: 'material', rarity: 'uncommon',  value: 45,   weight: 0.5, stack: 5,  icon: 'battery', desc: 'Still holds a little charge.' },
  electronics:    { name: 'Electronics',          cat: 'material', rarity: 'uncommon',  value: 60,   weight: 0.4, stack: 10, icon: 'board',   desc: 'Circuit boards from before the Prism came.' },
  old_phone:      { name: 'Old phone',            cat: 'valuable', rarity: 'uncommon',  value: 90,   weight: 0.2, stack: 5,  icon: 'phone',   desc: 'The screen is cracked. The last message was never sent.' },
  gold_watch:     { name: 'Gold watch',           cat: 'valuable', rarity: 'rare',      value: 300,  weight: 0.1, stack: 3,  icon: 'watch',   desc: 'It stopped at 4:12.' },
  data_drive:     { name: 'Data drive',           cat: 'valuable', rarity: 'rare',      value: 380,  weight: 0.1, stack: 3,  icon: 'drive',   desc: 'Records from the year 2999. Someone will pay to read them.' },
  prism_shard:    { name: 'Prism shard',          cat: 'valuable', rarity: 'epic',      value: 650,  weight: 0.4, stack: 3,  icon: 'shard',   desc: 'A crystal from a Prism nest. It hums in your hand.' },
};
export const stackOf = id => ITEMS[id].stack || 1;

// What each robot can drop: [item, min, max, chance]
export const LOOT = {
  fink:    [['prism_alloy', 1, 2, 1], ['prism_circuit', 1, 1, 0.6], ['fink_lens', 1, 1, 0.35]],
  fly:     [['prism_alloy', 1, 2, 1], ['thruster_coil', 1, 1, 0.4], ['prism_optic', 1, 1, 0.25], ['pulse_cell', 10, 25, 0.35]],
  swatter: [['prism_alloy', 2, 3, 1], ['thruster_coil', 1, 2, 0.6], ['prism_circuit', 1, 1, 0.5], ['swatter_barrel', 1, 1, 0.4], ['light_ammo', 12, 30, 0.5]],
  scatter: [['prism_alloy', 1, 1, 0.8], ['scatter_core', 1, 1, 0.3]],
  roach:   [['roach_reactor', 1, 1, 1], ['roach_plate', 2, 3, 1], ['prism_circuit', 2, 3, 1], ['prism_optic', 1, 2, 0.8], ['shield_cell', 1, 2, 0.6]],
};

// rolls a robot's drop with a seeded random function. Returns [{ id, n }]
export function rollLoot(type, rnd) {
  const out = [];
  for (const [id, min, max, chance] of LOOT[type] || []) {
    if (rnd() < chance) out.push({ id, n: min + Math.floor(rnd() * (max - min + 1)) });
  }
  return out;
}

// Containers in The Ruins: what each kind can hold, as [item, min, max, chance outside / in a yellow zone / in
// the red zone]. hold = seconds to search it. Better zones roll better odds.
export const CONTAINERS = {
  crate:   { name: 'supply crate', hold: 1.4, size: 8, loot: [['light_ammo', 15, 40, .6, .6, .5], ['pulse_cell', 20, 45, .3, .45, .5], ['medkit', 1, 1, .2, .35, .45], ['stim', 1, 2, .4, .4, .35],
    ['frag_grenade', 1, 2, .1, .25, .35], ['shield_cell', 1, 1, .05, .25, .35], ['repair_kit', 1, 1, .2, .25, .25], ['shield_light', 1, 1, .06, .04, 0], ['shield_medium', 1, 1, 0, .07, .1], ['shield_heavy', 1, 1, 0, 0, .05]] },
  locker:  { name: 'locker', hold: 1.0, size: 6, loot: [['scrap_metal', 1, 4, .6, .5, .4], ['wires', 1, 3, .4, .4, .35], ['battery', 1, 2, .2, .3, .3], ['old_phone', 1, 1, .15, .2, .25],
    ['gold_watch', 1, 1, .03, .07, .12], ['light_ammo', 10, 25, .3, .25, .2], ['stim', 1, 1, .15, .15, .15]] },
  medcab:  { name: 'medical cabinet', hold: 1.0, size: 4, loot: [['stim', 1, 2, .6, .6, .6], ['medkit', 1, 1, .25, .4, .55], ['medkit', 1, 1, 0, .1, .25]] },
  toolbox: { name: 'workbench', hold: 1.2, size: 4, loot: [['scrap_metal', 2, 5, .7, .6, .5], ['wires', 1, 3, .5, .5, .4], ['electronics', 1, 2, .15, .3, .4], ['battery', 1, 1, .2, .25, .3], ['repair_kit', 1, 1, .2, .3, .3]] },
  case:    { name: 'weapon case', hold: 2.0, size: 4, loot: [['scrap_pistol', 1, 1, .5, .3, .15], ['pulse_carbine', 1, 1, .1, .35, .55], ['light_ammo', 20, 48, .6, .5, .4], ['pulse_cell', 30, 60, .2, .45, .6],
    ['frag_grenade', 1, 2, .15, .3, .4], ['data_drive', 1, 1, .02, .06, .15]] },
  cache:   { name: 'Prism cache', hold: 2.5, size: 6, loot: [['prism_alloy', 2, 4, 1, 1, 1], ['prism_circuit', 1, 2, .5, .6, .7], ['prism_optic', 1, 1, .2, .3, .4], ['prism_shard', 1, 1, .05, .15, .3], ['thruster_coil', 1, 2, .3, .35, .4]] },
  car:     { name: 'car wreck', hold: 1.2, size: 4, loot: [['scrap_metal', 1, 3, .6, .5, .5], ['wires', 1, 2, .3, .3, .3], ['battery', 1, 1, .3, .3, .3], ['light_ammo', 8, 20, .2, .2, .2], ['old_phone', 1, 1, .08, .1, .12], ['stim', 1, 1, .08, .08, .08]] },
};
const ZONE_COLUMN = { outer: 3, yellow: 4, red: 5 };
// what a container holds, rolled with a seeded random function the first time it is searched
export function rollContainer(type, zone, rnd) {
  const def = CONTAINERS[type], k = ZONE_COLUMN[zone] || 3, out = [];
  for (const e of def.loot) if (rnd() < e[k]) out.push({ id: e[0], n: e[1] + Math.floor(rnd() * (e[2] - e[1] + 1)) });
  if (!out.length && type !== 'car' && rnd() < 0.6) { const e = def.loot[0]; out.push({ id: e[0], n: e[1] }); }   // rarely quite empty
  return out;
}
