// Whiteout: the world and a player's own things as plain data. One format, three uses: someone joining a game
// that is already running gets the world from the host; someone who dropped out and comes back gets their things;
// and a saved game is the world plus everyone's things.
// The island itself (the ground, where the trees and rocks stand) is never in here: everyone builds the same one.
import { G, S } from './state.js';
import * as ISL from './island.js';
import { lifeRecord, lifeRestore } from './life.js';
import { endsSnap, endsLoad } from './ends.js';
import { dailySnap, dailyLoad } from './daily.js';
import { watchSnap, watchLoad } from './watch.js';
import { denSnap, denLoad } from './den.js';
import { objRecord, objRestore } from './obj.js';
import { mapRecord, mapRestore } from './mapui.js';

const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

// ---------- the world (the host's, or solo's) ----------
export function worldState(gm) {
  const w = gm.world, home = gm.home;
  return {
    T: r2(gm.T), diff: G.lobby.opts.diff,
    items: w.stash.snap(), next: w.stash.next,
    home: home.snap(), air: r2(home.air),
    fe: [...w.felled].map(i => [i, Math.round(w.trees[i].at)]),                                  // felled trees and when
    ho: [...w.holes.values()].map(h => [h.id, h.x, h.z, h.at]),                                 // holes in the sea ice
    hp: w.trees.map((t, i) => (t.up && t.hp < 5 ? [i, t.hp] : 0)).filter(Boolean),               // trees with axe cuts in them
    go: w.props.map((p, i) => (p.gone ? i : -1)).filter(i => i >= 0),                            // smashed crates
    props: w.props.map((p, i) => (p.gone ? 0 : [i, r3(p.mesh.position.x), r3(p.mesh.position.y), r3(p.mesh.position.z), r3(p.mesh.quaternion.x), r3(p.mesh.quaternion.y), r3(p.mesh.quaternion.z), r3(p.mesh.quaternion.w), p.hp])).filter(Boolean),
    op: w.props.map((p, i) => (p.open ? i : -1)).filter(i => i >= 0),                         // opened suitcases and boxes
    kn: [...(gm.known || [])],                                                                 // pages learned from journals
    locs: 3,                                                                                   // which places' things are laid out: 1 the tail and the camp, 2 the caves, 3 the den plan
    en: endsSnap(gm),                                                                          // the ways off the island (step 7b)
    dm: dailySnap(gm),                                                                         // the morning's finds, the snowed-in cave (step 7c)
    wa: watchSnap(gm), dn: denSnap(gm), rp: gm.ropes || [], dy: gm.diary || [],                // the watch, the den, the ropes, the diary (step 7e)
    ob: [...(gm.ob || [])],                                                                    // the crew's objectives done
  };
}
// what the host and a guest share all the time (work.js sends it twice a second; `it` only when the list changed)
export function applyShared(gm, m) {
  const w = gm.world;
  if (m.it) w.stash.applySnap(m.it);
  if (m.home) gm.home.apply(m.home);
  const fe = new Map((m.fe || []).map(([i, at]) => [i, at]));
  for (const [i, at] of fe) if (w.trees[i]?.up) w.fell(i, at);
  for (const i of [...w.felled]) if (!fe.has(i)) w.unfell(i);
  for (const i of m.go || []) if (w.props[i] && !w.props[i].gone) w.breakProp(i);
  if (m.ho) { const ids = new Set(m.ho.map(h => h[0])); for (const h of m.ho) w.addHole(...h); for (const id of [...w.holes.keys()]) if (!ids.has(id)) w.removeHole(id); }
  for (const i of m.op || []) w.openCase?.(i);
  if (m.kn && gm.known) for (const k of m.kn) gm.known.add(k);
  if (m.en) endsLoad(gm, m.en);
  if (m.dm) dailyLoad(gm, m.dm);
  if (m.wa) watchLoad(gm, m.wa);
  if (m.dn) denLoad(gm, m.dn);
  if (Array.isArray(m.rp)) gm.ropes = m.rp;
  if (Array.isArray(m.dy)) gm.diary = m.dy;
  if (Array.isArray(m.ob) && gm.ob) for (const k of m.ob) gm.ob.add(String(k));          // shared objectives
}
// a guest: the whole world from the host, once, when joining
export function applyWorld(gm, s) {
  gm.T = s.T; gm.Tnet = s.T; gm.TnetAt = performance.now();
  if (ISL.DIFF[s.diff]) G.lobby.opts.diff = s.diff;
  applyShared(gm, { it: s.items, home: s.home, fe: s.fe, go: s.go, ho: s.ho || [], op: s.op, kn: s.kn, en: s.en, dm: s.dm, wa: s.wa, dn: s.dn, rp: s.rp, dy: s.dy, ob: s.ob });
  gm.home.air = s.air || 0;
  for (const a of s.props || []) {
    const o = gm.world.props[a[0]];
    if (!o || o.gone) continue;
    o.to = a.slice(1, 8); o.mesh.position.set(a[1], a[2], a[3]); o.mesh.quaternion.set(a[4], a[5], a[6], a[7]);
  }
}
// the host or solo: a saved game
export function loadWorld(gm, s) {
  const w = gm.world;
  gm.T = s.T;
  if (ISL.DIFF[s.diff]) G.lobby.opts.diff = s.diff;
  w.stash.load(s.items || [], s.next);
  gm.home.apply(s.home); gm.home.air = s.air || 0;
  for (const [i, at] of s.fe || []) w.fell(i, at);
  for (const [i, hp] of s.hp || []) if (w.trees[i]) w.trees[i].hp = hp;
  for (const i of s.go || []) w.breakProp(i);
  for (const h of s.ho || []) w.addHole(...h);
  for (const i of s.op || []) w.openCase?.(i);
  if (gm.known) for (const k of s.kn || []) gm.known.add(k);
  if ((s.locs || 0) < 3) w.spawnLoot?.((s.locs || 0) + 1);      // a game saved before some of the places existed: lay out what lies there
  if (s.en) endsLoad(gm, s.en);
  if (s.dm) dailyLoad(gm, s.dm);
  if (s.wa) watchLoad(gm, s.wa);
  if (s.dn) denLoad(gm, s.dn);
  if (Array.isArray(s.rp)) gm.ropes = s.rp;
  if (Array.isArray(s.dy)) gm.diary = s.dy;                // a game saved before the tail section and the camp existed: lay out what lies there
  for (const a of s.props || []) {
    const o = w.props[a[0]];
    if (!o || o.gone) continue;
    o.hp = a[8] ?? o.hp;
    o.mesh.position.set(a[1], a[2], a[3]); o.mesh.quaternion.set(a[4], a[5], a[6], a[7]);
    o.body.setTranslation({ x: a[1], y: a[2], z: a[3] }, true); o.body.setRotation({ x: a[4], y: a[5], z: a[6], w: a[7] }, true);
    o.body.setLinvel({ x: 0, y: 0, z: 0 }, true); o.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

// ---------- a player's own things ----------
export function playerRecord(gm) {
  const p = gm.player, inv = gm.inv;
  return {
    name: S.name, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], yaw: r2(p.yaw), heat: Math.round(p.heat), out: gm.escaped && !gm.inCab ? 1 : 0,
    hu: Math.round(p.hunger ?? 75), th: Math.round(p.thirst ?? 65),
    sel: inv.sel, coat: inv.coat || 0, slots: inv.slots.map(s => (s ? [s.type, s.n, r2(s.dry ?? 1)] : 0)),
    ...(gm.life ? lifeRecord(gm) : {}),
    ...(gm.ob ? { ob: objRecord(gm) } : {}), ...(gm.explored ? mapRecord(gm) : {}),
  };
}
// put a record back on. Returns true if it also put you where you were (false: the caller picks a place)
export function restorePlayer(gm, rec, TYPES) {
  const p = gm.player, inv = gm.inv;
  inv.slots = inv.slots.map((_, i) => { const s = rec.slots?.[i]; return s && TYPES[s[0]] ? { type: s[0], n: s[1], dry: s[2] ?? 1 } : null; });
  inv.sel = Math.min(4, Math.max(0, rec.sel | 0)); inv.coat = TYPES[rec.coat]?.wear ? rec.coat : null; inv.ver++;
  p.heat = Math.min(100, Math.max(0, +rec.heat || 50));
  if (rec.hu != null) p.hunger = Math.min(100, Math.max(0, +rec.hu)); if (rec.th != null) p.thirst = Math.min(100, Math.max(0, +rec.th));
  if (gm.life) lifeRestore(gm, rec);
  if (gm.ob) objRestore(gm, rec.ob);
  if (gm.explored) mapRestore(gm, rec);
  if (!rec.out || !Array.isArray(rec.p)) return false;
  p.teleport(rec.p[0], rec.p[1] + 0.1, rec.p[2]); p.yaw = +rec.yaw || 0;
  return true;
}
