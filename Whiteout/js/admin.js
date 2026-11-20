// Whiteout: the admin menu, for testing (step 7e). Only with the code 6767 typed into Settings > General > Testing,
// and only for solo or the host: F2 opens and closes it (when nobody is asking to join: then F2 still means "no").
// Jump anywhere, set the time, give yourself anything, fill your needs, god mode, and push the world along: open the
// snowed-in cave, lay a crate or wreckage here, call the helicopter, pile snow on the roof, knock on the door.
import * as THREE from 'three';
import { S, esc } from './state.js';
import * as ISL from './island.js';
import { TYPES, TYPE_LIST } from './items.js';
import * as SFX from './sfx.js';
import { passFor } from './ends.js';

let H = null;                       // helpers from game.js: { lock, hint, give }
// the world time of hour h (0..24) in the island's day that T is in (island.js: T = 0 is the first sunrise, 08:00)
export function hourT(T, h) { const cyc = Math.floor(T / ISL.DAY) * ISL.DAY; return cyc + (h >= 8 && h < 16 ? (h - 8) * 60 : 480 + ((h - 16 + 24) % 24) * 45); }
export const adminAllowed = gm => String(S.code || '').trim() === '6767' && gm.role !== 'guest';

export function initAdmin(gm, helpers) {
  H = helpers;
  gm.adminOpen = false; gm.god = false;
  gm.dom.root.insertAdjacentHTML('beforeend', '<div class="gm-admin hidden"><div class="panel"><header class="p-head"><h2>Admin</h2><span class="p-sub">F2 or Esc closes · for testing</span></header><div class="ga-body"></div></div></div>');
  gm.dom.admin = gm.dom.root.querySelector('.gm-admin');
  gm.dom.admin.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) run(gm, b.dataset.x, b.dataset.v); });
}
export function toggleAdmin(gm) {
  if (gm.adminOpen) { gm.adminOpen = false; gm.dom.admin.classList.add('hidden'); H.lock(gm); return; }
  gm.adminOpen = true; gm.inp.clear();
  render(gm); gm.dom.admin.classList.remove('hidden');
  document.exitPointerLock?.();
}
const B = (x, v, t) => `<button class="btn small" data-x="${x}" data-v="${esc(String(v))}">${t}</button>`;
function render(gm) {
  const env = gm.env, w = gm.world, ps = passFor(env.day), wx = ['ordinary', 'clear', 'fog', 'blizzard'][ISL.dayWeather(env.day)];
  const hh = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  const passH = ISL.envAt(ps.T0, 0).hours;
  const places = [['shack', 'Shack'], ['wreck', 'Wreck'], ['tail', 'Tail section'], ['camp', 'Camp'], ['towertop', 'Tower top'], ['tower', 'Tower foot'], ['icecave', 'Ice cave'], ['snowcave', 'Snowed-in cave'], ['pad', 'Helicopter pad'], ['ice', 'Thin ice']];
  gm.dom.admin.querySelector('.ga-body').innerHTML = `
    <p class="ga-info">Day ${env.day} · ${hh(env.hours)} · weather today: <b>${wx}</b> · storm ${Math.round(env.storm * 100)} % · today's pass: ${ps.ship ? 'a ship' : 'a plane'} at ${hh(passH)}, ${Math.round(ps.dist)} m out${gm.ends?.res ? ' · help is coming' : ''}</p>
    <h4>Go to</h4><div class="ga-row">${places.map(([k, t]) => B('tp', k, t)).join('')}</div>
    <h4>Time</h4><div class="ga-row">${[8, 12, 15, 17, 20, 23, 3].map(h => B('time', h, hh(h))).join('')}${B('hour', 1, '+1 hour')}${B('day', 1, '+1 day')}${B('pass', 0, 'To today\'s pass')}</div>
    <h4>You</h4><div class="ga-row">${B('fill', 0, 'Fill everything')}${B('god', 0, gm.god ? 'God mode: on' : 'God mode: off')}${B('cure', 0, 'Cure ailments')}${B('down', 0, 'Go down')}${B('cold', 0, 'Freeze (heat 5)')}</div>
    <h4>Give</h4><div class="ga-row"><select class="ga-type">${TYPE_LIST.filter(t => !TYPES[t].noTake).map(t => `<option value="${t}">${esc(TYPES[t].short)}</option>`).join('')}</select><select class="ga-n">${[1, 2, 3, 5].map(n => `<option>${n}</option>`).join('')}</select>${B('give', 0, 'Give')}${B('kit', 0, 'Starter kit')}</div>
    <h4>World</h4><div class="ga-row">${B('cave', 0, 'Open the snowed-in cave')}${B('crate', 0, 'A frozen crate here')}${B('wreck', 0, 'Wreckage here')}${B('heli', 0, 'Call the helicopter now')}${B('roof', 0, 'Snow on the roof')}${B('knock', 0, 'Knock on the door')}${B('learn', 0, 'Learn every page')}${B('stove', 0, 'Stove: pipe, fuel, lit')}</div>`;
}
function run(gm, x, v) {
  const p = gm.player, w = gm.world, E = gm.ends, inv = gm.inv;
  const go = (pos, yaw) => { if (p.mode && p.mode !== 'dead') p.setMode(null); if (p.seat) p.stand(pos); p.teleport(pos.x, pos.y + 0.2, pos.z); if (yaw != null) p.yaw = yaw; };
  const ground = (x2, z2) => new THREE.Vector3(x2, Math.max(w.groundY(x2, z2), ISL.SEA), z2);
  const T = gm.T, atHour = h => hourT(T, h);
  switch (x) {
    case 'tp': {
      const pl = id => w.places.find(q => q.id === id);
      const t = { shack: w.shack.outside, wreck: w.spawn(0), tail: pl('tail')?.wake, camp: pl('camp')?.pos.clone().add(new THREE.Vector3(1.5, 0, 1.5)), towertop: w.tower.top, tower: w.tower.base.clone().add(new THREE.Vector3(5, 0, 4.4)),
        icecave: pl('icecave')?.wake, snowcave: pl('snowcave')?.wake, pad: gm.pad?.clone().add(new THREE.Vector3(4, 0, 0)), ice: gm.ice?.patches?.[0] ? new THREE.Vector3(gm.ice.patches[0].x + gm.ice.patches[0].r + 4, ISL.SEA, gm.ice.patches[0].z) : null }[v];
      if (t) go(v === 'towertop' || v.endsWith('cave') || v === 'tail' ? t : ground(t.x, t.z));
      break;
    }
    case 'time': gm.T = atHour(+v); break;
    case 'hour': gm.T += gm.env.hours >= 8 && gm.env.hours < 16 ? 60 : 45; break;
    case 'day': gm.T += ISL.DAY; break;
    case 'pass': { const ps = passFor(gm.env.day); gm.T = ps.T0 - 5; break; }
    case 'fill': Object.assign(p, { heat: 100, hp: 100, hunger: 100, thirst: 100, rest: 100, wet: 0 }); break;
    case 'god': gm.god = !gm.god; break;
    case 'cure': Object.assign(gm.life, { fb: 0, sick: 0, bleed: 0 }); p.wet = 0; break;
    case 'down': p.hp = 0; break;
    case 'cold': p.heat = 5; break;
    case 'give': { const t = gm.dom.admin.querySelector('.ga-type').value, n = +gm.dom.admin.querySelector('.ga-n').value || 1; H.give(gm, t, n); break; }
    case 'kit': for (const [t, n] of [['axe', 1], ['log', 2], ['board', 4], ['flare', 1], ['shells', 3], ['rope', 1], ['shovel', 1], ['kit', 1], ['torch', 1]]) H.give(gm, t, n); break;
    case 'cave': if (gm.daily) gm.daily.snow = 1; break;
    case 'crate': case 'wreck': { _f(gm, p); w.stash.spawn({ type: x === 'crate' ? 'cache' : 'flotsam', p: [_tv.x, w.groundY(_tv.x, _tv.z) + 0.25, _tv.z], rest: true, buried: 0.4 }); break; }
    case 'heli': if (E) { E.res = E.res || { how: 'phone', at: T, land: -1 }; E.res.at = T; } break;
    case 'roof': if (gm.watch) { gm.watch.load = 1; gm.watch.spot = w.shack.spots.findIndex(s => s.kind === 'roof'); gm.watch.over = 0; } break;
    case 'knock': for (const k of [0, 0.55, 1.1]) setTimeout(() => SFX.knock?.(), k * 1000); break;
    case 'learn': for (const k of ['journal', 'den']) gm.known.add(k); break;
    case 'stove': Object.assign(gm.home.stove, { pipe: true, fuel: 600, lit: true }); break;
  }
  SFX.grab();
  render(gm);
}
const _tv = new THREE.Vector3();
function _f(gm, p) { const yaw = p.yaw; _tv.set(p.pos.x - Math.sin(yaw) * 2, 0, p.pos.z - Math.cos(yaw) * 2); }
