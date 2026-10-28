// Boot: loading screen, main menu, dialogs, and wiring UI buttons to the game.
import { Game } from './game.js';
import { BASE } from './assets.js';
import { VERSION, CHANGELOG, CREDITS } from './data.js';
import { listSaves, lastSlot, loadSettings, saveSettings, getPref, setPref, deleteSave } from './save.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const game = new Game($('game'), settings);
window.game = game; // handy for debugging from the console

// ------------------------------------------------------------------ menu chrome
$('version').textContent = VERSION;
$('clList').innerHTML = CHANGELOG.map((t) => `<li><span class="ic">🐒</span><span>${t}</span></li>`).join('');
const setChangelog = (show) => {
  $('changelog').classList.toggle('hidden', !show);
  $('clShow').classList.toggle('hidden', show);
  setPref('changelog', show ? '1' : '0');
};
setChangelog(getPref('changelog', '1') === '1');
$('clToggle').onclick = () => { setChangelog(false); game.audio.ui('click'); };
$('clShow').onclick = () => { setChangelog(true); game.audio.ui('click'); };

// optional painted background: drop an image at assets/ui/menu_bg.jpg and it replaces the live scene
const bg = new Image();
bg.onload = () => { $('menuBg').style.backgroundImage = `url("${bg.src}")`; };
bg.src = BASE + 'assets/ui/menu_bg.jpg';

function refreshMenu() {
  $('menuButtons').querySelector('[data-act=continue]').disabled = lastSlot() === null;
  $('menuButtons').querySelector('[data-act=load]').disabled = !listSaves().some((s) => !s.empty);
}

// ------------------------------------------------------------------ modal helper
function modal(title, html, onReady) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.remove('hidden');
  onReady && onReady($('modalBody'));
}
const closeModal = () => $('modal').classList.add('hidden');
$('modalClose').onclick = () => { closeModal(); game.audio.ui('click'); };

const fmtDate = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function slotPicker(mode) {
  const saves = listSaves();
  const html = saves.map((s) => `<div class="slot" data-slot="${s.slot}">
      <div><b>Slot ${s.slot + 1}</b><br><small>${s.empty ? 'Empty' : `Day ${s.day} · $${Math.floor(s.money || 0)} · ${s.monkeys || 0} caged · ${fmtDate(s.savedAt)}`}</small></div>
      <small>${mode === 'new' ? (s.empty ? 'Start here' : 'Overwrite') : (s.empty ? '' : 'Load')}</small></div>`).join('');
  modal(mode === 'new' ? 'NEW GAME' : 'LOAD GAME', html, (body) => {
    body.querySelectorAll('.slot').forEach((el) => el.onclick = async () => {
      const slot = Number(el.dataset.slot);
      const s = saves[slot];
      if (mode === 'load' && s.empty) return;
      if (mode === 'new' && !s.empty && !confirm(`Overwrite slot ${slot + 1}?`)) return;
      game.audio.ui('click');
      closeModal();
      if (mode === 'new') { deleteSave(slot); await game.startNew(slot); } else await game.startLoad(slot);
    });
  });
}

function settingsDialog() {
  const s = settings;
  modal('SETTINGS', `
    <div class="row">Mouse sensitivity <input type="range" id="setSens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"></div>
    <div class="row">Invert mouse Y <input type="checkbox" id="setInv" ${s.invertY ? 'checked' : ''}></div>
    <div class="row">Field of view <input type="range" id="setFov" min="60" max="100" step="1" value="${s.fov}"></div>
    <div class="row">Volume <input type="range" id="setVol" min="0" max="1" step="0.01" value="${s.volume}"></div>
    <div class="row">Graphics quality <select id="setQ"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
    <div class="row">Show FPS <input type="checkbox" id="setFps" ${s.showFps ? 'checked' : ''}></div>`, (b) => {
    b.querySelector('#setQ').value = s.quality;
    const upd = () => {
      s.sensitivity = +b.querySelector('#setSens').value; s.invertY = b.querySelector('#setInv').checked;
      s.fov = +b.querySelector('#setFov').value; s.volume = +b.querySelector('#setVol').value;
      s.quality = b.querySelector('#setQ').value; s.showFps = b.querySelector('#setFps').checked;
      saveSettings(s); game.applySettings();
    };
    b.querySelectorAll('input,select').forEach((i) => i.oninput = upd);
  });
}

