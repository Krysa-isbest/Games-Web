'use strict';
// Boot, the main loop, the main-menu kitchen (decor + your chef waving), starting / joining / leaving games,
// and the host's physics impact rules (floor = dirty food, hard hits smash plates, clink/thud sounds).
CF.Game = (() => {
    const G = { mode: 'menu', t: 0 };     // 'menu' | 'lobby' | 'play'
    let last = 0, contAcc = 0, physReady = false, decor = null, menuChef = null, steamT = 0, wantMusic = 'menu', errors = 0;
    const breaks = [];

    G.boot = () => {
        const canvas = CF.$('#game');
        try { CF.World.init(canvas); }
        catch (e) { console.error(e); CF.$('#fatal').classList.remove('hidden'); return; }
        CF.Cook.init();
        CF.Player.init(canvas);
        CF.MG.init();
        CF.UI.init();
        buildDecor();
        menuKitchen();
        // browsers only allow sound after the first click / key press
        const unlock = () => {
            const first = !CF.Audio.ctx;
            CF.Audio.init();
            if (first && CF.Audio.ctx && wantMusic) CF.Music.play(wantMusic);
        };
        addEventListener('pointerdown', unlock);
        addEventListener('keydown', unlock);
        CF.UI.showMenu();
        last = performance.now();
        requestAnimationFrame(loop);
    };
    function music(m) {
        wantMusic = m;
        if (CF.Audio.ctx) CF.Music.play(m);
    }

    // ---------- the main-menu kitchen ----------
    const half = type => { const s = CF.ITEMS[type].shape; return s.t === 'sphere' ? s.r : s.s[1] / 2; };
    // a model in a given state, coloured exactly like a real item (melted cheese, sear marks, soup...)
    function model(type, c, extra) {
        const m = CF.Models.item(type);
        const s = Object.assign({ c: [c || 0, c || 0], up: 0, salt: 0, pepper: 0, dirty: 0, q: 1 }, extra || {});
        CF.Items.refresh({ mesh: m, def: CF.ITEMS[type], s, type, contents: [] });
        return m;
    }
    function put(parent, type, x, y, z, c, ry, extra) {
        const m = model(type, c, extra);
        m.position.set(x, y, z);
        m.rotation.y = ry === undefined ? Math.random() * 6 : ry;
        parent.add(m);
        return m;
    }
    // resting on a surface like a settled body / sitting in a container the way Items.layout places it
    const rest = (parent, type, x, surf, z, c, ry, extra) => put(parent, type, x, surf + half(type), z, c, ry, extra);
    const inside = (cont, type, x, y, z, c, ry) => { const m = put(cont, type, x, 0, z, c, ry); m.position.y = y + (m.userData.lift || 0); return m; };
    function stack(dish, list) {
        let y = dish.userData.top + 0.004;
        for (const [type, c] of list) { const h = CF.ITEMS[type].h; inside(dish, type, 0, y + h / 2, 0, c); y += h; }
    }
    function buildDecor() {
        const ch = CF.World.CH, Z = CF.World.zones, grate = ch + 0.012;
        decor = new THREE.Group();
        // island: a finished burger, a salad, produce on the cutting board
        const plate = rest(decor, 'plate', 0.25, ch, 0.35, 0, 0);
        stack(plate, [['bun_bottom', 0.75], ['patty', 0.8], ['cheese_slice', 0.6], ['lettuce_leaf', 0], ['tomato_slice', 0], ['bun_top', 0.75]]);
        const bowl = rest(decor, 'bowl', -0.2, ch, 0.9, 0, 0);
        ['lettuce_leaf', 'lettuce_leaf', 'tomato_slice', 'tomato_slice', 'onion_ring'].forEach((t, k) => {
            const a = k * 2.4, r = k ? 0.03 : 0;
            inside(bowl, t, Math.cos(a) * r, bowl.userData.top + CF.ITEMS[t].h / 2 + k * 0.014, Math.sin(a) * r, 0);
        });
        rest(decor, 'tomato', -0.78, ch + 0.03, 0.5);
        for (let i = 0; i < 3; i++) rest(decor, 'tomato_slice', -0.52 + i * 0.02, ch + 0.03 + i * 0.006, 0.4 + i * 0.07);
        rest(decor, 'lettuce', 0.85, ch, 0.85);
        rest(decor, 'bun', 1.15, ch, 0.25);
        rest(decor, 'bun', 1.32, ch, 0.42);
        rest(decor, 'cheese', 1.25, ch, 0.9);
        rest(decor, 'onion', 0.6, ch, 0.98);
        rest(decor, 'salt', 0.0, ch, 1.0, 0, 0);
        rest(decor, 'pepper', 0.12, ch, 1.0, 0, 0);
        // stove: a patty sizzling, soup bubbling
        const b1 = Z.burners[1], b3 = Z.burners[3];
        const pan = rest(decor, 'pan', b1.x, grate, b1.z, 0, 0.4);
        inside(pan, 'patty', 0, pan.userData.top + CF.ITEMS.patty.h / 2 + 0.002, 0, 0.55);
        rest(decor, 'pot', b3.x, grate, b3.z, 0, 0, { water: 1, soup: 2, sc: 0.8 });
        // the pass: a pizza and a steak with fries waiting for the runner
        const pp = rest(decor, 'plate', 6.62, 1.03, -0.6, 0, 0);
        const pizza = inside(pp, 'pizza_base', 0, pp.userData.top + CF.ITEMS.pizza_base.h / 2 + 0.004, 0, 0.75, 0);
        ['tomato_slice', 'cheese_slice', 'salami_slice', 'tomato_slice', 'cheese_slice', 'salami_slice', 'salami_slice'].forEach((t, k) => {
            const a = k * 2.4, r = k === 0 ? 0 : 0.035 + (k % 3) * 0.022;
            inside(pizza, t, Math.cos(a) * r, pizza.userData.top + 0.003 + k * 0.0015, Math.sin(a) * r, 0.75);
        });
        const sp = rest(decor, 'plate', 6.62, 1.03, 0.5, 0, 0);
        inside(sp, 'steak', -0.055, sp.userData.top + CF.ITEMS.steak.h / 2 + 0.004, 0, 0.7, 0.3);
        inside(sp, 'fries', 0.06, sp.userData.top + CF.ITEMS.fries.h / 2 + 0.004, 0, 0.8, 1.2);
        // back door delivery, extinguishers, spices
        rest(decor, 'crate', Z.delivery.x, 0, Z.delivery.z, 0, 0.2);
        for (const p of Z.extSpots) rest(decor, 'ext', p.x, 0, p.z, 0, 0);
        rest(decor, 'salt', Z.spices[0].x, 1.465, Z.spices[0].z, 0, 0);
        rest(decor, 'pepper', Z.spices[1].x, 1.465, Z.spices[1].z, 0, 0);
        decor.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
        G.refreshMenuChef();
    }
    G.refreshMenuChef = () => {
        if (!decor) return;
        if (menuChef) decor.remove(menuChef);
        const col = CF.HAT_COLORS[CF.settings.color] || CF.HAT_COLORS[0];
        menuChef = CF.Models.chef(col);
        const tag = CF.Models.nameTag(CF.settings.name || 'Chef', col);
        tag.position.y = 2.42;
        menuChef.add(tag);
        if (CF.settings.role === 'waiter') {
            const bow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
            bow.position.set(0, 1.47, 0.25);
            menuChef.add(bow);
        }
        menuChef.position.set(0.9, 0, -1.9);
        decor.add(menuChef);
    };
    function showDecor(on) {
        if (!decor) return;
        if (on && !decor.parent) CF.World.scene.add(decor);
        if (!on && decor.parent) decor.parent.remove(decor);
    }
    // burners on and the oven glowing behind the menu
    function menuKitchen() {
        const st = CF.Stations.state;
        st.burners = [0, 2, 0, 1]; st.ovenOn = true; st.ovenOpen = false; st.fryerOn = false; st.open = false;
        showDecor(true);
    }
    function animDecor(dt) {
        if (!decor || !decor.parent) return;
        const ch = CF.World.CH;
        steamT -= dt;
        if (steamT <= 0) {
            steamT = 0.12;
            CF.World.fx('steam', { x: -0.45, y: ch + 0.24, z: -4.7 }, 1);
            CF.World.fx('bubble', { x: -0.45, y: ch + 0.14, z: -4.7 }, 1, { c: 0xffc0a0 });
            if (Math.random() < 0.5) CF.World.fx('steam', { x: -1.45, y: ch + 0.08, z: -4.7 }, 1);
        }
        if (menuChef) {
            const cam = CF.World.camera.position, p = menuChef.position;
            menuChef.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
            menuChef.userData.anim({ wave: true, t: G.t }, dt);
        }
    }

    // ---------- starting and leaving ----------
    function enterPlay() {
        G.mode = 'play';
        showDecor(false);
        CF.Player.reset(CF.World.spawns[Math.max(0, CF.Sync.myPid) % CF.World.spawns.length]);
        const cam = CF.World.camera;
        cam.fov = CF.settings.fov;
        cam.updateProjectionMatrix();
        CF.UI.enterGame();
        music('shift');
    }
    function beginHost(fromSave) {
        if (!physReady) { CF.Phys.init(onImpact); physReady = true; }
        else CF.Phys.reset();
        breaks.length = 0;
        CF.Orders.newGame(fromSave);
        enterPlay();
        CF.Orders.startDay();
    }
    G.startSolo = fromSave => {
        CF.Sync.startSolo();
        beginHost(fromSave);
    };
    G.hostLobby = async () => {
        CF.UI.loading(true, 'Opening your kitchen…');
        try {
            await CF.Sync.startHost();
            G.mode = 'lobby';
            CF.UI.loading(false);
            CF.UI.showLobby();
        } catch (e) {
            CF.Net.close();
            CF.Sync.reset();
            CF.UI.loading(false);
            CF.UI.toast((e && e.message) || 'Could not open a room.', 'bad');
        }
    };
    G.hostStart = fromSave => {
        if (CF.Sync.mode !== 'host') return;
        CF.Sync.beginHosted();
        beginHost(fromSave);
    };
    G.join = async code => {
        CF.UI.loading(true, 'Connecting to the kitchen…');
        try {
            await CF.Sync.startJoin(code);
            if (G.mode !== 'play') CF.UI.loading(true, 'Waiting for the host…');
        } catch (e) {
            CF.Net.close();
            CF.Sync.reset();
            CF.UI.loading(false);
            CF.UI.joinStatus((e && e.message) || 'Could not join.');
            CF.UI.toast((e && e.message) || 'Could not join.', 'bad');
        }
    };
    // guest: welcomed into the lobby
    G.showLobby = () => {
        G.mode = 'lobby';
        CF.UI.loading(false);
        CF.UI.showLobby();
    };
    // guest: the host started (or we joined a running kitchen); the full state follows
    G.enterGame = () => {
        CF.Items.clear();
        enterPlay();
        CF.UI.loading(true, 'Loading the kitchen…');
    };
    G.quit = msg => {
        CF.MG.cancel();
        CF.Sync.leave();
        G.mode = 'menu';
        CF.Player.unlock();
        CF.Items.clear();
        if (physReady) CF.Phys.reset();
        breaks.length = 0;
        CF.Orders.clear();
        CF.Cook.reset();
        CF.Stations.reset();
        CF.World.setBlackout(false);
        CF.World.grease.visible = false;
        CF.World.inspector.visible = false;
        CF.World.setFireLights([]);
        CF.Audio.stopLoops();
        menuKitchen();
        CF.UI.showMenu();
        music('menu');
        if (msg) CF.UI.toast(msg, 'info');
    };

    // ---------- physics rules (host) ----------
    function onImpact(it, other, v) {
        if (!it || it.removed) return;
        if (CF.Phys.isFloor(other) && it.def.food && !it.s.dirty) {
            it.s.dirty = 1;
            CF.Items.refresh(it);
            CF.Items.touch(it);
        }
        if (it.def.fragile && v > 6.5 && !it.container) {
            const holder = it.heldBy !== null ? it.heldBy : it.thrownBy;
            if (!(holder !== undefined && holder !== null && CF.Sync.skill(holder, 'steady'))) {
                if (!breaks.includes(it)) breaks.push(it);
                return;
            }
        }
        if (v > 1.6) {
            const now = performance.now();
            if (now - (it._snd || 0) < 150) return;
            it._snd = now;
            const hard = it.def.dish || it.def.tool || it.type === 'pan' || it.type === 'pot' || it.type === 'basket';
            CF.Sync.onFx('impact', it.mesh.position, hard ? 'clink' : 'thud');
        }
    }
    // smashing happens after the physics step (removing bodies mid-step is not safe)
    function processBreaks() {
        while (breaks.length) {
            const it = breaks.pop();
            if (it.removed || CF.Items.get(it.id) !== it) continue;
            const pos = CF.Items.worldPos(it).clone();
            for (const id of it.contents.slice()) {
                const f = CF.Items.get(id);
                if (!f) continue;
                if (f.def.liquid) { CF.Items.remove(id); continue; }
                CF.Items.detach(f, { x: CF.rand(-1, 1), y: 1.5, z: CF.rand(-1, 1) });
            }
            CF.Items.remove(it.id);
            CF.Sync.onFx('break', pos, 'break');
            if (CF.Orders.state.stats) CF.Orders.state.stats.broken++;
            CF.Sync.broadcastToast(`💥 A ${it.def.name.toLowerCase()} smashed!`, 'bad');
        }
    }

    // ---------- main loop ----------
    function loop(now) {
        requestAnimationFrame(loop);
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        G.t += dt;
        try { frame(dt); }
        catch (e) {
            errors++;
            if (errors <= 5) console.error(e);
            if (errors === 1) CF.UI.toast('Something went wrong. Details are in the console (F12).', 'bad');
        }
    }
    function frame(dt) {
        const W = CF.World, S = CF.Sync;
        if (G.mode !== 'play') {
            W.menuCam(G.t);
            CF.Stations.visuals(dt);
            CF.Cook.visuals(dt, W.camera.position);
            animDecor(dt);
            W.updateFx(dt);
            W.updateDoors([], dt);
            W.render();
            return;
        }
        // solo: the pause screen (and settings, how to play...) freezes the kitchen
        const frozen = S.mode === 'solo' && CF.UI.paused();
        if (S.isHost) {
            if (!frozen) {
                CF.Phys.updatePlayers(Object.values(S.players), dt);
                CF.Phys.step(dt);
                processBreaks();
                CF.Items.update(dt);
                contAcc += dt;
                if (contAcc >= 0.05) { contAcc = 0; CF.Items.updateContainers(); }
                CF.Cook.update(dt);
                CF.Stations.update(dt);
                CF.Orders.update(dt);
                S.hostTick(dt);
            }
        } else {
            S.clientTick(dt);
            CF.Items.update(dt);
        }
        CF.Player.update(dt);
        CF.MG.update(dt);
        CF.Stations.visuals(dt);
        CF.Cook.visuals(dt, W.camera.position);
        CF.Orders.visuals(dt);
        S.visuals(dt);
        W.updateFx(dt);
        W.updateDoors(Object.values(S.players).map(p => p.pos), dt);
        CF.UI.update(dt);
        W.render();
    }

    return G;
})();

// Start once the page fonts are ready (canvas labels use them), but never wait more than 1.5 s
(() => {
    const wait = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
    wait.then(() => CF.Game.boot(), () => CF.Game.boot());
})();
