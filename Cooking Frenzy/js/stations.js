'use strict';
// Fixed kitchen equipment: burner knobs, oven, fryer, sink, cutting boards, plate/bowl stacks, trash, the pantry
// (a bin for every raw ingredient, see CF.PANTRY) and deliveries. state is host-owned and replicated.
// promptFor() builds the [E]/[F] hint and local action.
CF.Stations = (() => {
    const S = {};
    // stock = what is in the pantry bins, incoming = bought and still on the truck
    S.state = { burners: [0, 0, 0, 0], ovenOn: false, ovenOpen: false, fryerOn: false, plates: 6, bowls: 4, open: false, stock: {}, incoming: {} };
    const deliveries = [];   // host: { t, items }
    const tmp = new THREE.Vector3();
    const act = a => CF.Sync.act(a);
    S.dirtyState = true;
    const changed = () => { S.dirtyState = true; };
    let skipTopUp = false, wareIdx = 0;

    S.reset = () => {
        Object.assign(S.state, { burners: [0, 0, 0, 0], ovenOn: false, ovenOpen: false, fryerOn: false, open: false, incoming: {} });
        deliveries.length = 0;
        changed();
    };

    // ---------- pantry stock (host) ----------
    const capOf = t => CF.PANTRY[t] ? CF.PANTRY[t].cap : 0;
    // a new restaurant gets the starting stock, a saved one what was left in its bins
    S.initStock = saved => {
        const st = {};
        for (const t in CF.PANTRY) st[t] = saved && saved[t] !== undefined ? CF.clamp(saved[t] | 0, 0, capOf(t)) : CF.PANTRY[t].start;
        S.state.stock = st;
        skipTopUp = !saved;          // day 1 of a new restaurant already got its stock
        changed();
    };
    function addStock(t, n) {
        const st = S.state.stock, before = st[t] || 0;
        st[t] = Math.min(capOf(t), before + n);
        changed();
        return st[t] - before;
    }
    // the free morning delivery of basics
    function topUp() {
        const got = [];
        for (const t in CF.PANTRY) { const n = addStock(t, CF.PANTRY[t].daily); if (n) got.push(CF.ITEMS[t].icon + '×' + n); }
        return got;
    }
    // can this item go back into its bin? only whole, fresh, clean, unseasoned ingredients
    S.returnable = it => !!(it && CF.PANTRY[it.type] && !it.s.dirty && !it.contents.length && CF.Items.cook(it) < 0.06
        && (it.s.q === undefined || it.s.q >= 0.999) && !(it.s.salt > 0.05) && !(it.s.pepper > 0.05));
    S.room = t => Math.max(0, capOf(t) - (S.state.stock[t] || 0) - (S.state.incoming[t] || 0));
    // closing time: whole fresh ingredients lying around go back into their bins instead of being thrown out
    S.returnLeftovers = () => {
        let n = 0;
        for (const it of CF.Items.all()) {
            if (it.container || it.heldBy !== null || !S.returnable(it) || (S.state.stock[it.type] || 0) >= capOf(it.type)) continue;
            CF.Items.remove(it.id); addStock(it.type, 1); n++;
        }
        return n;
    };

    // Starting kitchen (host): cookware, spices, extinguishers; the pantry gets its morning delivery
    S.setupKitchen = () => {
        const Z = CF.World.zones, CH = CF.World.CH, I = CF.Items, W = Z.ware;
        I.spawn('pan', { x: Z.burners[0].x, y: CH + 0.05, z: Z.burners[0].z });
        I.spawn('pan', { x: Z.burners[1].x, y: CH + 0.05, z: Z.burners[1].z });
        I.spawn('pot', { x: Z.burners[3].x, y: CH + 0.13, z: Z.burners[3].z });
        I.spawn('pan', { x: W[0].x, y: CH + 0.05, z: W[0].z });
        I.spawn('pot', { x: W[1].x, y: CH + 0.13, z: W[1].z });
        I.spawn('basket', { x: 1.15, y: CH - 0.05, z: -4.69 });
        I.spawn('salt', { x: Z.spices[0].x, y: Z.spices[0].y + 0.02, z: Z.spices[0].z });
        I.spawn('pepper', { x: Z.spices[1].x, y: Z.spices[1].y + 0.02, z: Z.spices[1].z });
        I.spawn('salt', { x: 0.9, y: CH + 0.07, z: 0.9 });
        I.spawn('pepper', { x: 1.1, y: CH + 0.07, z: 0.9 });
        for (const p of Z.extSpots) I.spawn('ext', { x: p.x, y: p.y + 0.02, z: p.z });
        wareIdx = 2;
        if (skipTopUp) skipTopUp = false;
        else {
            const got = topUp();
            if (got.length) CF.Sync.broadcastToast('🚚 Morning delivery put away in the pantry: ' + got.join(' '), 'info');
        }
        changed();
    };

    // ---------- host: actions ----------
    S.handle = (pid, a, P) => {
        const I = CF.Items, st = S.state, held = I.heldBy(pid);
        switch (a.t) {
            case 'knob': {
                const i = a.i | 0; if (i < 0 || i > 3) return true;
                st.burners[i] = (st.burners[i] + (a.dir < 0 ? 3 : 1)) % 4; changed();
                CF.Sync.onFx('knob', CF.World.zones.burners[i].knob.position, 'knob');
                return true;
            }
            case 'ovenDoor': st.ovenOpen = !st.ovenOpen; CF.Phys.setOvenDoor(st.ovenOpen); CF.World.ovenDoorOpen = st.ovenOpen; changed(); CF.Sync.onFx('door', { x: 0.25, y: 0.5, z: -4.3 }, 'door'); return true;
            case 'ovenKnob': st.ovenOn = !st.ovenOn; changed(); CF.Sync.onFx('knob', { x: 0.25, y: 0.83, z: -4.3 }, 'knob'); return true;
            case 'fryer': st.fryerOn = !st.fryerOn; changed(); CF.Sync.onFx('knob', { x: 1.15, y: 0.8, z: -4.3 }, 'knob'); return true;
            case 'fill': {
                if (held && held.type === 'pot' && !held.s.water && !held.s.soup) { held.s.water = 1; I.touch(held); I.refresh(held); I.layout(held); CF.Sync.onFx('fill', I.worldPos(held), 'splash'); }
                return true;
            }
            case 'take': {
                const kind = a.k === 'bowls' ? 'bowls' : 'plates';
                if (st[kind] <= 0) { CF.Sync.toastTo(pid, kind === 'plates' ? 'No clean plates left! Wash dirty ones at the sink.' : 'No clean bowls left!', 'bad'); return true; }
                if (held) I.release(held, null);
                st[kind]--; changed();
                const p = P.hold ? { x: P.hold[0], y: P.hold[1], z: P.hold[2] } : { x: CF.World.zones[kind].x, y: CF.World.CH + 0.3, z: CF.World.zones[kind].z };
                const it = I.spawn(kind === 'plates' ? 'plate' : 'bowl', p);
                I.grab(pid, it.id);
                CF.Sync.onFx('clink', p, 'clink');
                return true;
            }
            case 'trashHeld': {
                if (!held) return true;
                trash(held, true);
                return true;
            }
            case 'pantryTake': {
                const t = a.k; if (!CF.PANTRY[t]) return true;
                if (held) return true;
                if ((st.stock[t] || 0) <= 0) { CF.Sync.toastTo(pid, `No ${CF.plural(t)} left. Order more at the terminal by the back door.`, 'bad'); return true; }
                st.stock[t]--; changed();
                const B = CF.World.pantry[t];
                const p = P.hold ? { x: P.hold[0], y: P.hold[1], z: P.hold[2] } : { x: B.x, y: B.y + 0.25, z: B.z };
                const it = I.spawn(t, p, { yaw: Math.random() * 6 });
                I.grab(pid, it.id);
                CF.Sync.onFx('pantry', { x: B.x, y: B.y + 0.1, z: B.z }, 'grab');
                return true;
            }
            case 'pantryPut': {
                if (!held || !S.returnable(held)) return true;
                const t = held.type;
                if ((st.stock[t] || 0) >= capOf(t)) { CF.Sync.toastTo(pid, `The ${CF.ITEMS[t].name.toLowerCase()} bin is full.`, 'bad'); return true; }
                const B = CF.World.pantry[t];
                I.remove(held.id);
                addStock(t, 1);
                CF.Sync.onFx('pantry', { x: B.x, y: B.y + 0.1, z: B.z }, 'drop');
                return true;
            }
            case 'ladle': {
                const pot = I.get(a.id); if (!pot || !pot.s.soup || !held || held.type !== 'bowl' || held.s.dirty || held.contents.length) return true;
                const q = (pot.s.sq || 1) * CF.clamp(0.6 + pot.s.stir * 0.5, 0, 1);
                I.spawn('soup', I.worldPos(held), { into: held, s: { c: [pot.s.sc, 0], salt: pot.s.ss, q } });
                pot.s.soup--; if (!pot.s.soup) { pot.s.water = 0; pot.s.sc = 0; pot.s.ss = 0; }
                I.touch(pot); I.refresh(pot);
                CF.Sync.onFx('ladle', I.worldPos(pot), 'splash');
                return true;
            }
            // ----- minigame results -----
            case 'chop': {
                const it = I.get(a.id); if (!it || !it.def.chop || it.heldBy !== null) return true;
                const q = CF.clamp(+a.q || 0, 0, 1);
                const pos = I.worldPos(it).clone(), ch = it.def.chop;
                const types = Array.isArray(ch.to) ? ch.to.slice() : Array(ch.n).fill(ch.to);
                if (CF.Sync.skill(pid, 'mise') && !Array.isArray(ch.to)) types.push(ch.to);
                const dirty = it.s.dirty;
                I.remove(it.id);
                types.forEach((t, k) => {
                    const a2 = (k / types.length) * Math.PI * 2;
                    I.spawn(t, { x: pos.x + Math.cos(a2) * 0.05 * (types.length > 1 ? 1 : 0), y: pos.y + 0.03 + k * 0.02, z: pos.z + Math.sin(a2) * 0.05 * (types.length > 1 ? 1 : 0) }, { s: { q, dirty, c: [0, 0] }, yaw: Math.random() * 6 });
                });
                CF.Sync.onFx('chop', pos, 'chop');
                CF.Sync.xp(pid, 4 + q * 4);
                return true;
            }
            case 'flatten': {
                const it = I.get(a.id); if (!it || it.type !== 'dough' || it.heldBy !== null) return true;
                const pos = I.worldPos(it).clone();
                I.remove(it.id);
                I.spawn('pizza_base', { x: pos.x, y: pos.y + 0.02, z: pos.z }, { s: { q: 1 } });
                CF.Sync.onFx('flatten', pos, 'thud');
                CF.Sync.xp(pid, 4);
                return true;
            }
            case 'flip': {
                const pan = I.get(a.id); if (!pan || pan.type !== 'pan') return true;
                const foods = pan.contents.map(id => I.get(id)).filter(f => f && f.def.sides);
                if (a.r === 'good') { foods.forEach(f => { f.s.up = 1 - f.s.up; I.touch(f); I.refresh(f); }); CF.Sync.xp(pid, 4); CF.Sync.onFx('flip', I.worldPos(pan), 'flip'); }
                else if (a.r === 'wild' && foods.length) {
                    const f = foods[0];
                    const dir = Math.random() * Math.PI * 2;
                    I.detach(f, { x: Math.cos(dir) * 2.2, y: 3.4, z: Math.sin(dir) * 2.2 });
                    f.s.up = 1 - f.s.up; I.refresh(f);
                    CF.Sync.onFx('whoosh', I.worldPos(pan), 'whoosh');
                }
                return true;
            }
            case 'stir': {
                const pot = I.get(a.id); if (!pot || pot.type !== 'pot') return true;
                const q = CF.clamp(+a.q || 0, 0, 1);
                pot.s.stir = Math.min(1, pot.s.stir + 0.35 + 0.65 * q);
                if (a.spill && pot.s.soup) { pot.s.sq = (pot.s.sq || 1) * 0.92; CF.Sync.onFx('splash', I.worldPos(pot), 'splash'); }
                I.touch(pot);
                CF.Sync.xp(pid, 3);
                return true;
            }
            case 'season': {
                const tgt = I.get(a.id); if (!tgt) return true;
                const key = a.tool === 'pepper' ? 'pepper' : 'salt', amt = CF.clamp(+a.amt || 0, 0, 3);
                if (tgt.type === 'pot' && tgt.s.soup) { if (key === 'salt') tgt.s.ss = (tgt.s.ss || 0) + amt; I.touch(tgt); }
                else if (tgt.def.cont && !tgt.def.food) {
                    const foods = I.deep(tgt).filter(f => f.def.food);
                    if (tgt.type === 'pot' && !foods.length) { tgt.s[key] = (tgt.s[key] || 0) + amt; I.touch(tgt); }
                    foods.forEach(f => { f.s[key] = (f.s[key] || 0) + amt; I.touch(f); });
                } else if (tgt.def.food) { tgt.s[key] = (tgt.s[key] || 0) + amt; I.touch(tgt); }
                CF.Sync.xp(pid, 2);
                return true;
            }
            case 'wash': {
                const d = I.get(a.id); if (!d || !d.def.dish || !d.s.dirty) return true;
                for (const id of d.contents.slice()) I.remove(id);
                d.s.dirty = 0; I.touch(d); I.refresh(d);
                CF.Sync.onFx('wash', I.worldPos(d), 'pop');
                CF.Sync.xp(pid, 4);
                if (CF.Orders.state.stats) CF.Orders.state.stats.washed++;
                return true;
            }
            case 'buy': return buy(pid, a.cart || {}), true;
        }
        return false;
    };

    function trash(it, keepContainer) {
        const I = CF.Items;
        const pos = I.worldPos(it).clone();
        if (it.def.cont && !it.def.food) {
            for (const id of it.contents.slice()) I.remove(id);
            if (it.type === 'pot') { it.s.water = 0; it.s.soup = 0; it.s.sc = 0; it.s.ss = 0; it.s.salt = 0; I.refresh(it); }
            it.s.salt = 0; it.s.pepper = 0;
            I.touch(it);
            if (!keepContainer && it.body) { it.body.position.set(-1.2, 1.2, 4.0); it.body.velocity.set(0, 2, -1.5); }
        } else I.remove(it.id);
        CF.Sync.onFx('trash', pos, 'thud');
    }

    // Buying: ingredients go into their pantry bins when the truck arrives (never more than fits),
    // plates and bowls onto their stacks, cookware and tools onto the table by the back door
    function buy(pid, cart) {
        const O = CF.Orders, items = [], st = S.state, cut = [];
        let cost = 0;
        for (const k in cart) {
            let n = CF.clamp(cart[k] | 0, 0, 30);
            if (!n || CF.PRICE[k] === undefined) continue;
            if (CF.PANTRY[k]) { const room = S.room(k); if (n > room) { cut.push(CF.plural(k)); n = room; } }
            if (!n) continue;
            cost += CF.PRICE[k] * n;
            for (let i = 0; i < n; i++) items.push(k);
        }
        if (cut.length) CF.Sync.toastTo(pid, `The pantry has no room for more ${cut.join(', ')}.`, 'bad');
        if (!items.length) return;
        if (cost > O.state.money) { CF.Sync.toastTo(pid, 'Not enough money!', 'bad'); return; }
        O.spend(cost, 'ingredients');
        for (const k of items) if (CF.PANTRY[k]) st.incoming[k] = (st.incoming[k] || 0) + 1;
        changed();
        const t = CF.Orders.has('express') ? 4 : 12;
        deliveries.push({ t, items });
        CF.Sync.broadcastToast(`🚚 Order placed (${CF.money(cost)}). It arrives in ${t}s.`, 'info');
    }
    // a new morning: anything still on the truck is put away too (it was paid for)
    S.flushDeliveries = () => { while (deliveries.length) deliver(deliveries.shift(), true); };
    function deliver(d, quiet) {
        const I = CF.Items, Z = CF.World.zones, st = S.state, CH = CF.World.CH, got = [];
        const count = {};
        for (const t of d.items) count[t] = (count[t] || 0) + 1;
        for (const t in count) {
            const n = count[t];
            if (t === 'plate') st.plates += n;
            else if (t === 'bowl') st.bowls += n;
            else if (CF.PANTRY[t]) {
                st.incoming[t] = Math.max(0, (st.incoming[t] || 0) - n);
                const put = addStock(t, n);
                if (put) got.push(CF.ITEMS[t].icon + '×' + put);
            } else {
                for (let i = 0; i < n; i++) {
                    const w = Z.ware[wareIdx++ % Z.ware.length];
                    I.spawn(t, { x: w.x + CF.rand(-0.05, 0.05), y: CH + 0.35 + i * 0.12, z: w.z + CF.rand(-0.05, 0.05) }, { yaw: Math.random() * 6 });
                }
                got.push(CF.ITEMS[t].icon + '×' + n);
            }
        }
        changed();
        if (quiet) return;
        CF.Sync.onFx('truck', Z.delivery, 'truck');
        CF.Sync.broadcastToast('📦 Delivery put away: ' + got.join(' '), 'good');
    }

    // ---------- host: per-tick ----------
    S.update = (dt) => {
        const I = CF.Items, Z = CF.World.zones, st = S.state;
        for (let k = deliveries.length - 1; k >= 0; k--) {
            const d = deliveries[k];
            d.t -= dt;
            if (d.t > 0) continue;
            deliveries.splice(k, 1);
            deliver(d);
        }
        // dropped into the trash bin / clean empty dishes returned to their stack / fresh ingredients back in their bin
        for (const it of I.all()) {
            if (it.container || it.heldBy !== null || it.removed) continue;
            const p = it.mesh.position;
            if (CF.World.inZone(Z.trash, p)) { trash(it, false); continue; }
            const B = CF.World.pantry[it.type];
            if (B && it.age > 0.6 && CF.World.inZone(B.zone, p) && S.returnable(it) && (st.stock[it.type] || 0) < capOf(it.type)) {
                I.remove(it.id); addStock(it.type, 1);
                CF.Sync.onFx('pantry', { x: B.x, y: B.y + 0.1, z: B.z }, 'drop');
                continue;
            }
            if ((it.type === 'plate' || it.type === 'bowl') && !it.s.dirty && !it.contents.length && it.age > 1) {
                const z = it.type === 'plate' ? Z.plates : Z.bowls;
                const dx = p.x - z.x, dz = p.z - z.z;
                if (dx * dx + dz * dz < 0.04 && p.y < z.y + 0.5 && p.y > z.y - 0.05) { I.remove(it.id); st[it.type + 's']++; changed(); }
            }
        }
    };

    // ---------- visuals (everyone) ----------
    let shownPlates = -1, shownBowls = -1;
    S.visuals = (dt) => {
        const st = S.state, Z = CF.World.zones;
        Z.burners.forEach((b, i) => {
            const lv = st.burners[i];
            b.knob.rotation.y = CF.damp(b.knob.rotation.y, -lv * 1.2, 12, dt);
            b.flame.material.opacity = lv ? 0.55 + Math.random() * 0.25 : 0;
            const s = lv ? 0.8 + lv * 0.15 : 1; b.flame.scale.set(s, s, 1);
        });
        const want = st.ovenOpen ? Math.PI / 2 - 0.05 : 0;
        CF.World.oven.doorPivot.rotation.x = CF.damp(CF.World.oven.doorPivot.rotation.x, want, 10, dt);
        CF.World.ovenDoorOpen = st.ovenOpen;
        const fsw = CF.World.fryer.sw.material;
        fsw.color.set(st.fryerOn ? 0xff5a3c : 0x29d37a).convertSRGBToLinear(); fsw.emissive.set(st.fryerOn ? 0x551100 : 0x000000).convertSRGBToLinear();
        if (st.plates !== shownPlates) { shownPlates = st.plates; stack(CF.World.plateStack, 'plate', Math.min(st.plates, 12), 0.018); }
        if (st.bowls !== shownBowls) { shownBowls = st.bowls; stack(CF.World.bowlStack, 'bowl', Math.min(st.bowls, 8), 0.035); }
        if (S._sign !== st.open) { S._sign = st.open; CF.World.setSign(st.open); }
        if (CF.World.sinkWater.visible) { S._sinkT = (S._sinkT || 0) - dt; if (S._sinkT <= 0) CF.World.sinkWater.visible = false; }
        // pantry bins: labels + the ingredients on show
        const stock = st.stock || {};
        for (const t in CF.PANTRY) {
            const n = stock[t] || 0;
            if (shownStock[t] !== n) { shownStock[t] = n; CF.World.drawPantryLabel(t, n); }
        }
    };
    const shownStock = {};
    // local: take one ingredient out of its bin (click or E)
    S.takeFromPantry = t => { if (CF.PANTRY[t]) act({ t: 'pantryTake', k: t }); };
    S.runSink = t => { CF.World.sinkWater.visible = true; S._sinkT = t || 1.5; };
    function stack(group, type, n, h) {
        while (group.children.length) group.remove(group.children[0]);
        for (let i = 0; i < n; i++) {
            const m = CF.Models.item(type);
            m.position.y = (type === 'plate' ? 0.014 : 0.04) + i * h;
            m.rotation.y = i * 0.7;
            group.add(m);
        }
    }

    // ---------- prompts (client side: what E / F does for what you look at) ----------
    // target: { kind:'item', id } | { kind:'st', sid, part } | { kind:'cust', idx }
    S.promptFor = (target, held) => {
        const I = CF.Items, st = S.state, out = {};
        // F: tools
        if (held && held.def.tool === 'ext') out.f = { text: 'Hold F to spray', hold: 'spray' };
        if (held && (held.def.tool === 'salt' || held.def.tool === 'pepper') && target && target.kind === 'item') {
            const t = I.get(target.id);
            const tgt = t && (t.container ? (I.get(t.container).def.food ? I.get(t.container) : t) : t);
            if (tgt && tgt !== held && (tgt.def.food || (tgt.def.cont && (I.deep(tgt).length || (tgt.type === 'pot' && (tgt.s.soup || tgt.s.water)))))) {
                out.f = { text: `${held.def.tool === 'salt' ? 'Salt' : 'Pepper'} the ${tgt.def.name.toLowerCase()}`, run: () => CF.MG.start('season', { tool: held.def.tool, id: tgt.id, cur: tgt.s[held.def.tool] || 0, name: tgt.def.name }) };
            }
        }
        if (held && !out.f) out.f = { text: 'Trash it? Drop it in the blue bin', none: true };
        if (!target) return out;

        if (target.kind === 'cust') return Object.assign(out, CF.Orders.promptCustomer(target.idx, held));
        if (target.kind === 'st') {
            const sid = target.sid;
            if (sid.startsWith('burner')) { const i = +sid.slice(6); out.e = { text: `Burner ${['OFF', 'LOW', 'MED', 'HIGH'][st.burners[i]]} → ${['OFF', 'LOW', 'MED', 'HIGH'][(st.burners[i] + 1) % 4]}`, run: () => act({ t: 'knob', i }) }; }
            else if (sid === 'oven') out.e = target.part === 'door' ? { text: st.ovenOpen ? 'Close oven' : 'Open oven', run: () => act({ t: 'ovenDoor' }) } : { text: st.ovenOn ? 'Turn oven OFF' : 'Turn oven ON', run: () => act({ t: 'ovenKnob' }) };
            else if (sid === 'fryer') out.e = { text: st.fryerOn ? 'Fryer OFF' : 'Fryer ON', run: () => act({ t: 'fryer' }) };
            else if (sid === 'sink') {
                if (held && held.type === 'pot' && !held.s.water && !held.s.soup) out.e = { text: 'Fill pot with water', run: () => { act({ t: 'fill' }); S.runSink(1.2); } };
                else if (held && held.def.dish && held.s.dirty) out.e = { text: 'Wash ' + held.def.name.toLowerCase(), run: () => CF.MG.start('wash', { id: held.id }) };
                else { const d = dishInSink(); out.e = d ? { text: 'Wash dishes in the sink', run: () => CF.MG.start('wash', { id: d.id }) } : { text: 'Bring dirty dishes here', none: true }; }
            }
            else if (sid.startsWith('board')) {
                const f = foodOnBoard(+sid.slice(5));
                if (f) out.e = chopPrompt(f);
                else out.e = { text: 'Put food on the board to cut it', none: true };
            }
            else if (sid === 'plates') out.e = { text: `Take a plate (${st.plates} left)`, run: () => act({ t: 'take', k: 'plates' }) };
            else if (sid === 'bowls') out.e = { text: `Take a bowl (${st.bowls} left)`, run: () => act({ t: 'take', k: 'bowls' }) };
            else if (sid === 'terminal') out.e = { text: 'Order ingredients', run: () => CF.UI.openShop() };
            else if (sid === 'bell') out.e = { text: CF.Orders.passCount() ? 'Ring the bell (runner serves the pass)' : 'Put plates on the pass, then ring', run: () => act({ t: 'bell' }) };
            else if (sid === 'sign') out.e = st.open ? { text: 'Restaurant is open', none: true } : { text: 'OPEN the restaurant!', run: () => act({ t: 'open' }) };
            else if (sid === 'trash') out.e = held ? { text: held.def.cont && !held.def.food ? 'Empty it into the trash' : 'Throw it away', run: () => act({ t: 'trashHeld' }) } : { text: 'Trash bin', none: true };
            else if (sid === 'dirty') out.e = { text: 'Dirty dishes come back here', none: true };
            else if (sid === 'pantry') {
                const t = target.part, def = CF.ITEMS[t], n = (st.stock || {})[t] || 0, name = def.name.toLowerCase();
                out.info = `${def.icon} ${def.name} · ${n} / ${CF.PANTRY[t].cap} in the bin${st.incoming && st.incoming[t] ? ` · ${st.incoming[t]} on the way` : ''}`;
                if (held && held.type === t) {
                    if (!S.returnable(held)) out.e = { text: 'Only fresh, whole, clean ones go back', none: true };
                    else if (n >= CF.PANTRY[t].cap) out.e = { text: 'This bin is full', none: true };
                    else out.e = { text: `Put the ${name} back`, run: () => act({ t: 'pantryPut' }) };
                } else if (held) out.e = { text: 'Your hands are full', none: true };
                else if (n > 0) out.e = { text: `Take ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`, run: () => S.takeFromPantry(t) };
                else out.e = { text: `No ${CF.plural(t)} left: order more at the terminal`, none: true };
            }
            return out;
        }
        const it = I.get(target.id); if (!it) return out;
        // food on a board → chop
        const b = boardOf(it);
        if (b >= 0 && (it.def.chop || it.def.flatten) && !it.container) { out.e = chopPrompt(it); return out; }
        const cont = it.container ? I.get(it.container) : null;
        const pan = it.type === 'pan' ? it : (cont && cont.type === 'pan' ? cont : null);
        if (pan && pan.contents.some(id => { const f = I.get(id); return f && f.def.sides; })) { out.e = { text: 'Flip!', run: () => CF.MG.start('flip', { id: pan.id }) }; return out; }
        const pot = it.type === 'pot' ? it : (cont && cont.type === 'pot' ? cont : null);
        if (pot) {
            if (pot.s.soup && held && held.type === 'bowl' && !held.s.dirty && !held.contents.length) out.e = { text: 'Ladle soup into bowl', run: () => act({ t: 'ladle', id: pot.id }) };
            else if (pot.s.soup || pot.s.water) out.e = { text: pot.s.soup ? 'Stir the soup' : 'Stir', run: () => CF.MG.start('stir', { id: pot.id }) };
            return out;
        }
        if (it.def.dish && it.s.dirty && held && held.def.dish) return out;
        return out;
    };
    function chopPrompt(f) {
        if (f.def.flatten) return { text: 'Hold E to flatten the dough', hold: 'flatten', id: f.id };
        return { text: 'Cut the ' + f.def.name.toLowerCase(), run: () => CF.MG.start('chop', { id: f.id, type: f.type }) };
    }
    function boardOf(it) {
        const p = it.mesh.position;
        const bs = CF.World.zones.boards;
        for (let i = 0; i < bs.length; i++) if (CF.World.inZone(bs[i], p)) return i;
        return -1;
    }
    function foodOnBoard(i) {
        const z = CF.World.zones.boards[i];
        let best = null, bd = 9;
        for (const it of CF.Items.all()) {
            if (it.container || it.heldBy !== null || !(it.def.chop || it.def.flatten)) continue;
            if (!CF.World.inZone(z, it.mesh.position)) continue;
            const d = Math.abs(it.mesh.position.x - (z.min[0] + z.max[0]) / 2) + Math.abs(it.mesh.position.z - (z.min[2] + z.max[2]) / 2);
            if (d < bd) { bd = d; best = it; }
        }
        return best;
    }
    function dishInSink() {
        for (const it of CF.Items.all()) if (it.def.dish && it.s.dirty && !it.container && it.heldBy === null && CF.World.inZone(CF.World.zones.sink, it.mesh.position)) return it;
        return null;
    }
    S.foodOnBoard = foodOnBoard;

    S.pack = () => S.state;
    S.unpack = s => { Object.assign(S.state, s); CF.Phys.setOvenDoor(S.state.ovenOpen); };
    return S;
})();
