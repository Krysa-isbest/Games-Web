// Transport for online play. Star topology: guests talk to the host, the host relays.
//  * PeerJS - a 5-letter room code (uses the public PeerJS broker, needs internet).
//  * Direct - no server: a WebRTC offer/answer swapped as text codes ("SM1..."), works on a LAN / Tailscale.
// Every link has two channels:
//  * the reliable one (in order, nothing lost) for events: spawns, voxels, actions, the lobby...
//  * a FAST one (unordered, a lost packet is never resent) for positions that are sent 20x a second anyway.
//    On a reliable channel one lost packet holds up everything behind it, which is what made online feel laggy.
import { G } from './state.js';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
export const NET = {
  mode: null, code: '', conns: new Map(), handlers: {}, rid: 0, waits: new Map(), actions: {},
  peer: null, pending: null, onConn: () => {}, onDrop: () => {}, onPing: () => {},
  ping: new Map(),          // pid -> round trip in ms (guests: 'p0' = to the host)
};
export const on = (t, fn) => { NET.handlers[t] = fn; };

function raw(conn, msg) { try { conn.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { console.warn('send failed', e); } }
// the fast channel once it works both ways (and isn't clogged), the reliable one otherwise.
// `probe` sends on the fast channel even before we've heard back on it (pings do that to find out).
function rawFast(conn, msg, probe = false) {
  const f = conn.fast;
  if (f && f.readyState === 'open' && (conn.fastOk || probe)) {
    if (f.bufferedAmount < 65536) try { f.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* dropped: the next update follows */ }
    return;
  }
  if (!probe) raw(conn, msg);
}
function out(to, msg, fast) {
  const role = G.net.role;
  if (role === 'solo') return;
  const put = fast ? rawFast : raw;
  msg.from ??= G.net.id;
  if (role === 'guest') { msg.to = to; const h = NET.conns.get('p0'); if (h) put(h, msg); return; }
  if (to === '*') { const s = JSON.stringify(msg); for (const c of NET.conns.values()) put(c, s); return; }
  const c = NET.conns.get(to);
  if (c) put(c, msg);
}
export const send = (to, msg) => out(to, msg, false);
export const broadcast = msg => out('*', msg, false);
// positions only: may arrive out of order or not at all
export const sendFast = (to, msg) => out(to, msg, true);

// the fast channel rides on the same connection: both sides make it with the same fixed id, no extra handshake
const FAST = { negotiated: true, id: 42, ordered: false, maxRetransmits: 0 };
function addFast(conn, pc, pid) {
  if (!pc?.createDataChannel) return;
  try {
    const ch = pc.createDataChannel('fast', FAST);
    ch.onmessage = e => { conn.fastOk = true; receive(pid, e.data, true); };
    conn.fast = ch;
  } catch (e) { console.warn('No fast channel, using the reliable one.', e); }
}

// ping: every 2 s each side asks every link for an echo (on the fast channel, and on the reliable one
// until the fast one has proved it works)
setInterval(() => {
  if (G.net.role === 'solo') return;
  const s = JSON.stringify({ t: 'pg', k: Math.round(performance.now()) });
  for (const c of NET.conns.values()) { rawFast(c, s, true); if (!c.fastOk) raw(c, s); }
}, 2000);

// run an action on the host (guests get the return value back)
export function act(name, ...args) {
  if (G.net.role !== 'guest') {
    try { return Promise.resolve(NET.actions[name]?.(G.net.id, ...args)); } catch (e) { console.error(e); return Promise.resolve(undefined); }
  }
  const rid = ++NET.rid;
  send('p0', { t: 'act', rid, name, args });
  return new Promise(res => { NET.waits.set(rid, res); setTimeout(() => { if (NET.waits.delete(rid)) res(undefined); }, 8000); });
}

function receive(fromConn, data, fast = false) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  // ping / pong (straight back over the link it came on)
  if (msg.t === 'pg') { const c = NET.conns.get(fromConn); if (c) { const r = { t: 'po', k: msg.k }; if (fast) rawFast(c, r, true); else raw(c, r); } return; }
  if (msg.t === 'po') { NET.ping.set(fromConn, Math.max(1, Math.round(performance.now() - msg.k))); NET.onPing(fromConn); return; }
  if (G.net.role === 'host') {
    msg.from = fromConn;
    if (msg.to && msg.to !== 'p0') {
      const put = fast ? rawFast : raw;
      if (msg.to === '*') { const s = JSON.stringify(msg); for (const [pid, c] of NET.conns) if (pid !== fromConn) put(c, s); }
      else { const c = NET.conns.get(msg.to); if (c) put(c, msg); return; }
    }
    if (msg.t === 'act') {
      let val;
      try { val = NET.actions[msg.name]?.(fromConn, ...(msg.args || [])); } catch (e) { console.error(e); }
      Promise.resolve(val).then(v => send(fromConn, { t: 'ret', rid: msg.rid, val: v ?? null }));
      return;
    }
  }
  if (msg.t === 'ret') { const w = NET.waits.get(msg.rid); if (w) { NET.waits.delete(msg.rid); w(msg.val); } return; }
  NET.handlers[msg.t]?.(msg, msg.from);
}
function addConn(pid, conn) { NET.conns.set(pid, conn); NET.onConn(pid); }
function dropConn(pid) { if (!NET.conns.has(pid)) return; NET.conns.delete(pid); NET.ping.delete(pid); NET.onDrop(pid); }

