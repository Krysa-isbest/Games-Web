// Physics: Rapier (a WASM physics engine) for collisions, the character controller and ray casts. The same
// pinned version as Whiteout. It is downloaded the first time a scene needs it, so the lobby never waits.
// The bare name resolves through the import map in index.html (and through node_modules in the offline tests).
let loading = null;
export function loadPhysics() {
  if (!loading) {
    loading = import('@dimforge/rapier3d-compat')
      .then(async m => { const R = m.default || m; await R.init(); return R; })
      .catch(e => { loading = null; throw e; });
  }
  return loading;
}

// Collision groups. The upper 16 bits say what a collider is, the lower 16 bits what it touches.
export const G = { WORLD: 1, PLAYER: 2, ENEMY: 4, QUERY: 8 };
export const groups = (member, filter) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;

export class Physics {
  constructor(R, dt) {
    this.R = R;
    this.world = new R.World({ x: 0, y: 0, z: 0 });      // gravity is our own code's job
    this.world.timestep = dt;
    this._o = { x: 0, y: 0, z: 0 };
    this._d = { x: 0, y: -1, z: 0 };
    this._ray = new R.Ray(this._o, this._d);
    this._caps = new Map();
    this._rot = { x: 0, y: 0, z: 0, w: 1 };
  }

  // A fixed box. pos = its centre, size = full width / height / depth, quat = rotation {x,y,z,w} (optional).
  box(pos, size, quat = null) {
    const d = this.R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(pos.x, pos.y, pos.z)
      .setCollisionGroups(groups(G.WORLD, 0xffff));
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return this.world.createCollider(d);
  }

  // A fixed triangle mesh: many boxes' worth of world in one collider. This Rapier rebuilds its scene-query tree
  // on every step, so a city of tens of thousands of separate boxes would cost tens of milliseconds a step;
  // a few hundred meshes cost almost nothing (each keeps its own tree, built once).
  mesh(vertices, indices) {
    const d = this.R.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(G.WORLD, 0xffff));
    return this.world.createCollider(d);
  }

  // Flat ground at height y over x0..x1, z0..z1, minus rectangular holes { x0, z0, x1, z1 }: small quads in a
  // triangle mesh, one mesh per `chunk` metres. Never one big box: Rapier's character controller sinks into large
  // colliders. On a 2.2 km ground box the raider ran 15-21 cm deep in the ground (the "legs clip through the
  // road" of v0.5) and fell through it standing still; 100 m pieces still sink about 1 cm; 25 m pieces and
  // smaller stay on top (measured offline, see .tests/feet-check.mjs). Returns how many meshes it made.
  ground(x0, z0, x1, z1, { y = 0, tile = 20, holes = [], chunk = 100 } = {}) {
    let made = 0;
    for (let cx = x0; cx < x1 - 1e-6; cx += chunk) for (let cz = z0; cz < z1 - 1e-6; cz += chunk) {
      const v = [], ix = [];
      for (let tx = cx; tx < Math.min(cx + chunk, x1) - 1e-6; tx += tile) for (let tz = cz; tz < Math.min(cz + chunk, z1) - 1e-6; tz += tile) {
        let rects = [{ x0: tx, z0: tz, x1: Math.min(tx + tile, cx + chunk, x1), z1: Math.min(tz + tile, cz + chunk, z1) }];
        for (const h of holes) rects = cutRects(rects, h);
        for (const r of rects) {
          const b = v.length / 3;
          v.push(r.x0, y, r.z0, r.x1, y, r.z0, r.x1, y, r.z1, r.x0, y, r.z1);
          ix.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
      }
      if (ix.length) { this.mesh(new Float32Array(v), new Uint32Array(ix)); made++; }
    }
    return made;
  }
  // Axis-aligned boxes { x, y, z, w, h, d } (centre, full sizes) as one fixed triangle mesh. Long walls should be
  // cut into pieces of about 20 m first (see ground()).
  boxes(list) {
    const v = [], ix = [];
    for (const b of list) {
      const base = v.length / 3;
      for (let c = 0; c < 8; c++) v.push(b.x + (c & 1 ? 0.5 : -0.5) * b.w, b.y + (c & 2 ? 0.5 : -0.5) * b.h, b.z + (c & 4 ? 0.5 : -0.5) * b.d);
      for (const t of BOX_TRIS) ix.push(base + t);
    }
    return ix.length ? this.mesh(new Float32Array(v), new Uint32Array(ix)) : null;
  }

  // The first world surface along a ray. dir must have length 1.
  // Returns { t } (distance), or { t, nx, ny, nz } with withNormal, or null when nothing is hit.
  ray(o, dir, max, filter = G.WORLD, withNormal = false) {
    this._o.x = o.x; this._o.y = o.y; this._o.z = o.z;
    this._d.x = dir.x; this._d.y = dir.y; this._d.z = dir.z;
    const g = groups(G.QUERY, filter);
    if (withNormal) {
      const h = this.world.castRayAndGetNormal(this._ray, max, true, undefined, g);
      return h ? { t: h.timeOfImpact, nx: h.normal.x, ny: h.normal.y, nz: h.normal.z } : null;
    }
    const h = this.world.castRay(this._ray, max, true, undefined, g);
    return h ? { t: h.timeOfImpact } : null;
  }

  capsule(halfHeight, radius) {
    const k = halfHeight.toFixed(3) + ':' + radius.toFixed(3);
    let s = this._caps.get(k);
    if (!s) { s = new this.R.Capsule(halfHeight, radius); this._caps.set(k, s); }
    return s;
  }
  // true when an upright capsule centred at `center` touches nothing of the world
  free(center, halfHeight, radius, filter = G.WORLD) {
    return !this.world.intersectionWithShape(center, this._rot, this.capsule(halfHeight, radius), undefined, groups(G.QUERY, filter));
  }

  step() { this.world.step(); }
  dispose() { this.world.free(); }
}

// a box's 12 triangles (facing out) over its 8 corners (corner c: x = bit 0, y = bit 1, z = bit 2)
const BOX_TRIS = [0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6];
// rectangles { x0, z0, x1, z1 } with the rectangle h taken out of them
export function cutRects(rects, h) {
  const out = [];
  for (const r of rects) {
    if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) { out.push(r); continue; }
    const ax = Math.max(r.x0, h.x0), bx = Math.min(r.x1, h.x1);
    const pieces = [
      { x0: r.x0, z0: r.z0, x1: ax, z1: r.z1 }, { x0: bx, z0: r.z0, x1: r.x1, z1: r.z1 },
      { x0: ax, z0: r.z0, x1: bx, z1: Math.max(r.z0, h.z0) }, { x0: ax, z0: Math.min(r.z1, h.z1), x1: bx, z1: r.z1 },
    ];
    for (const p of pieces) if (p.x1 - p.x0 > 1e-4 && p.z1 - p.z0 > 1e-4) out.push(p);
  }
  return out;
}
// a long wall along x or z cut into boxes about `piece` metres long (for Physics.boxes)
export function wallPieces(x0, z0, x1, z1, y0, y1, piece = 20) {
  const out = [], alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.ceil(len / piece));
  for (let i = 0; i < n; i++) {
    const a = (alongX ? x0 : z0) + len * i / n, b = (alongX ? x0 : z0) + len * (i + 1) / n;
    out.push(alongX ? { x: (a + b) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: b - a, h: y1 - y0, d: z1 - z0 }
      : { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (a + b) / 2, w: x1 - x0, h: y1 - y0, d: b - a });
  }
  return out;
}
