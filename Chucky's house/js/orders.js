// Customer requests (the order board) and collections (full sets sell to a collector for much more).
import { G, ACTIONS, pick, rand, newUid } from './state.js';
import { ITEMS, itemById } from './data.js';
import { morningHooks, value, gainTrust, addTrust } from './economy.js';
import { REGULARS } from './social.js';
import { addJob } from './jobs.js';
import { tell } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const ORDER_POOL = ITEMS.filter(i => !['big', 'food', 'weapon', 'fun', 'story', 'cash'].includes(i.cat)).map(i => i.id);
const WHO = [...REGULARS.map(r => r.name), 'A plumber', 'A college kid', 'The diner owner', 'A nervous groom', 'A film crew', 'Mrs. Kowalski'];

morningHooks.push(() => {
  for (const o of [...G.orders]) if (o.due < G.day) {
    G.orders.splice(G.orders.indexOf(o), 1);
    addTrust(-0.005);
    G.missedOrders = (G.missedOrders || 0) + 1;
  }
  if (G.orders.length < 3 && Math.random() < 0.65) {
    const id = pick(ORDER_POOL);
    G.orders.push({ oid: newUid(), id, who: pick(WHO), due: G.day + 2 + (Math.random() * 3 | 0), mult: +rand(1.5, 2).toFixed(2), bonus: Math.round(rand(20, 120)) });
  }
});

const best = id => G.backstock.filter(i => i.id === id).sort((a, b) => (b.broken ? 0 : b.q) - (a.broken ? 0 : a.q))[0];
export const canDeliver = o => !!best(o.id);
export const orderPay = (o, inst) => Math.round(value(inst) * o.mult) + o.bonus;

ACTIONS.deliverOrder = (pid, oid) => {
  const o = G.orders.find(x => x.oid === oid), inst = o && best(o.id);
  if (!inst) { tell(pid, 'You don\'t have that item in the stock crates.', 'bad'); return false; }
  const pay = orderPay(o, inst);
  G.backstock.splice(G.backstock.indexOf(inst), 1);
  G.orders.splice(G.orders.indexOf(o), 1);
  G.money += pay; G.stats.sales += pay; G.stats.sold++; G.life.sold++; G.life.sales += pay;
  gainTrust(0.01);
  addJob(pid, 'stocker', 15, 'orders');
  sfx.cash(); tell(pid, `Order delivered to ${o.who}: ${UI.money(pay)}!`);
  return true;
};

// ---------- collections ----------
export const SETS = [
  { id: 'coins', icon: '🪙', name: 'Coin Collection', need: { coin: 5 }, mult: 1.9 },
  { id: 'stamps', icon: '📔', name: 'Stamp Archive', need: { stamps: 3 }, mult: 1.7 },
  { id: 'cards', icon: '🃏', name: 'Card Binder', need: { card: 5 }, mult: 1.9 },
  { id: 'vinyl', icon: '💿', name: 'Record Crate', need: { vinyl: 6 }, mult: 1.8 },
  { id: 'jewel', icon: '💍', name: 'Jewellery Set', need: { ring: 1, necklace: 1, earrings: 1, chain: 1 }, mult: 1.6 },
  { id: 'retro', icon: '🎮', name: 'Retro Gaming Bundle', need: { console: 1, cartridge: 3, joystick: 1 }, mult: 1.7 },
  { id: 'band', icon: '🎸', name: 'Band Starter Kit', need: { guitar: 1, trumpet: 1, harmonica: 1, headphones: 1 }, mult: 1.6 },
  { id: 'garage', icon: '🔧', name: 'Garage Kit', need: { drill: 1, hammer: 1, wrenchset: 1, toolbox: 1 }, mult: 1.6 },
];
export const have = id => G.backstock.filter(i => i.id === id && !i.broken && !i.fake).length;
export const setReady = s => Object.entries(s.need).every(([id, n]) => have(id) >= n);
function setItems(s) {
  return Object.entries(s.need).flatMap(([id, n]) => G.backstock.filter(i => i.id === id && !i.broken && !i.fake).sort((a, b) => b.q - a.q).slice(0, n));
}
export const setPay = s => Math.round(setItems(s).reduce((t, i) => t + value(i), 0) * s.mult);

ACTIONS.sellSet = (pid, sid) => {
  const s = SETS.find(x => x.id === sid);
  if (!s || !setReady(s)) { tell(pid, 'The set isn\'t complete (broken or fake pieces don\'t count).', 'bad'); return false; }
  const pay = setPay(s);
  for (const i of setItems(s)) G.backstock.splice(G.backstock.indexOf(i), 1);
  G.money += pay; G.stats.sales += pay; G.life.sales += pay;
  gainTrust(0.01);
  addJob(pid, 'stocker', 20, 'orders');
  sfx.cash(); tell(pid, `${s.name} sold to the collector for ${UI.money(pay)}!`);
  return true;
};

// Read-only list for the cork board in the shop.
export function boardPanel() {
  UI.openPanel(`<h2>📋 Order board</h2>
    ${G.orders.length ? `<div class="list">${G.orders.map(o => { const d = itemById(o.id);
      return `<div class="pc-row"><span class="big">${d.icon}</span><span class="grow"><b>${d.name}</b> for ${o.who}<br><small class="dim">by the end of Day ${o.due} · pays ×${o.mult} + ${UI.money(o.bonus)}</small></span>${canDeliver(o) ? '<span class="up">in stock ✓</span>' : '<span class="dim">not in stock</span>'}</div>`;
    }).join('')}</div>` : '<p class="dim">No orders right now. New ones come in the mornings.</p>'}
    <p class="dim">Deliver orders and sell collections on the computer (📋 Orders).</p>
    <div class="row"><button id="ob-x">Close</button></div>`);
  UI.$('ob-x').onclick = () => UI.closePanel();
}
