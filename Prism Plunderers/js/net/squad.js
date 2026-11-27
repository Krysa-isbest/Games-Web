// The squad (part 12): who is in it, ready, ping, chat, and starting a raid together. Runs on top of net.js.
// The host (squad leader, p0) keeps the list and sends it to everyone; a guest says hello with its name and the
// game version and gets its id back. Events on the bus: 'squad' (the list changed), 'squad:chat' (a line),
// 'squad:start' (go into a raid: { seed, members }), 'squad:left' (why).
import { bus } from '../core/events.js';
import { P } from '../core/save.js';
import { VERSION } from '../core/config.js';
import { NET, on, send, broadcast, leaveNet, online } from './net.js';

export const Squad = {
  members: [],                    // [{ id, name, ready, ping, status: 'lobby' | 'raid' | 'out', host }]
  get on() { return online() && this.members.length > 0; },
  get host() { return NET.role === 'host'; },
  get me() { return NET.id; },
  get size() { return this.members.length; },
  inRaid: false,
  lines: [],                      // the chat, newest last
};
let pingT = 0;
const meEntry = () => ({ id: NET.id, name: P.name, ready: true, ping: 0, status: Squad.inRaid ? 'raid' : 'lobby', host: NET.role === 'host' });
const changed = () => bus.emit('squad', Squad.members);
function line(text, from = '') {
  Squad.lines.push({ text, from, t: Date.now() });
  if (Squad.lines.length > 60) Squad.lines.shift();
  bus.emit('squad:chat', { text, from });
}
const shareList = () => { if (Squad.host) { broadcast({ t: 'squad', members: Squad.members }); changed(); } };

// the host side: a new link says hello first
NET.onConn = pid => {
  if (NET.role === 'guest') { send('p0', { t: 'hello', name: P.name, v: VERSION }); return; }
  if (!Squad.members.length) Squad.members = [meEntry()];
};
NET.onDrop = pid => {
  if (NET.role === 'guest') { leave('You lost the connection to the squad leader.'); return; }
  const m = Squad.members.find(q => q.id === pid);
  Squad.members = Squad.members.filter(q => q.id !== pid);
  if (m) line(`${m.name} left the squad`);
  broadcast({ t: 'st:gone', id: pid });                   // (in a raid: their raider goes from everyone's screen)
  bus.emit('squad:drop', pid);
  shareList();
};
on('hello', (m, pid) => {
  if (!Squad.host) return;
  if (m.v !== VERSION) { send(pid, { t: 'refuse', why: `Different game versions (you: ${m.v}, the leader: ${VERSION}). Both press Ctrl+F5.` }); setTimeout(() => NET.conns.get(pid)?.close(), 300); return; }
  if (!Squad.members.length) Squad.members = [meEntry()];
  const name = String(m.name || 'Plunderer').slice(0, 20);
  Squad.members = Squad.members.filter(q => q.id !== pid);
  Squad.members.push({ id: pid, name, ready: false, ping: 0, status: 'lobby', host: false });
  send(pid, { t: 'welcome', id: pid, members: Squad.members, inRaid: Squad.inRaid });
  line(`${name} joined the squad`);
  shareList();
});
on('welcome', m => { NET.id = m.id; Squad.members = m.members; line('You joined the squad' + (m.inRaid ? ' (they are in a raid: you go along next time)' : '')); changed(); });
on('refuse', m => leave(m.why));
on('full', m => leave(m.why));
on('squad', m => { if (!Squad.host) { Squad.members = m.members; changed(); } });
on('kick', () => leave('The squad leader removed you from the squad.'));
on('ping', m => send('p0', { t: 'pong', s: m.s }));
on('pong', (m, pid) => { const q = Squad.members.find(x => x.id === pid); if (q) q.ping = Math.max(0, Math.round(performance.now() - m.s)); });
on('ready', (m, pid) => { const q = Squad.members.find(x => x.id === pid); if (q) { q.ready = !!m.on; shareList(); } });
on('chat', (m, pid) => {
  const text = String(m.text || '').slice(0, 200);
  if (!text) return;
  if (Squad.host) { const q = Squad.members.find(x => x.id === pid); broadcast({ t: 'chat', text, name: q?.name || '?' }); line(text, q?.name || '?'); }
  else line(text, m.name || '?');
});
on('raid:start', m => { Squad.inRaid = true; bus.emit('squad:start', m); });
on('raid:status', (m, pid) => { const q = Squad.members.find(x => x.id === pid); if (q) { q.status = m.status; shareList(); } });

// ---------- what the game calls ----------
export function startHosting() { Squad.members = [meEntry()]; changed(); }
export function setReady(onOff) {
  const me = Squad.members.find(q => q.id === NET.id);
  if (me) me.ready = onOff;
  if (!Squad.host) send('p0', { t: 'ready', on: onOff });
  changed();
}
export const allReady = () => Squad.members.every(q => q.host || q.ready);
export function chat(text) {
  text = String(text || '').trim().slice(0, 200);
  if (!text || !Squad.on) return;
  if (Squad.host) { broadcast({ t: 'chat', text, name: P.name }); line(text, P.name); }
  else send('p0', { t: 'chat', text });
}
// the leader starts a raid for everyone: a shared seed, the squad in order (the order picks the spot at the drop zone)
export function startRaid() {
  if (!Squad.host) return null;
  const m = { t: 'raid:start', seed: (Math.random() * 0xffffffff) >>> 0, members: Squad.members.map(q => ({ id: q.id, name: q.name })) };
  broadcast(m);
  Squad.inRaid = true;
  for (const q of Squad.members) q.status = 'raid';
  shareList();
  return m;
}
export function raidStatus(status) {
  const me = Squad.members.find(q => q.id === NET.id);
  if (me) me.status = status;
  if (status !== 'raid') Squad.inRaid = Squad.members.some(q => q.status === 'raid');
  if (Squad.host) shareList(); else send('p0', { t: 'raid:status', status });
}
export function kick(pid) { if (Squad.host) { send(pid, { t: 'kick' }); setTimeout(() => NET.conns.get(pid)?.close(), 300); } }
export function leave(why = '') {
  const was = Squad.on;
  leaveNet();
  Squad.members = []; Squad.inRaid = false;
  if (was || why) bus.emit('squad:left', why);
  changed();
}
// the host pings everyone every 2 s (call every frame with dt)
export function squadTick(dt) {
  if (!Squad.host || !Squad.on) return;
  pingT -= dt;
  if (pingT > 0) return;
  pingT = 2;
  broadcast({ t: 'ping', s: performance.now() });
  shareList();
}
