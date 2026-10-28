'use strict';
// Co-op for 2-4 players. The host's game is the authority: it runs time, guards, the economy and saving.
// Guests mirror the host's world from snapshots and send their actions to the host.
// Every player has a slot (0 = host, 1-3 = guests in join order) and lives in the cell PB.World.CELLS[slot]:
// slots 0 and 1 get the two middle cells (two posters/tunnels), slots 2 and 3 the edge cells (one poster).
PB.Coop = (() => {
    const C = {
        active: false, started: false, role: null, name: 'Inmate', newGame: false,
        slot: 0, size: 2, players: {}, mates: {}, votes: {}, poseT: 0, snapT: 0, lastQuests: ''
    };
    const Net = PB.Net;
    const $ = id => document.getElementById(id);
    const r3 = v => Math.round(v * 1000) / 1000;
    const GAME_FNS = ['buy', 'sellItem', 'sellAll', 'acceptQuest', 'deliverQuest', 'buyUpgrade', 'serveCustomer', 'upgradeTier', 'buyService'];
    const FWD_SFX = new Set(['caught', 'rank', 'cash', 'coin', 'bell', 'success', 'whistle', 'flush', 'drawer', 'lamp']);
    const linkSlot = new Map(); // host: link id -> slot
    // what each player looks like to the others
    const LOOKS = [
        { skin: 0xffd7b5, hair: 0xd9b45a, hat: 'beanie', hatColor: 0x3a5a8a },
        { skin: 0xc68642, hair: 0x1a1a1a, hat: 'hair', mustache: true },
        { skin: 0x8d5524, hair: 0x2b1d14, hat: 'beanie', hatColor: 0x8a2a2a, beard: true },
        { skin: 0xe0a27a, hair: 0xb5532a, hat: 'hair', belly: true }
    ];

    C.isGuest = () => C.active && C.role === 'guest';
    C.isHost = () => C.active && C.role === 'host';
    C.send = m => Net.send(m); // guest: to the host · host: to every guest
    C.hostEvent = m => { if (C.isHost()) C.send(m); };
    C.resetVotes = () => { C.votes = {}; };
    C.homeCell = () => C.active ? PB.World.CELLS[C.slot] : '';
    C.nameOf = sl => (C.players[sl] && C.players[sl].name) || 'Inmate';
    C.otherSlots = () => Object.keys(C.players).map(Number).filter(sl => sl !== C.slot);
    C.ownerName = cell => { const sl = PB.World.CELLS.indexOf(cell); return C.players[sl] ? C.nameOf(sl) : 'nobody'; };
    function sendSlot(sl, m) { const p = C.players[sl]; if (p && p.link != null) Net.sendTo(p.link, m); }
    function toGuest(sl, msg, kind = 'bad') { sendSlot(sl, { t: 'toast', msg, kind }); }

    // =====================================================================
    // Lobby menu
    // =====================================================================
    C.init = () => {
        try { C.name = localStorage.getItem('pb_name') || 'Inmate'; } catch (e) {}
        $('coop-name').value = C.name;
        $('coop-name').addEventListener('input', () => {
            C.name = $('coop-name').value.trim().slice(0, 14) || 'Inmate';
            try { localStorage.setItem('pb_name', C.name); } catch (e) {}
            if (C.role === 'host' && C.players[0] && !C.started) { C.players[0].name = C.name; lobbyChanged(); }
        });
        try { $('coop-size').value = localStorage.getItem('pb_lobby') || '2'; } catch (e) {}
        $('coop-size').addEventListener('change', () => {
            try { localStorage.setItem('pb_lobby', $('coop-size').value); } catch (e) {}
            // still in the lobby: the host can change the size until the game starts (never below who's already in)
            if (C.role === 'host' && !C.started && C.players[0]) {
                const want = +$('coop-size').value, top = Math.max(0, ...Object.keys(C.players).map(Number));
                C.size = Math.max(want, top + 1);
                $('coop-size').value = String(C.size);
                lobbyChanged();
            }
        });
        $('btn-coop').onclick = () => { PB.Audio.init(); C.openMenu(); };
        $('coop-back').onclick = () => { leaveLobby(); $('coop').classList.add('hidden'); PB.UI.showMenu(); };
        $('coop-start').onclick = () => { if (C.role === 'host' && !C.started) hostStart(); };
        document.querySelectorAll('[data-ctab]').forEach(t => t.onclick = () => {
            document.querySelectorAll('[data-ctab]').forEach(x => x.classList.toggle('on', x === t));
            $('coop-peer').classList.toggle('hidden', t.dataset.ctab !== 'peer');
            $('coop-manual').classList.toggle('hidden', t.dataset.ctab !== 'manual');
        });
        document.querySelectorAll('[data-mtab]').forEach(t => t.onclick = () => {
            document.querySelectorAll('[data-mtab]').forEach(x => x.classList.toggle('on', x === t));
            $('cm-host').classList.toggle('hidden', t.dataset.mtab !== 'mhost');
            $('cm-join').classList.toggle('hidden', t.dataset.mtab !== 'mjoin');
        });
        document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copy($(b.dataset.copy).value));

        $('cp-host').onclick = () => run(async () => {
            prepareHost($('cp-new').checked);
            status('Creating a room…');
            const code = await Net.peerHost();
            $('cp-code').textContent = code;
            $('cp-code').classList.remove('hidden');
            status(`Room code <b>${code}</b>. Send it to your friends. Press <b>Start game</b> when everyone is in.`);
        });
        $('cp-join').onclick = () => run(async () => {
            const code = $('cp-join-code').value.trim();
            if (code.length < 5) throw new Error('Type the 5-letter room code first.');
            prepareGuest();
            status('Connecting…');
            await Net.peerJoin(code);
            timeout();
        });
        $('cm-make').onclick = () => run(async () => {
            if (C.role !== 'host' || C.started || !C.players[0]) { Net.close(); prepareHost($('cm-new').checked); }
            if (freeSlot() == null) throw new Error('The lobby is full. Start the game, or pick a bigger lobby size.');
            status('Creating invite code…');
            $('cm-invite').value = await Net.manualHost();
            $('cm-reply-in').value = '';
            status('Copy the <b>invite code</b> to ONE friend. Paste their <b>reply code</b> below and press Connect. Then make a new invite for the next friend.');
        });
        $('cm-connect').onclick = () => run(async () => {
            await Net.manualFinish($('cm-reply-in').value);
            status('Connecting…');
            timeout();
        });
        $('cm-answer').onclick = () => run(async () => {
            prepareGuest();
            status('Creating reply code…');
            $('cm-reply').value = await Net.manualJoin($('cm-invite-in').value);
            status('Send the <b>reply code</b> to the host and wait. You\'ll show up in their lobby.');
            timeout(120000);
        });
    };

    function status(html, bad) {
        $('coop-status').innerHTML = html;
        $('coop-status').classList.toggle('bad', !!bad);
    }
    async function run(fn) {
        try { await fn(); } catch (e) { status('⚠️ ' + (e.message || e), true); }
    }
    function timeout(ms = 20000) {
        clearTimeout(C.toTimer);
        C.toTimer = setTimeout(() => {
            if (C.role === 'guest' && !Net.isOpen() && !C.started) status('⚠️ Could not connect. Check the code. Over Tailscale both players must be online in Tailscale.', true);
        }, ms);
    }
    function copy(text) {
        if (!text) return;
        const done = () => status('Copied to clipboard ✔');
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        else fallbackCopy(text, done);
    }
    function fallbackCopy(text, done) {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t);
        t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove();
    }

    C.openMenu = async () => {
        $('menu').classList.add('hidden');
        $('coop').classList.remove('hidden');
        status('');
        renderLobby();
        $('coop-mic').innerHTML = '🎤 Asking for microphone permission…';
        const ok = await Net.askMic();
        $('coop-mic').innerHTML = ok
            ? '🎤 <b>Microphone allowed.</b> This lets your browser use your real network address (needed for Tailscale). Nothing is recorded or sent.'
            : '⚠️ <b>Microphone blocked.</b> Quick join still works, but code swap over Tailscale may fail. Allow the mic in the address bar and reopen Multiplayer.';
        $('coop-mic').classList.toggle('bad', !ok);
    };

    function wire() {
        Net.onMsg = onMsg;
        Net.onOpen = id => {
            if (C.role === 'guest') { status('Connected! Joining the lobby…'); C.send({ t: 'hello', name: C.name }); }
        };
        Net.onClose = onDisconnect;
        Net.onError = e => status('⚠️ ' + e, true);
    }
    function prepareHost(newGame) {
        C.role = 'host'; C.newGame = !!newGame; C.started = false; C.active = false;
        C.slot = 0; C.size = +$('coop-size').value || 2;
        C.players = { 0: { name: C.name } };
        linkSlot.clear();
        wire();
        renderLobby();
    }
    function prepareGuest() {
        C.role = 'guest'; C.started = false; C.active = false;
        C.slot = 0; C.players = {};
        wire();
        renderLobby();
    }
    function leaveLobby() {
        if (!C.started) { Net.close(); C.role = null; C.players = {}; renderLobby(); $('cp-code').classList.add('hidden'); }
    }
    const freeSlot = () => { for (let sl = 1; sl < C.size; sl++) if (!C.players[sl]) return sl; return null; };

    // ---------- Lobby list ----------
    const CELL_NO = ['C-07', 'C-06', 'C-08', 'C-05'];
    function cellInfo(sl, size) {
        const cell = PB.World.CELLS[sl];
        const n = PB.World.TUNNELS.filter(t => t.need <= Math.max(2, size) && (t.a === cell || t.b === cell)).length;
        return `Cell ${CELL_NO[sl]} · ${sl < 2 ? 'middle' : 'edge'} · ${n} poster${n !== 1 ? 's' : ''}`;
    }
    function renderLobby() {
        const box = $('coop-lobby');
        const inLobby = (C.role === 'host' && C.players[0]) || (C.role === 'guest' && Object.keys(C.players).length);
        box.classList.toggle('hidden', !inLobby || C.started);
        if (!inLobby) return;
        let html = '';
        for (let sl = 0; sl < C.size; sl++) {
            const p = C.players[sl];
            html += p
                ? `<li><span class="num">${sl + 1}</span>${esc(p.name)}${sl === 0 ? ' 👑' : ''}${sl === C.slot ? ' (you)' : ''}<span class="cell">${cellInfo(sl, C.size)}</span></li>`
                : `<li class="empty"><span class="num">${sl + 1}</span>Waiting for a player…<span class="cell">${cellInfo(sl, C.size)}</span></li>`;
        }
        $('lobby-list').innerHTML = html;
        $('lobby-count').textContent = `${Object.keys(C.players).length} / ${C.size}`;
        $('coop-start').classList.toggle('hidden', C.role !== 'host');
        $('coop-start').disabled = Object.keys(C.players).length < 2;
        $('coop-start').textContent = Object.keys(C.players).length < 2 ? 'Waiting for friends…' : '▶ Start game';
        if (C.role === 'guest' && !C.started) status('In the lobby. Waiting for the host to start the game…');
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const roster = () => { const o = {}; for (const sl in C.players) o[sl] = C.players[sl].name; return o; };
    function lobbyChanged() {
        renderLobby();
        if (C.role === 'host') C.send({ t: 'lobby', size: C.size, players: roster() });
    }

    // =====================================================================
    // Starting the session
    // =====================================================================
    function hostStart() {
        C.active = true; C.started = true;
        PB.World.setPlayers(C.size);
        patchHost();
        $('coop').classList.add('hidden');
        if (C.newGame || !PB.Game.hasSave()) PB.Game.newGame(); else PB.Game.continueGame();
        C.otherSlots().forEach(sl => { makeMate(sl); welcome(sl); });
        const n = C.otherSlots().length;
        PB.UI.toast(`👋 ${n === 1 ? C.nameOf(C.otherSlots()[0]) + ' is' : n + ' friends are'} in the cell block with you!`, 'good', 4);
        if (C.size > 2) PB.UI.toast('💡 Vinnie can\'t reach every cell: press <b>F</b> at your cell door to whistle him over.', '', 7);
    }
    function welcome(sl) {
        sendSlot(sl, { t: 'welcome', slot: sl, size: C.size, players: roster(), snap: snapshot(true) });
    }

    function guestStart(m) {
        C.active = true; C.started = true;
        C.slot = m.slot; C.size = m.size;
        setRoster(m.players);
        PB.World.setPlayers(C.size);
        patchGuest();
        $('coop').classList.add('hidden');
        PB.Game.resetWorld();
        lastSq = 0; C.rtt = 0;
        PB.state = Object.assign(PB.Game.newState(), m.snap.st, { wip: {} });
        PB.Game.log = PB.Game.newLog();
        C.otherSlots().forEach(makeMate);
        applySnap(m.snap);
        PB.Game.enterGame();
        PB.World.setDay(PB.state.day);
        PB.Music.setMode(PB.state.phase === 'night' ? 'night' : 'day');
        PB.Audio.setAmbient(PB.state.phase === 'night');
        PB.Player.spawnIn(C.homeCell());
        PB.UI.toast(`👋 You joined ${C.nameOf(0)}'s cell block!`, 'good', 4);
        PB.UI.toast('💡 Press <b>G</b> to ping a spot for your friends.', '', 6);
        if (C.size > 2) PB.UI.toast('💡 Press <b>F</b> at your cell door to whistle Vinnie over to your bars.', '', 7);
    }
    function setRoster(players) {
        C.players = {};
        for (const sl in players) C.players[sl] = { name: String(players[sl] || 'Inmate').slice(0, 14) };
    }

    // =====================================================================
    // Messages
    // =====================================================================
    function onMsg(m, id) {
        const from = C.role === 'host' ? linkSlot.get(id) : null;
        switch (m.t) {
            case 'hello': if (C.role === 'host') hostHello(m, id); break;
            case 'full': if (C.role === 'guest') { status('⚠️ That game is full.', true); Net.close(); } break;
            case 'lobby': if (C.role === 'guest' && !C.started) { C.size = m.size; setRoster(m.players); renderLobby(); } break;
            case 'welcome': if (C.role === 'guest' && !C.started) guestStart(m); break;
            case 'roster': if (C.isGuest()) applyRoster(m.players); break;
            case 'snap': if (C.isGuest()) applySnap(m); break;
            case 'pose': {
                const sl = C.role === 'host' ? from : m.from, mate = C.mates[sl];
                if (sl == null || !mate) break;
                if (m.sq != null && mate.sq != null && m.sq <= mate.sq && m.sq > mate.sq - 1000) break; // arrived late: older than what we have
                mate.sq = m.sq;
                if (m.rt != null) mate.rtt = m.rt;
                setMatePose(sl, m);
                if (C.role === 'host') { m.from = from; Net.sendExcept(id, m, true); } // everyone else sees them too
                break;
            }
            case 'rtt': if (C.role === 'host') Net.sendTo(id, { t: 'rtt2', ts: m.ts }, true); break;
            case 'rtt2': if (C.isGuest()) { const ms = performance.now() - m.ts; C.rtt = C.rtt ? C.rtt * 0.7 + ms * 0.3 : ms; } break;
            case 'act': if (C.isHost() && from != null) handleAct(m, from); break;
            case 'toast': if (C.isGuest()) PB.UI.toast(m.msg, m.kind, m.dur); break;
            case 'sfx': if (C.isGuest()) PB.Audio.play(m.name, { vol: m.vol }); break;
            case 'bubble':
                if (C.isGuest()) { const f = PB.NPC.headPosOf(m.key); if (f) PB.UI.bubble(m.key, m.text, f, m.dur, m.cls); }
                break;
            case 'fade':
                $('fade').classList.add('on');
                setTimeout(() => $('fade').classList.remove('on'), 1300);
                break;
            case 'summary': if (C.isGuest()) PB.UI.openSummary(m.log, () => {}); break;
            case 'victory': if (C.isGuest()) PB.UI.victory(); break;
            case 'ending': if (C.isGuest()) PB.UI.ending(); break;
            case 'busted':
                if (C.isGuest()) { PB.Mini.abort(false); PB.UI.toast('🚨 The guard saw you crafting and trashed your work!', 'bad', 4); }
                break;
            case 'ping':
                if (C.role === 'host') { if (from == null) break; m.from = from; Net.sendExcept(id, m); }
                if (m.from !== C.slot) showPing(new THREE.Vector3(...m.p), C.nameOf(m.from));
                break;
            case 'bye': if (C.role === 'host') { if (id != null) Net.drop(id); } else onDisconnect(); break;
        }
    }

    // Host: someone connected and said hi. Give them a free slot (cell), or tell them it's full.
    function hostHello(m, id) {
        if (linkSlot.has(id)) return;
        const sl = freeSlot();
        if (sl == null) { Net.sendTo(id, { t: 'full' }); setTimeout(() => Net.drop(id), 400); return; }
        C.players[sl] = { name: String(m.name || 'Inmate').slice(0, 14), link: id };
        linkSlot.set(id, sl);
        if (C.started) { // joined a running game
            makeMate(sl);
            welcome(sl);
            C.send({ t: 'roster', players: roster() });
            PB.UI.toast(`👋 ${C.nameOf(sl)} joined the cell block!`, 'good', 4);
        } else {
            lobbyChanged();
            status(`${esc(C.nameOf(sl))} joined the lobby. Press <b>Start game</b> when everyone is in.`);
        }
    }

    // Guest: the host says who's in the game now
    function applyRoster(players) {
        const before = new Set(C.otherSlots());
        setRoster(players);
        const now = new Set(C.otherSlots());
        now.forEach(sl => { if (!before.has(sl)) { makeMate(sl); PB.UI.toast(`👋 ${C.nameOf(sl)} joined the cell block!`, 'good', 4); } });
        before.forEach(sl => { if (!now.has(sl)) { const n = C.mates[sl] ? C.mates[sl].name : 'A friend'; removeMate(sl); PB.UI.toast(`${n} left the game.`, 'bad', 4); } });
    }

    // ---------- Host: guest actions ----------
    function findInter(id) {
        const o = PB.World.interactables.find(x => x.userData.interact && x.userData.interact.id === id);
        return o ? o.userData.interact : null;
    }
    const validCell = (c, sl) => PB.World.cells[c] ? c : PB.World.CELLS[sl];

    function returnGuestItem(it) {
        const I = PB.Items, o = it.guestOrigin, sl = +String(it.heldBy).slice(1), c = C.cellOf(sl) || PB.World.CELLS[sl] || '';
        it.heldBy = null;
        I.detach(it);
        if (o && o.sid && I.canPlace(it, o.sid, o.gx, o.gy, o.rot)) I.place(it, o.sid, o.gx, o.gy, o.rot);
        else if (!I.placeFree(it, [c + 'floor', c + 'desk', c + 'shelf'])) I.destroy(it);
    }

    // Surfaces are checked from that guest's point of view (e.g. the tunnel shelf needs THEIR poster up)
    function guestCan(sid, sl) {
        const W = PB.World, s = W.surfaces[sid], gc = C.cellOf(sl);
        if (!s || gc == null) return false;
        if (W.cellOf(sid) === 'hole') {
            const t = W.tunnelById(sid);
            return W.tunnelOn(t) && W.tunnelP(t) >= 0.6 && (t.a === gc || t.b === gc) && W.posterOf(gc, t.side).lifted;
        }
        return W.cellOf(sid) === gc && s.accessible(); // only things in the cell the guest is standing in
    }

    function handleAct(m, sl) {
        const I = PB.Items, W = PB.World, me = 'g' + sl, mate = C.mates[sl];
        if (!mate) return;
        const it = m.uid != null ? I.list.find(i => i.uid === m.uid) : null;
        switch (m.a) {
            case 'pickup':
                if (it && (it.flying || (it.surface && guestCan(it.surface, sl))) && !PB.Player.heldItems().includes(it) && !it.heldBy) {
                    if (it.flying) PB.Phys.cancel(it); // caught in the air
                    it.guestOrigin = it.surface ? { sid: it.surface, gx: it.gx, gy: it.gy, rot: it.rot } : null;
                    I.detach(it);
                    it.heldBy = me;
                    it.heldHand = m.hand === 'left' ? 'l' : 'r';
                    attachToHand(it, mate);
                } else toGuest(sl, 'Someone else has that.');
                break;
            case 'place':
                if (it && it.heldBy === me && guestCan(m.sid, sl) && I.canPlace(it, m.sid, m.gx, m.gy, m.rot)) {
                    it.heldBy = null;
                    I.place(it, m.sid, m.gx, m.gy, m.rot);
                } else toGuest(sl, 'Doesn\'t fit there anymore.');
                break;
            case 'merge': {
                const into = I.list.find(i => i.uid === m.into);
                if (it && it.heldBy === me && into && I.canMerge(it, into)) { it.heldBy = null; I.merge(it, into); }
                break;
            }
            case 'split':
                if (it && it.surface && guestCan(it.surface, sl) && !it.heldBy) {
                    const one = I.split(it);
                    if (one) { one.heldBy = me; one.guestOrigin = { sid: it.surface, gx: it.gx, gy: it.gy, rot: it.rot }; attachToHand(one, mate); }
                }
                break;
            case 'return':
                if (it && it.heldBy === me) returnGuestItem(it);
                break;
            case 'flush':
                if (it && it.heldBy === me && !PB.Player.NO_FLUSH.includes(it.type)) {
                    const cell = validCell(m.cell, sl);
                    if (W.cells[cell].clogged) { toGuest(sl, 'The toilet is clogged! Wait for it to drain.'); break; }
                    it.heldBy = null;
                    PB.Tunnel.flush(cell, it);
                }
                break;
            case 'dig':
                if (it && it.heldBy === me) PB.Tunnel.addDig(validCell(m.cell, sl), it, m.side === 2 ? 2 : 1);
                break;
            case 'whistle':
                if (W.cells[m.cell]) PB.NPC.callTrader(m.cell);
                break;
            case 'throw':
                if (it && it.heldBy === me) {
                    it.heldBy = null;
                    const V3 = a => new THREE.Vector3().fromArray(a);
                    PB.Phys.launch(it, V3(m.p), V3(m.v), new THREE.Quaternion().fromArray(m.q));
                }
                break;
            case 'pockets':
                PB.Lunch.unpack(validCell(m.cell, sl), (m.types || []).filter(t => PB.ITEMS[t]));
                break;
            case 'heat':
                PB.state.heat = Math.max(0, PB.state.heat + (+m.n || 0));
                break;
            case 'spawn': { // guest used the admin spawn menu
                const c = validCell(m.cell, sl);
                if (PB.ITEMS[m.type]) PB.Items.spawn(m.type, [c + 'floor', c + 'desk', c + 'shelf']);
                break;
            }
            case 'workshopPay':
                PB.Game.addMoney(Math.max(0, Math.min(200, +m.n || 0)));
                PB.Game.progress('shift', 1);
                break;
            case 'escape':
                PB.Game.escape(true);
                break;
            // yard / kitchen: money, rep, job progress and buffs earned out there
            case 'areaPay': PB.Game.addMoney(Math.max(0, Math.min(100, +m.n || 0))); break;
            case 'areaRep': PB.Game.addRep(Math.max(-10, Math.min(10, +m.n || 0))); break;
            case 'progress':
                if (['workout', 'hoops', 'yardwork', 'cook'].includes(m.kind)) PB.Game.progress(m.kind, Math.max(0, Math.min(5, +m.n || 0)));
                break;
            case 'buff':
                if (PB.Game.BUFFS[m.id]) PB.Game.addBuff(m.id, Math.max(1, Math.min(3, +m.days || 1)));
                break;
            case 'use': {
                const def = findInter(m.id);
                if (!def) break;
                if (m.id.endsWith('bed') && !m.alt) C.voteSleep(sl);
                else if (m.alt) { if (def.alt) def.alt(); }
                else def.use();
                break;
            }
            case 'sleep': C.voteSleep(sl); break;
            case 'game':
                if (GAME_FNS.includes(m.fn)) {
                    PB.Game.actorCell = validCell(m.cell, sl);
                    try { PB.Game[m.fn](...(m.args || [])); } finally { PB.Game.actorCell = null; }
                }
                break;
            case 'produce': PB.Craft.hostProduce(m.r, m.q, Object.assign({}, m.x, { cell: validCell(m.x && m.x.cell, sl) })); break;
        }
        C.send(snapshot(true));
    }

    // Everyone has to agree before the night (or day) is skipped
    C.voteSleep = sl => {
        if (PB.NPC.guard.state) {
            if (sl === 0) C.orig.toast('Not with a guard right outside!', 'bad'); else toGuest(sl, 'Not with a guard right outside!');
            return;
        }
        C.votes[sl] = true;
        const all = Object.keys(C.players).map(Number), yes = all.filter(s => C.votes[s]).length;
        if (yes >= all.length) { C.resetVotes(); PB.Game.sleep(true); return; }
        PB.UI.toast(`😴 ${C.nameOf(sl)} wants to sleep (${yes}/${all.length}). Press <b>E</b> on your bed to agree.`);
    };
    C.bust = slots => slots.forEach(sl => sendSlot(sl, { t: 'busted' }));
    // HUD connection quality: a guest sees their ping to the host, the host sees the slowest friend
    C.pingText = () => {
        if (C.isGuest()) return C.rtt ? `📶 ${Math.round(C.rtt)} ms` : '';
        const all = Object.values(C.mates).filter(m => m.rtt).map(m => m.rtt);
        return all.length ? `📶 ${Math.max(...all)} ms` : '';
    };

    // ---------- Host: snapshots ----------
    // Regular snapshots go over the fast channel. The item list (the biggest part) is only sent when it
    // changed, plus every 5th snapshot in case one got lost. 'ack' snapshots (after an action) are complete and reliable.
    let snapSeq = 0, lastItems = '';
    function snapshot(ack) {
        const s = PB.state, W = PB.World, sq = ++snapSeq;
        const items = itemList(), js = JSON.stringify(items);
        const sendItems = ack || js !== lastItems || sq % 5 === 0;
        lastItems = js;
        return {
            t: 'snap', ack: !!ack, sq,
            st: {
                day: s.day, phase: s.phase, time: r3(s.time), money: s.money, rep: s.rep, heat: s.heat,
                upgrades: s.upgrades, quests: s.quests, offers: s.offers, stock: s.stock, stats: s.stats, bossShown: s.bossShown, tut: s.tut,
                tunnel: s.tunnel, tunnelE: s.tunnelE, tunnelW: s.tunnelW,
                lunchOpen: s.lunchOpen, workshopOpen: s.workshopOpen, event: s.event, escaped: s.escaped,
                tiers: s.tiers, buffs: s.buffs, protection: s.protection, yardOpen: s.yardOpen, kitchenOpen: s.kitchenOpen, uniqueDone: s.uniqueDone
            },
            it: sendItems ? items : null,
            w: W.CELLS.map(k => {
                const c = W.cells[k];
                return [c.drawers.map(d => d.open ? 1 : 0), c.mattress.lifted ? 1 : 0, c.brick.open ? 1 : 0, c.lamp.on ? 1 : 0, c.poster.lifted ? 1 : 0, c.clogged ? 1 : 0, c.poster2.lifted ? 1 : 0, c.safe.open ? 1 : 0];
            }),
            n: PB.NPC.snapshot(),
            v: C.votes
        };
    }
    function itemList() {
        return PB.Items.list.map(i => {
            // who holds it: 'h' = the host, 'g1'..'g3' = a guest slot, 'f' = flying
            const held = PB.Player.heldItems().includes(i) ? 'h' : i.heldBy ? i.heldBy : i.flying ? 'f' : 0;
            const p = i.flying ? i.mesh.position : null;
            return [
                i.uid, i.type, i.surface, i.gx, i.gy, i.rot, Math.round(i.quality * 10) / 10, i.count, i.charges,
                i.stamped ? 1 : 0, i.jug ? [i.jug.state, i.jug.servings, Math.round(i.jug.quality)] : 0, i.variant || 0,
                held, i.heldHand || 'r', p ? [r3(p.x), r3(p.y), r3(p.z)] : 0, i.tier || 0, i.jug && i.jug.kind === 'wine' ? 1 : 0
            ];
        });
    }

    // ---------- Guest: apply snapshots ----------
    let lastSq = 0;
    function applySnap(m) {
        // fast-channel snapshots can arrive out of order: never go back in time
        if (m.sq != null) { if (!m.ack && m.sq <= lastSq) return; lastSq = Math.max(lastSq, m.sq); }
        const s = PB.state, prevPhase = s.phase, prevDay = s.day, wip = s.wip;
        Object.assign(s, m.st);
        s.wip = wip;
        if (C.started && prevPhase !== s.phase) {
            PB.Music.setMode(s.phase === 'night' ? 'night' : 'day');
            PB.Audio.setAmbient(s.phase === 'night');
        }
        if (C.started && prevDay !== s.day) PB.World.setDay(s.day);
        const W = PB.World;
        W.CELLS.forEach((k, ci) => {
            const c = W.cells[k], w = m.w[ci];
            if (!w) return;
            w[0].forEach((o, i) => { if (c.drawers[i]) c.drawers[i].open = !!o; });
            c.mattress.lifted = !!w[1]; c.brick.open = !!w[2]; c.lamp.on = !!w[3]; c.poster.lifted = !!w[4]; c.clogged = !!w[5]; c.poster2.lifted = !!w[6]; c.safe.open = !!w[7];
        });
        if (m.it) applyItems(m.it);
        PB.NPC.applyRemote(m.n);
        // a tunnel got filled while visiting someone else's cell: back home
        const P = PB.Player;
        if (W.area === 'cell' && !PB.Mini.active && !W.connected(C.homeCell(), P.cell)) P.spawnIn(C.homeCell());
        C.votes = m.v || C.votes;
        const q = JSON.stringify(s.quests);
        if (q !== C.lastQuests) { C.lastQuests = q; PB.UI.quests(); }
        if (m.ack) PB.UI.refresh();
    }

    function applyItems(list) {
        const I = PB.Items, W = PB.World, P = PB.Player, seen = new Set(), mine = 'g' + C.slot;
        for (const a of list) {
            const [uid, type, sid, gx, gy, rot, q, count, charges, stamped, jug, variant, held, hh, fp, tier, wine] = a;
            seen.add(uid);
            const props = { quality: q, count, charges, stamped: !!stamped, variant, tier: tier || 0 };
            if (jug) props.jug = { state: jug[0], servings: jug[1], quality: jug[2], nights: 1, kind: wine ? 'wine' : 'hooch' };
            const key = `${count}|${charges}|${stamped}|${jug ? jug.join() : ''}|${tier}|${wine}`;
            let it = I.list.find(i => i.uid === uid);
            if (!it) { it = I.create(type, Object.assign({ uid }, props)); it._key = key; }
            else {
                Object.assign(it, props);
                if (it._key !== key) { it._key = key; I.rebuild(it); if (P.held === it) PB.UI.setHeld(it); }
            }
            const hand = hh === 'l' ? 'left' : 'right';
            if (held === mine) {
                // just threw it ourselves and the host hasn't caught up yet: don't snap it back into the hand
                if (it.pendingThrow && performance.now() - it.pendingThrow < 800) continue;
                if ((hand === 'left' ? P.held2 : P.held) !== it) P.adopt(it, hand);
                continue;
            }
            it.pendingThrow = 0;
            if (P.heldItems().includes(it)) P.forget(it);
            if (held === 'h' || (typeof held === 'string' && held[0] === 'g')) { // in a friend's hand
                const mate = C.mates[held === 'h' ? 0 : +held.slice(1)];
                if (mate && it.mesh.parent !== mate.hand) attachToHand(it, mate);
                continue;
            }
            if (held === 'f') {
                if (!PB.Phys.isFlying(it) && fp) { // someone else's throw: just show where it is
                    if (it.mesh.parent !== PB.World.scene) { I.detach(it); PB.World.scene.add(it.mesh); }
                    it.mesh.position.set(fp[0], fp[1], fp[2]);
                }
                continue;
            }
            if (sid && W.surfaces[sid]) {
                if (it.surface !== sid || it.gx !== gx || it.gy !== gy || it.rot !== rot || it.mesh.parent !== W.surfaces[sid].group) I.place(it, sid, gx, gy, rot);
            }
        }
        for (const it of I.list.slice()) if (!seen.has(it.uid)) I.destroy(it);
    }

    // =====================================================================
    // Avatars of the other players
    // =====================================================================
    function makeMate(sl) {
        removeMate(sl);
        const ch = PB.NPC.makeChar(Object.assign({ shirt: 0xf07a22, pants: 0xe06a12, number: 100 + sl * 111 }, LOOKS[sl] || LOOKS[1]));
        const hand = new THREE.Group(); hand.position.set(0, -0.58, 0.08); ch.armR.add(hand);
        ch.root.position.copy(PB.World.cells[PB.World.CELLS[sl]].toWorld(0, 0, 0.6));
        PB.World.scene.add(ch.root);
        C.mates[sl] = { slot: sl, name: C.nameOf(sl), ch, w: PB.NPC.walker(ch, 3.6), hand, pose: null, crafting: false };
        tag(sl);
    }
    function tag(sl) {
        const m = C.mates[sl];
        if (!m) return;
        const r = m.ch.root;
        PB.UI.bubble('mate' + sl, m.crafting ? `${m.name} 🔨` : m.name, () => new THREE.Vector3(r.position.x, 2.18, r.position.z), Infinity, 'tag');
    }
    function removeMate(sl) {
        const m = C.mates[sl];
        if (!m) return;
        if (m.ch.root.parent) m.ch.root.parent.remove(m.ch.root);
        if (m.vrHands) m.vrHands.forEach(h => { if (h.parent) h.parent.remove(h); });
        delete C.mates[sl];
        PB.UI.removeBubble('mate' + sl);
    }
    const removeAllMates = () => Object.keys(C.mates).forEach(removeMate);
    function attachToHand(it, mate) {
        if (!mate) return;
        PB.Items.detach(it);
        mate.hand.add(it.mesh);
        it.mesh.position.set(0, -0.02, 0.06);
        it.mesh.rotation.set(0, 0, 0);
        it.mesh.scale.setScalar(0.85);
    }
    function setMatePose(sl, p) {
        const m = C.mates[sl], r = m.ch.root;
        // first pose, or they changed area (cell / canteen / workshop): jump straight there
        if (!m.pose || m.pose.ar !== p.ar || Math.hypot(p.x - r.position.x, p.z - r.position.z) > 3) { r.position.set(p.x, 0, p.z); r.rotation.y = p.yaw - Math.PI; m.w.target = null; }
        m.pose = p;
        if (Math.hypot(p.x - r.position.x, p.z - r.position.z) > 0.01) { m.w.target = { x: p.x, z: p.z }; m.w.onArrive = null; }
        m.w.face = p.yaw - Math.PI;
        if (!!p.c !== m.crafting) { m.crafting = !!p.c; tag(sl); }
        // you see each other when you're in the same place (in the cell block, at lunch, in the workshop)
        const away = p.ar !== PB.World.area || p.ar === 'escape'; // everyone fights their own way out in the ending
        r.visible = !away;
        if (!away && r.parent !== PB.World.activeScene) PB.World.activeScene.add(r);
        vrHands(m, p);
        if (away !== !!m.away) { m.away = away; if (away) PB.UI.removeBubble('mate' + sl); else tag(sl); }
    }

    // A VR player gets floating hands that follow their real controllers; their arms are hidden
    function vrHands(m, p) {
        const vr = !!p.vr;
        if (vr && !m.vrHands) {
            m.vrHands = ['l', 'r'].map(() => {
                const g = new THREE.Group();
                PB.World.sph(0.06, 0xe0a27a, 0, 0, 0, g, 10).scale.set(1, 0.6, 1.3);
                PB.World.cyl(0.045, 0.05, 0.12, 0xf07a22, 0, 0, 0.09, g, 10).rotation.x = Math.PI / 2;
                PB.World.scene.add(g);
                return g;
            });
        }
        m.ch.armL.visible = !vr;
        m.ch.armR.visible = !vr || m.hand.children.length > 0;
        if (!m.vrHands) return;
        m.vrHands.forEach((h, i) => {
            const pos = p[i ? 'r' : 'l'];
            if (h.parent !== PB.World.activeScene) PB.World.activeScene.add(h);
            h.visible = vr && !!pos && m.ch.root.visible;
            if (h.visible) { h.position.set(pos[0], pos[1], pos[2]); h.rotation.y = p.yaw; }
        });
    }

    // Before a canteen/workshop scene is disposed, move the other players' avatars back to the cell world
    C.rescueMate = scene => {
        Object.values(C.mates).forEach(m => {
            if (m.ch.root.parent === scene) PB.World.scene.add(m.ch.root);
            (m.vrHands || []).forEach(h => { if (h.parent === scene) PB.World.scene.add(h); });
        });
    };

    // Which cell a player is standing in (null while they're at lunch / in the workshop)
    C.cellOf = sl => {
        if (sl === C.slot) return PB.World.area === 'cell' ? PB.Player.cell : null;
        const m = C.mates[sl];
        if (!m) return null;
        if (!m.pose) return PB.World.CELLS[sl];
        return m.pose.ar === 'cell' ? (m.pose.cl || '') : null;
    };
    // host: the guests standing in a cell right now
    C.guestsIn = cell => C.isHost() ? C.otherSlots().filter(sl => C.cellOf(sl) === cell) : [];
    C.guestsCrafting = cell => C.guestsIn(cell).filter(sl => C.mates[sl] && C.mates[sl].crafting);
    C.guestHeldContraband = cell => {
        if (!C.isHost()) return [];
        const who = new Set(C.guestsIn(cell).map(sl => 'g' + sl));
        return PB.Items.list.filter(i => who.has(i.heldBy) && PB.Items.isContraband(i));
    };

    // ---------- Ping ----------
    C.ping = () => {
        if (!C.active) return;
        const ray = new THREE.Raycaster();
        ray.setFromCamera({ x: 0, y: 0 }, PB.World.camera);
        ray.far = 25;
        const hit = ray.intersectObjects(PB.World.scene.children, true).find(h => h.object.visible && h.object.isMesh && !h.object.isInstancedMesh);
        if (!hit) return;
        showPing(hit.point, null);
        C.send({ t: 'ping', p: [r3(hit.point.x), r3(hit.point.y), r3(hit.point.z)], from: C.slot });
    };
    function showPing(v, who) {
        const p = v.clone().add(new THREE.Vector3(0, 0.12, 0));
        PB.UI.bubble('ping' + Math.random(), who ? `📍 ${who}` : '📍', () => p, 3, 'ping');
        PB.Audio.play('pop');
    }

    // =====================================================================
    // Per-frame
    // =====================================================================
    C.update = dt => {
        if (!C.active || !C.started) return;
        C.poseT -= dt;
        C.rttT = (C.rttT || 0) - dt;
        if (C.isGuest() && C.rttT <= 0) { C.rttT = 2; C.send({ t: 'rtt', ts: performance.now() }); }
        if (C.poseT <= 0) {
            C.poseT = 1 / 20;
            C.poseSeq = (C.poseSeq || 0) + 1;
            const P = PB.Player, pose = { t: 'pose', from: C.slot, sq: C.poseSeq, x: r3(P.pos.x), z: r3(P.pos.z), yaw: r3(P.yaw), pitch: r3(P.pitch), c: PB.Mini.active ? 1 : 0, cl: P.cell, ar: PB.World.area, cr: P.crouch ? 1 : 0 };
            if (C.isGuest() && C.rtt) pose.rt = Math.round(C.rtt);
            // crossplay: a VR player also sends their real hand positions
            if (PB.VR.isOn()) {
                pose.vr = 1;
                ['left', 'right'].forEach(s => { const p = PB.VR.handWorld(s); if (p) pose[s[0]] = [r3(p.x), r3(p.y), r3(p.z)]; });
            }
            Net.send(pose, true);
        }
        if (C.isHost()) {
            C.snapT -= dt;
            if (C.snapT <= 0) { C.snapT = 0.1; Net.send(snapshot(false), true); }
        } else PB.NPC.updateRemote(dt);
        for (const m of Object.values(C.mates)) {
            const holding = m.hand.children.length > 0;
            m.w.armOverride = holding;
            PB.NPC.updWalker(m.w, dt);
            // crouching friends duck down
            m.ch.root.scale.y = PB.damp(m.ch.root.scale.y, m.pose && m.pose.cr ? 0.68 : 1, 10, dt);
            if (holding) m.ch.armR.rotation.x = PB.damp(m.ch.armR.rotation.x, -0.9, 10, dt);
            if (m.pose) m.ch.head.rotation.x = PB.clamp(-m.pose.pitch, -0.6, 0.6);
        }
    };

    // =====================================================================
    // Leaving / disconnects
    // =====================================================================
    function guestCleanup(msg) {
        C.active = false; C.started = false; C.role = null; C.players = {};
        unpatch();
        removeAllMates();
        PB.World.setPlayers(1);
        PB.Player.enabled = false;
        PB.Mini.abort(false);
        PB.UI.closePanel(false);
        PB.Player.unlock();
        PB.Music.setMode(null);
        PB.Game.resetWorld();
        PB.state = null;
        PB.UI.showMenu();
        document.querySelector('.menu-foot').textContent = msg;
    }
    // host back to solo (everyone left, or the host left to the menu)
    function hostCleanup(msg) {
        PB.Items.list.filter(i => i.heldBy).forEach(returnGuestItem);
        removeAllMates();
        C.active = false; C.started = false; C.role = null; C.players = {};
        linkSlot.clear();
        C.resetVotes();
        unpatch();
        PB.World.setPlayers(1);
        // solo uses only the two middle cells
        if (PB.state && PB.World.area === 'cell' && !PB.World.cellUsed(PB.Player.cell)) PB.Player.spawnIn('');
        if (msg) PB.UI.toast(msg, 'bad', 5);
    }
    // Host: one guest left
    function guestLeft(sl) {
        const name = C.nameOf(sl);
        PB.Items.list.filter(i => i.heldBy === 'g' + sl).forEach(returnGuestItem);
        removeMate(sl);
        delete C.players[sl];
        delete C.votes[sl];
        if (!C.otherSlots().length) { Net.close(); hostCleanup(`${name} left. You're playing solo now.`); return; }
        C.send({ t: 'roster', players: roster() });
        PB.UI.toast(`${name} left the game.`, 'bad', 4);
    }
    function onDisconnect(id) {
        clearTimeout(C.toTimer);
        if (C.role === 'host') {
            const sl = linkSlot.get(id);
            linkSlot.delete(id);
            if (sl == null) return;
            if (C.started) guestLeft(sl);
            else { delete C.players[sl]; lobbyChanged(); }
            return;
        }
        if (!C.active) {
            if (!$('coop').classList.contains('hidden')) status('⚠️ Connection closed.', true);
            C.players = {}; renderLobby();
            return;
        }
        Net.close();
        guestCleanup(`${C.nameOf(0)} (the host) left the game.`);
    }
    C.leave = () => {
        if (!C.active) return;
        C.send({ t: 'bye' });
        const role = C.role;
        setTimeout(() => Net.close(), 200);
        if (role === 'host') hostCleanup();
        else guestCleanup('You left the co-op game.');
    };

    // =====================================================================
    // Patching shared systems
    // =====================================================================
    function patchHost() {
        const U = PB.UI, A = PB.Audio;
        C.orig = { toast: U.toast, bubble: U.bubble, play: A.play, victory: U.victory };
        U.toast = (msg, kind, dur) => { C.orig.toast(msg, kind, dur); if (C.isHost()) C.send({ t: 'toast', msg, kind, dur }); };
        U.bubble = (key, text, posFn, dur, cls) => {
            C.orig.bubble(key, text, posFn, dur, cls);
            if (C.isHost() && ['trader', 'cust', 'guard'].includes(key)) C.send({ t: 'bubble', key, text, dur, cls });
        };
        A.play = function (name, o) {
            C.orig.play.call(A, name, o);
            if (C.isHost() && FWD_SFX.has(name)) C.send({ t: 'sfx', name, vol: o && o.vol });
        };
        U.victory = () => { C.orig.victory(); if (C.isHost()) C.send({ t: 'victory' }); };
    }
    function patchGuest() {
        const G = PB.Game;
        C.origG = {};
        GAME_FNS.forEach(fn => {
            C.origG[fn] = G[fn];
            G[fn] = (...args) => { C.send({ t: 'act', a: 'game', fn, args, cell: PB.Player.cell }); return true; };
        });
    }
    function unpatch() {
        if (C.orig) { Object.assign(PB.UI, { toast: C.orig.toast, bubble: C.orig.bubble, victory: C.orig.victory }); PB.Audio.play = C.orig.play; C.orig = null; }
        if (C.origG) { Object.assign(PB.Game, C.origG); C.origG = null; }
    }

    return C;
})();
