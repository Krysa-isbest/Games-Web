// Small angle helpers shared by the player, the camera, the HUD and the robots.
// Yaw 0 looks towards -z, like a three.js camera. A yaw's forward vector is (fwdX, 0, fwdZ).
export const TAU = Math.PI * 2;
export const fwdX = y => -Math.sin(y);
export const fwdZ = y => -Math.cos(y);
export const yawOf = (x, z) => Math.atan2(-x, -z);
// the shortest signed turn from angle a to angle b
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}
export const approach = (v, t, k, dt) => v + (t - v) * (1 - Math.exp(-k * dt));
