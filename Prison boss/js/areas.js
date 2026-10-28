'use strict';
// Shared helpers for the places you can walk out to (yard, kitchen, the escape ending):
// switching scenes with a fade, guards with view cones, the timing meter, input (mouse / VR trigger) and the area HUD.
PB.Area = (() => {
    const A = { mouse: { down: false, dx: 0 }, pressedNow: false, pressedPrev: false };
    const $ = id => document.getElementById(id);

    A.fade = fn => {
        const f = $('fade');
        f.classList.add('on');
        setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 150); }, 650);
    };

    // Move the player (and camera rig) into an area scene
    A.go = (mod, area, scene, x, z, yaw) => {
        const W = PB.World, P = PB.Player;
        mod.cell = P.cell;
        W.area = area;
        W.activeScene = scene;
        scene.add(W.rig);
        P.pos.set(x, 1.6, z); P.yaw = yaw; P.pitch = -0.05;
    };
    // ...and back to the cell they came from
    A.back = mod => {
        const W = PB.World, P = PB.Player;
        W.area = 'cell';
        W.activeScene = W.scene;
        W.scene.add(W.rig);
        P.cell = mod.cell || '';
        P.pos.copy(W.cells[P.cell].toWorld(0.2, 1.6, -1.2)); P.yaw = Math.PI; P.pitch = -0.1;
        P.speedMult = 1;
    };
    A.dispose = scene => {
        if (!scene) return;
        PB.Coop.rescueMate(scene);
        scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); if (m.isMeshBasicMaterial) m.dispose(); });
        });
    };

    A.inter = (mod, obj, def) => { obj.userData.interact = def; mod.interactables.push(obj); return obj; };
    A.col = (mod, x0, x1, z0, z1) => mod.colliders.push({ x0, x1, z0, z1 });
    A.shadows = sc => {
        const on = PB.Settings.v.gfx !== 'low';
        sc.traverse(o => { if (o.isMesh) { o.castShadow = on && !(o.material && o.material.transparent); o.receiveShadow = on; } });
    };
    A.sign = (text, w, h, bg = '#ffd23f') => {
        const t = PB.World.canvasTex(512, 128, g => {
            g.fillStyle = bg; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#221a2e'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
            g.fillStyle = '#221a2e'; g.font = 'bold 58px Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
        });
        return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshToonMaterial({ map: t, gradientMap: PB.World.grad() }));
    };

    // ---------- Guards with a view cone ----------
    A.guard = (sc, x, z, view, fov, speed = 0.9) => {
        const ch = PB.NPC.makeChar({ skin: 0xf2c29b, shirt: 0x3b5998, pants: 0x23304f, hair: 0x2b1d14, hat: 'cap', badge: true, belt: true, angry: true });
        ch.root.position.set(x, 0, z); sc.add(ch.root);
        const cone = new THREE.Mesh(new THREE.CircleGeometry(view, 24, Math.PI / 2 - fov, fov * 2),
            new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
        cone.rotation.x = Math.PI / 2; cone.position.y = 0.03; ch.root.add(cone);
        return { ch, cone, view, fov, w: PB.NPC.walker(ch, speed), route: [], k: 0, wait: 0 };
    };
    // walk a route of [x, z, faceAngle|null, waitSeconds]
    A.patrol = (g, dt) => {
        PB.NPC.updWalker(g.w, dt);
        if (!g.w.target) {
            g.wait -= dt;
            if (g.wait <= 0 && g.route.length) {
                const [x, z, face, wait] = g.route[g.k];
                g.k = (g.k + 1) % g.route.length;
                g.w.target = { x, z };
                g.w.onArrive = () => { g.wait = wait != null ? wait : 1; g.w.face = face; };
            }
        }
        g.ch.head.rotation.y = Math.sin(performance.now() / 800 + g.k) * 0.4;
        g.cone.rotation.z = -g.ch.head.rotation.y;
    };
    // is this guard looking at a point (default: the player)? Crouching shortens their sight.
    A.sees = (g, p = PB.Player.pos) => {
        const r = g.ch.root, dx = p.x - r.position.x, dz = p.z - r.position.z;
        if (Math.hypot(dx, dz) > g.view * (PB.Player.crouch ? 0.65 : 1)) return false;
        let diff = Math.atan2(dx, dz) - (r.rotation.y + g.ch.head.rotation.y);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return Math.abs(diff) < g.fov;
    };
    A.say = (key, ch, text, dur = 2.5, cls = '') => {
        const v = new THREE.Vector3();
        PB.UI.bubble(key + Math.random(), text, () => v.set(ch.root.position.x, 2.15, ch.root.position.z), dur, cls);
    };

    // ---------- Input: mouse button or VR trigger, with "just pressed" ----------
    A.init = () => {
        const cv = PB.World.renderer.domElement;
        cv.addEventListener('mousedown', e => { if (e.button === 0) A.mouse.down = true; });
        addEventListener('mouseup', e => { if (e.button === 0) A.mouse.down = false; });
        addEventListener('mousemove', e => { A.mouse.dx += e.movementX; A.mouse.dy = (A.mouse.dy || 0) + e.movementY; });
        addEventListener('keydown', e => { if (e.code === 'Space') A.space = true; });
        const tr = document.getElementById('travel');
        if (tr) tr.addEventListener('click', () => A.travel());
        addEventListener('keyup', e => { if (e.code === 'Space') A.space = false; });
    };
    // does an area want the mouse button for itself right now (charging a throw, lifting, cooking...)?
    A.busy = () => {
        const W = PB.World;
        if (W.area === 'yard') return PB.Yard.busy();
        if (W.area === 'kitchen') return PB.Kitchen.busy();
        if (W.area === 'escape') return PB.Escape.busy();
        return false;
    };
    A.held = () => A.mouse.down || A.space || (PB.VR.isOn() && PB.VR.pressed('right', 0));
    // call once per frame from the active area
    A.poll = () => {
        A.pressedPrev = A.pressedNow;
        A.pressedNow = A.held();
        A.justPressed = A.pressedNow && !A.pressedPrev;
        A.justReleased = !A.pressedNow && A.pressedPrev;
        A.moveX = A.mouse.dx; A.moveY = A.mouse.dy || 0;
        A.mouse.dx = 0; A.mouse.dy = 0;
    };

    // ---------- Timing meter ----------
    // a marker sweeps across the bar; act while it's inside the green zone
    A.meter = {
        show(label) { $('meter').classList.remove('hidden'); $('meter-label').innerHTML = label; },
        set(mark, z0, z1, label) {
            $('meter-mark').style.left = (PB.clamp(mark, 0, 1) * 100) + '%';
            $('meter-zone').style.left = (z0 * 100) + '%';
            $('meter-zone').style.width = ((z1 - z0) * 100) + '%';
            if (label != null) $('meter-label').innerHTML = label;
        },
        hide() { $('meter').classList.add('hidden'); }
    };

    // ---------- HUD chips ----------
    A.hud = html => { const h = $('area-hud'); h.classList.toggle('hidden', !html); if (html) h.innerHTML = html; };
    A.clock = t => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

    // ---------- Travel bubble: "Go to lunch?" / "Back to your cell?" ----------
    // One tap (VR: poke it or point + trigger · PC: click it or press Enter) takes you there.
    A.offer = () => {
        const s = PB.state, W = PB.World;
        if (!s || !PB.Player.enabled || PB.Mini.active || (PB.Escape && PB.Escape.active)) return null;
        if (W.area === 'cell') {
            if (s.kitchenOpen && !(PB.Kitchen.wentDay === s.day && PB.Kitchen.left)) return { label: '🍳 Go to kitchen duty?', go: () => PB.Kitchen.enter() };
            if (s.lunchOpen && PB.Lunch.wentDay !== s.day) return { label: '🍽️ Go to lunch?', go: () => PB.Lunch.enter() };
            if (s.yardOpen) return { label: '🏀 Go out to the yard?', go: () => PB.Yard.enter() };
            if (s.workshopOpen && PB.Workshop.allowed() && PB.Workshop.wentDay !== s.day) return { label: '🪚 Go to the workshop?', go: () => PB.Workshop.enter() };
            return null;
        }
        const back = { canteen: () => PB.Lunch.exit(false), workshop: () => PB.Workshop.exit(false), yard: () => PB.Yard.exit(false), kitchen: () => PB.Kitchen.exit(false) }[W.area];
        return back ? { label: '🚪 Back to your cell?', go: back } : null;
    };
    let travelTxt = null;
    A.updateTravel = () => {
        const el = document.getElementById('travel');
        if (!el) return;
        const o = PB.VR.isOn() ? null : A.offer(); // VR has its own bubble in the corner of your view
        el.classList.toggle('hidden', !o);
        if (o && o.label !== travelTxt) { travelTxt = o.label; el.innerHTML = `${o.label} <kbd>${PB.Keys.label(PB.Keys.get('travel'))}</kbd>`; }
        A.travelGo = o ? o.go : null;
    };
    A.travel = () => { const o = A.offer(); if (o) o.go(); };

    // ---------- Pockets (smuggling things back to the cell) ----------
    A.unpack = (mod, types) => {
        if (!types.length) return;
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'pockets', cell: mod.cell, types });
        else PB.Lunch.unpack(mod.cell, types);
    };
    A.addHeat = n => {
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'heat', n });
        else PB.state.heat = Math.max(0, PB.state.heat + n);
    };
    A.pay = n => {
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'areaPay', n });
        else PB.Game.addMoney(n);
    };
    A.rep = n => {
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'areaRep', n });
        else PB.Game.addRep(n);
    };
    A.progress = (kind, n = 1) => {
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'progress', kind, n });
        else PB.Game.progress(kind, n);
    };
    A.buff = (id, days) => {
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'buff', id, days });
        else PB.Game.addBuff(id, days);
    };

    return A;
})();
