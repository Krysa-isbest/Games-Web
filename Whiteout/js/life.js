// Whiteout: staying alive with your crew (build step 6, design.md 7d and 7f).
// Health: frozen stiff (body heat at zero), starving or parched, it drains; warm and fed, it comes back slowly.
// Downed at zero health: you lie in the snow, the screen frosts over, and a timer runs (faster in a storm). A friend
//   can carry you (you lie over their shoulders, they walk slowly and can't sprint, G puts you down) to the fire
//   or the stove: once your body heat is back above 30 you get up. The first aid kit gets you up anywhere.
// Death: Mild and Harsh in co-op, you wake up the next morning on the floor of the shack, Exhausted and Gloomy, and
//   what you carried lies where you died (and gets buried in the snow like anything else). Brutal and Whiteout:
//   dead is dead, you watch the others. Solo: back to the last morning's save (Mild, Harsh), or game over.
//   Everyone dead: the end, with the days you lasted.
// Spectating (dead or asleep): follow your crew (click or the arrows to switch), and the ghost roulette (R).
// Sleep: the bunk at night (one bunk, the rest sleep on the floor beside it). Nobody can sleep through the night
//   safely: the stove goes out. When the whole crew sleeps the night runs 12 times as fast, when some of them
//   keep watch 3 times. The cold, smoke and the morning wake you up, so can a friend (hold the use key on them).
//   Solo: you set how often you get up to check the fire. A good night in the warm gives you Rested for the day;
//   being woken up spoils it.
// Together: friends close by (3.5 m) keep you warmer. Soaked (from the sea): the cold gets in much faster until
//   you dry by the stove or a fire.
// Who is in which state goes out with every position message (game.js g-p `ls` and `cb`).
import * as THREE from 'three';
import { G, S, clamp } from './state.js';
import { kn } from './keys.js';
import { send, on } from './net.js';
import * as ISL from './island.js';
import { smooth } from './scene.js';
import * as SFX from './sfx.js';
import { TYPES } from './items.js';
import { LS } from './voice.js';
import { readSave, clearSave } from './save.js';
import { openRoulette } from './roulette.js';

let GL = null, H = null;          // the game, and helpers from game.js: { hint, chat, lock, quit, reload, drop, closeUI }
const DOWN_T = { easy: 90, normal: 75, hard: 60, whiteout: 50 };
const PERMA = d => d === 'hard' || d === 'whiteout';
const CODE = { up: LS.up, down: LS.down, dead: LS.dead, swim: LS.swim, sleep: LS.sleep, carried: LS.carried };
const KEYS = ['use', 'primary', 'secondary', 'drop', 'left', 'right', 'slot1', 'slot2', 'slot3', 'slot4'];
const NIGHT_HOUR = 45;            // world seconds in an hour of the night (island.js: 12 hours in 9 minutes)
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3();
const diffNow = () => G.lobby.opts.diff || 'normal';

export function initLife(gm, helpers) {
  GL = gm; H = helpers;
  const p = gm.player;
  p.hp ??= 100; p.wet ??= 0; p.rest ??= 70;
  gm.ts = 1;
  gm.life = { st: 'up', downT: 0, downMax: 75, carrier: null, carrying: null, pulling: null, pullPh: 0, zone: 0.5, pullT: 0, perma: false, respawnT: 0, deadReal: 0,
    restedUntil: -1e9, gloomUntil: -1e9, woken: false, spot: 0, wakeEvery: 2, nextWake: 0, specI: 0, specPid: null, prevK: new Set(), beatT: 0, endT: 0, ended: false, together: 0 };
  gm.dom.root.insertAdjacentHTML('beforeend', `<div class="gm-hp hidden"><small>Health</small><div class="gm-bar"><i></i></div></div><div class="gm-buffs"></div>
    <div class="gm-life hidden"><b></b><p></p><div class="gl-bar"><i></i></div><small></small></div>
    <div class="gm-pull hidden"><small>Pull! Click when the mark is in the light part</small><div class="gp-bar"><u></u><i></i></div><small class="gp-k"></small></div>
    <div class="gm-carry hidden"></div>
    <div class="gm-end hidden"><div class="panel"><div class="kicker">Flight 2207</div><h2></h2><p></p><div class="gm-endb"></div></div></div>`);
  const q = s => gm.dom.root.querySelector(s);
  Object.assign(gm.dom, { hp: q('.gm-hp'), hpBar: q('.gm-hp i'), buffs: q('.gm-buffs'), life: q('.gm-life'), lifeT: q('.gm-life b'), lifeP: q('.gm-life p'), lifeBar: q('.gl-bar i'), lifeBox: q('.gl-bar'), lifeK: q('.gm-life small'),
    pull: q('.gm-pull'), pullMark: q('.gp-bar i'), pullZone: q('.gp-bar u'), carry: q('.gm-carry'), end: q('.gm-end') });
}
const nameOf = pid => G.lobby.players.find(x => x.id === pid)?.name || GL?.args.players?.find(x => x.id === pid)?.name || 'Someone';
export const lifeCode = gm => CODE[gm.life?.st] ?? 0;
export const spectating = gm => gm.life?.st === 'sleep' || gm.life?.st === 'dead';
const lsOf = a => a?.to?.ls ?? LS.up;

