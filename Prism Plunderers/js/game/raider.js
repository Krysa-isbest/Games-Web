// The raider: the player character's 3D model and its animation, all made in code (no model file to download).
// The body is built from simple shapes on a skeleton of joints. The animation is procedural: each frame a pose
// is worked out from the player's state, with the feet placed by two-bone IK so they plant on the ground while
// walking, running and sprinting, and blends for crouching, sliding, the dodge roll, jumping and landing,
// aiming, using a station, taking a hit and dying. The lobby shows the same model, idling.
//
//   const r = new Raider();  scene.add(r.root);
//   r.root.position / r.root.rotation.y = facing + Math.PI   (the model faces +z)
//   const step = r.update(dt, state);   // 'L' or 'R' on a footstep, else null
import * as THREE from 'three';
import { GearRig } from './gear.js';

const LEG = 0.43;            // thigh and shin length
const UPPER = 0.3, FORE = 0.27;   // upper arm and forearm (shoulder to elbow, elbow to wrist)
const ANKLE = 0.088;         // ankle joint above the sole
const HIP_Y = 0.95;          // hips height when standing
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

export const RAIDER_COLORS = {
  suit: 0x8f8a80, pants: 0x57554f, vest: 0x4b4f44, dark: 0x26262a, sole: 0x151517,
  helmet: 0xdcd8d0, accent: 0xffb224, scarf: 0x8a5236, visor: 0x173634,
};

// two-bone IK in the leg's forward plane. dz = forward, dy = up, both from the hip joint to the ankle target.
function solveLeg(leg, dz, dy) {
  const a = LEG, b = LEG;
  const d = clamp(Math.hypot(dz, dy), 0.12, a + b - 0.0005);
  const knee = Math.PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  const base = Math.atan2(dz, -dy);
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const thigh = base + alpha;                       // the knee bends forward
  leg.th.rotation.x = -thigh;
  leg.kn.rotation.x = knee;
  leg.an.rotation.x = thigh - knee;                 // the sole stays level
}

export class Raider {
  constructor({ colors = {}, shadows = true } = {}) {
    const c = { ...RAIDER_COLORS, ...colors };
    const M = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const mat = {
      suit: M(c.suit), pants: M(c.pants), vest: M(c.vest), dark: M(c.dark, 0.72), sole: M(c.sole, 0.9),
      helmet: M(c.helmet, 0.38), scarf: M(c.scarf, 0.95),
      accent: new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 0.2, roughness: 0.5 }),
      visor: new THREE.MeshStandardMaterial({ color: c.visor, roughness: 0.08, metalness: 0.9, emissive: 0x0b2b2a, emissiveIntensity: 0.6 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
    };
    this.mats = mat;
    const root = this.root = new THREE.Group();
    root.userData.raider = true;
    const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const part = (parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.scale.set(sx, sy, sz);
      mesh.castShadow = shadows;
      parent.add(mesh);
      return mesh;
    };
    // a capsule hanging down from its joint, ending `len` below it
    const limb = (parent, r, len, m) => part(parent, new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 4, 10), m, 0, -(len - r) / 2, 0);

    const body = this.body = joint(root, 0, 0, 0);                    // pivot for the roll and the fall
    const hips = this.hips = joint(body, 0, HIP_Y, 0);
    part(hips, new THREE.BoxGeometry(0.32, 0.17, 0.21), mat.pants, 0, -0.03, 0);
    part(hips, new THREE.BoxGeometry(0.35, 0.06, 0.235), mat.dark, 0, 0.04, 0);                       // belt
    for (const x of [-0.11, 0.11]) part(hips, new THREE.BoxGeometry(0.08, 0.08, 0.05), mat.vest, x, 0, 0.13);
    part(hips, new THREE.BoxGeometry(0.06, 0.1, 0.11), mat.vest, -0.19, -0.01, -0.03);                 // hip pouch

