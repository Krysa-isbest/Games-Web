// Online play. The host runs the whole world (ships, AI, sharks, crates, items, damage) and sends it to the
// guests ~15 times a second plus every voxel change. Every client moves its own player and tells the others.
// Guests ask the host to do things (take the helm, open a crate, repair...) with act().
import * as THREE from 'three';
import { G, P, S, isGuest, isHost, isOnline, rand } from './state.js';
import { NET, on, send, broadcast, act } from './net.js';
import { spawnShip, PLANK_FIX, FURN_K } from './ship.js';
import { makeItem, destroyItem, placeMesh, holdItem, setBucket, spawnCrate, removeCrate, placeCrate, spawnShark, updateStorage, hookCrate, releaseCrate, crateWorld, ITEMS, raySphere } from './entities.js';
import { Bot } from './ai.js';
import { addProjectile, fireCannon, explode, placeC4, detonateC4, armNuke, nukeVisual, nukeBoomVisual, NUKE_R } from './weapons.js';
import { FX } from './fx.js';
import { sfx } from './sfx.js';
import { talking } from './voice.js';
import { kit, shipCfg } from './progression.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
export const LOBBY = { players: [], mode: 'ffa', opts: {} };
const r2 = x => Math.round(x * 100) / 100;

// ---------- who is who ----------
export const byId = {
  ship: id => G.ships.find(s => s.id === id),
  item: id => G.items.find(i => i.id === id),
  crate: id => G.crates.find(c => c.id === id),
  bot: id => G.bots.find(b => b.id === id),
  shark: id => G.sharks.find(s => s.id === id),
  player: id => G.players.find(p => p.id === id),
};

// ---------- remote players ----------
const skin = new THREE.MeshStandardMaterial({ color: '#c99a74', roughness: 0.8 });
const pants = new THREE.MeshStandardMaterial({ color: '#2b2d33', roughness: 0.9 });
const gunM = new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.4 });
function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px Rajdhani, Segoe UI, sans-serif'; x.textAlign = 'center';
  x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, 8, 256, 48);
  x.fillStyle = color; x.fillText(text, 128, 44);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(1.6, 0.4, 1); sp.renderOrder = 10;
  return sp;
}
export class Avatar {
  constructor(id, info) {
    this.id = id; this.name = info.name || 'Sailor'; this.isPlayer = true; this.isRemote = true;
    this.alive = true; this.hp = 100; this.team = 'player';
    this.frame = null; this.pos = new THREE.Vector3(); this.tpos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.inSea = false; this.underwater = false; this.swimming = false; this.mode = 'walk'; this.talk = false; this.kills = 0; this.sunk = 0;
    const shirt = new THREE.MeshStandardMaterial({ color: info.shirt || '#2f6fb3', roughness: 0.85 });
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(0.5, 0.62, 0.3), shirt, 0, 1.12, 0);
    this.legL = add(new THREE.BoxGeometry(0.2, 0.8, 0.24), pants, -0.13, 0.4, 0);
    this.legR = add(new THREE.BoxGeometry(0.2, 0.8, 0.24), pants, 0.13, 0.4, 0);
    this.head = add(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin, 0, 1.62, 0);
    for (const s of [-1, 1]) { const a = add(new THREE.BoxGeometry(0.14, 0.55, 0.14), shirt, s * 0.32, 1.15, 0.14); a.rotation.x = -1.1; }
    this.hand = new THREE.Group(); this.hand.position.set(0, 1.15, 0.45); g.add(this.hand);
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.6), gunM); this.gun.position.set(0.12, 0, 0); this.hand.add(this.gun);
    this.tag = nameTag(this.name, info.shirt || '#fff'); this.tag.position.y = 2.15; g.add(this.tag);
    this.mic = nameTag('🎙️', '#3fd47a'); this.mic.scale.set(0.8, 0.2, 1); this.mic.position.y = 2.45; this.mic.visible = false; g.add(this.mic);
    this.mesh = g;
    G.scene.add(g);
  }
  worldPos(out = new THREE.Vector3()) { out.copy(this.pos); return this.frame ? this.frame.toWorld(out) : out; }
  eyeWorld(out = new THREE.Vector3()) { out.copy(this.pos); out.y += 1.6; return this.frame ? this.frame.toWorld(out) : out; }
  center(out = new THREE.Vector3()) { out.copy(this.pos); out.y += 1.0; return this.frame ? this.frame.toWorld(out) : out; }
  worldYaw() { return this.yaw + (this.frame ? this.frame.yaw : 0); }
  forwardLocal(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  stationShip() { return this.frame; }
  hitTest(o, d, max) {
    if (!this.alive) return null;
    const c = this.center(v1);
    const t = raySphere(o, d, c, 0.45), h = raySphere(o, d, v2.copy(c).add(new THREE.Vector3(0, 0.62, 0)), 0.22);
    if (h != null && h <= max && (t == null || h < t)) return { dist: h, head: true };
    return t != null && t <= max ? { dist: t } : null;
  }
  hurt(amount, by, kind, from) {
    if (!this.alive) return;
    if (by?.isPlayer && !G.ff && by !== this) return;
    if (isHost()) send(this.id, { t: 'dmg', amount, by: by?.id ?? null, byBot: !!by?.isBot, kind, from: from ? [from.x, from.y, from.z] : null });
    else G.netHit('player', this.id, amount, kind);
  }
  apply(ps) {
    const ship = ps.s ? byId.ship(ps.s) : null;
    if (ship !== this.frame) { this.frame = ship; this.pos.fromArray(ps.p); (ship ? ship.group : G.scene).add(this.mesh); }
    this.tpos.fromArray(ps.p); this.yaw = ps.yaw; this.pitch = ps.pitch;
    this.mode = ps.mode; this.alive = ps.alive; this.hp = ps.hp; this.inSea = ps.sea; this.underwater = ps.uw; this.swimming = ps.sw; this.talk = ps.talk;
    this.mesh.visible = ps.alive;
    this.gun.visible = !ps.hold;
    this.lastPs = ps;
  }
  update(dt) {
    const k = Math.min(1, dt * 12);
    if (this.pos.distanceTo(this.tpos) > 6) this.pos.copy(this.tpos); else this.pos.lerp(this.tpos, k);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw + Math.PI;
    this.head.rotation.x = -this.pitch * 0.6;
    this.hand.rotation.x = -this.pitch;
    const moving = this.pos.distanceToSquared(this.tpos) > 0.0004;
    const sw = moving ? Math.sin(G.t * 10) * 0.5 : 0;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.mic.visible = this.talk;
    this.mesh.rotation.x = this.swimming ? -1.2 : 0;
  }
  remove() { this.mesh.parent?.remove(this.mesh); }
}

