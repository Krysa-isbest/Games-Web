// The raid rules (part 6, DESIGN 6). A raid in The Ruins:
//   - you come down in a drop pod over the city and step out at a drop zone (about 6 s, you cannot be hurt);
//   - you have 20 minutes; the three extraction points open one by one after a random wait (one of them within
//     the first two minutes), shown top right and on the pads;
//   - at an open one you hold E for 8 s (a hit stops it: you start again), then a dropship picks you up:
//     everything you carry goes to your stash;
//   - die, or let the timer run out, and you lose everything you brought in except the safe pocket; leaving to
//     the lobby counts the same (DESIGN 6: a deliberate rule).
// You go in with the starting kit of DESIGN 19 (a loadout from the stash comes with the lobby, part 8).
// The rules' state is plain data in R (a co-op host can own it later) and changes only in step(); the pod, the
// dropship and the camera shots are drawing only (frame()).
import * as THREE from 'three';
import { P, Stash, saveProfile } from '../core/save.js';
import { bus } from '../core/events.js';
import { $, esc, rng } from '../core/util.js';
import { Scenes } from '../core/scenes.js';
import { makeItem, addItem, syncShield, all } from './inventory.js';
import { applyDamage } from './damage.js';
import { ITEMS, RARITY } from './items.js';
import { fwdX, fwdZ } from './move-math.js';
import { chickenForage } from './economy.js';

// time: the raid (s); hold: calling the pick-up (s); open: when the points open (s after landing); pad: how close to
// a point's middle you must be; fall / door / out: the drop pod's landing, its door blowing off, you stepping out;
// ship: the pick-up from the end of the hold until you are gone; down: how long the death screen shows
export const RAID = { time: 20 * 60, hold: 8, open: [150, 420], first: [45, 110], pad: 6.5, fall: 4.2, door: 5.0, out: 5.8, ship: 9.5, down: 5 };
// what you go in with (DESIGN 19: "Scrap Pistol, Crowbar, 2 Medkits, 1 Repair Kit"; the light shield is what the
// Repair Kit is for, and the rounds are what the pistol needs)
export const START_KIT = {
  equip: { weapon2: 'scrap_pistol' },                      // (v0.8.2, the user: "the pistol and a bit of ammo and 1 medkit")
  quick: [['medkit', 1]],
  bag: [['light_ammo', 36]],
};
export function giveStartKit(p) {
  const inv = p.inv;
  for (const [slot, id] of Object.entries(START_KIT.equip)) if (!inv.equip[slot]) inv.equip[slot] = makeItem(id);
  START_KIT.quick.forEach(([id, n], i) => { if (!inv.quick[i]) inv.quick[i] = makeItem(id, n); else addItem(inv, makeItem(id, n)); });
  for (const [id, n] of START_KIT.bag) addItem(inv, makeItem(id, n));
  syncShield(p);
}

