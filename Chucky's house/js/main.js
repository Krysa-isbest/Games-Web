import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { G, ACTIONS, pick, me, ensurePlayer } from './state.js';
import { itemById, makeItemMesh, part } from './data.js';
import { S, saveSettings, applySettings } from './settings.js';
import { buildWorld, walkable, STATIC, physStatics, updateBin, updateSign, updateWorld } from './world.js';
import { updateCity } from './city.js';
import { SHELF_TYPES, makeShelf, placeShelf, setSlotItem, shelfBySid, refreshTags, setMarketFn } from './shelves.js';
import { spawnTrash } from './trash.js';
import { updateCustomers, serve, isFirstInQueue } from './customers.js';
import { openComputer } from './computer.js';
import * as EXP from './expedition.js';
import { rollMarket, endDay, DAY_LEN, START_DEBT, marketPrice, auctionTick, isAuctionDay } from './economy.js';
import { PhysWorld, throwFrom } from './physics.js';
import { pendingTick } from './shop.js';
import { updateCoop, updateChickens, eggSave, eggLoad } from './chickens.js';
import { repairGame } from './minigames.js';
import { act, broadcast, isGuest, isHost, online, leaveNet } from './net.js';
import { VOICE, initMic, updateVoice, setPTT, setRadio, updateMicTrack, closeVoice } from './voice.js';
import { openCoop, netTick, updateAvatars, approveKey, openChat, shopSnap } from './coop.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const SAVE_KEY = 'chuckys_house_save_v6';
const NEW_FLAG = 'chuckys_house_new';
const INTRO = [
  'Six months ago I had a business, a car, and a future.',
  'Then it all went under. Bankrupt.',
  'The bank gave me one last chance: an $8,000 loan… for a dusty old pawn shop on the wrong side of town.',
  '$600 every week. Miss three payments and the IRS comes for everything. Including me.',
  'Buy low. Sell high. Go out at night and bring back whatever you can carry.',
  'CHUCKY\'S HOUSE: Day 1',
];

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: S.aa, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc0e0);
scene.fog = new THREE.Fog(0x9cc0e0, 30, 120);
scene.userData.fogFar = 160;
G.scene = scene;

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
scene.add(camera);
const controls = new PointerLockControls(camera, document.body);

ensurePlayer('p0', S.name);
buildWorld(scene);
G.phys = new PhysWorld(scene, physStatics);
setMarketFn(marketPrice);
const apply = () => {
  applySettings({ renderer, camera, controls, scene: G.world === 'exp' ? EXP.activeScene() || scene : scene, sun: G.sun });
  saveSettings();
  updateMicTrack();
  UI.$('fps').classList.toggle('hidden', !S.showFps);
  if (me()) me().name = S.name;
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- save / load ----------
const FIELDS = ['money', 'day', 'time', 'phase', 'debt', 'paidWeek', 'strikes', 'xp', 'trust', 'backstock', 'market', 'marketPrev', 'deals', 'auction', 'night',
  'gear', 'tools', 'weapons', 'up', 'eggs', 'doorOpen', 'binCount', 'stats', 'index'];
const MERGE = ['gear', 'tools', 'weapons', 'up', 'stats'];
let playerStart = [-4.5, 3.6];

G.save = () => {
  if (G.ended || G.world === 'exp' || isGuest()) return;
  const held = new Map(G.customers.filter(c => !c.seller && c.slot && c.inst).map(c => [c.slot, c.inst]));
  const d = Object.fromEntries(FIELDS.map(f => [f, G[f]]));
  const h = me()?.holding;
  if (h?.kind === 'item') d.backstock = [...d.backstock, h.inst];
  if (G.auction?.started) d.auction = null;
  Object.assign(d, {
    v: 6,
    player: G.mode === 'play' ? [camera.position.x, camera.position.z] : playerStart,
    trash: G.trash.map(t => [t.position.x, t.position.z, t.userData.trashKind]),
    shelves: G.shelves.map(s => ({ type: s.userData.type, sid: s.userData.sid, x: s.position.x, z: s.position.z, r: s.userData.r, slots: s.userData.slots.map(sl => sl.item ?? held.get(sl) ?? null) })),
    floor: G.phys.bodies.map(b => ({ inst: b.inst, p: b.p.toArray(), ry: b.ry })),
    eggsGround: eggSave(),
    holdTrash: h && h.kind !== 'item' ? h : null,
  });
  localStorage.setItem(SAVE_KEY, JSON.stringify(d));
};

function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* corrupted save, start fresh */ }
  if (d?.v !== 6) d = null;
  G.hasSave = !!d;
  if (!d) {
    G.debt = START_DEBT;
    rollMarket();
    d = { shelves: [{ type: 'wood', x: 0, z: -4.4, r: 0, slots: SHELF_TYPES.wood.slots.map(() => null) }] };
  }
  for (const f of FIELDS) if (d[f] !== undefined) G[f] = MERGE.includes(f) ? { ...G[f], ...d[f] } : d[f];
  if (!G.night) rollMarket();
  for (const sd of d.shelves) {
    const s = makeShelf(sd.type, sd.x, sd.z, sd.r, sd.sid);
    sd.slots.forEach((it, i) => it && setSlotItem(s.userData.slots[i], it));
  }
  for (const [x, z, k] of d.trash || []) spawnTrash(x, z, k);
  for (const f of d.floor || []) G.phys.add(f.inst, new THREE.Vector3(...f.p), undefined, f.ry, true);
  eggLoad(d.eggsGround);
  if (d.player) playerStart = d.player;
  me().holding = d.holdTrash || null;
  updateBin(); updateSign(); updateWorld(); updateCoop();
}

