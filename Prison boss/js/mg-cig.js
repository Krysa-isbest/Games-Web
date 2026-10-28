'use strict';
// Cigarette rolling in 3D: grind -> lay a paper -> shake tobacco onto it -> roll -> lick & seal.
const PL = 0.17, PW = 0.075, CATCH = 0.015; // paper length/width; tobacco this close to the edge still counts

PB.CigGame = class {
    constructor(craft) {
        this.c = craft;
        this.id = 'cig';
        this.title = 'Rolling Cigarettes';
        this.made = 0;
    }

    // ---------- Work in progress ----------
    snapshot() {
        if (this.phase === 'grind') return this.prog > 0 ? { phase: 'grind', prog: this.prog, okT: this.okT, totT: this.totT } : null;
        const s = { phase: this.phase, grindQ: this.grindQ };
        if (this.phase === 'paper' || this.phase === 'result' || !this.paper) return { phase: 'paper', grindQ: this.grindQ };
        const pp = this.paper.mesh.position;
        Object.assign(s, { px: pp.x, pz: pp.z, segs: this.segs, total: this.total, waste: this.waste });
        s.bits = PB.Mini.particles.list.filter(p => p.alive && p.data === 'paper').map(p => [p.x, p.y, p.z, p.color, p.size]);
        if (this.phase === 'roll') Object.assign(s, { fillQ: this.fillQ, rollProg: this.prog, okT: this.okT, totT: this.totT });
        if (this.phase === 'seal') Object.assign(s, { fillQ: this.fillQ, rollQ: this.rollQ });
        return s;
    }
    restore(w) {
        const M = PB.Mini;
        PB.UI.toast('Picking up where you left off.');
        if (w.phase === 'grind') { this.startGrind(); this.prog = w.prog; this.okT = w.okT; this.totT = w.totT; return; }
        this.grindQ = w.grindQ;
        if (w.phase === 'paper') { this.startPaper(); return; }
        this.phase = 'paper';
        this.paper = this.makePaper(new THREE.Vector3(w.px, 0, w.pz));
        this.paper.mesh.position.set(w.px, M.deskY, w.pz);
        this.startShake();
        this.segs = w.segs; this.total = w.total; this.waste = w.waste;
        w.bits.forEach(b => {
            const p = M.particles.spawn({ x: b[0], y: b[1], z: b[2], color: b[3], size: b[4], tag: 'tob', floor: b[1] });
            p.rest = true; p.data = 'paper';
        });
        if (w.phase === 'roll' || w.phase === 'seal') {
            this.startRoll();
            this.fillQ = w.fillQ;
            if (w.phase === 'roll') { this.prog = w.rollProg; this.okT = w.okT; this.totT = w.totT; }
            else { this.rollQ = w.rollQ; this.startSeal(); }
        }
    }

    begin() {
        const M = PB.Mini, W = PB.World, Y = M.deskY;
        // grinder (stolen pepper grinder) or a pile of leaves crushed by hand
        this.hasGrinder = this.c.hasGrinder();
        this.grinder = new THREE.Group(); this.grinder.position.set(0.14, Y, 1.62);
        this.lid = new THREE.Group();
        if (this.hasGrinder) {
            W.cyl(0.05, 0.05, 0.035, 0x6b4a2a, 0, 0.0175, 0, this.grinder, 20);
            this.lid.position.y = 0.035; this.grinder.add(this.lid);
            W.cyl(0.052, 0.052, 0.03, 0x8a6a4a, 0, 0.015, 0, this.lid, 20);
            W.cyl(0.015, 0.015, 0.012, 0xc0c0c8, 0, 0.036, 0, this.lid, 12);
            for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; W.box(0.01, 0.032, 0.01, 0x4a3018, Math.cos(a) * 0.052, 0.015, Math.sin(a) * 0.052, this.lid); }
        } else {
            this.grinder.add(this.lid);
            for (let i = 0; i < 9; i++) {
                const leaf = W.box(0.05, 0.004, 0.025, i % 2 ? 0x8a5a2c : 0x6b4423, Math.cos(i * 2.3) * 0.03, 0.004 + i * 0.003, Math.sin(i * 2.3) * 0.03, this.lid);
                leaf.rotation.y = i * 0.9;
            }
            this.leaves = this.lid.children.slice();
        }
        M.prop(this.grinder);
        // aim shadow under the pouch shows where the tobacco will land
        this.aim = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
        this.aim.rotation.x = -Math.PI / 2; this.aim.visible = false;
        M.root.add(this.aim);
        // rolling paper pack
        this.pack = new THREE.Group(); this.pack.position.set(0.04, Y, 1.87);
        W.box(0.08, 0.015, 0.05, 0xf4f0e8, 0, 0.0075, 0, this.pack);
        W.box(0.082, 0.005, 0.052, 0xd8452b, 0, 0.017, 0, this.pack);
        W.box(0.03, 0.002, 0.02, 0xffffff, 0, 0.0205, 0, this.pack);
        M.prop(this.pack);
        // tobacco pouch (grab & shake)
        const prem = this.c.premium();
        this.pouch = new THREE.Group(); this.pouch.position.set(0.74, Y, 1.62);
        W.box(0.11, 0.07, 0.09, prem ? 0x4f7d3a : 0x9c6b3c, 0, 0.035, 0, this.pouch);
        W.box(0.11, 0.02, 0.04, prem ? 0x3b602b : 0x7a5130, 0, 0.075, -0.025, this.pouch);
        W.box(0.07, 0.003, 0.04, prem ? 0xffd700 : 0xf2d16b, 0, 0.071, 0.02, this.pouch);
        for (let i = 0; i < 4; i++) W.sph(0.012, 0x6b4423, -0.03 + i * 0.02, 0.072, 0.015, this.pouch, 6);
        this.pouchP = M.prop(this.pouch, { grab: 'hold', holdY: Y + 0.2, tiltable: true, tiltMax: 1.7, pad: 0.06, canGrab: () => this.phase === 'shake' });
        // finished pile
        this.pile = new THREE.Group(); this.pile.position.set(0.72, Y, 1.88); M.root.add(this.pile);
        this.flying = null;
        this.sand = PB.Audio.loop('sand');
        const w = M.wip(this.id);
        if (w) this.restore(w); else this.next();
    }

    // One grind is enough for 3 cigarettes; after that the grinder (or your hand) needs refilling.
    ground() { return (PB.state.wip && PB.state.wip.ground) || { n: 0, q: 0 }; }
    next() {
        const g = this.ground();
        if (g.n > 0) { this.grindQ = g.q; this.startPaper(); }
        else this.startGrind();
    }

    cleanup() {
        if (this.loop) this.loop.stop();
        if (this.sand) this.sand.stop();
        this.loop = this.sand = null;
    }
    onAbort() { PB.UI.toast(this.made ? `Stopped. Rolled ${this.made} cigarette${this.made > 1 ? 's' : ''}.` : 'Stopped rolling.'); }

    // ---------- Phases ----------
    startGrind() {
        this.phase = 'grind';
        this.prog = 0; this.okT = 0; this.totT = 0; this.lastA = null; this.speed = 0;
        this.revs = this.hasGrinder ? 3.5 : 5;
        if (this.leaves) this.leaves.forEach(l => { l.visible = true; l.scale.set(1, 1, 1); });
        this.loop = PB.Audio.loop('grind');
        PB.Mini.step('Step 1 · ' + (this.hasGrinder ? 'Grind the tobacco' : 'Crush the tobacco by hand'),
            this.hasGrinder
                ? 'Hold <b>LMB</b> and circle the mouse around the <b>grinder</b>. Keep the speed in the green zone. One grind is enough for 3 cigarettes.'
                : 'No grinder! Hold <b>LMB</b> and circle the mouse to crush the leaves. Works, but quality is lower. (Steal a pepper grinder at lunch!)');
        PB.Mini.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    startPaper() {
        this.phase = 'paper';
        if (this.paper) { PB.Mini.removeProp(this.paper); this.paper = null; }
        if (this.cig) { PB.Mini.root.remove(this.cig); this.cig = null; }
        PB.Mini.step(`Step 2 · Lay down a paper (cigarette #${this.made + 1})`, 'Click the <b>paper pack</b>, hold the button, drag the paper onto a free spot on the desk and let go.');
        PB.Mini.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    startShake() {
        this.phase = 'shake';
        this.segs = [0, 0, 0, 0, 0]; this.total = 0; this.waste = 0; this.emit = 0;
        PB.Mini.step('Step 3 · Shake on the tobacco', '<b>Grab the pouch</b> (hold LMB), move it over the paper and <b>shake the mouse</b> to sprinkle tobacco. Hold <b>RMB</b> to tip it for a steady trickle. Fill all 5 parts evenly!');
        PB.Mini.buttons([{ label: 'Done shaking', cls: 'green', fn: () => this.startRoll() }, { label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    startRoll() {
        if (this.phase !== 'shake') return;
        if (this.total < 20) { PB.UI.toast('Put more tobacco on the paper first!', 'bad'); return; }
        const M = PB.Mini;
        const sc = this.segs.map(n => n >= 12 && n <= 24 ? 100 : n < 12 ? n / 12 * 85 : Math.max(0, 100 - (n - 24) * 4));
        const wasteRatio = this.waste / Math.max(1, this.waste + this.total);
        this.fillQ = PB.clamp(sc.reduce((a, b) => a + b, 0) / 5 - Math.max(0, wasteRatio - 0.1) * 40, 0, 100);
        if (M.grabbed === this.pouchP) M.drop();
        this.pouch.position.copy(this.pouchP.home); this.pouchP.state = 'rest';
        this.sand.set(0);
        this.aim.visible = false;
        this.phase = 'roll';
        this.prog = 0; this.vel = 0; this.okT = 0; this.totT = 0; this.lastY = M.mouse.y;
        const pp = this.paper.mesh.position;
        this.roll = PB.World.cyl(0.006, 0.006, 0.17, 0xfbfaf3, pp.x, pp.y + 0.006, pp.z - PW / 2, M.root, 12);
        this.roll.rotation.z = Math.PI / 2;
        M.step('Step 4 · Roll it up', 'Hold <b>LMB</b> and drag the mouse <b>upward</b> slowly and smoothly. Keep the speed in the green zone.');
        M.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    startSeal() {
        const M = PB.Mini, pp = this.paper.mesh.position;
        M.root.remove(this.roll); this.roll = null;
        this.paper.mesh.visible = false;
        M.particles.list.forEach(p => { if (p.data === 'paper') p.alive = false; });
        this.cig = new THREE.Group(); this.cig.position.set(pp.x, pp.y + 0.009, pp.z);
        const body = PB.World.cyl(0.009, 0.009, 0.12, 0xf7f3ea, 0.015, 0, 0, this.cig, 12); body.rotation.z = Math.PI / 2;
        const fil = PB.World.cyl(0.0095, 0.0095, 0.03, 0xe0913a, -0.06, 0, 0, this.cig, 12); fil.rotation.z = Math.PI / 2;
        M.root.add(this.cig);
        this.phase = 'seal';
        this.t = 0; this.zone = PB.rand(0.25, 0.75); this.zw = 0.12;
        M.step('Step 5 · Lick & seal', 'Click when the tongue is over the <b>green glue strip</b>!');
    }
    finish(sealQ) {
        const M = PB.Mini;
        this.sealQ = sealQ;
        const q = PB.clamp(this.grindQ * 0.15 + this.fillQ * 0.4 + this.rollQ * 0.3 + sealQ * 0.15 + this.c.bonus() + PB.rand(-3, 3), 0, 100);
        this.c.produce(q);
        this.made++;
        const g = this.ground();
        PB.state.wip.ground = { n: Math.max(0, g.n - 1), q: g.q };
        this.phase = 'result';
        PB.Audio.play(q >= 64 ? 'success' : 'pop');
        this.flying = { mesh: this.cig, from: this.cig.position.clone(), t: 0 };
        this.cig = null;
        M.step('Done!', `Rolled ${this.made} this session. They go on your desk.`);
        M.showResult(q, 'Cigarette rolled!', `Grind ${Math.round(this.grindQ)} · Fill ${Math.round(this.fillQ)} · Roll ${Math.round(this.rollQ)} · Seal ${Math.round(sealQ)}`);
        const more = this.c.canContinue();
        M.buttons([
            { label: more ? 'Roll another' : 'Out of tobacco/papers', cls: 'green', disabled: !more, fn: () => this.next() },
            { label: 'Done', cls: 'orange', fn: () => PB.Mini.close() }
        ]);
    }

    // ---------- Input ----------
    down() {
        const M = PB.Mini;
        if (this.phase === 'paper' && !this.paper) {
            if (M.pick([this.pack])) {
                const tgt = M.handAt(M.deskY + 0.12) || this.pack.position.clone();
                this.paper = this.makePaper(tgt);
                M.grabProp(this.paper);
                PB.Audio.play('paper');
            }
        } else if (this.phase === 'seal') {
            const pos = (Math.sin(this.t * 3.2) + 1) / 2;
            const d = Math.abs(pos - this.zone);
            PB.Audio.play('lick');
            this.finish(PB.clamp(100 - Math.max(0, d - this.zw / 2) * 450, 0, 100));
        }
    }
    // VR: grip next to the paper pack pulls a paper out into your hand
    vrGrab(hp, side) {
        if (this.phase !== 'paper' || this.paper) return;
        if (hp.distanceTo(this.pack.position) > 0.18) return;
        this.paper = this.makePaper(hp);
        this.paper.vrHand = side;
        PB.Mini.grabProp(this.paper);
        PB.Audio.play('paper');
    }
    makePaper(pos) {
        const M = PB.Mini, W = PB.World;
        const g = new THREE.Group();
        this.sheet = W.box(PL, 0.002, PW, 0xfbfaf3, 0, 0.001, 0, g);
        W.box(PL, 0.0024, 0.008, 0xf0d98a, 0, 0.0013, PW / 2 - 0.004, g);
        g.position.set(pos.x, M.deskY + 0.12, pos.z);
        const p = M.prop(g, { grab: 'hold', holdY: M.deskY + 0.12, pad: 0.09, canGrab: () => this.phase === 'paper' });
        p.onLand = () => {
            if (this.phase !== 'paper') return;
            const gp = this.grinder.position;
            if (Math.abs(g.position.x - gp.x) < 0.14 && Math.abs(g.position.z - gp.z) < 0.08) {
                PB.UI.toast('Not on the grinder! Pick it up and place it on a free spot.', 'bad');
                return;
            }
            this.startShake();
        };
        return p;
    }

    particleLand(p) {
        if (p.tag === 'fx') return 'kill';
        if (p.tag !== 'tob' || this.phase !== 'shake') return;
        const pp = this.paper.mesh.position;
        if (Math.abs(p.x - pp.x) < PL / 2 + CATCH && Math.abs(p.z - pp.z) < PW / 2 + CATCH) {
            const seg = PB.clamp(Math.floor((p.x - (pp.x - PL / 2)) / (PL / 5)), 0, 4);
            this.segs[seg]++; this.total++;
            p.data = 'paper';
            // slightly pull edge bits onto the paper so it looks like it landed there
            p.x = PB.clamp(p.x, pp.x - PL / 2 + 0.004, pp.x + PL / 2 - 0.004);
            p.z = PB.clamp(p.z, pp.z - PW / 2 + 0.004, pp.z + PW / 2 - 0.004);
            p.y = p.floor = pp.y + 0.003 + Math.min(this.segs[seg], 30) * 0.00025 + Math.random() * 0.002;
        } else this.waste++;
    }

    // ---------- Update ----------
    update(dt) {
        const M = PB.Mini, m = M.mouse;
        if (this.phase === 'grind') {
            const cpos = M.project(this.grinder.position.clone().add(new THREE.Vector3(0, 0.05, 0)));
            const a = Math.atan2(m.y - cpos.y, m.x - cpos.x), dist = Math.hypot(m.x - cpos.x, m.y - cpos.y);
            if (m.down && dist > 15 && dist < 300) {
                if (this.lastA != null) {
                    let d = a - this.lastA;
                    if (d > Math.PI) d -= Math.PI * 2;
                    if (d < -Math.PI) d += Math.PI * 2;
                    this.speed = PB.damp(this.speed, Math.abs(d) / Math.max(dt, 0.001), 6, dt);
                    this.prog += Math.abs(d) / (Math.PI * 2 * this.revs);
                    this.lid.rotation.y -= d;
                    if (this.leaves) this.leaves.forEach((l, i) => { const k = Math.max(0.25, 1 - this.prog * 0.75); l.scale.set(k, 1, k); });
                    this.totT += dt;
                    if (this.speed > 3 && this.speed < 10) this.okT += dt;
                    if (Math.random() < 0.25) {
                        const gp = this.grinder.position;
                        M.particles.spawn({ x: gp.x + PB.rand(-0.04, 0.04), y: gp.y + 0.07, z: gp.z + PB.rand(-0.04, 0.04), vx: PB.rand(-0.3, 0.3), vy: PB.rand(0.3, 0.8), vz: PB.rand(-0.3, 0.3), tag: 'fx', color: 0x6b4423 });
                    }
                }
                this.lastA = a;
            } else { this.lastA = null; this.speed = PB.damp(this.speed, 0, 6, dt); }
            this.loop.set(this.speed / 9);
            if (this.prog >= 1) {
                // crushing by hand can never be as good as a real grinder
                this.grindQ = PB.clamp((this.okT / Math.max(this.totT, 0.01)) * 100 + 8, 0, this.hasGrinder ? 100 : 70);
                this.loop.stop(); this.loop = null;
                PB.state.wip.ground = { n: 3, q: this.grindQ };
                PB.Audio.play('pop');
                PB.UI.toast('Ground enough tobacco for 3 cigarettes.');
                this.startPaper();
            }
        } else if (this.phase === 'shake') {
            const pp = this.pouchP;
            let rate = 0;
            if (M.grabbed === pp) {
                // only real shaking (quick changes of direction) knocks tobacco out, not calmly carrying the pouch
                const acc = this.lastVel ? pp.vel.clone().sub(this.lastVel).length() / Math.max(dt, 0.001) : 0;
                this.lastVel = pp.vel.clone();
                this.shakeAmt = PB.damp(this.shakeAmt || 0, acc, 10, dt);
                this.grabT = (this.grabT || 0) + dt; // ignore the jolt of picking it up
                rate = this.grabT < 0.5 ? 0 : PB.clamp((this.shakeAmt - 6) * 12, 0, 70) + (pp.tiltAmt > 0.8 ? 35 : 0);
                this.emit += rate * dt;
                const pos = this.pouch.position;
                while (this.emit >= 1) {
                    this.emit--;
                    M.particles.spawn({
                        x: pos.x + PB.rand(-0.02, 0.02), y: pos.y + 0.01, z: pos.z + PB.rand(-0.012, 0.012),
                        vx: pp.vel.x * 0.07 + PB.rand(-0.04, 0.04), vy: PB.rand(-0.1, 0.1), vz: pp.vel.z * 0.07 + PB.rand(-0.03, 0.03),
                        size: PB.rand(0.005, 0.009), color: PB.choice([0xa0703c, 0xb07a40, 0x8a5a2c, 0xc08850]), tag: 'tob'
                    });
                }
            }
            if (M.grabbed !== pp) { this.lastVel = null; this.shakeAmt = 0; this.grabT = 0; }
            this.sand.set(rate / 70);
            this.aim.visible = M.grabbed === pp;
            if (this.aim.visible) this.aim.position.set(this.pouch.position.x, M.deskY + 0.004, this.pouch.position.z);
        } else if (this.phase === 'roll') {
            const dy = m.y - this.lastY;
            this.lastY = m.y;
            if (m.down && dy < 0) {
                this.prog += -dy / 450;
                this.vel = PB.damp(this.vel, -dy / Math.max(dt, 0.001), 10, dt);
                this.totT += dt;
                if (this.vel > 220 && this.vel < 900) this.okT += dt;
                if (Math.random() < 0.1) PB.Audio.play('paper', { vol: 0.25 });
            } else this.vel = PB.damp(this.vel, 0, 8, dt);
            const p = Math.min(1, this.prog), pp = this.paper.mesh.position;
            const rollZ = pp.z - PW / 2 + p * PW;
            this.roll.position.z = rollZ;
            this.roll.scale.set(1 + p * 0.6, 1, 1 + p * 0.6);
            this.sheet.scale.z = Math.max(0.02, 1 - p);
            this.sheet.position.z = p * PW / 2;
            M.particles.list.forEach(q => { if (q.alive && q.data === 'paper' && q.z < rollZ) q.alive = false; });
            if (this.prog >= 1) {
                this.rollQ = PB.clamp((this.okT / Math.max(this.totT, 0.01)) * 100 + 5, 0, 100);
                this.startSeal();
            }
        } else if (this.phase === 'seal') this.t += dt;

        if (this.flying) {
            const f = this.flying;
            f.t = Math.min(1, f.t + dt * 2);
            const to = this.pile.position.clone().add(new THREE.Vector3(0, 0.01 + Math.floor((this.made - 1) / 5) * 0.018, -0.04 + ((this.made - 1) % 5) * 0.02));
            f.mesh.position.lerpVectors(f.from, to, f.t);
            f.mesh.position.y += Math.sin(f.t * Math.PI) * 0.12;
            f.mesh.scale.setScalar(1 - f.t * 0.3);
            if (f.t >= 1) { PB.Audio.play('place', { vol: 0.3 }); this.flying = null; }
        }
    }

    // ---------- HUD ----------
    drawHUD(c, w, h) {
        const M = PB.Mini, D = M.D, V = THREE.Vector3;
        if (this.phase === 'grind') {
            const s = M.project(this.grinder.position.clone().add(new V(0, 0.06, 0)));
            c.setLineDash([10, 12]); c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.5)';
            c.beginPath(); c.arc(s.x, s.y, 110, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
            D.text(c, '⟳', s.x + 110, s.y - 10 + Math.sin(performance.now() / 150) * 5, 36, '#ffd23f');
            const sv = PB.clamp(this.speed / 14, 0, 1);
            const mx = s.x + 170, my = s.y - 130;
            D.panel(c, mx, my, 40, 240, '#fff4d6', 10, 3);
            c.fillStyle = '#7ee08a'; c.fillRect(mx + 3, my + 240 * (1 - 10 / 14), 34, 240 * (7 / 14));
            c.fillStyle = M.INK; c.fillRect(mx - 6, my + 240 * (1 - sv) - 3, 52, 6);
            D.text(c, 'Speed', mx + 20, my - 18, 18);
            D.progress(c, w / 2 - 180, h - 190, 360, 26, this.prog);
        } else if (this.phase === 'paper') {
            if (!this.paper) D.marker(c, this.pack.position.clone().add(new V(0, 0.03, 0)), 'Grab a paper');
        } else if (this.phase === 'shake') {
            if (M.grabbed !== this.pouchP) D.marker(c, this.pouch.position.clone().add(new V(0, 0.09, 0)), 'Grab & shake!');
            const pp = this.paper.mesh.position;
            for (let i = 0; i < 5; i++) {
                const s = M.project(new V(pp.x - PL / 2 + PL / 10 + i * PL / 5, pp.y, pp.z + 0.06));
                D.vmeter(c, s.x - 9, s.y - 80, 18, 60, this.segs[i] / 28, 12 / 28, 24 / 28);
            }
            D.text(c, `Spilled: ${this.waste}`, w / 2, h - 190, 22, this.waste > this.total * 0.4 ? '#ff8a80' : '#fff');
            const g = this.ground();
            D.small(c, `Ground tobacco left: ${g.n} cigarette${g.n !== 1 ? 's' : ''}`, w / 2, h - 165, 15, '#fff');
        } else if (this.phase === 'roll') {
            D.meter(c, w / 2 - 180, 150, 360, 26, this.vel / 1100, 220 / 1100, 900 / 1100, 'Rolling speed');
            D.progress(c, w / 2 - 180, h - 190, 360, 26, this.prog);
            D.text(c, '▲', w / 2 + 240, h / 2 + Math.sin(performance.now() / 150) * 12, 60, '#ffd23f');
        } else if (this.phase === 'seal') {
            const bw = 420, bx = w / 2 - bw / 2, by = h - 210;
            D.panel(c, bx, by, bw, 34, '#fff4d6', 10, 3);
            c.fillStyle = '#7ee08a'; c.fillRect(bx + bw * (this.zone - this.zw / 2), by + 3, bw * this.zw, 28);
            const tx = bx + bw * (Math.sin(this.t * 3.2) + 1) / 2;
            c.save(); c.translate(tx, by - 36);
            D.rr(c, -18, -8, 36, 56, 18); c.fillStyle = '#ff7a9a'; c.fill(); c.lineWidth = 4; c.strokeStyle = M.INK; c.stroke();
            c.fillStyle = '#e0587a'; c.fillRect(-2, 0, 4, 32);
            c.restore();
        }
    }
};
