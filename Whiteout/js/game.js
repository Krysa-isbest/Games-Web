// Whiteout: the game, build step 1: walking the island. After the opening cutscene you stand in the snow by
// the burning wreck. This file runs it: the loop, the cold (body heat), the HUD, the pause menu and the mouse.
// The island is world.js, you are player.js, the clock and the weather are island.js.
// Co-op is built the "host runs the world" way: the host owns the clock, the difficulty and the physics of the
// loose things and sends them out; everyone moves their own survivor and sends where they are. This is only
// the frame for build step 6 (full sync): enough that a crew stands on the same island at the same time.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G, S, clamp, lerp } from './state.js';
import { kn } from './keys.js';
import { NET, on, send, broadcast } from './net.js';
import { SCN, W, smooth } from './scene.js';
import { menuAudio, GAME, ui as uiSnd } from './audio.js';
import { dressPanel } from './frost.js';
import { loadPhysics } from './physics.js';
import * as ISL from './island.js';
import { buildWorld } from './world.js';
import { Player, Input, AVATAR } from './player.js';
import { makeBody, pose, lookFor } from './body.js';
import * as SFX from './sfx.js';

let GM = null;      // the running game
export const inGame = () => !!GM;
export function preloadGame() { loadPhysics().catch(() => { /* tried again when the game starts */ }); }
const diffNow = () => ISL.DIFF[G.lobby.opts.diff] || ISL.DIFF.normal;

// args: { players, meId, coop, openSettings(), onQuit() }
export async function startGame(args) {
  if (GM) return;
  const gm = GM = { args, coop: !!args.coop, role: G.net.role, raf: 0, last: 0, T: ISL.T_START, Tnet: null, TnetAt: 0, env: {},
    ready: false, ended: false, locked: false, started: false, pauseOpen: false, unlockAt: 0,
    inp: new Input(), avatars: new Map(), hints: new Set(), hintQ: [], hintBusy: false,
    netT: 0, propT: 0, propN: 0, hudT: 0, leeT: 0, lee: 0, cold: 0, rate: 0, inside: false, byFire: 0, edgeT: 0, fpsN: 0, fpsT: 0, txt: {} };
  buildDom(gm);
  document.body.classList.add('in-game');
  SCN.paused = true; menuAudio(false);
  try {
    const R = await loadPhysics();
    if (GM !== gm) return;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));       // let the black cover paint before the island is built
    if (GM !== gm) return;
    build(gm, R);
  } catch (e) {
    console.error(e);
    if (GM === gm) fail(gm);
    return;
  }
  listen(gm);
  gm.ready = true; gm.last = performance.now();
  GAME.on = true; GAME.wind = 1; GAME.fire = 0;
  gm.dom.root.classList.add('ready');
  gm.dom.cover.classList.add('out');
  gm.raf = requestAnimationFrame(frame);
  setTimeout(() => { if (GM === gm) objective(gm); }, 1800);
}

export function stopGame() {
  const gm = GM;
  if (!gm) return;
  GM = null; gm.ended = true;
  cancelAnimationFrame(gm.raf);
  unlisten(gm);
  if (document.pointerLockElement) document.exitPointerLock?.();
  if (gm.prevDrop) NET.onDrop = gm.prevDrop;
  GAME.on = false;
  document.body.classList.remove('game-settings', 'in-game');
  try {
    gm.scene?.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => { m.map?.dispose(); m.dispose(); }); });
    gm.composer?.dispose?.();
    gm.renderer?.dispose(); gm.renderer?.forceContextLoss?.();
    gm.world?.phys.free();
  } catch (e) { console.warn(e); }
  const root = gm.dom.root;
  root.classList.add('out'); setTimeout(() => root.remove(), 500);
  SCN.paused = false; menuAudio(true); G.started = false;
}
function quit(gm) { if (GM !== gm) return; stopGame(); gm.args.onQuit?.(); }

// the graphics settings changed (main.js calls this)
export function gameApply() { if (GM?.ready) gfx(GM, true); }

