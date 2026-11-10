// The ocean: Gerstner waves used by both the GPU (what you see) and the CPU (buoyancy, swimming, splashes),
// so ships ride exactly the waves that are drawn. Detail ripples come from a generated normal map.
import * as THREE from 'three';
import { G } from './state.js';

// direction (radians), wavelength (m), amplitude (m)
const RAW = [[0.6, 92, 0.72], [0.22, 61, 0.46], [1.05, 39, 0.29], [0.42, 26, 0.18], [0.92, 17, 0.11], [0.08, 12, 0.07], [1.32, 8.5, 0.045], [0.7, 6, 0.03]];
const CHOP = 0.72;
const WAVES = RAW.map(([a, len, amp]) => {
  const k = Math.PI * 2 / len;
  return { dx: Math.cos(a), dz: Math.sin(a), a: amp, k, w: Math.sqrt(9.8 * k), q: CHOP / (k * amp * RAW.length) };
});
const AMP_SUM = WAVES.reduce((s, w) => s + w.a, 0);

// exact height under a world point (inverts the sideways Gerstner motion with a few iterations)
export function waveHeight(x, z, t = G.t) {
  const A = G.seaAmp, qs = 1 / Math.max(A, 1);
  let x0 = x, z0 = z;
  for (let it = 0; it < 3; it++) {
    let dx = 0, dz = 0;
    for (const w of WAVES) {
      const c = Math.cos(w.k * (w.dx * x0 + w.dz * z0) - w.w * t) * w.q * qs * w.a * A;
      dx += w.dx * c; dz += w.dz * c;
    }
    x0 = x - dx; z0 = z - dz;
  }
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin(w.k * (w.dx * x0 + w.dz * z0) - w.w * t);
  return h * A;
}
// cheaper version for particles and foam (no sideways correction, big waves only)
export function waveHeightFast(x, z, t = G.t) {
  let h = 0;
  for (let i = 0; i < 4; i++) { const w = WAVES[i]; h += w.a * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t); }
  return h * G.seaAmp;
}

export const SKY = { zenith: new THREE.Color('#2f6fb8'), horizon: new THREE.Color('#bcd7e6'), sunDir: new THREE.Vector3(0.45, 0.55, -0.7).normalize() };