// ---------- every frame ----------
export function lifeTick(gm, dt, env) {
  const L = gm.life, p = gm.player, ts = gm.ts || 1;
  if (L.ended || !gm.started || gm.waitState) { L.prevK = new Set(KEYS.filter(a => gm.inp.is(a))); return; }
  const pressed = a => gm.inp.is(a) && !L.prevK.has(a);
  switch (L.st) {
    case 'up': health(gm, dt * ts); carryTick(gm, pressed); pullTick(gm, dt, pressed); break;
    case 'down': case 'carried': downed(gm, dt, env); break;
    case 'sleep': sleeping(gm, dt, env, pressed); break;
    case 'dead': if (!L.perma && gm.T >= L.respawnT && performance.now() - L.deadReal > 60000) respawn(gm); break;
  }
  if (spectating(gm) && gm.locked) {
    if (pressed('primary') || pressed('right')) L.specI++;
    if (pressed('secondary') || pressed('left')) L.specI--;
  }
  L.prevK = new Set(KEYS.filter(a => gm.inp.is(a)));
  // the rest you need: it runs out over a day and a half awake
  if (L.st === 'up' || L.st === 'down' || L.st === 'carried') p.rest = Math.max(0, p.rest - dt * ts * 100 / (ISL.DAY * 1.4));
  // wet clothes dry by the stove or a fire, slowly in a warm shack, hardly at all outside
  if (p.wet > 0) p.wet = Math.max(0, p.wet - dt * ts * (0.002 + (gm.byStove || 0) * 0.05 + (gm.byFire || 0) * 0.04 + (gm.inShack ? gm.home.air * 0.02 : 0)));
  // friends close by
  let n = 0;
  if (L.st !== 'dead') for (const a of gm.avatars.values()) { const ls = lsOf(a); if (ls !== LS.dead && ls !== LS.swim && a.pos.distanceTo(p.pos) < 3.5) n++; }
  if (L.st === 'carried') n = Math.max(n, 1);
  L.together = n;
  // the host: is anyone left alive?
  if (gm.role === 'host' && gm.coop) {
    const all = [L.st === 'dead', ...[...gm.avatars.values()].map(a => lsOf(a) === LS.dead)];
    if (all.every(Boolean)) { L.endT += dt; if (L.endT > 3) endAll(gm, true); } else L.endT = 0;
  }
  if (L.st === 'up') {
    if (p.wet > 0.3) H.hint(gm, 'soaked', 'You are soaked. Wet clothes let the cold straight in: dry off by the stove or a fire.', 6000, true);
    if (p.rest < 20) H.hint(gm, 'tired', 'You are exhausted: you move slower and can\'t sprint. Sleep in the bunk tonight.', 6000, true);
    if (L.together && gm.coop) H.hint(gm, 'together', 'Close to your crew, the cold gets to you slower. Stick together.', 6000);
  }
}
// how the cold treats you now (game.js survive): drain and gain multipliers, and how fast you move
export function lifeMods(gm) {
  const L = gm.life, p = gm.player, T = gm.T;
  let drain = 1, gain = 1, slow = 1;
  if (L.together) drain *= L.together >= 2 ? 0.72 : 0.85;
  if (p.wet > 0) drain *= 1 + 1.6 * p.wet;
  if (T < L.restedUntil) { drain *= 0.92; slow *= 1.06; }
  if (T < L.gloomUntil) gain *= 0.8;
  if (p.rest < 20) slow *= 0.88;
  if (L.carrying) slow *= 0.62;
  if (L.st === 'down' || L.st === 'carried') drain *= 0.7;           // curled up, out of the worst of it
  if (L.st === 'sleep') drain *= 0.8;
  p.heavy = !!L.carrying || p.rest < 10;
  return { drain, gain, slow };
}

