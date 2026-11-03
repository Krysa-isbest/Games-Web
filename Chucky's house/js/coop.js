// Co-op glue: lobby, roster, player avatars, shop sync (host -> guests), approvals, text chat.
import * as THREE from 'three';
import { G, ensurePlayer } from './state.js';
import { itemById, makeItemMesh } from './data.js';
import { makePerson, animatePerson, poseArms, nameTag } from './people.js';
import { makeShelf, placeShelf, setSlotItem, removeShelf, shelfBySid, refreshTags } from './shelves.js';
import { spawnTrash, removeTrash } from './trash.js';
import { customerSnap, mirrorCustomers, lerpCustomers, releaseServed } from './customers.js';
import { coopSnap, mirrorCoop, updateCoop } from './chickens.js';
import { updateWorld, updateBin, updateSign } from './world.js';
import { NET, on, send, broadcast, act, hostPeerJS, joinPeerJS, directHostCode, directHostAccept, directJoin, isGuest, isHost } from './net.js';
import { VOICE, syncVoicePeers, speaking } from './voice.js';
import { S, saveSettings } from './settings.js';
import { messSnap, mirrorMess } from './mess.js';
import { updateDecor } from './decor.js';
import { applyIntroWorld } from './story.js';
import { setRain } from './city.js';
import { animateEmote } from './fun.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const ECON = ['money', 'day', 'time', 'phase', 'debt', 'paidWeek', 'strikes', 'xp', 'trust', 'backstock', 'market', 'marketPrev', 'deals', 'auction', 'night',
  'gear', 'tools', 'weapons', 'up', 'eggs', 'doorOpen', 'binCount', 'stats', 'pending',
  'clean', 'jobs', 'dayStats', 'life', 'history', 'orders', 'regulars', 'decor', 'shopEvent', 'weekEvent', 'story', 'intro', 'tut', 'tutFlags', 'radio'];
const COLORS = [0xd04a2a, 0x2a7ad0, 0x2ab04a, 0xd0a020];
const avatars = new Map();
let sendT = 0, snapT = 0, lastDay = 0;

// ---------- roster ----------
// The host greets every new connection with its player id; the guest answers with its name.
NET.onConn = pid => { if (isHost()) send(pid, { t: 'welcome', id: pid }); };
NET.onDrop = pid => {
  if (isGuest() && pid === 'p0') {
    UI.toast('Lost the connection to the host.', 'bad');
    setTimeout(() => location.reload(), 2500);
    return;
  }
  const name = G.players[pid]?.name || 'A player';
  delete G.players[pid];
  releaseServed(pid);
  dropAvatar(pid);
  broadcastRoster();
  syncVoicePeers();
  UI.toast(`${name} left the game.`);
  lobbyRefresh();
};
on('welcome', m => { G.me = m.id; send('p0', { t: 'hello', name: S.name }); });
on('hello', (m, from) => {
  ensurePlayer(from, (m.name || 'Player').slice(0, 16));
  broadcastRoster();
  syncVoicePeers();
  UI.toast(`${G.players[from].name} joined!`);
  if (G.mode === 'play') send(from, { t: 'start', ss: shopSnap() });
  lobbyRefresh();
});
function broadcastRoster() {
  const players = Object.fromEntries(Object.values(G.players).map(p => [p.id, p.name]));
  broadcast({ t: 'roster', players });
}
on('roster', m => {
  for (const [pid, name] of Object.entries(m.players)) ensurePlayer(pid, name).name = name;
  for (const pid of Object.keys(G.players)) if (!m.players[pid]) { delete G.players[pid]; dropAvatar(pid); }
  syncVoicePeers();
  lobbyRefresh();
});

// ---------- lobby ----------
let mode = 'peerjs', lobbyBack = null;
const micLine = () => ({ on: '🎙️ Microphone on', denied: '🔇 Microphone blocked: voice off (text chat with T)', none: '🔇 No microphone found', asking: '🎙️ Asking for the microphone…', off: '🔇 Microphone off' })[VOICE.status];
function playersList() {
  return `<div class="players">${Object.values(G.players).map(p => `<span class="pl" style="--c:#${COLORS[+p.id.slice(1)].toString(16)}">${p.id === 'p0' ? '👑 ' : ''}${p.name}${p.id === G.me ? ' (you)' : ''}</span>`).join('')}</div>`;
}
function lobbyRefresh() { if (UI.$('co-players')) UI.$('co-players').innerHTML = playersList(); if (UI.$('co-start')) UI.$('co-start').disabled = false; }

