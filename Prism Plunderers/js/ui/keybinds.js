// The Controls screen: mouse settings, hold / toggle modes and the list of rebindable keys.
import { ACTIONS, GROUPS, BINDS, keyName, capture, resetBinds, clashes } from '../core/input.js';
import { bus } from '../core/events.js';
import { uiSfx } from '../core/sound.js';
import { $, esc } from '../core/util.js';
import { UI } from './screens.js';
import { seg, toggle, slider, row, heading, el } from './widgets.js';

const MODES = [['hold', 'Hold'], ['toggle', 'Toggle']];
let keysBox = null;

export function initControls() {
  UI.onOpen('controls', render);
  bus.on('input:binds', () => { if (UI.current === 'controls') renderKeys(); });
  $('ct-reset').onclick = () => { resetBinds(); UI.toast('Keys are back to the defaults.'); uiSfx.ok(); };
}

function render() {
  const body = $('ct-body');
  body.innerHTML = '';
  body.append(
    heading('Mouse'),
    row('Sensitivity', slider('sens', { min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) })),
    row('Aim sensitivity', slider('aimSens', { min: 0.2, max: 1.5, step: 0.05, fmt: v => Math.round(v * 100) + '%' }), 'How fast the camera turns while aiming'),
    row('Invert vertical look', toggle('invertY')),
    row('Raw mouse input', toggle('rawMouse'), 'Ignores the Windows pointer acceleration'),
    heading('Hold or toggle'),
    row('Sprint', seg('sprintMode', MODES)),
    row('Crouch', seg('crouchMode', MODES)),
    row('Aim', seg('aimMode', MODES)),
    heading('Browser'),
    row('Fullscreen when playing', toggle('fullscreenPlay'), 'Recommended. In a normal browser window Ctrl+W closes the tab, and crouch is on Ctrl. Fullscreen stops that.'),
  );
  keysBox = el('div', 'keys');
  body.append(keysBox);
  renderKeys();
}

function renderKeys() {
  if (!keysBox) return;
  keysBox.innerHTML = '';
  for (const g of GROUPS) {
    keysBox.append(heading(g));
    const grid = el('div', 'key-grid');
    for (const [a, d] of Object.entries(ACTIONS)) {
      if (d.group !== g) continue;
      const clash = clashes(a);
      const r = el('div', 'key-row' + (clash.length ? ' clash' : ''), `<span>${esc(d.name)}</span>`);
      const b = el('button', 'key', esc(keyName(BINDS[a])));
      b.type = 'button';
      if (clash.length) b.title = 'Also used by: ' + clash.map(c => ACTIONS[c].name).join(', ');
      b.onclick = () => listen(a, b);
      r.append(b);
      grid.append(r);
    }
    keysBox.append(grid);
  }
}

async function listen(action, btn) {
  btn.classList.add('listening');
  btn.textContent = 'press a key';
  uiSfx.click();
  const r = await capture(action);
  if (!r) { renderKeys(); return; }                        // cancelled (a changed binding redraws by itself)
  uiSfx.ok();
  if (r.swapped) UI.toast(`${ACTIONS[r.swapped].name} moved to ${keyName(BINDS[r.swapped])}.`);
}
