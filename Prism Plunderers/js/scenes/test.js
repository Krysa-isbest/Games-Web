// The test range: walk the course as your raider, in third person, and fight the Prism in the arena to the
// north (a robot console there spawns each of them). Running, sprinting and stamina, jumping, crouching,
// sliding, the dodge roll, falling, health and the three shields can all be tried, against training sentries,
// a gas pit and the five Prism robots, with stations to swap shields, repair them and heal.
// You start with the full kit (Pulse Carbine, Scrap Pistol, Crowbar, a light shield, heals and grenades); the
// supply crate by the spawn restocks it. Tab opens the inventory, Q the item wheel.
import * as THREE from 'three';
import { Engine, disposeTree, fitCamera, refreshMaterials } from '../core/engine.js';
import { Input, ACTIONS, kn } from '../core/input.js';
import { Scenes } from '../core/scenes.js';
import { S, P } from '../core/save.js';
import { bus } from '../core/events.js';
import { TICK } from '../core/config.js';
import { loadPhysics, Physics, G } from '../core/physics.js';
import { $, esc, rng } from '../core/util.js';
import { UI } from '../ui/screens.js';
import { Debug } from '../ui/debug.js';
import { InventoryScreen } from '../ui/inventory.js';
import { ItemWheel } from '../ui/wheel.js';
import { createPlayer, attachBody, detachBody, stepPlayer, respawnPlayer } from '../game/player.js';
import { readCommand, idleCommand } from '../game/controls.js';
import { angDiff, fwdX, fwdZ } from '../game/move-math.js';
import { ROLL, BODY } from '../game/stats.js';
import { ITEMS } from '../game/items.js';
import { makeItem, addItem, syncShield } from '../game/inventory.js';
import { stepWeapons, inHand, grenadeLaunch, SWITCH, GRENADE_READY, THROW } from '../game/weapons.js';
import { MODEL_OF } from '../game/weapon-models.js';
import { GroundLoot } from '../game/loot.js';
import { Raider } from '../game/raider.js';
import { OrbitCam } from '../game/camera.js';
import { Hud } from '../game/hud.js';
import { Sfx } from '../game/sfx.js';
import { PrismDirector } from '../game/prism/director.js';
import { GRAVITY } from '../game/prism/robot.js';
import { Sound } from '../core/sound.js';
import { addSky, glowTexture } from '../world/sky.js';
import { buildRange } from '../world/range.js';

const RESPAWN = 4;
const MAX_ROBOTS = 24;
// what you start with in the test range (and get again after dying)
export const KIT = {
  equip: { weapon1: 'pulse_carbine', weapon2: 'scrap_pistol', melee: 'crowbar', shield: 'shield_light' },
  quick: [['medkit', 2], ['stim', 3], ['repair_kit', 1], ['frag_grenade', 2]],
  bag: [['pulse_cell', 90], ['light_ammo', 48]],
};
export function giveKit(p) {
  const inv = p.inv;
  for (const [slot, id] of Object.entries(KIT.equip)) if (!inv.equip[slot]) inv.equip[slot] = makeItem(id);
  KIT.quick.forEach(([id, n], i) => { if (!inv.quick[i]) inv.quick[i] = makeItem(id, n); else addItem(inv, makeItem(id, n)); });
  for (const [id, n] of KIT.bag) addItem(inv, makeItem(id, n));
  syncShield(p);
}

