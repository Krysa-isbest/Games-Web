// Menus, HUD, toasts, minimap, results, the campaign map and shop.
import { G, P, S, VERSION, saveProfile, MAP_HALF } from './state.js';
import { SHIP_TYPES } from './ship.js';
import { WEAPONS } from './weapons.js';
import { ISLANDS } from './islands.js';
import { sfx } from './sfx.js';
import { levelInfo, prog } from './progression.js';
import { NODE, reachableOf, SHIP_SHOP, personalShop } from './modes.js';
import { openGarage } from './garage.js';
import { openSettings, closeSettings, initSettings } from './settings.js';
import { kn } from './keys.js';
import { talking } from './voice.js';
import { openOnline } from './lobby.js';

const $ = id => document.getElementById(id);
const THROTTLE = ['Reverse', 'Stop', 'Slow', 'Half', 'Full'];
const SCREENS = ['menu', 'sandbox', 'ffa', 'camp', 'online', 'garage', 'settings', 'pause', 'results'];
const SUB = new Set(['garage', 'settings']);
let back = 'menu', current = null, H = null;

export function show(id) {
  if (current === 'settings' && id !== 'settings') closeSettings();
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  if (id === 'menu') refreshProfile();
  if (id === 'settings') openSettings();
  if (id === 'online') openOnline();
  if (!SUB.has(id)) back = id || back;
  if (id !== current) sfx.whoosh?.();
  current = id;
}
export const hideScreens = () => { if (current === 'settings') closeSettings(); for (const s of SCREENS) $(s).classList.add('hidden'); current = null; };

export function toast(text, kind = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + kind; d.textContent = text;
  $('toasts').append(d);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  setTimeout(() => d.classList.add('out'), 3800);
  setTimeout(() => d.remove(), 4400);
}

function lvl(mode) { const p = prog(mode), li = levelInfo(p.xp); return { ...li, ft: p.ft }; }
export function refreshProfile() {
  const f = lvl('ffa'), c = lvl('camp');
  $('profile').innerHTML = `<div class="avatar" style="background:${P.shirt}">${(P.name[0] || 'S').toUpperCase()}</div>
    <div><div class="pc-name">${P.name}</div><div class="pc-rows">
      <div>⚔️ FFA Lv ${f.level} · <b>${f.ft} FT</b><span class="mini"><i style="width:${f.into / f.need * 100}%"></i></span></div>
      <div>🧭 Campaign Lv ${c.level} · <b>${c.ft} FT</b><span class="mini"><i style="width:${c.into / c.need * 100}%"></i></span></div>
    </div></div>`;
  $('mc-ffa').textContent = `Level ${f.level} · ${f.ft} FT`;
  $('mc-camp').textContent = `Level ${c.level} · ${c.ft} FT`;
}
const segVal = id => $(id).dataset.value;

export function buildHelp() {
  $('help').innerHTML = `<h3>Controls</h3>
    <p><b>${kn('forward')}${kn('left')}${kn('back')}${kn('right')}</b> move · <b>${kn('sprint')}</b> sprint · <b>${kn('jump')}</b> jump / swim up · <b>${kn('dive')}</b> dive</p>
    <p><b>${kn('use')}</b> use (helm, deck gun, planks, items, crates) · <b>${kn('drop')}</b> drop</p>
    <p><b>LMB</b> shoot · <b>RMB</b> aim · <b>${kn('reload')}</b> reload · <b>${kn('slot1')}–${kn('slot4')}</b> weapons · <b>${kn('detonate')}</b> detonate C4</p>
    <p><b>Helm:</b> ${kn('forward')}/${kn('back')} speed · ${kn('left')}/${kn('right')} steer · ${kn('crane')} crane · ${kn('use')} let go</p>
    <p><b>Crane:</b> ${kn('left')}/${kn('right')} turn · ${kn('forward')}/${kn('back')} reach · ${kn('craneDown')} lower · ${kn('craneUp')} raise · ${kn('grab')} grab</p>
    <p><b>Holes:</b> plank from the storage (stern hold) fixes ~90 %. <b>Water:</b> bucket in the flood water, throw it over the railing. <b>Fire:</b> full bucket on it.</p>
    <p><b>${kn('admin')}</b> admin (sandbox) · <b>${kn('help')}</b> this card · <b>${kn('ptt')}</b> push to talk · <b>Esc</b> pause</p>`;
}

