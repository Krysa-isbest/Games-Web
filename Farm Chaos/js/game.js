// game.js — game state & rules. The host (or solo player) is the authority: clients send
// requests, the host applies them and broadcasts the result.
'use strict';

const PICKUP_GEO = {};
const Game = {
  pickups: [], pickupId: 1, avatars: {}, dirty: new Set(), tickT: 0, stateT: 0, growT: 0, fireT: 0, saveT: 0,
  sleepers: new Set(), sleepCD: -1, lastDay: 1, pickReq: {}, fireN: 0,

  init() {
    PICKUP_GEO.egg = M.egg(); PICKUP_GEO.frog = M.frog(); PICKUP_GEO.fish = M.fish(); PICKUP_GEO.meteorite = M.meteorite();
    PICKUP_GEO.stardust = M.stardust(); PICKUP_GEO.bag = M.bag(); PICKUP_GEO.truffle = M.truffle(); PICKUP_GEO.pumpkinbit = M.pumpkinBit(); PICKUP_GEO.goldegg = M.goldEgg();
    PICKUP_GEO.giantegg = M.giantEgg(); PICKUP_GEO.mushroom = M.mushroom(); PICKUP_GEO.clover = M.clover(); PICKUP_GEO.scrap = M.scrap();
    NET.onMsg = (from, m) => G.isHost ? this.handle(from, m) : this.clientMsg(m);
    NET.onJoin = id => { };
    NET.onLeave = id => {
      if (G.isHost) {
        const p = G.players[id]; if (p) this.log(`👋 ${p.name} left the farm`);
        delete G.players[id]; this.sleepers.delete(id); this.removeAvatar(id);
      } else { UI.alert('The host left the game.', () => location.reload()); }
    };
    addEventListener('beforeunload', () => { if (G.isHost && G.started && !G.final) this.save(); });
  },

  // ---------------- setup ----------------
  resetFarm() {
    Object.assign(G, { time: DAY * 0.02, money: 250, debt: DEBT_START, upgrades: {}, bin: 0, binItems: 0, priceMult: 1, destroyedToday: 0, insured: false, final: null, endless: false });
    G.seeds = CROPS.map((c, i) => i === 0 ? 20 : i === 2 ? 6 : 0);
    G.plots = PLOTS.map((p, i) => i === 0);
    G.stats = { earned: 0, harvested: 0, destroyed: 0, deaths: 0, abducted: 0, events: 0, pieces: 0, days: 1 };
    const T = W.tiles; T.s.fill(0); T.c.fill(-1); T.g.fill(0); T.st.fill(0); T.m.fill(0); T.f.fill(0); T.w.fill(0);
    AN.reset(); P.can = 0; P.bucket = 0;
    // a few tilled tiles to get started
    for (let i = 0; i < 16; i++) T.s[18 + (i % 4) + Math.floor(i / 4) * 8] = 1;
    W.repairAll(); W.cropsDirty = true; W.refreshPlots();
    EV.endAll(); EV.nextAt = 0;
    for (const p of this.pickups) W.scene.remove(p.mesh); this.pickups = [];
    P.pack = {}; P.packN = 0;
  },
  hasSave() { try { return !!localStorage.getItem('farmchaos_save'); } catch (e) { return false; } },
  saveInfo() { try { const s = JSON.parse(localStorage.getItem('farmchaos_save')); return s ? `Day ${Math.floor(s.time / DAY) + 1} · ${U.money(s.money)} · debt ${U.money(s.debt)}` : ''; } catch (e) { return ''; } },
  saveData() {
    const T = W.tiles;
    return { v: 2, time: G.time, money: G.money, debt: G.debt, seeds: G.seeds, upgrades: G.upgrades, plots: G.plots, bin: G.bin, binItems: G.binItems, stats: G.stats, insured: G.insured, endless: G.endless,
      tiles: { s: Array.from(T.s), c: Array.from(T.c), g: Array.from(T.g, v => Math.round(v)), m: Array.from(T.m), w: Array.from(T.w) }, broken: W.brokenList(), pack: P.pack,
      animals: AN.saveList(), water: [P.can, P.bucket] };
  },
  save() { if (!G.isHost || !G.started) return; try { localStorage.setItem('farmchaos_save', JSON.stringify(this.saveData())); } catch (e) { } },
  load(s) {
    if (!s) { try { s = JSON.parse(localStorage.getItem('farmchaos_save')); } catch (e) { return false; } }
    if (!s) return false;
    this.resetFarm();
    Object.assign(G, { time: s.time, money: s.money, debt: s.debt, seeds: s.seeds, upgrades: s.upgrades || {}, plots: s.plots, bin: s.bin || 0, binItems: s.binItems || 0, stats: Object.assign(G.stats, s.stats), insured: !!s.insured, endless: !!s.endless });
    const T = W.tiles;
    s.tiles.s.forEach((v, i) => T.s[i] = v); s.tiles.c.forEach((v, i) => T.c[i] = v); s.tiles.g.forEach((v, i) => T.g[i] = v); s.tiles.m.forEach((v, i) => T.m[i] = v);
    if (s.tiles.w) s.tiles.w.forEach((v, i) => T.w[i] = v);
    for (let i = 0; i < TILES_TOTAL; i++) T.st[i] = T.c[i] >= 0 ? this.stageOf(i) : 0;
    W.refreshPlots(); // shows bought greenhouses first, so their broken pieces load too
    for (const [bi, pi] of s.broken || []) this.setBrokenSilent(bi, pi);
    P.pack = s.pack || {}; P.packN = Object.values(P.pack).reduce((a, b) => a + b, 0);
    if (s.animals) AN.loadList(s.animals);
    if (s.water) [P.can, P.bucket] = s.water;
    W.cropsDirty = true;
    this.lastDay = G.day();
    return true;
  },
  setBrokenSilent(bi, pi) {
    const p = W.buildings[bi] && W.buildings[bi].pieces[pi]; if (!p || p.broken) return;
    if (W.buildings[bi].hidden) return;
    p.broken = true; p.mesh.visible = false; if (p.col) p.col.dead = true;
    const r = W.roofs.indexOf(p.mesh); if (r >= 0) W.roofs.splice(r, 1);
  },
  exportSave() {
    const blob = new Blob([JSON.stringify(this.saveData())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `chaos-farm-day${G.day()}.json`; a.click();
  },

  start(mode, loadSave) {
    G.mode = mode; G.isHost = mode !== 'client'; G.myId = mode === 'client' ? 'me' : 'host';
    AU.init(); AU.applyVolumes();
    if (G.isHost) {
      if (!(loadSave && this.load())) this.resetFarm();
      G.players = { host: { id: 'host', name: S.d.name, color: PLAYER_COLORS[S.d.color], x: 0, y: 0, z: 0 } };
      this.lastDay = G.day();
      G.started = true;
      this.log(G.day() === 1 && G.time < DAY * 0.05 ? '🌱 Welcome to Chaos Farm! Day 1 is calm — learn the ropes. Tomorrow, chaos begins.' : `🌅 Welcome back. Day ${G.day()}.`);
    }
    P.respawn(); P.invuln = 0;
    UI.enterGame();
  },
  startClient() {
    G.mode = 'client'; G.isHost = false; G.myId = 'me';
    AU.init(); AU.applyVolumes();
    NET.send({ k: 'hello', name: S.d.name, color: PLAYER_COLORS[S.d.color] });
  },

  // ---------------- messaging ----------------
  request(m) { if (G.isHost) this.handle(G.myId, m); else NET.send(m); },
  broadcast(m) { if (G.isHost && G.mode === 'host') NET.broadcast(m); },
  broadcastLocal(m) { this.clientMsg(m, true); this.broadcast(m); },
  give(to, items) { if (to === G.myId) P.give(items); else NET.sendTo(to, { k: 'give', items }); },
  log(text) { UI.log(text); this.broadcast({ k: 'log', text }); },
  pname(id) { return (G.players[id] && G.players[id].name) || 'Someone'; },

  // host: handle a request from a player (including the host itself)
  handle(from, m) {
    const pl = G.players[from];
    switch (m.k) {
      case 'hello': {
        if (Object.keys(G.players).length >= MAX_PLAYERS) { NET.sendTo(from, { k: 'full' }); return; }
        G.players[from] = { id: from, name: String(m.name || 'Farmer').slice(0, 16), color: m.color || 0xffffff, x: SPAWN.x, y: 0, z: SPAWN.z };
        NET.sendTo(from, { k: 'welcome', id: from, snap: this.snapshot() });
        this.log(`🧑‍🌾 ${G.players[from].name} joined the farm!`);
        AU.play('chime');
        return;
      }
      case 'me': if (pl) Object.assign(pl, m.p); return;
      case 'act': return this.act(from, m);
      case 'buy': return this.buy(from, m);
      case 'ship': {
        let v = 0, n = 0; for (const k in m.items) { v += itemValue(k) * m.items[k] * G.priceMult; n += m.items[k]; }
        if (!n) return;
        G.bin += Math.round(v); G.binItems += n;
        this.log(`📦 ${this.pname(from)} shipped ${n} item${n > 1 ? 's' : ''} (${U.money(v)})${G.priceMult !== 1 ? ` at ×${G.priceMult} prices` : ''} — paid in the morning`);
        return;
      }
      case 'pay': { const a = Math.min(Math.floor(m.amount), G.money, G.debt); if (a <= 0) return; G.money -= a; G.debt -= a; this.log(`🏦 ${this.pname(from)} paid ${U.money(a)} of the debt. ${G.debt > 0 ? U.money(G.debt) + ' left.' : 'DEBT PAID OFF!'}`); if (G.debt <= 0 && !G.final && !G.endless) this.beginFinal(); return; }
      case 'ins': G.insured = !!m.on; this.log(`📄 Crop insurance ${G.insured ? 'ON — premium charged each morning' : 'cancelled'}`); return;
      case 'pick': {
        const i = this.pickups.findIndex(p => p.id === m.id); if (i < 0) return;
        const p = this.pickups[i]; this.pickups.splice(i, 1); W.scene.remove(p.mesh);
        this.broadcast({ k: 'pk-', id: p.id });
        // a lucky clover is a speed boost, not an item
        if (p.type === 'clover') { if (from === G.myId) this.clientMsg({ k: 'boost', t: 30 }, true); else NET.sendTo(from, { k: 'boost', t: 30 }); return; }
        this.give(from, p.items || { [p.type]: 1 });
        return;
      }
      case 'milk': case 'shear': {
        const a = AN.byId(m.id); if (!a) return;
        if (m.k === 'milk' && a.milk) { a.milk = false; this.give(from, { milk: (G.has('milker') ? 2 : 1) + (a.milk2 ? 2 : 0) }); a.milk2 = false; AU.play('moo', a); }
        if (m.k === 'shear' && a.wool) {
          a.wool = false; AU.play('baa', a);
          // thunder sheep: double wool, but it bites back
          if (EV.has('thundersheep')) { this.give(from, { wool: 2 }); if (from === G.myId) this.clientMsg({ k: 'zapme' }, true); else NET.sendTo(from, { k: 'zapme' }); }
          else this.give(from, { wool: 1 });
        }
        return;
      }
      case 'kick': {
        if (m.kind === 'gnome') { const g = AN.gnomes.find(q => q.id === m.id); if (g) { g.vx = m.dx * 16; g.vy = 9; g.vz = m.dz * 16; g.state = 'flung'; g.y += 0.1; } }
        else { const a = AN.byId(m.id); if (a) { AN.fling(a, m.dx * 9, 6, m.dz * 9); if (a.state === 'flung') a.state = 'flung'; } }
        return;
      }
      case 'grab': { const a = AN.byId(m.id); if (a && a.state === 'abducted') { a.state = 'flung'; a.vy = -2; this.log(`💪 ${this.pname(from)} pulled a ${a.kind} out of the tractor beam!`); } return; }
      case 'carry': {
        const a = AN.byId(m.id); if (!a) return;
        if (m.on) AN.pickUp(a, from);
        else if (a.by === from) AN.putDown(a, +m.dx || 0, +m.dz || 0);
        return;
      }
      case 'feed': {
        const a = AN.byId(m.id); if (!a || a.kind !== 'pig' || a.fat >= PIG_FAT) return;
        a.fat = Math.min(PIG_FAT, a.fat + (G.has('pigfeed') ? 2 : 1));
        if (a.fat >= PIG_FAT) this.log(`🐖 ${this.pname(from)} fattened a pig. It's ready to sell!`);
        return;
      }
      case 'sellpig': {
        const a = AN.byId(m.id); if (!a || a.kind !== 'pig' || a.fat < PIG_FAT || a.state === 'carried') return;
        AN.remove(a); G.bin += PIG_PRICE; G.binItems++;
        this.log(`🐖 ${this.pname(from)} sold a fat pig for ${U.money(PIG_PRICE)} (paid in the morning)`); AU.play('coin');
        return;
      }
      case 'water': {
        const T = W.tiles;
        for (const i of m.tiles || []) {
          if (i < 0 || i >= TILES_TOTAL || !G.plots[W.plotOf(i)]) continue;
          if (T.f[i] > 0) this.extinguish(i);
          if ((T.s[i] || T.c[i] >= 0) && !T.w[i]) { T.w[i] = 1; this.mark(i); }
        }
        return;
      }
      case 'douse': { if (!WATER_EVENTS.includes(m.type)) return; const e = EV.get(m.type); if (e) EV.defs[m.type].douse(e, m.bi, m.pi, from); return; }
      case 'kickbig': { const e = EV.get(m.type); if (e && EV.defs[m.type].kick) EV.defs[m.type].kick(e, from); return; }
      case 'drop': { if (Object.keys(m.items || {}).length) this.spawnPickup('bag', m.x, m.z, m.items, m.y); return; }
      case 'died': G.stats.deaths++; this.log(`☠️ ${this.pname(from)} — ${m.cause}`); return;
      case 'sleep': if (m.on) this.sleepers.add(from); else this.sleepers.delete(from); return;
      case 'board': if (G.final && G.final.phase === 'evac') { G.final.boarded[from] = true; this.log(`🚁 ${this.pname(from)} is on the helicopter!`); } return;
      case 'chat': { const t = String(m.text || '').slice(0, 140); if (t) this.broadcastLocal({ k: 'chat', name: this.pname(from), c: pl ? pl.color : 0xffffff, text: t }); return; }
      case 'ping': this.broadcastLocal({ k: 'ping', x: m.x, z: m.z, name: this.pname(from), c: pl ? pl.color : 0xffffff }); return;
    }
  },

  act(from, m) {
    const T = W.tiles, tiles = (m.tiles || []).filter(i => i >= 0 && i < TILES_TOTAL && G.plots[W.plotOf(i)]);
    if (m.a === 'till') for (const i of tiles) { if (!T.s[i]) { T.s[i] = 1; this.mark(i); } }
    else if (m.a === 'plant') {
      const s = m.seed;
      for (const i of tiles) {
        if (!T.s[i] || T.c[i] >= 0 || G.seeds[s] <= 0) continue;
        G.seeds[s]--; T.c[i] = s; T.g[i] = 0; T.st[i] = 0; T.m[i] = 0; T.f[i] = 0; this.mark(i);
      }
    } else if (m.a === 'harvest') {
      const items = {};
      for (const i of tiles) {
        if (T.c[i] < 0 || T.st[i] !== 3) continue;
        const key = 'c' + T.c[i] + (T.m[i] ? '_' + T.m[i] : '');
        items[key] = (items[key] || 0) + 1; G.stats.harvested++;
        T.c[i] = -1; T.g[i] = 0; T.st[i] = 0; T.m[i] = 0; T.f[i] = 0; this.mark(i);
      }
      if (Object.keys(items).length) this.give(from, items);
    }
  },
  buy(from, m) {
    const who = this.pname(from), fail = msg => { if (from === G.myId) { UI.toast(msg); AU.play('deny'); } else NET.sendTo(from, { k: 'toast', text: msg }); };
    if (m.what === 'seed') {
      const c = CROPS[m.id], n = Math.max(1, Math.min(999, m.n | 0)), cost = c.cost * n;
      if (c.day > G.day() && !G.endless) return fail(`${c.name} unlocks on day ${c.day}`);
      if (G.money < cost) return fail('Not enough money');
      G.money -= cost; G.seeds[m.id] += n; this.ok(from);
      if (n >= 10) this.log(`🛒 ${who} bought ${n}× ${c.name} seeds (${U.money(cost)})`);
    } else if (m.what === 'plot') {
      const p = PLOTS[m.id]; if (!p || G.plots[m.id]) return;
      if (G.money < p.cost) return fail('Not enough money');
      G.money -= p.cost; G.plots[m.id] = true; W.refreshPlots(); this.ok(from);
      this.log(`🌾 ${who} bought Field ${m.id + 1} (${U.money(p.cost)})`);
    } else if (m.what === 'upgrade') {
      const u = UPGRADES.find(q => q.id === m.id); if (!u || u.soon || G.upgrades[u.id]) return;
      if (u.plot !== undefined && !G.plots[u.plot]) return fail('Buy that field first');
      if (u.needs && !G.upgrades[u.needs]) return fail('Buy ' + UPGRADES.find(q => q.id === u.needs).name + ' first');
      if (G.money < u.cost) return fail('Not enough money');
      G.money -= u.cost; G.upgrades[u.id] = true; W.refreshUpgradeProps(); this.ok(from);
      this.log(`🔧 ${who} bought ${u.name} (${U.money(u.cost)})`);
    } else if (m.what === 'animal') {
      const s = ANIMAL_SHOP[m.id]; if (!s) return;
      const zone = AN.freeZone(m.id); if (!zone) return fail(`No room for another ${s.name.toLowerCase()} — buy a bigger pen`);
      if (G.money < s.cost) return fail('Not enough money');
      G.money -= s.cost; AN.add(m.id, zone, { drop: true }); this.ok(from);
      this.log(`${s.icon} ${who} bought a ${s.name.toLowerCase()} (${U.money(s.cost)})`);
    } else if (m.what === 'repair') {
      const n = W.brokenCount(), cost = n * 15; if (!n) return;
      if (G.money < cost) return fail('Not enough money');
      G.money -= cost; W.repairAll(); this.broadcast({ k: 'rep' }); this.ok(from);
      this.log(`🔨 ${who} repaired the farm (${n} pieces, ${U.money(cost)})`);
    }
    this.sendState();
  },
  ok(from) { if (from === G.myId) AU.play('buy'); else NET.sendTo(from, { k: 'ok' }); },

  // ---------------- tiles ----------------
  mark(i) { this.dirty.add(i); W.cropsDirty = true; },
  stageOf(i) { const T = W.tiles, g = T.g[i], need = CROPS[T.c[i]].grow; return g >= need ? 3 : Math.min(2, Math.floor(g / need * 3)); },
  destroyTile(i, cause) {
    if (!G.isHost) return;
    const T = W.tiles; if (T.c[i] < 0) return;
    G.destroyedToday += CROPS[T.c[i]].sell * MUTS[T.m[i]].mult * (T.st[i] + 1) / 4; G.stats.destroyed++;
    this.cropPuff(i);
    T.c[i] = -1; T.g[i] = 0; T.st[i] = 0; T.m[i] = 0; T.f[i] = 0; this.mark(i);
    this.dirty.add(i); (this.destroyed || (this.destroyed = new Set())).add(i);
  },
  resetTile(i, cause) { if (!G.isHost) return; this.destroyTile(i, cause); const T = W.tiles; if (T.s[i]) { T.s[i] = 0; this.mark(i); } },
  mutateTile(i, mu) { if (!G.isHost) return; const T = W.tiles; if (T.c[i] < 0 || T.m[i] === mu) return; T.m[i] = mu; this.mark(i); },
  igniteTile(i) { if (!G.isHost) return; const T = W.tiles; if ((T.c[i] < 0 && !T.s[i]) || T.f[i] > 0 || W.waterLevel > 0.2 || (T.w[i] && Math.random() < 0.75)) return; T.f[i] = 0.01; this.mark(i); },
  // irrigation (Farm Upgrade II): water every tilled tile, if the water tower is still standing
  irrigate(why) {
    if (!W.tower.intact()) { this.log('🚱 The water tower is broken — no irrigation until it is repaired'); return false; }
    const T = W.tiles; let n = 0;
    for (let i = 0; i < TILES_TOTAL; i++) if (G.plots[W.plotOf(i)] && (T.s[i] || T.c[i] >= 0)) { if (T.f[i] > 0) this.extinguish(i); if (!T.w[i]) { T.w[i] = 1; this.mark(i); n++; } }
    if (why) this.log(why);
    return true;
  },
  extinguish(i) { const T = W.tiles; if (T.f[i] > 0) { T.f[i] = 0; this.mark(i); } },
  cropPuff(i) {
    const T = W.tiles, p = W.tilePos(i), c = CROPS[T.c[i]] || CROPS[0];
    for (let k = 0; k < 6 * S.d.particles; k++) FX.emit(p.x, 0.4, p.z, U.rand(-2, 2), U.rand(1, 4), U.rand(-2, 2), 0.8, 0.35, k % 2 ? c.leaf : c.fruit, { g: 10 });
  },
  chaosPeppers() { let n = 0; for (let i = 0; i < TILES_TOTAL; i++) if (W.tiles.c[i] === 17) n++; return n; },
  tileDiff() {
    const T = W.tiles, out = [];
    for (const i of this.dirty) out.push([i, T.s[i], T.c[i], T.st[i], T.m[i], T.f[i] > 0 ? 1 : 0, this.destroyed && this.destroyed.has(i) ? 1 : 0, T.w[i]]);
    this.dirty.clear(); if (this.destroyed) this.destroyed.clear();
    return out;
  },

  // ---------------- pickups ----------------
  countPickups(t) { return this.pickups.filter(p => p.type === t).length; },
  spawnPickup(type, x, z, items, y) {
    if (!G.isHost) return;
    const p = { id: this.pickupId++, type, x, z, y: y !== undefined ? y : W.height(x, z), items, t: 0 };
    this.addPickup(p);
    this.broadcast({ k: 'pk+', p: { id: p.id, type, x, z, y: p.y, items } });
  },
  addPickup(p) {
    const m = new THREE.Mesh(PICKUP_GEO[p.type] || PICKUP_GEO.bag, M.mat); m.castShadow = true;
    m.position.set(p.x, p.y, p.z); W.scene.add(m); p.mesh = m; p.t = p.t || 0; p.ph = Math.random() * 6;
    if (p.type !== 'bag' && p.type !== 'egg' && p.type !== 'truffle' && p.y > W.height(p.x, p.z) + 1) p.vy = 0;
    this.pickups.push(p);
  },
  renderPickups(dt) {
    const t = W.timeUniform.value;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i], m = p.mesh, gy = W.height(p.x, p.z);
      p.t += dt;
      if (p.y > gy) { p.vy = (p.vy || 0) - 22 * dt; p.y = Math.max(gy, p.y + p.vy * dt); }
      m.position.set(p.x, p.y, p.z);
      if (p.type === 'frog') { const h = Math.abs(Math.sin(t * 3 + p.ph)); m.position.y += h * 0.4; if (h > 0.98) { p.x += Math.cos(p.ph + t) * 0.03; p.z += Math.sin(p.ph + t) * 0.03; } }
      else if (p.type === 'fish') m.rotation.z = Math.PI / 2 + Math.sin(t * 15 + p.ph) * 0.4;
      else if (p.type === 'stardust') { m.rotation.y += dt * 2; m.position.y += 0.3 + Math.sin(t * 2 + p.ph) * 0.15; FX.glow(p.x, p.y + 0.4, p.z, 0, 0.3, 0, 0.6, 0.25, 0xfff2a0); }
      else if (p.type === 'meteorite') { if (Math.random() < 0.1) FX.emit(p.x, p.y + 0.3, p.z, 0, 1, 0, 1.2, 0.4, 0x555050, { grow: 1 }); }
      else if (p.type === 'bag') { m.rotation.y += dt; m.position.y += 0.1 + Math.sin(t * 3) * 0.08; }
      // auto pickup
      if (!P.dead && !P.inBunker && Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 1.4 && Math.abs(p.y - P.pos.y) < 2) {
        const n = p.items ? Object.values(p.items).reduce((a, b) => a + b, 0) : 1;
        if (P.packN + n > P.capacity() && p.type !== 'bag' && p.type !== 'clover') { if (!p.warned) { p.warned = true; UI.toast('Backpack full!'); } }
        else if (!this.pickReq[p.id] || this.pickReq[p.id] < t) { this.pickReq[p.id] = t + 1; this.request({ k: 'pick', id: p.id }); AU.play('pickup', null, 0.6); }
      }
      if (G.isHost && p.type !== 'bag' && p.t > 300) { this.pickups.splice(i, 1); W.scene.remove(m); this.broadcast({ k: 'pk-', id: p.id }); }
    }
  },

  // ---------------- host simulation ----------------
  hostUpdate(dt) {
    const T = W.tiles;
    this.grow(dt);
    // fire spread
    this.fireT += dt;
    if (this.fireT >= 0.5) {
      const ft = this.fireT; this.fireT = 0;
      const wet = EV.has('acidrain') || EV.has('hurricane') || EV.has('blizzard') || EV.has('lightning') || EV.has('hail');
      for (let i = 0; i < TILES_TOTAL; i++) {
        if (T.f[i] <= 0) continue;
        T.f[i] += ft;
        if ((wet && Math.random() < 0.3) || (G.has('sprinkler') && Math.random() < 0.25)) { this.extinguish(i); continue; }
        if (Math.random() < 0.28) {
          const k = i % 64, x = k % 8, z = Math.floor(k / 8), d = U.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
          const nx = x + d[0], nz = z + d[1]; if (nx >= 0 && nx < 8 && nz >= 0 && nz < 8) this.igniteTile(i - k + nz * 8 + nx);
        }
        if (T.f[i] > 4) { if (T.c[i] >= 0) this.destroyTile(i, 'burned'); T.f[i] = 0; this.mark(i); }
      }
    }
    // day change / sleeping
    const ids = Object.keys(G.players), need = Math.max(1, Math.ceil(ids.length / 2));
    for (const id of this.sleepers) if (!G.players[id]) this.sleepers.delete(id);
    if (this.sleepers.size >= need && !G.final) {
      if (this.sleepCD < 0) this.sleepCD = G.mode === 'solo' || ids.length === 1 ? 2.5 : 10;
      this.sleepCD -= dt;
      if (this.sleepCD <= 0) { this.sleepCD = -1; this.sleepUntilMorning(); }
    } else this.sleepCD = -1;
    if (G.day() !== this.lastDay) { this.lastDay = G.day(); this.morning(false); }
    // Farm Upgrade III: the pipes water the fields again in the afternoon
    if (G.has('farm3') && G.hour() >= 14 && G.hour() < 20 && this.noonDay !== G.day()) { this.noonDay = G.day(); this.irrigate('💧 Afternoon irrigation: the fields are watered again'); }
    if (G.final) this.finalUpdate(dt);
    // autosave
    this.saveT += dt; if (this.saveT > 90) { this.saveT = 0; this.save(); }
  },

  // crop growth. The host is the authority for stages; clients run the same math only so the
  // "growing (x%)" prompt shows real progress (the host never sends the growth timer).
  grow(dt) {
    const T = W.tiles;
    this.growT += dt;
    if (this.growT < 1) return;
    const step = this.growT; this.growT = 0;
    let mult = EV.has('timewarp') ? 6 : 1; if (EV.has('eclipse')) mult = 0;
    const moon = EV.has('lowgrav'), drought = EV.has('drought');
    for (let i = 0; i < TILES_TOTAL; i++) {
      if (T.c[i] < 0 || T.st[i] === 3) continue;
      // watered crops grow 60% faster; in a drought only watered crops grow at all
      const wet = T.w[i] ? 1.6 : drought ? 0 : 1, need = CROPS[T.c[i]].grow;
      T.g[i] += step * mult * wet * (moon && CROPS[T.c[i]].moon ? 3 : 1);
      if (!G.isHost) { T.g[i] = U.clamp(T.g[i], T.st[i] * need / 3, need - 0.01); continue; }
      const st = this.stageOf(i); if (st !== T.st[i]) { T.st[i] = st; this.mark(i); }
    }
  },
  sleepUntilMorning() {
    const next = G.day() * DAY;
    const skipped = next - G.time;
    G.time = next + 0.01;
    const T = W.tiles;
    for (let i = 0; i < TILES_TOTAL; i++) if (T.c[i] >= 0 && T.st[i] < 3) { T.g[i] += skipped; const st = this.stageOf(i); if (st !== T.st[i]) { T.st[i] = st; this.mark(i); } }
    this.lastDay = G.day();
    this.morning(true);
  },

  morning(slept) {
    const lines = []; let dry = false;
    EV.endAll(); this.broadcast({ k: 'evx' }); W.waterLevel = -10; G.priceMult = 1;
    const day = G.day(); G.stats.days = day;
    lines.push(`<h3>Day ${day}</h3>`);
    // things that happened overnight
    if ((day > 2 || G.endless) && S.d.host.freq > 0) {
      const T = W.tiles, crops = []; for (let i = 0; i < TILES_TOTAL; i++) if (T.c[i] >= 0) crops.push(i);
      const night = [
        ['🌨️ A hailstorm hit overnight', 0.08], ['🧙 Gnomes raided the fields while you slept', 0.06], ['🦝 Raccoons had a midnight snack', 0.05],
        ['👻 Something howled in the fields all night', 0], ['🌧️ It rained all night (nice!)', 0], ['🛸 Lights in the sky... a cow is missing', 'cow'],
        ['🐀 Rats got into the fields overnight', 0.05], ['🦊 A fox got into the chicken coop', 'fox'],
        ['🪣 The well ran dry overnight. It refills at 10:00', 'dry'], ['🐄 One of the cows looks extra happy today (double milk)', 'milk'],
        ['🪟 Something cracked a greenhouse overnight', 'glass'], ['✨ One of your crops turned to gold overnight', 'gold'],
      ];
      const n = Math.random() < 0.4 * S.d.host.freq ? (Math.random() < 0.3 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        const [txt, frac] = U.pick(night);
        if (frac === 'cow') { const cows = AN.list.filter(a => a.kind === 'cow' && a.state !== 'gone'); if (cows.length > 1) { U.pick(cows).state = 'gone'; G.stats.abducted++; lines.push(txt); } else lines.push('🛸 Lights in the sky... but the aliens left empty-handed'); }
        else if (frac === 'dry') { dry = true; lines.push(txt); }
        else if (frac === 'milk') { const cows = AN.list.filter(a => a.kind === 'cow'); if (cows.length) { U.pick(cows).milk2 = true; lines.push(txt); } }
        else if (frac === 'glass') { const ghs = W.ghs.filter(b => !b.hidden); if (ghs.length) { const b = U.pick(ghs), ps = b.pieces.filter(p => !p.broken); if (ps.length) { const p = U.pick(ps); this.breakPiece(b.id, p.idx, p.center.x, p.center.y, p.center.z, 2); lines.push(txt); } } }
        else if (frac === 'gold') { const c = crops.filter(i => T.c[i] >= 0); if (c.length) { this.mutateTile(U.pick(c), 6); lines.push(txt); } }
        else if (frac === 'fox') { const ch = AN.list.filter(a => a.kind === 'chicken' && a.state !== 'gone'); if (ch.length > 3) { U.pick(ch).state = 'gone'; lines.push(txt + ': one chicken is missing'); } else lines.push('🦊 A fox sniffed around the coop, but the chickens were safe'); }
        else if (frac > 0) { let lost = 0; for (const i of crops) if (T.c[i] >= 0 && !W.greenhouse(i) && Math.random() < frac) { this.destroyTile(i, 'overnight'); lost++; } lines.push(`${txt}: ${lost} crops lost`); }
        else lines.push(txt);
      }
    }
    const lost = AN.morning();
    if (lost) lines.push(`🛸 ${lost} animal${lost > 1 ? 's are' : ' is'} gone for good. Buy new ones in the shop (Animals).`);
    // yesterday's water dried up; the irrigation waters everything again
    W.tiles.w.fill(0); for (let i = 0; i < TILES_TOTAL; i++) if (W.tiles.s[i] || W.tiles.c[i] >= 0) this.mark(i);
    if (G.has('farm2') && this.irrigate()) lines.push('💧 The irrigation watered all your fields');
    if (G.bin > 0) { G.money += G.bin; G.stats.earned += G.bin; lines.push(`💰 Shipping paid out <b>${U.money(G.bin)}</b> for ${G.binItems} items`); AU.play('coin'); }
    else lines.push('📦 Nothing was shipped yesterday.');
    G.bin = 0; G.binItems = 0;
    if (G.insured) {
      const prem = 200 + 50 * day, pay = Math.round(G.destroyedToday * 0.5);
      G.money -= prem; G.money += pay;
      lines.push(`📄 Insurance: premium −${U.money(prem)}, paid out +${U.money(pay)} for destroyed crops`);
    }
    G.destroyedToday = 0;
    const broken = W.brokenCount();
    if (broken) {
      const cost = broken * 15;
      if (G.money >= cost) { G.money -= cost; W.repairAll(); this.broadcast({ k: 'rep' }); lines.push(`🔨 The builders repaired ${broken} broken pieces (−${U.money(cost)})`); }
      else lines.push(`🔨 Not enough money to repair ${broken} broken pieces (${U.money(cost)})`);
    }
    if (day === 2 && !G.endless) lines.push('⚠️ <b>From today, chaos events start.</b> Watch the warnings at the top of the screen!');
    const unlocked = CROPS.filter(c => c.day === day).map(c => c.name);
    if (unlocked.length && !G.endless) lines.push(`🌱 New seeds in the shop: ${unlocked.join(', ')}`);
    if (G.money < 0) lines.push('😬 You are in the red. Ship something!');
    const msg = { k: 'morning', lines, slept, dry };
    this.clientMsg(msg, true); this.broadcast(msg);
    this.sleepers.clear(); this.sendState();
    this.save();
  },

  // ---------------- final day ----------------
  beginFinal() {
    G.final = { phase: 'radio', t: 0, boarded: {} };
    this.broadcastLocal({ k: 'final', phase: 'radio' });
  },
  finalUpdate(dt) {
    const F = G.final; F.t += dt;
    if (F.phase === 'radio' && F.t > 14) {
      F.phase = 'evac'; F.t = 0; this.broadcastLocal({ k: 'final', phase: 'evac' });
      for (const t of ['tornado', 'meteors', 'lightning', 'acidrain', 'earthquake', 'gnomes']) EV.start(t);
    }
    if (F.phase === 'evac') {
      if (F.t > 25 && Math.random() < dt * 0.15) { const t = EV.pickType(99); if (t && t !== 'nuke') EV.start(t); }
      const ids = Object.keys(G.players), all = ids.every(id => F.boarded[id]);
      if (all || F.t > 90) {
        F.phase = 'cutscene'; F.t = 0;
        const left = ids.filter(id => !F.boarded[id]).map(id => [G.players[id].x, G.players[id].z]);
        this.broadcastLocal({ k: 'final', phase: 'cutscene', left });
      }
    }
  },
  continueEndless() {
    G.final = null; G.endless = true; G.debt = 0;
    W.repairAll(); this.broadcast({ k: 'rep' });
    for (let i = 0; i < TILES_TOTAL; i++) this.resetTile(i, '');
    for (let i = 0; i < 16; i++) { W.tiles.s[18 + (i % 4) + Math.floor(i / 4) * 8] = 1; this.mark(18 + (i % 4) + Math.floor(i / 4) * 8); }
    G.money += 2000; G.seeds[0] += 30;
    this.broadcastLocal({ k: 'final', phase: 'endless' });
    this.log('♾️ ENDLESS MODE. The farm has been rebuilt by the government (sorry about the nuke). Chaos is turned up.');
    this.save();
  },

  // ---------------- sync ----------------
  snapshot() {
    const T = W.tiles;
    return {
      time: G.time, money: G.money, debt: G.debt, seeds: G.seeds, upgrades: G.upgrades, plots: G.plots, bin: G.bin, binItems: G.binItems, pm: G.priceMult, stats: G.stats, endless: G.endless, insured: G.insured,
      tiles: { s: Array.from(T.s), c: Array.from(T.c), st: Array.from(T.st), m: Array.from(T.m), f: Array.from(T.f, v => v > 0 ? 1 : 0), w: Array.from(T.w) },
      broken: W.brokenList(), pickups: this.pickups.map(p => ({ id: p.id, type: p.type, x: p.x, z: p.z, y: p.y, items: p.items })),
      events: EV.active.map(e => ({ id: e.id, type: e.type, seed: e.seed, t0: e.t0, warn: e.warn, dur: e.dur, p: e.p })),
      final: G.final ? { phase: G.final.phase } : null, host: S.d.host,
    };
  },
  playersPacket() {
    const me = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), yw: +P.yaw.toFixed(2), pt: +P.pitch.toFixed(2), d: P.dead ? 1 : 0, s: P.sleeping ? 1 : 0, b: P.inBunker ? 1 : 0, bo: P.boarded ? 1 : 0, cr: P.crouch ? 1 : 0 };
    return me;
  },
  sendState() {
    if (!G.isHost || G.mode !== 'host') return;
    const ids = Object.keys(G.players);
    NET.broadcast({ k: 's', money: G.money, debt: G.debt, seeds: G.seeds, upgrades: G.upgrades, plots: G.plots, bin: G.bin, binItems: G.binItems, pm: G.priceMult, ins: G.insured, endless: G.endless, stats: G.stats,
      sl: { n: this.sleepers.size, need: Math.max(1, Math.ceil(ids.length / 2)), cd: this.sleepCD } });
  },
  netUpdate(dt) {
    this.tickT += dt; this.stateT += dt;
    if (G.isHost) {
      Object.assign(G.players[G.myId], this.playersPacket(), { name: S.d.name, color: PLAYER_COLORS[S.d.color] });
      if (P.sleeping) this.sleepers.add(G.myId); else this.sleepers.delete(G.myId);
      if (G.mode !== 'host') { this.dirty.clear(); if (this.destroyed) this.destroyed.clear(); return; }
      if (this.tickT >= 1 / 15) {
        this.tickT = 0;
        const ev = {}; for (const e of EV.active) if (e.def.sync && e.phase === 'active') ev[e.id] = e.def.sync(e);
        NET.broadcast({ k: 't', t: G.time, p: Object.values(G.players).map(p => ({ id: p.id, n: p.name, c: p.color, x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt, d: p.d, s: p.s, b: p.b, bo: p.bo, cr: p.cr })), a: AN.pack(), e: ev });
        if (this.dirty.size) NET.broadcast({ k: 'tl', d: this.tileDiff() });
      }
      if (this.stateT >= 0.5) { this.stateT = 0; this.sendState(); }
    } else if (G.started && this.tickT >= 1 / 15) {
      this.tickT = 0;
      NET.send({ k: 'me', p: this.playersPacket() });
    }
  },

  // client: messages from the host (also used locally by the host for shared visuals)
  clientMsg(m, local) {
    switch (m.k) {
      case 'welcome': {
        const s = m.snap; G.myId = m.id;
        Object.assign(G, { time: s.time, money: s.money, debt: s.debt, seeds: s.seeds, upgrades: s.upgrades, plots: s.plots, bin: s.bin, binItems: s.binItems, priceMult: s.pm, stats: s.stats, endless: s.endless, insured: s.insured });
        S.d.host = Object.assign({}, S.d.host, s.host);
        const T = W.tiles; s.tiles.s.forEach((v, i) => T.s[i] = v); s.tiles.c.forEach((v, i) => T.c[i] = v); s.tiles.st.forEach((v, i) => T.st[i] = v); s.tiles.m.forEach((v, i) => T.m[i] = v); s.tiles.f.forEach((v, i) => T.f[i] = v);
        if (s.tiles.w) s.tiles.w.forEach((v, i) => T.w[i] = v);
        W.refreshPlots(); W.repairAll(); for (const [bi, pi] of s.broken) this.setBrokenSilent(bi, pi);
        for (const p of s.pickups) this.addPickup(p);
        for (const e of s.events) EV.add(e);
        if (s.final) G.final = { phase: s.final.phase, t: 0, boarded: {} };
        W.cropsDirty = true; W.refreshPlots();
        G.started = true; P.respawn(); UI.enterGame();
        UI.log('🧑‍🌾 You joined the farm!');
        return;
      }
      case 'full': UI.alert('That farm is full (4 players max).', () => location.reload()); return;
      case 't': {
        if (Math.abs(m.t - G.time) > 0.6) G.time = m.t; else G.time += (m.t - G.time) * 0.1;
        const seen = new Set();
        for (const p of m.p) { if (p.id === G.myId) continue; seen.add(p.id); G.players[p.id] = Object.assign(G.players[p.id] || {}, { id: p.id, name: p.n, color: p.c, x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt, d: p.d, s: p.s, b: p.b, bo: p.bo, cr: p.cr }); }
        for (const id in G.players) if (!seen.has(id) && id !== G.myId) { delete G.players[id]; this.removeAvatar(id); }
        AN.unpack(m.a);
        for (const id in m.e) { const e = EV.active.find(q => q.id === +id); if (e && e.def.unsync) e.def.unsync(e, m.e[id]); }
        return;
      }
      case 'tl': {
        const T = W.tiles;
        for (const [i, s, c, st, mu, f, x, w] of m.d) { if (x && T.c[i] >= 0) this.cropPuff(i); if (T.c[i] !== c) T.g[i] = 0; T.s[i] = s; T.c[i] = c; T.st[i] = st; T.m[i] = mu; T.f[i] = f; T.w[i] = w || 0; }
        W.cropsDirty = true; return;
      }
      case 's': {
        const wasPlots = JSON.stringify(G.plots), wasUp = JSON.stringify(G.upgrades);
        Object.assign(G, { money: m.money, debt: m.debt, seeds: m.seeds, upgrades: m.upgrades, plots: m.plots, bin: m.bin, binItems: m.binItems, priceMult: m.pm, insured: m.ins, endless: m.endless, stats: m.stats });
        G.sleepInfo = m.sl;
        if (wasPlots !== JSON.stringify(G.plots) || wasUp !== JSON.stringify(G.upgrades)) W.refreshPlots();
        UI.dirty = true; return;
      }
      case 'ev': EV.add(m.e); return;
      case 'evx': EV.endAll(); W.waterLevel = -10; return;
      case 'br': W.breakPiece(m.b, m.i, m.x, m.y, m.z, m.f); return;
      case 'rep': W.repairAll(); return;
      case 'pk+': this.addPickup(m.p); return;
      case 'pk-': { const i = this.pickups.findIndex(p => p.id === m.id); if (i >= 0) { W.scene.remove(this.pickups[i].mesh); this.pickups.splice(i, 1); } return; }
      case 'give': P.give(m.items); return;
      case 'toast': UI.toast(m.text); AU.play('deny'); return;
      case 'boost': P.hotT = Math.max(P.hotT, m.t); UI.toast(`🍀 Lucky clover! You run faster for ${m.t} s`); AU.play('chime'); return;
      case 'zapme': P.hurt(20, 'shocked by a thunder sheep'); P.launch(U.rand(-4, 4), 6, U.rand(-4, 4)); AU.play('zap', null, 0.8); FX.flash(0.3, '#bfe0ff'); return;
      case 'ok': AU.play('buy'); return;
      case 'log': UI.log(m.text); return;
      case 'chat': UI.log(`<span style="color:#${new THREE.Color(m.c).getHexString()}">${UI.esc(m.name)}:</span> ${UI.esc(m.text)}`); AU.play('pickup', null, 0.3); return;
      case 'ping': this.showPing(m); return;
      case 'zap': { const tp = W.props.turret.position; const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(tp.x, 2.6, tp.z), new V3(m.x, m.y, m.z)]), new THREE.LineBasicMaterial({ color: 0xff3030 })); FX.temp(l, 0.15); AU.play('zap', tp, 0.5); return; }
      case 'morning': {
        if (!local) { EV.endAll(); W.waterLevel = -10; AN.morning(); }
        if (P.sleeping) { P.sleeping = false; P.pos.set(W.bedPos.x + 1.4, 0, W.bedPos.z); }
        G.wellDry = m.dry ? G.day() : 0;
        UI.morning(m.lines); AU.play('chime');
        return;
      }
      case 'final': return this.finalMsg(m);
    }
  },
  // host: break a building piece everywhere
  breakPiece(bi, pi, x, y, z, f) {
    const p = W.buildings[bi] && W.buildings[bi].pieces[pi]; if (!p || p.broken || W.buildings[bi].hidden) return;
    W.breakPiece(bi, pi, x, y, z, f);
    this.broadcast({ k: 'br', b: bi, i: pi, x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1), f });
  },
  alivePlayers() { return Object.values(G.players).filter(p => !p.d && !p.b && p.x !== undefined); },

  showPing(m) {
    const col = m.c || 0xffffff;
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 30, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false }));
    beam.position.y = 15; g.add(beam);
    const tag = M.nameTag(m.name + ' ⬇', col); tag.position.y = 4; g.add(tag);
    g.position.set(m.x, W.height(m.x, m.z), m.z);
    FX.temp(g, 6, t => { beam.material.opacity = 0.5 * (1 - t / 6); });
    AU.play('warn', null, 0.4);
  },

  // ---------------- final day (every client) ----------------
  finalMsg(m) {
    if (!G.final) G.final = { phase: m.phase, t: 0, boarded: {} };
    G.final.phase = m.phase; G.final.t = 0;
    if (m.phase === 'radio') {
      UI.radio([
        '📻 *crackle* ...this is Colonel Mack, National Guard.',
        '📻 Congratulations on paying off your debt, farmer.',
        '📻 Bad news: the government has picked your farm as a nuclear test site.',
        '📻 A helicopter is landing south of your fields. You have 90 seconds once it lands. GO!',
      ]);
      AU.play('radio');
    } else if (m.phase === 'evac') {
      this.heli = M.heli(); this.heli.position.set(W.padPos.x, 60, W.padPos.z); W.scene.add(this.heli);
      UI.toast('🚁 Get to the helicopter south of the fields! (E to board)');
    } else if (m.phase === 'cutscene') {
      EV.endAll(); this.cut = { t: 0, left: m.left || [], boom: false };
      UI.hideModal(); UI.hud(false);
    } else if (m.phase === 'endless') {
      if (this.heli) { W.scene.remove(this.heli); this.heli = null; }
      G.final = null; this.cut = null; P.boarded = false; P.respawn(); UI.hud(true); UI.hideStats();
      if (!G.isHost) { W.repairAll(); }
    }
  },
  updateFinalVisuals(dt) {
    const F = G.final;
    if (F && !G.isHost) F.t += dt;
    if (this.heli) {
      const h = this.heli; h.userData.rotor.rotation.y += dt * 25; h.userData.tail.rotation.x += dt * 30;
      if (F && F.phase === 'evac') {
        h.position.y = Math.max(0, h.position.y - dt * 8);
        AU.loop('wind', U.clamp(1 - Math.hypot(h.position.x - P.pos.x, h.position.z - P.pos.z) / 50, 0.1, 0.5));
        if (Math.random() < dt * 20) FX.emit(W.padPos.x + 6, 0.3, W.padPos.z, U.rand(-0.5, 0.5), U.rand(2, 4), U.rand(-0.5, 0.5), 3, 1.2, 0x40ff60, { grow: 2 });
        if (P.boarded) { P.pos.set(h.position.x, h.position.y + 0.8, h.position.z + 0.5); }
      }
    }
    if (this.cut) this.cutscene(dt);
  },
  cutscene(dt) {
    const c = this.cut; c.t += dt;
    const h = this.heli, cam = W.camera;
    if (h) { h.position.y += dt * (c.t < 6 ? 6 : 2); h.position.z += dt * 10; }
    const hp = h ? h.position : new V3(0, 40, 80);
    // camera: from inside the heli looking back at the farm
    cam.position.set(hp.x + 4, hp.y + 3, hp.z + 8);
    cam.lookAt(0, 6, -10); P.boarded = true; P.dead = false;
    if (c.t > 2.5 && !c.bomb) { c.bomb = new THREE.Mesh(M.bomb(), M.mat); c.bomb.rotation.z = Math.PI; W.scene.add(c.bomb); AU.play('whoosh'); }
    if (c.bomb && !c.boom) { c.bomb.position.set(0, Math.max(2, 120 - (c.t - 2.5) * 60), -10); }
    if (c.t > 4.5 && !c.boom) {
      c.boom = true; W.scene.remove(c.bomb);
      FX.flash(1, '#ffffff'); FX.explode(0, 0, -10, 8); AU.play('bigboom', null, 2); FX.shake(1.5);
      W.buildings.forEach((b, bi) => b.pieces.forEach((p, pi) => { if (!p.broken) W.breakPiece(bi, pi, 0, -2, -10, 26); }));
      for (const [x, z] of c.left) for (let i = 0; i < 4; i++) FX.chunk(x, 1, z, [0xe74c3c, 0x3d5f9c, COL.skin, 0xe6c56a][i], new V3(U.rand(-10, 10) + x * 0.3, U.rand(25, 40), U.rand(-10, 10) + (z + 10) * 0.3), 0.45);
      for (const a of AN.list) { a.state = 'flung'; a.vy = 20; a.vx = (a.x) * 0.4; a.vz = (a.z + 10) * 0.4; }
      for (let i = 0; i < TILES_TOTAL; i++) { W.tiles.c[i] = -1; W.tiles.s[i] = 0; } W.cropsDirty = true;
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(4, 8, 1, 12), new THREE.MeshLambertMaterial({ color: 0x8a7a6a, emissive: 0x6a2a10 })); g.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshLambertMaterial({ color: 0x9a8a7a, emissive: 0x8a3a10 })); g.add(cap);
      const fire = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true }));
      g.add(fire); g.position.set(0, 0, -10); c.cloud = { g, stem, cap, fire, t: 0 };
      FX.temp(g, 30, (t) => { const hh = Math.min(90, t * 14); stem.scale.set(1, hh, 1); stem.position.y = hh / 2; const cs = Math.min(30, 8 + t * 4); cap.scale.set(cs, cs * 0.55, cs); cap.position.y = hh + cs * 0.15; fire.scale.setScalar(Math.min(30, t * 25)); fire.material.opacity = U.clamp(1 - t / 4, 0, 1); if (Math.random() < 0.7) FX.emit(U.rand(-10, 10), hh, -10 + U.rand(-10, 10), U.rand(-3, 3), U.rand(0, 4), U.rand(-3, 3), 6, 14, 0x6a5a50, { grow: 1.5 }); });
    }
    if (c.boom) { W.tint(0xffa060, 0.4 * Math.max(0, 1 - (c.t - 4.5) / 10)); }
    if (c.t > 13 && !c.done) {
      c.done = true; UI.showStats(G.stats, G.isHost);
    }
  },
  board() { if (G.final && G.final.phase === 'evac') { P.boarded = true; this.request({ k: 'board' }); UI.toast('🚁 You\'re on board! Waiting for the others...'); } },

  // ---------------- interactables ----------------
  interactables() {
    const list = [];
    if (P.inBunker) { list.push({ pos: new V3(0, W.bunkerY + 1.5, 3.6), r: 3, label: () => 'Climb out of the bunker', act: () => { P.inBunker = false; AU.setMuffled(false); P.pos.set(-32, 0.4, -12.5); P.vel.set(0, 0, 0); } }); return list; }
    list.push({ pos: W.shopPos, r: 3.6, label: () => 'Open the shop', act: () => UI.openShop() });
    list.push({ pos: W.binPos, r: 3, label: () => P.packN ? `Ship ${P.packN} items (${U.money(Object.entries(P.pack).reduce((s, [k, n]) => s + itemValue(k) * n, 0) * G.priceMult)}${G.priceMult !== 1 ? ' ×' + G.priceMult : ''})` : `Shipping bin — ${G.binItems} items, ${U.money(G.bin)} tomorrow`, act: () => { if (!P.packN) return; this.request({ k: 'ship', items: P.takeAll() }); AU.play('coin'); } });
    list.push({ pos: W.bedPos, r: 2.8, label: () => G.hour() >= 16 || G.hour() < 6 ? 'Sleep until morning' : 'Bed (you can sleep after 16:00)', act: () => {
      if (!(G.hour() >= 16 || G.hour() < 6)) { UI.toast('You\'re not tired yet. Sleep after 16:00.'); return; }
      if (G.final) { UI.toast('No time to sleep — evacuate!'); return; }
      P.sleeping = true; this.request({ k: 'sleep', on: true });
    } });
    list.push({ pos: W.wellPos, r: 3, label: () => P.slot === 3 ? `Fill the watering can (${P.can}/${CAN_MAX()})` : `Well — hold the watering can (${K.keyName(S.d.keys.slot4)}) to fill it`, act: () => P.fillCan() });
    if (G.has('farm2')) list.push({ pos: W.hoopPos, r: 8, label: () => `Shoot a hoop${P.streak ? ` (${P.streak} in a row)` : ''}${P.hotT > 0 ? ` · 🔥 ${Math.ceil(P.hotT)}s` : ''}`, act: () => P.shoot() });
    if (G.has('bunker')) list.push({ pos: new V3(-32, 0.5, -14), r: 2.8, label: () => 'Enter the bunker', act: () => { P.inBunker = true; AU.setMuffled(true); P.pos.set(0, W.bunkerY + 0.1, 0); P.vel.set(0, 0, 0); AU.play('land'); } });
    if (this.heli && G.final && G.final.phase === 'evac' && !P.boarded) list.push({ pos: this.heli.position.clone().add(new V3(0, 1.5, 0)), r: 7, label: () => 'BOARD THE HELICOPTER', act: () => this.board() });
    return list.concat(AN.interactables());
  },

  // ---------------- remote avatars ----------------
  removeAvatar(id) { const a = this.avatars[id]; if (a) { W.scene.remove(a); delete this.avatars[id]; } },
  renderAvatars(dt) {
    for (const id in G.players) {
      if (id === G.myId) continue;
      const p = G.players[id]; if (p.x === undefined) continue;
      let a = this.avatars[id];
      if (!a || a.userData.color !== p.color || a.userData.name !== p.name) {
        this.removeAvatar(id);
        a = this.avatars[id] = M.farmer(p.color); a.userData.color = p.color; a.userData.name = p.name;
        const tag = M.nameTag(p.name, p.color); tag.position.y = 2.5; a.add(tag);
        a.position.set(p.x, p.y, p.z); W.scene.add(a);
      }
      const k = Math.min(1, dt * 12);
      const ox = a.position.x, oz = a.position.z;
      a.position.x = U.lerp(a.position.x, p.x, k); a.position.y = U.lerp(a.position.y, p.y, k); a.position.z = U.lerp(a.position.z, p.z, k);
      a.rotation.y = (p.yw || 0) + Math.PI;
      a.visible = !p.b && !p.bo;
      a.rotation.z = p.d ? Math.PI / 2 : 0; a.rotation.x = p.s ? -Math.PI / 2 : 0;
      a.scale.y = p.cr ? 0.7 : 1;
      const sp = Math.hypot(a.position.x - ox, a.position.z - oz) / Math.max(dt, 0.001);
      a.userData.ph = (a.userData.ph || 0) + dt * sp * 1.8;
      const sw = Math.min(1, sp / 4) * Math.sin(a.userData.ph) * 0.7;
      a.userData.legs[0].rotation.x = sw; a.userData.legs[1].rotation.x = -sw; a.userData.arms[0].rotation.x = -sw; a.userData.arms[1].rotation.x = sw;
    }
  },

  // ---------------- fire & hazards (every client) ----------------
  renderFire(dt) {
    const T = W.tiles; let near = 99, n = 0;
    for (let i = 0; i < TILES_TOTAL; i++) {
      if (T.f[i] <= 0) continue; n++;
      const p = W.tilePos(i);
      if (Math.random() < 0.6 * S.d.particles) H.ambientFire(p.x, p.z, 1);
      if (Math.random() < 0.1) FX.emit(p.x, 1, p.z, 0, 2, 0, 2, 1, 0x3a3434, { grow: 2 });
      const d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z); near = Math.min(near, d);
      if (d < 0.9 && P.pos.y < 1) P.hurt(25 * dt, 'burned alive');
    }
    if (n) AU.loop('fire', U.clamp(1 - near / 25, 0, 0.7));
  },
};

