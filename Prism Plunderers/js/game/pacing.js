// Difficulty and pacing (part 11, DESIGN 19): hard but fair at the start, harder the longer you play.
// The threat level comes from how many raids you have finished (P.stats.raids):
//   0 Fresh   raids 1-2   the red zone round the plaza is sealed (its Prism sleep; stay inside and the jamming field
//                         hurts you); the supply drop can save you
//   1 Known   raids 3-6   the red zone and its Roach are open; the supply drop still comes
//   2 Hunted  raids 7-12  patrols fly with one more Fly, a Fink's drop pod brings one more Fly
//   3 Marked  raid 13 on  patrols and guards get one more Fly, drop pods bring a second Swatter
// The supply drop: in your first 5 raids, once a raid, when you are under 30 % health with nothing to heal with, a
// crate with a medkit and a stim comes down a few metres in front of you.
import { P } from '../core/save.js';
import { REINFORCEMENTS } from './prism/defs.js';

export const TIERS = [
  { name: 'Fresh', from: 0, text: 'The red zone is sealed while you learn the city.' },
  { name: 'Known', from: 2, text: 'The red zone and its Roach are open.' },
  { name: 'Hunted', from: 6, text: 'More Flies on patrol and in the drop pods.' },
  { name: 'Marked', from: 12, text: 'The Prism know you: bigger patrols, guards and drop pods.' },
];
export const PACE = { redOpen: 2, safetyRaids: 5, safetyBelow: 0.3, redGrace: 4, redDps: 25 };

export function threat(raids = P.stats.raids) {
  let tier = 0;
  for (let i = 0; i < TIERS.length; i++) if (raids >= TIERS[i].from) tier = i;
  return { tier, ...TIERS[tier], raids, redLocked: raids < PACE.redOpen, safety: raids < PACE.safetyRaids, next: TIERS[tier + 1] || null };
}

// the map's Prism groups for this threat level (a copy: the layout stays as built)
export function scaleGroups(groups, t = threat()) {
  return groups.filter(g => !(t.redLocked && g.zone === 'red')).map(g => {
    const extra = g.kind === 'patrol' ? (t.tier >= 2 ? 1 : 0) : g.kind === 'guard' ? (t.tier >= 3 ? 1 : 0) : 0;
    return extra ? { ...g, members: [...g.members, ...Array(extra).fill('fly')] } : g;
  });
}
// what a Fink's drop pod brings
export function podTypes(t = threat()) {
  return [...REINFORCEMENTS, ...(t.tier >= 2 ? ['fly'] : []), ...(t.tier >= 3 ? ['swatter'] : [])];
}
// should the supply drop come now
export function needsSupply(p, used, t = threat()) {
  if (!t.safety || used || p.dead) return false;
  if (p.health >= p.maxHealth * PACE.safetyBelow) return false;
  const inv = p.inv, has = s => s && (s.id === 'medkit' || s.id === 'stim');
  return !(inv.quick.some(has) || inv.bag.some(has) || inv.safe.some(has));
}
