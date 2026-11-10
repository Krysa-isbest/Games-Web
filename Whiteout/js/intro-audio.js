// Whiteout: the sound of the opening cutscene. A synthesized 90-second score that follows the picture:
//   0–28 s   the cabin: warm pads, a slow piano tune and a music-box ripple, cut off by the power failure
//  29–40 s   the turbulence: a drone that opens up, a heartbeat that speeds up, strings swelling to the crash
//  40–50 s   silence after the crash, only ringing ears and a heartbeat
//  50–66 s   waking up: a cold, sparse lament
//  66–86 s   the radio: only a low drone
//  86–90 s   the fire spreads: a last swell and a low hit
// Plus every sound effect. Everything is scheduled on the Web Audio clock from one start time, so it stays
// locked to the picture. Your own song: put it in audio/music and list it in audio/list.json under "intro";
// it then plays instead of the synthesized score (the sound effects stay).
import { S, rand } from './state.js';
import { audioCtx, audioOut } from './audio.js';

// the timeline, in seconds (the cutscene uses it too)
export const TL = { bump: 20, ding: 23.5, cut: 28.2, alarm: 30, masks: 31.5, slide: 33, shatter: 34, crash: 40, ring: 42.6, wake: 50,
  radioIn: 66.5, stand: 68.5, ptt: 73, auto: 79.5, reply: 83, dead: 85.5, getOut: 86.5, end: 90 };

let ctx = null, t0 = 0, bus = null, mus = null, musLp = null, sfx = null, wind = null, noise = null, nodes = [], song = null, songList = null, tx = null;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const T = s => t0 + s;

// the list of your own intro songs (read once)
export async function prepare() {
  if (songList) return;
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 1500);
    songList = (await (await fetch('audio/list.json', { cache: 'no-store', signal: ctl.signal })).json()).music?.intro || [];
    clearTimeout(to);
  } catch { songList = []; }
}

// starts everything; returns the start time on the audio clock (or null without sound)
export function start({ friends = 0 } = {}) {
  ctx = audioCtx();
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume();
  nodes = []; tx = null;
  t0 = ctx.currentTime + 0.15;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  comp.connect(audioOut());
  bus = gain(1, comp);
  musLp = filt('lowpass', 20000, 0.5, bus);
  mus = gain(S.music, musLp);
  const verb = ctx.createConvolver(); verb.buffer = impulse(3.2); mus.connect(verb); verb.connect(gain(0.45, musLp));
  sfx = gain(S.sfx, bus);
  wind = gain(S.wind, bus);
  noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (songList?.length) {
    song = new Audio('audio/music/' + encodeURIComponent(songList[Math.random() * songList.length | 0]));
    song.volume = Math.min(1, S.music * S.vol);
    setTimeout(() => song?.play().catch(() => {}), 150);
  } else score();
  effects(friends);
  return t0;
}
// seconds into the cutscene, or null when there is no sound
export const clock = () => (ctx && bus ? ctx.currentTime - t0 : null);

export function stop(fade = 1) {
  if (!ctx || !bus) return;
  const b = bus, list = nodes, s = song, now = ctx.currentTime;
  b.gain.cancelScheduledValues(now); b.gain.setValueAtTime(b.gain.value, now); b.gain.linearRampToValueAtTime(0, now + fade);
  if (s) { const v0 = s.volume; let k = 0; const iv = setInterval(() => { k += 0.05 / fade; s.volume = Math.max(0, v0 * (1 - k)); if (k >= 1) { clearInterval(iv); s.pause(); } }, 50); }
  setTimeout(() => { for (const n of list) { try { n.stop(); } catch { /* already stopped */ } } try { b.disconnect(); } catch { /* gone */ } }, fade * 1000 + 150);
  bus = null; song = null; nodes = []; tx = null;
}

