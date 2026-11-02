import * as THREE from 'three';
import { pick, rand } from './state.js';
import { canvasTex } from './data.js';
import { makePerson, animatePerson } from './people.js';
import { S } from './settings.js';

// The street outside Chucky's House. A view only: you see it through the window, the door and over the
// yard fence, but you can never walk out there. City materials light themselves (emissive = day light),
// so the "sun" never leaks into the shop. At night only the lit windows, lamps and headlights glow.
const CITY = { mats: [], winMats: [], cars: [], peds: [], lamps: [], day: 1, night: false, sky: null };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const DETAIL = { low: { cars: 3, peds: 0, far: 10 }, medium: { cars: 6, peds: 4, far: 18 }, high: { cars: 10, peds: 8, far: 30 } };
const NIGHT_SKY = new THREE.Color(0x070a14), DAY_SKY = new THREE.Color(0x9cc0e0), DUSK_SKY = new THREE.Color(0xe08a5a);

function cmat(color, map) {
  const m = new THREE.MeshStandardMaterial({ color, map: map || null, roughness: 0.9, emissive: map ? 0xffffff : color, emissiveMap: map || null, emissiveIntensity: 1 });
  m.userData.base = new THREE.Color(color);
  CITY.mats.push(m);
  return m;
}
function add(scene, geo, m, x, y, z, ry = 0) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.raycast = () => {};
  scene.add(o); return o;
}

// Facade: day texture + a lit-windows texture swapped in at night.
function facade(wallColor, cols, rows, shop) {
  const draw = night => (g, w, h) => {
    g.fillStyle = night ? '#000' : wallColor; g.fillRect(0, 0, w, h);
    if (!night) { g.fillStyle = '#0002'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); }
    const cw = w / cols, rh = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (shop && r === rows - 1) continue;
      const lit = Math.random() < 0.35;
      g.fillStyle = night ? (lit ? pick(['#ffcf7a', '#ffe8b0', '#9fd0ff']) : '#000') : '#26323e';
      g.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.2, cw * 0.56, rh * 0.55);
      if (!night) { g.fillStyle = '#ffffff22'; g.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.2, cw * 0.18, rh * 0.55); g.fillStyle = '#0004'; g.fillRect(c * cw + cw * 0.18, r * rh + rh * 0.75, cw * 0.64, 2); }
    }
    if (shop) {
      g.fillStyle = night ? '#ffd890' : '#2a3a4a'; g.fillRect(w * 0.08, h - rh * 0.85, w * 0.84, rh * 0.75);
      if (!night) { g.fillStyle = '#ffffff30'; g.fillRect(w * 0.08, h - rh * 0.85, w * 0.2, rh * 0.75); }
    }
  };
  const day = canvasTex(128, 128, draw(false)), night = canvasTex(128, 128, draw(true));
  const m = new THREE.MeshStandardMaterial({ map: day, emissive: 0xffffff, emissiveMap: day, roughness: 0.9 });
  m.userData = { day, night };
  CITY.winMats.push(m);
  return m;
}

function building(scene, x, z, w, d, h, front, shopFront) {
  const wallC = pick(['#7a4a3a', '#6a5a4a', '#5a5a62', '#8a6a4a', '#4a4a52', '#9a8a6a', '#6a3a3a', '#5a6a6a']);
  const rows = Math.max(2, Math.round(h / 3)), cols = Math.max(2, Math.round(w / 2.5));
  const fm = facade(wallC, cols, rows, shopFront);
  const sideM = cmat(new THREE.Color(wallC).multiplyScalar(0.8).getHex());
  const mats = [sideM, sideM, cmat(0x3a3a3a), sideM, sideM, sideM];
  mats[front === 1 ? 4 : 5] = fm;
  const b = new THREE.Mesh(box(w, h, d), mats); b.position.set(x, h / 2, z); b.raycast = () => {};
  scene.add(b);
  add(scene, box(w + 0.3, 0.4, d + 0.3), cmat(0x2a2a2a), x, h + 0.2, z); // cornice
  if (Math.random() < 0.35) add(scene, new THREE.CylinderGeometry(0.8, 0.8, 1.6, 10), cmat(0x6a4a2a), x + rand(-w / 4, w / 4), h + 1.2, z); // water tank
  if (shopFront && Math.random() < 0.8) {
    const aw = add(scene, box(w * 0.85, 0.12, 1.4), cmat(pick([0xb02a2a, 0x2a6a3a, 0x2a4a8a, 0xd8a020, 0x6a2a6a])), x, 3.1, z + front * (d / 2 + 0.6));
    aw.rotation.x = front * 0.25;
  }
  return b;
}