// ---------- hooks used by the game code ----------
export function installHooks() {
  G.netHook = (what, kind, o) => {
    if (!isHost() || !G.running) return;
    if (what === 'spawn') broadcast({ t: 'spawn', k: kind, d: spawnData(kind, o) });
    else broadcast({ t: 'despawn', k: kind, id: o.id });
  };
  G.netFx = fx => { if (isOnline() && G.running) send('*', { t: 'fx', ...fx }); };
  G.netHit = (kind, id, amount, extra) => act('hit', kind, id, amount, extra);
  G.netAct = (name, ...a) => act(name, ...a);
  G.announceKill = announceKill;
  G.announce = (text, kind = '') => { G.toast(text, kind); if (isHost()) broadcast({ t: 'toast', text, kind }); };
}
function spawnData(kind, o) {
  const V = p => p ? [r2(p.x), r2(p.y), r2(p.z)] : null;
  if (kind === 'ship') return o.netSpawn();
  if (kind === 'item') return { id: o.id, kind: o.kind, s: o.ship?.id ?? null, p: V(o.ship ? o.lp : o.wp), r: o.rotY != null ? r2(o.rotY) : null };
  if (kind === 'crate') return { id: o.id, loot: o.loot, p: V(o.wp), chute: o.chute, state: o.state };
  if (kind === 'shark') return { id: o.id, p: V(o.pos) };
  if (kind === 'bot') return { id: o.id, s: o.ship.id, lp: V(o.lp), hp: o.hp, captain: o.captain, name: o.name, team: o.team, colors: o.ship.colors };
  if (kind === 'c4') return { id: o.id, s: o.ship?.id ?? null, p: V(o.ship ? o.lp : o.wp) };
  return {};
}

