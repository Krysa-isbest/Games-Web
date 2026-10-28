'use strict';
// Global namespace, shared data tables, helpers and synthesized audio.
const PB = window.PB = {};

PB.C = 0.1; // size of one placement-grid cell in metres

PB.rand = (a, b) => a + Math.random() * (b - a);
PB.randi = (a, b) => Math.floor(PB.rand(a, b + 1));
PB.choice = arr => arr[Math.floor(Math.random() * arr.length)];
PB.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
PB.lerp = (a, b, t) => a + (b - a) * t;
PB.damp = (a, b, k, dt) => PB.lerp(a, b, 1 - Math.exp(-k * dt));

// ---------- Quality grades ----------
PB.GRADES = [
    { g: 'F', min: 0,  mult: 0.4, col: '#ff8a80' },
    { g: 'D', min: 30, mult: 0.7, col: '#ffb067' },
    { g: 'C', min: 48, mult: 1.0, col: '#ffe066' },
    { g: 'B', min: 64, mult: 1.3, col: '#a8f07a' },
    { g: 'A', min: 80, mult: 1.7, col: '#7fd8ff' },
    { g: 'S', min: 93, mult: 2.3, col: '#d7a8ff' }
];
PB.gradeOf = q => { let r = PB.GRADES[0]; for (const g of PB.GRADES) if (q >= g.min) r = g; return r; };
PB.gradeIdx = q => PB.GRADES.indexOf(PB.gradeOf(q));
PB.gradeTag = q => { const g = PB.gradeOf(q); return `<span class="grade" style="background:${g.col}">${g.g}</span>`; };

// ---------- Reputation ranks ----------
PB.RANKS = [
    { name: 'Fish',        rep: 0,    unlock: 'Cigarettes' },
    { name: 'Hustler',     rep: 60,   unlock: 'Forged papers, Lamp shade' },
    { name: 'Supplier',    rep: 180,  unlock: 'Hooch brewing, Mattress stash, Lookout' },
    { name: 'Big Shot',    rep: 400,  unlock: 'Premium tobacco, Fake stamp, Loose brick' },
    { name: 'Kingpin',     rep: 750,  unlock: 'Connections, richer customers' },
    { name: 'Prison Boss', rep: 1200, unlock: 'The whole block answers to you' }
];
PB.rankOf = rep => { let i = 0; PB.RANKS.forEach((r, k) => { if (rep >= r.rep) i = k; }); return i; };

