// Transport for online play. Star topology: guests talk to the host, the host relays.
//  * PeerJS - a 5-letter room code (uses the public PeerJS broker, needs internet).
//  * Direct - no server: a WebRTC offer/answer swapped as text codes ("SM1..."), works on a LAN / Tailscale.
import { G } from './state.js';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
export const NET = {
  mode: null, code: '', conns: new Map(), handlers: {}, rid: 0, waits: new Map(), actions: {},
  peer: null, pending: null, onConn: () => {}, onDrop: () => {},
};
export const on = (t, fn) => { NET.handlers[t] = fn; };

function raw(conn, msg) { try { conn.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { console.warn('send failed', e); } }
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

// run an action on the host (guests get the return value back)
export function act(name, ...args) {
  if (G.net.role !== 'guest') {
    try { return Promise.resolve(NET.actions[name]?.(G.net.id, ...args)); } catch (e) { console.error(e); return Promise.resolve(undefined); }
  }
  const rid = ++NET.rid;
  send('p0', { t: 'act', rid, name, args });
  return new Promise(res => { NET.waits.set(rid, res); setTimeout(() => { if (NET.waits.delete(rid)) res(undefined); }, 8000); });
}

function receive(fromConn, data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (G.net.role === 'host') {
    msg.from = fromConn;
    if (msg.to && msg.to !== 'p0') {
      if (msg.to === '*') { const s = JSON.stringify(msg); for (const [pid, c] of NET.conns) if (pid !== fromConn) raw(c, s); }
      else { const c = NET.conns.get(msg.to); if (c) raw(c, msg); return; }
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
function dropConn(pid) { if (!NET.conns.has(pid)) return; NET.conns.delete(pid); NET.onDrop(pid); }

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
      addConn(pid, { send: s => dc.send(s), close: () => dc.close(), peerId: dc.peer });
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
  addConn('p0', { send: s => dc.send(s), close: () => dc.close() });
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
  addConn(pid, { send: s => dc.send(s), close: () => { dc.close(); pc.close(); } });
}
export async function directHostCode() {
  if (G.net.role !== 'host') { NET.mode = 'direct'; G.net.role = 'host'; G.net.id = 'p0'; }
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
export async function directHostAccept(reply) {
  if (!NET.pending) throw new Error('Make a host code first.');
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
  NET.peer?.destroy?.();
  Object.assign(NET, { mode: null, peer: null, pending: null, code: '' });
  G.net.role = 'solo'; G.net.id = 'p0';
}
