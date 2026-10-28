'use strict';
// Digging the tunnel: scrape the spoon left and right across the hole. Loud! Rubble piles up on your floor.
PB.DigGame = class {
    constructor(cell, side = 1) {
        this.cell = cell;
        this.side = side;                  // which wall: 1 = local -x, 2 = local +x
        this.sx = side === 1 ? -1 : 1;
        this.H = PB.World.HOLES[side];
        this.zc = (this.H.z0 + this.H.z1) / 2;
        this.tunnel = PB.World.tunnelAt(cell, side);
        this.id = 'dig';
        this.title = 'Digging the Tunnel';
        this.keepHeld = true; // the spoon stays in your hand
        this.scrapes = 0;
    }
    progress() { return PB.World.tunnelP(this.tunnel); }

    begin() {
        const M = PB.Mini, W = PB.World, sx = this.sx, zc = this.zc;
        M.view([sx * 0.72, 1.12, zc], [sx * 1.6, 1.0, zc]);
        M.workLight.position.set(sx * 0.85, 1.5, zc); // light the hole, not the desk
        const h = PB.Player.held;
        if (h) h.mesh.visible = false;
        this.spoon = new THREE.Group();
        const handle = W.box(0.16, 0.009, 0.022, 0xc8ccd6, 0.09, 0, 0, this.spoon);
        handle.castShadow = false;
        W.sph(0.028, 0xd8dce6, 0, 0, 0, this.spoon, 12).scale.set(1.2, 0.4, 0.9);
        this.spoon.position.set(sx * 1.45, 1.0, zc);
        this.spoon.rotation.z = -0.5;
        if (sx > 0) this.spoon.rotation.y = Math.PI; // handle points back into the room
        M.root.add(this.spoon);
        this.lastZ = null; this.dir = 0; this.travel = 0; this.done = false;
        M.step('Dig through the wall', 'Hold <b>LMB</b> and scrape the spoon <b>left and right</b> across the hole. Digging is loud, so stop when you hear footsteps! Flush the rubble before morning.');
        M.buttons([{ label: 'Stop', cls: 'red', fn: () => PB.Mini.abort() }]);
    }
    cleanup() {
        const h = PB.Player.held;
        if (h) h.mesh.visible = true;
        PB.Mini.workLight.position.set(0.4, 1.45, 1.45);
    }
    onAbort() { PB.UI.toast(`You stopped digging. Tunnel ${Math.round(this.progress() * 100)}% done.`); }

    // mouse ray against the wall face, in cell-local coordinates
    tip() {
        const M = PB.Mini, root = M.root;
        if (PB.VR.isOn()) { const hp = M.handLocal('right'); if (hp) return hp; } // VR: the spoon is wherever your hand is
        const recess = Math.min(0.2, this.progress() * 0.2);
        const pt = root.localToWorld(new THREE.Vector3(this.sx * (1.5 + recess - 0.03), 1, this.zc));
        const n = new THREE.Vector3(1, 0, 0).transformDirection(root.matrixWorld);
        const hit = M.ray().ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, pt), new THREE.Vector3());
        return hit ? root.worldToLocal(hit) : null;
    }

    scrape(t) {
        const M = PB.Mini, P = PB.Player;
        this.scrapes++;
        PB.Audio.play('scrape');
        for (let i = 0; i < 7; i++) {
            M.particles.spawn({
                x: t.x + 0.02, y: t.y, z: t.z + PB.rand(-0.03, 0.03),
                vx: PB.rand(0.15, 0.6), vy: PB.rand(0, 0.6), vz: PB.rand(-0.3, 0.3),
                size: PB.rand(0.006, 0.014), color: PB.choice([0x8e8a84, 0x6f6b66, 0xa8a49c]), tag: 'dust', floor: 0.005
            });
        }
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'dig', cell: this.cell, side: this.side, uid: P.held.uid });
        else if (PB.Tunnel.addDig(this.cell, P.held, this.side)) { this.finish('Your spoon broke! Get a new one at lunch or from Vinnie.'); }
    }

    finish(msg) {
        if (this.done) return;
        this.done = true;
        PB.Mini.step('Done digging', msg);
        PB.Mini.buttons([{ label: 'Done', cls: 'orange', fn: () => PB.Mini.close() }]);
    }

    update(dt) {
        const M = PB.Mini, s = PB.state, P = PB.Player;
        if (this.done) return;
        if (!P.held || P.held.type !== 'spoon') { this.finish('Your spoon broke! Get a new one at lunch or from Vinnie.'); return; }
        if (this.progress() >= 1) { this.finish('The tunnel is through! Lift the poster and press E on the hole to crawl.'); PB.Audio.play('success'); return; }
        const t = this.tip();
        if (!t) return;
        const H = this.H;
        t.y = PB.clamp(t.y, 0.6, 1.5); t.z = PB.clamp(t.z, H.z0 - 0.25, H.z1 + 0.25);
        const sp = this.spoon.position;
        sp.x = PB.damp(sp.x, t.x, 20, dt); sp.y = PB.damp(sp.y, t.y, 20, dt); sp.z = PB.damp(sp.z, t.z, 20, dt);
        const inHole = t.y > H.y0 && t.y < H.y1 && t.z > H.z0 && t.z < H.z1;
        this.spoon.rotation.x = PB.damp(this.spoon.rotation.x, M.mouse.down && inHole ? (this.dir || 1) * 0.4 : 0, 12, dt);
        if (M.mouse.down && inHole) {
            if (this.lastZ != null) {
                const dz = t.z - this.lastZ, sgn = Math.sign(dz);
                if (Math.abs(dz) > 0.0015 && sgn !== this.dir) {
                    if (this.travel > 0.08) this.scrape(t);
                    this.dir = sgn; this.travel = 0;
                } else this.travel += Math.abs(dz);
            }
            this.lastZ = t.z;
        } else { this.lastZ = null; this.travel = 0; }
    }

    drawHUD(c, w, h) {
        const M = PB.Mini, D = M.D, p = this.progress(), P = PB.Player;
        const x = w / 2 - 200, y = 140, bw = 400;
        D.progress(c, x, y, bw, 28, p, '#a8a49c');
        [[0.6, 'Items fit'], [1, 'Crawl']].forEach(([f, l]) => {
            c.fillStyle = M.INK; c.fillRect(x + bw * f - 2, y - 6, 4, 40);
            D.small(c, l, x + bw * f, y + 50, 14, '#fff');
        });
        D.text(c, `Tunnel ${Math.round(p * 100)}%`, w / 2, y - 22, 24);
        if (P.held && P.held.type === 'spoon') D.text(c, `🥄 ${P.held.charges} uses left`, w / 2, h - 190, 20);
        const H = this.H;
        if (!M.mouse.down) D.marker(c, new THREE.Vector3(this.sx * 1.5, (H.y0 + H.y1) / 2 + 0.08, this.zc), 'Scrape here');
    }
};
