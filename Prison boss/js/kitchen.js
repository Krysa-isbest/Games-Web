'use strict';
// KITCHEN DUTY (random event, 08:00 – 11:00): the cook is sick, so inmates run the kitchen.
// Cook for the queue at the serving hatch and get paid per plate (better food = more money and respect).
//  🍲 Stew:   vegetables from the crate → chop them on the board (timing meter) → into a pot → take it off the
//             stove when the gauge is in the green (too early = raw, too late = burnt) → serve.
//  🍔 Burger: raw patty from the fridge → on the grill → flip in the green → take it off in the green → serve.
// The pantry has sugar and fruit... if the kitchen guard isn't looking.
PB.Kitchen = (() => {
    const K = { scene: null, interactables: [], colliders: [], bounds: { x0: -4.5, x1: 4.4, z0: -2.9, z1: 3.6 }, active: false, pockets: [] };
    const A = PB.Area, POT_T = 14, GRILL_T = 7;
    let W, hold = null, holdMesh = null, pots = [], grill = null, chop = null, queue = [], guard = null, crates = [];
    let qT = 0, custId = 0, stats = { served: 0, good: 0, earned: 0 };

    // ---------- Enter / leave ----------
    K.enter = () => {
        if (K.active || PB.Mini.active) return;
        if (K.wentDay === PB.state.day && K.left) { PB.UI.toast('You already worked your kitchen shift today.', 'bad'); return; }
        K.wentDay = PB.state.day; K.left = false;
        PB.Player.stashHeld();
        A.fade(() => {
            W = PB.World;
            build();
            A.go(K, 'kitchen', K.scene, 0, 3.0, 0);
            K.active = true; K.pockets = []; hold = null; chop = null; queue = []; qT = 2;
            stats = { served: 0, good: 0, earned: 0 };
            PB.UI.toast('🍳 Kitchen duty! Serve the queue at the hatch on the right. Stew: veg → chop → pot. Burger: fridge → grill → flip.', '', 8);
        });
    };

    K.exit = forced => {
        if (!K.active) return;
        K.active = false; K.left = true;
        chop = null;
        const frisked = Math.random() < 0.3;
        const lost = frisked ? K.pockets.filter(() => Math.random() < 0.7) : [];
        const got = K.pockets.filter(t => !lost.includes(t));
        A.fade(() => {
            A.back(K);
            dispose();
            A.hud(null);
            if (forced) PB.UI.toast('🔔 Kitchen shift is over! Back to your cell.');
            PB.UI.toast(`🍳 You served ${stats.served} plates (${stats.good} good ones) and earned $${stats.earned}.`, 'good', 5);
            if (stats.good >= 6) A.buff('wellfed', 2);
            if (stats.good >= 10) A.buff('fame', 1);
            if (frisked) {
                PB.UI.toast(lost.length ? `👮 "Arms up!" The guard found: ${lost.map(t => PB.ITEMS[t].name).join(', ')}` : '👮 "Arms up!" You got frisked, but they found nothing.', lost.length ? 'bad' : '', 5);
                if (lost.length) A.addHeat(6);
            }
            if (got.length) { A.unpack(K, got); PB.UI.toast(`You smuggled back: ${got.map(t => PB.ITEMS[t].icon).join(' ')}`, 'good', 4); }
            K.pockets = [];
        });
    };
    K.abort = () => {
        if (!K.active) return;
        K.active = false; chop = null;
        A.back(K); dispose(); A.hud(null); A.meter.hide();
    };
    K.busy = () => K.active && !!chop;

    // ---------- Building ----------
    function gauge(parent, x, y, z) {
        const t = W.canvasTex(256, 64, () => {});
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
        sp.scale.set(1.0, 0.25, 1); sp.position.set(x, y, z); sp.renderOrder = 5;
        parent.add(sp);
        let last = '';
        return {
            sp,
            draw(frac, z0, z1, text) {
                const key = Math.round(frac * 60) + text;
                if (key === last) return;
                last = key;
                const g = t.userData.cv.getContext('2d');
                g.clearRect(0, 0, 256, 64);
                g.fillStyle = 'rgba(20,16,30,.85)'; g.fillRect(0, 0, 256, 64);
                g.fillStyle = '#fff'; g.fillRect(8, 34, 240, 20);
                g.fillStyle = '#6ee07a'; g.fillRect(8 + 240 * z0, 34, 240 * (z1 - z0), 20);
                g.fillStyle = frac > z1 ? '#e84a3a' : '#ff9a1f'; g.fillRect(8, 34, 240 * Math.min(1, frac / 1.3), 20);
                g.fillStyle = '#221a2e'; g.fillRect(8 + 240 * Math.min(1, frac / 1.3) - 2, 30, 5, 28);
                g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText(text, 128, 24);
                t.needsUpdate = true;
            }
        };
    }

    function build() {
        const sc = K.scene = new THREE.Scene();
        sc.background = new THREE.Color(0x2a2230);
        K.interactables = []; K.colliders = []; pots = []; crates = [];
        const gfx = PB.Settings.v.gfx;
        sc.add(new THREE.HemisphereLight(0xfff6e8, 0x5a5a6a, 0.7));
        const key = new THREE.DirectionalLight(0xfff0d8, 0.6);
        key.position.set(2, 6, 4); key.castShadow = gfx !== 'low';
        Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 });
        sc.add(key);
        [[-2, -1], [2, -1], [0, 2.5]].forEach(([x, z]) => { const p = new THREE.PointLight(0xfff4e0, 0.45, 9, 2); p.position.set(x, 2.7, z); sc.add(p); });

        // white tiles, steel everything
        const tiles = W.canvasTex(128, 128, (g, w) => { g.fillStyle = '#e8ecef'; g.fillRect(0, 0, w, w); g.strokeStyle = '#b8c0c8'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, w); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); } });
        tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(5, 4);
        W.box(10, 0.1, 8, new THREE.MeshToonMaterial({ map: tiles, gradientMap: W.grad() }), 0, -0.05, 0, sc);
        W.box(10, 0.1, 8, 0xcfd3d8, 0, 3.05, 0, sc);
        const wallMat = 0xd8e4e8;
        W.box(10, 3, 0.2, wallMat, 0, 1.5, -4.1, sc); W.box(10, 3, 0.2, wallMat, 0, 1.5, 4.1, sc);
        W.box(0.2, 3, 8, wallMat, -5.1, 1.5, 0, sc);
        // east wall with the serving hatch (opening at z 0..2, y 0.95..2.0)
        W.box(0.2, 3, 4.1, wallMat, 5.1, 1.5, -1.95, sc); W.box(0.2, 3, 2, wallMat, 5.1, 1.5, 3.0, sc);
        W.box(0.2, 0.95, 2, wallMat, 5.1, 0.475, 1, sc); W.box(0.2, 1.0, 2, wallMat, 5.1, 2.5, 1, sc);
        const sign = A.sign('BLOCK C KITCHEN', 2.8, 0.7, '#f3f3f3'); sign.position.set(0, 2.5, -3.99); sc.add(sign);
        const door = new THREE.Group(); door.position.set(-3.5, 0, 3.95); sc.add(door);
        W.box(1.2, 2.3, 0.1, 0x7a8ca8, 0, 1.15, 0, door);
        A.inter(K, door, { prompt: () => `${PB.key('E')} End your shift (back to the cell)`, use: () => K.exit(false) });

        // counters along the north wall
        W.box(9.6, 0.9, 0.9, 0xb8c0c8, 0, 0.45, -3.55, sc);
        W.box(9.6, 0.05, 0.95, 0xdfe5ea, 0, 0.92, -3.55, sc);
        A.col(K, -4.9, 4.9, -4.1, -3.05);

        // stove with two pots
        W.box(1.8, 0.06, 0.8, 0x2a2d36, -3.2, 0.96, -3.55, sc);
        [-3.6, -2.8].forEach((x, i) => {
            const g = new THREE.Group(); g.position.set(x, 0.99, -3.5); sc.add(g);
            const ring = W.cyl(0.18, 0.18, 0.01, 0x3a1a1a, 0, 0, 0, g, 16);
            W.cyl(0.2, 0.17, 0.26, 0x9aa2ac, 0, 0.14, 0, g, 18);
            const soup = W.cyl(0.18, 0.18, 0.01, 0x8a5a2a, 0, 0.22, 0, g, 18); soup.visible = false;
            const steam = W.sph(0.12, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }), 0, 0.45, 0, g, 8);
            const pot = { g, ring, soup, steam, state: 'empty', t: 0, q: 0, gauge: gauge(g, 0, 0.75, 0.1) };
            pot.gauge.sp.visible = false;
            pots.push(pot);
            A.inter(K, g, { prompt: () => potPrompt(pot), use: () => usePot(pot) });
        });

        // grill
        const gr = new THREE.Group(); gr.position.set(-0.8, 0.99, -3.5); sc.add(gr);
        W.box(1.0, 0.05, 0.6, 0x1a1a1a, 0, 0, 0, gr);
        for (let i = 0; i < 7; i++) W.box(0.02, 0.012, 0.56, 0x5a5f6a, -0.42 + i * 0.14, 0.03, 0, gr);
        const patty = W.cyl(0.11, 0.11, 0.04, 0xd98a8a, 0, 0.06, 0, gr, 16); patty.visible = false;
        grill = { g: gr, patty, state: 'empty', t: 0, s1: 0, gauge: gauge(gr, 0, 0.6, 0.1) };
        grill.gauge.sp.visible = false;
        A.inter(K, gr, { prompt: () => grillPrompt(), use: () => useGrill() });

        // cutting board + vegetable crate
        const board = new THREE.Group(); board.position.set(1.6, 0.95, -3.45); sc.add(board);
        W.box(0.7, 0.04, 0.45, 0xc8964a, 0, 0, 0, board);
        const knife = K.knife = new THREE.Group(); knife.position.set(0.15, 0.05, 0); board.add(knife);
        W.box(0.22, 0.008, 0.04, 0xd8dce6, -0.12, 0, 0, knife); W.box(0.1, 0.02, 0.03, 0x2a2228, 0.04, 0, 0, knife);
        K.boardVeg = new THREE.Group(); board.add(K.boardVeg); K.boardVeg.visible = false;
        for (let i = 0; i < 5; i++) W.sph(0.04, PB.choice([0xe8742a, 0x4aa64a, 0xd8c048]), -0.2 + i * 0.07, 0.04, PB.rand(-0.08, 0.08), K.boardVeg, 8);
        A.inter(K, board, { prompt: () => boardPrompt(), use: () => useBoard() });
        const crate = new THREE.Group(); crate.position.set(3.7, 0, -2.5); sc.add(crate);
        W.box(0.8, 0.5, 0.6, 0xa8763f, 0, 0.25, 0, crate);
        for (let i = 0; i < 10; i++) W.sph(0.07, PB.choice([0xe8742a, 0x4aa64a, 0xd8c048, 0xb33a3a]), PB.rand(-0.3, 0.3), 0.52, PB.rand(-0.2, 0.2), crate, 8);
        A.inter(K, crate, { prompt: () => hold ? null : `${PB.key('E')} Grab vegetables 🥕`, use: () => { if (!hold) setHold({ kind: 'vegRaw', q: 0 }); } });
        A.col(K, 3.25, 4.15, -2.85, -2.15);

        // fridge (patties) and pantry (stealable sugar / fruit)
        const fridge = new THREE.Group(); fridge.position.set(-4.6, 0, -0.6); sc.add(fridge);
        W.box(0.8, 2.0, 0.9, 0xe8ecef, 0, 1.0, 0, fridge); W.box(0.04, 0.6, 0.05, 0x5a5f6a, 0.42, 1.2, 0.3, fridge);
        A.inter(K, fridge, { prompt: () => hold ? null : `${PB.key('E')} Take a raw patty 🥩`, use: () => { if (!hold) setHold({ kind: 'pattyRaw', q: 0 }); } });
        A.col(K, -5, -4.2, -1.05, -0.15);
        const pantry = new THREE.Group(); pantry.position.set(-4.65, 0, 1.9); sc.add(pantry);
        W.box(0.6, 2.0, 1.6, 0x8a6a4a, 0, 1.0, 0, pantry);
        [['sugar', 0.6, 0x3d7bff], ['fruit', 1.2, 0xd8322f]].forEach(([type, y, col]) => {
            const c = new THREE.Group(); c.position.set(0.2, y, 0); pantry.add(c);
            W.box(0.45, 0.35, 0.5, 0xc8964a, 0, 0, 0, c); W.box(0.4, 0.08, 0.45, col, 0, 0.2, 0, c);
            const cr = { type, left: 2 };
            crates.push(cr);
            A.inter(K, c, {
                prompt: () => cr.left > 0 ? `${PB.key('E')} Pocket some ${PB.ITEMS[type].name.toLowerCase()} 🤫` : 'Empty',
                use: () => steal(cr)
            });
        });
        A.col(K, -5, -4.3, 1.05, 2.75);

        // serving hatch counter + the queue outside
        const hatch = new THREE.Group(); hatch.position.set(4.85, 0.95, 1); sc.add(hatch);
        W.box(0.6, 0.06, 2, 0xb8c0c8, 0, 0, 0, hatch);
        A.inter(K, hatch, { prompt: () => hatchPrompt(), use: () => serve() });
        W.box(4, 0.1, 4, 0x8e8a84, 7.2, -0.05, 1, sc); // corridor outside

        // the kitchen guard keeps an eye on the pantry
        guard = A.guard(sc, -2.5, 2.8, 4.5, 0.6, 0.7);
        guard.route = [[-2.5, 2.8, null, 3], [1.5, 2.8, null, 3], [-1, 0.5, null, 2]];

        A.shadows(sc);
    }

    // ---------- What you carry ----------
    function setHold(h) {
        if (holdMesh) { W.camera.remove(holdMesh); holdMesh = null; }
        hold = h;
        if (!h) return;
        const g = new THREE.Group();
        const k = h.kind;
        if (k === 'vegRaw' || k === 'veg') {
            W.cyl(0.11, 0.08, 0.06, 0xe8ecef, 0, 0, 0, g, 14);
            for (let i = 0; i < (k === 'veg' ? 9 : 4); i++) W.sph(k === 'veg' ? 0.025 : 0.045, PB.choice([0xe8742a, 0x4aa64a, 0xd8c048]), PB.rand(-0.06, 0.06), 0.04, PB.rand(-0.06, 0.06), g, 6);
        } else if (k === 'pattyRaw') W.cyl(0.08, 0.08, 0.03, 0xd98a8a, 0, 0, 0, g, 14);
        else if (k === 'stew') { W.cyl(0.11, 0.08, 0.07, 0xe8ecef, 0, 0, 0, g, 14); W.cyl(0.1, 0.1, 0.01, h.q > 20 ? 0x8a5a2a : 0x2a1a0a, 0, 0.035, 0, g, 14); }
        else if (k === 'burger') {
            W.cyl(0.09, 0.09, 0.03, 0xd8a050, 0, -0.03, 0, g, 14);
            W.cyl(0.085, 0.085, 0.025, h.q > 20 ? 0x6b3a1a : 0x1a0a0a, 0, 0, 0, g, 14);
            W.cyl(0.09, 0.09, 0.008, 0x4aa64a, 0, 0.018, 0, g, 14);
            W.sph(0.09, 0xd8a050, 0, 0.025, 0, g, 12).scale.y = 0.45;
        }
        g.position.set(0.25, -0.25, -0.5);
        g.traverse(o => { if (o.isMesh) o.castShadow = false; });
        W.camera.add(g);
        holdMesh = g;
    }
    const dishName = k => ({ vegRaw: 'raw vegetables', veg: 'chopped vegetables', pattyRaw: 'a raw patty', stew: 'a bowl of stew', burger: 'a burger' }[k]);

    // ---------- Cutting board ----------
    function boardPrompt() {
        if (chop) return `${PB.key('LMB')}/Space chop in the green · ${PB.key('E')} stop`;
        return hold && hold.kind === 'vegRaw' ? `${PB.key('E')} Chop the vegetables 🔪` : 'Cutting board (bring vegetables from the crate)';
    }
    function useBoard() {
        if (chop) { chop = null; A.meter.hide(); PB.Player.speedMult = 1; return; }
        if (!hold || hold.kind !== 'vegRaw') return;
        setHold(null);
        K.boardVeg.visible = true;
        chop = { mark: 0, dir: 1, speed: 1.3, chops: 0, hits: 0 };
        PB.Player.speedMult = 0;
        A.meter.show('🔪 Chop! Press LMB / Space in the green');
    }
    function updateChop(dt) {
        chop.mark += chop.dir * chop.speed * dt;
        if (chop.mark > 1) { chop.mark = 1; chop.dir = -1; } else if (chop.mark < 0) { chop.mark = 0; chop.dir = 1; }
        A.meter.set(chop.mark, 0.4, 0.6, `🔪 Chops: <b>${chop.chops}/5</b> · clean cuts ${chop.hits}`);
        K.knife.rotation.z = PB.damp(K.knife.rotation.z, 0, 12, dt);
        if (!A.justPressed) return;
        chop.chops++;
        K.knife.rotation.z = 0.6;
        if (chop.mark >= 0.4 && chop.mark <= 0.6) { chop.hits++; PB.Audio.play('chop'); } else PB.Audio.play('chop', { vol: 0.4 });
        chop.speed *= 1.08;
        if (chop.chops >= 5) {
            const q = 35 + chop.hits * 13;
            chop = null; A.meter.hide(); PB.Player.speedMult = 1;
            K.boardVeg.visible = false;
            setHold({ kind: 'veg', q });
            PB.UI.toast(`Chopped! ${q >= 80 ? 'Perfect cubes.' : q >= 60 ? 'Not bad.' : 'Chunky...'} Put them in a pot.`, '', 2.5);
        }
    }

    // ---------- Pots ----------
    // doneness 0..1.3: green window 0.65 – 0.85
    const cookQ = (q, d) => d < 0.65 ? q * (0.35 + 0.4 * d / 0.65) : d <= 0.85 ? q : d < 1.3 ? q * (1 - (d - 0.85) * 1.8) : 5;
    function potPrompt(pot) {
        const d = pot.t / POT_T;
        if (pot.state === 'empty') return hold && hold.kind === 'veg' ? `${PB.key('E')} Put the vegetables in the pot` : 'Pot (bring chopped vegetables)';
        if (hold) return 'Your hands are full';
        return `${PB.key('E')} Take the stew off ${d < 0.65 ? '(still raw!)' : d <= 0.85 ? '(perfect!)' : '(burning!)'}`;
    }
    function usePot(pot) {
        if (pot.state === 'empty') {
            if (!hold || hold.kind !== 'veg') return;
            pot.state = 'cooking'; pot.t = 0; pot.q = hold.q;
            pot.soup.visible = true; pot.gauge.sp.visible = true;
            setHold(null);
            PB.Audio.play('sizzle');
            return;
        }
        if (hold) return;
        const q = Math.round(cookQ(pot.q, pot.t / POT_T));
        pot.state = 'empty'; pot.soup.visible = false; pot.gauge.sp.visible = false; pot.steam.material.opacity = 0;
        setHold({ kind: 'stew', q });
        PB.Audio.play('plate');
    }

    // ---------- Grill ----------
    function grillPrompt() {
        const d = grill.t / GRILL_T;
        if (grill.state === 'empty') return hold && hold.kind === 'pattyRaw' ? `${PB.key('E')} Put the patty on the grill` : 'Grill (bring a raw patty from the fridge)';
        if (grill.state === 'side1') return `${PB.key('E')} Flip it ${d < 0.6 ? '(too early!)' : d <= 0.85 ? '(now!)' : '(burning!)'}`;
        if (hold) return 'Your hands are full';
        return `${PB.key('E')} Take the burger off ${d < 0.6 ? '(too early!)' : d <= 0.85 ? '(perfect!)' : '(burning!)'}`;
    }
    const sideScore = d => d < 0.6 ? Math.max(0.2, d / 0.6) : d <= 0.85 ? 1 : Math.max(0, 1 - (d - 0.85) * 2.2);
    function useGrill() {
        if (grill.state === 'empty') {
            if (!hold || hold.kind !== 'pattyRaw') return;
            setHold(null);
            grill.state = 'side1'; grill.t = 0;
            grill.patty.visible = true; grill.patty.material = W.mat(0xd98a8a); grill.gauge.sp.visible = true;
            PB.Audio.play('sizzle');
        } else if (grill.state === 'side1') {
            grill.s1 = sideScore(grill.t / GRILL_T);
            grill.state = 'side2'; grill.t = 0;
            grill.patty.rotation.x = Math.PI;
            PB.Audio.play('swish', { vol: 0.4 }); PB.Audio.play('sizzle');
        } else {
            if (hold) return;
            const q = Math.round(20 + 80 * (grill.s1 + sideScore(grill.t / GRILL_T)) / 2);
            grill.state = 'empty'; grill.patty.visible = false; grill.gauge.sp.visible = false; grill.patty.rotation.x = 0;
            setHold({ kind: 'burger', q });
            PB.Audio.play('plate');
        }
    }

    // ---------- Serving ----------
    function hatchPrompt() {
        if (!hold) return queue.length ? `Orders: ${queue.map(c => c.want === 'stew' ? '🍲' : '🍔').join(' ')}` : 'Serving hatch (nobody waiting)';
        if (hold.kind !== 'stew' && hold.kind !== 'burger') return 'Serving hatch (that\'s not a finished dish)';
        return `${PB.key('E')} Serve ${dishName(hold.kind)}`;
    }
    function serve() {
        if (!hold || (hold.kind !== 'stew' && hold.kind !== 'burger')) return;
        const c = queue.find(x => x.want === hold.kind);
        if (!c) { PB.UI.toast('Nobody in the queue ordered that.', 'bad'); return; }
        const q = hold.q, money = Math.round(6 + q * 0.14);
        setHold(null);
        A.pay(money); stats.earned += money; stats.served++;
        if (q >= 60) { stats.good++; A.progress('cook', 1); }
        if (q >= 80) A.rep(1);
        PB.Audio.play(q >= 60 ? 'cash' : 'coin');
        A.say('kitchen', c.ch, q >= 80 ? PB.choice(['Delicious!', 'Like mama used to make!', 'Best food in years!']) : q >= 60 ? PB.choice(['Not bad.', 'Thanks, chef.', 'Hm, decent.']) : PB.choice(['Is this... food?', 'Raw. Great.', 'It\'s BURNT!']), 2.5);
        PB.UI.toast(`${q >= 80 ? '⭐' : q >= 60 ? '👍' : '👎'} Served (quality ${q}). +$${money}`, q >= 60 ? 'good' : '', 2.5);
        leave(c);
    }
    function leave(c) {
        queue = queue.filter(x => x !== c);
        PB.UI.removeBubble('kitchenOrder' + c.id);
        c.leaving = true;
        c.w.target = { x: 7.5, z: 3.5 };
        c.w.onArrive = () => { if (K.scene) K.scene.remove(c.ch.root); };
        K.leavers = (K.leavers || []).concat(c);
        queue.forEach((o, i) => { o.w.target = { x: 5.7 + i * 0.75, z: 1 }; o.w.onArrive = () => { o.w.face = -Math.PI / 2; }; });
    }
    function spawnCustomer() {
        const ch = PB.NPC.makeChar({ skin: PB.choice([0xf2c29b, 0xc68642, 0x8d5524, 0xe0a27a]), shirt: 0xf07a22, pants: 0xe06a12, hair: PB.choice([0x1a1a1a, 0x2b1d14, 0x8a8a8a]), hat: PB.choice(['hair', 'beanie']), hatColor: 0x8a2a2a, belly: Math.random() < 0.3 });
        ch.root.position.set(7.5, 0, 3.5);
        K.scene.add(ch.root);
        const c = { id: ++custId, ch, w: PB.NPC.walker(ch, 1.2), want: Math.random() < 0.5 ? 'stew' : 'burger', patience: 75, max: 75 };
        c.w.target = { x: 5.7 + queue.length * 0.75, z: 1 };
        c.w.onArrive = () => { c.w.face = -Math.PI / 2; };
        queue.push(c);
        PB.UI.bubble('kitchenOrder' + c.id, c.want === 'stew' ? '🍲 Stew' : '🍔 Burger', () => new THREE.Vector3(c.ch.root.position.x, 2.15, c.ch.root.position.z), Infinity, 'tag');
    }

    // ---------- Pantry ----------
    function steal(cr) {
        if (cr.left <= 0) return;
        if (K.pockets.length >= 3) { PB.UI.toast('Your pockets are full.', 'bad'); return; }
        if (A.sees(guard)) {
            PB.Audio.play('caught');
            A.addHeat(8);
            A.say('kitchen', guard.ch, 'Hands off the pantry!', 2.5, 'guard');
            PB.UI.toast('🚨 Caught with your hand in the pantry! Heat +8', 'bad', 4);
            return;
        }
        cr.left--;
        K.pockets.push(cr.type);
        PB.Audio.play('pickup');
        PB.UI.toast(`🤫 Pocketed ${PB.ITEMS[cr.type].name}.`, 'good', 2);
    }

    // ---------- Per frame ----------
    K.update = dt => {
        if (!K.active || !K.scene) return;
        if (!PB.state.kitchenOpen) { K.exit(true); return; }
        A.poll();
        A.patrol(guard, dt);
        const watched = A.sees(guard);
        guard.cone.material.opacity = watched ? 0.3 : 0.14;
        if (chop) updateChop(dt);

        pots.forEach(p => {
            if (p.state !== 'cooking') return;
            p.t += dt;
            const d = p.t / POT_T;
            p.gauge.draw(d, 0.65 / 1.3, 0.85 / 1.3, d < 0.65 ? 'Cooking…' : d <= 0.85 ? 'READY!' : d < 1.3 ? 'Burning!' : 'BURNT');
            p.soup.material = W.mat(d > 1.0 ? 0x3a2a1a : 0x8a5a2a);
            p.steam.material.opacity = Math.min(0.5, d * 0.4) * (0.7 + Math.sin(performance.now() / 200) * 0.3);
            p.steam.position.y = 0.45 + Math.sin(performance.now() / 300) * 0.05;
            if (d > 0.85 && Math.random() < dt * 0.6) PB.Audio.play('sizzle', { vol: 0.5 });
        });
        if (grill.state !== 'empty') {
            grill.t += dt;
            const d = grill.t / GRILL_T;
            grill.gauge.draw(d, 0.6 / 1.3, 0.85 / 1.3, grill.state === 'side1' ? (d < 0.6 ? 'Side 1…' : d <= 0.85 ? 'FLIP NOW!' : 'Burning!') : (d < 0.6 ? 'Side 2…' : d <= 0.85 ? 'TAKE IT!' : 'Burning!'));
            grill.patty.material = W.mat(d < 0.5 ? 0xd98a8a : d < 0.9 ? 0x8a4a2a : 0x2a1a0a);
        }

        // the queue
        qT -= dt;
        if (qT <= 0 && queue.length < 4) { spawnCustomer(); qT = PB.rand(7, 12); }
        queue.slice().forEach(c => {
            PB.NPC.updWalker(c.w, dt);
            c.patience -= dt;
            if (c.patience <= 0) {
                A.say('kitchen', c.ch, PB.choice(['Forget it!', 'I\'m starving here!', 'Worst kitchen ever.']), 2.5);
                A.rep(-1);
                leave(c);
            }
        });
        (K.leavers || []).forEach(c => PB.NPC.updWalker(c.w, dt));
        K.leavers = (K.leavers || []).filter(c => c.ch.root.parent);

        const orders = queue.map(c => `${c.want === 'stew' ? '🍲' : '🍔'}<small>${Math.ceil(c.patience)}s</small>`).join(' ');
        A.hud(`<div class="chip">🍳 Kitchen <b>${PB.Game.clock()}</b></div><div class="chip">Orders: ${orders || '—'}</div>`
            + `<div class="chip">✋ ${hold ? dishName(hold.kind) + (hold.q ? ` (${hold.q})` : '') : 'empty hands'}</div><div class="chip">🍽️ ${stats.served} served · $${stats.earned}</div>`
            + `<div class="chip">👖 ${K.pockets.length ? K.pockets.map(t => PB.ITEMS[t].icon).join(' ') : '—'}</div>${watched ? '<div class="chip eye">👁️ Watched</div>' : ''}`);
    };

    function dispose() {
        setHold(null);
        queue.forEach(c => PB.UI.removeBubble('kitchenOrder' + c.id));
        A.meter.hide();
        PB.Player.speedMult = 1;
        A.dispose(K.scene);
        K.scene = null; pots = []; grill = null; queue = []; guard = null; crates = []; chop = null; K.leavers = [];
        K.interactables = []; K.colliders = [];
    }

    return K;
})();
