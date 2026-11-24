'use strict';
// The restaurant: shift timer, customers (dining room NPCs), orders, scoring, serving, money,
// rush events (critic, lunch rush, rat, inspector, grease, blackout), end of day and the save file.
CF.Orders = (() => {
    const O = {};
    const SHIFT = 480, PREP_AUTO = 90;
    const blank = () => ({
        phase: 'prep', day: 1, money: 150, time: SHIFT, prep: PREP_AUTO,
        unlocks: { burger: true, salad: true, steak: false, soup: false, pizza: false },
        upgrades: {}, best: 0,
        stats: null, event: null, nextEvent: 60, spawnT: 18, fail: null, closeT: 0
    });
    O.state = blank();
    O.customers = [];       // { id, seat, x, z, ry, st, col, path, pat, max, r, v, greeted, critic, bonus, eatT, dish }
    O.rat = null;
    let custId = 1;
    const seatsBusy = {};   // seat idx -> customer id | 'dish:<id>'
    const tmp = new THREE.Vector3();

    // greets / hand (dishes carried to a table yourself) / washed / cleared (tables) / fires feed the daily goals
    const newStats = () => ({ served: 0, stars: 0, earned: 0, tips: 0, spent: 0, fails: 0, broken: 0, fines: 0, bonus: 0, best: null, log: [], greets: 0, hand: 0, washed: 0, cleared: 0, fires: 0 });
    O.has = id => !!O.state.upgrades[id];

    // ---------- save ----------
    O.load = () => {
        try { const s = JSON.parse(localStorage.getItem('cf-save')); if (s) return s; } catch (e) {}
        return null;
    };
    O.save = () => {
        const s = O.state;
        try { localStorage.setItem('cf-save', JSON.stringify({ day: s.day, money: s.money, unlocks: s.unlocks, upgrades: s.upgrades, best: s.best, stock: CF.Stations.state.stock })); } catch (e) {}
    };
    O.newGame = (fromSave) => {
        const s = O.state = blank();
        const sv = fromSave ? O.load() : null;
        if (sv) Object.assign(s, { day: sv.day, money: sv.money, unlocks: Object.assign(s.unlocks, sv.unlocks), upgrades: sv.upgrades || {}, best: sv.best || 0 });
        s.stats = newStats();
        // saves from before the pantry have no stock: they start with the new-restaurant stock
        CF.Stations.initStock(sv ? (sv.stock || null) : null);
    };
    O.hasSave = () => !!O.load();

    // ---------- day flow (host) ----------
    O.startDay = () => {
        const s = O.state;
        s.phase = 'prep'; s.time = SHIFT; s.prep = PREP_AUTO; s.event = null; s.nextEvent = 55 + Math.random() * 20; s.spawnT = 12; s.fail = null; s.closeT = 0;
        s.stats = newStats();
        for (const c of O.customers) removeCustomerMesh(c);
        O.customers = []; O.rat = null;
        for (const k in seatsBusy) delete seatsBusy[k];
        CF.Items.clear(); CF.Cook.reset(); CF.Stations.flushDeliveries(); CF.Stations.reset();
        CF.Stations.state.plates = 6 + (s.upgrades.morePlates || 0); CF.Stations.state.bowls = 4;
        CF.Stations.setupKitchen();
        CF.World.setBlackout(false); CF.World.grease.visible = false; CF.World.inspector.visible = false;
        CF.Goals.startDay();
        CF.Sync.broadcastToast(`☀️ Day ${s.day}: prep your station, then flip the sign to OPEN.`, 'info');
        CF.Sync.fullSync();
    };
    O.open = () => {
        const s = O.state; if (s.phase !== 'prep') return;
        s.phase = 'open'; CF.Stations.state.open = true; CF.Stations.dirtyState = true;
        CF.Sync.onFx('open', { x: 6.9, y: 1.7, z: -2.2 }, 'event');
        CF.Sync.broadcastToast('🔔 We are OPEN! Customers incoming!', 'good');
    };
    O.fireDisaster = () => {
        const s = O.state; if (s.phase !== 'open' && s.phase !== 'closing') return;
        s.fail = 'fire'; s.stats.fines += 50; s.money -= 50;
        CF.Sync.onFx('alarm', { x: 0, y: 1.5, z: 0 }, 'alarm');
        endDay();
    };
    function endDay() {
        const s = O.state;
        s.phase = 'summary';
        CF.Stations.state.open = false; CF.Stations.dirtyState = true;
        CF.World.setBlackout(false); CF.World.grease.visible = false; CF.World.inspector.visible = false;
        s.event = null; O.rat = null;
        const st = s.stats;
        st.rating = st.served + st.fails ? st.stars / (st.served + st.fails) : 0;
        CF.Goals.endDay();
        CF.Stations.flushDeliveries();          // paid-for food still on the truck goes into the bins (and the save)
        const back = CF.Stations.returnLeftovers();
        if (back) CF.Sync.broadcastToast(`🧺 ${back} unused ingredient${back > 1 ? 's' : ''} went back into the pantry.`, 'info');
        s.best = Math.max(s.best || 0, st.earned + st.tips);
        O.save();
        CF.Sync.endOfDay();
    }
    O.nextDay = () => {
        const s = O.state; if (s.phase !== 'summary') return;
        s.day++; O.save();
        O.startDay();
    };

    O.update = (dt) => {
        const s = O.state;
        if (s.phase === 'prep') {
            // the tutorial waits for you to flip the sign yourself
            if (!CF.Goals.holdPrep()) s.prep -= dt;
            if (s.prep <= 0) O.open();
        } else if (s.phase === 'open') {
            s.time -= dt;
            spawnCustomers(dt);
            events(dt);
            if (s.time <= 0) { s.phase = 'closing'; s.closeT = 75; CF.Sync.broadcastToast('🌙 Kitchen closing: finish the last orders!', 'info'); }
        } else if (s.phase === 'closing') {
            s.closeT -= dt;
            events(dt);
            const waiting = O.customers.some(c => c.st === 'walk' || c.st === 'wait');
            if (!waiting || s.closeT <= 0) {
                for (const c of O.customers) if (c.st === 'wait') failOrder(c);
                endDay();
            }
        }
        updateCustomers(dt);
        updateRat(dt);
        CF.Goals.update(dt);
    };

    // ---------- customers ----------
    function freeSeats() {
        const out = [];
        for (const seat of CF.World.seats) if (!seatsBusy[seat.idx]) out.push(seat);
        return out;
    }
    function spawnCustomers(dt) {
        const s = O.state;
        const n = Math.max(1, CF.Sync.playerCount());
        const prog = 1 - s.time / SHIFT;
        let interval = CF.lerp(48, 24, prog) / (1 + 0.3 * (n - 1)) / (O.has('marketing') ? 1.12 : 1);
        if (s.event && s.event.k === 'rush') interval /= 2.6;
        interval *= Math.max(0.75, 1 - (s.day - 1) * 0.03);
        s.spawnT -= dt;
        const active = O.customers.filter(c => c.st === 'walk' || c.st === 'wait').length;
        if (s.spawnT <= 0 && active < 3 + n * 2) {
            s.spawnT = interval * CF.rand(0.8, 1.2);
            addCustomer(false);
        }
    }
    function addCustomer(critic) {
        const s = O.state;
        const seats = freeSeats(); if (!seats.length) return null;
        const seat = CF.choice(seats);
        const keys = Object.keys(CF.RECIPES).filter(k => s.unlocks[k]);
        // the tutorial's first guest wants the burger you just made
        const tut = CF.Goals.tutorialActive() && !s.stats.served && !O.customers.length;
        const r = tut ? 'burger' : CF.choice(keys), rec = CF.RECIPES[r];
        const v = tut ? 'classic' : CF.choice(rec.vars).id;
        const ent = CF.World.entrance;
        const rowZ = seat.z + (seat.z <= 0 ? -1.5 : 1.5);
        const path = [[10.6, ent.z], [10.6, rowZ], [seat.x, rowZ], [seat.x, seat.z]];
        let max = rec.time * (O.has('patience') ? 1.25 : 1) * Math.max(0.7, 1 - (s.day - 1) * 0.03);
        if (critic) max *= 0.75;
        const c = { id: custId++, seat: seat.idx, x: ent.x, z: ent.z, ry: -Math.PI / 2, st: 'walk', col: critic ? 0xffd166 : new THREE.Color().setHSL(Math.random(), 0.6, 0.55).getHex(), path, pat: max, max, r, v, greeted: false, critic: !!critic, bonus: 0, eatT: 0, dish: 0 };
        seatsBusy[seat.idx] = c.id;
        O.customers.push(c);
        return c;
    }
    function failOrder(c) {
        const s = O.state;
        s.stats.fails++;
        s.stats.log.push({ r: c.r, stars: 0, fail: true });
        c.st = 'leave'; c.path = leavePath(c);
        CF.Sync.broadcastToast(`😠 Table ${CF.World.seats[c.seat].table + 1} gave up waiting for their ${CF.RECIPES[c.r].name}!`, 'bad');
        CF.Sync.onFx('fail', { x: c.x, y: 1.4, z: c.z }, 'fail');
        delete seatsBusy[c.seat];
    }
    function leavePath(c) {
        const seat = CF.World.seats[c.seat], ent = CF.World.entrance;
        const rowZ = seat.z + (seat.z <= 0 ? -1.5 : 1.5);
        return [[seat.x, rowZ], [10.6, rowZ], [10.6, ent.z], [ent.x, ent.z]];
    }
    function updateCustomers(dt) {
        for (let k = O.customers.length - 1; k >= 0; k--) {
            const c = O.customers[k];
            if (c.st === 'walk' || c.st === 'leave') {
                const tgt = c.path[0];
                if (!tgt) {
                    if (c.st === 'walk') { c.st = 'wait'; c.ry = CF.World.seats[c.seat].face; }
                    else { O.customers.splice(k, 1); removeCustomerMesh(c); }
                    continue;
                }
                const dx = tgt[0] - c.x, dz = tgt[1] - c.z, d = Math.hypot(dx, dz), sp = 1.5 * dt;
                if (d <= sp) { c.x = tgt[0]; c.z = tgt[1]; c.path.shift(); }
                else { c.x += dx / d * sp; c.z += dz / d * sp; c.ry = Math.atan2(dx, dz); }
            } else if (c.st === 'wait') {
                c.pat -= dt;
                if (c.pat <= 0) failOrder(c);
            } else if (c.st === 'eat') {
                c.eatT -= dt;
                if (c.eatT <= 0) finishMeal(c);
            }
        }
        // a seat stays blocked by the dirty dish until someone clears the table (or the busser comes by)
        for (const seat of CF.World.seats) {
            const b = seatsBusy[seat.idx];
            if (typeof b !== 'string') continue;
            const it = CF.Items.get(+b.slice(5));
            const tz = CF.World.tables[seat.table].zone;
            if (!it || it.heldBy !== null || !CF.World.inZone(tz, it.mesh.position)) delete seatsBusy[seat.idx];
            else if (it.s.busT !== undefined) {
                it.s.busT -= dt;
                if (it.s.busT <= 0) { delete it.s.busT; bus(it); delete seatsBusy[seat.idx]; }
            }
        }
    }
    const BUSSER_WAIT = 25;      // seconds before the busser clears a table nobody cleared
    function finishMeal(c) {
        const dish = CF.Items.get(c.dish);
        c.st = 'leave'; c.path = leavePath(c);
        if (dish && !dish.def.dish) {
            // food handed over without a plate: eaten, nothing to clear
            CF.Items.remove(dish.id);
            delete seatsBusy[c.seat];
        } else if (dish) {
            for (const id of dish.contents.slice()) CF.Items.remove(id);
            dish.s.dirty = 1; dish.s.bus = 1; dish.s.busT = BUSSER_WAIT;
            CF.Items.touch(dish); CF.Items.refresh(dish);
            seatsBusy[c.seat] = 'dish:' + dish.id;
        } else delete seatsBusy[c.seat];
        CF.Sync.onFx('leave', { x: c.x, y: 1.5, z: c.z }, c.happy ? 'star' : null);
    }
    // a table nobody cleared: the busser brings the dirty dish to the sink tray
    function bus(it) {
        const z = CF.World.zones.dirty;
        delete it.s.bus;
        if (it.body) { it.body.position.set(z.x + CF.rand(-0.12, 0.12), z.y + 0.1 + Math.random() * 0.2, z.z + CF.rand(-0.2, 0.2)); it.body.velocity.set(0, 0, 0); it.body.wakeUp(); }
        CF.Items.touch(it);
    }
    // grabbing a dirty dish off a table counts as clearing it
    O.onGrab = (pid, it) => {
        if (!it.s.bus) return;
        delete it.s.bus; delete it.s.busT;
        CF.Sync.xp(pid, 4);
        if (O.state.stats) O.state.stats.cleared++;
        if (CF.Sync.skill(pid, 'busser')) { O.earn(4, 'tips'); CF.Sync.toastTo(pid, '🧺 Table cleared +$4', 'good'); }
    };

    // ---------- scoring ----------
    function needsFor(order) {
        const rec = CF.RECIPES[order.r], v = rec.vars.find(x => x.id === order.v) || rec.vars[0];
        let need = rec.need.map(n => Object.assign({}, n));
        if (v.drop) need = need.filter(n => n.t !== v.drop);
        if (v.add) need.push(Object.assign({}, v.add));
        if (v.cook) { const n = need.find(x => x.cook); if (n) n.cook = v.cook; }
        return { rec, v, need, price: rec.price + (v.price || 0) };
    }
    O.needsFor = needsFor;
    const range = (val, r, slope) => val >= r[0] && val <= r[1] ? 1 : Math.max(0, 1 - (val < r[0] ? r[0] - val : val - r[1]) * slope);
    // dish = a plate / bowl, or any food handed over without one (that costs stars)
    O.score = (dish, order) => {
        const { rec, need, price } = needsFor(order);
        const foods = (dish.def.dish ? [] : [dish]).concat(CF.Items.deep(dish)).filter(f => f.def.food);
        const used = new Set(), notes = [];
        let total = 0, count = 0, missing = 0;
        for (const n of need) {
            for (let k = 0; k < (n.n || 1); k++) {
                const f = foods.find(x => x.type === n.t && !used.has(x));
                count++;
                if (!f) { missing++; notes.push('Missing ' + CF.ITEMS[n.t].name.toLowerCase()); continue; }
                used.add(f);
                let q = 1;
                const c = CF.Items.cook(f);
                if (n.cook) { const r = range(c, n.cook, 3.2); if (r < 0.95) notes.push(`${CF.ITEMS[n.t].name} ${c < n.cook[0] ? 'undercooked' : 'overcooked'}`); q *= r; }
                else if (n.raw && c > 0.25) { q *= 0.5; notes.push(CF.ITEMS[n.t].name + ' should be fresh'); }
                else if (c > 1.15) { q *= 0.25; notes.push(CF.ITEMS[n.t].name + ' burnt'); }
                if (f.def.sides && n.cook && Math.abs(f.s.c[0] - f.s.c[1]) > 0.28) { q *= 0.8; notes.push('Cooked on one side only'); }
                if (n.salt) { const r = range(f.s.salt || 0, n.salt, 0.7); if (r < 0.9) notes.push((f.s.salt || 0) < n.salt[0] ? 'Needs salt' : 'Too salty'); q *= Math.max(0.35, r); }
                else if ((f.s.salt || 0) > 1.8) { q *= 0.7; notes.push('Way too salty'); }
                if (n.pepper) { const r = range(f.s.pepper || 0, n.pepper, 0.7); if (r < 0.9) notes.push((f.s.pepper || 0) < n.pepper[0] ? 'Needs pepper' : 'Too peppery'); q *= Math.max(0.4, r); }
                q *= 0.65 + 0.35 * CF.clamp(f.s.q === undefined ? 1 : f.s.q, 0, 1);
                if (f.s.dirty) { q *= 0.1; notes.push('🤢 Dirty food!'); }
                total += q;
            }
        }
        let quality = count ? total / count : 0;
        quality *= Math.pow((count - missing) / Math.max(1, count), 1.2);
        let extras = 0;
        for (const f of foods) if (!used.has(f)) { extras += f.type === 'charcoal' || f.s.dirty ? 0.3 : 0.07; }
        if (extras) notes.push('Random extra stuff on the plate');
        quality -= Math.min(0.5, extras);
        if (!foods.length) notes.unshift('There is nothing on it!');
        if (!dish.def.dish) { quality -= 0.3; notes.unshift('Handed over without a plate!'); }
        else if (dish.type !== rec.dish) { quality -= 0.2; notes.push(`Should be served in a ${rec.dish}`); }
        if (order.r === 'burger') {
            const st = (dish.def.dish ? dish.contents.map(id => CF.Items.get(id)) : [dish]).filter(x => x && x.def.food);
            if (st.length && st[0].type === 'bun_bottom' && st[st.length - 1].type === 'bun_top') quality += 0.04; else { quality -= 0.1; notes.push('Burger stacked wrong'); }
        }
        const stars = CF.clamp(Math.round(quality * 10) / 2, 0, 5);
        return { stars, price, notes: Array.from(new Set(notes)).slice(0, 3) };
    };

    // ---------- serving ----------
    // pid = who carried it to the table (null = the runner from the pass)
    O.serve = (dish, c, pid) => {
        const s = O.state, st = s.stats;
        const res = O.score(dish, c);
        const byHand = pid !== null && pid !== undefined && !!CF.Sync.players[pid];
        let pay = res.stars >= 1 ? res.price * (0.3 + 0.7 * res.stars / 5) : 0;
        let tip = 0;
        if (res.stars >= 3.5) {
            tip = res.price * 0.3 * (0.4 + 0.6 * c.pat / c.max) * (O.has('marketing') ? 1.2 : 1);
            // carried to the table yourself: guests tip better than for the runner
            if (byHand) tip *= 1.25 * (CF.Sync.skill(pid, 'charmer') ? 1.3 : 1);
        }
        if (byHand) st.hand++;
        if (c.critic) { if (res.stars >= 4) { pay *= 3; st.bonus += pay * 2 / 3; } else { pay *= 0.5; } }
        pay += c.bonus;
        s.money += pay + tip;
        st.served++; st.stars += res.stars; st.earned += pay; st.tips += tip;
        st.log.push({ r: c.r, stars: res.stars, pay: Math.round(pay + tip) });
        if (!st.best || res.stars > st.best.stars) st.best = { r: c.r, stars: res.stars };
        // place the dish on the table in front of the guest
        const seat = CF.World.seats[c.seat];
        if (dish.heldBy !== null) CF.Items.release(dish, null);
        if (dish.container) CF.Items.detach(dish);
        if (dish.body) { dish.body.position.set(seat.plate.x, seat.plate.y + 0.02, seat.plate.z); dish.body.velocity.set(0, 0, 0); dish.body.angularVelocity.set(0, 0, 0); dish.body.quaternion.set(0, 0, 0, 1); }
        CF.Items.touch(dish);
        c.dish = dish.id; c.happy = res.stars >= 3.5;
        if (res.stars < 1) { c.st = 'eat'; c.eatT = 1.5; }
        else { c.st = 'eat'; c.eatT = 9 + Math.random() * 4; }
        // EXP: everyone for the team effort, a bit more for whoever carried it out
        for (const p of Object.values(CF.Sync.players)) CF.Sync.xp(p.pid, 2 + res.stars * 2.4 + (byHand && p.pid === pid ? 4 + res.stars * 1.5 : 0));
        CF.Sync.served({ cid: c.id, stars: res.stars, pay: Math.round(pay + tip), tip: Math.round(tip), notes: res.notes, r: c.r, critic: c.critic, by: pid, table: seat.table + 1, x: c.x, z: c.z });
        return res;
    };

    // the bell: an NPC runner takes every finished dish on the pass to the best-matching guest
    O.runner = () => {
        const Z = CF.World.zones;
        const dishes = CF.Items.all().filter(it => it.def.dish && !it.s.dirty && it.contents.length && !it.container && it.heldBy === null && CF.World.inZone(Z.pass, it.mesh.position));
        if (!dishes.length) { CF.Sync.broadcastToast('🛎️ Nothing on the pass to serve.', 'info'); return; }
        let served = 0;
        for (const d of dishes) {
            const c = bestCustomer(d);
            if (!c) continue;
            O.serve(d, c, null); served++;
        }
        if (!served) CF.Sync.broadcastToast('🛎️ No waiting guest ordered that.', 'bad');
    };
    function bestCustomer(dish) {
        let best = null, bs = -1;
        for (const c of O.customers) {
            if (c.st !== 'wait') continue;
            const sc = O.score(dish, c).stars - (c.pat / c.max) * 0.3;
            if (sc > bs) { bs = sc; best = c; }
        }
        return bs >= 0.5 ? best : null;
    }
    O.passCount = () => CF.Items.all().filter(it => it.def.dish && it.contents.length && !it.container && it.heldBy === null && CF.World.inZone(CF.World.zones.pass, it.mesh.position)).length;

    O.earn = (v, why) => { O.state.money += v; if (why === 'tips') O.state.stats.tips += v; };
    O.spend = (v, why) => { O.state.money -= v; if (O.state.stats) O.state.stats.spent += v; };

    // ---------- actions (host) ----------
    O.handle = (pid, a) => {
        const s = O.state, P = CF.Sync.players[pid];
        switch (a.t) {
            case 'open': O.open(); return true;
            case 'bell': CF.Sync.onFx('bell', { x: 6.45, y: 1.05, z: 1.4 }, 'ding'); O.runner(); return true;
            case 'greet': {
                const c = O.customers.find(x => x.id === a.cid); if (!c || c.st !== 'wait' || c.greeted) return true;
                c.greeted = true;
                c.pat = Math.min(c.max * 1.6, c.pat + c.max * (CF.Sync.skill(pid, 'greeter') ? 0.4 : 0.2));
                if (CF.Sync.skill(pid, 'upsell') && Math.random() < 0.6) { c.bonus += 5; CF.Sync.toastTo(pid, '💬 They ordered a drink too! +$5', 'good'); }
                CF.Sync.xp(pid, 3);
                s.stats.greets++;
                CF.Sync.onFx('greet', { x: c.x, y: 1.5, z: c.z }, 'pop');
                return true;
            }
            // hand a guest whatever you carry: a dish, or food without a plate. They judge it against their order.
            case 'serveTo': {
                const c = O.customers.find(x => x.id === a.cid), d = CF.Items.get(a.id);
                if (!c || c.st !== 'wait' || !d || d.heldBy !== pid) return true;
                if (!(d.def.dish ? !d.s.dirty : d.def.food && !d.def.liquid)) return true;
                c.greeted = true;
                O.serve(d, c, pid);
                return true;
            }
            case 'upgrade': {
                if (s.phase !== 'summary') return true;
                const u = CF.UPGRADES.find(x => x.id === a.id);
                if (!u || s.upgrades[u.id] || s.money < u.price) return true;
                s.money -= u.price; s.upgrades[u.id] = true; O.save();
                CF.Sync.broadcastToast(`${u.icon} Bought ${u.name}!`, 'good');
                CF.Sync.endOfDay();
                return true;
            }
            case 'unlock': {
                if (s.phase !== 'summary') return true;
                const r = CF.RECIPES[a.id];
                if (!r || s.unlocks[a.id] || s.money < r.cost) return true;
                s.money -= r.cost; s.unlocks[a.id] = true; O.save();
                CF.Sync.broadcastToast(`${r.icon} ${r.name} added to the menu!`, 'good');
                CF.Sync.endOfDay();
                return true;
            }
            case 'nextDay': if (pid === 0) O.nextDay(); return true;
        }
        return false;
    };

    // ---------- rush events ----------
    function events(dt) {
        const s = O.state;
        if (s.event) {
            s.event.t -= dt;
            const k = s.event.k;
            if (k === 'inspector' && s.event.t <= 0) inspect();
            if (k === 'rat' && !O.rat) s.event.t = Math.min(s.event.t, 0);
            if (s.event.t <= 0) {
                if (k === 'blackout') CF.World.setBlackout(false);
                if (k === 'grease') CF.World.grease.visible = false;
                if (k === 'inspector') CF.World.inspector.visible = false;
                s.event = null;
            }
            return;
        }
        if (s.phase !== 'open') return;
        s.nextEvent -= dt;
        if (s.nextEvent > 0) return;
        s.nextEvent = CF.rand(70, 110);
        const pool = ['critic', 'rush', 'rat', 'inspector', 'grease', 'blackout'];
        if (s.day === 1) pool.splice(pool.indexOf('blackout'), 1);
        const k = CF.choice(pool);
        startEvent(k);
    }
    function startEvent(k) {
        const s = O.state;
        const e = s.event = { k, t: { critic: 8, rush: 45, rat: 50, inspector: 30, grease: 40, blackout: 25 }[k] };
        if (k === 'critic') { if (!addCustomer(true)) { s.event = null; return; } }
        if (k === 'rat') spawnRat();
        if (k === 'inspector') { CF.World.inspector.visible = true; e.start = 1; }
        if (k === 'grease') CF.World.grease.visible = true;
        if (k === 'blackout') CF.World.setBlackout(true);
        const E = CF.EVENTS[k];
        CF.Sync.broadcastToast(`${E.icon} ${E.name}! ${E.desc}`, 'event');
        CF.Sync.onFx('event', { x: 0, y: 2, z: 0 }, 'event');
    }
    function inspect() {
        const s = O.state;
        let bad = 0;
        for (const it of CF.Items.all()) if (it.def.food && !it.container && it.mesh.position.y < 0.25) bad++;
        bad += Math.min(3, CF.Cook.fireCount());
        if (bad) {
            const fine = Math.min(90, bad * 15);
            s.money -= fine; s.stats.fines += fine;
            CF.Sync.broadcastToast(`📋 Inspector found ${bad} violation${bad > 1 ? 's' : ''} (food on the floor / fire). Fine: -$${fine}`, 'bad');
        } else {
            s.money += 40; s.stats.bonus += 40;
            CF.Sync.broadcastToast('📋 Spotless kitchen! Inspector bonus +$40', 'good');
        }
    }

    // ---------- the rat ----------
    function spawnRat() {
        const d = CF.World.zones.ratDoor;
        O.rat = { x: d.x, y: 0, z: d.z, ry: Math.PI, st: 'seek', target: 0, t: 0, carry: null };
    }
    function ratTarget() {
        const foods = CF.Items.all().filter(it => it.def.food && it.heldBy === null && it.type !== 'soup' && it.mesh.getWorldPosition(tmp).y < 1.3 && Math.abs(tmp.x) < 7 && Math.abs(tmp.z) < 5);
        return foods.length ? CF.choice(foods) : null;
    }
    function updateRat(dt) {
        const r = O.rat; if (!r) return;
        r.t += dt;
        // anything thrown fast enough at the rat scares it off
        if (r.st !== 'flee') for (const it of CF.Items.all()) {
            if (!it.body || it.heldBy !== null) continue;
            const v = it.body.velocity; if (v.x * v.x + v.y * v.y + v.z * v.z < 6) continue;
            const p = it.body.position;
            if (Math.abs(p.x - r.x) < 0.4 && Math.abs(p.z - r.z) < 0.4 && Math.abs(p.y - r.y) < 0.5) {
                r.st = 'flee'; r.carry = null;
                CF.Sync.onFx('rat', { x: r.x, y: r.y + 0.2, z: r.z }, 'squeak');
                if (it.thrownBy !== undefined) { CF.Sync.xp(it.thrownBy, 12, null); }
                O.earn(10, 'tips'); O.state.stats.bonus += 10;
                CF.Sync.broadcastToast('🐀 Bonk! The rat runs away. +$10', 'good');
                break;
            }
        }
        if (r.st === 'seek') {
            let t = CF.Items.get(r.target);
            if (!t || t.heldBy !== null) { t = ratTarget(); r.target = t ? t.id : 0; if (!t) { r.st = 'flee'; return; } }
            const tp = t.mesh.getWorldPosition(tmp);
            const dx = tp.x - r.x, dz = tp.z - r.z, d = Math.hypot(dx, dz);
            r.ry = Math.atan2(dx, dz);
            if (d > 0.25) { const sp = 1.9 * dt; r.x += dx / d * Math.min(sp, d); r.z += dz / d * Math.min(sp, d); r.y = CF.damp(r.y, 0, 8, dt); }
            else {
                r.y = CF.damp(r.y, tp.y - 0.05, 6, dt);
                if (Math.abs(r.y - (tp.y - 0.05)) < 0.08) {
                    r.carry = t.type; CF.Items.remove(t.id); r.st = 'flee';
                    CF.Sync.broadcastToast(`🐀 The rat stole a ${CF.ITEMS[r.carry].name.toLowerCase()}!`, 'bad');
                    CF.Sync.onFx('rat', { x: r.x, y: r.y, z: r.z }, 'squeak');
                }
            }
        } else if (r.st === 'flee') {
            const d0 = CF.World.zones.ratDoor;
            r.y = CF.damp(r.y, 0, 5, dt);
            const dx = d0.x - r.x, dz = d0.z - r.z, d = Math.hypot(dx, dz);
            r.ry = Math.atan2(dx, dz);
            if (d < 0.2) { O.rat = null; if (O.state.event && O.state.event.k === 'rat') O.state.event.t = 0; return; }
            const sp = 2.6 * dt; r.x += dx / d * Math.min(sp, d); r.z += dz / d * Math.min(sp, d);
        }
        if (r.t > 60) r.st = 'flee';
    }

    // ---------- network ----------
    O.pack = () => {
        const s = O.state;
        return {
            ph: s.phase, d: s.day, m: Math.round(s.money), ti: Math.round(s.time), pr: Math.round(s.prep), cl: Math.round(s.closeT),
            un: s.unlocks, up: s.upgrades, ev: s.event ? [s.event.k, Math.round(s.event.t)] : null, fail: s.fail,
            cu: O.customers.map(c => [c.id, c.seat, CF.r3(c.x), CF.r3(c.z), CF.r3(c.ry), c.st, c.col, c.r, c.v, Math.round(c.pat), Math.round(c.max), c.greeted ? 1 : 0, c.critic ? 1 : 0, c.happy === undefined ? -1 : c.happy ? 1 : 0]),
            rat: O.rat ? [CF.r3(O.rat.x), CF.r3(O.rat.y), CF.r3(O.rat.z), CF.r3(O.rat.ry), O.rat.carry] : null,
            gl: CF.Goals.pack()
        };
    };
    O.unpack = g => {
        const s = O.state;
        s.phase = g.ph; s.day = g.d; s.money = g.m; s.time = g.ti; s.prep = g.pr; s.closeT = g.cl; s.unlocks = g.un; s.upgrades = g.up; s.fail = g.fail;
        const prevEv = s.event && s.event.k;
        s.event = g.ev ? { k: g.ev[0], t: g.ev[1] } : null;
        const ev = s.event && s.event.k;
        if (prevEv !== ev) {
            CF.World.setBlackout(ev === 'blackout'); CF.World.grease.visible = ev === 'grease'; CF.World.inspector.visible = ev === 'inspector';
        }
        const seen = new Set();
        for (const a of g.cu) {
            seen.add(a[0]);
            let c = O.customers.find(x => x.id === a[0]);
            if (!c) { c = { id: a[0] }; O.customers.push(c); }
            Object.assign(c, { seat: a[1], tx: a[2], tz: a[3], ry: a[4], st: a[5], col: a[6], r: a[7], v: a[8], pat: a[9], max: a[10], greeted: !!a[11], critic: !!a[12], happy: a[13] === 1 ? true : a[13] === 0 ? false : undefined });
            if (c.x === undefined) { c.x = c.tx; c.z = c.tz; }
        }
        for (let k = O.customers.length - 1; k >= 0; k--) if (!seen.has(O.customers[k].id)) { removeCustomerMesh(O.customers[k]); O.customers.splice(k, 1); }
        if (g.rat) { if (!O.rat) O.rat = {}; Object.assign(O.rat, { tx: g.rat[0], ty: g.rat[1], tz: g.rat[2], ry: g.rat[3], carry: g.rat[4] }); if (O.rat.x === undefined) { O.rat.x = O.rat.tx; O.rat.y = O.rat.ty; O.rat.z = O.rat.tz; } }
        else O.rat = null;
        CF.Goals.unpack(g.gl);
    };

    // ---------- visuals (everyone): guests, order bubbles, the rat ----------
    let ratMesh = null, bubbleT = 0;
    function removeCustomerMesh(c) {
        if (!c.mesh) return;
        CF.World.scene.remove(c.mesh);
        const k = CF.World.pickables.indexOf(c.mesh); if (k >= 0) CF.World.pickables.splice(k, 1);
        c.mesh = null;
    }
    // Back to the main menu: remove every guest, the rat and the day's state
    O.clear = () => {
        for (const c of O.customers) removeCustomerMesh(c);
        O.customers = []; O.rat = null;
        for (const k in seatsBusy) delete seatsBusy[k];
        if (ratMesh) { CF.World.scene.remove(ratMesh); ratMesh = null; }
        O.state = blank();
        CF.Goals.reset();
    };
    function bubble(c) {
        const cv = c.bcv || (c.bcv = document.createElement('canvas'));
        cv.width = 128; cv.height = 128;
        const g = cv.getContext('2d');
        g.clearRect(0, 0, 128, 128);
        const frac = CF.clamp(c.pat / c.max, 0, 1);
        g.fillStyle = c.critic ? '#ffd166' : 'rgba(255,255,255,0.95)';
        g.beginPath(); g.arc(64, 60, 46, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(54, 100); g.lineTo(64, 122); g.lineTo(74, 100); g.fill();
        if (c.st === 'wait') {
            g.strokeStyle = frac > 0.5 ? '#46d17a' : frac > 0.25 ? '#ffb02e' : '#ff4d4d'; g.lineWidth = 9;
            g.beginPath(); g.arc(64, 60, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
        }
        g.font = '54px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(c.st === 'eat' ? (c.happy === false ? '😠' : '😋') : CF.RECIPES[c.r].icon, 64, 62);
        if (!c.btex) c.btex = new THREE.CanvasTexture(cv);
        c.btex.needsUpdate = true;
        return c.btex;
    }
    O.visuals = (dt) => {
        const host = CF.Sync.isHost;
        bubbleT += dt;
        const redraw = bubbleT > 0.25; if (redraw) bubbleT = 0;
        const eagle = CF.Profile.has('eagle');
        for (const c of O.customers) {
            if (!c.mesh) {
                c.mesh = CF.World.makeDiner(c.col, false, c.critic);
                c.mesh.userData.pick = { kind: 'cust', idx: c.id };
                c.mesh.traverse(m => { m.userData.pick = c.mesh.userData.pick; });
                const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubble(c), depthTest: false, transparent: true }));
                sp.scale.set(0.42, 0.42, 1); sp.position.y = 1.95; sp.renderOrder = 9;
                c.mesh.add(sp); c.sprite = sp;
                c.mesh.position.set(c.x, 0, c.z);
                CF.World.scene.add(c.mesh); CF.World.pickables.push(c.mesh);
            }
            if (!host && c.tx !== undefined) { c.x = CF.damp(c.x, c.tx, 10, dt); c.z = CF.damp(c.z, c.tz, 10, dt); }
            const sitting = c.st === 'wait' || c.st === 'eat';
            const A = c.mesh.userData.anim;
            if (A) { c.mesh.position.set(c.x, 0, c.z); A(c, dt); c.sprite.position.y = sitting ? 1.62 : 2.02; }
            else c.mesh.position.set(c.x, sitting ? -0.32 : Math.abs(Math.sin(performance.now() * 0.012)) * 0.05, c.z);
            c.mesh.rotation.y = c.ry;
            if (redraw) bubble(c);
            c.sprite.visible = c.st === 'wait' || c.st === 'eat';
            c.sprite.scale.setScalar(eagle && c.st === 'wait' ? 0.5 : 0.42);
        }
        const r = O.rat;
        if (r && !ratMesh) { ratMesh = CF.Models.rat(); CF.World.scene.add(ratMesh); }
        if (!r && ratMesh) { CF.World.scene.remove(ratMesh); ratMesh = null; }
        if (r && ratMesh) {
            if (!host && r.tx !== undefined) { r.x = CF.damp(r.x, r.tx, 12, dt); r.y = CF.damp(r.y, r.ty, 12, dt); r.z = CF.damp(r.z, r.tz, 12, dt); }
            ratMesh.position.set(r.x, r.y + Math.abs(Math.sin(performance.now() * 0.03)) * 0.02, r.z);
            ratMesh.rotation.y = r.ry;
            if (ratMesh.userData.anim) ratMesh.userData.anim(dt, r);
        }
        const ins = CF.World.inspector;
        if (ins.visible && ins.userData.anim) ins.userData.anim(null, dt);
        CF.Goals.visuals();
    };

    // ---------- prompts for guests (client) ----------
    O.promptCustomer = (cid, held) => {
        const c = O.customers.find(x => x.id === cid); if (!c) return {};
        const seat = CF.World.seats[c.seat], table = seat ? seat.table + 1 : '?';
        const rec = CF.RECIPES[c.r], v = rec.vars.find(x => x.id === c.v) || rec.vars[0];
        const info = `Table ${table} · wants ${rec.icon} ${rec.name}${rec.vars.length > 1 ? ' (' + v.label + ')' : ''}${c.critic ? ' · 🎩 CRITIC' : ''}${c.st === 'wait' && !c.greeted ? ' · not greeted yet' : ''}`;
        const serve = () => CF.Sync.act({ t: 'serveTo', cid: c.id, id: held.id });
        if (c.st === 'wait' && held) {
            // you can hand them anything: the closer it is to their order, the more stars and pay
            if (held.def.dish) {
                if (held.s.dirty) return { e: { text: 'That one is dirty: wash it first', none: true }, info };
                if (!held.contents.length) return { e: { text: `Give table ${table} an empty ${held.def.name.toLowerCase()}?! (0★)`, run: serve }, info };
                const sc = O.score(held, c).stars;
                return { e: { text: `Serve to table ${table}${sc < 2.5 ? ' (not what they ordered!)' : ''}`, run: serve }, info };
            }
            if (held.def.food && !held.def.liquid) return { e: { text: `Hand them the ${held.def.name.toLowerCase()} without a plate (fewer ★)`, run: serve }, info };
            if (!c.greeted) return { e: { text: `Greet table ${table} (they wait longer)`, run: () => CF.Sync.act({ t: 'greet', cid: c.id }) }, info };
            return { e: { text: 'They don\'t want that', none: true }, info };
        }
        if (c.st === 'wait' && !c.greeted) return { e: { text: `Greet table ${table} (they wait longer)`, run: () => CF.Sync.act({ t: 'greet', cid: c.id }) }, info };
        if (c.st === 'wait') return { e: { text: 'Waiting for: ' + rec.name, none: true }, info };
        if (c.st === 'eat') return { e: { text: 'Enjoying their meal', none: true }, info };
        return { info };
    };
    O.orderText = c => {
        const rec = CF.RECIPES[c.r], v = rec.vars.find(x => x.id === c.v) || rec.vars[0];
        return { rec, v, label: rec.vars.length > 1 ? v.label : '' };
    };
    return O;
})();
