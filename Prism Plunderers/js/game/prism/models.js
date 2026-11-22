// The Prism robots' 3D models, built in code from the concept sheets (DESIGN.md 10). Each builder returns a
// "view": { root, body, visor, flames, legs, ... , meshes } that the robot's animate() moves every frame.
// Models face +z; root.rotation.y = yaw + PI. Flyers have their origin at the body centre, walkers at the feet.
import * as THREE from 'three';

const M = (color, rough = 0.55, metal = 0.3, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, ...extra });
export const MAT = {
  dark: M(0x2a2731, 0.5, 0.35),
  plate: M(0xd7d3df, 0.45, 0.1),
  white: M(0xf1eef8, 0.35, 0.1),
  glow: new THREE.MeshStandardMaterial({ color: 0xb98aff, emissive: 0x9a5cff, emissiveIntensity: 1.3, roughness: 0.3 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xe3d2ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  wing: new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  cone: new THREE.MeshBasicMaterial({ color: 0xc49bff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  ink: new THREE.LineBasicMaterial({ color: 0x1a1426 }),
  wreck: M(0x1b191e, 0.9, 0.2),
  flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};

function kit(view) {
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.userData.mat = mat;
    parent.add(m);
    if (mat !== MAT.flame && mat !== MAT.wing && mat !== MAT.cone) view.meshes.push(m);
    return m;
  };
  const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  return { add, group };
}
// a downward-pointing triangle facing +z (the Prism "eye")
function visorGeo(size) {
  const s = new THREE.Shape();
  s.moveTo(-size, size * 0.55); s.lineTo(size, size * 0.55); s.lineTo(0, -size * 0.75); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
}
// an outward leg: a raised upper part and a lower spike down to the ground (leg space: +x outward, origin at the hip)
function leg(k, parent, upLen, upAng, loLen, loAng, upR, loR, mat) {
  const g = k.group(parent);
  const kx = Math.cos(upAng) * upLen, ky = Math.sin(upAng) * upLen;
  k.add(g, new THREE.BoxGeometry(upLen, upR * 2, upR * 2), mat, kx / 2, ky / 2, 0, 0, 0, upAng);
  const lo = k.group(g, kx, ky, 0);
  lo.rotation.z = loAng;
  const geo = new THREE.CylinderGeometry(loR, loR * 0.3, loLen, 5);
  geo.translate(0, -loLen / 2, 0);
  k.add(lo, geo, MAT.dark);
  return g;
}

// ---------- Fink: a white crystal, thruster at the bottom (prototype colours, as asked) ----------
export function makeFink(glowTex) {
  const view = { meshes: [], flames: [] };
  const k = kit(view);
  const root = view.root = new THREE.Group();
  const body = view.body = k.group(root);
  const g = k.group(body); g.scale.setScalar(0.29);
  const part = (geo, y) => { const m = k.add(g, geo, MAT.white, 0, y, 0); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), MAT.ink)); return m; };
  part(new THREE.ConeGeometry(0.8, 1.7, 6), 0.85);
  part(new THREE.CylinderGeometry(0.8, 0.44, 0.5, 6), -0.25);
  part(new THREE.CylinderGeometry(0.44, 0.32, 0.13, 6), -0.565);
  part(new THREE.CylinderGeometry(0.27, 0.2, 0.11, 6), -0.685);
  const flame = k.add(g, new THREE.ConeGeometry(0.15, 0.55, 6), MAT.flame, 0, -1.0, 0, Math.PI);
  view.flames.push({ mesh: flame, part: 'thruster', base: 1 });
  if (glowTex) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xa36bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = -0.32; halo.scale.setScalar(0.5);
    body.add(halo); view.halo = halo;
  }
  // the scan cone, swept over the ground
  const pivot = view.scan = k.group(body, 0, -0.05, 0);
  const coneGeo = new THREE.ConeGeometry(2.4, 6, 24, 1, true);
  coneGeo.translate(0, -3, 0);
  view.scanMesh = new THREE.Mesh(coneGeo, MAT.cone.clone());
  pivot.add(view.scanMesh);
  return view;
}

