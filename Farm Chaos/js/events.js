// events.js — the chaos. Every event is seeded, so all clients simulate the same tornado path,
// meteor targets and lightning strikes. Only the host applies damage to crops/buildings/animals;
// every client applies damage to its own player.
'use strict';

const EV = {
  defs: {}, active: [], nextAt: 0, nextId: 1, combos: new Set(),
  def(id, d) { d.id = id; this.defs[id] = d; },
  has(type) { return this.active.some(e => e.type === type && e.phase === 'active'); },
  get(type) { return this.active.find(e => e.type === type && e.phase === 'active'); },
  apocActive() { return this.active.some(e => e.def.tier === 'apoc'); },

  // ---- host: start an event and tell everyone ----
  start(type, extra) {
    const d = this.defs[type]; if (!d) return;
    const inst = { id: this.nextId++, type, seed: (Math.random() * 1e9) | 0, t0: G.time, warn: d.warn, dur: U.rand(d.dur[0], d.dur[1]), p: extra || {} };
    if (d.hostParams) Object.assign(inst.p, d.hostParams());
    this.add(inst);
    Game.broadcast({ k: 'ev', e: inst });
    G.stats.events++;
  },
  add(inst) {
    if (this.active.some(e => e.id === inst.id)) return;
    const d = this.defs[inst.type];
    const e = Object.assign({}, inst, { def: d, rng: U.rng(inst.seed), d: {}, phase: 'warn', objs: [] });
    e.add = o => { W.scene.add(o); e.objs.push(o); return o; };
    if (d.init) d.init(e);
    this.active.push(e);
    const late = G.time - e.t0 > e.warn;
    if (!late) { UI.eventWarning(e); AU.play(d.siren || (d.tier === 'minor' ? 'warn' : 'siren')); }
  },
  end(e) {
    if (e.def.end) e.def.end(e);
    for (const o of e.objs) W.scene.remove(o);
    e.phase = 'over';
  },
  endAll() { for (const e of this.active) this.end(e); this.active = []; this.combos.clear(); UI.renderEvents(); },

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i], lt = G.time - e.t0;
      if (lt < e.warn) { if (e.def.warnUpdate) e.def.warnUpdate(e, dt, lt, e.warn - lt); continue; }
      const at = lt - e.warn;
      if (at >= e.dur) { this.end(e); this.active.splice(i, 1); UI.renderEvents(); continue; }
      if (e.phase === 'warn') { e.phase = 'active'; if (e.def.begin) e.def.begin(e, at); UI.renderEvents(); }
      if (e.def.update) e.def.update(e, dt, at);
      if (G.isHost && e.def.host) e.def.host(e, dt, at);
    }
    // combos
    for (const [a, b, name] of COMBOS) {
      const k = a + b;
      if (this.has(a) && this.has(b)) { if (!this.combos.has(k)) { this.combos.add(k); UI.combo(name); AU.play('chime'); } }
      else this.combos.delete(k);
    }
  },

  // ---- host scheduler ----
  hostSchedule(dt) {
    if (G.final || !G.started) return;
    const day = G.day();
    if (S.d.host.calmDay1 && day === 1 && !G.endless) { this.nextAt = Math.max(this.nextAt, G.time + 15); return; }
    if (G.time < this.nextAt) return;
    let freq = S.d.host.freq * (G.endless ? 1.4 : 1);
    if (freq <= 0) { this.nextAt = G.time + 10; return; }
    const chaos = Math.min(0.6, Game.chaosPeppers() * 0.02); freq *= 1 + chaos;
    if (this.has('eclipse')) freq *= 2;
    const live = this.active.filter(e => e.def.tier !== 'apoc').length;
    if (live >= Math.round(2 + freq * 1.5)) { this.nextAt = G.time + 5; return; }
    // apocalypse?
    const apocChance = { off: 0, rare: 0.004, normal: 0.012, often: 0.04 }[S.d.host.apoc] || 0;
    if ((day >= 5 || G.endless) && !this.apocActive() && Math.random() < apocChance) this.start(Math.random() < 0.5 ? 'blackhole' : 'supernova');
    else {
      let n = 1; if (Math.random() < 0.22 * freq) n++; if (Math.random() < 0.06 * freq) n++;
      for (let k = 0; k < n; k++) { const t = this.pickType(day); if (t) this.start(t); }
    }
    const mean = 42 / freq;
    this.nextAt = G.time + U.clamp(-Math.log(1 - Math.random()) * mean, 10 / freq, 140 / freq);
  },
  pickType(day) {
    const pool = [];
    for (const id in this.defs) {
      const d = this.defs[id];
      if (d.tier === 'apoc' || (d.minDay > day && !G.endless) || this.active.some(e => e.type === id)) continue;
      if (d.night && !(G.hour() >= 20 || G.hour() < 5)) continue;
      pool.push([id, d.w]);
    }
    let sum = pool.reduce((s, p) => s + p[1], 0), r = Math.random() * sum;
    for (const [id, w] of pool) { r -= w; if (r <= 0) return id; }
    return null;
  },
};

const COMBOS = [
  ['tornado', 'frograin', 'FROGNADO!'], ['tornado', 'wildfire', 'FIRENADO!'], ['lowgrav', 'flood', 'FLOATING FLOOD!'],
  ['acidrain', 'flood', 'ACID FLOOD!'], ['hurricane', 'fishrain', 'FISHICANE!'], ['blizzard', 'heatwave', 'WEIRD WEATHER'],
  ['meteors', 'lowgrav', 'SPACE ROCKS!'], ['tornado', 'hurricane', 'DOUBLE TROUBLE'], ['aliens', 'cropcircle', 'FULL INVASION'],
];

// ---------------- helpers ----------------
const H = {
  d(x, z) { return Math.hypot(P.pos.x - x, P.pos.z - z); },
  exposed() { return !P.inBunker && !P.sheltered && !P.dead; },
  farmPoint(r) { return { x: r.range(-38, 40), z: r.range(-42, 34) }; },
  fieldPoint(r) { const owned = PLOTS.filter((p, i) => G.plots[i]); const p = owned[Math.floor(r() * owned.length) % owned.length] || PLOTS[0]; return { x: p.x + r() * PLOT_N * TILE, z: p.z + r() * PLOT_N * TILE }; },
  // host: each crop has `rate` chance per second to be destroyed (or mutated)
  crops(dt, rate, cause, o = {}) {
    if (!G.isHost) return;
    const T = W.tiles;
    for (let i = 0; i < TILES_TOTAL; i++) {
      if (T.c[i] < 0) continue;
      if (o.gh && W.greenhouse(i)) continue;
      if (o.x !== undefined) { const p = W.tilePos(i); if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 > o.r * o.r) continue; }
      let r = rate; if (o.wind && G.has('windfence')) r *= 0.5; if (o.quake && G.has('seismic')) r *= 0.5; if (o.heat && G.has('sprinkler')) r *= 0.5; if (o.pest && G.has('scarecrow')) r *= 0.5;
      if (o.mut && Math.random() < o.mutRate * dt) { if (T.m[i] === 0) Game.mutateTile(i, o.mut); continue; }
      if (Math.random() < r * dt) Game.destroyTile(i, cause);
    }
  },
  cropsIn(x, z, r, cause) { if (!G.isHost) return; for (const i of W.tilesNear(x, z, r)) if (W.tiles.c[i] >= 0) Game.destroyTile(i, cause); },
  // host: each building piece has `rate` chance per second to break
  pieces(dt, rate, force, roofMult = 1, o = {}) {
    if (!G.isHost) return;
    W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => {
      if (p.broken) return;
      if (o.x !== undefined && p.center.distanceTo(_hv.set(o.x, o.y || p.center.y, o.z)) > o.r) return;
      if (Math.random() < rate * dt * (p.roof ? roofMult : 1)) Game.breakPiece(bi, pi, o.ox !== undefined ? o.ox : p.center.x - FX.wind.x, o.oy !== undefined ? o.oy : p.center.y - 1, o.oz !== undefined ? o.oz : p.center.z - FX.wind.z, force);
    }));
  },
  piecesIn(x, y, z, r, force) { if (!G.isHost) return; for (const [bi, pi] of W.piecesNear(x, y, z, r)) Game.breakPiece(bi, pi, x, y - 1, z, force); },
  marker(e, x, z, r, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, W.height(x, z) + 0.12, z); return e ? e.add(m) : (W.scene.add(m), m);
  },
  // schedule impacts at init time (seeded, identical on all clients)
  schedule(e, every, mk) {
    const list = []; let t = e.rng.range(0.2, every[1]);
    while (t < e.dur - 0.5) { list.push(Object.assign({ t, done: false, spawned: false }, mk(t))); t += e.rng.range(every[0], every[1]); }
    const lt = G.time - e.t0 - e.warn;
    for (const im of list) if (im.t < lt - 0.3) { im.done = true; im.spawned = true; }
    e.d.imp = list;
  },
  // drive scheduled impacts: lead = seconds the projectile is visible before impact
  impacts(e, at, lead, spawn, hit) {
    for (const im of e.d.imp) {
      if (im.done) continue;
      if (!im.spawned && at >= im.t - lead) { im.spawned = true; if (spawn) spawn(im); }
      if (at >= im.t) { im.done = true; hit(im); }
    }
  },
  // a projectile flying from (sx,sy,sz) to (x,0,z) arriving at event-time im.t
  flyer(e, im, geo, lead, arc, trail, scale = 1) {
    const m = new THREE.Mesh(geo, M.mat); m.userData.keepGeo = true; m.scale.setScalar(scale); m.castShadow = true;
    const ty = W.height(im.x, im.z);
    FX.temp(m, lead + 0.1, () => {
      const at = G.time - e.t0 - e.warn, k = U.clamp(1 - (im.t - at) / lead, 0, 1);
      m.position.set(U.lerp(im.sx, im.x, k), U.lerp(im.sy, ty, k) + Math.sin(k * Math.PI) * arc, U.lerp(im.sz, im.z, k));
      m.rotation.x += 0.1; m.rotation.z += 0.07;
      if (trail) trail(m.position);
      return k < 1;
    });
  },
  hurtNear(x, z, rKill, rHurt, dmg, cause, launch = 10, apoc) {
    const d = H.d(x, z);
    if (Math.abs(P.pos.y - W.height(x, z)) > 12) return;
    if (d < rKill) { P.fallCause = cause; P.hurt(999, cause, { apoc }); }
    else if (d < rHurt) {
      const k = 1 - (d - rKill) / (rHurt - rKill);
      P.hurt(dmg * k, cause, { apoc });
      const dx = (P.pos.x - x) / (d || 1), dz = (P.pos.z - z) / (d || 1);
      P.launch(dx * launch * k, launch * 0.7 * k + 2, dz * launch * k); P.fallCause = cause;
    }
  },
  // the burning building piece the local player is aiming water at, if any
  burnTarget(cp, dir) {
    let best = null, bd = 7;
    for (const type of WATER_EVENTS) {
      const e = EV.get(type); if (!e) continue;
      for (const f of e.d.fires) {
        const c = W.buildings[f.bi].pieces[f.pi].center, dx = c.x - cp.x, dy = c.y - cp.y, dz = c.z - cp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < bd && (dx * dir.x + dy * dir.y + dz * dir.z) / d > 0.8) { bd = d; best = { type, bi: f.bi, pi: f.pi }; }
      }
    }
    return best;
  },
  // a big kickable event creature (giant chicken, robot) the local player is facing
  bigTarget(cp, dir) {
    for (const type of ['giantchicken', 'robot']) {
      const e = EV.get(type); if (!e || !e.d.r || e.d.u.done) continue;
      const dx = e.d.r.x - cp.x, dz = e.d.r.z - cp.z, d = Math.hypot(dx, dz);
      if (d < 5 && (dx * dir.x + dz * dir.z) / d > 0.55) return type;
    }
    return null;
  },
  ambientFire(x, z, n = 2) { for (let i = 0; i < n; i++) FX.glow(x + U.rand(-0.5, 0.5), W.height(x, z) + 0.3, z + U.rand(-0.5, 0.5), U.rand(-0.3, 0.3), U.rand(1.5, 3), U.rand(-0.3, 0.3), 0.6, 0.6, Math.random() < 0.5 ? 0xff8a20 : 0xffc040, { drag: 1, grow: -0.5 }); },
};
const _hv = new V3();
// glowing accretion disk: bright inside, fading to black (= invisible with additive blending) outside
function diskMesh(inner, outer) {
  const g = new THREE.RingGeometry(inner, outer, 64, 6), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const r = (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner), a = Math.atan2(p.getY(i), p.getX(i));
    c.setHex(0xfff0c0).lerp(new THREE.Color(0xff6a10), Math.min(1, r * 1.6)).multiplyScalar(Math.pow(1 - r, 1.6) * (0.8 + 0.2 * Math.sin(a * 7 + r * 12)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
}

// ======================================================================
// MINOR EVENTS
// ======================================================================
EV.def('acidrain', { name: 'Acid Rain', icon: '🧪', tier: 'minor', w: 1, minDay: 2, warn: 7, dur: [25, 40], msg: 'Acid rain incoming — get under a roof!',
  warnUpdate(e, dt, lt, left) { W.tint(0x7aa040, 0.25 * (1 - left / e.warn)); },
  update(e, dt, at) {
    const k = Math.min(1, at / 3, (e.dur - at) / 3);
    W.tint(0x8fc040, 0.45 * k); W.darken(0.3 * k); FX.want.acid = k;
    if (H.exposed() && !G.has('hazmat')) P.hurt(7 * dt * k, 'dissolved by acid rain');
    if (Math.random() < dt * 30 * k) FX.emit(P.pos.x + U.rand(-8, 8), W.height(P.pos.x, P.pos.z) + 0.1, P.pos.z + U.rand(-8, 8), 0, 1, 0, 0.6, 0.4, 0xb8ff6a, { grow: 1 });
  },
  host(e, dt) { H.crops(dt, 0.012, 'dissolved by acid', { gh: true, mut: 1, mutRate: 0.007 }); },
});

EV.def('hail', { name: 'Hailstorm', icon: '🧊', tier: 'minor', w: 1, minDay: 2, warn: 6, dur: [18, 30], msg: 'Hail! Find a roof or wear a hard hat.',
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2);
    W.tint(0x8a9aa8, 0.4 * k); W.darken(0.35 * k); FX.want.hail = k; FX.want.rain = 0.4 * k;
    if (H.exposed() && Math.random() < dt * 0.6 * k) { P.hurt(G.has('hardhat') ? 3 : 7, 'pelted by hail'); AU.play('land', null, 0.4); }
  },
  host(e, dt) { H.crops(dt, 0.015, 'smashed by hail', { gh: true }); },
});

