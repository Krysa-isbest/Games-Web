// Night expeditions. Same seed = same map/loot/enemies on every machine; the host runs the AI, physics
// and the truck, guests mirror it and send their actions. Solo = you are the host.
import * as THREE from 'three';
import { G, ACTIONS, pick, rand, rng, clamp, me } from './state.js';
import { itemById, makeItemMesh, makeInst, part, hitMat, canvasTex } from './data.js';
import { MAP, free, los, buildAlley, buildJunkyard, LOOT_TABLES } from './maps.js';
import { spawnEnemies, updateEnemiesHost, noise, stunMult, enemySnap, mirrorEnemies, lerpEnemies } from './enemies.js';
import { PhysWorld, throwFrom } from './physics.js';
import { dismantle } from './minigames.js';
import { SKULLS, value } from './economy.js';
import { NET, act, send, broadcast, on, tell, isGuest } from './net.js';
import { addJob, bagCap, perk } from './jobs.js';
import { noiseRing, resetChips } from './fun.js';
import { addPage } from './story.js';
import { kb } from './keys.js';
import { tip } from './tips.js';
import { S } from './settings.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

export const LOCATIONS = {
  alley: { name: 'Back Alley', icon: '🏚️', time: 360, enemy: 'Homeless people, rats',
    desc: 'Dark alleys behind the city. The people living here do NOT like visitors, and the rats come in packs.', loot: 'Household stuff, electronics, the odd ring' },
  junkyard: { name: 'Junkyard', icon: '🚗', time: 420, enemy: 'One old man with a shotgun, 2–4 dogs',
    desc: 'A huge fenced yard of crushed cars. The owner patrols with a flashlight; his dogs hear everything. Hide in wrecks and porta-potties.', loot: 'Car parts, scrap, motorbikes, the owner\'s treasures' },
};
export const EVENTS = [
  { id: 'night', name: 'Quiet Night', desc: 'Just a normal, dark night. Stay sharp.' },
  { id: 'day', name: 'Daytime', desc: 'The sun is up. Fewer enemies, but they see further.' },
  { id: 'angry', name: 'Enemies are Angrier', desc: 'They are faster and hit a lot harder.' },
  { id: 'fog', name: 'Thick Fog', desc: 'You can barely see your own hands. Neither can they.' },
  { id: 'blackout', name: 'Blackout', desc: 'Every light out here is dead.' },
];
const WEAPONS = {
  fists: { icon: '👊', name: 'Fists', melee: true, dmg: 10, range: 1.6, cd: 0.4 },
  bat: { icon: '🏏', name: 'Bat', melee: true, dmg: 25, range: 2.3, cd: 0.55 },
  baton: { icon: '🦯', name: 'Baton', melee: true, dmg: 4, stun: 3.5, range: 2.1, cd: 0.6 },
  pepper: { icon: '🌶️', name: 'Pepper', cone: true, stun: 4, range: 3.6, cd: 1, gear: 'pepper' },
  taser: { icon: '⚡', name: 'Taser', ray: true, stun: 6.5, range: 8, cd: 1.5, gear: 'taser' },
  revolver: { icon: '🔫', name: 'Revolver', ray: true, dmg: 40, range: 35, cd: 0.45, gear: 'ammo9', loud: 30 },
  shotgun: { icon: '🎯', name: 'Shotgun', pellets: 8, dmg: 12, range: 18, cd: 1.0, gear: 'shells', loud: 35 },
};
const BATTERY_BASE = 120, BLEED = 30, V = (x, y, z) => new THREE.Vector3(x, y, z);
const HOSPITAL = { down: 60, dead: 140 }; // next-morning bill per player
let E = null;
// Scavenger lv 5: batteries last 50 % longer.
const battery = () => BATTERY_BASE * (perk(G.me, 'scav') >= 5 ? 1.5 : 1);
let BATTERY = BATTERY_BASE;

export const activeScene = () => E?.scene;
export const isOver = () => !E || E.over;
export const inExp = () => !!E;
export const blocked = (x, z) => !free(x, z);
const P = () => E.camera.position;
const forward = () => { const f = new THREE.Vector3(); E.camera.getWorldDirection(f); f.y = 0; return f.normalize(); };
const bagSize = bag => bag.reduce((s, i) => s + (itemById(i.id).size || 1), 0);

// ---------- truck ----------
function aabb(g, x0, x1, y0, y1, z0, z1) {
  g.updateMatrixWorld(true);
  const b = new THREE.Box3();
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) b.expandByPoint(V(x, y, z).applyMatrix4(g.matrixWorld));
  return b;
}
function buildTruck(at) {
  const g = new THREE.Group(); g.position.set(at.x, 0, at.z); g.rotation.y = at.ry;
  const body = 0x8a2a1a, dark = 0x151515, chrome = { metalness: 0.8, roughness: 0.3 };
  part(g, new THREE.BoxGeometry(5.2, 0.35, 1.9), 0x2a2a2a, 0, 0.55, 0);
  part(g, new THREE.BoxGeometry(1.6, 0.85, 1.9), body, 1.75, 1.05, 0, { metalness: 0.4, roughness: 0.5 }); // hood
  part(g, new THREE.BoxGeometry(1.5, 0.9, 1.85), body, 0.45, 1.6, 0, { metalness: 0.4, roughness: 0.5 }); // cab
  part(g, new THREE.BoxGeometry(0.05, 0.6, 1.7), 0x1a2633, 1.2, 1.7, 0, { roughness: 0.1, metalness: 0.5 }).rotation.z = 0.35;
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(1.1, 0.5, 0.05), 0x1a2633, 0.45, 1.75, s * 0.93, { roughness: 0.1 });
  part(g, new THREE.BoxGeometry(1.5, 0.4, 1.9), body, 0.45, 0.95, 0);
  // bed (the "longer bed" upgrade adds a metre at the back)
  const L = G.up.truckBed ? 1 : 0;
  part(g, new THREE.BoxGeometry(2.7 + L, 0.08, 1.9), 0x3a3a3a, -1.0 - L / 2, 0.75, 0, { metalness: 0.5 });
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(2.7 + L, 0.55, 0.08), body, -1.0 - L / 2, 1.0, s * 0.92, { metalness: 0.4, roughness: 0.5 });
  part(g, new THREE.BoxGeometry(0.08, 0.55, 1.9), body, -2.32 - L, 1.0, 0, { metalness: 0.4 });
  if (L) part(g, new THREE.BoxGeometry(L, 0.35, 1.9), 0x2a2a2a, -2.6 - L / 2 + 0.25, 0.55, 0);
  if (G.up.truckWinch) { part(g, new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10), 0x444444, -2.1 - L, 1.4, 0, chrome).rotation.x = Math.PI / 2; }
  part(g, new THREE.BoxGeometry(5.3, 0.2, 2.0), 0x777777, 0, 0.42, 0, chrome).scale.set(1, 0.5, 1);
  for (const [x, s] of [[1.55, 1], [-1.55, 1], [1.55, -1], [-1.55, -1]]) {
    part(g, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), dark, x, 0.42, s * 0.92, { roughness: 0.9 }).rotation.x = Math.PI / 2;
    part(g, new THREE.CylinderGeometry(0.22, 0.22, 0.31, 10), 0xb0b4b8, x, 0.42, s * 0.92, chrome).rotation.x = Math.PI / 2;
  }
  for (const s of [-0.7, 0.7]) part(g, new THREE.BoxGeometry(0.05, 0.18, 0.35), 0xffffee, 2.56, 1.05, s, { emissive: 0xffffaa });
  const hl = new THREE.SpotLight(0xfff2d0, G.up.truckLights ? 70 : 30, 18, 0.5, 0.5, 1); hl.position.set(2.6, 1.0, 0); hl.target.position.set(8, 0, 0);
  g.add(hl, hl.target);
  const cabLight = new THREE.PointLight(0xffe0b0, 3, 4); cabLight.position.set(0.45, 1.8, 0); g.add(cabLight);
  E.scene.add(g);
  g.updateMatrixWorld(true);
  const t = {
    g, pos: V(at.x, 0, at.z),
    bed: aabb(g, -2.28 - L, 0.25, 0.79, 3, -0.88, 0.88),
    bedCenter: V(-1.0 - L / 2, 1, 0).applyMatrix4(g.matrixWorld),
    door: V(0.45, 1, 1.6).applyMatrix4(g.matrixWorld),
    seat: V(0.45, 1.55, 0.4).applyMatrix4(g.matrixWorld),
    front: V(2.6, 0, 0).applyMatrix4(g.matrixWorld),
    dir: V(Math.cos(at.ry), 0, -Math.sin(at.ry)),
    parts: [aabb(g, -2.36 - L, 0.3, 0.55, 0.79, -1, 1), aabb(g, -2.36 - L, 0.3, 0.7, 1.3, -1, -0.88), aabb(g, -2.36 - L, 0.3, 0.7, 1.3, 0.88, 1),
      aabb(g, -2.4 - L, -2.28 - L, 0.7, 1.3, -1, 1), aabb(g, -0.3, 2.6, 0.4, 2.1, -1, 1)],
  };
  MAP.boxes.push(aabb(g, -2.4 - L, 2.6, 0, 2.1, -1, 1));
  return t;
}