// ---------- health ----------
function health(gm, dt) {
  const p = gm.player;
  let d = 0;
  if (p.heat <= 0.5) d -= 1.5;
  if (p.hunger <= 0) d -= 0.06;
  if (p.thirst <= 0) d -= 0.1;
  if (!d && p.heat > 35 && p.hunger > 15 && p.thirst > 15) d = 0.22;
  p.hp = clamp(p.hp + d * dt, 0, 100);
  if (p.heat <= 0.5) H.hint(gm, 'freezing', 'You are freezing to death. Get to a fire, now.', 5000, true);
  if (p.hp <= 0) goDown(gm);
}
export function goDown(gm) {
  const L = gm.life, p = gm.player;
  if (L.st !== 'up') return;
  putDown(gm); L.pulling = null;
  H.closeUI(gm);
  gm.hands.lit = false;
  L.st = 'down'; L.downMax = L.downT = DOWN_T[diffNow()] || 75; L.beatT = 0;
  p.hp = 0; p.setMode('lie');
  SFX.land(6, p.surface);
  tell('down');
  H.hint(gm, 'downed' + Date.now(), gm.coop ? 'You collapse in the snow. Your crew can carry you to the fire, or patch you up with the first aid kit.' : 'You collapse in the snow. Nobody is coming: only warmth can bring you back now.', 7000, true);
}
function downed(gm, dt, env) {
  const L = gm.life, p = gm.player;
  if (L.st === 'carried') {           // over a friend's shoulders
    const a = gm.avatars.get(L.carrier);
    if (!a || lsOf(a) !== LS.up) { L.carrier = null; L.st = 'down'; p.setMode('lie'); p.teleport(p.pos.x, Math.max(gm.world.groundY(p.pos.x, p.pos.z), ISL.SEA) + 0.2, p.pos.z); }
    else { p.hold(a.pos.x, a.pos.y + 1.12, a.pos.z); p.lieYaw = a.yaw + Math.PI / 2; }
  }
  L.downT -= dt * (env.storm > 0.5 ? 1.5 : 1) * (L.st === 'carried' ? 0.5 : 1) * (p.heat > 15 ? 0.5 : 1);
  L.beatT -= dt;
  if (L.beatT <= 0) { L.beatT = 0.55 + 1.2 * (1 - L.downT / L.downMax); SFX.beat(0.4 + 0.6 * (L.downT / L.downMax)); }
  if (p.heat >= 30) getUp(gm, 'warm');
  else if (L.downT <= 0) die(gm, 'cold');
}
function getUp(gm, why) {
  const L = gm.life, p = gm.player;
  if (L.st !== 'down' && L.st !== 'carried') return;
  const carried = L.st === 'carried', a = carried ? gm.avatars.get(L.carrier) : null;
  if (L.carrier) send(L.carrier, { t: 'g-help', k: 'up' });
  L.carrier = null; L.st = 'up';
  p.hp = Math.max(p.hp, why === 'kit' ? 45 : 25); if (why === 'kit') p.heat = Math.max(p.heat, 30);
  p.rest = Math.min(p.rest, 25);
  p.setMode(null);
  if (carried) { const x = (a ? a.pos.x : p.pos.x) + Math.cos(p.yaw) * 0.7, z = (a ? a.pos.z : p.pos.z) - Math.sin(p.yaw) * 0.7, y = a ? a.pos.y : p.pos.y - 1.1; p.teleport(x, y + 0.1, z); }
  else p.teleport(p.pos.x, p.pos.y + 0.15, p.pos.z);
  tell('up');
  H.hint(gm, 'revived' + Date.now(), why === 'kit' ? 'The bandages and the painkillers get you back on your feet. You are weak, and cold.' : 'The warmth brings you back. You are weak, and exhausted.', 6000, true);
}
// ---------- dying ----------
export function die(gm, why) {
  const L = gm.life, p = gm.player, diff = diffNow();
  if (L.st === 'dead' || L.ended) return;
  if (L.carrier) send(L.carrier, { t: 'g-help', k: 'gone' });
  L.carrier = null; putDown(gm); L.pulling = null;
  H.closeUI(gm);
  gm.hands.lit = false;
  if (!gm.coop) { soloEnd(gm, why); return; }
  // what you carried: in the snow where you died (in the sea it sinks, all but the axe and the pipe, which end up on the ice)
  const inv = gm.inv, sank = why === 'ice';
  inv.slots.forEach((s, i) => {
    if (!s) return;
    if (!sank || s.type === 'axe' || s.type === 'pipe' || s.type === 'saxe') {
      const a = Math.random() * 6.28, r = sank ? 1.6 : Math.random() * 0.7;
      H.drop(gm, s.type, s.n, { dry: s.dry ?? 1 }, [p.pos.x + Math.cos(a) * r, Math.max(p.pos.y, ISL.SEA) + 0.4, p.pos.z + Math.sin(a) * r]);
    }
    inv.slots[i] = null;
  });
  inv.ver++;
  L.st = 'dead'; L.perma = PERMA(diff); L.deadReal = performance.now();
  L.respawnT = (Math.floor(gm.T / ISL.DAY) + 1) * ISL.DAY;
  p.setMode('dead'); p.hp = 0; p.heat = 50; p.wet = 0;
  tell(L.perma ? 'perma' : 'dead');
  H.chat(null, L.perma ? 'You are dead. For you the island is over: watch over your crew.' : 'You died. You wake up in the shack tomorrow morning, with nothing.');
}
function respawn(gm) {
  const L = gm.life, p = gm.player, b = gm.world.shack.bunk, sp = b.spots[freeSpot(gm, 1)];
  L.st = 'up'; p.setMode(null);
  p.teleport(sp.x, sp.y + 0.1, sp.z); p.yaw = b.yaw;
  p.heat = 45; p.hp = 60; p.rest = 10; p.wet = 0;
  L.gloomUntil = L.respawnT + ISL.SUN_UP;        // until the evening
  tell('back');
  H.hint(gm, 'reborn' + Date.now(), 'You wake up on the floor of the shack, stiff and miserable. Whatever you carried lies where you died: go back for it before the snow covers it.', 8000, true);
}
// the end of a solo game: back to the last morning, or game over
function soloEnd(gm, why) {
  const L = gm.life, p = gm.player, perma = PERMA(diffNow());
  L.ended = true; L.st = 'dead'; p.setMode('dead');
  const save = perma ? null : readSave('solo');
  if (perma) clearSave('solo');
  const day = gm.env.day;
  showEnd(gm, why === 'ice' ? 'The ice took you' : 'You froze to death',
    perma ? `You lasted until day ${day}. On ${ISL.DIFF[diffNow()].name}, that is the end.` : save ? `On day ${day} the cold won. The island gives you one more try: the last morning.` : `On day ${day} the cold won. There is no saved morning to go back to.`,
    save ? [['Back to the last morning', () => H.reload(gm, save)], ['Quit to the menu', () => H.quit(gm)]] : [['Quit to the menu', () => H.quit(gm)]]);
}
// everyone is dead (the host decides and tells the crew)
function endAll(gm, sendIt) {
  const L = gm.life;
  if (L.ended) return;
  L.ended = true;
  const day = gm.env.day, perma = PERMA(diffNow());
  if (sendIt) { send('*', { t: 'g-end', day, perma }); if (perma) clearSave('coop'); }
  showEnd(gm, 'Nobody is left', `The island took the whole crew. You lasted until day ${day}.${perma ? '' : ' The host can continue from the last morning\'s save.'}`, [['Quit to the menu', () => H.quit(gm)]]);
}
on('g-end', m => { const gm = GL; if (gm && gm.ready && gm.role === 'guest') { gm.env.day = m.day || gm.env.day; endAll(gm, false); } });
function showEnd(gm, title, text, buttons) {
  const d = gm.dom.end;
  d.querySelector('h2').textContent = title; d.querySelector('p').textContent = text;
  const box = d.querySelector('.gm-endb'); box.innerHTML = '';
  buttons.forEach(([t, fn], i) => { const b = document.createElement('button'); b.className = 'btn' + (i ? ' ghost' : ' primary'); b.textContent = t; b.onclick = fn; box.append(b); });
  d.classList.remove('hidden');
  gm.inp.clear();
  if (document.pointerLockElement) document.exitPointerLock?.();
}
export const lifeEnded = gm => !!gm.life?.ended;

