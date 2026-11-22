// Roach, the heavy (DESIGN 10.6). Slow to notice you (5 s). On the ground: it charges its visor for 3 s, then
// a laser for 5 s that turns slowly after you (4 damage every 0.1 s while it touches you; cover blocks it).
// Get close and it rears up and stomps (2 s warning ring, 100 damage within 2 m). Now and then it takes off:
// wings out, its back opens and a mortar fires up to 5 gas rockets (50 damage, then a gas cloud for 10 s).
// When it lands it sends an EMP pulse that knocks shields offline for 4 s. 1500 health, heavy armour; the visor
// and (while it flies) the open hatch are weak points. It carries the Roach Reactor.
import { PRISM } from './defs.js';
import { perceive, walkToward, stopWalking, moveRobot, turnToward, flyToward, toWorld, eyeOf, groundBelow } from './robot.js';
import { setFlash } from './models.js';
import { segDist2 } from '../sentry.js';
import { applyDamage } from '../damage.js';
import { BODY } from '../stats.js';
import { yawOf, angDiff, fwdX, fwdZ } from '../move-math.js';
import { G } from '../../core/physics.js';
import { bus } from '../../core/events.js';
import * as THREE from 'three';

const D = PRISM.roach;
const lerp = (a, b, t) => a + (b - a) * t;

