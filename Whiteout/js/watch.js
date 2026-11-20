// Whiteout: the night watch and the island's mysteries (step 7e, design.md 7d and 7e).
// The night watch: something for whoever stays awake to do, kept short (a watch is about 3 minutes of real time).
//  * Snow on the roof: while it snows at night it piles up on one side of the roof. The roof creaks and snow dust
//    trickles down. Push it off from outside, standing under the eaves (hold the use key): 2 s with the snow shovel,
//    3 s with a wooden one, 4 s scraping with a board, 7 s by hand (and it costs body heat). Left for three hours of
//    the night, a roof board breaks: a patched hole opens again and the snow falls in.
//  * A board torn loose by the storm: it falls outside, the gap is open again (nail it back).
//  * The door blown open (close it).
//  (Packed snow blown out of a gap is home.js.)
// The mysteries (from the day number: nothing to send): on some nights, three knocks on the door, and in the morning
// no tracks outside; on others, lights out on the sea ice, low and moving, that fade when you come near.
// The host runs the watch (`gm.watch`: it goes out with the shared world and into the save).
import * as THREE from 'three';
import { clamp } from './state.js';
import { on, send } from './net.js';
import * as ISL from './island.js';
import { glowTex } from './scene.js';
import * as SFX from './sfx.js';
import { TYPES } from './items.js';

let GW = null, H = null;            // the game, and helpers from work.js: { act, hint, shout }
const NH = 45, _v = new THREE.Vector3(), _a = new THREE.Vector3();
const night = env => env.hours >= 18 || env.hours < 7;

export function initWatch(gm, helpers) {
  GW = gm; H = helpers;
  gm.watch ??= { load: 0, spot: -1, over: 0, rollT: 0 };
  gm.watchL = { creakT: 4, pile: null, lights: null, knocked: -1, heard: -1, said: new Set() };
}