// ---------- carrying a downed friend ----------
function startCarry(gm, pid) {
  const L = gm.life;
  if (L.carrying || L.st !== 'up') return;
  L.carrying = pid;
  send(pid, { t: 'g-help', k: 'carry' });
  SFX.grab();
  H.hint(gm, 'carrying', `You heave ${nameOf(pid)} over your shoulders. Get them to the stove or a fire. ${kn('drop')} puts them down.`, 7000, true);
}
function carryTick(gm, pressed) {
  const L = gm.life;
  if (!L.carrying) { gm.dom.carry.classList.add('hidden'); return; }
  const a = gm.avatars.get(L.carrying), ls = lsOf(a);
  if (!a || (ls !== LS.down && ls !== LS.carried)) { L.carrying = null; gm.dom.carry.classList.add('hidden'); return; }       // they got up, died, or left
  gm.dom.carry.textContent = `Carrying ${nameOf(L.carrying)} · ${kn('drop')} puts them down`;
  gm.dom.carry.classList.remove('hidden');
  if (pressed('drop')) putDown(gm);
}
function putDown(gm) {
  const L = gm.life, p = gm.player;
  if (!L.carrying) return;
  _f.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  send(L.carrying, { t: 'g-help', k: 'put', at: [p.pos.x + _f.x * 0.8, p.pos.y + 0.15, p.pos.z + _f.z * 0.8] });
  L.carrying = null; gm.dom.carry.classList.add('hidden');
}
// ---------- pulling a friend out of the water (ice.js runs the one in the water) ----------
function startPull(gm, pid) {
  const L = gm.life;
  L.pulling = pid; L.pullPh = 0; L.zone = 0.3 + Math.random() * 0.4; L.pullT = 0;
  H.hint(gm, 'pulling', `Click (${kn('primary')}) when the mark is in the light part of the bar: that is a good pull. Stay down low, or the ice gives way under you too. ${kn('drop')} lets go.`, 8000, true);
}
function pullTick(gm, dt, pressed) {
  const L = gm.life, p = gm.player, d = gm.dom;
  const a = L.pulling ? gm.avatars.get(L.pulling) : null;
  if (!a || lsOf(a) !== LS.swim || Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) > 4 || L.st !== 'up') { if (L.pulling) L.pulling = null; d.pull.classList.add('hidden'); return; }
  L.pullPh += dt; L.pullT -= dt;
  const m = 0.5 + 0.5 * Math.sin(L.pullPh * 2.7);
  d.pull.classList.remove('hidden');
  d.pullMark.style.left = (m * 100).toFixed(1) + '%';
  d.pullZone.style.left = ((L.zone - 0.11) * 100).toFixed(1) + '%';
  if (L.pullT <= 0) { L.pullT = 0.5; send(L.pulling, { t: 'g-pull', g: 2 }); }        // "I've got you": the one in the water climbs easier
  if (pressed('primary')) {
    const good = Math.abs(m - L.zone) < 0.11;
    send(L.pulling, { t: 'g-pull', g: good ? 1 : 0 });
    if (good) SFX.grab(); else SFX.nope();
    L.zone = 0.2 + Math.random() * 0.6;
  }
  if (pressed('drop')) { L.pulling = null; d.pull.classList.add('hidden'); }
}
export const busyHands = gm => !!(gm.life?.carrying || gm.life?.pulling);

