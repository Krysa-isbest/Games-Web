// Whiteout: the main menu. The splash, screen navigation (Esc goes back), the profile, the weather readout,
// the frost on the screen, toasts and the hooks that apply settings live.
import { G, S, VERSION, saveSettings, esc } from './state.js';
import { initScene, applyGraphics, W } from './scene.js';
import { initAudio, audioTick, ui } from './audio.js';
import { initSettings, openSettings, closeSettings, isListening } from './settings.js';
import { openHowto } from './howto.js';
import { initLobby, openPlay, playBack, profileChanged } from './lobby.js';
import { dressPanel } from './frost.js';
import { playCutscene } from './cutscene.js';
import { startGame, preloadGame, inGame, gameApply, askJoin, gameChat, backIn, rejoined } from './game.js';
import { startVoice } from './voice.js';

const $ = id => document.getElementById(id);
const SCREENS = ['main', 'play', 'howto', 'settings', 'credits'];
let current = 'splash';
const stack = [];

// ---------- toasts ----------
function toast(text, kind = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + kind; d.textContent = text;
  $('toasts').append(d);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => d.classList.add('out'), 4200);
  setTimeout(() => d.remove(), 4800);
}

// ---------- navigation ----------
function go(id, push = true) {
  if (id === current) return;
  if (current === 'settings') closeSettings();
  if (push && current !== 'splash') stack.push(current);
  for (const s of SCREENS) {
    const el = $('s-' + s);
    if (s === id) { el.classList.remove('hidden', 'leaving'); el.classList.add('entering'); setTimeout(() => el.classList.remove('entering'), 500); }
    else if (!el.classList.contains('hidden')) { el.classList.add('leaving'); setTimeout(() => { el.classList.add('hidden'); el.classList.remove('leaving'); }, 260); }
  }
  current = G.screen = id;
  document.body.dataset.screen = id;
  document.body.classList.toggle('game-settings', id === 'settings' && inGame());     // the settings, opened from the game's pause menu
  if (id === 'settings') openSettings();
  if (id === 'howto') openHowto();
  if (id === 'play') openPlay();
  if (id === 'credits') $('cr-name').textContent = 'Tomáš';
  dressCurrent();
  ui.open();
}
// frost, snow and icicles on the open panel (redrawn when its size changes)
function dressCurrent() { requestAnimationFrame(() => dressPanel($('s-' + current)?.querySelector('.panel'))); }
setInterval(() => { if (current !== 'main' && current !== 'splash') dressCurrent(); }, 700);
function back() {
  if (current === 'play' && playBack()) return;
  const prev = stack.pop() || 'main';
  go(prev, false);
  ui.back();
}

// ---------- profile ----------
const COATS = ['#b4462e', '#d18a2a', '#3f7a52', '#2f6fb3', '#6a4a9a', '#c9c2b4', '#2b2f36', '#9a2b5a'];
function renderProfile() {
  $('profile').innerHTML = `<span class="pf-av" style="--coat:${esc(S.coat)}">${esc(S.name[0]?.toUpperCase() || 'S')}</span><span class="pf-t"><small>Survivor</small><b>${esc(S.name)}</b></span>`;
  document.querySelectorAll('.me-name').forEach(e => { e.textContent = S.name; });
}
function openProfile() {
  const pop = $('profile-pop');
  pop.classList.toggle('hidden');
  if (pop.classList.contains('hidden')) return;
  $('pf-name').value = S.name;
  $('pf-coats').innerHTML = COATS.map(c => `<button class="coat ${c === S.coat ? 'on' : ''}" data-c="${c}" style="--coat:${c}" title="${c}"></button>`).join('');
  $('pf-coats').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { S.coat = b.dataset.c; saveSettings(); renderProfile(); profileChanged(); openProfile(); openProfile(); ui.click(); });
  setTimeout(() => $('pf-name').focus(), 30);
  requestAnimationFrame(() => dressPanel(pop));
}

// ---------- weather readout: it is always 03:14 somewhere ----------
let clock = 3 * 60 + 14;
function weather() {
  clock += 1 / 60;
  const t = -24 - W.gust * 9 - Math.sin(W.t * 0.05) * 2, wind = Math.round(W.wind * 3.6);
  const temp = S.temp === 'f' ? `${Math.round(t * 9 / 5 + 32)}°F` : `${Math.round(t)}°C`;
  const hh = String(Math.floor(clock / 60) % 24).padStart(2, '0'), mm = String(Math.floor(clock % 60)).padStart(2, '0');
  $('weather').innerHTML = `<span><b>${temp}</b><small>Feels ${S.temp === 'f' ? Math.round((t - wind * 0.3) * 9 / 5 + 32) + '°F' : Math.round(t - wind * 0.3) + '°C'}</small></span><span><b>${wind} km/h</b><small>${W.gust > 0.45 ? 'Gusting' : 'Wind'}</small></span><span><b>${hh}:${mm}</b><small>Night ${1}</small></span>`;
}

