// Scatter, the jumping spider (DESIGN 10.5). It sits still until it notices you (1 s), scuttles closer, winds up
// for 1 s and leaps at you. If it lands on you it sticks and explodes (200). If it misses (or you roll through
// it during the roll's dodge window) it bursts into a cluster of 4-6 small bombs, 60-120 damage in total, around
// where it landed. Shooting it before it jumps (50 health) just pops it.
import { PRISM } from './defs.js';
import { perceive, walkToward, stopWalking, moveRobot, turnToward, detachRobotBody, GRAVITY } from './robot.js';
import { setFlash } from './models.js';
import { segDist2 } from '../sentry.js';
import { applyDamage } from '../damage.js';
import { BODY } from '../stats.js';
import { yawOf, angDiff, fwdX, fwdZ } from '../move-math.js';
import { G } from '../../core/physics.js';

const D = PRISM.scatter;
const lerp = (a, b, t) => a + (b - a) * t;

export const scatter = {
  init(r) { r.state = 'idle'; r.gait = 0; },

  step(r, ctx, dt) {
    const p = ctx.player;
    if (r.state === 'jump') return flight(r, ctx, dt, p);
    if (r.state === 'stuck') return stuck(r, ctx, dt, p);
    if (r.state === 'landed') {
      r.st2 = (r.st2 || 0) + dt;
      if (r.st2 >= 0.35) { ctx.director.cluster(r.pos, lerp(D.cluster[0], D.cluster[1], ctx.rnd()), D.bombs[0] + Math.floor(ctx.rnd() * (D.bombs[1] - D.bombs[0] + 1)), r); ctx.director.remove(r); }
      return;
    }
    perceive(r, ctx, dt);
    if (!r.hostile || !p) {
      stopWalking(r, dt);
      if (r.aware > 0 && r.sees && p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), 3, dt);
    } else if (r.state !== 'windup') {
      r.state = 'chase';
      const tgt = r.sees ? p.pos : (r.lastSeen || p.pos);
      const flat = Math.hypot(p.pos.x - r.pos.x, p.pos.z - r.pos.z);
      if (r.sees && flat < D.reach && r.grounded && !p.dead) { r.state = 'windup'; r.st = 0; ctx.director.sound('chitter', r.pos); }
      else walkToward(r, tgt.x, tgt.z, D.speed, dt, 10);
    } else {
      stopWalking(r, dt);
      if (p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), 8, dt);
      if (r.st >= D.windup && p && !p.dead) launch(r, ctx, p);
    }
    moveRobot(r, dt);
  },

  animate(view, r, dt, alpha, dir) {
    const x = lerp(r.prev.x, r.pos.x, alpha), y = lerp(r.prev.y, r.pos.y, alpha), z = lerp(r.prev.z, r.pos.z, alpha);
    const yaw = r.prevYaw + angDiff(r.prevYaw, r.yaw) * alpha;
    view.root.position.set(x, y, z);
    view.root.rotation.y = yaw + Math.PI;
    const t = dir.time, sp = Math.hypot(r.vel.x, r.vel.z);
    if (r.state !== 'jump' && r.state !== 'stuck') view.gait = (view.gait || 0) + sp * dt * 2.6;
    const wind = r.state === 'windup' ? Math.min(1, r.st / D.windup) : 0;
    const air = r.state === 'jump' || r.state === 'stuck';
    view.body.position.y = 0.3 - wind * 0.12 + (air ? 0 : Math.abs(Math.sin(view.gait * 2)) * 0.02 * Math.min(1, sp));
    view.body.rotation.x = air ? -0.4 : -wind * 0.25;
    for (const l of view.legs) {
      // two sets of four legs step in turn (a tetrapod gait); the wind-up crouches; in the air they curl
      const ph = view.gait + ((l.i + (l.side > 0 ? 0 : 1)) % 2) * Math.PI;
      const lift = sp > 0.2 ? Math.max(0, Math.sin(ph)) * 0.35 : 0;
      const swing = sp > 0.2 ? Math.cos(ph) * 0.3 : 0;
      l.g.rotation.set(0, l.yaw + swing * l.side, (air ? 0.9 : lift - wind * 0.35) );
      if (r.state === 'stuck') l.g.rotation.z = 0.5 + Math.sin(t * 30 + l.i) * 0.2;
    }
    const blink = r.state === 'stuck' ? (Math.sin(t * (12 + (1 - r.fuse / D.fuse) * 30)) > 0 ? 5 : 0.5) : 1.3 + wind * 3;
    view.visorMat.emissiveIntensity = r.dead ? 0 : blink;
    setFlash(view, r.hurtT < 0.07 && !r.dead);
  },
};