// tiling normal map from periodic value noise
export function makeNormalTexture(size = 256) {
  const h = new Float32Array(size * size);
  for (const [n, amp] of [[8, 1], [16, 0.5], [32, 0.27], [64, 0.14]]) {
    const g = Float32Array.from({ length: n * n }, Math.random);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * n, fy = y / size * n, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[(iy % n) * n + ix % n], b = g[(iy % n) * n + (ix + 1) % n], c = g[((iy + 1) % n) * n + ix % n], d = g[((iy + 1) % n) * n + (ix + 1) % n];
      h[y * size + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const L = h[y * size + (x + size - 1) % size], R = h[y * size + (x + 1) % size];
    const D = h[((y + size - 1) % size) * size + x], U = h[((y + 1) % size) * size + x];
    let nx = (L - R) * 6, nz = (D - U) * 6, ny = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * size + x) * 4;
    data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (nz * 0.5 + 0.5) * 255; data[o + 2] = ny * 255; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
export const NORMAL_TEX = makeNormalTexture();

const MAX_SHIPS = 8, MAX_ISL = 16;
let ocean, sky, uniforms;

const vert = /* glsl */`
  uniform float uTime, uAmp;
  uniform vec4 uWave[8];
  uniform float uQ[8];
  varying vec3 vWorld; varying float vH; varying vec3 vNormal2; varying float vJ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 p0 = wp.xz;
    vec3 disp = vec3(0.0);
    float nx = 0.0, ny = 0.0, nz = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0;
    float qs = 1.0 / max(uAmp, 1.0);
    for (int i = 0; i < 8; i++) {
      vec4 w = uWave[i];
      float A = w.z * uAmp, k = w.w, q = uQ[i] * qs;
      float ph = k * dot(w.xy, p0) - sqrt(9.8 * k) * uTime;
      float c = cos(ph), s = sin(ph);
      disp.x += q * A * w.x * c; disp.z += q * A * w.y * c; disp.y += A * s;
      float wa = k * A;
      nx += w.x * wa * c; nz += w.y * wa * c; ny += q * wa * s;
      jxx += q * wa * w.x * w.x * s; jzz += q * wa * w.y * w.y * s; jxz += q * wa * w.x * w.y * s;
    }
    wp.xyz += disp;
    vWorld = wp.xyz; vH = disp.y;
    vNormal2 = normalize(vec3(-nx, 1.0 - ny, -nz));
    vJ = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const frag = /* glsl */`
  uniform float uTime, uAmp, uAmpSum, uFogDen;
  uniform vec3 uZenith, uHorizon, uSun, uFog;
  uniform sampler2D uNorm;
  uniform int uShips, uIsl;
  uniform mat4 uShipInv[${MAX_SHIPS}];
  uniform vec4 uShipDim[${MAX_SHIPS}];   // half width, half length, deck top, speed
  uniform vec4 uShipShape[${MAX_SHIPS}]; // bottom width, bow start, stern taper
  uniform vec3 uIsland[${MAX_ISL}];
  varying vec3 vWorld; varying float vH; varying vec3 vNormal2; varying float vJ;

  float hullHalf(float yN, float zN, float hw, vec4 sh) {
    float w = hw * (sh.x + (1.0 - sh.x) * sqrt(clamp(yN, 0.0, 1.0)));
    if (zN > sh.y) { float b = (zN - sh.y) / (1.0 - sh.y); w *= 1.0 - b * b * 0.92; }
    if (zN < -0.8) { float s = (-zN - 0.8) / 0.2; w *= 1.0 - s * s * sh.z; }
    return w;
  }
  vec3 skyCol(vec3 d) {
    vec3 c = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.6));
    float s = max(dot(d, uSun), 0.0);
    return c + vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.25;
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    float wake = 0.0;
    for (int i = 0; i < ${MAX_SHIPS}; i++) {
      if (i >= uShips) break;
      vec3 lp = (uShipInv[i] * vec4(vWorld, 1.0)).xyz;
      vec4 dm = uShipDim[i], sh = uShipShape[i];
      if (abs(lp.z) > dm.y + 95.0 || abs(lp.x) > 45.0) continue;
      // never draw the sea inside a hull (below its deck)
      if (lp.y > 0.05 && lp.y < dm.z && abs(lp.z) < dm.y - 0.05) {
        if (abs(lp.x) < hullHalf(lp.y / dm.z, lp.z / dm.y, dm.x, sh) - 0.12) discard;
      }
      float sp = clamp(abs(dm.w) / 9.0, 0.0, 1.3);
      float hwW = hullHalf(0.48, clamp(lp.z / dm.y, -1.0, 1.0), dm.x, sh);
      if (abs(lp.z) < dm.y) wake += smoothstep(0.9 + sp, 0.0, abs(lp.x) - hwW) * (0.3 + sp * 0.6);
      // a short, soft trail of churned water behind the stern (no long straight lines: they swing with the ship)
      float zb = -lp.z - dm.y * 0.9;
      float len = 18.0 + dm.y * 1.2;
      if (zb > 0.0 && zb < len) {
        float fade = 1.0 - zb / len; fade *= fade;
        float wd = dm.x * 0.55 + zb * 0.07;
        wake += (1.0 - smoothstep(wd * 0.3, wd, abs(lp.x))) * fade * sp * 0.7;
      }
      float zf = lp.z - dm.y * 0.86;
      wake += smoothstep(2.6, 0.0, length(vec2(lp.x, zf))) * sp;
    }

    float dist = length(cameraPosition - vWorld);
    float detFade = 1.0 / (1.0 + dist * 0.012);
    vec2 n1 = texture2D(uNorm, p / 13.0 + vec2(t * 0.021, t * 0.013)).xy * 2.0 - 1.0;
    vec2 n2 = texture2D(uNorm, p / 41.0 - vec2(t * 0.012, -t * 0.017)).xy * 2.0 - 1.0;
    vec2 n3 = texture2D(uNorm, p / 4.1 + vec2(-t * 0.05, t * 0.04)).xy * 2.0 - 1.0;
    vec2 det = (n1 * 0.5 + n2 * 0.65 + n3 * 0.3 * detFade) * (0.3 + 0.2 * uAmp) * (0.4 + 0.6 * detFade);
    vec3 N = normalize(vNormal2 + vec3(det.x, 0.0, det.y));
    vec3 V = normalize(cameraPosition - vWorld);

    if (!gl_FrontFacing) {
      // under the surface looking up: a bright, rippling Snell's window, total reflection outside it
      vec3 Nd = -N;
      float cosI = max(dot(-V, -Nd), 0.0);
      float win = smoothstep(0.62, 0.8, cosI);
      float rip = texture2D(uNorm, p / 3.0 + vec2(t * 0.06, t * 0.04)).x;
      vec3 deepU = vec3(0.01, 0.09, 0.12);
      vec3 c = mix(deepU, vec3(0.55, 0.8, 0.85) + rip * 0.25, win);
      c += vec3(1.0, 0.95, 0.8) * pow(max(dot(-V, uSun), 0.0), 40.0) * win * 1.5;
      c = mix(c, deepU, clamp(1.0 - exp(-dist * 0.035), 0.0, 1.0));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      return;
    }

    float shallow = 0.0, shore = 0.0;
    for (int i = 0; i < ${MAX_ISL}; i++) {
      if (i >= uIsl) break;
      float d = length(p - uIsland[i].xy) - uIsland[i].z;
      shallow = max(shallow, smoothstep(28.0, 0.0, d));
      shore += smoothstep(4.5, 0.0, abs(d)) * (0.5 + 0.5 * sin(d * 1.7 - t * 2.2));
    }

    float ndv = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    vec3 refl = skyCol(R);
    float crest = clamp(vH / (uAmpSum * max(uAmp, 0.01)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 deep = vec3(0.004, 0.035, 0.065), mid = vec3(0.01, 0.13, 0.17), shal = vec3(0.04, 0.33, 0.32);
    vec3 refr = mix(deep, mid, crest * 0.7);
    refr = mix(refr, shal, shallow * 0.75);
    float sss = pow(max(dot(V, -normalize(uSun + N * 0.6)), 0.0), 4.0) * smoothstep(0.4, 1.0, crest);
    refr += vec3(0.0, 0.32, 0.28) * sss * 0.9;
    vec3 col = mix(refr, refl, fres);
    float rs = max(dot(R, uSun), 0.0);
    col += vec3(1.0, 0.92, 0.78) * (pow(rs, 700.0) * 9.0 + pow(rs, 80.0) * 0.35);

    // foam: where waves fold over (low jacobian), around hulls, wakes and shores
    float fn = texture2D(uNorm, p / 6.0 + vec2(t * 0.03, 0.0)).z;
    float fn2 = texture2D(uNorm, p / 2.3 - vec2(0.0, t * 0.05)).x;
    float pattern = smoothstep(0.35, 0.95, fn * 0.6 + fn2 * 0.6);
    float foam = smoothstep(0.62, 0.15, vJ) * (0.6 + 0.4 * pattern);
    foam += clamp(wake, 0.0, 1.4) * pattern * 1.1;
    foam += shore * pattern;
    col = mix(col, vec3(0.9, 0.95, 0.97), clamp(foam, 0.0, 0.92));

    float fog = 1.0 - exp(-dist * uFogDen);
    col = mix(col, uFog, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const DETAIL = { low: 160, medium: 240, high: 320, ultra: 440 };
function oceanGeometry(N = 320) {
  // dense near the camera, coarse far away
  const R = 800, geo = new THREE.BufferGeometry();
  const pos = new Float32Array((N + 1) * (N + 1) * 3), idx = [];
  const map = u => R * u * (0.14 + 0.86 * u * u);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const o = (j * (N + 1) + i) * 3;
    pos[o] = map(i / N * 2 - 1); pos[o + 1] = 0; pos[o + 2] = map(j / N * 2 - 1);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
  return geo;
}

export function buildOcean(scene, islands) {
  uniforms = {
    uTime: { value: 0 }, uAmp: { value: 1 }, uAmpSum: { value: AMP_SUM }, uFogDen: { value: 0.0021 },
    uWave: { value: WAVES.map(w => new THREE.Vector4(w.dx, w.dz, w.a, w.k)) },
    uQ: { value: WAVES.map(w => w.q) },
    uNorm: { value: NORMAL_TEX },
    uZenith: { value: SKY.zenith }, uHorizon: { value: SKY.horizon }, uSun: { value: SKY.sunDir }, uFog: { value: SKY.horizon },
    uShips: { value: 0 }, uShipInv: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Matrix4()) },
    uShipDim: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector4()) },
    uShipShape: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector4(0.8, 0.55, 0.05, 0)) },
    uIsl: { value: Math.min(islands.length, MAX_ISL) },
    uIsland: { value: Array.from({ length: MAX_ISL }, (_, i) => islands[i] ? new THREE.Vector3(islands[i].x, islands[i].z, islands[i].r * 0.86) : new THREE.Vector3()) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide });
  ocean = new THREE.Mesh(oceanGeometry(DETAIL[G.oceanDetail] || 320), mat);
  ocean.frustumCulled = false;
  ocean.renderOrder = -1;
  scene.add(ocean);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uZenith: { value: SKY.zenith }, uHorizon: { value: SKY.horizon }, uSun: { value: SKY.sunDir }, uTime: { value: 0 }, uUnder: { value: 0 }, uUnderCol: { value: new THREE.Color(0.06, 0.29, 0.34) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 uZenith, uHorizon, uSun, uUnderCol; uniform float uTime, uUnder; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){ vec3 d = normalize(vDir); float y = max(d.y, 0.0);
        vec3 c = mix(uHorizon, uZenith, pow(y, 0.5));
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0,0.9,0.7) * (pow(s, 1200.0) * 8.0 + pow(s, 14.0) * 0.3);
        // soft clouds
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(uTime * 0.004, 0.0);
          float cl = n(uv) * 0.55 + n(uv * 2.3) * 0.3 + n(uv * 5.1) * 0.15;
          cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.0, 0.25, d.y);
          c = mix(c, vec3(1.0) * (0.92 + 0.08 * s), cl * 0.75);
        } else c = uHorizon;
        // under water there is no sky: deep water all around, lighter towards the surface, dark below
        if (uUnder > 0.0) {
          vec3 w = mix(uUnderCol * 0.18, uUnderCol * 1.25, smoothstep(-0.7, 0.75, d.y));
          w += uUnderCol * 0.6 * pow(max(dot(d, uSun), 0.0), 6.0) * smoothstep(0.0, 0.6, d.y);
          c = mix(c, w, uUnder);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
}

