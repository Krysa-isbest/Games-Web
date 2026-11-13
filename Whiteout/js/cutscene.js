// Whiteout: the opening cutscene (90 s). Flight 2207 over the northern sea: a calm private jet, the captain's
// broken-off announcement, the power cut, turbulence and oxygen masks, the crash, ringing ears in the dark,
// waking up in the burning cabin with the tail torn off, the radio coming alive, the host taking it, nobody
// answering, and "Get out of the plane". Then the screen goes black and the game starts on the island (game.js).
// The picture follows the Web Audio clock, so it stays locked to the score (intro-audio.js).
// Co-op: the host's Start begins it for everyone, everyone has their own seat and sees the others, and the
// host takes the radio (push to talk). The host can skip once they have seen it; in solo, you can.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G, S, clamp, lerp, rand, esc } from './state.js';
import { BINDS, keyName } from './keys.js';
import { on, broadcast } from './net.js';
import { menuAudio } from './audio.js';
import { SCN, canvasTex, glowTex } from './scene.js';
import * as IA from './intro-audio.js';
import { TL } from './intro-audio.js';
import { radioTalk, radioFrom } from './voice.js';

const SEEN = 'whiteout.introSeen';
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pulse = (t, at, len) => (t > at && t < at + len ? Math.sin((t - at) / len * Math.PI) : 0);
const bounce = x => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; };
const seen = () => { try { return !!localStorage.getItem(SEEN); } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private mode */ } };

// the cabin: x across, y up (floor = 0), z along the plane (the cockpit is at -z, the tail at +z)
const SEATS = [[-0.62, -0.95, 1], [-0.62, 0.95, -1], [0.62, -0.95, 1], [0.62, 0.95, -1]];   // the club four: player seats
const REAR = [[-0.62, 2.9, -1], [0.62, 2.9, -1]];                                          // two more passengers
const SPARK = new THREE.Vector3(0.35, 2.12, 1.25), RADIO = new THREE.Vector3(0, 0.78, -4.22);
const BULK = -3.7, PILOTS = -3.98, AT_RADIO = -3.3;                                        // the cockpit wall, the pilots' seats, where the host stands
const LIGHTNING = [18.5, 31.2, 33.6, 35.0, 36.8, 37.5, 39.0];
const NPC = [
  { coat: '#e9dfcf', hair: '#d8b878', skin: '#f0c8a8', long: true },     // a fur coat
  { coat: '#22262d', hair: '#9a9a9a', skin: '#e3b48f' },                  // a grey-haired man in a suit
  { coat: '#5a1e2a', hair: '#1c1410', skin: '#c98f6a', long: true },     // burgundy
  { coat: '#33465a', hair: '#5a3d26', skin: '#e8be9a' },
];
const SKINS = ['#f1c7a5', '#e0ac85', '#c68c63', '#8d5a3b', '#f5d2b8'];

let C = null;      // the running cutscene

export async function playCutscene(args) {
  if (C) return;
  const ps = (args.players?.length ? args.players : [{ id: 'p0', name: S.name, coat: S.coat }]).slice(0, 4);
  const me = Math.max(0, ps.findIndex(p => p.id === args.meId));
  C = { args, ps, me, host: me === 0, coop: !!args.coop, t: 0, ev: 0, spoke: 0, remoteSpoke: 0, ptt: false, remote: false,
    skip: 0, space: false, mx: 0, my: 0, yaw: 0, pitch: 0, ended: false, raf: 0, nextDrip: 52, filter: '', sub: null };
  C.canSkip = seen() && (!C.coop || C.host);
  const host = esc(ps[0].name);
  C.subs = [
    [24.05, 28.05, 'Captain · intercom', 'Ladies and gentlemen, this is your captain speaking. We seem to have issues with contacting th—'],
    [66.6, 70.3, 'Radio', '…Flight 2207… Flight 2207, do you copy? Over.'],
    [83.0, 85.4, 'Radio', '…2207… say again… we can\'t… your posi—'],
  ];
  if (!C.host) C.subs.push([TL.stand + 0.3, TL.ptt - 0.2, '', `${host} gets up and goes to the radio in the cockpit.`]);
  C.EV = [
    [52, () => burst(SPARK, 30)], [61, () => burst(SPARK, 24)], [64.2, () => burst(SPARK, 18)], [70.5, () => burst(SPARK, 30)],
    [TL.ptt, () => radioPanel(true)], [TL.auto, autoLine], [TL.reply - 0.2, () => radioPanel(false)],
    [TL.dead, () => burst(RADIO, 45)], [TL.getOut - 0.5, markSeen], [TL.end, () => showEnd(false)],
  ].sort((a, b) => a[0] - b[0]);
  buildDom();
  buildWorld();
  SCN.paused = true; menuAudio(false);
  await IA.prepare();
  if (!C) return;
  C.t0 = IA.start({ friends: ps.length - 1 });
  C.p0 = performance.now();
  listen();
  resize();
  C.raf = requestAnimationFrame(loop);
}

function now() { const a = IA.clock(); return a != null ? a : (performance.now() - C.p0) / 1000; }

function loop() {
  if (!C) return;
  C.raf = requestAnimationFrame(loop);
  const t = Math.max(0, now()), dt = clamp(t - C.t, 0, 0.05);
  C.t = t;
  while (C && !C.ended && C.ev < C.EV.length && t >= C.EV[C.ev][0]) C.EV[C.ev++][1]();
  if (!C || C.ended) return;
  if (C.ptt) C.spoke += dt;
  if (C.remote) C.remoteSpoke += dt;
  update(t, dt);
  hud(t, dt);
  if (!C || C.ended) return;
  if (C.w.composer) C.w.composer.render(); else C.w.renderer.render(C.w.scene, C.w.camera);
}

// ---------- the overlay: canvas, subtitles, radio, skip, the end card ----------
function buildDom() {
  const d = document.createElement('div');
  d.className = 'cutscene';
  d.innerHTML = `<canvas class="cs-canvas"></canvas><div class="cs-smoke"></div><div class="cs-vig"></div><div class="cs-black"></div>
    <div class="cs-kicker">Flight 2207 · Over the northern sea · 02:51</div>
    <div class="cs-obj"><small>Objective</small>Get out of the plane.</div>
    <div class="cs-sub"></div>
    <div class="cs-radio off"></div>
    <div class="cs-skip off"><span>Hold <b>Space</b> to skip</span><i></i></div>
    <div class="cs-end"></div>`;
  document.body.append(d);
  const q = s => d.querySelector(s);
  C.dom = { root: d, canvas: q('.cs-canvas'), smoke: q('.cs-smoke'), black: q('.cs-black'), kicker: q('.cs-kicker'), obj: q('.cs-obj'), sub: q('.cs-sub'), radio: q('.cs-radio'), skip: q('.cs-skip'), ring: q('.cs-skip i'), end: q('.cs-end') };
}