// ---------- player ----------
const keys = {};
const ray = new THREE.Raycaster(); ray.far = 3.2;
const CENTER = new THREE.Vector2();
let target = null, bobT = 0;

function blocked(x, z) {
  if (G.world === 'exp') return EXP.blocked(x, z);
  if (!walkable(x, z)) return true;
  const p = new THREE.Vector3(x, 1, z);
  return [...STATIC, ...G.shelves.filter(s => s !== G.carry).map(s => s.userData.box)].some(b => b.clone().expandByScalar(0.3).containsPoint(p));
}

function movePlayer(dt) {
  const exp = G.world === 'exp';
  if (exp && EXP.isFrozen()) return;
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
  const rgt = new THREE.Vector3(-f.z, 0, f.x);
  const v = new THREE.Vector3()
    .addScaledVector(f, (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0))
    .addScaledVector(rgt, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0));
  const p = camera.position;
  const run = (keys.ShiftLeft || keys.ShiftRight) && (!exp || EXP.canRun());
  G.running = run && v.lengthSq() > 0;
  if (v.lengthSq()) {
    v.normalize().multiplyScalar((run ? 5.5 : 3.2) * (exp ? EXP.speedMult() : 1) * dt);
    if (!blocked(p.x + v.x, p.z)) p.x += v.x;
    if (!blocked(p.x, p.z + v.z)) p.z += v.z;
    bobT += dt * (run ? 13 : 9);
  }
  const eye = exp ? EXP.eyeHeight() : 1.6;
  p.y += (eye + (S.bob ? Math.sin(bobT) * 0.035 : 0) - p.y) * Math.min(1, dt * 12);
}

// ---------- what you hold (view model in the shop) ----------
let holdKey = null;
function updateHoldMesh() {
  const h = me()?.holding;
  const k = !h ? null : h.kind === 'item' ? h.inst.uid : h.kind + (h.n || '');
  if (k === holdKey) return;
  holdKey = k;
  if (G.holdMesh) camera.remove(G.holdMesh);
  G.holdMesh = null;
  UI.hud();
  if (!h) return;
  const g = new THREE.Group();
  if (h.kind === 'bag') {
    part(g, new THREE.IcosahedronGeometry(0.2, 1), 0x111111, 0, 0, 0, { roughness: 0.3 }).scale.set(1, 1.2, 1);
    part(g, new THREE.ConeGeometry(0.06, 0.12, 6), 0x111111, 0, 0.26, 0);
  } else if (h.kind === 'trash') {
    for (let i = 0; i < h.n; i++) part(g, new THREE.IcosahedronGeometry(0.05, 0), 0xe8e4d8, (i % 2) * 0.07, Math.floor(i / 2) * 0.07, 0);
  } else {
    const m = makeItemMesh(itemById(h.inst.id));
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    m.scale.multiplyScalar(Math.min(1, 0.4 / Math.max(size.x, size.y, size.z)));
    m.position.y = -0.1;
    g.add(m);
  }
  g.position.set(0.32, -0.32, -0.6);
  g.visible = G.world === 'shop';
  camera.add(g);
  G.holdMesh = g;
}

