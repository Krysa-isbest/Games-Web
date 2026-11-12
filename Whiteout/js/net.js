// Transport for online play. Star topology: guests talk to the host, the host relays.
//  * Room code (PeerJS): a 5-letter code. Uses the free public PeerJS server only to introduce players, or your
//    own PeerJS server (e.g. on your Tailscale network: Settings > Network).
//  * Invite codes (direct): no server at all. A WebRTC offer / answer swapped as text ("WO1..."). Works on a LAN
//    and over Tailscale, because the connection uses the computers' own addresses.
import { G, S } from './state.js';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
export const MAX = 4;
export const NET = { mode: null, code: '', conns: new Map(), handlers: {}, peer: null, pending: null, onConn: () => {}, onDrop: () => {} };
export const on = (t, fn) => { NET.handlers[t] = fn; };

// big messages (the whole world for someone joining) go in pieces: a data channel only promises about 16 KB at a time
const BIG = 12000, parts = new Map();
let partN = 0;
function raw(conn, msg) {
  try {
    const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
    if (s.length <= BIG) { conn.send(s); return; }
    const id = ++partN, n = Math.ceil(s.length / BIG);
    for (let i = 0; i < n; i++) conn.send(JSON.stringify({ t: '_part', id, i, n, d: s.slice(i * BIG, (i + 1) * BIG) }));
  } catch (e) { console.warn('send failed', e); }
}
export function send(to, msg) {
  const role = G.net.role;
  if (role === 'solo') return;
  msg.from ??= G.net.id;
  if (role === 'guest') { msg.to = to; const h = NET.conns.get('p0'); if (h) raw(h, msg); return; }
  if (to === '*') { const s = JSON.stringify(msg); for (const c of NET.conns.values()) raw(c, s); return; }
  const c = NET.conns.get(to);
  if (c) raw(c, msg);
}
export const broadcast = msg => send('*', msg);

function receive(fromConn, data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (msg.t === '_part') {          // a piece of a big message: put it together, then read it
    const key = fromConn + ':' + msg.id, got = parts.get(key) || { n: 0, d: [] };
    if (got.d[msg.i] == null) { got.d[msg.i] = msg.d; got.n++; }
    parts.set(key, got);
    if (got.n < msg.n) return;
    parts.delete(key);
    receive(fromConn, got.d.join(''));
    return;
  }
  if (G.net.role === 'host') {
    msg.from = fromConn;
    if (msg.to && msg.to !== 'p0') {
      if (msg.to === '*') { const s = JSON.stringify(msg); for (const [pid, c] of NET.conns) if (pid !== fromConn) raw(c, s); }
      else { const c = NET.conns.get(msg.to); if (c) raw(c, msg); return; }
    }
  }
  NET.handlers[msg.t]?.(msg, msg.from);
}
export const _receive = receive;      // for the checks without a browser
function addConn(pid, conn) { NET.conns.set(pid, conn); NET.onConn(pid); }
function dropConn(pid) {
  if (!NET.conns.has(pid)) return;
  NET.conns.delete(pid);
  for (const k of [...parts.keys()]) if (k.startsWith(pid + ':')) parts.delete(k);
  NET.onDrop(pid);
}
const freePid = () => ['p1', 'p2', 'p3'].find(p => !NET.conns.has(p));

