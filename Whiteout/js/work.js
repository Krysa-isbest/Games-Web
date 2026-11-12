// Whiteout: build step 3 in play. What you can do with what you look at (hold the use key): pick things up, feed
// and light the stove, fit its pipe, patch the shack, fix and open the door. The axe (left mouse): fell trees,
// chop the trunk into logs, split logs, smash crates into boards. The hotbar (1-5, the mouse wheel), dropping (G),
// the backpack (Tab), the lighter (F). Everything that changes the world goes through act(): solo and the host
// do it at once, a guest sends it to the host, and the host sends the world back (g-s, a few times a second).
import * as THREE from 'three';
import { G } from './state.js';
import { BINDS, kn } from './keys.js';
import { on, send, broadcast } from './net.js';
import { DAY } from './island.js';
import { TYPES, nameOf, shortOf, Inventory, HOT } from './items.js';
import { Home, STOVE_MAX } from './home.js';
import { Hands } from './hands.js';
import * as SFX from './sfx.js';

let GW = null;           // the running game (game.js's gm)
let H = null;            // helpers from game.js: { hint, lock }
const _f = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const PLANE = ['fur', 'wool', 'kit', 'flare'];
const KEYS = ['primary', 'drop', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'inventory', 'light'];
const HINT = {
  fur: 'You pull on the fur coat. It keeps the cold out far better than what you had on.',
  wool: 'You pull on the wool coat. Warmer than what you had on.',
  kit: 'The first aid kit: bandages, painkillers, a little medicine. Keep it for when it counts.',
  flare: 'The flare gun. It\'s empty: you\'ll need shells for it.',
  axe: () => `The axe. There is only one, so don't lose it. Swing it with ${kn('primary')} at a tree, a felled trunk, a log or a crate.`,
  pipe: 'The stove pipe! Take it to the stove in the shack and fit it, and the smoke goes up and out.',
  board: 'Boards and sheets of metal patch the gaps in the shack: look at a gap and hold the use key. Or burn them.',
  sheet: 'Boards and sheets of metal patch the gaps in the shack: look at a gap and hold the use key.',
  branch: 'Branches burn fast, but they are free. Look at the stove with one in your hands and hold the use key.',
  log: 'Firewood. Hold it, look at the stove and hold the use key to put it in.',
};

export function initWork(gm, helpers) {
  GW = gm; H = helpers;
  gm.inv = new Inventory();
  gm.home = new Home(gm.world);
  gm.hands = new Hands(gm.camera, gm.scene);
  gm.scene.add(gm.camera);
  gm.hands.setCoat(gm.myCoat);
  gm.prevK = new Set(); gm.invShown = -1; gm.pick = null; gm.bagOpen = false; gm.sT = 0; gm.heldT = 0;
  buildInvDom(gm);
  gm.wheel = e => {
    if (!gm.locked || gm.pauseOpen) return;
    gm.inv.sel = (gm.inv.sel + (e.deltaY > 0 ? 1 : HOT - 1)) % HOT; gm.inv.ver++;
  };
  addEventListener('wheel', gm.wheel, { passive: true });
}
export function stopWork(gm) { removeEventListener('wheel', gm.wheel); if (GW === gm) GW = null; }

