// Whiteout: the island changes every day (build step 7c, design.md 4). Trees and places never move; what changes lies
// on top of them:
//  * Drifts: the deep snow lies somewhere else every day (you can see the drifts, and they slow you down: world.js
//    snowDepth adds them). Worked out from the day number, so every screen has the same ones.
//  * A storm uncovers something: on about half the mornings after a storm, a frozen crate shows out of the snow somewhere
//    out on the island. Hold the use key on it to dig it out and open it.
//  * Things wash ashore: most mornings, wreckage from the plane (a suitcase, sheets of its skin) lies on the shore.
//    Now and then it holds a flare shell.
//  * The snowed-in cave south of the shack opens after the first storm from day 3 on.
// The host lays out each morning's finds once (`gm.daily.last`), as ordinary things in the stash; what is in a crate
// follows from its number, so it needs no extra saving. The state goes out with the shared world and into the save.
import * as THREE from 'three';
import { G } from './state.js';
import * as ISL from './island.js';
import { fbm, smooth } from './scene.js';
import * as SFX from './sfx.js';
import { TYPES } from './items.js';
import { diaryNote } from './obj.js';

let GD = null, H = null;          // the game, and helpers from work.js: { act, hint }
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const NM = 110;                   // drift mounds drawn per day

export function initDaily(gm, helpers) {
  GD = gm; H = helpers;
  gm.daily ??= { last: 0, snow: 0 };
  gm.driftDay = -1;
  const w = gm.world;
  w.drift = (x, z) => driftAt(gm.driftDay, w, x, z);
  if (typeof document !== 'undefined') {
    const geo = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, 0.7).translate(0, -Math.cos(0.7), 0).scale(1 / 0.644, 1 / 0.235, 1 / 0.644);
    const im = gm.driftIM = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#f3f7fb', roughness: 0.95 }), NM);
    im.receiveShadow = true; im.count = 0; im.frustumCulled = false;
    gm.scene.add(im);
  }
}
// the day's drifts: how much deeper the snow is here (0..0.8)
function driftAt(day, w, x, z) {
  if (day < 2) return 0;
  const d = smooth(0.6, 0.74, fbm(x * 0.026 + day * 37.1, z * 0.026 - day * 21.7, 3));
  if (d <= 0) return 0;
  return d * 0.8 * smooth(16, 34, Math.hypot(x - ISL.SHACK.x, z - ISL.SHACK.z)) * smooth(14, 30, Math.hypot(x - ISL.WRECK.x, z - ISL.WRECK.z));
}
// where the day's drifts are drawn: the deepest spots near the middle of the island
function layDrifts(gm, day) {
  const im = gm.driftIM, w = gm.world;
  if (!im) return;
  const rng = ISL.mulberry(day * 4271 + 9), wind = ISL.envAt((day - 1) * ISL.DAY, 0).wdir, spots = [];
  for (let x = -360; x <= 360; x += 13) for (let z = -360; z <= 360; z += 13) {
    const px = x + (rng() - 0.5) * 8, pz = z + (rng() - 0.5) * 8, d = driftAt(day, w, px, pz);
    if (d > 0.45 && w.groundY(px, pz) > 1.5 && w.slopeY(px, pz) > 0.85) spots.push([d, px, pz]);
  }
  spots.sort((a, b) => b[0] - a[0]);
  let n = 0;
  for (const [d, x, z] of spots) {
    if (n >= NM) break;
    const y = w.groundY(x, z) - 0.05;
    _q.setFromAxisAngle(UP, -wind + (rng() - 0.5) * 0.6);
    im.setMatrixAt(n++, _m.compose(_v.set(x, y, z), _q, _s.set(4 + d * 5, 0.35 + d * 0.7, 2 + d * 2.5)));
  }
  im.count = n; im.instanceMatrix.needsUpdate = true;
}

