// The renderer: one WebGL canvas shared by every scene.
import * as THREE from 'three';
import { S } from './save.js';
import { bus } from './events.js';
import { clamp } from './util.js';

export const SHADOW_SIZE = { off: 0, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
// what the graphics settings (DESIGN 14.2 / 14.2a, part 7) stand for: how far round you shadows are drawn (times the
// scene's own span), how far the city is drawn and its small detail (m), how big the ground's textures are
export const GFX = {
  shadowDist: { near: 0.67, medium: 1, far: 1.5 },
  view: { near: 240, medium: 300, far: 340 },
  detail: { near: 75, medium: 150, far: 250 },
  textures: { low: 0.5, medium: 0.75, high: 1 },
};

export const Engine = {
  renderer: null, canvas: null,
  w: 1, h: 1,
  dyn: 1,              // dynamic resolution factor (the performance part drives it), multiplied with S.scale
  lost: false,
  aa: 'off',           // the anti-aliasing the renderer was created with (changing it needs a reload)

  init(canvas) {
    this.canvas = canvas;
    this.aa = S.aa;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: S.aa === 'msaa', powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; bus.emit('gfx:lost'); });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.applyGraphics(); bus.emit('gfx:restored'); });
    addEventListener('resize', () => this.resize());
    this.applyGraphics();
  },

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, 2) * clamp(S.scale, 0.4, 1.5) * this.dyn; },
  resize() {
    this.w = Math.max(1, window.innerWidth); this.h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.w, this.h, false);
    bus.emit('resize', this.w, this.h);
  },
  // call after changing a graphics setting. Scenes listen to 'gfx' for the parts they own (lights, FOV).
  applyGraphics() {
    const on = S.shadows !== 'off';
    if (this.renderer.shadowMap.enabled !== on) { this.renderer.shadowMap.enabled = on; this.renderer.shadowMap.needsUpdate = true; }
    this.resize();
    bus.emit('gfx');
  },
  setDynamicScale(f) {
    f = clamp(f, 0.5, 1);
    if (Math.abs(f - this.dyn) < 0.01) return;
    this.dyn = f;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.w, this.h, false);
  },
  // dynamic resolution (part 7): every half second, from the average frame time (Loop.stats.ms), draw fewer pixels
  // when frames take too long for the target (the frame rate cap, or 60), and more again after 3 s with room to spare
  adaptT: 0, roomy: 0,
  adapt(ms, now = performance.now()) {
    if (now < this.adaptT) return;
    this.adaptT = now + 500;
    if (!S.dynRes) { this.roomy = 0; if (this.dyn !== 1) this.setDynamicScale(1); return; }
    if (!(ms > 0)) return;
    const target = 1000 / (S.fpsCap > 0 ? Math.min(S.fpsCap, 60) : 60);
    if (ms > target * 1.15) { this.roomy = 0; this.setDynamicScale(this.dyn - 0.08); }
    else if (ms < target * 1.05) { this.roomy += 0.5; if (this.roomy >= 3) { this.roomy = 0; this.setDynamicScale(this.dyn + 0.05); } }
    else this.roomy = 0;
  },
  render(scene, camera) { if (!this.lost) this.renderer.render(scene, camera); },
  // numbers for the debug overlay (they describe the frame that was just drawn)
  get info() { const i = this.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geo: i.memory.geometries, tex: i.memory.textures }; },
};

export function fitCamera(camera, w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
// switching shadows on or off changes the shaders, so materials must be rebuilt
export function refreshMaterials(root) {
  root.traverse(o => { const m = o.material; if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true; });
}
// frees the GPU memory of everything under root. Scenes call it when they close.
export function disposeTree(root) {
  const seen = new Set();
  root.traverse(o => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const m = o.material;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat)) if (v && v.isTexture) v.dispose();
      mat.dispose();
    }
    if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
}