function hud(t, dt) {
  const d = C.dom;
  let b = 0;
  if (t < 3) b = 1 - smooth(0, 3, t);
  else if (t >= TL.crash && t < 49.5) b = 1;
  else if (t >= 49.5) b = Math.max(1 - smooth(49.5, 53, t), pulse(t, 54.2, 0.35), pulse(t, 56.1, 0.3) * 0.9);
  if (t > 88.4) b = Math.max(b, smooth(88.4, 89.9, t));
  d.black.style.opacity = b.toFixed(3);
  // waking up: the picture is blurred and dim at first
  const blur = t >= 49.5 && t < 58 ? 14 * (1 - smooth(49.5, 58, t)) : 0;
  const f = blur > 0.05 ? `blur(${blur.toFixed(1)}px) brightness(${(0.65 + 0.35 * smooth(49.5, 58, t)).toFixed(2)})` : 'none';
  if (f !== C.filter) { d.canvas.style.filter = f; C.filter = f; }
  d.smoke.style.opacity = (0.12 * smooth(52, 62, t) + 0.6 * smooth(85, 89.5, t)).toFixed(3);
  d.kicker.classList.toggle('show', t > 0.8 && t < 6.5);
  d.obj.classList.toggle('show', t >= TL.getOut && t < 89.6);
  const s = C.subs.find(x => t >= x[0] && t < x[1]);
  if (s !== C.sub) {
    C.sub = s;
    if (s) { d.sub.innerHTML = (s[2] ? `<b>${s[2]}</b>` : '') + s[3]; d.sub.classList.toggle('narr', !s[2]); }
    d.sub.classList.toggle('show', !!s);
  }
  // skip: hold Space (only once you have seen it; in co-op only the host)
  const can = C.canSkip && t > 1 && t < TL.getOut;
  d.skip.classList.toggle('off', !can);
  if (can && C.space) { C.skip += dt; if (C.skip >= 1) { doSkip(false); return; } } else C.skip = Math.max(0, C.skip - dt * 2);
  d.ring.style.setProperty('--k', Math.min(1, C.skip).toFixed(3));
}

function radioPanel(open) {
  const d = C.dom.radio;
  if (open) {
    const host = esc(C.ps[0].name);
    d.innerHTML = C.host
      ? `<b>The radio</b><p>Hold <kbd>${esc(keyName(BINDS.ptt))}</kbd> and say something into the radio.</p><small>${C.coop ? 'Your crew hears your real voice over the radio. ' : ''}Say nothing, and a line plays on its own.</small><div class="tx">● Transmitting</div>`
      : `<b>The radio</b><p>${host} is on the radio…</p><div class="tx">● Transmitting</div>`;
    d.classList.remove('off');
  } else {
    if (C.ptt) ptt(false);
    if (C.remote) { C.remote = false; IA.pttOff(); radioFrom('p0', false); }
    d.classList.add('off'); d.classList.remove('tx');
  }
}
function ptt(down) {
  if (!C || !C.host || C.ended) return;
  if (down && !(C.t >= TL.ptt && C.t < TL.reply - 0.2)) return;
  if (down === C.ptt) return;
  C.ptt = down;
  if (down) IA.pttOn(); else IA.pttOff();
  radioTalk(down);                                   // voice chat: the host's microphone is open while they hold the radio
  C.dom.radio.classList.toggle('tx', down);
  if (C.coop) broadcast({ t: 'cs-ptt', on: down });
}
// nobody spoke into the radio: the automatic line
function autoLine() {
  if (C.ptt || C.remote || (C.host ? C.spoke : C.remoteSpoke) >= 1.2) return;
  C.subs.push([TL.auto + 0.1, TL.reply - 0.15, `${esc(C.ps[0].name)} · radio`, 'Mayday, mayday! This is Flight 2207. We crash landed on an island… can anyone hear us?']);
  IA.autoLine(3.2);
  const r = C.dom.radio; r.classList.add('tx'); setTimeout(() => r.classList.remove('tx'), 3300);
}

function doSkip(remote) {
  if (!C || C.ended) return;
  if (C.coop && C.host && !remote) broadcast({ t: 'cs-skip' });
  showEnd(true);
}
function showEnd(skipped) {
  if (!C || C.ended) return;
  C.ended = true;
  cancelAnimationFrame(C.raf);
  if (C.ptt) { C.ptt = false; IA.pttOff(); }
  radioTalk(false); radioFrom('p0', false);
  markSeen();
  IA.stop(skipped ? 0.8 : 3);
  const d = C.dom, args = C.args;
  d.root.classList.add('done');
  // straight on to the island: the screen goes black, then the game takes over (it fades in by the wreck)
  d.black.style.transition = 'opacity 0.5s'; d.black.style.opacity = '1';
  setTimeout(() => {
    if (args.onDone) { close(true); args.onDone({ skipped }); } else { close(); args.onBack?.(); }
  }, skipped ? 600 : 250);
}
function close(toGame = false) {
  if (!C) return;
  cancelAnimationFrame(C.raf);
  unlisten();
  IA.stop(0.5);
  const w = C.w;
  if (w) {
    w.scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => { m.map?.dispose(); m.dispose(); }); });
    w.composer?.dispose?.();
    w.renderer.dispose(); w.renderer.forceContextLoss?.();
  }
  const root = C.dom.root;
  root.classList.add('out'); setTimeout(() => root.remove(), 450);
  if (!toGame) { SCN.paused = false; menuAudio(true); G.started = false; }      // going on to the game: the menu stays asleep
  C = null;
}