// ---------- every frame ----------
export function dailyTick(gm, dt, env) {
  const w = gm.world, D = gm.daily, host = gm.role !== 'guest';
  if (env.day !== gm.driftDay) {
    const first = gm.driftDay < 0;
    gm.driftDay = env.day; layDrifts(gm, env.day);
    if (gm.started && env.day >= 2) { const wx = ISL.dayWeather(env.day); if (wx) H.hint(gm, 'wx' + env.day, ['', 'A clear, still day: a good day to go far. The night will be bitter.', 'Thick fog today: you can hardly see. Don\'t go far without a guide rope to follow back.', 'A blizzard today: stay in, and keep the stove going.'][wx], 8000, true); }
    if (!first && env.day >= 2 && gm.started) H.hint(gm, 'drifts', 'Overnight the wind has moved the snow about: the deep drifts lie in new places, and a storm uncovers things that were buried.', 8000, true);
  }
  w.caves?.snowcave?.setOpen(!!D.snow);
  // the host: the morning's finds, once a day
  if (host && gm.started && env.day >= 2 && D.last < env.day && env.hours >= 8 && env.hours < 16) {
    D.last = env.day;
    let storm = 0;
    for (let k = 1; k <= 24; k++) storm = Math.max(storm, ISL.envAt(gm.T - k * ISL.DAY / 24, (ISL.DIFF[G.lobby.opts.diff] || ISL.DIFF.normal).storm).storm);
    if (storm > 0.55) {          // (on this island there is a storm most days: a crate shows on about half the mornings)
      if (ISL.mulberry(env.day * 733 + 1)() < 0.45) uncover(gm, env.day);
      if (env.day >= 3 && !D.snow) D.snow = 1;
    }
    if (ISL.mulberry(env.day * 331 + 3)() < 0.65) washUp(gm, env.day);
  }
}
// a frozen crate the storm uncovered: somewhere out on the island, away from the places
function uncover(gm, day) {
  const w = gm.world, rng = ISL.mulberry(day * 613 + 5), avoid = [ISL.SHACK, ISL.WRECK, ISL.TOWER, ISL.TAIL, ISL.CAMP, ISL.ICECAVE, ISL.SNOWCAVE];
  for (let k = 0; k < 120; k++) {
    const a = rng() * Math.PI * 2, r = 60 + rng() * 320, x = ISL.SHACK.x + Math.cos(a) * r, z = ISL.SHACK.z + Math.sin(a) * r, h = w.groundY(x, z);
    if (h < 3 || w.slopeY(x, z) < 0.88 || avoid.some(p => Math.hypot(x - p.x, z - p.z) < 40)) continue;
    if (w.trees.some(t => t.up && Math.abs(t.x - x) < 3 && Math.abs(t.z - z) < 3)) continue;
    _q.setFromAxisAngle(UP, rng() * 6.28);
    w.stash.spawn({ type: 'cache', p: [x, h + 0.25, z], q: _q.toArray(), rest: true, buried: 0.55 });
    return;
  }
}
// wreckage on the shore: walk out from the shack until the land meets the sea ice
function washUp(gm, day) {
  const w = gm.world, rng = ISL.mulberry(day * 977 + 13);
  for (let k = 0; k < 40; k++) {
    const a = rng() * Math.PI * 2;
    let prev = null;
    for (let r = 40; r < 600; r += 3) {
      const x = ISL.SHACK.x + Math.cos(a) * r, z = ISL.SHACK.z + Math.sin(a) * r, h = w.groundY(x, z);
      if (h < ISL.SEA + 0.1) { if (!prev) break; _q.setFromAxisAngle(UP, rng() * 6.28); w.stash.spawn({ type: 'flotsam', p: [prev[0], Math.max(prev[2], ISL.SEA) + 0.14, prev[1]], q: _q.toArray(), rest: true, buried: 0.2 }); return; }
      prev = [x, z, h];
    }
  }
}
// what is inside: from the crate's own number, so the save needs nothing more
export function lootOf(type, id) {
  const r = ISL.mulberry(id * 7919 + (type === 'cache' ? 1 : 2)), out = [];
  const pick = (t, n, p = 1) => { if (r() < p) out.push([t, n]); };
  if (type === 'cache') {         // what the old hunter, or the trawler's crew, buried for later
    pick('beans', 1 + (r() < 0.5 ? 1 : 0)); pick('log', 2, 0.6); pick('board', 2, 0.5); pick('stone', 2, 0.4);
    pick('picks', 1, 0.15); pick('kit', 1, 0.12); pick('snowshoes', 1, 0.1); pick('torch', 1, 0.2);
  } else {                        // from the plane: luggage, its skin
    pick('silk', 1 + (r() < 0.4 ? 1 : 0), 0.7); pick('snack', 1, 0.45); pick('champ', 1, 0.25); pick('caviar', 1, 0.3); pick('sheet', 1 + (r() < 0.3 ? 1 : 0), 0.55);
    pick('shells', 1, 0.08);
  }
  if (!out.length) out.push(type === 'cache' ? ['beans', 1] : ['silk', 1]);
  return out;
}