// ---------- frost creeping over the screen edges ----------
function drawFrost() {
  const c = $('frost'), w = c.width = Math.round(innerWidth / 2), h = c.height = Math.round(innerHeight / 2), x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  const branch = (px, py, a, len, depth) => {
    if (depth <= 0 || len < 2) return;
    const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
    x.globalAlpha = 0.12 + depth * 0.05; x.lineWidth = depth * 0.45;
    x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) { const t = 0.3 + Math.random() * 0.7; branch(px + (ex - px) * t, py + (ey - py) * t, a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6), len * 0.45, depth - 1); }
    branch(ex, ey, a + (Math.random() - 0.5) * 0.4, len * 0.7, depth - 1);
  };
  x.strokeStyle = '#eaf6ff'; x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const side = i % 4, r = Math.random();
    const [px, py, a] = side === 0 ? [r * w, 0, Math.PI / 2] : side === 1 ? [r * w, h, -Math.PI / 2] : side === 2 ? [0, r * h, 0] : [w, r * h, Math.PI];
    branch(px, py, a + (Math.random() - 0.5) * 1.2, 18 + Math.random() * 40, 4);
  }
  // a soft rime band along the edges
  const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(220,240,255,0)'); g.addColorStop(1, 'rgba(220,240,255,0.35)');
  x.globalAlpha = 1; x.fillStyle = g; x.fillRect(0, 0, w, h);
}

// ---------- starting the game: the opening cutscene, then the island ----------
function toMenu() { playBack(); stack.length = 0; go('main', false); }      // leaves the crew too, if you were in one
// how: {} = a new game (the cutscene first); { cont, save } = the host or solo continues a saved game;
// { cont, crew } = a guest follows the host into a saved game (the host sends the world)
function starting(lobby, how = {}) {
  const coop = G.net.role !== 'solo', players = lobby.players, meId = G.net.id, base = { players, meId, coop, openSettings: () => go('settings'), onQuit: toMenu };
  preloadGame();                                                             // the physics engine downloads while the cutscene plays
  if (coop) startVoice();                                                    // voice chat from the cutscene on (the host's voice goes out over the plane's radio)
  if (how.cont) { startGame(G.net.role === 'guest' ? { ...base, join: true, crew: how.crew } : { ...base, load: how.save }); return; }
  playCutscene({ players, meId, coop, onBack: () => { if (!coop) go('main'); }, onDone: () => startGame(base) });
}
// the host let you into a game that is already running: no cutscene, the host sends the world
function joining(m) {
  preloadGame(); startVoice();
  startGame({ players: m.players, meId: G.net.id, coop: true, join: true, crew: m.crew, openSettings: () => go('settings'), onQuit: toMenu });
}

// ---------- settings applied live ----------
let gfxT = 0;
function apply(k) {
  if (['preset', 'scale', 'shadows', 'snow', 'fog', 'view', 'bloom', 'grain', 'all'].includes(k)) { clearTimeout(gfxT); gfxT = setTimeout(() => { applyGraphics(); gameApply(); }, 120); }
  if (k === 'fps' || k === 'all') $('fps').classList.toggle('hidden', !S.fps);
  if (k === 'all') renderProfile();
}

// ---------- boot ----------
initScene($('bg'));
drawFrost();
initSettings({ apply, toast });
initLobby({ toast, go, starting, joining, askJoin, chat: gameChat, backIn, rejoined });
renderProfile();
$('ver').textContent = VERSION;
$('fps').classList.toggle('hidden', !S.fps);
const PC = {
  'pc-solo': '<svg viewBox="0 0 24 24"><path d="M12 11a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-7 8-7s8 3 8 7"/></svg>',
  'pc-host': '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/></svg>',
  'pc-join': '<svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 012 2v12a2 2 0 01-2 2h-5"/></svg>',
};
for (const [id, svg] of Object.entries(PC)) $(id).querySelector('.pc-ico').innerHTML = svg;

$('splash').addEventListener('click', () => {
  initAudio();
  $('splash').classList.add('out');
  setTimeout(() => $('splash').remove(), 1200);
  go('main');
});
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));
$('profile').onclick = e => { e.stopPropagation(); openProfile(); };
$('pf-done').onclick = () => { $('profile-pop').classList.add('hidden'); ui.click(); };
$('pf-name').addEventListener('input', e => { S.name = e.target.value.slice(0, 16).trim() || 'Survivor'; saveSettings(); renderProfile(); profileChanged(); });
$('pf-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('profile-pop').classList.add('hidden'); });
document.addEventListener('click', e => { if (!e.target.closest('#profile-pop, #profile')) $('profile-pop').classList.add('hidden'); });
// hover + click sounds on everything clickable
let lastHover = null;
document.addEventListener('pointerover', e => { const b = e.target.closest('button:not(:disabled), .mi'); if (b && b !== lastHover) { lastHover = b; ui.hover(); } });
document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled && !b.closest('[data-go], [data-back], .seg, .sw, [data-tab], [data-p]')) ui.click(); });
addEventListener('keydown', e => {
  if (isListening()) return;
  if (e.key === 'Escape' || e.code === 'Escape') {
    if (!$('profile-pop').classList.contains('hidden')) { $('profile-pop').classList.add('hidden'); return; }
    if (document.querySelector('.starting, .cutscene')) return;
    if (inGame() && current !== 'settings') return;                           // the game has its own Esc (the pause menu)
    if (current !== 'main' && current !== 'splash') back();
  }
});
addEventListener('resize', () => { clearTimeout(drawFrost.t); drawFrost.t = setTimeout(drawFrost, 200); });

// UI tick: audio follows the wind, the frost follows the gusts, the weather readout
let last = performance.now(), wT = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  audioTick(dt);
  $('frost').style.opacity = S.frost ? (0.25 + W.gust * 0.75) : 0;
  wT -= dt;
  if (wT <= 0) { wT = 1; weather(); if (S.fps) $('fps').textContent = `${W.fps} FPS`; }
}
requestAnimationFrame(tick);
