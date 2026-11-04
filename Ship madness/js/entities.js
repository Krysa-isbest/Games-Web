// Carryable items (buckets, planks, furniture), the plank storage, supply crates and sharks.
// Every entity has an id so the host can mirror it to the other players.
import * as THREE from 'three';
import { G, rand, pick, damp, angDiff, isGuest, nextId, bumpId } from './state.js';
import { waveHeight } from './ocean.js';
import { groundHeight } from './islands.js';
import { VS } from './ship.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';

const v = new THREE.Vector3(), v2 = new THREE.Vector3();
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const hook = (...a) => G.netHook?.(...a);   // tells the online layer (host) about spawns / removals

// ---------- items ----------
export const ITEMS = {
  bucket: { name: 'Bucket' },
  plank: { name: 'Plank' },
  barrel: { name: 'Barrel', fix: 4 },
  chair: { name: 'Chair', fix: 3 },
  table: { name: 'Table', fix: 6 },
  box: { name: 'Wooden box', fix: 4 },
};
const woodM = std('#8a6038'), darkWood = std('#5c3d22'), metalM = std('#4a4d52', { metalness: 0.6, roughness: 0.4 });
const bucketWater = new THREE.MeshStandardMaterial({ color: '#2f7f95', roughness: 0.1 });

function itemMesh(kind) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  if (kind === 'bucket') {
    add(new THREE.CylinderGeometry(0.2, 0.15, 0.32, 10, 1, true), metalM, 0, 0.16, 0).material.side = THREE.DoubleSide;
    add(new THREE.CircleGeometry(0.15, 10).rotateX(-Math.PI / 2), metalM, 0, 0.01, 0);
    const w = add(new THREE.CircleGeometry(0.18, 10).rotateX(-Math.PI / 2), bucketWater, 0, 0.26, 0);
    w.visible = false; g.userData.water = w;
    const h = add(new THREE.TorusGeometry(0.19, 0.012, 4, 12, Math.PI), metalM, 0, 0.32, 0); h.rotation.y = Math.PI / 2;
  } else if (kind === 'plank') add(new THREE.BoxGeometry(0.22, 0.05, 1.6), woodM, 0, 0.03, 0);
  else if (kind === 'barrel') { add(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12), darkWood, 0, 0.4, 0); add(new THREE.TorusGeometry(0.31, 0.02, 4, 14).rotateX(Math.PI / 2), metalM, 0, 0.2, 0); add(new THREE.TorusGeometry(0.31, 0.02, 4, 14).rotateX(Math.PI / 2), metalM, 0, 0.6, 0); }
  else if (kind === 'chair') { add(new THREE.BoxGeometry(0.45, 0.05, 0.45), woodM, 0, 0.45, 0); add(new THREE.BoxGeometry(0.45, 0.5, 0.05), woodM, 0, 0.72, -0.2); for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) add(new THREE.BoxGeometry(0.05, 0.45, 0.05), woodM, x, 0.22, z); }
  else if (kind === 'table') { add(new THREE.BoxGeometry(1.2, 0.07, 0.8), woodM, 0, 0.75, 0); for (const [x, z] of [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]]) add(new THREE.BoxGeometry(0.07, 0.75, 0.07), woodM, x, 0.37, z); }
  else add(new THREE.BoxGeometry(0.6, 0.5, 0.6), woodM, 0, 0.25, 0);
  return g;
}