export const clock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// api: the play scene's (scene, player, world, prism, hud, cam, glow, phys)
export function createRaid(api, { seed = 1 } = {}) {
  const p = api.player, L = api.world.layout, rnd = rng(seed);
  const R = {
    phase: 'drop', t: 0, left: RAID.time, kills: 0, deadT: 0, cause: '', done: false, quitArm: 0, wasCalling: false,
    extracts: L.extracts.map(e => ({ id: e.id, name: e.name, x: e.x, z: e.z, openAt: RAID.open[0] + rnd() * (RAID.open[1] - RAID.open[0]) })),
    pickup: null,
  };
  R.extracts[Math.floor(rnd() * R.extracts.length)].openAt = RAID.first[0] + rnd() * (RAID.first[1] - RAID.first[0]);
  const elapsed = () => RAID.time - R.left;
  const isOpen = e => elapsed() >= e.openAt;
  // where you come down: where the play scene put you, facing the city; the pod lands just behind you
  const sp = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.facing || 0 };
  const fx = fwdX(sp.yaw), fz = fwdZ(sp.yaw), sx = -fz, sz = fx;              // forward (into the city) and to the side
  const podAt = { x: sp.x - fx * 2.3, z: sp.z - fz * 2.3 };
  api.phys.box({ x: podAt.x, y: 1.6, z: podAt.z }, { x: 2.2, y: 3.2, z: 2.2 });
  p.god = true;

  // ---------- the extraction points: things to use on the pads ----------
  const uses = R.extracts.map(e => api.world.items.add({
    id: 'extract-' + e.id, pos: { x: e.x, y: 1.3, z: e.z }, radius: RAID.pad,
    hold: () => R.phase === 'live' && isOpen(e) ? RAID.hold : 0,
    label: () => R.phase !== 'live' ? null : isOpen(e) ? `Hold to call the pick-up · ${e.name}` : `${e.name} opens in ${clock(e.openAt - elapsed())}`,
    use: () => { if (R.phase === 'live' && isOpen(e)) startPickup(e); },
  }));
  function startPickup(e) {
    R.phase = 'pickup'; R.t = 0;
    R.pickup = { id: e.id, name: e.name, x: e.x, z: e.z };
    p.god = true;
    bus.emit('raid:pickup', R.pickup);
  }

  // ---------- what happens to your things, and back to the lobby with a summary ----------
  function finish(result) {
    if (R.done) return;
    R.done = true;
    const inv = p.inv, carried = all(inv).map(it => ({ id: it.id, n: it.n, d: it.d || null }));
    const kept = result === 'extracted' ? carried : inv.safe.filter(Boolean).map(it => ({ id: it.id, n: it.n, d: it.d || null }));
    const lost = result === 'extracted' ? [] : carried.filter(c => !kept.some(k => k.id === c.id && k.n === c.n && k.d === c.d));
    for (const it of kept) Stash.add(it.id, it.n, it.d);
    P.stats.raids++;
    if (result === 'extracted') P.stats.extracted++;
    else if (result !== 'left') P.stats.deaths++;
    P.stats.kills += R.kills;
    saveProfile();
    chickenForage(seed + P.stats.raids);                    // Pip went scratching about while you were out (part 8)
    const worth = list => list.reduce((s, it) => s + ITEMS[it.id].value * it.n, 0);
    const summary = { result, point: R.pickup ? R.pickup.name : '', time: elapsed(), kills: R.kills, cause: R.cause, kept: merge(kept), lost: merge(lost), value: worth(kept), lostValue: worth(lost) };
    bus.emit('raid:end', summary);
    Scenes.go('menu', { raid: summary });
  }
  const merge = list => {
    const out = [];
    for (const it of list) { const o = out.find(q => q.id === it.id); if (o) o.n += it.n; else out.push({ id: it.id, n: it.n }); }
    return out.sort((a, b) => ITEMS[b.id].value * b.n - ITEMS[a.id].value * a.n);
  };

  // ---------- events ----------
  const offs = [
    bus.on('prism:dead', (r, src) => { if (src) R.kills++; }),
    // a hit stops the call (applyDamage already dropped the hold): say so
    bus.on('damage', (t, hit, res) => { if (t === p && !res.dodged && R.wasCalling) { R.wasCalling = false; api.hud.pop('Pick-up call interrupted', 'bad'); } }),
    bus.on('player:dead', t => { if (t === p && !R.cause) R.cause = p.deathCause ? `Killed by: ${p.deathCause}` : 'You died'; }),
  ];

  // ---------- the drop pod and the dropship (drawing only) ----------
  const metal = new THREE.MeshStandardMaterial({ color: 0x6a6e73, roughness: 0.55, metalness: 0.55, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.7, metalness: 0.4, flatShading: true });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb224 });
  const flameM = new THREE.MeshBasicMaterial({ color: 0xffd39a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; parent.add(m); return m; };
  // the pod: an armoured capsule, its door facing you (local +z)
  const pod = new THREE.Group();
  add(pod, new THREE.CylinderGeometry(1.05, 1.25, 2.6, 8), metal, 0, 1.5, 0);
  add(pod, new THREE.ConeGeometry(1.05, 1.2, 8), metal, 0, 3.4, 0);
  add(pod, new THREE.CylinderGeometry(1.35, 1.05, 0.45, 8), dark, 0, 0.22, 0);
  add(pod, new THREE.TorusGeometry(1.08, 0.05, 6, 24), amber, 0, 2.55, 0, false).rotation.x = Math.PI / 2;
  const door = add(pod, new THREE.BoxGeometry(1.05, 1.9, 0.14), dark, 0, 1.3, 1.12);
  add(door, new THREE.BoxGeometry(0.7, 0.08, 0.02), amber, 0, 0.55, 0.08, false);
  const podFlame = add(pod, new THREE.ConeGeometry(0.9, 3.5, 10), flameM, 0, -1.6, 0, false);
  podFlame.rotation.x = Math.PI;
  pod.rotation.y = sp.yaw + Math.PI;
  api.scene.add(pod);
  // the dropship: a flat hull, a cockpit, two engines with glowing undersides, a ramp at the back
  const ship = new THREE.Group();
  add(ship, new THREE.BoxGeometry(4.2, 1.6, 9), metal, 0, 0, 0);
  add(ship, new THREE.BoxGeometry(3.4, 0.9, 3), dark, 0, 0.9, 2.6);
  add(ship, new THREE.BoxGeometry(2.6, 0.5, 1.2), new THREE.MeshStandardMaterial({ color: 0x1c2730, roughness: 0.2, metalness: 0.7 }), 0, 0.5, 4.6);
  add(ship, new THREE.BoxGeometry(9.5, 0.35, 2.4), dark, 0, 0.3, -0.5);
  const engines = [-1, 1].map(s => {
    const g = add(ship, new THREE.CylinderGeometry(0.9, 1.0, 2.6, 10), dark, s * 4.6, 0.2, -0.5);
    add(g, new THREE.CylinderGeometry(0.75, 0.75, 0.06, 12), amber, 0, -1.32, 0, false);
    const f = add(g, new THREE.ConeGeometry(0.75, 3, 10), flameM, 0, -2.8, 0, false);
    f.rotation.x = Math.PI;
    return f;
  });
  const ramp = add(ship, new THREE.BoxGeometry(3, 0.15, 2.6), dark, 0, -0.8, -5.6);
  ship.visible = false;
  api.scene.add(ship);

  // ---------- the HUD: the clock and the extraction points (top right) ----------
  const box = $('hud-raid');
  box.classList.remove('hidden');
  let hudT = 0, lastHtml = '';
  function drawHud() {
    const calling = R.phase === 'pickup' ? `<p class="rd-call">Pick-up at ${esc(R.pickup.name)}</p>` : '';
    const rows = R.extracts.map(e => {
      const open = isOpen(e), dx = e.x - p.pos.x, dz = e.z - p.pos.z;
      return `<li class="${open ? 'open' : ''}"><span>${esc(e.name)}</span><b>${open ? 'Open' : clock(e.openAt - elapsed())}</b><i>${Math.round(Math.hypot(dx, dz))} m</i></li>`;
    }).join('');
    const html = `<div class="rd-top"><small>Raid</small><b class="${R.left < 120 ? 'low' : ''}">${clock(R.left)}</b></div><ul>${rows}</ul>${calling}`;
    if (html !== lastHtml) { box.innerHTML = html; lastHtml = html; }
  }
  drawHud();
  const quitBtn = $('pz-quit');
  quitBtn.textContent = 'Leave the raid';

  // ---------- the camera shots: the pod coming down, the dropship taking you away ----------
  const look = new THREE.Vector3(), from = new THREE.Vector3();
  let shake = 0, dustT = 0;
  const podPos = t => {
    if (t >= RAID.fall) return { x: podAt.x, y: 0, z: podAt.z };
    const k = t / RAID.fall, e = k * k;                                            // falling faster and faster
    return { x: podAt.x - fx * 70 * (1 - e), y: 240 * (1 - e), z: podAt.z - fz * 70 * (1 - e) };
  };
  // the dropship comes in from outside the city, hovers over the pad (its ramp towards the city), and leaves the
  // way it came, nose first; yaw turns its nose (+z) away from the city
  function shipPos(t) {
    const P0 = R.pickup, d = Math.hypot(P0.x, P0.z) || 1, ox = P0.x / d, oz = P0.z / d, yaw = Math.atan2(ox, oz);
    if (t < 4) { const k = 1 - Math.pow(1 - t / 4, 2.2); return { x: P0.x + ox * 60 * (1 - k), y: 4.2 + 70 * (1 - k), z: P0.z + oz * 60 * (1 - k), yaw }; }
    if (t < 5.5) return { x: P0.x, y: 4.2 + Math.sin(t * 3) * 0.08, z: P0.z, yaw };
    const k = (t - 5.5) / 4;
    return { x: P0.x + ox * 90 * k * k, y: 4.2 + 60 * k * k + 6 * k, z: P0.z + oz * 90 * k * k, yaw };
  }

  return {
    raid: R,
    // no control and no harm while the pod comes down and while the dropship takes you
    frozen: () => R.phase === 'drop' || R.phase === 'pickup',
    hideRaider: () => R.phase === 'drop' && R.t < RAID.out || (R.phase === 'pickup' && R.t > 4.6),
    step(dt) {
      if (R.done) return;
      R.t += dt;
      if (R.phase === 'drop' && R.t >= RAID.out) { R.phase = 'live'; R.t = 0; p.god = false; bus.emit('raid:landed'); }
      else if (R.phase === 'live') {
        R.left -= dt;
        R.wasCalling = !!(p.use && p.use.id.startsWith('extract-'));
        if (R.left <= 0 && !p.dead) { R.left = 0; R.cause = 'The raid timer ran out'; applyDamage(p, { amount: 1e7, type: 'fall', source: 'the raid timer' }); }
      } else if (R.phase === 'pickup' && R.t >= RAID.ship) finish('extracted');
      if (R.quitArm > 0) { R.quitArm -= dt; if (R.quitArm <= 0) quitBtn.textContent = 'Leave the raid'; }
    },
    // dead: the death screen for a few seconds, then the summary
    died(dt) {
      R.deadT += dt;
      if (R.deadT >= RAID.down) finish(R.cause === 'The raid timer ran out' ? 'timeout' : 'dead');
    },
    deathText: () => `You lose what you carried, except the safe pocket · the lobby in ${Math.max(0, Math.ceil(RAID.down - R.deadT))}`,
    // the pause menu's button: twice to leave (it costs everything you carry)
    quit() {
      if (R.quitArm > 0) { finish('left'); return; }
      R.quitArm = 4;
      quitBtn.textContent = 'Leave? You lose what you carry';
    },
    // the camera during the pod and the pick-up; false: the normal camera
    camera(camera, dt) {
      if (R.phase === 'drop' && R.t < RAID.out) {
        const q = podPos(R.t);
        if (R.t < RAID.fall) { from.set(q.x + sx * 9 - fx * 7, q.y + 5, q.z + sz * 9 - fz * 7); look.set(q.x, q.y + 1.2, q.z); }
        else { from.set(podAt.x + fx * 6.5 + sx * 4, 2.3, podAt.z + fz * 6.5 + sz * 4); look.set(podAt.x, 1.4, podAt.z); }
        camera.position.copy(from);
        if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 1.6); }
        camera.lookAt(look);
        return true;
      }
      if (R.phase === 'pickup') {
        const P0 = R.pickup, d = Math.hypot(P0.x, P0.z) || 1, ix = -P0.x / d, iz = -P0.z / d;          // towards the city
        const s = shipPos(R.t);
        from.set(P0.x + ix * 14 + iz * 6, 3.2, P0.z + iz * 14 - ix * 6);
        look.set(s.x, Math.min(s.y, 30), s.z);
        camera.position.copy(from);
        camera.lookAt(look);
        return true;
      }
      return false;
    },
    frame(dt) {
      // the pod: falling, landing in a cloud of dust, its door blowing off
      const q = podPos(R.phase === 'drop' ? R.t : RAID.out);
      pod.position.set(q.x, q.y, q.z);
      podFlame.visible = R.phase === 'drop' && R.t < RAID.fall;
      if (podFlame.visible) podFlame.scale.set(1, 0.8 + Math.random() * 0.4, 1);
      if (R.phase === 'drop') {
        if (R.t >= RAID.fall && !pod.userData.landed) {
          pod.userData.landed = true; shake = 0.9;
          const at = new THREE.Vector3(podAt.x, 0.4, podAt.z);
          api.prism.fx.flash(at, 0xffc27a, 3.5, 0.25);
          for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; api.prism.fx.smoke(new THREE.Vector3(podAt.x + Math.cos(a) * 1.8, 0.3, podAt.z + Math.sin(a) * 1.8), 2.6, 2.6, 0xb59f80, 1.2); }
          api.prism.sound('pod', at);
        }
        if (R.t >= RAID.door && !door.userData.off) {
          door.userData.off = true; door.userData.v = 7;
          api.prism.fx.sparks(new THREE.Vector3(podAt.x + fx * 1.2, 1.3, podAt.z + fz * 1.2), 0xffd08a, 10, 5);
          api.prism.sound('boom', { x: podAt.x, y: 1, z: podAt.z });
        }
      }
      if (door.userData.off && door.userData.v !== undefined && door.position.z < 6) {
        door.userData.v = Math.max(0, door.userData.v - dt * 6);
        door.position.z += door.userData.v * dt;
        door.position.y = Math.max(0.1, door.position.y + (door.userData.v - 3) * dt);
        door.rotation.x = Math.min(Math.PI / 2, door.rotation.x + dt * 3.5);
      }
      // the dropship
      ship.visible = R.phase === 'pickup';
      if (ship.visible) {
        const s = shipPos(R.t);
        ship.position.set(s.x, s.y, s.z);
        ship.rotation.y = s.yaw;
        for (const f of engines) f.scale.set(1, 0.8 + Math.random() * 0.4, 1);
        ramp.rotation.x = R.t > 3.5 && R.t < 5.8 ? -0.5 : 0;
        dustT -= dt;
        if (s.y < 20 && dustT <= 0) {
          dustT = 0.12;
          const a = Math.random() * Math.PI * 2;
          api.prism.fx.smoke(new THREE.Vector3(R.pickup.x + Math.cos(a) * 3, 0.4, R.pickup.z + Math.sin(a) * 3), 2.2, 1.8, 0xb59f80, 1.4);
        }
      }
      hudT -= dt;
      if (hudT <= 0) { hudT = 0.2; drawHud(); }
    },
    debug: () => `raid: ${R.phase} ${R.t.toFixed(1)} s, ${clock(R.left)} left, points ${R.extracts.map(e => `${e.name} ${isOpen(e) ? 'open' : clock(e.openAt - elapsed())}`).join(', ')}, ${R.kills} destroyed`,
    dispose() {
      for (const off of offs) off();
      for (const u of uses) api.world.items.remove(u);
      box.classList.add('hidden'); box.innerHTML = '';
      quitBtn.textContent = 'Back to the lobby';
      p.god = false;
      for (const m of [metal, dark, amber, flameM]) m.dispose();
    },
  };
}

