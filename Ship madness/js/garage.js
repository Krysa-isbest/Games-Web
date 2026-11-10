// The Garage: your ship turns on the water on the left (drag it to spin it), the gun mounts on it are buttons;
// the panel on the right has Ship, Armament, Upgrades, Loadout, Skills and Paint. Per mode: FFA and the
// Campaign have their own level, FT and unlocks; Sandbox owns everything for free.
import * as THREE from 'three';
import { G, P, saveProfile, clamp } from './state.js';
import { SHIP_TYPES, playerColors, isWarship } from './ship.js';
import { WEAPONS, ATTACH, PRIMARIES, SECONDARIES, GADGETS, attachFits } from './weapons.js';
import { CANNONS, CANNON_IDS, CANNON_ICON } from './cannons.js';
import { SKILLS, UPGRADES, kit, shipCfg, owns, unlocked, unlockOf, buy, upgradePrice, buyUpgrade, sellBack, levelInfo, prog, level, gunTypeOf, setGunType, CREW_ROLES, TRAIN_PRICE, crewOf, hireCrew, trainCrew, dismissCrew, moveCrew, setCrewPost } from './progression.js';
import { crewPost } from './ai.js';
import { sfx } from './sfx.js';

const $ = id => document.getElementById(id);
let mode = 'ffa', tab = 'ship', mount = 0;
export let onGarageChange = () => {};
export function setGarageHook(fn) { onGarageChange = fn; }

export function openGarage(m = mode) { mode = m; render(); onGarageChange(mode); }
export const garageMode = () => mode;
export { level };

const TABS = [['ship', 'Ship'], ['arms', 'Armament'], ['upgrades', 'Upgrades'], ['crew', 'Crew'], ['loadout', 'Loadout'], ['skills', 'Skills'], ['paint', 'Paint']];
let crewSel = null;          // the crew member picked in the Crew tab (click a gun on the ship to post a gunner there)
const bars = (v, max = 5) => `<span class="g2-bar">${Array.from({ length: max }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span>`;
const stat = (label, v, max = 5) => `<div class="g2-stat"><span>${label}</span>${bars(v, max)}</div>`;

function header() {
  const modes = [['ffa', 'Free-for-all'], ['camp', 'Campaign'], ['sandbox', 'Sandbox']];
  let lv;
  if (mode !== 'sandbox') {
    const li = levelInfo(prog(mode).xp);
    lv = `<div class="g2-level"><div class="g2-lvnum"><small>LEVEL</small><b>${li.level}</b></div><div class="g2-xp"><div class="track"><div class="fill xp" style="width:${li.into / li.need * 100}%"></div></div><small>${li.into} / ${li.need} XP</small></div><div class="g2-ft"><small>FERRYMAN TOKENS</small><b>${prog(mode).ft}</b></div></div>`;
  } else lv = '<div class="g2-level"><div class="g2-free">Sandbox: everything is unlocked and free.</div></div>';
  return `<div class="g2-modes">${modes.map(([k, n]) => `<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${n}</button>`).join('')}</div>${lv}
    <div class="g2-tabs">${TABS.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>`;
}

function stateBtn(id, equipped, equipAct, extra = '') {
  if (equipped) return '<button class="g2-btn eq" disabled>Equipped</button>';
  if (owns(mode, id)) return `<button class="g2-btn" data-act="${equipAct}" data-id="${id}" ${extra}>Equip</button>`;
  if (!unlocked(mode, id)) return `<button class="g2-btn lock" disabled>Level ${unlockOf(id)[0]}</button>`;
  return `<button class="g2-btn buy" data-act="buy" data-id="${id}">${unlockOf(id)[2]} FT</button>`;
}

