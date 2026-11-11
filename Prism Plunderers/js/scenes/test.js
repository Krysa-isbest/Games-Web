// The test range: a free-flying camera over a block city. It exists to prove the foundation works (loop,
// input, rebinding, mouse capture, pooling, instancing, scene switching) and stays as the developer sandbox.
import * as THREE from 'three';
import { Engine, disposeTree, fitCamera, refreshMaterials, SHADOW_SIZE } from '../core/engine.js';
import { Input, ACTIONS, kn } from '../core/input.js';
import { Scenes } from '../core/scenes.js';
import { Sound } from '../core/sound.js';
import { S } from '../core/save.js';
import { bus } from '../core/events.js';
import { Pool, rng, clamp, damp, $, esc } from '../core/util.js';
import { UI } from '../ui/screens.js';

export default function createTestRange() {
  const scene = new THREE.Scene();
  const SKY = 0x4b3f5c;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 50, 330);
  const camera = new THREE.PerspectiveCamera(S.fov, Engine.w / Engine.h, 0.1, 500);
  scene.add(camera);                                    // so the flashlight, a child of the camera, is drawn

  // ---------- light ----------
  scene.add(new THREE.HemisphereLight(0x9a90d0, 0x3d3229, 1.0));
  const sun = new THREE.DirectionalLight(0xffb98a, 2.3);
  const SUN = new THREE.Vector3(70, 60, 30);
  scene.add(sun, sun.target);
  function setupShadows() {
    const size = SHADOW_SIZE[S.shadows] || 0;
    sun.castShadow = size > 0;
    if (!size) return;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(size, size); }
    const c = sun.shadow.camera;
    c.left = c.bottom = -90; c.right = c.top = 90; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  }
  setupShadows();
  const lamp = new THREE.SpotLight(0xfff4e0, 0, 80, 0.5, 0.5, 1.3);
  lamp.position.set(0.3, -0.25, 0);
  lamp.target.position.set(0, 0, -1);
  camera.add(lamp, lamp.target);

  // ---------- world ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ color: 0x75695c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(420, 105, 0x2b2436, 0x4d4359);
  grid.position.y = 0.02;
  grid.material.transparent = true; grid.material.opacity = 0.35;
  scene.add(grid);

  // 240 ruin blocks in ONE draw call (instancing). The seed makes the same city on every computer.
  const COUNT = 240;
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), COUNT);
  {
    const R = rng(2999), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const a = R() * Math.PI * 2, d = 14 + Math.pow(R(), 0.7) * 165;
      s.set(R.range(2, 9), R.chance(0.2) ? R.range(10, 26) : R.range(1, 8), R.range(2, 9));
      p.set(Math.cos(a) * d, s.y / 2 - 0.05, Math.sin(a) * d);
      const tilt = R.chance(0.15);
      e.set(tilt ? R.range(-0.25, 0.25) : 0, R() * Math.PI, tilt ? R.range(-0.25, 0.25) : 0);
      blocks.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
      blocks.setColorAt(i, col.setHSL(0.08 + R() * 0.03, 0.08 + R() * 0.08, 0.34 + R() * 0.2));
    }
    blocks.instanceMatrix.needsUpdate = true;
    blocks.instanceColor.needsUpdate = true;
    blocks.computeBoundingSphere();
  }
  blocks.castShadow = blocks.receiveShadow = true;
  scene.add(blocks);

  // ---------- pooled things ----------
  const boltGeo = new THREE.BoxGeometry(0.09, 0.09, 1.4), boltMat = new THREE.MeshBasicMaterial({ color: 0xcdb0ff });
  const bolts = new Pool(() => {
    const o = new THREE.Mesh(boltGeo, boltMat);
    o.visible = false;
    o.userData = { vel: new THREE.Vector3(), prev: new THREE.Vector3(), pos: new THREE.Vector3(), life: 0 };
    scene.add(o);
    return o;
  }, { reset: o => { o.visible = false; }, size: 24 });
  const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
  const pings = new Pool(() => {
    const o = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    o.rotation.x = -Math.PI / 2;
    o.visible = false;
    o.userData = { life: 0 };
    scene.add(o);
    return o;
  }, { reset: o => { o.visible = false; }, size: 4 });

  // ---------- the flying camera ----------
  const pos = new THREE.Vector3(0, 7, 34), prev = pos.clone(), vel = new THREE.Vector3();
  const wish = new THREE.Vector3(), fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), dir = new THREE.Vector3();
  let yaw = 0, pitch = -0.12, fireCd = 0, lampOn = false, fov = S.fov;

  function fixed(dt) {
    prev.copy(pos);
    const mv = Input.move();
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));
    wish.set(0, 0, 0).addScaledVector(fwd, mv.y).addScaledVector(rgt, mv.x);
    wish.y = (Input.held('jump') ? 1 : 0) - (Input.active('crouch') ? 1 : 0);
    wish.multiplyScalar(Input.active('sprint') ? 28 : 10);
    vel.lerp(wish, 1 - Math.exp(-9 * dt));
    if (Input.pressed('roll')) vel.addScaledVector(fwd, 45);              // a dash, to show a one-shot press
    pos.addScaledVector(vel, dt);
    pos.x = clamp(pos.x, -200, 200); pos.z = clamp(pos.z, -200, 200); pos.y = clamp(pos.y, 1.2, 120);

    dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    fireCd -= dt;
    if (Input.held('fire') && fireCd <= 0) {
      fireCd = 0.11;
      const b = bolts.get(), u = b.userData;
      u.pos.copy(pos).addScaledVector(dir, 1.2); u.pos.y -= 0.25;
      u.prev.copy(u.pos); u.vel.copy(dir).multiplyScalar(110); u.life = 1.6;
      b.position.copy(u.pos); b.lookAt(u.pos.x + dir.x, u.pos.y + dir.y, u.pos.z + dir.z);
      b.visible = true;
      Sound.tone(880, 0.06, { type: 'square', vol: 0.05, to: 240, channel: 'sfx' });
    }
    bolts.each(b => {
      const u = b.userData;
      u.prev.copy(u.pos); u.pos.addScaledVector(u.vel, dt);
      u.life -= dt;
      if (u.life <= 0 || u.pos.y < 0) bolts.put(b);
    });

    if (Input.pressed('ping') && dir.y < -0.02) {
      const d = Math.min(-pos.y / dir.y, 320), p = pings.get();
      p.position.set(pos.x + dir.x * d, 0.06, pos.z + dir.z * d);
      p.userData.life = 4; p.visible = true;
      Sound.tone(1320, 0.18, { vol: 0.12, to: 1760, channel: 'sfx' });
    }
    pings.each(p => {
      const u = p.userData;
      u.life -= dt;
      if (u.life <= 0) { pings.put(p); return; }
      const k = 1 - u.life / 4;
      p.scale.setScalar(1 + k * 3 + Math.sin(k * 40) * 0.08);
      p.material.opacity = 0.9 * (1 - k);
    });

    if (Input.pressed('flashlight')) { lampOn = !lampOn; lamp.intensity = lampOn ? 420 : 0; Sound.tone(lampOn ? 1500 : 900, 0.03, { vol: 0.08, channel: 'sfx' }); }
  }

  // ---------- HUD ----------
  const chips = {};
  function buildHud() {
    $('hud-hint').innerHTML =
      `<b>${esc(['forward', 'left', 'back', 'right'].map(kn).join(' '))}</b> fly  <b>${esc(kn('sprint'))}</b> fast  <b>${esc(kn('jump'))}</b> up  <b>${esc(kn('crouch'))}</b> down  ` +
      `<b>${esc(kn('roll'))}</b> dash  <b>${esc(kn('fire'))}</b> bolts  <b>${esc(kn('aim'))}</b> zoom  <b>${esc(kn('ping'))}</b> ping the ground  <b>${esc(kn('flashlight'))}</b> light  <b>Esc</b> pause  <b>F3</b> debug`;
    const box = $('hud-chips');
    box.innerHTML = '';
    for (const [a, d] of Object.entries(ACTIONS)) {
      const c = document.createElement('span');
      c.innerHTML = `<b>${esc(kn(a))}</b>${esc(d.name)}`;
      box.append(c);
      chips[a] = { el: c, on: false };
    }
  }
  function updateChips() {
    for (const a in chips) {
      const c = chips[a], on = Input.held(a, true);
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); }
    }
  }

  // ---------- pause / mouse capture ----------
  const showPause = on => $('pause').classList.toggle('hidden', !on);
  // The mouse is asked for first: going fullscreen uses up the click, and the browser wants a fresh click
  // for the mouse capture.
  async function grab(quiet) {
    const got = Input.lock();
    if (S.fullscreenPlay) Input.fullscreen(true);
    if (!await got && !quiet) UI.toast('Click Resume again to capture the mouse.');
  }
  const resume = () => grab(false);
  function onLock(locked) {
    Input.setContext(locked ? 'game' : 'ui');
    showPause(!locked);
    $('pz-keys').textContent = Input.isFullscreen
      ? (Input.keysSafe ? 'Fullscreen: browser shortcuts such as Ctrl+W are blocked.' : 'Fullscreen.')
      : 'Windowed: Ctrl+W closes the browser tab. Fullscreen blocks it.';
  }
  const offs = [];

  return {
    scene, camera, fixed,
    async enter() {
      document.body.dataset.mode = 'game';
      UI.home = null; UI.hide();
      buildHud();
      $('hud').classList.remove('hidden');
      offs.push(
        bus.on('input:lock', onLock),
        bus.on('input:escape', () => { if (!UI.current && Input.locked) Input.unlock(); }),
        bus.on('input:binds', buildHud),
        bus.on('gfx', () => { setupShadows(); refreshMaterials(scene); }),
      );
      $('pz-resume').onclick = resume;
      $('pz-controls').onclick = () => UI.go('controls');
      $('pz-quit').onclick = () => Scenes.go('menu');
      onLock(false);
      grab(true);                   // works while the click that opened the range is still fresh; otherwise Resume does it
    },
    exit() {
      for (const off of offs) off();
      Input.unlock();
      Input.setContext('ui');
      $('hud').classList.add('hidden');
      showPause(false);
      UI.hide();
      disposeTree(scene);
    },
    frame(dt, alpha) {
      const aiming = Input.active('aim');
      const l = Input.consumeLook(aiming ? S.aimSens : 1);
      yaw -= l.x;
      pitch = clamp(pitch - l.y, -1.5, 1.5);
      camera.position.lerpVectors(prev, pos, alpha);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const want = aiming ? S.fov * 0.55 : S.fov;
      if (Math.abs(want - fov) > 0.01) { fov = damp(fov, want, 14, dt); camera.fov = fov; camera.updateProjectionMatrix(); }
      bolts.each(b => b.position.lerpVectors(b.userData.prev, b.userData.pos, alpha));
      // the shadow area follows the camera
      sun.target.position.set(camera.position.x, 0, camera.position.z);
      sun.position.copy(sun.target.position).add(SUN);
      updateChips();
    },
    resize(w, h) { fitCamera(camera, w, h); },
  };
}