export function openCoop(onStart, back) {
  lobbyBack = back;
  const render = () => {
    const online = NET.role !== 'solo';
    UI.openPanel(`<h2>👥 Co-op <small class="dim">up to 4 players</small></h2>
      <div class="tabs">${online ? '' : `<button class="tab ${mode === 'peerjs' ? 'on' : ''}" data-mode="peerjs">🌐 Room code (PeerJS)</button><button class="tab ${mode === 'direct' ? 'on' : ''}" data-mode="direct">🔗 Direct code (Tailscale / LAN)</button>`}</div>
      <p class="dim small">${micLine()} · Your name: <b>${S.name}</b> (change it in Settings → Game)</p>
      <div id="co-body"></div>
      <div id="co-players">${online ? playersList() : ''}</div>
      <div class="row">${isHost() ? `<button id="co-start">${G.hasSave ? 'Continue the game ▶' : 'Start a new game ▶'}</button>` : ''}<button id="co-back" class="ghost">Back</button></div>`, { cls: 'wide', esc: back });
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
    UI.$('co-back').onclick = back;
    if (UI.$('co-start')) UI.$('co-start').onclick = () => { UI.closePanel(false); onStart(); };
    body();
  };
  const body = () => {
    const el = UI.$('co-body');
    if (isGuest()) { el.innerHTML = '<div class="okbox">✓ Connected! Waiting for the host to start…</div>'; return; }
    if (mode === 'peerjs') {
      if (isHost()) {
        // a room-code host can also let one friend in over Tailscale (mixed game)
        el.innerHTML = `<div class="code-big">${NET.code}</div><p class="dim center">Give this room code to your friends.</p>
          <details class="co-mixed"><summary>+ Add a friend over Tailscale / LAN (direct code)</summary>
          <p>1. Send this code to them:</p><textarea id="co-mycode" readonly placeholder="Click 'Make a code'"></textarea>
          <div class="row"><button id="co-mk">Make a code</button><button id="co-cp" class="ghost">Copy</button></div>
          <p>2. Paste their reply code:</p><textarea id="co-reply" placeholder="PB1…"></textarea>
          <div class="row"><button id="co-acc">Connect</button></div><p id="co-err" class="down"></p></details>`;
        bindDirectHost();
        return;
      }
      el.innerHTML = `<div class="co-split"><div><h3>Host</h3><p class="dim small">Uses the free PeerJS server to connect (needs internet).</p><button id="co-host">Host a game</button></div>
        <div><h3>Join</h3><input id="co-code" class="text" maxlength="5" placeholder="ROOM CODE"><button id="co-join">Join</button></div></div><p id="co-err" class="down"></p>`;
      UI.$('co-host').onclick = async () => { try { UI.$('co-host').disabled = true; await hostPeerJS(); ensurePlayer('p0', S.name); G.me = 'p0'; render(); } catch (e) { UI.$('co-err').textContent = e.message; UI.$('co-host').disabled = false; } };
      UI.$('co-join').onclick = async () => { try { UI.$('co-join').disabled = true; UI.$('co-err').textContent = 'Connecting…'; await joinPeerJS(UI.$('co-code').value); render(); } catch (e) { UI.$('co-err').textContent = e.message; UI.$('co-join').disabled = false; } };
      return;
    }
    // direct codes
    if (isHost()) {
      el.innerHTML = `<p>1. Send this code to the next player:</p><textarea id="co-mycode" readonly placeholder="Click 'Make a code'"></textarea>
        <div class="row"><button id="co-mk">Make a code for the next player</button><button id="co-cp" class="ghost">Copy</button></div>
        <p>2. Paste the reply code they send back:</p><textarea id="co-reply" placeholder="PB1…"></textarea>
        <div class="row"><button id="co-acc">Connect</button></div><p id="co-err" class="down"></p>`;
      bindDirectHost();
      return;
    }
    el.innerHTML = `<div class="co-split"><div><h3>Host</h3><p class="dim small">No server: codes are swapped by hand (chat, Discord…). Works over Tailscale or the same Wi-Fi. Allow the microphone first, or browsers may hide your address.</p><button id="co-dhost">Host a game</button></div>
      <div><h3>Join</h3><p class="small">1. Paste the host's code:</p><textarea id="co-hcode" placeholder="PB1…"></textarea><button id="co-mkreply">Make my reply code</button>
      <p class="small">2. Send this reply back to the host:</p><textarea id="co-rcode" readonly></textarea><button id="co-rcp" class="ghost">Copy</button></div></div><p id="co-err" class="down"></p>`;
    UI.$('co-dhost').onclick = () => { NET.role = 'host'; NET.mode = 'direct'; ensurePlayer('p0', S.name); G.me = 'p0'; render(); };
    UI.$('co-mkreply').onclick = async () => {
      try { UI.$('co-err').textContent = 'Working…'; UI.$('co-rcode').value = await directJoin(UI.$('co-hcode').value, () => render()); UI.$('co-err').textContent = 'Send the reply code to the host and wait.'; }
      catch (e) { UI.$('co-err').textContent = e.message; }
    };
    UI.$('co-rcp').onclick = () => copy(UI.$('co-rcode').value);
  };
  render();
}
function bindDirectHost() {
  UI.$('co-mk').onclick = async () => {
    try { UI.$('co-err').textContent = 'Working…'; UI.$('co-mycode').value = await directHostCode(); UI.$('co-err').textContent = ''; }
    catch (e) { UI.$('co-err').textContent = e.message; }
  };
  UI.$('co-cp').onclick = () => copy(UI.$('co-mycode').value);
  UI.$('co-acc').onclick = async () => {
    try { await directHostAccept(UI.$('co-reply').value); UI.$('co-err').textContent = 'Connecting… (if nothing happens in 10 s, make a new code)'; UI.$('co-reply').value = ''; UI.$('co-mycode').value = ''; }
    catch (e) { UI.$('co-err').textContent = e.message; }
  };
}
function copy(text) { navigator.clipboard?.writeText(text).then(() => UI.toast('Copied!')).catch(() => UI.toast('Select the text and press Ctrl+C.')); }
void lobbyBack;

