// The island slice: terrain + river, sky and day/night lighting, vegetation, resource nodes,
// pickups, colliders and small effects.
import * as THREE from 'three';
import { makeTemplate, templateToObject } from './assets.js';
import { mulberry32, createNoise2D, smoothstep, lerp, clamp } from './util.js';

export const SIZE = 480;
export const HALF = SIZE / 2;
const SEG = 240;
const STEP = SIZE / SEG;
export const WATER_LEVEL = 0;
export const CAMP = new THREE.Vector2(20, 10);
const CHUNK = 60;

// ------------------------------------------------------------------ instancing in chunks
// Each template part becomes one InstancedMesh per 60 m chunk, so far chunks can be hidden
// and the GPU can frustum-cull them.
class InstanceLayer {
  constructor(scene, template, { castShadow = false, receiveShadow = true, maxDist = 200 } = {}) {
    this.scene = scene;
    this.template = template;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.maxDist = maxDist;
    this.items = [];       // { matrix, chunk, local }
    this.chunks = new Map();
  }

  add(x, y, z, rotY = 0, scale = 1, tiltX = 0, tiltZ = 0) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY, tiltZ)),
      new THREE.Vector3(scale, scale, scale));
    const key = `${Math.floor((x + HALF) / CHUNK)},${Math.floor((z + HALF) / CHUNK)}`;
    if (!this.chunks.has(key)) this.chunks.set(key, { items: [], meshes: [], center: new THREE.Vector2() });
    const chunk = this.chunks.get(key);
    const item = { matrix: m, chunk, local: chunk.items.length, visible: true };
    chunk.items.push(item);
    this.items.push(item);
    return this.items.length - 1;
  }

  build() {
    const tmp = new THREE.Matrix4();
    for (const [key, chunk] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      chunk.center.set(cx * CHUNK - HALF + CHUNK / 2, cz * CHUNK - HALF + CHUNK / 2);
      for (const part of this.template.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, chunk.items.length);
        mesh.castShadow = this.castShadow;
        mesh.receiveShadow = this.receiveShadow;
        chunk.items.forEach((it, i) => mesh.setMatrixAt(i, tmp.multiplyMatrices(it.matrix, part.matrix)));
        mesh.computeBoundingSphere();
        this.scene.add(mesh);
        chunk.meshes.push(mesh);
      }
    }
  }

  setVisible(index, visible) {
    const it = this.items[index];
    if (!it || it.visible === visible) return;
    it.visible = visible;
    const tmp = new THREE.Matrix4();
    it.chunk.meshes.forEach((mesh, p) => {
      if (visible) tmp.multiplyMatrices(it.matrix, this.template.parts[p].matrix);
      else tmp.makeScale(0, 0, 0);
      mesh.setMatrixAt(it.local, tmp);
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  updateVisibility(px, pz, distScale) {
    const r = this.maxDist * distScale + CHUNK * 0.75;
    for (const chunk of this.chunks.values()) {
      const vis = Math.hypot(chunk.center.x - px, chunk.center.y - pz) < r;
      for (const m of chunk.meshes) m.visible = vis;
    }
  }
}

// ------------------------------------------------------------------ world
export class World {
  constructor(scene, assets, renderer) {
    this.scene = scene;
    this.assets = assets;
    this.renderer = renderer;
    this.rng = mulberry32(1337);
    this.noise = createNoise2D(mulberry32(42));
    this.noise2 = createNoise2D(mulberry32(7));
    this.heights = new Float32Array((SEG + 1) * (SEG + 1));
    this.layers = {};
    this.nodes = [];          // harvestable things
    this.nodeGrid = new Map();
    this.colliders = new Map(); // cell -> [{x,z,r} | {box}]
    this.pickups = [];
    this.effects = [];
    this.time = 9;            // hour of day, 0..24
    this.day = 1;
    this.distScale = 1;
  }

  // ---------------------------------------------------------------- terrain shape
  riverX(z) { return -95 + 28 * Math.sin(z * 0.012) + 12 * Math.sin(z * 0.031 + 1.3); }

  riverDist(x, z) { return Math.abs(x - this.riverX(z)); }

  fbm(x, z, oct = 4) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.noise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  rawHeight(x, z) {
    let h = 5 + this.fbm(x * 0.006, z * 0.006) * 9 + this.fbm(x * 0.03, z * 0.03, 2) * 1.4;
    // river channel
    const d = this.riverDist(x, z);
    const bed = -2.4 + Math.pow(clamp(d / 10, 0, 1), 2) * 1.6;
    h = lerp(bed, Math.max(h, 1.2), smoothstep(8, 26, d));
    // flat camp clearing
    const dc = Math.hypot(x - CAMP.x, z - CAMP.y);
    h = lerp(5.5 + this.fbm(x * 0.05, z * 0.05, 2) * 0.3, h, smoothstep(12, 34, dc));
    // the edges of this slice rise into hills (the rest of the island comes later)
    const e = smoothstep(175, 236, Math.max(Math.abs(x), Math.abs(z)));
    h += e * (38 + this.fbm(x * 0.02, z * 0.02, 3) * 14);
    return h;
  }

  heightAt(x, z) {
    const gx = clamp((x + HALF) / STEP, 0, SEG - 0.0001), gz = clamp((z + HALF) / STEP, 0, SEG - 0.0001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const W = SEG + 1, H = this.heights;
    const a = H[iz * W + ix], b = H[iz * W + ix + 1], c = H[(iz + 1) * W + ix], d = H[(iz + 1) * W + ix + 1];
    // match the triangle split PlaneGeometry uses
    if (fx + fz < 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  slopeAt(x, z) {
    const e = 1.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  // ---------------------------------------------------------------- build everything
  build() {
    this.buildTerrain();
    this.buildWater();
    this.buildSky();
    this.buildLights();
    this.buildVegetation();
    this.buildPickupMeshes();
    this.spawnPickups();
    this.buildCampProps();
  }

  buildTerrain() {
    const W = SEG + 1;
    for (let iz = 0; iz <= SEG; iz++) for (let ix = 0; ix <= SEG; ix++) {
      this.heights[iz * W + ix] = this.rawHeight(-HALF + ix * STEP, -HALF + iz * STEP);
    }
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const splat = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heights[i];
      pos.setY(i, h);
      const slope = this.slopeAt(x, z);
      const d = this.riverDist(x, z);
      const dc = Math.hypot(x - CAMP.x, z - CAMP.y);
      let sand = (1 - smoothstep(10, 17, d)) + (1 - smoothstep(0.4, 1.6, h)) * 0.8;
      let rock = smoothstep(0.55, 0.95, slope) + smoothstep(14, 30, h) * 0.8;
      let mud = (1 - smoothstep(9, 20, dc)) * 0.9 + smoothstep(0.25, 0.65, this.noise2(x * 0.02, z * 0.02)) * 0.7;
      let forest = 1;
      sand = clamp(sand, 0, 1); rock = clamp(rock, 0, 1); mud = clamp(mud * (1 - sand), 0, 1);
      forest = clamp(forest - sand - rock - mud, 0, 1);
      const sum = forest + mud + rock + sand || 1;
      splat.set([forest / sum, mud / sum, rock / sum, sand / sum], i * 4);
    }
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.computeVertexNormals();

    const A = this.assets;
    const sets = ['forest_leaves_02', 'brown_mud_leaves_01', 'mossy_rock', 'coast_sand_01'];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, normalMap: A.tex(sets[0], 'normal'), normalScale: new THREE.Vector2(1, 1) });
    const uniforms = {};
    sets.forEach((s, i) => { uniforms[`tC${i}`] = { value: A.tex(s, 'color') }; uniforms[`tN${i}`] = { value: A.tex(s, 'normal') }; });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vWorldUv;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat;\nvWorldUv = (modelMatrix * vec4(transformed, 1.0)).xz;');
      const decl = [0, 1, 2, 3].map((i) => `uniform sampler2D tC${i}; uniform sampler2D tN${i};`).join('\n');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${decl}\nvarying vec4 vSplat;\nvarying vec2 vWorldUv;`)
        .replace('#include <map_fragment>', `
          vec2 tuv = vWorldUv / 4.0;
          vec2 tuvR = vWorldUv / 7.0;
          vec3 splatCol = texture2D(tC0, tuv).rgb * vSplat.x + texture2D(tC1, tuv).rgb * vSplat.y
                        + texture2D(tC2, tuvR).rgb * vSplat.z + texture2D(tC3, tuv).rgb * vSplat.w;
          // break up visible tiling with a slow large-scale tint
          float macro = 0.62 + 0.3 * texture2D(tC1, vWorldUv / 97.0).g;
          diffuseColor.rgb *= splatCol * macro;`)
        .replace('#include <normal_fragment_maps>', `
          vec3 mapN = (texture2D(tN0, tuv).xyz * vSplat.x + texture2D(tN1, tuv).xyz * vSplat.y
                     + texture2D(tN2, tuvR).xyz * vSplat.z + texture2D(tN3, tuv).xyz * vSplat.w) * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);`);
    };
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  buildWater() {
    // a tiling ripple normal map drawn once on a canvas
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    const n = createNoise2D(mulberry32(3));
    const hgt = (x, y) => n(x / 32, y / 32) * 0.6 + n(x / 13, y / 13) * 0.3 + n(x / 6, y / 6) * 0.1;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      // sample on a torus so the texture tiles seamlessly
      const f = (a, b) => hgt(a % 256, b % 256);
      const dx = f(x + 1, y) - f(x + 255, y), dy = f(x, y + 1) - f(x, y + 255);
      const i = (y * 256 + x) * 4;
      img.data[i] = 128 + dx * 160; img.data[i + 1] = 128 + dy * 160; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(60, 60);
    this.waterNormal = tex;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1f3d34, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86,
      normalMap: tex, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 1, 1).rotateX(-Math.PI / 2), mat);
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  buildSky() {
    const h = this.assets.hdris;
    this.skyUniforms = {
      tNoon: { value: h.noon }, tSunset: { value: h.sunset }, tNight: { value: h.night },
      weights: { value: new THREE.Vector3(1, 0, 0) }, brightness: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform sampler2D tNoon; uniform sampler2D tSunset; uniform sampler2D tNight;
        uniform vec3 weights; uniform float brightness; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830988 + 0.5);
          vec3 c = texture2D(tNoon, uv).rgb * weights.x + texture2D(tSunset, uv).rgb * weights.y + texture2D(tNight, uv).rgb * weights.z;
          gl_FragColor = vec4(c * brightness, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envNoon = pmrem.fromEquirectangular(h.noon).texture;
    this.envSunset = pmrem.fromEquirectangular(h.sunset).texture;
    pmrem.dispose();
    this.scene.environment = this.envNoon;
    this.scene.fog = new THREE.FogExp2(0x9fb3a4, 0.011);
  }

  buildLights() {
    const sun = new THREE.DirectionalLight(0xfff1dc, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.moon = new THREE.DirectionalLight(0x7f9cff, 0);
    this.scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3b4a2c, 0.5);
    this.scene.add(this.hemi);
  }

  // ---------------------------------------------------------------- vegetation + resources
  layer(name, template, opts) {
    const l = new InstanceLayer(this.scene, template, opts);
    this.layers[name] = l;
    return l;
  }

  canopyTemplate(height, leafTemplate, seed) {
    const r = mulberry32(seed);
    const A = this.assets;
    const geo = new THREE.CylinderGeometry(0.32, 0.62, height, 10, 8);
    geo.translate(0, height / 2, 0);
    const p = geo.attributes.position;
    const bendX = (r() - 0.5) * 1.6, bendZ = (r() - 0.5) * 1.6;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / height;
      p.setX(i, p.getX(i) + Math.sin(t * Math.PI * 0.8) * bendX);
      p.setZ(i, p.getZ(i) + Math.sin(t * Math.PI * 0.8) * bendZ);
      // buttress roots flare at the base
      if (t < 0.08) { const f = 1 + (0.08 - t) * 9; p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); }
    }
    geo.computeVertexNormals();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * height / 3);
    if (!this.barkMat) {
      this.barkMat = new THREE.MeshStandardMaterial({ map: A.tex('bark_brown_02', 'color'), normalMap: A.tex('bark_brown_02', 'normal'), roughness: 0.95 });
    }
    const parts = [{ geometry: geo, material: this.barkMat, matrix: new THREE.Matrix4() }];
    const top = new THREE.Vector3(Math.sin(0.8 * Math.PI) * bendX, height, Math.sin(0.8 * Math.PI) * bendZ);
    const clusters = 9;
    for (let k = 0; k < clusters; k++) {
      const a = (k / clusters) * Math.PI * 2 + r() * 0.5;
      const rad = k === 0 ? 0 : 1.8 + r() * 2.6;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(top.x + Math.cos(a) * rad, height - 1.6 - r() * 2.2 + (k === 0 ? 1.2 : 0), top.z + Math.sin(a) * rad),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, a, (r() - 0.5) * 0.5)),
        new THREE.Vector3(1, 1, 1).multiplyScalar(2.6 + r() * 1.6));
      for (const lp of leafTemplate.parts) parts.push({ geometry: lp.geometry, material: lp.material, matrix: m.clone().multiply(lp.matrix) });
    }
    return { parts, size: new THREE.Vector3(8, height + 2, 8), radius: 0.6 };
  }

  buildVegetation() {
    const A = this.assets;
    const tp = A.models.tropical_pack.scene;
    const byName = (frag) => makeTemplate(tp, { meshFilter: (m) => m.name.includes(frag) });
    const T = {
      palmTrio: byName('Palm_B08b'),
      arecaBush: byName('Palm_B08a'),
      bananaBush: byName('Banana_B09a'),
      fernA: byName('Fern_B053'), fernB: byName('Fern_B051'), fernC: byName('Fern_B052'),
      monstera: byName('Monstera_B07a2'),
      bananaTree: makeTemplate(A.models.banana_tree.scene, { height: 1 }),
      bamboo: makeTemplate(A.models.bamboo.scene, { height: 1 }),
      fern: makeTemplate(A.models.fern.scene, { height: 1 }),
      calathea: makeTemplate(A.models.calathea.scene, { height: 1 }),
      anthurium: makeTemplate(A.models.anthurium.scene, { height: 1 }),
      shrubA: makeTemplate(A.models.shrub_a.scene, { height: 1 }),
      shrubB: makeTemplate(A.models.shrub_b.scene, { height: 1 }),
      rockA: makeTemplate(A.models.rock_a.scene, { height: 1 }),
      rockB: makeTemplate(A.models.rock_b.scene, { height: 1 }),
      mossy: makeTemplate(A.models.mossy_rocks_a.scene, { height: 1 }),
      boulder: makeTemplate(A.models.boulder.scene, { height: 1 }),
      stump: makeTemplate(A.models.stump_a.scene, { height: 1 }),
      log: makeTemplate(A.models.dead_trunk_a.scene, { height: 1 }),
      roots: makeTemplate(A.models.roots.scene, { height: 1 }),
    };
    this.templates = T;
    const leaf = makeTemplate(tp, { meshFilter: (m) => m.name.includes('Banana_B09a'), height: 1 });
    const canopy = [this.canopyTemplate(15, leaf, 11), this.canopyTemplate(18, leaf, 23), this.canopyTemplate(13, leaf, 37)];
    T.canopy = canopy;

    const L = {
      canopy: canopy.map((t, i) => this.layer('canopy' + i, t, { castShadow: true, maxDist: 260 })),
      palmTrio: this.layer('palmTrio', T.palmTrio, { castShadow: true, maxDist: 240 }),
      bananaTree: this.layer('bananaTree', T.bananaTree, { castShadow: true, maxDist: 170 }),
      bamboo: this.layer('bamboo', T.bamboo, { castShadow: true, maxDist: 170 }),
      arecaBush: this.layer('arecaBush', T.arecaBush, { castShadow: true, maxDist: 130 }),
      bananaBush: this.layer('bananaBush', T.bananaBush, { maxDist: 110 }),
      fernA: this.layer('fernA', T.fernA, { maxDist: 80 }), fernB: this.layer('fernB', T.fernB, { maxDist: 80 }), fernC: this.layer('fernC', T.fernC, { maxDist: 80 }),
      fern: this.layer('fern', T.fern, { maxDist: 70 }),
      monstera: this.layer('monstera', T.monstera, { maxDist: 90 }),
      calathea: this.layer('calathea', T.calathea, { maxDist: 70 }),
      anthurium: this.layer('anthurium', T.anthurium, { maxDist: 70 }),
      shrubA: this.layer('shrubA', T.shrubA, { maxDist: 90 }),
      shrubB: this.layer('shrubB', T.shrubB, { maxDist: 90 }),
      rockA: this.layer('rockA', T.rockA, { castShadow: true, maxDist: 140 }),
      rockB: this.layer('rockB', T.rockB, { castShadow: true, maxDist: 140 }),
      mossy: this.layer('mossy', T.mossy, { castShadow: true, maxDist: 160 }),
      boulder: this.layer('boulder', T.boulder, { castShadow: true, maxDist: 220 }),
      stump: this.layer('stump', T.stump, { castShadow: true, maxDist: 110 }),
      log: this.layer('log', T.log, { castShadow: true, maxDist: 110 }),
      roots: this.layer('roots', T.roots, { castShadow: true, maxDist: 110 }),
    };

    const r = this.rng;
    const occupied = new Map(); // coarse spacing grid for big things
    const occKey = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    const free = (x, z, rad) => {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = occupied.get(`${Math.floor(x / 4) + dx},${Math.floor(z / 4) + dz}`);
        if (list) for (const o of list) if (Math.hypot(o.x - x, o.z - z) < o.r + rad) return false;
      }
      return true;
    };
    const occupy = (x, z, rad) => { const k = occKey(x, z); if (!occupied.has(k)) occupied.set(k, []); occupied.get(k).push({ x, z, r: rad }); };

    // rule: where may something grow
    const spot = ({ minRiver = 12, maxRiver = 1e9, camp = 30, maxSlope = 0.6, minH = 1.2, maxH = 24 } = {}) => {
      for (let tries = 0; tries < 30; tries++) {
        const x = (r() * 2 - 1) * (HALF - 8), z = (r() * 2 - 1) * (HALF - 8);
        const h = this.heightAt(x, z);
        if (h < minH || h > maxH) continue;
        const d = this.riverDist(x, z);
        if (d < minRiver || d > maxRiver) continue;
        if (Math.hypot(x - CAMP.x, z - CAMP.y) < camp) continue;
        if (this.slopeAt(x, z) > maxSlope) continue;
        return { x, z, y: h };
      }
      return null;
    };

    const place = (count, layerOrList, opts, scaleMin, scaleMax, extra) => {
      for (let i = 0; i < count; i++) {
        const s = spot(opts);
        if (!s) continue;
        const rad = opts.spacing || 0;
        if (rad && !free(s.x, s.z, rad)) continue;
        const l = Array.isArray(layerOrList) ? layerOrList[Math.floor(r() * layerOrList.length)] : layerOrList;
        const sc = scaleMin + r() * (scaleMax - scaleMin);
        const sink = opts.sink ?? 0.1;
        const idx = l.add(s.x, s.y - sink * sc, s.z, r() * Math.PI * 2, sc, (r() - 0.5) * (opts.tilt || 0), (r() - 0.5) * (opts.tilt || 0));
        if (rad) occupy(s.x, s.z, rad);
        extra && extra(s, sc, l, idx);
      }
    };

    const node = (type, s, l, idx, props) => {
      const n = { id: this.nodes.length, type, x: s.x, y: s.y, z: s.z, layer: l, index: idx, alive: true, respawnAt: 0, ...props };
      n.hp = n.maxHp;
      this.nodes.push(n);
      const k = `${Math.floor(s.x / 8)},${Math.floor(s.z / 8)}`;
      if (!this.nodeGrid.has(k)) this.nodeGrid.set(k, []);
      this.nodeGrid.get(k).push(n);
      if (n.collide) this.addCollider({ x: s.x, z: s.z, r: n.collide, nodeId: n.id });
      return n;
    };

    // big trees
    place(560, L.canopy, { spacing: 4.5, sink: 0.3 }, 0.85, 1.25, (s, sc, l, idx) => {
      const mango = r() < 0.22;
      node('tree', s, l, idx, { resource: 'wood', maxHp: 8, yieldPerHit: 2, collide: 0.7 * sc, reach: 1.8, respawn: 900, mango, label: mango ? 'Mango Tree' : 'Jungle Tree', fall: true });
    });
    place(200, L.palmTrio, { spacing: 4, minRiver: 10 }, 1.3, 1.8);
    place(55, L.bananaTree, { spacing: 3 }, 4.2, 5.6, (s, sc, l, idx) => {
      node('bananatree', s, l, idx, { maxHp: 1, collide: 0.35, reach: 1.6, label: 'Banana Tree' });
    });
    place(150, L.bamboo, { spacing: 2.5, minRiver: 9, maxRiver: 70 }, 6.5, 8.5, (s, sc, l, idx) => {
      node('bamboo', s, l, idx, { resource: 'bamboo', maxHp: 4, yieldPerHit: 2, collide: 0.75, reach: 1.6, respawn: 600, label: 'Bamboo' });
    });
    place(90, L.boulder, { spacing: 3, maxSlope: 0.9, sink: 0.25 }, 2.2, 4, (s, sc, l, idx) => this.addCollider({ x: s.x, z: s.z, r: sc * 0.55 }));
    place(55, L.mossy, { spacing: 2, maxSlope: 0.9, sink: 0.15 }, 1.2, 2.2, (s, sc) => this.addCollider({ x: s.x, z: s.z, r: sc * 0.7 }));
    place(170, [L.rockA, L.rockB], { spacing: 1.5, minRiver: 6, maxSlope: 0.9, sink: 0.25 }, 0.6, 1.1, (s, sc, l, idx) => {
      node('rock', s, l, idx, { resource: 'stone', maxHp: 5, yieldPerHit: 1, collide: 0.45 * sc + 0.2, reach: 1.4, respawn: 700, label: 'Rock' });
    });
    place(80, L.log, { spacing: 2, sink: 0.12 }, 0.3, 0.45, (s, sc, l, idx) => {
      node('log', s, l, idx, { resource: 'wood', maxHp: 3, yieldPerHit: 1, reach: 1.6, respawn: 800, label: 'Fallen Branch' });
    });
    place(45, L.stump, { spacing: 2, sink: 0.1 }, 0.7, 1.1, (s, sc) => this.addCollider({ x: s.x, z: s.z, r: 0.45 * sc }));
    place(45, L.roots, { spacing: 2, sink: 0.15 }, 0.8, 1.3);

    // undergrowth: gives fiber when gathered by hand
    const plant = (label) => (s, sc, l, idx) => node('plant', s, l, idx, { resource: 'fiber', maxHp: 1, yieldPerHit: 2, reach: 1.3, respawn: 420, label, gather: true });
    place(750, [L.fernA, L.fernB, L.fernC], { minRiver: 8, camp: 18 }, 0.9, 1.5, plant('Fern'));
    place(550, L.fern, { minRiver: 8, camp: 18 }, 0.9, 1.6, plant('Fern'));
    place(400, L.monstera, { minRiver: 8, camp: 20 }, 0.9, 1.6, plant('Monstera'));
    place(300, L.bananaBush, { minRiver: 8, camp: 20 }, 1.6, 2.6, plant('Wild Banana Leaves'));
    place(160, L.arecaBush, { minRiver: 8, camp: 20, spacing: 1.5 }, 0.9, 1.3);
    place(260, L.calathea, { minRiver: 8, camp: 18 }, 0.5, 0.9, plant('Calathea'));
    place(220, L.anthurium, { minRiver: 8, camp: 18 }, 0.5, 0.8, plant('Anthurium'));
    place(140, L.shrubA, { minRiver: 8, camp: 20 }, 0.9, 1.4);
    place(85, L.shrubB, { minRiver: 6, camp: 16 }, 0.9, 1.4, (s, sc, l, idx) => {
      node('berrybush', s, l, idx, { maxHp: 1, reach: 1.4, respawn: 360, label: 'Berry Bush', berries: true });
    });
    // ferns around the edge of the camp clearing
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI * 2, d = 13 + r() * 16;
      const x = CAMP.x + Math.cos(a) * d, z = CAMP.y + Math.sin(a) * d;
      const l = [L.fernA, L.fernB, L.fernC, L.fern][i % 4];
      const idx = l.add(x, this.heightAt(x, z) - 0.05, z, r() * Math.PI * 2, 0.8 + r() * 0.6);
      plant('Fern')({ x, z, y: this.heightAt(x, z) }, 1, l, idx);
    }

    for (const l of Object.values(this.layers)) l.build();
    this.L = L;
  }

  // ---------------------------------------------------------------- pickups (fruit on the ground)
  buildPickupMeshes() {
    const mk = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const banana = () => {
      const g = new THREE.Group();
      const geo = new THREE.CapsuleGeometry(0.035, 0.16, 4, 8);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(geo, mk(0xe5c53a, 0.5));
        m.position.set((i - 2) * 0.045, 0.04, 0);
        m.rotation.set(Math.PI / 2, 0, 0.25 + (i - 2) * 0.1);
        m.castShadow = true;
        g.add(m);
      }
      return g;
    };
    const mango = () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), mk(0xe08a2a, 0.45));
      m.scale.set(1, 0.85, 1.3); m.position.y = 0.06; m.castShadow = true;
      const g = new THREE.Group(); g.add(m); return g;
    };
    const berries = () => {
      const g = new THREE.Group();
      const geo = new THREE.SphereGeometry(0.022, 8, 6);
      const mat = mk(0xb3122a, 0.35);
      for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(geo, mat); m.position.set((Math.random() - 0.5) * 0.09, 0.02 + Math.random() * 0.05, (Math.random() - 0.5) * 0.09); g.add(m); }
      return g;
    };
    this.pickupFactory = { banana, mango, berries };
  }

  spawnPickups() {
    const r = this.rng;
    for (const n of this.nodes) {
      if (n.type === 'bananatree') for (let k = 0; k < 2; k++) this.addPickup('banana', n.x + (r() - 0.5) * 2.2, n.z + (r() - 0.5) * 2.2, 1, 480);
      if (n.type === 'tree' && n.mango) for (let k = 0; k < 2; k++) this.addPickup('mango', n.x + (r() - 0.5) * 4, n.z + (r() - 0.5) * 4, 1, 600);
    }
    // a few bananas at the camp so the player can start taming right away
    for (let k = 0; k < 3; k++) this.addPickup('banana', CAMP.x + 4 + k * 0.6, CAMP.y - 3, 1, 900);
  }

  addPickup(item, x, z, count, respawn) {
    const y = this.heightAt(x, z);
    if (y < WATER_LEVEL + 0.1) return null;
    const mesh = this.pickupFactory[item]();
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    const p = { id: this.pickups.length, item, count, x, y, z, mesh, respawn, alive: true, respawnAt: 0 };
    this.pickups.push(p);
    return p;
  }

  takePickup(p) {
    p.alive = false;
    p.mesh.visible = false;
    p.respawnAt = this.totalTime + p.respawn;
  }

  buildCampProps() {
    // a government supply crate marks where the player washed up
    const crate = templateToObject(makeTemplate(this.assets.models.supply_crate.scene, { height: 0.75 }));
    crate.position.set(CAMP.x - 4, this.heightAt(CAMP.x - 4, CAMP.y + 3), CAMP.y + 3);
    crate.rotation.y = 0.4;
    this.scene.add(crate);
    this.addCollider({ x: crate.position.x, z: crate.position.z, r: 0.7 });
  }

  // ---------------------------------------------------------------- colliders
  addCollider(c) {
    const k = `${Math.floor(c.x / 8)},${Math.floor(c.z / 8)}`;
    if (!this.colliders.has(k)) this.colliders.set(k, []);
    this.colliders.get(k).push(c);
    return c;
  }

  removeCollider(pred) {
    for (const list of this.colliders.values()) for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) list.splice(i, 1);
  }

  collidersNear(x, z) {
    const out = [];
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = this.colliders.get(`${cx + dx},${cz + dz}`);
      if (l) for (const c of l) if (!c.disabled) out.push(c);
    }
    return out;
  }

  nodesNear(x, z) {
    const out = [];
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = this.nodeGrid.get(`${cx + dx},${cz + dz}`);
      if (l) for (const n of l) if (n.alive) out.push(n);
    }
    return out;
  }

  // ---------------------------------------------------------------- harvesting
  harvest(n, power) {
    if (!n.alive) return null;
    n.hp -= power;
    this.spawnChips(n);
    if (n.hp > 0) return { amount: n.yieldPerHit ?? 0, done: false };
    this.removeNode(n, true);
    return { amount: n.yieldPerHit ?? 0, done: true };
  }

  removeNode(n, animate) {
    n.alive = false;
    n.respawnAt = this.totalTime + (n.respawn || 600);
    n.layer.setVisible(n.index, false);
    this.removeCollider((c) => c.nodeId === n.id);
    if (animate && n.fall) this.fellTree(n);
  }

  restoreNode(n) {
    n.alive = true;
    n.hp = n.maxHp;
    n.layer.setVisible(n.index, true);
    if (n.collide) this.addCollider({ x: n.x, z: n.z, r: n.collide, nodeId: n.id });
  }

  fellTree(n) {
    const obj = templateToObject(n.layer.template);
    const it = n.layer.items[n.index];
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    it.matrix.decompose(pos, q, s);
    const pivot = new THREE.Group();
    pivot.position.copy(pos);
    obj.quaternion.copy(q); obj.scale.copy(s);
    pivot.add(obj);
    this.scene.add(pivot);
    const dir = Math.random() * Math.PI * 2;
    pivot.rotation.y = dir;
    this.effects.push({ t: 0, update: (e, dt) => {
      e.t += dt;
      const k = Math.min(1, e.t / 2.2);
      obj.rotation.x = 0;
      pivot.rotation.set(0, dir, 0);
      pivot.rotateX(k * k * Math.PI * 0.48);
      if (e.t > 4) { pivot.position.y -= dt * 1.5; }
      if (e.t > 6) { this.scene.remove(pivot); return false; }
      return true;
    } });
  }

  spawnChips(n) {
    const color = n.resource === 'stone' ? 0x8a8a80 : n.resource === 'bamboo' ? 0x9bab5a : n.resource === 'fiber' ? 0x4e7a32 : 0x6b4a2b;
    const count = 10;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), v = [];
    const y = n.y + (n.type === 'rock' || n.type === 'log' || n.type === 'plant' ? 0.4 : 1.2);
    for (let i = 0; i < count; i++) { p.set([n.x, y, n.z], i * 3); v.push(new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3)); }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.07 }));
    this.scene.add(pts);
    this.effects.push({ t: 0, update: (e, dt) => {
      e.t += dt;
      const a = geo.attributes.position;
      for (let i = 0; i < count; i++) { v[i].y -= 9.8 * dt; a.setXYZ(i, a.getX(i) + v[i].x * dt, a.getY(i) + v[i].y * dt, a.getZ(i) + v[i].z * dt); }
      a.needsUpdate = true;
      if (e.t > 0.9) { this.scene.remove(pts); geo.dispose(); return false; }
      return true;
    } });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, camera, player) {
    this.totalTime = (this.totalTime || 0) + dt;
    // 1 game day = 20 real minutes
    this.time += dt * 24 / 1200;
    if (this.time >= 24) { this.time -= 24; this.day++; }
    this.updateLighting(player.position);

    this.sky.position.copy(camera.position);
    this.waterNormal.offset.x += dt * 0.004;
    this.waterNormal.offset.y += dt * 0.0025;

    for (const l of Object.values(this.layers)) l.updateVisibility(player.position.x, player.position.z, this.distScale);

    // respawns
    for (const n of this.nodes) if (!n.alive && n.respawnAt && this.totalTime > n.respawnAt) {
      if (Math.hypot(n.x - player.position.x, n.z - player.position.z) > 25) this.restoreNode(n);
    }
    for (const p of this.pickups) if (!p.alive && this.totalTime > p.respawnAt) { p.alive = true; p.mesh.visible = true; }

    this.effects = this.effects.filter((e) => e.update(e, dt));
  }

  get daylight() { return smoothstep(-0.12, 0.25, this.sunElevation ?? 1); }

  updateLighting(focus) {
    const t = this.time;
    const ang = ((t - 6) / 24) * Math.PI * 2;             // 6:00 sunrise, 18:00 sunset
    const elev = Math.sin(ang);
    this.sunElevation = elev;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.85, elev, 0.45).normalize();
    const day = smoothstep(-0.12, 0.25, elev);
    const golden = smoothstep(-0.15, 0.05, elev) * (1 - smoothstep(0.12, 0.45, elev));
    const night = 1 - smoothstep(-0.28, -0.04, elev);

    // sun
    this.sun.position.copy(focus).addScaledVector(dir, 120);
    this.sun.target.position.copy(focus);
    this.sun.intensity = 3.2 * day * (1 - golden * 0.35);
    this.sun.color.setRGB(1, lerp(0.95, 0.68, golden), lerp(0.86, 0.45, golden));
    // moon from the opposite side
    this.moon.position.copy(focus).addScaledVector(dir, -120);
    this.moon.target.position.copy(focus);
    this.moon.intensity = 0.35 * night;
    this.hemi.intensity = lerp(0.06, 0.35, day);

    // sky blend
    let wN = day * (1 - golden), wS = golden, wNi = night;
    const sum = wN + wS + wNi || 1;
    this.skyUniforms.weights.value.set(wN / sum, wS / sum, wNi / sum);
    this.skyUniforms.brightness.value = lerp(0.35, 1, day);
    this.scene.environment = golden > 0.5 ? this.envSunset : this.envNoon;
    this.scene.environmentIntensity = lerp(0.05, 0.5, day);

    const fogDay = new THREE.Color(0x8b9f8a), fogGold = new THREE.Color(0xc29a76), fogNight = new THREE.Color(0x0a0f18);
    const fc = fogDay.clone().lerp(fogGold, golden).lerp(fogNight, night);
    this.scene.fog.color.copy(fc);
    this.scene.fog.density = 0.011 / this.distScale;
  }
}