// ---------- sleeping ----------
const isNight = env => env.hours >= 18 || env.hours < 6.5;
function freeSpot(gm, from = 0) {
  const b = gm.world.shack.bunk;
  const taken = i => [...gm.avatars.values()].some(a => (lsOf(a) === LS.sleep || lsOf(a) === LS.up) && a.pos.distanceTo(b.spots[i]) < 0.7);
  for (let i = from; i < b.spots.length; i++) if (!taken(i)) return i;
  return Math.max(1, from);
}
function sleep(gm) {
  const L = gm.life, p = gm.player, b = gm.world.shack.bunk;
  if (L.st !== 'up') return;
  putDown(gm); L.pulling = null;
  H.closeUI(gm);
  const i = L.spot = freeSpot(gm, 0), sp = b.spots[i];
  L.st = 'sleep'; L.woken = false; L.specI = 0;
  gm.hands.lit = false;
  p.yaw = b.yaw; p.setMode('sleep'); p.hold(sp.x, sp.y, sp.z);
  if (!gm.coop) L.nextWake = L.wakeEvery > 0 ? gm.T + L.wakeEvery * NIGHT_HOUR : Infinity;
  H.hint(gm, 'sleep', gm.coop ? 'You sleep. Whoever is awake keeps the stove going, and the night runs faster. You can watch them, talk to them, and play the ghost roulette (R).'
    : `You sleep, and the night runs fast. Keep the stove fed: you get up to check it (${kn('slot1')}–${kn('slot4')} sets how often). R: the ghost roulette.`, 9000, true);
}
function sleeping(gm, dt, env, pressed) {
  const L = gm.life, p = gm.player, ts = gm.ts || 1, sp = gm.world.shack.bunk.spots[L.spot];
  p.hold(sp.x, sp.y, sp.z);
  const warm = smooth(15, 55, p.heat);
  p.rest = Math.min(100, p.rest + dt * ts * 100 / (6 * NIGHT_HOUR) * (0.35 + 0.65 * warm) * (L.spot === 0 ? 1 : 0.8));
  p.hp = Math.min(100, p.hp + dt * ts * 0.6);
  if (!gm.coop) for (const [k, h] of [['slot1', 1], ['slot2', 2], ['slot3', 4], ['slot4', 0]]) if (pressed(k)) { L.wakeEvery = h; L.nextWake = h ? gm.T + h * NIGHT_HOUR : Infinity; }
  const why = env.hours >= 8 && env.hours < 16 ? 'morning' : p.heat < 12 ? 'cold' : gm.smoke > 0.5 ? 'smoke' : !gm.coop && gm.T >= L.nextWake ? 'alarm' : '';
  if (why) wake(gm, why);
}
export function wake(gm, why, by) {
  const L = gm.life, p = gm.player, b = gm.world.shack.bunk;
  if (L.st !== 'sleep') return;
  const sp = b.spots[L.spot === 0 ? 1 : L.spot];
  L.st = 'up'; p.setMode(null);
  p.teleport(sp.x, sp.y + 0.1, sp.z);
  if (why === 'woken') L.woken = true;
  if (why === 'alarm') { p.rest = Math.max(0, p.rest - 6); SFX.alarm(); H.hint(gm, 'alarm' + Date.now(), 'You get up to check on the stove. Lie down again when it\'s fed. Every time you get up, you rest a little less.', 6000, true); }
  else if (why === 'woken') H.hint(gm, 'woken' + Date.now(), `${nameOf(by)} shakes you awake. Your rest is spoiled for tonight.`, 6000, true);
  else if (why === 'cold') H.hint(gm, 'coldwake' + Date.now(), 'The cold wakes you. The stove must be dying.', 6000, true);
  else if (why === 'smoke') H.hint(gm, 'smokewake' + Date.now(), 'You wake up coughing: the shack is full of smoke.', 6000, true);
  else if (why === 'morning') {
    if (p.rest >= 80 && !L.woken && p.heat > 35) { L.restedUntil = Math.floor(gm.T / ISL.DAY) * ISL.DAY + ISL.SUN_UP; H.hint(gm, 'rested' + Date.now(), 'Morning. You slept well in the warm: Rested. You move a little faster and feel the cold less today.', 7000, true); }
    else H.hint(gm, 'morning' + Date.now(), 'Morning. It was a long, cold night.', 5000, true);
  }
}
// ---------- the night runs faster while the crew sleeps (the host or solo decides; guests follow) ----------
export function timeScale(gm, env) {
  if (!(env.hours >= 16 || env.hours < 8)) return 1;
  const sts = [lifeCode(gm), ...[...gm.avatars.values()].map(lsOf)].filter(s => s !== LS.dead);
  if (!sts.length || sts.some(s => s === LS.down || s === LS.carried || s === LS.swim)) return 1;
  const asleep = sts.filter(s => s === LS.sleep).length;
  return asleep === sts.length ? 12 : asleep ? 3 : 1;
}

