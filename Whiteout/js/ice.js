// Whiteout: falling through the ice (build step 6, design.md 7b).
// Out on the sea ice lie patches of thin ice: darker, with cracks, and different every day (everyone works out the
// same patches from the day number, so nothing has to be sent). It groans when you walk near it and under you.
// Your weight on it adds up: standing still, walking, sprinting, landing a jump, a friend next to you, carrying
// someone. Crouched you spread your weight and can crawl off it. Too much and it gives way.
// In the water: cold shock (body heat drops fast) and about 25 seconds. Press the key shown (W A S D, it keeps
// changing) to haul yourself out; a wrong key and you slip back. Ice picks (the workbench) make it much easier;
// without them, alone, it is nearly impossible. A friend can crawl to the hole and reach out a hand: while they
// hold on, you climb faster, and every good pull they time (a click on the bar) hauls you up a bit more. Too many
// people standing at the edge break it again.
// Out: Soaked, freezing; get to a fire. Too slow: you drift under the ice: downed at the edge (Mild), dead
// (the rest, see life.js). What you held may sink: anything but the axe and the pipe, which end up on the ice.
import * as THREE from 'three';
import { G, clamp, lerp } from './state.js';
import { BINDS, keyName, kn } from './keys.js';
import { on } from './net.js';
import * as ISL from './island.js';
import * as SFX from './sfx.js';
import { TYPES } from './items.js';
import { LS } from './voice.js';

let GI = null, H = null;          // the game, and helpers: { hint, act drop, die, goDown, tell, closeUI }
const BREAK = 3.4, MOVE = ['forward', 'left', 'back', 'right'];
let crackTex = null;

export function initIce(gm, helpers) {
  GI = gm; H = helpers;
  gm.ice = { day: -999, patches: [], group: new THREE.Group(), stress: 0, creakT: 0, nearT: 0, landed: false, swim: null, holes: new Map(), prevK: new Set(), puller: null };
  gm.scene.add(gm.ice.group);
  gm.dom.root.insertAdjacentHTML('beforeend', `<div class="gm-ice hidden"><small>You are in the water</small><b class="gi-key"></b><div class="gi-row"><span>Out</span><div class="gi-bar p"><i></i></div></div><div class="gi-row"><span>Air</span><div class="gi-bar t"><i></i></div></div><p></p></div>`);
  const q = s => gm.dom.root.querySelector(s);
  Object.assign(gm.dom, { ice: q('.gm-ice'), iceKey: q('.gi-key'), iceProg: q('.gi-bar.p i'), iceT: q('.gi-bar.t i'), iceP: q('.gm-ice p') });
}

// ---------- the thin patches of the day ----------
function patchesFor(gm, day) {
  const rng = ISL.mulberry(day * 7919 + 2207), out = [], w = gm.world;
  for (let tries = 0; tries < 200 && out.length < 18; tries++) {
    const a = rng() * Math.PI * 2, r = 250 + rng() * 340, x = Math.cos(a) * r, z = Math.sin(a) * r, rad = 6 + rng() * 9;
    if (w.groundY(x, z) > ISL.SEA - 0.6 || w.groundY(x + rad, z) > ISL.SEA - 0.3 || w.groundY(x - rad, z) > ISL.SEA - 0.3 || w.groundY(x, z + rad) > ISL.SEA - 0.3 || w.groundY(x, z - rad) > ISL.SEA - 0.3) continue;
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < o.r + rad + 4)) continue;
    out.push({ x, z, r: rad, rot: rng() * 6.28 });
  }
  return out;
}
function texture() {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(8,22,36,0.85)'); g.addColorStop(0.7, 'rgba(14,34,52,0.6)'); g.addColorStop(1, 'rgba(20,40,60,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(210,230,245,0.55)'; x.lineCap = 'round';
  const crack = (px, py, a, len, w) => {
    if (len < 6 || w < 0.3) return;
    const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
    x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    crack(ex, ey, a + (Math.random() - 0.5) * 0.9, len * 0.75, w * 0.8);
    if (Math.random() < 0.45) crack(ex, ey, a + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6), len * 0.5, w * 0.6);
  };
  for (let i = 0; i < 9; i++) crack(128 + (Math.random() - 0.5) * 30, 128 + (Math.random() - 0.5) * 30, Math.random() * 6.28, 24 + Math.random() * 20, 1.8);
  crackTex = new THREE.CanvasTexture(c); crackTex.colorSpace = THREE.SRGBColorSpace;
  return crackTex;
}
function rebuild(gm, day) {
  const I = gm.ice;
  I.day = day;
  for (const m of [...I.group.children]) { I.group.remove(m); m.geometry?.dispose(); m.material?.dispose(); }
  I.patches = patchesFor(gm, day);
  if (typeof document === 'undefined') return;
  const tex = texture();
  for (const pt of I.patches) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(pt.r, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.12, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(pt.x, ISL.SEA + 0.012, pt.z); m.rotation.y = pt.rot; m.receiveShadow = true; m.renderOrder = 1;
    I.group.add(m);
  }
}
// the thin patch at this spot (with a margin around it), or null
export function patchAt(gm, pos, margin = 0) {
  for (const pt of gm.ice.patches) if (Math.hypot(pos.x - pt.x, pos.z - pt.z) < pt.r + margin) return pt;
  return null;
}

