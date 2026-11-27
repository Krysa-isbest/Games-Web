// The Squad screen (part 12): open a room or make invite codes, join, see who is in, chat, leave.
import { bus } from '../core/events.js';
import { uiSfx } from '../core/sound.js';
import { $, esc } from '../core/util.js';
import { UI } from './screens.js';
import { NET, hostRoom, joinRoom, inviteCode, finishInvite, replyCode } from '../net/net.js';
import { Squad, startHosting, chat, leave, kick } from '../net/squad.js';

const status = (t, bad = false) => { const e = $('sq-status'); e.textContent = t; e.classList.toggle('bad', bad); };
async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch (e) { status(e.message || String(e), true); uiSfx.error(); }
  finally { btn.disabled = false; }
}
const copy = text => { try { navigator.clipboard?.writeText(text); UI.toast('Copied.'); } catch { /* the field is selectable */ } };

export function initSquadUI() {
  UI.onOpen('squad', render);
  bus.on('squad', () => { render(); });
  bus.on('squad:chat', () => renderChat());
  bus.on('squad:left', why => { if (why) UI.toast(why, 'bad'); render(); });
  $('sq-host').onclick = e => busy(e.currentTarget, async () => {
    if (NET.role === 'guest') throw new Error('Leave this squad first.');
    status('Opening a room...');
    const code = NET.mode === 'peerjs' && NET.code ? NET.code : await hostRoom();
    if (!Squad.members.length) startHosting();
    $('sq-code').textContent = code;
    copy(code);
    status(`Room ${code} is open: friends join with this code.`);
  });
  $('sq-join').onclick = e => busy(e.currentTarget, async () => {
    if (Squad.on) throw new Error('Leave this squad first.');
    const code = $('sq-join-code').value.trim();
    if (code.length < 5) throw new Error('A room code has 5 letters.');
    status('Joining...');
    await joinRoom(code);
    status(`Joined room ${code.toUpperCase()}.`);
  });
  $('sq-inv').onclick = e => busy(e.currentTarget, async () => {
    if (NET.role === 'guest') throw new Error('Only the squad leader can invite.');
    status('Making an invite code...');
    const c = await inviteCode();
    if (!Squad.members.length) startHosting();
    $('sq-inv-out').value = c;
    copy(c);
    status('Invite code made (and copied). Send it, then paste the reply code you get back.');
  });
  $('sq-finish').onclick = e => busy(e.currentTarget, async () => {
    await finishInvite($('sq-reply-in').value);
    $('sq-reply-in').value = '';
    status('Connecting...');
  });
  $('sq-reply').onclick = e => busy(e.currentTarget, async () => {
    if (Squad.on) throw new Error('Leave this squad first.');
    status('Making a reply code...');
    const c = await replyCode($('sq-inv-in').value, () => status('Connected to the squad leader.'));
    $('sq-reply-out').value = c;
    copy(c);
    status('Reply code made (and copied): send it back to the squad leader.');
  });
  const say = () => { chat($('sq-say').value); $('sq-say').value = ''; };
  $('sq-send').onclick = say;
  $('sq-say').addEventListener('keydown', e => { if (e.key === 'Enter') say(); });
  $('sq-leave').onclick = () => { leave(); status('You left the squad.'); };
  $('sq-list').addEventListener('click', e => { const b = e.target.closest?.('[data-kick]'); if (b) kick(b.dataset.kick); });
}

function render() {
  const list = $('sq-list');
  if (!list) return;
  const ms = Squad.members.length ? Squad.members : [{ id: 'p0', name: 'You', ready: true, host: true, ping: 0, status: 'lobby', solo: true }];
  list.innerHTML = ms.map(m => `<li class="${m.id === NET.id ? 'me' : ''}"><b>${m.host ? '★ ' : ''}${esc(m.name)}</b>` +
    `<span>${m.solo ? 'solo' : m.host ? 'leader' : m.status === 'raid' ? 'in a raid' : m.ready ? 'ready' : 'not ready'}${m.ping ? ` · ${m.ping} ms` : ''}</span>` +
    (Squad.host && !m.host ? `<button class="btn small" data-kick="${m.id}">Remove</button>` : '') + '</li>').join('');
  $('sq-leave').disabled = !Squad.on;
  if (!Squad.on) $('sq-code').textContent = '';
  renderChat();
}
function renderChat() {
  const box = $('sq-chat');
  if (!box) return;
  box.innerHTML = Squad.lines.slice(-30).map(l => `<p>${l.from ? `<b>${esc(l.from)}</b> ` : '<i>'}${esc(l.text)}${l.from ? '' : '</i>'}</p>`).join('');
}
