// Whiteout: you. A capsule moved by Rapier's character controller (not a tumbling body): it walks up slopes and
// over small steps, slides down what is too steep, slides on ice, wades through deep snow and shoves loose
// things out of the way. The camera sits in the head of a full body: look down and you see your coat and legs.
import * as THREE from 'three';
import { S, clamp, lerp } from './state.js';
import { BINDS } from './keys.js';
import { smooth } from './scene.js';
import { makeBody, pose } from './body.js';
import { SEA, EDGE } from './island.js';

const RAD = 0.3, H_STAND = 0.6, H_CROUCH = 0.35;           // the capsule: 1.8 m standing, 1.3 m crouched
const EYE_STAND = 1.64, EYE_CROUCH = 1.18;
const WALK = 2.7, SPRINT = 4.8, SLOW = 1.35, SNEAK = 1.25, JUMP = 6.2, GRAV = 22;
// collision groups: the crew's stand-ins on the host push loose things around, but nobody bumps into them
export const AVATAR = 0x0002ffff, NO_AVATARS = 0xfffffffd;
const _d = { x: 0, y: 0, z: 0 }, _n = { x: 0, y: 0, z: 0 };

// the keys and mouse buttons that are down, read through the bindings (keys.js) and the hold / toggle settings
export class Input {
  constructor() { this.down = new Set(); this.tog = { sprint: false, crouch: false, walk: false }; this.jump = 0; this.active = false; }
  key(code, isDown, repeat) {
    if (!isDown) { this.down.delete(code); return; }
    if (!this.active || repeat || !code) return;
    this.down.add(code);
    for (const a of ['sprint', 'crouch', 'walk']) if (code === BINDS[a] && S[a + 'Mode'] === 'toggle') this.tog[a] = !this.tog[a];
    if (code === BINDS.sprint && this.tog.sprint) this.tog.crouch = false;
    if (code === BINDS.crouch && this.tog.crouch) this.tog.sprint = false;
    if (code === BINDS.jump) this.jump = 0.18;                 // remembered for a moment, so a slightly early press still jumps
  }
  is(a) { return this.down.has(BINDS[a]); }
  held(a) { return S[a + 'Mode'] === 'toggle' ? this.tog[a] : this.is(a); }
  clear() { this.down.clear(); this.jump = 0; }
}