// ---------- every frame ----------
export function iceTick(gm, dt, env) {
  const I = gm.ice, p = gm.player, L = gm.life;
  if (env.day !== I.day) rebuild(gm, env.day);
  holes(gm);
  if (L.st === 'swim') { swimTick(gm, dt); return; }
  gm.dom.ice.classList.add('hidden');
  if (L.st !== 'up' || !gm.started) { I.stress = 0; return; }
  const onIce = p.grounded && p.surface === 'ice', pt = onIce ? patchAt(gm, p.pos) : null;
  if (pt) {
    let k = p.crouched ? 0.22 : p.sprinting ? 2.3 : p.moving ? 1.1 : 0.75;
    if (p.heavy) k *= 1.6;
    for (const a of gm.avatars.values()) {
      const ls = a.to?.ls ?? LS.up, d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      if ((ls === LS.up || ls === LS.carried) && d < 3.5) k += a.to?.cr ? 0.12 : 0.45;
      if (ls === LS.swim && d < 3.2) k *= 1.7;                 // the edge of a hole is the weakest ice of all
    }
    if (p.landT > 0.3 && !I.landed) { I.stress += 1.1; I.landed = true; } else if (p.landT <= 0) I.landed = false;
    I.stress += dt * k;
    I.creakT -= dt;
    if (I.creakT <= 0) { I.creakT = lerp(1.8, 0.4, clamp(I.stress / BREAK, 0, 1)); SFX.creak(0.6 + 0.6 * I.stress / BREAK); }
    H.hint(gm, 'thin', `The ice groans under you. Dark ice is thin ice: crouch (${kn('crouch')}) to spread your weight, and crawl off it.`, 7000, true);
    if (I.stress >= BREAK) fallIn(gm);
  } else {
    I.stress = Math.max(0, I.stress - dt * 0.6);
    if (onIce && p.moving && patchAt(gm, p.pos, 5)) {          // walking up to thin ice: it groans now and then
      I.nearT -= dt;
      if (I.nearT <= 0) { I.nearT = 2.5 + Math.random() * 2; SFX.creak(0.35); H.hint(gm, 'thin-near', 'You hear the ice groaning ahead. Where it is dark, it is thin.', 6000, true); }
    }
  }
}
function fallIn(gm) {
  const I = gm.ice, p = gm.player, L = gm.life, inv = gm.inv;
  I.stress = 0;
  H.closeUI(gm);
  gm.hands.lit = false;
  // what you held may slip out of your hand: it sinks (the axe and the pipe skid away onto the ice)
  const s = inv.held();
  let lost = '';
  if (s && s.type !== 'picks' && Math.random() < 0.35) {          // (the ice picks hang on a cord round your neck)
    const it = inv.take(inv.sel, 99);
    if (it.type === 'axe' || it.type === 'pipe' || it.type === 'saxe') { const a = Math.random() * 6.28; H.drop(gm, it.type, it.n, it.data, [p.pos.x + Math.cos(a) * 2.2, ISL.SEA + 0.3, p.pos.z + Math.sin(a) * 2.2]); lost = `${TYPES[it.type].name[0].toUpperCase() + TYPES[it.type].name.slice(1)} skids away across the ice.`; }
    else lost = `${TYPES[it.type].short} slips out of your hand and sinks.`;
  }
  L.st = 'swim';
  p.setMode('swim'); p.hold(p.pos.x, ISL.SEA, p.pos.z);
  I.swim = { T: 25, max: 25, prog: 10, key: MOVE[Math.random() * 4 | 0], pulledT: 0, x: p.pos.x, z: p.pos.z, gaspT: 1 };
  I.prevK = new Set(MOVE.filter(a => gm.inp.is(a)));
  p.heat = Math.max(0, p.heat - 12); p.wet = 1;
  SFX.crack(); setTimeout(() => SFX.splash(), 320); setTimeout(() => SFX.gasp(1.3), 700);
  H.tell('ice');
  const picks = inv.count(t => t === 'picks') > 0;
  H.hint(gm, 'fell' + Date.now(), `The ice gives way! Press the key on the screen to haul yourself out, fast.${picks ? ' Your ice picks bite into the edge.' : ' Without ice picks you can hardly get a grip.'}${lost ? ' ' + lost : ''}`, 7000, true);
}
function swimTick(gm, dt) {
  const I = gm.ice, s = I.swim, p = gm.player, d = gm.dom;
  if (!s) return;
  p.hold(s.x, ISL.SEA, s.z);
  s.T -= dt; s.pulledT -= dt;
  p.heat = Math.max(0, p.heat - dt * 2.2); p.wet = 1;
  const picks = gm.inv.count(t => t === 'picks') > 0, pulled = s.pulledT > 0;
  for (const a of MOVE) {
    if (!gm.inp.is(a) || I.prevK.has(a)) continue;
    if (a === s.key) { s.prog += (picks ? 8 : 3.6) * (pulled ? 1.8 : 1); s.key = MOVE.filter(k => k !== a)[Math.random() * 3 | 0]; SFX.splash(); }
    else { s.prog -= 6; SFX.nope(); }
  }
  I.prevK = new Set(MOVE.filter(a => gm.inp.is(a)));
  s.prog = clamp(s.prog - dt * (picks ? 5 : 9) * (pulled ? 0.4 : 1), 0, 100);
  s.gaspT -= dt;
  if (s.gaspT <= 0) { s.gaspT = 1.6 + Math.random() * 1.4; SFX.gasp(0.6 + (1 - s.T / s.max) * 0.6); }
  d.ice.classList.remove('hidden');
  d.iceKey.textContent = keyName(BINDS[s.key]);
  d.iceProg.style.width = s.prog.toFixed(1) + '%'; d.iceT.style.width = (clamp(s.T / s.max, 0, 1) * 100).toFixed(1) + '%';
  const txt = pulled ? 'Someone has your hand! Keep climbing.' : picks ? 'Stab the picks in, pull, again…' : 'Your fingers slip on the wet ice…';
  if (gm.txt.iceP !== txt) { gm.txt.iceP = txt; d.iceP.textContent = txt; }
  d.ice.classList.toggle('pulled', pulled);
  if (s.prog >= 100) climbOut(gm, false);
  else if (s.T <= 0) climbOut(gm, true);
}
// out of the water: onto the ice (towards whoever pulled you, else towards the shore), or under it
function climbOut(gm, failed) {
  const I = gm.ice, s = I.swim, p = gm.player, L = gm.life;
  I.swim = null; gm.dom.ice.classList.add('hidden');
  const helper = I.puller && gm.avatars.get(I.puller);
  let dx = -s.x, dz = -s.z;
  if (helper && Math.hypot(helper.pos.x - s.x, helper.pos.z - s.z) < 5) { dx = helper.pos.x - s.x; dz = helper.pos.z - s.z; }
  const l = Math.hypot(dx, dz) || 1, x = s.x + dx / l * 1.5, z = s.z + dz / l * 1.5;
  if (failed && G.lobby.opts.diff === 'easy') {           // Mild: you come up at the edge, more dead than alive
    L.st = 'up'; p.setMode(null); p.teleport(x, ISL.SEA + 0.05, z);
    p.heat = 0; p.hp = 0; I.stress = 0; I.puller = null;
    H.goDown(gm);
    return;
  }
  if (failed) { H.die(gm, 'ice'); I.puller = null; return; }
  L.st = 'up'; p.setMode(null);
  p.teleport(x, ISL.SEA + 0.05, z); p.yaw = Math.atan2(-dx, -dz) + Math.PI;
  p.wet = 1; I.stress = 0; I.puller = null;
  SFX.splash(); SFX.gasp(1);
  H.tell('out');
  H.hint(gm, 'out' + Date.now(), `You haul yourself out onto the ice, soaked to the skin. The cold goes straight through you: get to a fire, now. And crawl (${kn('crouch')}): the ice is thin here.`, 8000, true);
}
// a friend at the edge (life.js on their side): 2 = holding on, 1 = a good pull, 0 = a bad one
on('g-pull', (m, from) => {
  const gm = GI, s = gm?.ice?.swim;
  if (!gm || !gm.ready || !s) return;
  s.pulledT = 1.2; gm.ice.puller = from;
  if (m.g === 1) { s.prog = Math.min(100, s.prog + 16); SFX.splash(); }
  else if (m.g === 0) s.prog = Math.max(0, s.prog - 8);
});

