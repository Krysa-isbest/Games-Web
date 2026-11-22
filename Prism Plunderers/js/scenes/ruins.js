// The Ruins (part 5): the whole 1.2 km city, free roam for now. You drop in at one of six drop zones on the
// edge with the starting kit; the Prism patrol the streets, guard their roosts and nests, and wake up as you come
// near (world/ruins/spawner.js). The map (M) and the compass show the districts, the landmarks and the three
// extraction points; the raid rules (timer, extraction, losing your gear for good) come in part 6. Until then,
// dying puts you back at another drop zone with the kit.
import { createPlayScene } from './play.js';
import { buildRuins } from '../world/ruins/build.js';
import { PrismSpawner } from '../world/ruins/spawner.js';

export const RUINS_SEED = 3000;

export default function createRuins() {
  return createPlayScene({
    id: 'ruins', label: 'The Ruins', loading: 'Dropping into The Ruins', seed: RUINS_SEED,
    sky: { fog: 0.0042, shadowSpan: 60, far: 300 }, near: 0.1, far: 800, drawRange: 240,
    build: (scene, phys, glow) => buildRuins(scene, phys, glow, RUINS_SEED),
    setup: api => {
      const spawner = new PrismSpawner(api.prism, api.world.layout.prism);
      return {
        spawner,
        step: dt => spawner.step(dt, api.player),
        debug: () => spawner.debug() + `   map: ${api.world.stats.boxes} boxes, ${api.world.stats.colliders} colliders, ${api.world.stats.meshes} meshes, ${api.world.stats.containers} containers`,
      };
    },
  });
}
