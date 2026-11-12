// Whiteout: your hands in first person. The sleeve and glove of your coat holding what is in your selected
// hotbar slot, the axe swing, the lighter in your other hand (it lights up the dark), and wood chips flying.
import * as THREE from 'three';
import { meshFor } from './items.js';
import { glowTex } from './scene.js';

export class Hands {
  constructor(camera, scene) {
    this.cam = camera; this.root = new THREE.Group(); camera.add(this.root);
    this.sleeve = new THREE.MeshStandardMaterial({ color: '#b4462e', roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.9 });
    const arm = () => {
      const g = new THREE.Group();
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), this.sleeve); s.position.z = 0.22; g.add(s);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), glove); h.scale.set(1, 0.85, 1.2); g.add(h);
      return g;
    };
    this.R = arm(); this.R.rotation.order = 'YXZ'; this.root.add(this.R);
    this.slot = new THREE.Group(); this.R.add(this.slot);
    this.L = arm(); this.L.position.set(-0.22, -0.3, -0.4); this.L.rotation.set(0.25, 0.3, 0); this.root.add(this.L);
    const lt = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.055, 0.02), new THREE.MeshStandardMaterial({ color: '#c9a35a', metalness: 0.9, roughness: 0.3 }));
    lt.position.set(0.02, 0.055, -0.02); this.L.add(lt);
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,240,190,1)', 'rgba(255,150,50,0.7)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    this.flame.position.set(0.02, 0.1, -0.02); this.flame.scale.set(0.02, 0.035, 1); this.L.add(this.flame);
    // a small flame: it lights the space around you a little, it doesn't flood it
    this.light = new THREE.PointLight('#ffb067', 0, 6, 2); this.light.position.set(0.05, 0.35, -0.6); this.L.add(this.light);
    this.type = null; this.sw = -1; this.lit = false; this.t = 0; this.pull = 0;
    this.chips = new Chips(scene);
    for (const m of [this.R, this.L]) m.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }
  setCoat(c) { this.sleeve.color.set(c); }
  hold(type) {
    if (type === this.type) return;
    this.type = type; this.pull = 0.25;
    this.slot.clear();
    if (!type) return;
    const m = meshFor(type);
    m.traverse(o => { o.castShadow = false; });
    if (type === 'axe') { m.rotation.set(0, Math.PI, Math.PI / 2); m.position.set(0, 0.2, 0); this.slot.rotation.set(-0.45, 0, 0); }
    else if (type === 'flare') { m.rotation.set(-Math.PI / 2, 0, 0); m.position.set(0.03, 0.02, 0); this.slot.rotation.set(0, Math.PI / 2, 0); }      // held like a pistol: grip in the glove, barrel forward
    else if (type === 'log' || type === 'split' || type === 'branch' || type === 'board' || type === 'pipe') { m.position.set(-0.14, 0.06, -0.08); m.scale.setScalar(0.85); this.slot.rotation.set(0, 0.25, 0); }
    else { m.position.set(0, 0.03, -0.1); m.rotation.set(-0.5, 0.3, 0); this.slot.rotation.set(0, 0, 0); }
    this.slot.add(m);
  }
  // start a swing (only with the axe, one at a time)
  swing() { if (this.sw >= 0 || this.type !== 'axe') return false; this.sw = 0; this.struck = false; return true; }
  get busy() { return this.sw >= 0; }
  // returns true at the moment the axe lands
  update(dt, k) {
    this.t += dt;
    const t = this.t, show = !k.hide;
    this.root.visible = show;
    this.R.visible = !!this.type; this.L.visible = this.lit;
    this.pull = Math.max(0, this.pull - dt);
    const bob = k.walk || 0, ph = k.phase || 0;
    this.root.position.set(Math.sin(ph) * 0.012 * bob, -Math.abs(Math.cos(ph)) * 0.018 * bob - this.pull * 0.6, 0);
    // the swing: wind up, strike, recover (0.55 s)
    let px = 0.24, py = -0.27, pz = -0.42, rx = 0, hit = false;
    if (this.sw >= 0) {
      this.sw += dt;
      const u = this.sw;
      if (u < 0.18) { const a = u / 0.18; py += 0.16 * a; pz += 0.1 * a; rx = 1.05 * a; }
      else if (u < 0.3) { const a = (u - 0.18) / 0.12; py += 0.16 - 0.3 * a; pz += 0.1 - 0.32 * a; rx = 1.05 - 2.2 * a; }
      else { const a = Math.min(1, (u - 0.3) / 0.25); py += -0.14 * (1 - a); pz += -0.22 * (1 - a); rx = -1.15 * (1 - a); }
      if (!this.struck && u >= 0.27) { this.struck = true; hit = true; }
      if (u >= 0.55) this.sw = -1;
    }
    this.R.position.set(px, py, pz); this.R.rotation.set(rx, -0.12, 0);
    // the lighter's flame
    const f = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 13.7 + 1) + Math.random() * 0.06;
    this.flame.scale.set(0.02 * f, 0.035 * f, 1);
    this.light.intensity = this.lit && show ? 0.7 * f : 0;
    this.chips.update(dt);
    return hit;
  }
}

// small bits flying off when you chop: wood chips, snow, sparks off metal
class Chips {
  constructor(scene) {
    const n = this.n = 90;
    this.pos = new Float32Array(n * 3).fill(-999); this.col = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.045, vertexColors: true }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  burst(p, count, color, up = 2) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n, j = i * 3;
      this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
      this.v[j] = (Math.random() - 0.5) * 3; this.v[j + 1] = Math.random() * up + 0.5; this.v[j + 2] = (Math.random() - 0.5) * 3;
      const s = 0.75 + Math.random() * 0.4; this.col[j] = c.r * s; this.col[j + 1] = c.g * s; this.col[j + 2] = c.b * s;
      this.life[i] = 0.6 + Math.random() * 0.5;
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const j = i * 3;
      this.life[i] -= dt; this.v[j + 1] -= 9 * dt;
      this.pos[j] += this.v[j] * dt; this.pos[j + 1] += this.v[j + 1] * dt; this.pos[j + 2] += this.v[j + 2] * dt;
      if (this.life[i] <= 0) this.pos[j + 1] = -999;
    }
    if (any || this.was) { this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true; }
    this.was = any;
  }
}
