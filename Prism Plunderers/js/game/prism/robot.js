// What every Prism robot shares: its state (plain data, so a co-op host can send it), its physics body, its
// senses (sight, field of view, line of sight, awareness), movement for flyers and walkers, and damageRobot,
// the one door for all damage to robots.
import { PRISM } from './defs.js';
import { G, groups } from '../../core/physics.js';
import { bus } from '../../core/events.js';
import { fwdX, fwdZ, yawOf, angDiff } from '../move-math.js';

export const GRAVITY = 22;
const DOWN = { x: 0, y: -1, z: 0 };
const ROBOT_GROUPS = groups(G.ENEMY, G.WORLD | G.PLAYER);
const MOVE_FILTER = groups(G.ENEMY, G.WORLD | G.PLAYER);

export function makeRobot(id, type, pos, yaw, rnd) {
  const d = PRISM[type];
  const partHp = {}, broken = {};
  for (const p of d.parts) if (p.hp) { partHp[p.name] = p.hp; broken[p.name] = false; }
  return {
    id, type,
    pos: { x: pos.x, y: pos.y, z: pos.z }, prev: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw, prevYaw: yaw, pitch: 0,
    home: { x: pos.x, y: pos.y, z: pos.z },
    hp: d.hp, maxHp: d.hp, partHp, broken,
    state: 'idle', st: 0,                      // the current behaviour and how long it has lasted
    aware: 0, hostile: false, alertIn: -1,     // awareness of the player (0..1), and a delayed alert from a friend
    target: null, sees: false, dist: 99, lastSeen: null, unseen: 99,
    grounded: false, dead: false, deadT: 0, falling: false,
    hurtT: 9, flash: 0,
    seed: rnd(), phase: rnd() * Math.PI * 2,
    group: null,
    route: null, routeI: null, routeDir: 1, routeBack: false, routeOff: null, routeAlt: null, wait: 0,   // a patrol route (see below)
  };
}

// ---------- patrol routes ----------
// route = [{ x, z, y? }]: flown or walked while the robot is not after you (drone.js followRoute, roach.js wander)
export function routeStart(r) {
  let best = 0, bd = Infinity;
  r.route.forEach((w, i) => { const d = Math.hypot(w.x - r.pos.x, w.z - r.pos.z); if (d < bd) { bd = d; best = i; } });
  return best;
}
// the next waypoint: round the loop, or back and forth when r.routeBack is set
export function routeNext(r) {
  const n = r.route.length;
  if (n < 2) return 0;
  if (!r.routeBack) return (r.routeI + 1) % n;
  let i = r.routeI + r.routeDir;
  if (i >= n || i < 0) { r.routeDir = -r.routeDir; i = r.routeI + r.routeDir; }
  return i;
}