function creditsDialog() {
  const models = CREDITS.models.map(([t, a, uid, note]) => `<li>"${t}" by <b>${a}</b>, <a href="https://sketchfab.com/3d-models/${uid}" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0${note ? ` (${note})` : ''}</li>`).join('');
  modal('CREDITS', `<div class="credits">
    <h3>Game</h3><ul><li>Contain the Miller</li></ul>
    <h3>3D models (CC BY 4.0)</h3><ul>${models}</ul>
    <h3>Public domain (CC0)</h3><ul>${CREDITS.cc0.map((c) => `<li>${c}</li>`).join('')}</ul>
    <h3>Engine</h3><ul><li>${CREDITS.engine}</li></ul></div>`);
}

function controlsDialog() {
  const keys = [['W A S D', 'Move'], ['Shift', 'Sprint'], ['Ctrl / C', 'Crouch (sneak up on monkeys)'], ['Space', 'Jump / swim up'],
    ['Left click', 'Use tool (chop) / tie rope'], ['Right click / F', 'Eat or drink the selected item'], ['E', 'Interact: pick up, gather, feed, drink, put a monkey in a cage'],
    ['1 – 0 / wheel', 'Select hotbar slot'], ['B', 'Build menu'], ['R / wheel', 'Rotate while placing'], ['Esc', 'Pause']];
  modal('CONTROLS', `<table class="keys">${keys.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`);
}

// Exit Game: left for the site owner to wire up (e.g. back to the games hub)
function exitGame() {
  if (history.length > 1) history.back();
  else location.href = '../';
}

// ------------------------------------------------------------------ menu buttons
$('menuButtons').querySelectorAll('button').forEach((b) => {
  b.onmouseenter = () => game.audio.ui('hover');
  b.onclick = async () => {
    game.audio.ui('click');
    await game.audio.init(game.camera);
    const act = b.dataset.act;
    if (act === 'continue') { const s = lastSlot(); if (s !== null) await game.startLoad(s); }
    if (act === 'new') slotPicker('new');
    if (act === 'load') slotPicker('load');
    if (act === 'settings') settingsDialog();
    if (act === 'credits') creditsDialog();
    if (act === 'exit') exitGame();
  };
});

$('pause').querySelectorAll('button').forEach((b) => b.onclick = () => {
  game.audio.ui('click');
  const act = b.dataset.act;
  if (act === 'resume') game.resume();
  if (act === 'save') game.save();
  if (act === 'settings') settingsDialog();
  if (act === 'controls') controlsDialog();
  if (act === 'menu') game.toMenu();
});
$('death').querySelectorAll('button').forEach((b) => b.onclick = () => {
  game.audio.ui('click');
  if (b.dataset.act === 'respawn') game.respawn();
  if (b.dataset.act === 'menu') game.toMenu();
});

game.onStateChange = (s) => {
  $('menu').classList.toggle('hidden', s !== 'menu');
  $('pause').classList.toggle('hidden', s !== 'paused');
  $('death').classList.toggle('hidden', s !== 'dead');
  if (s === 'menu') refreshMenu();
  if (s !== 'menu' && s !== 'paused') closeModal();
};

// ------------------------------------------------------------------ boot
(async () => {
  try {
    await game.load((p) => {
      $('loadFill').style.width = `${Math.round(p * 100)}%`;
      $('loadText').textContent = p < 1 ? `Loading the island… ${Math.round(p * 100)}%` : 'Growing the jungle…';
    });
  } catch (e) {
    console.error(e);
    $('loadText').textContent = 'Something went wrong while loading. Check your connection and reload.';
    return;
  }
  $('loading').classList.add('hidden');
  game.setState('menu');

  // dev shortcut for automated screenshots: ?autostart starts a fresh game without the menu
  if (new URLSearchParams(location.search).has('autostart')) await game.startNew(2);
})();
