// Street furniture, wrecks and clutter for The Ruins (step 5b). Each prop is a few boxes through the Kit: plain data,
// like the rest of the city. Small parts are K.DETAIL (drawn only near you, build.js). What you could hide behind
// collides; small clutter does not (you would only snag on it).
// `yaw` is the way a prop faces, as a box's ry: its local z (its length, its front) points along (sin yaw, cos yaw).
import { K, COL } from './kit.js';

const DET = K.DETAIL;
// the point (lx across, lz along) from (x, z), for something facing yaw
export const loc = (x, z, yaw, lx, lz) => ({ x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw) });
// the box round a w (across) x d (along) footprint at (x, z) turned by yaw
export function footprint(x, z, w, d, yaw) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)), hx = c * w / 2 + s * d / 2, hz = s * w / 2 + c * d / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}

export const PC = {
  pole: 0x4a4d52, dark: 0x2b2a28, lit: 0xffc777, wood: 0x5d4c3c, wire: 0x26241f, tyre: 0x1e1c1a, glass: 0x262a2e,
  car: [...COL.car, 0x9a3b2e, 0x2f4f6a, 0xb8a27a, 0x5f6b4a, 0xd0cbbf, 0x8a8f94], taxi: 0xc9a227, police: 0xd5d2ca,
  burnt: [0x2e2a27, 0x3a302a, 0x463a30, 0x352d29], bus: [0xb8742f, 0x4f6a4a, 0xc9c4b8, 0x8a3b2b, 0x3f5f7a],
  truck: [0xc9c4b8, 0x6e7177, 0x8a3b2b, 0x3e5a6e, 0xa0742c], army: 0x56603f, canvas: 0x8b7d5a,
  bin: [0x3c4a3a, 0x4f5a5e, 0x6a4a35], dumpster: [0x3e5a4a, 0x4f5e3c, 0x6a4a35, 0x3f4f6a], cone: 0xd9682b, red: 0xa8352b,
  cloth: [0xd9d0bd, 0x3f6a8a, 0xa8352b, 0xc49a62, 0x6a4a7a, 0x4f6a3c, 0xe0c060, 0xb85a3a, 0xece4d2],
  bush: [0x6f6942, 0x7d7448, 0x5e5a3c, 0x8a7a4a], tree: 0x5a4d40, concrete: 0xa8a092, sheet: [0x7b4630, 0x6e7177, 0x8a5536, 0x5b6a72, 0x9a8f80],
  goods: [0x7d6a55, 0x8a7a5a, 0xa8946c, 0x9a4a32, 0x6f6942, 0xb08a3a],
};