// ---------- building blocks ----------
function gain(v, to) { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
function filt(type, f, Q = 0.7, to) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; if (to) b.connect(to); return b; }
function shaper(drive, to) {
  const w = ctx.createWaveShaper(), c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  w.curve = c; if (to) w.connect(to); return w;
}
// an oscillator from a to b (audio-clock times). "tape" notes still sounding at the power cut slow down and die.
function osc(type, f, a, b, to, tape = false) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, a);
  const cut = T(TL.cut);
  if (tape && a < cut && b > cut) { o.frequency.setValueAtTime(f, cut); o.frequency.exponentialRampToValueAtTime(f * 0.22, cut + 0.75); b = cut + 0.78; }
  if (to) o.connect(to); o.start(a); o.stop(b); nodes.push(o); return o;
}
function noiseSrc(a, b, to) { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; if (to) s.connect(to); s.start(a, Math.random() * 2.5); s.stop(b); nodes.push(s); return s; }
function env(g, a, atk, peak, hold, rel) {
  g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(peak, a + atk);
  g.gain.setValueAtTime(peak, a + atk + hold); g.gain.exponentialRampToValueAtTime(0.0001, a + atk + hold + rel);
}
function impulse(sec) {
  const n = ctx.sampleRate * sec | 0, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
  return b;
}

