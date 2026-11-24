'use strict';
// Heat (burners, oven, fryer), doneness, soup and the spreading fire. Host runs the simulation;
// everyone renders flames/steam from the replicated fire cells and sound sources.
CF.Cook = (() => {
    const C = { sources: [], cells: new Float32Array(28 * 20), cellY: new Float32Array(28 * 20) };
    const NX = 28, NZ = 20, CS = 0.5, X0 = -7, Z0 = -5;
    const BURNER_HEAT = [0, 0.55, 1.0, 1.6];
    let bigFireTime = 0, fireTick = 0, sprinkling = 0;
    const tmp = new THREE.Vector3();

    C.init = () => {
        // height of whatever surface each fire cell sits on
        for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
            const cx = X0 + (x + 0.5) * CS, cz = Z0 + (z + 0.5) * CS;
            let top = 0;
            for (const c of CF.World.colliders) {
                if (c.floor || c.max[1] > 1.3 || c.min[1] > 0.5) continue;
                if (cx >= c.min[0] && cx <= c.max[0] && cz >= c.min[2] && cz <= c.max[2]) top = Math.max(top, c.max[1]);
            }
            C.cellY[z * NX + x] = top;
        }
    };
    C.reset = () => { C.cells.fill(0); bigFireTime = 0; C.sources = []; sprinkling = 0; };

    const cellIdx = (x, z) => {
        const ix = Math.floor((x - X0) / CS), iz = Math.floor((z - Z0) / CS);
        if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return -1;
        return iz * NX + ix;
    };
    const cellPos = (i, out) => out.set(X0 + (i % NX + 0.5) * CS, C.cellY[i], Z0 + (Math.floor(i / NX) + 0.5) * CS);
    C.cellIdx = cellIdx;
    C.fireAt = p => { const i = cellIdx(p.x, p.z); return i < 0 ? 0 : (Math.abs(C.cellY[i] - p.y) < 1.0 || p.y > C.cellY[i] ? C.cells[i] : 0); };
    C.ignite = (p, amt = 0.45) => {
        const i = cellIdx(p.x, p.z); if (i < 0) return;
        if (C.cells[i] < 0.05) {
            CF.Sync.onFx('ignite', p, 'ignite');
            const st = CF.Orders.state.stats; if (st && CF.Orders.state.phase !== 'summary') st.fires++;
        }
        C.cells[i] = Math.max(C.cells[i], amt);
    };
    C.fireCount = () => { let n = 0; for (let i = 0; i < C.cells.length; i++) if (C.cells[i] > 0.25) n++; return n; };

    // ---------- host simulation ----------
    function heatOf(it, pos) {
        const st = CF.Stations.state, Z = CF.World.zones;
        let h = 0, src = null;
        for (let i = 0; i < Z.burners.length; i++) {
            const b = Z.burners[i], lv = st.burners[i];
            if (!lv) continue;
            const dx = pos.x - b.x, dz = pos.z - b.z;
            if (dx * dx + dz * dz < 0.16 * 0.16 * (it.def.cont ? 1.6 : 1) && pos.y > b.y - 0.03 && pos.y < b.y + 0.2) { h = BURNER_HEAT[lv]; src = 'burner'; }
        }
        if (st.ovenOn && CF.World.inZone(Z.oven, pos)) { h = Math.max(h, st.ovenOpen ? 0.3 : 1.0); src = 'oven'; }
        if (st.fryerOn && CF.World.inZone(Z.fryer, pos)) { h = Math.max(h, 1.25); src = 'fryer'; }
        const f = C.fireAt(pos); if (f > 0.2) { h = Math.max(h, 1.5 * f); src = src || 'fire'; }
        return { h, src };
    }

    // cook one food item. bottomOnly: pans fry the side that faces down
    function cookFood(f, h, dt, mode) {
        const ck = f.def.cook; if (!ck || f.type === 'charcoal') return;
        const r = h * dt / ck.t;
        const s = f.s, before = CF.Items.cook(f);
        if (f.def.sides && mode === 'pan') { s.c[1 - s.up] += r; s.c[s.up] += r * 0.12; }
        else if (f.def.sides && mode === 'direct') { s.c[1 - s.up] += r * 1.4; }
        else { s.c[0] += r; if (f.def.sides) s.c[1] += r; }
        s.c[0] = Math.min(s.c[0], 1.8); s.c[1] = Math.min(s.c[1], 1.8);
        const now = CF.Items.cook(f), top = Math.max(s.c[0], s.c[1]);
        if (Math.abs(now - (f._sentCook || 0)) > 0.02) { f._sentCook = now; CF.Items.touch(f); CF.Items.refresh(f); }
        if (top > ck.burn) {
            const p = CF.Items.worldPos(f, tmp);
            C.sources.push({ k: 'smoke', p: [p.x, p.y, p.z] });
            if (top > ck.burn + 0.15 && h > 0.5) C.ignite(p, 0.5);
            if (top > ck.burn + 0.3) CF.Items.transform(f, 'charcoal', { dirty: s.dirty });
        }
        if (before < 0.6 && now >= 0.6 && f.def.sides) f._doneOnce = true;
    }

    C.update = (dt) => {
        C.sources = [];
        const Z = CF.World.zones;
        for (const it of CF.Items.all()) {
            if (it.container || it.removed) continue;
            const pos = CF.Items.worldPos(it, tmp);
            const { h, src } = heatOf(it, pos);
            if (it.type === 'pan' || it.type === 'basket' || it.type === 'plate' || it.type === 'bowl') {
                const hot = h > 0.05;
                if (it.s.hot !== hot) { it.s.hot = hot; CF.Items.touch(it); }
                if (!hot) continue;
                const foods = CF.Items.deep(it);
                const mode = it.type === 'pan' ? 'pan' : 'all';
                const mult = it.type === 'plate' || it.type === 'bowl' ? 0.5 : 1;
                for (const f of foods) cookFood(f, h * mult, dt, mode);
                if (foods.length) C.sources.push({ k: src === 'fryer' ? 'fry' : src === 'oven' ? 'bake' : 'sizzle', p: [pos.x, pos.y, pos.z] });
                else if (it.type === 'pan' && h > 1.2 && Math.random() < dt * 0.05) C.sources.push({ k: 'smoke', p: [pos.x, pos.y, pos.z] });
            } else if (it.type === 'pot') {
                potUpdate(it, h, dt, pos);
            } else if (it.def.food && h > 0) {
                // food straight on a burner / in the fryer / in the oven
                cookFood(it, h, dt, src === 'burner' ? 'direct' : 'all');
                if (it.def.cont) for (const f of CF.Items.deep(it)) cookFood(f, h, dt, 'all');
                C.sources.push({ k: src === 'fryer' ? 'fry' : src === 'oven' ? 'bake' : 'sizzle', p: [pos.x, pos.y, pos.z] });
            }
        }
        fireTick += dt;
        if (fireTick >= 0.2) { fireUpdate(fireTick); fireTick = 0; }
    };

    function potUpdate(pot, h, dt, pos) {
        const s = pot.s;
        const items = CF.Items.deep(pot);
        if (s.water && !s.soup && h > 0.3) {
            let tom = 0, oni = 0, q = 0;
            for (const f of items) {
                if (f.type === 'tomato_slice') { tom += 1; q += f.s.q; } else if (f.type === 'tomato') { tom += 1; q += 0.6; }
                if (f.type === 'onion_ring') { oni += 1; q += f.s.q; } else if (f.type === 'onion') { oni += 1; q += 0.6; }
            }
            if (tom >= 3 && oni >= 1) {
                for (const f of items) CF.Items.remove(f.id);
                s.soup = 2; s.sc = 0; s.ss = (pot.s.salt || 0); s.stir = 1; s.sq = q / (tom + oni);
                s.salt = 0;
                CF.Items.touch(pot); CF.Items.refresh(pot);
                CF.Sync.onFx('soup', pos, 'splash');
            }
        }
        if (s.soup && h > 0.3) {
            s.sc += h * dt / 45;
            s.stir = Math.max(0, s.stir - h * dt / 26);
            if (s.stir <= 0) s.sc += h * dt / 14;
            if (s.sc > 1.35) { C.ignite(pos, 0.5); C.sources.push({ k: 'smoke', p: [pos.x, pos.y, pos.z] }); }
            if (s.sc > 1.7) { s.soup = 0; s.water = 0; s.sc = 0; CF.Items.spawn('charcoal', { x: pos.x, y: pos.y + 0.2, z: pos.z }, { into: pot }); }
            if (Math.abs(s.sc - (pot._sentCook || 0)) > 0.02 || Math.abs(s.stir - (pot._sentStir || 0)) > 0.05) { pot._sentCook = s.sc; pot._sentStir = s.stir; CF.Items.touch(pot); CF.Items.refresh(pot); }
            C.sources.push({ k: 'boil', p: [pos.x, pos.y, pos.z] });
        } else if (s.water && h > 0.3) {
            C.sources.push({ k: 'boil', p: [pos.x, pos.y, pos.z] });
        } else if (!s.water && h > 0.3) {
            for (const f of items) cookFood(f, h, dt, 'all');
            if (items.length) C.sources.push({ k: 'sizzle', p: [pos.x, pos.y, pos.z] });
        }
    }

    function fireUpdate(dt) {
        const spread = CF.Orders.has('sprinkler') ? 0.5 : 1;
        let count = 0;
        const next = C.cells.slice();
        for (let i = 0; i < C.cells.length; i++) {
            const v = C.cells[i]; if (v <= 0) continue;
            count += v > 0.25 ? 1 : 0;
            next[i] = Math.min(1, v + dt * 0.07);
            if (v > 0.5) {
                const x = i % NX, z = Math.floor(i / NX);
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
                    const j = nz * NX + nx;
                    const onCounter = C.cellY[j] > 0.5;
                    const chance = dt * 0.16 * v * spread * (onCounter ? 1 : 0.45);
                    if (next[j] < 0.05 && Math.random() < chance) next[j] = 0.3;
                }
            }
        }
        C.cells.set(next);
        // sprinkler upgrade: rains down once a fire gets going
        if (CF.Orders.has('sprinkler') && count >= 3) sprinkling = 4;
        if (sprinkling > 0) { sprinkling -= dt; for (let i = 0; i < C.cells.length; i++) if (C.cells[i] > 0) C.cells[i] = Math.max(0, C.cells[i] - dt * 0.06); }
        // flames char whatever food sits in them
        for (const it of CF.Items.all()) {
            if (it.container || !it.def.food || it.type === 'charcoal') continue;
            const p = CF.Items.worldPos(it, tmp), f = C.fireAt(p);
            if (f > 0.4) cookFood(it, 2.5 * f, dt, 'all');
        }
        if (count >= 14) { bigFireTime += dt; if (bigFireTime > 12) { bigFireTime = 0; CF.Orders.fireDisaster(); } }
        else bigFireTime = Math.max(0, bigFireTime - dt);
        C.bigFire = bigFireTime;
    }

    // Extinguisher cone from origin along dir. power ~1 per second of spraying.
    C.extinguish = (o, d, power, dt) => {
        let put = 0;
        for (let i = 0; i < C.cells.length; i++) {
            if (C.cells[i] <= 0) continue;
            cellPos(i, tmp);
            const vx = tmp.x - o[0], vy = tmp.y + 0.2 - o[1], vz = tmp.z - o[2];
            const len = Math.sqrt(vx * vx + vy * vy + vz * vz); if (len > 3.2) continue;
            const dot = (vx * d[0] + vy * d[1] + vz * d[2]) / (len || 1);
            if (dot < 0.8 && len > 0.6) continue;
            const before = C.cells[i];
            C.cells[i] = Math.max(0, before - power * dt * 1.6);
            if (before > 0 && C.cells[i] === 0) put++;
        }
        // foam ruins food it hits
        for (const it of CF.Items.all()) {
            if (!it.def.food || it.s.dirty) continue;
            const p = CF.Items.worldPos(it, tmp);
            const vx = p.x - o[0], vy = p.y - o[1], vz = p.z - o[2], len = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (len < 2.2 && (vx * d[0] + vy * d[1] + vz * d[2]) / (len || 1) > 0.9 && Math.random() < dt * 3) { it.s.dirty = 1; CF.Items.touch(it); CF.Items.refresh(it); }
        }
        return put;
    };

    // ---------- network: compact fire list [idx, intensity*100, ...] ----------
    C.pack = () => { const out = []; for (let i = 0; i < C.cells.length; i++) if (C.cells[i] > 0.01) out.push(i, Math.round(C.cells[i] * 100)); return out; };
    C.unpack = a => { C.cells.fill(0); for (let k = 0; k < a.length; k += 2) C.cells[a[k]] = a[k + 1] / 100; };
    C.packSources = () => C.sources.slice(0, 24).map(s => [s.k, CF.r3(s.p[0]), CF.r3(s.p[1]), CF.r3(s.p[2])]);
    C.unpackSources = a => { C.sources = (a || []).map(s => ({ k: s[0], p: [s[1], s[2], s[3]] })); };

    // ---------- visuals + audio (everyone) ----------
    let fxAcc = 0;
    C.visuals = (dt, listener) => {
        fxAcc += dt;
        const emit = fxAcc > 0.05; if (emit) fxAcc = 0;
        const lights = [];
        let nearFire = 99;
        for (let i = 0; i < C.cells.length; i++) {
            const v = C.cells[i]; if (v <= 0.01) continue;
            cellPos(i, tmp);
            if (emit) {
                CF.World.fx('flame', tmp, Math.ceil(v * 3), { r: 1.6, s: 0.8 + v });
                if (Math.random() < v * 0.5) CF.World.fx('smoke', { x: tmp.x, y: tmp.y + 0.6, z: tmp.z }, 1, { s: 1.4 });
            }
            lights.push({ x: tmp.x, y: tmp.y, z: tmp.z, i: v });
            const d = listener ? tmp.distanceTo(listener) : 99; if (d < nearFire) nearFire = d;
        }
        lights.sort((a, b) => b.i - a.i);
        CF.World.setFireLights(lights.slice(0, 3));
        const near = { sizzle: 99, fry: 99, boil: 99, bake: 99 };
        for (const s of C.sources) {
            const p = { x: s.p[0], y: s.p[1], z: s.p[2] };
            const d = listener ? Math.hypot(p.x - listener.x, p.y - listener.y, p.z - listener.z) : 99;
            if (near[s.k] !== undefined && d < near[s.k]) near[s.k] = d;
            if (!emit) continue;
            if (s.k === 'sizzle' && Math.random() < 0.5) CF.World.fx('steam', { x: p.x, y: p.y + 0.05, z: p.z }, 1);
            if (s.k === 'boil') { CF.World.fx('bubble', { x: p.x, y: p.y + 0.06, z: p.z }, 1, { c: 0xffc0a0 }); if (Math.random() < 0.3) CF.World.fx('steam', { x: p.x, y: p.y + 0.15, z: p.z }, 1); }
            if (s.k === 'fry') CF.World.fx('bubble', { x: p.x, y: p.y + 0.02, z: p.z }, 2, { c: 0xffe9a0 });
            if (s.k === 'smoke' && Math.random() < 0.6) CF.World.fx('smoke', { x: p.x, y: p.y + 0.08, z: p.z }, 1, { c: 0x222222 });
        }
        const vol = d => CF.clamp(1.4 / (1 + d * d * 0.25), 0, 1);
        CF.Audio.loop('sizzle', vol(near.sizzle));
        CF.Audio.loop('fry', vol(near.fry));
        CF.Audio.loop('boil', vol(near.boil) * 0.8);
        CF.Audio.loop('fire', nearFire < 99 ? vol(nearFire) * 1.2 : 0);
        // oven window glows when it's on
        const st = CF.Stations.state;
        CF.World.oven.glow.intensity = st.ovenOn ? (st.ovenOpen ? 0.4 : 0.9) : 0;
        CF.World.oven.win.material.emissive.setHex(st.ovenOn ? 0x7a2a08 : 0x000000);
    };
    C.sprinkling = () => sprinkling > 0;
    return C;
})();