export function initUI(h) {
  H = h;
  initSettings(h);
  $('ver').textContent = VERSION;
  // navigation
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'back') return show(back);
    if (go === 'garage') openGarage(b.dataset.mode || 'ffa');
    show(go);
  }));
  document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(x => x.classList.toggle('on', x === b));
    for (const t of ['play', 'news']) $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
    sfx.click();
  });
  // segmented option groups
  document.querySelectorAll('.screen .seg[data-value]').forEach(seg => {
    const sync = () => seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === seg.dataset.value));
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { seg.dataset.value = b.dataset.v; sync(); sfx.click(); });
    sync();
  });
  // hover / click sounds everywhere in the menus
  let lastHover = null;
  document.addEventListener('mouseover', e => { const b = e.target.closest('button, .mode-card'); if (b && b !== lastHover && !G.running) { lastHover = b; sfx.hover(); } });
  document.addEventListener('click', e => { if (e.target.closest('button, .mode-card')) sfx.click(); });
  // splash
  $('splash').onclick = () => { $('splash').classList.add('out'); setTimeout(() => $('splash').remove(), 700); h.firstClick?.(); show('menu'); };

  $('sb-start').onclick = () => h.start('sandbox', { sea: +segVal('sb-sea'), sharks: +segVal('sb-sharks'), enemies: segVal('sb-enemies') === '1' });
  $('ffa-start').onclick = () => h.start('ffa', { rivals: +segVal('ffa-rivals'), layout: segVal('ffa-layout'), sea: +segVal('ffa-sea') });
  $('camp-start').onclick = () => h.start('camp', { diff: segVal('camp-diff') });
  $('sb-admin-key').textContent = kn('admin');
  $('p-resume').onclick = () => h.resume();
  $('p-quit').onclick = () => h.quit();
  $('r-again').onclick = () => h.again();
  $('r-garage').onclick = () => { h.quit(); openGarage(G.lastMode === 'camp' ? 'camp' : 'ffa'); show('garage'); };
  $('r-menu').onclick = () => h.quit();
  $('r-lobby').onclick = () => h.toLobby();
  buildHelp();
  refreshProfile();
}
// ---------- results ----------
export function showResults(r) {
  G.lastMode = r.mode;
  const li = levelInfo(prog(r.mode).xp);
  $('res-title').textContent = r.title;
  $('res-body').innerHTML = r.lines.map(l => `<p>${l}</p>`).join('') +
    (r.ft || r.xp ? `<p class="gain">+${r.ft} FT · +${r.xp} XP</p>` : '') +
    (r.levels?.length ? `<p class="gain">⭐ Level up! Now level ${r.levels.at(-1)}</p>` : '') +
    (r.unlocks?.length ? `<p class="gain">🔓 Unlocked to buy: ${r.unlocks.join(', ')}</p>` : '') +
    `<div class="bar"><span>Lv ${li.level}</span><div class="track"><div class="fill xp" style="width:${li.into / li.need * 100}%"></div></div><small>${li.into}/${li.need}</small></div>`;
  const online = G.net.role !== 'solo';
  $('r-again').classList.toggle('hidden', online);
  $('r-lobby').classList.toggle('hidden', !online);
  $('r-lobby').textContent = G.net.role === 'host' ? '↩ Everyone back to the lobby' : '↩ Back to the lobby';
  H.toResults();
  show('results');
}

