// Whiteout: food and water (build step 5).
// Hunger and thirst drain slowly (faster on harder difficulties, and when you sprint). Hungry or thirsty, the cold
// gets to you faster; starving or parched, you slow down too. Well fed, the cold gets to you a little slower.
// Eat or drink what you hold with the eat key (Q). Salted nuts and champagne from the plane; fish you catch.
// Raw fish fills you less and can make you sick: cook it on the burning stove. Water: fill the pot with snow
// (look down at the snow and hold the use key), melt it on the stove, drink it while it's warm. Eating snow
// with empty hands quenches a little thirst but costs body heat.
// Fishing: chop a hole in the sea ice with an axe (a few blows), hold the fishing rod and use the hole. Wait for a
// bite, then hold the left mouse button to reel in, and let go before the line snaps. Deep water far out gives
// bigger fish, and fish bite better at night. Cold hands make the line jumpy.
// Co-op: what you eat and catch is yours; the holes in the ice belong to the world (the host's game keeps them).
import * as THREE from 'three';
import { clamp } from './state.js';
import { kn } from './keys.js';
import { TYPES, nameOf } from './items.js';
import { SEA, DAY } from './island.js';
import { smooth } from './scene.js';
import * as SFX from './sfx.js';

let H = null;      // helpers from work.js: { act, hint, shout, dropAt }
const _v = new THREE.Vector3();

export function initFood(gm, helpers) {
  H = helpers;
  const p = gm.player;
  p.hunger ??= 75; p.thirst ??= 65;
  gm.foodMul = 1; gm.foodSlow = 1; gm.fish = null; gm.iceHit = null; gm.potT = 0;
  gm.dom.root.insertAdjacentHTML('beforeend', `<div class="gm-fish hidden"><b></b><div class="gf-row"><small>Line</small><div class="gf-bar t"><i></i></div></div><div class="gf-row"><small>Fish</small><div class="gf-bar d"><i></i></div></div></div>`);
  const q = s => gm.dom.root.querySelector(s);
  Object.assign(gm.dom, { fish: q('.gm-fish'), fishT: q('.gm-fish b'), fishTen: q('.gm-fish .t i'), fishDist: q('.gm-fish .d i'), fishRows: gm.dom.root.querySelectorAll('.gm-fish .gf-row') });
}

// ---------- every frame: hunger, thirst, what they do to you ----------
export function foodTick(gm, dt, env, diff) {
  const p = gm.player;
  if (gm.started && !gm.waitState && gm.life?.st !== 'dead') {
    const k = (diff.food || 1) * (p.sprinting ? 1.4 : 1) * (gm.ts || 1);          // the night runs faster while the crew sleeps
    p.hunger = Math.max(0, p.hunger - dt * 100 / (DAY * 1.6) * k);       // a day and a half from full to empty on Harsh
    p.thirst = Math.max(0, p.thirst - dt * 100 / (DAY * 1.1) * k);       // a little over a day
  }
  // what it does: the cold gets in faster when you're hungry or thirsty; at zero you slow down too
  const hu = p.hunger, th = p.thirst;
  gm.foodMul = (hu > 85 ? 0.9 : 1) * (1 + 0.15 * smooth(25, 5, hu) + 0.25 * smooth(5, 0, hu)) * (1 + 0.1 * smooth(25, 5, th) + 0.2 * smooth(5, 0, th));
  gm.foodSlow = 1 - 0.15 * smooth(5, 0, hu) - 0.15 * smooth(5, 0, th);
  if (gm.started) {
    if (hu < 25) H.hint(gm, 'hungry', `You're hungry, and the cold gets to you faster. Eat something (${kn('eat')} eats what you hold). Fish are under the sea ice.`, 7000, true);
    if (th < 25) H.hint(gm, 'thirsty', `You're thirsty. Melt snow in the pot on the stove and drink it. Eating snow (${kn('eat')} with empty hands) costs body heat.`, 7000, true);
  }
  // a pot of water cools down in your hands (its "dry" number is how warm it is)
  gm.potT -= dt;
  if (gm.potT <= 0) {
    gm.potT = 1;
    let changed = false;
    for (const s of gm.inv.slots) if (s?.type === 'potwater' && s.dry > 0) { s.dry = Math.max(0, s.dry - 1 / 120); changed = true; }
    if (changed) gm.inv.ver++;
  }
  fishTick(gm, dt, env);
}

