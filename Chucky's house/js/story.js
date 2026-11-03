// Story: the playable intro (bank office → rainy drive → the dark shop → Chuck's note), the Day 1 tutorial,
// letters and Chuck's ledger pages, weekly lines from Graves / the IRS, and the win cutscene with the twist.
// Cutscenes render through G.cine = { scene, camera, update(dt) } (main.js draws that instead of the game).
import * as THREE from 'three';
import { G, ACTIONS, playerCount, nameOf } from './state.js';
import { part, canvasTex } from './data.js';
import { makePerson, poseArms, animatePerson } from './people.js';
import { setShopPower, interactive, STATIC } from './world.js';
import { setNeon } from './city.js';
import { morningHooks } from './economy.js';
import { setMood, playEnding, playPad, hasTracks } from './music.js';
import { act, broadcast, on, tell, isGuest } from './net.js';
import { JOBS } from './jobs.js';
import { keyName } from './keys.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const wait = ms => new Promise(r => setTimeout(r, ms));
const COLORS = [0xd04a2a, 0x2a7ad0, 0x2ab04a, 0xd0a020];

// ---------- overlay helpers ----------
const $ = UI.$;
function overlay(on) { $('story').classList.toggle('hidden', !on); }
async function say(text, who = '', ms = 3600) {
  const el = $('story-sub');
  el.innerHTML = (who ? `<b>${who}:</b> ` : '') + text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  await wait(ms);
}
const clearSub = () => { $('story-sub').classList.remove('show'); };
async function fade(black, ms = 900) {
  const f = $('story-fade');
  f.style.transition = `opacity ${ms}ms`;
  f.style.opacity = black ? 1 : 0;
  await wait(ms);
}
function big(html, cls = '') { const b = $('story-big'); b.className = cls; b.innerHTML = html; b.classList.toggle('hidden', !html); }
function cineCam() { return new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 300); }
const lerpV = (a, b, t) => a.clone().lerp(b, t);
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
// Camera move: list of [pos, lookAt] keys, over ms.
function move(cam, keys, ms) {
  return new Promise(res => {
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms), seg = (keys.length - 1) * ease(k), i = Math.min(keys.length - 2, Math.floor(seg)), f = seg - i;
      cam.position.copy(lerpV(keys[i][0], keys[i + 1][0], f));
      cam.lookAt(lerpV(keys[i][1], keys[i + 1][1], f));
      if (k < 1) requestAnimationFrame(step); else res();
    };
    step();
  });
}
function sitPose(m) {
  m.userData.body.position.y = -0.48;
  for (const l of m.userData.legs) { l.hip.rotation.x = -1.45; l.knee.rotation.x = 1.45; }
}

