import { G, level, me } from './state.js';
import { itemById } from './data.js';
import { dueRemaining, weekEnd, dayName, isAuctionDay } from './economy.js';
import { PRESETS } from './settings.js';
import { ACTIONS as KEY_ACTIONS, K, kb, keyName, conflicts, setKey, resetKeys, listenForKey } from './keys.js';
import { resetTips } from './tips.js';
import { sfx } from './sfx.js';

export const $ = id => document.getElementById(id);
export const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const kbd = k => `<kbd>${k}</kbd>`;
export const skulls = v => {
  let s = '';
  for (let i = 1; i <= 5; i++) s += v >= i ? '💀' : v >= i - 0.5 ? '<span class="half-skull">💀</span>' : '';
  return `<span class="skulls" title="${v} skulls">${s}</span> <small class="dim">${v}</small>`;
};
const panel = $('panel');
let escClose = null;

export function clock() {
  if (G.phase === 'prep') return '8:00 AM';
  if (G.phase === 'evening') return '7:00 PM';
  const m = 9 * 60 + Math.floor(G.time), h = Math.floor(m / 60);
  return `${(h + 11) % 12 + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function objective() {
  const h = me()?.holding;
  if (G.tutText) return G.tutText;
  const E = keyName('interact');
  if (h?.kind === 'tool') return h.tool === 'sign' ? `Wet floor sign: ${keyName('grab')} to put it down next to a wet floor.`
    : `${h.tool === 'mop' ? 'Mop' : 'Broom'}: hold ${keyName('attack')} on a ${h.tool === 'mop' ? 'spill' : 'pile of broken glass'}. ${E} at the cleaning corner to put it back.${h.tool === 'mop' && h.dirt ? ` (dirty ${h.dirt}, rinse at the sink)` : ''}`;
  if (h?.kind === 'bag') return 'Take the trash bag to the dumpster out back.';
  if (h?.kind === 'item') return `Holding ${itemById(h.inst.id).name}: ${E} on an empty shelf slot or the stock crates, ${keyName('grab')} / ${keyName('attack')} to throw.`;
  if (G.binCount >= G.up.binCap) return 'The trash bin is full: take out the bag.';
  if (G.phase === 'evening') return `Evening: buy gear on the computer, then press ${keyName('open')} (or the open sign) to head out.`;
  if (G.phase === 'prep' && !G.shelves.some(s => s.userData.slots.some(x => x.item))) return `Your shelves are empty! Buy stock on the computer (Supplier), then ${E} on the stock crates.`;
  if (G.phase === 'prep') return `Set your prices, open the door, then open the store (${keyName('open')}).`;
  if (!G.doorOpen && G.phase === 'open') return 'The front door is CLOSED: no customers can come in.';
  if (G.customers.some(c => c.state === 'queue')) return 'A customer is waiting at the register!';
  if (G.standWaiting) return 'Someone is waiting at the egg stand window!';
  if (G.customers.some(c => c.state === 'flee')) return `SHOPLIFTER! Catch them before the door (${E})!`;
  if (G.clean < 60) return 'The shop is dirty: customers pay less. Trash in the bin, mop the spills!';
  if (G.trash.length >= 3) return 'Customers hate trash: clean it up!';
  if (G.phase === 'closing') return 'Closing time: finish serving customers.';
  return 'Store is open until 6:00 PM.';
}

export function hud() {
  $('money').textContent = money(G.money);
  const [label, cls] = { prep: ['CLOSED', 'closed'], open: ['OPEN', 'open'], closing: ['CLOSING', 'closing'], evening: ['EVENING', 'closing'] }[G.phase];
  const d = G.phase === 'evening' ? G.day - 1 : G.day;
  $('clock').innerHTML = `${dayName(d)} · Day ${d} · ${clock()} <span class="chip ${cls}">${label}</span> <span class="chip lv">Lv ${level()}</span>`;
  const cl = Math.round(G.clean);
  const rush = G.phase === 'open' && ((G.time >= 180 && G.time < 240) || (G.time >= 420 && G.time < 480));
  $('subline').innerHTML = `<span title="Trust: customers pay up to this much more">🤝 Trust +${Math.round(G.trust * 100)}%</span>`
    + ` · <span title="Cleanliness: a clean shop sells for more" class="${cl < 40 ? 'down' : cl >= 80 ? 'up' : ''}">🧽 ${cl}%</span>`
    + (G.up.stand ? ` · 🥚 ${G.eggs}` : '') + ` · 🚪 ${G.doorOpen ? 'open' : '<span class="down">closed</span>'}`
    + (rush ? ' · <span class="warn-soft">⏰ RUSH HOUR</span>' : '')
    + (G.shopEvent && G.phase !== 'evening' ? ` · <span class="warn-soft">${{ heatwave: '🥵 Heat wave', festival: '🎪 Festival', powercut: '🔌 Power cut', rain: '🌧️ Rain' }[G.shopEvent] || ''}</span>` : '')
    + (isAuctionDay() && G.auction && G.phase !== 'evening' ? ' · <span class="warn-soft">🔨 Auction today!</span>' : '');
  $('objective').textContent = objective();
  $('loan').textContent = `Loan ${money(G.debt)}`;
  const due = dueRemaining(), today = G.day === weekEnd();
  $('due').innerHTML = due > 0
    ? `<span class="${today ? 'warn' : ''}">Pay ${money(due)} ${today ? 'TODAY!' : `by Day ${weekEnd()}`}</span>`
    : '<span class="ok">Weekly payment done ✓</span>';
  $('strikes').innerHTML = 'IRS strikes ' + [0, 1, 2].map(i => `<span class="strike ${i < G.strikes ? 'on' : ''}">⚠</span>`).join('');
  const h = me()?.holding;
  $('holding').innerHTML = !h ? '' : h.kind === 'bag' ? '🗑️ Carrying: trash bag' : h.kind === 'trash' ? `🗑️ Carrying: trash ×${h.n}`
    : h.kind === 'tool' ? ({ mop: '🧽 Mop', broom: '🧹 Broom', sign: '⚠️ Wet floor sign' }[h.tool] + (h.dirt ? ` <span class="dim">(dirty ×${h.dirt})</span>` : ''))
    : `${itemById(h.inst.id).icon} Holding: ${itemById(h.inst.id).name}`;
}

export function hint(html) { $('hint').innerHTML = html || ''; }

export function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  $('toasts').prepend(el);
  while ($('toasts').children.length > 5) $('toasts').lastChild.remove();
  setTimeout(() => el.classList.add('out'), 3000);
  setTimeout(() => el.remove(), 3600);
  if (kind === 'bad') sfx.bad();
}

// esc: true = Esc closes and relocks, function = custom Esc handler, false = Esc disabled.
export function openPanel(html, { cls = '', esc = true } = {}) {
  G.uiOpen = true;
  escClose = esc;
  if (document.pointerLockElement) document.exitPointerLock();
  panel.className = 'panel ' + cls;
  panel.innerHTML = html;
  panel.querySelectorAll('button').forEach(b => b.addEventListener('click', sfx.click));
  const inp = panel.querySelector('input[autofocus]');
  if (inp) { inp.focus(); inp.select(); }
}

export function closePanel(relock = true) {
  panel.className = 'panel hidden';
  G.uiOpen = false;
  if (relock) G.relock();
}
export const panelOpen = () => !panel.classList.contains('hidden');

addEventListener('keydown', e => {
  if (e.code !== 'Escape' || !G.uiOpen || !escClose) return;
  if (escClose === true) closePanel(); else escClose();
});

export const meter = (f, cls = '') => `<div class="meter ${cls}"><div style="width:${Math.max(0, Math.min(1, f)) * 100}%"></div></div>`;

// Small modal on top of whatever is open (used for "are you sure?").
export function confirmBox(html, yes = 'Yes', no = 'Cancel') {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-box">${html}<div class="row"><button class="m-yes">${yes}</button><button class="ghost m-no">${no}</button></div></div>`;
    document.body.append(el);
    const done = v => { el.remove(); res(v); };
    el.querySelector('.m-yes').onclick = () => { sfx.click(); done(true); };
    el.querySelector('.m-no').onclick = () => { sfx.click(); done(false); };
  });
}

