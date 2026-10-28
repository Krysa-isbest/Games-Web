'use strict';
// Hooch in 3D: drop fruit into the jug, pump the masher, tip in sugar and water; later pour into bottles and cork them.

// Where liquid leaves a container tilted around z: rim edge at (-r, h) in local space.
PB.spout = (pos, tilt, r, h) => new THREE.Vector3(
    pos.x - r * Math.cos(tilt) - h * Math.sin(tilt),
    pos.y - r * Math.sin(tilt) + h * Math.cos(tilt),
    pos.z
);

function makeJug(parent, x, z, liquidCol) {
    const W = PB.World, Y = PB.Mini.deskY;
    const g = new THREE.Group(); g.position.set(x, Y, z);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.2, 24, 1, true),
        W.mat(0xbfe8ff, { transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    glass.position.y = 0.1; g.add(glass);
    W.cyl(0.08, 0.08, 0.008, W.mat(0xbfe8ff, { transparent: true, opacity: 0.45 }), 0, 0.004, 0, g, 24);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.004, 6, 24), W.mat(0xdff4ff));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.2; g.add(rim);
    const liquid = W.cyl(0.071, 0.071, 1, liquidCol, 0, 0.5, 0, g, 24);
    liquid.scale.y = 0.001;
    parent.add(g);
    return { g, liquid, set(level, col) { const hgt = Math.max(0.001, level * 0.19); liquid.scale.y = hgt; liquid.position.y = 0.006 + hgt / 2; if (col != null) liquid.material = W.mat(col); } };
}

// Where a stream leaving `s` with sideways speed vx crosses height y (for the aim dot)
PB.streamHit = (s, vx, y) => {
    if (s.y <= y) return null;
    const t = Math.sqrt(2 * (s.y - y) / 9.8);
    return new THREE.Vector3(s.x + vx * t, y, s.z);
};
PB.drawAim = (c, hit, target, radius) => {
    if (!hit) return;
    const ok = Math.hypot(hit.x - target.x, hit.z - target.z) < radius;
    const s = PB.Mini.project(hit);
    c.beginPath(); c.arc(s.x, s.y, 9, 0, Math.PI * 2);
    c.fillStyle = ok ? 'rgba(62,207,110,.85)' : 'rgba(255,77,77,.85)'; c.fill();
    c.lineWidth = 3; c.strokeStyle = PB.Mini.INK; c.stroke();
};

function bandRing(parent, r, y) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.003, 6, 28), new THREE.MeshBasicMaterial({ color: 0x3ecf6e }));
    ring.rotation.x = Math.PI / 2; ring.position.y = y;
    parent.add(ring);
    return ring;
}