// ---------- every frame ----------
export function watchTick(gm, dt, env) {
  const W = gm.watch, Lw = gm.watchL, w = gm.world, home = gm.home, host = gm.role !== 'guest', ts = gm.ts || 1;
  if (!W) return;
  if (host && gm.started && !w.burned && gm.escaped) {
    if (night(env)) {
      // snow piling up on the roof while it snows (a storm), until it has to come off
      if (env.storm > 0.3 && W.spot < 0) { W.load += dt * ts * env.storm / (1.5 * NH); if (W.load >= 1) { W.spot = pickRoof(w); W.over = 0; say(gm, 'roof'); } }
      if (W.spot >= 0) { W.over += dt * ts; if (W.over > 3 * NH) breakRoof(gm); }
      // once a night hour in a storm: a board torn loose, the door blown open
      W.rollT += dt * ts;
      if (W.rollT >= NH) {
        W.rollT = 0;
        if (env.storm > 0.5 && Math.random() < 0.1) tearBoard(gm);
        if (env.storm > 0.45 && home.door === 'closed' && Math.random() < 0.12) { home.door = 'open'; home.apply?.(home.snap()); w.shack.door.set?.('open'); say(gm, 'door'); }
      }
    }
  }
  // the roof creaks while the snow is on it (for anyone near the shack); the pile shows
  const near = gm.camera.position.distanceTo(w.shack.stove.pos) < 14;
  if (W.spot >= 0 && near && !w.burned) { Lw.creakT -= dt; if (Lw.creakT <= 0) { Lw.creakT = 4 + Math.random() * 4; SFX.creak(0.7); } H.hint(gm, 'roofload' + Math.floor(gm.T / 600), 'The roof creaks under the weight of the snow. Push it off from outside, standing under the eaves, before it breaks the boards.', 7000, true); }
  pileVisual(gm);
  mysteries(gm, dt, env);
}
function pickRoof(w) {
  const roofs = w.shack.spots.map((s, i) => (s.kind === 'roof' ? i : -1)).filter(i => i >= 0);
  return roofs[Math.random() * roofs.length | 0] ?? -1;
}
function breakRoof(gm) {
  const W = gm.watch, home = gm.home, i = W.spot;
  W.spot = -1; W.load = 0; W.over = 0;
  if (i >= 0 && home.patch[i] === 2) { home.patch[i] = 0; home.apply?.(home.snap()); }
  home.air = Math.max(0, home.air - 0.25);
  say(gm, 'roofbroke');
}
function tearBoard(gm) {
  const w = gm.world, home = gm.home;
  const walls = w.shack.spots.map((s, i) => (s.kind === 'wall' && home.patch[i] === 2 ? i : -1)).filter(i => i >= 0);
  if (!walls.length) return;
  const i = walls[Math.random() * walls.length | 0], s = w.shack.spots[i];
  home.patch[i] = 0; home.apply?.(home.snap());
  const out = _a.copy(s.pos).addScaledVector(s.outW, 0.8);
  w.stash.spawn({ type: 'board', p: [out.x, Math.max(w.groundY(out.x, out.z), ISL.SEA) + 0.3, out.z], v: [s.outW.x, 0.5, s.outW.z] });
  say(gm, 'board');
}
// where you stand to push the snow off: outside, under the eaves of that side of the roof
export function eavePos(gm, out) {
  const w = gm.world, s = w.shack.spots[gm.watch.spot], half = w.shack.half;
  if (!s) return null;
  return out.set(s.local.x, half.y - 0.9 + 0.1, Math.sign(s.local.z) * (half.z + 0.45)).applyMatrix4(w.shack.M);
}
function pileVisual(gm) {
  const W = gm.watch, Lw = gm.watchL, w = gm.world;
  const show = W.spot >= 0 && !w.burned;
  if (show && !Lw.pile && typeof document !== 'undefined') {
    Lw.pile = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 1.9), new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 1 }));
    Lw.pile.castShadow = true; gm.scene.add(Lw.pile);
  }
  if (!Lw.pile) return;
  Lw.pile.visible = show;
  if (!show) return;
  const s = w.shack.spots[W.spot], sg = Math.sign(s.local.z) || 1;
  Lw.pile.position.copy(_v.set(s.local.x, s.local.y + 0.42, s.local.z * 1.05).applyMatrix4(w.shack.M));
  Lw.pile.quaternion.setFromRotationMatrix(w.shack.M).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(sg * 0.62, 0, 0)));
}

// ---------- what the watch does (work.js findAct asks) ----------
export function watchActs(gm, look, offer) {
  const W = gm.watch;
  if (!W || W.spot < 0 || gm.world.burned) return;
  const e = eavePos(gm, _v);
  if (!e) return;
  const p = gm.player, d = Math.hypot(p.pos.x - e.x, p.pos.z - e.z);
  if (d > 2.6 || gm.inShack) return;
  const ht = gm.inv.heldType(), hold = ht === 'shovel' ? 2 : ht === 'wshovel' ? 3 : ht === 'board' ? 4 : 7;
  offer(0.95, { id: 'roofsnow', text: ht === 'shovel' || ht === 'wshovel' ? 'Shovel the snow off the roof' : ht === 'board' ? 'Scrape the snow off the roof with the board' : 'Push the snow off the roof with your hands (cold work)', hold, go: () => {
    if (hold >= 7) gm.player.heat = Math.max(0, gm.player.heat - 6);
    H.act(gm, { a: 'watch', op: 'clear' }); H.shout(gm, 'pack', e);
  } });
}
export function watchApply(gm, a) {
  const W = gm.watch;
  if (a.op === 'clear' && W.spot >= 0) { W.spot = -1; W.load = 0; W.over = 0; say(gm, 'cleared'); }
}

