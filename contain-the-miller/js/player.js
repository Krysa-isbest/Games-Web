// First-person movement, collisions, swimming and survival stats.
import * as THREE from 'three';
import { WATER_LEVEL } from './world.js';
import { clamp, damp } from './util.js';

const EYE = 1.65, EYE_CROUCH = 1.05, RADIUS = 0.35;

export class Player {
  constructor(game) {
    this.game = game;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eye = EYE;
    this.onGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.swimming = false;
    this.moving = false;
    this.health = 100; this.stamina = 100; this.hunger = 100; this.thirst = 100; this.oxygen = 100;
    this.staminaLock = 0;
    this.stepTimer = 0;
    this.dead = false;
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  lookDir() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  get eyePosition() { return this.position.clone().add(new THREE.Vector3(0, this.eye, 0)); }

  spawn(x, z, yaw = 0) {
    this.position.set(x, this.game.world.heightAt(x, z) + 0.1, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
  }

  damage(amount, reason) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.game.hud.flashDamage();
    if (reason) this.game.hud.notify(reason, 'bad');
    if (this.health <= 0) { this.dead = true; this.game.onDeath(reason); }
  }

  groundHeight(x, z, feetY) {
    let h = this.game.world.heightAt(x, z);
    const f = this.game.building.floorHeightAt(x, z, feetY);
    if (f !== null && f > h) h = f;
    return h;
  }

  update(dt, input, controlsActive) {
    const s = this.game.settings;
    if (controlsActive && !this.dead) {
      const sens = 0.0022 * s.sensitivity;
      this.yaw -= input.mouse.dx * sens;
      this.pitch = clamp(this.pitch - input.mouse.dy * sens * (s.invertY ? -1 : 1), -1.5, 1.5);
    }

    // ---- wishes
    let fx = 0, fz = 0;
    if (controlsActive && !this.dead) {
      if (input.down.has('KeyW')) fz += 1;
      if (input.down.has('KeyS')) fz -= 1;
      if (input.down.has('KeyA')) fx -= 1;
      if (input.down.has('KeyD')) fx += 1;
    }
    const wantCrouch = controlsActive && (input.down.has('ControlLeft') || input.down.has('KeyC'));
    this.crouching = wantCrouch && !this.swimming;
    const moving = fx !== 0 || fz !== 0;
    this.moving = moving;
    this.sprinting = controlsActive && moving && fz > 0 && input.down.has('ShiftLeft') && !this.crouching && this.stamina > 1 && this.staminaLock <= 0;

    let speed = this.crouching ? 1.7 : this.sprinting ? 6.4 : 3.7;
    if (this.swimming) speed = this.sprinting ? 3.0 : 2.1;
    const fwd = this.forward, right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, fz).addScaledVector(right, fx);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.onGround || this.swimming ? 12 : 2.5;
    this.velocity.x = damp(this.velocity.x, wish.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, wish.z, accel, dt);

    // ---- vertical
    const world = this.game.world;
    const waterDepth = WATER_LEVEL - world.heightAt(this.position.x, this.position.z);
    this.swimming = waterDepth > 1.3 && this.position.y < WATER_LEVEL - 0.9;
    if (this.swimming) {
      const floatY = WATER_LEVEL - 1.35;
      const sinking = this.stamina <= 0;
      const target = sinking ? floatY - 1.2 : floatY;
      this.velocity.y = damp(this.velocity.y, (target - this.position.y) * 2.5, 4, dt);
      if (controlsActive && input.down.has('Space') && !sinking) this.velocity.y = Math.max(this.velocity.y, 1.2);
    } else {
      this.velocity.y -= 20 * dt;
      if (controlsActive && input.pressed.has('Space') && this.onGround && !this.dead) {
        this.velocity.y = 6.2;
        this.onGround = false;
        if (this.stamina > 5) this.stamina -= 5;
      }
    }

    // ---- integrate + collide
    const p = this.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    this.collide();
    p.y += this.velocity.y * dt;
    const g = this.groundHeight(p.x, p.z, p.y);
    if (p.y <= g && !this.swimming) {
      if (this.velocity.y < -11.5) this.damage((-this.velocity.y - 11.5) * 7, 'You fell badly.');
      p.y = g;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (p.y > g + 0.05) {
      this.onGround = false;
    }
    if (p.y < g) p.y = g;

    this.eye = damp(this.eye, this.crouching ? EYE_CROUCH : EYE, 12, dt);

    this.updateStats(dt);
    this.updateFootsteps(dt);
  }

  collide() {
    const p = this.position;
    for (const c of this.game.world.collidersNear(p.x, p.z)) {
      if (c.box) {
        const b = c.box;
        if (c.top !== undefined && p.y > c.top - 0.45) continue;   // standing on top of it
        if (c.bottom !== undefined && p.y + this.eye < c.bottom) continue;
        const cos = Math.cos(-b.rot), sin = Math.sin(-b.rot);
        const lx = (p.x - b.x) * cos - (p.z - b.z) * sin, lz = (p.x - b.x) * sin + (p.z - b.z) * cos;
        const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
        let dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
        if (d >= RADIUS) continue;
        if (d < 1e-5) {
          // centre inside the box: push out along the shallowest axis
          const ox = b.hx - Math.abs(lx), oz = b.hz - Math.abs(lz);
          if (ox < oz) { dx = Math.sign(lx) || 1; dz = 0; d = 0; } else { dx = 0; dz = Math.sign(lz) || 1; d = 0; }
          const push = (ox < oz ? ox : oz) + RADIUS;
          const wx = dx * cos + dz * sin, wz = -dx * sin + dz * cos;
          p.x += wx * push; p.z += wz * push;
        } else {
          const push = RADIUS - d;
          const nx = dx / d, nz = dz / d;
          const wx = nx * cos + nz * sin, wz = -nx * sin + nz * cos;
          p.x += wx * push; p.z += wz * push;
        }
      } else {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + RADIUS;
        if (d < min && d > 1e-5) { p.x += (dx / d) * (min - d); p.z += (dz / d) * (min - d); }
      }
    }
  }

  updateStats(dt) {
    if (this.dead) return;
    const g = this.game;
    this.hunger = Math.max(0, this.hunger - dt * 100 / 1800);
    this.thirst = Math.max(0, this.thirst - dt * 100 / 1200 * (this.sprinting ? 1.6 : 1));
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - 17 * dt);
    else if (this.swimming && this.moving) this.stamina = Math.max(0, this.stamina - 6 * dt);
    else if (!this.swimming) this.stamina = Math.min(100, this.stamina + (this.moving ? 9 : 16) * dt);
    if (this.stamina <= 0) this.staminaLock = 2.5;
    if (this.staminaLock > 0) this.staminaLock -= dt;

    // drowning: once exhausted in deep water the player sinks and runs out of air
    const headUnder = this.position.y + this.eye < WATER_LEVEL - 0.05;
    if (headUnder) {
      this.oxygen = Math.max(0, this.oxygen - dt * 100 / 12);
      if (this.oxygen <= 0) this.damage(12 * dt, null);
      if (this.oxygen <= 0 && this.health <= 0) g.hud.notify('You drowned.', 'bad');
    } else this.oxygen = Math.min(100, this.oxygen + dt * 40);

    if (this.hunger <= 0 || this.thirst <= 0) {
      this.health = Math.max(0, this.health - dt * 0.6);
      if (this.health <= 0) { this.dead = true; g.onDeath(this.hunger <= 0 ? 'You starved.' : 'You died of thirst.'); }
    } else if (this.hunger > 55 && this.thirst > 55) {
      this.health = Math.min(100, this.health + dt * 0.35);
    }
  }

  updateFootsteps(dt) {
    if (!this.moving || !this.onGround || this.swimming) { this.stepTimer = 0.2; return; }
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.stepTimer = this.sprinting ? 0.32 : this.crouching ? 0.75 : 0.48;
      this.game.audio.footstep(this.crouching ? 0.25 : this.sprinting ? 0.7 : 0.45);
    }
  }

  eat(food) {
    this.hunger = Math.min(100, this.hunger + (food.hunger || 0));
    this.thirst = Math.min(100, this.thirst + (food.thirst || 0));
  }

  drink(amount) { this.thirst = Math.min(100, this.thirst + amount); }

  serialize() {
    return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw, pitch: this.pitch,
      health: this.health, stamina: this.stamina, hunger: this.hunger, thirst: this.thirst };
  }

  restore(d) {
    this.position.set(d.x, d.y, d.z); this.yaw = d.yaw; this.pitch = d.pitch;
    Object.assign(this, { health: d.health, stamina: d.stamina, hunger: d.hunger, thirst: d.thirst });
    this.dead = false;
  }
}
