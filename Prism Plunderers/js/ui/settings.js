// The settings menu (part 10, DESIGN 14): four pages, Game, Controls, Graphics and Sound, with one tab strip on top
// of each (Q / E switch pages). This module draws the Game and Sound pages; Controls is ui/keybinds.js, Graphics is
// ui/graphics.js. The gear button in the lobby and "Settings" in the pause menu open the page you had open last.
import { S, Stores, saveSettings } from '../core/save.js';
import { Sound, uiSfx } from '../core/sound.js';
import { Engine } from '../core/engine.js';
import { bus } from '../core/events.js';
import { capturing } from '../core/input.js';
import { $, esc } from '../core/util.js';
import { UI } from './screens.js';
import { seg, toggle, slider, row, heading, el } from './widgets.js';

export const PAGES = [['game', 'Game'], ['controls', 'Controls'], ['graphics', 'Graphics'], ['sound', 'Sound']];
const IDS = PAGES.map(p => p[0]);
export const XCOLORS = { white: '#ffffff', green: '#5dff8a', yellow: '#ffe14d', cyan: '#4de8ff', magenta: '#ff5df2' };
const pct = v => Math.round(v * 100) + '%';

export function openSettings(id = S.setTab) { UI.go(IDS.includes(id) ? id : 'game'); }

export function initSettings() {
  UI.onOpen('game', renderGame);
  UI.onOpen('sound', renderSound);
  // the tab strips: switching pages replaces the page, so Back still returns to where you came from
  for (const nav of document.querySelectorAll('.set-tabs')) {
    nav.innerHTML = PAGES.map(([id, name]) => `<button type="button" data-page="${id}">${esc(name)}</button>`).join('');
    nav.addEventListener('click', e => { const b = e.target.closest?.('[data-page]'); if (b) page(b.dataset.page); });
  }
  bus.on('ui', id => {
    if (!IDS.includes(id)) return;
    if (S.setTab !== id) { S.setTab = id; saveSettings(); }
    for (const b of document.querySelectorAll('.set-tabs [data-page]')) b.classList.toggle('on', b.dataset.page === id);
  });
  addEventListener('keydown', e => {
    if (!IDS.includes(UI.current) || e.repeat || capturing()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const i = IDS.indexOf(UI.current);
    if (e.code === 'KeyQ') page(IDS[(i + IDS.length - 1) % IDS.length]);
    else if (e.code === 'KeyE') page(IDS[(i + 1) % IDS.length]);
  });
  $('gm-reset').onclick = () => {
    const tab = S.setTab;
    Stores.settings.reset();
    S.setTab = tab; saveSettings();
    Engine.applyGraphics?.(); Sound.apply(); applyGame();
    renderGame();
    UI.toast('Every setting is back to its default. Your keys stay as they are (Controls, Reset keys).');
    uiSfx.ok();
  };
  // the game goes quiet in the background (another tab, the window minimised)
  addEventListener('visibilitychange', () => Sound.apply());
  bus.on('save:reset', applyGame);
  applyGame();
}

function page(id) { if (id !== UI.current) { UI.go(id, false); uiSfx.click(); } }

// what the Game page changes on the HUD
export function applyGame() {
  const hud = $('hud'), x = $('xhair');
  if (hud) hud.style.setProperty('--hud', String(S.hud));
  if (x) x.style.setProperty('--xc', XCOLORS[S.xc] || XCOLORS.white);
  document.body?.classList?.toggle('no-hitmarks', !S.hitMarks);
}

function renderGame() {
  const body = $('gm-body');
  body.innerHTML = '';
  const sw = Object.entries(XCOLORS).map(([k, c]) => [k, k[0].toUpperCase() + k.slice(1)]);
  const colors = seg('xc', sw, applyGame);
  for (const [i, b] of [...(colors.children || [])].entries()) b.style?.setProperty('--sw', XCOLORS[sw[i][0]]);
  colors.classList.add('swatches');
  body.append(
    heading('Camera'),
    row('Camera shake', slider('shake', { min: 0, max: 1, step: 0.05, fmt: pct }), 'Explosions, landings and heavy hits. 0 % turns it off.'),
    heading('HUD'),
    row('HUD size', slider('hud', { min: 0.8, max: 1.25, step: 0.05, fmt: pct }, applyGame), 'The bars, the weapon panel, the compass and the prompts.'),
    row('Crosshair colour', colors),
    row('Hit markers', toggle('hitMarks', applyGame), 'The little cross that flashes on the crosshair when a shot lands.'),
    heading('Language'),
    row('Language', el('span', 'val', 'English'), 'More languages may come later.'),
  );
}

// a short sound on the channel you are setting (at most every 0.12 s)
let lastTest = 0;
function test(key) {
  Sound.apply();
  const now = performance.now();
  if (now - lastTest < 120) return;
  lastTest = now;
  const channel = key === 'vol' ? 'ui' : key;
  Sound.tone(key === 'music' ? 330 : key === 'ambient' ? 160 : 520, 0.12, { type: 'triangle', vol: 0.12, channel });
}
function renderSound() {
  const body = $('sd-body');
  body.innerHTML = '';
  const vol = (key, label, hint) => row(label, slider(key, { min: 0, max: 1, step: 0.05, fmt: pct }, test), hint);
  body.append(
    heading('Volume'),
    vol('vol', 'Master', 'Everything at once.'),
    vol('sfx', 'Effects', 'Guns, footsteps, the Prism, explosions.'),
    vol('ambient', 'Ambience', 'Wind, fires and the city.'),
    vol('ui', 'Interface', 'Menu clicks and notices.'),
    vol('music', 'Music', 'There is no music yet.'),
    heading('Window'),
    row('Mute in the background', toggle('bgMute', () => Sound.apply()), 'Silent while you are in another tab or the window is minimised.'),
  );
}
