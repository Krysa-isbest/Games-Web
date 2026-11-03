import * as THREE from 'three';
import { G, ACTIONS, pick, rand } from './state.js';
import { ITEMS, itemById, makeItemMesh, makeInst } from './data.js';
import { makePerson, animatePerson, poseArms, nameTag } from './people.js';
import { SHELF_TYPES, shelfFront, setSlotItem } from './shelves.js';
import { marketPrice, value, trustMult, addTrust, gainTrust } from './economy.js';
import { spawnTrash } from './trash.js';
import { spawnSpill, cleanMult } from './mess.js';
import { spawnDelay, messMult, maxCustomers, isEvent, HOT_ITEMS } from './events.js';
import { pickRegular, moodType, moodLine, moodWord, rateDeal, regularByName, inspectShop, alert } from './social.js';
import { addJob, perk, myPerk } from './jobs.js';
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
// Two registers once the second one is bought. Each has its own queue.
const REGS = [new THREE.Vector3(-4.5, 0, 1.0), new THREE.Vector3(-3.35, 0, 1.0)];
const DOOR_IN = new THREE.Vector3(0, 0, 3.6);
const DOOR_OUT = new THREE.Vector3(0, 0, 6.3);
const NO_SELL = ['big', 'food', 'car', 'scrap', 'weapon', 'fun', 'story', 'cash'];
const SELL_POOL = ITEMS.filter(i => !NO_SELL.includes(i.cat));
const WEAPON_POOL = ITEMS.filter(i => i.weapon);
let nextCid = 1;
const sprites = {};

function iconTex(emoji) {
  return sprites[emoji] ??= (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = emoji === '❗' ? '#ff5a4a' : '#fff8e8'; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
    g.font = '34px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
}
function setIcon(c, e) {
  if (c.iconE === e) return;
  c.iconE = e;
  c.icon.visible = !!e;
  if (e) { c.icon.material.map = iconTex(e); c.icon.material.needsUpdate = true; }
}
const iconFor = c => c.state === 'flee' ? '❗' : c.detective ? '🕵️' : c.help > 0 && !c.helped ? '🙋' : c.state === 'queue' ? (c.seller ? '💰' : '🛒') : '';

function hold(c, id) {
  dropHeld(c);
  const h = makeItemMesh(itemById(id));
  h.position.set(0, 0.95, 0.32);
  h.traverse(o => o.userData.customer = c);
  c.mesh.add(h);
  c.held = h; c.heldId = id;
}
function dropHeld(c) { if (c.held) { c.mesh.remove(c.held); c.held = null; c.heldId = null; } }
function coffeeCup(c, on) {
  if (on && !c.cup) {
    c.cup = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0xf4f1e6, flatShading: true }));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.015, 8), new THREE.MeshStandardMaterial({ color: 0x2a1a10 }));
    lid.position.y = 0.065; c.cup.add(m, lid);
    c.cup.position.set(0, -0.62, 0.04);
    c.mesh.userData.arms[1].el.add(c.cup);
  }
  if (!on && c.cup) { c.cup.parent?.remove(c.cup); c.cup = null; }
}

// Creates the visible customer (host and guests use the same function, so the seed gives the same look).
export function makeCustomerMesh(c) {
  c.mesh = makePerson({ seed: c.seed, ...(c.detective ? { player: 0x5a4a3a } : {}) });
  c.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex('🛒'), depthTest: false }));
  c.icon.scale.setScalar(0.3); c.icon.position.y = 2.15; c.icon.visible = false;
  c.mesh.add(c.icon);
  if (c.reg) { const t = nameTag(c.reg, '#9fe0ff'); t.position.y = 2.45; t.scale.multiplyScalar(0.8); c.mesh.add(t); }
  c.mesh.traverse(o => o.userData.customer = c);
  G.scene.add(c.mesh);
}

