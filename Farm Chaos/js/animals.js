// animals.js — farm animals and gnomes. The host simulates them, clients only interpolate.
// Animals never die: they get flung, abducted (returned next morning), stampede or float.
'use strict';

const ZONES = {
  pen: { x0: 29.5, x1: 46.5, z0: -18.5, z1: -1.5 },
  coop: { x0: -12.5, x1: 4.5, z0: -44.5, z1: -33.5 },
};
const KINDS = {
  cow: { speed: 1.1, zone: 'pen', sound: 'moo', h: 1.6 },
  pig: { speed: 1.4, zone: 'pen', sound: 'oink', h: 1.0 },
  sheep: { speed: 1.2, zone: 'pen', sound: 'baa', h: 1.2 },
  chicken: { speed: 1.7, zone: 'coop', sound: 'cluck', h: 0.8 },
};
const STATES = ['wander', 'idle', 'flung', 'abducted', 'gone', 'stampede', 'angry', 'return', 'dazed'];

const AN = {
  list: [], gnomes: [], geo: {}, eggT: 0, nextGnome: 1,
  init() {
    for (const k of ['cow', 'pig', 'sheep', 'chicken', 'gnome']) this.geo[k] = M.animal(k);
    const counts = { cow: 6, pig: 4, sheep: 5, chicken: 12 };
    let id = 0;
    for (const kind in counts) for (let i = 0; i < counts[kind]; i++) {
      const z = ZONES[KINDS[kind].zone];
      const a = { id: id++, kind, x: U.rand(z.x0, z.x1), y: 0, z: U.rand(z.z0, z.z1), yaw: U.rand(0, 6.28), vx: 0, vy: 0, vz: 0, state: 'wander', t: U.rand(0, 3), tx: 0, tz: 0, milk: true, wool: true, sx: 0, sz: 0, spin: 0, eggT: U.rand(30, 90) };
      a.tx = a.x; a.tz = a.z; a.rx = a.x; a.rz = a.z; a.ry = 0;
      a.mesh = this.makeMesh(kind);
      this.list.push(a);
    }
  },
  makeMesh(kind) {
    const g = new THREE.Group(), d = this.geo[kind];
    const body = new THREE.Mesh(d.body, M.mat); body.castShadow = true; g.add(body);
    g.userData.legs = d.legs.map(l => { const m = new THREE.Mesh(l.geo, M.mat); m.position.set(l.x, l.y, l.z); m.castShadow = true; g.add(m); return m; });
    g.userData.phase = Math.random() * 6;
    W.scene.add(g); return g;
  },
  byId(id) { return this.list.find(a => a.id === id); },

  // ---------------- host simulation ----------------
  hostUpdate(dt) {
    const grav = 22 * (W.env.gravity === undefined ? 1 : W.env.gravity);
    const players = Game.alivePlayers();
    for (const a of this.list) {
      const K_ = KINDS[a.kind], Z = ZONES[K_.zone];
      a.t -= dt;
      const gh = W.height(a.x, a.z);
      if (a.state === 'gone') continue;
      if (a.state === 'abducted') continue; // the UFO event moves it
      if (a.state === 'flung' || a.y > gh + 0.05 || a.vy > 0) {
        a.vy -= grav * dt; a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt; a.spin += dt * 8;
        if (W.waterLevel > gh + 0.3 && a.y < W.waterLevel - 0.4) { a.vy = Math.max(a.vy, 0) + 30 * dt; a.vx *= 0.98; a.vz *= 0.98; }
        if (a.y <= gh) {
          a.y = gh;
          if (W.env.bouncy && a.vy < -4) { a.vy = -a.vy * 0.8; AU.play('boing', a, 0.3); }
          else { a.vy = 0; a.vx *= 0.5; a.vz *= 0.5; if (a.state === 'flung') { a.state = 'dazed'; a.t = 2; a.spin = 0; } }
        }
        if (a.y > 36) { a.y = 36; a.vy = Math.min(a.vy, 0); }
        if (a.state === 'flung') continue;
      }
      const inZone = a.x > Z.x0 && a.x < Z.x1 && a.z > Z.z0 && a.z < Z.z1;
      let spd = 0;
      if (a.state === 'dazed') { if (a.t <= 0) a.state = inZone ? 'wander' : 'return'; }
      else if (a.state === 'stampede') { a.x += a.sx * dt; a.z += a.sz * dt; a.yaw = Math.atan2(a.sx, a.sz); spd = 9; if (a.t <= 0 || Math.abs(a.x) > 70 || Math.abs(a.z + 5) > 70) { a.state = 'return'; } }
      else if (a.state === 'angry') {
        let best = null, bd = 1e9; for (const p of players) { const d = (p.x - a.x) ** 2 + (p.z - a.z) ** 2; if (d < bd) { bd = d; best = p; } }
        if (best && bd < 900) { a.tx = best.x; a.tz = best.z; spd = 4.8; }
        if (a.t <= 0) a.state = 'return';
      }
      else if (a.state === 'return') { a.tx = (Z.x0 + Z.x1) / 2; a.tz = (Z.z0 + Z.z1) / 2; spd = K_.speed * 2; if (inZone) { a.state = 'wander'; a.t = 1; } }
      else if (a.state === 'idle') { if (a.t <= 0) { a.state = 'wander'; a.t = U.rand(2, 6); a.tx = U.rand(Z.x0, Z.x1); a.tz = U.rand(Z.z0, Z.z1); } }
      else { // wander
        spd = K_.speed;
        if (a.t <= 0) { a.state = 'idle'; a.t = U.rand(1.5, 5); }
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.4) spd = 0;
      }
      if (spd > 0 && a.state !== 'stampede') {
        const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.3) {
          const ty = Math.atan2(dx, dz); a.yaw += U.angDiff(a.yaw, ty) * Math.min(1, dt * 5);
          a.x += Math.sin(a.yaw) * spd * dt; a.z += Math.cos(a.yaw) * spd * dt;
        }
      }
      a.moving = spd;
      if (a.y <= gh + 0.05) a.y = gh;
      // keep out of building walls
      for (const c of W.colliders) {
        if (c.dead || c.max.y < a.y + 0.2 || c.min.y > a.y + 1) continue;
        if (a.x > c.min.x - 0.4 && a.x < c.max.x + 0.4 && a.z > c.min.z - 0.4 && a.z < c.max.z + 0.4) {
          const ox = Math.min(a.x - c.min.x + 0.4, c.max.x + 0.4 - a.x), oz = Math.min(a.z - c.min.z + 0.4, c.max.z + 0.4 - a.z);
          if (ox < oz) a.x = a.x - c.min.x < c.max.x - a.x ? c.min.x - 0.4 : c.max.x + 0.4; else a.z = a.z - c.min.z < c.max.z - a.z ? c.min.z - 0.4 : c.max.z + 0.4;
          if (a.state === 'wander') a.t = 0;
        }
      }
      // products
      if (a.kind === 'chicken' && a.state === 'wander') { a.eggT -= dt; if (a.eggT <= 0) { a.eggT = U.rand(60, 110); if (Game.countPickups('egg') < 14) Game.spawnPickup('egg', a.x, a.z); } }
      if (a.kind === 'pig' && a.state === 'wander') { a.eggT -= dt; if (a.eggT <= 0) { a.eggT = U.rand(120, 200); if (Game.countPickups('truffle') < 3) Game.spawnPickup('truffle', a.x + 0.5, a.z); } }
      // stampeding animals trample crops
      if (a.state === 'stampede') { const ti = W.tileAt(a.x, a.z); if (ti >= 0 && W.tiles.c[ti] >= 0) Game.destroyTile(ti, 'trampled'); }
    }
    this.hostGnomes(dt);
  },
  fling(a, vx, vy, vz) {
    if (!a || a.state === 'gone' || a.state === 'abducted') return;
    a.vx = vx; a.vy = vy; a.vz = vz; a.state = 'flung'; a.y = Math.max(a.y, W.height(a.x, a.z) + 0.1);
  },
  near(x, z, r) { return this.list.filter(a => a.state !== 'gone' && a.state !== 'abducted' && (a.x - x) ** 2 + (a.z - z) ** 2 < r * r); },

  // ---------------- gnomes ----------------
  spawnGnome(x, z) { const g = { id: this.nextGnome++, x, z, y: 0, vx: 0, vy: 0, vz: 0, yaw: 0, state: 'seek', t: 0, carry: -1, tile: -1 }; g.rx = x; g.rz = z; g.ry = 0; g.mesh = this.makeMesh('gnome'); this.gnomes.push(g); return g; },
  hostGnomes(dt) {
    const grav = 22 * (W.env.gravity === undefined ? 1 : W.env.gravity);
    for (let i = this.gnomes.length - 1; i >= 0; i--) {
      const g = this.gnomes[i];
      g.t += dt;
      if (g.state === 'flung') {
        g.vy -= grav * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
        if (g.y <= W.height(g.x, g.z)) { g.y = W.height(g.x, g.z); g.vy = 0; g.state = 'flee'; }
        continue;
      }
      let tx, tz, spd = 4;
      if (g.state === 'seek') {
        if (g.tile < 0 || W.tiles.c[g.tile] < 0) {
          const cand = []; for (let k = 0; k < TILES_TOTAL; k++) if (W.tiles.c[k] >= 0) cand.push(k);
          g.tile = cand.length ? cand[Math.floor(Math.random() * cand.length)] : -1;
          if (g.tile < 0) { g.state = 'flee'; continue; }
        }
        const p = W.tilePos(g.tile); tx = p.x; tz = p.z;
        if (Math.hypot(tx - g.x, tz - g.z) < 0.5) {
          const scared = G.has('scarecrow') && Math.random() < 0.5;
          if (!scared) { g.carry = W.tiles.c[g.tile]; Game.destroyTile(g.tile, 'stolen by gnomes'); AU.play('chomp', g, 0.5); }
          g.state = 'flee';
        }
      } else { // flee to the map edge
        const a = Math.atan2(g.z + 5, g.x); tx = g.x + Math.cos(a) * 10; tz = g.z + Math.sin(a) * 10; spd = 5.5;
        if (Math.hypot(g.x, g.z + 5) > 85) { W.scene.remove(g.mesh); this.gnomes.splice(i, 1); continue; }
      }
      const ty = Math.atan2(tx - g.x, tz - g.z); g.yaw = ty;
      g.x += Math.sin(ty) * spd * dt; g.z += Math.cos(ty) * spd * dt; g.y = W.height(g.x, g.z);
    }
  },

  // ---------------- sync ----------------
  pack() {
    return {
      a: this.list.map(a => [+a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2), +a.yaw.toFixed(2), STATES.indexOf(a.state), a.moving ? 1 : 0, a.milk ? 1 : 0, a.wool ? 1 : 0]),
      g: this.gnomes.map(g => [g.id, +g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2), +g.yaw.toFixed(2), g.carry]),
    };
  },
  unpack(d) {
    d.a.forEach((v, i) => { const a = this.list[i]; if (!a) return; a.x = v[0]; a.y = v[1]; a.z = v[2]; a.yaw = v[3]; a.state = STATES[v[4]]; a.moving = v[5]; a.milk = !!v[6]; a.wool = !!v[7]; });
    const seen = new Set();
    for (const v of d.g) {
      seen.add(v[0]);
      let g = this.gnomes.find(q => q.id === v[0]);
      if (!g) { g = this.spawnGnome(v[1], v[3]); g.id = v[0]; }
      g.x = v[1]; g.y = v[2]; g.z = v[3]; g.yaw = v[4]; g.carry = v[5];
    }
    for (let i = this.gnomes.length - 1; i >= 0; i--) if (!seen.has(this.gnomes[i].id)) { W.scene.remove(this.gnomes[i].mesh); this.gnomes.splice(i, 1); }
  },

  // ---------------- rendering (every client) ----------------
  render(dt) {
    const k = Math.min(1, dt * (G.isHost ? 60 : 10));
    for (const a of this.list) {
      const m = a.mesh;
      m.visible = a.state !== 'gone';
      if (!m.visible) continue;
      a.rx = U.lerp(a.rx, a.x, k); a.rz = U.lerp(a.rz, a.z, k); a.ry = U.lerp(a.ry || a.y, a.y, k);
      m.position.set(a.rx, a.ry, a.rz);
      m.rotation.set(a.state === 'flung' || a.state === 'abducted' ? Math.sin(W.timeUniform.value * 5 + a.id) * 1.5 : 0, a.yaw, a.state === 'dazed' ? Math.sin(W.timeUniform.value * 8) * 0.2 : a.state === 'flung' ? W.timeUniform.value * 6 : 0);
      const legs = m.userData.legs, sp = a.state === 'stampede' ? 3 : a.state === 'angry' ? 2.5 : 1;
      m.userData.phase += dt * (a.moving ? 9 * sp : 0);
      const sw = a.moving ? Math.sin(m.userData.phase) * 0.6 : 0;
      legs.forEach((l, i) => l.rotation.x = (i % 2 === (i >> 1) % 2 ? sw : -sw) * (a.state === 'flung' || a.state === 'abducted' ? 2 : 1));
      if (a.state === 'angry' && a.kind === 'chicken') { m.children[0].material = AN.redMat || (AN.redMat = new THREE.MeshLambertMaterial({ color: 0xff6060, vertexColors: true })); m.position.y += Math.abs(Math.sin(W.timeUniform.value * 12)) * 0.15; }
      else if (m.children[0].material !== M.mat) m.children[0].material = M.mat;
      // occasional sounds near the listener
      if (Math.random() < dt * 0.02 && Math.hypot(a.x - P.pos.x, a.z - P.pos.z) < 30) AU.play(KINDS[a.kind].sound, a, 0.6);
    }
    for (const g of this.gnomes) {
      g.rx = U.lerp(g.rx, g.x, k); g.rz = U.lerp(g.rz, g.z, k); g.ry = U.lerp(g.ry, g.y, k);
      g.mesh.position.set(g.rx, g.ry, g.rz); g.mesh.rotation.y = g.yaw;
      g.mesh.userData.phase += dt * 14; const sw = Math.sin(g.mesh.userData.phase) * 0.7;
      g.mesh.userData.legs.forEach((l, i) => l.rotation.x = i ? sw : -sw);
      g.mesh.position.y += Math.abs(Math.sin(g.mesh.userData.phase)) * 0.08;
    }
    // local damage from angry chickens and stampedes (each client checks its own player)
    if (!P.dead && !P.inBunker) for (const a of this.list) {
      const d = Math.hypot(a.x - P.pos.x, a.z - P.pos.z);
      if (a.state === 'angry' && d < 0.9 && Math.abs(a.y - P.pos.y) < 1.5) { if (!a.peckT || a.peckT < W.timeUniform.value) { a.peckT = W.timeUniform.value + 0.7; P.hurt(5, 'pecked to death by chickens'); AU.play('cluck', a); } }
      if (a.state === 'stampede' && d < 1.4 && Math.abs(a.y - P.pos.y) < 1.5) { if (!a.hitT || a.hitT < W.timeUniform.value) { a.hitT = W.timeUniform.value + 1; P.launch(Math.sin(a.yaw) * 14, 9, Math.cos(a.yaw) * 14); P.hurt(25, 'trampled by a stampede'); P.fallCause = 'trampled by a stampede'; } }
    }
  },
  // what the local player would kick when clicking
  kickTarget(cp, dir) {
    let best = null, bd = 2.8;
    const test = (x, y, z, kind, id) => {
      const dx = x - cp.x, dy = y + 0.4 - cp.y, dz = z - cp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bd && (dx * dir.x + dy * dir.y + dz * dir.z) / d > 0.75) { bd = d; best = { kind, id }; }
    };
    for (const g of this.gnomes) test(g.x, g.y, g.z, 'gnome', g.id);
    for (const a of this.list) if (a.state === 'angry') test(a.x, a.y, a.z, 'animal', a.id);
    return best;
  },
  interactables() {
    const out = [];
    for (const a of this.list) {
      if (a.state === 'abducted' && a.y < 14) out.push({ pos: new V3(a.x, a.y + 0.8, a.z), r: 3.5, label: () => 'Pull the cow back down!', act: () => Game.request({ k: 'grab', id: a.id }) });
      else if (a.kind === 'cow' && a.milk && (a.state === 'wander' || a.state === 'idle')) out.push({ pos: new V3(a.x, a.y + 1, a.z), r: 2.6, label: () => 'Milk the cow', act: () => Game.request({ k: 'milk', id: a.id }) });
      else if (a.kind === 'sheep' && a.wool && (a.state === 'wander' || a.state === 'idle')) out.push({ pos: new V3(a.x, a.y + 0.8, a.z), r: 2.6, label: () => 'Shear the sheep', act: () => Game.request({ k: 'shear', id: a.id }) });
    }
    return out;
  },
  morning() {
    for (const a of this.list) {
      a.milk = true; a.wool = true;
      if (a.state === 'gone') { const z = ZONES[KINDS[a.kind].zone]; a.state = 'flung'; a.x = U.rand(z.x0, z.x1); a.z = U.rand(z.z0, z.z1); a.y = 25; a.vx = a.vz = 0; a.vy = 0; a.rx = a.x; a.rz = a.z; }
      else if (a.state !== 'wander' && a.state !== 'idle') a.state = 'return';
    }
    for (const g of this.gnomes) W.scene.remove(g.mesh);
    this.gnomes = [];
  },
};