// ---------- furniture ----------
G.startCarry = sid => {
  const s = shelfBySid(sid);
  if (!s) return;
  s.userData.from = null;
  G.carry = s;
  UI.toast('Place it with F, rotate with R.');
  G.relock();
};

function carryValid(b) {
  if (b.min.x < -6.9 || b.max.x > 6.9 || b.min.z < -4.9 || b.max.z > 4.9) return false;
  if (STATIC.some(x => x.intersectsBox(b))) return false;
  if (b.max.z > 3.2 && b.min.x < 1.3 && b.max.x > -1.3) return false; // front door
  if (b.min.z < -3.6 && (b.min.x < -4.7 || (b.max.x > 3.9 && b.min.x < 5.9))) return false; // back doors
  if (b.max.z > 1.2 && b.min.x < -2.6) return false; // register
  const p = camera.position;
  if (b.clone().expandByScalar(0.3).containsPoint(new THREE.Vector3(p.x, 1, p.z))) return false;
  return !G.shelves.some(s => s !== G.carry && s.userData.box.intersectsBox(b));
}

function updateCarry() {
  const s = G.carry;
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
  const snap = v => Math.round(v * 4) / 4;
  placeShelf(s, snap(camera.position.x + f.x * 2.2), snap(camera.position.z + f.z * 2.2), s.userData.r);
  s.userData.ok = carryValid(s.userData.box);
  UI.hint(s.userData.ok ? `${UI.kbd('F')} Place · ${UI.kbd('R')} Rotate` : `<span class="down">Can't place here</span> · ${UI.kbd('R')} Rotate`);
}

function toggleCarry() {
  if (G.carry) {
    if (!G.carry.userData.ok) return UI.toast('Can\'t place it here.', 'bad');
    const s = G.carry; G.carry = null;
    act('moveShelf', s.userData.sid, s.position.x, s.position.z, s.userData.r);
    sfx.thud(); UI.hint(''); G.save();
  } else if (target?.shelf) {
    G.carry = target.shelf; // items stay on it while you move it
    G.carry.userData.from = [G.carry.position.x, G.carry.position.z, G.carry.userData.r];
    sfx.pick();
  }
}

// ---------- interaction ----------
function hintFor(t) {
  if (!t) return '';
  const E = UI.kbd('E'), F = UI.kbd('F'), Gk = UI.kbd('G'), h = me().holding;
  if (t.customer) {
    const c = t.customer;
    return isFirstInQueue(c) ? `${E} Serve customer <span class="dim">(${c.seller ? 'selling' : 'buying'})</span>`
      : c.state === 'queue' ? '<span class="dim">Waiting in line…</span>' : '';
  }
  if (t.body) return h ? '<span class="dim">Hands full</span>' : `${E} Pick up ${itemById(t.body.inst.id).icon} ${itemById(t.body.inst.id).name}`;
  switch (t.kind) {
    case 'computer': return `${E} Use computer`;
    case 'opensign': return G.phase === 'prep' ? `${E} Open the store` : G.phase === 'evening' ? `${E} Head out for the night` : G.phase === 'open' ? 'Open until 6:00 PM' : 'Closing…';
    case 'door': return `${E} ${G.doorOpen ? 'Close' : 'Open'} the front door <span class="dim">(closed = no new customers)</span>`;
    case 'trash': return h && h.kind !== 'trash' || h?.n >= 4 ? '<span class="dim">Hands full</span>' : `${E} Pick up trash`;
    case 'bin':
      if (h?.kind === 'trash') return G.binCount >= G.up.binCap ? '<span class="down">Bin is full! Take the bag out first</span>' : `${E} Throw away (${G.binCount}/${G.up.binCap})`;
      if (!h && G.binCount > 0) return `${E} Take out trash bag (${G.binCount}/${G.up.binCap})`;
      return `Trash bin (${G.binCount}/${G.up.binCap})`;
    case 'dumpster': return h?.kind === 'bag' ? `${E} Throw bag in dumpster` : 'Dumpster';
    case 'storage': return h?.kind === 'item' ? `${E} Put it in the stock crates` : `${E} Stock crates (${G.backstock.length} items)`;
    case 'egg': return `${E} Collect egg 🥚`;
    case 'chicken': return '🐔';
    case 'hatch': return G.standWaiting ? `${E} Sell eggs (${G.eggs} in the basket)` : `Egg stand · ${G.eggs} eggs <span class="dim">(customers ring the bell)</span>`;
    case 'bench': return G.up.workshop ? `${E} Repair a broken item` : '';
    case 'wsdoor': return G.up.workshop ? '' : 'Workshop: for rent <span class="dim">(computer → Upgrades)</span>';
  }
  const slot = t.slot;
  if (slot?.item) {
    const d = itemById(slot.item.id);
    return `${d.icon} ${d.name}: <b>${UI.money(slot.item.price)}</b> <span class="dim">(today ~${UI.money(marketPrice(d.id))})</span> · ${E} Price · ${Gk} Take · ${UI.kbd('Q')} To stock`;
  }
  if (slot) return h?.kind === 'item' ? `${E} Put ${itemById(h.inst.id).name} here` : `Empty slot · ${E} Place from stock (${G.backstock.length}) · ${F} Move`;
  if (t.shelf) return `${F} Move ${SHELF_TYPES[t.shelf.userData.type].name.toLowerCase()}`;
  return '';
}