// ---------- loot ----------
let GLINT;
const glintTex = () => GLINT ??= canvasTex(32, 32, g => {
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, '#fffbe0'); r.addColorStop(0.3, '#ffd86a88'); r.addColorStop(1, '#ffd86a00');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#fff'; g.fillRect(15, 2, 2, 28); g.fillRect(2, 15, 28, 2);
});
function rollLoot(r, boost) {
  const t = LOOT_TABLES[E.locId], x = r() * (1 + boost + E.skulls * 0.12);
  const rarity = x < 0.6 ? 'common' : x < 0.88 ? 'uncommon' : 'rare';
  const l = t[rarity];
  return { id: l[r() * l.length | 0], rarity };
}
function addLoot(lid, id, rarity, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = (lid * 1.7) % 6.28;
  g.add(makeItemMesh(itemById(id)));
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: rarity === 'rare' ? 0xffd040 : rarity === 'uncommon' ? 0x8fd0ff : 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glint.position.y = 0.35; glint.scale.setScalar(rarity === 'rare' ? 0.6 : 0.4); g.add(glint);
  const hb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), hitMat); hb.position.y = 0.2; g.add(hb);
  const l = { lid, g, id, rarity, glint, x, z, seed: lid * 0.37 };
  g.traverse(o => o.userData.loot = l);
  E.scene.add(g); E.loot.push(l);
  return l;
}
function removeLoot(l) { E.scene.remove(l.g); E.loot.splice(E.loot.indexOf(l), 1); }
const hostLoot = (id, rarity, x, z) => addLoot(E.nextLid++, id, rarity, x, z);

// ---------- big objects ----------
function addBig(bid, id, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  g.add(makeItemMesh(itemById(id)));
  const bb = new THREE.Box3().setFromObject(g), s = bb.getSize(V(0, 0, 0));
  const hb = new THREE.Mesh(new THREE.BoxGeometry(s.x + 0.2, s.y, s.z + 0.2), hitMat); hb.position.y = s.y / 2; hb.rotation.y = 0;
  g.add(hb);
  const b = { bid, id, g, carriers: [], loaded: false, gone: false };
  g.traverse(o => o.userData.big = b);
  E.scene.add(g); E.bigs.push(b);
  return b;
}

// ---------- start ----------
// params: { loc, seed, skulls, ev } (the same object on every player's machine)
export function start(params, camera) {
  const loc = LOCATIONS[params.loc], ev = EVENTS.find(e => e.id === params.ev) || EVENTS[0];
  const scene = new THREE.Scene(), r = rng(params.seed);
  BATTERY = battery();
  G.expLoc = params.loc;
  E = {
    locId: params.loc, loc, ev, skulls: params.skulls, seed: params.seed, scene, camera,
    loot: [], bigs: [], hides: [], crates: [], enemies: [], traps: [], lamps: [], fires: [], fx: [], nextLid: 1000, nextTrap: 1,
    hp: 100, down: false, dead: false, bleed: 0, heartT: 0, hidden: null, inCab: false, carrying: null, crouch: false, spectate: 0,
    time: loc.time, bag: [], bags: {}, cab: new Set(), slot: 0, cd: 0, swingT: 0, shake: 0, hudT: 0, snapT: 0, dragT: 0, leaveT: 0,
    charge: G.tools.flashlight ? BATTERY : 0, lightOn: false, warned: false, over: false,
    hosp: {}, noise: 0, stepT: 0, engineT: 2, safe: null, objDone: false,
  };
  resetChips();
  const day = ev.id === 'day';
  const sky = day ? 0x9fb4c8 : ev.id === 'fog' ? 0x15181d : 0x05070d;
  scene.background = new THREE.Color(sky);
  const fogFar = ev.id === 'fog' ? 10 : day ? 70 : 30;
  scene.fog = new THREE.Fog(sky, ev.id === 'fog' ? 0.5 : day ? 25 : 6, Math.min(fogFar, S.viewDist));
  scene.userData.fogFar = fogFar; // events like Thick Fog must never be pushed back by the view distance setting
  scene.add(new THREE.HemisphereLight(day ? 0xdfe8f0 : 0x5a6a9a, 0x1a1410, day ? 1.3 : ev.id === 'blackout' ? 0.07 : 0.16));
  const moon = new THREE.DirectionalLight(day ? 0xfff2dd : 0x8090c0, day ? 1.6 : 0.2);
  moon.position.set(10, 30, 5); scene.add(moon);

  (params.loc === 'junkyard' ? buildJunkyard : buildAlley)(E, r);
  E.truck = buildTruck(E.truckAt);
  E.wallBoxes = [];
  for (let i = 0; i < MAP.N; i++) for (let j = 0; j < MAP.N; j++) if (!MAP.grid[i][j]) {
    const x = i * MAP.T, z = j * MAP.T, h = MAP.T / 2;
    E.wallBoxes.push(new THREE.Box3(V(x - h, 0, z - h), V(x + h, 8, z + h)));
  }
  E.phys = new PhysWorld(scene, () => [...E.truck.parts, ...MAP.boxes.slice(0, -1), ...E.wallBoxes]);

  E.lootSpots.forEach((s, k) => { const { id, rarity } = rollLoot(r, s.boost); if (free(s.x, s.z, 0.3)) addLoot(k, id, rarity, s.x, s.z); });
  E.bigSpots.forEach((s, k) => addBig(k, s.id, s.x, s.z, s.ry));
  spawnEnemies(E, r);
  setupObjective(rng(params.seed + 7));

  // player, flashlight, view model
  scene.add(camera);
  camera.position.set(E.spawn.x + (G.me.charCodeAt(1) - 48) * 0.8, 1.6, E.spawn.z);
  camera.rotation.set(0, E.spawn.ry, 0);
  E.spot = new THREE.SpotLight(0xfff2d8, 0, 26, 0.42, 0.45, 1.2);
  E.spot.position.set(0.15, -0.1, 0); E.spot.target.position.set(0, 0, -6);
  E.spot.castShadow = S.shadows !== 'off';
  camera.add(E.spot, E.spot.target);
  E.flash = new THREE.PointLight(0xffc070, 0, 8); E.flash.position.set(0.2, -0.1, -0.6); camera.add(E.flash);
  E.vm = new THREE.Group(); camera.add(E.vm); buildViewModel();

  const card = UI.$('event-card');
  card.innerHTML = `<small>${loc.icon} ${loc.name.toUpperCase()} · ${UI.skulls(E.skulls)}</small><h1>${ev.name}</h1><p>${ev.desc}</p>
    ${E.objective ? `<p class="obj">⭐ Optional: ${E.objective}</p>` : ''}`;
  card.classList.remove('hidden', 'out');
  setTimeout(() => card.classList.add('out'), 3800);
  setTimeout(() => card.classList.add('hidden'), 4600);
  UI.$('hide-vig').classList.add('hidden');
  hud();
}

// ---------- night objectives (optional, big reward, carry the story) ----------
// Alley: one of Chuck's ledger pages lies somewhere far from the truck. Junkyard: crack Rusty's safe.
function setupObjective(r2) {
  if (G.story.pages.length >= 6) { E.objective = null; return; }
  if (E.locId === 'alley') {
    E.objective = 'Find Chuck\'s ledger page (📜) and bring it home.';
    const spots = [...E.lootSpots].sort((a, b) => Math.hypot(b.x - E.spawn.x, b.z - E.spawn.z) - Math.hypot(a.x - E.spawn.x, a.z - E.spawn.z));
    const s = spots[(r2() * 3) | 0] || spots[0];
    if (s) addLoot(900, 'ledger', 'rare', s.x + 0.5, s.z + 0.3);
  } else if (E.trailer) {
    E.objective = 'Crack Rusty\'s safe in his trailer (E, takes a while, it\'s loud).';
    const g = new THREE.Group(); g.position.set(E.trailer.x + 1.4, 0, E.trailer.z);
    part(g, new THREE.BoxGeometry(0.7, 0.8, 0.6), 0x2a2e34, 0, 0.4, 0, { metalness: 0.6, roughness: 0.4 });
    part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), 0xc9a227, 0, 0.5, 0.31, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    const door = part(g, new THREE.BoxGeometry(0.6, 0.7, 0.04), 0x3a3e44, 0, 0.4, 0.31, { metalness: 0.6 });
    E.scene.add(g);
    E.safe = { g, door, x: g.position.x, z: g.position.z, progress: 0, open: false, cracking: false };
    g.traverse(o => o.userData.safe = E.safe);
    MAP.boxes.push(new THREE.Box3(V(g.position.x - 0.35, 0, g.position.z - 0.3), V(g.position.x + 0.35, 0.8, g.position.z + 0.3)));
  }
}
ACTIONS.xSafe = pid => {
  const s = E?.safe;
  if (!s || s.open) return false;
  s.open = true; s.door.rotation.y = -1.6; s.door.position.x -= 0.3;
  hostLoot('cashbundle', 'rare', s.x - 0.3, s.z + 0.7);
  hostLoot('cashbundle', 'rare', s.x + 0.3, s.z + 0.8);
  hostLoot('ledger', 'rare', s.x, s.z + 1.0);
  noise(E, s.x, s.z, 18);
  tell(pid, 'The safe is open! Cash and… a ledger page.');
  return true;
};
export const isDead = () => !!E?.dead;
// 1 while an enemy nearby is running at you (music chase layer), else 0.
export function chaseLevel() {
  if (!E || E.down) return 0;
  return E.enemies.some(en => !en.dead && (en.st === 2 || en.st === 5) && en.mesh.position.distanceTo(P()) < 16) ? 1 : 0;
}