// ---------- every frame ----------
export function workTick(gm, dt, env) {
  const p = gm.player, inv = gm.inv, hands = gm.hands, host = gm.role !== 'guest';
  // the keys, once per press
  const pressed = a => gm.inp.is(a) && !gm.prevK.has(a);
  if (gm.locked && !gm.fainting && !p.seat) {
    for (let i = 0; i < HOT; i++) if (pressed('slot' + (i + 1))) { inv.sel = i; inv.ver++; }
    if (pressed('drop') && inv.held()) dropHeld(gm, false);
    if (pressed('inventory')) openBag(gm);
    if (pressed('light')) { hands.lit = !hands.lit; SFX.flick(); if (hands.lit) H.hint(gm, 'lighter', 'Your lighter. It won\'t keep you warm, but it lights up the dark.'); }
    if (pressed('primary') && inv.heldType() === 'axe' && hands.swing()) SFX.whoosh();
  }
  gm.prevK = new Set(KEYS.filter(a => gm.inp.is(a)));
  // the hands, the axe landing
  if (inv.ver !== gm.invShown) renderInv(gm);
  hands.hold(p.seat ? null : inv.heldType());
  const hit = hands.update(dt, { walk: p.seat ? 0 : p.walkAmt, phase: p.phase, hide: !!p.seat || gm.fainting });
  if (hit) axeHit(gm);
  p.P.aR.sh.visible = !!p.seat || !hands.type; p.P.aL.sh.visible = !!p.seat || !hands.lit;
  // the shack: the host runs it, everyone draws it
  if (host) {
    const ev = [];
    gm.home.sim(dt, env, ev);
    if (ev.includes('blown') && gm.inShack) H.hint(gm, 'blown', 'The storm tore some of the packed snow out of the walls.', 5000, true);
    if (ev.includes('out') && gm.inShack) H.hint(gm, 'stove-out', 'The stove has burned out. Feed it before the shack goes cold.', 5000, true);
    // a felled tree grows back after 5 days (if nobody stands on the stump)
    for (const ti of [...gm.world.felled]) { const t = gm.world.trees[ti]; if (gm.T - t.at >= 5 * DAY && Math.hypot(p.pos.x - t.x, p.pos.z - t.z) > 2.5) gm.world.unfell(ti); }
    gm.sT -= dt;
    if (gm.role === 'host' && gm.sT <= 0) { gm.sT = 0.5; broadcast(worldSnap(gm)); }
  }
  gm.home.visuals(dt);
  const st = gm.home.stove;
  if (gm.inShack && st.lit && !st.pipe) H.hint(gm, 'nopipe', 'Without its pipe, the smoke stays in the shack. The wind must have taken the pipe: it can\'t be far.', 7000, true);
  if (gm.heldT > 0) gm.heldT -= dt;
}

// ---------- doing things: solo and the host do it, a guest asks the host ----------
function act(gm, a) {
  if (gm.role === 'guest') send('p0', { t: 'g-act', ...a });
  else apply(gm, a, G.net.id);
}
function apply(gm, a, from) {
  const w = gm.world, s = w.stash, home = gm.home;
  switch (a.a) {
    case 'take': {
      const it = s.get(a.id);
      if (!it || TYPES[it.type].noTake) return;
      s.remove(a.id);
      give(gm, from, it.type, it.n, it.data);
      break;
    }
    case 'drop': s.spawn({ type: a.type, n: a.n, data: a.data, p: a.p, q: a.q, v: a.v, w: a.w }); break;
    case 'feed': if (!home.feed(a.type, a.dry)) give(gm, from, a.type, 1, { dry: a.dry }); break;
    case 'light': home.light(); break;
    case 'pipe': if (!home.fitPipe()) give(gm, from, 'pipe', 1, {}); break;
    case 'mend': home.mend(a.i, a.how); break;
    case 'door': if (a.op === 'fix') home.fixDoor(); else home.toggleDoor(); break;
    case 'chop': chop(gm, a); break;
  }
}
// hand something to a player: yourself, or a guest (who puts it away when the host says so)
function give(gm, to, type, n, data) {
  if (to !== G.net.id) { send(to, { t: 'g-got', type, n, data }); return; }
  const left = gm.inv.add(type, n, data);
  if (left > 0) dropAt(gm, type, left, data);
  gotHint(gm, type, data);
  SFX.grab();
}
function gotHint(gm, type, data) {
  const h = HINT[type];
  if (h) H.hint(gm, 'got-' + type, typeof h === 'function' ? h() : h, 7000, PLANE.includes(type));
  if (TYPES[type].wood && (data?.dry ?? 1) < 0.45) H.hint(gm, 'wet', 'This wood is wet: it barely burns. Leave it on the floor by the burning stove for a few minutes to dry.', 7000, true);
  H.hint(gm, 'hotbar', `${kn('slot1')}–${kn('slot5')} or the mouse wheel pick what you hold. ${kn('drop')} drops it. ${kn('inventory')} opens your backpack.`, 8000);
}

