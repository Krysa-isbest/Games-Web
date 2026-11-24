'use strict';
// Every movable object in the kitchen. The host owns physics bodies and decides everything;
// clients mirror items from spawn/state/snapshot messages and only interpolate meshes.
// Item: { id, type, def, mesh, body?, s: state, container: id|0, contents: [ids], heldBy: pid|null, _sv }
CF.Items = (() => {
    const I = { map: new Map(), nextId: 1 };
    const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), upV = new THREE.Vector3();
    const STACKERS = new Set(['bun_bottom', 'patty', 'cheese_slice', 'lettuce_leaf', 'tomato_slice', 'onion_ring', 'bun_top', 'salami_slice', 'mushroom_slice']);
    // container mouth: radius, local y range where falling food gets caught
    const MOUTH = { plate: [0.12, -0.03, 0.14], bowl: [0.085, -0.05, 0.14], pan: [0.115, -0.04, 0.12], pot: [0.125, -0.12, 0.24], basket: [0.1, -0.06, 0.14], pizza_base: [0.115, -0.02, 0.1] };

    const isHost = () => CF.Sync.isHost;
    I.get = id => I.map.get(id);
    I.all = () => Array.from(I.map.values());

    function defaultState(def) {
        const s = { c: [0, 0], up: 0, salt: 0, pepper: 0, dirty: 0, q: 1 };
        if (def.key === 'pot') { s.water = 0; s.soup = 0; s.sc = 0; s.ss = 0; s.stir = 1; }
        if (def.key === 'crate') s.crate = [];
        return s;
    }

    // ---------- create / remove (both sides) ----------
    I.create = (d) => {
        const def = CF.ITEMS[d.t];
        if (!def || I.map.has(d.i)) return I.map.get(d.i);
        const mesh = CF.Models.item(d.t);
        const it = { id: d.i, type: d.t, def, mesh, body: null, s: Object.assign(defaultState(def), d.s || {}), container: 0, contents: [], heldBy: d.h === undefined ? null : d.h, _sv: 1, tp: new THREE.Vector3(), tq: new THREE.Quaternion(), age: 0 };
        mesh.userData.pick = { kind: 'item', id: it.id };
        mesh.traverse(c => { c.userData.pick = mesh.userData.pick; });
        if (d.p) { mesh.position.set(d.p[0], d.p[1], d.p[2]); it.tp.copy(mesh.position); }
        if (d.q) { mesh.quaternion.set(d.q[0], d.q[1], d.q[2], d.q[3]); it.tq.copy(mesh.quaternion); }
        CF.World.scene.add(mesh);
        CF.World.pickables.push(mesh);
        I.map.set(it.id, it);
        if (it.id >= I.nextId) I.nextId = it.id + 1;
        if (d.c) attachLocal(it, I.get(d.c), d.sl);
        else if (isHost()) CF.Phys.add(it, mesh.position, mesh.quaternion, d.v ? { x: d.v[0], y: d.v[1], z: d.v[2] } : null);
        I.refresh(it);
        return it;
    };

    I.destroy = (id) => {
        const it = I.map.get(id); if (!it) return;
        for (const cid of it.contents.slice()) I.destroy(cid);
        if (it.container) { const c = I.get(it.container); if (c) { c.contents = c.contents.filter(x => x !== id); layout(c); } }
        if (it.body) CF.Phys.remove(it);
        if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
        const k = CF.World.pickables.indexOf(it.mesh); if (k >= 0) CF.World.pickables.splice(k, 1);
        it.removed = true;
        I.map.delete(id);
        if (CF.Player.held === id) CF.Player.held = null;
    };

    I.clear = () => { for (const id of Array.from(I.map.keys())) I.destroy(id); I.nextId = 1; };

    // ---------- host-only API ----------
    I.spawn = (type, pos, o = {}) => {
        const d = { i: I.nextId++, t: type, p: [pos.x, pos.y, pos.z], q: o.q || null, s: o.s || null, v: o.v || null };
        if (o.yaw !== undefined) { tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw); d.q = [tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w]; }
        const it = I.create(d);
        if (o.into) I.attach(it, o.into);
        CF.Sync.onSpawn(it);
        return it;
    };
    I.remove = (id) => {
        const it = I.get(id); if (!it) return;
        const ids = [id]; (function walk(x) { for (const c of x.contents) { ids.push(c); const ci = I.get(c); if (ci) walk(ci); } })(it);
        I.destroy(id);
        CF.Sync.onRemove(ids);
    };
    I.touch = it => { it._sv++; };

    // Replace an item with another type at the same spot (chop results, charring...)
    I.transform = (it, type, extraState) => {
        const pos = I.worldPos(it), cont = it.container ? I.get(it.container) : null;
        const s = Object.assign({}, extraState || {});
        I.remove(it.id);
        return I.spawn(type, pos, { s, into: cont });
    };

    I.worldPos = (it, out) => it.mesh.getWorldPosition(out || new THREE.Vector3());
    I.up = it => { it.mesh.getWorldQuaternion(tmpQ); return upV.set(0, 1, 0).applyQuaternion(tmpQ).y; };

    // ---------- containers ----------
    function accepts(cont, it) {
        const cd = cont.def.cont; if (!cd || cont === it) return false;
        if (cont.contents.length >= cd.cap) return false;
        if (it.def.liquid || it.type === 'crate') return false;
        if (cont.def.dish && cont.s.dirty) return false;
        if (cd.acc === 'food') return !!it.def.food && !(it.def.cont && cont.type !== 'plate');
        return cd.acc.includes(it.type);
    }
    I.accepts = accepts;

    function attachLocal(it, cont, slot) {
        if (!cont) return;
        if (it.body) CF.Phys.remove(it);
        if (it.container && it.container !== cont.id) { const old = I.get(it.container); if (old) { old.contents = old.contents.filter(x => x !== it.id); layout(old); } }
        it.container = cont.id;
        if (!cont.contents.includes(it.id)) {
            if (slot !== undefined && slot !== null && slot <= cont.contents.length) cont.contents.splice(slot, 0, it.id); else cont.contents.push(it.id);
        }
        cont.mesh.add(it.mesh);
        layout(cont);
    }
    I.attach = (it, cont) => {
        if (!cont) return;
        attachLocal(it, cont);
        it.heldBy = null;
        I.touch(it); I.touch(cont);
        CF.Audio.play(cont.type === 'pot' && cont.s.water ? 'splash' : (cont.type === 'pan' && cont.s.hot ? 'flip' : 'clink'), I.worldPos(cont));
        CF.Sync.onFx('attach', I.worldPos(cont), cont.type === 'pot' && cont.s.water ? 'splash' : 'clink');
    };
    I.detach = (it, vel) => {
        if (!it.container) return;
        const cont = I.get(it.container);
        CF.World.scene.attach(it.mesh);
        it.container = 0;
        if (cont) { cont.contents = cont.contents.filter(x => x !== it.id); layout(cont); I.touch(cont); }
        if (isHost()) CF.Phys.add(it, it.mesh.position, it.mesh.quaternion, vel || null);
        I.touch(it);
    };
    // Flattened list of every food on/in a container (pizza toppings included)
    I.deep = (it, out = []) => { for (const id of it.contents) { const c = I.get(id); if (c) { out.push(c); I.deep(c, out); } } return out; };

    function hash(id) { const x = Math.sin(id * 12.9898) * 43758.5453; return x - Math.floor(x); }
    function layout(cont) {
        const top = cont.mesh.userData.top || 0, kind = cont.def.cont ? cont.def.cont.layout : 'pile';
        const items = cont.contents.map(id => I.get(id)).filter(Boolean);
        // lift: models sit lower than their body centre so they rest on counters; on plates we add it back
        const place = (it, x, y, z) => { it.mesh.position.set(x, y + (it.mesh.userData.lift || 0), z); it.mesh.rotation.set(0, hash(it.id) * Math.PI * 2, 0); };
        if (kind === 'stack') {
            const S = items.filter(i => STACKERS.has(i.type)), O = items.filter(i => !STACKERS.has(i.type));
            const ring = O.length === 1 ? [[0, 0]] : O.length === 2 ? [[-0.055, 0], [0.06, 0]] : [[-0.06, -0.04], [-0.06, 0.05], [0.06, 0], [0, -0.07], [0, 0.07]];
            const sx = O.length ? (O.length === 1 && O[0].type === 'pizza_base' ? 0 : 0.06) : 0;
            O.forEach((it, k) => { const r = ring[k % ring.length]; place(it, O.length === 1 && S.length ? (it.type === 'pizza_base' ? 0 : -0.05) : r[0], top + it.def.h / 2 + 0.004 + Math.floor(k / ring.length) * 0.03, r[1]); });
            let y = top + 0.004 + (O.length === 1 && O[0].type === 'pizza_base' ? 0.03 : 0);
            S.forEach(it => { place(it, sx, y + it.def.h / 2, 0); y += it.def.h; });
        } else if (kind === 'pan') {
            items.forEach((it, k) => place(it, items.length > 1 ? (k ? 0.055 : -0.055) : 0, top + it.def.h / 2 + 0.002, 0));
        } else if (kind === 'top') {
            items.forEach((it, k) => {
                const a = k * 2.4, r = k === 0 ? 0 : 0.035 + (k % 3) * 0.022;
                place(it, Math.cos(a) * r, top + 0.003 + k * 0.0015, Math.sin(a) * r);
            });
        } else if (kind === 'pot') {
            const lvl = cont.s.water ? 0.04 : top;
            items.forEach((it, k) => { const a = k * 2.1; place(it, Math.cos(a) * 0.055, Math.max(lvl, top + 0.02) + k * 0.01, Math.sin(a) * 0.055); });
        } else {
            items.forEach((it, k) => { const a = k * 2.4, r = k ? 0.03 : 0; place(it, Math.cos(a) * r, top + it.def.h / 2 + k * 0.014, Math.sin(a) * r); });
        }
    }
    I.layout = layout;

    // ---------- visuals ----------
    const cRaw = new THREE.Color(), cDone = new THREE.Color(), cBurn = new THREE.Color(), cOut = new THREE.Color();
    const DIRT = new THREE.Color(0x6b5236);
    function cookColor(def, c, dirty, out) {
        const ck = def.cook; if (!ck) return out.set(0xffffff);
        cRaw.setHex(ck.raw); cDone.setHex(ck.done); cBurn.setHex(ck.burnt);
        if (c <= 0.85) out.copy(cRaw).lerp(cDone, CF.clamp(c / 0.85, 0, 1));
        else out.copy(cDone).lerp(cBurn, CF.clamp((c - 0.85) / 0.45, 0, 1));
        if (dirty) out.lerp(DIRT, 0.45);
        return out.convertSRGBToLinear();      // the palette is sRGB hex; materials work in linear
    }
    I.cook = it => it.def.sides ? (it.s.c[0] + it.s.c[1]) / 2 : it.s.c[0];
    I.refresh = (it) => {
        const u = it.mesh.userData, s = it.s;
        if (it.def.cook) {
            const c = it.def.sides ? I.cook(it) : s.c[0];
            for (const m of u.tint) cookColor(it.def, c, s.dirty, m.color);
            if (u.sides) { cookColor(it.def, s.c[s.up], s.dirty, u.sides.top.color); cookColor(it.def, s.c[1 - s.up], s.dirty, u.sides.bottom.color); }
        }
        if (u.ceramic) { const m = s.dirty ? CF.Models.mat.dirtyCeramic() : CF.Models.mat.ceramic(); for (const c of u.ceramic) c.material = m; }
        if (u.liquid) {
            u.liquid.visible = !!(s.water || s.soup);
            const amt = s.soup ? 0.03 + s.soup * 0.02 : 0.06;
            u.liquid.position.y = -0.1 + amt + (s.soup ? 0.05 : 0.08);
            if (s.soup) cookColor(CF.ITEMS.soup, Math.min(s.sc, 1), 0, u.liquid.material.color).lerp(new THREE.Color(0xffffff), s.sc < 0.3 ? 0.4 - s.sc : 0);
            else u.liquid.material.color.set(s.sc > 0 ? 0xff9a7a : 0x8fd3ff).convertSRGBToLinear();
        }
        // model extras: sear marks, melting cheese, dirt specks...
        if (u.onState) u.onState(s, it.def.cook ? (it.def.sides ? I.cook(it) : s.c[0]) : 0);
    };

    I.label = (it) => {
        const s = it.s, d = it.def;
        let n = d.name;
        if (it.type === 'pot') {
            if (s.soup) n = `Soup pot (${s.soup} bowl${s.soup > 1 ? 's' : ''})`;
            else if (s.water) n = 'Pot of water';
            else n = 'Empty pot';
        }
        if (d.dish && s.dirty) n = 'Dirty ' + d.name.toLowerCase();
        return `${d.icon} ${n}`;
    };
    // Details shown when looking at food. Exact numbers need the Chef's Nose skill.
    I.details = (it, exact) => {
        const s = it.s, d = it.def, out = [];
        if (d.food && d.cook && it.type !== 'charcoal') {
            const c = I.cook(it);
            let t = it.type === 'soup' ? (c >= 0.7 ? 'Ready' : 'Thin') : CF.doneLabel(c, d);
            if (exact) t += ` ${Math.round(c * 100)}%`;
            if (d.sides) t += exact ? ` (${Math.round(s.c[0] * 100)}/${Math.round(s.c[1] * 100)})` : (Math.abs(s.c[0] - s.c[1]) > 0.25 ? ' · uneven' : '');
            out.push(t);
        }
        if (s.salt > 0.05) out.push('🧂 ' + (exact ? s.salt.toFixed(1) : s.salt < 0.5 ? 'light' : s.salt < 1.5 ? 'salted' : 'very salty'));
        if (s.pepper > 0.05) out.push('🌶️ ' + (exact ? s.pepper.toFixed(1) : s.pepper < 0.5 ? 'light' : s.pepper < 1.5 ? 'peppered' : 'too much'));
        if (d.food && s.q < 0.999 && CF.PIECES[it.type] === undefined && s.q !== 1) out.push('✂️ ' + Math.round(s.q * 100) + '%');
        if (s.dirty && d.food) out.push('🦠 dirty!');
        if (it.type === 'pot' && s.soup) out.push((s.sc >= 0.7 ? 'Ready' : 'Cooking') + (exact ? ` ${Math.round(s.sc * 100)}%` : '') + (s.stir < 0.35 ? ' · needs stirring!' : ''));
        if (it.type === 'pot' && !s.soup && s.water) { const n = I.deep(it).length; out.push(n ? n + ' ingredient' + (n > 1 ? 's' : '') : 'add 3 tomato + 1 onion'); }
        if (d.cont && it.contents.length && it.type !== 'pot') out.push(it.contents.length + ' on it');
        if (it.type === 'crate') out.push((s.crate || []).length + ' items · E to open');
        return out.join(' · ');
    };

    // ---------- serialization ----------
    I.desc = (it) => {
        const m = it.mesh;
        const d = { i: it.id, t: it.type, s: it.s };
        if (it.container) { d.c = it.container; d.sl = (I.get(it.container) || { contents: [] }).contents.indexOf(it.id); }
        else { d.p = [CF.r3(m.position.x), CF.r3(m.position.y), CF.r3(m.position.z)]; d.q = [CF.r3(m.quaternion.x), CF.r3(m.quaternion.y), CF.r3(m.quaternion.z), CF.r3(m.quaternion.w)]; }
        if (it.heldBy !== null) d.h = it.heldBy;
        return d;
    };
    // client: apply a state/containment update from the host
    I.applyState = (u) => {
        const it = I.get(u.i); if (!it) return;
        if (u.s) it.s = u.s;
        it.heldBy = u.h === undefined ? null : u.h;
        const want = u.c || 0;
        if (want !== it.container) {
            if (want) attachLocal(it, I.get(want), u.sl);
            else { const cont = I.get(it.container); CF.World.scene.attach(it.mesh); it.container = 0; if (cont) { cont.contents = cont.contents.filter(x => x !== it.id); layout(cont); } it.tp.copy(it.mesh.position); it.tq.copy(it.mesh.quaternion); }
        } else if (want) {
            const cont = I.get(want);
            if (cont && u.sl !== undefined && cont.contents.indexOf(it.id) !== u.sl) { cont.contents = cont.contents.filter(x => x !== it.id); cont.contents.splice(u.sl, 0, it.id); layout(cont); }
        }
        if (it.type === 'pot') { const c = I.get(it.id); layout(c); }
        I.refresh(it);
    };
    I.applySnap = (id, x, y, z, qx, qy, qz, qw) => {
        const it = I.get(id); if (!it || it.container) return;
        it.tp.set(x, y, z); it.tq.set(qx, qy, qz, qw);
        if (it.mesh.position.distanceToSquared(it.tp) > 4) { it.mesh.position.copy(it.tp); it.mesh.quaternion.copy(it.tq); }
    };

    // ---------- per-frame ----------
    const holdQ = new THREE.Quaternion(), errQ = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    I.update = (dt) => {
        const host = isHost(), me = CF.Sync.myPid;
        for (const it of I.map.values()) {
            it.age += dt;
            if (it.container) continue;
            if (host && it.body) {
                const b = it.body;
                if (it.heldBy !== null) steer(it, b, dt);
                it.mesh.position.set(b.position.x, b.position.y, b.position.z);
                it.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
                if (b.position.y < -2 || Math.abs(b.position.x) > 30 || Math.abs(b.position.z) > 30) { b.position.set(0, 1.4, 0.5); b.velocity.set(0, 0, 0); }
            } else if (!host) {
                if (it.heldBy === me && me !== null && CF.Player.active) {
                    // our own held item is predicted locally so it never lags behind the camera
                    const hp = CF.Player.holdPoint();
                    it.mesh.position.lerp(hp, 1 - Math.exp(-30 * dt));
                    holdQ.setFromAxisAngle(Y, CF.Player.yaw + CF.Player.holdYaw);
                    it.mesh.quaternion.slerp(holdQ, 1 - Math.exp(-20 * dt));
                } else {
                    const k = 1 - Math.exp(-16 * dt);
                    it.mesh.position.lerp(it.tp, k);
                    it.mesh.quaternion.slerp(it.tq, k);
                }
            }
        }
    };
    // Held items chase the holder's hand with velocity control so they still collide with the world
    function steer(it, b, dt) {
        const p = CF.Sync.players[it.heldBy];
        if (!p || !p.hold) { I.release(it, null); return; }
        const tx = p.hold[0], ty = p.hold[1], tz = p.hold[2];
        const dx = tx - b.position.x, dy = ty - b.position.y, dz = tz - b.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 1.8) { I.release(it, null); CF.Sync.onFx('drop', it.mesh.position, 'drop'); return; }
        const k = 16, max = 10;
        let vx = dx * k, vy = dy * k, vz = dz * k;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz); if (sp > max) { vx *= max / sp; vy *= max / sp; vz *= max / sp; }
        b.velocity.set(vx, vy, vz);
        holdQ.setFromAxisAngle(Y, (p.yaw || 0) + (p.hy || 0));
        errQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).invert().premultiply(holdQ);
        if (errQ.w < 0) { errQ.x = -errQ.x; errQ.y = -errQ.y; errQ.z = -errQ.z; errQ.w = -errQ.w; }
        const ang = 2 * Math.acos(CF.clamp(errQ.w, -1, 1)), sn = Math.sqrt(1 - errQ.w * errQ.w);
        if (sn > 1e-4) b.angularVelocity.set(errQ.x / sn * ang * 12, errQ.y / sn * ang * 12, errQ.z / sn * ang * 12);
        else b.angularVelocity.set(0, 0, 0);
        b.wakeUp();
    }

    // host: grab / release
    I.grab = (pid, id) => {
        const it = I.get(id); if (!it || (it.heldBy !== null && it.heldBy !== pid)) return false;
        for (const o of I.map.values()) if (o.heldBy === pid && o !== it) I.release(o, null);
        if (it.container) I.detach(it);
        if (!it.body) CF.Phys.add(it, it.mesh.position, it.mesh.quaternion);
        it.heldBy = pid;
        CF.Phys.setHeld(it, true);
        I.touch(it);
        return true;
    };
    I.release = (it, vel) => {
        if (!it) return;
        it.heldBy = null;
        if (it.body) {
            CF.Phys.setHeld(it, false);
            if (vel) it.body.velocity.set(vel[0], vel[1], vel[2]);
            it.body.angularVelocity.scale(0.3, it.body.angularVelocity);
            it.thrownAt = performance.now();
        }
        I.touch(it);
    };
    I.heldBy = pid => { for (const it of I.map.values()) if (it.heldBy === pid) return it; return null; };

    // host: catch free food falling into containers, spill tipped containers
    I.updateContainers = () => {
        const conts = [], foods = [];
        for (const it of I.map.values()) {
            if (it.def.cont) conts.push(it);
            if (!it.container && it.heldBy === null && it.body && (it.def.food || it.type === 'tomato')) foods.push(it);
        }
        for (const c of conts) {
            const up = I.up(c);
            if (c.contents.length && up < 0.3 && !c.container) {
                const v = c.body ? [c.body.velocity.x, c.body.velocity.y, c.body.velocity.z] : [0, 0, 0];
                for (const id of c.contents.slice()) { const f = I.get(id); if (!f) continue; if (f.def.liquid) { I.remove(id); continue; } I.detach(f, { x: v[0] + CF.rand(-0.6, 0.6), y: v[1] + 0.8, z: v[2] + CF.rand(-0.6, 0.6) }); }
                if (c.type === 'pot' && (c.s.water || c.s.soup)) { c.s.water = 0; c.s.soup = 0; c.s.sc = 0; I.touch(c); I.refresh(c); CF.Sync.onFx('splash', I.worldPos(c), 'splash'); }
                continue;
            }
            if (up < 0.65 || c.s.dirty) continue;
            const mouth = MOUTH[c.type]; if (!mouth) continue;
            c.mesh.updateMatrixWorld();
            for (const f of foods) {
                if (f === c || f.removed || f.container || !accepts(c, f)) continue;
                if (f.age < 0.4) continue;
                tmpV.copy(f.mesh.position); c.mesh.worldToLocal(tmpV);
                if (tmpV.x * tmpV.x + tmpV.z * tmpV.z > mouth[0] * mouth[0] || tmpV.y < mouth[1] || tmpV.y > mouth[2]) continue;
                // nested containers: toppings go onto the pizza if the plate carries one
                const inner = c.contents.map(id => I.get(id)).find(x => x && x.def.cont && accepts(x, f));
                I.attach(f, inner || c);
            }
        }
    };

    return I;
})();