EV.def('fog', { name: 'Thick Fog', icon: '🌫️', tier: 'minor', w: 0.8, minDay: 2, warn: 4, dur: [35, 55], msg: 'Fog rolls in... something is out there.',
  init(e) {
    const m = new THREE.Mesh(AN.geo.cow.body, new THREE.MeshLambertMaterial({ color: 0x111418 })); m.scale.setScalar(14); e.d.giant = e.add(m);
    e.d.eyes = []; for (const x of [-0.12, 0.12]) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false })); s.position.set(x, 1.32, 1.24); m.add(s); }
    m.visible = false;
  },
  update(e, dt, at) {
    const k = Math.min(1, at / 4, (e.dur - at) / 4);
    W.fog(1, 24, k); W.tint(0xb8c0c8, 0.55 * k);
    const r = 70;
    e.d.giant.visible = k > 0.5; e.d.giant.position.set(Math.cos(at * 0.05 + 1) * r, 0, -5 + Math.sin(at * 0.05 + 1) * r); e.d.giant.rotation.y = -at * 0.05 - 1;
    if (Math.random() < dt * 0.15) AU.play('moo', e.d.giant.position, 0.8);
  },
});

EV.def('sandstorm', { name: 'Sandstorm', icon: '🏜️', tier: 'minor', w: 0.8, minDay: 2, warn: 6, dur: [20, 32], msg: 'Sandstorm! Crouch to stay on your feet.',
  init(e) { const a = e.rng() * 6.28; e.d.wx = Math.cos(a); e.d.wz = Math.sin(a); },
  update(e, dt, at) {
    const k = Math.min(1, at / 3, (e.dur - at) / 3);
    W.tint(0xc9a46a, 0.65 * k); W.fog(3, 40, k); FX.want.sand = k;
    FX.wind.x += e.d.wx * 14 * k; FX.wind.z += e.d.wz * 14 * k; W.windUniform.value = Math.max(W.windUniform.value, 1.5 * k);
    if (!P.inBunker) { P.force.x += e.d.wx * 9 * k; P.force.z += e.d.wz * 9 * k; }
    if (H.exposed()) P.hurt(1.2 * dt * k, 'sandblasted');
    AU.loop('wind', 0.6 * k);
  },
  host(e, dt) { H.crops(dt, 0.008, 'buried in sand', { wind: true }); },
});

EV.def('lowgrav', { name: 'Low Gravity', icon: '🪐', tier: 'minor', w: 1, minDay: 2, warn: 5, dur: [25, 40], msg: 'Gravity is failing! Jump carefully.',
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2);
    W.env.gravity *= U.lerp(1, 0.2, k); W.tint(0x8a6ad8, 0.15 * k);
    if (Math.random() < dt * 20 * k) FX.glow(P.pos.x + U.rand(-10, 10), U.rand(0, 3), P.pos.z + U.rand(-10, 10), 0, 0.8, 0, 3, 0.12, 0xd0c0ff);
  },
  host(e, dt) { for (const a of AN.list) if (a.state === 'wander' && Math.random() < dt * 0.15) { a.vy = 5; a.y += 0.05; } },
});

EV.def('heavygrav', { name: 'Heavy Gravity', icon: '🏋️', tier: 'minor', w: 0.7, minDay: 2, warn: 5, dur: [18, 28], msg: 'Gravity is doubling! Don\'t jump off anything.',
  update(e, dt, at) { const k = Math.min(1, at / 2, (e.dur - at) / 2); W.env.gravity *= U.lerp(1, 2.6, k); W.env.speed *= U.lerp(1, 0.7, k); W.darken(0.12 * k); },
});

EV.def('bouncy', { name: 'Bouncy Ground', icon: '🦘', tier: 'minor', w: 0.7, minDay: 2, warn: 4, dur: [20, 30], msg: 'The ground feels... springy.',
  update(e, dt, at) { W.env.bouncy = true; W.tint(0xff9ad8, 0.12); },
  host(e, dt) { for (const a of AN.list) if ((a.state === 'wander' || a.state === 'idle') && Math.random() < dt * 0.4) { a.vy = 7; a.y += 0.05; } },
});

EV.def('frograin', { name: 'Frog Rain', icon: '🐸', tier: 'minor', w: 0.9, minDay: 2, warn: 5, dur: [20, 32], msg: 'It\'s raining frogs. Catch them, they sell!',
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2); FX.want.frogs = k; FX.want.rain = 0.3 * k; W.tint(0x6a9a5a, 0.25 * k);
    if (H.exposed() && Math.random() < dt * 0.12 * k) { P.hurt(G.has('hardhat') ? 2 : 4, 'hit by a falling frog'); AU.play('croak'); }
    const tor = EV.get('tornado'); if (tor && tor.d.pos) for (let i = 0; i < 3; i++) { const a = Math.random() * 6.28, h = Math.random() * 25; FX.glow(tor.d.pos.x + Math.cos(a) * (2 + h * 0.3), h, tor.d.pos.z + Math.sin(a) * (2 + h * 0.3), -Math.sin(a) * 8, 0, Math.cos(a) * 8, 0.5, 0.35, 0x4caf3a); }
  },
  host(e, dt, at) { e.d.sp = (e.d.sp || 0) + dt; if (e.d.sp > 0.7) { e.d.sp = 0; if (Game.countPickups('frog') < 30) { const p = H.farmPoint(U.rng(Math.random() * 1e9)); Game.spawnPickup('frog', p.x, p.z); } } H.crops(dt, 0.004, 'eaten by frogs', { gh: true }); },
});

EV.def('fishrain', { name: 'Fish Rain', icon: '🐟', tier: 'minor', w: 0.8, minDay: 2, warn: 5, dur: [18, 28], msg: 'Fish are falling from the sky. Free fish!',
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2); FX.want.fish = k; FX.want.rain = 0.5 * k; W.tint(0x6a8ab0, 0.25 * k);
    if (H.exposed() && Math.random() < dt * 0.12 * k) { P.hurt(G.has('hardhat') ? 3 : 6, 'slapped by a flying fish'); AU.play('splash'); }
  },
  host(e, dt) { e.d.sp = (e.d.sp || 0) + dt; if (e.d.sp > 0.8) { e.d.sp = 0; if (Game.countPickups('fish') < 25) { const p = H.farmPoint(U.rng(Math.random() * 1e9)); Game.spawnPickup('fish', p.x, p.z); } } },
});

EV.def('chickens', { name: 'Angry Chickens', icon: '🐔', tier: 'minor', w: 0.9, minDay: 2, warn: 5, dur: [20, 30], msg: 'The chickens have had enough. Kick them away!',
  begin(e) { if (G.isHost) for (const a of AN.list) if (a.kind === 'chicken' && a.state !== 'gone' && a.state !== 'carried') { a.state = 'angry'; a.t = e.dur; } },
  update(e, dt) { if (Math.random() < dt * 2) AU.play('cluck', AN.list.find(a => a.state === 'angry'), 0.8); },
  end(e) { if (G.isHost) for (const a of AN.list) if (a.state === 'angry') a.state = 'return'; },
});

EV.def('gnomes', { name: 'Gnome Invasion', icon: '🧙', tier: 'minor', w: 0.9, minDay: 2, warn: 6, dur: [25, 35], msg: 'Gnomes are stealing your crops! Click to kick them.',
  host(e, dt, at) {
    e.d.sp = (e.d.sp || 0) - dt;
    if (at < e.dur * 0.6 && e.d.sp <= 0) { e.d.sp = 1.6; const a = Math.random() * 6.28; AN.spawnGnome(Math.cos(a) * 70, -5 + Math.sin(a) * 70); }
    if (G.has('laser') && Math.random() < dt * 0.4 && AN.gnomes.length) { const g = U.pick(AN.gnomes); Game.broadcastLocal({ k: 'zap', x: g.x, y: g.y + 0.5, z: g.z }); g.vx = U.rand(-8, 8); g.vy = 10; g.vz = U.rand(-8, 8); g.state = 'flung'; }
  },
});

EV.def('crash', { name: 'Market Crash', icon: '📉', tier: 'minor', w: 0.5, minDay: 2, warn: 3, dur: [60, 90], msg: 'MARKET CRASH: crops sell for 40% — maybe wait before shipping.',
  update(e) { if (G.isHost) G.priceMult = 0.4; }, end() { if (G.isHost) G.priceMult = 1; },
});
EV.def('boom', { name: 'Market Boom', icon: '📈', tier: 'minor', w: 0.5, minDay: 2, warn: 3, dur: [45, 70], msg: 'MARKET BOOM: everything sells for DOUBLE. Ship it now!',
  update(e) { if (G.isHost) G.priceMult = 2; }, end() { if (G.isHost) G.priceMult = 1; },
});

EV.def('timewarp', { name: 'Time Warp', icon: '⏩', tier: 'minor', w: 0.6, minDay: 2, warn: 4, dur: [20, 30], msg: 'Time is speeding up — crops grow 6× faster!',
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2), h = (at * 0.3) % 1;
    W.tint(new THREE.Color().setHSL(h, 0.7, 0.6).getHex(), 0.3 * k); W.env.speed *= 1 + 0.3 * k;
    W.windUniform.value = Math.max(W.windUniform.value, 2 * k);
  },
});

EV.def('eclipse', { name: 'Solar Eclipse', icon: '🌑', tier: 'minor', w: 0.5, minDay: 2, warn: 6, dur: [30, 45], msg: 'Solar eclipse: crops stop growing, and the chaos doubles.',
  init(e) { e.d.eyes = []; },
  update(e, dt, at) {
    const k = Math.min(1, at / 5, (e.dur - at) / 5);
    W.env.eclipse = Math.max(W.env.eclipse, k); W.darken(0.75 * k); W.env.stars = Math.max(W.env.stars, k * 0.8); W.tint(0x2a1a4a, 0.4 * k);
    if (k > 0.6 && Math.random() < dt * 3) { const a = Math.random() * 6.28, r = U.rand(60, 75), x = Math.cos(a) * r, z = -5 + Math.sin(a) * r; for (const o of [-0.25, 0.25]) FX.glow(x + o * Math.sin(a), W.height(x, z) + 1.5, z - o * Math.cos(a), 0, 0, 0, 3, 0.35, 0xff2020); }
  },
});

EV.def('cropcircle', { name: 'Crop Circles', icon: '🛸', tier: 'minor', w: 0.6, minDay: 2, warn: 5, dur: [14, 16], msg: 'A UFO is drawing on your fields...',
  init(e) {
    const owned = PLOTS.map((p, i) => i).filter(i => G.plots[i]); e.d.plot = owned[Math.floor(e.rng() * owned.length) % owned.length] || 0;
    const p = PLOTS[e.d.plot]; e.d.cx = p.x + PLOT_N * TILE / 2; e.d.cz = p.z + PLOT_N * TILE / 2;
    e.d.ufo = e.add(new THREE.Mesh(M.ufo(), M.matGlow)); e.d.ufo.visible = false;
  },
  update(e, dt, at) {
    const u = e.d.ufo; u.visible = true;
    const k = U.clamp(at / 4, 0, 1), leave = U.clamp((at - 10) / 4, 0, 1);
    const a = at * 2;
    u.position.set(e.d.cx + Math.cos(a) * 4 * (1 - leave) + leave * 120, 14 + (1 - k) * 60 + leave * 60, e.d.cz + Math.sin(a) * 4 * (1 - leave));
    u.rotation.y += dt * 3;
    if (at > 4 && at < 10) for (let i = 0; i < 4; i++) { const r = Math.random() * 6, b = Math.random() * 6.28; FX.glow(e.d.cx + Math.cos(b) * r, 0.3, e.d.cz + Math.sin(b) * r, 0, 1, 0, 0.8, 0.5, 0x9cffd0); }
    AU.loop('hum', 0.4 * (1 - leave));
    if (at > 10 && !e.d.done) {
      e.d.done = true; FX.decal(e.d.cx, e.d.cz, 5.5, 30);
      if (G.isHost) for (const i of W.tilesNear(e.d.cx, e.d.cz, 7)) { if (W.tiles.c[i] < 0) continue; const p = W.tilePos(i), d = Math.hypot(p.x - e.d.cx, p.z - e.d.cz); if ((d > 1.5 && d < 3.2) || d > 5.2) Game.destroyTile(i, 'flattened into a crop circle'); else if (Math.random() < 0.45) Game.mutateTile(i, 3); }
    }
  },
});

EV.def('geysers', { name: 'Geysers', icon: '⛲', tier: 'minor', w: 0.7, minDay: 2, warn: 5, dur: [22, 32], msg: 'Geysers are bursting out of the ground!',
  init(e) {
    e.d.g = []; const n = e.rng.int(5, 8);
    for (let i = 0; i < n; i++) { const p = i < 4 ? H.fieldPoint(e.rng) : H.farmPoint(e.rng); e.d.g.push({ x: p.x, z: p.z, period: e.rng.range(4, 7), off: e.rng.range(0, 4), last: -1 }); }
  },
  update(e, dt, at) {
    for (const g of e.d.g) {
      const ph = (at + g.off) % g.period, cyc = Math.floor((at + g.off) / g.period);
      if (ph > g.period - 1.5) { if (Math.random() < dt * 20) FX.emit(g.x + U.rand(-0.4, 0.4), 0.1, g.z + U.rand(-0.4, 0.4), 0, U.rand(1, 2), 0, 0.6, 0.35, 0xdff4ff); }
      if (ph < 1.6) {
        for (let i = 0; i < 6 * S.d.particles; i++) FX.emit(g.x + U.rand(-0.3, 0.3), 0.2, g.z + U.rand(-0.3, 0.3), U.rand(-1.5, 1.5), U.rand(16, 24), U.rand(-1.5, 1.5), 1.6, 0.6, Math.random() < 0.5 ? 0xe0f4ff : 0x9cd0f0, { g: 16, grow: 1 });
        if (g.last !== cyc) { g.last = cyc; AU.play('splash', { x: g.x, y: 0, z: g.z }, 1); if (G.isHost) H.cropsIn(g.x, g.z, 1.3, 'blasted by a geyser'); }
        if (H.d(g.x, g.z) < 1.6 && P.pos.y < 3) { P.launch(0, 26 - P.vel.y, 0); P.fallCause = 'launched by a geyser'; }
      }
    }
  },
});

EV.def('mole', { name: 'Giant Mole', icon: '🦫', tier: 'minor', w: 0.7, minDay: 2, warn: 5, dur: [24, 34], msg: 'A giant mole is tunnelling through your fields!',
  init(e) {
    const owned = PLOTS.filter((p, i) => G.plots[i]); e.d.pts = [];
    for (let i = 0; i < 5; i++) { const p = H.fieldPoint(e.rng); e.d.pts.push(p); }
    const b = new MB(); b.ico(1.1, 1, 0x6b4a2f, 0, 0, 0, 1.2, 0.45, 1.2, 0.25); e.d.mound = e.add(b.mesh());
    e.d.mole = e.add(new THREE.Mesh(M.mole(), M.mat)); e.d.mole.visible = false;
  },
  pos(e, at) {
    const n = e.d.pts.length, f = U.clamp(at / e.dur, 0, 0.999) * (n - 1), i = Math.floor(f), t = f - i, a = e.d.pts[i], b = e.d.pts[i + 1];
    return { x: U.lerp(a.x, b.x, t) + Math.sin(at * 1.3) * 1.5, z: U.lerp(a.z, b.z, t) + Math.cos(at * 1.1) * 1.5 };
  },
  update(e, dt, at) {
    const p = this.pos(e, at); e.d.p = p;
    e.d.mound.position.set(p.x, 0.05 + Math.abs(Math.sin(at * 6)) * 0.15, p.z);
    for (let i = 0; i < 3; i++) FX.emit(p.x + U.rand(-1, 1), 0.3, p.z + U.rand(-1, 1), U.rand(-2, 2), U.rand(2, 5), U.rand(-2, 2), 1, 0.4, 0x6b4a2f, { g: 14 });
    const pop = Math.sin(at * 0.9) > 0.85; e.d.mole.visible = pop; e.d.mole.position.set(p.x, pop ? 0.2 : -2, p.z); e.d.mole.rotation.y = at;
    if (H.d(p.x, p.z) < 1.7 && P.onGround) { P.launch(U.rand(-4, 4), 11, U.rand(-4, 4)); P.hurt(8, 'tossed by a giant mole'); }
    AU.loop('rumble', U.clamp(1 - H.d(p.x, p.z) / 30, 0, 1) * 0.6);
  },
  host(e, dt) { if (e.d.p) { e.d.ht = (e.d.ht || 0) + dt; if (e.d.ht > 0.15) { e.d.ht = 0; const r = G.has('seismic') && Math.random() < 0.5 ? 0 : 1.4; if (r) H.cropsIn(e.d.p.x, e.d.p.z, r, 'eaten by a giant mole'); } } },
});

