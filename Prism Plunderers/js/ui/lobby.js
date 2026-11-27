// The lobby's working tabs (part 8):
//   Workshop  the room in 3D (scenes/menu.js) with a bar of stations along the bottom: Pip the rooster, then the
//             benches. A bench is built first, then upgraded; each level opens recipes. The panel on the right shows
//             the one you picked: what building or upgrading it costs, and what it crafts.
//   Raider    the loadout screen (Tab: the stash on the left, what you take into the next raid on the right, drag
//             and drop, right-click to sell), the backpack's upgrades, your record.
//   Trader    buys the basics from it; selling is done on the loadout screen (right-click, Sell).
import { P, Stash, saveProfile } from '../core/save.js';
import { bus } from '../core/events.js';
import { uiSfx } from '../core/sound.js';
import { $, esc } from '../core/util.js';
import { ITEMS, RARITY } from '../game/items.js';
import { STATIONS, stationLevel, upgradeStation, craft, missing, TRADER_STOCK, buyPrice, buyPack, buy, BAG, bagSlots, upgradeBag,
  stashBox, saveStash, loadout, loadoutEmpty, chickenCollect, STASH_SLOTS, freeKit } from '../game/economy.js';
import { InventoryScreen } from './inventory.js';
import { PATHS, owned, canBuy, buySkill, resetSkills } from '../game/skills.js';
import { threat } from '../game/pacing.js';
import { UI } from './screens.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const icon = id => `<svg class="ic"><use href="#it-${ITEMS[id].icon}"/></svg>`;
const HEN = '<svg class="ic hen" viewBox="0 0 48 48"><path d="M30 8c3 0 5 2 5 5l4 2-4 2c0 6-4 11-11 12l-2 7h4v2h-9l2-9c-7-2-11-8-10-15 4 3 8 3 12 1 2-4 5-7 9-7z" fill="currentColor"/><path d="M28 3l2 4 3-3 1 5-6 1z" fill="#ff5a4d"/><circle cx="31" cy="12" r="1.4" fill="#111"/></svg>';
let sel = 'chicken', screen = null, box = null, onTop = () => {};

export function initLobby({ refresh }) {
  onTop = refresh || onTop;
  $('ws-bar').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (b) { sel = b.dataset.st; uiSfx.click(); bus.emit('lobby:station', sel); renderWorkshop(); } });
  $('ws-panel').addEventListener('click', e => onAct(e));
  $('tabpage').addEventListener('click', e => onAct(e));
}
export const loadoutOpen = () => !!(screen && screen.open);

// ---------- the buttons on the panels (data-act) ----------
function onAct(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const a = b.dataset.act, arg = b.dataset.arg;
  let ok = true, msg = '';
  if (a === 'build') { ok = upgradeStation(arg); msg = ok ? `${STATIONS.find(s => s.id === arg).name}: level ${stationLevel(arg)}` : 'Not enough to pay for it'; if (ok) bus.emit('lobby:built', arg); }
  else if (a === 'craft') { const [st, i] = arg.split(':'); const r = STATIONS.find(s => s.id === st).recipes[+i]; ok = craft(st, +i); msg = ok ? `Crafted: ${r[1] > 1 ? r[1] + ' ' : ''}${ITEMS[r[0]].name} (in your stash)` : 'Not enough materials'; }
  else if (a === 'collect') { const got = chickenCollect(); ok = got.length > 0; msg = ok ? 'Pip found: ' + got.map(f => `${f.cr} cr` + (f.id ? ` and ${f.n} ${ITEMS[f.id].name}` : '')).join(', ') : 'Nothing yet: Pip scratches about while you are out on a raid'; }
  else if (a === 'buy') { ok = buy(arg); msg = ok ? `Bought ${buyPack(arg) > 1 ? buyPack(arg) + ' ' : ''}${ITEMS[arg].name} (in your stash)` : 'Not enough Scrap Credits'; }
  else if (a === 'bag') { ok = upgradeBag(); msg = ok ? `Backpack: ${bagSlots()} slots` : 'Not enough to pay for it'; }
  else if (a === 'free') { ok = freeKit(); msg = ok ? 'Free starter loadout: the Scrap Pistol, 36 rounds, a medkit' : 'Only for an empty loadout'; }
  else if (a === 'skill') { ok = buySkill(arg); msg = ok ? 'Skill learned' : 'Not enough skill points, or the one before it is missing'; }
  else if (a === 'respec') { const back = resetSkills(); msg = `All skills unlearned: ${back} points back`; }
  else if (a === 'loadout') { openLoadout(); return; }
  if (ok) uiSfx.ok(); else uiSfx.error();
  if (msg) UI.toast(msg, ok ? '' : 'bad');
  onTop();
  renderPage();
}
let current = '';
function renderPage() { if (current === 'workshop') renderWorkshop(); else if (current === 'raider') renderRaider(); else if (current === 'trader') renderTrader(); else if (current === 'skills') renderSkills(); }