// ======================================================================
// INTRO
// ======================================================================
function bankScene() {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x0a0c12);
  sc.add(new THREE.HemisphereLight(0x8090b0, 0x201810, 0.35));
  const lamp = new THREE.PointLight(0xffc880, 9, 7); lamp.position.set(0.7, 1.6, -0.9); sc.add(lamp);
  const wallTex = canvasTex(64, 64, (g, w) => { g.fillStyle = '#1e3328'; g.fillRect(0, 0, w, w); for (let x = 0; x < w; x += 8) { g.fillStyle = '#243a2e'; g.fillRect(x, 0, 4, w); } }, [6, 2]);
  const wm = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const room = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 6), [wm, wm, new THREE.MeshStandardMaterial({ color: 0x1a1612 }), new THREE.MeshStandardMaterial({ color: 0x3a2a1c }), wm, wm]);
  room.material.forEach(m => { m.side = THREE.BackSide; }); room.position.y = 1.6; sc.add(room);
  // window with the night city
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshBasicMaterial({ map: canvasTex(220, 130, g => {
    g.fillStyle = '#060a14'; g.fillRect(0, 0, 220, 130);
    for (let i = 0; i < 18; i++) { const h = 30 + Math.random() * 90, x = i * 13; g.fillStyle = '#0c1220'; g.fillRect(x, 130 - h, 12, h); for (let k = 0; k < h / 9; k++) if (Math.random() < 0.3) { g.fillStyle = '#ffcf7a'; g.fillRect(x + 3, 130 - h + 4 + k * 9, 3, 4); } }
  }) }));
  win.position.set(-1.6, 1.8, -2.98); sc.add(win);
  part(sc, new THREE.BoxGeometry(2.3, 0.08, 0.1), 0x2a1a10, -1.6, 1.15, -2.95);
  // desk, lamp, papers
  part(sc, new THREE.BoxGeometry(2.2, 0.08, 1.1), 0x4a2a14, 0, 0.8, -0.7);
  part(sc, new THREE.BoxGeometry(2.1, 0.76, 0.06), 0x3a2010, 0, 0.4, -0.2);
  part(sc, new THREE.CylinderGeometry(0.08, 0.1, 0.04, 10), 0x1a3a1a, 0.7, 0.86, -0.9);
  part(sc, new THREE.CylinderGeometry(0.01, 0.01, 0.36, 6), 0xc9a227, 0.7, 1.04, -0.9, { metalness: 0.8 });
  part(sc, new THREE.ConeGeometry(0.16, 0.14, 12, 1, true), 0x1a5a2a, 0.7, 1.25, -0.9, { side: THREE.DoubleSide, emissive: 0x0a2a10 });
  for (let k = 0; k < 4; k++) part(sc, new THREE.BoxGeometry(0.22, 0.02, 0.3), 0xe8e2d0, -0.7 + k * 0.03, 0.85 + k * 0.02, -0.9).rotation.y = k * 0.2;
  // the contract (its texture is redrawn while you sign)
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 340;
  const cg = cv.getContext('2d');
  const drawContract = () => {
    cg.fillStyle = '#f4efe0'; cg.fillRect(0, 0, 256, 340);
    cg.fillStyle = '#222'; cg.font = 'bold 18px Georgia'; cg.textAlign = 'center'; cg.fillText('LOAN AGREEMENT', 128, 34);
    cg.font = '11px Georgia'; cg.textAlign = 'left';
    ['Borrower takes over the property known as', '"CHUCKY\'S HOUSE", pawnbroker, with all', 'debts of the previous owner, C. Abernathy.', '', 'Principal: $8,000.00', 'Interest: 0.8 % per day', 'Installment: $600.00 every Sunday', '', 'Three missed installments: the Internal', 'Revenue Service may seize all assets', 'and the person of the borrower.']
      .forEach((l, i) => cg.fillText(l, 22, 64 + i * 16));
    cg.fillText('Signed:', 22, 290); cg.fillRect(70, 292, 160, 1);
  };
  drawContract();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.45), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  paper.rotation.x = -Math.PI / 2; paper.position.set(0, 0.846, -0.45); sc.add(paper);
  part(sc, new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), 0x111111, 0.24, 0.85, -0.45).rotation.set(Math.PI / 2, 0, 0.6);
  // Mr. Graves
  const graves = makePerson({ seed: 4242, player: 0x23262c, scale: 1.02 });
  graves.position.set(0, 0, -1.55); sitPose(graves); poseArms(graves, -1.1, -0.7);
  sc.add(graves);
  part(sc, new THREE.BoxGeometry(0.6, 0.06, 0.5), 0x2a1a10, 0, 0.42, -1.6); // chair
  part(sc, new THREE.BoxGeometry(0.6, 0.8, 0.06), 0x2a1a10, 0, 0.82, -1.86);
  const sign = (k) => { // k 0..1: draw the signature
    cg.strokeStyle = '#1a2a6a'; cg.lineWidth = 2.5; cg.beginPath();
    for (let i = 0; i <= 60 * k; i++) { const t = i / 60, x = 76 + t * 150, y = 282 - Math.sin(t * 19) * 10 * (1 - t * 0.5) - Math.cos(t * 7) * 4; i ? cg.lineTo(x, y) : cg.moveTo(x, y); }
    cg.stroke(); tex.needsUpdate = true;
  };
  return { sc, graves, sign };
}

function driveScene() {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x05070c);
  sc.fog = new THREE.Fog(0x05070c, 4, 60);
  sc.add(new THREE.HemisphereLight(0x405070, 0x100c08, 0.4));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 400), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, map: canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#1a1c20'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c060'; for (let y = 0; y < h; y += 32) g.fillRect(30, y, 4, 16);
  }, [1, 40]) }));
  road.rotation.x = -Math.PI / 2; road.position.z = -150; sc.add(road);
  const movers = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, h = 6 + Math.random() * 14;
    const b = part(sc, new THREE.BoxGeometry(5, h, 6), [0x1a1e26, 0x221a1a, 0x1e2222][i % 3], side * 9, h / 2, -i * 9);
    for (let k = 0; k < 4; k++) if (Math.random() < 0.6) part(b, new THREE.BoxGeometry(0.6, 0.7, 0.05), 0xffcf7a, -side * 2.51, -h / 2 + 2 + k * 2.4, (Math.random() - 0.5) * 4, { emissive: 0xffaa40 }).rotation.y = Math.PI / 2;
    movers.push(b);
  }
  const lamps = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group(); g.position.set(i % 2 ? 4.6 : -4.6, 0, -i * 24);
    part(g, new THREE.CylinderGeometry(0.06, 0.08, 5, 6), 0x222222, 0, 2.5, 0);
    part(g, new THREE.BoxGeometry(0.5, 0.15, 0.3), 0xfff0c0, (i % 2 ? -0.5 : 0.5), 5, 0, { emissive: 0xffc070 });
    sc.add(g); lamps.push(g);
  }
  const passing = new THREE.PointLight(0xffc070, 30, 14); sc.add(passing);
  // the cab
  const cab = new THREE.Group(); sc.add(cab);
  part(cab, new THREE.BoxGeometry(2, 0.5, 0.6), 0x1a1a1a, 0, 0.95, -0.9);
  const wheel = part(cab, new THREE.TorusGeometry(0.19, 0.025, 6, 20), 0x111111, -0.4, 1.15, -0.55); wheel.rotation.x = -1.1;
  part(cab, new THREE.BoxGeometry(0.22, 0.06, 0.02), 0x40ff70, 0.25, 1.2, -0.6, { emissive: 0x20a040 }); // radio display
  for (const x of [-1, 1]) part(cab, new THREE.BoxGeometry(0.08, 1.2, 0.08), 0x111111, x, 1.7, -1.1).rotation.x = -0.3;
  part(cab, new THREE.BoxGeometry(2.1, 0.1, 0.1), 0x111111, 0, 2.25, -1.3);
  const wipers = [-0.5, 0.4].map(x => { const w = part(cab, new THREE.BoxGeometry(0.75, 0.02, 0.02), 0x0a0a0a, x, 1.25, -1.0); w.geometry.translate(0.37, 0, 0); return w; });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshStandardMaterial({ color: 0x8aa0b0, transparent: true, opacity: 0.08, roughness: 0 }));
  glass.position.set(0, 1.7, -1.15); glass.rotation.x = -0.3; cab.add(glass);
  // rain
  const n = 1500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = -Math.random() * 40; }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x8aa0c0, size: 0.06, transparent: true, opacity: 0.6 }));
  sc.add(rain);
  let t = 0;
  const update = dt => {
    t += dt;
    const sp = 14 * dt;
    for (const b of movers) { b.position.z += sp; if (b.position.z > 8) b.position.z -= 26 * 9; }
    for (const l of lamps) { l.position.z += sp; if (l.position.z > 8) l.position.z -= 8 * 24; }
    const near = lamps.reduce((a, l) => Math.abs(l.position.z - 0) < Math.abs(a.position.z) ? l : a, lamps[0]);
    passing.position.set(near.position.x * 0.8, 4.5, near.position.z);
    road.material.map.offset.y += dt * 1.2;
    const p = rg.attributes.position;
    for (let i = 0; i < n; i++) { p.array[i * 3 + 1] -= dt * 14; p.array[i * 3 + 2] += sp; if (p.array[i * 3 + 1] < 0 || p.array[i * 3 + 2] > 2) { p.array[i * 3 + 1] = 8 + Math.random() * 4; p.array[i * 3 + 2] = -Math.random() * 40; } }
    p.needsUpdate = true;
    const a = Math.sin(t * 2.4) * 0.9 + 0.9;
    wipers[0].rotation.z = a; wipers[1].rotation.z = a;
    wheel.rotation.z = Math.sin(t * 0.7) * 0.1;
  };
  return { sc, update };
}

