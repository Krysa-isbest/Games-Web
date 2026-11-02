import * as THREE from 'three';
import { G, ACTIONS, pick, rand } from './state.js';
import { ITEMS, itemById, makeItemMesh, makeInst } from './data.js';
import { makePerson, animatePerson, poseArms } from './people.js';
import { SHELF_TYPES, shelfFront, setSlotItem } from './shelves.js';
import { marketPrice, value, trustMult, addTrust } from './economy.js';
import { spawnTrash } from './trash.js';
import { act, tell } from './net.js';
import { checkout } from './register.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

// mult = how much over the item's worth a buyer will pay; ask/min = what a seller asks / will accept (x worth).
const TYPES = [
  { name: 'Bargain hunter', mult: 0.95, patience: 2, ask: 1.0, min: 0.55 },
  { name: 'Regular', mult: 1.15, patience: 3, ask: 0.85, min: 0.45 },
  { name: 'Rich guy', mult: 1.5, patience: 4, ask: 1.1, min: 0.7 },
  { name: 'Clueless', mult: 1.3, patience: 5, ask: 0.6, min: 0.3 },
  { name: 'Desperate', mult: 1.05, patience: 3, ask: 0.55, min: 0.25 },
  { name: 'Collector', mult: 1.35, patience: 3, ask: 1.15, min: 0.75 },
];
const REG = new THREE.Vector3(-4.5, 0, 1.0);
const DOOR_IN = new THREE.Vector3(0, 0, 3.6);
const DOOR_OUT = new THREE.Vector3(0, 0, 6.3);
const SELL_POOL = ITEMS.filter(i => !['big', 'food', 'car', 'scrap', 'weapon'].includes(i.cat));
const WEAPON_POOL = ITEMS.filter(i => i.weapon);
let nextCid = 1;

function iconSprite(emoji) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff8e8'; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
  g.font = '34px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.setScalar(0.3); s.position.y = 2.15; s.visible = false;
  return s;
}

function hold(c, id) {
  dropHeld(c);
  const h = makeItemMesh(itemById(id));
  h.position.set(0, 0.95, 0.32);
  h.traverse(o => o.userData.customer = c);
  c.mesh.add(h);
  c.held = h; c.heldId = id;
}
function dropHeld(c) { if (c.held) { c.mesh.remove(c.held); c.held = null; c.heldId = null; } }

// Creates the visible customer (host and guests use the same function, so the seed gives the same look).
export function makeCustomerMesh(c) {
  c.mesh = makePerson({ seed: c.seed });
  c.icon = iconSprite(c.seller ? '💰' : '🛒');
  c.mesh.add(c.icon);
  c.mesh.traverse(o => o.userData.customer = c);
  G.scene.add(c.mesh);
}

function spawn() {
  const type = pick(TYPES), seller = Math.random() < 0.32;
  const side = Math.random() < 0.5 ? -1 : 1;
  const c = { cid: nextCid++, seed: Math.random() * 1e9 | 0, type, seller, state: 'enter', wait: 0, qt: 0, patience: type.patience, t: 0 };
  makeCustomerMesh(c);
  c.mesh.position.set(side * 14, 0, 6.8);
  c.path = [new THREE.Vector3(side * 2, 0, 6.8), DOOR_OUT.clone()];
  if (seller) {
    const weapon = Math.random() < 0.08;
    const def = pick(weapon ? WEAPON_POOL : SELL_POOL);
    const fake = !weapon && ['jewel', 'antique', 'collect', 'music'].includes(def.cat) && Math.random() < (['Clueless', 'Desperate'].includes(type.name) ? 0.22 : 0.1);
    c.inst = makeInst(def.id, { q: rand(0.5, 1.2), broken: Math.random() < 0.12, fake });
    const worth = Math.round(marketPrice(def.id) * c.inst.q * (c.inst.broken ? 0.3 : 1)); // what the seller thinks it's worth
    c.offer = Math.max(1, Math.round(worth * type.ask * rand(0.9, 1.1)));
    c.min = Math.max(1, Math.round(worth * type.min * rand(0.9, 1.1)));
    c.say = weapon ? pick(['Got this from my uncle. You buy guns, right?', 'No questions asked, okay?', 'Need it gone. Today.'])
      : pick(['Wanna buy this?', 'I need cash, quick.', 'Found this in my grandma\'s attic.', 'What will you give me for this?', 'It\'s real, I swear.']);
    hold(c, def.id);
  }
  G.customers.push(c);
  sfx.bell();
}

function leave(c, angry) {
  if (c.state === 'leave') return;
  if (angry) addTrust(-0.005);
  c.state = 'leave';
  c.servedBy = null;
  const side = Math.random() < 0.5 ? -1 : 1;
  c.path = c.mesh.position.z > 5 ? [new THREE.Vector3(side * 16, 0, 6.8)] : [DOOR_IN.clone(), DOOR_OUT.clone(), new THREE.Vector3(side * 16, 0, 6.8)];
}

