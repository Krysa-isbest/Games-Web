// Settings: General, Graphics, Audio & voice, Controls (hold / toggle, every key rebindable incl. mouse buttons),
// Network (your own PeerJS server for Tailscale). Everything saves as you change it.
import { S, DEFAULTS, PRESETS, saveSettings, esc } from './state.js';
import { ACTIONS, BINDS, setBind, resetBinds, keyName, clashes } from './keys.js';
import { testServer } from './net.js';
import { ui } from './audio.js';

const $ = id => document.getElementById(id);
let tab = 'general', listening = null, H = null, micStream = null, micCtx = null, micRaf = 0, shown = null;
export function initSettings(h) { H = h; }

const TABS = [
  ['general', 'General', 'View, mouse, interface', '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 3h-2.1a6.9 6.9 0 00-1-2.4l1.5-1.5-1.4-1.4-1.5 1.5a6.9 6.9 0 00-2.4-1V4h-2v2.1a6.9 6.9 0 00-2.4 1L8.1 5.6 6.7 7l1.5 1.5a6.9 6.9 0 00-1 2.4H5v2h2.1c.2.9.5 1.7 1 2.4l-1.5 1.5 1.4 1.4 1.5-1.5c.7.5 1.5.8 2.4 1V20h2v-2.1c.9-.2 1.7-.5 2.4-1l1.5 1.5 1.4-1.4-1.5-1.5c.5-.7.8-1.5 1-2.4h2.1z"/>'],
  ['graphics', 'Graphics', 'Quality and performance', '<path d="M3 5h18v12H3zM8 21h8M12 17v4"/>'],
  ['audio', 'Audio & voice', 'Volume, music, microphone', '<path d="M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8M18.5 5.5a8.5 8.5 0 010 13"/>'],
  ['controls', 'Controls', 'Keys, mouse, hold or toggle', '<path d="M3 7h18v10H3zM7 11h1M10 11h1M13 11h1M16 11h1M8 14h8"/>'],
  ['network', 'Network', 'PeerJS and Tailscale', '<path d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'],
];
const PCT = v => Math.round(v * 100) + '%';
const FMT = { fov: v => v + '°', sens: v => (+v).toFixed(2), scale: PCT, vol: PCT, menuMusic: PCT, music: PCT, sfx: PCT, wind: PCT, ui: PCT, micVol: PCT, voiceVol: PCT };
const GFX = ['scale', 'shadows', 'snow', 'fog', 'view', 'aa', 'bloom', 'grain'];

