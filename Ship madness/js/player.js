// The local player: first-person movement that rides on moving ships (positions are kept in the ship's
// own space while aboard), swimming, ladders, the helm, the crane, deck guns, tools (bucket, hammer, wrench),
// carrying planks and furniture, and putting out fires. Online, guests ask the host (act) for anything that
// changes the world.
import * as THREE from 'three';
import { G, P, clamp, S, rand, lerp, damp, isGuest, isOnline } from './state.js';
import { waveHeight } from './ocean.js';
import { groundHeight } from './islands.js';
import { VS, T, PLANK_FIX, FURN_K, THROTTLE_NAME } from './ship.js';
import { IN } from './input.js';
import { down, hit, kn, BINDS } from './keys.js';
import { Gunner, makeInventory, WEAPONS, fireCannon, arcPoints, PRIMARIES, gunState, gunStats, PSPEC } from './weapons.js';
import { cannonOf } from './cannons.js';
import { holdItem, dropItem, destroyItem, makeItem, itemWorld, crateWorld, removeCrate, hookCrate, releaseCrate, updateStorage, LOOT, raySphere, HEAVY } from './entities.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';
import { showRepair, showLeaks } from './repairfx.js';

const HALF = 0.3, HEIGHT = 1.7, EYE = 1.6;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const act = (...a) => G.netAct(...a);
const arr = v => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
const pct = v => Math.round(v) + '%';

