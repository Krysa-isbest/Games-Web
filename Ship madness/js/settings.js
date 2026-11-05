// Settings panel: General, Graphics, Audio & voice, Controls (rebindable keys).
import { S, saveSettings, PRESETS } from './state.js';
import { ACTIONS, BINDS, setBind, resetBinds, keyName } from './keys.js';
import { listMics, startMicTest, stopMicTest, micLevel } from './voice.js';
import { setVolume, sfx } from './sfx.js';

const $ = id => document.getElementById(id);
let tab = 'general', H = null, listening = null, meterRaf = 0, shownTab = null;
export function initSettings(h) { H = h; }

const slider = (label, k, min, max, step, fmt = v => v, hint = '') =>
  `<div class="set-row"><label>${label}${hint ? `<small>${hint}</small>` : ''}</label><div class="ctl"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"><output data-o="${k}">${fmt(S[k])}</output></div></div>`;
const toggle = (label, k, hint = '') =>
  `<div class="set-row"><label>${label}${hint ? `<small>${hint}</small>` : ''}</label><div class="ctl"><button class="switch ${S[k] ? 'on' : ''}" data-t="${k}"></button></div></div>`;
const choice = (label, k, opts, hint = '') =>
  `<div class="set-row"><label>${label}${hint ? `<small>${hint}</small>` : ''}</label><div class="ctl"><div class="seg" data-c="${k}">${opts.map(([v, n]) => `<button data-v="${v}" class="${String(S[k]) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div></div></div>`;
const PCT = v => Math.round(v * 100) + '%';
const FMT = { sens: v => (+v).toFixed(2), fov: v => v + '°', scale: PCT, vol: PCT, sfxVol: PCT, ambVol: PCT, micVol: PCT, voiceVol: PCT, musicVol: PCT, menuVol: PCT };
const GFX = ['scale', 'shadows', 'ocean', 'particles', 'view', 'aa'];