function spawn(detective = false) {
  const reg = detective ? null : pickRegular();
  let type = pick(TYPES), seller = Math.random() < 0.32;
  if (reg) { type = moodType(reg); seller = reg.role === 'seller'; }
  if (detective) { type = { name: 'Detective', mult: 1, patience: 9 }; seller = false; }
  const side = Math.random() < 0.5 ? -1 : 1;
  const c = { cid: nextCid++, seed: Math.random() * 1e9 | 0, type, seller, state: 'enter', wait: 0, qt: 0, patience: type.patience, t: 0, q: 0,
    reg: reg?.name || null, detective };
  c.thief = !reg && !seller && !detective && G.customers.length >= 2 && Math.random() < 0.07 * (isEvent('festival') ? 1.5 : 1);
  c.coffee = !seller && !detective && Math.random() < 0.15;
  makeCustomerMesh(c);
  coffeeCup(c, c.coffee);
  c.mesh.position.set(side * 14, 0, 6.8);
  c.path = [new THREE.Vector3(side * 2, 0, 6.8), DOOR_OUT.clone()];
  if (seller) {
    const weapon = !reg && Math.random() < 0.08;
    const ids = reg?.items?.();
    const def = ids?.length ? itemById(pick(ids)) : pick(weapon ? WEAPON_POOL : SELL_POOL);
    const fake = !weapon && !reg?.stolen && ['jewel', 'antique', 'collect', 'music'].includes(def.cat) && Math.random() < (['Clueless', 'Desperate'].includes(type.name) ? 0.22 : 0.1);
    const happy = reg && regularByName(reg.name) && G.regulars[reg.name]?.mood > 0.7;
    c.inst = makeInst(def.id, { q: happy ? rand(0.9, 1.25) : rand(0.5, 1.2), broken: Math.random() < 0.12, fake });
    if (reg?.stolen || (!reg && !weapon && Math.random() < 0.05)) c.inst.stolen = true;
    const worth = Math.round(marketPrice(def.id) * c.inst.q * (c.inst.broken ? 0.3 : 1)); // what the seller thinks it's worth
    c.offer = Math.max(1, Math.round(worth * type.ask * rand(0.9, 1.1)));
    c.min = Math.max(1, Math.round(worth * type.min * rand(0.9, 1.1)));
    c.say = reg ? moodLine(reg) : weapon ? pick(['Got this from my uncle. You buy guns, right?', 'No questions asked, okay?', 'Need it gone. Today.'])
      : c.inst.stolen ? pick(['No questions asked, okay?', 'It\'s… mine. Totally mine.', 'Quick cash, cheap price, deal?'])
        : pick(['Wanna buy this?', 'I need cash, quick.', 'Found this in my grandma\'s attic.', 'What will you give me for this?', 'It\'s real, I swear.']);
    hold(c, def.id);
  }
  G.customers.push(c);
  sfx.bell();
  return c;
}

function leave(c, angry) {
  if (c.state === 'leave') return;
  if (angry) addTrust(-0.005);
  c.state = 'leave';
  c.servedBy = null; c.help = 0;
  const side = Math.random() < 0.5 ? -1 : 1;
  c.path = c.mesh.position.z > 5 ? [new THREE.Vector3(side * 16, 0, 6.8)] : [DOOR_IN.clone(), DOOR_OUT.clone(), new THREE.Vector3(side * 16, 0, 6.8)];
}

const queueLen = q => G.customers.filter(x => x.state === 'queue' && x.q === q).length;
const pickRegister = () => G.up.register2 && queueLen(1) < queueLen(0) ? 1 : 0;
const stocked = () => G.shelves.filter(s => s !== G.carry && s.userData.slots.some(x => x.item));

