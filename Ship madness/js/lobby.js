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
  $('lb-dh-make').onclick = async () => { try { $('lb-dh-code').value = await directHostCode(); status('Send this code to your friend, then paste their reply below.'); afterHost(); } catch (e) { status(e.message, true); } };
  $('lb-dh-accept').onclick = async () => { try { await directHostAccept($('lb-dh-reply').value); status('Connecting…'); } catch (e) { status(e.message, true); } };
  $('lb-dj-make').onclick = async () => { try { $('lb-dj-reply').value = await directJoin($('lb-dj-code').value, () => { status('Connected! Waiting for the host…'); hello(); }); status('Send this reply code back to the host.'); } catch (e) { status(e.message, true); } };
  $('lb-start').onclick = () => { const { mode, opts } = hostOpts(); G.lobby.mode = mode; G.lobby.opts = opts; broadcast({ t: 'start', mode, opts, players: G.lobby.players }); H.start(mode, opts); };
  $('lb-leave').onclick = () => { leaveNet(); G.lobby.players = []; showStage('pick'); H.show('menu'); };
  $('lb-copy').onclick = () => { navigator.clipboard?.writeText(NET.code); status('Room code copied.'); };
  on('hello', (m, from) => {
    if (G.net.role !== 'host') return;
    const p = { ...m.info, id: from };
    G.lobby.players = G.lobby.players.filter(x => x.id !== from).concat(p);
    sfx.bell(); pushLobby();
  });
  on('lobby', m => { G.lobby.players = m.players; G.lobby.mode = m.mode; G.lobby.opts = m.opts; renderPlayers(); renderGuestMode(m.mode, m.opts); });
  on('welcome', m => { G.net.id = m.id; hello(); });
  on('full', m => { status(m.why || 'The game is full.', true); leaveNet(); });
  on('start', m => { G.lobby.players = m.players; H.startGuest(m.mode, m.opts); });
  on('lobbyBack', () => H.backToLobby());
  NET.onConn = pid => { if (G.net.role === 'host') { send(pid, { t: 'welcome', id: pid }); status(`A player connected (${pid}).`); } };
  NET.onDrop = pid => H.onDrop(pid);
  showStage('pick');
  installPartyApi();
}

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
    async answerInvite(invite) { toOnline(); return directJoin(invite, () => { status('Connected! Waiting for the host…'); hello(); }); },
    start() { if (G.net.role === 'host' && !G.running) $('lb-start').click(); },
  };
}
function onSegChange(id) {
  if (id === 'lb-way') { const lan = segVal('lb-way') === 'lan'; $('lb-net').classList.toggle('hidden', lan); $('lb-lan').classList.toggle('hidden', !lan); }
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
function hello() { send('p0', { t: 'hello', info: myInfo() }); showStage('room'); $('lb-hostctl').classList.add('hidden'); $('lb-wait').classList.remove('hidden'); }
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
  if (G.net.role !== 'host') return;
  const { mode, opts } = hostOpts();
  G.lobby.mode = mode; G.lobby.opts = opts;
  G.lobby.players[0] = { ...myInfo(), id: 'p0' };
  broadcast({ t: 'lobby', players: G.lobby.players, mode, opts });
  renderPlayers();
}
export function renderPlayers() {
  const list = $('lb-players');
  list.innerHTML = G.lobby.players.map(p => `<div class="lb-player"><span class="avatar small" style="background:${p.shirt}">${(p.name[0] || '?').toUpperCase()}</span><b>${p.name}</b>${p.id === 'p0' ? ' <span class="chip warn">👑 Host</span>' : ''}${p.id === G.net.id ? ' <span class="chip">You</span>' : ''}<small>${p.kits?.[G.lobby.mode]?.ship || ''}</small></div>`).join('') +
    Array.from({ length: Math.max(0, 4 - G.lobby.players.length) }, () => '<div class="lb-player empty">Waiting for a player…</div>').join('');
}
function renderGuestMode(mode, opts) {
  const names = { ffa: '⚔️ Free-for-all', camp: '🧭 Co-op campaign', sandbox: '🏝️ Sandbox' };
  $('lb-wait').innerHTML = `<p class="note">Mode: <b>${names[mode]}</b>${mode === 'ffa' ? ` · AI rivals: ${opts.rivals}` : mode === 'camp' ? ` · ${opts.diff}` : ''}</p><p class="note">Waiting for the host to start…</p>`;
}
export function openOnline() {
  if (G.net.role === 'solo') { showStage('pick'); status(''); $('lb-codebox').classList.add('hidden'); }
  else { showStage('room'); renderPlayers(); }
  $('lb-name').textContent = P.name;
}
export function lobbyBack() { if (G.net.role === 'host') broadcast({ t: 'lobbyBack' }); }
