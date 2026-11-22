// Gameplay sounds, synthesized until real recordings are added. Distant sounds get quieter with distance.
import { Sound } from '../core/sound.js';

const near = (d, max = 45) => Math.pow(Math.max(0, 1 - d / max), 1.5);
const T = (f, dur, o) => Sound.tone(f, dur, { channel: 'sfx', ...o });
const N = (dur, o) => Sound.noise(dur, { channel: 'sfx', ...o });

export const Sfx = {
  step(speed, crouch) {
    const v = crouch ? 0.022 : 0.036 + 0.01 * Math.min(speed, 7);
    N(0.07, { freq: 380 + speed * 45, q: 0.8, filter: 'lowpass', vol: v * 1.4 });
    T(70 + Math.random() * 25, 0.06, { vol: v * 1.6, to: 45 });
  },
  jump() { N(0.12, { freq: 900, filter: 'highpass', vol: 0.035 }); T(150, 0.1, { vol: 0.07, to: 110 }); },
  land(power) {
    const v = 0.06 + 0.22 * power;
    T(95, 0.18, { vol: v, to: 42 });
    N(0.14, { freq: 520, filter: 'lowpass', vol: v * 0.7 });
  },
  roll() {
    N(0.42, { freq: 700, q: 0.7, vol: 0.09, to: 260 });
    T(85, 0.12, { vol: 0.12, to: 50, delay: 0.36 });
  },
  slide() { N(0.12, { freq: 1200, q: 0.8, vol: 0.08 }); },
  hurt(amount) {
    const v = Math.min(0.2, 0.06 + amount / 400);
    T(150, 0.14, { type: 'square', vol: v * 0.6, to: 70 });
    N(0.09, { freq: 1300, q: 1, vol: v });
  },
  shieldHit() { T(1500, 0.09, { type: 'triangle', vol: 0.06, to: 950 }); T(2300, 0.06, { vol: 0.035 }); },
  shieldBreak() {
    N(0.5, { freq: 3200, filter: 'highpass', vol: 0.14 });
    T(1200, 0.45, { type: 'sawtooth', vol: 0.05, to: 260 });
    T(600, 0.3, { type: 'triangle', vol: 0.06, to: 150, delay: 0.05 });
  },
  shieldUp() { T(420, 0.18, { type: 'triangle', vol: 0.08, to: 900 }); T(900, 0.25, { vol: 0.05, to: 1400, delay: 0.12 }); },
  heal() { T(660, 0.18, { type: 'triangle', vol: 0.07 }); T(880, 0.26, { type: 'triangle', vol: 0.07, delay: 0.1 }); },
  dodge() { N(0.16, { freq: 2600, q: 1.5, vol: 0.06, to: 1200 }); },
  deny() { T(220, 0.08, { type: 'square', vol: 0.04 }); },
  use() { T(520, 0.05, { type: 'triangle', vol: 0.06 }); },
  death() { T(210, 1.2, { type: 'sawtooth', vol: 0.08, to: 38 }); N(0.6, { freq: 400, filter: 'lowpass', vol: 0.12 }); },
  heartbeat() { T(58, 0.12, { vol: 0.2, to: 40 }); T(54, 0.12, { vol: 0.14, to: 38, delay: 0.2 }); },
  sentryLock(d) { const v = near(d); if (v > 0) T(600, 0.9, { vol: 0.06 * v, to: 1500 }); },
  sentryFire(d) { const v = near(d, 60); if (v > 0) { N(0.16, { freq: 2400, q: 1, vol: 0.12 * v }); T(900, 0.18, { type: 'square', vol: 0.04 * v, to: 280 }); } },
  boltHit(d) { const v = near(d); if (v > 0) N(0.12, { freq: 1700, q: 1.2, vol: 0.1 * v }); },

  // weapons and hit confirmation
  shot(model) {
    if (model === 'carbine') {                         // the Prism coil: a crack with a zap in it
      N(0.06, { freq: 2400, q: 0.9, vol: 0.1 }); T(560, 0.09, { type: 'sawtooth', vol: 0.045, to: 140 }); N(0.12, { freq: 600, filter: 'lowpass', vol: 0.07 });
    } else {
      N(0.09, { freq: 1500, q: 0.6, vol: 0.15 }); T(160, 0.08, { type: 'square', vol: 0.07, to: 60 }); N(0.2, { freq: 420, filter: 'lowpass', vol: 0.1 });
    }
  },
  dry() { T(1800, 0.02, { type: 'square', vol: 0.05 }); T(1200, 0.02, { type: 'square', vol: 0.03, delay: 0.03 }); },
  magOut() { T(320, 0.05, { type: 'square', vol: 0.05, to: 200 }); N(0.05, { freq: 2200, q: 2, vol: 0.05 }); },
  magIn() { T(240, 0.04, { type: 'square', vol: 0.07 }); N(0.04, { freq: 3000, q: 2, vol: 0.06, delay: 0.03 }); },
  rack() { N(0.06, { freq: 2600, q: 1.5, vol: 0.06 }); T(900, 0.04, { type: 'square', vol: 0.04, delay: 0.06 }); },
  draw() { N(0.07, { freq: 1600, q: 1.2, vol: 0.035 }); T(500, 0.04, { type: 'triangle', vol: 0.03, delay: 0.04 }); },
  swing() { N(0.22, { freq: 900, q: 0.8, vol: 0.07, to: 300 }); },
  thunk() { T(130, 0.1, { type: 'square', vol: 0.12, to: 60 }); N(0.08, { freq: 1800, q: 1, vol: 0.1 }); },
  pin() { T(2800, 0.04, { type: 'triangle', vol: 0.05 }); T(2200, 0.06, { type: 'triangle', vol: 0.04, delay: 0.05 }); },
  toss() { N(0.18, { freq: 1100, q: 0.8, vol: 0.06, to: 500 }); },
  pickup() { T(700, 0.05, { type: 'triangle', vol: 0.06 }); T(1050, 0.08, { type: 'triangle', vol: 0.05, delay: 0.05 }); },
  rustle() { N(0.25, { freq: 1500, q: 0.7, vol: 0.035 }); },
  hit(kind) {
    if (kind === 'kill') { T(900, 0.08, { type: 'triangle', vol: 0.12 }); T(1350, 0.14, { type: 'triangle', vol: 0.1, delay: 0.06 }); }
    else T(kind === 'weak' ? 1500 : 1100, 0.04, { type: 'triangle', vol: kind === 'weak' ? 0.09 : 0.05 });
  },

  // the Prism: name -> sound, d = distance from the player
  robot(name, d, extra) {
    const f = ROBOT[name];
    if (!f) return;
    const far = name === 'boom_big' || name === 'pod' || name === 'mini' ? 90 : name === 'boom' || name === 'rocket' || name === 'beacon' ? 60 : 40;
    const v = near(d, far);
    if (v > 0.001) f(v, extra);
  },
};