// ---------- shop snapshot (host -> guests) ----------
export function shopSnap() {
  const econ = Object.fromEntries(ECON.map(k => [k, G[k]]));
  return {
    econ,
    shelves: G.shelves.map(s => ({ sid: s.userData.sid, type: s.userData.type, x: s.position.x, z: s.position.z, r: s.userData.r, slots: s.userData.slots.map(x => x.item) })),
    floor: G.phys.snapshot(),
    trash: G.trash.map(t => [t.userData.tid, +t.position.x.toFixed(2), +t.position.z.toFixed(2), t.userData.trashKind]),
    cust: customerSnap(),
    coop: coopSnap(),
    mess: messSnap(),
    hold: Object.fromEntries(Object.values(G.players).map(p => [p.id, p.holding])),
  };
}
let lastIntro = null, lastEvent;
export function applySnap(ss) {
  Object.assign(G, ss.econ);
  if (lastDay !== G.day) { lastDay = G.day; refreshTags(); }
  if (lastIntro !== G.intro || lastEvent !== G.shopEvent) { lastIntro = G.intro; lastEvent = G.shopEvent; applyIntroWorld(); setRain(G.shopEvent === 'rain' && G.phase !== 'evening'); }
  if (ss.mess) mirrorMess(ss.mess);
  updateDecor();
  const sids = new Set(ss.shelves.map(s => s.sid));
  for (const s of [...G.shelves]) if (!sids.has(s.userData.sid)) removeShelf(s);
  for (const d of ss.shelves) {
    let s = shelfBySid(d.sid);
    if (!s) s = makeShelf(d.type, d.x, d.z, d.r, d.sid);
    else if (G.carry !== s && (s.position.x !== d.x || s.position.z !== d.z || s.userData.r !== d.r)) placeShelf(s, d.x, d.z, d.r);
    d.slots.forEach((it, i) => {
      const sl = s.userData.slots[i], cur = sl.item;
      if ((cur?.uid || null) !== (it?.uid || null) || (cur && it && cur.price !== it.price)) setSlotItem(sl, it);
    });
  }
  G.phys.mirror(ss.floor);
  const tids = new Set(ss.trash.map(t => t[0]));
  for (const t of [...G.trash]) if (!tids.has(t.userData.tid)) removeTrash(t);
  for (const [tid, x, z, kind] of ss.trash) if (!G.trash.some(t => t.userData.tid === tid)) spawnTrash(x, z, kind, tid);
  mirrorCustomers(ss.cust);
  mirrorCoop(ss.coop);
  for (const [pid, h] of Object.entries(ss.hold)) if (G.players[pid]) G.players[pid].holding = h;
  updateWorld(); updateBin(); updateSign(); updateCoop();
}
on('ss', m => { if (isGuest() && G.world === 'shop') applySnap(m.ss); });
on('start', m => { applySnap(m.ss); G.onCoopStart?.(); });