function arrive(c) {
  if (c.state === 'enter') {
    if (c.mesh.position.z > 5) { // at the front door, outside
      if (!G.doorOpen) { if (Math.random() < 0.5) UI.toast('A customer found the door closed and walked away.'); return leave(c); }
      c.path = [DOOR_IN.clone()];
      return;
    }
    if (c.seller) { c.state = 'queue'; return; }
    const stocked = G.shelves.filter(s => s !== G.carry && s.userData.slots.some(x => x.item));
    if (!stocked.length) { UI.toast('A customer left: your shelves are empty!', 'bad'); return leave(c); }
    c.shelf = pick(stocked);
    c.state = 'toShelf';
    c.path = [shelfFront(c.shelf)];
  } else if (c.state === 'toShelf') {
    c.state = 'browse';
    c.wait = rand(1.5, 3.5);
  } else if (c.state === 'leave') {
    G.scene.remove(c.mesh);
    G.customers.splice(G.customers.indexOf(c), 1);
  }
}

function browse(c) {
  const filled = c.shelf.userData.slots.filter(s => s.item);
  if (!filled.length) return leave(c);
  const dirt = Math.min(G.trash.length, 8);
  if (dirt >= 5 && Math.random() < 0.3) { UI.toast('A customer left: "This place is filthy!"', 'bad'); return leave(c, true); }
  const slot = pick(filled), inst = slot.item;
  const bonus = SHELF_TYPES[c.shelf.userData.type].bonus;
  c.max = Math.round(value(inst) * c.type.mult * bonus * trustMult() * (1 - dirt * 0.04) * rand(0.9, 1.1));
  if (inst.price > c.max * 1.6) { UI.toast(`A customer thought the ${itemById(inst.id).name} was way too expensive.`); return leave(c); }
  c.inst = inst;
  c.slot = slot;
  setSlotItem(slot, null);
  hold(c, inst.id);
  // a fair tag gets paid; otherwise they offer less and you can haggle
  c.offer = inst.price <= c.max * 0.85 ? inst.price : Math.round(Math.min(inst.price, c.max * rand(0.7, 0.88)));
  if (c.offer === inst.price && Math.random() < 0.35) c.offer = Math.max(1, Math.round(inst.price * rand(0.8, 0.95))); // "would you take a bit less?"
  c.say = c.offer < inst.price ? pick(['Would you take a bit less?', 'How about this?', 'I\'ll give you this much.', 'Is that your best price?'])
    : pick(['I\'d like to buy this.', 'I\'ll take it.', 'Ring me up.']);
  c.state = 'queue';
}

function returnItem(c) {
  if (!c.inst || c.seller) return;
  if (c.slot && !c.slot.item && G.shelves.includes(c.slot.shelf)) setSlotItem(c.slot, c.inst);
  else G.backstock.push(c.inst);
  c.inst = null;
  dropHeld(c);
}

export function updateCustomers(dt) {
  if (G.phase === 'open' && G.customers.length < 5) {
    G.spawnT -= dt;
    if (G.spawnT <= 0) { spawn(); G.spawnT = rand(8, 16) / (1 + G.trust * 0.5); }
  }
  const queue = G.customers.filter(c => c.state === 'queue');
  for (const c of [...G.customers]) {
    const m = c.mesh;
    c.icon.visible = c.state === 'queue';
    if (c.state === 'queue') {
      c.path = [REG.clone().add(new THREE.Vector3(0, 0, -queue.indexOf(c) * 0.9))];
      if (!c.servedBy && (c.qt += dt) > 80) { UI.toast('A customer got tired of waiting and left.', 'bad'); returnItem(c); leave(c, true); continue; }
    }
    if (c.state === 'browse' && (c.wait -= dt) <= 0) browse(c);
    const tgt = c.path[0];
    let walking = false;
    if (tgt) {
      const d = tgt.clone().sub(m.position); d.y = 0;
      const dist = d.length();
      if (dist > 0.05) {
        m.position.addScaledVector(d.normalize(), Math.min(dist, 1.5 * dt));
        m.rotation.y = Math.atan2(d.x, d.z);
        walking = true;
      } else if (c.state === 'queue') {
        m.rotation.y = 0;
      } else {
        c.path.shift();
        if (!c.path.length) arrive(c);
      }
    }
    if (walking && c.state !== 'leave' && Math.random() < dt * 0.02 && Math.abs(m.position.x) < 6.5 && Math.abs(m.position.z) < 4.5) {
      spawnTrash(m.position.x + rand(-0.3, 0.3), m.position.z + rand(-0.3, 0.3));
    }
    c.walking = walking;
    c.t += walking ? dt * 8 : 0;
    animatePerson(m, c.t, walking);
    if (c.held && !walking) poseArms(m, -0.9, -0.5);
  }
}