function updateTarget() {
  if (G.carry) { target = null; return; }
  ray.setFromCamera(CENTER, camera);
  const hit = ray.intersectObjects([...G.shelves, ...G.customers.map(c => c.mesh), ...G.trash, ...G.interactables, ...G.phys.bodies.map(b => b.mesh), ...G.eggMeshes, ...G.chickens.map(c => c.mesh)], true)[0];
  target = hit ? hit.object.userData : null;
  UI.hint(hintFor(target));
}

async function interact() {
  const t = target;
  if (!t) return;
  const h = me().holding;
  if (t.customer) { if (isFirstInQueue(t.customer)) serve(t.customer.cid); return; }
  if (t.body) return act('grabBody', t.body.uid);
  switch (t.kind) {
    case 'computer': return openComputer();
    case 'opensign': return openStore();
    case 'door': return act('door');
    case 'trash': return act('pickTrash', t.ref.userData.tid);
    case 'bin': return act('useBin');
    case 'dumpster': return act('dumpster');
    case 'storage':
      if (h?.kind === 'item') return act('putInStock');
      if (h) return;
      return UI.stockPanel('📦 Stock crates: take an item', inst => { act('takeFromStock', inst.uid); G.relock(); });
    case 'egg': return act('collectEgg', t.ref.userData.eid);
    case 'chicken': return sfx.cluck();
    case 'hatch': return act('serveStand');
    case 'bench':
      if (!G.up.workshop) return;
      return UI.stockPanel('🔧 Repair: pick a broken item', async inst => {
        const score = await repairGame(inst);
        if (score == null) return;
        await act('repair', inst.uid, score);
        G.relock();
      }, i => i.broken);
    case 'wsdoor': if (!G.up.workshop) UI.toast('Rent the workshop on the computer (Upgrades).'); return;
  }
  const slot = t.slot;
  if (!slot) return;
  const sid = slot.shelf.userData.sid;
  if (slot.item) {
    const inst = slot.item;
    return UI.pricePanel(itemById(inst.id), inst, marketPrice(inst.id), v => act('setPrice', sid, slot.i, v), () => act('inspectItem', inst.uid).then(e => { if (e) inst.est = e; }));
  }
  if (h?.kind === 'item') return act('putOnShelf', sid, slot.i);
  UI.stockPanel('📦 Place an item', inst => { act('placeFromStock', sid, slot.i, inst.uid); G.relock(); }, i => !itemById(i.id).big);
}

