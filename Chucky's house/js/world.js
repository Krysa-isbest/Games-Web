import * as THREE from 'three';
import { G } from './state.js';
import { part, mat, canvasTex } from './data.js';
import { buildCity } from './city.js';

export const ROOM = { x: 7, z: 5, h: 3.2 };
// Walkable rectangles for the player [x0, x1, z0, z1]. The street is only a view, never walkable.
const WALK = [[-6.7, 6.7, -4.7, 4.7], [-6.3, -5.5, -5.45, -4.6], [-6.7, 1.3, -12.2, -5.3]];
const WALK_WS = [[4.5, 5.3, -5.45, -4.6], [2.3, 6.7, -10.2, -5.3]];
export const walkable = (x, z) => [...WALK, ...(G.up.workshop ? WALK_WS : [])].some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
export const STATIC = []; // static Box3 colliders (player + physics)
const WALL_BOXES = [];     // walls, only for falling items
let wsBlock, frontDoor, wsDoor, hatchBoards, hatchOpen;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const B3 = (x0, z0, x1, z1, h = 1.5, y0 = 0) => new THREE.Box3(V(x0, y0, z0), V(x1, h, z1));

export const physStatics = () => [...WALL_BOXES, ...STATIC, ...(G.up.workshop ? [] : [wsBlock]),
  ...G.shelves.filter(s => s !== G.carry).map(s => s.userData.box)];

function interactive(obj, kind) {
  obj.traverse(o => o.userData.kind = kind);
  G.interactables.push(obj);
}

function plane(scene, w, h, matl, x, y, z, rx = -Math.PI / 2, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matl);
  m.rotation.set(rx, ry, 0); m.position.set(x, y, z); m.receiveShadow = true;
  scene.add(m);
  return m;
}

const wallMat = (() => {
  let m;
  return () => m ??= new THREE.MeshStandardMaterial({
    roughness: 0.85,
    map: canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#6d4f3a'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) { g.fillStyle = '#7a5a42'; g.fillRect(x, 0, 8, h); g.fillStyle = '#5e4330'; g.fillRect(x + 8, 0, 1, h); }
      for (let i = 0; i < 40; i++) { g.fillStyle = '#0001'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    }, [6, 1.5]),
  });
})();

// Thick wall with a box collider for falling items.
function wall(scene, w, h, x, y, z, ry, matl = wallMat()) {
  const m = new THREE.Mesh(box(w, h, 0.2), matl);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  const hw = ry ? 0.1 : w / 2, hd = ry ? w / 2 : 0.1;
  WALL_BOXES.push(B3(x - hw, z - hd, x + hw, z + hd, y + h / 2, y - h / 2));
  return m;
}

function poster(scene, text, sub, color, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), new THREE.MeshStandardMaterial({
    map: canvasTex(128, 176, g => {
      g.fillStyle = color; g.fillRect(0, 0, 128, 176);
      g.fillStyle = '#fff3d0'; g.fillRect(8, 8, 112, 160);
      g.fillStyle = color; g.font = 'bold 24px Trebuchet MS'; g.textAlign = 'center';
      text.split('\n').forEach((l, i) => g.fillText(l, 64, 60 + i * 28));
      g.font = '13px Trebuchet MS'; g.fillStyle = '#333'; g.fillText(sub, 64, 150);
    }),
  }));
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m);
}

function sign(text, w, h, bg, fg, font = 'bold 30px Impact') {
  return new THREE.MeshStandardMaterial({
    map: canvasTex(256, Math.round(256 * h / w), (g, cw, ch) => {
      g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
      g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      text.split('\n').forEach((l, i, a) => g.fillText(l, cw / 2, ch / 2 + (i - (a.length - 1) / 2) * 34));
    }),
  });
}

