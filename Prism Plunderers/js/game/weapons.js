// What the raider holds and does with it: the slot in the hands (1, 2, 3, H), switching, firing (semi-auto
// or automatic) with spread and bloom, reloading from the ammo you carry, the crowbar's swing, throwing a
// grenade, and using quick items (medkits, stims, repair kits, shield cells), which takes time and is stopped
// by a hit, a roll or a slide.
//
// It runs in fixed steps right after stepPlayer and reads only the command. All of its state is plain data:
// p.wpn (below) and p.using. ctx = { phys, director, rnd }.
//
// A shot goes from the camera through the crosshair to find what you aim at, then from the gun to that point,
// so a wall right next to you still blocks it. Hits go through damageRobot, the robots' one damage door.
import { ITEMS } from './items.js';
import { count, take, getAt, setAt } from './inventory.js';
import { damageRobot } from './prism/robot.js';
import { heal, restoreShield, shieldFull } from './damage.js';
import { fwdX, fwdZ } from './move-math.js';
import { G } from '../core/physics.js';
import { bus } from '../core/events.js';

export const SWITCH = 0.21;            // seconds to put the held thing away, and again to take the next one out
export const GRENADE_READY = 0.22;     // taking a grenade out of its pouch
export const THROW = { release: 0.3, end: 0.62 };
export const MELEE_CONE = 50;          // degrees either side of where you look
const MAX_BLOOM = 4;                   // degrees of extra spread from firing fast
const BLOOM_BACK = 7;                  // degrees per second it settles back
const SEMI_BUFFER = 0.15;              // a click this long before the gun is ready still fires
const DEG = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// the weapon state on the player (createPlayer, respawn)
export const newWeaponState = () => ({
  active: 'weapon1',                   // weapon1 | weapon2 | melee | unarmed | throw
  want: null, outT: 0, inT: 0,         // switching: the slot coming next, time left putting away / taking out
  reloadT: 0, reloadTime: 0,
  fireCd: 0, buf: 0, bloom: 0, shots: 0, shotT: 9,
  swingT: -1, swingHit: false,         // the melee swing (-1 = none)
  throwSlot: -1, throwT: -1, back: 'weapon1',   // a grenade in the hand: its quick slot, the throw, what to go back to
  dry: 0,
});

// the item in the hands and its definition, or null (unarmed, an empty slot, a grenade)
export function inHand(p) {
  const s = p.wpn.active;
  if (!p.inv || s === 'unarmed' || s === 'throw') return null;
  const it = p.inv.equip[s];
  return it ? { it, def: ITEMS[it.id], slot: s } : null;
}
export const switching = p => p.wpn.outT > 0 || p.wpn.inT > 0;
// the item in a slot (for the HUD and the model), even while it is not in the hands
export function slotItem(p, s) { return p.inv && s && s !== 'unarmed' && s !== 'throw' ? p.inv.equip[s] : null; }

// how wide the shots go right now, in degrees: wider from the hip, while moving, in the air, and as you keep firing
export function spreadOf(p, W) {
  let s = p.aiming ? W.spreadAim : W.spreadHip;
  s += p.wpn.bloom * (p.aiming ? 0.45 : 1);
  s += Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4.5) * (p.aiming ? 0.35 : 0.9);
  if (!p.grounded) s += 1.5;
  if (p.crouch) s *= 0.8;
  return s;
}

// the gun's muzzle in the simulation: in the raider's right hands, roughly (the model has the exact one)
export function muzzleOf(p) {
  const fx = fwdX(p.facing), fz = fwdZ(p.facing), rx = -fz, rz = fx;
  const h = inHand(p), reach = h && h.def.model === 'carbine' ? 0.75 : 0.55;
  return { x: p.pos.x + rx * 0.2 + fx * reach, y: p.pos.y + p.height * 0.75, z: p.pos.z + rz * 0.2 + fz * reach };
}