function general() {
  return `<div class="set-h">Mouse & view</div>` +
    slider('Mouse sensitivity', 'sens', 0.2, 3, 0.05, FMT.sens) +
    toggle('Invert mouse Y', 'invertY') +
    slider('Field of view', 'fov', 60, 100, 1, FMT.fov) +
    `<div class="set-h">Interface</div>` + toggle('Show FPS counter', 'showFps');
}
function graphics() {
  return choice('Quality preset', 'preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']], 'Pick one, then fine-tune below.') +
    `<div class="set-h">Advanced</div>` +
    slider('Render scale', 'scale', 0.5, 1, 0.05, FMT.scale, 'Lower = blurrier but much faster.') +
    choice('Shadows', 'shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']]) +
    choice('Ocean detail', 'ocean', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], 'How many points the waves are made of.') +
    choice('Particles', 'particles', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], 'Splashes, smoke, debris.') +
    choice('View distance', 'view', [['near', 'Near'], ['mid', 'Medium'], ['far', 'Far']]) +
    toggle('Anti-aliasing', 'aa', 'Smooth edges. Applies after a page reload.');
}
function audio() {
  return `<div class="set-h">Sound</div>` +
    slider('Master volume', 'vol', 0, 1, 0.01, FMT.vol) +
    slider('Effects', 'sfxVol', 0, 1, 0.01, FMT.sfxVol) +
    slider('Main menu music', 'menuVol', 0, 1, 0.01, FMT.menuVol, 'The song in the main menu, Garage and Settings.') +
    slider('In-game music', 'musicVol', 0, 1, 0.01, FMT.musicVol, 'Sailing, battle and boss music (audio folder).') +
    slider('Sea & wind', 'ambVol', 0, 1.5, 0.01, FMT.ambVol) +
    `<div class="set-h">Voice chat</div>` +
    toggle('Voice chat', 'voice', 'Talk to your crew in online games.') +
    choice('Mode', 'voiceMode', [['ptt', `Push to talk (${keyName(BINDS.ptt)})`], ['open', 'Open mic']]) +
    `<div class="set-row"><label>Microphone</label><div class="ctl"><select id="mic-sel"><option value="">Default</option></select></div></div>` +
    slider('Mic volume', 'micVol', 0, 2, 0.05, FMT.micVol) +
    slider('Voice volume (others)', 'voiceVol', 0, 2, 0.05, FMT.voiceVol) +
    toggle('Noise suppression', 'noise') +
    `<div class="set-row"><label>Mic test<small>Speak: the bar should move.</small></label><div class="ctl"><div class="meter"><i id="mic-meter"></i></div><button class="small-btn" id="mic-test">Test</button></div></div>`;
}
function controls() {
  const used = {};
  for (const [a, c] of Object.entries(BINDS)) (used[c] ||= []).push(a);
  // keys that are allowed to share (they are used in different situations)
  const pairs = [['dive', 'crane'], ['jump', 'grab'], ['reload', 'anchor'], ['reload', 'craneUp'], ['anchor', 'craneUp']];
  const okShare = new Set(pairs.flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
  const groups = {};
  for (const [a, d] of Object.entries(ACTIONS)) (groups[d.group] ||= []).push(a);
  let h = '<p class="note">Click a key, then press the new one (Esc cancels). Mouse: LMB shoot / use, RMB aim, wheel switches weapons.</p>';
  for (const [g, list] of Object.entries(groups)) {
    h += `<div class="set-h">${g}</div>`;
    for (const a of list) {
      const others = used[BINDS[a]].filter(o => o !== a && !okShare.has(a + '|' + o));
      h += `<div class="set-row"><label>${ACTIONS[a].name}${others.length ? `<small>⚠ also used by: ${others.map(o => ACTIONS[o].name).join(', ')}</small>` : ''}</label><div class="ctl"><button class="keybtn ${listening === a ? 'listen' : ''} ${others.length ? 'clash' : ''}" data-bind="${a}">${listening === a ? 'Press a key…' : keyName(BINDS[a])}</button></div></div>`;
    }
  }
  h += '<div class="row"><button id="keys-reset">Reset to defaults</button></div>';
  return h;
}

export function openSettings(t) { if (t) tab = t; render(); }
export function closeSettings() { stopMicTest(); cancelAnimationFrame(meterRaf); listening = null; }

function render() {
  const tabs = [['general', 'General', 'Mouse, view, interface'], ['graphics', 'Graphics', 'Quality and performance'], ['audio', 'Audio & voice', 'Volume, music, microphone'], ['controls', 'Controls', 'Rebind every key']];
  const scroll = shownTab === tab ? $('settings-body').querySelector('.set-body')?.scrollTop || 0 : 0;
  shownTab = tab;
  $('settings-body').innerHTML = `<div class="s2"><nav class="s2-tabs">${tabs.map(([k, n, d]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}"><b>${n}</b><small>${d}</small></button>`).join('')}</nav>
    <div class="set-body">${{ general, graphics, audio, controls }[tab]()}</div></div>`;
  $('settings-body').querySelector('.set-body').scrollTop = scroll;
  const root = $('settings-body');
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { closeSettings(); tab = b.dataset.tab; render(); sfx.click(); });
  root.querySelectorAll('input[data-k]').forEach(el => el.oninput = () => {
    const k = el.dataset.k; S[k] = +el.value;
    root.querySelector(`[data-o="${k}"]`).textContent = FMT[k] ? FMT[k](S[k]) : S[k];
    if (GFX.includes(k)) { S.preset = 'custom'; root.querySelectorAll('[data-c="preset"] button').forEach(b => b.classList.toggle('on', b.dataset.v === 'custom')); }
    changed(k);
  });
  root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const k = b.dataset.t; S[k] = !S[k]; b.classList.toggle('on', S[k]);
    if (GFX.includes(k)) S.preset = 'custom';
    changed(k); sfx.click();
  });
  root.querySelectorAll('[data-c]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = seg.dataset.c;
    S[k] = b.dataset.v;
    if (k === 'preset' && PRESETS[S.preset]) Object.assign(S, PRESETS[S.preset]);
    else if (GFX.includes(k)) S.preset = 'custom';
    changed(k); sfx.click();
    render();
  }));
  root.querySelectorAll('[data-bind]').forEach(b => b.onclick = () => { listening = b.dataset.bind; render(); });
  const reset = $('keys-reset');
  if (reset) reset.onclick = () => { resetBinds(); render(); };
  if (tab === 'audio') {
    listMics().then(list => { const sel = $('mic-sel'); if (!sel) return; for (const m of list) sel.insertAdjacentHTML('beforeend', `<option value="${m.id}" ${S.mic === m.id ? 'selected' : ''}>${m.name}</option>`); sel.onchange = () => { S.mic = sel.value; saveSettings(); }; });
    $('mic-test').onclick = async () => {
      try {
        await startMicTest();
        $('mic-test').textContent = 'Testing…';
        const tick = () => { const m = $('mic-meter'); if (!m) return; m.style.width = micLevel() * 100 + '%'; meterRaf = requestAnimationFrame(tick); };
        tick();
        listMics().then(list => { const sel = $('mic-sel'); if (sel && sel.options.length <= 1) for (const m of list) sel.insertAdjacentHTML('beforeend', `<option value="${m.id}">${m.name}</option>`); });
      } catch { $('mic-test').textContent = 'No access'; }
    };
  }
}
function changed(k) {
  saveSettings();
  if (k === 'vol') setVolume(S.vol);
  H?.applySettings?.(k);
}
// key capture for rebinding
addEventListener('keydown', e => {
  if (!listening) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.code !== 'Escape') setBind(listening, e.code);
  listening = null;
  render();
}, true);