EV.def('locusts', { name: 'Locust Swarm', icon: '🦗', tier: 'minor', w: 0.8, minDay: 2, warn: 6, dur: [22, 32], msg: 'A locust swarm is coming for your crops!',
  init(e) { e.d.a = e.rng.range(0.08, 0.15); e.d.b = e.rng.range(0.06, 0.12); e.d.ph = e.rng() * 6; },
  pos(e, at) { return { x: Math.sin(at * e.d.a * 6 + e.d.ph) * 28, z: 18 + Math.cos(at * e.d.b * 6 + e.d.ph) * 16 }; },
  update(e, dt, at) {
    const p = this.pos(e, at); e.d.p = p;
    for (let i = 0; i < 30 * S.d.particles; i++) { const a = Math.random() * 6.28, r = Math.random() * 6; FX.emit(p.x + Math.cos(a) * r, U.rand(0.5, 4), p.z + Math.sin(a) * r, U.rand(-6, 6), U.rand(-1, 1), U.rand(-6, 6), 0.4, 0.12, 0x2a2a14); }
    const d = H.d(p.x, p.z); AU.loop('buzz', U.clamp(1 - d / 25, 0, 1) * 0.35);
    if (d < 6 && !P.inBunker) P.hurt(3 * dt, 'eaten alive by locusts');
  },
  host(e, dt) { if (e.d.p) H.crops(dt, 0.09, 'devoured by locusts', { gh: true, pest: true, x: e.d.p.x, z: e.d.p.z, r: 5.5 }); },
});

EV.def('rats', { name: 'Rat Plague', icon: '🐀', tier: 'minor', w: 0.9, minDay: 2, warn: 6, dur: [30, 42], msg: 'Rats are swarming the fields! Kick them before they eat everything.',
  host(e, dt, at) {
    e.d.sp = (e.d.sp || 0) - dt;
    const rats = AN.gnomes.filter(g => g.kind === 'rat');
    if (at < e.dur * 0.6 && e.d.sp <= 0 && rats.length < 24) {
      e.d.sp = 0.7;
      // barn cats catch most rats on their way in
      if (G.has('cats') && Math.random() < 0.65) { if (!e.d.caught) { e.d.caught = true; Game.log('🐈 The barn cats are hunting the rats!'); } }
      else { const a = Math.random() * 6.28; AN.spawnGnome(Math.cos(a) * 62, -5 + Math.sin(a) * 62, 'rat'); }
    }
    if (G.has('cats') && rats.length && Math.random() < dt * 0.35) { const r = U.pick(rats); W.scene.remove(r.mesh); AN.gnomes.splice(AN.gnomes.indexOf(r), 1); }
  },
  end() { if (G.isHost) for (const g of AN.gnomes) if (g.kind === 'rat' && g.state === 'seek') g.state = 'flee'; },
});

EV.def('crows', { name: 'Crow Flock', icon: '🐦', tier: 'minor', w: 0.8, minDay: 2, warn: 5, dur: [24, 34], msg: 'Crows are diving on the crops! Run at the flock to scare it away.',
  init(e) { e.d.a = e.rng.range(0.1, 0.18); e.d.b = e.rng.range(0.07, 0.13); e.d.ph = e.rng() * 6; },
  pos(e, at) { return { x: Math.cos(at * e.d.a * 6 + e.d.ph) * 26, z: 18 + Math.sin(at * e.d.b * 6 + e.d.ph) * 15 }; },
  update(e, dt, at) {
    const p = this.pos(e, at); e.d.p = p;
    for (let i = 0; i < 14 * S.d.particles; i++) { const a = at * 2 + i * 0.7, r = 2 + (i % 5); FX.emit(p.x + Math.cos(a) * r, 1.5 + (i % 4) + Math.sin(at * 6 + i) * 0.4, p.z + Math.sin(a) * r, -Math.sin(a) * 4, U.rand(-0.5, 0.5), Math.cos(a) * 4, 0.12, 0.28, 0x16161a); }
    if (Math.random() < dt * 1.5) AU.play('caw', { x: p.x, y: 3, z: p.z }, 0.8);
  },
  // a farmer standing in the flock scares it off those crops
  host(e, dt) { const p = e.d.p; if (!p || Game.alivePlayers().some(q => Math.hypot(q.x - p.x, q.z - p.z) < 5)) return; H.crops(dt, 0.06, 'eaten by crows', { gh: true, pest: true, x: p.x, z: p.z, r: 5 }); },
});

EV.def('drought', { name: 'Drought', icon: '🏜️', tier: 'minor', w: 0.7, minDay: 3, warn: 5, dur: [60, 90], msg: 'Drought! Only watered crops grow — grab the watering can or the bucket.',
  update(e, dt, at) { const k = Math.min(1, at / 4, (e.dur - at) / 4); W.tint(0xe8b060, 0.18 * k); W.env.sunGlow = 1 + k; },
  // watered soil dries out quickly in the heat
  host(e, dt) { const T = W.tiles; for (let i = 0; i < TILES_TOTAL; i++) if (T.w[i] && !W.greenhouse(i) && Math.random() < dt * 0.025) { T.w[i] = 0; Game.mark(i); } },
});

EV.def('loose', { name: 'Animals Escaped', icon: '🐖', tier: 'minor', w: 0.7, minDay: 2, warn: 4, dur: [45, 60], msg: 'The animals broke out and are eating your crops! Carry them back to their pens (F).',
  begin() { if (G.isHost) for (const a of AN.list) if (a.kind !== 'chicken' && CALM(a.state)) { a.state = 'loose'; a.t = 0; } },
  end() { if (G.isHost) for (const a of AN.list) if (a.state === 'loose') a.state = 'return'; },
});

EV.def('goldeggs', { name: 'Golden Eggs', icon: '🥚', tier: 'minor', w: 0.4, minDay: 2, warn: 3, dur: [40, 60], msg: 'The chickens are laying GOLDEN eggs. Collect them, they sell for a lot!',
  begin() { if (G.isHost) for (const a of AN.list) if (a.kind === 'chicken') a.eggT = U.rand(1, 8); },
  update(e, dt, at) { const k = Math.min(1, at / 2, (e.dur - at) / 2); W.tint(0xffd860, 0.08 * k); },
});

EV.def('reversegrav', { name: 'Gravity Flip', icon: '🙃', tier: 'minor', w: 0.6, minDay: 2, warn: 6, dur: [6, 8], msg: 'GRAVITY FLIP in a few seconds! Hold onto something...',
  update(e, dt, at) {
    const k = Math.min(1, at / 0.5, (e.dur - at) / 0.3);
    W.env.gravity = -0.5 * k + (1 - k) * W.env.gravity; W.env.roll = (W.env.roll || 0) + 0.15 * k;
    P.fallCause = 'fell back down after gravity flipped';
  },
  host(e, dt) { H.crops(dt, 0.05, 'fell into the sky'); },
});

EV.def('fireworks', { name: 'Fireworks Accident', icon: '🎆', tier: 'minor', w: 0.6, minDay: 2, warn: 4, dur: [12, 18], msg: 'Someone left the fireworks in the barn...',
  init(e) { H.schedule(e, [0.2, 0.5], () => { const p = H.farmPoint(e.rng); return { x: p.x, z: p.z, sx: 16, sy: 3, sz: -26, c: U.pick([0xff4040, 0x40ff80, 0x4080ff, 0xffe040, 0xff40ff], e.rng()) }; }); },
  update(e, dt, at) {
    H.impacts(e, at, 1.6, im => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 5), new THREE.MeshBasicMaterial({ color: im.c }));
      FX.temp(m, 1.7, () => { const k = U.clamp(1 - (im.t - (G.time - e.t0 - e.warn)) / 1.6, 0, 1); m.position.set(U.lerp(im.sx, im.x, k), U.lerp(im.sy, 0, k) + Math.sin(k * Math.PI) * 18, U.lerp(im.sz, im.z, k)); FX.glow(m.position.x, m.position.y, m.position.z, 0, 0, 0, 0.4, 0.4, 0xffd080); return k < 1; });
      AU.play('whoosh', { x: 16, y: 3, z: -26 }, 0.5);
    }, im => {
      for (let i = 0; i < 40 * S.d.particles; i++) { const a = Math.random() * 6.28, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u); FX.glow(im.x, 1.5, im.z, Math.cos(a) * r * 9, u * 9 + 3, Math.sin(a) * r * 9, 1.2, 0.5, im.c, { g: 4, drag: 1 }); }
      AU.play('explosion', { x: im.x, y: 1, z: im.z }, 0.5); FX.light.position.set(im.x, 3, im.z); FX.light.intensity = 3;
      H.hurtNear(im.x, im.z, 0, 2.8, 18, 'blown up by fireworks', 6);
      if (G.isHost && Math.random() < 0.4) { const t = W.tileAt(im.x, im.z); if (t >= 0) Game.igniteTile(t); }
    });
  },
});

// ======================================================================
// MAJOR EVENTS
// ======================================================================
EV.def('tornado', { name: 'Tornado', icon: '🌪️', tier: 'major', w: 1, minDay: 3, warn: 9, dur: [28, 40], msg: 'TORNADO WARNING — get underground or run!',
  init(e) {
    const r = e.rng; e.d.cx = r.range(-15, 20); e.d.cz = r.range(-20, 20); e.d.A = r.range(14, 24); e.d.B = r.range(12, 22); e.d.fa = r.range(0.11, 0.17); e.d.fb = r.range(0.08, 0.14); e.d.ph = r() * 6;
    const g = new THREE.Group();
    e.d.mat = new THREE.MeshLambertMaterial({ color: 0x8a8a84, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    e.d.rings = [];
    for (let i = 0; i < 10; i++) { const rb = 1 + i * 0.9, rt = 1.6 + (i + 1) * 0.9; const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, 3.2, 9, 1, true), e.d.mat); m.position.y = i * 3 + 1.6; g.add(m); e.d.rings.push(m); }
    g.visible = false; e.d.g = e.add(g);
  },
  pos(e, at) { return { x: e.d.cx + Math.sin(at * e.d.fa * 3 + e.d.ph) * e.d.A, z: e.d.cz + Math.cos(at * e.d.fb * 3 + e.d.ph * 1.3) * e.d.B }; },
  warnUpdate(e, dt, lt, left) { const k = 1 - left / e.warn; W.darken(0.4 * k); W.tint(0x6a7060, 0.3 * k); AU.loop('wind', 0.3 * k); },
  update(e, dt, at) {
    const p = this.pos(e, at), k = Math.min(1, at / 3, (e.dur - at) / 3); e.d.pos = p;
    const fire = EV.has('wildfire');
    e.d.mat.color.setHex(fire ? 0xd0602a : 0x8a8a84);
    e.d.g.visible = true; e.d.g.position.set(p.x, W.height(p.x, p.z), p.z); e.d.g.scale.set(k, 1, k);
    e.d.rings.forEach((m, i) => { m.rotation.y += dt * (6 - i * 0.3); m.position.x = Math.sin(at * 2 + i * 0.5) * i * 0.25; });
    W.darken(0.4); W.tint(0x6a7060, 0.3); W.windUniform.value = Math.max(W.windUniform.value, 2.5);
    for (let i = 0; i < 8 * S.d.particles; i++) { const a = Math.random() * 6.28, h = Math.random() * 30, r = 1.5 + h * 0.35; FX.emit(p.x + Math.cos(a) * r, h, p.z + Math.sin(a) * r, -Math.sin(a) * 14, 3, Math.cos(a) * 14, 0.8, 0.5, fire ? 0xff7a2a : 0x7a6a50, { drag: 0.5 }); }
    const dx = p.x - P.pos.x, dz = p.z - P.pos.z, d = Math.hypot(dx, dz);
    AU.loop('wind', U.clamp(1.2 - d / 60, 0.2, 1) * k);
    if (d < 16 && !P.inBunker) {
      const f = (16 - d) * 3 * k; P.force.x += dx / d * f - dz / d * f * 0.8; P.force.z += dz / d * f + dx / d * f * 0.8;
      if (d < 5) { P.force.y += 75 * k; P.hurt(14 * dt, 'swept up by a tornado'); P.fallCause = 'dropped by a tornado'; }
    }
    if (fire && Math.random() < dt * 4 && G.isHost) { const t = W.tileAt(p.x, p.z); if (t >= 0) Game.igniteTile(t); }
  },
  host(e, dt, at) {
    const p = e.d.pos; if (!p) return;
    e.d.ht = (e.d.ht || 0) + dt; if (e.d.ht < 0.2) return; e.d.ht = 0;
    for (const i of W.tilesNear(p.x, p.z, 3.6)) if (W.tiles.c[i] >= 0 && !(G.has('windfence') && Math.random() < 0.5)) Game.destroyTile(i, 'sucked into a tornado');
    for (const [bi, pi] of W.piecesNear(p.x, 4, p.z, 5)) if (Math.random() < 0.35) Game.breakPiece(bi, pi, p.x, 0, p.z, 16);
    for (const a of AN.near(p.x, p.z, 6)) AN.fling(a, U.rand(-10, 10), U.rand(16, 24), U.rand(-10, 10));
  },
});