// ---------- vehicles ----------
export const CAR = {
  sedan:  { len: 4.4, w: 1.8, h: 0.78, cab: 2.2, ch: 0.58, co: -0.2 },
  hatch:  { len: 3.9, w: 1.75, h: 0.78, cab: 2.0, ch: 0.62, co: -0.45 },
  pickup: { len: 5.1, w: 1.9, h: 0.85, cab: 1.9, ch: 0.72, co: 0.6 },
  taxi:   { len: 4.5, w: 1.8, h: 0.78, cab: 2.2, ch: 0.58, co: -0.2 },
  police: { len: 4.6, w: 1.85, h: 0.78, cab: 2.2, ch: 0.58, co: -0.2 },
  van:    { len: 5.0, w: 2.0, h: 1.8, cab: 0, ch: 0, co: 0 },
};
const WHEELS = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
// A wrecked car (sedan, hatch, pickup, taxi, police, van): the body and the cabin collide (cover), the wheels are
// detail. Burnt out it sits on its rims; flipped it lies on its roof. Returns where its boot is (for loot).
export function car(kit, x, z, yaw, { kind = 'sedan', burnt = false, flipped = false, c = null, y = 0 } = {}) {
  const S = CAR[kind] || CAR.sedan;
  const col = burnt ? kit.pick(PC.burnt) : c ?? (kind === 'taxi' ? PC.taxi : kind === 'police' ? PC.police : kit.pick(PC.car));
  const glass = burnt ? kit.pick(PC.burnt) : PC.glass;
  if (flipped) {
    const ch = S.cab ? S.ch : 0;
    if (S.cab) { const p = loc(x, z, yaw, 0, S.co); kit.cbox(p.x, y + ch / 2, p.z, S.w * 0.86, ch, S.cab, glass, { ry: yaw }); }
    kit.cbox(x, y + ch + S.h / 2, z, S.w, S.h, S.len, col, { ry: yaw });
    for (const [lx, lz] of WHEELS) {
      const p = loc(x, z, yaw, lx * (S.w / 2 - 0.15), lz * (S.len / 2 - 0.85));
      kit.cbox(p.x, y + ch + S.h + 0.25, p.z, 0.26, 0.5, 0.62, PC.tyre, { ry: yaw, col: false, k: DET });
    }
    return null;
  }
  const base = y + (burnt ? 0.1 : 0.22);
  kit.cbox(x, base + S.h / 2, z, S.w, S.h, S.len, col, { ry: yaw });
  if (S.cab) { const p = loc(x, z, yaw, 0, S.co); kit.cbox(p.x, base + S.h + S.ch / 2, p.z, S.w * 0.86, S.ch, S.cab, glass, { ry: yaw }); }
  else { const p = loc(x, z, yaw, 0, S.len / 2 - 0.85); kit.cbox(p.x, base + S.h * 0.7, p.z, S.w + 0.03, S.h * 0.3, 1.6, glass, { ry: yaw, col: false }); }
  if (!burnt) for (const [lx, lz] of WHEELS) {
    const p = loc(x, z, yaw, lx * (S.w / 2 - 0.12), lz * (S.len / 2 - 0.85));
    kit.cbox(p.x, y + 0.31, p.z, 0.27, 0.62, 0.62, PC.tyre, { ry: yaw, col: false, k: DET });
  }
  if (!burnt && kind === 'taxi') { const p = loc(x, z, yaw, 0, S.co); kit.cbox(p.x, base + S.h + S.ch + 0.09, p.z, 0.6, 0.18, 0.24, 0xe8e2c8, { ry: yaw, col: false, k: DET }); }
  if (!burnt && kind === 'police') {
    const p = loc(x, z, yaw, 0, S.co);
    kit.cbox(p.x, base + S.h + S.ch + 0.06, p.z, 1.0, 0.12, 0.26, 0x2b2c2e, { ry: yaw, col: false, k: DET });
    for (const [lx, cc] of [[-0.35, 0x8a2b23], [0.35, 0x2b3f8a]]) { const q = loc(p.x, p.z, yaw, lx, 0); kit.cbox(q.x, base + S.h + S.ch + 0.14, q.z, 0.28, 0.08, 0.2, cc, { ry: yaw, col: false, k: DET }); }
  }
  return loc(x, z, yaw, 0, -S.len / 2 - 0.15);
}
// a city bus, 11.6 m: the body collides; a dark band of windows; burnt out it sits low. y: what it stands on
export function bus(kit, x, z, yaw, { burnt = false, y = 0 } = {}) {
  const len = 11.6, w = 2.5, h = 2.75, base = y + (burnt ? 0.12 : 0.35), dark = burnt ? 0x1d1a18 : PC.glass;
  kit.cbox(x, base + h / 2, z, w, h, len, burnt ? kit.pick(PC.burnt) : kit.pick(PC.bus), { ry: yaw });
  kit.cbox(x, base + h * 0.68, z, w + 0.04, 0.85, len - 1.4, dark, { ry: yaw, col: false });
  const f = loc(x, z, yaw, 0, len / 2 - 0.02);
  kit.cbox(f.x, base + h * 0.62, f.z, w - 0.3, 1.1, 0.06, dark, { ry: yaw, col: false });
  if (!burnt) for (const lz of [len / 2 - 2.2, -len / 2 + 2.4]) for (const lx of [-1, 1]) {
    const p = loc(x, z, yaw, lx * (w / 2 - 0.1), lz);
    kit.cbox(p.x, y + 0.5, p.z, 0.3, 1.0, 1.0, PC.tyre, { ry: yaw, col: false, k: DET });
  }
}
// a lorry, about 8.2 m: cab and load collide. cargo: box | container; military: olive with a canvas back
export function truck(kit, x, z, yaw, { burnt = false, military = false, cargo = 'box', y = 0 } = {}) {
  const col = burnt ? kit.pick(PC.burnt) : military ? PC.army : kit.pick(PC.truck), dark = burnt ? 0x1d1a18 : PC.glass;
  const cab = loc(x, z, yaw, 0, 3.0), ws = loc(x, z, yaw, 0, 4.06), back = loc(x, z, yaw, 0, -1.2);
  kit.cbox(cab.x, y + 1.7, cab.z, 2.4, 2.3, 2.1, col, { ry: yaw });
  kit.cbox(ws.x, y + 2.25, ws.z, 2.1, 0.75, 0.06, dark, { ry: yaw, col: false });
  kit.cbox(x, y + 0.75, z, 2.0, 0.4, 7.8, PC.dark, { ry: yaw, col: false, k: DET });
  if (military) kit.cbox(back.x, y + 2.0, back.z, 2.45, 2.0, 5.2, burnt ? kit.pick(PC.burnt) : PC.canvas, { ry: yaw });
  else if (cargo === 'container') kit.cbox(back.x, y + 2.3, back.z, 2.44, 2.6, 6.1, kit.pick(COL.container), { ry: yaw });
  else kit.cbox(back.x, y + 2.35, back.z, 2.5, 2.7, 5.8, burnt ? kit.pick(PC.burnt) : kit.pick(PC.truck), { ry: yaw });
  if (!burnt) for (const lz of [3.0, -0.6, -2.6]) for (const lx of [-1, 1]) {
    const p = loc(x, z, yaw, lx * 1.05, lz);
    kit.cbox(p.x, y + 0.5, p.z, 0.32, 1.0, 1.0, PC.tyre, { ry: yaw, col: false, k: DET });
  }
}
// a burnt-out armoured vehicle: hull and turret collide
export function apc(kit, x, z, yaw, { burnt = true, y = 0 } = {}) {
  const col = burnt ? 0x3b3631 : 0x6b6a4e, t = loc(x, z, yaw, 0, -0.4), g = loc(x, z, yaw, 0, 2.3);
  kit.cbox(x, y + 1.25, z, 2.9, 1.6, 6.4, col, { ry: yaw });
  kit.cbox(t.x, y + 2.42, t.z, 1.9, 0.75, 2.2, col, { ry: yaw });
  kit.cbox(g.x, y + 2.5, g.z, 0.14, 0.14, 3.2, PC.dark, { ry: yaw + 0.08, col: false });
  for (const lx of [-1, 1]) { const p = loc(x, z, yaw, lx * 1.55, 0); kit.cbox(p.x, y + 0.45, p.z, 0.5, 0.9, 6.6, PC.tyre, { ry: yaw, col: false }); }
}