// ---------- input ----------
function listen() {
  const h = C.h = {
    move: e => { C.mx = e.clientX / innerWidth - 0.5; C.my = e.clientY / innerHeight - 0.5; },
    kd: e => { if (e.repeat) return; if (e.code === 'Space') { C.space = true; e.preventDefault(); } if (e.code === BINDS.ptt) ptt(true); },
    ku: e => { if (e.code === 'Space') C.space = false; if (e.code === BINDS.ptt) ptt(false); },
    md: e => { if ('Mouse' + e.button === BINDS.ptt) ptt(true); },
    mu: e => { if ('Mouse' + e.button === BINDS.ptt) ptt(false); },
    blur: () => { C.space = false; ptt(false); },
    rs: () => resize(),
  };
  addEventListener('pointermove', h.move); addEventListener('keydown', h.kd); addEventListener('keyup', h.ku);
  addEventListener('mousedown', h.md); addEventListener('mouseup', h.mu); addEventListener('blur', h.blur); addEventListener('resize', h.rs);
  on('cs-ptt', m => {
    if (!C || C.host || C.ended) return;
    const v = !!m.on && C.t < TL.reply - 0.2;
    if (v === C.remote) return;
    C.remote = v; if (v) IA.pttOn(); else IA.pttOff();
    radioFrom('p0', v);                              // the host's real voice through the radio filter
    C.dom.radio.classList.toggle('tx', v);
  });
  on('cs-skip', () => { if (C && !C.host) doSkip(true); });
}
function unlisten() {
  const h = C.h; if (!h) return;
  removeEventListener('pointermove', h.move); removeEventListener('keydown', h.kd); removeEventListener('keyup', h.ku);
  removeEventListener('mousedown', h.md); removeEventListener('mouseup', h.mu); removeEventListener('blur', h.blur); removeEventListener('resize', h.rs);
}
function resize() {
  const w = C?.w; if (!w) return;
  const pr = Math.min(devicePixelRatio, 2) * (+S.scale || 1);
  w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight);
  if (w.composer) { w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight); }
  w.camera.aspect = innerWidth / innerHeight;
  const hf = THREE.MathUtils.degToRad(clamp(+S.fov || 80, 60, 110));         // the FOV setting is horizontal
  w.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / w.camera.aspect));
  w.camera.updateProjectionMatrix();
}

// ---------- the world ----------
const veneer = () => canvasTex(256, 256, (x, w, h) => {
  const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#5b3a22'); g.addColorStop(0.5, '#6e4629'); g.addColorStop(1, '#583820');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    x.strokeStyle = `rgba(${Math.random() < 0.5 ? '30,16,8' : '140,95,60'},${0.1 + Math.random() * 0.2})`; x.lineWidth = 0.5 + Math.random() * 1.5;
    const y = Math.random() * h; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + rand(-8, 8), w * 0.7, y + rand(-8, 8), w, y + rand(-4, 4)); x.stroke();
  }
});

