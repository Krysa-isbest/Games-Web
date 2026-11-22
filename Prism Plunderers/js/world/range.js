// The test range course. North of the spawn (-z): stairs, ramps of 20, 35 and 55 degrees (the last is too
// steep), jump boxes, a crouch tunnel and a gap that needs a sprint jump. West: a 3 m platform (safe to drop)
// and a 7 m tower (fall damage). East: the sentry firing range with cover. South: the shield rack, the repair
// bench and the med station, the gas pit and the slide hill. Ruins all around.
import * as THREE from 'three';
import { SHIELDS } from '../game/stats.js';
import { Interactions } from '../game/interact.js';
import { equipShield, restoreShield, heal, shieldFull, applyDamage } from '../game/damage.js';
import { Sentries } from '../game/sentry.js';
import { makeBox, restock } from '../game/inventory.js';
import { disposeTree } from '../core/engine.js';
import { bus } from '../core/events.js';
import { rng } from '../core/util.js';

// what the test range's supply crate fills itself back up to every time you open it
export const CRATE_STOCK = [
  ['shield_medium', 1], ['shield_heavy', 1], ['shield_cell', 5], ['repair_kit', 3], ['medkit', 3], ['stim', 5],
  ['frag_grenade', 3], ['light_ammo', 120], ['pulse_cell', 180], ['scrap_pistol', 1], ['pulse_carbine', 1],
];

const BOX = new THREE.BoxGeometry(1, 1, 1);

