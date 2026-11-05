// Game modes: Sandbox, Free-for-all and the Campaign. The host (or solo player) runs the real mode object;
// online guests run a GuestGame mirror that shows the HUD, the campaign map / shop and follows the host.
import * as THREE from 'three';
import { G, P, rand, pick, clamp, mulberry32, saveProfile, isHost, isGuest, isOnline } from './state.js';
import { spawnShip, despawnShip, SHIP_TYPES } from './ship.js';
import { ISLANDS } from './islands.js';
import { populateShip, spawnShark, spawnSharksNear, spawnCrate, clearSharks, rollLoot, updateStorage, destroyItem } from './entities.js';
import { Player } from './player.js';
import { makeAI, DIFF, Bot } from './ai.js';
import { kit, shipCfg, award, prog, level, unlocked } from './progression.js';
import { WEAPONS, PRIMARIES, gunState } from './weapons.js';
import { send, broadcast, NET, act } from './net.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';

const v1 = new THREE.Vector3();
const fmtT = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function openSpot(cx = 0, cz = 0, spread = 60, clear = 35) {
  let x = cx, z = cz;
  for (let i = 0; i < 60; i++) {
    x = cx + rand(-spread, spread); z = cz + rand(-spread, spread);
    if (Math.abs(x) > 380 || Math.abs(z) > 380) continue;
    if (!ISLANDS.some(isl => Math.hypot(isl.x - x, isl.z - z) < isl.r * 1.3 + clear) && !G.ships.some(s => !s.sunk && Math.hypot(s.x - x, s.z - z) < clear + 10)) break;
  }
  return { x, z };
}

// the humans in this game: me + everyone from the lobby (each with their own kit and colours)
export function humans() {
  const me = { id: G.net.id, name: P.name, colors: { hull: P.hull, trim: P.trim, sail: P.sail }, kits: null };
  return isOnline() ? G.lobby.players.map(p => p.id === G.net.id ? { ...p, ...me } : p) : [me];
}
function kitFor(h, mode) {
  if (!h.kits) { const k = kit(mode), cfg = shipCfg(mode, k.ship); return { ship: k.ship, ...cfg, gunTypes: [...(cfg.gunTypes || [])] }; }
  return h.kits[mode] || { ship: 'tug', guns: 0, armor: 0, pump: 0, engine: 0 };
}
export function kitShip(mode, opts = {}, h = humans()[0]) {
  const k = kitFor(h, mode);
  const s = spawnShip(k.ship, { team: 'player', guns: k.guns, gunTypes: k.gunTypes || [], armor: k.armor, pump: k.pump, engine: k.engine, colors: h.colors, name: `${h.name}'s ${SHIP_TYPES[k.ship].name.toLowerCase()}`, ...opts });
  populateShip(s); G.hookShip(s);
  return s;
}
// put a human on a ship (me directly, a guest through a message)
export function placeHuman(id, ship, lp = null) {
  lp = lp || ship.spawnSpot(0);
  if (id === G.net.id) { const me = G.me; me.leaveStation(); if (!me.alive) { me.alive = true; me.hp = 100; me.out = false; } me.home = ship; me.placeOn(ship, lp); }
  else send(id, { t: 'you', s: ship.id, lp: [lp.x, lp.y, lp.z] });
}
function newPlayer(mode, ship, team = 'player') {
  const me = new Player(kit(mode), P.name);
  me.team = team; me.home = ship;
  me.placeOn(ship, ship.spawnSpot(0));
  G.me = me; G.players = [me, ...G.players.filter(p => p.isRemote)];
  return me;
}

