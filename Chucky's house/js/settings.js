import * as THREE from 'three';

const KEY = 'chuckys_house_settings_v2';

// Every detail setting can be changed on its own; a preset just fills them in.
export const PRESETS = {
  low: { res: 0.6, shadows: 'off', shadowDist: 10, viewDist: 30, lights: 4, city: 'low', aniso: 1, people: 'low', fogQ: 'low' },
  medium: { res: 0.85, shadows: 'low', shadowDist: 16, viewDist: 50, lights: 8, city: 'medium', aniso: 4, people: 'medium', fogQ: 'medium' },
  high: { res: 1, shadows: 'medium', shadowDist: 24, viewDist: 80, lights: 14, city: 'high', aniso: 8, people: 'high', fogQ: 'high' },
  ultra: { res: 1.5, shadows: 'high', shadowDist: 32, viewDist: 120, lights: 24, city: 'high', aniso: 16, people: 'high', fogQ: 'high' },
};

export const S = {
  preset: 'medium', ...PRESETS.medium,
  aa: true, ps1: false, brightness: 1, fov: 70, sens: 1, bob: true, fpsCap: 0, showFps: false,
  volume: 0.6, voiceVol: 1, music: 0.5, echo: true, micMode: 'open', micDevice: '', name: '',
  crouchHold: false, pttToggle: false, tips: true, voiceNoise: true,
};
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* bad settings, use defaults */ }
export const saveSettings = () => localStorage.setItem(KEY, JSON.stringify(S));
if (!S.name) S.name = 'Player' + (Math.random() * 900 + 100 | 0);

export function applyPreset(p) {
  S.preset = p;
  Object.assign(S, PRESETS[p]);
}

const SHADOW_MAP = { off: 0, low: 512, medium: 1024, high: 2048 };

// sun = the light that casts the shop's shadows. Expedition scenes read S directly when they are built.
export function applySettings({ renderer, camera, controls, scene, sun }) {
  renderer.setPixelRatio(S.ps1 ? 0.3 : Math.min(devicePixelRatio * S.res, 2.5));
  renderer.domElement.style.imageRendering = S.ps1 ? 'pixelated' : 'auto';
  renderer.setSize(innerWidth, innerHeight);
  const map = SHADOW_MAP[S.shadows] || 0;
  renderer.shadowMap.enabled = map > 0;
  renderer.shadowMap.type = S.shadows === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  for (const l of [sun].flat()) {
    if (!l?.shadow) continue;
    l.castShadow = map > 0;
    if (map && l.shadow.mapSize.x !== map) {
      l.shadow.mapSize.set(map, map);
      l.shadow.map?.dispose(); l.shadow.map = null;
    }
    if (l.shadow.camera.far !== undefined && l.isSpotLight) l.distance = Math.max(l.distance, S.shadowDist);
  }
  scene.traverse(o => { if (o.material) [o.material].flat().forEach(m => { m.needsUpdate = true; if (m.map) { m.map.anisotropy = S.aniso; m.map.needsUpdate = true; } }); });
  // Brightness is clamped so low settings can't light up the dark.
  renderer.toneMappingExposure = Math.min(1.25, Math.max(0.8, S.brightness));
  if (scene.fog) scene.fog.far = Math.min(scene.userData.fogFar ?? 999, S.viewDist);
  camera.far = S.viewDist + 30;
  camera.fov = S.fov; camera.updateProjectionMatrix();
  controls.pointerSpeed = S.sens;
}
