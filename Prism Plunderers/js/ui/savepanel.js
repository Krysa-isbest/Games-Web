// The Save data screen: what is stored, backup codes, and a reset.
import { P, Stores, Stash, Credits, persistent, exportSave, importSave } from '../core/save.js';
import { bus } from '../core/events.js';
import { uiSfx } from '../core/sound.js';
import { $, esc } from '../core/util.js';
import { UI } from './screens.js';

let armed = 0;

export function initSavePanel() {
  UI.onOpen('save', render);
  bus.on('save:reset', () => { if (UI.current === 'save') render(); });

  $('sv-test').onclick = () => { Credits.add(100); Stores.profile.save(); render(); uiSfx.ok(); };
  $('sv-copy').onclick = async () => {
    const code = exportSave();
    $('sv-code').value = code;
    try { await navigator.clipboard.writeText(code); UI.toast('Backup code copied.'); }
    catch { $('sv-code').select(); UI.toast('Select the code and copy it (Ctrl+C).'); }
  };
  $('sv-restore').onclick = () => {
    if (importSave($('sv-code').value)) { UI.toast('Backup restored.'); uiSfx.ok(); render(); }
    else UI.toast('That is not a Prism Plunderers backup code.', 'bad');
  };
  // two clicks, so progress is never wiped by accident
  $('sv-reset').onclick = () => {
    const now = performance.now();
    if (now > armed) { armed = now + 4000; $('sv-reset').textContent = 'Click again to erase your progress'; setTimeout(label, 4000); return; }
    armed = 0;
    Stores.profile.reset();
    label(); render();
    UI.toast('Progress erased. Settings and keys were kept.');
  };
}
function label() { if (performance.now() >= armed) $('sv-reset').textContent = 'Erase progress'; }

function render() {
  const cell = (k, v) => `<div class="stat"><small>${esc(k)}</small><b>${esc(v)}</b></div>`;
  $('sv-stats').innerHTML =
    cell('Scrap Credits', P.credits + ' cr') + cell('Stash items', Stash.total()) + cell('Skill points', P.skills.points) +
    cell('Raids', P.stats.raids) + cell('Extracted', P.stats.extracted) + cell('Deaths', P.stats.deaths);
  $('sv-where').textContent = persistent
    ? 'Saved in this browser, on this computer. A backup code moves it to another browser or computer.'
    : 'This browser is blocking storage, so progress is lost when the tab closes. Use a backup code to keep it.';
  $('sv-where').classList.toggle('warn', !persistent);
}