// What the magnifier says about an item instance (null = not inspected yet).
export function estText(inst) {
  if (!inst.est) return '<span class="dim">Condition unknown. Inspect it with a magnifier 🔍</span>';
  const e = inst.est;
  return `🔍 Estimated worth: <b>${money(e.lo)} – ${money(e.hi)}</b>${e.fake ? ' · <span class="down">looks FAKE</span>' : e.real ? ' · <span class="up">looks genuine</span>' : ''}${inst.broken ? ' · <span class="down">broken</span>' : ''}${e.stolen ? ' · <span class="down">🚔 probably stolen</span>' : ''}`;
}

export function pricePanel(def, item, mkt, cb, inspect) {
  openPanel(`<h2>${def.icon} ${def.name}</h2>
    <p>Today's market price: <b>${money(mkt)}</b> <span class="dim">(for an item in average condition)</span></p>
    <p id="est-line">${estText(item)}</p>
    <label class="field">Your price <span>$</span><input id="pin" type="number" min="1" value="${item.price}" autofocus></label>
    <div class="quick">${[1, 1.2, 1.5, 2].map(m => `<button class="ghost" data-m="${m}">${m === 1 ? 'Market' : '+' + Math.round((m - 1) * 100) + '%'}</button>`).join('')}
    ${G.tools.magnifier ? '<button id="pinsp" class="ghost">🔍 Inspect</button>' : ''}</div>
    <div class="row"><button id="pok">Set price</button><button id="pno" class="ghost">Cancel</button></div>`);
  const inp = $('pin');
  const base = () => item.est ? (item.est.lo + item.est.hi) / 2 : mkt;
  panel.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { inp.value = Math.round(base() * b.dataset.m); });
  const ok = () => { closePanel(); cb(Math.max(1, Math.round(+inp.value || item.price))); };
  $('pok').onclick = ok;
  inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
  $('pno').onclick = () => closePanel();
  if ($('pinsp')) $('pinsp').onclick = async () => { await inspect(); $('est-line').innerHTML = estText(item); };
}

