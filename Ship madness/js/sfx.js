// Synthesised sound effects (no audio files) + sea ambience. Positional sounds fade with distance.
// Gunshots are layered: a sharp crack, a noise body, a low thump and an echo tail.
import { G, S } from './state.js';

let ctx = null, master, filt, noiseBuf, amb, echo, echoGain;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 20000;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master = ctx.createGain(); master.gain.value = S.vol;
  filt.connect(comp); comp.connect(master); master.connect(ctx.destination);
  // echo bus (open sea slap-back)
  echo = ctx.createDelay(1); echo.delayTime.value = 0.23;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const eLp = ctx.createBiquadFilter(); eLp.type = 'lowpass'; eLp.frequency.value = 1800;
  echoGain = ctx.createGain(); echoGain.gain.value = 0.35;
  echoGain.connect(echo); echo.connect(eLp); eLp.connect(fb); fb.connect(echo); eLp.connect(filt);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  amb = ctx.createGain(); amb.gain.value = 0.12;
  src.connect(lp); lp.connect(amb); amb.connect(filt); src.start();
}
export function setVolume(v) { if (master) master.gain.value = v; }

export function audioTick(underwater) {
  if (!ctx) return;
  filt.frequency.setTargetAtTime(underwater ? 500 : 20000, ctx.currentTime, 0.08);
  amb.gain.setTargetAtTime((0.08 + 0.06 * Math.sin(G.t * 0.45) ** 2) * (0.6 + G.seaAmp * 0.5) * S.ambVol, ctx.currentTime, 0.3);
}

function vol(pos) {
  if (!pos || !G.camera) return 1;
  return 1 / (1 + G.camera.position.distanceTo(pos) / 18);
}

function noise({ dur = 0.3, freq = 1000, q = 1, type = 'lowpass', gain = 0.5, sweep = 0, pos = null, attack = 0.002, wet = 0, delay = 0 }) {
  if (!ctx) return;
  const g0 = gain * vol(pos) * S.sfxVol;
  if (g0 < 0.008) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweep) f.frequency.setValueAtTime(freq, t), f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(g0, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(filt);
  if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(echoGain); }
  src.start(t, Math.random() * Math.max(0, 1.9 - dur)); src.stop(t + dur + 0.05);
}
function tone({ f0 = 440, f1 = 0, dur = 0.2, type = 'sine', gain = 0.3, pos = null, delay = 0, wet = 0 }) {
  if (!ctx) return;
  const g0 = gain * vol(pos) * S.sfxVol;
  if (g0 < 0.008) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(filt);
  if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(echoGain); }
  o.start(t); o.stop(t + dur + 0.05);
}

