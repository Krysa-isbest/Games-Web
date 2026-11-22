// The raider's simulation: running, sprinting and stamina, jumping (with coyote time and a jump buffer),
// crouching (it will not stand up under a low ceiling), sliding, the dodge roll, falling and fall damage, dying,
// and using things. It runs in fixed steps and reads only an input snapshot (controls.js).
//
// All state is plain data on the player object, so it can be sent over the network later. The physics handles
// (Rapier body, collider, character controller) live in a hidden `phys` field that JSON leaves out.
import { MOVE, BODY, STAMINA, ROLL, SLIDE, FALL, SHIELDS, playerStats } from './stats.js';
import { G, groups } from '../core/physics.js';
import { applyDamage } from './damage.js';
import { bus } from '../core/events.js';
import { fwdX, fwdZ, yawOf, angDiff, approach } from './move-math.js';
import { makeInventory, loseOnDeath, syncShield, weight, MAX_WEIGHT } from './inventory.js';
import { newWeaponState } from './weapons.js';

export { fwdX, fwdZ, yawOf, angDiff };
const MOVE_GROUPS = groups(G.PLAYER, G.WORLD | G.ENEMY);     // walls and the Prism's bodies block you
const DOWN = { x: 0, y: -1, z: 0 };
const COS_CLIMB = Math.cos(MOVE.slope * Math.PI / 180);

export function createPlayer({ id = 'p0', name = 'Plunderer', spawn = { x: 0, y: 0, z: 0, yaw: 0 }, stats = playerStats() } = {}) {
  const yaw = spawn.yaw || 0;
  return {
    id, name, stats,
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },           // the feet
    prev: { x: spawn.x, y: spawn.y, z: spawn.z },          // last step, for drawing in between steps
    vel: { x: 0, y: 0, z: 0 },
    facing: yaw, prevFacing: yaw, turn: 0,                 // where the body points, and how fast it turns
    look: { yaw, pitch: 0 },                               // where the camera looks (from the last command)
    mode: 'move',                                          // move | slide | roll | dead
    grounded: false, airT: 0, coyote: 0, jumpBuf: 0,
    crouch: false, height: BODY.stand,
    sprinting: false, aiming: false, moving: false,
    stamina: stats.maxStamina, maxStamina: stats.maxStamina, staminaDelay: 0, winded: false, noStamina: 0,
    rollT: 0, rollDir: { x: 0, z: -1 }, rollCd: 0,
    slideT: 0, slideCd: 0,
    iframes: 0,                                            // > 0 while the roll's dodge window is open
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    shield: null,                                          // { type, hp, broken } (damage.js)
    dead: false, deathT: 0, deathCause: '',
    landT: 9, landPower: 0, stagger: 0,
    hurtT: 9, lastHit: null,
    focus: null, focusText: '', focusHold: 0, use: null, useLatch: false,
    firing: false,                                         // the fire button is held with a weapon in hand
    emp: 0,                                                // > 0 while a Roach's EMP keeps the shield offline
    god: false,                                            // the test range's "invincible" switch
    inv: makeInventory(),                                  // everything you carry (inventory.js)
    wpn: newWeaponState(),                                 // what is in the hands (weapons.js)
    using: null,                                           // an item being used: { ref, id, t, time }
    overweight: false,
  };
}