EV.def('hurricane', { name: 'Hurricane', icon: '🌀', tier: 'major', w: 0.9, minDay: 3, warn: 9, dur: [28, 38], msg: 'HURRICANE! Crouch to resist the wind, watch for debris.',
  init(e) {
    e.d.a0 = e.rng() * 6.28;
    H.schedule(e, [0.6, 1.4], t => { const a = e.d.a0 + t * 0.04, p = H.farmPoint(e.rng); return { x: p.x, z: p.z, a, kind: e.rng() < 0.5 ? 'crate' : 'plank' }; });
    e.d.geo = { crate: M.crate(), plank: M.plank() };
  },
  warnUpdate(e, dt, lt, left) { const k = 1 - left / e.warn; W.darken(0.35 * k); FX.want.rain = k * 0.5; AU.loop('wind', 0.4 * k); },
  update(e, dt, at) {
    const k = Math.min(1, at / 3, (e.dur - at) / 3), a = e.d.a0 + at * 0.04, wx = Math.cos(a), wz = Math.sin(a);
    W.darken(0.5 * k); W.tint(0x4a5a6a, 0.35 * k); FX.want.rain = k; W.fog(10, 90, k * 0.7);
    FX.wind.x += wx * 22 * k; FX.wind.z += wz * 22 * k; W.windUniform.value = Math.max(W.windUniform.value, 3 * k);
    W.env.roll = (W.env.roll || 0) + Math.sin(at * 1.7) * 0.03 * k;
    if (!P.inBunker && !P.sheltered) { P.force.x += wx * 17 * k; P.force.z += wz * 17 * k; }
    AU.loop('wind', 0.9 * k);
    H.impacts(e, at, 2.4, im => {
      const m = new THREE.Mesh(e.d.geo[im.kind], M.mat); m.userData.keepGeo = true; m.castShadow = true;
      const ux = Math.cos(im.a), uz = Math.sin(im.a);
      FX.temp(m, 3.6, () => {
        const nat = G.time - e.t0 - e.warn, s = (nat - im.t) * 24;
        m.position.set(im.x + ux * s, 1.4 + Math.sin(nat * 3) * 0.5, im.z + uz * s); m.rotation.x += 0.2; m.rotation.y += 0.13;
        if (Math.hypot(m.position.x - P.pos.x, m.position.z - P.pos.z) < 1.3 && Math.abs(P.pos.y + 1 - m.position.y) < 1.5 && !im.hitP) { im.hitP = true; P.hurt(G.has('hardhat') ? 12 : 24, 'hit by flying debris'); P.launch(ux * 12, 5, uz * 12); P.fallCause = 'blown away by a hurricane'; }
        return true;
      });
    }, () => { });
  },
  host(e, dt) {
    H.crops(dt, 0.02, 'blown away by a hurricane', { wind: true });
    H.pieces(dt, 0.006, 12, 3);
    const a = e.d.a0 + (G.time - e.t0 - e.warn) * 0.04;
    for (const an of AN.list) if ((an.state === 'wander' || an.state === 'idle') && Math.random() < dt * 0.03) AN.fling(an, Math.cos(a) * 12, 7, Math.sin(a) * 12);
  },
});

EV.def('lightning', { name: 'Lightning Storm', icon: '⚡', tier: 'major', w: 1, minDay: 3, warn: 7, dur: [22, 34], msg: 'Lightning storm! Don\'t stand in the open.',
  init(e) {
    H.schedule(e, [0.5, 1.5], () => {
      const p = e.rng() < 0.4 ? H.fieldPoint(e.rng) : H.farmPoint(e.rng);
      const rod = G.has('rod') && e.rng() < 0.8;
      if (rod) { const rp = W.props.rodPos; let best = rp[0]; for (const q of rp) if (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = q; return { x: best.x, z: best.z, rod: true }; }
      return { x: p.x, z: p.z };
    });
  },
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2);
    W.darken(0.55 * k); W.tint(0x2a3040, 0.4 * k); FX.want.rain = 0.8 * k;
    H.impacts(e, at, 1.3, im => { if (!im.rod) { const m = H.marker(null, im.x, im.z, 2.5, 0xb0c8ff); FX.temp(m, 1.3, t => { m.material.opacity = 0.3 + Math.sin(t * 30) * 0.3; m.scale.setScalar(1.2 - t * 0.4); }); } }, im => {
      FX.bolt(im.x, im.z); AU.play('thunder', { x: im.x, y: 5, z: im.z }, 1.2);
      if (!im.rod) {
        H.hurtNear(im.x, im.z, 2.6, 6, 35, 'struck by lightning', 8);
        if (G.isHost) { for (const i of W.tilesNear(im.x, im.z, 1.7)) { if (W.tiles.c[i] >= 0 || W.tiles.s[i]) Game.igniteTile(i); } H.piecesIn(im.x, 4, im.z, 3, 10); }
      }
    });
  },
});

EV.def('blizzard', { name: 'Blizzard', icon: '❄️', tier: 'major', w: 0.8, minDay: 3, warn: 7, dur: [25, 38], msg: 'Blizzard! You\'ll freeze outside. Crops will too.',
  update(e, dt, at) {
    const k = Math.min(1, at / 4, (e.dur - at) / 4);
    W.tint(0xdde8f2, 0.7 * k); W.fog(2, 38, k); FX.want.snow = k; W.env.speed *= 1 - 0.35 * k;
    FX.wind.x += 8 * k; W.windUniform.value = Math.max(W.windUniform.value, 1.4 * k);
    W.groundMat.emissive.setRGB(0.35 * k, 0.37 * k, 0.4 * k);
    if (H.exposed()) P.hurt(2.2 * dt * k, 'froze to death');
    AU.loop('wind', 0.5 * k);
  },
  end() { W.groundMat.emissive.setRGB(0, 0, 0); },
  host(e, dt) { H.crops(dt, 0.014, 'frozen solid', { gh: true }); },
});

EV.def('heatwave', { name: 'Heatwave', icon: '🔥', tier: 'major', w: 0.8, minDay: 3, warn: 6, dur: [30, 45], msg: 'Extreme heatwave. Crops wither and things catch fire.',
  update(e, dt, at) {
    const k = Math.min(1, at / 4, (e.dur - at) / 4);
    W.tint(0xf0a050, 0.45 * k); W.env.sunSize = U.lerp(W.env.sunSize, 0.08, k); W.env.sunCol.lerp(new THREE.Color(0xffa040), k); W.env.speed *= 1 - 0.15 * k;
    if (H.exposed()) P.hurt(1.5 * dt * k, 'died of heatstroke');
    if (Math.random() < dt * 10 * k) FX.emit(P.pos.x + U.rand(-10, 10), 0.3, P.pos.z + U.rand(-10, 10), 0, 1.5, 0, 1.5, 1, 0xfff0d0, { a: 0.15, grow: 2 });
  },
  host(e, dt) {
    H.crops(dt, 0.01, 'withered in the heat', { gh: true, heat: true });
    e.d.ig = (e.d.ig || 0) + dt; if (e.d.ig > 6) { e.d.ig = 0; if (!(G.has('sprinkler') && Math.random() < 0.5)) { const c = []; for (let i = 0; i < TILES_TOTAL; i++) if (W.tiles.c[i] >= 0 && !W.greenhouse(i)) c.push(i); if (c.length) Game.igniteTile(U.pick(c)); } }
  },
});

EV.def('flood', { name: 'Flash Flood', icon: '🌊', tier: 'major', w: 0.8, minDay: 3, warn: 8, dur: [28, 40], msg: 'FLASH FLOOD! Get to high ground (or swim).',
  update(e, dt, at) {
    const up = U.clamp(at / 8, 0, 1), down = U.clamp((e.dur - at) / 8, 0, 1), k = Math.min(up, down);
    const lg = EV.has('lowgrav') ? 2.5 : 0;
    W.waterLevel = Math.max(W.waterLevel, U.lerp(-1.5, 1.35 + lg, U.smooth(k)));
    const acid = EV.has('acidrain');
    W.floodMat.color.setHex(acid ? 0x6ad040 : 0x4f8fb0);
    FX.want.rain = Math.max(FX.want.rain, 0.6 * k); W.darken(0.25 * k);
    if (P.swim) { P.force.x += 3; P.force.z += 1.5; if (acid && !G.has('hazmat')) P.hurt(10 * dt, 'melted in an acid flood'); }
    AU.loop('water', 0.5 * k);
    if (lg && Math.random() < dt * 6) FX.emit(P.pos.x + U.rand(-15, 15), W.waterLevel, P.pos.z + U.rand(-15, 15), 0, U.rand(1, 3), 0, 4, 1.2, 0x6ab0e0, { grow: 0.5, g: -0.2 });
  },
  host(e, dt, at) {
    if (W.waterLevel > 0.3) {
      H.crops(dt, 0.02, 'washed away by the flood');
      for (let i = 0; i < TILES_TOTAL; i++) if (W.tiles.f[i] > 0) Game.extinguish(i);
      for (const a of AN.list) if ((a.state === 'wander' || a.state === 'idle') && a.y < W.waterLevel - 0.5) { a.vy = 2; a.y += 0.06; }
    }
    if (at > e.dur - 1 && !e.d.fish) { e.d.fish = true; for (let i = 0; i < 6; i++) { const p = H.farmPoint(U.rng(Math.random() * 1e9)); Game.spawnPickup('fish', p.x, p.z); } }
  },
  end() { W.waterLevel = -10; },
});

EV.def('wildfire', { name: 'Wildfire', icon: '🔥', tier: 'major', w: 0.8, minDay: 3, warn: 6, dur: [25, 35], msg: 'WILDFIRE! It spreads through the crops — harvest or let it burn.',
  update(e, dt, at) { const k = Math.min(1, at / 3, (e.dur - at) / 3); W.tint(0xd07040, 0.3 * k); FX.want.ash = 0.4 * k; },
  host(e, dt, at) {
    e.d.t = (e.d.t || 0) - dt;
    if (e.d.t <= 0) { e.d.t = at < 1 ? 0.2 : 4; const c = []; for (let i = 0; i < TILES_TOTAL; i++) if (W.tiles.c[i] >= 0 && W.tiles.f[i] <= 0) c.push(i); for (let n = 0; n < (at < 1 ? 3 : 1) && c.length; n++) Game.igniteTile(c.splice(Math.floor(Math.random() * c.length), 1)[0]); }
  },
});

// something spreads over a building piece by piece (fire, termites); each piece breaks after `life`
// seconds unless someone hits it with water. o: { verb, done, life, spread, hurt, sprinkler, fx(c), wood }
const WATER_EVENTS = ['barnfire', 'termites'];
function spreadDef(o) {
  return {
    init(e) { e.d.fires = []; },
    begin(e) {
      if (!G.isHost) return;
      let cands = [W.barn, W.house, W.buildings.find(b => b.name === 'Chicken coop'), W.buildings.find(b => b.name === 'Windmill')];
      if (!o.wood) cands = cands.concat(W.ghs.filter(b => !b.hidden));
      cands = cands.filter(b => b && b.pieces.some(p => !p.broken && p.solid));
      const b = U.pick(cands); if (!b) return;
      const low = b.pieces.filter(p => !p.broken && p.solid && p.center.y < 3);
      for (let n = 0; n < o.start && low.length; n++) { const p = low.splice(Math.floor(Math.random() * low.length), 1)[0]; e.d.fires.push({ bi: b.id, pi: p.idx, t: 0 }); }
      Game.log(o.verb(b.name.toLowerCase()));
    },
    sync(e) { return e.d.fires.map(f => [f.bi, f.pi]); },
    unsync(e, v) { e.d.fires = v.map(([bi, pi]) => ({ bi, pi })); },
    update(e, dt) {
      let near = 99;
      for (const f of e.d.fires) {
        const c = W.buildings[f.bi].pieces[f.pi].center;
        o.fx(c);
        const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z); near = Math.min(near, d);
        if (o.hurt && d < 1.3 && Math.abs(c.y - P.pos.y - 1) < 2) P.hurt(o.hurt * dt, 'burned in a building fire');
      }
      if (e.d.fires.length) AU.loop(o.loop, U.clamp(1 - near / 30, 0, 0.8));
    },
    host(e, dt) {
      const rate = o.sprinkler && G.has('sprinkler') ? 0.5 : 1;
      for (let i = e.d.fires.length - 1; i >= 0; i--) {
        const f = e.d.fires[i], b = W.buildings[f.bi], p = b.pieces[f.pi];
        f.t += dt * rate;
        if (p.broken) { e.d.fires.splice(i, 1); continue; }
        // spread to a neighbouring piece every few seconds
        f.sp = (f.sp || 0) + dt * rate;
        if (f.sp > o.spread) { f.sp = 0; const nb = b.pieces.filter(q => !q.broken && q !== p && !e.d.fires.some(x => x.bi === f.bi && x.pi === q.idx) && q.center.distanceTo(p.center) < 4.5); if (nb.length && e.d.fires.length < 10) e.d.fires.push({ bi: f.bi, pi: U.pick(nb).idx, t: 0 }); }
        if (f.t > o.life) { Game.breakPiece(f.bi, f.pi, p.center.x, p.center.y - 1, p.center.z, 3); e.d.fires.splice(i, 1); }
      }
    },
    douse(e, bi, pi, from) {
      const i = e.d.fires.findIndex(f => f.bi === bi && f.pi === pi); if (i < 0) return;
      e.d.fires.splice(i, 1);
      if (!e.d.fires.length) Game.log(o.done(Game.pname(from)));
    },
  };
}
EV.def('barnfire', Object.assign({ name: 'Building Fire', icon: '🧯', tier: 'major', w: 0.8, minDay: 3, warn: 5, dur: [40, 55], msg: 'A building is on fire! Put it out with the watering can or the bucket.' }, spreadDef({
  start: 2, life: 16, spread: 6, hurt: 15, sprinkler: true, loop: 'fire',
  verb: n => `🔥 The ${n} is on fire!`, done: who => `🧯 ${who} put out the fire!`,
  fx(c) {
    if (Math.random() < 0.7 * S.d.particles) FX.glow(c.x + U.rand(-1, 1), c.y + U.rand(-0.5, 1), c.z + U.rand(-1, 1), U.rand(-0.3, 0.3), U.rand(1.5, 3), U.rand(-0.3, 0.3), 0.7, 0.8, Math.random() < 0.5 ? 0xff8a20 : 0xffc040, { drag: 1, grow: -0.5 });
    if (Math.random() < 0.15) FX.emit(c.x, c.y + 1.5, c.z, 0, 2, 0, 2.5, 1.2, 0x3a3434, { grow: 2 });
  },
})));
EV.def('termites', Object.assign({ name: 'Termites', icon: '🪵', tier: 'major', w: 0.7, minDay: 3, warn: 5, dur: [45, 60], msg: 'Termites are eating a wooden building! Spray them off with water.' }, spreadDef({
  start: 3, life: 24, spread: 7, wood: true, loop: 'buzz',
  verb: n => `🪵 Termites are eating the ${n}!`, done: who => `💦 ${who} washed off the last termites!`,
  fx(c) { if (Math.random() < 0.5 * S.d.particles) FX.emit(c.x + U.rand(-1.2, 1.2), c.y + U.rand(-1, 1), c.z + U.rand(-1.2, 1.2), U.rand(-0.4, 0.4), U.rand(-0.6, 0.2), U.rand(-0.4, 0.4), 0.8, 0.09, Math.random() < 0.5 ? 0xd8c08a : 0x6b4a2f, { g: 2 }); },
})));