export function buildRange(scene, phys, glowTex) {
  const group = new THREE.Group();
  scene.add(group);
  const M = (color, rough = 0.92, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  const mat = {
    ground: M(0x6f6458, 1), conc: M(0x9a958c), concD: M(0x7a756d), concL: M(0xb0aa9f),
    hazard: M(0xe2b42a, 0.7), metal: M(0x50555d, 0.55, { metalness: 0.4 }), wood: M(0x7a5a3a),
    red: new THREE.MeshBasicMaterial({ color: 0xd8463c, transparent: true, opacity: 0.16, depthWrite: false }),
    line: new THREE.MeshBasicMaterial({ color: 0xf2efe8, transparent: true, opacity: 0.55, depthWrite: false }),
    gas: new THREE.MeshBasicMaterial({ color: 0x8a4dff, transparent: true, opacity: 0.22, depthWrite: false }),
    shieldL: M(0x9fdcff, 0.4, { emissive: 0x2a6f99, emissiveIntensity: 0.4 }),
    shieldM: M(0x5cb8ff, 0.4, { emissive: 0x1d5a99, emissiveIntensity: 0.4 }),
    shieldH: M(0x2f7fff, 0.4, { emissive: 0x123f99, emissiveIntensity: 0.4 }),
    green: M(0x3ccf7a, 0.5, { emissive: 0x1d7a45, emissiveIntensity: 0.5 }),
    arena: new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0.06, depthWrite: false }),
    arenaLine: new THREE.MeshBasicMaterial({ color: 0xb98aff, transparent: true, opacity: 0.4, depthWrite: false }),
    nest: new THREE.MeshBasicMaterial({ color: 0x0c0a10, transparent: true, opacity: 0.6, depthWrite: false }),
    button: M(0xb98aff, 0.4, { emissive: 0x7a3cff, emissiveIntensity: 0.7 }),
    buttonRed: M(0xff6a5a, 0.4, { emissive: 0xc0281a, emissiveIntensity: 0.6 }),
  };
  const q = new THREE.Quaternion(), eu = new THREE.Euler();

  // a box you can stand on (mesh + collider). x, y, z = its centre.
  function solid(x, y, z, w, h, d, m = mat.conc, rx = 0, ry = 0) {
    const mesh = new THREE.Mesh(BOX, m);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.set(rx, ry, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    phys.box({ x, y, z }, { x: w, y: h, z: d }, rx || ry ? q.setFromEuler(eu.set(rx, ry, 0)) : null);
    return mesh;
  }
  // a box only to look at
  function deco(x, y, z, w, h, d, m, rx = 0, ry = 0) {
    const mesh = new THREE.Mesh(BOX, m);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.set(rx, ry, 0);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  // a flat painted mark on the ground
  function paint(x, z, w, d, m, y = 0.012) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2; p.position.set(x, y, z);
    group.add(p);
    return p;
  }
  // hazard stripes along the top edges of a platform
  function edges(x, top, z, w, d) {
    deco(x, top + 0.01, z - d / 2 + 0.06, w, 0.03, 0.12, mat.hazard);
    deco(x, top + 0.01, z + d / 2 - 0.06, w, 0.03, 0.12, mat.hazard);
    deco(x - w / 2 + 0.06, top + 0.01, z, 0.12, 0.03, d, mat.hazard);
    deco(x + w / 2 - 0.06, top + 0.01, z, 0.12, 0.03, d, mat.hazard);
  }
  function platform(x, z, w, d, h, m = mat.conc) { solid(x, h / 2, z, w, h, d, m); edges(x, h, z, w, d); }
  // steps rising along z (dir -1 = towards the north). Returns the top height and where the steps end.
  function stairs(x, z0, w, n, rise, run, dir = -1) {
    for (let i = 0; i < n; i++) {
      const top = rise * (i + 1);
      solid(x, top / 2, z0 + dir * run * (i + 0.5), w, top, run, i % 2 ? mat.conc : mat.concL);
    }
    return { top: rise * n, end: z0 + dir * run * n };
  }
  // A ramp whose surface runs from (z0, ground) to (z0 + dir * L, H). The low end sinks a little into the
  // ground so there is no lip to trip on; the high end stops exactly at the top edge.
  function ramp(x, z0, L, H, w, dir = -1, m = mat.concD) {
    const a = Math.atan2(H, L), e = 0.3, t = 0.4;
    const bz = z0 - dir * e * Math.cos(a), by = -e * Math.sin(a);          // the sunken low end
    const tz = z0 + dir * L, ty = H;                                      // the top edge
    const midZ = (bz + tz) / 2, midY = (by + ty) / 2;
    solid(x, midY - Math.cos(a) * t / 2, midZ + dir * Math.sin(a) * t / 2, w, t, Math.hypot(H, L) + e, m, dir < 0 ? a : -a);
  }
  // a sign on a post, drawn on a canvas (skipped where there is no canvas, like the offline tests)
  function sign(title, sub, x, z, yaw = 0, h = 1.9) {
    const c = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
    if (!c || !c.getContext) return;
    c.width = 512; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(14,16,21,0.92)'; g.fillRect(0, 0, 512, 200);
    g.fillStyle = '#ffb224'; g.fillRect(0, 0, 12, 200);
    g.fillStyle = '#ffffff'; g.font = '700 64px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textBaseline = 'top';
    g.fillText(title.toUpperCase(), 34, 22);
    g.fillStyle = '#b9bfc8'; g.font = '500 34px Barlow, Arial, sans-serif';
    sub.split('\n').forEach((line, i) => g.fillText(line, 34, 104 + i * 42));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.86), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    board.position.set(x, h, z); board.rotation.y = yaw;
    group.add(board);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h - 0.4, 6), mat.metal);
    post.position.set(x, (h - 0.4) / 2, z);
    group.add(post);
  }

  // ---------- ground and edges of the world ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mat.ground);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);
  phys.box({ x: 0, y: -0.5, z: 0 }, { x: 700, y: 1, z: 700 });
  const grid = new THREE.GridHelper(700, 175, 0x3d3530, 0x52483f);
  grid.position.y = 0.006; grid.material.transparent = true; grid.material.opacity = 0.32;
  group.add(grid);
  for (const [x, z, w, d] of [[0, -165, 340, 2], [0, 165, 340, 2], [-165, 0, 2, 340], [165, 0, 2, 340]]) phys.box({ x, y: 10, z }, { x: w, y: 20, z: d });

  // ---------- spawn ----------
  const spawn = { x: 0, y: 0.05, z: 8, yaw: 0 };
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.3, 40), mat.line);
  ring.rotation.x = -Math.PI / 2; ring.position.set(spawn.x, 0.013, spawn.z);
  group.add(ring);
  paint(2.5, -3.8, 36, 0.18, mat.line);                                   // the course start line

  // ---------- the movement course (north) ----------
  const A = stairs(-12, -4, 3, 7, 0.25, 0.5);                            // stairs up to 1.75 m
  platform(-12, A.end - 2, 3, 4, A.top);
  sign('Stairs', 'Steps up to 35 cm\nwalk straight up', -14.2, -3, 0);
  const rampAt = (x, deg, label) => {
    const H = 2, L = H / Math.tan(deg * Math.PI / 180);
    ramp(x, -4, L, H, 3);
    platform(x, -4 - L - 1.5, 3, 3, H);
    sign(`${deg}° ramp`, label, x - 2.2, -3, 0);
  };
  rampAt(-6.5, 20, 'Easy climb');
  rampAt(-1, 35, 'Still walkable');
  rampAt(4.5, 55, 'Too steep: you slide\nback down');
  platform(10, -6, 3, 3, 0.6); platform(10, -11, 3, 3, 1.0); platform(10, -16, 3, 3, 1.5);
  sign('Jump boxes', '0.6 m, 1 m and 1.5 m\nthe last is too high', 12.2, -3, 0);
  solid(14.6, 0.9, -8, 0.4, 1.8, 8); solid(17.4, 0.9, -8, 0.4, 1.8, 8);    // the crouch tunnel
  solid(16, 1.55, -8, 3.2, 0.5, 8, mat.concD);
  deco(16, 1.3, -3.98, 3.2, 0.06, 0.06, mat.hazard);
  sign('Crouch tunnel', '1.3 m high\ncrouch or slide through', 18.6, -3, 0);
  ramp(-1, -12, 1 / Math.tan(15 * Math.PI / 180), 1, 3);                   // up to the gap
  platform(-1, -17.73, 3, 4, 1);
  platform(-1, -24.73, 3, 4, 1);
  sign('3 m gap', 'Sprint and jump', 1.4, -15.5, 0, 2.6);

  // ---------- the drops (west) ----------
  ramp(-26, 9.2, 3 / Math.tan(15 * Math.PI / 180), 3, 3);
  platform(-26, -5, 6, 6, 3);
  sign('3 m drop', 'Safe to jump down', -23.4, -8.4, 0, 4.9);
  const T = stairs(-34, 1.76, 2.4, 28, 0.25, 0.42);
  platform(-34, T.end - 2, 4, 4, T.top);
  sign('7 m drop', 'Fall damage:\nabout 190 health', -31.6, -14.3, 0, 8.9);

  // ---------- the sentry range (east) ----------
  const zone = { x0: 24, x1: 46, z0: -26, z1: 6 };
  paint((zone.x0 + zone.x1) / 2, (zone.z0 + zone.z1) / 2, zone.x1 - zone.x0, zone.z1 - zone.z0, mat.red);
  for (const [x, z, w, d] of [[35, zone.z0, 22, 0.25], [35, zone.z1, 22, 0.25], [zone.x0, -10, 0.25, 32], [zone.x1, -10, 0.25, 32]]) paint(x, z, w, d, mat.hazard, 0.014);
  solid(32, 1.1, -16, 0.5, 2.2, 3); solid(35, 1.1, -3, 0.5, 2.2, 3);       // full cover
  solid(28, 0.5, -9, 0.5, 1.0, 3, mat.concD); solid(37, 0.5, -11, 0.5, 1.0, 3, mat.concD); solid(30, 0.5, 2, 0.5, 1.0, 3, mat.concD);   // half cover
  solid(40, 0.6, -6, 1.2, 1.2, 1.2, mat.wood); solid(40.6, 1.8, -6.2, 1.1, 1.1, 1.1, mat.wood, 0, 0.4);
  sign('Sentry range', 'They shoot inside the red zone.\nHide, strafe, or roll through bolts', 22.4, 5, -Math.PI / 2);
  const sentries = new Sentries(scene, phys, [{ x: 44, z: -18, yaw: Math.PI / 2 }, { x: 44, z: -1, yaw: Math.PI / 2 }], zone, glowTex);

  // ---------- the slide hill (south-east) ----------
  const SH = 3.5, SL = SH / Math.tan(15 * Math.PI / 180);
  ramp(22, 34 - SL, SL, SH, 4, 1);
  platform(22, 36, 4, 4, SH);
  stairs(22, 43.88, 3, 14, 0.25, 0.42, -1);
  sign('Slide hill', 'Sprint, then crouch:\nslides go faster downhill', 24.6, 12.6, Math.PI);

  // ---------- stations (south) ----------
  const items = new Interactions();
  // shield rack
  solid(-5, 1.0, 17.2, 2.4, 2.0, 0.3, mat.metal);
  [mat.shieldL, mat.shieldM, mat.shieldH].forEach((m, i) => deco(-5.75 + i * 0.75, 1.15, 16.98, 0.55, 0.75, 0.12, m));
  items.add({
    id: 'rack', pos: { x: -5, y: 1, z: 16.5 }, radius: 2.3, hold: 0,
    label: p => { const n = nextShield(p); return n ? `${p.shield ? 'Swap to' : 'Take'} a ${SHIELDS[n].name.toLowerCase()}` : 'Put the shield back'; },
    use: p => equipShield(p, nextShield(p)),
  });
  // repair bench
  solid(0, 0.45, 17.3, 2.2, 0.9, 1.0, mat.wood);
  deco(-0.5, 0.97, 17.3, 0.5, 0.12, 0.35, mat.metal); deco(0.45, 0.99, 17.2, 0.3, 0.16, 0.3, mat.shieldM);
  items.add({
    id: 'bench', pos: { x: 0, y: 1, z: 16.6 }, radius: 2.3,
    hold: p => p.shield ? SHIELDS[p.shield.type].time : 0,
    label: p => !p.shield || shieldFull(p) ? null : `${SHIELDS[p.shield.type].restore} the shield (${SHIELDS[p.shield.type].item})`,
    use: p => restoreShield(p),
  });
  // med station
  solid(5, 1.0, 17.2, 1.4, 2.0, 0.5, mat.concL);
  deco(5, 1.35, 16.94, 0.5, 0.14, 0.04, mat.green); deco(5, 1.35, 16.94, 0.14, 0.5, 0.04, mat.green);
  items.add({
    id: 'med', pos: { x: 5, y: 1, z: 16.6 }, radius: 2.3, hold: 3,
    label: p => p.health < p.maxHealth - 0.5 ? 'Heal to full' : null,
    use: p => heal(p, p.maxHealth),
  });
  sign('Stations', 'Shields, repairs and healing.\nIn raids these are items.', 9, 15.5, Math.PI);
  // the supply crate, next to the spawn: guns, ammo, shields, heals and grenades, always restocked
  const crate = makeBox('crate', 'Supply crate', [], 16);
  crate.pos = { x: 4.2, y: 0, z: 9.2 }; crate.reach = 3.4;
  crate.revealed = 99;                                   // a supply crate: no searching, everything is in view
  solid(4.2, 0.4, 9.2, 1.5, 0.8, 0.9, mat.metal);
  deco(4.2, 0.82, 9.2, 1.54, 0.05, 0.94, mat.hazard);
  deco(4.2, 0.5, 8.74, 0.5, 0.18, 0.02, mat.green);
  items.add({
    id: 'crate', pos: { x: 4.2, y: 0.9, z: 9.2 }, radius: 2.3, hold: 0,
    label: () => 'Open the supply crate',
    use: p => { restock(crate, CRATE_STOCK); bus.emit('loot:open', p, crate, null); },
  });
  sign('Supply crate', 'Guns, ammo, shields, heals.\nIt restocks itself.', 6.6, 9.6, -Math.PI / 2);

  // ---------- the gas pit (south-west) ----------
  const gas = new GasZone(group, { x: -18, z: 20, r: 4.5, h: 2.6 }, mat.gas, glowTex);
  sign('Gas pit', '20 damage a second.\nShields still help.', -12.6, 20, Math.PI / 2);

  // ---------- the Prism arena (north): cover, a Scatter nest, and the robot console ----------
  const bounds = { x0: -30, x1: 30, z0: -72, z1: -38 };
  paint(0, (bounds.z0 + bounds.z1) / 2, bounds.x1 - bounds.x0, bounds.z1 - bounds.z0, mat.arena);
  for (const [x, z, w, d] of [[0, bounds.z0, 60, 0.2], [0, bounds.z1, 60, 0.2], [bounds.x0, -55, 0.2, 34], [bounds.x1, -55, 0.2, 34]]) paint(x, z, w, d, mat.arenaLine, 0.014);
  solid(-14, 1.25, -48, 7, 2.5, 0.6);                                     // cover
  solid(12, 1.5, -50, 3, 3, 3, mat.concD);
  solid(2, 1.25, -57, 0.6, 2.5, 6);
  solid(-6, 0.5, -62, 5, 1, 0.5, mat.concD);
  solid(18, 2, -62, 1.2, 4, 1.2, mat.concL); solid(-3, 2, -67, 1.2, 4, 1.2, mat.concL);
  solid(22, 1, -44, 4, 2, 2, mat.concD, 0, 0.35);
  solid(-26, 0.75, -45, 2.5, 1.5, 2.5, mat.wood);
  // the Scatter nest: a dark shed with a doorway on its east side
  const nest = { x: -20, z: -62, w: 8, d: 8, h: 3 };
  solid(nest.x, nest.h / 2, nest.z - nest.d / 2, nest.w, nest.h, 0.3);
  solid(nest.x, nest.h / 2, nest.z + nest.d / 2, nest.w, nest.h, 0.3);
  solid(nest.x - nest.w / 2, nest.h / 2, nest.z, 0.3, nest.h, nest.d);
  solid(nest.x + nest.w / 2, nest.h / 2, nest.z - 2.5, 0.3, nest.h, 3);
  solid(nest.x + nest.w / 2, nest.h / 2, nest.z + 2.5, 0.3, nest.h, 3);
  solid(nest.x + nest.w / 2, nest.h - 0.4, nest.z, 0.3, 0.8, 2);
  solid(nest.x, nest.h + 0.15, nest.z, nest.w + 0.3, 0.3, nest.d + 0.3, mat.concD);
  paint(nest.x, nest.z, nest.w - 0.4, nest.d - 0.4, mat.nest, 0.016);
  sign('Scatter nest', 'They sleep until they see you.\nDo not stand still inside', nest.x + nest.w / 2 + 1.6, nest.z + 4.6, Math.PI / 2);
  // the robot console
  const posts = [];
  for (let i = 0; i < 8; i++) {
    const x = -7 + i * 2;
    solid(x, 0.5, -34, 0.6, 1.0, 0.6, mat.metal);
    deco(x, 1.04, -34, 0.44, 0.08, 0.44, i >= 6 ? mat.buttonRed : mat.button);
    posts.push({ x, y: 1.0, z: -34 });
  }
  paint(0, -32.6, 17, 0.12, mat.arenaLine);
  sign('Robot console', 'Walk up to a button, press E.\nThe Prism appear in the arena', 9.6, -33.2, 0);
  sign('Prism arena', 'Fight the robots here', -9.6, -36.5, 0, 2.2);
  const spots = {
    fink: { x: 8, y: 4.5, z: -55 }, fly: { x: -4, y: 3.5, z: -63 }, swatter: { x: 10, y: 5.5, z: -67 }, roach: { x: 3, y: 0.1, z: -69 },
    scatter: [{ x: nest.x - 2, y: 0.1, z: nest.z - 2 }, { x: nest.x + 1, y: 0.1, z: nest.z + 1.6 }, { x: nest.x - 1.6, y: 0.1, z: nest.z + 2.4 }],
  };
  // patrol routes for the robots the console spawns (they fly or walk these until they notice you)
  const routes = {
    fink: [{ x: -20, z: -45 }, { x: 20, z: -45 }, { x: 24, z: -66 }, { x: -2, z: -70 }, { x: -26, z: -56 }],
    fly: [{ x: -12, z: -52 }, { x: 8, z: -46 }, { x: 14, z: -64 }, { x: -10, z: -66 }],
    swatter: [{ x: -16, z: -54 }, { x: 16, z: -54 }, { x: 16, z: -68 }, { x: -16, z: -68 }],
    roach: [{ x: 3, z: -69 }, { x: 16, z: -56 }, { x: -6, z: -54 }],
  };

  // ---------- ruins all around ----------
  {
    const R = rng(2999), COUNT = 240;
    const inst = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), COUNT);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const a = R() * Math.PI * 2, d = 78 + Math.pow(R(), 0.8) * 130;
      s.set(R.range(3, 11), R.chance(0.25) ? R.range(12, 32) : R.range(2, 9), R.range(3, 11));
      p.set(Math.cos(a) * d, s.y / 2 - 0.05, Math.sin(a) * d);
      const tilt = R.chance(0.15);
      eu.set(tilt ? R.range(-0.2, 0.2) : 0, R() * Math.PI, tilt ? R.range(-0.2, 0.2) : 0);
      q.setFromEuler(eu);
      inst.setMatrixAt(i, m4.compose(p, q, s));
      inst.setColorAt(i, col.setHSL(0.07 + R() * 0.04, 0.08 + R() * 0.08, 0.3 + R() * 0.18));
      phys.box(p, s, q);
    }
    inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
  }

  return {
    group, spawn, items, sentries, gas, zone, crate,
    arena: { bounds, nest, posts, spots, routes },
    // the gas pit's hiss, louder as you get close
    hiss: p => 0.05 * Math.max(0, 1 - Math.hypot(p.pos.x - gas.x, p.pos.z - gas.z) / 14),
    step(dt, p) { gas.step(dt, p); sentries.step(dt, p); },
    frame(dt, alpha, p) { sentries.frame(dt, alpha, p); gas.frame(dt); },
    dispose() { sentries.dispose(); scene.remove(group); disposeTree(group); },
  };
}