// two kinds of ship: the modern ones you start with, and the warships (late, expensive, plated, turrets)
let shipCat = null;
function shipTab() {
  const k = kit(mode);
  shipCat ??= isWarship(k.ship) ? 'war' : 'modern';
  let h = `<div class="g2-modes g2-cats">${[['modern', 'Modern ships'], ['war', 'Warships']].map(([c, n]) => `<button data-cat="${c}" class="${c === shipCat ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (shipCat === 'war') h += '<p class="g2-note">Warships: heavy built-in plating, a naval gun turret on the bow (the frigate and the destroyer have one on the stern too), plus gun pairs you buy.</p>';
  h += '<div class="g2-list">';
  for (const [id, d] of Object.entries(SHIP_TYPES)) {
    if ((d.cat === 'war' ? 'war' : 'modern') !== shipCat) continue;
    const sel = k.ship === id;
    const war = d.cat === 'war' ? `${stat('Plating', Math.round(d.plate * 3))}${stat('Turrets', d.turrets.length, 2)}` : '';
    h += `<div class="g2-card ${sel ? 'sel' : ''}"><div class="g2-card-main"><b>${d.name}</b><p>${d.desc}</p>
      <div class="g2-stats">${stat('Speed', Math.round(d.speed * 3.6))}${stat('Agility', Math.round(d.turn * 3.4))}${stat('Size', Math.min(5, Math.round(d.L / 12)))}${stat('Gun pairs', d.maxGuns)}${war}</div></div>
      <div class="g2-card-side"><small>${d.L} m</small>${stateBtn(id, sel, 'ship')}</div></div>`;
  }
  return h + '</div>';
}

function armsTab() {
  const k = kit(mode), cfg = shipCfg(mode, k.ship), def = SHIP_TYPES[k.ship];
  const price = upgradePrice(mode, k.ship, 'guns');
  let h = `<div class="g2-sec">Gun pairs on your ${def.name.toLowerCase()}</div>
    <div class="g2-row"><div><b>${cfg.guns} of ${def.maxGuns} pairs</b><p>Modern ships come unarmed. Each pair puts a gun on both sides.</p></div>
    <div class="g2-row-btns">${mode === 'sandbox' ? '<button class="g2-btn" data-act="down" data-id="guns">−1</button>' : ''}${price == null ? '<button class="g2-btn" disabled>MAX</button>' : `<button class="g2-btn buy" data-act="up" data-id="guns">${mode === 'sandbox' ? '+1' : `+1 · ${price} FT`}</button>`}</div></div>`;
  if (!cfg.guns) return h + '<p class="g2-note">Buy a gun pair first. Then click its mount on the ship (or the list below) to pick what it fires.</p>';
  mount = clamp(mount, 0, cfg.guns - 1);
  h += `<div class="g2-sec">Pick a mount</div><div class="g2-mounts">${Array.from({ length: cfg.guns }, (_, n) => `<button data-mount="${n}" class="${n === mount ? 'on' : ''}"><span class="ico">${CANNON_ICON[gunTypeOf(cfg, n)]}</span>Pair ${n + 1}<small>${CANNONS[gunTypeOf(cfg, n)].name}</small></button>`).join('')}</div>`;
  h += `<div class="g2-sec">Gun for pair ${mount + 1}</div><div class="g2-list">`;
  for (const id of CANNON_IDS) {
    const c = CANNONS[id], on = gunTypeOf(cfg, mount) === id;
    h += `<div class="g2-card ${on ? 'sel' : ''}"><div class="g2-ico">${CANNON_ICON[id]}</div><div class="g2-card-main"><b>${c.name}</b><p>${c.desc}</p>
      <div class="g2-stats">${stat('Damage', c.stats.dmg)}${stat('Fire rate', c.stats.rate)}${stat('Range', c.stats.range)}</div></div>
      <div class="g2-card-side">${stateBtn(id, on, 'gun')}</div></div>`;
  }
  return h + '</div>';
}

