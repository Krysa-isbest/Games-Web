// Who is awake in The Ruins. The map holds about 120 robots in groups (prism.js: Fink and Fly patrols, guards,
// Swatters, the Roach, Scatter nests), but only the groups near you are real robots: a group wakes up when you come
// within its radius and goes back to sleep (its robots removed, the survivors remembered) when you are far away and
// none of them is after you. At most CAP robots are awake at a time (step 5d): the nearest groups wake first, and a
// group close to you may send a calm one far from you to sleep to make room. A group after you always stays awake.
// While asleep, a patrol keeps moving along its route on paper, so it is somewhere else when you come back. A group
// wiped out comes back after 10 minutes (DESIGN 11), except the Roach.
// Robots that belong to no group (reinforcements from drop pods) are removed when far away and calm; they are not
// counted against the cap.
import { PRISM } from '../../game/prism/defs.js';

const WAKE = 150, SLEEP = 210, RESPAWN = 600, CAP = 30;
const ROOM_NEAR = 110, ROOM_FAR = 130;     // a group nearer than ROOM_NEAR may put calm groups further than ROOM_FAR to sleep

export class PrismSpawner {
  constructor(director, groups, { wake = WAKE, sleep = SLEEP, respawn = RESPAWN, cap = CAP } = {}) {
    this.dir = director; this.wake = wake; this.sleep = sleep; this.respawn = respawn; this.cap = cap;
    this.time = 0;
    this.groups = groups.map(g => ({
      ...g, alive: g.members.length, active: false, robots: [], respawnAt: -1, s: 0,
      len: g.route ? routeLength(g.route, !g.routeBack) : 0,
    }));
  }
  // p: the player, or (part 12) the squad's players: a group wakes for whoever is near, sleeps when all are far
  step(dt, p) {
    const ps = (Array.isArray(p) ? p : [p]).filter(q => q && !q.dead && !q.out);
    // how far the nearest player is (part 12: a squad wakes groups near any of them, they sleep when all are far)
    this.far = (x, z) => { let m = Infinity; for (const q of ps) m = Math.min(m, Math.hypot(x - q.pos.x, z - q.pos.z)); return m; };
    this.time += dt;
    const owned = new Set(), want = [];
    for (const g of this.groups) {
      if (g.alive <= 0) {
        if (g.respawnAt < 0 && !g.noRespawn) g.respawnAt = this.time + this.respawn;
        if (g.respawnAt >= 0 && this.time >= g.respawnAt) { g.alive = g.members.length; g.respawnAt = -1; }
      }
      if (!g.active) {
        if (g.route) g.s += dt * (g.speed || 1.5);                       // the patrol carries on, on paper
        if (g.alive > 0 && ps.length) {
          const at = this.anchor(g), d = this.far(at.x, at.z);
          if (d < (g.radius || this.wake)) want.push({ g, at, d });
        }
        continue;
      }
      // count the fallen
      const before = g.robots.length;
      g.robots = g.robots.filter(r => !r.dead && !r.gone);
      g.alive -= before - g.robots.length;
      for (const r of g.robots) owned.add(r);
      if (!g.robots.length) { g.active = false; continue; }
      const lead = g.robots[0];
      const far = !ps.length || this.far(lead.pos.x, lead.pos.z) > Math.max(this.sleep, (g.radius || this.wake) + 60);
      if (far && !g.robots.some(r => r.hostile)) this.putToSleep(g);
    }
    if (want.length) {
      this.wakeNearest(want);
      for (const g of this.groups) if (g.active) for (const r of g.robots) owned.add(r);
    }
    // reinforcements nobody owns: gone once you are far away and they have calmed down
    for (const r of [...this.dir.robots]) {
      if (owned.has(r) || r.dead || r.hostile || !ps.length) continue;
      if (this.far(r.pos.x, r.pos.z) > this.sleep + 40) this.dir.remove(r);
    }
  }
  // robots awake in the groups (the cap counts these)
  get robotsAwake() { let n = 0; for (const g of this.groups) if (g.active) n += g.robots.length; return n; }
  // wakes the groups that want to, the nearest first, while the cap allows
  wakeNearest(want) {
    want.sort((a, b) => a.d - b.d);
    let n = this.robotsAwake;
    for (const w of want) {
      const size = Math.min(w.g.alive, w.g.members.length);
      if (n + size > this.cap && w.d < ROOM_NEAR) n -= this.makeRoom(n + size - this.cap);
      if (n + size > this.cap) continue;
      this.wakeUp(w.g, w.at);
      n += w.g.robots.length;
    }
  }
  // puts calm groups far from you to sleep, the furthest first, until `need` robots are freed; returns how many were
  makeRoom(need) {
    const far = [];
    for (const g of this.groups) {
      if (!g.active || !g.robots.length || g.robots.some(r => r.hostile)) continue;
      const d = this.far(g.robots[0].pos.x, g.robots[0].pos.z);
      if (d > ROOM_FAR) far.push({ g, d });
    }
    far.sort((a, b) => b.d - a.d);
    let freed = 0;
    for (const q of far) {
      if (freed >= need) break;
      freed += q.g.robots.length;
      this.putToSleep(q.g);
    }
    return freed;
  }
  // where a sleeping group is: its patrol position, or its home
  anchor(g) {
    if (g.active && g.robots.length) return g.robots[0].pos;
    if (g.route) return pointOn(g.route, g.s, !g.routeBack, g.len);
    return g.pos;
  }
  wakeUp(g, at) {
    g.active = true;
    g.robots = [];
    const n = Math.min(g.alive, g.members.length);
    for (let k = 0; k < n; k++) {
      const type = g.members[k], d = PRISM[type];
      const off = g.kind === 'nest' ? { x: (k - 1) * 1.3, z: (k % 2) * 1.2 } : { x: (k - (n - 1) / 2) * 3.2, z: (k % 2) * 2.5 };
      const y = g.kind === 'nest' || !d.flyer ? at.y ?? g.pos.y : (g.pos.y || 4) + (k % 3) * 0.6;
      const pos = this.room({ x: at.x + off.x, y, z: at.z + off.z }, d.radius);
      const r = this.dir.spawn(type, pos, {
        yaw: (k * 1.3) % (Math.PI * 2), group: g.id,
        route: g.route || null, routeBack: !!g.routeBack, routeOff: g.route && n > 1 ? off : null, routeAlt: g.alt ?? null, hover: g.hover || null,
      });
      g.robots.push(r);
    }
  }
  // a free spot at or near pos (a shelf or a table may stand right where a nest is): a small spiral search
  room(pos, radius) {
    const ph = this.dir.phys;
    if (!ph) return pos;
    const r = Math.max(0.25, radius), lift = r + 0.05;
    for (let k = 0; k < 13; k++) {
      const a = k * 2.4, d = k ? 0.6 + k * 0.35 : 0;
      const p = { x: pos.x + Math.cos(a) * d, y: pos.y, z: pos.z + Math.sin(a) * d };
      if (ph.free({ x: p.x, y: p.y + lift + 0.1, z: p.z }, 0.05, r)) return p;
    }
    return pos;
  }
  putToSleep(g) {
    const lead = g.robots[0];
    if (g.route && lead) g.s = nearestS(g.route, lead.pos, !g.routeBack);
    for (const r of g.robots) this.dir.remove(r);
    g.robots = [];
    g.active = false;
  }
  get awake() { return this.groups.filter(g => g.active).length; }
  debug() {
    const a = this.groups.filter(g => g.active);
    return `the Ruins: ${a.length} of ${this.groups.length} Prism groups awake, ${this.robotsAwake} of at most ${this.cap} robots (${a.map(g => g.members[0] + 'x' + g.robots.length).join(' ')}), ` +
      `${this.groups.filter(g => g.alive <= 0).length} wiped out`;
  }
}

