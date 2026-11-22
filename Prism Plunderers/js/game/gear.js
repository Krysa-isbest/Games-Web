// What the raider carries, on the model: the weapons in their holsters (a carbine across the back, a pistol on
// the right thigh, the crowbar on the left hip) and the one in the hands. Guns are placed first (aiming:
// shouldered and pointing where the camera looks; low ready; sprinting; reloading; lowered while using an
// item; on the way in and out of the holster), then both arms reach for them with two-bone IK. The crowbar and
// grenades sit in the right hand, with an animated swing and throw. Drawing only: nothing here is simulation.
//
//   raider.enableGear(); raider.setGear({ weapon1: 'carbine', weapon2: 'pistol', melee: 'crowbar' })
//   raider.update(dt, { ..., hand: { active, draw, reloadK, swingK, throwK, nade, shots } })
import * as THREE from 'three';
import { makeWeapon, disposeWeapon } from './weapon-models.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
// an orientation from where the barrel points and roughly where its top faces
function basis(fwd, up) {
  const z = fwd.clone().normalize(), x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// where things rest, in the space of a body part (the model faces +z, its left is +x)
const HOLSTERS = {
  back1:  { part: 'chest',  at: V(-0.07, -0.07, -0.315), q: basis(V(0.42, 0.9, 0), V(-0.9, 0.42, 0)) },
  back2:  { part: 'chest',  at: V(0.07, -0.07, -0.37),   q: basis(V(-0.42, 0.9, 0), V(0.9, 0.42, 0)) },
  thighR: { part: 'thighR', at: V(-0.13, -0.12, 0.01),   q: basis(V(0, -1, 0), V(0, 0, 1)) },
  thighL: { part: 'thighL', at: V(0.13, -0.12, 0.01),    q: basis(V(0, -1, 0), V(0, 0, 1)) },
  hip:    { part: 'hips',   at: V(0.205, 0.08, -0.06),   q: basis(V(0, -1, -0.28), V(1, 0, 0)) },
};
// Gun poses. `at` (chest space) is where the gun's anchor point goes (a carbine's butt, a pistol's grip); `rot`
// is the gun's turn in chest space (x: barrel down, y: towards the left, z: roll). Aiming uses the camera's
// direction instead. `blade` turns the chest so the left hand reaches a long gun's handguard.
const POSES = {
  carbine: {
    anchor: 'butt',
    aim:     { at: V(-0.13, 0.15, 0.14), blade: -0.55 },
    low:     { at: V(-0.12, 0.12, 0.1), rot: Q(0.55, 0.65, 0), blade: -0.3 },
    sprint:  { at: V(-0.14, 0.0, 0.12), rot: Q(-0.6, 1.0, -0.3), blade: 0 },
    reload:  { at: V(-0.11, 0.08, 0.13), rot: Q(0.3, 0.55, 0.6), blade: -0.2 },
    lowered: { at: V(-0.14, 0.1, 0.06), rot: Q(1.0, 0.45, 0), blade: -0.1 },
    pouch: V(0.1, -0.12, 0.17),
    kick: { back: 0.035, pitch: 0.06 },
  },
  pistol: {
    anchor: 'grip',
    aim:     { at: V(-0.06, 0.24, 0.45), blade: 0 },
    low:     { at: V(-0.2, -0.12, 0.22), rot: Q(0.8, 0.15, 0), blade: 0 },
    sprint:  { at: V(-0.24, -0.2, 0.08), rot: Q(1.2, 0, 0), blade: 0 },
    reload:  { at: V(-0.05, 0.02, 0.3), rot: Q(-0.2, 0.3, 0.5), blade: 0 },
    lowered: { at: V(-0.22, -0.2, 0.12), rot: Q(1.25, 0, 0), blade: 0 },
    pouch: V(0.17, -0.25, 0.1),
    kick: { back: 0.02, pitch: 0.17 },
  },
};
// where the elbows point while the hands hold a gun (body space)
const POLE_R = V(-0.75, -0.55, -0.3).normalize();
const POLE_L = V(0.6, -0.75, -0.1).normalize();
// how a crowbar or a grenade sits in the right hand (hand space)
const ATTACH = {
  crowbar: new THREE.Matrix4().makeTranslation(0, -0.06, 0.0),
  grenade: new THREE.Matrix4().makeTranslation(0, -0.075, 0.02),
};
const FIST = 0.045;                  // from the wrist to the middle of the fist

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _bodyInv = new THREE.Matrix4(), _chestM = new THREE.Matrix4();
const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3();
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _pole = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _qk = new THREE.Quaternion(), _bq = new THREE.Quaternion();
const _basis = new THREE.Matrix4(), _s1 = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const mkPose = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
const _A = mkPose(), _B = mkPose(), _H = mkPose();

export class GearRig {
  constructor(raider, { shadows = true } = {}) {
    this.r = raider; this.shadows = shadows;
    this.items = {};                 // slot -> { kind, obj, holster }
    this.kinds = {};
    this.nade = null;
    this.kick = 0; this.shots = -1; this.wr = 0; this.blade = 0;
    this.aimQ = new THREE.Quaternion();
    const parts = { chest: raider.chest, hips: raider.hips, thighR: raider.leg.R.th, thighL: raider.leg.L.th };
    this.holsters = {};
    for (const [k, h] of Object.entries(HOLSTERS)) {
      const g = new THREE.Group();
      g.position.copy(h.at); g.quaternion.copy(h.q);
      parts[h.part].add(g);
      this.holsters[k] = g;
    }
  }
  // kinds = { weapon1, weapon2, melee }: model kinds ('carbine', 'pistol', 'crowbar') or null
  setGear(kinds) {
    for (const slot of ['weapon1', 'weapon2', 'melee']) {
      const k = kinds[slot] || null;
      if ((this.kinds[slot] || null) === k) continue;
      this.kinds[slot] = k;
      const old = this.items[slot];
      if (old) { this.r.body.remove(old.obj); disposeWeapon(old.obj); delete this.items[slot]; }
      if (k) { const obj = makeWeapon(k, this.shadows); this.r.body.add(obj); this.items[slot] = { kind: k, obj, holster: 'back1' }; }
    }
    const is = (s, k) => this.kinds[s] === k;
    for (const [slot, it] of Object.entries(this.items)) {
      if (slot === 'melee') it.holster = 'hip';
      else if (it.kind === 'pistol') it.holster = slot === 'weapon2' && is('weapon1', 'pistol') ? 'thighL' : 'thighR';
      else it.holster = slot === 'weapon2' && is('weapon1', 'carbine') ? 'back2' : 'back1';
    }
  }

  solve(dt, s) {
    const r = this.r, h = s.hand || {}, dead = s.mode === 'dead';
    const active = h.active || 'unarmed', held = this.items[active];
    const kind = active === 'throw' ? 'grenade' : held ? held.kind : null;
    const gun = kind === 'carbine' || kind === 'pistol';
    const draw = dead ? 0 : smooth(0, 1, h.draw ?? 1);
    const aim = r.w.aim, sprint = r.w.sprint * (1 - aim), use = r.w.use;
    this.wr = dt ? damp(this.wr, h.reloadK >= 0 ? 1 : 0, 14, dt) : (h.reloadK >= 0 ? 1 : 0);
    if (h.shots !== undefined) { if (this.shots >= 0 && h.shots > this.shots) this.kick = Math.min(1.5, this.kick + 1); this.shots = h.shots; }
    this.kick = dt ? damp(this.kick, 0, 16, dt) : 0;
    const P = gun ? POSES[kind] : null;
    // the weights of the gun poses, in the order they are blended
    const wS = sprint, wA = aim, wR = this.wr * (1 - 0.35 * aim), wU = use;
    // a bladed stance with a long gun: the chest turns so the left hand reaches the handguard
    let blade = 0;
    if (P && !dead) {
      blade = lerp(lerp(lerp(lerp(P.low.blade, P.sprint.blade, wS), P.aim.blade, wA), P.reload.blade, wR), P.lowered.blade, wU) * draw;
    }
    this.blade = dt ? damp(this.blade, blade, 12, dt) : blade;
    r.chest.rotation.y += this.blade;
    r.neck.rotation.y -= this.blade * 0.6;
    r.head.rotation.y -= this.blade * 0.4;
    // the crowbar and grenades: the right arm is animated by hand
    if (!dead && kind === 'crowbar') this.meleePose(h, draw);
    if (!dead && kind === 'grenade') this.throwPose(h, draw);

    r.root.updateMatrixWorld(true);
    _bodyInv.copy(r.body.matrixWorld).invert();
    _chestM.multiplyMatrices(_bodyInv, r.chest.matrixWorld);
    _chestM.decompose(_cp, _cq, _cs);
    r.body.getWorldQuaternion(_bq);
    // aiming: where the camera looks, in body space
    const pitch = clamp(s.lookPitch || 0, -0.85, 0.95), yaw = clamp(s.lookYaw || 0, -0.9, 0.9);
    this.aimQ.setFromEuler(_eul.set(-pitch, yaw, 0, 'YXZ'));

    for (const [slot, it] of Object.entries(this.items)) {
      this.holsterPose(it, _H);
      const inHand = slot === active && !dead && draw > 0;
      if (!inHand) { setLocal(it.obj, _H); continue; }
      if (gun) {
        this.gunPose(P, it.obj.userData, wS, wA, wR, wU, _A);
        if (draw < 1) { _A.p.lerp(_H.p, 1 - draw); _A.q.slerp(_H.q, 1 - draw); }    // on the way out of the holster
        setLocal(it.obj, _A);
      } else if (draw >= 0.5) this.attach(it.obj, kind);           // the crowbar comes into the hand halfway through
      else setLocal(it.obj, _H);
    }
    // a grenade in the hand
    if (kind === 'grenade' && !dead && h.nade !== false && draw > 0.3) {
      if (!this.nade) { this.nade = makeWeapon('grenade', this.shadows); r.body.add(this.nade); }
      this.nade.visible = true;
      this.attach(this.nade, 'grenade');
    } else if (this.nade) this.nade.visible = false;

    // hands on the gun
    if (gun && held && !dead) {
      const obj = held.obj, ud = obj.userData;
      obj.updateMatrixWorld();
      this.reach(r.arm.R, obj.localToWorld(_w.copy(ud.grip)), POLE_R, 1);
      let wl = kind === 'carbine' ? smooth(0.55, 0.95, draw) : wA * smooth(0.6, 1, draw);
      wl *= 1 - wU;
      const k = h.reloadK >= 0 ? h.reloadK : -1;
      let magOut = false;
      if (k >= 0) wl = Math.max(wl, this.wr * smooth(0.5, 0.9, draw) * (1 - wU));
      if (wl > 0.01) {
        const fore = obj.localToWorld(_w.copy(ud.fore));
        if (k >= 0 && this.wr > 0.01) {
          // reloading: the left hand goes to the magazine, takes it to a pouch, brings a full one back
          const mag = obj.localToWorld(_u.copy(ud.mag)), pouch = r.chest.localToWorld(_t.copy(P.pouch));
          let tgt;
          if (k < 0.18) tgt = _e.lerpVectors(fore, mag, smooth(0, 0.18, k));
          else if (k < 0.38) tgt = _e.lerpVectors(mag, pouch, smooth(0.18, 0.38, k));
          else if (k < 0.58) tgt = _e.copy(pouch);
          else if (k < 0.8) tgt = _e.lerpVectors(pouch, mag, smooth(0.58, 0.8, k));
          else tgt = _e.lerpVectors(mag, fore, smooth(0.8, 1, k));
          magOut = k > 0.18 && k < 0.8;
          fore.lerp(tgt, this.wr);
        }
        this.reach(r.arm.L, fore, POLE_L, wl);
      }
      if (ud.magMesh) {
        if (magOut && wl > 0.5) {
          r.arm.L.hand.localToWorld(_t.set(0, -0.07, 0.02));
          ud.magMesh.position.copy(obj.worldToLocal(_t));
        } else ud.magMesh.position.copy(ud.magBase);
      }
    }
  }

  // the gun's pose in body space: the poses blended by their weights, plus the recoil
  gunPose(P, ud, wS, wA, wR, wU, out) {
    const anchor = ud[P.anchor];
    this.poseOf(P.low, anchor, out);
    if (wS > 0.001) { this.poseOf(P.sprint, anchor, _B); blend(out, _B, wS); }
    if (wA > 0.001) { this.poseOf(null, anchor, _B, P.aim.at); blend(out, _B, wA); }
    if (wR > 0.001) { this.poseOf(P.reload, anchor, _B); blend(out, _B, wR); }
    if (wU > 0.001) { this.poseOf(P.lowered, anchor, _B); blend(out, _B, wU); }
    if (this.kick > 0.001) {
      out.p.addScaledVector(_t.set(0, 0, -1).applyQuaternion(out.q), P.kick.back * this.kick);
      out.q.multiply(_qk.setFromAxisAngle(AXIS_X, -P.kick.pitch * this.kick));
    }
    return out;
  }
  poseOf(ps, anchor, out, aimAt = null) {
    if (ps) out.q.copy(_cq).multiply(ps.rot); else out.q.copy(this.aimQ);
    out.p.copy(ps ? ps.at : aimAt).applyMatrix4(_chestM).sub(_t.copy(anchor).applyQuaternion(out.q));
    return out;
  }
  holsterPose(it, out) {
    _m.multiplyMatrices(_bodyInv, this.holsters[it.holster].matrixWorld);
    _m.decompose(out.p, out.q, _s1);
    return out;
  }
  // a crowbar or a grenade, in the right hand
  attach(obj, kind) {
    _m.multiplyMatrices(_bodyInv, this.r.arm.R.hand.matrixWorld).multiply(ATTACH[kind]);
    _m.decompose(obj.position, obj.quaternion, _s1);
  }

  // Two-bone IK for an arm: the fist closes on `world` (a point), the elbow bending towards `poleBody`.
  // weight blends from the animated pose (0) to the reach (1).
  reach(arm, world, poleBody, weight) {
    const sh = arm.up.parent;
    const a = -arm.el.position.y, b = -arm.hand.position.y;
    _inv.copy(sh.matrixWorld).invert();
    const T = _u.copy(world).applyMatrix4(_inv);
    _pole.copy(poleBody).applyQuaternion(_bq).transformDirection(_inv);
    let bend = this.solveArm(T, _pole, a, b, _qa);
    // again, with the wrist pulled back along the forearm so the fist (not the wrist) is on the point
    T.addScaledVector(_f, -FIST);
    bend = this.solveArm(T, _pole, a, b, _qa);
    arm.up.quaternion.slerp(_qa, weight);
    arm.el.quaternion.slerp(_qe.setFromAxisAngle(AXIS_X, -bend), weight);
    arm.up.updateMatrixWorld(true);
  }
  // in the shoulder's space: the upper arm's turn (into q) and the elbow's bend; leaves the forearm direction in _f
  solveArm(T, pole, a, b, q) {
    const d0 = Math.max(1e-5, T.length()), d = clamp(d0, 0.06, (a + b) * 0.999);
    const dir = _x.copy(T).divideScalar(d0);
    _n.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (_n.lengthSq() < 1e-8) _n.set(0, 0, 1).addScaledVector(dir, -dir.z);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0).addScaledVector(dir, -dir.x);
    _n.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    _e.copy(dir).multiplyScalar(a * cosA).addScaledVector(_n, a * sinA);           // the elbow
    _f.copy(dir).multiplyScalar(d).sub(_e).normalize();                            // the forearm
    _y.copy(_e).normalize().negate();                                              // the upper arm hangs along -y
    _z.copy(_f).addScaledVector(_y, -_f.dot(_y));
    if (_z.lengthSq() < 1e-10) _z.copy(_n);
    _z.normalize();
    _w.crossVectors(_y, _z);
    q.setFromRotationMatrix(_basis.makeBasis(_w, _y, _z));
    return Math.acos(clamp(-_y.dot(_f), -1, 1));
  }

  // the crowbar in the right hand: ready, wind up, strike, recover. Drawing it: the hand comes from the hip.
  meleePose(h, draw) {
    const r = this.r, a = r.arm.R, k = h.swingK ?? -1;
    let ux = -0.45, uz = -0.18, ex = -1.25, tw = 0;
    if (k >= 0) {
      if (k < 0.35) { const t = smooth(0, 0.35, k); ux = lerp(-0.45, -2.75, t); uz = lerp(-0.18, -0.45, t); ex = lerp(-1.25, -1.9, t); tw = lerp(0, -0.45, t); }
      else if (k < 0.55) { const t = smooth(0.35, 0.55, k); ux = lerp(-2.75, -0.55, t); uz = lerp(-0.45, 0.3, t); ex = lerp(-1.9, -0.25, t); tw = lerp(-0.45, 0.42, t); }
      else { const t = smooth(0.55, 1, k); ux = lerp(-0.55, -0.45, t); uz = lerp(0.3, -0.18, t); ex = lerp(-0.25, -1.25, t); tw = lerp(0.42, 0, t); }
    }
    ux = lerp(-0.15, ux, draw); uz = lerp(0.3, uz, draw); ex = lerp(-0.5, ex, draw);
    a.up.rotation.set(ux, 0, uz);
    a.el.rotation.set(ex, 0, 0);
    r.chest.rotation.y += tw; r.spine.rotation.y += tw * 0.4;
  }
  // a grenade: held up, wound back, thrown over the shoulder
  throwPose(h, draw) {
    const r = this.r, a = r.arm.R, l = r.arm.L, k = h.throwK ?? -1;
    let ux = -0.75, uz = -0.3, ex = -1.35, tw = 0, lx = null;
    if (k >= 0) {
      if (k < 0.35) { const t = smooth(0, 0.35, k); ux = lerp(-0.75, -2.5, t); uz = lerp(-0.3, -0.55, t); ex = lerp(-1.35, -1.7, t); tw = lerp(0, -0.4, t); lx = lerp(-0.3, -1.3, t); }
      else if (k < 0.55) { const t = smooth(0.35, 0.55, k); ux = lerp(-2.5, -0.35, t); uz = lerp(-0.55, 0.1, t); ex = lerp(-1.7, -0.3, t); tw = lerp(-0.4, 0.35, t); lx = lerp(-1.3, -0.2, t); }
      else { const t = smooth(0.55, 1, k); ux = lerp(-0.35, -0.75, t); uz = lerp(0.1, -0.3, t); ex = lerp(-0.3, -1.35, t); tw = lerp(0.35, 0, t); }
    }
    ux = lerp(-0.2, ux, draw); uz = lerp(0.25, uz, draw); ex = lerp(-0.6, ex, draw);
    a.up.rotation.set(ux, 0, uz);
    a.el.rotation.set(ex, 0, 0);
    if (lx !== null) { l.up.rotation.x = lx; l.el.rotation.x = -0.4; }
    r.chest.rotation.y += tw; r.spine.rotation.y += tw * 0.4;
  }

  // the muzzle of the gun in the hands, in the world (for tracers and the flash), or null
  muzzle(active, out) {
    const it = this.items[active];
    if (!it || !it.obj.userData.muzzle || (it.kind !== 'carbine' && it.kind !== 'pistol')) return null;
    it.obj.updateMatrixWorld();
    return it.obj.localToWorld(out.copy(it.obj.userData.muzzle));
  }
  dispose() {
    for (const it of Object.values(this.items)) { this.r.body.remove(it.obj); disposeWeapon(it.obj); }
    if (this.nade) { this.r.body.remove(this.nade); disposeWeapon(this.nade); }
    for (const g of Object.values(this.holsters)) g.parent?.remove(g);
    this.items = {};
  }
}
const _eul = new THREE.Euler();
function blend(a, b, t) { a.p.lerp(b.p, t); a.q.slerp(b.q, t); }
function setLocal(obj, pose) { obj.position.copy(pose.p); obj.quaternion.copy(pose.q); }
