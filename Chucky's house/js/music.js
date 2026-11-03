// Music. The owner's tracks go in music/ and are listed in music/list.json:
//   { "menu": ["menu.mp3"], "shop": [...], "evening": [...], "auction": [...], "night": [...], "chase": [...],
//     "down": [...], "prison": [...], "intro": [...] }
// Empty lists = silence (nothing breaks). Shop music plays from the radio on the counter (positional).
// The ending track is synthesized live (an original slow build that explodes), so it needs no file.
import * as THREE from 'three';
import { G, ACTIONS, pick } from './state.js';
import { part } from './data.js';
import { interactive, STATIC } from './world.js';
import { trustMods } from './economy.js';
import { tell } from './net.js';
import { audioCtx, sfx } from './sfx.js';
import { S } from './settings.js';
import { VOICE } from './voice.js';

export const STATIONS = [
  { name: 'Chill FM', mood: 'shop' },
  { name: 'Night Jazz', mood: 'evening' },
  { name: 'Hype Radio', mood: 'auction' },
  { name: 'Off', mood: null },
];
const M = { list: {}, bus: null, direct: null, radioIn: null, panner: null, decks: [], cur: -1, mood: undefined, chase: null, chaseGain: null, duck: 1, ready: false };
const RADIO_POS = new THREE.Vector3(-3.3, 1.15, 2.2);
const _v = new THREE.Vector3();

export async function initMusic() {
  try { M.list = await (await fetch('music/list.json', { cache: 'no-cache' })).json(); } catch { M.list = {}; }
  M.ready = true;
}
export const hasTracks = mood => (M.list[mood] || []).length > 0;

function graph() {
  if (M.bus) return;
  const c = audioCtx();
  M.bus = c.createGain(); M.bus.connect(c.destination);
  M.direct = c.createGain(); M.direct.connect(M.bus);
  M.panner = c.createPanner();
  Object.assign(M.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, maxDistance: 40, rolloffFactor: 1.1 });
  M.radioIn = c.createGain();
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000; // a small speaker
  M.radioIn.connect(lp).connect(M.panner).connect(M.bus);
  M.chaseGain = c.createGain(); M.chaseGain.gain.value = 0; M.chaseGain.connect(M.bus);
}

function deck(file, viaRadio) {
  const c = audioCtx(), el = new Audio('music/' + file);
  el.crossOrigin = 'anonymous';
  const g = c.createGain(); g.gain.value = 0;
  try { c.createMediaElementSource(el).connect(g); } catch { /* file:// pages: plays without effects */ }
  g.connect(viaRadio ? M.radioIn : M.direct);
  return { el, g, file };
}

// Switch the music (2 s crossfade). mood = a key of list.json, or null for silence.
export function setMood(mood, viaRadio = false) {
  if (!M.ready || (mood === M.mood && viaRadio === M.viaRadio)) return;
  graph();
  M.mood = mood; M.viaRadio = viaRadio;
  const c = audioCtx(), now = c.currentTime;
  for (const d of M.decks) { d.g.gain.setTargetAtTime(0, now, 0.6); const old = d; setTimeout(() => { old.el.pause(); old.g.disconnect(); }, 2600); }
  M.decks = [];
  const files = M.list[mood] || [];
  if (!files.length) return;
  const playNext = () => {
    if (M.mood !== mood) return;
    const d = deck(pick(files), viaRadio);
    M.decks.push(d);
    d.el.onended = () => { M.decks.splice(M.decks.indexOf(d), 1); playNext(); };
    d.el.play().catch(() => { /* waits for the first click (autoplay rules) */ addEventListener('pointerdown', () => d.el.play().catch(() => {}), { once: true }); });
    d.g.gain.setTargetAtTime(1, c.currentTime, 0.7);
  };
  playNext();
}