// ---------- messages ----------
const SAYS = {
  roof: 'Snow is piling up on the roof. If nobody pushes it off, it will break the boards.',
  roofbroke: 'With a crack, a roof board gives way under the snow. Snow pours into the shack.',
  board: 'The storm rips a board off the wall with a bang. The gap is open again.',
  door: 'A gust slams the door open. The cold pours in.',
  cleared: 'The snow slides off the roof in one heavy slab.',
};
function say(gm, k) { show(gm, k); if (gm.role === 'host') send('*', { t: 'g-watch', k }); }
function show(gm, k) {
  if (!SAYS[k]) return;
  const near = gm.camera.position.distanceTo(gm.world.shack.stove.pos) < 25 || gm.life?.st === 'sleep';
  if (!near && k !== 'roof') return;
  H.hint(gm, 'watch-' + k + Math.floor(gm.T), SAYS[k], 6000, true);
  if (k === 'board' || k === 'door' || k === 'roofbroke') H.shout ? SFX.at(gm.camera.position.distanceTo(gm.world.shack.stove.pos), SFX.door) : 0;
}
on('g-watch', m => { const gm = GW; if (gm && gm.ready && gm.role === 'guest') show(gm, m.k); });

// ---------- the mysteries (worked out from the night: the same for everyone, nothing sent) ----------
function mysteries(gm, dt, env) {
  const Lw = gm.watchL, w = gm.world, day = env.day, T = gm.T;
  if (day < 2 || !gm.started) return;
  // three knocks on the door, some nights around midnight
  const r = ISL.mulberry(day * 911 + 5), knocks = r() < 0.4, kT = (day - 1) * ISL.DAY + 480 + (6.5 + r() * 2.5) * NH;      // between 22:30 and 01:00
  if (knocks && Lw.knocked !== day && T >= kT && T < kT + 20) {
    Lw.knocked = day;
    const d = gm.camera.position.distanceTo(w.shack.door.pos);
    if (d < 30 && !w.burned && gm.life?.st !== 'dead') {
      Lw.heard = day;
      for (const k of [0, 0.55, 1.1]) setTimeout(() => SFX.at(d, SFX.knock), k * 1000);
      setTimeout(() => H.hint(gm, 'knock' + day, 'Three knocks on the door. Then nothing.', 5000, true), 1800);
    }
  }
  if (Lw.heard === day - 1 && env.hours >= 8 && env.hours < 10 && !Lw.said.has('tracks' + day)) {
    Lw.said.add('tracks' + day);
    H.hint(gm, 'tracks' + day, 'Outside the door there are no tracks in the new snow. Only yours.', 7000, true);
  }
  // lights out on the sea ice, some nights, low and moving; they fade when you come near
  const r2 = ISL.mulberry(day * 1301 + 9), lit = r2() < 0.35 && (env.hours >= 21 || env.hours < 3), ang = r2() * Math.PI * 2;
  if (!lit) { if (Lw.lights) Lw.lights.g.visible = false; return; }
  if (!Lw.lights && typeof document !== 'undefined') {
    const g = new THREE.Group(), list = [];
    for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(220,255,240,1)', 'rgba(0,0,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); s.scale.setScalar(4); g.add(s); list.push(s); }
    gm.scene.add(g);
    Lw.lights = { g, list };
  }
  if (!Lw.lights) return;
  const t = T * 0.01, cam = gm.camera.position;
  Lw.lights.g.visible = true;
  Lw.lights.list.forEach((s, i) => {
    const a = ang + Math.sin(t + i * 2.1) * 0.25 + i * 0.05, rr = 470 + Math.sin(t * 0.7 + i) * 50;
    s.position.set(Math.cos(a) * rr, ISL.SEA + 1.2 + Math.sin(t * 3 + i) * 0.3, Math.sin(a) * rr);
    const d = s.position.distanceTo(cam);
    s.material.opacity = clamp((d - 120) / 200, 0, 1) * (0.6 + 0.4 * Math.sin(t * 9 + i * 3));
  });
  const d0 = Lw.lights.list[0].position.distanceTo(cam);
  if (d0 < 700) H.hint(gm, 'lights' + day, 'Lights out on the sea ice, low and moving. Not a ship.', 6000, true);
}
export const watchSnap = gm => (gm.watch ? { load: Math.round(gm.watch.load * 100) / 100, spot: gm.watch.spot, over: Math.round(gm.watch.over) } : null);
export function watchLoad(gm, s) { if (gm.watch && s) Object.assign(gm.watch, { load: +s.load || 0, spot: s.spot ?? -1, over: +s.over || 0 }); }
void TYPES;
