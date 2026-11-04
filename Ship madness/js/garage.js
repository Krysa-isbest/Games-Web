// The Garage: ships, cannons, upgrades, weapons, attachments, skills and colours, per mode.
// FFA and Campaign have their own level, FT and unlocks. Sandbox: everything, free.
import { G, P, saveProfile } from './state.js';
import { SHIP_TYPES, playerColors } from './ship.js';
import { WEAPONS, ATTACH, PRIMARIES, SECONDARIES, GADGETS, attachFits } from './weapons.js';
import { SKILLS, UPGRADES, kit, shipCfg, owns, unlocked, unlockOf, buy, upgradePrice, buyUpgrade, sellBack, levelInfo, prog, level } from './progression.js';
import { sfx } from './sfx.js';

const $ = id => document.getElementById(id);
let mode = 'ffa', tab = 'ships';
export let onGarageChange = () => {};
export function setGarageHook(fn) { onGarageChange = fn; }

export function openGarage(m = mode) { mode = m; render(); onGarageChange(mode); }

function header() {
  const modes = [['ffa', '⚔️ FFA'], ['camp', '🧭 Campaign'], ['sandbox', '🏝️ Sandbox']];
  let lv = '';
  if (mode !== 'sandbox') {
    const li = levelInfo(prog(mode).xp);
    lv = `<div class="g-lv"><b>Level ${li.level}</b><div class="track"><div class="fill xp" style="width:${li.into / li.need * 100}%"></div></div><small>${li.into}/${li.need} XP</small><b class="ft">${prog(mode).ft} FT</b></div>`;
  } else lv = '<div class="g-lv"><b>Everything is unlocked and free in the sandbox.</b></div>';
  return `<div class="g-modes">${modes.map(([k, n]) => `<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${n}</button>`).join('')}</div>${lv}
    <div class="g-tabs">${[['ships', '🚢 Ships & guns'], ['weapons', '🔫 Weapons'], ['skills', '⭐ Skills'], ['colors', '🎨 Colours']].map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>`;
}

function stateBtn(id, equipped, equipAct) {
  if (equipped) return '<button class="eq" disabled>✔ Equipped</button>';
  if (owns(mode, id)) return `<button data-act="${equipAct}" data-id="${id}">Equip</button>`;
  if (!unlocked(mode, id)) return `<button disabled>🔒 Level ${unlockOf(id)[0]}</button>`;
  return `<button data-act="buy" data-id="${id}" class="buy">Buy ${unlockOf(id)[2]} FT</button>`;
}

function shipsTab() {
  const k = kit(mode);
  let h = '<div class="g-cards">';
  for (const [id, d] of Object.entries(SHIP_TYPES)) {
    h += `<div class="g-card ${k.ship === id ? 'sel' : ''}"><b>${d.name}</b><small>${d.desc}</small><i>${d.L} m · speed ${Math.round(d.speed * 100)}%</i>${stateBtn(id, k.ship === id, 'ship')}</div>`;
  }
  h += '</div>';
  const cfg = shipCfg(mode, k.ship), def = SHIP_TYPES[k.ship];
  const row = (what, name, desc, val, max) => {
    const price = upgradePrice(mode, k.ship, what);
    const btn = price == null ? '<button disabled>MAX</button>' : `<button data-act="up" data-id="${what}" class="buy">${mode === 'sandbox' ? '+1' : `+1 · ${price} FT`}</button>`;
    const minus = mode === 'sandbox' ? `<button data-act="down" data-id="${what}">−1</button>` : '';
    return `<div class="g-row"><div><b>${name}</b> <span class="pips">${'●'.repeat(val)}${'○'.repeat(max - val)}</span><small>${desc}</small></div><div>${minus}${btn}</div></div>`;
  };
  h += `<h3>${def.name} setup</h3>`;
  h += row('guns', '💥 Deck guns per side', `Modern ships come unarmed. Each pair adds a gun on both sides (max ${def.maxGuns}).`, cfg.guns, def.maxGuns);
  for (const [u, d] of Object.entries(UPGRADES)) h += row(u, d.name, d.desc, cfg[u], 3);
  return h;
}

