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
import { initMainMenu } from './ui/mainmenu.js';

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
// a broken menu part must never stop the whole game from starting
try { initMainMenu({ play: () => Scenes.go('test') }); }   // Play opens the test range until raids exist
catch (e) { console.error(e); setTimeout(() => UI.toast('Part of the menu failed to load: ' + e.message, 'bad'), 1500); }

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
document.addEventListener('click', e => { if (e.target.closest?.('.btn, .play, .dest, .bb-btn, .slot, .sq-row, .tb-me')) uiSfx.click(); });

bus.on('save:error', () => UI.toast('Could not save: the browser storage is full or blocked.', 'bad'));
bus.on('scene:error', () => UI.toast('That could not be loaded. Check your internet connection and try again.', 'bad'));
bus.on('gfx:lost', () => UI.toast('The graphics card reset. Restoring...', 'bad'));

Loop.start({
  fixed: (dt, tick) => Scenes.fixed(dt, tick),
  afterStep: () => Input.endTick(),
  frame: (dt, alpha) => { Scenes.frame(dt, alpha); Debug.frame(); },
});
Scenes.go('menu');
window.__ppStarted = true;                             // from here on, errors no longer cover the screen

// handy in the browser console while developing: PP.S, PP.P, PP.Stash.add('scrap', 5) ...
window.PP = { S, P, Stores, Stash, Credits, Engine, Input, Loop, Scenes, Sound, UI, bus };