function nextShield(p) {
  const order = [null, 'light', 'medium', 'heavy'];
  return order[(order.indexOf(p.shield ? p.shield.type : null) + 1) % order.length];
}

// A cloud of gas: inside it you take 2 damage every 0.1 s (Roach gas rockets use the same numbers).
export class GasZone {
  constructor(parent, { x, z, r, h }, floorMat, glowTex) {
    this.x = x; this.z = z; this.r = r; this.h = h; this.acc = 0; this.inside = false;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(r, 40), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(x, 0.015, z);
    parent.add(floor);
    const N = 240, pos = new Float32Array(N * 3);
    this.seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      this.seed[i * 3] = a; this.seed[i * 3 + 1] = d; this.seed[i * 3 + 2] = Math.random();
      pos[i * 3] = x + Math.cos(a) * d; pos[i * 3 + 1] = Math.random() * h; pos[i * 3 + 2] = z + Math.sin(a) * d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9a66ff, size: 1.1, map: glowTex || null, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    parent.add(this.points);
    this.t = 0;
  }
  contains(p) { return Math.hypot(p.pos.x - this.x, p.pos.z - this.z) < this.r && p.pos.y < this.h; }
  step(dt, p) {
    this.inside = !p.dead && this.contains(p);
    if (!this.inside) { this.acc = 0; return; }
    this.acc += dt;
    while (this.acc >= 0.1) { this.acc -= 0.1; applyDamage(p, { amount: 2, type: 'gas', source: 'Gas', from: null }); }
  }
  frame(dt) {
    this.t += dt;
    const a = this.points.geometry.attributes.position, s = this.seed, n = a.count;
    for (let i = 0; i < n; i++) {
      const k = (s[i * 3 + 2] + this.t * 0.08) % 1;
      const ang = s[i * 3] + this.t * 0.15 + k * 2, d = s[i * 3 + 1] * (0.85 + 0.15 * Math.sin(this.t + i));
      a.setXYZ(i, this.x + Math.cos(ang) * d, k * this.h, this.z + Math.sin(ang) * d);
    }
    a.needsUpdate = true;
  }
}