// ---------- building ----------
function buildDom(gm) {
  const d = document.createElement('div');
  d.className = 'game';
  d.innerHTML = `<canvas class="gm-canvas"></canvas><div class="gm-frost"></div>
    <div class="gm-hud">
      <div class="gm-heat" data-s="chilly"><svg viewBox="0 0 24 24"><path d="M10 4a2 2 0 014 0v10a4 4 0 11-4 0zM12 9v8"/></svg><div class="gm-bar"><i></i></div><small></small></div>
      <div class="gm-clock"><b></b><small class="gm-day"></small><small class="gm-air"></small></div>
      <div class="gm-dot"></div>
    </div>
    <div class="gm-obj"></div><div class="gm-hint"></div>
    <div class="gm-click">Click to look around</div>
    <div class="gm-pause hidden"><div class="panel">
      <header class="p-head"><h2>Paused</h2><span class="p-sub"></span></header>
      <div class="gm-pmenu">
        <button class="btn primary" data-a="resume">Resume</button>
        <button class="btn" data-a="settings">Settings</button>
        <div class="gm-diff"><span>Difficulty</span><div class="seg">${Object.entries(ISL.DIFF).map(([k, v]) => `<button data-v="${k}">${v.name}</button>`).join('')}</div></div>
        <p class="gm-note"></p>
        <button class="btn ghost" data-a="quit">Quit to menu</button>
      </div>
    </div></div>
    <div class="gm-cover"><div><div class="kicker">Flight 2207</div><p>You drag yourself out of the burning plane.</p><div class="gm-load"><i></i></div></div></div>`;
  document.body.append(d);
  const q = s => d.querySelector(s);
  gm.dom = { root: d, canvas: q('.gm-canvas'), frost: q('.gm-frost'), heat: q('.gm-heat'), bar: q('.gm-bar i'), state: q('.gm-heat small'), clock: q('.gm-clock b'), day: q('.gm-day'), air: q('.gm-air'),
    obj: q('.gm-obj'), hint: q('.gm-hint'), pause: q('.gm-pause'), sub: q('.gm-pause .p-sub'), note: q('.gm-note'), cover: q('.gm-cover') };
  q('[data-a="resume"]').onclick = () => resume(gm, true);
  q('[data-a="settings"]').onclick = () => gm.args.openSettings?.();
  const quitB = q('[data-a="quit"]');
  quitB.onclick = () => {
    if (quitB.dataset.sure) return quit(gm);
    quitB.dataset.sure = '1'; quitB.textContent = 'Click again to quit';
    setTimeout(() => { delete quitB.dataset.sure; quitB.textContent = 'Quit to menu'; }, 3000);
  };
  d.querySelectorAll('.gm-diff button').forEach(b => b.onclick = () => {
    if (gm.role === 'guest') return;
    G.lobby.opts.diff = b.dataset.v; syncPause(gm); uiSnd.click();
  });
}
function fail(gm) {
  gm.dom.cover.innerHTML = `<div><div class="kicker">Flight 2207</div><p>The island could not be loaded. The physics engine comes from the internet: check your connection and try again.</p><button class="btn primary">Back to the menu</button></div>`;
  gm.dom.cover.querySelector('button').onclick = () => quit(gm);
}