// ---------- Items ----------
// w/h = footprint in grid cells (before rotation)
PB.ITEMS = {
    tobacco:   { name: 'Tobacco Pouch',   icon: '🍂', w: 2, h: 2, contraband: true,  charges: 10, price: 14, rank: 0, stock: [2, 4], desc: 'Enough for 10 cigarettes.' },
    premium:   { name: 'Premium Tobacco', icon: '🌿', w: 2, h: 2, contraband: true,  charges: 10, price: 34, rank: 3, stock: [1, 2], bonus: 12, desc: 'Smooth leaf. +12 cigarette quality.' },
    rolling:   { name: 'Rolling Papers',  icon: '🧻', w: 1, h: 1, contraband: true,  charges: 10, price: 5,  rank: 0, stock: [2, 5], desc: '10 thin papers.' },
    cigarette: { name: 'Cigarettes',      icon: '🚬', w: 2, h: 1, contraband: true,  stack: 10, sell: 6, product: true, rep: 0.6, desc: 'Hand-rolled cigarettes.' },
    blank:     { name: 'Blank Paper',     icon: '📄', w: 2, h: 3, contraband: false, charges: 5, price: 8, rank: 1, stock: [1, 3], desc: '5 official-looking sheets.' },
    pen:       { name: 'Fountain Pen',    icon: '🖋️', w: 2, h: 1, contraband: false, tool: true, price: 15, rank: 1, stock: [1, 1], desc: 'Needed to forge papers. Never runs out.' },
    stamp:     { name: 'Fake Stamp',      icon: '🔖', w: 1, h: 1, contraband: true,  tool: true, price: 70, rank: 3, stock: [0, 1], desc: 'Stamped papers sell for +40%.' },
    document:  { name: 'Forged Papers',   icon: '📑', w: 2, h: 3, contraband: true,  stack: 5, sell: 18, product: true, rep: 2, desc: 'Passes, permits and IOUs.' },
    fruit:     { name: 'Fruit',           icon: '🍎', w: 1, h: 1, contraband: false, price: 3, rank: 2, stock: [3, 8], desc: 'Mash 3 of them for a brew.' },
    sugar:     { name: 'Sugar Bag',       icon: '🍚', w: 2, h: 2, contraband: false, charges: 2, price: 9, rank: 2, stock: [1, 3], desc: 'Enough for 2 brews.' },
    jug:       { name: 'Brewing Jug',     icon: '🫙', w: 2, h: 2, contraband: false, tool: true, price: 30, rank: 2, stock: [1, 1], desc: 'Ferments mash into hooch over one night. Contraband while full!' },
    bottle:    { name: 'Empty Bottle',    icon: '🧴', w: 1, h: 1, contraband: false, price: 2, rank: 2, stock: [3, 8], desc: 'For bottling finished hooch.' },
    hooch:     { name: 'Hooch',           icon: '🍶', w: 1, h: 1, contraband: true,  sell: 34, product: true, rep: 3, desc: 'Prison moonshine. Handle with care.' },
    spoon:     { name: 'Spoon',           icon: '🥄', w: 2, h: 1, contraband: true,  tool: true, charges: 10, price: 45, rank: 0, stock: [0, 1], desc: 'For digging. Steal one at lunch for free, or pay up.' },
    grinder:   { name: 'Pepper Grinder',  icon: '⚙️', w: 2, h: 2, contraband: true,  tool: true, desc: 'Stolen from the canteen. Grinds tobacco properly (+8 quality).' },
    rubble:    { name: 'Concrete Rubble', icon: '🪨', w: 2, h: 2, contraband: true,  desc: 'Evidence of digging! Flush it down the toilet.' },
    ball:      { name: 'Rubber Ball',     icon: '🎾', w: 1, h: 1, contraband: false, desc: 'Throw it at the wall and catch it. Something to do while you wait.' },
    glue:      { name: 'Glue Tube',       icon: '🧴', w: 1, h: 1, contraband: false, desc: 'Stolen from the canteen. Holds a fake key together.' },
    keybow:    { name: 'Key Bow',         icon: '🗝️', w: 1, h: 1, contraband: true,  desc: 'The handle of a fake key, carved in the workshop.' },
    keyshaft:  { name: 'Key Shaft',       icon: '🗝️', w: 1, h: 1, contraband: true,  desc: 'The middle of a fake key, carved in the workshop.' },
    keybit:    { name: 'Key Bit',         icon: '🗝️', w: 1, h: 1, contraband: true,  desc: 'The teeth of a fake key, carved in the workshop.' },
    fakekey:   { name: 'Fake Cell Key',   icon: '🔑', w: 2, h: 1, contraband: true,  desc: 'Hold it and use your cell door at night to ESCAPE.' },
    // ----- later products -----
    cigar:     { name: 'Cigars',          icon: '🚬', w: 2, h: 1, contraband: true,  stack: 5, sell: 22, product: true, rep: 1.6, desc: 'Fat hand-rolled cigars from premium leaf. The bosses love them.' },
    cards:     { name: 'Marked Cards',    icon: '🃏', w: 1, h: 2, contraband: true,  stack: 3, sell: 26, product: true, rep: 1.8, desc: 'A deck with secret marks. Every card game in the block wants one.' },
    photo:     { name: 'Passport Photo',  icon: '🖼️', w: 1, h: 1, contraband: false, price: 25, rank: 4, stock: [1, 3], desc: 'A smuggled photo booth strip. Needed for fake IDs.' },
    fakeid:    { name: 'Fake ID',         icon: '🪪', w: 1, h: 1, contraband: true,  stack: 3, sell: 85, product: true, rep: 5, desc: 'A new name for the outside. Worth a fortune.' },
    wine:      { name: 'Fruit Wine',      icon: '🍷', w: 1, h: 1, contraband: true,  sell: 70, product: true, rep: 5, desc: 'Two nights of patience. Smooth, strong and expensive.' }
};
PB.KEY_PARTS = ['keybow', 'keyshaft', 'keybit'];
PB.PRODUCT_RANK = { cigarette: 0, document: 1, cards: 1, hooch: 2, cigar: 3, wine: 4, fakeid: 4 };