// ---------- player positions ----------
on('p', (m, from) => {
  const p = ensurePlayer(from, G.players[from]?.name);
  const { t, from: _f, to: _t, holding: _h, ...rest } = m;
  Object.assign(p, rest);
  void t; void _f; void _t; void _h;
});

// ---------- events relayed to everybody ----------
on('say', m => UI.toast(m.text));
on('alert', m => { UI.toast(m.text, 'alert'); sfx.alert(); });
on('bonk', () => { sfx.squeak(); G.onBonk?.(); });
on('chat', m => chatLine(m.name, m.text));
on('summary', m => G.onSummary?.(m.s));
on('xstart', m => G.startExpedition?.(m.params));
on('sleep', () => G.onSleep?.());
on('win', () => G.win?.());
on('approve?', m => approvePrompt(m.req));
on('approved', m => approveClose(m.rid));
NET.toast = UI.toast;
NET.approvePrompt = req => approvePrompt(req);
NET.approveClose = rid => approveClose(rid);
NET.newShelf = (pid, sid) => { if (pid === G.me) G.startCarry?.(sid); else send(pid, { t: 'newShelf', sid }); };
on('newShelf', m => setTimeout(() => G.startCarry?.(m.sid), 400));

// ---------- approvals (Y / N) ----------
let approving = null;
function approvePrompt(req) {
  if (req.pid === G.me) { UI.toast(`Asked your team to approve: ${req.name} (${UI.money(req.cost)})`); return; }
  approving = req;
  const el = UI.$('approve');
  el.innerHTML = `<b>${req.who}</b> wants to buy <b>${req.name}</b> for <b>${UI.money(req.cost)}</b><br>${UI.kbd('Y')} Approve · ${UI.kbd('N')} Deny`;
  el.classList.remove('hidden');
  sfx.bell();
}
function approveClose(rid) { if (!approving || approving.rid === rid) { approving = null; UI.$('approve').classList.add('hidden'); } }
export function approveKey(yes) {
  if (!approving) return false;
  act('approve', approving.rid, yes);
  approveClose(approving.rid);
  return true;
}

// ---------- text chat ----------
export function chatLine(name, text) {
  const el = document.createElement('div');
  el.innerHTML = `<b>${name}:</b> `;
  el.append(document.createTextNode(text));
  UI.$('chat-log').append(el);
  while (UI.$('chat-log').children.length > 8) UI.$('chat-log').firstChild.remove();
  setTimeout(() => el.classList.add('old'), 9000);
}
// Other modules post to the chat with this (send = also to the team).
G.chatLine = (name, text, send) => { chatLine(name, text); if (send) broadcast({ t: 'chat', name, text }); };
export function openChat(relock) {
  const inp = UI.$('chat-in');
  inp.classList.remove('hidden'); inp.value = '';
  G.chatting = true;
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => inp.focus(), 0);
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = inp.value.trim().slice(0, 140);
      if (text) { chatLine(S.name, text); broadcast({ t: 'chat', name: S.name, text }); }
    }
    if (e.key === 'Enter' || e.key === 'Escape') { inp.classList.add('hidden'); inp.blur(); G.chatting = false; relock(); }
  };
}

// ---------- avatars ----------
function avatarFor(p) {
  let a = avatars.get(p.id);
  if (a) return a;
  const mesh = makePerson({ seed: [...p.id + p.name].reduce((s, c) => s * 31 + c.charCodeAt(0) | 0, 7), player: COLORS[+p.id.slice(1)] });
  const tag = nameTag(p.name);
  mesh.add(tag);
  mesh.traverse(o => o.userData.avatar = p.id);
  a = { mesh, tag, name: p.name, t: 0, held: null, heldId: null, spot: null, scene: null };
  avatars.set(p.id, a);
  return a;
}
function dropAvatar(pid) { const a = avatars.get(pid); if (a) { a.scene?.remove(a.mesh); avatars.delete(pid); } }
export const avatarMeshes = () => [...avatars.values()].map(a => a.mesh);