// Extra layer that fades in when an enemy is chasing you (needs a "chase" track).
export function setChase(v) {
  if (!M.ready || !hasTracks('chase')) return;
  graph();
  if (!M.chase) {
    const c = audioCtx(), el = new Audio('music/' + M.list.chase[0]);
    el.loop = true;
    try { c.createMediaElementSource(el).connect(M.chaseGain); } catch { /* ignore */ }
    el.play().catch(() => {});
    M.chase = el;
  }
  M.chaseGain.gain.setTargetAtTime(v * 0.9, audioCtx().currentTime, v > 0 ? 0.3 : 1.5);
}
export function stopChase() { if (M.chase) { M.chase.pause(); M.chase = null; M.chaseGain.gain.value = 0; } }

// Volume, ducking under voice chat, radio position relative to the camera.
export function updateMusic(camera) {
  if (!M.bus) return;
  const c = audioCtx(), now = c.currentTime;
  let talking = false;
  for (const v of VOICE.peers.values()) if (v.level > 0.06) talking = true;
  M.duck += ((talking ? 0.45 : 1) - M.duck) * 0.1;
  M.bus.gain.setTargetAtTime(S.music * M.duck, now, 0.1);
  if (M.viaRadio) {
    camera.updateMatrixWorld();
    camera.worldToLocal(_v.copy(RADIO_POS));
    M.panner.positionX.setTargetAtTime(_v.x, now, 0.05);
    M.panner.positionY.setTargetAtTime(_v.y, now, 0.05);
    M.panner.positionZ.setTargetAtTime(_v.z, now, 0.05);
  }
}

// ---------- the radio on the counter ----------
export function buildRadio(scene) {
  const g = new THREE.Group(); g.position.copy(RADIO_POS).setY(1.01);
  part(g, new THREE.BoxGeometry(0.34, 0.2, 0.14), 0x6a3a1a, 0, 0.1, 0);
  part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.01, 14), 0x2a2018, -0.07, 0.1, 0.071).rotation.x = Math.PI / 2;
  part(g, new THREE.BoxGeometry(0.1, 0.03, 0.01), 0xffd890, 0.08, 0.13, 0.071, { emissive: 0x664400 });
  part(g, new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), 0xcccccc, 0.12, 0.33, -0.03, { metalness: 0.8 }).rotation.z = -0.3;
  interactive(g, 'radio'); scene.add(g);
  void STATIC;
}
ACTIONS.radio = pid => {
  G.radio = (G.radio + 1) % STATIONS.length;
  const st = STATIONS[G.radio];
  sfx.click2();
  tell(pid, st.mood ? `📻 ${st.name}${hasTracks(st.mood) ? '' : ' (no tracks yet)'}` : '📻 Radio off');
  return G.radio;
};
export const radioOn = () => !!STATIONS[G.radio]?.mood && hasTracks(STATIONS[G.radio].mood);
// Customers like music: trust grows 10 % faster with the radio (or the jukebox) on.
trustMods.push(() => radioOn() || G.decor.includes('jukebox') ? 1.1 : 1);