// ================= SANDBOX =================
export class Sandbox {
  constructor(o) { this.o = o; this.mode = 'sandbox'; this.label = 'Sandbox'; }
  start() {
    G.seaAmp = this.o.sea;
    G.admin.drops = true; G.dropT = 20;
    const hs = humans();
    const home = kitShip('sandbox', { x: 0, z: 0, yaw: rand(0, 6.28) }, hs[0]);
    newPlayer('sandbox', home);
    hs.slice(1).forEach((h, i) => placeHuman(h.id, home, home.spawnSpot(i + 1)));
    spawnSharksNear(this.o.sharks, home);
    if (this.o.enemies) setTimeout(() => G.running && G.game === this && G.spawnEnemy?.('tug'), 4000);
    G.announce(`🏝️ Sandbox! ${isOnline() ? 'The host' : 'You'} can open the admin panel.`, 'good');
  }
  respawnShip(p) {
    if (p.home && !p.home.sinking && !p.home.sunk && !p.home.gone) return p.home;
    const other = G.ships.find(s => s.team === 'player' && !s.sinking && !s.sunk);
    if (other) return (p.home = other);
    const at = openSpot(p.worldPos().x, p.worldPos().z, 70);
    p.home = kitShip('sandbox', { x: at.x, z: at.z, yaw: rand(0, 6.28) });
    G.announce('⛵ A new ship has arrived.');
    return p.home;
  }
  update() {}
  hud() { return ''; }
  netState() { return { mode: 'sandbox', hud: '' }; }
  onShipSunk(s) { if (s.lastHitBy?.isPlayer) sunkBy(s); }
}
function sunkBy(s) {
  const by = s.lastHitBy;
  if (by === G.me) { G.me.sunk++; G.toast(`🏴‍☠️ You sank the ${s.name}!`, 'good'); }
  else if (by?.isRemote) { send(by.id, { t: 'sunk', bid: by.id }); send(by.id, { t: 'toast', text: `🏴‍☠️ You sank the ${s.name}!`, kind: 'good' }); }
}