export function makeItem(kind, ship, p, id = null) {
  const it = { id: id ?? nextId(), kind, def: ITEMS[kind], ship, lp: ship ? p.clone() : null, wp: ship ? null : p.clone(), mesh: itemMesh(kind), full: false, holder: null };
  bumpId(it.id);
  placeMesh(it);
  G.items.push(it);
  hook('spawn', 'item', it);
  return it;
}
export function placeMesh(it) {
  it.mesh.parent?.remove(it.mesh);
  it.mesh.scale.setScalar(1);
  it.mesh.rotation.set(0, it.rotY ??= rand(0, Math.PI * 2), 0);
  if (it.ship) { it.mesh.position.copy(it.lp); it.ship.group.add(it.mesh); }
  else { it.mesh.position.copy(it.wp); G.scene.add(it.mesh); }
}
export function itemWorld(it, out = new THREE.Vector3()) {
  if (it.holder) return it.holder.eyeWorld(out);
  return it.ship ? it.ship.toWorld(out.copy(it.lp)) : out.copy(it.wp);
}
const HOLD_OFF = { bucket: [0.32, -0.55, -0.7], plank: [0.3, -0.4, -0.9], barrel: [0, -0.95, -1.1], chair: [0, -1.0, -1.0], table: [0, -1.25, -1.4], box: [0, -0.75, -1.0] };
export function holdItem(it, player) {
  it.holder = player;
  it.mesh.parent?.remove(it.mesh);
  if (player === G.me) {
    G.camera.add(it.mesh);
    it.mesh.position.set(...HOLD_OFF[it.kind]);
    it.mesh.rotation.set(it.kind === 'plank' ? 0.3 : 0, it.kind === 'plank' ? 0.4 : 0, 0);
  } else if (player.hand) {         // someone else carries it: show it in their hands
    player.hand.add(it.mesh);
    it.mesh.position.set(0, -0.2, 0.35); it.mesh.rotation.set(0, 0, 0);
    it.mesh.scale.setScalar(0.8);
  }
}
export function dropItem(it, player, at = null) {
  it.holder = null;
  if (at) { it.ship = at.ship; it.lp = at.ship ? at.p.clone() : null; it.wp = at.ship ? null : at.p.clone(); }
  else {
    const f = player.forwardLocal(v2).multiplyScalar(0.7);
    if (player.frame) { it.ship = player.frame; it.lp = player.pos.clone().add(f); it.wp = null; }
    else { it.ship = null; it.wp = player.pos.clone().add(f); it.lp = null; }
  }
  placeMesh(it);
}
export function destroyItem(it) {
  it.mesh.parent?.remove(it.mesh);
  G.items = G.items.filter(o => o !== it);
  hook('despawn', 'item', it);
}
export function setBucket(it, full) { it.full = full; it.mesh.userData.water.visible = full; }

export function updateItems(dt) {
  if (isGuest()) return;      // positions come from the host
  for (const it of G.items) {
    if (it.holder) continue;
    if (it.ship && (it.ship.sunk || it.ship.gone)) { it.wp = it.ship.toWorld(it.lp.clone()); it.ship = null; it.lp = null; placeMesh(it); }
    if (!it.ship) {
      const sea = waveHeight(it.wp.x, it.wp.z), gr = groundHeight(it.wp.x, it.wp.z);
      if (gr > sea - 0.1) it.wp.y = Math.max(it.wp.y - dt * 5, gr);
      else if (it.wp.y > sea) it.wp.y = Math.max(sea - 0.05, it.wp.y - dt * 6);
      else { it.wp.y = sea - 0.05; it.wp.x += Math.sin(G.t * 0.1) * dt * 0.2; it.mesh.rotation.z = Math.sin(G.t * 1.3 + it.wp.x) * 0.2; }
      it.mesh.position.copy(it.wp);
    }
  }
}

// every ship comes with planks in storage, two buckets and some furniture (items: host / solo only)
export function populateShip(s) {
  const fl = VS, dt = s.deckTop, [b0, b1] = s.bulks;
  s.storage = { lp: new THREE.Vector3(-1.0, fl, s.zAt(2.2)), planks: s.startPlanks ?? 6 };
  const st = new THREE.Group();
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.8), darkWood); crate.position.y = 0.25; crate.castShadow = true;
  st.add(crate);
  s.storage.stack = [];
  for (let i = 0; i < 12; i++) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 1.6), woodM);
    pl.position.set(-0.25 + (i % 3) * 0.25, 0.53 + Math.floor(i / 3) * 0.055, 0);
    st.add(pl); s.storage.stack.push(pl);
  }
  st.position.copy(s.storage.lp);
  s.group.add(st);
  updateStorage(s);
  if (isGuest()) return;
  makeItem('bucket', s, new THREE.Vector3(1.2, fl, s.zOf(b0 + 4)));
  makeItem('bucket', s, new THREE.Vector3(-0.9, dt, s.cabinFront + 1.0));
  const t0 = s.tiers[0], fx = t0.half * VS * 0.55, fz = s.zOf(t0.k0 + 4);
  if (t0.half * VS > 1.8) {
    makeItem('table', s, new THREE.Vector3(fx, dt, fz + 0.4));
    makeItem('chair', s, new THREE.Vector3(fx, dt, fz - 0.6));
    makeItem('chair', s, new THREE.Vector3(fx, dt, fz + 1.4));
  } else {
    makeItem('chair', s, new THREE.Vector3(0.5, dt, fz));
    makeItem('chair', s, new THREE.Vector3(-0.5, dt, fz));
  }
  makeItem('barrel', s, new THREE.Vector3(1.0, fl, s.zAt(2.6)));
  makeItem('barrel', s, new THREE.Vector3(1.0, fl, s.zAt(3.6)));
  makeItem('box', s, new THREE.Vector3(0.9, fl, s.zOf(b1 + 8)));
  makeItem('box', s, new THREE.Vector3(-0.9, fl, s.zOf(b1 + 14)));
}
export function updateStorage(s) { s.storage?.stack.forEach((m, i) => { m.visible = i < s.storage.planks; }); }

