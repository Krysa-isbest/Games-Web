// The nuke, drawn to look like the real thing: the warning, the falling bomb and the blast. This file only draws
// and times it. What the blast does to ships and people is in weapons.js, which is told when the blast wave
// reaches each ship and each person.
//
// The blast, second by second:
//  · a white flash (the sky, the screen and a spot burnt into your eyes) and a fireball that boils up white-hot;
//  · a Wilson cloud and the blast wave racing out over the sea: a real wave in the water, a wall of spray, foam;
//  · the fireball rises and cools into a mushroom cloud: a rolling ring-shaped cap, a stem pulled up out of the
//    sea, a ring of condensation around it, and the base surge spreading over the water;
//  · the sky and the sea glow orange, embers rain down, the sea boils at ground zero, ash falls;
//  · no sound until the blast wave reaches you: then the bang, the shake, ringing ears, muffled hearing and a long
//    rumble.
// The cloud is ~130 "puffs": noise-shaped balls that are lit like clouds (sun, sky, the fireball's glow from
// inside) or burn like plasma while they are hot, sorted back to front every frame so their soft edges blend.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, S, rand, clamp } from './state.js';
import { SKY, NUKE_SEA, waveHeight } from './ocean.js';
import { FX } from './fx.js';
import { sfx, deafen, clearDeafen } from './sfx.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

// ---------- timing ----------
// the blast wave's radius t seconds after the flash: ~200 m/s at first, slowing down as it weakens
export const shockR = t => 220 * (1 - Math.exp(-t / 1.5)) + 55 * t;
// when it (and with it the bang) reaches a point d metres from ground zero; past 450 m only the sound goes on
export function shockTime(d) {
  if (d > 450) return shockTime(450) + (d - 450) / 340;
  let t = d / 230;
  for (let i = 0; i < 6; i++) t = Math.max(0, t - (shockR(t) - d) / (146.7 * Math.exp(-t / 1.5) + 55));
  return t;
}
const waveK = r => Math.exp(-r / 220) * (1 - smooth(430, 650, r));        // how strong the wave still is at radius r
const headY = t => 16 + 128 * (1 - Math.exp(-t / 8.5));                   // the fireball, then the cap, rises
const fireOf = t => clamp(1.05 * Math.exp(-t / 3.4), 0, 1);               // the fireball's heat
const heatOf = t => clamp(1.25 * Math.exp(-t / 6.5), 0, 1);               // the cap's glow from inside
const fireR = t => 27 * (1 - Math.exp(-t * 6)) + Math.min(t, 8) * 0.5;    // the fireball's radius
const windOf = t => t * 1.1;                                               // the cloud drifts with the wind
const LIFE = 60;                                                           // seconds until the cloud is gone
const FALL = 4.6;                                                          // the bomb is in sight this long

// ---------- shaders ----------
// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT licence)
const NOISE = /* glsl */`
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;
// the scene's fog, but lighter (the cloud is huge and bright and should be seen from far away); full fog under water
const FOG_PARS = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
const FOG_APPLY = /* glsl */`
#ifdef USE_FOG
  {
    float fogD = length(vW - cameraPosition);
    #ifdef FOG_EXP2
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - exp(-fogDensity * fogDensity * fogD * fogD));
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, fogD) * uFogK);
    #endif
  }
#endif
`;

// one cloud puff: a unit ball pushed in and out by noise (it boils faster while hot), with normals from the bumps
const PUFF_VERT = /* glsl */`
attribute vec4 aPuff;     // seed, heat, shadow, alpha
attribute vec3 aTint;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vTint;
varying vec4 vPuff;
varying float vD;
${NOISE}
float puffShape(vec3 n, float seed, float boil) {
  vec3 q = n * 1.45 + vec3(seed * 13.7, seed * 7.1, seed * 3.3 + uTime * boil);
  return snoise(q) * 0.62 + snoise(q * 2.3 + vec3(5.2, 1.3, uTime * boil * 1.6)) * 0.38;
}
void main() {
  vec3 n = normalize(position);
  float seed = aPuff.x;
  float boil = 0.09 + aPuff.y * 0.55;
  float d = puffShape(n, seed, boil);
  vec3 p = n * (1.0 + 0.3 * d);
  vec3 up = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, n));
  vec3 t2 = cross(n, t1);
  vec3 na = normalize(n + t1 * 0.08);
  vec3 nb = normalize(n + t2 * 0.08);
  vec3 pa = na * (1.0 + 0.3 * puffShape(na, seed, boil));
  vec3 pb = nb * (1.0 + 0.3 * puffShape(nb, seed, boil));
  vec3 nn = normalize(cross(pa - p, pb - p));
  if (dot(nn, n) < 0.0) nn = -nn;
  mat3 im = mat3(instanceMatrix);
  vec3 s2 = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  vN = normalize(mat3(modelMatrix) * (im * (nn / s2)));
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vObj = p;
  vTint = aTint;
  vPuff = aPuff;
  vD = d;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
