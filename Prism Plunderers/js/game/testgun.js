// The test gun: a stand-in carbine so the Prism can be fought in the test range before part 3 (weapons and
// items) exists. Hold fire (left mouse); aim (right mouse) tightens the spread. Infinite ammo, no reload.
// The shot goes from the camera through the crosshair to find what you aim at, then from the gun to that point
// (so a wall next to you still blocks it). Hits go through damageRobot. Gunshots are heard by nearby robots.
import { GUN } from './stats.js';
import { damageRobot } from './prism/robot.js';
import { fwdX, fwdZ } from './move-math.js';
import { G } from '../core/physics.js';
import { bus } from '../core/events.js';

// the gun's muzzle: in the raider's right hand, roughly
export function muzzleOf(p) {
  const fx = fwdX(p.facing), fz = fwdZ(p.facing), rx = -fz, rz = fx;
  return { x: p.pos.x + rx * 0.24 + fx * 0.5, y: p.pos.y + p.height * 0.73, z: p.pos.z + rz * 0.24 + fz * 0.5 };
}

// one simulation step of the gun. ctx = { phys, director, rnd }
export function stepGun(p, cmd, dt, ctx) {
  p.gunCd = (p.gunCd || 0) - dt;
  if (!p.firing || !cmd.aimD) { p.gunCd = Math.max(0, p.gunCd); return; }
  let n = 0;
  while (p.gunCd <= 0 && n < 3) { p.gunCd += GUN.interval; fire(p, cmd, ctx); n++; }
}

function fire(p, cmd, ctx) {
  const s = Math.tan((p.aiming ? GUN.spreadAim : GUN.spreadHip) * Math.PI / 180);
  let dx = cmd.aimD.x + (ctx.rnd() + ctx.rnd() - 1) * s, dy = cmd.aimD.y + (ctx.rnd() + ctx.rnd() - 1) * s, dz = cmd.aimD.z + (ctx.rnd() + ctx.rnd() - 1) * s;
  const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const d = { x: dx, y: dy, z: dz };
  // start the ray level with the player, so nothing behind them (between them and the camera) is hit
  const o = cmd.aimO, cx = p.pos.x - o.x, cy = p.pos.y + 1.35 - o.y, cz = p.pos.z - o.z;
  const k = Math.max(0, cx * dx + cy * dy + cz * dz);
  const start = { x: o.x + dx * k, y: o.y + dy * k, z: o.z + dz * k };
  let hit = ctx.director.shoot(start, d, GUN.range);
  // from the gun to that point
  const m = muzzleOf(p);
  const tx = hit.point.x - m.x, ty = hit.point.y - m.y, tz = hit.point.z - m.z, tl = Math.hypot(tx, ty, tz);
  if (tl > 0.05) {
    const md = { x: tx / tl, y: ty / tl, z: tz / tl };
    const b = ctx.phys.ray(m, md, Math.max(0, tl - 0.05), G.WORLD);
    if (b) hit = { robot: null, part: null, wall: true, point: { x: m.x + md.x * b.t, y: m.y + md.y * b.t, z: m.z + md.z * b.t } };
  }
  let res = null;
  if (hit.robot) res = damageRobot(hit.robot, hit.part, GUN.damage, ctx.director.ctx, { id: p.id, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } });
  ctx.director.hear(p.pos, 32, 0.35);
  bus.emit('gun:shot', p, m, hit.point, res, hit.wall);
}
