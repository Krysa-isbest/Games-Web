'use strict';
// Connection layer for co-op (up to 4 players). Star network: every guest is connected to the host only,
// the host relays what the others need. Two ways to connect, same message API:
//  - PeerJS: short room code, PeerJS's free cloud only introduces the browsers.
//  - Code swap: no server at all. Invite/reply codes (WebRTC offer/answer) are copied by hand,
//    one invite per friend. Works great over Tailscale or the same Wi-Fi.
// Every connection is a "link" with an id. Callbacks get that id: onMsg(m, id), onOpen(id), onClose(id).
PB.Net = (() => {
    const N = { links: new Map(), peer: null, pending: null, mic: null, onMsg: null, onOpen: null, onClose: null, onError: null };
    const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
    const PREFIX = 'prisonbosspc-';
    let nextId = 1;

    // Browsers hide local/VPN addresses (e.g. Tailscale 100.x) in WebRTC unless the page has mic/camera permission.
    // We keep a muted mic stream open so the real addresses are used. Nothing is recorded or sent.
    N.askMic = async () => {
        if (N.mic) return true;
        try {
            N.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            N.mic.getTracks().forEach(t => { t.enabled = false; });
            return true;
        } catch (e) { return false; }
    };
    N.releaseMic = () => { if (N.mic) { N.mic.getTracks().forEach(t => t.stop()); N.mic = null; } };

    function makeLink() {
        // ch = reliable ordered channel (actions, events) · fast = unordered, no retransmits (positions, snapshots):
        // a lost packet is simply replaced by the next one instead of stalling everything behind it
        const l = { id: nextId++, ch: null, fast: null, pc: null, open: false, closed: false };
        N.links.set(l.id, l);
        return l;
    }
    function opened(l) { l.open = true; if (N.onOpen) N.onOpen(l.id); }
    function closed(l) {
        if (l.closed) return;
        l.closed = true;
        const was = l.open;
        l.open = false;
        N.links.delete(l.id);
        if (N.pending === l) N.pending = null;
        try { if (l.ch) l.ch.close(); } catch (e) {}
        try { if (l.fast) l.fast.close(); } catch (e) {}
        try { if (l.pc) l.pc.close(); } catch (e) {}
        if (was && N.onClose) N.onClose(l.id);
    }
    function deliver(l, raw) {
        let m;
        try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
        if (m && N.onMsg) N.onMsg(m, l.id);
    }
    function sendLink(l, s, fast) {
        if (!l || !l.open || !l.ch) return;
        // big messages always go reliable (unreliable ones that big would get lost too often)
        const ch = fast && l.fast && l.fast.isOpen() && s.length < 12000 ? l.fast : l.ch;
        try { ch.send(s); } catch (e) { /* channel closing */ }
    }

    N.isOpen = () => [...N.links.values()].some(l => l.open);
    N.count = () => [...N.links.values()].filter(l => l.open).length;
    N.send = (obj, fast) => { const s = JSON.stringify(obj); N.links.forEach(l => sendLink(l, s, fast)); };       // to everyone
    N.sendTo = (id, obj, fast) => sendLink(N.links.get(id), JSON.stringify(obj), fast);
    N.sendExcept = (id, obj, fast) => { const s = JSON.stringify(obj); N.links.forEach(l => { if (l.id !== id) sendLink(l, s, fast); }); };
    N.drop = id => { const l = N.links.get(id); if (l) closed(l); };

    N.close = () => {
        [...N.links.values()].forEach(l => { l.open = false; closed(l); });
        try { if (N.peer) N.peer.destroy(); } catch (e) {}
        N.peer = null; N.pending = null;
    };

    // ---------- Code swap (raw WebRTC) ----------
    function wireDC(l, dc) {
        if (dc.label === 'pbfast') { wireFast(l, dc); return; }
        l.ch = dc;
        dc.onopen = () => opened(l);
        dc.onmessage = e => deliver(l, e.data);
        dc.onclose = () => closed(l);
    }
    function wireFast(l, dc) {
        l.fast = { send: s => dc.send(s), close: () => dc.close(), isOpen: () => dc.readyState === 'open' };
        dc.onmessage = e => deliver(l, e.data);
    }
    function watch(l) {
        l.pc.onconnectionstatechange = () => {
            if (l.pc.connectionState === 'failed' || l.pc.connectionState === 'closed') closed(l);
        };
    }
    function gather(pc) {
        return new Promise(res => {
            if (pc.iceGatheringState === 'complete') return res();
            const t = setTimeout(res, 4000);
            pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
            });
        });
    }
    const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
    const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));

    async function encode(desc) {
        const json = JSON.stringify({ t: desc.type, s: desc.sdp });
        if (window.CompressionStream) {
            const st = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
            return 'PB1' + toB64(new Uint8Array(await new Response(st).arrayBuffer()));
        }
        return 'PB0' + btoa(unescape(encodeURIComponent(json)));
    }
    async function decode(code) {
        code = (code || '').replace(/\s+/g, '');
        const v = code.slice(0, 3), body = code.slice(3);
        let json;
        if (v === 'PB1') {
            const st = new Blob([fromB64(body)]).stream().pipeThrough(new DecompressionStream('deflate'));
            json = await new Response(st).text();
        } else if (v === 'PB0') json = decodeURIComponent(escape(atob(body)));
        else throw new Error('That is not a Prison Boss code.');
        const o = JSON.parse(json);
        return { type: o.t, sdp: o.s };
    }

    // Host: a new invite code for the next friend (an unanswered older invite is thrown away)
    N.manualHost = async () => {
        if (N.pending && !N.pending.open) closed(N.pending);
        const l = N.pending = makeLink();
        l.pc = new RTCPeerConnection(ICE);
        watch(l);
        wireDC(l, l.pc.createDataChannel('pb', { ordered: true }));
        wireFast(l, l.pc.createDataChannel('pbfast', { ordered: false, maxRetransmits: 0 }));
        await l.pc.setLocalDescription(await l.pc.createOffer());
        await gather(l.pc);
        return encode(l.pc.localDescription);
    };
    N.manualFinish = async reply => {
        if (!N.pending) throw new Error('Create an invite code first.');
        const d = await decode(reply);
        if (d.type !== 'answer') throw new Error('That is an invite code. Paste your friend\'s REPLY code here.');
        await N.pending.pc.setRemoteDescription(d);
        N.pending = null;
    };
    N.manualJoin = async invite => {
        const d = await decode(invite);
        if (d.type !== 'offer') throw new Error('That is a reply code. Paste the host\'s INVITE code here.');
        N.close();
        const l = makeLink();
        l.pc = new RTCPeerConnection(ICE);
        watch(l);
        l.pc.ondatachannel = e => wireDC(l, e.channel);
        await l.pc.setRemoteDescription(d);
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        await gather(l.pc);
        return encode(l.pc.localDescription);
    };

    // ---------- PeerJS ----------
    function loadPeer() {
        return new Promise((res, rej) => {
            if (window.Peer) return res();
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
            s.onload = () => res();
            s.onerror = () => rej(new Error('Could not load PeerJS. Are you online?'));
            document.head.appendChild(s);
        });
    }
    function wirePeer(c) {
        // the second, unreliable connection from the same browser joins that player's link
        if (c.label === 'pbfast') {
            const l = [...N.links.values()].find(x => x.peerId === c.peer);
            if (!l) { setTimeout(() => wirePeer(c), 300); return null; } // fast one arrived first: wait for the main one
            l.fast = { send: d => c.send(d), close: () => c.close(), isOpen: () => c.open };
            c.on('data', d => deliver(l, d));
            return l;
        }
        const l = makeLink();
        l.peerId = c.peer;
        l.ch = { send: d => c.send(d), close: () => c.close() };
        c.on('open', () => opened(l));
        c.on('data', d => deliver(l, d));
        c.on('close', () => closed(l));
        c.on('error', () => closed(l));
        return l;
    }
    const peerError = e => {
        const t = e && e.type;
        if (t === 'peer-unavailable') return 'No game found with that room code.';
        if (t === 'unavailable-id') return 'That room code is taken. Try hosting again.';
        if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Can\'t reach the PeerJS server. Try the code swap instead.';
        return (e && e.message) || 'Connection error.';
    };

    // Host: open a room. Everyone who connects becomes a link; the co-op layer decides if there's a free slot.
    N.peerHost = async () => {
        N.close();
        await loadPeer();
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 5; i++) code += A[Math.floor(Math.random() * A.length)];
        return new Promise((res, rej) => {
            const p = N.peer = new Peer(PREFIX + code, { config: ICE });
            let ready = false;
            p.on('open', () => { ready = true; res(code); });
            p.on('error', e => { if (!ready) rej(new Error(peerError(e))); else if (N.onError) N.onError(peerError(e)); });
            p.on('connection', c => wirePeer(c));
        });
    };
    N.peerJoin = async code => {
        N.close();
        await loadPeer();
        return new Promise((res, rej) => {
            const p = N.peer = new Peer(undefined, { config: ICE });
            let ready = false;
            p.on('open', () => {
                ready = true;
                const id = PREFIX + code.trim().toUpperCase();
                wirePeer(p.connect(id, { reliable: true }));
                // a second channel without retransmits for positions (lower lag on bad Wi-Fi)
                setTimeout(() => { if (N.peer === p) wirePeer(p.connect(id, { reliable: false, label: 'pbfast', serialization: 'json' })); }, 400);
                res();
            });
            p.on('error', e => { if (!ready) rej(new Error(peerError(e))); else if (N.onError) N.onError(peerError(e)); });
        });
    };

    N._test = { encode, decode };
    return N;
})();
