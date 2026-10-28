// First-person hands + held item, rendered in a separate pass so they never clip into the world.
import * as THREE from 'three';
import { makeTemplate, templateToObject } from './assets.js';
import { damp } from './util.js';

export class ViewModel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.root = new THREE.Group();     // animated as a whole
    this.scene.add(this.root);
    this.light = new THREE.DirectionalLight(0xffffff, 2);
    this.light.position.set(0.5, 1, 0.3);
    this.ambient = new THREE.HemisphereLight(0xdde8ff, 0x3a3020, 0.8);
    this.scene.add(this.light, this.ambient);
    this.items = {};
    this.current = null;
    this.swing = 0;          // 0..1 progress of a tool swing, -1 = idle
    this.swingActive = false;
    this.use = 0;            // eat / drink / place animation
    this.useActive = false;
    this.bob = 0;
    this.sway = new THREE.Vector2();
    this.build();
  }

  build() {
    const A = this.game.assets;
    // arms: the model is in centimetres, facing +Z, so scale and turn it around
    const hands = A.models.fp_hands.scene;
    hands.scale.setScalar(0.01);
    hands.rotation.y = Math.PI;
    hands.traverse((o) => {
      // the arms come untextured: give them a tanned, slightly dirty skin tone
      if (o.isMesh) { o.frustumCulled = false; o.material = new THREE.MeshStandardMaterial({ color: 0xb5876a, roughness: 0.75 }); }
      // only the right arm is used; fold the left one away
      if (o.isBone && /L_\d+$/.test(o.name)) o.scale.setScalar(0.001);
      // curl the right hand's fingers into a grip
      if (o.isBone && /^f_|thumb/.test(o.name) && /R_/.test(o.name)) o.rotation.x += o.name.startsWith('thumb') ? 0.3 : 1.15;
    });
    // the arms hang down in their rest pose: tilt them up so the hands come into view
    const pivot = new THREE.Group();
    pivot.rotation.x = 0.75;
    pivot.add(hands);
    this.root.add(pivot);
    this.hands = hands;
    let handBone = null;
    hands.traverse((o) => { if (o.isBone && /^handR/.test(o.name)) handBone = o; });
    // move the whole rig so the right hand lands in the lower-right of the screen
    const target = new THREE.Vector3(0.2, -0.2, -0.38);
    this.root.updateMatrixWorld(true);
    if (handBone) {
      const hp = this.root.worldToLocal(handBone.getWorldPosition(new THREE.Vector3()));
      pivot.position.add(target.clone().sub(hp));
      this.root.updateMatrixWorld(true);
    }
    this.gripPos = handBone ? this.root.worldToLocal(handBone.getWorldPosition(new THREE.Vector3())) : target;

    // held items, built once
    const axe = templateToObject(makeTemplate(A.models.stone_axe.scene, { scale: null, height: null }), { castShadow: false });
    const axeT = makeTemplate(A.models.stone_axe.scene);
    const axeScale = 0.4 / Math.max(axeT.size.x, axeT.size.y, axeT.size.z);
    axe.scale.setScalar(axeScale);
    this.items.stone_axe = this.mount(axe, { rot: [0.15, Math.PI / 2, -1.35], off: [-0.015, -0.03, 0.0] });

    const can = templateToObject(makeTemplate(A.models.canteen.scene, { height: 0.2 }), { castShadow: false });
    this.items.canteen = this.mount(can, { rot: [0, 0.4, 0], off: [-0.02, -0.04, -0.02] });

    const torch = this.makeTorch();
    torch.scale.setScalar(0.55);
    this.torchFlame = torch.userData.flame;
    this.items.torch = this.mount(torch, { rot: [-0.35, 0, -0.2], off: [-0.01, -0.06, -0.04] });

    const f = this.game.world.pickupFactory;
    for (const food of ['banana', 'mango', 'berries']) {
      const m = f[food](); m.scale.setScalar(1.6);
      this.items[food] = this.mount(m, { rot: [0.3, 0.5, 0], off: [-0.03, 0, -0.03] });
    }
  }

  makeTorch() {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9 }));
    stick.position.y = 0.12;
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.09, 8), new THREE.MeshStandardMaterial({ color: 0x2b1d12, roughness: 1 }));
    wrap.position.y = 0.33;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.y = 0.41;
    g.add(stick, wrap, flame);
    g.userData.flame = flame;
    return g;
  }

  mount(obj, { rot, off }) {
    const holder = new THREE.Group();
    holder.position.copy(this.gripPos).add(new THREE.Vector3(...off));
    obj.rotation.set(...rot);
    holder.add(obj);
    holder.visible = false;
    obj.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.root.add(holder);
    return holder;
  }

  show(itemId) {
    for (const [id, h] of Object.entries(this.items)) h.visible = id === itemId;
    this.current = itemId;
  }

  startSwing() { if (!this.swingActive) { this.swingActive = true; this.swing = 0; return true; } return false; }
  startUse() { if (!this.useActive) { this.useActive = true; this.use = 0; return true; } return false; }
  get busy() { return this.swingActive || this.useActive; }

  update(dt, player, input, sunDir, sunIntensity, envIntensity, onHitFrame) {
    // base pose follows camera; add sway, bob and actions
    const moveSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    this.bob += dt * moveSpeed * (player.sprinting ? 1.6 : 1.9);
    const bobAmt = player.onGround ? Math.min(1, moveSpeed / 4) : 0;
    this.sway.x = damp(this.sway.x, -input.mouse.dx * 0.0006, 10, dt);
    this.sway.y = damp(this.sway.y, input.mouse.dy * 0.0006, 10, dt);

    let px = Math.sin(this.bob) * 0.012 * bobAmt + this.sway.x;
    let py = -Math.abs(Math.cos(this.bob)) * 0.014 * bobAmt + this.sway.y + Math.sin(performance.now() / 900) * 0.003;
    let pz = 0, rx = 0, ry = 0, rz = 0;
    if (player.sprinting) { rx -= 0.18; ry += 0.25; py -= 0.04; }

    if (this.swingActive) {
      const prev = this.swing;
      this.swing += dt / 0.55;
      const t = this.swing;
      // wind up, strike, recover
      const wind = t < 0.35 ? t / 0.35 : t < 0.55 ? 1 - (t - 0.35) / 0.2 * 1.8 : -0.8 + (t - 0.55) / 0.45 * 0.8;
      rx += wind * 0.9; rz += wind * 0.25; py += wind * 0.06; pz += Math.max(0, -wind) * -0.08;
      if (prev < 0.45 && t >= 0.45 && onHitFrame) onHitFrame();
      if (this.swing >= 1) this.swingActive = false;
    }
    if (this.useActive) {
      this.use += dt / 0.7;
      const k = Math.sin(Math.min(1, this.use) * Math.PI);
      px -= k * 0.12; py += k * 0.12; pz += k * 0.1; rx += k * 0.5;
      if (this.use >= 1) this.useActive = false;
    }
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);

    if (this.torchFlame) this.torchFlame.scale.setScalar(0.9 + Math.random() * 0.25);

    // share the world's sky reflections, otherwise metallic parts render black
    this.scene.environment = this.game.scene.environment;
    this.scene.environmentIntensity = this.game.scene.environmentIntensity * 1.4;
    this.light.position.copy(sunDir);
    this.light.intensity = 0.4 + sunIntensity * 0.55;
    this.ambient.intensity = 0.25 + envIntensity * 0.9;
  }
}
