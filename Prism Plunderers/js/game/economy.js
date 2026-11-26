// The lobby's economy (part 8, DESIGN 4 and 8): the workshop's stations (built first, then upgraded, each with its
// recipes), the Trader (buys everything at its value, sells the basics a little dearer, with a small shift every
// day), the backpack's upgrades, the stash as a grid, the loadout you take into a raid, and Pip the rooster, who
// scratches up something while you are out on a raid.
// All of it reads and changes the profile P (core/save.js) through Stash / Credits, so it is saved.
import { P, Stash, Credits, saveProfile } from '../core/save.js';
import { ITEMS, stackOf } from './items.js';
import { makeItem, syncShield, QUICK_SLOTS, SAFE_SLOTS } from './inventory.js';
import { rng } from '../core/util.js';

export const STASH_SLOTS = 128;
// the backpack: slots per level, and what the next level costs
export const BAG = [
  { slots: 12 },
  { slots: 16, cr: 1500, items: [['scrap_metal', 10], ['wires', 4]] },
  { slots: 20, cr: 4000, items: [['prism_alloy', 4], ['thruster_coil', 2]] },
  { slots: 24, cr: 9000, items: [['prism_circuit', 4], ['roach_plate', 1]] },
];
export const bagSlots = () => BAG[Math.min(BAG.length - 1, P.workshop.bag | 0)].slots;

// ---------- the workshop: stations ----------
// levels[i] = what it costs to reach level i + 1 (the first one builds it); recipes: [output, n, level, costs, credits]
export const STATIONS = [
  { id: 'gunsmith', name: 'Gunsmith', icon: 'pistol', desc: 'Guns and the rounds and cells they eat.',
    levels: [{ cr: 600, items: [['scrap_metal', 8]] }, { cr: 2500, items: [['electronics', 4], ['prism_alloy', 4]] }, { cr: 6000, items: [['prism_circuit', 4], ['thruster_coil', 3]] }],
    recipes: [['light_ammo', 30, 1, [['scrap_metal', 2]]], ['pulse_cell', 45, 1, [['battery', 1], ['scrap_metal', 1]]], ['scrap_pistol', 1, 1, [['scrap_metal', 6], ['wires', 2]]],
      ['pulse_carbine', 1, 2, [['scrap_metal', 8], ['electronics', 3], ['prism_circuit', 2], ['thruster_coil', 1]]]] },
  { id: 'medbay', name: 'Med station', icon: 'medkit', desc: 'Stims and medkits.',
    levels: [{ cr: 500, items: [['wires', 4]] }, { cr: 2200, items: [['electronics', 3], ['battery', 4]] }],
    recipes: [['stim', 1, 1, [['wires', 1], ['battery', 1]]], ['medkit', 1, 2, [['battery', 2], ['electronics', 1], ['prism_alloy', 1]]]] },
  { id: 'gear', name: 'Gear bench', icon: 'shield', desc: 'Shields, Repair Kits and Shield Cells.',
    levels: [{ cr: 700, items: [['scrap_metal', 10], ['wires', 3]] }, { cr: 3000, items: [['prism_alloy', 6], ['electronics', 3]] }, { cr: 8000, items: [['prism_circuit', 4], ['roach_plate', 1]] }],
    recipes: [['repair_kit', 1, 1, [['scrap_metal', 3], ['wires', 1]]], ['shield_light', 1, 1, [['scrap_metal', 6], ['wires', 3]]],
      ['shield_cell', 1, 2, [['battery', 2], ['prism_circuit', 1]]], ['shield_medium', 1, 2, [['prism_alloy', 4], ['electronics', 2], ['battery', 2]]],
      ['shield_heavy', 1, 3, [['roach_plate', 2], ['prism_alloy', 6], ['prism_circuit', 2]]]] },
  { id: 'explosives', name: 'Explosives bench', icon: 'grenade', desc: 'Grenades.',
    levels: [{ cr: 900, items: [['battery', 3], ['scrap_metal', 6]] }],
    recipes: [['frag_grenade', 1, 1, [['scrap_metal', 2], ['battery', 1]]]] },
];
export const stationLevel = id => P.workshop.stations[id] | 0;
// what is missing for a list of costs: [{ id, need, have }] (empty: you can pay it)
export function missing(items = [], cr = 0) {
  const out = items.map(([id, need]) => ({ id, need, have: Stash.count(id) })).filter(m => m.have < m.need);
  if (cr > P.credits) out.push({ id: 'credits', need: cr, have: P.credits });
  return out;
}
function pay(items = [], cr = 0) {
  if (missing(items, cr).length) return false;
  if (cr && !Credits.spend(cr)) return false;
  for (const [id, n] of items) Stash.take(id, n);
  return true;
}
// builds a station, or upgrades it a level. Returns true when it worked.
export function upgradeStation(id) {
  const st = STATIONS.find(s => s.id === id), lv = stationLevel(id), next = st && st.levels[lv];
  if (!next || !pay(next.items, next.cr)) return false;
  P.workshop.stations[id] = lv + 1;
  saveProfile();
  return true;
}
// crafts a recipe once: the costs out of the stash, the item into it
export function craft(stationId, i) {
  const st = STATIONS.find(s => s.id === stationId), r = st && st.recipes[i];
  if (!r || stationLevel(stationId) < r[2] || !pay(r[3], r[4] || 0)) return false;
  addToStash(r[0], r[1]);
  saveProfile();
  return true;
}
// new things into the stash (guns loaded, shields charged)
export function addToStash(id, n) {
  if (ITEMS[id].weapon || ITEMS[id].shield) for (let k = 0; k < n; k++) { const it = makeItem(id); Stash.add(id, 1, it.d); }
  else Stash.add(id, n);
}