const row = (label, hint, ctl) => `<div class="srow"><div class="sl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="sc">${ctl}</div></div>`;
const slider = (label, k, min, max, step, hint = '') => row(label, hint, `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"><output data-o="${k}">${(FMT[k] || (v => v))(S[k])}</output>`);
const toggle = (label, k, hint = '') => row(label, hint, `<button class="sw ${S[k] ? 'on' : ''}" data-t="${k}" role="switch" aria-checked="${!!S[k]}"><i></i></button>`);
const choice = (label, k, opts, hint = '') => row(label, hint, `<div class="seg" data-c="${k}">${opts.map(([v, n]) => `<button data-v="${v}" class="${String(S[k]) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`);
const head = t => `<h4 class="sh">${t}</h4>`;

function general() {
  return head('View') + slider('Field of view', 'fov', 60, 110, 1, 'How wide you see. Wider shows more, but things look smaller.') +
    toggle('Head bob', 'headBob', 'The camera sways as you walk.') +
    head('Mouse') + slider('Mouse sensitivity', 'sens', 0.1, 3, 0.05) + toggle('Invert mouse Y', 'invertY') +
    head('Interface') + toggle('Hints', 'hints', 'Short tips the first time you meet something new.') + toggle('Subtitles', 'subtitles', 'For radio messages and survivors\' notes read aloud.') +
    choice('Temperature', 'temp', [['c', '°C'], ['f', '°F']]) + toggle('FPS counter', 'fps');
}
function graphics() {
  return choice('Quality preset', 'preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']], 'Pick one, then fine-tune below. You can see every change behind this window.') +
    head('Advanced') +
    slider('Render scale', 'scale', 0.5, 1, 0.05, 'Below 100 % is blurrier but much faster.') +
    choice('Shadows', 'shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']]) +
    choice('Snowfall', 'snow', [['low', 'Light'], ['medium', 'Medium'], ['high', 'Heavy'], ['ultra', 'Blizzard']], 'How many snowflakes are drawn.') +
    choice('Fog', 'fog', [['low', 'Thin'], ['medium', 'Normal'], ['high', 'Thick']]) +
    choice('View distance', 'view', [['near', 'Near'], ['mid', 'Medium'], ['far', 'Far']]) +
    toggle('Bloom', 'bloom', 'Glow around fire, lamps and the aurora.') +
    toggle('Film grain', 'grain') +
    toggle('Frost on the screen', 'frost', 'Ice creeps over the edges when the wind picks up.') +
    toggle('Anti-aliasing', 'aa', 'Smooth edges. Needs a reload of the page.');
}
function audio() {
  return head('Volume') + slider('Master volume', 'vol', 0, 1, 0.01) + slider('Main menu music', 'menuMusic', 0, 1, 0.01, 'The menu song, or the cold drone when there is no song.') +
    slider('In-game music', 'music', 0, 1, 0.01) + slider('Effects', 'sfx', 0, 1, 0.01) + slider('Wind & weather', 'wind', 0, 1, 0.01) + slider('Menu clicks', 'ui', 0, 1, 0.01) +
    head('Voice chat') + toggle('Voice chat', 'voice', 'Talk to your crew. Voices carry further in calm weather and drown in a blizzard.') +
    choice('Microphone mode', 'voiceMode', [['ptt', `Push to talk (${keyName(BINDS.ptt)})`], ['open', 'Open mic']]) +
    row('Microphone', '', '<select id="mic-sel"><option value="">Default</option></select>') +
    slider('Microphone volume', 'micVol', 0, 2, 0.05) + slider('Voices of others', 'voiceVol', 0, 2, 0.05) + toggle('Noise suppression', 'noise') +
    row('Mic test', 'Speak: the bar should move.', '<div class="meter"><i id="mic-meter"></i></div><button class="btn small" id="mic-test">Test</button>');
}
function controls() {
  let h = head('Movement style') +
    choice('Sprint', 'sprintMode', [['hold', 'Hold'], ['toggle', 'Toggle']], `${keyName(BINDS.sprint)}: hold it down, or tap once to start and once to stop.`) +
    choice('Crouch', 'crouchMode', [['hold', 'Hold'], ['toggle', 'Toggle']], `${keyName(BINDS.crouch)}: crouching keeps you out of the wind and makes you quieter.`) +
    choice('Walk slowly', 'walkMode', [['hold', 'Hold'], ['toggle', 'Toggle']]) +
    '<p class="snote">Click a key, then press the new key or mouse button. Esc cancels, Backspace clears it.</p>';
  const groups = {};
  for (const [a, d] of Object.entries(ACTIONS)) (groups[d.group] ||= []).push(a);
  for (const [g, list] of Object.entries(groups)) {
    h += head(g);
    for (const a of list) {
      const cl = clashes(a);
      h += row(ACTIONS[a].name, cl.length ? `<span class="warn">Also used by: ${cl.map(o => ACTIONS[o].name).join(', ')}</span>` : '', `<button class="kb ${listening === a ? 'listen' : ''} ${cl.length ? 'clash' : ''}" data-bind="${a}">${listening === a ? 'Press a key…' : esc(keyName(BINDS[a]))}</button>`);
    }
  }
  return h + row('Escape', 'Pause / back. Can\'t be changed.', '<button class="kb" disabled>Esc</button>') + '<div class="srow end"><button class="btn ghost" id="keys-reset">Reset all keys</button></div>';
}
function network() {
  return head('Default connection') +
    choice('When you host or join', 'netWay', [['peer', 'Internet room code'], ['direct', 'LAN / Tailscale invite codes']], 'You can also switch this on the Play screen.') +
    head('Your own PeerJS server (Tailscale)') +
    `<p class="snote">Room codes normally go through the free public PeerJS server. On a Tailscale network you can run your own instead:
      on one computer run <code>npx peer --port 9000</code>, turn this on everywhere and type that computer's Tailscale IP (100.x.x.x).
      Open the game over <code>http://</code> (not https) so it can reach a plain server. Invite codes need no server at all.</p>` +
    toggle('Use my own server', 'custom') +
    row('Host', 'Tailscale IP or name', `<input class="txt" data-s="sHost" value="${esc(S.sHost)}" placeholder="100.101.102.103" spellcheck="false">`) +
    row('Port', '', `<input class="txt short" data-s="sPort" value="${esc(S.sPort)}" placeholder="9000" inputmode="numeric">`) +
    row('Path', '', `<input class="txt short" data-s="sPath" value="${esc(S.sPath)}" placeholder="/">`) +
    toggle('Secure (wss / https)', 'sSecure', 'Only if your server has a certificate.') +
    row('Check it', '<span id="net-test-res"></span>', '<button class="btn small" id="net-test">Test the server</button>');
}