// ================= FREE-FOR-ALL =================
const RIVAL_NAMES = ['Blackwater', 'Saltbeard', 'One-Eye Moll', 'Barnacle Bob', 'Grim Hector', 'Stormy Kate', 'Rusty Finn'];
export class FFA {
  constructor(o) { this.o = o; this.mode = 'ffa'; this.label = 'Free-for-all'; }
  start() {
    G.seaAmp = this.o.sea;
    G.admin.drops = true; G.dropT = 15;
    this.t = 0; this.over = false;
    this.zone = { x: rand(-60, 60), z: rand(-60, 60), r: 380 };
    this.rivals = [];       // { name, id, bot|null, human: bool, ship, alive }
    const names = [...RIVAL_NAMES].sort(() => Math.random() - 0.5);
    const hs = humans(), nAI = this.o.rivals, R = 150;
    const lvl = level('ffa');
    for (const p of G.players) p.team = p.id;           // every human is on their own team
    if (this.o.layout === 'one') {
      const s = spawnShip('ferry', { team: 'neutral', x: this.zone.x, z: this.zone.z, yaw: 0, guns: 3, name: 'The Arena' });
      populateShip(s); G.hookShip(s);
      const spots = s.crewSpots(hs.length + nAI + 1);
      newPlayer('ffa', s, G.net.id).placeOn(s, spots[0]);
      hs.slice(1).forEach((h, i) => placeHuman(h.id, s, spots[i + 1]));
      for (const h of hs) this.rivals.push({ name: h.name, id: h.id, human: true, ship: s, alive: true });
      for (let i = 0; i < nAI; i++) {
        const view = Object.create(s);
        view.team = 'rival' + (i + 1);
        view.colors = { trim: ['#f0c419', '#62e0d0', '#ff8a3a'][i], hull: '#222', sail: '#fff' };
        const b = new Bot(view, spots[hs.length + i], { hp: 100, captain: true, name: names[i] });
        G.bots.push(b); G.netHook?.('spawn', 'bot', b);
        this.rivals.push({ name: names[i], bot: b, ship: s, alive: true });
      }
    } else {
      const total = hs.length + nAI, a0 = rand(0, 6.28);
      const at = n => { const a = a0 + n / total * Math.PI * 2; return { ...openSpot(this.zone.x + Math.cos(a) * R, this.zone.z + Math.sin(a) * R, 20, 25), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) }; };
      hs.forEach((h, n) => {
        const p = at(n);
        const s = kitShip('ffa', { team: h.id, x: p.x, z: p.z, yaw: p.yaw }, h);
        if (n === 0) newPlayer('ffa', s, h.id); else placeHuman(h.id, s);
        this.rivals.push({ name: h.name, id: h.id, human: true, ship: s, alive: true });
      });
      const types = lvl >= 12 ? ['trawler', 'ferry', 'cargo'] : lvl >= 5 ? ['tug', 'yacht', 'trawler'] : ['tug', 'tug', 'yacht'];
      for (let i = 0; i < nAI; i++) {
        const p = at(hs.length + i), key = pick(types);
        const s = spawnShip(key, { team: 'rival' + (i + 1), x: p.x, z: p.z, yaw: p.yaw, guns: Math.min(SHIP_TYPES[key].maxGuns, 1 + (lvl >= 4) + (lvl >= 9)), name: `${names[i]}'s ${SHIP_TYPES[key].name.toLowerCase()}` });
        populateShip(s); G.hookShip(s);
        const [cap] = makeAI(s, { crew: 0, captain: true, name: names[i] });
        this.rivals.push({ name: names[i], bot: cap, ship: s, alive: true });
      }
    }
    spawnSharksNear(6, G.me.frame);
    this.makeWall();
    this.stormT = 0;
    sfx.horn();
    G.announce(`⚔️ Free-for-all! ${this.rivals.length - 1} rival captain${this.rivals.length > 2 ? 's' : ''}. Last one standing wins.`, 'good');
  }
  makeWall() {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#2a1f3a', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    wall.position.set(this.zone.x, 30, this.zone.z);
    G.scene.add(wall); this.wall = wall;
  }
  alive() { return this.rivals.filter(r => r.alive).length; }
  update(dt) {
    if (this.over) { this.endT -= dt; if (this.endT <= 0 && !this.finished) { this.finished = true; ffaFinish(this.won, this.rivals, this.t); } return; }
    this.t += dt;
    const z = this.zone;
    if (this.t > 120) z.r = Math.max(60, 380 - (this.t - 120) / 150 * 320);
    this.wall.scale.set(z.r, 1, z.r);
    this.wall.material.opacity = 0.25 + 0.1 * Math.sin(G.t * 2);
    this.stormT -= dt;
    stormSelf(this, z);
    if (this.stormT <= 0) {
      this.stormT = 1;
      for (const s of G.ships) {
        if (s.sunk || Math.hypot(s.x - z.x, s.z - z.z) <= z.r || Math.random() > 0.3) continue;
        const p = s.toWorld(v1.set(rand(-s.hw, s.hw) * 0.6, s.deckTop, rand(-s.hl, s.hl) * 0.7));
        s.damageSphere(p, 1.2, 8, null, 0.5); FX.explosion(p.x, p.y, p.z, 0.8); FX.flash(p.x, p.y + 20, p.z, 30); sfx.thunder();
        G.netFx?.({ k: 'boom', p: [p.x, p.y, p.z], r: 0.8 });
      }
      for (const r of this.rivals) if (r.bot && r.alive && r.bot.alive) { const c = r.bot.center(v1); if (Math.hypot(c.x - z.x, c.z - z.z) > z.r) r.bot.hurt(5, null, 'storm'); }
    }
    if (this.alive() <= 1 || this.t > 330) {
      const last = this.rivals.find(r => r.alive);
      this.endRound(this.alive() === 1 ? last : null);
    }
  }
  onBotDeath(b) {
    const r = this.rivals.find(x => x.bot === b);
    if (!r || !r.alive) return;
    r.alive = false;
    if (r.ship.team !== 'neutral' && r.ship.ai) { r.ship.team = 'neutral'; r.ship.ai = null; r.ship.driver = null; }
    G.announce(`☠️ ${r.name} is out! ${this.alive()} left.`, 'warn');
  }
  onShipSunk(s) { if (s.lastHitBy?.isPlayer && s.team !== s.lastHitBy.team) sunkBy(s); }
  onDeath(p) {
    const r = this.rivals.find(x => x.id === p.id);
    if (p === G.me) p.out = true;
    if (r && r.alive) { r.alive = false; G.announce(`☠️ ${r.name} is out! ${this.alive()} left.`, 'warn'); }
  }
  respawnShip() { return null; }
  endRound(winner) {
    if (this.over) return;
    this.over = true; this.endT = 3;
    this.won = winner?.id === G.net.id;
    const text = winner ? `🏆 ${winner.name} is the last captain standing!` : '⏱️ Time is up!';
    G.announce(text, 'good');
    if (isHost()) broadcast({ t: 'ffaEnd', winner: winner?.id ?? null, time: this.t });
    if (this.won) sfx.levelup();
  }
  spectate(cam) { ffaSpectate(cam, this.rivals.find(x => x.alive)?.ship); }
  hudShared() {
    const left = Math.max(0, 330 - this.t);
    const shrink = this.t < 120 ? `Storm closes in ${Math.ceil(120 - this.t)}s` : 'The storm is closing in!';
    return `<b>⚔️ FFA</b> · ${fmtT(left)} · Captains left: <b>${this.alive()}</b><br><small>${shrink}</small>`;
  }
  hud() { return this.hudShared() + (this.outside ? '<div class="bad">⚡ You are in the storm! Get back inside!</div>' : ''); }
  netState() { return { mode: 'ffa', hud: this.hudShared(), zone: this.zone, t: this.t }; }
  end() { if (this.wall) G.scene.remove(this.wall); }
}
function stormSelf(game, z) {
  const me = G.me;
  if (!me?.alive) return;
  const p = me.worldPos(v1);
  game.outside = Math.hypot(p.x - z.x, p.z - z.z) > z.r;
  game.selfT = (game.selfT ?? 1) - G.dt;
  if (game.outside && game.selfT <= 0) { game.selfT = 1; me.hurt(5, null, 'storm'); }
}
function ffaSpectate(cam, s) {
  s = s || G.ships.find(x => !x.sunk);
  if (!s) return;
  const a = G.t * 0.15;
  cam.position.set(s.x + Math.sin(a) * (s.hl + 30), 18, s.z + Math.cos(a) * (s.hl + 30));
  cam.lookAt(s.x, 3, s.z);
}
// every client works out its own reward from its own kills
function ffaFinish(won, rivals, t) {
  const me = G.me;
  const rank = won ? 1 : (rivals ? rivals.filter(r => r.alive).length + 1 : 2);
  const ft = 20 + me.kills * 25 + me.sunk * 60 + (won ? 150 : 0);
  const xp = 30 + me.kills * 40 + me.sunk * 80 + (won ? 150 : 0);
  const res = award('ffa', xp, ft);
  G.showResults?.({ title: won ? '🏆 Victory!' : `Place #${rank}`, mode: 'ffa', lines: [`Kills: ${me.kills}`, `Ships sunk: ${me.sunk}`, `Time: ${fmtT(t)}`], ft, xp, ...res });
}

