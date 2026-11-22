// What the flying Prism (Fink, Fly, Swatter) share: hovering at a height above the ground, the laser-lock
// attack cycle (cool down, lock on with a visible laser, fire), falling when their thrusters are shot off,
// and their animation (tilting into the flight, thruster flames, smoke from a broken thruster).
import * as THREE from 'three';
import { PRISM } from './defs.js';
import { moveRobot, flyToward, groundBelow, separate, turnToward, eyeOf, routeStart, routeNext, GRAVITY } from './robot.js';
import { setFlash } from './models.js';
import { yawOf, angDiff } from '../move-math.js';

const lerp = (a, b, t) => a + (b - a) * t;

// the ground under the robot, measured a few times a second
export function groundY(r, ctx) {
  r.gyT = (r.gyT || 0) - ctx.dt;
  if (r.gyT <= 0 || r.gy === undefined) { r.gy = groundBelow(ctx.phys, r.pos.x, r.pos.y + 0.5, r.pos.z); r.gyT = 0.25; }
  return r.gy;
}

// not yet hostile: fly its patrol route if it has one, otherwise hover around home in a slow circle
export function patrol(r, ctx, dt, radius, alt, speed) {
  if (r.route && r.route.length) { followRoute(r, ctx, dt, alt, speed); return; }
  r.patrolA = (r.patrolA ?? r.phase) + dt * speed / Math.max(radius, 1);
  const gy = groundBelow(ctx.phys, r.home.x, r.home.y + 1, r.home.z);
  const tx = r.home.x + Math.cos(r.patrolA) * radius, tz = r.home.z + Math.sin(r.patrolA) * radius;
  flyToward(r, tx, gy + alt + Math.sin(ctx.time * 0.7 + r.phase) * 0.25, tz, speed, 3, dt);
  if (Math.hypot(r.vel.x, r.vel.z) > 0.3) turnToward(r, yawOf(r.vel.x, r.vel.z), 1.5, dt);
}

// A patrol route: waypoints { x, z } (and y when it should fly over something, like a roof), flown in a loop
// (or back and forth). It keeps `alt` above the ground under it; r.routeOff spreads a group into a loose
// formation. Its home moves with it, so dodging and searching start from where it is.
export function followRoute(r, ctx, dt, alt, speed) {
  const R = r.route;
  if (r.routeI === undefined || r.routeI === null || r.routeI >= R.length) r.routeI = routeStart(r);
  const wp = R[r.routeI], ox = r.routeOff ? r.routeOff.x : 0, oz = r.routeOff ? r.routeOff.z : 0;
  const gy = groundY(r, ctx);
  const ty = Math.max(gy, wp.y ?? gy) + (r.routeAlt ?? alt);
  flyToward(r, wp.x + ox, ty, wp.z + oz, speed, 3, dt);
  if (Math.hypot(wp.x + ox - r.pos.x, wp.z + oz - r.pos.z) < 3.5) r.routeI = routeNext(r);
  if (Math.hypot(r.vel.x, r.vel.z) > 0.3) turnToward(r, yawOf(r.vel.x, r.vel.z), 1.5, dt);
  r.home.x = r.pos.x; r.home.y = r.pos.y; r.home.z = r.pos.z;
}

// both thrusters gone (or the only one): it drops out of the sky and breaks on the ground
export function checkFall(r) {
  const d = PRISM[r.type];
  const thr = d.parts.filter(p => p.name.startsWith('thruster'));
  const gone = thr.filter(p => r.broken[p.name]).length;
  if (gone === thr.length && thr.length) r.falling = true;
  return thr.length > 1 && gone === 1;                      // unstable: one thruster left
}
export function fallStep(r, ctx, dt) {
  r.vel.y = Math.max(-30, r.vel.y - GRAVITY * dt);
  r.vel.x *= 1 - dt * 0.4; r.vel.z *= 1 - dt * 0.4;
  r.yaw += dt * 5;                                          // it spins as it goes down
  moveRobot(r, dt);
  if (r.grounded || r.st > 6) ctx.director.kill(r, null, 'crash');
}

// The attack cycle: 'cool' → 'lock' (needs line of sight; the laser shows) → fire → 'cool' ...
// fire(r) is called once when the lock completes and returns true when the attack is over.
export function lockCycle(r, ctx, dt, lockTime, coolMin, coolMax, fire) {
  r.atk = r.atk || 'cool';
  if (r.atkT === undefined) r.atkT = lerp(coolMin, coolMax, ctx.rnd());
  r.atkT -= dt;
  if (r.atk === 'cool') {
    r.lock = 0;
    if (r.atkT <= 0 && r.sees) { r.atk = 'lock'; r.atkT = lockTime; r.lockLost = 0; ctx.director.sound('lock_' + r.type, r.pos); }
  } else if (r.atk === 'lock') {
    r.lockLost = r.sees ? 0 : r.lockLost + dt;
    r.lock = Math.min(1, 1 - r.atkT / lockTime);
    if (r.lockLost > 0.4) { r.atk = 'cool'; r.atkT = 0.8; r.lock = 0; }
    else if (r.atkT <= 0) { r.atk = 'fire'; r.atkT = 0; r.fireT = 0; r.lock = 1; }
  } else if (r.atk === 'fire') {
    if (fire(r)) { r.atk = 'cool'; r.atkT = lerp(coolMin, coolMax, ctx.rnd()); r.lock = 0; }
  }
}