export class Player {
  constructor(kit, name = P.name) {
    this.id = G.net.id; this.name = name; this.isPlayer = true; this.kit = kit; this.skill = kit.loadout.skill; this.team = 'player';
    this.frame = null; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.alive = true; this.respawnT = 0; this.oxygen = 1; this.out = false;
    this.swimming = false; this.inSea = false; this.underwater = false; this.onGround = false; this.climbing = false;
    this.groundT = 0; this.jumpBuf = 0; this.ladder = null; this.toolT = 0; this.gunZoom = 1;
    this.mode = 'walk'; this.station = null; this.holding = null; this.chase = false; this.busy = false;
    this.inv = makeInventory(kit); this.slot = 'primary';
    this.kills = 0; this.sunk = 0; this.home = null; this.fireT = 0;
    this.gun = new Gunner(this);
    this.prompt = ''; this.hurtT = 0;
    this.aim = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.7 }));
    this.aim.frustumCulled = false; this.aim.visible = false;
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide }));
    this.aimRing.renderOrder = 9; this.aimRing.visible = false;
    G.scene.add(this.aim, this.aimRing);
  }
  dispose() { this.gun.dispose(); G.scene.remove(this.aim, this.aimRing); }

  // ---------- frames ----------
  worldPos(out = new THREE.Vector3()) { out.copy(this.pos); return this.frame ? this.frame.toWorld(out) : out; }
  eyeWorld(out = new THREE.Vector3()) { out.copy(this.pos); out.y += EYE; return this.frame ? this.frame.toWorld(out) : out; }
  center(out = new THREE.Vector3()) { out.copy(this.pos); out.y += 1.0; return this.frame ? this.frame.toWorld(out) : out; }
  worldYaw() { return this.yaw + (this.frame ? this.frame.yaw : 0); }
  forwardLocal(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  attach(ship) {
    const wp = this.worldPos(v1);
    const wv = v2.copy(this.vel).sub(ship.velocity(v3));
    this.pos.copy(ship.toLocal(wp.clone()));
    const len = wv.length();
    this.vel.copy(ship.dirToLocal(wv.normalize())).multiplyScalar(len);
    this.yaw -= ship.yaw;
    this.frame = ship;
  }
  detach() {
    const s = this.frame;
    if (!s) return;
    const len = this.vel.length();
    const wv = s.dirToWorld(this.vel.clone().normalize()).multiplyScalar(len).add(s.velocity(v3));
    this.pos.copy(s.toWorld(this.pos.clone()));
    this.vel.copy(wv);
    this.yaw += s.yaw;
    this.frame = null;
  }
  // spawn on a free spot of the deck (never inside a wall), looking at the helm console
  placeOn(ship, lp) {
    this.frame = ship; this.vel.set(0, 0, 0); this.pitch = -0.15;
    this.pos.copy(this.freeSpot(ship, lp));
    const dx = ship.wheelLp.x - this.pos.x, dz = ship.wheelLp.z - this.pos.z;
    this.yaw = Math.hypot(dx, dz) > 0.3 ? Math.atan2(-dx, -dz) : Math.PI;
  }

  // ---------- damage ----------
  hitTest(o, d, max) {
    const c = this.center(v1);
    const t = raySphere(o, d, c, 0.45);
    const h = raySphere(o, d, v2.copy(c).add(v3.set(0, 0.62, 0)), 0.22);
    if (h != null && h <= max && (t == null || h < t)) return { dist: h, head: true };
    return t != null && t <= max ? { dist: t } : null;
  }
  hurt(amount, by, kind, from) {
    if (!this.alive || G.admin.god) return;
    this.hp -= amount; this.hurtT = 0.4;
    this.lastHurt = by;
    sfx.hurt();
    if (from && kind === 'boom') {
      const push = this.center(v1).sub(from).normalize().multiplyScalar(Math.min(12, amount * 0.15));
      if (this.mode === 'ladder') this.leaveLadder();
      this.vel.add(this.frame ? this.frame.dirToLocal(push.clone()).multiplyScalar(push.length()) : push);
    }
    if (this.hp <= 0) this.die(by, kind);
  }
  die(by, kind) {
    this.hp = 0; this.alive = false; this.respawnT = 5;
    this.leaveStation();
    if (this.holding) this.drop();
    const how = { shark: 'were eaten by a shark', nuke: 'were nuked', drown: 'drowned', boom: 'were blown up', cannon: 'were hit by a shell', fire: 'burned', storm: 'were caught in the storm' }[kind] || 'were shot';
    G.toast?.(`💀 You ${how}${by?.name ? ' by ' + by.name : ''}.`, 'bad');
    if (isGuest()) { act('died', by?.id ?? null, kind); G.game?.onDeath?.(this, by, kind); }
    else { if (isOnline()) G.announceKill?.(this, by, kind); G.game?.onDeath?.(this, by, kind); }
  }
  // you keep what you found (picked-up weapons, airstrike, nuke); the guns get their ammo back
  respawn() {
    this.hp = 100; this.oxygen = 1; this.alive = true;
    const ship = G.game?.respawnShip?.(this);
    if (ship) this.placeOn(ship, ship.spawnSpot(Math.floor(Math.random() * 4)));
    else { this.frame = null; this.pos.set(0, 2, 0); }
    for (const k of ['primary', 'secondary']) { const g = this.inv[k]; if (g) { g.mag = g.magMax; g.reserve = Math.max(g.reserve, WEAPONS[g.id].reserve); } }
    if (this.inv.gadget) this.inv.gadget.count = Math.max(this.inv.gadget.count, WEAPONS[this.inv.gadget.id].count || 0);
    if (this.inv.bucket) this.inv.bucket.amount = 0;
    if (!this.inv[this.slot]) this.slot = 'primary';
  }
  leaveStation() {
    const s = this.station;
    if (this.mode === 'wheel') {
      if (isGuest()) act('helm', s.id, false);
      else { if (s.driver === this) s.driver = null; s.rudderIn = 0; }
    }
    if (this.mode === 'crane') {
      if (isGuest()) act('crane', s.id, false);
      if (s.crane.user === this) s.crane.user = null;
    }
    if (this.mode === 'cannon') {
      const { ship, c } = s;
      if (isGuest()) act('cannon', ship.id, ship.cannons.indexOf(c), false);
      c.user = null;
      this.pos.copy(this.freeSpot(ship, this.pos));     // never leave the gun inside a wall
      this.vel.set(0, 0, 0);
    }
    if (this.mode === 'ladder') this.ladder = null;
    this.mode = 'walk'; this.station = null; this.aim.visible = false; this.aimRing.visible = false;
  }
  // the nearest spot around `p` (ship space) where a player fits and has a floor under their feet
  freeSpot(s, p) {
    const ok = (x, y, z) => !this.collides(s, x, y, z) && !!s.solidAt(x, y - 0.1, z);
    if (ok(p.x, p.y, p.z)) return p.clone();
    for (let r = 0.3; r <= 3.6; r += 0.3) for (let a = 0; a < 16; a++) {
      const x = p.x + Math.cos(a / 16 * Math.PI * 2) * r, z = p.z + Math.sin(a / 16 * Math.PI * 2) * r;
      for (const dy of [0, VS, -VS, 2 * VS]) if (ok(x, p.y + dy, z)) return new THREE.Vector3(x, p.y + dy, z);
    }
    return s.driverLp.clone();
  }
  // where the gunner stands: beside the gun on the walkway, not inside the superstructure
  gunStand(s, c) {
    if (c.stand) return c.stand;
    for (const [dx, dz] of [[0, -1.1], [0, 1.1], [-c.side * 0.9, -0.9], [-c.side * 0.9, 0.9], [-c.side * 1.0, 0]]) {
      const x = c.lp.x + dx, z = c.lp.z + dz;
      if (!this.collides(s, x, c.lp.y + 0.02, z)) return (c.stand = new THREE.Vector3(x, c.lp.y + 0.02, z));
    }
    return (c.stand = this.freeSpot(s, c.lp.clone()));
  }

  // ---------- main update ----------
  update(dt) {
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (!this.alive) {
      if (!this.out) { this.respawnT -= dt; if (this.respawnT <= 0) this.respawn(); }
      this.gun.update(dt, false, false, false);
      return;
    }
    if (this.frame && (this.frame.sunk || this.frame.gone)) { this.leaveStation(); this.detach(); }
    const wasWalk = this.mode === 'walk';
    const st = this.gun.stats();
    const zoom = st ? lerp(1, st.zoom, this.gun.ads) : 1;
    const sens = 0.0022 * S.sens / zoom;
    if (this.mode === 'walk' || this.mode === 'wheel' || this.mode === 'ladder') {
      this.yaw -= IN.mdx * sens; this.pitch = clamp(this.pitch - IN.mdy * sens * (S.invertY ? -1 : 1), -1.5, 1.5);
    }
    if (this.mode === 'wheel') this.updateWheel(dt);
    else if (this.mode === 'crane') this.updateCrane(dt, sens);
    else if (this.mode === 'cannon') this.updateCannon(dt);
    else if (this.mode === 'ladder') this.updateLadder(dt);
    else this.updateWalk(dt);
    this.updateBreath(dt);
    this.updateFire(dt);
    if (wasWalk && this.mode === 'walk') this.prompt = this.findInteract();
    else if (this.mode === 'walk') this.prompt = '';
    const moving = this.mode === 'walk' && (down('forward') || down('left') || down('back') || down('right'));
    this.gun.update(dt, this.mode === 'walk' && !this.holding && !this.climbing, moving, moving && down('sprint') && down('forward') && !this.swimming);
    this.updateTools(dt, moving);
    this.updateRepairFx(dt);
  }

  // green preview of what a plank / furniture / the hammer fixes; red markers on holes that let the sea in
  updateRepairFx(dt) {
    this.fxT = (this.fxT || 0) - dt;
    if (this.fxT > 0) return;
    this.fxT = 0.1;
    const h = this.holding, s = this.frame;
    const repairing = this.mode === 'walk' && h;
    const hammer = this.mode === 'walk' && !h && this.slot === 'hammer';
    if (repairing) {
      const eye = this.eyeWorld(new THREE.Vector3()), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
      const spot = this.repairSpot(eye, dir);
      const carp = this.skill === 'carpenter';
      if (spot) showRepair(spot.ship, h.kind === 'plank' ? spot.ship.repairPreview(spot.p, 1.2, PLANK_FIX) : spot.ship.repairPreview(spot.p, 0.9, Math.round(h.def.fix * 4 * FURN_K * (carp ? 2 : 1))));
      else showRepair(null, []);
    } else if (hammer && this.hamTarget) showRepair(this.hamTarget.ship, [this.hamTarget.n]);
    else showRepair(null, []);
    const inHold = s && this.mode === 'walk' && this.pos.y < s.deckTop - 0.3;
    if (s && (repairing || hammer || inHold || this.slot === 'bucket')) showLeaks(s, this.pos);
    else showLeaks(null, null);
  }

  updateBreath(dt) {
    if (this.underwater) {
      this.oxygen -= dt / (this.skill === 'lungs' ? 36 : 18);
      if (this.oxygen <= 0) { this.oxygen = 0; this.drownT = (this.drownT || 0) - dt; if (this.drownT <= 0) { this.drownT = 1; this.hurt(15, null, 'drown'); } }
    } else this.oxygen = Math.min(1, this.oxygen + dt / 3);
  }
  updateFire(dt) {
    const s = this.frame;
    if (!s || !s.fires.length) return;
    this.fireT -= dt;
    for (const f of s.fires) {
      if (Math.hypot(f.lp.x - this.pos.x, f.lp.z - this.pos.z) < 0.9 && Math.abs(f.lp.y - this.pos.y) < 1.2) {
        if (this.fireT <= 0) { this.fireT = 0.5; this.hurt(6, null, 'fire'); }
        break;
      }
    }
  }

  medium() {
    const wp = this.worldPos(v1);
    const sea = waveHeight(wp.x, wp.z);
    let surface = null, inSea = false;
    if (this.frame && this.frame.insideHull(this.pos) && this.pos.y < this.frame.H * VS) {
      const c = this.frame.compAtLocal(this.pos);
      if (c && c.vol > 0.05) surface = c.level;
    } else if (wp.y < sea) { surface = this.frame ? this.pos.y + (sea - wp.y) : sea; inSea = true; }
    const eyeY = this.pos.y + EYE;
    return { surface, inSea, swim: surface != null && this.pos.y + 1.15 < surface, under: surface != null && eyeY < surface };
  }

  updateWalk(dt) {
    const s = this.frame;
    const m = this.medium();
    this.swimming = m.swim; this.inSea = m.inSea && m.swim; this.underwater = m.under;
    this.underKind = m.under ? (m.inSea ? 'sea' : 'hull') : null; this.underDepth = m.under ? m.surface - (this.pos.y + EYE) : 0;
    const f = this.forwardLocal(v2), r = v3.set(-f.z, 0, f.x);
    let wx = 0, wz = 0;
    if (down('forward')) { wx += f.x; wz += f.z; }
    if (down('back')) { wx -= f.x; wz -= f.z; }
    if (down('right')) { wx += r.x; wz += r.z; }
    if (down('left')) { wx -= r.x; wz -= r.z; }
    const wl = Math.hypot(wx, wz) || 1; wx /= wl; wz /= wl;
    const heavy = this.holding && HEAVY.has(this.holding.kind) && this.skill !== 'strong';
    const sprint = down('sprint') && !heavy;
    const legs = this.skill === 'sealegs' ? 1.4 : 1;
    let speed = this.swimming ? (sprint ? 4.4 : 3.2) * legs : (sprint ? 7 : 4.6);
    if (heavy) speed *= 0.75;
    speed *= 1 - this.gun.ads * 0.4;
    const w = this.inv[this.slot] && WEAPONS[this.inv[this.slot].id];
    if (w?.slow && !this.holding) speed *= w.slow;
    // wading through flood water in the hold slows you down and splashes
    const wade = !m.inSea && !this.swimming && m.surface != null ? m.surface - this.pos.y : 0;
    if (wade > 0.12) {
      speed *= clamp(1 - wade * 0.5, 0.5, 1);
      if ((wx || wz) && this.onGround) {
        this.wadeT = (this.wadeT || 0) - dt;
        const wp = this.worldPos(new THREE.Vector3()); wp.y += wade;
        if (Math.random() < dt * 10) FX.spray(wp.x, wp.y, wp.z, rand(-0.4, 0.4), 0.6, rand(-0.4, 0.4), 0.35);
        if (this.wadeT <= 0) { this.wadeT = sprint ? 0.3 : 0.5; sfx.splash(null, 0.25); }
      }
    }
    const acc = this.onGround || this.swimming ? 14 : 3;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, acc * dt);

    // ladders: walk into one from the water (or below it) and you grab it
    this.climbing = false;
    if (down('forward') && !this.holding) {
      const L = this.ladderInReach();
      if (L) { this.enterLadder(L.s, L.L, L.y); return; }
    }
    // jumping: a short "coyote" window after leaving the ground and a buffered key press, so it always works
    this.jumpBuf = hit('jump') ? 0.2 : Math.max(0, this.jumpBuf - dt);
    this.groundT = this.onGround ? 0.15 : Math.max(0, this.groundT - dt);
    this.jumped = false;
    if (this.swimming) {
      let target = m.surface - 1.35;
      if (down('dive')) target = m.surface - 6;
      if (down('jump')) target = m.surface - 0.9;
      this.vel.y += ((target - this.pos.y) * 4 - this.vel.y * 2.5) * dt;
    } else {
      this.vel.y -= 20 * dt;
      if (this.jumpBuf > 0 && this.groundT > 0) { this.vel.y = 7 * (wade > 0.4 ? 0.75 : 1); this.jumpBuf = 0; this.groundT = 0; this.jumped = true; }
    }
    this.onGround = false;
    if (s) this.moveInShip(s, dt);
    else this.moveInWorld(dt);
    if (this.frame && !this.frame.inBox(this.pos, 0.7)) this.detach();
    else if (!this.frame) {
      for (const sh of G.ships) {
        if (sh.sunk) continue;
        const lp = sh.toLocal(v1.copy(this.pos));
        if (sh.inBox(lp, 0.3)) { this.attach(sh); break; }
      }
    }
    this.useHands();
  }

  collides(s, x, y, z) {
    const i0 = Math.floor((x - HALF) / VS + s.nx / 2), i1 = Math.floor((x + HALF) / VS + s.nx / 2);
    const k0 = Math.floor((z - HALF) / VS + s.nz / 2), k1 = Math.floor((z + HALF) / VS + s.nz / 2);
    const j0 = Math.floor((y + 0.01) / VS), j1 = Math.floor((y + HEIGHT) / VS);
    let worst = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const t = s.get(i, j, k);
      if (t === T.RAIL) return t;
      if (t) worst = t;
    }
    return worst;
  }
  moveInShip(s, dt) {
    const p = this.pos;
    for (const ax of ['x', 'z']) {
      const d = this.vel[ax] * dt;
      if (!d) continue;
      const nx = ax === 'x' ? p.x + d : p.x, nz = ax === 'z' ? p.z + d : p.z;
      const h = this.collides(s, nx, p.y, nz);
      if (!h) { p[ax] += d; continue; }
      const canStep = (this.onGroundPrev || this.swimming || this.groundT > 0) && h !== T.RAIL && !this.collides(s, nx, p.y + VS + 0.02, nz) && !this.collides(s, p.x, p.y + VS + 0.02, p.z);
      if (canStep) { p.y += VS + 0.02; p[ax] += d; }
      else this.vel[ax] = 0;
    }
    const dy = this.vel.y * dt;
    if (this.collides(s, p.x, p.y + dy, p.z)) {
      if (dy < 0) { this.onGround = true; p.y = (Math.floor((p.y + dy) / VS) + 1) * VS; }
      this.vel.y = 0;
    } else p.y += dy;
    // standing on something counts as ground even on frames where gravity hasn't pulled us into it yet
    if (!this.onGround && this.vel.y <= 0.01 && this.collides(s, p.x, p.y - 0.06, p.z)) this.onGround = true;
    this.onGroundPrev = this.onGround;
  }
  moveInWorld(dt) {
    const p = this.pos;
    p.x += this.vel.x * dt; p.z += this.vel.z * dt; p.y += this.vel.y * dt;
    const g = groundHeight(p.x, p.z);
    if (p.y < g + 0.05) { if (p.y < g) p.y = g; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; }
    this.onGroundPrev = this.onGround;
  }

  // ---------- ladders ----------
  ladderInReach() {
    const wp = this.worldPos(new THREE.Vector3());
    for (const s of G.ships) {
      if (s.sunk || Math.hypot(s.x - wp.x, s.z - wp.z) > s.hl + 4) continue;
      const lp = this.frame === s ? this.pos : s.toLocal(wp.clone());
      for (const L of s.ladders) {
        const out = (lp.x - L.x) * L.side;
        if (Math.abs(lp.z - L.z) < 0.8 && out > -0.3 && out < 1.4 && lp.y > L.bottom - 1.8 && lp.y < L.top - 0.35) {
          // only when you face the hull
          const f = this.frame === s ? this.forwardLocal(v2) : s.dirToLocal(v2.set(-Math.sin(this.worldYaw()), 0, -Math.cos(this.worldYaw())));
          if (f.x * -L.side > 0.3) return { s, L, y: clamp(lp.y, L.bottom - 1.2, L.top - 0.4) };
        }
      }
    }
    return null;
  }
  enterLadder(s, L, y) {
    if (this.frame !== s) { if (this.frame) this.detach(); this.attach(s); }
    if (this.holding) this.drop();
    this.mode = 'ladder'; this.ladder = { s, L };
    this.pos.set(L.x + L.side * 0.42, y, L.z); this.vel.set(0, 0, 0);
    this.yaw = L.side * Math.PI / 2;
    this.swimming = this.inSea = false;
  }
  leaveLadder(push = true) {
    const L = this.ladder?.L;
    this.mode = 'walk'; this.ladder = null;
    if (L && push) this.vel.set(L.side * 2.2, 1.5, 0);
  }
  updateLadder(dt) {
    const { s, L } = this.ladder;
    if (s.sunk || s.gone || this.frame !== s) return this.leaveLadder(false);
    const sp = 2.6 * (this.skill === 'sealegs' ? 1.4 : 1);
    let dy = 0;
    if (down('forward')) dy += sp;
    if (down('back')) dy -= sp;
    this.pos.x = L.x + L.side * 0.42; this.pos.z = L.z;
    this.pos.y += dy * dt;
    if (dy && Math.random() < dt * 3) sfx.knock(this.worldPos(new THREE.Vector3()));
    const m = this.medium();
    this.underwater = m.under; this.underKind = m.under ? 'sea' : null; this.underDepth = m.under ? m.surface - (this.pos.y + EYE) : 0;
    this.swimming = false; this.inSea = false; this.climbing = true;
    this.prompt = `🪜 Ladder · ${kn('forward')} climb up · ${kn('back')} climb down · ${kn('jump')} let go`;
    if (this.pos.y >= L.top - 0.3 && down('forward')) {          // over the edge onto the deck
      this.pos.copy(this.freeSpot(s, new THREE.Vector3(L.x - L.side * 0.75, L.top + 0.02, L.z)));
      this.vel.set(0, 0, 0); this.mode = 'walk'; this.ladder = null; this.yaw = -L.side * Math.PI / 2 + Math.PI;
      return;
    }
    if (this.pos.y > L.top - 0.3) this.pos.y = L.top - 0.3;
    if (this.pos.y < L.bottom - 1.3 || hit('jump')) this.leaveLadder(hit('jump'));
  }

  // ---------- interaction ----------
  helmTaken(s) {
    if (isGuest()) return s.driverId && s.driverId !== this.id;
    return s.driver && s.driver.alive && s.driver !== this;
  }
  craneTaken(s) {
    if (isGuest()) return s.craneUserId && s.craneUserId !== this.id;
    return s.crane.user && s.crane.user.alive !== false && s.crane.user !== this;
  }
  interactables() {
    const out = [];
    const s = this.frame;
    const W = (lp, dy) => s.toWorld(new THREE.Vector3().copy(lp).add(new THREE.Vector3(0, dy, 0)));   // fresh vectors for every entry
    if (s) {
      if (!this.helmTaken(s)) out.push({ kind: 'wheel', ship: s, p: W(s.wheelLp, 1.1), label: `Take the helm of the ${s.name}` });
      s.cannons.forEach((c, ci) => { if (!c.user || c.user === this) out.push({ kind: 'cannon', ship: s, c, ci, p: W(c.lp, 0.7), label: `Man the ${cannonOf(c).name.toLowerCase()}` }); });
      if (s.storage) out.push({ kind: 'storage', ship: s, p: W(s.storage.lp, 0.5), label: this.holding?.kind === 'plank' ? 'Put the plank back' : `Take a plank (${s.storage.planks} left)` });
      if (!this.craneTaken(s)) out.push({ kind: 'crane', ship: s, p: W(s.crane.base, s.crane.pedH + 0.4), label: 'Operate the crane' });
      if (s.engineHp < 100) out.push({ kind: 'engine', ship: s, p: W(s.engineLp, 0.6), label: `Engine ${pct(s.engineHp)}${s.engineHp <= 0 ? ' · BROKEN' : ''}: fix it with the wrench (${kn('slot7')})` });
      for (const L of s.ladders) if (this.pos.y > s.deckTop - 0.3) out.push({ kind: 'ladder', ship: s, L, p: W(new THREE.Vector3(L.x - L.side * 0.15, L.top, L.z), 0.6), label: 'Climb down the ladder' });
    }
    for (const it of G.items) if (!it.holder) out.push({ kind: 'item', it, p: itemWorld(it, new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)), label: `Pick up the ${it.def.name.toLowerCase()}${it.def.fix ? ' (patches holes)' : ''}` });
    for (const c of G.crates) if (c.state !== 'fall' && c.state !== 'hook') out.push({ kind: 'crate', c, p: crateWorld(c, new THREE.Vector3()), label: 'Open the supply crate' + (c.loot === 'nuke' ? ' ☢️' : c.loot === 'airstrike' ? ' ✈️' : '') });
    for (const e of G.game?.interactables?.(this) || []) out.push(e);
    return out;
  }
  findInteract() {
    if (!this.alive) return '';
    const eye = this.eyeWorld(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    let best = null, bs = -1;
    for (const o of this.interactables()) {
      const d = o.p.distanceTo(eye);
      if (d > 2.8) continue;
      const dot = v1.copy(o.p).sub(eye).normalize().dot(fwd);
      if (dot < 0.5) continue;
      const score = dot - d * 0.12;
      if (score > bs) { bs = score; best = o; }
    }
    if (hit('use') && best && !this.busy) this.interact(best);
    let hint = best ? `[${kn('use')}] ${best.label}` : '';
    const extra = this.holding ? this.holdHint() : this.toolHint();
    if (extra) hint = (hint ? hint + '   ' : '') + extra;
    return hint;
  }
  holdHint() {
    const h = this.holding;
    if (h.kind === 'plank') return `[LMB] Nail the plank over a hole   [${kn('drop')}] Drop`;
    return `[LMB] Use it to patch a hole   [${kn('drop')}] Drop`;
  }
  toolHint() {
    const b = this.inv.bucket;
    if (this.slot === 'bucket') return this.fillT > 0 ? 'Filling…' : b.amount > 0.05 ? '[LMB] Throw the water (over the railing, or onto a fire)' : '[LMB] Fill the bucket (stand in the flood water)';
    if (this.slot === 'hammer') return this.hamTarget ? '[hold LMB] Hammer the block back in (free)' : 'Hammer: look at a missing block up close';
    if (this.slot === 'wrench') { const s = this.engineAhead(); return s ? (s.engineHp >= 100 ? 'The engine is fine.' : `[hold LMB] Fix the engine (${pct(s.engineHp)})`) : 'Wrench: fix the engine in the stern hold'; }
    return '';
  }
  enterHelm(s) {
    if (this.holding) this.drop();
    this.mode = 'wheel'; this.station = s; if (!isGuest()) s.driver = this;
    this.pos.copy(s.driverLp); this.vel.set(0, 0, 0); this.yaw = Math.PI; this.pitch = -0.1;
    G.toast?.(`Helm: ${kn('forward')}/${kn('back')} throttle (tap or hold) · ${kn('left')}/${kn('right')} rudder · ${kn('anchor')} anchor · ${kn('view')} camera · ${kn('use')} let go`);
  }
  enterCrane(s) {
    if (this.holding) this.drop();
    this.mode = 'crane'; this.station = s; s.crane.user = this;
    this.pos.copy(this.freeSpot(s, s.crane.stand)); this.vel.set(0, 0, 0);
    G.toast?.(`Crane: mouse / ${kn('left')}/${kn('right')} turn · ${kn('forward')}/${kn('back')} boom · ${kn('craneDown')}/${kn('craneUp')} or wheel: hook · ${kn('grab')} grab · ${kn('use')} step away`);
  }
  async interact(o) {
    if (o.use) return o.use(this);
    const guest = isGuest();
    this.busy = true;
    try {
      if (o.kind === 'wheel') {
        if (guest) { if (await act('helm', o.ship.id, true)) this.enterHelm(o.ship); else G.toast?.('Someone else is at the helm.'); }
        else this.enterHelm(o.ship);
      } else if (o.kind === 'crane') {
        if (guest) { if (await act('crane', o.ship.id, true)) this.enterCrane(o.ship); else G.toast?.('Someone else is on the crane.'); }
        else this.enterCrane(o.ship);
      } else if (o.kind === 'cannon') {
        if (guest && !(await act('cannon', o.ship.id, o.ci, true))) return G.toast?.('Someone is using that gun.');
        if (this.holding) this.drop();
        this.mode = 'cannon'; this.station = { ship: o.ship, c: o.c }; o.c.user = this; this.gunZoom = 1;
        this.pos.copy(this.gunStand(o.ship, o.c));
      } else if (o.kind === 'ladder') {
        this.enterLadder(o.ship, o.L, o.L.top - 0.45);
      } else if (o.kind === 'engine') {
        this.gun.switchTo('wrench');
      } else if (o.kind === 'storage') {
        const st = o.ship.storage;
        if (this.holding?.kind === 'plank') {
          const it = this.holding; this.holding = null;
          if (guest) { it.mesh.parent?.remove(it.mesh); act('returnPlank', o.ship.id, it.id); } else { destroyItem(it); st.planks++; updateStorage(o.ship); }
        } else if (this.holding) G.toast?.(`Your hands are full (${kn('drop')} to drop).`);
        else if (st.planks <= 0) G.toast?.('No planks left. Use furniture or the hammer, or find planks in supply crates.');
        else if (guest) {
          const id = await act('takePlank', o.ship.id);
          const it = id && G.items.find(i => i.id === id);
          if (it) { holdItem(it, this); this.holding = it; sfx.wood(); }
        } else { st.planks--; const it = makeItem('plank', null, new THREE.Vector3(0, -50, 0)); holdItem(it, this); this.holding = it; sfx.wood(); updateStorage(o.ship); }
      } else if (o.kind === 'item') {
        if (this.holding) this.drop();
        if (guest && !(await act('pickItem', o.it.id))) return;
        holdItem(o.it, this); this.holding = o.it; sfx.pickup();
      } else if (o.kind === 'crate') {
        if (guest) { const loot = await act('openCrate', o.c.id); if (loot) applyLoot(loot, this); }
        else openCrate(o.c, this);
      }
    } finally { this.busy = false; }
  }
  drop() {
    const it = this.holding;
    if (!it) return;
    this.holding = null;
    dropItem(it, this);
    if (isGuest()) act('dropItem', it.id, it.ship?.id ?? null, arr(it.ship ? it.lp : it.wp));
  }

  // planks and furniture: click on a hole to patch it
  async useHands() {
    const h = this.holding;
    if (!h) return;
    if (hit('drop')) return this.drop();
    if (!IN.lmbHit || this.busy) return;
    const guest = isGuest();
    const eye = this.eyeWorld(new THREE.Vector3()), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    const spot = this.repairSpot(eye, dir);
    if (!spot) return G.toast?.('Look at a hole in a ship (up close) to patch it.');
    const carp = this.skill === 'carpenter';
    let fixed;
    if (guest) {
      this.busy = true;
      fixed = await act('repair', h.id, spot.ship.id, arr(spot.p), h.kind === 'plank', carp);
      this.busy = false;
      if (fixed) { h.mesh.parent?.remove(h.mesh); if (this.holding === h) this.holding = null; }
    } else {
      fixed = h.kind === 'plank' ? spot.ship.repairAt(spot.p, 1.2, PLANK_FIX, carp ? 1 : 0.9) : spot.ship.repairAt(spot.p, 0.9, Math.round(h.def.fix * 4 * FURN_K * (carp ? 2 : 1)), 1);
      if (fixed) { destroyItem(h); this.holding = null; }
    }
    if (fixed) { sfx.hammer(spot.p); G.toast?.(`Patched ${fixed} blocks.`); }
  }
  repairSpot(eye, dir) {
    for (const s of G.ships) {
      if (s.sunk || Math.hypot(s.x - eye.x, s.z - eye.z) > s.hl + 5) continue;
      const h = s.raycast(eye, dir, 3.2);
      const lim = h ? Math.min(3.2, h.dist + 0.4) : 3.2;
      for (let t = 0.3; t <= lim; t += 0.1) {
        const p = eye.clone().addScaledVector(dir, t);
        if (s.missingNear(p, 0.4)) return { ship: s, p };
      }
    }
    return null;
  }

  // ---------- tools (always with you: 5 bucket, 6 hammer, 7 wrench) ----------
  updateTools(dt, moving) {
    const b = this.inv.bucket;
    if (this.fillT > 0) {
      this.fillT -= dt;
      b.amount = (b.fillTo || b.cap) * (1 - Math.max(0, this.fillT) / 0.6);
      if (this.fillT <= 0) { b.amount = b.fillTo || b.cap; sfx.splash(null, 0.4); }
    }
    this.hamTarget = null;
    const tool = WEAPONS[this.inv[this.slot]?.id]?.tool;
    if (!tool || this.mode !== 'walk' || this.holding || this.busy || !this.alive) { this.toolT = 0; return; }
    const eye = this.eyeWorld(new THREE.Vector3()), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    if (this.slot === 'bucket') this.useBucket(dt, moving, eye, dir);
    else if (this.slot === 'hammer') this.useHammer(dt, eye, dir);
    else if (this.slot === 'wrench') this.useWrench(dt, eye, dir);
  }
  // filling takes a moment, sprinting or jumping spills water, a throw flies in an arc
  useBucket(dt, moving, eye, dir) {
    const b = this.inv.bucket, s = this.frame, guest = isGuest();
    b.cap = this.skill === 'strong' ? 6 : 3;
    if (b.amount > 0.05 && this.fillT <= 0) {
      let spill = 0;
      if (moving && down('sprint') && !this.swimming) spill += dt * 0.5;
      if (this.jumped) spill += 0.6;
      if (spill > 0) {
        b.amount = Math.max(0, b.amount - spill);
        const e = this.eyeWorld(v1);
        if (Math.random() < 0.6) FX.spray(e.x, e.y - 0.6, e.z, rand(-0.3, 0.3), -0.2, rand(-0.3, 0.3), 0.4);
        if (b.amount < 0.3) { b.amount = 0; G.toast?.('You spilled the bucket. Walk, don\'t run!'); }
      }
    }
    if (!IN.lmbHit || this.fillT > 0) return;
    if (!(b.amount > 0.05)) {
      const c = s && s.compAtLocal(this.pos);
      if (c && c.vol > 0.05 && c.level > this.pos.y + 0.12) {
        const take = Math.min(b.cap, c.vol);
        if (guest) act('bail', s.id, c.i, take); else c.vol = Math.max(0, c.vol - take);
        b.fillTo = take; this.fillT = 0.6; sfx.splash(null, 0.3); this.gun.swing = 0.6;
      } else if (this.inSea || (!s && this.swimming)) { b.fillTo = b.cap; this.fillT = 0.6; sfx.splash(null, 0.3); G.toast?.('Sea water: good for fires, useless for bailing.'); }
      else G.toast?.('Stand in the flood water below deck to fill the bucket.');
      return;
    }
    this.gun.swing = 1;
    this.throwWater(b, eye, dir);
  }
  // onto a fire it puts it out, back onto a deck half of it runs into the hold, over the side it is gone
  throwWater(b, eye, dir) {
    const guest = isGuest(), amount = b.amount;
    b.amount = 0;
    const p = eye.clone().addScaledVector(dir, 0.5); p.y -= 0.3;
    const vel = dir.clone().multiplyScalar(7.5); vel.y += 2.5;
    if (this.frame) vel.add(this.frame.velocity(v1));
    for (let i = 0; i < 26; i++) FX.spray(p.x, p.y, p.z, vel.x / 4 + rand(-0.25, 0.25), vel.y / 3 + rand(-0.2, 0.3), vel.z / 4 + rand(-0.25, 0.25), 1.1);
    sfx.splash(null, 0.6);
    for (let t = 0; t < 1.8; t += 0.05) {
      vel.y -= 9.8 * 0.05; p.addScaledVector(vel, 0.05);
      for (const s of G.ships) {
        if (s.sunk) continue;
        const lp = s.toLocal(v2.copy(p));
        if (!s.inBox(lp, 0.5)) continue;
        if (s.fires.some(f => f.lp.distanceTo(lp) < 1.8)) {
          if (guest) act('extinguish', s.id, arr(p)); else s.extinguish(p, 2.2);
          for (let i = 0; i < 7; i++) FX.steam(p.x + rand(-1, 1), p.y, p.z + rand(-1, 1));
          G.toast?.('🔥 Fire put out!', 'good');
          return;
        }
        const top = s.topAt(lp.x, lp.z);
        if (top != null && lp.y <= top + 0.1) {
          const k = Math.floor(lp.z / VS + s.nz / 2), ci = s.compOfK(k);
          if (Math.abs(lp.x) < s.halfAt(1, lp.z / s.hl) && amount > 0.2) {
            if (guest) act('pour', s.id, ci, amount * 0.5); else s.comps[ci].vol += amount * 0.5;
            G.toast?.('Half of it ran back into the hold. Throw it over the side!');
          }
          return;
        }
      }
      if (p.y < waveHeight(p.x, p.z)) { FX.splash(p.x, p.y, p.z, 0.5); return; }
    }
  }
  // the hammer puts one block back at a time, for free; it just takes a moment
  useHammer(dt, eye, dir) {
    const spot = this.repairSpot(eye, dir);
    const n = spot ? spot.ship.repairPreview(spot.p, 0.5, 1)[0] : null;
    if (n == null) { this.toolT = 0; if (IN.lmbHit) G.toast?.('Look at a missing block up close to hammer it back in.'); return; }
    this.hamTarget = { ship: spot.ship, n };
    if (!IN.lmb) { this.toolT = 0; return; }
    this.toolT += dt;
    if (this.toolT < (this.skill === 'carpenter' ? 0.32 : 0.48)) return;
    this.toolT = 0; this.gun.swing = 1;
    if (isGuest()) act('hammerCell', spot.ship.id, n); else spot.ship.restoreCell(n);
    sfx.knock(spot.p);
    FX.dust(spot.p.x, spot.p.y, spot.p.z, new THREE.Color('#b39b6e'));
  }
  engineAhead() {
    const eye = this.eyeWorld(new THREE.Vector3()), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    for (const s of G.ships) {
      if (s.sunk || Math.hypot(s.x - eye.x, s.z - eye.z) > s.hl + 3) continue;
      const c = s.toWorld(v1.copy(s.engineLp).add(v2.set(0, 0.55, 0)));
      const d = c.distanceTo(eye);
      if (d < 2.6 && v3.copy(c).sub(eye).normalize().dot(fwd) > 0.6) return s;
    }
    return null;
  }
  useWrench(dt) {
    const s = this.engineAhead();
    if (!s) { this.toolT = 0; if (IN.lmbHit) G.toast?.('Go down to the engine in the stern hold and look at it.'); return; }
    if (!IN.lmb || s.engineHp >= 100) { this.toolT = 0; return; }
    this.toolT += dt;
    this.gun.swing = Math.max(this.gun.swing || 0, 0.5);
    if (this.toolT < 0.25) return;
    const amount = 26 * this.toolT;
    this.toolT = 0;
    sfx.ratchet(this.eyeWorld(v1));
    if (isGuest()) act('fixEngine', s.id, amount);
    else if (s.repairEngine(amount)) G.toast?.('⚙️ The engine is running again!', 'good');
    if (s.engineHp + amount >= 100) G.toast?.('⚙️ Engine fully repaired.', 'good');
  }

  // ---------- stations ----------
  // the helm: hold W / S to move the throttle telegraph (it stops at STOP first), A / D move the rudder
  updateWheel(dt) {
    const s = this.station;
    this.swimming = this.inSea = this.underwater = false; this.underKind = null;
    this.pos.copy(s.driverLp);
    const up = down('forward'), dn = down('back');
    // a tap moves the telegraph half a notch; holding keeps moving it
    if (hit('forward')) { s.throttle = Math.min(3, Math.floor(s.throttle * 2 + 1e-6) / 2 + 0.5); this.detent = 0; this.tapT = 0.35; }
    else if (hit('back')) { s.throttle = Math.max(-1, Math.ceil(s.throttle * 2 - 1e-6) / 2 - 0.5); this.detent = 0; this.tapT = 0.35; }
    this.tapT = Math.max(0, (this.tapT || 0) - dt);
    if ((up || dn) && this.tapT <= 0) {
      const before = s.throttle;
      let t = clamp(before + (up ? 1 : -1) * dt * 1.3, -1, 3);
      if ((before > 0.02 && t <= 0) || (before < -0.02 && t >= 0)) { t = 0; this.detent = 0.6; }
      if (this.detent > 0) { this.detent -= dt; t = 0; }
      s.throttle = t;
    } else this.detent = 0;
    const steer = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    s.rudderIn = steer ? clamp(s.rudderIn + steer * dt * 1.6, -1, 1) : damp(s.rudderIn, 0, 2.5, dt);
    if (hit('anchor')) { if (isGuest()) act('anchor', s.id); else s.toggleAnchor(); G.toast?.(s.anchor.state === 'up' || s.anchor.state === 'raising' ? '⚓ Dropping the anchor…' : '⚓ Raising the anchor…'); }
    if (hit('view')) this.chase = !this.chase;
    const eng = s.engineHp <= 0 ? ' · ⚠️ ENGINE DOWN: fix it with the wrench' : s.engineHp < 40 ? ' · ⚠️ engine damaged' : '';
    const anch = s.anchor.state === 'down' ? ' · ⚓ ANCHORED' : s.anchor.state !== 'up' ? ` · ⚓ anchor ${s.anchor.state}…` : '';
    this.prompt = `${THROTTLE_NAME(s.throttle)}${eng}${anch}${s.aground > 0 ? ' · ⚠️ AGROUND: go astern!' : ''}  ·  ${kn('forward')}/${kn('back')} throttle (tap or hold)  ·  ${kn('left')}/${kn('right')} rudder  ·  ${kn('anchor')} anchor  ·  ${kn('view')} camera  ·  ${kn('use')} let go`;
    if (hit('use')) this.leaveStation();
  }
  async updateCrane(dt, sens) {
    const s = this.station, cr = s.crane;
    this.swimming = this.inSea = this.underwater = false; this.underKind = null;
    cr.yaw -= IN.mdx * sens * 0.6;
    if (down('left')) cr.yaw += dt * 1.0;
    if (down('right')) cr.yaw -= dt * 1.0;
    const lim = s.craneLimits();
    if (down('forward')) cr.reach = Math.min(lim.rMax, cr.reach + dt * 2.2);
    if (down('back')) cr.reach = Math.max(lim.rMin, cr.reach - dt * 2.2);
    if (down('craneDown')) cr.drop += dt * 3;
    if (down('craneUp')) cr.drop -= dt * 3;
    if (IN.wheel) cr.drop += Math.sign(IN.wheel) * 0.5;
    cr.drop = clamp(cr.drop, 0.6, lim.dMax);
    if ((down('left') || down('right') || down('forward') || down('back') || down('craneDown') || down('craneUp') || Math.abs(IN.mdx) > 2) && Math.random() < dt * 8) sfx.crane();
    const hook = s.hookWorld(v1);
    let near = null;
    for (const c of G.crates) {
      if (c.state === 'fall' || c.state === 'hook') continue;
      if (crateWorld(c, v2).distanceTo(hook) < 1.9) { near = c; break; }
    }
    const holding = isGuest() ? G.crates.some(c => c.state === 'hook' && c.wp.distanceTo(hook) < 2.2) : !!cr.held;
    this.prompt = `🏗️ Crane · mouse or ${kn('left')}/${kn('right')} turn · ${kn('forward')}/${kn('back')} boom out / in · ${kn('craneDown')} lower · ${kn('craneUp')} raise · ${kn('grab')} ${holding ? 'RELEASE' : near ? 'GRAB IT' : 'grab'} · ${kn('use')} step away`;
    if (hit('crane') || (hit('use') && BINDS.use !== BINDS.craneUp)) return this.leaveStation();
    if (hit('grab')) {
      if (isGuest()) { const r = await act('grab', s.id); if (r) sfx[r === 'grabbed' ? 'pickup' : 'wood'](); }
      else if (cr.held) { releaseCrate(cr.held); cr.held = null; sfx.wood(); }
      else if (near) { hookCrate(near, s); cr.held = near; sfx.pickup(); }
    }
  }
  // the gun: you look down the barrel; the mouse moves the gun itself. RMB zooms.
  updateCannon(dt) {
    const { ship: s, c } = this.station;
    const T = cannonOf(c);
    this.swimming = this.inSea = this.underwater = false; this.underKind = null;
    this.pos.copy(this.gunStand(s, c));
    this.gunZoom = damp(this.gunZoom, IN.rmb ? 2.6 : 1, 10, dt);
    const sens = 0.0022 * S.sens / this.gunZoom;
    c.yaw = clamp(c.yaw + IN.mdx * sens * 0.6 * c.side, -T.yaw, T.yaw);
    c.pitch = clamp(c.pitch - IN.mdy * sens * 0.6 * (S.invertY ? -1 : 1), T.pmin, T.pmax);
    const [pos, dir] = s.cannonMuzzle(c);
    const vel = dir.clone().multiplyScalar(T.speed).add(s.velocity(v2)); vel.y -= s.vy;
    let pts = arcPoints(pos, vel, PSPEC[T.proj]?.grav ?? 9.8, T.proj === 'ac' || T.proj === 'rocket' ? 120 : 80);
    if (T.proj === 'torpedo') {     // its run under the waves
      const e = pts.at(-1), h = Math.hypot(dir.x, dir.z) || 1;
      pts = pts.concat(Array.from({ length: 12 }, (_, i) => new THREE.Vector3(e.x + dir.x / h * i * 7, waveHeight(e.x + dir.x / h * i * 7, e.z + dir.z / h * i * 7), e.z + dir.z / h * i * 7)));
    }
    this.aim.geometry.setFromPoints(pts); this.aim.computeLineDistances(); this.aim.visible = true;
    const end = pts.at(-1);
    this.aimRing.position.set(end.x, waveHeight(end.x, end.z) + 0.15, end.z); this.aimRing.visible = true;
    this.aimRing.scale.setScalar(0.6 + pos.distanceTo(end) / 120);
    const want = T.heat ? IN.lmb : IN.lmbHit;
    if (want && !fireCannon(s, c, this, this.skill === 'gunner' ? 0.65 : 1) && IN.lmbHit) G.toast?.(c.over ? 'Overheated! Let it cool.' : 'Reloading…');
    const state = c.over ? ' · 🔥 OVERHEATED' : c.cd > 0.05 ? ` · reloading ${c.cd.toFixed(1)}s` : ' · READY';
    this.prompt = `💥 ${T.name}${state} · mouse aims the gun · ${T.heat ? 'hold ' : ''}LMB fire · RMB zoom · ${kn('use')} leave`;
    if (hit('use')) this.leaveStation();
  }

  // ---------- camera ----------
  updateCamera(cam) {
    const shake = G.shake || 0;
    let fov = S.fov;
    if (this.mode === 'crane') {
      // over the operator's shoulder: behind and above the crane house, watching the hook
      const s = this.station, cr = s.crane, hook = s.hookWorld(v3);
      const lp = v2.set(cr.base.x - Math.sin(cr.yaw) * 3.4, cr.base.y + cr.pedH + 3.2 + cr.boomL * 0.35, cr.base.z - Math.cos(cr.yaw) * 3.4);
      cam.position.copy(s.toWorld(lp));
      cam.lookAt(hook.lerp(s.toWorld(s.craneTipLocal(v1)), 0.2));
    } else if (this.mode === 'cannon') {
      // gunsight: just above the breech, looking straight down the barrel
      const { ship: s, c } = this.station;
      const [, dir] = s.cannonMuzzle(c, v1, v2);
      const pivot = s.toWorld(v3.copy(c.lp).add(new THREE.Vector3(0, 0.66, 0)));
      const up = s.dirToWorld(new THREE.Vector3(0, 1, 0));
      cam.position.copy(pivot).addScaledVector(up, c.type === 'mortar' ? 0.35 : 0.48).addScaledVector(dir, c.type === 'mortar' ? -0.6 : -0.3);
      cam.lookAt(v1.copy(cam.position).add(dir));
      fov = S.fov / this.gunZoom;
    } else if (this.mode === 'wheel' && this.chase) {
      // chase camera behind and above the ship, mouse looks around
      const s = this.station, d = s.hl * 1.6 + 10;
      const a = s.yaw + this.yaw - Math.PI;
      cam.position.set(s.x - Math.sin(a) * d, s.y + s.deckTop + 6 + s.hl * 0.25 - this.pitch * 10, s.z - Math.cos(a) * d);
      cam.position.y = Math.max(cam.position.y, waveHeight(cam.position.x, cam.position.z) + 2);
      cam.lookAt(s.x + Math.sin(a) * 10, s.y + s.deckTop + 2, s.z + Math.cos(a) * 10);
    } else if (!this.alive && this.out && G.game?.spectate) {
      G.game.spectate(cam);
    } else {
      this.eyeWorld(cam.position);
      if (!this.alive) cam.position.y -= 1.0;
      cam.rotation.set(this.pitch, this.worldYaw(), 0, 'YXZ');
    }
    if (shake > 0) { cam.position.x += rand(-1, 1) * shake * 0.12; cam.position.y += rand(-1, 1) * shake * 0.12; }
    const st = this.mode === 'walk' ? this.gun.stats() : null;
    const zoom = st ? lerp(1, st.zoom, this.gun.ads) : 1;
    fov /= zoom;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.scoped = !!(st && st.scoped && this.gun.ads > 0.9);
  }
  stationShip() { return this.mode === 'wheel' || this.mode === 'crane' ? this.station : this.mode === 'cannon' ? this.station.ship : this.frame; }
}