export function updateAvatars(dt, scene) {
  const myWorld = G.world;
  for (const p of Object.values(G.players)) {
    if (p.id === G.me) continue;
    const a = avatarFor(p);
    if (a.name !== p.name) { a.mesh.remove(a.tag); a.tag = nameTag(p.name); a.mesh.add(a.tag); a.name = p.name; }
    if (a.scene !== scene) { a.scene?.remove(a.mesh); scene.add(a.mesh); a.scene = scene; a.mesh.position.set(p.x, 0, p.z); }
    const vis = p.world === myWorld && !(p.hidden !== false && p.hidden != null) && !p.cab;
    a.mesh.visible = vis;
    if (!vis) continue;
    const m = a.mesh, k = Math.min(1, dt * 12);
    const dx = p.x - m.position.x, dz = p.z - m.position.z, moving = Math.hypot(dx, dz) > 0.02;
    m.position.x += dx * k; m.position.z += dz * k;
    m.rotation.y = p.ry || 0;
    m.rotation.x = p.down ? -Math.PI / 2 : 0;
    m.position.y = p.down ? 0.25 : 0;
    a.t += moving ? dt * (p.run ? 11 : 7) : 0;
    animatePerson(m, a.t, moving && !p.down, p.run ? 1.3 : 1);
    if (p.crouch && !p.down) m.userData.body.position.y = -0.45;
    const hid = p.holding?.kind === 'item' ? p.holding.inst.id : p.holding ? 'trash' : null;
    if (hid !== a.heldId) {
      if (a.held) m.remove(a.held);
      a.held = null; a.heldId = hid;
      if (hid && hid !== 'trash') { a.held = makeItemMesh(itemById(hid)); a.held.position.set(0, 1.0, 0.35); m.add(a.held); }
    }
    if (a.held) poseArms(m, -1.0, -0.4);
    if (p.emote && !p.down && !moving) { a.et = (a.et || 0) + dt; animateEmote(m, p.emote, a.et); } else a.et = 0;
    a.tag.material.color.set(p.dead ? 0x888888 : p.talking || speaking(p.id) ? 0x7dff8a : p.radio ? 0x7fd0ff : 0xffffff);
    if (myWorld === 'exp') {
      if (p.light && !a.spot) { a.spot = new THREE.SpotLight(0xfff2d8, 30, 22, 0.42, 0.45, 1.2); a.spot.position.set(0.2, 1.5, 0.3); a.spot.target.position.set(0.2, 1.0, 5); m.add(a.spot, a.spot.target); }
      if (a.spot) a.spot.intensity = p.light ? 30 : 0;
    } else if (a.spot) a.spot.intensity = 0;
  }
  for (const pid of avatars.keys()) if (!G.players[pid]) dropAvatar(pid);
}

// ---------- per frame ----------
export function netTick(dt, camera) {
  if (NET.role === 'solo') return;
  const my = G.players[G.me];
  if (my && (sendT -= dt) <= 0) {
    sendT = 1 / 15;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    my.x = camera.position.x; my.y = camera.position.y; my.z = camera.position.z; my.ry = Math.atan2(dir.x, dir.z); my.world = G.world;
    broadcast({ t: 'p', x: +my.x.toFixed(2), y: +my.y.toFixed(2), z: +my.z.toFixed(2), ry: +my.ry.toFixed(2), world: my.world, hp: my.hp, down: my.down,
      dead: my.dead, bleed: +(my.bleed || 0).toFixed(1), emote: my.emote || null,
      hidden: my.hidden, run: my.run, crouch: my.crouch, light: my.light, cab: my.cab, talking: my.talking, radio: my.radio, name: S.name });
  }
  if (isHost() && G.world === 'shop' && G.mode === 'play' && (snapT -= dt) <= 0) {
    snapT = 0.15;
    broadcast({ t: 'ss', ss: shopSnap() });
  }
  if (isGuest() && G.world === 'shop') { lerpCustomers(dt); G.phys.lerpMirror(dt); }
}

export const hostCanHelp = () => Object.keys(G.players).length > 1;

// ---------- hook for the website's party lobby (Games web page/party.js + party-adapter.js) ----------
// A host can take room-code (PeerJS) players and direct-code (Tailscale) players at the same time.
const beHost = () => { ensurePlayer('p0', S.name); G.me = 'p0'; };
window.ChuckysHouse = {
  ready: () => true, // this object only exists once every game module has loaded
  setName(n) { S.name = String(n || 'Player').slice(0, 16); saveSettings(); const p = G.players[G.me]; if (p) p.name = S.name; },
  hasSave: () => G.hasSave,
  inGame: () => G.mode === 'play',
  players: () => Object.keys(G.players).length,
  isGuest: () => isGuest(),
  async hostRoom() { if (!NET.code) { await hostPeerJS(); beHost(); } return NET.code; },
  startGame() { UI.closePanel(false); G.hostStartGame(); },
  newGame() { G.newGameReload(); },
  async joinRoom(code) { await joinPeerJS(code); },
  async makeInvite() { const code = await directHostCode(); beHost(); return code; },
  async acceptReply(reply) { await directHostAccept(reply); },
  answerInvite: code => directJoin(code),
};