let signResolve = null;
const signed = new Set();
ACTIONS.sign = pid => {
  signed.add(pid);
  const all = Object.keys(G.players).every(p => signed.has(p));
  broadcast({ t: 'signWait', left: Object.keys(G.players).filter(p => !signed.has(p)).map(nameOf), all });
  if (all) { signed.clear(); signResolve?.(); }
  else NETwait(Object.keys(G.players).filter(p => !signed.has(p)).map(nameOf));
  return all;
};
const NETwait = left => { if ($('story-btn')) $('story-wait').textContent = left.length ? 'Waiting for ' + left.join(', ') + ' to sign…' : ''; };
on('signWait', m => { NETwait(m.left); if (m.all) signResolve?.(); });

// Everyone connected plays it. The host starts it with startIntro(); guests get 'storyIntro'.
export function startIntro(done) {
  G.intro = 'bank';
  broadcast({ t: 'storyIntro' });
  playIntro(done);
}
on('storyIntro', () => G.onStoryIntro?.());

export async function playIntro(done) {
  G.uiOpen = true;
  G.cine = G.cine || { scene: new THREE.Scene(), camera: cineCam(), update() {} }; // mark "in a cutscene" right away
  setMood(null); // the bank office is quiet: no menu music in the intro
  if (document.pointerLockElement) document.exitPointerLock();
  overlay(true); big('');
  $('story-fade').style.opacity = 1;
  const cam = cineCam();
  // 1. the bank
  const bank = bankScene();
  cam.position.set(0, 1.28, 0.9); cam.lookAt(0, 1.0, -1.0);
  G.cine = { scene: bank.sc, camera: cam, update: dt => { cam.position.z = Math.max(0.55, cam.position.z - dt * 0.012); } };
  await fade(false, 1400);
  big('<small>Three weeks after Uncle Chuck disappeared…</small>', 'story-small'); await wait(2600); big('');
  await say('You must be Chuck\'s family. Sit, sit.', 'Mr. Graves');
  await say('Your uncle vanished three weeks ago. No note, no forwarding address. Just debts.', 'Mr. Graves', 4200);
  await say('The pawn shop is yours now. So is his loan: eight thousand dollars.', 'Mr. Graves', 4000);
  await say('Six hundred every Sunday. Miss three payments and the IRS takes everything. Including you.', 'Mr. Graves', 4600);
  await say('Sign here, and the keys are yours.', 'Mr. Graves', 1500);
  // signing (everybody in co-op)
  await new Promise(res => {
    signResolve = res;
    $('story-act').innerHTML = `<button id="story-btn">✍ Sign the contract</button><div id="story-wait" class="dim"></div>`;
    $('story-btn').onclick = async () => {
      $('story-btn').disabled = true; sfx.sign();
      for (let k = 0; k <= 1; k += 0.05) { bank.sign(k); await wait(40); }
      const all = await act('sign');
      if (all) res();
    };
  });
  signResolve = null;
  $('story-act').innerHTML = '';
  await say('Pleasure doing business. Drive safe. That part of town isn\'t kind at night.', 'Mr. Graves', 3800);
  clearSub();
  await fade(true, 1200);
  // 2. the drive
  const drive = driveScene();
  cam.position.set(0.45, 1.55, 0); cam.lookAt(0.3, 1.35, -10);
  G.cine = { scene: drive.sc, camera: cam, update: dt => { drive.update(dt); cam.position.y = 1.55 + Math.sin(performance.now() * 0.011) * 0.006; } };
  const pad = hasTracks('intro') ? (setMood('intro'), null) : playPad();
  await fade(false, 1200);
  await say('Uncle Chuck\'s pawn shop. Last time I was there, I was twelve.', 'You', 3800);
  await say('He taught me to spot a fake watch before I could ride a bike.', 'You', 3800);
  await say('Then one night he locked up… and nobody ever saw him again.', 'You', 4000);
  await say('Now it\'s mine. The shop, the debt. All of it.', 'You', 3600);
  clearSub();
  await fade(true, 1400);
  pad?.stop(); setMood(null);
  G.cine = null;
  if (!isGuest()) G.intro = 'dark';
  G.uiOpen = false;
  applyIntroWorld();
  setTimeout(() => fade(false, 1400).then(() => overlay(false)), 200);
  UI.toast('It\'s dark. Find the breaker box at the back of the shop.');
  done?.();
}

