// Expedition maps, generated from a seed so every co-op player builds the exact same map.
// Both maps are tile grids (T metres per tile): walls block movement and line of sight.
import * as THREE from 'three';
import { part, canvasTex } from './data.js';
import { S } from './settings.js';

export const MAP = { grid: null, N: 21, T: 3.2, boxes: [], lightsLeft: 8 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

// ---------- grid helpers ----------
export const open = (i, j) => i >= 0 && j >= 0 && i < MAP.N && j < MAP.N && MAP.grid[i][j] === 1;
export const tileOf = p => [Math.round(p.x / MAP.T), Math.round(p.z / MAP.T)];
export function free(x, z, r = 0.3) {
  const T = MAP.T;
  for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) if (!open(Math.round((x + dx) / T), Math.round((z + dz) / T))) return false;
  const p = V(x, 0.5, z);
  return !MAP.boxes.some(b => b.clone().expandByScalar(r).containsPoint(p));
}
export function los(a, b) {
  const T = MAP.T, dx = b.x - a.x, dz = b.z - a.z, steps = Math.ceil(Math.hypot(dx, dz) / 0.5);
  for (let i = 1; i < steps; i++) if (!open(Math.round((a.x + dx * i / steps) / T), Math.round((a.z + dz * i / steps) / T))) return false;
  return true;
}
export function bfs(from, to) {
  const N = MAP.N, key = (i, j) => i * N + j, prev = new Map([[key(...from), null]]), q = [from];
  while (q.length) {
    const [i, j] = q.shift();
    if (i === to[0] && j === to[1]) break;
    for (const [a, b] of DIRS) {
      const k = key(i + a, j + b);
      if (open(i + a, j + b) && !prev.has(k)) { prev.set(k, [i, j]); q.push([i + a, j + b]); }
    }
  }
  const path = [];
  if (!prev.has(key(...to))) return path;
  for (let cur = to; cur && !(cur[0] === from[0] && cur[1] === from[1]); cur = prev.get(key(...cur))) path.unshift(cur);
  return path;
}
export function randomOpenNear([i, j], rad) {
  for (let k = 0; k < 20; k++) {
    const a = i + Math.round((Math.random() * 2 - 1) * rad), b = j + Math.round((Math.random() * 2 - 1) * rad);
    if (open(a, b)) return [a, b];
  }
  return [i, j];
}
const addBox = (x, z, hx, hz, h = 1.5) => MAP.boxes.push(new THREE.Box3(V(x - hx, 0, z - hz), V(x + hx, h, z + hz)));

function light(scene, color, intensity, dist, x, y, z) {
  if (MAP.lightsLeft-- <= 0) return null;
  const l = new THREE.PointLight(color, intensity, dist); l.position.set(x, y, z); scene.add(l);
  return l;
}

// ---------- textures ----------
let ALLEY_MATS, JUNK_MATS;
// (Math.random on purpose: these are cached between maps and must never eat the map's seeded numbers.)
function buildingMats() {
  const r = Math.random;
  return ALLEY_MATS ??= ['#5a2e22', '#4a3a30', '#3a3a3e', '#6a4a32', '#4a2a2a'].map(wall => {
    const lit = [];
    const draw = emit => (g, w, h) => {
      g.fillStyle = emit ? '#000' : wall; g.fillRect(0, 0, w, h);
      if (!emit) {
        g.fillStyle = '#0003';
        for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1);
        for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 * 6; x < w; x += 12) g.fillRect(x, y, 1, 6);
      }
      for (let rr = 0; rr < 6; rr++) for (let c = 0; c < 3; c++) {
        const on = lit[rr * 3 + c] ??= r() < 0.15;
        g.fillStyle = on ? '#ffcf7a' : emit ? '#000' : '#10161c';
        g.fillRect(6 + c * 20, 8 + rr * 20, 12, 13);
        if (!emit) { g.fillStyle = '#0006'; g.fillRect(5 + c * 20, 21 + rr * 20, 14, 2); }
      }
    };
    const t = canvasTex(64, 128, draw(false)), e = canvasTex(64, 128, draw(true));
    t.magFilter = e.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: e, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.9 });
  });
}
function groundMat(base, dots, rep) {
  const t = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = dots[i % dots.length]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, [rep, rep]);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
}
function junkMats() {
  return JUNK_MATS ??= {
    ground: groundMat('#4a3e30', ['#3e3426', '#56483a', '#2f2a22', '#5a4a36'], 30),
    fence: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      alphaMap: canvasTex(32, 32, (g, w) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, w); g.strokeStyle = '#fff'; g.lineWidth = 2; for (let k = -w; k < w * 2; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + w, w); g.moveTo(k + w, 0); g.lineTo(k, w); g.stroke(); } }, [40, 1]) }),
  };
}

