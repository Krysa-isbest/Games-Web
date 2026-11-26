// The Ruins (parts 5 and 6): an 800 m ruined city, played as a raid (js/game/raid.js, DESIGN 6). You come down in a
// drop pod at one of six drop zones on the edge with the starting kit; the Prism patrol the streets, guard their
// posts and nests, and wake up as you come near (world/ruins/spawner.js). The map (M) and the compass show the
// districts, the landmarks and the three extraction points. 20 minutes to get out at one of them, or lose what you
// carry.
import { createPlayScene } from './play.js';
import { buildRuins } from '../world/ruins/build.js';
import { PrismSpawner } from '../world/ruins/spawner.js';
import { createRaid, giveStartKit } from '../game/raid.js';
import { P } from '../core/save.js';

export const RUINS_SEED = 3000;

export default function createRuins() {
  return createPlayScene({
    id: 'ruins', label: 'The Ruins · raid', loading: 'Dropping into The Ruins', seed: RUINS_SEED,
    sky: { fog: 0.0042, shadowSpan: 60, far: 300 }, near: 0.1, far: 800, drawRange: 240,
    build: (scene, phys, glow) => buildRuins(scene, phys, glow, RUINS_SEED),
    kit: giveStartKit,
    setup: api => {
      const spawner = new PrismSpawner(api.prism, api.world.layout.prism);
      const raid = createRaid(api, { seed: ((Date.now() & 0xffff) ^ (P.stats.raids * 7919)) >>> 0 });
      return {
        spawner, raid: raid.raid,
        frozen: raid.frozen, camera: raid.camera, hideRaider: raid.hideRaider, died: raid.died, deathText: raid.deathText, quit: raid.quit,
        step: dt => { spawner.step(dt, api.player); raid.step(dt); },
        frame: dt => raid.frame(dt),
        debug: () => spawner.debug() + '\n' + raid.debug() + `   map: ${api.world.stats.boxes} boxes, ${api.world.stats.colliders} colliders, ${api.world.stats.meshes} meshes, ${api.world.stats.containers} containers`,
        dispose: () => raid.dispose(),
      };
    },
  });
}