// ---------- the axe ----------
function axeHit(gm) {
  const w = gm.world, cam = gm.camera, p = gm.player, R = gm.R;
  viewDir(gm, _f);
  const ray = new R.Ray({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: _f.x, y: _f.y, z: _f.z });
  const hit = w.phys.castRay(ray, 2.3, true, undefined, undefined, p.col);
  const at = hit ? cam.position.clone().addScaledVector(_f, hit.timeOfImpact) : null;
  if (hit) {
    const h = hit.collider.handle;
    if (w.treeByCol.has(h)) {
      const ti = w.treeByCol.get(h), t = w.trees[ti], dx = t.x - p.pos.x, dz = t.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
      gm.hands.chips.burst(at, 10, '#9a7448'); SFX.chop();
      act(gm, { a: 'chop', kind: 'tree', i: ti, dir: [dx / l, dz / l] });
      return;
    }
    if (w.propByCol.has(h)) {
      const i = w.propByCol.get(h);
      if (w.props[i].kind === 'crate') { gm.hands.chips.burst(at, 10, '#a08a6a'); SFX.chop(); act(gm, { a: 'chop', kind: 'prop', i }); return; }
    }
    if (w.stash.byCol.has(h)) {
      const it = w.stash.get(w.stash.byCol.get(h));
      if (it && (it.type === 'trunk' || it.type === 'log')) { gm.hands.chips.burst(at, 10, '#9a7448'); SFX.chop(); act(gm, { a: 'chop', kind: it.type, id: it.id }); return; }
    }
  }
  // lying things have no collider: logs (and trunks on a guest) by where you look
  for (const it of w.stash.list.values()) {
    if (it.hidden || (it.type !== 'log' && it.type !== 'trunk') || it.body) continue;
    const near = it.type === 'log' ? it.mesh.position : closestOnTrunk(it, cam.position, _b);
    _d.subVectors(near, cam.position);
    const dist = _d.length();
    if (dist > (it.type === 'log' ? 1.9 : 2.4) || _d.dot(_f) / dist < 0.86) continue;
    gm.hands.chips.burst(near, 10, '#9a7448'); SFX.chop();
    act(gm, { a: 'chop', kind: it.type, id: it.id });
    return;
  }
  if (at) { gm.hands.chips.burst(at, 6, '#e8f0f6', 1.2); SFX.clank(); }
}
function closestOnTrunk(it, from, out) {
  _a.set(0, 1, 0).applyQuaternion(it.mesh.quaternion);
  const L = 4.6 * (it.data.s || 1) * (it.data.sy || 1);
  const k = Math.max(0, Math.min(L, _d.subVectors(from, it.mesh.position).dot(_a)));
  return out.copy(it.mesh.position).addScaledVector(_a, k);
}
// the host: what an axe blow does
function chop(gm, a) {
  const w = gm.world, s = w.stash;
  if (a.kind === 'tree') {
    const t = w.trees[a.i];
    if (!t || !t.up) return;
    if (--t.hp > 0) return;
    w.fell(a.i, gm.T);
    const dx = a.dir?.[0] ?? 1, dz = a.dir?.[1] ?? 0, ang = 0.9;
    _q.setFromAxisAngle(UP, t.rot);
    s.spawn({ type: 'trunk', data: { s: t.s, sy: t.sy, hp: 3 }, p: [t.x, t.y + 0.25, t.z], q: [_q.x, _q.y, _q.z, _q.w], w: [dz * ang, 0, -dx * ang], v: [dx * 0.3, 0, dz * 0.3] });
    SFX.fall();
    if (gm.role !== 'guest') H.hint(gm, 'timber', 'Timber! Chop the fallen tree into logs. A new tree grows from the stump in 5 days.', 7000, true);
  } else if (a.kind === 'trunk') {
    const it = s.get(a.id);
    if (!it || it.type !== 'trunk') return;
    it.data.hp = (it.data.hp ?? 3) - 1;
    if (it.data.hp > 0) return;
    const up = _a.set(0, 1, 0).applyQuaternion(it.mesh.quaternion).clone(), base = it.mesh.position.clone(), sc = (it.data.s || 1) * (it.data.sy || 1);
    const lq = new THREE.Quaternion().setFromUnitVectors(X, up);
    s.remove(a.id);
    for (const k of [0.5, 1.4, 2.3, 3.2]) { const p = base.clone().addScaledVector(up, k * sc).add(_b.set(0, 0.35, 0)); s.spawn({ type: 'log', data: { dry: 0.15 }, p: p.toArray(), q: lq.toArray(), v: [Math.random() - 0.5, 1.5, Math.random() - 0.5] }); }
    for (const k of [3.9, 4.6]) { const p = base.clone().addScaledVector(up, k * sc).add(_b.set(0, 0.5, 0)); s.spawn({ type: 'branch', data: { dry: 0.6 }, p: p.toArray(), q: lq.toArray(), v: [Math.random() - 0.5, 1.2, Math.random() - 0.5] }); }
  } else if (a.kind === 'log') {
    const it = s.get(a.id);
    if (!it || it.type !== 'log') return;
    s.remove(a.id);
    const p = it.mesh.position, q = it.mesh.quaternion.toArray(), dry = it.data.dry ?? 1;
    for (const side of [-1, 1]) s.spawn({ type: 'split', data: { dry }, p: [p.x, p.y + 0.15, p.z], q, v: [side * 0.8, 1.2, side * 0.4] });
  } else if (a.kind === 'prop') {
    const pr = w.props[a.i];
    if (!pr || pr.gone || pr.kind !== 'crate') return;
    if (--pr.hp > 0) return;
    const p = w.breakProp(a.i);
    if (!p) return;
    for (let k = 0; k < 3; k++) { _q.setFromAxisAngle(UP, Math.random() * 6.28); s.spawn({ type: 'board', p: [p.x, p.y + 0.1 + k * 0.06, p.z], q: _q.toArray(), v: [Math.random() * 2 - 1, 1.5, Math.random() * 2 - 1] }); }
    SFX.fall(0.4);
  }
}

