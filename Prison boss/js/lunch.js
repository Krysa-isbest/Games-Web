'use strict';
// The canteen. Doors open at 12:00. The whole room is built only when you walk in and is thrown away
// when you leave, so it costs nothing the rest of the time.
// Steal small things into your pockets while no guard is looking (their view cones are drawn on the floor).
PB.Lunch = (() => {
    const L = { scene: null, interactables: [], colliders: [], bounds: { x0: -8.6, x1: 8.6, z0: -6.6, z1: 6.6 }, pockets: [], time: 0, active: false };
    const POCKETS = 3, LUNCH_TIME = 110, VIEW = 5.2, FOV = 0.62; // view cone: 5.2 m, ±35°
    let W, guards = [], eaters = [], cook = null, steam = [], murmur = null, clinkT = 0, ownTray = null, ate = false, seen = 0;
    const $ = id => document.getElementById(id);

    // ---------- Entering / leaving ----------
    L.enter = () => {
        if (L.active || PB.Mini.active) return;
        const s = PB.state;
        if (L.wentDay === s.day) { PB.UI.toast('You already had lunch today.', 'bad'); return; }
        L.wentDay = s.day;
        PB.Player.stashHeld();
        fade(() => {
            L.build();
            W.area = 'canteen';
            W.activeScene = L.scene;
            L.scene.add(W.rig);
            L.cell = PB.Player.cell;
            L.returnPos = PB.Player.pos.clone(); L.returnYaw = PB.Player.yaw;
            PB.Player.pos.set(0, 1.6, -6.0); PB.Player.yaw = Math.PI; PB.Player.pitch = -0.05;
            L.active = true; L.time = LUNCH_TIME * PB.Events.mult('lunch'); L.pockets = []; ate = false; seen = 0;
            murmur = PB.Audio.loop('murmur'); murmur.set(0.55);
            $('lunch-hud').classList.remove('hidden');
            hud();
            PB.UI.toast('🍽️ Lunch time! Grab what you can, but don\'t let the guards see you.', '', 5);
        });
    };

    L.exit = (forced) => {
        if (!L.active) return;
        L.active = false;
        if (murmur) { murmur.stop(); murmur = null; }
        const frisked = Math.random() < 0.35;
        let lost = [];
        if (frisked) {
            lost = L.pockets.filter(t => PB.ITEMS[t].contraband && Math.random() < 0.6);
            lost.forEach(t => L.pockets.splice(L.pockets.indexOf(t), 1));
        }
        const got = L.pockets.slice();
        fade(() => {
            W.area = 'cell';
            W.activeScene = W.scene;
            W.scene.add(W.rig);
            L.dispose();
            const P = PB.Player;
            P.cell = L.cell;
            P.pos.copy(W.cells[L.cell].toWorld(0.2, 1.6, -1.2)); P.yaw = Math.PI; P.pitch = -0.1; // just inside the bars, clear of the toilet
            $('lunch-hud').classList.add('hidden');
            if (forced) PB.UI.toast('🔔 Lunch is over! Back to your cell.');
            if (frisked) {
                PB.UI.toast(lost.length ? `👮 "Arms up!" The guard frisked you and took: ${lost.map(t => PB.ITEMS[t].name).join(', ')}` : '👮 "Arms up!" You got frisked, but they found nothing.', lost.length ? 'bad' : '', 5);
                if (lost.length) addHeat(8);
            }
            if (got.length) {
                if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'pockets', cell: L.cell, types: got });
                else L.unpack(L.cell, got);
                PB.UI.toast(`You emptied your pockets onto the floor: ${got.map(t => PB.ITEMS[t].icon).join(' ')}`, 'good', 4);
            }
            L.pockets = [];
        });
    };

    // Host side: stolen goods land on the floor of the cell
    L.unpack = (cell, types) => {
        types.forEach(t => PB.Items.spawn(t, [cell + 'floor', cell + 'desk']));
        const stolen = types.filter(t => !PB.KEY_PARTS.includes(t)).length; // key pieces come from the workshop
        if (stolen) PB.Game.progress('steal', stolen);
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

    // ---------- Building the room ----------
    L.build = () => {
        W = PB.World;
        const sc = L.scene = new THREE.Scene();
        sc.background = new THREE.Color(0x9fd8ff);
        L.interactables = []; L.colliders = []; guards = []; eaters = []; steam = [];
        const gfx = PB.Settings.v.gfx;

        // lights
        sc.add(new THREE.HemisphereLight(0xfff6e8, 0x6a5a7a, 0.65));
        const sun = L.sun = new THREE.DirectionalLight(0xfff0d0, 0.8);
        sun.position.set(14, 9, 2); sun.target.position.set(0, 0, 0);
        sun.castShadow = gfx !== 'low';
        sun.shadow.mapSize.set(gfx === 'high' ? 2048 : 1024, gfx === 'high' ? 2048 : 1024);
        Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 1, far: 40 });
        sun.shadow.bias = -0.0008;
        sc.add(sun, sun.target);
        [[-4, 0], [3, 0], [-1, 4.5]].forEach(([x, z]) => { const p = new THREE.PointLight(0xfff0d8, 0.5, 12, 2); p.position.set(x, 3.2, z); sc.add(p); });

        const H = 3.6;
        // floor: red and cream checker tiles
        const tiles = W.canvasTex(256, 256, (g, w) => {
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
                g.fillStyle = (i + j) % 2 ? '#c94a3a' : '#f1e6cc'; g.fillRect(i * 64, j * 64, 64, 64);
            }
            for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * w, 3, 3); }
        });
        tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(9, 7);
        W.box(18, 0.1, 14, new THREE.MeshToonMaterial({ map: tiles, gradientMap: W.grad() }), 0, -0.05, 0, sc);
        W.box(18, 0.1, 14, 0xe8e2d0, 0, H + 0.05, 0, sc);

        // walls (east wall has windows)
        const wallBand = (len, x, z, rotY) => {
            const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; sc.add(g);
            W.box(len, 1.2, 0.2, 0x4f8fb0, 0, 0.6, 0, g);
            W.box(len, 0.1, 0.22, 0x2c5a75, 0, 1.25, 0, g);
            W.box(len, H - 1.3, 0.2, 0xf0e6cf, 0, 1.3 + (H - 1.3) / 2, 0, g);
            return g;
        };
        wallBand(18, 0, 7.1, 0);
        wallBand(18, 0, -7.1, 0);
        wallBand(14.4, -9.1, 0, Math.PI / 2);
        // east wall with 4 windows
        const ew = new THREE.Group(); ew.position.set(9.1, 0, 0); sc.add(ew);
        const zs = [-7.2, -5.6, -4.4, -2.6, -1.4, 0.4, 1.6, 3.4, 4.6, 7.2];
        for (let i = 0; i < zs.length - 1; i++) {
            const z0 = zs[i], z1 = zs[i + 1], zc = (z0 + z1) / 2, len = z1 - z0, win = i % 2 === 1 && i < 8;
            if (win) {
                W.box(0.2, 1.4, len, 0x4f8fb0, 0, 0.7, zc, ew);
                W.box(0.2, H - 2.9, len, 0xf0e6cf, 0, 2.9 + (H - 2.9) / 2, zc, ew);
                for (let k = 0; k < 4; k++) W.cyl(0.02, 0.02, 1.5, 0x3a4356, 0, 2.15, z0 + 0.15 + k * (len - 0.3) / 3, ew, 8);
                const sky = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.5), new THREE.MeshBasicMaterial({ color: 0xbfe6ff }));
                sky.position.set(0.3, 2.15, zc); sky.rotation.y = -Math.PI / 2; ew.add(sky);
            } else {
                W.box(0.2, 1.2, len, 0x4f8fb0, 0, 0.6, zc, ew);
                W.box(0.2, 0.1, len, 0x2c5a75, 0, 1.25, zc, ew);
                W.box(0.2, H - 1.3, len, 0xf0e6cf, 0, 1.3 + (H - 1.3) / 2, zc, ew);
            }
        }
        // ceiling light panels
        [[-5, -3], [0, -3], [5, -3], [-5, 2], [0, 2], [5, 2]].forEach(([x, z]) => {
            W.box(1.6, 0.06, 0.5, 0x51617a, x, H - 0.03, z, sc);
            W.box(1.5, 0.04, 0.4, new THREE.MeshBasicMaterial({ color: 0xfffaee }), x, H - 0.07, z, sc);
        });
        // signs
        const sign = (text, col, x, y, z, rotY, w = 2.4) => {
            const t = W.canvasTex(512, 128, (g) => {
                g.fillStyle = col; g.fillRect(0, 0, 512, 128);
                g.strokeStyle = '#221a2e'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
                g.fillStyle = '#221a2e'; g.font = 'bold 60px Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
                g.fillText(text, 256, 68);
            });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshToonMaterial({ map: t, gradientMap: W.grad() }));
            m.position.set(x, y, z); m.rotation.y = rotY; sc.add(m);
        };
        sign('CANTEEN · BLOCK C', '#ffd23f', -2, 2.9, 6.98, Math.PI, 3.2);
        sign('NO STEALING!', '#ff8a80', -9.0, 2.4, -2, Math.PI / 2);
        sign('EXIT', '#7ee08a', 0, 2.75, -6.98, 0, 1.2);

        // exit door
        const door = new THREE.Group(); door.position.set(0, 0, -7.0); sc.add(door);
        W.box(1.4, 2.4, 0.1, 0x7a8ca8, 0, 1.2, 0, door);
        W.box(0.5, 0.35, 0.11, 0x1b1f2a, 0, 1.8, 0, door);
        inter(door, { prompt: () => `${PB.key('E')} Go back to your cell`, use: () => L.exit(false) });

        buildCounter(sc);
        buildCondiments(sc);
        buildTables(sc);
        buildGuards(sc);
        L.applyShadows();
    };

    // Every mesh in the canteen casts/receives shadows only when the graphics setting allows it
    L.applyShadows = () => {
        const on = PB.Settings.v.gfx !== 'low';
        L.scene.traverse(o => { if (o.isMesh) { o.castShadow = on && !o.userData.noShadow; o.receiveShadow = on; } });
    };

    function inter(obj, def) { obj.userData.interact = def; L.interactables.push(obj); }
    function remove(obj) {
        if (obj.parent) obj.parent.remove(obj);
        const k = L.interactables.indexOf(obj);
        if (k >= 0) L.interactables.splice(k, 1);
    }
    const col = (x0, x1, z0, z1) => L.colliders.push({ x0, x1, z0, z1 });

    // ---------- Serving counter with the cook ----------
    function buildCounter(sc) {
        const g = new THREE.Group(); g.position.set(-2, 0, 6.0); sc.add(g);
        W.box(8, 0.95, 0.9, 0xb9c2cf, 0, 0.475, 0, g);
        W.box(8.1, 0.05, 1.0, 0xdde3ea, 0, 0.97, 0, g);
        const glass = W.box(7.6, 0.45, 0.02, W.mat(0xcfefff, { transparent: true, opacity: 0.35 }), 0, 1.45, -0.3, g);
        glass.userData.noShadow = true;
        W.box(7.6, 0.03, 0.4, 0xdde3ea, 0, 1.68, -0.1, g);
        // food pans
        const pans = [
            [-3, 0xf3ead2, 'mash'], [-1.7, 0x6cbf4a, 'peas'], [-0.4, 0x8a4a2a, 'loaf'], [0.9, 0xe0465a, 'jello']
        ];
        pans.forEach(([x, c, kind]) => {
            W.box(1.1, 0.08, 0.55, 0x8f99a8, x, 0.98, 0.05, g);
            if (kind === 'mash') for (let i = 0; i < 7; i++) W.sph(0.09, c, x - 0.4 + (i % 4) * 0.27, 1.03, -0.08 + Math.floor(i / 4) * 0.25, g, 10).scale.y = 0.6;
            else if (kind === 'peas') for (let i = 0; i < 40; i++) W.sph(0.022, c, x + PB.rand(-0.45, 0.45), 1.04, PB.rand(-0.18, 0.28), g, 6);
            else if (kind === 'loaf') for (let i = 0; i < 3; i++) W.box(0.3, 0.1, 0.4, c, x - 0.33 + i * 0.33, 1.06, 0.05, g);
            else for (let i = 0; i < 8; i++) { const j = W.box(0.13, 0.13, 0.13, W.mat(c, { transparent: true, opacity: 0.85 }), x - 0.4 + (i % 4) * 0.27, 1.07, -0.08 + Math.floor(i / 4) * 0.25, g); j.rotation.y = i; }
        });
        // soup pot with steam
        W.cyl(0.3, 0.27, 0.45, 0x8f99a8, 2.6, 1.2, 0.05, g, 18);
        W.cyl(0.27, 0.27, 0.02, 0xd98a3a, 2.6, 1.41, 0.05, g, 18);
        const ladle = W.cyl(0.015, 0.015, 0.6, 0x5a6270, 2.75, 1.5, 0.05, g, 6); ladle.rotation.z = 0.5;
        const sm = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
        for (let i = 0; i < 8; i++) {
            const sp = new THREE.Sprite(sm.clone());
            sp.position.set(0.6 + PB.rand(-0.15, 0.15), 1.5 + i * 0.12, 6.05 + PB.rand(-0.15, 0.15));
            sc.add(sp); steam.push({ sp, t: Math.random() * 2 });
        }
        // tray stack
        for (let i = 0; i < 8; i++) W.box(0.5, 0.02, 0.36, i % 2 ? 0xe8742a : 0xd8652a, 3.6, 0.99 + i * 0.022, 0.05, g);
        col(-6.1, 2.1, 5.45, 7);

        // the cook
        const ch = PB.NPC.makeChar({ skin: 0xf2c29b, shirt: 0xffffff, pants: 0x2a2a3a, hair: 0x2b1d14, hat: 'hair', mustache: true, belly: true });
        W.cyl(0.13, 0.15, 0.2, 0xffffff, 0, 0.2, 0, ch.head, 14); // chef hat
        W.sph(0.17, 0xffffff, 0, 0.32, 0, ch.head, 12).scale.y = 0.55;
        ch.root.position.set(-1.5, 0, 6.75); ch.root.rotation.y = Math.PI;
        sc.add(ch.root);
        cook = { ch, t: 0 };
        inter(ch.root, { prompt: () => `${PB.key('E')} Talk to the cook`, use: () => say(ch, PB.choice(['Keep it moving!', 'Meatloaf again. Don\'t complain.', 'You want peas? Too bad, you get peas.', 'NEXT!'])) });
    }

    // ---------- Things worth stealing ----------
    function buildCondiments(sc) {
        const g = new THREE.Group(); g.position.set(5, 0, 5.9); sc.add(g);
        W.box(2.2, 0.85, 0.9, 0x9c6b3c, 0, 0.425, 0, g);
        W.box(2.3, 0.05, 1.0, 0xb4733f, 0, 0.87, 0, g);
        col(3.8, 6.2, 5.35, 6.5);
        const Y = 0.895;
        // pepper grinder
        const pg = new THREE.Group(); pg.position.set(-0.8, Y, -0.1); g.add(pg);
        W.cyl(0.045, 0.05, 0.16, 0x6b4a2a, 0, 0.08, 0, pg, 14); W.cyl(0.048, 0.048, 0.05, 0x8a6a4a, 0, 0.18, 0, pg, 14); W.sph(0.025, 0x6b4a2a, 0, 0.22, 0, pg, 10);
        stealable(pg, 'grinder');
        // salt shaker (just decoration)
        W.cyl(0.03, 0.035, 0.12, 0xffffff, -0.55, Y + 0.06, -0.15, g, 12);
        // a tube of glue (needed for the fake key)
        const gl = new THREE.Group(); gl.position.set(-0.55, Y, 0.2); g.add(gl);
        W.cyl(0.025, 0.028, 0.1, 0xf6f6f2, 0, 0.03, 0, gl, 10).rotation.z = Math.PI / 2;
        W.cyl(0.008, 0.016, 0.035, 0xe84a3a, 0.065, 0.03, 0, gl, 8).rotation.z = -Math.PI / 2;
        stealable(gl, 'glue');
        // sugar bag
        const sb = new THREE.Group(); sb.position.set(-0.2, Y, -0.1); g.add(sb);
        W.box(0.2, 0.25, 0.15, 0xf6f6f2, 0, 0.125, 0, sb); W.box(0.202, 0.07, 0.152, 0x3d7bff, 0, 0.13, 0, sb);
        stealable(sb, 'sugar');
        // cup of spoons
        W.cyl(0.06, 0.05, 0.12, 0x9aa3b5, 0.35, Y + 0.06, -0.2, g, 14);
        for (let i = 0; i < 2; i++) {
            const s = new THREE.Group(); s.position.set(0.35 + (i ? 0.025 : -0.025), Y + 0.1, -0.2); s.rotation.z = i ? 0.25 : -0.25; g.add(s);
            W.box(0.015, 0.16, 0.008, 0xc8ccd6, 0, 0.05, 0, s); W.sph(0.022, 0xd8dce6, 0, 0.14, 0, s, 10).scale.set(0.9, 1.3, 0.4);
            stealable(s, 'spoon');
        }
        // fruit basket
        W.cyl(0.2, 0.15, 0.1, 0xb4733f, 0.75, Y + 0.05, 0.1, g, 16);
        [[0xd8322f, -0.07, 0], [0xff9a1f, 0.07, 0.03], [0xb8d43a, 0, -0.07]].forEach(([c, dx, dz], i) => {
            const f = new THREE.Group(); f.position.set(0.75 + dx, Y + 0.13, 0.1 + dz); g.add(f);
            W.sph(0.045, c, 0, 0, 0, f, 12);
            stealable(f, 'fruit');
        });
        // crate of empty bottles
        const cr = new THREE.Group(); cr.position.set(6.8, 0, 4.9); sc.add(cr);
        W.box(0.6, 0.3, 0.45, 0x7b4a28, 0, 0.15, 0, cr);
        for (let i = 0; i < 3; i++) {
            const b = new THREE.Group(); b.position.set(-0.17 + i * 0.17, 0.3, 0); cr.add(b);
            W.cyl(0.04, 0.04, 0.16, W.mat(0x6fbf73, { transparent: true, opacity: 0.6 }), 0, 0.02, 0, b, 10);
            W.cyl(0.015, 0.02, 0.07, W.mat(0x6fbf73, { transparent: true, opacity: 0.6 }), 0, 0.13, 0, b, 8);
            stealable(b, 'bottle');
        }
        col(6.45, 7.15, 4.6, 5.2);
    }

    function stealable(obj, type) {
        inter(obj, {
            prompt: () => `${PB.key('E')} Steal ${PB.ITEMS[type].name} ${PB.ITEMS[type].icon}` + (L.pockets.length >= POCKETS ? '  (pockets full!)' : ''),
            use: () => steal(obj, type)
        });
    }

    function steal(obj, type) {
        if (L.pockets.length >= POCKETS) { PB.Audio.play('bad'); PB.UI.toast('Your pockets are full!', 'bad'); return; }
        const g = whoSees();
        if (g) {
            seen++;
            PB.Audio.play('caught');
            say(g.ch, seen >= 2 ? 'That\'s it! Back to your cell!' : 'HEY! Put that back!', true);
            addHeat(10);
            PB.UI.toast('🚨 A guard saw you stealing! Heat +10', 'bad', 4);
            if (seen >= 2) setTimeout(() => L.exit(true), 1200);
            return;
        }
        remove(obj);
        L.pockets.push(type);
        PB.Audio.play('pickup');
        PB.UI.toast(`Pocketed: ${PB.ITEMS[type].name} ${PB.ITEMS[type].icon}`, 'good');
        hud();
    }

    // ---------- Tables, inmates, your tray ----------
    function tray(sc, x, z, withSpoon, mine) {
        const g = new THREE.Group(); g.position.set(x, 0.78, z); sc.add(g);
        W.box(0.45, 0.02, 0.32, mine ? 0x3ecf6e : 0xe8742a, 0, 0.01, 0, g);
        W.cyl(0.11, 0.09, 0.02, 0xffffff, -0.07, 0.03, 0, g, 16);
        W.sph(0.05, 0xf3ead2, -0.09, 0.05, -0.02, g, 8).scale.y = 0.6;
        W.box(0.07, 0.03, 0.05, 0x8a4a2a, -0.03, 0.05, 0.03, g);
        W.cyl(0.035, 0.03, 0.08, 0xd9d9e0, 0.15, 0.06, -0.08, g, 10);
        if (withSpoon) {
            const s = new THREE.Group(); s.position.set(0.14, 0.03, 0.08); g.add(s);
            W.box(0.11, 0.006, 0.014, 0xc8ccd6, 0, 0, 0, s); W.sph(0.02, 0xd8dce6, -0.065, 0, 0, s, 8).scale.set(1.3, 0.35, 0.9);
            stealable(s, 'spoon');
        }
        return g;
    }

    function buildTables(sc) {
        const tableZ = [-3.2, -0.2, 2.8];
        const SKINS = [0xf2c29b, 0xe0a27a, 0xc68642, 0x8d5524, 0xffd7b5], HAIRS = [0x2b1d14, 0x5a3a1a, 0xd9b45a, 0x1a1a1a, 0x8a8a8a];
        tableZ.forEach((z, ti) => {
            W.box(8, 0.06, 0.9, 0xd8d0bc, -1, 0.75, z, sc);
            [-4.6, -1, 2.6].forEach(x => W.box(0.1, 0.72, 0.6, 0x5a6270, x, 0.36, z, sc));
            [-0.75, 0.75].forEach(dz => {
                W.box(8, 0.06, 0.35, 0x8a99ad, -1, 0.45, z + dz, sc);
                [-4.6, -1, 2.6].forEach(x => W.box(0.08, 0.42, 0.2, 0x5a6270, x, 0.21, z + dz, sc));
            });
            col(-5.05, 3.05, z - 0.95, z + 0.95);
            for (let i = 0; i < 6; i++) {
                const x = -4.2 + i * 1.3, side = i % 2 ? 1 : -1;
                const mine = ti === 1 && i === 3;
                if (mine) { ownTray = tray(sc, x, z + side * 0.25, false, true); continue; }
                const occupied = (i + ti) % 3 !== 0;
                tray(sc, x, z + side * 0.25, Math.random() < 0.35, false);
                if (!occupied) continue;
                const ch = PB.NPC.makeChar({ skin: PB.choice(SKINS), shirt: 0xf07a22, pants: 0xe06a12, hair: PB.choice(HAIRS), hat: Math.random() < 0.7 ? 'hair' : 'beanie', hatColor: 0x3a5a8a, mustache: Math.random() < 0.3, belly: Math.random() < 0.3 });
                ch.root.position.set(x, -0.37, z + side * 0.75); // sitting on the bench
                ch.root.rotation.y = side > 0 ? Math.PI : 0;
                ch.legL.rotation.x = ch.legR.rotation.x = -1.45;
                sc.add(ch.root);
                eaters.push({ ch, t: Math.random() * 6, speed: PB.rand(1.5, 2.5) });
                inter(ch.root, { prompt: () => `${PB.key('E')} Chat`, use: () => say(ch, PB.choice(['Mind your own tray.', 'The pepper grinder? Guards watch it like hawks.', 'Psst. Spoons make good shovels.', 'This loaf bounced. I swear.', 'Get lost, fish.', 'Heard someone dug out of D-block once…'])) });
            }
        });
        inter(ownTray, {
            prompt: () => ate ? null : `${PB.key('E')} Eat your lunch`,
            use: () => {
                if (ate) return;
                ate = true;
                PB.Audio.play('squish');
                if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'heat', n: -5 }); else PB.state.heat = Math.max(0, PB.state.heat - 5);
                PB.UI.toast('😋 Good behaviour. Heat -5', 'good');
            }
        });
    }

    // ---------- Guards with view cones ----------
    function cone(color) {
        const geo = new THREE.CircleGeometry(VIEW, 24, Math.PI / 2 - FOV, FOV * 2);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = Math.PI / 2; // circle's +y ends up pointing forward (+z), the way the guard faces
        m.position.y = 0.02;
        m.userData.noShadow = true;
        return m;
    }
    function buildGuards(sc) {
        const mk = () => PB.NPC.makeChar({ skin: 0xf2c29b, shirt: 0x3b5998, pants: 0x23304f, hair: 0x2b1d14, hat: 'cap', badge: true, belt: true, angry: true });
        // G1 watches the room from near the exit, sweeping left and right
        const a = mk(); a.root.position.set(3.5, 0, -5.6); sc.add(a.root);
        const ca = cone(0xff4d4d); a.root.add(ca);
        guards.push({ ch: a, cone: ca, type: 'watch', t: 0, w: PB.NPC.walker(a, 1) });
        // G2 walks a loop around the tables
        const b = mk(); b.root.position.set(-7, 0, -4.5); sc.add(b.root);
        const cb = cone(0xff4d4d); b.root.add(cb);
        const path = [[-7, -4.6], [-7, 4.4], [7.6, 4.4], [7.6, -4.6]];
        const gb = { ch: b, cone: cb, type: 'patrol', path, k: 1, w: PB.NPC.walker(b, 1.1), wait: 0 };
        guards.push(gb);
        const go = () => { const [x, z] = gb.path[gb.k]; gb.k = (gb.k + 1) % gb.path.length; gb.wait = PB.rand(1, 3); gb.w.target = { x, z }; gb.w.onArrive = () => { gb.arrived = true; }; };
        gb.next = go; go();
        guards.forEach(g => inter(g.ch.root, { prompt: () => `${PB.key('E')} Talk to the guard`, use: () => say(g.ch, PB.choice(['Move along.', 'Eat. Don\'t talk.', 'I\'m watching you, inmate.']), true) }));
    }

    // Is any guard looking at the player right now?
    function whoSees() {
        const P = PB.Player.pos;
        for (const g of guards) {
            const r = g.ch.root, dx = P.x - r.position.x, dz = P.z - r.position.z, d = Math.hypot(dx, dz);
            if (d > VIEW * (PB.Player.crouch ? 0.65 : 1)) continue; // crouching keeps you below their line of sight
            const facing = r.rotation.y + g.ch.head.rotation.y;
            let diff = Math.atan2(dx, dz) - facing;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) < FOV * PB.Events.mult('cone')) return g;
        }
        return null;
    }
    L.seen = () => !!whoSees();

    function say(ch, text, guard) {
        const v = new THREE.Vector3();
        PB.UI.bubble('lunch' + Math.random(), text, () => v.set(ch.root.position.x, 2.15, ch.root.position.z), 2.6, guard ? 'guard' : '');
    }

    // ---------- Per frame ----------
    L.update = dt => {
        if (!L.active) return;
        L.time -= dt;
        if (L.time <= 0) { L.exit(true); return; }
        // eating inmates
        eaters.forEach(e => {
            e.t += dt * e.speed;
            const k = (Math.sin(e.t) + 1) / 2;
            e.ch.armR.rotation.x = -0.5 - k * 1.1;
            e.ch.head.rotation.x = 0.15 - k * 0.1;
        });
        if (cook) { cook.t += dt; cook.ch.armR.rotation.x = -0.8 + Math.sin(cook.t * 2.2) * 0.5; cook.ch.head.rotation.y = Math.sin(cook.t * 0.5) * 0.4; }
        steam.forEach(s => {
            s.t += dt * 0.6;
            const f = s.t % 1;
            s.sp.position.y = 1.55 + f * 0.9;
            s.sp.material.opacity = 0.45 * (1 - f);
            s.sp.scale.setScalar(0.15 + f * 0.35);
        });
        // guards
        guards.forEach(g => {
            if (g.type === 'watch') {
                g.t += dt;
                g.ch.root.rotation.y = Math.sin(g.t * 0.35) * 1.1;
                g.ch.head.rotation.y = Math.sin(g.t * 0.9) * 0.35;
            } else {
                if (g.arrived) { g.wait -= dt; if (g.wait <= 0) { g.arrived = false; g.next(); } }
                g.ch.head.rotation.y = Math.sin(performance.now() / 900) * 0.4;
            }
            PB.NPC.updWalker(g.w, dt);
            g.cone.rotation.z = -g.ch.head.rotation.y; // cone follows the head
        });
        const watched = whoSees();
        guards.forEach(g => { g.cone.material.color.set(watched === g ? 0xff2020 : 0xff7a4d); g.cone.material.opacity = watched === g ? 0.32 : 0.16; });
        clinkT -= dt;
        if (clinkT <= 0) { clinkT = PB.rand(0.8, 2.5); PB.Audio.tone(PB.rand(2400, 3600), 0.05, { type: 'triangle', vol: 0.025 }); }
        L.watched = !!watched;
        hud();
    };

    function hud() {
        const t = Math.max(0, Math.ceil(L.time));
        $('lunch-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        $('lunch-pockets').innerHTML = Array.from({ length: POCKETS }, (_, i) => `<span class="pk">${L.pockets[i] ? PB.ITEMS[L.pockets[i]].icon : ''}</span>`).join('');
        $('lunch-eye').classList.toggle('on', !!L.watched);
    }

    // ---------- Throw it all away ----------
    L.dispose = () => {
        if (!L.scene) return;
        PB.Coop.rescueMate(L.scene); // the cellmate's avatar must not be thrown away with the room
        L.scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); if (o.isSprite || m.isMeshBasicMaterial) m.dispose(); });
        });
        L.scene = null; L.sun = null;
        L.interactables = []; L.colliders = []; guards = []; eaters = []; steam = []; cook = null; ownTray = null;
    };

    // Lunch can be interrupted by the day ending, sleeping or quitting
    L.abort = () => {
        if (!L.active) return;
        L.active = false;
        if (murmur) { murmur.stop(); murmur = null; }
        W.area = 'cell'; W.activeScene = W.scene; W.scene.add(W.rig);
        L.dispose();
        L.pockets = [];
        $('lunch-hud').classList.add('hidden');
        PB.Player.cell = L.cell || '';
        PB.Player.pos.copy(W.cells[PB.Player.cell].toWorld(0, 1.6, 0.6));
    };

    return L;
})();