// ---------- shared props ----------
export function dumpster(scene, x, z, alongZ, r) {
  const g = new THREE.Group(); g.position.set(x, 0, z); if (alongZ) g.rotation.y = Math.PI / 2;
  const c = [0x2f5d3a, 0x2a4a6a, 0x5a4a2a][r() * 3 | 0];
  part(g, box(1.8, 1.05, 0.95), c, 0, 0.6, 0, { metalness: 0.3 });
  part(g, box(1.85, 0.08, 1), new THREE.Color(c).multiplyScalar(0.7).getHex(), 0, 1.15, -0.05).rotation.x = -0.15;
  for (const sx of [-0.7, 0.7]) part(g, new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), 0x111111, sx, 0.07, 0.4).rotation.x = Math.PI / 2;
  scene.add(g);
  alongZ ? addBox(x, z, 0.5, 0.95) : addBox(x, z, 0.95, 0.5);
  return g;
}
function bags(scene, x, z, r) {
  for (let k = 0; k < 2 + (r() * 3 | 0); k++) part(scene, new THREE.IcosahedronGeometry(0.2 + r() * 0.1, 1), 0x0e0e0e, x + (r() - 0.5) * 0.8, 0.2, z + (r() - 0.5) * 0.8, { roughness: 0.3 }).scale.y = 0.8;
}
function crates(scene, x, z, r) {
  const n = 1 + (r() * 3 | 0);
  for (let k = 0; k < n; k++) part(scene, box(0.6, 0.5, 0.6), [0x9a7a4a, 0x8a6a3a, 0xa88a5a][r() * 3 | 0], x + (r() - 0.5) * 0.3, 0.25 + k * 0.5, z + (r() - 0.5) * 0.3).rotation.y = (r() - 0.5) * 0.8;
  addBox(x, z, 0.4, 0.4);
}
function lamp(scene, E, x, z, a, b, r) {
  part(scene, box(0.08, 0.08, 0.5), 0x222222, x - a * 0.25, 3.4, z - b * 0.25).rotation.y = a ? Math.PI / 2 : 0;
  part(scene, box(0.3, 0.1, 0.3), 0xfff0c0, x - a * 0.5, 3.32, z - b * 0.5, { emissive: 0xffc070 });
  const flick = r() < 0.35;
  const l = light(scene, 0xffb860, 12, 12, x - a * 0.5, 3.1, z - b * 0.5);
  if (l) { l.userData.flicker = flick; E.lamps.push(l); }
}
function fireBarrel(scene, E, x, z) {
  part(scene, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), 0x6a3a1a, x, 0.45, z, { metalness: 0.5, roughness: 0.8 });
  const flames = new THREE.Group(); flames.position.set(x, 0.9, z);
  for (const [fx, fz, s] of [[0, 0, 1], [0.1, 0.05, 0.7], [-0.1, -0.05, 0.75]]) part(flames, new THREE.ConeGeometry(0.12 * s, 0.45 * s, 6), 0xff8a20, fx, 0.2 * s, fz, { emissive: 0xff5a00 });
  scene.add(flames);
  const l = light(scene, 0xff7a20, 10, 10, x, 1.4, z);
  E.fires.push({ flames, light: l, seed: Math.random() * 10 });
  addBox(x, z, 0.3, 0.3);
}
// Locked crate (needs the crowbar): better loot inside.
function lockedCrate(scene, E, x, z, id) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  part(g, box(0.9, 0.6, 0.6), 0x5a6a3a, 0, 0.3, 0, { metalness: 0.2 });
  part(g, box(0.92, 0.06, 0.62), 0x3a4a2a, 0, 0.6, 0);
  part(g, box(0.12, 0.14, 0.04), 0xc0a040, 0, 0.45, 0.31, { metalness: 0.8, roughness: 0.3 });
  const c = { id, g, x, z, open: false };
  g.traverse(o => o.userData.crate = c);
  scene.add(g); E.crates.push(c);
  addBox(x, z, 0.45, 0.3, 0.6);
}
// Hiding spot: E to get in. Enemies lose you unless they saw you go in (dogs can sniff you out).
function hideSpot(scene, E, x, z, ry, kind) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  if (kind === 'potty') {
    part(g, box(1.1, 2.2, 1.1), 0x2a6aa0, 0, 1.1, 0);
    part(g, box(1.15, 0.12, 1.15), 0x1a4a7a, 0, 2.25, 0);
    part(g, box(0.7, 1.8, 0.03), 0x2a7ab0, 0, 1.0, 0.56);
    part(g, box(0.25, 0.08, 0.02), 0xd02020, 0.15, 1.6, 0.58, { emissive: 0x400000 });
    addBox(x, z, 0.55, 0.55, 2.2);
  } else if (kind === 'wreck') {
    const c = [0x6a2a1a, 0x2a3a5a, 0x5a5a4a, 0x3a4a3a][Math.random() * 4 | 0];
    part(g, box(3.8, 0.7, 1.7), c, 0, 0.55, 0, { metalness: 0.4, roughness: 0.7 });
    part(g, box(2, 0.6, 1.6), c, -0.2, 1.15, 0, { metalness: 0.4, roughness: 0.7 });
    part(g, box(1.9, 0.45, 1.62), 0x111a22, -0.2, 1.18, 0, { roughness: 0.2 });
    part(g, box(0.9, 0.6, 0.05), c, 0.3, 0.9, 1.1).rotation.y = -0.7; // open door
    for (const sx of [-1.3, 1.3]) part(g, new THREE.CylinderGeometry(0.33, 0.33, 1.75, 10), 0x151515, sx, 0.3, 0).rotation.x = Math.PI / 2;
    const hx = Math.abs(Math.cos(ry)) * 1.9 + Math.abs(Math.sin(ry)) * 0.85, hz = Math.abs(Math.sin(ry)) * 1.9 + Math.abs(Math.cos(ry)) * 0.85;
    addBox(x, z, hx, hz, 1.5);
  } else if (kind === 'locker') { // staff locker in the power plant
    part(g, box(0.9, 2.0, 0.6), 0x4a5a52, 0, 1.0, 0, { metalness: 0.5, roughness: 0.6 });
    for (const sx of [-0.22, 0.22]) {
      part(g, box(0.42, 1.9, 0.02), 0x56685e, sx, 1.0, 0.31, { metalness: 0.5 });
      for (let k = 0; k < 4; k++) part(g, box(0.25, 0.025, 0.01), 0x1a1a1a, sx, 1.65 + k * 0.06, 0.325);
    }
    part(g, box(0.04, 0.14, 0.03), 0xa0a4a8, 0.06, 1.0, 0.33, { metalness: 0.8 });
    addBox(x, z, Math.abs(Math.sin(ry)) > 0.5 ? 0.3 : 0.45, Math.abs(Math.sin(ry)) > 0.5 ? 0.45 : 0.3, 2);
  } else { // dumpster you can climb into
    part(g, box(1.8, 1.05, 0.95), 0x2a4a3a, 0, 0.6, 0, { metalness: 0.3 });
    part(g, box(1.85, 0.08, 1), 0x1a3a2a, 0, 1.4, -0.3).rotation.x = -0.9;
    addBox(x, z, Math.abs(Math.sin(ry)) > 0.5 ? 0.5 : 0.95, Math.abs(Math.sin(ry)) > 0.5 ? 0.95 : 0.5, 1.2);
  }
  const h = { id: E.hides.length, x, z, ry, kind, g };
  g.traverse(o => o.userData.hide = h);
  scene.add(g); E.hides.push(h);
}

