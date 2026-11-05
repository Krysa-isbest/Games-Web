// Ship Madness: boot, the cinematic menu, solo and online games, graphics settings and the main loop.
import * as THREE from 'three';
import { G, S, isGuest, isHost, isOnline } from './state.js';
import { buildOcean, updateOcean, waveHeight, SKY, setOceanDetail, setFogDensity } from './ocean.js';
import { makeIslands, ISLANDS } from './islands.js';
import { spawnShip, shipCollisions, removeGoneShips, updateLamps } from './ship.js';
import { updateItems, updateCrates, updateSharks, clearSharks, populateShip } from './entities.js';
import { updateAI, clearBots } from './ai.js';
import { updateWeaponsWorld, resetWeaponsWorld, insideAnyHull } from './weapons.js';
import { FX } from './fx.js';
import { initAudio, audioTick, setVolume } from './sfx.js';
import { initInput, IN, lock, unlock, endFrame, pressed } from './input.js';
import { kb } from './keys.js';
import * as UI from './ui.js';
import { setAdmin, spawnEnemy, canAdmin } from './admin.js';
import { Sandbox, FFA, Campaign, GuestGame, campReward, campResults } from './modes.js';
import { kit, shipCfg } from './progression.js';
import { setGarageHook, garageMode } from './garage.js';
import { renderWorld, resizeUnderwater, setUnderwaterPixelRatio } from './underwater.js';
import { NET, leaveNet } from './net.js';
import { Avatar, installHooks, installActions, installGuestHandlers, installSharedHandlers, hostTick, sendMyState, sendChat, startVoice, voiceTick, stopVoice, byId } from './online.js';
import { initLobby, lobbyBack, renderPlayers } from './lobby.js';
import { Player } from './player.js';
import { initMusic, musicTick } from './music.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: S.aa, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const airFog = new THREE.Fog(SKY.horizon, 160, 850);
scene.fog = airFog;
const camera = new THREE.PerspectiveCamera(S.fov, innerWidth / innerHeight, 0.03, 3000);
scene.add(camera);
Object.assign(G, { scene, camera, renderer, toast: UI.toast, ui: UI, showResults: UI.showResults, lock, unlock, spawnEnemy, chat: UI.chatLine, killfeed: UI.killLine, campReward, campResults, populate: populateShip });
G.announce = (t, k) => UI.toast(t, k);

scene.add(new THREE.HemisphereLight('#cfe6ff', '#24505e', 0.9));
scene.add(new THREE.AmbientLight('#ffffff', 0.12));
const sun = new THREE.DirectionalLight('#fff1d8', 2.6);
sun.castShadow = true;
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
G.sun = sun;

