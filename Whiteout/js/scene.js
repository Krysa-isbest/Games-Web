// The living background of the menu: a frozen island at night. Aurora over the sky, snow that drifts with the
// wind, the shack with a warm window and chimney smoke, the burning plane wreck, the radio tower blinking far
// away, snow-heavy pines, a frozen sea. Cinematic camera shots, wind gusts, bloom, grain and a vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, clamp, lerp, rand } from './state.js';

export const W = { gust: 0, wind: 4, t: 0, fps: 0 };        // read by the audio and the frost overlay
export const SCN = { paused: false };                         // the cutscene pauses the menu island
let renderer, scene, camera, composer, bloom, finalPass;
let sky, snow, moonLight, windowLight, fireLight, lanternLight, towerLamp, towerLight, smokeShack, smokeFire, fireSprites, drifts;
const sparkleU = { value: 0 };

// ---------- terrain ----------
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const SHACK = new THREE.Vector3(0, 0, 0), WRECK = new THREE.Vector3(34, 0, -26), TOWER = new THREE.Vector3(-92, 0, 64);
function rawHeight(x, z) {
  const r = Math.hypot(x, z), ang = Math.atan2(z, x);
  const coast = 150 * (0.78 + 0.4 * fbm(Math.cos(ang) * 1.6 + 3, Math.sin(ang) * 1.6 + 7, 4));
  const land = 1 - smooth(coast * 0.55, coast, r);
  const hills = fbm(x * 0.018 + 11, z * 0.018 - 4) * 20 + Math.pow(fbm(x * 0.006, z * 0.006), 2) * 26;
  return land * (2.5 + hills) - (1 - land) * 4 + (fbm(x * 0.15, z * 0.15, 2) - 0.5) * 0.6 * land;
}
const FLAT = [[SHACK, 9, 20], [WRECK, 6, 16], [TOWER, 5, 12]];
const flatH = FLAT.map(([p]) => rawHeight(p.x, p.z));
export function height(x, z) {
  let h = rawHeight(x, z);
  FLAT.forEach(([p, a, b], i) => { const k = smooth(a, b, Math.hypot(x - p.x, z - p.z)); h = lerp(flatH[i] + (i === 1 ? -0.4 : 0), h, k); });
  return h;
}

// ---------- textures ----------
export function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4;
  return t;
}
const woodTex = () => canvasTex(512, 512, (x, w, h) => {
  const rows = 16;
  for (let r = 0; r < rows; r++) {
    const y = r * h / rows, l = 28 + Math.random() * 18;
    x.fillStyle = `hsl(${24 + Math.random() * 8}, ${22 + Math.random() * 10}%, ${l}%)`; x.fillRect(0, y, w, h / rows);
    for (let g = 0; g < 18; g++) { x.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.1})`; x.beginPath(); const gy = y + Math.random() * h / rows; x.moveTo(0, gy); x.bezierCurveTo(w * 0.3, gy + rand(-3, 3), w * 0.6, gy + rand(-3, 3), w, gy + rand(-2, 2)); x.stroke(); }
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, y, w, 2);
    for (let k = 0; k < 2; k++) { const nx = Math.random() * w; x.fillStyle = 'rgba(20,12,6,0.6)'; x.beginPath(); x.arc(nx, y + h / rows / 2, 2 + Math.random() * 3, 0, 7); x.fill(); }
  }
});
export const iceTex = () => canvasTex(1024, 1024, (x, w, h) => {
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6f93a8'); g.addColorStop(1, '#7ea2b6'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(${Math.random() < 0.3 ? '20,40,60' : '220,235,245'},${Math.random() * 0.12})`; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 160, 20 + Math.random() * 90, Math.random() * 3, 0, 7); x.fill(); }
  x.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    let px = Math.random() * w, py = Math.random() * h, a = Math.random() * 6.28;
    x.strokeStyle = `rgba(235,248,255,${0.25 + Math.random() * 0.4})`; x.lineWidth = 0.6 + Math.random() * 1.6;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 14; s++) { a += rand(-0.6, 0.6); px += Math.cos(a) * rand(8, 30); py += Math.sin(a) * rand(8, 30); x.lineTo(px, py); }
    x.stroke();
  }
}, 30);
const plankRoofTex = () => canvasTex(256, 256, (x, w, h) => { for (let i = 0; i < 8; i++) { x.fillStyle = `hsl(25, 18%, ${18 + Math.random() * 10}%)`; x.fillRect(i * w / 8, 0, w / 8, h); x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(i * w / 8, 0, 2, h); } });
export const glowTex = (inner, outer) => canvasTex(128, 128, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, inner); g.addColorStop(0.35, outer); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); });
export const planeTex = () => canvasTex(512, 256, (x, w, h) => {
  x.fillStyle = '#d9dde2'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#1d3a5f'; x.fillRect(w * 0.18, 0, w * 0.035, h); x.fillRect(w * 0.82, 0, w * 0.035, h);
  x.fillStyle = '#9a2b22'; x.fillRect(w * 0.225, 0, w * 0.012, h); x.fillRect(w * 0.77, 0, w * 0.012, h);
  for (let i = 0; i < 18; i++) { x.fillStyle = Math.random() < 0.25 ? '#ffcf7a' : '#1a222c'; x.fillRect(w * 0.26, 12 + i * 13.5, w * 0.02, 7); x.fillRect(w * 0.72, 12 + i * 13.5, w * 0.02, 7); }
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(30,25,20,${Math.random() * 0.25})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 30, 0, 7); x.fill(); }
});

