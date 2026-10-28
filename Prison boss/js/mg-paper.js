'use strict';
// Paper forging in 3D: type the permit code -> pick up the pen and trace the signature -> slam the stamp.
PB.PaperGame = class {
    constructor(craft) {
        this.c = craft;
        this.id = 'doc';
        this.title = 'Forging Papers';
        this.made = 0;
        this.CW = 480; this.CH = 660;
        this.SW = 0.24; this.SH = 0.33;
    }

    begin() {
        const M = PB.Mini, W = PB.World, Y = M.deskY;
        M.view([0.38, 1.24, 1.42], [0.38, 0.8, 1.72]);
        this.center = new THREE.Vector3(0.38, Y + 0.002, 1.7);

        // the document (canvas texture, rotated so it reads correctly from the camera)
        this.cv = document.createElement('canvas'); this.cv.width = this.CW; this.cv.height = this.CH;
        this.g = this.cv.getContext('2d');
        this.tex = new THREE.CanvasTexture(this.cv);
        this.tex.center.set(0.5, 0.5); this.tex.rotation = Math.PI;
        this.doc = new THREE.Mesh(new THREE.PlaneGeometry(this.SW, this.SH), new THREE.MeshToonMaterial({ map: this.tex }));
        this.doc.rotation.x = -Math.PI / 2;
        this.doc.position.copy(this.center);
        this.mx = M.mirror ? -1 : 1; // un-mirror the text inside the mirrored neighbour cell
        this.doc.scale.x = this.mx;
        this.doc.receiveShadow = true;
        M.root.add(this.doc);

        // pen (outer group = position, inner = orientation, origin at the nib)
        this.pen = new THREE.Group(); this.pen.position.set(0.12, Y + 0.008, 1.64);
        this.penIn = new THREE.Group(); this.pen.add(this.penIn);
        W.cyl(0.0, 0.006, 0.02, 0xc0c0c8, 0, 0.01, 0, this.penIn, 10);
        W.cyl(0.007, 0.007, 0.12, 0x1e1e2a, 0, 0.08, 0, this.penIn, 10);
        W.cyl(0.008, 0.008, 0.035, 0xd4af37, 0, 0.13, 0, this.penIn, 10);
        this.penIn.rotation.set(0, 0, Math.PI / 2);
        this.penP = M.prop(this.pen, {
            grab: 'sticky', holdY: Y + 0.003, pad: 0.02, restY: Y + 0.008,
            canGrab: () => this.phase === 'sign',
            follow: (t, dt) => {
                this.pen.position.x = PB.damp(this.pen.position.x, t.x, 30, dt);
                this.pen.position.z = PB.damp(this.pen.position.z, t.z, 30, dt);
                this.pen.position.y = PB.damp(this.pen.position.y, Y + 0.002 + (this.drawing ? 0 : 0.018), 25, dt);
            }
        });
        this.penP.onLand = () => { this.penIn.rotation.set(0, 0, Math.PI / 2); };

        // stamp
        this.hasStamp = this.c.hasStamp();
        if (this.hasStamp) {
            this.stamp = new THREE.Group(); this.stamp.position.set(0.66, Y, 1.86);
            W.box(0.07, 0.025, 0.06, 0x8a2c2c, 0, 0.0125, 0, this.stamp);
            W.box(0.066, 0.005, 0.056, 0xd23a3a, 0, 0.0025, 0, this.stamp);
            W.cyl(0.012, 0.016, 0.05, 0x7b4a28, 0, 0.05, 0, this.stamp, 10);
            W.sph(0.022, 0x7b4a28, 0, 0.085, 0, this.stamp, 10);
            this.stampP = M.prop(this.stamp, { grab: 'sticky', holdY: Y + 0.1, pad: 0.04, canGrab: () => this.phase === 'stamp' });
        }
        this.pile = new THREE.Group(); this.pile.position.set(0.74, Y, 1.62); M.root.add(this.pile);
        this.flying = null;
        const w = M.wip(this.id);
        if (w) this.restore(w); else this.startCode();
    }

    // ---------- Work in progress ----------
    snapshot() {
        if (this.phase === 'result' || this.slam) return null;
        if (this.phase === 'code' && this.typed === 0) return null;
        return {
            phase: this.phase, docType: this.docType, code: this.code, typed: this.typed, errors: this.errors,
            elapsed: this.t0 ? (performance.now() - this.t0) / 1000 : 0,
            codeQ: this.codeQ, signQ: this.signQ, path: this.path, ink: this.ink,
            prog: this.prog, dev: this.dev, samples: this.samples, lifts: this.lifts
        };
    }
    restore(w) {
        PB.UI.toast('Picking up where you left off.');
        this.startCode();
        Object.assign(this, {
            docType: w.docType, code: w.code, typed: w.typed, errors: w.errors, path: w.path, ink: w.ink,
            t0: performance.now() - w.elapsed * 1000
        });
        if (w.phase === 'code') { this.redraw(); return; }
        this.t0 = performance.now() - w.elapsed * 1000;
        this.startSign();
        Object.assign(this, { codeQ: w.codeQ, prog: w.prog, dev: w.dev, samples: w.samples, lifts: w.lifts });
        if (w.phase === 'stamp') { this.signQ = w.signQ; if (this.hasStamp) this.startStamp(); else this.finish(); }
        this.redraw();
    }

    onAbort() { PB.UI.toast(this.made ? `Stopped. Forged ${this.made} document${this.made > 1 ? 's' : ''}.` : 'Stopped forging.'); }

    // world position on the paper -> canvas pixel
    toCanvas(v) {
        return {
            x: (0.5 - this.mx * (v.x - this.center.x) / this.SW) * this.CW,
            y: (0.5 + (this.center.z - v.z) / this.SH) * this.CH
        };
    }
    toWorld(x, y) {
        return new THREE.Vector3(this.center.x + this.mx * (0.5 - x / this.CW) * this.SW, this.center.y, this.center.z - (y / this.CH - 0.5) * this.SH);
    }

    // ---------- Phases ----------
    startCode() {
        const A = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 8; i++) s += (i === 3 ? '-' : A[PB.randi(0, A.length - 1)]);
        this.docType = PB.choice(['TRANSFER PERMIT', 'VISITOR PASS', 'KITCHEN DUTY SLIP', 'PAROLE MEMO', 'LIBRARY PASS', 'MEDICAL NOTE']);
        this.code = s; this.typed = 0; this.errors = 0; this.t0 = null; this.shake = 0;
        this.ink = []; this.stampAt = null; this.drawing = false;
        this.makePath();
        this.doc.visible = true; this.doc.position.copy(this.center); this.doc.scale.set(this.mx, 1, 1);
        this.phase = 'code';
        this.redraw();
        const n = this.hasStamp ? 3 : 2;
        PB.Mini.step(`Step 1/${n} · Copy the permit number`, 'Type the code from the original card <b>exactly</b>. Fast and without mistakes!');
        PB.Mini.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    makePath() {
        const ctrl = [];
        for (let i = 0; i < 7; i++) ctrl.push({ x: 90 + i * 50 + PB.rand(-10, 10), y: 560 + PB.rand(-28, 28) });
        const pts = [];
        for (let i = 0; i < ctrl.length - 1; i++) {
            const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
            for (let t = 0; t < 1; t += 0.1) {
                const t2 = t * t, t3 = t2 * t;
                const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
                pts.push({ x: f('x'), y: f('y') });
            }
        }
        pts.push(ctrl[ctrl.length - 1]);
        this.path = pts;
    }
    startSign() {
        const time = (performance.now() - this.t0) / 1000;
        this.codeQ = PB.clamp(100 - this.errors * 12 - Math.max(0, time - 5) * 5, 0, 100);
        this.phase = 'sign';
        this.prog = 0; this.dev = 0; this.samples = 0; this.lifts = 0;
        this.redraw();
        PB.Mini.step(`Step 2/${this.hasStamp ? 3 : 2} · Forge the signature`, '<b>Click the pen</b> to pick it up. Then hold <b>LMB</b> to press it on the paper and trace the faint signature from the <b>green dot</b> to the end.');
    }
    startStamp() {
        this.phase = 'stamp';
        if (PB.Mini.grabbed === this.penP) PB.Mini.drop();
        PB.Mini.step('Step 3/3 · Stamp it', '<b>Click the stamp</b> to pick it up, hover it over the <b>APPROVED box</b> and click to slam it down!');
    }
    finish() {
        const M = PB.Mini;
        if (M.grabbed) M.drop();
        const q = PB.clamp(this.hasStamp ? this.codeQ * 0.35 + this.signQ * 0.45 + this.stampQ * 0.2 : this.codeQ * 0.4 + this.signQ * 0.6, 0, 100);
        this.c.produce(q, this.hasStamp);
        this.made++;
        this.phase = 'result';
        PB.Audio.play(q >= 64 ? 'success' : 'pop');
        this.flying = { from: this.doc.position.clone(), t: 0 };
        M.step('Done!', `Forged ${this.made} this session. They go on your desk.`);
        M.showResult(q, this.hasStamp ? 'Stamped papers forged!' : 'Papers forged!',
            `Code ${Math.round(this.codeQ)} · Signature ${Math.round(this.signQ)}${this.hasStamp ? ` · Stamp ${Math.round(this.stampQ)}` : ''}`);
        const more = this.c.canContinue();
        M.buttons([
            { label: more ? 'Forge another' : 'Out of paper', cls: 'green', disabled: !more, fn: () => this.startCode() },
            { label: 'Done', cls: 'orange', fn: () => PB.Mini.close() }
        ]);
    }

    // ---------- Input ----------
    key(e) {
        if (this.phase !== 'code' || e.key.length !== 1) return;
        if (this.t0 == null) this.t0 = performance.now();
        if (e.key.toUpperCase() === this.code[this.typed]) {
            this.typed++;
            PB.Audio.play('click');
            this.redraw();
            if (this.typed >= this.code.length) setTimeout(() => { if (this.phase === 'code') this.startSign(); }, 300);
        } else { this.errors++; this.shake = 0.3; PB.Audio.play('bad'); }
    }
    down(prop) {
        if (this.phase === 'sign' && prop === this.penP) {
            const tip = this.toCanvas(this.pen.position), p = this.path[this.prog];
            if (Math.hypot(p.x - tip.x, p.y - tip.y) < 26) {
                if (this.prog > 0) this.lifts++;
                this.drawing = true;
                this.ink.push([]);
            } else PB.UI.toast('Start at the green dot!', 'bad', 1.5);
        } else if (this.phase === 'stamp' && prop === this.stampP && !this.slam) {
            this.slam = { t: 0, hit: false };
        }
    }
    up() { this.drawing = false; }
    onGrab(p) {
        if (p === this.penP) this.penIn.rotation.set(-0.45, 0, -0.35);
    }

    nearest(x, y, from, to) {
        let best = Infinity, bi = from;
        for (let i = Math.max(0, from); i <= Math.min(this.path.length - 1, to); i++) {
            const d = Math.hypot(this.path[i].x - x, this.path[i].y - y);
            if (d < best) { best = d; bi = i; }
        }
        return { d: best, i: bi };
    }

    // ---------- Update ----------
    update(dt) {
        const M = PB.Mini;
        this.shake = Math.max(0, this.shake - dt);
        if (this.phase === 'sign' && this.drawing) {
            if (!M.mouse.down) this.drawing = false;
            else {
                const tip = this.toCanvas(this.pen.position);
                const n = this.nearest(tip.x, tip.y, this.prog - 3, this.prog + 10);
                this.dev += n.d; this.samples++;
                const stroke = this.ink[this.ink.length - 1], last = stroke[stroke.length - 1];
                if (!last || Math.hypot(last.x - tip.x, last.y - tip.y) > 1.5) { stroke.push(tip); this.redraw(); }
                if (n.d < 18 && n.i > this.prog) this.prog = n.i;
                if (this.prog >= this.path.length - 2) {
                    this.drawing = false;
                    const avg = this.dev / Math.max(1, this.samples);
                    this.signQ = PB.clamp(110 - avg * 5 - this.lifts * 6, 0, 100);
                    PB.Audio.play('paper');
                    this.redraw();
                    if (this.hasStamp) this.startStamp(); else this.finish();
                }
            }
        }
        if (this.slam) {
            const s = this.slam, Y = M.deskY;
            s.t += dt;
            const k = s.t < 0.08 ? s.t / 0.08 : Math.max(0, 1 - (s.t - 0.08) / 0.25);
            this.stamp.position.y = PB.lerp(Y + 0.1, Y + 0.003, k);
            if (!s.hit && s.t >= 0.08) {
                s.hit = true;
                const c = this.toCanvas(this.stamp.position);
                this.stampAt = c;
                this.stampQ = PB.clamp(100 - Math.hypot(c.x - 360, c.y - 330) * 1.6, 0, 100);
                PB.Audio.play('stamp');
                this.redraw();
            }
            if (s.t > 0.4) { this.slam = null; this.finish(); }
        }
        if (this.flying) {
            const f = this.flying;
            f.t = Math.min(1, f.t + dt * 2);
            const to = this.pile.position.clone().add(new THREE.Vector3(0, 0.003 * this.made, 0));
            this.doc.position.lerpVectors(f.from, to, f.t);
            this.doc.position.y += Math.sin(f.t * Math.PI) * 0.08;
            const sc = 1 - f.t * 0.45;
            this.doc.scale.set(this.mx * sc, sc, sc);
            if (f.t >= 1) {
                this.flying = null;
                this.doc.visible = false;
                const sheet = PB.World.box(0.13, 0.002, 0.18, this.hasStamp ? 0xf6e2c8 : 0xf6efd8, 0, 0.002 + this.made * 0.003, 0, this.pile);
                sheet.rotation.y = PB.rand(-0.2, 0.2);
            }
        }
    }

    // ---------- Document texture ----------
    redraw() {
        const g = this.g, W = this.CW, H = this.CH;
        g.fillStyle = '#f6efd8'; g.fillRect(0, 0, W, H);
        g.strokeStyle = '#c9bfa5'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#6a5f78'; g.font = '800 16px Nunito, sans-serif'; g.fillText('DEPARTMENT OF CORRECTIONS', W / 2, 40);
        g.fillStyle = '#3a3550'; g.font = '34px "Luckiest Guy", Impact, sans-serif'; g.fillText(this.docType, W / 2, 78);
        g.textAlign = 'left';
        g.fillStyle = '#6a5f78'; g.font = '800 15px Nunito, sans-serif'; g.fillText('PERMIT No.', 40, 145);
        g.fillStyle = '#fff'; g.fillRect(150, 120, 290, 50);
        g.strokeStyle = '#3a3550'; g.lineWidth = 3; g.strokeRect(150, 120, 290, 50);
        g.font = '800 28px "Courier New", monospace';
        for (let i = 0; i < this.code.length; i++) {
            g.fillStyle = i < this.typed ? '#1f2f9a' : 'rgba(60,50,80,.18)';
            g.fillText(this.code[i], 163 + i * 34, 146);
        }
        g.fillStyle = '#c9bfa5';
        for (let i = 0; i < 6; i++) g.fillRect(40, 215 + i * 26, 200 + ((i * 53) % 50), 7);
        g.setLineDash([6, 6]); g.strokeStyle = '#b8a888'; g.lineWidth = 3;
        g.strokeRect(305, 275, 110, 110); g.setLineDash([]);
        g.textAlign = 'center'; g.fillStyle = '#b8a888'; g.font = '800 13px Nunito, sans-serif'; g.fillText('APPROVED', 360, 400);
        g.fillStyle = '#3a3550'; g.fillRect(60, 615, 360, 3);
        g.fillStyle = '#6a5f78'; g.fillText('Signature of the Warden', W / 2, 638);
        if (this.phase !== 'code') {
            g.setLineDash([3, 8]); g.lineWidth = 4; g.strokeStyle = 'rgba(43,63,168,.35)'; g.lineCap = 'round';
            g.beginPath(); this.path.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]);
        }
        g.lineWidth = 4; g.strokeStyle = '#1f2f9a'; g.lineCap = 'round'; g.lineJoin = 'round';
        this.ink.forEach(s => { g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); });
        if (this.phase === 'sign') {
            const p = this.path[this.prog];
            g.fillStyle = '#3ecf6e'; g.beginPath(); g.arc(p.x, p.y, 9, 0, Math.PI * 2); g.fill();
            g.strokeStyle = '#221a2e'; g.lineWidth = 2; g.stroke();
        }
        if (this.stampAt) {
            g.save(); g.translate(this.stampAt.x, this.stampAt.y); g.rotate(-0.15);
            g.strokeStyle = 'rgba(210,58,58,.85)'; g.lineWidth = 6;
            g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.stroke();
            g.font = '20px "Luckiest Guy", Impact'; g.fillStyle = 'rgba(210,58,58,.85)'; g.fillText('APPROVED', 0, 2);
            g.restore();
        }
        this.tex.needsUpdate = true;
    }

    // ---------- HUD ----------
    drawHUD(c, w, h) {
        const M = PB.Mini, D = M.D, V = THREE.Vector3;
        if (this.phase === 'code') {
            const x = 30 + (this.shake > 0 ? Math.sin(this.shake * 80) * 6 : 0), y = h / 2 - 90;
            D.panel(c, x, y, 230, 140, '#fff4d6', 14, 4);
            D.small(c, 'Original card:', x + 115, y + 28, 16);
            c.font = '800 26px "Courier New", monospace'; c.fillStyle = M.INK; c.textAlign = 'center'; c.fillText(this.code, x + 115, y + 72);
            D.small(c, `Mistakes: ${this.errors}`, x + 115, y + 112, 15, this.errors ? '#c0392b' : M.INK);
        } else if (this.phase === 'sign') {
            if (M.grabbed !== this.penP) D.marker(c, this.pen.position.clone().add(new V(0, 0.02, 0)), 'Pick up the pen');
            else if (!this.drawing) D.marker(c, this.toWorld(this.path[this.prog].x, this.path[this.prog].y), 'Start here');
            D.progress(c, w / 2 - 160, h - 190, 320, 24, this.prog / (this.path.length - 2));
        } else if (this.phase === 'stamp' && M.grabbed !== this.stampP && !this.slam) {
            D.marker(c, this.stamp.position.clone().add(new V(0, 0.11, 0)), 'Pick up the stamp');
        } else if (this.phase === 'stamp' && M.grabbed === this.stampP && !this.slam) {
            D.marker(c, this.toWorld(360, 330), 'Slam it here!');
        }
    }
};