// ---------- eating and drinking (the eat key) ----------
export function eat(gm) {
  const p = gm.player, inv = gm.inv, s = inv.held(), t = s && TYPES[s.type];
  if (s?.type === 'potwater') {
    const warm = s.dry > 0.3;
    p.thirst = Math.min(100, p.thirst + 45); if (warm) p.heat = Math.min(100, p.heat + 10 * s.dry);
    inv.slots[inv.sel] = { type: 'pot', n: 1, dry: 1 }; inv.ver++;
    SFX.drink?.();
    H.hint(gm, 'drank', warm ? 'Warm water. It goes down like a fire in your chest.' : 'Cold water: better than nothing. Warm it on the stove next time.', 5000, true);
    return;
  }
  if (s?.type === 'potsnow') { H.hint(gm, 'frozen', 'It\'s snow. Melt it on the burning stove first.', 4000, true); gm.hints.delete('frozen'); return; }
  if (t?.food) {
    const f = t.food;
    inv.take(inv.sel, 1);
    p.hunger = clamp(p.hunger + (f.hunger || 0), 0, 100); p.thirst = clamp(p.thirst + (f.thirst || 0), 0, 100); p.heat = clamp(p.heat + (f.heat || 0), 0, 100);
    if (f.drink) SFX.drink?.(); else SFX.munch?.();
    if (s.type === 'champ') H.hint(gm, 'champ', 'The bubbles go straight to your head. It feels warm, but it isn\'t: it takes the heat out of you.', 6000, true);
    if (f.raw) {
      H.hint(gm, 'raw', 'Raw fish. It fills you less than cooked, and it might not stay down. Cook it on the burning stove.', 6000, true);
      if (Math.random() < 0.4) setTimeout(() => {           // food poisoning
        if (!gm.player) return;
        p.hunger = Math.max(0, p.hunger - 18); p.thirst = Math.max(0, p.thirst - 14); p.heat = Math.max(0, p.heat - 6);
        SFX.cough(1.1); H.hint(gm, 'sick' + Date.now(), 'Your stomach turns, and the fish comes back up. You feel weak and cold.', 5000, true);
      }, 8000);
    }
    return;
  }
  if (!s && !gm.inShack && !gm.inCab && (p.surface === 'snow' || p.surface === 'ice')) {
    p.thirst = Math.min(100, p.thirst + 6); p.heat = Math.max(0, p.heat - 5);
    SFX.munch?.();
    H.hint(gm, 'snoweat', 'A mouthful of snow. A little less thirsty, a little colder. Melting it in the pot is better.', 6000, true);
  }
}

