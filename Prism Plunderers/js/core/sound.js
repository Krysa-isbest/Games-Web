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

export const uiSfx = {
  hover: () => Sound.tone(1250, 0.03, { vol: 0.035 }),
  click: () => Sound.tone(660, 0.07, { type: 'triangle', vol: 0.12, to: 990 }),
  back: () => Sound.tone(520, 0.08, { type: 'triangle', vol: 0.1, to: 330 }),
  ok: () => { Sound.tone(660, 0.09, { type: 'triangle', vol: 0.12 }); Sound.tone(990, 0.12, { type: 'triangle', vol: 0.12, delay: 0.08 }); },
  error: () => Sound.tone(180, 0.16, { type: 'sawtooth', vol: 0.09, to: 120 }),
};