// ---------- the Trader ----------
// what it sells; prices shift a little every day (DESIGN 8.3)
export const TRADER_STOCK = ['light_ammo', 'pulse_cell', 'stim', 'medkit', 'repair_kit', 'shield_cell', 'frag_grenade', 'shield_light', 'scrap_pistol'];
const BUY_PACK = { light_ammo: 30, pulse_cell: 45 };
const dayShift = id => {                                   // -10 % .. +10 %, the same all day for everyone
  const d = Math.floor(Date.now() / 86400000);
  let h = d * 2654435761;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 0.9 + rng(h >>> 0)() * 0.2;
};
export const sellPrice = (id, n = 1) => Math.max(1, Math.round(ITEMS[id].value * dayShift(id))) * n;
export const buyPack = id => BUY_PACK[id] || 1;
export const buyPrice = id => Math.round(ITEMS[id].value * 1.5 * dayShift(id + '+')) * buyPack(id);
export function buy(id) {
  if (!TRADER_STOCK.includes(id) || !Credits.spend(buyPrice(id))) return false;
  addToStash(id, buyPack(id));
  saveProfile();
  return true;
}

// ---------- the stash as a grid, for the loadout screen (a container with STASH_SLOTS slots) ----------
// big stacks are split into full ones (the stash keeps any amount in one entry)
export function stashBox() {
  const slots = [];
  for (const it of P.stash) {
    if (it.d) { slots.push({ id: it.id, n: 1, d: it.d }); continue; }
    let n = it.n;
    while (n > 0) { const k = Math.min(n, stackOf(it.id)); slots.push({ id: it.id, n: k }); n -= k; }
  }
  while (slots.length < STASH_SLOTS) slots.push(null);
  return { id: 'stash', name: 'Stash', slots, revealed: slots.length, revealT: 0 };
}
// the grid back into the profile (after every change on the loadout screen)
export function saveStash(box) {
  P.stash = box.slots.filter(Boolean).map(it => it.d ? { id: it.id, n: 1, d: it.d } : { id: it.id, n: it.n });
  saveProfile();
}

// ---------- the loadout: what you take into the next raid ----------
export function emptyLoadout() {
  return { equip: { shield: null, melee: null, weapon1: null, weapon2: null }, bag: Array(bagSlots()).fill(null), quick: Array(QUICK_SLOTS).fill(null), safe: Array(SAFE_SLOTS).fill(null) };
}
// the saved loadout, in shape (old saves had a list of names; a bigger backpack adds slots)
export function loadout() {
  let L = P.loadout;
  if (!L || !L.equip || !Array.isArray(L.bag)) L = P.loadout = emptyLoadout();
  while (L.bag.length < bagSlots()) L.bag.push(null);
  if (!Array.isArray(L.quick)) L.quick = Array(QUICK_SLOTS).fill(null);
  if (!Array.isArray(L.safe)) L.safe = Array(SAFE_SLOTS).fill(null);
  return L;
}
export const loadoutEmpty = () => { const L = loadout(); return !Object.values(L.equip).some(Boolean) && ![...L.bag, ...L.quick, ...L.safe].some(Boolean); };
// the raid starts: the loadout becomes what the raider carries (the backpack as big as yours), and the loadout empties
export function takeLoadout(p) {
  const L = loadout(), copy = it => it ? JSON.parse(JSON.stringify(it)) : null;
  for (const k of Object.keys(p.inv.equip)) p.inv.equip[k] = copy(L.equip[k]);
  p.inv.bag = L.bag.map(copy);
  p.inv.quick = L.quick.map(copy);
  p.inv.safe = L.safe.map(copy);
  syncShield(p);
  P.loadout = emptyLoadout();
  saveProfile();
}
// the free starter loadout (an empty loadout only): the pistol, a bit of ammo, a medkit
export function freeKit() {
  if (!loadoutEmpty()) return false;
  const L = loadout();
  L.equip.weapon2 = makeItem('scrap_pistol');
  L.quick[0] = makeItem('medkit', 1);
  L.bag[0] = makeItem('light_ammo', 36);
  saveProfile();
  return true;
}
// buys the next backpack size
export function upgradeBag() {
  const next = BAG[(P.workshop.bag | 0) + 1];
  if (!next || !pay(next.items, next.cr)) return false;
  P.workshop.bag = (P.workshop.bag | 0) + 1;
  loadout();
  saveProfile();
  return true;
}

// ---------- Pip, the workshop's rooster: scratches up some credits after every raid, now and then a find ----------
const FINDS = [['scrap_metal', 3], ['wires', 2], ['battery', 1], ['electronics', 1], ['old_phone', 1], ['gold_watch', 1]];
export function chickenForage(seed = Date.now()) {
  const R = rng(seed >>> 0), c = P.workshop.chicken;
  if (c.finds.length >= 3) return;                         // three finds wait for you at most
  const find = { cr: 40 + Math.floor(R() * 90) };
  if (R() < 0.35) { const f = FINDS[Math.min(FINDS.length - 1, Math.floor(Math.pow(R(), 1.6) * FINDS.length))]; find.id = f[0]; find.n = f[1]; }
  c.finds.push(find);
  saveProfile();
}
// collects what Pip found: returns [{ cr, id?, n? }]
export function chickenCollect() {
  const got = P.workshop.chicken.finds.splice(0);
  for (const f of got) { Credits.add(f.cr); if (f.id) Stash.add(f.id, f.n); }
  saveProfile();
  return got;
}