EV.def('meteors', { name: 'Meteor Shower', icon: '☄️', tier: 'major', w: 1, minDay: 3, warn: 8, dur: [20, 32], msg: 'METEOR SHOWER! Watch the sky and dodge the red circles.',
  init(e) {
    const targets = [W.barn, W.house].concat(W.buildings.filter(b => b !== W.barn && b !== W.house && !b.hidden));
    H.schedule(e, [0.7, 1.7], () => {
      let p;
      if (e.rng() < 0.35) { const b = targets[Math.floor(e.rng() * targets.length) % targets.length]; const pc = b.pieces[Math.floor(e.rng() * b.pieces.length) % b.pieces.length]; p = { x: pc.center.x + e.rng.range(-2, 2), z: pc.center.z + e.rng.range(-2, 2) }; }
      else p = e.rng() < 0.5 ? H.fieldPoint(e.rng) : H.farmPoint(e.rng);
      const a = e.rng() * 6.28; return { x: p.x, z: p.z, sx: p.x + Math.cos(a) * 60, sy: 90, sz: p.z + Math.sin(a) * 60, rock: e.rng() < 0.5 };
    });
    e.d.geo = M.meteor();
  },
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2); W.tint(0x8a4a3a, 0.25 * k); W.darken(0.2 * k);
    const sl = EV.has('lowgrav') ? 1.5 : 1;
    H.impacts(e, at, 2.2, im => {
      const mk = H.marker(null, im.x, im.z, 4, 0xff3020); FX.temp(mk, 2.2, t => { mk.material.opacity = 0.4 + Math.sin(t * 20) * 0.3; });
      H.flyer(e, im, e.d.geo, 2.2, 0, p => { FX.glow(p.x, p.y, p.z, U.rand(-1, 1), U.rand(-1, 1), U.rand(-1, 1), 0.5, 2.2, 0xff8a30, { grow: 1 }); FX.emit(p.x, p.y, p.z, 0, 0, 0, 1.5, 1.6, 0x3a3030, { grow: 2 }); }, 1.4);
      AU.play('whoosh', { x: im.x, y: 20, z: im.z }, 1);
    }, im => {
      FX.explode(im.x, W.height(im.x, im.z), im.z, 1.7);
      H.hurtNear(im.x, im.z, 4, 10, 70, 'flattened by a meteor', 14);
      if (G.isHost) { H.cropsIn(im.x, im.z, 3.8, 'crushed by a meteor'); H.piecesIn(im.x, 3, im.z, 6, 16); for (const a of AN.near(im.x, im.z, 7)) AN.fling(a, (a.x - im.x) * 2, 12, (a.z - im.z) * 2); if (im.rock) Game.spawnPickup('meteorite', im.x, im.z); }
    });
  },
});

EV.def('aliens', { name: 'Alien Abduction', icon: '👽', tier: 'major', w: 0.9, minDay: 3, warn: 7, dur: [30, 38], msg: 'UFO spotted! They want your animals. Press E on a rising animal to pull it down — abducted animals never come back.',
  siren: 'ufo',
  // cows first; with no cows left they take whatever is in the pens
  hostParams() { const calm = AN.list.filter(a => a.state === 'wander' || a.state === 'idle'); let cows = calm.filter(a => a.kind === 'cow'); if (!cows.length) cows = calm; const pick = []; while (pick.length < Math.min(3, cows.length)) { const c = U.pick(cows); if (!pick.includes(c.id)) pick.push(c.id); } return { cows: pick }; },
  init(e) { e.d.ufo = e.add(new THREE.Mesh(M.ufo(), M.matGlow)); e.d.ufo.visible = false;
    e.d.beam = e.add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.4, 1, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x9cffd0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))); e.d.beam.visible = false;
    e.d.u = { x: 0, y: 80, z: -60, beam: 0 }; e.d.r = { x: 0, y: 80, z: -60 }; },
  sync(e) { return [+e.d.u.x.toFixed(1), +e.d.u.y.toFixed(1), +e.d.u.z.toFixed(1), e.d.u.beam]; },
  unsync(e, v) { e.d.u.x = v[0]; e.d.u.y = v[1]; e.d.u.z = v[2]; e.d.u.beam = v[3]; },
  update(e, dt, at) {
    const u = e.d.u, r = e.d.r, k = Math.min(1, dt * 6);
    r.x = U.lerp(r.x, u.x, k); r.y = U.lerp(r.y, u.y, k); r.z = U.lerp(r.z, u.z, k);
    e.d.ufo.visible = true; e.d.ufo.position.set(r.x, r.y, r.z); e.d.ufo.rotation.y += dt * 2;
    e.d.beam.visible = !!u.beam; e.d.beam.scale.set(1, r.y, 1); e.d.beam.position.set(r.x, r.y / 2, r.z);
    AU.loop('hum', U.clamp(1 - Math.hypot(r.x - P.pos.x, r.z - P.pos.z) / 70, 0.1, 0.6));
    W.tint(0x40d0a0, 0.1);
    if (u.beam && Math.hypot(r.x - P.pos.x, r.z - P.pos.z) < 2.5 && !P.inBunker) { P.force.y += 40; P.fallCause = 'dropped by aliens'; }
    if (G.has('laser') && Math.random() < dt * 1.5) { const tp = W.props.turret.position; const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(tp.x, 2.6, tp.z), new V3(r.x, r.y, r.z)]), new THREE.LineBasicMaterial({ color: 0xff3030 })); FX.temp(l, 0.12); AU.play('zap', tp, 0.4); }
  },
  host(e, dt, at) {
    const u = e.d.u, cows = e.p.cows || [];
    const slot = Math.floor(at / 10), local = at - slot * 10;
    const cow = AN.byId(cows[slot]);
    if (!cow || slot >= cows.length) { u.beam = 0; u.y = U.lerp(u.y, 90, dt); u.x += dt * 20; return; }
    // an animal someone is carrying can't be beamed up
    if (local < 3) { u.beam = 0; u.x = U.lerp(u.x, cow.x, dt * 2); u.z = U.lerp(u.z, cow.z, dt * 2); u.y = U.lerp(u.y, 16, dt * 2); if (cow.state !== 'gone' && cow.state !== 'abducted' && cow.state !== 'carried') { cow.state = 'idle'; cow.t = 2; } return; }
    if (cow.state === 'gone' || cow.state === 'carried') { u.beam = 0; return; }
    if (local < 8.5) {
      u.beam = 1; u.x = cow.x; u.z = cow.z;
      if (cow.state !== 'abducted' && !e.d['saved' + cow.id]) { cow.state = 'abducted'; e.d['laser' + cow.id] = G.has('laser') && Math.random() < 0.75; AU.play('ufo', cow); }
      if (cow.state === 'abducted') {
        cow.y += dt * 2.6; cow.yaw += dt * 2;
        if (e.d['laser' + cow.id] && local > 6) { cow.state = 'flung'; cow.vy = 0; e.d['saved' + cow.id] = true; Game.log('🔫 The laser shot the UFO — the cow fell back down!'); }
        if (cow.y > 15.5) { cow.state = 'gone'; G.stats.abducted++; Game.log(`🛸 A ${cow.kind} was abducted! It's gone for good — buy a new one in the shop.`); }
      }
    } else u.beam = 0;
  },
});

EV.def('earthquake', { name: 'Earthquake', icon: '🌋', tier: 'major', w: 0.8, minDay: 3, warn: 6, dur: [16, 24], msg: 'EARTHQUAKE! Stay away from walls.',
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 2);
    FX.shake(0.6 * k); W.env.roll = (W.env.roll || 0) + Math.sin(at * 9) * 0.03 * k;
    if (P.onGround && Math.random() < dt * 1.5 * k) P.launch(U.rand(-3, 3), U.rand(2, 5), U.rand(-3, 3));
    if (Math.random() < dt * 25 * k) FX.emit(P.pos.x + U.rand(-15, 15), 0.2, P.pos.z + U.rand(-15, 15), 0, 1, 0, 1.5, 1.2, 0x9a8a68, { grow: 2 });
    if (Math.random() < dt * 0.6 * k) FX.decal(P.pos.x + U.rand(-12, 12), P.pos.z + U.rand(-12, 12), U.rand(0.5, 1.4), 25);
    AU.loop('rumble', 0.9 * k);
  },
  host(e, dt) { H.crops(dt, 0.012, 'swallowed by the earthquake', { quake: true }); H.pieces(dt, G.has('seismic') ? 0.003 : 0.006, 5); for (const a of AN.list) if ((a.state === 'wander' || a.state === 'idle') && Math.random() < dt * 0.3) { a.vy = 3; a.y += 0.05; } },
});

EV.def('sinkhole', { name: 'Sinkholes', icon: '🕳️', tier: 'major', w: 0.7, minDay: 3, warn: 6, dur: [14, 20], msg: 'The ground is cracking... sinkholes are opening!',
  init(e) {
    e.d.h = []; const n = e.rng.int(2, 4);
    for (let i = 0; i < n; i++) { const p = i === 0 ? H.fieldPoint(e.rng) : H.farmPoint(e.rng); e.d.h.push({ x: p.x, z: p.z, r: e.rng.range(2.5, 4) * (G.has('seismic') ? 0.7 : 1) }); }
    e.d.marks = e.d.h.map(h => H.marker(e, h.x, h.z, h.r, 0x5a3a20));
    e.d.pits = e.d.h.map(h => { const b = new MB(); b.cyl(h.r, h.r * 0.6, 6, 14, 0x0a0806, 0, -3, 0); b.cyl(h.r + 0.4, h.r + 0.4, 0.15, 14, 0x3a2a18, 0, 0.05, 0); const m = e.add(b.mesh()); m.position.set(h.x, W.height(h.x, h.z), h.z); m.visible = false; return m; });
  },
  warnUpdate(e, dt) { FX.shake(0.15); for (const h of e.d.h) if (Math.random() < dt * 8) FX.emit(h.x + U.rand(-h.r, h.r), 0.2, h.z + U.rand(-h.r, h.r), 0, 1, 0, 1, 0.8, 0x8a7a58, { grow: 1 }); },
  begin(e) {
    e.d.pits.forEach(m => m.visible = true); e.d.marks.forEach(m => m.visible = false);
    for (const h of e.d.h) { W.holes.push(h); FX.explode(h.x, 0, h.z, 0.6, { noDecal: true }); }
    if (G.isHost) for (const h of e.d.h) { for (const i of W.tilesNear(h.x, h.z, h.r)) Game.resetTile(i, 'swallowed by a sinkhole'); H.piecesIn(h.x, 1, h.z, h.r, 3); for (const a of AN.near(h.x, h.z, h.r + 1)) AN.fling(a, (a.x - h.x) * 3, 10, (a.z - h.z) * 3); }
  },
  update(e) { for (const h of e.d.h) if (H.d(h.x, h.z) < h.r) P.fallCause = 'fell into a sinkhole'; },
  end(e) { for (const h of e.d.h) { const i = W.holes.indexOf(h); if (i >= 0) W.holes.splice(i, 1); } },
});

EV.def('volcano', { name: 'Volcano', icon: '🌋', tier: 'major', w: 0.6, minDay: 3, warn: 10, dur: [24, 32], msg: 'A VOLCANO just grew next to the farm! Lava bombs incoming!',
  init(e) {
    const vx = e.rng.range(-40, 40), vz = -125; e.d.v = { x: vx, z: vz };
    const b = new MB(); b.cone(38, 42, 12, 0x4a3a32, 0, 21, 0, 0, 0, 0, 1, 1, 1, 3); b.cyl(7, 9, 2, 10, 0xff5a10, 0, 41.5, 0);
    e.d.cone = e.add(b.mesh()); e.d.cone.position.set(vx, -45, vz);
    H.schedule(e, [0.9, 1.8], () => { const p = e.rng() < 0.5 ? H.fieldPoint(e.rng) : H.farmPoint(e.rng); return { x: p.x, z: p.z, sx: vx, sy: 42, sz: vz }; });
    e.d.geo = M.lavaBomb();
  },
  warnUpdate(e, dt, lt, left) { const k = 1 - left / e.warn; e.d.cone.position.y = W.height(e.d.v.x, e.d.v.z) - 44 * (1 - U.smooth(k)); FX.shake(0.25 * k); AU.loop('rumble', k); W.tint(0x8a3020, 0.2 * k); },
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 3), v = e.d.v;
    e.d.cone.position.y = W.height(v.x, v.z) - 44 * (1 - k);
    W.tint(0xa03a20, 0.4 * k); W.darken(0.3 * k); FX.want.ash = 0.6 * k;
    for (let i = 0; i < 6; i++) FX.emit(v.x + U.rand(-5, 5), 40, v.z + U.rand(-5, 5), U.rand(-2, 2), U.rand(8, 14), U.rand(-2, 2), 6, 8, i % 3 ? 0x3a3434 : 0x5a5050, { grow: 2, drag: 0.3 });
    if (Math.random() < 0.5) FX.glow(v.x, 42, v.z, U.rand(-6, 6), U.rand(10, 20), U.rand(-6, 6), 1.5, 2, 0xff6a10, { g: 10 });
    AU.loop('rumble', 0.6 * k);
    H.impacts(e, at, 3, im => { const mk = H.marker(null, im.x, im.z, 3, 0xff6020); FX.temp(mk, 3, t => { mk.material.opacity = 0.3 + Math.sin(t * 15) * 0.3; }); H.flyer(e, im, e.d.geo, 3, 35, p => FX.glow(p.x, p.y, p.z, 0, 0, 0, 0.5, 1.2, 0xff6a10, { grow: 1 })); }, im => {
      FX.explode(im.x, W.height(im.x, im.z), im.z, 1.2);
      H.hurtNear(im.x, im.z, 2.5, 6, 50, 'hit by a lava bomb', 10);
      if (G.isHost) { for (const i of W.tilesNear(im.x, im.z, 2.2)) Game.igniteTile(i); H.piecesIn(im.x, 3, im.z, 4, 12); }
    });
  },
});

EV.def('minibh', { name: 'Mini Black Hole', icon: '⚫', tier: 'major', w: 0.6, minDay: 3, warn: 6, dur: [14, 18], msg: 'A small black hole has formed on the farm. Don\'t get close!',
  init(e) {
    const p = e.rng() < 0.5 ? H.fieldPoint(e.rng) : H.farmPoint(e.rng); e.d.p = { x: p.x, y: 4, z: p.z };
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    const disk = diskMesh(1.4, 5);
    disk.rotation.x = -Math.PI / 2 + 0.3; g.add(disk); e.d.disk = disk;
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    g.add(halo); e.d.halo = halo;
    g.position.set(p.x, 4, p.z); g.scale.setScalar(0.01); e.d.g = e.add(g);
  },
  warnUpdate(e, dt, lt, left) { const k = 1 - left / e.warn; e.d.g.scale.setScalar(0.05 + k * 0.2); if (Math.random() < 0.5) FX.glow(e.d.p.x, 4, e.d.p.z, U.rand(-1, 1), U.rand(-1, 1), U.rand(-1, 1), 0.4, 0.3, 0xffffff); },
  update(e, dt, at) {
    const k = Math.min(1, at / 2, (e.dur - at) / 1.5), p = e.d.p;
    e.d.g.scale.setScalar(Math.max(0.05, k)); e.d.disk.rotation.z += dt * 4; e.d.halo.lookAt(W.camera.position);
    FX.attractors.push({ x: p.x, y: p.y, z: p.z, s: 30 * k, kill: 2 });
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, r = U.rand(5, 14); FX.glow(p.x + Math.cos(a) * r, p.y + U.rand(-3, 3), p.z + Math.sin(a) * r, 0, 0, 0, 1.2, 0.3, 0xffb070); }
    const dx = p.x - P.pos.x, dy = p.y - P.pos.y - 1, dz = p.z - P.pos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 26 && !P.inBunker) { const f = Math.min(60, 2200 / (d * d + 30)) * k; P.force.x += dx / d * f; P.force.y += dy / d * f + 10 * k; P.force.z += dz / d * f; }
    if (d < 2.2 * k) P.hurt(999, 'spaghettified by a black hole');
    W.darken(0.2 * k); AU.loop('rumble', U.clamp(1 - d / 40, 0, 1) * k);
  },
  host(e, dt, at) {
    const p = e.d.p, k = Math.min(1, at / 2);
    H.crops(dt, 0.3 * k, 'sucked into a black hole', { x: p.x, z: p.z, r: 8 });
    H.pieces(dt, 0.12 * k, -10, 1, { x: p.x, y: p.y, z: p.z, r: 13, ox: p.x, oy: p.y, oz: p.z });
    for (const a of AN.near(p.x, p.z, 12)) {
      const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
      if (d < 2) { const z = ZONES[a.zone]; a.x = U.rand(z.x0, z.x1); a.z = U.rand(z.z0, z.z1); AN.fling(a, 0, 15, 0); }
      else if (a.state !== 'flung') AN.fling(a, dx / d * 8, 6, dz / d * 8);
    }
  },
  end(e) { const p = e.d.p; FX.explode(p.x, p.y, p.z, 1, { noDecal: true }); },
});