// ---------- graphics settings ----------
const VIEW = { near: [110, 480, 0.0038], mid: [140, 680, 0.0027], far: [170, 900, 0.0019] };
const SHADOW = { low: [1024, 32], high: [2048, 45], ultra: [4096, 60] };
function applyGraphics() {
  const pr = Math.min(devicePixelRatio, 2) * S.scale;
  renderer.setPixelRatio(pr); setUnderwaterPixelRatio(pr);
  const sh = SHADOW[S.shadows];
  renderer.shadowMap.enabled = !!sh;
  sun.castShadow = !!sh;
  if (sh) {
    if (sun.shadow.mapSize.x !== sh[0]) { sun.shadow.mapSize.set(sh[0], sh[0]); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    Object.assign(sun.shadow.camera, { left: -sh[1], right: sh[1], top: sh[1], bottom: -sh[1], near: 1, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const v = VIEW[S.view] || VIEW.far;
  airFog.near = v[0]; airFog.far = v[1]; setFogDensity(v[2]);
  if (G.oceanDetail !== S.ocean) setOceanDetail(S.ocean);
  G.fxScale = { low: 0.45, normal: 1, high: 1 }[S.particles] ?? 1;
  document.getElementById('fps').classList.toggle('hidden', !S.showFps);
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
}
G.oceanDetail = S.ocean;

FX.init(scene);
makeIslands(scene, 1337);
buildOcean(scene, ISLANDS);
initInput();
applyGraphics();
installHooks(); installActions(); installGuestHandlers(); installSharedHandlers();

// ---------- menu showcase + cinematic camera ----------
let showcase = null, shotT = 0, shot = 0;
function makeShowcase(mode = garageMode()) {
  clearWorld();
  const k = kit(mode), cfg = shipCfg(mode, k.ship);
  showcase = spawnShip(k.ship, { team: 'player', x: 0, z: 0, yaw: 0.4, guns: cfg.guns, name: 'Your ship' });
  showcase.throttle = 1; showcase.rudderIn = 0.25;
  shotT = 0;
}
setGarageHook(mode => { if (!G.running) makeShowcase(mode); });
const SHOTS = [
  (s, t) => [[s.hw + 9 + s.hl * 0.2, 1.4, -s.hl * 0.6 + t * 1.6], [0, s.deckTop, t * 1.2]],
  (s, t) => { const a = t * 0.06 + 0.5, r = s.hl + 22; return [[Math.sin(a) * r, 14 + s.hl * 0.2, Math.cos(a) * r], [0, s.deckTop * 0.8, 0]]; },
  (s, t) => [[-4 - t * 0.2, s.deckTop + 1.2, s.hl + 9], [0, s.deckTop + 2, s.hl * 0.2]],
  (s, t) => [[s.hw + 5, -2.4, -s.hl * 0.3 + t * 0.6], [0, -0.6, s.hl * 0.2]],
  (s, t) => [[-6, s.deckTop + 5, -s.hl - 16 - t * 0.5], [0, s.deckTop, 0]],
];
const camLook = new THREE.Vector3();
function cinematic(dt) {
  const s = showcase;
  if (!s) return;
  shotT += dt;
  if (shotT > 9) { shotT = 0; shot = (shot + 1) % SHOTS.length; }
  document.getElementById('fade').classList.toggle('on', shotT > 8.4 || shotT < 0.15);
  const [p, l] = SHOTS[shot](s, shotT);
  camera.position.copy(s.toWorld(new THREE.Vector3(...p)));
  if (shot !== 3) camera.position.y = Math.max(camera.position.y, waveHeight(camera.position.x, camera.position.z) + 0.8);
  camLook.copy(s.toWorld(new THREE.Vector3(...l)));
  camera.lookAt(camLook);
  if (Math.abs(camera.fov - 55) > 0.1) { camera.fov = 55; camera.updateProjectionMatrix(); }
  if (Math.hypot(s.x, s.z) > 120) { s.x *= 0.5; s.z *= 0.5; }
}

function clearWorld() {
  G.game?.end?.();
  for (const s of G.ships) G.scene.remove(s.group);
  G.ships = [];
  for (const it of G.items) it.mesh.parent?.remove(it.mesh);
  G.items = [];
  for (const c of G.crates) c.mesh.parent?.remove(c.mesh);
  G.crates = [];
  clearBots(); clearSharks(); resetWeaponsWorld();
  if (G.me) { G.me.dispose(); for (const ch of [...G.camera.children]) G.camera.remove(ch); }
  for (const p of G.players) if (p.isRemote) p.remove();
  G.me = null; G.players = []; G.game = null; G.voxOut = [];
  showcase = null;
}

G.hookShip = s => {
  s.onSink = ship => {
    const mine = ship === G.me?.stationShip() || ship === G.me?.frame;
    UI.toast(mine ? `🌊 The ${ship.name} is going down! Abandon ship!` : `🌊 The ${ship.name} is sinking!`, mine ? 'bad' : '');
  };
  s.onSunk = ship => { if (!isGuest()) G.game?.onShipSunk?.(ship); };
};

// remote players as avatars
function makeAvatars() {
  for (const p of G.lobby.players) if (p.id !== G.net.id) G.players.push(new Avatar(p.id, p));
}
function peerMap() {
  const m = {};
  for (const p of G.lobby.players) if (p.peerId) m[p.peerId] = p.id;
  return m;
}
function voiceIds() { const o = {}; for (const p of G.lobby.players) o[p.id] = p.peerId; return o; }

let lastStart = null;
function start(mode, opts) {
  initAudio();
  clearWorld();
  lastStart = [mode, opts];
  G.mode = mode;
  G.admin.god = false; G.admin.infAmmo = false;
  G.ff = mode === 'ffa' || (mode === 'sandbox' && !!opts.ff && isOnline());
  G.running = true; G.paused = false;
  if (isOnline()) makeAvatars();
  const game = mode === 'sandbox' ? new Sandbox(opts) : mode === 'ffa' ? new FFA(opts) : new Campaign(opts);
  G.game = game;
  document.getElementById('fade').classList.remove('on');
  UI.hideScreens();
  UI.buildHelp();
  game.start();
  if (isOnline()) startVoice(voiceIds());
  if (!(game instanceof Campaign)) lock();
  firstTips();
}
function firstTips() {
  if (localStorage.getItem('shipmadness.tips')) return;
  localStorage.setItem('shipmadness.tips', '1');
  const tips = [
    `🧭 Walk to the helm console in front of the bridge and press ${kb('use').replace('Key', '')} to drive.`,
    '🔫 Your ship has no deck guns yet: buy them in the Garage. Until then, use your rifle and grenades.',
    '🕳️ Holes below the waterline flood the hold: grab a plank from the storage crate in the stern hold and click on the hole.',
    `❓ Press ${kb('help').replace('Key', '')} any time for all the controls.`,
  ];
  tips.forEach((t, i) => setTimeout(() => G.running && UI.toast(t), 2500 + i * 6000));
}
// guests: mirror the host's game; our own player appears when the host places us
function startGuest(mode, opts) {
  initAudio();
  clearWorld();
  G.mode = mode;
  G.admin.god = false; G.admin.infAmmo = false;
  G.ff = mode === 'ffa' || (mode === 'sandbox' && !!opts.ff);
  G.running = true; G.paused = false;
  makeAvatars();
  G.game = new GuestGame(mode, opts);
  document.getElementById('fade').classList.remove('on');
  UI.hideScreens();
  UI.buildHelp();
  startVoice(voiceIds());
  UI.toast('⛵ Joining the host… click the game to take control.', 'good');
}
G.onPlaced = m => {
  const s = byId.ship(m.s);
  if (!s) return setTimeout(() => G.onPlaced(m), 200);     // the ship may still be on its way
  if (!G.me) {
    const me = new Player(kit(G.mode));
    me.team = G.mode === 'ffa' ? G.net.id : 'player';
    G.me = me; G.players.unshift(me);
    for (const p of G.players) if (p.isRemote) p.team = G.mode === 'ffa' ? p.id : 'player';
  }
  const me = G.me;
  me.leaveStation();
  if (!me.alive) { me.alive = true; me.hp = 100; me.out = false; }
  me.home = s;
  me.placeOn(s, new THREE.Vector3(...m.lp));
};
function quitToMenu() {
  G.running = false; G.paused = false;
  setAdmin(false);
  UI.closeOverlay();
  unlock();
  stopVoice();
  if (isOnline()) { leaveNet(); G.lobby.players = []; }
  makeShowcase();
  UI.show('menu');
}
function backToLobby() {
  G.running = false; G.paused = false;
  setAdmin(false); UI.closeOverlay(); unlock(); stopVoice();
  makeShowcase();
  UI.show('online');
  renderPlayers();
}

initUI();
function initUI() {
  UI.initUI({
    start,
    firstClick: () => { initAudio(); initMusic(); },
    resume: () => { G.paused = false; UI.hideScreens(); lock(); },
    quit: quitToMenu,
    again: () => { if (lastStart) start(...lastStart); },
    toLobby: () => { if (isHost()) lobbyBack(); backToLobby(); },
    toResults: () => { G.running = false; setAdmin(false); UI.closeOverlay(); unlock(); },
    applySettings: k => {
      if (k === 'vol') setVolume(S.vol);
      if (['preset', 'scale', 'shadows', 'ocean', 'particles', 'view', 'showFps'].includes(k)) applyGraphics();
      UI.buildHelp();
    },
  });
  initLobby({
    start, startGuest, show: UI.show, backToLobby,
    onDrop: pid => {
      if (isGuest() && pid === 'p0') { UI.toast('📡 Lost the connection to the host.', 'bad'); quitToMenu(); return; }
      if (!isHost()) return;
      G.lobby.players = G.lobby.players.filter(p => p.id !== pid);
      const a = byId.player(pid);
      if (a) {
        for (const s of G.ships) { if (s.driver === a) s.driver = null; for (const c of s.cannons) if (c.user === a) c.user = null; }
        for (const it of G.items) if (it.holder === a) { it.holder = null; it.ship = a.frame; it.lp = a.frame ? a.pos.clone() : null; it.wp = a.frame ? null : a.worldPos(); G.netHook?.('despawn', 'item', it); }
        a.remove(); G.players = G.players.filter(p => p !== a);
        G.game?.onDeath?.(a, null, 'left');
        G.announce?.(`👋 ${a.name} left the game.`);
      }
      if (!G.running) renderPlayers();
    },
  });
}

const overlayOpen = () => !document.getElementById('overlay').classList.contains('hidden');
const chatIn = document.getElementById('chat-in');
IN.onLock = locked => {
  if (!G.running) return;
  if (!locked && !G.admin.open && !G.paused && !overlayOpen() && chatIn.classList.contains('hidden')) {
    if (isOnline()) { UI.show('pause'); } else { G.paused = true; UI.show('pause'); }
  }
};
renderer.domElement.addEventListener('click', () => { initAudio(); if (G.running && !G.paused && !G.admin.open && !overlayOpen()) { UI.hideScreens(); lock(); } });
addEventListener('keydown', e => {
  if (!G.running) return;
  if (!chatIn.classList.contains('hidden')) {
    if (e.code === 'Enter') { sendChat(chatIn.value); chatIn.value = ''; chatIn.classList.add('hidden'); lock(); }
    else if (e.code === 'Escape') { chatIn.value = ''; chatIn.classList.add('hidden'); }
    return;
  }
  if (e.code === kb('chat') && isOnline()) { e.preventDefault(); chatIn.classList.remove('hidden'); unlock(); setTimeout(() => chatIn.focus(), 0); return; }
  if (e.code === kb('admin') && canAdmin() && !G.paused) {
    const open = !G.admin.open;
    setAdmin(open);
    if (open) unlock(); else lock();
  }
  if (e.code === kb('help')) document.getElementById('help').classList.toggle('hidden');
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); resizeUnderwater(innerWidth, innerHeight); });

// ---------- loop ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let fpsT = 0, fpsN = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  G.dt = dt;
  const live = G.running && (!G.paused || isOnline());
  if (live || !G.running) G.t += dt;
  if (live) {
    updateAI(dt);
    for (const s of G.ships) s.update(dt);
    if (!isGuest()) shipCollisions(dt);
    if (G.me && !overlayOpen() && chatIn.classList.contains('hidden')) G.me.update(dt);
    for (const p of G.players) if (p.isRemote) p.update(dt);
    updateItems(dt);
    updateCrates(dt);
    updateSharks(dt);
    updateWeaponsWorld(dt);
    G.game?.update(dt);
    if (!isGuest()) removeGoneShips();
    if (isHost()) hostTick(dt);
    if (isOnline()) { sendMyState(dt); voiceTick(peerMap()); }
    if (pressed('Escape') && G.admin.open) { setAdmin(false); lock(); }
  } else if (!G.running) {
    for (const s of G.ships) s.update(dt);
    cinematic(dt);
  }
  FX.update(live || !G.running ? dt : 0);
  if (G.running && G.me) G.me.updateCamera(camera);
  else if (G.running) { const s = G.ships[0]; if (s) { camera.position.set(s.x + 30, 15, s.z + 30); camera.lookAt(s.x, 2, s.z); } }
  G.shake = Math.max(0, (G.shake || 0) - dt * 2.5);
  sun.position.copy(camera.position).addScaledVector(SKY.sunDir, 150);
  sun.target.position.copy(camera.position);
  updateOcean(camera);
  updateLamps(camera);
  const cp = camera.position;
  let kind = null, depth = 0;
  const me = G.running ? G.me : null;
  if (me?.alive && me.mode === 'walk' && me.underKind) { kind = me.underKind; depth = me.underDepth; }
  else { const sea = waveHeight(cp.x, cp.z); if (cp.y < sea - 0.05 && !insideAnyHull(tmp.copy(cp))) { kind = 'sea'; depth = sea - cp.y; } }
  audioTick(!!kind);
  musicTick(dt);
  UI.updateHUD(dt);
  renderWorld(renderer, scene, camera, kind, depth, airFog);
  // count real frames per real second (dt above is capped, so it can't be used here)
  const now = performance.now(); fpsN++; fpsT += Math.min(1, (now - (G.lastFrame || now)) / 1000); G.lastFrame = now;
  if (fpsT >= 0.5) { document.getElementById('fps').textContent = `${Math.round(fpsN / fpsT)} FPS${isOnline() ? ` · ${NET.conns.size} link${NET.conns.size === 1 ? '' : 's'}` : ''}`; fpsN = 0; fpsT = 0; }
  endFrame();
}

makeShowcase('ffa');
frame();