// Pick an item from the stock crates.
export function stockPanel(title, cb, filter = () => true) {
  const groups = {};
  G.backstock.forEach((it, i) => { if (filter(it)) (groups[it.id] ??= []).push(i); });
  const ids = Object.keys(groups);
  openPanel(`<h2>${title}</h2>
    ${ids.length ? `<div class="grid">${ids.map(id => {
      const d = itemById(id);
      return `<button class="tile" data-id="${id}"><span class="big">${d.icon}</span>${d.name}<small>×${groups[id].length}${groups[id].some(i => G.backstock[i].broken) ? ' · 🔧' : ''}</small></button>`;
    }).join('')}</div>` : '<p class="dim">Nothing here. Buy items from the Supplier on the computer, from customers, at the auction, or bring loot home at night.</p>'}
    <div class="row"><button id="pno" class="ghost">Close</button></div>`, { cls: 'wide' });
  panel.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { closePanel(); cb(G.backstock[groups[b.dataset.id][0]]); });
  $('pno').onclick = () => closePanel();
}

export function bargainPanel(d, cb) {
  openPanel(`<div class="bargain-head"><span class="huge">${d.icon}</span><div><h2>${d.title}</h2><div class="dim">${d.who}</div></div></div>
    ${d.lines.map(l => `<p>${l}</p>`).join('')}
    <p class="say">“${d.say}”</p>
    <div class="label">Patience</div>${meter(d.patience / d.maxPatience)}
    <div class="offer">${d.offerLabel}: <b>${money(d.offer)}</b></div>
    <label class="field">${d.counterLabel} <span>$</span><input id="bin" type="number" min="1" value="${d.counterDefault}" autofocus></label>
    <div class="row">
      <button id="bacc" ${d.canAccept === false ? 'disabled' : ''}>${d.acceptLabel}</button>
      <button id="bcnt" ${d.canAccept === false ? 'disabled' : ''}>Counter</button>
      ${d.inspect ? '<button id="binsp" class="ghost">🔍 Inspect</button>' : ''}
      <button id="bwait" class="ghost">Wait a sec</button>
      <button id="bref" class="danger">${d.refuseLabel}</button></div>`,
  { esc: false });
  const inp = $('bin');
  $('bacc').onclick = () => cb('accept');
  $('bcnt').onclick = () => cb('counter', Math.max(1, Math.round(+inp.value || d.counterDefault)));
  inp.onkeydown = e => { if (e.key === 'Enter') $('bcnt').click(); };
  if ($('binsp')) $('binsp').onclick = () => cb('inspect');
  $('bwait').onclick = () => cb('wait');
  $('bref').onclick = () => cb('refuse');
}