const ROBOT = {
  alert: v => { T(700, 0.08, { type: 'square', vol: 0.05 * v }); T(1050, 0.12, { type: 'square', vol: 0.05 * v, delay: 0.09 }); },
  scan: (v, k = 0) => T(500 + k * 900, 0.12, { vol: 0.07 * v, to: 600 + k * 1000 }),
  call: v => { for (let i = 0; i < 3; i++) T(1200, 0.12, { type: 'sawtooth', vol: 0.06 * v, to: 800, delay: i * 0.18 }); },
  beacon: v => { T(1500, 0.18, { vol: 0.08 * v, to: 900 }); T(1500, 0.18, { vol: 0.05 * v, to: 900, delay: 0.25 }); },
  pod: v => { N(1.6, { freq: 300, q: 0.6, vol: 0.14 * v, to: 1800 }); T(90, 1.4, { type: 'sawtooth', vol: 0.05 * v, to: 300 }); },
  lock_fly: v => T(900, 3, { vol: 0.035 * v, to: 1500 }),
  lock_swatter: v => T(420, 4, { type: 'triangle', vol: 0.05 * v, to: 900 }),
  bolt: v => T(1300, 0.09, { type: 'triangle', vol: 0.08 * v, to: 420 }),
  mini: v => { N(0.05, { freq: 2200, q: 0.8, vol: 0.09 * v }); T(170, 0.04, { type: 'square', vol: 0.04 * v, to: 90 }); },
  overheat: v => { N(1.4, { freq: 4000, filter: 'highpass', vol: 0.1 * v, to: 1500 }); T(800, 0.5, { type: 'sawtooth', vol: 0.03 * v, to: 200 }); },
  chitter: v => { for (let i = 0; i < 6; i++) N(0.04, { freq: 3000 + i * 300, q: 3, vol: 0.07 * v, delay: i * 0.08 }); T(300, 1, { type: 'square', vol: 0.025 * v, to: 900 }); },
  jump: v => { N(0.2, { freq: 1500, q: 1, vol: 0.09 * v, to: 600 }); T(500, 0.2, { type: 'square', vol: 0.04 * v, to: 1200 }); },
  stick: v => { T(200, 0.08, { type: 'square', vol: 0.1 * v }); N(0.06, { freq: 900, vol: 0.1 * v }); },
  beep: v => T(2200, 0.04, { type: 'square', vol: 0.07 * v }),
  land_scatter: v => N(0.08, { freq: 700, filter: 'lowpass', vol: 0.08 * v }),
  cluster: v => { T(1400, 0.1, { type: 'square', vol: 0.06 * v }); N(0.1, { freq: 2600, vol: 0.06 * v }); },
  pop: v => { N(0.18, { freq: 900, q: 0.8, vol: 0.16 * v }); T(120, 0.16, { vol: 0.15 * v, to: 50 }); },
  boom: v => { N(0.7, { freq: 600, filter: 'lowpass', vol: 0.3 * v, to: 120 }); T(80, 0.5, { vol: 0.3 * v, to: 30 }); N(0.2, { freq: 2500, vol: 0.08 * v }); },
  boom_big: v => { N(1.6, { freq: 500, filter: 'lowpass', vol: 0.4 * v, to: 80 }); T(60, 1.2, { vol: 0.4 * v, to: 25 }); N(0.4, { freq: 2000, vol: 0.12 * v }); },
  charge: v => { T(110, 3, { type: 'sawtooth', vol: 0.05 * v, to: 520 }); N(3, { freq: 400, q: 2, vol: 0.03 * v, to: 2400 }); },
  beam_on: v => { N(5, { freq: 900, q: 1.5, vol: 0.09 * v, to: 1100 }); T(240, 5, { type: 'sawtooth', vol: 0.05 * v, to: 260 }); },
  beam_off: v => T(400, 0.3, { type: 'sawtooth', vol: 0.05 * v, to: 80 }),
  stomp_warn: v => { T(80, 1.9, { type: 'sawtooth', vol: 0.07 * v, to: 160 }); for (let i = 0; i < 4; i++) T(600, 0.08, { type: 'square', vol: 0.05 * v, delay: i * 0.45 }); },
  takeoff: v => { N(1.8, { freq: 200, q: 0.8, vol: 0.16 * v, to: 900 }); T(70, 1.8, { type: 'sawtooth', vol: 0.06 * v, to: 140 }); },
  hatch: v => { T(300, 0.3, { type: 'square', vol: 0.05 * v, to: 150 }); N(0.3, { freq: 1200, vol: 0.05 * v }); },
  rocket: v => { T(160, 0.25, { vol: 0.2 * v, to: 60 }); N(0.5, { freq: 1800, q: 0.7, vol: 0.1 * v, to: 600 }); },
  emp: v => { T(1800, 0.6, { type: 'sawtooth', vol: 0.08 * v, to: 60 }); N(0.5, { freq: 3500, filter: 'highpass', vol: 0.08 * v }); },
  loot: v => { T(880, 0.08, { type: 'triangle', vol: 0.07 * v }); T(1320, 0.12, { type: 'triangle', vol: 0.07 * v, delay: 0.07 }); },
  break: v => { N(0.25, { freq: 1600, q: 0.6, vol: 0.14 * v }); T(500, 0.3, { type: 'square', vol: 0.05 * v, to: 90 }); },
  clink: v => { T(2600, 0.05, { type: 'triangle', vol: 0.06 * v, to: 2100 }); N(0.03, { freq: 4200, q: 2, vol: 0.04 * v }); },
};