// ---------- what you can do with your crew (work.js findAct asks) ----------
export function lifeActs(gm, look, offer) {
  const L = gm.life;
  if (!L || L.st !== 'up') return;
  const held = gm.inv.heldType();
  for (const [pid, a] of gm.avatars) {
    const ls = lsOf(a), name = nameOf(pid);
    if (ls === LS.down && !L.carrying) {
      const sc = look(_v.set(a.pos.x, a.pos.y + 0.3, a.pos.z), 2.4, 0.72);
      if (sc) offer(sc + 0.1, held === 'kit'
        ? { id: 'kit' + pid, text: `Patch ${name} up with the first aid kit`, hold: 2.5, go: () => { if (gm.inv.heldType() !== 'kit') return; gm.inv.take(gm.inv.sel, 1); send(pid, { t: 'g-help', k: 'kit' }); SFX.grab(); } }
        : { id: 'carry' + pid, text: `Carry ${name} (downed: get them to the fire, or use the first aid kit)`, hold: 1, go: () => startCarry(gm, pid) });
    } else if (ls === LS.sleep) {
      const sc = look(_v.set(a.pos.x, a.pos.y + 0.25, a.pos.z), 2.4, 0.8);
      if (sc) offer(sc + 0.05, { id: 'wake' + pid, text: `Wake ${name} up`, hold: 0.8, go: () => send(pid, { t: 'g-help', k: 'wake' }) });
    } else if (ls === LS.swim && L.pulling !== pid) {
      const sc = look(_v.set(a.pos.x, ISL.SEA + 0.25, a.pos.z), 3.4, 0.65);
      if (sc) offer(sc + 0.1, { id: 'pull' + pid, text: `Reach out to ${name}: pull them out of the water`, hold: 0.4, go: () => startPull(gm, pid) });
    }
  }
  const b = gm.world.shack.bunk, sc = look(b.pos, 2.3, 0.8);
  if (sc && !L.carrying) offer(sc - 0.03, isNight(gm.env) ? { id: 'sleep', text: 'Lie down and sleep', hold: 1, go: () => sleep(gm) } : { id: 'bunk', text: 'The bunk: you can sleep here at night (18:00 to 06:30)', hold: 0 });
}
// what you can do while you are not on your feet
export function modeAct(gm) {
  const L = gm.life;
  if (L.st === 'sleep') return { id: 'getup', text: 'Get up', hold: 1, go: () => wake(gm, 'self') };
  return null;
}

