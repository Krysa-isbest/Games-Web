// Prism Plunderers: start-up. Wires the foundation together and opens the main menu.
import { VERSION, BUILD } from './core/config.js';
import { bus } from './core/events.js';
import { S, P, Stores, Stash, Credits } from './core/save.js';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { Scenes } from './core/scenes.js';
import { Sound, uiSfx } from './core/sound.js';
import { $ } from './core/util.js';
import { UI } from './ui/screens.js';
import { initControls } from './ui/keybinds.js';
import { initSavePanel } from './ui/savepanel.js';
import { Debug } from './ui/debug.js';

window.__pp = true;                                   // tells the page that the game's code loaded
$('fatal').classList.add('hidden');                   // in case a slow connection already showed the "could not start" note
function fatal(text) { const f = $('fatal'); f.textContent = text; f.classList.remove('hidden'); }

try { Engine.init($('view')); }
catch (e) {
  fatal('Prism Plunderers needs WebGL, and this browser could not start it. Try the newest Chrome, Edge or Firefox, and check that hardware acceleration is on.');
  throw e;
}
Input.init($('view'));
UI.init();
initControls();
initSavePanel();
Debug.init();

// scenes are downloaded the first time they are opened
Scenes.add('menu', () => import('./scenes/menu.js').then(m => m.default()));
Scenes.add('test', () => import('./scenes/test.js').then(m => m.default()));

$('ver').textContent = `${VERSION} · ${BUILD}`;
$('mi-test').onclick = () => Scenes.go('test');

// the player card (top right) and the clock in the status line
function renderMe() {
  $('me-name').textContent = P.name;
  $('me-av').textContent = (P.name[0] || 'P').toUpperCase();
  $('me-cr').textContent = P.credits.toLocaleString('en-US') + ' cr';
}
UI.onOpen('main', renderMe);
bus.on('save:reset', renderMe);
renderMe();
const clock = () => {
  const d = new Date();
  $('st-clock').textContent = `3000-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
clock(); setInterval(clock, 10000);

// the splash: one click starts the sound and opens the menu
$('splash').addEventListener('click', () => {
  $('splash').classList.add('out');
  uiSfx.ok();
  setTimeout(() => $('splash').remove(), 900);
}, { once: true });

// sound starts with the first click or key press (browser rule), then hover and click blips on every button
const wake = () => Sound.init();
addEventListener('pointerdown', wake, true);
addEventListener('keydown', wake, true);
let lastHover = null;
document.addEventListener('pointerover', e => {
  const b = e.target.closest?.('button:not(:disabled)');
  if (b && b !== lastHover) uiSfx.hover();
  lastHover = b;
});
document.addEventListener('click', e => { if (e.target.closest?.('.mi, .btn')) uiSfx.click(); });

bus.on('save:error', () => UI.toast('Could not save: the browser storage is full or blocked.', 'bad'));
bus.on('scene:error', () => UI.toast('That could not be loaded. Check your internet connection and try again.', 'bad'));
bus.on('gfx:lost', () => UI.toast('The graphics card reset. Restoring...', 'bad'));

Loop.start({
  fixed: (dt, tick) => Scenes.fixed(dt, tick),
  afterStep: () => Input.endTick(),
  frame: (dt, alpha) => { Scenes.frame(dt, alpha); Debug.frame(); },
});
Scenes.go('menu');

// handy in the browser console while developing: PP.S, PP.P, PP.Stash.add('scrap', 5) ...
window.PP = { S, P, Stores, Stash, Credits, Engine, Input, Loop, Scenes, Sound, UI, bus };