// ================= CAMPAIGN =================
export const DIFFS = {
  easy: { name: 'Easy', aim: 1.6, hp: 0.8, dmg: 0.7, extra: -1, reward: 0.6 },
  normal: { name: 'Normal', aim: 1, hp: 1, dmg: 1, extra: 0, reward: 1 },
  hard: { name: 'Hard', aim: 0.75, hp: 1.25, dmg: 1.3, extra: 1, reward: 1.6 },
  ferryman: { name: 'Ferryman', aim: 0.55, hp: 1.5, dmg: 1.6, extra: 1, reward: 2.4 },
};
export const NODE = {
  battle: { icon: '⚔️', name: 'Battle', desc: 'Sink every enemy ship.' },
  wreck: { icon: '⚓', name: 'Wreck', desc: 'Salvage 4 crates from a wreck site. Sharks!' },
  storm: { icon: '⛈️', name: 'Storm', desc: 'Survive 100 s of storm and lightning.' },
  shop: { icon: '🛒', name: 'Harbour shop', desc: 'Spend FT on repairs, planks and weapons.' },
  rest: { icon: '🏝️', name: 'Calm cove', desc: 'Free repairs (half the damage) and full health.' },
  boss: { icon: '💀', name: 'The Ferryman', desc: "The ghost liner that collects every sailor's token." },
};
function makeMap(seed) {
  const r = mulberry32(seed);
  const cols = [];
  const W = [['battle', 45], ['wreck', 18], ['storm', 14], ['shop', 13], ['rest', 10]];
  const roll = () => { let x = r() * 100; for (const [k, w] of W) if ((x -= w) < 0) return k; return 'battle'; };
  cols.push([{ type: 'battle' }]);
  for (let c = 1; c <= 5; c++) {
    const n = 2 + (r() < 0.5 ? 1 : 0);
    cols.push(Array.from({ length: n }, () => ({ type: c === 5 ? (r() < 0.6 ? 'shop' : 'rest') : roll() })));
  }
  cols.push([{ type: 'boss' }]);
  cols.forEach((col, c) => col.forEach((nd, i) => { nd.c = c; nd.i = i; nd.next = []; }));
  for (let c = 0; c < cols.length - 1; c++) {
    const a = cols[c], b = cols[c + 1];
    a.forEach((nd, i) => {
      const t = Math.round(i / Math.max(1, a.length - 1) * (b.length - 1));
      nd.next.push(t);
      if (r() < 0.55 && b.length > 1) nd.next.push(clamp(t + (r() < 0.5 ? -1 : 1), 0, b.length - 1));
      nd.next = [...new Set(nd.next)];
    });
    b.forEach((nd, j) => { if (!a.some(x => x.next.includes(j))) a[Math.min(a.length - 1, j)].next.push(j); });
  }
  return cols;
}
export const reachableOf = (map, cur) => !cur ? map[0].map((_, i) => i) : map[cur.c][cur.i].next;