// ---------- Back Alley: a maze of alleys between buildings ----------
function genMaze(r, N) {
  const g = Array.from({ length: N }, () => Array(N).fill(0));
  const stack = [[1, 1]]; g[1][1] = 1;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const nb = DIRS.map(([a, b]) => [x + a * 2, z + b * 2, a, b]).filter(([nx, nz]) => nx > 0 && nz > 0 && nx < N - 1 && nz < N - 1 && !g[nx][nz]);
    if (!nb.length) { stack.pop(); continue; }
    const [nx, nz, a, b] = nb[r() * nb.length | 0];
    g[x + a][z + b] = 1; g[nx][nz] = 1;
    stack.push([nx, nz]);
  }
  for (let k = 0; k < 45; k++) {
    const x = 1 + (r() * (N - 2) | 0), z = 1 + (r() * (N - 2) | 0);
    if ((x + z) % 2 === 1) g[x][z] = 1;
  }
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) g[x][z] = 1;
  return g;
}

export function buildAlley(E, r) {
  Object.assign(MAP, { N: 21, T: 3.2, boxes: [], lightsLeft: S.lights });
  const { N, T } = MAP, scene = E.scene;
  MAP.grid = genMaze(r, N);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N * T, N * T), groundMat('#2a2c30', ['#222428', '#33363b', '#1c1d20'], N * T / 3));
  ground.rotation.x = -Math.PI / 2; ground.position.set((N - 1) * T / 2, 0, (N - 1) * T / 2); ground.receiveShadow = true;
  scene.add(ground);
  const mats = buildingMats(), openTiles = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (open(i, j)) { openTiles.push([i, j]); continue; }
    let edge = false;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (open(i + a, j + b)) edge = true;
    if (!edge) continue;
    const h = 5 + ((i * 31 + j * 17) % 7), m = new THREE.Mesh(unitBox, mats[(i * 7 + j * 13) % mats.length]);
    m.scale.set(T, h, T); m.position.set(i * T, h / 2, j * T);
    scene.add(m);
    if ((i * 13 + j * 7) % 5 === 0) part(scene, box(1, 0.6, 0.8), 0x777777, i * T, h + 0.3, j * T, { metalness: 0.5 });
    if ((i * 11 + j * 5) % 9 === 0) { // fire escape
      const s = DIRS.find(([a, b]) => open(i + a, j + b));
      if (s) for (let f = 1; f < 3; f++) part(scene, box(1.4, 0.06, 0.7), 0x2a2a2a, i * T + s[0] * 1.95, f * 2.2, j * T + s[1] * 1.95, { metalness: 0.6 }).rotation.y = s[0] ? Math.PI / 2 : 0;
    }
  }
  const dist = ([i, j]) => Math.abs(i - 2) + Math.abs(j - 2);
  const deg = ([i, j]) => DIRS.filter(([a, b]) => open(i + a, j + b)).length;
  const far = openTiles.filter(t => dist(t) > 6);
  const shuffle = a => a.map(v => [r(), v]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  const camps = shuffle(far).slice(0, 3);
  for (const [i, j] of camps) fireBarrel(scene, E, i * T + (r() - 0.5), j * T + (r() - 0.5));
  const used = new Set(camps.map(t => t.join()));
  // hiding dumpsters + locked crates + big objects
  const spots = shuffle(openTiles.filter(t => dist(t) > 3 && !used.has(t.join())));
  let si = 0;
  const take = () => { const t = spots[si++]; used.add(t.join()); return t; };
  for (let k = 0; k < 6; k++) {
    const [i, j] = take(), walls = DIRS.filter(([a, b]) => !open(i + a, j + b));
    const [a, b] = walls.length ? walls[r() * walls.length | 0] : [1, 0];
    hideSpot(scene, E, i * T + a * 1.0, j * T + b * 1.0, a ? Math.PI / 2 : 0, 'dumpster');
  }
  for (let k = 0; k < 3; k++) { const [i, j] = take(); lockedCrate(scene, E, i * T + (r() - 0.5) * 0.8, j * T + (r() - 0.5) * 0.8, k); }
  E.bigSpots = [];
  for (const id of ['arcade', 'acunit', 'acunit']) { const [i, j] = take(); E.bigSpots.push({ id, x: i * T, z: j * T, ry: r() * 6.28 }); }
  // wall props
  let lampsPlaced = 0;
  for (const t of openTiles) {
    const [i, j] = t;
    const rr = r(), pickW = r();
    if (dist(t) <= 3 || used.has(t.join())) continue;
    const walls = DIRS.filter(([a, b]) => !open(i + a, j + b));
    if (!walls.length) continue;
    const [a, b] = walls[pickW * walls.length | 0], x = i * T + a * 1.05, z = j * T + b * 1.05;
    if (rr < 0.12) dumpster(scene, x, z, a !== 0, r);
    else if (rr < 0.3) bags(scene, x, z, r);
    else if (rr < 0.4) crates(scene, x, z, r);
    else if (rr < 0.5 && lampsPlaced < 6 && E.ev.id !== 'blackout') { lampsPlaced++; lamp(scene, E, i * T + a * 1.55, j * T + b * 1.55, a, b, r); }
  }
  // loot spots: dead ends (better) then random tiles
  const lootTiles = openTiles.filter(t => dist(t) > 4 && !used.has(t.join()));
  const deadEnds = shuffle(lootTiles.filter(t => deg(t) === 1)).slice(0, 8);
  const others = shuffle(lootTiles.filter(t => !deadEnds.includes(t))).slice(0, 8 + Math.round(E.skulls * 3));
  E.lootSpots = [...deadEnds.map(t => [t, 0.3]), ...others.map(t => [t, 0])].map(([[i, j], boost]) => ({ x: i * T + (r() - 0.5) * 1.4, z: j * T + (r() - 0.5) * 1.4, boost }));
  E.enemySpots = { camps: camps.map(([i, j]) => [i * T, j * T]), far: shuffle(far).slice(0, 30).map(([i, j]) => [i * T, j * T]) };
  E.spawn = { x: 2 * T, z: 2.6 * T, ry: -3 * Math.PI / 4 };
  E.truckAt = { x: 2 * T, z: 1 * T, ry: Math.PI / 2 };
}