// lit like a cloud (sun, sky, the fireball glowing from inside and below, heat in the folds, a silver lining),
// or burning like plasma while it is hot: white-hot bumps, orange folds, red at the edges
const PUFF_FRAG = /* glsl */`
uniform float uTime;
uniform float uGlowK;
uniform float uDetail;
uniform float uFogK;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyBot;
uniform vec3 uFire;
uniform vec3 uGlowPos;
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vTint;
varying vec4 vPuff;
varying float vD;
${NOISE}
${FOG_PARS}
vec3 fireRamp(float T) {
  T = clamp(T, 0.0, 1.2);
  vec3 c = mix(vec3(0.06, 0.04, 0.035), vec3(0.55, 0.07, 0.015), smoothstep(0.05, 0.3, T));
  c = mix(c, vec3(1.0, 0.36, 0.05), smoothstep(0.25, 0.5, T));
  c = mix(c, vec3(1.0, 0.75, 0.28), smoothstep(0.48, 0.75, T));
  c = mix(c, vec3(1.0, 0.97, 0.9), smoothstep(0.72, 1.0, T));
  return c * (1.0 + 3.2 * T * T);
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndv = dot(N, V);
  float heat = vPuff.y;
  float d = vD;
  float det = 0.0;
  if (uDetail > 0.5) det = snoise(vObj * 4.3 + vec3(vPuff.x * 31.0, uTime * (0.12 + heat * 0.9), 0.0));
  float occ = clamp(0.62 + d * 0.75 + det * 0.08, 0.2, 1.15);
  float sunD = clamp((dot(N, uSun) + 0.3) / 1.3, 0.0, 1.0);
  float lit = 1.0 - vPuff.z;
  vec3 amb = mix(uSkyBot, uSkyTop, N.y * 0.5 + 0.5);
  vec3 cloud = vTint * (amb * 0.85 + 0.08 + uSunCol * sunD * lit) * occ;      // + light scattered inside the cloud
  vec3 toGlow = uGlowPos - vW;
  float glow2 = max(dot(toGlow, toGlow), 1.0);
  float glowL = (clamp(dot(N, toGlow * inversesqrt(glow2)), 0.0, 1.0) * 0.75 + 0.25) * uGlowK / (1.0 + glow2 / 3600.0);
  cloud += vTint * uFire * glowL * occ;
  float rim = pow(1.0 - clamp(ndv, 0.0, 1.0), 3.0);
  cloud += uSunCol * rim * max(dot(-V, uSun), 0.0) * 0.45 * lit;
  float fold = 1.0 - smoothstep(-0.55, 0.35, d + det * 0.15);
  vec3 ember = mix(vec3(0.85, 0.16, 0.03), vec3(1.0, 0.6, 0.2), clamp(heat * 1.3 - 0.2, 0.0, 1.0));
  cloud += ember * heat * (0.2 + fold * 2.4) * (0.5 + 0.5 * heat);
  float T = heat * (0.8 + 0.3 * d + 0.12 * det) * (0.62 + 0.38 * clamp(ndv, 0.0, 1.0));
  vec3 col = mix(cloud, fireRamp(T), smoothstep(0.35, 0.8, heat));
  gl_FragColor = vec4(col, vPuff.w * smoothstep(0.02, 0.42, ndv));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_APPLY}
}
`;
// an open cylinder (y = 0 at the bottom .. 1 at the top): the spray walls and the warning wall
const WALL_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
// the spray thrown up by the blast wave: ragged at the top, thick at the water, lit orange near the fireball
const SPRAY_FRAG = /* glsl */`
uniform float uTime;
uniform float uAlpha;
uniform float uR;
uniform float uSeed;
uniform float uFogK;
uniform vec3 uCol;
uniform vec3 uGlow;
varying vec2 vUv;
varying vec3 vW;
${NOISE}
${FOG_PARS}
void main() {
  float a = vUv.x * 6.28318530718;
  float y = vUv.y;
  vec3 q = vec3(cos(a) * uR * 0.06, y * 2.2 - uTime * 0.5, sin(a) * uR * 0.06) + uSeed;
  float nz = snoise(q) * 0.6 + snoise(q * 2.6 + 3.1) * 0.4;
  float prof = smoothstep(0.0, 0.1, y) * pow(max(1.0 - y, 0.0), 1.5);
  float alpha = uAlpha * prof * smoothstep(-0.45, 0.5, nz + (0.5 - y) * 0.6);
  gl_FragColor = vec4(uCol * (0.82 + 0.18 * nz) + uGlow, alpha);
  #include <colorspace_fragment>
  ${FOG_APPLY}
}
`;
// the Wilson cloud: a thin dome of mist just behind the shock front, seen mostly at its edges
const SHELL_VERT = /* glsl */`
varying vec3 vW;
varying vec3 vN;
varying vec3 vO;
void main() {
  vO = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SHELL_FRAG = /* glsl */`