export const roach = {
  init(r) {
    r.mode = 'walk'; r.act = 'none'; r.actT = 0; r.cd = 2; r.sinceFlight = 8;
    r.wing = 0; r.hatchOpen = false; r.beamLen = 0; r.rockets = 0; r.wp = null; r.wpT = 0;
  },

  step(r, ctx, dt) {
    const p = ctx.player;
    perceive(r, ctx, dt);
    r.cd = Math.max(0, r.cd - dt);
    if (r.mode !== 'walk') return air(r, ctx, dt, p);
    if (!r.hostile || !p) { r.act = 'none'; r.beamLen = 0; wander(r, ctx, dt, p); moveRobot(r, dt); return; }

    r.sinceFlight += dt;
    const tgt = r.sees ? p.pos : (r.lastSeen || p.pos);
    const dist = Math.hypot(tgt.x - r.pos.x, tgt.z - r.pos.z);
    const front = toWorld(r, 0, 0, 1.2);
    const toFront = Math.hypot(p.pos.x - front.x, p.pos.z - front.z);
    const face = rate => turnToward(r, yawOf(tgt.x - r.pos.x, tgt.z - r.pos.z), rate, dt);

    if (r.act === 'none') {
      if (!p.dead && toFront < D.stompRange && Math.abs(p.pos.y - r.pos.y) < 2) startStomp(r, ctx, front);
      else if (r.sees && dist < 38 && r.cd <= 0 && !p.dead) { r.act = 'charge'; r.actT = D.charge; ctx.director.sound('charge', r.pos); }
      else if (r.sinceFlight > D.flightEvery && (r.unseen > 4 || (dist > 15 && ctx.rnd() < dt * 0.25))) { takeoff(r, ctx); return; }
      else if (dist > D.keep[1]) walkToward(r, tgt.x, tgt.z, D.speed, dt, D.turn);
      else { stopWalking(r, dt); face(D.turn); }
    } else if (r.act === 'charge') {
      stopWalking(r, dt); face(D.turn);
      if (!p.dead && toFront < D.stompRange) startStomp(r, ctx, front);
      else if ((r.actT -= dt) <= 0) {
        r.act = 'beam'; r.actT = D.beam; r.tick = 0;
        const e = eyeOf(r);
        r.beamYaw = r.yaw; r.beamPitch = Math.atan2(p.pos.y + p.height * 0.6 - e.y, Math.hypot(p.pos.x - e.x, p.pos.z - e.z));
        ctx.director.sound('beam_on', r.pos);
      }
    } else if (r.act === 'beam') {
      stopWalking(r, dt);
      beam(r, ctx, dt, p);
      if ((r.actT -= dt) <= 0) { r.act = 'cool'; r.actT = 2.5; r.beamLen = 0; r.cd = 1.5; ctx.director.sound('beam_off', r.pos); }
    } else if (r.act === 'stomp') {
      stopWalking(r, dt);
      if ((r.actT -= dt) <= 0) {
        ctx.director.blast(r.stompAt, D.stompRadius, D.stompDamage, D.stompRadius, 'blast', 'Roach stomp', r.stompAt);
        ctx.director.boom(r.stompAt, 1.4, 0xd8b48a);
        bus.emit('prism:stomp', r);
        r.act = 'cool'; r.actT = 1.5;
      }
    } else if (r.act === 'cool') {
      if (dist > D.keep[1]) walkToward(r, tgt.x, tgt.z, D.speed * 0.6, dt, D.turn); else { stopWalking(r, dt); face(D.turn); }
      if ((r.actT -= dt) <= 0) r.act = 'none';
    }
    moveRobot(r, dt);
  },

  animate(view, r, dt, alpha, dir) {
    const x = lerp(r.prev.x, r.pos.x, alpha), y = lerp(r.prev.y, r.pos.y, alpha), z = lerp(r.prev.z, r.pos.z, alpha);
    const yaw = r.prevYaw + angDiff(r.prevYaw, r.yaw) * alpha;
    view.root.position.set(x, y, z);
    view.root.rotation.y = yaw + Math.PI;
    const t = dir.time, sp = Math.hypot(r.vel.x, r.vel.z), flying = r.mode !== 'walk';
    view.gait = (view.gait || 0) + (flying ? 0 : sp * dt * 1.6);
    const rear = r.act === 'stomp' ? Math.sin(Math.min(1, 1 - r.actT / D.stompWind) * Math.PI * 0.5) : 0;
    view.body.rotation.x = -rear * 0.35 + (flying ? Math.sin(t * 2) * 0.04 : 0);
    view.body.position.y = rear * 0.25 + (flying ? 0 : Math.abs(Math.sin(view.gait * 2)) * 0.03);
    for (const l of view.legs) {
      // alternating tripods; in the air the legs hang and curl
      const ph = view.gait + ((l.i + (l.side > 0 ? 0 : 1)) % 2) * Math.PI;
      const lift = !flying && sp > 0.2 ? Math.max(0, Math.sin(ph)) * 0.25 : 0;
      const swing = !flying && sp > 0.2 ? Math.cos(ph) * 0.22 : 0;
      l.g.rotation.set(0, l.yaw + swing * l.side, flying ? 0.55 : lift + (l.i === 0 ? rear * 0.5 : 0));
    }
    // head follows the beam
    const pitch = r.act === 'beam' ? -(r.beamPitch || 0) : 0;
    view.head.rotation.set(Math.max(-0.5, Math.min(0.5, pitch)), r.act === 'beam' ? angDiff(r.yaw, r.beamYaw) : 0, 0);
    // wings out while flying, folded away on the ground; the hatch opens over the mortar
    const wantWing = r.mode === 'fly' || r.mode === 'takeoff' ? 1 : 0;
    view.wingK = (view.wingK || 0) + (wantWing - (view.wingK || 0)) * Math.min(1, dt * 4);
    for (const w of view.wings) {
      w.g.scale.setScalar(Math.max(0.01, view.wingK));
      w.g.rotation.z = w.side * (0.15 + Math.sin(t * 28) * 0.35 * view.wingK);
    }
    view.hatchK = (view.hatchK || 0) + ((r.hatchOpen ? 1 : 0) - (view.hatchK || 0)) * Math.min(1, dt * 5);
    view.hatch.rotation.x = view.hatchK * 1.4;
    const glow = r.dead ? 0 : r.act === 'charge' ? 1.5 + (1 - r.actT / D.charge) * 5 + Math.sin(t * 30) * 0.8 : r.act === 'beam' ? 7 : 1.3;
    view.visorMat.emissiveIntensity = glow;
    // the beam
    if (!view.beam) { view.beam = dir.fx.beam(0xc49bff, 0.09); view.aim = dir.fx.beam(0xff6a5a, 0.01); }
    if (r.act === 'beam' && r.beamLen > 0 && !r.dead) {
      const e = eyeOf(r), d = beamDir(r);
      _a.set(e.x, e.y, e.z); _b.set(e.x + d.x * r.beamLen, e.y + d.y * r.beamLen, e.z + d.z * r.beamLen);
      view.beam.set(_a, _b, 0.9 + Math.sin(t * 50) * 0.1, 0.07 + Math.sin(t * 37) * 0.012);
      if (Math.random() < 0.5) dir.fx.sparks(_b, 0xd9b8ff, 1, 2.5);
    } else view.beam.hide();
    if (r.act === 'charge' && dir.player && !r.dead) {                  // the tell: a thin aiming line
      const e = eyeOf(r), p = dir.player;
      _a.set(e.x, e.y, e.z); _b.set(p.pos.x, p.pos.y + p.height * 0.6, p.pos.z);
      view.aim.set(_a, _b, 0.2 + 0.5 * (1 - r.actT / D.charge));
    } else view.aim.hide();
    setFlash(view, r.hurtT < 0.07 && !r.dead);
  },
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

function beamDir(r) {
  const cp = Math.cos(r.beamPitch || 0);
  return { x: fwdX(r.beamYaw) * cp, y: Math.sin(r.beamPitch || 0), z: fwdZ(r.beamYaw) * cp };
}
// the laser: turns slowly after you, stops at walls, hurts while it touches you
function beam(r, ctx, dt, p) {
  const e = eyeOf(r);
  if (p && !p.dead) {
    const want = yawOf(p.pos.x - e.x, p.pos.z - e.z);
    const wantP = Math.atan2(p.pos.y + p.height * 0.6 - e.y, Math.hypot(p.pos.x - e.x, p.pos.z - e.z));
    const dy = angDiff(r.beamYaw, want), max = D.beamTurn * dt;
    r.beamYaw += Math.max(-max, Math.min(max, dy));
    r.beamPitch += Math.max(-max, Math.min(max, wantP - r.beamPitch));
    turnToward(r, r.beamYaw, D.turn * 0.5, dt);
  }
  const d = beamDir(r);
  const h = ctx.phys.ray(e, d, 45, G.WORLD);
  r.beamLen = h ? h.t : 45;
  r.tick = (r.tick || 0) + dt;
  while (r.tick >= D.beamTick) {
    r.tick -= D.beamTick;
    if (!p || p.dead) continue;
    const b = { x: e.x + d.x * r.beamLen, y: e.y + d.y * r.beamLen, z: e.z + d.z * r.beamLen };
    const c0 = { x: p.pos.x, y: p.pos.y + BODY.radius, z: p.pos.z }, c1 = { x: p.pos.x, y: p.pos.y + p.height - BODY.radius, z: p.pos.z };
    const rr = BODY.radius + 0.1;
    if (segDist2(e, b, c0, c1) < rr * rr) applyDamage(p, { amount: D.beamDamage, type: 'laser', source: 'Roach laser', from: e });
  }
}
function startStomp(r, ctx, front) {
  r.act = 'stomp'; r.actT = D.stompWind; r.beamLen = 0;
  r.stompAt = { x: front.x, y: groundBelow(ctx.phys, front.x, r.pos.y + 1.5, front.z), z: front.z };
  ctx.director.warn(r.stompAt, D.stompRadius, D.stompWind);
  ctx.director.sound('stomp_warn', r.pos);
}
// not yet hostile: plods between points around its home, stopping to look around. When something catches its
// eye it stops and stares that way until it is sure (or forgets).
function wander(r, ctx, dt, p) {
  if (r.aware > 0.12 && r.lastSeen) {
    stopWalking(r, dt);
    turnToward(r, yawOf(r.lastSeen.x - r.pos.x, r.lastSeen.z - r.pos.z), D.turn * 0.8, dt);
    return;
  }
  r.wpT -= dt;
  if (!r.wp || r.wpT <= 0) {
    const a = ctx.rnd() * Math.PI * 2, d = 3 + ctx.rnd() * 8;
    r.wp = { x: r.home.x + Math.cos(a) * d, z: r.home.z + Math.sin(a) * d };
    r.wpT = 6 + ctx.rnd() * 4;
  }
  if (Math.hypot(r.wp.x - r.pos.x, r.wp.z - r.pos.z) > 0.8 && r.wpT < 5) walkToward(r, r.wp.x, r.wp.z, 1.2, dt, D.turn);
  else {
    stopWalking(r, dt);
    if (r.aware > 0 && r.sees && p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), D.turn * 0.6, dt);
  }
}

