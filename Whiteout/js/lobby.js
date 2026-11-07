// The Play screen: solo, host or join (room code or LAN / Tailscale invite codes), then the crew lobby with
// four slots, ready checks, the host's options and a chat. Starting is wired up: everyone gets the message,
// but the island itself isn't built yet.
import { G, S, saveSettings, esc } from './state.js';
import { NET, MAX, on, send, broadcast, hostPeerJS, joinPeerJS, directHostCode, directHostAccept, directJoin, becomeDirectHost, leaveNet } from './net.js';
import { ui } from './audio.js';

const $ = id => document.getElementById(id);
let H = null, stage = 'pick';
const me = () => ({ id: G.net.id, name: S.name, coat: S.coat, ready: G.net.role === 'host' ? true : !!G.myReady });

export function initLobby(h) {
  H = h;
  // connection way
  const way = $('net-way');
  const syncWay = () => {
    way.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === S.netWay));
    $('net-hint').textContent = S.netWay === 'peer'
      ? (S.custom ? `Using your own PeerJS server ${S.sHost}:${S.sPort}` : 'Works anywhere with internet. A free public server only introduces you.')
      : 'No server: the host makes an invite code per friend. Works on a LAN and over Tailscale.';
  };
  way.querySelectorAll('button').forEach(b => b.onclick = () => { S.netWay = b.dataset.v; saveSettings(); syncWay(); ui.click(); });
  syncWay();
  $('pc-solo').onclick = () => { ui.error(); H.toast('Solo opens once the island is built. The menu comes first: this is it!', 'warn'); };
  $('pc-host').onclick = () => startHost();
  $('pc-join').onclick = () => { setStage('join'); setTimeout(() => $(S.netWay === 'peer' ? 'join-code' : 'dj-code').focus(), 50); };
  $('join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  $('join-go').onclick = joinRoom;
  // invite codes
  $('dh-make').onclick = async () => { try { status('Making an invite…'); $('dh-code').value = await directHostCode(); status('Send the invite to one friend, then paste their reply.'); enterLobby(); setStage('host'); } catch (e) { fail(e); } };
  $('dh-accept').onclick = async () => { try { await directHostAccept($('dh-reply').value); $('dh-reply').value = ''; $('dh-code').value = ''; status('Connecting…'); } catch (e) { fail(e); } };
  $('dj-make').onclick = async () => { try { status('Reading the invite…'); $('dj-reply').value = await directJoin($('dj-code').value, () => status('Connected!')); status('Send this reply back to the host. You join as soon as they paste it.'); } catch (e) { fail(e); } };
  for (const [b, t] of [['dh-copy', 'dh-code'], ['dj-copy', 'dj-reply'], ['room-copy', null]]) $(b).onclick = () => { const v = t ? $(t).value : NET.code; if (!v) return; navigator.clipboard?.writeText(v).then(() => H.toast('Copied.'), () => H.toast(v)); ui.click(); };
  // lobby
  $('lb-leave').onclick = leave;
  $('lb-ready').onclick = () => { G.myReady = !G.myReady; send('p0', { t: 'ready', v: G.myReady }); renderSlots(); ui.click(); };
  $('lb-start').onclick = () => {
    const notReady = G.lobby.players.filter(p => !p.ready);
    if (notReady.length) { ui.error(); return H.toast(`Waiting for ${notReady.map(p => p.name).join(', ')} to be ready.`, 'warn'); }
    G.started = true;
    broadcast({ t: 'start', opts: G.lobby.opts });
    H.starting(G.lobby);
  };
  for (const id of ['o-diff', 'o-island', 'o-ff']) {
    const seg = $(id), key = { 'o-diff': 'diff', 'o-island': 'island', 'o-ff': 'ff' }[id];
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { if (G.net.role !== 'host') return; G.lobby.opts[key] = b.dataset.v; syncOpts(); push(); ui.click(); });
  }
  $('chat-send').onclick = sendChat;
  $('chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); e.stopPropagation(); });
  // messages
  on('welcome', m => { G.net.id = m.id; hello(); });
  on('hello', (m, from) => {
    if (G.net.role !== 'host') return;
    G.lobby.players = G.lobby.players.filter(p => p.id !== from).concat({ ...m.info, id: from, ready: false });
    chatLine(null, `${m.info.name} joined the crew.`); ui.join(); push();
  });
  on('ready', (m, from) => { const p = G.lobby.players.find(x => x.id === from); if (p) { p.ready = !!m.v; push(); } });
  on('rename', (m, from) => { const p = G.lobby.players.find(x => x.id === from); if (p) { p.name = m.name; p.coat = m.coat; push(); } });
  on('lobby', m => { G.lobby.players = m.players; G.lobby.opts = m.opts; syncOpts(); renderSlots(); });
  on('chat', m => { chatLine(m.from, m.text); if (G.net.role === 'host') broadcast({ t: 'chat', text: m.text, from: m.from }); });
  on('full', m => { fail(new Error(m.why)); leaveNet(); setStage('pick'); });
  on('kick', () => { H.toast('The host removed you from the crew.', 'bad'); leave(true); });
  on('start', m => { G.lobby.opts = m.opts; H.starting(G.lobby); });
  NET.onConn = pid => { if (G.net.role === 'host') send(pid, { t: 'welcome', id: pid }); };
  NET.onDrop = pid => {
    if (G.net.role === 'guest' && pid === 'p0') { H.toast('Lost the connection to the host.', 'bad'); leave(true); return; }
    const p = G.lobby.players.find(x => x.id === pid);
    G.lobby.players = G.lobby.players.filter(x => x.id !== pid);
    if (p) { chatLine(null, `${p.name} left.`); push(); }
  };
  setStage('pick');
  installPartyApi();
}