// ---------- the physics body ----------
export function attachBody(p, phys) {
  const R = phys.R, w = phys.world;
  const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.pos.x, p.pos.y + p.height / 2, p.pos.z));
  const col = w.createCollider(R.ColliderDesc.capsule(halfHeight(p.height), BODY.radius).setCollisionGroups(groups(G.PLAYER, G.WORLD | G.ENEMY)), body);
  const ctl = w.createCharacterController(BODY.offset);
  ctl.setUp({ x: 0, y: 1, z: 0 });
  ctl.setMaxSlopeClimbAngle(MOVE.slope * Math.PI / 180);
  ctl.setMinSlopeSlideAngle((MOVE.slope + 4) * Math.PI / 180);
  ctl.enableAutostep(MOVE.step, 0.2, false);
  ctl.enableSnapToGround(0.35);
  ctl.setApplyImpulsesToDynamicBodies(false);
  ctl.setSlideEnabled(true);
  Object.defineProperty(p, 'phys', { value: { phys, body, col, ctl, height: p.height }, enumerable: false, writable: true, configurable: true });
}
export function detachBody(p) {
  const ph = p.phys;
  if (!ph) return;
  ph.phys.world.removeCharacterController(ph.ctl);
  ph.phys.world.removeRigidBody(ph.body);
  p.phys = null;
}
const halfHeight = h => Math.max(0.01, (h - 2 * BODY.radius) / 2);
function fits(p, h) {
  return p.phys.phys.free({ x: p.pos.x, y: p.pos.y + h / 2 + 0.03, z: p.pos.z }, halfHeight(h), BODY.radius - 0.02);
}
function setHeight(p, h) {
  const ph = p.phys;
  if (Math.abs(ph.height - h) < 1e-4) return;
  ph.col.setHalfHeight(halfHeight(h));
  ph.height = p.height = h;
  ph.body.setTranslation({ x: p.pos.x, y: p.pos.y + h / 2, z: p.pos.z }, true);
  ph.phys.world.propagateModifiedBodyPositionsToColliders();
}
// puts the player somewhere at once (spawn, respawn)
export function teleport(p, x, y, z, yaw = p.facing) {
  p.pos.x = p.prev.x = x; p.pos.y = p.prev.y = y; p.pos.z = p.prev.z = z;
  p.vel.x = p.vel.y = p.vel.z = 0;
  p.facing = p.prevFacing = yaw;
  if (p.phys) {
    p.phys.body.setTranslation({ x, y: y + p.height / 2, z }, true);
    p.phys.phys.world.propagateModifiedBodyPositionsToColliders();
  }
}

