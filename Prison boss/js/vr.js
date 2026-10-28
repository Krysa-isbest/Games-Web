'use strict';
// WebXR (VR headset) support for Meta Quest Browser and PC VR browsers. Only used when Settings → VR is ON.
//   P.pos / P.yaw stay the "truth"; the camera rig is placed every frame so your head ends up there.
//   Controls:  L stick walk (flick down = crouch) · R stick snap turn · GRIP grabs what your hand is near
//              (it snaps into your palm), let go to drop/throw it · TRIGGER uses what your hand touches, or what
//              the right laser points at; on a menu: click, or hold + move the hand to scroll
//              A = use · B = secondary · X = back / wrist tablet (pause) · Y = wrist info on/off
PB.VR = (() => {
    const V = { supported: false, active: false, fake: false, rigYaw: 0, lastYawOut: null, hands: {}, turnLatch: false, lastHL: null, infoOn: true };
    let W, rig, wrist, wristCtx, wristTex, overlay, overlayTex, hudT = 0, backup = null;
    const ctrls = [];
    const UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
    const TRIGGER = 0, GRIP = 1, STICK = 3, A = 4, B = 5; // xr-standard gamepad (X/Y on the left = 4/5)
    const REACH = 0.2; // generous: grabbing should never be fiddly
    V.crouch = false; V.crouchY = 0;

    V.isOn = () => V.active || V.fake;

    V.init = async () => {
        W = PB.World; rig = W.rig;
        const xr = W.renderer.xr;
        for (let i = 0; i < 2; i++) {
            const h = { ctrl: xr.getController(i), grip: xr.getControllerGrip(i), hand: null, source: null, prev: [], hist: [] };
            rig.add(h.ctrl, h.grip);
            ctrls.push(h);
        }
        buildOverlay();
        if (navigator.xr && navigator.xr.isSessionSupported) {
            try { V.supported = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { V.supported = false; }
        }
        PB.UI.updateVRButtons();
    };

    // Map controllers to hands every frame straight from the session (robust to sleep/reconnects)
    function syncControllers() {
        if (V.fake) return;
        const session = W.renderer.xr.getSession && W.renderer.xr.getSession();
        if (!session) return;
        const seen = {};
        ctrls.forEach((h, i) => {
            const src = session.inputSources[i];
            if (!src || !src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) { h.source = null; return; }
            h.source = src; h.hand = src.handedness;
            V.hands[h.hand] = h; seen[h.hand] = true;
            buildHand(h);
        });
        ['left', 'right'].forEach(s => { if (!seen[s]) delete V.hands[s]; });
    }

    // ---------- Hands, laser, wrist HUD ----------
    const handStyle = () => PB.Settings.v.vrHands === 'legacy' ? 'legacy' : 'modern';
    // Modern hands: rounded palm, two-jointed fingers and a thumb that curl with grip and trigger
    function modernHand(h, g) {
        const W = PB.World, skin = 0xe0a27a, side = h.hand === 'left' ? 1 : -1;
        W.cyl(0.045, 0.05, 0.12, 0xf07a22, 0, 0.005, 0.11, g, 14).rotation.x = Math.PI / 2;
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16), W.mat(0xffffff));
        cuff.position.set(0, 0.005, 0.05); g.add(cuff);
        W.sph(0.045, skin, 0, 0, -0.01, g, 14).scale.set(1, 0.5, 1.15);
        const seg = (parent, len, r, z) => { const c = W.cyl(r, r * 0.92, len, skin, 0, 0, z - len / 2, parent, 8); c.rotation.x = Math.PI / 2; return c; };
        h.fingers = [1, 1.1, 1.0, 0.8].map((k, i) => {
            const k1 = new THREE.Group(); k1.position.set(side * (0.027 - i * 0.018), 0.006, -0.045); g.add(k1);
            seg(k1, 0.03 * k, 0.0095, 0);
            const k2 = new THREE.Group(); k2.position.z = -0.03 * k; k1.add(k2);
            seg(k2, 0.025 * k, 0.0088, 0);
            W.sph(0.0088, skin, 0, 0, -0.025 * k, k2, 8);
            return { k1, k2 };
        });
        const t1 = new THREE.Group(); t1.position.set(side * 0.04, -0.006, 0.0); t1.rotation.y = -side * 0.7; g.add(t1);
        seg(t1, 0.028, 0.011, 0);
        const t2 = new THREE.Group(); t2.position.z = -0.028; t1.add(t2);
        seg(t2, 0.022, 0.01, 0);
        W.sph(0.01, skin, 0, 0, -0.022, t2, 8);
        h.thumb = { k1: t1, k2: t2, side };
    }
    function legacyHand(h, g) {
        const skin = 0xe0a27a, side = h.hand === 'left' ? 1 : -1;
        PB.World.cyl(0.04, 0.045, 0.14, 0xf07a22, 0, 0, 0.1, g, 12).rotation.x = Math.PI / 2;
        PB.World.box(0.075, 0.03, 0.09, skin, 0, 0, -0.01, g);
        for (let i = 0; i < 4; i++) PB.World.box(0.014, 0.018, 0.05, skin, -0.027 + i * 0.018, 0.002, -0.07, g);
        PB.World.box(0.016, 0.018, 0.04, skin, side * 0.045, 0, -0.02, g).rotation.y = -side * 0.6;
        h.fingers = null; h.thumb = null;
    }
    // curl the modern fingers with how far grip / trigger are pressed
    function animateHand(h) {
        if (!h || !h.fingers) return;
        const gp = h.source && h.source.gamepad, b = i => gp && gp.buttons[i] ? (gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0)) : 0;
        const grip = b(GRIP), trig = b(TRIGGER);
        h.fingers.forEach((f, i) => {
            const c = i === 0 ? trig : grip;
            f.k1.rotation.x = PB.damp(f.k1.rotation.x, -c * 1.35, 25, 1 / 60);
            f.k2.rotation.x = PB.damp(f.k2.rotation.x, -c * 1.25, 25, 1 / 60);
        });
        h.thumb.k1.rotation.x = -grip * 0.5;
        h.thumb.k2.rotation.x = -grip * 0.9;
    }

    function buildHand(h) {
        const style = handStyle();
        if (h.model && h.modelHand === h.hand && h.modelStyle === style) return;
        if (h.model) h.grip.remove(h.model);
        const g = h.model = new THREE.Group();
        h.modelHand = h.hand; h.modelStyle = style;
        if (style === 'modern') modernHand(h, g); else legacyHand(h, g);
        g.traverse(o => { o.castShadow = false; });
        h.grip.add(g);
        h.grip.userData.holder = true;
        if (!h.laser) {
            const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
            h.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7 }));
            h.ctrl.add(h.laser);
            h.glow = new THREE.BoxHelper(new THREE.Object3D(), 0xffd23f);
            h.glow.visible = false;
        }
        h.laser.visible = h.hand === 'right';
        if (h.hand === 'left' && !wrist) buildWrist(h);
        if (h.hand === 'left' && wrist && wrist.parent !== h.grip) h.grip.add(wrist);
    }

    function buildWrist(h) {
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 320;
        wristCtx = cv.getContext('2d');
        wristTex = new THREE.CanvasTexture(cv);
        wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.1125), new THREE.MeshBasicMaterial({ map: wristTex, transparent: true }));
        wrist.position.set(0.02, 0.045, 0.1);
        wrist.rotation.set(-1.1, 0, 0.25);
        h.grip.add(wrist);
    }

    function drawWrist() {
        if (!wristCtx || !PB.state) return;
        wrist.visible = V.infoOn && !PB.VRUI.visible; // a menu on your hand takes its place
        const g = wristCtx, s = PB.state, $ = id => document.getElementById(id);
        g.clearRect(0, 0, 512, 320);
        g.fillStyle = 'rgba(255,244,214,.95)'; g.strokeStyle = '#221a2e'; g.lineWidth = 8;
        g.beginPath(); g.rect(4, 4, 504, 312); g.fill(); g.stroke();
        g.fillStyle = '#221a2e'; g.textBaseline = 'top';
        g.font = 'bold 34px Nunito, sans-serif';
        g.fillText(`${s.phase === 'day' ? '☀️' : '🌙'} Day ${s.day} · ${PB.Game.clock()}`, 22, 18);
        g.fillText(`$${Math.floor(s.money)}`, 380, 18);
        const r = PB.rankOf(s.rep);
        g.font = 'bold 26px Nunito, sans-serif';
        g.fillText(`⭐ ${PB.RANKS[r].name} (${Math.floor(s.rep)})   🔥 Heat ${Math.round(s.heat)}`, 22, 64);
        const strip = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        const P = PB.Player;
        const held = [P.held2 && '🤚 ' + PB.Items.label(P.held2), P.held && '✋ ' + PB.Items.label(P.held)].filter(Boolean).join('   ');
        let y = 104;
        g.font = 'bold 24px Nunito, sans-serif';
        [held, strip($('prompt'))].filter(Boolean).forEach(t => { wrap(g, t, 0, 0, 468).forEach(l => { g.fillText(l, 22, y); y += 28; }); });
        const warn = $('warning');
        if (warn && +warn.style.opacity > 0) {
            g.fillStyle = '#ff4d4d'; g.fillRect(14, 250, 484, 56);
            g.fillStyle = '#fff'; g.font = 'bold 30px Nunito, sans-serif'; g.fillText('👣 ' + strip($('warning-text')), 26, 262);
        } else {
            const toast = $('toasts').lastElementChild;
            if (toast) { g.fillStyle = '#6a5f78'; g.font = 'bold 22px Nunito, sans-serif'; wrap(g, strip(toast), 0, 0, 468).slice(0, 2).forEach((l, i) => g.fillText(l, 22, 254 + i * 26)); }
        }
        wristTex.needsUpdate = true;
    }
    function wrap(g, text, x, y, maxW) {
        const words = text.split(' '), lines = [];
        let line = '';
        words.forEach(w => { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
        if (line) lines.push(line);
        return lines;
    }
    V.wrap = wrap;

    // The minigame meters (#mini-canvas) shown on a sheet floating in front of your eyes
    function buildOverlay() {
        const cv = document.getElementById('mini-canvas');
        overlayTex = new THREE.CanvasTexture(cv);
        overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthTest: false, depthWrite: false }));
        overlay.renderOrder = 999;
        overlay.position.set(0, 0, -1);
        overlay.visible = false;
        W.camera.add(overlay);
    }

    // ---------- Session ----------
    V.enter = async () => {
        if (!V.supported) { PB.UI.toast('No VR headset found. Open the game in your headset\'s browser (e.g. Meta Quest Browser).', 'bad', 5); return; }
        try {
            const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
            W.renderer.xr.enabled = true;
            W.renderer.xr.setReferenceSpaceType('local-floor');
            await W.renderer.xr.setSession(session);
            V.session = session;
            V.active = true;
            V.lastYawOut = null; V.lastHL = null;
            session.addEventListener('end', onEnd);
            PB.Player.unlock();
            document.body.classList.add('vr');
            $hidePause();
            V.reparentHeld();
            PB.Audio.init();
            PB.UI.updateVRButtons();
        } catch (e) {
            PB.UI.toast('Could not start VR: ' + (e.message || e), 'bad', 5);
        }
    };
    function $hidePause() { const p = document.getElementById('pause'); if (p && PB.Player.enabled) p.classList.add('hidden'); }
    V.exit = () => { if (V.session) V.session.end(); };
    function onEnd() {
        V.active = false; V.session = null;
        rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
        W.camera.position.set(PB.Player.pos.x, 1.6, PB.Player.pos.z);
        overlay.visible = false;
        document.body.classList.remove('vr');
        // the desktop has only one hand: put the left-hand item down
        if (PB.Player.held2) { const it = PB.Player.held2; PB.Player.clearHeld('left'); PB.Items.placeFree(it, [PB.Player.cell + 'floor']); }
        V.reparentHeld();
        PB.UI.updateVRButtons();
    }

    // Held items sit in your hands in VR, in front of the camera otherwise
    V.holdParent = (hand = 'right') => {
        if (V.isOn() && V.hands[hand]) return V.hands[hand].grip;
        return W.camera;
    };
    V.reparentHeld = () => {
        const P = PB.Player;
        if (P.held) V.holdParent('right').add(P.held.mesh);
        if (P.held2) V.holdParent('left').add(P.held2.mesh);
    };

    // ---------- Input helpers ----------
    const aimHand = () => V.hands.right || V.hands.left || null;
    V.aimRay = raycaster => {
        const h = aimHand();
        if (!h) { raycaster.setFromCamera({ x: 0, y: 0 }, W.camera); return raycaster; }
        h.ctrl.updateMatrixWorld();
        raycaster.ray.origin.setFromMatrixPosition(h.ctrl.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).transformDirection(h.ctrl.matrixWorld);
        return raycaster;
    };
    function btn(h, i) { const gp = h && h.source && h.source.gamepad; return !!(gp && gp.buttons[i] && gp.buttons[i].pressed); }
    function axis(h, i) { const gp = h && h.source && h.source.gamepad; return gp && gp.axes.length > i ? gp.axes[i] : 0; }
    function edge(h, i) {
        if (!h) return 0;
        const now = btn(h, i), was = !!h.prev[i];
        h.prev[i] = now;
        return now && !was ? 1 : !now && was ? -1 : 0;
    }
    function gripPos(h) { h.grip.updateMatrixWorld(); return new THREE.Vector3().setFromMatrixPosition(h.grip.matrixWorld); }
    // the middle of your palm (where held things sit)
    function palmPos(h) { h.grip.updateMatrixWorld(); return h.grip.localToWorld(new THREE.Vector3(0, -0.035, -0.065)); }
    V.pressed = (side, i) => btn(V.hands[side], i);

    // The red CRAFT button really goes down under your fingertip and fires once it's pressed in
    let craftLatch = false;
    function craftButton() {
        const cell = PB.World.cells[PB.Player.cell];
        if (!cell || PB.World.area !== 'cell' || !cell.craftCap) return;
        const rest = cell.craftBtn.localToWorld(new THREE.Vector3(0, 0.09, 0)); // top of the cap when not pressed
        let press = 0;
        ['left', 'right'].forEach(s => {
            const h = V.hands[s];
            if (!h) return;
            const tip = V.tipPos(h);
            if (Math.hypot(tip.x - rest.x, tip.z - rest.z) < 0.05 && tip.y < rest.y + 0.01 && tip.y > rest.y - 0.08) press = Math.max(press, rest.y - tip.y);
        });
        press = PB.clamp(press, 0, 0.022);
        cell.craftCap.position.y = 0.075 - press;
        if (press > 0.016 && !craftLatch) { craftLatch = true; PB.Audio.play('click'); if (!PB.UI.blocking()) cell.craftBtn.userData.interact.use(); }
        if (press < 0.005) craftLatch = false;
    }
    // index fingertip (a bit further out on the modern hands)
    V.tipPos = h => { h.grip.updateMatrixWorld(); return h.grip.localToWorld(new THREE.Vector3(h.hand === 'left' ? 0.027 : -0.027, 0.004, h.fingers ? -0.11 : -0.095)); };
    V.handWorld = side => V.hands[side] ? gripPos(V.hands[side]) : null;
    const heldIn = side => side === 'left' ? PB.Player.held2 : PB.Player.held;

    // Hand speed from the last few frames (for throwing)
    function trackVelocity(h, dt) {
        h.hist.push({ p: gripPos(h), dt });
        if (h.hist.length > 6) h.hist.shift();
        if (h.hist.length < 2) return new THREE.Vector3();
        const a = h.hist[0], b = h.hist[h.hist.length - 1];
        const t = h.hist.slice(1).reduce((s, x) => s + x.dt, 0);
        return b.p.clone().sub(a.p).divideScalar(Math.max(t, 0.001));
    }

    // What this hand could grab right now: the closest item within reach
    function grabTarget(h) {
        const W = PB.World, p = gripPos(h), P = PB.Player;
        let best = null, bestD = REACH;
        for (const it of PB.Items.list) {
            if (it === P.held || it === P.held2 || it.heldBy) continue;
            const ok = it.flying || (it.surface && W.surfaces[it.surface].accessible() && W.reachable(it.surface));
            if (!ok) continue;
            const c = it.mesh.getWorldPosition(tmp).add(new THREE.Vector3(0, 0.04, 0));
            const d = c.distanceTo(p);
            if (d < bestD) { bestD = d; best = it; }
        }
        return best;
    }
    // A drawer handle within reach of this hand (in your own cell)
    function drawerTarget(h) {
        const p = gripPos(h), cell = PB.World.cells[PB.Player.cell];
        if (!cell || PB.World.area !== 'cell') return null;
        for (const d of cell.drawers) {
            const hp = d.group.localToWorld(new THREE.Vector3(0.215, 0.12, -0.04));
            if (hp.distanceTo(p) < 0.11) return d;
        }
        return null;
    }
    // A poster in your cell whose lower half your hand is on (you grab it and swing it open or shut)
    function posterTarget(h) {
        const W = PB.World, cell = W.cells[PB.Player.cell];
        if (!cell || W.area !== 'cell') return null;
        const p = gripPos(h);
        for (const n of [1, 2]) {
            const sd = cell.sides[n];
            if (!sd.real || !sd.pivot.visible) continue;
            sd.pivot.updateMatrixWorld();
            const c = sd.pivot.localToWorld(new THREE.Vector3(0, -0.45, 0)); // lower part of the poster
            if (c.distanceTo(p) < 0.25) return { cell, sd };
        }
        return null;
    }
    // swing angle from where your hand is (in the cell's own coordinates, so mirrored cells work too)
    function dragPoster(h) {
        const { cell, sd } = h.poster;
        const l = cell.group.worldToLocal(gripPos(h)), pv = sd.pivot.position;
        const out = -sd.sx * (l.x - pv.x), down = pv.y - l.y;
        sd.poster.t = PB.clamp(Math.atan2(Math.max(0, out), Math.max(0.05, down)) / 1.45, 0, 1);
    }
    function releasePoster(h) {
        const { cell, sd } = h.poster;
        const want = sd.poster.t > 0.4;
        sd.drag = false; h.poster = null;
        if (want === sd.poster.lifted) return;
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'use', id: cell.prefix + (sd.n === 2 ? 'poster2' : 'poster'), alt: true });
        sd.poster.lifted = want;
        PB.Audio.play('paper');
    }

    // ---------- Travel bubble ("Go to lunch?") in the bottom-left of your view ----------
    let travel = null, travelLabel = '', travelLatch = false;
    function buildTravel() {
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
        const t = new THREE.CanvasTexture(cv);
        travel = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false }));
        travel.renderOrder = 997;
        travel.position.set(-0.17, -0.15, -0.5); travel.rotation.set(0.25, 0.3, 0);
        travel.userData.cv = cv;
        W.camera.add(travel);
    }
    function drawTravel(label) {
        if (label === travelLabel) return;
        travelLabel = label;
        const cv = travel.userData.cv, g = cv.getContext('2d');
        g.clearRect(0, 0, 512, 128);
        g.fillStyle = '#ffd23f'; g.strokeStyle = '#221a2e'; g.lineWidth = 10;
        g.beginPath(); g.roundRect ? g.roundRect(6, 6, 500, 116, 40) : g.rect(6, 6, 500, 116); g.fill(); g.stroke();
        g.fillStyle = '#221a2e'; g.font = 'bold 40px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(label, 256, 66);
        travel.material.map.needsUpdate = true;
    }
    function updateTravel(ray, trig, show) {
        if (!travel) buildTravel();
        const o = show ? PB.Area.offer() : null;
        travel.visible = !!o;
        if (!o) return false;
        drawTravel(o.label);
        let hit = ray.intersectObject(travel, false).length > 0;
        // or poke it with a fingertip
        let poked = false;
        ['left', 'right'].forEach(s => {
            const h = V.hands[s];
            if (!h) return;
            const l = travel.worldToLocal(V.tipPos(h));
            if (Math.abs(l.x) < 0.1 && Math.abs(l.y) < 0.025 && Math.abs(l.z) < 0.03) poked = true;
        });
        if (poked && !travelLatch) { travelLatch = true; o.go(); return true; }
        if (!poked) travelLatch = false;
        if (hit && trig === 1) { o.go(); return true; }
        return false;
    }

    // The interactable your fingertip is touching
    function touchTarget(h) {
        const tip = V.tipPos(h), P = PB.Player;
        for (const o of PB.World.areaInteractables()) {
            const def = o.userData.interact;
            if (!def || !def.prompt()) continue;
            if (PB.World.area === 'cell') { const oc = PB.World.cellOfObject(o); if (oc !== null && oc !== P.cell) continue; }
            const box = new THREE.Box3().setFromObject(o).expandByScalar(0.04);
            if (box.containsPoint(tip)) return def;
        }
        return null;
    }

    // ---------- Per frame ----------
    V.update = dt => {
        if (!V.isOn()) { if (overlay) overlay.visible = false; return; }
        syncControllers();
        ['left', 'right'].forEach(s => { const h = V.hands[s]; if (h) { buildHand(h); animateHand(h); } }); // picks up Modern/Legacy changes
        const P = PB.Player, R = aimHand(), L = V.hands.left;
        const cam = W.camera;

        // head pose inside the rig
        const hl = cam.position;
        eul.setFromQuaternion(cam.quaternion, 'YXZ');
        const headYaw = eul.y, headPitch = eul.x;

        // something else teleported us (crawl, lunch, minigame): face the requested direction
        if (V.lastYawOut == null || Math.abs(P.yaw - V.lastYawOut) > 1e-3) V.rigYaw = P.yaw - headYaw;

        const inGame = !!PB.state && P.enabled;
        const menuOpen = PB.UI.blocking();
        // walking around your real room moves you in the game too (with collisions)
        if (V.lastHL && !PB.Mini.active) {
            tmp.set(hl.x - V.lastHL.x, 0, hl.z - V.lastHL.z).applyAxisAngle(UP, V.rigYaw);
            P.tryMove(tmp.x, tmp.z);
        }
        V.lastHL = hl.clone();

        // panels get the laser and your fingertips first
        const ray = V.aimRay(new THREE.Raycaster());
        const onPanel = PB.VRUI.hitTest(ray);
        ['left', 'right'].forEach(s => { const h = V.hands[s]; if (h) PB.VRUI.poke(V.tipPos(h), s); });
        if (R && R.laser) { R.laser.visible = true; R.laser.scale.z = onPanel ? onPanel.distance : (P.hover ? P.hover.dist : 2.5); }

        const e = {};
        ['left', 'right'].forEach(s => { const h = V.hands[s]; e[s] = h ? { trig: edge(h, TRIGGER), grip: edge(h, GRIP), a: edge(h, A), b: edge(h, B), stick: edge(h, STICK) } : {}; });

        // menus: point and pull the trigger to click; keep holding it and move your hand up/down to scroll
        if (onPanel && e.right.trig === 1 && R) V.menuDrag = { start: onPanel, y0: gripPos(R).y, last: gripPos(R).y, scrolled: false };
        const onTravel = !V.menuDrag && updateTravel(ray, e.right.trig, inGame && !menuOpen && !PB.Mini.active && !PB.Escape.active);
        if (V.menuDrag) {
            if (R && btn(R, TRIGGER)) {
                const y = gripPos(R).y;
                if (Math.abs(y - V.menuDrag.y0) > 0.025) V.menuDrag.scrolled = true;
                if (V.menuDrag.scrolled) PB.VRUI.scrollBy((y - V.menuDrag.last) * 3200);
                V.menuDrag.last = y;
            } else {
                if (!V.menuDrag.scrolled) PB.VRUI.click(V.menuDrag.start);
                V.menuDrag = null;
            }
        } else if (onTravel) {
            // the laser is on the travel bubble: nothing else gets the trigger
        } else if (PB.Mini.active) {
            // minigames with your real hands: grip grabs the props, the trigger is the "click"
            ['left', 'right'].forEach(s => {
                const h = V.hands[s];
                if (!h) return;
                h.grip.updateMatrixWorld();
                PB.Mini.vrHands[s] = { pos: palmPos(h), quat: h.grip.getWorldQuaternion(new THREE.Quaternion()) };
                if (e[s].grip === 1) PB.Mini.vrGrab(s);
                if (e[s].grip === -1) PB.Mini.vrRelease(s);
            });
            feedMinigame();
            if (e.right.trig) PB.Mini.vrPress('left', e.right.trig === 1);
            PB.Mini.tilt = btn(L, TRIGGER);
            if (e.left.a === 1) PB.Mini.abort();
        } else if (inGame && !menuOpen) {
            ['left', 'right'].forEach(s => handInput(V.hands[s], s, e[s], dt));
            craftButton();
            if (e.right.a === 1) P.use();
            if (e.right.b === 1) { if (PB.World.area === 'workshop') PB.Workshop.toggle(); else P.alt(); }
            if (e.left.b === 1) V.infoOn = !V.infoOn;
        } else {
            ['left', 'right'].forEach(s => { const h = V.hands[s]; if (h && h.glow) h.glow.visible = false; });
        }
        // X: back out of a menu, or open the wrist tablet (pause)
        if (e.left.a === 1 && !PB.Mini.active && inGame) {
            if (PB.UI.isPanelOpen()) PB.UI.closePanel();
            else if (!document.getElementById('pause').classList.contains('hidden')) PB.UI.resume();
            else PB.UI.openPause();
        }
        PB.VRUI.scroll(-axis(R, 3) * dt * 900, onPanel);

        // left stick: walk relative to where you look (forward and sideways); flick it DOWN to crouch / stand up.
        // right stick: snap turn 30°
        const free = inGame && !menuOpen && !PB.Mini.active;
        if (free) {
            const sx = axis(L, 2), sy = axis(L, 3);
            if (sy > 0.8 && !V.crouchLatch) { V.crouchLatch = true; V.crouch = !V.crouch; PB.Audio.play('click', { vol: 0.4 }); }
            if (sy < 0.5) V.crouchLatch = false;
            const fy = Math.min(0, sy); // pulling back is crouch, so no walking backwards
            if (Math.hypot(sx, fy) > 0.15) {
                const yaw = V.rigYaw + headYaw, sp = 2.0 * dt * (V.crouch ? 0.5 : 1);
                const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
                P.tryMove((fx * -fy + rx * sx) * sp, (fz * -fy + rz * sx) * sp);
            }
        }
        if (!inGame) V.crouch = false;
        V.crouchY = PB.damp(V.crouchY, V.crouch && !PB.Mini.active ? -0.55 : 0, 10, dt);
        P.crouch = (V.crouch && !PB.Mini.active) || hl.y < 1.15; // really crouching counts too
        const tx = axis(R, 2);
        if (!onPanel && !PB.Mini.active && Math.abs(tx) > 0.7 && !V.turnLatch) { V.rigYaw -= Math.sign(tx) * Math.PI / 6; V.turnLatch = true; }
        if (Math.abs(tx) < 0.3) V.turnLatch = false;

        // place the rig so the headset ends up exactly at P.pos. In a minigame the rig is placed once and then
        // stays put, so you can lean over the desk and reach things instead of the room sliding away from you.
        if (!(PB.Mini.active && V.rigFrozen)) {
            rig.rotation.set(0, V.rigYaw, 0);
            tmp.set(hl.x, 0, hl.z).applyAxisAngle(UP, V.rigYaw);
            rig.position.set(P.pos.x - tmp.x, V.crouchY, P.pos.z - tmp.z);
            if (PB.Mini.active && --V.freezeIn <= 0) V.rigFrozen = true;
        }
        P.yaw = V.rigYaw + headYaw;
        P.pitch = headPitch;
        V.lastYawOut = P.yaw;

        // minigame meters in front of your eyes
        overlay.visible = !!PB.Mini.active;
        if (overlay.visible) {
            const cv = overlayTex.image, h = 2 * Math.tan(THREE.MathUtils.degToRad(36));
            overlay.scale.set(h * cv.width / Math.max(1, cv.height), h, 1);
            overlayTex.needsUpdate = true;
        }
        hudT -= dt;
        if (hudT <= 0) { hudT = 0.25; drawWrist(); }
    };

    // One hand: grab / drop / throw, drawer pulling, touching things
    function handInput(h, side, ev, dt) {
        if (!h) return;
        const vel = trackVelocity(h, dt), P = PB.Player, held = heldIn(side);
        if (PB.World.area !== 'cell') { if (h.glow) h.glow.visible = false; if (ev.trig === 1) { const d = touchTarget(h); if (d) P.useInter(d); else if (side === 'right' && P.hover && P.hover.inter) P.useInter(P.hover.inter); } return; }

        // swinging a poster open / shut with your hand
        if (h.poster) {
            dragPoster(h);
            if (ev.grip === -1) releasePoster(h);
            return;
        }
        // pulling a drawer by its handle
        if (h.drag) {
            const d = h.drag, z = gripPos(h).z;
            d.t = PB.clamp(h.dragT0 + (h.dragZ0 - z) / 0.4, 0, 1);
            d.group.position.z = d.z0 - d.t * 0.4;
            if (ev.grip === -1) {
                const want = d.t > 0.5;
                d.drag = false; h.drag = null;
                if (want !== d.open) {
                    if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'use', id: d.id });
                    d.open = want;
                    PB.Audio.play('drawer', { vol: 0.6 });
                }
            }
            return;
        }

        // push an open drawer shut with your hand
        if (!held && !h.drag && vel.z > 0.5) {
            const d = drawerTarget(h);
            if (d && d.open) {
                if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'use', id: d.id });
                d.open = false;
                PB.Audio.play('drawer', { vol: 0.6 });
            }
        }

        // highlight what the hand would grab
        const target = held ? null : grabTarget(h);
        if (h.glow) {
            if (target) { if (!h.glow.parent) W.activeScene.add(h.glow); h.glow.setFromObject(target.mesh); h.glow.visible = true; }
            else h.glow.visible = false;
        }

        if (ev.grip === 1 && !held) {
            if (target) P.pickup(target, side);
            else {
                const d = drawerTarget(h);
                if (d) { h.drag = d; d.drag = true; h.dragZ0 = gripPos(h).z; h.dragT0 = d.t; }
                else {
                    // grab the poster and swing it open or shut with your hand
                    const pt = posterTarget(h);
                    if (pt) { h.poster = pt; pt.sd.drag = true; PB.Audio.play('paper', { vol: 0.5 }); }
                }
            }
        } else if (ev.grip === -1 && held) {
            // let go: it falls (or flies, if you swung your hand) and lands on the grid
            const pos = held.mesh.getWorldPosition(new THREE.Vector3());
            P.throwHeld(side, pos, vel.clone().multiplyScalar(vel.length() > 0.6 ? 1.1 : 0.5));
        }

        if (ev.trig === 1) {
            const d = touchTarget(h);
            if (d) P.useInter(d);
            else if (side === 'right' && P.hover && P.hover.inter) P.useInter(P.hover.inter);
        }
    }

    // In a minigame your right hand is the "mouse": where your hand is on screen (circle it to grind,
    // move it away from you to roll, up and down to mash...), the trigger is the button
    function feedMinigame() {
        const h = V.hands.right;
        if (!h) return;
        const p = gripPos(h).project(W.camera);
        PB.Mini.setPointer((p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight);
    }

    // ---------- Minigames: stand in front of the desk ----------
    V.enterMinigame = (pos, look) => {
        const P = PB.Player;
        if (!backup) backup = { pos: P.pos.clone(), yaw: P.yaw };
        P.pos.set(pos.x, P.pos.y, pos.z);
        P.yaw = Math.atan2(-(look.x - pos.x), -(look.z - pos.z));
        V.rigFrozen = false; V.freezeIn = 2; // place the rig there, then lock it (your body stays put)
    };
    V.leaveMinigame = () => {
        V.rigFrozen = false;
        if (!backup) return;
        PB.Player.pos.copy(backup.pos); PB.Player.yaw = backup.yaw;
        backup = null;
    };

    // ---------- Debug: lets the test suite run the VR code paths without a headset ----------
    V.fakeOn = () => {
        V.fake = true;
        ['left', 'right'].forEach((side, i) => {
            const h = ctrls[i];
            h.hand = side; h.prev = []; h.hist = [];
            h.source = { handedness: side, gamepad: { buttons: Array.from({ length: 6 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] } };
            // real XR controllers get their matrix from the headset; fake ones are moved by position
            h.ctrl.matrixAutoUpdate = h.grip.matrixAutoUpdate = true;
            h.ctrl.visible = h.grip.visible = true;
            h.ctrl.position.set(side === 'left' ? -0.2 : 0.2, 1.3, -0.3);
            h.grip.position.copy(h.ctrl.position);
            V.hands[side] = h;
            buildHand(h);
        });
        V.lastYawOut = null; V.lastHL = null;
        V.reparentHeld();
        return 'fake VR on';
    };

    return V;
})();
