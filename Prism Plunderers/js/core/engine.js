// The renderer: one WebGL canvas shared by every scene.
import * as THREE from 'three';
import { S } from './save.js';
import { bus } from './events.js';
import { clamp } from './util.js';

export const SHADOW_SIZE = { off: 0, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

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