export function openSettings(t) { if (t) tab = t; render(); }
export function closeSettings() { stopMic(); listening = null; }

function render() {
  // every section (heading + its rows) becomes its own card
  const body = { general, graphics, audio, controls, network }[tab]().split(/(?=<h4 class="sh">)/).filter(s => s.trim()).map(s => `<section class="sgroup">${s}</section>`).join('');
  const keep = shown === tab ? $('st-body').scrollTop : 0;
  shown = tab;
  $('st-nav').innerHTML = TABS.map(([k, n, d, ico]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}"><svg viewBox="0 0 24 24">${ico}</svg><span><b>${n}</b><small>${d}</small></span></button>`).join('') +
    `<button class="reset-all" id="reset-tab">Reset this tab</button>`;
  $('st-body').innerHTML = body;
  $('st-body').scrollTop = keep;
  const root = $('s-settings');
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { closeSettings(); tab = b.dataset.tab; render(); ui.click(); });
  root.querySelectorAll('input[data-k]').forEach(el => el.oninput = () => {
    const k = el.dataset.k; S[k] = +el.value;
    root.querySelector(`[data-o="${k}"]`).textContent = (FMT[k] || (v => v))(S[k]);
    if (GFX.includes(k)) { S.preset = 'custom'; root.querySelectorAll('[data-c="preset"] button').forEach(b => b.classList.toggle('on', b.dataset.v === 'custom')); }
    changed(k, true);
  });
  root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const k = b.dataset.t; S[k] = !S[k]; b.classList.toggle('on', S[k]); b.setAttribute('aria-checked', S[k]);
    if (GFX.includes(k)) S.preset = 'custom';
    changed(k); ui.click();
    if (k === 'custom' || GFX.includes(k)) render();
  });
  root.querySelectorAll('[data-c]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = seg.dataset.c; S[k] = b.dataset.v;
    if (k === 'preset' && PRESETS[S.preset]) Object.assign(S, PRESETS[S.preset]);
    else if (GFX.includes(k)) S.preset = 'custom';
    changed(k); ui.click(); render();
  }));
  root.querySelectorAll('input[data-s]').forEach(el => el.oninput = () => { S[el.dataset.s] = el.dataset.s === 'sPort' ? (+el.value || '') : el.value; saveSettings(); H?.apply?.('net'); });
  root.querySelectorAll('[data-bind]').forEach(b => b.onclick = e => { e.stopPropagation(); listening = b.dataset.bind; render(); ui.click(); });
  $('reset-tab').onclick = () => { resetTab(); ui.back(); };
  const kr = $('keys-reset'); if (kr) kr.onclick = () => { resetBinds(); render(); H?.toast('All keys are back to their defaults.'); };
  if (tab === 'audio') setupMic();
  if (tab === 'network') $('net-test').onclick = async () => {
    const r = $('net-test-res');
    if (!S.custom) { r.textContent = 'Turn on "Use my own server" first. (The public server needs no test.)'; return; }
    r.textContent = 'Testing…'; r.className = '';
    try { await testServer(); r.textContent = 'It works! Room codes will use your server.'; r.className = 'ok'; ui.good(); } catch (e) { r.textContent = e.message; r.className = 'warn'; ui.error(); }
  };
}
const TAB_KEYS = {
  general: ['fov', 'headBob', 'sens', 'invertY', 'hints', 'subtitles', 'temp', 'fps'],
  graphics: ['preset', ...GFX, 'frost'],
  audio: ['vol', 'menuMusic', 'music', 'sfx', 'wind', 'ui', 'voice', 'voiceMode', 'micVol', 'voiceVol', 'noise'],
  controls: ['sprintMode', 'crouchMode', 'walkMode'],
  network: ['netWay', 'custom', 'sHost', 'sPort', 'sPath', 'sSecure'],
};
function resetTab() {
  for (const k of TAB_KEYS[tab]) S[k] = DEFAULTS[k];
  if (tab === 'controls') resetBinds();
  saveSettings(); H?.apply?.('all'); render();
  H?.toast(`${TABS.find(t => t[0] === tab)[1]} settings reset.`);
}
function changed(k, live) { saveSettings(); H?.apply?.(k, live); }

