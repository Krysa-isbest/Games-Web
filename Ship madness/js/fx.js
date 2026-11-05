// Particles: voxel debris + brass casings (instanced cubes), soft sprites for splashes, spray, smoke, fire,
// flashes; tracers; a pooled light for explosions and muzzle flashes.
import * as THREE from 'three';
import { G, rand } from './state.js';
import { waveHeightFast } from './ocean.js';

export const VOXEL = 0.2;

// shared "voxel" look: darkened edges on every cube, so blocks read as blocks
export function voxelMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.02, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vBox;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBox = position * ' + (2 / VOXEL).toFixed(4) + ';');
    sh.fragmentShader = 'varying vec3 vBox;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 ab = abs(vBox);
      float e = smoothstep(0.72, 1.0, ab.x) + smoothstep(0.72, 1.0, ab.y) + smoothstep(0.72, 1.0, ab.z) - 1.0;
      diffuseColor.rgb *= 1.0 - clamp(e, 0.0, 1.0) * 0.32;`);
  };
  return m;
}

// ---------- instanced cubes (debris, casings) ----------
class CubePool {
  constructor(scene, max, mat) {
    this.max = max; this.p = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = true;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(); this.v = new THREE.Vector3();
  }
  spawn(o) { if (this.p.length >= this.max) this.p.shift(); o.age = 0; o.rx = rand(0, 6); o.ry = rand(0, 6); this.p.push(o); }
  update(dt) {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const o = this.p[i];
      o.age += dt;
      if (o.age >= o.life) { this.p.splice(i, 1); continue; }
      o.vy -= (o.g ?? 9.8) * dt;
      const dr = Math.exp(-(o.drag ?? 0.2) * dt);
      o.vx *= dr; o.vy *= dr; o.vz *= dr;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (o.floor != null && o.y < o.floor) { o.y = o.floor; o.vy *= -0.3; o.vx *= 0.5; o.vz *= 0.5; o.spin *= 0.5; }
      const sea = waveHeightFast(o.x, o.z);
      if (o.y < sea) {
        if (!o.wet) { o.wet = true; if (Math.random() < 0.4) FX.splash(o.x, sea, o.z, 0.3); }
        o.vy = Math.max(o.vy, -1.2) * 0.9; o.vx *= 0.9; o.vz *= 0.9; o.g = o.float ? -2 : 1.2;
        if (o.float && o.y > sea - 0.1) { o.y = sea - 0.1; o.vy = 0; }
      }
      const k = o.age / o.life;
      const sc = o.size * (k > 0.8 ? (1 - k) / 0.2 : 1);
      o.rx += o.spin * dt; o.ry += o.spin * dt * 0.7;
      this.q.setFromEuler(this.e.set(o.rx, o.ry, 0));
      this.m.compose(this.v.set(o.x, o.y, o.z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, o.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- soft sprites ----------
const spriteVert = `
  attribute vec3 aColor; attribute float aAlpha, aSize;
  uniform float uScale;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vColor = aColor; vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }`;
const spriteFrag = `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float a = (1.0 - r * r) * vAlpha;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }`;
class SpritePool {
  constructor(scene, max, additive) {
    this.max = max; this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.al = new Float32Array(max); this.sz = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 800 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: spriteVert, fragmentShader: spriteFrag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(o) { if ((G.fxScale ?? 1) < 1 && Math.random() > G.fxScale) return; if (this.p.length >= this.max) this.p.shift(); o.age = 0; this.p.push(o); }
  update(dt) {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const o = this.p[i];
      o.age += dt;
      if (o.age >= o.life) { this.p.splice(i, 1); continue; }
      o.vy -= (o.g ?? 9.8) * dt;
      const dr = Math.exp(-(o.drag ?? 0) * dt);
      o.vx *= dr; o.vy *= dr; o.vz *= dr;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (o.die && o.y < waveHeightFast(o.x, o.z) - 0.1) { this.p.splice(i, 1); continue; }
      const k = o.age / o.life;
      this.pos[n * 3] = o.x; this.pos[n * 3 + 1] = o.y; this.pos[n * 3 + 2] = o.z;
      const c = o.c2 ? o.color.clone().lerp(o.c2, k) : o.color;
      this.col[n * 3] = c.r; this.col[n * 3 + 1] = c.g; this.col[n * 3 + 2] = c.b;
      this.al[n] = (o.alpha ?? 1) * (k < 0.1 ? k / 0.1 : 1 - Math.pow(k, o.fadePow ?? 1.5));
      this.sz[n] = o.size * (1 + k * (o.grow ?? 0));
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const a of ['position', 'aColor', 'aAlpha', 'aSize']) g.attributes[a].needsUpdate = true;
  }
}

let cubes, soft, glow, tracers, tracerData = [], light, lightT = 0;
const C = c => new THREE.Color(c);
const FOAM = C('#e8f4f6'), SPRAY = C('#b8e2ec'), SMOKE = C('#5a5856'), DARK = C('#262422'), STEAM = C('#d8dcdc');
const FIRE = [C('#ffd36a'), C('#ff9a2e'), C('#ff5a1c')], EMBER = C('#ff6a1a'), BRASS = C('#c9a03c'), BLOOD = C('#8e0c0c');

export const FX = {
  init(scene) {
    cubes = new CubePool(scene, 1400, voxelMaterial());
    soft = new SpritePool(scene, 3500, false);
    glow = new SpritePool(scene, 1500, true);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 6), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(64 * 6), 3));
    tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    tracers.frustumCulled = false;
    scene.add(tracers);
    light = new THREE.PointLight('#ffb35a', 0, 60, 1.6);
    scene.add(light);
  },
  update(dt) {
    const scale = innerHeight / (2 * Math.tan((G.camera.fov * Math.PI / 180) / 2));
    soft.uniforms.uScale.value = glow.uniforms.uScale.value = scale;
    cubes.update(dt); soft.update(dt); glow.update(dt);
    const pa = tracers.geometry.attributes.position, ca = tracers.geometry.attributes.color;
    for (let i = 0; i < 64; i++) {
      const t = tracerData[i];
      let b = 0;
      if (t) { t.life -= dt; b = Math.max(0, t.life / 0.07); if (t.life <= 0) tracerData[i] = null; else { pa.setXYZ(i * 2, t.a.x, t.a.y, t.a.z); pa.setXYZ(i * 2 + 1, t.b.x, t.b.y, t.b.z); } }
      ca.setXYZ(i * 2, b * 0.4, b * 0.32, b * 0.15); ca.setXYZ(i * 2 + 1, b, b * 0.85, b * 0.5);
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
    if (lightT > 0) { lightT -= dt; light.intensity = Math.max(0, lightT) * light.userData.k; }
  },
  debris(x, y, z, color, power = 1) {
    cubes.spawn({ x, y, z, vx: rand(-4, 4) * power, vy: rand(2, 7) * power, vz: rand(-4, 4) * power, life: rand(3, 6), size: rand(0.6, 1.1), color, spin: rand(4, 12), drag: 0.25, float: Math.random() < 0.5 });
  },
  casing(x, y, z, vx, vy, vz, floor) {
    cubes.spawn({ x, y, z, vx, vy, vz, life: 2.5, size: 0.18, color: BRASS, spin: 20, drag: 0.5, floor });
  },
  splash(x, y, z, size = 1) {
    const n = Math.min(60, 8 + size * 14 | 0);
    for (let i = 0; i < n; i++) soft.spawn({ x: x + rand(-0.4, 0.4) * size, y, z: z + rand(-0.4, 0.4) * size, vx: rand(-2, 2) * size, vy: rand(3, 8) * Math.sqrt(size), vz: rand(-2, 2) * size, life: rand(0.6, 1.3), size: rand(0.25, 0.6) * Math.sqrt(size), color: Math.random() < 0.6 ? FOAM : SPRAY, drag: 0.5, die: true, alpha: 0.9 });
    for (let i = 0; i < 4 + size * 3; i++) soft.spawn({ x: x + rand(-1, 1) * size, y: y + 0.1, z: z + rand(-1, 1) * size, vx: rand(-0.6, 0.6), vy: rand(0.2, 0.8), vz: rand(-0.6, 0.6), life: rand(1, 2), size: rand(0.8, 1.6) * size, color: FOAM, g: 0, alpha: 0.5, grow: 1.5 });
  },
  spray(x, y, z, dx, dy, dz, power = 1) {
    soft.spawn({ x, y, z, vx: dx * rand(2.5, 4.5) * power + rand(-0.4, 0.4), vy: dy * 3 + rand(0, 1.2), vz: dz * rand(2.5, 4.5) * power + rand(-0.4, 0.4), life: 0.55, size: rand(0.12, 0.26), color: SPRAY, alpha: 0.85, g: 9.8 });
  },
  foam(x, y, z, s = 1) { soft.spawn({ x, y: y + 0.05, z, vx: rand(-0.3, 0.3), vy: 0, vz: rand(-0.3, 0.3), life: rand(1.2, 2.2), size: rand(0.5, 1) * s, g: 0, color: FOAM, alpha: 0.6, grow: 1 }); },
  smoke(x, y, z, s = 1, dark = false) {
    soft.spawn({ x, y, z, vx: rand(-0.5, 0.5), vy: rand(1.2, 2.6), vz: rand(-0.5, 0.5), life: rand(2, 4), size: rand(0.8, 1.5) * s, g: -0.3, drag: 0.7, color: dark || Math.random() < 0.4 ? DARK : SMOKE, alpha: 0.55, grow: 2.5, fadePow: 1 });
  },
  steam(x, y, z) { soft.spawn({ x, y, z, vx: rand(-0.3, 0.3), vy: rand(1, 2), vz: rand(-0.3, 0.3), life: rand(1, 2), size: rand(0.5, 0.9), g: -0.5, color: STEAM, alpha: 0.35, grow: 2 }); },
  fire(x, y, z, s = 1) {
    glow.spawn({ x, y, z, vx: rand(-0.4, 0.4), vy: rand(1, 2.5), vz: rand(-0.4, 0.4), life: rand(0.35, 0.8), size: rand(0.35, 0.7) * s, g: -1.5, color: FIRE[0], c2: FIRE[2], alpha: 0.9 });
    if (Math.random() < 0.15) glow.spawn({ x, y, z, vx: rand(-1, 1), vy: rand(2, 4), vz: rand(-1, 1), life: 1.2, size: 0.06, g: -0.5, color: EMBER });
  },
  bubbles(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) soft.spawn({ x: x + rand(-0.15, 0.15), y: y + rand(-0.1, 0.1), z: z + rand(-0.15, 0.15), vx: rand(-0.2, 0.2), vy: rand(0.6, 1.2), vz: rand(-0.2, 0.2), life: rand(1.5, 3), size: rand(0.03, 0.08), g: -2.5, drag: 1.5, color: FOAM, alpha: 0.8, fadePow: 4 });
  },
  ash(x, y, z) {
    soft.spawn({ x, y, z, vx: rand(-0.4, 0.4), vy: -rand(0.6, 1.2), vz: rand(-0.4, 0.4), life: rand(5, 9), size: rand(0.05, 0.12), g: 0, drag: 0.2, color: Math.random() < 0.5 ? SMOKE : STEAM, alpha: 0.8, die: true });
  },
  blood(x, y, z) { for (let i = 0; i < 8; i++) soft.spawn({ x, y, z, vx: rand(-1.5, 1.5), vy: rand(0, 2), vz: rand(-1.5, 1.5), life: 0.6, size: rand(0.1, 0.25), color: BLOOD, alpha: 0.9 }); },
  spark(x, y, z) { for (let i = 0; i < 5; i++) glow.spawn({ x, y, z, vx: rand(-3, 3), vy: rand(0, 3), vz: rand(-3, 3), life: 0.2, size: 0.06, color: FIRE[0] }); },
  dust(x, y, z, color) { for (let i = 0; i < 3; i++) soft.spawn({ x, y, z, vx: rand(-0.6, 0.6), vy: rand(0, 0.8), vz: rand(-0.6, 0.6), life: 0.6, size: rand(0.15, 0.3), g: 0, color, alpha: 0.6, grow: 1.5 }); },
  explosion(x, y, z, r = 2) {
    for (let i = 0; i < 16 + r * 10; i++) {
      const a = rand(0, Math.PI * 2), b = rand(-0.3, 1.2), sp = rand(3, 10) * Math.sqrt(r);
      glow.spawn({ x, y, z, vx: Math.cos(a) * Math.cos(b) * sp, vy: Math.sin(b) * sp, vz: Math.sin(a) * Math.cos(b) * sp, life: rand(0.25, 0.65), size: rand(0.7, 1.5) * Math.sqrt(r), color: FIRE[0], c2: FIRE[2], drag: 3.5, g: 0 });
    }
    glow.spawn({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.18, size: r * 4, color: FIRE[0], g: 0 });
    for (let i = 0; i < 8 + r * 4; i++) FX.smoke(x + rand(-r, r) * 0.5, y + rand(0, r) * 0.5, z + rand(-r, r) * 0.5, Math.sqrt(r), i % 2 === 0);
    FX.flash(x, y, z, 10 + r * 8);
    if (y < waveHeightFast(x, z) + 1.5) FX.splash(x, y, z, r);
    const d = G.camera.position.distanceTo(new THREE.Vector3(x, y, z));
    G.shake = Math.max(G.shake || 0, Math.min(1.2, r * 0.5 / (1 + d / 15)));
  },
  flash(x, y, z, peak = 10) { light.position.set(x, y, z); lightT = 0.12; light.userData.k = peak / 0.12; light.intensity = peak; },
  tracer(a, b) {
    let i = tracerData.findIndex(t => !t);
    if (i < 0) i = Math.random() * 64 | 0;
    tracerData[i] = { a: a.clone(), b: b.clone(), life: 0.07 };
  },
};
for (let i = 0; i < 64; i++) tracerData.push(null);