function build(gm, R) {
  gm.R = R;
  const renderer = gm.renderer = new THREE.WebGLRenderer({ canvas: gm.dom.canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * (+S.scale || 1));
  renderer.setSize(innerWidth, innerHeight);
  const scene = gm.scene = new THREE.Scene();
  const camera = gm.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.07, 2000);
  camera.rotation.order = 'YXZ';
  const world = gm.world = buildWorld(R, scene, renderer, gm.role === 'guest');
  const players = gm.args.players?.length ? gm.args.players : [{ id: 'p0', name: S.name, coat: S.coat }];
  const idx = Math.max(0, players.findIndex(p => p.id === gm.args.meId));
  const p = gm.player = new Player(R, world, scene, camera, lookFor(players[idx]), world.spawn(idx));
  p.onStep = (surface, loud, depth) => SFX.step(surface, loud, depth);
  p.onLand = (speed, surface) => SFX.land(speed, surface);
  // post: bloom, then grain, a vignette, the cold grade and frost (the menu's look), anti-aliased when it's on
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: S.aa ? 4 : 0 });
  const composer = gm.composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gm.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.6, 0.72);
  composer.addPass(gm.bloom);
  composer.addPass(new OutputPass());
  gm.final = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 1 }, uFrost: { value: 0 }, uCold: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uFrost; uniform float uCold; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.0) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float ca = 0.0012 + uFrost * 0.002;
        vec3 c = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
        c = mix(c, c * vec3(0.92, 0.98, 1.08), 0.6);                                                  // a cold grade
        c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))) * vec3(0.9, 0.97, 1.08), uCold * 0.45);         // freezing: the colour drains away
        c *= 1.0 - smoothstep(0.4, 0.95, length(d * vec2(1.1, 1.0))) * (0.36 + uCold * 0.25);          // vignette
        c += (h(vUv * 800.0) - 0.5) * 0.04 * uGrain;
        c = mix(c, vec3(0.8, 0.88, 0.96), smoothstep(0.42, 0.75, length(d)) * uFrost * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(gm.final);
  gfx(gm, false);
  // the first picture: the right light and your body, before the first frame is drawn
  const env = ISL.envAt(gm.T, diffNow().storm, gm.env);
  p.view(0.016, env); world.update(0.016, env, camera);
  // someone dropping out of the crew
  gm.prevDrop = NET.onDrop;
  NET.onDrop = pid => { gm.prevDrop?.(pid); if (GM === gm) dropped(gm, pid); };
}
function gfx(gm, all) {
  const pr = Math.min(devicePixelRatio, 2) * (+S.scale || 1);
  gm.renderer.setPixelRatio(pr); gm.composer.setPixelRatio(pr);
  resize(gm);
  gm.bloom.enabled = !!S.bloom;
  gm.final.uniforms.uGrain.value = S.grain ? 1 : 0;
  if (all) gm.world.applyGfx();
}
function resize(gm) {
  gm.camera.aspect = innerWidth / innerHeight; gm.camera.updateProjectionMatrix();
  gm.renderer.setSize(innerWidth, innerHeight); gm.composer.setSize(innerWidth, innerHeight);
}

// ---------- the loop ----------
function frame(now) {
  const gm = GM;
  if (!gm || !gm.ready) return;
  gm.raf = requestAnimationFrame(frame);
  const dt = clamp((now - gm.last) / 1000, 0, 0.1);
  gm.last = now;
  gm.fpsN++; gm.fpsT += dt;
  if (gm.fpsT > 0.5) { W.fps = Math.round(gm.fpsN / gm.fpsT); gm.fpsN = 0; gm.fpsT = 0; }
  if (dt > 0 && !(gm.pauseOpen && !gm.coop)) tick(gm, dt);      // a solo game stops while the pause menu is open
  hud(gm, dt);
  gm.composer.render();
}

function tick(gm, dt) {
  const p = gm.player, w = gm.world;
  // the world's clock: the host (or you alone) runs it, guests follow the host's
  gm.T += dt;
  if (gm.role === 'guest' && gm.Tnet != null) {
    const off = gm.Tnet + (performance.now() - gm.TnetAt) / 1000 - gm.T;
    gm.T += Math.abs(off) > 5 ? off : off * Math.min(1, dt * 2);
  }
  const diff = diffNow(), env = ISL.envAt(gm.T, diff.storm, gm.env);
  W.gust = env.gust; W.wind = env.wind; W.t += dt;                // the wind you hear follows the wind you see
  // physics in small steps: you move, then the world moves
  gm.inp.active = gm.locked;
  const n = clamp(Math.ceil(dt / 0.02), 1, 4), h = dt / n;
  for (let i = 0; i < n; i++) {
    w.phys.timestep = h;
    p.step(h, env, gm.inp);
    w.phys.step();
  }
  survive(gm, dt, env, diff);
  p.view(dt, env);
  w.update(dt, env, gm.camera);
  crew(gm, dt);
  net(gm, dt);
  gm.bloom.strength = lerp(0.75, 0.22, env.light); gm.bloom.threshold = lerp(0.72, 0.92, env.light);
  const u = gm.final.uniforms;
  u.uTime.value = W.t; u.uCold.value = gm.cold; u.uFrost.value = S.frost ? Math.max(env.gust * p.exposure * 0.8, gm.cold * 0.9) : 0;
}