// ---------- host side ----------
let snapT = 0, psT = 0;
const HUMAN = () => G.players.filter(p => p.isPlayer);
export function hostTick(dt) {
  if (G.voxOut.length) { broadcast({ t: 'vox', d: G.voxOut }); G.voxOut = []; }
  snapT -= dt;
  if (snapT > 0) return;
  snapT = 1 / 15;
  const V = p => [r2(p.x), r2(p.y), r2(p.z)];
  broadcast({
    t: 'snap', time: r2(G.t), sea: G.seaAmp, adm: G.admin.everyone,
    ships: G.ships.filter(s => !s.gone).map(s => s.netState()),
    bots: G.bots.map(b => [b.id, b.alive ? 1 : 0, r2(b.mesh.rotation.y)]),
    sharks: G.sharks.map(s => [s.id, r2(s.pos.x), r2(s.pos.z), r2(s.yaw), r2(s.speed), s.stunT > 0 ? 1 : 0]),
    crates: G.crates.map(c => [c.id, c.state, c.state === 'deck' ? c.ship?.id : null, V(c.state === 'deck' && c.ship ? c.lp : c.wp)]),
    items: G.items.map(i => [i.id, i.ship?.id ?? null, i.holder ? null : V(i.ship ? i.lp : i.wp), i.holder?.id ?? null, i.full ? 1 : 0]),
    game: G.game?.netState?.() ?? null,
  });
}
// my own player -> everyone (host and guests)
export function sendMyState(dt) {
  psT -= dt;
  const me = G.me;
  if (psT > 0 || !me) return;
  psT = 1 / 15;
  const ps = { t: 'ps', id: G.net.id, s: me.frame?.id ?? null, p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], yaw: r2(me.yaw), pitch: r2(me.pitch), mode: me.mode, alive: me.alive, hp: Math.round(me.hp), sea: me.inSea, uw: me.underwater, sw: me.swimming, talk: talking(), hold: me.holding?.id ?? null };
  if (me.mode === 'wheel' && me.station) { const s = me.station; ps.drive = [s.id, r2(s.throttle), r2(s.rudderIn)]; }
  if (me.mode === 'crane' && me.station) { const s = me.station, c = s.crane; ps.crane = [s.id, r2(c.yaw), r2(c.reach), r2(c.drop)]; }
  if (me.mode === 'cannon') { const { ship, c } = me.station; ps.gun = [ship.id, ship.cannons.indexOf(c), r2(c.yaw), r2(c.pitch)]; }
  send('*', ps);
}