// ---------- flight ----------
function takeoff(r, ctx) {
  r.mode = 'takeoff'; r.st = 0; r.act = 'none'; r.beamLen = 0; r.sinceFlight = 0;
  r.flyA = Math.atan2(r.pos.z - (r.lastSeen ? r.lastSeen.z : r.pos.z), r.pos.x - (r.lastSeen ? r.lastSeen.x : r.pos.x));
  ctx.director.sound('takeoff', r.pos);
}
function air(r, ctx, dt, p) {
  const tgt = p && r.sees ? p.pos : (r.lastSeen || r.pos);
  const gy = groundBelow(ctx.phys, r.pos.x, r.pos.y + 0.5, r.pos.z);
  if (r.mode === 'takeoff') {
    flyToward(r, r.pos.x, gy + 7, r.pos.z, 3.5, 6, dt);
    if (r.st > 1.8) { r.mode = 'fly'; r.st = 0; r.hatchOpen = true; r.rockets = D.rockets; r.rocketT = 0.8; ctx.director.sound('hatch', r.pos); }
  } else if (r.mode === 'fly') {
    r.flyA += dt * 0.32;
    flyToward(r, tgt.x + Math.cos(r.flyA) * 16, Math.max(gy, tgt.y) + 7, tgt.z + Math.sin(r.flyA) * 16, D.flySpeed, 4, dt);
    turnToward(r, yawOf(tgt.x - r.pos.x, tgt.z - r.pos.z), 1.5, dt);
    r.rocketT -= dt;
    if (r.rocketT <= 0 && r.rockets > 0 && p && !p.dead) {
      r.rocketT = D.rocketGap; r.rockets--;
      const lead = r.sees ? 0.6 : 0;
      const aim = { x: tgt.x + (p.vel.x || 0) * lead + (ctx.rnd() - 0.5) * 3, y: tgt.y, z: tgt.z + (p.vel.z || 0) * lead + (ctx.rnd() - 0.5) * 3 };
      ctx.director.fireRocket(toWorld(r, 0, 1.75, -0.15), aim, r);
    }
    if (r.rockets <= 0 && r.rocketT < -1.2) { r.mode = 'land'; r.st = 0; r.hatchOpen = false; }
  } else if (r.mode === 'land') {
    const k = 1 - Math.exp(-3 * dt);
    r.vel.x -= r.vel.x * k; r.vel.z -= r.vel.z * k;
    r.vel.y = Math.max(r.vel.y - 10 * dt, -4);
    if (r.grounded || r.pos.y <= gy + 0.05 || r.st > 6) {
      r.mode = 'walk'; r.act = 'cool'; r.actT = 1.5; r.vel.y = 0;
      ctx.director.emp(r.pos, D.empRadius, D.empTime, r);
    }
  }
  moveRobot(r, dt);
}
