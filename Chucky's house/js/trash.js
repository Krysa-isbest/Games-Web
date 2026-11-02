import * as THREE from 'three';
import { G, pick, rand, newUid } from './state.js';
import { part, hitMat } from './data.js';

export function spawnTrash(x, z, kind = pick(['paper', 'can', 'cup']), tid = newUid(), ry = rand(0, 6.28)) {
  if (G.trash.length >= 16) return;
  const g = new THREE.Group();
  if (kind === 'paper') part(g, new THREE.IcosahedronGeometry(0.06, 0), 0xe8e4d8, 0, 0.05, 0);
  else if (kind === 'can') part(g, new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8), pick([0xc0392b, 0x2a7ac0, 0x27ae60]), 0, 0.033, 0).rotation.z = Math.PI / 2;
  else part(g, new THREE.CylinderGeometry(0.045, 0.034, 0.12, 8), 0xf4f1e6, 0, 0.045, 0).rotation.z = Math.PI / 2;
  const hb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), hitMat);
  hb.position.y = 0.1; g.add(hb);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  g.userData.trashKind = kind;
  g.userData.tid = tid;
  g.traverse(o => { o.userData.kind = 'trash'; o.userData.ref = g; });
  G.scene.add(g);
  G.trash.push(g);
  return g;
}

export function removeTrash(g) {
  G.scene.remove(g);
  G.trash.splice(G.trash.indexOf(g), 1);
}

export const trashById = tid => G.trash.find(t => t.userData.tid === tid);