// ---------- one simulation step ----------
export function stepWeapons(p, cmd, dt, ctx) {
  const w = p.wpn;
  w.fireCd -= dt; w.shotT += dt; w.dry = Math.max(0, w.dry - dt);
  w.bloom = Math.max(0, w.bloom - BLOOM_BACK * dt);
  w.buf = cmd.firePressed ? SEMI_BUFFER : Math.max(0, w.buf - dt);
  if (p.mode === 'dead' || p.mode === 'down' || !p.inv) {
    w.reloadT = 0; w.swingT = -1; w.throwT = -1; w.outT = w.inT = 0; w.want = null;
    if (w.active === 'throw') w.active = w.back;
    p.using = null; w.fireCd = Math.max(0, w.fireCd);
    return;
  }
  if (cmd.slot && cmd.slot !== (w.want || w.active)) startSwitch(p, cmd.slot);
  if (cmd.quick >= 0) quickUse(p, cmd.quick);

  // switching: first the held thing goes away, then the next comes out
  if (w.outT > 0) {
    w.outT = Math.max(0, w.outT - dt);
    if (w.outT <= 0) { w.active = w.want || w.active; w.inT = hasItem(p, w.active) ? SWITCH : 0; if (!w.inT) w.want = null; }
  } else if (w.inT > 0) {
    w.inT = Math.max(0, w.inT - dt);
    if (w.inT <= 0) w.want = null;
  }
  if (p.using) stepUsing(p, dt);

  const busy = switching(p) || !!p.using || p.mode !== 'move';
  if (w.active === 'throw') { stepThrow(p, cmd, dt, ctx, busy); return; }

  const h = inHand(p);
  if (!h) { w.reloadT = 0; w.swingT = -1; w.fireCd = Math.max(0, w.fireCd); return; }
  if (h.def.weapon) stepGun(p, cmd, dt, ctx, h, busy);
  else if (h.def.melee) stepMelee(p, cmd, dt, ctx, h, busy);
}

const hasItem = (p, s) => !!slotItem(p, s);

// ---------- switching ----------
export function startSwitch(p, slot) {
  const w = p.wpn;
  cancelReload(p);
  w.swingT = -1;
  if (p.using) stopUse(p);
  if (w.active === 'throw') { w.active = 'unarmed'; w.throwT = -1; w.throwSlot = -1; w.inT = 0; }   // the grenade goes back in its pouch
  if (slot === w.active) {
    if (w.outT > 0) { w.inT = Math.max(0, SWITCH - w.outT); w.outT = 0; }   // changed your mind: it comes back out
    w.want = null;
    return;
  }
  w.want = slot;
  // what is in the hands goes away first (from wherever it is); with empty hands the next thing comes out at once
  if (w.outT > 0) { /* already putting something away: the new choice comes after it */ }
  else if (w.inT > 0) { w.outT = SWITCH - w.inT; w.inT = 0; }
  else if (inHand(p)) w.outT = SWITCH;
  if (w.outT <= 0) { w.outT = 0; w.active = slot; w.inT = hasItem(p, slot) ? SWITCH : 0; if (!w.inT) w.want = null; }
  bus.emit('wpn:switch', p, slot);
}

// ---------- guns ----------
function stepGun(p, cmd, dt, ctx, h, busy) {
  const w = p.wpn, W = h.def.weapon, it = h.it;
  if (w.reloadT > 0) {
    if (p.mode === 'roll') cancelReload(p);             // a dodge roll drops the reload
    else {
      w.reloadT -= dt;
      if (w.reloadT <= 0) finishReload(p, it, W);
    }
  }
  if (cmd.reload && w.reloadT <= 0 && !busy) startReload(p, it, W);
  const pull = W.mode === 'auto' ? cmd.fire : w.buf > 0;
  const can = !busy && w.reloadT <= 0 && !p.sprinting && !!cmd.aimD;
  if (pull && can) {
    if (it.d.ammo <= 0) {
      if (cmd.firePressed) { w.dry = 0.25; bus.emit('wpn:dry', p, it.id); startReload(p, it, W); }
      w.buf = 0;
    } else {
      let n = 0;
      while (w.fireCd <= 0 && it.d.ammo > 0 && n < 3) {
        w.fireCd += W.interval;
        shoot(p, cmd, ctx, W, it);
        n++;
        if (W.mode === 'semi') { w.buf = 0; break; }
      }
      if (it.d.ammo <= 0 && count(p.inv, W.ammo) > 0) startReload(p, it, W);   // empty: reload by itself
    }
  }
  if (!pull || !can) w.fireCd = Math.max(0, w.fireCd);
}

export function startReload(p, it, W) {
  const w = p.wpn;
  if (w.reloadT > 0 || it.d.ammo >= W.mag) return false;
  if (count(p.inv, W.ammo) <= 0) { bus.emit('wpn:noammo', p, it.id); return false; }
  w.reloadT = w.reloadTime = W.reload * (p.stats?.reload ?? 1);        // (the skill tree's Quick Hands)
  bus.emit('wpn:reload', p, it.id);
  return true;
}
function finishReload(p, it, W) {
  const w = p.wpn;
  w.reloadT = 0;
  const got = take(p.inv, W.ammo, W.mag - it.d.ammo);
  it.d.ammo += got;
  bus.emit('wpn:reloaded', p, it.id, got);
}
export function cancelReload(p) { if (p.wpn.reloadT > 0) { p.wpn.reloadT = 0; bus.emit('wpn:reloadstop', p); } }