// ship-wide shop items (run on the host); personal ones run on each player's own client
export const DOCK_SHOP = [
  { id: 'dock', name: 'Dock repair: fixes most of the damage, pumps the water out, fixes the engine', price: 10 },
];
export const SHIP_SHOP = [
  { id: 'repair', name: '🔧 Full repair + pump (ship)', price: 150 },
  { id: 'planks', name: '🪵 +6 planks (ship)', price: 50 },
  { id: 'refit', name: '💥 Refit: +1 gun pair (ship, this run, full repair)', price: 300 },
];
export function personalShop(me) {
  const items = [
    { id: 'ammo', name: '🔫 Ammo refill', price: 40, ok: () => true, buy: () => { for (const k of ['primary', 'secondary']) { const g = me.inv[k]; g.reserve = WEAPONS[g.id].reserve; g.mag = g.magMax; } if (me.inv.gadget) me.inv.gadget.count = WEAPONS[me.inv.gadget.id].count; } },
    { id: 'heal', name: '❤️ Patch up (full health)', price: 0, ok: () => me.hp < 100, buy: () => { me.hp = 100; } },
  ];
  for (const w of PRIMARIES) if (unlocked('camp', w) && me.inv.primary.id !== w) items.push({ id: 'w-' + w, name: `🎁 ${WEAPONS[w].name} (this run)`, price: 150, ok: () => true, buy: () => { me.inv.primary = gunState(w, kit('camp').att[w] || {}); me.slot = 'primary'; } });
  return items;
}
export function campReward(r) {
  const res = award('camp', r.xp, r.ft);
  G.toast(`${r.msg} +${r.ft} FT, +${r.xp} XP`, 'good'); sfx.coin();
  if (res.levels.length) { sfx.levelup(); G.toast(`⭐ Campaign level ${res.levels.at(-1)}!${res.unlocks.length ? ' Unlocked: ' + res.unlocks.join(', ') : ''}`, 'good'); }
  return res;
}