function setStage(st) {
  stage = st;
  for (const s of ['pick', 'host', 'join', 'lobby']) $('play-' + s).classList.toggle('hidden', s !== st && !(s === 'lobby' && st === 'host' && G.net.role === 'host'));
  const direct = S.netWay === 'direct';
  document.querySelectorAll('#s-play .form-peer').forEach(e => e.classList.toggle('hidden', direct));
  document.querySelectorAll('#s-play .form-direct').forEach(e => e.classList.toggle('hidden', !direct));
  const inRoom = G.net.role !== 'solo' && (st === 'lobby' || st === 'host');
  $('lb-leave').classList.toggle('hidden', st === 'pick');
  $('lb-leave').textContent = inRoom ? 'Leave the crew' : 'Back';
  $('lb-start').classList.toggle('hidden', !(G.net.role === 'host' && inRoom));
  $('lb-ready').classList.toggle('hidden', !(G.net.role === 'guest' && inRoom));
  if (st === 'host' && S.netWay === 'peer') $('play-host').classList.add('hidden');
  footer();
}
export function playBack() {      // the ‹ button / Esc on the Play screen
  if (stage === 'pick') return false;
  if (G.net.role !== 'solo') { leave(); return true; }
  setStage('pick'); return true;
}
export function openPlay() {
  document.querySelectorAll('.me-name').forEach(e => { e.textContent = S.name; });
  if (G.net.role === 'solo') { setStage('pick'); status(''); }
}
function status(text, bad = false) { const s = $('net-status'); s.textContent = text; s.classList.toggle('bad', bad); footer(); }
// the footer only shows when it has something in it
function footer() { $('s-play').querySelector('.p-foot').classList.toggle('hidden', stage === 'pick' && !$('net-status').textContent); }
function fail(e) { status(e.message || String(e), true); ui.error(); }

