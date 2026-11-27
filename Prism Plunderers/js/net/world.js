// The shared Prism (part 12, DESIGN 5a). The squad leader's game runs every robot; the others draw them.
//  Leader: the robots go after whoever is fairest (director.pickTarget) among the leader and the friends' stand-ins
//    (proxies, from their 15 Hz state); damage the robots do to a stand-in goes to that friend ('hurt'). 20 times a
//    second each friend gets the robots near them and what the robots did (shots, booms, pods...) as events.
//  Friend: no robot thinks here (director.puppet); robots are placed from the leader's snapshots, 0.1 s behind;
//    the events are played again here, so a Fly's bolt flies and hits you on your own screen (the victim decides).
//    Your hits on robots go to the leader ('hit'); your grenades too ('nade').
// Not shared yet: container and wreck loot, items on the ground (each game keeps its own).
import { PRISM } from '../game/prism/defs.js';
import { ROBOT_NET, damageRobot, center } from '../game/prism/robot.js';
import { applyDamage } from '../game/damage.js';
import { ITEMS } from '../game/items.js';
import { BODY } from '../game/stats.js';
import { bus } from '../core/events.js';
import { NET, send, on, broadcast } from './net.js';
import { SHARED } from '../game/loot.js';

const TYPES = Object.keys(PRISM);
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const RANGE = 260, EV_RANGE = 170, DELAY = 6;
const brokenMask = r => { let m = 0; PRISM[r.type].parts.filter(p => p.hp).forEach((p, i) => { if (r.broken[p.name]) m |= 1 << i; }); return m; };