export class Campaign {
  constructor(o) { this.o = o; this.mode = 'camp'; this.label = 'Campaign'; }
  start() {
    const d = DIFFS[this.o.diff];
    Object.assign(DIFF, { aim: d.aim, hp: d.hp, dmg: d.dmg });
    this.d = d;
    this.map = makeMap(Math.random() * 1e9 | 0);
    this.cur = null; this.phase = 'map'; this.votes = {};
    this.earned = 0; this.nodesDone = 0;
    G.seaAmp = 1; G.admin.drops = false;
    const sp = openSpot(0, 0, 100);
    const hs = humans();
    this.ship = kitShip('camp', { x: sp.x, z: sp.z, yaw: rand(0, 6.28) }, hs[0]);
    this.ship.storage.planks = this.o.diff === 'ferryman' ? 4 : 6;
    newPlayer('camp', this.ship);
    hs.slice(1).forEach((h, i) => placeHuman(h.id, this.ship, this.ship.spawnSpot(i + 1)));
    G.announce(`🧭 Campaign (${d.name}, ×${d.reward} FT). Choose your route on the map${isOnline() ? ' (everyone votes)' : ''}.`, 'good');
    this.showMap();
  }
  reachable() { return reachableOf(this.map, this.cur); }
  mapState() { return { map: this.map, cur: this.cur, votes: this.votes, d: this.d.name, hull: this.ship.stats().hull, flood: this.ship.flood, planks: this.ship.storage.planks }; }
  showMap() {
    this.phase = 'map'; this.ship.throttle = 0; this.votes = {};
    G.unlock?.();
    G.ui?.campaignMap(this.mapState(), true);
    if (isHost()) broadcast({ t: 'cmap', ...this.mapState() });
  }
  vote(pid, i) {
    if (this.phase !== 'map' || !this.reachable().includes(i)) return;
    this.votes[pid] = i;
    const hs = humans();
    if (isHost()) broadcast({ t: 'cvote', votes: this.votes });
    G.ui?.campaignVotes(this.votes);
    if (hs.every(h => this.votes[h.id] != null)) this.decide();
  }
  decide() {
    const tally = {};
    for (const v of Object.values(this.votes)) tally[v] = (tally[v] || 0) + 1;
    let best = this.votes[G.net.id] ?? +Object.keys(tally)[0], bc = -1;
    for (const [k, c] of Object.entries(tally)) if (c > bc || (c === bc && +k === this.votes[G.net.id])) { bc = c; best = +k; }
    if (best == null || isNaN(best)) return;
    this.choose(best);
  }
  choose(i) {
    const c = this.cur ? this.cur.c + 1 : 0;
    const node = this.map[c][i];
    this.cur = { c, i }; this.node = node;
    G.ui?.closeOverlay();
    if (isHost()) broadcast({ t: 'cclose' });
    if (node.type === 'shop') {
      this.phase = 'shop';
      G.ui?.campaignShop(this, true);
      if (isHost()) broadcast({ t: 'cshop' });
      return;
    }
    if (node.type === 'rest') {
      this.ship.repairFraction(0.5); this.ship.pumpAll(); G.me.hp = 100;
      this.reward(40, 30, 'Calm cove: half of the damage repaired, water pumped out. Everyone is healed.', true);
      return this.showMap();
    }
    this.startEncounter(node);
  }
  clearArea() {
    for (const s of [...G.ships]) if (s !== this.ship) despawnShip(s);
    for (const b of G.bots) { b.mesh.parent?.remove(b.mesh); G.netHook?.('despawn', 'bot', b); }
    G.bots = [];
    for (const c of G.crates) { c.mesh.parent?.remove(c.mesh); G.netHook?.('despawn', 'crate', c); }
    G.crates = [];
    for (const it of [...G.items]) if (!it.ship && !it.holder) destroyItem(it);
    for (const s of G.sharks) G.netHook?.('despawn', 'shark', s);
    clearSharks();
  }
  startEncounter(node) {
    this.phase = 'sail';
    this.clearArea();
    G.seaAmp = node.type === 'storm' ? 2.2 : 1;
    const sp = openSpot(0, 0, 250, 60);
    const s = this.ship;
    s.x = sp.x; s.z = sp.z; s.speed = 0; s.throttle = 0;
    s.updateMatrices();
    const depth = node.c;
    this.enc = { type: node.type, t: 0, done: false, goal: 0, got: 0, enemies: [] };
    humans().forEach((h, i) => { if (h.id !== G.net.id || G.me.frame !== s || !G.me.alive) placeHuman(h.id, s, s.spawnSpot(i)); });
    s.anchor.state = 'up'; s.kx = s.kz = s.side = 0;
    const ring = dist => { const a = rand(0, 6.28); return openSpot(s.x + Math.cos(a) * dist, s.z + Math.sin(a) * dist, 30, 30); };
    const crewBonus = isOnline() ? humans().length - 1 : 0;
    const enemy = (key, extra = {}) => {
      const p = ring(rand(130, 170));
      const e = spawnShip(key, { team: 'enemy', x: p.x, z: p.z, yaw: Math.atan2(s.x - p.x, s.z - p.z), guns: Math.min(SHIP_TYPES[key].maxGuns, 1 + Math.floor(depth / 2) + (crewBonus > 1 ? 1 : 0)), armor: Math.floor(depth / 3), name: extra.name || 'Raider ' + SHIP_TYPES[key].name.toLowerCase(), ...extra });
      populateShip(e); G.hookShip(e); makeAI(e, { crew: SHIP_TYPES[key].crew + (extra.ghost ? 2 : 0) + crewBonus, hp: extra.ghost ? 80 : 60 });
      this.enc.enemies.push(e);
      return e;
    };
    if (node.type === 'battle') {
      const n = clamp(1 + Math.floor(depth / 2) + this.d.extra + (crewBonus >= 2 ? 1 : 0), 1, 5);
      const pool = depth < 2 ? ['tug', 'yacht'] : depth < 4 ? ['yacht', 'trawler'] : ['trawler', 'ferry', 'cargo'];
      for (let i = 0; i < n; i++) enemy(pick(pool));
      G.announce(`⚔️ ${n} enemy ship${n > 1 ? 's' : ''} on the horizon!`, 'bad');
    } else if (node.type === 'wreck') {
      const c = ring(60);
      this.enc.goal = 4 + crewBonus;
      for (let i = 0; i < 8 + crewBonus * 2; i++) { const cr = spawnCrate(new THREE.Vector3(c.x + rand(-25, 25), 0, c.z + rand(-25, 25)), rollLoot(), false); cr.state = 'float'; }
      for (let i = 0; i < 5 + depth; i++) spawnShark(c.x + rand(-40, 40), c.z + rand(-40, 40));
      if (depth >= 3) enemy('tug');
      G.announce(`⚓ A wreck! Grab ${this.enc.goal} crates (by hand or with the crane). Watch the sharks.`, 'warn');
    } else if (node.type === 'storm') {
      this.enc.goal = 100;
      if (depth >= 2) setTimeout(() => this.enc && !this.enc.done && enemy('tug'), 40000);
      G.announce('⛈️ Storm! Survive 100 seconds. Lightning starts fires: bring buckets.', 'warn');
    } else if (node.type === 'boss') {
      enemy('cruise', { ghost: true, hpMult: 2 * this.d.hp, guns: 5, name: "The Ferryman's liner" });
      enemy('yacht', { ghost: true, name: 'Ghost yacht' }); enemy('yacht', { ghost: true, name: 'Ghost yacht' });
      G.seaAmp = 1.4;
      sfx.horn();
      G.announce('💀 The Ferryman has come to collect your token...', 'bad');
    }
    spawnSharksNear(3, s);
    G.lock?.();
  }
  update(dt) {
    const e = this.enc;
    if (this.phase !== 'sail' || !e || e.done) return;
    e.t += dt;
    if (e.type === 'battle' || e.type === 'boss') { if (e.enemies.every(s => s.sinking || s.sunk)) this.complete(); }
    else if (e.type === 'wreck') { if (e.got >= e.goal) this.complete(); }
    else if (e.type === 'storm') {
      e.strike = (e.strike ?? 6) - dt;
      if (e.strike <= 0) {
        e.strike = rand(5, 9);
        const s = this.ship;
        const p = s.toWorld(v1.set(rand(-s.hw, s.hw) * 0.6, s.deckTop + 0.5, rand(-s.hl, s.hl) * 0.7));
        s.damageSphere(p, 1.0, 6, null, 0.9);
        FX.explosion(p.x, p.y, p.z, 0.7); FX.flash(p.x, p.y + 30, p.z, 40); G.flashScreen = 0.25; sfx.thunder();
        G.netFx?.({ k: 'boom', p: [p.x, p.y, p.z], r: 0.7 });
      }
      if (e.t >= e.goal) this.complete();
    }
  }
  onCrateOpened() { if (this.enc?.type === 'wreck') { this.enc.got++; G.announce(`📦 Salvage ${this.enc.got}/${this.enc.goal}`); } }
  complete() {
    const e = this.enc;
    e.done = true;
    const depth = this.node.c;
    const base = { battle: 70 + 20 * depth, wreck: 60 + 15 * depth, storm: 80 + 15 * depth, boss: 500 }[e.type];
    const xp = { battle: 90, wreck: 70, storm: 80, boss: 400 }[e.type] + depth * 10;
    if (e.type === 'boss') {
      const ft = Math.round(base * this.d.reward);
      this.earned += ft; this.over = true;
      const r = { title: '🏆 The Ferryman is defeated!', mode: 'camp', lines: [`Difficulty: ${this.d.name}`, `Stops cleared: ${this.nodesDone + 1}`, `FT earned this run: ${this.earned}`], ft, xp: Math.round(xp * this.d.reward) };
      if (isHost()) broadcast({ t: 'cres', r });
      campResults(r);
      return;
    }
    this.reward(base, xp, `${NODE[e.type].icon} ${NODE[e.type].name} cleared!`);
    setTimeout(() => { if (G.game === this && !this.over) this.showDock(); }, 3500);
  }
  // after a fight: a small dock. 2 free planks, and a cheap repair for 10 FT.
  showDock() {
    this.phase = 'dock'; this.ship.throttle = 0;
    const st = this.ship.storage;
    st.planks = Math.min(12, st.planks + 2); updateStorage(this.ship);
    G.unlock?.();
    G.ui?.campaignDock(this, true);
    if (isHost()) broadcast({ t: 'cdock' });
  }
  leaveDock() { G.ui?.closeOverlay(); this.showMap(); }
  reward(ft, xp, msg, heal = false) {
    ft = Math.round(ft * this.d.reward); xp = Math.round(xp * this.d.reward);
    this.earned += ft; this.nodesDone++;
    campReward({ ft, xp, msg });
    if (isHost()) broadcast({ t: 'creward', ft, xp, msg, heal });
  }
  onShipSunk(s) {
    if (s === this.ship && !this.over) {
      this.over = true;
      const r = { title: '🌊 Your ship went down', mode: 'camp', lines: [`Difficulty: ${this.d.name}`, `Stops cleared: ${this.nodesDone}`, `FT earned this run: ${this.earned}`], ft: 0, xp: 0, lost: true };
      setTimeout(() => { if (isHost()) broadcast({ t: 'cres', r }); campResults(r); }, 3000);
    } else if (s.lastHitBy?.isPlayer) sunkBy(s);
  }
  onDeath() {}
  respawnShip() { return this.ship.sunk ? null : this.ship; }
  hud() {
    const e = this.enc, n = this.node;
    if (this.phase !== 'sail' || !e) return `<b>🧭 Campaign</b> · ${this.d.name}`;
    let goal = '';
    if (e.type === 'battle' || e.type === 'boss') goal = `Enemy ships left: <b>${e.enemies.filter(s => !s.sinking && !s.sunk).length}</b>`;
    if (e.type === 'wreck') goal = `Salvage: <b>${e.got}/${e.goal}</b>`;
    if (e.type === 'storm') goal = `Survive: <b>${Math.max(0, Math.ceil(e.goal - e.t))}s</b>`;
    return `<b>${NODE[n.type].icon} ${NODE[n.type].name}</b> · stop ${n.c + 1}/7<br>${e.done ? '✅ Cleared! Back to the map…' : goal}`;
  }
  netState() { return { mode: 'camp', hud: this.hud(), ship: this.ship.id }; }
  // ship-wide purchase (anyone can pay, the host applies it)
  shipBuy(id) {
    const s = this.ship;
    if (id === 'repair') { s.repairAll(); s.pumpAll(); return true; }
    if (id === 'dock') { if (this.docked === this.nodesDone) return false; this.docked = this.nodesDone; s.repairFraction(0.6); s.pumpAll(); s.engineHp = 100; s.fires.length = 0; return true; }
    if (id === 'planks') { if (s.storage.planks >= 12) return false; s.storage.planks = Math.min(12, s.storage.planks + 6); updateStorage(s); return true; }
    if (id === 'refit') { if (s.guns >= s.def.maxGuns) return false; this.refit(s.guns + 1); return true; }
    return false;
  }
  refit(guns) {
    const old = this.ship, cfg = shipCfg('camp', old.key);
    const s = spawnShip(old.key, { team: 'player', guns, gunTypes: [...old.gunTypes, ...(cfg.gunTypes || []).slice(old.gunTypes.length)], armor: cfg.armor, pump: cfg.pump, engine: cfg.engine, x: old.x, z: old.z, yaw: old.yaw, name: old.name, colors: old.colors });
    populateShip(s); G.hookShip(s);
    s.storage.planks = old.storage.planks;
    for (const it of [...G.items]) if (it.ship === old) destroyItem(it);
    despawnShip(old);
    this.ship = s;
    humans().forEach((h, i) => placeHuman(h.id, s, s.spawnSpot(i)));
  }
  leaveShop() { G.ui?.closeOverlay(); this.reward(0, 10, '🛒 Harbour visited.'); this.showMap(); }
  end() { Object.assign(DIFF, { aim: 1, hp: 1, dmg: 1 }); }
}
function campResults(r) {
  const res = r.ft || r.xp ? award('camp', r.xp, r.ft) : { levels: [], unlocks: [] };
  G.showResults?.({ ...r, ...res });
}

