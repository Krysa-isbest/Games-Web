// AI ships hunt the nearest hostile ship, line up a broadside and fire. Their crew stand on deck and shoot
// at anyone hostile they can see. In FFA each rival has a captain at the wheel: kill him and the ship drifts.
import * as THREE from 'three';
import { G, rand, clamp, angDiff, isGuest, nextId, bumpId } from './state.js';
import { groundHeight } from './islands.js';
import { fireCannon, hitscan } from './weapons.js';
import { cannonOf } from './cannons.js';
import { raySphere } from './entities.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
export const DIFF = { aim: 1, hp: 1, dmg: 1 };   // set by the campaign difficulty

export function makeAI(ship, { crew = ship.def.crew, captain = false, hp = 60, name = '' } = {}) {
  ship.ai = { t: 0, wander: rand(-1, 1), alive: true, err: 0, ram: ['tug', 'yacht', 'trawler'].includes(ship.key) && Math.random() < 0.3 };
  const bots = [];
  if (captain) {
    const b = new Bot(ship, ship.driverLp.clone(), { hp: 120, captain: true, name });
    ship.captain = b; ship.driver = b; bots.push(b);
  }
  for (const lp of ship.crewSpots(crew)) bots.push(new Bot(ship, lp, { hp }));
  G.bots.push(...bots);
  for (const b of bots) G.netHook?.('spawn', 'bot', b);
  return bots;
}

const hostile = (a, b) => a !== b && b !== 'neutral' && a !== 'neutral';
function enemiesOf(ship) {
  return G.ships.filter(s => s !== ship && !s.sunk && (hostile(ship.team, s.team) || (s.driver?.isPlayer && ship.team !== 'player')));
}

