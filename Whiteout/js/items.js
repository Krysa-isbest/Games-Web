// Whiteout: things you can pick up. What each kind is, how it looks, the items lying in the world (the stash),
// and what you carry (the inventory: 5 hotbar slots, a 10-slot backpack, the coat you wear).
// Items you drop are physics objects until they come to rest; then they lie still (no physics, so many of them
// cost nothing) and slowly get buried by the snow outside, faster in a storm. You can still dig them out.
// Co-op: the host's stash is the real one; guests draw what the host sends and ask the host to take or drop.
import * as THREE from 'three';
import { SEA, DAY } from './island.js';

// stack: how many fit in one slot. fuel: seconds in the stove (wood: when dry). patch: covers a gap in the shack.
// take: seconds you hold the use key to pick it up. h: half its height lying down.
export const TYPES = {
  axe: { name: 'the axe', short: 'Axe', icon: '🪓', stack: 1, take: 0.6, h: 0.03 },
  log: { name: 'a log', short: 'Log', icon: '🪵', stack: 2, fuel: 300, wood: true, take: 0.5, h: 0.13 },
  split: { name: 'split wood', short: 'Split wood', icon: '🪵', stack: 4, fuel: 160, wood: true, take: 0.4, h: 0.065 },
  branch: { name: 'a branch', short: 'Branches', icon: '🌿', stack: 6, fuel: 60, take: 0.3, h: 0.035 },
  board: { name: 'a board', short: 'Board', icon: '🟫', stack: 4, fuel: 120, patch: true, take: 0.4, h: 0.015 },
  sheet: { name: 'a sheet of metal', short: 'Metal sheet', icon: '⬜', stack: 2, patch: true, take: 0.5, h: 0.01 },
  pipe: { name: 'the stove pipe', short: 'Stove pipe', icon: '⚫', stack: 1, take: 1.2, h: 0.075 },
  fur: { name: 'the fur coat', short: 'Fur coat', icon: '🧥', stack: 1, wear: 0.75, color: '#e9dfcf', take: 1.5, h: 0.05 },
  wool: { name: 'the wool coat', short: 'Wool coat', icon: '🧥', stack: 1, wear: 0.85, color: '#33465a', take: 1.5, h: 0.05 },
  kit: { name: 'the first aid kit', short: 'First aid kit', icon: '🩹', stack: 1, take: 1.0, h: 0.05 },
  flare: { name: 'the flare gun', short: 'Flare gun', icon: '🔶', stack: 1, take: 2.5, h: 0.06 },
  trunk: { name: 'a felled tree', short: 'Tree', icon: '🌲', stack: 1, noTake: true },
};
export const TYPE_LIST = Object.keys(TYPES);
const wet = d => (d >= 0.8 ? 'dry' : d >= 0.45 ? 'damp' : 'wet');
// "a wet log", "the axe", "3 branches"
export function nameOf(type, data = {}, n = 1) {
  const t = TYPES[type];
  if (t.wood) return n > 1 ? `${n} ${wet(data.dry ?? 1)} ${type === 'log' ? 'logs' : 'pieces of split wood'}` : type === 'log' ? `a ${wet(data.dry ?? 1)} log` : `${wet(data.dry ?? 1)} split wood`;
  if (n > 1) return `${n} ${t.short.toLowerCase()}${type === 'branch' || type === 'board' ? '' : 's'}`;
  return t.name;
}
export const shortOf = (type, data = {}) => (TYPES[type].wood ? `${t0(wet(data.dry ?? 1))} ${TYPES[type].short.toLowerCase()}` : TYPES[type].short);
const t0 = s => s[0].toUpperCase() + s.slice(1);

