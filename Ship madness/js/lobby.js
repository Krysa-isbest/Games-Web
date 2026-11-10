// Online lobby: host a room (internet code or LAN code), join one, see who's in, pick the mode, start.
import { G, P, saveProfile } from './state.js';
import { NET, on, send, broadcast, hostPeerJS, joinPeerJS, directHostCode, directHostAccept, directJoin, leaveNet } from './net.js';
import { kit, shipCfg } from './progression.js';
import { sfx } from './sfx.js';

const $ = id => document.getElementById(id);
let H = null;
G.lobby = { players: [], mode: 'ffa', opts: {} };

function myInfo() {
  const kits = {};
  for (const m of ['ffa', 'camp', 'sandbox']) { const k = kit(m); kits[m] = { ship: k.ship, ...shipCfg(m, k.ship) }; }
  return { id: G.net.id, name: P.name, shirt: P.shirt, colors: { hull: P.hull, trim: P.trim, sail: P.sail }, kits, peerId: NET.peer?.id || null };
}
const segVal = id => $(id)?.dataset.value;
function hostOpts() {
  const mode = segVal('lb-mode');
  if (mode === 'ffa') return { mode, opts: { rivals: +segVal('lb-ffa-ai'), layout: segVal('lb-ffa-layout'), sea: +segVal('lb-sea') } };
  if (mode === 'camp') return { mode, opts: { diff: segVal('lb-diff') } };
  return { mode, opts: { sea: +segVal('lb-sea'), sharks: 6, enemies: true, ff: segVal('lb-ff') === '1' } };
}

export function initLobby(h) {
  H = h;
  const sync = seg => seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === seg.dataset.value));
  document.querySelectorAll('#online .seg[data-value]').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { seg.dataset.value = b.dataset.v; sync(seg); onSegChange(seg.id); });
    sync(seg);
  });
  $('lb-create').onclick = createRoom;
  $('lb-join').onclick = joinRoom;
  // LAN / Tailscale: the host stays on this screen until the first friend is in, then the lobby opens.
  // In the lobby the same thing works again (lb-ts) to bring in more friends.
  $('lb-dh-make').onclick = () => makeInvite('lb-dh-code', 'Send this code to your friend, then paste their reply below.');
  $('lb-dh-accept').onclick = () => acceptReply('lb-dh-reply', 'lb-dh-code');
  $('lb-ts-make').onclick = () => makeInvite('lb-ts-code', 'Invite code ready: send it to your friend, then paste their reply.');
  $('lb-ts-accept').onclick = () => acceptReply('lb-ts-reply', 'lb-ts-code');
  $('lb-dh-copy').onclick = () => copyCode('lb-dh-code');
  $('lb-dj-copy').onclick = () => copyCode('lb-dj-reply');
  $('lb-ts-copy').onclick = () => copyCode('lb-ts-code');
  $('lb-dj-make').onclick = async () => {
    if (!$('lb-dj-code').value.trim()) return status('Paste the invite code from the host first.', true);
    status('Making your reply code…');
    try { $('lb-dj-reply').value = await directJoin($('lb-dj-code').value, () => status('Connected! Waiting for the host…')); status('Send this reply code back to the host.'); } catch (e) { status(e.message, true); }
  };
  $('lb-start').onclick = () => { const { mode, opts } = hostOpts(); G.lobby.mode = mode; G.lobby.opts = opts; broadcast({ t: 'start', mode, opts, players: G.lobby.players }); H.start(mode, opts); };
  $('lb-leave').onclick = () => { leaveNet(); G.lobby.players = []; clearCodes(); showStage('pick'); status(''); H.show('menu'); };
  $('lb-copy').onclick = () => { navigator.clipboard?.writeText(NET.code); status('Room code copied.'); };
  on('hello', (m, from) => {
    if (G.net.role !== 'host') return;
    if (!G.lobby.players.length) afterHost();          // the first friend is in: now the lobby opens
    const p = { ...m.info, id: from };
    const fresh = !G.lobby.players.some(x => x.id === from);
    G.lobby.players = G.lobby.players.filter(x => x.id !== from).concat(p);
    if (fresh) { sfx.bell(); status(`${p.name || 'A player'} is aboard.`); }
    clearTimeout(connTimer);
    pushLobby();
  });
  on('lobby', m => { G.lobby.players = m.players; G.lobby.mode = m.mode; G.lobby.opts = m.opts; renderPlayers(); renderGuestMode(m.mode, m.opts); });
  on('welcome', m => { G.net.id = m.id; hello(); });      // every link gets one, so this is the only hello
  on('full', m => { status(m.why || 'The game is full.', true); leaveNet(); });
  on('start', m => { G.lobby.players = m.players; H.startGuest(m.mode, m.opts); });
  on('lobbyBack', () => H.backToLobby());
  NET.onConn = pid => { if (G.net.role === 'host') { send(pid, { t: 'welcome', id: pid }); status('A player is coming aboard…'); } };
  NET.onDrop = pid => H.onDrop(pid);
  NET.onPing = () => {
    if (G.running) return;
    if (G.net.role === 'host' && G.lobby.players.length) { const t = performance.now(); if (t - pingPush > 1500) { pingPush = t; pushLobby(); } }
    else if (G.net.role === 'guest') renderPlayers();
  };
  showStage('pick');
  installPartyApi();
}
let connTimer = 0, pingPush = 0;
async function makeInvite(codeId, msg) {
  status('Making the invite code…');
  try { $(codeId).value = await directHostCode(); $(codeId).select?.(); status(msg); }
  catch (e) { status(e.message, true); }
}
async function acceptReply(replyId, codeId) {
  const reply = $(replyId).value.trim();
  if (!reply) return status('Paste the reply code from your friend first.', true);
  try {
    await directHostAccept(reply);
    $(replyId).value = ''; $(codeId).value = '';
    status('Connecting…');
    clearTimeout(connTimer);
    connTimer = setTimeout(() => status("Couldn't connect. Are you both on the same LAN or Tailscale network? Make a new invite code and try again.", true), 20000);
  } catch (e) { status(e.message, true); }
}
function copyCode(id) {
  const t = $(id);
  if (!t.value) return status('Nothing to copy yet.', true);
  t.select();
  (navigator.clipboard?.writeText(t.value) ?? Promise.reject()).then(() => status('Copied.'), () => { document.execCommand?.('copy'); status('Copied.'); });
}
function clearCodes() { for (const id of ['lb-dh-code', 'lb-dh-reply', 'lb-dj-code', 'lb-dj-reply', 'lb-ts-code', 'lb-ts-reply']) $(id).value = ''; clearTimeout(connTimer); }

