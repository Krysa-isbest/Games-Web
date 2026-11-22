// Fly (Prism-7) and Swatter-1 (DESIGN 10.3 and 10.4).
// Fly: takes 2 s to recognise you, then circles you 8-15 m away, locks a laser on you for 3 s and fires a burst
// of 3 small shots (15 each). Comes in groups. One thruster shot off: it wobbles, flies low and aims worse.
// Both: it falls. Swatter: keeps 16-22 m away, locks on for 4 s, then 30-40 minigun shots (5 each) that kick
// all over the place, then it overheats for 4 s (and takes more damage while hot).
import { PRISM } from './defs.js';
import { perceive, flyToward, turnToward, toWorld } from './robot.js';
import { groundY, patrol, checkFall, fallStep, lockCycle, aimAt, finishFlyer, animateFlyer, drawLock } from './drone.js';
import { yawOf } from '../move-math.js';
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function circle(r, ctx, dt, p, R, alt, speed, accel, spin) {
  const tgt = r.sees ? p.pos : (r.lastSeen || p.pos);
  const searching = !r.sees && r.unseen > 0.8;
  r.orbitA += r.orbitW * dt * (searching ? 2.2 : 1) * spin;
  const rad = R * (searching ? 0.6 : 1);
  flyToward(r, tgt.x + Math.cos(r.orbitA) * rad, tgt.y + alt, tgt.z + Math.sin(r.orbitA) * rad, speed, accel, dt);
  turnToward(r, yawOf(tgt.x - r.pos.x, tgt.z - r.pos.z), 6, dt);
}
function clearance(r, ctx, dt, min) {
  const gy = groundY(r, ctx);
  if (r.pos.y < gy + min && r.vel.y < 1.5) r.vel.y += 8 * dt;
}

export const fly = {
  init(r, ctx) {
    const d = PRISM.fly;
    r.orbitR = lerp(d.orbit[0], d.orbit[1], ctx.rnd());
    r.alt = lerp(d.alt[0], d.alt[1], ctx.rnd());
    r.orbitW = (0.25 + 0.2 * ctx.rnd()) * (ctx.rnd() < 0.5 ? -1 : 1);
    r.orbitA = ctx.rnd() * TAU;
    r.shots = 0;
  },
  step(r, ctx, dt) {
    r.unstable = checkFall(r);
    if (r.falling) { r.lock = 0; fallStep(r, ctx, dt); return; }
    perceive(r, ctx, dt);
    const d = PRISM.fly, p = ctx.player;
    if (!r.hostile || !p) {
      patrol(r, ctx, dt, 4, 3, 1.6);
      if (r.aware > 0 && r.sees && p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), 2, dt);
      r.atk = 'cool'; r.lock = 0;
    } else {
      const alt = r.unstable ? 1.6 + Math.sin(ctx.time * 3 + r.phase) * 0.5 : r.alt;
      circle(r, ctx, dt, p, r.orbitR * (r.unstable ? 0.75 : 1), alt, d.speed * (r.unstable ? 0.55 : 1), d.accel, 1);
      lockCycle(r, ctx, dt, d.lock * (r.unstable ? 1.3 : 1), d.cool[0], d.cool[1], rr => {
        if (p.dead) { rr.shots = 0; return true; }
        rr.fireT -= dt;
        if (rr.fireT <= 0) {
          rr.fireT = d.shotGap;
          rr.shots++;
          const a = aimAt(rr, p, d.spread * (rr.unstable ? 3 : 1), ctx.rnd);
          ctx.director.fireBolt(a.o, a.d, d.boltSpeed, d.damage, rr);
          if (rr.shots >= d.shots) { rr.shots = 0; return true; }
        }
        return false;
      });
    }
    clearance(r, ctx, dt, 1.0);
    finishFlyer(r, ctx, dt);
  },
  animate(view, r, dt, alpha, dir) {
    animateFlyer(view, r, dt, alpha, dir);
    drawLock(view, r, dir, 0xc49bff, 0.012);
  },
};

