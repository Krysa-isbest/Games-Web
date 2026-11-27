// The Ruins (parts 5 and 6): an 800 m ruined city, played as a raid (js/game/raid.js, DESIGN 6). You come down in a
// drop pod at one of six drop zones on the edge with the starting kit; the Prism patrol the streets, guard their
// posts and nests, and wake up as you come near (world/ruins/spawner.js). The map (M) and the compass show the
// districts, the landmarks and the three extraction points. 20 minutes to get out at one of them, or lose what you
// carry.
import { createPlayScene } from './play.js';
import { buildRuins } from '../world/ruins/build.js';
import { PrismSpawner } from '../world/ruins/spawner.js';
import { createRaid, giveStartKit } from '../game/raid.js';
import { loadoutEmpty, takeLoadout, bagSlots } from '../game/economy.js';
import { P } from '../core/save.js';
import { playerStats } from '../game/stats.js';
import { skillMods } from '../game/skills.js';
import { threat, scaleGroups, podTypes } from '../game/pacing.js';
import { rng } from '../core/util.js';
import { bus } from '../core/events.js';
import { NET } from '../net/net.js';
import { raidStatus, Squad } from '../net/squad.js';
import { createRemotes } from '../net/remotes.js';
import { createWorldSync } from '../net/world.js';

// what you go in with: your loadout (part 8: it leaves the stash for good), or the free starting kit when it is
// empty; the backpack is as big as yours
function raidKit(p) {
  if (!loadoutEmpty()) { takeLoadout(p); return; }
  p.inv.bag = Array(bagSlots()).fill(null);
  giveStartKit(p);
}

export const RUINS_SEED = 3000;

export default function createRuins() {
  return createPlayScene({
    id: 'ruins', label: 'The Ruins · raid', loading: 'Dropping into The Ruins', seed: RUINS_SEED,
    sky: { fog: 0.0042, shadowSpan: 60, far: 300 }, near: 0.1, far: 800, drawRange: 240,
    build: (scene, phys, glow) => buildRuins(scene, phys, glow, RUINS_SEED),
    kit: raidKit,
    stats: () => playerStats(skillMods()),                  // (part 9: the skill tree)
    // (part 12) a squad comes down at the same drop zone (from the shared seed), side by side in squad order
    spawn: (api, world) => {
      const c = api.params.coop;
      if (!c || !world.spawnPoint) return null;
      const sp = { ...world.spawnPoint(rng(c.seed), null) }, i = Math.max(0, (c.members || []).findIndex(m => m.id === NET.id));
      const side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 3.2, yaw = sp.yaw || 0;
      sp.x += Math.cos(yaw) * side; sp.z -= Math.sin(yaw) * side;
      return sp;
    },
    setup: api => {
      const coop = api.params.coop || null;
      const t = threat();                                     // (part 11: difficulty grows with your raids)
      api.prism.reinforcements = podTypes(t);
      const spawner = new PrismSpawner(api.prism, scaleGroups(api.world.layout.prism, t));
      // (the squad leader stays while a friend is still in: their Prism run here)
      const stay = coop ? () => NET.role === 'host' && Squad.members.some(m => m.id !== NET.id && m.status === 'raid') : null;
      const raid = createRaid(api, { seed: coop ? coop.seed : ((Date.now() & 0xffff) ^ (P.stats.raids * 7919)) >>> 0, threat: t, stay });
      const mates = coop ? createRemotes(api, coop, api.footing) : null;
      const shared = coop ? createWorldSync(api, mates) : null;          // (the Prism: the leader's game runs them)
      const guest = coop && NET.role === 'guest';
      // the leader gone mid-raid: like leaving (DESIGN 5), you keep only the safe pocket
      const offLeft = guest ? bus.on('squad:left', () => { if (!raid.raid.done) { raid.quit(); raid.quit(); } }) : null;
      return {
        spawner, raid: raid.raid, mates, shared,
        frozen: raid.frozen, camera: raid.camera, hideRaider: raid.hideRaider, died: raid.died, deathText: raid.deathText, quit: raid.quit,
        step: dt => {
          if (!guest) spawner.step(dt, shared ? shared.players() : api.player);
          raid.step(dt); mates?.step(dt, api.player, raid.hideRaider()); shared?.step(dt);
        },
        frame: dt => { raid.frame(dt); mates?.frame(dt); },
        debug: () => spawner.debug() + '\n' + raid.debug() + `   map: ${api.world.stats.boxes} boxes, ${api.world.stats.colliders} colliders, ${api.world.stats.meshes} meshes, ${api.world.stats.containers} containers` +
          (mates ? `   squad: ${mates.mates.size} others seen` : ''),
        dispose: () => { offLeft?.(); raid.dispose(); shared?.dispose(); if (mates) { mates.dispose(); raidStatus('lobby'); } },
      };
    },
  });
}