export function createWorldSync(api, mates) {
  const dir = api.prism, host = NET.role === 'host';
  let tick = 0;
  const offs = [];
  const listen = (t, fn) => { on(t, fn); offs.push(() => on(t, null)); };
  if (host) return hostSide();
  return guestSide();

  // ================= the leader =================
  function hostSide() {
    const proxies = new Map(), events = [];
    let quiet = 0;
    const emit = ev => { if (dir.inBrain && !quiet) events.push([tick, ...ev]); };
    const emitAlways = ev => events.push([tick, ...ev]);
    const wrap = (name, fn) => { const orig = dir[name].bind(dir); dir[name] = (...a) => fn(orig, ...a); };
    wrap('sound', (o, name, pos, extra) => { if (pos) emit(['snd', name, r2(pos.x), r2(pos.y), r2(pos.z), extra ?? null]); return o(name, pos, extra); });
    wrap('fireBolt', (o, a, d, speed, damage, src) => { emit(['bolt', r2(a.x), r2(a.y), r2(a.z), r3(d.x), r3(d.y), r3(d.z), speed, damage, src.type]); quiet++; try { return o(a, d, speed, damage, src); } finally { quiet--; } });
    wrap('fireBullet', (o, a, d, range, damage, src) => { emit(['bul', r2(a.x), r2(a.y), r2(a.z), r3(d.x), r3(d.y), r3(d.z), range, damage, src.type]); quiet++; try { return o(a, d, range, damage, src); } finally { quiet--; } });
    wrap('fireRocket', (o, from, aim, src) => { quiet++; try { o(from, aim, src); } finally { quiet--; } const k = dir.rockets[dir.rockets.length - 1]; if (k) emit(['rkt', r2(from.x), r2(from.y), r2(from.z), r2(aim.x), r2(aim.y), r2(aim.z), r2(k.vel.x), r2(k.vel.y), r2(k.vel.z), r2(k.life)]); });
    wrap('cluster', (o, pos, total, n, src) => { const before = dir.bombs.length; quiet++; try { o(pos, total, n, src); } finally { quiet--; } emit(['bombs', r2(pos.x), r2(pos.y), r2(pos.z), total, n, dir.bombs.slice(before).map(b => [r2(b.vel.x), r2(b.vel.y), r2(b.vel.z), r2(b.life)])]); });
    wrap('boom', (o, pos, size, color, q) => { emit(['boom', r2(pos.x), r2(pos.y), r2(pos.z), size, color ?? null, !!q]); quiet++; try { return o(pos, size, color, q); } finally { quiet--; } });
    wrap('warn', (o, pos, radius, time) => { emitAlways(['warn', r2(pos.x), r2(pos.y), r2(pos.z), radius, time]); return o(pos, radius, time); });
    wrap('blast', (o, pos, radius, damage, inner, type, source, from) => { emit(['blast', r2(pos.x), r2(pos.y), r2(pos.z), radius, damage, inner, type, source]); return o(pos, radius, damage, inner, type, source, from); });
    wrap('emp', (o, pos, radius, time, src) => { emit(['emp', r2(pos.x), r2(pos.y), r2(pos.z), radius, time]); quiet++; try { return o(pos, radius, time, src); } finally { quiet--; } });
    wrap('reinforce', (o, target, caller) => { const pod = o(target, caller); emitAlways(['pod', r2(pod.pos.x), r2(pod.pos.y), r2(pod.pos.z), r2(target.x), r2(target.y), r2(target.z)]); return pod; });
    wrap('kill', (o, r, src, how) => { const was = r.dead; o(r, src, how); if (!was && r.dead) emitAlways(['dead', r.id, src?.id ?? null]); });
    wrap('wreck', (o, r) => { emitAlways(['wreck', r.id, r2(r.pos.x), r2(r.pos.y), r2(r.pos.z)]); return o(r); });
    wrap('remove', (o, r) => { emitAlways(['gone', r.id]); return o(r); });
    wrap('throwGrenade', (o, a, v, T, src) => { const id = Object.keys(ITEMS).find(k => ITEMS[k].throw === T) || 'frag_grenade'; emitAlways(['nade', r2(a.x), r2(a.y), r2(a.z), r2(v.x), r2(v.y), r2(v.z), id, src?.id ?? NET.id]); return o(a, v, T, src); });

    // shared loot: crates and wrecks are the leader's; a change only goes through if nobody changed the box first
    const boxById = id => /^c\d/.test(id) ? api.world.containerBox?.(+id.slice(1)) : (() => { const w = dir.wrecks.find(q => 'wreck' + q.id === id); return w ? dir.search(w) : null; })();
    const boxMsg = (b, open = false) => ({ t: 'box', id: b.id, name: b.name, slots: b.slots, pos: b.pos, reach: b.reach, open });
    listen('box:open', (m, from) => { const b = boxById(m.id); if (b) send(from, boxMsg(b, true)); });
    listen('box:set', (m, from) => {
      const b = boxById(m.id);
      const ok = !!b && JSON.stringify(b.slots) === JSON.stringify(m.before);
      if (ok) { b.slots.length = 0; b.slots.push(...m.after); broadcast(boxMsg(b)); }
      send(from, { t: 'box:ok', id: m.id, req: m.req, ok, slots: b ? b.slots : [] });
    });
    offs.push(bus.on('inv:changed', (op, b) => { if (b && !b.remote && (/^c\d/.test(b.id) || /^wreck/.test(b.id))) broadcast(boxMsg(b)); }));
    // the friends' hits and grenades
    listen('hit', (m, from) => {
      const r = dir.robots.find(q => q.id === m.id);
      const pr = proxies.get(from);
      if (r && !r.dead) damageRobot(r, m.part || null, +m.amount || 0, dir.ctx, { id: from, pos: pr ? { ...pr.pos } : { ...r.pos } });
      if (pr) dir.hear(pr.pos, 30, 0.35);
    });
    listen('nade', (m, from) => {
      const T = ITEMS[m.id]?.throw;
      if (T) dir.throwGrenade({ x: m.o[0], y: m.o[1], z: m.o[2] }, { x: m.v[0], y: m.v[1], z: m.v[2] }, T, { id: from, pos: { x: m.o[0], y: m.o[1], z: m.o[2] } });
    });

    function proxyOf(id) {
      let q = proxies.get(id);
      if (!q) {
        q = { id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, facing: 0, height: BODY.stand, crouch: false, sprinting: false, dead: false, out: false, iframes: 0,
          remote: (hit, res) => { send(id, { t: 'hurt', hit: { amount: hit.amount, type: hit.type, source: hit.source, from: hit.from ? { x: r2(hit.from.x), y: r2(hit.from.y), z: r2(hit.from.z) } : null } }); res.health = hit.amount; return res; } };
        proxies.set(id, q);
      }
      return q;
    }
    function updateProxies() {
      for (const [id, m] of mates.mates) {
        const s = m.buf.length ? m.buf[m.buf.length - 1].s : null;
        if (!s) continue;
        const q = proxyOf(id);
        q.pos.x = s.x; q.pos.y = s.y; q.pos.z = s.z; q.vel.x = s.vx; q.vel.y = s.vy; q.vel.z = s.vz; q.facing = s.f;
        q.crouch = !!s.c; q.sprinting = !!s.sp; q.height = s.c ? BODY.crouch : s.m === 'move' ? BODY.stand : BODY.low;
        q.dead = s.m === 'dead'; q.out = !!s.h; q.iframes = s.m === 'roll' ? 0.1 : 0;
        q.downed = s.m === 'down'; q.crawling = q.downed && Math.hypot(s.vx, s.vz) > 0.2;   // still: the Prism lose them
      }
      for (const id of [...proxies.keys()]) if (!mates.mates.has(id)) proxies.delete(id);
      dir.targets = proxies.size ? [api.player, ...proxies.values()] : null;
    }
    function pack(r) {
      const f = (r.hostile ? 1 : 0) | (r.dead ? 2 : 0) | (r.falling ? 4 : 0) | (r.hatchOpen ? 8 : 0) | (r.hot ? 16 : 0) | (r.unstable ? 32 : 0) | (r.sees ? 64 : 0);
      const x = r.type === 'fink' ? [r2(r.scan || 0), r2(r.call || 0)] : r.type === 'swatter' ? [r2(r.heat || 0)]
        : r.type === 'roach' ? [r.mode, r.act, r2(r.actT || 0), r3(r.beamYaw || 0), r3(r.beamPitch || 0), r2(r.beamLen || 0)]
        : r.type === 'scatter' ? [r2(r.st || 0), r2(r.fuse || 0)] : [];
      return [r.id, TYPES.indexOf(r.type), r2(r.pos.x), r2(r.pos.y), r2(r.pos.z), r3(r.yaw), r2(r.vel.x), r2(r.vel.y), r2(r.vel.z), f,
        r2(r.aware), r2(r.lock || 0), r.atk || '', r.state, Math.round(r.hp), r.maxHp, r2(Math.min(9, r.hurtT)), brokenMask(r), r.target || '', x];
    }
    return {
      players: () => [api.player, ...proxies.values()],
      step() {
        tick++;
        updateProxies();
        if (tick % 3) return;
        const ev = events.splice(0);
        for (const [id] of mates.mates) {
          const q = proxies.get(id);
          if (!q) continue;
          const near = (x, z, R) => Math.hypot(x - q.pos.x, z - q.pos.z) < R;
          const r = dir.robots.filter(o => !o.gone && near(o.pos.x, o.pos.z, RANGE)).map(pack);
          const e = ev.filter(a => !['snd', 'bolt', 'bul'].includes(a[1]) || near(a[a[1] === 'snd' ? 3 : 2], a[a[1] === 'snd' ? 5 : 4], EV_RANGE));
          send(id, { t: 'w', k: tick, r, e });
        }
      },
      dispose() { for (const off of offs) off(); dir.targets = null; },
    };
  }

  // ================= a friend =================
  function guestSide() {
    const bufs = new Map();               // robot id -> [{ k, a }]
    const queue = [];                     // [tick, ...event]
    let newest = -1, view = -1;
    const me = () => api.player;
    // hits go to the leader; here only the hit marker
    ROBOT_NET.remote = (r, partName, amount, src) => {
      send('p0', { t: 'hit', id: r.id, part: partName, amount: r2(amount) });
      const d = PRISM[r.type];
      let part = partName ? d.parts.find(p => p.name === partName) : null;
      if (part && part.open && !r.hatchOpen) part = null;
      const mult = (part && part.mult ? part.mult : 1) * (r.hot ? d.hotMult || 1 : 1), armor = part && part.armor !== undefined ? part.armor : d.armor;
      const dmg = amount * mult * (1 - armor);
      r.hurtT = 0; r.flash = 0.07;
      return { dmg, part: part ? part.name : null, weak: mult > 1, broke: false, killed: r.hp - dmg <= 0 };
    };
    dir.blastRobots = () => [];
    const throwOrig = dir.throwGrenade.bind(dir);
    dir.throwGrenade = (a, v, T, src) => {
      const g = throwOrig(a, v, T, src);
      if (!src || src.id === NET.id) { const id = Object.keys(ITEMS).find(k => ITEMS[k].throw === T) || 'frag_grenade'; send('p0', { t: 'nade', o: [r2(a.x), r2(a.y), r2(a.z)], v: [r2(v.x), r2(v.y), r2(v.z)], id }); }
      return g;
    };
    listen('w', m => {
      newest = Math.max(newest, m.k);
      if (view < 0 || Math.abs(view - (newest - DELAY)) > 40) view = newest - DELAY;
      for (const a of m.r) { let b = bufs.get(a[0]); if (!b) bufs.set(a[0], b = []); b.push({ k: m.k, a }); if (b.length > 12) b.shift(); }
      for (const e of m.e) queue.push(e);
    });
    listen('hurt', m => { if (me() && !me().dead) applyDamage(me(), m.hit); });
    // shared loot: ask the leader for a box; changes go through the leader (box:set), who tells everyone (box)
    const cache = new Map(), waits = new Map();
    let pendingOpen = null, req = 0;
    SHARED.open = (id, p, keep) => { pendingOpen = { id, p, keep }; send('p0', { t: 'box:open', id }); };
    SHARED.commit = (b, before, after) => new Promise(res => {
      const r = ++req;
      waits.set(r, res);
      send('p0', { t: 'box:set', id: b.id, before, after, req: r });
      setTimeout(() => { if (waits.has(r)) { waits.delete(r); res({ ok: false }); } }, 5000);
    });
    const local = m => {
      let b = cache.get(m.id);
      if (!b) { b = { id: m.id, name: m.name, slots: [], pos: m.pos, reach: m.reach, remote: true }; cache.set(m.id, b); }
      b.slots.length = 0; b.slots.push(...m.slots);
      return b;
    };
    listen('box', m => {
      const b = local(m);
      if (/^c\d/.test(m.id)) api.world.opened?.set(+m.id.slice(1), b);
      else { const w = dir.wrecks.find(q => 'wreck' + q.id === m.id); if (w) w.box = b; }
      if (m.open && pendingOpen && pendingOpen.id === m.id) { const o = pendingOpen; pendingOpen = null; o.keep?.(b); bus.emit('loot:open', o.p, b, null); }
    });
    listen('box:ok', m => { const res = waits.get(m.req); if (!res) return; waits.delete(m.req); if (!m.ok && cache.has(m.id)) local({ id: m.id, slots: m.slots }); res(m); });

    const byId = id => dir.robots.find(r => r.id === id);
    function make(a) {
      const r = dir.spawn(TYPES[a[1]], { x: a[2], y: a[3], z: a[4] }, { yaw: a[5] });
      const v = dir.views.get(r.id);
      dir.views.delete(r.id);
      r.id = a[0];
      dir.views.set(r.id, v);
      return r;
    }
    function apply(r, a, b, k) {
      const L = (i) => a[i] + (b[i] - a[i]) * k;
      r.prev.x = r.pos.x; r.prev.y = r.pos.y; r.prev.z = r.pos.z; r.prevYaw = r.yaw;
      r.pos.x = L(2); r.pos.y = L(3); r.pos.z = L(4);
      let dy = b[5] - a[5]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      r.yaw = a[5] + dy * k;
      r.vel.x = b[6]; r.vel.y = b[7]; r.vel.z = b[8];
      const s = k < 0.5 ? a : b, f = s[9];
      const wasHostile = r.hostile;
      if (f & 2) r.dead = true;                               // still sent while it falls, until it is a wreck
      r.hostile = !!(f & 1); r.falling = !!(f & 4); r.hatchOpen = !!(f & 8); r.hot = !!(f & 16); r.unstable = !!(f & 32); r.sees = !!(f & 64);
      if (!wasHostile && r.hostile) bus.emit('prism:alert', r);
      r.aware = s[10]; r.lock = s[11]; r.atk = s[12]; r.state = s[13]; r.hp = s[14]; r.maxHp = s[15]; r.hurtT = Math.min(r.hurtT, s[16]);
      PRISM[r.type].parts.filter(p => p.hp).forEach((p, i) => { const was = r.broken[p.name]; r.broken[p.name] = !!(s[17] & (1 << i)); if (!was && r.broken[p.name]) bus.emit('prism:break', r, p.name); });
      r.target = s[18] || null;
      const x = s[19] || [];
      if (r.type === 'fink') { r.scan = x[0]; r.call = x[1]; }
      else if (r.type === 'swatter') r.heat = x[0];
      else if (r.type === 'roach') { r.mode = x[0]; r.act = x[1]; r.actT = x[2]; r.beamYaw = x[3]; r.beamPitch = x[4]; r.beamLen = x[5]; }
      else if (r.type === 'scatter') { r.st = x[0]; r.fuse = x[1]; }
      if (r.phys) r.phys.body.setNextKinematicTranslation(center(r));
    }
    const P = a => ({ x: a[0], y: a[1], z: a[2] });
    function play(e) {
      const [, kind] = e, a = e.slice(2);
      if (kind === 'snd') dir.sound(a[0], P(a.slice(1)), a[4] ?? undefined);
      else if (kind === 'bolt') dir.fireBolt(P(a), P(a.slice(3)), a[6], a[7], { type: a[8] });
      else if (kind === 'bul') dir.fireBullet(P(a), P(a.slice(3)), a[6], a[7], { type: a[8] });
      else if (kind === 'rkt') { dir.fireRocket(P(a), P(a.slice(3)), { type: 'roach' }); const k = dir.rockets[dir.rockets.length - 1]; if (k) { k.vel.set(a[6], a[7], a[8]); k.life = a[9]; } }
      else if (kind === 'bombs') { const before = dir.bombs.length; dir.cluster(P(a), a[3], a[4], { type: 'scatter' }); dir.bombs.slice(before).forEach((b, i) => { const q = a[5][i]; if (q) { b.vel.set(q[0], q[1], q[2]); b.life = q[3]; } }); }
      else if (kind === 'boom') dir.boom(P(a), a[3], a[4] ?? undefined, a[5]);
      else if (kind === 'warn') dir.warn(P(a), a[3], a[4]);
      else if (kind === 'blast') dir.blast(P(a), a[3], a[4], a[5], a[6], a[7], P(a));
      else if (kind === 'emp') dir.emp(P(a), a[3], a[4], null);
      else if (kind === 'pod') { const pod = dir.reinforce(P(a.slice(3)), null); pod.pos.x = a[0]; pod.pos.y = a[1]; pod.pos.z = a[2]; pod.y = a[1] + 70; }
      else if (kind === 'nade') { if (a[7] !== NET.id && ITEMS[a[6]]?.throw) throwOrig(P(a), P(a.slice(3)), ITEMS[a[6]].throw, { id: a[7] }); }
      else if (kind === 'dead') { const r = byId(a[0]); if (r && !r.dead) { r.dead = true; r.lock = 0; bus.emit('prism:dead', r, a[1] === NET.id ? { id: NET.id } : null); } }
      else if (kind === 'wreck') { const r = byId(a[0]); if (r) { r.pos.x = a[1]; r.pos.y = a[2]; r.pos.z = a[3]; dir.boom(center(r), r.type === 'roach' ? 2.4 : r.type === 'swatter' ? 1.3 : 0.7); dir.wreck(r); bufs.delete(a[0]); } }
      else if (kind === 'gone') { const r = byId(a[0]); if (r) dir.remove(r); bufs.delete(a[0]); }
    }
    dir.puppet = () => {
      if (view < 0) return;
      view = Math.min(view + 1, newest);
      queue.sort((x, y) => x[0] - y[0]);
      while (queue.length && queue[0][0] <= view) { const e = queue.shift(); try { play(e); } catch (err) { console.warn('[net] event', e[1], err); } }
      for (const [id, b] of bufs) {
        let r = byId(id);
        const last = b[b.length - 1];
        if (newest - last.k > 90) { if (r) dir.remove(r); bufs.delete(id); continue; }
        let i = b.findIndex(q => q.k > view);
        const A = i <= 0 ? b[0] : b[i - 1], B = i < 0 ? last : b[i];
        if (!r) { if (A.a[9] & 2) continue; r = make(A.a); }
        const span = B.k - A.k, k = span > 0 ? Math.min(1, Math.max(0, (view - A.k) / span)) : 1;
        apply(r, A.a, B.a, k);
      }
    };
    return {
      players: () => [api.player],
      step() { tick++; },
      dispose() { for (const off of offs) off(); ROBOT_NET.remote = null; dir.puppet = null; SHARED.open = SHARED.commit = null; },
    };
  }
}