// ---------- campaign map / shop overlay ----------
export function closeOverlay() { $('overlay').classList.add('hidden'); }
let mapState = null;
export function campaignMap(st, hostUI) {
  mapState = st;
  const ov = $('overlay');
  ov.classList.remove('hidden');
  const reach = reachableOf(st.map, st.cur);
  const nextCol = st.cur ? st.cur.c + 1 : 0;
  const W = 760, Hh = 360, colX = i => 50 + i * (W - 100) / 6, rowY = (n, i) => Hh / 2 + (i - (n - 1) / 2) * 110;
  let lines = '';
  st.map.forEach((col, ci) => col.forEach((nd, i) => nd.next.forEach(j => {
    const nx = st.map[ci + 1];
    if (!nx) return;
    lines += `<line x1="${colX(ci)}" y1="${rowY(col.length, i)}" x2="${colX(ci + 1)}" y2="${rowY(nx.length, j)}" class="${st.cur && ci === st.cur.c && i === st.cur.i ? 'hot' : ''}"/>`;
  })));
  let nodes = '';
  st.map.forEach((col, ci) => col.forEach((nd, i) => {
    const can = ci === nextCol && reach.includes(i);
    const done = st.cur && (ci < st.cur.c || (ci === st.cur.c && i === st.cur.i));
    const here = st.cur && ci === st.cur.c && i === st.cur.i;
    nodes += `<button class="node ${can ? 'can' : ''} ${done ? 'done' : ''} ${here ? 'here' : ''} ${nd.type}" style="left:${colX(ci)}px;top:${rowY(col.length, i)}px" data-c="${ci}" data-i="${i}">${NODE[nd.type].icon}<span class="votes" data-vi="${can ? i : -1}"></span></button>`;
  }));
  const online = G.net.role !== 'solo';
  ov.innerHTML = `<div class="ov-box map">
    <h2>🧭 Choose your next stop</h2>
    <p class="note">${st.d} · Your campaign FT: <b>${prog('camp').ft}</b> · Hull ${Math.round(st.hull * 100)}% · Water ${Math.round(st.flood * 100)}% · 🪵 ${st.planks}</p>
    <div class="mapwrap" style="width:${W}px;height:${Hh}px"><svg width="${W}" height="${Hh}">${lines}</svg>${nodes}</div>
    <div class="legend">${Object.values(NODE).map(n => `<span>${n.icon} ${n.name}</span>`).join('')}</div>
    <div id="map-info" class="note">${online ? 'Everyone votes: click a glowing stop. When all have voted, the crew sails.' : 'Hover a stop to see what it is. Click a glowing one to sail there.'}</div>
    <div class="row">${hostUI && online ? '<button id="map-force">⚓ Decide now (host)</button>' : ''}<button id="map-quit">🚪 ${hostUI ? 'Abandon the run' : 'Leave the game'}</button></div></div>`;
  ov.querySelectorAll('.node').forEach(b => {
    const nd = st.map[+b.dataset.c][+b.dataset.i];
    b.onmouseenter = () => { $('map-info').textContent = `${NODE[nd.type].icon} ${NODE[nd.type].name}: ${NODE[nd.type].desc}`; };
    if (b.classList.contains('can')) b.onclick = () => { const i = +b.dataset.i; if (hostUI) G.game.vote(G.net.id, i); else G.game.vote(i); };
  });
  $('map-quit').onclick = () => H.quit();
  const f = $('map-force'); if (f) f.onclick = () => G.game.decide();
  campaignVotes(st.votes || {});
}
export function campaignVotes(votes) {
  document.querySelectorAll('.votes').forEach(el => {
    const i = +el.dataset.vi;
    const who = Object.entries(votes).filter(([, v]) => v === i).map(([pid]) => G.players.find(p => p.id === pid)?.name || pid);
    el.textContent = who.length ? who.length : '';
    el.title = who.join(', ');
    el.parentElement.classList.toggle('mine', votes[G.net.id] === i);
  });
}
// host: the real game object; guests: their own personal items + ship items through the host
export function campaignShop(game, hostUI) {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  const draw = () => {
    const me = G.me, ft = prog('camp').ft;
    const ship = SHIP_SHOP.map(it => ({ ...it, ship: true, ok: () => true }));
    const items = [...ship, ...personalShop(me)];
    ov.innerHTML = `<div class="ov-box shop"><h2>🛒 Harbour shop</h2>
      <p class="note">Your campaign FT: <b>${ft}</b> · ❤️ ${Math.ceil(me.hp)}. Ship items help the whole crew; anyone can pay.</p>
      <div class="shop-list">${items.map((it, n) => `<div class="shop-item"><span>${it.name}</span><button data-n="${n}" ${!it.ok() || ft < it.price ? 'disabled' : ''}>${it.price ? it.price + ' FT' : 'Free'}</button></div>`).join('')}</div>
      <div class="row">${hostUI ? '<button id="shop-leave" class="primary">⛵ Set sail</button>' : '<span class="note">Waiting for the host to set sail…</span>'}</div></div>`;
    ov.querySelectorAll('[data-n]').forEach(b => b.onclick = async () => {
      const it = items[+b.dataset.n], p = prog('camp');
      if (p.ft < it.price) return;
      let ok;
      if (it.ship) ok = hostUI ? G.game.shipBuy(it.id) : await G.netAct('shopShip', it.id);
      else { ok = it.ok(); if (ok) it.buy(); }
      if (ok) { p.ft -= it.price; saveProfile(); sfx.coin(); } else toast('That cannot be bought right now.');
      draw();
    });
    const l = $('shop-leave'); if (l) l.onclick = () => game.leaveShop();
  };
  draw();
}
// ---------- HUD ----------
let mapT = 0;
export function updateHUD(dt) {
  const me = G.me;
  $('hud').classList.toggle('hidden', !G.running);
  $('mic-ind').classList.toggle('hidden', !(G.running && talking()));
  if (!G.running || !me) return;
  $('hp-fill').style.width = Math.max(0, me.hp) + '%';
  $('hp-num').textContent = Math.max(0, Math.ceil(me.hp));
  $('o2').classList.toggle('hidden', me.oxygen >= 0.999);
  $('o2-fill').style.width = me.oxygen * 100 + '%';
  const s = me.inv[me.slot], def = s && WEAPONS[s.id];
  let w = '';
  if (me.holding) w = `<b>${me.holding.def.name}</b>`;
  else if (def) w = `<b>${def.name}</b> ` + (s.mag != null ? `<span>${s.mag}</span> / ${G.admin.infAmmo ? '∞' : s.reserve}${me.gun.reload > 0 ? ' <em>reloading…</em>' : ''}` : `× ${s.count}`);
  const slots = ['primary', 'secondary', 'gadget', 'special'].map((k, i) => me.inv[k] ? `<i class="${me.slot === k ? 'on' : ''}">${i + 1} ${WEAPONS[me.inv[k].id].name}</i>` : '').join('');
  $('weapon').innerHTML = w + `<div class="slots">${slots}</div>` + (G.c4s.some(c => c.owner === me) ? '<div class="c4">💣 F = detonate C4</div>' : '');
  const ship = me.stationShip();
  const sp = $('ship-panel');
  sp.classList.toggle('hidden', !ship);
  if (ship) {
    const st = ship.stats();
    const comps = ship.comps.map(c => `<div class="comp${ship.leakComps?.[c.i] ? ' leaking' : ''}" title="${c.name}${ship.leakComps?.[c.i] ? ' (leaking!)' : ''}"><div style="height:${Math.min(100, c.vol / c.cap * 100)}%"></div></div>`).join('');
    sp.innerHTML = `<b>${ship.name}</b>${ship.sinking ? ' <em class="bad">SINKING!</em>' : ''}
      <div class="bar"><span>Hull</span><div class="track"><div class="fill hull" style="width:${st.hull * 100}%"></div></div><small>${Math.round(st.hull * 100)}%</small></div>
      <div class="bar"><span>Water</span><div class="track"><div class="fill water" style="width:${st.flood * 100}%"></div></div><small>${Math.round(st.flood * 100)}%</small></div>
      <div class="comps">${comps}<small>stern · mid · bow</small></div>
      ${st.leak > 0.05 ? `<div class="leak">💧 Leaking ${st.leak.toFixed(1)} m³/s</div>` : ''}
      ${st.fires ? `<div class="fire">🔥 ${st.fires} fire${st.fires > 1 ? 's' : ''} on board! (bucket)</div>` : ''}
      <div class="sp">⚓ ${THROTTLE[st.throttle + 1]} · ${(Math.abs(st.speed) * 1.94).toFixed(0)} kn · 🪵 ${ship.storage?.planks ?? 0} · 💥 ${ship.guns}/side</div>`;
  }
  const mh = G.game?.hud?.() || '';
  $('mode-hud').innerHTML = mh; $('mode-hud').classList.toggle('hidden', !mh);
  $('prompt').textContent = me.alive ? me.prompt : '';
  $('prompt').classList.toggle('hidden', !me.prompt || !me.alive);
  // crosshair with spread
  const cross = $('cross');
  cross.classList.toggle('hidden', me.mode !== 'walk' || me.scoped || !me.alive || !!me.holding || me.gun.ads > 0.8);
  const px = innerHeight / (2 * Math.tan(G.camera.fov * Math.PI / 360));
  cross.style.setProperty('--gap', (6 + me.gun.spread * px) + 'px');
  $('scope').classList.toggle('hidden', !me.scoped);
  G.hitMarker = Math.max(0, (G.hitMarker || 0) - dt);
  $('hitmark').style.opacity = G.hitMarker > 0 ? 1 : 0;
  $('hitmark').style.color = G.hitHead ? '#ffcf4a' : '#ff4d4d';
  $('hurt').style.opacity = me.hurtT > 0 ? me.hurtT * 1.5 : (me.hp < 30 && me.alive ? 0.25 : 0);
  $('dead').classList.toggle('hidden', me.alive);
  $('dead-t').textContent = me.out ? 'You are out. Spectating…' : `Back in ${Math.ceil(me.respawnT)}…`;
  $('nuke').classList.toggle('hidden', !G.nuke);
  if (G.nuke) $('nuke').textContent = `☢️ NUKE IN ${Math.ceil(G.nuke.t)}`;
  if (G.flashScreen > 0) G.flashScreen = Math.max(0, G.flashScreen - dt * 0.5);
  $('flash').style.opacity = G.flashScreen || 0;
  mapT -= dt;
  if (mapT <= 0) { mapT = 0.15; drawMap(); }
}

