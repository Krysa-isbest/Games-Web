// Whiteout: what you find out on the island (build step 7a).
//  * Containers (suitcases, the plane's survival pack, the camp's supply box): hold the use key to open one; the
//    host lets what is inside fall out (places.js draws the lid).
//  * The journal: hold it and press the eat key to read it (it opens in the book). The first time anyone in the
//    crew reads it, its notes on snowshoes and torches go into the crafting book for everyone.
//  * The flare gun: with flare shells in your things, hold it and hold the left mouse button for a moment: a red
//    flare goes up, hangs under its parachute and drifts down, and lights the island red for half a minute.
//    Everyone sees it. (Who might see it from outside comes with the endings, step 7b.)
//  * The torch burns in your hand for 5 minutes: light all round you, and a little warmth. Snowshoes anywhere in
//    your things keep you up on top of deep snow.
//  * Finding a place for the first time shows its name; a few hints point the way to them.
import * as THREE from 'three';
import { kn } from './keys.js';
import { on, send } from './net.js';
import * as ISL from './island.js';
import * as SFX from './sfx.js';
import { openBook } from './craft.js';
import { flareUp } from './ends.js';
import { diaryNote } from './obj.js';

let GF = null, H = null;          // the game, and helpers from work.js: { act, hint, shout, announce }
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const TORCH_S = 300;              // seconds a torch burns in your hand

export function initFinds(gm, helpers) {
  GF = gm; H = helpers;
  gm.known ??= new Set();         // pages learned from journals (the crew shares them; the host's game keeps them)
  gm.flares = []; gm.fireT = 0; gm.fireHeld = false; gm.torch = false; gm.seen = new Set();
  gm.torchL = new THREE.PointLight('#ff9a48', 0, 15, 1.5); gm.torchL.position.set(0.32, 0.12, -0.5); gm.camera.add(gm.torchL);
}

// ---------- every frame ----------
export function findsTick(gm, dt, env) {
  const p = gm.player, inv = gm.inv, up = !p.mode && !p.seat && !gm.fainting;
  // finding the places, and the hints that point to them
  if (gm.started && up) {
    for (const pl of gm.world.places || []) if (!gm.seen.has(pl.id) && !pl.hidden?.() && Math.hypot(p.pos.x - pl.pos.x, p.pos.z - pl.pos.z) < pl.r) { gm.seen.add(pl.id); H.announce(gm, pl.name, pl.text); }
    if (gm.escaped && env.light > 0.25 && Math.hypot(p.pos.x - ISL.WRECK.x, p.pos.z - ISL.WRECK.z) < 30 && !gm.seen.has('tail'))
      H.hint(gm, 'tail-way', 'The back of the plane is missing. It must have come down further back, where the plane tore its way through the trees. Look for the red fin.', 8000, true);
    if (env.day >= 1 && env.light > 0.45 && !gm.inShack && Math.hypot(p.pos.x - ISL.SHACK.x, p.pos.z - ISL.SHACK.z) < 40 && !gm.seen.has('camp'))
      H.hint(gm, 'camp-way', 'Far off to the west, above the trees, something red flutters on a tall pole. Somebody put it there.', 8000, true);
  }
  // snowshoes: in your things, they work
  p.shoes = inv.count(t => t === 'snowshoes') > 0;
  // the torch: it burns while you hold it
  const s = inv.held(), lit = up && s?.type === 'torch';
  gm.torch = lit;
  if (lit) {
    s.dry = Math.max(0, (s.dry ?? 1) - dt / TORCH_S);
    if (s.dry <= 0) { inv.slots[inv.sel] = null; inv.ver++; gm.torch = false; SFX.flick(); H.hint(gm, 'torch-out' + Date.now(), 'The torch burns down to the stick, and goes out.', 4000, true); }
    H.hint(gm, 'torch', 'The torch: light all round you, and a little warmth for your hands. It burns for a few minutes.', 6000);
  }
  const t = performance.now() / 1000;
  gm.torchL.intensity = gm.torch ? 2.6 * (0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 9.3 + 1)) : 0;
  // the flare gun: hold the left mouse button a moment to fire (so a click can't waste a shell)
  const gun = up && s?.type === 'flare' && gm.locked && !gm.bagOpen && !gm.bookOpen;
  if (gun && gm.inp.is('primary')) {
    if (!gm.fireHeld) {
      gm.fireHeld = true; gm.fireT = 0;
      if (!inv.count(x => x === 'shells')) { SFX.nope(); H.hint(gm, 'noshells' + Math.floor(t / 10), 'The flare gun is empty. You need flare shells.', 3500, true); gm.fireT = -1; }
      else SFX.clank();
    }
    if (gm.fireT >= 0) { gm.fireT += dt; if (gm.fireT >= 0.6) { gm.fireT = -1; fire(gm); } }
  } else { gm.fireHeld = false; gm.fireT = 0; }
  if (s?.type === 'flare' && inv.count(x => x === 'shells')) H.hint(gm, 'flare-how', `Hold ${kn('primary')} to fire a flare. You have ${inv.count(x => x === 'shells')}: each one counts.`, 6000, true);
  flaresTick(gm, dt, env);
}

