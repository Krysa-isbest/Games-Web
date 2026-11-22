// Fink, the snitch (DESIGN 10.2). It patrols, sweeping the ground with its scan cone. When it sees you it scans
// you for 3 s (break line of sight to stop it), then calls for help: 10 s later a drop pod brings
// reinforcements, unless you kill it or shoot off its thruster first. Once it has seen you it dodges around.
import { PRISM } from './defs.js';
import { perceive, flyToward, turnToward } from './robot.js';
import { groundY, patrol, checkFall, fallStep, finishFlyer, animateFlyer } from './drone.js';
import { yawOf } from '../move-math.js';
import { bus } from '../../core/events.js';
import * as THREE from 'three';

const D = PRISM.fink;
const lerp = (a, b, t) => a + (b - a) * t;

export const fink = {
  init(r) { r.scan = 0; r.call = 0; r.callCd = 0; r.dodge = null; r.dodgeT = 0; r.beaconT = 0; },

  step(r, ctx, dt) {
    checkFall(r);
    if (r.falling) { r.call = 0; fallStep(r, ctx, dt); return; }
    perceive(r, ctx, dt);
    r.callCd = Math.max(0, r.callCd - dt);
    const p = ctx.player, gy = groundY(r, ctx);

    if (r.state === 'idle') {
      patrol(r, ctx, dt, 6, D.alt, D.speed);
      if ((r.sees || r.hostile) && r.callCd <= 0) { r.state = 'scan'; r.st = 0; if (r.hostile) r.scan = Math.max(r.scan, 0.5); }
    } else if (r.state === 'scan') {
      // hold position and stare at you; the scan only fills while it can see you
      flyToward(r, r.pos.x, gy + D.alt, r.pos.z, D.speed, 4, dt);
      if (p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), 3, dt);
      r.scan = r.sees ? Math.min(1, r.scan + dt / D.scan) : Math.max(0, r.scan - dt / 6);
      r.tickT = (r.tickT || 0) - dt;
      if (r.tickT <= 0 && r.sees) { r.tickT = 0.35; ctx.director.sound('scan', r.pos, r.scan); }
      if (r.scan >= 1) {
        r.state = 'call'; r.st = 0; r.call = 0; r.hostile = true; r.aware = 1;
        bus.emit('prism:scanned', r);
        ctx.director.sound('call', r.pos);
      } else if (r.scan <= 0 && !r.sees && r.st > 1) { r.state = 'idle'; r.st = 0; }
    } else if (r.state === 'call' || r.state === 'evade') {
      // dart around to be hard to hit
      r.dodgeT -= dt;
      if (r.dodgeT <= 0 || !r.dodge) {
        r.dodgeT = lerp(0.6, 1.3, ctx.rnd());
        const a = ctx.rnd() * Math.PI * 2, d = lerp(2.5, 5.5, ctx.rnd());
        let tx = r.pos.x + Math.cos(a) * d, tz = r.pos.z + Math.sin(a) * d;
        if (Math.hypot(tx - r.home.x, tz - r.home.z) > 22) { tx = r.home.x + (tx - r.home.x) * 0.5; tz = r.home.z + (tz - r.home.z) * 0.5; }
        r.dodge = { x: tx, y: gy + lerp(3.5, 7, ctx.rnd()), z: tz };
      }
      flyToward(r, r.dodge.x, r.dodge.y, r.dodge.z, D.dodgeSpeed, 14, dt);
      if (p) turnToward(r, yawOf(p.pos.x - r.pos.x, p.pos.z - r.pos.z), 4, dt);
      if (r.state === 'call') {
        r.call = Math.min(1, r.call + dt / D.call);
        r.beaconT -= dt;
        if (r.beaconT <= 0) { r.beaconT = 1; ctx.director.sound('beacon', r.pos); bus.emit('prism:beacon', r); }
        if (r.call >= 1) {
          ctx.director.reinforce(r.lastSeen || (p && p.pos) || r.pos, r);
          r.state = 'evade'; r.st = 0; r.callCd = D.callCooldown; r.call = 0;
        }
      } else if (r.st > 15) { r.state = 'idle'; r.st = 0; r.scan = 0; }
    }
    finishFlyer(r, ctx, dt);
  },

  animate(view, r, dt, alpha, dir) {
    animateFlyer(view, r, dt, alpha, dir);
    const t = dir.time, p = dir.player, cone = view.scanMesh;
    if (view.wrecked) return;
    // the scan cone (it points along -y of its pivot): a lazy sweep while patrolling, on you while scanning
    const scanning = r.state === 'scan' && p && !r.dead;
    if (scanning) {
      view.root.updateMatrixWorld(true);
      _p.set(p.pos.x, p.pos.y + 1, p.pos.z);
      view.scan.parent.worldToLocal(_p);
      _p.sub(view.scan.position).normalize();
    } else {
      const pitch = 0.55 + Math.sin(t * 0.37 + r.phase) * 0.15, yaw = Math.sin(t * 0.55 + r.phase) * 0.8;
      _p.set(Math.sin(pitch) * Math.sin(yaw), -Math.cos(pitch), Math.sin(pitch) * Math.cos(yaw));
    }
    view.scan.quaternion.setFromUnitVectors(DOWN, _p);
    cone.visible = !r.dead && !r.falling && r.state !== 'call';
    cone.material.opacity = scanning ? 0.1 + 0.12 * r.scan + Math.max(0, Math.sin(t * 18)) * 0.05 : 0.05;
    cone.material.color.setHex(scanning ? (r.scan > 0.7 ? 0xff6a5a : 0xd7b8ff) : 0xc49bff);
    // calling: a pulsing beacon
    if (r.state === 'call' && !r.dead) {
      view.pulse = (view.pulse || 0) - dt;
      if (view.pulse <= 0) {
        view.pulse = 0.5;
        _p.set(r.pos.x, r.pos.y, r.pos.z);
        dir.fx.flash(_p, 0xff5a4d, 1.2, 0.25);
      }
    }
  },
};
const _p = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