// ================= GUEST MIRROR =================
// Guests do not run the rules: they show what the host sends and handle their own player.
export class GuestGame {
  constructor(mode, o) { this.mode = mode; this.o = o; this.state = {}; this.label = mode; }
  start() { }
  netApply(st) {
    this.state = st;
    if (st.zone) {
      this.zone = st.zone;
      if (!this.wall) { this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#2a1f3a', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); G.scene.add(this.wall); }
      this.wall.position.set(st.zone.x, 30, st.zone.z); this.wall.scale.set(st.zone.r, 1, st.zone.r);
    }
  }
  update() { if (this.mode === 'ffa' && this.zone && !this.ended) stormSelf(this, this.zone); }
  hud() { return (this.state.hud || '') + (this.outside ? '<div class="bad">⚡ You are in the storm! Get back inside!</div>' : ''); }
  respawnShip(p) {
    if (this.mode === 'ffa') return null;
    const id = this.state.ship;
    const s = id ? G.ships.find(x => x.id === id) : null;
    return s && !s.sunk ? s : (p.home && !p.home.sunk && !p.home.gone ? p.home : G.ships.find(x => x.team === 'player' && !x.sunk));
  }
  onDeath(p) { if (this.mode === 'ffa') p.out = true; }
  spectate(cam) { ffaSpectate(cam, G.ships.find(s => !s.sunk && s.team !== 'neutral')); }
  ffaEnd(m) { this.ended = true; const won = m.winner === G.net.id; if (won) sfx.levelup(); setTimeout(() => ffaFinish(won, null, m.time), 3000); }
  vote(i) { act('vote', i); }
  end() { if (this.wall) G.scene.remove(this.wall); }
}
export { isGuest, NET, campResults };