const TEAM_COL = { enemy: '#ff4d4d', player: '#5fd4ff', neutral: '#cfcfcf', rival1: '#f0c419', rival2: '#62e0d0', rival3: '#ff8a3a' };
function drawMap() {
  const cv = $('minimap'), c = cv.getContext('2d'), W = cv.width, k = W / (MAP_HALF * 2);
  const X = x => (x + MAP_HALF) * k, Y = z => (z + MAP_HALF) * k;
  c.clearRect(0, 0, W, W);
  c.fillStyle = 'rgba(10,40,60,0.75)'; c.fillRect(0, 0, W, W);
  c.fillStyle = '#d9c48c';
  for (const i of ISLANDS) { c.beginPath(); c.arc(X(i.x), Y(i.z), Math.max(2, i.r * k), 0, 7); c.fill(); }
  for (const cr of G.crates) { const p = cr.state === 'deck' ? { x: cr.ship.x, z: cr.ship.z } : cr.wp; if (!p) continue; c.fillStyle = cr.loot === 'nuke' ? '#ffe14a' : '#f39a2b'; c.fillRect(X(p.x) - 1.5, Y(p.z) - 1.5, 3, 3); }
  for (const s of G.ships) {
    if (s.sunk) continue;
    c.save(); c.translate(X(s.x), Y(s.z)); c.rotate(-s.yaw);
    c.fillStyle = s.ghost ? '#3dff9e' : TEAM_COL[s.team] || '#ccc';
    c.fillRect(-s.hw * k * 1.4, -s.hl * k, s.hw * k * 2.8, s.hl * k * 2);
    c.restore();
  }
  if (G.nuke) { c.strokeStyle = '#ff2a1a'; c.lineWidth = 2; c.beginPath(); c.arc(X(G.nuke.x), Y(G.nuke.z), 50 * k, 0, 7); c.stroke(); }
  const z = G.game?.zone;
  if (z) { c.strokeStyle = '#b48cff'; c.lineWidth = 2; c.beginPath(); c.arc(X(z.x), Y(z.z), z.r * k, 0, 7); c.stroke(); }
  const me = G.me;
  if (me) {
    const p = me.worldPos();
    const a = me.mode === 'walk' ? me.worldYaw() : (me.stationShip()?.yaw ?? 0) + Math.PI;
    c.save(); c.translate(X(p.x), Y(p.z)); c.rotate(-a);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -5); c.lineTo(3.5, 4); c.lineTo(-3.5, 4); c.closePath(); c.fill();
    c.restore();
  }
}
export { saveProfile, SHIP_TYPES };