function upgradesTab() {
  const k = kit(mode), cfg = shipCfg(mode, k.ship);
  let h = `<div class="g2-sec">${SHIP_TYPES[k.ship].name}</div>`;
  for (const [u, d] of Object.entries(UPGRADES)) {
    const price = upgradePrice(mode, k.ship, u);
    const btn = price == null ? '<button class="g2-btn" disabled>MAX</button>' : `<button class="g2-btn buy" data-act="up" data-id="${u}">${mode === 'sandbox' ? '+1' : `+1 · ${price} FT`}</button>`;
    const minus = mode === 'sandbox' ? `<button class="g2-btn" data-act="down" data-id="${u}">−1</button>` : '';
    const lv = cfg[u];
    const fx = `<div class="g2-fx"><span>Now: <b>${d.fx(lv)}</b></span>${lv < 3 ? `<span class="next">Level ${lv + 1}: <b>${d.fx(lv + 1)}</b></span>` : '<span class="next">Fully upgraded</span>'}</div>`;
    h += `<div class="g2-row"><div><b>${d.name}</b> ${bars(lv, 3)}<p>${d.desc}</p>${fx}</div><div class="g2-row-btns">${minus}${btn}</div></div>`;
  }
  const def = SHIP_TYPES[k.ship];
  if (def.plate) h += `<p class="g2-note">The ${def.name.toLowerCase()} is a warship: +${Math.round(def.plate * 100)} % hull toughness built in, on top of the plating upgrade.</p>`;
  return h;
}

// the people you hire: the top ones (as many as the ship has berths) sail with you
function crewTab() {
  const k = kit(mode), list = crewOf(mode), def = SHIP_TYPES[k.ship], cfg = shipCfg(mode, k.ship), room = def.crew;
  let h = `<div class="g2-sec">Your crew · ${Math.min(list.length, room)} / ${room} berths on the ${def.name.toLowerCase()}</div>`;
  if (!list.length) h += '<p class="g2-note">Nobody hired yet: pick someone below. They work on their own while you sail, and they come along online too.</p>';
  const posts = Array.from({ length: cfg.guns }, (_, n) => [n, `Pair ${n + 1}`]).concat((def.turrets || []).map(t => [t, t === 'bow' ? 'Bow turret' : 'Stern turret']));
  list.forEach((m, i) => {
    const R = CREW_ROLES[m.role], aboard = i < room;
    const train = m.rank >= 3 ? '<button class="g2-btn" disabled>Rank 3</button>' : `<button class="g2-btn buy" data-crew="train" data-id="${m.id}">Train · ${mode === 'sandbox' ? 'free' : TRAIN_PRICE[m.rank + 1] + ' FT'}</button>`;
    let post = '';
    if (m.role === 'gunner') post = posts.length ? `<div class="g2-posts"><small>Post:</small>${posts.map(([p, n]) => `<button data-crew="post" data-id="${m.id}" data-post="${p}" class="${String(m.post) === String(p) ? 'on' : ''}">${n}</button>`).join('')}</div>` : '<p class="g2-note">No guns on this ship yet: he fights with his rifle.</p>';
    h += `<div class="g2-row g2-crew ${crewSel === m.id ? 'sel' : ''} ${aboard ? '' : 'ashore'}" data-crewrow="${m.id}"><div><b>${R.icon} ${m.name}</b> <em>${R.name}</em> ${bars(m.rank, 3)}<p>${R.fx(m.rank)}${aboard ? '' : ' · <b>stays ashore</b> (no free berth)'}</p>${post}</div>
      <div class="g2-row-btns">${i ? `<button class="g2-btn" data-crew="up" data-id="${m.id}" title="Move up a berth">▲</button>` : ''}${train}<button class="g2-btn" data-crew="fire" data-id="${m.id}">Dismiss</button></div></div>`;
  });
  h += '<div class="g2-sec">Hire</div>';
  for (const [role, R] of Object.entries(CREW_ROLES)) {
    const lock = mode !== 'sandbox' && level(mode) < R.level;
    const btn = lock ? `<button class="g2-btn lock" disabled>Level ${R.level}</button>` : `<button class="g2-btn buy" data-crew="hire" data-id="${role}">${mode === 'sandbox' ? 'Hire' : R.price + ' FT'}</button>`;
    h += `<div class="g2-row"><div><b>${R.icon} ${R.name}</b><p>${R.desc}</p><div class="g2-fx"><span>Rank 1: <b>${R.fx(1)}</b></span><span class="next">Rank 3: <b>${R.fx(3)}</b></span></div></div><div class="g2-row-btns">${btn}</div></div>`;
  }
  return h + '<p class="g2-note">Pick a gunner, then click a gun on the ship to post him there. The badges on the ship show where everyone works. Online, every player brings their own crew (in co-op, one extra berth per friend).</p>';
}
function crewAct(a, id, post) {
  let r = 'ok';
  if (a === 'hire') { r = hireCrew(mode, id); if (r === 'ok') crewSel = crewOf(mode).at(-1).id; }
  else if (a === 'train') r = trainCrew(mode, id);
  else if (a === 'fire') { dismissCrew(mode, id); if (crewSel === id) crewSel = null; }
  else if (a === 'up') moveCrew(mode, id, -1);
  else if (a === 'post') { setCrewPost(mode, id, isNaN(+post) ? post : +post); crewSel = id; }
  if (r === 'poor') G.toast('Not enough FT.', 'bad');
  else if (r === 'full') G.toast('You can have 8 crew at most.', 'bad');
  else if (r === 'ok' && (a === 'hire' || a === 'train')) sfx.coin();
  render();
}