// actions guests can ask the host to do
function avatarOf(pid) { return pid === G.net.id ? G.me : byId.player(pid); }
export function installActions() {
  const A = NET.actions;
  A.hit = (pid, kind, id, amount, extra) => {
    const by = avatarOf(pid);
    if (kind === 'cell') { const s = byId.ship(id); if (s) s.damageCell(amount, extra, by); }
    else if (kind === 'player') {
      if (!G.ff) return;
      if (id === G.net.id) G.me.hurt(amount, by, extra || 'bullet'); else send(id, { t: 'dmg', amount, by: pid, kind: extra || 'bullet' });
    } else if (kind === 'bot') byId.bot(id)?.hurt(amount, by, extra || 'bullet');
    else if (kind === 'shark') byId.shark(id)?.hurt(amount, by);
  };
  A.helm = (pid, sid, take) => {
    const s = byId.ship(sid), who = avatarOf(pid);
    if (!s) return false;
    if (take) { if (s.driver && s.driver.alive && s.driver !== who) return false; s.driver = who; return true; }
    if (s.driver === who) { s.driver = null; s.rudderIn = 0; }
    return true;
  };
  A.crane = (pid, sid, take) => {
    const s = byId.ship(sid), who = avatarOf(pid);
    if (!s) return false;
    if (take) { if (s.crane.user && s.crane.user !== who && s.crane.user.alive !== false) return false; s.crane.user = who; return true; }
    if (s.crane.user === who) s.crane.user = null;
    return true;
  };
  A.anchor = (pid, sid) => byId.ship(sid)?.toggleAnchor() ?? false;
  A.hammerCell = (pid, sid, n) => { const s = byId.ship(sid); if (!s || !s.orig[n]) return false; const ok = s.restoreCell(n); if (ok) { const [i, j, k] = s.ijk(n); sfx.knock(s.toWorld(v1.set(s.xOf(i), s.yOf(j), s.zOf(k)))); } return ok; };
  A.fixEngine = (pid, sid, amount) => { const s = byId.ship(sid); if (!s) return false; s.repairEngine(Math.min(20, Math.max(0, amount))); return true; };
  A.cannon = (pid, sid, ci, take) => {
    const c = byId.ship(sid)?.cannons[ci], who = avatarOf(pid);
    if (!c) return false;
    if (take) { if (c.user && c.user !== who) return false; c.user = who; return true; }
    if (c.user === who) c.user = null;
    return true;
  };
  A.fireCannon = (pid, sid, ci, yaw, pitch, mul) => {
    const s = byId.ship(sid), c = s?.cannons[ci];
    if (!c) return false;
    c.yaw = yaw; c.pitch = pitch;
    return fireCannon(s, c, avatarOf(pid), mul);
  };
  A.grab = (pid, sid) => {
    const s = byId.ship(sid);
    if (!s) return null;
    const cr = s.crane;
    if (cr.held) { releaseCrate(cr.held); cr.held = null; return 'released'; }
    const hk = s.hookWorld(v1);
    const near = G.crates.find(c => c.state !== 'fall' && c.state !== 'hook' && crateWorld(c, v2).distanceTo(hk) < 1.8);
    if (near) { hookCrate(near, s); cr.held = near; return 'grabbed'; }
    return null;
  };
  A.openCrate = (pid, cid) => {
    const c = byId.crate(cid);
    if (!c) return null;
    removeCrate(c);
    G.game?.onCrateOpened?.(c);
    if (c.loot === 'planks') { const who = avatarOf(pid), s = who.frame || G.ships.find(x => x.team === 'player'); if (s?.storage) { s.storage.planks = Math.min(12, s.storage.planks + 3); updateStorage(s); } }
    return c.loot;
  };
  A.takePlank = (pid, sid) => {
    const s = byId.ship(sid);
    if (!s?.storage || s.storage.planks <= 0) return null;
    s.storage.planks--; updateStorage(s);
    const it = makeItem('plank', null, new THREE.Vector3(0, -50, 0));
    holdItem(it, avatarOf(pid));
    return it.id;
  };
  A.returnPlank = (pid, sid, iid) => { const s = byId.ship(sid), it = byId.item(iid); if (it) destroyItem(it); if (s?.storage) { s.storage.planks++; updateStorage(s); } return true; };
  A.pickItem = (pid, iid) => { const it = byId.item(iid); if (!it || it.holder) return false; holdItem(it, avatarOf(pid)); return true; };
  A.dropItem = (pid, iid, sid, p) => {
    const it = byId.item(iid);
    if (!it) return false;
    it.holder = null;
    const s = sid ? byId.ship(sid) : null;
    it.ship = s; it.lp = s ? new THREE.Vector3(...p) : null; it.wp = s ? null : new THREE.Vector3(...p);
    placeMesh(it);
    return true;
  };
  A.repair = (pid, iid, sid, p, plank, carp) => {
    const s = byId.ship(sid), it = byId.item(iid);
    if (!s) return 0;
    const wp = new THREE.Vector3(...p);
    const fix = plank ? s.repairAt(wp, 1.2, PLANK_FIX, carp ? 1 : 0.9) : s.repairAt(wp, 0.9, Math.round((it?.def.fix || 3) * 4 * FURN_K * (carp ? 2 : 1)), 1);
    if (fix && it) destroyItem(it);
    if (fix) sfx.hammer(wp);
    return fix;
  };
  A.bail = (pid, sid, ci, amount) => { const c = byId.ship(sid)?.comps[ci]; if (!c || c.vol < 0.05) return false; c.vol = Math.max(0, c.vol - Math.min(6, amount)); return true; };
  A.pour = (pid, sid, ci, amount) => { const c = byId.ship(sid)?.comps[ci]; if (c) c.vol += Math.max(0, Math.min(6, amount)); return true; };
  A.bucket = (pid, iid, full) => { const it = byId.item(iid); if (it) setBucket(it, full); return true; };
  A.extinguish = (pid, sid, p) => byId.ship(sid)?.extinguish(new THREE.Vector3(...p), 2.6) || 0;
  A.throw = (pid, kind, p, vel) => { addProjectile(kind, new THREE.Vector3(...p), new THREE.Vector3(...vel), avatarOf(pid)); return true; };
  A.c4 = (pid, sid, p, n) => { placeC4(avatarOf(pid), { ship: sid ? byId.ship(sid) : null, point: new THREE.Vector3(...p), normal: new THREE.Vector3(...n) }); return true; };
  A.detonate = pid => detonateC4(avatarOf(pid));
  A.nuke = (pid, p) => armNuke(new THREE.Vector3(...p), avatarOf(pid));
  A.died = (pid, by, kind) => {
    const victim = avatarOf(pid), killer = by ? avatarOf(by) || byId.bot(by) : null;
    if (killer === G.me) G.me.kills++;
    announceKill(victim, killer, kind);
    G.game?.onDeath?.(victim, null, kind);
    return true;
  };
  A.respawnShip = pid => G.game?.respawnShip?.(avatarOf(pid))?.id ?? null;
  A.vote = (pid, i) => { G.game?.vote?.(pid, i); return true; };
  A.shopShip = (pid, id) => G.game?.shipBuy?.(id) ?? false;
  A.admin = (pid, label) => { if (!G.admin.everyone) return false; G.adminRun?.(label, avatarOf(pid)); return true; };
  A.chat = (pid, text) => { broadcast({ t: 'chat', id: pid, text: String(text).slice(0, 140) }); G.chat?.(pid, text); return true; };
}
// the killer's own client counts the kill: local kills are counted where they happen, remote ones here
export function announceKill(victim, by, kind) {
  const msg = { t: 'kill', victim: victim?.name || '?', vid: victim?.id ?? null, vp: !!victim?.isPlayer, by: by?.name || null, bid: by?.isPlayer ? by.id : null, kind };
  if (isHost()) broadcast(msg);
  G.killfeed?.(msg);
}
function onKill(m) {
  G.killfeed?.(m);
  if (m.bid && m.bid === G.net.id && G.me && m.vid !== G.net.id) G.me.kills++;
}