// ---------- the cold ----------
// Body heat (0..100). The air, the night and the wind take it; the shack's walls keep some of the wind off;
// daylight, moving and the wreck's fire give some back. Low heat: you shiver, you slow down, your arms wrap
// around you. (Nothing kills you yet: being downed comes with a later build step.)
function survive(gm, dt, env, diff) {
  const p = gm.player, w = gm.world;
  const inside = gm.inside = w.inShack(p.pos);
  // out of the wind behind something solid? one ray against the wind, a few times a second
  gm.leeT -= dt;
  if (gm.leeT <= 0) {
    gm.leeT = 0.25;
    const ray = new gm.R.Ray({ x: p.pos.x, y: p.pos.y + (p.crouched ? 0.7 : 1.1), z: p.pos.z }, { x: -Math.cos(env.wdir), y: 0.1, z: -Math.sin(env.wdir) });
    const hit = w.phys.castRay(ray, 7, true, undefined, undefined, p.col);
    gm.lee = hit ? 1 - clamp((hit.timeOfImpact ?? hit.toi ?? 7) / 7, 0, 1) * 0.5 : 0;
  }
  const open = (inside ? 0.25 : 1 - 0.6 * gm.lee) * (p.crouched ? 0.85 : 1);     // how much of the wind reaches you
  p.exposure += (open - p.exposure) * Math.min(1, dt * 3);
  const fd = Math.hypot(p.pos.x - w.fire.pos.x, p.pos.z - w.fire.pos.z), byFire = gm.byFire = env.fire * smooth(9, 2.2, fd);
  const cold = -env.temp / 24, chill = env.wind / 10 * p.exposure;
  const drain = diff.drain * cold * (0.1 * (inside ? 0.6 : 1) + 0.14 * chill) * (1 - byFire * 0.6);
  const sun = env.light * (1 - env.storm) * (inside ? 0.05 : 0.14);             // daylight warms you a little, mostly out in the sun
  const gain = 0.04 + sun + (p.moving ? (p.sprinting ? 0.1 : 0.035) : 0) + byFire * 1.3;
  const rate = gm.started ? gain - drain : 0;
  p.heat = clamp(p.heat + rate * dt, 0, 100);
  gm.rate += (rate - gm.rate) * Math.min(1, dt * 2);
  // what the cold does to you
  const c = gm.cold = smooth(42, 6, p.heat);
  p.slow = lerp(1, 0.58, smooth(32, 0, p.heat));
  p.shiver = c * (0.3 + 0.7 * smooth(0.25, 0.7, 0.5 + 0.5 * Math.sin(gm.T * 0.9) * Math.sin(gm.T * 0.37 + 1)));
  p.hug += (smooth(30, 8, p.heat) * (p.sprinting ? 0.3 : 1) - p.hug) * Math.min(1, dt * 2);
  // what you hear: the wind is duller indoors, the fire crackles when you are near it
  GAME.wind = inside ? 0.5 : lerp(0.72, 1, p.exposure); GAME.fire = env.fire * smooth(32, 3, fd) * 3;
  // things worth saying once
  if (!gm.started) return;
  if (inside) hint(gm, 'shack', 'The ruin keeps some of the wind off you. It is still cold in here: the gaps let it in.');
  if (byFire > 0.3) hint(gm, 'fire', 'The fire warms you. It will burn out by the morning.');
  if (p.heat < 30) hint(gm, 'cold', 'You are freezing. Get out of the wind: behind a wall, a rock, or in among the trees.');
  if (p.surface === 'ice' && p.grounded) hint(gm, 'ice', 'Sea ice. You slide on it, and nothing out here stops the wind.');
  if (p.depth > 0.75 && p.moving) hint(gm, 'snow', 'Deep snow slows you down. Wind-packed snow is firmer.');
  if (env.storm > 0.5) hint(gm, 'storm', 'A storm is coming in. You can hardly see, and the wind takes your heat twice as fast.');
  if (env.light > 0.6) hint(gm, 'day', 'Daylight. It is warmer by day, but the days are short.');
  gm.edgeT -= dt;
  if (p.atEdge && gm.edgeT <= 0) { gm.edgeT = 12; gm.hints.delete('edge'); hint(gm, 'edge', 'The ice is too thin further out. Turn back.', 4000, true); }
}