function loadoutTab() {
  const k = kit(mode), lo = k.loadout;
  const st = w => { const d = WEAPONS[w]; return d.mag ? `${d.pellets ? d.pellets + '×' : ''}${d.dmg} damage · ${Math.round(60 / d.rate)} rpm · ${d.mag} rounds` : `× ${d.count}`; };
  let h = '';
  for (const [slot, list, label] of [['primary', PRIMARIES, 'Primary'], ['secondary', SECONDARIES, 'Secondary'], ['gadget', GADGETS, 'Gadget']]) {
    h += `<div class="g2-sec">${label}</div>`;
    for (const w of list) h += `<div class="g2-row ${lo[slot] === w ? 'sel' : ''}"><div><b>${WEAPONS[w].name}</b><p>${st(w)}</p></div><div class="g2-row-btns">${stateBtn(w, lo[slot] === w, 'equip-' + slot)}</div></div>`;
  }
  for (const slot of ['primary', 'secondary']) {
    const w = lo[slot], fits = Object.keys(ATTACH).filter(a => attachFits(w, a));
    if (!fits.length) continue;
    h += `<div class="g2-sec">${WEAPONS[w].name} attachments</div>`;
    const cur = k.att[w] || {};
    for (const a of fits) {
      const on = cur[ATTACH[a].slot] === a;
      let btn;
      if (on) btn = `<button class="g2-btn eq" data-act="detach" data-id="${a}" data-w="${w}">On · remove</button>`;
      else if (owns(mode, a)) btn = `<button class="g2-btn" data-act="attach" data-id="${a}" data-w="${w}">Attach</button>`;
      else if (!unlocked(mode, a)) btn = `<button class="g2-btn lock" disabled>Level ${unlockOf(a)[0]}</button>`;
      else btn = `<button class="g2-btn buy" data-act="buy" data-id="${a}">${unlockOf(a)[2]} FT</button>`;
      h += `<div class="g2-row ${on ? 'sel' : ''}"><div><b>${ATTACH[a].name}</b> <em>${ATTACH[a].slot}</em><p>${ATTACH[a].desc}</p></div><div class="g2-row-btns">${btn}</div></div>`;
    }
  }
  h += '<p class="g2-note">Tools are always with you: 5 bucket, 6 hammer, 7 wrench.</p>';
  return h;
}