// ---------- the stove, the snow, the holes: what you can do (work.js offers it) ----------
// with something in your hands at the stove: cook, melt, warm (null = nothing to do here)
export function stoveAct(gm, held, temp) {
  const ht = held?.type;
  if (!ht) return null;
  const hot = temp > 0.35, cold = { id: 'cold', text: 'The stove isn\'t hot enough to cook on: light it and let it warm up', hold: 0 };
  if (TYPES[ht].cook) return hot ? { id: 'cook', text: `Cook ${nameOf(ht)} on the stove`, hold: 5, sound: true, go: () => swapHeld(gm, ht, TYPES[ht].cook, 1, 'The fish sizzles and turns golden.') } : cold;
  if (ht === 'potsnow') return hot ? { id: 'melt', text: 'Melt the snow on the stove', hold: 6, sound: true, go: () => swapHeld(gm, 'potsnow', 'potwater', 1, 'The snow melts into warm water. Drink it before it cools.') } : cold;
  if (ht === 'potwater' && held.dry < 0.9) return hot ? { id: 'warm', text: 'Warm the water on the stove', hold: 3, go: () => swapHeld(gm, 'potwater', 'potwater', 1) } : cold;
  return null;
}
function swapHeld(gm, from, to, n, hint) {
  const inv = gm.inv, s = inv.held();
  if (!s || s.type !== from) return;
  if (from === to) { s.dry = 1; inv.ver++; return; }
  if (TYPES[from].stack > 1 && s.n > 1) {          // one fish off a stack: the cooked one goes wherever there's room
    inv.take(inv.sel, n);
    const left = inv.add(to, n, { dry: 1 });
    if (left) H.dropAt(gm, to, left, { dry: 1 });
  } else { inv.slots[inv.sel] = { type: to, n: s.n, dry: 1 }; inv.ver++; }
  SFX.sizzle?.();
  if (hint) H.hint(gm, 'did-' + to, hint, 5000, true);
}
// holding the empty pot, looking down at the snow outside
export function fillAct(gm) {
  const p = gm.player;
  if (gm.inv.heldType() !== 'pot' || gm.inShack || gm.inCab || p.pitch > -0.35 || (p.surface !== 'snow' && p.surface !== 'ice')) return null;
  return { id: 'fill', text: 'Fill the pot with snow', hold: 1.5, go: () => { swapHeld(gm, 'pot', 'potsnow', 1); SFX.pack(); } };
}
// holding the rod, looking at a hole in the ice
export function holeAct(gm, look) {
  if (gm.inv.heldType() !== 'rod' || gm.fish) return null;
  let best = null, sc = 0;
  for (const h of gm.world.holes.values()) { const s = look(h.pos, 2.6, 0.75); if (s > sc) { sc = s; best = h; } }
  return best ? [sc + 0.05, { id: 'fishhere', text: 'Fish through the hole', hold: 0.4, go: () => startFishing(gm, best) }] : null;
}
// an axe blow on the sea ice: a few in the same spot make a hole (true = it was the ice)
export function iceBlow(gm, hit, at, dmg) {
  if (!gm.world.iceCol || hit.collider.handle !== gm.world.iceCol.handle || at.y > SEA + 0.25) return false;
  const near = [...gm.world.holes.values()].some(h => Math.hypot(h.x - at.x, h.z - at.z) < 1.2);
  if (near) { H.hint(gm, 'hole-near', 'There\'s a hole right here already.', 3000, true); gm.hints.delete('hole-near'); return true; }
  const c = gm.iceHit;
  if (c && Math.hypot(c.x - at.x, c.z - at.z) < 0.8 && performance.now() - c.at < 8000) { c.n += dmg; c.at = performance.now(); }
  else gm.iceHit = { x: at.x, z: at.z, n: dmg, at: performance.now() };
  if (gm.iceHit.n >= 4) {
    H.act(gm, { a: 'hole', x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100 });
    gm.iceHit = null;
    H.hint(gm, 'hole', 'A hole in the ice. Fish through it with the fishing rod (there\'s one on the bunk in the shack). It freezes over in a day.', 7000, true);
  } else H.hint(gm, 'icechop', 'Keep chopping in the same spot to break through the ice.', 4000, true);
  return true;
}
// the host: a new hole (not next to another one)
export function makeHole(gm, x, z) {
  const w = gm.world;
  if ([...w.holes.values()].some(h => Math.hypot(h.x - x, h.z - z) < 1.2)) return;
  w.addHole(w.holeN, x, z, Math.round(gm.T));
  SFX.at(gm.camera.position.distanceTo(_v.set(x, SEA, z)), SFX.splash);
}
// the host: holes freeze over after a day
export function freezeHoles(gm) { for (const h of [...gm.world.holes.values()]) if (gm.T - h.at > DAY && !(gm.fish && gm.fish.hole === h)) gm.world.removeHole(h.id); }