// ---------- on the pavement ----------
// a street light at the kerb, its arm reaching out over the street (yaw). state: ok | lit | bent | fallen | stump
export function lamp(kit, x, z, yaw, state = 'ok') {
  const H = 6.2;
  if (state === 'stump') { kit.box(x, 0, z, 0.18, kit.range(0.5, 1.6), 0.18, PC.pole); return; }
  if (state === 'fallen') {
    const a = yaw + kit.range(-0.7, 0.7), p = loc(x, z, a, 0, H / 2 + 0.2);
    kit.cbox(p.x, 0.08, p.z, 0.16, 0.16, H, PC.pole, { ry: a });
    kit.box(x, 0, z, 0.26, 0.4, 0.26, PC.pole);
    return;
  }
  const lean = state === 'bent' ? kit.range(0.12, 0.35) : kit.range(0, 0.03), la = yaw + kit.range(-1.2, 1.2);
  const tx = x + Math.sin(la) * Math.sin(lean) * H, tz = z + Math.cos(la) * Math.sin(lean) * H, ty = Math.cos(lean) * H;
  kit.cbox((x + tx) / 2, ty / 2, (z + tz) / 2, 0.16, H, 0.16, PC.pole, { rx: lean, ry: la });
  const arm = loc(tx, tz, yaw, 0, 0.8), head = loc(tx, tz, yaw, 0, 1.55), lit = state === 'lit';
  kit.cbox(arm.x, ty - 0.05, arm.z, 0.08, 0.08, 1.6, PC.pole, { ry: yaw, col: false, k: DET });
  kit.cbox(head.x, ty - 0.17, head.z, 0.32, 0.14, 0.6, lit ? PC.lit : PC.dark, { ry: yaw, col: false, k: lit ? K.GLOW : DET });
}
// traffic lights on a corner: a pole and a mast arm over the street (yaw); now and then one still shows red
export function trafficLight(kit, x, z, yaw, reach, state = 'ok') {
  if (state === 'fallen') {
    const a = yaw + kit.range(-0.8, 0.8), p = loc(x, z, a, 0, 2.9), s = loc(x, z, a, 0.5, 5.3);
    kit.cbox(p.x, 0.1, p.z, 0.2, 0.2, 5.6, PC.pole, { ry: a });
    kit.cbox(s.x, 0.2, s.z, 0.38, 0.4, 1.05, 0x2b2c2e, { ry: a + 0.3, col: false, k: DET });
    return;
  }
  const m = loc(x, z, yaw, 0, reach / 2), e = loc(x, z, yaw, 0, reach - 0.25), red = kit.R() < 0.2;
  kit.box(x, 0, z, 0.2, 5.8, 0.2, PC.pole);
  kit.cbox(m.x, 5.65, m.z, 0.12, 0.12, reach, PC.pole, { ry: yaw, col: false, k: DET });
  kit.cbox(e.x, 5.0, e.z, 0.38, 1.05, 0.32, 0x2b2c2e, { ry: yaw, col: false });
  for (let i = 0; i < 3; i++) {
    const f = loc(e.x, e.z, yaw, 0.2, 0), lit = red && i === 0;
    kit.cbox(f.x, 5.33 - i * 0.32, f.z, 0.03, 0.2, 0.2, lit ? COL.red : 0x3a3b3d, { ry: yaw, col: false, k: lit ? K.GLOW : DET });
  }
}
// a road sign on a post: stop (red), warn (a yellow diamond), round (blue), name (a green street name, higher up)
export function sign(kit, x, z, yaw, kind = 'stop') {
  const lean = kit.R() < 0.2 ? kit.range(0.2, 0.8) : 0, la = kit.R() * Math.PI * 2, H = kind === 'name' ? 2.9 : 2.4;
  const tx = x + Math.sin(la) * Math.sin(lean) * H, tz = z + Math.cos(la) * Math.sin(lean) * H, ty = Math.cos(lean) * H;
  kit.cbox((x + tx) / 2, ty / 2, (z + tz) / 2, 0.07, H, 0.07, PC.pole, { rx: lean, ry: la, col: false, k: DET });
  const [w, h, c, rz] = kind === 'stop' ? [0.72, 0.72, PC.red, 0] : kind === 'warn' ? [0.6, 0.6, 0xc9a227, Math.PI / 4]
    : kind === 'round' ? [0.62, 0.62, 0x2f5a8a, 0] : [1.3, 0.3, 0x2f5a3c, 0];
  kit.cbox(tx, ty - h / 2 - 0.05, tz, w, h, 0.04, c, { ry: yaw, rz, col: false, k: DET });
}
export function hydrant(kit, x, z) {
  kit.box(x, 0, z, 0.26, 0.62, 0.26, PC.red, { col: false, k: DET });
  kit.box(x, 0.62, z, 0.32, 0.08, 0.32, 0x7a2a22, { col: false, k: DET });
}
export function bin(kit, x, z, yaw, tipped = false) {
  const c = kit.pick(PC.bin);
  if (tipped) kit.cbox(x, 0.28, z, 0.55, 0.55, 0.95, c, { ry: yaw, col: false, k: DET });
  else kit.box(x, 0, z, 0.55, 0.95, 0.55, c, { ry: yaw, col: false, k: DET });
}
// a bench facing yaw: the seat collides
export function bench(kit, x, z, yaw) {
  const b = loc(x, z, yaw, 0, -0.22);
  kit.cbox(x, 0.45, z, 1.8, 0.08, 0.45, 0x6e5a44, { ry: yaw });
  kit.cbox(b.x, 0.75, b.z, 1.8, 0.4, 0.05, 0x6e5a44, { ry: yaw, rx: -0.15, col: false, k: DET });
  for (const lx of [-0.75, 0.75]) { const p = loc(x, z, yaw, lx, 0); kit.cbox(p.x, 0.205, p.z, 0.08, 0.41, 0.42, PC.pole, { ry: yaw, col: false, k: DET }); }
}
// a concrete planter: dry sticks, or the stump of a palm
export function planter(kit, x, z, kind = 'shrub') {
  kit.box(x, 0, z, 1.3, 0.55, 1.3, PC.concrete, { top: 0x5e4e3c });
  if (kind === 'palm') kit.box(x, 0.55, z, 0.3, kit.range(0.8, 2.2), 0.3, COL.palm, { col: false });
  else for (let i = 0; i < 4; i++) kit.cbox(x + kit.range(-0.3, 0.3), 0.9, z + kit.range(-0.3, 0.3), 0.05, 0.75, 0.05, 0x6b5a46, { rx: kit.range(-0.5, 0.5), rz: kit.range(-0.5, 0.5), col: false, k: DET });
}
// a dead tree: the trunk collides, the bare branches are detail and reach mostly towards `away` (off a wall)
export function deadTree(kit, x, z, h, away = null) {
  const lean = kit.range(0, 0.08), la = kit.R() * Math.PI * 2;
  const tx = x + Math.sin(la) * Math.sin(lean) * h, tz = z + Math.cos(la) * Math.sin(lean) * h;
  kit.cbox((x + tx) / 2, h / 2, (z + tz) / 2, 0.26, h, 0.26, PC.tree, { rx: lean, ry: la });
  for (let i = 0, n = 3 + Math.floor(kit.R() * 3); i < n; i++) {
    const f = kit.range(0.5, 0.95), sx = x + (tx - x) * f, sz = z + (tz - z) * f, sy = h * f;
    const a = away === null ? kit.R() * Math.PI * 2 : away + kit.range(-1.5, 1.5), e = kit.range(0.4, 1.0), l = kit.range(0.9, 2.1), t = kit.range(0.06, 0.12);
    kit.cbox(sx + Math.sin(a) * Math.cos(e) * l / 2, sy + Math.sin(e) * l / 2, sz + Math.cos(a) * Math.cos(e) * l / 2, t, t, l, PC.tree, { ry: a, rx: -e, col: false, k: DET });
  }
}
export function bush(kit, x, z, s = 1) {
  for (let i = 0, n = 2 + Math.floor(kit.R() * 2); i < n; i++) {
    const w = kit.range(0.6, 1.3) * s, h = kit.range(0.4, 0.9) * s;
    kit.cbox(x + kit.range(-0.4, 0.4) * s, h / 2, z + kit.range(-0.4, 0.4) * s, w, h, w * kit.range(0.7, 1.1), kit.pick(PC.bush), { ry: kit.R() * Math.PI, col: false });
  }
}
// a bus stop facing the street (yaw): the back panel collides
export function busStop(kit, x, z, yaw) {
  const back = loc(x, z, yaw, 0, -0.6), seat = loc(x, z, yaw, 0, -0.35);
  kit.cbox(back.x, 1.0, back.z, 3.2, 1.6, 0.06, 0x2e3438, { ry: yaw });
  kit.cbox(x, 2.4, z, 3.4, 0.08, 1.5, 0x6e7177, { ry: yaw, col: false });
  for (const lx of [-1.6, 1.6]) { const p = loc(x, z, yaw, lx, -0.6); kit.cbox(p.x, 1.2, p.z, 0.08, 2.4, 0.08, PC.pole, { ry: yaw, col: false, k: DET }); }
  kit.cbox(seat.x, 0.45, seat.z, 2.4, 0.08, 0.4, 0x6e5a44, { ry: yaw, col: false, k: DET });
}
// a newspaper kiosk facing yaw, its shutter down
export function kiosk(kit, x, z, yaw) {
  const f = loc(x, z, yaw, 0, 0.91);
  kit.cbox(x, 1.3, z, 2.4, 2.6, 1.8, kit.pick(COL.shop), { ry: yaw });
  kit.cbox(x, 2.68, z, 2.9, 0.12, 2.3, 0x5f5a50, { ry: yaw, col: false });
  kit.cbox(f.x, 1.4, f.z, 2.0, 1.0, 0.04, kit.pick(COL.metal), { ry: yaw, col: false, k: DET });
}
export function phoneBooth(kit, x, z, yaw) {
  kit.cbox(x, 1.15, z, 0.9, 2.3, 0.9, kit.R() < 0.5 ? 0x8a2b23 : 0x2f4f6a, { ry: yaw });
  kit.cbox(x, 1.3, z, 0.92, 1.1, 0.92, PC.glass, { ry: yaw, col: false });
}
export function bollards(kit, x, z, yaw, n = 3) {
  for (let i = 0; i < n; i++) { const p = loc(x, z, yaw, (i - (n - 1) / 2) * 1.2, 0); kit.box(p.x, 0, p.z, 0.18, 0.9, 0.18, PC.concrete, { col: false, k: DET }); }
}
// a wooden power pole (the crossbar across the line, which runs along yaw)
export function powerPole(kit, x, z, yaw, lean = 0) {
  if (lean) { const la = yaw + Math.PI / 2; kit.cbox(x + Math.sin(la) * Math.sin(lean) * 4.1, 4.1 * Math.cos(lean), z + Math.cos(la) * Math.sin(lean) * 4.1, 0.26, 8.2, 0.26, PC.wood, { rx: lean, ry: la }); return; }
  kit.box(x, 0, z, 0.26, 8.2, 0.26, PC.wood);
  kit.cbox(x, 7.7, z, 1.9, 0.12, 0.12, PC.wood, { ry: yaw, col: false, k: DET });
}
// a wire between two points, sagging in the middle (two straight pieces)
export function wire(kit, a, b, sag = 0.5) {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - sag, z: (a.z + b.z) / 2 };
  for (const [p, q] of [[a, m], [m, b]]) {
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, hl = Math.hypot(dx, dz), l = Math.hypot(hl, dy);
    if (l < 0.1) continue;
    kit.cbox((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2, 0.035, 0.035, l, PC.wire, { ry: Math.atan2(dx, dz), rx: -Math.atan2(dy, hl), col: false, k: DET });
  }
}
// a washing line between two walls, with washing on it
export function laundry(kit, a, b) {
  wire(kit, a, b, 0.25);
  const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.floor(len / 1.1), yaw = Math.atan2(b.x - a.x, b.z - a.z);
  for (let i = 1; i < n; i++) {
    if (kit.R() < 0.3) continue;
    const t = i / n, y = a.y + (b.y - a.y) * t - 0.25 * (1 - Math.abs(2 * t - 1)), h = kit.range(0.5, 0.95);
    kit.cbox(a.x + (b.x - a.x) * t, y - h / 2, a.z + (b.z - a.z) * t, 0.02, h, kit.range(0.4, 0.8), kit.pick(PC.cloth), { ry: yaw, col: false, k: DET });
  }
}