// ---------- sky ----------
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uMoon: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uMoon; varying vec3 vDir;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(vec3(0.07, 0.13, 0.19), vec3(0.008, 0.018, 0.045), pow(up, 0.55));
        col += vec3(0.05, 0.08, 0.1) * pow(1.0 - abs(d.y), 8.0);
        // stars
        vec2 su = vec2(atan(d.z, d.x) * 160.0, asin(clamp(d.y, -1.0, 1.0)) * 160.0);
        float s = h21(floor(su));
        float star = smoothstep(0.9955, 1.0, s) * smoothstep(0.02, 0.3, up) * (0.6 + 0.4 * sin(uTime * (2.0 + s * 9.0) + s * 60.0));
        col += vec3(0.85, 0.9, 1.0) * star * 1.4;
        // the aurora: curtains projected onto a high plane
        float aur = 0.0; vec3 acol = vec3(0.0);
        if (d.y > 0.02) {
          vec2 p = d.xz / (d.y + 0.12);
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float wave = sin(p.x * (0.35 + fi * 0.13) + uTime * (0.05 + fi * 0.02) + n2(p * 0.25 + uTime * 0.03) * 3.0) * 1.2;
            float band = exp(-pow((p.y + 1.2 + fi * 0.9 - wave) * 1.6, 2.0));
            float rays = 0.55 + 0.45 * sin(p.x * 22.0 + n2(vec2(p.x * 3.0, uTime * 0.4)) * 6.0);
            float a = band * rays * smoothstep(0.02, 0.25, d.y) * (0.6 - fi * 0.15);
            acol += mix(vec3(0.12, 1.0, 0.55), vec3(0.55, 0.3, 1.0), clamp(fi * 0.35 + (d.y - 0.2) * 1.6, 0.0, 1.0)) * a;
          }
        }
        col += acol * 0.55;
        // moon halo
        float m = max(dot(d, uMoon), 0.0);
        col += vec3(0.55, 0.65, 0.8) * (pow(m, 900.0) * 3.0 + pow(m, 40.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), mat);
  sky.frustumCulled = false; sky.renderOrder = -1;
  scene.add(sky);
}

