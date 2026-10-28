'use strict';
// 3D minigame framework: close-up desk camera, grabbable props with gravity,
// falling particles (tobacco, sugar, liquids) and a 2D overlay for meters.
PB.Mini = (() => {
    const M = { active: null, deskY: 0.805, tilt: false, grabbed: null, props: [] };
    const mouse = M.mouse = { x: 0, y: 0, nx: 0, ny: 0, down: false, rdown: false };
    const WORK = { x0: -0.06, x1: 0.86, z0: 1.43, z1: 1.97 };
    let el = {}, cv, ctx, W;
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmp = new THREE.Vector3();
    const cam = { t: 1, fromP: new THREE.Vector3(), fromQ: new THREE.Quaternion(), toP: new THREE.Vector3(), toQ: new THREE.Quaternion() };
    const DEFAULT_VIEW = { pos: [0.4, 1.26, 1.14], look: [0.4, 0.8, 1.68] };

    M.init = () => {
        W = PB.World;
        cv = document.getElementById('mini-canvas');
        ctx = cv.getContext('2d');
        ['mini', 'mini-title', 'mini-step', 'mini-hint', 'mini-buttons'].forEach(id => { el[id] = document.getElementById(id); });
        // Everything in a minigame lives in M.root, which copies the transform of the player's cell,
        // so the same local coordinates work in your cell and in the mirrored neighbour cell.
        M.root = new THREE.Group();
        W.scene.add(M.root);
        // permanent (off by default) so toggling it never forces a shader recompile
        M.workLight = new THREE.PointLight(0xffe2b0, 0, 2.5, 2);
        M.workLight.position.set(0.4, 1.45, 1.45);
        M.root.add(M.workLight);
        Particles.init();
        M.persist = new Set([M.workLight, Particles.mesh]);
        const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
        resize(); addEventListener('resize', resize);

        const setMouse = e => {
            mouse.x = e.clientX; mouse.y = e.clientY;
            mouse.nx = e.clientX / innerWidth * 2 - 1; mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
        };
        addEventListener('mousemove', e => { if (M.active) setMouse(e); });
        addEventListener('mousedown', e => {
            if (!M.active || e.target.closest('#mini-panel')) return;
            setMouse(e);
            if (e.button === 0) { mouse.down = true; leftDown(); }
            if (e.button === 2) {
                mouse.rdown = true;
                if (M.grabbed && M.grabbed.grab === 'sticky') M.drop();
                else M.tilt = true;
            }
        });
        addEventListener('mouseup', e => {
            if (!M.active) return;
            if (e.button === 0 && mouse.down) { mouse.down = false; leftUp(); }
            if (e.button === 2) { mouse.rdown = false; M.tilt = false; }
        });
        addEventListener('contextmenu', e => { if (M.active) e.preventDefault(); });
        addEventListener('keydown', e => {
            if (!M.active) return;
            if (e.code === 'Escape') { e.preventDefault(); M.abort(); return; }
            if (e.code === 'Space') { e.preventDefault(); M.tilt = true; }
            if (M.active.key) M.active.key(e);
        });
        addEventListener('keyup', e => { if (M.active && e.code === 'Space') M.tilt = false; });
    };

    // ---------- Lifecycle ----------
    M.start = game => {
        if (!game.keepHeld) PB.Player.stashHeld();
        PB.Player.unlock();
        M.active = game;
        mouse.down = mouse.rdown = false; M.tilt = false; M.grabbed = null; M.result = null;
        const cell = W.cells[PB.Player.cell];
        M.root.position.copy(cell.group.position);
        M.root.scale.copy(cell.group.scale);
        M.root.updateMatrixWorld(true);
        M.mirror = cell.mirror;
        M.deskSurface = W.surfaces[PB.Player.cell + 'desk'];
        M.deskSurface.group.visible = false;
        M.workLight.intensity = 0.9;
        cam.fromP.copy(W.camera.position); cam.fromQ.copy(W.camera.quaternion);
        M.view(DEFAULT_VIEW.pos, DEFAULT_VIEW.look);
        el['mini'].classList.remove('hidden');
        el['mini-title'].textContent = game.title;
        document.body.classList.add('mg');
        game.begin();
    };
    M.view = (pos, look) => {
        if (PB.VR.isOn()) { // in VR the headset owns the camera: stand the player there instead
            PB.VR.enterMinigame(M.root.localToWorld(new THREE.Vector3(...pos)), M.root.localToWorld(new THREE.Vector3(...look)));
            return;
        }
        cam.fromP.copy(W.camera.position); cam.fromQ.copy(W.camera.quaternion);
        cam.toP.copy(M.root.localToWorld(new THREE.Vector3(...pos)));
        // must be a Camera: Object3D.lookAt points +z at the target, cameras look down -z
        const o = new THREE.Camera();
        o.position.copy(cam.toP); o.lookAt(M.root.localToWorld(new THREE.Vector3(...look)));
        cam.toQ.copy(o.quaternion);
        cam.t = 0;
    };
    M.step = (s, hint) => { el['mini-step'].textContent = s; el['mini-hint'].innerHTML = hint; M.result = null; };
    M.buttons = list => {
        const b = el['mini-buttons']; b.innerHTML = '';
        list.forEach(o => {
            const x = document.createElement('button');
            x.className = 'btn small ' + (o.cls || '');
            x.textContent = o.label;
            x.disabled = !!o.disabled;
            x.onclick = () => { PB.Audio.play('click'); o.fn(); };
            b.appendChild(x);
        });
    };
    M.clearScene = () => {
        M.props = []; M.grabbed = null;
        M.root.children.filter(o => !M.persist.has(o)).forEach(o => M.root.remove(o));
        Particles.clear();
    };
    // Work in progress is remembered per recipe, so leaving a minigame never loses progress.
    M.saveWip = (g, keep) => {
        if (!g || !g.id || !PB.state) return;
        PB.state.wip = PB.state.wip || {};
        const snap = keep && g.snapshot ? g.snapshot() : null;
        if (snap) PB.state.wip[g.id] = snap;
        else delete PB.state.wip[g.id];
    };
    M.wip = id => (PB.state.wip || {})[id] || null;

    M.close = (keep = true) => {
        const g = M.active;
        M.saveWip(g, keep);
        M.active = null; mouse.down = false; M.tilt = false;
        PB.VR.leaveMinigame();
        if (g && g.cleanup) g.cleanup();
        M.clearScene();
        M.workLight.intensity = 0;
        if (M.deskSurface) M.deskSurface.group.visible = true;
        el['mini'].classList.add('hidden');
        document.body.classList.remove('mg', 'grabbing');
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (PB.Player.enabled && !PB.UI.blocking()) PB.Player.lock();
    };
    // keep = false throws the work in progress away (e.g. a guard caught you)
    M.abort = (keep = true) => {
        if (!M.active) return;
        const g = M.active;
        if (keep && g.onAbort) g.onAbort();
        M.close(keep);
    };

    // ---------- Pointer helpers ----------
    M.ray = () => {
        if (PB.VR.isOn()) return PB.VR.aimRay(ray); // your right hand points
        ray.setFromCamera({ x: mouse.nx, y: mouse.ny }, W.camera);
        return ray;
    };
    // VR: the controller acts as the mouse
    M.setPointer = (x, y) => {
        mouse.x = x; mouse.y = y;
        mouse.nx = x / innerWidth * 2 - 1; mouse.ny = -(y / innerHeight) * 2 + 1;
    };
    // VR: real hands. vrHands[side] = { pos, quat } in world space (set every frame by PB.VR)
    M.vrHands = {};
    const handLocal = side => M.vrHands[side] ? M.root.worldToLocal(M.vrHands[side].pos.clone()) : null;
    // grip: grab the closest prop next to your hand (or let the game spawn one, e.g. a paper from the pack)
    M.vrGrab = side => {
        if (!M.active || M.grabbed) return;
        const hp = handLocal(side);
        if (!hp) return;
        let best = null, bestD = 0.2; // generous: your hand only has to be near it
        for (const p of M.props) {
            if (!p.grab || p.state === 'held' || !p.mesh.visible || (p.canGrab && !p.canGrab())) continue;
            const d = p.mesh.position.clone().add(new THREE.Vector3(0, 0.04, 0)).distanceTo(hp);
            if (d < bestD) { bestD = d; best = p; }
        }
        if (best) { best.vrHand = side; M.grabProp(best); }
        else if (M.active.vrGrab) M.active.vrGrab(hp, side);
    };
    M.vrRelease = side => {
        const p = M.grabbed;
        if (p && p.vrHand === side) { M.drop(); p.vrHand = null; }
    };
    M.handLocal = handLocal;

    M.vrPress = (btn, down) => {
        if (!M.active || btn !== 'left') return;
        // in VR the hands grab with grip, so the trigger never picks props up: it only "clicks"
        if (PB.VR.isOn()) {
            if (down && !mouse.down) { mouse.down = true; if (M.grabbed && M.grabbed.grab === 'sticky') { if (M.active.down) M.active.down(M.grabbed); } else if (M.active.down) M.active.down(null); }
            else if (!down && mouse.down) { mouse.down = false; if (M.active.up) M.active.up(); }
            return;
        }
        if (down && !mouse.down) { mouse.down = true; leftDown(); }
        else if (!down && mouse.down) { mouse.down = false; leftUp(); }
    };
    // Mouse ray against a horizontal plane at local height y -> point in local (cell) space
    M.handAt = y => {
        plane.constant = -y;
        const p = M.ray().ray.intersectPlane(plane, new THREE.Vector3());
        return p ? M.root.worldToLocal(p) : null;
    };
    M.clampWork = (v, pad = 0) => {
        v.x = PB.clamp(v.x, WORK.x0 + pad, WORK.x1 - pad);
        v.z = PB.clamp(v.z, WORK.z0 + pad, WORK.z1 - pad);
        return v;
    };
    M.pick = objs => {
        const h = M.ray().intersectObjects(objs, true)[0];
        return h || null;
    };
    // local (cell) point -> screen pixels
    M.project = v => {
        tmp.copy(v);
        M.root.localToWorld(tmp);
        tmp.project(W.camera);
        return { x: (tmp.x + 1) / 2 * innerWidth, y: (1 - tmp.y) / 2 * innerHeight, behind: tmp.z > 1 };
    };

    // ---------- Props ----------
    // grab: 'hold' (while LMB held) | 'sticky' (click to take, RMB to drop) | null
    M.prop = (mesh, o = {}) => {
        const p = Object.assign({
            mesh, grab: null, holdY: M.deskY + 0.16, restY: M.deskY, state: 'rest',
            vel: new THREE.Vector3(), vy: 0, tiltAmt: 0, tiltMax: 2.0, tiltAxis: 'z', pad: 0.03
        }, o);
        mesh.userData.prop = p;
        p.home = mesh.position.clone();
        M.root.add(mesh);
        M.props.push(p);
        return p;
    };
    M.removeProp = p => {
        M.root.remove(p.mesh);
        M.props = M.props.filter(x => x !== p);
        if (M.grabbed === p) M.grabbed = null;
    };
    M.grabProp = p => {
        M.grabbed = p; p.state = 'held';
        document.body.classList.add('grabbing');
        PB.Audio.play('pickup', { vol: 0.6 });
        if (M.active.onGrab) M.active.onGrab(p);
    };
    M.drop = () => {
        const p = M.grabbed;
        if (!p) return;
        M.grabbed = null;
        p.vrHand = null;
        document.body.classList.remove('grabbing');
        p.state = 'fall'; p.vy = Math.min(0, p.vel.y);
        if (M.active.onRelease) M.active.onRelease(p);
    };

    function leftDown() {
        const g = M.active;
        if (M.grabbed && M.grabbed.grab === 'sticky') { if (g.down) g.down(M.grabbed); return; }
        const cands = M.props.filter(p => p.grab && p.state !== 'held' && p.mesh.visible && (!p.canGrab || p.canGrab()));
        const h = M.pick(cands.map(p => p.mesh));
        if (h) {
            let o = h.object;
            while (o && !o.userData.prop) o = o.parent;
            if (o) { M.grabProp(o.userData.prop); return; }
        }
        if (g.down) g.down(null);
    }
    function leftUp() {
        if (M.grabbed && M.grabbed.grab === 'hold') { M.drop(); return; }
        if (M.active.up) M.active.up();
    }

    function updateProps(dt) {
        for (const p of M.props) {
            const m = p.mesh;
            if (p.state === 'held' && p.vrHand && PB.VR.isOn() && M.vrHands[p.vrHand]) {
                // VR: the prop sits in your real hand; tilting your wrist tips it (pouring)
                const prev = m.position.clone(), hp = handLocal(p.vrHand);
                M.clampWork(hp, p.pad);
                hp.y = Math.max(hp.y, M.deskY + 0.005); // never through the desk
                if (p.follow) p.follow(hp, dt);
                else m.position.lerp(hp, 1 - Math.exp(-30 * dt));
                const v = m.position.clone().sub(prev).divideScalar(Math.max(dt, 0.001));
                p.vel.lerp(v, 0.35);
                const e = new THREE.Euler().setFromQuaternion(M.vrHands[p.vrHand].quat, 'YXZ');
                const roll = e.z * (M.mirror ? -1 : 1);
                p.tiltAmt = p.tiltable ? PB.clamp(roll, 0, p.tiltMax) : 0;
                m.rotation.set(PB.clamp(e.x, -0.8, 0.8) * 0.3, 0, p.tiltAxis === 'z' ? p.tiltAmt : 0);
                if (p.tiltAxis !== 'z') m.rotation.x = -p.tiltAmt;
            } else if (p.state === 'held') {
                const prev = m.position.clone();
                const tgt = M.handAt(p.holdY);
                if (tgt) {
                    M.clampWork(tgt, p.pad);
                    if (p.follow) p.follow(tgt, dt);
                    else { m.position.x = PB.damp(m.position.x, tgt.x, 18, dt); m.position.z = PB.damp(m.position.z, tgt.z, 18, dt); m.position.y = PB.damp(m.position.y, p.holdY, 14, dt); }
                }
                const v = m.position.clone().sub(prev).divideScalar(Math.max(dt, 0.001));
                p.vel.lerp(v, 0.35);
                const want = M.tilt && p.tiltable ? p.tiltMax : 0;
                p.tiltAmt = PB.damp(p.tiltAmt, want, 8, dt);
                if (p.tiltAxis === 'z') { m.rotation.z = PB.clamp(-p.vel.x * 0.35, -0.6, 0.6) + p.tiltAmt; m.rotation.x = PB.clamp(p.vel.z * 0.35, -0.6, 0.6); }
                else { m.rotation.x = PB.clamp(p.vel.z * 0.35, -0.6, 0.6) - p.tiltAmt; m.rotation.z = PB.clamp(-p.vel.x * 0.35, -0.6, 0.6); }
            } else if (p.state === 'fall') {
                p.vy -= 9.8 * dt;
                m.position.y += p.vy * dt;
                m.position.x += p.vel.x * dt * 0.3; m.position.z += p.vel.z * dt * 0.3;
                M.clampWork(m.position, p.pad);
                p.tiltAmt = PB.damp(p.tiltAmt, 0, 10, dt);
                m.rotation.x = PB.damp(m.rotation.x, 0, 8, dt); m.rotation.z = PB.damp(m.rotation.z, 0, 8, dt);
                if (p.onFall && p.onFall(p)) continue;
                if (m.position.y <= p.restY) {
                    m.position.y = p.restY; p.state = 'rest'; p.vel.set(0, 0, 0);
                    if (Math.abs(p.vy) > 0.6) PB.Audio.play('place', { vol: PB.clamp(Math.abs(p.vy) / 3, 0.15, 0.7) });
                    if (p.onLand) p.onLand(p);
                }
            } else {
                m.rotation.x = PB.damp(m.rotation.x, 0, 10, dt); m.rotation.z = PB.damp(m.rotation.z, 0, 10, dt);
            }
        }
    }

    // ---------- Particles ----------
    const Particles = M.particles = {
        max: 1800, list: [], next: 0,
        init() {
            const geo = new THREE.BoxGeometry(1, 1, 1);
            const mat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // unlit so tiny bits keep their colour at night
            this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
            // colour buffer sized for every particle (setColorAt would size it from the current count)
            this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
            this.mesh.count = 0;
            this.mesh.frustumCulled = false;
            M.root.add(this.mesh);
            this.dummy = new THREE.Object3D();
            this.col = new THREE.Color();
        },
        spawn(o) {
            let p;
            if (this.list.length < this.max) { p = {}; this.list.push(p); }
            else { p = this.list[this.next]; this.next = (this.next + 1) % this.max; }
            Object.assign(p, {
                x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
                size: o.size || 0.006, color: o.color || 0x6b4423, alive: true, rest: false,
                tag: o.tag || '', rot: Math.random() * 3, data: o.data || null, stretch: o.stretch || 1
            });
            p.floor = o.floor != null ? o.floor : M.deskY + p.size / 2;
            return p;
        },
        clear() { this.list = []; this.next = 0; this.mesh.count = 0; },
        update(dt) {
            const g = M.active, d = this.dummy;
            let n = 0;
            for (const p of this.list) {
                if (!p.alive) continue;
                if (!p.rest) {
                    p.vy -= 9.8 * dt;
                    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
                    p.vx *= 0.995; p.vz *= 0.995;
                    if (g && g.particleStep && g.particleStep(p)) { p.alive = false; continue; }
                    if (p.y <= p.floor) {
                        p.y = p.floor; p.rest = true;
                        if (g && g.particleLand && g.particleLand(p) === 'kill') { p.alive = false; continue; }
                    }
                    if (p.y < 0) { p.alive = false; continue; }
                }
                d.position.set(p.x, p.y, p.z);
                d.rotation.set(p.rot, p.rot * 1.3, 0);
                d.scale.set(p.size, p.size * (p.rest ? 0.5 : p.stretch), p.size);
                d.updateMatrix();
                this.mesh.setMatrixAt(n, d.matrix);
                this.mesh.setColorAt(n, this.col.set(p.color));
                n++;
            }
            this.mesh.count = n;
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
    };

    // ---------- Frame ----------
    M.update = dt => {
        if (!M.active) return;
        if (!PB.VR.isOn()) {
            cam.t = Math.min(1, cam.t + dt * 2.4);
            const e = 1 - Math.pow(1 - cam.t, 3);
            W.camera.position.lerpVectors(cam.fromP, cam.toP, e);
            W.camera.quaternion.copy(cam.fromQ).slerp(cam.toQ, e);
        }
        updateProps(dt);
        if (M.active.update) M.active.update(dt);
        if (!M.active) return;
        Particles.update(dt);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.save();
        if (M.active.drawHUD) M.active.drawHUD(ctx, cv.width, cv.height);
        if (M.result) drawResult(ctx, cv.width, cv.height);
        ctx.restore();
    };

    // ---------- 2D overlay helpers ----------
    const INK = '#221a2e';
    const D = M.D = {
        rr(c, x, y, w, h, r) {
            c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
            c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
        },
        panel(c, x, y, w, h, fill, r = 14, lw = 4) {
            D.rr(c, x, y, w, h, r); c.fillStyle = fill; c.fill(); c.lineWidth = lw; c.strokeStyle = INK; c.stroke();
        },
        circle(c, x, y, r, fill, lw = 4) {
            c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
            if (lw) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
        },
        text(c, s, x, y, size = 26, col = '#fff', align = 'center') {
            c.font = `${size}px "Luckiest Guy", Impact, sans-serif`;
            c.textAlign = align; c.textBaseline = 'middle';
            c.lineWidth = Math.max(3, size / 6); c.strokeStyle = INK; c.lineJoin = 'round';
            c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y);
        },
        small(c, s, x, y, size = 16, col = INK, align = 'center') {
            c.font = `800 ${size}px Nunito, sans-serif`; c.textAlign = align; c.textBaseline = 'middle';
            c.fillStyle = col; c.fillText(s, x, y);
        },
        meter(c, x, y, w, h, v, lo, hi, label) {
            D.panel(c, x, y, w, h, '#fff4d6', 8, 3);
            c.fillStyle = '#7ee08a'; c.fillRect(x + w * lo, y + 3, w * (hi - lo), h - 6);
            const nx = x + w * PB.clamp(v, 0, 1);
            c.fillStyle = INK; c.fillRect(nx - 3, y - 6, 6, h + 12);
            if (label) D.text(c, label, x + w / 2, y - 16, 18);
        },
        vmeter(c, x, y, w, h, v, lo, hi) {
            D.panel(c, x, y, w, h, '#fff4d6', 8, 3);
            c.fillStyle = '#7ee08a'; c.fillRect(x + 3, y + h * (1 - hi), w - 6, h * (hi - lo));
            const fy = y + h * (1 - PB.clamp(v, 0, 1.1));
            c.fillStyle = 'rgba(122,74,36,.85)'; c.fillRect(x + 3, fy, w - 6, y + h - fy - 3);
        },
        progress(c, x, y, w, h, f, col = '#3ecf6e') {
            D.panel(c, x, y, w, h, '#fff4d6', h / 2, 3);
            if (f > 0) { D.rr(c, x + 3, y + 3, Math.max(h - 6, (w - 6) * PB.clamp(f, 0, 1)), h - 6, (h - 6) / 2); c.fillStyle = col; c.fill(); }
        },
        // bouncing arrow + label above a 3D point
        marker(c, v3, text) {
            const s = M.project(v3);
            if (s.behind) return;
            const bob = Math.sin(performance.now() / 180) * 6;
            D.text(c, '▼', s.x, s.y - 22 + bob, 30, '#ffd23f');
            if (text) D.text(c, text, s.x, s.y - 56 + bob, 20);
        }
    };

    M.showResult = (q, title, sub) => { M.result = { q, title, sub, t: 0 }; };
    function drawResult(c, w, h) {
        const r = M.result;
        r.t += 1 / 60;
        const s = Math.min(1, r.t * 5);
        const g = PB.gradeOf(r.q);
        c.save();
        c.translate(w / 2, h * 0.36);
        c.scale(s, s);
        D.panel(c, -200, -120, 400, 230, '#fff4d6', 22, 5);
        D.text(c, r.title, 0, -85, 30, '#ff8a1f');
        c.save(); c.rotate(-0.18); D.circle(c, 0, 0, 52, g.col, 6); D.text(c, g.g, 0, 4, 60, '#fff'); c.restore();
        D.small(c, `Quality ${Math.round(r.q)}%`, 0, 70, 20);
        if (r.sub) D.small(c, r.sub, 0, 94, 14, '#6a5f78');
        c.restore();
    }

    M.INK = INK;
    return M;
})();