// ---------- Junkyard: big fenced yard, aisles of crushed cars, a guard and his dogs ----------
export function buildJunkyard(E, r) {
  Object.assign(MAP, { N: 25, T: 3.2, boxes: [], lightsLeft: S.lights });
  const { N, T } = MAP, scene = E.scene, M = junkMats();
  const g = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === 0 || j === 0 || i === N - 1 || j === N - 1) ? 0 : 1));
  // rows of car stacks with gaps, alternating direction
  for (let i = 3; i < N - 2; i += 3) {
    let j = 2 + (r() * 2 | 0);
    while (j < N - 2) {
      const len = 2 + (r() * 4 | 0);
      for (let k = 0; k < len && j + k < N - 2; k++) if (!(i <= 5 && j + k <= 5)) g[i][j + k] = 2; // 2 = car stack
      j += len + 1 + (r() * 2 | 0);
    }
  }
  for (let k = 0; k < 8; k++) { // containers across aisles
    const i = 2 + (r() * (N - 5) | 0), j = 2 + (r() * (N - 5) | 0);
    if (i > 5 || j > 5) { g[i][j] = 3; if (g[i][j + 1] === 1) g[i][j + 1] = 3; }
  }
  // the guard's trailer in the middle
  const ci = N >> 1, cj = N >> 1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) g[ci + a][cj + b] = 1;
  g[ci][cj] = 4;
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) g[x][z] = 1;
  // flood fill: anything you can't reach becomes a wall
  const seen = new Set(['1,1']), q = [[1, 1]];
  while (q.length) {
    const [i, j] = q.shift();
    for (const [a, b] of DIRS) { const k = `${i + a},${j + b}`; if (!seen.has(k) && g[i + a]?.[j + b] === 1) { seen.add(k); q.push([i + a, j + b]); } }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (g[i][j] === 1 && !seen.has(`${i},${j}`)) g[i][j] = 2;
  MAP.grid = g.map(row => row.map(v => v === 1 ? 1 : 0));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N * T + 40, N * T + 40), M.ground);
  ground.rotation.x = -Math.PI / 2; ground.position.set((N - 1) * T / 2, 0, (N - 1) * T / 2); ground.receiveShadow = true;
  scene.add(ground);
  const carCol = () => [0x6a2a1a, 0x2a3a5a, 0x5a5a4a, 0x3a4a3a, 0x8a6a2a, 0x4a4a4a, 0x7a7a72][r() * 7 | 0];
  const openTiles = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const v = g[i][j], x = i * T, z = j * T;
    if (v === 1) { openTiles.push([i, j]); continue; }
    if (v === 0) { // perimeter fence
      const post = part(scene, new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), 0x888888, x, 1.6, z, { metalness: 0.6 });
      void post;
      const fm = new THREE.Mesh(new THREE.PlaneGeometry(T, 3), M.fence);
      fm.position.set(x, 1.5, z); fm.rotation.y = i === 0 || i === N - 1 ? Math.PI / 2 : 0;
      scene.add(fm);
      continue;
    }
    if (v === 2) { // stack of 2-3 crushed cars
      const n = 2 + (r() * 2 | 0);
      for (let k = 0; k < n; k++) {
        const c = part(scene, box(2.9 - r() * 0.3, 0.95, 1.6 + r() * 0.5), carCol(), x + (r() - 0.5) * 0.2, 0.48 + k * 0.97, z + (r() - 0.5) * 0.3, { metalness: 0.4, roughness: 0.75 });
        c.rotation.y = (r() - 0.5) * 0.3 + (i % 2 ? Math.PI / 2 : 0);
        part(scene, box(1.6, 0.25, 1.55), 0x101820, x, 0.85 + k * 0.97, z, { roughness: 0.3 }).rotation.y = c.rotation.y;
      }
      if (r() < 0.3) part(scene, new THREE.TorusGeometry(0.35, 0.14, 6, 12), 0x151515, x + 1, 0.15, z + 1.1).rotation.x = Math.PI / 2;
    }
    if (v === 3) { // shipping container
      const c = part(scene, box(T, 2.6, T * 0.92), [0x8a2a1a, 0x1a4a7a, 0x2a6a3a, 0xa07020][r() * 4 | 0], x, 1.3, z, { metalness: 0.4, roughness: 0.6 });
      for (let k = -3; k <= 3; k++) part(scene, box(0.06, 2.5, T * 0.93), new THREE.Color(c.material.color).multiplyScalar(0.8).getHex(), x + k * 0.45, 1.3, z);
    }
    if (v === 4) { // guard trailer
      part(scene, box(T * 0.95, 2.6, T * 0.95), 0xd8d4c8, x, 1.4, z, { metalness: 0.3 });
      part(scene, box(T, 0.15, T), 0x6a6a6a, x, 2.75, z);
      part(scene, box(0.8, 0.5, 0.05), 0xffd890, x, 1.7, z + T * 0.48, { emissive: 0xffb050 });
      part(scene, box(0.7, 1.9, 0.05), 0x8a7a6a, x + 0.9, 1.05, z + T * 0.48);
      light(scene, 0xffb860, 10, 12, x, 2.4, z + T * 0.7);
      E.trailer = { x, z: z + T * 0.85 };
    }
  }
  // tire piles, oil barrels, scrap (decoration with colliders)
  const dist = ([i, j]) => Math.abs(i - 2) + Math.abs(j - 2);
  const shuffle = a => a.map(v => [r(), v]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  const spots = shuffle(openTiles.filter(t => dist(t) > 3));
  let si = 0;
  const used = new Set();
  const take = () => { while (si < spots.length && used.has(spots[si].join())) si++; const t = spots[si++]; used.add(t.join()); return t; };
  for (let k = 0; k < 10; k++) {
    const [i, j] = take(), x = i * T + (r() - 0.5) * 1.2, z = j * T + (r() - 0.5) * 1.2;
    if (k % 2) { for (let t = 0; t < 4; t++) part(scene, new THREE.TorusGeometry(0.34, 0.14, 6, 12), 0x151515, x + (t % 2) * 0.3, 0.15 + t * 0.26, z, { roughness: 0.95 }).rotation.x = Math.PI / 2; addBox(x, z, 0.55, 0.5, 1.2); }
    else { for (let t = 0; t < 3; t++) part(scene, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), [0x2a4a8a, 0xa02a1a, 0x3a3a3a][t], x + (t - 1) * 0.62, 0.45, z, { metalness: 0.5 }); addBox(x, z, 1, 0.35, 0.9); }
  }
  // hiding spots: wrecks with open doors, porta-potties
  for (let k = 0; k < 7; k++) { const [i, j] = take(); hideSpot(scene, E, i * T, j * T, (r() * 4 | 0) * Math.PI / 2, 'wreck'); }
  for (let k = 0; k < 3; k++) { const [i, j] = take(); hideSpot(scene, E, i * T + 0.9, j * T + 0.9, (r() * 4 | 0) * Math.PI / 2, 'potty'); }
  for (let k = 0; k < 3; k++) { const [i, j] = take(); lockedCrate(scene, E, i * T, j * T, k); }
  E.bigSpots = [];
  for (const id of ['motorbike', 'motorbike', 'generator', 'generator']) { const [i, j] = take(); E.bigSpots.push({ id, x: i * T, z: j * T, ry: r() * 6.28 }); }
  // floodlights on poles
  for (let k = 0; k < 5; k++) {
    const [i, j] = take(), x = i * T, z = j * T;
    part(scene, new THREE.CylinderGeometry(0.1, 0.12, 6, 8), 0x3a3a3a, x, 3, z);
    part(scene, box(0.6, 0.35, 0.3), 0x222222, x, 6, z);
    part(scene, box(0.5, 0.25, 0.05), 0xffffff, x, 5.95, z + 0.16, { emissive: E.ev.id === 'blackout' ? 0x000000 : 0xfff0d0 });
    addBox(x, z, 0.15, 0.15, 6);
    const flick = r() < 0.3;
    if (E.ev.id !== 'blackout') { const l = light(scene, 0xe0e8ff, 26, 22, x, 5.6, z + 0.6); if (l) { l.userData.flicker = flick; E.lamps.push(l); } }
  }
  // far city behind the fence
  for (let k = 0; k < 14; k++) {
    const h = 10 + r() * 30, w = 8 + r() * 12, a = r() * Math.PI * 2, d = N * T * 0.75 + 20 + r() * 30;
    const m = new THREE.Mesh(unitBox, buildingMats()[k % 5]);
    m.scale.set(w, h, w); m.position.set((N - 1) * T / 2 + Math.cos(a) * d, h / 2, (N - 1) * T / 2 + Math.sin(a) * d);
    scene.add(m);
  }
  const lootTiles = shuffle(openTiles.filter(t => dist(t) > 4 && !used.has(t.join())));
  E.lootSpots = lootTiles.slice(0, 22 + Math.round(E.skulls * 4)).map(([i, j]) => ({ x: i * T + (r() - 0.5) * 1.4, z: j * T + (r() - 0.5) * 1.4, boost: Math.abs(i - ci) + Math.abs(j - cj) < 5 ? 0.3 : 0 }));
  // guard patrol: a loop of waypoints around the yard
  const wp = shuffle(openTiles.filter(t => dist(t) > 6)).slice(0, 6).map(([i, j]) => [i * T, j * T]);
  E.enemySpots = { guard: [ci * T, (cj + 1) * T], patrol: wp, dogs: shuffle(openTiles.filter(t => dist(t) > 8)).slice(0, 6).map(([i, j]) => [i * T, j * T]) };
  E.spawn = { x: 2 * T, z: 2.6 * T, ry: -3 * Math.PI / 4 };
  E.truckAt = { x: 2 * T, z: 1 * T, ry: Math.PI / 2 };
}