// a direction from the robot's eye to the player's chest, thrown off by `spread` degrees
export function aimAt(r, p, spreadDeg, rnd, from) {
  const o = from || eyeOf(r);
  let dx = p.pos.x - o.x, dy = p.pos.y + p.height * 0.6 - o.y, dz = p.pos.z - o.z;
  const d = Math.hypot(dx, dy, dz);
  dx /= d; dy /= d; dz /= d;
  const s = Math.tan(spreadDeg * Math.PI / 180);
  // a random offset perpendicular-ish to the aim (gaussian-like: the sum of two randoms)
  const ox = (rnd() + rnd() - 1) * s, oy = (rnd() + rnd() - 1) * s, oz = (rnd() + rnd() - 1) * s;
  dx += ox; dy += oy; dz += oz;
  const l = Math.hypot(dx, dy, dz);
  return { o, d: { x: dx / l, y: dy / l, z: dz / l }, dist: d };
}

// the shared end of every flyer's step: keep apart from friends, move
export function finishFlyer(r, ctx, dt) {
  separate(r, ctx.robots, dt);
  moveRobot(r, dt);
}

// ---------- drawing ----------
const _v = { x: 0, y: 0, z: 0 };
export function animateFlyer(view, r, dt, alpha, dir) {
  const x = lerp(r.prev.x, r.pos.x, alpha), y = lerp(r.prev.y, r.pos.y, alpha), z = lerp(r.prev.z, r.pos.z, alpha);
  const yaw = r.prevYaw + angDiff(r.prevYaw, r.yaw) * alpha;
  view.root.position.set(x, y, z);
  view.root.rotation.y = yaw + Math.PI;
  // lean into the flight: nose down when flying forward, roll when sliding sideways
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const fwd = r.vel.x * fx + r.vel.z * fz, side = r.vel.x * -fz + r.vel.z * fx;
  view.tilt = view.tilt || { x: 0, z: 0 };
  const k = 1 - Math.exp(-6 * dt);
  view.tilt.x += (Math.max(-0.5, Math.min(0.5, fwd * 0.06)) - view.tilt.x) * k;
  view.tilt.z += (Math.max(-0.6, Math.min(0.6, -side * 0.07)) - view.tilt.z) * k;
  const t = dir.time;
  const wobble = r.unstable ? Math.sin(t * 7 + r.phase) * 0.25 : 0;
  view.body.rotation.set(view.tilt.x, 0, view.tilt.z + wobble);
  view.body.position.y = r.dead || r.falling ? 0 : Math.sin(t * 2.1 + r.phase) * 0.04;
  for (const f of view.flames) {
    const on = !r.broken[f.part] && !r.dead && !r.falling;
    f.mesh.visible = on;
    if (on) { const fl = 0.8 + Math.sin(t * 37 + r.phase) * 0.12 + Math.sin(t * 23) * 0.1; f.mesh.scale.set(1, fl, 1); }
  }
  if (view.glows) view.glows.forEach((g, i) => { g.visible = !r.dead && !r.broken[i ? 'thrusterR' : 'thrusterL']; });
  if (view.halo) view.halo.visible = !r.dead && !r.broken.thruster;
  // smoke from broken thrusters
  view.smokeT = (view.smokeT || 0) - dt;
  if (view.smokeT <= 0 && !view.wrecked) {
    view.smokeT = 0.1;
    for (const f of view.flames) if (r.broken[f.part]) {
      f.mesh.getWorldPosition(_tmp);
      dir.fx.smoke(_tmp, 0.35, 1.1, 0x26232a, 0.6);
      if (Math.random() < 0.3) dir.fx.sparks(_tmp, 0xffb070, 2, 2);
    }
  }
  if (view.visorMat) view.visorMat.emissiveIntensity = r.dead ? 0 : 1.3 + (r.lock || 0) * (2.5 + Math.sin(t * 40) * 0.8);
  setFlash(view, r.hurtT < 0.07 && !r.dead);
}
const _tmp = new THREE.Vector3();

// the lock-on laser: from the eye to the player's chest while locking
export function drawLock(view, r, dir, color, width) {
  const p = dir.player;
  if (!view.lockBeam) view.lockBeam = dir.fx.beam(color, width);
  if (r.atk === 'lock' && p && !r.dead && r.sees) {
    const e = eyeOf(r);
    _a.set(e.x, e.y, e.z); _b.set(p.pos.x, p.pos.y + p.height * 0.6, p.pos.z);
    view.lockBeam.set(_a, _b, 0.15 + 0.65 * (r.lock || 0), width * (1 + (r.lock || 0)));
  } else view.lockBeam.hide();
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