function arrive(c) {
  if (c.state === 'enter') {
    if (c.mesh.position.z > 5) { // at the front door, outside
      if (!G.doorOpen && !c.detective) { if (Math.random() < 0.5) UI.toast('A customer found the door closed and walked away.'); return leave(c); }
      c.path = [DOOR_IN.clone()];
      return;
    }
    if (isEvent('rain') && Math.random() < 0.55) spawnSpill('mud', rand(-0.8, 0.8), rand(2.4, 3.8));
    if (c.detective) {
      c.state = 'inspect';
      const sh = stocked();
      c.path = (sh.length ? sh.slice(0, 2).map(shelfFront) : [new THREE.Vector3(2, 0, 0)]).concat([new THREE.Vector3(5.2, 0, -3.2)]);
      alert('🕵️ A detective walked in and is looking around…');
      return;
    }
    if (c.seller) { c.state = 'queue'; c.q = pickRegister(); return; }
    let list = stocked();
    if (!list.length) { UI.toast('A customer left: your shelves are empty!', 'bad'); return leave(c); }
    const r = regularByName(c.reg);
    if (r?.cats) { const fav = list.filter(s => s.userData.slots.some(x => x.item && r.cats.includes(itemById(x.item.id).cat))); if (!fav.length) { UI.toast(`${c.reg}: "Nothing for my collection today."`); return leave(c); } list = fav; }
    if (c.thief) { // thieves avoid glass cases and pedestals close to the register
      const far = list.filter(s => !(['glass', 'pedestal'].includes(s.userData.type) && s.position.distanceTo(REGS[0]) < 3.5 && Math.random() < 0.8));
      if (far.length) list = far;
    }
    c.shelf = pick(list);
    c.state = 'toShelf';
    c.path = [shelfFront(c.shelf)];
  } else if (c.state === 'toShelf') {
    c.state = 'browse';
    c.wait = rand(1.5, 3.5);
    if (!c.thief && Math.random() < 0.3) { c.help = 8; c.wait = 8; } // "Can I see that?"
  } else if (c.state === 'inspect') {
    inspectShop();
    leave(c);
  } else if (c.state === 'flee') {
    if (c.inst) alert(`🚨 The shoplifter got away with the ${itemById(c.inst.id).name}!`);
    G.scene.remove(c.mesh);
    G.customers.splice(G.customers.indexOf(c), 1);
  } else if (c.state === 'leave') {
    G.scene.remove(c.mesh);
    G.customers.splice(G.customers.indexOf(c), 1);
  }
}

function browse(c) {
  const filled = c.shelf.userData.slots.filter(s => s.item);
  if (!filled.length) return leave(c);
  c.help = 0;
  if (G.clean < 35 && Math.random() < 0.3) { UI.toast('A customer left: "This place is filthy!"', 'bad'); return leave(c, true); }
  const r = regularByName(c.reg);
  let choices = filled;
  if (r?.cats) { const fav = filled.filter(s => r.cats.includes(itemById(s.item.id).cat)); if (fav.length) choices = fav; }
  if (isEvent('heatwave')) { const hot = filled.filter(s => HOT_ITEMS.includes(s.item.id)); if (hot.length && Math.random() < 0.7) choices = hot; }
  const slot = pick(choices), inst = slot.item;
  if (c.thief) {
    c.inst = inst; c.slot = slot;
    setSlotItem(slot, null); hold(c, inst.id);
    c.state = 'flee';
    c.path = [DOOR_IN.clone(), DOOR_OUT.clone(), new THREE.Vector3(Math.random() < 0.5 ? -16 : 16, 0, 6.8)];
    alert('🚨 Shoplifter! Catch them before they reach the door (E)!');
    return;
  }
  const bonus = SHELF_TYPES[c.shelf.userData.type].bonus;
  const heat = isEvent('heatwave') && HOT_ITEMS.includes(inst.id) ? 1.6 : 1;
  c.max = Math.round(value(inst) * c.type.mult * bonus * trustMult() * cleanMult() * (c.helped || 1) * heat * (1 + G.decor.length * 0.015) * rand(0.9, 1.1));
  if (inst.price > c.max * 1.6) { UI.toast(`A customer thought the ${itemById(inst.id).name} was way too expensive.`); return leave(c); }
  c.inst = inst;
  c.slot = slot;
  setSlotItem(slot, null);
  hold(c, inst.id);
  // a fair tag gets paid; otherwise they offer less and you can haggle
  c.offer = inst.price <= c.max * 0.85 ? inst.price : Math.round(Math.min(inst.price, c.max * rand(0.7, 0.88)));
  if (c.offer === inst.price && Math.random() < 0.35) c.offer = Math.max(1, Math.round(inst.price * rand(0.8, 0.95))); // "would you take a bit less?"
  c.say = r ? moodLine(r) : c.offer < inst.price ? pick(['Would you take a bit less?', 'How about this?', 'I\'ll give you this much.', 'Is that your best price?'])
    : pick(['I\'d like to buy this.', 'I\'ll take it.', 'Ring me up.']);
  c.state = 'queue';
  c.q = pickRegister();
}