// ---------- fishing ----------
function startFishing(gm, hole) {
  const env = gm.env, night = env.light < 0.3, depth = -gm.world.groundY(hole.x, hole.z);
  const deep = depth > 3.3;
  gm.fish = { hole, phase: 'wait', t: 0, wait: (6 + Math.random() * 12) * (night ? 0.7 : 1) * (deep ? 1.25 : 1), tension: 0, dist: 1, tug: 0, tugT: 1,
    big: Math.random() < (deep ? 0.45 : 0.08) + (night ? 0.15 : 0), deep, from: gm.player.pos.clone() };
  SFX.splash?.();
  H.hint(gm, 'fishing', `Wait for a bite. When it bites, hold ${kn('primary')} to reel it in, and let go before the line snaps. Walk away to stop.`, 8000, true);
}
function stopFishing(gm, text, ok) {
  gm.fish = null;
  gm.dom.fish.classList.add('hidden');
  if (text) H.hint(gm, 'f' + Date.now(), text, 3500, true);
  if (ok === false) SFX.splash?.();
}
function fishTick(gm, dt, env) {
  const f = gm.fish, d = gm.dom;
  if (!f) return;
  const p = gm.player, held = gm.inv.heldType();
  if (held !== 'rod' || p.pos.distanceTo(f.from) > 1.2 || gm.fainting || !gm.world.holes.has(f.hole.id)) { stopFishing(gm, f.phase === 'wait' ? '' : 'You stop fishing.'); return; }
  f.t += dt;
  const reel = gm.inp.is('primary') && gm.locked;
  let txt = '';
  if (f.phase === 'wait') {
    txt = 'Waiting for a bite…';
    if (f.t >= f.wait) { f.phase = 'bite'; f.t = 0; SFX.splash?.(); }
  } else if (f.phase === 'bite') {
    txt = `A bite! Hold ${kn('primary')} to reel it in!`;
    if (reel) { f.phase = 'reel'; f.t = 0; }
    else if (f.t > 2.5) { stopFishing(gm, 'It got away. Wait for the next one.', false); startFishing(gm, f.hole); return; }
  } else {
    // the fish pulls in bursts; holding reels it in and pulls the line tight; cold hands shake
    const pull = f.big ? 1.45 : 1, shake = smooth(40, 5, p.heat) * 0.5 * (Math.random() - 0.3);
    f.tugT -= dt; if (f.tugT <= 0) { f.tug = Math.random() * 0.9 * pull; f.tugT = 0.6 + Math.random() * 1.4; }
    f.tug = Math.max(0, f.tug - dt * 1.5);
    if (reel) { f.tension += (0.35 * pull + f.tug + shake) * dt; f.dist -= (f.tension < 0.85 ? 0.17 : 0.06) * dt; }
    else { f.tension = Math.max(0, f.tension - 0.75 * dt); f.dist += (0.05 + f.tug * 0.08) * pull * dt; }
    txt = f.tension > 0.8 ? 'The line is about to snap! Let go!' : reel ? 'Reeling in…' : 'Hold it… reel when the line slackens';
    if (reel && Math.random() < dt * 8) SFX.reel?.();
    if (f.tension >= 1) { stopFishing(gm, 'The line snapped tight and the fish tore free.', false); return; }
    if (f.dist >= 1.35) { stopFishing(gm, 'The fish swam off with the bait.', false); return; }
    if (f.dist <= 0) {
      const type = f.big ? 'bigfish' : 'fish', left = gm.inv.add(type, 1, { dry: 1 });
      if (left) H.dropAt(gm, type, left, { dry: 1 });
      SFX.splash?.();
      stopFishing(gm, f.big ? 'A big one! Cook it on the stove.' : 'A fish! Cook it on the stove, or eat it raw if you must.', true);
      H.hint(gm, 'caught', 'Fish rot slowly in the cold, but cooked fish fills you far more than raw.', 6000);
      return;
    }
  }
  d.fish.classList.remove('hidden');
  d.fishT.textContent = txt;
  const show = f.phase === 'reel';
  d.fishRows.forEach(r => r.classList.toggle('hidden', !show));
  d.fishTen.style.width = (clamp(f.tension, 0, 1) * 100).toFixed(1) + '%';
  d.fishTen.parentElement.classList.toggle('bad', f.tension > 0.8);
  d.fishDist.style.width = (clamp(1 - f.dist, 0, 1) * 100).toFixed(1) + '%';
}
