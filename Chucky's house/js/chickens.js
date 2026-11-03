// Chicken coop behind the shop (bought on the computer). Chickens lay eggs now and then; the first egg you
// pick up unlocks the food stand window, where people from the street buy eggs.
// Feeding: one sack of feed per 4 hens, every day, at the trough. Hungry hens lay rarely and small eggs;
// better feed = more eggs and eggs that sell for more.
import * as THREE from 'three';
import { G, ACTIONS, rand, newUid } from './state.js';
import { part, hitMat } from './data.js';
import { makeChicken, animateQuad } from './creatures.js';
import { makePerson, animatePerson } from './people.js';
import { marketPrice } from './economy.js';
import { STATIC, updateWorld, interactive } from './world.js';
import { spawnSpill, penMess } from './mess.js';
import { addJob } from './jobs.js';
import { tell, act } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const PEN = { x0: -2.6, x1: 1.3, z0: -12.4, z1: -9.3 };
const HATCH_OUT = new THREE.Vector3(5.7, 0, 6.0);
let coop = null, fenceBoxes = [], troughFill = null;
const stand = [];

// q = egg value multiplier, lay = laying speed multiplier
export const FEEDS = {
  feedCheap: { icon: '🌾', name: 'Cheap Scratch', cost: 25, q: 1, lay: 1, color: 0xc8b070, desc: 'Basic grain. Normal eggs.' },
  feedGood: { icon: '🌽', name: 'Layer Pellets', cost: 60, q: 1.5, lay: 1.15, color: 0xd89a40, desc: 'More eggs, brown eggs worth 1.5× as much.' },
  feedPrime: { icon: '🥇', name: 'Organic Premium Mix', cost: 140, q: 2.3, lay: 1.3, color: 0x8a6a2a, desc: 'The most eggs, golden-yolk eggs worth 2.3× as much.' },
};
const HUNGRY = { q: 0.6, lay: 0.35 };
export const sacksNeeded = () => Math.max(1, Math.ceil((G.up.chickens || 0) / 4));
export const fedToday = () => G.fed?.day === G.day && FEEDS[G.fed.type];
const feedNow = () => fedToday() || HUNGRY;
const eggColor = q => q >= 2 ? 0xe0b060 : q >= 1.4 ? 0xc89060 : q < 0.8 ? 0xe8e0d0 : 0xf4ead8;