// ---------- chat + kill feed ----------
const nameOf = id => G.players.find(p => p.id === id)?.name || G.lobby?.players.find(p => p.id === id)?.name || id;
const colorOf = id => G.lobby?.players.find(p => p.id === id)?.shirt || '#fff';
export function chatLine(id, text) {
  const d = document.createElement('div');
  d.innerHTML = `<b style="color:${colorOf(id)}"></b><span></span>`;
  d.querySelector('b').textContent = nameOf(id) + ':';
  d.querySelector('span').textContent = text;
  $('chat-log').append(d);
  while ($('chat-log').children.length > 8) $('chat-log').firstChild.remove();
  setTimeout(() => d.classList.add('old'), 9000);
  sfx.click();
}
export function killLine(m) {
  const d = document.createElement('div');
  const icon = { shark: '🦈', drown: '🌊', boom: '💥', cannon: '💥', fire: '🔥', storm: '⚡', nuke: '☢️' }[m.kind] || '🔫';
  d.textContent = m.by ? `${m.by} ${icon} ${m.victim}` : `${icon} ${m.victim}`;
  if (m.bid === G.net.id || m.vid === G.net.id) d.className = 'me';
  $('killfeed').append(d);
  while ($('killfeed').children.length > 6) $('killfeed').firstChild.remove();
  setTimeout(() => d.remove(), 7000);
}