// ---------- how they look (shared geometry and materials; long things lie along x) ----------
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
let MAT = null;
const mats = () => MAT || (MAT = {
  wood: std('#7a4a25'), logBark: std('#4a3626', { roughness: 0.95 }), logEnd: std('#b08a5a', { roughness: 0.9 }), splitIn: std('#c4a072', { roughness: 0.9 }),
  steel: std('#9aa0a6', { metalness: 0.8, roughness: 0.35 }), board: std('#7d7466', { roughness: 0.92 }), sheet: std('#b9c0c8', { roughness: 0.4, metalness: 0.7 }),
  pipe: std('#1d1f22', { roughness: 0.6, metalness: 0.6 }), fur: std('#e9dfcf', { roughness: 1 }), wool: std('#33465a', { roughness: 1 }),
  white: std('#eeeeea', { roughness: 0.5 }), red: std('#c42a1e', { roughness: 0.5 }), orange: std('#e0601a', { roughness: 0.5 }), dark: std('#15181c', { roughness: 0.6 }),
  twig: std('#3a2a1c', { roughness: 1 }),
});
const GEO = {};
const geo = (k, make) => GEO[k] || (GEO[k] = make());
function part(g, geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
export function meshFor(type) {
  const M = mats(), g = new THREE.Group();
  const cylX = (k, r, len, seg = 10) => geo(k, () => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2));
  const box = (k, w, h, d) => geo(k, () => new THREE.BoxGeometry(w, h, d));
  switch (type) {
    case 'axe':
      part(g, cylX('axeH', 0.022, 0.75, 8), M.wood);
      part(g, box('axeB', 0.12, 0.05, 0.2), M.steel, 0.33, 0, 0.04);
      part(g, box('axeE', 0.1, 0.035, 0.05), M.steel, 0.33, 0, 0.16);
      break;
    case 'log':
      part(g, cylX('log', 0.13, 0.9), M.logBark);
      for (const s of [-1, 1]) part(g, geo('logEnd', () => new THREE.CircleGeometry(0.12, 10)), M.logEnd, s * 0.451, 0, 0, 0, s * Math.PI / 2);
      break;
    case 'split':
      part(g, geo('split', () => new THREE.CylinderGeometry(0.13, 0.13, 0.9, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, -0.065, 0)), M.logBark);
      part(g, box('splitIn', 0.9, 0.004, 0.255), M.splitIn, 0, -0.063, 0);
      break;
    case 'branch':
      part(g, cylX('branch', 0.03, 1.1, 6), M.twig);
      part(g, geo('twig', () => new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5).rotateZ(Math.PI / 2)), M.twig, 0.2, 0, 0.1, 0, 0.6, 0);
      part(g, geo('twig', () => new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5).rotateZ(Math.PI / 2)), M.twig, -0.25, 0, -0.08, 0, -0.5, 0);
      break;
    case 'board': part(g, box('board', 1.2, 0.03, 0.18), M.board); break;
    case 'sheet': part(g, box('sheet', 0.8, 0.02, 0.55), M.sheet); break;
    case 'pipe': part(g, cylX('pipe', 0.075, 1.1, 12), M.pipe); break;
    case 'fur': case 'wool': {
      const m = type === 'fur' ? M.fur : M.wool;
      part(g, box('coatA', 0.62, 0.07, 0.48), m); part(g, box('coatB', 0.5, 0.06, 0.12), m, 0, 0.055, -0.2);
      break;
    }
    case 'kit':
      part(g, box('kit', 0.32, 0.1, 0.24), M.white);
      part(g, box('kitX1', 0.06, 0.012, 0.16), M.red, 0, 0.055, 0); part(g, box('kitX2', 0.16, 0.012, 0.06), M.red, 0, 0.056, 0);
      break;
    case 'flare':
      part(g, box('flare', 0.38, 0.12, 0.2), M.orange); part(g, box('flareH', 0.12, 0.03, 0.04), M.dark, 0, 0.075, 0);
      break;
  }
  return g;
}
// the colliders of a lying item (a dropped one is a physics object until it lies still)
const QX = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
function colliders(R, type, data) {
  const C = R.ColliderDesc, cx = (r, hl) => C.cylinder(hl, r).setRotation(QX);
  switch (type) {
    case 'axe': return [C.cuboid(0.38, 0.03, 0.1).setDensity(400)];
    case 'log': return [cx(0.13, 0.45).setDensity(520)];
    case 'split': return [C.cuboid(0.45, 0.065, 0.13).setDensity(520)];
    case 'branch': return [cx(0.035, 0.55).setDensity(500)];
    case 'board': return [C.cuboid(0.6, 0.015, 0.09).setDensity(500)];
    case 'sheet': return [C.cuboid(0.4, 0.01, 0.275).setDensity(1500)];
    case 'pipe': return [cx(0.075, 0.55).setDensity(400)];
    case 'trunk': { const s = data.s || 1, sy = data.sy || 1; return [C.cylinder(2.3 * s * sy, 0.2 * s).setTranslation(0, 2.3 * s * sy, 0).setDensity(450), C.ball(1.0 * s).setTranslation(0, 2.8 * s * sy, 0).setDensity(60)]; }
    default: { const t = TYPES[type]; return [C.cuboid(0.25, t.h || 0.05, 0.2).setDensity(200)]; }
  }
}

