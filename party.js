'use strict';
/* =====================================================================
   PARTY LOBBY for Banger Games
   Friends meet in a party (PeerJS room code, or a Tailscale code swap).
   When the party leader clicks a game, it opens for everyone inside the
   page, and each game's party-adapter.js (in the game's folder) works the
   game's own multiplayer menu: it hosts, reads the room code / invite,
   and the party passes it to everyone else, who join automatically.
   The games' own code is never changed.
   Needs the site to be served over http(s) (e.g. GitHub Pages): browsers
   block a page from reaching into a game frame when opened as a file.
   ===================================================================== */
(() => {
  const PEERJS_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'banger-party-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  const ADAPTERS = window.PartyAdapters = window.PartyAdapters || {};

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.random() * CODE_CHARS.length | 0]).join('');
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } }
  };

  const P = {
    tab: store.get('party_tab', 'peer'),  // which join method the start screen shows
    mode: null,                 // 'peer' | 'ts' (how the party itself is connected)
    role: null,                 // 'host' | 'guest'
    code: '', me: uid(), name: store.get('party_name', ''),
    members: [],                // [{ id, name }], leader first
    links: new Map(),           // leader: memberId -> link · guest: 'host' -> link
    peer: null,                 // PeerJS object
    invites: [],                // Tailscale leader: party invites waiting for a reply
    joinReply: '',              // Tailscale guest: reply code to send back
    busy: '', err: '',
    gameNet: 'peer',            // how games connect: 'peer' | 'ts'
    game: null,                 // the game running now (see launch())
    chat: [],
    mic: false,
    open: store.get('party_open', '1') === '1'
  };

  /* ---------------- Codes for the Tailscale swap ---------------- */
  const b64 = u8 => { let s = ''; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function encodeSDP(desc) {
    const txt = JSON.stringify({ t: desc.type, s: desc.sdp });
    if (window.CompressionStream) {
      const buf = await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
      return 'BP1:' + b64(new Uint8Array(buf));
    }
    return 'BP0:' + btoa(unescape(encodeURIComponent(txt)));
  }
  async function decodeSDP(code) {
    code = String(code || '').trim().replace(/\s+/g, '');
    let txt;
    if (code.startsWith('BP1:')) txt = await new Response(new Blob([unb64(code.slice(4))]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    else if (code.startsWith('BP0:')) txt = decodeURIComponent(escape(atob(code.slice(4))));
    else throw new Error('That is not a party code. Party codes start with BP.');
    const o = JSON.parse(txt);
    return { type: o.t, sdp: o.s };
  }
  function waitIce(pc, ms = 4000) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  const isTailscale = ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || /^fd7a:115c:a1e0/i.test(ip);
  const hasTailscale = sdp => [...String(sdp).matchAll(/a=candidate:\S+ \d+ \S+ \d+ (\S+) /g)].some(m => isTailscale(m[1]));

  // Browsers hide local addresses (incl. Tailscale's 100.x) unless the page has microphone permission.
  // The mic is switched straight off again: nothing is recorded or sent.
  async function ensureMic() {
    if (P.mic) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      P.mic = true;
    } catch (e) { P.mic = false; }
    render();
    return P.mic;
  }

  /* ---------------- Links (one per connection) ---------------- */
  function peerLink(conn) {
    const l = { id: null, send: m => { try { if (conn.open) conn.send(m); } catch (e) { } }, close: () => { try { conn.close(); } catch (e) { } } };
    conn.on('data', m => onMsg(l, m));
    conn.on('close', () => onLinkClosed(l));
    conn.on('error', () => onLinkClosed(l));
    return l;
  }
  function rtcLink(pc, dc) {
    const l = { id: null, pc, send: m => { try { if (dc.readyState === 'open') dc.send(JSON.stringify(m)); } catch (e) { } }, close: () => { try { pc.close(); } catch (e) { } } };
    dc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(l, m); };
    dc.onclose = () => onLinkClosed(l);
    return l;
  }
  function loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PEERJS_SRC;
      s.onload = () => res();
      s.onerror = () => { s.remove(); rej(new Error('Could not load PeerJS. Are you online?')); };
      document.head.appendChild(s);
    });
  }

  /* ---------------- Creating / joining a party ---------------- */
  function myName() { return (P.name || '').trim().slice(0, 16) || 'Player'; }
  function resetParty() {
    P.links.forEach(l => l.close());
    P.links.clear();
    P.invites.forEach(i => { try { i.pc.close(); } catch (e) { } });
    P.invites = [];
    if (P.peer) { try { P.peer.destroy(); } catch (e) { } }
    Object.assign(P, { mode: null, role: null, code: '', members: [], peer: null, joinReply: '', busy: '', game: null, chat: [] });
    document.body.classList.remove('in-party');
  }
  function becomeHost(mode) {
    P.mode = mode; P.role = 'host'; P.gameNet = mode;
    P.members = [{ id: P.me, name: myName() }];
    document.body.classList.add('in-party');
    sys('You started a party. Click a game to start it for everyone.');
  }

  async function hostPeer() {
    P.busy = 'Creating a party…'; P.err = ''; render();
    try { await loadPeerJS(); } catch (e) { P.busy = ''; P.err = e.message; render(); return; }
    const attempt = n => {
      const code = makeCode(), peer = new Peer(PREFIX + code.toLowerCase(), { debug: 0, config: { iceServers: STUN } });
      P.peer = peer;
      peer.on('open', () => { P.busy = ''; P.code = code; becomeHost('peer'); render(); });
      peer.on('connection', conn => peerLink(conn));
      peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { } });
      peer.on('error', e => {
        if (P.peer !== peer) return;
        if (e.type === 'unavailable-id' && n < 5) { peer.destroy(); attempt(n + 1); return; }
        if (!P.role) { P.busy = ''; P.err = 'Network error: ' + e.type; P.peer = null; try { peer.destroy(); } catch (err) { } render(); }
      });
    };
    attempt(0);
  }
  async function joinPeer(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { P.err = 'Party codes have 5 letters or numbers.'; render(); return; }
    P.busy = 'Looking for party ' + code + '…'; P.err = ''; render();
    try { await loadPeerJS(); } catch (e) { P.busy = ''; P.err = e.message; render(); return; }
    const peer = new Peer({ debug: 0, config: { iceServers: STUN } });
    P.peer = peer;
    const fail = msg => { if (P.peer !== peer) return; P.busy = ''; P.err = msg; try { peer.destroy(); } catch (e) { } P.peer = null; render(); };
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        const l = peerLink(conn);
        l.id = 'host';
        P.links.set('host', l);
        P.mode = 'peer'; P.code = code;
        l.send({ t: 'hello', id: P.me, name: myName() });
      });
      setTimeout(() => { if (!P.role && P.peer === peer) fail('No party answered. Check the code, and that your friend still has the page open.'); }, 15000);
    });
    peer.on('error', e => { if (!P.role) fail(e.type === 'peer-unavailable' ? 'There is no party with that code.' : 'Network error: ' + e.type); });
  }

  // Tailscale: the leader makes one invite per friend, the friend answers with a reply code.
  async function tsHostStart() {
    P.busy = 'Asking for the microphone…'; P.err = ''; render();
    if (!await ensureMic()) P.err = 'Microphone blocked: your Tailscale address stays hidden, so friends probably can\'t connect. Allow the mic in the address bar.';
    P.busy = '';
    becomeHost('ts');
    render();
    tsNewInvite();
  }
  async function tsNewInvite() {
    const pc = new RTCPeerConnection({ iceServers: STUN }), dc = pc.createDataChannel('party', { negotiated: true, id: 0, ordered: true });
    const inv = { id: uid(), pc, code: '', state: 'Preparing the invite…' };
    P.invites.push(inv); render();
    const l = rtcLink(pc, dc);
    dc.onopen = () => { inv.state = 'connected'; P.invites = P.invites.filter(i => i !== inv); render(); };
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    inv.code = await encodeSDP(pc.localDescription);
    inv.state = hasTailscale(pc.localDescription.sdp) ? 'Send this invite to ONE friend, then paste their reply below.' : 'No Tailscale address found (is Tailscale on, and the mic allowed?). It may still work on the same Wi-Fi.';
    inv.link = l;
    render();
  }
  async function tsAccept(invId, reply) {
    const inv = P.invites.find(i => i.id === invId);
    if (!inv) return;
    try {
      const d = await decodeSDP(reply);
      if (d.type !== 'answer') throw new Error('That is an invite. Paste your friend\'s REPLY code.');
      await inv.pc.setRemoteDescription(d);
      inv.state = 'Connecting…';
      setTimeout(() => { if (P.invites.includes(inv)) { inv.state = 'Still not connected. Check that both of you are online in Tailscale, then make a new invite.'; render(); } }, 25000);
    } catch (e) { inv.state = '⚠️ ' + e.message; }
    render();
  }
  async function tsJoin(invite) {
    P.busy = 'Making your reply code…'; P.err = ''; render();
    let d;
    try { d = await decodeSDP(invite); if (d.type !== 'offer') throw new Error('Paste the leader\'s INVITE code, not a reply.'); }
    catch (e) { P.busy = ''; P.err = e.message; render(); return; }
    if (!await ensureMic()) P.err = 'Microphone blocked: your Tailscale address stays hidden, so this will probably fail.';
    const pc = new RTCPeerConnection({ iceServers: STUN }), dc = pc.createDataChannel('party', { negotiated: true, id: 0, ordered: true });
    const l = rtcLink(pc, dc);
    dc.onopen = () => {
      l.id = 'host';
      P.links.set('host', l);
      P.mode = 'ts';
      l.send({ t: 'hello', id: P.me, name: myName() });
    };
    await pc.setRemoteDescription(d);
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    P.joinReply = await encodeSDP(pc.localDescription);
    P.busy = 'Send the reply code to the leader and wait…';
    render();
  }

  function leaveParty() {
    if (P.role === 'host') broadcast({ t: 'bye' });
    resetParty();
    render();
  }

  /* ---------------- Messages ---------------- */
  function send(id, m) { const l = P.links.get(id); if (l) l.send(m); }
  function broadcast(m, except) { if (P.role !== 'host') return; P.links.forEach((l, id) => { if (id !== except) l.send(m); }); }
  function toLeader(m) { send('host', m); }
  const nameOf = id => (P.members.find(m => m.id === id) || {}).name || 'Someone';
  function roster() { broadcast({ t: 'roster', members: P.members }); render(); }
  function sys(text) { addChat(null, text); }
  function addChat(from, text) {
    P.chat.push({ from, text });
    if (P.chat.length > 80) P.chat.shift();
    render();
  }

  function onMsg(l, m) {
    if (!m || typeof m !== 'object') return;
    if (P.role === 'host') hostMsg(l, m);
    else guestMsg(m);
  }
  function hostMsg(l, m) {
    switch (m.t) {
      case 'hello': {
        if (P.role !== 'host') return;
        const id = String(m.id || uid()), name = String(m.name || 'Player').slice(0, 16);
        l.id = id;
        P.links.set(id, l);
        P.members = P.members.filter(x => x.id !== id).concat({ id, name });
        l.send({ t: 'welcome', code: P.code, mode: P.mode, net: P.gameNet });
        roster();
        sys(name + ' joined the party.');
        broadcast({ t: 'chat', from: null, text: name + ' joined the party.' }, id);
        if (P.game) bringIn(id);
        break;
      }
      case 'chat': {
        const text = String(m.text || '').slice(0, 300);
        if (!text || !l.id) return;
        addChat(nameOf(l.id), text);
        broadcast({ t: 'chat', from: nameOf(l.id), text }, l.id);
        break;
      }
      case 'reply': {
        const w = waiters.get(m.invId);
        if (w) { waiters.delete(m.invId); w(String(m.reply || '')); }
        break;
      }
      case 'gstatus': {
        const mem = P.members.find(x => x.id === l.id);
        if (mem) { mem.st = String(m.text || '').slice(0, 80); render(); }
        break;
      }
    }
  }
  function guestMsg(m) {
    switch (m.t) {
      case 'welcome':
        P.role = 'guest'; P.busy = ''; P.err = ''; P.joinReply = '';
        if (m.code) P.code = m.code;
        P.gameNet = m.net || P.mode;
        document.body.classList.add('in-party');
        sys('You joined the party. The leader picks the game.');
        break;
      case 'roster': P.members = Array.isArray(m.members) ? m.members : []; render(); break;
      case 'chat': addChat(m.from, String(m.text || '')); break;
      case 'net': P.gameNet = m.net; render(); break;
      case 'launch': launchGuest(m); break;
      case 'code': if (P.game && P.game.lid === m.lid) { P.game.code = m.code; P.game.inbox.push({ k: 'code', code: m.code }); pump(); } break;
      case 'invite': if (P.game && P.game.lid === m.lid) { P.game.inbox.push({ k: 'invite', invId: m.invId, invite: m.invite }); pump(); } break;
      case 'endgame': if (P.game && P.game.lid === m.lid) { sys('The leader closed the game.'); P.game.ended = true; render(); } break;
      case 'bye': sys('The leader closed the party.'); resetParty(); render(); break;
    }
  }
  function onLinkClosed(l) {
    if (P.role === 'host') {
      if (!l.id || P.links.get(l.id) !== l) return;
      const name = nameOf(l.id);
      P.links.delete(l.id);
      P.members = P.members.filter(x => x.id !== l.id);
      if (P.game) P.game.queue = P.game.queue.filter(x => x !== l.id);
      roster();
      sys(name + ' left the party.');
      broadcast({ t: 'chat', from: null, text: name + ' left the party.' });
    } else if (l.id === 'host' && P.links.get('host') === l) {
      sys('Lost the connection to the party leader.');
      const chat = P.chat;
      resetParty();
      P.chat = chat;
      P.err = 'Lost the connection to the party.';
      render();
    }
  }

  /* ---------------- The game frame ---------------- */
  let session = 0;
  function openFrame(idx) {
    const g = GAMES[idx];
    session++;
    let box = $('pg-frame');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pg-frame';
      box.innerHTML = `<div class="pg-bar"><button class="pg-back" id="pg-back" title="The game keeps running">← Games</button><b id="pg-title"></b><span id="pg-gst"></span><button class="pg-quit" id="pg-quit">Quit game</button></div>
        <iframe id="pg-iframe" allow="microphone; camera; autoplay; fullscreen; gamepad; xr-spatial-tracking; clipboard-read; clipboard-write" allowfullscreen></iframe>`;
      document.body.appendChild(box);
      $('pg-back').onclick = () => { document.body.classList.remove('pg-playing'); render(); };
      $('pg-quit').onclick = () => { if (confirm('Quit the game?')) closeFrame(); };
    }
    $('pg-title').textContent = g.title;
    const fr = $('pg-iframe');
    fr.src = 'about:blank';
    const my = session;
    // resolve on the game's load, not the blank page's (a file:// page can't read the href at all: let readyCtx explain)
    const loaded = new Promise(res => {
      fr.onload = () => {
        let href;
        try { href = fr.contentWindow.location.href; } catch (e) { href = 'blocked'; }
        if (session === my && href !== 'about:blank') res();
      };
    });
    setTimeout(() => { if (session === my) fr.src = encodeURI(g.file); }, 30);
    document.body.classList.add('pg-playing');
    setTimeout(() => fr.focus(), 400);
    return { fr, loaded, session: my };
  }
  function closeFrame() {
    session++;
    const fr = $('pg-iframe');
    if (fr) fr.src = 'about:blank';
    document.body.classList.remove('pg-playing');
    if (P.game) {
      if (P.role === 'host') broadcast({ t: 'endgame', lid: P.game.lid });
      P.game = null;
    }
    render();
  }
  function gStatus(text) {
    if (P.game) P.game.status = text;
    const el = $('pg-gst');
    if (el) el.textContent = text;
    if (P.role === 'guest') toLeader({ t: 'gstatus', text });
    else { const me = P.members.find(m => m.id === P.me); if (me) me.st = text; }
    render();
  }

  // Helpers the adapters use to work a game's menu inside the frame
  function makeCtx(frame, opts) {
    const alive = () => session === frame.session;
    const ctx = {
      get win() { return frame.fr.contentWindow; },
      get doc() { return frame.fr.contentDocument; },
      name: myName(),
      ts: !!opts.ts,
      size: Math.max(2, Math.min(4, P.members.length)),
      alive,
      $: sel => { const d = ctx.doc; return d ? d.querySelector(sel) : null; },
      get: expr => { try { return ctx.win.eval(expr); } catch (e) { return undefined; } },
      visible: sel => { const el = typeof sel === 'string' ? ctx.$(sel) : sel; return !!el && el.getClientRects().length > 0 && ctx.win.getComputedStyle(el).visibility !== 'hidden'; },
      click(sel) {
        const el = typeof sel === 'string' ? ctx.$(sel) : sel;
        if (!el) throw new Error('Could not find ' + sel + ' in the game.');
        el.click();
        return el;
      },
      type(sel, value) {
        const el = typeof sel === 'string' ? ctx.$(sel) : sel;
        if (!el) throw new Error('Could not find ' + sel + ' in the game.');
        el.value = value;
        el.dispatchEvent(new ctx.win.Event('input', { bubbles: true }));
        el.dispatchEvent(new ctx.win.Event('change', { bubbles: true }));
        return el;
      },
      async wait(fn, ms = 30000, what = '') {
        const end = Date.now() + ms;
        for (;;) {
          if (!alive()) throw new Error('cancelled');
          let v;
          try { v = fn(); } catch (e) { v = null; }
          if (v) return v;
          if (Date.now() > end) throw new Error('Timed out' + (what ? ' waiting for ' + what : '') + '.');
          await sleep(200);
        }
      },
      sleep: async ms => { await sleep(ms); if (!alive()) throw new Error('cancelled'); },
      status: gStatus
    };
    return ctx;
  }
  async function readyCtx(frame, adapter, opts) {
    await frame.loaded;
    try { void frame.fr.contentDocument.body; }
    catch (e) { throw new Error('This page was opened as a file, so it can\'t reach into the game. Open the website (https://…) instead.'); }
    if (!frame.fr.contentDocument) throw new Error('This page was opened as a file, so it can\'t reach into the game. Open the website (https://…) instead.');
    const ctx = makeCtx(frame, opts);
    gStatus('Loading the game…');
    await adapter.ready(ctx);
    return ctx;
  }

  /* ---------------- Launching a game for the party ---------------- */
  // How a game connects: Tailscale only if the party chose it AND the game supports it.
  function netFor(adapter, net) { return net === 'ts' && adapter.ts ? 'ts' : 'peer'; }
  let lidSeq = 0;
  const waiters = new Map();

  function launch(idx) {
    const g = GAMES[idx], adapter = ADAPTERS[g.party];
    if (!adapter) {
      openFrame(idx);
      sys(g.title + ' can\'t be played online, so it opened just for you.');
      return;
    }
    const net = netFor(adapter, P.gameNet);
    if (P.gameNet === 'ts' && net !== 'ts') sys(g.title + ' doesn\'t support Tailscale, so it connects with PeerJS.');
    const lid = Date.now() + '-' + (++lidSeq);
    const frame = openFrame(idx);
    P.game = { idx, lid, net, code: null, queue: [], status: '', frame, adapter, ctx: null };
    broadcast({ t: 'launch', idx, file: g.file, lid, net });
    sys('Starting ' + g.title + ' for everyone' + (P.members.length > adapter.max ? ` (only ${adapter.max} can play it)` : '') + '…');
    runHost(P.game).catch(e => fail(P.game, e));
  }
  function fail(game, e) {
    if (!game || P.game !== game || e.message === 'cancelled') return;
    game.error = e.message;
    gStatus('⚠️ ' + e.message + ' You can still use the game\'s own multiplayer menu.');
  }
  async function runHost(game) {
    const { adapter, net } = game;
    const ctx = game.ctx = await readyCtx(game.frame, adapter, { ts: net === 'ts' });
    if (net === 'ts' && adapter.ts === 'manual') {
      gStatus('Opening the game for your friends…');
      await adapter.hostManual(ctx);
      P.members.forEach(m => { if (m.id !== P.me) game.queue.push(m.id); });
      inviteLoop(game);
    } else {
      gStatus('Creating a room…');
      const code = await adapter.host(ctx, { ts: net === 'ts' });
      if (P.game !== game) return;
      game.code = code;
      broadcast({ t: 'code', lid: game.lid, code });
      gStatus('Room ' + code + ' is open. Friends are joining…');
    }
  }
  // A member who joined the party while a game was already running
  function bringIn(id) {
    const game = P.game;
    send(id, { t: 'launch', idx: game.idx, file: GAMES[game.idx].file, lid: game.lid, net: game.net });
    if (game.net === 'ts' && game.adapter.ts === 'manual') {
      if (game.ctx) { game.queue.push(id); inviteLoop(game); }
    } else if (game.code) send(id, { t: 'code', lid: game.lid, code: game.code });
  }
  // Tailscale code swap, one friend at a time (some games only keep one invite open)
  async function inviteLoop(game) {
    if (game.inviting) return;
    game.inviting = true;
    try {
      while (P.game === game && game.queue.length) {
        const id = game.queue.shift();
        if (!P.links.has(id)) continue;
        try {
          gStatus('Making an invite for ' + nameOf(id) + '…');
          const inv = await game.adapter.makeInvite(game.ctx);
          const invId = uid();
          send(id, { t: 'invite', lid: game.lid, invId, invite: inv.code });
          gStatus('Waiting for ' + nameOf(id) + '\'s game to answer…');
          const reply = await new Promise((res, rej) => {
            waiters.set(invId, res);
            setTimeout(() => { if (waiters.delete(invId)) rej(new Error(nameOf(id) + '\'s game didn\'t answer in time.')); }, 120000);
          });
          gStatus('Connecting ' + nameOf(id) + '…');
          await game.adapter.acceptReply(game.ctx, inv, reply);
          sys(nameOf(id) + ' is connected to the game.');
        } catch (e) {
          if (e.message === 'cancelled') return;
          sys('⚠️ Could not connect ' + nameOf(id) + ': ' + e.message);
        }
      }
      if (P.game === game) gStatus('Everyone is invited.');
    } finally { game.inviting = false; }
  }

  function launchGuest(m) {
    const idx = GAMES.findIndex(g => g.file === m.file);
    if (idx < 0) { sys('The leader started a game this page doesn\'t know. Refresh the page (Ctrl+F5) to get the newest version.'); return; }
    const g = GAMES[idx], adapter = ADAPTERS[g.party];
    const frame = openFrame(idx);
    P.game = { idx, lid: m.lid, net: m.net, inbox: [], frame, adapter, ctx: null, code: null };
    sys('The leader started ' + g.title + '.');
    if (!adapter) return;
    const game = P.game;
    readyCtx(frame, adapter, { ts: m.net === 'ts' })
      .then(ctx => { game.ctx = ctx; gStatus('Waiting for the leader\'s room…'); pump(); })
      .catch(e => fail(game, e));
  }
  // Guest: handle codes / invites from the leader once the game has loaded
  async function pump() {
    const game = P.game;
    if (!game || !game.ctx || game.pumping) return;
    game.pumping = true;
    try {
      while (P.game === game && game.inbox.length) {
        const job = game.inbox.shift();
        if (job.k === 'code') {
          gStatus('Joining room ' + job.code + '…');
          await game.adapter.join(game.ctx, job.code, { ts: game.net === 'ts' });
          gStatus('Joined room ' + job.code + '.');
        } else {
          gStatus('Answering the leader\'s invite…');
          const reply = await game.adapter.answerInvite(game.ctx, job.invite);
          toLeader({ t: 'reply', invId: job.invId, reply });
          gStatus('Reply sent. Connecting…');
        }
      }
    } catch (e) { fail(game, e); }
    finally { game.pumping = false; }
  }

  /* ---------------- Panel UI ---------------- */
  function buildPanel() {
    const el = document.createElement('aside');
    el.id = 'party';
    el.innerHTML = `<button id="party-tab" title="Party">👥<span>Party</span></button>
      <div class="pt-head"><h3>Party</h3><button class="pt-x" id="party-hide" title="Hide">→</button></div>
      <div class="pt-body" id="party-body"></div>`;
    document.body.appendChild(el);
    $('party-tab').onclick = () => setOpen(true);
    $('party-hide').onclick = () => setOpen(false);
    el.addEventListener('click', onPanelClick);
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'pt-chat-in') { e.preventDefault(); sendChat(); }
      if (e.target.id === 'pt-code') joinPeer(e.target.value);
    });
    el.addEventListener('input', e => {
      if (e.target.id === 'pt-name') { P.name = e.target.value; store.set('party_name', P.name); }
    });
    setOpen(P.open);
  }
  function setOpen(on) {
    P.open = on;
    store.set('party_open', on ? '1' : '0');
    document.body.classList.toggle('party-open', on);
  }
  function sendChat() {
    const inp = $('pt-chat-in'), text = inp.value.trim().slice(0, 300);
    if (!text) return;
    inp.value = '';
    addChat(myName(), text);
    if (P.role === 'host') broadcast({ t: 'chat', from: myName(), text });
    else toLeader({ t: 'chat', text });
  }
  function onPanelClick(e) {
    const b = e.target.closest('[data-p]');
    if (!b || b.disabled) return;
    const v = b.dataset.p;
    if (v === 'tab') { P.tab = b.dataset.v; store.set('party_tab', P.tab); P.err = ''; render(); }
    else if (v === 'host') P.tab === 'ts' ? tsHostStart() : hostPeer();
    else if (v === 'join') joinPeer($('pt-code').value);
    else if (v === 'tsjoin') tsJoin($('pt-inv-in').value);
    else if (v === 'mic') ensureMic();
    else if (v === 'invite') tsNewInvite();
    else if (v === 'accept') { const ta = document.querySelector(`[data-reply="${b.dataset.id}"]`); if (ta && ta.value.trim()) tsAccept(b.dataset.id, ta.value); }
    else if (v === 'dropinv') { const inv = P.invites.find(i => i.id === b.dataset.id); if (inv) { try { inv.pc.close(); } catch (err) { } P.invites = P.invites.filter(i => i !== inv); render(); } }
    else if (v === 'copy') copyText(b.dataset.text || (document.getElementById(b.dataset.from) || {}).value || '', b);
    else if (v === 'net') { P.gameNet = b.dataset.v; broadcast({ t: 'net', net: P.gameNet }); render(); }
    else if (v === 'leave') { if (confirm(P.role === 'host' ? 'Close the party for everyone?' : 'Leave the party?')) { closeFrame(); leaveParty(); } }
    else if (v === 'chat') sendChat();
    else if (v === 'retry' && P.game) {
      const idx = P.game.idx;
      if (P.role === 'host') launch(idx);
      else sys('Ask the leader to start the game again.');
    }
    else if (v === 'show' && P.game) { document.body.classList.add('pg-playing'); render(); }
  }
  function copyText(text, btn) {
    if (!text) return;
    const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = t, 1200); } };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { });
    else done();
  }

  function render() {
    const body = $('party-body');
    if (!body) return;
    // keep what people are typing across re-renders
    const keep = {};
    body.querySelectorAll('input[id], textarea[id], textarea[data-reply]').forEach(t => keep[t.id || 'r' + t.dataset.reply] = t.value);
    const focus = document.activeElement && body.contains(document.activeElement) ? (document.activeElement.id || 'r' + document.activeElement.dataset.reply) : null;
    body.innerHTML = P.role ? partyHTML() : startHTML();
    body.querySelectorAll('input[id], textarea[id], textarea[data-reply]').forEach(t => {
      const k = t.id || 'r' + t.dataset.reply;
      if (keep[k] != null && !t.readOnly) t.value = keep[k];
    });
    if (focus) { const f = document.getElementById(focus) || body.querySelector(`[data-reply="${focus.slice(1)}"]`); if (f) f.focus(); }
    const chat = $('pt-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    document.querySelectorAll('.item').forEach(it => it.classList.toggle('pt-ok', !!ADAPTERS[(GAMES[it.dataset.idx] || {}).party]));
  }
  const fileWarning = () => location.protocol === 'file:' ? '<p class="pt-warn">You opened this page as a file. The party can only connect games on the website (https://…). Upload it to GitHub Pages and open it there.</p>' : '';

  function startHTML() {
    const ts = P.tab === 'ts';
    let h = fileWarning();
    h += `<p class="pt-lede">Play together: start a party, send the code to your friends, then pick a game. It opens and connects for everyone.</p>
      <label class="pt-lbl" for="pt-name">Your name</label>
      <input id="pt-name" maxlength="16" placeholder="Player" value="${esc(P.name)}" autocomplete="off">
      <div class="pt-seg"><button data-p="tab" data-v="peer" class="${ts ? '' : 'on'}">Room code</button><button data-p="tab" data-v="ts" class="${ts ? 'on' : ''}">Tailscale</button></div>`;
    if (!ts) {
      h += `<p class="pt-note">Works anywhere with internet. PeerJS only introduces you; the games then talk directly.</p>
        <button class="pt-btn pri" data-p="host" ${P.busy ? 'disabled' : ''}>Start a party</button>
        <div class="pt-or">or join one</div>
        <div class="pt-row"><input id="pt-code" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false"><button class="pt-btn" data-p="join" ${P.busy ? 'disabled' : ''}>Join</button></div>`;
    } else {
      h += `<p class="pt-note">No servers. Everyone needs Tailscale turned on, and the browser needs the microphone allowed: only then does it show your Tailscale address. The mic is switched straight off, nothing is recorded.</p>
        <button class="pt-btn" data-p="mic">${P.mic ? '🎤 Microphone allowed ✓' : '🎤 Allow microphone'}</button>
        <button class="pt-btn pri" data-p="host" ${P.busy ? 'disabled' : ''}>Start a party</button>
        <div class="pt-or">or join one</div>
        <label class="pt-lbl" for="pt-inv-in">1 · Paste the leader's invite code</label>
        <textarea id="pt-inv-in" placeholder="BP1:…" spellcheck="false"></textarea>
        <button class="pt-btn" data-p="tsjoin" ${P.busy && !P.joinReply ? 'disabled' : ''}>Make my reply code</button>`;
      if (P.joinReply) h += `<label class="pt-lbl">2 · Send this reply code back to the leader</label>
        <textarea id="pt-reply-out" readonly>${esc(P.joinReply)}</textarea>
        <button class="pt-btn" data-p="copy" data-from="pt-reply-out">Copy reply code</button>`;
    }
    if (P.busy) h += `<p class="pt-busy">${esc(P.busy)}</p>`;
    if (P.err) h += `<p class="pt-err">${esc(P.err)}</p>`;
    return h;
  }

  function partyHTML() {
    const host = P.role === 'host';
    let h = fileWarning();
    if (P.mode === 'peer') h += `<div class="pt-code"><span>Party code</span><b>${esc(P.code)}</b><button class="pt-btn sm" data-p="copy" data-text="${esc(P.code)}">Copy</button></div>`;
    else h += `<div class="pt-code"><span>Party over</span><b class="ts">Tailscale</b></div>`;

    h += `<div class="pt-sec"><h4>In the party · ${P.members.length}</h4><ul class="pt-list">`;
    P.members.forEach((m, i) => {
      h += `<li><i style="background:${['#b8502f', '#3f7fa8', '#3f8a5f', '#8a62c8', '#c9a227', '#c2553a'][i % 6]}"></i><b>${esc(m.name)}</b>${i === 0 ? '<em>leader</em>' : ''}${m.id === P.me ? '<em>you</em>' : ''}${m.st && P.game ? `<small>${esc(m.st)}</small>` : ''}</li>`;
    });
    h += '</ul>';
    if (host && P.mode === 'ts') {
      h += '<p class="pt-note">For each friend: send them an invite, paste their reply, press Connect.</p>';
      P.invites.forEach(inv => {
        h += `<div class="pt-inv"><p class="pt-note">${esc(inv.state)}</p>`;
        if (inv.code) h += `<textarea id="inv-${inv.id}" readonly>${esc(inv.code)}</textarea>
          <button class="pt-btn sm" data-p="copy" data-from="inv-${inv.id}">Copy invite</button>
          <textarea data-reply="${inv.id}" placeholder="Paste their reply code (BP1:…)" spellcheck="false"></textarea>
          <div class="pt-row"><button class="pt-btn sm pri" data-p="accept" data-id="${inv.id}">Connect</button><button class="pt-btn sm" data-p="dropinv" data-id="${inv.id}">Cancel</button></div>`;
        h += '</div>';
      });
      h += `<button class="pt-btn" data-p="invite">+ Invite another friend</button>`;
    }
    h += '</div>';

    h += `<div class="pt-sec"><h4>Games connect with</h4>`;
    if (host) h += `<div class="pt-seg"><button data-p="net" data-v="peer" class="${P.gameNet === 'peer' ? 'on' : ''}">PeerJS</button><button data-p="net" data-v="ts" class="${P.gameNet === 'ts' ? 'on' : ''}">Tailscale</button></div>`;
    else h += `<p class="pt-note"><b>${P.gameNet === 'ts' ? 'Tailscale' : 'PeerJS'}</b> (the leader chooses)</p>`;
    if (P.gameNet === 'ts') h += '<p class="pt-note">Rooftop Snipers and Divočina only support PeerJS and use it automatically. Allow the microphone when a game asks.</p>';
    h += '</div>';

    h += '<div class="pt-sec"><h4>Now playing</h4>';
    if (P.game) {
      const g = GAMES[P.game.idx];
      h += `<p class="pt-now"><b>${esc(g.title)}</b></p><p class="pt-note">${esc(P.game.status || '')}</p>`;
      if (P.game.code) h += `<div class="pt-code sm"><span>Game room</span><b>${esc(P.game.code)}</b><button class="pt-btn sm" data-p="copy" data-text="${esc(P.game.code)}">Copy</button></div>`;
      if (P.game.error && host) h += '<button class="pt-btn sm" data-p="retry">Try again</button>';
      if (!document.body.classList.contains('pg-playing')) h += '<button class="pt-btn sm pri" data-p="show">Back to the game</button>';
    } else if (document.querySelector('#pg-iframe') && document.body.classList.contains('pg-playing')) h += '<p class="pt-note">You\'re playing on your own.</p>';
    else h += `<p class="pt-note">${host ? 'Click a game on the page to start it for everyone.' : 'Waiting for the leader to pick a game…'}</p>`;
    h += '</div>';

    h += `<div class="pt-sec pt-chatsec"><h4>Chat</h4><div class="pt-chat" id="pt-chat">${P.chat.map(c => c.from ? `<p><b>${esc(c.from)}</b> ${esc(c.text)}</p>` : `<p class="sys">${esc(c.text)}</p>`).join('')}</div>
      <div class="pt-row"><input id="pt-chat-in" maxlength="300" placeholder="Say something…" autocomplete="off"><button class="pt-btn sm" data-p="chat">Send</button></div></div>`;
    if (P.err) h += `<p class="pt-err">${esc(P.err)}</p>`;
    h += `<button class="pt-btn ghost" data-p="leave">${host ? 'Close the party' : 'Leave the party'}</button>`;
    return h;
  }

  /* ---------------- Clicking a game while in a party ---------------- */
  function hookCards() {
    document.getElementById('grid').addEventListener('click', e => {
      const a = e.target.closest('a.card');
      if (!a || !P.role) return;
      e.preventDefault();
      const idx = +a.closest('.item').dataset.idx;
      if (P.role === 'host') {
        if (P.game && !confirm('Switch everyone to ' + GAMES[idx].title + '?')) return;
        launch(idx);
      } else {
        openFrame(idx);
        P.game = null;
        sys('Only the leader can start a game for everyone. ' + GAMES[idx].title + ' opened just for you.');
      }
    }, true);
  }

  window.addEventListener('beforeunload', () => { if (P.role === 'host') broadcast({ t: 'bye' }); });
  buildPanel();
  hookCards();
  render();
})();