// ---------- dropping ----------
function dropHeld(gm, all) {
  const it = gm.inv.take(gm.inv.sel, all ? 99 : 1);
  if (!it) return;
  dropAt(gm, it.type, it.n, it.data, true);
}
function dropAt(gm, type, n, data, throwIt = false) {
  const cam = gm.camera, p = gm.player, R = gm.R;
  viewDir(gm, _f);
  const ray = new R.Ray({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: _f.x, y: _f.y, z: _f.z });
  const hit = gm.world.phys.castRay(ray, 0.8, true, undefined, undefined, p.col);
  const k = hit ? Math.max(0.1, hit.timeOfImpact - 0.25) : 0.6;
  const pos = cam.position.clone().addScaledVector(_f, k); pos.y -= 0.2;
  _q.setFromAxisAngle(UP, p.yaw + Math.PI / 2);
  const v = throwIt ? [_f.x * 2.2 + p.vel.x, _f.y * 2.2 + 1, _f.z * 2.2 + p.vel.z] : [0, 0, 0];
  act(gm, { a: 'drop', type, n, data, p: pos.toArray(), q: _q.toArray(), v, w: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5] });
  if (type === 'axe') H.hint(gm, 'axe-drop', 'Remember where you put the axe down. Out in the snow it slowly gets buried.', 6000, true);
}

