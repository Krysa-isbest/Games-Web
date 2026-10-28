// Ties all systems together: render loop, game states, interactions, tool use, saving.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { World, CAMP, WATER_LEVEL } from './world.js';
import { Player } from './player.js';
import { ViewModel } from './viewmodel.js';
import { Monkeys } from './monkeys.js';
import { Building } from './building.js';
import { Inventory } from './inventory.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { renderIcons } from './icons.js';
import { ITEMS, BUILDABLES, VERSION } from './data.js';
import { writeSave, readSave } from './save.js';

const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, dist: 0.6 },
  medium: { pixelRatio: 1, shadows: true, dist: 0.85 },
  high: { pixelRatio: 1.5, shadows: true, dist: 1.15 },
};

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 1200);
    this.scene.add(this.camera);
    this.assets = new Assets(this.renderer);
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.inventory = new Inventory();
    this.state = 'loading';
    this.slot = 0;
    this.clock = new THREE.Clock();
    this.swingTarget = null;
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.onStateChange = null;
    this.input.onUnlock = () => { if (this.state === 'playing' && !this.ignoreUnlock) this.pause(); this.ignoreUnlock = false; };
    addEventListener('resize', () => this.resize());
  }

  async load(onProgress) {
    await this.assets.loadAll(onProgress);
    this.world = new World(this.scene, this.assets, this.renderer);
    this.world.build();
    this.player = new Player(this);
    this.building = new Building(this);
    this.monkeys = new Monkeys(this);
    this.viewmodel = new ViewModel(this);
    this.hud = new Hud(this);
    this.hud.icons = renderIcons(this);
    this.torchLight = new THREE.PointLight(0xffa04a, 0, 13, 1.7);
    this.scene.add(this.torchLight);
    this.applySettings();
    this.resize();
    this.newWorldState();
    this.state = 'menu';
    this.renderer.setAnimationLoop(() => this.frame());
  }

  applySettings() {
    const s = this.settings;
    const q = QUALITY[s.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    if (this.world) this.world.distScale = q.dist;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolume(s.volume);
    document.getElementById('fps').classList.toggle('hidden', !s.showFps);
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.viewmodel) { this.viewmodel.camera.aspect = w / h; this.viewmodel.camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ states
  setState(s) { this.state = s; this.onStateChange && this.onStateChange(s); }

  newWorldState() {
    const w = this.world;
    for (const n of w.nodes) if (!n.alive) w.restoreNode(n);
    for (const p of w.pickups) { p.alive = true; p.mesh.visible = true; }
    w.time = 8.5; w.day = 1;
    this.building.restore([]);
    this.monkeys.restore([]);
    this.monkeys.populate();
    this.inventory.reset();
    this.player.spawn(CAMP.x + 2, CAMP.y + 6, 0.3);
    Object.assign(this.player, { health: 100, stamina: 100, hunger: 85, thirst: 80, oxygen: 100, dead: false });
  }

  async startNew(slot) {
    this.slot = slot;
    this.newWorldState();
    this.save(true);
    await this.enterPlay();
    this.hud.notify('The monkeys wrecked your boat. Contain them all and the government will send a ride home.', 'info');
    setTimeout(() => this.hud.notify('Chop bamboo and trees with the axe (left click). Press B to build a cage.', 'info'), 4500);
  }

  async startLoad(slot) {
    const d = readSave(slot);
    if (!d) return false;
    this.slot = slot;
    this.restore(d);
    await this.enterPlay();
    this.hud.notify('Game loaded.', 'good');
    return true;
  }

  async enterPlay() {
    await this.audio.init(this.camera);
    this.hud.show(true);
    this.setState('playing');
    this.input.lock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.save(true);
  }

  resume() {
    this.setState('playing');
    this.input.lock();
  }

  toMenu() {
    if (this.state !== 'dead') this.save(true);
    this.building.cancelPlacing();
    this.hud.show(false);
    this.hud.closeBuildMenu();
    this.input.unlock();
    this.setState('menu');
  }

  onDeath(reason) {
    this.setState('dead');
    this.input.unlock();
    document.getElementById('deathReason').textContent = reason || '';
  }

  respawn() {
    this.player.spawn(CAMP.x + 2, CAMP.y + 6, 0.3);
    Object.assign(this.player, { health: 60, stamina: 100, hunger: Math.max(this.player.hunger, 40), thirst: Math.max(this.player.thirst, 40), oxygen: 100, dead: false });
    this.resume();
  }

  toggleBuildMenu() {
    if (this.state === 'playing') {
      this.building.cancelPlacing();
      this.setState('build');
      this.ignoreUnlock = true;
      this.input.unlock();
      this.hud.openBuildMenu();
      this.audio.ui('open_menu');
    } else if (this.state === 'build') {
      this.hud.closeBuildMenu();
      this.audio.ui('close_menu');
      this.resume();
    }
  }

  chooseBuild(type) {
    if (!this.building.canAfford(type)) { this.hud.notify(`Not enough resources for ${BUILDABLES[type].name}.`, 'bad'); this.audio.ui('click'); return; }
    this.hud.closeBuildMenu();
    this.audio.ui('click');
    this.resume();
    this.building.startPlacing(type);
  }

  // ------------------------------------------------------------------ save / load
  serialize() {
    const w = this.world;
    return {
      version: VERSION,
      world: {
        time: w.time, day: w.day,
        removed: w.nodes.filter((n) => !n.alive).map((n) => [n.id, Math.max(0, n.respawnAt - w.totalTime)]),
        pickups: w.pickups.filter((p) => !p.alive).map((p) => [p.id, Math.max(0, p.respawnAt - w.totalTime)]),
      },
      player: this.player.serialize(),
      inventory: this.inventory.serialize(),
      buildings: this.building.serialize(),
      monkeys: this.monkeys.serialize(),
    };
  }

  save(silent = false) {
    if (!this.world || this.state === 'menu' && !silent) return;
    const ok = writeSave(this.slot, this.serialize());
    if (!silent) this.hud.notify(ok ? 'Game saved.' : 'Could not save (browser storage is blocked).', ok ? 'good' : 'bad');
  }

  restore(d) {
    const w = this.world;
    for (const n of w.nodes) if (!n.alive) w.restoreNode(n);
    for (const p of w.pickups) { p.alive = true; p.mesh.visible = true; }
    w.time = d.world.time; w.day = d.world.day;
    for (const [id, rem] of d.world.removed) { const n = w.nodes[id]; if (n) { w.removeNode(n, false); n.respawnAt = w.totalTime + rem; } }
    for (const [id, rem] of d.world.pickups) { const p = w.pickups[id]; if (p) { w.takePickup(p); p.respawnAt = w.totalTime + rem; } }
    this.inventory.restore(d.inventory);
    this.building.restore(d.buildings);
    const cages = {};
    for (const s of this.building.structures) cages[s.id] = s;
    this.monkeys.restore(d.monkeys, cages);
    this.player.restore(d.player);
  }

  // ------------------------------------------------------------------ frame
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc > 0.5) { document.getElementById('fps').textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} fps`; this.fpsAcc = 0; this.fpsFrames = 0; }

    if (this.state === 'menu') this.updateMenuCamera(dt);
    const playing = this.state === 'playing';
    const live = playing || this.state === 'build';

    if (live) {
      this.handleInput(dt);
      this.player.update(dt, this.input, playing);
      this.updateCamera();
    }
    if (this.state !== 'paused' && this.state !== 'dead') {
      this.world.update(dt, this.camera, this.state === 'menu' ? { position: this.camera.position } : this.player);
      this.monkeys.update(dt);
      this.building.update(dt);
    }
    if (live) {
      this.updateInteraction();
      this.updateTorch();
      const sunDir = this.world.sun.position.clone().sub(this.world.sun.target.position).normalize();
      this.viewmodel.update(dt, this.player, this.input, sunDir, this.world.sun.intensity / 3.2, this.scene.environmentIntensity, () => this.onSwingHit());
      this.hud.update();
      this.autosave(dt);
    }
    if (this.audio.ready) {
      const p = live ? this.player.position : this.camera.position;
      this.audio.update(dt, this.world.daylight, this.world.riverDist(p.x, p.z), !live);
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (live) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
    this.input.endFrame();
  }

  updateMenuCamera(dt) {
    // slow look around from the middle of the camp clearing
    this.menuT = (this.menuT || 0) + dt * 0.03;
    const a = this.menuT;
    this.camera.position.set(CAMP.x, this.world.heightAt(CAMP.x, CAMP.y) + 2.2, CAMP.y);
    this.camera.rotation.set(0.06, a, 0, 'YXZ');
  }

  updateCamera() {
    const p = this.player;
    this.camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    // keep the near plane out of the water surface while swimming
    if (p.swimming) this.camera.position.y = Math.max(this.camera.position.y, WATER_LEVEL + 0.25);
  }

  updateTorch() {
    const cur = this.inventory.current;
    const on = cur && cur.id === 'torch';
    const want = on ? 9 * (1 - this.world.daylight * 0.7) : 0;
    this.torchLight.intensity += (want - this.torchLight.intensity) * 0.2;
    const fwd = this.player.lookDir();
    this.torchLight.position.copy(this.camera.position).addScaledVector(fwd, 0.6).add(new THREE.Vector3(0, -0.2, 0));
  }

  autosave(dt) {
    this.autosaveT = (this.autosaveT || 0) + dt;
    if (this.autosaveT > 120) { this.autosaveT = 0; this.save(true); }
  }

  // ------------------------------------------------------------------ input
  handleInput(dt) {
    const inp = this.input, inv = this.inventory;
    if (inp.pressed.has('KeyB')) { this.toggleBuildMenu(); return; }
    if (this.state !== 'playing') return;
    if (inp.pressed.has('Escape') && this.building.placing) { this.building.cancelPlacing(); return; }

    // hotbar
    for (let i = 0; i < 10; i++) if (inp.pressed.has(`Digit${(i + 1) % 10}`)) this.select(i);
    if (inp.mouse.wheel && !this.building.placing) this.select((inv.selected + inp.mouse.wheel + 10) % 10);

    if (this.building.placing) { this.building.updatePlacing(inp, this.camera); return; }

    const cur = inv.current;
    const def = cur ? ITEMS[cur.id] : null;

    if (inp.mouse.leftPressed || (inp.mouse.left && def && def.kind === 'tool' && def.damage)) {
      // tie a rope if aiming at a marker
      const mk = this.building.markerUnderCrosshair(this.camera);
      if (mk && inp.mouse.leftPressed) {
        if (this.viewmodel.startUse()) {
          setTimeout(() => this.building.completeStep(mk.userData.structure, mk.userData.step), 350);
          this.audio.play('actions/cloth_1', 0.5);
        }
      } else if (def && def.damage && !this.viewmodel.busy) {
        this.viewmodel.startSwing();
        this.swingTarget = this.target && this.target.node ? this.target.node : null;
      }
    }

    if (inp.pressed.has('KeyF') || inp.mouse.rightPressed) this.useSelected();
    if (inp.pressed.has('KeyE')) this.interact();
  }

  select(i) {
    if (this.inventory.selected === i) return;
    this.inventory.selected = i;
    this.audio.play('actions/cloth_2', 0.25);
  }

  useSelected() {
    const inv = this.inventory, cur = inv.current, p = this.player;
    if (!cur || this.viewmodel.busy) return;
    const def = ITEMS[cur.id];
    if (def.kind === 'food') {
      if (p.hunger > 98) { this.hud.notify("You're not hungry.", 'info'); return; }
      this.viewmodel.startUse();
      p.eat(def);
      inv.consumeSelected(1);
      this.audio.play('actions/knife_slice', 0.35, 0.8);
      this.hud.notify(`Ate ${def.name.toLowerCase()}.`, 'good');
    } else if (def.kind === 'drink') {
      if (cur.charges <= 0) { this.hud.notify('The canteen is empty. Fill it at the river (E).', 'info'); return; }
      this.viewmodel.startUse();
      cur.charges--; p.drink(def.thirst);
      this.audio.play('actions/bubbles', 0.5);
    }
  }

  // ------------------------------------------------------------------ what the player is looking at
  updateInteraction() {
    const p = this.player, w = this.world, inv = this.inventory;
    const cur = inv.current, def = cur ? ITEMS[cur.id] : null;
    const eye = p.eyePosition, dir = p.lookDir();
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.viewmodel.show(cur ? cur.id : null);
    this.target = null;
    let prompt = '';

    if (this.building.placing) { this.hud.setPrompt(''); return; }

    const mk = this.building.markerUnderCrosshair(this.camera);
    if (mk) { this.hud.setPrompt('<b>[LMB]</b> Tie rope'); return; }

    // a tamed monkey + an empty finished cage nearby
    const followers = this.monkeys.tamedFollowers();
    const cage = this.building.nearestStructure(p.position, (s) => s.type === 'bamboo_cage' && s.complete && !s.monkey, 3.2);
    if (cage && followers.length) {
      this.target = { cage, monkey: followers[0] };
      this.hud.setPrompt(`<b>[E]</b> Put ${followers[0].sp.name} in the cage`);
      return;
    }

    // feeding a monkey
    if (def && def.kind === 'food') {
      const m = this.monkeys.nearestFeedable(p.position, flat);
      if (m) {
        this.target = { monkey: m };
        const fav = m.sp.favourite === cur.id ? ' (favourite!)' : '';
        this.hud.setPrompt(`<b>[E]</b> Feed ${m.sp.name} ${def.name.toLowerCase()}${fav}${p.crouching ? '' : ' — crouch (Ctrl) for better odds'}`);
        return;
      }
    }

    // pickups on the ground
    let best = null, bestD = 2.4;
    for (const pk of w.pickups) {
      if (!pk.alive) continue;
      const dx = pk.x - p.position.x, dz = pk.z - p.position.z, d = Math.hypot(dx, dz);
      if (d < bestD && (dx * flat.x + dz * flat.z) / (d || 1) > 0.5) { bestD = d; best = pk; }
    }
    if (best) { this.target = { pickup: best }; this.hud.setPrompt(`<b>[E]</b> Pick up ${ITEMS[best.item].name}`); return; }

    // harvest nodes
    let node = null, nd = 1e9;
    for (const n of w.nodesNear(p.position.x, p.position.z)) {
      const dx = n.x - p.position.x, dz = n.z - p.position.z, d = Math.hypot(dx, dz);
      const reach = (n.reach || 1.5) + 1.1;
      if (d > reach) continue;
      const facing = (dx * flat.x + dz * flat.z) / (d || 1);
      if (facing < (d < 1 ? -0.2 : 0.6)) continue;
      const score = d - facing;
      if (score < nd) { nd = score; node = n; }
    }
    if (node) {
      this.target = { node };
      if (node.type === 'plant') prompt = `<b>[E]</b> Gather fiber · ${node.label}`;
      else if (node.type === 'berrybush') prompt = `<b>[E]</b> Pick berries`;
      else if (node.type === 'bananatree') prompt = `${node.label}: bananas grow on the ground below`;
      else {
        const tool = def && def.damage ? (def.damage[node.resource] ? '<b>[LMB]</b> ' : '') : '';
        prompt = tool ? `${tool}Chop · ${node.label} (${node.resource})` : `${node.label} · equip the axe`;
      }
      this.hud.setPrompt(prompt);
      return;
    }

    // water
    const ahead = p.position.clone().addScaledVector(flat, 1.2);
    if (w.heightAt(ahead.x, ahead.z) < WATER_LEVEL - 0.05 || p.position.y < WATER_LEVEL + 0.1) {
      this.target = { water: true };
      this.hud.setPrompt(cur && cur.id === 'canteen' ? '<b>[E]</b> Fill canteen' : '<b>[E]</b> Drink from the river');
      return;
    }
    this.hud.setPrompt('');
  }

  interact() {
    const t = this.target, p = this.player, inv = this.inventory, w = this.world;
    if (!t) return;
    if (t.cage) { this.monkeys.putInCage(t.monkey, t.cage); return; }
    if (t.monkey) {
      const cur = inv.current;
      if (t.monkey.fedCooldown > 0) return;
      t.monkey.fedCooldown = 1.2;
      this.viewmodel.startUse();
      this.monkeys.feed(t.monkey, cur.id);
      inv.consumeSelected(1);
      return;
    }
    if (t.pickup) {
      if (!inv.addItem(t.pickup.item, t.pickup.count)) { this.hud.notify('Hotbar full.', 'bad'); return; }
      w.takePickup(t.pickup);
      this.audio.play('actions/pickup', 0.6);
      this.viewmodel.startUse();
      return;
    }
    if (t.node) {
      const n = t.node;
      if (n.type === 'plant') {
        w.harvest(n, 1);
        inv.addResource('fiber', n.yieldPerHit);
        this.audio.play('actions/cloth_1', 0.5, 1.3);
        this.viewmodel.startUse();
        this.hud.notify(`+${n.yieldPerHit} fiber`, 'good');
      } else if (n.type === 'berrybush') {
        w.harvest(n, 1);
        inv.addItem('berries', 3);
        this.audio.play('actions/pickup', 0.5);
        this.viewmodel.startUse();
        this.hud.notify('+3 berries', 'good');
      }
      return;
    }
    if (t.water) {
      const cur = inv.current;
      if (cur && cur.id === 'canteen') { cur.charges = ITEMS.canteen.charges; this.hud.notify('Canteen filled.', 'good'); }
      else { p.drink(25); this.hud.notify('You drink from the river.', 'good'); }
      this.audio.play('actions/splash_1', 0.5);
      this.viewmodel.startUse();
    }
  }

  onSwingHit() {
    const n = this.swingTarget;
    const cur = this.inventory.current;
    if (!n || !n.alive || !cur) return;
    const def = ITEMS[cur.id];
    const power = def.damage && def.damage[n.resource];
    if (!power) return;
    const d = Math.hypot(n.x - this.player.position.x, n.z - this.player.position.z);
    if (d > (n.reach || 1.5) + 1.3) return;
    const r = this.world.harvest(n, power);
    if (!r) return;
    const amount = Math.max(1, Math.round(r.amount * power));
    this.inventory.addResource(n.resource, amount);
    this.audio.play(n.resource === 'stone' ? 'actions/chop' : 'actions/woodcut', 0.7, n.resource === 'stone' ? 1.4 : 1);
    this.hud.notify(`+${amount} ${n.resource}`, 'good');
    if (r.done && n.fall) this.audio.play('actions/tree_fall', 0.7);
    if (def.durability) {
      cur.durability -= 1;
      if (cur.durability <= 0) { this.inventory.slots[this.inventory.selected] = null; this.hud.notify(`Your ${def.name.toLowerCase()} broke!`, 'bad'); }
    }
  }
}
