// Decorations: bought on the computer, each has its own spot in the shop. They make trust grow much faster
// (the "big trust boost") and bring a few more customers in.
import * as THREE from 'three';
import { G } from './state.js';
import { part, canvasTex } from './data.js';
import { STATIC } from './world.js';
import { trustMods } from './economy.js';

export const DECOR = [
  { id: 'plant', icon: '🪴', name: 'Potted Plants', cost: 150, trust: 0.1, desc: 'Two big plants by the door and the hatch.' },
  { id: 'poster', icon: '🖼️', name: 'Framed Prints', cost: 90, trust: 0.05, desc: 'Old movie posters in gold frames.' },
  { id: 'rug', icon: '🟥', name: 'Persian Rug', cost: 240, trust: 0.15, desc: 'A big red rug in the middle of the shop.' },
  { id: 'neon', icon: '💡', name: 'Neon "OPEN 24/7"', cost: 380, trust: 0.2, desc: 'It isn\'t, but it looks great.' },
  { id: 'aquarium', icon: '🐠', name: 'Aquarium', cost: 650, trust: 0.3, desc: 'Bubbling fish tank. Customers love it.' },
  { id: 'jukebox', icon: '📻', name: 'Jukebox', cost: 950, trust: 0.4, desc: 'Pure nostalgia. Counts as music even with the radio off.' },
  { id: 'chandelier', icon: '🕯️', name: 'Chandelier', cost: 1300, trust: 0.5, desc: 'Fancy. Very, very fancy.' },
];
export const decorById = id => DECOR.find(d => d.id === id);
trustMods.push(() => 1 + G.decor.reduce((s, id) => s + (decorById(id)?.trust || 0), 0));

const built = new Map();
const B3 = (x0, z0, x1, z1, h) => new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, h, z1));
let fish = [];

