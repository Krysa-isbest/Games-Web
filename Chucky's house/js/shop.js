// Shop actions (run on the host for whoever did them) + the computer's catalogue.
import * as THREE from 'three';
import { G, ACTIONS, ensurePlayer, newUid, clamp } from './state.js';
import { itemById, makeInst } from './data.js';
import { DECOR, updateDecor } from './decor.js';
import { addJob, perk, trashCap } from './jobs.js';
import { SHELF_TYPES, makeShelf, placeShelf, setSlotItem, shelfBySid } from './shelves.js';
import { removeTrash, trashById } from './trash.js';
import { updateBin, updateSign, updateWorld } from './world.js';
import { updateCoop } from './chickens.js';
import { pay, dueRemaining, marketPrice, BIG_BUY, bidStep, value } from './economy.js';
import { estimate } from './customers.js';
import { NET, tell, broadcast, online } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

// ---------- catalogue ----------
// kind: tool (own once) · gear (consumable, +n) · weapon (own once, may give ammo) · shelf · up (upgrade)
export const CATALOG = {
  tools: [
    { id: 'flashlight', kind: 'tool', icon: '🔦', name: 'Flashlight', cost: 250, desc: 'Your main light at night (F). 2 minutes per battery.' },
    { id: 'battery', kind: 'gear', icon: '🔋', name: 'Batteries ×2', cost: 40, n: 2, desc: '2 more minutes of light each. Swapped in automatically.' },
    { id: 'radio', kind: 'tool', icon: '📻', name: 'Walkie-talkies', cost: 450, desc: 'Hold B to talk to the whole team from anywhere (radio voice).' },
    { id: 'screwdriver', kind: 'tool', icon: '🪛', name: 'Screwdriver Set', cost: 380, desc: 'Take apart arcade cabinets and AC units (X). Motorbikes need the wrench too.' },
    { id: 'wrench', kind: 'tool', icon: '🔧', name: 'Wrench Set', cost: 650, desc: 'Unbolt generators and engines. With the screwdriver: motorbikes.' },
    { id: 'crowbar', kind: 'tool', icon: '🪝', name: 'Crowbar', cost: 500, desc: 'Pry open locked crates and car trunks: better loot inside.' },
    { id: 'bandage', kind: 'gear', icon: '🩹', name: 'Bandage', cost: 120, n: 1, desc: 'Heals 50 HP, or gets a downed teammate back up.' },
    { id: 'trap', kind: 'gear', icon: '🪤', name: 'Bear Trap', cost: 90, n: 1, desc: 'Holds an enemy in place for a few seconds.' },
    { id: 'mine', kind: 'gear', icon: '💣', name: 'Landmine', cost: 180, n: 1, desc: 'Blows up anything close. Including you.' },
    { id: 'duck', kind: 'stock', icon: '🦆', name: 'Rubber Duck', cost: 5, desc: 'Goes to the stock crates. Squeaks when it bounces. Throw it at a friend.' },
  ],
  weapons: [
    { id: 'bat', kind: 'weapon', icon: '🏏', name: 'Baseball Bat', cost: 300, desc: 'Melee, lethal. Hits 2.5× harder than fists.' },
    { id: 'baton', kind: 'weapon', icon: '🦯', name: 'Police Baton', cost: 700, desc: 'Melee, non-lethal: stuns. Stuns are shorter on high skull nights.' },
    { id: 'pepper', kind: 'weapon', icon: '🌶️', name: 'Pepper Spray', cost: 550, give: { pepper: 4 }, desc: 'Short cone, stuns everything in it. 4 charges included.' },
    { id: 'pepperRefill', kind: 'gear', gear: 'pepper', n: 4, needs: 'pepper', icon: '🌶️', name: 'Pepper Refill ×4', cost: 120, desc: 'More pepper spray.' },
    { id: 'taser', kind: 'weapon', icon: '⚡', name: 'Taser', cost: 1200, give: { taser: 3 }, desc: 'Ranged (8 m) stun, the longest one. 3 cartridges included.' },
    { id: 'taserCart', kind: 'gear', gear: 'taser', n: 3, needs: 'taser', icon: '⚡', name: 'Taser Cartridges ×3', cost: 150, desc: 'One shot each.' },
    { id: 'revolver', kind: 'weapon', permit: true, icon: '🔫', name: 'Revolver', cost: 3200, give: { ammo9: 12 }, desc: 'Lethal. LOUD: everything nearby hears it. 12 rounds included.' },
    { id: 'ammo9', kind: 'gear', gear: 'ammo9', n: 12, needs: 'revolver', permit: true, icon: '🔹', name: 'Revolver Rounds ×12', cost: 160, desc: '' },
    { id: 'shotgun', kind: 'weapon', permit: true, icon: '🎯', name: 'Pump Shotgun', cost: 5200, give: { shells: 8 }, desc: 'Lethal at close range. Very loud. 8 shells included.' },
    { id: 'shells', kind: 'gear', gear: 'shells', n: 8, needs: 'shotgun', permit: true, icon: '🔸', name: 'Shotgun Shells ×8', cost: 200, desc: '' },
  ],
  upgrades: [
    ...Object.entries(SHELF_TYPES).map(([id, t]) => ({ id, kind: 'shelf', icon: { wood: '🪵', metal: '🗄️', glass: '🔲', pedestal: '🏛️' }[id], name: t.name, cost: t.cost, desc: t.desc })),
    { id: 'bin', kind: 'up', icon: '🗑️', name: 'Bigger Trash Bin', cost: 150, desc: 'Holds 10 pieces of trash instead of 5.', owned: () => G.up.binCap >= 10, apply: () => { G.up.binCap = 10; updateBin(); } },
    { id: 'mag1', kind: 'up', icon: '🔍', name: 'Magnifier', cost: 180, desc: 'Estimate an item\'s worth (±35%). Sometimes spots fakes.', owned: () => G.tools.magnifier >= 1, apply: () => { G.tools.magnifier = 1; } },
    { id: 'mag2', kind: 'up', icon: '🔎', name: 'Jeweller\'s Loupe', cost: 700, desc: 'Better estimates (±15%). Spots most fakes.', req: () => G.tools.magnifier >= 1, owned: () => G.tools.magnifier >= 2, apply: () => { G.tools.magnifier = 2; } },
    { id: 'mag3', kind: 'up', icon: '🔬', name: 'Appraisal Kit', cost: 1900, desc: 'Near exact (±5%). Spots every fake.', req: () => G.tools.magnifier >= 2, owned: () => G.tools.magnifier >= 3, apply: () => { G.tools.magnifier = 3; } },
    { id: 'bag', kind: 'up', icon: '🎒', name: 'Bigger Backpack', cost: 800, desc: 'Carry 6 slots instead of 4 at night.', owned: () => G.up.bag >= 6, apply: () => { G.up.bag = 6; } },
    { id: 'bag2', kind: 'up', icon: '🎒', name: 'Hiking Backpack', cost: 1600, desc: '8 slots.', req: () => G.up.bag >= 6, owned: () => G.up.bag >= 8, apply: () => { G.up.bag = 8; } },
    { id: 'permit', kind: 'up', icon: '📜', name: 'Gun Permit', cost: 1500, desc: 'Lets you buy and sell weapons (customers, shelves and the Weapons app).', owned: () => G.up.permit, apply: () => { G.up.permit = true; } },
    { id: 'workshop', kind: 'up', icon: '🛠️', name: 'Workshop (back room)', cost: 2500, desc: 'Rent the room behind the shop. Repair broken items at the bench.', owned: () => G.up.workshop, apply: () => { G.up.workshop = true; updateWorld(); } },
    { id: 'coop', kind: 'up', icon: '🐔', name: 'Chicken Coop + 3 Hens', cost: 900, desc: 'In the yard. Hens lay eggs; your first egg opens the food stand window.', owned: () => G.up.coop, apply: () => { G.up.coop = true; G.up.chickens = 3; updateCoop(); } },
    { id: 'chicken', kind: 'up', icon: '🐓', name: 'One More Hen', cost: 150, desc: 'More eggs. Up to 8 hens.', req: () => G.up.coop, owned: () => G.up.chickens >= 8, apply: () => { G.up.chickens++; updateCoop(); } },
    { id: 'register2', kind: 'up', icon: '🧾', name: 'Second Register', cost: 1800, desc: 'A second till on the counter with its own queue: two cashiers in rush hour.', owned: () => G.up.register2, apply: () => { G.up.register2 = true; updateWorld(); } },
    { id: 'truckBed', kind: 'up', icon: '🛻', name: 'Truck: Longer Bed', cost: 1400, desc: 'A longer truck bed: more room for loot and big objects.', owned: () => G.up.truckBed, apply: () => { G.up.truckBed = true; } },
    { id: 'truckQuiet', kind: 'up', icon: '🤫', name: 'Truck: Quiet Engine', cost: 900, desc: 'Without it, the idling engine draws enemies while someone sits in the cab.', owned: () => G.up.truckQuiet, apply: () => { G.up.truckQuiet = true; } },
    { id: 'truckLights', kind: 'up', icon: '💡', name: 'Truck: Blinding Headlights', cost: 1100, desc: 'Dogs in the headlights are blinded and back off.', owned: () => G.up.truckLights, apply: () => { G.up.truckLights = true; } },
    { id: 'truckWinch', kind: 'up', icon: '🪝', name: 'Truck: Winch', cost: 1600, desc: 'Load big objects from up to 10 m away from the truck bed.', owned: () => G.up.truckWinch, apply: () => { G.up.truckWinch = true; } },
  ],
  decor: DECOR.map(d => ({ id: d.id, kind: 'decor', icon: d.icon, name: d.name, cost: d.cost, desc: `${d.desc} Trust grows +${Math.round(d.trust * 100)} % faster.` })),
};
export const catItem = (cat, id) => CATALOG[cat].find(x => x.id === id);
export const ownedText = it => it.kind === 'tool' ? G.tools[it.id] > 0 : it.kind === 'weapon' ? G.weapons[it.id] > 0 : it.kind === 'up' ? it.owned()
  : it.kind === 'decor' ? G.decor.includes(it.id) : false;

