// The skill tree (part 9, DESIGN 7.3): three paths, each a chain of nodes bought with skill points in order.
// Skill points come from raids: 2 for getting out, 1 for a raid you survived at least 5 minutes of, and 1 for every
// 10 Prism destroyed (at most 3). What the bought nodes do goes into the raider's numbers (stats.js playerStats).
// The uniques Phase Step and Ghost Scan are shown but not built yet (they need their own controls); Overclock Heart is.
import { P, saveProfile } from '../core/save.js';

// mods: what a node adds (sprint, regen, rollCost and the hold / use / reload times multiply; health and stamina add)
export const PATHS = [
  { id: 'mobility', name: 'Mobility', color: '#5ad1ff', nodes: [
    { id: 'm1', name: 'Light Feet', cost: 1, text: 'Sprint 6 % faster.', mods: { sprint: 1.06 } },
    { id: 'm2', name: 'Second Wind', cost: 1, text: 'Stamina comes back 20 % faster.', mods: { regen: 1.2 } },
    { id: 'm3', name: 'Tumble', cost: 2, text: 'The dodge roll costs 30 % less stamina.', mods: { rollCost: 0.7 } },
    { id: 'm4', name: 'Long Legs', cost: 2, text: 'Sprint another 6 % faster.', mods: { sprint: 1.06 } },
    { id: 'm5', name: 'Phase Step', cost: 3, text: 'A short blink through danger. Coming in a later update.', unique: true, later: true },
  ] },
  { id: 'conditioning', name: 'Conditioning', color: '#ff7a6a', nodes: [
    { id: 'c1', name: 'Tough', cost: 1, text: '50 more health.', mods: { health: 50 } },
    { id: 'c2', name: 'Big Lungs', cost: 1, text: '20 more stamina.', mods: { stamina: 20 } },
    { id: 'c3', name: 'Quick Hands', cost: 2, text: 'Reload 15 % faster.', mods: { reload: 0.85 } },
    { id: 'c4', name: 'Tougher', cost: 2, text: 'Another 50 more health.', mods: { health: 50 } },
    { id: 'c5', name: 'Overclock Heart', cost: 3, text: 'While your shield holds, you heal 3 health a second (half that below 30 % health).', unique: true, mods: { heart: 3 } },
  ] },
  { id: 'survival', name: 'Survival', color: '#7ee08a', nodes: [
    { id: 's1', name: 'Light Fingers', cost: 1, text: 'Search containers and call the pick-up 20 % faster.', mods: { hold: 0.8 } },
    { id: 's2', name: 'Field Medic', cost: 1, text: 'Heals and shield tools take 20 % less time.', mods: { use: 0.8 } },
    { id: 's3', name: 'Steady', cost: 2, text: 'Searching and the pick-up another 15 % faster.', mods: { hold: 0.85 } },
    { id: 's4', name: 'Patched Up', cost: 2, text: 'Heals and shield tools another 15 % faster.', mods: { use: 0.85 } },
    { id: 's5', name: 'Ghost Scan', cost: 3, text: 'Shows the Prism near you for a moment. Coming in a later update.', unique: true, later: true },
  ] },
];
const ALL = PATHS.flatMap(p => p.nodes.map((n, i) => ({ ...n, path: p, i })));
export const owned = id => !!P.skills.nodes[id];
// can it be bought now: the one before it in its path is owned, enough points, built
export function canBuy(id) {
  const n = ALL.find(q => q.id === id);
  if (!n || n.later || owned(id) || P.skills.points < n.cost) return false;
  return n.i === 0 || owned(n.path.nodes[n.i - 1].id);
}
export function buySkill(id) {
  if (!canBuy(id)) return false;
  const n = ALL.find(q => q.id === id);
  P.skills.points -= n.cost;
  P.skills.nodes[id] = 1;
  saveProfile();
  return true;
}
// all the points back (free while the tree is young)
export function resetSkills() {
  let back = 0;
  for (const n of ALL) if (owned(n.id)) back += n.cost;
  P.skills.nodes = {};
  P.skills.points += back;
  saveProfile();
  return back;
}
// what the owned nodes add up to
export function skillMods() {
  const m = { sprint: 1, regen: 1, rollCost: 1, reload: 1, hold: 1, use: 1, health: 0, stamina: 0, heart: 0 };
  for (const n of ALL) if (owned(n.id) && n.mods) for (const [k, v] of Object.entries(n.mods)) {
    if (k === 'health' || k === 'stamina' || k === 'heart') m[k] += v; else m[k] *= v;
  }
  return m;
}
// the points a raid earns
export function raidPoints(result, time, kills) {
  return (result === 'extracted' ? 2 : 0) + (result !== 'extracted' && result !== 'left' && time >= 300 ? 1 : 0) + Math.min(3, Math.floor(kills / 10));
}