export function setOceanDetail(level) {
  G.oceanDetail = level;
  if (!ocean) return;
  ocean.geometry.dispose();
  ocean.geometry = oceanGeometry(DETAIL[level] || 320);
}
export function setFogDensity(d) { if (uniforms) uniforms.uFogDen.value = d; }
// under water the sky dome turns into deep water (k = 0 above the surface, 1 below)
export function setSkyUnderwater(k, color) {
  if (!sky) return;
  const u = sky.material.uniforms;
  u.uUnder.value = k;
  if (color) u.uUnderCol.value.copy(color);
}

export function updateOcean(camera) {
  if (!ocean) return;
  const step = 2.24;
  ocean.position.set(Math.round(camera.position.x / step) * step, 0, Math.round(camera.position.z / step) * step);
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = G.t;
  uniforms.uTime.value = G.t;
  uniforms.uAmp.value = G.seaAmp;
  let n = 0;
  for (const s of G.ships) {
    if (n >= MAX_SHIPS || s.gone) continue;
    uniforms.uShipInv.value[n].copy(s.inv);
    uniforms.uShipDim.value[n].set(s.hw, s.hl, s.deckTop, s.sunk ? 0 : s.speed);
    uniforms.uShipShape.value[n].set(s.shape.b, s.shape.bow, s.shape.st, 0);
    n++;
  }
  uniforms.uShips.value = n;
}