function doBuy(pid, cat, id, pos) {
  const it = catItem(cat, id);
  if (!it) return { ok: false };
  if (ownedText(it)) return { ok: false, msg: 'Already owned.' };
  if (it.req && !it.req()) return { ok: false, msg: 'Buy the previous upgrade first.' };
  if (it.needs && !G.weapons[it.needs]) return { ok: false, msg: 'You need the weapon first.' };
  if (it.permit && !G.up.permit) return { ok: false, msg: 'You need a gun permit (Upgrades).' };
  if (G.money < it.cost) return { ok: false, msg: 'Not enough money!' };
  G.money -= it.cost; G.stats.spent += it.cost;
  let sid = null;
  if (it.kind === 'tool') G.tools[it.id] = 1;
  else if (it.kind === 'gear') G.gear[it.gear || it.id] += it.n || 1;
  else if (it.kind === 'weapon') { G.weapons[it.id] = 1; for (const [k, n] of Object.entries(it.give || {})) G.gear[k] += n; }
  else if (it.kind === 'up') it.apply();
  else if (it.kind === 'decor') { G.decor.push(it.id); updateDecor(); }
  else if (it.kind === 'stock') G.backstock.push(makeInst(it.id, { q: 1 }));
  else if (it.kind === 'shelf') {
    const p = pos || { x: 0, z: 0 };
    sid = makeShelf(id, Math.round(p.x * 4) / 4, Math.round(p.z * 4) / 4, 0).userData.sid;
  }
  sfx.cash();
  G.save();
  return { ok: true, sid, msg: `Bought: ${it.name}` };
}

