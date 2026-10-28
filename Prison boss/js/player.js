'use strict';
// First-person controls, picking up items, grid placement with a ghost preview, stacking, throwing.
// P.held = item in your (right) hand. In VR there is a second hand: P.held2 = left hand.
PB.Player = (() => {
    const P = {
        pos: new THREE.Vector3(0, 1.6, 0.6), yaw: Math.PI, pitch: -0.25, cell: '',
        held: null, held2: null, origin: null, rot: 0, keys: {}, locked: false, fallback: false, look: false,
        enabled: false, hover: null, place: null, bob: 0, expectUnlock: false
    };
    const C = PB.C, EYE = 1.6, RADIUS = 0.22;
    const ray = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0);
    const ghostOk = new THREE.MeshBasicMaterial({ color: 0x4dff88, transparent: true, opacity: 0.5, depthWrite: false });
    const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.5, depthWrite: false });
    let ghost = null, ghostKey = '', lastWheel = 0;
    const NO_FLUSH = ['jug', 'bottle', 'sugar', 'pen', 'stamp', 'grinder'];
    const K = a => P.keys[PB.Keys.get(a)];

    P.init = () => {
        const W = PB.World, cv = W.renderer.domElement;
        W.camera.rotation.order = 'YXZ';
        ray.far = 2.3;

        cv.addEventListener('click', () => {
            if (P.enabled && !P.locked && !P.fallback && !PB.UI.blocking() && !PB.Mini.active && !PB.VR.active) P.lock(true);
        });
        document.addEventListener('pointerlockchange', () => {
            P.locked = document.pointerLockElement === cv;
            PB.UI.setLocked(P.locked || P.fallback);
            // entering a VR headset also releases the mouse; that must not pause the game
            if (!P.locked && P.enabled && !P.expectUnlock && !PB.UI.blocking() && !PB.Mini.active && !PB.VR.active) PB.UI.openPause();
            P.expectUnlock = false;
        });
        document.addEventListener('pointerlockerror', () => { if (P.userLock) P.useFallback(); });

        addEventListener('mousemove', e => {
            if (!P.enabled || PB.UI.blocking() || PB.Mini.active || PB.VR.active || PB.Workshop.sawing) return; // sawing uses the mouse
            if (P.locked || (P.fallback && P.look)) {
                const s = 0.0022 * PB.Settings.v.sens;
                P.yaw -= e.movementX * s;
                P.pitch = PB.clamp(P.pitch - e.movementY * s, -1.45, 1.45);
            }
        });
        cv.addEventListener('mousedown', e => {
            PB.Audio.init();
            if (!P.enabled || PB.UI.blocking() || PB.Mini.active || PB.VR.active) return;
            if (e.button === 2) { P.look = true; return; }
            if (e.button === 0 && (P.locked || P.fallback)) P.primary();
        });
        addEventListener('mouseup', e => { if (e.button === 2) P.look = false; });
        cv.addEventListener('contextmenu', e => e.preventDefault());
        addEventListener('wheel', () => {
            if (!P.enabled || !P.held || PB.UI.blocking() || PB.Mini.active) return;
            const now = performance.now();
            if (now - lastWheel > 160) { lastWheel = now; P.rotate(); }
        });
        addEventListener('keydown', e => {
            if (!P.enabled || PB.Mini.active || PB.UI.blocking()) return;
            if (e.ctrlKey && /^Key[ADSRQEFTGHM]$/.test(e.code)) e.preventDefault(); // Ctrl+D bookmarks etc. (Ctrl+W can't be stopped)
            P.keys[e.code] = true;
            if (e.code === 'Escape') { if (!P.locked) PB.UI.openPause(); return; }
            switch (PB.Keys.action(e.code)) {
                case 'crouch':
                    if (e.repeat) break;
                    P.crouch = PB.Settings.v.crouchMode === 'hold' ? true : !P.crouch;
                    break;
                case 'use': P.use(); break;
                case 'alt': P.alt(); break;
                case 'rotate': P.rotate(); break;
                case 'putback': P.returnHeld(); break;
                case 'throw': P.throwHeld(); break;
                case 'help': PB.UI.openHelp(); break;
                case 'music': PB.Music.toggle(); break;
                case 'ping': PB.Coop.ping(); break;
                case 'travel': PB.Area.travel(); break;
            }
        });
        addEventListener('keyup', e => {
            P.keys[e.code] = false;
            if (PB.Keys.action(e.code) === 'crouch' && PB.Settings.v.crouchMode === 'hold') P.crouch = false;
        });
        addEventListener('blur', () => { P.keys = {}; P.look = false; if (PB.Settings.v.crouchMode === 'hold') P.crouch = false; });
    };

    P.useFallback = () => {
        if (P.fallback) return;
        P.fallback = true;
        PB.UI.setLocked(true);
        PB.UI.toast('Mouse lock is blocked here. Hold RIGHT mouse button to look around.', 'bad', 6);
    };

    // Only a failed lock from a real click on the game means the browser blocks it (e.g. inside an iframe).
    P.lock = fromClick => {
        if (P.fallback || PB.VR.active) return;
        const cv = PB.World.renderer.domElement;
        P.userLock = !!fromClick;
        try {
            const r = cv.requestPointerLock();
            if (r && r.catch) r.catch(() => { if (P.userLock) P.useFallback(); });
        } catch (e) { if (P.userLock) P.useFallback(); }
    };
    P.unlock = () => {
        if (document.pointerLockElement) { P.expectUnlock = true; document.exitPointerLock(); }
    };

    P.reset = () => {
        P.cell = '';
        P.pos.set(0, EYE, 0.6); P.yaw = Math.PI; P.pitch = -0.25;
        P.clearHeld('right'); P.clearHeld('left');
    };
    P.spawnIn = cell => {
        P.cell = cell;
        const p = PB.World.cells[cell].toWorld(0, EYE, 0.6);
        P.pos.copy(p); P.yaw = Math.PI; P.pitch = -0.25;
    };

    // ---------- Movement ----------
    function free(x, z) {
        for (const c of PB.World.areaColliders()) {
            if (x > c.x0 - RADIUS && x < c.x1 + RADIUS && z > c.z0 - RADIUS && z < c.z1 + RADIUS) return false;
        }
        return true;
    }

    // Move with collisions (used by VR walking too)
    P.tryMove = (dx, dz) => {
        const b = PB.World.areaBounds();
        const nx = PB.clamp(P.pos.x + dx, b.x0, b.x1), nz = PB.clamp(P.pos.z + dz, b.z0, b.z1);
        // if you somehow ended up inside furniture, let you walk out instead of freezing you
        const stuck = !free(P.pos.x, P.pos.z);
        if (stuck || free(nx, P.pos.z)) P.pos.x = nx;
        if (stuck || free(P.pos.x, nz)) P.pos.z = nz;
    };

    // Pause menu "Unstuck": back to the middle of your own cell
    P.unstuck = () => {
        if (PB.Mini.active) PB.Mini.abort();
        if (PB.Lunch.active) { PB.Lunch.exit(true); return; }
        if (PB.Yard.active) { PB.Yard.exit(true); return; }
        if (PB.Kitchen.active) { PB.Kitchen.exit(true); return; }
        if (PB.Escape && PB.Escape.active) { PB.Escape.respawn(); return; }
        P.spawnIn(PB.Coop.homeCell());
        PB.UI.toast('🆘 Teleported back to your cell.');
    };

    P.update = dt => {
        const W = PB.World, cam = W.camera, vr = PB.VR.isOn();
        if (PB.Mini.active) { P.hover = null; P.place = null; updateGhost(); return; } // minigame owns the camera
        if (PB.Escape.cine || PB.Escape.phase === 'end') { P.hover = null; P.place = null; return; } // a cutscene (or its last shot) owns the camera
        const blocked = PB.UI.blocking();
        let mx = 0, mz = 0;
        if (!blocked) {
            if (K('forward') || P.keys.ArrowUp) mz -= 1;
            if (K('back') || P.keys.ArrowDown) mz += 1;
            if (K('left') || P.keys.ArrowLeft) mx -= 1;
            if (K('right') || P.keys.ArrowRight) mx += 1;
        }
        const len = Math.hypot(mx, mz);
        // (in VR, PB.VR sets P.crouch: left stick flicked down, or really crouching)
        if (len > 0) {
            const sp = (W.area === 'cell' ? 2.1 : 2.8) * (P.crouch ? 0.5 : 1) * (P.speedMult || 1) * dt / len, s = Math.sin(P.yaw), c = Math.cos(P.yaw);
            P.tryMove((-s * -mz + c * mx) * sp, (-c * -mz - s * mx) * sp);
            P.bob += dt * (P.crouch ? 6 : 9);
        }
        P.eye = PB.damp(P.eye || EYE, P.crouch ? EYE * 0.6 : EYE, 12, dt);
        if (!vr) { // in VR the headset moves the camera
            cam.position.set(P.pos.x, P.eye + (P.eyeOffset || 0) + (len > 0 ? Math.sin(P.bob) * 0.025 : 0), P.pos.z);
            cam.rotation.set(P.pitch, P.yaw, 0);
        }

        // desktop: the held item floats in front of the camera. VR: it stays exactly where you grabbed it.
        if (P.held && !vr) {
            const m = P.held.mesh;
            if (m.parent !== cam) cam.add(m);
            m.position.set(0.22, -0.21 + Math.sin(P.bob * 0.5) * 0.004, -0.42);
            m.rotation.set(0.35, P.rot ? -Math.PI / 2 : 0, 0);
        }
        if (!blocked) updateRay();
        updateGhost();
        updatePrompt();
    };

    // ---------- Targeting ----------
    function updateRay() {
        const W = PB.World, inCell = W.area === 'cell', vr = PB.VR.isOn();
        if (vr) { PB.VR.aimRay(ray); ray.far = 3; } // in VR you point with your right hand
        else { ray.setFromCamera(center, W.camera); ray.far = 2.3; }
        P.hover = null; P.place = null;
        const targets = [];
        // VR picks items up with the grip (hand next to the item), not with the laser
        if (inCell && !vr) for (const it of PB.Items.list) {
            if (it.surface && W.surfaces[it.surface].accessible() && W.reachable(it.surface)) targets.push(it.mesh);
            else if (it.flying && it.type === 'ball') targets.push(it.mesh); // catch the ball out of the air
        }
        const hits = ray.intersectObjects(targets.concat(W.areaInteractables()), true);
        for (const h of hits) {
            // no reaching through the wall into the other cell
            if (inCell) { const oc = W.cellOfObject(h.object); if (oc !== null && oc !== P.cell) continue; }
            let o = h.object, item = null, inter = null;
            while (o) {
                if (o.userData.item) { item = o.userData.item; break; }
                if (o.userData.interact) { inter = o.userData.interact; break; }
                o = o.parent;
            }
            if (item) { P.hover = { item, dist: h.distance }; break; }
            if (inter) {
                const p = inter.prompt();
                if (p) { P.hover = { inter, prompt: p, dist: h.distance }; break; }
            }
        }
        if (P.held && inCell && !vr) {
            // dropping onto a matching stack merges it
            if (P.hover && P.hover.item && PB.Items.canMerge(P.held, P.hover.item)) {
                P.place = { merge: P.hover.item, ok: true };
                return;
            }
            const ph = ray.intersectObjects(W.accessiblePlanes(), false)[0];
            if (ph) {
                const sid = ph.object.userData.surface, s = W.surfaces[sid];
                const local = s.group.worldToLocal(ph.point.clone());
                const f = PB.Items.fp(P.held, P.rot);
                const gx = PB.clamp(Math.round(local.x / C - f.w / 2), 0, Math.max(0, s.cols - f.w));
                const gy = PB.clamp(Math.round(local.z / C - f.h / 2), 0, Math.max(0, s.rows - f.h));
                P.place = { sid, gx, gy, ok: PB.Items.canPlace(P.held, sid, gx, gy, P.rot) };
            }
        }
    }

    function updateGhost() {
        const W = PB.World, p = P.held && P.place && !P.place.merge ? P.place : null;
        for (const s of Object.values(W.surfaces)) s.lines.visible = !!(p && p.sid === s.id);
        if (!p) { if (ghost) ghost.visible = false; return; }
        const it = P.held, key = `${it.uid}:${p.ok}:${it.count}:${it.charges}`;
        if (!ghost || ghostKey !== key) {
            if (ghost && ghost.parent) ghost.parent.remove(ghost);
            // clone() JSON-copies userData, and userData.item is circular, so strip it for the copy
            const ud = it.mesh.userData;
            it.mesh.userData = {};
            ghost = it.mesh.clone(true);
            it.mesh.userData = ud;
            const mat = p.ok ? ghostOk : ghostBad;
            ghost.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
            const d = PB.ITEMS[it.type];
            const quad = new THREE.Mesh(new THREE.PlaneGeometry(d.w * C - 0.01, d.h * C - 0.01), mat);
            quad.rotation.x = -Math.PI / 2; quad.position.y = 0.004;
            ghost.add(quad);
            ghostKey = key;
        }
        const f = PB.Items.fp(it, P.rot), s = W.surfaces[p.sid];
        if (ghost.parent !== s.group) s.group.add(ghost);
        ghost.visible = true;
        ghost.position.set((p.gx + f.w / 2) * C, 0.002, (p.gy + f.h / 2) * C);
        ghost.rotation.set(0, P.rot ? -Math.PI / 2 : 0, 0);
        ghost.scale.setScalar(1);
    }

    function updatePrompt() {
        let t = '';
        const h = P.hover;
        if (PB.UI.blocking() || PB.Mini.active) t = '';
        else if (P.held && !PB.VR.isOn()) {
            if (h && h.inter) t = h.prompt + '\n';
            if (P.place && P.place.merge) {
                const m = P.place.merge;
                t += `${PB.key('LMB')} Add to stack (${m.count + P.held.count}/${PB.ITEMS[m.type].stack})`;
            } else if (P.place) t += P.place.ok ? `${PB.key('LMB')} Place on ${PB.World.surfaces[P.place.sid].name.toLowerCase()}` : `Doesn't fit here`;
            t += `\n${PB.key('R')} Rotate  ${PB.key('T')} Throw  ${PB.key('Q')} Put back`;
        } else if (h && h.item) {
            t = `${PB.key('LMB')} Pick up ${PB.Items.label(h.item)}`;
            if (PB.ITEMS[h.item.type].stack && h.item.count > 1) t += `   ${PB.key('F')} Take one`;
        } else if (h && h.inter) t = h.prompt;
        PB.UI.prompt(t, !!h);
    }

    // ---------- Actions ----------
    // In co-op the guest asks the host to change shared things (drawers, lamp, bed...)
    P.useInter = (inter, alt) => {
        if (PB.Coop.isGuest() && inter.net) { PB.Coop.send({ t: 'act', a: 'use', id: inter.id, alt: !!alt }); return; }
        if (alt) { if (inter.alt) inter.alt(); }
        else inter.use();
    };
    P.primary = () => {
        if (PB.Area.busy()) return; // yard / kitchen / escape use the mouse button for their own actions right now
        if (P.held) return P.placeHeld();
        const h = P.hover;
        if (h && h.item) P.pickup(h.item);
        else if (h && h.inter) P.useInter(h.inter);
    };
    P.use = () => { const h = P.hover; if (h && h.inter) P.useInter(h.inter); };
    P.alt = () => {
        const h = P.hover;
        if (h && h.item && !P.held) { P.takeOne(h.item); return; }
        if (h && h.inter && h.inter.alt) P.useInter(h.inter, true);
    };
    P.rotate = () => { if (!P.held) return; P.rot = 1 - P.rot; PB.Audio.play('click'); };

    // hand: 'right' (also the desktop hand) or 'left' (VR only)
    P.pickup = (it, hand = 'right') => {
        if (PB.Phys.isFlying(it)) { // caught out of the air
            const f = PB.Phys.info(it);
            if (f && f.ball) PB.Ball.caught(f.hits);
        }
        if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'pickup', uid: it.uid, hand }); PB.Audio.play('pickup'); return; }
        if (PB.Phys.isFlying(it)) PB.Phys.cancel(it);
        it.mesh.updateMatrixWorld(true);
        const world = it.mesh.matrixWorld.clone(); // where it was, so a VR hand can hold it right there
        P.origin = it.surface ? { sid: it.surface, gx: it.gx, gy: it.gy, rot: it.rot } : null;
        PB.Items.detach(it);
        P.hold(it, hand, world);
        PB.Audio.play('pickup');
    };
    P.hold = (it, hand = 'right', world = null) => {
        if (hand === 'left') P.held2 = it; else { P.held = it; P.rot = it.rot; }
        const parent = PB.VR.holdParent(hand), m = it.mesh;
        parent.add(m);
        m.scale.setScalar(1);
        if (PB.VR.isOn()) {
            // always the same grip: the item's centre sits in your palm, lying flat in your hand
            parent.remove(m);
            m.position.set(0, 0, 0); m.rotation.set(0, 0, 0);
            m.updateMatrixWorld(true);
            const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
            parent.add(m);
            m.position.set(-c.x, -0.035 - c.y, -0.065 - c.z);
        }
        PB.UI.setHeld(P.held);
    };

    // F on a stack: take a single one into your hand
    P.takeOne = it => {
        if (!PB.ITEMS[it.type].stack || it.count < 2) return;
        if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'split', uid: it.uid }); PB.Audio.play('pickup'); return; }
        const one = PB.Items.split(it);
        if (!one) return;
        P.origin = { sid: it.surface, gx: it.gx, gy: it.gy, rot: it.rot };
        P.hold(one);
        PB.Audio.play('pickup');
    };

    P.placeHeld = () => {
        const p = P.place;
        if (!p || !p.ok) { PB.Audio.play('bad'); return; }
        const it = P.held;
        if (p.merge) {
            if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'merge', uid: it.uid, into: p.merge.uid }); PB.Audio.play('place'); return; }
            P.clearHeld();
            PB.Items.merge(it, p.merge);
            PB.Audio.play('place');
            return;
        }
        if (PB.Coop.isGuest()) {
            PB.Coop.send({ t: 'act', a: 'place', uid: it.uid, sid: p.sid, gx: p.gx, gy: p.gy, rot: P.rot });
            PB.Audio.play('place');
            return;
        }
        PB.Items.place(it, p.sid, p.gx, p.gy, P.rot);
        P.clearHeld();
        PB.Audio.play('place');
        PB.Game.onPlaced(it, p.sid);
    };

    // Throw / drop with physics. pos & vel are world-space (VR passes the hand's), desktop throws forward.
    P.throwHeld = (hand = 'right', pos, vel) => {
        const it = hand === 'left' ? P.held2 : P.held;
        if (!it || PB.World.area !== 'cell') return;
        const W = PB.World, m = it.mesh;
        m.updateMatrixWorld(true);
        const quat = m.getWorldQuaternion(new THREE.Quaternion());
        if (!pos) {
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(W.camera.quaternion);
            pos = W.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.35).add(new THREE.Vector3(0, -0.15, 0));
            vel = fwd.multiplyScalar(3.2).add(new THREE.Vector3(0, 1.2, 0));
        }
        P.clearHeld(hand);
        if (PB.Coop.isGuest()) {
            it.pendingThrow = performance.now();
            PB.Coop.send({ t: 'act', a: 'throw', uid: it.uid, p: pos.toArray(), v: vel.toArray(), q: quat.toArray() });
            PB.Phys.launch(it, pos, vel, quat, { ghost: true });
            return;
        }
        PB.Phys.launch(it, pos, vel, quat);
    };

    P.returnHeld = () => {
        const it = P.held;
        if (!it) return;
        if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'return', uid: it.uid }); return; }
        const o = P.origin, c = P.cell;
        P.clearHeld();
        if (o && o.sid && PB.Items.canPlace(it, o.sid, o.gx, o.gy, o.rot)) PB.Items.place(it, o.sid, o.gx, o.gy, o.rot);
        else if (!PB.Items.placeFree(it, [c + 'floor', c + 'desk', c + 'shelf'])) { PB.Items.destroy(it); PB.UI.toast('No room anywhere. You lost it.', 'bad'); return; }
        PB.Audio.play('place', { vol: 0.6 });
    };

    // Called when a held item is gone (placed, destroyed, confiscated, thrown)
    P.clearHeld = (hand = 'right') => {
        const it = hand === 'left' ? P.held2 : P.held;
        const par = it && it.mesh.parent;
        if (par && par.userData.holder) par.remove(it.mesh); // camera or VR hand
        if (hand === 'left') P.held2 = null;
        else { P.held = null; P.origin = null; if (ghost) ghost.visible = false; }
        PB.UI.setHeld(P.held);
    };
    // Forget an item wherever it is held (used when it gets destroyed / confiscated)
    P.forget = it => {
        if (P.held === it) P.clearHeld('right');
        if (P.held2 === it) P.clearHeld('left');
    };
    P.heldItems = () => [P.held, P.held2].filter(Boolean);

    // Co-op guest: the host says this item is now in our hand
    P.adopt = (it, hand = 'right') => {
        const cur = hand === 'left' ? P.held2 : P.held;
        if (cur && cur !== it) P.clearHeld(hand);
        PB.Items.detach(it);
        if (hand !== 'left') P.origin = null;
        P.hold(it, hand);
    };

    // Put held items somewhere before sleeping / saving / minigames
    P.stashHeld = () => {
        if (P.held2) { const it = P.held2; P.clearHeld('left'); if (!PB.Coop.isGuest()) PB.Items.placeFree(it, [P.cell + 'floor', P.cell + 'desk']) || PB.Items.destroy(it); else PB.Coop.send({ t: 'act', a: 'return', uid: it.uid }); }
        if (P.held) P.returnHeld();
    };

    P.flushHeld = (hand = 'right') => {
        const it = hand === 'left' ? P.held2 : P.held;
        if (!it) { PB.Audio.play('flush'); return; }
        if (NO_FLUSH.includes(it.type)) { PB.UI.toast('That won\'t go down the toilet!', 'bad'); return; }
        if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'flush', uid: it.uid, cell: P.cell }); return; }
        PB.Tunnel.flush(P.cell, it);
    };
    P.NO_FLUSH = NO_FLUSH;

    return P;
})();
