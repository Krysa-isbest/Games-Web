// The main menu's moving parts: the opening splash (typed lines, then the sprayed title), the paper ID tag,
// the field radio ticker and arrow-key navigation of the menu.
import { P } from '../core/save.js';
import { bus } from '../core/events.js';
import { Sound, uiSfx } from '../core/sound.js';
import { $ } from '../core/util.js';
import { UI } from './screens.js';

// intercepted radio chatter. Later parts can add lines about what the player actually did.
const CHATTER = [
  'fink spotted over the old metro entrance, keep your heads down',
  'swatter patrol moving north along the highway, two flies with it',
  'do NOT engage the roach without a full team',
  'red zone loot confirmed near the collapsed tower',
  'scatters nesting in the parking garage on 9th, stay out of the dark',
  'anyone got a spare shield cell, mine is cooked',
  'drop pod beam lit up again over the east side',
  'if you hear the scan hum, break line of sight, do not wait for it',
];
const LINES = ['2999. They landed. We shot first.', '3000. They came back. All of them.'];

export function initMainMenu() {
  UI.onOpen('main', renderTag);
  bus.on('save:reset', renderTag);
  renderTag();
  radio();
  splash();
  arrows();
}

// ---------- the paper ID tag ----------
function renderTag() {
  const s = P.stats;
  $('tg-name').textContent = P.name;
  $('tg-cr').textContent = P.credits.toLocaleString('en-US');
  $('tg-raids').textContent = s.raids;
  $('tg-out').textContent = s.extracted;
  $('tg-stamp').textContent = s.extracted >= 10 ? 'VETERAN' : s.raids ? 'SCAVENGER' : 'ROOKIE';
}

// ---------- field radio ----------
function radio() {
  const t = CHATTER.join('   ///   ') + '   ///   ';
  const el = $('rd-text');
  el.textContent = t + t;                                   // two copies, so the loop has no seam
  el.style.animationDuration = Math.round(t.length * 0.22) + 's';
}

// ---------- splash: two typed lines, then the title is sprayed on ----------
function splash() {
  const sp = $('splash'), out = $('sp-type');
  let done = false, timer = 0, line = null;
  const later = (fn, ms) => { timer = setTimeout(fn, ms); };
  function type(li = 0, ci = 0) {
    if (done) return;
    if (li >= LINES.length) { sp.classList.add('show'); later(() => sp.classList.add('ready'), 1300); return; }
    if (ci === 0) { line = document.createElement('span'); out.append(line); }
    line.textContent += LINES[li][ci];
    if (ci + 1 < LINES[li].length) later(() => type(li, ci + 1), LINES[li][ci] === '.' ? 260 : 38);
    else later(() => type(li + 1, 0), 650);
  }
  later(() => type(), 500);
  // any click or key goes to the menu
  const go = () => {
    if (done) return;
    done = true; clearTimeout(timer);
    removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true);
    sp.classList.add('show', 'out');
    Sound.init();                         // this click is the first one: start the sound here, before the hiss
    uiSfx.spray();
    setTimeout(() => sp.remove(), 1000);
  };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}

// ---------- up / down arrows move between the menu entries ----------
function arrows() {
  addEventListener('keydown', e => {
    if (UI.current !== 'main' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = [...document.querySelectorAll('#s-main .m-item')];
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items[n].focus();
    e.preventDefault();
  });
}