function weaponsTab() {
  const k = kit(mode), lo = k.loadout;
  const stat = w => { const d = WEAPONS[w]; return d.mag ? `${d.pellets ? d.pellets + '×' : ''}${d.dmg} dmg · ${Math.round(60 / d.rate)} rpm · ${d.mag} rounds` : `× ${d.count}`; };
  let h = '';
  for (const [slot, list, label] of [['primary', PRIMARIES, 'Primary'], ['secondary', SECONDARIES, 'Secondary'], ['gadget', GADGETS, 'Gadget']]) {
    h += `<h3>${label}</h3>`;
    for (const w of list) h += `<div class="g-row"><div><b>${WEAPONS[w].name}</b><small>${stat(w)}</small></div><div>${stateBtn(w, lo[slot] === w, 'equip-' + slot)}</div></div>`;
  }
  // attachments for the equipped guns
  for (const slot of ['primary', 'secondary']) {
    const w = lo[slot], fits = Object.keys(ATTACH).filter(a => attachFits(w, a));
    if (!fits.length) continue;
    h += `<h3>${WEAPONS[w].name} attachments</h3>`;
    const cur = k.att[w] || {};
    for (const a of fits) {
      const on = cur[ATTACH[a].slot] === a;
      let btn;
      if (on) btn = `<button data-act="detach" data-id="${a}" data-w="${w}">✔ On (remove)</button>`;
      else if (owns(mode, a)) btn = `<button data-act="attach" data-id="${a}" data-w="${w}">Attach</button>`;
      else if (!unlocked(mode, a)) btn = `<button disabled>🔒 Level ${unlockOf(a)[0]}</button>`;
      else btn = `<button data-act="buy" data-id="${a}" class="buy">Buy ${unlockOf(a)[2]} FT</button>`;
      h += `<div class="g-row"><div><b>${ATTACH[a].name}</b> <i>${ATTACH[a].slot}</i><small>${ATTACH[a].desc}</small></div><div>${btn}</div></div>`;
    }
  }
  return h;
}

function skillsTab() {
  const k = kit(mode);
  let h = '<p class="note">You can bring one skill.</p>';
  for (const [id, s] of Object.entries(SKILLS)) h += `<div class="g-row"><div><b>${s.name}</b><small>${s.desc}</small></div><div>${stateBtn(id, k.loadout.skill === id, 'skill')}</div></div>`;
  return h;
}

function colorsTab() {
  return `<div class="grid2">
    <label>Name <input id="c-name" maxlength="16" value="${P.name}"></label>
    <label>Hull <input id="c-hull" type="color" value="${P.hull}"></label>
    <label>Superstructure &amp; rails <input id="c-trim" type="color" value="${P.trim}"></label>
    <label>Funnel, stripe &amp; flag <input id="c-sail" type="color" value="${P.sail}"></label>
    <label>Shirt (your arms, and online) <input id="c-shirt" type="color" value="${P.shirt}"></label>
  </div><div class="row"><button id="c-reset">Reset colours</button></div><p class="note">Your ship behind the menu changes as you pick. Colours are the same in every mode.</p>`;
}

function render() {
  const body = { ships: shipsTab, weapons: weaponsTab, skills: skillsTab, colors: colorsTab }[tab]();
  $('g-body').innerHTML = header() + `<div class="g-content">${body}</div>`;
  const root = $('g-body');
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); onGarageChange(mode); });
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.id, b.dataset.w));
  if (tab === 'colors') {
    for (const c of ['hull', 'trim', 'sail', 'shirt']) $('c-' + c).oninput = e => { P[c] = e.target.value; saveProfile(); recolor(); };
    $('c-name').oninput = e => { P.name = e.target.value.slice(0, 16) || 'Sailor'; saveProfile(); };
    $('c-reset').onclick = () => { Object.assign(P, { hull: '#1f3d5c', trim: '#f2f2ee', sail: '#d8392b', shirt: '#2f6fb3' }); saveProfile(); recolor(); render(); };
  }
}
function recolor() { for (const s of G.ships) if (s.team === 'player') s.recolor(playerColors()); }

function act(a, id, w) {
  const k = kit(mode);
  let msg = null;
  if (a === 'buy') {
    const r = buy(mode, id);
    if (r === 'poor') msg = 'Not enough FT.'; else if (r === 'ok') sfx.coin();
  } else if (a === 'ship') { k.ship = id; shipCfg(mode, id); onGarageChange(mode); }
  else if (a.startsWith('equip-')) k.loadout[a.slice(6)] = id;
  else if (a === 'skill') k.loadout.skill = id;
  else if (a === 'up') { const r = buyUpgrade(mode, k.ship, id); if (r === 'poor') msg = 'Not enough FT.'; else if (r === 'ok') { sfx.coin(); onGarageChange(mode); } }
  else if (a === 'down') { sellBack(mode, k.ship, id); onGarageChange(mode); }
  else if (a === 'attach') { k.att[w] = k.att[w] || {}; k.att[w][ATTACH[id].slot] = id; }
  else if (a === 'detach') { delete k.att[w][ATTACH[id].slot]; }
  saveProfile();
  if (msg) G.toast(msg, 'bad');
  render();
}
export const garageMode = () => mode;
export { level };
