// Transport for co-op. Star topology: guests talk to the host, the host relays.
// Two ways to connect:
//  * PeerJS  - room code, uses the public PeerJS broker (needs internet).
//  * Direct  - no server at all: a WebRTC offer/answer swapped as text codes ("PB1..."). ICE uses host
//              candidates only, so it works on a LAN or a Tailscale tailnet.
import { G, ACTIONS } from './state.js';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
export const NET = {
  role: 'solo', mode: null, code: '', conns: new Map(), handlers: {}, rid: 0, waits: new Map(),
  peer: null, pending: null, iceServers: [], toast: () => {}, onConn: () => {}, onDrop: () => {},
};
export const isGuest = () => NET.role === 'guest';
export const isHost = () => NET.role === 'host';
export const online = () => NET.role !== 'solo';
export const on = (t, fn) => { NET.handlers[t] = fn; };

// ---------- sending ----------
function raw(conn, msg) { try { conn.send(JSON.stringify(msg)); } catch (e) { console.warn('send failed', e); } }

export function send(to, msg) {
  if (NET.role === 'solo') return;
  msg.from ??= G.me;
  if (NET.role === 'guest') { msg.to = to; const h = NET.conns.get('p0'); if (h) raw(h, msg); return; }
  if (to === '*') { for (const c of NET.conns.values()) raw(c, msg); return; }
  const c = NET.conns.get(to);
  if (c) raw(c, msg);
}
export const broadcast = msg => send('*', msg);

// Run an action. Host / solo: right here. Guest: on the host, the return value comes back.
export function act(name, ...args) {
  if (NET.role !== 'guest') {
    try { return Promise.resolve(ACTIONS[name](G.me, ...args)); } catch (e) { console.error(e); return Promise.resolve(undefined); }
  }
  const rid = ++NET.rid;
  send('p0', { t: 'act', rid, name, args });
  return new Promise(res => {
    NET.waits.set(rid, res);
    setTimeout(() => { if (NET.waits.delete(rid)) res(undefined); }, 8000);
  });
}

// Feedback for the player who did an action (it may be a guest).
export function tell(pid, text, kind = '') {
  if (pid === G.me) NET.toast(text, kind);
  else send(pid, { t: 'toast', text, kind });
}

// ---------- receiving ----------
function receive(fromConn, data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (NET.role === 'host') {
    msg.from = fromConn; // never trust the guest's own claim
    if (msg.to && msg.to !== 'p0') {
      if (msg.to === '*') { for (const [pid, c] of NET.conns) if (pid !== fromConn) raw(c, msg); }
      else { const c = NET.conns.get(msg.to); if (c) raw(c, msg); return; }
    }
    if (msg.t === 'act') {
      let val;
      try { val = ACTIONS[msg.name]?.(fromConn, ...(msg.args || [])); } catch (e) { console.error(e); }
      Promise.resolve(val).then(v => send(fromConn, { t: 'ret', rid: msg.rid, val: v }));
      return;
    }
  }
  if (msg.t === 'ret') { const w = NET.waits.get(msg.rid); if (w) { NET.waits.delete(msg.rid); w(msg.val); } return; }
  if (msg.t === 'toast') return NET.toast(msg.text, msg.kind);
  NET.handlers[msg.t]?.(msg, msg.from);
}

function addConn(pid, conn) {
  NET.conns.set(pid, conn);
  NET.onConn(pid);
}
function dropConn(pid) {
  if (!NET.conns.has(pid)) return;
  NET.conns.delete(pid);
  NET.onDrop(pid);
}

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

export async function hostPeerJS() {
  await loadPeerJS();
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
  const peer = new window.Peer('chuckys-house-' + code, { config: { iceServers: STUN } });
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
  Object.assign(NET, { peer, role: 'host', mode: 'peerjs', code, iceServers: STUN });
  peer.on('connection', dc => {
    dc.on('open', () => {
      const pid = freePid();
      if (!pid) { dc.send(JSON.stringify({ t: 'full' })); setTimeout(() => dc.close(), 300); return; }
      dc.on('data', d => receive(pid, d));
      dc.on('close', () => dropConn(pid));
      addConn(pid, { send: s => dc.send(s), close: () => dc.close() });
    });
  });
  return code;
}

export async function joinPeerJS(code) {
  await loadPeerJS();
  const peer = new window.Peer({ config: { iceServers: STUN } });
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
  const dc = peer.connect('chuckys-house-' + code.trim().toUpperCase(), { reliable: true });
  await new Promise((res, rej) => {
    dc.on('open', res);
    peer.on('error', e => rej(new Error(e.type === 'peer-unavailable' ? 'No game with that code.' : e.message)));
    setTimeout(() => rej(new Error('Timed out. Check the code.')), 15000);
  });
  Object.assign(NET, { peer, role: 'guest', mode: 'peerjs', code, iceServers: STUN });
  dc.on('data', d => receive('p0', d));
  dc.on('close', () => dropConn('p0'));
  addConn('p0', { send: s => dc.send(s), close: () => dc.close() });
}

// ---------- Direct codes (Tailscale / LAN) ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function pipe(data, stream) { return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer(); }

export async function encodeCode(desc) {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp.split('\r\n').filter(l => !l.startsWith('a=extmap')).join('\r\n') });
  return 'PB1' + b64(await pipe(json, new CompressionStream('deflate-raw')));
}
export async function decodeCode(code) {
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith('PB1')) throw new Error('That is not a Chucky\'s House code (it should start with PB1).');
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
  addConn(pid, { send: s => dc.send(s), close: () => { dc.close(); pc.close(); } });
}

// Host step 1: make a code for the next player.
export async function directHostCode() {
  // A PeerJS host can also take direct-code players at the same time (mixed games): keep its mode then.
  if (NET.role !== 'host') Object.assign(NET, { role: 'host', mode: 'direct', iceServers: [] });
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('game', { ordered: true });
  const pid = freePid();
  if (!pid) throw new Error('The game is full (4 players).');
  dc.onopen = () => wireDC(pid, dc, pc);
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  NET.pending = pc;
  return encodeCode(pc.localDescription);
}
// Host step 2: paste the reply code from the player.
export async function directHostAccept(reply) {
  if (!NET.pending) throw new Error('Make a host code first.');
  await NET.pending.setRemoteDescription(await decodeCode(reply));
  NET.pending = null;
}
// Guest: paste the host code, get a reply code to send back.
export async function directJoin(code, onOpen) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.ondatachannel = e => {
    const dc = e.channel;
    dc.onopen = () => { Object.assign(NET, { role: 'guest', mode: 'direct', iceServers: [] }); wireDC('p0', dc, pc); onOpen?.(); };
  };
  await pc.setRemoteDescription(await decodeCode(code));
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  return encodeCode(pc.localDescription);
}

export function leaveNet() {
  for (const c of NET.conns.values()) try { c.close(); } catch { /* already closed */ }
  NET.conns.clear();
  NET.peer?.destroy?.();
  Object.assign(NET, { role: 'solo', mode: null, peer: null, pending: null });
}