function buildCoop() {
  coop = new THREE.Group();
  const wood = 0x8a5a33, roof = 0x8a2a1a;
  const house = new THREE.Group(); house.position.set(0.6, 0, -11.8); coop.add(house);
  for (const x of [-0.55, 0.55]) for (const z of [-0.35, 0.35]) part(house, new THREE.BoxGeometry(0.08, 0.5, 0.08), 0x4a2a12, x, 0.25, z);
  part(house, new THREE.BoxGeometry(1.2, 0.7, 0.8), wood, 0, 0.85, 0);
  for (let k = 0; k < 5; k++) part(house, new THREE.BoxGeometry(1.21, 0.02, 0.81), 0x6a4020, 0, 0.55 + k * 0.14, 0);
  const r1 = part(house, new THREE.BoxGeometry(1.4, 0.06, 0.6), roof, 0, 1.32, -0.2); r1.rotation.x = 0.6;
  const r2 = part(house, new THREE.BoxGeometry(1.4, 0.06, 0.6), roof, 0, 1.32, 0.2); r2.rotation.x = -0.6;
  part(house, new THREE.BoxGeometry(0.3, 0.32, 0.02), 0x1a1008, 0, 0.75, 0.41);
  part(house, new THREE.BoxGeometry(0.2, 0.04, 0.5), 0x6a4020, 0, 0.35, 0.6).rotation.x = 0.5; // ramp
  // straw
  part(coop, new THREE.CylinderGeometry(0.9, 1.1, 0.04, 10), 0xd8b860, -0.6, 0.02, -10.9, { roughness: 1 });
  // pen fence with a gate gap at x -1.2..-0.3 on the north side
  const post = (x, z) => part(coop, new THREE.BoxGeometry(0.07, 0.75, 0.07), 0x6a4a2a, x, 0.375, z);
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), m = part(coop, new THREE.BoxGeometry(len, 0.05, 0.03), 0x8a6a3a, (x0 + x1) / 2, 0.6, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    part(coop, new THREE.BoxGeometry(len, 0.05, 0.03), 0x8a6a3a, (x0 + x1) / 2, 0.25, (z0 + z1) / 2).rotation.y = m.rotation.y;
    const b = new THREE.Box3(new THREE.Vector3(Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.05), new THREE.Vector3(Math.max(x0, x1) + 0.05, 0.75, Math.max(z0, z1) + 0.05));
    fenceBoxes.push(b); STATIC.push(b);
  };
  const { x0, x1, z0, z1 } = PEN;
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [-1.2, z1], [-0.3, z1]]) post(x, z);
  rail(x0, z1, -1.2, z1); rail(-0.3, z1, x1, z1); rail(x0, z0, x0, z1);
  const houseBox = new THREE.Box3(new THREE.Vector3(-0.05, 0, -12.25), new THREE.Vector3(1.25, 1.4, -11.35));
  STATIC.push(houseBox); fenceBoxes.push(houseBox);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), new THREE.MeshStandardMaterial({ map: (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 40;
    const g = c.getContext('2d'); g.fillStyle = '#f4efdf'; g.fillRect(0, 0, 128, 40); g.fillStyle = '#8a1a1a'; g.font = 'bold 22px Trebuchet MS'; g.textAlign = 'center'; g.fillText('THE GIRLS', 64, 28);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })() }));
  sign.position.set(0.6, 1.1, -11.38); coop.add(sign);
  // feed trough just inside the gate
  const trough = new THREE.Group(); trough.position.set(-1.9, 0, -9.75); coop.add(trough);
  part(trough, new THREE.BoxGeometry(0.8, 0.06, 0.3), 0x6a4020, 0, 0.12, 0);
  for (const s of [-1, 1]) {
    part(trough, new THREE.BoxGeometry(0.8, 0.14, 0.04), 0x7a4a24, 0, 0.19, s * 0.15);
    part(trough, new THREE.BoxGeometry(0.04, 0.14, 0.3), 0x7a4a24, s * 0.38, 0.19, 0);
    part(trough, new THREE.BoxGeometry(0.06, 0.12, 0.06), 0x4a2a12, s * 0.32, 0.06, 0);
  }
  troughFill = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.24), new THREE.MeshStandardMaterial({ color: 0xc8b070, roughness: 1, flatShading: true }));
  troughFill.position.y = 0.2; trough.add(troughFill);
  const hb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.45), hitMat); hb.position.y = 0.25; trough.add(hb);
  interactive(trough, 'trough');
  G.scene.add(coop);
}

function updateTrough() {
  if (!troughFill) return;
  const f = fedToday();
  troughFill.visible = !!f;
  if (f) troughFill.material.color.setHex(f.color);
}

function syncChickenCount(n) {
  while (G.chickens.length < n) {
    const k = G.chickens.length, mesh = makeChicken(k);
    mesh.position.set(rand(PEN.x0 + 0.4, PEN.x1 - 0.4), 0, rand(PEN.z0 + 0.4, PEN.z1 - 0.4));
    mesh.traverse(o => o.userData.kind = 'chicken');
    G.scene.add(mesh);
    G.chickens.push({ mesh, goal: null, wait: rand(0, 3), t: 0, lay: rand(40, 100), peck: 0, moving: false });
  }
  while (G.chickens.length > n) G.scene.remove(G.chickens.pop().mesh);
}

// Called after loading / buying / co-op snapshots.
export function updateCoop() {
  if (G.up.coop && !coop) buildCoop();
  if (coop) syncChickenCount(G.up.chickens);
}

