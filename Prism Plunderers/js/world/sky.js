// Dusk over the ruins: the sky dome, fog, and the light (a low warm sun that casts shadows around the player,
// a cool fill from the sky). Shared by the scenes that show the outdoors.
import * as THREE from 'three';
import { S } from '../core/save.js';
import { SHADOW_SIZE } from '../core/engine.js';
import { rng } from '../core/util.js';

export const HORIZON = 0x6e4660;

export function addSky(scene, { fog = 0.0065, shadowSpan = 45, far = 240 } = {}) {
  scene.fog = new THREE.FogExp2(HORIZON, fog);
  scene.background = new THREE.Color(HORIZON);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0d0718) }, mid: { value: new THREE.Color(0x3a2350) }, bot: { value: new THREE.Color(HORIZON) }, sun: { value: new THREE.Color(0xffa070) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sun; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = mix(bot, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, top, smoothstep(0.15, 0.6, h));
        float s = pow(max(0.0, 1.0 - abs(h - 0.01) * 9.0), 3.0) * (1.0 - smoothstep(-1.0, 0.2, vP.z));
        c += sun * s * 0.55;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);
  // stars
  const R = rng(3000), N = 300, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = R() * Math.PI * 2, y = 0.25 + R() * 0.75, r = Math.sqrt(1 - y * y);
    p[i * 3] = Math.cos(a) * r * 650; p[i * 3 + 1] = y * 650; p[i * 3 + 2] = Math.sin(a) * r * 650;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xd8ccff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.6, fog: false }));
  scene.add(stars);

  const hemi = new THREE.HemisphereLight(0x9a8ad0, 0x3a2a22, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb48a, 2.4);
  const SUN = new THREE.Vector3(-55, 42, -70);              // low in the south-west, behind the drop pod
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x8f7dff, 0.45);
  fill.position.set(30, 25, 40);
  scene.add(fill);

  function shadows() {
    const size = SHADOW_SIZE[S.shadows] || 0;
    sun.castShadow = size > 0;
    if (!size) return;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(size, size); }
    const c = sun.shadow.camera;
    c.left = c.bottom = -shadowSpan; c.right = c.top = shadowSpan; c.near = 1; c.far = far;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  }
  shadows();
  return {
    sky, sun, stars, hemi, fill,
    shadows,
    // the sky and the shadowed area move with the player
    follow(x, z) {
      sky.position.set(x, 0, z); stars.position.set(x, 0, z);
      // snap to whole shadow texels, so the shadows do not shimmer while walking
      const step = (shadowSpan * 2) / Math.max(256, sun.shadow.mapSize.x || 2048);
      const sx = Math.round(x / step) * step, sz = Math.round(z / step) * step;
      sun.target.position.set(sx, 0, sz);
      sun.position.copy(sun.target.position).add(SUN);
    },
  };
}

// a soft round glow, made from numbers so it needs no canvas. gray = true also puts the falloff in the colour,
// so the texture works as an alphaMap (contact shadows).
export function glowTexture(size = 64, gray = false) {
  const d = new Uint8Array(size * size * 4), h = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h, a = Math.max(0, 1 - r), v = Math.round(255 * a * a * a);
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = gray ? v : 255; d[i + 3] = v;
  }
  const t = new THREE.DataTexture(d, size, size);
  t.needsUpdate = true;
  return t;
}