// ---------- Supplier tiers ----------
// Vinnie can get better ingredients if you pay his supplier ("Upgrade" next to Buy). Higher tier ingredients
// give better quality AND the product inherits the tier: Fine ★, Premium ★★, Luxury ★★★ goods sell for much more.
PB.TIERS = [
    { name: 'Standard', star: '',    col: '#cfcfcf' },
    { name: 'Fine',     star: '★',   col: '#9fe0ff' },
    { name: 'Premium',  star: '★★',  col: '#ffd84d' },
    { name: 'Luxury',   star: '★★★', col: '#ff9cf0' }
];
PB.TIERABLE = ['tobacco', 'premium', 'rolling', 'blank', 'fruit', 'sugar', 'photo'];
PB.TIER_RANK = [0, 1, 2, 3];                         // rank needed to reach each tier
PB.tierCost = (type, tier) => Math.round(PB.ITEMS[type].price * [0, 14, 32, 70][tier] + [0, 60, 160, 380][tier]);
PB.tierPrice = tier => 1 + 0.4 * tier;                // ingredient price multiplier
PB.tierValue = tier => 1 + 0.35 * (tier || 0);        // product value multiplier
PB.tierQuality = tier => 5 * (tier || 0);             // quality bonus per ingredient tier
PB.tierStar = tier => tier ? ` <span class="tier" style="background:${PB.TIERS[tier].col}">${PB.TIERS[tier].star}</span>` : '';