function grabOrThrow() {
  const h = me().holding;
  if (h?.kind === 'item') {
    const { p, v } = throwFrom(camera, keys.ShiftLeft ? 7 : 4.5);
    return act('throwHeld', p.toArray(), v.toArray());
  }
  if (!h && target?.slot?.item) return act('takeFromShelf', target.slot.shelf.userData.sid, target.slot.i);
  if (!h && target?.body) return act('grabBody', target.body.uid);
}

function toStock() {
  const slot = target?.slot;
  if (slot?.item) act('toStock', slot.shelf.userData.sid, slot.i);
}

// ---------- day / night ----------
function openStore() {
  if (G.phase === 'evening') return EXP.nightPanel(loc => { UI.closePanel(false); act('startNight', loc); }, () => { UI.closePanel(); act('sleep'); });
  if (G.phase !== 'prep') return;
  act('openStore');
}

ACTIONS.startNight = (pid, loc) => {
  if (G.phase !== 'evening' || G.world === 'exp') return false;
  const ev = Math.random() < 0.4 ? 'night' : pick(['day', 'angry', 'fog', 'blackout', 'night']);
  const params = { loc, seed: Math.random() * 2 ** 31 | 0, skulls: G.night?.[loc] ?? 1, ev };
  broadcast({ t: 'xstart', params });
  G.startExpedition(params);
  return true;
};
ACTIONS.sleep = () => {
  if (G.phase !== 'evening') return false;
  G.phase = 'prep';
  broadcast({ t: 'sleep' });
  G.onSleep();
  return true;
};
G.onSleep = () => {
  G.phase = isGuest() ? G.phase : 'prep';
  updateSign(); G.save();
  UI.closePanel(); UI.hud();
  UI.toast(`You slept through the night. Good morning, Day ${G.day}!`);
};

G.startExpedition = params => {
  if (G.carry) { const s = G.carry; G.carry = null; if (s.userData.from) placeShelf(s, ...s.userData.from); }
  G.world = 'exp';
  Object.assign(me(), { world: 'exp', hp: 100, down: false, hidden: false, cab: false });
  if (G.holdMesh) G.holdMesh.visible = false;
  UI.closePanel(false);
  showHud(true);
  EXP.start(params, camera);
  apply();
  G.relock();
};

G.endExpedition = r => {
  scene.add(camera);
  G.world = 'shop';
  Object.assign(me(), { world: 'shop', hp: 100, down: false, hidden: false, cab: false, light: false });
  camera.position.set(-4.5 + (+G.me.slice(1)) * 0.6, 1.6, 3.6); camera.rotation.set(0, 0, 0);
  if (G.holdMesh) G.holdMesh.visible = true;
  showHud(true);
  apply();
  if (!isGuest()) { G.phase = 'prep'; updateSign(); G.save(); }
  const list = ids => ids.map(id => itemById(id).icon + ' ' + itemById(id).name).join(', ');
  const mine = r.kept[G.me] || [], lost = r.lost[G.me] || [];
  const title = { drive: '🏠 Back home safe', time: '🛻 The truck left', wiped: '💀 Everybody went down' }[r.reason];
  UI.openPanel(`<h2>${title}</h2>
    <p class="dim">${r.loc} · ${UI.skulls(r.skulls)} · ${r.ev}</p>
    ${r.reason === 'time' && lost.length ? '<p>You weren\'t in the truck when it left. You walked home all night, and somebody robbed your bag.</p>' : ''}
    ${r.reason === 'wiped' ? '<p>Nobody was left standing. Somebody towed the truck home. Whatever was in your bags is gone.</p>' : ''}
    <p>🛻 The truck brought home <b>${r.cargo.length}</b> item(s)${r.cargo.length ? ': ' + list(r.cargo) : '.'}</p>
    ${mine.length ? `<p>🎒 Your bag: ${list(mine)}</p>` : ''}
    ${lost.length ? `<p class="down">Lost: ${list(lost)}</p>` : ''}
    <p class="dim">Everything is in the stock crates. Check prices on the computer before you sell. Broken items can be repaired in the workshop.</p>
    <div class="row"><button id="ex-ok">Start Day ${G.day} ☀</button></div>`, { esc: false });
  UI.$('ex-ok').onclick = () => { UI.closePanel(); UI.hud(); };
};