// ---------- opening them (work.js findAct asks) ----------
export function dailyActs(gm, look, offer) {
  for (const it of gm.world.stash.list.values()) {
    if (it.hidden || (it.type !== 'cache' && it.type !== 'flotsam')) continue;
    const sc = look(_v.copy(it.mesh.position).setY(it.mesh.position.y + 0.15), 2.3, 0.82);
    if (!sc) continue;
    const dig = it.buried > 0.3, sh = TYPES[gm.inv.heldType()]?.dig || 0;
    offer(sc + 0.03, { id: 'cache' + it.id, text: it.type === 'cache' ? `${dig ? 'Dig out and open' : 'Open'} the frozen crate` : `${dig ? 'Dig out' : 'Pull apart'} the wreckage`, hold: 1.5 + it.buried * 3 * (1 - 0.7 * sh), go: () => { H.act(gm, { a: 'cache', id: it.id }); SFX.grab(); } });
  }
  // the snowed-in cave: a shovel digs through the drift in its mouth (step 7e)
  const c = gm.world.caves?.snowcave;
  if (c && !c.open) {
    const sc = look(_v.set(0, 1.2, 0.9).applyMatrix4(c.M), 3.2, 0.7), sh = TYPES[gm.inv.heldType()]?.dig || 0;
    if (sc) offer(sc, sh ? { id: 'digcave', text: 'Dig through the drift in the cave\'s mouth', hold: sh >= 1 ? 10 : 16, go: () => { H.act(gm, { a: 'cache', op: 'dig' }); SFX.pack?.(); } } : { id: 'drift', text: 'A drift blocks the mouth of a cave. A shovel would dig through it', hold: 0 });
  }
}
// the host: open it, and what was in it falls out
export function dailyApply(gm, a) {
  if (a.a !== 'cache') return;
  if (a.op === 'dig') { gm.daily.snow = 1; return; }
  const s = gm.world.stash, it = s.get(a.id);
  if (!it || (it.type !== 'cache' && it.type !== 'flotsam')) return;
  diaryNote(gm, 'open');
  const p = it.mesh.position.clone();
  s.remove(a.id);
  for (const [type, n] of lootOf(it.type, it.id)) s.spawn({ type, n, data: { dry: type === 'log' ? 0.9 : 1 }, p: [p.x + (Math.random() - 0.5) * 0.4, p.y + 0.4, p.z + (Math.random() - 0.5) * 0.4], v: [(Math.random() - 0.5) * 1.2, 1.5, (Math.random() - 0.5) * 1.2], w: [Math.random(), Math.random(), Math.random()] });
}
export const dailySnap = gm => (gm.daily ? { last: gm.daily.last, snow: gm.daily.snow } : null);
export function dailyLoad(gm, s) { if (gm.daily && s) { gm.daily.last = s.last | 0; gm.daily.snow = s.snow | 0; } }
