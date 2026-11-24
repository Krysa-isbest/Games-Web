'use strict';
// The local chef: pointer-lock first-person movement, looking at things (raycast), holding / dropping /
// throwing, E and F actions (incl. hold-E to flatten dough and hold-F to spray). Writes its own entry in
// CF.Sync.players every frame; the host steers held items from that.
CF.Player = (() => {
    const P = {
        held: null, role: 'chef', active: false, locked: false, yaw: 0, pitch: 0, holdYaw: 0, holdDist: 0.95,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: true, target: null, prompt: {}, charge: -1, holdE: null, spraying: false
    };
    const EYE = 1.65, R = 0.3, HEIGHT = 1.8, STEP = 0.32, GRAV = 18, JUMP = 5.4, WALK = 3.3, RUN = 5.4, REACH = 2.3;
    const keys = {};
    const ray = new THREE.Raycaster(), center = new THREE.Vector2(0, 0), dirV = new THREE.Vector3(), hpV = new THREE.Vector3();
    let cam = null, canvas = null, spot = null, bob = 0, smoothY = 0, fireCd = 0, t = 0;

    const inGame = () => CF.Game.mode === 'play';
    const has = id => CF.Profile.has(id) && CF.SKILL[id] && CF.SKILL[id].role === P.role;

    P.init = cv => {
        canvas = cv;
        cam = CF.World.camera;
        cam.rotation.order = 'YXZ';
        P.role = CF.settings.role === 'waiter' ? 'waiter' : 'chef';
        // flashlight for blackouts (always in the scene so lights never get recompiled)
        spot = new THREE.SpotLight(0xfff1d0, 0, 14, 0.55, 0.45, 1.4);
        spot.position.set(0.15, -0.1, 0);
        cam.add(spot);
        spot.target.position.set(0, -0.15, -1);
        cam.add(spot.target);
        addEventListener('keydown', e => key(e, true));
        addEventListener('keyup', e => key(e, false));
        addEventListener('blur', clearKeys);
        document.addEventListener('mousemove', look);
        document.addEventListener('mousedown', down);
        document.addEventListener('mouseup', up);
        addEventListener('wheel', wheel, { passive: true });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('contextmenu', e => { if (inGame()) e.preventDefault(); });
        document.addEventListener('pointerlockchange', lockChange);
        document.addEventListener('pointerlockerror', () => { if (inGame()) CF.UI.toast('Click again to take control.', 'info'); });
    };

    P.reset = spawn => {
        P.pos.set(spawn.x, 0, spawn.z);
        P.vel.set(0, 0, 0);
        P.yaw = 0; P.pitch = -0.12; P.holdYaw = 0; P.holdDist = 0.95;
        P.held = null; P.target = null; P.prompt = {}; P.charge = -1; P.holdE = null; P.spraying = false; P.onGround = true;
        P.role = CF.settings.role === 'waiter' ? 'waiter' : 'chef';
        smoothY = 0;
        placeCamera(0);
    };
    P.lock = () => {
        if (!canvas || document.pointerLockElement === canvas) return;
        try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    };
    P.unlock = () => { if (document.pointerLockElement) document.exitPointerLock(); };

    // ---------- input ----------
    function key(e, down) {
        if (CF.UI.typing) return;
        const c = e.code;
        if (!down) {
            keys[c] = false;
            if (c === 'KeyE') P.holdE = null;
            if (c === 'KeyF') stopSpray();
            return;
        }
        if (inGame() && (c === 'Tab' || c === 'Space')) e.preventDefault();
        keys[c] = true;
        if (e.repeat || !inGame()) return;
        if (c === 'Tab') { CF.UI.toggleBook(); return; }
        if (c === 'Enter') { e.preventDefault(); CF.UI.openChat(); return; }
        if (!P.active || CF.MG.busy()) return;
        if (c === 'KeyE') pressE();
        else if (c === 'KeyF') pressF();
        else if (c === 'KeyR' && P.held) { P.holdYaw += Math.PI / 4; CF.Audio.play('click'); }
    }
    function clearKeys() {
        for (const k in keys) keys[k] = false;
        P.holdE = null; P.charge = -1;
        stopSpray();
    }
    function look(e) {
        if (!P.locked || !inGame() || !P.active || CF.MG.active) return;
        const s = 0.0022 * CF.settings.sens;
        const mx = CF.clamp(e.movementX, -250, 250), my = CF.clamp(e.movementY, -250, 250);
        P.yaw -= mx * s;
        P.pitch = CF.clamp(P.pitch - my * s * (CF.settings.invertY ? -1 : 1), -1.48, 1.48);
    }
    function down(e) {
        if (!inGame() || !P.locked || !P.active || CF.MG.busy()) return;
        if (e.button === 0) click();
        else if (e.button === 2 && P.held) P.charge = 0;
    }
    function up(e) {
        if (e.button !== 2 || P.charge < 0) return;
        const c = P.charge;
        P.charge = -1;
        if (P.held && P.active && !CF.MG.busy()) throwHeld(c);
    }
    function wheel(e) {
        if (!inGame() || !P.locked || CF.MG.active) return;
        P.holdDist = CF.clamp(P.holdDist - Math.sign(e.deltaY) * 0.08, 0.6, 1.4);
    }
    function lockChange() {
        P.locked = document.pointerLockElement === canvas;
        if (!P.locked) { clearKeys(); if (CF.MG.active) CF.MG.cancel(); }
        if (inGame()) { if (P.locked) CF.UI.onLock(); else CF.UI.onUnlock(); }
    }

    // ---------- actions ----------
    function pressE() {
        const e = P.prompt.e;
        if (!e || e.none) return;
        if (e.hold === 'flatten') { P.holdE = { id: e.id, t: 0 }; return; }
        if (e.run) e.run();
    }
    function pressF() {
        const f = P.prompt.f;
        if (!f || f.none) return;
        if (f.hold === 'spray') {
            if (!P.spraying) { P.spraying = true; CF.Sync.act({ t: 'spray', on: true }); }
            return;
        }
        if (f.run) f.run();
    }
    function stopSpray() {
        if (!P.spraying) return;
        P.spraying = false;
        CF.Sync.act({ t: 'spray', on: false });
    }
    function click() {
        if (P.held) { drop(); return; }
        const tg = P.target;
        if (!tg) return;
        if (tg.kind === 'item') {
            const it = CF.Items.get(tg.id);
            if (it) { CF.Sync.act({ t: 'grab', id: it.id }); CF.Audio.play('grab'); }
        } else if (tg.kind === 'st' && (tg.sid === 'plates' || tg.sid === 'bowls')) {
            CF.Sync.act({ t: 'take', k: tg.sid });
        }
    }
    function drop() {
        if (!P.held) return;
        CF.Sync.act({ t: 'drop', id: P.held, v: [CF.r3(P.vel.x * 0.5), 0, CF.r3(P.vel.z * 0.5)] });
        CF.Audio.play('drop');
    }
    P.drop = drop;
    // charge 0..0.7 s -> 3..11 m/s
    function throwHeld(c) {
        const k = CF.clamp(c / 0.7, 0, 1), sp = 3 + 8 * k;
        camDir(dirV);
        CF.Sync.act({ t: 'throw', id: P.held, v: [CF.r3(dirV.x * sp + P.vel.x * 0.5), CF.r3(dirV.y * sp + 1 + k), CF.r3(dirV.z * sp + P.vel.z * 0.5)] });
    }

    function camDir(out) { return out.set(0, 0, -1).applyQuaternion(cam.quaternion); }
    P.dir = out => camDir(out || new THREE.Vector3());
    // where held things float: in front of the eyes, a little below the crosshair
    P.holdPoint = out => {
        out = out || hpV;
        camDir(dirV);
        out.copy(cam.position).addScaledVector(dirV, P.holdDist);
        out.y -= 0.1;
        return out;
    };

    // ---------- per frame ----------
    P.update = dt => {
        if (!inGame()) return;
        t += dt;
        P.locked = document.pointerLockElement === canvas;
        P.active = P.locked && !CF.UI.blocking();
        const myPid = CF.Sync.myPid, me = CF.Sync.players[myPid];
        const h = CF.Items.heldBy(myPid);
        P.held = h ? h.id : null;
        if (!h) { P.charge = -1; P.holdYaw = 0; }
        if (P.spraying && (!h || h.type !== 'ext' || !P.active)) stopSpray();
        if (P.charge >= 0) P.charge = Math.min(0.7, P.charge + dt);

        move(dt);
        placeCamera(dt);
        cam.updateMatrixWorld();
        P.target = P.active ? pick() : null;
        P.prompt = P.active && !CF.MG.active ? (CF.Stations.promptFor(P.target, h) || {}) : {};

        // hold E to flatten dough
        if (P.holdE) {
            const e = P.prompt.e;
            if (!P.active || !keys.KeyE || !e || e.hold !== 'flatten' || e.id !== P.holdE.id) P.holdE = null;
            else {
                P.holdE.t += dt;
                if (P.holdE.t >= 1.2) { CF.Sync.act({ t: 'flatten', id: P.holdE.id }); P.holdE = null; }
            }
        }
        // standing in flames makes you let go (unless you are a Firefighter)
        fireCd -= dt;
        if (h && fireCd <= 0 && CF.Cook.fireAt(P.pos) > 0.4 && !has('fireproof')) {
            fireCd = 1.5;
            drop();
            CF.UI.toast('🔥 Too hot! You dropped what you were holding.', 'bad');
            CF.Audio.play('ouch');
        }
        const ev = CF.Orders.state.event;
        spot.intensity = CF.damp(spot.intensity, ev && ev.k === 'blackout' ? 2.2 : 0, 6, dt);

        if (me) {
            me.pos.x = P.pos.x; me.pos.y = P.pos.y; me.pos.z = P.pos.z;
            me.yaw = P.yaw; me.pitch = P.pitch;
            P.holdPoint(hpV);
            me.hold = [hpV.x, hpV.y, hpV.z];
            me.hy = P.holdYaw;
            me.spray = P.spraying;
            me.moving = Math.hypot(P.vel.x, P.vel.z) > 0.6;
        }
        CF.Audio.listener = cam.position;
    };

    // ---------- movement + collision (circle vs the kitchen's boxes) ----------
    function greased() {
        const ev = CF.Orders.state.event;
        if (!ev || ev.k !== 'grease') return false;
        const z = CF.World.zones.grease;
        return Math.hypot(P.pos.x - z.x, P.pos.z - z.z) < z.r;
    }
    function move(dt) {
        const can = P.active && !CF.MG.active;
        let ix = 0, iz = 0;
        if (can) {
            if (keys.KeyW || keys.ArrowUp) iz -= 1;
            if (keys.KeyS || keys.ArrowDown) iz += 1;
            if (keys.KeyA || keys.ArrowLeft) ix -= 1;
            if (keys.KeyD || keys.ArrowRight) ix += 1;
        }
        const len = Math.hypot(ix, iz);
        if (len > 0) { ix /= len; iz /= len; }
        const sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
        const wx = ix * cs + iz * sn, wz = -ix * sn + iz * cs;
        let speed = can && (keys.ShiftLeft || keys.ShiftRight) ? RUN : WALK;
        if (has('sprinter')) speed *= 1.2;
        const hi = P.held ? CF.Items.get(P.held) : null;
        if (hi && hi.def.mass >= 3) speed *= 0.8;
        const slip = greased();
        const acc = P.onGround ? (slip ? 1.4 : 12) : 2.5;
        P.vel.x = CF.damp(P.vel.x, wx * speed, acc, dt);
        P.vel.z = CF.damp(P.vel.z, wz * speed, acc, dt);
        if (slip && P.onGround) { P.vel.x += Math.sin(t * 2.3) * 3 * dt; P.vel.z += Math.cos(t * 1.7) * 3 * dt; }
        if (can && keys.Space && P.onGround) { P.vel.y = JUMP; P.onGround = false; }
        P.vel.y -= GRAV * dt;
        const stepH = P.onGround ? STEP : 0.02;
        // horizontal in two sub-steps so fast movement never tunnels through thin walls
        for (let i = 0; i < 2; i++) {
            P.pos.x += P.vel.x * dt / 2;
            P.pos.z += P.vel.z * dt / 2;
            collide(stepH);
        }
        // vertical: land on the floor or on anything low enough to step onto
        const prevY = P.pos.y;
        P.pos.y += P.vel.y * dt;
        let ground = 0;
        for (const c of CF.World.colliders) {
            if (c.floor || !CF.World.solid(c)) continue;
            const top = c.max[1];
            if (top > prevY + stepH || top <= ground) continue;
            if (overlap(c, R * 0.7)) ground = top;
        }
        if (P.pos.y <= ground) {
            P.pos.y = ground;
            if (P.vel.y < 0) P.vel.y = 0;
            P.onGround = true;
        } else P.onGround = false;
        if (P.pos.y < -5) { const sp = CF.World.spawns[0]; P.pos.set(sp.x, 0, sp.z); P.vel.set(0, 0, 0); }
    }
    function collide(stepH) {
        for (const c of CF.World.colliders) {
            if (c.floor || !CF.World.solid(c)) continue;
            if (c.max[1] <= P.pos.y + stepH || c.min[1] >= P.pos.y + HEIGHT) continue;
            pushOut(c);
        }
    }
    function overlap(c, r) {
        const cx = CF.clamp(P.pos.x, c.min[0], c.max[0]), cz = CF.clamp(P.pos.z, c.min[2], c.max[2]);
        const dx = P.pos.x - cx, dz = P.pos.z - cz;
        return dx * dx + dz * dz < r * r;
    }
    function pushOut(c) {
        const cx = CF.clamp(P.pos.x, c.min[0], c.max[0]), cz = CF.clamp(P.pos.z, c.min[2], c.max[2]);
        const dx = P.pos.x - cx, dz = P.pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) return;
        if (d2 > 1e-8) {
            const d = Math.sqrt(d2), k = (R - d) / d;
            P.pos.x += dx * k; P.pos.z += dz * k;
            const nx = dx / d, nz = dz / d, vn = P.vel.x * nx + P.vel.z * nz;
            if (vn < 0) { P.vel.x -= vn * nx; P.vel.z -= vn * nz; }
        } else {
            // centre inside the box: leave through the nearest side
            const l = P.pos.x - c.min[0], r = c.max[0] - P.pos.x, b = P.pos.z - c.min[2], f = c.max[2] - P.pos.z;
            const m = Math.min(l, r, b, f);
            if (m === l) P.pos.x = c.min[0] - R;
            else if (m === r) P.pos.x = c.max[0] + R;
            else if (m === b) P.pos.z = c.min[2] - R;
            else P.pos.z = c.max[2] + R;
        }
    }
    function placeCamera(dt) {
        const hs = Math.hypot(P.vel.x, P.vel.z);
        if (P.onGround) bob += hs * dt * 2.4;
        const by = P.onGround ? Math.sin(bob * 2) * 0.03 * CF.clamp(hs / 4, 0, 1) : 0;
        smoothY = dt > 0 && P.onGround ? CF.damp(smoothY, P.pos.y, 16, dt) : P.pos.y;
        if (Math.abs(smoothY - P.pos.y) > 0.5) smoothY = P.pos.y;
        cam.position.set(P.pos.x, smoothY + EYE + by, P.pos.z);
        cam.rotation.set(P.pitch, P.yaw, 0);
    }

    // ---------- what is under the crosshair ----------
    function rootOf(it) {
        let r = it, n = 0;
        while (r.container && n++ < 8) { const c = CF.Items.get(r.container); if (!c) break; r = c; }
        return r;
    }
    function pick() {
        ray.setFromCamera(center, cam);
        ray.camera = cam;
        ray.near = 0.05; ray.far = REACH;
        const hits = ray.intersectObjects(CF.World.pickables, true);
        for (const h of hits) {
            const pk = h.object.userData.pick;
            if (!pk) continue;
            if (pk.kind === 'item') {
                const it = CF.Items.get(pk.id);
                if (!it) continue;
                // skip what we carry (and what sits on it), and what someone else carries
                if (rootOf(it).heldBy !== null) continue;
            }
            return pk;
        }
        return null;
    }

    return P;
})();