function dayTick(dt) {
  if (G.phase === 'open') {
    G.time += dt * 540 / DAY_LEN;
    if (G.time >= 540) {
      G.time = 540; G.phase = 'closing';
      updateSign(); sfx.bell();
      broadcast({ t: 'say', text: '6:00 PM: closing time! Serve the last customers.' });
      UI.toast('6:00 PM: closing time! Serve the last customers.');
    }
  } else if (G.phase === 'closing' && !G.customers.length && !G.customers.some(c => c.servedBy) && !UI.panelOpen() && !G.carry) {
    finishDay();
  }
  if (isAuctionDay() && G.auction?.started && G.phase !== 'evening') auctionTick(dt, (kind, lot) => {
    const d = itemById(lot.inst.id), say = text => { UI.toast(text); broadcast({ t: 'say', text }); };
    if (kind === 'start') say(`🔨 Auction: ${d.name}, starting at ${UI.money(lot.bid)}`);
    if (kind === 'won') { sfx.gavel(); say(`🔨 SOLD to your team! ${d.name} for ${UI.money(lot.bid)}. It's in the stock crates.`); }
    if (kind === 'lost') { sfx.gavel(); say(`🔨 ${d.name} went to another dealer for ${UI.money(lot.bid)}.`); }
    if (kind === 'broke') say(`🔨 You couldn't pay for the ${d.name}. The auction house is not amused.`);
  });
  pendingTick(dt);
}

function finishDay() {
  const s = endDay();
  G.phase = 'evening'; G.time = 0;
  updateSign(); refreshTags();
  broadcast({ t: 'summary', s });
  G.onSummary(s);
}
G.onSummary = s => {
  if (s.gameOver) return prison(s);
  if (!isGuest()) G.save();
  refreshTags();
  UI.summaryPanel(s, () => { UI.closePanel(); UI.hud(); UI.toast('Evening: buy gear on the computer, then press O to head out.'); });
};

function endGame() {
  G.ended = true;
  if (!isGuest()) localStorage.removeItem(SAVE_KEY);
  document.exitPointerLock();
  showHud(false);
}

function prison(s) {
  endGame();
  UI.endScreen('prison', `<h1>BUSTED</h1><p>Three missed payments. The IRS took everything, including your freedom.</p>
    <p class="dim">You kept Chucky's House open for ${s.day} days. Loan left: ${UI.money(G.debt)}</p>`, () => location.reload());
}

G.win = () => {
  if (G.ended) return;
  endGame();
  sfx.cash();
  UI.endScreen('win', `<h1>DEBT FREE!</h1><p>You paid off the loan on Day ${G.day}. Chucky's House is finally yours.</p>
    <p class="dim">Cash left: ${UI.money(G.money)}</p>`, () => location.reload());
};

// ---------- input ----------
addEventListener('keydown', e => {
  if (G.chatting) return;
  keys[e.code] = true;
  if (e.code === 'KeyY' && approveKey(true)) return;
  if (e.code === 'KeyN' && approveKey(false)) return;
  if (G.mode !== 'play') return;
  if (e.code === 'KeyV' && S.micMode === 'ptt') setPTT(true);
  if (e.code === 'KeyB' && !e.repeat && online()) { if (!setRadio(true)) UI.toast('Your team has no walkie-talkies (computer → Tools).'); }
  if (e.code === 'KeyT' && online() && !G.uiOpen) { e.preventDefault(); return openChat(() => G.relock()); }
  if (G.uiOpen || !controls.isLocked) return;
  if (G.world === 'exp') {
    if (e.code === 'KeyE') EXP.interact();
    if (e.code === 'KeyF') EXP.toggleLight();
    if (e.code === 'KeyX') EXP.dismantleTarget();
    if (e.code === 'KeyG') EXP.dropSelected();
    if (e.code === 'KeyC') EXP.toggleCrouch();
    if (e.code === 'Space') EXP.nextSpectate();
    const n = e.code.startsWith('Digit') ? +e.code.slice(5) - 1 : -1;
    if (n >= 0 && n < 9) EXP.select(n);
    return;
  }
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyF') toggleCarry();
  if (e.code === 'KeyQ') toStock();
  if (e.code === 'KeyG') grabOrThrow();
  if (e.code === 'KeyR' && G.carry) G.carry.userData.r = (G.carry.userData.r + 1) % 4;
  if (e.code === 'KeyO') openStore();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyV') setPTT(false);
  if (e.code === 'KeyB') setRadio(false);
});
addEventListener('mousedown', e => {
  if (e.button !== 0 || !controls.isLocked || G.uiOpen) return;
  if (G.world === 'exp') EXP.use();
  else if (me().holding?.kind === 'item') grabOrThrow();
});
addEventListener('wheel', e => { if (controls.isLocked && G.world === 'exp') EXP.cycle(Math.sign(e.deltaY)); });