// ---------- Fly (Prism-7) and Swatter: armoured VTOL drones with twin thruster pods ----------
function makeDrone(size, glowTex, withGun) {
  const view = { meshes: [], flames: [] };
  const k = kit(view);
  const root = view.root = new THREE.Group();
  const body = view.body = k.group(root);
  const s = size;
  k.add(body, new THREE.DodecahedronGeometry(0.26 * s, 0), MAT.dark, 0, 0, 0, 0, 0, 0, 1, 0.85, 1.3);
  k.add(body, new THREE.BoxGeometry(0.27 * s, 0.05 * s, 0.4 * s), MAT.plate, 0, 0.2 * s, -0.02 * s, -0.1);
  for (const side of [1, -1]) k.add(body, new THREE.BoxGeometry(0.04 * s, 0.16 * s, 0.3 * s), MAT.plate, side * 0.235 * s, 0.03 * s, 0, 0, 0, side * 0.2);
  view.visorMat = MAT.glow.clone();
  view.visor = k.add(body, visorGeo(0.1 * s), view.visorMat, 0, 0.03 * s, 0.32 * s);
  for (const side of [1, -1]) {
    k.add(body, new THREE.BoxGeometry(0.3 * s, 0.06 * s, 0.08 * s), MAT.dark, side * 0.27 * s, 0, -0.03 * s);
    const pod = k.group(body, side * 0.42 * s, 0, -0.04 * s);
    k.add(pod, new THREE.DodecahedronGeometry(0.15 * s, 0), MAT.dark, 0, 0, 0, 0, 0, 0, 1, 0.9, 1.25);
    k.add(pod, new THREE.BoxGeometry(0.2 * s, 0.05 * s, 0.18 * s), MAT.plate, 0, 0.12 * s, 0);
    k.add(pod, new THREE.TorusGeometry(0.09 * s, 0.014 * s, 6, 14), MAT.glow, 0, -0.1 * s, 0, Math.PI / 2);
    const flame = k.add(pod, new THREE.ConeGeometry(0.08 * s, 0.34 * s, 8), MAT.flame, 0, -0.27 * s, -0.06 * s, Math.PI + 0.35);   // down and trailing back
    view.flames.push({ mesh: flame, part: side > 0 ? 'thrusterL' : 'thrusterR', base: 1 });
    view[side > 0 ? 'podL' : 'podR'] = pod;
  }
  for (const [x, z] of [[0.1, 0.12], [-0.1, 0.12], [0, -0.16]]) k.add(body, new THREE.ConeGeometry(0.03 * s, 0.16 * s, 5), MAT.dark, x * s, -0.22 * s, z * s, Math.PI);
  if (withGun) {
    const gun = view.gun = k.group(body, 0, -0.45 * s / 2, 0.25 * s / 2);
    k.add(gun, new THREE.BoxGeometry(0.2, 0.18, 0.3), MAT.dark, 0, 0.05, -0.05);
    const barrels = view.barrels = k.group(gun, 0, 0, 0.3);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      k.add(barrels, new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), MAT.dark, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.1, Math.PI / 2);
    }
    view.gunGlow = MAT.glow.clone();
    k.add(gun, new THREE.TorusGeometry(0.1, 0.018, 6, 16), view.gunGlow, 0, 0, 0.12);
    k.add(gun, new THREE.TorusGeometry(0.1, 0.018, 6, 16), view.gunGlow, 0, 0, 0.42);
    view.muzzle = k.group(gun, 0, 0, 0.8);
  }
  if (glowTex) {
    view.glows = [];
    for (const side of [1, -1]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xa36bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
      sp.position.set(side * 0.42 * s, -0.24 * s, -0.06 * s); sp.scale.setScalar(0.35 * s);
      body.add(sp); view.glows.push(sp);
    }
  }
  return view;
}
export const makeFly = glowTex => makeDrone(1, glowTex, false);
export const makeSwatter = glowTex => makeDrone(2, glowTex, true);

// ---------- Scatter: a low spider, 4 pairs of legs, the eye on the front ----------
export function makeScatter() {
  const view = { meshes: [], flames: [], legs: [] };
  const k = kit(view);
  const root = view.root = new THREE.Group();
  const body = view.body = k.group(root, 0, 0.3, 0);
  k.add(body, new THREE.DodecahedronGeometry(0.2, 0), MAT.dark, 0, 0, 0, 0, 0, 0, 1.15, 0.75, 1.35);
  k.add(body, new THREE.BoxGeometry(0.2, 0.04, 0.27), MAT.plate, 0, 0.13, -0.01, 0.08);
  for (const side of [1, -1]) k.add(body, new THREE.BoxGeometry(0.03, 0.09, 0.2), MAT.plate, side * 0.2, 0.03, 0, 0, 0, side * 0.35);
  view.visorMat = MAT.glow.clone();
  view.visor = k.add(body, visorGeo(0.075), view.visorMat, 0, 0.03, 0.26);
  for (let i = 0; i < 4; i++) for (const side of [1, -1]) {
    const hip = k.group(body, side * 0.14, -0.02, 0.15 - i * 0.1);
    const phi = (1.5 - i) * 0.42;                              // front legs reach forward, back legs back
    const yaw = side > 0 ? -phi : Math.PI + phi;
    const lg = leg(k, hip, 0.2, 0.6, 0.42, 0.4, 0.018, 0.025, MAT.dark);
    lg.rotation.y = yaw;
    view.legs.push({ g: lg, yaw, side, i, tip: lg.children[1] });
  }
  return view;
}

