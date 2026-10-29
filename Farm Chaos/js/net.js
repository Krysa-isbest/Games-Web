// net.js — co-op transport. Two ways to connect, both end up as the same "conn" object:
//  1. Online code (PeerJS): host gets FARM-XXXXX, friends paste it. Needs PeerJS's free signaling server.
//  2. Direct code (Tailscale / LAN): copy-paste WebRTC offer/answer, no server at all.
'use strict';

const NET = {
  peer: null, conns: {}, host: null, onMsg: null, onJoin: null, onLeave: null, code: '',
  pendingDirect: null,

  // wrap a PeerJS DataConnection or an RTCDataChannel into {send, close, id}
  wrap(id, sendFn, closeFn) { return { id, send: sendFn, close: closeFn, open: true }; },

  // ---------------- host ----------------
  hostOnline(cb, fixed) {
    if (typeof Peer === 'undefined') { cb(null, 'PeerJS failed to load (offline?). Use a Direct code instead.'); return; }
    const code = fixed || Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    try { this.peer = new Peer('farmchaos-' + code.toLowerCase(), { debug: 0 }); } catch (e) { cb(null, String(e)); return; }
    this.peer.on('open', () => { this.code = 'FARM-' + code; cb(this.code); });
    this.peer.on('error', err => { if (err.type === 'unavailable-id') { this.peer.destroy(); this.hostOnline(cb); } else cb(null, 'Online hosting error: ' + err.type); });
    this.peer.on('connection', dc => {
      dc.on('open', () => {
        if (Object.keys(this.conns).length >= MAX_PLAYERS - 1) { dc.send({ k: 'full' }); setTimeout(() => dc.close(), 300); return; }
        const id = 'p' + U.uid().slice(0, 5);
        const c = this.wrap(id, m => { try { dc.send(m); } catch (e) { } }, () => dc.close());
        this.conns[id] = c;
        dc.on('data', m => this.onMsg && this.onMsg(id, m));
        dc.on('close', () => this.drop(id));
        dc.on('error', () => this.drop(id));
        if (this.onJoin) this.onJoin(id);
      });
    });
  },
  drop(id) { if (!this.conns[id]) return; delete this.conns[id]; if (this.onLeave) this.onLeave(id); },
  broadcast(m, except) { for (const id in this.conns) if (id !== except) this.conns[id].send(m); },
  sendTo(id, m) { if (this.conns[id]) this.conns[id].send(m); },

  // direct invite: one offer per friend
  async directInvite(tailscaleIp) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const dc = pc.createDataChannel('fc', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await this.iceDone(pc);
    const sdp = this.addTailscale(pc.localDescription.sdp, tailscaleIp);
    this.pendingDirect = { pc, dc };
    dc.onopen = () => {
      const id = 'd' + U.uid().slice(0, 5);
      this.conns[id] = this.wrap(id, m => { try { dc.send(JSON.stringify(m)); } catch (e) { } }, () => pc.close());
      dc.onmessage = ev => this.onMsg && this.onMsg(id, JSON.parse(ev.data));
      dc.onclose = () => this.drop(id);
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id); };
      if (this.onJoin) this.onJoin(id);
    };
    return 'FCD-' + await this.pack({ t: 'o', s: sdp });
  },
  async acceptAnswer(code) {
    if (!this.pendingDirect) throw new Error('Create an invite first');
    const d = await this.unpack(code.trim().replace(/^FCA-/, ''));
    await this.pendingDirect.pc.setRemoteDescription({ type: 'answer', sdp: d.s });
    this.pendingDirect = null;
  },

  // ---------------- client ----------------
  isDirectCode: code => /^FCD-/.test(code.trim()),
  joinOnline(code, cb) {
    if (typeof Peer === 'undefined') { cb(false, 'PeerJS failed to load.'); return; }
    const c = code.trim().toUpperCase().replace(/^FARM-/, '');
    this.peer = new Peer(undefined, { debug: 0 });
    this.peer.on('open', () => {
      const dc = this.peer.connect('farmchaos-' + c.toLowerCase(), { reliable: true, serialization: 'json' });
      const to = setTimeout(() => cb(false, 'Could not reach the host. Check the code.'), 12000);
      dc.on('open', () => {
        clearTimeout(to);
        this.host = this.wrap('host', m => { try { dc.send(m); } catch (e) { } }, () => dc.close());
        dc.on('data', m => this.onMsg && this.onMsg('host', m));
        dc.on('close', () => this.onLeave && this.onLeave('host'));
        cb(true);
      });
    });
    this.peer.on('error', err => cb(false, 'Connection error: ' + err.type));
  },
  async joinDirect(code, onOpen) {
    const d = await this.unpack(code.trim().replace(/^FCD-/, ''));
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.ondatachannel = ev => {
      const dc = ev.channel;
      dc.onopen = () => {
        this.host = this.wrap('host', m => { try { dc.send(JSON.stringify(m)); } catch (e) { } }, () => pc.close());
        dc.onmessage = e => this.onMsg && this.onMsg('host', JSON.parse(e.data));
        dc.onclose = () => this.onLeave && this.onLeave('host');
        onOpen();
      };
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: d.s });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.iceDone(pc);
    this.directPc = pc;
    return 'FCA-' + await this.pack({ t: 'a', s: pc.localDescription.sdp });
  },
  send(m) { if (this.host) this.host.send(m); },

  // ---------------- helpers ----------------
  iceDone(pc) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const to = setTimeout(res, 3500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(to); res(); } });
    });
  },
  // Chrome hides local IPs behind .local names; if the host typed their Tailscale IP we add
  // matching candidates so friends on the same tailnet can connect directly.
  addTailscale(sdp, ip) {
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip.trim())) return sdp;
    const lines = sdp.split('\r\n'), out = [];
    for (const l of lines) {
      out.push(l);
      const m = l.match(/^a=candidate:(\S+) (\d) udp (\d+) (\S+\.local) (\d+) typ host(.*)$/);
      if (m) out.push(`a=candidate:${m[1]}9 ${m[2]} udp ${m[3] - 1} ${ip.trim()} ${m[5]} typ host${m[6]}`);
    }
    return out.join('\r\n');
  },
  async pack(obj) {
    const txt = JSON.stringify(obj);
    if (window.CompressionStream) {
      const s = new Blob([txt]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buf = new Uint8Array(await new Response(s).arrayBuffer());
      let bin = ''; for (const b of buf) bin += String.fromCharCode(b);
      return 'z' + btoa(bin);
    }
    return 'j' + btoa(unescape(encodeURIComponent(txt)));
  },
  async unpack(code) {
    code = code.replace(/\s+/g, '');
    if (code[0] === 'z') {
      const bin = atob(code.slice(1)), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return JSON.parse(await new Response(s).text());
    }
    return JSON.parse(decodeURIComponent(escape(atob(code.slice(1)))));
  },
  shutdown() {
    for (const id in this.conns) try { this.conns[id].close(); } catch (e) { }
    this.conns = {}; if (this.host) try { this.host.close(); } catch (e) { }
    this.host = null; if (this.peer) try { this.peer.destroy(); } catch (e) { }
    this.peer = null;
  },
};