// Purchases from BIG_BUY up need a teammate's OK in co-op (so nobody buys a useless upgrade by accident).
ACTIONS.buy = (pid, cat, id, pos) => {
  const it = catItem(cat, id);
  if (!it) return { ok: false };
  const others = Object.keys(G.players).filter(p => p !== pid).length;
  if (online() && others > 0 && it.cost >= BIG_BUY) {
    if (G.money < it.cost) return { ok: false, msg: 'Not enough money!' };
    if (G.pending) return { ok: false, msg: 'Another purchase is waiting for approval.' };
    G.pending = { rid: newUid(), pid, cat, id, pos, cost: it.cost, name: it.name, who: G.players[pid]?.name || 'Someone', t: 30 };
    broadcast({ t: 'approve?', req: G.pending });
    NET.approvePrompt?.(G.pending);
    return { ok: false, waiting: true, msg: `Waiting for a teammate to approve (${it.name}).` };
  }
  return doBuy(pid, cat, id, pos);
};
ACTIONS.approve = (pid, rid, yes) => {
  const r = G.pending;
  if (!r || r.rid !== rid || r.pid === pid) return false;
  G.pending = null;
  broadcast({ t: 'approved', rid, yes }); NET.approveClose?.(rid);
  if (!yes) { tell(r.pid, `${G.players[pid]?.name || 'A teammate'} said NO to ${r.name}.`, 'bad'); return true; }
  const res = doBuy(r.pid, r.cat, r.id, r.pos);
  tell(r.pid, res.ok ? `Approved by ${G.players[pid]?.name}: ${r.name} bought!` : res.msg, res.ok ? '' : 'bad');
  if (res.ok && res.sid) NET.newShelf?.(r.pid, res.sid);
  return true;
};
export function pendingTick(dt) {
  if (!G.pending) return;
  if ((G.pending.t -= dt) <= 0) {
    tell(G.pending.pid, 'Nobody approved the purchase in time.', 'bad');
    broadcast({ t: 'approved', rid: G.pending.rid, yes: false }); NET.approveClose?.(G.pending.rid);
    G.pending = null;
  }
}

