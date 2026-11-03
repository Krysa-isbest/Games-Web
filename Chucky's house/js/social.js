// People of the neighbourhood: named regulars who remember how you treated them, stolen goods and the
// detective who comes to check, and team alerts (a pop-up for everybody in the shop).
import { G, pick, rand, clamp } from './state.js';
import { ITEMS } from './data.js';
import { morningHooks, addTrust } from './economy.js';
import { setSlotItem } from './shelves.js';
import { broadcast } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const pool = cats => ITEMS.filter(i => cats.includes(i.cat));
export const REGULARS = [
  { name: 'Guitar Gary', icon: '🎸', role: 'seller', items: () => ['guitar'], type: { name: 'Regular', mult: 1.15, patience: 3, ask: 0.9, min: 0.5 },
    lines: ['Me again. Same guitar, need cash till Friday.', 'You know this one. Treat her nice.', 'Rent\'s due. You know how it is.'] },
  { name: 'Mags the Collector', icon: '🧐', role: 'buyer', cats: ['collect', 'antique', 'jewel'], type: { name: 'Collector', mult: 1.5, patience: 3 },
    lines: ['Anything for my collection today?', 'I only buy the good stuff, dear.', 'Ooh. Let me see that one.'] },
  { name: 'Slick Sal', icon: '🕶️', role: 'seller', stolen: true, items: () => pool(['jewel', 'elec']).map(i => i.id), type: { name: 'Shady', mult: 1, patience: 2, ask: 0.45, min: 0.3 },
    lines: ['Don\'t ask where it\'s from.', 'Fell off a truck. Half price.', 'Quick, before anyone sees.'] },
  { name: 'Granny Edna', icon: '👵', role: 'seller', items: () => pool(['antique', 'house', 'collect']).map(i => i.id), type: { name: 'Clueless', mult: 1.3, patience: 5, ask: 0.55, min: 0.3 },
    lines: ['My late husband\'s. Is it worth anything?', 'Found it in the attic, sweetie.', 'I just want it to go to a good home.'] },
  { name: 'Victor Vance', icon: '🎩', role: 'buyer', type: { name: 'Rich guy', mult: 1.65, patience: 4 },
    lines: ['Show me something expensive.', 'Money is no object. Taste is.', 'I\'ll take your finest.'] },
];
export const regularByName = n => REGULARS.find(r => r.name === n);
const mem = name => (G.regulars[name] ??= { mood: 0.5, visits: 0, last: 0 });
export const moodOf = name => mem(name).mood;

morningHooks.push(() => {
  G.regVisited = [];
  // the detective comes when you own stolen goods (a 30 % chance each day)
  G.detectiveAt = ownedStolen().length && Math.random() < 0.3 ? rand(60, 420) : null;
});

// A regular for the next customer (or null). Each comes at most once a day.
export function pickRegular() {
  if (G.day < 3 || Math.random() > 0.25) return null; // the regulars find the new owner from Day 3
  const free = REGULARS.filter(r => !(G.regVisited || []).includes(r.name));
  if (!free.length) return null;
  const r = pick(free);
  (G.regVisited ??= []).push(r.name);
  const m = mem(r.name); m.visits++; m.last = G.day;
  return r;
}
// Mood changes the deal: angry = less patience and stingier; happy = better stuff, better prices.
export function moodType(r) {
  const m = moodOf(r.name), t = { ...r.type };
  if (m < 0.3) { t.patience = Math.max(1, t.patience - 1); t.mult = (t.mult || 1) * 0.9; t.ask = (t.ask || 1) * 1.15; }
  if (m > 0.7) { t.mult = (t.mult || 1) * 1.1; }
  return t;
}
export const moodWord = name => { const m = moodOf(name); return m < 0.3 ? '😠 angry with you' : m > 0.7 ? '😊 likes you' : '😐'; };
export function moodLine(r) {
  const m = moodOf(r.name);
  if (m < 0.3) return pick(['You ripped me off last time.', 'Don\'t try anything this time.', 'I\'m only here because I have to be.']);
  return pick(r.lines);
}
// Remember the deal. worth = what it's really worth.
export function rateDeal(name, seller, price, worth) {
  if (!name) return;
  const m = mem(name), r = price / Math.max(1, worth);
  if (seller) m.mood += r < 0.4 ? -0.15 : r > 0.7 ? 0.1 : 0.03;
  else m.mood += r > 1.4 ? -0.2 : r <= 1.1 ? 0.1 : 0;
  m.mood = clamp(m.mood, 0, 1);
}

// ---------- stolen goods & the detective ----------
export function ownedStolen() {
  const out = [];
  for (const s of G.shelves) for (const sl of s.userData.slots) if (sl.item?.stolen) out.push({ slot: sl, inst: sl.item });
  G.backstock.forEach(i => { if (i.stolen) out.push({ stock: true, inst: i }); });
  return out;
}
// The detective looked around: fine + confiscation if he finds anything.
export function inspectShop() {
  const found = ownedStolen();
  if (!found.length) { alert('🕵️ The detective found nothing and left. Phew.'); return 0; }
  for (const f of found) {
    if (f.slot) setSlotItem(f.slot, null);
    else G.backstock.splice(G.backstock.indexOf(f.inst), 1);
  }
  const fine = 200 + found.length * 100;
  G.money -= fine; G.stats.spent += fine;
  addTrust(-0.03);
  alert(`🚔 The detective found ${found.length} stolen item(s)! Confiscated, and a ${UI.money(fine)} fine.`);
  return fine;
}

// ---------- team alerts ----------
export function alert(text) {
  UI.toast(text, 'alert');
  sfx.alert();
  broadcast({ t: 'alert', text });
}
G.alertFn = alert;