// ---------- guest side ----------
export function installGuestHandlers() {
  on('spawn', m => spawnFromNet(m.k, m.d));
  on('despawn', m => {
    if (m.k === 'ship') { const s = byId.ship(m.id); if (s) { G.scene.remove(s.group); s.gone = true; G.ships = G.ships.filter(x => x !== s); } }
    else if (m.k === 'item') { const it = byId.item(m.id); if (it) { it.mesh.parent?.remove(it.mesh); G.items = G.items.filter(x => x !== it); if (G.me?.holding === it) G.me.holding = null; } }
    else if (m.k === 'crate') { const c = byId.crate(m.id); if (c) { c.mesh.parent?.remove(c.mesh); G.crates = G.crates.filter(x => x !== c); } }
    else if (m.k === 'bot') { const b = byId.bot(m.id); if (b) { b.mesh.parent?.remove(b.mesh); G.bots = G.bots.filter(x => x !== b); } }
    else if (m.k === 'shark') { const s = byId.shark(m.id); if (s) { s.remove(); G.sharks = G.sharks.filter(x => x !== s); } }
    else if (m.k === 'c4') { const c = G.c4s.find(x => x.id === m.id); if (c) { c.mesh.parent?.remove(c.mesh); G.c4s = G.c4s.filter(x => x !== c); } }
  });
  on('vox', m => {
    const d = m.d;
    let s = null, sid = null;
    for (let i = 0; i < d.length; i += 3) {
      if (d[i] !== sid) { sid = d[i]; s = byId.ship(sid); }
      if (!s) continue;
      if (d[i + 2]) s.restoreCell(d[i + 1]); else s.removeCell(d[i + 1]);
    }
  });
  on('snap', applySnap);
  on('you', m => G.onPlaced?.(m));
  on('cmap', m => G.ui.campaignMap(m, false));
  on('cvote', m => G.ui.campaignVotes(m.votes));
  on('cclose', () => { G.ui.closeOverlay(); G.toast('⛵ Setting sail! Click the game to take control.', 'good'); });
  on('cshop', () => G.ui.campaignShop(null, false));
  on('cdock', () => G.ui.campaignDock(null, false));
  on('creward', m => { G.campReward?.(m); if (m.heal && G.me) G.me.hp = 100; });
  on('cres', m => G.campResults?.(m.r));
  on('ffaEnd', m => G.game?.ffaEnd?.(m));
}
function spawnFromNet(kind, d) {
  if (kind === 'ship') {
    if (byId.ship(d.id)) return;
    const s = spawnShip(d.key, { ...d.o, id: d.id });
    G.populate?.(s); G.hookShip?.(s);
  } else if (kind === 'item') {
    if (byId.item(d.id)) return;
    const s = d.s ? byId.ship(d.s) : null;
    makeItem(d.kind, s, new THREE.Vector3(...(d.p || [0, -50, 0])), d.id, d.r);
  } else if (kind === 'crate') {
    if (byId.crate(d.id)) return;
    const c = spawnCrate(new THREE.Vector3(...d.p), d.loot, d.chute, d.id);
    c.state = d.state;
  } else if (kind === 'shark') { if (!byId.shark(d.id)) spawnShark(d.p[0], d.p[2], d.id); }
  else if (kind === 'bot') {
    if (byId.bot(d.id)) return;
    const s = byId.ship(d.s);
    if (!s) return;
    let ref = s;
    if (d.team !== s.team) { ref = Object.create(s); ref.team = d.team; ref.colors = d.colors; }
    const b = new Bot(ref, new THREE.Vector3(...d.lp), { hp: d.hp, captain: d.captain, name: d.name, id: d.id });
    G.bots.push(b);
  } else if (kind === 'c4') {
    placeC4(null, { ship: d.s ? byId.ship(d.s) : null, point: new THREE.Vector3(...d.p), normal: new THREE.Vector3(0, 0, 0), local: !!d.s, id: d.id });
  }
}
function applySnap(m) {
  // keep our clock (and so the waves) in step with the host
  const err = m.time - G.t;
  G.t += Math.abs(err) > 2 ? err : err * 0.1;
  G.seaAmp = m.sea; G.admin.everyone = m.adm;
  for (const a of m.ships) { const s = byId.ship(a[0]); if (s) { s.netApply(a); updateStorage(s); } }
  for (const [id, alive, ry] of m.bots) { const b = byId.bot(id); if (b) { if (!alive && b.alive) b.alive = false; b.netRot = ry; } }
  for (const [id, x, z, yaw, speed, stun] of m.sharks) { const s = byId.shark(id); if (s) s.net = { x, z, yaw, speed, stun }; }
  for (const [id, state, sid, p] of m.crates) { const c = byId.crate(id); if (c && p) placeCrate(c, state, sid ? byId.ship(sid) : null, v1.fromArray(p)); }
  for (const [id, sid, p, holder, full] of m.items) {
    const it = byId.item(id);
    if (!it) continue;
    if (it.kind === 'bucket' && it.full !== !!full && it.holder !== G.me) setBucket(it, !!full);
    if (holder) { if (holder !== G.net.id && it.holder?.id !== holder) { const a = byId.player(holder); if (a) holdItem(it, a); } continue; }
    if (it.holder === G.me) continue;       // I dropped it a moment ago
    const s = sid ? byId.ship(sid) : null;
    if (it.holder || s !== it.ship) { it.holder = null; it.ship = s; it.lp = s ? new THREE.Vector3(...p) : null; it.wp = s ? null : new THREE.Vector3(...p); placeMesh(it); }
    else if (p) { (s ? it.lp : it.wp).fromArray(p); it.mesh.position.copy(s ? it.lp : it.wp); }
  }
  if (m.game) G.game?.netApply?.(m.game);
}