// ---------- containers ----------
export function findsActs(gm, look, offer) {
  const props = gm.world.props;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (p.gone || p.kind !== 'case' || p.open) continue;
    const sc = look(p.mesh.position, 2.2, 0.82);
    if (sc) offer(sc + 0.02, { id: 'case' + i, text: `Open ${p.label}`, hold: 1.2, go: () => { H.act(gm, { a: 'open', i }); SFX.grab(); } });
  }
}
// the host (or solo): what an act does to the world
export function findsApply(gm, a) {
  if (a.a === 'learn') { if (typeof a.k === 'string') gm.known.add(a.k); return; }
  if (a.a !== 'open') return;
  const pr = gm.world.props[a.i], at = gm.world.openCase(a.i);
  if (!at) return;
  diaryNote(gm, 'open');
  for (const [type, n] of pr.loot || []) {
    gm.world.stash.spawn({ type, n, data: { dry: 1 }, p: [at.x + (Math.random() - 0.5) * 0.3, at.y + 0.35, at.z + (Math.random() - 0.5) * 0.3], v: [(Math.random() - 0.5) * 1.2, 1.4, (Math.random() - 0.5) * 1.2], w: [Math.random(), Math.random(), Math.random()] });
  }
}

// ---------- reading (the eat key on something you can read); true = it was read, nothing to eat ----------
export function findsEat(gm) {
  const s = gm.inv.held();
  if (!s) return false;
  if (s.type === 'journal') {
    gm.read?.add('journal');
    openBook(gm, 'journal');
    if (!gm.known.has('journal')) {
      gm.known.add('journal');
      H.act(gm, { a: 'learn', k: 'journal' });
      H.hint(gm, 'learned', 'The last pages are notes on snowshoes and torches. They are in the crafting book now: make them at the workbench.', 9000, true);
    }
    return true;
  }
  if (s.type === 'journal2') { gm.read?.add('journal2'); openBook(gm, 'journal2'); return true; }
  if (s.type === 'plan') {           // the old hunter's plan for a winter den: the outlines show in the cave (den.js)
    gm.read?.add('plan'); openBook(gm, 'plan');
    if (!gm.known.has('den')) { gm.known.add('den'); H.act(gm, { a: 'learn', k: 'den' }); H.hint(gm, 'den-learned', 'The plan for a winter den in this cave: a log wall, a door, a fire, a bed. The outlines show where each one goes.', 9000, true); }
    return true;
  }
  if (s.type === 'blackbox') { H.hint(gm, 'bb' + Math.floor(performance.now() / 8000), 'The flight recorder. Whatever happened to Flight 2207 is on it. Take it home, if you ever get home.', 5000, true); return true; }
  return false;
}

// ---------- flares ----------
let flareTex = null;
function fire(gm) {
  if (!gm.inv.use(x => x === 'shells', 1)) return;
  const cam = gm.camera, p = gm.player, cp = Math.cos(p.pitch);
  _d.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
  const at = cam.position.clone().addScaledVector(_d, 0.6), v = _d.clone().multiplyScalar(40); v.y = Math.max(v.y, 0) + 26;
  launch(gm, at, v);
  if (gm.role !== 'solo') send('*', { t: 'g-flare', p: at.toArray().map(x => Math.round(x * 100) / 100), v: v.toArray().map(x => Math.round(x * 100) / 100) });
  const left = gm.inv.count(x => x === 'shells');
  H.hint(gm, 'fired' + Date.now(), `The flare climbs high over the island and hangs there, burning red. Nobody answers it. ${left ? `${left} shell${left > 1 ? 's' : ''} left.` : 'That was the last shell.'} Keep them for when someone could see: a plane close by, a ship.`, 8000, true);
}
function launch(gm, at, v) {
  if (gm.flares.length >= 4) drop(gm, gm.flares[0]);
  const g = new THREE.Group(); g.position.copy(at);
  if (typeof document !== 'undefined') {
    if (!flareTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,230,1)'); gr.addColorStop(0.25, 'rgba(255,80,50,0.9)'); gr.addColorStop(1, 'rgba(255,30,20,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); flareTex = new THREE.CanvasTexture(c); }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.scale.setScalar(5); g.add(sp);
  }
  const light = new THREE.PointLight('#ff3a26', 0, 700, 1.6); g.add(light);
  gm.scene.add(g);
  gm.flares.push({ g, light, v: v.clone(), t: 0, chute: false });
  SFX.flareShot?.();
  flareUp(gm, at);                  // is anybody out there to see it? (ends.js: the host decides)
  diaryNote(gm, 'flare');
}
function drop(gm, f) { gm.scene.remove(f.g); f.light.dispose?.(); gm.flares.splice(gm.flares.indexOf(f), 1); }
function flaresTick(gm, dt, env) {
  for (const f of [...gm.flares]) {
    f.t += dt;
    if (!f.chute) { f.v.y -= 9.8 * dt; f.v.multiplyScalar(1 - 0.15 * dt); if (f.v.y < 0) { f.chute = true; f.v.set(Math.cos(env.wdir) * env.wind * 0.15, -1.3, Math.sin(env.wdir) * env.wind * 0.15); } }
    f.g.position.addScaledVector(f.v, dt);
    const burn = f.t < 1.2 ? f.t / 1.2 : f.t > 32 ? Math.max(0, 1 - (f.t - 32) / 3) : 1;
    f.light.intensity = 2600 * burn * (0.85 + 0.15 * Math.sin(f.t * 21) * Math.sin(f.t * 13 + 2));
    const sp = f.g.children[0]; if (sp?.isSprite) sp.scale.setScalar((4 + 2 * burn) * (0.9 + Math.random() * 0.2));
    if (f.t > 35 || f.g.position.y < Math.max(gm.world.groundY(f.g.position.x, f.g.position.z), ISL.SEA) + 1) drop(gm, f);
  }
}
on('g-flare', m => {
  const gm = GF;
  if (!gm || !gm.ready || !Array.isArray(m.p) || !Array.isArray(m.v)) return;
  launch(gm, _v.fromArray(m.p).clone(), new THREE.Vector3().fromArray(m.v));
  H.hint(gm, 'saw-flare' + Date.now(), 'A red flare goes up over the island: one of your crew fired it.', 5000, true);
});