// ---------- weapons & hotbar ----------
function slots() {
  const s = [G.weapons.bat ? 'bat' : 'fists'];
  for (const w of ['baton', 'pepper', 'taser', 'revolver', 'shotgun']) if (G.weapons[w]) s.push(w);
  s.push('trap', 'mine', 'bandage');
  return s;
}
const slotKey = () => slots()[clamp(E.slot, 0, slots().length - 1)];

function buildViewModel() {
  const g = E.vm;
  while (g.children.length) g.remove(g.children[0]);
  g.userData = {};
  const k = slotKey(), skin = 0xe0ac69;
  const hand = (x, y, z) => part(g, new THREE.BoxGeometry(0.09, 0.09, 0.15), skin, x, y, z);
  if (k === 'fists' || k === 'trap' || k === 'mine' || k === 'bandage') {
    g.userData.l = hand(-0.22, -0.3, -0.45); g.userData.r = hand(0.22, -0.3, -0.45);
    if (k !== 'fists') {
      const it = part(g, k === 'bandage' ? new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10) : new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), k === 'bandage' ? 0xf4efe4 : k === 'mine' ? 0x2f3a22 : 0x666666, 0.22, -0.22, -0.48);
      it.rotation.z = Math.PI / 2;
    }
  } else {
    const w = new THREE.Group(); w.position.set(0.28, -0.32, -0.5); g.add(w); g.userData.w = w;
    if (k === 'bat') part(w, new THREE.CylinderGeometry(0.045, 0.02, 0.75, 8), 0xb5803a, 0, 0.375, 0);
    if (k === 'baton') part(w, new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), 0x111111, 0, 0.3, 0);
    if (k === 'pepper') { part(w, new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), 0xd02a2a, 0, 0.07, 0); part(w, new THREE.BoxGeometry(0.03, 0.03, 0.03), 0x111111, 0, 0.16, 0); }
    if (k === 'taser') { part(w, new THREE.BoxGeometry(0.05, 0.12, 0.05), 0x222222, 0, 0, 0); part(w, new THREE.BoxGeometry(0.06, 0.05, 0.16), 0xe0d020, 0, 0.07, -0.06); }
    if (k === 'revolver') { part(w, new THREE.BoxGeometry(0.04, 0.12, 0.05), 0x4a2a12, 0, 0, 0); part(w, new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), 0x2a2a2e, 0, 0.08, -0.1, { metalness: 0.7 }).rotation.x = Math.PI / 2; }
    if (k === 'shotgun') { part(w, new THREE.BoxGeometry(0.06, 0.08, 0.5), 0x5a3a1a, 0, 0.05, 0.05); part(w, new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), 0x2a2a2e, 0, 0.1, -0.45, { metalness: 0.7 }).rotation.x = Math.PI / 2; }
    part(w, new THREE.BoxGeometry(0.09, 0.09, 0.12), skin, 0, 0.0, 0.02);
    if (WEAPONS[k].melee) w.rotation.set(-0.3, 0, -0.5); else w.rotation.set(Math.PI / 2 - 0.05, 0, 0);
  }
}
function animViewModel() {
  const a = Math.sin(E.swingT * Math.PI), vm = E.vm, k = slotKey();
  vm.visible = !E.hidden && !E.inCab && !E.down;
  if (vm.userData.w && WEAPONS[k]?.melee) { vm.userData.w.rotation.set(-0.3 - a * 1.3, a * 0.6, -0.5 + a * 1.5); vm.userData.w.position.x = 0.28 - a * 0.3; }
  else if (vm.userData.w) vm.userData.w.position.z = -0.5 + a * 0.08;
  else if (vm.userData.r) vm.userData.r.position.z = -0.45 - a * 0.3;
  vm.position.y = E.carrying != null ? -0.3 : 0;
}

// Enemies in front of the camera, closest first.
function aimTargets(range, cos) {
  const f = forward(), p = P(), out = [];
  for (const en of E.enemies) {
    if (en.dead) continue;
    const d = V(en.mesh.position.x - p.x, 0, en.mesh.position.z - p.z), dist = d.length();
    if (dist < range + 0.4 && d.normalize().dot(f) > cos && los(p, en.mesh.position)) out.push({ en, dist });
  }
  return out.sort((a, b) => a.dist - b.dist);
}
const hit = (en, dmg, stun, push = 0) => { const f = forward(); act('xHit', en.id, dmg, stun, f.x * push, f.z * push); };

async function fire() {
  const k = slotKey(), w = WEAPONS[k];
  if (E.cd > 0) return;
  if (E.carrying != null) return UI.toast('Put it down first (E).');
  E.cd = w.cd; E.swingT = 1;
  if (w.melee) {
    sfx.swing();
    const t = aimTargets(w.range, 0.75)[0];
    if (t) { hit(t.en, w.dmg, w.stun ? w.stun * stunMult(E.skulls) : 0, k === 'bat' ? 0.7 : 0.35); sfx.hit(); }
    return;
  }
  if (!await act('xConsume', w.gear, 1)) { E.cd = 0.3; return UI.toast(`Out of ${w.gear === 'ammo9' ? 'rounds' : w.gear === 'shells' ? 'shells' : w.gear === 'pepper' ? 'pepper spray' : 'taser cartridges'}! Buy more on the computer.`, 'bad'); }
  const sm = stunMult(E.skulls);
  if (k === 'pepper') {
    sfx.spray(); puff();
    for (const t of aimTargets(w.range, 0.82)) hit(t.en, 0, w.stun * sm);
  } else if (k === 'taser') {
    sfx.zap();
    const t = aimTargets(w.range, 0.96)[0];
    if (t) { hit(t.en, 2, w.stun * sm); tracer(t.en.mesh.position, 0x88ccff); } else tracer(null, 0x88ccff, 6);
  } else if (k === 'revolver') {
    sfx.pistol(); muzzle(); E.shake = 0.12;
    const t = aimTargets(w.range, 0.985)[0];
    if (t) { hit(t.en, w.dmg * clamp(1.3 - t.dist / 40, 0.5, 1), 0, 0.3); tracer(t.en.mesh.position, 0xffe0a0); } else tracer(null, 0xffe0a0, 30);
    makeNoise(P().x, P().z, w.loud);
  } else if (k === 'shotgun') {
    sfx.shotgun(); muzzle(); E.shake = 0.25;
    const ts = aimTargets(w.range, 0.94);
    for (const t of ts.slice(0, 3)) {
      let pellets = 0;
      for (let i = 0; i < w.pellets; i++) if (Math.random() < clamp(1.2 - t.dist / w.range, 0.15, 1)) pellets++;
      hit(t.en, pellets * w.dmg, 0, 0.8);
    }
    tracer(ts[0]?.en.mesh.position || null, 0xffd080, 18);
    makeNoise(P().x, P().z, w.loud);
  }
}
// Something you did made noise: tell the AI, and show the ring so stealth is readable.
function makeNoise(x, z, r, send = true) {
  if (send) act('xNoise', x, z, r);
  noiseRing(E.scene, x, z, r, r >= 20 ? 0xff7040 : 0xffe080);
  E.noise = Math.max(E.noise, Math.min(1, r / 25));
}

function muzzle() { E.flash.intensity = 30; setTimeout(() => { if (E) E.flash.intensity = 0; }, 70); }
function tracer(to, color, len = 6) {
  const from = E.camera.localToWorld(V(0.25, -0.2, -0.6));
  const end = to ? V(to.x, 1.1, to.z) : E.camera.localToWorld(V(0, 0, -len));
  const geo = new THREE.BufferGeometry().setFromPoints([from, end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
  E.scene.add(line);
  E.fx.push({ obj: line, t: 0, life: 0.12 });
}
function puff() {
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: 0xffaa88, transparent: true, opacity: 0.5, depthWrite: false }));
    s.position.copy(E.camera.localToWorld(V(rand(-0.3, 0.3), rand(-0.3, 0.1), -0.8 - i * 0.35)));
    s.scale.setScalar(0.4 + i * 0.12);
    E.scene.add(s);
    E.fx.push({ obj: s, t: 0, life: 0.6, grow: true });
  }
}