function shoot(p, cmd, ctx, W, it) {
  const w = p.wpn;
  it.d.ammo -= 1;
  w.shots++; w.shotT = 0;
  const s = Math.tan(spreadOf(p, W) * DEG);
  w.bloom = Math.min(MAX_BLOOM, w.bloom + W.bloom);
  const r = ctx.rnd;
  let dx = cmd.aimD.x + (r() + r() - 1) * s, dy = cmd.aimD.y + (r() + r() - 1) * s, dz = cmd.aimD.z + (r() + r() - 1) * s;
  const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const d = { x: dx, y: dy, z: dz };
  // start the ray level with the player, so nothing between them and the camera is hit
  const o = cmd.aimO, cx = p.pos.x - o.x, cy = p.pos.y + 1.35 - o.y, cz = p.pos.z - o.z;
  const k = Math.max(0, cx * dx + cy * dy + cz * dz);
  const start = { x: o.x + dx * k, y: o.y + dy * k, z: o.z + dz * k };
  let hit = ctx.director.shoot(start, d, W.range);
  // then from the gun to that point
  const m = muzzleOf(p);
  const tx = hit.point.x - m.x, ty = hit.point.y - m.y, tz = hit.point.z - m.z, tl = Math.hypot(tx, ty, tz);
  if (tl > 0.05) {
    const md = { x: tx / tl, y: ty / tl, z: tz / tl };
    const b = ctx.phys.ray(m, md, Math.max(0, tl - 0.05), G.WORLD);
    if (b) hit = { robot: null, part: null, wall: true, point: { x: m.x + md.x * b.t, y: m.y + md.y * b.t, z: m.z + md.z * b.t } };
  }
  let res = null;
  if (hit.robot) res = damageRobot(hit.robot, hit.part, W.damage, ctx.director.ctx, { id: p.id, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } });
  ctx.director.hear(p.pos, W.noise, 0.35);
  bus.emit('wpn:shot', p, { muzzle: m, point: hit.point, res, wall: !!hit.wall, id: it.id, recoil: W.recoil });
}

// ---------- the crowbar ----------
function stepMelee(p, cmd, dt, ctx, h, busy) {
  const w = p.wpn, M = h.def.melee;
  if (w.swingT >= 0) {
    w.swingT += dt;
    if (!w.swingHit && w.swingT >= M.hitAt) { w.swingHit = true; meleeHit(p, M, ctx); }
    if (w.swingT >= M.swing) w.swingT = -1;
  }
  if (w.swingT < 0 && !busy && !p.sprinting && (cmd.firePressed || cmd.fire)) {
    w.swingT = 0; w.swingHit = false;
    bus.emit('wpn:swing', p, h.it.id);
  }
}
function meleeHit(p, M, ctx) {
  const yaw = p.look.yaw;
  const o = { x: p.pos.x, y: p.pos.y + p.height * 0.7, z: p.pos.z };
  const hit = ctx.director.meleeHit(o, { x: fwdX(yaw), z: fwdZ(yaw) }, M.reach, Math.cos(MELEE_CONE * DEG));
  let res = null;
  if (hit) res = damageRobot(hit.robot, hit.part, M.damage, ctx.director.ctx, { id: p.id, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } });
  ctx.director.hear(p.pos, 7, 0.25);
  bus.emit('wpn:melee', p, hit, res);
}

