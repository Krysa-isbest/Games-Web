import { G, rand, pick, clamp } from './state.js';
import { ITEMS, itemById, makeInst } from './data.js';
import { setSlotItem } from './shelves.js';

export const START_DEBT = 8000;
export const INTEREST = 0.008;   // per day
export const INSTALLMENT = 600;  // per week
export const DAY_LEN = 300;      // real seconds from 9:00 AM to 6:00 PM
export const BIG_BUY = 500;      // purchases from this price up need a second player's OK in co-op
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dayName = (d = G.day) => WEEKDAYS[(d - 1) % 7];
export const isAuctionDay = (d = G.day) => d % 7 === 6; // every Saturday
export const nextAuction = () => { let d = G.day; while (!isAuctionDay(d)) d++; return d; };

export const SKULLS = { alley: [0.5, 2], junkyard: [1, 3] };

const mid = id => { const r = itemById(id).range; return (r[0] + r[1]) / 2; };
export const marketPrice = id => G.market[id] ?? Math.round(mid(id));
export const trend = id => marketPrice(id) / (G.marketPrev[id] ?? marketPrice(id)) - 1;
export const value = inst => Math.max(1, Math.round(marketPrice(inst.id) * inst.q * (inst.broken ? 0.3 : 1) * (inst.fake ? 0.12 : 1)));
export const weekEnd = () => Math.ceil(G.day / 7) * 7;
export const dueRemaining = () => Math.max(0, Math.min(INSTALLMENT - G.paidWeek, G.debt));
export const freshStats = () => ({ sales: 0, sold: 0, spent: 0, eggs: 0 });
export const addTrust = d => { G.trust = clamp(G.trust + d, 0, 1); };
// Trust = how much extra customers are willing to pay (0 % to +100 %).
export const trustMult = () => 1 + G.trust;
// Things that make trust grow faster register a multiplier here (clean shop, decorations, music on the radio).
export const trustMods = [];
export const gainTrust = d => addTrust(d * trustMods.reduce((m, f) => m * f(), 1));
// Other modules plug into the morning (shop events, orders, regulars, letters…). Run at the end of rollMarket().
export const morningHooks = [];

const roundHalf = v => Math.round(v * 2) / 2;

export function rollMarket() {
  for (const it of ITEMS) {
    G.marketPrev[it.id] = G.market[it.id] ?? Math.round(mid(it.id));
    G.market[it.id] = Math.max(1, Math.round(rand(...it.range)));
  }
  const pool = ITEMS.filter(i => !['big', 'weapon', 'food', 'car', 'scrap', 'fun', 'story', 'cash'].includes(i.cat) && i.range[1] < 400);
  // early days are short on supply (the nights are where stock comes from): 2 deals, then 3, then 5
  G.deals = Array.from({ length: G.day <= 3 ? 2 : G.day <= 5 ? 3 : 5 }, () => {
    const inst = makeInst(pick(pool).id, { q: rand(0.8, 1.1) });
    return { inst, cost: Math.round(marketPrice(inst.id) * inst.q * rand(0.45, 0.68)) };
  });
  G.night = Object.fromEntries(Object.entries(SKULLS).map(([k, [a, b]]) => [k, roundHalf(rand(a, b))]));
  G.auction = isAuctionDay() ? genAuction() : null;
  for (const h of morningHooks) h();
}

// ---------- auction (one day a week) ----------
const AUCTION_POOL = ['diamond', 'chain', 'violin', 'painting', 'gramophone', 'ring', 'laptop', 'sword', 'motorbike', 'arcade', 'necklace', 'pocketwatch'];
function genAuction() {
  const lots = Array.from({ length: 4 }, () => {
    const inst = makeInst(pick(AUCTION_POOL), { q: rand(0.85, 1.25) });
    const v = value(inst);
    return { inst, worth: v, bid: Math.round(v * 0.35 / 10) * 10, leader: null, npcMax: Math.round(v * rand(0.7, 1.25)), npcT: rand(2, 5), t: 30, state: 'waiting' };
  });
  return { lots, cur: 0, started: false };
}
export const bidStep = lot => Math.max(10, Math.round(lot.worth * 0.05 / 10) * 10);

// Runs on the host while the shop is open or in prep on auction day.
export function auctionTick(dt, onEvent) {
  const A = G.auction;
  if (!A?.started) return;
  const lot = A.lots[A.cur];
  if (!lot) return;
  if (lot.state === 'waiting') { lot.state = 'live'; lot.t = 30; onEvent('start', lot); }
  lot.t -= dt;
  if (lot.leader !== 'npc' && lot.bid + bidStep(lot) <= lot.npcMax && (lot.npcT -= dt) <= 0) {
    lot.bid += lot.leader ? bidStep(lot) : 0;
    lot.leader = 'npc';
    lot.npcT = rand(1.5, 4.5);
    lot.t = Math.max(lot.t, 8);
    onEvent('npc', lot);
  }
  if (lot.t <= 0) {
    lot.state = 'sold';
    if (lot.leader && lot.leader !== 'npc') {
      if (G.money >= lot.bid) { G.money -= lot.bid; G.stats.spent += lot.bid; G.backstock.push(lot.inst); onEvent('won', lot); }
      else { lot.state = 'forfeit'; addTrust(-0.03); onEvent('broke', lot); }
    } else onEvent('lost', lot);
    A.cur++;
    if (A.cur >= A.lots.length) A.started = false;
  }
}

export function pay(n) {
  n = Math.floor(Math.min(n, G.money, G.debt));
  if (n <= 0) return 0;
  G.money -= n; G.debt -= n; G.paidWeek += n;
  return n;
}

function seize(itemFrac, moneyFrac) {
  const owned = [
    ...G.shelves.flatMap(s => s.userData.slots.filter(sl => sl.item).map(slot => ({ slot }))),
    ...G.backstock.map(b => ({ b })),
  ].sort(() => Math.random() - 0.5);
  const names = owned.slice(0, Math.ceil(owned.length * itemFrac)).map(t => {
    const id = t.slot ? t.slot.item.id : t.b.id;
    if (t.slot) setSlotItem(t.slot, null);
    else G.backstock.splice(G.backstock.indexOf(t.b), 1);
    return itemById(id).name;
  });
  const cash = Math.round(G.money * moneyFrac);
  G.money -= cash;
  return { names, cash };
}

// Called when the last customer leaves after 6 PM. Returns a summary for the UI.
export function endDay() {
  const s = { ...G.stats, day: G.day, trust: G.trust, clean: G.clean, event: G.shopEvent, report: G.dayStats };
  G.dayStats = {};
  G.history.push({ day: G.day, sales: G.stats.sales + (G.stats.eggs || 0), spent: G.stats.spent, trust: +G.trust.toFixed(3), clean: Math.round(G.clean) });
  if (G.history.length > 60) G.history.shift();
  G.life.days++;
  s.interest = Math.round(G.debt * INTEREST);
  G.debt += s.interest;
  if (G.day % 7 === 0) {
    s.weekCheck = true;
    s.missed = dueRemaining() > 0;
    if (s.missed) {
      s.strike = ++G.strikes;
      if (G.strikes >= 3) s.gameOver = true;
      else s.irs = G.strikes === 1 ? seize(0.25, 0.15) : seize(0.6, 0.4);
    }
    G.paidWeek = 0;
  }
  G.day++;
  G.stats = freshStats();
  rollMarket();
  return s;
}
