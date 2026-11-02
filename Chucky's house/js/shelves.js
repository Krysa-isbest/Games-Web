import * as THREE from 'three';
import { G, newUid } from './state.js';
import { part, hitMat, itemById, makeItemMesh } from './data.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const BRASS = { metalness: 0.8, roughness: 0.3 };
const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false });
const tagGeo = new THREE.PlaneGeometry(0.18, 0.1);
let marketOf = () => 0; // set by main.js (avoids an import cycle with economy.js)
export const setMarketFn = f => { marketOf = f; };

export const SHELF_TYPES = {
  wood: {
    name: 'Wooden Shelf', cost: 250, w: 2, d: 0.5, bonus: 1, slot: [0.85, 0.55, 0.45],
    desc: '6 slots. Simple and cheap.',
    slots: [0.17, 0.82, 1.47].flatMap(y => [V(-0.5, y), V(0.5, y)]),
    build(s) {
      const dark = 0x4a2e1a, light = 0x9a6a3e;
      for (const x of [-0.97, 0.97]) {
        part(s, box(0.06, 1.9, 0.5), dark, x, 0.95, 0);
        part(s, box(0.08, 0.06, 0.54), 0x2a1a10, x, 0.03, 0);
        part(s, box(0.065, 1.7, 0.03), 0x5a3a22, x, 1.0, 0.24);
      }
      part(s, box(2, 1.9, 0.03), 0x3a2416, 0, 0.95, -0.24);
      for (let k = -2; k <= 2; k++) part(s, box(0.012, 1.85, 0.005), 0x2a1a10, k * 0.38, 0.95, -0.222);
      for (const y of [0.12, 0.77, 1.42]) {
        part(s, box(1.9, 0.05, 0.48), light, 0, y, 0);
        part(s, box(1.9, 0.035, 0.02), 0x7a5230, 0, y + 0.005, 0.245);
      }
      part(s, box(2.1, 0.07, 0.56), dark, 0, 1.92, 0.01);
      part(s, box(2.0, 0.04, 0.04), 0xc9a227, 0, 1.87, 0.27, BRASS);
      part(s, box(1.9, 0.1, 0.04), dark, 0, 0.05, 0.23);
    },
  },
  metal: {
    name: 'Metal Rack', cost: 420, w: 2.2, d: 0.6, bonus: 1, slot: [0.6, 0.45, 0.5],
    desc: '9 slots. Holds a lot, looks cheap.',
    slots: [0.1, 0.72, 1.34].flatMap(y => [V(-0.7, y), V(0, y), V(0.7, y)]),
    build(s) {
      for (const x of [-1.07, 1.07]) for (const z of [-0.27, 0.27]) part(s, box(0.04, 1.95, 0.04), 0x5a6068, x, 0.975, z, { metalness: 0.6, roughness: 0.4 });
      for (const y of [0.06, 0.68, 1.3, 1.92]) {
        part(s, box(2.2, 0.03, 0.58), 0x8a9098, 0, y, 0, { metalness: 0.5, roughness: 0.45 });
        part(s, box(2.2, 0.06, 0.02), 0xd0702a, 0, y + 0.01, 0.29);
      }
    },
  },
  glass: {
    name: 'Glass Display Case', cost: 600, w: 1.6, d: 0.6, bonus: 1.2, slot: [0.7, 0.5, 0.5],
    desc: '4 slots. Customers pay up to 20% more for items in it.',
    slots: [0.82, 1.37].flatMap(y => [V(-0.4, y), V(0.4, y)]),
    build(s) {
      part(s, box(1.6, 0.8, 0.6), 0x3a2416, 0, 0.4, 0);
      part(s, box(1.64, 0.03, 0.64), 0x8a5a33, 0, 0.8, 0);
      for (const x of [-0.79, 0.79]) for (const z of [-0.29, 0.29]) part(s, box(0.03, 1.1, 0.03), 0xc9a227, x, 1.35, z, BRASS);
      part(s, box(1.64, 0.04, 0.64), 0xc9a227, 0, 1.9, 0, BRASS);
      part(s, box(1.5, 0.02, 0.05), 0xffffff, 0, 1.87, 0, { emissive: 0xfff0c0 });
      const glass = (w, h, d, x, y, z) => {
        const m = new THREE.Mesh(box(w, h, d), glassMat);
        m.position.set(x, y, z); m.raycast = () => {}; s.add(m);
      };
      glass(1.56, 1.06, 0.01, 0, 1.35, 0.29); glass(1.56, 1.06, 0.01, 0, 1.35, -0.29);
      glass(0.01, 1.06, 0.56, -0.79, 1.35, 0); glass(0.01, 1.06, 0.56, 0.79, 1.35, 0);
      glass(1.56, 0.02, 0.56, 0, 1.34, 0);
    },
  },
  pedestal: {
    name: 'Velvet Pedestal', cost: 900, w: 0.7, d: 0.7, bonus: 1.35, slot: [0.5, 0.5, 0.5],
    desc: '1 slot. The star item. Customers pay up to 35% more.',
    slots: [V(0, 1.12)],
    build(s) {
      part(s, new THREE.CylinderGeometry(0.3, 0.36, 1.05, 12), 0x2a1a10, 0, 0.525, 0);
      part(s, new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12), 0x6a1020, 0, 1.08, 0, { roughness: 0.9 });
      part(s, new THREE.TorusGeometry(0.34, 0.015, 4, 20), 0xc9a227, 0, 1.08, 0, BRASS).rotation.x = Math.PI / 2;
      for (const [x, z] of [[-0.32, 0.32], [0.32, 0.32]]) {
        part(s, new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), 0xc9a227, x, 0.45, z + 0.12, BRASS);
        part(s, new THREE.SphereGeometry(0.035, 8, 6), 0xc9a227, x, 0.92, z + 0.12, BRASS);
      }
      part(s, new THREE.CylinderGeometry(0.012, 0.012, 0.64, 6), 0x8a1a1a, 0, 0.82, 0.44).rotation.z = Math.PI / 2;
    },
  },
};