export const isFirstInQueue = c => c.state === 'queue' && G.customers.find(x => x.state === 'queue') === c
  && c.mesh.position.distanceTo(REG) < 0.3;
export const customerById = cid => G.customers.find(c => c.cid === cid);

// ---------- co-op snapshot of customers ----------
export const customerSnap = () => G.customers.map(c => [c.cid, c.seed, +c.mesh.position.x.toFixed(2), +c.mesh.position.z.toFixed(2), +c.mesh.rotation.y.toFixed(2),
  c.walking ? 1 : 0, c.heldId || 0, c.state === 'queue' ? (c.seller ? 2 : 1) : 0]);

export function mirrorCustomers(list, dt) {
  const seen = new Set();
  for (const [cid, seed, x, z, ry, walking, heldId, q] of list) {
    seen.add(cid);
    let c = customerById(cid);
    if (!c) {
      c = { cid, seed, seller: q === 2, t: 0, state: 'mirror' };
      makeCustomerMesh(c);
      c.mesh.position.set(x, 0, z);
      G.customers.push(c);
    }
    c.tgt = [x, z, ry]; c.walking = !!walking; c.state = q ? 'queue' : 'mirror';
    if ((heldId || null) !== (c.heldId || null)) heldId ? hold(c, heldId) : dropHeld(c);
    c.icon.visible = !!q;
  }
  for (const c of [...G.customers]) if (!seen.has(c.cid)) { G.scene.remove(c.mesh); G.customers.splice(G.customers.indexOf(c), 1); }
  void dt;
}
export function lerpCustomers(dt) {
  const k = Math.min(1, dt * 10);
  for (const c of G.customers) if (c.tgt) {
    const m = c.mesh;
    m.position.x += (c.tgt[0] - m.position.x) * k; m.position.z += (c.tgt[1] - m.position.z) * k;
    m.rotation.y = c.tgt[2];
    c.t += c.walking ? dt * 8 : 0;
    animatePerson(m, c.t, c.walking);
    if (c.held && !c.walking) poseArms(m, -0.9, -0.5);
  }
}

// ---------- magnifier ----------
const MAG = [null, { err: 0.35, fake: 0.4 }, { err: 0.15, fake: 0.75 }, { err: 0.05, fake: 1 }];
export function estimate(inst) {
  const t = MAG[G.tools.magnifier];
  if (!t) return null;
  const seesFake = Math.random() < t.fake;
  const truth = inst.fake && seesFake ? value(inst) : Math.round(marketPrice(inst.id) * inst.q * (inst.broken ? 0.3 : 1));
  const c = truth * rand(1 - t.err * 0.5, 1 + t.err * 0.5);
  inst.est = { lo: Math.max(1, Math.round(c * (1 - t.err))), hi: Math.max(1, Math.round(c * (1 + t.err))), fake: inst.fake && seesFake, real: !inst.fake && seesFake, tier: G.tools.magnifier };
  return inst.est;
}

// ---------- actions (run on the host) ----------
function info(c) {
  const def = itemById(c.inst.id);
  return { cid: c.cid, inst: c.inst, seller: c.seller, type: c.type.name, say: c.say, patience: c.patience, maxPatience: c.type.patience,
    offer: c.offer, tag: c.inst.price, weapon: !!def.weapon };
}
ACTIONS.serveStart = (pid, cid) => {
  const c = customerById(cid);
  if (!c || !isFirstInQueue(c)) return null;
  if (c.servedBy && c.servedBy !== pid) return { busy: true };
  c.servedBy = pid; c.qt = 0;
  return info(c);
};
ACTIONS.serveStop = (pid, cid) => { const c = customerById(cid); if (c?.servedBy === pid) c.servedBy = null; };
ACTIONS.inspectCustomer = (pid, cid) => { const c = customerById(cid); if (c?.inst) estimate(c.inst); return c ? info(c) : null; };