// ---------- barricades ----------
// a concrete barrier, 3 m long across yaw's line: collides
export function jersey(kit, x, z, yaw, y = 0) {
  kit.cbox(x, y + 0.2, z, 0.62, 0.4, 3.0, COL.barrier, { ry: yaw });
  kit.cbox(x, y + 0.62, z, 0.3, 0.45, 3.0, COL.barrier, { ry: yaw });
}
// a steel tank trap; you bump into the space it fills
export function hedgehog(kit, x, z) {
  const a = kit.R() * Math.PI;
  for (let i = 0; i < 3; i++) kit.cbox(x, 0.62, z, 0.16, 0.16, 2.0, 0x4d4a45, { ry: a + i * Math.PI * 2 / 3, rx: 0.62, col: false });
  kit.box(x, 0, z, 1.1, 1.1, 1.1, 0).hide = true;
}
// sandbags in a row along yaw's cross line (one 0.9 m row, or several layers of 0.44 m)
export function sandbags(kit, x, z, yaw, n = 5, rows = 1, y = 0) {
  const h = rows === 1 ? 0.9 : 0.44;
  for (let r = 0; r < rows; r++) for (let k = 0; k < n - (r % 2); k++) {
    const p = loc(x, z, yaw, (k - (n - 1) / 2) * 1.1 + (r % 2) * 0.55, 0);
    kit.cbox(p.x, y + h / 2 + r * h, p.z, 1.1, h, 0.6, COL.sandbag, { ry: yaw + kit.range(-0.08, 0.08) });
  }
}
// a coil of razor wire along yaw
export function razor(kit, x, z, yaw, len) { kit.cbox(x, 0.3, z, 0.55, 0.55, len, 0x3a3835, { ry: yaw, col: false, k: DET }); }
export function booth(kit, x, z, yaw, y = 0) {
  kit.cbox(x, y + 1.2, z, 1.8, 2.4, 1.8, 0x7a7563, { ry: yaw });
  kit.cbox(x, y + 1.65, z, 1.84, 0.6, 1.84, PC.glass, { ry: yaw, col: false });
  kit.cbox(x, y + 2.48, z, 2.2, 0.16, 2.2, 0x5f5a50, { ry: yaw, col: false });
}
// a floodlight mast (one lamp still burning)
export function floodlight(kit, x, z, yaw) {
  const h = loc(x, z, yaw, 0, 0.3);
  kit.box(x, 0, z, 0.22, 7.5, 0.22, PC.pole);
  kit.cbox(h.x, 7.3, h.z, 1.4, 0.5, 0.3, 0x2b2c2e, { ry: yaw, col: false });
  kit.cbox(h.x, 7.3, h.z, 1.2, 0.36, 0.32, PC.lit, { ry: yaw, col: false, k: K.GLOW });
}
// corrugated sheets along a line from a to b (building-site hoarding); some sheets are missing
export function hoarding(kit, a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 2.4)), yaw = Math.atan2(b.x - a.x, b.z - a.z);
  for (let i = 0; i < n; i++) {
    if (kit.R() < 0.12) continue;
    const t = (i + 0.5) / n;
    kit.cbox(a.x + (b.x - a.x) * t, 1.05, a.z + (b.z - a.z) * t, 0.06, 2.1, len / n - 0.04, kit.pick(PC.sheet), { ry: yaw, rz: kit.range(-0.05, 0.05) });
  }
}

