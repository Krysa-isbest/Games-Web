'use strict';
// Authority + replication. The host (or the solo player) runs physics and every game rule; guests send their
// own position and actions, and mirror what the host sends back. Also keeps the player roster, routes EXP,
// toasts and fx events, and draws the other chefs.
// mode: 'off' (menu) | 'solo' | 'host' | 'client'
CF.Sync = (() => {
    const S = { isHost: true, myPid: 0, players: {}, mode: 'off', started: false, code: null, loaded: false };
    const connOf = {}, pidOf = {};                 // host: pid -> connection id, connection id -> pid
    const spawnQ = [], removeQ = [], fxQ = [];
    const avatars = {};
    let tickAcc = 0, slowAcc = 0, keyAcc = 0, sendAcc = 0, foamAcc = 0, seq = 0, lastPl = -1;
    const tmpV = new THREE.Vector3();
    const r3 = CF.r3;
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;

    // ---------- players ----------
    const cleanName = n => String(n || '').replace(/[<>]/g, '').trim().slice(0, 14) || 'Chef';
    const cleanColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : CF.HAT_COLORS[0];
    const cleanSkills = l => Array.isArray(l) ? l.filter((id, i) => CF.SKILL[id] && l.indexOf(id) === i) : [];
    function makePlayer(pid, info) {
        const sp = CF.World.spawns[pid % CF.World.spawns.length];
        return {
            pid, name: cleanName(info.name), color: cleanColor(info.color), role: info.role === 'waiter' ? 'waiter' : 'chef', skills: cleanSkills(info.skills),
            pos: { x: sp.x, y: 0, z: sp.z }, yaw: 0, pitch: 0, hold: [sp.x, 1.3, sp.z - 0.9], hy: 0, spray: false, moving: false, ready: false
        };
    }
    S.myInfo = () => ({
        name: CF.settings.name, color: CF.HAT_COLORS[CF.settings.color] || CF.HAT_COLORS[0],
        role: CF.Player.role === 'waiter' ? 'waiter' : 'chef', skills: CF.Profile.data.skills.slice()
    });
    S.me = () => S.players[S.myPid];
    function rosterPack() {
        const o = {};
        for (const k in S.players) { const p = S.players[k]; o[k] = { name: p.name, color: p.color, role: p.role, skills: p.skills, ready: p.ready }; }
        return o;
    }
    function rosterChanged() {
        if (S.mode === 'host') CF.Net.broadcast({ t: 'roster', pl: rosterPack() });
        CF.UI.updateLobby();
    }
    function applyRoster(pl) {
        const seen = {};
        for (const k in pl) {
            const pid = +k, r = pl[k];
            seen[pid] = true;
            const p = S.players[pid] || (S.players[pid] = makePlayer(pid, r));
            p.name = cleanName(r.name); p.color = cleanColor(r.color); p.role = r.role === 'waiter' ? 'waiter' : 'chef';
            p.skills = cleanSkills(r.skills); p.ready = !!r.ready;
        }
        for (const k in S.players) if (!seen[k] && +k !== S.myPid) { delete S.players[k]; removeAvatar(k); }
    }

    // ---------- sessions ----------
    function wire() {
        CF.Net.onMsg = (id, m) => {
            try { if (S.mode === 'host') hostMsg(id, m); else if (S.mode === 'client') clientMsg(m); }
            catch (e) { console.error('[sync]', m && m.t, e); }
        };
        CF.Net.onJoin = () => {};    // we wait for the guest's hello
        CF.Net.onLeave = id => {
            if (S.mode === 'host') hostLeave(id);
            else if (S.mode === 'client') CF.Game.quit('Lost the connection to the host.');
        };
        CF.Net.onError = text => CF.UI.toast(text, 'bad');
    }
    S.reset = () => {
        for (const k in avatars) removeAvatar(k);
        S.players = {}; S.mode = 'off'; S.isHost = true; S.myPid = 0; S.started = false; S.code = null; S.loaded = false;
        for (const k in connOf) delete connOf[k];
        for (const k in pidOf) delete pidOf[k];
        spawnQ.length = 0; removeQ.length = 0; fxQ.length = 0;
        tickAcc = slowAcc = keyAcc = sendAcc = 0; seq = 0; lastPl = -1;
        CF.Audio.loop('spray', 0);
    };
    S.startSolo = () => {
        S.reset();
        S.mode = 'solo'; S.isHost = true; S.myPid = 0; S.started = true;
        S.players[0] = makePlayer(0, S.myInfo());
    };
    S.startHost = async () => {
        S.reset();
        wire();
        const code = await CF.Net.host();
        S.mode = 'host'; S.isHost = true; S.myPid = 0; S.code = code;
        S.players[0] = makePlayer(0, S.myInfo());
        return code;
    };
    S.startJoin = async code => {
        S.reset();
        wire();
        S.mode = 'client'; S.isHost = false; S.myPid = -1;
        await CF.Net.join(code);
        S.code = CF.Net.code;
        CF.Net.broadcast(Object.assign({ t: 'hello', v: CF.VERSION }, S.myInfo()));
    };
    // host: the lobby is done, everyone goes into the kitchen
    S.beginHosted = () => {
        S.started = true;
        if (S.mode === 'host') CF.Net.broadcast({ t: 'start' });
    };
    S.leave = () => {
        if (S.mode === 'host') CF.Net.broadcast({ t: 'end' });
        CF.Net.close();
        S.reset();
    };

    // ---------- host: messages from guests ----------
    function hostMsg(id, m) {
        const pid = pidOf[id];
        switch (m.t) {
            case 'hello': {
                if (pid !== undefined) return;
                let np = 1;
                while (S.players[np]) np++;
                if (np > 3) { CF.Net.send(id, { t: 'reject', why: 'That kitchen is full (4 chefs max).' }); return; }
                pidOf[id] = np; connOf[np] = id;
                const p = S.players[np] = makePlayer(np, m);
                CF.Net.send(id, { t: 'welcome', pid: np, started: S.started, code: S.code });
                rosterChanged();
                if (S.started) sendFull(id);
                S.broadcastToast(`👋 ${p.name} joined the kitchen!`, 'info');
                return;
            }
            case 'p': {
                const p = S.players[pid], s = m.s;
                if (!p || !Array.isArray(s)) return;
                p.pos.x = num(s[0]); p.pos.y = num(s[1]); p.pos.z = num(s[2]);
                p.yaw = num(s[3]); p.pitch = num(s[4]);
                p.hold = [num(s[5]), num(s[6]), num(s[7])]; p.hy = num(s[8]);
                p.spray = !!s[9]; p.moving = !!s[10];
                return;
            }
            case 'act':
                if (pid !== undefined && m.a) S.handle(pid, m.a);
                return;
        }
    }
    function hostLeave(id) {
        const pid = pidOf[id];
        if (pid === undefined) return;
        delete pidOf[id]; delete connOf[pid];
        const p = S.players[pid];
        delete S.players[pid];
        removeAvatar(pid);
        const it = CF.Items.heldBy(pid);
        if (it) CF.Items.release(it, null);
        rosterChanged();
        if (p) S.broadcastToast(`🚪 ${p.name} left the kitchen.`, 'info');
    }

    // ---------- guest: messages from the host ----------
    function clientMsg(m) {
        const I = CF.Items;
        switch (m.t) {
            case 'welcome':
                S.myPid = m.pid | 0;
                S.code = m.code || S.code;
                if (!S.players[S.myPid]) S.players[S.myPid] = makePlayer(S.myPid, S.myInfo());
                if (m.started) { S.started = true; CF.Game.enterGame(); }
                else CF.Game.showLobby();
                return;
            case 'reject': CF.Game.quit(m.why || 'Could not join that kitchen.'); return;
            case 'end': CF.Game.quit('The host closed the kitchen.'); return;
            case 'roster': applyRoster(m.pl || {}); CF.UI.updateLobby(); return;
            case 'start': S.started = true; CF.Game.enterGame(); return;
            case 'full':
                I.clear();
                applyRoster(m.pl || {});
                CF.Stations.unpack(m.ss);
                CF.Orders.unpack(m.o);
                CF.Cook.unpack(m.f || []);
                CF.Orders.state.stats = m.stats || null;
                CF.Orders.state.best = m.best || 0;
                if (!S.loaded) CF.UI.loading(true, 'Loading the kitchen…');
                return;
            case 'items':
                for (const d of m.l) { if (I.get(d.i)) I.applyState(d); else I.create(d); }
                return;
            case 'fullEnd':
                if (!S.loaded) { S.loaded = true; CF.UI.loaded(); }
                return;
            case 'sp':
                for (const d of m.l) { if (I.get(d.i)) I.applyState(d); else I.create(d); }
                return;
            case 'rm':
                for (const id of m.l) I.destroy(id);
                return;
            case 'st':
                for (const d of m.l) { if (I.get(d.i)) I.applyState(d); else I.create(d); }
                return;
            case 'tr': {
                // the fast channel is unordered: never let an older snapshot overwrite a newer one
                const n = m.n | 0;
                for (const a of m.l) {
                    const it = I.get(a[0]);
                    if (!it || (it._n || 0) > n) continue;
                    it._n = n;
                    I.applySnap(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
                }
                return;
            }
            case 'pl':
                if (m.n < lastPl) return;
                lastPl = m.n;
                for (const a of m.l) applyPl(a);
                return;
            case 'ss': CF.Stations.unpack(m.s); return;
            case 'g':
                CF.Orders.unpack(m.o);
                CF.Cook.unpack(m.f || []);
                CF.Cook.unpackSources(m.src);
                CF.Cook.bigFire = m.bf || 0;
                return;
            case 'fx':
                for (const f of m.l) fxLocal(f[0], { x: f[1], y: f[2], z: f[3] }, f[4] || null);
                return;
            case 'toast': CF.UI.toast(m.text, m.kind); return;
            case 'xp': gain(m.n | 0); return;
            case 'served': servedLocal(m.info); return;
            case 'eod':
                // the end-of-day summary needs the day's stats, which the 5 Hz packet doesn't carry
                CF.Orders.unpack(m.o);
                CF.Orders.state.stats = m.stats || null;
                CF.Orders.state.best = m.best || 0;
                CF.UI.showSummary();
                return;
            case 'chat': CF.UI.chat(m.name, m.color, m.text); return;
        }
    }
    function applyPl(a) {
        const pid = a[0];
        if (pid === S.myPid) return;
        const p = S.players[pid];
        if (!p) return;
        p.pos.x = a[1]; p.pos.y = a[2]; p.pos.z = a[3]; p.yaw = a[4]; p.pitch = a[5];
        p.hold = [a[6], a[7], a[8]]; p.hy = a[9]; p.spray = !!a[10]; p.moving = !!a[11];
    }

    // ---------- host: sending ----------
    function chunks(t, list, per, fast, extra) {
        for (let i = 0; i < list.length; i += per) CF.Net.broadcast(Object.assign({ t, l: list.slice(i, i + per) }, extra || {}), null, fast);
    }
    function depth(it) {
        let d = 0, c = it;
        while (c && c.container && d < 8) { d++; c = CF.Items.get(c.container); }
        return d;
    }
    const byDepth = (a, b) => depth(a) - depth(b);     // containers before their contents
    function sendFull(id) {
        const O = CF.Orders;
        CF.Net.send(id, { t: 'full', o: O.pack(), ss: CF.Stations.pack(), f: CF.Cook.pack(), stats: O.state.stats, best: O.state.best, pl: rosterPack() });
        const list = CF.Items.all().sort(byDepth).map(it => CF.Items.desc(it));
        for (let i = 0; i < list.length; i += 30) CF.Net.send(id, { t: 'items', l: list.slice(i, i + 30) });
        CF.Net.send(id, { t: 'fullEnd' });
    }
    // everyone gets the whole kitchen again (new day). Spawns queued before this are part of it.
    S.fullSync = () => {
        if (S.mode !== 'host') return;
        spawnQ.length = 0; removeQ.length = 0;
        for (const it of CF.Items.all()) it._sent = it._sv;
        for (const pid in connOf) sendFull(connOf[pid]);
    };
    function flushQueues() {
        if (spawnQ.length) {
            const list = spawnQ.filter(it => !it.removed && CF.Items.get(it.id) === it).sort(byDepth).map(it => { it._sent = it._sv; return CF.Items.desc(it); });
            spawnQ.length = 0;
            if (list.length) chunks('sp', list, 30, false);
        }
        if (removeQ.length) chunks('rm', removeQ.splice(0), 400, false);
    }
    function sendStates() {
        const list = [];
        for (const it of CF.Items.all()) if (it._sent !== it._sv) { it._sent = it._sv; list.push(it); }
        if (list.length) chunks('st', list.sort(byDepth).map(it => CF.Items.desc(it)), 30, false);
    }
    const moved = (a, b) => { if (!b) return true; for (let i = 1; i < 8; i++) if (Math.abs(a[i] - b[i]) > 0.0015) return true; return false; };
    // moving items go over the fast channel 15x a second; twice a second the reliable channel repeats
    // whatever changed since its last send, so an item never ends up resting in the wrong place
    function sendTransforms(key) {
        const fast = [], rel = [];
        for (const it of CF.Items.all()) {
            const b = it.body;
            if (!b || it.container) continue;
            const p = b.position, q = b.quaternion;
            const a = [it.id, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)];
            if (moved(a, it._lf)) { it._lf = a; fast.push(a); }
            if (key && moved(a, it._lr)) { it._lr = a; rel.push(a); }
        }
        if (fast.length) chunks('tr', fast, 100, true, { n: seq });
        if (rel.length) chunks('tr', rel, 100, false, { n: seq });
    }
    function sendPlayers() {
        const l = [];
        for (const k in S.players) {
            const p = S.players[k], h = p.hold || [0, 0, 0];
            l.push([p.pid, r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.yaw), r3(p.pitch), r3(h[0]), r3(h[1]), r3(h[2]), r3(p.hy || 0), p.spray ? 1 : 0, p.moving ? 1 : 0]);
        }
        CF.Net.broadcast({ t: 'pl', n: seq, l }, null, true);
    }

    const aimDir = (yaw, pitch) => { const cp = Math.cos(pitch); return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]; };
    S.aimDir = aimDir;
    function sprayHost(dt) {
        for (const k in S.players) {
            const p = S.players[k];
            if (!p.spray) continue;
            const it = CF.Items.heldBy(p.pid);
            if (!it || it.type !== 'ext') continue;
            const o = p.hold || [p.pos.x, p.pos.y + 1.4, p.pos.z];
            const put = CF.Cook.extinguish(o, aimDir(p.yaw, p.pitch), S.skill(p.pid, 'fireproof') ? 2 : 1, dt);
            if (put) S.xp(p.pid, put * 2, null);
        }
    }

    S.hostTick = dt => {
        sprayHost(dt);
        if (S.mode !== 'host') return;
        flushQueues();
        tickAcc += dt; slowAcc += dt; keyAcc += dt;
        if (tickAcc >= 1 / 15) {
            tickAcc = 0; seq++;
            sendStates();
            const key = keyAcc >= 0.5;
            if (key) keyAcc = 0;
            sendTransforms(key);
            sendPlayers();
        }
        if (slowAcc >= 0.2) {
            slowAcc = 0;
            CF.Net.broadcast({ t: 'g', o: CF.Orders.pack(), f: CF.Cook.pack(), src: CF.Cook.packSources(), bf: r3(CF.Cook.bigFire || 0) });
        }
        if (CF.Stations.dirtyState) { CF.Stations.dirtyState = false; CF.Net.broadcast({ t: 'ss', s: CF.Stations.pack() }); }
        if (fxQ.length) chunks('fx', fxQ.splice(0), 80, false);
    };
    // guest: our own chef 20x a second
    S.clientTick = dt => {
        sendAcc += dt;
        if (sendAcc < 0.05) return;
        sendAcc = 0;
        const p = S.me();
        if (!p) return;
        const h = p.hold || [0, 0, 0];
        CF.Net.broadcast({ t: 'p', s: [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.yaw), r3(p.pitch), r3(h[0]), r3(h[1]), r3(h[2]), r3(p.hy || 0), p.spray ? 1 : 0, p.moving ? 1 : 0] }, null, true);
    };

    // ---------- hooks used by the game modules ----------
    S.act = a => {
        if (S.isHost) S.handle(S.myPid, a);
        else if (S.mode === 'client') CF.Net.broadcast({ t: 'act', a });
    };
    S.handle = (pid, a) => {
        if (!a || typeof a.t !== 'string') return;
        const P = S.players[pid];
        if (!P) return;
        const I = CF.Items;
        switch (a.t) {
            case 'grab': {
                const it = I.get(a.id);
                if (it && I.grab(pid, it.id)) CF.Orders.onGrab(pid, it);
                return;
            }
            case 'drop': case 'throw': {
                const it = I.get(a.id);
                if (!it || it.heldBy !== pid) return;
                const v = Array.isArray(a.v) ? [CF.clamp(num(a.v[0]), -14, 14), CF.clamp(num(a.v[1]), -14, 14), CF.clamp(num(a.v[2]), -14, 14)] : null;
                I.release(it, v);
                it.thrownBy = pid;
                if (a.t === 'throw') S.onFx('throw', I.worldPos(it), 'whoosh');
                return;
            }
            case 'spray': P.spray = !!a.on; return;
            case 'role':
                if (a.role === 'chef' || a.role === 'waiter') { P.role = a.role; P.spray = false; rosterChanged(); }
                return;
            case 'skills': P.skills = cleanSkills(a.list); rosterChanged(); return;
            case 'chat': {
                const text = String(a.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
                if (text) chatAll(P.name, P.color, text);
                return;
            }
        }
        if (!CF.Stations.handle(pid, a, P)) CF.Orders.handle(pid, a);
    };
    function chatAll(name, color, text) {
        CF.UI.chat(name, color, text);
        if (S.mode === 'host') CF.Net.broadcast({ t: 'chat', name, color, text });
    }

    S.onSpawn = it => { if (S.mode === 'host') spawnQ.push(it); };
    S.onRemove = ids => { if (S.mode === 'host') for (const id of ids) removeQ.push(id); };
    S.onFx = (kind, pos, sound) => {
        pos = pos || { x: 0, y: 1, z: 0 };
        const x = pos.x !== undefined ? pos.x : pos[0], y = pos.y !== undefined ? pos.y : pos[1], z = pos.z !== undefined ? pos.z : pos[2];
        // Items.attach already played its sound here
        fxLocal(kind, { x, y, z }, kind === 'attach' ? null : sound);
        if (S.mode === 'host') fxQ.push([kind, r3(x), r3(y), r3(z), sound || 0]);
    };
    const FX = {
        chop: ['poof', 5, { c: 0xffffff }], crate: ['poof', 12], poof: ['poof', 8], trash: ['poof', 6, { c: 0x8a8a8a }],
        splash: ['splash', 10], fill: ['splash', 8], ladle: ['splash', 6, { c: 0xd8432c }], soup: ['splash', 10, { c: 0xd8432c }],
        wash: ['bubble', 14], ignite: ['spark', 12], break: ['shard', 16], flatten: ['poof', 8, { c: 0xf1dfb6 }],
        greet: ['star', 6], open: ['star', 10], leave: ['star', 5], rat: ['poof', 8, { c: 0x9a9a9a }], fail: ['poof', 6, { c: 0xff5a5a }]
    };
    function fxLocal(kind, p, sound) {
        const f = FX[kind];
        if (f && (kind !== 'leave' || sound)) CF.World.fx(f[0], p, f[1], f[2] || {});
        if (sound) CF.Audio.play(sound, p);
    }

    S.toastTo = (pid, text, kind) => {
        if (pid === S.myPid) CF.UI.toast(text, kind);
        else if (S.mode === 'host' && connOf[pid] !== undefined) CF.Net.send(connOf[pid], { t: 'toast', text, kind });
    };
    S.broadcastToast = (text, kind) => {
        CF.UI.toast(text, kind);
        if (S.mode === 'host') CF.Net.broadcast({ t: 'toast', text, kind });
    };
    // EXP only counts for the role you play right now (role null = anyone)
    S.xp = (pid, amount, role) => {
        const p = S.players[pid];
        amount = Math.round(amount);
        if (!p || amount <= 0 || (role && p.role !== role)) return;
        if (pid === S.myPid) gain(amount);
        else if (S.mode === 'host' && connOf[pid] !== undefined) CF.Net.send(connOf[pid], { t: 'xp', n: amount });
    };
    function gain(n) {
        if (n <= 0) return;
        const up = CF.Profile.gain(n);
        CF.UI.xpGain(n, up);
    }
    S.skill = (pid, id) => {
        const p = S.players[pid], s = CF.SKILL[id];
        return !!(p && s && s.role === p.role && p.skills && p.skills.includes(id));
    };
    S.hasWaiters = () => Object.values(S.players).some(p => p.role === 'waiter');
    S.playerCount = () => Math.max(1, Object.keys(S.players).length);
    S.served = info => {
        servedLocal(info);
        if (S.mode === 'host') CF.Net.broadcast({ t: 'served', info });
    };
    function servedLocal(info) {
        if (!info) return;
        CF.UI.served(info);
        CF.Audio.play(info.stars >= 1 ? 'cash' : 'fail');
        CF.World.fx('star', { x: info.x, y: 1.7, z: info.z }, Math.max(2, Math.round(info.stars * 3)));
    }
    S.endOfDay = () => {
        const s = CF.Orders.state;
        if (S.mode === 'host') CF.Net.broadcast({ t: 'eod', o: CF.Orders.pack(), stats: s.stats, best: s.best });
        CF.UI.showSummary();
    };

    // ---------- the other chefs (everyone) ----------
    function removeAvatar(pid) {
        const a = avatars[pid];
        if (!a) return;
        CF.World.scene.remove(a.g);
        delete avatars[pid];
    }
    function makeAvatar(p) {
        const g = CF.Models.chef(p.color);
        const tag = CF.Models.nameTag(p.name, p.color);
        tag.position.y = 2.42;
        g.add(tag);
        g.position.set(p.pos.x, p.pos.y, p.pos.z);
        g.rotation.y = p.yaw + Math.PI;
        CF.World.scene.add(g);
        return { g, color: p.color, name: p.name };
    }
    const angLerp = (a, b, k) => {
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a + d * k;
    };
    S.visuals = dt => {
        const t = performance.now() / 1000;
        foamAcc += dt;
        const emit = foamAcc >= 1 / 40;
        if (emit) foamAcc = 0;
        let nearSpray = 99;
        const L = CF.World.camera.position;
        for (const k in S.players) {
            const p = S.players[k], pid = p.pid, mine = pid === S.myPid;
            const held = CF.Items.heldBy(pid);
            if (!mine) {
                let a = avatars[pid];
                if (a && (a.color !== p.color || a.name !== p.name)) { removeAvatar(pid); a = null; }
                if (!a) a = avatars[pid] = makeAvatar(p);
                const g = a.g, kk = 1 - Math.exp(-14 * dt);
                g.position.x += (p.pos.x - g.position.x) * kk;
                g.position.y += (p.pos.y - g.position.y) * kk;
                g.position.z += (p.pos.z - g.position.z) * kk;
                g.rotation.y = angLerp(g.rotation.y, p.yaw + Math.PI, kk);
                g.userData.anim({ moving: p.moving, held: !!held, pitch: p.pitch, t }, dt);
            }
            if (p.spray && held && held.type === 'ext') {
                const d = aimDir(p.yaw, p.pitch);
                const o = mine ? CF.Player.holdPoint(tmpV) : tmpV.set(p.hold[0], p.hold[1], p.hold[2]);
                if (emit) CF.World.fx('foam', { x: o.x + d[0] * 0.15, y: o.y + 0.12 + d[1] * 0.15, z: o.z + d[2] * 0.15 }, 2, { dx: d[0], dy: d[1], dz: d[2] });
                nearSpray = Math.min(nearSpray, o.distanceTo(L));
            }
        }
        for (const k in avatars) if (!S.players[k] || +k === S.myPid) removeAvatar(k);
        CF.Audio.loop('spray', nearSpray < 99 ? CF.clamp(1.4 / (1 + nearSpray * nearSpray * 0.2), 0, 1) : 0);
    };

    return S;
})();