function skillsTab() {
  const k = kit(mode);
  let h = '<p class="g2-note">You can bring one skill.</p>';
  for (const [id, s] of Object.entries(SKILLS)) h += `<div class="g2-row ${k.loadout.skill === id ? 'sel' : ''}"><div><b>${s.name}</b><p>${s.desc}</p></div><div class="g2-row-btns">${stateBtn(id, k.loadout.skill === id, 'skill')}</div></div>`;
  return h;
}

function paintTab() {
  const sw = (id, label, val) => `<label class="g2-swatch"><input id="c-${id}" type="color" value="${val}"><span style="background:${val}"></span><b>${label}</b></label>`;
  return `<div class="g2-sec">Captain</div><label class="g2-name">Name <input id="c-name" maxlength="16" value="${P.name}"></label>
    <div class="g2-sec">Colours</div><div class="g2-swatches">${sw('hull', 'Hull', P.hull)}${sw('trim', 'Superstructure & rails', P.trim)}${sw('sail', 'Funnel, stripe & flag', P.sail)}${sw('shirt', 'Your shirt', P.shirt)}</div>
    <div class="g2-row-btns" style="margin-top:12px"><button class="g2-btn" id="c-reset">Reset colours</button></div><p class="g2-note">The same in every mode. Your ship on the left changes as you pick.</p>`;
}

function infoPlate() {
  const k = kit(mode), d = SHIP_TYPES[k.ship], cfg = shipCfg(mode, k.ship);
  return `<small>${{ ffa: 'FREE-FOR-ALL', camp: 'CAMPAIGN', sandbox: 'SANDBOX' }[mode]} SHIP</small><b>${d.name}</b>
    <div class="g2-plate-row"><span>${d.L} m</span>${d.turrets ? `<span>${d.turrets.length} turret${d.turrets.length > 1 ? 's' : ''}</span>` : ''}<span>${cfg.guns}/${d.maxGuns} gun pairs</span><span>Plating ${cfg.armor}</span><span>Pump ${cfg.pump}</span><span>Engine ${cfg.engine}</span></div>
    <p>Drag to turn the ship · click a gun mount to change its gun</p>`;
}

function render() {
  const body = { ship: shipTab, arms: armsTab, upgrades: upgradesTab, crew: crewTab, loadout: loadoutTab, skills: skillsTab, paint: paintTab }[tab]();
  const content = $('g-body').querySelector('.g2-content');
  const scroll = content?.dataset.tab === tab ? content.scrollTop : 0;
  $('g-body').innerHTML = header() + `<div class="g2-content" data-tab="${tab}">${body}</div>`;
  $('g-body').querySelector('.g2-content').scrollTop = scroll;
  $('g-info').innerHTML = infoPlate();
  const root = $('g-body');
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); onGarageChange(mode); });
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  root.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { shipCat = b.dataset.cat; sfx.click?.(); render(); });
  root.querySelectorAll('[data-crew]').forEach(b => b.onclick = e => { e.stopPropagation(); crewAct(b.dataset.crew, b.dataset.id, b.dataset.post); });
  root.querySelectorAll('[data-crewrow]').forEach(b => b.onclick = () => { crewSel = b.dataset.crewrow; render(); });
  root.querySelectorAll('[data-mount]').forEach(b => b.onclick = () => { mount = +b.dataset.mount; render(); });
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.id, b.dataset.w));
  if (tab === 'paint') {
    for (const c of ['hull', 'trim', 'sail', 'shirt']) $('c-' + c).oninput = e => { P[c] = e.target.value; e.target.nextElementSibling.style.background = e.target.value; saveProfile(); recolor(); };
    $('c-name').oninput = e => { P.name = e.target.value.slice(0, 16) || 'Sailor'; saveProfile(); };
    $('c-reset').onclick = () => { Object.assign(P, { hull: '#1f3d5c', trim: '#f2f2ee', sail: '#d8392b', shirt: '#2f6fb3' }); saveProfile(); recolor(); render(); };
  }
  buildMountButtons();
}
function recolor() { for (const s of G.ships) if (s.team === 'player') s.recolor(playerColors()); }

