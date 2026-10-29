// player.js — local first-person player: movement, physics, tools, interaction, death & respawn
'use strict';

const SPAWN = new V3(-20, 0, -15.5);

const P = {
  pos: SPAWN.clone(), vel: new V3(), yaw: Math.PI, pitch: 0, onGround: true, height: 1.75, r: 0.35,
  crouch: false, sprint: false, health: 100, dead: false, deadT: 0, invuln: 0, cause: '',
  inBunker: false, sleeping: false, boarded: false,
  pack: {}, packN: 0, slot: 0, seedSel: 0, useCD: 0, swing: 0, stepT: 0, force: new V3(), fallV: 0,
  target: null, targetTiles: [], sheltered: false, shelterT: 0, lastHurt: 0, swim: false, bob: 0,
  can: 0, bucket: 0, hotT: 0, streak: 0,

  init() {
    this.hand = new THREE.Group(); W.camera.add(this.hand);
    this.tools = { hand: M.tool('hand'), hoe: M.tool('hoe'), wide: M.tool('wide'), seeds: M.tool('seeds'), scythe: M.tool('scythe'), can: M.tool('can'), bucket: M.tool('bucket') };
    for (const k in this.tools) { const t = this.tools[k]; t.visible = false; this.hand.add(t); }
    this.tools.hoe.rotation.set(-0.3, 0, 0); this.tools.wide.rotation.set(-0.3, 0, 0); this.tools.scythe.rotation.set(-0.3, 0, 0);
    this.hand.position.set(0.32, -0.32, -0.55); this.hand.scale.setScalar(0.65);
  },
  capacity() { return (G.has('backpack') ? 120 : 40) + (G.has('farm3') ? 40 : 0); },
  carrying() { return AN.carriedBy(G.myId); },
  // pigs eat the cheapest crop in your backpack
  cheapestCrop() { let best = null; for (const k in this.pack) if (k[0] === 'c' && this.pack[k] > 0 && (!best || itemValue(k) < itemValue(best))) best = k; return best; },
  feedPig(a) {
    const k = this.cheapestCrop();
    if (!k) { UI.toast('Bring a crop to feed the pig'); AU.play('deny'); return; }
    this.pack[k]--; this.packN--; if (!this.pack[k]) delete this.pack[k]; UI.dirty = true;
    Game.request({ k: 'feed', id: a.id }); AU.play('oink', a);
  },
  give(items) {
    for (const k in items) { this.pack[k] = (this.pack[k] || 0) + items[k]; this.packN += items[k]; }
    UI.dirty = true;
  },
  takeAll() { const p = this.pack; this.pack = {}; this.packN = 0; UI.dirty = true; return p; },
  respawn() {
    this.dead = false; this.health = 100; this.invuln = 2.2; this.pos.copy(SPAWN); this.vel.set(0, 0, 0); this.yaw = Math.PI; this.pitch = 0;
    this.inBunker = false; this.sleeping = false; AU.setMuffled(false);
    UI.hideDeath(); AU.play('respawn');
  },
  hurt(n, cause, opts = {}) {
    if (this.dead || this.boarded || G.mode === 'menu' || (G.final && G.final.phase === 'cutscene')) return;
    if (!opts.apoc && (this.inBunker || this.invuln > 0)) return;
    if (opts.apoc && this.invuln > 0 && !opts.force) return;
    this.health -= n; this.lastHurt = 0;
    if (n >= 4 || Math.random() < 0.15) { AU.play('hurt'); UI.hurtFlash(Math.min(1, n / 30)); }
    if (this.health <= 0) this.die(cause);
  },
  die(cause) {
    if (this.dead) return;
    this.dead = true; this.deadT = 3; this.health = 0; this.cause = cause || 'chaos';
    if (this.sleeping) Game.request({ k: 'sleep', on: false });
    this.sleeping = false;
    AU.play('death');
    Game.request({ k: 'died', cause: this.cause });
    if (this.packN > 0) Game.request({ k: 'drop', items: this.takeAll(), x: this.pos.x, y: Math.max(this.pos.y, W.height(this.pos.x, this.pos.z)), z: this.pos.z });
    UI.showDeath(this.cause);
  },
  launch(vx, vy, vz) { this.vel.x += vx; this.vel.y += vy; this.vel.z += vz; this.onGround = false; },

  groundHeight(x, z, y) {
    if (this.inBunker) return W.bunkerY + 0.1;
    let g = W.groundAt(x, z);
    for (const c of W.colliders) {
      if (c.dead) continue;
      if (x > c.min.x - 0.05 && x < c.max.x + 0.05 && z > c.min.z - 0.05 && z < c.max.z + 0.05 && c.max.y <= y + 0.55 && c.max.y > g) g = c.max.y;
    }
    return g;
  },
  collide() {
    if (this.inBunker) { this.pos.x = U.clamp(this.pos.x, -3.6, 3.6); this.pos.z = U.clamp(this.pos.z, -3.6, 3.6); return; }
    const p = this.pos, r = this.r, y0 = p.y + 0.3, y1 = p.y + this.height;
    for (const c of W.colliders) {
      if (c.dead || c.max.y < y0 || c.min.y > y1) continue;
      if (c.roof && p.y < c.min.y - 0.05) continue; // walking under a roof, not into it
      if (p.x < c.min.x - r || p.x > c.max.x + r || p.z < c.min.z - r || p.z > c.max.z + r) continue;
      const cx = U.clamp(p.x, c.min.x, c.max.x), cz = U.clamp(p.z, c.min.z, c.max.z);
      let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2); if (d >= r) continue;
        const push = (r - d) / d; p.x += dx * push; p.z += dz * push;
        const n = (this.vel.x * dx + this.vel.z * dz) / d; if (n < 0) { this.vel.x -= n * dx / d; this.vel.z -= n * dz / d; }
      } else {
        // inside: push out along the shallowest axis
        const ox = Math.min(p.x - c.min.x, c.max.x - p.x), oz = Math.min(p.z - c.min.z, c.max.z - p.z);
        if (ox < oz) p.x = p.x - c.min.x < c.max.x - p.x ? c.min.x - r : c.max.x + r;
        else p.z = p.z - c.min.z < c.max.z - p.z ? c.min.z - r : c.max.z + r;
      }
    }
  },

  update(dt) {
    const playing = G.started && !UI.modal && K.locked;
    // look
    if (K.locked && !this.dead) {
      const s = 0.0022 * S.d.sens;
      this.yaw -= K.dx * s; this.pitch -= K.dy * s * (S.d.invertY ? -1 : 1);
      this.pitch = U.clamp(this.pitch, -1.55, 1.55);
    }
    if (this.dead) {
      this.deadT -= dt; UI.deathCountdown(this.deadT);
      if (this.deadT <= 0) this.respawn();
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.lastHurt += dt;
    if (!this.dead && this.lastHurt > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 4);

    if (this.boarded) { this.updateCamera(dt); return; }

    // sleeping: lie in bed until you move
    if (this.sleeping) {
      if (playing && (K.down('forward') || K.down('back') || K.down('left') || K.down('right') || K.hit('jump'))) { this.sleeping = false; Game.request({ k: 'sleep', on: false }); }
      this.pos.set(W.bedPos.x, W.bedPos.y, W.bedPos.z);
      this.updateCamera(dt); return;
    }

    // input
    let ix = 0, iz = 0;
    if (playing && !this.dead) {
      if (K.down('forward')) iz -= 1; if (K.down('back')) iz += 1; if (K.down('left')) ix -= 1; if (K.down('right')) ix += 1;
      if (S.d.sprintMode === 'toggle') { if (K.hit('sprint')) this.sprint = !this.sprint; } else this.sprint = K.down('sprint');
      if (S.d.crouchMode === 'toggle') { if (K.hit('crouch')) this.crouch = !this.crouch; } else this.crouch = K.down('crouch');
      if (ix === 0 && iz === 0 && S.d.sprintMode === 'toggle') this.sprint = false;
    } else if (!playing) { this.sprint = false; if (S.d.crouchMode === 'hold') this.crouch = false; }
    const len = Math.hypot(ix, iz) || 1; ix /= len; iz /= len;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = ix * cy + iz * sy, wz = -ix * sy + iz * cy;
    this.hotT = Math.max(0, this.hotT - dt);
    const held = this.carrying();
    let speed = (this.crouch ? 2.6 : this.sprint ? 8.6 : 5.2) * (G.has('boots') ? 1.3 : 1) * (W.env.speed || 1) * (this.hotT > 0 ? 1.25 : 1) * (held ? (held.kind === 'cow' ? 0.7 : 0.85) : 1);
    if (this.swim) speed *= 0.6;
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, accel * dt) * (ix || iz || this.onGround ? 1 : 0);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, accel * dt) * (ix || iz || this.onGround ? 1 : 0);

    // external forces (wind, black holes, buoyancy...) filled in by events this frame
    const fk = this.crouch ? 0.3 : 1;
    this.vel.x += this.force.x * dt * fk; this.vel.z += this.force.z * dt * fk; this.vel.y += this.force.y * dt;
    this.force.set(0, 0, 0);

    const grav = 22 * (W.env.gravity === undefined ? 1 : W.env.gravity);
    // water
    const wl = this.inBunker ? -999 : Math.max(W.waterLevel, Math.hypot(this.pos.x - 44, this.pos.z - 32) < 11 ? -0.35 : -999);
    this.swim = this.pos.y < wl - 0.6;
    if (this.swim) {
      this.vel.y += (wl - 0.9 - this.pos.y) * 6 * dt - this.vel.y * 2 * dt;
      if (playing && K.down('jump')) this.vel.y += 14 * dt;
    } else this.vel.y -= grav * dt;

    if (playing && !this.dead && K.hit('jump') && (this.onGround || this.swim) && !this.crouch) { this.vel.y = 8.2 * (grav < 10 ? 1.1 : 1); this.onGround = false; AU.play('jump', null, 0.5); }

    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.collide();
    this.pos.y += this.vel.y * dt;
    if (this.pos.y > 38) { this.pos.y = 38; if (this.vel.y > 0) this.vel.y = 0; }
    const gh = this.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gh) {
      const impact = -this.vel.y;
      this.pos.y = gh;
      if (!this.onGround) {
        if (W.env.bouncy && impact > 3) { this.vel.y = impact * 0.85; AU.play('boing', null, 0.5); }
        else {
          if (impact > 17 && !W.env.bouncy) this.hurt((impact - 17) * 5.5, this.fallCause || 'fell from the sky');
          if (impact > 6) AU.play('land', null, 0.5);
          this.vel.y = 0; this.onGround = true; this.fallCause = null;
        }
      } else this.vel.y = 0;
    } else if (this.pos.y > gh + 0.08) this.onGround = false;
    if (this.pos.y < -60 && !this.inBunker) this.die(this.fallCause || 'fell into the void');
    // world bounds
    const d = Math.hypot(this.pos.x, this.pos.z + 5); if (d > 150) { this.pos.x *= 150 / d; }

    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 1) { this.stepT -= dt * hs; if (this.stepT <= 0) { this.stepT = 2.6; AU.play('step', null, 0.6); } this.bob += dt * hs * 1.6; }

    // shelter check (acid rain etc.)
    this.shelterT -= dt;
    if (this.shelterT <= 0) { this.shelterT = 0.25; this.sheltered = this.inBunker || W.sheltered(this.pos.x, this.pos.y + 1, this.pos.z); }

    this.updateCamera(dt);
    if (playing && !this.dead) this.updateTools(dt);
    else { W.highlight.visible = false; W.highlight3.visible = false; W.highlight2.visible = false; this.target = null; UI.prompt(''); }
  },

  updateCamera(dt) {
    const cam = W.camera;
    let eye = this.crouch ? 1.05 : 1.62;
    if (this.dead) eye = 0.35;
    if (this.sleeping) eye = 0.25;
    const sh = FX.shakeAmt;
    cam.position.set(this.pos.x + (Math.random() - 0.5) * sh * 0.3, this.pos.y + eye + Math.sin(this.bob * 2) * 0.03 + (Math.random() - 0.5) * sh * 0.3, this.pos.z + (Math.random() - 0.5) * sh * 0.3);
    const roll = (S.d.camTilt ? (W.env.roll || 0) : 0) + (this.dead ? 0.9 : 0) + (this.sleeping ? 0 : 0);
    cam.rotation.set(this.sleeping ? 1.35 : this.pitch, this.sleeping ? this.yaw : this.yaw, roll, 'YXZ');
    AU.listener.x = this.pos.x; AU.listener.y = this.pos.y; AU.listener.z = this.pos.z; AU.listener.yaw = this.yaw;
    // tool view model
    const tool = this.toolName();
    for (const k in this.tools) this.tools[k].visible = k === tool && !this.dead && !this.sleeping && !this.boarded;
    this.swing = Math.max(0, this.swing - dt * 4);
    const s = Math.sin(this.swing * Math.PI);
    this.hand.position.set(0.3 + Math.sin(this.bob) * 0.01, -0.27 - s * 0.1 + Math.abs(Math.cos(this.bob)) * 0.012, -0.6 - s * 0.08);
    this.hand.rotation.set(-s * 0.9, 0, 0);
  },
  toolName() { return this.slot === 0 ? (G.has('scythe') ? 'scythe' : 'hand') : this.slot === 1 ? (G.has('widehoe') ? 'wide' : 'hoe') : this.slot === 2 ? 'seeds' : this.slot === 3 ? 'can' : 'bucket'; },
  nearPond() { return Math.hypot(this.pos.x - W.pondPos.x, this.pos.z - W.pondPos.z) < 13.5; },

  updateTools(dt) {
    // hotbar
    for (let i = 0; i < 5; i++) if (K.hit('slot' + (i + 1))) { this.slot = i; UI.dirty = true; }
    if (K.wheel) { this.slot = (this.slot + K.wheel + 5) % 5; UI.dirty = true; }
    if (K.hit('nextSeed')) { this.cycleSeed(1); this.slot = 2; }
    if (G.seeds[this.seedSel] <= 0 && K.hit('slot3')) this.cycleSeed(1);

    const cam = W.camera, dir = new V3(0, 0, -1).applyQuaternion(cam.quaternion);
    // interactables
    let best = null, bd = 99;
    for (const it of Game.interactables()) {
      const dx = it.pos.x - cam.position.x, dy = it.pos.y - cam.position.y, dz = it.pos.z - cam.position.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > (it.r || 3.2)) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (dot < 0.8 - Math.min(0.5, 0.6 / d)) continue;
      if (d < bd) { bd = d; best = it; }
    }
    this.target = best;
    // tiles
    this.targetTiles = [];
    let tile = -1;
    if (!best && dir.y < -0.05) {
      const t = (0.05 - cam.position.y) / dir.y;
      if (t < 6) { const x = cam.position.x + dir.x * t, z = cam.position.z + dir.z * t; tile = W.tileAt(x, z); }
    }
    if (tile >= 0 && !G.plots[W.plotOf(tile)]) tile = -1;
    const wide = (this.slot === 0 && G.has('scythe')) || (this.slot === 1 && G.has('widehoe')) || (this.slot === 2 && G.has('spreader'));
    W.highlight2.visible = false;
    if (tile >= 0) {
      const p = W.tilePos(tile);
      if (this.slot === 4) {
        // the bucket splashes 2×2 (shifted back inside the field at its edges)
        const k = tile % 64, tx = Math.min(6, k % 8), tz = Math.min(6, Math.floor(k / 8)), base = tile - k;
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) this.targetTiles.push(base + (tz + b) * 8 + tx + a);
        const p0 = W.tilePos(base + tz * 8 + tx);
        W.highlight2.position.set(p0.x + TILE / 2, 0.08, p0.z + TILE / 2); W.highlight2.visible = true; W.highlight.visible = false; W.highlight3.visible = false;
      } else if (wide) {
        const k = tile % 64, tx = k % 8, tz = Math.floor(k / 8), base = tile - k;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const x = tx + a, z = tz + b; if (x >= 0 && x < 8 && z >= 0 && z < 8) this.targetTiles.push(base + z * 8 + x); }
        W.highlight3.position.set(p.x, 0.08, p.z); W.highlight3.visible = true; W.highlight.visible = false;
      } else { this.targetTiles = [tile]; W.highlight.position.set(p.x, 0.08, p.z); W.highlight.visible = true; W.highlight3.visible = false; }
    } else { W.highlight.visible = false; W.highlight3.visible = false; }

    // prompt
    let txt = '';
    const held = this.carrying(), key = a => `<b>${K.keyName(S.d.keys[a])}</b>`;
    if (best) txt = (best.act ? `${key('interact')} ${best.label()}` : best.label()) + (best.animal !== undefined ? ` · ${key('carry')} Pick up` : '');
    else if (this.slot === 4 && this.nearPond()) txt = `${key('interact')} Fill the bucket (${this.bucket}/${BUCKET_MAX()})`;
    else if (tile >= 0 && this.slot >= 3) {
      const T = W.tiles, fire = this.targetTiles.some(i => T.f[i] > 0), left = this.slot === 3 ? this.can : this.bucket;
      txt = left > 0 ? `<b>Click</b> ${fire ? 'Put out the fire' : 'Water'} (${left} left)` : this.slot === 3 ? 'The watering can is empty — fill it at the well' : 'The bucket is empty — fill it at the pond';
    }
    else if (this.slot >= 3 && H.burnTarget(cam.position, dir)) txt = (this.slot === 3 ? this.can : this.bucket) > 0 ? '<b>Click</b> Put out the fire!' : 'Empty! Refill and come back';
    else if (tile >= 0) {
      const T = W.tiles;
      if (this.slot === 0 && T.c[tile] >= 0) txt = T.st[tile] === 3 ? `<b>Click</b> Harvest ${itemName('c' + T.c[tile] + (T.m[tile] ? '_' + T.m[tile] : ''))}` : `${CROPS[T.c[tile]].name} — growing (${Math.round(T.g[tile] / CROPS[T.c[tile]].grow * 100)}%)`;
      else if (this.slot === 1 && !T.s[tile]) txt = '<b>Click</b> Till soil';
      else if (this.slot === 2 && T.s[tile] && T.c[tile] < 0) txt = G.seeds[this.seedSel] > 0 ? `<b>Click</b> Plant ${CROPS[this.seedSel].name} (${G.seeds[this.seedSel]} left)` : `No ${CROPS[this.seedSel].name} seeds — buy some at the shop`;
      else if (T.c[tile] >= 0) txt = `${CROPS[T.c[tile]].name} ${T.st[tile] === 3 ? '— ripe! (switch to hand: 1)' : '— growing'}`;
      else if (!T.s[tile]) txt = 'Untilled soil (hoe: 2)';
      else txt = 'Tilled soil (seeds: 3)';
    }
    if (held) txt = `${key('carry')} Put down the ${ANIMAL_SHOP[held.kind].name.toLowerCase()}` + (txt ? ' · ' + txt : '');
    UI.prompt(txt);

    if (K.hit('interact')) {
      if (best && best.act) best.act();
      else if (!best && this.slot === 4 && this.nearPond()) { this.bucket = BUCKET_MAX(); AU.play('splash', null, 0.7); UI.dirty = true; UI.toast('Bucket filled'); }
    }
    // pick up / put down animals (put them in another pen to move them there)
    if (K.hit('carry')) {
      if (held) Game.request({ k: 'carry', on: false, id: held.id, dx: -Math.sin(this.yaw), dz: -Math.cos(this.yaw) });
      else if (best && best.animal !== undefined) Game.request({ k: 'carry', on: true, id: best.animal });
    }

    // ping
    if (K.hit('ping')) {
      const t = dir.y < -0.01 ? Math.min(60, (0.05 - cam.position.y) / dir.y) : 40;
      Game.request({ k: 'ping', x: cam.position.x + dir.x * t, z: cam.position.z + dir.z * t });
    }

    // use tool (hold to repeat)
    this.useCD -= dt;
    if (K.mouse[0] && this.useCD <= 0) {
      this.useCD = 0.2;
      // kicking gnomes / angry chickens with any tool
      const big = H.bigTarget(cam.position, dir);
      if (big) { this.swing = 1; this.useCD = 0.35; AU.play('kick', null, 0.8); Game.request({ k: 'kickbig', type: big }); return; }
      const kick = AN.kickTarget(cam.position, dir);
      if (kick) { this.swing = 1; AU.play('kick', null, 0.7); Game.request({ k: 'kick', kind: kick.kind, id: kick.id, dx: dir.x, dz: dir.z }); return; }
      if (this.slot >= 3) { this.useWater(cam, dir); return; }
      if (!this.targetTiles.length) return;
      const T = W.tiles; let tiles;
      if (this.slot === 0) {
        tiles = this.targetTiles.filter(i => T.c[i] >= 0 && T.st[i] === 3);
        if (tiles.length) {
          if (this.packN + tiles.length > this.capacity()) { UI.toast('Backpack full! Ship it at the shipping bin.'); AU.play('deny'); this.useCD = 0.5; return; }
          Game.request({ k: 'act', a: 'harvest', tiles }); AU.play('harvest', null, 0.7); this.swing = 1;
        }
      } else if (this.slot === 1) {
        tiles = this.targetTiles.filter(i => !T.s[i]);
        if (tiles.length) { Game.request({ k: 'act', a: 'till', tiles }); AU.play('till', null, 0.8); this.swing = 1; tiles.forEach(i => { const p = W.tilePos(i); for (let k = 0; k < 3; k++) FX.emit(p.x, 0.2, p.z, U.rand(-1, 1), U.rand(1, 3), U.rand(-1, 1), 0.8, 0.5, 0x6b4a2f, { g: 9 }); }); }
      } else if (this.slot === 2) {
        tiles = this.targetTiles.filter(i => T.s[i] && T.c[i] < 0);
        if (tiles.length && G.seeds[this.seedSel] > 0) { Game.request({ k: 'act', a: 'plant', tiles, seed: this.seedSel }); AU.play('plant', null, 0.8); this.swing = 1; }
        else if (tiles.length) { UI.toast(`Out of ${CROPS[this.seedSel].name} seeds`); this.useCD = 0.6; }
      }
    }
  },
  // watering can (1 tile) / bucket (2×2): waters crops and puts out burning fields and buildings
  useWater(cam, dir) {
    const can = this.slot === 3, left = can ? this.can : this.bucket;
    const burn = H.burnTarget(cam.position, dir);
    if (!this.targetTiles.length && !burn) return;
    if (left <= 0) { UI.toast(can ? 'Empty — fill the watering can at the well' : 'Empty — fill the bucket at the pond'); AU.play('deny'); this.useCD = 0.6; return; }
    if (can) this.can--; else this.bucket--;
    this.swing = 1; this.useCD = can ? 0.25 : 0.5; AU.play('pour', null, 0.7); UI.dirty = true;
    if (burn) Game.request({ k: 'douse', type: burn.type, bi: burn.bi, pi: burn.pi });
    else Game.request({ k: 'water', tiles: this.targetTiles });
    const pts = burn ? [W.buildings[burn.bi].pieces[burn.pi].center] : this.targetTiles.map(i => W.tilePos(i));
    for (const p of pts) for (let k = 0; k < 6 * S.d.particles; k++) FX.emit(p.x + U.rand(-0.5, 0.5), (p.y || 0) + 0.6, p.z + U.rand(-0.5, 0.5), U.rand(-1, 1), U.rand(0.5, 2), U.rand(-1, 1), 0.6, 0.15, 0x8fd4ff, { g: 9 });
  },
  fillCan() {
    if (this.slot !== 3) { UI.toast(`Hold the watering can (${K.keyName(S.d.keys.slot4)}) to fill it`); return; }
    if (G.wellDry === G.day() && G.hour() < 10) { UI.toast('The well is dry until 10:00 — use the bucket at the pond'); AU.play('deny'); return; }
    this.can = CAN_MAX(); AU.play('splash', null, 0.7); UI.dirty = true; UI.toast('Watering can filled');
  },
  // basketball: 3 baskets in a row = hot hand (run 25% faster for a minute)
  shoot() {
    if (this.shotT > W.timeUniform.value) return;
    this.shotT = W.timeUniform.value + 1.1;
    const cam = W.camera.position, h = W.hoopPos, d = Math.hypot(h.x - cam.x, h.z - cam.z);
    const make = Math.random() < U.clamp(1.05 - d / 7, 0.15, 0.9);
    const from = cam.clone(), to = make ? h.clone() : h.clone().add(new V3(U.rand(-0.6, 0.6), 0.2, U.rand(0.1, 0.5)));
    const ball = new THREE.Mesh(this.ballGeo || (this.ballGeo = M.ball()), M.mat); ball.userData.keepGeo = true;
    FX.temp(ball, 1.6, t => {
      const k = Math.min(1, t / 0.8);
      if (k < 1) ball.position.set(U.lerp(from.x, to.x, k), U.lerp(from.y, to.y, k) + Math.sin(k * Math.PI) * 2.2, U.lerp(from.z, to.z, k));
      else ball.position.set(to.x + (make ? 0 : (t - 0.8) * 2), Math.max(0.13, to.y - (t - 0.8) * (t - 0.8) * 14), to.z + (t - 0.8) * 1.5);
      return t < 1.6;
    });
    this.swing = 1; AU.play('whoosh', null, 0.3);
    setTimeout(() => {
      if (make) {
        this.streak++; AU.play('swish', h);
        if (this.streak >= 3) { this.streak = 0; this.hotT = 60; UI.toast('🔥 Hot hand! You run 25% faster for 60 s'); AU.play('chime'); }
        else UI.toast(`Swish! ${this.streak} in a row`);
      } else { this.streak = 0; AU.play('boing', h, 0.5); UI.toast('Clang! Missed'); }
    }, 800);
  },
  cycleSeed(dir) {
    for (let k = 1; k <= CROPS.length; k++) {
      const i = (this.seedSel + dir * k + CROPS.length * 2) % CROPS.length;
      if (G.seeds[i] > 0) { this.seedSel = i; UI.dirty = true; return; }
    }
  },
};