ACTIONS.buyDeal = (pid, i) => {
  const d = G.deals[i];
  if (!d) return false;
  if (G.money < d.cost) { tell(pid, 'Not enough money!', 'bad'); return false; }
  G.money -= d.cost; G.stats.spent += d.cost;
  G.backstock.push(d.inst); G.deals.splice(i, 1);
  sfx.cash(); tell(pid, `${itemById(d.inst.id).name} added to your stock crates.`);
  return true;
};

// ---------- holding items ----------
const P = pid => ensurePlayer(pid);
const slotOf = (sid, i) => shelfBySid(sid)?.userData.slots[i];
const defaultPrice = inst => Math.round(inst.est ? (inst.est.lo + inst.est.hi) / 2 * 1.2 : marketPrice(inst.id) * 1.2);

ACTIONS.takeFromShelf = (pid, sid, i) => {
  const p = P(pid), slot = slotOf(sid, i);
  if (p.holding || !slot?.item) return false;
  p.holding = { kind: 'item', inst: slot.item };
  setSlotItem(slot, null); sfx.pick();
  return true;
};
ACTIONS.putOnShelf = (pid, sid, i) => {
  const p = P(pid), slot = slotOf(sid, i), h = p.holding;
  if (h?.kind !== 'item' || !slot || slot.item) return false;
  const def = itemById(h.inst.id);
  if (def.weapon && !G.up.permit) { tell(pid, 'You need a gun permit to sell weapons.', 'bad'); return false; }
  if (def.big) { tell(pid, 'That is far too big for a shelf. Sell it from the stock crates via the computer (Market → sell to dealer).', 'bad'); return false; }
  h.inst.price ??= defaultPrice(h.inst);
  shelved(pid, h.inst);
  setSlotItem(slot, h.inst); p.holding = null; sfx.pick();
  return true;
};
// Stocking a shelf: job XP; floor-staff perks give trust (lv 4) and a quick estimate (lv 5).
function shelved(pid, inst) {
  addJob(pid, 'stocker', 3, 'placed');
  if (perk(pid, 'stocker') >= 4) G.trust = Math.min(1, G.trust + 0.001);
  if (perk(pid, 'stocker') >= 5 && !inst.est) { const m = G.tools.magnifier; G.tools.magnifier = Math.max(1, m); estimate(inst); G.tools.magnifier = m; }
}
ACTIONS.placeFromStock = (pid, sid, i, uid) => {
  const slot = slotOf(sid, i), k = G.backstock.findIndex(b => b.uid === uid);
  if (!slot || slot.item || k < 0) return false;
  const inst = G.backstock[k], def = itemById(inst.id);
  if (def.weapon && !G.up.permit) { tell(pid, 'You need a gun permit to sell weapons.', 'bad'); return false; }
  if (def.big) { tell(pid, 'Too big for a shelf.', 'bad'); return false; }
  G.backstock.splice(k, 1);
  inst.price ??= defaultPrice(inst);
  shelved(pid, inst);
  setSlotItem(slot, inst); sfx.pick();
  return true;
};
ACTIONS.takeFromStock = (pid, uid) => {
  const p = P(pid), k = G.backstock.findIndex(b => b.uid === uid);
  if (p.holding || k < 0) return false;
  p.holding = { kind: 'item', inst: G.backstock.splice(k, 1)[0] }; sfx.pick();
  return true;
};
ACTIONS.putInStock = pid => {
  const p = P(pid);
  if (p.holding?.kind !== 'item') return false;
  G.backstock.push(p.holding.inst); p.holding = null; sfx.thud(0.5);
  return true;
};
ACTIONS.throwHeld = (pid, pos, vel) => {
  const p = P(pid);
  if (p.holding?.kind !== 'item') return false;
  G.phys.add(p.holding.inst, new THREE.Vector3(...pos), new THREE.Vector3(...vel));
  p.holding = null; sfx.swing();
  return true;
};
ACTIONS.grabBody = (pid, uid) => {
  const p = P(pid), b = G.phys.find(uid);
  if (p.holding || !b) return false;
  G.phys.remove(b);
  p.holding = { kind: 'item', inst: b.inst }; sfx.pick();
  return true;
};
ACTIONS.setPrice = (pid, sid, i, price) => {
  const slot = slotOf(sid, i);
  if (!slot?.item) return false;
  slot.item.price = clamp(Math.round(price), 1, 999999);
  setSlotItem(slot, slot.item);
  G.tutFlags.price = true;
  addJob(pid, 'stocker', 1, 'tagged');
  return true;
};
ACTIONS.toStock = (pid, sid, i) => {
  const slot = slotOf(sid, i);
  if (!slot?.item) return false;
  G.backstock.push(slot.item); setSlotItem(slot, null); sfx.pick();
  return true;
};
ACTIONS.inspectItem = (pid, uid) => {
  const all = [...G.backstock, ...G.shelves.flatMap(s => s.userData.slots.map(x => x.item)).filter(Boolean), ...Object.values(G.players).map(p => p.holding?.inst).filter(Boolean)];
  const inst = all.find(x => x.uid === uid);
  if (!inst) return null;
  estimate(inst);
  return inst.est;
};
ACTIONS.moveShelf = (pid, sid, x, z, r) => {
  const s = shelfBySid(sid);
  if (!s) return false;
  placeShelf(s, x, z, r); sfx.thud();
  return true;
};