export function buildWorld(scene) {
  const { x: RX, z: RZ, h } = ROOM, hy = h / 2;

  // ---------- floors ----------
  const planks = canvasTex(128, 128, (g, w) => {
    for (let i = 0; i < 8; i++) {
      const c = ['#6b4a30', '#74513a', '#5f4229', '#6a4d33'][i % 4];
      g.fillStyle = c; g.fillRect(0, i * 16, w, 16);
      g.fillStyle = '#3a2614'; g.fillRect(0, i * 16 + 15, w, 1);
      const off = (i * 37) % w; g.fillRect(off, i * 16, 1, 16);
      for (let k = 0; k < 6; k++) { g.fillStyle = '#0000001a'; g.fillRect(Math.random() * w, i * 16 + 3 + Math.random() * 10, 10 + Math.random() * 20, 1); }
    }
  }, [5, 4]);
  plane(scene, RX * 2, RZ * 2, new THREE.MeshStandardMaterial({ map: planks, roughness: 0.75 }), 0, 0, 0);
  const concrete = new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(64, 64, (g, w) => {
    g.fillStyle = '#5a5a58'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 300; i++) { g.fillStyle = ['#505050', '#646462', '#4a4a48'][i % 3]; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
  }, [4, 4]) });
  plane(scene, 9, 8, concrete, -2.75, 0, -8.8);     // yard
  plane(scene, 5.2, 5.8, concrete, 4.6, 0.001, -7.8); // workshop floor
  plane(scene, RX * 2, RZ * 2, mat(0x3b342c), 0, h, 0, Math.PI / 2);
  plane(scene, 5.2, 5.6, mat(0x2e2a26), 4.6, 2.9, -7.8, Math.PI / 2);

  // ---------- walls ----------
  wall(scene, RZ * 2, h, -RX, hy, 0, Math.PI / 2);
  wall(scene, RZ * 2, h, RX, hy, 0, Math.PI / 2);
  // back wall: back door gap x -6.6..-5.2, workshop door gap x 4.2..5.6
  wall(scene, 0.4, h, -6.8, hy, -RZ, 0);
  wall(scene, 9.4, h, -0.5, hy, -RZ, 0);
  wall(scene, 1.4, h, 6.3, hy, -RZ, 0);
  wall(scene, 1.4, h - 2.2, -5.9, 2.2 + (h - 2.2) / 2, -RZ, 0);
  wall(scene, 1.4, h - 2.2, 4.9, 2.2 + (h - 2.2) / 2, -RZ, 0);
  // front wall: door x -1..1, display window x 1.3..4.4, food hatch x 5..6.4
  wall(scene, 6, h, -4, hy, RZ, 0);
  wall(scene, 0.3, h, 1.15, hy, RZ, 0);
  wall(scene, 3.1, 1, 2.85, 0.5, RZ, 0); wall(scene, 3.1, 0.6, 2.85, h - 0.3, RZ, 0);
  wall(scene, 0.6, h, 4.7, hy, RZ, 0);
  wall(scene, 1.4, 0.95, 5.7, 0.475, RZ, 0); wall(scene, 1.4, h - 2.1, 5.7, 2.1 + (h - 2.1) / 2, RZ, 0);
  wall(scene, 0.6, h, 6.7, hy, RZ, 0);
  wall(scene, 2, h - 2.3, 0, 2.3 + (h - 2.3) / 2, RZ, 0);
  WALL_BOXES.push(B3(-1, RZ - 0.1, 1, RZ + 0.1, 2.3)); // nothing flies out the door
  WALL_BOXES.push(B3(5, RZ - 0.1, 6.4, RZ + 0.1, 2.1));  // or out the hatch
  const glassM = new THREE.MeshStandardMaterial({ color: 0x88aacc, transparent: true, opacity: 0.18, roughness: 0.05 });
  const glass = new THREE.Mesh(box(3.1, 1.6, 0.05), glassM);
  glass.position.set(2.85, 1.8, RZ); glass.raycast = () => {}; scene.add(glass);
  WALL_BOXES.push(B3(1.3, RZ - 0.1, 4.4, RZ + 0.1, 2.6, 1));
  for (const x of [1.3, 4.4]) part(scene, box(0.08, 1.7, 0.12), 0x2a1a10, x, 1.8, RZ);
  part(scene, box(3.2, 0.08, 0.3), 0x2a1a10, 2.85, 1.0, RZ - 0.05);
  // skirting + picture rail
  const skirt = 0x3a2416;
  for (const [w, x, z, r] of [[14, 0, -4.88, 0], [10, -6.88, 0, Math.PI / 2], [10, 6.88, 0, Math.PI / 2], [6, -4, 4.88, 0]]) {
    part(scene, box(w, 0.15, 0.04), skirt, x, 0.075, z).rotation.y = r;
    part(scene, box(w, 0.05, 0.03), skirt, x, 2.55, z).rotation.y = r;
  }

  // ---------- front door (opens / closes: customers can't come in when it's shut) ----------
  for (const x of [-1, 1]) part(scene, box(0.12, 2.3, 0.26), 0x2a1a10, x, 1.15, RZ);
  part(scene, box(2.2, 0.12, 0.26), 0x2a1a10, 0, 2.3, RZ);
  frontDoor = new THREE.Group(); frontDoor.position.set(-0.95, 0, RZ);
  const leaf = new THREE.Group(); leaf.position.x = 0.95; frontDoor.add(leaf);
  part(leaf, box(1.86, 2.2, 0.06), 0x5a3a22, 0, 1.1, 0);
  const dg = new THREE.Mesh(box(1.3, 1.1, 0.07), glassM); dg.position.set(0, 1.45, 0); leaf.add(dg);
  part(leaf, box(1.2, 0.05, 0.09), 0xc9a227, 0, 1.0, 0, { metalness: 0.8, roughness: 0.3 });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), sign('OPEN', 0.4, 0.2, '#1a6a2a', '#fff'));
  tag.position.set(0, 1.75, -0.04); tag.rotation.y = Math.PI; leaf.add(tag);
  frontDoor.userData.tag = tag;
  interactive(frontDoor, 'door'); scene.add(frontDoor);

  // ---------- back door + workshop door ----------
  for (const [x, z] of [[-6.6, -RZ], [-5.2, -RZ], [4.2, -RZ], [5.6, -RZ]]) part(scene, box(0.12, 2.2, 0.26), 0x2a1a10, x, 1.1, z);
  part(scene, box(1.5, 0.12, 0.26), 0x2a1a10, -5.9, 2.2, -RZ);
  part(scene, box(1.5, 0.12, 0.26), 0x2a1a10, 4.9, 2.2, -RZ);
  const bdoor = part(scene, box(1.3, 2.1, 0.06), 0x5a3a22, -6.55, 1.05, -RZ - 0.62); bdoor.rotation.y = Math.PI / 2;
  wsDoor = new THREE.Group(); wsDoor.position.set(4.25, 0, -RZ);
  part(wsDoor, box(1.3, 2.1, 0.06), 0x4a4a4e, 0.65, 1.05, 0, { metalness: 0.5 });
  const forRent = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), sign('WORKSHOP\nfor rent', 0.7, 0.45, '#f4efdf', '#8a1a1a', 'bold 26px Trebuchet MS'));
  forRent.position.set(0.65, 1.5, 0.04); wsDoor.add(forRent);
  interactive(wsDoor, 'wsdoor'); scene.add(wsDoor);
  wsBlock = B3(4.2, -RZ - 0.15, 5.6, -RZ + 0.15, 2.2);

  // ---------- decorations ----------
  plane(scene, 2.2, 3.2, new THREE.MeshStandardMaterial({
    map: canvasTex(64, 96, (g, w, hh) => { g.fillStyle = '#7a1e1e'; g.fillRect(0, 0, w, hh); g.strokeStyle = '#d9a441'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, hh - 12); g.strokeRect(12, 12, w - 24, hh - 24); }),
  }), 0, 0.005, 2.8);
  poster(scene, 'WE BUY\nGOLD', 'cash paid today', '#b8261b', -6.89, 1.8, -2, Math.PI / 2);
  poster(scene, 'NO\nREFUNDS', 'all sales final', '#1b4fb8', 6.89, 1.8, 2.8, -Math.PI / 2);
  poster(scene, 'CASH\n4 STUFF', 'ask at register', '#1b8a3a', -3.5, 2.0, -4.89, 0);
  poster(scene, 'NO GUNS\nW/O PERMIT', 'by order of the city', '#333333', 2, 2.0, -4.89, 0);

  // ---------- counter, register, computer ----------
  part(scene, box(3, 0.95, 0.8), 0x5a3a22, -4.5, 0.475, 2);
  part(scene, box(3.1, 0.06, 0.9), 0x8a5a33, -4.5, 0.98, 2);
  part(scene, box(3.04, 0.1, 0.84), 0x2a1a10, -4.5, 0.05, 2);
  for (let k = 0; k < 4; k++) {
    part(scene, box(0.62, 0.62, 0.03), 0x6a4428, -5.62 + k * 0.75, 0.5, 1.59);
    part(scene, box(0.5, 0.5, 0.02), 0x4a2e1a, -5.62 + k * 0.75, 0.5, 1.575);
  }
  part(scene, box(3.1, 0.04, 0.04), 0xc9a227, -4.5, 0.93, 1.56, { metalness: 0.7, roughness: 0.3 });
  STATIC.push(B3(-6, 1.6, -3, 2.4, 1.01));

  const reg = new THREE.Group(); reg.position.set(-4.5, 1.01, 2.05);
  part(reg, box(0.5, 0.12, 0.42), 0x2b2d33, 0, 0.06, 0);
  part(reg, box(0.46, 0.02, 0.02), 0x888888, 0, 0.06, 0.215, { metalness: 0.7 });
  part(reg, box(0.3, 0.1, 0.22), 0x3a3d45, 0.05, 0.16, 0.08).rotation.x = -0.25;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    part(reg, box(0.05, 0.02, 0.04), c === 3 ? 0xd04a2a : 0xe8e4dc, -0.05 + c * 0.065, 0.215 - r * 0.012, 0.03 + r * 0.06).rotation.x = -0.25;
  }
  part(reg, new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), 0x222222, -0.15, 0.3, -0.05);
  for (const [z, ry] of [[0.02, 0], [-0.12, Math.PI]]) {
    const s = part(reg, box(0.22, 0.13, 0.03), 0x1a1c20, -0.15, 0.45, z); s.rotation.y = ry;
    part(reg, box(0.18, 0.09, 0.005), 0x55dd88, -0.15, 0.45, z + (ry ? -0.017 : 0.017), { emissive: 0x2a8a4a }).rotation.y = ry;
  }
  part(reg, box(0.12, 0.03, 0.18), 0x1a1a1a, 0.4, 0.015, -0.05); // card terminal
  part(reg, box(0.1, 0.012, 0.06), 0x55aadd, 0.4, 0.035, -0.08, { emissive: 0x113355 });
  part(reg, box(0.08, 0.1, 0.06), 0x333333, -0.38, 0.05, 0.05); // scanner
  part(reg, box(0.06, 0.02, 0.005), 0xff2020, -0.38, 0.08, 0.081, { emissive: 0xff0000 });
  scene.add(reg);

  const pc = new THREE.Group(); pc.position.set(-5.6, 1.01, 2.0);
  part(pc, box(0.56, 0.38, 0.04), 0x1a1c20, 0, 0.32, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshBasicMaterial({
    map: canvasTex(160, 100, g => {
      const gr = g.createLinearGradient(0, 0, 160, 100); gr.addColorStop(0, '#0b3a6a'); gr.addColorStop(1, '#2a0b4a');
      g.fillStyle = gr; g.fillRect(0, 0, 160, 100);
      g.fillStyle = '#9ff'; g.font = 'bold 18px monospace'; g.fillText('CHUCK-OS', 34, 44);
      for (let i = 0; i < 4; i++) { g.fillStyle = ['#e94', '#4c9', '#69f', '#f6c'][i]; g.fillRect(14 + i * 36, 60, 22, 18); }
      g.fillStyle = '#0008'; g.fillRect(0, 88, 160, 12);
    }),
  }));
  screen.position.set(0, 0.32, 0.021); pc.add(screen);
  part(pc, box(0.06, 0.12, 0.06), 0x222222, 0, 0.08, -0.02);
  part(pc, box(0.22, 0.02, 0.15), 0x222222, 0, 0.01, -0.02);
  part(pc, box(0.42, 0.02, 0.14), 0x2b2d33, 0, 0.01, 0.22);
  part(pc, box(0.07, 0.02, 0.1), 0x2b2d33, 0.3, 0.01, 0.22);
  const glow = new THREE.PointLight(0x66aaff, 0.6, 2); glow.position.set(0, 0.35, 0.3); pc.add(glow);
  interactive(pc, 'computer'); scene.add(pc);

  // ---------- stock crates (your backstock) ----------
  const crates = new THREE.Group(); crates.position.set(6.1, 0, -4.1);
  for (const [x, y, z, r] of [[0, 0.25, 0, 0.1], [0.05, 0.75, 0.02, -0.15], [-0.62, 0.25, 0.1, -0.05]]) {
    part(crates, box(0.6, 0.5, 0.6), 0x9a7a4a, x, y, z).rotation.y = r;
    part(crates, box(0.62, 0.06, 0.62), 0x7a5a2a, x, y + 0.2, z).rotation.y = r;
  }
  const stockSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), sign('STOCK', 0.5, 0.2, '#2a1a10', '#f0c060'));
  stockSign.position.set(0.05, 1.1, 0.33); crates.add(stockSign);
  interactive(crates, 'storage'); scene.add(crates);
  STATIC.push(B3(5.1, -4.5, 6.5, -3.7, 1.0));

  // ---------- trash bin ----------
  const bin = new THREE.Group(); bin.position.set(-1.6, 0, 4.5);
  part(bin, new THREE.CylinderGeometry(0.26, 0.22, 0.7, 12, 1, true), 0x5a6068, 0, 0.35, 0, { side: THREE.DoubleSide, metalness: 0.5 });
  part(bin, new THREE.CylinderGeometry(0.22, 0.22, 0.02, 12), 0x333333, 0, 0.01, 0);
  part(bin, new THREE.TorusGeometry(0.26, 0.02, 4, 12), 0x444444, 0, 0.7, 0).rotation.x = Math.PI / 2;
  G.binFill = part(bin, new THREE.CylinderGeometry(0.24, 0.21, 1, 12), 0x151515, 0, 0, 0, { roughness: 0.4 });
  interactive(bin, 'bin'); scene.add(bin);
  STATIC.push(B3(-1.9, 4.2, -1.3, 4.8, 0.72));

  // ---------- food stand hatch (unlocked by the first egg) ----------
  hatchOpen = new THREE.Group(); hatchOpen.position.set(5.7, 0, RZ);
  part(hatchOpen, box(1.5, 0.08, 0.6), 0x8a5a33, 0, 0.98, 0); // counter through the wall
  part(hatchOpen, box(1.6, 0.25, 0.7), 0xd8402a, 0, 2.2, 0.3).rotation.x = 0.4; // awning
  const fs = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.28), sign('FRESH EGGS', 1.2, 0.28, '#f4efdf', '#a02010'));
  fs.position.set(0, 2.3, -0.12); fs.rotation.y = Math.PI; hatchOpen.add(fs);
  const basket = new THREE.Group(); basket.position.set(-0.4, 1.02, -0.1); hatchOpen.add(basket);
  part(basket, new THREE.CylinderGeometry(0.17, 0.13, 0.1, 10, 1, true), 0x8a6a3a, 0, 0.05, 0, { side: THREE.DoubleSide });
  hatchOpen.userData.basket = basket;
  const bell = part(hatchOpen, new THREE.SphereGeometry(0.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xd8b040, 0.5, 1.02, 0.1, { metalness: 0.8, roughness: 0.3 });
  bell.scale.y = 0.8;
  interactive(hatchOpen, 'hatch'); scene.add(hatchOpen);
  hatchBoards = new THREE.Group(); hatchBoards.position.set(5.7, 0, RZ - 0.05);
  for (let k = 0; k < 4; k++) part(hatchBoards, box(1.5, 0.22, 0.04), [0x7a5a3a, 0x6a4a2a][k % 2], 0, 1.1 + k * 0.27, 0).rotation.z = (k % 2 ? 0.06 : -0.05);
  scene.add(hatchBoards);
  STATIC.push(B3(4.95, 4.4, 6.45, 4.8, 1.0));

  // ---------- back yard ----------
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 0.24), ry = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      part(scene, box(0.22, 1.9 + (i % 3) * 0.06, 0.05), i % 2 ? 0x6b4a2a : 0x5d3f22, x0 + (x1 - x0) * t, 0.95, z0 + (z1 - z0) * t).rotation.y = ry;
    }
    WALL_BOXES.push(B3(Math.min(x0, x1) - 0.05, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, Math.max(z0, z1) + 0.05, 1.9));
  };
  fence(-7, -5.1, -7, -12.6); fence(-7, -12.6, 1.6, -12.6); fence(1.6, -12.6, 1.6, -5.1);
  const dump = new THREE.Group(); dump.position.set(-5.6, 0, -11.6);
  part(dump, box(2, 1.1, 1), 0x2f5d3a, 0, 0.65, 0, { metalness: 0.3 });
  part(dump, box(2.05, 0.08, 1.05), 0x244a2e, 0, 1.24, 0).rotation.x = -0.12;
  part(dump, box(1.9, 0.05, 0.05), 0x1d3a24, 0, 0.9, 0.51);
  for (const x of [-0.8, 0.8]) for (const z of [-0.4, 0.4]) part(dump, new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), 0x111111, x, 0.08, z).rotation.x = Math.PI / 2;
  interactive(dump, 'dumpster'); scene.add(dump);
  STATIC.push(B3(-6.65, -12.15, -4.55, -11.05, 1.25));
  part(scene, box(0.6, 0.5, 0.6), 0x9a7a4a, -6.5, 0.25, -6).rotation.y = 0.3;
  part(scene, box(0.5, 0.4, 0.5), 0x8a6a3a, -6.45, 0.7, -5.95).rotation.y = -0.2;
  STATIC.push(B3(-6.9, -6.4, -6.1, -5.6, 0.9));

  // ---------- workshop (bought on the computer) ----------
  wall(scene, 5.6, 2.9, 4.6, 1.45, -10.6, 0, mat(0x5a5650));
  wall(scene, 5.6, 2.9, 2.0, 1.45, -7.8, Math.PI / 2, mat(0x5a5650));
  wall(scene, 5.6, 2.9, 7.0, 1.45, -7.8, Math.PI / 2, mat(0x5a5650));
  const bench = new THREE.Group(); bench.position.set(4.6, 0, -10.05);
  part(bench, box(2.4, 0.08, 0.8), 0x7a5a3a, 0, 0.92, 0);
  for (const x of [-1.1, 1.1]) for (const z of [-0.32, 0.32]) part(bench, box(0.08, 0.9, 0.08), 0x3a3a3a, x, 0.45, z, { metalness: 0.5 });
  part(bench, box(2.3, 0.04, 0.7), 0x5a4a3a, 0, 0.25, 0);
  part(bench, box(2.4, 1.2, 0.04), 0xb08a5a, 0, 1.6, -0.38); // pegboard
  for (let k = 0; k < 6; k++) part(bench, box(0.04, 0.3, 0.03), [0xc02a2a, 0x888888, 0xe0a020][k % 3], -0.9 + k * 0.36, 1.6, -0.34, { metalness: 0.5 });
  part(bench, box(0.25, 0.2, 0.2), 0x2a5a8a, 0.8, 1.05, 0.1, { metalness: 0.3 }); // vice
  const lampW = new THREE.PointLight(0xfff0d0, 6, 8); lampW.position.set(4.6, 2.6, -8.5); scene.add(lampW);
  part(scene, box(1.2, 0.06, 0.2), 0xf4f4f4, 4.6, 2.86, -8.5, { emissive: 0xfff0d0 });
  interactive(bench, 'bench'); scene.add(bench);
  STATIC.push(B3(3.35, -10.5, 5.85, -9.6, 0.96));

  // ---------- open sign in the window ----------
  G.openSign = new THREE.Mesh(box(0.7, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: 0x441111, emissive: 0xaa2222 }));
  G.openSign.position.set(2.85, 2.2, RZ - 0.1);
  interactive(G.openSign, 'opensign'); scene.add(G.openSign);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x2a1d12, 0.35));
  const sun = new THREE.SpotLight(0xffeedd, 18, 16, 1.15, 0.6, 1);
  sun.position.set(0, h - 0.15, 0); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  G.sun = sun;
  for (const x of [-4, 0, 4]) {
    const l = new THREE.PointLight(0xffd9a0, 6, 9); l.position.set(x, h - 0.3, 0); scene.add(l);
    part(scene, new THREE.CylinderGeometry(0.25, 0.3, 0.12, 12), 0xfff1c8, x, h - 0.08, 0, { emissive: 0xffe0a0 });
  }
  const yard = new THREE.PointLight(0xaac4ff, 6, 11); yard.position.set(-2.8, 2.7, -6); scene.add(yard);
  part(scene, box(0.3, 0.12, 0.2), 0xddeeff, -2.8, 2.85, -5.2, { emissive: 0xaac4ff });

  buildCity(scene);
  updateBin(); updateWorld();
}