// ---------- shared handlers (host and guests) ----------
export function installSharedHandlers() {
  on('ps', (m, from) => {
    const id = m.id || from;
    let a = byId.player(id);
    if (!a || !a.isRemote) return;
    a.apply(m);
    if (isHost()) {     // drivers and gunners steer through their state
      if (m.drive) { const s = byId.ship(m.drive[0]); if (s && s.driver === a) { s.throttle = m.drive[1]; s.rudderIn = m.drive[2]; } }
      if (m.crane) { const s = byId.ship(m.crane[0]); if (s && s.crane.user === a) { s.crane.yaw = m.crane[1]; s.crane.reach = m.crane[2]; s.crane.drop = m.crane[3]; } }
      if (m.gun) { const c = byId.ship(m.gun[0])?.cannons[m.gun[1]]; if (c && c.user === a) { c.yaw = m.gun[2]; c.pitch = m.gun[3]; } }
    }
  });
  on('fx', m => playFx(m));
  on('dmg', m => {
    if (!G.me) return;
    const by = m.by ? (byId.player(m.by) || byId.bot(m.by)) : (m.byBot ? { isBot: true } : null);
    G.me.hurt(m.amount, by, m.kind, m.from ? new THREE.Vector3(...m.from) : null);
  });
  on('toast', m => G.toast(m.text, m.kind));
  on('kill', m => onKill(m));
  on('chat', m => { if (m.id !== G.net.id) G.chat?.(m.id, m.text); });
  on('sunk', m => { if (m.bid === G.net.id && G.me) G.me.sunk++; });
}
const hasFx = new Set();
function playFx(m) {
  const P3 = a => new THREE.Vector3(...a);
  if (m.k === 'shot') { const a = P3(m.a), b = P3(m.b); FX.tracer(a, b); sfx.shot(m.w, a, m.q); if (!m.q) FX.flash(a.x, a.y, a.z, 2); }
  else if (m.k === 'tr') { const a = P3(m.a), b = P3(m.b); FX.tracer(a, b); sfx.shot(m.w || 'ak', a); }
  else if (m.k === 'cannon') { const p = P3(m.p), d = P3(m.d), big = m.t === 'ac' ? 0.35 : 1; for (let i = 0; i < 8 * big; i++) FX.smoke(p.x + d.x * i * 0.3, p.y, p.z + d.z * i * 0.3, 1.1 * big); FX.flash(p.x, p.y, p.z, 14 * big); sfx.cannon(p, m.t || 'ball'); }
  else if (m.k === 'proj') { if (isGuest()) addProjectile(m.kind, P3(m.p), P3(m.v), null, { visual: true }); }
  else if (m.k === 'boom') { if (isGuest()) explode(P3(m.p), { r: m.r, visualOnly: true, sound: m.s || true }); }
  else if (m.k === 'nuke') nukeVisual(m.x, m.z, m.time);
  else if (m.k === 'nukeBoom') nukeBoomVisual(m.x, m.z);
  else if (m.k === 'splash') { FX.splash(m.p[0], m.p[1], m.p[2], m.s); sfx.splash(P3(m.p), m.s); }
}