export function summaryPanel(s, cb) {
  const r = (a, b, cls = '') => `<div class="sum-row ${cls}"><span>${a}</span><b>${b}</b></div>`;
  let week = '';
  if (s.weekCheck) {
    week = !s.missed ? '<div class="okbox">✓ Weekly payment made. The bank is happy.</div>'
      : `<div class="alert"><b>⚠ Missed weekly payment: IRS strike ${s.strike}/3</b>
         ${s.irs ? `<p>The IRS seized ${s.irs.names.length} item(s)${s.irs.names.length ? ': ' + s.irs.names.join(', ') : ''} and ${money(s.irs.cash)} in cash.</p>` : ''}
         <p>${s.strike === 2 ? 'One more miss and you go to prison.' : 'Pay on time next week!'}</p></div>`;
  }
  openPanel(`<h2>🌙 Day ${s.day} complete</h2>
    ${r('Sales', `${money(s.sales)} (${s.sold} items)`)}
    ${s.eggs ? r('Egg stand', money(s.eggs)) : ''}
    ${r('Spent', money(s.spent))}
    ${r('Profit', money(s.sales + (s.eggs || 0) - s.spent), s.sales + (s.eggs || 0) >= s.spent ? 'up' : 'down')}
    ${r('Loan interest', '+' + money(s.interest), 'down')}
    ${r('Loan balance', money(G.debt))}
    ${r('Trust', '+' + Math.round(s.trust * 100) + '%')}
    ${r('Cleanliness at closing', Math.round(s.clean ?? 100) + '%', (s.clean ?? 100) >= 80 ? 'up' : (s.clean ?? 100) < 40 ? 'down' : '')}
    ${r('Cash', money(G.money))}
    ${week}
    ${s.extraHTML || ''}
    <p class="dim">Prices changed overnight. Next payment: ${money(dueRemaining())} by the end of Day ${weekEnd()}.</p>
    <div class="row"><button id="sum-ok">Continue to the evening 🌙</button></div>`, { esc: false });
  $('sum-ok').onclick = cb;
}

