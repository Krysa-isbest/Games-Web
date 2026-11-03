// Music. The owner's tracks go in music/ and are listed in music/list.json:
//   { "menu": ["menu.mp3"], "shop": [...], "evening": [...], "auction": [...], "night": [...], "chase": [...],
//     "down": [...], "prison": [...], "intro": [...], "krysy": [...] (the Krysy o'clock radio station) }
// Empty lists fall back to a synthesized track (see STYLES) where there is one. Shop music plays from the radio on the counter (positional).
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
  { name: 'Krysy o\'clock', mood: 'krysy' }, // the owner's own songs (list.json "krysy")
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
  for (const d of M.decks) { d.g.gain.setTargetAtTime(0, now, 0.6); const old = d; setTimeout(() => { old.el?.pause(); old.stop?.(); old.g.disconnect(); }, 2600); }
  M.decks = [];
  const files = M.list[mood] || [];
  if (!files.length) {
    // no file for this moment: a synthesized track instead (if there is one)
    if (SYNTH[mood]) { const d = synthDeck(SYNTH[mood], viaRadio ? M.radioIn : M.direct); M.decks.push(d); d.g.gain.setTargetAtTime(1, now, 0.8); }
    return;
  }
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
  tell(pid, st.mood ? `📻 ${st.name}${hasMusic(st.mood) ? '' : ' (no tracks yet)'}` : '📻 Radio off');
  return G.radio;
};
export const radioOn = () => !!STATIONS[G.radio]?.mood && hasMusic(STATIONS[G.radio].mood);
// Customers like music: trust grows 10 % faster with the radio (or the jukebox) on.
trustMods.push(() => radioOn() || G.decor.includes('jukebox') ? 1.1 : 1);

// ---------- synthesized tracks for the moments without a file ----------
// The owner's tracks win whenever list.json has one for that moment.
const SYNTH = { evening: 'jazz', auction: 'hype', krysy: 'hype', night: 'ambient', down: 'heart', prison: 'blues' };
export const hasMusic = mood => hasTracks(mood) || !!SYNTH[mood];
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
function noiseBuffer(c) {
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return noiseBuf;
}