// ---------- junk ----------
export function barrel(kit, x, z, { c = null, tipped = false } = {}) {
  const col = c ?? kit.pick([...COL.rust, 0x3f5a7a, 0x8a7a3a, 0x5a6a4a]);
  if (tipped) {
    const a = kit.R() * Math.PI;
    kit.cbox(x, 0.29, z, 0.58, 0.58, 0.88, col, { ry: a, col: false, k: DET });
    kit.cbox(x, 0.29, z, 0.58, 0.58, 0.88, col, { ry: a, rz: Math.PI / 4, col: false, k: DET });
    return;
  }
  kit.box(x, 0, z, 0.58, 0.88, 0.58, col, { k: DET });
  kit.box(x, 0, z, 0.58, 0.88, 0.58, col, { ry: Math.PI / 4, col: false, k: DET });
}
export function tyres(kit, x, z, n = 1) {
  for (let i = 0; i < n; i++) {
    const a = kit.R() * Math.PI, ox = kit.range(-0.08, 0.08), oz = kit.range(-0.08, 0.08);
    kit.cbox(x + ox, 0.11 + i * 0.23, z + oz, 0.68, 0.22, 0.68, PC.tyre, { ry: a, col: false, k: DET });
    kit.cbox(x + ox, 0.11 + i * 0.23, z + oz, 0.68, 0.22, 0.68, PC.tyre, { ry: a + Math.PI / 4, col: false, k: DET });
  }
}
export function cone(kit, x, z) {
  kit.box(x, 0, z, 0.38, 0.04, 0.38, PC.cone, { col: false, k: DET });
  kit.box(x, 0.04, z, 0.24, 0.55, 0.24, PC.cone, { col: false, k: DET });
}
export function pallets(kit, x, z, yaw, n = 1) {
  for (let i = 0; i < n; i++) kit.cbox(x, 0.07 + i * 0.15, z, 1.2, 0.14, 1.0, 0x7d6a55, { ry: yaw + kit.range(-0.1, 0.1), col: false, k: DET });
  if (n >= 3) kit.box(x, 0, z, 1.2, n * 0.15, 1.0, 0, { ry: yaw }).hide = true;      // a stack you bump into
}
export function dumpster(kit, x, z, yaw) {
  const c = kit.pick(PC.dumpster), lid = loc(x, z, yaw, 0, -0.35);
  kit.cbox(x, 0.65, z, 1.9, 1.3, 1.15, c, { ry: yaw });
  kit.cbox(lid.x, 1.42, lid.z, 1.95, 0.06, 0.7, c, { ry: yaw, rx: kit.range(-0.6, 0.1), col: false, k: DET });
}
// wooden crates stacked (they collide)
export function crates(kit, x, z, yaw, n = 2) {
  for (let i = 0; i < n; i++) {
    const s = kit.range(0.8, 1.1), p = loc(x, z, yaw, (i % 2) * 1.05 - 0.5, 0);
    kit.cbox(p.x, s / 2 + (i >= 2 ? 1.0 : 0), p.z, s, s, s, kit.pick([0x7d6a55, 0x6b5a46, 0x8a7a5a]), { ry: yaw + kit.range(-0.15, 0.15), k: DET });
  }
}
// a cable drum on its side
export function reel(kit, x, z, yaw) {
  for (const a of [0, Math.PI / 4]) kit.cbox(x, 0.6, z, 0.8, 1.2, 1.2, 0x6b5a46, { ry: yaw, rx: a, col: a === 0, k: DET });
}
export function forklift(kit, x, z, yaw) {
  const cab = loc(x, z, yaw, 0, -0.3), mast = loc(x, z, yaw, 0, 1.1), fork = loc(x, z, yaw, 0, 1.7);
  kit.cbox(x, 0.75, z, 1.2, 1.1, 2.0, 0xc9a227, { ry: yaw });
  kit.cbox(cab.x, 1.75, cab.z, 1.1, 0.9, 1.1, PC.dark, { ry: yaw, col: false, k: DET });
  kit.cbox(mast.x, 1.4, mast.z, 0.9, 2.6, 0.12, PC.dark, { ry: yaw, col: false });
  kit.cbox(fork.x, 0.1, fork.z, 0.8, 0.06, 1.0, PC.dark, { ry: yaw, col: false, k: DET });
}
// a hand cart in the market
export function cart(kit, x, z, yaw) {
  const h = loc(x, z, yaw, 0, -1.2);
  kit.cbox(x, 0.7, z, 1.0, 0.35, 1.6, 0x6e5a44, { ry: yaw, rx: 0.1 });
  for (const lx of [-0.55, 0.55]) { const p = loc(x, z, yaw, lx, 0.2); kit.cbox(p.x, 0.4, p.z, 0.06, 0.8, 0.8, PC.dark, { ry: yaw, col: false, k: DET }); }
  kit.cbox(h.x, 0.75, h.z, 0.8, 0.05, 0.9, PC.wood, { ry: yaw, col: false, k: DET });
}
// sacks and baskets of something long gone bad
export function goods(kit, x, z) {
  for (let i = 0, n = 2 + Math.floor(kit.R() * 3); i < n; i++) {
    const s = kit.range(0.4, 0.7);
    kit.cbox(x + kit.range(-0.7, 0.7), s * 0.4, z + kit.range(-0.7, 0.7), s, s * 0.8, s, kit.pick(PC.goods), { ry: kit.R() * Math.PI, col: false, k: DET });
  }
}
// a canvas stretched over a market lane
export function canopy(kit, x, z, yaw, w, d) {
  kit.cbox(x, kit.range(2.7, 3.2), z, w, 0.04, d, kit.pick(PC.cloth), { ry: yaw, rx: kit.range(-0.08, 0.08), rz: kit.range(-0.08, 0.08), col: false });
}
// little bits on the ground: rubble, trash
export function bits(kit, x, z, r, n, cols = COL.rubble) {
  for (let i = 0; i < n; i++) {
    const s = kit.range(0.12, 0.45);
    kit.cbox(x + kit.range(-r, r), s * 0.3, z + kit.range(-r, r), s, s * 0.6, s * kit.range(0.8, 1.6), kit.pick(cols), { ry: kit.R() * Math.PI, rz: kit.range(-0.3, 0.3), col: false, k: DET });
  }
}
export function trash(kit, x, z, n = 4) { bits(kit, x, z, 0.8, n, [0x2a2c2a, 0x3c3a35, 0x4a4438, 0x6e6a60]); }

