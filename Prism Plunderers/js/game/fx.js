// Visual effects: tracers, flashes, sparks, explosions, smoke, ground rings and beams. Everything comes from
// pools and only lives in drawing (frame), never in the simulation. The Effects setting at Low (part 7) halves
// the sparks and drops about half the smoke puffs.
import * as THREE from 'three';
import { S } from '../core/save.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

// a unit cylinder from (0,0,0) to (0,1,0), stretched and turned to join two points
function stretch(mesh, a, b) {
  tmp.subVectors(b, a);
  const len = tmp.length();
  mesh.position.copy(a);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, tmp.divideScalar(len));
  mesh.scale.y = Math.max(len, 1e-3);
  return len;
}

export class Fx {
  constructor(scene, glowTex) {
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    scene.add(this.group);
    this.glow = glowTex;
    this.live = [];
    const cyl = this.cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    cyl.translate(0, 0.5, 0);
    this.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 48);
    this.free = { tracer: [], sprite: [], smoke: [], ring: [], ball: [] };
  }
  take(kind, make) { const o = this.free[kind].pop() || make(); o.visible = true; this.group.add(o); return o; }
  add(kind, o, life, update) { this.live.push({ kind, o, age: 0, life, update }); return o; }
  addMat(color, opacity, additive = true) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
  }

  // a bright line that fades fast: a shot
  tracer(a, b, color = 0xffe7b0, width = 0.025, life = 0.07) {
    const m = this.take('tracer', () => new THREE.Mesh(this.cyl, this.addMat(color, 1)));
    m.material.color.setHex(color);
    stretch(m, a, b);
    m.scale.x = m.scale.z = width;
    return this.add('tracer', m, life, (o, k) => { o.material.opacity = 1 - k; });
  }
  // a glowing dot that pops and fades: muzzle flash, impact, beacon
  flash(pos, color = 0xffffff, size = 0.6, life = 0.08) {
    const s = this.take('sprite', () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    s.material.color.setHex(color);
    s.position.copy(pos);
    s.scale.setScalar(size);
    return this.add('sprite', s, life, (o, k) => { o.material.opacity = 1 - k; o.scale.setScalar(size * (1 + k * 0.6)); });
  }
  // small hot bits flying out of a hit
  sparks(pos, color = 0xffd08a, n = 6, speed = 4) {
    if (S.effects === 'low') n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const s = this.take('sprite', () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      s.material.color.setHex(color);
      s.position.copy(pos);
      s.scale.setScalar(0.12);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.add('sprite', s, 0.25 + Math.random() * 0.25, (o, k, dt) => { v.y -= 14 * dt; o.position.addScaledVector(v, dt); o.material.opacity = 1 - k; });
    }
  }
  // a puff of smoke that rises and spreads
  smoke(pos, size = 0.8, life = 1.6, color = 0x2a2628, rise = 0.8) {
    if (S.effects === 'low' && Math.random() < 0.5) return null;
    const s = this.take('smoke', () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false })));
    s.material.color.setHex(color);
    s.position.copy(pos);
    const drift = new THREE.Vector3((Math.random() - 0.5) * 0.4, rise, (Math.random() - 0.5) * 0.4);
    return this.add('smoke', s, life, (o, k, dt) => {
      o.position.addScaledVector(drift, dt);
      o.scale.setScalar(size * (0.6 + k * 1.4));
      o.material.opacity = 0.7 * (1 - k) * Math.min(1, k * 6);
    });
  }
  // a flat ring on the ground: a warning (it grows to its size and holds) or a pulse (it spreads and fades)
  ring(pos, radius, color = 0xff4d3d, life = 1, mode = 'pulse') {
    const r = this.take('ring', () => { const m = new THREE.Mesh(this.ringGeo, this.addMat(color, 0.8)); m.rotation.x = -Math.PI / 2; return m; });
    r.material.color.setHex(color);
    r.position.set(pos.x, pos.y + 0.05, pos.z);
    return this.add('ring', r, life, (o, k) => {
      if (mode === 'pulse') { o.scale.setScalar(radius * (0.2 + k * 0.8)); o.material.opacity = 0.8 * (1 - k); }
      else { o.scale.setScalar(radius * Math.min(1, k * 4)); o.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(k * 18)); }
    });
  }
  // an explosion: a flash, a fireball, a shock ring and smoke. size ~ blast radius
  explosion(pos, size = 1, color = 0xc49bff) {
    this.flash(pos, 0xffffff, size * 3.2, 0.12);
    const b = this.take('ball', () => new THREE.Mesh(this.sphere, this.addMat(color, 0.9)));
    b.material.color.setHex(color);
    b.position.copy(pos);
    this.add('ball', b, 0.45, (o, k) => { o.scale.setScalar(size * (0.3 + k * 1.1)); o.material.opacity = 0.9 * (1 - k) * (1 - k); });
    this.ring({ x: pos.x, y: pos.y - 0.3, z: pos.z }, size * 2.2, color, 0.5);
    for (let i = 0; i < Math.round(3 + size * 2); i++) {
      const p = new THREE.Vector3(pos.x + (Math.random() - 0.5) * size, pos.y + Math.random() * size * 0.5, pos.z + (Math.random() - 0.5) * size);
      this.smoke(p, size * 1.2, 1.4 + Math.random(), 0x2a2628, 1.2);
    }
    this.sparks(pos, 0xffcf8a, Math.round(6 + size * 4), 6 + size * 2);
  }
  // a beam (a robot's laser): call set() every frame while it shows, hide() when done
  beam(color = 0xc49bff, width = 0.02) {
    const m = new THREE.Mesh(this.cyl, this.addMat(color, 0));
    m.scale.x = m.scale.z = width;
    m.visible = false;
    this.group.add(m);
    const core = new THREE.Mesh(this.cyl, this.addMat(0xffffff, 0));
    core.scale.x = core.scale.z = width * 0.35;
    m.add(core);
    return {
      mesh: m,
      set(a, b, opacity = 1, w = width) {
        m.visible = opacity > 0.01;
        if (!m.visible) return;
        const len = stretch(m, a, b);
        m.scale.x = m.scale.z = w;
        core.scale.set(0.35, 1, 0.35);
        m.material.opacity = opacity * 0.8; core.material.opacity = opacity;
        return len;
      },
      hide() { m.visible = false; },
      dispose: () => { this.group.remove(m); m.material.dispose(); core.material.dispose(); },
    };
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.age += dt;
      const k = Math.min(1, e.age / e.life);
      e.update?.(e.o, k, dt);
      if (e.age >= e.life) {
        e.o.visible = false;
        this.group.remove(e.o);
        this.free[e.kind].push(e.o);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
      }
    }
  }
  dispose() { this.group.parent?.remove(this.group); }
}