// ---------- what you can do with what you look at ----------
export function viewDir(gm, out) {
  const p = gm.player, cp = Math.cos(p.pitch);
  return out.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
}
function clear(gm, to, dist) {
  const cam = gm.camera, R = gm.R;
  _d.subVectors(to, cam.position).divideScalar(dist);
  const ray = new R.Ray({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: _d.x, y: _d.y, z: _d.z });
  const loose = R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC;          // only walls, seats and the like hide things
  return !gm.world.phys.castRay(ray, Math.max(0.05, dist - 0.3), true, loose, undefined, gm.player.col);
}
export function findAct(gm, unbuckle) {
  const p = gm.player, w = gm.world, cam = gm.camera, inv = gm.inv, home = gm.home;
  if (gm.fainting || !gm.locked || gm.bagOpen) return null;
  if (p.seat) return { id: 'belt', text: 'Unbuckle your seatbelt', hold: 1.2, go: unbuckle };
  viewDir(gm, _f);
  let best = null, score = 0;
  const offer = (sc, a) => { if (sc > score) { score = sc; best = a; } };
  const look = (pos, reach, min) => { _d.subVectors(pos, cam.position); const dist = _d.length(); if (dist > reach || dist < 0.01) return 0; const dot = _d.dot(_f) / dist; return dot >= min && clear(gm, pos, dist) ? dot : 0; };
  const held = inv.held(), ht = held?.type, patches = inv.count(t => TYPES[t].patch);
  // things lying about
  for (const it of w.stash.list.values()) {
    if (it.hidden || TYPES[it.type].noTake) continue;
    const sc = look(_b.copy(it.mesh.position).setY(it.mesh.position.y + 0.12), 2.3, 0.82);        // aim at its top: half buried, the middle is under the snow
    if (!sc) continue;
    const name = nameOf(it.type, it.data, it.n), dig = it.buried > 0.3;
    if (!inv.room(it.type, it.n)) offer(sc, { id: 'full' + it.id, text: `${name[0].toUpperCase() + name.slice(1)}: your hands and your backpack are full`, hold: 0 });
    else offer(sc, { id: 'it' + it.id, text: `${dig ? 'Dig out' : 'Pick up'} ${name}`, hold: (TYPES[it.type].take || 0.4) + it.buried * 2.5, go: () => take(gm, it) });
  }
  // the stove
  {
    const sc = look(w.shack.stove.pos, 1.9, 0.8), st = home.stove;
    if (sc) {
      if (ht && TYPES[ht].fuel) offer(sc + 0.05, st.fuel >= STOVE_MAX - 30 ? { id: 'full', text: 'The stove is full', hold: 0 } : { id: 'feed', text: `Put ${nameOf(ht, { dry: held.dry })} in the stove`, hold: 0.6, go: () => feed(gm) });
      else if (ht === 'pipe' && !st.pipe) offer(sc + 0.05, { id: 'pipe', text: 'Fit the stove pipe', hold: 3, go: () => fitPipe(gm) });
      else if (!st.lit && st.fuel > 0) offer(sc + 0.05, { id: 'light', text: 'Light the stove with your lighter', hold: 2, go: () => { act(gm, { a: 'light' }); SFX.ignite(); H.hint(gm, 'lit', 'The fire takes. Patch the gaps and the shack holds on to its heat.', 6000); } });
      else offer(sc, { id: 'stove', text: home.status() + (st.fuel <= 0 ? ': wood goes in here' : ''), hold: 0 });
    }
  }
  // the gaps in the shack
  w.shack.spots.forEach((s, i) => {
    const state = home.patch[i];
    if (state === 2) return;
    const sc = look(s.pos, s.reach, s.kind === 'wall' ? 0.9 : 0.86);
    if (!sc) return;
    const what = s.kind === 'roof' ? 'a hole in the roof' : s.kind === 'window' ? 'the broken window' : state === 1 ? 'packed snow in a gap' : 'a gap in the wall';
    const outside = _a.subVectors(p.pos, s.pos).dot(s.outW) > 0;
    const boards = s.need > 1 ? `${s.need} boards` : 'a board';
    if (ht && TYPES[ht].patch && patches >= s.need) offer(sc, { id: 'mend' + i, text: s.kind === 'window' ? 'Board up the window' : `Nail ${boards} over ${what}`, hold: 1.4 * s.need, go: () => mend(gm, i, 2, s.need) });
    else if (s.snowOk && state === 0 && outside && !(ht && TYPES[ht].patch)) offer(sc, { id: 'snow' + i, text: 'Pack snow into the gap', hold: 3, go: () => mend(gm, i, 1, 0) });
    else offer(sc - 0.01, { id: 'gap' + i, text: `${what[0].toUpperCase() + what.slice(1)}: it needs ${boards}${s.need > 1 ? ' or sheets of metal' : ' or a sheet of metal'}${s.snowOk && state === 0 ? ', or snow packed in from outside' : ''}`, hold: 0 });
  });
  // the door
  {
    const d = w.shack.door, sc = look(d.pos, 2.3, 0.78);
    if (sc) {
      if (home.door === 'broken') offer(sc, ht && TYPES[ht].patch && patches >= 2 ? { id: 'fix', text: 'Fix the door with 2 boards', hold: 3, go: () => { if (gm.inv.use(t => TYPES[t].patch, 2)) { act(gm, { a: 'door', op: 'fix' }); SFX.hammer(); } } } : { id: 'door', text: 'The door hangs off one hinge: 2 boards would fix it', hold: 0 });
      else offer(sc, { id: 'door' + home.door, text: home.door === 'open' ? 'Close the door' : 'Open the door', hold: 0.15, go: () => { act(gm, { a: 'door', op: 'toggle' }); SFX.door(); } });
    }
  }
  return best;
}
function take(gm, it) {
  if (!gm.inv.room(it.type, it.n)) return;
  if (gm.role === 'guest') { it.hidden = true; it.mesh.visible = false; send('p0', { t: 'g-act', a: 'take', id: it.id }); }
  else apply(gm, { a: 'take', id: it.id }, G.net.id);
}
function feed(gm) {
  const it = gm.inv.take(gm.inv.sel, 1);
  if (!it) return;
  act(gm, { a: 'feed', type: it.type, dry: it.data.dry ?? 1 });
  SFX.grab();
  if (!gm.home.stove.lit) H.hint(gm, 'tolight', 'Now light it: look at the stove and hold the use key.', 5000);
}
function fitPipe(gm) {
  if (gm.inv.heldType() !== 'pipe') return;
  gm.inv.take(gm.inv.sel, 1);
  act(gm, { a: 'pipe' }); SFX.hammer();
  H.hint(gm, 'piped', 'The pipe is on. The smoke goes up and out now.', 5000, true);
}
function mend(gm, i, how, need) {
  if (how === 2 && !gm.inv.use(t => TYPES[t].patch, need)) return;
  act(gm, { a: 'mend', i, how });
  if (how === 2) SFX.hammer(); else SFX.pack();
  H.hint(gm, 'mended', how === 2 ? 'Every gap you close keeps more of the stove\'s heat in.' : 'Packed snow keeps the wind out, for now. A storm can blow it out again; boards hold better.', 6000);
}

