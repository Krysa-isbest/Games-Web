// Training sentries for the test range: a violet crystal on a tripod that watches a marked zone. When you are
// inside it and in plain sight, it locks on with a laser for a moment (the tell), then fires a slow glowing bolt.
// Hide behind cover, strafe, or roll through the bolt during the roll's dodge window.
import * as THREE from 'three';
import { applyDamage } from './damage.js';
import { BODY } from './stats.js';
import { Pool } from '../core/util.js';
import { Sfx } from './sfx.js';

const LOCK = 0.9, COOL = 1.25, SPEED = 26, DAMAGE = 30, RANGE = 42, BOLT_R = 0.12, LIFE = 2.5;

// squared distance between the segments p1-q1 and p2-q2
function segDist2(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const x = rx + d1x * s - d2x * t, y = ry + d1y * s - d2y * t, z = rz + d1z * s - d2z * t;
  return x * x + y * y + z * z;
}
export { segDist2 };

export class Sentries {
  // defs: [{ x, z, yaw }], zone: { x0, x1, z0, z1 } where they shoot
  constructor(scene, phys, defs, zone, glowTex) {
    this.scene = scene; this.phys = phys; this.zone = zone;
    this.group = new THREE.Group();
    scene.add(this.group);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.6, metalness: 0.4 });
    const crystal = new THREE.MeshStandardMaterial({ color: 0x8f5cf0, emissive: 0x5a2cc0, emissiveIntensity: 0.5, roughness: 0.25, flatShading: true });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xe9dcff });
    this.laserMat = new THREE.MeshBasicMaterial({ color: 0xc49bff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.list = defs.map(d => {
      const g = new THREE.Group();
      g.position.set(d.x, 0, d.z);
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.5, 6), metal);
        const a = i * Math.PI * 2 / 3;
        leg.position.set(Math.cos(a) * 0.32, 0.7, Math.sin(a) * 0.32);
        leg.rotation.set(Math.sin(a) * 0.24, 0, -Math.cos(a) * 0.24);
        leg.castShadow = true;
        g.add(leg);
      }
      const head = new THREE.Group();
      head.position.y = 1.55;
      g.add(head);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), crystal);
      gem.scale.set(1, 1.25, 1);
      gem.castShadow = true;
      head.add(gem);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this.eyeMat.clone());
      eye.position.z = -0.28;
      head.add(eye);
      const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), this.laserMat.clone());
      laser.geometry.translate(0, 0.5, 0);
      laser.geometry.rotateX(-Math.PI / 2);          // points along -z, length 1
      laser.position.z = -0.28;
      head.add(laser);
      this.group.add(g);
      // a collider, so the sentry blocks you and its own bolts start outside it
      phys.box({ x: d.x, y: 0.9, z: d.z }, { x: 0.7, y: 1.8, z: 0.7 });
      return { g, head, eye, laser, yaw: d.yaw || 0, baseYaw: d.yaw || 0, pitch: 0, state: 'idle', t: 0, seen: 0,
        eyePos: new THREE.Vector3(d.x, 1.55, d.z) };
    });
    // bolts
    const boltGeo = new THREE.SphereGeometry(BOLT_R, 10, 8), boltMat = new THREE.MeshBasicMaterial({ color: 0xf0e6ff });
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xb98aff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xa36bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bolts = new Pool(() => {
      const m = new THREE.Mesh(boltGeo, boltMat);
      const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, BOLT_R * 0.8, 1, 6, 1, true), trailMat);
      trail.geometry.translate(0, -0.5, 0); trail.geometry.rotateX(Math.PI / 2);   // reaches back along +z
      trail.scale.set(1, 1, 1.6);
      m.add(trail);
      if (glowTex) { const s = new THREE.Sprite(glowMat); s.scale.setScalar(0.9); m.add(s); }
      m.visible = false;
      this.group.add(m);
      return { m, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, passed: false };
    }, { reset: b => { b.m.visible = false; }, size: 6 });
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  inZone(p) { const z = this.zone; return p.pos.x > z.x0 && p.pos.x < z.x1 && p.pos.z > z.z0 && p.pos.z < z.z1; }

  // can sentry s see the player's chest?
  sees(s, p) {
    const c = this._a.set(p.pos.x, p.pos.y + p.height * 0.62, p.pos.z);
    const d = this._b.subVectors(c, s.eyePos);
    const dist = d.length();
    if (dist > RANGE || dist < 0.01) return false;
    d.divideScalar(dist);
    const o = this._c.copy(s.eyePos).addScaledVector(d, 0.45);
    const h = this.phys.ray(o, d, dist - 0.45);
    return !h || h.t >= dist - 0.45 - p.height * 0.3;
  }

  step(dt, p) {
    this.time = (this.time || 0) + dt;                     // simulation time, never the wall clock
    const active = this.inZone(p) && !p.dead;
    for (const s of this.list) {
      const visible = active && this.sees(s, p);
      s.seen = visible ? 0 : s.seen + dt;
      if (s.state === 'idle') {
        if (visible) { s.state = 'lock'; s.t = 0; Sfx.sentryLock(s.eyePos.distanceTo(this._a.set(p.pos.x, p.pos.y, p.pos.z))); }
      } else if (s.state === 'lock') {
        s.t += dt;
        if (s.seen > 0.3) s.state = 'idle';
        else if (s.t >= LOCK) { this.fire(s, p); s.state = 'cool'; s.t = 0; }
      } else if (s.state === 'cool') {
        s.t += dt;
        if (s.t >= COOL) { s.state = visible ? 'lock' : 'idle'; s.t = 0; if (visible) Sfx.sentryLock(s.eyePos.distanceTo(this._a.set(p.pos.x, p.pos.y, p.pos.z))); }
      }
      // aim: track the player while locked, sweep slowly while idle
      let wantYaw = s.baseYaw + Math.sin(this.time * 0.6 + s.eyePos.x) * 0.6, wantPitch = 0;
      if (s.state !== 'idle' && !p.dead) {
        const dx = p.pos.x - s.eyePos.x, dz = p.pos.z - s.eyePos.z, dy = p.pos.y + p.height * 0.62 - s.eyePos.y;
        wantYaw = Math.atan2(-dx, -dz);
        wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      let dYaw = (wantYaw - s.yaw) % (Math.PI * 2);
      if (dYaw > Math.PI) dYaw -= Math.PI * 2; else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const k = 1 - Math.exp(-(s.state === 'idle' ? 2 : 10) * dt);
      s.yaw += dYaw * k;
      s.pitch += (wantPitch - s.pitch) * k;
    }
    // bolts
    const r = BODY.radius + BOLT_R;
    this.bolts.each(b => {
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      const seg = this._a.subVectors(b.pos, b.prev), len = seg.length();
      if (len > 1e-6) {
        const h = this.phys.ray(b.prev, seg.divideScalar(len), len);
        if (h) { Sfx.boltHit(b.pos.distanceTo(this._c.set(p.pos.x, p.pos.y, p.pos.z))); this.bolts.put(b); return; }
      }
      if (!b.passed && !p.dead) {
        const a = { x: p.pos.x, y: p.pos.y + BODY.radius, z: p.pos.z }, c = { x: p.pos.x, y: p.pos.y + p.height - BODY.radius, z: p.pos.z };
        if (segDist2(b.prev, b.pos, a, c) < r * r) {
          const res = applyDamage(p, { amount: DAMAGE, type: 'bolt', from: b.from, source: 'Training sentry' });
          if (res.dodged) b.passed = true;               // it flies on through
          else { this.bolts.put(b); return; }
        }
      }
      if (b.life <= 0) this.bolts.put(b);
    });
  }

  fire(s, p) {
    const target = this._a.set(p.pos.x, p.pos.y + p.height * 0.62, p.pos.z);
    const dir = this._b.subVectors(target, s.eyePos).normalize();
    const b = this.bolts.get();
    b.pos.copy(s.eyePos).addScaledVector(dir, 0.5);
    b.prev.copy(b.pos);
    b.vel.copy(dir).multiplyScalar(SPEED);
    b.life = LIFE; b.passed = false;
    b.from = { x: s.eyePos.x, y: s.eyePos.y, z: s.eyePos.z };
    b.m.visible = true;
    Sfx.sentryFire(s.eyePos.distanceTo(this._c.set(p.pos.x, p.pos.y, p.pos.z)));
  }

  frame(dt, alpha, p) {
    for (const s of this.list) {
      s.head.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
      const lock = s.state === 'lock' ? s.t / LOCK : 0;
      s.laser.material.opacity = lock > 0 ? 0.15 + 0.75 * lock : 0;
      if (lock > 0 && p) s.laser.scale.set(1, 1, Math.max(0.1, s.eyePos.distanceTo(this._a.set(p.pos.x, p.pos.y + p.height * 0.62, p.pos.z)) - 0.3));
      s.eye.material.color.setHex(s.state === 'lock' ? (Math.sin(performance.now() / 40) > 0 ? 0xffffff : 0xc49bff) : 0xe9dcff);
    }
    this.bolts.each(b => {
      b.m.position.lerpVectors(b.prev, b.pos, alpha);
      b.m.lookAt(this._c.copy(b.m.position).sub(b.vel));    // the trail points back along the flight
    });
  }

  dispose() { this.scene.remove(this.group); }
}