// ---------- one simulation step ----------
// ctx = { phys, items (Interactions, optional) }
export function stepPlayer(p, cmd, dt, ctx) {
  p.prev.x = p.pos.x; p.prev.y = p.pos.y; p.prev.z = p.pos.z; p.prevFacing = p.facing;
  p.look.yaw = cmd.yaw; p.look.pitch = cmd.pitch;
  p.rollCd = Math.max(0, p.rollCd - dt); p.slideCd = Math.max(0, p.slideCd - dt);
  p.staminaDelay = Math.max(0, p.staminaDelay - dt); p.noStamina = Math.max(0, p.noStamina - dt);
  p.stagger = Math.max(0, p.stagger - dt);
  p.emp = Math.max(0, (p.emp || 0) - dt);
  p.landT += dt; p.hurtT += dt;
  if (p.dead && p.mode !== 'dead') die(p);
  const alive = p.mode !== 'dead';
  p.turn = 0;

  // where the stick points, in the world (camera relative)
  const fx = fwdX(cmd.yaw), fz = fwdZ(cmd.yaw);
  let wx = fx * cmd.my - fz * cmd.mx, wz = fz * cmd.my + fx * cmd.mx;
  let wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
  const input = alive && wl > 0.05;
  p.moving = input;
  const hs = Math.hypot(p.vel.x, p.vel.z);

  p.jumpBuf = cmd.jump && alive ? MOVE.buffer : Math.max(0, p.jumpBuf - dt);
  p.coyote = p.grounded ? MOVE.coyote : Math.max(0, p.coyote - dt);

  p.overweight = !!p.inv && weight(p.inv) > MAX_WEIGHT;
  if (alive) {
    p.aiming = !!cmd.aim && p.mode === 'move' && !p.using;
    p.firing = !!cmd.fire && p.mode === 'move' && armed(p) && !p.using;
    // dodge roll: on the ground, in the direction you push (or straight ahead)
    if (cmd.roll && p.mode !== 'roll' && p.grounded && p.rollCd <= 0) {
      if (spend(p, STAMINA.roll)) startRoll(p, input ? wx / wl : fwdX(p.facing), input ? wz / wl : fwdZ(p.facing));
      else deny(p);
    }
    // slide: crouch while sprinting fast on the ground
    if (cmd.crouchPressed && p.mode === 'move' && p.grounded && p.sprinting && hs >= SLIDE.minSpeed && p.slideCd <= 0) {
      if (spend(p, STAMINA.slide)) startSlide(p, hs); else deny(p);
    }
  } else { p.aiming = false; p.firing = false; }
  if (p.mode !== 'move') p.firing = false;

  // crouching: the capsule shrinks; it only grows back where there is room
  const wantCrouch = alive && !!cmd.crouch && p.mode === 'move';
  let h = p.mode === 'move' ? (wantCrouch ? BODY.crouch : BODY.stand) : BODY.low;
  if (h > p.height + 1e-4 && !fits(p, h)) h = h > BODY.crouch && p.height < BODY.crouch && fits(p, BODY.crouch) ? BODY.crouch : p.height;
  setHeight(p, h);
  p.crouch = p.mode === 'move' && p.height < BODY.stand - 0.01;

  // sprinting
  if (p.mode === 'move') {
    const want = alive && !!cmd.sprint && input && !p.aiming && !p.firing && !p.crouch && !p.winded && p.stamina > 0 && p.stagger <= 0 && !p.using && !p.overweight;
    if (p.grounded || !want) p.sprinting = want;         // a sprint carries on through a jump
  } else p.sprinting = false;

  // horizontal movement
  if (p.mode === 'move') {
    let speed = MOVE.jog;
    if (p.aiming) speed = p.crouch ? MOVE.aimCrouch : MOVE.aim;
    else if (p.crouch) speed = MOVE.crouch;
    else if (p.sprinting) speed = MOVE.sprint;
    if (p.aiming && input && (wx * fwdX(p.facing) + wz * fwdZ(p.facing)) / wl < -0.3) speed *= MOVE.back;
    if (p.stagger > 0) speed *= 0.45;
    if (p.using) speed *= 0.5;                                    // patching yourself up: a slow walk
    if (p.overweight) speed *= 0.8;                               // carrying more than you can
    const tx = input ? wx * speed : 0, tz = input ? wz * speed : 0;
    const k = p.grounded ? (tx * tx + tz * tz > hs * hs ? MOVE.accel : MOVE.decel) : MOVE.air;
    p.vel.x = approach(p.vel.x, tx, k, dt);
    p.vel.z = approach(p.vel.z, tz, k, dt);
    if (p.aiming || p.firing) turnTo(p, cmd.yaw, 22, dt);         // shooting turns you to where you aim
    else if (input) turnTo(p, yawOf(wx, wz), p.sprinting ? MOVE.turnSprint : MOVE.turn, dt);
  } else if (p.mode === 'roll') stepRoll(p, dt);
  else if (p.mode === 'slide') stepSlide(p, dt, wx, wz, input, ctx);
  else if (p.mode === 'dead') {
    p.deathT += dt;
    if (p.grounded) { p.vel.x = approach(p.vel.x, 0, 5, dt); p.vel.z = approach(p.vel.z, 0, 5, dt); }
  }

  // jumping
  if (alive && p.jumpBuf > 0 && p.coyote > 0 && (p.mode === 'move' || p.mode === 'slide') && p.vel.y <= 0.5) {
    if (p.stamina < STAMINA.jump) { if (cmd.jump) deny(p); }
    else if (p.height >= BODY.stand - 0.01 || fits(p, BODY.stand)) {
      if (p.mode === 'slide') endSlide(p);
      spend(p, STAMINA.jump);
      p.vel.y = MOVE.jump;
      p.grounded = false; p.coyote = 0; p.jumpBuf = 0; p.airT = 0;
      bus.emit('player:jump', p);
    }
  }

  // gravity
  if (p.grounded && p.vel.y <= 0) p.vel.y = -MOVE.stick;
  else p.vel.y = Math.max(-MOVE.terminal, p.vel.y - MOVE.gravity * dt);

  // move through the world
  const ph = p.phys;
  const want = { x: p.vel.x * dt, y: p.vel.y * dt, z: p.vel.z * dt };
  const vyBefore = p.vel.y, wasGrounded = p.grounded;
  let m = moveBy(ph, want);
  // The controller lets a character creep up slopes steeper than its limit. Look at the ground just ahead:
  // if it is too steep, take away the push into it and move again.
  if (m.y > 1e-4 && p.vel.y <= 0 && (want.x || want.z)) {
    const wl2 = Math.hypot(want.x, want.z), r = BODY.radius + 0.05;
    const g = ph.phys.ray({ x: p.pos.x + want.x / wl2 * r, y: p.pos.y + 1, z: p.pos.z + want.z / wl2 * r }, DOWN, 1.6, G.WORLD, true);
    if (g && g.ny > 0.05 && g.ny < COS_CLIMB) {
      const h = Math.hypot(g.nx, g.nz), nx = g.nx / h, nz = g.nz / h;
      const d = want.x * nx + want.z * nz;
      if (d < 0) { want.x -= d * nx; want.z -= d * nz; m = moveBy(ph, want); }
    }
  }
  p.grounded = m.grounded && p.vel.y <= 0;
  // standing on a slope that is too steep is not standing: you slide off it
  if (p.grounded) {
    const g = ph.phys.ray({ x: p.pos.x + m.x, y: p.pos.y + m.y + 0.4, z: p.pos.z + m.z }, DOWN, 0.7, G.WORLD, true);
    if (g && g.ny < COS_CLIMB) p.grounded = false;
  }
  p.pos.x += m.x; p.pos.y += m.y; p.pos.z += m.z;
  ph.body.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y + p.height / 2, z: p.pos.z });
  // a wall takes the speed away instead of letting it pile up (but not a ramp or a step: there the
  // forward movement turns partly into climbing, which is not being blocked)
  const wantH = Math.hypot(want.x, want.z), gotH = Math.hypot(m.x, m.z);
  if (wantH > 1e-5 && gotH < wantH * 0.5 && m.y <= want.y + 1e-3 && p.mode !== 'roll') { p.vel.x = m.x / dt; p.vel.z = m.z / dt; }
  if (want.y > 0 && m.y < want.y * 0.5) p.vel.y = 0;                       // bumped the head
  if (p.grounded) {
    if (!wasGrounded) land(p, -vyBefore);
    p.airT = 0;
    if (p.vel.y < 0) p.vel.y = -MOVE.stick;
  } else p.airT += dt;

  // stamina
  if (p.sprinting && p.grounded && Math.hypot(p.vel.x, p.vel.z) > 1) {
    p.stamina -= p.stats.sprintCost * dt;
    p.staminaDelay = STAMINA.delay;
    if (p.stamina <= 0) { p.stamina = 0; p.winded = true; p.sprinting = false; bus.emit('player:winded', p); }
  } else if (p.staminaDelay <= 0 && p.mode !== 'roll') p.stamina = Math.min(p.maxStamina, p.stamina + p.stats.regen * dt);
  if (p.winded && p.stamina >= STAMINA.recover) p.winded = false;

  if (ctx && ctx.items) stepUse(p, cmd, dt, ctx.items);
}