// ---------- for the website's party lobby (Games web page/party.js + party-adapter.js) ----------
function installPartyApi() {
  const toOnline = () => {
    const sp = $('splash');
    if (sp) sp.click();                 // skip the "click to start" screen
    if (!G.running) H.show('online');
  };
  const pickMode = mode => { const b = document.querySelector(`#lb-mode button[data-v="${mode || 'ffa'}"]`); if (b) b.click(); };
  window.ShipMadness = {
    ready: () => !!$('profile')?.textContent,
    setName(n) { if (n) { P.name = String(n).slice(0, 16); saveProfile(); } },
    inGame: () => G.running,
    players: () => G.lobby.players.length,
    async hostRoom(mode) {
      toOnline();
      const code = await hostPeerJS();
      $('lb-code').textContent = code; $('lb-codebox').classList.remove('hidden');
      afterHost(); pickMode(mode);
      status('Room ready. Your party is joining…');
      return code;
    },
    hostManual(mode) {                  // LAN / Tailscale only: be the host without a room code
      toOnline();
      G.net.role = 'host'; G.net.id = 'p0'; NET.mode = 'direct';
      afterHost(); pickMode(mode);
    },
    async joinRoom(code) { toOnline(); await joinPeerJS(code); status('Connected! Waiting for the host…'); },
    makeInvite: () => directHostCode(),
    acceptReply: reply => directHostAccept(reply),
    async answerInvite(invite) { toOnline(); return directJoin(invite, () => status('Connected! Waiting for the host…')); },
    start() { if (G.net.role === 'host' && !G.running) $('lb-start').click(); },
  };
}
function onSegChange(id) {
  if (id === 'lb-way') { const lan = segVal('lb-way') === 'lan'; $('lb-net').classList.toggle('hidden', lan); $('lb-lan').classList.toggle('hidden', !lan); return; }
  if (id === 'lb-mode') renderModeOpts();
  if (G.net.role === 'host') pushLobby();
}
function renderModeOpts() {
  const m = segVal('lb-mode');
  $('lb-o-ffa').classList.toggle('hidden', m !== 'ffa');
  $('lb-o-camp').classList.toggle('hidden', m !== 'camp');
  $('lb-o-sand').classList.toggle('hidden', m !== 'sandbox');
}
function status(text, bad = false) { const s = $('lb-status'); s.textContent = text; s.classList.toggle('bad', bad); }
function showStage(st) { for (const k of ['pick', 'room']) $('lb-' + k).classList.toggle('hidden', k !== st); }
function hello() { send('p0', { t: 'hello', info: myInfo() }); showStage('room'); $('lb-hostctl').classList.add('hidden'); $('lb-ts').classList.add('hidden'); $('lb-wait').classList.remove('hidden'); }
function afterHost() {
  G.lobby.players = [{ ...myInfo(), id: 'p0' }];
  showStage('room');
  $('lb-hostctl').classList.remove('hidden'); $('lb-wait').classList.add('hidden');
  renderModeOpts(); pushLobby();
}
async function createRoom() {
  status('Creating a room…');
  try {
    const code = await hostPeerJS();
    $('lb-code').textContent = code; $('lb-codebox').classList.remove('hidden');
    status('Room ready. Tell your friends the code!');
    afterHost();
  } catch (e) { status(e.message || 'Could not create the room.', true); }
}
async function joinRoom() {
  const code = $('lb-join-code').value.trim();
  if (code.length < 4) return status('Type the room code first.', true);
  status('Joining…');
  try { await joinPeerJS(code); status('Connected! Waiting for the host…'); } catch (e) { status(e.message || 'Could not join.', true); }
}
export function pushLobby() {
  if (G.net.role !== 'host' || !G.lobby.players.length) return;      // no lobby yet (still inviting the first friend)
  const { mode, opts } = hostOpts();
  G.lobby.mode = mode; G.lobby.opts = opts;
  G.lobby.players[0] = { ...myInfo(), id: 'p0' };
  for (const p of G.lobby.players) p.ping = p.id === 'p0' ? null : NET.ping.get(p.id) ?? null;
  broadcast({ t: 'lobby', players: G.lobby.players, mode, opts });
  renderPlayers();
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// round trip to the host, in ms (the host's own row has none)
function pingOf(p) {
  if (p.id === 'p0') return null;
  if (G.net.role === 'host') return NET.ping.get(p.id) ?? null;
  if (p.id === G.net.id) return NET.ping.get('p0') ?? p.ping ?? null;
  return p.ping ?? null;
}
const pingChip = ms => ms == null ? '' : ` <span class="ping ${ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad'}">${ms} ms</span>`;
export function renderPlayers() {
  const list = $('lb-players');
  list.innerHTML = G.lobby.players.map(p => `<div class="lb-player"><span class="avatar small" style="background:${esc(p.shirt)}">${esc((p.name?.[0] || '?').toUpperCase())}</span><b>${esc(p.name)}</b>${p.id === 'p0' ? ' <span class="chip warn">👑 Host</span>' : ''}${p.id === G.net.id ? ' <span class="chip">You</span>' : ''}${pingChip(pingOf(p))}<small>${esc(p.kits?.[G.lobby.mode]?.ship || '')}</small></div>`).join('') +
    Array.from({ length: Math.max(0, 4 - G.lobby.players.length) }, () => '<div class="lb-player empty">Waiting for a player…</div>').join('');
  // the host can bring in more friends over LAN / Tailscale while there's room
  $('lb-ts').classList.toggle('hidden', !(G.net.role === 'host' && G.lobby.players.length < 4));
}
function renderGuestMode(mode, opts) {
  const names = { ffa: '⚔️ Free-for-all', camp: '🧭 Co-op campaign', sandbox: '🏝️ Sandbox' };
  $('lb-wait').innerHTML = `<p class="note">Mode: <b>${names[mode]}</b>${mode === 'ffa' ? ` · AI rivals: ${opts.rivals}` : mode === 'camp' ? ` · ${opts.diff}` : ''}</p><p class="note">Waiting for the host to start…</p>`;
}
export function openOnline() {
  const role = G.net.role;
  if (role === 'solo') { showStage('pick'); status(''); $('lb-codebox').classList.add('hidden'); }
  else if (role === 'host' && !G.lobby.players.length) showStage('pick');       // still inviting the first friend
  else { showStage('room'); renderPlayers(); }
  $('lb-name').textContent = P.name;
}
export function lobbyBack() { if (G.net.role === 'host') broadcast({ t: 'lobbyBack' }); }
