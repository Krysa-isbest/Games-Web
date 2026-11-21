// The test range: walk the course as your raider, in third person, and fight the Prism in the arena to the
// north (a robot console there spawns each of them). Running, sprinting and stamina, jumping, crouching,
// sliding, the dodge roll, falling, health and the three shields can all be tried, against training sentries,
// a gas pit and the five Prism robots, with stations to swap shields, repair them and heal. The test gun
// (left mouse) stands in for real weapons until part 3.
import * as THREE from 'three';
import { Engine, disposeTree, fitCamera, refreshMaterials } from '../core/engine.js';
import { Input, ACTIONS, kn } from '../core/input.js';
import { Scenes } from '../core/scenes.js';
import { S, P } from '../core/save.js';
import { bus } from '../core/events.js';
import { TICK } from '../core/config.js';
import { loadPhysics, Physics } from '../core/physics.js';
import { $, esc, rng } from '../core/util.js';
import { UI } from '../ui/screens.js';
import { Debug } from '../ui/debug.js';
import { createPlayer, attachBody, detachBody, stepPlayer, respawnPlayer } from '../game/player.js';
import { readCommand, idleCommand } from '../game/controls.js';
import { angDiff, fwdX, fwdZ } from '../game/move-math.js';
import { ROLL, BODY } from '../game/stats.js';
import { Raider } from '../game/raider.js';
import { OrbitCam } from '../game/camera.js';
import { Hud } from '../game/hud.js';
import { Sfx } from '../game/sfx.js';
import { stepGun } from '../game/testgun.js';
import { PrismDirector } from '../game/prism/director.js';
import { Sound } from '../core/sound.js';
import { addSky, glowTexture } from '../world/sky.js';
import { buildRange } from '../world/range.js';

const RESPAWN = 4;
const MAX_ROBOTS = 24;