// ---------- the dark shop, the breaker, Chuck's note ----------
let sheets = [], breaker, note, mailbox, arrow;
export function buildStory(scene) {
  breaker = new THREE.Group(); breaker.position.set(-4.4, 1.5, -4.86);
  part(breaker, new THREE.BoxGeometry(0.45, 0.6, 0.12), 0x6a6e74, 0, 0, 0, { metalness: 0.5 });
  part(breaker, new THREE.BoxGeometry(0.06, 0.16, 0.06), 0xc02020, 0, -0.05, 0.08);
  part(breaker, new THREE.BoxGeometry(0.3, 0.06, 0.01), 0xf0c020, 0, 0.2, 0.065);
  const glow = new THREE.PointLight(0xff6040, 0, 2); glow.position.set(0, 0, 0.4); breaker.add(glow); breaker.userData.glow = glow;
  interactive(breaker, 'breaker'); scene.add(breaker);
  note = new THREE.Group(); note.position.set(-3.45, 1.015, 2.15);
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), new THREE.MeshStandardMaterial({ map: canvasTex(64, 80, g => {
    g.fillStyle = '#f2ead0'; g.fillRect(0, 0, 64, 80); g.strokeStyle = '#2a2a6a'; g.lineWidth = 1.5;
    for (let y = 12; y < 74; y += 7) { g.beginPath(); g.moveTo(6, y); for (let x = 6; x < 58; x += 4) g.lineTo(x, y + Math.sin(x * 0.9 + y) * 1.2); g.stroke(); }
  }) }));
  nm.rotation.x = -Math.PI / 2; nm.rotation.z = 0.3; note.add(nm);
  const hb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.35), new THREE.MeshBasicMaterial({ visible: false })); note.add(hb);
  interactive(note, 'note'); scene.add(note);
  mailbox = new THREE.Group(); mailbox.position.set(-2.75, 1.3, 4.86);
  part(mailbox, new THREE.BoxGeometry(0.4, 0.3, 0.14), 0x2a3a5a, 0, 0, 0, { metalness: 0.4 });
  part(mailbox, new THREE.BoxGeometry(0.3, 0.03, 0.02), 0x111111, 0, 0.06, -0.075);
  const flag = part(mailbox, new THREE.BoxGeometry(0.03, 0.18, 0.03), 0xd02020, 0.22, 0.05, 0); mailbox.userData.flag = flag;
  interactive(mailbox, 'mail'); scene.add(mailbox);
  STATIC.push(new THREE.Box3(V(-4.7, 1.1, -5), V(-4.1, 1.9, -4.7)));
  // tutorial arrow
  arrow = new THREE.Group();
  part(arrow, new THREE.ConeGeometry(0.16, 0.36, 10), 0xffd040, 0, 0, 0, { emissive: 0xa07010 }).rotation.x = Math.PI;
  part(arrow, new THREE.TorusGeometry(0.2, 0.025, 6, 20), 0xffd040, 0, -0.35, 0, { emissive: 0xa07010 }).rotation.x = Math.PI / 2;
  arrow.traverse(o => { o.raycast = () => {}; o.castShadow = false; });
  arrow.visible = false; scene.add(arrow);
}

// Dark shop with sheets over the shelves (intro), or normal. Also used by co-op guests.
export function applyIntroWorld() {
  const dark = G.intro === 'dark' || G.intro === 'bank';
  setShopPower(dark ? 0 : G.shopEvent === 'powercut' ? 0.45 : 1);
  setNeon(!dark);
  breaker.userData.glow.intensity = dark ? 1.5 : 0;
  note.visible = G.intro === 'note' || G.intro === 'done';
  if (dark && !sheets.length) {
    for (const s of G.shelves) {
      const b = s.userData.box, sz = b.getSize(V(0, 0, 0)), c = b.getCenter(V(0, 0, 0));
      const m = part(G.scene, new THREE.BoxGeometry(sz.x + 0.15, sz.y + 0.1, sz.z + 0.15), 0xe8e4da, c.x, c.y + 0.03, c.z, { roughness: 1 });
      m.raycast = () => {}; sheets.push(m);
    }
  }
  if (!dark && sheets.length) { for (const m of sheets) G.scene.remove(m); sheets = []; }
}

