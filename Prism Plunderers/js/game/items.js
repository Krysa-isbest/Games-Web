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