// ---------- the stash: everything lying in the world ----------
export class Stash {
  // make: { trunk(data) -> Object3D } for the kinds the world draws itself
  constructor(R, phys, scene, guest, make = {}) {
    Object.assign(this, { R, phys, scene, guest, make });
    this.list = new Map(); this.next = 1; this.byCol = new Map();
  }
  get(id) { return this.list.get(id); }
  // o: { id?, type, n?, data?, p: [x, y, z], q?: [x, y, z, w], v?: [vx, vy, vz], w?: [wx, wy, wz], rest?, buried? }
  spawn(o) {
    const id = o.id ?? this.next;
    this.next = Math.max(this.next, id + 1);
    if (this.list.has(id)) return this.list.get(id);
    const data = { ...(o.data || {}) };
    const mesh = this.make[o.type] ? this.make[o.type](data) : meshFor(o.type);
    mesh.position.fromArray(o.p); if (o.q) mesh.quaternion.fromArray(o.q);
    this.scene.add(mesh);
    const it = { id, type: o.type, n: o.n || 1, data, mesh, body: null, rest: !!o.rest, buried: o.buried || 0, base: mesh.position.y, sleepT: 0, to: null, hidden: false, hideN: 0 };
    this.list.set(id, it);
    if (!it.rest && !this.guest) this.physical(it, o.v, o.w);
    return it;
  }
  physical(it, v, w) {
    const R = this.R, m = it.mesh;
    m.position.y = it.base;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(m.position.x, m.position.y, m.position.z)
      .setRotation({ x: m.quaternion.x, y: m.quaternion.y, z: m.quaternion.z, w: m.quaternion.w }).setLinearDamping(0.25).setAngularDamping(0.6).setCcdEnabled(true);
    const body = this.phys.createRigidBody(bd);
    for (const d of colliders(R, it.type, it.data)) { const c = this.phys.createCollider(d.setFriction(0.7).setRestitution(0.05), body); this.byCol.set(c.handle, it.id); }
    if (v) body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    if (w) body.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
    it.body = body; it.rest = false; it.sleepT = 0; it.buried = 0;
  }
  // it lies still: no more physics
  settle(it) {
    if (!it.body) return;
    for (let i = 0; i < it.body.numColliders(); i++) this.byCol.delete(it.body.collider(i).handle);
    this.phys.removeRigidBody(it.body);
    it.body = null; it.rest = true; it.base = it.mesh.position.y;
  }
  remove(id) {
    const it = this.list.get(id);
    if (!it) return null;
    if (it.body) { for (let i = 0; i < it.body.numColliders(); i++) this.byCol.delete(it.body.collider(i).handle); this.phys.removeRigidBody(it.body); it.body = null; }
    this.scene.remove(it.mesh);
    this.list.delete(id);
    return it;
  }
  update(dt, wld, env) {
    const k = 1 - Math.exp(-14 * dt);
    for (const it of this.list.values()) {
      const m = it.mesh;
      if (it.body) {
        const tr = it.body.translation(), ro = it.body.rotation();
        m.position.set(tr.x, tr.y, tr.z); m.quaternion.set(ro.x, ro.y, ro.z, ro.w);
        const top = Math.max(wld.groundY(tr.x, tr.z), SEA);
        if (tr.y < top - 1.5) { it.body.setTranslation({ x: tr.x, y: top + 0.6, z: tr.z }, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        if (it.type !== 'trunk') {
          if (it.body.isSleeping() || (it.body.linvel().y ** 2 + it.body.linvel().x ** 2 + it.body.linvel().z ** 2) < 0.0004) it.sleepT += dt; else it.sleepT = 0;
          if (it.sleepT > 1.2) this.settle(it);
        }
      } else if (this.guest) {
        if (it.to) {
          m.position.x += (it.to[0] - m.position.x) * k; m.position.y += (it.to[1] - m.position.y) * k; m.position.z += (it.to[2] - m.position.z) * k;
          m.quaternion.slerp(_q.set(it.to[3], it.to[4], it.to[5], it.to[6]), k);
        }
      } else if (it.rest && it.type !== 'trunk') {
        // the snow slowly covers things left outside (a day and a bit, three times faster in a storm)
        const p = m.position, g = wld.groundY(p.x, p.z);
        if (g > SEA + 0.2 && p.y - g < 0.5 && !wld.inShack(p) && !wld.inCabin(p)) it.buried = Math.min(1, it.buried + dt / (DAY * 1.2) * (1 + 3 * env.storm));
        p.y = it.base - it.buried * (0.04 + (TYPES[it.type].h || 0.05) * 1.6);
      }
    }
  }
  // for co-op: everything (a few times a second), and what is moving (often)
  snap() {
    const r3 = v => Math.round(v * 1000) / 1000, out = [];
    for (const it of this.list.values()) {
      const p = it.mesh.position, q = it.mesh.quaternion;
      out.push([it.id, TYPE_LIST.indexOf(it.type), it.n, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), Math.round(it.buried * 100) / 100, Math.round((it.data.dry ?? 1) * 100) / 100, it.data.hp ?? -1, it.data.s ?? 0, it.data.sy ?? 0]);
    }
    return out;
  }
  moving() {
    const r3 = v => Math.round(v * 1000) / 1000, out = [];
    for (const it of this.list.values()) if (it.body && !it.body.isSleeping()) { const p = it.mesh.position, q = it.mesh.quaternion; out.push([it.id, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]); }
    return out;
  }
  // a guest: make our stash what the host says it is
  applySnap(list) {
    const seen = new Set();
    for (const a of list) {
      const [id, ti, n, x, y, z, qx, qy, qz, qw, buried, dry, hp, s, sy] = a;
      seen.add(id);
      let it = this.list.get(id);
      if (!it) {
        const data = { dry }; if (hp >= 0) data.hp = hp; if (s) { data.s = s; data.sy = sy; }
        it = this.spawn({ id, type: TYPE_LIST[ti], n, data, p: [x, y, z], q: [qx, qy, qz, qw], rest: true, buried });
      }
      it.n = n; it.buried = buried; it.data.dry = dry; if (hp >= 0) it.data.hp = hp;
      if (it.hidden && ++it.hideN > 4) { it.hidden = false; it.hideN = 0; it.mesh.visible = true; }   // we asked to take it, but the host gave it to someone else
      it.to = [x, y, z, qx, qy, qz, qw];
    }
    for (const id of [...this.list.keys()]) if (!seen.has(id)) this.remove(id);
  }
  applyMoving(list) { for (const a of list) { const it = this.list.get(a[0]); if (it) it.to = a.slice(1); } }
}
const _q = new THREE.Quaternion();

// ---------- what you carry ----------
export const HOT = 5, BAG = 10;
export class Inventory {
  constructor() { this.slots = new Array(HOT + BAG).fill(null); this.sel = 0; this.coat = null; this.ver = 0; }
  held() { return this.slots[this.sel]; }
  heldType() { return this.slots[this.sel]?.type || null; }
  // is there room for it?
  room(type, n = 1) {
    if (TYPES[type].wear && !this.coat) return true;
    const st = TYPES[type].stack || 1;
    let left = n;
    for (const s of this.slots) { if (!s) left -= st; else if (s.type === type) left -= st - s.n; if (left <= 0) return true; }
    return false;
  }
  // put it away; returns how many didn't fit
  add(type, n = 1, data = {}) {
    if (TYPES[type].wear && !this.coat) { this.coat = type; this.ver++; return n - 1; }
    const st = TYPES[type].stack || 1, dry = data.dry ?? 1;
    let left = n;
    for (const s of this.slots) {
      if (!left) break;
      if (s && s.type === type && s.n < st) { const k = Math.min(st - s.n, left); s.dry = (s.dry * s.n + dry * k) / (s.n + k); s.n += k; left -= k; }
    }
    const order = [this.sel, ...this.slots.keys()].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of order) {
      if (!left) break;
      if (!this.slots[i]) { const k = Math.min(st, left); this.slots[i] = { type, n: k, dry }; left -= k; }
    }
    this.ver++;
    return left;
  }
  // take n out of a slot: { type, n, data }
  take(i = this.sel, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.n);
    s.n -= k; if (s.n <= 0) this.slots[i] = null;
    this.ver++;
    return { type: s.type, n: k, data: TYPES[s.type].wood ? { dry: s.dry } : {} };
  }
  count(pred) { let c = 0; for (const s of this.slots) if (s && pred(s.type)) c += s.n; return c; }
  // use up n things that match, the held slot first
  use(pred, n) {
    if (this.count(pred) < n) return false;
    const order = [this.sel, ...this.slots.keys()];
    for (const i of order) { const s = this.slots[i]; while (n > 0 && s && s.n > 0 && pred(s.type)) { s.n--; n--; } if (s && s.n <= 0) this.slots[i] = null; if (!n) break; }
    this.ver++;
    return true;
  }
  swap(a, b) {
    const A = this.slots[a], B = this.slots[b];
    if (A && B && A.type === B.type && B.n < (TYPES[B.type].stack || 1)) {        // stack them
      const k = Math.min((TYPES[B.type].stack || 1) - B.n, A.n); B.dry = (B.dry * B.n + A.dry * k) / (B.n + k); B.n += k; A.n -= k; if (!A.n) this.slots[a] = null;
    } else { this.slots[a] = B; this.slots[b] = A; }
    this.ver++;
  }
  // wear the coat in slot i (the old one goes there)
  wear(i) {
    const s = this.slots[i];
    if (!s || !TYPES[s.type].wear) return;
    this.slots[i] = this.coat ? { type: this.coat, n: 1, dry: 1 } : null;
    this.coat = s.type; this.ver++;
  }
  undress() {
    if (!this.coat) return false;
    const i = this.slots.findIndex(s => !s);
    if (i < 0) return false;
    this.slots[i] = { type: this.coat, n: 1, dry: 1 }; this.coat = null; this.ver++;
    return true;
  }
}