EV.def('stampede', { name: 'Stampede', icon: '🐄', tier: 'major', w: 0.7, minDay: 3, warn: 5, dur: [12, 16], msg: 'STAMPEDE! The animals are running through the fields!',
  begin(e) {
    if (!G.isHost) return;
    const a = Math.PI * 0.75 + U.rand(-0.3, 0.3);
    for (const an of AN.list) if (an.kind !== 'chicken' && (an.state === 'wander' || an.state === 'idle' || an.state === 'return')) { an.state = 'stampede'; an.t = e.dur; an.sx = Math.cos(a) * 9 + U.rand(-1, 1); an.sz = Math.sin(a) * 9 + U.rand(-1, 1); an.yaw = Math.atan2(an.sx, an.sz); }
  },
  update(e, dt, at) {
    for (const a of AN.list) if (a.state === 'stampede') { if (Math.random() < dt * 4) FX.emit(a.x, 0.3, a.z, U.rand(-1, 1), 1, U.rand(-1, 1), 1.2, 1.2, 0xa89068, { grow: 2 }); if (Math.random() < dt * 0.3) AU.play(KINDS[a.kind].sound, a, 1); }
    AU.loop('rumble', 0.5);
  },
});

EV.def('pumpkin', { name: 'Giant Pumpkin', icon: '🎃', tier: 'major', w: 0.6, minDay: 3, warn: 6, dur: [14, 16], msg: 'A GIANT PUMPKIN is rolling toward the farm!',
  init(e) {
    const t = H.fieldPoint(e.rng), a = e.rng() * 6.28; e.d.t = t; e.d.s = { x: t.x + Math.cos(a) * 110, z: t.z + Math.sin(a) * 110 };
    e.d.dir = { x: -Math.cos(a), z: -Math.sin(a) };
    const m = new THREE.Mesh(M.giantPumpkin(), M.mat); m.castShadow = true; e.d.m = e.add(m); m.visible = false;
    e.d.roll = new THREE.Group(); e.d.roll.add(m); e.add(e.d.roll);
  },
  update(e, dt, at) {
    const travel = e.dur - 2, k = U.clamp(at / travel, 0, 1), s = e.d.s, t = e.d.t;
    const x = U.lerp(s.x, t.x, k), z = U.lerp(s.z, t.z, k); e.d.p = { x, z };
    e.d.m.visible = k < 1; e.d.roll.position.set(x, W.height(x, z) + 3.6, z);
    e.d.roll.rotation.y = Math.atan2(e.d.dir.x, e.d.dir.z); e.d.m.rotation.x = at * 110 / travel / 3.6;
    if (k < 1) {
      FX.shake(U.clamp(1 - H.d(x, z) / 40, 0, 0.5)); AU.loop('rumble', U.clamp(1 - H.d(x, z) / 60, 0, 1));
      if (H.d(x, z) < 4.4 && P.pos.y < W.height(x, z) + 7) P.hurt(999, 'squashed by a giant pumpkin');
      if (Math.random() < 0.5) FX.emit(x, 0.3, z, U.rand(-2, 2), 1, U.rand(-2, 2), 1.5, 2, 0x8a7050, { grow: 2 });
    } else if (!e.d.burst) {
      e.d.burst = true; FX.explode(t.x, 1, t.z, 1.2, { noDecal: true });
      for (let i = 0; i < 20; i++) FX.chunk(t.x, 2, t.z, 0xf07a1a, new V3(U.rand(-10, 10), U.rand(5, 14), U.rand(-10, 10)), 0.6);
      if (G.isHost) for (let i = 0; i < 8; i++) Game.spawnPickup('pumpkinbit', t.x + U.rand(-4, 4), t.z + U.rand(-4, 4));
    }
  },
  host(e, dt) { const p = e.d.p; if (!p || e.d.burst) return; e.d.ht = (e.d.ht || 0) + dt; if (e.d.ht < 0.15) return; e.d.ht = 0; H.cropsIn(p.x, p.z, 3.8, 'flattened by a giant pumpkin'); H.piecesIn(p.x, 2, p.z, 4.6, 14); for (const a of AN.near(p.x, p.z, 5)) AN.fling(a, e.d.dir.x * 14, 10, e.d.dir.z * 14); },
});

// ======================================================================
// NUKE
// ======================================================================
EV.def('nuke', { name: 'NUCLEAR STRIKE', icon: '☢️', tier: 'major', w: 0.3, minDay: 4, warn: 20, dur: [40, 45], msg: 'NUCLEAR STRIKE INBOUND. Get in the bunker or RUN FAR AWAY!', siren: 'nukeSiren',
  init(e) {
    const p = H.farmPoint(e.rng); e.d.p = p;
    e.d.ring = H.marker(e, p.x, p.z, 30, 0xff2020);
    e.d.bomb = e.add(new THREE.Mesh(M.bomb(), M.mat)); e.d.bomb.visible = false;
    const g = new THREE.Group();
    e.d.fire = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 1, fog: false })); g.add(e.d.fire);
    e.d.stem = new THREE.Mesh(new THREE.CylinderGeometry(3, 6, 1, 12, 1), new THREE.MeshLambertMaterial({ color: 0x8a7a6a, emissive: 0x5a2a10 })); g.add(e.d.stem);
    e.d.cap = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshLambertMaterial({ color: 0x9a8a7a, emissive: 0x7a3a10 })); g.add(e.d.cap);
    e.d.capRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.45, 8, 20), new THREE.MeshLambertMaterial({ color: 0x8a7a6a, emissive: 0x6a2a10 })); e.d.capRing.rotation.x = Math.PI / 2; g.add(e.d.capRing);
    e.d.wave = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe0c0, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })); e.d.wave.rotation.x = -Math.PI / 2; g.add(e.d.wave);
    g.position.set(p.x, W.height(p.x, p.z), p.z); g.visible = false; e.d.g = e.add(g);
  },
  warnUpdate(e, dt, lt, left) {
    e.d.ring.material.opacity = 0.4 + Math.sin(lt * 8) * 0.3;
    W.tint(0xa04040, 0.2 * (1 - left / e.warn));
    if (left < 3) { e.d.bomb.visible = true; e.d.bomb.position.set(e.d.p.x, 3 + left * 50, e.d.p.z); e.d.bomb.rotation.z = Math.PI; if (!e.d.wh) { e.d.wh = true; AU.play('whoosh', null, 1); } }
  },
  begin(e) {
    e.d.bomb.visible = false; e.d.ring.visible = false; e.d.g.visible = true;
    FX.flash(1, '#ffffff'); FX.shake(2); AU.play('bigboom', null, 1.6);
    FX.explode(e.d.p.x, 0, e.d.p.z, 6);
    FX.decal(e.d.p.x, e.d.p.z, 26, 200);
    e.d.hitP = false;
    if (G.isHost) {
      const p = e.d.p;
      for (let i = 0; i < TILES_TOTAL; i++) { if (W.tiles.c[i] < 0) continue; const q = W.tilePos(i), d = Math.hypot(q.x - p.x, q.z - p.z); if (d < 28) Game.destroyTile(i, 'vaporized by the nuke'); else if (Math.random() < 0.5) Game.mutateTile(i, 2); }
      W.buildings.forEach((b, bi) => b.pieces.forEach((pc, pi) => { const d = Math.hypot(pc.center.x - p.x, pc.center.z - p.z); if (d < 48 && !pc.broken) setTimeout(() => Game.breakPiece(bi, pi, p.x, 0, p.z, 30 - d * 0.3), d / 60 * 1000); }));
      for (const a of AN.list) { const d = Math.hypot(a.x - p.x, a.z - p.z); if (d < 70) setTimeout(() => AN.fling(a, (a.x - p.x) / d * 20, 18, (a.z - p.z) / d * 20), d / 60 * 1000); }
    }
  },
  update(e, dt, at) {
    const p = e.d.p, k = Math.min(1, at / 2);
    const fr = Math.min(1, at / 1.5) * 22; e.d.fire.scale.setScalar(fr); e.d.fire.material.opacity = U.clamp(1 - at / 6, 0, 1); e.d.fire.position.y = Math.min(at * 6, 25);
    const h = Math.min(70, at * 12); e.d.stem.scale.set(1 + at * 0.05, h, 1 + at * 0.05); e.d.stem.position.y = h / 2;
    const cs = Math.min(22, 6 + at * 3); e.d.cap.scale.set(cs, cs * 0.55, cs); e.d.cap.position.y = h + cs * 0.2; e.d.capRing.scale.setScalar(cs * 0.9); e.d.capRing.position.y = h;
    const fade = U.clamp((e.dur - at) / 8, 0, 1); [e.d.stem, e.d.cap, e.d.capRing].forEach(m => { m.material.transparent = true; m.material.opacity = fade; });
    const wr = at * 60; e.d.wave.scale.setScalar(wr); e.d.wave.material.opacity = U.clamp(0.6 - at / 4, 0, 0.6);
    if (Math.random() < 0.6) FX.emit(p.x + U.rand(-8, 8), h + U.rand(-5, 5), p.z + U.rand(-8, 8), U.rand(-3, 3), U.rand(0, 3), U.rand(-3, 3), 5, 10, 0x6a5a50, { grow: 1.5 });
    // radiation afterwards
    W.tint(0x9adf40, 0.3 * fade * k); W.darken(0.25 * fade);
    FX.want.ash = 0.5 * fade;
    if (H.exposed() && !G.has('hazmat') && at > 4) P.hurt(1.5 * dt, 'died of radiation poisoning');
    AU.loop('rumble', 0.8 * fade);
    // the shockwave reaching the player
    const d = H.d(p.x, p.z);
    if (!e.d.hitP && wr >= d) {
      e.d.hitP = true;
      if (!P.inBunker) {
        if (d < 70) P.hurt(999, 'vaporized by a nuke');
        else if (d < 140) { const kk = 1 - (d - 70) / 70; P.hurt(60 * kk, 'blown away by a nuke'); P.launch((P.pos.x - p.x) / d * 25 * kk, 12 * kk, (P.pos.z - p.z) / d * 25 * kk); }
      }
      FX.shake(1.5);
    }
  },
});

// ======================================================================
// APOCALYPSE — destroys everything
// ======================================================================
EV.def('blackhole', { name: 'THE BLACK HOLE', icon: '🕳️', tier: 'apoc', w: 0, minDay: 5, warn: 40, dur: [24, 26], siren: 'nukeSiren',
  msg: 'A SUPERMASSIVE BLACK HOLE IS APPROACHING EARTH. THIS IS THE END OF THE FARM.',
  init(e) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })));
    const disk = diskMesh(1.3, 4.5);
    disk.rotation.x = -Math.PI / 2 + 0.25; g.add(disk); e.d.disk = disk;
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.35, 48), new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    g.add(halo); e.d.halo = halo;
    e.d.g = e.add(g); g.position.set(0, 300, -400); g.scale.setScalar(5);
  },
  warnUpdate(e, dt, lt, left) {
    const k = 1 - left / e.warn;
    e.d.g.position.set(0, U.lerp(300, 120, k), U.lerp(-400, -120, k)); e.d.g.scale.setScalar(U.lerp(5, 14, k));
    e.d.disk.rotation.z += dt * 2; e.d.halo.lookAt(W.camera.position);
    W.darken(0.7 * k); W.env.stars = Math.max(W.env.stars, k); W.tint(0x1a0a2a, 0.5 * k);
    W.env.gravity *= U.lerp(1, 0.6, k); FX.shake(0.2 * k); AU.loop('rumble', k);
    if (Math.random() < dt * 30 * k) FX.emit(P.pos.x + U.rand(-20, 20), 0, P.pos.z + U.rand(-20, 20), 0, 4, 0, 4, 0.4, 0x8a7a68);
  },
  update(e, dt, at) {
    const k = U.clamp(at / (e.dur - 3), 0, 1), g = e.d.g;
    const hy = U.lerp(120, 34, k), hz = U.lerp(-120, -5, k), hs = U.lerp(14, 22, k);
    g.position.set(0, hy, hz); g.scale.setScalar(hs); e.d.disk.rotation.z += dt * 4; e.d.halo.lookAt(W.camera.position);
    W.darken(0.8); W.env.stars = 1; W.tint(0x1a0a2a, 0.6); FX.shake(0.5 + k); W.env.roll = (W.env.roll || 0) + Math.sin(at * 3) * 0.05;
    FX.attractors.push({ x: 0, y: hy, z: hz, s: 80 + k * 200, kill: hs });
    AU.loop('rumble', 1); AU.loop('wind', 1);
    for (let i = 0; i < 15; i++) { const a = Math.random() * 6.28, r = U.rand(20, 80); FX.emit(Math.cos(a) * r, U.rand(0, 20), hz + Math.sin(a) * r, 0, 5, 0, 3, 0.8, 0x8a7a68); }
    const dx = -P.pos.x, dy = hy - P.pos.y, dz = hz - P.pos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!P.dead) { const f = 20 + k * 60; P.force.x += dx / d * f; P.force.y += dy / d * f + 15; P.force.z += dz / d * f; P.fallCause = 'consumed by a black hole'; }
    if (d < hs * 1.2 || at > e.dur - 2.5) P.hurt(999, 'consumed by a black hole', { apoc: true, force: true });
  },
  host(e, dt, at) {
    const k = U.clamp(at / (e.dur - 4), 0, 1), kk = U.clamp(at / (e.dur - 3), 0, 1), hy = U.lerp(120, 34, kk), hz = U.lerp(-120, -5, kk);
    const all = []; W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => { if (!p.broken && !b.hidden) all.push([bi, pi, p]); }));
    all.sort((a, b) => b[2].center.y - a[2].center.y);
    const total = W.buildings.reduce((s, b) => s + (b.hidden ? 0 : b.pieces.length), 0), target = Math.floor(total * k);
    for (let n = total - all.length; n < target && all.length; n++) { const [bi, pi] = all.shift(); Game.breakPiece(bi, pi, 0, hy, hz, -18); }
    for (let i = 0; i < TILES_TOTAL; i++) if ((W.tiles.c[i] >= 0 || W.tiles.s[i]) && Math.random() < dt * k * 0.5) Game.resetTile(i, 'consumed by a black hole');
    for (const a of AN.list) if (a.state !== 'gone' && Math.random() < dt * k) { a.state = 'gone'; }
  },
  end(e) {
    FX.flash(1, '#ffffff'); AU.play('bigboom');
    if (G.isHost) {
      for (let i = 0; i < TILES_TOTAL; i++) Game.resetTile(i, 'consumed by a black hole');
      W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => { if (!p.broken) Game.breakPiece(bi, pi, 0, -50, 0, -18); }));
      // the white hole spits the animals back out, unharmed
      for (const a of AN.list) { const z = ZONES[a.zone]; a.state = 'flung'; a.by = ''; a.x = U.rand(z.x0, z.x1); a.z = U.rand(z.z0, z.z1); a.y = 30; a.vx = a.vz = 0; a.vy = 0; a.rx = a.x; a.rz = a.z; }
      Game.log('⚪ A white hole spat your animals back out. They seem fine.');
    }
  },
});

