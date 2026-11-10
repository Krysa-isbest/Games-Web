// AI ships hunt the nearest hostile ship, line up a broadside and fire. Their crew stand on deck and shoot
// at anyone hostile they can see. In FFA each rival has a captain at the wheel: kill him and the ship drifts.
import * as THREE from 'three';
import { G, rand, clamp, angDiff, isGuest, nextId, bumpId } from './state.js';
import { groundHeight } from './islands.js';
import { fireCannon, hitscan } from './weapons.js';
import { cannonOf } from './cannons.js';
import { raySphere } from './entities.js';
import { CREW_FX } from './progression.js';
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
  // a sailor at every deck gun: kill him and that gun goes quiet (until someone else walks over to it)
  for (const c of ship.cannons) { const b = new Bot(ship, gunnerSpot(ship, c), { hp }); b.gun = c; c.user = b; bots.push(b); }
  G.bots.push(...bots);
  for (const b of bots) G.netHook?.('spawn', 'bot', b);
  return bots;
}

// where a gunner stands: just behind the gun, a little inboard
export function gunnerSpot(ship, c) { return c.standDz ? new THREE.Vector3(c.lp.x - 0.4, ship.deckTop, c.lp.z + c.standDz) : new THREE.Vector3(c.lp.x - c.side * 0.55, ship.deckTop, c.lp.z - 0.95); }
const gunnerOk = c => c.user?.isBot && c.user.alive && c.user.gun === c;

// empty guns: after a moment a free sailor walks over; with nobody free, a gunner from the side that can't
// shoot at the target swaps over to a gun that can
function crewGuns(s, target, dt) {
  const bots = G.bots.filter(b => b.ship === s && b.alive && !b.captain);
  const side = target ? Math.sign(s.toLocal(v1.set(target.x, s.y, target.z)).x) || 1 : 0;
  for (const c of s.cannons) {
    if (c.user?.isPlayer || gunnerOk(c) || (c.claim?.alive && c.claim.walk?.gun === c)) { c.emptyT = 0; continue; }
    if (c.user?.isBot) c.user = null;
    c.emptyT = (c.emptyT || 0) + dt;
    if (c.emptyT < 2) continue;
    const free = bots.filter(b => !b.gun && !b.walk);
    let pick = null, bd = Infinity;
    const pool = free.length ? free : (side && c.side === side ? bots.filter(b => b.gun && !b.walk && b.gun.side !== side) : []);
    for (const b of pool) { const d = b.lp.distanceTo(c.lp); if (d < bd) { bd = d; pick = b; } }
    if (!pick) continue;
    if (pick.gun) { if (pick.gun.user === pick) pick.gun.user = null; pick.gun = null; }
    pick.walk = { gun: c, to: gunnerSpot(s, c), via: null };
    c.claim = pick; c.emptyT = 0;
  }
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
  crewTick(dt);
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
    crewGuns(s, target, dt);
    let want = s.yaw, thr = 1;
    // nobody's ship left to fight: go after the people in the water (it's how castaways get a ship to board)
    let swimmer = null, sd = 300;
    if (!target || td > 320) for (const p of G.players) {
      if (!p.alive || p.frame || p.team === s.team) continue;
      const w = p.worldPos(v1), d = Math.hypot(w.x - s.x, w.z - s.z);
      if (d < sd) { sd = d; swimmer = { x: w.x, z: w.z }; }
    }
    const zone = G.game?.zone, outZone = zone && Math.hypot(s.x - zone.x, s.z - zone.z) > zone.r * 0.85;
    if (outZone) { want = Math.atan2(zone.x - s.x, zone.z - s.z); thr = 3; }
    else if (swimmer) { want = Math.atan2(swimmer.x - s.x, swimmer.z - s.z); thr = sd > 70 ? 2 : sd > 22 ? 1 : 0; }
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
  const err = DIFF.aim * (s.ghost ? 0.6 : 1);
  for (const c of s.cannons) {
    if (!gunnerOk(c)) continue;      // no sailor at the gun = it doesn't fire
    aimAndFire(s, c, target, dist, err, s.ghost ? 0.7 : 1, { isBot: true, ship: s });
  }
}
// lead the target, turn and lift the gun, and fire when it bears. err = how sloppy (1 = normal)
function aimAndFire(s, c, target, dist, err, reloadMul, owner) {
  if (c.cd > 0 || c.over) return false;
  const T = cannonOf(c);
  const range = T.proj === 'torpedo' ? 170 : T.proj === 'mortar' ? 150 : T.proj === 'ac' ? 120 : 190;
  if (dist > range) return false;
  const lead = s.velocity(v3).clone(), tv = target.velocity(v2);
  const flight = dist / (T.proj === 'torpedo' ? 22 : T.speed * 0.9);
  const aimX = target.x + tv.x * flight - lead.x * flight * 0.3, aimZ = target.z + tv.z * flight - lead.z * flight * 0.3;
  const rel = s.toLocal(v1.set(aimX, s.y + s.deckTop, aimZ)).sub(c.lp);
  // the gun points (side · cos yaw, sin yaw) in ship space; is the target inside its swing?
  let yaw = Math.atan2(rel.z, rel.x * c.side);
  const lo = c.ymin ?? -T.yaw, hi = c.ymax ?? T.yaw;
  if (yaw > hi) yaw -= Math.PI * 2; else if (yaw < lo) yaw += Math.PI * 2;
  if (yaw < lo || yaw > hi) return false;
  const d = Math.hypot(rel.x, rel.z), g = (T.grav || 9.8), v = T.speed;
  const s2 = clamp(g * d / (v * v), -1, 1);
  const pitch = T.proj === 'torpedo' ? 0 : T.proj === 'mortar' ? Math.PI / 2 - 0.5 * Math.asin(s2) : 0.5 * Math.asin(s2);
  c.yaw = yaw + rand(-0.04, 0.04) * err;
  c.pitch = clamp(pitch + rand(-0.03, 0.035) * err, T.pmin, T.pmax);
  if (Math.random() < (T.heat ? 0.9 : 0.6)) return fireCannon(s, c, owner, reloadMul);
  return false;
}