// ---------- menus ----------
const menu = UI.$('menu'), pause = UI.$('pause');
const showHud = on => {
  UI.$('hud').classList.toggle('hidden', !on || G.world !== 'shop');
  UI.$('exp-hud').classList.toggle('hidden', !on || G.world !== 'exp');
  ['cross', 'hint', 'mic-ind'].forEach(id => UI.$(id).classList.toggle('hidden', !on));
};

function showMenu() {
  G.mode = 'menu';
  menu.classList.remove('hidden');
  UI.$('m-continue').classList.toggle('hidden', !G.hasSave);
  if (G.hasSave) UI.$('m-info').textContent = `Day ${G.day} · ${UI.money(G.money)} cash · Loan ${UI.money(G.debt)}`;
  showHud(false);
}

function enterPlay() {
  G.mode = 'play';
  menu.classList.add('hidden');
  const off = isGuest() ? +G.me.slice(1) * 0.7 : 0;
  camera.position.set(playerStart[0] + off, 1.6, playerStart[1]);
  camera.rotation.set(0, 0, 0);
  showHud(true);
  UI.hud();
  controls.lock();
  // a co-op host brings everyone already connected into the game (later joiners get it on hello)
  if (isHost()) setTimeout(() => broadcast({ t: 'start', ss: shopSnap() }), 300);
}
G.onCoopStart = () => { UI.closePanel(false); enterPlay(); };
// Host: start the game for the co-op (the host's save, or a new game with the intro).
G.hostStartGame = () => {
  if (G.mode === 'play') return;
  if (!G.hasSave) { G.hasSave = true; UI.cutscene(INTRO, () => { G.save(); enterPlay(); }); } else enterPlay();
};
// Party: wipe the save and reload into a new game (the intro plays, then the game starts).
G.newGameReload = () => {
  localStorage.removeItem(SAVE_KEY);
  sessionStorage.setItem(NEW_FLAG, '1');
  G.save = () => {};
  location.reload();
};

const showPause = () => { if (G.mode === 'play' && !G.uiOpen && !G.ended && !G.chatting) pause.classList.remove('hidden'); };
G.relock = () => { if (G.mode === 'play' && !G.ended && !UI.panelOpen()) controls.lock(); };
controls.addEventListener('lock', () => pause.classList.add('hidden'));
controls.addEventListener('unlock', () => { for (const k in keys) keys[k] = false; setPTT(false); setRadio(false); showPause(); });
document.addEventListener('pointerlockerror', showPause);

