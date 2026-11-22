// The building kit for The Ruins. Everything in the city is made of boxes, written as plain data that the
// builder (build.js) turns into merged meshes and physics. Nothing here touches three.js or Rapier, so the same
// seed builds the same city on every computer.
//
//   a box:   { x, y, z, w, h, d, rx, ry, rz, c, k, col }   y = its centre; rotation in Euler YXZ order (yaw first)
//   k:       SOLID (casts shadows), GLOW (lights that glow in the dark), FLAT (paint on the ground)
//   a pane:  { x, y, z, w, h, n }  a window drawn as a single dark quad on a wall facing n ('n' | 's' | 'e' | 'w')
import { rng } from '../../core/util.js';

export const K = { SOLID: 0, GLOW: 2, FLAT: 3 };
export const FLOOR = 3.4, WALL = 0.3, SLAB = 0.3;
const DEG = Math.PI / 180;

// the desert city's colours
export const COL = {
  plaster: [0xcbb491, 0xc1a983, 0xd6c6a4, 0xb79f7b, 0xd0b48c, 0xbfa88a, 0xc9a47e],
  stone: [0xb59a76, 0xa88d69, 0xc4a881, 0x9f8768],
  white: [0xd9d0bd, 0xcfc5b0, 0xe0d6c2],
  tower: 0xa79a88,
  trim: 0x8e7a60, darkTrim: 0x6d5d49,
  slab: 0x9b8a72, floor: 0x7f705c, inner: 0xb6a487,
  rubble: [0xa89a82, 0x968874, 0xb9aa90, 0x857866, 0x9d8b70],
  asphalt: 0x4b4540, lane: 0xb7a05c, plaza: 0xa49378, paving: 0x958671,
  sand: 0xd2b98f, drift: 0xdcc59c, scorch: 0x2b2421,
  rust: [0x7b4630, 0x8a5536, 0x6a4a35], metal: [0x5b5f66, 0x6e7177, 0x4d5157],
  car: [0x7b4630, 0x5a6064, 0x8e7d5c, 0x4c5a62, 0x6e3a2e, 0xa08c6a, 0x3f3b38],
  container: [0x8a3b2b, 0x3e5a6e, 0xa0742c, 0x4f5e3c, 0x6d6f73, 0x7a5236],
  door: [0x5a3d2b, 0x3f5a5c, 0x6e2f2a, 0x4a4f3a],
  awning: [0x9a4a32, 0x3f6a73, 0xb08a3a, 0x7d6a55],
  palm: 0x6b5843, frond: 0x6f6942,
  sandbag: 0xa8946c, barrier: 0xb3aa98,
  crate: 0x4f5a37, locker: 0x5f666e, medcab: 0xd8d6cf, toolbox: 0xa8352b, case: 0x2a2c31, cache: 0x1c1328,
  lamp: 0xffc777, green: 0x5dff9b, prism: 0xa36bff, red: 0xff5a4d, amber: 0xffb224,
};

export class Kit {
  constructor(seed) {
    this.R = rng(seed);
    this.boxes = []; this.panes = [];
  }
  pick(arr) { return arr[Math.floor(this.R() * arr.length)]; }
  range(a, b) { return a + this.R() * (b - a); }