export async function use() {
  if (isOver() || E.down || E.hidden != null || E.inCab) return;
  const k = slotKey();
  if (WEAPONS[k]) return fire();
  if (k === 'bandage') {
    const mate = lookAtDowned();
    if (mate) { if (await act('xRevive', mate)) sfx.pick(); return; }
    if (E.hp >= 100) return UI.toast('You are not hurt.');
    if (!await act('xConsume', 'bandage', 1)) return UI.toast('No bandages. Buy them on the computer.', 'bad');
    E.hp = Math.min(100, E.hp + 50); sfx.pick(); UI.toast('+50 HP');
    return hud();
  }
  const f = forward(), x = P().x + f.x * 1.3, z = P().z + f.z * 1.3;
  if (!free(x, z, 0.25)) return UI.toast('Can\'t place it there.', 'bad');
  if (!await act('xTrap', k, x, z)) UI.toast(`No ${k === 'trap' ? 'bear traps' : 'landmines'} left.`, 'bad');
  else sfx.thud();
}

export function select(i) { if (E && i < slots().length) { E.slot = i; sfx.click(); buildViewModel(); hud(); } }
export function cycle(d) { if (E) { const n = slots().length; select((E.slot + d + n) % n); } }
export function toggleCrouch() { if (E && !E.down) { E.crouch = !E.crouch; hud(); } }
export function setCrouch(on) { if (E && !E.down && E.crouch !== on) { E.crouch = on; hud(); } } // "hold to crouch" setting

export function toggleLight() {
  if (isOver() || E.down) return;
  if (!G.tools.flashlight) return UI.toast('You don\'t have a flashlight. Buy one on the computer.', 'bad');
  if (E.charge <= 0) {
    act('xConsume', 'battery', 1).then(ok => { if (ok) { E.charge = BATTERY; E.lightOn = true; sfx.click(); hud(); } else UI.toast('No batteries left.', 'bad'); });
    return;
  }
  E.lightOn = !E.lightOn; sfx.click(); hud();
}

// ---------- looking at things ----------
const nearTruckBed = () => Math.hypot(P().x - E.truck.bedCenter.x, P().z - E.truck.bedCenter.z) < 2.6;
const nearCab = () => Math.hypot(P().x - E.truck.door.x, P().z - E.truck.door.z) < 1.8;
function lookAtDowned() {
  const f = forward();
  for (const p of Object.values(G.players)) {
    if (p.id === G.me || !p.down || p.dead || p.world !== 'exp') continue;
    const d = V(p.x - P().x, 0, p.z - P().z), dist = d.length();
    if (dist < 2.4 && d.normalize().dot(f) > 0.6) return p.id;
  }
  return null;
}

export function updateTarget(ray) {
  E.target = null;
  if (E.dead) return UI.hint(`<span class="down">You died.</span> Spectating · ${kb('spectate')} next player · ${kb('roulette')} ghost roulette`);
  if (E.down) return UI.hint(teamAlive() ? `<span class="down">Bleeding out: ${Math.ceil(E.bleed)} s.</span> A teammate can revive you with a bandage. ${kb('spectate')} spectate` : '<span class="down">Knocked out…</span>');
  if (E.inCab) return UI.hint(`${kb('interact')} Get out · ${waitingText()}`);
  if (E.hidden != null) return UI.hint(`Hiding… ${kb('interact')} Get out`);
  const mate = lookAtDowned();
  if (mate) return UI.hint(`${kb('interact')} Revive ${G.players[mate].name} with a bandage (${G.gear.bandage} left)`);
  if (E.carrying != null) {
    const b = E.bigs.find(x => x.bid === E.carrying), n = b?.carriers.length || 1;
    return UI.hint(nearTruckBed() ? `${kb('interact')} Load the ${itemById(b.id).name} into the truck` : `Carrying ${itemById(b.id).name} ${n > 1 ? `with a teammate` : '<span class="down">alone: slow and LOUD</span>'} · ${kb('interact')} Put down`);
  }
  if (nearCab()) return UI.hint(`${kb('interact')} Get in the truck (ready to leave)`);
  const objs = [...E.loot.map(l => l.g), ...E.phys.bodies.map(b => b.mesh), ...E.crates.filter(c => !c.open).map(c => c.g), ...E.hides.map(h => h.g), ...E.bigs.filter(b => !b.gone && !b.loaded).map(b => b.g),
    ...(E.safe && !E.safe.open ? [E.safe.g] : [])];
  const hitObj = ray.intersectObjects(objs, true)[0];
  if (nearTruckBed() && (!hitObj || hitObj.distance > 2.6)) return UI.hint(E.bag.length ? `${kb('interact')} Dump your bag into the truck bed (${E.bag.length} item${E.bag.length > 1 ? 's' : ''})` : 'Truck bed: dump your bag here to keep the loot safe');
  if (!hitObj || hitObj.distance > 2.6) return UI.hint('');
  const u = hitObj.object.userData, cap = bagCap(G.me), full = n => bagSize(E.bag) + n > cap;
  if (u.safe) { E.target = { safe: u.safe }; const s = u.safe; tip('safe');
    return UI.hint(s.cracking ? `Cracking the safe… ${Math.round(s.progress * 100)} % <span class="dim">(stay close · ${kb('interact')} stop)</span>` : `${kb('interact')} Crack Rusty's safe <span class="dim">(${G.tools.crowbar ? '~6' : '~12'} s, loud)</span>`); }
  if (u.loot) { E.target = { loot: u.loot }; const d = itemById(u.loot.id), sz = d.size || 1;
    return UI.hint(full(sz) ? `<span class="down">Bag full (${bagSize(E.bag)}/${cap})</span> ${d.icon} ${d.name}` : `${kb('interact')} Pick up ${d.icon} ${d.name} <span class="r-${u.loot.rarity}">${u.loot.rarity}</span>${sz > 1 ? ` <small class="dim">(${sz} slots)</small>` : ''}`); }
  if (u.body) { E.target = { body: u.body }; const d = itemById(u.body.inst.id); return UI.hint(`${kb('interact')} Pick up ${d.icon} ${d.name}`); }
  if (u.crate) { E.target = { crate: u.crate }; return UI.hint(G.tools.crowbar ? `${kb('interact')} Pry open the locked crate (loud)` : '<span class="dim">Locked crate. Needs a 🪝 crowbar.</span>'); }
  if (u.hide) { E.target = { hide: u.hide }; tip('hide'); return UI.hint(`${kb('interact')} Hide ${u.hide.kind === 'wreck' ? 'in the wreck' : u.hide.kind === 'potty' ? 'in the porta-potty' : 'in the dumpster'}`); }
  if (u.big) {
    tip('big');
    E.target = { big: u.big }; const d = itemById(u.big.id), tools = d.big.tools.map(t => t === 'wrench' ? '🔧' : '🪛').join('');
    return UI.hint(`${d.icon} ${d.name} · ${kb('interact')} Carry${u.big.carriers.length ? ' (help)' : ''} · ${kb('dismantle')} Take apart ${tools}`);
  }
  UI.hint('');
}
const teamAlive = () => Object.values(G.players).some(p => p.id !== G.me && p.world === 'exp' && !p.down);
function waitingText() {
  const team = Object.values(G.players).filter(p => p.world === 'exp' && !p.down);
  const inCab = team.filter(p => p.cab).length;
  return team.length > 1 ? `Waiting for the team (${inCab}/${team.length} in the truck)` : 'Leaving…';
}

export async function interact() {
  if (isOver() || E.down) return;
  if (E.inCab) { E.inCab = false; act('xCab', false); E.camera.position.set(E.truck.door.x, 1.6, E.truck.door.z); return hud(); }
  if (E.hidden != null) return unhide();
  const mate = lookAtDowned();
  if (mate) { if (!await act('xRevive', mate)) UI.toast('You need a bandage to revive them.', 'bad'); return; }
  if (E.carrying != null) {
    if (nearTruckBed()) await act('xLoadBig', E.carrying); else await act('xRelease', E.carrying);
    E.carrying = null; return hud();
  }
  if (nearCab()) {
    if (Object.keys(G.players).length <= 1) {
      UI.openPanel(`<h2>🛻 Drive home?</h2><p>Truck bed: <b>${E.cargoCount ?? 0}</b> item(s). Your bag: <b>${E.bag.length}</b>.</p>
        ${E.time > 60 ? '<p class="dim">There is still time to look around.</p>' : ''}
        <div class="row"><button id="lv-y">Drive home</button><button id="lv-n" class="ghost">Keep looking</button></div>`);
      UI.$('lv-y').onclick = () => { UI.closePanel(); E.inCab = true; act('xCab', true); };
      UI.$('lv-n').onclick = () => UI.closePanel();
      return;
    }
    E.inCab = true; act('xCab', true); sfx.door();
    E.camera.position.copy(E.truck.seat);
    return hud();
  }
  const t = E.target;
  if (!t && nearTruckBed() && E.bag.length) { await act('xDump'); return; }
  if (!t) return;
  if (t.safe) { t.safe.cracking = !t.safe.cracking; if (t.safe.cracking) sfx.ratchet(); return; }
  if (t.loot) { if (!await act('xPick', t.loot.lid)) UI.toast('Your bag is full! Dump it in the truck.', 'bad'); return; }
  if (t.body) { if (!await act('xGrabBody', t.body.uid)) UI.toast('Your bag is full!', 'bad'); return; }
  if (t.crate) { if (!G.tools.crowbar) return UI.toast('It\'s locked. A crowbar would open it.', 'bad'); sfx.ratchet(); makeNoise(t.crate.x, t.crate.z, 12, false); act('xCrate', t.crate.id); return; }
  if (t.hide) return hide(t.hide);
  if (t.big) { if (await act('xGrab', t.big.bid)) { E.carrying = t.big.bid; hud(); } }
}

