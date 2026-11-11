// Audio: one master volume and four channels (music, sfx, ui, ambient), each following its setting.
// Sounds connect to Sound.channel('sfx') and so on. Browsers only allow audio after a click or key press,
// so init() is called from the first one.
import { S } from './save.js';

let ctx = null;
const gains = {};
const CHANNELS = ['music', 'sfx', 'ui', 'ambient'];

export const Sound = {
  get ctx() { return ctx; },
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch { return; }
    gains.master = ctx.createGain();
    gains.master.connect(ctx.destination);
    for (const k of CHANNELS) { gains[k] = ctx.createGain(); gains[k].connect(gains.master); }
    this.apply();
  },
  channel: k => gains[k] || null,
  // call after a volume setting changed
  apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    gains.master.gain.setTargetAtTime(S.vol, t, 0.02);
    for (const k of CHANNELS) gains[k].gain.setTargetAtTime(S[k], t, 0.02);
  },
  // a short synthesized beep. Enough for the interface until real sounds are added.
  tone(freq, dur = 0.08, { type = 'sine', vol = 0.2, to = 0, channel = 'ui', delay = 0 } = {}) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(gains[channel] || gains.ui);
    o.start(t); o.stop(t + dur + 0.02);
  },
};

// filtered white noise: scratches, hisses, thumps
let noiseBuf = null;
Sound.noise = (dur, { freq = 2000, q = 1, vol = 0.1, filter = 'bandpass', to = 0, channel = 'ui', delay = 0 } = {}) => {
  if (!ctx || ctx.state !== 'running') return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf; src.loop = true;
  f.type = filter; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(gains[channel] || gains.ui);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
};

// The menu is made of paper, tape and spray paint, so it sounds like that too.
export const uiSfx = {
  hover: () => Sound.noise(0.06, { freq: 3200, q: 3, vol: 0.05, to: 2200 }),                          // a marker scratch
  click: () => { Sound.tone(150, 0.12, { vol: 0.28, to: 55 }); Sound.noise(0.05, { freq: 1200, q: 1, vol: 0.1 }); },   // a stamp
  back: () => { Sound.tone(110, 0.1, { vol: 0.2, to: 50 }); Sound.noise(0.08, { freq: 700, q: 1, vol: 0.07 }); },
  ok: () => { Sound.tone(180, 0.1, { vol: 0.22, to: 70 }); Sound.noise(0.18, { freq: 5000, filter: 'highpass', vol: 0.05 }); },
  spray: () => Sound.noise(0.55, { freq: 6500, filter: 'highpass', vol: 0.09, to: 4200 }),            // a spray can hiss
  error: () => Sound.tone(180, 0.16, { type: 'sawtooth', vol: 0.09, to: 120 }),
};