const BUILD = {
  plant(g) {
    for (const [x, z] of [[-2.5, 4.45], [6.45, 3.6]]) {
      part(g, new THREE.CylinderGeometry(0.22, 0.17, 0.4, 10), 0xa0522d, x, 0.2, z);
      for (let k = 0; k < 7; k++) {
        const l = part(g, new THREE.ConeGeometry(0.09, 0.7, 5), 0x2f7a3a, x + Math.cos(k) * 0.08, 0.7, z + Math.sin(k) * 0.08);
        l.rotation.set(Math.cos(k * 1.7) * 0.5, 0, Math.sin(k * 1.7) * 0.5);
      }
    }
    STATIC.push(B3(-2.75, 4.2, -2.25, 4.7, 0.9), B3(6.2, 3.35, 6.7, 3.85, 0.9));
  },
  poster(g) {
    for (const [x, y, z, ry, c, t] of [[6.88, 1.9, -1.6, -Math.PI / 2, '#1a2a4a', 'NIGHT\nRIDER'], [-6.88, 2.1, -3.3, Math.PI / 2, '#4a1a1a', 'THE\nDEAL']]) {
      const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = ry;
      part(f, new THREE.BoxGeometry(0.75, 1.0, 0.04), 0xc9a227, 0, 0, 0, { metalness: 0.7, roughness: 0.3 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.86), new THREE.MeshStandardMaterial({ map: canvasTex(96, 132, (cx, w, h) => {
        cx.fillStyle = c; cx.fillRect(0, 0, w, h); cx.fillStyle = '#f0c060'; cx.font = 'bold 20px Impact'; cx.textAlign = 'center';
        t.split('\n').forEach((l, i) => cx.fillText(l, 48, 50 + i * 24)); cx.fillStyle = '#fff6'; cx.fillRect(10, 100, 76, 3);
      }) }));
      p.position.z = 0.025; f.add(p); g.add(f);
    }
  },
  rug(g) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshStandardMaterial({ roughness: 1, map: canvasTex(128, 88, (cx, w, h) => {
      cx.fillStyle = '#7a1a1a'; cx.fillRect(0, 0, w, h);
      cx.strokeStyle = '#d8a040'; cx.lineWidth = 3; cx.strokeRect(6, 6, w - 12, h - 12); cx.strokeRect(14, 14, w - 28, h - 28);
      cx.fillStyle = '#1a2a5a'; cx.beginPath(); cx.ellipse(64, 44, 26, 16, 0, 0, 7); cx.fill();
      cx.fillStyle = '#d8a040'; cx.beginPath(); cx.ellipse(64, 44, 10, 6, 0, 0, 7); cx.fill();
    }) }));
    m.rotation.x = -Math.PI / 2; m.position.set(2.6, 0.004, -1); m.receiveShadow = true; g.add(m);
  },
  neon(g) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.45), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex(256, 72, cx => {
      cx.clearRect(0, 0, 256, 72); cx.font = 'bold 44px Impact'; cx.textAlign = 'center'; cx.shadowColor = '#3cf'; cx.shadowBlur = 14; cx.fillStyle = '#9ef';
      cx.fillText('OPEN 24/7', 128, 52);
    }) }));
    m.position.set(0.6, 2.55, -4.88); g.add(m);
    const l = new THREE.PointLight(0x55ccff, 2.5, 4); l.position.set(0.6, 2.4, -4.5); g.add(l);
  },
  aquarium(g) {
    const x = 6.55, z = -2.7;
    part(g, new THREE.BoxGeometry(0.55, 0.8, 1.3), 0x2a1a10, x, 0.4, z);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 1.25), new THREE.MeshStandardMaterial({ color: 0x5ab0d8, transparent: true, opacity: 0.35, roughness: 0.05, emissive: 0x0a3050 }));
    glass.position.set(x, 1.08, z); glass.raycast = () => {}; g.add(glass);
    part(g, new THREE.BoxGeometry(0.5, 0.05, 1.25), 0xd8c890, x, 0.83, z);
    fish = Array.from({ length: 5 }, (_, i) => part(g, new THREE.ConeGeometry(0.03, 0.08, 5), [0xff8020, 0xffd020, 0x40c0ff, 0xff4080, 0x80ff60][i], x, 1.0 + i * 0.07, z));
    const l = new THREE.PointLight(0x5ac8ff, 1.5, 3); l.position.set(x - 0.3, 1.3, z); g.add(l);
    STATIC.push(B3(6.2, -3.4, 6.9, -2.0, 1.4));
  },
  jukebox(g) {
    const x = 6.5, z = 1.4;
    part(g, new THREE.BoxGeometry(0.6, 1.25, 0.8), 0x8a2a1a, x, 0.625, z, { roughness: 0.3 });
    const top = part(g, new THREE.CylinderGeometry(0.4, 0.4, 0.6, 16, 1, false, 0, Math.PI), 0xd8a040, x, 1.25, z, { emissive: 0x8a4a10, metalness: 0.5 });
    top.rotation.set(0, Math.PI / 2, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.05, 0.5, 0.6), 0x40c0ff, x - 0.31, 0.95, z, { emissive: 0x2070a0 });
    STATIC.push(B3(6.15, 0.95, 6.9, 1.85, 1.5));
  },
  chandelier(g) {
    part(g, new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), 0xc9a227, 0, 3.0, -0.5);
    part(g, new THREE.TorusGeometry(0.4, 0.03, 6, 20), 0xc9a227, 0, 2.75, -0.5, { metalness: 0.8, roughness: 0.3 }).rotation.x = Math.PI / 2;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      part(g, new THREE.OctahedronGeometry(0.04), 0xeaffff, Math.cos(a) * 0.4, 2.62, -0.5 + Math.sin(a) * 0.4, { emissive: 0x88aaaa, roughness: 0 });
      part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), 0xfff4d8, Math.cos(a) * 0.4, 2.82, -0.5 + Math.sin(a) * 0.4, { emissive: 0xffd890 });
    }
    const l = new THREE.PointLight(0xffe0b0, 5, 8); l.position.set(0, 2.6, -0.5); g.add(l);
  },
};

// Builds whatever has been bought (also for co-op guests).
export function updateDecor() {
  for (const id of G.decor) {
    if (built.has(id) || !BUILD[id]) continue;
    const g = new THREE.Group();
    BUILD[id](g);
    g.traverse(o => { if (o.isMesh && !o.userData.kind) o.raycast = () => {}; });
    G.scene.add(g); built.set(id, g);
  }
}
export function animateDecor(t) {
  fish.forEach((f, i) => { const a = t * (0.5 + i * 0.1) + i; f.position.z = -2.7 + Math.sin(a) * 0.5; f.rotation.x = Math.PI / 2 * (Math.cos(a) > 0 ? 1 : -1); });
}