// ---------- text chat ----------
export function sendChat(text) {
  text = text.trim().slice(0, 140);
  if (!text) return;
  G.chat?.(G.net.id, text);
  if (isHost()) broadcast({ t: 'chat', id: G.net.id, text });
  else if (isGuest()) act('chat', text);
}

// ---------- voice chat (PeerJS mode: everyone calls everyone) ----------
const VOICE = { stream: null, calls: new Map(), audios: new Map() };
export async function startVoice(peerIds) {
  if (!S.voice || NET.mode !== 'peerjs' || !NET.peer) return;
  try {
    VOICE.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.mic ? { exact: S.mic } : undefined, noiseSuppression: S.noise, echoCancellation: true, autoGainControl: true } });
  } catch { G.toast('🎙️ No microphone access: voice chat is off.', 'warn'); return; }
  const answer = call => { call.answer(VOICE.stream); hookCall(call); };
  NET.peer.on('call', answer);
  const mine = NET.peer.id;
  for (const [pid, peerId] of Object.entries(peerIds)) {
    if (pid === G.net.id || !peerId || peerId < mine) continue;     // only one side of each pair calls
    hookCall(NET.peer.call(peerId, VOICE.stream, { metadata: { pid: G.net.id } }));
  }
}
function hookCall(call) {
  call.on('stream', stream => {
    const pid = call.metadata?.pid || [...VOICE.calls.keys()].length;
    const a = new Audio(); a.srcObject = stream; a.autoplay = true;
    VOICE.audios.set(call.peer, { a, pid });
    a.play().catch(() => {});
  });
  VOICE.calls.set(call.peer, call);
}
// mute when not talking, quieter with distance (proximity chat; same ship = always loud)
export function voiceTick(peerPid) {
  if (!VOICE.stream) return;
  const on = talking();
  for (const t of VOICE.stream.getAudioTracks()) t.enabled = on;
  for (const [peer, { a }] of VOICE.audios) {
    const pid = peerPid[peer];
    const av = pid ? byId.player(pid) : null;
    let vol = S.voiceVol;
    if (av && G.me) { const d = av.worldPos(v1).distanceTo(G.me.worldPos(v2)); vol *= av.frame && av.frame === G.me.frame ? 1 : Math.max(0.15, 1 - d / 90); }
    a.volume = Math.min(1, vol);
  }
}
export function stopVoice() {
  for (const c of VOICE.calls.values()) try { c.close(); } catch { /* closed */ }
  for (const { a } of VOICE.audios.values()) a.srcObject = null;
  VOICE.calls.clear(); VOICE.audios.clear();
  VOICE.stream?.getTracks().forEach(t => t.stop()); VOICE.stream = null;
}
export { isOnline };