export default function createTestRange() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, Engine.w / Engine.h, 0.05, 900);
  let phys = null, sky = null, range = null, player = null, raider = null, cam = null, hud = null, glow = null, prism = null;
  let paused = true, deadT = 0, beatT = 0, slideLoop = null, gasLoop = null;
  const offs = [];
  const gunCtx = { phys: null, director: null, rnd: rng(77) };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  // ---------- HUD helpers ----------
  function hints() {
    const move = ['forward', 'left', 'back', 'right'].map(kn).join(' ');
    const k = (a, t) => `<b>${esc(kn(a))}</b> ${t}`;
    $('hud-hint').innerHTML = [`<b>${esc(move)}</b> move`, k('sprint', 'sprint'), k('jump', 'jump'), k('crouch', 'crouch / slide'),
      k('roll', 'roll'), k('fire', 'test gun'), k('aim', 'aim'), k('interact', 'use'), '<b>Esc</b> pause', '<b>F3</b> debug'].join('<i></i>');
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

  // ---------- pause and mouse capture ----------
  const showPause = on => $('pause').classList.toggle('hidden', !on);
  async function grab(quiet) {
    const got = Input.lock();
    if (S.fullscreenPlay) Input.fullscreen(true);
    if (!await got && !quiet) UI.toast('Click Resume again to capture the mouse.');
  }
  function onLock(locked) {
    paused = !locked;
    Input.setContext(locked ? 'game' : 'ui');
    showPause(!locked && !UI.current);
    Input.guard(locked);
    $('pz-keys').textContent = Input.isFullscreen
      ? (Input.keysSafe ? 'Fullscreen: browser shortcuts such as Ctrl+W are blocked.' : 'Fullscreen.')
      : 'Windowed: Ctrl+W closes the browser tab. Fullscreen blocks it.';
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
      bus.on('player:dead', t => { if (me(t)) { Sfx.death(); deadT = 0; showDeath(true); } }),
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
      // the gun
      bus.on('gun:shot', (p, m, point, res, wall) => {
        if (!me(p)) return;
        _a.set(m.x, m.y, m.z); _b.set(point.x, point.y, point.z);
        prism.fx.tracer(_a, _b, 0xfff0c8, 0.016, 0.05);
        prism.fx.flash(_a, 0xffd58a, 0.45, 0.05);
        if (res) {
          const kind = res.killed ? 'kill' : res.weak || res.broke || (res.part || '').startsWith('thruster') ? 'weak' : 'hit';
          prism.fx.sparks(_b, kind === 'hit' ? 0xffffff : 0xffb224, 4, 3);
          hud.hitmarker(kind);
          Sfx.hit(kind);
        } else if (wall) prism.fx.sparks(_b, 0xffd8a0, 3, 2.5);
        Sfx.gun();
      }),
      // the Prism shake the ground
      bus.on('prism:boom', (pos, size) => { const k = near(pos, 10 + size * 8); if (k > 0) cam.kick(Math.min(0.9, size * 0.4 * k)); }),
      bus.on('prism:podland', pod => { const k = near(pod.pos, 30); if (k > 0) cam.kick(0.8 * k); }),
      bus.on('prism:break', r => prism.sound('break', r.pos)),
    );
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
      gunCtx.phys = phys; gunCtx.director = prism;

      player = createPlayer({ name: P.name, spawn: range.spawn });
      attachBody(player, phys);
      raider = new Raider({ shadows: true });
      scene.add(raider.root);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
        new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTexture(64, true), transparent: true, opacity: 0.55, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1;
      raider.contact = shadow;
      scene.add(shadow);
      cam = new OrbitCam(camera, phys);
      cam.yaw = range.spawn.yaw; cam.pitch = -0.15;
      hud = new Hud(player);
      hud.show(true);
      hints();
      consoleButtons();
      slideLoop = Sound.loop({ freq: 900, q: 0.6 });
      gasLoop = Sound.loop({ freq: 3200, q: 0.5, filter: 'highpass' });

      Debug.extra = () => {
        const p = player, sp = Math.hypot(p.vel.x, p.vel.z), c = prism.counts();
        return `player ${p.mode}${p.crouch ? ' crouched' : ''}${p.sprinting ? ' sprinting' : ''}${p.aiming ? ' aiming' : ''}${p.firing ? ' firing' : ''}   ${p.grounded ? 'on ground' : 'in air'}   ` +
          `pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(2)} ${p.pos.z.toFixed(1)}   speed ${sp.toFixed(2)}   vy ${p.vel.y.toFixed(2)}\n` +
          `health ${p.health.toFixed(1)}   shield ${p.shield ? p.shield.type + ' ' + p.shield.hp.toFixed(0) + (p.shield.broken ? ' broken' : '') : 'none'}${p.emp > 0 ? ' (EMP)' : ''}   ` +
          `stamina ${p.stamina.toFixed(0)}${p.winded ? ' winded' : ''}   dodge ${p.iframes > 0 ? 'OPEN' : '-'}${p.god ? '   INVINCIBLE' : ''}\n` +
          `prism ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}   shots ${prism.bolts.length + prism.rockets.length + prism.bombs.length}   gas ${prism.gas.length}   wrecks ${prism.wrecks.length}`;
      };
      offs.push(
        bus.on('input:lock', onLock),
        bus.on('input:escape', () => { if (!UI.current && Input.locked) Input.unlock(); }),
        bus.on('input:binds', hints),
        bus.on('ui', id => { if (!id && !Input.locked) showPause(true); }),
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
      Input.guard(false);
      Input.unlock();
      Input.setContext('ui');
      hud?.dispose(); hud?.show(false);
      showPause(false);
      $('death').classList.add('hidden');
      UI.hide();
      prism?.dispose();
      if (player) detachBody(player);
      range?.dispose();
      disposeTree(scene);
      glow?.dispose();
      phys?.dispose();
      player = null;
    },

    fixed(dt) {
      if (!player || paused) return;
      const cmd = player.dead ? idleCommand(cam) : readCommand(cam);
      stepPlayer(player, cmd, dt, ctx);
      stepGun(player, cmd, dt, gunCtx);
      range.step(dt, player);
      prism.step(dt, player);
      phys.step();
      if (player.dead) {
        deadT += dt;
        if (deadT >= RESPAWN) { respawnPlayer(player, range.spawn); cam.yaw = range.spawn.yaw; cam.pitch = -0.15; }
      }
    },

    frame(dt, alpha) {
      if (!player) return;
      const look = Input.consumeLook(player.aiming ? S.aimSens : 1);
      if (!paused) cam.look(look.x, look.y);
      const p = player, a = paused ? 1 : alpha;
      const x = p.prev.x + (p.pos.x - p.prev.x) * a, z = p.prev.z + (p.pos.z - p.prev.z) * a;
      const y = p.prev.y + (p.pos.y - p.prev.y) * a - BODY.offset;
      const facing = p.prevFacing + angDiff(p.prevFacing, p.facing) * a;
      raider.root.position.set(x, y, z);
      raider.root.rotation.y = facing + Math.PI;
      const fx = fwdX(facing), fz = fwdZ(facing), speed = Math.hypot(p.vel.x, p.vel.z);
      const step = raider.update(paused ? 0 : dt, {
        mode: p.mode, speed, fwd: p.vel.x * fx + p.vel.z * fz, side: -(p.vel.x * -fz + p.vel.z * fx),
        grounded: p.grounded, vy: p.vel.y, crouch: p.crouch, sprint: p.sprinting, aim: p.aiming || p.firing,
        rollT: p.rollT / ROLL.time, deathT: p.deathT, landT: p.landT, landPower: p.landPower, hurtT: p.hurtT,
        turn: p.turn, using: !!p.use, lookYaw: angDiff(facing, cam.yaw), lookPitch: cam.pitch,
      });
      if (step && !paused) Sfx.step(speed, p.crouch);
      raider.contact.position.set(x, y + 0.02, z);
      raider.contact.visible = p.grounded || p.mode === 'dead';

      cam.update(dt, { x, y, z }, { eye: p.height * 0.86 + (p.mode === 'dead' ? 0.3 : 0), aim: p.aiming, sprint: p.sprinting && speed > 5, dead: p.dead });
      hud.update(dt, cam.yaw);
      prism.frame(paused ? 0 : dt, a);
      hud.updatePrism(dt, prism, camera, cam.yaw);
      range.frame(paused ? 0 : dt, a, p);
      sky.follow(x, z);
      chips();

      // the slide's scrape, the gas hiss, the heartbeat at low health
      slideLoop.set(p.mode === 'slide' && p.grounded && !paused ? Math.min(0.1, speed * 0.012) : 0, 500 + speed * 90);
      const gd = Math.hypot(x - range.gas.x, z - range.gas.z);
      gasLoop.set(paused ? 0 : Math.max(0.05 * Math.max(0, 1 - gd / 14), prism.playerInGas(p) ? 0.05 : 0), 0);
      beatT -= dt;
      if (!paused && !p.dead && p.health / p.maxHealth < 0.3 && beatT <= 0) { Sfx.heartbeat(); beatT = 0.85 + p.health / p.maxHealth * 1.5; }
      if (p.dead) $('death-timer').textContent = `Back on your feet in ${Math.max(0, Math.ceil(RESPAWN - deadT))}`;
    },

    resize(w, h) { fitCamera(camera, w, h); },
  };
}