// ---------- physics ----------
export function attachRobotBody(r, phys) {
  const d = PRISM[r.type], R = phys.R, w = phys.world;
  const c = center(r);
  const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z));
  const shape = d.flyer || r.type === 'scatter' ? R.ColliderDesc.ball(d.radius) : R.ColliderDesc.capsule(0.15, d.radius);
  const col = w.createCollider(shape.setCollisionGroups(ROBOT_GROUPS), body);
  const ctl = w.createCharacterController(0.03);
  ctl.setUp({ x: 0, y: 1, z: 0 });
  if (!d.flyer) {
    ctl.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    ctl.enableAutostep(r.type === 'roach' ? 0.55 : 0.25, 0.2, false);
    ctl.enableSnapToGround(0.3);
  }
  ctl.setApplyImpulsesToDynamicBodies(false);
  Object.defineProperty(r, 'phys', { value: { phys, body, col, ctl }, enumerable: false, writable: true, configurable: true });
}
export function detachRobotBody(r) {
  const ph = r.phys;
  if (!ph) return;
  ph.phys.world.removeCharacterController(ph.ctl);
  ph.phys.world.removeRigidBody(ph.body);
  r.phys = null;
}
// the body centre: flyers keep their position there, walkers keep it at their feet
export function center(r) {
  const d = PRISM[r.type];
  return d.flyer ? { x: r.pos.x, y: r.pos.y, z: r.pos.z } : { x: r.pos.x, y: r.pos.y + d.center, z: r.pos.z };
}
// moves by r.vel * dt through the world, sliding along walls. Walkers fall; flyers only when falling.
export function moveRobot(r, dt) {
  const ph = r.phys;
  if (!ph) { r.pos.x += r.vel.x * dt; r.pos.y += r.vel.y * dt; r.pos.z += r.vel.z * dt; return; }
  const want = { x: r.vel.x * dt, y: r.vel.y * dt, z: r.vel.z * dt };
  ph.ctl.computeColliderMovement(ph.col, want, undefined, MOVE_FILTER);
  const m = ph.ctl.computedMovement();
  r.grounded = ph.ctl.computedGrounded();
  r.pos.x += m.x; r.pos.y += m.y; r.pos.z += m.z;
  if (Math.abs(m.y) < Math.abs(want.y) * 0.5 && want.y < 0) r.vel.y = 0;    // landed or resting on something
  const c = center(r);
  ph.body.setNextKinematicTranslation(c);
  r.blocked = Math.hypot(want.x, want.z) > 1e-4 && Math.hypot(m.x, m.z) < Math.hypot(want.x, want.z) * 0.3;
}

// ---------- steering ----------
const clampLen = (x, z, max) => { const l = Math.hypot(x, z); return l > max ? [x / l * max, z / l * max] : [x, z]; };
// flyers: head for a point in the air, slowing down on arrival
export function flyToward(r, tx, ty, tz, speed, accel, dt) {
  const dx = tx - r.pos.x, dy = ty - r.pos.y, dz = tz - r.pos.z, d = Math.hypot(dx, dy, dz);
  const sp = Math.min(speed, d * 1.6);
  const vx = d > 1e-3 ? dx / d * sp : 0, vy = d > 1e-3 ? dy / d * sp : 0, vz = d > 1e-3 ? dz / d * sp : 0;
  const ax = vx - r.vel.x, ay = vy - r.vel.y, az = vz - r.vel.z;
  const al = Math.hypot(ax, ay, az), max = accel * dt;
  const k = al > max ? max / al : 1;
  r.vel.x += ax * k; r.vel.y += ay * k; r.vel.z += az * k;
}
// walkers: head across the ground for a point, turning at most `turn` rad/s; gravity pulls them down
export function walkToward(r, tx, tz, speed, dt, turn = 8, strafe = false) {
  const dx = tx - r.pos.x, dz = tz - r.pos.z, d = Math.hypot(dx, dz);
  if (d > 0.05 && !strafe) turnToward(r, yawOf(dx, dz), turn, dt);
  const fx = strafe ? (d > 0.05 ? dx / d : 0) : fwdX(r.yaw), fz = strafe ? (d > 0.05 ? dz / d : 0) : fwdZ(r.yaw);
  const facing = strafe ? 1 : Math.max(0, (dx * fx + dz * fz) / Math.max(d, 1e-3));   // big turners slow down to turn
  const sp = d > 0.3 ? speed * (0.25 + 0.75 * facing) : 0;
  const k = 1 - Math.exp(-8 * dt);
  r.vel.x += (fx * sp - r.vel.x) * k;
  r.vel.z += (fz * sp - r.vel.z) * k;
  fall(r, dt);
}
export function stopWalking(r, dt) {
  const k = 1 - Math.exp(-10 * dt);
  r.vel.x -= r.vel.x * k; r.vel.z -= r.vel.z * k;
  fall(r, dt);
}
export function fall(r, dt) {
  if (r.grounded && r.vel.y <= 0) r.vel.y = -1.5;
  else r.vel.y = Math.max(-35, r.vel.y - GRAVITY * dt);
}
export function turnToward(r, yaw, rate, dt) {
  const d = angDiff(r.yaw, yaw);
  r.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
}
// the ground height under a point (or the point's own height if nothing is below within 40 m)
export function groundBelow(phys, x, y, z) {
  const h = phys.ray({ x, y, z }, DOWN, 40, G.WORLD);
  return h ? y - h.t : y - 40;
}
// keeps robots in a group from flying through each other
export function separate(r, robots, dt, radius = 1.4) {
  for (const o of robots) {
    if (o === r || o.dead || !PRISM[o.type].flyer) continue;
    const dx = r.pos.x - o.pos.x, dy = r.pos.y - o.pos.y, dz = r.pos.z - o.pos.z, d = Math.hypot(dx, dy, dz);
    const min = radius + PRISM[r.type].radius + PRISM[o.type].radius;
    if (d < min && d > 1e-3) { const push = (min - d) * 3 * dt / d; r.vel.x += dx * push * 4; r.vel.y += dy * push * 2; r.vel.z += dz * push * 4; }
  }
}
export { clampLen };

