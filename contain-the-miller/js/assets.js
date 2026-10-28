// Loads models (meshopt-compressed GLB), WebP textures and HDR skies, and turns models into
// "templates": flat lists of parts that can be instanced or cloned, normalized to a target height.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// game root, independent of which page imports this module
export const BASE = new URL('../', import.meta.url).href;
const M = BASE + 'assets/models/';

// Only what the first jungle slice needs; other biomes load their own later.
export const MODEL_LIST = {
  chimp_wild: M + 'monkeys/chimp_wild.glb',
  chimp_basic: M + 'monkeys/chimp_basic.glb',
  fp_hands: M + 'player/fp_hands.glb',
  stone_axe: M + 'tools/stone_axe.glb',
  canteen: M + 'tools/canteen.glb',
  tropical_pack: M + 'plants/tropical_pack.glb',
  banana_tree: M + 'plants/banana_tree.glb',
  bamboo: M + 'plants/bamboo.glb',
  fern: M + 'plants/fern.glb',
  calathea: M + 'plants/calathea.glb',
  anthurium: M + 'plants/anthurium.glb',
  pachira: M + 'plants/pachira.glb',
  shrub_a: M + 'plants/shrub_a.glb',
  shrub_b: M + 'plants/shrub_b.glb',
  rock_a: M + 'rocks/rock_a.glb',
  rock_b: M + 'rocks/rock_b.glb',
  mossy_rocks_a: M + 'rocks/mossy_rocks_a.glb',
  boulder: M + 'rocks/boulder.glb',
  stump_a: M + 'rocks/stump_a.glb',
  dead_trunk_a: M + 'rocks/dead_trunk_a.glb',
  roots: M + 'rocks/roots.glb',
  fire_pit: M + 'props/fire_pit.glb',
  supply_crate: M + 'props/supply_crate.glb',
  crate_a: M + 'props/crate_a.glb',
  lantern: M + 'props/lantern.glb',
};

const T = BASE + 'assets/textures/';
export const TEXTURE_SETS = [
  'forest_leaves_02', 'brown_mud_leaves_01', 'mossy_rock', 'coast_sand_01',
  'bark_brown_02', 'palm_tree_bark', 'bamboo_wall', 'thatch_roof_angled',
];

export const HDRIS = {
  noon: BASE + 'assets/hdri/qwantani_noon_puresky_1k.hdr',
  sunset: BASE + 'assets/hdri/qwantani_sunset_puresky_1k.hdr',
  night: BASE + 'assets/hdri/qwantani_night_puresky_1k.hdr',
};

export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.models = {};
    this.textures = {};
    this.hdris = {};
    this.manager = new THREE.LoadingManager();
    this.gltf = new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder);
    this.texLoader = new THREE.TextureLoader(this.manager);
    this.rgbe = new RGBELoader(this.manager);
  }

  async loadAll(onProgress) {
    let done = 0;
    const jobs = [];
    const total = Object.keys(MODEL_LIST).length + TEXTURE_SETS.length * 3 + Object.keys(HDRIS).length;
    const tick = () => { done++; onProgress && onProgress(done / total); };

    for (const [name, url] of Object.entries(MODEL_LIST)) {
      jobs.push(this.gltf.loadAsync(url).then((g) => { this.models[name] = g; tick(); }));
    }
    for (const id of TEXTURE_SETS) {
      this.textures[id] = {};
      for (const map of ['color', 'normal', 'arm']) {
        jobs.push(this.texLoader.loadAsync(`${T}${id}/${map}.webp`).then((t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          if (map === 'color') t.colorSpace = THREE.SRGBColorSpace;
          this.textures[id][map] = t;
          tick();
        }));
      }
    }
    for (const [name, url] of Object.entries(HDRIS)) {
      jobs.push(this.rgbe.loadAsync(url).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; this.hdris[name] = t; tick(); }));
    }
    await Promise.all(jobs);
    this.prepareMaterials();
  }

  // shadow/side settings that every loaded model should share
  prepareMaterials() {
    for (const g of Object.values(this.models)) {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.alphaTest > 0 || m.transparent) { m.side = THREE.DoubleSide; m.transparent = false; m.alphaTest = Math.max(m.alphaTest, 0.45); }
          if (m.map) m.map.anisotropy = 4;
        }
      });
    }
  }

  tex(id, map, repeat = 1) {
    const t = this.textures[id][map];
    if (repeat === 1) return t;
    const c = t.clone();
    c.repeat.set(repeat, repeat);
    c.needsUpdate = true;
    return c;
  }
}

// A template is a model flattened into parts with baked transforms, scaled so it is `height` tall,
// centred on X/Z with its base at y = 0.
export function makeTemplate(root, { height = null, meshFilter = null, scale = null } = {}) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && (!meshFilter || meshFilter(o))) meshes.push(o); });
  const box = new THREE.Box3();
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = scale ?? (height ? height / size.y : 1);
  const offset = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const parts = meshes.map((m) => ({
    geometry: m.geometry,
    material: m.material,
    matrix: offset.clone().multiply(m.matrixWorld),
  }));
  return { parts, size: size.multiplyScalar(s), radius: Math.max(size.x, size.z) * 0.5 };
}

// Builds a regular Object3D (not instanced) from a template, for one-off props.
export function templateToObject(template, { castShadow = true, receiveShadow = true } = {}) {
  const g = new THREE.Group();
  for (const p of template.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(p.matrix);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    g.add(mesh);
  }
  return g;
}