// ---------- Abandoned Power Plant: concrete halls in a 4×4 grid of rooms, the reactor hall at the far end ----------
let PLANT_MATS;
function plantMats() {
  return PLANT_MATS ??= {
    wall: new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#5a5c58'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? '#4e504c' : '#666862'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = '#0003'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1); for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 1, h);
      for (let k = 0; k < 3; k++) { const x = Math.random() * w, gr = g.createLinearGradient(0, h * 0.3, 0, h); gr.addColorStop(0, '#2a2a1a00'); gr.addColorStop(1, '#2a2a1a99'); g.fillStyle = gr; g.fillRect(x, h * 0.3, 6 + Math.random() * 8, h * 0.7); }
      g.fillStyle = '#1a1a1a'; g.fillRect(0, h - 10, w, 10);
      g.fillStyle = '#d8b020'; for (let x = -16; x < w; x += 16) { g.beginPath(); g.moveTo(x, h - 10); g.lineTo(x + 8, h - 10); g.lineTo(x + 16, h); g.lineTo(x + 8, h); g.fill(); }
    }) }),
    tower: new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 1, side: THREE.DoubleSide }),
    goo: new THREE.MeshStandardMaterial({ color: 0x40ff60, emissive: 0x20c040, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.8 }),
    sign: new THREE.MeshStandardMaterial({ map: canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#e8c020'; g.fillRect(0, 0, w, w); g.fillStyle = '#111'; g.beginPath(); g.arc(32, 32, 6, 0, 7); g.fill();
      for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 - Math.PI / 2; g.beginPath(); g.moveTo(32, 32); g.arc(32, 32, 24, a - 0.5, a + 0.5); g.fill(); }
      g.fillStyle = '#e8c020'; g.beginPath(); g.arc(32, 32, 9, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(32, 32, 5, 0, 7); g.fill();
    }), roughness: 0.6 }),
  };
}
function radBarrel(scene, x, z) {
  part(scene, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), 0xc8a020, x, 0.45, z, { metalness: 0.4, roughness: 0.6 });
  for (const y of [0.15, 0.75]) part(scene, new THREE.CylinderGeometry(0.31, 0.31, 0.04, 10), 0x6a5a10, x, y, z);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), plantMats().sign); s.position.set(x, 0.5, z + 0.305); scene.add(s);
  addBox(x, z, 0.32, 0.32, 0.9);
}
function controlPanel(scene, E, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  part(g, box(1.6, 1.0, 0.6), 0x4a5a5a, 0, 0.5, 0, { metalness: 0.4 });
  part(g, box(1.6, 0.7, 0.15), 0x3a4848, 0, 1.3, -0.22, { metalness: 0.4 }).rotation.x = -0.3;
  const leds = [];
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), new THREE.MeshBasicMaterial({ color: [0xff3020, 0x30ff60, 0xffb020][k % 3] }));
    m.position.set(-0.6 + k * 0.24, 1.35, -0.13); m.rotation.x = -0.3; g.add(m); leds.push(m);
  }
  for (let k = 0; k < 3; k++) part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), 0x1a1a1a, -0.4 + k * 0.4, 1.02, 0.1);
  scene.add(g); E.leds.push(...leds);
  const hx = Math.abs(Math.sin(ry)) > 0.5 ? 0.35 : 0.8, hz = Math.abs(Math.sin(ry)) > 0.5 ? 0.8 : 0.35;
  addBox(x, z, hx, hz, 1.4);
}
function coolingTower(scene, x, z, s) {
  const pts = [];
  for (let k = 0; k <= 12; k++) { const y = k / 12; pts.push(new THREE.Vector2((1 - 0.42 * Math.sin(Math.PI * y * 0.9)) * 14 * s, y * 46 * s)); }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), plantMats().tower); m.position.set(x, 0, z); scene.add(m);
}