function spawnEgg(x, z, eid = newUid(), q = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const shell = part(g, new THREE.SphereGeometry(0.035, 8, 6), eggColor(q), 0, 0.04, 0, q >= 2 ? { metalness: 0.3, roughness: 0.4 } : undefined);
  shell.scale.set(q < 0.8 ? 0.8 : 1, q < 0.8 ? 1.05 : 1.3, q < 0.8 ? 0.8 : 1);
  const hb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), hitMat); hb.position.y = 0.1; g.add(hb);
  g.userData.eid = eid; g.userData.q = q;
  g.traverse(o => { o.userData.kind = 'egg'; o.userData.ref = g; });
  G.scene.add(g);
  G.eggMeshes.push(g);
  return g;
}
function removeEgg(g) { G.scene.remove(g); G.eggMeshes.splice(G.eggMeshes.indexOf(g), 1); }

// ---------- host simulation ----------
export function updateChickens(dt, host) {
  const daytime = G.phase !== 'evening', feed = feedNow();
  updateTrough();
  if (host && G.chickens.length && !fedToday() && G.phase === 'open' && !G.alerted.has('hungry' + G.day)) {
    G.alerted.add('hungry' + G.day);
    G.alertFn?.('🐔 The hens are hungry! Fill the trough in the yard (feed: computer → Upgrades).');
  }
  for (const c of G.chickens) {
    const m = c.mesh;
    if (host) {
      if (daytime && (c.lay -= dt * feed.lay) <= 0) {
        c.lay = rand(50, 110) * (1 + penMess() * 0.25); // a messy pen = fewer eggs
        if (G.eggMeshes.length < 12) { spawnEgg(m.position.x + rand(-0.15, 0.15), m.position.z + rand(-0.15, 0.15), newUid(), feed.q); sfx.cluck(0.5); }
      }
      // hungry hens hang around the trough
      if (!fedToday() && !c.goal && c.wait <= 0 && Math.random() < 0.5) c.goal = new THREE.Vector3(-1.9 + rand(-0.4, 0.4), 0, -9.75 - rand(0.25, 0.6));
      if (daytime && Math.random() < dt / 150 && penMess() < 6) spawnSpill('poop', m.position.x, m.position.z);
      if (!c.goal && (c.wait -= dt) <= 0) c.goal = new THREE.Vector3(rand(PEN.x0 + 0.3, PEN.x1 - 0.3), 0, rand(PEN.z0 + 0.3, PEN.z1 - 0.3));
      c.moving = false;
      if (c.goal) {
        const d = c.goal.clone().sub(m.position); d.y = 0;
        if (d.length() < 0.08) { c.goal = null; c.wait = rand(1, 5); c.peck = rand(0.5, 2); }
        else { m.position.addScaledVector(d.normalize(), Math.min(d.length(), 0.6 * dt)); m.rotation.y = Math.atan2(d.x, d.z); c.moving = true; }
      }
    } else if (c.tgt) {
      const k = Math.min(1, dt * 8);
      m.position.x += (c.tgt[0] - m.position.x) * k; m.position.z += (c.tgt[1] - m.position.z) * k; m.rotation.y = c.tgt[2]; c.moving = !!c.tgt[3];
    }
    c.t += dt * (c.moving ? 14 : 0);
    animateQuad(m, c.t, c.moving);
    if (!c.moving && (c.peck -= dt) > 0) m.userData.head.rotation.x = 0.6 + Math.sin(performance.now() * 0.02) * 0.4;
    else m.userData.head.rotation.x = 0;
  }
  if (Math.random() < dt * 0.05 && G.chickens.length) sfx.cluck(0.25);
  updateStand(dt, host);
}