function returnItem(c) {
  if (!c.inst || c.seller) return;
  if (c.slot && !c.slot.item && G.shelves.includes(c.slot.shelf)) setSlotItem(c.slot, c.inst);
  else G.backstock.push(c.inst);
  c.inst = null;
  dropHeld(c);
}

export function updateCustomers(dt) {
  if (G.phase === 'open' && G.customers.length < maxCustomers() && G.intro === 'done') {
    G.spawnT -= dt;
    if (G.spawnT <= 0) { spawn(); G.spawnT = spawnDelay(); }
  }
  if (G.detectiveAt != null && G.phase === 'open' && G.time >= G.detectiveAt) { G.detectiveAt = null; spawn(true); }
  const queues = [0, 1].map(q => G.customers.filter(c => c.state === 'queue' && c.q === q));
  const mm = messMult();
  for (const c of [...G.customers]) {
    const m = c.mesh;
    setIcon(c, iconFor(c));
    if (c.slip > 0) { // flat on the wet floor
      c.slip -= dt;
      m.rotation.x = -Math.min(1.45, (1.6 - c.slip) * 6);
      if (c.slip <= 0) m.rotation.x = 0;
      continue;
    }
    if (c.state === 'queue') {
      const qi = queues[c.q].indexOf(c);
      c.path = [REGS[c.q].clone().add(new THREE.Vector3(0, 0, -qi * 0.9))];
      if (!c.servedBy) {
        c.qt += dt;
        if (qi === 0 && c.qt > 6 && !c.alerted) { c.alerted = true; alert('🧾 A customer is waiting at the register!'); }
        if (c.qt > 80) { UI.toast('A customer got tired of waiting and left.', 'bad'); returnItem(c); leave(c, true); rateDeal(c.reg, false, 2, 1); continue; }
      }
    }
    if (c.help > 0 && !c.helped) c.help -= dt;
    if (c.state === 'browse' && (c.wait -= dt) <= 0) browse(c);
    const tgt = c.path[0];
    let walking = false;
    if (tgt) {
      const d = tgt.clone().sub(m.position); d.y = 0;
      const dist = d.length(), speed = c.state === 'flee' ? 3.6 : 1.5;
      if (dist > 0.05) {
        m.position.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
        m.rotation.y = Math.atan2(d.x, d.z);
        walking = true;
      } else if (c.state === 'queue') {
        m.rotation.y = 0;
      } else {
        c.path.shift();
        if (!c.path.length) arrive(c);
      }
    }
    const inside = Math.abs(m.position.x) < 6.5 && Math.abs(m.position.z) < 4.5;
    if (walking && inside && c.state !== 'leave' && c.state !== 'flee') {
      if (Math.random() < dt * 0.02 * mm) spawnTrash(m.position.x + rand(-0.3, 0.3), m.position.z + rand(-0.3, 0.3));
      if (c.coffee && Math.random() < dt * 0.04 * mm) { c.coffee = false; coffeeCup(c, false); spawnSpill('coffee', m.position.x, m.position.z); sfx.splash(); }
    }
    c.walking = walking;
    c.t += walking ? dt * (c.state === 'flee' ? 14 : 8) : 0;
    animatePerson(m, c.t, walking, c.state === 'flee' ? 1.4 : 1);
    if (c.held && !walking) poseArms(m, -0.9, -0.5);
  }
}