export default function createTestRange() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, Engine.w / Engine.h, 0.05, 900);
  let phys = null, sky = null, range = null, player = null, raider = null, cam = null, hud = null, glow = null, prism = null;
  let ground = null, inv = null, wheel = null, arc = null;
  let deadT = 0, beatT = 0, slideLoop = null, gasLoop = null, invOpen = false, pendingQuick = -1, reloadSound = 0;
  const offs = [];
  const wctx = { phys: null, director: null, rnd: rng(77) };
  const fxRnd = rng(91);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  // the simulation runs while the mouse is captured, while the inventory is open, and while you are dead
  const paused = () => !Input.locked && !invOpen && !(player && player.dead);

  // ---------- HUD helpers ----------
  function hints() {
    const move = ['forward', 'left', 'back', 'right'].map(kn).join(' ');
    const k = (a, t) => `<b>${esc(kn(a))}</b> ${t}`;
    $('hud-hint').innerHTML = [`<b>${esc(move)}</b> move`, k('sprint', 'sprint'), k('jump', 'jump'), k('crouch', 'crouch'), k('roll', 'roll'),
      k('fire', 'shoot'), k('aim', 'aim'), k('reload', 'reload'), `<b>${esc([kn('weapon1'), kn('weapon2'), kn('melee'), kn('unarmed')].join(' '))}</b> weapons`,
      k('wheel', 'items'), k('inventory', 'inventory'), k('interact', 'use'), '<b>Esc</b> pause', '<b>F3</b> debug'].join('<i></i>');
    const box = $('hud-chips');
    box.innerHTML = '';
    for (const [a, d] of Object.entries(ACTIONS)) {
      const c = document.createElement('span');
      c.innerHTML = `<b>${esc(kn(a))}</b>${esc(d.name)}`;
      c.dataset.a = a;
      box.append(c);
    }
  }
  function chips() {
    if (!document.body.classList.contains('debug')) return;
    for (const c of $('hud-chips').children) {
      const on = Input.held(c.dataset.a, true);
      if (on !== c.classList.contains('on')) c.classList.toggle('on', on);
    }
  }

  // ---------- pause, mouse capture, the inventory ----------
  const showPause = on => $('pause').classList.toggle('hidden', !on);
  async function grab(quiet) {
    const got = Input.lock();
    if (S.fullscreenPlay) Input.fullscreen(true);
    if (!await got && !quiet) UI.toast('Click Resume again to capture the mouse.');
  }
  function onLock(locked) {
    Input.setContext(locked ? 'game' : 'ui');
    showPause(!locked && !UI.current && !invOpen && !(player && player.dead));
    Input.guard(locked || invOpen);
    if (!locked && wheel?.open) wheel.hide();
    $('pz-keys').textContent = Input.isFullscreen
      ? (Input.keysSafe ? 'Fullscreen: browser shortcuts such as Ctrl+W are blocked.' : 'Fullscreen.')
      : 'Windowed: Ctrl+W closes the browser tab. Fullscreen blocks it.';
  }
  function openInventory(box = null) {
    if (!player || player.dead) return;
    if (invOpen) { if (box) inv.show(box); return; }
    invOpen = true;
    if (wheel.open) wheel.hide();
    inv.show(box);
    Input.unlock();
  }
  function inventoryClosed() {
    invOpen = false;
    if (!player) return;
    grab(true).then(() => { if (!Input.locked && !player.dead) showPause(true); });
  }

  // ---------- the robot console in the arena ----------
  function consoleButtons() {
    const A = range.arena, s = A.spots;
    const full = () => { if (prism.robots.length >= MAX_ROBOTS) { hud.pop('Too many robots: clear some first', 'bad'); return true; } return false; };
    const facing = Math.PI;                         // towards the console
    let g = 0;
    const actions = [
      ['Spawn a Fink', () => prism.spawn('fink', s.fink, { yaw: facing })],
      ['Spawn 3 Flies', () => { const grp = 'flies' + (++g); for (let i = 0; i < 3; i++) prism.spawn('fly', { x: s.fly.x + (i - 1) * 1.8, y: s.fly.y + i * 0.4, z: s.fly.z }, { yaw: facing, group: grp }); }],
      ['Spawn a Swatter with 2 Flies', () => {
        const grp = 'swat' + (++g);
        prism.spawn('swatter', s.swatter, { yaw: facing, group: grp });
        for (const dx of [-2.5, 2.5]) prism.spawn('fly', { x: s.swatter.x + dx, y: s.swatter.y - 1, z: s.swatter.z + 1 }, { yaw: facing, group: grp });
      }],
      ['Wake 3 Scatters in the nest', () => s.scatter.forEach(q => prism.spawn('scatter', q, { yaw: -Math.PI / 2 }))],
      ['Spawn a Roach', () => prism.spawn('roach', s.roach, { yaw: facing })],
      ['Call a drop pod on yourself', () => prism.reinforce(player.pos, null)],
      ['Clear all robots', () => { prism.clear(); hud.pop('Arena cleared', 'good'); }],
      [p => `Invincible: ${p.god ? 'on' : 'off'} (press to switch)`, p => { p.god = !p.god; hud.pop(p.god ? 'Invincible: on' : 'Invincible: off', p.god ? 'good' : ''); }],
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

  // ---------- what the model holds ----------
  function gearKinds(p) {
    const e = p.inv.equip, k = it => it ? MODEL_OF[it.id] || null : null;
    return { weapon1: k(e.weapon1), weapon2: k(e.weapon2), melee: k(e.melee) };
  }
  function handState(p) {
    const w = p.wpn, h = inHand(p), M = h && h.def.melee;
    let draw = 1;
    if (w.outT > 0) draw = w.outT / SWITCH;
    else if (w.inT > 0) draw = 1 - w.inT / (w.active === 'throw' ? GRENADE_READY : SWITCH);
    return {
      active: w.active, draw,
      reloadK: w.reloadT > 0 ? 1 - w.reloadT / w.reloadTime : -1,
      swingK: M && w.swingT >= 0 ? w.swingT / M.swing : -1,
      throwK: w.active === 'throw' && w.throwT >= 0 ? Math.min(1, w.throwT / THROW.end) : -1,
      nade: w.active === 'throw' && (w.throwT < 0 || w.throwT < THROW.release),
      shots: w.shots,
    };
  }
  // the grenade's flight, drawn while you hold one and aim
  function makeArc() {
    const n = 48, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb224, transparent: true, opacity: 0.75, depthWrite: false }));
    line.frustumCulled = false; line.visible = false; line.renderOrder = 6;
    const end = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 24), new THREE.MeshBasicMaterial({ color: 0xffb224, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    end.rotation.x = -Math.PI / 2; end.visible = false;
    scene.add(line, end);
    return { line, end, n };
  }
  function drawArc(p) {
    const w = p.wpn, it = w.active === 'throw' && w.throwT < 0 && p.aiming ? p.inv.quick[w.throwSlot] : null;
    if (!it || !ITEMS[it.id].throw) { arc.line.visible = arc.end.visible = false; return; }
    const l = grenadeLaunch(p, ITEMS[it.id].throw), a = arc.line.geometry.attributes.position;
    let x = l.o.x, y = l.o.y, z = l.o.z, vy = l.v.y, hit = false;
    const vx = l.v.x, vz = l.v.z;
    // the same steps as the grenade itself takes (until its first bounce)
    for (let i = 0; i < arc.n; i++) {
      a.setXYZ(i, x, y, z);
      for (let k = 0; k < 2 && !hit; k++) {
        vy -= GRAVITY * TICK;
        const dx = vx * TICK, dy = vy * TICK, dz = vz * TICK, len = Math.hypot(dx, dy, dz);
        const h = len > 1e-6 ? phys.ray({ x, y, z }, { x: dx / len, y: dy / len, z: dz / len }, len, G.WORLD) : null;
        if (h) { x += dx / len * h.t; y += dy / len * h.t; z += dz / len * h.t; hit = true; arc.end.position.set(x, y + 0.03, z); }
        else { x += dx; y += dy; z += dz; }
      }
    }
    a.needsUpdate = true;
    arc.line.visible = true; arc.end.visible = hit;
  }

  // ---------- sounds and screen reactions ----------
  function listen() {
    const me = t => t === player;
    const near = (pos, max) => player ? Math.max(0, 1 - Math.hypot(pos.x - player.pos.x, pos.y - player.pos.y, pos.z - player.pos.z) / max) : 0;
    offs.push(
      bus.on('player:jump', t => { if (me(t)) Sfx.jump(); }),
      bus.on('player:land', (t, v) => { if (me(t) && v > 2) { Sfx.land(t.landPower); if (v > 9) cam.kick(Math.min(1, (v - 9) / 10)); } }),
      bus.on('player:roll', t => { if (me(t)) Sfx.roll(); }),
      bus.on('player:slide', t => { if (me(t)) Sfx.slide(); }),
      bus.on('player:nostamina', t => { if (me(t)) Sfx.deny(); }),
      bus.on('player:use', t => { if (me(t)) Sfx.use(); }),
      bus.on('player:dead', t => { if (me(t)) { Sfx.death(); deadT = 0; showDeath(true); if (invOpen) inv.close(); } }),
      bus.on('player:respawn', t => { if (me(t)) showDeath(false); }),
      bus.on('damage', (t, hit, r) => {
        if (!me(t)) return;
        if (r.dodged) { if (hit.amount >= 1) Sfx.dodge(); return; }
        if (r.broke) Sfx.shieldBreak(); else if (r.shield > 0) Sfx.shieldHit();
        if (r.health > 0 && hit.type !== 'gas') Sfx.hurt(r.health);
        if (hit.type !== 'gas' && (r.health + r.shield) > 2) cam.kick(Math.min(0.6, 0.12 + (r.health + r.shield) / 200));
      }),
      bus.on('shield', t => { if (me(t)) Sfx.shieldUp(); }),
      bus.on('heal', t => { if (me(t)) Sfx.heal(); }),
      // weapons
      bus.on('wpn:shot', (p, s) => {
        if (!me(p)) return;
        const model = ITEMS[s.id].model, coil = model === 'carbine';
        if (!raider.muzzle(p.wpn.active, _a)) _a.set(s.muzzle.x, s.muzzle.y, s.muzzle.z);
        _b.set(s.point.x, s.point.y, s.point.z);
        prism.fx.tracer(_a, _b, coil ? 0xe2d0ff : 0xfff0c8, 0.016, 0.05);
        prism.fx.flash(_a, coil ? 0xc49bff : 0xffd58a, coil ? 0.5 : 0.42, 0.05);
        if (s.res) hitFx(s.res, _b);
        else if (s.wall) prism.fx.sparks(_b, 0xffd8a0, 3, 2.5);
        Sfx.shot(model);
        // recoil: the camera kicks up (and a little to the side); you pull it back down
        const k = s.recoil * (p.aiming ? 0.75 : 1) * (0.85 + fxRnd() * 0.3);
        cam.look((fxRnd() - 0.5) * k * 0.7, -k);
      }),
      bus.on('wpn:dry', t => { if (me(t)) Sfx.dry(); }),
      bus.on('wpn:reload', t => { if (me(t)) { Sfx.magOut(); reloadSound = 1; } }),
      bus.on('wpn:reloaded', t => { if (me(t)) { Sfx.rack(); reloadSound = 0; } }),
      bus.on('wpn:reloadstop', t => { if (me(t)) reloadSound = 0; }),
      bus.on('wpn:switch', t => { if (me(t)) { Sfx.draw(); Input.cancel('aim'); } }),
      bus.on('wpn:swing', t => { if (me(t)) Sfx.swing(); }),
      bus.on('wpn:melee', (t, hit, res) => {
        if (!me(t) || !hit) return;
        _b.set(hit.point.x, hit.point.y, hit.point.z);
        Sfx.thunk();
        cam.kick(0.15);
        if (res) hitFx(res, _b);
      }),
      bus.on('wpn:throwstart', t => { if (me(t)) Sfx.pin(); }),
      bus.on('wpn:throw', t => { if (me(t)) Sfx.toss(); }),
      bus.on('use:start', t => { if (me(t)) Sfx.rustle(); }),
      bus.on('loot:pickup', t => { if (me(t)) Sfx.pickup(); }),
      bus.on('loot:open', (t, box) => { if (me(t)) openInventory(box); }),
      // the Prism shake the ground
      bus.on('prism:boom', (pos, size) => { const k = near(pos, 10 + size * 8); if (k > 0) cam.kick(Math.min(0.9, size * 0.4 * k)); }),
      bus.on('prism:podland', pod => { const k = near(pod.pos, 30); if (k > 0) cam.kick(0.8 * k); }),
      bus.on('prism:break', r => prism.sound('break', r.pos)),
    );
  }
  function hitFx(res, at) {
    const kind = res.killed ? 'kill' : res.weak || res.broke || (res.part || '').startsWith('thruster') ? 'weak' : 'hit';
    prism.fx.sparks(at, kind === 'hit' ? 0xffffff : 0xffb224, 4, 3);
    hud.hitmarker(kind);
    Sfx.hit(kind);
  }
  function showDeath(on) {
    $('death').classList.toggle('hidden', !on);
    if (on) $('death-cause').textContent = player.deathCause ? `Killed by: ${player.deathCause}` : '';
  }

  const ctx = { phys: null, items: null };

  return {
    scene, camera,
    get prism() { return prism; },
    get player() { return player; },
    get inventory() { return inv; },
    get wheel() { return wheel; },
    get ground() { return ground; },
    get range() { return range; },
    async enter() {
      document.body.dataset.mode = 'game';
      UI.home = null; UI.hide();
      $('fade-msg').textContent = 'Loading the test range';
      const R = await loadPhysics();
      $('fade-msg').textContent = '';
      phys = new Physics(R, TICK);
      glow = glowTexture();
      sky = addSky(scene);
      range = buildRange(scene, phys, glow);
      phys.step();                                         // the world is in place before the first ray cast
      ctx.phys = phys; ctx.items = range.items;
      prism = new PrismDirector({ scene, phys, items: range.items, glow, seed: 2999 });
      wctx.phys = phys; wctx.director = prism;
      ground = new GroundLoot({ scene, phys, items: range.items });

      player = createPlayer({ name: P.name, spawn: range.spawn });
      attachBody(player, phys);
      giveKit(player);
      raider = new Raider({ shadows: true });
      raider.setGear(gearKinds(player));
      scene.add(raider.root);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
        new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTexture(64, true), transparent: true, opacity: 0.55, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1;
      raider.contact = shadow;
      scene.add(shadow);
      arc = makeArc();
      cam = new OrbitCam(camera, phys);
      cam.yaw = range.spawn.yaw; cam.pitch = -0.15;
      hud = new Hud(player);
      hud.show(true);
      inv = new InventoryScreen(player, ground, { onClose: inventoryClosed });
      wheel = new ItemWheel(player);
      hints();
      consoleButtons();
      slideLoop = Sound.loop({ freq: 900, q: 0.6 });
      gasLoop = Sound.loop({ freq: 3200, q: 0.5, filter: 'highpass' });

      Debug.extra = () => {
        const p = player, sp = Math.hypot(p.vel.x, p.vel.z), c = prism.counts(), w = p.wpn, h = inHand(p);
        return `player ${p.mode}${p.crouch ? ' crouched' : ''}${p.sprinting ? ' sprinting' : ''}${p.aiming ? ' aiming' : ''}${p.firing ? ' firing' : ''}   ${p.grounded ? 'on ground' : 'in air'}   ` +
          `pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(2)} ${p.pos.z.toFixed(1)}   speed ${sp.toFixed(2)}   vy ${p.vel.y.toFixed(2)}\n` +
          `health ${p.health.toFixed(1)}   shield ${p.shield ? p.shield.type + ' ' + p.shield.hp.toFixed(0) + (p.shield.broken ? ' broken' : '') : 'none'}${p.emp > 0 ? ' (EMP)' : ''}   ` +
          `stamina ${p.stamina.toFixed(0)}${p.winded ? ' winded' : ''}   dodge ${p.iframes > 0 ? 'OPEN' : '-'}${p.god ? '   INVINCIBLE' : ''}\n` +
          `hands ${w.active}${w.want ? ' -> ' + w.want : ''}${h ? ' (' + h.def.name + (h.it.d ? ' ' + h.it.d.ammo : '') + ')' : ''}${w.reloadT > 0 ? ' reloading' : ''}   bloom ${w.bloom.toFixed(2)}   ` +
          `using ${p.using ? p.using.id + ' ' + p.using.t.toFixed(1) : '-'}${p.overweight ? '   OVERWEIGHT' : ''}\n` +
          `prism ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}   shots ${prism.bolts.length + prism.rockets.length + prism.bombs.length}   grenades ${prism.grenades.length}   gas ${prism.gas.length}   wrecks ${prism.wrecks.length}   ground items ${ground.drops.length}`;
      };
      offs.push(
        bus.on('input:lock', onLock),
        bus.on('input:escape', () => { if (!UI.current && Input.locked) Input.unlock(); }),
        bus.on('input:binds', hints),
        bus.on('ui', id => { if (!id && !Input.locked && !invOpen) showPause(true); }),
        bus.on('gfx', () => { sky.shadows(); refreshMaterials(scene); }),
      );
      listen();
      $('pz-resume').onclick = () => grab(false);
      $('pz-controls').onclick = () => { showPause(false); UI.go('controls'); };
      $('pz-quit').onclick = () => Scenes.go('menu');
      onLock(false);
      grab(true);                   // works while the click that opened the range is still fresh; otherwise Resume does it
    },

    exit() {
      for (const off of offs) off();
      offs.length = 0;
      Debug.extra = null;
      slideLoop?.stop(); gasLoop?.stop();
      invOpen = false;
      inv?.dispose();
      wheel?.hide();
      Input.guard(false);
      Input.unlock();
      Input.setContext('ui');
      hud?.dispose(); hud?.show(false);
      showPause(false);
      $('death').classList.add('hidden');
      UI.hide();
      prism?.dispose();
      ground?.dispose();
      if (player) detachBody(player);
      range?.dispose();
      disposeTree(scene);
      glow?.dispose();
      phys?.dispose();
      player = null;
    },

    fixed(dt) {
      if (!player || paused()) return;
      if (!invOpen && !player.dead && Input.pressed('inventory')) openInventory(null);
      const live = !player.dead && Input.locked;
      const cmd = live ? readCommand(cam, { quick: pendingQuick, noFire: wheel.open }) : idleCommand(cam);
      pendingQuick = -1;
      stepPlayer(player, cmd, dt, ctx);
      stepWeapons(player, cmd, dt, wctx);
      range.step(dt, player);
      prism.step(dt, player);
      phys.step();
      if (player.dead) {
        deadT += dt;
        if (deadT >= RESPAWN) {
          respawnPlayer(player, range.spawn);
          giveKit(player);
          cam.yaw = range.spawn.yaw; cam.pitch = -0.15;
          if (!Input.locked) showPause(true);
        }
      }
    },

    frame(dt, alpha) {
      if (!player) return;
      const stop = paused(), p = player;
      // the item wheel: held open with its key, the mouse picks a slot instead of turning the camera
      const wantWheel = Input.held('wheel') && !p.dead && !invOpen && !stop;
      if (wantWheel && !wheel.open) wheel.show();
      else if (!wantWheel && wheel.open) { const q = wheel.hide(); if (q >= 0) pendingQuick = q; }
      const look = Input.consumeLook(p.aiming ? S.aimSens : 1);
      if (wheel.open) { const k = 0.0022 * S.sens * (p.aiming ? S.aimSens : 1); wheel.steer(look.x / k, look.y / k * (S.invertY ? -1 : 1)); }
      else if (!stop) cam.look(look.x, look.y);
      const a = stop ? 1 : alpha;
      const x = p.prev.x + (p.pos.x - p.prev.x) * a, z = p.prev.z + (p.pos.z - p.prev.z) * a;
      const y = p.prev.y + (p.pos.y - p.prev.y) * a - BODY.offset;
      const facing = p.prevFacing + angDiff(p.prevFacing, p.facing) * a;
      raider.root.position.set(x, y, z);
      raider.root.rotation.y = facing + Math.PI;
      raider.setGear(gearKinds(p));
      const fx = fwdX(facing), fz = fwdZ(facing), speed = Math.hypot(p.vel.x, p.vel.z);
      const step = raider.update(stop ? 0 : dt, {
        mode: p.mode, speed, fwd: p.vel.x * fx + p.vel.z * fz, side: -(p.vel.x * -fz + p.vel.z * fx),
        grounded: p.grounded, vy: p.vel.y, crouch: p.crouch, sprint: p.sprinting, aim: p.aiming || p.firing,
        rollT: p.rollT / ROLL.time, deathT: p.deathT, landT: p.landT, landPower: p.landPower, hurtT: p.hurtT,
        turn: p.turn, using: !!p.use || !!p.using, lookYaw: angDiff(facing, cam.yaw), lookPitch: cam.pitch,
        hand: handState(p),
      });
      if (step && !stop) Sfx.step(speed, p.crouch);
      raider.contact.position.set(x, y + 0.02, z);
      raider.contact.visible = p.grounded || p.mode === 'dead';
      // the second half of a reload: the new magazine goes in
      if (reloadSound === 1 && p.wpn.reloadT > 0 && p.wpn.reloadT < p.wpn.reloadTime * 0.35) { Sfx.magIn(); reloadSound = 2; }

      cam.update(dt, { x, y, z }, { eye: p.height * 0.86 + (p.mode === 'dead' ? 0.3 : 0), aim: p.aiming, sprint: p.sprinting && speed > 5, dead: p.dead });
      hud.update(dt, cam.yaw);
      hud.updateGear(dt, camera);
      prism.frame(stop ? 0 : dt, a);
      hud.updatePrism(dt, prism, camera, cam.yaw);
      range.frame(stop ? 0 : dt, a, p);
      ground.frame(stop ? 0 : dt);
      inv.update(stop ? 0 : dt);
      drawArc(p);
      sky.follow(x, z);
      chips();

      // the slide's scrape, the gas hiss, the heartbeat at low health
      slideLoop.set(p.mode === 'slide' && p.grounded && !stop ? Math.min(0.1, speed * 0.012) : 0, 500 + speed * 90);
      const gd = Math.hypot(x - range.gas.x, z - range.gas.z);
      gasLoop.set(stop ? 0 : Math.max(0.05 * Math.max(0, 1 - gd / 14), prism.playerInGas(p) ? 0.05 : 0), 0);
      beatT -= dt;
      if (!stop && !p.dead && p.health / p.maxHealth < 0.3 && beatT <= 0) { Sfx.heartbeat(); beatT = 0.85 + p.health / p.maxHealth * 1.5; }
      if (p.dead) $('death-timer').textContent = `Back on your feet in ${Math.max(0, Math.ceil(RESPAWN - deadT))}`;
    },

    resize(w, h) { fitCamera(camera, w, h); },
  };
}
