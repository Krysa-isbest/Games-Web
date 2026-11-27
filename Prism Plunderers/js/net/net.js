// The transport for co-op (part 12, DESIGN 5 / 5a). Star: guests talk to the host (p0), the host relays.
//  * Room code (PeerJS): a 5-letter code. The free public PeerJS server only introduces the players.
//  * Invite codes (direct, no server): a WebRTC offer / answer swapped as text. The host makes an invite code
//    (PPI1...), the friend pastes it and gets a reply code (PPR1...), the host pastes that back. Works on a LAN and
//    over Tailscale (the link uses the computers' own addresses). Each code works once and runs out after 15 min.
// Ported from Whiteout's net.js. Messages are JSON; big ones go in pieces (a data channel only promises ~16 KB).
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
export const MAX = 4;
export const CODE_LIFE = 15 * 60 * 1000;
export const NET = { role: 'solo', id: 'p0', mode: null, code: '', conns: new Map(), handlers: {}, peer: null, pending: null, why: '',
  onConn: () => {}, onDrop: () => {} };
export const on = (t, fn) => { NET.handlers[t] = fn; };
export const online = () => NET.role !== 'solo';

const BIG = 12000, parts = new Map();
let partN = 0;
function raw(conn, msg) {
  try {
    const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
    if (s.length <= BIG) { conn.send(s); return; }
    const id = ++partN, n = Math.ceil(s.length / BIG);
    for (let i = 0; i < n; i++) conn.send(JSON.stringify({ t: '_part', id, i, n, d: s.slice(i * BIG, (i + 1) * BIG) }));
  } catch (e) { console.warn('[net] send failed', e); }
}
// to = a player id, or '*' for everyone (a guest's '*' goes through the host to the others)
export function send(to, msg) {
  if (NET.role === 'solo') return;
  msg.from ??= NET.id;
  if (NET.role === 'guest') { msg.to = to; const h = NET.conns.get('p0'); if (h) raw(h, msg); return; }
  if (to === '*') { const s = JSON.stringify(msg); for (const c of NET.conns.values()) raw(c, s); return; }
  const c = NET.conns.get(to);
  if (c) raw(c, msg);
}
export const broadcast = msg => send('*', msg);

function receive(fromConn, data) {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (msg.t === '_part') {
    const key = fromConn + ':' + msg.id, got = parts.get(key) || { n: 0, d: [] };
    if (got.d[msg.i] == null) { got.d[msg.i] = msg.d; got.n++; }
    parts.set(key, got);
    if (got.n < msg.n) return;
    parts.delete(key);
    receive(fromConn, got.d.join(''));
    return;
  }
  if (NET.role === 'host') {
    msg.from = fromConn;                                   // a guest cannot pretend to be someone else
    if (msg.to && msg.to !== 'p0') {
      if (msg.to === '*') { const s = JSON.stringify(msg); for (const [pid, c] of NET.conns) if (pid !== fromConn) raw(c, s); }
      else { const c = NET.conns.get(msg.to); if (c) raw(c, msg); return; }
    }
  }
  try { NET.handlers[msg.t]?.(msg, msg.from); } catch (e) { console.error('[net] handler', msg.t, e); }
}
export const _receive = receive;                           // for the offline checks
function addConn(pid, conn) { NET.conns.set(pid, conn); NET.onConn(pid); }
function dropConn(pid) {
  if (!NET.conns.has(pid)) return;
  NET.conns.delete(pid);
  for (const k of [...parts.keys()]) if (k.startsWith(pid + ':')) parts.delete(k);
  NET.onDrop(pid);
}
const freePid = () => ['p1', 'p2', 'p3'].find(p => !NET.conns.has(p));

// ---------- a fake link for the offline checks: link(pid, { send(s), close() }) ----------
export function fakeHost() { Object.assign(NET, { role: 'host', id: 'p0', mode: 'fake', code: 'TEST1' }); }
export function fakeLink(pid, conn) { addConn(pid, conn); return { receive: d => receive(pid, d), drop: () => dropConn(pid) }; }
export function fakeGuest(conn) { Object.assign(NET, { role: 'guest', id: 'p?', mode: 'fake' }); return fakeLink('p0', conn); }

