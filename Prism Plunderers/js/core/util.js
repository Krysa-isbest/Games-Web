// Small helpers with no dependencies.
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent smoothing: moves a towards b, faster with a higher k
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const $ = id => document.getElementById(id);

// Seeded random numbers (mulberry32). The same seed gives the same sequence on every computer, which is
// what lets all players in a lobby build the same map from one number.
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(next.range(a, b + 1));
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.chance = p => next() < p;
  return next;
}
// turns text (a room code, a map name) into a seed
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Object pool: bullets, particles, gas clouds and robots are reused instead of created and thrown away,
// so the browser's garbage collector never causes a stutter in the middle of a fight.
export class Pool {
  constructor(make, { reset = null, size = 0 } = {}) {
    this.make = make; this.reset = reset;
    this.idle = []; this.live = [];
    for (let i = 0; i < size; i++) this.idle.push(make());
  }
  get() {
    const o = this.idle.pop() || this.make();
    o._pi = this.live.length;
    this.live.push(o);
    return o;
  }
  put(o) {
    const i = o._pi;
    if (i === undefined || this.live[i] !== o) return;       // not live: ignore a double release
    const last = this.live.pop();
    if (last !== o) { this.live[i] = last; last._pi = i; }
    o._pi = undefined;
    this.reset?.(o);
    this.idle.push(o);
  }
  // backwards, so put() is safe to call on the object being visited
  each(fn) { for (let i = this.live.length - 1; i >= 0; i--) fn(this.live[i]); }
  clear() { while (this.live.length) this.put(this.live[this.live.length - 1]); }
}