// ---------- PeerJS ----------
async function loadPeerJS() {
  if (window.Peer) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = res; s.onerror = () => rej(new Error('PeerJS could not load. No internet? Try the Direct code mode.'));
    document.head.append(s);
  });
}
const freePid = () => ['p1', 'p2', 'p3'].find(p => !NET.conns.has(p));
export const PREFIX = 'ship-madness-';

export async function hostPeerJS() {
  await loadPeerJS();
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
  const peer = new window.Peer(PREFIX + code, { config: { iceServers: STUN } });
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
  Object.assign(NET, { peer, mode: 'peerjs', code });
  G.net.role = 'host'; G.net.id = 'p0';
  peer.on('connection', dc => {
    dc.on('open', () => {
      const pid = freePid();
      if (!pid || G.running) { dc.send(JSON.stringify({ t: 'full', why: G.running ? 'The game already started.' : 'The game is full (4 players).' })); setTimeout(() => dc.close(), 300); return; }
      dc.on('data', d => receive(pid, d));
      dc.on('close', () => dropConn(pid));
      const conn = { send: s => dc.send(s), close: () => dc.close(), peerId: dc.peer };
      addFast(conn, dc.peerConnection, pid);
      addConn(pid, conn);
    });
  });
  return code;
}
export async function joinPeerJS(code) {
  await loadPeerJS();
  const peer = new window.Peer({ config: { iceServers: STUN } });
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
  const dc = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
  await new Promise((res, rej) => {
    dc.on('open', res);
    peer.on('error', e => rej(new Error(e.type === 'peer-unavailable' ? 'No game with that code.' : e.message)));
    setTimeout(() => rej(new Error('Timed out. Check the code.')), 15000);
  });
  Object.assign(NET, { peer, mode: 'peerjs', code });
  G.net.role = 'guest';
  dc.on('data', d => receive('p0', d));
  dc.on('close', () => dropConn('p0'));
  const conn = { send: s => dc.send(s), close: () => dc.close() };
  addFast(conn, dc.peerConnection, 'p0');
  addConn('p0', conn);
}

// ---------- Direct codes ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function pipe(data, stream) { return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer(); }
async function encodeCode(desc) {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp.split('\r\n').filter(l => !l.startsWith('a=extmap')).join('\r\n') });
  return 'SM1' + b64(await pipe(json, new CompressionStream('deflate-raw')));
}
async function decodeCode(code) {
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith('SM1')) throw new Error('That is not a Ship Madness code (it should start with SM1).');
  const j = JSON.parse(new TextDecoder().decode(await pipe(unb64(c.slice(3)), new DecompressionStream('deflate-raw'))));
  return { type: j.t, sdp: j.s };
}
function waitIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(res => {
    const t = setTimeout(res, 5000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
function wireDC(pid, dc, pc) {
  dc.onmessage = e => receive(pid, e.data);
  dc.onclose = () => dropConn(pid);
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropConn(pid); };
  const conn = { send: s => dc.send(s), close: () => { dc.close(); pc.close(); } };
  addFast(conn, pc, pid);
  addConn(pid, conn);
}
// one invite at a time: a new one replaces an invite nobody answered yet.
// The player slot (p1..p3) is only taken when the friend's connection actually opens.
export async function directHostCode() {
  if (G.net.role !== 'host') { NET.mode = 'direct'; G.net.role = 'host'; G.net.id = 'p0'; }
  if (!freePid()) throw new Error('The game is full (4 players).');
  if (NET.pending) { try { NET.pending.close(); } catch { /* gone */ } NET.pending = null; }
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('game', { ordered: true });
  dc.onopen = () => {
    const pid = freePid();
    if (!pid || G.running) {
      try { dc.send(JSON.stringify({ t: 'full', why: G.running ? 'The game already started.' : 'The game is full (4 players).' })); } catch { /* closed */ }
      setTimeout(() => pc.close(), 300); return;
    }
    wireDC(pid, dc, pc);
  };
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  NET.pending = pc;
  return encodeCode(pc.localDescription);
}
export async function directHostAccept(reply) {
  if (!NET.pending) throw new Error('Make an invite code first.');
  const pc = NET.pending;
  await pc.setRemoteDescription(await decodeCode(reply));
  NET.pending = null;
}
export const invitePending = () => !!NET.pending;
export async function directJoin(code, onOpen) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.ondatachannel = e => {
    const dc = e.channel;
    dc.onopen = () => { NET.mode = 'direct'; G.net.role = 'guest'; wireDC('p0', dc, pc); onOpen?.(); };
  };
  await pc.setRemoteDescription(await decodeCode(code));
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  return encodeCode(pc.localDescription);
}

export function leaveNet() {
  for (const c of NET.conns.values()) try { c.close(); } catch { /* closed */ }
  NET.conns.clear(); NET.ping.clear();
  NET.peer?.destroy?.();
  try { NET.pending?.close(); } catch { /* gone */ }
  Object.assign(NET, { mode: null, peer: null, pending: null, code: '' });
  G.net.role = 'solo'; G.net.id = 'p0';
}