// ---------- trash ----------
ACTIONS.pickTrash = (pid, tid) => {
  const p = P(pid), h = p.holding, t = trashById(tid);
  if (!t || (h && h.kind !== 'trash') || h?.n >= trashCap(pid)) return false;
  removeTrash(t);
  p.holding = { kind: 'trash', n: (h?.n || 0) + 1 }; sfx.pick();
  addJob(pid, 'cleaner', 2, 'trash');
  G.life.cleaned++;
  return true;
};
ACTIONS.useBin = pid => {
  const p = P(pid), h = p.holding;
  if (h?.kind === 'trash') {
    const n = Math.min(h.n, G.up.binCap - G.binCount);
    if (!n) { tell(pid, 'The bin is full! Take the bag out first.', 'bad'); return false; }
    G.binCount += n; h.n -= n;
    if (!h.n) p.holding = null;
    sfx.thud();
    G.tutFlags.bin = true;
    if (G.binCount >= G.up.binCap) tell(pid, 'The bin is full. Take the bag to the dumpster out back.');
  } else if (!h && G.binCount > 0) {
    G.binCount = 0; p.holding = { kind: 'bag' }; sfx.pick();
  } else return false;
  updateBin();
  return true;
};
ACTIONS.dumpster = pid => {
  const p = P(pid);
  if (p.holding?.kind !== 'bag') return false;
  p.holding = null; sfx.thud(); tell(pid, 'Trash taken out. Nice!');
  addJob(pid, 'cleaner', 5, 'bags');
  return true;
};