// ---------- the messages ----------
on('g-help', (m, from) => {
  const gm = GL;
  if (!gm || !gm.ready || !from) return;
  const L = gm.life, p = gm.player;
  switch (m.k) {
    case 'carry':
      if (L.st === 'down' && !L.carrier) { L.carrier = from; L.st = 'carried'; p.setMode('carried'); H.hint(gm, 'picked' + Date.now(), `${nameOf(from)} picks you up.`, 4000, true); }
      else send(from, { t: 'g-help', k: 'nocarry' });
      break;
    case 'nocarry': case 'up': case 'gone': if (L.carrying === from) { L.carrying = null; gm.dom.carry.classList.add('hidden'); } break;
    case 'put':
      if (L.st === 'carried' && L.carrier === from) { L.carrier = null; L.st = 'down'; p.setMode('lie'); if (Array.isArray(m.at)) p.teleport(+m.at[0], +m.at[1], +m.at[2]); }
      break;
    case 'kit': if (L.st === 'down' || L.st === 'carried') getUp(gm, 'kit'); break;
    case 'wake': if (L.st === 'sleep') wake(gm, 'woken', from); break;
  }
});
// a line in the chat for the rest of the crew: someone is down, died, fell through the ice…
export function tell(k) { if (GL?.coop) send('*', { t: 'g-life', k }); }
const SAY = { down: n => `${n} is down! Carry them to the fire, or use the first aid kit.`, up: n => `${n} is back on their feet.`, dead: n => `${n} died. They wake up in the shack in the morning.`,
  perma: n => `${n} died.`, back: n => `${n} woke up in the shack.`, ice: n => `${n} fell through the ice! Crawl to them and pull them out.`, out: n => `${n} climbed out of the water.` };
on('g-life', (m, from) => { const gm = GL; if (gm && gm.ready && from && SAY[m.k]) H.chat(null, SAY[m.k](nameOf(from))); });
// someone left the game: whoever I carried or was carried by
export function lifeDropped(gm, pid) {
  const L = gm.life;
  if (L.carrying === pid) { L.carrying = null; gm.dom.carry.classList.add('hidden'); }
  if (L.pulling === pid) L.pulling = null;
}

// ---------- the view while you watch (asleep or dead) ----------
export function lifeView(gm) {
  const L = gm.life, p = gm.player, cam = gm.camera;
  if (!spectating(gm)) return;
  p.P.g.visible = false;
  const list = [...gm.avatars.entries()].filter(([, a]) => { const ls = lsOf(a); return ls !== LS.dead && ls !== LS.sleep; }).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (list.length) {
    const i = ((L.specI % list.length) + list.length) % list.length, [pid, a] = list[i], ls = lsOf(a);
    L.specPid = pid;
    _c.set(a.pos.x, a.pos.y + (ls === LS.up ? 1.45 : ls === LS.swim ? 1.5 : 0.5), a.pos.z);
    const yaw = p.yaw, pit = clamp(p.pitch, -0.9, 0.6), dist = 3.4;
    _f.set(Math.sin(yaw) * Math.cos(pit), -Math.sin(pit) + 0.25, Math.cos(yaw) * Math.cos(pit)).normalize();
    const ray = new gm.R.Ray({ x: _c.x, y: _c.y, z: _c.z }, { x: _f.x, y: _f.y, z: _f.z });
    const hit = gm.world.phys.castRay(ray, dist, true, gm.R.QueryFilterFlags.EXCLUDE_DYNAMIC | gm.R.QueryFilterFlags.EXCLUDE_KINEMATIC);
    const k = hit ? Math.max(0.4, (hit.timeOfImpact ?? hit.toi ?? dist) - 0.25) : dist;
    cam.position.copy(_c).addScaledVector(_f, k);
    cam.lookAt(_c);
  } else {
    L.specPid = null;
    if (L.st === 'sleep' || gm.inShack) {      // nobody to watch: the shack, from a corner under the roof
      const M = gm.world.shack.M;
      cam.position.copy(_v.set(-2.3, gm.world.shack.floor + 2.05, 1.85).applyMatrix4(M));
      cam.lookAt(gm.world.shack.stove.pos);
    } else {                                   // where you died, from above
      cam.position.set(p.pos.x + 3, p.pos.y + 6, p.pos.z + 3);
      cam.lookAt(p.pos);
    }
  }
}
export function lifeKey(gm, e) {
  if (!spectating(gm) || e.repeat) return false;
  if (e.code === 'KeyR' && !gm.rouletteOpen) { e.preventDefault(); openRoulette(gm, () => H.lock(gm)); return true; }
  if (e.code === 'ArrowRight') { gm.life.specI++; return true; }
  if (e.code === 'ArrowLeft') { gm.life.specI--; return true; }
  return false;
}

