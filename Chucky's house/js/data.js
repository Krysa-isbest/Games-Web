import * as THREE from 'three';
import { newUid, rand } from './state.js';

const mats = {};
export function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  return mats[k] ??= new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, ...o });
}

export function part(g, geo, color, x, y, z, o) {
  const m = new THREE.Mesh(geo, mat(color, o));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

// Invisible material for interaction hitboxes.
export const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const GOLD = { metalness: 0.8, roughness: 0.3 };
const STEEL = { metalness: 0.75, roughness: 0.35 };
const GLASS = { roughness: 0.05, metalness: 0.2 };
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const S = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const T = (r, t, rs = 6, ts = 14, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const flat = m => { m.rotation.x = Math.PI / 2; return m; };
const side = m => { m.rotation.z = Math.PI / 2; return m; };
const lathe = (pts, s = 10) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), s);
const wheel = (g, r, w, x, y, z, rim = 0x999999) => {
  side(part(g, C(r, r, w, 14), 0x161616, x, y, z, { roughness: 0.9 }));
  side(part(g, C(r * 0.55, r * 0.55, w + 0.01, 10), rim, x, y, z, STEEL));
};

// cat: house collect jewel elec tool music antique weapon car big food scrap
// range: the daily price is rolled inside it. size: bag slots. big: too large for a bag (carry or dismantle).
export const ITEMS = [
  // ---------- household ----------
  { id: 'toaster', name: 'Retro Toaster', icon: '🍞', cat: 'house', range: [25, 45], build(g) {
    part(g, B(0.28, 0.18, 0.16), 0xd8dde2, 0, 0.1, 0, STEEL);
    part(g, B(0.2, 0.01, 0.03), 0x111111, 0, 0.195, -0.035); part(g, B(0.2, 0.01, 0.03), 0x111111, 0, 0.195, 0.035);
    part(g, B(0.03, 0.03, 0.04), 0x222222, 0.15, 0.12, 0);
  } },
  { id: 'lamp', name: 'Table Lamp', icon: '💡', cat: 'house', range: [30, 55], build(g) {
    part(g, C(0.08, 0.1, 0.03), 0x6b4a2a, 0, 0.015, 0);
    part(g, C(0.012, 0.012, 0.28, 6), 0xc9a227, 0, 0.17, 0, GOLD);
    part(g, new THREE.CylinderGeometry(0.07, 0.14, 0.15, 8, 1, true), 0xf0dcb0, 0, 0.36, 0, { side: THREE.DoubleSide, emissive: 0x332200 });
  } },
  { id: 'teddy', name: 'Creepy Teddy', icon: '🧸', cat: 'house', range: [8, 20], build(g) {
    const br = 0x8a5a33;
    part(g, S(0.09), br, 0, 0.09, 0); part(g, S(0.07), br, 0, 0.22, 0);
    part(g, S(0.025, 0), br, -0.05, 0.28, 0); part(g, S(0.025, 0), br, 0.05, 0.28, 0);
    part(g, S(0.03, 0), 0xd8b48a, 0, 0.21, 0.06);
    part(g, S(0.012, 0), 0x000000, -0.025, 0.24, 0.06); part(g, B(0.02, 0.006, 0.006), 0x000000, 0.025, 0.24, 0.065);
  } },
  { id: 'gnome', name: 'Garden Gnome', icon: '🍄', cat: 'house', range: [12, 28], build(g) {
    part(g, C(0.06, 0.08, 0.14, 8), 0x2a4ab0, 0, 0.07, 0); part(g, S(0.05, 0), 0xf1c27d, 0, 0.18, 0);
    part(g, new THREE.ConeGeometry(0.05, 0.1, 8), 0xf4f4f4, 0, 0.13, 0.03).rotation.x = Math.PI;
    part(g, new THREE.ConeGeometry(0.06, 0.16, 8), 0xd02a2a, 0, 0.28, 0);
  } },
  { id: 'radio', name: 'Old Radio', icon: '📻', cat: 'house', range: [50, 85], build(g) {
    part(g, B(0.3, 0.18, 0.1), 0x7a4a2a, 0, 0.09, 0);
    flat(part(g, C(0.06, 0.06, 0.01, 12), 0x2a2018, -0.06, 0.09, 0.05));
    flat(part(g, C(0.025, 0.025, 0.02, 8), 0xe8dcc0, 0.08, 0.11, 0.05));
    part(g, B(0.08, 0.02, 0.01), 0xffd890, 0.08, 0.05, 0.051, { emissive: 0x553300 });
  } },
  { id: 'kettle', name: 'Enamel Kettle', icon: '🫖', cat: 'house', range: [15, 30], build(g) {
    part(g, lathe([[0, 0], [0.1, 0], [0.12, 0.08], [0.09, 0.17], [0.03, 0.2], [0, 0.21]]), 0x3a8a6a, 0, 0, 0, { roughness: 0.3 });
    part(g, C(0.015, 0.025, 0.12, 6), 0x3a8a6a, 0.12, 0.12, 0).rotation.z = -0.9;
    part(g, T(0.06, 0.01, 4, 10, Math.PI), 0x222222, 0, 0.21, 0);
  } },
  { id: 'clock', name: 'Wall Clock', icon: '🕰️', cat: 'house', range: [35, 70], build(g) {
    flat(part(g, C(0.16, 0.16, 0.05, 16), 0x5a3a22, 0, 0.16, 0));
    flat(part(g, C(0.13, 0.13, 0.01, 16), 0xf4efdf, 0, 0.16, 0.026));
    part(g, B(0.008, 0.09, 0.005), 0x111111, 0, 0.19, 0.034); part(g, B(0.06, 0.008, 0.005), 0x111111, 0.025, 0.16, 0.034);
  } },
  { id: 'iron', name: 'Clothes Iron', icon: '♨️', cat: 'house', range: [10, 22], build(g) {
    part(g, B(0.22, 0.04, 0.11), 0xb8bcc0, 0, 0.02, 0, STEEL);
    part(g, B(0.2, 0.06, 0.09), 0x2a6ab0, -0.01, 0.07, 0);
    part(g, B(0.12, 0.03, 0.03), 0x222222, -0.01, 0.13, 0);
  } },
  { id: 'blender', name: 'Blender', icon: '🥤', cat: 'house', range: [30, 55], build(g) {
    part(g, B(0.14, 0.1, 0.14), 0xe0e0e0, 0, 0.05, 0);
    part(g, C(0.07, 0.05, 0.22, 8), 0x9fd8ff, 0, 0.21, 0, { ...GLASS, transparent: true, opacity: 0.55 });
    part(g, C(0.075, 0.075, 0.03, 8), 0x222222, 0, 0.33, 0);
  } },
  { id: 'fan', name: 'Desk Fan', icon: '🌀', cat: 'house', range: [25, 45], build(g) {
    part(g, C(0.09, 0.1, 0.03, 10), 0x2a5a8a, 0, 0.015, 0); part(g, C(0.015, 0.015, 0.2, 6), 0xcccccc, 0, 0.12, 0, STEEL);
    flat(part(g, T(0.12, 0.008, 4, 18), 0xcccccc, 0, 0.32, 0, STEEL)).rotation.x = 0;
    for (let k = 0; k < 3; k++) part(g, B(0.1, 0.04, 0.005), 0x5aa0d8, Math.cos(k * 2.1) * 0.05, 0.32 + Math.sin(k * 2.1) * 0.05, 0).rotation.z = k * 2.1;
  } },
  { id: 'typewriter', name: 'Typewriter', icon: '⌨️', cat: 'antique', range: [90, 160], build(g) {
    part(g, B(0.34, 0.1, 0.26), 0x1d1d1d, 0, 0.05, 0, { roughness: 0.3 });
    part(g, B(0.3, 0.04, 0.12), 0x111111, 0, 0.11, 0.06).rotation.x = -0.35;
    side(part(g, C(0.03, 0.03, 0.38, 10), 0x2a2a2a, 0, 0.15, -0.08));
    part(g, B(0.2, 0.14, 0.005), 0xf4f1e6, 0, 0.23, -0.09);
  } },
  // ---------- collectibles ----------
  { id: 'coin', name: 'Old Coin', icon: '🪙', cat: 'collect', range: [8, 12], build(g) {
    part(g, B(0.1, 0.02, 0.1), 0x4a2a1a, 0, 0.01, 0);
    part(g, C(0.035, 0.035, 0.008, 14), 0xc9a24a, 0, 0.026, 0, GOLD);
  } },
  { id: 'stamps', name: 'Stamp Album', icon: '📔', cat: 'collect', range: [40, 90], build(g) {
    part(g, B(0.24, 0.05, 0.3), 0x2a3a6a, 0, 0.025, 0); part(g, B(0.22, 0.04, 0.29), 0xf2ead2, 0.005, 0.025, 0);
    part(g, B(0.08, 0.002, 0.1), 0xc9a227, 0, 0.051, 0, GOLD);
  } },
  { id: 'comic', name: 'Comic Book', icon: '📚', cat: 'collect', range: [15, 60], build(g) {
    part(g, B(0.18, 0.012, 0.26), 0xe8d040, 0, 0.006, 0);
    part(g, B(0.1, 0.002, 0.1), 0xd0302a, 0, 0.013, 0.03); part(g, B(0.16, 0.002, 0.04), 0x2a4ad0, 0, 0.013, -0.09);
  } },
  { id: 'vinyl', name: 'Vinyl Record', icon: '💿', cat: 'collect', range: [18, 35], build(g) {
    part(g, B(0.3, 0.3, 0.02), 0xd04a2a, 0, 0.15, 0);
    flat(part(g, C(0.14, 0.14, 0.01, 20), 0x111111, 0.05, 0.17, -0.012));
  } },
  { id: 'card', name: 'Baseball Card', icon: '🃏', cat: 'collect', range: [5, 80], build(g) {
    part(g, B(0.1, 0.14, 0.012), 0x9fd8ff, 0, 0.07, 0, { transparent: true, opacity: 0.6 });
    part(g, B(0.075, 0.11, 0.004), 0xf4f1e6, 0, 0.07, 0); part(g, B(0.05, 0.05, 0.005), 0x2a6ad0, 0, 0.085, 0.001);
  } },
  { id: 'doll', name: 'Porcelain Doll', icon: '🎎', cat: 'collect', range: [30, 70], build(g) {
    part(g, C(0.04, 0.1, 0.18, 10), 0x9a2a4a, 0, 0.09, 0); part(g, S(0.05), 0xf6e6dc, 0, 0.23, 0, { roughness: 0.2 });
    part(g, S(0.055), 0xd8b040, 0, 0.25, -0.012).scale.set(1, 0.9, 0.9);
    for (const x of [-0.018, 0.018]) part(g, S(0.007, 0), 0x2a4ab0, x, 0.235, 0.046);
  } },
  { id: 'globe', name: 'Snow Globe', icon: '🔮', cat: 'collect', range: [6, 15], build(g) {
    part(g, C(0.07, 0.08, 0.05, 10), 0x4a2a1a, 0, 0.025, 0);
    part(g, S(0.07, 2), 0xcfeaff, 0, 0.11, 0, { ...GLASS, transparent: true, opacity: 0.4 });
    part(g, new THREE.ConeGeometry(0.03, 0.06, 6), 0x2a6a3a, 0, 0.09, 0);
  } },
  // ---------- jewellery ----------
  { id: 'watch', name: 'Old Watch', icon: '⌚', cat: 'jewel', range: [60, 110], build(g) {
    part(g, B(0.2, 0.03, 0.12), 0x3a2416, 0, 0.015, 0);
    part(g, T(0.06, 0.012), 0x5a3a22, 0, 0.09, 0).rotation.y = Math.PI / 2;
    flat(part(g, C(0.05, 0.05, 0.025, 14), 0xc9a227, 0, 0.1, 0.05, GOLD));
    flat(part(g, C(0.04, 0.04, 0.01, 14), 0xf4f1e6, 0, 0.1, 0.064));
  } },
  { id: 'ring', name: 'Gold Ring', icon: '💍', cat: 'jewel', range: [240, 360], build(g) {
    part(g, B(0.14, 0.08, 0.14), 0x6b1a2a, 0, 0.04, 0);
    part(g, T(0.035, 0.01), 0xe7c04a, 0, 0.12, 0, GOLD);
    part(g, new THREE.OctahedronGeometry(0.022), 0x8fe9ff, 0, 0.165, 0, { metalness: 0.2, roughness: 0.05, emissive: 0x113344 });
  } },
  { id: 'necklace', name: 'Pearl Necklace', icon: '📿', cat: 'jewel', range: [150, 260], build(g) {
    part(g, B(0.2, 0.03, 0.16), 0x1a1a3a, 0, 0.015, 0);
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; part(g, S(0.012, 0), 0xf6f0e6, Math.cos(a) * 0.065, 0.04, Math.sin(a) * 0.05, { roughness: 0.15 }); }
  } },
  { id: 'pocketwatch', name: 'Pocket Watch', icon: '⏱️', cat: 'jewel', range: [120, 200], build(g) {
    flat(part(g, C(0.05, 0.05, 0.02, 16), 0xd8b040, 0, 0.012, 0, GOLD)).rotation.x = 0;
    part(g, C(0.042, 0.042, 0.004, 16), 0xf6f0e0, 0, 0.024, 0);
    part(g, T(0.012, 0.004, 4, 8), 0xd8b040, 0, 0.012, -0.06, GOLD).rotation.x = Math.PI / 2;
  } },
  { id: 'earrings', name: 'Silver Earrings', icon: '✨', cat: 'jewel', range: [70, 130], build(g) {
    part(g, B(0.12, 0.05, 0.08), 0x2a1a3a, 0, 0.025, 0);
    for (const x of [-0.025, 0.025]) { part(g, T(0.012, 0.003, 4, 10), 0xdfe4ea, x, 0.07, 0, STEEL); part(g, new THREE.OctahedronGeometry(0.01), 0xb0e0ff, x, 0.055, 0, GLASS); }
  } },
  { id: 'chain', name: 'Gold Chain', icon: '🔗', cat: 'jewel', range: [300, 450], build(g) {
    part(g, B(0.16, 0.025, 0.16), 0x111111, 0, 0.012, 0);
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; part(g, T(0.012, 0.004, 4, 8), 0xe7c04a, Math.cos(a) * 0.055, 0.03, Math.sin(a) * 0.055, GOLD).rotation.set(Math.PI / 2, 0, a + (k % 2) * 1.5); }
  } },
  { id: 'diamond', name: 'Diamond Ring', icon: '💎', cat: 'jewel', range: [900, 1400], build(g) {
    part(g, B(0.14, 0.08, 0.14), 0x101a3a, 0, 0.04, 0);
    part(g, T(0.035, 0.009), 0xe4e8ee, 0, 0.12, 0, STEEL);
    part(g, new THREE.OctahedronGeometry(0.03), 0xeaffff, 0, 0.17, 0, { metalness: 0.1, roughness: 0, emissive: 0x335566 });
  } },
  // ---------- electronics ----------
  { id: 'camera', name: 'Film Camera', icon: '📷', cat: 'elec', range: [120, 180], build(g) {
    part(g, B(0.22, 0.13, 0.08), 0x1c1c1c, 0, 0.065, 0);
    part(g, B(0.22, 0.03, 0.082), 0xb8bcc0, 0, 0.115, 0, STEEL);
    flat(part(g, C(0.045, 0.05, 0.07, 12), 0x2a2a2a, 0, 0.065, 0.07));
    flat(part(g, C(0.035, 0.035, 0.01, 12), 0x334466, 0, 0.065, 0.106, GLASS));
  } },
  { id: 'console', name: 'Game Console', icon: '🎮', cat: 'elec', range: [140, 220], build(g) {
    part(g, B(0.28, 0.07, 0.2), 0x2b2d33, 0, 0.035, 0);
    part(g, B(0.1, 0.012, 0.012), 0x4ad04a, -0.06, 0.05, 0.1, { emissive: 0x115511 });
    part(g, B(0.12, 0.03, 0.07), 0x3a3d45, 0.06, 0.085, 0.03);
  } },
  { id: 'phone', name: 'Smartphone', icon: '📱', cat: 'elec', range: [60, 140], build(g) {
    part(g, B(0.08, 0.012, 0.16), 0x1a1a1e, 0, 0.006, 0, { roughness: 0.2 });
    part(g, B(0.07, 0.002, 0.145), 0x0a1a2a, 0, 0.013, 0, { emissive: 0x0a2240 });
  } },
  { id: 'laptop', name: 'Laptop', icon: '💻', cat: 'elec', range: [200, 380], build(g) {
    part(g, B(0.34, 0.02, 0.24), 0x8a8e96, 0, 0.01, 0, STEEL);
    part(g, B(0.3, 0.004, 0.12), 0x222222, 0, 0.022, 0.03);
    const lid = part(g, B(0.34, 0.22, 0.012), 0x8a8e96, 0, 0.12, -0.12, STEEL); lid.rotation.x = -0.2;
    part(g, B(0.3, 0.18, 0.002), 0x1a3050, 0, 0.12, -0.112, { emissive: 0x0a1a30 }).rotation.x = -0.2;
  } },
  { id: 'headphones', name: 'Headphones', icon: '🎧', cat: 'elec', range: [40, 90], build(g) {
    part(g, T(0.09, 0.012, 6, 14, Math.PI), 0x222222, 0, 0.06, 0);
    for (const x of [-0.09, 0.09]) side(part(g, C(0.045, 0.045, 0.04, 12), 0xb02a2a, x, 0.05, 0));
  } },
  { id: 'cartridge', name: 'Game Cartridge', icon: '🕹️', cat: 'elec', range: [10, 45], build(g) {
    part(g, B(0.12, 0.13, 0.02), 0x8a8a8a, 0, 0.065, 0); part(g, B(0.09, 0.07, 0.003), 0xd04040, 0, 0.08, 0.011);
  } },
  { id: 'vhs', name: 'VHS Player', icon: '📼', cat: 'elec', range: [30, 60], build(g) {
    part(g, B(0.36, 0.08, 0.26), 0x2a2a2a, 0, 0.04, 0);
    part(g, B(0.18, 0.025, 0.005), 0x111111, -0.04, 0.05, 0.131); part(g, B(0.06, 0.015, 0.004), 0x40ff70, 0.12, 0.05, 0.131, { emissive: 0x20a040 });
  } },
  { id: 'walkman', name: 'Cassette Walkman', icon: '📟', cat: 'elec', range: [40, 90], build(g) {
    part(g, B(0.11, 0.15, 0.035), 0xd8b040, 0, 0.075, 0); part(g, B(0.08, 0.05, 0.004), 0x222222, 0, 0.09, 0.018);
  } },
  { id: 'crt', name: 'CRT Television', icon: '📺', cat: 'elec', range: [40, 90], size: 2, build(g) {
    part(g, B(0.46, 0.38, 0.4), 0x3a3530, 0, 0.19, 0);
    part(g, B(0.36, 0.28, 0.01), 0x1a2a2a, -0.03, 0.2, 0.2, { roughness: 0.1, emissive: 0x050a0a });
    for (const y of [0.25, 0.15]) flat(part(g, C(0.015, 0.015, 0.02, 8), 0x888888, 0.19, y, 0.2));
  } },
  { id: 'board', name: 'Circuit Board', icon: '🔌', cat: 'elec', range: [30, 70], build(g) {
    part(g, B(0.2, 0.01, 0.14), 0x1a6a3a, 0, 0.005, 0);
    for (let k = 0; k < 5; k++) part(g, B(0.03, 0.015, 0.02), 0x111111, -0.07 + k * 0.035, 0.017, (k % 2) * 0.04 - 0.02);
  } },
  { id: 'joystick', name: 'Arcade Joystick', icon: '🕹️', cat: 'elec', range: [25, 55], build(g) {
    part(g, B(0.16, 0.04, 0.12), 0x222222, 0, 0.02, 0); part(g, C(0.008, 0.008, 0.1, 6), 0xcccccc, 0, 0.09, 0, STEEL);
    part(g, S(0.025), 0xd02a2a, 0, 0.14, 0, { roughness: 0.2 });
  } },
  { id: 'tube', name: 'Arcade Screen', icon: '🖥️', cat: 'elec', range: [60, 120], size: 2, build(g) {
    part(g, B(0.4, 0.32, 0.3), 0x1a1a1a, 0, 0.16, 0); part(g, B(0.34, 0.26, 0.01), 0x0a1a20, 0, 0.17, 0.152, { emissive: 0x041014 });
  } },
  // ---------- tools ----------
  { id: 'drill', name: 'Power Drill', icon: '🔧', cat: 'tool', range: [70, 110], build(g) {
    part(g, B(0.09, 0.04, 0.08), 0x1a1a1a, 0, 0.02, 0); part(g, B(0.05, 0.14, 0.06), 0xf2b51d, -0.01, 0.11, 0);
    part(g, B(0.2, 0.07, 0.07), 0xf2b51d, 0.04, 0.2, 0);
    part(g, C(0.022, 0.03, 0.05, 8), 0x333333, 0.165, 0.2, 0).rotation.z = Math.PI / 2;
  } },
  { id: 'hammer', name: 'Claw Hammer', icon: '🔨', cat: 'tool', range: [8, 18], build(g) {
    part(g, B(0.3, 0.025, 0.03), 0x8a5a2a, 0, 0.015, 0); part(g, B(0.04, 0.03, 0.11), 0x555a60, 0.15, 0.02, 0, STEEL);
  } },
  { id: 'toolbox', name: 'Toolbox', icon: '🧰', cat: 'tool', range: [40, 80], build(g) {
    part(g, B(0.36, 0.16, 0.18), 0xc02a2a, 0, 0.08, 0, { metalness: 0.4 });
    part(g, B(0.2, 0.02, 0.02), 0x222222, 0, 0.2, 0); for (const x of [-0.1, 0.1]) part(g, B(0.02, 0.04, 0.02), 0x222222, x, 0.18, 0);
  } },
  { id: 'chainsaw', name: 'Chainsaw', icon: '🪚', cat: 'tool', range: [120, 200], size: 2, build(g) {
    part(g, B(0.24, 0.18, 0.14), 0xe06a1a, 0, 0.1, 0); part(g, B(0.4, 0.06, 0.02), 0xb0b4b8, 0.3, 0.08, 0, STEEL);
    part(g, T(0.06, 0.012, 4, 10, Math.PI), 0x222222, -0.02, 0.2, 0);
  } },
  { id: 'wrenchset', name: 'Wrench Set', icon: '🔩', cat: 'tool', range: [10, 25], build(g) {
    part(g, B(0.3, 0.02, 0.12), 0x2a2a2a, 0, 0.01, 0);
    for (let k = 0; k < 5; k++) part(g, B(0.22 - k * 0.02, 0.01, 0.015), 0xb8bcc0, 0, 0.025, -0.045 + k * 0.022, STEEL);
  } },
  { id: 'mask', name: 'Welding Mask', icon: '🥽', cat: 'tool', range: [30, 60], build(g) {
    part(g, S(0.12, 1), 0x2a2a2a, 0, 0.12, 0).scale.set(1, 1.2, 0.7); part(g, B(0.1, 0.04, 0.01), 0x1a3a1a, 0, 0.15, 0.08, GLASS);
  } },
  // ---------- music ----------
  { id: 'guitar', name: 'Acoustic Guitar', icon: '🎸', cat: 'music', range: [180, 260], size: 2, build(g) {
    g.scale.setScalar(0.7);
    part(g, S(0.17), 0xb5651d, 0, 0.2, 0).scale.set(1, 1.1, 0.35); part(g, S(0.13), 0xb5651d, 0, 0.43, 0).scale.set(1, 1, 0.35);
    flat(part(g, C(0.045, 0.045, 0.02, 10), 0x1a1008, 0, 0.32, 0.06));
    part(g, B(0.05, 0.42, 0.03), 0x4a2a12, 0, 0.72, 0.02); part(g, B(0.08, 0.12, 0.03), 0x2a160a, 0, 0.98, 0.02);
  } },
  { id: 'trumpet', name: 'Trumpet', icon: '🎺', cat: 'music', range: [120, 220], build(g) {
    side(part(g, C(0.012, 0.012, 0.36, 8), 0xd8b040, 0, 0.06, 0, GOLD));
    side(part(g, C(0.07, 0.012, 0.12, 12), 0xd8b040, 0.22, 0.06, 0, GOLD)).rotation.z = -Math.PI / 2;
    for (let k = 0; k < 3; k++) part(g, C(0.01, 0.01, 0.06, 6), 0xd8b040, -0.03 + k * 0.025, 0.1, 0, GOLD);
  } },
  { id: 'violin', name: 'Violin', icon: '🎻', cat: 'music', range: [250, 500], build(g) {
    part(g, S(0.09), 0x8a3a12, 0, 0.012, 0.06).scale.set(1, 0.18, 1.1); part(g, S(0.075), 0x8a3a12, 0, 0.012, -0.08).scale.set(1, 0.18, 1);
    part(g, B(0.03, 0.02, 0.24), 0x1a0a04, 0, 0.03, -0.25); part(g, B(0.015, 0.02, 0.04), 0x2a160a, 0, 0.03, -0.38);
  } },
  { id: 'harmonica', name: 'Harmonica', icon: '🎼', cat: 'music', range: [15, 35], build(g) {
    part(g, B(0.12, 0.025, 0.03), 0xc8ccd0, 0, 0.0125, 0, STEEL); part(g, B(0.11, 0.008, 0.032), 0x8a3a1a, 0, 0.0125, 0);
  } },
  // ---------- antiques ----------
  { id: 'vase', name: 'Antique Vase', icon: '🏺', cat: 'antique', range: [110, 160], build(g) {
    part(g, lathe([[0, 0], [0.06, 0], [0.085, 0.06], [0.1, 0.15], [0.07, 0.26], [0.04, 0.31], [0.06, 0.35]]), 0x2a5aa8, 0, 0, 0, { side: THREE.DoubleSide, roughness: 0.3 });
    flat(part(g, T(0.1, 0.008, 4, 12), 0xf0e8d0, 0, 0.15, 0)); flat(part(g, T(0.06, 0.008, 4, 12), 0xc9a227, 0, 0.35, 0, GOLD));
  } },
  { id: 'painting', name: 'Oil Painting', icon: '🖼️', cat: 'antique', range: [150, 600], size: 2, build(g) {
    part(g, B(0.5, 0.4, 0.04), 0xb08a3a, 0, 0.2, 0, GOLD); part(g, B(0.42, 0.32, 0.01), 0x3a6a8a, 0, 0.2, 0.02);
    part(g, B(0.42, 0.12, 0.012), 0x4a7a3a, 0, 0.1, 0.021); part(g, S(0.04, 0), 0xf0d060, 0.12, 0.3, 0.025);
  } },
  { id: 'candelabra', name: 'Candelabra', icon: '🕯️', cat: 'antique', range: [60, 120], build(g) {
    part(g, C(0.07, 0.09, 0.03, 10), 0xd8b040, 0, 0.015, 0, GOLD); part(g, C(0.012, 0.012, 0.25, 6), 0xd8b040, 0, 0.15, 0, GOLD);
    side(part(g, C(0.01, 0.01, 0.24, 6), 0xd8b040, 0, 0.24, 0, GOLD));
    for (const x of [-0.12, 0, 0.12]) { part(g, C(0.015, 0.015, 0.1, 6), 0xf4efdf, x, 0.3, 0); part(g, new THREE.ConeGeometry(0.008, 0.025, 5), 0xffb040, x, 0.365, 0, { emissive: 0xff8a20 }); }
  } },
  { id: 'worldglobe', name: 'Antique Globe', icon: '🌍', cat: 'antique', range: [50, 100], build(g) {
    part(g, C(0.06, 0.08, 0.03, 10), 0x5a3a22, 0, 0.015, 0); part(g, C(0.01, 0.01, 0.1, 6), 0x5a3a22, 0, 0.07, 0);
    part(g, S(0.11, 1), 0x3a7ab0, 0, 0.22, 0); part(g, S(0.112, 0), 0x6a9a4a, 0.01, 0.23, 0.01).scale.set(0.6, 0.8, 0.7);
  } },
  { id: 'gramophone', name: 'Gramophone', icon: '📯', cat: 'antique', range: [200, 350], size: 2, build(g) {
    part(g, B(0.3, 0.14, 0.3), 0x6a3a1a, 0, 0.07, 0); flat(part(g, C(0.12, 0.12, 0.01, 18), 0x111111, 0, 0.145, 0)).rotation.x = 0;
    part(g, C(0.18, 0.015, 0.35, 12, 1, true), 0xd8b040, 0.08, 0.38, -0.05, { ...GOLD, side: THREE.DoubleSide }).rotation.z = -0.6;
  } },
  { id: 'sword', name: 'Ceremonial Sword', icon: '⚔️', cat: 'antique', range: [180, 340], build(g) {
    part(g, B(0.7, 0.01, 0.04), 0xd0d4d8, 0.12, 0.03, 0, STEEL); part(g, B(0.03, 0.03, 0.16), 0xd8b040, -0.24, 0.03, 0, GOLD);
    part(g, B(0.14, 0.03, 0.03), 0x3a1a0a, -0.32, 0.03, 0);
  } },
  // ---------- weapons (need a permit to trade) ----------
  { id: 'knife', name: 'Hunting Knife', icon: '🔪', cat: 'weapon', weapon: true, range: [40, 80], build(g) {
    part(g, B(0.16, 0.008, 0.03), 0xd0d4d8, 0.08, 0.01, 0, STEEL); part(g, B(0.11, 0.022, 0.028), 0x4a2a12, -0.06, 0.012, 0);
  } },
  { id: 'revolver_i', name: 'Old Revolver', icon: '🔫', cat: 'weapon', weapon: true, range: [300, 500], build(g) {
    side(part(g, C(0.012, 0.012, 0.16, 8), 0x2a2a2e, 0.08, 0.06, 0, STEEL)); side(part(g, C(0.03, 0.03, 0.05, 6), 0x3a3a3e, -0.01, 0.06, 0, STEEL));
    part(g, B(0.04, 0.1, 0.03), 0x5a3a1a, -0.06, 0.03, 0).rotation.z = 0.35;
  } },
  { id: 'shotgun_i', name: 'Double-barrel Shotgun', icon: '🎯', cat: 'weapon', weapon: true, range: [350, 600], size: 2, build(g) {
    for (const z of [-0.012, 0.012]) side(part(g, C(0.012, 0.012, 0.6, 8), 0x2a2a2e, 0.2, 0.04, z, STEEL));
    part(g, B(0.4, 0.05, 0.04), 0x6a3a1a, -0.28, 0.035, 0).rotation.z = -0.08;
  } },
  // ---------- car parts & scrap (junkyard) ----------
  { id: 'hubcap', name: 'Chrome Hubcap', icon: '⚙️', cat: 'car', range: [10, 25], build(g) {
    part(g, C(0.16, 0.18, 0.04, 16), 0xd8dce0, 0, 0.02, 0, STEEL); part(g, C(0.04, 0.04, 0.05, 8), 0x888888, 0, 0.03, 0, STEEL);
  } },
  { id: 'carbattery', name: 'Car Battery', icon: '🔋', cat: 'car', range: [50, 90], size: 2, build(g) {
    part(g, B(0.28, 0.18, 0.18), 0x1a1a1a, 0, 0.09, 0); part(g, B(0.28, 0.02, 0.18), 0x2a5ab0, 0, 0.19, 0);
    for (const [x, c] of [[-0.09, 0xd02a2a], [0.09, 0x111111]]) part(g, C(0.015, 0.015, 0.03, 8), c, x, 0.21, 0);
  } },
  { id: 'alternator', name: 'Alternator', icon: '🧲', cat: 'car', range: [60, 110], build(g) {
    side(part(g, C(0.08, 0.08, 0.14, 12), 0xa8acb0, 0, 0.08, 0, STEEL)); side(part(g, C(0.04, 0.04, 0.04, 10), 0x222222, 0.09, 0.08, 0));
  } },
  { id: 'plugs', name: 'Spark Plugs', icon: '🔥', cat: 'car', range: [8, 16], build(g) {
    for (let k = 0; k < 4; k++) { part(g, C(0.01, 0.01, 0.06, 6), 0xf4f1e6, -0.045 + k * 0.03, 0.05, 0); part(g, C(0.008, 0.008, 0.03, 6), 0xaaaaaa, -0.045 + k * 0.03, 0.015, 0, STEEL); }
  } },
  { id: 'exhaust', name: 'Exhaust Pipe', icon: '💨', cat: 'car', range: [40, 80], size: 2, build(g) {
    side(part(g, C(0.04, 0.04, 0.6, 10), 0x7a7a7a, 0, 0.05, 0, STEEL)); side(part(g, C(0.07, 0.07, 0.22, 10), 0x5a5a5a, -0.15, 0.07, 0, STEEL));
  } },
  { id: 'wheel', name: 'Wheel', icon: '🛞', cat: 'car', range: [50, 90], size: 2, build(g) {
    const w = new THREE.Group(); w.rotation.x = Math.PI / 2; w.position.y = 0.06; g.add(w);
    part(w, C(0.3, 0.3, 0.12, 16), 0x161616, 0, 0, 0, { roughness: 0.9 }); part(w, C(0.18, 0.18, 0.13, 12), 0xa0a4a8, 0, 0, 0, STEEL);
  } },
  { id: 'engine', name: 'Small Engine', icon: '🏍️', cat: 'car', range: [300, 520], size: 3, build(g) {
    part(g, B(0.32, 0.26, 0.28), 0x4a4e54, 0, 0.13, 0, STEEL);
    for (let k = 0; k < 5; k++) part(g, B(0.34, 0.012, 0.3), 0x5a5e64, 0, 0.18 + k * 0.025, 0, STEEL);
    side(part(g, C(0.06, 0.06, 0.05, 10), 0x2a2a2a, 0.18, 0.1, 0));
  } },
  { id: 'tank', name: 'Fuel Tank', icon: '⛽', cat: 'car', range: [30, 60], size: 2, build(g) {
    part(g, S(0.18, 1), 0xb02020, 0, 0.12, 0, { metalness: 0.5, roughness: 0.25 }).scale.set(1.3, 0.65, 0.9);
    part(g, C(0.03, 0.03, 0.03, 8), 0xcccccc, 0.05, 0.24, 0, STEEL);
  } },
  { id: 'seat', name: 'Motorbike Seat', icon: '🪑', cat: 'car', range: [25, 50], size: 2, build(g) {
    part(g, B(0.5, 0.06, 0.22), 0x2a2a2a, 0, 0.03, 0); part(g, S(0.2, 1), 0x111111, 0, 0.07, 0, { roughness: 0.4 }).scale.set(1.3, 0.25, 0.55);
  } },
  { id: 'headlight', name: 'Headlight', icon: '🔦', cat: 'car', range: [20, 45], build(g) {
    flat(part(g, C(0.1, 0.07, 0.08, 14), 0x8a8e94, 0, 0.1, 0, STEEL)).rotation.x = Math.PI / 2;
    g.children[0].position.y = 0.1;
    flat(part(g, C(0.09, 0.09, 0.01, 14), 0xeaf6ff, 0, 0.1, 0.045, GLASS));
  } },
  { id: 'radiator', name: 'Radiator', icon: '🌡️', cat: 'car', range: [50, 90], size: 2, build(g) {
    part(g, B(0.5, 0.36, 0.05), 0x6a6e74, 0, 0.18, 0, STEEL);
    for (let k = 0; k < 8; k++) part(g, B(0.005, 0.3, 0.052), 0x3a3e44, -0.21 + k * 0.06, 0.18, 0);
  } },
  { id: 'copper', name: 'Copper Wire', icon: '🧶', cat: 'scrap', range: [25, 60], build(g) {
    part(g, T(0.08, 0.035, 6, 14), 0xc87a3a, 0, 0.045, 0, { metalness: 0.8, roughness: 0.35 }).rotation.x = Math.PI / 2;
  } },
  { id: 'compressor', name: 'AC Compressor', icon: '❄️', cat: 'scrap', range: [40, 80], build(g) {
    part(g, C(0.1, 0.1, 0.22, 12), 0x2a2a2a, 0, 0.11, 0, { metalness: 0.5 }); part(g, C(0.02, 0.02, 0.08, 6), 0xc87a3a, 0.07, 0.24, 0, GOLD);
  } },
  { id: 'scrap', name: 'Scrap Metal', icon: '🗜️', cat: 'scrap', range: [3, 8], build(g) {
    part(g, B(0.2, 0.04, 0.14), 0x6a5a4a, 0, 0.02, 0, { metalness: 0.6 }).rotation.y = 0.4;
    part(g, B(0.12, 0.04, 0.1), 0x8a6a4a, 0.03, 0.06, 0.02, { metalness: 0.6 }).rotation.set(0.3, -0.3, 0.2);
  } },
  // ---------- big objects: carry them (2 players), drag them slowly (solo), or take them apart with tools ----------
  { id: 'motorbike', name: 'Old Motorbike', icon: '🏍️', cat: 'big', range: [900, 1500], big: { tools: ['screwdriver', 'wrench'], parts: ['engine', 'wheel', 'wheel', 'exhaust', 'tank', 'seat', 'headlight'] }, build(g) {
    wheel(g, 0.32, 0.12, -0.7, 0.32, 0); wheel(g, 0.32, 0.12, 0.72, 0.32, 0);
    g.children.forEach(c => { c.rotation.set(Math.PI / 2, 0, 0); });
    part(g, B(1.0, 0.08, 0.08), 0x2a2a2a, 0, 0.55, 0, STEEL).rotation.z = 0.08;
    part(g, B(0.4, 0.34, 0.3), 0x4a4e54, -0.05, 0.42, 0, STEEL);
    part(g, S(0.2, 1), 0xb02020, 0.18, 0.78, 0, { metalness: 0.5, roughness: 0.25 }).scale.set(1.5, 0.6, 0.8);
    part(g, B(0.5, 0.08, 0.24), 0x111111, -0.3, 0.76, 0);
    part(g, C(0.025, 0.025, 0.7, 8), 0x9a9a9a, 0.62, 0.62, 0, STEEL).rotation.z = 0.4;
    part(g, B(0.04, 0.04, 0.6), 0x222222, 0.5, 0.98, 0);
    flat(part(g, C(0.08, 0.06, 0.08, 12), 0xd8dce0, 0.62, 0.86, 0, STEEL)).rotation.set(0, 0, Math.PI / 2);
    side(part(g, C(0.04, 0.05, 0.6, 8), 0x8a8a8a, -0.35, 0.3, 0.18, STEEL));
  } },
  { id: 'arcade', name: 'Arcade Cabinet', icon: '👾', cat: 'big', range: [500, 900], big: { tools: ['screwdriver'], parts: ['board', 'joystick', 'tube', 'copper'] }, build(g) {
    part(g, B(0.7, 1.75, 0.75), 0x1a1a3a, 0, 0.875, 0);
    part(g, B(0.72, 0.5, 0.05), 0x0a1020, 0, 1.25, 0.36, { emissive: 0x1a2a60 }).rotation.x = -0.2;
    part(g, B(0.72, 0.1, 0.35), 0x2a2a4a, 0, 0.95, 0.45);
    part(g, S(0.035), 0xd02a2a, -0.15, 1.04, 0.5); part(g, S(0.025), 0x2ad02a, 0.1, 1.02, 0.5); part(g, S(0.025), 0xd0d02a, 0.2, 1.02, 0.5);
    part(g, B(0.74, 0.18, 0.77), 0xe0402a, 0, 1.68, 0, { emissive: 0x401008 });
  } },
  { id: 'generator', name: 'Generator', icon: '⚡', cat: 'big', range: [350, 600], big: { tools: ['wrench'], parts: ['engine', 'copper', 'tank'] }, build(g) {
    for (const x of [-0.35, 0.35]) for (const z of [-0.25, 0.25]) part(g, B(0.04, 0.6, 0.04), 0x222222, x, 0.3, z, STEEL);
    part(g, B(0.75, 0.04, 0.55), 0x222222, 0, 0.6, 0, STEEL); part(g, B(0.75, 0.04, 0.55), 0x222222, 0, 0.04, 0, STEEL);
    part(g, B(0.4, 0.32, 0.35), 0xd8b020, -0.1, 0.24, 0, { metalness: 0.3 }); part(g, B(0.5, 0.18, 0.4), 0xd8b020, 0.05, 0.5, 0, { metalness: 0.3 });
    side(part(g, C(0.1, 0.1, 0.12, 12), 0x3a3a3a, 0.25, 0.22, 0));
  } },
  { id: 'acunit', name: 'AC Unit', icon: '🧊', cat: 'big', range: [150, 250], big: { tools: ['screwdriver'], parts: ['compressor', 'copper', 'copper'] }, build(g) {
    part(g, B(0.8, 0.6, 0.35), 0xd8dad6, 0, 0.3, 0, { metalness: 0.3 });
    flat(part(g, C(0.22, 0.22, 0.02, 16), 0x2a2a2a, 0.12, 0.3, 0.18)).rotation.set(Math.PI / 2, 0, 0);
    for (let k = 0; k < 6; k++) part(g, B(0.25, 0.01, 0.01), 0x888888, -0.25, 0.12 + k * 0.07, 0.18);
  } },
  // ---------- food ----------
  { id: 'egg', name: 'Fresh Egg', icon: '🥚', cat: 'food', range: [2, 4], build(g) {
    part(g, S(0.035, 1), 0xf4ead8, 0, 0.04, 0).scale.set(1, 1.3, 1);
  } },
  // ---------- fun ----------
  { id: 'duck', name: 'Rubber Duck', icon: '🦆', cat: 'fun', range: [3, 6], build(g) {
    part(g, S(0.07, 1), 0xf4d020, 0, 0.06, 0, { roughness: 0.3 }).scale.set(1.2, 0.85, 1);
    part(g, S(0.045, 1), 0xf4d020, 0.05, 0.13, 0, { roughness: 0.3 });
    part(g, B(0.04, 0.012, 0.035), 0xe07a10, 0.1, 0.125, 0);
    for (const z of [-0.022, 0.022]) part(g, S(0.008, 0), 0x111111, 0.075, 0.145, z);
    part(g, new THREE.ConeGeometry(0.03, 0.05, 6), 0xf4d020, -0.09, 0.08, 0, { roughness: 0.3 }).rotation.z = 1.2;
  } },
  // ---------- story & cash (never sold in the shop) ----------
  { id: 'ledger', name: 'Chuck\'s Ledger Page', icon: '📜', cat: 'story', range: [1, 1], build(g) {
    part(g, B(0.2, 0.004, 0.27), 0xe8dcb0, 0, 0.002, 0).rotation.y = 0.2;
    for (let k = 0; k < 7; k++) part(g, B(0.15, 0.001, 0.006), 0x3a2a1a, 0.005, 0.005, -0.09 + k * 0.03).rotation.y = 0.2;
    part(g, B(0.06, 0.002, 0.06), 0x8a1a1a, 0.06, 0.006, 0.09);
  } },
  { id: 'cashbundle', name: 'Cash Bundle', icon: '💵', cat: 'cash', range: [300, 700], build(g) {
    for (let k = 0; k < 3; k++) part(g, B(0.16, 0.035, 0.07), 0x5a8a4a, (k - 1) * 0.02, 0.018 + k * 0.035, (k % 2) * 0.01).rotation.y = k * 0.2;
    part(g, B(0.04, 0.11, 0.072), 0xd8c070, 0, 0.055, 0);
  } },
];

export const itemById = id => ITEMS.find(i => i.id === id);
export const CATS = { house: 'Household', collect: 'Collectibles', jewel: 'Jewellery', elec: 'Electronics', tool: 'Tools', music: 'Music', antique: 'Antiques', weapon: 'Weapons', car: 'Car parts', scrap: 'Scrap', big: 'Big stuff', food: 'Food', fun: 'Fun' };
// Items that never show up in shops, markets or customer hands.
export const NOT_FOR_SALE = ['story', 'cash'];
// Fragile items: thrown hard, they break (and leave broken glass on the floor).
export const FRAGILE = ['lamp', 'vase', 'globe', 'crt', 'headlight', 'tube', 'camera', 'blender', 'worldglobe', 'painting', 'clock'];

export function makeItemMesh(def) {
  const g = new THREE.Group();
  def.build(g);
  return g;
}

// An item instance: q = hidden condition (multiplies its value), broken items are worth 30 % until repaired.
export function makeInst(id, o = {}) {
  return { uid: newUid(), id, q: +(o.q ?? rand(0.6, 1.2)).toFixed(2), broken: !!o.broken, fake: !!o.fake };
}