function buildWorld() {
  const renderer = new THREE.WebGLRenderer({ canvas: C.dom.canvas, antialias: !!S.aa, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#020407');
  scene.fog = new THREE.Fog('#05080c', 14, 90);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.04, 400);
  camera.rotation.order = 'YXZ';
  const cabin = new THREE.Group(); scene.add(cabin);
  const rig = new THREE.Object3D(); cabin.add(rig); rig.add(camera);
  const M = {
    shell: new THREE.MeshStandardMaterial({ color: '#e9e2d6', roughness: 0.7, side: THREE.BackSide }),
    ceil: new THREE.MeshStandardMaterial({ color: '#f1ece3', roughness: 0.6 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#2e2723', roughness: 1 }),
    runner: new THREE.MeshStandardMaterial({ color: '#4a3b2f', roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ map: veneer(), roughness: 0.35, metalness: 0.05 }),
    leather: new THREE.MeshStandardMaterial({ color: '#d8c4a2', roughness: 0.55 }),
    leatherDark: new THREE.MeshStandardMaterial({ color: '#a8916f', roughness: 0.6 }),
    frame: new THREE.MeshStandardMaterial({ color: '#cfc7b9', roughness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: '#c9a35a', roughness: 0.3, metalness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: '#dfeef5', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }),
    champagne: new THREE.MeshStandardMaterial({ color: '#f3d27a', roughness: 0.2, transparent: true, opacity: 0.75, emissive: '#3a2a08' }),
    bottle: new THREE.MeshStandardMaterial({ color: '#1d3a2a', roughness: 0.2, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.6, metalness: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ color: '#8d949c', roughness: 0.45, metalness: 0.7 }),
    charred: new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 }),
    ember: new THREE.MeshBasicMaterial({ color: '#ff6a1a' }),
    mask: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 }),
    strip: new THREE.MeshBasicMaterial({ color: '#ffd9a0' }),
    win: new THREE.MeshBasicMaterial({ color: '#0d1828' }),
    screen: new THREE.MeshBasicMaterial({ color: '#2bd68a' }),
    screen2: new THREE.MeshBasicMaterial({ color: '#e8a33a' }),
    led: new THREE.MeshBasicMaterial({ color: '#ff2a1a' }),
    phone: new THREE.MeshBasicMaterial({ color: '#9fc4ff' }),
    snow: new THREE.MeshStandardMaterial({ color: '#c9d6e3', roughness: 0.95 }),
  };
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, par = cabin) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); par.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // the fuselage, floor, ceiling and the wooden side ledges
  add(new THREE.CylinderGeometry(1.5, 1.5, 9.9, 40, 1, true).rotateX(Math.PI / 2), M.shell, 0, 0.9, 0.3);
  add(box(2.42, 0.06, 9.9), M.carpet, 0, -0.03, 0.3);
  add(box(0.55, 0.012, 9.0), M.runner, 0, 0.006, 0.3);
  add(box(1.9, 0.05, 9.7), M.ceil, 0, 2.18, 0.3);
  for (const s of [-1, 1]) {
    add(box(0.04, 0.02, 9.2), M.strip, s * 0.62, 2.15, 0.3);
    add(box(0.3, 0.06, 8.4), M.wood, s * 1.32, 0.62, 0.3);
    add(box(0.04, 0.6, 8.4), M.leatherDark, s * 1.17, 0.31, 0.3);
  }
  // oval windows, seven a side
  const winGeo = new THREE.CircleGeometry(0.16, 28).scale(1, 1.35, 1), ringGeo = new THREE.RingGeometry(0.16, 0.21, 28).scale(1, 1.35, 1);
  for (const s of [-1, 1]) for (const z of [-3.1, -2.0, -0.9, 0.2, 1.3, 2.4, 3.5]) {
    const p = new THREE.Vector3(s * 1.44, 1.22, z), look = p.clone().add(new THREE.Vector3(-s * 0.977, -0.213, 0));
    const wm = add(winGeo, M.win, p.x, p.y, p.z); wm.lookAt(look);
    const fr = add(ringGeo, M.frame, p.x - s * 0.005, p.y, p.z); fr.lookAt(look.clone().add(new THREE.Vector3(-s * 0.005, 0, 0)));
  }
  // overhead bins; one of them falls open after the crash
  for (const s of [-1, 1]) for (const z of [-2.4, -1.3, -0.2, 0.9, 2.0, 3.1]) add(box(0.42, 0.34, 1.0), M.ceil, s * 1.05, 1.85, z);
  const binDoor = new THREE.Group(); binDoor.position.set(0.84, 2.02, 0.9); cabin.add(binDoor);
  add(box(0.03, 0.34, 0.98), M.frame, 0, -0.17, 0, 0, 0, 0, binDoor);
  add(box(0.25, 0.02, 0.9), M.charred, 1.05, 1.69, 0.9);       // the dark inside of that bin

  // the bulkhead and the cockpit
  for (const s of [-1, 1]) add(box(1.0, 2.3, 0.08), M.wood, s * 0.85, 1.1, BULK);
  add(box(0.7, 0.35, 0.08), M.wood, 0, 2.05, BULK);
  add(new THREE.CircleGeometry(1.5, 40), new THREE.MeshBasicMaterial({ color: '#06090e' }), 0, 0.9, -4.64);
  add(box(1.6, 0.5, 0.35), M.dark, 0, 0.85, -4.5, -0.3);
  const scr = [add(new THREE.PlaneGeometry(0.3, 0.18), M.screen, -0.35, 0.98, -4.32, -0.3), add(new THREE.PlaneGeometry(0.3, 0.18), M.screen2, 0.0, 0.98, -4.32, -0.3), add(new THREE.PlaneGeometry(0.3, 0.18), M.screen, 0.35, 0.98, -4.32, -0.3)];
  add(box(0.22, 0.12, 0.14), M.dark, RADIO.x, RADIO.y - 0.03, RADIO.z);
  add(new THREE.SphereGeometry(0.012, 8, 6), M.led, RADIO.x + 0.07, RADIO.y + 0.01, RADIO.z + 0.075);
  add(box(0.05, 0.1, 0.04), M.dark, RADIO.x - 0.14, RADIO.y + 0.02, RADIO.z + 0.06);   // the handset
  add(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ color: '#0a1220' }), 0, 1.45, -4.62, -0.35);

  // the back of the cabin: a wall and the galley in flight, torn away in the crash
  const rearWall = new THREE.Group(); cabin.add(rearWall);
  add(box(2.6, 2.6, 0.08), M.wood, 0, 1.1, 5.0, 0, 0, 0, rearWall);
  add(box(0.6, 1.0, 0.5), M.wood, 0.8, 0.5, 4.6, 0, 0, 0, rearWall);
  add(box(0.6, 0.04, 0.5), M.gold, 0.8, 1.02, 4.6, 0, 0, 0, rearWall);
  const torn = new THREE.Group(); torn.visible = false; cabin.add(torn);
  for (let i = 0; i < 22; i++) {
    const a = rand(-0.5, Math.PI + 0.5), r = rand(1.32, 1.5), y = 0.9 + Math.sin(a) * r;
    if (y < -0.05) continue;
    add(box(rand(0.15, 0.4), rand(0.3, 0.7), 0.04), Math.random() < 0.6 ? M.charred : M.metal, Math.cos(a) * r, y, 5.15 + rand(-0.1, 0.2), rand(-0.4, 0.4), 0, a + Math.PI / 2 + rand(-0.4, 0.4), torn);
  }
  for (let i = 0; i < 6; i++) add(box(rand(0.05, 0.12), rand(0.05, 0.1), rand(0.2, 0.5)), M.ember, rand(-1.1, 1.1), rand(0.02, 0.1), rand(4.7, 5.2), 0, rand(0, 3), 0, torn);

  // seats, tables, glasses, a bottle, phones
  const seat = (x, z, face) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face > 0 ? 0 : Math.PI; cabin.add(g);
    add(box(0.62, 0.4, 0.6), M.leatherDark, 0, 0.2, 0, 0, 0, 0, g);
    add(box(0.58, 0.1, 0.56), M.leather, 0, 0.45, 0.02, 0, 0, 0, g);
    add(box(0.6, 0.8, 0.15), M.leather, 0, 0.86, -0.3, -0.12, 0, 0, g);
    add(box(0.42, 0.16, 0.12), M.leather, 0, 1.32, -0.36, -0.12, 0, 0, g);
    for (const s of [-1, 1]) add(box(0.09, 0.12, 0.56), M.leatherDark, s * 0.31, 0.62, 0, 0, 0, 0, g);
  };
  for (const [x, z, f] of SEATS.concat(REAR)) seat(x, z, f);
  for (const s of [-1, 1]) { add(box(0.62, 0.04, 0.74), M.wood, s * 0.62, 0.72, 0); add(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 10), M.gold, s * 0.62, 0.35, 0); }
  const glass = () => {
    const g = new THREE.Group();
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 14), M.glass, 0, 0.003, 0, 0, 0, 0, g);
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 6), M.glass, 0, 0.05, 0, 0, 0, 0, g);
    add(new THREE.CylinderGeometry(0.033, 0.02, 0.1, 14), M.glass, 0, 0.15, 0, 0, 0, 0, g);
    add(new THREE.CylinderGeometry(0.028, 0.018, 0.06, 14), M.champagne, 0, 0.135, 0, 0, 0, 0, g);
    cabin.add(g); return g;
  };
  const glass1 = glass(); glass1.position.set(0.5, 0.74, -0.15);       // slides off in the turbulence
  const glass2 = glass(); glass2.position.set(-0.5, 0.74, 0.18);       // rolls on the floor after the crash
  glass().position.set(-0.75, 0.74, -0.15); glass().position.set(0.78, 0.74, 0.15);
  const bottle = new THREE.Group(); cabin.add(bottle); bottle.position.set(-0.42, 0.74, -0.22);
  add(new THREE.CylinderGeometry(0.04, 0.045, 0.24, 14), M.bottle, 0, 0.12, 0, 0, 0, 0, bottle);
  add(new THREE.CylinderGeometry(0.015, 0.03, 0.1, 12), M.bottle, 0, 0.29, 0, 0, 0, 0, bottle);
  add(new THREE.CylinderGeometry(0.017, 0.017, 0.05, 12), M.gold, 0, 0.33, 0, 0, 0, 0, bottle);
  const phone = (x, z) => { const g = new THREE.Group(); g.position.set(x, 0.742, z); cabin.add(g); add(box(0.075, 0.008, 0.15), M.dark, 0, 0, 0, 0, 0, 0, g); add(new THREE.PlaneGeometry(0.065, 0.13), M.phone, 0, 0.0045, 0, -Math.PI / 2, 0, 0, g); return g; };
  const phone1 = phone(-0.7, 0.2); phone(0.62, -0.22);

  // oxygen masks above every seat
  const masks = [];
  for (const [x, z, f] of SEATS.concat(REAR)) {
    const g = new THREE.Group(); g.position.set(x, 2.15, z + f * 0.25); g.visible = false; cabin.add(g);
    const tube = add(new THREE.CylinderGeometry(0.005, 0.005, 1, 5), M.frame, 0, -0.5, 0, 0, 0, 0, g);
    const cup = add(new THREE.CylinderGeometry(0.05, 0.065, 0.07, 12), M.mask, 0, -0.5, 0, 0, 0, 0, g);
    masks.push({ g, tube, cup, ph: rand(0, 6) });
  }

  // the people: the crew in the club seats, other passengers in the empty ones, two pilots
  const people = [];
  const others = C.ps.map((_, i) => i).filter(i => i !== C.me), wakes = [53.5, 56, 58.5];
  SEATS.forEach(([x, z, f], i) => {
    const p = C.ps[i];
    const look = p ? { coat: p.coat || '#b4462e', hair: ['#3b2a1e', '#1c1410', '#6b4a2a', '#2a2a2a'][i], skin: SKINS[hashOf(p.id + p.name) % SKINS.length], long: i % 2 === 1 } : NPC[i];
    const P = person(look); place(P, x, z, f); cabin.add(P.g);
    const o = { P, kind: p ? 'player' : 'npc', idx: i, isMe: p && i === C.me, wakeAt: p ? wakes[others.indexOf(i)] ?? 54 : 0, ph: rand(0, 6) };
    if (o.isMe) { P.hd.visible = false; P.hr.visible = false; if (P.lh) P.lh.visible = false; }
    people.push(o);
  });
  REAR.forEach(([x, z, f], i) => { const P = person(NPC[(i + 2) % 4]); P.tilt = i ? -0.35 : 0.35; place(P, x, z, f); cabin.add(P.g); people.push({ P, kind: 'npc', ph: rand(0, 6) }); });
  for (const s of [-1, 1]) {
    seat(s * 0.42, PILOTS, -1);
    const P = person({ coat: '#e5e9ee', hair: s < 0 ? '#2a2420' : '#6b5a4a', skin: '#e3b48f', pants: '#1d2430' });
    P.tilt = s * 0.25; place(P, s * 0.42, PILOTS, -1); cabin.add(P.g); people.push({ P, kind: 'pilot', ph: rand(0, 6) });
  }

  // lights
  const hemi = new THREE.HemisphereLight('#ffe6c8', '#3a2c22', 0.5); scene.add(hemi);
  const warm = [-2.6, 0, 2.6].map(z => { const l = new THREE.PointLight('#ffd8a8', 2.4, 7, 1.6); l.position.set(0, 2.0, z); cabin.add(l); return l; });
  const red = [[0, 1.95, -1.2], [0, 0.3, 3.4]].map(([x, y, z]) => { const l = new THREE.PointLight('#ff2a14', 0, 6, 1.6); l.position.set(x, y, z); cabin.add(l); return l; });
  const flash = new THREE.PointLight('#cfe0ff', 0, 8, 1.5); flash.position.set(1.2, 1.3, 0); cabin.add(flash);
  const fireLight = new THREE.PointLight('#ff7a2a', 0, 10, 1.4); fireLight.position.set(0, 0.9, 4.5); cabin.add(fireLight);
  const moon = new THREE.DirectionalLight('#9cb6e0', 0); moon.position.set(3, 8, 16); scene.add(moon, moon.target);

  // fire at the torn-off tail, spreading forward at the end
  const fmat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,160,1)', 'rgba(255,110,30,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const fire = [];
  for (let i = 0; i < 44; i++) {
    const s = new THREE.Sprite(fmat.clone()), spread = i >= 30, ceil = !spread && Math.random() < 0.3;
    s.userData = { t: Math.random(), spread, bx: spread ? rand(-1, 1) : ceil ? rand(0.4, 1.0) : rand(-1.15, 1.15), by: spread ? rand(0.05, 0.3) : ceil ? rand(1.6, 2.1) : rand(0.05, 0.6), bz: spread ? rand(3.6, 4.6) : rand(4.7, 5.2) };
    s.visible = false; cabin.add(s); fire.push(s);
  }
  // smoke creeping along the ceiling
  const smat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,0.6)', 'rgba(255,255,255,0.2)'), color: '#1c1a18', transparent: true, depthWrite: false, opacity: 0 });
  const smoke = [];
  for (let i = 0; i < 28; i++) { const s = new THREE.Sprite(smat.clone()); s.userData = { t: i / 28, bx: rand(-0.9, 0.9), ph: rand(0, 6) }; s.visible = false; cabin.add(s); smoke.push(s); }
  // sparks
  const NS = 160, sPos = new Float32Array(NS * 3).fill(-50), sparks = { geo: new THREE.BufferGeometry(), v: new Float32Array(NS * 3), life: new Float32Array(NS), i: 0 };
  sparks.geo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const sp = new THREE.Points(sparks.geo, new THREE.PointsMaterial({ color: '#ffcf70', size: 0.035, map: glowTex('rgba(255,255,255,1)', 'rgba(255,220,150,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.frustumCulled = false; cabin.add(sp);
  // snow blowing in through the hole
  const NN = 420, nPos = new Float32Array(NN * 3), snowSp = new Float32Array(NN);
  for (let i = 0; i < NN; i++) { nPos.set([rand(-1.4, 1.4), rand(0.1, 2.4), rand(0.8, 12)], i * 3); snowSp[i] = rand(0.6, 1.4); }
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: '#dfe9f3', size: 0.03, map: glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)'), transparent: true, depthWrite: false, opacity: 0.85 }));
  snow.frustumCulled = false; snow.visible = false; cabin.add(snow);

  // outside (only seen after the crash): the night, the snow, burning wreckage
  const out = new THREE.Group(); out.visible = false; scene.add(out);
  add(new THREE.SphereGeometry(300, 24, 12), new THREE.MeshBasicMaterial({ color: '#0a1220', side: THREE.BackSide, fog: false }), 0, 0, 0, 0, 0, 0, out);
  const stars = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) { const a = rand(0, 6.28), e = rand(0.05, 1.4); stars.set([Math.cos(a) * Math.cos(e) * 280, Math.sin(e) * 280, Math.sin(a) * Math.cos(e) * 280], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  out.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfd8e6', size: 1.4, sizeAttenuation: false, fog: false })));
  add(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), M.snow, 0, -0.6, 0, 0, 0, 0, out);
  for (let i = 0; i < 14; i++) add(box(rand(0.3, 1.6), rand(0.1, 0.5), rand(0.3, 2)), Math.random() < 0.5 ? M.metal : M.charred, rand(-6, 6), -0.52, rand(7, 22), rand(-0.3, 0.3), rand(0, 3), rand(-0.3, 0.3), out);
  for (let i = 0; i < 8; i++) { const d = add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.snow, rand(-9, 9), -0.65, rand(6, 30)); d.scale.set(rand(1.5, 4), rand(0.4, 1), rand(1.5, 4)); out.attach(d); }
  const outFire = [];
  for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(fmat.clone()); s.userData = { t: Math.random(), bx: 2.2 + rand(-0.6, 0.6), bz: 11 + rand(-0.6, 0.6) }; out.add(s); outFire.push(s); }
  const outLight = new THREE.PointLight('#ff7a2a', 0, 18, 1.4); outLight.position.set(2.2, 0.6, 11); out.add(outLight);

  // post: bloom when it's on in the settings
  let composer = null;
  if (S.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.78));
    composer.addPass(new OutputPass());
  }
  C.w = { renderer, scene, camera, cabin, rig, composer, M, rearWall, torn, binDoor, scr, glass1, glass2, bottle, phone1, masks, people,
    meP: people.find(o => o.isMe)?.P || people[0].P, hemi, warm, red, flash, fireLight, moon, fire, smoke, sparks, snow, snowSp, out, outFire, outLight, wrecked: false };
}
function hashOf(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function place(P, x, z, face) { P.g.position.set(x, 0, z - face * 0.06); P.g.rotation.y = face > 0 ? 0 : Math.PI; P.face = face; }

// a simple low-poly person; the local player's head is hidden (the camera is there)
function person({ coat, skin = '#e0b494', hair = '#3b2a1e', pants = '#24272c', long = false }) {
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const mc = mat(coat), ms = mat(skin), mh = mat(hair), mp = mat(pants), mshoe = mat('#141414');
  const g = new THREE.Group(), body = new THREE.Group(); body.position.y = 0.5; g.add(body);
  const box = (w, h, d, m, x, y, z, par) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); par.add(b); return b; };
  box(0.36, 0.14, 0.26, mp, 0, 0, 0, body);
  box(0.4, 0.5, 0.24, mc, 0, 0.32, 0, body);
  box(0.43, 0.13, 0.27, mc, 0, 0.5, 0, body);
  box(0.08, 0.08, 0.08, ms, 0, 0.6, 0, body);
  const head = new THREE.Group(); head.position.y = 0.62; body.add(head);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), ms); hd.scale.set(0.9, 1.08, 1); hd.position.y = 0.13; head.add(hd);
  const hr = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mh); hr.position.set(0, 0.15, -0.012); hr.rotation.x = -0.25; head.add(hr);
  const lh = long ? box(0.22, 0.26, 0.08, mh, 0, 0.06, -0.085, head) : null;
  const arm = s => {
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.5, 0); body.add(sh); box(0.1, 0.32, 0.11, mc, 0, -0.15, 0, sh);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el); box(0.09, 0.28, 0.1, mc, 0, -0.13, 0, el);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ms); hand.position.y = -0.3; el.add(hand);
    return { sh, el };
  };
  const leg = s => {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.5, 0.02); g.add(hip); box(0.15, 0.44, 0.16, mp, 0, -0.22, 0, hip);
    const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn); box(0.13, 0.42, 0.14, mp, 0, -0.21, 0, kn); box(0.12, 0.07, 0.24, mshoe, 0, -0.43, 0.05, kn);
    return { hip, kn };
  };
  return { g, body, head, hd, hr, lh, aL: arm(-1), aR: arm(1), lL: leg(-1), lR: leg(1), tilt: 0.2 };
}
// sit 1 = seated, 0 = standing; slump 1 = unconscious; walk + phase = a walk cycle; radio = the handset at the mouth
function pose(P, k) {
  const sit = k.sit ?? 1, sl = k.slump || 0, wk = k.walk || 0, ph = k.phase || 0, rd = k.radio || 0;
  const sw = Math.sin(ph) * 0.5 * wk;
  P.lL.hip.rotation.x = -Math.PI / 2 * sit + sw; P.lR.hip.rotation.x = -Math.PI / 2 * sit - sw;
  P.lL.kn.rotation.x = Math.PI / 2 * sit + Math.max(0, -Math.sin(ph)) * 0.6 * wk;
  P.lR.kn.rotation.x = Math.PI / 2 * sit + Math.max(0, Math.sin(ph)) * 0.6 * wk;
  P.g.position.y = 0.405 * (1 - sit) + Math.abs(Math.cos(ph)) * 0.02 * wk;
  P.body.rotation.x = sl * 0.35;
  P.head.rotation.x = sl * 0.75; P.head.rotation.z = sl * P.tilt;
  const lap = sit * (1 - sl);
  P.aL.sh.rotation.set(-0.35 * lap - sw * 0.8, 0, -0.08); P.aR.sh.rotation.set(-0.35 * lap + sw * 0.8 - rd * 1.3, 0, 0.08);
  P.aL.el.rotation.x = -1.1 * lap - 0.2 * wk; P.aR.el.rotation.x = -1.1 * lap - 0.2 * wk - rd * 1.6;
}
// the host's walk from their seat to the radio in the cockpit
function hostState(t) {
  const [sx, sz0] = SEATS[0], sz = sz0 - 0.06, u = t - TL.stand;
  if (u < 1) return { x: sx, z: sz, ry: 0, sit: 1 - smooth(0, 1, u) };
  if (u < 2) { const k = smooth(1, 2, u); return { x: lerp(sx, 0, k), z: lerp(sz, -1.2, k), ry: lerp(0, Math.PI, k), sit: 0, walk: 1, phase: u * 7 }; }
  if (u < 4.5) { const k = (u - 2) / 2.5; return { x: 0, z: lerp(-1.2, AT_RADIO, smooth(0, 1, k)), ry: Math.PI, sit: 0, walk: k < 0.95 ? 1 : 0, phase: u * 7 }; }
  return { x: 0, z: AT_RADIO, ry: Math.PI, sit: 0, radio: smooth(4.6, 5.4, u) };
}