// ---------- PeerJS room codes ----------
async function loadPeerJS() {
  if (window.Peer) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = res; s.onerror = () => rej(new Error('PeerJS could not load. No internet? Use the invite codes (LAN / Tailscale) instead.'));
    document.head.append(s);
  });
}
const PREFIX = 'prism-plunderers-';
const niceErr = e => {
  const t = e?.type || '';
  if (t === 'peer-unavailable') return 'No squad with that code. Check it, and ask the host whether the room is still open.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Cannot reach the room server. Check your internet connection, or use the invite codes.';
  if (t === 'unavailable-id') return 'That room code is taken. Try again.';
  return e?.message || 'Something went wrong with the connection.';
};
const timeout = (ms, why) => new Promise((_, rej) => setTimeout(() => rej(new Error(why)), ms));
export async function hostRoom() {
  await loadPeerJS();
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
  const peer = new window.Peer(PREFIX + code.toLowerCase(), { config: { iceServers: STUN } });
  await Promise.race([new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error(niceErr(e)))); }), timeout(15000, niceErr({ type: 'network' }))]);
  Object.assign(NET, { peer, mode: 'peerjs', code, role: 'host', id: 'p0' });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* gone */ } });
  peer.on('connection', dc => {
    dc.on('open', () => {
      const pid = freePid();
      if (!pid) { dc.send(JSON.stringify({ t: 'full', why: `The squad is full (${MAX} players).` })); setTimeout(() => dc.close(), 300); return; }
      dc.on('data', d => receive(pid, d));
      dc.on('close', () => dropConn(pid));
      dc.on('error', e => console.warn('[net] link error', pid, e));
      addConn(pid, { send: s => dc.send(s), close: () => dc.close() });
    });
  });
  return code;
}
export async function joinRoom(code) {
  await loadPeerJS();
  const peer = new window.Peer({ config: { iceServers: STUN } });
  await Promise.race([new Promise((res, rej) => { peer.on('open', res); peer.on('error', e => rej(new Error(niceErr(e)))); }), timeout(15000, niceErr({ type: 'network' }))]);
  const dc = peer.connect(PREFIX + code.trim().toLowerCase(), { reliable: true });
  await Promise.race([new Promise((res, rej) => { dc.on('open', res); peer.on('error', e => rej(new Error(niceErr(e)))); }), timeout(15000, 'Timed out. Check the code.')]);
  Object.assign(NET, { peer, mode: 'peerjs', code: code.trim().toUpperCase(), role: 'guest', why: '' });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* gone */ } });
  dc.on('data', d => receive('p0', d));
  dc.on('close', () => dropConn('p0'));
  addConn('p0', { send: s => dc.send(s), close: () => dc.close() });
}

// ---------- invite codes (no server) ----------
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function pipe(data, stream) { return new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer(); }
async function encodeCode(tag, desc) {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp.split('\r\n').filter(l => !l.startsWith('a=extmap')).join('\r\n'), e: Date.now() + CODE_LIFE });
  return tag + b64(await pipe(json, new CompressionStream('deflate-raw')));
}
async function decodeCode(code, tag) {
  const c = code.replace(/\s+/g, '');
  const other = tag === 'PPI1' ? 'PPR1' : 'PPI1';
  if (c.startsWith(other)) throw new Error(tag === 'PPI1' ? 'That is a reply code: it goes back to the host (Finish connection).' : 'That is an invite code: paste it under Join with an invite code.');
  if (!c.startsWith(tag)) throw new Error(`That is not a Prism Plunderers ${tag === 'PPI1' ? 'invite' : 'reply'} code (it starts with ${tag}).`);
  let j;
  try { j = JSON.parse(new TextDecoder().decode(await pipe(unb64(c.slice(4)), new DecompressionStream('deflate-raw')))); }
  catch { throw new Error('That code is damaged. Copy the whole code again.'); }
  if (!(j.e > Date.now())) throw new Error('That code has run out (codes last 15 minutes). Ask for a new one.');
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
// the host: one invite at a time; the code works once
export async function inviteCode() {
  if (NET.role === 'guest') throw new Error('Only the squad leader can invite.');
  if (NET.role === 'solo') Object.assign(NET, { role: 'host', id: 'p0', mode: 'direct' });
  const pid = freePid();
  if (!pid) throw new Error(`The squad is full (${MAX} players).`);
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('game', { ordered: true });
  dc.onopen = () => wireDC(freePid() || pid, dc, pc);
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  NET.pending = { pc, until: Date.now() + CODE_LIFE };
  return encodeCode('PPI1', pc.localDescription);
}
export async function finishInvite(reply) {
  const pend = NET.pending;
  if (!pend) throw new Error('Make an invite code first (each code works once).');
  if (Date.now() > pend.until) { NET.pending = null; throw new Error('That invite ran out (15 minutes). Make a new one.'); }
  await pend.pc.setRemoteDescription(await decodeCode(reply, 'PPR1'));
  NET.pending = null;
}
// a friend: the invite code in, the reply code out; onOpen when the link is up
export async function replyCode(code, onOpen) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.ondatachannel = e => {
    const dc = e.channel;
    dc.onopen = () => { Object.assign(NET, { mode: 'direct', role: 'guest' }); wireDC('p0', dc, pc); onOpen?.(); };
  };
  await pc.setRemoteDescription(await decodeCode(code, 'PPI1'));
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  return encodeCode('PPR1', pc.localDescription);
}

export function leaveNet() {
  for (const c of NET.conns.values()) try { c.close(); } catch { /* closed */ }
  NET.conns.clear();
  try { NET.peer?.destroy?.(); } catch { /* gone */ }
  Object.assign(NET, { role: 'solo', id: 'p0', mode: null, peer: null, pending: null, code: '', why: '' });
}