// ---------- instruments (s = seconds into the cutscene) ----------
function piano(s, m, dur, v = 0.08) {
  const a = T(s), f = mtof(m), end = a + dur + 2.4, g = gain(0, mus);
  g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(v, a + 0.006); g.gain.exponentialRampToValueAtTime(v * 0.3, a + 0.55);
  g.gain.setTargetAtTime(0.0001, a + dur, 0.5);
  const lp = filt('lowpass', Math.min(16000, f * 7), 0.5, g); lp.frequency.setTargetAtTime(f * 2.2, a + 0.05, 0.6);
  for (const [k, type, amp] of [[1, 'triangle', 0.9], [1.0028, 'sine', 0.5], [2, 'sine', 0.22], [3.01, 'sine', 0.08]]) osc(type, f * k, a, end, gain(amp, lp), true);
}
function bell(s, m, v = 0.02) {
  const a = T(s), f = mtof(m), g = gain(0, mus);
  env(g, a, 0.004, v, 0, 1.4);
  osc('sine', f, a, a + 1.5, g, true); osc('sine', f * 4.01, a, a + 0.5, gain(0.12, g), true);
}
function pad(s, notes, dur, v = 0.02, { atk = 1.2, rel = 1.6, cut = 1400, type = 'sawtooth', tape = true } = {}) {
  const a = T(s), g = gain(0, mus), lp = filt('lowpass', cut, 0.6, g);
  g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(v, a + atk);
  g.gain.setValueAtTime(v, a + Math.max(atk, dur - 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, a + Math.max(atk, dur) + rel);
  for (const m of notes) for (const d of [-7, 6]) { const o = osc(type, mtof(m), a, a + Math.max(atk, dur) + rel + 0.05, lp, tape); o.detune.value = d; }
  return { g, lp };
}
function thump(s, v = 0.5, f0 = 90, f1 = 38, d = 0.35, to = mus) {
  const a = T(s), g = gain(0, to); env(g, a, 0.004, v, 0.02, d);
  const o = osc('sine', f0, a, a + d + 0.1, g); o.frequency.exponentialRampToValueAtTime(f1, a + d);
}

// ---------- the score ----------
function score() {
  const B = 60 / 70;                                               // one beat at 70 bpm
  // 1. the cabin: Am9 – Fmaj7 – Cadd9 – G6, two bars each
  const CH = [[45, 52, 55, 59, 60], [41, 48, 52, 57, 64], [48, 55, 62, 64, 67], [43, 50, 59, 62, 64]];
  CH.forEach((c, i) => { pad(i * 8 * B, c, 8 * B + (i === 3 ? 1.2 : 0.4), 0.02, { atk: i ? 0.6 : 3, rel: 1.2, cut: 1100 }); piano(i * 8 * B, c[0], 7.5 * B, 0.07); });
  const MEL = [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 71, 1], [4, 69, 3],
    [8, 69, 1], [9, 72, 1], [10, 77, 2], [12, 76, 1.5], [13.5, 72, 0.5], [14, 74, 2],
    [16, 76, 1.5], [17.5, 79, 0.5], [18, 76, 1], [19, 74, 1], [20, 72, 2], [22, 74, 1], [23, 76, 1],
    [24, 74, 2], [26, 71, 1], [27, 67, 1], [28, 69, 4]];
  for (const [b, m, d] of MEL) piano(b * B + 0.02, m, d * B, 0.055);
  const PAT = [1, 2, 3, 4, 3, 2, 4, 3];
  for (let i = 0; i < 64; i++) bell(i * B / 2, CH[i >> 4][PAT[i % 8]] + 12, i < 8 ? 0.006 + 0.012 * i / 8 : 0.018);
  // duck under the captain, then the power cut: everything slows down, the sound closes, then silence
  mus.gain.setValueAtTime(S.music, T(23.3)); mus.gain.linearRampToValueAtTime(S.music * 0.45, T(24));
  musLp.frequency.setValueAtTime(20000, T(TL.cut)); musLp.frequency.exponentialRampToValueAtTime(120, T(TL.cut) + 0.6);
  musLp.frequency.setValueAtTime(20000, T(TL.cut) + 0.95); mus.gain.setValueAtTime(S.music, T(TL.cut) + 0.95);

  // 2. the turbulence
  const dr = pad(29, [33, 40], 11, 0.03, { atk: 4, rel: 0.02, cut: 180, tape: false });
  dr.lp.frequency.setValueAtTime(180, T(29)); dr.lp.frequency.exponentialRampToValueAtTime(1600, T(39.9));
  for (let s = 30.2, gap = 0.86; s < 39.8; s += gap, gap = Math.max(0.34, gap * 0.94)) { thump(s, 0.45, 110, 40, 0.3); thump(s + 0.15, 0.25, 100, 40, 0.25); }
  const cl = pad(33, [58, 57, 64, 70], 7, 0.016, { atk: 6.5, rel: 0.02, cut: 600, tape: false });
  cl.lp.frequency.setValueAtTime(600, T(33)); cl.lp.frequency.exponentialRampToValueAtTime(5000, T(39.95));
  const rise = gain(0, mus); env(rise, T(34), 5.5, 0.018, 0.4, 0.02);
  osc('sine', 220, T(34), T(40.05), rise).frequency.exponentialRampToValueAtTime(880, T(40));

  // 3. silence (the crash, the ringing ears)

  // 4. waking up: Am – F/A – Dm – E, sparse piano with a long tail
  const AF = [[45, 57, 60, 64], [41, 57, 60, 65], [38, 57, 62, 65], [40, 56, 59, 64]];
  AF.forEach((c, i) => pad(50.5 + i * 4, c, 4.2, 0.016, { atk: i ? 1 : 3.5, rel: 2, cut: 700, type: 'triangle' }));
  for (const [s, m, d, v] of [[51, 69, 2, 0.05], [53, 72, 1.5, 0.045], [54.5, 76, 2.5, 0.05], [57.5, 74, 1.5, 0.045], [59, 72, 1, 0.04], [60, 69, 2.5, 0.05], [63, 68, 3, 0.045], [65.5, 64, 2, 0.03]]) piano(s, m, d, v);

  // 5. the radio: a low drone that dies with the radio
  pad(66, [33, 45, 52], 19.5, 0.012, { atk: 3, rel: 0.05, cut: 300, type: 'sine' });

  // 6. the fire spreads: a last swell and a low hit
  const fin = pad(86, [45, 52, 57, 60, 64, 71], 3.1, 0.026, { atk: 2.6, rel: 1.4, cut: 600 });
  fin.lp.frequency.setValueAtTime(600, T(86)); fin.lp.frequency.exponentialRampToValueAtTime(4000, T(88.8));
  thump(88.75, 0.7, 70, 28, 1.6); piano(88.75, 45, 2.5, 0.09); piano(88.75, 76, 2.5, 0.035); piano(88.75, 81, 2.5, 0.035);
}