// Each style plays one 16th-note step at a time: play(step, time, sound).
const STYLES = {
  // Night Jazz: Rhodes chords, a walking bass, brushes and a lazy ride (ii-V-I-vi in C)
  jazz: { bpm: 84, play(s, t, x) {
    const bar = Math.floor(s / 16) % 4, i = s % 16, B = x.beat;
    const CH = [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 48, 52, 55]][bar];
    if (i === 0 || i === 6) for (const n of CH) { x.tone('sine', hz(n + 12), t, B * 2.2, 0.035); x.tone('triangle', hz(n), t, B * 1.8, 0.02); }
    if (i % 4 === 0) x.tone('triangle', hz(CH[[0, 2, 1, 3][i / 4]] - 12), t, B * 0.9, 0.12, { lp: 700 });
    if (i === 4 || i === 12) x.noise(t, 0.18, 0.05, 5000, 0.5);
    if (i % 4 === 0 || i % 4 === 3) x.noise(t, 0.06, 0.03, 9000, 2);
    if (i % 4 === 0 && Math.random() < 0.35) x.tone('triangle', hz(CH[Math.random() * 4 | 0] + 24), t + (Math.random() < 0.5 ? B / 3 : 0), B * 0.8, 0.03);
  } },
  // the auction (and Krysy o'clock until its own songs are in): four-on-the-floor, offbeat hats, a pumping bass, chord stabs (Am F C G)
  hype: { bpm: 126, play(s, t, x) {
    const bar = Math.floor(s / 16) % 4, i = s % 16, B = x.beat, R = [45, 41, 48, 43][bar];
    if (i % 4 === 0) x.tone('sine', 110, t, 0.25, 0.4, { to: 40 });
    if (i === 4 || i === 12) { x.noise(t, 0.15, 0.18, 1800, 0.6); x.noise(t, 0.08, 0.1, 4000, 1); }
    if (i % 4 === 2) x.noise(t, 0.05, 0.07, 9000, 2);
    if (i % 2 === 0) x.tone('sawtooth', hz(R - 12), t, B * 0.4, 0.07, { lp: 500 });
    if (i % 8 === 6) for (const n of [R + 12, R + 15 + (bar === 1 || bar === 2 ? 1 : 0), R + 19]) x.tone('sawtooth', hz(n), t, B * 0.3, 0.03, { lp: 2200 });
    if (bar % 2 === 1) x.tone('square', hz([R + 24, R + 27, R + 31, R + 36][i % 4]), t, B * 0.2, 0.012, { lp: 3000 });
  } },
  // Night ambience: dark pads, a lonely pluck now and then, wind
  ambient: { bpm: 60, play(s, t, x) {
    const bar = Math.floor(s / 16) % 4, i = s % 16, B = x.beat;
    if (i === 0) for (const [n, d] of [[[40, 36, 33, 35][bar], 0], [[47, 43, 40, 42][bar], 3], [[52, 48, 45, 47][bar], -3]]) x.tone('sawtooth', hz(n) * (1 + d * 0.001), t, B * 4.6, 0.025, { a: 1.5, lp: 520 });
    if (i % 4 === 0 && Math.random() < 0.22) x.tone('triangle', hz([64, 67, 69, 71, 74, 76][Math.random() * 6 | 0]), t, B * 3, 0.03, { lp: 2500 });
    if (i === 8 && Math.random() < 0.3) x.tone('sine', 50, t, 0.8, 0.12, { to: 35 });
    if (i === 0) x.noise(t, B * 4.5, 0.03, 350, 0.4, { a: 1.5 });
  } },
  // Bleeding out: a low drone that rubs against itself, a thin high whine
  heart: { bpm: 50, play(s, t, x) {
    const i = s % 32, B = x.beat;
    if (i === 0) { x.tone('sine', hz(28), t, B * 8.5, 0.12, { a: 2 }); x.tone('sine', hz(29), t, B * 8.5, 0.05, { a: 2 }); x.tone('sine', hz(88), t, B * 8, 0.008, { a: 3 }); }
  } },
  // Prison: slow blues, a lonely "harmonica" (A7 D7 A7 E7)
  blues: { bpm: 68, play(s, t, x) {
    const bar = Math.floor(s / 16) % 4, i = s % 16, B = x.beat, R = [45, 50, 45, 52][bar];
    if (i === 0 || i === 8) for (const n of [R, R + 4, R + 7, R + 10]) x.tone('triangle', hz(n + 12), t, B * 1.8, 0.02);
    if (i % 8 === 0) x.tone('triangle', hz(R - 12), t, B * 1.6, 0.1, { lp: 500 });
    if (i % 4 === 0 && Math.random() < 0.45) x.tone('square', hz([69, 72, 74, 75, 76, 79][Math.random() * 6 | 0]), t, B * (Math.random() < 0.5 ? 1 : 2), 0.018, { a: 0.08, lp: 1400, vib: 5 });
  } },
};

function synthDeck(style, dest) {
  const c = audioCtx(), P = STYLES[style], g = c.createGain();
  g.gain.value = 0; g.connect(dest);
  const beat = 60 / P.bpm, step16 = beat / 4, buf = noiseBuffer(c);
  const x = {
    beat,
    tone(type, f, t, dur, vol, o = {}) {
      const osc = c.createOscillator(), e = c.createGain();
      osc.type = type; osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = f * 0.012; l.connect(lg).connect(osc.frequency); l.start(t); l.stop(t + dur + 0.1); }
      const a = o.a || 0.01;
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(vol, t + a); e.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.05));
      let last = osc.connect(e);
      if (o.lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; last = last.connect(f2); }
      last.connect(g);
      osc.start(t); osc.stop(t + Math.max(dur, a + 0.05) + 0.05);
    },
    noise(t, dur, vol, freq, q = 1, o = {}) {
      const src = c.createBufferSource(), f = c.createBiquadFilter(), e = c.createGain();
      src.buffer = buf; src.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const a = o.a || 0.005;
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(vol, t + a); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(e).connect(g); src.start(t); src.stop(t + dur + 0.05);
    },
  };
  let step = 0, stopped = false;
  const t0 = c.currentTime + 0.1;
  const tick = () => { if (stopped) return; while (t0 + step * step16 < c.currentTime + 0.3) { P.play(step, t0 + step * step16, x); step++; } };
  const iv = setInterval(tick, 60);
  tick();
  return { g, stop() { stopped = true; clearInterval(iv); } };
}

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