ACTIONS.breaker = pid => {
  if (G.intro !== 'dark') return false;
  G.intro = 'note';
  broadcast({ t: 'lightsOn' });
  lightsOn();
  tell(pid, 'There\'s a note on the counter…');
  return true;
};
on('lightsOn', () => lightsOn());
async function lightsOn() {
  sfx.breaker();
  for (const s of sheets) G.scene.remove(s);
  sheets = [];
  breaker.userData.glow.intensity = 0;
  for (let k = 1; k <= 4; k++) { await wait(380); setShopPower(k / 4, k); sfx.hum(); }
  setShopPower(1);
  await wait(400);
  setNeon(true);
  note.visible = true;
}

export const CHUCK_NOTE = `<p>Kid,</p>
  <p>If you're reading this, I'm gone, and Graves made you sign. I'm sorry. It was the only way to keep the shop out of <i>their</i> hands.</p>
  <p>Pay Graves every Sunday. Don't miss three. Don't trust the man from the IRS, and don't ever let anyone have the ledger.</p>
  <p>The shop still works. Buy low, sell high. Keep it clean, people pay more in a clean shop. At night the city throws away more than you'd think.</p>
  <p>Rusty at the junkyard owes me. Don't remind him.</p>
  <p>— Chuck</p><p class="dim"><small>P.S. The safe in the back room: I'll tell you when it's time.</small></p>`;
ACTIONS.readNote = () => { if (G.intro === 'note') { G.intro = 'done'; G.tut = 0; G.tutFlags = {}; } return true; };
export function readNote() {
  sfx.page();
  UI.openPanel(`<div class="letter"><h2>📝 A note on the counter</h2>${CHUCK_NOTE}</div><div class="row"><button id="nt-ok">Fold it up</button></div>`);
  UI.$('nt-ok').onclick = () => { UI.closePanel(); act('readNote'); };
}

// ---------- Day 1 tutorial ----------
const TUT = [
  { text: 'Use the computer and buy an item from the Supplier.', at: () => V(-5.6, 1.75, 2.0), done: () => G.backstock.length > 0 || anyShelved() },
  { text: 'Take the item out of the stock crates ({E} on the crates).', at: () => V(6.1, 1.5, -4.1), done: () => Object.values(G.players).some(p => p.holding?.kind === 'item') || anyShelved() },
  { text: 'Put it on a shelf: {E} on an empty slot.', at: () => shelfTop(), done: () => anyShelved() },
  { text: 'Set its price: {E} on the item. The tag shows today\'s market price too.', at: () => shelfTop(), done: () => G.tutFlags.price },
  { text: 'Open the store: {E} on the OPEN sign in the window.', at: () => V(2.85, 2.7, 4.85), done: () => G.phase !== 'prep' },
  { text: 'Serve a customer at the register ({E} on them when they\'re first in line).', at: () => V(-4.5, 1.9, 1.6), done: () => G.stats.sold > 0 || G.stats.spent > 0 && G.phase !== 'prep' },
  { text: 'Customers drop trash. Pick it up and throw it in the bin.', at: () => V(-1.6, 1.3, 4.5), done: () => G.tutFlags.bin },
  { text: 'That\'s the basics! Stock is short in the first days: at night, head out for loot.', at: () => null, done: () => (G.tutFlags.endT = (G.tutFlags.endT || 0) + 1) > 30 },
];
const anyShelved = () => G.shelves.some(s => s.userData.slots.some(x => x.item));
const shelfTop = () => { const s = G.shelves[0]; return s ? V(s.position.x, 2.4, s.position.z) : null; };
let tutT = 0;
export function updateTutorial(dt, host) {
  const step = TUT[G.tut];
  G.tutText = (step && G.intro === 'done' ? `Tutorial ${G.tut + 1}/${TUT.length}: ${step.text}` : G.intro === 'dark' ? 'Find the breaker box at the back of the shop ({E}).' : G.intro === 'note' ? 'Read the note on the counter ({E}).' : '').replaceAll('{E}', keyName('interact'));
  const at = G.intro === 'dark' ? V(-4.4, 2.2, -4.6) : G.intro === 'note' ? V(-3.45, 1.5, 2.15) : step?.at();
  arrow.visible = !!at && G.world === 'shop';
  if (at) { arrow.position.copy(at); arrow.position.y += Math.sin(performance.now() * 0.004) * 0.08; arrow.rotation.y += dt * 2; }
  if (!host || !step || G.intro !== 'done') return;
  if ((tutT -= dt) > 0) return;
  tutT = 0.5;
  if (step.done()) { G.tut++; sfx.ping(); if (G.tut >= TUT.length) G.tut = 99; }
}
export const skipTutorial = () => { G.tut = 99; };