// ---------- rebinding: keys and mouse buttons ----------
function capture(code) {
  if (!listening) return false;
  if (code === 'Escape') { listening = null; render(); return true; }
  setBind(listening, code === 'Backspace' ? '' : code);
  const cl = clashes(listening);
  if (cl.length) H?.toast(`${keyName(code)} is also used by ${cl.map(o => ACTIONS[o].name).join(', ')}.`, 'warn');
  listening = null; ui.click(); render();
  return true;
}
addEventListener('keydown', e => { if (listening) { e.preventDefault(); e.stopImmediatePropagation(); capture(e.code); } }, true);
let swallow = false;
addEventListener('mousedown', e => { if (listening && !e.target.closest('[data-bind]')) { e.preventDefault(); e.stopImmediatePropagation(); swallow = e.button === 0; capture('Mouse' + e.button); } }, true);
addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
addEventListener('mouseup', e => { if (listening && e.target.closest('[data-bind]') && e.button !== 0) { e.preventDefault(); capture('Mouse' + e.button); } }, true);
addEventListener('contextmenu', e => { if (listening || e.target.closest('[data-bind]')) e.preventDefault(); }, true);
export const isListening = () => !!listening;

// ---------- microphone ----------
async function setupMic() {
  const sel = $('mic-sel');
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    devs.forEach((d, i) => sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.deviceId)}" ${S.mic === d.deviceId ? 'selected' : ''}>${esc(d.label || `Microphone ${i + 1}`)}</option>`));
  } catch { /* no devices */ }
  sel.onchange = () => { S.mic = sel.value; saveSettings(); if (micStream) startMic(); };
  $('mic-test').onclick = () => (micStream ? stopMic() : startMic());
}
async function startMic() {
  stopMic();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.mic ? { exact: S.mic } : undefined, noiseSuppression: S.noise, echoCancellation: true } });
    micCtx = new AudioContext();
    const an = micCtx.createAnalyser(); an.fftSize = 512;
    micCtx.createMediaStreamSource(micStream).connect(an);
    const buf = new Uint8Array(512);
    const tick = () => {
      const m = $('mic-meter'); if (!m) return stopMic();
      an.getByteTimeDomainData(buf); let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v - 128));
      m.style.width = Math.min(100, pk / 100 * S.micVol * 100) + '%';
      micRaf = requestAnimationFrame(tick);
    };
    tick();
    const b = $('mic-test'); if (b) b.textContent = 'Stop';
  } catch { H?.toast('No microphone access. Allow it in the browser to use voice chat.', 'bad'); }
}
function stopMic() {
  cancelAnimationFrame(micRaf);
  micStream?.getTracks().forEach(t => t.stop()); micCtx?.close();
  micStream = micCtx = null;
  const b = $('mic-test'); if (b) b.textContent = 'Test';
  const m = $('mic-meter'); if (m) m.style.width = '0';
}