// a point in the robot's model space (facing +z) to the world
export function toWorld(r, x, y, z) {
  const c = Math.cos(r.yaw + Math.PI), s = Math.sin(r.yaw + Math.PI);
  return { x: r.pos.x + x * c + z * s, y: r.pos.y + y, z: r.pos.z - x * s + z * c };
}

// ---------- senses ----------
export function eyeOf(r) {
  const d = PRISM[r.type], e = d.eye, c = Math.cos(r.yaw + Math.PI), s = Math.sin(r.yaw + Math.PI);
  const base = d.flyer ? 0 : 0;
  return { x: r.pos.x + e[0] * c + e[2] * s, y: r.pos.y + e[1] + base, z: r.pos.z - e[0] * s + e[2] * c };
}
// can robot r see player p? Range (shorter when the player crouches), field of view, line of sight.
export function canSee(r, p, phys) {
  if (!p || p.dead) return false;
  const d = PRISM[r.type];
  const eye = eyeOf(r);
  const tx = p.pos.x - eye.x, ty = p.pos.y + p.height * 0.62 - eye.y, tz = p.pos.z - eye.z;
  const dist = Math.hypot(tx, ty, tz);
  r.dist = dist;
  if (dist > d.sight * (p.crouch ? 0.6 : 1)) return false;
  if (d.fov < 360 && dist > 3) {
    const a = Math.abs(angDiff(r.yaw, yawOf(tx, tz)));
    if (a > d.fov * Math.PI / 360) return false;
  }
  const h = phys.ray(eye, { x: tx / dist, y: ty / dist, z: tz / dist }, Math.max(0.01, dist - 0.4), G.WORLD);
  return !h;
}
// fills awareness while it sees you (faster up close and when you sprint nearby), empties it when it does not
export function perceive(r, ctx, dt) {
  const d = PRISM[r.type], p = ctx.player;
  r.sees = canSee(r, p, ctx.phys);
  if (r.sees) { r.unseen = 0; r.lastSeen = { x: p.pos.x, y: p.pos.y, z: p.pos.z }; r.target = p.id; }
  else r.unseen += dt;
  if (r.alertIn >= 0) { r.alertIn -= dt; if (r.alertIn < 0) { if (!r.hostile) becomeHostile(r, ctx, p, false); } }
  if (r.hostile) {
    if (r.unseen > 14) { r.hostile = false; r.aware = 0.4; r.state = 'idle'; r.st = 0; r.routeI = null; }     // lost you: back to patrolling, from the nearest waypoint
    return;
  }
  if (r.sees && d.recog > 0) {
    const close = r.dist < 6 ? 2.5 : 1;
    r.aware = Math.min(1, r.aware + dt / d.recog * close);
  } else if (p && !p.dead && p.sprinting && r.dist < 9 && d.recog > 0) r.aware = Math.min(1, r.aware + dt / d.recog * 0.4);    // it hears you
  else r.aware = Math.max(0, r.aware - dt * 0.2);
  if (r.aware >= 1) becomeHostile(r, ctx, p, true);
}
export function becomeHostile(r, ctx, p, spread) {
  r.hostile = true; r.aware = 1; r.alertIn = -1;
  if (p) { r.target = p.id; if (!r.lastSeen) r.lastSeen = { x: p.pos.x, y: p.pos.y, z: p.pos.z }; }
  bus.emit('prism:alert', r);
  ctx.director?.sound('alert', r.pos);
  // its friends nearby join in a moment later
  if (spread) for (const o of ctx.robots) {
    if (o === r || o.dead || o.hostile || o.alertIn >= 0) continue;
    const near = Math.hypot(o.pos.x - r.pos.x, o.pos.z - r.pos.z) < 18 || (r.group && o.group === r.group);
    if (near && o.type !== 'fink') { o.alertIn = 0.4 + ctx.rnd() * 0.5; o.lastSeen = r.lastSeen && { ...r.lastSeen }; }
  }
}
// a gunshot or an explosion: robots that hear it get suspicious, those very close turn on you
export function hear(robots, pos, radius, amount) {
  for (const r of robots) {
    if (r.dead || r.hostile) continue;
    const d = Math.hypot(r.pos.x - pos.x, r.pos.y - pos.y, r.pos.z - pos.z);
    if (d < radius) r.aware = Math.min(0.95, r.aware + amount * (1 - d / radius));
  }
}