export class Player {
  constructor(R, wld, scene, camera, look, spawn) {
    this.R = R; this.w = wld; this.cam = camera;
    this.pos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);       // your feet
    this.vel = new THREE.Vector3(); this.vy = 0;
    this.yaw = spawn.yaw; this.pitch = -0.04;
    this.grounded = false; this.steep = false; this.crouched = false; this.sprinting = false; this.moving = false;
    this.surface = 'snow'; this.depth = 0; this.speed = 0; this.airT = 0; this.coyote = 0; this.atEdge = false;
    this.cr = 0; this.air = 1; this.phase = 0; this.walkAmt = 0; this.visY = spawn.y; this.sink = 0; this.dip = 0; this.fovKick = 0; this.t = 0;
    // set by the cold (game.js)
    this.heat = 78; this.slow = 1; this.shiver = 0; this.hug = 0; this.exposure = 1;
    this.half = H_STAND; this.seat = null;
    const phys = wld.phys;
    this.body = phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + H_STAND + RAD, spawn.z));
    this.col = phys.createCollider(R.ColliderDesc.capsule(H_STAND, RAD).setFriction(0), this.body);
    const cc = this.cc = phys.createCharacterController(0.03);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setMaxSlopeClimbAngle(48 * Math.PI / 180);
    cc.setMinSlopeSlideAngle(40 * Math.PI / 180);
    cc.enableAutostep(0.38, 0.15, true);                           // steps, the shack's doorstep, logs
    cc.enableSnapToGround(0.35);                                   // stay on the ground going downhill
    cc.setApplyImpulsesToDynamicBodies(true);                      // push loose things
    cc.setCharacterMass(45);
    this.P = makeBody(look, true);
    scene.add(this.P.g);
    this.onStep = null; this.onLand = null;
  }

  look(dx, dy) {
    const s = 0.0022 * (+S.sens || 1);
    this.yaw -= clamp(dx, -300, 300) * s;
    this.pitch = clamp(this.pitch - clamp(dy, -300, 300) * s * (S.invertY ? -1 : 1), -1.5, 1.5);
    if (this.seat) {     // buckled in: you can turn your head, not your body
      const d = Math.atan2(Math.sin(this.yaw - this.seat.yaw), Math.cos(this.yaw - this.seat.yaw));
      this.yaw = this.seat.yaw + clamp(d, -2, 2);
    }
  }
  // buckled into a seat: the capsule is switched off until you stand up
  sit(s) {
    this.seat = s; this.col.setEnabled(false);
    this.pos.set(s.x, s.y, s.z); this.visY = s.y; this.yaw = s.yaw; this.pitch = -0.12;
    this.vel.set(0, 0, 0); this.vy = 0; this.grounded = true; this.moving = false; this.speed = 0; this.surface = 'wood';
  }
  stand(at) {
    this.seat = null; this.col.setEnabled(true);
    this.teleport(at.x, at.y + 0.02, at.z);
  }
  teleport(x, y, z) {
    this.pos.set(x, y, z); this.visY = y; this.vel.set(0, 0, 0); this.vy = 0;
    this.body.setTranslation({ x, y: y + this.half + RAD, z }, true);
  }
  setCrouch(want) {
    if (want === this.crouched) return;
    const p = this.pos;
    if (!want) {       // only stand up where there is room
      const ray = new this.R.Ray({ x: p.x, y: p.y + 2 * (H_CROUCH + RAD) - 0.05, z: p.z }, { x: 0, y: 1, z: 0 });
      if (this.w.phys.castRay(ray, 2 * (H_STAND - H_CROUCH) + 0.1, true, undefined, undefined, this.col)) return;
    }
    this.crouched = want; this.half = want ? H_CROUCH : H_STAND;
    this.col.setHalfHeight(this.half);
    this.body.setTranslation({ x: p.x, y: p.y + this.half + RAD, z: p.z }, true);
  }

  // one physics step of h seconds: called just before the world steps
  step(h, env, inp) {
    const w = this.w, p = this.pos;
    if (this.seat) { inp.jump = 0; this.depth = 0; this.sprinting = false; return; }
    // ---- what you are asking for ----
    let fx = 0, fz = 0;
    if (inp.active) { fz = (inp.is('forward') ? 1 : 0) - (inp.is('back') ? 1 : 0); fx = (inp.is('right') ? 1 : 0) - (inp.is('left') ? 1 : 0); }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    if (!len) inp.tog.sprint = false;                              // a toggled sprint ends when you stop
    this.setCrouch(inp.active && inp.held('crouch'));
    this.sprinting = inp.active && inp.held('sprint') && fz > 0 && !this.crouched && this.heat > 6;
    const quiet = inp.active && inp.held('walk');
    let sp = this.crouched ? SNEAK : this.sprinting ? SPRINT : quiet ? SLOW : WALK;
    if (fz < 0) sp *= 0.8;
    const depth = this.depth = this.surface === 'snow' ? w.snowDepth(p.x, p.z) : 0;
    sp *= (1 - depth * (this.sprinting ? 0.5 : 0.4)) * this.slow;  // deep snow and the cold slow you down
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = -sy * fz + cy * fx, wz = -cy * fz - sy * fx;        // the way you want to go, in the world
    if (len && this.surface === 'snow') {                          // uphill is slower, downhill a little faster
      const g = (w.groundY(p.x + wx * 0.6, p.z + wz * 0.6) - w.groundY(p.x, p.z)) / 0.6;
      sp *= g > 0 ? 1 - clamp(g * 0.8, 0, 0.45) : 1 + clamp(-g * 0.3, 0, 0.12);
    }
    const cw = Math.cos(env.wdir), sw = Math.sin(env.wdir);
    sp *= 1 + (wx * cw + wz * sw) * 0.1 * env.gust * this.exposure; // into the wind, or with it at your back

    // ---- speed: quick to answer on snow, slow to change on ice and in the air ----
    const ice = this.surface === 'ice', k = 1 - Math.exp(-(!this.grounded ? 1.4 : ice ? 1 : 11) * h);
    this.vel.x += (wx * sp - this.vel.x) * k; this.vel.z += (wz * sp - this.vel.z) * k;
    if (ice && this.grounded) { const push = env.gust * 1.1 * this.exposure * h; this.vel.x += cw * push; this.vel.z += sw * push; }   // a gust shoves you across the ice
    const r = Math.hypot(p.x, p.z);
    this.atEdge = r > EDGE;
    if (this.atEdge) { const ox = p.x / r, oz = p.z / r, out = this.vel.x * ox + this.vel.z * oz; if (out > 0) { this.vel.x -= ox * out; this.vel.z -= oz * out; } }

    // ---- up and down ----
    inp.jump = Math.max(0, inp.jump - h);
    const firm = this.grounded && !this.steep;
    this.coyote = firm ? 0.12 : Math.max(0, this.coyote - h);
    if (firm) this.vy = -2; else this.vy = Math.max(this.vy - GRAV * h, this.grounded ? -9 : -45);
    if (inp.jump > 0 && this.coyote > 0) { this.vy = JUMP * (1 - depth * 0.3) * (this.crouched ? 0.75 : 1); inp.jump = 0; this.coyote = 0; this.grounded = false; }
    const fall = this.vy;

    // ---- the character controller works out where that really takes you ----
    _d.x = this.vel.x * h; _d.y = this.vy * h; _d.z = this.vel.z * h;
    this.cc.computeColliderMovement(this.col, _d, undefined, NO_AVATARS);
    const m = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    if (this.vy > 0 && m.y < _d.y * 0.5) this.vy = 0;              // bumped your head
    const want = Math.hypot(_d.x, _d.z), got = Math.hypot(m.x, m.z);
    if (want > 1e-5 && got < want * 0.85) {                        // a wall takes the speed that ran into it
      for (let i = 0, n = this.cc.numComputedCollisions(); i < n; i++) {
        const c = this.cc.computedCollision(i);
        if (!c || Math.abs(c.normal1.y) > 0.5) continue;
        const l = Math.hypot(c.normal1.x, c.normal1.z) || 1, ux = c.normal1.x / l, uz = c.normal1.z / l, vn = this.vel.x * ux + this.vel.z * uz;
        this.vel.x -= ux * vn; this.vel.z -= uz * vn;
      }
    }
    const t = this.body.translation();
    _n.x = t.x + m.x; _n.y = t.y + m.y; _n.z = t.z + m.z;
    this.body.setNextKinematicTranslation(_n);
    p.set(_n.x, _n.y - this.half - RAD, _n.z);

    // ---- what you are standing on ----
    const gy = w.groundY(p.x, p.z), top = Math.max(gy, SEA);
    if (p.y < top - 3) { this.teleport(p.x, top + 0.3, p.z); return; }                   // fell through the world: back on top
    this.surface = w.inShack(p) || w.inCabin(p) ? 'wood' : p.y > top + 0.4 ? 'hard' : gy < SEA ? 'ice' : 'snow';
    this.steep = this.grounded && this.surface === 'snow' && w.slopeY(p.x, p.z) < 0.74;
    this.speed = got / h;
    this.moving = this.grounded && this.speed > 0.4;
    if (this.grounded) {
      if (this.airT > 0.28 && fall < -5) { this.dip = Math.min(0.28, -fall * 0.014); if (this.onLand) this.onLand(-fall, this.surface); }
      this.airT = 0;
      if (this.speed > 0.3) {                                      // the stride: footsteps, the head bob and the legs follow it
        const before = this.phase, per = this.crouched ? 5.2 : 2.9 - clamp((this.speed - WALK) / 2.1, 0, 1) * 0.8;
        this.phase += this.speed * h * per;
        if (Math.floor(this.phase / Math.PI) !== Math.floor(before / Math.PI) && this.onStep) this.onStep(this.surface, this.sprinting ? 1.25 : this.crouched || quiet ? 0.45 : 0.85, depth);
      }
    } else this.airT += h;
  }

  // every frame: the camera and your body
  view(dt, env) {
    this.t += dt;
    const cam = this.cam, p = this.pos, k = 1 - Math.exp(-14 * dt), t = this.t;
    if (this.seat) {
      const s = this.seat, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sh = this.shiver;
      cam.position.set(s.x - sy * 0.1, s.y + 1.29, s.z - cy * 0.1);
      cam.rotation.set(this.pitch + Math.sin(t * 43.1) * 0.003 * sh, this.yaw + Math.sin(t * 47) * 0.003 * sh, Math.sin(t * 0.6) * 0.01);
      const hf = THREE.MathUtils.degToRad(clamp(+S.fov || 80, 60, 110)), vf = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / cam.aspect));
      if (Math.abs(vf - cam.fov) > 0.01) { cam.fov = vf; cam.updateProjectionMatrix(); }
      this.P.g.position.set(s.x, s.y, s.z); this.P.g.rotation.y = s.yaw + Math.PI;
      pose(this.P, { fp: true, sit: 1, hug: this.hug });
      return;
    }
    this.cr += ((this.crouched ? 1 : 0) - this.cr) * k;
    this.air += ((this.grounded ? 0 : 1) - this.air) * (1 - Math.exp(-10 * dt));
    this.sink += (this.depth * 0.2 - this.sink) * (1 - Math.exp(-6 * dt));          // your legs sink into deep snow
    const dy = p.y - this.visY;
    this.visY = this.grounded && Math.abs(dy) < 0.6 ? this.visY + dy * (1 - Math.exp(-18 * dt)) : p.y;   // steps don't jolt the view
    this.dip *= Math.exp(-7 * dt);
    this.walkAmt += ((this.grounded ? clamp(this.speed / WALK, 0, 1.5) : 0) - this.walkAmt) * k;
    const bob = S.headBob ? this.walkAmt : 0;
    const by = (0.5 - Math.abs(Math.cos(this.phase))) * 0.05 * bob, bx = Math.sin(this.phase) * 0.02 * bob;
    const eye = lerp(EYE_STAND, EYE_CROUCH, this.cr) - this.sink - this.dip + by;
    const fwd = 0.1 + 0.17 * smooth(0.35, 1.25, -this.pitch) + this.cr * 0.1;       // lean out over your chest to look down
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    cam.position.set(p.x - sy * fwd + cy * bx, this.visY + eye, p.z - cy * fwd - sy * bx);
    // shivering, and the wind buffeting your head
    const sh = this.shiver, gk = env.gust * this.exposure;
    const jx = (Math.sin(t * 47) + Math.sin(t * 31.7 + 1.3)) * 0.0035 * sh, jy = (Math.sin(t * 43.1 + 2) + Math.sin(t * 27.3)) * 0.0035 * sh;
    cam.rotation.set(this.pitch + jy + Math.sin(t * 2.3) * 0.003 * gk, this.yaw + jx, Math.sin(t * 1.7) * 0.004 * gk + Math.sin(t * 39 + 0.5) * 0.003 * sh + bx * 0.25);
    // the field of view: the setting is horizontal; sprinting opens it a little
    this.fovKick += ((this.sprinting && this.speed > 3.4 ? 1 : 0) - this.fovKick) * (1 - Math.exp(-5 * dt));
    const hf = THREE.MathUtils.degToRad(clamp(+S.fov || 80, 60, 110) + this.fovKick * 4);
    const vf = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / cam.aspect));
    if (Math.abs(vf - cam.fov) > 0.01) { cam.fov = vf; cam.updateProjectionMatrix(); }
    // your body under the camera
    const P = this.P;
    P.g.position.set(p.x, this.visY - this.sink, p.z);
    P.g.rotation.y = this.yaw + Math.PI;
    pose(P, { fp: true, crouch: this.cr, walk: this.walkAmt, phase: this.phase, air: this.air, hug: this.hug });
  }
}