  // a box standing on y0 (bottom), axis-aligned or turned by ry
  box(x, y0, z, w, h, d, c, { col = true, k = K.SOLID, ry = 0 } = {}) {
    if (w <= 0.005 || h <= 0.005 || d <= 0.005) return null;
    const b = { x, y: y0 + h / 2, z, w, h, d, rx: 0, ry, rz: 0, c, k, col };
    this.boxes.push(b);
    return b;
  }
  // a box by its centre, turned any way (rubble, ramps, wrecks)
  cbox(x, y, z, w, h, d, c, { rx = 0, ry = 0, rz = 0, col = true, k = K.SOLID } = {}) {
    const b = { x, y, z, w, h, d, rx, ry, rz, c, k, col };
    this.boxes.push(b);
    return b;
  }
  // A ramp: a slab whose top surface runs from p0 (low) to p1 (high). The low end sinks a little into what it
  // stands on (no lip to trip on); the high end stops exactly at p1, the edge of the floor it leads to.
  ramp(p0, p1, width, thick, c, opts = {}) {
    const dx = p1.x - p0.x, dz = p1.z - p0.z, dy = p1.y - p0.y, hl = Math.hypot(dx, dz);
    const a = Math.atan2(dy, hl), yaw = Math.atan2(dx, dz), e = 0.3;
    const ux = dx / hl * Math.cos(a), uy = Math.sin(a), uz = dz / hl * Math.cos(a);     // along the slope
    const nx = -dx / hl * Math.sin(a), ny = Math.cos(a), nz = -dz / hl * Math.sin(a);   // the slope's up
    const len = Math.hypot(hl, dy) + e;
    const mx = (p0.x - ux * e + p1.x) / 2, my = (p0.y - uy * e + p1.y) / 2, mz = (p0.z - uz * e + p1.z) / 2;
    return this.cbox(mx - nx * thick / 2, my - ny * thick / 2, mz - nz * thick / 2, width, thick, len, c, { rx: -a, ry: yaw, ...opts });
  }
  // A wall along x (at z) or along z (at x), from a0 to a1, standing on y0, with openings
  // [{ a: centre along the wall, w, b: bottom, t: top }] (heights above y0). jag lowers the top of solid parts
  // at random (a broken wall).
  wall(axis, at, a0, a1, y0, height, openings, c, { t = WALL, jag = 0, col = true } = {}) {
    const piece = (p0, p1, h0, h1) => {
      if (p1 - p0 < 0.02 || h1 - h0 < 0.02) return;
      const cx = (p0 + p1) / 2, len = p1 - p0;
      if (axis === 'x') this.box(cx, y0 + h0, at, len, h1 - h0, t, c, { col });
      else this.box(at, y0 + h0, cx, t, h1 - h0, len, c, { col });
    };
    const solidTop = () => height - (jag > 0 && this.R() < jag ? this.range(0.3, 0.75) * height : 0);
    let cur = a0;
    for (const o of [...openings].sort((p, q) => p.a - q.a)) {
      const l = Math.max(a0, o.a - o.w / 2), r = Math.min(a1, o.a + o.w / 2);
      if (r <= l) continue;
      if (l > cur + 0.02) piece(cur, l, 0, solidTop());
      if (o.b > 0.02) piece(l, r, 0, o.b);
      if (o.t < height - 0.02) piece(l, r, o.t, jag > 0 && this.R() < jag ? o.t + (height - o.t) * this.R() : height);
      cur = Math.max(cur, r);
    }
    if (a1 > cur + 0.02) piece(cur, a1, 0, solidTop());
  }
  // a floor slab over a rectangle, with an optional rectangular hole (a stairwell)
  slab(x0, z0, x1, z1, yTop, c, hole = null, { thick = SLAB, col = true } = {}) {
    const y0 = yTop - thick;
    const rect = (a, b, cc, d) => { if (cc - a > 0.02 && d - b > 0.02) this.box((a + cc) / 2, y0, (b + d) / 2, cc - a, thick, d - b, c, { col }); };
    if (!hole) { rect(x0, z0, x1, z1); return; }
    const hx0 = Math.max(x0, hole.x0), hx1 = Math.min(x1, hole.x1), hz0 = Math.max(z0, hole.z0), hz1 = Math.min(z1, hole.z1);
    rect(x0, z0, x1, hz0);
    rect(x0, hz1, x1, z1);
    rect(x0, hz0, hx0, hz1);
    rect(hx1, hz0, x1, hz1);
  }
  // window panes along a wall: dark quads on the outside face, n = which way the wall faces
  panesAlong(n, at, a0, a1, y, w, h, gap, skip = 0.2) {
    const len = a1 - a0, count = Math.floor((len - 1.2) / gap);
    if (count < 1) return;
    const start = a0 + (len - (count - 1) * gap) / 2;
    for (let i = 0; i < count; i++) {
      if (this.R() < skip) continue;
      const a = start + i * gap;
      if (n === 'n' || n === 's') this.panes.push({ x: a, y, z: at, w, h, n });
      else this.panes.push({ x: at, y, z: a, w, h, n });
    }
  }
  // a pile of broken concrete you can climb or hide behind
  rubble(x, z, size = 3, n = 5) {
    for (let i = 0; i < n; i++) {
      const s = size * this.range(0.25, 0.6);
      const ox = this.range(-0.5, 0.5) * size, oz = this.range(-0.5, 0.5) * size;
      this.cbox(x + ox, s * 0.18, z + oz, s * this.range(0.8, 1.4), s * this.range(0.35, 0.7), s * this.range(0.7, 1.2), this.pick(COL.rubble),
        { rx: this.range(-0.35, 0.35), ry: this.R() * Math.PI, rz: this.range(-0.35, 0.35) });
    }
    for (let i = 0; i < n; i++) {                                     // small bits, only to look at
      const s = this.range(0.15, 0.5);
      this.cbox(x + this.range(-0.8, 0.8) * size, s * 0.3, z + this.range(-0.8, 0.8) * size, s, s * 0.6, s * 1.2, this.pick(COL.rubble),
        { ry: this.R() * Math.PI, rz: this.range(-0.4, 0.4), col: false });
    }
  }
  // a burnt-out car. Returns where its boot is (for loot).
  car(x, z, yaw, { flipped = false, c = null } = {}) {
    const col = c ?? this.pick(COL.car), s = Math.sin(yaw), cs = Math.cos(yaw);
    const at = (fx, fz) => ({ x: x + fx * cs + fz * s, z: z - fx * s + fz * cs });
    if (flipped) {
      this.cbox(x, 0.75, z, 1.8, 0.9, 4.3, col, { ry: yaw, rz: Math.PI });
      this.cbox(x, 0.3, z, 1.6, 0.6, 2.2, this.pick(COL.metal), { ry: yaw, col: false });
    } else {
      this.cbox(x, 0.72, z, 1.85, 0.85, 4.3, col, { ry: yaw });
      const cab = at(0, -0.2);
      this.cbox(cab.x, 1.42, cab.z, 1.62, 0.62, 2.2, col, { ry: yaw, col: false });
      for (const [fx, fz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
        const w = at(fx, fz);
        this.cbox(w.x, 0.3, w.z, 0.3, 0.6, 0.62, 0x221f1d, { ry: yaw, col: false });
      }
    }
    return at(0, -2.4);
  }
  // a dead palm: a leaning trunk and a few dry fronds
  palm(x, z, h) {
    const lean = this.range(-0.18, 0.18), yaw = this.R() * Math.PI * 2;
    const tx = x + Math.sin(yaw) * Math.sin(lean) * h, tz = z + Math.cos(yaw) * Math.sin(lean) * h;
    this.cbox((x + tx) / 2, h / 2, (z + tz) / 2, 0.38, h, 0.38, COL.palm, { rx: lean, ry: yaw });
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + this.R();
      this.cbox(tx + Math.sin(a) * 1.1, h - 0.4, tz + Math.cos(a) * 1.1, 0.25, 0.06, 2.6, COL.frond, { rx: 0.55, ry: a, col: false });
    }
  }
}

