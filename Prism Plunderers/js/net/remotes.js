// Your squadmates in a raid (part 12, first step): each game sends its own raider's state 15 times a second (the
// host relays it), and every game draws the others as raiders, a little behind real time so the motion is smooth.
// The Prism and the loot are not shared yet (DESIGN 5a: world sync is the next step).
import { Raider } from '../game/raider.js';
import { MODEL_OF } from '../game/weapon-models.js';
import { angDiff } from '../game/move-math.js';
import { BODY, ROLL } from '../game/stats.js';
import { send, on, NET } from './net.js';
import { raidStatus } from './squad.js';
import { bus } from '../core/events.js';
import { revivePlayer, REVIVE_TIME } from '../game/damage.js';

const SEND = 1 / 15, DELAY = 0.12;
const r2 = v => Math.round(v * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;

export function createRemotes(api, coop, footing) {
  const mates = new Map();                 // id -> { name, raider, buf: [{ t, s }] }
  let sendT = 0, clock = 0;
  const names = new Map((coop.members || []).map(m => [m.id, m.name]));
  on('st', (m, from) => {
    const id = m.id || from;
    if (id === NET.id) return;
    let q = mates.get(id);
    if (!q) {
      const raider = new Raider({ shadows: true });
      api.scene.add(raider.root);
      q = { name: names.get(id) || m.n || 'Plunderer', raider, buf: [], gearSig: '' };
      mates.set(id, q);
    }
    q.buf.push({ t: clock, s: m.s });
    if (q.buf.length > 20) q.buf.shift();
  });
  on('st:gone', m => drop(m.id));
  const offDrop = bus.on('squad:drop', id => drop(id));
  on('revive', () => { if (revivePlayer(api.player)) api.hud.pop('A teammate got you back up', 'good'); });
  function drop(id) {
    const q = mates.get(id);
    if (!q) return;
    if (q.revive) api.world.items.remove(q.revive);
    api.scene.remove(q.raider.root);
    q.raider.dispose();
    mates.delete(id);
  }
  raidStatus('raid');
  return {
    mates,
    // every simulation step: send my state now and then; who can be revived; can anyone revive me
    step(dt, p, hidden) {
      clock += dt;
      if (p) p.coop = [...mates.values()].some(q => { const s = q.buf.length && q.buf[q.buf.length - 1].s; return s && !s.h && (s.m === 'move' || s.m === 'roll' || s.m === 'slide'); });
      for (const [id, q] of mates) {
        const s = q.buf.length ? q.buf[q.buf.length - 1].s : null, down = !!s && s.m === 'down';
        if (down && !q.revive) {
          q.revive = api.world.items.add({ id: 'revive-' + id, pos: { x: s.x, y: s.y + 0.3, z: s.z }, radius: 1.9, hold: REVIVE_TIME, fixed: true, keep: true,
            label: () => `Revive ${q.name} (${q.bleed ?? ''} s left)`, use: () => send(id, { t: 'revive' }) });
        } else if (!down && q.revive) { api.world.items.remove(q.revive); q.revive = null; }
        if (q.revive && s) { q.revive.pos.x = s.x; q.revive.pos.y = s.y + 0.3; q.revive.pos.z = s.z; q.bleed = s.b; }
      }
      sendT -= dt;
      if (sendT > 0 || !p) return;
      sendT = SEND;
      const e = p.inv?.equip || {}, k = it => it ? MODEL_OF[it.id] || null : null;
      send('*', { t: 'st', id: NET.id, s: {
        x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z), vx: r2(p.vel.x), vy: r2(p.vel.y), vz: r2(p.vel.z), f: r2(p.facing),
        m: p.mode, c: p.crouch ? 1 : 0, sp: p.sprinting ? 1 : 0, a: p.aiming || p.firing ? 1 : 0, g: p.grounded ? 1 : 0,
        r: r2(p.rollT), d: r2(p.deathT), dn: r2(p.downT || 0), b: Math.ceil(p.bleed || 0), h: hidden ? 1 : 0, ly: r2(p.look.yaw), lp: r2(p.look.pitch), w: p.wpn?.active || 'unarmed',
        gear: [k(e.weapon1), k(e.weapon2), k(e.melee)], hp: Math.round(p.health), mh: p.maxHealth } });
    },
    // every drawn frame: the others, about 0.12 s behind
    frame(dt) {
      const at = clock - DELAY;
      for (const q of mates.values()) {
        const b = q.buf;
        if (!b.length) continue;
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > at) i--;
        const A = b[Math.max(0, i - 1)], B = b[i], span = B.t - A.t, k = span > 1e-4 ? Math.min(1, Math.max(0, (at - A.t) / span)) : 1;
        const s = B.s, sa = A.s;
        const x = lerp(sa.x, s.x, k), y = lerp(sa.y, s.y, k), z = lerp(sa.z, s.z, k), f = sa.f + angDiff(sa.f, s.f) * k;
        const R = q.raider;
        R.root.visible = !s.h;
        R.root.position.set(x, y - BODY.offset, z);
        R.root.rotation.y = f + Math.PI;
        const sig = s.gear.join(',');
        if (sig !== q.gearSig) { q.gearSig = sig; R.setGear({ weapon1: s.gear[0], weapon2: s.gear[1], melee: s.gear[2] }); }
        const fx = -Math.sin(f), fz = -Math.cos(f), speed = Math.hypot(s.vx, s.vz);
        R.update(dt, {
          mode: s.m, speed, fwd: s.vx * fx + s.vz * fz, side: -(s.vx * -fz + s.vz * fx), grounded: !!s.g, vy: s.vy,
          crouch: !!s.c, sprint: !!s.sp, aim: !!s.a, rollT: (s.r || 0) / ROLL.time, deathT: s.d, downT: s.dn, lookYaw: angDiff(f, s.ly), lookPitch: s.lp,
          hand: { active: s.w, draw: 1, reloadK: -1, swingK: -1, throwK: -1, nade: false, shots: 0 }, ground: footing,
        });
      }
    },
    dispose() {
      send('*', { t: 'st:gone', id: NET.id });
      for (const id of [...mates.keys()]) drop(id);
      on('st', null); on('st:gone', null); on('revive', null); offDrop();
    },
  };
}
