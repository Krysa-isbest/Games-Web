// Items lying on the ground: what you drop from the inventory (drag it out of the window, or Drop in the
// right-click menu). Each has a short light beam in its rarity colour so you can find it again, and E picks it
// up. The items themselves are plain data; only the models are drawing.
// Containers (wrecks, crates) are not here: they are boxes opened in the inventory screen (inventory.js).
import * as THREE from 'three';
import { ITEMS, RARITY } from './items.js';
import { addItem } from './inventory.js';
import { makeWeapon, MODEL_OF } from './weapon-models.js';
import { groundBelow } from './prism/robot.js';
import { fwdX, fwdZ } from './move-math.js';
import { G } from '../core/physics.js';
import { bus } from '../core/events.js';

// (part 12) shared loot in a squad: on a friend's game, crates and wrecks belong to the leader. open(id, p, keep)
// asks for a box; commit(box, before, after) asks to change it (only if nobody changed it first)
export const SHARED = { open: null, commit: null };

export class GroundLoot {
  constructor({ scene, phys, items }) {
    this.scene = scene; this.phys = phys; this.items = items;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.drops = []; this.nextId = 1; this.t = 0;
    this.geo = {
      beam: (() => { const g = new THREE.CylinderGeometry(0.02, 0.05, 1.3, 8, 1, true); g.translate(0, 0.65, 0); return g; })(),
      pouch: new THREE.BoxGeometry(0.24, 0.12, 0.18),
      band: new THREE.BoxGeometry(0.25, 0.035, 0.19),
    };
    this.pouchMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.85 });
    this.mats = {};
  }
  mat(rarity) {
    if (!this.mats[rarity]) {
      const c = new THREE.Color(RARITY[rarity].color);
      this.mats[rarity] = {
        band: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.5 }),
        beam: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      };
    }
    return this.mats[rarity];
  }

  // drops an item in front of the player (at the feet if a wall is right there)
  drop(p, item) {
    const fx = fwdX(p.facing), fz = fwdZ(p.facing), k = this.drops.length % 5;
    const side = (k - 2) * 0.3;
    let ahead = 0.9;
    const h = this.phys.ray({ x: p.pos.x, y: p.pos.y + 0.4, z: p.pos.z }, { x: fx, y: 0, z: fz }, 1.3, G.WORLD);
    if (h) ahead = Math.max(0, h.t - 0.4);
    const x = p.pos.x + fx * ahead - fz * side, z = p.pos.z + fz * ahead + fx * side;
    const y = groundBelow(this.phys, x, p.pos.y + 1.2, z);
    bus.emit('loot:dropped', p, item);
    return this.place(item, { x, y, z });
  }
  place(item, pos) {
    const d = { id: 'drop' + this.nextId++, item, pos: { x: pos.x, y: pos.y, z: pos.z }, view: null, inter: null };
    d.view = this.view(item);
    d.view.position.set(pos.x, pos.y, pos.z);
    d.view.rotation.y = (this.nextId * 2.39996) % (Math.PI * 2);
    this.group.add(d.view);
    d.inter = this.items.add({
      id: d.id, pos: { x: pos.x, y: pos.y + 0.3, z: pos.z }, radius: 1.6, hold: 0,
      label: () => `Pick up ${ITEMS[d.item.id].name}${d.item.n > 1 ? ' ×' + d.item.n : ''}`,
      use: p => this.pickUp(p, d),
    });
    this.drops.push(d);
    return d;
  }
  // into the inventory, as much as fits. Returns how many were picked up.
  pickUp(p, d) {
    const n = d.item.n, left = addItem(p.inv, d.item);
    if (left >= n) { bus.emit('loot:full', p, d.item); return 0; }
    bus.emit('loot:pickup', p, d.item.id, n - left);
    if (left > 0) d.item.n = left; else this.remove(d);
    return n - left;
  }
  remove(d) {
    const i = this.drops.indexOf(d);
    if (i >= 0) this.drops.splice(i, 1);
    this.items.remove(d.inter);
    this.group.remove(d.view);
    d.view.traverse(o => { if (o.geometry && !Object.values(this.geo).includes(o.geometry)) o.geometry.dispose(); });
  }
  view(item) {
    const def = ITEMS[item.id], g = new THREE.Group(), m = this.mat(def.rarity);
    const kind = MODEL_OF[item.id];
    if (kind) {                                       // guns and tools lie on their side
      const w = makeWeapon(kind, true);
      w.rotation.set(0, 0, Math.PI / 2);
      w.position.y = kind === 'grenade' ? 0.045 : 0.03;
      g.add(w);
    } else {
      const body = new THREE.Mesh(this.geo.pouch, this.pouchMat);
      body.position.y = 0.06; body.castShadow = true;
      const band = new THREE.Mesh(this.geo.band, m.band);
      band.position.y = 0.06;
      g.add(body, band);
    }
    const beam = new THREE.Mesh(this.geo.beam, m.beam);
    beam.userData.beam = true;
    g.add(beam);
    return g;
  }
  // p: the player. On a big map, things far away are not drawn.
  frame(dt, p = null) {
    this.t += dt;
    const k = 0.8 + 0.2 * Math.sin(this.t * 3);
    for (const r of Object.values(this.mats)) r.beam.opacity = 0.3 * k;
    if (p) for (const d of this.drops) {
      const on = Math.abs(d.pos.x - p.pos.x) < 140 && Math.abs(d.pos.z - p.pos.z) < 140;
      if (d.view.visible !== on) d.view.visible = on;
    }
  }
  clear() { for (const d of [...this.drops]) this.remove(d); }
  dispose() {
    this.clear();
    this.scene.remove(this.group);
    for (const g of Object.values(this.geo)) g.dispose();
    this.pouchMat.dispose();
    for (const r of Object.values(this.mats)) { r.band.dispose(); r.beam.dispose(); }
  }
}