// ---------- the HUD ----------
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function lifeHud(gm) {
  const L = gm.life, p = gm.player, d = gm.dom, T = gm.T;
  d.root.dataset.life = L.st;
  d.hp.classList.toggle('hidden', p.hp > 99 || L.st === 'dead');
  d.hpBar.style.width = p.hp.toFixed(1) + '%';
  // buffs and debuffs
  const chips = [];
  if (L.st !== 'dead') {
    if (L.together && gm.coop) chips.push(['good', '🤝 Together']);
    if (T < L.restedUntil) chips.push(['good', '☀️ Rested']);
    if (p.wet > 0.05) chips.push(['bad', `💧 Soaked ${Math.round(p.wet * 100)}%`]);
    if (p.rest < 20) chips.push(['bad', '🥱 Exhausted']);
    if (T < L.gloomUntil) chips.push(['bad', '🌧 Gloomy']);
    if (gm.ts > 1) chips.push(['', `⏩ Night ×${gm.ts}`]);
  }
  const html = chips.map(([k, t]) => `<span class="${k}">${t}</span>`).join('');
  if (gm.txt.buffs !== html) { gm.txt.buffs = html; d.buffs.innerHTML = html; }
  // when you're not on your feet
  let t = '', s = '', bar = -1, k = '';
  const watch = L.specPid ? `Watching ${nameOf(L.specPid)} · click or ← → for someone else` : '';
  if (L.st === 'down') { t = 'You are down'; s = gm.coop ? 'Your crew can carry you to the fire, or patch you up with the first aid kit.' : 'Only warmth can bring you back now.'; bar = L.downT / L.downMax; k = fmt(Math.max(0, L.downT)); }
  else if (L.st === 'carried') { t = `${nameOf(L.carrier)} is carrying you`; s = 'Hold on. The fire brings you back.'; bar = L.downT / L.downMax; k = fmt(Math.max(0, L.downT)); }
  else if (L.st === 'sleep') {
    t = 'Asleep'; bar = p.rest / 100;
    s = `Rest ${Math.round(p.rest)}%${gm.ts > 1 ? ` · the night runs ×${gm.ts}` : gm.coop ? ' · the others are awake' : ''}`;
    k = [`Hold ${kn('use')} to get up`, 'R: ghost roulette', watch, !gm.coop ? `Get up ${L.wakeEvery ? `every ${L.wakeEvery} h` : 'in the morning'} (${kn('slot1')} 1 h · ${kn('slot2')} 2 h · ${kn('slot3')} 4 h · ${kn('slot4')} morning)` : ''].filter(Boolean).join(' · ');
  } else if (L.st === 'dead' && !L.ended) {
    t = L.perma ? 'You are dead' : 'You died';
    s = L.perma ? 'For you, the island is over. You can still watch and talk to the others who died.' : `You wake up in the shack in the morning${gm.T < L.respawnT ? ` (in ${fmt(Math.max(0, (L.respawnT - gm.T) / (gm.ts || 1)))})` : ''}.`;
    k = ['R: ghost roulette', watch].filter(Boolean).join(' · ');
  }
  d.life.classList.toggle('hidden', !t);
  if (t) {
    setT(gm, 'lifeT', d.lifeT, t); setT(gm, 'lifeP', d.lifeP, s); setT(gm, 'lifeK', d.lifeK, k);
    d.lifeBox.classList.toggle('hidden', bar < 0);
    if (bar >= 0) d.lifeBar.style.width = (clamp(bar, 0, 1) * 100).toFixed(1) + '%';
    d.life.dataset.st = L.st;
  }
}
function setT(gm, key, el, text) { if (gm.txt[key] !== text) { gm.txt[key] = text; el.textContent = text; } }

// ---------- saved with you (sync.js) ----------
export function lifeRecord(gm) {
  const L = gm.life, p = gm.player;
  return { hp: Math.round(p.hp), wet: Math.round(p.wet * 100) / 100, rest: Math.round(p.rest), dead: L.st === 'dead' ? (L.perma ? 1 : 2) : 0, rT: L.st === 'dead' ? Math.round(L.respawnT) : 0 };
}
export function lifeRestore(gm, rec) {
  const L = gm.life, p = gm.player;
  if (rec.hp != null) p.hp = clamp(+rec.hp, 1, 100);
  if (rec.wet != null) p.wet = clamp(+rec.wet, 0, 1);
  if (rec.rest != null) p.rest = clamp(+rec.rest, 0, 100);
  if (rec.dead && gm.coop) {          // you were dead when you left: still are
    L.st = 'dead'; L.perma = rec.dead === 1; L.respawnT = +rec.rT || 0; L.deadReal = performance.now() - 60000;
    p.setMode('dead');
  }
}
