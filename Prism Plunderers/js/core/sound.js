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

// Short, dry interface sounds: a soft tick on hover, a click with a little body, a whoosh when the menu opens.
export const uiSfx = {
  hover: () => Sound.noise(0.03, { freq: 4200, q: 2, vol: 0.035 }),
  click: () => { Sound.noise(0.04, { freq: 2600, q: 1.2, vol: 0.09 }); Sound.tone(240, 0.08, { vol: 0.16, to: 120 }); },
  back: () => { Sound.noise(0.04, { freq: 1600, q: 1.2, vol: 0.07 }); Sound.tone(180, 0.08, { vol: 0.12, to: 90 }); },
  ok: () => { Sound.tone(520, 0.08, { type: 'triangle', vol: 0.1 }); Sound.tone(780, 0.12, { type: 'triangle', vol: 0.1, delay: 0.07 }); },
  whoosh: () => { Sound.noise(0.7, { freq: 300, q: 0.8, vol: 0.12, to: 2400 }); Sound.tone(70, 0.6, { vol: 0.18, to: 45 }); },
  error: () => Sound.tone(180, 0.16, { type: 'sawtooth', vol: 0.09, to: 120 }),
};
