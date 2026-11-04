// Sandbox admin panel. The host always has it; with "Admin panel for everyone" guests get it too: their world
// actions run on the host, placed around the guest who clicked. "Give me" items are always local.
import * as THREE from 'three';
import { G, rand, isGuest } from './state.js';
import { spawnShip, SHIP_TYPES } from './ship.js';
import { populateShip, spawnCrate, spawnShark, clearSharks, updateStorage, LOOT } from './entities.js';
import { makeAI } from './ai.js';
import { WEAPONS, PRIMARIES, SECONDARIES, armNuke, callAirstrike, hitscan, gunState } from './weapons.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';
import { act } from './net.js';
import { kn } from './keys.js';

const $ = id => document.getElementById(id);

function ahead(who, dist, side = 0) {
  const p = who.worldPos(new THREE.Vector3());
  const ship = who.stationShip?.();
  const yaw = who.mode === 'walk' || !ship ? who.worldYaw() + Math.PI : ship.yaw;
  return { x: p.x + Math.sin(yaw) * dist + Math.cos(yaw) * side, z: p.z + Math.cos(yaw) * dist - Math.sin(yaw) * side, y: p.y, yaw };
}
function aimPoint(who) {
  if (who !== G.me) { const a = ahead(who, 100); return new THREE.Vector3(a.x, 0, a.z); }
  const cam = G.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const h = hitscan(o, d, 500, G.me);
  return h ? h.point : o.addScaledVector(d, 120).setY(0);
}
export function spawnEnemy(key, ghost = false, who = G.me) {
  const a = ahead(who, rand(110, 160), rand(-40, 40));
  const s = spawnShip(key, { team: 'enemy', x: a.x, z: a.z, yaw: a.yaw + Math.PI + rand(-0.5, 0.5), guns: SHIP_TYPES[key].maxGuns, ghost, hpMult: ghost ? 2 : 1, name: (ghost ? 'Ghost ' : 'Raider ') + SHIP_TYPES[key].name.toLowerCase() });
  populateShip(s); G.hookShip?.(s); makeAI(s);
  G.announce?.(`☠️ An enemy ${SHIP_TYPES[key].name.toLowerCase()} appeared!`, 'bad');
}
function spawnEmpty(key, who) {
  const a = ahead(who, 14, 26);
  const s = spawnShip(key, { team: 'player', x: a.x, z: a.z, yaw: a.yaw, guns: SHIP_TYPES[key].maxGuns, name: 'Spare ' + SHIP_TYPES[key].name.toLowerCase() });
  populateShip(s); G.hookShip?.(s);
  G.announce?.(`⛵ An empty ${SHIP_TYPES[key].name.toLowerCase()} is waiting.`);
}
const shipOf = who => who.stationShip?.() || who.frame || who.home;
function give(id) { const def = WEAPONS[id]; G.me.inv[def.slot] = gunState(id, G.me.kit.att?.[id] || {}); G.me.slot = def.slot; G.toast(`${def.name} equipped.`); }

