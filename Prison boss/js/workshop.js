'use strict';
// The wood workshop (unlocked at rank Big Shot, shift 14:00 – 16:00). Built only while you're there.
// Saw planks at your bench for pay... or secretly carve the pieces of a fake key.
// A guard walks around checking the benches: when he looks your way, SWITCH to the real job (F / VR B),
// or he takes the key blank and you lose that piece's progress.
PB.Workshop = (() => {
    const S = { scene: null, interactables: [], colliders: [], bounds: { x0: -5.6, x1: 5.6, z0: -4.6, z1: 4.6 }, active: false, pockets: [] };
    const SHIFT = 120, VIEW = 5.5, FOV = 0.6, JOB_STROKES = 14, KEY_STROKES = 22;
    let W, guard = null, workers = [], bench = null, plank = null, blank = null, sawMesh = null;
    let mode = 'job', progress = 0, dir = 0, travel = 0, lastHand = null, sawPos = 0;
    const $ = id => document.getElementById(id);

    S.allowed = () => !!PB.state && PB.rankOf(PB.state.rep) >= 3;

    // which key piece is next: the first one you don't own yet
    function nextPart() {
        return PB.KEY_PARTS.find(t => !PB.Items.list.some(i => i.type === t) && !S.pockets.includes(t)) || null;
    }
    const wip = () => { PB.state.wip = PB.state.wip || {}; return PB.state.wip.key || (PB.state.wip.key = { prog: 0 }); };

    // ---------- Enter / leave ----------
    S.enter = () => {
        if (S.active || PB.Mini.active || PB.Lunch.active) return;
        if (S.wentDay === PB.state.day) { PB.UI.toast('Your shift is over for today.', 'bad'); return; }
        S.wentDay = PB.state.day;
        PB.Player.stashHeld();
        fade(() => {
            W = PB.World;
            build();
            W.area = 'workshop';
            W.activeScene = S.scene;
            S.scene.add(W.rig);
            S.cell = PB.Player.cell;
            PB.Player.pos.set(0, 1.6, -0.3); PB.Player.yaw = Math.PI; PB.Player.pitch = -0.5;
            S.active = true; S.time = SHIFT; S.pockets = []; S.earned = 0;
            setMode('job'); progress = 0;
            $('shop-hud').classList.remove('hidden');
            PB.UI.toast('🪚 Workshop shift. Saw at your bench: hold the mouse button and move up and down. F switches to the secret key piece.', '', 7);
        });
    };

    S.exit = forced => {
        if (!S.active) return;
        S.active = false; S.sawing = false;
        const frisked = Math.random() < 0.3;
        const lost = frisked ? S.pockets.filter(t => PB.ITEMS[t].contraband) : [];
        const got = S.pockets.filter(t => !lost.includes(t));
        fade(() => {
            W.area = 'cell';
            W.activeScene = W.scene;
            W.scene.add(W.rig);
            dispose();
            const P = PB.Player;
            P.cell = S.cell;
            P.pos.copy(W.cells[S.cell].toWorld(0.2, 1.6, -1.2)); P.yaw = Math.PI; P.pitch = -0.1;
            $('shop-hud').classList.add('hidden');
            if (forced) PB.UI.toast('🔔 Shift is over! Back to your cell.');
            if (S.earned) PB.UI.toast(`🪵 You earned $${S.earned} today.`, 'good');
            if (frisked) {
                PB.UI.toast(lost.length ? '👮 "Arms up!" The guard found the key piece in your pocket!' : '👮 "Arms up!" You got frisked, but they found nothing.', lost.length ? 'bad' : '', 5);
                if (lost.length) addHeat(20);
            }
            if (got.length) {
                if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'pockets', cell: S.cell, types: got });
                else PB.Lunch.unpack(S.cell, got);
                PB.UI.toast(`You smuggled back: ${got.map(t => PB.ITEMS[t].name).join(', ')}. Hide it!`, 'good', 5);
            }
            S.pockets = [];
        });
    };
    S.abort = () => {
        if (!S.active) return;
        S.active = false; S.sawing = false;
        W.area = 'cell'; W.activeScene = W.scene; W.scene.add(W.rig);
        dispose();
        $('shop-hud').classList.add('hidden');
        PB.Player.cell = S.cell || '';
        PB.Player.pos.copy(W.cells[PB.Player.cell].toWorld(0, 1.6, 0.6));
    };

    function fade(fn) {
        const f = $('fade');
        f.classList.add('on');
        setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 150); }, 650);
    }
    function addHeat(n) {
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'heat', n });
        else PB.state.heat += n;
    }
    function pay(n) {
        S.earned += n;
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'workshopPay', n });
        else { PB.Game.addMoney(n); PB.Game.progress('shift', 1); }
    }

    // ---------- The room ----------
    function inter(obj, def) { obj.userData.interact = def; S.interactables.push(obj); }
    const col = (x0, x1, z0, z1) => S.colliders.push({ x0, x1, z0, z1 });

    function build() {
        const sc = S.scene = new THREE.Scene();
        sc.background = new THREE.Color(0x2a2230);
        S.interactables = []; S.colliders = []; workers = [];
        const gfx = PB.Settings.v.gfx;
        sc.add(new THREE.HemisphereLight(0xfff0dd, 0x5a4a3a, 0.7));
        const sun = new THREE.DirectionalLight(0xfff0d0, 0.7);
        sun.position.set(-6, 8, 4); sun.castShadow = gfx !== 'low';
        sun.shadow.mapSize.set(1024, 1024);
        Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
        sc.add(sun);
        [[-3, 0], [3, 0]].forEach(([x, z]) => { const p = new THREE.PointLight(0xffd9a0, 0.6, 10, 2); p.position.set(x, 2.8, z); sc.add(p); });

        // wooden floor, brick walls
        const floor = W.canvasTex(256, 256, (g, w) => {
            for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#a8763f' : '#b8854b'; g.fillRect(0, i * 32, w, 32); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, i * 32, w, 2); }
            for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(60,30,10,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * w, 6, 1); }
        });
        floor.wrapS = floor.wrapT = THREE.RepeatWrapping; floor.repeat.set(4, 3);
        W.box(12, 0.1, 10, new THREE.MeshToonMaterial({ map: floor, gradientMap: W.grad() }), 0, -0.05, 0, sc);
        W.box(12, 0.1, 10, 0x5a4a3a, 0, 3.25, 0, sc);
        const brick = W.canvasTex(256, 128, (g, w, h) => {
            g.fillStyle = '#9a4a32'; g.fillRect(0, 0, w, h);
            g.strokeStyle = '#c8b8a0'; g.lineWidth = 3;
            for (let r = 0; r < 8; r++) for (let c = 0; c < 5; c++) g.strokeRect(c * 56 + (r % 2) * 28 - 20, r * 16, 56, 16);
        });
        brick.wrapS = brick.wrapT = THREE.RepeatWrapping; brick.repeat.set(4, 2);
        const bm = new THREE.MeshToonMaterial({ map: brick, gradientMap: W.grad() });
        W.box(12, 3.3, 0.2, bm, 0, 1.65, 5.1, sc); W.box(12, 3.3, 0.2, bm, 0, 1.65, -5.1, sc);
        W.box(0.2, 3.3, 10, bm, 6.1, 1.65, 0, sc); W.box(0.2, 3.3, 10, bm, -6.1, 1.65, 0, sc);
        // tools on the wall, lumber stacks, sawdust
        for (let i = 0; i < 6; i++) { const t = W.box(0.05, 0.5, 0.2, 0x8a8f9a, -4 + i * 0.6, 2.0, 4.95, sc); t.rotation.z = (i % 2 ? 0.2 : -0.2); }
        for (let i = 0; i < 8; i++) W.box(2.2, 0.08, 0.2, 0xc8964a, 4.6, 0.05 + i * 0.09, -3.6 + (i % 2) * 0.05, sc);
        col(3.4, 5.8, -4.0, -3.2);
        for (let i = 0; i < 25; i++) { const d = W.box(PB.rand(0.1, 0.3), 0.01, PB.rand(0.1, 0.3), 0xe2c48a, PB.rand(-5, 5), 0.005, PB.rand(-4, 4), sc); d.castShadow = false; }
        const sign = W.canvasTex(512, 128, g => {
            g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#221a2e'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
            g.fillStyle = '#221a2e'; g.font = 'bold 60px Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('WOOD WORKSHOP', 256, 68);
        });
        const sm = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshToonMaterial({ map: sign, gradientMap: W.grad() }));
        sm.position.set(0, 2.7, 4.98); sm.rotation.y = Math.PI; sc.add(sm);

        // exit door
        const door = new THREE.Group(); door.position.set(0, 0, -5.0); sc.add(door);
        W.box(1.4, 2.4, 0.1, 0x7a8ca8, 0, 1.2, 0, door);
        inter(door, { prompt: () => `${PB.key('E')} Finish your shift (back to the cell)`, use: () => S.exit(false) });

        // workbenches: yours in the middle, two other inmates at theirs
        const makeBench = (x, z) => {
            const g = new THREE.Group(); g.position.set(x, 0, z); sc.add(g);
            W.box(1.6, 0.08, 0.8, 0xa8763f, 0, 0.9, 0, g);
            [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]].forEach(([dx, dz]) => W.box(0.08, 0.9, 0.08, 0x6b4423, dx, 0.45, dz, g));
            W.box(0.15, 0.1, 0.15, 0x3a3550, 0.65, 0.98, 0.25, g); // vice
            col(x - 0.85, x + 0.85, z - 0.45, z + 0.45);
            return g;
        };
        bench = makeBench(0, 0.9);
        plank = W.box(1.1, 0.04, 0.22, 0xd9a86a, 0, 0.96, 0, bench);
        blank = new THREE.Group(); blank.position.set(0, 0.96, 0); bench.add(blank);
        W.box(0.22, 0.03, 0.06, 0xc8964a, 0, 0, 0, blank);
        sawMesh = new THREE.Group(); bench.add(sawMesh);
        W.box(0.36, 0.08, 0.005, 0xc8ccd6, 0, 0.06, 0, sawMesh);
        W.box(0.1, 0.06, 0.03, 0x7b4a28, -0.22, 0.08, 0, sawMesh);
        sawMesh.position.set(0, 0.97, 0.0);
        inter(bench, {
            prompt: () => `${PB.key('LMB')} hold + move mouse up/down: saw   ${PB.key('F')} switch to ${mode === 'job' ? 'the secret key piece' : 'the real job'}`,
            use: () => { S.sawing = true; },
            alt: () => S.toggle()
        });
        [[-3.5, 1.5], [3.5, 1.5]].forEach(([x, z]) => {
            const b = makeBench(x, z);
            W.box(1.1, 0.04, 0.22, 0xd9a86a, 0, 0.96, 0, b);
            const ch = PB.NPC.makeChar({ skin: PB.choice([0xf2c29b, 0xc68642, 0x8d5524]), shirt: 0xf07a22, pants: 0xe06a12, hair: 0x2b1d14, hat: 'hair' });
            ch.root.position.set(x, 0, z - 0.75); sc.add(ch.root);
            workers.push({ ch, t: Math.random() * 5 });
        });

        // the guard walks between the benches and stops to check each one
        const gch = PB.NPC.makeChar({ skin: 0xf2c29b, shirt: 0x3b5998, pants: 0x23304f, hair: 0x2b1d14, hat: 'cap', badge: true, belt: true, angry: true });
        gch.root.position.set(-5, 0, -3.5); sc.add(gch.root);
        const cone = new THREE.Mesh(new THREE.CircleGeometry(VIEW, 24, Math.PI / 2 - FOV, FOV * 2),
            new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        cone.rotation.x = Math.PI / 2; cone.position.y = 0.02; gch.root.add(cone);
        const route = [[-5, -3.5, null], [-3.5, 0.2, 0], [0, -1.3, 0], [3.5, 0.2, 0], [5, -3.5, null], [0, -3.8, Math.PI]];
        guard = { ch: gch, cone, w: PB.NPC.walker(gch, 0.85), route, k: 0, wait: 0 };
        const go = () => {
            const [x, z, face] = guard.route[guard.k];
            guard.k = (guard.k + 1) % guard.route.length;
            guard.w.target = { x, z };
            guard.w.onArrive = () => { guard.wait = face != null ? 3 : 0.5; guard.w.face = face; };
        };
        guard.next = go; go();

        const on = gfx !== 'low';
        sc.traverse(o => { if (o.isMesh) { o.castShadow = on && !o.material.transparent; o.receiveShadow = on; } });
    }

    function setMode(m) {
        mode = m;
        progress = m === 'key' ? wip().prog : 0;
        if (plank) plank.visible = m === 'job';
        if (blank) blank.visible = m === 'key';
    }
    S.toggle = () => {
        if (!S.active) return;
        if (mode === 'job') {
            if (!nextPart()) { PB.UI.toast('You already have all three key pieces!', 'good'); return; }
            setMode('key');
            PB.UI.toast(`🤫 Carving: ${PB.ITEMS[nextPart()].name}. Watch the guard!`);
        } else { wip().prog = progress; setMode('job'); PB.UI.toast('🪵 Back to the real job.'); }
        PB.Audio.play('click');
    };

    // Is the guard looking at you right now?
    function seen() {
        const P = PB.Player.pos, r = guard.ch.root;
        const dx = P.x - r.position.x, dz = P.z - r.position.z;
        if (Math.hypot(dx, dz) > VIEW * (PB.Player.crouch ? 0.65 : 1)) return false; // crouching keeps you below their line of sight
        let diff = Math.atan2(dx, dz) - (r.rotation.y + guard.ch.head.rotation.y);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return Math.abs(diff) < FOV;
    }

    function stroke() {
        PB.Audio.play('scrape', { vol: 0.6 });
        progress += 1 / (mode === 'job' ? JOB_STROKES : KEY_STROKES);
        if (progress < 1) return;
        if (mode === 'job') {
            const n = 8 + PB.rankOf(PB.state.rep) * 3;
            pay(n);
            PB.Audio.play('coin');
            PB.UI.toast(`🪵 ${PB.choice(['Chair leg', 'Shelf board', 'Table top', 'Picture frame', 'Birdhouse'])} done! +$${n}`, 'good');
            progress = 0;
        } else {
            const part = nextPart();
            wip().prog = 0;
            if (part) { S.pockets.push(part); PB.Audio.play('success'); PB.UI.toast(`🗝️ ${PB.ITEMS[part].name} carved! It's in your pocket. Smuggle it back to your cell.`, 'good', 6); }
            setMode('job');
        }
    }

    // ---------- Per frame ----------
    S.update = dt => {
        if (!S.active) return;
        S.time -= dt;
        if (S.time <= 0 || !PB.state.workshopOpen) { S.exit(true); return; }
        workers.forEach(w => { w.t += dt * 4; w.ch.armR.rotation.x = -1.0 + Math.sin(w.t) * 0.35; });

        // guard walking his rounds
        PB.NPC.updWalker(guard.w, dt);
        if (!guard.w.target) { guard.wait -= dt; if (guard.wait <= 0) guard.next(); }
        guard.ch.head.rotation.y = Math.sin(performance.now() / 700) * 0.35;
        guard.cone.rotation.z = -guard.ch.head.rotation.y;
        const watched = seen();
        guard.cone.material.opacity = watched ? 0.34 : 0.16;
        if (watched && mode === 'key') { // caught carving the key
            wip().prog = 0;
            setMode('job');
            addHeat(15);
            PB.Audio.play('caught');
            const v = new THREE.Vector3();
            PB.UI.bubble('shop' + Math.random(), 'What are you making there?! Gimme that!', () => v.set(guard.ch.root.position.x, 2.15, guard.ch.root.position.z), 2.5, 'guard');
            PB.UI.toast('🚨 The guard took your key blank! Progress lost. Heat +15', 'bad', 5);
        }

        // sawing: PC = hold the mouse button and move the mouse up/down; VR = trigger + move your hand back and forth
        const vr = PB.VR.isOn();
        if (vr) {
            const h = PB.VR.handWorld('right');
            S.sawing = !!h && PB.VR.pressed('right', 0) && h.distanceTo(bench.localToWorld(new THREE.Vector3(0, 1, 0))) < 0.6;
            if (S.sawing) {
                const z = bench.worldToLocal(h.clone()).x;
                if (lastHand != null) feed((z - lastHand) * 900);
                lastHand = z;
            } else lastHand = null;
        }
        sawMesh.visible = S.sawing || mode === 'job';
        sawMesh.position.x = PB.damp(sawMesh.position.x, sawPos, 20, dt);
        hud(watched);
    };

    // movement of the saw (pixels or scaled hand movement); a change of direction after enough travel = one stroke
    function feed(d) {
        if (!S.sawing || !d) return;
        sawPos = PB.clamp(sawPos + d * 0.002, -0.25, 0.25);
        const sgn = Math.sign(d);
        if (sgn !== dir) { if (travel > 60) stroke(); dir = sgn; travel = 0; }
        else travel += Math.abs(d);
    }

    S.init = () => {
        addEventListener('mousemove', e => { if (S.active && S.sawing && PB.Player.locked) feed(e.movementY); });
        addEventListener('mouseup', e => { if (e.button === 0) S.sawing = false; });
    };

    function hud(watched) {
        const t = Math.max(0, Math.ceil(S.time));
        $('shop-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        const part = mode === 'key' ? nextPart() : null;
        $('shop-task').textContent = mode === 'job' ? '🪵 Real job' : `🤫 ${part ? PB.ITEMS[part].name : 'Key piece'}`;
        $('shop-bar').style.width = Math.round(progress * 100) + '%';
        $('shop-pockets').textContent = S.pockets.length ? S.pockets.map(p => PB.ITEMS[p].icon).join(' ') : '—';
        $('shop-eye').classList.toggle('on', watched);
    }

    function dispose() {
        if (!S.scene) return;
        PB.Coop.rescueMate(S.scene);
        S.scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); if (m.isMeshBasicMaterial) m.dispose(); });
        });
        S.scene = null; guard = null; workers = []; bench = plank = blank = sawMesh = null;
        S.interactables = []; S.colliders = [];
    }

    return S;
})();
