// Things you use with the interact key: a tap (hold = 0) or a hold of `hold` seconds. Stations in the test range
// now, loot containers and doors later.
//
//   { id, pos: {x,y,z}, radius, hold: seconds or (player) => seconds,
//     label: (player) => text, or null when there is nothing to do right now,
//     use: (player) => {} }
import { fwdX, fwdZ } from './move-math.js';

export class Interactions {
  constructor() { this.items = []; }
  add(it) { this.items.push(it); return it; }
  remove(it) { const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); }
  // (the skill tree's Light Fingers and Steady make every hold shorter: p.stats.hold)
  holdOf(it, p) { return (typeof it.hold === 'function' ? it.hold(p) : (it.hold || 0)) * (it.fixed ? 1 : p?.stats?.hold ?? 1); }   // (fixed: a revive)

  // The best thing in reach: the closest one, preferring what the camera looks at.
  pick(p) {
    let best = null, score = Infinity;
    const fx = fwdX(p.look.yaw), fz = fwdZ(p.look.yaw);
    for (const it of this.items) {
      const dx = it.pos.x - p.pos.x, dz = it.pos.z - p.pos.z, dy = it.pos.y - (p.pos.y + 1);
      const d = Math.hypot(dx, dz);
      if (d > it.radius || Math.abs(dy) > 1.8) continue;
      const ahead = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const s = d - ahead * 0.8;
      if (s < score) { score = s; best = it; }
    }
    return best;
  }
}