// [title, local?, buttons]   buttons: [label, fn(who)]
const SECTIONS = () => [
  ['Enemy ships', false, [...Object.keys(SHIP_TYPES).map(k => [`☠️ ${SHIP_TYPES[k].name}`, w => spawnEnemy(k, false, w)]), ['👻 Ghost cruise liner', w => spawnEnemy('cruise', true, w)]]],
  ['Empty ships (anyone can drive)', false, Object.keys(SHIP_TYPES).map(k => [`⛵ ${SHIP_TYPES[k].name}`, w => spawnEmpty(k, w)])],
  ['Supply crates (drop above you)', false, [['🎲 Random crate', w => { const a = ahead(w, 4); spawnCrate(new THREE.Vector3(a.x, a.y + 25, a.z)); }], ...Object.keys(LOOT).map(k => [LOOT[k], w => { const a = ahead(w, 4); spawnCrate(new THREE.Vector3(a.x, a.y + 25, a.z), k); }])]],
  ['Give me', true, [...PRIMARIES, ...SECONDARIES].map(w => [WEAPONS[w].name, () => give(w)]).concat([
    ['💣 Grenades × 5', () => { G.me.inv.gadget = { id: 'grenade', count: 5 }; G.toast(`5 grenades in slot ${kn('slot3')}.`); }],
    ['💣 C4 × 5', () => { G.me.inv.gadget = { id: 'c4', count: 5 }; G.toast(`5 C4 in slot ${kn('slot3')}.`); }],
    ['✈️ Airstrike flare', () => { G.me.inv.special = { id: 'flare', count: 1 }; G.toast(`Flare in slot ${kn('slot4')}.`); }],
    ['☢️ Nuke remote', () => { G.me.inv.special = { id: 'nuke', count: 1 }; G.toast(`Nuke remote in slot ${kn('slot4')}.`); }],
    ['❤️ Heal', () => { G.me.hp = 100; }],
  ])],
  ['My ship', false, [
    ['🔧 Repair', w => shipOf(w)?.repairAll()],
    ['🪣 Pump out water', w => shipOf(w)?.pumpAll()],
    ['🪵 +6 planks', w => { const s = shipOf(w); if (s) { s.storage.planks = Math.min(12, s.storage.planks + 6); updateStorage(s); } }],
    ['🔥 Start a fire', w => { const s = shipOf(w); if (s) s.ignite(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-s.hl, s.hl) * 0.5), true); }],
    ['💥 Sink it', w => { const s = shipOf(w); if (s) for (const c of s.comps) c.vol = c.cap; }],
  ]],
  ['World', false, [
    ['🌊 Calm sea', () => { G.seaAmp = 0.4; }], ['🌊 Normal sea', () => { G.seaAmp = 1; }], ['⛈️ Storm', () => { G.seaAmp = 2.1; }],
    ['⚡ Lightning on my ship', w => { const s = shipOf(w); if (!s) return; const p = s.toWorld(new THREE.Vector3(rand(-1, 1), s.deckTop + 0.5, rand(-s.hl, s.hl) * 0.6)); s.damageSphere(p, 1, 6, null, 1); FX.explosion(p.x, p.y, p.z, 0.7); G.netFx?.({ k: 'boom', p: [p.x, p.y, p.z], r: 0.7 }); G.flashScreen = 0.3; sfx.thunder(); }],
    ['🦈 Spawn shark', w => { const p = w.worldPos(new THREE.Vector3()); spawnShark(p.x + rand(-25, 25), p.z + rand(-25, 25)); }],
    ['🦈 Remove sharks', () => { for (const s of G.sharks) G.netHook?.('despawn', 'shark', s); clearSharks(); }],
    ['✈️ Airstrike at crosshair', w => callAirstrike(aimPoint(w), w)],
    ['☢️ Nuke at crosshair', w => { if (!armNuke(aimPoint(w), w)) G.toast('A nuke is already armed.'); }],
    ['☠️ Sink all enemies', () => { for (const s of G.ships) if (s.team === 'enemy') for (const c of s.comps) c.vol = c.cap; }],
  ]],
];
const TOGGLES = [['god', '😇 God mode (just you)'], ['infAmmo', '♾️ Infinite ammo (just you)'], ['drops', '📦 Random supply drops'], ['everyone', '👥 Admin panel for everyone']];

// host side: run a guest's request
G.adminRun = (label, who) => {
  for (const [, local, btns] of SECTIONS()) { if (local) continue; const b = btns.find(x => x[0] === label); if (b) { b[1](who); return; } }
};

export function canAdmin() { return G.mode === 'sandbox' && (!isGuest() || G.admin.everyone); }
export function buildAdmin() {
  const box = $('admin-body');
  box.innerHTML = '';
  for (const [title, local, btns] of SECTIONS()) {
    const sec = document.createElement('div'); sec.className = 'adm-sec';
    sec.innerHTML = `<h4>${title}</h4>`;
    const row = document.createElement('div'); row.className = 'adm-row';
    for (const [label, fn] of btns) {
      const b = document.createElement('button'); b.textContent = label;
      b.onclick = () => { if (isGuest() && !local) act('admin', label); else fn(G.me); };
      row.append(b);
    }
    sec.append(row); box.append(sec);
  }
  const sec = document.createElement('div'); sec.className = 'adm-sec';
  sec.innerHTML = '<h4>Rules</h4>';
  for (const [k, label] of TOGGLES) {
    if (isGuest() && (k === 'everyone' || k === 'drops')) continue;
    const l = document.createElement('label'); l.className = 'adm-tog';
    l.innerHTML = `<input type="checkbox" ${G.admin[k] ? 'checked' : ''}> ${label}`;
    l.querySelector('input').onchange = e => { G.admin[k] = e.target.checked; if (k === 'everyone') G.announce?.(e.target.checked ? '🛠️ Everyone can open the admin panel now.' : '🛠️ Only the host has the admin panel.'); };
    sec.append(l);
  }
  box.append(sec);
}
export function setAdmin(open) {
  G.admin.open = open;
  $('admin').classList.toggle('hidden', !open);
  if (open) buildAdmin();
}