// ---------- door, store, night ----------
ACTIONS.door = pid => {
  G.doorOpen = !G.doorOpen; sfx.door();
  updateWorld();
  tell(pid, G.doorOpen ? 'Door open: customers can come in.' : 'Door closed: no new customers.');
  return G.doorOpen;
};
ACTIONS.openStore = pid => {
  if (G.phase !== 'prep') return false;
  if (G.intro !== 'done') { tell(pid, 'Get the lights on and read Chuck\'s note first.', 'bad'); return false; }
  G.phase = 'open'; G.spawnT = 3;
  updateSign(); sfx.bell();
  broadcast({ t: 'say', text: 'The store is OPEN!' }); NET.toast('The store is OPEN!');
  void pid;
  return true;
};

// ---------- workshop ----------
// score 0..1 from the repair minigame.
ACTIONS.repair = (pid, uid, score) => {
  const inst = G.backstock.find(b => b.uid === uid);
  if (!inst?.broken) return null;
  const before = value(inst);
  inst.broken = false;
  inst.q = +clamp(inst.q * (0.75 + score * 0.4), 0.3, 1.3).toFixed(2);
  inst.est = null;
  const after = value(inst);
  tell(pid, `Repaired ${itemById(inst.id).name}: worth about ${UI.money(before)} → ${UI.money(after)}.`);
  addJob(pid, 'stocker', 10, 'repaired');
  sfx.ratchet();
  return { before, after };
};

// ---------- bank / big items / auction ----------
ACTIONS.payLoan = (pid, kind, amt) => {
  const n = kind === 'due' ? pay(dueRemaining()) : kind === 'all' ? (G.money >= G.debt ? pay(G.debt) : 0) : pay(amt);
  if (!n) { tell(pid, kind === 'all' ? `You need ${UI.money(G.debt)} to pay it all off.` : 'Not enough money!', 'bad'); return 0; }
  sfx.cash(); tell(pid, `Paid ${UI.money(n)} to the bank.`);
  if (G.debt <= 0) { broadcast({ t: 'win' }); G.win(); }
  return n;
};
// Big objects (motorbike, arcade...) can't go on shelves: sell them to a dealer for 85 % of their worth.
ACTIONS.sellToDealer = (pid, uid) => {
  const k = G.backstock.findIndex(b => b.uid === uid);
  if (k < 0) return 0;
  const inst = G.backstock.splice(k, 1)[0], v = Math.round(value(inst) * 0.85);
  G.money += v; G.stats.sales += v; G.stats.sold++;
  sfx.cash(); tell(pid, `Sold ${itemById(inst.id).name} to a dealer for ${UI.money(v)}.`);
  return v;
};
ACTIONS.auctionStart = () => { if (G.auction && !G.auction.started && G.auction.cur < G.auction.lots.length) { G.auction.started = true; sfx.gavel(); } return true; };
ACTIONS.auctionBid = pid => {
  const lot = G.auction?.lots[G.auction.cur];
  if (!lot || lot.state !== 'live') return false;
  if (lot.leader && lot.leader !== 'npc') { tell(pid, 'Your team already has the top bid.'); return false; }
  const next = lot.leader ? lot.bid + bidStep(lot) : lot.bid;
  if (G.money < next) { tell(pid, 'You can\'t afford that bid.', 'bad'); return false; }
  lot.bid = next; lot.leader = pid; lot.t = Math.max(lot.t, 8); lot.npcT = 1 + Math.random() * 3;
  sfx.click();
  return true;
};
