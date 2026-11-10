// Online play. The host runs the whole world (ships, AI, sharks, crates, items, damage) and sends it to the
// guests ~15 times a second plus every voxel change. Every client moves its own player and tells the others.
// Guests ask the host to do things (take the helm, open a crate, repair...) with act().
import * as THREE from 'three';
import { G, P, S, isGuest, isHost, isOnline, rand, damp, angDiff, clamp } from './state.js';
import { NET, on, send, broadcast, sendFast, act } from './net.js';
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
const INTERP = 0.1;        // remote players are drawn this far in the past (2 updates), so they move smoothly
let lastSnap = -1;         // guests: the newest ship snapshot so far (they can arrive out of order)

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
    this.buf = []; this.off = null; this.lastQ = null;      // recent updates, for smooth movement
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
  center(out = new THREE.Vector3()) { out.copy(this.pos); out.y += this.crouched ? 0.68 : 1.0; return this.frame ? this.frame.toWorld(out) : out; }
  worldYaw() { return this.yaw + (this.frame ? this.frame.yaw : 0); }
  forwardLocal(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  stationShip() { return this.frame; }
  hitTest(o, d, max) {
    if (!this.alive) return null;
    const c = this.center(v1);
    const t = raySphere(o, d, c, 0.45), h = raySphere(o, d, v2.copy(c).add(new THREE.Vector3(0, this.crouched ? 0.42 : 0.62, 0)), 0.22);
    if (h != null && h <= max && (t == null || h < t)) return { dist: h, head: true };
    return t != null && t <= max ? { dist: t } : null;
  }
  hurt(amount, by, kind, from) {
    if (!this.alive) return;
    if (by?.isPlayer && !G.ff && by !== this) return;
    if (isHost()) send(this.id, { t: 'dmg', amount, by: by?.id ?? null, byBot: !!by?.isBot, kind, from: from ? [from.x, from.y, from.z] : null });
    else G.netHit('player', this.id, amount, kind);
  }
  // a state update from this player. Returns false for an old one that came in after a newer one.
  apply(ps) {
    if (ps.q != null) {
      if (this.lastQ != null && ps.q <= this.lastQ && ps.q > this.lastQ - 2000) return false;
      this.lastQ = ps.q;
    }
    const ship = ps.s ? byId.ship(ps.s) : null;
    if (ship !== this.frame) { this.frame = ship; this.pos.fromArray(ps.p); (ship ? ship.group : G.scene).add(this.mesh); this.buf.length = 0; }
    // their clock vs. ours: follows the fastest packets at once, slower ones only slowly
    const now = performance.now() / 1000, ts = ps.ts ?? now, off = now - ts;
    if (this.off == null || off < this.off || off - this.off > 1) this.off = off; else this.off += (off - this.off) * 0.01;
    const last = this.buf[this.buf.length - 1];
    if (!last || ts > last.t) { this.buf.push({ t: ts, p: new THREE.Vector3().fromArray(ps.p), yaw: ps.yaw, pitch: ps.pitch }); if (this.buf.length > 20) this.buf.shift(); }
    this.tpos.fromArray(ps.p); this.netYaw = ps.yaw; this.netPitch = ps.pitch;
    this.mode = ps.mode; this.alive = ps.alive; this.hp = ps.hp; this.inSea = ps.sea; this.underwater = ps.uw; this.swimming = ps.sw; this.talk = ps.talk;
    this.mesh.visible = ps.alive;
    this.crouched = !!ps.cr; this.mesh.scale.y = ps.cr ? 0.68 : 1;
    this.tag.scale.y = ps.cr ? 0.4 / 0.68 : 0.4; this.mic.scale.y = ps.cr ? 0.2 / 0.68 : 0.2;     // keep the name tag unsquashed
    this.gun.visible = !ps.hold;
    this.lastPs = ps;
    return true;
  }
  // drawn ~100 ms in the past, smoothly between two real updates; a short guess ahead if one is late
  update(dt) {
    const b = this.buf, rt = performance.now() / 1000 - (this.off ?? 0) - INTERP;
    v2.copy(this.pos);
    if (b.length) {
      while (b.length > 2 && b[1].t <= rt) b.shift();
      const a = b[0], c = b[1];
      if (rt <= a.t || !c) { this.pos.copy(a.p); this.yaw = a.yaw; this.pitch = a.pitch; }
      else if (rt <= c.t) {
        const f = (rt - a.t) / (c.t - a.t);
        if (a.p.distanceToSquared(c.p) > 36) this.pos.copy(c.p); else this.pos.lerpVectors(a.p, c.p, f);
        this.yaw = a.yaw + angDiff(a.yaw, c.yaw) * f; this.pitch = a.pitch + (c.pitch - a.pitch) * f;
      } else {
        const ahead = Math.min(rt - c.t, 0.2);
        if (a.p.distanceToSquared(c.p) > 36) this.pos.copy(c.p); else this.pos.copy(c.p).addScaledVector(v1.subVectors(c.p, a.p), ahead / (c.t - a.t));
        this.yaw = c.yaw; this.pitch = c.pitch;
      }
    }
    const spd = dt > 0 ? v2.distanceTo(this.pos) / dt : 0;
    this.spd = damp(this.spd || 0, spd, 8, dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw + Math.PI;
    this.head.rotation.x = -this.pitch * 0.6;
    this.hand.rotation.x = -this.pitch;
    const moving = this.spd > 0.4;
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
// Three streams go out:
//  * 'snap' 20x a second on the fast channel: where the ships, crates and sharks are (full every time, so a lost
//    one doesn't matter);
//  * 'st' 10x a second on the reliable channel: only what CHANGED since the last one (flooding, fires, guns,
//    bots, items, the mode's HUD...), plus everything every 2 s;
//  * 'vox' every 50 ms: the blocks that broke or were fixed, packed per ship.
let snapT = 0, stT = 0, voxT = 0, fullT = 0, psT = 0, snapN = 0, psN = 0;
const sentSt = new Map();        // what the guests already have, per thing
const HUMAN = () => G.players.filter(p => p.isPlayer);
const V3 = p => [r2(p.x), r2(p.y), r2(p.z)];
export function resetNetState() { sentSt.clear(); snapT = stT = voxT = fullT = 0; lastSnap = -1; G.voxOut = []; }
export function hostTick(dt) {
  voxT -= dt;
  if (G.voxOut.length && voxT <= 0) { voxT = 0.05; broadcast({ t: 'vox', v: packVox(G.voxOut) }); G.voxOut = []; }
  snapT -= dt;
  if (snapT <= 0) {
    snapT = 1 / 20;
    sendFast('*', {
      t: 'snap', n: ++snapN, time: r2(G.t),
      ships: G.ships.filter(s => !s.gone).map(s => s.netPose()),
      sharks: G.sharks.map(s => [s.id, r2(s.pos.x), r2(s.pos.z), r2(s.yaw), r2(s.speed), s.stunT > 0 ? 1 : 0]),
      crates: G.crates.map(c => [c.id, c.state, c.state === 'deck' ? c.ship?.id : null, V3(c.state === 'deck' && c.ship ? c.lp : c.wp)]),
    });
  }
  stT -= dt; fullT -= dt;
  if (stT > 0) return;
  stT = 0.1;
  const full = fullT <= 0;
  if (full) { fullT = 2; sentSt.clear(); }
  // keep only the entries that changed
  const pick = (key, arr) => { const s = JSON.stringify(arr); if (sentSt.get(key) === s) return false; sentSt.set(key, s); return true; };
  const m = { t: 'st' };
  if (pick('sea', [G.seaAmp, G.admin.everyone])) { m.sea = G.seaAmp; m.adm = G.admin.everyone; }
  const sh = G.ships.filter(s => !s.gone).map(s => s.netSlow()).filter(a => pick('s' + a[0], a));
  const bo = G.bots.map(b => [b.id, b.alive ? 1 : 0, r2(b.mesh.rotation.y)]).filter(a => pick('b' + a[0], a));
  const it = G.items.map(i => [i.id, i.ship?.id ?? null, i.holder ? null : V3(i.ship ? i.lp : i.wp), i.holder?.id ?? null, i.full ? 1 : 0]).filter(a => pick('i' + a[0], a));
  const game = G.game?.netState?.() ?? null;
  if (sh.length) m.ships = sh;
  if (bo.length) m.bots = bo;
  if (it.length) m.items = it;
  if (game && pick('game', game)) m.game = game;
  if (Object.keys(m).length > 1) broadcast(m);
}
// voxel changes: the last change of each block wins, then per ship two sorted lists (broken / fixed) sent as
// gaps between the block numbers, which keeps even a big explosion small
function packVox(list) {
  const per = new Map();
  for (let i = 0; i < list.length; i += 3) {
    let m = per.get(list[i]);
    if (!m) per.set(list[i], m = new Map());
    m.set(list[i + 1], list[i + 2]);
  }
  const gaps = a => { a.sort((x, y) => x - y); let p = 0; return a.map(n => { const d = n - p; p = n; return d; }); };
  const out = [];
  for (const [sid, m] of per) {
    const rem = [], add = [];
    for (const [n, f] of m) (f ? add : rem).push(n);
    out.push([sid, gaps(rem), gaps(add)]);
  }
  return out;
}
// my own player -> everyone (host and guests), 20x a second on the fast channel
export function sendMyState(dt) {
  psT -= dt;
  const me = G.me;
  if (psT > 0 || !me) return;
  psT = 1 / 20;
  const ps = { t: 'ps', id: G.net.id, q: ++psN, ts: Math.round(performance.now()) / 1000, s: me.frame?.id ?? null, p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], yaw: r2(me.yaw), pitch: r2(me.pitch), mode: me.mode, alive: me.alive, hp: Math.round(me.hp), sea: me.inSea, uw: me.underwater, sw: me.swimming, talk: talking(), hold: me.holding?.id ?? null, cr: me.crouch > 0.5 ? 1 : 0 };
  if (me.mode === 'wheel' && me.station) { const s = me.station; ps.drive = [s.id, r2(s.throttle), r2(s.rudderIn)]; }
  if (me.mode === 'crane' && me.station) { const s = me.station, c = s.crane; ps.crane = [s.id, r2(c.yaw), r2(c.reach), r2(c.drop)]; }
  if (me.mode === 'cannon') { const { ship, c } = me.station; ps.gun = [ship.id, ship.cannons.indexOf(c), r2(c.yaw), r2(c.pitch)]; }
  sendFast('*', ps);
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
    if (c.cd < 0.25) c.cd = 0;      // the guest's reload ran out a moment before ours: lag, let it fire
    G.fxBy = pid;                  // the guest already shows this shot: don't send it back to them
    try { return fireCannon(s, c, avatarOf(pid), mul); } finally { G.fxBy = null; }
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
    const lp = new THREE.Vector3(...p);            // ship space: lag can't move where it lands
    const fix = plank ? s.repairAt(lp, 1.2, PLANK_FIX, carp ? 1 : 0.9, true) : s.repairAt(lp, 0.9, Math.round((it?.def.fix || 3) * 4 * FURN_K * (carp ? 2 : 1)), 1, true);
    if (fix && it) destroyItem(it);
    if (fix) sfx.hammer(s.toWorld(lp.clone()));
    return fix;
  };
  A.bail = (pid, sid, ci, amount) => { const c = byId.ship(sid)?.comps[ci]; if (!c || c.vol < 0.05) return false; c.vol = Math.max(0, c.vol - Math.min(6, amount)); return true; };
  A.pour = (pid, sid, ci, amount) => { const c = byId.ship(sid)?.comps[ci]; if (c) c.vol += Math.max(0, Math.min(6, amount)); return true; };
  A.bucket = (pid, iid, full) => { const it = byId.item(iid); if (it) setBucket(it, full); return true; };
  A.extinguish = (pid, sid, p) => byId.ship(sid)?.extinguish(new THREE.Vector3(...p), 2.6, true) || 0;
  A.throw = (pid, kind, p, vel) => { addProjectile(kind, new THREE.Vector3(...p), new THREE.Vector3(...vel), avatarOf(pid), { by: pid }); return true; };
  // on a ship the point and normal come in ship space (local), so the charge sticks where the guest put it
  A.c4 = (pid, sid, p, n) => { const s = sid ? byId.ship(sid) : null; placeC4(avatarOf(pid), { ship: s, point: new THREE.Vector3(...p), normal: new THREE.Vector3(...n), local: !!s }); return true; };
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
    let fx = 0;
    for (const [sid, rem, add] of m.v || []) {
      const s = byId.ship(sid);
      if (!s) continue;
      let n = 0;
      for (const d of rem) { n += d; s.removeCell(n, ++fx < 160); }     // debris for the first ones only
      n = 0;
      for (const d of add) { n += d; s.restoreCell(n); }
    }
  });
  on('snap', applySnap);
  on('st', applyState);
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
// fast channel: where things are right now
function applySnap(m) {
  if (m.n <= lastSnap && m.n > lastSnap - 2000) return;      // an older one that arrived late
  lastSnap = m.n;
  // keep our clock (and so the waves) in step with the host
  const err = m.time - G.t;
  G.t += Math.abs(err) > 2 ? err : err * 0.1;
  const lead = clamp(G.t - m.time, -0.1, 0.3);       // how old this snapshot is by our clock
  for (const a of m.ships) { const s = byId.ship(a[0]); if (s) s.applyPose(a, lead); }
  for (const [id, x, z, yaw, speed, stun] of m.sharks) { const s = byId.shark(id); if (s) s.net = { x, z, yaw, speed, stun }; }
  for (const [id, state, sid, p] of m.crates) { const c = byId.crate(id); if (c && p) placeCrate(c, state, sid ? byId.ship(sid) : null, v1.fromArray(p)); }
}
// reliable channel: what changed (flooding, fires, guns, bots, items, the mode)
function applyState(m) {
  if (m.sea != null) { G.seaAmp = m.sea; G.admin.everyone = m.adm; }
  for (const a of m.ships || []) { const s = byId.ship(a[0]); if (s) { s.applySlow(a); updateStorage(s); } }
  for (const [id, alive, ry] of m.bots || []) { const b = byId.bot(id); if (b) { if (!alive && b.alive) b.alive = false; b.netRot = ry; } }
  for (const [id, sid, p, holder, full] of m.items || []) {
    const it = byId.item(id);
    if (!it) continue;
    if (it.kind === 'bucket' && it.full !== !!full && it.holder !== G.me) setBucket(it, !!full);
    if (holder) { if (holder !== G.net.id && it.holder?.id !== holder) { const a = byId.player(holder); if (a) holdItem(it, a); } continue; }
    if (it.holder === G.me) continue;       // I dropped it a moment ago
    const s = sid ? byId.ship(sid) : null;
    if (it.holder || s !== it.ship) { it.holder = null; it.ship = s; it.lp = s ? new THREE.Vector3(...p) : null; it.wp = s ? null : new THREE.Vector3(...p); placeMesh(it); }
    else if (p) { (s ? it.lp : it.wp).fromArray(p); if (s) it.mesh.position.copy(it.lp); }     // in the sea: updateItems glides it there
  }
  if (m.game) G.game?.netApply?.(m.game);
}

// ---------- shared handlers (host and guests) ----------
export function installSharedHandlers() {
  on('ps', (m, from) => {
    const id = m.id || from;
    let a = byId.player(id);
    if (!a || !a.isRemote) return;
    if (!a.apply(m)) return;          // an old update that came in late
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
  else if ((m.k === 'cannon' || m.k === 'proj') && m.by && m.by === G.net.id) return;     // my own shot: I showed it already
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