export async function dismantleTarget() {
  const b = E?.target?.big;
  if (!b || E.down) return;
  const def = itemById(b.id);
  const ok = await dismantle({ key: `${E.seed}-${b.bid}`, def, onNoise: r => { if (E) makeNoise(b.g.position.x, b.g.position.z, r); } });
  if (ok) { await act('xDismantle', b.bid); UI.toast(`${def.name} taken apart! Pick up the parts.`); }
}

export async function dropSelected() {
  if (!E || E.down || !E.bag.length) return;
  const { p, v } = throwFrom(E.camera, 3);
  await act('xDropBag', E.bag.length - 1, p.toArray(), v.toArray());
}

function hide(h) {
  const taken = Object.values(G.players).some(p => p.id !== G.me && p.hidden === h.id);
  if (taken) return UI.toast('Someone is already hiding in there.');
  E.hidden = h.id;
  E.lightOn = false;
  E.preHide = P().clone();
  E.camera.position.set(h.x, h.kind === 'wreck' ? 1.0 : 1.3, h.z);
  UI.$('hide-vig').classList.remove('hidden');
  sfx.door();
  hud();
}
function unhide() {
  const h = E.hides[E.hidden];
  E.hidden = null;
  const out = [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6], [2.2, 0], [0, 2.2], [-2.2, 0], [0, -2.2]].map(([a, b]) => V(h.x + a, 1.6, h.z + b)).find(p => free(p.x, p.z));
  E.camera.position.copy(out || E.preHide);
  UI.$('hide-vig').classList.add('hidden');
  sfx.door();
  hud();
}

// ---------- local player state ----------
export function speedMult() {
  if (!E) return 1;
  if (E.down || E.hidden != null || E.inCab) return 0;
  let m = E.crouch ? 0.5 : 1;
  if (E.carrying != null) { const b = E.bigs.find(x => x.bid === E.carrying); m *= (b?.carriers.length || 1) >= 2 ? 0.7 : 0.28; }
  return m;
}
export const canRun = () => E && E.carrying == null && !E.crouch;
export const eyeHeight = () => !E ? 1.6 : E.down ? 0.35 : E.crouch ? 1.0 : 1.6;
export const isFrozen = () => !E || E.down || E.hidden != null || E.inCab;

function hurtLocal(n) {
  if (E.over || E.down) return;
  E.hp -= n; E.shake = 0.25;
  sfx.hurt();
  const h = UI.$('hurt'); h.style.opacity = 0.6; setTimeout(() => { if (E && !E.down) h.style.opacity = 0; }, 160);
  if (E.hp <= 0) goDown();
  hud();
}
function goDown() {
  E.hp = 0; E.down = true; E.bleed = BLEED; E.lightOn = false; E.inCab = false;
  if (E.hidden != null) unhide();
  E.carrying = null;
  UI.$('hurt').style.opacity = 0.75;
  sfx.bad();
  UI.toast(`You are down! ${BLEED} seconds until you bleed out.`, 'bad');
  tip('down');
  act('xDown');
}
// The bleed-out ran out: dead for the night, spectate only.
function die() {
  E.dead = true; E.bleed = 0;
  UI.$('hurt').style.opacity = 0.35;
  UI.$('bleed').classList.add('hidden');
  sfx.boom();
  UI.toast('You died. Spectate your team until the night is over.', 'bad');
  tip('dead');
  act('xDead');
}
function revived() {
  if (E.dead) return;
  E.down = false; E.hp = 40; E.bleed = 0;
  UI.$('hurt').style.opacity = 0;
  UI.$('bleed').classList.add('hidden');
  UI.toast('A teammate got you back up! (40 HP)');
  hud();
}

// ---------- host actions ----------
const X = () => { if (!E) throw new Error('no expedition'); return E; };
const bagOf = pid => (X().bags[pid] ??= pid === G.me ? E.bag : []);
function sendBag(pid) { if (pid === G.me) hud(); else send(pid, { t: 'xbag', bag: E.bags[pid] }); }
const ppos = pid => { const p = G.players[pid]; return V(p?.x || 0, 0, p?.z || 0); };

ACTIONS.xConsume = (pid, key, n) => { if ((G.gear[key] || 0) < n) return false; G.gear[key] -= n; return true; };
ACTIONS.xPick = (pid, lid) => {
  if (!E) return false;
  const l = E.loot.find(x => x.lid === lid), bag = bagOf(pid);
  if (!l) return false;
  const sz = itemById(l.id).size || 1;
  if (bagSize(bag) + sz > bagCap(pid)) return false;
  const story = ['ledger', 'cashbundle'].includes(l.id);
  bag.push(makeInst(l.id, story ? { q: 1 } : { q: clamp(rand(0.55, 1.15) + E.skulls * 0.04, 0.3, 1.3), broken: Math.random() < 0.15 }));
  removeLoot(l); sfx.pick();
  addJob(pid, 'scav', 4, 'loot');
  tell(pid, `Picked up ${itemById(l.id).name}`);
  sendBag(pid);
  return true;
};
ACTIONS.xGrabBody = (pid, uid) => {
  const b = E?.phys.find(uid), bag = bagOf(pid);
  if (!b) return false;
  if (bagSize(bag) + (itemById(b.inst.id).size || 1) > bagCap(pid)) return false;
  E.phys.remove(b); bag.push(b.inst); sfx.pick(); sendBag(pid);
  return true;
};
ACTIONS.xDropBag = (pid, idx, p, v) => {
  const bag = bagOf(pid), inst = bag.splice(idx, 1)[0];
  if (!inst) return false;
  E.phys.add(inst, V(...p), V(...v)); sendBag(pid);
  return true;
};
ACTIONS.xDump = pid => {
  const bag = bagOf(pid);
  if (!bag.length) return false;
  const c = E.truck.bedCenter;
  addJob(pid, 'scav', 2 * bag.length);
  bag.splice(0).forEach((inst, i) => E.phys.add(inst, V(c.x + rand(-0.6, 0.6), 1.6 + i * 0.25, c.z + rand(-0.6, 0.6)), V(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))));
  sfx.thud(); tell(pid, 'Bag dumped into the truck. That loot is safe now.');
  sendBag(pid);
  return true;
};
ACTIONS.xCab = (pid, on) => { if (!E) return; on ? E.cab.add(pid) : E.cab.delete(pid); const p = G.players[pid]; if (p) p.cab = on; };
ACTIONS.xNoise = (pid, x, z, r) => { if (E) noise(E, x, z, r); };
ACTIONS.xHit = (pid, eid, dmg, stun, kx, kz) => {
  const en = E?.enemies[eid];
  if (!en || en.dead) return false;
  en.hp -= dmg;
  if (stun) en.stun = Math.max(en.stun, stun);
  if (en.state !== 'chase') { en.state = 'chase'; en.target = pid; en.last = ppos(pid); }
  const m = en.mesh.position;
  if (free(m.x + kx, m.z + kz, 0.3)) { m.x += kx; m.z += kz; }
  if (en.hp <= 0) kill(en);
  return true;
};
function kill(en) {
  en.dead = true; en.st = 4;
  sfx.thud();
  const p = en.mesh.position;
  if (en.kind === 'homeless' && Math.random() < 0.35) { const { id, rarity } = rollLoot(Math.random, 0.2); hostLoot(id, rarity, p.x + 0.4, p.z + 0.4); }
  if (en.kind === 'guard' && Math.random() < 0.6) hostLoot('shotgun_i', 'rare', p.x + 0.5, p.z);
}
ACTIONS.xTrap = (pid, kind, x, z) => {
  if (!E || (G.gear[kind] || 0) < 1) return false;
  G.gear[kind]--;
  E.traps.push({ id: E.nextTrap++, kind, x, z, armed: true, g: trapMesh(kind, x, z) });
  return true;
};
ACTIONS.xRevive = (pid, target) => {
  const p = G.players[target];
  if (!p?.down || p.dead || G.gear.bandage < 1) return false;
  G.gear.bandage--; p.down = false; p.hp = 40;
  if (target === G.me) revived(); else send(target, { t: 'xrevive' });
  tell(pid, `You got ${p.name} back up.`);
  addJob(pid, 'scav', 10, 'revived');
  return true;
};
ACTIONS.xDead = pid => {
  if (!E) return;
  const p = G.players[pid]; if (p) { p.dead = true; p.down = true; }
  E.hosp[pid] = 'dead';
};
ACTIONS.xDown = pid => {
  if (!E) return;
  E.hosp[pid] ??= 'down';
  const p = G.players[pid]; if (p) { p.down = true; p.cab = false; }
  E.cab.delete(pid);
  for (const b of E.bigs) b.carriers = b.carriers.filter(c => c !== pid);
  const bag = bagOf(pid), at = ppos(pid);
  bag.splice(0).forEach(inst => E.phys.add(inst, V(at.x + rand(-0.4, 0.4), 0.8, at.z + rand(-0.4, 0.4)), V(rand(-1, 1), 1.5, rand(-1, 1))));
  sendBag(pid);
};
ACTIONS.xCrate = (pid, cid) => {
  const c = E?.crates.find(x => x.id === cid);
  if (!c || c.open || !G.tools.crowbar) return false;
  c.open = true; E.scene.remove(c.g);
  noise(E, c.x, c.z, 12);
  for (let k = 0; k < 2 + (Math.random() * 2 | 0); k++) { const { id, rarity } = rollLoot(Math.random, 0.6); hostLoot(id, rarity, c.x + rand(-0.6, 0.6), c.z + rand(-0.6, 0.6)); }
  tell(pid, 'Crate open!');
  return true;
};
ACTIONS.xGrab = (pid, bid) => {
  const b = E?.bigs.find(x => x.bid === bid);
  if (!b || b.gone || b.loaded || b.carriers.includes(pid)) return false;
  if (b.carriers.length >= 2) return false;
  b.carriers.push(pid);
  return true;
};
ACTIONS.xRelease = (pid, bid) => { const b = E?.bigs.find(x => x.bid === bid); if (b) b.carriers = b.carriers.filter(c => c !== pid); return true; };
ACTIONS.xLoadBig = (pid, bid) => {
  const b = E?.bigs.find(x => x.bid === bid);
  if (!b || b.loaded) return false;
  if (Math.hypot(b.g.position.x - E.truck.bedCenter.x, b.g.position.z - E.truck.bedCenter.z) > (G.up.truckWinch ? 10 : 4)) { b.carriers = b.carriers.filter(c => c !== pid); tell(pid, 'Bring it closer to the truck bed.', 'bad'); return false; }
  b.loaded = true; b.carriers = [];
  b.inst = makeInst(b.id, { q: rand(0.7, 1.15) });
  sfx.thud(); tell(pid, `${itemById(b.id).name} loaded into the truck!`);
  return true;
};
ACTIONS.xDismantle = (pid, bid) => {
  const b = E?.bigs.find(x => x.bid === bid);
  if (!b || b.gone || b.loaded) return false;
  b.gone = true; b.carriers = [];
  const p = b.g.position;
  for (const id of itemById(b.id).big.parts) E.phys.add(makeInst(id, { q: rand(0.7, 1.15) }), V(p.x + rand(-0.5, 0.5), 0.8, p.z + rand(-0.5, 0.5)), V(rand(-1.5, 1.5), 2, rand(-1.5, 1.5)));
  return true;
};