// ---------- mail & ledger pages ----------
export const LETTERS = [
  { id: 'l1', day: 2, from: 'First National Bank · Mr. Graves', title: 'Your first installment', body: 'A friendly reminder: $600 is due by the end of Sunday. The bank appreciates punctuality. It does not appreciate excuses.' },
  { id: 'l2', day: 3, from: 'Unknown', title: '(no title)', body: 'We know Chuck kept a ledger. It belongs to us. Find it before we have to look for it ourselves.' },
  { id: 'l9', day: 4, from: 'A note taped to the mop bucket', title: 'It gets messier from here', body: 'Word is out that the shop is open again. From today people spill coffee and, when it rains, drag mud in. Mop is in the cleaning corner by the back. Rinse it at the sink, and put the yellow sign up or somebody WILL slip. — C.' },
  { id: 'l3', day: 5, from: 'Dumont Auction House', title: 'Invitation', body: 'Every Saturday our auction is open to licensed dealers. Rare pieces, fair competition. Log in from your shop computer.' },
  { id: 'l4', day: 8, from: 'A postcard (no stamp)', title: 'Greetings from nowhere', body: 'Weather\'s fine. Don\'t look for me. Keep the lights on. — C.' },
  { id: 'l5', day: 10, from: 'City Police Department', title: 'Notice to pawnbrokers', body: 'Stolen goods are being fenced in your district. Dealers caught with them will be fined. Detectives may visit without notice.' },
  { id: 'l6', day: 13, from: 'Rusty\'s Salvage', title: 'STAY OFF MY LOT', body: 'I know your truck. I know whose nephew you are. Chuck owed me and now you owe me. Come at night again and Daisy and the dogs say hello.' },
  { id: 'l7', day: 17, from: 'Internal Revenue Service · Agent Pratt', title: 'Routine audit', body: 'Our records show irregularities in the late Mr. Abernathy\'s accounts. I will be watching your payments closely. Very closely.' },
];
export const PAGES = [
  'LEDGER, p. 1 — "Graves, loan #4471. Interest 0.8. Robbery with paperwork."',
  'LEDGER, p. 2 — "Rusty: 2 engines, 1 bike, paid in full. He says I didn\'t. He\'s lying and he knows it."',
  'LEDGER, p. 3 — "P. came again. Wants the book. Offered me a deal. No."',
  'LEDGER, p. 4 — "The safe: day you were born, kid. You\'ll know."',
  'LEDGER, p. 5 — "Graves and P. had lunch together. Since when do banks and the IRS eat together?"',
  'LEDGER, p. 6 — "If they come for the shop, this book is the only proof. Pay the loan. Then they can\'t touch it. Then they\'ll come anyway."',
];
morningHooks.push(() => {
  for (const l of LETTERS) if (l.day <= G.day && !G.story.letters.includes(l.id)) G.story.letters.push(l.id);
});
export const unread = () => G.story.letters.filter(id => !G.story.read.includes(id)).length;
ACTIONS.readLetter = (pid, id) => { if (!G.story.read.includes(id)) G.story.read.push(id); return true; };
export function mailPanel() {
  const list = G.story.letters.map(id => LETTERS.find(l => l.id === id)).filter(Boolean).reverse();
  sfx.page();
  UI.openPanel(`<h2>📬 Mail</h2>${list.length ? `<div class="list">${list.map(l => `<button class="pc-row mail ${G.story.read.includes(l.id) ? '' : 'new'}" data-l="${l.id}"><span class="big">✉️</span><span class="grow"><b>${l.title}</b><br><small class="dim">${l.from} · Day ${l.day}</small></span></button>`).join('')}</div>`
    : '<p class="dim">No mail yet.</p>'}<div id="mail-body"></div><div class="row"><button id="ml-x">Close</button></div>`, { cls: 'wide' });
  document.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
    const l = LETTERS.find(x => x.id === b.dataset.l);
    UI.$('mail-body').innerHTML = `<div class="letter"><h3>${l.title}</h3><p class="dim">From: ${l.from}</p><p>${l.body}</p></div>`;
    b.classList.remove('new'); act('readLetter', l.id);
  });
  UI.$('ml-x').onclick = () => UI.closePanel();
}
export function updateMailbox() { if (mailbox) mailbox.userData.flag.rotation.z = unread() ? 0 : -1.5; }
// A ledger page came home from the night.
export function addPage() {
  const n = G.story.pages.length;
  if (n >= PAGES.length) return null;
  G.story.pages.push(n);
  return PAGES[n];
}

// ---------- weekly lines ----------
export function weekLine(s) {
  if (!s.weekCheck) return '';
  if (!s.missed) return `<div class="npc-line"><span>🧑‍💼</span><div><b>Mr. Graves</b><p>"Payment received. See you next Sunday. Same time, same amount."</p></div></div>`;
  return `<div class="npc-line bad"><span>🕴️</span><div><b>Agent Pratt, IRS</b><p>"${s.strike >= 2 ? 'One more, and I take you with the furniture.' : 'Missed a payment? Tsk. I\'ll be taking a few things.'}"</p></div></div>`;
}

