'use strict';
// GYM DAY: the outer yard (random event, 14:00 – 16:30). Built only while you're out there.
//  - Basketball: pick up the ball, hold LMB to charge, release to shoot (VR: grab with the trigger and throw).
//  - Weight bench and pull-up bar: press at the right moment on the timing meter for each rep. 25 reps = 💪 Strong buff.
//  - Yard work: take a rake from the shed and rake the leaf piles (hold LMB + move the mouse left/right). Pays a bit.
//  - Sometimes a package flies over the fence. Grab it when the yard guard isn't looking.
PB.Yard = (() => {
    const Y = { scene: null, interactables: [], colliders: [], bounds: { x0: -13.4, x1: 13.4, z0: -9.3, z1: 9.3 }, active: false, pockets: [] };
    const A = PB.Area, HOOP = { x: 0, y: 3.05, z: -7.35, r: 0.23 }, BALL_R = 0.12, BOARD_Z = -7.68;
    let W, ball = null, guard = null, inmates = [], piles = [], task = null, pkg = null, pkgT = 0, rakeMesh = null, rake = false;
    let stats = { baskets: 0, reps: 0, piles: 0 }, cooldown = 0;
    const v3 = new THREE.Vector3(), fwd = new THREE.Vector3();

    // ---------- Enter / leave ----------
    Y.enter = () => {
        if (Y.active || PB.Mini.active) return;
        PB.Player.stashHeld();
        A.fade(() => {
            W = PB.World;
            build();
            A.go(Y, 'yard', Y.scene, 0, 8.4, 0);
            Y.active = true; Y.pockets = []; task = null; rake = false; cooldown = 0;
            stats = { baskets: 0, reps: 0, piles: 0 };
            pkgT = PB.rand(25, 50);
            PB.UI.toast('🏀 Fresh air! Shoot hoops, lift weights or rake leaves for cash. The yard guard still watches for funny business.', '', 7);
        });
    };

    Y.exit = forced => {
        if (!Y.active) return;
        Y.active = false;
        endTask();
        const frisked = Math.random() < 0.25;
        const lost = frisked ? Y.pockets.filter(t => PB.ITEMS[t].contraband) : [];
        const got = Y.pockets.filter(t => !lost.includes(t));
        A.fade(() => {
            A.back(Y);
            dispose();
            A.hud(null);
            if (forced) PB.UI.toast('🔔 Yard time is over! Back to your cell.');
            PB.UI.toast(`🏀 ${stats.baskets} baskets · 🏋️ ${stats.reps} reps · 🍂 ${stats.piles} leaf piles`, 'good', 5);
            if (frisked) {
                PB.UI.toast(lost.length ? `👮 "Arms up!" The guard found: ${lost.map(t => PB.ITEMS[t].name).join(', ')}` : '👮 "Arms up!" You got frisked, but they found nothing.', lost.length ? 'bad' : '', 5);
                if (lost.length) A.addHeat(10);
            }
            if (got.length) { A.unpack(Y, got); PB.UI.toast(`You smuggled back: ${got.map(t => PB.ITEMS[t].icon).join(' ')}`, 'good', 4); }
            Y.pockets = [];
        });
    };
    Y.abort = () => {
        if (!Y.active) return;
        Y.active = false; task = null;
        A.back(Y); dispose(); A.hud(null); A.meter.hide();
    };

    // ---------- Building the yard ----------
    function build() {
        const sc = Y.scene = new THREE.Scene();
        sc.background = new THREE.Color(0x9cc8e6);
        sc.fog = new THREE.Fog(0x9cc8e6, 30, 70);
        Y.interactables = []; Y.colliders = []; inmates = []; piles = [];
        const gfx = PB.Settings.v.gfx;
        sc.add(new THREE.HemisphereLight(0xfff6e0, 0x5a7a4a, 0.75));
        const sun = new THREE.DirectionalLight(0xfff0d0, 0.95);
        sun.position.set(10, 16, 6); sun.castShadow = gfx !== 'low';
        sun.shadow.mapSize.set(gfx === 'high' ? 2048 : 1024, gfx === 'high' ? 2048 : 1024);
        Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
        sun.shadow.bias = -0.0008;
        sc.add(sun);

        // ground: grass all around, an asphalt court in the middle
        const grass = W.canvasTex(256, 256, (g, w) => {
            g.fillStyle = '#6f9a4a'; g.fillRect(0, 0, w, w);
            for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() < 0.5 ? '#5f8a3e' : '#80aa58'; g.fillRect(Math.random() * w, Math.random() * w, 2, 5); }
        });
        grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(12, 9);
        W.box(60, 0.1, 44, new THREE.MeshToonMaterial({ map: grass, gradientMap: W.grad() }), 0, -0.06, 0, sc);
        const court = W.canvasTex(512, 384, (g, w, h) => {
            g.fillStyle = '#4c5260'; g.fillRect(0, 0, w, h);
            for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
            g.strokeStyle = '#f2f2f2'; g.lineWidth = 6;
            g.strokeRect(10, 10, w - 20, h - 20);
            g.beginPath(); g.moveTo(10, h - 10); g.lineTo(w - 10, h - 10); g.stroke();
            g.strokeRect(w / 2 - 70, 10, 140, 150);                                        // the key
            g.beginPath(); g.arc(w / 2, 160, 70, 0, Math.PI); g.stroke();                   // free throw circle
            g.beginPath(); g.arc(w / 2, 40, 210, 0.15, Math.PI - 0.15); g.stroke();         // 3-point line
        });
        W.box(14, 0.02, 10.5, new THREE.MeshToonMaterial({ map: court, gradientMap: W.grad() }), 0, 0.0, -3.4, sc);

        // prison wall behind you, fences with razor wire around the rest
        W.box(30, 7, 0.6, 0x9a958a, 0, 3.5, 10.2, sc);
        for (let x = -14; x <= 14; x += 2) W.box(0.3, 7.2, 0.7, 0x86817a, x, 3.6, 10.15, sc);
        const door = new THREE.Group(); door.position.set(0, 0, 9.85); sc.add(door);
        W.box(1.6, 2.5, 0.12, 0x5a6a86, 0, 1.25, 0, door);
        W.box(1.8, 0.15, 0.15, 0xe84a3a, 0, 2.6, 0, door);
        A.inter(Y, door, { prompt: () => `${PB.key('E')} Go back inside`, use: () => Y.exit(false) });
        const sign = A.sign('EXERCISE YARD', 3.2, 0.8); sign.position.set(0, 3.4, 9.88); sign.rotation.y = Math.PI; sc.add(sign);
        const mesh = W.canvasTex(64, 64, g => { g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(200,205,215,.85)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke(); });
        mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
        const fence = (len, x, z, rotY) => {
            const t = mesh.clone(); t.needsUpdate = true; t.repeat.set(len * 2.5, 9);
            const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 3.6), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
            m.position.set(x, 1.8, z); m.rotation.y = rotY; sc.add(m);
            const n = Math.round(len / 2.5);
            for (let i = 0; i <= n; i++) {
                const p = -len / 2 + i * len / n;
                W.cyl(0.05, 0.05, 3.8, 0x8a8f9a, x + Math.cos(rotY) * p, 1.9, z - Math.sin(rotY) * p, sc, 8);
                const coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 4, 10), W.mat(0xb8bcc6));
                coil.position.set(x + Math.cos(rotY) * p, 3.9, z - Math.sin(rotY) * p); coil.rotation.y = rotY; sc.add(coil);
            }
        };
        fence(28, 0, -9.8, 0); fence(20, 13.8, 0, Math.PI / 2); fence(20, -13.8, 0, Math.PI / 2);

        // guard tower in the corner (just for the view) + the city behind the fence
        const tw = new THREE.Group(); tw.position.set(16, 0, -12); sc.add(tw);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => W.box(0.2, 7, 0.2, 0x5a5f6a, a, 3.5, b, tw));
        W.box(3, 2, 3, 0x7a808c, 0, 8, 0, tw); W.box(3.4, 0.2, 3.4, 0x3a3f4a, 0, 9.1, 0, tw);
        W.box(2.6, 0.8, 0.05, 0x223344, 0, 8.3, 1.52, tw);
        for (let i = 0; i < 9; i++) W.box(PB.rand(3, 6), PB.rand(4, 14), 3, 0x8a95a8, -24 + i * 6, 0, -28, sc).position.y = 2;

        // the hoop
        const hoop = new THREE.Group(); sc.add(hoop);
        W.cyl(0.08, 0.1, 3.9, 0x3a3f4a, 0, 1.95, -8.4, hoop, 10);
        W.box(0.12, 0.12, 0.7, 0x3a3f4a, 0, 3.7, -8.05, hoop);
        W.box(1.8, 1.05, 0.05, 0xf4f4f4, 0, 3.35, BOARD_Z - 0.03, hoop);
        W.box(0.6, 0.45, 0.06, 0xe84a3a, 0, 3.25, BOARD_Z - 0.02, hoop).scale.set(1, 1, 0.5);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(HOOP.r, 0.012, 6, 28), W.mat(0xff7a1f));
        rim.rotation.x = Math.PI / 2; rim.position.set(HOOP.x, HOOP.y, HOOP.z); hoop.add(rim);
        const net = new THREE.Mesh(new THREE.CylinderGeometry(HOOP.r, 0.14, 0.4, 14, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }));
        net.position.set(HOOP.x, HOOP.y - 0.2, HOOP.z); hoop.add(net);
        Y.net = net;
        A.col(Y, -0.15, 0.15, -8.55, -8.25);

        // bleachers
        for (let i = 0; i < 3; i++) W.box(1.0, 0.1, 6, 0xb8946a, 9 + i * 0.8, 0.4 + i * 0.4, -4, sc);
        A.col(Y, 8.4, 11.2, -7, -1);

        // gym corner: weight bench and pull-up bar
        const bench = new THREE.Group(); bench.position.set(-10.5, 0, 3); sc.add(bench);
        W.box(0.4, 0.45, 1.3, 0x2a2d36, 0, 0.225, 0, bench); W.box(0.42, 0.08, 1.3, 0x9a2a2a, 0, 0.49, 0, bench);
        [-0.7, 0.7].forEach(x => W.box(0.08, 1.1, 0.08, 0x5a5f6a, x, 0.55, -0.45, bench));
        const bar = Y.barbell = new THREE.Group(); bar.position.set(0, 1.1, -0.45); bench.add(bar);
        const rod = W.cyl(0.02, 0.02, 1.8, 0xc8ccd6, 0, 0, 0, bar, 8); rod.rotation.z = Math.PI / 2;
        [-0.75, 0.75].forEach(x => { const p = W.cyl(0.2, 0.2, 0.08, 0x1a1a1a, x, 0, 0, bar, 16); p.rotation.z = Math.PI / 2; });
        A.inter(Y, bench, { prompt: () => task && task.kind === 'bench' ? `${PB.key('E')} Stop lifting` : `${PB.key('E')} Lift weights 🏋️`, use: () => toggleLift('bench') });
        A.col(Y, -10.8, -10.2, 2.3, 3.7);
        const pull = new THREE.Group(); pull.position.set(-10.5, 0, -1.5); sc.add(pull);
        [-0.6, 0.6].forEach(x => W.box(0.1, 2.5, 0.1, 0x5a5f6a, x, 1.25, 0, pull));
        const pb = W.cyl(0.025, 0.025, 1.3, 0xc8ccd6, 0, 2.45, 0, pull, 8); pb.rotation.z = Math.PI / 2;
        A.inter(Y, pull, { prompt: () => task && task.kind === 'pullup' ? `${PB.key('E')} Drop down` : `${PB.key('E')} Do pull-ups 💪`, use: () => toggleLift('pullup') });
        for (let i = 0; i < 4; i++) { const d = W.cyl(0.05, 0.05, 0.35, 0x1a1a1a, -12.8, 0.3 + i * 0.25, -4 + i * 0.4, sc, 8); d.rotation.z = Math.PI / 2; } // dumbbell rack
        W.box(0.5, 1.2, 1.8, 0x5a5f6a, -12.9, 0.6, -3.4, sc);

        // rake shed and leaf piles
        const shed = new THREE.Group(); shed.position.set(9, 0, 8.4); sc.add(shed);
        W.box(2.2, 2.2, 1.4, 0x7b4a28, 0, 1.1, 0, shed); W.box(2.5, 0.12, 1.7, 0x5a3a1a, 0, 2.25, 0, shed);
        W.box(0.8, 1.7, 0.05, 0x3a2414, 0, 0.85, -0.72, shed);
        A.inter(Y, shed, {
            prompt: () => `${PB.key('E')} ${rake ? 'Put the rake back' : 'Take a rake 🍂'}`,
            use: () => { rake = !rake; rakeMesh.visible = rake; PB.Audio.play('pickup'); if (rake) PB.UI.toast('Rake the leaf piles on the grass: hold LMB and move the mouse left and right.', '', 5); }
        });
        A.col(Y, 7.8, 10.2, 7.6, 9.2);
        rakeMesh = new THREE.Group();
        W.cyl(0.015, 0.015, 1.1, 0xb8946a, 0, 0, 0, rakeMesh, 6).rotation.x = Math.PI / 2;
        W.box(0.35, 0.03, 0.04, 0x5a5f6a, 0, 0, -0.56, rakeMesh);
        rakeMesh.position.set(0.25, -0.35, -0.6); rakeMesh.rotation.x = -0.6;
        rakeMesh.visible = false; W.camera.add(rakeMesh);
        [[-12, 7.5], [-6, 8.4], [5, 8], [12, 6], [12.4, 1], [-12.3, -7.5], [12, -7.8], [-3, 8.8]].forEach(([x, z]) => {
            const p = new THREE.Group(); p.position.set(x, 0, z); sc.add(p);
            for (let i = 0; i < 9; i++) {
                const l = W.sph(PB.rand(0.12, 0.22), PB.choice([0xd27a2a, 0xb8541e, 0xe0a030, 0x9a5a2a]), PB.rand(-0.35, 0.35), PB.rand(0.05, 0.2), PB.rand(-0.35, 0.35), p, 6);
                l.scale.y = 0.45;
            }
            const pile = { g: p, strokes: 0, done: false };
            piles.push(pile);
            A.inter(Y, p, {
                prompt: () => pile.done ? null : rake ? 'Hold LMB and move the mouse ⟷ to rake' : 'Leaf pile (get a rake from the shed)',
                use: () => { if (rake && !pile.done) task = { kind: 'rake', pile, travel: 0, dir: 0, idle: 0 }; }
            });
        });

        // the ball
        const bg = new THREE.Group();
        W.sph(BALL_R, 0xe8742a, 0, 0, 0, bg, 18);
        [0, Math.PI / 2].forEach(r => { const s = new THREE.Mesh(new THREE.TorusGeometry(BALL_R + 0.001, 0.004, 4, 24), W.mat(0x1a1a1a)); s.rotation.y = r; bg.add(s); });
        sc.add(bg);
        ball = { mesh: bg, pos: new THREE.Vector3(0.5, BALL_R, -1), vel: new THREE.Vector3(), held: false, wait: false, scored: false, hist: [] };
        A.inter(Y, bg, { prompt: () => ball.held ? null : `${PB.key('E')} Pick up the basketball 🏀`, use: () => pickBall() });

        // the yard guard walks around the court
        guard = A.guard(sc, -8, -8.6, 7, 0.55, 0.9);
        guard.route = [[-8, -8.6, null, 2], [8, -8.6, null, 2], [8, 2.5, null, 1], [-8, 2.5, null, 3]];

        // other inmates working out / hanging around
        const look = () => ({ skin: PB.choice([0xf2c29b, 0xc68642, 0x8d5524, 0xe0a27a]), shirt: 0xf07a22, pants: 0xe06a12, hair: PB.choice([0x1a1a1a, 0x2b1d14, 0x8a8a8a]), hat: PB.choice(['hair', 'beanie']), hatColor: 0x3a5a8a });
        [['pushup', -7, 6.5, 0.5], ['pushup', -6, 7.2, 0.3], ['sit', 9.0, -4.5, -Math.PI / 2], ['sit', 9.8, -2.5, -Math.PI / 2], ['lean', 13.2, 3, -Math.PI / 2], ['shoot', 3, -3.5, Math.PI]].forEach(([kind, x, z, r]) => {
            const ch = PB.NPC.makeChar(look());
            ch.root.position.set(x, kind === 'sit' ? (x > 9.5 ? 0.42 : 0.02) : 0, z); ch.root.rotation.y = r; sc.add(ch.root);
            if (kind === 'sit') { ch.legL.rotation.x = ch.legR.rotation.x = -1.45; ch.root.position.y += 0.05; }
            inmates.push({ ch, kind, t: Math.random() * 6 });
        });

        A.shadows(sc);
    }

    // ---------- Basketball ----------
    function pickBall() {
        if (ball.held) return;
        ball.held = true; ball.wait = true; ball.charge = 0; ball.scored = false;
        PB.Audio.play('pickup');
        G_hint('ball', 'Hold <b>LMB</b> to charge the throw, release to shoot. Aim a bit above the rim! (VR: hold the trigger, swing and let go.)');
    }
    const G_hint = (k, m) => PB.Game.hint(k, m, 7);

    function throwBall(vel) {
        ball.held = false; ball.charge = 0; ball.scored = false;
        ball.vel.copy(vel);
        PB.Audio.play('swish', { vol: 0.6 });
        A.meter.hide();
    }

    function updateBall(dt) {
        const cam = W.camera, vr = PB.VR.isOn();
        if (ball.held) {
            if (vr) {
                const h = PB.VR.handWorld('right');
                if (h) {
                    ball.pos.copy(h);
                    ball.hist.push({ p: h.clone(), t: performance.now() });
                    if (ball.hist.length > 6) ball.hist.shift();
                }
                if (!PB.VR.pressed('right', 0)) { // let go: throw with the hand's speed
                    const a = ball.hist[0], b = ball.hist[ball.hist.length - 1];
                    const dts = Math.max(0.016, (b.t - a.t) / 1000);
                    throwBall(b.p.clone().sub(a.p).divideScalar(dts).multiplyScalar(1.15));
                }
            } else {
                cam.getWorldDirection(fwd);
                cam.getWorldPosition(v3);
                ball.pos.copy(v3).addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, -0.18, 0));
                if (ball.wait) { if (!A.pressedNow) ball.wait = false; }
                else if (A.pressedNow) {
                    ball.charge = (ball.charge || 0) + dt;
                    const c = Math.abs(((ball.charge * 0.8) % 2) - 1); // ping-pongs 0..1..0
                    ball.power = 1 - c;
                    A.meter.show('Power');
                    A.meter.set(ball.power, 0.55, 0.75);
                } else if (A.justReleased && ball.charge > 0.05) {
                    const speed = 6 + ball.power * 5.5;
                    throwBall(fwd.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 1.8, 0)));
                }
            }
            ball.mesh.position.copy(ball.pos);
            return;
        }
        // VR: grab the ball when your hand is on it and you pull the trigger
        if (vr && A.justPressed) { const h = PB.VR.handWorld('right'); if (h && h.distanceTo(ball.pos) < 0.35) { pickBall(); ball.hist = []; return; } }

        const steps = 3, h = dt / steps;
        for (let i = 0; i < steps; i++) {
            const prev = ball.pos.clone();
            ball.vel.y -= 9.8 * h;
            ball.pos.addScaledVector(ball.vel, h);
            // ground
            if (ball.pos.y < BALL_R) {
                ball.pos.y = BALL_R;
                if (Math.abs(ball.vel.y) > 1) PB.Audio.play('bounce', { vol: PB.clamp(Math.abs(ball.vel.y) / 6, 0.1, 0.8) });
                ball.vel.y = -ball.vel.y * 0.62;
                ball.vel.x *= 0.86; ball.vel.z *= 0.86;
                if (Math.abs(ball.vel.y) < 0.4) ball.vel.y = 0;
            }
            // backboard
            if (prev.z - BALL_R >= BOARD_Z && ball.pos.z - BALL_R < BOARD_Z && Math.abs(ball.pos.x) < 0.9 && ball.pos.y > 2.8 && ball.pos.y < 3.88) {
                ball.pos.z = BOARD_Z + BALL_R; ball.vel.z = -ball.vel.z * 0.55;
                PB.Audio.play('thud', { vol: 0.5 });
            }
            // rim (a ring of radius HOOP.r)
            const dx = ball.pos.x - HOOP.x, dz = ball.pos.z - HOOP.z, d = Math.hypot(dx, dz) || 0.0001;
            const rp = v3.set(HOOP.x + dx / d * HOOP.r, HOOP.y, HOOP.z + dz / d * HOOP.r);
            const n = ball.pos.clone().sub(rp), nd = n.length();
            if (nd < BALL_R + 0.012) {
                n.divideScalar(nd || 1);
                ball.pos.copy(rp).addScaledVector(n, BALL_R + 0.013);
                const vn = ball.vel.dot(n);
                if (vn < 0) ball.vel.addScaledVector(n, -1.5 * vn);
                ball.vel.multiplyScalar(0.85);
                PB.Audio.play('clang', { vol: 0.15 });
            }
            // through the hoop from above = basket!
            if (!ball.scored && prev.y >= HOOP.y && ball.pos.y < HOOP.y && d < HOOP.r - 0.04) {
                ball.scored = true;
                score();
            }
            // fences / wall
            if (Math.abs(ball.pos.x) > 13.6) { ball.pos.x = Math.sign(ball.pos.x) * 13.6; ball.vel.x *= -0.5; }
            if (ball.pos.z < -9.6) { ball.pos.z = -9.6; ball.vel.z *= -0.5; }
            if (ball.pos.z > 9.7) { ball.pos.z = 9.7; ball.vel.z *= -0.5; }
        }
        if (ball.pos.y <= BALL_R + 0.001) { ball.vel.x *= 1 - dt * 1.5; ball.vel.z *= 1 - dt * 1.5; }
        ball.mesh.position.copy(ball.pos);
        ball.mesh.rotation.x -= ball.vel.z * dt * 6; ball.mesh.rotation.z += ball.vel.x * dt * 6;
    }

    function score() {
        stats.baskets++;
        PB.Audio.play('swoosh'); PB.Audio.play('cheer', { vol: 0.6 });
        Y.net.scale.y = 1.25;
        A.progress('hoops', 1);
        if (stats.baskets % 2 === 0) A.rep(1);
        PB.UI.toast(PB.choice(['🏀 SWISH!', '🏀 Nothing but net!', '🏀 Buckets!', '🏀 He shoots, he scores!']), 'good', 1.6);
        if (stats.baskets === 8) A.buff('fame', 1);
        const ch = inmates.find(i => i.kind === 'sit');
        if (ch) A.say('yard', ch.ch, PB.choice(['Nice shot!', 'Ooooh!', 'Lucky!', 'Do it again!']), 1.6);
    }

    // ---------- Weights / pull-ups (timing meter) ----------
    function toggleLift(kind) {
        if (task && task.kind === kind) { endTask(); return; }
        if (cooldown > 0) { PB.UI.toast(`Your arms are jelly. Rest ${Math.ceil(cooldown)}s.`, 'bad'); return; }
        if (ball.held) { PB.UI.toast('Put the ball down first (throw it).', 'bad'); return; }
        task = { kind, mark: 0, dir: 1, speed: kind === 'bench' ? 0.9 : 1.15, zone: kind === 'bench' ? 0.24 : 0.2, misses: 0, reps: 0 };
        PB.Player.speedMult = 0;
        if (kind === 'bench') PB.Player.crouch = true;
        A.meter.show(kind === 'bench' ? 'Bench press: press LMB / Space in the green!' : 'Pull-ups: press LMB / Space in the green!');
        G_hint('lift', 'Press <b>LMB</b> or <b>Space</b> (VR: trigger) when the marker is in the green. 3 misses and you need a rest. 25 reps in one visit = 💪 Strong (faster digging).');
    }
    function endTask() {
        if (!task) return;
        if (task.kind === 'bench' || task.kind === 'pullup') {
            PB.Player.speedMult = 1; PB.Player.eyeOffset = 0;
            if (task.kind === 'bench') PB.Player.crouch = false;
            A.meter.hide();
        }
        task = null;
    }
    function updateLift(dt) {
        const t = task, z0 = 0.5 - t.zone / 2, z1 = 0.5 + t.zone / 2;
        t.mark += t.dir * t.speed * dt;
        if (t.mark > 1) { t.mark = 1; t.dir = -1; } else if (t.mark < 0) { t.mark = 0; t.dir = 1; }
        A.meter.set(t.mark, z0, z1, `${t.kind === 'bench' ? '🏋️' : '💪'} Reps: <b>${t.reps}</b> · misses ${t.misses}/3`);
        t.anim = Math.max(0, (t.anim || 0) - dt * 2);
        const lift = Math.sin(t.anim * Math.PI);
        if (t.kind === 'pullup') PB.Player.eyeOffset = lift * 0.45;
        else Y.barbell.position.y = 1.1 + lift * 0.35;
        if (!A.justPressed) return;
        if (t.mark >= z0 && t.mark <= z1) {
            t.reps++; stats.reps++; t.anim = 1;
            PB.Audio.play('grunt');
            A.progress('workout', 1);
            t.speed *= 1.04; t.zone = Math.max(0.08, t.zone * 0.97);
            if (stats.reps === 25) { A.buff('strong', 2); PB.Audio.play('rank'); }
            if (stats.reps % 10 === 0) A.rep(1);
        } else {
            t.misses++;
            PB.Audio.play('bad');
            if (t.misses >= 3) { PB.UI.toast(`Exhausted after ${t.reps} reps. Take a breather.`, '', 3); cooldown = 8; endTask(); }
        }
    }

    // ---------- Raking ----------
    function updateRake(dt) {
        const t = task, P = PB.Player;
        let d = 0;
        if (PB.VR.isOn()) {
            const h = PB.VR.handWorld('right');
            if (h && PB.VR.pressed('right', 0)) { if (t.lastHand != null) d = (h.x - t.lastHand) * 900; t.lastHand = h.x; } else t.lastHand = null;
        } else if (A.pressedNow) d = A.moveX;
        if (!d) { t.idle += dt; if (t.idle > 2) task = null; return; }
        t.idle = 0;
        if (t.pile.g.position.distanceTo(new THREE.Vector3(P.pos.x, 0, P.pos.z)) > 2.6) { task = null; return; }
        const sgn = Math.sign(d);
        if (sgn !== t.dir) {
            if (t.travel > 60) {
                t.pile.strokes++;
                PB.Audio.play('rake');
                rakeMesh.rotation.z = sgn * 0.3;
                const k = 1 - t.pile.strokes / 8;
                t.pile.g.scale.set(Math.max(0.15, k), Math.max(0.15, k), Math.max(0.15, k));
                if (t.pile.strokes >= 8) {
                    t.pile.done = true; t.pile.g.visible = false;
                    stats.piles++;
                    A.pay(6); A.progress('yardwork', 1);
                    if (stats.piles % 2 === 0) A.rep(1);
                    PB.Audio.play('coin');
                    PB.UI.toast('🍂 Pile raked! +$6', 'good', 2);
                    task = null; return;
                }
            }
            t.dir = sgn; t.travel = Math.abs(d);
        } else t.travel += Math.abs(d);
    }

    // ---------- Contraband package ----------
    function updatePackage(dt) {
        if (!pkg) {
            pkgT -= dt;
            if (pkgT > 0) return;
            pkgT = PB.rand(60, 90);
            const g = new THREE.Group();
            W.box(0.35, 0.22, 0.28, 0xb8946a, 0, 0.11, 0, g);
            W.box(0.36, 0.03, 0.29, 0x8a6a4a, 0, 0.18, 0, g);
            g.position.set(PB.rand(-11, 11), 5, -9.3);
            Y.scene.add(g);
            pkg = { g, vy: 0, landed: false };
            A.inter(Y, g, {
                prompt: () => pkg && pkg.landed ? `${PB.key('E')} Grab the package 📦` : null,
                use: () => grabPackage()
            });
            PB.Audio.play('swish');
            PB.UI.toast('📦 Something flew over the north fence!', '', 4);
            return;
        }
        if (!pkg.landed) {
            pkg.vy -= 9.8 * dt;
            pkg.g.position.y += pkg.vy * dt;
            pkg.g.position.z += dt * 1.5;
            if (pkg.g.position.y <= 0) { pkg.g.position.y = 0; pkg.landed = true; PB.Audio.play('thud'); }
        }
    }
    function grabPackage() {
        if (!pkg || !pkg.landed) return;
        if (Y.pockets.length >= 3) { PB.UI.toast('Your pockets are full.', 'bad'); return; }
        const g = pkg.g;
        Y.scene.remove(g);
        const k = Y.interactables.indexOf(g); if (k >= 0) Y.interactables.splice(k, 1);
        pkg = null;
        if (A.sees(guard)) {
            PB.Audio.play('caught');
            A.addHeat(10);
            A.say('yard', guard.ch, 'I\'ll take that, thank you!', 2.5, 'guard');
            PB.UI.toast('🚨 The guard saw you grab the package and took it. Heat +10', 'bad', 4);
            return;
        }
        const loot = [PB.choice(['premium', 'tobacco', 'photo', 'sugar', 'rolling']), Math.random() < 0.4 ? PB.choice(['stamp', 'premium', 'fruit']) : null].filter(Boolean);
        loot.forEach(t => { if (Y.pockets.length < 3) Y.pockets.push(t); });
        PB.Audio.play('success');
        PB.UI.toast(`📦 Got it! ${loot.map(t => PB.ITEMS[t].icon + ' ' + PB.ITEMS[t].name).join(', ')}. Don't get frisked!`, 'good', 5);
    }

    // ---------- Per frame ----------
    Y.update = dt => {
        if (!Y.active || !Y.scene) return;
        if (!PB.state.yardOpen) { Y.exit(true); return; }
        A.poll();
        cooldown = Math.max(0, cooldown - dt);
        A.patrol(guard, dt);
        const watched = A.sees(guard);
        guard.cone.material.opacity = watched ? 0.3 : 0.14;
        updateBall(dt);
        Y.net.scale.y = PB.damp(Y.net.scale.y, 1, 6, dt);
        if (task && (task.kind === 'bench' || task.kind === 'pullup')) updateLift(dt);
        else if (task && task.kind === 'rake') updateRake(dt);
        else if (!ball.held) A.meter.hide();
        // you can't walk while lifting
        if (task && task.kind !== 'rake' && (PB.Player.keys[PB.Keys.get('forward')] || PB.Player.keys[PB.Keys.get('back')])) endTask();
        updatePackage(dt);
        inmates.forEach(m => {
            m.t += dt;
            if (m.kind === 'pushup') { m.ch.body.rotation.x = 1.35; m.ch.body.position.y = 0.25 + Math.abs(Math.sin(m.t * 2.2)) * 0.12; m.ch.armL.rotation.x = m.ch.armR.rotation.x = -1.3; }
            else if (m.kind === 'shoot') { const s = Math.max(0, Math.sin(m.t * 1.4)); m.ch.armL.rotation.x = m.ch.armR.rotation.x = -2.8 * s; }
            else if (m.kind === 'sit') m.ch.head.rotation.y = Math.sin(m.t * 0.5) * 0.5;
        });
        if (rakeMesh) rakeMesh.rotation.z = PB.damp(rakeMesh.rotation.z, 0, 8, dt);
        A.hud(`<div class="chip">🏀 Yard <b>${PB.Game.clock()}</b></div><div class="chip">🏀 ${stats.baskets} · 🏋️ ${stats.reps} · 🍂 ${stats.piles}</div>`
            + `<div class="chip">👖 ${Y.pockets.length ? Y.pockets.map(t => PB.ITEMS[t].icon).join(' ') : '—'}</div>${watched ? '<div class="chip eye">👁️ Watched</div>' : ''}`);
    };

    Y.busy = () => Y.active && ((ball && ball.held) || (task && task.kind !== 'rake'));

    function dispose() {
        if (rakeMesh && rakeMesh.parent) rakeMesh.parent.remove(rakeMesh);
        A.meter.hide();
        A.dispose(Y.scene);
        Y.scene = null; ball = null; guard = null; inmates = []; piles = []; pkg = null; rakeMesh = null; task = null;
        Y.interactables = []; Y.colliders = [];
    }

    return Y;
})();