// ---------- the HUD ----------
const HEAT = [[70, 'warm', 'Warm'], [45, 'chilly', 'Chilly'], [20, 'cold', 'Cold'], [0.5, 'freezing', 'Freezing'], [-1, 'freezing', 'Frozen stiff']];
const WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function setText(gm, key, el, text) { if (gm.txt[key] !== text) { gm.txt[key] = text; el.textContent = text; } }
function clockText(env) {
  const hh = Math.floor(env.hours) % 24, mm = Math.floor((env.hours % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function hud(gm, dt) {
  gm.hudT -= dt;
  if (gm.hudT > 0) return;
  gm.hudT = 0.1;
  const d = gm.dom, p = gm.player, env = gm.env;
  d.root.classList.toggle('paused', gm.pauseOpen);
  d.bar.style.width = p.heat.toFixed(1) + '%';
  const st = HEAT.find(s => p.heat >= s[0]);
  if (d.heat.dataset.s !== st[1]) d.heat.dataset.s = st[1];
  const where = gm.byFire > 0.25 ? 'By the fire' : gm.inside ? 'In the shack' : gm.lee > 0.35 ? 'Out of the wind' : env.wind * p.exposure > 13 ? 'In the wind' : '';
  const arrow = gm.rate > 0.05 ? ' ▲' : gm.rate < -0.3 ? ' ▼▼' : gm.rate < -0.04 ? ' ▼' : '';
  setText(gm, 'state', d.state, st[2] + arrow + (where ? ' · ' + where : ''));
  setText(gm, 'clock', d.clock, clockText(env));
  const deg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
  setText(gm, 'day', d.day, `Day ${env.day} · ${WINDS[Math.round(deg / 45) % 8]}`);
  const temp = S.temp === 'f' ? `${Math.round(env.temp * 9 / 5 + 32)}°F` : `${Math.round(env.temp)}°C`;
  setText(gm, 'air', d.air, `${temp} · wind ${Math.round(env.wind * 3.6)} km/h`);
  d.frost.style.opacity = S.frost ? (gm.cold * 0.85).toFixed(2) : '0';
  if (gm.pauseOpen) setText(gm, 'sub', d.sub, `Day ${env.day} · ${clockText(env)}`);
}
function objective(gm) {
  const o = gm.dom.obj;
  o.innerHTML = `<small>Objective</small><b>Find shelter</b><span>An old hunters' shack stands up the hill to the south-west.</span>`;
  o.classList.add('show');
  clearTimeout(gm.objT);
  gm.objT = setTimeout(() => o.classList.remove('show'), 12000);
}
// short tips, one at a time, each only once (Settings > General > Hints)
function hint(gm, id, text, ms = 7000, always = false) {
  if ((!S.hints && !always) || gm.hints.has(id)) return;
  gm.hints.add(id); gm.hintQ.push([text, ms]);
  if (!gm.hintBusy) nextHint(gm);
}
function nextHint(gm) {
  const it = gm.hintQ.shift(), el = gm.dom.hint;
  if (!it || GM !== gm) { gm.hintBusy = false; return; }
  gm.hintBusy = true; el.textContent = it[0]; el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => nextHint(gm), 700); }, it[1]);
}

