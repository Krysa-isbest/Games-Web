// The test range: walk the course as your raider, in third person, and fight the Prism in the arena to the
// north (a robot console there spawns each of them; they patrol the arena until they notice you). Running,
// sprinting and stamina, jumping, crouching, sliding, the dodge roll, falling, health and the three shields can
// all be tried, against training sentries, a gas pit and the five Prism robots, with stations to swap shields,
// repair them and heal. You start with the full kit; the supply crate by the spawn restocks it.
// Everything about playing (the player, weapons, inventory, HUD...) is in play.js.
import { createPlayScene } from './play.js';
import { buildRange } from '../world/range.js';

export { KIT, giveKit } from './play.js';
const MAX_ROBOTS = 24;

export default function createTestRange() {
  return createPlayScene({
    id: 'test', label: 'Test range', loading: 'Loading the test range', seed: 2999,
    build: (scene, phys, glow) => buildRange(scene, phys, glow),
    setup: api => { consoleButtons(api); return {}; },
  });
}

// ---------- the robot console in the arena ----------
function consoleButtons(api) {
  const range = api.world, prism = api.prism, A = range.arena, s = A.spots, R = A.routes;
  const full = () => { if (prism.robots.length >= MAX_ROBOTS) { api.hud.pop('Too many robots: clear some first', 'bad'); return true; } return false; };
  const facing = Math.PI;                         // towards the console
  const spread = i => ({ x: (i - 1) * 2.2, z: (i % 2) * 1.6 });
  let g = 0;
  const actions = [
    ['Spawn a Fink', () => prism.spawn('fink', s.fink, { yaw: facing, route: R.fink })],
    ['Spawn 3 Flies', () => {
      const grp = 'flies' + (++g);
      for (let i = 0; i < 3; i++) prism.spawn('fly', { x: s.fly.x + (i - 1) * 1.8, y: s.fly.y + i * 0.4, z: s.fly.z }, { yaw: facing, group: grp, route: R.fly, routeOff: spread(i) });
    }],
    ['Spawn a Swatter with 2 Flies', () => {
      const grp = 'swat' + (++g);
      prism.spawn('swatter', s.swatter, { yaw: facing, group: grp, route: R.swatter });
      [-2.5, 2.5].forEach((dx, i) => prism.spawn('fly', { x: s.swatter.x + dx, y: s.swatter.y - 1, z: s.swatter.z + 1 }, { yaw: facing, group: grp, route: R.swatter, routeOff: { x: dx * 1.4, z: 3 + i } }));
    }],
    ['Wake 3 Scatters in the nest', () => s.scatter.forEach(q => prism.spawn('scatter', q, { yaw: -Math.PI / 2 }))],
    ['Spawn a Roach', () => prism.spawn('roach', s.roach, { yaw: facing, route: R.roach })],
    ['Call a drop pod on yourself', () => prism.reinforce(api.player.pos, null)],
    ['Clear all robots', () => { prism.clear(); api.hud.pop('Arena cleared', 'good'); }],
    [p => `Invincible: ${p.god ? 'on' : 'off'} (press to switch)`, p => { p.god = !p.god; api.hud.pop(p.god ? 'Invincible: on' : 'Invincible: off', p.god ? 'good' : ''); }],
  ];
  actions.forEach(([label, act], i) => {
    const post = A.posts[i];
    range.items.add({
      id: 'console' + i, pos: post, radius: 0.95, hold: 0,
      label: typeof label === 'function' ? label : () => label,
      use: p => { if (i < 6 && full()) return; act(p); },
    });
  });
}