// ---------- Cell upgrades (bought once) ----------
PB.UPGRADES = [
    { id: 'shade',       icon: '💡', name: 'Lamp Shade',     price: 70,   rank: 1, desc: 'Guards no longer notice your lamp at night.' },
    { id: 'pocket',      icon: '🧥', name: 'Sewn-in Pocket', price: 120,  rank: 1, desc: 'A secret pocket: guards never find the item in your (right) hand.' },
    { id: 'pillow',      icon: '🛌', name: 'Memory-foam Pillow', price: 80, rank: 1, desc: 'You sleep like a baby. Heat drops 8 more every morning.' },
    { id: 'worklamp',    icon: '🔦', name: 'Work Lamp',      price: 110,  rank: 1, desc: 'Proper light at the desk: +5 quality on everything you craft.' },
    { id: 'mattress',    icon: '🛏️', name: 'Mattress Stash', price: 90,   rank: 2, desc: 'Press F at your bed to lift the mattress and hide stuff under it.' },
    { id: 'lookout',     icon: '👀', name: 'Paid Lookout',   price: 140,  rank: 2, desc: 'Your neighbour whistles when guards come. Much earlier warning.' },
    { id: 'safe',        icon: '🔒', name: 'Floor Safe',     price: 240,  rank: 2, desc: 'A steel safe in the floor by the bed (E to open). Never searched while closed, not even by dogs.' },
    { id: 'radio',       icon: '📻', name: 'Pocket Radio',   price: 160,  rank: 2, desc: 'You hear the gossip first: one extra job offer every morning and customers find you 20% faster.' },
    { id: 'brick',       icon: '🧱', name: 'Loose Brick',    price: 180,  rank: 3, desc: 'A secret hole in the wall next to the sink.' },
    { id: 'tools',       icon: '🧰', name: 'Precision Tools', price: 280, rank: 3, desc: 'Fine blades and needles: +6 quality on everything you craft.' },
    { id: 'fence',       icon: '🧾', name: 'Fence Contact',  price: 420,  rank: 3, desc: 'Vinnie knows you have other buyers now: he pays 10% more.' },
    { id: 'connections', icon: '🤝', name: 'Connections',    price: 350,  rank: 4, desc: 'Trader brings 50% more stock and pays 15% more.' },
    { id: 'tv',          icon: '📺', name: 'Cell TV',        price: 650,  rank: 4, desc: 'A status symbol. +6 reputation every morning.' },
    { id: 'chain',       icon: '📿', name: 'Gold Chain',     price: 950,  rank: 4, desc: 'Everyone knows who you are: +20% reputation from everything.' },
    { id: 'throne',      icon: '👑', name: 'Boss Chair',     price: 2200, rank: 5, desc: 'A real leather chair. Customers pay 15% more and +12 rep every morning.' }
];
// ---------- Services (can be bought again and again) ----------
PB.SERVICES = [
    { id: 'bribe',   icon: '💵', name: 'Bribe a guard',      rank: 0, price: s => 40 + s.day * 12, desc: 'Heat -30. The guard "forgets" a few things.' },
    { id: 'jobs',    icon: '📜', name: 'Ask around for work', rank: 0, price: () => 30, desc: 'Vinnie finds you two new job offers.' },
    { id: 'protect', icon: '🛡️', name: 'Protection deal',    rank: 2, price: s => 150 + s.day * 8, desc: 'The next time guards would confiscate your stuff, they look the other way. Once.' },
    { id: 'warden',  icon: '🗞️', name: 'Pay off the warden', rank: 3, price: () => 260, desc: 'Cancels today\'s bad event (crackdown, lockdown, K9...).' },
    { id: 'party',   icon: '🎉', name: 'Throw a block party', rank: 4, price: s => 400 + s.day * 10, desc: '+60 reputation and heat -20. Everyone loves you for a day.' }
];