// ---------- the mouse, the keys, the pause menu ----------
function lock(gm) {
  try { const pr = gm.dom.canvas.requestPointerLock?.(); if (pr && pr.catch) pr.catch(() => {}); } catch { /* the browser said no: the prompt stays */ }
}
function syncPause(gm) {
  const guest = gm.role === 'guest';
  gm.dom.root.querySelectorAll('.gm-diff button').forEach(b => { b.classList.toggle('on', b.dataset.v === G.lobby.opts.diff); b.disabled = guest; });
  gm.dom.note.textContent = guest ? 'The host sets the difficulty. The island keeps going while this is open.' : gm.coop ? 'The island keeps going while this is open.' : 'The island waits while you are paused.';
}
function openPause(gm) {
  if (gm.pauseOpen || gm.ended) return;
  gm.pauseOpen = true; gm.inp.clear();
  gm.txt.sub = null; syncPause(gm);
  gm.dom.pause.classList.remove('hidden');
  requestAnimationFrame(() => dressPanel(gm.dom.pause.querySelector('.panel')));
  uiSnd.open();
}
function closePause(gm) {
  if (!gm.pauseOpen) return;
  gm.pauseOpen = false;
  gm.dom.pause.classList.add('hidden');
  gm.last = performance.now();
}
function resume(gm, byClick) {
  if (!byClick) return closePause(gm);        // Esc can't take the mouse back: the "click to look around" prompt shows
  lock(gm);
  setTimeout(() => { if (GM === gm && gm.pauseOpen && !gm.locked) closePause(gm); }, 400);
}
function listen(gm) {
  const h = gm.h = {
    kd: e => {
      if (GM !== gm || gm.ended) return;
      if (e.code === 'Escape') {
        if (document.body.classList.contains('game-settings')) return;        // the settings window closes itself (main.js)
        if (performance.now() - gm.unlockAt < 350) return;                    // this Esc already let go of the mouse
        if (gm.pauseOpen) resume(gm, false); else if (!gm.locked) openPause(gm);
        return;
      }
      if (!gm.locked) return;
      if (!/^F\d+$/.test(e.code)) e.preventDefault();                         // Tab, Alt and Space belong to the game now
      gm.inp.key(e.code, true, e.repeat);
    },
    ku: e => gm.inp.key(e.code, false),
    md: e => {
      if (GM !== gm || !gm.ready || gm.ended) return;
      if (!gm.locked) { if (!gm.pauseOpen && e.button === 0) lock(gm); return; }
      gm.inp.key('Mouse' + e.button, true, false);
    },
    mu: e => gm.inp.key('Mouse' + e.button, false),
    mm: e => { if (gm.locked && !gm.pauseOpen) gm.player.look(e.movementX || 0, e.movementY || 0); },
    plc: () => {
      const was = gm.locked;
      gm.locked = document.pointerLockElement === gm.dom.canvas;
      gm.dom.root.classList.toggle('locked', gm.locked);
      if (gm.locked) {
        closePause(gm);
        if (!gm.started) { gm.started = true; objective(gm); setTimeout(() => { if (GM === gm) hint(gm, 'keys', `Move: ${kn('forward')} ${kn('left')} ${kn('back')} ${kn('right')} · Sprint: ${kn('sprint')} · Crouch: ${kn('crouch')} · Jump: ${kn('jump')} · Walk slowly: ${kn('walk')}`, 9000); }, 3000); }
      } else {
        gm.inp.clear();
        if (was) { gm.unlockAt = performance.now(); openPause(gm); }
      }
    },
    ple: () => closePause(gm),
    blur: () => gm.inp.clear(),
    rs: () => { if (gm.ready) resize(gm); },
    ctx: e => e.preventDefault(),
  };
  addEventListener('keydown', h.kd, true); addEventListener('keyup', h.ku, true);
  gm.dom.root.addEventListener('mousedown', h.md); addEventListener('mouseup', h.mu);
  document.addEventListener('mousemove', h.mm);
  document.addEventListener('pointerlockchange', h.plc); document.addEventListener('pointerlockerror', h.ple);
  addEventListener('blur', h.blur); addEventListener('resize', h.rs);
  gm.dom.root.addEventListener('contextmenu', h.ctx);
}
function unlisten(gm) {
  const h = gm.h;
  if (!h) return;
  removeEventListener('keydown', h.kd, true); removeEventListener('keyup', h.ku, true);
  removeEventListener('mouseup', h.mu);
  document.removeEventListener('mousemove', h.mm);
  document.removeEventListener('pointerlockchange', h.plc); document.removeEventListener('pointerlockerror', h.ple);
  removeEventListener('blur', h.blur); removeEventListener('resize', h.rs);
}

