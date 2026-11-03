import * as THREE from 'three';
import { itemById, makeItemMesh, hitMat } from './data.js';
import { sfx } from './sfx.js';

// Simple falling-item physics: gravity, bounces, friction, stacking on boxes. Items fall, settle and STAY.
// Body boxes are axis aligned (the yaw only changes which side is long), which is plenty for loose loot.
const GRAV = 9.8, _a = new THREE.Box3(), _v = new THREE.Vector3();

export function buildBodyMesh(id) {
  const g = new THREE.Group(), m = makeItemMesh(itemById(id));
  g.add(m);
  const bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  m.position.sub(c);
  const hb = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.25), Math.max(size.y, 0.2), Math.max(size.z, 0.25)), hitMat);
  g.add(hb);
  const h = new THREE.Vector3(Math.max(size.x / 2, 0.03), Math.max(size.y / 2, 0.02), Math.max(size.z / 2, 0.03));
  return { g, h };
}

export class PhysWorld {
  // statics(): array of Box3 the items collide with. floorY: ground height (or a function of x,z).
  constructor(scene, statics, floorY = 0) {
    this.scene = scene; this.statics = statics; this.floorY = floorY; this.bodies = [];
  }
  ground(x, z) { return typeof this.floorY === 'function' ? this.floorY(x, z) : this.floorY; }

  add(inst, p, v = new THREE.Vector3(), ry = Math.random() * 6.28, sleep = false) {
    const { g, h } = buildBodyMesh(inst.id);
    const b = { uid: inst.uid, inst, mesh: g, h, p: p.clone(), v: v.clone(), ry, vry: sleep ? 0 : (Math.random() - 0.5) * 6, sleep, restT: 0, tgt: null };
    g.traverse(o => o.userData.body = b);
    this.scene.add(g);
    this.bodies.push(b);
    this.sync(b);
    return b;
  }
  remove(b) {
    this.scene.remove(b.mesh);
    this.bodies.splice(this.bodies.indexOf(b), 1);
    for (const o of this.bodies) o.sleep = false; // something might have rested on it
  }
  find(uid) { return this.bodies.find(b => b.uid === uid); }
  clear() { for (const b of [...this.bodies]) this.scene.remove(b.mesh); this.bodies = []; }

  half(b) {
    const c = Math.abs(Math.cos(b.ry)), s = Math.abs(Math.sin(b.ry));
    return _v.set(c * b.h.x + s * b.h.z, b.h.y, s * b.h.x + c * b.h.z).clone();
  }
  box(b, out = new THREE.Box3()) {
    const h = this.half(b);
    return out.set(b.p.clone().sub(h), b.p.clone().add(h));
  }
  sync(b) {
    b.mesh.position.copy(b.p);
    b.mesh.rotation.y = b.ry;
  }

  step(dt) {
    const n = 2, h = dt / n;
    for (let k = 0; k < n; k++) for (const b of this.bodies) if (!b.sleep) this.stepBody(b, h);
    for (const b of this.bodies) if (!b.sleep || b.dirty) { this.sync(b); b.dirty = false; }
  }

  stepBody(b, dt) {
    b.v.y -= GRAV * dt;
    b.p.addScaledVector(b.v, dt);
    b.ry += b.vry * dt;
    let grounded = false;
    const hh = this.half(b), gy = this.ground(b.p.x, b.p.z);
    if (b.p.y - hh.y < gy) {
      b.p.y = gy + hh.y;
      if (b.v.y < -1.2) {
        const hit = Math.hypot(b.v.x, b.v.y, b.v.z);
        if (b.inst.id === 'duck') sfx.squeak(Math.min(1, hit / 5)); else if (b.v.y < -2.5) sfx.tap(Math.min(1, -b.v.y / 8));
        this.onImpact?.(b, hit);
        b.v.y = -b.v.y * (b.inst.id === 'duck' ? 0.55 : 0.28);
      } else b.v.y = 0;
      grounded = true;
    }
    const me = this.box(b);
    const others = this.statics().concat(this.bodies.filter(o => o !== b).map(o => this.box(o, new THREE.Box3())));
    for (const s of others) {
      if (!me.intersectsBox(s)) continue;
      const px = Math.min(me.max.x - s.min.x, s.max.x - me.min.x);
      const py = Math.min(me.max.y - s.min.y, s.max.y - me.min.y);
      const pz = Math.min(me.max.z - s.min.z, s.max.z - me.min.z);
      const cy = (me.min.y + me.max.y) / 2, sy = (s.min.y + s.max.y) / 2;
      if (py <= px && py <= pz) {
        if (cy > sy) { b.p.y += py; if (b.v.y < 0) b.v.y = b.v.y < -1.2 ? -b.v.y * 0.25 : 0; grounded = true; }
        else { b.p.y -= py; if (b.v.y > 0) b.v.y = 0; }
      } else if (px <= pz) {
        const dir = (me.min.x + me.max.x) / 2 > (s.min.x + s.max.x) / 2 ? 1 : -1;
        b.p.x += px * dir; if (b.v.x * dir < 0) b.v.x = -b.v.x * 0.3;
      } else {
        const dir = (me.min.z + me.max.z) / 2 > (s.min.z + s.max.z) / 2 ? 1 : -1;
        b.p.z += pz * dir; if (b.v.z * dir < 0) b.v.z = -b.v.z * 0.3;
      }
      this.box(b, me);
    }
    if (grounded) { b.v.x *= 0.86; b.v.z *= 0.86; b.vry *= 0.82; }
    if (b.p.y < -5) { b.p.y = 1; b.v.set(0, 0, 0); }
    if (grounded && b.v.lengthSq() < 0.01 && Math.abs(b.vry) < 0.25) {
      if ((b.restT += dt) > 0.35) { b.sleep = true; b.v.set(0, 0, 0); b.vry = 0; b.dirty = true; }
    } else b.restT = 0;
  }

  // Snapshot for co-op: [uid, id, x, y, z, ry]
  snapshot() { return this.bodies.map(b => [b.uid, b.inst.id, +b.p.x.toFixed(3), +b.p.y.toFixed(3), +b.p.z.toFixed(3), +b.ry.toFixed(2)]); }
  // Guests: mirror the host's bodies (no simulation, smooth movement).
  mirror(list) {
    const seen = new Set();
    for (const [uid, id, x, y, z, ry] of list) {
      seen.add(uid);
      let b = this.find(uid);
      if (!b) { b = this.add({ uid, id }, new THREE.Vector3(x, y, z), undefined, ry, true); b.sleep = true; }
      b.tgt = [x, y, z, ry];
    }
    for (const b of [...this.bodies]) if (!seen.has(b.uid)) { this.scene.remove(b.mesh); this.bodies.splice(this.bodies.indexOf(b), 1); }
  }
  lerpMirror(dt) {
    const k = Math.min(1, dt * 12);
    for (const b of this.bodies) if (b.tgt) {
      b.p.x += (b.tgt[0] - b.p.x) * k; b.p.y += (b.tgt[1] - b.p.y) * k; b.p.z += (b.tgt[2] - b.p.z) * k; b.ry += (b.tgt[3] - b.ry) * k;
      this.sync(b);
    }
  }
}

// A throw from the camera: start in front of the eyes, velocity along the view.
export function throwFrom(camera, power = 4.5) {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const p = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.55);
  p.y -= 0.15;
  return { p, v: dir.multiplyScalar(power).add(new THREE.Vector3(0, 1.2, 0)) };
}