// the Skills tab (part 9): three paths of crystal facets, bought in order with skill points
export function renderSkills() {
  const col = p => `<section class="sk-path" style="--pc:${p.color}"><h4>${esc(p.name)}</h4>` + p.nodes.map(n => {
    const has = owned(n.id), can = canBuy(n.id);
    return `<button class="sk-node${has ? ' has' : can ? ' can' : ''}${n.unique ? ' uni' : ''}${n.later ? ' later' : ''}" data-act="skill" data-arg="${n.id}"${has || !can ? ' disabled' : ''}>` +
      `<i></i><b>${esc(n.name)}</b><small>${esc(n.text)}</small><em>${has ? 'Learned' : n.later ? 'Later' : n.cost + ' pt'}</em></button>`;
  }).join('') + '</section>';
  $('tabpage').innerHTML = `<h2>Skills</h2><p>You have <b class="sk-pts">${P.skills.points}</b> skill point${P.skills.points === 1 ? '' : 's'}. You earn them on raids: 2 for getting out, 1 for surviving at least 5 minutes before you fall, and 1 for every 10 Prism destroyed (up to 3). Each path is learned in order.</p>` +
    `<div class="sk-tree">${PATHS.map(col).join('')}</div><button class="btn" data-act="respec">Unlearn all (free for now)</button>`;
}

// a cost line: each item with what you have; red where you are short
function costs(items = [], cr = 0) {
  const out = items.map(([id, n]) => { const have = Stash.count(id); return `<li class="${have < n ? 'short' : ''}">${icon(id)}<span>${esc(ITEMS[id].name)}</span><b>${have}/${n}</b></li>`; });
  if (cr) out.push(`<li class="${P.credits < cr ? 'short' : ''}"><svg class="ic"><use href="#i-cr"/></svg><span>Scrap Credits</span><b>${cr.toLocaleString('en-US')}</b></li>`);
  return `<ul class="cost">${out.join('')}</ul>`;
}

// ---------- the tabs ----------
// called by the main menu when a tab opens: true when this module drew it
export function showTab(id) {
  current = id;
  if (id === 'workshop') { renderWorkshop(); bus.emit('lobby:station', sel); return true; }
  if (id === 'raider') { renderRaider(); return true; }
  if (id === 'trader') { renderTrader(); return true; }
  if (id === 'skills') { renderSkills(); return true; }
  return false;
}

// the workshop: the bar of stations, and the panel of the one you picked
export function renderWorkshop() {
  const finds = P.workshop.chicken.finds.length;
  $('ws-bar').innerHTML = `<button class="ws-card hen${sel === 'chicken' ? ' on' : ''}" data-st="chicken"><span class="ws-tag">Pip</span>${HEN}${finds ? `<i class="ws-badge">${finds}</i>` : ''}</button>` +
    STATIONS.map(s => { const lv = stationLevel(s.id); return `<button class="ws-card${sel === s.id ? ' on' : ''}${lv ? '' : ' locked'}" data-st="${s.id}"><span class="ws-tag">${esc(s.name)}</span>${icon(s.icon === 'shield' ? 'shield_light' : s.icon === 'pistol' ? 'scrap_pistol' : s.icon === 'grenade' ? 'frag_grenade' : 'medkit')}<em>${lv ? ROMAN[lv] : 'Build'}</em></button>`; }).join('');
  const panel = $('ws-panel');
  if (sel === 'chicken') {
    panel.innerHTML = `<small>Workshop</small><h2>Pip the rooster</h2><p>Pip scratches about the ruins round the workshop while you are out on a raid, and brings back a few credits, now and then something better.</p>` +
      `<div class="ws-finds">${finds ? P.workshop.chicken.finds.map(f => `<span>${f.cr} cr${f.id ? ' + ' + esc(ITEMS[f.id].name) : ''}</span>`).join('') : '<span class="none">Nothing yet: go on a raid</span>'}</div>` +
      `<button class="btn primary" data-act="collect"${finds ? '' : ' disabled'}>Collect</button>`;
    return;
  }
  const st = STATIONS.find(s => s.id === sel), lv = stationLevel(st.id), next = st.levels[lv];
  let html = `<small>Workshop · ${lv ? 'level ' + ROMAN[lv] + ' of ' + ROMAN[st.levels.length] : 'not built yet'}</small><h2>${esc(st.name)}</h2><p>${esc(st.desc)}</p>`;
  if (next) {
    const short = missing(next.items, next.cr).length > 0;
    html += `<h4>${lv ? 'Upgrade to level ' + ROMAN[lv + 1] : 'Build it'}</h4>${costs(next.items, next.cr)}<button class="btn primary" data-act="build" data-arg="${st.id}"${short ? ' disabled' : ''}>${lv ? 'Upgrade' : 'Build'}</button>`;
  } else html += '<p class="ws-max">Fully upgraded.</p>';
  html += '<h4>Recipes</h4><div class="ws-recipes">' + st.recipes.map((r, i) => {
    const locked = lv < r[2], short = missing(r[3], r[4] || 0).length > 0, d = ITEMS[r[0]];
    return `<div class="rcp${locked ? ' locked' : ''}"><header>${icon(r[0])}<b style="color:${RARITY[d.rarity].color}">${esc(d.name)}${r[1] > 1 ? ' x' + r[1] : ''}</b>` +
      `<button class="btn small" data-act="craft" data-arg="${st.id}:${i}"${locked || short ? ' disabled' : ''}>${locked ? 'Level ' + ROMAN[r[2]] : 'Craft'}</button></header>${costs(r[3], r[4] || 0)}</div>`;
  }).join('') + '</div>';
  panel.innerHTML = html;
}