// ---------- egg stand customers ----------
function updateStand(dt, host) {
  if (host && G.up.stand && G.phase === 'open' && G.eggs > 0 && stand.length < 2) {
    G.standT -= dt;
    if (G.standT <= 0) {
      G.standT = rand(22, 45);
      const side = Math.random() < 0.5 ? -1 : 1, seed = Math.random() * 1e9 | 0, mesh = makePerson({ seed });
      mesh.position.set(side * 15, 0, 6.9);
      G.scene.add(mesh);
      stand.push({ id: newUid(), seed, mesh, path: [new THREE.Vector3(5.7 + side * 2, 0, 6.9), HATCH_OUT.clone().add(new THREE.Vector3(0, 0, stand.length * 0.8))], wait: 0, t: 0, state: 'come' });
    }
  }
  G.standWaiting = false;
  for (const s of [...stand]) {
    const m = s.mesh, tgt = s.path[0];
    let walking = false;
    if (host) {
      if (tgt) {
        const d = tgt.clone().sub(m.position); d.y = 0;
        if (d.length() > 0.05) { m.position.addScaledVector(d.normalize(), Math.min(d.length(), 1.4 * dt)); m.rotation.y = Math.atan2(d.x, d.z); walking = true; }
        else { s.path.shift(); if (!s.path.length && s.state === 'leave') { G.scene.remove(m); stand.splice(stand.indexOf(s), 1); continue; } }
      } else if (s.state === 'come') { s.state = 'wait'; sfx.bell(); G.alertFn?.('🥚 Someone rang the bell at the egg window!'); }
      if (s.state === 'wait') {
        m.rotation.y = Math.PI;
        if ((s.wait += dt) > 45) leaveStand(s);
      }
    } else if (s.tgt) {
      const k = Math.min(1, dt * 10);
      m.position.x += (s.tgt[0] - m.position.x) * k; m.position.z += (s.tgt[1] - m.position.z) * k; m.rotation.y = s.tgt[2]; walking = !!s.tgt[3];
    }
    if (s.state === 'wait') G.standWaiting = true;
    s.t += walking ? dt * 8 : 0;
    animatePerson(m, s.t, walking);
  }
}
function leaveStand(s) {
  s.state = 'leave';
  const side = Math.random() < 0.5 ? -1 : 1;
  s.path = [new THREE.Vector3(5.7 + side * 2, 0, 6.9), new THREE.Vector3(side * 16, 0, 6.9)];
}

// ---------- actions ----------
ACTIONS.collectEgg = (pid, eid) => {
  const g = G.eggMeshes.find(e => e.userData.eid === eid);
  if (!g) return false;
  removeEgg(g);
  const q = g.userData.q || 1;
  G.eggQ = ((G.eggQ || 1) * G.eggs + q) / (G.eggs + 1); // average egg quality in the basket
  G.eggs++;
  addJob(pid, 'stocker', 2, 'eggs');
  sfx.egg();
  const kind = q >= 2 ? 'Golden-yolk egg' : q >= 1.4 ? 'Brown egg' : q < 0.8 ? 'Small egg (hungry hen)' : 'Egg';
  if (!G.up.stand) { G.up.stand = true; tell(pid, '🥚 First egg! The food stand window is now open: sell eggs to people on the street.'); }
  else tell(pid, `${kind} collected (${G.eggs} in the basket).`);
  updateWorld();
  return true;
};
ACTIONS.feedHens = (pid, type) => {
  const f = FEEDS[type], n = sacksNeeded();
  if (!f) return false;
  if (fedToday()) { tell(pid, 'The hens already ate today.'); return false; }
  if ((G.gear[type] || 0) < n) { tell(pid, `You need ${n} sack${n > 1 ? 's' : ''} of ${f.name} (you have ${G.gear[type] || 0}).`, 'bad'); return false; }
  G.gear[type] -= n;
  G.fed = { day: G.day, type };
  addJob(pid, 'stocker', 2, 'eggs');
  sfx.cluck(0.8); sfx.thud(0.4);
  tell(pid, `${f.icon} Hens fed with ${f.name}. ${f.q > 1 ? 'Better eggs today!' : ''}`);
  updateTrough();
  return true;
};