// the leap: a ballistic arc that lands where you will be in a moment
function launch(r, ctx, p) {
  const sx = r.pos.x, sy = r.pos.y + 0.3, sz = r.pos.z;
  const tx = p.pos.x + p.vel.x * 0.25, ty = p.pos.y + p.height * 0.5, tz = p.pos.z + p.vel.z * 0.25;
  const dist = Math.hypot(tx - sx, ty - sy, tz - sz);
  const T = Math.max(0.45, Math.min(0.85, dist / 11));
  r.vel.x = (tx - sx) / T; r.vel.z = (tz - sz) / T;
  r.vel.y = (ty - sy) / T + 0.5 * GRAVITY * T;
  r.pos.y = sy - 0.3;
  r.state = 'jump'; r.st = 0; r.passed = false; r.flightT = T;
  r.prev2 = { x: sx, y: sy, z: sz };
  detachRobotBody(r);                          // from here on it is a projectile
  ctx.director.sound('jump', r.pos);
}
function flight(r, ctx, dt, p) {
  const a = { x: r.pos.x, y: r.pos.y + 0.3, z: r.pos.z };
  r.vel.y -= GRAVITY * dt;
  r.pos.x += r.vel.x * dt; r.pos.y += r.vel.y * dt; r.pos.z += r.vel.z * dt;
  const b = { x: r.pos.x, y: r.pos.y + 0.3, z: r.pos.z };
  if (p && !p.dead && !r.passed) {
    const c0 = { x: p.pos.x, y: p.pos.y + BODY.radius, z: p.pos.z }, c1 = { x: p.pos.x, y: p.pos.y + p.height - BODY.radius, z: p.pos.z };
    const rr = BODY.radius + 0.3;
    if (segDist2(a, b, c0, c1) < rr * rr) {
      if (p.iframes > 0) { r.passed = true; applyDamage(p, { amount: 0.0001, type: 'blast', source: 'Scatter' }); }   // rolled through it
      else { r.state = 'stuck'; r.fuse = D.fuse; r.st = 0; ctx.director.sound('stick', r.pos); return; }
    }
  }
  // the ground or a wall
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  const h = len > 1e-5 ? ctx.phys.ray(a, { x: dx / len, y: dy / len, z: dz / len }, len + 0.25, G.WORLD) : null;
  if (h || r.st > r.flightT + 1.2) {
    if (h) { r.pos.x = a.x + dx / len * Math.max(0, h.t - 0.2); r.pos.y = a.y - 0.3 + dy / len * Math.max(0, h.t - 0.2); r.pos.z = a.z + dz / len * Math.max(0, h.t - 0.2); }
    r.vel.x = r.vel.y = r.vel.z = 0;
    r.state = 'landed'; r.st2 = 0;
    ctx.director.sound('land_scatter', r.pos);
  }
}
function stuck(r, ctx, dt, p) {
  r.fuse -= dt;
  if (p) {
    r.pos.x = p.pos.x + fwdX(p.facing) * 0.32; r.pos.y = p.pos.y + p.height * 0.5 - 0.3; r.pos.z = p.pos.z + fwdZ(p.facing) * 0.32;
    r.yaw = p.facing + Math.PI;
  }
  r.beepT = (r.beepT || 0) - dt;
  if (r.beepT <= 0) { r.beepT = Math.max(0.07, r.fuse / 5); ctx.director.sound('beep', r.pos); }
  if (r.fuse <= 0) {
    const at = { x: r.pos.x, y: r.pos.y + 0.3, z: r.pos.z };
    if (p && !p.dead) applyDamage(p, { amount: D.stick, type: 'stuck', source: 'Scatter', from: at });
    ctx.director.boom(at, 1.2);
    ctx.director.remove(r);
  }
}