// ---------- synthesized ending: tiny and tense, builds and builds, then explodes ----------
let noiseBuf;
export function playEnding() {
  graph();
  const c = audioCtx(), out = c.createGain();
  out.gain.value = 0.9;
  out.connect(M.bus);
  M.bus.gain.setTargetAtTime(Math.max(0.35, S.music), c.currentTime, 0.1);
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const shaper = c.createWaveShaper(), curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
  shaper.curve = curve;
  const dist = c.createGain(); dist.gain.value = 0.5;
  const distLP = c.createBiquadFilter(); distLP.type = 'lowpass'; distLP.frequency.value = 3200;
  shaper.connect(distLP).connect(dist).connect(out);

  // 56 beats (~30 s) of build: the drop lands when the neon sign lights up in the win cutscene
  const DROP = 56, t0 = c.currentTime + 0.1, BEAT = 60 / 112, EXPLODE = DROP * BEAT;
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  const osc = (type, f, t, dur, vol, dest = out, f2) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  };
  const noise = (t, dur, vol, freq, q = 1, dest = out) => {
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + dur + 0.05);
  };
  const kick = (t, v = 0.9) => osc('sine', 120, t, 0.35, v, out, 40);
  const snare = (t, v = 0.5) => { noise(t, 0.18, v, 1800, 0.7); osc('triangle', 220, t, 0.1, v * 0.4); };
  // E minor arpeggio, the little tense riff
  const RIFF = [64, 67, 71, 76, 64, 67, 71, 78, 64, 67, 71, 76, 64, 67, 72, 79];
  const PROG = [40, 43, 45, 48]; // E G A C (power chord roots)
  let beat = 0, stopped = false;
  const sched = () => {
    if (stopped) return;
    const ahead = c.currentTime + 0.25;
    while (t0 + beat * BEAT / 2 < ahead) {
      const t = t0 + beat * BEAT / 2, b = beat / 2; // b = beat count (8th notes)
      const build = Math.min(1, b / DROP), boom = b >= DROP;
      // the riff: always there
      osc('triangle', hz(RIFF[beat % RIFF.length]), t, 0.32, (boom ? 0.07 : 0.03 + build * 0.06));
      // heartbeat in the build
      if (!boom && beat % 4 === 0) { kick(t, 0.25 + build * 0.4); kick(t + BEAT * 0.35, 0.15 + build * 0.3); }
      // bass drone from beat 8
      if (b >= 8 && beat % 4 === 0) osc('sawtooth', hz(boom ? PROG[Math.floor((b - DROP) / 4) % 4] : 28), t, BEAT * 2.1, boom ? 0.12 : 0.03 + build * 0.07);
      // strings swell + snare roll in the second half of the build
      if (!boom && b >= DROP - 24) {
        if (beat % 8 === 0) for (const d of [-7, 0, 7]) osc('sawtooth', hz(52 + d / 7 * 0.1) * (1 + d * 0.001), t, BEAT * 4, 0.012 + build * 0.02);
        const roll = b >= DROP - 4 ? 1 : b >= DROP - 8 ? 2 : 4;
        if (beat % roll === 0) snare(t, 0.08 + build * 0.25);
      }
      if (!boom && b === DROP - 4) noise(t, BEAT * 4, 0.25, 900, 0.3); // riser
      // THE DROP: power chords, big drums, a lead line
      if (boom) {
        if (b === DROP) { noise(t, 2.2, 0.6, 5000, 0.3); kick(t, 1); }
        const root = PROG[Math.floor((b - DROP) / 4) % 4];
        for (const n of [root, root + 7, root + 12]) osc('sawtooth', hz(n), t, BEAT / 2 * 0.95, 0.35, shaper);
        if (beat % 2 === 0) kick(t, 0.95);
        if (beat % 4 === 2) snare(t, 0.6);
        noise(t, 0.05, 0.12, 8000, 1);
        if (beat % 2 === 0) osc('square', hz([76, 79, 81, 83, 84, 83, 81, 79][(beat / 2) % 8]), t, BEAT * 0.9, 0.05);
      }
      beat++;
    }
  };
  const iv = setInterval(sched, 50);
  sched();
  return {
    explodeAt: EXPLODE + 0.1,
    // cut = the twist: dead silence at once
    stop(cut = true) {
      stopped = true; clearInterval(iv);
      const now = c.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + (cut ? 0.05 : 2));
      setTimeout(() => out.disconnect(), 2500);
    },
  };
}

// A soft car-radio pad for the intro drive when there's no "intro" track.
export function playPad() {
  graph();
  const c = audioCtx(), out = c.createGain(), lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1400; out.gain.value = 0.5;
  out.connect(lp).connect(M.bus);
  M.bus.gain.setTargetAtTime(S.music, c.currentTime, 0.1);
  const chords = [[52, 55, 59, 62], [48, 52, 55, 59], [45, 48, 52, 55], [47, 50, 54, 57]];
  let k = 0, stopped = false;
  const play = () => {
    if (stopped) return;
    const t = c.currentTime;
    for (const n of chords[k++ % 4]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (n - 57) / 12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
      o.connect(g).connect(out); o.start(t); o.stop(t + 3);
    }
  };
  play();
  const iv = setInterval(play, 2800);
  return { stop() { stopped = true; clearInterval(iv); out.gain.setTargetAtTime(0, c.currentTime, 0.4); setTimeout(() => out.disconnect(), 2000); } };
}