// Enemy ships try to keep up with you and shoot, but they are sloppy: lazy rudder, wandering course, never
// faster than you. Close in and they hold their course, so you can board them. A few small ones try to ram.
// No captain or no crew left = the ship drifts. Badly flooded ones run.
export function updateAI(dt) {
  if (isGuest()) { for (const b of G.bots) b.update(dt); return; }
  const crew = new Map();
  for (const b of G.bots) if (b.alive) crew.set(b.ship, (crew.get(b.ship) || 0) + 1);
  for (const s of G.ships) {
    if (!s.ai) continue;
    const ai = s.ai;
    if (s.sinking || (s.captain && !s.captain.alive) || !crew.get(s)) { s.rudderIn = 0; s.throttle = 0; s.brake = false; continue; }
    ai.t -= dt; ai.errT = (ai.errT || 0) - dt;
    if (ai.errT <= 0) { ai.errT = rand(2, 5); ai.err = rand(-0.35, 0.35); }
    let target = null, td = Infinity;
    for (const o of enemiesOf(s)) { const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < td) { td = d; target = o; } }
    let want = s.yaw, thr = 1;
    const zone = G.game?.zone, outZone = zone && Math.hypot(s.x - zone.x, s.z - zone.z) > zone.r * 0.85;
    if (outZone) { want = Math.atan2(zone.x - s.x, zone.z - s.z); thr = 3; }
    else if (target && td < 320) {
      const bearing = Math.atan2(target.x - s.x, target.z - s.z);
      const tSpeed = Math.abs(target.speed), cap = Math.max(1, target.throttle);   // never out-run you
      if (s.flood > 0.55 && !ai.ram) { want = bearing + Math.PI; thr = 3; }        // too damaged: run
      else if (ai.ram && td < 90) { want = bearing + angDiff(bearing, Math.atan2(target.x + target.velocity(v2).x * 2 - s.x, target.z + target.velocity(v2).z * 2 - s.z)); thr = 3; }
      else if (td > 110) { want = bearing; thr = 3; }
      else if (td < 30) { want = s.yaw; thr = 1; }                                  // close: hold course, you can board
      else {
        // ride alongside, about 40 m off the target's beam
        const th = tSpeed > 1 ? target.yaw : bearing + Math.PI / 2;
        const rx = Math.cos(th), rz = -Math.sin(th);
        const side = Math.sign((s.x - target.x) * rx + (s.z - target.z) * rz) || 1;
        const ax = target.x + rx * side * 40 + Math.sin(th) * 6, az = target.z + rz * side * 40 + Math.cos(th) * 6;
        const da = Math.hypot(ax - s.x, az - s.z);
        want = da > 14 ? Math.atan2(ax - s.x, az - s.z) : th;
        thr = da > 30 ? 3 : tSpeed > 1 ? target.throttle : 1;
        thr = Math.min(thr, cap);
      }
      if (!ai.ram || td > 90) fireBroadside(s, target, td);
    } else {
      if (ai.t <= 0) { ai.t = rand(4, 9); ai.wander = rand(-1, 1); }
      want = s.yaw + ai.wander * 0.6; thr = 1;
    }
    want += ai.err;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    for (const look of [18, 34]) {
      if (groundHeight(s.x + fx * look, s.z + fz * look) > s.y - 0.5) {
        const lft = groundHeight(s.x + Math.sin(s.yaw + 0.8) * look, s.z + Math.cos(s.yaw + 0.8) * look);
        const rgt = groundHeight(s.x + Math.sin(s.yaw - 0.8) * look, s.z + Math.cos(s.yaw - 0.8) * look);
        want = s.yaw + (lft < rgt ? 1.2 : -1.2);
        thr = Math.min(thr, look < 20 ? 1 : 2);
        break;
      }
    }
    if (s.aground > 0) thr = -1;
    s.throttle = clamp(Math.round(thr), -1, 3);
    s.rudderIn = clamp(-angDiff(s.yaw, want) * 1.2, -0.8, 0.8);
  }
  for (const b of G.bots) b.update(dt);
  for (const b of G.bots) if (b.gone) G.netHook?.('despawn', 'bot', b);
  G.bots = G.bots.filter(b => !b.gone);
}
// every gun type aims its own way: mortars lob high, torpedoes run flat, rockets barely drop
function fireBroadside(s, target, dist) {
  if (dist > 200) return;
  const lead = s.velocity(v3).clone(), tv = target.velocity(v2);
  const err = DIFF.aim * (s.ghost ? 0.6 : 1);
  for (const c of s.cannons) {
    if (c.cd > 0 || c.over || c.user?.isPlayer) continue;
    const T = cannonOf(c);
    const range = T.proj === 'torpedo' ? 170 : T.proj === 'mortar' ? 150 : T.proj === 'ac' ? 120 : 190;
    if (dist > range) continue;
    const flight = dist / (T.proj === 'torpedo' ? 22 : T.speed * 0.9);
    const aimX = target.x + tv.x * flight - lead.x * flight * 0.3, aimZ = target.z + tv.z * flight - lead.z * flight * 0.3;
    const rel = s.toLocal(v1.set(aimX, s.y + s.deckTop, aimZ)).sub(c.lp);
    if (Math.sign(rel.x) !== c.side) continue;
    const yaw = Math.atan2(rel.z, Math.abs(rel.x));
    if (Math.abs(yaw) > T.yaw) continue;
    const d = Math.hypot(rel.x, rel.z), g = (T.grav || 9.8), v = T.speed;
    const s2 = clamp(g * d / (v * v), -1, 1);
    let pitch = T.proj === 'torpedo' ? 0 : T.proj === 'mortar' ? Math.PI / 2 - 0.5 * Math.asin(s2) : 0.5 * Math.asin(s2);
    c.yaw = yaw + rand(-0.04, 0.04) * err;
    c.pitch = clamp(pitch + rand(-0.03, 0.035) * err, T.pmin, T.pmax);
    if (Math.random() < (T.heat ? 0.9 : 0.6)) fireCannon(s, c, { isBot: true, ship: s }, s.ghost ? 0.7 : 1);
  }
}