// the Raider tab: the loadout, the backpack, your record
export function renderRaider() {
  const lv = P.workshop.bag | 0, next = BAG[lv + 1], L = loadout(), t = threat();
  const what = loadoutEmpty() ? 'Empty: you go in with the free starter loadout (the Scrap Pistol, 36 rounds, a medkit).'
    : Object.values(L.equip).filter(Boolean).map(it => ITEMS[it.id].name).join(', ') + ` · ${[...L.bag, ...L.quick, ...L.safe].filter(Boolean).length} more items`;
  const cell = (k, v) => `<div><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`;
  $('tabpage').innerHTML = `<h2>Raider</h2><p>${esc(what)}</p>` +
    `<button class="btn primary wide" data-act="loadout"><kbd>Tab</kbd>Loadout and stash</button>` +
    `<button class="btn wide" data-act="free"${loadoutEmpty() ? '' : ' disabled'}>Free starter loadout (pistol, ammo, medkit)</button>` +
    `<h4>Backpack · ${bagSlots()} slots</h4>` + (next ? `${costs(next.items, next.cr)}<button class="btn" data-act="bag"${missing(next.items, next.cr).length ? ' disabled' : ''}>Upgrade to ${next.slots} slots</button>` : '<p class="ws-max">The biggest backpack.</p>') +
    `<h4>Threat · ${esc(t.name)}</h4><p class="ws-max">${esc(t.text)}${t.next ? ` Next: ${esc(t.next.name)} after ${t.next.from - t.raids} more raid${t.next.from - t.raids === 1 ? '' : 's'}.` : ''}${t.safety ? ' A supply drop comes once a raid if you are badly hurt with nothing to heal with.' : ''}</p>` +
    `<h4>Record</h4><div class="tp-grid">${cell('Raids', P.stats.raids)}${cell('Extracted', P.stats.extracted)}${cell('Deaths', P.stats.deaths)}${cell('Prism destroyed', P.stats.kills)}${cell('Stash', `${P.stash.length} / ${STASH_SLOTS}`)}</div>`;
}

// the Trader tab: what it sells
export function renderTrader() {
  $('tabpage').innerHTML = `<h2>Trader</h2><p>Buys everything you bring out at its value (right-click it on the loadout screen, Sell) and sells the basics a little dearer. Prices shift a little every day.</p>` +
    `<div class="trade">${TRADER_STOCK.map(id => { const d = ITEMS[id], pr = buyPrice(id); return `<div class="tr-row">${icon(id)}<span style="color:${RARITY[d.rarity].color}">${esc(d.name)}${buyPack(id) > 1 ? ' x' + buyPack(id) : ''}</span>` +
      `<b>${pr.toLocaleString('en-US')} cr</b><button class="btn small" data-act="buy" data-arg="${id}"${P.credits < pr ? ' disabled' : ''}>Buy</button></div>`; }).join('')}</div>` +
    `<button class="btn wide" data-act="loadout">Sell from your stash</button>`;
}

// ---------- the loadout screen: the in-raid inventory screen in its lobby mode, over your stash ----------
export function openLoadout() {
  if (loadoutOpen()) return;
  const stub = { inv: loadout(), using: null, dead: false, wpn: { active: 'weapon1' }, pos: { x: 0, y: 0, z: 0 } };
  box = stashBox();
  screen = new InventoryScreen(stub, null, {
    mode: 'lobby',
    onChange: () => { saveStash(box); saveProfile(); onTop(); },
    onClose: () => { saveStash(box); saveProfile(); const s = screen; screen = null; s?.dispose(); onTop(); renderPage(); },
  });
  screen.show(box);
}