// ---------- settings ----------
let setTab = 'graphics', listening = null;
export function settingsPanel(S, apply, onClose, mics = [], tab) {
  if (tab) setTab = tab;
  const range = (id, label, min, max, step, v, fmt = x => x) => `<div class="set"><span>${label}</span><span class="rng"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output id="${id}-o">${fmt(v)}</output></span></div>`;
  const seg = (key, label, opts) => `<div class="set"><span>${label}</span><div class="seg">${opts.map(([v, t]) => `<button class="${S[key] == v ? 'on' : ''}" data-k="${key}" data-v="${v}">${t}</button>`).join('')}</div></div>`;
  const check = (id, label, v) => `<div class="set"><span>${label}</span><input type="checkbox" id="${id}" ${v ? 'checked' : ''}></div>`;
  const tabs = { graphics: '🖥 Graphics', audio: '🔊 Audio & voice', keys: '⌨️ Controls', game: '🎮 Game' };
  const body = {
    graphics: () => `
      <div class="set"><span><b>Preset</b></span><div class="seg">${Object.keys(PRESETS).map(p => `<button class="${S.preset === p ? 'on' : ''}" data-preset="${p}">${p}</button>`).join('')}<button class="${S.preset === 'custom' ? 'on' : ''}" disabled>custom</button></div></div>
      ${range('s-res', 'Resolution scale', 0.5, 2, 0.05, S.res, v => Math.round(v * 100) + '%')}
      ${range('s-view', 'View distance', 20, 150, 5, S.viewDist, v => v + ' m')}
      ${seg('shadows', 'Shadows', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      ${range('s-sdist', 'Shadow distance', 6, 40, 1, S.shadowDist, v => v + ' m')}
      ${range('s-lights', 'Dynamic lights (expeditions)', 2, 32, 1, S.lights)}
      ${seg('city', 'City detail (cars, people)', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      ${seg('people', 'Enemy & NPC detail', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      ${seg('fogQ', 'Fog quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      ${seg('aniso', 'Texture filtering', [[1, 'Off'], [4, '4×'], [8, '8×'], [16, '16×']])}
      ${check('s-aa', 'Anti-aliasing <small class="dim">(after restart)</small>', S.aa)}
      ${check('s-ps1', 'Retro pixel filter', S.ps1)}
      ${range('s-bri', 'Brightness', 0.8, 1.25, 0.05, S.brightness)}
      ${range('s-fov', 'Field of view', 60, 100, 1, S.fov, v => v + '°')}
      ${seg('fpsCap', 'FPS limit', [[0, 'None'], [30, '30'], [60, '60'], [120, '120']])}
      ${check('s-fps', 'Show FPS', S.showFps)}
      <p class="dim small">City detail, shadows on lamps and dynamic lights apply to newly built scenes (next expedition / restart).</p>`,
    audio: () => `
      ${range('s-vol', 'Game volume', 0, 1, 0.05, S.volume, v => Math.round(v * 100) + '%')}
      ${range('s-mvol', 'Music volume', 0, 1, 0.05, S.music, v => Math.round(v * 100) + '%')}
      ${range('s-vvol', 'Voice chat volume', 0, 2, 0.05, S.voiceVol, v => Math.round(v * 100) + '%')}
      ${range('s-rvol', 'Walkie-talkie volume', 0, 2, 0.05, S.radioVol, v => Math.round(v * 100) + '%')}
      ${check('s-echo', 'Voice echo (rooms, alleys, hiding spots)', S.echo)}
      ${seg('micMode', 'Microphone', [['open', 'Open mic'], ['ptt', 'Push to talk (V)']])}
      <div class="set"><span>Mic device <small class="dim">(after restart)</small></span><select id="s-mic"><option value="">Default</option>${mics.map(m => `<option value="${m.deviceId}" ${S.micDevice === m.deviceId ? 'selected' : ''}>${m.label || 'Microphone'}</option>`).join('')}</select></div>
      ${check('s-ptttog', 'Push to talk: press once to toggle (instead of holding)', S.pttToggle)}
      ${check('s-vnoise', 'Enemies can hear my voice at night <small class="dim">(turn off if your mic picks up a noisy room)</small>', S.voiceNoise)}
      <p class="dim small">Hold ${kb('radio')} to talk over the walkie-talkie (if your team owns one): everyone with a radio hears you, anywhere.</p>`,
    keys: () => {
      const groups = {};
      for (const [id, a] of Object.entries(KEY_ACTIONS)) (groups[a.group] ??= []).push(id);
      return `<p class="dim small">Click a key, then press the new key or mouse button (Esc cancels). If another action already uses it, they swap.</p>
        ${Object.entries(groups).map(([g, ids]) => `<h3>${g}</h3>${ids.map(id => `<div class="set"><span>${KEY_ACTIONS[id].name}</span><button class="bind-btn ${listening === id ? 'listening' : ''}" data-bind="${id}">${listening === id ? 'press a key…' : keyName(id)}</button></div>`).join('')}`).join('')}
        <h3>Options</h3>
        ${check('s-crouch', 'Hold to crouch (instead of toggle)', S.crouchHold)}
        <div class="row"><button id="k-reset" class="ghost">Reset all keys to default</button></div>
        <p class="dim small">The hotbar (1–9) and the emote numbers (1–4) stay on the number keys.</p>`;
    },
    game: () => `
      <div class="set"><span>Your name (co-op)</span><input id="s-name" class="text" maxlength="16" value="${S.name}"></div>
      ${range('s-sens', 'Mouse sensitivity', 0.2, 2.5, 0.05, S.sens)}
      ${check('s-bob', 'Head bob', S.bob)}
      ${check('s-tips', 'Show tips for new things', S.tips)}
      <div class="row"><button id="s-tipreset" class="ghost">Show all tips again</button></div>`,
  };
  const render = () => {
    openPanel(`<h2>⚙ Settings</h2><div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button class="tab ${k === setTab ? 'on' : ''}" data-st="${k}">${v}</button>`).join('')}</div>
      <div class="set-body">${body[setTab]()}</div><div class="row"><button id="s-done">Done</button></div>`, { cls: 'wide', esc: onClose });
    panel.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { setTab = b.dataset.st; render(); });
    panel.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { S.preset = b.dataset.preset; Object.assign(S, PRESETS[S.preset]); apply(); render(); });
    panel.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const v = b.dataset.v; S[b.dataset.k] = isNaN(+v) ? v : +v;
      if (setTab === 'graphics') S.preset = 'custom';
      apply(); render();
    });
    const rng = { 's-res': 'res', 's-view': 'viewDist', 's-sdist': 'shadowDist', 's-lights': 'lights', 's-bri': 'brightness', 's-fov': 'fov', 's-vol': 'volume', 's-mvol': 'music', 's-vvol': 'voiceVol', 's-rvol': 'radioVol', 's-sens': 'sens' };
    const pct = v => Math.round(v * 100) + '%';
    for (const [id, key] of Object.entries(rng)) if ($(id)) $(id).oninput = e => {
      S[key] = +e.target.value;
      if (['res', 'viewDist', 'shadowDist', 'lights'].includes(key)) S.preset = 'custom';
      $(id + '-o').textContent = { res: pct, viewDist: v => v + ' m', shadowDist: v => v + ' m', fov: v => v + '°', volume: pct, music: pct, voiceVol: pct, radioVol: pct }[key]?.(S[key]) ?? S[key];
      apply();
    };
    const chk = { 's-aa': 'aa', 's-ps1': 'ps1', 's-fps': 'showFps', 's-bob': 'bob', 's-echo': 'echo', 's-ptttog': 'pttToggle', 's-crouch': 'crouchHold', 's-tips': 'tips', 's-vnoise': 'voiceNoise' };
    for (const [id, key] of Object.entries(chk)) if ($(id)) $(id).onchange = e => { S[key] = e.target.checked; apply(); };
    panel.querySelectorAll('[data-bind]').forEach(b => b.onclick = () => {
      listening = b.dataset.bind; render();
      listenForKey(code => {
        const id = listening; listening = null;
        if (code) {
          const clash = conflicts(id, code);
          setKey(id, code);
          if (clash.length) toast(`Swapped: ${clash.map(c => KEY_ACTIONS[c].name).join(', ')} → ${keyName(clash[0])}`);
        }
        render();
      });
    });
    if ($('k-reset')) $('k-reset').onclick = () => { resetKeys(); toast('All keys are back to default.'); render(); };
    if ($('s-tipreset')) $('s-tipreset').onclick = () => { resetTips(); toast('Tips will show again.'); };
    if ($('s-mic')) $('s-mic').onchange = e => { S.micDevice = e.target.value; apply(); };
    if ($('s-name')) $('s-name').oninput = e => { S.name = e.target.value.trim().slice(0, 16) || 'Player'; apply(); };
    $('s-done').onclick = onClose;
  };
  render();
}

export function controlsPanel(onClose) {
  // built from YOUR key binds (Settings → Controls changes them)
  const k = (keys, what) => `<div class="sum-row"><span>${keys}</span><span>${what}</span></div>`;
  const groups = {};
  for (const [id, a] of Object.entries(KEY_ACTIONS)) (groups[a.group] ??= []).push(k(kb(id), a.name));
  openPanel(`<h2>🎮 Controls</h2>
    ${Object.entries(groups).map(([g, rows]) => `<h3>${g}</h3>${rows.join('')}`).join('')}
    <h3>Fixed</h3>
    ${k('Mouse', 'Look')}${k(kbd('1') + '–' + kbd('9') + ' / wheel', 'Hotbar at night')}${k(kbd('Esc'), 'Pause')}
    ${k(kb('interact') + ' on 🙋 / ❗', 'Help a customer / catch a shoplifter')}
    <div class="row"><button id="c-keys">⌨️ Change keys</button><button id="c-done" class="ghost">Back</button></div>`, { esc: onClose, cls: 'wide' });
  $('c-done').onclick = onClose;
  $('c-keys').onclick = () => G.openKeySettings?.();
}

export function cutscene(cards, done) {
  const el = $('cutscene'), txt = $('cut-text');
  el.classList.remove('hidden');
  let i = -1, typing = null;
  const next = () => {
    if (typing) { clearInterval(typing); typing = null; txt.textContent = cards[i]; return; }
    if (++i >= cards.length) return end();
    let n = 0;
    txt.textContent = '';
    txt.classList.remove('fade'); void txt.offsetWidth; txt.classList.add('fade');
    typing = setInterval(() => {
      txt.textContent = cards[i].slice(0, ++n);
      if (n % 3 === 0) sfx.click();
      if (n >= cards[i].length) { clearInterval(typing); typing = null; }
    }, 35);
  };
  const key = e => { if (e.code === 'Escape') end(); else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); next(); } };
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(typing);
    removeEventListener('keydown', key);
    el.removeEventListener('click', next);
    el.classList.add('hidden');
    done();
  };
  addEventListener('keydown', key);
  el.addEventListener('click', next);
  next();
}

export function endScreen(kind, html, cb) {
  const el = $('end');
  el.className = 'screen end ' + kind;
  el.innerHTML = `<div class="end-box">${html}<button id="end-btn">Back to menu</button></div>`;
  $('end-btn').onclick = cb;
}