function streetLamp(scene, x, z, face, real) {
  const pole = cmat(0x2a2e33);
  add(scene, new THREE.CylinderGeometry(0.07, 0.09, 4.5, 8), pole, x, 2.25, z);
  add(scene, box(0.08, 0.08, 1.2), pole, x, 4.45, z + face * 0.55);
  const head = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd890, emissiveIntensity: 0 });
  add(scene, box(0.45, 0.14, 0.3), head, x, 4.38, z + face * 1.1);
  let light = null;
  if (real) { light = new THREE.PointLight(0xffc977, 0, 14); light.position.set(x, 4.2, z + face * 1.1); scene.add(light); }
  CITY.lamps.push({ head, light });
}

function makeCar() {
  const g = new THREE.Group();
  const c = pick([0xb02a2a, 0x2a4a8a, 0xd8d8d8, 0x1a1a1a, 0x2a6a3a, 0xd8a020, 0x6a6a72, 0xe0e0d0]);
  const bm = cmat(c), dark = cmat(0x161616), glass = cmat(0x1a2a3a);
  const van = Math.random() < 0.25;
  add(g, box(4.2, 0.7, 1.8), bm, 0, 0.62, 0);
  add(g, box(van ? 3.6 : 2.3, van ? 1.1 : 0.62, 1.7), bm, van ? -0.2 : -0.2, van ? 1.5 : 1.27, 0);
  add(g, box(van ? 0.05 : 0.05, 0.5, 1.6), glass, van ? 1.6 : 0.97, van ? 1.6 : 1.27, 0).rotation.z = van ? 0 : -0.5;
  for (const s of [-1, 1]) add(g, box(van ? 3.2 : 1.9, 0.42, 0.04), glass, -0.2, van ? 1.6 : 1.3, s * 0.86);
  for (const x of [-1.35, 1.35]) for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12), dark, x, 0.36, s * 0.86).rotation.x = Math.PI / 2;
  const hl = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 1 });
  const tl = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff2020, emissiveIntensity: 1 });
  for (const s of [-0.6, 0.6]) { add(g, box(0.05, 0.16, 0.34), hl, 2.11, 0.75, s); add(g, box(0.05, 0.14, 0.3), tl, -2.11, 0.75, s); }
  g.userData.lights = [hl, tl];
  return g;
}