// ---------- the island ----------
function makeTerrain() {
  const size = 520, seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const n = geo.attributes.normal, snowC = new THREE.Color('#eef4fa'), shadeC = new THREE.Color('#c7d6e6'), rockC = new THREE.Color('#4c5866'), iceC = new THREE.Color('#9db4c4'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), ny = n.getY(i), x = pos.getX(i), z = pos.getZ(i);
    c.copy(snowC).lerp(shadeC, clamp(fbm(x * 0.05, z * 0.05, 3) - 0.3, 0, 1));
    if (ny < 0.8) c.lerp(rockC, smooth(0.8, 0.6, ny));
    if (y < 0.6) c.lerp(iceC, smooth(0.6, -0.5, y));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  // glittering snow
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSpark = sparkleU;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uSpark; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 sc = floor(vWp.xz * 26.0);
      float sr = fract(sin(dot(sc, vec2(12.9898, 78.233))) * 43758.5453);
      float tw = fract(sr * 91.7 + dot(normalize(cameraPosition - vWp), vec3(3.1, 1.7, 5.3)) * 0.6);
      totalEmissiveRadiance += vec3(0.75, 0.85, 1.0) * step(0.985, sr) * pow(tw, 30.0) * 2.5 * uSpark * smoothstep(40.0, 6.0, length(cameraPosition - vWp));`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
  // the frozen sea
  const ice = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: iceTex(), color: '#c8dbe6', roughness: 0.32, metalness: 0.15 }));
  ice.position.y = 0.05; ice.receiveShadow = true;
  scene.add(ice);
}

function makeTrees() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6).translate(0, 0.8, 0);
  parts.push(paint(trunk, () => [0.24, 0.16, 0.1]));
  for (let i = 0; i < 4; i++) {
    const r = 1.5 - i * 0.32, hgt = 1.9 - i * 0.2, y = 1.0 + i * 1.05;
    const cone = new THREE.ConeGeometry(r, hgt, 9).translate(0, y + hgt / 2, 0);
    parts.push(paint(cone, (px, py, pz, nx, ny) => { const top = (py - y) / hgt; const snowy = ny > 0.25 && top < 0.55 && Math.sin(px * 13 + pz * 7) > -0.6; return snowy ? [0.88, 0.92, 0.97] : [0.07, 0.17, 0.13]; }));
  }
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const spots = [];
  for (let t = 0; t < 5000 && spots.length < 420; t++) {
    const x = rand(-170, 170), z = rand(-170, 170), h = height(x, z);
    if (h < 1.6 || h > 22) continue;
    if (Math.hypot(x - SHACK.x, z - SHACK.z) < 13 || Math.hypot(x - WRECK.x, z - WRECK.z) < 14 || Math.hypot(x - TOWER.x, z - TOWER.z) < 9) continue;
    if (fbm(x * 0.03 + 40, z * 0.03, 3) < 0.45) continue;            // forests in clumps
    spots.push([x, h, z]);
  }
  const inst = new THREE.InstancedMesh(geo, mat, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  spots.forEach(([x, h, z], i) => { const s = rand(0.7, 1.5); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6.28)); sc.set(s, s * rand(0.9, 1.25), s); m4.compose(new THREE.Vector3(x, h - 0.2, z), q, sc); inst.setMatrixAt(i, m4); });
  inst.castShadow = true; inst.receiveShadow = true;
  scene.add(inst);
  // rocks poking out of the snow
  const rgeo = paint(new THREE.DodecahedronGeometry(1, 0), (px, py, pz, nx, ny) => ny > 0.45 ? [0.86, 0.9, 0.95] : [0.3, 0.34, 0.4]);
  const rocks = new THREE.InstancedMesh(rgeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), 90);
  for (let i = 0; i < 90; i++) {
    let x, z, h; do { x = rand(-150, 150); z = rand(-150, 150); h = height(x, z); } while (h < 0.4 || Math.hypot(x, z) < 12);
    const s = rand(0.4, 2.2);
    m4.compose(new THREE.Vector3(x, h - s * 0.3, z), q.setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3))), sc.set(s, s * rand(0.5, 1), s));
    rocks.setMatrixAt(i, m4);
  }
  rocks.castShadow = true; rocks.receiveShadow = true;
  scene.add(rocks);
}
// colour a geometry per vertex: fn(x, y, z, nx, ny, nz) -> [r, g, b]
export function paint(geo, fn) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)), i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

// ---------- the shack ----------
const snowMat = new THREE.MeshStandardMaterial({ color: '#eef3f8', roughness: 0.9 });
function makeShack() {
  const g = new THREE.Group();
  const y0 = height(SHACK.x, SHACK.z);
  g.position.set(SHACK.x, y0, SHACK.z); g.rotation.y = 0.35;
  const add = (geo, mat, x, y, z, ry = 0, rz = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.85, color: '#b9a48e' });
  const darkWood = new THREE.MeshStandardMaterial({ color: '#3b2a1e', roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ map: plankRoofTex(), roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ color: '#5d6168', roughness: 0.95 });
  const W0 = 5.4, D0 = 4.2, H0 = 2.5;
  add(new THREE.BoxGeometry(W0, H0, D0), wood, 0, H0 / 2, 0);
  add(new THREE.BoxGeometry(W0 + 0.3, 0.3, D0 + 0.3), darkWood, 0, 0.12, 0);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.BoxGeometry(0.22, H0 + 0.1, 0.22), darkWood, x * W0 / 2, H0 / 2, z * D0 / 2);
  // gable roof with heavy snow on it
  const rl = Math.hypot(D0 / 2 + 0.5, 1.4);
  for (const s of [1, -1]) {
    const roof = add(new THREE.BoxGeometry(W0 + 0.9, 0.14, rl), roofMat, 0, H0 + 0.72, s * (D0 / 4 + 0.12)); roof.rotation.x = s * 0.62;
    const cap = add(new THREE.BoxGeometry(W0 + 1.0, 0.32, rl * 0.96), snowMat, 0, H0 + 0.92, s * (D0 / 4 + 0.05)); cap.rotation.x = s * 0.62;
  }
  const tri = new THREE.Shape(); tri.moveTo(-D0 / 2 - 0.05, 0); tri.lineTo(D0 / 2 + 0.05, 0); tri.lineTo(0, 1.45); tri.closePath();
  const gGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.14, bevelEnabled: false });
  for (const x of [W0 / 2, -W0 / 2]) add(gGeo, wood, x - 0.07, H0, 0, Math.PI / 2);
  // chimney
  add(new THREE.BoxGeometry(0.7, 2.2, 0.7), stone, -W0 / 2 + 0.9, H0 + 1.2, -0.6);
  add(new THREE.BoxGeometry(0.85, 0.2, 0.85), snowMat, -W0 / 2 + 0.9, H0 + 2.35, -0.6);
  smokeShack = new Smoke(new THREE.Vector3(-W0 / 2 + 0.9, H0 + 2.5, -0.6), g, 0.55, '#9aa6b4');
  // door, window glowing with firelight
  add(new THREE.BoxGeometry(1.0, 2.0, 0.08), darkWood, 1.3, 1.0, D0 / 2 + 0.04);
  add(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#c9a03c', metalness: 0.8, roughness: 0.3 }), 0.95, 1.0, D0 / 2 + 0.1);
  const glass = new THREE.MeshBasicMaterial({ color: '#ffb35c' });
  add(new THREE.PlaneGeometry(1.2, 0.9), glass, -1.1, 1.45, D0 / 2 + 0.01).castShadow = false;
  for (const [w, h, x, y] of [[1.36, 0.1, -1.1, 1.95], [1.36, 0.1, -1.1, 0.95], [0.1, 1.0, -1.74, 1.45], [0.1, 1.0, -0.46, 1.45], [1.2, 0.06, -1.1, 1.45], [0.06, 0.9, -1.1, 1.45]]) add(new THREE.BoxGeometry(w, h, 0.08), darkWood, x, y, D0 / 2 + 0.05);
  add(new THREE.BoxGeometry(1.5, 0.08, 0.3), snowMat, -1.1, 0.9, D0 / 2 + 0.18);
  const winGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,190,110,0.9)', 'rgba(255,140,60,0.25)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  winGlow.position.set(-1.1, 1.45, D0 / 2 + 0.4); winGlow.scale.set(3.5, 2.8, 1); g.add(winGlow);
  windowLight = new THREE.PointLight('#ff9a4a', 9, 18, 1.6); windowLight.position.set(-1.1, 1.5, D0 / 2 + 1.0); g.add(windowLight);
  // a lantern by the door
  add(new THREE.BoxGeometry(0.18, 0.26, 0.18), new THREE.MeshBasicMaterial({ color: '#ffd28a' }), 2.05, 2.05, D0 / 2 + 0.25);
  lanternLight = new THREE.PointLight('#ffc27a', 3, 9, 1.8); lanternLight.position.set(2.05, 2.0, D0 / 2 + 0.5); g.add(lanternLight);
  // firewood, a stump with an axe, snow drifts against the walls
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) add(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 8), darkWood, W0 / 2 + 0.5, 0.15 + r * 0.24, -1.4 + i * 0.27 + r * 0.13, 0, Math.PI / 2, 0).rotation.set(0, Math.PI / 2, Math.PI / 2);
  add(new THREE.BoxGeometry(0.5, 0.18, 1.8), snowMat, W0 / 2 + 0.5, 0.82, -0.75);
  add(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 10), darkWood, 3.6, 0.25, 2.4);
  const axe = add(new THREE.BoxGeometry(0.05, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: '#7a4a25' }), 3.6, 0.85, 2.4); axe.rotation.z = 0.5;
  add(new THREE.BoxGeometry(0.04, 0.18, 0.26), new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.8, roughness: 0.4 }), 3.42, 0.6, 2.4).rotation.z = 0.5;
  for (const [x, z, s] of [[-3, 1.8, 1.4], [2.9, -2.4, 1.6], [-2.6, -2.3, 1.2], [0.2, -2.6, 1.8]]) { const d = add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, x, -0.1, z); d.scale.set(s, 0.45 * s, s * 0.7); }
  scene.add(g);
}

// ---------- the crashed plane ----------
function makeWreck() {
  const g = new THREE.Group(), y0 = height(WRECK.x, WRECK.z);
  g.position.set(WRECK.x, y0, WRECK.z); g.rotation.y = -0.9;
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const hull = new THREE.MeshStandardMaterial({ map: planeTex(), roughness: 0.45, metalness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: '#b9c0c8', roughness: 0.4, metalness: 0.7 });
  const charred = new THREE.MeshStandardMaterial({ color: '#1c1a19', roughness: 1 });
  const fus = add(new THREE.CylinderGeometry(1.55, 1.55, 13, 24, 1, true), hull, 0, 1.0, 0, Math.PI / 2, 0, 0.12);
  fus.material.side = THREE.DoubleSide;
  add(new THREE.SphereGeometry(1.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull, 0, 1.0, 6.5, Math.PI / 2, 0, 0).scale.set(1, 1.8, 1);
  add(new THREE.CircleGeometry(1.5, 20), charred, 0, 1.0, -6.45, 0, Math.PI, 0);
  // broken wing stuck in the snow, the tail further away, an engine
  add(new THREE.BoxGeometry(9, 0.22, 2.4), metal, 5.5, 0.5, 0.8, 0.05, 0.3, -0.18);
  add(new THREE.CylinderGeometry(0.7, 0.6, 2.6, 16), metal, 4.2, 0.4, 1.9, Math.PI / 2, 0, 0.2);
  const tail = new THREE.Group(); tail.position.set(-5, 0, -13); tail.rotation.set(0.1, 0.9, 0.35); g.add(tail);
  const tc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 4.5, 18), hull); tc.rotation.x = Math.PI / 2; tc.position.y = 0.9; tc.castShadow = true; tail.add(tc);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 2.4), new THREE.MeshStandardMaterial({ color: '#9a2b22', roughness: 0.5, metalness: 0.4 })); fin.position.set(0, 2.6, -1.2); fin.rotation.x = -0.35; fin.castShadow = true; tail.add(fin);
  for (let i = 0; i < 16; i++) add(new THREE.BoxGeometry(rand(0.2, 0.9), rand(0.05, 0.3), rand(0.2, 1.2)), Math.random() < 0.5 ? metal : charred, rand(-7, 9), 0.1, rand(-16, 8), rand(0, 3), rand(0, 3), rand(0, 3));
  // snow piled on top
  add(new THREE.BoxGeometry(1.6, 0.35, 11), snowMat, 0, 2.55, 0.3, 0, 0, 0.12).scale.set(1, 1, 1);
  // fire at the torn-off end
  const fp = new THREE.Vector3(0.2, 0.6, -7.2);
  fireLight = new THREE.PointLight('#ff7a2a', 14, 26, 1.7); fireLight.position.copy(fp).add(new THREE.Vector3(0, 1.2, -0.5)); g.add(fireLight);
  fireSprites = [];
  const fmat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,160,1)', 'rgba(255,110,30,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(fmat.clone()); s.userData = { t: Math.random(), x: rand(-0.7, 0.7), z: rand(-0.6, 0.6) }; g.add(s); fireSprites.push(s); }
  fireSprites.base = fp;
  smokeFire = new Smoke(fp.clone().add(new THREE.Vector3(0, 1.4, 0)), g, 1.4, '#2a2624', 40);
  scene.add(g);
}

// ---------- the radio tower (the satellite phone is up there) ----------
function makeTower() {
  const g = new THREE.Group(), y0 = height(TOWER.x, TOWER.z);
  g.position.set(TOWER.x, y0, TOWER.z);
  const steel = new THREE.MeshStandardMaterial({ color: '#3b4048', roughness: 0.6, metalness: 0.6 });
  const H = 16;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, H, 0.2), steel); l.position.set(x * 1.7, H / 2, z * 1.7); l.rotation.set(-z * 0.06, 0, x * 0.06); l.castShadow = true; g.add(l); }
  for (let y = 2; y < H; y += 3.2) for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.4 - y * 0.05, 0.1, 0.1), steel); b.position.y = y; b.rotation.y = r; g.add(b); const b2 = b.clone(); b2.position.z = r ? 0 : 1.6 - y * 0.02; b2.position.x = r ? 1.6 - y * 0.02 : 0; g.add(b2); }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 3.6), new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 })); cab.position.y = H + 1.1; cab.castShadow = true; g.add(cab);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.2, 4), snowMat); roof.position.y = H + 2.8; roof.rotation.y = Math.PI / 4; g.add(roof);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 4.5, 6), steel); ant.position.y = H + 5.4; g.add(ant);
  towerLamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,80,60,1)', 'rgba(255,30,20,0.35)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  towerLamp.position.y = H + 7.7; towerLamp.scale.setScalar(3); g.add(towerLamp);
  towerLight = new THREE.PointLight('#ff3a2a', 0, 30, 2); towerLight.position.y = H + 7.5; g.add(towerLight);
  scene.add(g);
}

// ---------- smoke columns ----------
export class Smoke {
  constructor(at, parent, size, color, n = 22) {
    this.at = at; this.size = size; this.list = [];
    const mat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.18)'), color, transparent: true, depthWrite: false, opacity: 0.5 });
    for (let i = 0; i < n; i++) { const s = new THREE.Sprite(mat.clone()); s.userData.t = i / n; parent.add(s); this.list.push(s); }
  }
  update(dt) {
    for (const s of this.list) {
      const u = s.userData; u.t += dt * 0.12;
      if (u.t > 1) { u.t -= 1; u.ox = rand(-0.2, 0.2); }
      const t = u.t;
      s.position.set(this.at.x + (u.ox || 0) + t * t * W.wind * 2.2, this.at.y + t * 9, this.at.z + t * t * W.wind * 0.8);
      s.scale.setScalar(this.size * (0.6 + t * 5));
      s.material.opacity = Math.sin(t * Math.PI) * 0.42;
    }
  }
}

// ---------- falling snow (moved in the shader, wrapped around the camera) ----------
function makeSnow() {
  const n = { low: 1500, medium: 3200, high: 6000, ultra: 10000 }[S.snow] || 6000;
  if (snow) { scene.remove(snow); snow.geometry.dispose(); }
  const box = 70, pos = new Float32Array(n * 3), spd = new Float32Array(n), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([rand(-box / 2, box / 2), rand(-box / 2, box / 2), rand(-box / 2, box / 2)], i * 3); spd[i] = rand(0.6, 1.4); ph[i] = rand(0, 100); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uDrift: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uTime: { value: 0 }, uSize: { value: 70 * renderer.getPixelRatio() } },
    vertexShader: `uniform vec3 uDrift; uniform vec3 uCam; uniform float uBox; uniform float uTime; uniform float uSize;
      attribute float aSpeed; attribute float aPhase; varying float vA;
      void main(){
        vec3 p = position + uDrift * aSpeed;
        p.x += sin(uTime * 1.3 + aPhase) * 0.5; p.z += cos(uTime * 1.1 + aPhase * 1.7) * 0.5;
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min(uSize * (0.55 + aSpeed * 0.45) / -mv.z, uSize * 0.22);
        vA = smoothstep(uBox * 0.5, uBox * 0.25, length(p - uCam)) * smoothstep(1.2, 4.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA * 0.9; if (a < 0.01) discard; gl_FragColor = vec4(0.9, 0.95, 1.0, a); }`,
  });
  snow = new THREE.Points(geo, mat);
  snow.frustumCulled = false;
  scene.add(snow);
}
// big soft clouds of snow blowing across the ground
function makeDrifts() {
  drifts = [];
  const mat = new THREE.SpriteMaterial({ map: glowTex('rgba(230,240,255,0.5)', 'rgba(220,235,255,0.15)'), transparent: true, depthWrite: false, opacity: 0.18 });
  for (let i = 0; i < 40; i++) { const s = new THREE.Sprite(mat.clone()); s.userData = { x: rand(-120, 120), z: rand(-120, 120), o: rand(0.08, 0.22) }; s.scale.set(rand(14, 26), rand(3, 6), 1); scene.add(s); drifts.push(s); }
}

// ---------- camera shots ----------
const P = (x, y, z) => new THREE.Vector3(x, y, z);
const shackPt = (dx, dy, dz) => { const r = 0.35, c = Math.cos(r), s = Math.sin(r); return P(SHACK.x + c * dx + s * dz, height(SHACK.x, SHACK.z) + dy, SHACK.z - s * dx + c * dz); };
const SHOTS = [
  t => [shackPt(-9 + t * 0.35, 1.9, 15 - t * 0.45), shackPt(-1, 1.6, 0)],                                              // walking up to the shack
  t => { const a = 0.6 + t * 0.03, r = 46; return [P(Math.sin(a) * r, 22 + t * 0.2, Math.cos(a) * r), P(0, 10, 0)]; },  // high: the island under the aurora
  t => [P(WRECK.x - 9 + t * 0.25, height(WRECK.x, WRECK.z) + 2.4, WRECK.z - 14 + t * 0.15), P(WRECK.x * 0.4, 2, WRECK.z * 0.4)],   // past the burning wreck
  t => [P(140 - t * 0.6, 3.2, 95), P(-30, 14, 20)],                                                                       // out on the ice, looking back
  t => [shackPt(-1.6 + t * 0.05, 1.7, 5.6 - t * 0.12), shackPt(-1.1, 1.45, 2.1)],                                       // the warm window
  t => [P(TOWER.x + 18 - t * 0.3, height(TOWER.x + 18, TOWER.z - 10) + 3, TOWER.z - 12), P(TOWER.x, 18, TOWER.z)],        // the tower
];
let shot = 0, shotT = 0, mx = 0, my = 0;
const camTarget = new THREE.Vector3();
addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

export function initScene(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: S.aa, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#0d1a28', 0.008);
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
  scene.add(new THREE.HemisphereLight('#5a7aa0', '#1a2230', 0.75));
  scene.add(new THREE.AmbientLight('#2b3a55', 0.35));
  moonLight = new THREE.DirectionalLight('#b8cbe8', 1.5);
  moonLight.position.set(-60, 70, -100); moonLight.castShadow = true;
  Object.assign(moonLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
  moonLight.shadow.bias = -0.0004; moonLight.shadow.normalBias = 0.04;
  scene.add(moonLight, moonLight.target);
  makeSky(); makeTerrain(); makeTrees(); makeShack(); makeWreck(); makeTower(); makeDrifts();
  // post: bloom, then grain, vignette and a cold grade
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.6, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  finalPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 1 }, uFrost: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uFrost; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.0) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float ca = 0.0016 + uFrost * 0.002;
        vec3 c = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
        c = mix(c, c * vec3(0.92, 0.98, 1.08), 0.6);                       // a cold grade
        c *= 1.0 - smoothstep(0.35, 0.9, length(d * vec2(1.1, 1.0))) * 0.55;  // vignette
        c += (h(vUv * 800.0) - 0.5) * 0.045 * uGrain;
        c = mix(c, vec3(0.8, 0.88, 0.96), smoothstep(0.42, 0.75, length(d)) * uFrost * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(finalPass);
  applyGraphics();
  addEventListener('resize', resize);
  requestAnimationFrame(loop);
}
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}
export function applyGraphics() {
  const pr = Math.min(devicePixelRatio, 2) * S.scale;
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize();
  const sh = { low: 1024, high: 2048, ultra: 4096 }[S.shadows];
  renderer.shadowMap.enabled = !!sh; moonLight.castShadow = !!sh;
  if (sh && moonLight.shadow.mapSize.x !== sh) { moonLight.shadow.mapSize.set(sh, sh); moonLight.shadow.map?.dispose(); moonLight.shadow.map = null; }
  scene.fog.density = ({ low: 0.0045, medium: 0.008, high: 0.012 }[S.fog] || 0.008) + ({ near: 0.004, mid: 0.0015, far: 0 }[S.view] || 0);
  bloom.enabled = S.bloom;
  finalPass.uniforms.uGrain.value = S.grain ? 1 : 0;
  makeSnow();
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
}

// wind: a steady breeze with gusts every few seconds
let gustT = 6, gustA = 0, gustTarget = 0;
const drift = new THREE.Vector3();
let last = performance.now(), fpsN = 0, fpsT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (SCN.paused) { last = now; return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsN++; fpsT += dt; if (fpsT > 0.5) { W.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  W.t += dt;
  gustT -= dt;
  if (gustT <= 0) { gustT = rand(6, 14); gustTarget = rand(0.5, 1); setTimeout(() => { gustTarget = 0; }, rand(2500, 5000)); }
  gustA += (gustTarget - gustA) * Math.min(1, dt * (gustTarget > gustA ? 0.9 : 0.4));
  W.gust = gustA; W.wind = 3.5 + gustA * 13;
  drift.x += W.wind * dt; drift.z += W.wind * 0.35 * dt; drift.y -= (1.6 + gustA * 0.8) * dt;
  // camera
  shotT += dt;
  if (shotT > 13) { shotT = 0; shot = (shot + 1) % SHOTS.length; }
  const fade = document.getElementById('fade');
  if (fade) fade.style.opacity = shotT < 0.9 ? 1 - shotT / 0.9 : shotT > 12.1 ? (shotT - 12.1) / 0.9 : 0;
  const [p, look] = SHOTS[shot](shotT);
  camera.position.copy(p);
  camera.position.y = Math.max(camera.position.y, height(p.x, p.z) + 1.2);
  camera.position.x += Math.sin(W.t * 7.3) * 0.02 * gustA; camera.position.y += Math.sin(W.t * 9.1) * 0.02 * gustA;
  camTarget.copy(look).add(new THREE.Vector3(mx * 3, -my * 2, 0));
  camera.lookAt(camTarget);
  if (Math.abs(camera.fov - 55) > 0.1) { camera.fov = 55; camera.updateProjectionMatrix(); }
  moonLight.target.position.copy(camera.position); moonLight.position.copy(camera.position).add(new THREE.Vector3(-60, 70, -100));
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = W.t;
  sparkleU.value = 1;
  // snow + drifts
  const su = snow.material.uniforms;
  su.uDrift.value.copy(drift); su.uCam.value.copy(camera.position); su.uTime.value = W.t;
  for (const s of drifts) {
    const u = s.userData; u.x += W.wind * dt * 1.4; u.z += W.wind * 0.4 * dt;
    if (u.x > 140) { u.x = -140; u.z = rand(-130, 130); }
    s.position.set(u.x, height(u.x, u.z) + 1.4, u.z);
    s.material.opacity = u.o * (0.4 + gustA);
  }
  // fire, lights, smoke
  const flick = 0.75 + 0.25 * Math.sin(W.t * 11) * Math.sin(W.t * 7.3 + 1) + Math.random() * 0.12;
  windowLight.intensity = 8 * (0.85 + 0.15 * Math.sin(W.t * 5.1) * Math.sin(W.t * 2.3));
  fireLight.intensity = 16 * flick;
  lanternLight.intensity = 3 * (0.9 + Math.random() * 0.1);
  for (const s of fireSprites) {
    const u = s.userData; u.t += dt * 1.4; if (u.t > 1) { u.t -= 1; u.x = rand(-0.7, 0.7); u.z = rand(-0.6, 0.6); }
    const b = fireSprites.base;
    s.position.set(b.x + u.x * (1 - u.t) + u.t * W.wind * 0.1, b.y + u.t * 2.4, b.z + u.z * (1 - u.t));
    s.scale.setScalar(1.3 * (1 - u.t) + 0.2);
    s.material.opacity = (1 - u.t) * 0.9;
  }
  smokeShack.update(dt); smokeFire.update(dt);
  const blink = (W.t % 1.6) < 0.25;
  towerLamp.material.opacity = blink ? 1 : 0.08; towerLight.intensity = blink ? 6 : 0;
  finalPass.uniforms.uTime.value = W.t; finalPass.uniforms.uFrost.value = S.frost ? gustA : 0;
  composer.render();
}