// ---------- Audio (all synthesized) ----------
PB.Audio = {
    ctx: null, master: null, noiseBuf: null, amb: null,

    init() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        try {
            const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            // master → compressor (evens out loud and quiet sounds) → speakers
            this.comp = ctx.createDynamicsCompressor();
            this.comp.threshold.value = -18; this.comp.knee.value = 12; this.comp.ratio.value = 3.5;
            this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
            this.comp.connect(ctx.destination);
            this.master = ctx.createGain();
            this.master.gain.value = 0.55 * (PB.Settings ? PB.Settings.v.sfx : 1);
            this.master.connect(this.comp);
            const len = ctx.sampleRate * 2;
            this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            // concrete-and-steel echo: every sound sends a bit into a synthetic reverb
            this.verb = ctx.createConvolver();
            this.verb.buffer = this.impulse(1.6, 2.6);
            this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.22;
            this.verbIn.connect(this.verb); this.verb.connect(this.master);
            this.startAmbient();
        } catch (e) { this.ctx = null; }
    },

    // decaying stereo noise = the "room" of the reverb
    impulse(sec, decay) {
        const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 400 ? i / 400 : 1);
        }
        return buf;
    },
    // big rooms (yard, canteen) echo more; the cell less
    setRoom(kind) {
        if (!this.verbIn) return;
        this.verbIn.gain.setTargetAtTime({ cell: 0.22, canteen: 0.32, workshop: 0.28, kitchen: 0.25, yard: 0.12, escape: 0.18 }[kind] || 0.22, this.ctx.currentTime, 0.3);
    },

    tone(freq, dur, o = {}) {
        const ctx = this.ctx; if (!ctx) return;
        const t = ctx.currentTime + (o.delay || 0);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(this.out(o.pan));
        osc.start(t); osc.stop(t + dur + 0.05);
    },

    noise(dur, o = {}) {
        const ctx = this.ctx; if (!ctx) return;
        const t = ctx.currentTime + (o.delay || 0);
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
        src.playbackRate.value = o.rate || 1;
        const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
        f.frequency.setValueAtTime(o.freq || 1000, t);
        if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
        f.Q.value = o.q || 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(this.out(o.pan));
        src.start(t, Math.random()); src.stop(t + dur + 0.05);
    },

    out(pan) {
        // dry signal + a send into the reverb
        const g = this.ctx.createGain();
        g.connect(this.master);
        if (this.verbIn) g.connect(this.verbIn);
        if (!pan || !this.ctx.createStereoPanner) return g;
        const p = this.ctx.createStereoPanner(); p.pan.value = PB.clamp(pan, -1, 1); p.connect(g);
        return p;
    },

    play(name, o = {}) {
        if (!this.ctx) return;
        const v = o.vol == null ? 1 : o.vol;
        switch (name) {
            case 'pickup': this.tone(520, 0.08, { type: 'triangle', vol: 0.15 * v, to: 780 }); break;
            case 'place': this.noise(0.12, { freq: 300, q: 2, vol: 0.4 * v }); this.tone(140, 0.1, { vol: 0.15 * v }); break;
            case 'bad': this.tone(180, 0.18, { type: 'square', vol: 0.08 * v, to: 120 }); break;
            case 'click': this.tone(900, 0.04, { type: 'square', vol: 0.06 * v }); break;
            case 'drawer': this.noise(0.35, { freq: 500, to: 900, q: 3, vol: 0.25 * v }); this.tone(90, 0.12, { delay: 0.3, vol: 0.12 * v }); break;
            case 'coin':
                this.tone(1320, 0.12, { type: 'triangle', vol: 0.12 * v });
                this.tone(1760, 0.22, { type: 'triangle', vol: 0.12 * v, delay: 0.07 }); break;
            case 'cash':
                for (let i = 0; i < 4; i++) this.tone(1200 + i * 220, 0.12, { type: 'triangle', vol: 0.1 * v, delay: i * 0.06 }); break;
            case 'step': this.noise(0.09, { freq: 180, q: 1.5, vol: 0.5 * v, pan: o.pan }); this.noise(0.05, { freq: 2200, q: 2, vol: 0.06 * v, pan: o.pan }); break;
            case 'keys': for (let i = 0; i < 3; i++) this.tone(2400 + Math.random() * 1200, 0.06, { type: 'triangle', vol: 0.04 * v, delay: i * 0.05, pan: o.pan }); break;
            case 'whistle': this.tone(1800, 0.18, { vol: 0.15 * v, to: 2400 }); this.tone(2400, 0.3, { vol: 0.15 * v, delay: 0.2, to: 1600 }); break;
            case 'alert': this.tone(660, 0.15, { type: 'square', vol: 0.08 * v }); this.tone(880, 0.25, { type: 'square', vol: 0.08 * v, delay: 0.15 }); break;
            case 'caught': this.tone(300, 0.25, { type: 'sawtooth', vol: 0.12 * v, to: 150 }); this.tone(200, 0.4, { type: 'sawtooth', vol: 0.12 * v, delay: 0.2, to: 90 }); break;
            case 'flush': this.noise(1.4, { freq: 600, to: 200, q: 0.7, vol: 0.35 * v, attack: 0.1 }); break;
            case 'paper': this.noise(0.18, { freq: 3500, q: 0.8, vol: 0.18 * v }); break;
            case 'stamp': this.noise(0.08, { freq: 200, q: 1, vol: 0.6 * v }); this.tone(90, 0.12, { vol: 0.25 * v }); break;
            case 'pop': this.tone(400, 0.08, { vol: 0.15 * v, to: 900 }); break;
            case 'success':
                [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.12 * v, delay: i * 0.08 })); break;
            case 'rank':
                [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, { type: 'square', vol: 0.06 * v, delay: i * 0.09 })); break;
            case 'fail': [392, 330, 262].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.12 * v, delay: i * 0.12 })); break;
            case 'lamp': this.tone(1500, 0.03, { type: 'square', vol: 0.06 * v }); this.noise(0.05, { freq: 4000, vol: 0.05 * v }); break;
            case 'bell': [880, 880].forEach((f, i) => this.tone(f, 0.5, { type: 'square', vol: 0.05 * v, delay: i * 0.6 })); break;
            case 'sleep': this.tone(392, 0.6, { vol: 0.1 * v, to: 196 }); break;
            case 'squish': this.noise(0.12, { freq: 400, q: 4, vol: 0.3 * v, to: 200 }); break;
            case 'lick': this.noise(0.15, { freq: 1200, q: 3, vol: 0.15 * v, to: 600 }); break;
            case 'cork': this.tone(600, 0.06, { vol: 0.2 * v, to: 200 }); break;
            case 'scrape': this.noise(0.12, { freq: PB.rand(1800, 2600), q: 3, vol: 0.3 * v, to: 900 }); this.noise(0.06, { freq: 300, q: 2, vol: 0.2 * v }); break;
            case 'crumble': this.noise(0.4, { freq: 400, q: 0.8, vol: 0.4 * v, to: 150 }); break;
            case 'clog': this.noise(0.6, { freq: 200, q: 3, vol: 0.4 * v, to: 90 }); this.tone(110, 0.4, { type: 'sawtooth', vol: 0.06 * v, to: 70 }); break;
            // ----- newer sounds -----
            case 'clang': // steel door / bars
                [180, 263, 397, 541].forEach((f, i) => this.tone(f, 1.2 - i * 0.2, { type: 'triangle', vol: 0.07 * v, pan: o.pan }));
                this.noise(0.08, { freq: 2500, q: 1, vol: 0.3 * v, pan: o.pan }); break;
            case 'door': this.noise(0.5, { freq: 300, to: 120, q: 1.5, vol: 0.3 * v }); this.play('clang', { vol: 0.6 * v }); break;
            case 'thud': this.tone(70, 0.25, { vol: 0.35 * v, to: 40 }); this.noise(0.12, { freq: 250, q: 1, vol: 0.4 * v }); break;
            case 'hit': this.noise(0.1, { freq: 900, q: 0.8, vol: 0.6 * v }); this.tone(120, 0.18, { type: 'square', vol: 0.12 * v, to: 60 }); break;
            case 'swish': this.noise(0.18, { freq: 1800, to: 600, q: 1.2, vol: 0.25 * v }); break;
            case 'bounce': this.tone(160, 0.12, { vol: 0.3 * v, to: 90 }); this.noise(0.05, { freq: 600, vol: 0.2 * v }); break;
            case 'swoosh': this.noise(0.35, { freq: 3000, to: 5000, q: 2, vol: 0.18 * v }); break; // ball through the net
            case 'cheer': this.noise(1.6, { freq: 1100, q: 0.5, vol: 0.25 * v, attack: 0.15 }); for (let i = 0; i < 5; i++) this.tone(PB.rand(500, 900), 0.3, { type: 'sawtooth', vol: 0.02 * v, delay: i * 0.12 }); break;
            case 'grunt': this.tone(PB.rand(110, 150), 0.25, { type: 'sawtooth', vol: 0.06 * v, to: 90 }); this.noise(0.2, { freq: 600, q: 2, vol: 0.08 * v }); break;
            case 'chop': this.noise(0.05, { freq: 1500, q: 1, vol: 0.45 * v }); this.tone(220, 0.06, { vol: 0.1 * v }); break;
            case 'sizzle': this.noise(0.9, { type: 'highpass', freq: 3500, q: 0.5, vol: 0.12 * v, attack: 0.05 }); break;
            case 'plate': this.tone(1800, 0.25, { type: 'triangle', vol: 0.06 * v }); this.tone(2650, 0.2, { type: 'triangle', vol: 0.04 * v }); break;
            case 'rake': this.noise(0.3, { freq: 2200, to: 1200, q: 0.7, vol: 0.2 * v }); break;
            case 'engine': this.tone(55, 1.2, { type: 'sawtooth', vol: 0.12 * v, to: 110 }); this.noise(1.2, { freq: 200, q: 0.6, vol: 0.2 * v }); break;
            case 'crash': this.noise(1.0, { freq: 800, to: 200, q: 0.4, vol: 0.7 * v }); this.play('clang', { vol: v }); break;
            case 'siren': for (let i = 0; i < 4; i++) { this.tone(700, 0.45, { type: 'square', vol: 0.04 * v, to: 1100, delay: i * 0.9 }); this.tone(1100, 0.45, { type: 'square', vol: 0.04 * v, to: 700, delay: i * 0.9 + 0.45 }); } break;
            case 'pickupScrap': this.tone(300, 0.08, { type: 'square', vol: 0.06 * v }); this.noise(0.1, { freq: 1500, q: 2, vol: 0.15 * v }); break;
            case 'drip': this.tone(PB.rand(1400, 2200), 0.08, { vol: 0.05 * v, to: 600, pan: o.pan }); break;
        }
    },

    // Random background sounds so the block feels alive: distant doors, voices, drips at night.
    ambT: 0,
    ambience(dt, area, night) {
        if (!this.ctx) return;
        this.ambT -= dt;
        if (this.ambT > 0) return;
        this.ambT = PB.rand(3, 9);
        const pan = PB.rand(-0.9, 0.9), r = Math.random();
        if (area === 'cell') {
            if (night) {
                if (r < 0.45) this.play('drip', { vol: 0.6, pan });
                else if (r < 0.7) this.noise(1.5, { freq: 160, q: 2, vol: 0.05, pan, attack: 0.4 }); // someone snoring
                else this.play('clang', { vol: 0.12, pan });
            } else {
                if (r < 0.4) this.noise(2.2, { freq: PB.rand(400, 800), q: 3, vol: 0.05, pan, attack: 0.5 }); // voices down the block
                else if (r < 0.7) this.play('clang', { vol: 0.15, pan });
                else this.play('door', { vol: 0.25 });
            }
        }
    },

    // Continuous sound whose volume can be driven every frame (grinding, pouring...)
    loop(kind) {
        const ctx = this.ctx;
        if (!ctx) return { set() {}, stop() {} };
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain(); g.gain.value = 0;
        if (kind === 'grind') { f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2; src.playbackRate.value = 0.6; }
        else if (kind === 'pour') { f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.6; }
        else if (kind === 'sand') { f.type = 'highpass'; f.frequency.value = 2500; }
        else { f.type = 'lowpass'; f.frequency.value = 600; }
        src.connect(f); f.connect(g); g.connect(this.master); if (this.verbIn) g.connect(this.verbIn); src.start();
        return {
            set(v) { g.gain.setTargetAtTime(PB.clamp(v, 0, 1) * 0.35, ctx.currentTime, 0.04); },
            stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { try { src.stop(); } catch (e) {} }, 300); }
        };
    },

    startAmbient() {
        const ctx = this.ctx;
        const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 55;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
        const g = ctx.createGain(); g.gain.value = 0.02;
        hum.connect(lp); lp.connect(g); g.connect(this.master); hum.start();
        this.amb = g;
    },

    setVolume(v) {
        if (this.master) this.master.gain.setTargetAtTime(0.55 * v, this.ctx.currentTime, 0.05);
    },

    setAmbient(night) {
        if (!this.amb) return;
        this.amb.gain.setTargetAtTime(night ? 0.045 : 0.02, this.ctx.currentTime, 1);
    }
};
