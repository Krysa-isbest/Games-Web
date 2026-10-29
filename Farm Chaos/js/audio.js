// audio.js — every sound is synthesized with WebAudio, no files needed
'use strict';

const AU = {
  ctx: null, master: null, sfx: null, warn: null, amb: null, loops: {}, listener: { x: 0, y: 0, z: 0, yaw: 0 },
  muffle: null,
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    this.master = ctx.createGain(); this.muffle.connect(this.master); this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.muffle);
    this.warn = ctx.createGain(); this.warn.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.muffle);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // brown noise for rumbles
    const bb = ctx.createBuffer(1, len, ctx.sampleRate), bd = bb.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.brown = bb;
    this.applyVolumes();
  },
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = S.d.vol; this.sfx.gain.value = S.d.sfxVol; this.warn.gain.value = S.d.warnVol; this.amb.gain.value = S.d.ambVol;
  },
  setMuffled(on) { if (this.muffle) this.muffle.frequency.setTargetAtTime(on ? 500 : 20000, this.ctx.currentTime, 0.2); },
  // distance attenuation + stereo pan for a world position
  spatial(pos, vol) {
    const ctx = this.ctx, g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let v = vol;
    if (pos) {
      const L = this.listener, dx = pos.x - L.x, dz = pos.z - L.z, dy = (pos.y || 0) - L.y, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      v *= 1 / (1 + d * d * 0.004);
      if (pan) { const a = Math.atan2(dx, -dz) + L.yaw; pan.pan.value = U.clamp(Math.sin(a) * Math.min(1, d / 4), -1, 1); }
    }
    g.gain.value = v;
    if (pan) { g.connect(pan); return { in: g, out: pan }; }
    return { in: g, out: g };
  },
  osc(type, f0, f1, dur, vol, dest, t0 = 0) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  },
  burst(dur, vol, type, freq, q, dest, brown, t0 = 0, f1) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + t0;
    s.buffer = brown ? this.brown : this.noise; s.loop = true;
    f.type = type; f.frequency.setValueAtTime(freq, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  play(name, pos, vol = 1) {
    if (!this.ctx) return;
    const isWarn = name === 'siren' || name === 'warn' || name === 'nukeSiren' || name === 'radio';
    const sp = this.spatial(isWarn ? null : pos, vol);
    sp.out.connect(isWarn ? this.warn : this.sfx);
    const D = sp.in;
    switch (name) {
      case 'till': this.burst(0.12, 0.6, 'lowpass', 900, 1, D, true); this.osc('sine', 120, 60, 0.1, 0.3, D); break;
      case 'plant': this.osc('sine', 500, 900, 0.08, 0.25, D); break;
      case 'harvest': this.osc('triangle', 600, 1100, 0.07, 0.3, D); this.burst(0.08, 0.3, 'highpass', 3000, 1, D); break;
      case 'coin': this.osc('square', 988, 988, 0.08, 0.12, D); this.osc('square', 1319, 1319, 0.25, 0.12, D, 0.08); break;
      case 'buy': this.osc('triangle', 660, 660, 0.1, 0.25, D); this.osc('triangle', 880, 880, 0.18, 0.25, D, 0.09); break;
      case 'deny': this.osc('square', 200, 140, 0.18, 0.15, D); break;
      case 'pickup': this.osc('sine', 700, 1400, 0.1, 0.25, D); break;
      case 'jump': this.osc('sine', 200, 320, 0.1, 0.12, D); break;
      case 'land': this.burst(0.1, 0.4, 'lowpass', 400, 1, D, true); break;
      case 'step': this.burst(0.05, 0.15, 'lowpass', 700 + Math.random() * 300, 1, D, true); break;
      case 'hurt': this.osc('sawtooth', 300, 120, 0.2, 0.25, D); this.burst(0.12, 0.4, 'lowpass', 800, 1, D, true); break;
      case 'death': this.osc('sawtooth', 400, 50, 0.9, 0.3, D); this.osc('square', 200, 40, 0.9, 0.15, D); break;
      case 'respawn': this.osc('sine', 400, 800, 0.3, 0.2, D); this.osc('sine', 600, 1200, 0.3, 0.15, D, 0.1); break;
      case 'explosion': this.burst(1.6, 1.2, 'lowpass', 1200, 0.7, D, true, 0, 80); this.burst(0.4, 0.8, 'lowpass', 3000, 0.5, D, false, 0, 300); this.osc('sine', 80, 30, 1.0, 0.8, D); break;
      case 'bigboom': this.burst(4.5, 1.6, 'lowpass', 900, 0.7, D, true, 0, 40); this.osc('sine', 60, 18, 4, 1.0, D); this.burst(1, 1, 'lowpass', 2500, 0.5, D, false, 0, 200); break;
      case 'thunder': this.burst(0.15, 1.2, 'highpass', 1500, 0.5, D); this.burst(2.5, 1.0, 'lowpass', 600, 0.6, D, true, 0.05, 60); break;
      case 'break': this.burst(0.25, 0.7, 'bandpass', 900 + Math.random() * 600, 2, D); this.burst(0.3, 0.5, 'lowpass', 300, 1, D, true); break;
      case 'boing': this.osc('sine', 180, 520, 0.25, 0.3, D); break;
      case 'croak': this.osc('sawtooth', 140, 90, 0.18, 0.15, D); this.osc('sawtooth', 150, 95, 0.15, 0.12, D, 0.2); break;
      case 'moo': { const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
        o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(110, t + 0.9); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(900, t + 0.3); f.frequency.linearRampToValueAtTime(300, t + 0.9);
        g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.1); g.gain.linearRampToValueAtTime(0.001, t + 1.0); o.connect(f); f.connect(g); g.connect(D); o.start(t); o.stop(t + 1.05); break; }
      case 'cluck': for (let i = 0; i < 3; i++) this.osc('square', 900 - i * 80, 500, 0.05, 0.08, D, i * 0.09); break;
      case 'oink': this.burst(0.18, 0.4, 'bandpass', 400, 6, D, false); this.osc('sawtooth', 220, 160, 0.15, 0.1, D); break;
      case 'baa': this.osc('sawtooth', 380, 360, 0.6, 0.12, D); break;
      case 'ufo': this.osc('sine', 300, 900, 1.2, 0.2, D); this.osc('sine', 305, 880, 1.2, 0.2, D); break;
      case 'zap': this.osc('sawtooth', 1800, 200, 0.25, 0.2, D); break;
      case 'splash': this.burst(0.5, 0.6, 'highpass', 800, 0.7, D); break;
      case 'warn': this.osc('triangle', 880, 880, 0.15, 0.3, D); this.osc('triangle', 660, 660, 0.25, 0.3, D, 0.17); this.osc('triangle', 880, 880, 0.3, 0.3, D, 0.4); break;
      case 'siren': { const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
        o.type = 'sawtooth'; for (let i = 0; i < 6; i++) { o.frequency.setValueAtTime(600, t + i * 0.5); o.frequency.linearRampToValueAtTime(900, t + i * 0.5 + 0.25); o.frequency.linearRampToValueAtTime(600, t + i * 0.5 + 0.5); }
        g.gain.setValueAtTime(0.13, t); g.gain.setValueAtTime(0.13, t + 2.8); g.gain.linearRampToValueAtTime(0, t + 3); o.connect(g); g.connect(D); o.start(t); o.stop(t + 3.05); break; }
      case 'nukeSiren': { const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
        o.type = 'sawtooth'; o.frequency.setValueAtTime(200, t);
        for (let i = 0; i < 3; i++) { o.frequency.linearRampToValueAtTime(700, t + i * 6 + 3); o.frequency.linearRampToValueAtTime(250, t + i * 6 + 6); }
        g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.16, t + 1); g.gain.setValueAtTime(0.16, t + 17); g.gain.linearRampToValueAtTime(0.001, t + 18);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600; o.connect(f); f.connect(g); g.connect(D); o.start(t); o.stop(t + 18.1); break; }
      case 'radio': this.burst(0.3, 0.25, 'bandpass', 2000, 1, D); this.osc('square', 1000, 1000, 0.08, 0.06, D, 0.32); break;
      case 'whoosh': this.burst(0.6, 0.5, 'bandpass', 400, 1, D, false, 0, 1600); break;
      case 'crack': this.burst(0.6, 0.8, 'lowpass', 500, 1, D, true, 0, 80); break;
      case 'chomp': this.burst(0.06, 0.4, 'bandpass', 1200, 3, D); break;
      case 'kick': this.osc('sine', 220, 80, 0.12, 0.4, D); this.burst(0.08, 0.4, 'lowpass', 1200, 1, D); break;
      case 'chirp': { const f = 2500 + Math.random() * 1500; for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) this.osc('sine', f, f * 1.4, 0.07, 0.05, D, i * 0.11); break; }
      case 'chime':[523, 659, 784, 1047].forEach((f, i) => this.osc('triangle', f, f, 0.5, 0.15, D, i * 0.12)); break;
    }
  },
  // looping beds: wind, rain, fire, buzz, hum, rumble. vol is set every frame by whoever needs it
  loop(name, vol) {
    if (!this.ctx) return;
    let L = this.loops[name];
    if (!L) {
      const c = this.ctx, g = c.createGain(); g.gain.value = 0; g.connect(name === 'crickets' || name === 'birds' ? this.amb : this.sfx);
      L = this.loops[name] = { g, target: 0 };
      if (name === 'buzz' || name === 'hum') {
        const o = c.createOscillator(); o.type = name === 'buzz' ? 'sawtooth' : 'sine'; o.frequency.value = name === 'buzz' ? 190 : 110;
        const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = name === 'buzz' ? 23 : 3; lg.gain.value = name === 'buzz' ? 25 : 30;
        lfo.connect(lg); lg.connect(o.frequency); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
        o.connect(f); f.connect(g); o.start(); lfo.start();
      } else if (name === 'crickets') {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 4200;
        const am = c.createGain(); am.gain.value = 0; const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 14;
        const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(am.gain); o.connect(am); am.connect(g); o.start(); lfo.start();
      } else {
        const s = c.createBufferSource(); s.buffer = name === 'rumble' || name === 'fire' ? this.brown : this.noise; s.loop = true;
        const f = c.createBiquadFilter();
        if (name === 'wind') { f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6; const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.15; lg.gain.value = 250; lfo.connect(lg); lg.connect(f.frequency); lfo.start(); }
        else if (name === 'rain') { f.type = 'highpass'; f.frequency.value = 1400; }
        else if (name === 'fire') { f.type = 'lowpass'; f.frequency.value = 900; }
        else if (name === 'rumble') { f.type = 'lowpass'; f.frequency.value = 160; }
        else if (name === 'water') { f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4; }
        else if (name === 'birds') { f.type = 'highpass'; f.frequency.value = 9000; }
        s.connect(f); f.connect(g); s.start();
      }
    }
    L.target = Math.max(L.target, vol);
  },
  // called once per frame after everyone requested their loop volumes
  updateLoops() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const k in this.loops) { const L = this.loops[k]; L.g.gain.setTargetAtTime(L.target, t, 0.25); L.target = 0; }
  },
};