export const isFirstInQueue = c => c.state === 'queue' && G.customers.find(x => x.state === 'queue' && x.q === c.q) === c
  && c.mesh.position.distanceTo(REGS[c.q || 0]) < 0.3;
export const customerById = cid => G.customers.find(c => c.cid === cid);

// ---------- co-op snapshot of customers ----------
export const customerSnap = () => G.customers.map(c => [c.cid, c.seed, +c.mesh.position.x.toFixed(2), +c.mesh.position.z.toFixed(2), +c.mesh.rotation.y.toFixed(2),
  c.walking ? 1 : 0, c.heldId || 0, c.iconE || '', c.q || 0, c.reg || 0, c.slip > 0 ? +c.mesh.rotation.x.toFixed(2) : 0, c.cup ? 1 : 0, c.seller ? 1 : 0, c.detective ? 1 : 0]);

export function mirrorCustomers(list) {
  const seen = new Set();
  for (const [cid, seed, x, z, ry, walking, heldId, icon, q, reg, slip, cup, seller, det] of list) {
    seen.add(cid);
    let c = customerById(cid);
    if (!c) {
      c = { cid, seed, seller: !!seller, t: 0, state: 'mirror', reg: reg || null, detective: !!det };
      makeCustomerMesh(c);
      c.mesh.position.set(x, 0, z);
      G.customers.push(c);
    }
    c.tgt = [x, z, ry]; c.walking = !!walking; c.q = q;
    c.state = icon === '💰' || icon === '🛒' ? 'queue' : icon === '❗' ? 'flee' : 'mirror';
    c.help = icon === '🙋' ? 1 : 0;
    c.slipX = slip;
    setIcon(c, icon);
    coffeeCup(c, !!cup);
    if ((heldId || null) !== (c.heldId || null)) heldId ? hold(c, heldId) : dropHeld(c);
  }
  for (const c of [...G.customers]) if (!seen.has(c.cid)) { G.scene.remove(c.mesh); G.customers.splice(G.customers.indexOf(c), 1); }
}
export function lerpCustomers(dt) {
  const k = Math.min(1, dt * 10);
  for (const c of G.customers) if (c.tgt) {
    const m = c.mesh;
    m.position.x += (c.tgt[0] - m.position.x) * k; m.position.z += (c.tgt[1] - m.position.z) * k;
    m.rotation.y = c.tgt[2];
    m.rotation.x = c.slipX || 0;
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
  inst.est = { lo: Math.max(1, Math.round(c * (1 - t.err))), hi: Math.max(1, Math.round(c * (1 + t.err))), fake: inst.fake && seesFake, real: !inst.fake && seesFake, tier: G.tools.magnifier,
    stolen: !!inst.stolen && G.tools.magnifier >= 2 && Math.random() < (G.tools.magnifier >= 3 ? 1 : 0.6) };
  return inst.est;
}

// ---------- actions (run on the host) ----------
function info(c) {
  const def = itemById(c.inst.id);
  return { cid: c.cid, inst: c.inst, seller: c.seller, type: c.type.name, say: c.say, patience: c.patience, maxPatience: c.type.patience,
    offer: c.offer, tag: c.inst.price, weapon: !!def.weapon, reg: c.reg, mood: c.reg ? moodWord(c.reg) : '' };
}
ACTIONS.serveStart = (pid, cid) => {
  const c = customerById(cid);
  if (!c || !isFirstInQueue(c)) return null;
  if (c.servedBy && c.servedBy !== pid) return { busy: true };
  c.servedBy = pid; c.qt = 0;
  if (!c.perked) {
    c.perked = true;
    if (perk(pid, 'cashier') >= 2) c.patience++;
    if (perk(pid, 'cashier') >= 5 && !c.seller) c.max = Math.round(c.max * 1.05);
  }
  return info(c);
};
ACTIONS.serveStop = (pid, cid) => { const c = customerById(cid); if (c?.servedBy === pid) c.servedBy = null; };
ACTIONS.inspectCustomer = (pid, cid) => { const c = customerById(cid); if (c?.inst) estimate(c.inst); return c ? info(c) : null; };
ACTIONS.helpCustomer = (pid, cid) => {
  const c = customerById(cid);
  if (!c || !(c.help > 0) || c.helped) return false;
  c.helped = perk(pid, 'stocker') >= 2 ? 1.2 : 1.15;
  c.help = 0; c.wait = Math.min(c.wait, 1.2);
  addJob(pid, 'stocker', 8, 'helped');
  tell(pid, 'You showed them the item. They\'ll pay a bit more.');
  return true;
};
ACTIONS.catchThief = (pid, cid) => {
  const c = customerById(cid);
  if (!c || c.state !== 'flee') return false;
  const name = c.inst ? itemById(c.inst.id).name : 'item';
  returnItem(c);
  leave(c, false);
  addJob(pid, 'stocker', 15, 'caught');
  alert(`🚨 ${G.players[pid]?.name || 'Someone'} caught the shoplifter! The ${name} is back.`);
  return true;
};

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
      gainTrust(0.002);
      rateDeal(c.reg, true, price, Math.round(marketPrice(c.inst.id) * c.inst.q));
      addJob(pid, 'cashier', 4, 'bought');
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
  if (--c.patience <= 0) { tell(pid, '"Forget it, I\'m out!"', 'bad'); returnItem(c); leave(c, true); rateDeal(c.reg, c.seller, c.seller ? 0 : 9, 1); return { res: 'leave' }; }
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
  tip = Math.round(tip * (perk(pid, 'cashier') >= 3 ? 1.5 : 1));
  G.money += price + tip - lost; G.stats.sales += price + tip; G.stats.sold++;
  G.life.sold++; G.life.sales += price + tip;
  G.xp += Math.round(price / 10);
  gainTrust(price <= value(c.inst) * 1.15 ? 0.006 : 0.004);
  rateDeal(c.reg, false, price, value(c.inst));
  addJob(pid, 'cashier', 10 + price / 40, 'sales', price + tip);
  addJob(pid, 'cashier', 0, 'sold');
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
  const who = i.reg ? `${regularByName(i.reg)?.icon || '⭐'} <b>${i.reg}</b> (regular, ${i.mood})` : i.type;
  const base = { icon: def.icon, title: def.name, say: i.say, patience: i.patience, maxPatience: i.maxPatience, offer: i.offer, lines,
    inspect: G.tools.magnifier > 0 && !i.inst.est };
  UI.bargainPanel(i.seller
    ? { ...base, who: `${who} · wants to SELL`, offerLabel: 'They ask', counterLabel: 'Your offer', canAccept: !(i.weapon && !G.up.permit),
      counterDefault: Math.round(i.offer * 0.7), acceptLabel: `Pay ${UI.money(i.offer)}`, refuseLabel: 'No thanks' }
    : { ...base, who: `${who} · wants to BUY`, offerLabel: 'They offer', counterLabel: 'Your price', counterDefault: i.tag,
      acceptLabel: `Accept ${UI.money(i.offer)}`, refuseLabel: 'Refuse' },
  async (a, v) => {
    if (a === 'wait') { act('serveStop', i.cid); return UI.closePanel(); }
    if (a === 'inspect') { const n = await act('inspectCustomer', i.cid); return n ? bargain(n) : UI.closePanel(); }
    const r = await act('haggle', i.cid, a, v);
    if (!r || r.res === 'gone' || r.res === 'leave' || r.res === 'refused') { UI.closePanel(); return UI.hud(); }
    if (r.res === 'counter') return bargain(r.info);
    if (r.res === 'deal' && r.seller) { UI.closePanel(); return UI.hud(); }
    if (r.res === 'deal') {
      const res = await checkout(r.price, i.inst, { cash: isEvent('powercut'), auto: myPerk('cashier') >= 4 });
      await act('completeSale', i.cid, res.lost, res.tip);
      G.relock(); UI.hud();
    }
  });
}

// When a player leaves mid-service, free the customer.
export function releaseServed(pid) { for (const c of G.customers) if (c.servedBy === pid) c.servedBy = null; }