// ================= YOUR CREW (hired in the Garage) =================
// They are Bots on your ship's team with a `crew` record { role, rank, name, post }. The host runs them.
function gunsForPost(s, post) { return s.cannons.filter(c => post === 'bow' || post === 'stern' ? c.turret === post : c.pair === post); }
// where each crew member works on this ship
export function crewPost(s, m, list) {
  const nth = list.filter(x => x.role === m.role).indexOf(m);
  const holdX = clamp(s.hw * 0.35, 0.7, 1.6);
  if (m.role === 'gunner') { const g = gunsForPost(s, m.post)[0]; if (g) return gunnerSpot(s, g); }
  if (m.role === 'carpenter') { const c = s.comps[2 - (nth % 2)]; return new THREE.Vector3(-holdX, VS_FLOOR, c.cz + nth * 0.8); }
  if (m.role === 'bailer') { const c = s.comps[1]; return new THREE.Vector3(holdX, VS_FLOOR, c.cz - 0.8 + nth * 0.9); }
  if (m.role === 'helmsman') return new THREE.Vector3(s.wheelLp.x - 1.0, s.deckTop, s.wheelLp.z - 0.4 - nth * 0.8);
  const spots = s.crewSpots(6);
  return spots[(nth * 2 + 1) % spots.length].clone();          // marines (and a gunner with no gun on this ship)
}
const VS_FLOOR = 0.2;          // the hold floor (one block up)
// put this ship's crew aboard (again): the old ones (dead or alive) go, fresh ones come at their posts
export function spawnCrew(s, list) {
  for (const b of G.bots) if (b.crew && (b.ship === s || b.ship.gone || b.ship.sunk || b.crewShip === s)) { b.leaveGun(); b.mesh.parent?.remove(b.mesh); b.gone = true; G.netHook?.('despawn', 'bot', b); }
  G.bots = G.bots.filter(b => !b.gone);
  s.crewList = list = (list || []).slice(0, 8);
  const bots = list.map(m => {
    const b = new Bot(s, crewPost(s, m, list), { hp: 80, name: m.name, id: null });
    b.hp = b.maxHp = 80 + 20 * m.rank;
    b.crew = m; b.crewShip = s;
    if (m.role === 'gunner') { const g = gunsForPost(s, m.post).find(c => !c.user); if (g) { b.gun = g; g.user = b; } }
    return b;
  });
  G.bots.push(...bots);
  for (const b of bots) G.netHook?.('spawn', 'bot', b);
  return bots;
}
function crewTick(dt) {
  const byShip = new Map();
  for (const b of G.bots) if (b.crew && b.alive && !b.ship.sunk && !b.ship.gone) { let a = byShip.get(b.ship); if (!a) byShip.set(b.ship, a = []); a.push(b); }
  for (const [s, crew] of byShip) {
    let target = null, td = 260;
    for (const o of enemiesOf(s)) { if (o.sinking) continue; const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < td) { td = d; target = o; } }
    for (const b of crew) {
      const m = b.crew, R = m.rank;
      if (m.role === 'gunner') crewGunner(s, b, target, td);
      else if (m.role === 'carpenter') {
        b.workT = (b.workT ?? 1) - dt;
        if (b.workT <= 0) { b.workT = CREW_FX.carpenter.every[R]; crewFixOne(s, b); }
      } else if (m.role === 'bailer') {
        const c = s.comps.reduce((a, x) => x.vol > a.vol ? x : a, s.comps[0]);
        if (c.vol > 0.02) { c.vol = Math.max(0, c.vol - CREW_FX.bailer.rate[R] * dt); b.mesh.rotation.y += dt * 2; }
      } else if (m.role === 'helmsman') crewHelm(s, b, target, td);
    }
  }
}
function crewGunner(s, b, target, td) {
  const guns = gunsForPost(s, b.crew.post);
  if (!guns.length || b.walk) return;                    // that mount isn't on this ship: he fights like a marine
  if (b.gun && b.gun.user !== b) b.gun = null;           // a player took the gun over
  let want = guns.includes(b.gun) ? b.gun : guns[0];
  if (target && guns.length > 1) { const side = Math.sign(s.toLocal(v1.set(target.x, s.y, target.z)).x) || 1; want = guns.find(c => c.side === side) || want; }
  if (want.user && want.user !== b) { if (!b.gun) want = guns.find(c => !c.user) || null; if (!want) return; }
  if (b.gun !== want) {                                   // run over to the gun that faces the enemy
    if (want.user) return;
    if (b.gun?.user === b) b.gun.user = null;
    b.gun = null;
    b.walk = { gun: want, to: gunnerSpot(s, want), via: null }; want.claim = b;
    return;
  }
  if (target && td < 200) aimAndFire(s, want, target, td, CREW_FX.gunner.err[b.crew.rank], CREW_FX.gunner.reload[b.crew.rank], b);
}
// the carpenter: the lowest hole first (that's what floods)
function crewFixOne(s, b) {
  let best = -1, bj = Infinity;
  for (const n of s.holes) { const j = ((n / s.nx) | 0) % s.ny; if (j < bj) { bj = j; best = n; } }
  if (best < 0 || !s.restoreCell(best)) return;
  const [i, j, k] = s.ijk(best);
  const p = s.toWorld(v1.set(s.xOf(i), s.yOf(j), s.zOf(k)));
  FX.dust?.(p.x, p.y, p.z, new THREE.Color('#b39b6e'));
  if (Math.random() < 0.5) sfx.knock?.(p);
  b.mesh.rotation.y = Math.atan2(s.xOf(i) - b.lp.x, s.zOf(k) - b.lp.z);
}
// the helmsman: only when nobody's at the helm. Turns a broadside to the nearest enemy and keeps ~70 m off;
// keeps off the rocks. With no enemy around he leaves the course alone.
function crewHelm(s, b, target, td) {
  if (s.driver && s.driver.alive !== false) return;
  if (s.anchor.state !== 'up' || s.sinking) return;
  const gain = CREW_FX.helmsman.gain[b.crew.rank];
  let want = null, thr = s.throttle;
  if (target) {
    const bearing = Math.atan2(target.x - s.x, target.z - s.z);
    const a1 = bearing + Math.PI / 2, a2 = bearing - Math.PI / 2;
    want = Math.abs(angDiff(s.yaw, a1)) < Math.abs(angDiff(s.yaw, a2)) ? a1 : a2;
    const toward = Math.sign(angDiff(want, bearing));
    if (td > 95) want += toward * 0.5; else if (td < 45) want -= toward * 0.5;
    thr = 2;
  }
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  for (const look of [18, 34]) {
    if (groundHeight(s.x + fx * look, s.z + fz * look) > s.y - 0.5) {
      const lft = groundHeight(s.x + Math.sin(s.yaw + 0.8) * look, s.z + Math.cos(s.yaw + 0.8) * look);
      const rgt = groundHeight(s.x + Math.sin(s.yaw - 0.8) * look, s.z + Math.cos(s.yaw - 0.8) * look);
      want = s.yaw + (lft < rgt ? 1.2 : -1.2); thr = Math.min(thr, look < 20 ? 1 : 2);
      break;
    }
  }
  if (want == null) return;
  s.throttle = thr;
  s.rudderIn = clamp(-angDiff(s.yaw, want) * 1.2 * gain, -1, 1);
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
    if (by?.isPlayer && (by.team || 'player') === this.team) return;       // you can't hurt your own crew
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false; this.deadT = 0; this.leaveGun();
      if (by?.isPlayer) { if (!by.isRemote) by.kills++; G.announceKill?.(this, by, kind); G.toast?.(this.captain ? `☠️ You killed captain ${this.name}!` : '☠️ Enemy sailor down.', this.captain ? 'good' : ''); }
      G.game?.onBotDeath?.(this, by, kind);
    }
  }
  leaveGun() {
    if (this.gun && this.gun.user === this) this.gun.user = null;
    if (this.walk?.gun?.claim === this) this.walk.gun.claim = null;
    this.gun = null; this.walk = null;
  }
  // walking to an empty gun along the deck: to the other side only where the deck is clear (no superstructure,
  // no containers), then along the gun's side
  walkTo(dt) {
    const w = this.walk, s = this.ship, c = w.gun;
    if (gunnerOk(c) || c.user?.isPlayer) { if (c.claim === this) c.claim = null; this.walk = null; return; }   // someone beat us to it
    if (!w.via) {
      const y = this.lp.y, to = w.to;
      w.via = [];
      if (Math.sign(this.lp.x || 1) !== Math.sign(to.x || 1)) {
        let best = null, bs = Infinity;
        for (let k = 2; k < s.nz - 2; k++) {
          if (s.blockedAt(k) > 0.3) continue;
          const z = s.zOf(k), sc = Math.abs(z - this.lp.z) + Math.abs(z - to.z);
          if (sc < bs) { bs = sc; best = z; }
        }
        if (best != null) w.via.push(new THREE.Vector3(this.lp.x, y, best), new THREE.Vector3(to.x, y, best));
      } else w.via.push(new THREE.Vector3(to.x, y, this.lp.z));
      w.via.push(to.clone());
    }
    const goal = w.via[0];
    const d = v2.copy(goal).sub(this.lp); d.y = 0;
    const len = d.length(), step = 2.6 * dt;
    if (len > 0.01) this.mesh.rotation.y = Math.atan2(d.x, d.z);
    if (len > step) this.lp.addScaledVector(d, step / len);
    else {
      this.lp.copy(goal); w.via.shift();
      if (!w.via.length) { this.gun = c; c.user = this; if (c.claim === this) c.claim = null; this.walk = null; }
    }
    this.lp.y = s.deckTop;
    this.mesh.position.copy(this.lp);
    this.mesh.position.y += Math.abs(Math.sin(G.t * 9)) * 0.05;      // a little bob as he runs
  }
  update(dt) {
    const s = this.ship;
    if (isGuest()) {      // mirror only: the host decides who shoots and who dies
      if (this.alive) {
        if (this.netRot != null) this.mesh.rotation.y += angDiff(this.mesh.rotation.y, this.netRot) * Math.min(1, dt * 10);
        if (this.netLp) { this.lp.lerp(this.netLp, Math.min(1, dt * 8)); this.mesh.position.copy(this.lp); }
        return;
      }
      this.deadT += dt;
      this.mesh.rotation.x = Math.min(Math.PI / 2, this.deadT * 4);
      this.mesh.position.y = this.lp.y + 0.15;
      return;
    }
    if (this.alive && !s.sunk && this.walk) return this.walkTo(dt);
    if (!this.alive || s.sunk) {
      if (this.alive || this.gun || this.walk) this.leaveGun();
      if (this.alive) { this.alive = false; G.game?.onBotDeath?.(this, s.lastHitBy, 'drown'); }
      this.deadT += dt;
      this.mesh.rotation.x = Math.min(Math.PI / 2, this.deadT * 4);
      this.mesh.position.y = this.lp.y + 0.15;
      if (this.deadT > 8 || s.gone) { this.mesh.parent?.remove(this.mesh); this.gone = true; }
      return;
    }
    const c = this.center(v1);
    // a gunner works his gun (faces where it points) and only grabs his rifle for boarders close by
    if (this.gun) { const g = this.gun; this.mesh.rotation.y = Math.atan2(g.side * Math.cos(g.yaw), Math.sin(g.yaw)); }
    // your crew: marines shoot far, the others only defend themselves close up
    const role = this.crew?.role;
    let target = null, bd = this.gun ? 14 : role && role !== 'marine' && role !== 'gunner' ? 10 : 95;
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
    // only shoot what can actually be seen: no shots through hulls, decks or walls
    const head = pc.clone(); head.y += 0.6;
    if (!seen(c, pc) && !seen(c, head)) { this.cd = 0.6; return; }
    this.cd = rand(0.9, 2.0) * (s.ghost ? 0.8 : 1);
    sfx.shot('ak', c);
    const marine = role === 'marine' ? this.crew.rank : 0;
    const chance = clamp(0.5 - bd / 200, 0.12, 0.5) * (target.swimming ? 0.6 : 1) * (this.crew ? (marine ? CREW_FX.marine.acc[marine] : 1) : 1 / DIFF.aim);
    const end = Math.random() < chance ? pc : pc.clone().add(v3.set(rand(-2, 2), rand(-1, 1.5), rand(-2, 2)));
    FX.tracer(c, end);
    G.netFx?.({ k: 'tr', a: [c.x, c.y, c.z], b: [end.x, end.y, end.z] });
    if (end === pc) target.hurt(this.crew ? (marine ? CREW_FX.marine.dmg[marine] : 7) : 7 * DIFF.dmg, this, 'bullet');
  }
}
// a clear line between two world points: no ship block in the way (the last 0.35 m is the target's own body)
function seen(from, to) {
  const d = to.clone().sub(from), len = d.length();
  if (len < 0.8) return true;
  d.divideScalar(len);
  const o = from.clone().addScaledVector(d, 0.4);
  for (const s of G.ships) {
    if (s.gone || s.sunk) continue;
    if (Math.hypot(s.x - from.x, s.z - from.z) > s.hl + s.hw + len + 2) continue;
    if (s.raycast(o, d, len - 0.4 - 0.35)) return false;
  }
  return true;
}
export function clearBots() { for (const b of G.bots) b.mesh.parent?.remove(b.mesh); G.bots = []; }