function act(a, id, w) {
  const k = kit(mode);
  let msg = null, rebuild = false;
  if (a === 'buy') {
    const r = buy(mode, id);
    if (r === 'poor') msg = 'Not enough FT.';
    else if (r === 'ok') { sfx.coin(); if (CANNONS[id]) { setGunType(mode, k.ship, mount, id); rebuild = true; } }
  } else if (a === 'ship') { k.ship = id; shipCfg(mode, id); rebuild = true; }
  else if (a === 'gun') { setGunType(mode, k.ship, mount, id); rebuild = true; }
  else if (a.startsWith('equip-')) k.loadout[a.slice(6)] = id;
  else if (a === 'skill') k.loadout.skill = id;
  else if (a === 'up') { const r = buyUpgrade(mode, k.ship, id); if (r === 'poor') msg = 'Not enough FT.'; else if (r === 'ok') { sfx.coin(); rebuild = true; } }
  else if (a === 'down') { sellBack(mode, k.ship, id); rebuild = true; }
  else if (a === 'attach') { k.att[w] = k.att[w] || {}; k.att[w][ATTACH[id].slot] = id; }
  else if (a === 'detach') { delete k.att[w][ATTACH[id].slot]; }
  saveProfile();
  if (msg) G.toast(msg, 'bad');
  if (rebuild) onGarageChange(mode);
  render();
}