function moveBy(ph, want) {
  ph.ctl.computeColliderMovement(ph.col, want, undefined, MOVE_GROUPS);
  const m = ph.ctl.computedMovement();
  return { x: m.x, y: m.y, z: m.z, grounded: ph.ctl.computedGrounded() };
}
function turnTo(p, want, k, dt) {
  const d = angDiff(p.facing, want) * (1 - Math.exp(-k * dt));
  p.facing += d;
  p.turn = d / dt;
}
function spend(p, cost) {
  if (p.stamina + 1e-6 < cost) return false;
  p.stamina = Math.max(0, p.stamina - cost);
  p.staminaDelay = STAMINA.delay;
  if (p.stamina <= 1e-4) p.winded = true;
  return true;
}
function deny(p) { p.noStamina = 0.5; bus.emit('player:nostamina', p); }

function land(p, impact) {
  p.landT = 0;
  p.landPower = Math.min(1, Math.max(0, (impact - 3) / 12));
  if (impact > FALL.hard) p.stagger = 0.3;
  if (impact > FALL.safe) applyDamage(p, { amount: (impact - FALL.safe) * FALL.perMs, type: 'fall', source: 'A fall' });
  bus.emit('player:land', p, impact);
}

// is there something in the hands to fire or swing?
function armed(p) {
  const s = p.wpn && p.wpn.active;
  return s === 'throw' || (!!s && s !== 'unarmed' && !!p.inv && !!p.inv.equip[s]);
}
// a roll or a slide stops a medkit (or any item) halfway
function stopUsing(p) { if (p.using) { const u = p.using; p.using = null; bus.emit('use:stopped', p, u); } }

// ---------- dodge roll ----------
function startRoll(p, dx, dz) {
  stopUsing(p);
  p.mode = 'roll'; p.rollT = 0;
  p.rollDir.x = dx; p.rollDir.z = dz;
  p.facing = yawOf(dx, dz);
  p.sprinting = false; p.use = null;
  bus.emit('player:roll', p);
}
function stepRoll(p, dt) {
  p.rollT += dt;
  const t = Math.min(1, p.rollT / ROLL.time);
  const spd = ROLL.end + (ROLL.speed - ROLL.end) * Math.pow(1 - t, ROLL.curve);
  if (p.grounded || p.airT < 0.1) { p.vel.x = p.rollDir.x * spd; p.vel.z = p.rollDir.z * spd; }
  p.iframes = p.rollT >= ROLL.iFrom && p.rollT <= ROLL.iTo ? ROLL.iTo - p.rollT : 0;
  if (p.rollT >= ROLL.time) { p.mode = 'move'; p.rollCd = ROLL.cooldown; p.iframes = 0; }
}