EV.def('supernova', { name: 'SUPERNOVA', icon: '☀️', tier: 'apoc', w: 0, minDay: 5, warn: 45, dur: [16, 18], siren: 'nukeSiren',
  msg: 'THE SUN IS GOING SUPERNOVA. NOTHING WILL SURVIVE. SAY GOODBYE TO THE FARM.',
  init(e) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(700, 260), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    e.d.wall = e.add(wall); wall.visible = false;
  },
  warnUpdate(e, dt, lt, left) {
    const k = 1 - left / e.warn;
    W.env.sunSize = U.lerp(0.045, 0.45, k * k); W.env.sunCol.lerp(new THREE.Color(k < 0.8 ? 0xff5020 : 0xffffff), Math.min(1, k * 1.3)); W.env.sunGlow = 1 + k * 4;
    W.tint(0xff6020, 0.55 * k); W.env.sun *= 1 + k; FX.shake(0.15 * k);
    if (k > 0.5 && H.exposed()) P.hurt(1.5 * dt * k, 'cooked by the dying sun');
    AU.loop('rumble', k);
    if (G.isHost && Math.random() < dt * k * 2) { const i = Math.floor(Math.random() * TILES_TOTAL); if (W.tiles.c[i] >= 0) Game.igniteTile(i); }
  },
  begin(e) {
    FX.flash(1, '#ffffff'); AU.play('bigboom', null, 1.6); FX.shake(2);
    const sd = W.skyU.sunDir.value; e.d.dir = { x: -sd.x, z: -sd.z }; const l = Math.hypot(e.d.dir.x, e.d.dir.z) || 1; e.d.dir.x /= l; e.d.dir.z /= l;
  },
  front(e, at) { return -160 + at * 32; },
  update(e, dt, at) {
    const dir = e.d.dir, f = this.front(e, at);
    W.env.sunSize = 0.5; W.env.sunCol.setHex(0xffffff); W.env.sunGlow = 6; W.tint(0xffc080, 0.7); W.env.sun *= 2.5;
    const w = e.d.wall; w.visible = f < 200;
    w.position.set(dir.x * f, 100, -5 + dir.z * f); w.lookAt(w.position.x + dir.x, 100, w.position.z + dir.z);
    for (let i = 0; i < 30; i++) { const s = U.rand(-150, 150); FX.glow(dir.x * f - dir.z * s, U.rand(0, 40), -5 + dir.z * f + dir.x * s, dir.x * 30, U.rand(0, 8), dir.z * 30, 1, 6, U.pick([0xffa040, 0xff6020, 0xffe080]), { grow: 1 }); }
    AU.loop('rumble', 1); AU.loop('fire', 1);
    const pd = P.pos.x * dir.x + (P.pos.z + 5) * dir.z;
    if (pd < f && !P.dead) P.hurt(999, 'erased by a supernova', { apoc: true, force: true });
    if (pd < f + 40) FX.shake(1);
  },
  host(e, dt, at) {
    const dir = e.d.dir, f = this.front(e, at);
    W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => { if (!p.broken && p.center.x * dir.x + (p.center.z + 5) * dir.z < f) Game.breakPiece(bi, pi, p.center.x - dir.x * 5, 0, p.center.z - dir.z * 5, 25); }));
    for (let i = 0; i < TILES_TOTAL; i++) { if (W.tiles.c[i] < 0 && !W.tiles.s[i]) continue; const q = W.tilePos(i); if (q.x * dir.x + (q.z + 5) * dir.z < f) Game.resetTile(i, 'burned by the supernova'); }
    for (const a of AN.list) if (a.state !== 'flung' && a.x * dir.x + (a.z + 5) * dir.z < f && a.x * dir.x + (a.z + 5) * dir.z > f - 6) AN.fling(a, dir.x * 25, 15, dir.z * 25);
  },
  end(e) {
    if (G.isHost) {
      for (let i = 0; i < TILES_TOTAL; i++) Game.resetTile(i, 'burned by the supernova');
      W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => { if (!p.broken) Game.breakPiece(bi, pi, p.center.x, 0, p.center.z, 20); }));
      for (let i = 0; i < 25; i++) { const p = H.farmPoint(U.rng(Math.random() * 1e9)); Game.spawnPickup('stardust', p.x, p.z); }
      Game.log('✨ The sun is... back? Stardust is falling everywhere. It sells for a lot.');
    }
  },
});

// ======================================================================
// MORE EVENTS
// ======================================================================
// helpers for something the host moves around and syncs (bees, ghost, giant chicken, robot)
const _mover = (e, x, z) => { e.d.u = { x, z, done: 0, n: 0, i: 0 }; e.d.r = { x, z }; };
const _moverSync = {
  sync(e) { return [+e.d.u.x.toFixed(1), +e.d.u.z.toFixed(1), e.d.u.done ? 1 : 0, e.d.u.n || 0]; },
  unsync(e, v) { e.d.u.x = v[0]; e.d.u.z = v[1]; e.d.u.done = v[2]; e.d.u.n = v[3]; },
};
const _lerpMover = (e, dt) => { const k = Math.min(1, dt * (G.isHost ? 30 : 8)); e.d.r.x = U.lerp(e.d.r.x, e.d.u.x, k); e.d.r.z = U.lerp(e.d.r.z, e.d.u.z, k); return e.d.r; };
const _step = (u, tx, tz, spd, dt) => { const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz); if (d > 0.05) { const s = Math.min(d, spd * dt); u.x += dx / d * s; u.z += dz / d * s; } return d; };
const _nearest = (x, z) => { let best = null, bd = 1e9; for (const p of Game.alivePlayers()) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } return best; };
const _walk = (m, dt, speed) => { m.userData.ph = (m.userData.ph || 0) + dt * speed; const sw = Math.sin(m.userData.ph) * 0.6; m.userData.legs[0].rotation.x = sw; m.userData.legs[1].rotation.x = -sw; if (m.userData.arms) { m.userData.arms[0].rotation.x = -sw; m.userData.arms[1].rotation.x = sw; } };

EV.def('bees', Object.assign({ name: 'Angry Bees', icon: '🐝', tier: 'minor', w: 0.8, minDay: 2, warn: 5, dur: [25, 35], msg: 'A bee swarm is chasing people! Outrun it, or dive into the pond.',
  init(e) { const a = e.rng() * 6.28; _mover(e, Math.cos(a) * 50, -5 + Math.sin(a) * 50); },
  host(e, dt) { const u = e.d.u, p = _nearest(u.x, u.z); if (p) _step(u, p.x, p.z, 4.6, dt); },
  update(e, dt) {
    const r = _lerpMover(e, dt);
    for (let i = 0; i < 20 * S.d.particles; i++) { const a = Math.random() * 6.28, d = Math.random() * 1.8; FX.emit(r.x + Math.cos(a) * d, 1.2 + Math.random() * 1.4, r.z + Math.sin(a) * d, U.rand(-3, 3), U.rand(-1, 1), U.rand(-3, 3), 0.25, 0.1, i % 3 ? 0xf2c230 : 0x1a1a1a); }
    const d = H.d(r.x, r.z); AU.loop('buzz', U.clamp(1 - d / 20, 0, 0.6));
    if (d < 2.2 && !P.swim && !P.inBunker && P.pos.y < 4) P.hurt(7 * dt, 'stung by angry bees');
  },
}, _moverSync));

EV.def('mushrooms', { name: 'Mushroom Season', icon: '🍄', tier: 'minor', w: 0.6, minDay: 2, warn: 3, dur: [35, 50], msg: 'Wild mushrooms are popping up everywhere. Pick them, they sell well!',
  host(e, dt, at) { e.d.t = (e.d.t || 0) - dt; if (e.d.t <= 0 && at < e.dur * 0.7 && Game.countPickups('mushroom') < 24) { e.d.t = 0.8; const p = Math.random() < 0.6 ? H.fieldPoint(Math.random) : H.farmPoint({ range: U.rand }); Game.spawnPickup('mushroom', p.x, p.z); } },
  update(e, dt, at) { W.tint(0x8a7aa0, 0.08 * Math.min(1, at / 3, (e.dur - at) / 3)); },
});

EV.def('rainbow', { name: 'Rainbow', icon: '🌈', tier: 'minor', w: 0.5, minDay: 2, warn: 3, dur: [20, 26], msg: 'A rainbow! Crops under its end turn into Rainbow crops (worth 6×).',
  init(e) {
    const p = H.fieldPoint(e.rng), g = new THREE.Group(); e.d.p = p;
    [0xff3b3b, 0xff9a2a, 0xffe14a, 0x4fd04a, 0x3f8fff, 0x8a4aff].forEach((c, i) => g.add(new THREE.Mesh(new THREE.TorusGeometry(30 - i * 0.9, 0.45, 4, 48, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, fog: false }))));
    g.position.set(p.x - 30, -1, p.z); e.d.g = e.add(g);
  },
  update(e, dt, at) {
    const k = Math.min(1, at / 3, (e.dur - at) / 3); e.d.g.children.forEach(m => m.material.opacity = 0.45 * k);
    if (Math.random() < 0.6) FX.glow(e.d.p.x + U.rand(-3, 3), U.rand(0.3, 3), e.d.p.z + U.rand(-3, 3), 0, 0.3, 0, 1, 0.25, U.pick([0xff9a2a, 0xffe14a, 0x4fd04a, 0x3f8fff, 0x8a4aff]));
  },
  host(e, dt, at) { if (at > 6 && !e.d.done) { e.d.done = true; for (const i of W.tilesNear(e.d.p.x, e.d.p.z, 4.5)) if (W.tiles.c[i] >= 0 && Math.random() < 0.5) Game.mutateTile(i, 5); } },
});

EV.def('pigrace', { name: 'Pig Race', icon: '🏁', tier: 'minor', w: 0.6, minDay: 2, warn: 4, dur: [35, 45], msg: 'The pigs are racing around the farmyard! Catch one (F) for $150.',
  begin() { if (G.isHost) for (const a of AN.list) if (a.kind === 'pig' && CALM(a.state)) { a.state = 'race'; a.ra = undefined; } },
  end() { if (G.isHost) for (const a of AN.list) if (a.state === 'race') a.state = 'return'; },
  update(e, dt) { for (const a of AN.list) if (a.state === 'race' && Math.random() < dt * 4) FX.emit(a.x, 0.2, a.z, U.rand(-1, 1), 1, U.rand(-1, 1), 0.8, 0.5, 0xa89068, { grow: 1 }); },
});

EV.def('thundersheep', { name: 'Thunder Sheep', icon: '⚡', tier: 'minor', w: 0.6, minDay: 2, warn: 4, dur: [30, 40], msg: 'The sheep are full of static! Shearing gives double wool... and a shock. Don\'t bump into them.',
  update(e, dt) {
    for (const a of AN.list) {
      if (a.kind !== 'sheep' || a.state === 'gone') continue;
      if (Math.random() < dt * 6) FX.glow(a.x + U.rand(-0.5, 0.5), a.y + 1 + U.rand(0, 0.5), a.z + U.rand(-0.5, 0.5), 0, U.rand(0, 1), 0, 0.3, 0.25, 0xbfe0ff);
      if (Math.hypot(a.x - P.pos.x, a.z - P.pos.z) < 1.1 && (!e.d.zt || e.d.zt < W.timeUniform.value)) { e.d.zt = W.timeUniform.value + 1.2; P.hurt(8, 'shocked by a thunder sheep'); AU.play('zap', a, 0.6); }
    }
  },
});

EV.def('taxman', { name: 'Tax Inspector', icon: '🧾', tier: 'minor', w: 0.6, minDay: 3, warn: 6, dur: [40, 50], msg: 'A tax inspector is touring the farm. Every broken building piece costs a $40 fine when he leaves. Repair fast!',
  init(e) {
    e.d.m = e.add(M.farmer(0x2a2a3a)); const tag = M.nameTag('Tax inspector', 0xffffff); tag.position.y = 2.5; e.d.m.add(tag); e.d.m.visible = false;
    e.d.pts = [[-45, -12], [-20, -16], [16, -14], [38, -22], [6, -30], [-20, -31], [-45, -12]];
  },
  update(e, dt, at) {
    const pts = e.d.pts, f = U.clamp(at / e.dur, 0, 0.999) * (pts.length - 1), i = Math.floor(f), t = f - i, a = pts[i], b = pts[i + 1];
    const x = U.lerp(a[0], b[0], t), z = U.lerp(a[1], b[1], t), m = e.d.m; m.visible = true;
    m.position.set(x, W.height(x, z), z); m.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]); _walk(m, dt, 7);
  },
  // only fines when he finishes his tour (not when the day ends early)
  end(e) {
    if (!G.isHost || G.final || G.time - e.t0 - e.warn < e.dur - 1) return;
    const n = W.brokenCount(), fine = n * 40;
    if (fine) { G.money -= fine; Game.log(`🧾 The tax inspector fined you ${U.money(fine)} for ${n} broken pieces.`); } else Game.log('🧾 The tax inspector found nothing wrong. He looks disappointed.');
  },
});

EV.def('clovers', { name: 'Lucky Clovers', icon: '🍀', tier: 'minor', w: 0.5, minDay: 2, warn: 3, dur: [30, 40], msg: 'Four-leaf clovers sprouted around the farm. Each one makes you run faster for a while!',
  begin() { if (G.isHost) for (let i = 0; i < 10; i++) { const p = H.farmPoint({ range: U.rand }); Game.spawnPickup('clover', p.x, p.z); } },
  update(e, dt) { for (const p of Game.pickups) if (p.type === 'clover' && Math.random() < dt * 3) FX.glow(p.x, p.y + 0.4, p.z, 0, 0.5, 0, 0.6, 0.2, 0x8aff7a); },
});