// ---------- supply crates ----------
export const LOOT = { ammo: '🔫 Ammo', health: '❤️ Health', weapon: '🎁 Weapon', planks: '🪵 Planks', c4: '💣 C4', airstrike: '✈️ Airstrike', nuke: '☢️ NUKE' };
const LOOT_W = [['ammo', 30], ['health', 18], ['weapon', 16], ['planks', 16], ['c4', 9], ['airstrike', 7], ['nuke', 4]];
export function rollLoot() {
  let r = Math.random() * LOOT_W.reduce((s, l) => s + l[1], 0);
  for (const [k, w] of LOOT_W) { if ((r -= w) < 0) return k; }
  return 'ammo';
}
const chuteMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', side: THREE.DoubleSide, roughness: 0.9 });
function crateMesh(loot) {
  const g = new THREE.Group();
  const band = loot === 'nuke' ? '#e3c228' : loot === 'airstrike' ? '#d8261c' : '#2f6fb3';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), woodM); box.castShadow = true;
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.2, 0.94), std(band, loot === 'nuke' ? { emissive: band, emissiveIntensity: 0.6 } : {}));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: band }));
  beacon.position.y = 0.52; g.userData.beacon = beacon;
  g.add(box, b, beacon);
  const chute = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), chuteMat);
  dome.position.y = 3.2; chute.add(dome);
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].flatMap(i => [new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(Math.cos(i * 1.57) * 1.7, 3.6, Math.sin(i * 1.57) * 1.7)])), new THREE.LineBasicMaterial({ color: '#ddd' })));
  g.add(chute);
  g.userData.chute = chute;
  return g;
}
export function spawnCrate(wp, loot = rollLoot(), chute = true, id = null) {
  const c = { id: id ?? nextId(), loot, state: 'fall', wp: wp.clone(), vy: 0, chute, mesh: crateMesh(loot), ship: null, lp: null, age: 0 };
  bumpId(c.id);
  c.mesh.userData.chute.visible = chute;
  c.mesh.position.copy(c.wp);
  G.scene.add(c.mesh);
  G.crates.push(c);
  hook('spawn', 'crate', c);
  return c;
}
export function crateWorld(c, out = new THREE.Vector3()) { return c.state === 'deck' && c.ship ? c.ship.toWorld(out.copy(c.lp)) : out.copy(c.wp); }
export function removeCrate(c) { c.mesh.parent?.remove(c.mesh); G.crates = G.crates.filter(o => o !== c); hook('despawn', 'crate', c); }
function toWorldState(c, state) {
  if (c.state === 'deck' && c.ship) c.wp = c.ship.toWorld(c.lp.clone());
  c.mesh.parent?.remove(c.mesh); G.scene.add(c.mesh);
  c.ship = null; c.lp = null; c.state = state; c.vy = 0;
}
export function hookCrate(c, ship) { toWorldState(c, 'hook'); c.hookShip = ship; c.chute = false; c.mesh.userData.chute.visible = false; }
export function releaseCrate(c) { c.state = 'fall'; c.vy = 0; c.hookShip = null; }
// guests: put a crate where the host says it is
export function placeCrate(c, state, ship, p) {
  if (state === 'deck' && ship) {
    if (c.mesh.parent !== ship.group) { c.mesh.parent?.remove(c.mesh); ship.group.add(c.mesh); }
    c.ship = ship; c.lp = (c.lp || new THREE.Vector3()).copy(p);
    c.mesh.position.lerp(c.lp, 0.5);
  } else {
    if (c.mesh.parent !== G.scene) { c.mesh.parent?.remove(c.mesh); G.scene.add(c.mesh); c.mesh.position.copy(p); }
    c.ship = null; c.wp.copy(p);
    c.mesh.position.lerp(c.wp, 0.5);
  }
  if (state !== 'fall') { c.chute = false; c.mesh.userData.chute.visible = false; }
  c.state = state;
}