// ---------- sound effects ----------
function effects(friends) {
  // the engines and the air in flight; the engines spool down at the power cut
  const eng = gain(0, sfx); eng.gain.setValueAtTime(0.0001, T(0)); eng.gain.exponentialRampToValueAtTime(0.05, T(2.5));
  eng.gain.setValueAtTime(0.05, T(TL.cut)); eng.gain.exponentialRampToValueAtTime(0.0001, T(TL.cut) + 4);
  const elp = filt('lowpass', 220, 0.7, eng);
  for (const f of [48, 48.6, 96.3]) { const o = osc('sawtooth', f, T(0), T(TL.cut) + 4.1, elp); o.frequency.setValueAtTime(f, T(TL.cut)); o.frequency.exponentialRampToValueAtTime(f * 0.35, T(TL.cut) + 4); }
  const wh = gain(0, sfx); wh.gain.setValueAtTime(0.0001, T(0)); wh.gain.exponentialRampToValueAtTime(0.005, T(3));
  wh.gain.setValueAtTime(0.005, T(TL.cut)); wh.gain.exponentialRampToValueAtTime(0.0001, T(TL.cut) + 3.5);
  const wo = osc('sine', 2100, T(0), T(TL.cut) + 3.6, wh); wo.frequency.setValueAtTime(2100, T(TL.cut)); wo.frequency.exponentialRampToValueAtTime(400, T(TL.cut) + 3.5);
  const air = gain(0, sfx); air.gain.setValueAtTime(0.0001, T(0)); air.gain.exponentialRampToValueAtTime(0.045, T(3)); air.gain.setValueAtTime(0.045, T(TL.crash - 0.01)); air.gain.setValueAtTime(0, T(TL.crash));
  noiseSrc(T(0), T(TL.crash) + 0.05, filt('lowpass', 700, 0.5, air));
  // the turbulence rumble
  const rum = gain(0, sfx); rum.gain.setValueAtTime(0.0001, T(29));
  const rlp = filt('lowpass', 140, 1, rum); rlp.frequency.setValueAtTime(140, T(30)); rlp.frequency.linearRampToValueAtTime(380, T(39.9));
  noiseSrc(T(29), T(TL.crash) + 0.05, rlp);
  for (let s = 30.4; s < 39.9; s += 0.22) rum.gain.setTargetAtTime(Math.min(0.9, 0.08 + (s - 30.4) * 0.07) * rand(0.4, 1.2), T(s), 0.06);
  rum.gain.setValueAtTime(0, T(TL.crash));

  // a small bump with a clink of glasses, the seatbelt chime, the captain
  thump(TL.bump, 0.4, 70, 35, 0.4, sfx); clink(TL.bump + 0.12, 0.05); clink(TL.bump + 0.2, 0.03);
  chime(TL.ding, 880); chime(TL.ding + 0.45, 698);
  voice(24.1, 3.75, { pitch: 105, v: 0.2 });
  // the lights flicker, the power dies
  buzz(27.6, 0.6); thump(TL.cut, 0.5, 60, 30, 0.6, sfx); click(TL.cut, 0.2);
  creak(28.9, 1.4, 0.07);
  // the master caution alarm
  for (let s = TL.alarm; s < TL.crash - 0.2; s += 1.1) { beep(s); beep(s + 0.2); }
  clatter(TL.masks, 12);
  scrape(TL.slide, 0.8); shatter(TL.shatter);
  thunder(35); thunder(37.5); creak(39.2, 0.8, 0.12);

  // the crash
  crash(TL.crash);
  // ringing ears and a heartbeat in the dark
  const rg = gain(0, sfx); rg.gain.setValueAtTime(0.0001, T(TL.ring)); rg.gain.exponentialRampToValueAtTime(0.045, T(43.2));
  rg.gain.exponentialRampToValueAtTime(0.004, T(50)); rg.gain.exponentialRampToValueAtTime(0.0001, T(52));
  osc('sine', 3600, T(TL.ring), T(52.1), rg);
  for (let s = 43.6; s < 50; s += 1.15) { thump(s, 0.3, 60, 35, 0.2, sfx); thump(s + 0.28, 0.18, 55, 35, 0.2, sfx); }

  // waking up: a gasp, the wind through the torn-off tail, the fire
  gasp(50.2);
  const wg = gain(0, wind); wg.gain.setValueAtTime(0.0001, T(49.5)); wg.gain.exponentialRampToValueAtTime(0.16, T(53));
  const wb = filt('bandpass', 420, 3, wg), wh2 = filt('bandpass', 1100, 8, gain(0.35, wg));
  noiseSrc(T(49.5), T(TL.end + 8), wb); noiseSrc(T(49.5), T(TL.end + 8), wh2);
  for (let s = 53; s < TL.end + 6; s += rand(1.2, 3)) { const k = rand(0.2, 1); wb.frequency.setTargetAtTime(320 + k * 420, T(s), 0.6); wh2.frequency.setTargetAtTime(800 + k * 900, T(s), 0.5); wg.gain.setTargetAtTime(0.08 + k * 0.14, T(s), 0.7); }
  const fg = gain(0, sfx); fg.gain.setValueAtTime(0.0001, T(50)); fg.gain.exponentialRampToValueAtTime(0.05, T(56)); fg.gain.linearRampToValueAtTime(0.08, T(85.8)); fg.gain.linearRampToValueAtTime(0.3, T(87.5));
  const fl = filt('lowpass', 380, 0.8, fg); fl.frequency.setValueAtTime(380, T(85.8)); fl.frequency.exponentialRampToValueAtTime(1400, T(87.5));
  noiseSrc(T(50), T(TL.end + 8), fl);
  for (let s = 50.5; s < TL.end + 6; s += rand(0.04, s > 86 ? 0.08 : 0.22)) crackle(s, s > 86 ? 1.6 : 1);
  whoosh(86);
  // your crew waking up one by one
  [53.5, 56, 58.5].slice(0, friends).forEach(cough);
  // sparks from the ceiling, the overhead bin falling open, a glass rolling on the floor
  for (const s of [52, 61, 64.2, 70.5]) zap(s);
  creak(54.8, 0.4, 0.06); thump(55.2, 0.35, 120, 50, 0.25, sfx); clatter(55.25, 4);
  roll(57, 4);
  // the radio: static, a voice, the host walking to the cockpit, the reply breaking up, the radio dying
  const st = gain(0, sfx); st.gain.setValueAtTime(0.0001, T(65.4)); st.gain.exponentialRampToValueAtTime(0.03, T(66));
  for (let s = 66.1; s < TL.dead - 0.1; s += rand(0.08, 0.4)) st.gain.setTargetAtTime(rand(0.01, 0.05), T(s), 0.03);
  st.gain.setValueAtTime(0.03, T(TL.dead)); st.gain.setValueAtTime(0, T(TL.dead) + 0.02);
  noiseSrc(T(65.4), T(TL.dead) + 0.1, filt('bandpass', 2200, 0.6, st));
  squelch(66.45); voice(66.6, 3.5, { pitch: 122, v: 0.22 }); squelch(70.2);
  for (let s = TL.stand + 1.1; s < TL.stand + 4.4; s += 0.5) step(s);
  squelch(82.9); voice(83, 2.35, { pitch: 126, v: 0.22, broken: true });
  thump(TL.dead, 0.5, 200, 60, 0.15, sfx); zap(TL.dead); click(TL.dead + 0.02, 0.3);
}

