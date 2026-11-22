// The inventory: plain data on the player, changed only through these functions (so a co-op host can check
// every move later). Layout as in Arc Raiders:
//   equip  { shield, melee, weapon1, weapon2 }
//   bag    20 slots      (the backpack)
//   quick  4 slots       (the Q wheel: heals, shield tools, grenades)
//   safe   2 slots       (the safe pocket: kept when you die)
// An item is { id, n } or, for things with their own state, { id, n: 1, d: {...} } (a gun's ammo, a shield's health).
// A slot reference is { a: 'equip' | 'bag' | 'quick' | 'safe' | 'box', i: index or equip slot name }.
// A box (a wreck, a crate) is { id, name, slots: [...] }.
import { ITEMS, stackOf } from './items.js';
import { SHIELDS } from './stats.js';

export const BAG_SLOTS = 20, QUICK_SLOTS = 4, SAFE_SLOTS = 2;
export const EQUIP_SLOTS = ['shield', 'melee', 'weapon1', 'weapon2'];
export const MAX_WEIGHT = 60;

export function makeInventory() {
  return {
    equip: { shield: null, melee: null, weapon1: null, weapon2: null },
    bag: Array(BAG_SLOTS).fill(null),
    quick: Array(QUICK_SLOTS).fill(null),
    safe: Array(SAFE_SLOTS).fill(null),
  };
}
// a new item. Guns come loaded, shields charged.
export function makeItem(id, n = 1) {
  const def = ITEMS[id];
  if (!def) throw new Error('Unknown item: ' + id);
  const it = { id, n: Math.max(1, Math.min(n, stackOf(id))) };
  if (def.weapon) it.d = { ammo: def.weapon.mag };
  if (def.shield) it.d = { type: def.shield, hp: SHIELDS[def.shield].hp, broken: false };
  return it;
}
export const sameRef = (a, b) => a.a === b.a && a.i === b.i;

function areaOf(inv, a, box) { return a === 'box' ? (box ? box.slots : null) : inv[a]; }
export function getAt(inv, ref, box) {
  if (ref.a === 'equip') return inv.equip[ref.i] || null;
  const arr = areaOf(inv, ref.a, box);
  return arr ? arr[ref.i] || null : null;
}
export function setAt(inv, ref, it, box) {
  if (ref.a === 'equip') inv.equip[ref.i] = it || null;
  else areaOf(inv, ref.a, box)[ref.i] = it || null;
}
// can this slot hold this item?
export function accepts(ref, it) {
  if (!it) return true;
  const d = ITEMS[it.id];
  if (ref.a === 'equip') return ref.i === 'shield' ? d.cat === 'shield' : ref.i === 'melee' ? d.cat === 'melee' : d.cat === 'weapon';
  if (ref.a === 'quick') return !!d.quick;
  return true;
}
const stackable = (a, b) => a && b && a.id === b.id && !a.d && !b.d && stackOf(a.id) > 1;

// Drag and drop: moves an item onto a slot. Same kind: the stacks merge. Something else there: they swap, if
// each fits the other's slot. Returns true when something changed.
export function move(inv, from, to, box) {
  if (sameRef(from, to)) return false;
  const a = getAt(inv, from, box), b = getAt(inv, to, box);
  if (!a) return false;
  if (stackable(a, b)) {
    const room = stackOf(a.id) - b.n;
    if (room <= 0) return false;
    const k = Math.min(room, a.n);
    b.n += k; a.n -= k;
    if (a.n <= 0) setAt(inv, from, null, box);
    return true;
  }
  if (!accepts(to, a) || !accepts(from, b)) return false;
  setAt(inv, to, a, box);
  setAt(inv, from, b, box);
  return true;
}
// splits a stack in two: half goes to the first free slot of the same area (or the bag)
export function split(inv, ref, box) {
  const it = getAt(inv, ref, box);
  if (!it || it.d || it.n < 2) return false;
  let area = ref.a === 'equip' ? 'bag' : ref.a;
  let arr = areaOf(inv, area, box), i = arr.indexOf(null);
  if (i < 0 && area !== 'bag') { area = 'bag'; arr = inv.bag; i = arr.indexOf(null); }
  if (i < 0 || !accepts({ a: area, i }, it)) return false;
  const half = Math.floor(it.n / 2);
  it.n -= half;
  arr[i] = { id: it.id, n: half };
  return true;
}
// takes the item out of its slot (to drop it, or to use the last of a stack)
export function removeAt(inv, ref, box) {
  const it = getAt(inv, ref, box);
  setAt(inv, ref, null, box);
  return it;
}

