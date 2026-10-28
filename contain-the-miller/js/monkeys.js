// Monkey AI: wander, notice the player, flee, get fed (taming roll), follow the player, live in a cage.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SPECIES, ITEMS } from './data.js';
import { WATER_LEVEL, CAMP } from './world.js';
import { angleDiff, damp, clamp } from './util.js';

const ANIMS = {
  chimp_wild: { idle: '01_Idle', walk: '02_KnuckleWalk', run: '03_Gallop', carry: '04_BipedalWalk', display: '05_PantHoot_Display' },
  chimp_basic: { idle: 'Idle' },
};

export class Monkeys {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.prepared = {};
  }

  prepare(model, height, tint) {
    const key = model + (tint || '');
    if (this.prepared[key]) return this.prepared[key];
    const gltf = this.game.assets.models[model];
    const probe = SkeletonUtils.clone(gltf.scene);
    probe.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(probe, true);
    const scale = height / (box.max.y - box.min.y);
    let materials = null;
    if (tint) {
      materials = new Map();
      // recolour only the dark fur materials; skin (face, hands) keeps its colour
      probe.traverse((o) => {
        if (!o.isMesh || materials.has(o.material)) return;
        const c = o.material.color;
        if (0.3 * c.r + 0.6 * c.g + 0.1 * c.b > 0.15) return;
        const m = o.material.clone(); m.color = new THREE.Color(tint); materials.set(o.material, m);
      });
    }
    return (this.prepared[key] = { gltf, scale, yOffset: -box.min.y * scale, materials });
  }

  spawn(speciesId, x, z, state = 'wild') {
    const sp = SPECIES[speciesId];
    const prep = this.prepare(sp.model, sp.height, sp.tint);
    const obj = SkeletonUtils.clone(prep.gltf.scene);
    obj.scale.setScalar(prep.scale);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        if (prep.materials && prep.materials.has(o.material)) o.material = prep.materials.get(o.material);
      }
    });
    const holder = new THREE.Group();
    holder.add(obj);
    obj.position.y = prep.yOffset;
    this.game.scene.add(holder);
    const mixer = new THREE.AnimationMixer(obj);
    const names = ANIMS[sp.model];
    const actions = {};
    for (const [k, clipName] of Object.entries(names)) {
      const clip = prep.gltf.animations.find((a) => a.name === clipName);
      if (clip) actions[k] = mixer.clipAction(clip);
    }
    const m = {
      id: this.list.length, species: speciesId, sp, holder, obj, mixer, actions,
      pos: new THREE.Vector3(x, this.game.world.heightAt(x, z), z), heading: Math.random() * Math.PI * 2,
      home: new THREE.Vector2(x, z), target: null, state, timer: Math.random() * 4, alert: 0,
      current: null, speed: 0, cage: null, bobPhase: Math.random() * 10, fedCooldown: 0,
    };
    this.play(m, 'idle');
    this.list.push(m);
    return m;
  }

  play(m, name, fade = 0.3) {
    const fallback = m.actions[name] ? name : 'idle';
    if (m.current === fallback) return;
    const next = m.actions[fallback];
    if (!next) return;
    next.reset().fadeIn(fade).play();
    if (m.current && m.actions[m.current]) m.actions[m.current].fadeOut(fade);
    m.current = fallback;
  }

  populate() {
    const w = this.game.world;
    const r = w.rng;
    const groups = [
      { species: 'chimpanzee', groups: 5, size: [2, 3], minCamp: 60 },
      { species: 'basic_monkey', groups: 4, size: [1, 3], minCamp: 35 },
    ];
    for (const g of groups) {
      for (let i = 0; i < g.groups; i++) {
        let x, z, tries = 0;
        do {
          x = (r() * 2 - 1) * 170; z = (r() * 2 - 1) * 170; tries++;
        } while (tries < 50 && (w.heightAt(x, z) < 1.5 || Math.hypot(x - CAMP.x, z - CAMP.y) < g.minCamp || w.riverDist(x, z) < 15));
        const n = g.size[0] + Math.floor(r() * (g.size[1] - g.size[0] + 1));
        for (let k = 0; k < n; k++) this.spawn(g.species, x + (r() - 0.5) * 8, z + (r() - 0.5) * 8);
      }
    }
  }

  // ------------------------------------------------------------------ interaction
  nearestFeedable(pos, dir, reach = 2.6) {
    let best = null, bestD = 1e9;
    for (const m of this.list) {
      if (m.state === 'caged' || m.state === 'tamed') continue;
      const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d > reach) continue;
      if ((dx * dir.x + dz * dir.z) / (d || 1) < 0.55) continue;
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  feed(m, itemId) {
    const sp = m.sp;
    const player = this.game.player;
    let mult = itemId === sp.favourite ? 1 : sp.accepts.includes(itemId) ? 0.65 : 0.25;
    if (!player.crouching) mult *= 0.55;
    if (m.alert > 0.5) mult *= 0.5;
    const chance = clamp(sp.catch * mult, 0.02, 0.95);
    const ok = Math.random() < chance;
    if (ok) {
      m.state = 'tamed';
      m.alert = 0;
      this.game.hud.notify(`${sp.name} tamed! It will follow you. Lead it to an empty cage and press E on the cage.`, 'good');
      this.game.audio.play('actions/pickup', 0.5);
    } else {
      this.game.hud.notify(`The ${sp.name.toLowerCase()} snatched the ${ITEMS[itemId].name.toLowerCase()} and ran off. (${Math.round(chance * 100)}% chance)`, 'bad');
      if (Math.random() < sp.scratch * (player.crouching ? 0.6 : 1.4)) {
        player.damage(8 + Math.random() * 8, `The ${sp.name.toLowerCase()} scratched you!`);
      }
      this.startFlee(m, player.position);
    }
    return { ok, chance };
  }

  startFlee(m, from) {
    m.state = 'flee';
    m.timer = 4 + Math.random() * 3;
    const away = new THREE.Vector2(m.pos.x - from.x, m.pos.z - from.z).normalize();
    m.target = new THREE.Vector2(m.pos.x + away.x * 30, m.pos.z + away.y * 30);
  }

  putInCage(m, cage) {
    m.state = 'caged';
    m.cage = cage;
    cage.monkey = m;
    m.pos.set(cage.x, cage.floorY, cage.z);
    m.heading = cage.rot + Math.PI;
    this.play(m, 'idle');
    this.game.hud.notify(`${m.sp.name} is in the cage. It earns $${m.sp.income}/min.`, 'good');
    this.game.audio.play('actions/cage_latch', 0.7);
  }

  tamedFollowers() { return this.list.filter((m) => m.state === 'tamed'); }

  // ------------------------------------------------------------------ update
  update(dt) {
    const player = this.game.player;
    const w = this.game.world;
    const pp = player.position;
    for (const m of this.list) {
      const dist = Math.hypot(m.pos.x - pp.x, m.pos.z - pp.z);
      if (dist > 140 && m.state !== 'tamed') { m.holder.visible = false; continue; }
      m.holder.visible = true;
      if (m.fedCooldown > 0) m.fedCooldown -= dt;

      let wantSpeed = 0, anim = 'idle';
      switch (m.state) {
        case 'wild': {
          // awareness: closer, louder and in view means faster noticing
          const sense = player.crouching ? m.sp.senseCrouch : player.sprinting ? m.sp.senseWalk * 1.5 : m.sp.senseWalk;
          const toP = Math.atan2(pp.x - m.pos.x, pp.z - m.pos.z);
          const facing = Math.abs(angleDiff(m.heading, toP)) < 1.3;
          if (dist < sense && (facing || dist < sense * 0.5)) m.alert = Math.min(1.2, m.alert + dt * (player.crouching ? 0.35 : 1.1));
          else m.alert = Math.max(0, m.alert - dt * 0.3);
          if (m.alert > 0.35) {
            m.heading = turn(m.heading, toP, 4, dt);
            anim = m.alert > 0.75 && m.actions.display ? 'display' : 'idle';
            if (m.alert >= 1 && dist < sense * 0.8 && !player.crouching) this.startFlee(m, pp);
            break;
          }
          m.timer -= dt;
          if (!m.target || m.timer <= 0) {
            if (Math.random() < 0.45) { m.target = null; m.timer = 2 + Math.random() * 5; }
            else {
              const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 14;
              m.target = new THREE.Vector2(m.home.x + Math.cos(a) * d, m.home.y + Math.sin(a) * d);
              m.timer = 12;
            }
          }
          if (m.target) {
            const d = Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.z);
            if (d < 0.6) m.target = null;
            else { m.heading = turn(m.heading, Math.atan2(m.target.x - m.pos.x, m.target.y - m.pos.z), 2.5, dt); wantSpeed = m.sp.speed; anim = 'walk'; }
          }
          break;
        }
        case 'flee': {
          m.timer -= dt;
          m.heading = turn(m.heading, Math.atan2(m.target.x - m.pos.x, m.target.y - m.pos.z), 5, dt);
          wantSpeed = m.sp.runSpeed; anim = 'run';
          if (m.timer <= 0 || Math.hypot(m.target.x - m.pos.x, m.target.y - m.pos.z) < 1) {
            m.state = 'wild'; m.alert = 0.4; m.home.set(m.pos.x, m.pos.z); m.target = null; m.timer = 3;
          }
          break;
        }
        case 'tamed': {
          const toP = Math.atan2(pp.x - m.pos.x, pp.z - m.pos.z);
          if (dist > 2.6) {
            m.heading = turn(m.heading, toP, 5, dt);
            wantSpeed = dist > 7 ? m.sp.runSpeed * 0.9 : m.sp.speed * 1.4;
            anim = dist > 7 ? 'run' : 'walk';
          } else { m.heading = turn(m.heading, toP, 2, dt); }
          // if left far behind, catch up
          if (dist > 45) { m.pos.set(pp.x - 2, w.heightAt(pp.x - 2, pp.z - 2), pp.z - 2); }
          break;
        }
        case 'caged': {
          const c = m.cage;
          m.pos.set(c.x, c.floorY, c.z);
          if (Math.random() < dt * 0.2) m.heading = c.rot + Math.PI + (Math.random() - 0.5) * 1.5;
          anim = 'idle';
          break;
        }
      }

      m.speed = damp(m.speed, wantSpeed, 6, dt);
      if (m.speed > 0.01) {
        const nx = m.pos.x + Math.sin(m.heading) * m.speed * dt, nz = m.pos.z + Math.cos(m.heading) * m.speed * dt;
        // monkeys avoid deep water and steep slopes
        if (w.heightAt(nx, nz) > WATER_LEVEL + 0.3 && w.slopeAt(nx, nz) < 1.1) { m.pos.x = nx; m.pos.z = nz; }
        else { m.heading += Math.PI * 0.6; if (m.target) m.target = null; }
        for (const c of w.collidersNear(m.pos.x, m.pos.z)) {
          if (c.box) continue;
          const dx = m.pos.x - c.x, dz = m.pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + 0.3;
          if (d < min && d > 1e-4) { m.pos.x += dx / d * (min - d); m.pos.z += dz / d * (min - d); }
        }
      }
      if (m.state !== 'caged') m.pos.y = w.heightAt(m.pos.x, m.pos.z);

      this.play(m, anim);
      const a = m.actions[m.current];
      if (a && (m.current === 'walk' || m.current === 'run')) a.timeScale = clamp(m.speed / (m.current === 'run' ? m.sp.runSpeed * 0.8 : m.sp.speed), 0.4, 1.6);

      // the basic monkey only has an idle clip, so it gets a little procedural hop when moving
      let hop = 0;
      if (!m.actions.walk && m.speed > 0.2) { m.bobPhase += dt * m.speed * 5; hop = Math.abs(Math.sin(m.bobPhase)) * 0.08; }
      m.holder.position.set(m.pos.x, m.pos.y + hop, m.pos.z);
      m.holder.rotation.y = m.heading;
      if (dist < 70 || m.state === 'tamed' || m.state === 'caged') m.mixer.update(dt);
    }
  }

  serialize() {
    return this.list.map((m) => ({ s: m.species, x: m.pos.x, z: m.pos.z, state: m.state === 'flee' ? 'wild' : m.state, cage: m.cage ? m.cage.id : null }));
  }

  restore(data, cagesById) {
    for (const m of this.list) this.game.scene.remove(m.holder);
    this.list = [];
    for (const d of data) {
      const m = this.spawn(d.s, d.x, d.z, d.state === 'caged' ? 'wild' : d.state);
      if (d.state === 'caged' && cagesById[d.cage]) {
        m.state = 'caged'; m.cage = cagesById[d.cage]; m.cage.monkey = m;
        m.heading = m.cage.rot + Math.PI;
      }
    }
  }
}

function turn(cur, target, rate, dt) {
  const d = angleDiff(cur, target);
  return cur + clamp(d, -rate * dt, rate * dt);
}