// ---------- PeerJS ----------
async function loadPeerJS() {
  if (window.Peer) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = res; s.onerror = () => rej(new Error('PeerJS could not load. No internet? Use LAN / Tailscale invite codes.'));
    document.head.append(s);
  });
}
export const PREFIX = 'whiteout-isle-';
// the public PeerJS server, or your own (Settings > Network), e.g. `npx peer --port 9000` on a Tailscale machine
export function peerOpts() {
  const o = { config: { iceServers: S.custom ? [] : STUN } };
  if (S.custom && S.sHost) Object.assign(o, { host: S.sHost.trim(), port: +S.sPort || 9000, path: S.sPath || '/', secure: !!S.sSecure });
  return o;
}
const niceErr = e => {
  const t = e?.type || '';
  if (t === 'peer-unavailable') return 'No game with that code. Check it, and ask the host if the room is still open.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return S.custom ? `Can't reach your PeerJS server at ${S.sHost}:${S.sPort}. Is it running? (Settings > Network)` : 'Can\'t reach the PeerJS server. Check your internet connection.';
  if (t === 'unavailable-id') return 'That room code is taken. Try again.';
  return e?.message || 'Something went wrong with the connection.';
};
// why a link closed, so the "lost the connection" message can say it (and the console shows the details)
function watchLink(dc, who) {
  dc.on('iceStateChanged', s => {
    console.info(`[net] ${who}: network path is now "${s}"`);
    if (s === 'disconnected') NET.why = 'The network path between you dropped out.';
    if (s === 'failed') NET.why = 'Your computers could not keep a direct link (a router or firewall blocks it). LAN / Tailscale invite codes may work better.';
    if (s === 'connected' && NET.why === 'The network path between you dropped out.') NET.why = '';
  });
  dc.on('error', e => { console.warn(`[net] ${who}: link error`, e); NET.why ||= `Link error: ${e?.type || e?.message || e}.`; });
  dc.on('close', () => console.info(`[net] ${who}: link closed.${NET.why ? ' Reason: ' + NET.why : ' No reason given (the other side closed it, or left the room).'}`));
}
export async function hostPeerJS() {
  await loadPeerJS();
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
  const peer = new window.Peer(PREFIX + code.toLowerCase(), peerOpts());
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error(niceErr(e)))); setTimeout(() => rej(new Error(niceErr({ type: 'network' }))), 15000); });
  Object.assign(NET, { peer, mode: 'peerjs', code });
  G.net.role = 'host'; G.net.id = 'p0';
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* gone */ } });
  peer.on('connection', dc => {
    dc.on('open', () => {
      const pid = freePid();
      // (a game that has started still lets people knock: the host is asked, see lobby.js and game.js)
      if (!pid) { dc.send(JSON.stringify({ t: 'full', why: `The crew is full (${MAX} players).` })); setTimeout(() => dc.close(), 300); return; }
      watchLink(dc, pid);
      dc.on('data', d => receive(pid, d));
      dc.on('close', () => dropConn(pid));
      addConn(pid, { send: s => dc.send(s), close: () => dc.close() });
    });
  });
  peer.on('error', e => console.warn('[net] host: peer error', e?.type, e));
  return code;
}
export async function joinPeerJS(code) {
  await loadPeerJS();
  const peer = new window.Peer(peerOpts());
  await new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error(niceErr(e)))); setTimeout(() => rej(new Error(niceErr({ type: 'network' }))), 15000); });
  const dc = peer.connect(PREFIX + code.trim().toLowerCase(), { reliable: true });
  await new Promise((res, rej) => {
    dc.on('open', res);
    peer.on('error', e => rej(new Error(niceErr(e))));
    setTimeout(() => rej(new Error('Timed out. Check the code.')), 15000);
  });
  Object.assign(NET, { peer, mode: 'peerjs', code: code.toUpperCase(), why: '' });
  G.net.role = 'guest';
  // the room server link can blip; the game link to the host doesn't need it, but stay registered (the host does the same)
  peer.on('disconnected', () => { console.info('[net] guest: lost the room server, reconnecting'); try { peer.reconnect(); } catch { /* gone */ } });
  peer.on('error', e => { console.warn('[net] guest: peer error', e?.type, e); if (e?.type === 'network' || e?.type === 'socket-error') return; NET.why ||= niceErr(e); });
  watchLink(dc, 'host');
  dc.on('data', d => receive('p0', d));
  dc.on('close', () => dropConn('p0'));
  addConn('p0', { send: s => dc.send(s), close: () => dc.close() });
}
// is our own PeerJS server reachable? (Settings > Network > Test)
export async function testServer() {
  await loadPeerJS();
  const peer = new window.Peer(peerOpts());
  try {
    await new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error(niceErr(e)))); setTimeout(() => rej(new Error(niceErr({ type: 'network' }))), 8000); });
    return true;
  } finally { peer.destroy(); }
}

// ---------- invite codes (no server) ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function pipe(data, stream) { return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer(); }
async function encodeCode(desc) {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp.split('\r\n').filter(l => !l.startsWith('a=extmap')).join('\r\n') });
  return 'WO1' + b64(await pipe(json, new CompressionStream('deflate-raw')));
}
async function decodeCode(code) {
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith('WO1')) throw new Error('That is not a Whiteout code (it starts with WO1).');
  try {
    const j = JSON.parse(new TextDecoder().decode(await pipe(unb64(c.slice(3)), new DecompressionStream('deflate-raw'))));
    return { type: j.t, sdp: j.s };
  } catch { throw new Error('That code is damaged. Copy the whole code again.'); }
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
export function becomeDirectHost() { NET.mode = 'direct'; G.net.role = 'host'; G.net.id = 'p0'; }
export async function directHostCode() {
  if (G.net.role !== 'host') becomeDirectHost();
  const pid = freePid();
  if (!pid) throw new Error(`The crew is full (${MAX} players).`);
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('game', { ordered: true });
  dc.onopen = () => wireDC(freePid() || pid, dc, pc);
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  NET.pending = pc;
  return encodeCode(pc.localDescription);
}
export async function directHostAccept(reply) {
  if (!NET.pending) throw new Error('Make an invite code first.');
  await NET.pending.setRemoteDescription(await decodeCode(reply));
  NET.pending = null;
}
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
  NET.conns.clear();
  try { NET.peer?.destroy?.(); } catch { /* gone */ }
  Object.assign(NET, { mode: null, peer: null, pending: null, code: '', why: '' });
  G.net.role = 'solo'; G.net.id = 'p0'; G.started = false;
}