// =====================================================================
// Brewing
// =====================================================================
PB.MashGame = class {
    constructor(craft) { this.c = craft; this.id = 'mash'; this.title = 'Brewing Hooch'; }

    // ---------- Work in progress ----------
    snapshot() {
        if (this.phase === 'result' || (this.phase === 'fruit' && this.inJug === 0)) return null;
        return { phase: this.phase, inJug: this.inJug, smashes: this.smashes || 0, good: this.good || 0, level: this.level, mashQ: this.mashQ, sugarQ: this.sugarQ, spill: this.spill };
    }
    restore(w) {
        const Y = PB.Mini.deskY;
        PB.UI.toast('Picking up where you left off.');
        for (let i = 0; i < w.inJug; i++) {
            const f = this.fruit[i];
            f.inJug = true; f.restY = Y + 0.006 + i * 0.03;
            f.mesh.position.set(this.jugPos.x + PB.rand(-0.02, 0.02), f.restY, this.jugPos.z + PB.rand(-0.02, 0.02));
            const k = Math.pow(0.86, w.smashes);
            f.body.scale.y *= Math.max(0.15, k);
        }
        this.inJug = w.inJug; this.level = w.level;
        if (w.phase === 'fruit') { this.startFruit(); if (this.inJug >= 3) this.startMash(); return; }
        if (w.phase === 'mash') { this.startMash(); this.smashes = w.smashes; this.good = w.good; return; }
        this.mashQ = w.mashQ;
        if (w.phase === 'water') this.sugarQ = w.sugarQ;
        this.startPour(w.phase);
        this.level = w.level; this.spill = w.spill;
        this.poured = w.phase === 'sugar' ? w.level > 0.25 : w.level > 0.4;
    }

    begin() {
        const M = PB.Mini, W = PB.World, Y = M.deskY;
        this.jug = makeJug(M.root, 0.4, 1.7, 0xc0503a);
        this.jugPos = this.jug.g.position;
        M.prop(this.jug.g);
        this.rimY = Y + 0.2;
        this.level = 0; this.inJug = 0; this.spill = 0;

        // fruit
        const spots = [[0.12, 1.52], [0.08, 1.72], [0.16, 1.9]];
        this.fruit = spots.map(([x, z], i) => {
            const f = new THREE.Group(); f.position.set(x, Y, z);
            const v = i % 3;
            const col = [0xd8322f, 0xff9a1f, 0xb8d43a][v];
            const body = W.sph(0.035, col, 0, 0.035, 0, f, 14);
            if (v === 2) body.scale.set(1, 1.25, 1);
            W.cyl(0.003, 0.003, 0.02, 0x5a3a1a, 0, 0.075, 0, f, 5);
            const p = M.prop(f, { grab: 'hold', holdY: Y + 0.32, pad: 0.04, canGrab: () => this.phase === 'fruit' && !p.inJug });
            p.body = body;
            p.onFall = pp => this.fruitFall(pp);
            return p;
        });

        // masher (sticky)
        this.masher = new THREE.Group(); this.masher.position.set(0.72, Y, 1.62);
        this.masherIn = new THREE.Group(); this.masher.add(this.masherIn);
        W.cyl(0.055, 0.055, 0.015, 0x7b4a28, 0, 0.0075, 0, this.masherIn, 18);
        W.cyl(0.01, 0.01, 0.3, 0xb4733f, 0, 0.16, 0, this.masherIn, 10);
        W.cyl(0.016, 0.016, 0.06, 0x7b4a28, 0, 0.32, 0, this.masherIn, 10);
        this.masherIn.rotation.z = Math.PI / 2; this.masherIn.position.y = 0.055;
        this.masherP = M.prop(this.masher, {
            grab: 'sticky', pad: 0.06, canGrab: () => this.phase === 'mash',
            follow: (t, dt) => {
                const mp = this.masher.position, up = PB.clamp((M.mouse.y / innerHeight - 0.25) / 0.33, 0, 1);
                mp.x = PB.damp(mp.x, this.jugPos.x, 20, dt);
                mp.z = PB.damp(mp.z, this.jugPos.z, 20, dt);
                // VR: the masher simply follows your hand's height
                const y = PB.VR.isOn() ? PB.clamp(t.y, Y + 0.035, this.rimY + 0.08) : PB.lerp(this.rimY + 0.06, Y + 0.035, up);
                mp.y = PB.damp(mp.y, y, 30, dt);
            }
        });

        // sugar bag + water bottle (hold + tilt to pour)
        this.sugar = new THREE.Group(); this.sugar.position.set(0.72, Y, 1.86);
        W.box(0.1, 0.13, 0.08, 0xf6f6f2, 0, 0.065, 0, this.sugar);
        W.box(0.102, 0.035, 0.082, 0x3d7bff, 0, 0.075, 0, this.sugar);
        this.sugarP = M.prop(this.sugar, { grab: 'hold', holdY: Y + 0.3, tiltable: true, tiltMax: 2.1, pad: 0.06, canGrab: () => this.phase === 'sugar' });
        this.water = new THREE.Group(); this.water.position.set(0.08, Y, 1.88);
        W.cyl(0.045, 0.045, 0.2, W.mat(0x7fc8ff, { transparent: true, opacity: 0.6 }), 0, 0.1, 0, this.water, 16);
        W.cyl(0.02, 0.03, 0.03, W.mat(0x7fc8ff, { transparent: true, opacity: 0.6 }), 0, 0.215, 0, this.water, 12);
        W.cyl(0.021, 0.021, 0.015, 0x3d7bff, 0, 0.235, 0, this.water, 12);
        this.waterP = M.prop(this.water, { grab: 'hold', holdY: Y + 0.3, tiltable: true, tiltMax: 2.0, pad: 0.06, canGrab: () => this.phase === 'water' });

        this.emit = 0;
        this.pour = PB.Audio.loop('pour');
        const w = M.wip(this.id);
        if (w) this.restore(w); else this.startFruit();
    }
    cleanup() { if (this.pour) this.pour.stop(); this.pour = null; }
    onAbort() { PB.UI.toast('Brew abandoned. Ingredients kept.'); }

    // ---------- Phases ----------
    startFruit() {
        this.phase = 'fruit';
        PB.Mini.step('Step 1/4 · Fruit in the jug', 'Grab each fruit (hold <b>LMB</b>), hold it <b>over the jug</b> and let go to drop it in.');
        PB.Mini.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    startMash() {
        this.phase = 'mash';
        this.smashes = 0; this.good = 0; this.armed = true; this.lastHit = null;
        PB.Mini.step('Step 2/4 · Mash it!', '<b>Click the masher</b> to grab it, then move the mouse <b>up and down</b> in a steady rhythm to crush the fruit.');
    }
    startPour(kind) {
        const M = PB.Mini;
        if (M.grabbed) M.drop();
        this.phase = kind;
        this.poured = false;
        const sugar = kind === 'sugar';
        this.band = sugar ? [0.33, 0.39] : [0.8, 0.87];
        if (this.ring) this.jug.g.remove(this.ring);
        this.ring = bandRing(this.jug.g, 0.078, 0.006 + (this.band[0] + this.band[1]) / 2 * 0.19);
        M.step(sugar ? 'Step 3/4 · Add sugar' : 'Step 4/4 · Add water',
            `Grab the ${sugar ? 'sugar bag' : 'water bottle'} (hold <b>LMB</b>), move it over the jug and hold <b>RMB</b> (or <b>Space</b>) to tip it. Stop at the <b>green ring</b>!`);
        M.buttons([{ label: 'Done pouring', cls: 'green', fn: () => this.donePour() }, { label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    pourScore() {
        const mid = (this.band[0] + this.band[1]) / 2, half = (this.band[1] - this.band[0]) / 2;
        const d = Math.abs(this.level - mid);
        const sc = d <= half ? 100 : PB.clamp(100 - (d - half) * 700, 0, 100);
        return Math.max(0, sc - this.spill * 0.6);
    }
    donePour() {
        if (!this.poured) { PB.UI.toast('Pour something in first!', 'bad'); return; }
        if (this.phase === 'sugar') { this.sugarQ = this.pourScore(); this.spill = 0; PB.Audio.play('pop'); this.startPour('water'); }
        else if (this.phase === 'water') { this.waterQ = this.pourScore(); this.finish(); }
    }
    finish() {
        const M = PB.Mini, W = PB.World;
        if (M.grabbed) M.drop();
        if (this.ring) this.jug.g.remove(this.ring);
        W.cyl(0.07, 0.07, 0.025, 0xb33a3a, 0, 0.21, 0, this.jug.g, 18);
        const q = PB.clamp(this.mashQ * 0.4 + this.sugarQ * 0.3 + this.waterQ * 0.3 + PB.rand(-3, 3), 0, 100);
        this.c.produce(q);
        this.phase = 'result';
        PB.Audio.play('cork');
        M.step('Brew started!', 'Hide the jug well. A full jug is contraband! It will be ready after one night.');
        M.showResult(q, 'Brew is fermenting!', `Mash ${Math.round(this.mashQ)} · Sugar ${Math.round(this.sugarQ)} · Water ${Math.round(this.waterQ)}`);
        M.buttons([{ label: 'Done', cls: 'orange', fn: () => PB.Mini.close() }]);
    }

    // ---------- Physics hooks ----------
    fruitFall(p) {
        const m = p.mesh, Y = PB.Mini.deskY;
        if (p.inJug || m.position.y > this.rimY) return false;
        const d = Math.hypot(m.position.x - this.jugPos.x, m.position.z - this.jugPos.z);
        if (d < 0.065) {
            p.inJug = true;
            p.restY = Y + 0.006 + this.inJug * 0.03;
            m.position.x = this.jugPos.x + (m.position.x - this.jugPos.x) * 0.5;
            m.position.z = this.jugPos.z + (m.position.z - this.jugPos.z) * 0.5;
            this.inJug++;
            PB.Audio.play('squish');
            if (this.inJug >= 3) setTimeout(() => { if (this.phase === 'fruit') this.startMash(); }, 400);
        } else if (d < 0.11) {
            const k = 0.12 / Math.max(d, 0.001);
            m.position.x = this.jugPos.x + (m.position.x - this.jugPos.x) * k;
            m.position.z = this.jugPos.z + (m.position.z - this.jugPos.z) * k;
            PB.Audio.play('click');
        }
        return false;
    }
    particleStep(p) {
        if (p.tag !== 'sugar' && p.tag !== 'water') return false;
        if (p.y < this.rimY && p.y > this.rimY - 0.05) {
            const d = Math.hypot(p.x - this.jugPos.x, p.z - this.jugPos.z);
            if (d < 0.07) { this.level = Math.min(1.1, this.level + (p.tag === 'sugar' ? 0.0028 : 0.0022)); this.poured = true; if (this.level > 1) this.spill++; return true; }
            if (d < 0.09) { this.spill++; return true; }
        }
        return false;
    }
    particleLand(p) {
        if (p.tag === 'sugar' || p.tag === 'water') { this.spill++; return 'kill'; }
    }

    // ---------- Update ----------
    update(dt) {
        const M = PB.Mini, Y = M.deskY;
        if (this.phase === 'mash' && M.grabbed === this.masherP) {
            this.masherIn.rotation.z = PB.damp(this.masherIn.rotation.z, 0, 12, dt);
            this.masherIn.position.y = PB.damp(this.masherIn.position.y, 0, 12, dt);
            const y = this.masher.position.y;
            if (y > Y + 0.12) this.armed = true;
            if (this.armed && y < Y + 0.065) {
                this.armed = false;
                this.smashes++;
                const now = performance.now() / 1000;
                if (this.lastHit == null || (now - this.lastHit > 0.22 && now - this.lastHit < 0.8)) this.good++;
                this.lastHit = now;
                PB.Audio.play('squish');
                this.fruit.forEach(f => { f.body.scale.y = Math.max(0.15, f.body.scale.y * 0.86); f.body.scale.x *= 1.03; f.body.scale.z *= 1.03; });
                this.level = Math.min(0.24, this.level + 0.017);
                for (let i = 0; i < 6; i++) M.particles.spawn({ x: this.jugPos.x + PB.rand(-0.04, 0.04), y: Y + 0.06, z: this.jugPos.z + PB.rand(-0.04, 0.04), vx: PB.rand(-0.2, 0.2), vy: PB.rand(0.3, 0.8), vz: PB.rand(-0.2, 0.2), color: 0xd0402a, tag: 'fx', size: 0.006 });
                if (this.smashes >= 14) {
                    this.mashQ = PB.clamp((this.good / this.smashes) * 100 + 5, 0, 100);
                    M.drop();
                    this.masher.position.copy(this.masherP.home); this.masherP.state = 'rest';
                    this.masherIn.rotation.z = Math.PI / 2; this.masherIn.position.y = 0.055;
                    this.startPour('sugar');
                }
            }
        }
        let flow = 0;
        if (this.phase === 'sugar' || this.phase === 'water') {
            const p = this.phase === 'sugar' ? this.sugarP : this.waterP;
            if (M.grabbed === p && p.tiltAmt > 1.0) {
                flow = (p.tiltAmt - 1.0) / (p.tiltMax - 1.0);
                this.emit += flow * (this.phase === 'sugar' ? 90 : 120) * dt;
                const s = this.phase === 'sugar' ? PB.spout(p.mesh.position, p.tiltAmt, 0.04, 0.13) : PB.spout(p.mesh.position, p.tiltAmt, 0.02, 0.23);
                while (this.emit >= 1) {
                    this.emit--;
                    M.particles.spawn({
                        x: s.x + PB.rand(-0.006, 0.006), y: s.y, z: s.z + PB.rand(-0.006, 0.006),
                        vx: -0.12 + PB.rand(-0.03, 0.03), vy: 0, vz: PB.rand(-0.02, 0.02),
                        size: this.phase === 'sugar' ? 0.005 : 0.008, stretch: this.phase === 'sugar' ? 1 : 2.5,
                        color: this.phase === 'sugar' ? 0xffffff : 0x6fb8ff, tag: this.phase
                    });
                }
            }
        }
        this.pour.set(flow);
        const col = this.phase === 'fruit' || this.phase === 'mash' ? 0xc0503a : this.phase === 'sugar' ? 0xd77a4a : 0xb86a7a;
        this.jug.set(Math.min(1, this.level), col);
    }

    // ---------- HUD ----------
    drawHUD(c, w, h) {
        const M = PB.Mini, D = M.D, V = THREE.Vector3;
        if (this.phase === 'fruit') {
            const f = this.fruit.find(x => !x.inJug && x.state === 'rest');
            if (f && !M.grabbed) D.marker(c, f.mesh.position.clone().add(new V(0, 0.09, 0)), 'Grab the fruit');
            if (M.grabbed) D.marker(c, this.jugPos.clone().add(new V(0, 0.26, 0)), 'Drop it in!');
            D.text(c, `Fruit in jug: ${this.inJug}/3`, w / 2, h - 190, 24);
        } else if (this.phase === 'mash') {
            if (M.grabbed !== this.masherP) D.marker(c, this.masher.position.clone().add(new V(0, 0.08, 0)), 'Grab the masher');
            else D.text(c, '▲▼', w / 2 + 230, h / 2, 56, '#ffd23f');
            D.progress(c, w / 2 - 160, h - 190, 320, 24, this.smashes / 14);
        } else if (this.phase === 'sugar' || this.phase === 'water') {
            const p = this.phase === 'sugar' ? this.sugarP : this.waterP;
            if (M.grabbed !== p) D.marker(c, p.mesh.position.clone().add(new V(0, 0.2, 0)), this.phase === 'sugar' ? 'Grab the sugar' : 'Grab the water');
            const s = M.project(this.jugPos.clone().add(new V(-0.12, 0.1, 0)));
            D.vmeter(c, s.x - 14, s.y - 110, 28, 220, this.level, this.band[0], this.band[1]);
            if (M.grabbed === p) {
                const sp = this.phase === 'sugar' ? PB.spout(p.mesh.position, Math.max(p.tiltAmt, 1.2), 0.04, 0.13) : PB.spout(p.mesh.position, Math.max(p.tiltAmt, 1.2), 0.02, 0.23);
                PB.drawAim(c, PB.streamHit(sp, -0.12, this.rimY), this.jugPos, 0.07);
            }
            if (this.spill > 0) D.text(c, `Spilled: ${this.spill}`, w / 2, h - 190, 22, '#ff8a80');
        }
    }
};

// =====================================================================
// Bottling
// =====================================================================
PB.BottleGame = class {
    constructor(craft) { this.c = craft; this.id = 'bottle'; this.title = 'Bottling Hooch'; this.made = 0; }

    snapshot() { return this.phase === 'pour' && this.fill > 0 ? { fill: this.fill, spill: this.spill } : null; }

    begin() {
        const M = PB.Mini, Y = M.deskY;
        M.view([0.42, 1.38, 1.0], [0.42, 1.0, 1.7]); // a bit higher so the raised jug stays in view
        this.jug = makeJug(M.root, 0.72, 1.66, 0xd9a03a);
        this.jug.set(Math.min(1, this.c.servings() / 4 * 0.85));
        // held high enough that the spout stays above the funnel even fully tipped
        this.jugP = M.prop(this.jug.g, { grab: 'hold', holdY: Y + 0.46, tiltable: true, tiltMax: 2.0, pad: 0.08, canGrab: () => this.phase === 'pour' });
        this.row = new THREE.Group(); this.row.position.set(0.1, Y, 1.9); M.root.add(this.row);
        this.emit = 0;
        this.pour = PB.Audio.loop('pour');
        this.next();
        const w = M.wip(this.id);
        if (w) { this.fill = w.fill; this.spill = w.spill; PB.UI.toast('This bottle is still half full from last time.'); }
    }
    cleanup() { if (this.pour) this.pour.stop(); this.pour = null; }
    onAbort() { PB.UI.toast(this.made ? `Stopped. Bottled ${this.made}.` : 'Stopped bottling.'); }

    makeBottle() {
        const W = PB.World, Y = PB.Mini.deskY;
        const g = new THREE.Group(); g.position.set(0.4, Y, 1.68);
        const glassMat = W.mat(0x6fbf73, { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.04, 0.13, 18, 1, true), glassMat); body.position.y = 0.065; g.add(body);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.036, 0.06, 14, 1, true), glassMat); neck.position.y = 0.16; g.add(neck);
        W.cyl(0.04, 0.04, 0.006, glassMat, 0, 0.003, 0, g, 18);
        // a little paper funnel makes pouring forgiving
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.018, 0.05, 18, 1, true), W.mat(0xf2e2c0, { side: THREE.DoubleSide }));
        funnel.position.y = 0.215; g.add(funnel);
        g.userData.funnel = funnel;
        const liquid = W.cyl(0.035, 0.035, 1, 0xe0a030, 0, 0.5, 0, g, 16);
        liquid.scale.y = 0.001;
        g.userData.liquid = liquid;
        PB.Mini.root.add(g);
        return g;
    }

    next() {
        const M = PB.Mini, Y = M.deskY;
        if (this.cork) { M.removeProp(this.corkP); this.cork = null; }
        this.bottle = this.makeBottle();
        this.fill = 0; this.spill = 0; this.corked = false;
        this.band = [0.8, 0.9];
        this.ring = bandRing(this.bottle, 0.03, 0.19 * 0.85);
        this.cork = new THREE.Group(); this.cork.position.set(0.58, Y, 1.9);
        PB.World.cyl(0.016, 0.013, 0.03, 0xb98a5a, 0, 0.015, 0, this.cork, 10);
        this.corkP = M.prop(this.cork, { grab: 'hold', holdY: Y + 0.26, pad: 0.03, canGrab: () => this.phase === 'pour' && this.fill > 0.1 });
        this.corkP.onFall = p => this.corkFall(p);
        this.phase = 'pour';
        M.step(`Bottle #${this.made + 1}`, 'Grab the jug (hold <b>LMB</b>), hold it above the bottle and hold <b>RMB</b>/<b>Space</b> to tip it. Fill to the <b>green ring</b>, then drop the <b>cork</b> onto the bottle!');
        M.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }

    corkFall(p) {
        const m = p.mesh, top = PB.Mini.deskY + 0.19;
        if (this.corked || m.position.y > top + 0.01) return false;
        const bp = this.bottle.position;
        const d = Math.hypot(m.position.x - bp.x, m.position.z - bp.z);
        if (d < 0.03) {
            this.corked = true;
            m.position.set(bp.x, top - 0.008, bp.z);
            p.state = 'rest'; p.restY = top - 0.008;
            PB.Audio.play('cork');
            this.finishBottle();
            return true;
        }
        return false;
    }

    finishBottle() {
        const M = PB.Mini;
        const mid = (this.band[0] + this.band[1]) / 2, half = (this.band[1] - this.band[0]) / 2;
        const d = Math.abs(this.fill - mid);
        const sc = Math.max(0, (d <= half ? 100 : PB.clamp(100 - (d - half) * 400, 0, 100)) - this.spill * 0.8);
        this.pourQ = sc;
        const jq = this.c.jugQ();
        const q = PB.clamp(jq * 0.6 + sc * 0.4 + PB.rand(-2, 2), 0, 100);
        this.c.produce(q);
        this.made++;
        this.phase = 'result';
        this.bottle.remove(this.ring);
        this.bottle.remove(this.bottle.userData.funnel);
        this.jug.set(Math.min(1, this.c.servings() / 4 * 0.85));
        // slide the finished bottle into the row
        this.slide = { mesh: this.bottle, cork: this.cork, from: this.bottle.position.clone(), to: this.row.position.clone().add(new THREE.Vector3(0.06 * (this.made - 1), 0, 0)), t: 0 };
        M.removeProp(this.corkP); M.root.add(this.cork); this.cork = null;
        M.step('Corked!', 'One more bottle of the good stuff.');
        M.showResult(q, 'Hooch bottled!', `Brew ${Math.round(jq)} · Pour ${Math.round(sc)}`);
        const more = this.c.canContinue();
        M.buttons([
            { label: more ? 'Next bottle' : 'Jug empty / no bottles', cls: 'green', disabled: !more, fn: () => this.next() },
            { label: 'Done', cls: 'orange', fn: () => PB.Mini.close() }
        ]);
    }

    particleStep(p) {
        if (p.tag !== 'hooch') return false;
        const bp = this.bottle.position, top = PB.Mini.deskY + 0.24; // funnel rim
        const d = Math.hypot(p.x - bp.x, p.z - bp.z);
        if (p.y < top && p.y > top - 0.04 && d < 0.055) {
            this.fill += 0.011;
            if (this.fill > 1) { this.fill = 1; this.spill++; }
            return true;
        }
        if (p.y < top - 0.05 && d < 0.042) { this.spill++; return true; }
        return false;
    }
    particleLand(p) { if (p.tag === 'hooch') { this.spill++; return 'kill'; } }

    update(dt) {
        const M = PB.Mini;
        let flow = 0;
        if (this.phase === 'pour' && M.grabbed === this.jugP && this.jugP.tiltAmt > 1.0 && this.c.servings() > 0) {
            flow = (this.jugP.tiltAmt - 1.0) / (this.jugP.tiltMax - 1.0);
            this.emit += flow * 110 * dt;
            const s = PB.spout(this.jug.g.position, this.jugP.tiltAmt, 0.076, 0.2);
            while (this.emit >= 1) {
                this.emit--;
                M.particles.spawn({ x: s.x + PB.rand(-0.004, 0.004), y: s.y, z: s.z + PB.rand(-0.004, 0.004), vx: -0.1 + PB.rand(-0.02, 0.02), vy: 0, vz: PB.rand(-0.01, 0.01), size: 0.008, stretch: 2.5, color: 0xe0a030, tag: 'hooch' });
            }
        }
        this.pour.set(flow);
        if (this.bottle) {
            const liq = this.bottle.userData.liquid, hgt = Math.max(0.001, this.fill * 0.19);
            liq.scale.y = hgt; liq.position.y = 0.004 + hgt / 2;
            const r = this.fill * 0.19 > 0.13 ? 0.017 / 0.035 : 1;
            liq.scale.x = liq.scale.z = r;
        }
        if (this.slide) {
            const s = this.slide;
            s.t = Math.min(1, s.t + dt * 2.5);
            s.mesh.position.lerpVectors(s.from, s.to, s.t);
            s.cork.position.set(s.mesh.position.x, s.mesh.position.y + 0.182, s.mesh.position.z);
            if (s.t >= 1) this.slide = null;
        }
    }

    drawHUD(c, w, h) {
        const M = PB.Mini, D = M.D, V = THREE.Vector3;
        if (this.phase !== 'pour') return;
        if (M.grabbed !== this.jugP && this.fill < 0.1) D.marker(c, this.jug.g.position.clone().add(new V(0, 0.26, 0)), 'Grab the jug');
        else if (M.grabbed === this.jugP) D.marker(c, this.bottle.position.clone().add(new V(0, 0.24, 0)), 'Pour here');
        else if (this.fill > 0.1 && M.grabbed !== this.corkP) D.marker(c, this.cork.position.clone().add(new V(0, 0.05, 0)), 'Cork it!');
        const s = M.project(this.bottle.position.clone().add(new V(-0.09, 0.1, 0)));
        D.vmeter(c, s.x - 14, s.y - 100, 28, 200, this.fill, this.band[0], this.band[1]);
        if (M.grabbed === this.jugP) {
            const sp = PB.spout(this.jug.g.position, Math.max(this.jugP.tiltAmt, 1.2), 0.076, 0.2);
            PB.drawAim(c, PB.streamHit(sp, -0.1, PB.Mini.deskY + 0.24), this.bottle.position, 0.055);
        }
        if (this.spill > 0) D.text(c, `Spilled: ${this.spill}`, w / 2, h - 190, 22, '#ff8a80');
    }
};