// ---------- the 3D view: orbit camera, drag to spin, gun mount badges ----------
let yaw = 0.6, dragging = false, lastX = 0, idle = 0, built = null;
export function initGarage3D() {
  const scr = $('garage');
  scr.addEventListener('pointerdown', e => { if (e.target.closest('.g2-panel, .g2-mount')) return; dragging = true; lastX = e.clientX; idle = 0; scr.setPointerCapture(e.pointerId); });
  scr.addEventListener('pointermove', e => { if (!dragging) return; yaw -= (e.clientX - lastX) * 0.008; lastX = e.clientX; });
  scr.addEventListener('pointerup', () => { dragging = false; });
  scr.addEventListener('wheel', e => { if (e.target.closest('.g2-panel')) return; zoom = clamp(zoom + Math.sign(e.deltaY) * 0.08, 0.7, 1.5); }, { passive: true });
}
let zoom = 1;
function buildMountButtons() {
  const layer = $('g-mounts');
  if (!layer) return;
  const s = G.showcase;
  layer.innerHTML = '';
  built = s;
  if (!s) return;
  const cfg = shipCfg(mode, kit(mode).ship);
  const sel = tab === 'crew' ? crewOf(mode).find(m => m.id === crewSel && m.role === 'gunner') : null;
  // on the Crew tab with a gunner picked, clicking a gun posts him there
  const postHere = post => { setCrewPost(mode, sel.id, post); sfx.click(); render(); };
  s.cannons.forEach((c, i) => {
    const b = document.createElement('button');
    if (c.turret) {               // the warship turret is built in: nothing to change (but a gunner can be posted to it)
      b.className = 'g2-mount turret' + (sel && sel.post === c.turret ? ' on' : '');
      b.innerHTML = `<span class="ico">${CANNON_ICON.naval}</span><span class="lbl">MAIN</span>`;
      b.title = `${c.turret === 'bow' ? 'Bow' : 'Stern'} turret: naval gun${sel ? ` (click to post ${sel.name} here)` : ''}`;
      b.onclick = () => { if (sel) postHere(c.turret); };
    } else {
      b.className = 'g2-mount' + ((sel ? sel.post === c.pair : c.pair === mount && tab === 'arms') ? ' on' : '');
      b.innerHTML = `<span class="ico">${CANNON_ICON[c.type]}</span><span class="lbl">${CANNONS[gunTypeOf(cfg, c.pair)].short}</span>`;
      b.title = sel ? `Post ${sel.name} at gun pair ${c.pair + 1}` : `Gun pair ${c.pair + 1}: ${CANNONS[c.type].name} (click to change)`;
      b.onclick = () => { if (sel) return postHere(c.pair); mount = c.pair; tab = 'arms'; sfx.click(); render(); };
    }
    b.dataset.i = i;
    layer.append(b);
  });
  // where your crew work (on the Crew tab): one badge each, click to pick them
  if (tab !== 'crew') return;
  const list = crewOf(mode).slice(0, SHIP_TYPES[kit(mode).ship].crew);
  for (const m of list) {
    const b = document.createElement('button');
    b.className = 'g2-mount g2-crewb' + (m.id === crewSel ? ' on' : '');
    b.innerHTML = `<span class="ico">${CREW_ROLES[m.role].icon}</span><span class="lbl">${m.name}</span>`;
    b.title = `${m.name}, ${CREW_ROLES[m.role].name.toLowerCase()} (rank ${m.rank})`;
    b._lp = crewPost(s, m, list);
    b.onclick = () => { crewSel = m.id; sfx.click(); render(); };
    layer.append(b);
  }
}
const tv = new THREE.Vector3(), cv = new THREE.Vector3(), pv = new THREE.Vector3();
export function garageCamera(cam, dt) {
  const s = G.showcase;
  if (!s) return;
  if (built !== s) buildMountButtons();
  idle += dt;
  if (!dragging && idle > 2) yaw += dt * 0.12;
  // keep the ship still in the middle of the left side
  s.throttle = 0; s.rudderIn = 0; s.speed *= 0.9; s.x *= 0.97; s.z *= 0.97;
  const d = (s.hl * 2.1 + 9) * zoom;
  const look = s.toWorld(tv.set(0, s.deckTop * 0.9, 0));
  cam.position.set(look.x + Math.sin(yaw + s.yaw) * d, look.y + 3 + s.hl * 0.32, look.z + Math.cos(yaw + s.yaw) * d);
  cam.lookAt(look);
  if (Math.abs(cam.fov - 50) > 0.1) { cam.fov = 50; cam.updateProjectionMatrix(); }
  const W = innerWidth, H = innerHeight;
  if (!cam.view?.enabled || cam.view.offsetX !== Math.round(W * 0.21) || cam.view.fullWidth !== W || cam.view.fullHeight !== H) cam.setViewOffset(W, H, Math.round(W * 0.21), 0, W, H);
  cam.updateMatrixWorld();
  // mount badges: one per gun, the far side fades out
  const layer = $('g-mounts');
  layer.querySelectorAll('.g2-mount').forEach(b => {
    const c = b._lp ? null : s.cannons[+b.dataset.i];
    if (!c && !b._lp) return;
    const p = s.toWorld(pv.copy(b._lp || c.lp).add(tv.set(0, b._lp ? 2.1 : c.turret ? 2.2 : 1.5, 0)));
    const facing = !c || c.turret ? 1 : s.dirToWorld(tv.set(c.side, 0, 0)).dot(cv.copy(cam.position).sub(p).normalize());
    p.project(cam);
    const vis = p.z < 1 && facing > -0.35;
    b.style.display = vis ? '' : 'none';
    if (!vis) return;
    b.style.left = ((p.x + 1) / 2 * W) + 'px'; b.style.top = ((1 - p.y) / 2 * H) + 'px';
    b.style.opacity = facing > 0.1 ? 1 : 0.45;
  });
}
export function leaveGarageCamera(cam) { if (cam.view?.enabled) cam.clearViewOffset(); }