// ======================================================================
// WIN: inspirational, then the twist, then CHAPTER 2 — COMING SOON
// ======================================================================
function blackCar() {
  const g = new THREE.Group(); g.position.set(14, 0, 14.9); g.rotation.y = Math.PI;
  const black = { metalness: 0.6, roughness: 0.25 };
  part(g, new THREE.BoxGeometry(4.4, 0.65, 1.85), 0x0a0a0c, 0, 0.6, 0, black);
  part(g, new THREE.BoxGeometry(2.3, 0.6, 1.75), 0x0a0a0c, -0.2, 1.22, 0, black);
  part(g, new THREE.BoxGeometry(2.25, 0.5, 1.77), 0x05080c, -0.2, 1.24, 0, { roughness: 0.05, transparent: true, opacity: 0.55 });
  for (const x of [-1.4, 1.4]) for (const z of [-0.88, 0.88]) part(g, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12), 0x080808, x, 0.36, z).rotation.x = Math.PI / 2;
  part(g, new THREE.BoxGeometry(0.5, 0.25, 1.6), 0x141414, 0.75, 0.98, 0); // dashboard
  // the photo with circled faces
  const names = Object.values(G.players).map(p => p.name);
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.18), new THREE.MeshBasicMaterial({ map: canvasTex(160, 110, c => {
    c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, 160, 110); c.fillStyle = '#4a4038'; c.fillRect(8, 8, 144, 80);
    names.forEach((n, i) => {
      const x = names.length === 1 ? 80 : 30 + i * (100 / (names.length - 1));
      c.fillStyle = '#2a2420'; c.beginPath(); c.arc(x, 40, 10, 0, 7); c.fill(); c.fillRect(x - 9, 50, 18, 30);
      c.strokeStyle = '#d01010'; c.lineWidth = 3; c.beginPath(); c.arc(x, 42, 15, 0, 7); c.stroke();
      c.fillStyle = '#d01010'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.fillText(n.slice(0, 10), x, 102);
    });
  }) }));
  photo.position.set(0.72, 1.12, -0.35); photo.rotation.set(-0.4, -Math.PI / 2, 0, 'YXZ'); g.add(photo);
  // the ledger
  part(g, new THREE.BoxGeometry(0.24, 0.05, 0.32), 0x4a1a10, 0.75, 1.13, 0.25).rotation.y = 0.3;
  part(g, new THREE.BoxGeometry(0.22, 0.01, 0.3), 0xe8dcb0, 0.75, 1.16, 0.25).rotation.y = 0.3;
  // the phone (lights up later)
  const phoneTex = canvasTex(80, 150, c => { c.fillStyle = '#000'; c.fillRect(0, 0, 80, 150); });
  const phone = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.15), new THREE.MeshBasicMaterial({ map: phoneTex }));
  phone.rotation.set(-Math.PI / 2, 0, -0.5); phone.position.set(0.6, 1.115, 0.02); g.add(phone);
  // someone with binoculars
  const watcher = makePerson({ seed: 999, player: 0x101012 });
  watcher.position.set(-0.2, 0.15, -0.4); watcher.rotation.y = -Math.PI / 2; sitPose(watcher); poseArms(watcher, -2.2, -2.0);
  part(watcher.userData.head, new THREE.BoxGeometry(0.16, 0.06, 0.12), 0x111111, 0, 0.02, 0.16);
  g.add(watcher);
  return { g, phone, phoneTex };
}