// ---------- on buildings ----------
export function acUnit(kit, x, y, z, yaw) { kit.cbox(x, y, z, 0.8, 0.55, 0.45, 0x8d8f91, { ry: yaw, col: false, k: DET }); }
export function dish(kit, x, y, z, yaw) { kit.cbox(x, y, z, 0.7, 0.7, 0.05, 0xd0d0cc, { ry: yaw, rx: -0.4, col: false, k: DET }); }
// a water tank on legs (on flat roofs; it collides if you can get up there)
export function waterTank(kit, x, y, z, col = false) {
  const c = kit.pick([0x2a2c30, 0xd8d6cf, 0x3a5a7a]);
  for (const a of [0, Math.PI / 4]) kit.cbox(x, y + 1.15, z, 1.25, 1.3, 1.25, c, { ry: a, col: col && a === 0 });
  for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) kit.box(x + dx, y, z + dz, 0.08, 0.5, 0.08, PC.pole, { col: false, k: DET });
}
export function solar(kit, x, y, z, yaw) { kit.cbox(x, y + 0.6, z, 1.0, 0.05, 1.7, 0x1f2a3a, { ry: yaw, rx: 0.45, col: false, k: DET }); }
export function antenna(kit, x, y, z) {
  const h = kit.range(2.5, 5);
  kit.box(x, y, z, 0.06, h, 0.06, PC.pole, { col: false, k: DET });
  for (let i = 0; i < 3; i++) kit.cbox(x, y + h - 0.3 - i * 0.45, z, 1.0 - i * 0.2, 0.03, 0.03, PC.pole, { ry: kit.R() * Math.PI, col: false, k: DET });
}