ACTIONS.haggle = (pid, cid, a, v) => {
  const c = customerById(cid);
  if (!c || c.servedBy !== pid) return { res: 'gone' };
  const def = itemById(c.inst.id);
  if (a === 'refuse') { tell(pid, 'The customer left.'); returnItem(c); leave(c); return { res: 'refused' }; }
  if (c.seller && def.weapon && !G.up.permit) { tell(pid, 'You need a gun permit to buy weapons.', 'bad'); return { res: 'counter', info: info(c) }; }
  const deal = price => {
    if (c.seller) {
      if (G.money < price) { tell(pid, 'You don\'t have enough money!', 'bad'); return { res: 'counter', info: info(c) }; }
      G.money -= price; G.stats.spent += price;
      G.backstock.push(c.inst);
      addTrust(0.002);
      dropHeld(c);
      sfx.cash(); tell(pid, `Bought ${def.name} for ${UI.money(price)}. It's in the stock crates.`);
      c.inst = null;
      leave(c);
      return { res: 'deal', seller: true, price };
    }
    c.agreed = price;
    return { res: 'deal', seller: false, price };
  };
  if (a === 'accept') return deal(c.offer);
  if (c.seller ? v >= c.offer : v <= c.offer) return deal(c.seller ? c.offer : v);
  if (c.seller ? v >= c.min : v <= c.max) { tell(pid, '"Deal!"'); return deal(v); }
  if (--c.patience <= 0) { tell(pid, '"Forget it, I\'m out!"', 'bad'); returnItem(c); leave(c, true); return { res: 'leave' }; }
  c.offer = Math.round(c.offer + ((c.seller ? c.min : c.max) - c.offer) * 0.45);
  c.say = pick(c.seller
    ? ['Come on, it\'s worth more than that.', 'That\'s an insult.', 'Fine… I can go a little lower.']
    : ['Come on, be reasonable.', 'That\'s too much, man.', 'How about this?', 'I\'ve seen it cheaper online.']);
  return { res: 'counter', info: info(c) };
};

ACTIONS.completeSale = (pid, cid, lost, tip) => {
  const c = customerById(cid);
  if (!c || !c.agreed) return false;
  const price = c.agreed, def = itemById(c.inst.id);
  G.money += price + tip - lost; G.stats.sales += price + tip; G.stats.sold++;
  G.xp += Math.round(price / 10);
  addTrust(price <= value(c.inst) * 1.15 ? 0.006 : 0.004);
  dropHeld(c);
  sfx.cash();
  tell(pid, `Sold ${def.name} for ${UI.money(price)}${tip ? ` (+${UI.money(tip)} tip)` : ''}!`);
  c.inst = null; c.agreed = 0;
  leave(c);
  return true;
};

// ---------- the bargaining panel (runs on whoever serves) ----------
export async function serve(cid) {
  const i = await act('serveStart', cid);
  if (!i) return;
  if (i.busy) return UI.toast('A teammate is already serving this customer.');
  bargain(i);
}

function bargain(i) {
  const def = itemById(i.inst.id);
  const mkt = marketPrice(def.id);
  const lines = [`Today's market price: <b>${UI.money(mkt)}</b> <span class="dim">(average condition)</span>`, UI.estText(i.inst)];
  if (!i.seller) lines.unshift(`Your tag price: <b>${UI.money(i.tag)}</b>`);
  if (i.weapon && i.seller && !G.up.permit) lines.push('<span class="down">🔫 You need a gun permit to buy weapons (computer → Upgrades).</span>');
  const base = { icon: def.icon, title: def.name, say: i.say, patience: i.patience, maxPatience: i.maxPatience, offer: i.offer, lines,
    inspect: G.tools.magnifier > 0 && !i.inst.est };
  UI.bargainPanel(i.seller
    ? { ...base, who: `${i.type} · wants to SELL`, offerLabel: 'They ask', counterLabel: 'Your offer', canAccept: !(i.weapon && !G.up.permit),
      counterDefault: Math.round(i.offer * 0.7), acceptLabel: `Pay ${UI.money(i.offer)}`, refuseLabel: 'No thanks' }
    : { ...base, who: `${i.type} · wants to BUY`, offerLabel: 'They offer', counterLabel: 'Your price', counterDefault: i.tag,
      acceptLabel: `Accept ${UI.money(i.offer)}`, refuseLabel: 'Refuse' },
  async (a, v) => {
    if (a === 'wait') { act('serveStop', i.cid); return UI.closePanel(); }
    if (a === 'inspect') { const n = await act('inspectCustomer', i.cid); return n ? bargain(n) : UI.closePanel(); }
    const r = await act('haggle', i.cid, a, v);
    if (!r || r.res === 'gone' || r.res === 'leave' || r.res === 'refused') { UI.closePanel(); return UI.hud(); }
    if (r.res === 'counter') return bargain(r.info);
    if (r.res === 'deal' && r.seller) { UI.closePanel(); return UI.hud(); }
    if (r.res === 'deal') {
      const res = await checkout(r.price, i.inst);
      await act('completeSale', i.cid, res.lost, res.tip);
      G.relock(); UI.hud();
    }
  });
}

// When a player leaves mid-service, free the customer.
export function releaseServed(pid) { for (const c of G.customers) if (c.servedBy === pid) c.servedBy = null; }