export function buildPlant(E, r) {
  Object.assign(MAP, { N: 21, T: 3.2, boxes: [], lightsLeft: S.lights });
  const { N, T } = MAP, scene = E.scene, M = plantMats(), RN = 4;
  E.leds = []; E.alarms = [];
  const g = Array.from({ length: N }, () => Array(N).fill(0));
  const R0 = k => 1 + k * 5; // first tile of room k
  for (let a = 0; a < RN; a++) for (let b = 0; b < RN; b++) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g[R0(a) + i][R0(b) + j] = 1;
  // doors: a random spanning tree over the rooms, plus a few extra loops
  const door = (a, b, c, d) => {
    if (a !== c) { const i = R0(Math.min(a, c)) + 4, j = R0(b) + (r() * 4 | 0); g[i][j] = 1; if (r() < 0.4 && j + 1 <= R0(b) + 3) g[i][j + 1] = 1; }
    else { const j = R0(Math.min(b, d)) + 4, i = R0(a) + (r() * 4 | 0); g[i][j] = 1; if (r() < 0.4 && i + 1 <= R0(a) + 3) g[i + 1][j] = 1; }
  };
  const seenR = new Set(['0,0']), st = [[0, 0]];
  while (st.length) {
    const [a, b] = st[st.length - 1];
    const nb = DIRS.map(([x, y]) => [a + x, b + y]).filter(([x, y]) => x >= 0 && y >= 0 && x < RN && y < RN && !seenR.has(`${x},${y}`));
    if (!nb.length) { st.pop(); continue; }
    const [c, d] = nb[r() * nb.length | 0];
    door(a, b, c, d); seenR.add(`${c},${d}`); st.push([c, d]);
  }
  for (let k = 0; k < 4; k++) { const a = r() * (RN - 1) | 0, b = r() * RN | 0; r() < 0.5 ? door(a, b, a + 1, b) : door(b, a, b, a + 1); }
  // the reactor hall: the two bottom-right rooms become one big hall
  for (let j = R0(3); j < R0(3) + 4; j++) g[R0(2) + 4][j] = 1;
  MAP.grid = g;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(N * T + 80, N * T + 80), groundMat('#3a3c3a', ['#323432', '#444644', '#2a2c2a', '#3a4a3a'], (N * T + 80) / 3));
  ground.rotation.x = -Math.PI / 2; ground.position.set((N - 1) * T / 2, 0, (N - 1) * T / 2); ground.receiveShadow = true;
  scene.add(ground);
  const openTiles = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (open(i, j)) { openTiles.push([i, j]); continue; }
    let edge = false;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (open(i + a, j + b)) edge = true;
    if (!edge) continue;
    const h = 6.5 + ((i * 7 + j * 3) % 3) * 0.5, m = new THREE.Mesh(unitBox, M.wall);
    m.scale.set(T, h, T); m.position.set(i * T, h / 2, j * T); scene.add(m);
  }
  // the outside: cooling towers and the far city
  coolingTower(scene, -38, 28, 1); coolingTower(scene, 30, -36, 0.85); coolingTower(scene, 95, 40, 1.1);
  for (let k = 0; k < 10; k++) {
    const h = 10 + r() * 25, w = 8 + r() * 12, a = r() * Math.PI * 2, d = N * T * 0.9 + 40 + r() * 30;
    const m = new THREE.Mesh(unitBox, buildingMats()[k % 5]); m.scale.set(w, h, w);
    m.position.set((N - 1) * T / 2 + Math.cos(a) * d, h / 2, (N - 1) * T / 2 + Math.sin(a) * d); scene.add(m);
  }
  // the reactor: a big round vessel with a glowing core and the fuel rod on a cart next to it
  const rx = (R0(2) + 4) * T, rz = (R0(3) + 1.5) * T;
  const core = new THREE.Group(); core.position.set(rx, 0, rz); scene.add(core);
  part(core, new THREE.CylinderGeometry(2.4, 2.6, 1.2, 20), 0x5a5e62, 0, 0.6, 0, { metalness: 0.5 });
  part(core, new THREE.CylinderGeometry(1.8, 1.8, 3.6, 20, 1, true), 0x6a6e72, 0, 3, 0, { metalness: 0.6, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 20), new THREE.MeshBasicMaterial({ color: 0x40d0ff }));
  glow.position.y = 1.25; core.add(glow);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; part(core, box(0.25, 5, 0.25), 0x3a3e42, Math.cos(a) * 2.2, 2.5, Math.sin(a) * 2.2, { metalness: 0.6 }); }
  addBox(rx, rz, 2.5, 2.5, 4);
  const coreLight = light(scene, 0x40d0ff, 30, 16, rx, 2.5, rz);
  E.reactor = { x: rx, z: rz, glow, light: coreLight };
  E.rodAt = { x: rx, z: rz + 3.4 };
  part(scene, box(1.2, 0.5, 0.6), 0x3a3e44, E.rodAt.x, 0.25, E.rodAt.z, { metalness: 0.6 }); // the cart
  addBox(E.rodAt.x, E.rodAt.z, 0.6, 0.3, 0.5);
  // alarm lights (off until the meltdown) in the yard, the middle and the reactor hall
  for (const [i, j] of [[2.5, 2.5], [R0(1) + 1.5, R0(2) + 1.5], [R0(3) + 1.5, R0(3) + 2]]) {
    part(scene, box(0.3, 0.2, 0.3), 0x8a1010, i * T, 5.5, j * T, { emissive: 0x200000 });
    const l = light(scene, 0xff2010, 0, 26, i * T, 5.2, j * T); if (l) E.alarms.push(l);
  }
  const dist = ([i, j]) => Math.abs(i - 2) + Math.abs(j - 2);
  const shuffle = a => a.map(v => [r(), v]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  const used = new Set();
  for (const t of openTiles) if (Math.hypot(t[0] * T - rx, t[1] * T - rz) < 4.5 || Math.hypot(t[0] * T - E.rodAt.x, t[1] * T - E.rodAt.z) < 1.8) used.add(t.join());
  const spots = shuffle(openTiles.filter(t => dist(t) > 4));
  let si = 0;
  const take = () => { while (si < spots.length && used.has(spots[si].join())) si++; const t = spots[si++] || [10, 10]; used.add(t.join()); return t; };
  const wallSide = ([i, j]) => DIRS.filter(([a, b]) => !open(i + a, j + b));
  // lockers against walls (hiding spots), locked crates, big objects
  for (let k = 0; k < 8; k++) {
    const t = take(), w = wallSide(t), [a, b] = w.length ? w[r() * w.length | 0] : [1, 0];
    hideSpot(scene, E, t[0] * T + a * 1.2, t[1] * T + b * 1.2, Math.atan2(-a, -b), 'locker');
  }
  hideSpot(scene, E, 4 * T - 0.4, 3.2 * T, Math.PI / 2, 'dumpster');
  for (let k = 0; k < 3; k++) { const [i, j] = take(); lockedCrate(scene, E, i * T, j * T, k); }
  E.bigSpots = [];
  for (const id of ['generator', 'generator', 'acunit']) { const [i, j] = take(); E.bigSpots.push({ id, x: i * T, z: j * T, ry: r() * 6.28 }); }
  // props: control panels, radioactive barrels, glowing puddles, pipes, fallen beams, emergency lamps
  let lampsPlaced = 0;
  for (const t of shuffle(openTiles)) {
    const [i, j] = t, rr = r();
    if (dist(t) <= 4 || used.has(t.join())) continue;
    const w = wallSide(t);
    if (!w.length) { if (rr < 0.06) { const p = new THREE.Mesh(new THREE.CircleGeometry(0.6 + r() * 0.5, 14), M.goo); p.rotation.x = -Math.PI / 2; p.position.set(i * T + (r() - 0.5), 0.02, j * T + (r() - 0.5)); scene.add(p); } continue; }
    const [a, b] = w[r() * w.length | 0], x = i * T + a * 1.05, z = j * T + b * 1.05;
    if (rr < 0.1) { controlPanel(scene, E, i * T + a * 1.15, j * T + b * 1.15, Math.atan2(-a, -b)); used.add(t.join()); }
    else if (rr < 0.22) { radBarrel(scene, x, z); if (r() < 0.5) radBarrel(scene, x + (b ? 0.7 : 0), z + (a ? 0.7 : 0)); }
    else if (rr < 0.32) part(scene, new THREE.CylinderGeometry(0.22, 0.22, T, 10), [0x8a3a2a, 0x3a5a8a, 0x8a8a8a][r() * 3 | 0], i * T + a * 1.4, 3.6 + r() * 1.5, j * T + b * 1.4, { metalness: 0.5 }).rotation[a ? 'x' : 'z'] = Math.PI / 2;
    else if (rr < 0.36) { const beam = part(scene, box(0.3, 0.4, 4), 0x5a4a3a, i * T, 1.2, j * T, { metalness: 0.4 }); beam.rotation.set(0.5, r() * 3, 0); addBox(i * T, j * T, 0.5, 0.5, 1); }
    else if (rr < 0.46 && lampsPlaced < 5 && E.ev.id !== 'blackout') { lampsPlaced++; lamp(scene, E, i * T + a * 1.55, j * T + b * 1.55, a, b, r); }
  }
  // loot: more and better further in
  const lootTiles = shuffle(openTiles.filter(t => dist(t) > 4 && !used.has(t.join())));
  E.lootSpots = lootTiles.slice(0, 18 + Math.round(E.skulls * 3)).map(([i, j]) => ({ x: i * T + (r() - 0.5) * 1.4, z: j * T + (r() - 0.5) * 1.4, boost: dist([i, j]) > 22 ? 0.35 : dist([i, j]) > 14 ? 0.15 : 0 }));
  const roomCenters = [];
  for (let a = 0; a < RN; a++) for (let b = 0; b < RN; b++) if (a + b > 1) roomCenters.push([(R0(a) + 1.5) * T, (R0(b) + 1.5) * T]);
  E.enemySpots = { rooms: shuffle(roomCenters), reactor: [rx - 3.5, rz + 2] };
  E.spawn = { x: 2 * T, z: 2.6 * T, ry: -3 * Math.PI / 4 };
  E.truckAt = { x: 2 * T, z: 1 * T, ry: Math.PI / 2 };
}

