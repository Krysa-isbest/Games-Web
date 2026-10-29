// world.js — renderer, terrain, sky/day cycle, nature, breakable buildings, fields & crops
'use strict';

const W = {
  colliders: [], interact: [], roofs: [], buildings: [], holes: [],
  waterLevel: -10, // flood water (events raise it)
  windUniform: { value: 0.4 }, timeUniform: { value: 0 },
};

// wind sway patch for plant materials
function swayPatch(mat, amp) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = W.timeUniform; sh.uniforms.uWind = W.windUniform;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sw = sin(uTime * (1.6 + uWind) + ip.x * 0.35 + ip.z * 0.27) + 0.4 * sin(uTime * 3.1 + ip.x);
      transformed.x += sw * max(position.y, 0.0) * uWind * ${amp.toFixed(3)};
      transformed.z += cos(uTime * 1.3 + ip.z * 0.4) * max(position.y, 0.0) * uWind * ${(amp * 0.6).toFixed(3)};`);
  };
  return mat;
}

W.init = function () {
  const q = S.d.quality;
  const canvas = document.getElementById('game');
  const r = W.renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1) * S.d.renderScale);
  r.setSize(innerWidth, innerHeight);
  r.shadowMap.enabled = q !== 'low';
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  W.scene = new THREE.Scene();
  W.camera = new THREE.PerspectiveCamera(S.d.fov, innerWidth / innerHeight, 0.08, 2000);
  W.scene.add(W.camera);
  W.scene.fog = new THREE.Fog(0xbfd9ef, 60, S.d.viewDist);
  addEventListener('resize', W.resize);

  W.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 0.75); W.scene.add(W.hemi);
  W.sun = new THREE.DirectionalLight(0xfff2d6, 0.9);
  W.sun.castShadow = q !== 'low';
  const sm = q === 'high' ? 2048 : 1024;
  W.sun.shadow.mapSize.set(sm, sm);
  const sc = W.sun.shadow.camera; sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 1; sc.far = 300;
  W.sun.shadow.bias = -0.0006; W.sun.shadow.normalBias = 0.03;
  W.scene.add(W.sun, W.sun.target);

  M.cropMat = swayPatch(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.06);
  M.natureMat = swayPatch(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.012);

  W.buildSky();
  W.buildTerrain();
  W.buildNature();
  W.buildFarm();
  W.buildFields();
  W.buildUpgradeProps();
};

W.resize = function () {
  W.camera.aspect = innerWidth / innerHeight; W.camera.updateProjectionMatrix();
  W.renderer.setSize(innerWidth, innerHeight);
};
W.applyGraphics = function () {
  const q = S.d.quality;
  W.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1) * S.d.renderScale);
  W.renderer.setSize(innerWidth, innerHeight);
  W.camera.fov = S.d.fov; W.camera.updateProjectionMatrix();
  const sh = q !== 'low';
  if (W.renderer.shadowMap.enabled !== sh) {
    W.renderer.shadowMap.enabled = sh; W.sun.castShadow = sh;
    W.scene.traverse(o => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); } });
  }
  if (W.grassMesh) W.grassMesh.visible = q !== 'low';
};

// ---------------- terrain ----------------
const FARM_CX = 0, FARM_CZ = -5;
W.height = function (x, z) {
  const dx = x - FARM_CX, dz = z - FARM_CZ, d = Math.sqrt(dx * dx + dz * dz);
  let h = 0;
  if (d > 62) {
    const t = U.clamp((d - 62) / 60, 0, 1);
    h += U.smooth(t) * (U.fbm(x * 0.02, z * 0.02) * 16 + 2);
  }
  if (d > 200) h += Math.pow((d - 200) / 90, 1.5) * (18 + U.fbm(x * 0.012 + 7, z * 0.012) * 30);
  // pond
  const pd = Math.hypot(x - 44, z - 32);
  if (pd < 11) h -= (1 - U.smooth(pd / 11)) * 1.8;
  return h;
};
W.groundAt = function (x, z) {
  for (const hl of W.holes) if ((x - hl.x) ** 2 + (z - hl.z) ** 2 < hl.r * hl.r) return -80;
  return W.height(x, z);
};

W.buildTerrain = function () {
  const size = 700, seg = 140;
  let g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, W.height(pos.getX(i), pos.getZ(i)));
  g = g.toNonIndexed(); g.computeVertexNormals();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let t = 0; t < n / 3; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += p.getX(t * 3 + k); y += p.getY(t * 3 + k); z += p.getZ(t * 3 + k); }
    x /= 3; y /= 3; z /= 3;
    const v = U.noise2(x * 0.08, z * 0.08);
    c.setHex(0x6aa83a).lerp(new THREE.Color(0x8cbf4a), v * 0.7);
    if (y > 22) c.lerp(new THREE.Color(0x7d7f72), U.clamp((y - 22) / 20, 0, 1));
    if (y > 55) c.lerp(new THREE.Color(0xf4f6f8), U.clamp((y - 55) / 10, 0, 1));
    if (y < -0.4) c.setHex(0x8a7a52);
    // dirt road from the west edge to the shop & house
    const road = Math.abs(x + 47 + Math.sin(z * 0.05) * 2) < 2.4 || (Math.abs(z + 12 - Math.sin(x * 0.1)) < 1.6 && x > -47 && x < -16);
    if (road) c.setHex(0xa2865a).lerp(new THREE.Color(0x8f7650), v);
    // worn ground around buildings
    if (Math.hypot(x - 16, z + 26) < 13 || Math.hypot(x + 20, z + 24) < 9) c.lerp(new THREE.Color(0x9a8a5a), 0.35);
    c.multiplyScalar(0.96 + U.hash2(t, 7) * 0.08);
    for (let k = 0; k < 3; k++) { col[(t * 3 + k) * 3] = c.r; col[(t * 3 + k) * 3 + 1] = c.g; col[(t * 3 + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  W.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  W.ground = new THREE.Mesh(g, W.groundMat);
  W.ground.receiveShadow = true;
  W.scene.add(W.ground);
  // pond water
  const wg = new THREE.CircleGeometry(11.5, 20); wg.rotateX(-Math.PI / 2);
  W.pond = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x3f8fc0, transparent: true, opacity: 0.8 }));
  W.pond.position.set(44, -0.35, 32); W.scene.add(W.pond);
  // flood water plane (hidden until an event raises it)
  const fg = new THREE.PlaneGeometry(400, 400, 40, 40); fg.rotateX(-Math.PI / 2);
  W.floodMat = new THREE.MeshLambertMaterial({ color: 0x4f8fb0, transparent: true, opacity: 0.72 });
  W.flood = new THREE.Mesh(fg, W.floodMat); W.flood.visible = false; W.scene.add(W.flood);
};

// ---------------- sky ----------------
W.buildSky = function () {
  W.skyU = {
    top: { value: new THREE.Color(0x4a8fd8) }, horizon: { value: new THREE.Color(0xbfdcf2) }, bottom: { value: new THREE.Color(0x8aa0b0) },
    sunDir: { value: new V3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2c0) }, sunSize: { value: 0.045 }, sunGlow: { value: 1 },
    moonDir: { value: new V3(0, -1, 0) }, stars: { value: 0 }, eclipse: { value: 0 }, time: W.timeUniform,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: W.skyU, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 top, horizon, bottom, sunDir, sunCol, moonDir; uniform float sunSize, sunGlow, stars, eclipse, time;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y,0.0,1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-y,0.0,1.0), 0.35));
        if (stars > 0.0) { float h = hash(floor(d * 260.0)); c += vec3(step(0.9972, h)) * stars * smoothstep(0.0, 0.25, y) * (0.6 + 0.4 * sin(time * 3.0 + h * 50.0)); }
        float sd = dot(d, sunDir); float a = acos(clamp(sd, -1.0, 1.0));
        c += sunCol * (pow(max(sd, 0.0), 48.0) * 0.6 + pow(max(sd, 0.0), 6.0) * 0.12) * sunGlow * (1.0 - eclipse * 0.8);
        float disc = smoothstep(sunSize, sunSize * 0.86, a);
        c += vec3(1.0, 0.9, 0.75) * eclipse * smoothstep(sunSize * 2.4, sunSize, a) * 0.9 * (1.0 - disc);
        c = mix(c, mix(sunCol * 1.5, vec3(0.01), eclipse), disc);
        float md = dot(d, moonDir); c = mix(c, vec3(0.92, 0.93, 1.0), smoothstep(0.99935, 0.9996, md) * clamp(stars * 1.5, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  W.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  W.sky.frustumCulled = false; W.sky.renderOrder = -10;
  W.scene.add(W.sky);
  // clouds
  const cb = new MB();
  cb.ico(4, 0, 0xffffff, 0, 0, 0, 1.6, 0.6, 1, 1); cb.ico(3, 0, 0xf4f7fa, 4, -0.5, 1, 1.4, 0.6, 1, 0.8); cb.ico(3.2, 0, 0xf8fafc, -4, -0.3, -0.5, 1.4, 0.6, 1, 0.8);
  W.cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false });
  W.clouds = new THREE.InstancedMesh(cb.geo(), W.cloudMat, 26);
  W.cloudData = [];
  for (let i = 0; i < 26; i++) W.cloudData.push({ x: U.rand(-400, 400), z: U.rand(-400, 400), y: U.rand(80, 120), s: U.rand(1, 2.6), r: U.rand(0, 6) });
  W.scene.add(W.clouds);
};

// day-cycle keyframes: hour -> [top, horizon, bottom, sun, hemi, stars]
const SKY_KEYS = [
  [0, 0x050a1c, 0x101a33, 0x060a14, 0.0, 0.18, 1],
  [4.8, 0x070d22, 0x1a2140, 0x070a12, 0.0, 0.2, 1],
  [6.0, 0x3a5a9a, 0xf2a46a, 0x4a4a5a, 0.35, 0.45, 0.2],
  [7.5, 0x4a8ad8, 0xcfe0f0, 0x8a9aa8, 0.85, 0.7, 0],
  [16.5, 0x4a8fd8, 0xc4dcf2, 0x8aa0b0, 0.95, 0.75, 0],
  [18.6, 0x3d5fa8, 0xf59a5a, 0x5a4a50, 0.5, 0.5, 0],
  [20.0, 0x1a2550, 0x5a3a5a, 0x15121c, 0.05, 0.28, 0.6],
  [21.5, 0x060b1e, 0x121b36, 0x060a14, 0.0, 0.18, 1],
  [24, 0x050a1c, 0x101a33, 0x060a14, 0.0, 0.18, 1],
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
W.env = { top: new THREE.Color(), horizon: new THREE.Color(), bottom: new THREE.Color(), sun: 1, hemi: 1, stars: 0, fogNear: 60, fogFar: 260, sunSize: 0.045, eclipse: 0, sunCol: new THREE.Color(0xfff2c0), shake: 0 };
W.computeEnv = function () {
  const h = G.hour(), e = W.env;
  let i = 0; while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1][0] <= h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1], t = U.smooth(U.clamp((h - a[0]) / (b[0] - a[0]), 0, 1));
  e.top.setHex(a[1]).lerp(_cb.setHex(b[1]), t);
  e.horizon.setHex(a[2]).lerp(_cb.setHex(b[2]), t);
  e.bottom.setHex(a[3]).lerp(_cb.setHex(b[3]), t);
  e.sun = U.lerp(a[4], b[4], t); e.hemi = U.lerp(a[5], b[5], t); e.stars = U.lerp(a[6], b[6], t);
  e.fogNear = Math.min(60, S.d.viewDist * 0.3); e.fogFar = S.d.viewDist;
  e.sunSize = 0.045; e.eclipse = 0; e.sunCol.setHex(0xfff2c0); e.sunGlow = 1;
  e.gravity = 1; e.speed = 1; e.dark = 0; e.roll = 0; e.bouncy = false;
};
// events call these every frame to bend the environment
W.tint = function (hex, amt, alsoTop = true) {
  _ca.setHex(hex);
  if (alsoTop) W.env.top.lerp(_ca, amt);
  W.env.horizon.lerp(_ca, amt); W.env.bottom.lerp(_ca, amt * 0.8);
};
W.fog = function (near, far, amt) {
  W.env.fogNear = U.lerp(W.env.fogNear, near, amt); W.env.fogFar = U.lerp(W.env.fogFar, far, amt);
};
W.darken = function (amt) { W.env.sun *= 1 - amt; W.env.hemi *= 1 - amt * 0.6; W.env.top.multiplyScalar(1 - amt * 0.7); W.env.horizon.multiplyScalar(1 - amt * 0.6); };

W.applyEnv = function (camPos) {
  const e = W.env, h = G.hour();
  const st = (h - 6) / 14 * Math.PI;
  const sd = W.skyU.sunDir.value.set(Math.cos(st), Math.max(Math.sin(st), -0.6), 0.35).normalize();
  W.skyU.moonDir.value.set(-sd.x, -sd.y + 0.2, -0.3).normalize();
  W.skyU.top.value.copy(e.top); W.skyU.horizon.value.copy(e.horizon); W.skyU.bottom.value.copy(e.bottom);
  W.skyU.stars.value = e.stars; W.skyU.sunSize.value = e.sunSize; W.skyU.eclipse.value = e.eclipse; W.skyU.sunCol.value.copy(e.sunCol); W.skyU.sunGlow.value = e.sunGlow;
  W.sky.position.copy(camPos);
  W.scene.fog.color.copy(e.horizon);
  W.scene.fog.near = e.fogNear; W.scene.fog.far = e.fogFar;
  const day = sd.y > 0;
  W.sun.intensity = e.sun * 0.85 * (1 - e.eclipse * 0.85) + (day ? 0 : 0.12 * e.stars);
  W.sun.color.copy(day ? e.sunCol : _ca.setHex(0x8aa0d8));
  const ld = day ? sd : W.skyU.moonDir.value;
  W.sun.position.set(camPos.x + ld.x * 120, camPos.y + Math.max(ld.y, 0.25) * 120, camPos.z + ld.z * 120);
  W.sun.target.position.set(camPos.x, 0, camPos.z);
  W.hemi.intensity = e.hemi * 0.72; W.hemi.color.copy(e.top).lerp(_ca.setHex(0xffffff), 0.5);
  W.cloudMat.color.copy(e.horizon).lerp(_ca.setHex(0xffffff), 0.55);
};

W.updateClouds = function (dt) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), p = new V3();
  const sp = 2 + W.windUniform.value * 10;
  W.cloudData.forEach((c, i) => {
    c.x += sp * dt; if (c.x > 450) c.x = -450;
    m.compose(p.set(c.x, c.y, c.z), q.setFromAxisAngle(new V3(0, 1, 0), c.r), s.set(c.s, c.s, c.s));
    W.clouds.setMatrixAt(i, m);
  });
  W.clouds.instanceMatrix.needsUpdate = true;
};

// ---------------- nature ----------------
W.buildNature = function () {
  const q = S.d.quality, dens = q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1;
  const r = U.rng(1234);
  const place = (n, minD, maxD, avoid) => {
    const out = [];
    for (let k = 0; k < n * 4 && out.length < n; k++) {
      const a = r() * Math.PI * 2, d = minD + r() * (maxD - minD);
      const x = FARM_CX + Math.cos(a) * d, z = FARM_CZ + Math.sin(a) * d;
      if (avoid && avoid(x, z)) continue;
      if (Math.hypot(x - 44, z - 32) < 13) continue;
      if (Math.abs(x + 47 + Math.sin(z * 0.05) * 2) < 4) continue;
      out.push([x, W.height(x, z), z, r() * 6.28, 0.8 + r() * 0.5]);
    }
    return out;
  };
  const inst = (geo, list, mat = M.natureMat, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion();
    list.forEach((p, i) => { m.compose(new V3(p[0], p[1] - 0.1, p[2]), qq.setFromAxisAngle(new V3(0, 1, 0), p[3]), new V3(p[4], p[4], p[4])); im.setMatrixAt(i, m); });
    im.count = list.length; im.castShadow = shadow; im.receiveShadow = true;
    W.scene.add(im); return im;
  };
  // tree belt around the farm (dense) + scattered on the hills
  const types = [[0, 3], [1, 3], [0, 9], [1, 11]];
  const trees = place(Math.round(420 * dens), 66, 230);
  types.forEach(([t, seed], k) => {
    const list = trees.filter((_, i) => i % 4 === k);
    inst(M.treeGeo(t, seed), list);
    // trunks block the player
    list.forEach(p => { if (Math.hypot(p[0], p[2] + 5) < 120) W.colliders.push({ min: { x: p[0] - 0.35, y: -5, z: p[2] - 0.35 }, max: { x: p[0] + 0.35, y: 8, z: p[2] + 0.35 } }); });
  });
  // a few apple trees near the house
  inst(M.treeGeo(2, 5), [[-34, 0, -30, 0.3, 1], [-8, 0, -46, 2, 1.1], [-36, 0, -40, 1, 0.9], [36, 0, -42, 4, 1]]);
  [[-34, -30], [-8, -46], [-36, -40], [36, -42]].forEach(([x, z]) => W.colliders.push({ min: { x: x - 0.3, y: -1, z: z - 0.3 }, max: { x: x + 0.3, y: 5, z: z + 0.3 } }));
  inst(M.rockGeo(4), place(Math.round(120 * dens), 50, 240));
  inst(M.rockGeo(9), place(Math.round(60 * dens), 58, 200));
  inst(M.bushGeo(), place(Math.round(200 * dens), 55, 200));
  const flat = (x, z) => (x > -33 && x < 30 && z > 0 && z < 35) || Math.hypot(x - 16, z + 26) < 13 || Math.hypot(x + 20, z + 24) < 9;
  W.grassMesh = inst(M.grassGeo(), place(Math.round(1400 * dens), 4, 75, flat), M.natureMat, false);
  W.grassMesh.visible = q !== 'low';
  [0xff6b8a, 0xffe14a, 0xb88aff, 0xffffff].forEach(c => inst(M.flowerGeo(c), place(Math.round(80 * dens), 8, 70, flat), M.natureMat, false));
};

// ---------------- breakable buildings ----------------
class Building {
  constructor(id, name, x, z) {
    this.id = id; this.name = name; this.pieces = [];
    this.group = new THREE.Group(); this.group.position.set(x, 0, z);
    W.scene.add(this.group); W.buildings.push(this);
  }
  // b: MB, opts: {solid, roof, sup:[indices], color, chunks}
  piece(b, o = {}) {
    const mesh = b.mesh();
    this.group.add(mesh);
    const p = { mesh, broken: false, solid: !!o.solid, roof: !!o.roof, sup: o.sup || [], color: o.color || 0x8a5a33, idx: this.pieces.length, deps: [] };
    this.pieces.push(p);
    return p.idx;
  }
  finish() {
    this.group.updateMatrixWorld(true);
    for (const p of this.pieces) {
      p.box = new THREE.Box3().setFromObject(p.mesh);
      p.center = p.box.getCenter(new V3());
      p.home = p.mesh.matrix.clone();
      if (p.solid) { p.col = { min: p.box.min, max: p.box.max, piece: p }; W.colliders.push(p.col); }
      if (p.roof) W.roofs.push(p.mesh);
      for (const s of p.sup) this.pieces[s].deps.push(p.idx);
    }
  }
}
W.Building = Building;

// break a piece: identical on every client (host decides which pieces break and broadcasts)
W.breakPiece = function (bi, pi, ox, oy, oz, force = 8) {
  const b = W.buildings[bi]; if (!b) return;
  const p = b.pieces[pi]; if (!p || p.broken) return;
  p.broken = true; p.mesh.visible = false;
  if (p.col) p.col.dead = true;
  const ri = W.roofs.indexOf(p.mesh); if (ri >= 0) W.roofs.splice(ri, 1);
  G.stats.pieces++;
  if (window.FX) FX.gibPiece(p, ox, oy, oz, force);
  if (window.AU) AU.play('break', p.center, 0.8);
  // anything resting on this piece collapses when most of its supports are gone
  for (const di of p.deps) {
    const d = b.pieces[di]; if (d.broken) continue;
    const gone = d.sup.filter(s => b.pieces[s].broken).length;
    if (gone / d.sup.length >= 0.5) setTimeout(() => W.breakPiece(bi, di, d.center.x, d.center.y + 2, d.center.z, 2), 120 + Math.random() * 250);
  }
};
W.repairAll = function () {
  let n = 0;
  for (const b of W.buildings) for (const p of b.pieces) {
    if (!p.broken) continue;
    p.broken = false; p.mesh.visible = true; if (p.col) p.col.dead = false;
    if (p.roof && !W.roofs.includes(p.mesh)) W.roofs.push(p.mesh);
    n++;
  }
  return n;
};
W.brokenCount = () => W.buildings.reduce((s, b) => s + b.pieces.filter(p => p.broken).length, 0);
W.brokenList = () => { const l = []; W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => { if (p.broken) l.push([bi, pi]); })); return l; };
// host helper: list pieces near a point
W.piecesNear = function (x, y, z, r) {
  const out = [];
  W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => {
    if (p.broken) return;
    const dx = Math.max(p.box.min.x - x, 0, x - p.box.max.x), dy = Math.max(p.box.min.y - y, 0, y - p.box.max.y), dz = Math.max(p.box.min.z - z, 0, z - p.box.max.z);
    if (dx * dx + dy * dy + dz * dz < r * r) out.push([bi, pi, p]);
  }));
  return out;
};

// the big red barn — gambrel roof, everything breakable
function buildBarn() {
  const B = new Building(W.buildings.length, 'Barn', 16, -26);
  const R = COL.barnRed, T = COL.trim, w = 12, d = 16, h = 5, th = 0.3;
  const wall = (pw, ph, x, y, z, rotY, deco) => {
    const b = new MB();
    b.add(new THREE.BoxGeometry(pw, ph, th), R, x, y, z, 0, rotY, 0);
    // vertical plank grooves
    const n = Math.floor(pw / 0.6);
    for (let i = 1; i < n; i++) { const o = -pw / 2 + i * pw / n; b.add(new THREE.BoxGeometry(0.04, ph, th + 0.02), COL.barnRedDark, x + Math.cos(rotY) * o, y, z - Math.sin(rotY) * o, 0, rotY, 0); }
    if (deco) deco(b);
    return B.piece(b, { solid: true, color: R });
  };
  const sides = [];
  // side walls (x = ±6), 4 panels each
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z = -d / 2 + 2 + i * 4;
    sides.push(wall(4, h, sx * w / 2, h / 2, z, Math.PI / 2, i === 1 || i === 2 ? b => {
      b.box(th + 0.06, 1.2, 1.4, T, sx * w / 2, 3.2, z); b.box(th + 0.08, 1.0, 1.2, 0x2a2420, sx * w / 2, 3.2, z);
      b.box(th + 0.1, 0.08, 1.4, T, sx * w / 2, 3.2, z); b.box(th + 0.1, 1.2, 0.08, T, sx * w / 2, 3.2, z);
    } : null));
  }
  // back wall
  const back = [0, 1, 2].map(i => wall(4, h, -4 + i * 4, h / 2, -d / 2, 0));
  // front wall with big door opening (5 wide, 3.6 tall)
  const fl = wall(3.5, h, -4.25, h / 2, d / 2, 0), fr = wall(3.5, h, 4.25, h / 2, d / 2, 0);
  const fo = wall(5, 1.4, 0, 4.3, d / 2, 0, b => b.box(5.1, 0.12, 0.4, T, 0, 3.6, d / 2));
  // open sliding doors with white X trim
  const door = x => {
    const b = new MB();
    b.box(2.6, 3.6, 0.15, R, x, 1.8, d / 2 + 0.25);
    b.box(2.6, 0.15, 0.2, T, x, 3.55, d / 2 + 0.25); b.box(2.6, 0.15, 0.2, T, x, 0.08, d / 2 + 0.25);
    b.box(0.15, 3.6, 0.2, T, x - 1.25, 1.8, d / 2 + 0.25); b.box(0.15, 3.6, 0.2, T, x + 1.25, 1.8, d / 2 + 0.25);
    b.box(0.14, 4.3, 0.2, T, x, 1.8, d / 2 + 0.25, 0, 0, 0.62); b.box(0.14, 4.3, 0.2, T, x, 1.8, d / 2 + 0.25, 0, 0, -0.62);
    return B.piece(b, { solid: true, color: R, sup: [] });
  };
  door(-4.4); door(4.4);
  // corner posts
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) { const b = new MB(); b.box(0.42, h, 0.42, T, x, h / 2, z); B.piece(b, { solid: true, color: T }); }
  // gambrel gable ends (front & back)
  const gable = (z, front) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(4, 3); s.lineTo(0, 4.5); s.lineTo(-4, 3); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: false }); g.translate(0, h, -th / 2);
    const b = new MB(); b.add(g, R, 0, 0, z);
    if (front) {
      b.box(2.2, 1.9, 0.1, 0x2a2420, 0, h + 1.6, z + 0.2); b.box(2.4, 0.12, 0.14, T, 0, h + 2.6, z + 0.2); b.box(2.4, 0.12, 0.14, T, 0, h + 0.65, z + 0.2);
      b.box(0.12, 2.0, 0.14, T, -1.15, h + 1.6, z + 0.2); b.box(0.12, 2.0, 0.14, T, 1.15, h + 1.6, z + 0.2);
      b.box(0.1, 2.6, 0.14, T, 0, h + 1.6, z + 0.22, 0, 0, 0.83); b.box(0.1, 2.6, 0.14, T, 0, h + 1.6, z + 0.22, 0, 0, -0.83);
      b.box(0.15, 0.15, 1.6, COL.woodDark, 0, h + 3.4, z + 0.7);
    }
    return B.piece(b, { color: R, sup: front ? [fl, fr, fo] : back });
  };
  const gf = gable(d / 2, true), gb = gable(-d / 2, false);
  // roof: 4 slopes x 4 segments along z
  const lowA = Math.atan2(3, 2), upA = Math.atan2(1.5, 4);
  const lowL = Math.hypot(2, 3), upL = Math.hypot(4, 1.5);
  const roofSeg = [];
  for (let i = 0; i < 4; i++) {
    const z = -d / 2 + 2 + i * 4, len = 4.02 + (i === 0 || i === 3 ? 0.35 : 0), zz = z + (i === 0 ? -0.17 : i === 3 ? 0.17 : 0);
    for (const sx of [-1, 1]) {
      const sideIdx = sides[(sx < 0 ? 0 : 4) + i];
      const b1 = new MB();
      b1.box(lowL + 0.3, 0.22, len, COL.roof, sx * 5, h + 1.5, zz, 0, 0, -sx * lowA);
      b1.box(0.2, 0.26, len, T, sx * (w / 2 + 0.12), h - 0.05, zz);
      const lo = B.piece(b1, { roof: true, color: COL.roof, sup: [sideIdx] });
      const b2 = new MB();
      b2.box(upL + 0.15, 0.22, len, COL.roofDark, sx * 2, h + 3.75, zz, 0, 0, -sx * upA);
      if (sx > 0) b2.box(0.3, 0.3, len, T, 0, h + 4.55, zz);
      roofSeg.push({ lo, up: B.piece(b2, { roof: true, color: COL.roofDark, sup: [lo] }) });
    }
  }
  // the upper roof also leans on the other side
  for (let i = 0; i < 4; i++) { const L = roofSeg[i * 2], Rr = roofSeg[i * 2 + 1]; B.pieces[L.up].sup.push(Rr.lo); B.pieces[Rr.up].sup.push(L.lo); }
  // weathervane
  { const b = new MB(); b.box(0.06, 1.4, 0.06, 0x333333, 0, h + 5.2, 0); b.box(0.9, 0.3, 0.04, 0x333333, 0.1, h + 5.7, 0); b.cone(0.12, 0.3, 4, 0x333333, 0.6, h + 5.7, 0, 0, 0, -Math.PI / 2); B.piece(b, { color: 0x333333, sup: [roofSeg[3].up, roofSeg[5].up] }); }
  // hay bales inside
  for (let i = 0; i < 7; i++) {
    const b = new MB(); const x = -4 + (i % 3) * 1.4, z = -5 + Math.floor(i / 3) * 1.1, y = 0.4 + (i === 6 ? 0.8 : 0);
    b.box(1.3, 0.8, 1.0, COL.hay, x, y, z); b.box(1.32, 0.06, 1.02, 0xc9a640, x, y + 0.2, z); b.box(1.32, 0.06, 1.02, 0xc9a640, x, y - 0.2, z);
    B.piece(b, { solid: true, color: COL.hay });
  }
  B.finish();
  return B;
}

function buildHouse() {
  const B = new Building(W.buildings.length, 'Farmhouse', -20, -24);
  const C = COL.houseWall, w = 10, d = 8, h = 3.3, th = 0.25;
  const panel = (pw, ph, x, y, z, rotY, win) => {
    const b = new MB();
    b.add(new THREE.BoxGeometry(pw, ph, th), C, x, y, z, 0, rotY, 0);
    b.add(new THREE.BoxGeometry(pw + 0.02, 0.3, th + 0.04), 0xd9c9a3, x, 0.15, z, 0, rotY, 0);
    if (win) {
      const ox = Math.cos(rotY), oz = -Math.sin(rotY), nx = Math.sin(rotY), nz = Math.cos(rotY);
      for (const o of win) {
        const cx = x + ox * o, cz = z + oz * o;
        b.add(new THREE.BoxGeometry(1.1, 1.1, th + 0.05), COL.glass, cx, 1.8, cz, 0, rotY, 0);
        b.add(new THREE.BoxGeometry(1.3, 0.12, th + 0.12), 0xffffff, cx, 2.38, cz, 0, rotY, 0);
        b.add(new THREE.BoxGeometry(1.3, 0.12, th + 0.12), 0xffffff, cx, 1.22, cz, 0, rotY, 0);
        b.add(new THREE.BoxGeometry(0.08, 1.1, th + 0.1), 0xffffff, cx, 1.8, cz, 0, rotY, 0);
        b.add(new THREE.BoxGeometry(0.3, 1.25, 0.06), COL.houseBlue, cx - ox * 0.75 + nx * 0.16, 1.8, cz - oz * 0.75 + nz * 0.16, 0, rotY, 0);
        b.add(new THREE.BoxGeometry(0.3, 1.25, 0.06), COL.houseBlue, cx + ox * 0.75 + nx * 0.16, 1.8, cz + oz * 0.75 + nz * 0.16, 0, rotY, 0);
      }
    }
    return B.piece(b, { solid: true, color: C });
  };
  const fl = panel(4.3, h, -2.85, h / 2, d / 2, 0, [-0.6]), fr = panel(4.3, h, 2.85, h / 2, d / 2, 0, [0.6]);
  const fo = panel(1.4, h - 2.3, 0, 2.3 + (h - 2.3) / 2, d / 2, 0);
  const bk = [panel(5, h, -2.5, h / 2, -d / 2, 0, [0]), panel(5, h, 2.5, h / 2, -d / 2, 0, [0])];
  const sl = [panel(4, h, -w / 2, h / 2, -2, Math.PI / 2, [0]), panel(4, h, -w / 2, h / 2, 2, Math.PI / 2)];
  const sr = [panel(4, h, w / 2, h / 2, -2, Math.PI / 2), panel(4, h, w / 2, h / 2, 2, Math.PI / 2, [0])];
  // door
  { const b = new MB(); b.box(1.1, 2.2, 0.1, COL.houseBlue, -0.5, 1.1, d / 2 + 0.05, 0, -1.2, 0); b.ico(0.05, 0, 0xd8c040, -0.15, 1.1, d / 2 + 0.6); B.piece(b, { color: COL.houseBlue }); }
  // gable ends
  for (const [z, sup] of [[d / 2, [fl, fr, fo]], [-d / 2, bk]]) {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, 2.4); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: false }); g.translate(0, h, -th / 2);
    const b = new MB(); b.add(g, C, 0, 0, z); b.box(0.7, 0.7, 0.1, COL.glass, 0, h + 0.9, z + (z > 0 ? 0.13 : -0.13));
    B.piece(b, { color: C, sup });
  }
  // gable roof: 2 slopes x 2 segments
  const ang = Math.atan2(2.4, w / 2), L = Math.hypot(w / 2, 2.4) + 0.6;
  const roofs = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const b = new MB(); const z = -d / 4 + i * d / 2 + (i ? 0.3 : -0.3);
    b.box(L, 0.2, d / 2 + 0.6, COL.houseRoof, sx * (w / 4), h + 1.15, z, 0, 0, -sx * ang);
    for (let k = 0; k < 4; k++) b.box(L, 0.05, 0.08, 0x5e2a1e, sx * (w / 4), h + 1.27, z - d / 4 + k * d / 6, 0, 0, -sx * ang);
    roofs.push(B.piece(b, { roof: true, color: COL.houseRoof, sup: sx < 0 ? [sl[i]] : [sr[i]] }));
  }
  { const b = new MB(); b.box(0.8, 2.4, 0.8, 0x9a5a48, 2.5, h + 1.8, -1.5); b.box(0.95, 0.2, 0.95, 0x7a4a3a, 2.5, h + 3.0, -1.5); B.piece(b, { color: 0x9a5a48, sup: [roofs[2]] }); }
  // porch
  { const b = new MB(); b.box(w, 0.2, 2.6, COL.woodLight, 0, 0.1, d / 2 + 1.3); for (let i = 0; i < 6; i++) b.box(w, 0.02, 0.05, COL.wood, 0, 0.21, d / 2 + 0.2 + i * 0.44); B.piece(b, { color: COL.woodLight }); }
  const posts = [];
  for (const x of [-4.7, -1.2, 1.2, 4.7]) { const b = new MB(); b.box(0.18, 2.6, 0.18, 0xffffff, x, 1.4, d / 2 + 2.4); posts.push(B.piece(b, { solid: true, color: 0xffffff })); }
  { const b = new MB(); b.box(w + 0.4, 0.15, 3.0, COL.houseRoof, 0, 2.8, d / 2 + 1.4, 0.18, 0, 0); B.piece(b, { roof: true, color: COL.houseRoof, sup: posts }); }
  // furniture
  { const b = new MB(); b.box(1.4, 0.08, 0.9, COL.woodLight, 2.5, 0.85, -1.5); for (const [x, z] of [[1.9, -1.9], [3.1, -1.9], [1.9, -1.1], [3.1, -1.1]]) b.box(0.08, 0.85, 0.08, COL.woodDark, x, 0.42, z); b.box(3.2, 0.02, 2.4, 0xb0503a, -0.5, 0.03, 0.5); B.piece(b, { color: COL.woodLight }); }
  B.finish();
  // bed (not breakable — you always need to be able to sleep)
  const bed = new THREE.Mesh(M.bed(), M.mat); bed.position.set(-23.2, 0, -26.2); bed.rotation.y = Math.PI / 2; bed.castShadow = true; W.scene.add(bed);
  W.bedPos = new V3(-23.2, 0.6, -26.2);
  return B;
}

function buildSilo() {
  const B = new Building(W.buildings.length, 'Silo', 26.5, -32);
  let prev = [];
  for (let i = 0; i < 4; i++) {
    const b = new MB(); b.cyl(2.4, 2.4, 3, 12, i % 2 ? 0xc9ccd0 : 0xb8bcc2, 0, 1.5 + i * 3, 0); b.cyl(2.45, 2.45, 0.15, 12, 0x8a8e94, 0, i * 3 + 2.95, 0);
    prev = [B.piece(b, { solid: true, color: 0xb8bcc2, sup: prev })];
  }
  { const b = new MB(); b.sph(2.45, 12, 6, 0x8a8e94, 0, 12, 0, 1, 0.6, 1); b.cone(0.2, 0.6, 6, 0x6a6e74, 0, 13.6, 0); B.piece(b, { roof: true, color: 0x8a8e94, sup: prev }); }
  B.finish();
}

function buildCoop() {
  const B = new Building(W.buildings.length, 'Chicken coop', -4, -38);
  const w = [];
  for (const [x, z, ry, l] of [[0, 1.2, 0, 3], [0, -1.2, 0, 3], [-1.5, 0, Math.PI / 2, 2.4], [1.5, 0, Math.PI / 2, 2.4]]) {
    const b = new MB(); b.add(new THREE.BoxGeometry(l, 1.6, 0.15), 0xd9b25a, x, 1.1, z, 0, ry, 0);
    if (z > 1) { b.box(0.5, 0.6, 0.2, 0x2a2420, 0, 0.6, z); b.box(0.4, 0.05, 1.4, COL.woodDark, 0, 0.25, z + 0.6, 0.35, 0, 0); }
    w.push(B.piece(b, { solid: true, color: 0xd9b25a }));
  }
  { const b = new MB(); for (const [x, z] of [[-1.4, -1.1], [1.4, -1.1], [-1.4, 1.1], [1.4, 1.1]]) b.box(0.15, 0.4, 0.15, COL.woodDark, x, 0.15, z); B.piece(b, { color: COL.woodDark }); }
  for (const sx of [-1, 1]) { const b = new MB(); b.box(1.9, 0.12, 3.0, 0x9a3a2a, sx * 0.8, 2.25, 0, 0, 0, -sx * 0.41); B.piece(b, { roof: true, color: 0x9a3a2a, sup: w }); }
  B.finish();
}

function buildWindmill() {
  const B = new Building(W.buildings.length, 'Windmill', -44, -38);
  let prev = [];
  for (let i = 0; i < 3; i++) { const b = new MB(); b.cyl(1.3 - i * 0.25, 1.55 - i * 0.25, 3, 8, 0xe8dcc0, 0, 1.5 + i * 3, 0); prev = [B.piece(b, { solid: true, color: 0xe8dcc0, sup: prev })]; }
  { const b = new MB(); b.cone(1.2, 1.6, 8, 0x6a3a2a, 0, 9.8, 0); B.piece(b, { roof: true, color: 0x6a3a2a, sup: prev }); }
  const blade = new MB(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; blade.box(0.5, 4.2, 0.06, 0xf3eee2, Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0, 0, 0, a + Math.PI / 2); blade.box(0.1, 4.4, 0.1, COL.woodDark, Math.cos(a) * 2.2, Math.sin(a) * 2.2, -0.05, 0, 0, a + Math.PI / 2); }
  blade.cyl(0.25, 0.25, 0.4, 6, COL.woodDark, 0, 0, 0, Math.PI / 2, 0, 0);
  const bi = B.piece(blade, { color: 0xf3eee2, sup: prev });
  B.pieces[bi].mesh.position.set(0, 8.6, 1.3);
  B.blades = B.pieces[bi].mesh;
  B.finish();
  W.windmill = B;
}

W.buildFarm = function () {
  W.barn = buildBarn(); W.house = buildHouse(); buildSilo(); buildCoop(); buildWindmill();
  const add = (geo, x, y, z, ry = 0, col) => { const m = new THREE.Mesh(geo, M.mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; W.scene.add(m); if (col) W.colliders.push({ min: { x: x - col[0], y: y - 0.1, z: z - col[1] }, max: { x: x + col[0], y: y + col[2], z: z + col[1] } }); return m; };
  // shop stall by the road
  W.stall = add(M.stall(), -41, 0, -6, Math.PI / 2, [0.8, 2.0, 1.1]);
  W.merchant = add(M.merchant(), -42.3, 0, -6, Math.PI / 2);
  const sg = M.sign('SHOP\nseeds · upgrades'); sg.position.set(-38.5, 0, -9.5); sg.rotation.y = Math.PI / 2; W.scene.add(sg);
  W.shopPos = new V3(-40, 1.2, -6);
  W.binMesh = add(M.shippingBin(), -13, 0, -16, 0, [0.9, 0.55, 1.0]);
  W.binPos = new V3(-13, 0.8, -16);
  const bs = M.sign('SHIPPING', 1.6); bs.position.set(-13, 0.6, -17.3); W.scene.add(bs);
  // animal pen & chicken yard fences
  const fence = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1); const m = new THREE.Mesh(M.fence(len), M.mat); m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); m.castShadow = true; W.scene.add(m); };
  fence(28, -20, 48, -20); fence(48, -20, 48, 0); fence(28, 0, 48, 0); fence(28, -20, 28, -14); fence(28, -6, 28, 0);
  fence(-14, -46, 6, -46); fence(-14, -46, -14, -32); fence(6, -46, 6, -32); fence(-14, -32, -8, -32); fence(0, -32, 6, -32);
  // water trough & hay in the pen
  { const b = new MB(); b.box(2.4, 0.6, 0.9, COL.woodDark, 0, 0.3, 0); b.box(2.2, 0.05, 0.7, 0x4f8fc0, 0, 0.55, 0); add(b.geo(), 38, 0, -17, 0, [1.2, 0.45, 0.7]); }
  { const b = new MB(); b.cyl(0.8, 0.8, 1.2, 10, COL.hay, 0, 0.6, 0, Math.PI / 2, 0, 0); add(b.geo(), 44, 0, -4, 0.4, [0.8, 0.8, 1.2]); add(b.geo(), 31, 0, -3, 1.2, [0.8, 0.8, 1.2]); }
  // farm road sign + mailbox
  const ms = M.sign('CHAOS FARM\nest. today', 2.6); ms.position.set(-45, 0, -15); ms.rotation.y = Math.PI / 2; W.scene.add(ms);
  { const b = new MB(); b.box(0.1, 1.1, 0.1, COL.woodDark, 0, 0.55, 0); b.box(0.4, 0.35, 0.6, 0x3d6fa8, 0, 1.25, 0); b.box(0.05, 0.25, 0.05, 0xe03a2a, 0.22, 1.4, 0.1); add(b.geo(), -44.5, 0, -18); }
  // extraction landing pad (used on the final day)
  { const b = new MB(); b.cyl(5, 5, 0.05, 20, 0x5a5f55, 0, 0.03, 0); b.box(0.6, 0.06, 4, 0xf2f2f2, -1, 0.06, 0); b.box(0.6, 0.06, 4, 0xf2f2f2, 1, 0.06, 0); b.box(2, 0.06, 0.6, 0xf2f2f2, 0, 0.06, 0); W.pad = add(b.geo(), 0, 0, 46); }
  W.padPos = new V3(0, 0, 46);
};

// ---------------- fields & crops ----------------
W.tiles = {
  s: new Uint8Array(TILES_TOTAL), c: new Int8Array(TILES_TOTAL).fill(-1), g: new Float32Array(TILES_TOTAL),
  st: new Uint8Array(TILES_TOTAL), m: new Uint8Array(TILES_TOTAL), f: new Float32Array(TILES_TOTAL),
};
W.tilePos = function (i) {
  const p = PLOTS[Math.floor(i / 64)], k = i % 64;
  return { x: p.x + ((k % 8) + 0.5) * TILE, z: p.z + (Math.floor(k / 8) + 0.5) * TILE };
};
W.tileAt = function (x, z) {
  for (let pi = 0; pi < PLOTS.length; pi++) {
    const p = PLOTS[pi], tx = Math.floor((x - p.x) / TILE), tz = Math.floor((z - p.z) / TILE);
    if (tx >= 0 && tx < 8 && tz >= 0 && tz < 8) return pi * 64 + tz * 8 + tx;
  }
  return -1;
};
W.tilesNear = function (x, z, r) {
  const out = [];
  for (let i = 0; i < TILES_TOTAL; i++) { const p = W.tilePos(i); if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) out.push(i); }
  return out;
};
W.plotOf = i => Math.floor(i / 64);
W.greenhouse = i => G.has('gh' + W.plotOf(i));

W.buildFields = function () {
  // furrowed soil tile
  const sb = new MB();
  sb.box(TILE * 0.96, 0.06, TILE * 0.96, 0xffffff, 0, 0.03, 0);
  for (let i = 0; i < 3; i++) sb.box(TILE * 0.9, 0.06, 0.18, 0xe8e0d8, 0, 0.08, -0.5 + i * 0.5);
  W.soilMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  W.soil = new THREE.InstancedMesh(sb.geo(), W.soilMat, TILES_TOTAL);
  W.soil.receiveShadow = true; W.soil.count = 0;
  W.soil.setColorAt(0, new THREE.Color(1, 1, 1));
  W.scene.add(W.soil);
  // crop instanced meshes per crop x stage
  W.cropIM = CROPS.map((c, ci) => [0, 1, 2, 3].map(st => {
    const im = new THREE.InstancedMesh(M.cropGeo(ci, st), M.cropMat, TILES_TOTAL);
    im.count = 0; im.castShadow = st >= 2; im.receiveShadow = true; im.frustumCulled = false;
    im.setColorAt(0, new THREE.Color(1, 1, 1));
    W.scene.add(im); return im;
  }));
  // fences + for-sale signs per plot
  W.plotDeco = PLOTS.map((p, i) => {
    const g = new THREE.Group(), s = PLOT_N * TILE;
    const f = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1); const m = new THREE.Mesh(M.fence(len), M.mat); m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); m.scale.y = 0.7; g.add(m); };
    const x0 = p.x - 0.4, z0 = p.z - 0.4, x1 = p.x + s + 0.4, z1 = p.z + s + 0.4;
    f(x0, z0, x0 + s * 0.4, z0); f(x1 - s * 0.4, z0, x1, z0); f(x0, z1, x1, z1); f(x0, z0, x0, z1); f(x1, z0, x1, z1);
    W.scene.add(g);
    const sign = M.sign('FIELD ' + (i + 1) + '\nFOR SALE ' + U.money(p.cost), 2.4);
    sign.position.set(p.x + s / 2, 0, p.z + s / 2); W.scene.add(sign);
    const label = M.sign('FIELD ' + (i + 1), 1.4); label.position.set(p.x + s / 2, -0.4, p.z - 0.9); label.scale.setScalar(0.8); W.scene.add(label);
    return { fence: g, sign, label };
  });
  W.refreshPlots();
  // tile highlight
  const hg = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 0.15, TILE));
  W.highlight = new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  W.highlight.visible = false; W.scene.add(W.highlight);
  W.highlight3 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE * 3, 0.15, TILE * 3)), W.highlight.material);
  W.highlight3.visible = false; W.scene.add(W.highlight3);
  W.cropsDirty = true;
};
W.refreshPlots = function () {
  PLOTS.forEach((p, i) => { const own = G.plots[i]; W.plotDeco[i].fence.visible = own; W.plotDeco[i].label.visible = own; W.plotDeco[i].sign.visible = !own; });
  if (W.refreshUpgradeProps) W.refreshUpgradeProps();
};

const _m = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sv = new V3(), _pv = new V3(), _col = new THREE.Color(), _up = new V3(0, 1, 0);
W.rebuildCrops = function () {
  const T = W.tiles;
  for (const row of W.cropIM) for (const im of row) im.count = 0;
  let soil = 0;
  for (let i = 0; i < TILES_TOTAL; i++) {
    if (!T.s[i] && T.c[i] < 0) continue;
    const p = W.tilePos(i);
    if (T.s[i]) {
      _m.compose(_pv.set(p.x, 0, p.z), _qq.identity(), _sv.set(1, 1, 1));
      W.soil.setMatrixAt(soil, _m);
      const burnt = T.f[i] > 0, rad = T.m[i] === 2;
      _col.setHex(burnt ? 0x2a2420 : rad ? 0x5a6a2a : 0x5e3f26);
      W.soil.setColorAt(soil, _col);
      soil++;
    }
    if (T.c[i] >= 0) {
      const im = W.cropIM[T.c[i]][T.st[i]], mu = MUTS[T.m[i]] || MUTS[0], k = im.count++;
      const sc = mu.scale * (0.9 + U.hash2(i, 3) * 0.2);
      _m.compose(_pv.set(p.x + (U.hash2(i, 1) - 0.5) * 0.25, 0.06, p.z + (U.hash2(i, 2) - 0.5) * 0.25), _qq.setFromAxisAngle(_up, U.hash2(i, 4) * 6.28), _sv.set(sc, sc, sc));
      im.setMatrixAt(k, _m);
      _col.setRGB(mu.tint[0], mu.tint[1], mu.tint[2]);
      if (T.f[i] > 0) _col.multiplyScalar(0.35);
      im.setColorAt(k, _col);
    }
  }
  W.soil.count = soil; W.soil.instanceMatrix.needsUpdate = true; if (W.soil.instanceColor) W.soil.instanceColor.needsUpdate = true;
  for (const row of W.cropIM) for (const im of row) { im.visible = im.count > 0; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  W.cropsDirty = false;
};

// ---------------- upgrade props (rods, turret, greenhouses...) ----------------
W.buildUpgradeProps = function () {
  const P = W.props = {};
  const mk = (geo, x, z, ry = 0) => { const m = new THREE.Mesh(geo, M.mat); m.position.set(x, W.height(x, z), z); m.rotation.y = ry; m.castShadow = true; W.scene.add(m); return m; };
  P.rod = [mk(M.rod(), 9, -18), mk(M.rod(), -27, -18), mk(M.rod(), 0, 18), mk(M.rod(), 30, 25)];
  P.rodPos = P.rod.map(m => new V3(m.position.x, 7.2, m.position.z));
  P.turret = mk(M.turret(), 2, -12);
  P.hatch = mk(M.hatch(), -32, -14);
  P.scare = PLOTS.map(p => mk(M.scarecrow(), p.x + PLOT_N * TILE / 2, p.z + PLOT_N * TILE / 2 + 0.01));
  P.scare.forEach(s => s.position.y = -0.4);
  // wind fences: tall slatted walls west & north of the fields
  P.windfence = [];
  for (const [x, z, ry, l] of [[-32.5, 18, Math.PI / 2, 30], [0, 1.5, 0, 62]]) {
    const b = new MB(); const n = Math.round(l / 0.5);
    for (let i = 0; i < n; i++) b.box(0.3, 2.4, 0.08, i % 2 ? COL.woodLight : COL.wood, -l / 2 + i * 0.5, 1.2, 0);
    b.box(l, 0.12, 0.15, COL.woodDark, 0, 2.2, 0.05); b.box(l, 0.12, 0.15, COL.woodDark, 0, 0.5, 0.05);
    P.windfence.push(mk(b.geo(), x, z, ry));
  }
  // sprinkler heads on each plot corner
  P.sprinkler = PLOTS.map(p => { const b = new MB(); b.cyl(0.05, 0.05, 1.2, 5, COL.metal, 0, 0.6, 0); b.cyl(0.15, 0.1, 0.12, 6, 0xd04040, 0, 1.25, 0); return mk(b.geo(), p.x - 0.2, p.z - 0.2); });
  // greenhouses
  P.gh = PLOTS.map(p => {
    const g = new THREE.Group(), s = PLOT_N * TILE + 0.6, h = 3.2;
    const fr = new MB(), ga = Math.atan2(1.2, s / 2), gl = Math.hypot(s / 2, 1.2);
    for (let i = 0; i <= 4; i++) { const z = -s / 2 + i * s / 4; fr.box(0.1, h, 0.1, 0xe8eef2, -s / 2, h / 2, z); fr.box(0.1, h, 0.1, 0xe8eef2, s / 2, h / 2, z); fr.box(gl, 0.1, 0.1, 0xe8eef2, -s / 4, h + 0.6, z, 0, 0, ga); fr.box(gl, 0.1, 0.1, 0xe8eef2, s / 4, h + 0.6, z, 0, 0, -ga); }
    fr.box(0.1, 0.1, s, 0xe8eef2, 0, h + 1.2, 0); fr.box(0.1, 0.1, s, 0xe8eef2, -s / 2, h, 0); fr.box(0.1, 0.1, s, 0xe8eef2, s / 2, h, 0);
    g.add(new THREE.Mesh(fr.geo(), M.mat));
    const glass = new THREE.Group();
    const pane = (w, hh, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), M.matGlass); m.position.set(x, y, z); m.rotation.y = ry; glass.add(m); };
    pane(s, h, -s / 2, h / 2, 0, Math.PI / 2); pane(s, h, s / 2, h / 2, 0, Math.PI / 2); pane(s, h, 0, h / 2, -s / 2, 0);
    pane(s, h * 0.55, 0, h * 0.3, s / 2, 0);
    for (const sx of [-1, 1]) { const pg = new THREE.PlaneGeometry(gl, s); pg.rotateX(-Math.PI / 2); pg.rotateZ(-sx * ga); const m = new THREE.Mesh(pg, M.matGlass); m.position.set(sx * s / 4, h + 0.6, 0); glass.add(m); }
    g.add(glass);
    g.position.set(p.x + (s - 0.6) / 2, 0, p.z + (s - 0.6) / 2);
    W.scene.add(g); return g;
  });
  // bunker room (far underground; you are teleported there)
  const room = new MB(); const RY = -40;
  room.box(8, 0.2, 8, 0x5a5f66, 0, RY, 0); room.box(8, 0.2, 8, 0x4a4f56, 0, RY + 3.2, 0);
  room.box(0.2, 3.2, 8, 0x6a7078, -4, RY + 1.6, 0); room.box(0.2, 3.2, 8, 0x6a7078, 4, RY + 1.6, 0);
  room.box(8, 3.2, 0.2, 0x6a7078, 0, RY + 1.6, -4); room.box(8, 3.2, 0.2, 0x6a7078, 0, RY + 1.6, 4);
  room.box(1.6, 1.8, 0.5, COL.woodDark, -2.8, RY + 0.9, -3.6); for (let i = 0; i < 3; i++) room.box(1.5, 0.05, 0.45, COL.woodLight, -2.8, RY + 0.4 + i * 0.55, -3.55);
  for (let i = 0; i < 6; i++) room.cyl(0.12, 0.12, 0.3, 6, [0xd04040, 0x40a040, 0xd0a040][i % 3], -3.3 + (i % 3) * 0.4, RY + 0.6 + Math.floor(i / 3) * 0.55, -3.5);
  room.box(2, 0.5, 0.9, 0x3a5a8a, 2.5, RY + 0.35, -2.8); room.box(0.1, 3.2, 0.1, 0xd8c040, 0, RY + 1.6, 3.7);
  for (let i = 0; i < 7; i++) room.box(0.6, 0.06, 0.06, 0xd8c040, 0, RY + 0.3 + i * 0.42, 3.7);
  room.box(0.5, 0.2, 0.5, 0xffffd0, 0, RY + 3.05, 0);
  P.bunker = new THREE.Mesh(room.geo(), M.mat); W.scene.add(P.bunker);
  P.bunkerLight = new THREE.PointLight(0xffe8b0, 1.2, 12); P.bunkerLight.position.set(0, RY + 2.6, 0); W.scene.add(P.bunkerLight);
  W.bunkerY = RY;
  W.refreshUpgradeProps();
};
W.refreshUpgradeProps = function () {
  const P = W.props; if (!P) return;
  P.rod.forEach(m => m.visible = G.has('rod'));
  P.turret.visible = G.has('laser');
  P.hatch.visible = G.has('bunker');
  P.scare.forEach((m, i) => m.visible = G.has('scarecrow') && G.plots[i]);
  P.windfence.forEach(m => m.visible = G.has('windfence'));
  P.sprinkler.forEach((m, i) => m.visible = G.has('sprinkler') && G.plots[i]);
  P.gh.forEach((g, i) => g.visible = G.has('gh' + i) && G.plots[i]);
};

// is a point under an intact roof?
const _ray = new THREE.Raycaster();
W.sheltered = function (x, y, z) {
  _ray.set(_pv.set(x, y + 0.2, z), _up); _ray.far = 14;
  return _ray.intersectObjects(W.roofs, false).length > 0;
};

W.update = function (dt) {
  W.timeUniform.value += dt;
  if (W.windmill && W.windmill.blades.visible) W.windmill.blades.rotation.z += dt * (0.5 + W.windUniform.value * 3);
  W.updateClouds(dt);
  if (W.cropsDirty) W.rebuildCrops();
  // flood water
  W.flood.visible = W.waterLevel > -1;
  W.flood.position.y = W.waterLevel;
};