export function updateCrates(dt) {
  for (const c of G.crates) c.mesh.userData.beacon.visible = Math.sin(G.t * 6 + c.id) > 0;
  if (isGuest()) return;
  for (const c of [...G.crates]) {
    c.age += dt;
    if (c.state === 'fall') {
      c.vy = c.chute ? -6 : c.vy - 15 * dt;
      c.wp.y += c.vy * dt;
      if (c.chute) { c.wp.x += Math.sin(G.t * 0.3) * dt * 0.8; c.mesh.rotation.y += dt * 0.3; }
      let landed = false;
      for (const s of G.ships) {
        if (s.sunk) continue;
        const lp = s.toLocal(v.copy(c.wp));
        if (!s.inBox(lp)) continue;
        const [i, j, k] = s.cellOf(lp.x, lp.y, lp.z);
        for (let jj = Math.min(j, s.ny - 1); jj >= 0; jj--) {
          if (!s.get(i, jj, k)) continue;
          const top = (jj + 1) * VS;
          if (lp.y <= top + 0.05) {
            c.state = 'deck'; c.ship = s; c.lp = new THREE.Vector3(lp.x, top + 0.45, lp.z);
            c.mesh.parent?.remove(c.mesh); s.group.add(c.mesh); c.mesh.rotation.set(0, c.mesh.rotation.y - s.yaw, 0);
            c.chute = false; c.mesh.userData.chute.visible = false;
            sfx.wood(c.wp); landed = true;
          }
          break;
        }
        if (landed) break;
      }
      if (landed) continue;
      const sea = waveHeight(c.wp.x, c.wp.z), gr = groundHeight(c.wp.x, c.wp.z);
      if (gr > sea && c.wp.y - 0.45 <= gr) { c.state = 'ground'; c.wp.y = gr + 0.45; c.chute = false; c.mesh.userData.chute.visible = false; sfx.wood(c.wp); }
      else if (c.wp.y < sea) { c.state = 'float'; c.chute = false; c.mesh.userData.chute.visible = false; FX.splash(c.wp.x, sea, c.wp.z, 1); sfx.splash(c.wp, 1); }
    } else if (c.state === 'float') {
      const sea = waveHeight(c.wp.x, c.wp.z);
      c.wp.y = damp(c.wp.y, sea - 0.1, 4, dt);
      c.wp.x += Math.sin(G.t * 0.07 + c.age) * dt * 0.3; c.wp.z += Math.cos(G.t * 0.05) * dt * 0.3;
      c.mesh.rotation.z = Math.sin(G.t * 1.4 + c.age) * 0.15; c.mesh.rotation.x = Math.cos(G.t * 1.1 + c.age) * 0.12;
      for (const s of G.ships) {
        if (s.sunk) continue;
        const lp = s.toLocal(v.copy(c.wp));
        if (!s.inBox(lp, 0.8)) continue;
        const hw = s.halfAt(lp.y / s.deckTop, lp.z / s.hl) + 0.6;
        if (Math.abs(lp.x) < hw) { lp.x = Math.sign(lp.x || 1) * hw; c.wp.copy(s.toWorld(lp)); }
      }
      if (c.age > 300) { removeCrate(c); continue; }
    } else if (c.state === 'deck') {
      if (!c.ship || c.ship.sunk) { toWorldState(c, 'float'); continue; }
      const [i, j, k] = c.ship.cellOf(c.lp.x, c.lp.y - 0.5, c.lp.z);
      if (!c.ship.get(i, j, k)) { toWorldState(c, 'fall'); continue; }
    } else if (c.state === 'hook') {
      if (!c.hookShip || c.hookShip.sunk) { releaseCrate(c); continue; }
      c.hookShip.hookWorld(c.wp); c.wp.y -= 0.6;
      c.mesh.rotation.y += dt * 0.4;
    }
    c.mesh.position.copy(c.state === 'deck' ? c.lp : c.wp);
    if (c.wp && c.wp.y < -60) removeCrate(c);
  }
  if (G.admin.drops && G.running) {
    G.dropT -= dt;
    if (G.dropT <= 0) {
      G.dropT = rand(28, 50);
      const ships = G.ships.filter(s => !s.sinking);
      if (ships.length) {
        const s = pick(ships);
        let p;
        if (Math.random() < 0.4) p = s.toWorld(new THREE.Vector3(rand(-s.hw, s.hw) * 0.5, 70, rand(-s.hl, s.hl) * 0.6));
        else { const a = rand(0, Math.PI * 2), d = rand(15, 40); p = new THREE.Vector3(s.x + Math.cos(a) * d, 70, s.z + Math.sin(a) * d); }
        p.y = 70;
        spawnCrate(p);
        G.announce?.('📦 A supply drop is coming down!');
      }
    }
  }
}

