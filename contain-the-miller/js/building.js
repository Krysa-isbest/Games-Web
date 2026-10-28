// Build menu (B), placement preview, the rope-lashing build minigame, structures and cage income.
import * as THREE from 'three';
import { BUILDABLES } from './data.js';
import { makeTemplate, templateToObject } from './assets.js';
import { WATER_LEVEL } from './world.js';

const ROPE_COLOR = 0x8a6a3e;

export class Building {
  constructor(game) {
    this.game = game;
    this.structures = [];
    this.placing = null;      // { type, ghost, rot, valid, pos }
    this.nextId = 1;
    this.raycaster = new THREE.Raycaster();
    this.markerGeo = new THREE.TorusGeometry(0.11, 0.035, 8, 20);
    this.ropeGeo = new THREE.TorusGeometry(0.075, 0.028, 6, 16);
    this.ropeMat = new THREE.MeshStandardMaterial({ color: ROPE_COLOR, roughness: 1 });
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.85, depthTest: false });
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x6dff8a, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.35, depthWrite: false });
    const A = game.assets;
    const tex = (id, rx, ry) => { const t = A.tex(id, 'color').clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t; };
    this.mats = {
      bamboo: new THREE.MeshStandardMaterial({ color: 0xc9b47a, map: tex('bamboo_wall', 1, 3), roughness: 0.7 }),
      bambooFloor: new THREE.MeshStandardMaterial({ map: tex('bamboo_wall', 2, 2), normalMap: A.tex('bamboo_wall', 'normal'), roughness: 0.75 }),
      thatch: new THREE.MeshStandardMaterial({ map: tex('thatch_roof_angled', 2, 2), normalMap: A.tex('thatch_roof_angled', 'normal'), roughness: 1, side: THREE.DoubleSide }),
      log: new THREE.MeshStandardMaterial({ map: tex('bark_brown_02', 1, 1), roughness: 0.95 }),
    };
    this.firePitTemplate = makeTemplate(A.models.fire_pit.scene, { height: 0.32 });
  }

  // ------------------------------------------------------------------ structure geometry
  pole(group, from, to, r, mat = this.mats.bamboo) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, len, 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  }

  // returns { group, steps: [{ marker: Vector3, reveal: [meshes] }], footprint, collider, extra }
  makeStructure(type) {
    const g = new THREE.Group();
    const steps = [];
    let footprint = 1, collider = null, floorTop = null;
    const P = (...a) => this.pole(g, ...a);
    if (type === 'bamboo_cage') {
      const s = 1.0, h = 1.9;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(2 * s + 0.1, 0.1, 2 * s + 0.1), this.mats.bambooFloor);
      floor.position.y = 0.08; floor.receiveShadow = true; floor.castShadow = true; g.add(floor);
      const corners = [[-s, -s], [s, -s], [s, s], [-s, s]];
      for (const [x, z] of corners) P([x, 0, z], [x, h, z], 0.06);
      for (let k = 0; k < 4; k++) {
        const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 4];
        const reveal = [P([x1, h, z1], [x2, h, z2], 0.045), P([x1, 0.15, z1], [x2, 0.15, z2], 0.04)];
        for (let i = 1; i < 9; i++) {
          const t = i / 9;
          reveal.push(P([x1 + (x2 - x1) * t, 0.12, z1 + (z2 - z1) * t], [x1 + (x2 - x1) * t, h, z1 + (z2 - z1) * t], 0.022));
        }
        steps.push({ marker: new THREE.Vector3(x1 * 1.04, h - 0.05, z1 * 1.04), reveal });
      }
      // door lashings on the front (+z side)
      const doorRail = P([-s, 1.0, s], [s, 1.0, s], 0.035);
      steps.push({ marker: new THREE.Vector3(-0.35, 1.0, s * 1.05), reveal: [doorRail] });
      steps.push({ marker: new THREE.Vector3(0.35, 1.0, s * 1.05), reveal: [] });
      footprint = 1.5;
      collider = { hx: s + 0.08, hz: s + 0.08 };
    } else if (type === 'campfire') {
      const pit = templateToObject(this.firePitTemplate);
      g.add(pit);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const log = this.pole(g, [Math.cos(a) * 0.38, 0.05, Math.sin(a) * 0.38], [Math.cos(a) * 0.05, 0.42, Math.sin(a) * 0.05], 0.055, this.mats.log);
        steps.push({ marker: new THREE.Vector3(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3), reveal: [log] });
      }
      footprint = 0.8;
      collider = { r: 0.75 };
    } else if (type === 'bamboo_wall') {
      const w = 1.0, h = 2.2;
      P([-w, 0, 0], [-w, h, 0], 0.06); P([w, 0, 0], [w, h, 0], 0.06);
      const left = [P([-w, 0.4, 0], [0, 0.4, 0], 0.04), P([-w, h - 0.2, 0], [0, h - 0.2, 0], 0.04)];
      const right = [P([0, 0.4, 0], [w, 0.4, 0], 0.04), P([0, h - 0.2, 0], [w, h - 0.2, 0], 0.04)];
      for (let i = 0; i < 16; i++) {
        const x = -w + 0.06 + (i + 0.5) * (2 * w - 0.12) / 16;
        (x < 0 ? left : right).push(P([x, 0, 0.05], [x, h - 0.05, 0.05], 0.05));
      }
      steps.push({ marker: new THREE.Vector3(-w, h - 0.2, 0.12), reveal: left });
      steps.push({ marker: new THREE.Vector3(w, h - 0.2, 0.12), reveal: right });
      footprint = 1.1;
      collider = { hx: w + 0.05, hz: 0.12 };
    } else if (type === 'bamboo_floor') {
      const s = 1.2, top = 0.36;
      const corners = [[-s, -s], [s, -s], [s, s], [-s, s]];
      for (const [x, z] of corners) P([x, -0.3, z], [x, top, z], 0.07);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2 * s + 0.2, 0.08, 2 * s + 0.2), this.mats.bambooFloor);
      deck.position.y = top; deck.castShadow = deck.receiveShadow = true;
      g.add(deck);
      steps.push({ marker: new THREE.Vector3(-s, top + 0.1, -s), reveal: [] });
      steps.push({ marker: new THREE.Vector3(s, top + 0.1, -s), reveal: [] });
      steps.push({ marker: new THREE.Vector3(s, top + 0.1, s), reveal: [] });
      steps.push({ marker: new THREE.Vector3(-s, top + 0.1, s), reveal: [deck] });
      footprint = 1.7;
      collider = { hx: s + 0.1, hz: s + 0.1, top: top + 0.04 };
      floorTop = top + 0.04;
    } else if (type === 'thatch_roof') {
      const s = 1.5, h = 2.5;
      const corners = [[-s, -s], [s, -s], [s, s], [-s, s]];
      for (const [x, z] of corners) P([x, 0, z], [x, h, z], 0.07);
      const ridge = P([-s - 0.2, h + 0.7, 0], [s + 0.2, h + 0.7, 0], 0.06);
      const mk = (sign) => {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * s + 0.6, Math.hypot(s + 0.4, 0.75)), this.mats.thatch);
        plane.position.set(0, h + 0.35, sign * (s + 0.4) / 2);
        plane.rotation.x = -Math.PI / 2 + sign * Math.atan2(0.75, s + 0.4);
        plane.castShadow = plane.receiveShadow = true;
        g.add(plane);
        return plane;
      };
      const a = mk(1), b = mk(-1);
      steps.push({ marker: new THREE.Vector3(-s, h, -s), reveal: [ridge] });
      steps.push({ marker: new THREE.Vector3(s, h, -s), reveal: [b] });
      steps.push({ marker: new THREE.Vector3(s, h, s), reveal: [] });
      steps.push({ marker: new THREE.Vector3(-s, h, s), reveal: [a] });
      footprint = 1.9;
      collider = null;
      // posts only
      g.userData.posts = corners.map(([x, z]) => ({ x, z, r: 0.12 }));
    }
    return { group: g, steps, footprint, collider, floorTop };
  }

  // ------------------------------------------------------------------ placing
  startPlacing(type) {
    this.cancelPlacing();
    const { group } = this.makeStructure(type);
    group.traverse((o) => { if (o.isMesh) { o.material = this.ghostOk; o.castShadow = false; } });
    this.game.scene.add(group);
    this.placing = { type, ghost: group, rot: this.lastRot || 0, valid: false, pos: new THREE.Vector3() };
    this.game.hud.setHint('Left click: place   R / mouse wheel: rotate   Right click: cancel');
  }

  cancelPlacing() {
    if (!this.placing) return;
    this.game.scene.remove(this.placing.ghost);
    this.placing = null;
    this.game.hud.setHint('');
  }

  canAfford(type) {
    const res = this.game.inventory.resources;
    return Object.entries(BUILDABLES[type].cost).every(([k, v]) => (res[k] || 0) >= v);
  }

  updatePlacing(input, camera) {
    const pl = this.placing;
    if (input.pressed.has('KeyR')) pl.rot += Math.PI / 8;
    if (input.mouse.wheel) pl.rot += input.mouse.wheel * Math.PI / 16;
    this.lastRot = pl.rot;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    this.raycaster.far = 8;
    let hit = this.raycaster.intersectObject(this.game.world.terrain, false)[0];
    const w = this.game.world;
    if (!hit) {
      // looking at the horizon: put the preview a few metres ahead on the ground
      const f = this.game.player.forward, pp = this.game.player.position;
      const x = pp.x + f.x * 4, z = pp.z + f.z * 4;
      hit = { point: new THREE.Vector3(x, w.heightAt(x, z), z) };
    }
    let valid = false;
    if (hit) {
      pl.pos.copy(hit.point);
      const { footprint } = this.makeStructureInfo(pl.type);
      const hs = [];
      for (const [dx, dz] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) hs.push(w.heightAt(pl.pos.x + dx * footprint * 0.7, pl.pos.z + dz * footprint * 0.7));
      const spread = Math.max(...hs) - Math.min(...hs);
      pl.pos.y = Math.min(...hs) + 0.02;
      valid = spread < 0.8 && Math.min(...hs) > WATER_LEVEL + 0.15;
      const pp = this.game.player.position;
      if (Math.hypot(pp.x - pl.pos.x, pp.z - pl.pos.z) < footprint * 0.6 + 0.4) valid = false;
      for (const c of w.collidersNear(pl.pos.x, pl.pos.z)) {
        const cx = c.box ? c.box.x : c.x, cz = c.box ? c.box.z : c.z;
        const cr = c.box ? Math.max(c.box.hx, c.box.hz) : c.r;
        if (Math.hypot(cx - pl.pos.x, cz - pl.pos.z) < cr + footprint * 0.75) { valid = false; break; }
      }
      if (!this.canAfford(pl.type)) valid = false;
    }
    pl.valid = valid;
    pl.ghost.visible = !!hit;
    pl.ghost.position.copy(pl.pos);
    pl.ghost.rotation.y = pl.rot;
    const mat = valid ? this.ghostOk : this.ghostBad;
    pl.ghost.traverse((o) => { if (o.isMesh) o.material = mat; });

    if (input.mouse.rightPressed) { this.cancelPlacing(); return; }
    if (input.mouse.leftPressed) {
      if (!this.canAfford(pl.type)) { this.game.hud.notify('Not enough resources.', 'bad'); return; }
      if (!valid) { this.game.hud.notify("Can't build here.", 'bad'); return; }
      const inv = this.game.inventory;
      for (const [k, v] of Object.entries(BUILDABLES[pl.type].cost)) inv.resources[k] -= v;
      this.create(pl.type, pl.pos.x, pl.pos.y, pl.pos.z, pl.rot, 0);
      this.game.audio.play('actions/build_creak_1', 0.6);
      this.game.hud.notify(`${BUILDABLES[pl.type].name} frame placed. Click the glowing rings to tie the ropes.`, 'info');
      this.cancelPlacing();
    }
  }

  makeStructureInfo(type) {
    if (!this._info) this._info = {};
    if (!this._info[type]) { const s = this.makeStructure(type); this._info[type] = { footprint: s.footprint }; }
    return this._info[type];
  }

  // ------------------------------------------------------------------ structures
  create(type, x, y, z, rot, doneSteps, id = null) {
    const def = this.makeStructure(type);
    const g = def.group;
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.game.scene.add(g);
    const st = { id: id ?? this.nextId++, type, x, y, z, rot, group: g, steps: def.steps, done: 0, markers: [], complete: false,
      floorTop: def.floorTop, monkey: null, floorY: y + 0.14, light: null, colliders: [] };
    this.nextId = Math.max(this.nextId, st.id + 1);
    for (const s of def.steps) for (const m of s.reveal) m.visible = false;
    def.steps.forEach((s, i) => {
      const mk = new THREE.Mesh(this.markerGeo, this.markerMat);
      mk.position.copy(s.marker);
      mk.renderOrder = 10;
      mk.userData = { structure: st, step: i };
      g.add(mk);
      st.markers.push(mk);
    });
    // colliders
    const c = def.collider;
    if (c && c.r) st.colliders.push(this.game.world.addCollider({ x, z, r: c.r, structure: st.id }));
    else if (c) st.colliders.push(this.game.world.addCollider({ box: { x, z, hx: c.hx, hz: c.hz, rot: -rot }, top: c.top !== undefined ? y + c.top : undefined, structure: st.id }));
    if (g.userData.posts) {
      for (const p of g.userData.posts) {
        const wx = x + p.x * Math.cos(rot) + p.z * Math.sin(rot), wz = z - p.x * Math.sin(rot) + p.z * Math.cos(rot);
        st.colliders.push(this.game.world.addCollider({ x: wx, z: wz, r: p.r, structure: st.id }));
      }
    }
    this.structures.push(st);
    for (let i = 0; i < doneSteps; i++) this.completeStep(st, i, true);
    return st;
  }

  completeStep(st, i, silent = false) {
    const mk = st.markers[i];
    if (!mk || mk.userData.done) return;
    mk.userData.done = true;
    mk.geometry = this.ropeGeo;
    mk.material = this.ropeMat;
    mk.renderOrder = 0;
    mk.castShadow = true;
    for (const m of st.steps[i].reveal) {
      m.visible = true;
      if (!silent) { m.scale.setScalar(0.01); this.game.world.effects.push({ t: 0, update: (e, dt) => { e.t += dt; m.scale.setScalar(Math.min(1, e.t / 0.35)); return e.t < 0.35; } }); }
    }
    st.done++;
    if (!silent) this.game.audio.play(`actions/build_creak_${1 + Math.floor(Math.random() * 3)}`, 0.6);
    if (st.done >= st.steps.length) this.finish(st, silent);
  }

  finish(st, silent) {
    st.complete = true;
    if (st.type === 'campfire') this.lightFire(st);
    if (!silent) this.game.hud.notify(`${BUILDABLES[st.type].name} finished!`, 'good');
  }

  lightFire(st) {
    const light = new THREE.PointLight(0xff8a3a, 6, 14, 1.6);
    light.position.set(0, 0.7, 0);
    light.castShadow = false;
    st.group.add(light);
    st.light = light;
    // flame sprites
    const flames = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8c2a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.09 + Math.random() * 0.06, 0.45 + Math.random() * 0.3, 7, 1, true), mat);
      f.position.set((Math.random() - 0.5) * 0.18, 0.4, (Math.random() - 0.5) * 0.18);
      f.userData.phase = Math.random() * 10;
      flames.add(f);
    }
    st.group.add(flames);
    st.flames = flames;
    st.sound = this.game.audio.loopAt('ambient/fire_loop', st.group, 0.5);
  }

  // what the crosshair points at: a rope marker of an unfinished structure
  markerUnderCrosshair(camera) {
    const markers = [];
    for (const st of this.structures) if (!st.complete) for (const m of st.markers) if (!m.userData.done) markers.push(m);
    if (!markers.length) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    this.raycaster.far = 3.2;
    // generous hit area: test against an inflated sphere per marker
    let best = null, bestD = 1e9;
    const ray = this.raycaster.ray;
    for (const m of markers) {
      const p = m.getWorldPosition(new THREE.Vector3());
      const d = ray.distanceToPoint(p);
      const along = p.clone().sub(ray.origin).dot(ray.direction);
      if (d < 0.22 && along > 0 && along < 3.2 && along < bestD) { bestD = along; best = m; }
    }
    return best;
  }

  nearestStructure(pos, pred, maxDist = 3) {
    let best = null, bd = maxDist;
    for (const st of this.structures) {
      if (!pred(st)) continue;
      const d = Math.hypot(st.x - pos.x, st.z - pos.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  floorHeightAt(x, z, feetY) {
    let best = null;
    for (const st of this.structures) {
      if (st.type !== 'bamboo_floor' || st.done < st.steps.length) continue;
      const cos = Math.cos(st.rot), sin = Math.sin(st.rot);
      const dx = x - st.x, dz = z - st.z;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) > 1.3 || Math.abs(lz) > 1.3) continue;
      const top = st.y + st.floorTop;
      if (feetY >= top - 0.5 && (best === null || top > best)) best = top;
    }
    return best;
  }

  update(dt) {
    const t = performance.now() / 1000;
    for (const st of this.structures) {
      if (!st.complete) for (const m of st.markers) if (!m.userData.done) { m.rotation.y = t * 2; m.scale.setScalar(1 + Math.sin(t * 5) * 0.12); }
      if (st.flames) {
        for (const f of st.flames.children) { const s = 0.75 + Math.abs(Math.sin(t * 7 + f.userData.phase)) * 0.45; f.scale.set(1, s, 1); }
        st.light.intensity = 5 + Math.sin(t * 13) * 0.8 + Math.sin(t * 7.3) * 0.6;
      }
    }
    // cage income
    let perMin = 0;
    for (const st of this.structures) if (st.type === 'bamboo_cage' && st.complete && st.monkey) perMin += st.monkey.sp.income;
    this.incomePerMin = perMin;
    this.game.inventory.money += perMin * dt / 60;
  }

  serialize() {
    return this.structures.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y, z: s.z, rot: s.rot, done: s.done }));
  }

  restore(list) {
    for (const s of this.structures) { this.game.scene.remove(s.group); if (s.sound) s.sound.stop(); }
    this.game.world.removeCollider((c) => c.structure !== undefined);
    this.structures = [];
    for (const d of list) {
      const st = this.create(d.type, d.x, d.y, d.z, d.rot, 0, d.id);
      for (let i = 0; i < d.done; i++) this.completeStep(st, i, true);
    }
  }
}