// ---------- crate loot ----------
export function openCrate(c, p) {
  removeCrate(c);
  G.game?.onCrateOpened?.(c);
  if (c.loot === 'planks') {
    const s = p.frame || p.home;
    if (s && s.storage) { s.storage.planks = Math.min(12, s.storage.planks + 3); updateStorage(s); }
  }
  applyLoot(c.loot, p);
}
export function applyLoot(loot, p) {
  sfx.pickup();
  if (loot === 'ammo') { for (const k of ['primary', 'secondary']) { const s = p.inv[k]; s.reserve = WEAPONS[s.id].reserve; s.mag = s.magMax; } if (p.inv.gadget) p.inv.gadget.count = Math.max(p.inv.gadget.count, WEAPONS[p.inv.gadget.id].count); }
  else if (loot === 'health') p.hp = 100;
  else if (loot === 'weapon') {
    const id = PRIMARIES.filter(w => w !== p.inv.primary.id)[Math.random() * (PRIMARIES.length - 1) | 0];
    p.inv.primary = gunState(id, {}); p.slot = 'primary';
    return G.toast?.(`🎁 You found a ${WEAPONS[id].name}! You keep it if you die.`, 'good');
  } else if (loot === 'planks') return G.toast?.('🪵 +3 planks in the ship\'s storage.', 'good');
  else if (loot === 'c4') p.inv.gadget = { id: 'c4', count: (p.inv.gadget?.id === 'c4' ? p.inv.gadget.count : 0) + 2 };
  else if (loot === 'airstrike') { p.inv.special = { id: 'flare', count: 1 }; return G.toast?.(`✈️ Airstrike flare! Press ${kn('slot4')}, then throw it at a target.`, 'good'); }
  else if (loot === 'nuke') { p.inv.special = { id: 'nuke', count: 1 }; return G.toast?.(`☢️ NUKE REMOTE! Press ${kn('slot4')}, aim far away and click. Then RUN.`, 'good'); }
  G.toast?.(`${LOOT[loot]}!`, 'good');
}
export { gunStats };