// ---------------- main loop ----------------
let last = performance.now(), fpsT = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsT += dt; fpsN++; if (fpsT > 0.5) { UI.fps(Math.round(fpsN / fpsT)); fpsT = 0; fpsN = 0; }
  const running = G.started && !(G.mode === 'solo' && G.paused);
  if (!running) dt = G.started ? 0 : dt;

  if (running) G.time += dt;
  W.computeEnv();
  FX.attractors.length = 0; FX.wind.set(0, 0, 0); W.windUniform.value = 0.4; W.waterLevel = -10;
  if (G.started) {
    EV.update(dt);
    if (G.isHost && running) { EV.hostSchedule(dt); AN.hostUpdate(dt); Game.hostUpdate(dt); }
    else if (!G.isHost) Game.grow(dt);
    P.update(dt);
    Game.renderFire(dt); Game.renderPickups(dt); Game.renderAvatars(dt); Game.updateFinalVisuals(dt);
    Game.netUpdate(dt);
  } else {
    // menu: slow orbit around the farm
    const t = now / 1000 * 0.05;
    W.camera.position.set(Math.cos(t) * 55, 22, -5 + Math.sin(t) * 55); W.camera.lookAt(0, 2, -8);
    AU.listener.x = W.camera.position.x; AU.listener.z = W.camera.position.z;
  }
  AN.render(dt);
  // ambience: birds by day, crickets at night
  const h = G.hour(), night = h < 5.5 || h > 20.5;
  // (night crickets are short chirps from around you; the old constant loop sounded like a beep)
  if (G.started) { if (night) { if (Math.random() < dt * 1.5) AU.play('cricket', { x: P.pos.x + U.rand(-25, 25), y: 0.3, z: P.pos.z + U.rand(-25, 25) }, 0.6); } else if (Math.random() < dt * 0.5) AU.play('chirp', { x: P.pos.x + U.rand(-30, 30), y: 8, z: P.pos.z + U.rand(-30, 30) }, 0.7); }
  FX.update(dt);
  W.update(dt);
  W.applyEnv(W.camera.position);
  AU.updateLoops();
  UI.update(dt);
  W.renderer.render(W.scene, W.camera);
  K.endFrame();
}