// Picks something up: tops up stacks you already carry, puts gear into empty equipment slots, quick items into
// empty quick slots, everything else into the backpack. Returns how many did not fit (0 = all of it).
export function addItem(inv, item) {
  const d = ITEMS[item.id];
  let n = item.n;
  if (!item.d && stackOf(item.id) > 1) {
    for (const arr of [inv.quick, inv.bag, inv.safe]) for (const s of arr) {
      if (n > 0 && s && s.id === item.id && !s.d && s.n < stackOf(item.id)) { const k = Math.min(n, stackOf(item.id) - s.n); s.n += k; n -= k; }
    }
    if (n <= 0) return 0;
  }
  if (d.cat === 'weapon') for (const k of ['weapon1', 'weapon2']) if (!inv.equip[k]) { inv.equip[k] = item; return 0; }
  if (d.cat === 'melee' && !inv.equip.melee) { inv.equip.melee = item; return 0; }
  if (d.cat === 'shield' && !inv.equip.shield) { inv.equip.shield = item; return 0; }
  if (d.quick) {
    const i = inv.quick.indexOf(null);
    if (i >= 0 && !inv.quick.some(s => s && s.id === item.id)) { inv.quick[i] = { ...item, n: Math.min(n, stackOf(item.id)) }; n -= inv.quick[i].n; if (n <= 0) return 0; }
  }
  while (n > 0) {
    const i = inv.bag.indexOf(null);
    if (i < 0) break;
    const k = Math.min(n, stackOf(item.id));
    inv.bag[i] = item.d ? item : { id: item.id, n: k };
    n -= k;
  }
  return n;
}
// how many of an item you carry (backpack, quick slots, safe pocket)
export function count(inv, id) {
  let n = 0;
  for (const arr of [inv.bag, inv.quick, inv.safe]) for (const s of arr) if (s && s.id === id) n += s.n;
  return n;
}
// uses up to n of an item, backpack first. Returns how many were taken.
export function take(inv, id, n) {
  let got = 0;
  for (const arr of [inv.bag, inv.safe, inv.quick]) for (let i = 0; i < arr.length && got < n; i++) {
    const s = arr[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(s.n, n - got);
    s.n -= k; got += k;
    if (s.n <= 0) arr[i] = null;
  }
  return got;
}
export function all(inv) {
  return [...Object.values(inv.equip), ...inv.bag, ...inv.quick, ...inv.safe].filter(Boolean);
}
export const weight = inv => all(inv).reduce((s, it) => s + (ITEMS[it.id].weight || 0) * it.n, 0);
// what your loot is worth (backpack, quick slots, safe pocket; not your equipped gear)
export const lootValue = inv => [...inv.bag, ...inv.quick, ...inv.safe].filter(Boolean).reduce((s, it) => s + ITEMS[it.id].value * it.n, 0);
export const bagUsed = inv => inv.bag.filter(Boolean).length;
// dying: everything goes except the safe pocket
export function loseOnDeath(inv) {
  for (const k of EQUIP_SLOTS) inv.equip[k] = null;
  inv.bag.fill(null); inv.quick.fill(null);
}
// the player's live shield is the equipped shield item's own state
export function syncShield(p) { p.shield = p.inv && p.inv.equip.shield ? p.inv.equip.shield.d : null; }

// ---------- moving things between areas (the inventory screen's clicks) ----------
// picks up the item in a slot (of a box, usually): like a pickup from the ground. Returns how many moved.
export function takeFrom(inv, ref, box) {
  const it = getAt(inv, ref, box);
  if (!it) return 0;
  const n = it.n, left = addItem(inv, it);
  if (left <= 0) setAt(inv, ref, null, box); else it.n = left;
  return n - Math.max(0, left);
}
// moves an item into an area ('bag', 'safe', 'quick' or 'box'), topping up stacks there first.
// Returns true when all of it moved.
export function transfer(inv, ref, area, box) {
  const it = getAt(inv, ref, box);
  if (!it) return false;
  const arr = area === 'box' ? (box ? box.slots : null) : inv[area];
  if (!arr || (area === 'quick' && !ITEMS[it.id].quick)) return false;
  let n = it.n;
  if (!it.d && stackOf(it.id) > 1) {
    for (const s of arr) if (n > 0 && s && s !== it && s.id === it.id && !s.d && s.n < stackOf(it.id)) { const k = Math.min(n, stackOf(it.id) - s.n); s.n += k; n -= k; }
  }
  if (n <= 0) { setAt(inv, ref, null, box); return true; }
  const i = arr.indexOf(null);
  it.n = n;
  if (i < 0) return false;
  setAt(inv, ref, null, box);
  arr[i] = it;
  return true;
}
// the equipment slot an item goes to when you equip it (an empty weapon slot first)
export function equipSlotFor(inv, it, prefer = 'weapon1') {
  const c = ITEMS[it.id].cat;
  if (c === 'shield') return 'shield';
  if (c === 'melee') return 'melee';
  if (c === 'weapon') return !inv.equip.weapon1 ? 'weapon1' : !inv.equip.weapon2 ? 'weapon2' : prefer === 'weapon2' ? 'weapon2' : 'weapon1';
  return null;
}

// ---------- containers: a wreck, a crate ----------
// items = [{ id, n }]: big amounts are split into full stacks
export function makeBox(id, name, items = [], size = 8) {
  const list = [];
  for (const g of items) { let n = g.n; while (n > 0) { const k = Math.min(n, stackOf(g.id)); list.push(makeItem(g.id, k)); n -= k; } }
  const slots = Array(Math.max(size, list.length)).fill(null);
  list.forEach((it, i) => { slots[i] = it; });
  return { id, name, slots };
}
// takes everything that fits out of a box. Returns [{ id, n }]: what was taken.
export function takeAll(inv, box) {
  const got = [];
  box.slots.forEach((it, i) => {
    if (!it) return;
    const n = it.n, moved = takeFrom(inv, { a: 'box', i }, box);
    if (moved > 0) got.push({ id: it.id, n: Math.min(n, moved) });
  });
  return got;
}
// tops a box up to a stock list [[id, n], ...] (the test range's supply crate)
export function restock(box, stock) {
  for (const [id, n] of stock) {
    let have = box.slots.reduce((s, it) => s + (it && it.id === id ? it.n : 0), 0);
    while (have < n) {
      const i = box.slots.indexOf(null);
      if (i < 0) return;
      const k = Math.min(n - have, stackOf(id));
      box.slots[i] = makeItem(id, k);
      have += k;
    }
  }
}