// ---------- grenades ----------
function startThrow(p, i) {
  const w = p.wpn;
  if (w.active === 'throw') {                          // the same grenade again: put it back
    if (w.throwSlot === i && w.throwT < 0) { endThrow(p); return; }
    if (w.throwT >= 0) return;
  }
  cancelReload(p);
  w.swingT = -1;
  if (p.using) stopUse(p);
  if (w.active !== 'throw') w.back = w.want || w.active;
  w.active = 'throw'; w.want = null; w.outT = 0;
  w.throwSlot = i; w.throwT = -1;
  w.inT = GRENADE_READY;
  bus.emit('wpn:switch', p, 'throw');
}
function endThrow(p) {
  const w = p.wpn, back = w.back || 'unarmed';
  w.active = back; w.throwT = -1; w.throwSlot = -1; w.want = null; w.outT = 0;
  w.inT = hasItem(p, back) ? SWITCH : 0;
  bus.emit('wpn:switch', p, back);
}
function stepThrow(p, cmd, dt, ctx, busy) {
  const w = p.wpn, it = p.inv.quick[w.throwSlot];
  if (w.throwT < 0) {
    if (!it || !ITEMS[it.id].throw) { endThrow(p); return; }     // moved away in the inventory
    if (cmd.firePressed && !busy && !p.sprinting) { w.throwT = 0; bus.emit('wpn:throwstart', p); }
    return;
  }
  const before = w.throwT;
  w.throwT += dt;
  if (before < THROW.release && w.throwT >= THROW.release) {
    if (it && ITEMS[it.id].throw) {
      const T = ITEMS[it.id].throw, l = grenadeLaunch(p, T);
      it.n -= 1;
      if (it.n <= 0) p.inv.quick[w.throwSlot] = null;
      ctx.director.throwGrenade(l.o, l.v, T, { id: p.id, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } });
      bus.emit('wpn:throw', p);
    }
  }
  if (w.throwT >= THROW.end) endThrow(p);
}
// where and how fast a grenade leaves the hand: a little above the crosshair, plus some of your own speed
export function grenadeLaunch(p, T) {
  const yaw = p.look.yaw, pitch = clamp(p.look.pitch + 0.16, -0.7, 1.25);
  const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
  const fx = fwdX(p.facing), fz = fwdZ(p.facing), rx = -fz, rz = fx;
  const o = { x: p.pos.x + fx * 0.35 + rx * 0.12, y: p.pos.y + p.height * 0.92, z: p.pos.z + fz * 0.35 + rz * 0.12 };
  const v = { x: dx * T.speed + p.vel.x * 0.5, y: dy * T.speed + Math.max(0, p.vel.y) * 0.3, z: dz * T.speed + p.vel.z * 0.5 };
  return { o, v };
}

// ---------- using items ----------
// why an item cannot be used right now, or null
export function cannotUse(p, id) {
  const def = ITEMS[id], u = def && def.use;
  if (!u) return 'This cannot be used';
  if (u.shield) {
    if (!p.shield) return 'No shield equipped';
    if (!u.shield.includes(p.shield.type)) return `A ${def.name} does not fit a ${p.shield.type} shield`;
    if (shieldFull(p)) return 'The shield is full';
    return null;
  }
  if (u.heal && p.health >= p.maxHealth - 0.5 && !(u.stamina && p.stamina < p.maxStamina - 1)) return 'Health is full';
  return null;
}
function quickUse(p, i) {
  const it = p.inv.quick[i];
  if (!it) { bus.emit('use:denied', p, 'Nothing in that slot'); return; }
  if (ITEMS[it.id].throw) { startThrow(p, i); return; }
  startUse(p, { a: 'quick', i });
}
// starts using the item in a slot (the item wheel, or the inventory). Returns true when it started.
export function startUse(p, ref) {
  const it = getAt(p.inv, ref);
  if (!it || p.dead) return false;
  const why = p.mode !== 'move' ? 'Not while moving like this' : cannotUse(p, it.id);
  if (why) { bus.emit('use:denied', p, why, it.id); return false; }
  if (p.using && p.using.ref.a === ref.a && p.using.ref.i === ref.i) return false;
  if (p.using) stopUse(p);
  cancelReload(p);
  p.wpn.swingT = -1;
  if (p.wpn.active === 'throw' && p.wpn.throwT < 0) endThrow(p);
  p.using = { ref: { a: ref.a, i: ref.i }, id: it.id, t: 0, time: ITEMS[it.id].use.time * (p.stats?.use ?? 1) };   // (Field Medic)
  bus.emit('use:start', p, p.using);
  return true;
}
export function stopUse(p) {
  if (!p.using) return;
  const u = p.using;
  p.using = null;
  bus.emit('use:stopped', p, u);
}
function stepUsing(p, dt) {
  const u = p.using, it = getAt(p.inv, u.ref);
  if (!it || it.id !== u.id || p.mode !== 'move') { stopUse(p); return; }
  u.t += dt;
  if (u.t < u.time) return;
  const U = ITEMS[u.id].use;
  if (U.heal) heal(p, U.heal);
  if (U.stamina) { p.stamina = Math.min(p.maxStamina, p.stamina + U.stamina); p.winded = false; }
  if (U.shield) restoreShield(p);
  it.n -= 1;
  if (it.n <= 0) setAt(p.inv, u.ref, null);
  p.using = null;
  bus.emit('use:done', p, u.id);
}