EV.def('ghost', Object.assign({ name: 'Ghost Farmer', icon: '👻', tier: 'minor', w: 0.8, minDay: 2, warn: 5, dur: [35, 45], night: true, msg: 'A ghost is drifting around the farm, drinking everyone\'s water. Keep away from it!',
  init(e) {
    const g = new MB(); g.ico(0.35, 1, 0xffffff, 0, 1.7, 0); g.cone(0.55, 1.5, 10, 0xeef4ff, 0, 0.9, 0); g.ico(0.07, 0, 0x111111, -0.12, 1.75, 0.3); g.ico(0.07, 0, 0x111111, 0.12, 1.75, 0.3); g.box(0.7, 0.06, 0.06, 0x6b4a2f, 0.2, 1.2, 0.35, 0, 0, 0.6);
    e.d.m = e.add(new THREE.Mesh(g.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false })));
    const a = e.rng() * 6.28; _mover(e, Math.cos(a) * 40, -5 + Math.sin(a) * 40);
  },
  host(e, dt) { const u = e.d.u, p = _nearest(u.x, u.z); if (p) _step(u, p.x, p.z, 3.2, dt); },
  update(e, dt, at) {
    const r = _lerpMover(e, dt), m = e.d.m, d = H.d(r.x, r.z);
    m.position.set(r.x, W.height(r.x, r.z) + 0.3 + Math.sin(at * 2) * 0.25, r.z); m.rotation.y = Math.atan2(P.pos.x - r.x, P.pos.z - r.z);
    W.darken(0.15); W.tint(0x4a5a8a, 0.12); AU.loop('wind', U.clamp(1 - d / 20, 0, 0.4));
    if (d < 2.5 && (P.can || P.bucket) && (!e.d.dt || e.d.dt < W.timeUniform.value)) { e.d.dt = W.timeUniform.value + 3; P.can = 0; P.bucket = 0; UI.dirty = true; UI.toast('👻 The ghost drank all your water!'); AU.play('whoosh'); }
    if (d < 1.2) P.hurt(4 * dt, 'scared to death by a ghost');
  },
}, _moverSync));

EV.def('giantchicken', Object.assign({ name: 'Giant Chicken', icon: '🐓', tier: 'major', w: 0.7, minDay: 3, warn: 7, dur: [35, 45], msg: 'A GIANT CHICKEN is stomping through the fields! Kick it enough and it lays a giant egg.',
  init(e) {
    e.d.m = AN.makeMesh('chicken'); e.objs.push(e.d.m); e.d.m.scale.setScalar(6); e.d.m.visible = false;
    e.d.pts = []; for (let i = 0; i < 6; i++) e.d.pts.push(H.fieldPoint(e.rng));
    const a = e.rng() * 6.28; _mover(e, Math.cos(a) * 60, -5 + Math.sin(a) * 60);
  },
  host(e, dt) {
    const u = e.d.u;
    if (u.done) { const a = Math.atan2(u.z + 5, u.x); _step(u, u.x + Math.cos(a) * 10, u.z + Math.sin(a) * 10, 7, dt); return; }
    const t = e.d.pts[u.i % e.d.pts.length]; if (_step(u, t.x, t.z, 3.2, dt) < 0.5) u.i++;
    e.d.ct = (e.d.ct || 0) + dt; if (e.d.ct > 0.2) { e.d.ct = 0; H.cropsIn(u.x, u.z, 2.2, 'stomped by a giant chicken'); }
  },
  kick(e, from) { const u = e.d.u; if (u.done) return; u.n++; if (u.n >= 8) { u.done = 1; Game.spawnPickup('giantegg', u.x, u.z); Game.log(`🥚 ${Game.pname(from)} kicked the giant chicken so hard it laid a GIANT EGG!`); } },
  update(e, dt) {
    const r = _lerpMover(e, dt), m = e.d.m, u = e.d.u, px = m.position.x, pz = m.position.z; m.visible = true;
    m.position.set(r.x, W.height(r.x, r.z), r.z);
    if (Math.hypot(r.x - px, r.z - pz) > 0.01) m.rotation.y = Math.atan2(r.x - px, r.z - pz);
    m.userData.phase += dt * 6; const sw = Math.sin(m.userData.phase) * 0.6; m.userData.legs.forEach((l, i) => l.rotation.x = i ? sw : -sw);
    const d = H.d(r.x, r.z);
    if (Math.random() < dt * 1.5) { AU.play('cluck', { x: r.x, y: 3, z: r.z }, 1); FX.shake(0.15 * U.clamp(1 - d / 25, 0, 1)); }
    if (d < 2 && P.pos.y < 3 && !u.done && (!e.d.ht || e.d.ht < W.timeUniform.value)) { e.d.ht = W.timeUniform.value + 1; P.hurt(20, 'stomped by a giant chicken'); P.launch((P.pos.x - r.x) * 4, 8, (P.pos.z - r.z) * 4); P.fallCause = 'stomped by a giant chicken'; }
    if (u.n !== e.d.ln) { e.d.ln = u.n; if (u.n) { AU.play('cluck', { x: r.x, y: 3, z: r.z }, 1); for (let i = 0; i < 8; i++) FX.emit(r.x, 3, r.z, U.rand(-3, 3), U.rand(1, 4), U.rand(-3, 3), 1.5, 0.3, 0xffffff, { g: 4 }); } }
  },
}, _moverSync));

EV.def('mud', { name: 'Mud Flood', icon: '🟫', tier: 'major', w: 0.6, minDay: 3, warn: 6, dur: [30, 40], msg: 'A mudslide! Everything slows down... except the pigs, who love it.',
  update(e, dt, at) {
    const k = Math.min(1, at / 5, (e.dur - at) / 5);
    W.waterLevel = Math.max(W.waterLevel, U.lerp(-0.6, 0.18, k)); W.floodMat.color.setHex(0x6b4a2f);
    if (P.pos.y < 0.4 && !P.inBunker) W.env.speed *= U.lerp(1, 0.45, k);
    W.tint(0x8a6a4a, 0.12 * k);
  },
  host(e, dt, at) {
    if (at > 4) H.crops(dt, 0.006, 'buried in mud', { gh: true });
    if (!e.d.fat && at > e.dur * 0.5) { e.d.fat = true; for (const a of AN.list) if (a.kind === 'pig') a.fat = Math.min(PIG_FAT, a.fat + 1); Game.log('🐖 The pigs rolled in the mud and got fatter!'); }
  },
  end() { W.waterLevel = -10; W.floodMat.color.setHex(0x4f8fb0); },
});

EV.def('robot', Object.assign({ name: 'Rogue Harvester', icon: '🤖', tier: 'major', w: 0.7, minDay: 3, warn: 7, dur: [35, 45], msg: 'A harvesting robot went rogue and is mowing down your crops row by row! Kick it until it breaks.',
  init(e) {
    e.d.m = e.add(new THREE.Mesh(M.robot(), M.mat)); e.d.m.visible = false;
    // mows one owned field, row after row
    const owned = PLOTS.map((p, i) => i).filter(i => G.plots[i]), p = PLOTS[owned[Math.floor(e.rng() * owned.length) % owned.length] || 0];
    e.d.pts = []; for (let r = 0; r < 4; r++) { const z = p.z + 1.6 + r * 3.2; e.d.pts.push(r % 2 ? [p.x + 13, z] : [p.x - 1, z], r % 2 ? [p.x - 1, z] : [p.x + 13, z]); }
    _mover(e, p.x - 8, p.z - 6);
  },
  host(e, dt) {
    const u = e.d.u; if (u.done) return;
    const t = e.d.pts[u.i % e.d.pts.length]; if (_step(u, t[0], t[1], 2.4, dt) < 0.3) u.i++;
    e.d.ct = (e.d.ct || 0) + dt; if (e.d.ct > 0.15) { e.d.ct = 0; H.cropsIn(u.x, u.z, 1.4, 'shredded by a rogue robot'); }
  },
  kick(e, from) { const u = e.d.u; if (u.done) return; u.n++; if (u.n >= 10) { u.done = 1; for (let i = 0; i < 4; i++) Game.spawnPickup('scrap', u.x + U.rand(-1.5, 1.5), u.z + U.rand(-1.5, 1.5)); Game.log(`🔧 ${Game.pname(from)} broke the rogue robot! Grab the scrap, it sells.`); } },
  update(e, dt) {
    const r = _lerpMover(e, dt), m = e.d.m, u = e.d.u, px = m.position.x, pz = m.position.z;
    m.visible = !e.d.boom; m.position.set(r.x, W.height(r.x, r.z), r.z);
    if (Math.hypot(r.x - px, r.z - pz) > 0.005) m.rotation.y = Math.atan2(r.x - px, r.z - pz) + Math.PI;
    if (u.done && !e.d.boom) { e.d.boom = true; FX.explode(r.x, 1, r.z, 1.2); AU.play('explosion', { x: r.x, y: 1, z: r.z }); }
    if (!u.done) {
      AU.loop('rumble', U.clamp(1 - H.d(r.x, r.z) / 25, 0, 0.5));
      if (Math.random() < dt * 10) FX.emit(r.x, 0.5, r.z, U.rand(-2, 2), U.rand(1, 3), U.rand(-2, 2), 0.8, 0.2, 0x7fae3e, { g: 9 });
      if (H.d(r.x, r.z) < 1.8 && P.pos.y < 2 && (!e.d.ht || e.d.ht < W.timeUniform.value)) { e.d.ht = W.timeUniform.value + 0.8; P.hurt(12, 'shredded by a rogue robot'); P.launch((P.pos.x - r.x) * 5, 5, (P.pos.z - r.z) * 5); }
    }
    if (u.n !== e.d.ln) { e.d.ln = u.n; if (u.n) { FX.emit(r.x, 1.5, r.z, U.rand(-2, 2), 3, U.rand(-2, 2), 0.5, 0.15, 0xffd27a, { g: 9 }); AU.play('zap', { x: r.x, y: 1, z: r.z }, 0.4); } }
  },
}, _moverSync));

EV.def('sandworm', { name: 'Sandworm', icon: '🪱', tier: 'major', w: 0.5, minDay: 4, warn: 8, dur: [28, 36], msg: 'Something HUGE is moving under the farm. Keep your animals away from the rumbling ground!',
  init(e) {
    const zones = Object.keys(ZONES).filter(z => AN.zoneOpen(z)); e.d.pts = []; e.d.eaten = 0;
    for (let i = 0; i < 6; i++) { if (i % 2) { const Z = ZONES[zones[Math.floor(e.rng() * zones.length) % zones.length]]; e.d.pts.push({ x: e.rng.range(Z.x0, Z.x1), z: e.rng.range(Z.z0, Z.z1) }); } else e.d.pts.push(H.farmPoint(e.rng)); }
    e.d.m = e.add(new THREE.Mesh(M.worm(), M.mat)); e.d.m.visible = false;
  },
  update(e, dt, at) {
    // tunnels between waypoints and bursts out of the ground at each one (some are in the pens)
    const n = e.d.pts.length, f = U.clamp(at / e.dur, 0, 0.999) * (n - 1), i = Math.floor(f), ph = f - i, a = e.d.pts[i], b = e.d.pts[i + 1], t = U.smooth(ph);
    const p = { x: U.lerp(a.x, b.x, t), z: U.lerp(a.z, b.z, t) }, up = ph > 0.8 ? Math.sin((ph - 0.8) / 0.2 * Math.PI) : 0, m = e.d.m;
    e.d.p = p; e.d.up = up;
    m.visible = up > 0.02; m.position.set(p.x, W.height(p.x, p.z) - 7 + up * 7.5, p.z); m.rotation.y = at;
    for (let k = 0; k < 4 * S.d.particles; k++) FX.emit(p.x + U.rand(-2, 2), 0.3, p.z + U.rand(-2, 2), U.rand(-3, 3), U.rand(2, 6) * (1 + up * 2), U.rand(-3, 3), 1, 0.5, 0xb89a6a, { g: 14 });
    const d = H.d(p.x, p.z); AU.loop('rumble', U.clamp(1 - d / 40, 0, 1)); FX.shake(0.25 * U.clamp(1 - d / 30, 0, 1));
    if (up > 0.5 && d < 3 && P.pos.y < 4 && (!e.d.ht || e.d.ht < W.timeUniform.value)) { e.d.ht = W.timeUniform.value + 1; P.launch(U.rand(-6, 6), 16, U.rand(-6, 6)); P.hurt(30, 'swallowed by a sandworm'); P.fallCause = 'thrown by a sandworm'; }
  },
  host(e, dt) {
    const p = e.d.p; if (!p) return;
    e.d.ct = (e.d.ct || 0) + dt; if (e.d.ct > 0.2) { e.d.ct = 0; H.cropsIn(p.x, p.z, 1.8, 'eaten by a sandworm'); }
    if (e.d.up > 0.6) for (const a of AN.near(p.x, p.z, 2.8)) if (a.state !== 'carried' && e.d.eaten < 2) { a.state = 'gone'; e.d.eaten++; Game.log(`🪱 The sandworm swallowed a ${a.kind}!`); }
  },
});

EV.def('toxic', { name: 'Toxic Spill', icon: '☣️', tier: 'major', w: 0.6, minDay: 3, warn: 6, dur: [40, 55], msg: 'Toxic sludge spilled on the fields! Wash the glowing tiles with water before the crops die.',
  init(e) { e.d.tox = []; },
  begin(e) {
    if (!G.isHost) return;
    const p = H.fieldPoint(Math.random), T = W.tiles;
    for (const i of W.tilesNear(p.x, p.z, 2.6)) if (G.plots[W.plotOf(i)] && (T.s[i] || T.c[i] >= 0)) { e.d.tox.push({ i, t: 0 }); if (T.w[i]) { T.w[i] = 0; Game.mark(i); } }
  },
  sync(e) { return e.d.tox.map(o => o.i); },
  unsync(e, v) { e.d.tox = v.map(i => ({ i })); },
  update(e) {
    for (const o of e.d.tox) if (Math.random() < 0.4 * S.d.particles) { const p = W.tilePos(o.i); FX.glow(p.x + U.rand(-0.7, 0.7), 0.15, p.z + U.rand(-0.7, 0.7), 0, U.rand(0.3, 1), 0, 0.8, 0.25, 0x7aff3a); }
    W.tint(0x8aff5a, 0.05);
  },
  host(e, dt) {
    const T = W.tiles;
    for (let k = e.d.tox.length - 1; k >= 0; k--) {
      const o = e.d.tox[k]; o.t += dt;
      if (T.w[o.i]) { e.d.tox.splice(k, 1); continue; } // washed clean
      if (o.t > 18) { Game.resetTile(o.i, 'poisoned by toxic sludge'); e.d.tox.splice(k, 1); continue; }
      if (Math.random() < dt * 0.06 && e.d.tox.length < 40) {
        const x = o.i % 8, z = Math.floor((o.i % 64) / 8), d = U.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]), nx = x + d[0], nz = z + d[1];
        if (nx >= 0 && nx < 8 && nz >= 0 && nz < 8) { const ni = o.i - (o.i % 64) + nz * 8 + nx; if ((T.s[ni] || T.c[ni] >= 0) && !T.w[ni] && !e.d.tox.some(q => q.i === ni)) e.d.tox.push({ i: ni, t: 0 }); }
      }
    }
  },
});
