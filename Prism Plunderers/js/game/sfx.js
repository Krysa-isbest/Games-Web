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
};