// ---------- the broken holes: dark water where someone is (or just was) in it; they freeze over again ----------
let holeGeo = null, holeMat = null, shardMat = null;
function holes(gm) {
  const I = gm.ice, now = performance.now();
  const at = (key, x, z) => {
    let h = I.holes.get(key);
    if (!h || Math.hypot(h.x - x, h.z - z) > 1) {
      if (h) drop(gm, key);
      h = { x, z, seen: now, mesh: holeMesh() };
      if (h.mesh) { h.mesh.position.set(x, ISL.SEA, z); gm.scene.add(h.mesh); }
      I.holes.set(key, h);
    }
    h.seen = now;
  };
  if (I.swim) at('me', I.swim.x, I.swim.z);
  for (const [pid, a] of gm.avatars) if ((a.to?.ls ?? 0) === LS.swim) at(pid, a.pos.x, a.pos.z);
  for (const [k, h] of I.holes) if (now - h.seen > 40000) drop(gm, k);
}
function drop(gm, k) { const h = gm.ice.holes.get(k); if (h?.mesh) gm.scene.remove(h.mesh); gm.ice.holes.delete(k); }
function holeMesh() {
  if (typeof document === 'undefined') return null;
  holeGeo ||= new THREE.CircleGeometry(1.05, 28).rotateX(-Math.PI / 2);
  holeMat ||= new THREE.MeshStandardMaterial({ color: '#0a1620', roughness: 0.05, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  shardMat ||= new THREE.MeshStandardMaterial({ color: '#dbe9f3', roughness: 0.3 });
  const g = new THREE.Group(), w = new THREE.Mesh(holeGeo, holeMat);
  w.position.y = 0.01; g.add(w);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * 6.28 + Math.random() * 0.4, s = new THREE.Mesh(new THREE.BoxGeometry(0.35 + Math.random() * 0.3, 0.05, 0.25 + Math.random() * 0.2), shardMat);
    s.position.set(Math.cos(a) * (1.1 + Math.random() * 0.3), 0.03, Math.sin(a) * (1.1 + Math.random() * 0.3));
    s.rotation.set((Math.random() - 0.5) * 0.5, a, (Math.random() - 0.5) * 0.5);
    g.add(s);
  }
  return g;
}