function trapMesh(kind, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  if (kind === 'trap') {
    part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), 0x4a4a4a, 0, 0.015, 0, { metalness: 0.7 });
    part(g, new THREE.TorusGeometry(0.24, 0.018, 4, 14), 0x888888, 0, 0.04, 0, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; part(g, new THREE.ConeGeometry(0.025, 0.09, 4), 0xbbbbbb, Math.cos(a) * 0.24, 0.09, Math.sin(a) * 0.24, { metalness: 0.8 }); }
  } else {
    part(g, new THREE.CylinderGeometry(0.2, 0.22, 0.07, 10), 0x2f3a22, 0, 0.035, 0, { metalness: 0.4 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.y = 0.08; g.add(led); g.userData.led = led;
  }
  E.scene.add(g);
  return g;
}

// ---------- host simulation ----------
function playersForAI() {
  return Object.values(G.players).filter(p => p.world === 'exp').map(p => ({
    pid: p.id, pos: V(p.x, 1.6, p.z), down: p.down || p.dead, hidden: p.hidden !== false && p.hidden != null, run: p.run, crouch: p.crouch, light: p.light,
    quiet: perk(p.id, 'scav') >= 3,
  }));
}
const aiCb = {
  hurt: (pid, n) => { if (pid === G.me) hurtLocal(n); else send(pid, { t: 'xhurt', n }); },
  fx: (kind, d) => { playFx(kind, d); broadcast({ t: 'xfx', kind, d }); },
  found: pid => { if (pid === G.me) { if (E.hidden != null) { unhide(); UI.toast('They found you!', 'bad'); } } else send(pid, { t: 'xfound' }); },
};
function playFx(kind, d) {
  const dist = Math.hypot(d.x - P().x, d.z - P().z), v = clamp(1 - dist / 40, 0.05, 1);
  if (kind === 'shot') {
    sfx.shotgun(v);
    const l = new THREE.PointLight(0xffc060, 40, 10); l.position.set(d.x, 1.3, d.z); E.scene.add(l);
    E.fx.push({ obj: l, t: 0, life: 0.08 });
    tracerWorld(V(d.x, 1.3, d.z), V(d.tx, 1.2, d.tz));
    noiseRing(E.scene, d.x, d.z, 25, 0xff7040);
  }
  if (kind === 'engine') { noiseRing(E.scene, d.x, d.z, 14, 0xd0d0ff); }
  if (kind === 'bark') sfx.bark(v);
  if (kind === 'hey') { sfx.hey(); if (dist < 30) UI.toast('"HEY! Get off my property!"', 'bad'); }
  if (kind === 'grunt') sfx.grunt(v);
}
function tracerWorld(a, b) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffd080, transparent: true }));
  E.scene.add(line); E.fx.push({ obj: line, t: 0, life: 0.1 });
}

function updateTrapsHost() {
  for (const tr of [...E.traps]) {
    if (!tr.armed) continue;
    for (const en of E.enemies) {
      if (en.dead) continue;
      const d = Math.hypot(en.mesh.position.x - tr.x, en.mesh.position.z - tr.z);
      if (tr.kind === 'trap' && d < 0.6 && !(en.stuck > 0)) {
        tr.armed = false; en.stuck = 6 * stunMult(E.skulls); en.hp -= 15;
        en.mesh.position.x = tr.x; en.mesh.position.z = tr.z;
        sfx.snap();
        if (en.hp <= 0) kill(en);
        break;
      }
      if (tr.kind === 'mine' && d < 1.1) { explode(tr); break; }
    }
  }
}
function explode(tr) {
  tr.armed = false; tr.gone = true;
  E.scene.remove(tr.g);
  E.traps.splice(E.traps.indexOf(tr), 1);
  aiCb.fx('boom', { x: tr.x, z: tr.z });
  boomFx(tr.x, tr.z);
  for (const en of E.enemies) if (!en.dead && Math.hypot(en.mesh.position.x - tr.x, en.mesh.position.z - tr.z) < 3.5) { en.hp -= 100; if (en.hp <= 0) kill(en); }
  for (const p of Object.values(G.players)) {
    if (p.world !== 'exp' || p.down) continue;
    const d = Math.hypot(p.x - tr.x, p.z - tr.z);
    if (d < 3.5) aiCb.hurt(p.id, Math.round(60 * (1 - d / 3.5)) + 5);
  }
  noise(E, tr.x, tr.z, 30);
}
function boomFx(x, z) {
  sfx.boom(); E.shake = 0.5;
  const l = new THREE.PointLight(0xffaa44, 80, 16); l.position.set(x, 1, z);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true }));
  ball.position.set(x, 0.5, z);
  E.scene.add(l, ball);
  E.fx.push({ obj: l, t: 0, life: 0.5 }, { obj: ball, t: 0, life: 0.5, grow: true });
}

function updateBigsHost(dt) {
  for (const b of E.bigs) {
    if (b.gone || b.loaded || !b.carriers.length) continue;
    let x = 0, z = 0, fx = 0, fz = 0;
    for (const pid of b.carriers) { const p = G.players[pid]; if (!p) continue; x += p.x; z += p.z; fx += Math.sin(p.ry); fz += Math.cos(p.ry); }
    const n = b.carriers.length; x /= n; z /= n;
    const fl = Math.hypot(fx, fz) || 1;
    const tx = x + fx / fl * 1.2, tz = z + fz / fl * 1.2, g = b.g.position;
    const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const mv = Math.min(d, 6 * dt);
      const nx = g.x + dx / d * mv, nz = g.z + dz / d * mv;
      if (free(nx, g.z, 0.3)) g.x = nx;
      if (free(g.x, nz, 0.3)) g.z = nz;
      if (d > 0.3) b.g.rotation.y = Math.atan2(-dz, dx); // long side follows the way it's dragged
    }
    g.y = n >= 2 ? 0.25 : 0;
    if (n === 1 && d > 0.2 && (b.dragT = (b.dragT || 0) - dt) <= 0) { b.dragT = 1; noise(E, g.x, g.z, 9); sfx.drag(); noiseRing(E.scene, g.x, g.z, 9); }
  }
}

function cargo() {
  const bed = E.truck.bed;
  const bodies = E.phys.bodies.filter(b => bed.containsPoint(b.p));
  return [...bodies.map(b => b.inst), ...E.bigs.filter(b => b.loaded).map(b => b.inst)];
}