export function updateBin() {
  const f = Math.min(1, G.binCount / G.up.binCap), m = G.binFill;
  m.visible = f > 0;
  m.scale.y = Math.max(0.01, 0.66 * f);
  m.position.y = 0.02 + 0.33 * f;
}

export function updateSign() {
  G.openSign.material.emissive.set(G.phase === 'open' ? 0x22cc44 : G.phase === 'closing' ? 0xcc8811 : 0xaa2222);
}

// Door, workshop and hatch follow the saved state (also used by co-op guests).
let eggsShown = -1, doorShown = null;
export function updateWorld() {
  frontDoor.rotation.y = G.doorOpen ? -1.35 : 0;
  if (doorShown !== G.doorOpen) {
    doorShown = G.doorOpen;
    frontDoor.userData.tag.material.map?.dispose();
    frontDoor.userData.tag.material = sign(G.doorOpen ? 'OPEN' : 'CLOSED', 0.4, 0.2, G.doorOpen ? '#1a6a2a' : '#8a1a1a', '#fff');
  }
  wsDoor.rotation.y = G.up.workshop ? -1.5 : 0;
  wsDoor.children[1].visible = !G.up.workshop;
  hatchOpen.visible = G.up.stand;
  hatchBoards.visible = !G.up.stand;
  const n = Math.min(G.eggs, 12);
  if (n !== eggsShown) {
    eggsShown = n;
    const b = hatchOpen.userData.basket;
    while (b.children.length > 1) b.remove(b.children[1]);
    for (let i = 0; i < n; i++) part(b, new THREE.SphereGeometry(0.035, 8, 6), 0xf4ead8, Math.cos(i * 2.4) * 0.08 * (i % 3 ? 1 : 0.4), 0.06 + Math.floor(i / 6) * 0.04, Math.sin(i * 2.4) * 0.08 * (i % 3 ? 1 : 0.4)).scale.y = 1.3;
  }
}