// the crash rearranges the cabin (it happens while the screen is black)
function wreck() {
  const w = C.w; w.wrecked = true;
  w.rearWall.visible = false; w.torn.visible = true; w.out.visible = true; w.snow.visible = true;
  w.cabin.rotation.set(-0.045, 0, 0.13);
  w.glass1.visible = false;
  w.glass2.position.set(0.15, 0.035, 1.6);
  w.bottle.position.set(-0.25, 0.04, 0.55); w.bottle.rotation.set(0, 0.6, Math.PI / 2);
  w.phone1.position.set(0.3, 0.012, -0.5); w.phone1.rotation.y = 0.8;
  w.M.win.color.set('#06090d');
  w.M.screen.color.set('#050607'); w.M.screen2.color.set('#050607');
  for (const s of w.fire) s.visible = true;
  for (const s of w.smoke) s.visible = true;
}

function burst(p, n) {
  const sp = C.w.sparks, pos = sp.geo.attributes.position.array;
  for (let k = 0; k < n; k++) {
    const i = sp.i = (sp.i + 1) % sp.life.length;
    pos.set([p.x + rand(-0.05, 0.05), p.y, p.z + rand(-0.05, 0.05)], i * 3);
    sp.v.set([rand(-0.8, 0.8), rand(-0.5, 1.2), rand(-0.8, 0.8)], i * 3);
    sp.life[i] = rand(0.5, 1.2);
  }
}

