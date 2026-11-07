// Menu sound: howling wind that follows the gusts on screen, a crackling fire, a low cold drone, soft UI
// sounds. Your own menu song: put it in audio/music and list it in audio/list.json under "menu".
import { S } from './state.js';
import { W } from './scene.js';

let ctx = null, master, windGain, windBand, windBand2, windLo, droneGain, uiGain, fireGain, noiseBuf, music = null, musicFiles = [];

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.015 * w * 6; d[i] = w * 0.35 + b * 0.65; }   // part pink: softer
  // wind: noise through two resonant band-passes that the gusts sweep up and down, plus a low rumble
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  windBand = ctx.createBiquadFilter(); windBand.type = 'bandpass'; windBand.Q.value = 6; windBand.frequency.value = 420;
  windBand2 = ctx.createBiquadFilter(); windBand2.type = 'bandpass'; windBand2.Q.value = 12; windBand2.frequency.value = 900;
  windLo = ctx.createBiquadFilter(); windLo.type = 'lowpass'; windLo.frequency.value = 180;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  const g2 = ctx.createGain(), g3 = ctx.createGain();
  g2.gain.value = 0.35; g3.gain.value = 0.7;
  src.connect(windBand); src.connect(windBand2); src.connect(windLo);
  windBand.connect(windGain); windBand2.connect(g2); g2.connect(windGain); windLo.connect(g3); g3.connect(windGain);
  windGain.connect(master); src.start();
  // a cold, slow drone
  droneGain = ctx.createGain(); droneGain.gain.value = 0;
  const dLp = ctx.createBiquadFilter(); dLp.type = 'lowpass'; dLp.frequency.value = 500;
  for (const [f, type] of [[55, 'sine'], [82.4, 'triangle'], [110.3, 'sine'], [164.8, 'sine']]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.08;
    const lg = ctx.createGain(); lg.gain.value = f * 0.004; lfo.connect(lg); lg.connect(o.detune); lfo.start();
    const og = ctx.createGain(); og.gain.value = f > 100 ? 0.05 : 0.11; o.connect(og); og.connect(dLp); o.start();
  }
  dLp.connect(droneGain); droneGain.connect(master);
  fireGain = ctx.createGain(); fireGain.gain.value = 0.12; fireGain.connect(master);
  uiGain = ctx.createGain(); uiGain.connect(master);
  setInterval(crackle, 90);
  loadMusic();
}
function crackle() {
  if (!ctx || Math.random() > 0.35) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 3;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.5, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
  s.connect(f); f.connect(g); g.connect(fireGain); s.start(t, Math.random() * 3); s.stop(t + 0.12);
}
async function loadMusic() {
  try { musicFiles = (await (await fetch('audio/list.json', { cache: 'no-store' })).json()).music?.menu || []; } catch { musicFiles = []; }
  if (!musicFiles.length) return;
  music = new Audio('audio/music/' + encodeURIComponent(musicFiles[Math.random() * musicFiles.length | 0]));
  music.loop = true; music.volume = 0;
  music.play().catch(() => {});
}
export const hasMusic = () => !!music;

// called every frame
let musicV = 0;
export function audioTick(dt) {
  if (!ctx) return;
  const t = ctx.currentTime, g = W.gust;
  master.gain.setTargetAtTime(S.vol, t, 0.1);
  windGain.gain.setTargetAtTime((0.22 + g * 0.55) * S.wind, t, 0.25);
  windBand.frequency.setTargetAtTime(320 + g * 520 + Math.sin(W.t * 0.7) * 60, t, 0.4);
  windBand2.frequency.setTargetAtTime(700 + g * 900 + Math.sin(W.t * 1.3) * 120, t, 0.3);
  droneGain.gain.setTargetAtTime(music ? 0 : 0.5 * S.menuMusic, t, 1.5);
  fireGain.gain.setTargetAtTime(0.1 * S.sfx, t, 0.3);
  uiGain.gain.value = S.ui;
  if (music) { musicV = Math.min(1, musicV + dt / 3); music.volume = Math.min(1, musicV * S.menuMusic * S.vol); }
}

// ---------- UI sounds ----------
function tone(f0, f1, dur, type = 'sine', gain = 0.1, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(uiGain); o.start(t); o.stop(t + dur + 0.05);
}
function hiss(dur, freq, gain, sweep = 1) {
  if (!ctx) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(uiGain); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
export const ui = {
  hover() { tone(2400, 2200, 0.05, 'sine', 0.025); },
  click() { tone(900, 600, 0.08, 'triangle', 0.08); hiss(0.06, 3000, 0.04); },
  open() { hiss(0.45, 500, 0.12, 4); },
  back() { hiss(0.35, 1600, 0.08, 0.3); },
  error() { tone(220, 180, 0.18, 'square', 0.05); tone(180, 150, 0.2, 'square', 0.05, 0.12); },
  good() { [660, 880, 1320].forEach((f, i) => tone(f, 0, 0.3, 'sine', 0.06, i * 0.08)); },
  join() { tone(523, 0, 0.25, 'sine', 0.07); tone(784, 0, 0.35, 'sine', 0.07, 0.1); },
  chat() { tone(1400, 1200, 0.08, 'sine', 0.05); },
};