// ---------- co-op ----------
function worldSnap(gm) {
  const w = gm.world;
  return { t: 'g-s', it: w.stash.snap(), home: gm.home.snap(), fe: [...w.felled].map(i => [i, Math.round(w.trees[i].at)]), go: w.props.map((p, i) => (p.gone ? i : -1)).filter(i => i >= 0) };
}
on('g-act', (m, from) => { const gm = GW; if (gm && gm.ready && gm.role === 'host') apply(gm, m, from); });
on('g-got', m => {
  const gm = GW;
  if (!gm || !gm.ready || gm.role !== 'guest') return;
  const left = gm.inv.add(m.type, m.n, m.data || {});
  if (left > 0) dropAt(gm, m.type, left, m.data || {});
  gotHint(gm, m.type, m.data); SFX.grab();
});
on('g-s', m => {
  const gm = GW;
  if (!gm || !gm.ready || gm.role !== 'guest') return;
  const w = gm.world;
  w.stash.applySnap(m.it || []);
  if (m.home) gm.home.apply(m.home);
  const fe = new Map((m.fe || []).map(([i, at]) => [i, at]));
  for (const [i, at] of fe) if (w.trees[i]?.up) w.fell(i, at);
  for (const i of [...w.felled]) if (!fe.has(i)) w.unfell(i);
  for (const i of m.go || []) if (!w.props[i]?.gone) w.breakProp(i);
});
export const movingItems = gm => gm.world.stash.moving();
export function applyMovingItems(gm, list) { gm.world.stash.applyMoving(list || []); }