// ---------- sharks ----------
const sharkMat = std('#5d6a73', { roughness: 0.55 }), bellyMat = std('#c9cfd2'), finMat = std('#3d474e', { roughness: 0.5 });
export class Shark {
  constructor(x, z, id = null) {
    this.id = id ?? nextId(); bumpId(this.id);
    this.isShark = true; this.alive = true;
    this.pos = new THREE.Vector3(x, -0.4, z); this.home = { x, z };
    this.yaw = rand(0, Math.PI * 2); this.speed = 2.5; this.stunT = 0; this.biteCd = 0; this.flee = null; this.wander = 0; this.homeT = 0;
    this.circle = Math.random() < 0.5 ? 1 : -1;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), sharkMat); body.scale.set(0.6, 0.55, 2.3);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), bellyMat); belly.scale.set(0.55, 0.38, 2.1); belly.position.y = -0.2;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.25, 4), finMat); fin.position.set(0, 1.0, 0.1); fin.scale.z = 0.32; fin.rotation.x = -0.35;
    this.tail = new THREE.Group(); this.tail.position.z = -2.1;
    const tf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 4), sharkMat); tf.rotation.x = Math.PI / 2 + 0.4; tf.scale.x = 0.25; tf.position.set(0, 0.3, -0.45);
    this.tail.add(tf);
    for (const s of [-1, 1]) { const pf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 3), sharkMat); pf.position.set(s * 0.65, -0.22, 0.6); pf.rotation.set(0.3, 0, s * 1.3); g.add(pf); }
    for (const s of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: '#000' })); eye.position.set(s * 0.38, 0.12, 1.65); g.add(eye); }
    g.add(body, belly, fin, this.tail);
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    this.mesh = g;
    G.scene.add(g);
    hook('spawn', 'shark', this);
  }
  center(out) { return out.copy(this.pos); }
  hitTest(o, d, max) {
    const t = raySphere(o, d, this.pos, 1.1) ?? raySphere(o, d, v2.copy(this.pos).add(v.set(0, 1.0, 0)), 0.55);
    return t != null && t <= max ? { dist: t } : null;
  }
  hurt(amount, by) {
    if (isGuest()) return G.netHit?.('shark', this.id, amount);
    this.stun(by?.skill === 'repel' ? 18 : 6, by?.center ? by.center(new THREE.Vector3()) : null);
  }
  stun(t, from) {
    this.stunT = Math.max(this.stunT, t);
    if (from) this.flee = { x: from.x, z: from.z };
    FX.splash(this.pos.x, this.pos.y + 0.5, this.pos.z, 0.6);
  }
  update(dt) {
    const sea = waveHeight(this.pos.x, this.pos.z);
    if (isGuest()) {     // just follow the host
      if (this.net) {
        this.pos.x += (this.net.x - this.pos.x) * Math.min(1, dt * 6); this.pos.z += (this.net.z - this.pos.z) * Math.min(1, dt * 6);
        this.pos.y = damp(this.pos.y, sea + (this.net.stun ? -2.8 : -0.4), 3, dt);
        this.yaw += angDiff(this.yaw, this.net.yaw) * Math.min(1, dt * 6); this.speed = this.net.speed;
      }
      return this.pose(dt, sea);
    }
    this.biteCd -= dt;
    // patrol around the nearest ship
    this.homeT -= dt;
    if (this.homeT <= 0) {
      this.homeT = 8;
      let best = null, bd = 220;
      for (const s of G.ships) { if (s.sunk) continue; const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z); if (d < bd) { bd = d; best = s; } }
      if (best) this.home = { x: best.x, z: best.z, r: best.hl + 14 };
    }
    let goal = null, speed = 3, depth = -0.4;
    if (this.stunT > 0) {
      this.stunT -= dt; depth = -2.8; speed = this.stunT > 4 ? 6.5 : 2;
      if (this.flee) goal = { x: this.pos.x * 2 - this.flee.x, z: this.pos.z * 2 - this.flee.z };
    } else {
      let best = null, bd = 45;
      for (const t of [...G.players, ...G.bots]) {
        if (!t.alive || !t.inSea) continue;
        const c = t.center(v);
        const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
        if (d < bd) { bd = d; best = t; }
      }
      if (best) {
        const c = best.center(v);
        goal = { x: c.x, z: c.z }; speed = 5.6;
        if (bd < 2 && this.biteCd <= 0) {
          this.biteCd = 1.1;
          best.hurt(18, this, 'shark');
          sfx.bite(this.pos);
          FX.blood(c.x, sea, c.z);
          for (let i = 0; i < 6; i++) FX.debris(c.x, sea, c.z, new THREE.Color('#9b1010'), 0.5);
        }
      } else if (this.home.r) {
        // circle the ship at a menacing distance
        const dx = this.pos.x - this.home.x, dz = this.pos.z - this.home.z, d = Math.hypot(dx, dz) || 1;
        const a = Math.atan2(dz, dx) + this.circle * 0.35;
        const r = this.home.r + 6 * Math.sin(G.t * 0.1 + this.id);
        goal = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
        if (d > r + 40) speed = 5;
      } else {
        this.wander -= dt;
        if (this.wander <= 0) { this.wander = rand(3, 7); this.wgoal = { x: this.home.x + rand(-50, 50), z: this.home.z + rand(-50, 50) }; }
        goal = this.wgoal;
      }
    }
    if (goal) this.yaw += Math.max(-1.8 * dt, Math.min(1.8 * dt, angDiff(this.yaw, Math.atan2(goal.x - this.pos.x, goal.z - this.pos.z))));
    const ax = this.pos.x + Math.sin(this.yaw) * 7, az = this.pos.z + Math.cos(this.yaw) * 7;
    if (groundHeight(ax, az) > -3) this.yaw += 2.2 * dt;
    this.speed = damp(this.speed, speed, 2, dt);
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    this.pos.y = damp(this.pos.y, sea + depth, 3, dt);
    for (const s of G.ships) {
      if (s.sunk) continue;
      const lp = s.toLocal(v.copy(this.pos));
      if (!s.inBox(lp, 1.5)) continue;
      const hw = s.halfAt(clamp01(lp.y / s.deckTop), lp.z / s.hl) + 1.2;
      if (Math.abs(lp.x) < hw && lp.y > -1.2) { lp.x = Math.sign(lp.x || 1) * hw; this.pos.copy(s.toWorld(lp)); }
    }
    this.pose(dt, sea);
  }
  pose(dt, sea) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, Math.sin(G.t * 6) * 0.05);
    this.tail.rotation.y = Math.sin(G.t * (this.speed > 4 ? 12 : 6)) * 0.4;
    // fin wake
    if (this.pos.y > sea - 1 && Math.random() < dt * this.speed * 1.5 * (G.fxScale ?? 1)) FX.foam(this.pos.x - Math.sin(this.yaw) * 0.6, sea, this.pos.z - Math.cos(this.yaw) * 0.6, 0.45);
  }
  remove() { G.scene.remove(this.mesh); this.alive = false; }
}
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (cc < 0 ? 0 : null);
}
export function spawnShark(x, z, id) { const s = new Shark(x, z, id); G.sharks.push(s); return s; }
// sharks near the ships so players actually meet them
export function spawnSharksNear(n, ship) {
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const a = rand(0, Math.PI * 2), d = rand(30, 90);
      const x = (ship?.x ?? 0) + Math.cos(a) * d, z = (ship?.z ?? 0) + Math.sin(a) * d;
      if (groundHeight(x, z) < -6) { spawnShark(x, z); break; }
    }
  }
}
export function updateSharks(dt) { for (const s of G.sharks) s.update(dt); }
export function clearSharks() { for (const s of G.sharks) s.remove(); G.sharks = []; }