// the lobby's summary of a raid: fills the raid screen (index.html #s-raid)
export function showRaidSummary(s, UI) {
  const T = {
    extracted: ['Extracted', s.point ? `Picked up at ${s.point} after ${clock(s.time)}.` : `Out after ${clock(s.time)}.`],
    dead: ['You died', `${s.cause || 'You died'}, ${clock(s.time)} into the raid. Only the safe pocket came back.`],
    timeout: ['Out of time', 'The raid timer ran out before you got out. Only the safe pocket came back.'],
    left: ['You left the raid', 'Leaving a raid early loses what you carried. Only the safe pocket came back.'],
  }[s.result] || ['Raid over', ''];
  $('rs-title').textContent = T[0];
  $('rs-title').className = s.result === 'extracted' ? 'good' : 'bad';
  $('rs-sub').textContent = T[1];
  const cell = (k, v) => `<div class="stat"><small>${esc(k)}</small><b>${esc(v)}</b></div>`;
  $('rs-stats').innerHTML = cell('Time in the raid', clock(s.time)) + cell('Prism destroyed', s.kills) +
    cell('Brought back', s.value.toLocaleString('en-US') + ' cr') + cell('Lost', s.lostValue.toLocaleString('en-US') + ' cr');
  const list = (items, empty) => items.length ? items.map(it => {
    const d = ITEMS[it.id];
    return `<li><b style="color:${RARITY[d.rarity].color}">${esc(d.name)}</b><span>x${it.n}</span><i>${(d.value * it.n).toLocaleString('en-US')} cr</i></li>`;
  }).join('') : `<li class="none">${esc(empty)}</li>`;
  $('rs-kept').innerHTML = list(s.kept, 'Nothing');
  $('rs-lost').innerHTML = list(s.lost, 'Nothing');
  $('rs-lost-h').classList.toggle('hidden', !s.lost.length);
  $('rs-lost').classList.toggle('hidden', !s.lost.length);
  UI.go('raid');
}