uniform float uTime;
uniform float uAlpha;
uniform float uFogK;
uniform vec3 uCol;
varying vec3 vW;
varying vec3 vN;
varying vec3 vO;
${NOISE}
${FOG_PARS}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(normalize(vN), V));
  float nz = snoise(vO * 3.2 + vec3(0.0, uTime * 0.4, 0.0)) * 0.55 + snoise(vO * 8.0 + 4.0) * 0.3;
  float rim = pow(max(1.0 - ndv, 0.0), 2.0);
  float alpha = uAlpha * (0.1 + 0.9 * rim) * clamp(0.7 + nz, 0.0, 1.0) * smoothstep(0.0, 0.12, vO.y);
  gl_FragColor = vec4(uCol, alpha);
  #include <colorspace_fragment>
  ${FOG_APPLY}
}
`;
// the warning: a red wall of light around the blast zone with hazard stripes running round it
const ZONE_FRAG = /* glsl */`
uniform float uTime;
uniform float uAlpha;
uniform float uCount;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  float s = fract(vUv.x * uCount + y * 1.5 - uTime * 0.6);
  float band = smoothstep(0.45, 0.5, s) - smoothstep(0.95, 1.0, s);
  float fade = pow(max(1.0 - y, 0.0), 2.0) * smoothstep(0.0, 0.04, y);
  vec3 col = mix(vec3(1.0, 0.12, 0.05), vec3(1.0, 0.55, 0.1), band * 0.35);
  gl_FragColor = vec4(col, uAlpha * fade * (0.3 + 0.7 * band));
  #include <colorspace_fragment>
}
`;
// and a beam of light straight up over ground zero
const BEAM_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BEAM_FRAG = /* glsl */`
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float core = pow(abs(dot(normalize(vN), V)), 2.0);
  float y = vUv.y;
  float a = uAlpha * core * pow(max(1.0 - y, 0.0), 1.2) * (0.75 + 0.25 * sin(y * 300.0 - uTime * 12.0));
  gl_FragColor = vec4(vec3(1.0, 0.28, 0.1), a);
  #include <colorspace_fragment>
}
`;

// ---------- materials and shapes ----------
const fogUniforms = extra => Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), { uFogK: { value: 0.45 } }, extra);
const MATS = {
  puff: () => new THREE.ShaderMaterial({
    uniforms: fogUniforms({
      uTime: { value: 0 }, uGlowK: { value: 0 }, uDetail: { value: 1 },
      uSun: { value: SKY.sunDir }, uSunCol: { value: new THREE.Color(1.15, 1.06, 0.92) },
      uSkyTop: { value: new THREE.Color(0.5, 0.62, 0.75) }, uSkyBot: { value: new THREE.Color(0.14, 0.18, 0.22) },
      uFire: { value: new THREE.Color(1.0, 0.42, 0.1) }, uGlowPos: { value: new THREE.Vector3() },
    }),
    vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, fog: true,
  }),
  spray: () => new THREE.ShaderMaterial({
    uniforms: fogUniforms({
      uTime: { value: 0 }, uAlpha: { value: 0 }, uR: { value: 1 }, uSeed: { value: Math.random() * 50 },
      uCol: { value: new THREE.Color(0.86, 0.9, 0.93) }, uGlow: { value: new THREE.Color(0, 0, 0) },
    }),
    vertexShader: WALL_VERT, fragmentShader: SPRAY_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  }),
  shell: () => new THREE.ShaderMaterial({
    uniforms: fogUniforms({ uTime: { value: 0 }, uAlpha: { value: 0 }, uCol: { value: new THREE.Color(0.86, 0.89, 0.92) } }),
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  }),
  wall: () => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uCount: { value: 40 } },
    vertexShader: WALL_VERT, fragmentShader: ZONE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }),
  beam: () => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }),
};
let G_PUFF = null, G_WALL = null, G_SHELL = null, G_BEAM = null, glowTex = null;
function shapes() {
  if (G_PUFF) return;
  const ico = new THREE.IcosahedronGeometry(1, 3);
  ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  G_PUFF = mergeVertices(ico);                     // 642 shared corners instead of 3840 loose ones
  G_WALL = new THREE.CylinderGeometry(1, 1, 1, 192, 1, true).translate(0, 0.5, 0);
  G_SHELL = new THREE.SphereGeometry(1, 64, 24, 0, TAU, 0, Math.PI / 2);
  G_BEAM = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// glare sprites are drawn over everything, like a camera's bloom
function spriteMat() {
  glowTex ||= glowTexture();
  return new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, toneMapped: false });
}
const MAX_PUFFS = 140;
function puffMesh() {
  shapes();
  const geo = G_PUFF.clone();
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.InstancedMesh(geo, MATS.puff(), MAX_PUFFS);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false; m.renderOrder = 2;
  return m;
}
// a Fat Man-ish bomb, nose down: olive body, a yellow band, a box tail with fins
let BOMB = null;
function bombModel() {
  if (BOMB) return BOMB;
  const olive = new THREE.MeshStandardMaterial({ color: '#4b573c', metalness: 0.45, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b3024', metalness: 0.4, roughness: 0.6 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e3c228', emissive: '#3a2c00', roughness: 0.5 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), olive); body.scale.set(0.78, 1.15, 0.78);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.22, 24, 1, true), yellow); band.position.y = 0.15;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.75, 1.25), dark); box.position.y = 1.55;
  g.add(body, band, box);
  for (let i = 0; i < 2; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.5), dark); f.position.y = 1.3; f.rotation.y = i * Math.PI / 2; g.add(f); }
  g.scale.setScalar(1.6);
  return BOMB = g;
}

// ---------- setup ----------
let light = null, warm = null, zone = null, flashEl = null, afterEl = null;
const BLASTS = [];
const SKY0 = { h: null, z: null, fog: null };
export function initNukeFx() {
  // always in the scene (at zero), so lighting the blast doesn't make every material rebuild its shader
  light = new THREE.PointLight('#ffd2a0', 0, 0, 2);
  G.scene.add(light);
  setTimeout(warmUp, 2500);       // after the first frames, once every lamp is in the scene
}
// build the nuke's shaders ahead of time, so the blast itself doesn't stall the game
function warmUp() {
  if (warm || !G.renderer || !G.scene) return;
  shapes();
  const g = new THREE.Group(), pm = puffMesh();
  pm.count = 1;
  g.add(pm, new THREE.Mesh(G_WALL, MATS.spray()), new THREE.Mesh(G_SHELL, MATS.shell()), new THREE.Mesh(G_WALL, MATS.wall()), new THREE.Mesh(G_BEAM, MATS.beam()), new THREE.Sprite(spriteMat()), bombModel());
  try { G.renderer.compile(g, G.camera, G.scene); } catch (e) { console.warn('Nuke shaders:', e); }
  warm = g;           // kept: the compiled shaders stay ready for the real thing
}

// ---------- the warning ----------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const STEAMW = new THREE.Color('#edf2f4');
export function nukeZone(x, z, R) {
  clearZone();
  shapes(); warmUp();
  const wall = new THREE.Mesh(G_WALL, MATS.wall());
  wall.scale.set(R, 28, R); wall.position.set(x, -1, z); wall.renderOrder = 4; wall.frustumCulled = false;
  wall.material.uniforms.uCount.value = Math.round(TAU * R / 7);
  const beam = new THREE.Mesh(G_BEAM, MATS.beam());
  beam.scale.set(0.9, 650, 0.9); beam.position.set(x, -1, z); beam.renderOrder = 4; beam.frustumCulled = false;
  const bomb = bombModel(); bomb.visible = false;
  const blink = new THREE.Sprite(spriteMat()); blink.scale.setScalar(6); blink.material.color.set('#ff2a1a'); blink.visible = false; blink.renderOrder = 10;
  const g = new THREE.Group(); g.add(wall, beam, bomb, blink);
  G.scene.add(g);
  zone = { x, z, R, g, wall, beam, bomb, blink, whistled: false };
  NUKE_SEA.zone.set(x, z, R, 0.8);
}
// n = G.nuke (n.t = seconds left)
export function updateZone(n, dt) {
  if (!zone) return;
  const u = clamp(1 - n.t / 15, 0, 1), pulse = 0.5 + 0.5 * Math.sin(G.t * (4 + 10 * u));
  NUKE_SEA.zone.w = 0.55 + 0.4 * pulse;
  const wu = zone.wall.material.uniforms, bu = zone.beam.material.uniforms;
  wu.uTime.value = G.t; wu.uAlpha.value = 0.3 + 0.3 * pulse;
  bu.uTime.value = G.t; bu.uAlpha.value = 0.45 + 0.4 * pulse;
  // in the last seconds the bomb falls out of the sky (faster and faster), blinking, trailing a contrail
  const left = Math.max(0, n.t);
  if (left >= FALL) return;
  const s = FALL - left, y = Math.max(18, 363 - 40 * s - 7.6 * s * s);
  const bm = zone.bomb;
  bm.visible = true;
  bm.position.set(zone.x + Math.sin(G.t * 1.7) * 0.3, y, zone.z + Math.cos(G.t * 1.3) * 0.3);
  bm.rotation.set(Math.sin(G.t * 2.1) * 0.05, G.t * 2.4, Math.cos(G.t * 1.9) * 0.05);
  zone.blink.visible = Math.sin(G.t * (10 + 25 * s / FALL)) > 0;
  zone.blink.position.set(bm.position.x, y + 3.4, bm.position.z);
  if (Math.random() < dt * 40) FX.sprite({ x: bm.position.x + rand(-0.4, 0.4), y: y + 4, z: bm.position.z + rand(-0.4, 0.4), vx: rand(-0.3, 0.3), vy: rand(0, 1), vz: rand(-0.3, 0.3), life: rand(2, 3.5), size: rand(1.2, 2.4), color: STEAMW, g: 0, drag: 1, alpha: 0.5, grow: 2.2, fadePow: 1 });
  if (!zone.whistled && left < 3.4) { zone.whistled = true; sfx.whistle(); }
}
export function clearZone() {
  if (!zone) return;
  G.scene.remove(zone.g);
  zone.wall.material.dispose(); zone.beam.material.dispose(); zone.blink.material.dispose();
  zone = null;
  NUKE_SEA.zone.set(0, 0, 0, 0);
}

// ---------- the blast ----------
// what the cloud is made of: the fireball, the cap (a rolling ring + a dome on top), the stem, the base surge
// on the water and the condensation collar around the stem
function makePuffs() {
  const P = [];
  const anyTurn = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)));
  const yTurn = () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, TAU));     // flat puffs stay flat
  const add = (o, flat = false) => P.push(Object.assign({ s: rand(0.85, 1.15), seed: Math.random(), quat: flat ? yTurn() : anyTurn() }, o));
  add({ k: 'fire', main: true, ox: 0, oy: 0, oz: 0, s: 1 });
  for (let i = 0; i < 6; i++) { const v = new THREE.Vector3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize(); add({ k: 'fire', ox: v.x, oy: v.y, oz: v.z }); }
  for (let i = 0; i < 18; i++) for (let j = 0; j < 3; j++) add({ k: 'ring', u: (i + (j % 2) * 0.5) / 18 * TAU + rand(-0.08, 0.08), v: j / 3 * TAU + rand(-0.3, 0.3) });
  for (let i = 0; i < 10; i++) add({ k: 'dome', a: rand(0, TAU), rr: Math.sqrt(Math.random()) * 0.75, h: Math.random() });
  for (let i = 0; i < 18; i++) add({ k: 'stem', f: (i + rand(0, 0.6)) / 18, a: rand(0, TAU) });
  for (let i = 0; i < 22; i++) add({ k: 'surge', a: i / 22 * TAU + rand(-0.1, 0.1), rr: rand(0.85, 1.1) }, true);
  for (let i = 0; i < 8; i++) add({ k: 'surge', a: rand(0, TAU), rr: rand(0.35, 0.6) }, true);
  for (let i = 0; i < 12; i++) add({ k: 'collar', a: i / 12 * TAU + rand(-0.1, 0.1) }, true);
  return P;
}

export function nukeBlast(x, z, opts = {}) {
  clearZone();
  shapes();
  const b = { x, z, t: 0, opts, live: makePuffs().map(q => ({ q })), act: [], shipHit: new Set(), tHit: new Set(), heard: null };
  b.mesh = puffMesh();
  b.spray = new THREE.Mesh(G_WALL, MATS.spray());
  b.mist = new THREE.Mesh(G_WALL, MATS.spray());
  b.shell = new THREE.Mesh(G_SHELL, MATS.shell());
  b.halo = new THREE.Sprite(spriteMat());
  b.streak = new THREE.Sprite(spriteMat());
  for (const m of [b.spray, b.mist, b.shell]) { m.renderOrder = 3; m.frustumCulled = false; m.visible = false; }
  b.halo.renderOrder = b.streak.renderOrder = 10;
  b.group = new THREE.Group();
  b.group.add(b.mesh, b.spray, b.mist, b.shell, b.halo, b.streak);
  G.scene.add(b.group);
  SKY0.h ??= SKY.horizon.clone(); SKY0.z ??= SKY.zenith.clone();
  if (G.airFog) SKY0.fog ??= G.airFog.color.clone();
  BLASTS.push(b);
  updateBlast(b, 0);           // the very first frame already shows it
  return b;
}

export function updateNukeFx(dt) {
  for (let i = BLASTS.length - 1; i >= 0; i--) {
    const b = BLASTS[i];
    updateBlast(b, dt);
    if (b.t > LIFE) { removeBlast(b); BLASTS.splice(i, 1); if (!BLASTS.length) restoreWorld(); }
  }
}
export function clearNukeFx() {
  for (const b of BLASTS) removeBlast(b);
  BLASTS.length = 0;
  clearZone();
  restoreWorld();
  clearDeafen();
  G.flashScreen = 0;
}
function removeBlast(b) {
  G.scene.remove(b.group);
  b.mesh.geometry.dispose(); b.mesh.dispose();
  for (const m of [b.mesh, b.spray, b.mist, b.shell, b.halo, b.streak]) m.material.dispose();
}
function restoreWorld() {
  NUKE_SEA.ring.set(0, 0, 0, 0); NUKE_SEA.ring2.set(6, 0, 0, 0); NUKE_SEA.glow.set(0, 0, 0, 0);
  NUKE_SEA.sky.setRGB(0, 0, 0); NUKE_SEA.flash = 0;
  if (SKY0.h) { SKY.horizon.copy(SKY0.h); SKY.zenith.copy(SKY0.z); }
  if (G.airFog && SKY0.fog) G.airFog.color.copy(SKY0.fog);
  if (light) light.intensity = 0;
  if (flashEl) flashEl.style.background = '';
  if (afterEl) afterEl.style.opacity = '0';
}

const CAP0 = new THREE.Color(0.6, 0.45, 0.4), CAP1 = new THREE.Color(0.82, 0.8, 0.79), STEM0 = new THREE.Color(0.86, 0.86, 0.88);
const SURGE = new THREE.Color(0.9, 0.92, 0.94), COLLAR = new THREE.Color(0.97, 0.97, 0.98), ASHEN = new THREE.Color(0.5, 0.42, 0.38);
const _cap = new THREE.Color(), _col = new THREE.Color(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
// where every puff is this frame, how big, hot, shaded and see-through; then sorted far to near and sent to the GPU
function layout(b) {
  const t = b.t, cam = G.camera.position, act = b.act;
  const H = headY(t), Rf = fireR(t), hot = heatOf(t), fire = fireOf(t), wind = windOf(t);
  const Rc = 6 + 36 * (1 - Math.exp(-t / 7)), rt = 9 + 17 * (1 - Math.exp(-t / 6));      // the cap's ring and its thickness
  const roll = 0.16 * t + 3 * (1 - Math.exp(-t / 6));                                   // how far the cap has rolled
  const fade = 1 - smooth(40, 58, t), spread = 1 + Math.max(0, t - 30) * 0.008;
  const stemLen = Math.max(0, H - rt * 0.55 - 2);
  _cap.copy(CAP0).lerp(CAP1, smooth(8, 35, t));          // reddish brown at first, light grey as it cools
  act.length = 0;
  for (const L of b.live) {
    const q = L.q;
    let x, y, zz, r, sy = 1, heat = 0, shadow = 0, alpha;
    _col.copy(_cap);
    if (q.k === 'fire') {             // the fireball: one big boiling ball and six around it
      if (t > 14) continue;
      r = Rf * (q.main ? 0.92 : 0.58) * q.s;
      x = b.x + q.ox * Rf * 0.55 + wind * 0.3; y = H + q.oy * Rf * 0.45; zz = b.z + q.oz * Rf * 0.55;
      heat = fire * (q.main ? 1 : 0.92); alpha = 1 - smooth(9, 14, t); _col.copy(ASHEN);
    } else if (q.k === 'ring') {      // the cap rolls like a smoke ring: up the middle, out over the top, down the outside
      const v = q.v - roll, cv = Math.cos(v), sv = Math.sin(v), rad = Rc + rt * 0.55 * cv;
      x = b.x + Math.cos(q.u) * rad + wind * (0.9 + 0.1 * sv); y = H + rt * 0.5 * sv; zz = b.z + Math.sin(q.u) * rad;
      r = rt * 0.74 * q.s * spread * smooth(0.1, 1.6, t);
      heat = hot * clamp(0.6 - 0.45 * cv - 0.2 * sv, 0.05, 1); shadow = clamp(0.1 - sv * 0.45, 0, 0.55);
      alpha = fade * smooth(0.1, 1, t);
    } else if (q.k === 'dome') {      // the top of the cap
      x = b.x + Math.cos(q.a) * q.rr * Rc + wind; y = H + rt * (0.3 + 0.45 * q.h + 0.05 * Math.sin(t * 0.4 + q.seed * 6)); zz = b.z + Math.sin(q.a) * q.rr * Rc;
      r = rt * 0.82 * q.s * spread * smooth(0.3, 2, t);
      heat = hot * 0.55; alpha = fade * smooth(0.2, 1.2, t);
    } else if (q.k === 'stem') {      // steam and smoke rising up the stem, thin in the middle, wide at both ends
      const f = (q.f + t * 0.04) % 1, a = q.a + t * 0.15;
      const rs = (5.5 + 3.5 * f * f + 9 * (1 - f) ** 4) * (0.55 + 0.45 * (1 - Math.exp(-t / 6)));
      x = b.x + Math.cos(a) * rs * 0.35 + wind * f; y = 2 + f * stemLen; zz = b.z + Math.sin(a) * rs * 0.35;
      r = rs * 1.1 * q.s;
      heat = hot * f * f * 0.9; shadow = 0.15 + 0.35 * f;
      _col.copy(STEM0).lerp(_cap, smooth(0.3, 0.8, f));
      alpha = fade * smooth(1.2, 3.5, t) * smooth(0, 0.1, f) * (1 - smooth(0.88, 1, f)) * smooth(6, 14, stemLen);
    } else if (q.k === 'surge') {     // the base surge: a low wall of white mist rolling out over the water
      const R = q.rr * (18 + 150 * (1 - Math.exp(-t / 10)));
      x = b.x + Math.cos(q.a) * R + wind * 0.5; y = 2.2 + q.s * 1.2; zz = b.z + Math.sin(q.a) * R;
      r = (9 + 11 * (1 - Math.exp(-t / 8))) * q.s; sy = 0.55; shadow = 0.05;
      _col.copy(SURGE);
      alpha = 0.85 * smooth(0.5, 2.5, t) * (1 - smooth(16, 34, t));
    } else {                          // the collar: a ring of condensation around the stem
      const R = Rc * 0.85 + 8 + Math.max(0, t - 3) * 0.6;
      x = b.x + Math.cos(q.a) * R + wind * 0.6; y = H * 0.52 + Math.sin(q.a * 3 + t * 0.5) * 1.2; zz = b.z + Math.sin(q.a) * R;
      r = 6.5 * q.s; sy = 0.5;
      _col.copy(COLLAR);
      alpha = 0.75 * smooth(3.2, 5.5, t) * (1 - smooth(11, 18, t));
    }
    if (!(alpha > 0.01) || !(r > 0.3)) continue;
    L.x = x; L.y = y; L.z = zz; L.r = r; L.sy = sy; L.heat = heat; L.shadow = shadow; L.alpha = alpha;
    L.cr = _col.r; L.cg = _col.g; L.cb = _col.b;
    L.d2 = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (zz - cam.z) ** 2;
    act.push(L);
  }
  act.sort((a, c) => c.d2 - a.d2);
  const m = b.mesh, ap = m.geometry.attributes.aPuff, at = m.geometry.attributes.aTint;
  for (let k = 0; k < act.length; k++) {
    const L = act[k];
    _m.compose(_p.set(L.x, L.y, L.z), L.q.quat, _s.set(L.r, L.r * L.sy, L.r));
    m.setMatrixAt(k, _m);
    ap.array[k * 4] = L.q.seed; ap.array[k * 4 + 1] = L.heat; ap.array[k * 4 + 2] = L.shadow; ap.array[k * 4 + 3] = L.alpha;
    at.array[k * 3] = L.cr; at.array[k * 3 + 1] = L.cg; at.array[k * 3 + 2] = L.cb;
  }
  m.count = act.length;
  m.instanceMatrix.needsUpdate = true; ap.needsUpdate = true; at.needsUpdate = true;
}

function setWall(m, b, r, h, alpha, time, fire) {
  m.visible = alpha > 0.003;
  if (!m.visible) return;
  const u = m.material.uniforms;
  m.position.set(b.x, -1.5, b.z); m.scale.set(r, h + 1.5, r);
  u.uTime.value = time; u.uAlpha.value = alpha; u.uR.value = r;
  u.uGlow.value.setRGB(1, 0.45, 0.15).multiplyScalar(fire * 0.7 * Math.exp(-r / 120));
}

const ORANGE_H = new THREE.Color('#ff8a40'), ORANGE_Z = new THREE.Color('#b0503a');
function updateBlast(b, dt) {
  b.t += dt;
  const t = b.t, H = headY(t), Rf = fireR(t), hot = heatOf(t), fire = fireOf(t);
  const gx = b.x + windOf(t) * 0.3;
  const r = shockR(t), wk = waveK(r);
  layout(b);
  const mu = b.mesh.material.uniforms;
  mu.uTime.value = t;
  mu.uGlowPos.value.set(gx, H, b.z);
  mu.uGlowK.value = fire * 3.2 + hot * 0.9 + Math.exp(-t * 3) * 2;
  mu.uSkyTop.value.copy(SKY.zenith).lerp(SKY.horizon, 0.45);
  mu.uDetail.value = S.particles === 'low' ? 0 : 1;
  // the blast wave: a wall of spray riding on it, a thin mist trailing behind, the Wilson cloud just inside it
  setWall(b.spray, b, r, 4 + 24 * wk ** 1.2, 0.85 * wk * smooth(0, 0.25, t), t, fire);
  setWall(b.mist, b, Math.max(1, r * 0.93 - 6), 8 + 30 * wk, 0.32 * wk * smooth(0.2, 0.8, t) * (1 - smooth(3, 7, t)), t * 0.6, fire);
  const su = b.shell.material.uniforms;
  su.uTime.value = t; su.uAlpha.value = 0.6 * smooth(0.08, 0.4, t) * (1 - smooth(0.9, 2.4, t));
  b.shell.visible = su.uAlpha.value > 0.002;
  b.shell.position.set(b.x, -2, b.z); b.shell.scale.setScalar(Math.max(1, r * 0.95));
  // the fireball's glare and a streak through it
  const fl = Math.exp(-t * 2.2), hk = clamp(fl * 0.9 + fire * 0.8, 0, 1);
  b.halo.position.set(gx, H, b.z); b.halo.scale.setScalar(Math.max(1, Rf) * (3 + 7 * fl));
  b.halo.material.color.setRGB(1, 0.6 + 0.4 * fire, 0.3 + 0.7 * fire * fire); b.halo.material.opacity = hk;
  b.halo.visible = hk > 0.01;
  const sk = clamp(fl * 0.7 + fire * fire * 0.35, 0, 1);
  b.streak.position.set(gx, H, b.z); b.streak.scale.set(Math.max(1, Rf) * 18 * (0.6 + fl), Math.max(1, Rf) * 0.5, 1);
  b.streak.material.color.setRGB(1, 0.72 + 0.28 * fire, 0.45 + 0.55 * fire); b.streak.material.opacity = sk;
  b.streak.visible = sk > 0.01;
  if (b === BLASTS[BLASTS.length - 1]) world(b, t, H, gx, fire, hot, r, wk);
  particles(b, dt, t, H, gx, hot, r, wk);
  arrivals(b, t, r);
}

// the newest blast lights the world: the point light, the sky, the sea, the screen
function world(b, t, H, gx, fire, hot, r, wk) {
  const cam = G.camera, cp = cam.position;
  if (light) {
    light.position.set(gx, H, b.z);
    light.intensity = 140000 * Math.exp(-t * 7) + 26000 * fire + 7000 * hot;
    light.color.setRGB(1, 0.55 + 0.4 * fire, 0.25 + 0.6 * fire * fire);
  }
  NUKE_SEA.ring.set(b.x, b.z, r, wk > 0.004 ? 4.5 * wk * smooth(0, 0.12, t) : 0);
  NUKE_SEA.ring2.set(4 + r * 0.035, clamp(wk * 1.7, 0, 1), 0.85 * Math.exp(-t / 6), smooth(0, 0.6, t) * (1 - smooth(10, 32, t)));
  const fl = Math.exp(-t * 3);
  NUKE_SEA.glow.set(gx, H, b.z, 3.2 * fl + 1.5 * fire + 0.5 * hot);
  NUKE_SEA.col.setRGB(1, 0.5 + 0.35 * fire, 0.18 + 0.5 * fire * fire);
  NUKE_SEA.sky.copy(NUKE_SEA.col).multiplyScalar(0.9 * fl + 0.8 * fire + 0.35 * hot);
  NUKE_SEA.flash = t < 0.08 ? 0.85 : 0.85 * Math.exp(-(t - 0.08) * 9);
  // the whole sky turns orange for a while (the air fog with it), then clears
  const tint = t < 2 ? smooth(0, 2, t) : 1 - smooth(6, 24, t);
  if (SKY0.h) { SKY.horizon.copy(SKY0.h).lerp(ORANGE_H, 0.55 * tint); SKY.zenith.copy(SKY0.z).lerp(ORANGE_Z, 0.42 * tint); }
  if (G.airFog && SKY0.fog) G.airFog.color.copy(SKY0.fog).lerp(ORANGE_H, 0.45 * tint);
  // the flash on the screen: blinding if you look at it, warm white fading to orange
  flashEl ||= document.getElementById('flash');
  if (t < 3.5) {
    const to = _v2.set(gx - cp.x, H - cp.y, b.z - cp.z), dd = to.length() || 1;
    const look = cam.getWorldDirection(_v1).dot(to.divideScalar(dd));
    const vis = (0.55 + 0.45 * smooth(-0.2, 0.7, look)) * (dd < 1100 ? 1 : 0.6);
    G.flashScreen = vis * (t < 0.06 ? 0.95 : 0.95 * Math.exp(-(t - 0.06) * 2.6));
    const k = smooth(0.1, 1.6, t);
    if (flashEl) flashEl.style.background = `rgb(255, ${Math.round(255 - 70 * k)}, ${Math.round(250 - 150 * k)})`;
  } else if (!b.flashDone) { b.flashDone = true; if (flashEl) flashEl.style.background = ''; }
  // ...and the spot it burns into your eyes, which stays put on the screen
  if (!b.after && t > 0.03) { b.after = true; afterimage(b, gx, H); }
  if (b.afterOn && afterEl) afterEl.style.opacity = (0.8 * (1 - smooth(0.6, 6, t))).toFixed(3);
}
function afterimage(b, gx, H) {
  const cam = G.camera, v = _v1.set(gx, H, b.z).project(cam);
  if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
  const dist = Math.max(1, cam.position.distanceTo(_v2.set(gx, H, b.z)));
  const px = 27 / dist * innerHeight / (2 * Math.tan(cam.fov * Math.PI / 360));
  if (!afterEl) {
    afterEl = document.createElement('div');
    afterEl.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;border-radius:50%;pointer-events:none;z-index:39;opacity:0;mix-blend-mode:screen;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(200,170,255,0.6) 0%,rgba(130,90,230,0.28) 42%,rgba(0,0,0,0) 70%)';
    document.body.appendChild(afterEl);
  }
  const size = clamp(px * 2.6, 60, innerHeight * 0.9);
  afterEl.style.width = afterEl.style.height = size + 'px';
  afterEl.style.left = (v.x + 1) / 2 * innerWidth + 'px'; afterEl.style.top = (1 - v.y) / 2 * innerHeight + 'px';
  b.afterOn = true;
}

const EMB0 = new THREE.Color('#fff0b0'), EMB1 = new THREE.Color('#ff4a12'), SMOKEC = new THREE.Color('#4d413b'), SMOKE2 = new THREE.Color('#78706b'), SPRAYC = new THREE.Color('#e4f1f5');
function particles(b, dt, t, H, gx, hot, r, wk) {
  const cp = G.camera.position;
  // the first instant: embers and tongues of fire flung out of the fireball
  if (!b.burst && t > 0.02) {
    b.burst = true;
    for (let i = 0; i < 240; i++) {
      const a = rand(0, TAU), e = rand(-0.1, 1.25), sp = rand(22, 80);
      FX.sprite({ x: gx, y: H, z: b.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: rand(1.6, 4.2), size: rand(0.7, 2), color: EMB0, c2: EMB1, g: 9.8, drag: 0.55, alpha: 1, die: true }, true);
    }
    for (let i = 0; i < 36; i++) {
      const a = rand(0, TAU), e = rand(-0.2, 1), sp = rand(30, 70);
      FX.sprite({ x: gx, y: H, z: b.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: rand(0.5, 1), size: rand(8, 16), color: EMB0, c2: EMB1, g: 0, drag: 2.6, alpha: 0.9 }, true);
    }
  }
  // smoke boiling off the edge of the cap
  if (t > 1 && t < 32 && Math.random() < dt * 16) {
    const L = b.act[Math.random() * b.act.length | 0];
    if (L && (L.q.k === 'ring' || L.q.k === 'dome')) {
      const ox = L.x - gx, oz = L.z - b.z, ol = Math.hypot(ox, oz) || 1;
      FX.sprite({ x: L.x + ox / ol * L.r * 0.6, y: L.y + L.r * rand(-0.2, 0.6), z: L.z + oz / ol * L.r * 0.6, vx: ox / ol * rand(0.5, 2), vy: rand(0.3, 1.5), vz: oz / ol * rand(0.5, 2), life: rand(5, 9), size: L.r * rand(0.6, 1.1), color: Math.random() < 0.5 ? SMOKEC : SMOKE2, g: -0.1, drag: 0.5, alpha: 0.3 * L.alpha, grow: 1.2, fadePow: 1 });
    }
  }
  // sparks rising up the stem while it's hot
  if (t > 0.3 && t < 8 && Math.random() < dt * 40 * hot) FX.sprite({ x: gx + rand(-8, 8), y: rand(5, H * 0.7), z: b.z + rand(-8, 8), vx: rand(-1, 1), vy: rand(6, 14), vz: rand(-1, 1), life: rand(1, 2.2), size: rand(0.5, 1.4), color: EMB0, c2: EMB1, g: -1, drag: 0.4, alpha: 0.9 }, true);
  // the sea boiling at ground zero
  if (t > 0.4 && t < 26 && Math.random() < dt * 10) {
    const a = rand(0, TAU), rr = rand(5, 60);
    FX.sprite({ x: b.x + Math.cos(a) * rr, y: 0.5, z: b.z + Math.sin(a) * rr, vx: 0, vy: rand(1.5, 4), vz: 0, life: rand(3, 6), size: rand(5, 11), color: STEAMW, g: -0.2, drag: 0.6, alpha: 0.35 * (1 - smooth(14, 26, t)), grow: 1.6, fadePow: 1 });
  }
  // spray flying off the wave front where it passes near you
  const dC = Math.hypot(cp.x - b.x, cp.z - b.z);
  if (wk > 0.02 && Math.abs(r - dC) < 80) {
    const base = Math.atan2(cp.z - b.z, cp.x - b.x), span = Math.min(0.9, 70 / Math.max(r, 1));
    const n = Math.round(dt * 260 * Math.min(1, wk * 2.2));
    for (let i = 0; i < n; i++) {
      const a = base + rand(-span, span), ox = Math.cos(a), oz = Math.sin(a);
      const x = b.x + ox * r, zz = b.z + oz * r, sea = waveHeight(x, zz), sp = rand(8, 22) * wk;
      FX.sprite({ x, y: sea + rand(0, 1.5), z: zz, vx: ox * sp, vy: rand(4, 13) * (0.4 + wk), vz: oz * sp, life: rand(0.7, 1.6), size: rand(0.8, 2.6) * (0.6 + wk), color: SPRAYC, g: 9.8, drag: 0.7, alpha: 0.75, grow: 1.4, die: true });
      if (Math.random() < 0.25) FX.sprite({ x, y: sea + rand(1, 5), z: zz, vx: ox * sp * 0.4, vy: rand(1, 3), vz: oz * sp * 0.4, life: rand(1.5, 3), size: rand(5, 10) * (0.5 + wk), color: SPRAYC, g: 0, drag: 0.9, alpha: 0.25, grow: 1.8, fadePow: 1 });
    }
  }
  // ash drifting down for a long while
  if (t > 5 && t < 45 && Math.random() < dt * 60 * (1 - smooth(30, 45, t))) FX.ash(cp.x + rand(-25, 25), cp.y + rand(6, 18), cp.z + rand(-25, 25));
}

// the blast wave reaching things: ships get rocked here (on every screen); weapons.js does the damage and the
// shove (host only); you get the bang
function arrivals(b, t, r) {
  if (r < 340) for (const s of G.ships) {
    if (s.gone || b.shipHit.has(s)) continue;
    const dist = Math.hypot(s.x - b.x, s.z - b.z), d = Math.max(0, dist - s.hl * 0.5);
    if (d > r) continue;
    b.shipHit.add(s);
    if (d < 300) {        // heeled over away from the blast, the near end thrown up
      const k = (1 - d / 300) * 16, tx = (b.x - s.x) / (dist || 1), tz = (b.z - s.z) / (dist || 1);
      const ahead = tx * Math.sin(s.yaw) + tz * Math.cos(s.yaw), side = tx * Math.cos(s.yaw) - tz * Math.sin(s.yaw);
      s.vr += side * k * 0.06 + rand(-1, 1) * k * 0.01;
      s.vp += ahead * k * 0.035;
      s.vy += k * 0.25;
    }
    b.opts.onShip?.(s, d);
  }
  if (b.opts.targets && r < (b.opts.reach ?? 0) + 20) for (const tg of b.opts.targets()) {
    if (b.tHit.has(tg)) continue;
    const c = tg.center(_v3), d = Math.hypot(c.x - b.x, c.z - b.z);
    if (d > r) continue;
    b.tHit.add(tg);
    b.opts.onTarget?.(tg, d);
  }
  // you: silence after the flash until the blast wave gets to you, then the bang
  const cp = G.camera.position, dC = Math.hypot(cp.x - b.x, cp.z - b.z);
  if (b.heard == null && t >= shockTime(dC)) {
    b.heard = t; b.near = clamp(1 - dC / 600, 0.06, 1);
    sfx.nukeBoom(b.near);
    G.shake = Math.max(G.shake || 0, 0.5 + 2.3 * b.near * b.near);
    if (dC < 450) {        // the wave front washes over you: spray everywhere
      const k = clamp(1 - dC / 450, 0.15, 1), ox = (cp.x - b.x) / (dC || 1), oz = (cp.z - b.z) / (dC || 1);
      for (let i = 0; i < 50 * k; i++) {
        const x = cp.x + rand(-10, 10) - ox * rand(0, 6), zz = cp.z + rand(-10, 10) - oz * rand(0, 6);
        FX.sprite({ x, y: Math.max(waveHeight(x, zz), cp.y - 3) + rand(0, 3), z: zz, vx: ox * rand(8, 25) * k, vy: rand(2, 8), vz: oz * rand(8, 25) * k, life: rand(0.6, 1.4), size: rand(0.4, 1.6), color: SPRAYC, g: 9.8, drag: 0.8, alpha: 0.8, grow: 1.2 });
      }
    }
  }
  if (b.heard != null) {
    const e = t - b.heard;
    if (!b.deaf && e > 0.3) { b.deaf = true; deafen(0.2 + 0.8 * b.near); if (b.near > 0.45) sfx.ears(b.near); }
    if (!b.rumble && e > 0.8) { b.rumble = true; sfx.nukeRumble(b.near); }
    if (e < 7) G.shake = Math.max(G.shake || 0, 0.45 * b.near * (1 - e / 7));
  }
}
