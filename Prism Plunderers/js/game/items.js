// Items. For now only what the Prism drop; part 3 (weapons and items) adds guns, heals, shields and materials
// here, and the inventory that shows them. Values are what the Trader pays, in Scrap Credits.
export const RARITY = {
  common:    { name: 'Common',    color: '#c9ced6' },
  uncommon:  { name: 'Uncommon',  color: '#6fd88f' },
  rare:      { name: 'Rare',      color: '#5aa9ff' },
  epic:      { name: 'Epic',      color: '#b77dff' },
  legendary: { name: 'Legendary', color: '#ffb224' },
};

export const ITEMS = {
  prism_alloy:    { name: 'Prism alloy',          rarity: 'common',    value: 35 },
  prism_circuit:  { name: 'Prism circuit',        rarity: 'uncommon',  value: 80 },
  thruster_coil:  { name: 'Thruster coil',        rarity: 'uncommon',  value: 95 },
  prism_optic:    { name: 'Prism optic',          rarity: 'uncommon',  value: 110 },
  fink_lens:      { name: 'Fink scanner lens',    rarity: 'rare',      value: 260 },
  swatter_barrel: { name: 'Swatter barrel',       rarity: 'rare',      value: 240 },
  scatter_core:   { name: 'Scatter charge core',  rarity: 'rare',      value: 190 },
  roach_plate:    { name: 'Roach carapace plate', rarity: 'epic',      value: 320 },
  roach_reactor:  { name: 'Roach Reactor',        rarity: 'legendary', value: 2500 },
};

// What each robot can drop: [item, min, max, chance]
export const LOOT = {
  fink:    [['prism_alloy', 1, 2, 1], ['prism_circuit', 1, 1, 0.6], ['fink_lens', 1, 1, 0.35]],
  fly:     [['prism_alloy', 1, 2, 1], ['thruster_coil', 1, 1, 0.4], ['prism_optic', 1, 1, 0.25]],
  swatter: [['prism_alloy', 2, 3, 1], ['thruster_coil', 1, 2, 0.6], ['prism_circuit', 1, 1, 0.5], ['swatter_barrel', 1, 1, 0.4]],
  scatter: [['prism_alloy', 1, 1, 0.8], ['scatter_core', 1, 1, 0.3]],
  roach:   [['roach_reactor', 1, 1, 1], ['roach_plate', 2, 3, 1], ['prism_circuit', 2, 3, 1], ['prism_optic', 1, 2, 0.8]],
};

// rolls a robot's drop with a seeded random function. Returns [{ id, n }]
export function rollLoot(type, rnd) {
  const out = [];
  for (const [id, min, max, chance] of LOOT[type] || []) {
    if (rnd() < chance) out.push({ id, n: min + Math.floor(rnd() * (max - min + 1)) });
  }
  return out;
}

// puts items in a bag ([{ id, n }]), stacking what is already there
export function addToBag(bag, items) {
  for (const it of items) {
    const have = bag.find(b => b.id === it.id);
    if (have) have.n += it.n; else bag.push({ id: it.id, n: it.n });
  }
}
export const bagValue = bag => bag.reduce((s, b) => s + (ITEMS[b.id] ? ITEMS[b.id].value * b.n : 0), 0);
export const bagCount = bag => bag.reduce((s, b) => s + b.n, 0);