export function troughHint(E) {
  const f = fedToday();
  if (f) return `${f.icon} Hens fed today: <b>${f.name}</b>`;
  return `${E} <b class="down">Feed the hens</b> <span class="dim">(${sacksNeeded()} sack${sacksNeeded() > 1 ? 's' : ''} a day · hungry hens lay small eggs)</span>`;
}
export function troughPanel() {
  if (fedToday()) return UI.toast('The hens already ate today. Come back tomorrow morning.');
  const n = sacksNeeded();
  UI.openPanel(`<h2>🐔 Feed the hens</h2><p class="dim">${G.up.chickens} hens eat ${n} sack${n > 1 ? 's' : ''} a day. Feed them every morning: hungry hens lay rarely and only small eggs. Buy feed on the computer (Upgrades).</p>
    <div class="list">${Object.entries(FEEDS).map(([k, f]) => `<div class="pc-row"><span class="big">${f.icon}</span><span class="grow"><b>${f.name}</b><br><small class="dim">${f.desc}</small></span>
      <span class="dim">Have ${G.gear[k] || 0}</span><button data-feed="${k}" ${(G.gear[k] || 0) >= n ? '' : 'disabled'}>Feed</button></div>`).join('')}</div>
    <div class="row"><button id="fd-x" class="ghost">Close</button></div>`);
  document.querySelectorAll('[data-feed]').forEach(b => b.onclick = async () => { UI.closePanel(); await act('feedHens', b.dataset.feed); });
  UI.$('fd-x').onclick = () => UI.closePanel();
}
ACTIONS.serveStand = pid => {
  const s = stand.find(x => x.state === 'wait');
  if (!s) return tell(pid, 'Nobody is waiting at the window.');
  if (!G.eggs) { leaveStand(s); return tell(pid, '"No eggs? Pity."', 'bad'); }
  const n = Math.min(G.eggs, 1 + (Math.random() * 6 | 0));
  const price = Math.max(1, Math.round(marketPrice('egg') * (1 + G.trust * 0.5) * (G.eggQ || 1)));
  G.eggs -= n;
  if (!G.eggs) G.eggQ = 1;
  G.money += n * price; G.stats.eggs += n * price; G.life.eggs += n;
  addJob(pid, 'stocker', 3, 'eggs');
  sfx.cash();
  tell(pid, `Sold ${n} egg${n > 1 ? 's' : ''} for ${UI.money(n * price)}.`);
  leaveStand(s);
  updateWorld();
  return true;
};

// ---------- co-op snapshot ----------
export const coopSnap = () => ({
  ch: G.chickens.map(c => [+c.mesh.position.x.toFixed(2), +c.mesh.position.z.toFixed(2), +c.mesh.rotation.y.toFixed(2), c.moving ? 1 : 0]),
  eg: G.eggMeshes.map(e => [e.userData.eid, +e.position.x.toFixed(2), +e.position.z.toFixed(2), e.userData.q || 1]),
  st: stand.map(s => [s.id, s.seed, +s.mesh.position.x.toFixed(2), +s.mesh.position.z.toFixed(2), +s.mesh.rotation.y.toFixed(2), s.path.length ? 1 : 0, s.state === 'wait' ? 1 : 0]),
});
export function mirrorCoop(d) {
  updateCoop();
  d.ch.forEach((t, i) => { if (G.chickens[i]) G.chickens[i].tgt = t; });
  const seen = new Set(d.eg.map(e => e[0]));
  for (const g of [...G.eggMeshes]) if (!seen.has(g.userData.eid)) removeEgg(g);
  for (const [eid, x, z, q] of d.eg) if (!G.eggMeshes.some(g => g.userData.eid === eid)) spawnEgg(x, z, eid, q);
  const ids = new Set(d.st.map(s => s[0]));
  for (const s of [...stand]) if (!ids.has(s.id)) { G.scene.remove(s.mesh); stand.splice(stand.indexOf(s), 1); }
  for (const [id, seed, x, z, ry, w, waiting] of d.st) {
    let s = stand.find(q => q.id === id);
    if (!s) { const mesh = makePerson({ seed }); mesh.position.set(x, 0, z); G.scene.add(mesh); s = { id, seed, mesh, path: [], t: 0, state: 'come' }; stand.push(s); }
    s.tgt = [x, z, ry, w]; s.state = waiting ? 'wait' : 'come';
  }
}

// Saved eggs on the ground.
export const eggSave = () => G.eggMeshes.map(e => [+e.position.x.toFixed(2), +e.position.z.toFixed(2), e.userData.q || 1]);
export function eggLoad(list = []) { for (const [x, z, q] of list) spawnEgg(x, z, undefined, q || 1); }