export function buildCity(scene) {
  const D = DETAIL[S.city] || DETAIL.medium;
  CITY.scene = scene;
  // ground: sidewalk (our side) z 5.1..8.2, road 8.2..16, far sidewalk 16..19
  const swTex = canvasTex(64, 64, (g, w) => { g.fillStyle = '#8a8a86'; g.fillRect(0, 0, w, w); g.fillStyle = '#6a6a66'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, w); for (let i = 0; i < 80; i++) { g.fillStyle = '#0001'; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); } }, [60, 2]);
  const roadTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#2c2e32'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = pick(['#25272a', '#34373b', '#1f2124']); g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#e8d070'; g.fillRect(0, h / 2 - 1, w * 0.6, 2);
  }, [30, 1]);
  const flat = (w, d, m, x, y, z) => { const o = add(scene, new THREE.PlaneGeometry(w, d), m, x, y, z); o.rotation.x = -Math.PI / 2; o.receiveShadow = true; };
  flat(140, 3.1, cmat(0xffffff, swTex), 0, 0.01, 6.65);
  flat(140, 7.8, cmat(0xffffff, roadTex), 0, -0.04, 12.1);
  flat(140, 3, cmat(0xffffff, swTex), 0, 0.01, 17.5);
  add(scene, box(140, 0.16, 0.2), cmat(0x9a9a96), 0, 0.0, 8.2);
  add(scene, box(140, 0.16, 0.2), cmat(0x9a9a96), 0, 0.0, 16);
  // crosswalk
  for (let k = 0; k < 8; k++) flat(0.5, 6, cmat(0xe8e8e0), -10 + k * 0.9, -0.03, 12.1);
  flat(400, 400, cmat(0x24262a), 0, -0.06, 0);

  // shop facade (seen from the street) + neighbours on our side
  const brick = facade('#7a3a2a', 4, 2, false);
  const fac = new THREE.Mesh(box(14.2, 3.4, 0.3), [cmat(0x5a2a1a), cmat(0x5a2a1a), cmat(0x3a3a3a), cmat(0x5a2a1a), cmat(0x6a2a1a), cmat(0x6a2a1a)]);
  fac.position.set(0, 4.9, 5.15); fac.raycast = () => {}; scene.add(fac);
  add(scene, box(14.4, 0.3, 0.6), cmat(0x2a1a10), 0, 3.25, 5.4);
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshBasicMaterial({
    map: canvasTex(256, 56, g => {
      g.fillStyle = '#120808'; g.fillRect(0, 0, 256, 56);
      g.font = 'bold 34px Impact'; g.textAlign = 'center'; g.fillStyle = '#ff3b2f';
      g.shadowColor = '#ff3b2f'; g.shadowBlur = 12; g.fillText("CHUCKY'S HOUSE", 128, 40);
    }),
  }));
  neon.position.set(0, 4.4, 5.32); scene.add(neon);
  add(scene, box(3.4, 0.12, 1.3), cmat(0x8a1a1a), 2.85, 2.75, 5.75).rotation.x = 0.25;
  void brick;
  let x = -7.2;
  while (x > -70) { const w = rand(6, 11); building(scene, x - w / 2, -2, w, 14, rand(7, 16), 1, true); x -= w; }
  x = 7.2;
  while (x < 70) { const w = rand(6, 11); building(scene, x + w / 2, -2, w, 14, rand(7, 16), 1, true); x += w; }
  // across the street
  x = -70;
  while (x < 70) { const w = rand(6, 12); building(scene, x + w / 2, 25, w, 12, rand(8, 22), -1, true); x += w; }
  // behind the yard and the workshop
  for (let k = 0; k < 6; k++) building(scene, -20 + k * 8, -24, 7.5, 10, rand(8, 18), 1, false);
  // skyline
  for (let k = 0; k < D.far; k++) {
    const h = rand(20, 60), w = rand(8, 16);
    building(scene, rand(-120, 120), pick([rand(60, 110), rand(-110, -50)]), w, w, h, Math.random() < 0.5 ? 1 : -1, false);
  }
  // lamps, bus stop, hydrant, bins
  for (let lx = -36; lx <= 36; lx += 12) { streetLamp(scene, lx, 7.8, 1, Math.abs(lx) <= 12); streetLamp(scene, lx + 6, 16.4, -1, false); }
  add(scene, new THREE.CylinderGeometry(0.15, 0.18, 0.7, 8), cmat(0xc02a2a), -3, 0.35, 7.6);
  add(scene, new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10), cmat(0x3a5a3a), 8.5, 0.45, 7.7);
  add(scene, box(3.5, 0.08, 1.4), cmat(0x3a4a5a), -14, 2.6, 17.4);
  add(scene, box(3.4, 2.4, 0.05), cmat(0x6a8aaa), -14, 1.3, 18);
  add(scene, box(3, 0.1, 0.5), cmat(0x5a3a22), -14, 0.5, 17.6);
  // parked cars
  for (const [px, pz, r] of [[-9, 9.3, 0], [6.5, 9.3, 0], [18, 9.3, 0], [-22, 15, Math.PI], [11, 15, Math.PI]]) {
    const c = makeCar(); c.position.set(px, 0, pz); c.rotation.y = r; scene.add(c);
  }
  // traffic + pedestrians
  for (let k = 0; k < D.cars; k++) {
    const c = makeCar(), dir = k % 2 ? 1 : -1;
    c.position.set(rand(-60, 60), 0, dir > 0 ? 10.2 : 13.9); c.rotation.y = dir > 0 ? 0 : Math.PI;
    scene.add(c);
    CITY.cars.push({ g: c, dir, speed: rand(7, 13) });
  }
  for (let k = 0; k < D.peds; k++) {
    const p = makePerson(), dir = Math.random() < 0.5 ? 1 : -1;
    p.position.set(rand(-40, 40), 0, Math.random() < 0.5 ? 17.3 : 7.4); p.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.traverse(o => { o.raycast = () => {}; });
    scene.add(p);
    CITY.peds.push({ g: p, dir, speed: rand(1.1, 1.6), t: Math.random() * 10 });
  }
  CITY.sky = scene;
}

// day: 0 = night, 1 = full daylight
export function updateCity(dt, day) {
  if (!CITY.scene) return;
  CITY.day += (day - CITY.day) * Math.min(1, dt * 0.5);
  const d = CITY.day, night = d < 0.35;
  const sky = d < 0.5 ? NIGHT_SKY.clone().lerp(DUSK_SKY, d * 1.4) : DUSK_SKY.clone().lerp(DAY_SKY, (d - 0.5) * 2);
  CITY.scene.background = sky;
  CITY.scene.fog?.color.copy(sky);
  const k = 0.06 + d * 0.8;
  for (const m of CITY.mats) m.emissiveIntensity = k;
  if (night !== CITY.night) {
    CITY.night = night;
    for (const m of CITY.winMats) { m.emissiveMap = night ? m.userData.night : m.userData.day; m.needsUpdate = true; }
  }
  for (const m of CITY.winMats) m.emissiveIntensity = night ? 0.9 : k;
  for (const l of CITY.lamps) { l.head.emissiveIntensity = night ? 1.2 : 0; if (l.light) l.light.intensity = night ? 18 : 0; }
  for (const c of CITY.cars) {
    c.g.position.x += c.dir * c.speed * dt;
    if (c.g.position.x > 70) c.g.position.x = -70;
    if (c.g.position.x < -70) c.g.position.x = 70;
    for (const l of c.g.userData.lights) l.emissiveIntensity = night ? 2 : 0.3;
  }
  for (const p of CITY.peds) {
    p.g.position.x += p.dir * p.speed * dt;
    if (Math.abs(p.g.position.x) > 45) p.g.position.x = -p.dir * 45;
    p.t += dt * p.speed * 5;
    animatePerson(p.g, p.t, true);
  }
}
