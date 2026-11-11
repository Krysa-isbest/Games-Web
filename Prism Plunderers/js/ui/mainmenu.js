// The lobby (main menu): the splash, the tab bar, the top bar values, the progress card, the squad slots and
// the keyboard shortcuts (Q / E switch tabs, Tab opens Raider, Esc goes back to Play).
import { P, Stash } from '../core/save.js';
import { bus } from '../core/events.js';
import { Sound, uiSfx } from '../core/sound.js';
import { $, esc } from '../core/util.js';
import { UI } from './screens.js';

const TABS = ['play', 'workshop', 'raider', 'skills', 'trader'];
// the build order (NEXT-CHAT.md). DONE = how many parts are finished.
const PARTS = ['Foundation', 'Multiplayer', 'Player', 'Prism enemies', 'The Ruins', 'Performance', 'Weapons and items', 'Raid rules', 'Lobby and workshop', 'Menus and settings', 'Skill tree', 'Difficulty'];
const DONE = 1;
const LINES = ['2999. They landed. We shot first.', '3000. They came back. All of them.'];
const SOON = 'Co-op comes with the multiplayer update.';

let tab = 'play', onPlay = () => {};

export function initMainMenu({ play }) {
  onPlay = play;
  UI.onOpen('main', () => { renderTop(); setTab(tab, true); });
  bus.on('save:reset', renderTop);
  renderTop();
  renderSteps();
  renderSlots();

  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('btn-play').onclick = () => onPlay();
  $('bb-settings').onclick = () => UI.go('controls');
  $('tb-me').onclick = () => UI.go('save');
  $('dest').onclick = () => UI.toast('The Ruins opens when raids are built. Until then, Play takes you to the test range.');
  $('sq-invite').onclick = () => UI.toast(SOON);
  $('bb-chat').onclick = () => UI.toast('Chat comes with the multiplayer update.');
  $('bb-friends').onclick = () => UI.toast(SOON);

  addEventListener('keydown', onKey);
  bus.on('input:escape', () => { if (UI.current === 'main' && tab !== 'play') setTab('play'); });
  splash();
}

// ---------- top bar and nameplate ----------
function renderTop() {
  $('tb-cr').textContent = P.credits.toLocaleString('en-US');
  $('tb-sp').textContent = P.skills.points;
  $('tb-init').textContent = (P.name[0] || 'P').toUpperCase();
  $('np-name').textContent = P.name;
  $('slots').querySelector('.me span').textContent = (P.name[0] || 'P').toUpperCase();
}

// ---------- the "road to the first raid" card ----------
function renderSteps() {
  $('ev-steps').innerHTML = PARTS.map((p, i) => `<i class="${i < DONE ? 'done' : i === DONE ? 'now' : ''}" title="${esc(p)}">${i + 1}</i>`).join('');
  $('ev-steps').style.setProperty('--done', `calc((100% - 44px) * ${DONE / (PARTS.length - 1)})`);
  $('ev-note').innerHTML = `${DONE} of ${PARTS.length} done. Next up: <b>${esc(PARTS[DONE] || 'the first raid')}</b>`;
}

// ---------- squad: you plus three free slots ----------
function renderSlots() {
  const box = $('slots');
  box.innerHTML = '<div class="slot me" title="You, the squad leader"><svg><use href="#i-crown"/></svg><span></span></div>' +
    '<button class="slot add" title="Invite a friend"><svg><use href="#i-plus"/></svg></button>'.repeat(3);
  box.querySelectorAll('.add').forEach(b => { b.onclick = () => UI.toast(SOON); });
}

// ---------- tabs ----------
function setTab(id, quiet = false) {
  if (!TABS.includes(id)) return;
  const changed = id !== tab;
  tab = id;
  $('s-main').dataset.tab = id;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
  if (id !== 'play') $('tabpage').innerHTML = page(id);
  if (changed && !quiet) uiSfx.click();
}
const cell = (k, v, empty = false) => `<div><small>${esc(k)}</small><b class="${empty ? 'empty' : ''}">${esc(v)}</b></div>`;
function page(id) {
  const lo = P.loadout;
  const slot = (k, v) => cell(k, v || 'Empty', !v);
  const P_ = {
    workshop: ['Workshop', 'Craft guns, heals, shield cells and repair kits from the scrap you bring back. Upgrade the benches to unlock better recipes.',
      cell('Bench level', P.workshop.level) + cell('Recipes known', P.workshop.known.length) + cell('Items in stash', Stash.total())],
    raider: ['Raider', 'Your loadout for the next raid. Weapons, shields and the backpack come with the weapons update.',
      slot('Weapon 1', lo.weapon1) + slot('Weapon 2', lo.weapon2) + slot('Melee', lo.melee) + slot('Shield', lo.shield) + slot('Backpack', lo.bag.length ? lo.bag.length + ' items' : '')],
    skills: ['Skills', 'Three paths: Mobility, Conditioning and Survival. You earn points by surviving and getting out, not only by fighting.',
      cell('Skill points', P.skills.points) + cell('Mobility', 'Locked', true) + cell('Conditioning', 'Locked', true) + cell('Survival', 'Locked', true)],
    trader: ['Trader', 'Sell the valuables you bring back for Scrap Credits, and buy materials and gear.',
      cell('Scrap Credits', P.credits.toLocaleString('en-US') + ' cr') + cell('Earned in total', P.stats.earned.toLocaleString('en-US') + ' cr')],
  }[id];
  return `<span class="chip">Coming soon</span><h2>${P_[0]}</h2><p>${P_[1]}</p><div class="tp-grid">${P_[2]}</div>`;
}

// ---------- keyboard ----------
function onKey(e) {
  if (UI.current !== 'main' || document.getElementById('splash') || e.repeat) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const i = TABS.indexOf(tab);
  if (e.code === 'KeyQ') setTab(TABS[(i + TABS.length - 1) % TABS.length]);
  else if (e.code === 'KeyE') setTab(TABS[(i + 1) % TABS.length]);
  else if (e.code === 'Tab') { e.preventDefault(); setTab(tab === 'raider' ? 'play' : 'raider'); }
  else if (e.code === 'KeyT') $('bb-chat').click();
}

// ---------- splash: two typed lines, then the title ----------
function splash() {
  const sp = $('splash'), out = $('sp-type');
  let done = false, timer = 0, line = null;
  const later = (fn, ms) => { timer = setTimeout(fn, ms); };
  function type(li = 0, ci = 0) {
    if (done) return;
    if (li >= LINES.length) { sp.classList.add('show'); later(() => sp.classList.add('ready'), 1200); return; }
    if (ci === 0) { line = document.createElement('span'); out.append(line); }
    line.textContent += LINES[li][ci];
    if (ci + 1 < LINES[li].length) later(() => type(li, ci + 1), LINES[li][ci] === '.' ? 260 : 36);
    else later(() => type(li + 1, 0), 600);
  }
  later(() => type(), 500);
  const go = e => {
    if (done) return;
    done = true; clearTimeout(timer);
    e?.preventDefault?.();
    removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true);
    sp.classList.add('show', 'out');
    Sound.init();                       // the first click or key: the sound can start now
    uiSfx.whoosh();
    setTimeout(() => sp.remove(), 950);
  };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}
