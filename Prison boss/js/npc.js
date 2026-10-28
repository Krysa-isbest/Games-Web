'use strict';
// Cartoon characters: the trader, customers and patrolling guards.
PB.NPC = (() => {
    const N = { trader: null, customer: null, guard: null, patrolTimer: 40, customerTimer: 20 };
    let W;
    // In co-op Vinnie stands between both middle trade slots so both cellmates can reach him.
    // With 3-4 players someone whistles him over to their own trade slot (N.callTrader).
    let traderAt = null;
    N.traderAt = () => traderAt;
    const traderSpot = () => {
        if (traderAt != null && W.cells[traderAt]) return { x: W.cells[traderAt].toWorld(-0.9, 0, 0).x, z: -2.45 };
        return { x: PB.Coop.active ? -1.55 : -0.9, z: -2.45 };
    };
    const CUST_SPOT = { x: 0.15, z: -2.5 };
    // where the guard stands to look into each cell (west → east: w_, n_, '', e_)
    const GUARD_STOPS = [{ x: 3.1, cell: 'e_' }, { x: 0.3, cell: '' }, { x: -3.7, cell: 'n_' }, { x: -6.5, cell: 'w_' }];
    const stopOf = cell => GUARD_STOPS.find(s => s.cell === cell);
    const NAMES = ['Knuckles', 'Tiny', 'Doc', 'Snake', 'Big Lou', 'Mumbles', 'Shorty', 'Professor', 'Ziggy', 'Moose', 'Lefty', 'Spud'];
    const SKINS = [0xf2c29b, 0xe0a27a, 0xc68642, 0x8d5524, 0xffd7b5];
    const HAIRS = [0x2b1d14, 0x5a3a1a, 0xd9b45a, 0x1a1a1a, 0x8a8a8a, 0xb5482a];

    // ---------- Character model (faces +z) ----------
    const numberTex = {};
    function patch(num) {
        if (!numberTex[num]) numberTex[num] = W.canvasTex(128, 64, (g, w, h) => {
            g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
            g.strokeStyle = '#221a2e'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
            g.fillStyle = '#221a2e'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText('#' + num, w / 2, h / 2 + 2);
        });
        return numberTex[num];
    }
    function makeChar(o) {
        const root = new THREE.Group(), body = new THREE.Group();
        root.add(body);
        // Human proportions, cartoony details: jumpsuit with collar and number, rolled sleeves, real hands
        const fat = o.belly ? 1.18 : 1, tee = o.collar || 0xf2f2f2;
        // legs (pivot at the hip) with rounded shoes
        const leg = x => {
            const g = new THREE.Group(); g.position.set(x, 0.86, 0); body.add(g);
            W.cyl(0.085, 0.07, 0.8, o.pants, 0, -0.4, 0, g, 12);
            W.cyl(0.074, 0.074, 0.05, 0x2a2233, 0, -0.76, 0.01, g, 10);
            const shoe = W.sph(0.085, 0x2a2233, 0, -0.81, 0.06, g, 12); shoe.scale.set(0.95, 0.5, 1.6);
            return g;
        };
        const legL = leg(-0.1), legR = leg(0.1);
        // hips + torso, rounded shoulders
        W.sph(0.2 * fat, o.pants, 0, 0.9, 0, body, 16).scale.set(1, 0.55, 0.75);
        const torso = W.cyl(0.21 * fat, 0.2 * fat, 0.5, o.shirt, 0, 1.15, 0, body, 18); torso.scale.z = 0.72;
        if (o.belly) W.sph(0.21, o.shirt, 0, 1.03, 0.08, body, 14).scale.set(1.05, 0.85, 0.85);
        [-1, 1].forEach(s => W.sph(0.1, o.shirt, s * 0.2 * fat, 1.38, 0, body, 12).scale.set(1, 0.85, 0.85));
        W.sph(0.2 * fat, o.shirt, 0, 1.38, 0, body, 16).scale.set(1.05, 0.35, 0.72);
        // V of the t-shirt under the collar, and the collar flaps
        const v = W.cyl(0.0, 0.07, 0.12, tee, 0, 1.36, 0.135, body, 3); v.rotation.set(Math.PI, 0, 0); v.scale.z = 0.3;
        [-1, 1].forEach(s => { const f = W.box(0.09, 0.05, 0.02, o.shirt, s * 0.06, 1.4, 0.15, body); f.rotation.z = s * 0.5; });
        if (o.badge) W.box(0.06, 0.07, 0.02, 0xe8c33a, 0.11, 1.28, 0.15, body);
        else {
            const p = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshToonMaterial({ map: patch(o.number || PB.randi(100, 999)), gradientMap: W.grad() }));
            p.position.set(0.1, 1.25, 0.152 * fat); p.rotation.y = 0.2;
            body.add(p);
        }
        // pockets / belt
        if (o.belt) { W.cyl(0.205 * fat, 0.205 * fat, 0.05, 0x2a2233, 0, 0.92, 0, body, 18).scale.z = 0.75; W.box(0.06, 0.045, 0.02, 0xc9a43a, 0, 0.92, 0.155 * fat, body); }
        // neck + head
        W.cyl(0.055, 0.06, 0.1, o.skin, 0, 1.47, 0, body, 10);
        const head = new THREE.Group(); head.position.set(0, 1.64, 0); body.add(head);
        W.sph(0.135, o.skin, 0, 0, 0, head, 18).scale.set(1, 1.12, 1.02);
        W.sph(0.11, o.skin, 0, -0.07, 0.025, head, 14).scale.set(1, 0.8, 1); // jaw
        [-1, 1].forEach(s => {
            W.sph(0.025, 0xffffff, s * 0.048, 0.025, 0.118, head, 8).scale.set(1, 1.1, 0.5);
            W.sph(0.012, 0x1a1a1a, s * 0.048, 0.022, 0.13, head, 6);
            const lid = W.sph(0.027, o.skin, s * 0.048, 0.04, 0.115, head, 8); lid.scale.set(1.1, 0.5, 0.6);
            const brow = W.box(0.05, 0.012, 0.015, o.hair, s * 0.05, 0.068, 0.124, head);
            brow.rotation.z = s * (o.angry ? 0.3 : -0.08);
            W.sph(0.03, o.skin, s * 0.135, 0.0, 0, head, 8).scale.set(0.45, 1, 0.75); // ears
        });
        W.sph(0.03, o.skin, 0, -0.005, 0.145, head, 10).scale.set(0.85, 1.1, 1); // nose
        const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 10, Math.PI), W.mat(0x5a2a2a));
        mouth.position.set(0, o.angry ? -0.075 : -0.06, 0.122);
        mouth.rotation.z = o.angry ? 0 : Math.PI;
        head.add(mouth);
        if (o.mustache) W.box(0.08, 0.02, 0.02, o.hair, 0, -0.04, 0.135, head);
        if (o.beard) W.sph(0.1, o.hair, 0, -0.1, 0.05, head, 12).scale.set(1, 0.7, 0.9);
        if (o.hat === 'cap') {
            W.cyl(0.14, 0.15, 0.08, 0x24315a, 0, 0.11, 0, head, 16);
            W.box(0.2, 0.015, 0.12, 0x1a2342, 0, 0.08, 0.14, head);
            W.box(0.035, 0.035, 0.008, 0xe8c33a, 0, 0.12, 0.15, head);
        } else if (o.hat === 'beanie') {
            const bn = W.sph(0.145, o.hatColor, 0, 0.06, -0.005, head, 16); bn.scale.y = 0.85;
            W.cyl(0.148, 0.148, 0.05, o.hatColor, 0, 0.05, -0.005, head, 16);
        } else if (o.hat === 'hair') {
            const hc = W.sph(0.14, o.hair, 0, 0.035, -0.012, head, 16); hc.scale.set(1.02, 0.85, 1.04); // short hair
        }
        // arms: sleeve rolled up to the elbow, bare forearm, hand with a thumb (pivot at the shoulder)
        const arm = s => {
            const g = new THREE.Group(); g.position.set(s * 0.25 * fat, 1.38, 0); body.add(g);
            W.cyl(0.06, 0.055, 0.28, o.shirt, 0, -0.14, 0, g, 10);
            W.cyl(0.062, 0.062, 0.04, o.shirt, 0, -0.29, 0, g, 10).scale.set(1.08, 1, 1.08); // rolled cuff
            W.cyl(0.045, 0.04, 0.24, o.skin, 0, -0.42, 0, g, 10);
            const hand = W.sph(0.05, o.skin, 0, -0.57, 0.005, g, 10); hand.scale.set(0.8, 1.15, 0.95);
            W.sph(0.02, o.skin, -s * 0.035, -0.55, 0.03, g, 6);
            return g;
        };
        const armL = arm(-1), armR = arm(1);
        return { root, body, head, armL, armR, legL, legR };
    }

    function walker(ch, speed) {
        return { ch, speed, target: null, onArrive: null, phase: 0, moving: false, face: null, armOverride: false };
    }
    function walkTo(w, x, z, cb) { w.target = { x, z }; w.onArrive = cb || null; w.face = null; }
    function angLerp(a, b, t) {
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a + d * Math.min(1, t);
    }
    function updWalker(w, dt, onStep) {
        const r = w.ch.root;
        if (w.target) {
            const dx = w.target.x - r.position.x, dz = w.target.z - r.position.z, dist = Math.hypot(dx, dz);
            if (dist < 0.02) {
                r.position.x = w.target.x; r.position.z = w.target.z;
                w.target = null; w.moving = false;
                const cb = w.onArrive; w.onArrive = null;
                if (cb) cb();
            } else {
                const st = Math.min(dist, w.speed * dt);
                r.position.x += dx / dist * st; r.position.z += dz / dist * st;
                w.moving = true;
                r.rotation.y = angLerp(r.rotation.y, Math.atan2(dx, dz), 10 * dt);
            }
        } else {
            w.moving = false;
            if (w.face != null) r.rotation.y = angLerp(r.rotation.y, w.face, 8 * dt);
        }
        const c = w.ch;
        if (w.moving) {
            const prev = Math.floor(w.phase / Math.PI);
            w.phase += dt * w.speed * 5.2;
            if (Math.floor(w.phase / Math.PI) !== prev && onStep) onStep();
        }
        const sw = w.moving ? Math.sin(w.phase) * 0.55 : 0;
        c.legL.rotation.x = PB.damp(c.legL.rotation.x, sw, 14, dt);
        c.legR.rotation.x = PB.damp(c.legR.rotation.x, -sw, 14, dt);
        c.armL.rotation.x = PB.damp(c.armL.rotation.x, -sw * 0.8, 14, dt);
        if (!w.armOverride) c.armR.rotation.x = PB.damp(c.armR.rotation.x, sw * 0.8, 14, dt);
        c.body.position.y = w.moving ? Math.abs(Math.sin(w.phase)) * 0.04 : Math.sin(performance.now() / 600) * 0.008;
        c.head.rotation.z = w.moving ? Math.sin(w.phase) * 0.05 : 0;
    }

    const headPos = ch => () => new THREE.Vector3(ch.root.position.x, 2.12, ch.root.position.z);

    // ---------- Init ----------
    N.init = () => {
        W = PB.World;

        const tc = makeChar({ skin: 0xe0a27a, shirt: 0xf07a22, pants: 0xe06a12, hair: 0x2b1d14, hat: 'beanie', hatColor: 0x2b2b3a, mustache: true, belly: true });
        N.trader = { ch: tc, w: walker(tc, 1.3), state: 'away' };
        tc.root.visible = false;
        W.scene.add(tc.root);
        W.interact(tc.root, {
            id: 'trader',
            prompt: () => N.trader.state === 'present' ? `${PB.key('E')} Trade with Vinnie` : null,
            use: () => { if (N.trader.state === 'present') PB.UI.openTrader(); }
        });

        const gc = makeChar({ skin: 0xf2c29b, shirt: 0x3b5998, pants: 0x23304f, hair: 0x2b1d14, hat: 'cap', badge: true, belt: true, angry: true, mustache: Math.random() < 0.5 });
        // flashlight points along the arm (local -y)
        const torch = new THREE.Group(); torch.position.set(0, -0.58, 0.06); gc.armR.add(torch);
        W.cyl(0.025, 0.032, 0.2, 0x222222, 0, -0.06, 0, torch, 10);
        const spot = new THREE.SpotLight(0xfff1c0, 0, 10, 0.4, 0.45, 1.4);
        spot.position.set(0, -0.17, 0);
        const tgt = new THREE.Object3D(); tgt.position.set(0, -3, 0.2);
        torch.add(spot, tgt);
        spot.target = tgt;
        // the visible beam: the only warning you get that a guard is close
        const beamGeo = new THREE.ConeGeometry(0.7, 4, 20, 1, true);
        beamGeo.translate(0, -2, 0);
        const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        beam.position.set(0, -0.16, 0); beam.rotation.x = 0.05;
        beam.castShadow = beam.receiveShadow = false;
        torch.add(beam);
        W.sph(0.03, new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), 0, -0.165, 0, torch, 8);
        N.guard = { ch: gc, w: walker(gc, 1.5), state: null, t: 0, spot, tgt, beam, dir: 1, queue: [], visited: new Set(), stop: null };
        gc.root.visible = false;
        W.scene.add(gc.root);

        // Mumbles: your solo neighbour, sitting on his bed in the next cell
        const mc = makeChar({ skin: 0xc68642, shirt: 0xf07a22, pants: 0xe06a12, hair: 0x8a8a8a, hat: 'hair', mustache: true, belly: true });
        mc.root.position.set(W.NEIGHBOUR_X + 1.05, -0.3, 1.2); // sitting on his mattress
        mc.root.rotation.y = -Math.PI / 2;
        mc.legL.rotation.x = mc.legR.rotation.x = -1.45;
        W.scene.add(mc.root);
        N.mumbles = { ch: mc, greeted: false, t: 0 };
        W.interact(mc.root, {
            id: 'mumbles', cell: 'n_',
            prompt: () => mc.root.visible ? `${PB.key('E')} Talk to Mumbles` : null,
            use: () => PB.UI.bubble('mumbles', PB.choice([
                'Heh. Nice tunnel, neighbour.', 'I leave stuff in the hole sometimes. Don\'t mention it.',
                'Shh! The guard\'s got ears like a bat.', 'I\'ve been here 20 years. Food got worse.',
                'You want my advice? Flush the rubble. ALL of it.'
            ]), headPos(mc), 3.5)
        });
    };

    N.reset = () => {
        [N.trader].forEach(n => { n.state = 'away'; n.ch.root.visible = false; n.w.target = null; });
        traderAt = null;
        if (N.customer) { removeCustomer(N.customer); N.customer = null; }
        const g = N.guard;
        g.state = null; g.ch.root.visible = false; g.w.target = null; g.spot.intensity = 0; g.beam.visible = false;
        g.queue = []; g.stop = null; g.visited = new Set();
        N.mumbles.greeted = false;
        N.patrolTimer = 30; N.customerTimer = 15;
    };

    // ---------- Trader ----------
    N.traderArrive = () => {
        const t = N.trader, r = t.ch.root, D = PB.World.HALL.door;
        r.visible = true;
        r.position.set(D.x, 0, D.z);
        t.state = 'arriving';
        const sp = traderSpot();
        walkTo(t.w, sp.x, -3.3, () => walkTo(t.w, sp.x, sp.z, () => {
            t.state = 'present'; t.w.face = 0;
            PB.UI.bubble('trader', PB.choice(['Psst! Fresh goods today.', 'Vinnie\'s open for business!', 'Got stuff. Got cash. Let\'s talk.']), headPos(t.ch), 4);
        }));
    };
    N.traderLeave = () => {
        const t = N.trader;
        if (t.state === 'away') return;
        t.state = 'leaving';
        PB.UI.bubble('trader', 'Lights out soon. Later!', headPos(t.ch), 3);
        const D = PB.World.HALL.door;
        walkTo(t.w, traderSpot().x, -3.3, () => walkTo(t.w, D.x, D.z, () => { t.state = 'away'; t.ch.root.visible = false; traderAt = null; }));
    };
    // Host side: someone whistled from their cell door
    N.callTrader = cell => {
        const t = N.trader;
        if (t.state !== 'present' || traderAt === cell) return;
        traderAt = cell;
        t.state = 'arriving';
        PB.UI.bubble('trader', 'Comin\', comin\'!', headPos(t.ch), 2);
        const sp = traderSpot();
        walkTo(t.w, sp.x, -3.3, () => walkTo(t.w, sp.x, sp.z, () => { t.state = 'present'; t.w.face = 0; }));
    };

    // ---------- Customers ----------
    function makeRequest() {
        const rank = PB.rankOf(PB.state.rep);
        const types = Object.keys(PB.PRODUCT_RANK).filter(t => PB.PRODUCT_RANK[t] <= rank);
        const type = PB.choice(types);
        const count = type === 'cigarette' ? PB.randi(2, 4 + rank) : type === 'fakeid' || type === 'wine' ? 1 : PB.randi(1, type === 'document' ? 2 + (rank > 2 ? 1 : 0) : 2);
        const minG = PB.randi(0, Math.min(rank + 1, 4));
        const mult = PB.state.upgrades.connections ? 1.15 : 1;
        const unit = Math.round(PB.ITEMS[type].sell * PB.GRADES[minG].mult * PB.rand(1.2, 1.45) * mult * PB.Events.mult('custPay')
            * PB.Game.sellMult(type) * (PB.state.upgrades.throne ? 1.15 : 1));
        return { type, count, minG, unit };
    }

    let custId = 1;
    function makeCustomer(look, name, req, id) {
        const ch = makeChar(look);
        ch.root.scale.setScalar(look.scale || 1);
        const c = { id, ch, look, w: walker(ch, 1.2), state: 'arriving', name, req, wait: 90 };
        ch.root.position.set(PB.World.HALL.door.x - 0.8, 0, PB.World.HALL.door.z);
        W.scene.add(ch.root);
        W.interact(ch.root, {
            id: 'cust',
            prompt: () => N.customer === c && c.state === 'waiting' ? `${PB.key('E')} Talk to ${c.name}` : null,
            use: () => { if (N.customer === c && c.state === 'waiting') PB.UI.openCustomer(c); }
        });
        return c;
    }
    function removeCustomer(c) {
        W.scene.remove(c.ch.root);
        const k = W.interactables.indexOf(c.ch.root);
        if (k >= 0) W.interactables.splice(k, 1);
    }

    N.spawnCustomer = () => {
        const look = {
            skin: PB.choice(SKINS), shirt: 0xf07a22, pants: 0xe06a12, hair: PB.choice(HAIRS),
            hat: Math.random() < 0.7 ? 'hair' : 'beanie', hatColor: PB.choice([0x3a5a8a, 0x8a2a2a, 0x2a6a3a]),
            mustache: Math.random() < 0.3, belly: Math.random() < 0.3, scale: PB.rand(0.92, 1.08)
        };
        const c = N.customer = makeCustomer(look, PB.choice(NAMES), makeRequest(), custId++);
        const ch = c.ch;
        walkTo(c.w, CUST_SPOT.x, -3.4, () => walkTo(c.w, CUST_SPOT.x, CUST_SPOT.z, () => {
            c.state = 'waiting'; c.w.face = 0;
            PB.Audio.play('pop');
            PB.UI.bubble('cust', N.requestText(c.req), headPos(ch), 6);
        }));
    };

    N.requestText = r => {
        const d = PB.ITEMS[r.type];
        return `Need ${r.count} ${d.name.toLowerCase()}, grade ${PB.GRADES[r.minG].g}+.\nPaying $${r.unit} each.`;
    };

    N.customerLeave = (text) => {
        const c = N.customer;
        if (!c || c.state === 'leaving') return;
        c.state = 'leaving';
        if (text) PB.UI.bubble('cust', text, headPos(c.ch), 3);
        walkTo(c.w, CUST_SPOT.x, -3.4, () => walkTo(c.w, PB.World.HALL.door.x - 0.8, PB.World.HALL.door.z, () => {
            removeCustomer(c);
            if (N.customer === c) N.customer = null;
            N.customerTimer = PB.rand(20, 45) * PB.Events.mult('custRate') * (PB.state.upgrades.radio ? 0.8 : 1);
        }));
    };

    // ---------- Guards ----------
    N.patrolInterval = () => {
        const s = PB.state, k = PB.Events.mult('patrol');
        if (s.phase === 'night') return (Math.max(8, 25 - s.day * 0.6) + PB.rand(0, 15)) * k;
        return PB.rand(70, 120) * k;
    };

    // The guard comes in through the door at the east end of our walkway, looks into both cells,
    // then walks the whole walkway around the atrium (past every cell) and leaves.
    N.startPatrol = () => {
        const g = N.guard, r = g.ch.root, D = PB.World.HALL.door;
        g.dir = 1;
        r.position.set(D.x, 0, D.z);
        r.visible = true;
        g.w.speed = 0.95 * PB.Events.mult('guardSpeed');
        g.queue = GUARD_STOPS.filter(st => PB.World.cellUsed(st.cell)).sort((a, b) => b.x - a.x); // east → west
        g.visited = new Set();
        g.whistled = false;
        nextStop();
        if (PB.state.upgrades.lookout) {
            g.whistled = true;
            PB.Audio.play('whistle');
            PB.UI.toast('🎵 Your lookout whistles. Guard incoming!', 'bad');
        }
    };

    function nextStop() {
        const g = N.guard, stop = g.queue.shift();
        g.w.armOverride = false;
        if (!stop) {
            g.state = 'patrol'; g.stop = null; // the lap around the walkway; 'leave' = last stretch to the door
            const H = PB.World.HALL, pts = H.loop.concat([[H.door.x, H.door.z]]);
            const step = i => {
                if (i >= pts.length) { g.state = null; g.ch.root.visible = false; N.patrolTimer = N.patrolInterval(); return; }
                if (i === pts.length - 1) g.state = 'leave';
                walkTo(g.w, pts[i][0], pts[i][1], () => step(i + 1));
            };
            step(0);
            return;
        }
        g.state = 'approach'; g.stop = stop;
        walkTo(g.w, stop.x, -3.0, () => {
            g.state = 'inspect'; g.t = 0; g.w.face = 0; g.w.armOverride = true;
            PB.Audio.play('keys', { vol: 0.8 });
        });
    }

    // Warning for the cell YOU are in: off once the guard has already checked it
    function myStop() {
        const P = PB.Player;
        if (PB.World.area !== 'cell') return null;
        return stopOf(P.cell);
    }
    N.guardWarning = () => {
        const g = N.guard, st = myStop();
        if (!st || (g.state !== 'approach' && g.state !== 'inspect')) return 0;
        if (g.visited && g.visited.has(st.cell)) return 0;
        if (g.state === 'inspect' && g.stop === st) return 1;
        const dist = Math.hypot(g.ch.root.position.x - st.x, g.ch.root.position.z + 3);
        return dist < 16 ? Math.max(0.05, 1 - dist / 16) : 0;
    };
    N.guardEta = () => {
        const g = N.guard, st = myStop();
        if (!st || g.state !== 'approach') return 0;
        return Math.hypot(g.ch.root.position.x - st.x, g.ch.root.position.z + 3) / g.w.speed + (g.stop !== st ? 3 : 0);
    };
    N.guardLookingAtMe = () => { const g = N.guard, st = myStop(); return !!st && g.state === 'inspect' && g.stop === st; };

    // What the guard sees when looking into one cell
    N.check = cell => {
        const W = PB.World, P = PB.Player, Co = PB.Coop, s = PB.state, c = W.cells[cell];
        const found = PB.Items.visibleContraband(cell);
        const here = W.area === 'cell' && P.cell === cell;
        // the sewn-in pocket hides whatever is in your right hand
        if (here) P.heldItems().forEach(h => { if (PB.Items.isContraband(h) && !found.includes(h) && !(s.upgrades.pocket && h === P.held)) found.push(h); });
        // K9 day: dogs sniff out contraband in drawers and under the mattress
        const sniff = PB.Events.val('sniff', 0);
        if (sniff) PB.Items.list.forEach(i => {
            if (i.surface && /^(n_|e_|w_)?(drawerTop|drawerBot|mattress)$/.test(i.surface) && W.cellOf(i.surface) === cell
                && PB.Items.isContraband(i) && !found.includes(i) && Math.random() < sniff) found.push(i);
        });
        Co.guestHeldContraband(cell).forEach(h => { if (!found.includes(h)) found.push(h); });
        return {
            cell, found,
            crafting: here && !!PB.Mini.active,
            guestCrafting: Co.guestsCrafting(cell), // co-op slots of guests caught crafting in this cell
            lamp: s.phase === 'night' && c.lamp.on && !s.upgrades.shade,
            tunnel: W.exposedTunnel(cell)
        };
    };

    function finishInspect() {
        const g = N.guard, cell = g.stop.cell;
        g.visited.add(cell);
        const res = N.check(cell);
        let line;
        if (res.tunnel) line = 'A HOLE IN THE WALL?! ALARM!';
        else if (res.found.length || res.crafting || res.guestCrafting.length) line = PB.choice(['What\'s THIS?! Confiscated!', 'Caught you red-handed!', 'Contraband! Hand it over!']);
        else if (res.lamp) line = 'Lights out, inmate!';
        else line = PB.choice(['All quiet...', 'Hmph.', 'Keep it clean, inmate.', 'I\'ve got my eye on you.', 'Nothing to see here.']);
        PB.UI.bubble('guard', line, headPos(g.ch), 2.8, 'guard');
        PB.Game.inspectionResult(res);
        nextStop();
    }

    // ---------- Update ----------
    N.updateMumbles = dt => {
        const m = N.mumbles;
        m.ch.root.visible = !PB.Coop.active;
        if (!m.ch.root.visible) return;
        m.t += dt;
        m.ch.head.rotation.y = Math.sin(m.t * 0.4) * 0.3;
        m.ch.armR.rotation.x = -0.4 + Math.sin(m.t * 1.3) * 0.08;
        if (PB.Player.cell === 'n_' && !m.greeted) {
            m.greeted = true;
            PB.UI.bubble('mumbles', 'Whoa! You dug all the way here?\nWelcome, neighbour.', headPos(m.ch), 4);
        }
    };

    N.update = dt => {
        N.updateMumbles(dt);
        const s = PB.state, playerX = PB.Player.pos.x;

        // trader + customer
        updWalker(N.trader.w, dt);
        if (N.customer) {
            const c = N.customer;
            updWalker(c.w, dt);
            if (c.state === 'waiting') {
                c.wait -= dt;
                if (c.wait <= 0) N.customerLeave(PB.choice(['Forget it.', 'Too slow, pal.', 'I\'ll find someone else.']));
            }
        } else if (s.phase === 'day' && N.trader.state === 'present') {
            N.customerTimer -= dt;
            if (N.customerTimer <= 0) N.spawnCustomer();
        }

        // guard
        const g = N.guard;
        if (!g.state) {
            if (s.phase !== 'night') return; // guards only patrol at night
            N.patrolTimer -= dt;
            if (N.patrolTimer <= 0) N.startPatrol();
        } else {
            const gx = g.ch.root.position.x;
            const dist = Math.hypot(gx - playerX, g.ch.root.position.z - PB.Player.pos.z);
            updWalker(g.w, dt, () => {
                PB.Audio.play('step', { vol: PB.clamp(1 - dist / 15, 0.03, 1), pan: PB.clamp((gx - playerX) / 6, -1, 1) });
                if (Math.random() < 0.15) PB.Audio.play('keys', { vol: PB.clamp(1 - dist / 15, 0.03, 1) });
            });
            const night = s.phase === 'night';
            g.spot.intensity = PB.damp(g.spot.intensity, night ? (g.state === 'inspect' ? 3 : 1.6) : 0, 6, dt);
            beamFade(g);
            if (g.state === 'inspect') {
                g.t += dt;
                const dur = night ? 2.8 : 1.8;
                g.ch.armR.rotation.x = PB.damp(g.ch.armR.rotation.x, -1.35, 10, dt);
                g.ch.armR.rotation.z = Math.sin(g.t * 2.4) * 0.35;
                g.ch.head.rotation.y = Math.sin(g.t * 2.4) * 0.4;
                if (g.t >= dur) { g.ch.armR.rotation.z = 0; g.ch.head.rotation.y = 0; finishInspect(); }
            } else {
                g.ch.armR.rotation.x = PB.damp(g.ch.armR.rotation.x, -0.6, 6, dt);
            }
        }
    };

    // ---------- Co-op ----------
    N.makeChar = o => makeChar(o);
    N.walker = walker;
    N.updWalker = updWalker;
    N.headPosOf = key => {
        const n = key === 'trader' ? N.trader : key === 'guard' ? N.guard : key === 'cust' ? N.customer : null;
        return n ? headPos(n.ch) : null;
    };

    // host -> guest: where every NPC is
    const pose = ch => [Math.round(ch.root.position.x * 1000) / 1000, Math.round(ch.root.position.z * 1000) / 1000, Math.round(ch.root.rotation.y * 1000) / 1000];
    N.snapshot = () => {
        const t = N.trader, g = N.guard, c = N.customer;
        return {
            tr: { v: t.ch.root.visible, p: pose(t.ch), s: t.state, at: traderAt },
            cu: c ? { id: c.id, look: c.look, name: c.name, req: c.req, s: c.state, wait: Math.round(c.wait), p: pose(c.ch) } : null,
            gu: { v: g.ch.root.visible, p: pose(g.ch), s: g.state, ax: g.ch.armR.rotation.x, az: g.ch.armR.rotation.z, hy: g.ch.head.rotation.y, sp: g.spot.intensity,
                  st: g.stop ? g.stop.cell : null, vis: [...g.visited] }
        };
    };

    function remoteMove(n, p, visible) {
        const r = n.ch.root;
        if (visible && !r.visible) { r.position.set(p[0], 0, p[1]); r.rotation.y = p[2]; }
        r.visible = visible;
        const dist = Math.hypot(p[0] - r.position.x, p[1] - r.position.z);
        if (dist > 1.5) { r.position.x = p[0]; r.position.z = p[1]; }
        if (dist > 0.01) { n.w.target = { x: p[0], z: p[1] }; n.w.onArrive = null; }
        n.w.face = p[2];
    }

    // guest: follow the host's NPCs
    N.applyRemote = d => {
        remoteMove(N.trader, d.tr.p, d.tr.v);
        N.trader.state = d.tr.s;
        traderAt = d.tr.at != null ? d.tr.at : null;
        if (d.cu) {
            if (!N.customer || N.customer.id !== d.cu.id) {
                if (N.customer) removeCustomer(N.customer);
                N.customer = makeCustomer(d.cu.look, d.cu.name, d.cu.req, d.cu.id);
                N.customer.ch.root.position.set(d.cu.p[0], 0, d.cu.p[1]);
            }
            const c = N.customer;
            c.state = d.cu.s; c.wait = d.cu.wait; c.req = d.cu.req;
            remoteMove(c, d.cu.p, true);
        } else if (N.customer) { removeCustomer(N.customer); N.customer = null; }
        const g = N.guard;
        remoteMove(g, d.gu.p, d.gu.v);
        g.state = d.gu.s;
        g.stop = d.gu.st != null ? stopOf(d.gu.st) : null;
        g.visited = new Set(d.gu.vis || []);
        g.remote = d.gu;
    };

    N.updateRemote = dt => {
        N.updateMumbles(dt); // hides him on the guest's side too
        updWalker(N.trader.w, dt);
        if (N.customer) updWalker(N.customer.w, dt);
        const g = N.guard;
        if (!g.ch.root.visible) return;
        const gx = g.ch.root.position.x, P = PB.Player.pos;
        const dist = Math.hypot(gx - P.x, g.ch.root.position.z - P.z);
        g.w.armOverride = true;
        updWalker(g.w, dt, () => PB.Audio.play('step', { vol: PB.clamp(1 - dist / 15, 0.03, 1), pan: PB.clamp((gx - P.x) / 6, -1, 1) }));
        if (g.remote) {
            g.ch.armR.rotation.x = PB.damp(g.ch.armR.rotation.x, g.remote.ax, 12, dt);
            g.ch.armR.rotation.z = PB.damp(g.ch.armR.rotation.z, g.remote.az, 12, dt);
            g.ch.head.rotation.y = PB.damp(g.ch.head.rotation.y, g.remote.hy, 12, dt);
            g.spot.intensity = PB.damp(g.spot.intensity, g.remote.sp, 8, dt);
        }
        beamFade(g);
    };
    function beamFade(g) {
        g.beam.material.opacity = Math.min(0.14, g.spot.intensity * 0.06);
        g.beam.visible = g.beam.material.opacity > 0.005;
    }

    return N;
})();
