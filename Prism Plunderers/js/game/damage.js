// Every hit in the game goes through applyDamage, for players now and for the Prism later. One door for all
// damage keeps the rules in one place and lets a co-op host own it.
//
//   applyDamage(target, { amount, type, from: {x,y,z}, source: 'Training sentry' })
//     → { health, shield, dodged, broke, killed }   (what was actually taken)
//
// Shield rule (DESIGN.md 7.2): while the shield holds, it takes the full hit, and your health takes the hit
// minus the shield's defence. If a hit is bigger than what is left of the shield, the rest lands on your
// health in full. A broken shield gives no defence until it is repaired or recharged.
import { SHIELDS } from './stats.js';
import { bus } from '../core/events.js';

const DODGEABLE = new Set(['bolt', 'laser', 'bullet', 'blast', 'melee', 'hit']);   // the dodge roll's window beats these
const BYPASS = new Set(['fall']);                                                   // falls hurt the body, not the shield

export function applyDamage(t, hit) {
  const r = { health: 0, shield: 0, dodged: false, broke: false, killed: false };
  if (!t || t.dead || !(hit.amount > 0)) return r;
  const type = hit.type || 'hit';
  if (t.iframes > 0 && DODGEABLE.has(type)) {
    r.dodged = true;
    bus.emit('damage', t, hit, r);
    return r;
  }
  let amount = hit.amount;
  const sh = t.shield;
  // an EMP (Roach) knocks the shield offline: it neither protects nor drains until it comes back
  if (sh && !sh.broken && !(t.emp > 0) && !BYPASS.has(type)) {
    const def = SHIELDS[sh.type].def;
    const covered = Math.min(amount, sh.hp);
    sh.hp -= covered;
    r.shield = covered;
    amount = covered * (1 - def) + (amount - covered);
    if (sh.hp <= 1e-6) { sh.hp = 0; sh.broken = true; r.broke = true; }
  }
  r.health = t.god ? 0 : Math.min(t.health, amount);             // god: the test range's invincible switch
  t.health -= r.health;
  t.hurtT = 0;
  t.lastHit = { type, source: hit.source || '', amount: hit.amount, from: hit.from ? { x: hit.from.x, y: hit.from.y, z: hit.from.z } : null };
  t.use = null;                          // taking damage stops whatever you were using (a station, a medkit...)
  if (t.using) { bus.emit('use:stopped', t, t.using); t.using = null; }
  if (t.health <= 1e-6) { t.health = 0; t.dead = true; t.deathCause = hit.source || type; r.killed = true; }
  bus.emit('damage', t, hit, r);
  return r;
}

export function heal(t, amount) {
  if (!t || t.dead) return 0;
  const h = Math.min(t.maxHealth - t.health, amount);
  if (h > 0) { t.health += h; bus.emit('heal', t, h); }
  return h;
}

// type: 'light' | 'medium' | 'heavy' | null (take it off). A new shield comes fully charged. With an inventory,
// the shield is the item in the equipment slot and the player's live shield is that item's own state.
export function equipShield(t, type) {
  const sh = type ? { type, hp: SHIELDS[type].hp, broken: false } : null;
  if (t.inv) t.inv.equip.shield = sh ? { id: 'shield_' + type, n: 1, d: sh } : null;
  t.shield = sh;
  bus.emit('shield', t, 'equip');
}

// a Repair Kit (light) or a Shield Cell (medium, heavy): back to full
export function restoreShield(t) {
  if (!t.shield) return false;
  t.shield.hp = SHIELDS[t.shield.type].hp;
  t.shield.broken = false;
  bus.emit('shield', t, 'restore');
  return true;
}

export const shieldFull = t => !!t.shield && !t.shield.broken && t.shield.hp >= SHIELDS[t.shield.type].hp - 1e-6;
