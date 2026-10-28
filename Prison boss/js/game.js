'use strict';
// Game state, day/night cycle, economy, jobs, saving and the main loop.
PB.Game = (() => {
    const G = {};
    const SAVE = 'prisonbossPC_save_v1';
    const DAY_LEN = 420, NIGHT_LEN = 300;
    let last = 0, sleeping = false, pendingVictory = false;
    G.log = null;

    G.newState = () => ({
        day: 1, phase: 'day', time: 0, money: 40, rep: 0, heat: 0,
        upgrades: {}, quests: [], offers: [], stock: {},
        stats: { made: 0, sold: 0, earned: 0, caught: 0 },
        bossShown: false, searchWarned: false, qid: 1, tut: {}, wip: {}, tunnel: 0, lunchOpen: false,
        workshopOpen: false, event: null, escaped: false, keyWip: {},
        tiers: {}, buffs: {}, protection: false, uniqueDone: [], tunnelE: 0, tunnelW: 0,
        yardOpen: false, kitchenOpen: false
    });
    const LUNCH_FROM = DAY_LEN * 5 / 14, LUNCH_TO = DAY_LEN * 6.5 / 14; // 12:00 – 13:30
    const SHOP_FROM = DAY_LEN * 7 / 14, SHOP_TO = DAY_LEN * 9 / 14;     // workshop shift 14:00 – 16:00
    G.LUNCH_FROM = LUNCH_FROM;

    // Which cell a money/trade action belongs to: the guest's (while the host runs it) or yours
    G.actorCell = null;
    G.cellCtx = () => G.actorCell != null ? G.actorCell : PB.Player.cell;
    G.newLog = () => ({ day: PB.state.day, earned: 0, spent: 0, rep: 0, made: {}, lost: [], events: [] });

    G.clock = () => {
        const s = PB.state;
        let mins = s.phase === 'day' ? 7 * 60 + s.time / DAY_LEN * 14 * 60 : 22 * 60 + s.time / NIGHT_LEN * 8 * 60;
        mins = Math.floor(mins) % (24 * 60);
        const h = Math.floor(mins / 60), m = Math.floor((mins % 60) / 10) * 10;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    G.hint = (key, msg, dur = 7) => {
        const s = PB.state;
        if (s.tut[key]) return;
        s.tut[key] = true;
        PB.UI.toast('💡 ' + msg, '', dur);
    };

    // ---------- Save / load ----------
    G.hasSave = () => { try { return !!localStorage.getItem(SAVE); } catch (e) { return false; } };
    G.save = () => {
        if (!PB.state || PB.Coop.isGuest()) return; // a co-op guest never overwrites their own save with the host's world
        try {
            // items in the cellmate's hand are saved too (they land on the floor when loaded)
            // flying items and items in the cellmate's hand are saved too (they land on the floor when loaded)
            const items = PB.Items.list.filter(i => i.surface || i.heldBy || i.flying).map(PB.Items.serialize);
            const h = PB.Player.held;
            if (h) {
                const o = PB.Player.origin || {};
                items.push(Object.assign(PB.Items.serialize(h), { surface: o.sid || 'floor', gx: o.gx || 0, gy: o.gy || 0, rot: o.rot || 0 }));
            }
            if (PB.Player.held2) items.push(Object.assign(PB.Items.serialize(PB.Player.held2), { surface: null }));
            localStorage.setItem(SAVE, JSON.stringify({ state: PB.state, items }));
        } catch (e) { /* storage unavailable: play without saving */ }
    };

    function resetWorld() {
        PB.Mini.abort();
        PB.Lunch.abort();
        PB.Workshop.abort();
        PB.Yard.abort();
        PB.Kitchen.abort();
        PB.Phys.clear();
        PB.Player.reset();
        PB.Items.clearAll();
        PB.NPC.reset();
        PB.World.closeAll();
        PB.UI.clearBubbles();
    }

    function enterGame() {
        PB.UI.hideMenu();
        PB.Player.enabled = true;
        PB.Audio.init();
        PB.Player.lock();
        PB.UI.setLocked(PB.Player.locked || PB.Player.fallback);
        PB.UI.quests();
        PB.UI.hud();
    }

    G.newGame = () => {
        PB.state = G.newState();
        resetWorld();
        G.log = G.newLog();
        PB.Items.spawn('tobacco', ['desk'], { charges: 6 });
        PB.Items.spawn('rolling', ['desk'], { charges: 10 });
        PB.Items.spawn('ball', ['shelf']);   // wall-ball for both cells
        ['n_', 'e_', 'w_'].forEach(c => PB.Items.spawn('ball', [c + 'shelf']));
        G.restock();
        G.makeOffers(true);
        enterGame();
        G.beginDay();
        setTimeout(() => G.hint('start1', 'Welcome to Block C! Day is for trading: press <b>E</b> on <b>Vinnie</b> at your bars to buy, sell and take jobs.'), 1200);
        setTimeout(() => G.hint('start2', 'When you\'re done trading, sleep in your <b>bed</b>. At night you craft at the desk, but guards patrol!'), 9000);
    };

    G.continueGame = () => {
        let data;
        try { data = JSON.parse(localStorage.getItem(SAVE)); } catch (e) { data = null; }
        if (!data) { G.newGame(); return; }
        PB.state = Object.assign(G.newState(), data.state);
        resetWorld();
        G.log = G.newLog();
        data.items.forEach(d => PB.Items.restore(d));
        enterGame();
        PB.World.setDay(PB.state.day);
        if (PB.state.phase === 'day') PB.NPC.traderArrive();
        PB.NPC.patrolTimer = PB.NPC.patrolInterval();
        PB.Audio.setAmbient(PB.state.phase === 'night');
        PB.Music.setMode(PB.state.phase === 'night' ? 'night' : 'day');
        PB.UI.toast(`Welcome back. Day ${PB.state.day}.`);
    };

    G.resetWorld = resetWorld;
    G.enterGame = enterGame;

    G.toMenu = () => {
        if (PB.Coop.isGuest()) { PB.Coop.leave(); return; }
        if (PB.Coop.isHost()) PB.Coop.leave();
        PB.Player.enabled = false;
        PB.Mini.abort();
        PB.Lunch.abort();
        PB.Workshop.abort();
        PB.Yard.abort();
        PB.Kitchen.abort();
        G.save();
        PB.UI.closePanel(false);
        PB.Player.unlock();
        PB.Music.setMode(null);
        PB.UI.showMenu();
    };

    // ---------- Day / night ----------
    G.beginDay = () => {
        const s = PB.state;
        s.phase = 'day'; s.time = 0;
        PB.Coop.resetVotes();
        PB.World.setDay(s.day);
        PB.NPC.traderArrive();
        PB.NPC.customerTimer = PB.rand(15, 30);
        PB.Audio.play('bell');
        PB.Audio.setAmbient(false);
        PB.Music.setMode('day');
        PB.UI.toast(`☀️ Day ${s.day}`, 'rank', 3);
        PB.UI.quests();
        setTimeout(() => PB.Events.announce(), 1500);
        G.save();
    };

    G.beginNight = () => {
        const s = PB.state;
        s.phase = 'night'; s.time = 0;
        s.lunchOpen = false; s.workshopOpen = false; s.yardOpen = false; s.kitchenOpen = false;
        if (PB.Lunch.active) PB.Lunch.exit(true);
        if (PB.Workshop.active) PB.Workshop.exit(true);
        if (PB.Yard.active) PB.Yard.exit(true);
        if (PB.Kitchen.active) PB.Kitchen.exit(true);
        PB.Coop.resetVotes();
        PB.NPC.traderLeave();
        PB.NPC.customerLeave('Lights out. Gotta go!');
        PB.NPC.patrolTimer = PB.rand(15, 25);
        PB.Audio.play('bell');
        PB.Audio.setAmbient(true);
        PB.Music.setMode('night');
        PB.UI.toast('🌙 Lights out! Guards are patrolling.', 'rank', 3);
        setTimeout(() => G.hint('night', 'Night time: craft at the desk, but hide contraband in a <b>closed drawer</b> when you hear footsteps!'), 2500);
    };

    // force = both cellmates agreed (co-op)
    G.sleep = force => {
        if (sleeping) return;
        if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'sleep' }); return; }
        if (PB.Coop.isHost() && force !== true) { PB.Coop.voteSleep(0); return; }
        const s = PB.state;
        if (PB.NPC.guard.state) { PB.UI.toast('Not with a guard right outside!', 'bad'); return; }
        PB.Player.stashHeld();
        sleeping = true;
        PB.Coop.hostEvent({ t: 'fade' });
        document.getElementById('fade').classList.add('on');
        PB.Audio.play('sleep');
        setTimeout(() => {
            PB.NPC.reset();
            PB.UI.clearBubbles();
            if (s.phase === 'day' && s.time < LUNCH_FROM) {
                s.time = LUNCH_FROM; // a nap until the lunch bell
                PB.NPC.traderArrive();
                PB.UI.toast('😴 You napped until lunch.');
            } else if (s.phase === 'day') G.beginNight();
            else {
                if (NIGHT_LEN - s.time > 60) {
                    PB.World.CELLS.filter(PB.World.cellUsed).forEach(cell => {
                        const res = PB.NPC.check(cell);
                        res.crafting = false; res.guestCrafting = [];
                        if (res.found.length || res.lamp || res.tunnel) G.inspectionResult(res, true);
                    });
                }
                G.dawn();
            }
            setTimeout(() => { document.getElementById('fade').classList.remove('on'); sleeping = false; }, 350);
        }, 900);
    };

    G.dawn = () => {
        const s = PB.state, log = G.log;
        PB.Mini.abort();
        PB.Player.stashHeld();
        PB.NPC.reset();
        PB.UI.clearBubbles();

        PB.Items.list.forEach(it => {
            if (it.type === 'jug' && it.jug.state === 'fermenting' && --it.jug.nights <= 0) {
                it.jug.state = 'ready';
                PB.Items.rebuild(it);
                log.events.push('🍶 Your brew finished fermenting! Put it on the desk with empty bottles to bottle it.');
            }
        });

        if (s.heat >= 100) {
            const all = PB.Items.list.filter(i => PB.Items.isContraband(i));
            const taken = all.filter(() => Math.random() < 0.5);
            taken.forEach(it => { log.lost.push(PB.Items.label(it)); PB.Items.destroy(it); });
            PB.World.closeAll();
            G.addRep(-10);
            s.heat = 40;
            log.events.push(`🚨 <b>CELL SEARCH!</b> The guards tossed your cell at dawn and took ${taken.length} item${taken.length !== 1 ? 's' : ''}.`);
        } else s.heat = Math.max(0, s.heat - (15 + (s.upgrades.pillow ? 8 : 0) + (G.hasBuff('wellfed') ? 10 : 0)) * PB.Events.mult('heatDecay'));
        s.searchWarned = false;
        // status symbols pay out reputation every morning
        const daily = (s.upgrades.tv ? 6 : 0) + (s.upgrades.throne ? 12 : 0);
        if (daily) { G.addRep(daily); log.events.push(`📺 Your cell is the talk of the block: +${daily} rep.`); }
        // buffs wear off
        const buffs = Object.assign({}, s.buffs);
        for (const k in buffs) { if (--buffs[k] <= 0) { delete buffs[k]; log.events.push(`${G.BUFFS[k].icon} ${G.BUFFS[k].name} wore off.`); } }
        s.buffs = buffs;

        s.quests.forEach(q => q.days--);
        s.quests.filter(q => q.days <= 0).forEach(q => {
            G.addRep(-5);
            log.events.push(`❌ You failed ${q.giver ? q.giver + '\'s' : 'Vinnie\'s'} job (${G.questTitle(q)}). -5 rep.`);
        });
        s.quests = s.quests.filter(q => q.days > 0);
        G.makeOffers();
        // tomorrow's random event (decided now so the summary can tease it)
        const ev = PB.Events.roll();
        if (ev) log.events.push(`${ev.icon} <b>Tomorrow: ${ev.name}.</b> ${ev.desc}`);
        G.restock();
        PB.Tunnel.dawnGift(log);
        const rubble = PB.Items.list.filter(i => i.type === 'rubble').length;
        if (rubble) log.events.push(`🪨 You still have ${rubble} pile${rubble > 1 ? 's' : ''} of rubble lying around. Flush it before a guard sees it!`);

        PB.Coop.hostEvent({ t: 'summary', log });
        PB.UI.openSummary(log, () => {
            s.day++;
            G.log = G.newLog();
            G.beginDay();
        });
    };

    // ---------- Guards ----------
    G.inspectionResult = (res, asleep = false) => {
        const s = PB.state, log = G.log;
        if (res.crafting) { PB.Mini.abort(false); PB.UI.toast('The guard trashed your work in progress!', 'bad'); }
        if (res.guestCrafting.length) { PB.Coop.bust(res.guestCrafting); s.heat += 10 * res.guestCrafting.length; }
        if (res.tunnel) {
            const t = res.tunnel, W = PB.World, home = PB.Coop.homeCell();
            s[t.key] = 0;
            s.heat += 30;
            G.addRep(-10);
            W.posterOf(t.a, t.side).lifted = W.posterOf(t.b, t.side).lifted = false;
            // with the tunnel gone you could be stuck in someone else's cell, so the guards drag you home
            if (W.area === 'cell' && !W.connected(home, PB.Player.cell)) { PB.Player.spawnIn(home); PB.UI.toast('👮 The guards dragged you back to your own cell.', 'bad'); }
            PB.Audio.play('alert');
            const msg = '🚨 The guard found your TUNNEL! They filled it with concrete. Heat +30';
            if (asleep) log.events.push(msg); else PB.UI.toast(msg, 'bad', 6);
        }
        // a rookie guard sometimes overlooks things
        const sloppy = PB.Events.val('sloppy', 0);
        if (sloppy) res.found = res.found.filter(() => Math.random() > sloppy);
        if (res.found.length && s.protection) {
            s.protection = false;
            res.found = [];
            const msg = '🛡️ The guard saw your stuff... and looked the other way. Your protection deal is used up.';
            if (asleep) log.events.push(msg); else PB.UI.toast(msg, 'good', 6);
        }
        if (res.found.length) {
            const names = res.found.map(it => PB.Items.label(it));
            res.found.forEach(it => PB.Items.confiscate(it));
            log.lost.push(...names);
            const heat = Math.round((12 * res.found.length + (res.crafting ? 10 : 0)) * PB.Events.mult('heat'));
            s.heat += heat;
            G.addRep(-Math.min(20, 3 * res.found.length + (res.crafting ? 4 : 0)));
            s.stats.caught++;
            PB.Audio.play('caught');
            if (asleep) log.events.push('🚨 A guard checked your cell while you slept and found contraband!');
            else {
                PB.UI.toast(`🚨 Confiscated: ${names.join(', ')}`, 'bad', 5);
                PB.UI.toast(`Heat +${heat}`, 'bad');
            }
        } else if (res.crafting) {
            s.heat += 10;
            PB.UI.toast('🚨 Caught crafting! Heat +10', 'bad');
        }
        if (res.lamp) {
            PB.World.cells[res.cell].lamp.on = false;
            s.heat += 5;
            if (!asleep) PB.UI.toast('💡 The guard made you switch off your lamp. Heat +5', 'bad');
        }
        if (s.heat >= 100 && !s.searchWarned) {
            s.searchWarned = true;
            PB.UI.toast('⚠️ Heat is maxed! Expect a cell search tomorrow morning.', 'bad', 6);
        }
    };

    // ---------- Economy ----------
    G.traderMult = () => { const u = PB.state.upgrades; return 0.85 * (u.connections ? 1.15 : 1) * (u.fence ? 1.1 : 1); };
    // event multipliers for selling one product type (card tournament, heat wave...)
    G.sellMult = type => PB.Events.mult('sell') * PB.Events.mult('sell_' + type);
    G.itemValue = (it, mult = 1) => PB.Items.value(it, mult * G.sellMult(it.type));

    G.addMoney = n => {
        const s = PB.state;
        s.money += n;
        if (n > 0) { G.log.earned += n; s.stats.earned += n; } else G.log.spent -= n;
    };

    G.addRep = n => {
        const s = PB.state, before = PB.rankOf(s.rep);
        if (n > 0) n *= PB.Events.mult('rep') * (s.upgrades.chain ? 1.2 : 1) * (G.hasBuff('fame') ? 1.25 : 1);
        s.rep = Math.max(0, s.rep + n);
        G.log.rep += n;
        const after = PB.rankOf(s.rep);
        if (after > before) {
            PB.Audio.play('rank');
            PB.UI.toast(`⭐ RANK UP: ${PB.RANKS[after].name}!`, 'rank', 5);
            PB.UI.toast(`Unlocked: ${PB.RANKS[after].unlock}`, 'good', 6);
            if (after === PB.RANKS.length - 1 && !s.bossShown) { s.bossShown = true; pendingVictory = true; }
        }
    };

    G.restock = () => {
        const s = PB.state, rank = PB.rankOf(s.rep), boost = s.upgrades.connections ? 1.5 : 1;
        s.stock = {};
        for (const [type, d] of Object.entries(PB.ITEMS)) {
            if (!d.price) continue;
            const ok = rank >= d.rank || PB.Events.val('anyRank', 0);
            s.stock[type] = ok ? Math.ceil(PB.randi(d.stock[0], d.stock[1]) * boost * PB.Events.mult('stock')) : 0;
        }
    };

    G.buy = type => {
        const s = PB.state, d = PB.ITEMS[type];
        const price = G.price(type);
        if ((s.stock[type] || 0) <= 0 || s.money < price) return;
        const c = G.cellCtx();
        const it = PB.Items.spawn(type, [c + 'tray', c + 'floor'], { tier: G.tier(type) });
        if (!it) { PB.UI.toast('No room in the trade slot or on the floor!', 'bad'); return; }
        s.stock[type]--;
        G.addMoney(-price);
        PB.Audio.play('coin');
        PB.UI.toast(it.surface.endsWith('tray') ? `Bought ${d.name}. It's in the trade slot.` : `Trade slot full. Vinnie tossed the ${d.name} onto the floor.`);
        if (d.contraband) G.hint('hideBuy', 'Bought items marked <b>!</b> are contraband. Don\'t leave them lying around when guards pass.');
    };

    G.trayId = () => G.cellCtx() + 'tray';
    G.trayMatch = (type, minG) => PB.Items.onSurface(G.trayId()).filter(i => i.type === type && PB.gradeIdx(i.quality) >= minG);

    function takeFromTray(type, minG, n) {
        let taken = 0;
        for (const it of G.trayMatch(type, minG).sort((a, b) => a.quality - b.quality)) {
            if (taken >= n) break;
            const k = Math.min(n - taken, it.count);
            taken += k;
            if (k >= it.count) PB.Items.destroy(it);
            else { it.count -= k; PB.Items.rebuild(it); }
        }
        return taken;
    }

    G.sellItem = uid => {
        const it = PB.Items.list.find(i => i.uid === uid);
        if (!it || !it.surface || !it.surface.endsWith('tray') || !PB.ITEMS[it.type].product) return;
        const d = PB.ITEMS[it.type], v = G.itemValue(it, G.traderMult());
        G.addMoney(v);
        G.addRep(d.rep * PB.gradeOf(it.quality).mult * it.count * 0.5 * PB.tierValue(it.tier));
        PB.state.stats.sold += it.count;
        PB.Items.destroy(it);
        PB.Audio.play('cash');
        PB.UI.toast(`Sold for $${v}`, 'good');
    };
    G.sellAll = () => PB.Items.onSurface(G.trayId()).filter(i => PB.ITEMS[i.type].product).forEach(i => G.sellItem(i.uid));

    G.buyUpgrade = id => {
        const s = PB.state, u = PB.UPGRADES.find(x => x.id === id);
        if (!u || s.upgrades[id] || s.money < u.price || PB.rankOf(s.rep) < u.rank) return;
        G.addMoney(-u.price);
        s.upgrades[id] = true;
        PB.Audio.play('success');
        PB.UI.toast(`${u.icon} ${u.name} installed!`, 'good');
        if (id === 'safe') G.hint('safe', 'Your floor safe is under the desk. Press <b>E</b> on the floor plate to open it. Closed = invisible to guards (and dogs).', 7);
    };

    // ---------- Supplier tiers ("Upgrade" next to Buy) ----------
    G.tier = type => (PB.state.tiers && PB.state.tiers[type]) || 0;
    G.tierUpCost = type => { const t = G.tier(type); return t >= 3 ? null : PB.tierCost(type, t + 1); };
    G.canTierUp = type => {
        const s = PB.state, t = G.tier(type), cost = G.tierUpCost(type);
        return PB.TIERABLE.includes(type) && cost != null && s.money >= cost && PB.rankOf(s.rep) >= PB.TIER_RANK[t + 1];
    };
    G.upgradeTier = type => {
        const s = PB.state;
        if (!G.canTierUp(type)) return;
        const t = G.tier(type) + 1;
        G.addMoney(-G.tierUpCost(type));
        s.tiers = Object.assign({}, s.tiers, { [type]: t });
        PB.Audio.play('rank');
        PB.UI.toast(`${PB.ITEMS[type].icon} Vinnie now gets <b>${PB.TIERS[t].name} ${PB.TIERS[t].star}</b> ${PB.ITEMS[type].name}. Better quality, and your goods carry the tier!`, 'good', 6);
    };

    // ---------- Services (repeatable money sinks) ----------
    G.servicePrice = id => { const sv = PB.SERVICES.find(x => x.id === id); return sv ? Math.round(sv.price(PB.state)) : 0; };
    G.buyService = id => {
        const s = PB.state, sv = PB.SERVICES.find(x => x.id === id), price = G.servicePrice(id);
        if (!sv || s.money < price || PB.rankOf(s.rep) < sv.rank) return;
        if (id === 'protect' && s.protection) { PB.UI.toast('You already have a protection deal.', 'bad'); return; }
        if (id === 'warden' && !(PB.Events.current() && !PB.Events.current().good)) { PB.UI.toast('There\'s no bad event to cancel today.', 'bad'); return; }
        if (id === 'bribe' && s.heat <= 0) { PB.UI.toast('The guards don\'t care about you right now.', 'bad'); return; }
        G.addMoney(-price);
        PB.Audio.play('cash');
        if (id === 'bribe') { s.heat = Math.max(0, s.heat - 30); s.searchWarned = s.heat >= 100 && s.searchWarned; PB.UI.toast('💵 A guard pockets the cash. Heat -30.', 'good'); }
        else if (id === 'jobs') { s.offers.push(G.genQuest(false), G.genQuest(false)); PB.UI.toast('📜 Two new job offers!', 'good'); }
        else if (id === 'protect') { s.protection = true; PB.UI.toast('🛡️ Protection deal made. The next confiscation won\'t happen.', 'good'); }
        else if (id === 'warden') { const e = PB.Events.current(); s.event = null; PB.UI.toast(`🗞️ The warden suddenly forgot about "${e.name}".`, 'good', 5); }
        else if (id === 'party') { G.addRep(60); s.heat = Math.max(0, s.heat - 20); PB.Audio.play('cheer'); PB.UI.toast('🎉 The whole block is partying in your honour! +60 rep, heat -20', 'good', 5); }
    };

    // ---------- Buffs (from gym, kitchen, events...) ----------
    G.BUFFS = {
        strong:  { icon: '💪', name: 'Strong',    desc: 'Digging goes 50% faster.' },
        fame:    { icon: '🌟', name: 'Famous',    desc: '+25% reputation from everything.' },
        focused: { icon: '🧠', name: 'Focused',   desc: '+8 quality on everything you craft.' },
        wellfed: { icon: '🍲', name: 'Well fed',  desc: 'Heat drops 10 more tomorrow morning.' }
    };
    G.hasBuff = id => !!(PB.state && PB.state.buffs && PB.state.buffs[id] > 0);
    G.addBuff = (id, days) => {
        const s = PB.state, b = G.BUFFS[id];
        s.buffs = Object.assign({}, s.buffs, { [id]: Math.max(days, (s.buffs || {})[id] || 0) });
        PB.UI.toast(`${b.icon} <b>${b.name}</b> for ${days} day${days > 1 ? 's' : ''}: ${b.desc}`, 'good', 5);
    };

    // ---------- Jobs ----------
    const LINES = ['Big card game this weekend.', 'The kitchen crew is getting restless.', 'A buddy in D-block is paying well.',
        'Don\'t ask who it\'s for.', 'The warden\'s birthday is coming up...', 'I got a buyer on the outside.', 'Payday for the laundry boys.'];

    const RANGES = { cigarette: [6, 14], document: [2, 5], cards: [1, 3], hooch: [2, 4], cigar: [2, 4], wine: [1, 2], fakeid: [1, 2] };
    // Activity jobs: progress comes from doing things (G.progress), not from the trade slot.
    const ACTIVITIES = {
        make:     { icon: '🔨', rank: 0, title: (n, q) => `Make ${n} × ${PB.ITEMS[q.type].name} (grade ${PB.GRADES[q.minG].g}+)` },
        steal:    { icon: '🫳', rank: 0, title: n => `Steal ${n} things at lunch` },
        dig:      { icon: '🕳️', rank: 0, title: n => `Dig ${n}% more tunnel` },
        shift:    { icon: '🪚', rank: 3, title: n => `Finish ${n} workshop job${n > 1 ? 's' : ''}` },
        workout:  { icon: '🏋️', rank: 0, title: n => `Do ${n} reps at the gym (Gym day)` },
        hoops:    { icon: '🏀', rank: 0, title: n => `Score ${n} baskets in the yard (Gym day)` },
        yardwork: { icon: '🍂', rank: 0, title: n => `Rake ${n} leaf piles in the outer yard (Gym day)` },
        cook:     { icon: '🍳', rank: 0, title: n => `Serve ${n} good meals on kitchen duty` }
    };
    // One-off story jobs from named inmates, with special rewards. Each one happens once per save.
    const UNIQUE = [
        { id: 'doc',    giver: 'Doc',          kind: 'deliver', type: 'hooch', count: 1, minG: 5, rank: 2, money: 180, rep: 40, reward: { upgrade: 'worklamp' }, line: 'My hands shake without the good stuff. S-grade hooch. Only the best.' },
        { id: 'lou',    giver: 'Big Lou',      kind: 'workout', count: 40, rank: 0, money: 60, rep: 45, reward: { buff: 'strong', days: 3 }, line: 'You\'re skinny, kid. 40 reps at the gym and I\'ll show you how to dig like a mole.' },
        { id: 'ziggy',  giver: 'Ziggy',        kind: 'hoops', count: 10, rank: 0, money: 90, rep: 35, reward: { buff: 'fame', days: 2 }, line: 'I bet my whole stash you can\'t sink ten baskets in the yard.' },
        { id: 'marco',  giver: 'Chef Marco',   kind: 'cook', count: 8, rank: 1, money: 220, rep: 50, reward: { buff: 'wellfed', days: 2 }, line: 'The new cook burns everything. Cover my kitchen shifts, eh? Eight good plates.' },
        { id: 'gramps', giver: 'Groundskeeper Gramps', kind: 'yardwork', count: 6, rank: 0, money: 70, rep: 30, reward: { heat: -40 }, line: 'My back\'s gone. Rake the outer yard for me and I\'ll put in a good word with the guards.' },
        { id: 'prof',   giver: 'The Professor', kind: 'make', type: 'document', count: 4, minG: 3, rank: 1, money: 160, rep: 40, reward: { buff: 'focused', days: 2 }, line: 'Four forged papers, grade B or better. My appeal depends on it.' },
        { id: 'snake',  giver: 'Snake',        kind: 'dig', count: 25, rank: 0, money: 120, rep: 35, reward: { item: 'spoon' }, line: 'Keep digging, friend. 25% more and the spoon\'s on me. Don\'t ask why I care.' },
        { id: 'shorty', giver: 'Shorty',       kind: 'steal', count: 5, rank: 0, money: 100, rep: 30, reward: { item: 'grinder' }, line: 'Five things from the canteen. Prove you\'ve got fast hands.' },
        { id: 'tiny',   giver: 'Tiny',         kind: 'deliver', type: 'cigar', count: 3, minG: 2, rank: 3, money: 260, rep: 60, reward: { upgrade: 'tools' }, line: 'Three cigars, grade C or better, for my birthday. I\'ll give you my uncle\'s tool kit.' },
        { id: 'moose',  giver: 'Moose',        kind: 'deliver', type: 'fakeid', count: 1, minG: 3, rank: 4, money: 500, rep: 90, reward: { buff: 'fame', days: 3 }, line: 'My parole\'s next month. I need a new name. Make it good.' }
    ];

    G.questTitle = q => {
        const kind = q.kind || 'deliver';
        if (kind === 'deliver') return `${q.count} × ${PB.ITEMS[q.type].name} (grade ${PB.GRADES[q.minG].g}+)`;
        return ACTIVITIES[kind].title(q.count, q);
    };
    G.questIcon = q => (q.kind && q.kind !== 'deliver') ? ACTIVITIES[q.kind].icon : PB.ITEMS[q.type].icon;

    G.genQuest = first => {
        const s = PB.state, rank = PB.rankOf(s.rep);
        // sometimes an activity job instead of a delivery
        if (!first && Math.random() < 0.35) {
            const kinds = Object.keys(ACTIVITIES).filter(k => ACTIVITIES[k].rank <= rank && (k !== 'shift' || PB.Workshop.allowed()));
            const kind = PB.choice(kinds);
            const types = Object.keys(PB.PRODUCT_RANK).filter(t => PB.PRODUCT_RANK[t] <= rank);
            const q = { id: String(s.qid++), kind, done: 0, days: PB.randi(2, 4), line: PB.choice(LINES) };
            if (kind === 'make') { q.type = PB.choice(types); q.minG = PB.randi(1, Math.min(rank + 2, 4)); q.count = Math.max(1, Math.round(RANGES[q.type][1] * 0.6)); }
            else q.count = { steal: PB.randi(2, 5), dig: PB.randi(10, 25), shift: PB.randi(1, 2), workout: PB.randi(20, 45), hoops: PB.randi(4, 10), yardwork: PB.randi(3, 6), cook: PB.randi(4, 8) }[kind];
            q.money = Math.round(25 + q.count * ({ make: 9, steal: 18, dig: 4, shift: 70, workout: 2, hoops: 9, yardwork: 14, cook: 16 }[kind]) * (1 + rank * 0.25));
            q.rep = Math.round(10 + q.count * ({ make: 2, steal: 4, dig: 1, shift: 12, workout: 0.5, hoops: 2, yardwork: 3, cook: 4 }[kind]) + rank * 3);
            return q;
        }
        const types = Object.keys(PB.PRODUCT_RANK).filter(t => PB.PRODUCT_RANK[t] <= rank);
        const type = first ? 'cigarette' : PB.choice(types);
        const range = RANGES[type];
        const count = first ? 5 : PB.randi(range[0], range[1]) + (type === 'cigarette' ? rank * 2 : Math.floor(rank / 3));
        const minG = first ? 0 : PB.randi(0, Math.min(rank + 1, 4));
        const d = PB.ITEMS[type];
        return {
            id: String(s.qid++), kind: 'deliver', type, count, minG, done: 0,
            money: Math.round(d.sell * PB.GRADES[minG].mult * count * 1.6 + 10),
            rep: Math.round(8 + count * d.rep * 1.5 + minG * 4),
            days: first ? 3 : PB.randi(2, 4),
            line: first ? 'Show me what you can do, fish.' : PB.choice(LINES)
        };
    };

    function uniqueOffer() {
        const s = PB.state, rank = PB.rankOf(s.rep);
        const open = UNIQUE.filter(u => u.rank <= rank && !(s.uniqueDone || []).includes(u.id)
            && !s.quests.concat(s.offers).some(q => q.unique === u.id));
        if (!open.length) return null;
        const u = PB.choice(open);
        return Object.assign({ id: String(s.qid++), unique: u.id, done: 0, days: 5, minG: 0 },
            { kind: u.kind, type: u.type, count: u.count, minG: u.minG || 0, money: u.money, rep: u.rep, reward: u.reward, giver: u.giver, line: u.line });
    }

    G.makeOffers = first => {
        const s = PB.state;
        s.offers = [];
        const n = s.quests.length >= 4 ? 0 : 2 + (s.upgrades.radio ? 1 : 0);
        for (let i = 0; i < n; i++) s.offers.push(G.genQuest(first && i === 0));
        if (!first && Math.random() < 0.55) { const u = uniqueOffer(); if (u) s.offers.push(u); }
    };

    G.acceptQuest = id => {
        const s = PB.state, k = s.offers.findIndex(q => q.id === id);
        if (k < 0 || s.quests.length >= 4) return;
        s.quests.push(s.offers.splice(k, 1)[0]);
        PB.Audio.play('paper');
        PB.UI.quests();
    };

    function completeQuest(q) {
        const s = PB.state;
        G.addMoney(q.money);
        G.addRep(q.rep);
        s.quests = s.quests.filter(x => x !== q);
        PB.Audio.play('success');
        PB.UI.toast(`✅ ${q.giver ? q.giver + '\'s job' : 'Job'} done! +$${q.money}, +${q.rep} rep`, 'good', 4);
        if (q.unique) s.uniqueDone = (s.uniqueDone || []).concat(q.unique);
        const r = q.reward;
        if (!r) return;
        if (r.upgrade && !s.upgrades[r.upgrade]) {
            s.upgrades[r.upgrade] = true;
            const u = PB.UPGRADES.find(x => x.id === r.upgrade);
            PB.UI.toast(`🎁 ${q.giver} gave you: ${u.icon} ${u.name}!`, 'rank', 5);
        }
        if (r.buff) G.addBuff(r.buff, r.days || 2);
        if (r.heat) { s.heat = Math.max(0, s.heat + r.heat); PB.UI.toast(`🎁 ${q.giver} talked to the guards. Heat ${r.heat}`, 'good', 4); }
        if (r.item) {
            const c = PB.Coop.homeCell ? PB.Coop.homeCell() : '';
            if (PB.Items.spawn(r.item, [c + 'tray', c + 'floor'])) PB.UI.toast(`🎁 ${q.giver} left you a ${PB.ITEMS[r.item].name} in the trade slot!`, 'rank', 5);
        }
    }

    G.deliverQuest = id => {
        const s = PB.state, q = s.quests.find(x => x.id === id);
        if (!q || (q.kind && q.kind !== 'deliver')) return;
        const taken = takeFromTray(q.type, q.minG, q.count - q.done);
        if (!taken) return;
        q.done += taken;
        PB.state.stats.sold += taken;
        if (q.done >= q.count) completeQuest(q);
        else {
            PB.Audio.play('coin');
            PB.UI.toast(`Delivered ${taken}. ${q.count - q.done} to go.`);
        }
        PB.UI.quests();
    };

    // Host side: something happened that activity jobs count (make / steal / dig / shift / workout / hoops / yardwork / cook)
    G.progress = (kind, n = 1, info = {}) => {
        const s = PB.state;
        if (!s || PB.Coop.isGuest()) return;
        let changed = false;
        s.quests.slice().forEach(q => {
            if (q.kind !== kind) return;
            if (kind === 'make' && (info.type !== q.type || PB.gradeIdx(info.q) < q.minG)) return;
            q.done = Math.min(q.count, q.done + n);
            changed = true;
            if (q.done >= q.count) completeQuest(q);
        });
        if (changed) PB.UI.quests();
    };

    G.serveCustomer = () => {
        const c = PB.NPC.customer;
        if (!c || c.state !== 'waiting') return false;
        const r = c.req;
        if (G.trayMatch(r.type, r.minG).reduce((a, i) => a + i.count, 0) < r.count) return false;
        takeFromTray(r.type, r.minG, r.count);
        const pay = r.unit * r.count;
        G.addMoney(pay);
        G.addRep(PB.ITEMS[r.type].rep * r.count * PB.GRADES[r.minG].mult + 2);
        PB.state.stats.sold += r.count;
        PB.Audio.play('cash');
        PB.UI.toast(`${c.name} paid $${pay}`, 'good');
        PB.NPC.customerLeave(PB.choice(['Pleasure doing business.', 'Nice stuff!', 'You\'re alright, kid.', 'I\'ll tell my friends.']));
        return true;
    };

    // ---------- Hooks ----------
    G.onMade = (type, q) => {
        const log = G.log;
        log.made[type] = (log.made[type] || 0) + 1;
        if (type !== 'brew') { PB.state.stats.made++; G.progress('make', 1, { type, q }); }
        if (type !== 'brew') setTimeout(() => G.hint('sell', 'To sell, pick up your goods and place them in the <b>trade slot</b> (tray in the bars), then talk to Vinnie or a customer.'), 600);
    };
    G.onPlaced = (it, sid) => {
        if (sid.includes('drawer') && PB.Items.isContraband(it)) G.hint('drawer', 'Hidden! Contraband in a <b>closed</b> drawer is safe from guards.', 5);
    };

    // Daily schedule: kitchen duty 08:00 – 11:00 (event), lunch 12:00 – 13:30, workshop 14:00 – 16:00 or yard 14:00 – 16:30 (event).
    // While the kitchen or the yard is open, the clock runs at half speed so there's time to enjoy it.
    const KITCHEN_FROM = DAY_LEN * 1 / 14, KITCHEN_TO = DAY_LEN * 4 / 14, YARD_TO = DAY_LEN * 9.5 / 14;
    function updateLunch() {
        const s = PB.state, E = PB.Events, lockdown = !!E.val('noLunch', 0);
        const kitchen = !lockdown && E.is('kitchen') && s.phase === 'day' && s.time >= KITCHEN_FROM && s.time < KITCHEN_TO;
        if (kitchen && !s.kitchenOpen) {
            PB.Audio.play('bell');
            PB.UI.toast('🍳 KITCHEN DUTY! Your cell door is open until 11:00. Go cook for the block!', 'rank', 5);
        }
        s.kitchenOpen = kitchen;
        const yard = !lockdown && E.is('gym') && s.phase === 'day' && s.time >= SHOP_FROM && s.time < YARD_TO;
        if (yard && !s.yardOpen) {
            PB.Audio.play('bell');
            PB.UI.toast('🏀 GYM DAY! The yard is open until 16:00. Shoot hoops, lift weights, rake leaves!', 'rank', 5);
        }
        s.yardOpen = yard;
        const open = !lockdown && s.phase === 'day' && s.time >= LUNCH_FROM && s.time < LUNCH_TO;
        if (open && !s.lunchOpen) {
            PB.Audio.play('bell');
            PB.UI.toast('🍽️ LUNCH! Your cell door is open until 13:30. Go steal something!', 'rank', 5);
            G.hint('lunch', 'At lunch you can steal a <b>spoon</b> (for digging) or a <b>pepper grinder</b> (better cigarettes). Stay out of the guards\' red view cones!', 8);
        }
        if (!open && s.lunchOpen) PB.Audio.play('bell');
        s.lunchOpen = open;
        // 14:00 – 16:00: workshop shift (only once you're trusted enough)
        const shop = !lockdown && !E.is('gym') && s.phase === 'day' && s.time >= SHOP_FROM && s.time < SHOP_TO; // gym day: everyone's in the yard
        if (shop && !s.workshopOpen && PB.Workshop.allowed()) {
            PB.Audio.play('bell');
            PB.UI.toast('🪚 WORKSHOP SHIFT! Your cell door is open until 16:00.', 'rank', 5);
            G.hint('workshop', 'In the workshop you get paid for woodwork. But you can also secretly carve <b>fake key pieces</b>. Switch to the real job (<b>F</b> / VR <b>B</b>) when a guard looks!', 9);
        }
        s.workshopOpen = shop;
    }

    // Vinnie's price for one item today (random events can change it)
    G.price = type => Math.max(1, Math.round(PB.ITEMS[type].price * PB.Events.mult('buy') * (PB.TIERABLE.includes(type) ? PB.tierPrice(G.tier(type)) : 1)));

    // ---------- The great escape ----------
    G.escape = fromGuest => {
        const s = PB.state;
        if (PB.Coop.isGuest()) { PB.Coop.send({ t: 'act', a: 'escape' }); return; }
        if (s.phase !== 'night') return;
        const P = PB.Player;
        const key = P.heldItems().find(i => i.type === 'fakekey') || PB.Items.list.find(i => i.type === 'fakekey' && !!i.heldBy);
        if (!key) return;
        const g = PB.NPC.guard;
        if (g.state && g.state !== 'leave') { // a guard is in the hall: caught at the door
            PB.Items.confiscate(key);
            s.heat += 50;
            G.addRep(-20);
            PB.Audio.play('caught');
            PB.UI.toast('🚨 A guard saw you fiddling with the door! The fake key is gone. Heat +50', 'bad', 6);
            return;
        }
        PB.Items.destroy(key);
        s.escaped = true;
        s.stats.escapes = (s.stats.escapes || 0) + 1;
        G.save();
        PB.Coop.hostEvent({ t: 'ending' });
        PB.UI.ending();
    };

    // ---------- Loop ----------
    G.update = dt => {
        const s = PB.state;
        if (!PB.Player.enabled || sleeping) { PB.UI.warning(0, 0); return; }
        PB.Music.tension = 0; // no heartbeat warning: only the guard's flashlight and footsteps give them away
        if (PB.Coop.isGuest() || PB.Escape.active) return; // the host runs the world; the clock stops during the ending
        if (!PB.UI.blocking()) {
            s.time += dt * (s.kitchenOpen || s.yardOpen ? 0.5 : 1);
            PB.NPC.update(dt);
            PB.Tunnel.update(dt);
            updateLunch();
            if (s.phase === 'day' && s.time >= DAY_LEN) G.beginNight();
            else if (s.phase === 'night' && s.time >= NIGHT_LEN) G.dawn();
            if (pendingVictory && !PB.Mini.active) { pendingVictory = false; PB.UI.victory(); }
        }
        if (s.phase === 'night') G.hint('guard', 'Watch the walkway for a flashlight. Hide contraband in a drawer and <b>close it</b> before the guard looks in!', 6);
    };

    // Driven by renderer.setAnimationLoop so it keeps running inside a VR headset session too
    G.loop = t => {
        const dt = Math.min(0.05, (t - last) / 1000 || 0);
        last = t;
        PB.VR.update(dt);
        PB.VRUI.update(dt);
        if (PB.state) {
            G.update(dt);
            PB.Coop.update(dt);
            PB.Player.update(dt);
            PB.World.update(dt);
            PB.Items.update(dt);
            PB.Phys.update(dt);
            PB.Lunch.update(dt);
            PB.Workshop.update(dt);
            PB.Yard.update(dt);
            PB.Kitchen.update(dt);
            PB.Escape.update(dt);
            PB.UI.update(dt);
            PB.Mini.update(dt);
            PB.Area.updateTravel();
            const area = PB.World.area;
            if (area !== lastArea) { lastArea = area; PB.Audio.setRoom(area); }
            if (PB.Player.enabled) PB.Audio.ambience(dt, area, PB.state.phase === 'night');
        } else if (PB.Escape.active) PB.Escape.update(dt); // the ending runs after the state is gone too
        if (!document.hidden || PB.VR.active) PB.World.render();
    };
    let lastArea = null;

    // A hidden tab (alt-tabbed, minimized) gets no animation frames at all. In co-op that would freeze the
    // whole world for everyone (host) or stop your position updates (guest), so keep ticking with a timer.
    // (a tab can also start out hidden, so this just checks every 50 ms instead of waiting for visibilitychange)
    setInterval(() => { if (document.hidden && PB.Coop.active && !PB.VR.active) G.loop(performance.now()); }, 50);

    window.addEventListener('load', () => {
        if (!window.THREE) {
            document.querySelector('.menu-foot').textContent = 'Could not load Three.js from the CDN. Check your internet connection.';
            return;
        }
        PB.Settings.load();
        PB.World.init(document.getElementById('game'));
        PB.NPC.init();
        PB.Player.init();
        PB.Mini.init();
        PB.UI.init();
        PB.Coop.init();
        PB.Workshop.init();
        PB.Area.init();
        PB.VR.init();
        PB.VRUI.init();
        PB.Settings.apply();
        PB.UI.showMenu();
        PB.World.renderer.setAnimationLoop(G.loop);
    });

    return G;
})();