function chime(s, f) { const a = T(s), g = gain(0, sfx); env(g, a, 0.01, 0.06, 0, 1.5); osc('sine', f, a, a + 1.6, g); osc('sine', f * 2, a, a + 0.8, gain(0.25, g)); }
function clink(s, v = 0.04) { const a = T(s), g = gain(0, sfx); env(g, a, 0.002, v, 0, 0.35); const f = rand(2400, 3200); osc('sine', f, a, a + 0.4, g); osc('sine', f * 1.47, a, a + 0.3, gain(0.5, g)); }
function click(s, v = 0.2) { const a = T(s), g = gain(0, sfx); env(g, a, 0.001, v, 0, 0.03); noiseSrc(a, a + 0.05, filt('highpass', 2000, 0.7, g)); }
function crackle(s, k = 1) { const a = T(s), g = gain(0, sfx); env(g, a, 0.002, rand(0.04, 0.16) * k, 0, rand(0.02, 0.06)); noiseSrc(a, a + 0.1, filt('bandpass', rand(1500, 4500), 3, g)); }
function beep(s) { const a = T(s), g = gain(0, sfx); env(g, a, 0.005, 0.035, 0.1, 0.03); osc('square', 1050, a, a + 0.16, filt('bandpass', 1050, 3, g)); }
function buzz(s, d) {
  const a = T(s), g = gain(0, sfx); g.gain.setValueAtTime(0, a);
  for (let t = 0; t < d; t += 0.04) g.gain.setValueAtTime(Math.random() < 0.55 ? 0.06 : 0, a + t);
  g.gain.setValueAtTime(0, a + d);
  osc('sawtooth', 100, a, a + d + 0.05, filt('bandpass', 900, 2, g));
}
function creak(s, d, v = 0.08) {
  const a = T(s), g = gain(0, sfx); env(g, a, d * 0.3, v, d * 0.3, d * 0.4);
  const o = osc('sawtooth', 70, a, a + d + 0.05, filt('bandpass', 650, 12, g));
  for (let t = 0; t < d; t += 0.07) o.frequency.setTargetAtTime(rand(45, 110), a + t, 0.03);
}
function clatter(s, n) { for (let i = 0; i < n; i++) { const a = T(s + rand(0, 0.35)), g = gain(0, sfx); env(g, a, 0.002, rand(0.05, 0.14), 0, 0.04); noiseSrc(a, a + 0.08, filt('bandpass', rand(1200, 3500), 4, g)); } }
function scrape(s, d) { const a = T(s), g = gain(0, sfx); env(g, a, d * 0.4, 0.05, d * 0.4, d * 0.2); const f = filt('bandpass', 2400, 8, g); f.frequency.linearRampToValueAtTime(3400, a + d); noiseSrc(a, a + d + 0.05, f); }
function shatter(s) {
  for (let i = 0; i < 14; i++) clink(s + rand(0, 0.25), rand(0.02, 0.06));
  const a = T(s), g = gain(0, sfx); env(g, a, 0.003, 0.12, 0, 0.5); noiseSrc(a, a + 0.6, filt('highpass', 3000, 0.7, g));
}
function thunder(s) {
  const a = T(s), g = gain(0, sfx); env(g, a, 0.05, 0.35, 0.2, 2.6); noiseSrc(a, a + 3, filt('lowpass', 180, 0.7, g));
  const c = gain(0, sfx); env(c, a, 0.005, 0.12, 0, 0.3); noiseSrc(a, a + 0.4, filt('highpass', 800, 0.7, c));
}
function crash(s) {
  const a = T(s);
  thump(s, 1, 80, 22, 1.8, sfx);
  const g = gain(0, sfx); env(g, a, 0.005, 0.9, 0.3, 2.2);
  const lp = filt('lowpass', 6000, 0.5, g); lp.frequency.setTargetAtTime(300, a + 0.2, 0.8); noiseSrc(a, a + 2.8, lp);
  // metal tearing: distorted saws screaming through a narrow band
  const tg = gain(0, sfx); env(tg, a + 0.05, 0.05, 0.22, 1.4, 0.8);
  const bp = filt('bandpass', 1300, 5, shaper(4, tg));
  for (let i = 0; i < 3; i++) { const o = osc('sawtooth', rand(140, 260), a, a + 2.5, bp); for (let k = 0; k < 10; k++) o.frequency.setTargetAtTime(rand(90, 420), a + k * 0.22, 0.08); }
  for (let k = 0; k < 12; k++) clink(s + rand(0.1, 1.8), 0.05);
}
function gasp(s) { const a = T(s), g = gain(0, sfx); env(g, a, 0.6, 0.12, 0.05, 0.35); noiseSrc(a, a + 1.1, filt('bandpass', 1300, 0.8, g)); }
function cough(s) {
  for (const [o, v] of [[0, 0.18], [0.3, 0.12], [0.55, 0.08]]) { const a = T(s + o), g = gain(0, sfx); env(g, a, 0.01, v, 0.04, 0.12); noiseSrc(a, a + 0.25, filt('bandpass', 520, 1.2, g)); }
}
function zap(s) {
  const a = T(s), g = gain(0, sfx); g.gain.setValueAtTime(0, a);
  for (let t = 0; t < 0.35; t += 0.03) g.gain.setValueAtTime(Math.random() < 0.6 ? 0.05 : 0, a + t);
  g.gain.setValueAtTime(0, a + 0.36);
  osc('sawtooth', 120, a, a + 0.4, filt('bandpass', 3000, 2, g));
  for (let i = 0; i < 8; i++) crackle(s + rand(0, 0.4), 1.4);
}
function roll(s, d) {
  const a = T(s), g = gain(0, sfx); g.gain.setValueAtTime(0, a);
  for (let t = 0; t < d; t += 0.1) g.gain.setTargetAtTime(0.03 * Math.abs(Math.sin(t * 1.2)) * (1 - t / d), a + t, 0.05);
  noiseSrc(a, a + d + 0.1, filt('bandpass', 900, 4, g));
}
function step(s) { thump(s, 0.12, 140, 70, 0.08, sfx); const a = T(s), g = gain(0, sfx); env(g, a, 0.003, 0.04, 0, 0.08); noiseSrc(a, a + 0.12, filt('bandpass', 1800, 2, g)); }
function whoosh(s) { const a = T(s), g = gain(0, sfx); env(g, a, 1.2, 0.25, 0.3, 1.5); const f = filt('bandpass', 200, 1.2, g); f.frequency.exponentialRampToValueAtTime(1500, a + 1.4); noiseSrc(a, a + 3.2, f); }
function squelch(s) { const a = T(s), g = gain(0, sfx); env(g, a, 0.005, 0.08, 0.05, 0.08); noiseSrc(a, a + 0.2, filt('bandpass', 2500, 1, g)); }

