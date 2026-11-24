'use strict';
// Room-code co-op over PeerJS (loaded only when someone hosts or joins). Star network: every guest is
// connected to the host only. Each guest has a reliable ordered channel (actions, state) and an unreliable
// one for positions and snapshots, where a lost packet is simply replaced by the next one.
// API: host() -> code, join(code), send(id, msg, fast), broadcast(msg, exceptId, fast), count(), close().
// Callbacks: onMsg(id, msg), onJoin(id), onLeave(id), onError(text).
CF.Net = (() => {
    const N = { peer: null, links: new Map(), code: null, isHost: false, onMsg: null, onJoin: null, onLeave: null, onError: null };
    const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }] };
    const PREFIX = 'cookingfrenzy-', FAST = 'cffast', MAX_GUESTS = 3;
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no I, O, 0 or 1: easy to read out loud
    let nextId = 1, joinFail = null;

    function loadPeer() {
        return new Promise((res, rej) => {
            if (window.Peer) return res();
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
            s.onload = () => window.Peer ? res() : rej(new Error('PeerJS did not load.'));
            s.onerror = () => { s.remove(); rej(new Error('Could not load PeerJS. Are you online?')); };
            document.head.appendChild(s);
        });
    }
    const peerError = e => {
        const t = e && e.type;
        if (t === 'peer-unavailable') return 'No kitchen found with that code.';
        if (t === 'unavailable-id') return 'That room code is taken. Try hosting again.';
        if (t === 'timeout') return 'The connection timed out. Are you online?';
        if (t === 'browser-incompatible') return 'This browser does not support WebRTC co-op.';
        if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Can\'t reach the PeerJS server. Check your internet and try again.';
        return (e && e.message) || 'Connection error.';
    };
    function kill(p) {
        if (N.peer === p) N.peer = null;
        try { p.destroy(); } catch (e) {}
    }

    // ---------- links ----------
    function makeLink(peerId) {
        const l = { id: nextId++, peerId, ch: null, fast: null, open: false, closed: false };
        N.links.set(l.id, l);
        return l;
    }
    function opened(l) {
        if (l.open || l.closed) return;
        l.open = true;
        if (N.onJoin) N.onJoin(l.id);
    }
    function closed(l) {
        if (l.closed) return;
        l.closed = true;
        const was = l.open;
        l.open = false;
        N.links.delete(l.id);
        try { if (l.ch) l.ch.close(); } catch (e) {}
        try { if (l.fast) l.fast.close(); } catch (e) {}
        if (was && N.onLeave) N.onLeave(l.id);
    }
    function deliver(l, raw) {
        if (l.closed) return;
        let m;
        try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
        if (m && typeof m === 'object' && N.onMsg) N.onMsg(l.id, m);
    }
    function sendLink(l, s, fast) {
        if (!l || !l.open || !l.ch) return;
        // big messages always go the reliable way (an unreliable one that big would get lost too often)
        const useFast = fast && l.fast && l.fast.open && s.length < 12000;
        try { (useFast ? l.fast : l.ch).send(s); } catch (e) { /* channel closing */ }
    }

    N.send = (id, msg, fast) => sendLink(N.links.get(id), JSON.stringify(msg), fast);
    N.broadcast = (msg, exceptId, fast) => {
        if (!N.links.size) return;
        const s = JSON.stringify(msg);
        N.links.forEach(l => { if (l.id !== exceptId) sendLink(l, s, fast); });
    };
    N.count = () => [...N.links.values()].filter(l => l.open).length;

    // ---------- host side: every incoming connection ----------
    function incoming(c, tries) {
        if (c.label === FAST) {
            // the unreliable channel of a guest joins that guest's link (it can arrive first: wait a moment)
            const l = [...N.links.values()].find(x => x.peerId === c.peer);
            if (!l) { if (tries < 20) setTimeout(() => incoming(c, tries + 1), 250); return; }
            l.fast = c;
            c.on('data', d => deliver(l, d));
            return;
        }
        if (N.links.size >= MAX_GUESTS) {
            c.on('open', () => {
                try { c.send(JSON.stringify({ t: 'reject', why: 'That kitchen is full (4 chefs max).' })); } catch (e) {}
                setTimeout(() => { try { c.close(); } catch (e) {} }, 800);
            });
            return;
        }
        const l = makeLink(c.peer);
        l.ch = c;
        c.on('open', () => opened(l));
        c.on('data', d => deliver(l, d));
        c.on('close', () => closed(l));
        c.on('error', () => closed(l));
        if (c.open) opened(l);
    }

    function openPeer(id) {
        return new Promise((res, rej) => {
            const p = N.peer = new Peer(id, { config: ICE, debug: 0 });
            let ready = false;
            const timer = setTimeout(() => { if (ready) return; rej({ type: 'timeout' }); kill(p); }, 12000);
            p.on('open', () => { ready = true; clearTimeout(timer); res(p); });
            p.on('error', e => {
                if (!ready) { clearTimeout(timer); rej(e); kill(p); return; }
                if (joinFail) joinFail(e);
                else if (N.onError && N.peer === p) N.onError(peerError(e));
            });
            // lost the PeerJS server (not the friends): try to get back so new friends can still join
            p.on('disconnected', () => { if (N.peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) {} } });
        });
    }

    // Host: open a room and return its 5-character code
    N.host = async () => {
        N.close();
        await loadPeer();
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            let code = '';
            for (let i = 0; i < 5; i++) code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
            try {
                const p = await openPeer(PREFIX + code);
                N.isHost = true; N.code = code;
                p.on('connection', c => incoming(c, 0));
                return code;
            } catch (e) {
                lastErr = e;
                if (!e || e.type !== 'unavailable-id') break;
            }
        }
        throw new Error(peerError(lastErr));
    };

    // Guest: connect to a room. Resolves once the reliable channel is open.
    N.join = async code => {
        N.close();
        code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 5) throw new Error('Room codes have 5 characters.');
        await loadPeer();
        let p;
        try { p = await openPeer(undefined); } catch (e) { throw new Error(peerError(e)); }
        N.isHost = false; N.code = code;
        const id = PREFIX + code;
        return new Promise((res, rej) => {
            let done = false;
            const end = err => {
                if (done) return;
                done = true; clearTimeout(timer); joinFail = null;
                if (err) { kill(p); rej(new Error(err)); } else res();
            };
            const timer = setTimeout(() => end('The host did not answer. Check the code and try again.'), 15000);
            joinFail = e => end(peerError(e));
            const c = p.connect(id, { reliable: true });
            const l = makeLink(id);
            l.ch = c;
            c.on('open', () => {
                end(null);
                opened(l);
                // a second channel without retransmits for positions (less lag on bad Wi-Fi)
                setTimeout(() => {
                    if (N.peer !== p || l.closed) return;
                    const f = p.connect(id, { reliable: false, label: FAST, serialization: 'json' });
                    f.on('open', () => { if (!l.closed) l.fast = f; });
                    f.on('data', d => deliver(l, d));
                }, 400);
            });
            c.on('data', d => deliver(l, d));
            c.on('close', () => { closed(l); end('The connection closed.'); });
            c.on('error', () => { closed(l); end('Connection error.'); });
        });
    };

    N.close = () => {
        joinFail = null;
        const links = [...N.links.values()];
        N.links.clear();
        for (const l of links) {
            l.closed = true; l.open = false;
            try { if (l.ch) l.ch.close(); } catch (e) {}
            try { if (l.fast) l.fast.close(); } catch (e) {}
        }
        const p = N.peer;
        N.peer = null;
        if (p) { try { p.destroy(); } catch (e) {} }
        N.code = null; N.isHost = false;
    };

    return N;
})();