function updateHost(dt) {
  updateEnemiesHost(E, dt, playersForAI(), aiCb);
  updateTrapsHost();
  updateBigsHost(dt);
  E.phys.step(dt);
  E.cargoCount = cargo().length;
  // the idling engine draws enemies while someone sits in the cab (unless it's the quiet one)
  if (!G.up.truckQuiet && E.cab.size && (E.engineT -= dt) <= 0) {
    E.engineT = 2;
    noise(E, E.truck.pos.x, E.truck.pos.z, 14);
    aiCb.fx('engine', { x: E.truck.pos.x, z: E.truck.pos.z });
  }
  // blinding headlights: dogs in front of the truck back off
  if (G.up.truckLights) for (const en of E.enemies) {
    if (en.dead || en.kind !== 'dog') continue;
    const dx = en.mesh.position.x - E.truck.front.x, dz = en.mesh.position.z - E.truck.front.z, d = Math.hypot(dx, dz);
    if (d < 10 && (dx * E.truck.dir.x + dz * E.truck.dir.z) / d > 0.75) { en.stun = Math.max(en.stun, 0.8); en.state = 'wander'; en.path = []; }
  }
  E.time -= dt;
  if (E.time <= 60 && !E.warned) { E.warned = true; broadcast({ t: 'say', text: 'The truck leaves in 1 minute! Get back!' }); UI.toast('The truck leaves in 1 minute! Get back!', 'bad'); }
  const team = Object.values(G.players).filter(p => p.world === 'exp');
  const alive = team.filter(p => !p.down);
  if (E.time <= 0) return endHost('time');
  if (!alive.length) return endHost('wiped');
  if (alive.every(p => E.cab.has(p.id))) {
    if ((E.leaveT += dt) > (team.length > 1 ? 3 : 0.3)) return endHost('drive');
  } else E.leaveT = 0;
  if ((E.snapT -= dt) <= 0 && NET.role === 'host') {
    E.snapT = 0.1;
    broadcast({ t: 'xs', en: enemySnap(E), lo: E.loot.map(l => [l.lid, l.id, l.rarity, +l.x.toFixed(2), +l.z.toFixed(2)]),
      bi: E.bigs.map(b => [b.bid, +b.g.position.x.toFixed(2), +b.g.position.y.toFixed(2), +b.g.position.z.toFixed(2), +b.g.rotation.y.toFixed(2), b.carriers, b.loaded ? 1 : 0, b.gone ? 1 : 0]),
      bo: E.phys.snapshot(), tr: E.traps.map(t => [t.id, t.kind, t.x, t.z, t.armed ? 1 : 0]), cr: E.crates.filter(c => c.open).map(c => c.id),
      time: +E.time.toFixed(1), cab: [...E.cab], cargo: E.cargoCount, gear: G.gear, sf: E.safe?.open ? 1 : 0 });
  }
}

function endHost(reason) {
  if (E.over) return;
  E.over = true;
  const team = Object.values(G.players).filter(p => p.world === 'exp');
  const kept = {}, lost = {};
  for (const p of team) {
    const bag = bagOf(p.id);
    if (reason !== 'wiped' && (E.cab.has(p.id) || reason === 'drive') && !p.down) kept[p.id] = bag.map(i => i.id); else lost[p.id] = bag.map(i => i.id);
  }
  const cargoInsts = cargo(); // the truck always gets home (towed, if nobody drives it)
  const home = [...cargoInsts];
  for (const p of team) if (kept[p.id]) home.push(...bagOf(p.id));
  // cash bundles turn into money, ledger pages into story; everything else goes to the stock crates
  let cash = 0;
  const pages = [];
  for (const i of home) {
    if (i.id === 'cashbundle') cash += value(i);
    else if (i.id === 'ledger') { const t = addPage(); if (t) pages.push(t); }
    else G.backstock.push(i);
  }
  G.money += cash;
  G.xp += home.length * 10;
  G.life.nights++;
  // the hospital bill for everyone who went down (or died) tonight
  const hospital = {};
  let bill = 0;
  for (const [pid, how] of Object.entries(E.hosp)) { const n = G.players[pid]?.name || 'Someone'; hospital[n] = HOSPITAL[how]; bill += HOSPITAL[how]; }
  G.money -= bill; G.stats.spent += bill;
  const res = { reason, cargo: cargoInsts.map(i => i.id), kept, lost, loc: E.loc.name, ev: E.ev.name, skulls: E.skulls, cash, pages, hospital, bill };
  broadcast({ t: 'xend', res });
  finishLocal(res);
}

function finishLocal(res) {
  if (!E) return;
  E.over = true;
  E.camera.remove(E.spot, E.spot.target, E.vm, E.flash);
  UI.$('hurt').style.opacity = 0;
  UI.$('bleed').classList.add('hidden');
  UI.$('hide-vig').classList.add('hidden');
  E.phys.clear();
  E = null;
  G.endExpedition(res);
}

// ---------- guest mirror ----------
on('xs', m => {
  if (!E) return;
  mirrorEnemies(E, m.en);
  const lids = new Set(m.lo.map(l => l[0]));
  for (const l of [...E.loot]) if (!lids.has(l.lid)) removeLoot(l);
  for (const [lid, id, rarity, x, z] of m.lo) if (!E.loot.some(l => l.lid === lid)) addLoot(lid, id, rarity, x, z);
  for (const [bid, x, y, z, ry, carriers, loaded, gone] of m.bi) {
    const b = E.bigs.find(q => q.bid === bid); if (!b) continue;
    b.tgt = [x, y, z, ry]; b.carriers = carriers; b.loaded = !!loaded; b.gone = !!gone;
    b.g.visible = !loaded && !gone;
    if (E.carrying === bid && !carriers.includes(G.me)) E.carrying = null;
  }
  E.phys.mirror(m.bo);
  const tids = new Set(m.tr.map(t => t[0]));
  for (const t of [...E.traps]) if (!tids.has(t.id)) { E.scene.remove(t.g); E.traps.splice(E.traps.indexOf(t), 1); }
  for (const [id, kind, x, z, armed] of m.tr) {
    let t = E.traps.find(q => q.id === id);
    if (!t) { t = { id, kind, x, z, g: trapMesh(kind, x, z) }; E.traps.push(t); }
    if (t.armed && !armed && kind === 'trap') sfx.snap();
    t.armed = !!armed;
  }
  for (const c of E.crates) if (!c.open && m.cr.includes(c.id)) { c.open = true; E.scene.remove(c.g); }
  E.time = m.time; E.cargoCount = m.cargo;
  Object.assign(G.gear, m.gear);
  if (m.sf && E.safe && !E.safe.open) { E.safe.open = true; E.safe.door.rotation.y = -1.6; E.safe.door.position.x -= 0.3; }
});
on('xhurt', m => { if (E) hurtLocal(m.n); });
on('xbag', m => { if (E) { E.bag = m.bag; hud(); } });
on('xfound', () => { if (E?.hidden != null) { unhide(); UI.toast('They found you!', 'bad'); } });
on('xrevive', () => { if (E?.down) revived(); });
on('xfx', m => { if (!E) return; if (m.kind === 'boom') boomFx(m.d.x, m.d.z); else playFx(m.kind, m.d); });
on('xend', m => finishLocal(m.res));