export const LOOT_TABLES = {
  alley: {
    common: ['teddy', 'gnome', 'vinyl', 'toaster', 'lamp', 'radio', 'kettle', 'iron', 'comic', 'coin', 'harmonica', 'cartridge', 'globe', 'hammer', 'fan'],
    uncommon: ['watch', 'drill', 'camera', 'walkman', 'headphones', 'phone', 'blender', 'clock', 'card', 'doll', 'vhs', 'toolbox', 'stamps'],
    rare: ['ring', 'console', 'guitar', 'vase', 'laptop', 'necklace', 'earrings', 'typewriter', 'trumpet', 'candelabra', 'knife', 'violin'],
  },
  junkyard: {
    common: ['scrap', 'hubcap', 'plugs', 'copper', 'hammer', 'wrenchset', 'headlight', 'iron', 'fan', 'crt', 'scrap'],
    uncommon: ['carbattery', 'alternator', 'exhaust', 'wheel', 'radiator', 'tank', 'seat', 'drill', 'toolbox', 'mask', 'chainsaw', 'vhs'],
    rare: ['engine', 'gramophone', 'worldglobe', 'pocketwatch', 'chain', 'sword', 'revolver_i', 'shotgun_i', 'typewriter', 'painting'],
  },
  plant: {
    common: ['copper', 'copper', 'scrap', 'plugs', 'crt', 'fan', 'radio', 'hammer', 'wrenchset', 'headphones', 'toolbox'],
    uncommon: ['drill', 'camera', 'walkman', 'phone', 'carbattery', 'alternator', 'clock', 'mask', 'chainsaw', 'typewriter'],
    rare: ['laptop', 'console', 'pocketwatch', 'worldglobe', 'engine', 'revolver_i', 'gramophone', 'shotgun_i'],
  },
};