export async function playWin(done) {
  G.uiOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  UI.closePanel(false);
  overlay(true); big('');
  const cam = cineCam(), sc = G.scene;
  G.cineDay = 0.35;
  G.cine = { scene: sc, camera: cam, update: () => {} };
  // 1. the payment
  cam.position.set(-5.6, 1.45, 2.6); cam.lookAt(-5.6, 1.33, 2.0);
  $('story-fade').style.opacity = 1;
  const music = playEnding(), t0 = performance.now();
  const at = s => wait(Math.max(0, s * 1000 - (performance.now() - t0)));
  await fade(false, 1200);
  big('<div class="win-screen">LOAN BALANCE<br><b>$0.00</b><small>PAID IN FULL</small></div>');
  await at(5); big('');
  // 2. Graves tears up the contract
  const graves = makePerson({ seed: 4242, player: 0x23262c }); graves.position.set(-3.4, 0, 0.3); graves.rotation.y = -0.6; sc.add(graves);
  poseArms(graves, -1.2, -0.5);
  const halves = [-1, 1].map(s => part(sc, new THREE.PlaneGeometry(0.17, 0.45), 0xf4efe0, -3.4 + s * 0.09, 1.25, 0.6, { side: THREE.DoubleSide }));
  move(cam, [[V(-1.2, 1.6, 2.6), V(-3.4, 1.4, 0.3)], [V(-1.8, 1.55, 2.0), V(-3.4, 1.4, 0.3)]], 7000);
  await say('It\'s done. Every cent. I\'ll admit it — I didn\'t think you\'d make it.', 'Mr. Graves', 4000);
  sfx.page();
  const t1 = performance.now();
  await new Promise(res => { const step = () => { const k = (performance.now() - t1) / 1600; halves.forEach((h, i) => { h.position.x += (i ? 1 : -1) * 0.012; h.position.y -= 0.006; h.rotation.z += (i ? 1 : -1) * 0.04; }); if (k < 1) requestAnimationFrame(step); else res(); }; step(); });
  await say('Chuck would be proud.', 'Mr. Graves', 2600);
  halves.forEach(h => sc.remove(h)); sc.remove(graves);
  // 3. before → now
  await fade(true, 600);
  setShopPower(0.12); const tmpSheets = G.shelves.map(s => { const b = s.userData.box, sz = b.getSize(V(0, 0, 0)), c = b.getCenter(V(0, 0, 0)); return part(sc, new THREE.BoxGeometry(sz.x + 0.15, sz.y + 0.1, sz.z + 0.15), 0xe8e4da, c.x, c.y, c.z, { roughness: 1 }); });
  cam.position.set(5.5, 2.3, 3.8); cam.lookAt(-1, 1, -2);
  big('<small>DAY 1</small>', 'story-small');
  await fade(false, 700); await at(17.5);
  await fade(true, 700);
  tmpSheets.forEach(m => sc.remove(m)); setShopPower(1);
  const crowd = Array.from({ length: 5 }, (_, i) => { const p = makePerson({ seed: 300 + i }); p.position.set(-2 + i * 1.3, 0, -1 - (i % 2) * 1.4); p.rotation.y = i; sc.add(p); return p; });
  big(`<small>DAY ${G.day}</small>`, 'story-small');
  move(cam, [[V(5.5, 2.3, 3.8), V(-1, 1, -2)], [V(4.5, 2.0, 2.4), V(-1.5, 1, -2)]], 6000);
  await fade(false, 700); await at(23.5);
  big('');
  // 4. outside under the neon sign: it lights up on the drop
  await fade(true, 700);
  crowd.forEach(p => sc.remove(p));
  setNeon(false);
  const team = Object.values(G.players).map((p, i, a) => {
    const m = makePerson({ seed: [...p.id + p.name].reduce((s, c) => s * 31 + c.charCodeAt(0) | 0, 7), player: COLORS[+p.id.slice(1)] });
    m.position.set((i - (a.length - 1) / 2) * 1.1, 0, 6.3); sc.add(m); return m;
  });
  cam.position.set(0, 1.5, 12); cam.lookAt(0, 3.2, 5);
  await fade(false, 900);
  move(cam, [[V(0, 1.5, 12), V(0, 3.2, 5)], [V(0, 1.7, 10), V(0, 3.4, 5)]], (music.explodeAt - (performance.now() - t0) / 1000) * 1000 + 3000);
  await at(music.explodeAt - 2.2);
  for (let k = 0; k < 6; k++) { setNeon(k % 2 === 0); await wait(120 + Math.random() * 160); }
  await at(music.explodeAt);
  setNeon(true); G.cineDay = 0.05;
  team.forEach(m => poseArms(m, -3.0, -0.2));
  big('<div class="win-title">CHUCKY\'S HOUSE</div>', 'story-big-title');
  let bob = 0;
  G.cine.update = dt => { bob += dt; team.forEach((m, i) => { m.position.y = Math.abs(Math.sin(bob * 4 + i)) * 0.25; }); };
  await at(music.explodeAt + 4); big('');
  // credits
  const L = G.life, top = job => Object.entries(G.jobs).sort((a, b) => (b[1][job] || 0) - (a[1][job] || 0))[0]?.[0] || '—';
  const lines = [`${L.days} days in business`, `${L.sold} items sold · ${UI.money(L.sales)} made`, `${L.nights} nights out`, `${L.eggs} eggs sold`, `${L.cleaned} messes cleaned`,
    `Trust +${Math.round(G.trust * 100)} %`, `${JOBS.cashier.icon} Best seller: ${top('cashier')}`, `${JOBS.cleaner.icon} Cleanest hands: ${top('cleaner')}`, `${JOBS.scav.icon} Best scavenger: ${top('scav')}`,
    playerCount() > 1 ? 'A team effort.' : 'You did it alone.'];
  $('story-credits').innerHTML = lines.map(l => `<p>${l}</p>`).join('');
  $('story-credits').classList.remove('hidden'); $('story-credits').classList.add('roll');
  await at(music.explodeAt + 17);
  $('story-credits').classList.add('hidden'); $('story-credits').classList.remove('roll');
  big('<div class="win-title small">It\'s finally yours.</div>', 'story-big-title');
  await at(music.explodeAt + 22);
  big('');
  // 5. the twist: silence, the camera drifts away to a black car
  music.stop(true);
  G.cine.update = () => {};
  const car = blackCar(); sc.add(car.g);
  const inCar = (x, y, z) => car.g.localToWorld(V(x, y, z));
  await move(cam, [
    [V(0, 1.7, 10), V(0, 3.4, 5)],
    [V(0, 8, 10.5), V(0, 2, 5)],
    [V(9, 5, 17), inCar(0, 1, 0)],
    [inCar(-1.1, 1.5, 0.45), inCar(0.7, 1.1, -0.1)],
  ], 11000);
  await wait(1500);
  // the phone lights up
  const c = car.phoneTex.image.getContext('2d');
  c.fillStyle = '#111a24'; c.fillRect(0, 0, 80, 150); c.fillStyle = '#3a8aff'; c.fillRect(6, 40, 68, 54);
  c.fillStyle = '#fff'; c.font = '9px sans-serif'; ['They paid it', 'all off.', 'Start phase', 'two.'].forEach((l, i) => c.fillText(l, 10, 56 + i * 11));
  car.phoneTex.needsUpdate = true; car.phone.material.color.set(0xffffff);
  sfx.ping();
  await move(cam, [[inCar(-1.1, 1.5, 0.45), inCar(0.6, 1.11, 0.02)], [inCar(0.15, 1.45, 0.05), inCar(0.6, 1.11, 0.02)]], 2500);
  await say('They paid it all off. Start phase two.', '📱 Unknown number', 3800);
  clearSub();
  // 6. hard cut
  $('story-fade').style.transition = 'none'; $('story-fade').style.opacity = 1;
  sfx.thud();
  await wait(1200);
  big('<div class="ch2">CHAPTER 2<small>COMING SOON</small></div>', 'story-big-title');
  await wait(5000);
  sc.remove(car.g); team.forEach(m => sc.remove(m));
  G.cine = null; G.cineDay = null;
  G.story.ch1 = true;
  done?.();
}
void animatePerson;
