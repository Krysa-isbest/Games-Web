// Menu screens: every <section class="screen" id="s-NAME"> in index.html is one screen. One is open at a time,
// Esc goes back. UI.home is the screen at the bottom of the stack: 'main' in the menu, null inside a game
// (going back from the last screen then closes the menus and returns to the game).
import { bus } from '../core/events.js';
import { capturing } from '../core/input.js';
import { uiSfx } from '../core/sound.js';
import { $ } from '../core/util.js';

const stack = [];
const openers = {};

export const UI = {
  current: null,
  home: 'main',

  init() {
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => UI.go(b.dataset.go)));
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => UI.back()));
    bus.on('input:escape', () => { if (!capturing() && UI.current && UI.current !== UI.home) UI.back(); });
  },
  // runs fn every time the screen opens (to fill it with fresh values)
  onOpen(id, fn) { openers[id] = fn; },

  go(id, push = true) {
    if (id === UI.current) return;
    if (push && UI.current) stack.push(UI.current);
    show(id);
  },
  back() {
    const prev = stack.pop() ?? UI.home;
    if (prev) show(prev); else UI.hide();
    uiSfx.back();
  },
  // closes every screen (entering a game)
  hide() { stack.length = 0; show(null); },
  // back to the bottom of the stack
  reset(home = UI.home) { UI.home = home; stack.length = 0; show(home); },

  toast(text, kind = '') {
    const box = $('toasts'), d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.append(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 3800);
    setTimeout(() => d.remove(), 4300);
    if (kind === 'bad') uiSfx.error();
  },
};

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== 's-' + id);
  UI.current = id;
  document.body.dataset.ui = id || '';
  if (id) openers[id]?.();
  bus.emit('ui', id || '');
}
