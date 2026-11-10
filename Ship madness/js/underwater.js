// Underwater look: a post-processing pass (wobble, colour cast, murk, light rays, vignette), dense fog,
// floating particles around the camera and bubbles. Two flavours: the open sea and a flooded hold.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from './state.js';
import { FX } from './fx.js';
import { setSkyUnderwater } from './ocean.js';

const Shader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDark: { value: 0 }, uRays: { value: 0 }, uMurk: { value: 0 }, uTint: { value: new THREE.Color() } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uDark, uRays, uMurk; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      uv.x += sin(uv.y * 18.0 + uTime * 1.6) * 0.0028 + sin(uv.y * 43.0 - uTime * 2.3) * 0.001;
      uv.y += cos(uv.x * 15.0 + uTime * 1.3) * 0.0028;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + vec2(0.0018, 0.0)).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - vec2(0.0018, 0.0)).b;
      vec3 bl = (texture2D(tDiffuse, uv + vec2(0.005, 0.004)).rgb + texture2D(tDiffuse, uv - vec2(0.005, 0.004)).rgb
               + texture2D(tDiffuse, uv + vec2(-0.004, 0.005)).rgb + texture2D(tDiffuse, uv + vec2(0.004, -0.005)).rgb) * 0.25;
      c = mix(c, bl, uMurk * 0.7);
      float lum = dot(c, vec3(0.3, 0.5, 0.2));
      c = mix(c, uTint * (0.35 + lum * 1.6), 0.6);
      vec2 q = vUv - vec2(0.5, 1.35);
      float a = atan(q.x, -q.y);
      float r = (sin(a * 23.0 + uTime * 0.35) * 0.5 + 0.5) * (sin(a * 37.0 - uTime * 0.27) * 0.5 + 0.5);
      c += uTint * 1.6 * pow(r, 3.0) * smoothstep(1.7, 0.2, length(q)) * uRays;
      c += (h(vUv * vec2(1920.0, 1080.0) + uTime) - 0.5) * 0.015;
      c *= 1.0 - uDark * 0.8;
      c *= mix(0.4, 1.0, smoothstep(1.0, 0.25, length(vUv - 0.5)));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

let composer = null, pass = null, motes = null, bubbleT = 0;
const seaFog = new THREE.FogExp2('#0f4a58', 0.05), hullFog = new THREE.FogExp2('#1c2a1e', 0.22);
const SEA_TINT = new THREE.Color(0.04, 0.3, 0.36), HULL_TINT = new THREE.Color(0.13, 0.2, 0.11);

function init(renderer, scene, camera) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  pass = new ShaderPass(Shader);
  composer.addPass(pass);
  composer.addPass(new OutputPass());
  const n = 600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 24;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  motes = new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfeee8', size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
  motes.frustumCulled = false; motes.visible = false;
  scene.add(motes);
}
export function resizeUnderwater(w, h) { composer?.setSize(w, h); }
export function setUnderwaterPixelRatio(r) { composer?.setPixelRatio(r); }

// kind: null | 'sea' | 'hull'; depth = metres below the surface
export function renderWorld(renderer, scene, camera, kind, depth, airFog) {
  if (!kind) {
    scene.fog = airFog;
    setSkyUnderwater(0);
    if (motes) motes.visible = false;
    renderer.render(scene, camera);
    return;
  }
  if (!composer) init(renderer, scene, camera);
  const sea = kind === 'sea';
  const fog = sea ? seaFog : hullFog;
  if (sea) { fog.color.setRGB(0.06, 0.29, 0.34).lerp(new THREE.Color(0.01, 0.07, 0.1), Math.min(1, depth / 30)); fog.density = 0.045 + depth * 0.0015; }
  scene.fog = fog;
  setSkyUnderwater(1, fog.color);      // no sky down here: blue water in every direction
  const u = pass.uniforms;
  u.uTime.value = G.t;
  u.uTint.value.copy(sea ? SEA_TINT : HULL_TINT);
  u.uDark.value = sea ? Math.min(0.85, depth / 35) : 0.35;
  u.uMurk.value = sea ? Math.min(1, 0.3 + depth / 20) : 1;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  u.uRays.value = sea ? Math.max(0, 1 - depth / 22) * (0.35 + Math.max(0, fwd.y) * 0.9) : 0.08;
  // particles drift around the camera
  motes.visible = true;
  motes.material.color.set(sea ? '#cfeee8' : '#b9c49a');
  const pa = motes.geometry.attributes.position, cp = camera.position;
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i), y = pa.getY(i) + G.dt * 0.08, z = pa.getZ(i);
    x = cp.x + ((x - cp.x + 12) % 24 + 24) % 24 - 12; y = cp.y + ((y - cp.y + 12) % 24 + 24) % 24 - 12; z = cp.z + ((z - cp.z + 12) % 24 + 24) % 24 - 12;
    pa.setXYZ(i, x, y, z);
  }
  pa.needsUpdate = true;
  bubbleT -= G.dt;
  if (bubbleT <= 0) { bubbleT = 0.25 + Math.random() * 0.6; FX.bubbles(cp.x + fwd.x * 0.4, cp.y - 0.2, cp.z + fwd.z * 0.4, 4); }
  composer.render();
}