// ---------- crew ----------
const skinMat = new THREE.MeshStandardMaterial({ color: '#c99a74', roughness: 0.8 });
const boneMat = new THREE.MeshStandardMaterial({ color: '#d9d4c0', roughness: 0.7, emissive: '#0a2a18', emissiveIntensity: 0.5 });
const pants = new THREE.MeshStandardMaterial({ color: '#2c2a30', roughness: 0.9 });
const gunM = new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.4 });
export class Bot {
  constructor(ship, lp, { hp = 60, captain = false, name = '', id = null } = {}) {
    this.id = id ?? nextId(); bumpId(this.id);
    this.isBot = true; this.alive = true; this.gone = false; this.ship = ship; this.lp = lp; this.team = ship.team;
    this.hp = Math.round(hp * DIFF.hp); this.maxHp = this.hp; this.cd = rand(1, 3); this.inSea = false; this.captain = captain; this.name = name;
    this.deadT = 0;
    const g = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: ship.colors.trim, roughness: 0.85 });
    const body = ship.ghost ? boneMat : skinMat;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), ship.ghost ? boneMat : shirt); torso.position.y = 1.12;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.24), pants); legL.position.set(-0.13, 0.4, 0);
    const legR = legL.clone(); legR.position.x = 0.13;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), body); head.position.y = 1.62;
    const hat = new THREE.Mesh(captain ? new THREE.CylinderGeometry(0.26, 0.26, 0.08, 10) : new THREE.BoxGeometry(0.32, 0.08, 0.32), new THREE.MeshStandardMaterial({ color: captain ? '#1b1b1b' : ship.colors.hull }));
    hat.position.y = 1.8;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), ship.ghost ? boneMat : shirt); armL.position.set(-0.32, 1.15, 0.12); armL.rotation.x = -1.1;
    const armR = armL.clone(); armR.position.x = 0.32;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.65), gunM); gun.position.set(0.12, 1.25, 0.42);
    g.add(torso, legL, legR, head, hat, armL, armR, gun);
    if (captain) { const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.2, 10), hat.material); top.position.y = 1.9; g.add(top); }
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    this.mesh = g; g.position.copy(lp);
    ship.group.add(g);
  }
  center(out) { return this.ship.toWorld(out.copy(this.lp).add(v3.set(0, 1.0, 0))); }
  hitTest(o, d, max) {
    if (!this.alive) return null;
    const c = this.center(new THREE.Vector3());
    const t = raySphere(o, d, c, 0.45);
    const h = raySphere(o, d, c.clone().add(v3.set(0, 0.62, 0)), 0.2);
    if (h != null && h <= max && (t == null || h < t)) return { dist: h, head: true };
    return t != null && t <= max ? { dist: t } : null;
  }
  hurt(amount, by, kind) {
    if (!this.alive) return;
    if (isGuest()) return G.netHit?.('bot', this.id, amount, kind);
    if (by?.isBot && by.team === this.team) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false; this.deadT = 0;
      if (by?.isPlayer) { if (!by.isRemote) by.kills++; G.announceKill?.(this, by, kind); G.toast?.(this.captain ? `☠️ You killed captain ${this.name}!` : '☠️ Enemy sailor down.', this.captain ? 'good' : ''); }
      G.game?.onBotDeath?.(this, by, kind);
    }
  }
  update(dt) {
    const s = this.ship;
    if (isGuest()) {      // mirror only: the host decides who shoots and who dies
      if (this.alive) { if (this.netRot != null) this.mesh.rotation.y = this.netRot; return; }
      this.deadT += dt;
      this.mesh.rotation.x = Math.min(Math.PI / 2, this.deadT * 4);
      this.mesh.position.y = this.lp.y + 0.15;
      return;
    }
    if (!this.alive || s.sunk) {
      if (this.alive) { this.alive = false; G.game?.onBotDeath?.(this, s.lastHitBy, 'drown'); }
      this.deadT += dt;
      this.mesh.rotation.x = Math.min(Math.PI / 2, this.deadT * 4);
      this.mesh.position.y = this.lp.y + 0.15;
      if (this.deadT > 8 || s.gone) { this.mesh.parent?.remove(this.mesh); this.gone = true; }
      return;
    }
    const c = this.center(v1);
    let target = null, bd = 95;
    for (const t of [...G.players, ...G.bots]) {
      if (!t.alive || t === this || t.underwater) continue;
      const team = t.team || 'player';
      if (team === this.team) continue;
      const d = t.center(v2).distanceTo(c);
      if (d < bd) { bd = d; target = t; }
    }
    if (!target) return;
    const pc = target.center(new THREE.Vector3());
    const lt = s.toLocal(pc.clone());
    this.mesh.rotation.y = Math.atan2(lt.x - this.lp.x, lt.z - this.lp.z);
    this.cd -= dt;
    if (this.cd > 0) return;
    this.cd = rand(0.9, 2.0) * (s.ghost ? 0.8 : 1);
    const dir = pc.clone().sub(c).normalize();
    const hit = hitscan(c.clone().addScaledVector(dir, 0.6), dir, bd + 1, this);
    if (hit && hit.kind === 'ship' && hit.dist < bd - 1.5) return;
    sfx.shot('ak', c);
    const chance = clamp(0.5 - bd / 200, 0.12, 0.5) * (target.swimming ? 0.6 : 1) / DIFF.aim;
    const end = Math.random() < chance ? pc : pc.clone().add(v3.set(rand(-2, 2), rand(-1, 1.5), rand(-2, 2)));
    FX.tracer(c, end);
    G.netFx?.({ k: 'tr', a: [c.x, c.y, c.z], b: [end.x, end.y, end.z] });
    if (end === pc) target.hurt(7 * DIFF.dmg, this, 'bullet');
  }
}
export function clearBots() { for (const b of G.bots) b.mesh.parent?.remove(b.mesh); G.bots = []; }
