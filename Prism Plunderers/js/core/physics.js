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