export function makeShelf(type, x, z, r, sid = newUid()) {
  const T = SHELF_TYPES[type], s = new THREE.Group();
  T.build(s);
  s.userData.type = type;
  s.userData.sid = sid;
  s.userData.slots = T.slots.map((p, i) => {
    const slot = { shelf: s, i, pos: p, item: null, mesh: null, tag: null };
    const hb = new THREE.Mesh(box(...T.slot), hitMat);
    hb.position.set(p.x, p.y + T.slot[1] / 2, 0);
    hb.userData.slot = slot;
    s.add(hb);
    return slot;
  });
  s.traverse(o => o.userData.shelf = s);
  placeShelf(s, x, z, r);
  G.scene.add(s);
  G.shelves.push(s);
  return s;
}

export function removeShelf(s) {
  G.scene.remove(s);
  G.shelves.splice(G.shelves.indexOf(s), 1);
}

export const shelfBySid = sid => G.shelves.find(s => s.userData.sid === sid);

export function shelfBox(type, x, z, r) {
  const T = SHELF_TYPES[type];
  const [hx, hz] = r % 2 ? [T.d / 2, T.w / 2] : [T.w / 2, T.d / 2];
  return new THREE.Box3(V(x - hx, 0, z - hz), V(x + hx, 1.9, z + hz));
}

export function placeShelf(s, x, z, r) {
  s.position.set(x, 0, z);
  s.rotation.y = r * Math.PI / 2;
  s.userData.r = r;
  s.userData.box = shelfBox(s.userData.type, x, z, r);
}

export function shelfFront(s) {
  const a = s.rotation.y, k = SHELF_TYPES[s.userData.type].d / 2 + 0.55;
  return V(s.position.x + Math.sin(a) * k, 0, s.position.z + Math.cos(a) * k);
}

function tagTexture(price, mkt, weapon) {
  const c = document.createElement('canvas'); c.width = 108; c.height = 60;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd84a'; g.fillRect(0, 0, 108, 60);
  g.fillStyle = weapon ? '#2a2a2a' : '#c0392b'; g.fillRect(0, 0, 108, 8);
  g.fillStyle = '#111'; g.font = 'bold 26px Trebuchet MS'; g.textAlign = 'center';
  g.fillText('$' + price, 54, 34);
  g.font = '13px Trebuchet MS'; g.fillStyle = '#5a4a20';
  g.fillText('today ~$' + mkt, 54, 53);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Put an item instance ({uid, id, q, price...}) into a slot, or clear it with null. Also refreshes the price tag.
export function setSlotItem(slot, item) {
  const s = slot.shelf;
  if (slot.mesh) s.remove(slot.mesh);
  if (slot.tag) { s.remove(slot.tag); slot.tag.material.map.dispose(); slot.tag.material.dispose(); }
  slot.item = item; slot.mesh = slot.tag = null;
  if (!item) return;
  const def = itemById(item.id);
  const m = makeItemMesh(def);
  m.position.copy(slot.pos);
  m.traverse(o => { o.userData.slot = slot; o.userData.shelf = s; });
  s.add(m); slot.mesh = m;
  const tag = new THREE.Mesh(tagGeo, new THREE.MeshBasicMaterial({ map: tagTexture(item.price, marketOf(item.id), def.weapon) }));
  tag.position.set(slot.pos.x + 0.22, slot.pos.y - 0.03, SHELF_TYPES[s.userData.type].d / 2 + 0.006);
  tag.userData.slot = slot; tag.userData.shelf = s;
  s.add(tag); slot.tag = tag;
}

// Market prices change every morning: redraw every tag.
export function refreshTags() {
  for (const s of G.shelves) for (const sl of s.userData.slots) if (sl.item) setSlotItem(sl, sl.item);
}
