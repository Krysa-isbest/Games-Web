// The third-person camera: over the right shoulder, closer and narrower while aiming, a little further back
// while sprinting. It never goes through walls: a ray from the head to the shoulder and one from the shoulder
// back to the camera pull it in front of anything in the way (in at once, back out smoothly).
import { S } from '../core/save.js';
import { G } from '../core/physics.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// The FOV setting is horizontal, measured on a 16:9 screen (like most shooters). three.js wants the vertical one.
// Wider screens then see more to the sides, not less above and below.
export const verticalFov = h => 2 * Math.atan(Math.tan(h * Math.PI / 360) * 9 / 16) * 180 / Math.PI;

const VIEWS = {
  normal: { d: 3.1, s: 0.6, u: 0.18, f: 1 },
  sprint: { d: 3.5, s: 0.55, u: 0.18, f: 1.06 },
  aim:    { d: 1.55, s: 0.72, u: 0.1, f: 0.72 },
  dead:   { d: 4.6, s: 0, u: 0.5, f: 1 },
};

export class OrbitCam {
  constructor(camera, phys, exclude = 0) {
    this.camera = camera;
    this.phys = phys;
    this.yaw = 0;
    this.pitch = -0.12;
    this.dist = 3.1; this.side = 0.6; this.up = 0.18; this.fovK = 1;
    this.cur = 3.1;                     // the distance after collisions
    this.pivotY = null;
    this.shake = 0;
    this.filter = G.WORLD & ~exclude;
  }
  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.25, 1.15);
  }
  kick(amount) { this.shake = Math.min(1, this.shake + amount * (S.shake ?? 1)); }

  // target = the feet (drawn position). st = { eye, aim, sprint, dead }
  update(dt, target, st) {
    const v = st.dead ? VIEWS.dead : st.aim ? VIEWS.aim : st.sprint ? VIEWS.sprint : VIEWS.normal;
    this.dist = damp(this.dist, v.d, 9, dt);
    this.side = damp(this.side, v.s, 9, dt);
    this.up = damp(this.up, v.u, 9, dt);
    this.fovK = damp(this.fovK, v.f, 10, dt);
    if (st.dead) this.yaw += dt * 0.25;                 // a slow turn around the body
    const py = target.y + st.eye;
    this.pivotY = this.pivotY === null ? py : damp(this.pivotY, py, 16, dt);

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;        // where the camera looks
    const rx = cy, rz = -sy;                            // its right, kept level
    const pivot = { x: target.x, y: this.pivotY, z: target.z };
    let side = this.side;
    if (side > 0.01) {
      const h = this.phys.ray(pivot, { x: rx, y: 0, z: rz }, side + 0.25, this.filter);
      if (h) side = Math.max(0, h.t - 0.25);
    }
    const sh = { x: pivot.x + rx * side, y: pivot.y + this.up, z: pivot.z + rz * side };
    const back = { x: -fx, y: -fy, z: -fz };
    let d = this.dist;
    const h = this.phys.ray(sh, back, d + 0.3, this.filter);
    if (h) d = Math.max(0.3, h.t - 0.3);
    this.cur = d < this.cur ? d : damp(this.cur, d, 5, dt);

    const c = this.camera;
    c.position.set(sh.x + back.x * this.cur, sh.y + back.y * this.cur, sh.z + back.z * this.cur);
    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 0.06;
      c.position.x += (Math.random() - 0.5) * k; c.position.y += (Math.random() - 0.5) * k; c.position.z += (Math.random() - 0.5) * k;
      this.shake = damp(this.shake, 0, 7, dt);
    }
    c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const fov = verticalFov(S.fov) * this.fovK;
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }
}
