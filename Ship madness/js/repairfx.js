// Repair preview: green see-through blocks show what a plank / furniture would fix.
// Leak markers: holes below the waterline pulse red (visible through walls, close by).
import * as THREE from 'three';
import { G } from './state.js';
import { VS } from './ship.js';

const geo = new THREE.BoxGeometry(VS * 1.06, VS * 1.06, VS * 1.06);
const greenMat = new THREE.MeshBasicMaterial({ color: '#3dff7a', transparent: true, opacity: 0.38, depthWrite: false });
const redMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
const m4 = new THREE.Matrix4();
let green = null, red = null;

function make(mat, order) {
  const m = new THREE.InstancedMesh(geo, mat, 400);
  m.count = 0; m.frustumCulled = false; m.renderOrder = order;
  return m;
}
function fill(mesh, ship, cells) {
  if (mesh.parent !== ship.group) { mesh.parent?.remove(mesh); ship.group.add(mesh); }
  let n = 0;
  for (const c of cells) {
    if (n >= 400) break;
    const [i, j, k] = ship.ijk(c);
    mesh.setMatrixAt(n++, m4.makeTranslation(ship.xOf(i), ship.yOf(j), ship.zOf(k)));
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}
export function showRepair(ship, cells) {
  green ??= make(greenMat, 8);
  if (!ship || !cells.length) { green.count = 0; return; }
  fill(green, ship, cells);
  greenMat.opacity = 0.3 + 0.12 * Math.sin(G.t * 6);
}
// only the leaks within reach of the player
export function showLeaks(ship, near, range = 12) {
  red ??= make(redMat, 9);
  if (!ship || !ship.leakCells?.length) { red.count = 0; return; }
  const cells = ship.leakCells.filter(c => { const [i, j, k] = ship.ijk(c); return Math.hypot(ship.xOf(i) - near.x, ship.yOf(j) - near.y, ship.zOf(k) - near.z) < range; });
  fill(red, ship, cells);
  redMat.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(G.t * 5));
}
export function hideRepairFx() { if (green) green.count = 0; if (red) red.count = 0; }