// how a loot container looks: boxes (with the facing ry = into the room)
export function containerLook(kit, type, x, y, z, ry) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const off = (f, r = 0) => ({ x: x + s * f + c * r, z: z + c * f - s * r });
  if (type === 'crate') {
    kit.cbox(x, y + 0.38, z, 1.15, 0.76, 0.78, COL.crate, { ry });
    kit.cbox(x, y + 0.78, z, 1.2, 0.06, 0.82, 0x3c4529, { ry, col: false });
  } else if (type === 'locker') {
    kit.cbox(x, y + 0.95, z, 0.62, 1.9, 0.5, COL.locker, { ry });
    const f = off(0.26);
    kit.cbox(f.x, y + 1.55, f.z, 0.4, 0.08, 0.02, 0x2d3034, { ry, col: false });
  } else if (type === 'medcab') {
    kit.cbox(x, y + 1.35, z, 0.82, 0.9, 0.3, COL.medcab, { ry });
    const f = off(0.16);
    kit.cbox(f.x, y + 1.35, f.z, 0.36, 0.1, 0.02, COL.green, { ry, k: K.GLOW, col: false });
    kit.cbox(f.x, y + 1.35, f.z, 0.1, 0.36, 0.02, COL.green, { ry, k: K.GLOW, col: false });
  } else if (type === 'toolbox') {
    kit.cbox(x, y + 0.42, z, 1.3, 0.84, 0.6, 0x6b5a46, { ry });                    // a workbench
    kit.cbox(x, y + 1.0, z, 0.62, 0.32, 0.32, COL.toolbox, { ry, col: false });
  } else if (type === 'case') {
    kit.cbox(x, y + 0.42, z, 1.3, 0.84, 0.62, 0x4a4036, { ry });                   // a table
    kit.cbox(x, y + 1.0, z, 1.15, 0.3, 0.48, COL.case, { ry, col: false });
    kit.cbox(x, y + 1.0, z, 1.17, 0.06, 0.5, COL.amber, { ry, k: K.GLOW, col: false });
  } else if (type === 'cache') {
    kit.cbox(x, y + 0.32, z, 0.9, 0.64, 0.9, COL.cache, { ry: ry + 0.785 });
  }
}
export const CONTAINER_H = { crate: 0.8, locker: 1.9, medcab: 1.8, toolbox: 1.2, case: 1.2, cache: 0.7, car: 1.3 };
export { DEG };