// ---------- the crew (the frame for co-op) ----------
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
function net(gm, dt) {
  if (gm.role === 'solo') return;
  const p = gm.player;
  gm.netT -= dt;
  if (gm.netT <= 0) {           // where I am, about 12 times a second
    gm.netT = 0.08;
    send('*', { t: 'g-p', p: [r2(p.pos.x), r2(p.visY - p.sink), r2(p.pos.z)], yaw: r2(p.yaw), pit: r2(p.pitch), cr: p.crouched ? 1 : 0, wk: r2(p.walkAmt), ph: r2(p.phase), air: p.grounded ? 0 : 1, hug: r2(p.hug) });
  }
  if (gm.role !== 'host') return;
  gm.propT -= dt;
  if (gm.propT <= 0) {          // the host: the clock, the difficulty, and every loose thing that is moving (all of them now and then)
    gm.propT = 0.1; gm.propN = (gm.propN + 1) % 20;
    const props = [];
    gm.world.props.forEach((o, i) => {
      if (gm.propN !== 0 && o.body.isSleeping()) return;
      const m = o.mesh;
      props.push([i, r3(m.position.x), r3(m.position.y), r3(m.position.z), r3(m.quaternion.x), r3(m.quaternion.y), r3(m.quaternion.z), r3(m.quaternion.w)]);
    });
    broadcast({ t: 'g-w', T: r2(gm.T), diff: G.lobby.opts.diff, props });
  }
}
on('g-w', m => {
  const gm = GM;
  if (!gm || !gm.ready || gm.role !== 'guest') return;
  gm.Tnet = +m.T || 0; gm.TnetAt = performance.now();
  if (ISL.DIFF[m.diff]) G.lobby.opts.diff = m.diff;
  for (const a of m.props || []) { const o = gm.world.props[a[0]]; if (o) o.to = a.slice(1); }
});
on('g-p', (m, from) => {
  const gm = GM;
  if (!gm || !gm.ready || !from || from === G.net.id || !Array.isArray(m.p)) return;
  let a = gm.avatars.get(from);
  if (!a) {
    const info = G.lobby.players.find(x => x.id === from) || gm.args.players?.find(x => x.id === from) || { id: from };
    a = { P: makeBody(lookFor(info), false), pos: new THREE.Vector3(m.p[0], m.p[1], m.p[2]), yaw: +m.yaw || 0, cr: 0, wk: 0, to: m, body: null };
    gm.scene.add(a.P.g);
    if (gm.role === 'host') {     // a stand-in the host's physics can feel, so a guest can push loose things too
      a.body = gm.world.phys.createRigidBody(gm.R.RigidBodyDesc.kinematicPositionBased().setTranslation(m.p[0], m.p[1] + 0.9, m.p[2]));
      gm.world.phys.createCollider(gm.R.ColliderDesc.capsule(0.6, 0.3).setCollisionGroups(AVATAR), a.body);
    }
    gm.avatars.set(from, a);
  }
  a.to = m;
});
function crew(gm, dt) {
  const k = 1 - Math.exp(-12 * dt);
  for (const a of gm.avatars.values()) {
    const to = a.to, dy = (+to.yaw || 0) - a.yaw;
    a.pos.x += (to.p[0] - a.pos.x) * k; a.pos.y += (to.p[1] - a.pos.y) * k; a.pos.z += (to.p[2] - a.pos.z) * k;
    a.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
    a.cr += ((to.cr ? 1 : 0) - a.cr) * k; a.wk += ((+to.wk || 0) - a.wk) * k;
    a.P.g.position.copy(a.pos); a.P.g.rotation.y = a.yaw + Math.PI;
    pose(a.P, { crouch: a.cr, walk: a.wk, phase: +to.ph || 0, air: to.air ? 1 : 0, hug: +to.hug || 0, look: -(+to.pit || 0) * 0.6 });
    if (a.body) a.body.setNextKinematicTranslation({ x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z });
  }
}
function dropped(gm, pid) {
  const a = gm.avatars.get(pid);
  if (a) {
    gm.scene.remove(a.P.g);
    if (a.body) gm.world.phys.removeRigidBody(a.body);
    gm.avatars.delete(pid);
  }
  if (gm.role === 'guest' && pid === 'p0') quit(gm);       // the host is gone, and the island with them
}
