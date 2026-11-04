// Random islands: a height function (for walking and ship collisions) plus meshes and palm trees.
import * as THREE from 'three';
import { mulberry32, MAP_HALF } from './state.js';

export const ISLANDS = [];

function bump(isl, x, z) {
  const dx = x - isl.x, dz = z - isl.z;
  const a = Math.atan2(dz, dx);
  const rr = isl.r * (1 + 0.16 * Math.sin(a * 3 + isl.s) + 0.09 * Math.sin(a * 5 + isl.s * 2.3));
  const d = Math.hypot(dx, dz) / rr;
  if (d >= 1.25) return -6;
  if (d >= 1) return -6 * (d - 1) / 0.25 - 0.6 * (1 - (d - 1) / 0.25);
  return -0.6 + (isl.h + 0.6) * Math.pow(1 - d * d, 1.6) + Math.sin(dx * 0.21 + isl.s) * Math.cos(dz * 0.17) * 0.6 * (1 - d);
}

// height of the ground at x, z (deep sea = -30)
export function groundHeight(x, z) {
  let h = -30;
  for (const isl of ISLANDS) {
    if (Math.abs(x - isl.x) > isl.r * 1.5 || Math.abs(z - isl.z) > isl.r * 1.5) continue;
    h = Math.max(h, bump(isl, x, z));
  }
  return h;
}

export function makeIslands(scene, seed) {
  ISLANDS.length = 0;
  const r = mulberry32(seed);
  const count = 9 + (r() * 4 | 0);
  let tries = 0;
  while (ISLANDS.length < count && tries++ < 400) {
    const isl = { x: (r() * 2 - 1) * (MAP_HALF - 60), z: (r() * 2 - 1) * (MAP_HALF - 60), r: 16 + r() * 30, h: 4 + r() * 12, s: r() * 10 };
    if (Math.hypot(isl.x, isl.z) < 70) continue;             // keep the start area open
    if (ISLANDS.some(o => Math.hypot(o.x - isl.x, o.z - isl.z) < o.r + isl.r + 45)) continue;
    ISLANDS.push(isl);
  }
  const group = new THREE.Group();
  const sand = new THREE.Color('#d9c48c'), grass = new THREE.Color('#5d8f3a'), rock = new THREE.Color('#7b766c'), wet = new THREE.Color('#9c8b5e');
  for (const isl of ISLANDS) {
    const size = isl.r * 2.7, seg = 64;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + isl.x, z = pos.getZ(i) + isl.z;
      const h = bump(isl, x, z);
      pos.setY(i, h);
      if (h < 0.3) c.copy(wet); else if (h < 1.6) c.copy(sand); else if (h < isl.h * 0.75) c.copy(grass).lerp(sand, Math.max(0, 1 - (h - 1.6) / 1.2) * 0.6); else c.copy(rock);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    m.position.set(isl.x, 0, isl.z);
    m.receiveShadow = true; m.castShadow = true;
    group.add(m);
    // palm trees
    const palms = 2 + (r() * 5 | 0);
    for (let p = 0; p < palms; p++) {
      const a = r() * Math.PI * 2, d = r() * isl.r * 0.7;
      const x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d, h = bump(isl, x, z);
      if (h < 1.2) continue;
      group.add(palm(x, h, z, r));
    }
    // a few rocks
    for (let k = 0; k < 4; k++) {
      const a = r() * Math.PI * 2, d = isl.r * (0.3 + r() * 0.6);
      const x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d, h = bump(isl, x, z);
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + r() * 1.4, 0), new THREE.MeshStandardMaterial({ color: rock, flatShading: true }));
      rk.position.set(x, h, z); rk.rotation.set(r() * 3, r() * 3, 0); rk.castShadow = true;
      group.add(rk);
    }
  }
  scene.add(group);
  return group;
}

const trunkMat = new THREE.MeshStandardMaterial({ color: '#8a6a43', roughness: 1, flatShading: true });
const leafMat = new THREE.MeshStandardMaterial({ color: '#3f7f2c', roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
function palm(x, y, z, r) {
  const g = new THREE.Group();
  const h = 5 + r() * 4, lean = (r() - 0.5) * 0.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, h, 6), trunkMat);
  trunk.position.y = h / 2; trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.4), leafMat);
    leaf.position.y = h;
    leaf.rotation.set(-1.0, i / 6 * Math.PI * 2, 0, 'YXZ');
    leaf.geometry.translate(0, 1.6, 0);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.rotation.z = lean;
  g.position.set(x, y - 0.2, z);
  return g;
}
