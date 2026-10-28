'use strict';
// Procedural background music: a sneaky blues groove for the day, a tense ambient track for the night.
PB.Music = (() => {
    const Mu = { mode: null, on: true, tension: 0, vol: 0.8 };
    let ctx, bus, delay, timer = null, nextT = 0, step = 0, bar = 0, phrase = [];
    const midi = n => 440 * Math.pow(2, (n - 69) / 12);
    const SONGS = { day: { bpm: 104, swing: 0.16, vol: 0.3 }, night: { bpm: 64, swing: 0, vol: 0.36 }, escape: { bpm: 96, swing: 0, vol: 0.5 } };
    // Escape theme: a slow, lonely minor-key guitar figure that keeps repeating while everything else
    // builds up under it (pad, toms, tremolo) until it explodes into distorted chords and drums.
    const ESC = [
        { arp: [52, 59, 64, 67, 64, 59, 64, 59], pow: [40, 47, 52] }, // Em
        { arp: [48, 55, 60, 64, 60, 55, 60, 55], pow: [36, 43, 48] }, // C
        { arp: [45, 52, 57, 60, 57, 52, 57, 52], pow: [45, 52, 57] }, // Am
        { arp: [47, 54, 59, 63, 59, 54, 59, 54], pow: [47, 54, 59] }  // B
    ];
    let ebar = 0, shaper = null;

    const DAY = [
        { stab: [60, 64, 67, 70], walk: [36, 40, 43, 45] }, // C7
        { stab: [57, 60, 63, 65], walk: [41, 45, 48, 50] }, // F7
        { stab: [60, 64, 67, 70], walk: [36, 40, 43, 46] }, // C7
        { stab: [59, 62, 65, 67], walk: [43, 47, 50, 52] }  // G7
    ];
    const BLUES = [72, 75, 77, 78, 79, 82, 84];
    const NIGHT = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]; // Am F Dm E
    const PENTA = [69, 72, 74, 76, 79, 81, 84];

    Mu.init = () => {
        ctx = PB.Audio.ctx;
        if (!ctx || bus) return;
        bus = ctx.createGain(); bus.gain.value = 0;
        bus.connect(ctx.destination); // own volume, separate from sound effects
        delay = ctx.createDelay(); delay.delayTime.value = 0.34;
        const fb = ctx.createGain(); fb.gain.value = 0.38;
        const wet = ctx.createGain(); wet.gain.value = 0.5;
        delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(bus);
    };

    // built-in music goes silent while custom music is ON
    const target = () => (Mu.on && Mu.mode && (!PB.Settings.v.customMusic || Mu.mode === 'escape') ? SONGS[Mu.mode].vol : 0) * 0.55 * Mu.vol;
    Mu.setVolume = v => {
        Mu.vol = v;
        if (bus) bus.gain.setTargetAtTime(target(), ctx.currentTime, 0.1);
        PB.CustomMusic.update();
    };

    Mu.setMode = m => {
        Mu.init();
        if (!bus || m === Mu.mode) return;
        Mu.mode = m;
        PB.CustomMusic.update();
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => {
            if (Mu.mode !== m) return;
            step = 0; bar = 0; phrase = []; ebar = 0;
            nextT = ctx.currentTime + 0.1;
            bus.gain.setTargetAtTime(target(), ctx.currentTime, 0.8);
        }, 1000);
        if (!timer) timer = setInterval(tick, 25);
    };

    Mu.toggle = () => {
        Mu.on = !Mu.on;
        if (bus) bus.gain.setTargetAtTime(target(), ctx.currentTime, 0.3);
        PB.CustomMusic.update();
        PB.UI.toast(Mu.on ? '🎵 Music on' : '🔇 Music off');
    };

    // ---------- Voices ----------
    function note(type, f, t, dur, vol, o = {}) {
        const os = ctx.createOscillator();
        os.type = type;
        os.frequency.setValueAtTime(f, t);
        if (o.detune) os.detune.value = o.detune;
        if (o.glideTo) os.frequency.exponentialRampToValueAtTime(o.glideTo, t + dur);
        const g = ctx.createGain(), a = o.attack || 0.005, r = o.release || 0.08;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + a);
        g.gain.setValueAtTime(vol, t + Math.max(a, dur - r));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + r);
        let node = os;
        if (o.lp) {
            const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; fl.Q.value = o.q || 0.7;
            os.connect(fl); node = fl;
        }
        node.connect(g); g.connect(bus);
        if (o.send) g.connect(delay);
        os.start(t); os.stop(t + dur + r + 0.05);
    }
    function noiseHit(t, freq, type, dur, v) {
        const s = ctx.createBufferSource(); s.buffer = PB.Audio.noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); g.connect(bus);
        s.start(t, Math.random()); s.stop(t + dur + 0.02);
    }
    const kick = (t, v = 0.6) => note('sine', 140, t, 0.16, v, { glideTo: 45, release: 0.12 });
    const snare = (t, v = 0.3) => { noiseHit(t, 1800, 'bandpass', 0.16, v); note('triangle', 190, t, 0.05, v * 0.5); };
    const hat = (t, v = 0.1) => noiseHit(t, 8000, 'highpass', 0.04, v);

    // ---------- Patterns ----------
    function scheduleDay(st, t, s16) {
        const ch = DAY[bar];
        if (st === 0 && bar % 2 === 1) {
            phrase = [];
            for (let i = 0; i < 16; i += 2) phrase[i] = Math.random() < 0.4 ? PB.choice(BLUES) : null;
        }
        if (st % 4 === 0) note('triangle', midi(ch.walk[st / 4]), t, s16 * 3, 0.3, { lp: 700 });
        if (st % 4 === 2) ch.stab.forEach(n => note('square', midi(n), t, 0.08, 0.028, { lp: 2400 }));
        if (st === 0 || st === 8 || (st === 10 && bar === 3)) kick(t);
        if (st === 4 || st === 12) snare(t);
        if (st % 2 === 0) hat(t, st % 4 === 0 ? 0.09 : 0.05);
        if (bar % 2 === 1 && phrase[st]) note('triangle', midi(phrase[st]), t, s16 * 1.8, 0.06, { send: true, lp: 3000 });
    }
    function scheduleNight(st, t, s16) {
        const ch = NIGHT[bar];
        if (st === 0) {
            ch.forEach(n => {
                note('sawtooth', midi(n), t, s16 * 16, 0.03, { attack: 1.2, release: 1.5, lp: 650, detune: -8 });
                note('sawtooth', midi(n), t, s16 * 16, 0.03, { attack: 1.2, release: 1.5, lp: 650, detune: 8 });
            });
        }
        if (st === 0 || st === 8) note('sine', midi(ch[0] - 24), t, s16 * 6, 0.3, { attack: 0.02, release: 0.4 });
        if (st % 4 === 0) noiseHit(t, st % 8 === 0 ? 5000 : 3500, 'highpass', 0.025, 0.05);
        if (st % 2 === 0 && Math.random() < 0.16) note('sine', midi(PB.choice(PENTA)), t, 0.35, 0.05, { send: true });
        if (Mu.tension > 0.25 && st % 4 === 0) { kick(t, 0.4 * Mu.tension); kick(t + 0.13, 0.28 * Mu.tension); }
    }

    // distorted "guitar": sawtooth through a soft-clipping wave shaper
    function dist() {
        if (shaper) return shaper;
        shaper = ctx.createWaveShaper();
        const n = 1024, c = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = Math.tanh(x * 6) * 0.8; }
        shaper.curve = c; shaper.oversample = '2x';
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
        shaper.connect(lp); lp.connect(bus);
        return shaper;
    }
    function powerChord(notes, t, dur, vol) {
        notes.forEach((n, i) => [-9, 9].forEach(dt => {
            const os = ctx.createOscillator(); os.type = 'sawtooth'; os.frequency.value = midi(n); os.detune.value = dt;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol / (i + 1), t + 0.01);
            g.gain.setValueAtTime(vol / (i + 1), t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            os.connect(g); g.connect(dist()); os.start(t); os.stop(t + dur + 0.05);
        }));
    }
    const tom = (t, f, v) => note('sine', f, t, 0.3, v, { glideTo: f * 0.55, release: 0.2 });
    const crash = (t, v = 0.25) => noiseHit(t, 5000, 'highpass', 1.6, v);

    // sections (in bars): 0-7 the lonely figure · 8-15 + pad and heartbeat kick · 16-23 + tremolo and building toms · 24+ everything
    function scheduleEscape(st, t, s16) {
        const ch = ESC[bar], sec = ebar < 8 ? 0 : ebar < 16 ? 1 : ebar < 24 ? 2 : 3;
        if (st % 2 === 0) note('triangle', midi(ch.arp[st / 2] + 12), t, s16 * 2.4, sec === 3 ? 0.07 : 0.1, { send: true, lp: 3200, release: 0.3 });
        if (sec >= 1 && st === 0) {
            ch.pow.forEach(n => note('sawtooth', midi(n), t, s16 * 16, 0.025 + sec * 0.006, { attack: 1.0, release: 1.2, lp: 500 + sec * 300 }));
            note('sine', midi(ch.pow[0] - 12), t, s16 * 15, 0.22, { attack: 0.3, release: 0.8 });
        }
        if (sec === 1 && (st === 0 || st === 3)) kick(t, 0.35);
        if (sec === 2) {
            note('triangle', midi(ch.arp[(st * 3) % 8] + 24), t, s16 * 0.9, 0.035 + (ebar - 16) * 0.004, { lp: 5000 });
            if (st % 4 === 0) tom(t, 110 + (st / 4) * 10, 0.2 + (ebar - 16) * 0.03);
            if (ebar === 23 && st >= 8) snare(t, 0.12 + (st - 8) * 0.03);
        }
        if (sec === 3) {
            if (st === 0) { powerChord(ch.pow, t, s16 * 7.6, 0.07); if (bar === 0) crash(t); }
            if (st === 8) powerChord(ch.pow, t, s16 * 7.6, 0.07);
            if (st === 0 || st === 6 || st === 10) kick(t, 0.7);
            if (st === 4 || st === 12) snare(t, 0.38);
            if (st % 2 === 0) hat(t, 0.07);
        }
    }

    function tick() {
        if (!Mu.mode || !ctx) return;
        const song = SONGS[Mu.mode];
        const base = 60 / song.bpm / 4;
        while (nextT < ctx.currentTime + 0.15) {
            if (Mu.mode === 'day') scheduleDay(step, nextT, base);
            else if (Mu.mode === 'escape') scheduleEscape(step, nextT, base);
            else scheduleNight(step, nextT, base);
            nextT += base * (step % 2 === 0 ? 1 + song.swing : 1 - song.swing);
            step++;
            if (step === 16) { step = 0; bar = (bar + 1) % 4; ebar++; }
        }
    }
    // jump straight to the big part (when the fight starts)
    Mu.escalate = () => { if (Mu.mode === 'escape' && ebar < 24) ebar = 24; };

    return Mu;
})();