// ---------- slide ----------
function startSlide(p, hs) {
  stopUsing(p);
  p.mode = 'slide'; p.slideT = 0;
  p.sprinting = false; p.use = null;
  const s = Math.max(hs, SLIDE.boost);
  const dx = hs > 0.1 ? p.vel.x / hs : fwdX(p.facing), dz = hs > 0.1 ? p.vel.z / hs : fwdZ(p.facing);
  p.vel.x = dx * s; p.vel.z = dz * s;
  bus.emit('player:slide', p);
}
function stepSlide(p, dt, wx, wz, input, ctx) {
  p.slideT += dt;
  // the slope pulls you downhill, or slows you uphill
  const n = p.grounded ? p.phys.phys.ray({ x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z }, DOWN, 0.9, G.WORLD, true) : null;
  if (n) { const a = MOVE.gravity * n.ny; p.vel.x += a * n.nx * dt; p.vel.z += a * n.nz * dt; }
  let hs = Math.hypot(p.vel.x, p.vel.z);
  const ns = Math.max(0, hs - SLIDE.friction * dt);
  if (hs > 1e-4) { p.vel.x *= ns / hs; p.vel.z *= ns / hs; }
  hs = ns;
  if (input && hs > 0.1) {                                 // a little steering
    const cur = yawOf(p.vel.x, p.vel.z), yaw = cur + angDiff(cur, yawOf(wx, wz)) * (1 - Math.exp(-SLIDE.steer * dt));
    p.vel.x = fwdX(yaw) * hs; p.vel.z = fwdZ(yaw) * hs;
  }
  if (hs > 0.3) turnTo(p, yawOf(p.vel.x, p.vel.z), 16, dt);
  const downhill = n && (p.vel.x * n.nx + p.vel.z * n.nz) > 0.02;
  if (hs < SLIDE.endSpeed || p.slideT > (downhill ? SLIDE.maxTimeDown : SLIDE.maxTime) || p.airT > 0.25) endSlide(p);
}
function endSlide(p) { p.mode = 'move'; p.slideCd = SLIDE.cooldown; }

// ---------- dying and coming back ----------
function die(p) {
  p.mode = 'dead'; p.deathT = 0;
  p.sprinting = false; p.aiming = false; p.iframes = 0; p.use = null;
  bus.emit('player:dead', p);
}
export function respawnPlayer(p, spawn) {
  p.dead = false; p.mode = 'move'; p.deathT = 0; p.deathCause = '';
  p.health = p.maxHealth; p.stamina = p.maxStamina; p.winded = false; p.staminaDelay = 0;
  p.rollT = 0; p.slideT = 0; p.iframes = 0; p.stagger = 0; p.landT = 9; p.hurtT = 9; p.use = null;
  p.emp = 0; p.firing = false; p.using = null; p.wpn = newWeaponState();
  if (p.inv) { loseOnDeath(p.inv); syncShield(p); }              // dying loses everything but the safe pocket
  else if (p.shield) { p.shield.hp = SHIELDS[p.shield.type].hp; p.shield.broken = false; }
  if (p.phys) setHeight(p, BODY.stand);
  teleport(p, spawn.x, spawn.y, spawn.z, spawn.yaw || 0);
  p.grounded = false;
  bus.emit('player:respawn', p);
}

// ---------- using things (interact key) ----------
function stepUse(p, cmd, dt, items) {
  if (!cmd.interact) p.useLatch = false;
  const it = p.mode === 'move' ? items.pick(p) : null;
  const text = it ? it.label(p) : null;
  if (!text) { p.focus = null; p.focusText = ''; p.focusHold = 0; p.use = null; return; }
  const hold = items.holdOf(it, p);
  p.focus = it.id; p.focusText = text; p.focusHold = hold;
  if (hold <= 0) {
    if (cmd.interactPressed) { it.use(p); bus.emit('player:use', p, it); }
    p.use = null;
    return;
  }
  if (cmd.interact && !p.useLatch && Math.hypot(p.vel.x, p.vel.z) < 1.5) {
    if (!p.use || p.use.id !== it.id) p.use = { id: it.id, t: 0, hold };
    p.use.t += dt;
    if (p.use.t >= hold) { it.use(p); bus.emit('player:use', p, it); p.use = null; p.useLatch = true; }
  } else p.use = null;
}