const mics = async () => (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(d => d.kind === 'audioinput');
const back = () => { UI.closePanel(false); };
UI.$('m-continue').onclick = enterPlay;
UI.$('m-new').onclick = async () => {
  if (G.hasSave && !await UI.confirmBox('<h3>Start a new game?</h3><p>Your current save will be deleted.</p>', 'New game')) return;
  localStorage.removeItem(SAVE_KEY);
  sessionStorage.setItem(NEW_FLAG, '1');
  G.save = () => {};
  location.reload();
};
UI.$('m-coop').onclick = () => openCoop(G.hostStartGame, () => { UI.closePanel(false); if (!online()) { leaveNet(); closeVoice(); } });
UI.$('m-settings').onclick = async () => UI.settingsPanel(S, apply, back, await mics());
UI.$('m-controls').onclick = () => UI.controlsPanel(back);
UI.$('p-resume').onclick = () => controls.lock();
UI.$('p-settings').onclick = async () => UI.settingsPanel(S, apply, back, await mics());
UI.$('p-controls').onclick = () => UI.controlsPanel(back);
UI.$('p-quit').onclick = () => { G.save(); leaveNet(); location.reload(); };
UI.$('mic-retry').onclick = () => initMic().then(micStatus);
document.querySelectorAll('.menu-box button').forEach(b => b.addEventListener('click', sfx.click));

function micStatus() {
  const st = VOICE.status;
  UI.$('mic-line').innerHTML = { on: '🎙️ Microphone ready for voice chat', denied: '🔇 Microphone blocked. Voice chat is off (text chat still works).', none: '🔇 No microphone found', asking: '🎙️ Allow the microphone for voice chat…', off: '' }[st];
  UI.$('mic-retry').classList.toggle('hidden', st === 'on' || st === 'asking');
}

// ---------- boot ----------
apply();
load();
UI.$('ver').textContent = 'Prototype v0.6';
if (sessionStorage.getItem(NEW_FLAG)) {
  sessionStorage.removeItem(NEW_FLAG);
  menu.classList.add('hidden');
  G.hasSave = true;
  UI.cutscene(INTRO, () => { G.save(); enterPlay(); });
} else {
  showMenu();
}
// The game asks for the microphone right away (voice chat).
micStatus();
initMic().then(micStatus);
setInterval(() => { if (G.mode === 'play') G.save(); }, 10000);

// ---------- loop ----------
const clock = new THREE.Clock();
let menuT = 0, hudT = 0, fpsN = 0, fpsT = 0, lastFrame = 0;
function dayLight() {
  if (G.phase === 'prep') return 0.85;
  if (G.phase === 'evening') return 0.04;
  if (G.phase === 'closing') return 0.3;
  return G.time < 360 ? 1 : 1 - (G.time - 360) / 180 * 0.7;
}

renderer.setAnimationLoop(now => {
  if (S.fpsCap && now - lastFrame < 1000 / S.fpsCap - 1) return;
  lastFrame = now;
  const dt = Math.min(clock.getDelta(), 0.05);
  fpsN++; if ((fpsT += dt) > 0.5) { UI.$('fps').textContent = Math.round(fpsN / fpsT) + ' FPS'; fpsN = 0; fpsT = 0; }
  const my = me();
  const live = controls.isLocked || G.uiOpen || online() || G.chatting;
  if (G.mode === 'menu') {
    menuT += dt * 0.08;
    camera.position.set(Math.sin(menuT) * 3, 2.2, 1.6 + Math.cos(menuT) * 1.8);
    camera.lookAt(0, 1.1, -2.5);
    updateCity(dt, 0.85);
  } else if (G.mode === 'play' && !G.ended && G.world === 'exp') {
    if (controls.isLocked && !EXP.isOver()) {
      movePlayer(dt);
      ray.setFromCamera(CENTER, camera);
      EXP.updateTarget(ray);
    }
    if (live) EXP.update(dt);
  } else if (G.mode === 'play' && !G.ended) {
    if (controls.isLocked) {
      movePlayer(dt);
      if (G.carry) updateCarry();
      updateTarget();
    }
    if (live) {
      if (!isGuest()) {
        dayTick(dt);
        updateCustomers(dt);
        G.phys.step(dt);
      }
      updateChickens(dt, !isGuest());
      if ((hudT -= dt) <= 0) { UI.hud(); hudT = 0.25; }
    }
    updateCity(dt, dayLight());
    updateHoldMesh();
  }
  if (my) {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    Object.assign(my, { x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: Math.atan2(dir.x, dir.z), world: G.world, run: G.running, name: S.name });
    G.camPos = { x: camera.position.x + dir.x * 2, z: camera.position.z + dir.z * 2 }; // where bought furniture appears
  }
  const sc = G.world === 'exp' ? EXP.activeScene() || scene : scene;
  if (G.mode === 'play') {
    netTick(dt, camera);
    updateAvatars(dt, sc);
    updateVoice(camera);
    const ind = UI.$('mic-ind');
    ind.className = VOICE.status !== 'on' ? 'off' : (my?.talking ? 'talk' : '') + (VOICE.radioKey ? ' radio' : '');
    ind.textContent = VOICE.status !== 'on' ? '🔇' : VOICE.radioKey ? '📻' : S.micMode === 'ptt' && !VOICE.ptt ? '🎙️ V' : '🎙️';
    ind.classList.toggle('hidden', !online());
  }
  renderer.render(sc, camera);
});