function update(t, dt) {
  const w = C.w, crashed = t >= TL.crash;
  if (crashed && !w.wrecked) wreck();

  // ---- lights ----
  let warm = 0;
  if (t < TL.cut) warm = t > 27.6 ? (Math.random() < 0.45 ? 0.12 : 1) : 1;
  for (const l of w.warm) l.intensity = 2.4 * warm;
  w.M.strip.color.setRGB(0.06 + warm, 0.05 + warm * 0.85, 0.04 + warm * 0.62);
  w.hemi.intensity = crashed ? 0.06 : 0.04 + 0.5 * warm;
  let red = 0;
  if (t >= TL.alarm && !crashed) red = 1.6 * (0.85 + 0.15 * Math.sin(t * 23));
  if (t >= TL.wake) red = 1.1 * (Math.random() < 0.07 ? 0.15 : 0.9 + 0.1 * Math.sin(t * 17));
  for (const l of w.red) l.intensity = red;
  let fl = 0;
  for (const lt of LIGHTNING) { const u = t - lt; if (u > 0 && u < 0.5) fl = Math.max(fl, Math.exp(-u * 9) * (u < 0.08 || u > 0.14 ? 1 : 0.3) * (lt < 30 ? 0.3 : 1)); }
  w.flash.intensity = crashed ? 0 : fl * 40;
  if (!crashed) w.M.win.color.setRGB(0.05 + fl * 0.8, 0.09 + fl * 0.82, 0.16 + fl * 0.85);
  if (!crashed && t >= TL.cut && !w.dark) { w.dark = true; w.M.screen.color.set('#050607'); w.M.screen2.color.set('#050607'); }
  // the radio's red light: on in flight, dead after the power cut, alive again while the radio crackles
  w.M.led.color.set(t < TL.cut || (t > 65.5 && t < TL.dead && Math.sin(t * 9) > -0.2) ? '#ff2a1a' : '#200604');
  const fireK = t < TL.wake ? 0 : lerp(0.55, 1, smooth(50, 85, t)) + smooth(85.8, 88, t) * 0.9;
  const flick = 0.75 + 0.25 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1) + Math.random() * 0.15;
  w.fireLight.intensity = fireK * 7 * flick;
  w.moon.intensity = crashed ? 0.6 : 0;
  w.outLight.intensity = crashed ? 6 * flick : 0;

  // ---- the turbulence: shake, masks, the sliding glass ----
  let amp = pulse(t, TL.bump, 0.5) * 0.015;
  if (t > TL.cut && t < TL.cut + 0.4) amp += 0.006;
  if (t > 30.4 && t < TL.crash) amp += 0.003 + smooth(30.4, 39.5, t) * 0.022 + (t > 39.4 ? 0.04 : 0);
  const md = t < TL.masks ? 0 : Math.min(1, (t - TL.masks) / 0.35), ms = t - TL.masks - 0.35;
  const L = md === 0 ? 0 : 0.5 * md * md + (md >= 1 ? Math.sin(ms * 12) * 0.04 * Math.exp(-ms * 3) : 0);
  for (const m of w.masks) {
    m.g.visible = L > 0.01;
    m.tube.scale.y = Math.max(0.01, L); m.tube.position.y = -L / 2; m.cup.position.y = -L - 0.03;
    m.g.rotation.z = Math.sin(t * 2.1 + m.ph) * (crashed ? 0.05 : 0.04 + amp * 6); m.g.rotation.x = Math.sin(t * 1.7 + m.ph) * 0.04;
  }
  if (!crashed) {
    const g1 = w.glass1;
    if (t < TL.slide) g1.position.set(0.5, 0.74, -0.15);
    else if (t < 33.8) g1.position.set(lerp(0.5, 0.3, smooth(TL.slide, 33.8, t)), 0.74, -0.15);
    else if (t < TL.shatter) { const k = (t - 33.8) / 0.2; g1.position.set(0.28 - k * 0.05, lerp(0.74, 0.02, k * k), -0.15); g1.rotation.z = k * 1.6; }
    else g1.visible = false;
  } else {
    // a glass rolling on the tilted floor, an overhead bin falling open
    const rk = t < 57 ? 0 : Math.max(0, 1 - (t - 57) / 5);
    w.glass2.position.z = 1.6 + Math.sin(Math.max(0, t - 57) * 1.4) * 0.3 * rk;
    w.glass2.rotation.set(w.glass2.position.z * 12, 0, Math.PI / 2);
    w.binDoor.rotation.z = -(0.35 + 1.45 * bounce(clamp((t - 55) / 0.8, 0, 1)));
  }

  // ---- the people ----
  for (const o of w.people) {
    let k = { sit: 1, slump: 0 };
    if (crashed) k.slump = o.kind === 'player' ? 1 - smooth(o.wakeAt, o.wakeAt + 1.6, t) : 1;
    if (o.isMe) k.slump = 0;
    o.P.head.rotation.y = crashed ? (k.slump > 0.5 ? 0 : Math.sin(t * 0.5 + o.ph) * 0.4) : Math.sin(t * 0.37 + o.ph) * 0.25 + Math.sin(t * 13 + o.ph) * amp * 8;
    if (o.idx === 0 && t >= TL.stand) {
      const h = hostState(t);
      o.P.g.position.x = h.x; o.P.g.position.z = h.z; o.P.g.rotation.y = h.ry;
      k = { sit: h.sit, walk: h.walk, phase: h.phase, radio: h.radio };
      o.P.head.rotation.y = 0;
    }
    pose(o.P, k);
  }

  // ---- the camera: the local player's eyes, mouse to look around ----
  const me = w.meP, ry = me.g.rotation.y;
  w.rig.position.set(me.g.position.x + Math.sin(ry) * 0.07, me.g.position.y + 1.27, me.g.position.z + Math.cos(ry) * 0.07);
  w.rig.rotation.y = ry + Math.PI;
  const n1 = Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3), n2 = Math.sin(t * 31.3 + 2) + Math.sin(t * 19.1), n3 = Math.sin(t * 7.3) + Math.sin(t * 3.1 + 0.4);
  w.rig.position.x += n1 * amp; w.rig.position.y += n2 * amp + (crashed ? Math.sin(t * 1.4) * 0.004 : 0);
  const atRadio = C.host && t > TL.stand + 4.5 && t < TL.dead + 1;
  const ty = -C.mx * 2.4, tp = -C.my * 1.2 * (S.invertY ? -1 : 1) + (atRadio ? -0.3 : -0.06);
  C.yaw += (ty - C.yaw) * Math.min(1, dt * 5); C.pitch += (tp - C.pitch) * Math.min(1, dt * 5);
  const roll = n3 * amp * 2.5 + (t > 34 && t < TL.crash ? Math.sin(t * 1.3) * 0.1 * smooth(34, 39, t) : 0) + (crashed ? Math.sin(t * 0.6) * 0.01 : 0);
  const nose = t > 36 && t < TL.crash ? -smooth(36, 39.8, t) * 0.12 : 0;
  w.camera.rotation.set(C.pitch + nose, C.yaw, roll);

  // ---- fire, smoke, sparks, snow ----
  if (crashed) {
    const spreadK = smooth(85.8, 88, t);
    for (const s of w.fire) {
      const u = s.userData; u.t += dt * 1.5; if (u.t > 1) u.t -= 1;
      const k = u.spread ? spreadK : 1;
      s.position.set(u.bx + Math.sin(u.t * 5 + u.bz) * 0.05, u.by + u.t * (u.spread ? 0.45 : 0.7), u.bz - u.t * 0.25);
      s.scale.setScalar((0.5 * (1 - u.t) + 0.12) * fireK * k + 0.001);
      s.material.opacity = (1 - u.t) * 0.85 * Math.min(1, fireK) * k;
    }
    for (const s of w.outFire) {
      const u = s.userData; u.t += dt * 1.2; if (u.t > 1) u.t -= 1;
      s.position.set(u.bx, -0.5 + u.t * 1.8, u.bz); s.scale.setScalar(1.4 * (1 - u.t) + 0.2); s.material.opacity = (1 - u.t) * 0.9;
    }
    const smokeK = t < TL.wake ? 0 : 0.35 + 0.35 * smooth(50, 84, t) + 0.6 * smooth(85.5, 89, t);
    for (const s of w.smoke) {
      const u = s.userData; u.t += dt * 0.09; if (u.t > 1) { u.t -= 1; u.bx = rand(-0.9, 0.9); }
      s.position.set(u.bx + Math.sin(u.t * 3 + u.ph) * 0.2, 2.02 - u.t * 0.15 + Math.sin(u.t * 5 + u.ph) * 0.05, 4.9 - u.t * 5.5);
      s.scale.setScalar(0.5 + u.t * 2.2);
      s.material.opacity = Math.sin(Math.PI * u.t) * 0.55 * smokeK;
    }
    if (t > 50 && t < 86 && t > C.nextDrip) { burst(SPARK, 3); C.nextDrip = t + rand(0.3, 1.4); }
    const pos = w.snow.geometry.attributes.position.array, gust = 1.6 + Math.sin(t * 0.7) * Math.sin(t * 0.23) * 0.8;
    for (let i = 0; i < w.snowSp.length; i++) {
      const j = i * 3;
      pos[j + 2] -= w.snowSp[i] * gust * dt; pos[j + 1] -= 0.35 * dt; pos[j] += (Math.sin(t * 1.7 + i) * 0.3 + 0.15) * dt;
      if (pos[j + 2] < 0.6 || pos[j + 1] < 0.02) { pos[j] = rand(-1.4, 1.4); pos[j + 1] = rand(0.1, 2.4); pos[j + 2] = rand(5.3, 12); }
    }
    w.snow.geometry.attributes.position.needsUpdate = true;
  }
  const sp = w.sparks, sPos = sp.geo.attributes.position.array;
  for (let i = 0; i < sp.life.length; i++) {
    if (sp.life[i] <= 0) continue;
    const j = i * 3;
    sp.life[i] -= dt; sp.v[j + 1] -= 7 * dt;
    sPos[j] += sp.v[j] * dt; sPos[j + 1] += sp.v[j + 1] * dt; sPos[j + 2] += sp.v[j + 2] * dt;
    if (sPos[j + 1] < 0.01) { sPos[j + 1] = 0.01; sp.v[j + 1] *= -0.3; sp.v[j] *= 0.5; sp.v[j + 2] *= 0.5; }
    if (sp.life[i] <= 0) sPos[j + 1] = -50;
  }
  sp.geo.attributes.position.needsUpdate = true;
}