// ---------- damage ----------
// The one door for damage to robots. part = a part name from defs (or null). src = { id, pos } of the attacker.
// Returns { dmg, part, weak, broke, killed } or null.
// (part 12) on a squad friend's game the robots belong to the leader: ROBOT_NET.remote sends the hit there and
// only the hit marker is worked out here
export const ROBOT_NET = { remote: null };
export function damageRobot(r, partName, amount, ctx, src) {
  if (r.dead || !(amount > 0)) return null;
  if (ROBOT_NET.remote) return ROBOT_NET.remote(r, partName, amount, src);
  const d = PRISM[r.type];
  let part = partName ? d.parts.find(p => p.name === partName) : null;
  if (part && part.open && !r.hatchOpen) part = null;          // a shut hatch is just armour
  let mult = part && part.mult ? part.mult : 1;
  const armor = part && part.armor !== undefined ? part.armor : d.armor;
  if (r.hot) mult *= d.hotMult || 1;
  const dmg = amount * mult * (1 - armor);
  const res = { dmg, part: part ? part.name : null, weak: mult > 1, broke: false, killed: false };
  if (part && part.hp) {
    if (!r.broken[part.name]) {
      r.partHp[part.name] -= dmg;
      if (r.partHp[part.name] <= 0) { r.partHp[part.name] = 0; r.broken[part.name] = true; res.broke = true; bus.emit('prism:break', r, part.name); }
    }
    r.hp -= dmg * 0.5;                         // a hit on a thruster hurts the body a little too
  } else r.hp -= dmg;
  r.hurtT = 0; r.flash = 0.07;
  if (!r.hostile && src) { r.lastSeen = { ...src.pos }; becomeHostile(r, ctx, ctx.director?.targets?.find(q => q.id === src.id) || ctx.player, true); }   // shooting it gives you away
  if (r.hp <= 0) { r.hp = 0; res.killed = true; ctx.director?.kill(r, src); }
  bus.emit('prism:hit', r, res, src);
  return res;
}

// a robot's hit spheres in the world (for bullets), with the hatch only while it is open
export function hitSpheres(r, out) {
  const d = PRISM[r.type], c = Math.cos(r.yaw + Math.PI), s = Math.sin(r.yaw + Math.PI);
  out.length = 0;
  for (const p of d.parts) {
    if (p.open && !r.hatchOpen) continue;
    if (p.hp && r.broken[p.name] && p.name.startsWith('thruster')) continue;   // a broken thruster is gone
    const [x, y, z] = p.at;
    out.push({ name: p.name, r: p.r, x: r.pos.x + x * c + z * s, y: r.pos.y + y, z: r.pos.z - x * s + z * c });
  }
  return out;
}
