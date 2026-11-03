// Tiny synth sound effects, no audio files needed.
import { S } from './settings.js';

let ctx;
export const audioCtx = () => (ctx ??= new AudioContext());
addEventListener('pointerdown', () => { if (ctx?.state === 'suspended') ctx.resume(); });

// vol multiplies the master volume; pos/listener are not used: game sounds are "2D".
function tone(f, dur, type = 'sine', vol = 0.1, delay = 0, f2, v = 1) {
  if (!S.volume || !v) return;
  const c = audioCtx(), t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol * S.volume * v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf;
function noise(dur, vol = 0.2, freq = 1200, q = 0.7, delay = 0, v = 1) {
  if (!S.volume || !v) return;
  const c = audioCtx();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + delay, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol * S.volume * v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t); src.stop(t + dur + 0.05);
}

export const sfx = {
  click: () => tone(900, 0.04, 'square', 0.03),
  alarm: () => { tone(660, 0.5, 'sawtooth', 0.05, 0, 990); tone(990, 0.5, 'sawtooth', 0.05, 0.5, 660); }, // meltdown siren
  ring: () => { for (let k = 0; k < 2; k++) for (let i = 0; i < 8; i++) tone(i % 2 ? 480 : 440, 0.05, 'square', 0.03, k * 0.6 + i * 0.05); }, // old phone
  machine: () => { tone(1000, 0.35, 'sine', 0.05); }, // answering machine beep
  screech: () => { noise(0.9, 0.25, 2200, 3); tone(1800, 0.8, 'sawtooth', 0.02, 0, 1400); },
  pick: () => tone(520, 0.09, 'triangle', 0.12, 0, 320),
  cash: () => { tone(1500, 0.07, 'square', 0.05); tone(2100, 0.4, 'triangle', 0.1, 0.07); },
  bell: () => { tone(1320, 0.7, 'sine', 0.07); tone(1980, 0.6, 'sine', 0.04, 0.09); },
  bad: () => tone(220, 0.3, 'sawtooth', 0.05, 0, 110),
  thud: (v = 1) => tone(140, 0.25, 'sine', 0.25, 0, 50, v),
  tap: (v = 1) => tone(320, 0.06, 'triangle', 0.12, 0, 160, v),
  swing: () => tone(500, 0.12, 'triangle', 0.06, 0, 150),
  hit: () => { tone(160, 0.12, 'square', 0.12, 0, 60); tone(90, 0.15, 'sine', 0.2); },
  hurt: () => tone(320, 0.25, 'square', 0.08, 0, 120),
  grunt: (v = 1) => tone(110, 0.4, 'sawtooth', 0.07, 0, 70, v),
  snap: () => { tone(1400, 0.08, 'square', 0.1, 0, 300); tone(200, 0.2, 'sawtooth', 0.08, 0.05, 80); },
  boom: () => { tone(90, 1.2, 'sawtooth', 0.35, 0, 25); noise(1, 0.5, 300, 0.5); },
  beep: () => tone(1850, 0.09, 'square', 0.06),
  error: () => { tone(300, 0.12, 'square', 0.06); tone(220, 0.18, 'square', 0.06, 0.12); },
  drawer: () => { noise(0.15, 0.25, 2500, 1); tone(2400, 0.35, 'triangle', 0.08, 0.1); },
  coin: () => tone(2600, 0.12, 'triangle', 0.06, 0, 3000),
  door: () => { noise(0.35, 0.12, 400, 1); tone(180, 0.2, 'sine', 0.12, 0.2, 90); },
  cluck: (v = 1) => { tone(700, 0.06, 'square', 0.04, 0, 500, v); tone(900, 0.08, 'square', 0.04, 0.09, 600, v); },
  bark: (v = 1) => { noise(0.12, 0.35, 700, 2, 0, v); tone(420, 0.12, 'sawtooth', 0.12, 0, 200, v); },
  squeak: (v = 1) => tone(2400, 0.08, 'sine', 0.05, 0, 3200, v),
  shotgun: (v = 1) => { noise(0.6, 0.7, 500, 0.4, 0, v); tone(70, 0.5, 'sine', 0.4, 0, 30, v); },
  pistol: (v = 1) => { noise(0.3, 0.6, 1100, 0.5, 0, v); tone(120, 0.2, 'square', 0.15, 0, 50, v); },
  click2: () => { tone(3000, 0.02, 'square', 0.05); tone(1800, 0.03, 'square', 0.04, 0.05); },
  zap: () => { for (let i = 0; i < 6; i++) tone(rnd(800, 2400), 0.05, 'sawtooth', 0.06, i * 0.04); },
  spray: () => noise(0.7, 0.3, 4000, 0.4),
  squelch: () => { noise(0.18, 0.12, 2500, 0.6); tone(1200, 0.05, 'square', 0.03); },
  ratchet: () => { for (let i = 0; i < 4; i++) noise(0.03, 0.25, 3500, 3, i * 0.06); },
  screw: () => { for (let i = 0; i < 3; i++) tone(1500 + i * 120, 0.03, 'square', 0.03, i * 0.05); },
  gavel: () => { noise(0.08, 0.6, 900, 2); tone(160, 0.2, 'sine', 0.3, 0, 80); },
  egg: () => tone(1200, 0.1, 'sine', 0.06, 0, 1600),
  engine: () => { tone(55, 1.2, 'sawtooth', 0.12, 0, 80); noise(1.2, 0.15, 200, 0.5); },
  drag: () => noise(0.4, 0.2, 250, 0.6),
  hey: () => { tone(260, 0.35, 'sawtooth', 0.09, 0, 180); },
  mop: () => noise(0.25, 0.12, 900 + Math.random() * 400, 0.8),
  glass: (v = 1) => { noise(0.35, 0.4, 5000, 1.5, 0, v); for (let i = 0; i < 4; i++) tone(rnd(2500, 4500), 0.12, 'triangle', 0.05, i * 0.03, undefined, v); },
  slip: () => { tone(900, 0.3, 'sine', 0.06, 0, 200); tone(120, 0.25, 'sine', 0.25, 0.28, 50); },
  breaker: () => { noise(0.08, 0.6, 600, 2); tone(70, 0.3, 'square', 0.15, 0, 40); },
  hum: () => tone(60, 0.6, 'sawtooth', 0.04, 0, 62),
  page: () => noise(0.3, 0.15, 3500, 0.6),
  splash: () => noise(0.4, 0.2, 1400, 0.5),
  ping: () => { tone(1300, 0.08, 'sine', 0.07); tone(1950, 0.15, 'sine', 0.06, 0.08); },
  heart: (v = 1) => { tone(60, 0.12, 'sine', 0.35, 0, 40, v); tone(55, 0.14, 'sine', 0.28, 0.2, 38, v); },
  alert: () => { tone(880, 0.1, 'square', 0.04); tone(660, 0.14, 'square', 0.04, 0.12); },
  spin: () => { for (let i = 0; i < 14; i++) tone(1400, 0.03, 'square', 0.03, i * (0.05 + i * 0.012)); },
  sign: () => { noise(0.5, 0.15, 2500, 0.8); noise(0.3, 0.1, 3200, 0.8, 0.45); },
};
function rnd(a, b) { return a + Math.random() * (b - a); }