// [crack freq, body freq, body length, thump freq, loudness]
const GUN = {
  pistol: [4200, 2600, 0.16, 110, 0.55], revolver: [3600, 1700, 0.3, 80, 0.85], smg: [4800, 3000, 0.11, 130, 0.45],
  ak: [3800, 2100, 0.2, 95, 0.7], lmg: [3400, 1800, 0.22, 85, 0.75], shotgun: [3000, 1300, 0.38, 70, 0.95], sniper: [3000, 1500, 0.55, 60, 1],
};
export const sfx = {
  shot(kind, pos, suppressed = false) {
    const [cr, body, len, th, loud] = GUN[kind] || GUN.pistol;
    if (suppressed) { noise({ dur: 0.09, freq: 1400, q: 0.8, gain: loud * 0.35, pos }); tone({ f0: th * 1.5, f1: th, dur: 0.06, gain: 0.15, pos }); return; }
    noise({ dur: 0.03, freq: cr, q: 0.7, type: 'highpass', gain: loud * 0.7, pos });
    noise({ dur: len, freq: body, sweep: 0.25, gain: loud, pos, wet: 0.5 });
    tone({ f0: th * 2, f1: th * 0.5, dur: len * 0.9, gain: loud * 0.7, pos });
  },
  empty() { tone({ f0: 1800, dur: 0.04, type: 'square', gain: 0.08 }); },
  reload(step = 0) { tone({ f0: step ? 520 : 760, dur: 0.05, type: 'square', gain: 0.07 }); noise({ dur: 0.05, freq: 3000, q: 4, type: 'bandpass', gain: 0.2 }); },
  pump() { noise({ dur: 0.08, freq: 1800, q: 3, type: 'bandpass', gain: 0.4 }); noise({ dur: 0.08, freq: 1200, q: 3, type: 'bandpass', gain: 0.4, delay: 0.14 }); },
  cannon(pos) { noise({ dur: 0.05, freq: 2500, type: 'highpass', gain: 0.8, pos }); noise({ dur: 1.3, freq: 900, sweep: 0.08, gain: 1, pos, wet: 0.7 }); tone({ f0: 80, f1: 26, dur: 0.9, gain: 0.9, pos }); },
  boom(pos, big = 1) { noise({ dur: 1.3 + big * 0.7, freq: 1500, sweep: 0.05, gain: Math.min(1.2, 0.7 + big * 0.2), pos, wet: 0.6 }); tone({ f0: 65, f1: 20, dur: 1.1 + big * 0.5, gain: 0.95, pos }); },
  wood(pos) { noise({ dur: 0.1, freq: 800, q: 3, type: 'bandpass', gain: 0.45, pos }); tone({ f0: 240, f1: 160, dur: 0.06, gain: 0.15, pos }); },
  hit(head) { tone({ f0: head ? 1900 : 1300, dur: 0.05, type: 'triangle', gain: 0.16 }); },
  hurt() { noise({ dur: 0.2, freq: 500, gain: 0.4 }); },
  splash(pos, size = 1) { noise({ dur: 0.4 + size * 0.35, freq: 1800, sweep: 0.3, gain: Math.min(0.8, 0.25 + size * 0.2), pos, attack: 0.02 }); },
  hammer(pos) { for (let i = 0; i < 3; i++) noise({ dur: 0.07, freq: 1300, q: 4, type: 'bandpass', gain: 0.6, pos, delay: i * 0.14 }); },
  pickup() { tone({ f0: 660, dur: 0.08, type: 'triangle', gain: 0.2 }); tone({ f0: 990, dur: 0.1, type: 'triangle', gain: 0.2, delay: 0.07 }); },
  coin() { tone({ f0: 1320, dur: 0.12, type: 'triangle', gain: 0.18 }); tone({ f0: 1760, dur: 0.18, type: 'triangle', gain: 0.18, delay: 0.08 }); },
  levelup() { [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: 0.25, type: 'triangle', gain: 0.22, delay: i * 0.1 })); },
  bite(pos) { noise({ dur: 0.18, freq: 400, q: 2, type: 'bandpass', gain: 0.7, pos }); },
  crane() { tone({ f0: 160, f1: 150, dur: 0.15, type: 'sawtooth', gain: 0.04 }); },
  bell() { tone({ f0: 880, dur: 1.2, gain: 0.25 }); tone({ f0: 1320, dur: 0.9, gain: 0.12 }); },
  horn() { tone({ f0: 110, dur: 1.6, type: 'sawtooth', gain: 0.18 }); tone({ f0: 165, dur: 1.6, type: 'sawtooth', gain: 0.12 }); },
  siren() { for (let i = 0; i < 3; i++) { tone({ f0: 500, f1: 900, dur: 0.6, type: 'sawtooth', gain: 0.18, delay: i * 1.2 }); tone({ f0: 900, f1: 500, dur: 0.6, type: 'sawtooth', gain: 0.18, delay: i * 1.2 + 0.6 }); } },
  jet() { noise({ dur: 2.5, freq: 3000, sweep: 0.2, gain: 0.5, attack: 0.8 }); },
  crash(pos) { noise({ dur: 0.7, freq: 600, sweep: 0.3, gain: 0.8, pos }); tone({ f0: 70, f1: 40, dur: 0.5, gain: 0.5, pos }); },
  thunder() { noise({ dur: 3, freq: 400, sweep: 0.3, gain: 0.9, attack: 0.05, wet: 0.6 }); },
  click() { tone({ f0: 1200, dur: 0.03, type: 'triangle', gain: 0.06 }); },
  hover() { tone({ f0: 1800, dur: 0.02, type: 'sine', gain: 0.025 }); },
  whoosh() { noise({ dur: 0.35, freq: 900, q: 0.8, type: 'bandpass', sweep: 3, gain: 0.12, attack: 0.08 }); },
  crackle(pos) { noise({ dur: 0.05, freq: 3000, q: 2, type: 'bandpass', gain: 0.2, pos }); },
  bounce(pos) { tone({ f0: 900, f1: 700, dur: 0.05, type: 'triangle', gain: 0.2, pos }); },
};