    const spine = this.spine = joint(hips, 0, 0.06, 0);
    part(spine, new THREE.CapsuleGeometry(0.135, 0.06, 4, 12), mat.suit, 0, 0.08, 0, 0, 0, 0, 1, 1, 0.78);
    const chest = this.chest = joint(spine, 0, 0.17, 0);
    part(chest, new THREE.CylinderGeometry(0.19, 0.15, 0.36, 12), mat.suit, 0, 0.06, 0, 0, 0, 0, 1, 1, 0.72);   // jacket
    part(chest, new THREE.BoxGeometry(0.36, 0.29, 0.25), mat.vest, 0, 0.07, 0.01);                     // vest
    for (const x of [-0.1, 0, 0.1]) part(chest, new THREE.BoxGeometry(0.085, 0.09, 0.05), mat.vest, x, -0.02, 0.145);
    part(chest, new THREE.BoxGeometry(0.028, 0.028, 0.012), mat.accent, 0.11, 0.17, 0.133);            // status light
    part(chest, new THREE.BoxGeometry(0.045, 0.31, 0.02), mat.dark, 0.06, 0.08, 0.135, 0, 0, 0.42);    // strap
    part(chest, new THREE.BoxGeometry(0.31, 0.38, 0.17), mat.dark, 0, 0.05, -0.2);                     // backpack
    part(chest, new THREE.BoxGeometry(0.24, 0.16, 0.06), mat.vest, 0, -0.03, -0.3);
    part(chest, new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), mat.suit, 0, 0.29, -0.2, 0, 0, Math.PI / 2);   // bedroll
    part(chest, new THREE.CylinderGeometry(0.006, 0.006, 0.42, 4), mat.dark, -0.12, 0.43, -0.25);      // antenna
    part(chest, new THREE.SphereGeometry(0.016, 6, 4), mat.accent, -0.12, 0.64, -0.25);
    part(chest, new THREE.TorusGeometry(0.085, 0.04, 6, 14), mat.scarf, 0, 0.245, 0.01, Math.PI / 2);  // scarf

    const neck = this.neck = joint(chest, 0, 0.25, 0);
    part(neck, new THREE.CylinderGeometry(0.055, 0.06, 0.09, 10), mat.dark, 0, 0.03, 0);
    const head = this.head = joint(neck, 0, 0.1, 0);
    part(head, new THREE.SphereGeometry(0.162, 16, 12), mat.suit, 0, 0.03, -0.05, 0, 0, 0, 1, 1.05, 1);        // hood
    part(head, new THREE.SphereGeometry(0.135, 18, 14), mat.helmet, 0, 0.035, 0);                     // helmet
    part(head, new THREE.SphereGeometry(0.141, 24, 10, Math.PI / 2 - 0.95, 1.9, 1.12, 0.5), mat.visor, 0, 0.035, 0.004);
    part(head, new THREE.BoxGeometry(0.03, 0.03, 0.2), mat.helmet, 0, 0.167, -0.01);                  // ridge
    part(head, new THREE.CylinderGeometry(0.045, 0.055, 0.07, 10), mat.dark, 0, -0.07, 0.11, Math.PI / 2.4);   // respirator
    for (const x of [-0.05, 0.05]) part(head, new THREE.CylinderGeometry(0.022, 0.022, 0.04, 8), mat.dark, x, -0.085, 0.1, Math.PI / 2.4);
    part(head, new THREE.CylinderGeometry(0.024, 0.024, 0.055, 8), mat.dark, 0.135, 0.07, 0.03, 0, 0, Math.PI / 2);   // lamp
    part(head, new THREE.CircleGeometry(0.018, 10), mat.lamp, 0.164, 0.07, 0.03, 0, Math.PI / 2);

    // arms: side +1 = the raider's left (+x, the model faces +z), -1 = right
    this.arm = {};
    for (const s of [1, -1]) {
      const sh = joint(chest, s * 0.215, 0.18, 0);
      part(sh, new THREE.SphereGeometry(0.083, 10, 8), mat.suit);
      const up = joint(sh, 0, 0, 0);
      limb(up, 0.056, UPPER + 0.02, mat.suit);
      if (s > 0) part(up, new THREE.BoxGeometry(0.02, 0.2, 0.118), mat.accent, 0.051, -0.15, 0);     // the stripe on the left sleeve
      const el = joint(up, 0, -UPPER, 0);
      limb(el, 0.049, FORE - 0.005, mat.suit);
      part(el, new THREE.CylinderGeometry(0.056, 0.056, 0.06, 10), mat.dark, 0, -FORE + 0.065, 0);    // cuff
      const hand = joint(el, 0, -FORE, 0);
      part(hand, new THREE.BoxGeometry(0.075, 0.1, 0.085), mat.dark, 0, -0.035, 0.005);               // glove
      this.arm[s > 0 ? 'L' : 'R'] = { up, el, hand, side: s };
    }
    // legs
    this.leg = {};
    for (const s of [1, -1]) {
      const th = joint(hips, s * 0.1, -0.02, 0);
      limb(th, 0.084, LEG, mat.pants);
      part(th, new THREE.BoxGeometry(0.05, 0.13, 0.12), mat.vest, s * 0.088, -0.2, 0);               // thigh pocket
      const kn = joint(th, 0, -LEG, 0);
      limb(kn, 0.068, LEG - 0.08, mat.pants);
      part(kn, new THREE.BoxGeometry(0.1, 0.12, 0.045), mat.dark, 0, -0.03, 0.06);                    // knee pad
      part(kn, new THREE.CylinderGeometry(0.075, 0.07, 0.17, 10), mat.dark, 0, -0.35, 0);             // boot shaft
      const an = joint(kn, 0, -LEG, 0);
      part(an, new THREE.BoxGeometry(0.115, 0.1, 0.26), mat.dark, 0, -0.035, 0.045);                  // boot
      part(an, new THREE.BoxGeometry(0.122, 0.026, 0.272), mat.sole, 0, -0.075, 0.045);               // sole
      this.leg[s > 0 ? 'L' : 'R'] = { th, kn, an, side: s, off: s > 0 ? 0 : 0.5 };
    }

    this.t = 0;
    this.phase = 0;
    this.w = { gait: 0, crouch: 0, air: 0, slide: 0, aim: 0, sprint: 0, roll: 0, use: 0 };
    this.hipYaw = 0;
    this.lean = 0;
    this.rig = null;
    this.shadows = shadows;
    this.solve(0, {});                                // a standing pose straight away
  }
  // weapons on the model: holsters, and the hands on whatever is held (gear.js)
  enableGear() { if (!this.rig) this.rig = new GearRig(this, { shadows: this.shadows }); return this.rig; }
  setGear(kinds) { this.enableGear().setGear(kinds); }
  // the muzzle of the gun in the hands, in the world, or null
  muzzle(active, out) { return this.rig ? this.rig.muzzle(active, out) : null; }

  // s = { mode, speed, fwd, side, grounded, vy, crouch, sprint, aim, rollT (0..1), deathT, landT, landPower,
  //       hurtT, turn, using, lookYaw, lookPitch, idle, hand (what is held: see gear.js) }
  update(dt, s) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.t += dt;
    return this.solve(dt, s);
  }

  solve(dt, s) {
    const w = this.w, t = this.t;
    const mode = s.mode || 'move';
    const dead = mode === 'dead', rolling = mode === 'roll', sliding = mode === 'slide';
    const grounded = s.grounded !== false;
    const sp = s.speed || 0;
    const moving = grounded && !dead && !rolling && !sliding && sp > 0.15;

    // walking backwards and sideways (while aiming): the legs turn into the direction of travel
    let dirAng = moving ? Math.atan2(s.side || 0, s.fwd ?? sp) : 0, back = false;
    if (Math.abs(dirAng) > 1.95) { back = true; dirAng = wrapPi(dirAng - Math.PI); }
    this.hipYaw = damp(this.hipYaw, moving ? clamp(dirAng, -0.95, 0.95) : 0, 8, dt);

    w.gait = damp(w.gait, moving ? smooth(0.15, 1.4, sp) : 0, 10, dt);
    w.crouch = damp(w.crouch, s.crouch && !sliding && !rolling && !dead ? 1 : 0, 10, dt);
    w.air = damp(w.air, !grounded && !rolling && !dead ? 1 : 0, 12, dt);
    w.slide = damp(w.slide, sliding ? 1 : 0, 14, dt);
    w.aim = damp(w.aim, s.aim && !dead ? 1 : 0, 12, dt);
    w.sprint = damp(w.sprint, s.sprint ? 1 : 0, 6, dt);
    w.roll = damp(w.roll, rolling ? 1 : 0, 22, dt);
    w.use = damp(w.use, s.using && !dead ? 1 : 0, 8, dt);

    // the gait cycle, advanced by the distance actually covered, so the feet do not skate
    const L = (1.3 + 0.32 * sp) * (1 - 0.15 * w.crouch);
    let step = null;
    if (moving) {
      const before = this.phase, dir = back ? -1 : 1;
      this.phase = ((this.phase + dir * sp * dt / L) % 1 + 1) % 1;
      if (crossed(before, this.phase, 0, dir)) step = 'L';
      else if (crossed(before, this.phase, 0.5, dir)) step = 'R';
    }
    const gait = w.gait;
    const stance = 0.62 - 0.24 * smooth(2.2, 6.5, sp);
    const amp = Math.min(0.42, stance * L * 0.5) * (1 - 0.3 * w.crouch);
    const lift = (0.07 + 0.035 * sp) * (1 - 0.4 * w.crouch);
    const footAt = u => {
      if (u < stance) { const k = u / stance; return [amp * (1 - 2 * k), 0]; }
      const k = (u - stance) / (1 - stance), e = k * k * (3 - 2 * k);
      return [-amp + 2 * amp * e, lift * Math.pow(Math.sin(Math.PI * k), 0.8)];
    };

    // hips height
    let hipY = HIP_Y - 0.03 * gait * smooth(4, 7, sp) - 0.34 * w.crouch;
    hipY += gait * (0.012 + 0.005 * sp) * Math.cos(this.phase * TAU * 2);
    hipY -= (s.landPower || 0) * 0.17 * Math.exp(-(s.landT ?? 9) * 9);
    hipY = lerp(hipY, 0.5, w.slide);
    hipY = lerp(hipY, 0.62, w.roll);

    // legs
    const fall = clamp(-(s.vy || 0) / 8, 0, 1);
    for (const id of ['L', 'R']) {
      const lg = this.leg[id], left = id === 'L';
      const [fz, fy] = footAt((this.phase + lg.off) % 1);
      let z = fz * gait + (1 - gait) * (left ? 0.04 : -0.05) + w.crouch * (1 - gait) * (left ? 0.1 : -0.12);
      let y = fy * gait;
      z = lerp(z, left ? 0.2 : -0.12, w.air);
      y = lerp(y, (left ? 0.36 : 0.24) * (1 - 0.6 * fall), w.air);
      z = lerp(z, left ? 0.62 : 0.0, w.slide);
      y = lerp(y, left ? 0.02 : 0.08, w.slide);
      let dz = z, dy = ANKLE + y - (hipY - 0.02);
      dz = lerp(dz, 0.22, w.roll);
      dy = lerp(dy, -0.3, w.roll);
      if (dead) { dz = left ? 0.12 : 0.02; dy = -0.8; }
      solveLeg(lg, dz, dy);
      lg.th.rotation.z = lg.side * (0.03 + 0.1 * w.crouch + 0.06 * w.air);
    }

    // torso
    const lean = 0.035 * sp * gait * (back ? -0.6 : 1) + 0.3 * w.crouch - 0.38 * w.slide - 0.06 * w.air + 0.25 * w.use;
    this.lean = dt ? damp(this.lean, lean, 8, dt) : lean;
    const twist = gait * Math.sin(this.phase * TAU) * (0.07 + 0.02 * sp);
    const hurt = Math.exp(-(s.hurtT ?? 9) * 9);
    const breathe = Math.sin(t * 1.7) * 0.012 * (1 - gait);
    const lookYaw = clamp(s.lookYaw || 0, -1.2, 1.2), lookPitch = clamp(s.lookPitch || 0, -0.9, 0.9);
    this.hips.rotation.set(0, this.hipYaw + twist * 0.6, 0);
    this.spine.rotation.set(this.lean * 0.55, -this.hipYaw * 0.55 - twist, clamp(-(s.turn || 0) * 0.025 * sp, -0.22, 0.22));
    this.chest.rotation.set(this.lean * 0.45 - lookPitch * 0.45 * w.aim + breathe - hurt * 0.3, -this.hipYaw * 0.45, 0);
    this.neck.rotation.set(0, lookYaw * 0.3, 0);
    this.head.rotation.set(-lookPitch * 0.6 * (1 - 0.4 * w.aim) - hurt * 0.2, lookYaw * 0.65, 0);

    // arms
    const swing = gait * (0.22 + 0.085 * sp) * (1 - w.aim) * (1 - w.slide);
    const elbow = 0.25 + 0.12 * sp * gait + 0.7 * w.sprint * gait;
    for (const id of ['L', 'R']) {
      const a = this.arm[id], sd = a.side, left = id === 'L';
      const opp = (this.phase + (left ? 0.5 : 0)) % 1;            // an arm swings with the opposite leg
      let ux = -Math.cos(opp * TAU) * swing * (back ? -1 : 1), uy = 0, uz = sd * (0.1 + 0.05 * gait), ex = -elbow;
      ux -= 0.25 * w.crouch; ex -= 0.5 * w.crouch;
      ux = lerp(ux, -0.35, w.air); uz = lerp(uz, sd * 0.6, w.air); ex = lerp(ex, -0.5, w.air);
      ux = lerp(ux, left ? 0.5 : -1.1, w.slide); uz = lerp(uz, sd * (left ? 0.55 : 0.25), w.slide); ex = lerp(ex, left ? -0.2 : -0.9, w.slide);
      // ready pose while aiming
      ux = lerp(ux, left ? -1.25 : -1.05, w.aim); uy = lerp(uy, left ? -0.35 : 0.25, w.aim);
      uz = lerp(uz, left ? 0.42 : -0.12, w.aim); ex = lerp(ex, left ? -1.05 : -1.35, w.aim);
      // working at a station
      const wob = Math.sin(t * 7 + sd) * 0.12;
      ux = lerp(ux, -0.85 + wob, w.use); uz = lerp(uz, sd * 0.15, w.use); ex = lerp(ex, -0.95, w.use);
      // tucked in the roll
      ux = lerp(ux, -0.9, w.roll); uz = lerp(uz, sd * 0.3, w.roll); ex = lerp(ex, -2.0, w.roll);
      if (dead) { ux = 0.3; uy = 0; uz = sd * 1.1; ex = -0.3; }
      a.up.rotation.set(ux, uy, uz);
      a.el.rotation.set(ex, 0, 0);
    }

    // the whole-body pivot: the roll and the fall
    let pivotY = 0.52 * w.roll, rot = rolling ? TAU * smooth(0.04, 0.92, s.rollT || 0) : 0;
    if (dead) {
      const k = smooth(0, 0.75, s.deathT || 0);
      pivotY = 0.1; rot = -1.42 * k;
      hipY = HIP_Y;
      this.head.rotation.set(0.25 * k, 0.45 * k, 0);
    }
    this.body.position.y = pivotY;
    this.body.rotation.x = rot;
    this.hips.position.set(Math.sin(t * 0.45) * 0.012 * (1 - gait) * (s.idle ? 1 : 0.4), hipY - pivotY, 0);
    if (this.rig) this.rig.solve(dt, s);
    return step;
  }

  dispose() {
    this.rig?.dispose();
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

// did the cycle pass `mark` going from a to b in direction dir?
function crossed(a, b, mark, dir) {
  if (dir > 0) return a <= b ? a < mark && b >= mark : a < mark || b >= mark;
  return a >= b ? a > mark && b <= mark : a > mark || b <= mark;
}
