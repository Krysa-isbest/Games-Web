'use strict';
// Item instances: 3D models, grid placement, stacking, save data.
PB.Items = (() => {
    const I = { list: [], uid: 1, anims: [] };
    const C = PB.C;
    let W, geo, texDoc, texDocStamped;

    function initShared() {
        W = PB.World;
        geo = {
            cig: new THREE.CylinderGeometry(0.0065, 0.0065, 0.068, 8),
            filter: new THREE.CylinderGeometry(0.0068, 0.0068, 0.022, 8),
            sheet: new THREE.BoxGeometry(0.17, 0.003, 0.25)
        };
        const docTex = stamped => W.canvasTex(128, 192, (g, w, h) => {
            g.fillStyle = '#f6efd8'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#3a3550'; g.fillRect(14, 14, 100, 12);
            g.fillStyle = '#8a86a0';
            for (let i = 0; i < 9; i++) g.fillRect(14, 40 + i * 12, 60 + ((i * 37) % 40), 4);
            g.strokeStyle = '#2b3fa8'; g.lineWidth = 3;
            g.beginPath(); g.moveTo(20, 165); g.bezierCurveTo(40, 140, 55, 185, 75, 160); g.bezierCurveTo(85, 150, 95, 170, 108, 158); g.stroke();
            if (stamped) {
                g.strokeStyle = '#d23a3a'; g.lineWidth = 4;
                g.beginPath(); g.arc(92, 120, 20, 0, Math.PI * 2); g.stroke();
                g.font = 'bold 11px sans-serif'; g.fillStyle = '#d23a3a'; g.textAlign = 'center'; g.fillText('OK', 92, 124);
            }
        });
        texDoc = docTex(false); texDocStamped = docTex(true);
    }

    // ---------- Models (centered on footprint, bottom at y=0) ----------
    function build(it) {
        const g = new THREE.Group();
        const glass = (c, o) => W.mat(c, { transparent: true, opacity: o });
        switch (it.type) {
            case 'tobacco':
            case 'premium': {
                const prem = it.type === 'premium';
                W.box(0.17, 0.06, 0.15, prem ? 0x4f7d3a : 0x9c6b3c, 0, 0.03, 0, g);
                W.box(0.17, 0.025, 0.06, prem ? 0x3b602b : 0x7a5130, 0, 0.07, -0.04, g);
                W.box(0.1, 0.003, 0.06, prem ? 0xffd700 : 0xf2d16b, 0, 0.061, 0.035, g);
                const n = Math.ceil((it.charges || 1) / 3);
                for (let i = 0; i < n; i++) W.sph(0.016, 0x6b4423, -0.04 + i * 0.03, 0.072, 0.02, g, 6);
                break;
            }
            case 'rolling':
                W.box(0.07, 0.012, 0.05, 0xf4f0e8, 0, 0.006, 0, g);
                W.box(0.072, 0.004, 0.052, 0xd8452b, 0, 0.014, 0, g);
                W.box(0.03, 0.002, 0.02, 0xffffff, 0, 0.017, 0, g);
                break;
            case 'cigarette': {
                const n = Math.max(1, it.count);
                for (let i = 0; i < n; i++) {
                    const row = i % 5, layer = Math.floor(i / 5);
                    const c = new THREE.Group();
                    const body = new THREE.Mesh(geo.cig, W.mat(0xf7f3ea)); body.rotation.z = Math.PI / 2; body.position.x = 0.012;
                    const fil = new THREE.Mesh(geo.filter, W.mat(0xe0913a)); fil.rotation.z = Math.PI / 2; fil.position.x = -0.034;
                    body.castShadow = fil.castShadow = true;
                    c.add(body, fil);
                    c.position.set(layer * 0.012, 0.007 + layer * 0.012, -0.03 + row * 0.015 + layer * 0.007);
                    g.add(c);
                }
                break;
            }
            case 'blank':
                for (let i = 0; i < Math.max(1, it.charges); i++) {
                    const sh = new THREE.Mesh(geo.sheet, W.mat(0xfdfdf8));
                    sh.position.set(Math.sin(i * 2.1) * 0.004, 0.002 + i * 0.004, Math.cos(i * 1.7) * 0.004);
                    sh.rotation.y = Math.sin(i * 3.3) * 0.04;
                    sh.castShadow = sh.receiveShadow = true;
                    g.add(sh);
                }
                break;
            case 'document': {
                const n = Math.max(1, it.count);
                for (let i = 0; i < n; i++) {
                    const sh = new THREE.Mesh(geo.sheet, W.mat(0xf6efd8));
                    sh.position.set(Math.sin(i * 2.1) * 0.005, 0.002 + i * 0.004, Math.cos(i * 1.7) * 0.005);
                    sh.rotation.y = Math.sin(i * 3.3) * 0.05;
                    sh.castShadow = sh.receiveShadow = true;
                    g.add(sh);
                }
                const top = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.25), new THREE.MeshToonMaterial({ map: it.stamped ? texDocStamped : texDoc }));
                top.rotation.x = -Math.PI / 2;
                top.rotation.z = -Math.sin((n - 1) * 3.3) * 0.05;
                top.position.set(Math.sin((n - 1) * 2.1) * 0.005, 0.0036 + (n - 1) * 0.004 + 0.0002, Math.cos((n - 1) * 1.7) * 0.005);
                g.add(top);
                break;
            }
            case 'pen': {
                const b = W.cyl(0.008, 0.008, 0.13, 0x1e1e2a, 0.01, 0.01, 0, g, 10); b.rotation.z = Math.PI / 2;
                const cap = W.cyl(0.009, 0.009, 0.04, 0xd4af37, 0.06, 0.01, 0, g, 10); cap.rotation.z = Math.PI / 2;
                const nib = W.cyl(0.0, 0.008, 0.025, 0xc0c0c8, -0.068, 0.01, 0, g, 10); nib.rotation.z = -Math.PI / 2;
                break;
            }
            case 'stamp':
                W.box(0.07, 0.025, 0.06, 0x8a2c2c, 0, 0.0125, 0, g);
                W.box(0.066, 0.005, 0.056, 0xd23a3a, 0, 0.0025, 0, g);
                W.cyl(0.012, 0.016, 0.05, 0x7b4a28, 0, 0.05, 0, g, 10);
                W.sph(0.022, 0x7b4a28, 0, 0.085, 0, g, 10);
                break;
            case 'fruit': {
                const v = it.variant || 0;
                if (v === 0) { W.sph(0.038, 0xd8322f, 0, 0.038, 0, g, 12); W.cyl(0.003, 0.003, 0.02, 0x5a3a1a, 0, 0.08, 0, g, 5); W.sph(0.01, 0x48a83a, 0.01, 0.083, 0, g, 6).scale.set(1.4, 0.4, 0.8); }
                else if (v === 1) { W.sph(0.04, 0xff9a1f, 0, 0.04, 0, g, 12); W.sph(0.006, 0x48a83a, 0, 0.08, 0, g, 6); }
                else { const p = W.sph(0.036, 0xb8d43a, 0, 0.042, 0, g, 12); p.scale.set(1, 1.25, 1); W.cyl(0.003, 0.003, 0.02, 0x5a3a1a, 0, 0.095, 0, g, 5); }
                break;
            }
            case 'sugar':
                W.box(0.16, 0.12, 0.14, 0xf6f6f2, 0, 0.06, 0, g);
                W.box(0.162, 0.035, 0.142, 0x3d7bff, 0, 0.07, 0, g);
                W.box(0.12, 0.03, 0.1, 0xeeeeea, 0, 0.13, 0, g);
                if (it.charges < 2) g.children[0].scale.y = 0.75;
                break;
            case 'jug': {
                const j = it.jug || { state: 'empty' };
                W.cyl(0.075, 0.08, 0.16, glass(0xbfe8ff, 0.35), 0, 0.08, 0, g, 18).castShadow = false;
                W.cyl(0.04, 0.06, 0.03, glass(0xbfe8ff, 0.35), 0, 0.17, 0, g, 18).castShadow = false;
                const handle = W.box(0.015, 0.09, 0.02, glass(0xbfe8ff, 0.5), 0.085, 0.1, 0, g); handle.castShadow = false;
                if (j.state !== 'empty') {
                    const lvl = 0.035 * Math.max(1, j.servings || 4);
                    W.cyl(0.07, 0.074, lvl, j.state === 'ready' ? 0xd9a03a : 0x8a4b6b, 0, lvl / 2 + 0.004, 0, g, 18);
                    W.cyl(0.045, 0.045, 0.02, 0xb33a3a, 0, 0.19, 0, g, 14);
                    if (j.state === 'fermenting') for (let i = 0; i < 5; i++) W.sph(0.008, 0xd9b8d0, Math.sin(i * 2) * 0.04, lvl - 0.01 + (i % 2) * 0.006, Math.cos(i * 2) * 0.04, g, 6);
                }
                break;
            }
            case 'spoon': {
                const h = W.box(0.13, 0.006, 0.016, 0xc8ccd6, 0.025, 0.006, 0, g); h.rotation.z = 0.05;
                const bowl = W.sph(0.024, 0xd8dce6, -0.06, 0.008, 0, g, 12); bowl.scale.set(1.3, 0.35, 0.9);
                break;
            }
            case 'grinder':
                W.cyl(0.04, 0.045, 0.1, 0x6b4a2a, 0, 0.05, 0, g, 14);
                W.cyl(0.042, 0.042, 0.04, 0x8a6a4a, 0, 0.12, 0, g, 14);
                W.sph(0.022, 0x6b4a2a, 0, 0.15, 0, g, 10);
                W.cyl(0.044, 0.044, 0.01, 0xc0c0c8, 0, 0.1, 0, g, 14);
                break;
            case 'rubble': {
                const rnd = k => Math.abs(Math.sin(it.uid * 12.9 + k * 78.2)) ;
                for (let i = 0; i < 6; i++) {
                    const c = W.box(0.04 + rnd(i) * 0.04, 0.03 + rnd(i + 9) * 0.04, 0.04 + rnd(i + 3) * 0.04,
                        i % 2 ? 0x8e8a84 : 0x6f6b66, (rnd(i + 1) - 0.5) * 0.11, 0.02 + (i > 3 ? 0.035 : 0), (rnd(i + 2) - 0.5) * 0.11, g);
                    c.rotation.set(rnd(i + 4), rnd(i + 5) * 3, rnd(i + 6));
                }
                break;
            }
            case 'ball':
                W.sph(0.035, 0x3ecf6e, 0, 0.035, 0, g, 14);
                W.box(0.071, 0.006, 0.006, 0xffffff, 0, 0.035, 0, g);
                break;
            case 'glue':
                W.cyl(0.018, 0.02, 0.07, 0xf6f6f2, 0, 0.035, 0, g, 10).rotation.z = Math.PI / 2;
                W.cyl(0.006, 0.012, 0.025, 0xe84a3a, 0.045, 0.035, 0, g, 8).rotation.z = -Math.PI / 2;
                break;
            case 'keybow': case 'keyshaft': case 'keybit': case 'fakekey': {
                const wood = 0xc8964a, full = it.type === 'fakekey';
                if (full || it.type === 'keybow') { const r = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 16), W.mat(wood)); r.rotation.x = Math.PI / 2; r.position.set(full ? -0.06 : 0, 0.01, 0); g.add(r); }
                if (full || it.type === 'keyshaft') W.box(full ? 0.09 : 0.07, 0.012, 0.012, wood, full ? 0 : 0, 0.008, 0, g);
                if (full || it.type === 'keybit') { W.box(0.02, 0.012, 0.03, wood, full ? 0.05 : 0, 0.008, 0.01, g); W.box(0.01, 0.012, 0.02, wood, full ? 0.035 : -0.015, 0.008, 0.015, g); }
                break;
            }
            case 'cigar': {
                const n = Math.max(1, it.count);
                for (let i = 0; i < n; i++) {
                    const c = W.cyl(0.011, 0.012, 0.11, 0x6b3f1f, 0, 0.012 + Math.floor(i / 3) * 0.022, -0.025 + (i % 3) * 0.025, g, 10);
                    c.rotation.z = Math.PI / 2;
                    const band = W.cyl(0.0125, 0.0125, 0.015, 0xd4af37, -0.03, c.position.y, c.position.z, g, 10);
                    band.rotation.z = Math.PI / 2;
                }
                break;
            }
            case 'cards': {
                const n = Math.max(1, it.count);
                for (let i = 0; i < n; i++) {
                    W.box(0.06, 0.02, 0.09, 0xb3261e, 0, 0.01 + i * 0.021, 0, g);
                    W.box(0.05, 0.002, 0.08, 0xf4f0e8, 0, 0.021 + i * 0.021, 0, g);
                }
                break;
            }
            case 'photo':
                W.box(0.045, 0.002, 0.08, 0xf4f0e8, 0, 0.001, 0, g);
                for (let i = 0; i < 3; i++) W.box(0.035, 0.002, 0.02, 0x5a6a86, 0, 0.0025, -0.025 + i * 0.025, g);
                break;
            case 'fakeid': {
                const n = Math.max(1, it.count);
                for (let i = 0; i < n; i++) {
                    W.box(0.085, 0.003, 0.055, 0xdfe9f5, 0, 0.002 + i * 0.004, 0, g);
                    W.box(0.025, 0.002, 0.03, 0x8a6a4a, -0.025, 0.004 + i * 0.004, 0, g);
                    W.box(0.035, 0.002, 0.006, 0x2b3fa8, 0.015, 0.004 + i * 0.004, -0.01, g);
                }
                break;
            }
            case 'wine':
                W.cyl(0.028, 0.03, 0.12, glass(0x4a0f1f, 0.8), 0, 0.06, 0, g, 12).castShadow = false;
                W.cyl(0.01, 0.016, 0.05, glass(0x4a0f1f, 0.8), 0, 0.145, 0, g, 10).castShadow = false;
                W.cyl(0.011, 0.011, 0.02, 0xb33a3a, 0, 0.175, 0, g, 8);
                W.box(0.055, 0.04, 0.004, 0xf3e3c3, 0, 0.06, 0.029, g);
                break;
            case 'bottle':
            case 'hooch': {
                const full = it.type === 'hooch';
                W.cyl(0.03, 0.032, 0.11, glass(full ? 0x9b5a1a : 0x6fbf73, full ? 0.55 : 0.45), 0, 0.055, 0, g, 12).castShadow = false;
                W.cyl(0.012, 0.018, 0.045, glass(full ? 0x9b5a1a : 0x6fbf73, 0.5), 0, 0.132, 0, g, 10).castShadow = false;
                if (full) {
                    W.cyl(0.026, 0.028, 0.085, 0xe0a030, 0, 0.046, 0, g, 12);
                    W.cyl(0.011, 0.011, 0.02, 0xb98a5a, 0, 0.162, 0, g, 8);
                    W.box(0.062, 0.035, 0.005, 0xfff4d6, 0, 0.06, 0.031, g);
                }
                break;
            }
        }
        // tier marker: a small coloured star sticker on better goods / ingredients
        if (it.tier) {
            const col = new THREE.Color(PB.TIERS[it.tier].col).getHex(), top = new THREE.Box3().setFromObject(g).max.y;
            for (let i = 0; i < it.tier; i++) W.box(0.014, 0.004, 0.014, W.mat(col, { emissive: col, emissiveIntensity: 0.4 }), -0.018 + i * 0.018, top + 0.002, 0, g).castShadow = false;
        }
        g.userData.item = it;
        return g;
    }

    // ---------- Instances ----------
    I.create = (type, props = {}) => {
        if (!geo) initShared();
        const d = PB.ITEMS[type];
        const it = Object.assign({ uid: I.uid++, type, quality: 50, count: 1, charges: d.charges || 0, surface: null, gx: 0, gy: 0, rot: 0, tier: 0 }, props);
        if (type === 'jug' && !it.jug) it.jug = { state: 'empty', quality: 0, nights: 0, servings: 0 };
        if (type === 'fruit' && it.variant == null) it.variant = PB.randi(0, 2);
        it.mesh = build(it);
        I.list.push(it);
        return it;
    };

    I.rebuild = it => {
        const old = it.mesh, nm = build(it);
        nm.position.copy(old.position); nm.rotation.copy(old.rotation); nm.scale.copy(old.scale);
        if (old.parent) { const p = old.parent; p.remove(old); p.add(nm); }
        it.mesh = nm;
    };

    I.fp = (it, rot = it.rot) => {
        const d = PB.ITEMS[it.type];
        return rot % 2 ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
    };

    I.onSurface = id => I.list.filter(i => i.surface === id);

    I.canPlace = (it, sid, gx, gy, rot) => {
        const s = W.surfaces[sid], f = I.fp(it, rot);
        if (gx < 0 || gy < 0 || gx + f.w > s.cols || gy + f.h > s.rows) return false;
        for (const o of I.list) {
            if (o === it || o.surface !== sid) continue;
            const of = I.fp(o);
            if (gx < o.gx + of.w && gx + f.w > o.gx && gy < o.gy + of.h && gy + f.h > o.gy) return false;
        }
        return true;
    };

    I.place = (it, sid, gx, gy, rot) => {
        it.surface = sid; it.gx = gx; it.gy = gy; it.rot = rot;
        const f = I.fp(it);
        it.mesh.position.set((gx + f.w / 2) * C, 0, (gy + f.h / 2) * C);
        it.mesh.rotation.set(0, rot ? -Math.PI / 2 : 0, 0);
        it.mesh.scale.setScalar(1);
        W.surfaces[sid].group.add(it.mesh);
    };

    I.detach = it => {
        it.surface = null;
        if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
    };

    I.destroy = it => {
        I.detach(it);
        const k = I.list.indexOf(it);
        if (k >= 0) I.list.splice(k, 1);
        PB.Player.forget(it);
        it.flying = false;
    };

    I.findFree = (it, sid) => {
        const s = W.surfaces[sid];
        for (const rot of [0, 1]) {
            for (let gy = 0; gy < s.rows; gy++) {
                for (let gx = 0; gx < s.cols; gx++) {
                    if (I.canPlace(it, sid, gx, gy, rot)) return { gx, gy, rot };
                }
            }
        }
        return null;
    };

    I.placeFree = (it, sids) => {
        for (const sid of sids) {
            const p = I.findFree(it, sid);
            if (p) { I.place(it, sid, p.gx, p.gy, p.rot); return true; }
        }
        return false;
    };

    I.spawn = (type, sids, props) => {
        const it = I.create(type, props);
        if (I.placeFree(it, sids)) return it;
        I.destroy(it);
        return null;
    };

    // Adds a crafted product, merging with a matching stack on that cell's desk when possible.
    I.addProduct = (type, q, extra = {}, cell = '') => {
        const d = PB.ITEMS[type], desk = cell + 'desk';
        if (d.stack) {
            const g = PB.gradeOf(q).g;
            const st = I.list.find(o => o.type === type && o.surface === desk && o.count < d.stack &&
                PB.gradeOf(o.quality).g === g && !!o.stamped === !!extra.stamped && (o.tier || 0) === (extra.tier || 0));
            if (st) {
                st.quality = (st.quality * st.count + q) / (st.count + 1);
                st.count++;
                I.rebuild(st);
                return st;
            }
        }
        return I.spawn(type, [desk, cell + 'floor'], Object.assign({ quality: q }, extra));
    };

    // ---------- Stacking ----------
    // Same product, same grade letter, same stamp, and the result fits in one stack.
    I.canMerge = (a, b) => {
        const d = PB.ITEMS[a.type];
        return !!(a && b && a !== b && d.stack && a.type === b.type && !!a.stamped === !!b.stamped && (a.tier || 0) === (b.tier || 0) &&
            PB.gradeOf(a.quality).g === PB.gradeOf(b.quality).g && a.count + b.count <= d.stack);
    };
    I.merge = (a, into) => {
        into.quality = (into.quality * into.count + a.quality * a.count) / (into.count + a.count);
        into.count += a.count;
        I.rebuild(into);
        I.destroy(a);
    };
    // Takes one off a stack; returns the new single item (not placed anywhere yet).
    I.split = it => {
        if (!PB.ITEMS[it.type].stack || it.count < 2) return null;
        it.count--;
        I.rebuild(it);
        return I.create(it.type, { quality: it.quality, stamped: it.stamped, count: 1, tier: it.tier || 0 });
    };

    I.consume = (it, n = 1) => {
        it.charges -= n;
        if (it.charges <= 0) I.destroy(it);
        else I.rebuild(it);
    };

    I.isContraband = it => PB.ITEMS[it.type].contraband || (it.type === 'jug' && it.jug.state !== 'empty');
    I.isHidden = it => !!it.surface && W.surfaces[it.surface].hidden();
    // What a guard looking into one cell can see (the tunnel shelf counts if that cell's poster is up)
    I.visibleContraband = cell => I.list.filter(i => {
        if (!i.surface || !I.isContraband(i) || W.surfaces[i.surface].hidden()) return false;
        const c = W.cellOf(i.surface);
        if (c !== 'hole') return c === cell;
        const t = W.tunnelById(i.surface);
        return (t.a === cell || t.b === cell) && W.posterOf(cell, t.side).lifted;
    });

    I.value = (it, mult = 1) => {
        const d = PB.ITEMS[it.type];
        if (!d.sell) return 0;
        return Math.round(d.sell * PB.gradeOf(it.quality).mult * it.count * (it.stamped ? 1.4 : 1) * PB.tierValue(it.tier) * mult);
    };

    I.name = it => {
        const d = PB.ITEMS[it.type];
        let s = (it.tier ? PB.TIERS[it.tier].name + ' ' : '') + d.name;
        if (it.type === 'document' && it.stamped) s = 'Stamped Papers';
        if (it.type === 'jug' && it.jug.state !== 'empty') s += it.jug.state === 'ready' ? ` (${it.jug.kind === 'wine' ? 'wine' : 'hooch'} ×${it.jug.servings})` : ` (${it.jug.kind === 'wine' ? 'wine, ' : ''}fermenting)`;
        return s;
    };

    I.label = it => {
        const d = PB.ITEMS[it.type];
        let s = I.name(it);
        if (d.stack && it.count > 1) s += ` ×${it.count}`;
        if (d.product) s += ` [${PB.gradeOf(it.quality).g}]`;
        if (d.charges) s += ` (${it.charges} left)`;
        return s;
    };

    // Shrinks an item away (used when guards confiscate it).
    I.confiscate = it => {
        const m = it.mesh;
        if (m.parent) { W.scene.attach(m); I.anims.push({ m, t: 0 }); }
        PB.Player.forget(it);
        const k = I.list.indexOf(it);
        if (k >= 0) I.list.splice(k, 1);
        it.surface = null;
    };

    I.update = dt => {
        for (let i = I.anims.length - 1; i >= 0; i--) {
            const a = I.anims[i];
            a.t += dt * 2.2;
            a.m.scale.setScalar(Math.max(0.001, 1 - a.t));
            a.m.position.y += dt * 0.3;
            if (a.t >= 1) { W.scene.remove(a.m); I.anims.splice(i, 1); }
        }
    };

    I.clearAll = () => {
        I.list.slice().forEach(it => I.destroy(it));
    };

    I.serialize = it => ({
        type: it.type, quality: it.quality, count: it.count, charges: it.charges,
        surface: it.surface, gx: it.gx, gy: it.gy, rot: it.rot,
        jug: it.jug, variant: it.variant, stamped: it.stamped, tier: it.tier || 0
    });

    I.restore = data => {
        const props = Object.assign({}, data);
        delete props.surface; delete props.gx; delete props.gy; delete props.rot;
        const it = I.create(data.type, props);
        if (data.surface && W.surfaces[data.surface] && I.canPlace(it, data.surface, data.gx, data.gy, data.rot)) I.place(it, data.surface, data.gx, data.gy, data.rot);
        else if (!I.placeFree(it, ['floor', 'desk', 'shelf'])) I.destroy(it);
        return it;
    };

    return I;
})();