// ---------- Roach: a big armoured roach, 6 legs, antennae; wings and a mortar hatch for flight ----------
export function makeRoach() {
  const view = { meshes: [], flames: [], legs: [] };
  const k = kit(view);
  const root = view.root = new THREE.Group();
  const body = view.body = k.group(root);
  k.add(body, new THREE.DodecahedronGeometry(0.55, 0), MAT.dark, 0, 1.0, 0.72, 0, 0, 0, 1.35, 0.65, 1.15);
  k.add(body, new THREE.DodecahedronGeometry(0.6, 0), MAT.dark, 0, 1.06, -0.1, 0, 0, 0, 1.45, 0.72, 1.25);
  k.add(body, new THREE.DodecahedronGeometry(0.56, 0), MAT.dark, 0, 1.0, -0.95, 0, 0, 0, 1.3, 0.66, 1.2);
  const plates = [
    [0, 1.42, 0.62, 0.7, 0.06, 0.5, 0.28, 0], [0.42, 1.3, 0.45, 0.42, 0.05, 0.45, 0, -0.5], [-0.42, 1.3, 0.45, 0.42, 0.05, 0.45, 0, 0.5],
    [0.5, 1.38, -0.3, 0.42, 0.05, 0.5, 0, -0.55], [-0.5, 1.38, -0.3, 0.42, 0.05, 0.5, 0, 0.55],
    [0, 1.38, -1.0, 0.72, 0.06, 0.5, -0.28, 0], [0.4, 1.22, -1.05, 0.38, 0.05, 0.42, 0, -0.5], [-0.4, 1.22, -1.05, 0.38, 0.05, 0.42, 0, 0.5],
  ];
  for (const [x, y, z, w, h, d, rx, rz] of plates) k.add(body, new THREE.BoxGeometry(w, h, d), MAT.plate, x, y, z, rx, 0, rz);
  for (const side of [1, -1]) k.add(body, new THREE.BoxGeometry(0.04, 0.04, 0.3), MAT.glow, side * 0.62, 1.15, 0.35);
  const head = view.head = k.group(body, 0, 0.88, 1.32);
  k.add(head, new THREE.DodecahedronGeometry(0.3, 0), MAT.dark, 0, 0, 0, 0, 0, 0, 1.2, 0.8, 1);
  view.visorMat = MAT.glow.clone();
  view.visor = k.add(head, visorGeo(0.2), view.visorMat, 0, 0.02, 0.28);
  for (const side of [1, -1]) {
    const geo = new THREE.CylinderGeometry(0.012, 0.006, 1.1, 4);
    geo.translate(0, 0.55, 0);
    k.add(head, geo, MAT.dark, side * 0.12, 0.18, 0.05, 0.95, 0, -side * 0.28);
  }
  for (const z of [0.75, -0.1, -0.9]) for (const side of [1, -1]) {
    const hip = k.group(body, side * 0.62, 0.95, z);
    const yaw = side > 0 ? -z * 0.35 : Math.PI + z * 0.35;
    const lg = leg(k, hip, 0.75, 0.5, 1.35, 0.255, 0.05, 0.075, MAT.dark);
    lg.rotation.y = yaw;
    view.legs.push({ g: lg, yaw, side, i: z > 0.5 ? 0 : z > -0.5 ? 1 : 2 });
  }
  // wings: folded flat until it takes off
  view.wings = [];
  for (const side of [1, -1]) {
    const w = k.group(body, side * 0.3, 1.52, -0.15);
    const geo = new THREE.PlaneGeometry(1.7, 0.62);
    geo.translate(side * 0.85, 0, 0);
    geo.rotateX(-Math.PI / 2);
    k.add(w, geo, MAT.wing);
    w.scale.setScalar(0.01);
    view.wings.push({ g: w, side });
  }
  // the mortar under a hatch on the back
  k.add(body, new THREE.CylinderGeometry(0.13, 0.15, 0.5, 8), MAT.dark, 0, 1.45, -0.15);
  k.add(body, new THREE.TorusGeometry(0.14, 0.02, 6, 14), MAT.glow, 0, 1.68, -0.15, Math.PI / 2);
  const hinge = view.hatch = k.group(body, 0, 1.62, 0.28);
  k.add(hinge, new THREE.BoxGeometry(0.72, 0.08, 0.82), MAT.plate, 0, 0, -0.41);
  view.muzzle = k.group(body, 0, 1.75, -0.15);
  return view;
}

export const BUILD = { fink: makeFink, fly: makeFly, swatter: makeSwatter, scatter: makeScatter, roach: makeRoach };

// a white flash on every armour piece for a moment after a hit
export function setFlash(view, on) {
  if (view.flashOn === on) return;
  view.flashOn = on;
  for (const m of view.meshes) m.material = on ? MAT.flash : (view.wrecked ? MAT.wreck : m.userData.mat);
}
// a dead robot: charred, no lights
export function toWreck(view) {
  view.wrecked = true;
  for (const m of view.meshes) m.material = MAT.wreck;
  for (const f of view.flames) f.mesh.visible = false;
  view.root.traverse(o => { if (o.isSprite || o.isLineSegments) o.visible = false; });
  if (view.scanMesh) view.scanMesh.visible = false;
}
