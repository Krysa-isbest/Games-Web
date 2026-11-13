// Whiteout: small in-game sounds made on the spot: footsteps in snow, on ice, on the shack's boards and on
// metal, and landing after a jump. They go through the menu's master volume and the Effects slider.
import { S } from './state.js';
import { audioCtx, audioOut } from './audio.js';

let noise = null, bus = null;
function ready() {
  const ctx = audioCtx();
  if (!ctx) return null;
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (!bus) { bus = ctx.createGain(); bus.connect(audioOut()); }
  bus.gain.value = S.sfx;
  return ctx;
}
// a sound some way off (your crew chopping, a tree coming down): quieter with distance, silent past 45 m
let FAR = 1;
export function at(dist, fn, ...args) {
  const v = Math.max(0, 1 - dist / 45);
  if (v < 0.03 || typeof fn !== 'function') return;
  FAR = v * v;
  try { fn(...args); } finally { FAR = 1; }
}
// a short burst of filtered noise
function burst(ctx, t, type, freq, q, vol, atk, dec) {
  vol *= FAR;
  const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.8); s.stop(t + atk + dec + 0.05);
}
// a low thump
function thud(ctx, t, f0, f1, vol, dur) {
  vol *= FAR;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}

// loud: 1.25 sprinting, 0.85 walking, 0.45 crouched or walking slowly; depth: how deep the snow is (0..1)
export function step(surface, loud, depth = 0) {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime, v = 0.16 * loud, r = 0.85 + Math.random() * 0.3;
  if (surface === 'snow') {         // a crunch, then the snow packing down under the boot
    burst(ctx, t, 'bandpass', 900 * r, 1.1, v * (1 + depth * 0.6), 0.008, 0.11 + depth * 0.08);
    burst(ctx, t + 0.045, 'bandpass', 420 * r, 1.4, v * 0.7, 0.01, 0.12);
    burst(ctx, t, 'highpass', 4200, 0.7, v * 0.25, 0.004, 0.05);
  } else if (surface === 'ice') {
    burst(ctx, t, 'bandpass', 2600 * r, 3, v * 0.6, 0.002, 0.04); thud(ctx, t, 150, 70, v * 0.8, 0.07);
  } else if (surface === 'wood') {
    thud(ctx, t, 120 * r, 55, v * 1.6, 0.11); burst(ctx, t, 'bandpass', 700 * r, 2, v * 0.4, 0.004, 0.05);
  } else {
    burst(ctx, t, 'bandpass', 1700 * r, 4, v * 0.6, 0.002, 0.06); thud(ctx, t, 180, 90, v, 0.06);
  }
}
// coughing in the smoke
export function cough(v = 1) {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [o, g] of [[0, 0.2], [0.28, 0.14], [0.52, 0.09]]) { burst(ctx, t + o, 'bandpass', 480 + Math.random() * 120, 1.2, g * v, 0.01, 0.16); thud(ctx, t + o, 140, 80, g * v * 0.5, 0.12); }
}
// picking something up
export function grab() {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  burst(ctx, t, 'bandpass', 1400, 1.5, 0.12, 0.01, 0.12); thud(ctx, t + 0.05, 160, 90, 0.12, 0.08);
}
// step 3: the axe, the stove, the hammer, the lighter, the door
const once = fn => (...a) => { const ctx = ready(); if (ctx) fn(ctx, ctx.currentTime, ...a); };
export const chop = once((ctx, t) => { thud(ctx, t, 190, 70, 0.32, 0.12); burst(ctx, t, 'bandpass', 1300, 2, 0.22, 0.003, 0.08); burst(ctx, t + 0.02, 'bandpass', 600, 1.5, 0.12, 0.005, 0.12); });
export const whoosh = once((ctx, t) => burst(ctx, t + 0.12, 'bandpass', 900, 0.8, 0.06, 0.08, 0.12));
export const clank = once((ctx, t) => { burst(ctx, t, 'bandpass', 3200, 6, 0.12, 0.002, 0.15); thud(ctx, t, 300, 160, 0.1, 0.06); });
export const fall = once((ctx, t, v = 1) => {
  for (let i = 0; i < 6; i++) burst(ctx, t + i * 0.09, 'bandpass', 1800 - i * 150, 3, 0.1 * v, 0.004, 0.05);    // the crack
  thud(ctx, t + 1.4 * v, 70, 30, 0.5 * v, 0.6); burst(ctx, t + 1.4 * v, 'lowpass', 500, 0.7, 0.3 * v, 0.02, 0.8);   // the crash
});
export const hammer = once((ctx, t) => { for (let i = 0; i < 3; i++) { thud(ctx, t + i * 0.28, 260, 120, 0.22, 0.06); burst(ctx, t + i * 0.28, 'bandpass', 2600, 5, 0.08, 0.002, 0.05); } });
export const pack = once((ctx, t) => { for (let i = 0; i < 3; i++) burst(ctx, t + i * 0.3, 'bandpass', 700, 1, 0.14, 0.02, 0.18); });
export const ignite = once((ctx, t) => { burst(ctx, t, 'highpass', 3000, 0.7, 0.05, 0.002, 0.04); burst(ctx, t + 0.1, 'bandpass', 500, 0.8, 0.2, 0.25, 0.9); });
export const flick = once((ctx, t) => { burst(ctx, t, 'highpass', 4000, 0.7, 0.08, 0.002, 0.03); burst(ctx, t + 0.04, 'bandpass', 900, 0.8, 0.04, 0.05, 0.2); });
export const grind = once((ctx, t) => { burst(ctx, t, 'bandpass', 3800, 3, 0.07, 0.04, 0.22); burst(ctx, t + 0.05, 'highpass', 5000, 0.7, 0.03, 0.05, 0.18); });
export const page = once((ctx, t) => { burst(ctx, t, 'bandpass', 2400, 0.7, 0.07, 0.03, 0.18); burst(ctx, t + 0.06, 'highpass', 4000, 0.7, 0.03, 0.02, 0.1); });
// food and water
export const munch = once((ctx, t) => { for (let i = 0; i < 3; i++) burst(ctx, t + i * 0.16, 'bandpass', 1400 + Math.random() * 600, 2, 0.08, 0.01, 0.06); });
export const drink = once((ctx, t) => { for (let i = 0; i < 3; i++) { thud(ctx, t + i * 0.3, 220, 140, 0.1, 0.12); burst(ctx, t + i * 0.3, 'bandpass', 700, 3, 0.05, 0.02, 0.1); } });
export const sizzle = once((ctx, t) => { burst(ctx, t, 'highpass', 3500, 0.7, 0.06, 0.2, 1.2); burst(ctx, t + 0.3, 'bandpass', 5000, 1, 0.04, 0.2, 0.8); });
export const splash = once((ctx, t) => { burst(ctx, t, 'bandpass', 900, 0.8, 0.14, 0.01, 0.35); burst(ctx, t + 0.05, 'highpass', 2500, 0.7, 0.06, 0.02, 0.3); });
export const reel = once((ctx, t) => burst(ctx, t, 'bandpass', 3200, 8, 0.05, 0.002, 0.03));
export const door = once((ctx, t) => { thud(ctx, t, 110, 60, 0.25, 0.15); burst(ctx, t, 'bandpass', 400, 6, 0.06, 0.05, 0.3); });
// step 6: thin ice, the water, being downed, sleeping, the ghost roulette
export const creak = once((ctx, t, v = 1) => {          // the ice groaning under you: a low, slowly bending tone
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(55 + Math.random() * 25, t); o.frequency.exponentialRampToValueAtTime(30 + Math.random() * 15, t + 0.9);
  f.type = 'bandpass'; f.frequency.value = 260; f.Q.value = 6;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.12 * v * FAR), t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
  o.connect(f); f.connect(g); g.connect(bus); o.start(t); o.stop(t + 1.05);
  burst(ctx, t + 0.3, 'bandpass', 3800, 6, 0.04 * v, 0.002, 0.05);
});
export const crack = once((ctx, t) => {                  // the ice gives way
  for (let i = 0; i < 9; i++) burst(ctx, t + i * 0.035 + Math.random() * 0.02, 'bandpass', 2600 - i * 180, 4, 0.18, 0.002, 0.05);
  thud(ctx, t + 0.3, 90, 35, 0.5, 0.5); burst(ctx, t + 0.32, 'bandpass', 700, 0.7, 0.35, 0.01, 0.7); burst(ctx, t + 0.4, 'highpass', 2500, 0.7, 0.12, 0.02, 0.5);
});
export const gasp = once((ctx, t, v = 1) => { burst(ctx, t, 'bandpass', 1100, 1.6, 0.16 * v, 0.06, 0.22); burst(ctx, t + 0.02, 'bandpass', 2400, 2, 0.05 * v, 0.05, 0.15); });
export const beat = once((ctx, t, v = 1) => { thud(ctx, t, 60, 40, 0.25 * v, 0.12); thud(ctx, t + 0.22, 55, 38, 0.18 * v, 0.12); });
export const alarm = once(ctx => { const t = ctx.currentTime; for (let i = 0; i < 4; i++) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t + i * 0.25); g.gain.exponentialRampToValueAtTime(0.06, t + i * 0.25 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 0.15); o.connect(g); g.connect(bus); o.start(t + i * 0.25); o.stop(t + i * 0.25 + 0.2); } });
export const spin = once((ctx, t) => { for (let i = 0; i < 26; i++) burst(ctx, t + 2 * (1 - Math.pow(1 - i / 26, 1.6)), 'bandpass', 3400, 7, 0.05, 0.002, 0.025); });
export const cash = once((ctx, t) => { for (const [f, d] of [[988, 0], [1319, 0.09], [1976, 0.18]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35); o.connect(g); g.connect(bus); o.start(t + d); o.stop(t + d + 0.4); } });
export const nope = once((ctx, t) => thud(ctx, t, 180, 90, 0.12, 0.25));
export function land(speed, surface) {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime, v = Math.min(0.5, 0.05 + speed * 0.025);
  thud(ctx, t, 110, 45, v, 0.16);
  burst(ctx, t, 'bandpass', surface === 'snow' ? 700 : 1500, 1, v * 0.7, 0.005, surface === 'snow' ? 0.2 : 0.08);
}