// a voice with no words: syllables of a buzzing tone through moving formants, through a radio
function voice(s, dur, { pitch = 115, v = 0.2, broken = false } = {}) {
  const a = T(s), end = a + dur;
  const out = gain(1, sfx), hp = filt('highpass', 380, 0.7, filt('lowpass', 2800, 0.7, shaper(3, out)));
  const g = gain(0, hp); g.gain.setValueAtTime(0, a);
  const f1 = filt('bandpass', 650, 4, g), f2 = filt('bandpass', 1500, 5, gain(0.7, g));
  const src = osc('sawtooth', pitch, a, end + 0.2); src.connect(f1); src.connect(f2);
  noiseSrc(a, end + 0.2, filt('highpass', 3500, 0.7, gain(0.18, g)));
  for (let t = a; t < end;) {
    const len = rand(0.08, 0.22);
    if (!(broken && Math.random() < 0.3)) {
      g.gain.setTargetAtTime(v * rand(0.55, 1), t, 0.012);
      src.frequency.setTargetAtTime(pitch * rand(0.82, 1.28), t, 0.05);
      f1.frequency.setTargetAtTime(rand(420, 950), t, 0.025); f2.frequency.setTargetAtTime(rand(1100, 2300), t, 0.025);
    }
    g.gain.setTargetAtTime(0, t + len * 0.75, 0.02);
    t += len + (Math.random() < 0.16 ? rand(0.12, 0.28) : rand(0.015, 0.05));
  }
  g.gain.setTargetAtTime(0, end, 0.015);
}

// ---------- live: the host's push to talk on the radio ----------
export function pttOn() {
  if (!bus || tx) return;
  const a = ctx.currentTime;
  squelch(a - t0);
  const g = gain(0, sfx); g.gain.setTargetAtTime(0.025, a + 0.05, 0.03);
  tx = { g, src: noiseSrc(a, a + 60, filt('bandpass', 1800, 0.8, g)) };
}
export function pttOff() {
  if (!bus || !tx) return;
  const a = ctx.currentTime;
  tx.g.gain.cancelScheduledValues(a); tx.g.gain.setTargetAtTime(0, a, 0.02);
  try { tx.src.stop(a + 0.2); } catch { /* stopped */ }
  squelch(a - t0 + 0.02); tx = null;
}
// the automatic line when the host stays silent
export function autoLine(dur = 3.4) {
  if (!bus) return;
  const s = ctx.currentTime - t0 + 0.05;
  squelch(s); voice(s + 0.12, dur, { pitch: 112, v: 0.22 }); squelch(s + dur + 0.2);
}