// ---------- routes on paper ----------
function routeLength(route, loop) {
  let s = 0;
  for (let i = 0; i < route.length - (loop ? 0 : 1); i++) { const a = route[i], b = route[(i + 1) % route.length]; s += Math.hypot(b.x - a.x, b.z - a.z); }
  return s;
}
// a point at distance s along the route (round the loop, or there and back)
function pointOn(route, s, loop, len) {
  if (route.length < 2 || len <= 0) return { x: route[0].x, z: route[0].z };
  let d = loop ? s % len : s % (2 * len);
  if (!loop && d > len) d = 2 * len - d;
  for (let i = 0; i < route.length - (loop ? 0 : 1); i++) {
    const a = route[i], b = route[(i + 1) % route.length], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= l) { const k = l > 0 ? d / l : 0; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; }
    d -= l;
  }
  return { x: route[route.length - 1].x, z: route[route.length - 1].z };
}
function nearestS(route, p, loop) {
  let best = 0, bd = Infinity, acc = 0;
  for (let i = 0; i < route.length - (loop ? 0 : 1); i++) {
    const a = route[i], b = route[(i + 1) % route.length], l = Math.hypot(b.x - a.x, b.z - a.z);
    const k = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (l * l))) : 0;
    const d = Math.hypot(a.x + (b.x - a.x) * k - p.x, a.z + (b.z - a.z) * k - p.z);
    if (d < bd) { bd = d; best = acc + k * l; }
    acc += l;
  }
  return best;
}
export { pointOn, routeLength };