// ---------- per-frame ----------
export function update(dt) {
  if (!E || E.over) return;
  const now = performance.now();
  if (isGuest()) {
    lerpEnemies(E, dt);
    E.phys.lerpMirror(dt);
    const k = Math.min(1, dt * 10);
    for (const b of E.bigs) if (b.tgt) { const g = b.g.position; g.x += (b.tgt[0] - g.x) * k; g.y = b.tgt[1]; g.z += (b.tgt[2] - g.z) * k; b.g.rotation.y = b.tgt[3]; }
  } else updateHost(dt);
  if (!E) return;
  for (const f of [...E.fx]) {
    f.t += dt;
    const k = 1 - f.t / f.life;
    if (f.obj.isLight) f.obj.intensity *= 0.8;
    if (f.obj.material) { f.obj.material.opacity = Math.max(0, k); f.obj.material.transparent = true; }
    if (f.grow) f.obj.scale.multiplyScalar(1 + dt * 4);
    if (f.t > f.life) { E.scene.remove(f.obj); E.fx.splice(E.fx.indexOf(f), 1); }
  }
  for (const f of E.fires) {
    if (f.light) f.light.intensity = 9 + Math.sin(now * 0.02 + f.seed) * 2 + Math.random() * 2;
    f.flames.scale.y = 0.85 + Math.random() * 0.3;
  }
  for (const l of E.lamps) if (l.userData.flicker) { l.userData.base ??= l.intensity; l.intensity = Math.random() < 0.06 ? 0 : l.userData.base; }
  for (const l of E.loot) l.glint.material.opacity = 0.5 + Math.sin(now * 0.004 + l.seed) * 0.4;
  const blink = (now / 400 | 0) % 2 === 0;
  for (const t of E.traps) if (t.g.userData.led) t.g.userData.led.visible = t.armed && blink;

  if (E.lightOn) {
    E.charge -= dt;
    if (E.charge <= 0) {
      E.lightOn = false; E.charge = 0;
      act('xConsume', 'battery', 1).then(ok => { if (!E) return; if (ok) { E.charge = BATTERY; E.lightOn = true; UI.toast('Swapped in a fresh battery.'); } else UI.toast('Your flashlight died.', 'bad'); });
    }
  }
  E.spot.intensity = E.lightOn ? (E.charge < 15 && Math.random() < 0.15 ? 3 : 38) : 0;
  E.cd -= dt;
  if (E.swingT > 0) E.swingT = Math.max(0, E.swingT - dt * 4);
  animViewModel();
  if (E.shake > 0) { E.shake -= dt; E.camera.position.x += rand(-0.03, 0.03); E.camera.position.y += rand(-0.03, 0.03); }
  if (E.inCab) E.camera.position.copy(E.truck.seat);
  // dragging alone is slow and loud
  if (E.carrying != null) {
    const b = E.bigs.find(x => x.bid === E.carrying);
    if (!b || b.gone || b.loaded) E.carrying = null;
  }
  // bleeding out: 30 s, a heartbeat that gets slower, then dead for the night
  if (E.down && !E.dead) {
    E.bleed -= dt;
    UI.$('bleed').classList.remove('hidden');
    UI.$('bleed').style.setProperty('--k', Math.max(0, E.bleed / BLEED));
    UI.$('bleed-n').textContent = Math.max(0, Math.ceil(E.bleed));
    if ((E.heartT -= dt) <= 0) { E.heartT = 0.8 + (1 - E.bleed / BLEED) * 1.2; sfx.heart(0.4 + 0.6 * E.bleed / BLEED); }
    if (E.bleed <= 0) die();
  }
  // cracking Rusty's safe: stay close, it makes noise every second
  const s = E.safe;
  if (s?.cracking && !s.open) {
    if (E.down || Math.hypot(P().x - s.x, P().z - s.z) > 2.2) s.cracking = false;
    else {
      s.progress += dt / (G.tools.crowbar ? 6 : 12);
      if ((s.noiseT = (s.noiseT || 0) - dt) <= 0) { s.noiseT = 1; sfx.ratchet(); makeNoise(s.x, s.z, 10); }
      if (s.progress >= 1) { s.cracking = false; act('xSafe'); }
    }
  }
  // footsteps you can see, and the noise meter
  const moving = G.running || (me()?.walking);
  if (G.running && !E.down && (E.stepT -= dt) <= 0) { E.stepT = 0.6; noiseRing(E.scene, P().x, P().z, 8, 0xffffff); }
  const base = E.down || E.hidden != null || E.inCab ? 0 : E.carrying != null ? 0.75 : G.running ? 0.6 : E.crouch ? 0.08 : 0.25;
  E.noise = Math.max(base * (moving || E.carrying != null ? 1 : 0.3), E.noise - dt * 0.8);
  // publish local state for the AI / voice / other players
  const my = me();
  if (my) Object.assign(my, { hp: E.hp, down: E.down, dead: E.dead, bleed: E.down && !E.dead ? E.bleed : 0, hidden: E.hidden ?? false, cab: E.inCab, crouch: E.crouch, light: E.lightOn });
  if (E.down) spectate();
  if ((E.hudT -= dt) <= 0) { E.hudT = 0.2; hud(); }
}

let specIdx = 0;
export function nextSpectate() { specIdx++; }
function spectate() {
  const mates = Object.values(G.players).filter(p => p.id !== G.me && p.world === 'exp' && !p.down);
  if (!mates.length) return;
  const p = mates[specIdx % mates.length];
  const back = V(-Math.sin(p.ry) * 2.5, 0, -Math.cos(p.ry) * 2.5);
  E.camera.position.set(p.x + back.x, 2.4, p.z + back.z);
  E.camera.lookAt(p.x, 1.4, p.z);
}

export function hud() {
  if (!E) return;
  const T = E.loc.time, m = 22 * 60 + (T - E.time) / T * 360, h = Math.floor(m / 60) % 24, left = Math.max(0, Math.ceil(E.time));
  UI.$('exp-loc').innerHTML = `${E.loc.icon} ${E.loc.name} ${UI.skulls(E.skulls)}<br><span class="dim">${E.ev.name}</span>`;
  UI.$('exp-time').innerHTML = `${(h + 11) % 12 + 1}:${String(Math.floor(m % 60)).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} · <span class="${left <= 60 ? 'warn' : ''}">🛻 leaves in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`;
  UI.$('exp-hp').style.width = Math.max(0, E.hp) + '%';
  UI.$('exp-hp-num').textContent = E.dead ? 'DEAD' : E.down ? 'DOWN' : `${Math.ceil(E.hp)} HP`;
  UI.$('exp-bag').innerHTML = `🎒 ${bagSize(E.bag)}/${bagCap(G.me)} ${E.bag.map(i => itemById(i.id).icon).join('')} · 🛻 bed: ${E.cargoCount ?? 0}${E.crouch ? ' · <b>crouching</b>' : ''}`
    + `<div class="noise-meter" title="How much noise you make"><span>🔊</span><div><i style="width:${Math.round(E.noise * 100)}%"></i></div></div>`
    + (E.objective ? `<div class="obj small">⭐ ${E.objective}${E.safe?.open ? ' <span class="ok">✓ open</span>' : ''}</div>` : '');
  const team = Object.values(G.players).filter(p => p.world === 'exp');
  UI.$('exp-light').innerHTML = (G.tools.flashlight
    ? `🔦 ${E.lightOn ? '<b class="ok">ON</b>' : 'off'} ${kb('flashlight')}<div class="batt"><div style="width:${E.charge / BATTERY * 100}%"></div></div>🔋 ×${G.gear.battery}`
    : '<span class="dim">No flashlight</span>')
    + (G.tools.radio ? `<div class="dim small">📻 hold ${kb('radio')} to radio</div>` : '')
    + (team.length > 1 ? `<div class="team">${team.map(p => `<div>${p.dead ? '💀' : p.down ? '🩸' : p.cab ? '🛻' : p.hidden !== false && p.hidden != null ? '🫥' : '🧍'} ${p.name} <span class="dim">${p.dead ? 'dead' : p.down ? `bleeding ${Math.ceil(p.bleed || 0)} s` : Math.ceil(p.hp) + ' HP'}</span></div>`).join('')}</div>` : '');
  const cnt = { trap: G.gear.trap, mine: G.gear.mine, bandage: G.gear.bandage, pepper: G.gear.pepper, taser: G.gear.taser, revolver: G.gear.ammo9, shotgun: G.gear.shells };
  const icon = { trap: ['🪤', 'Trap'], mine: ['💣', 'Mine'], bandage: ['🩹', 'Bandage'] };
  UI.$('hotbar').innerHTML = slots().map((k, i) => {
    const [ic, nm] = WEAPONS[k] ? [WEAPONS[k].icon, WEAPONS[k].name] : icon[k];
    const c = cnt[k];
    return `<div class="slot ${i === E.slot ? 'on' : ''} ${c === 0 ? 'empty' : ''}"><kbd>${i + 1}</kbd><span>${ic}</span><small>${nm}${c !== undefined ? ' ×' + c : ''}</small></div>`;
  }).join('');
}

// ---------- night choice ----------
export function nightPanel(go, sleep) {
  const own = [...Object.entries(G.tools).filter(([, v]) => v).map(([k]) => ({ flashlight: '🔦', radio: '📻', screwdriver: '🪛', wrench: '🔧', crowbar: '🪝', magnifier: '' }[k])),
    ...Object.entries(G.weapons).filter(([, v]) => v).map(([k]) => WEAPONS[k]?.icon)].join(' ') || 'nothing yet';
  UI.openPanel(`<h2>🌃 Tonight</h2>
    <p class="dim">Go scavenging, or sleep. Difficulty is rolled every day: check the skulls. Your gear: ${own} · 🩹×${G.gear.bandage} 🔋×${G.gear.battery}</p>
    <div class="list">${Object.entries(LOCATIONS).map(([k, l]) => `<div class="pc-row loc-row"><span class="huge">${l.icon}</span><span class="grow"><b>${l.name}</b> ${UI.skulls(G.night?.[k] ?? SKULLS[k][0])}<br>
      <small class="dim">${l.desc}</small><br><small>Enemies: ${l.enemy} · Loot: ${l.loot} · ${Math.round(l.time / 60)} min</small></span>
      <button data-go="${k}">Go ▶</button></div>`).join('')}</div>
    <p class="dim">Dump your bag into the 🛻 truck bed to keep loot safe. Knocked down = you drop your bag and have 30 s for a teammate's bandage, then you're out for the night.
      Every trip to the hospital costs money in the morning. When time runs out the truck leaves, with or without you.</p>
    <div class="row"><button id="n-sleep" class="ghost">💤 Sleep (skip the night)</button><button id="n-back" class="ghost">Not yet</button></div>`, { cls: 'wide' });
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  UI.$('n-sleep').onclick = sleep;
  UI.$('n-back').onclick = () => UI.closePanel();
}

void pick;