export const swatter = {
  init(r, ctx) {
    const d = PRISM.swatter;
    r.keep = lerp(d.keep[0], d.keep[1], ctx.rnd());
    r.alt = lerp(d.alt[0], d.alt[1], ctx.rnd());
    r.orbitW = (0.08 + 0.08 * ctx.rnd()) * (ctx.rnd() < 0.5 ? -1 : 1);
    r.orbitA = ctx.rnd() * TAU;
    r.hot = false; r.heat = 0;
  },
  step(r, ctx, dt) {
    r.unstable = checkFall(r);
    if (r.falling) { r.lock = 0; r.hot = false; fallStep(r, ctx, dt); return; }
    perceive(r, ctx, dt);
    const d = PRISM.swatter, p = ctx.player;
    r.heat = Math.max(0, r.heat - dt * (r.hot ? 0.25 : 0.5));
    if (!r.hostile || !p) {
      patrol(r, ctx, dt, 7, 5, 1.8);
      if (r.aware > 0 && r.sees && p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), 1.5, dt);
      if (r.atk !== 'hot') { r.atk = 'cool'; r.lock = 0; }
    } else {
      const alt = r.unstable ? 2.2 + Math.sin(ctx.time * 2.5 + r.phase) * 0.6 : r.alt;
      circle(r, ctx, dt, p, r.keep, alt, d.speed * (r.unstable ? 0.6 : 1), d.accel, 1);
    }
    if (r.atk === 'hot') {
      r.atkT -= dt;
      if (r.atkT <= 0) { r.hot = false; r.atk = 'cool'; r.atkT = d.cool; }
    } else if (r.hostile && p) {
      lockCycle(r, ctx, dt, d.lock * (r.unstable ? 1.3 : 1), d.cool, d.cool + 0.8, rr => {
        if (rr.burst === undefined) { rr.burst = 0; rr.burstLeft = d.shots[0] + Math.floor(ctx.rnd() * (d.shots[1] - d.shots[0] + 1)); }
        rr.fireT -= dt;
        while (rr.fireT <= 0 && rr.burstLeft > 0) {
          rr.fireT += 1 / d.rate;
          const m = toWorld(rr, 0, -0.45, 1.05);
          const a = aimAt(rr, p, (d.spread + d.spreadGrow * rr.burst) * (rr.unstable ? 1.6 : 1), ctx.rnd, m);
          ctx.director.fireBullet(m, a.d, 75, d.damage, rr);
          rr.burst++; rr.burstLeft--; rr.heat = Math.min(1, rr.heat + 1 / 34);
        }
        if (rr.burstLeft <= 0) { rr.overheated = true; rr.burst = undefined; return true; }
        return false;
      });
      if (r.overheated) {
        r.overheated = false; r.atk = 'hot'; r.atkT = d.overheat; r.hot = true; r.lock = 0;
        ctx.director.sound('overheat', r.pos);
      }
    }
    clearance(r, ctx, dt, 1.6);
    finishFlyer(r, ctx, dt);
  },
  animate(view, r, dt, alpha, dir) {
    animateFlyer(view, r, dt, alpha, dir);
    drawLock(view, r, dir, 0xff7a6a, 0.02);
    if (view.wrecked) return;
    const firing = r.atk === 'fire';
    view.spin = (view.spin || 0) + dt * (firing ? 30 : r.hot ? 6 : 0.5);
    view.barrels.rotation.z = view.spin;
    view.gunGlow.emissiveIntensity = 0.8 + r.heat * 4;
    view.gunGlow.emissive.setHex(r.heat > 0.6 ? 0xff5a2a : 0x9a5cff);
    view.steamT = (view.steamT || 0) - dt;
    if (r.hot && view.steamT <= 0) {
      view.steamT = 0.08;
      view.muzzle.getWorldPosition(_m);
      dir.fx.smoke(_m, 0.4, 0.9, 0x8e8a96, 1.4);
    }
  },
};
const _m = new THREE.Vector3();