// ---------- the hotbar and the backpack ----------
function buildInvDom(gm) {
  const d = gm.dom.root;
  d.insertAdjacentHTML('beforeend', `<div class="gm-hot"><div class="gm-held"></div><div class="gm-slots"></div></div>
    <div class="gm-bag hidden"><div class="panel"><header class="p-head"><h2>Backpack</h2><span class="p-sub">${kn('inventory')} or Esc to close</span></header>
      <div class="gm-bagbody"><div class="gm-wear"><small>Wearing</small><div class="bs" data-coat></div></div>
        <div><small>Backpack</small><div class="gm-grid" data-bag></div><small>Hotbar</small><div class="gm-grid hot" data-hot></div></div></div>
      <p class="gm-baghint">Click a thing, then click where it goes. Right-click drops one. To change coats, move a coat onto "Wearing", or move the one you wear into a slot.</p></div></div>`);
  const q = s => d.querySelector(s);
  Object.assign(gm.dom, { hot: q('.gm-slots'), held: q('.gm-held'), bag: q('.gm-bag'), bagGrid: q('[data-bag]'), bagHot: q('[data-hot]'), coatSlot: q('[data-coat]') });
  gm.dom.bag.addEventListener('mousedown', e => {
    const el = e.target.closest('[data-i], [data-coat]');
    e.preventDefault();
    if (!el) return;
    const inv = gm.inv;
    // the coat you wear: right-click drops it; click it to pick it up (then click a slot to put it there);
    // click it while holding a coat from a slot to swap them
    if (el.hasAttribute('data-coat')) {
      if (e.button === 2) { if (inv.coat) { const c = inv.coat; inv.coat = null; dropAt(gm, c, 1, {}); } gm.pick = null; }
      else if (typeof gm.pick === 'number' && TYPES[inv.slots[gm.pick]?.type]?.wear) { inv.wear(gm.pick); gm.pick = null; SFX.grab(); }
      else gm.pick = gm.pick === 'coat' || !inv.coat ? null : 'coat';
      inv.ver++; return;
    }
    const i = +el.dataset.i, s = inv.slots[i];
    if (e.button === 2) { if (s) { const it = inv.take(i, 1); dropAt(gm, it.type, it.n, it.data); } gm.pick = null; inv.ver++; return; }
    if (gm.pick === 'coat') { if (inv.undressTo(i)) SFX.grab(); gm.pick = null; }
    else if (gm.pick == null) { if (s) gm.pick = i; }
    else { if (gm.pick !== i) inv.swap(gm.pick, i); gm.pick = null; }
    inv.ver++;
  });
  gm.dom.bag.addEventListener('contextmenu', e => e.preventDefault());
}
const slotHtml = (s, i, sel, key, pick) => `<div class="bs ${s ? '' : 'empty'} ${sel ? 'on' : ''} ${pick ? 'pick' : ''}" data-i="${i}" title="${s ? nameOf(s.type, { dry: s.dry }, s.n) : ''}">${s ? `<i>${TYPES[s.type].icon}</i>${s.n > 1 ? `<b>${s.n}</b>` : ''}${TYPES[s.type].wood && s.dry < 0.8 ? `<em>${s.dry < 0.45 ? 'wet' : 'damp'}</em>` : ''}` : ''}${key ? `<small>${key}</small>` : ''}</div>`;
function renderInv(gm) {
  const inv = gm.inv, d = gm.dom, prevHeld = gm.lastHeld;
  gm.invShown = inv.ver;
  let hot = '';
  for (let i = 0; i < HOT; i++) hot += slotHtml(inv.slots[i], i, i === inv.sel, kn('slot' + (i + 1)), false);
  d.hot.innerHTML = (inv.coat ? `<div class="bs coat" title="Wearing ${TYPES[inv.coat].name}"><i>${TYPES[inv.coat].icon}</i></div>` : '') + hot;
  if (gm.bagOpen) {
    let bag = '', hb = '';
    for (let i = HOT; i < inv.slots.length; i++) bag += slotHtml(inv.slots[i], i, false, '', gm.pick === i);
    for (let i = 0; i < HOT; i++) hb += slotHtml(inv.slots[i], i, i === inv.sel, kn('slot' + (i + 1)), gm.pick === i);
    d.bagGrid.innerHTML = bag; d.bagHot.innerHTML = hb;
    d.coatSlot.innerHTML = inv.coat ? `<i>${TYPES[inv.coat].icon}</i><span>${TYPES[inv.coat].short}</span>` : '<span>No coat</span>';
    d.coatSlot.classList.toggle('pick', gm.pick === 'coat');
  }
  // what you hold, in words, for a moment when it changes
  const h = inv.held(), key = h ? h.type + h.n + Math.round(h.dry * 10) : '';
  if (key !== prevHeld) { gm.lastHeld = key; d.held.textContent = h ? shortOf(h.type, { dry: h.dry }) + (h.n > 1 ? ` × ${h.n}` : '') : ''; d.held.classList.add('show'); clearTimeout(gm.heldTO); gm.heldTO = setTimeout(() => d.held.classList.remove('show'), 1600); }
  // your coat: on your body and your sleeves
  const c = inv.coat ? TYPES[inv.coat].color : gm.myCoat;
  gm.player.P.coat.color.set(c); gm.hands.setCoat(c);
}
export function openBag(gm) {
  if (gm.bagOpen) return;
  gm.bagOpen = true; gm.pick = null; gm.inp.clear();
  gm.dom.bag.classList.remove('hidden');
  gm.inv.ver++;
  document.exitPointerLock?.();
}
export function closeBag(gm) {
  if (!gm.bagOpen) return;
  gm.bagOpen = false; gm.pick = null;
  gm.dom.bag.classList.add('hidden');
  H.lock(gm);
}
// for the HUD and the cold: what you wear
// for the checks without a browser: do an act as solo would, with stand-in helpers
export function _testApply(gm, a, helpers) { H = helpers; apply(gm, a, G.net.id); }
export function _testHelpers(helpers) { H = helpers; }
export const coatWarmth = gm => (gm.inv.coat ? TYPES[gm.inv.coat].wear : 1);
export const planeItems = gm => gm.inv.count(t => PLANE.includes(t)) + (gm.inv.coat ? 1 : 0);
void BINDS;