async function startHost() {
  if (S.netWay === 'direct') { becomeDirectHost(); enterLobby(); setStage('host'); status('Make an invite code for each friend.'); return; }
  status(S.custom ? `Opening a room on ${S.sHost}…` : 'Opening a room…');
  try {
    const code = await hostPeerJS();
    $('room-code').textContent = code; $('room-box').classList.remove('hidden');
    enterLobby(); setStage('lobby');
    status('Room open. Share the code!'); ui.good();
  } catch (e) { fail(e); leaveNet(); }
}
async function joinRoom() {
  const code = $('join-code').value.trim();
  if (code.length < 5) { $('join-code').classList.add('shake'); setTimeout(() => $('join-code').classList.remove('shake'), 400); return fail(new Error('A room code has 5 letters.')); }
  status('Joining…');
  try { await joinPeerJS(code); status('Connected!'); } catch (e) { fail(e); leaveNet(); }
}
function enterLobby() {
  G.lobby.players = [me()];
  $('chat-log').innerHTML = '';
  $('room-box').classList.toggle('hidden', NET.mode !== 'peerjs');
  syncOpts(); renderSlots();
}
function hello() {
  G.myReady = false;
  $('chat-log').innerHTML = '';
  $('room-box').classList.toggle('hidden', NET.mode !== 'peerjs');
  if (NET.mode === 'peerjs') $('room-code').textContent = NET.code;
  send('p0', { t: 'hello', info: { name: S.name, coat: S.coat } });
  setStage('lobby'); ui.join();
  status('You are in. Press "I\'m ready" when you are.');
}
function leave(silent) {
  if (G.net.role !== 'solo' && !silent) broadcast({ t: 'chat', text: `${S.name} left.`, from: null });
  leaveNet(); G.lobby.players = []; G.myReady = false;
  setStage('pick'); status(''); if (!silent) ui.back();
}
function push() {
  if (G.net.role !== 'host') return;
  G.lobby.players[0] = me();
  broadcast({ t: 'lobby', players: G.lobby.players, opts: G.lobby.opts });
  renderSlots();
}
export function profileChanged() {
  if (G.net.role === 'host') push();
  else if (G.net.role === 'guest') send('p0', { t: 'rename', name: S.name, coat: S.coat });
  document.querySelectorAll('.me-name').forEach(e => { e.textContent = S.name; });
}
function syncOpts() {
  const host = G.net.role === 'host', o = G.lobby.opts;
  for (const [id, key] of [['o-diff', 'diff'], ['o-island', 'island'], ['o-ff', 'ff']]) $(id).querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === String(o[key])); b.disabled = !host; });
  $('lb-opts').classList.toggle('locked', !host);
}
function renderSlots() {
  const ps = G.lobby.players;
  $('slots').innerHTML = Array.from({ length: MAX }, (_, i) => {
    const p = ps[i];
    if (!p) return `<div class="slot empty"><div class="sl-av"></div><div class="sl-txt"><b>Empty seat</b><small>${G.net.role === 'host' ? (NET.mode === 'direct' ? 'Make an invite code' : 'Share the room code') : 'Waiting…'}</small></div></div>`;
    const host = p.id === 'p0', mine = p.id === G.net.id;
    return `<div class="slot ${p.ready ? 'ready' : ''} ${mine ? 'mine' : ''}"><div class="sl-av" style="--coat:${esc(p.coat || '#b4462e')}">${esc((p.name || '?')[0].toUpperCase())}</div>
      <div class="sl-txt"><b>${esc(p.name)}</b><small>${host ? 'Host · pilot' : ['', 'Passenger', 'Passenger', 'Passenger'][i] || 'Passenger'}${mine ? ' · you' : ''}</small></div>
      <span class="sl-state">${p.ready ? 'READY' : 'NOT READY'}</span>${G.net.role === 'host' && !host ? `<button class="sl-kick" data-kick="${p.id}" title="Remove">✕</button>` : ''}</div>`;
  }).join('');
  $('slots').querySelectorAll('[data-kick]').forEach(b => b.onclick = () => { send(b.dataset.kick, { t: 'kick' }); setTimeout(() => NET.conns.get(b.dataset.kick)?.close(), 200); });
  const guest = G.net.role === 'guest';
  $('lb-guest').classList.toggle('hidden', !guest);
  if (guest) $('lb-guest').textContent = 'The host picks the difficulty and the island.';
  $('lb-ready').textContent = G.myReady ? 'Not ready' : "I'm ready";
  $('lb-ready').classList.toggle('primary', !G.myReady);
  const allReady = ps.length > 0 && ps.every(p => p.ready);
  $('lb-start').classList.toggle('dim', !allReady);
}
function sendChat() {
  const inp = $('chat-in'), text = inp.value.trim().slice(0, 140);
  if (!text) return;
  inp.value = '';
  if (G.net.role === 'solo') return;
  chatLine(G.net.id, text);
  if (G.net.role === 'host') broadcast({ t: 'chat', text, from: 'p0' }); else send('p0', { t: 'chat', text });
}
function chatLine(from, text) {
  const p = G.lobby.players.find(x => x.id === from);
  const d = document.createElement('div');
  d.className = from ? 'cl' : 'cl sys';
  d.innerHTML = from ? `<b style="color:${esc(p?.coat || '#ddd')}">${esc(p?.name || '?')}</b> <span></span>` : '<span></span>';
  d.querySelector('span').textContent = text;
  $('chat-log').append(d);
  $('chat-log').scrollTop = 1e9;
  if (from && from !== G.net.id) ui.chat();
}

// ---------- for the website's party lobby (party-adapter.js), same shape as the other games ----------
function installPartyApi() {
  window.Whiteout = {
    ready: () => G.screen !== 'splash' || !!document.getElementById('splash'),
    setName(n) { if (n) { S.name = String(n).slice(0, 16); saveSettings(); profileChanged(); } },
    players: () => G.lobby.players.length,
    async hostRoom() { H.go('play'); S.netWay = 'peer'; const code = await hostPeerJS(); $('room-code').textContent = code; enterLobby(); setStage('lobby'); return code; },
    hostManual() { H.go('play'); S.netWay = 'direct'; becomeDirectHost(); enterLobby(); setStage('host'); },
    async joinRoom(code) { H.go('play'); await joinPeerJS(code); },
    makeInvite: () => directHostCode(),
    acceptReply: r => directHostAccept(r),
    async answerInvite(inv) { H.go('play'); S.netWay = 'direct'; return directJoin(inv, () => {}); },
    start() { if (G.net.role === 'host') $('lb-start').click(); },
  };
}
