import * as THREE from 'three';
import { rng } from './state.js';
import { part } from './data.js';

// "Realistic low poly" people: proper proportions, knees and elbows, faces with brows/nose/lips,
// hands with thumbs, soles, belts, collars. Skin is smooth shaded, clothes stay faceted.
const SKIN = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a1e];
const HAIR = [0x2a1a0a, 0x111111, 0xc9a050, 0x777777, 0x8a3a1a, 0xd8d0c0, 0x4a2a12];
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const dome = (r, cut = 0.5) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI * cut);
const SMOOTH = { flatShading: false, roughness: 0.75 };
const CLOTH = { roughness: 0.9 };

// opts: seed (same seed = same person on every machine), ragged (homeless), guard (old junkyard owner),
// player (co-op avatar, color = shirt), scale.
export function makePerson(opts = {}) {
  const r = rng(opts.seed ?? (Math.random() * 1e9 | 0));
  const P = a => a[r() * a.length | 0];
  const R = (a, b) => a + r() * (b - a);
  const rag = opts.ragged, guard = opts.guard;
  const fem = !rag && !guard && r() < 0.45;
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const skin = guard ? 0xe8b48a : P(SKIN);
  const shade = c => new THREE.Color(c).multiplyScalar(0.72).getHex();
  const top = opts.player ?? (rag ? P([0x4a4a32, 0x3a3028, 0x5a4a3a, 0x2f3a2a]) : guard ? 0x8a2a1a
    : new THREE.Color().setHSL(r(), R(0.3, 0.6), R(0.28, 0.5)).getHex());
  const pants = rag ? P([0x3a3226, 0x2a2a2a, 0x4a3a2a]) : guard ? 0x3a4a5a : P([0x22283a, 0x3a3226, 0x1a1a1a, 0x44506a, 0x6a5a40, 0x2a3a5a]);
  const shoe = P([0x1a1410, 0x3a2a1a, 0xe8e8e8, 0x222222, 0x5a3a1a]);
  const hair = guard ? 0xcfcfcf : P(HAIR);
  const width = fem ? 0.9 : 1;

  // legs: hip pivot -> thigh -> knee pivot -> shin + shoe
  const legs = [-0.095, 0.095].map(x => {
    const hip = new THREE.Group(); hip.position.set(x * width, 0.92, 0); body.add(hip);
    part(hip, cyl(0.085, 0.07, 0.44), pants, 0, -0.22, 0, CLOTH);
    const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
    part(knee, ball(0.07, 8, 6), pants, 0, 0, 0, CLOTH);
    part(knee, cyl(0.068, 0.055, 0.42), pants, 0, -0.21, 0, CLOTH);
    part(knee, box(0.11, 0.07, 0.25), shoe, 0, -0.44, 0.045);
    part(knee, box(0.115, 0.025, 0.26), 0x111111, 0, -0.47, 0.045);
    return { hip, knee };
  });
  // hips, belt, torso (lathe for a real chest/waist shape)
  part(body, cyl(0.17 * width, 0.18 * width, 0.16, 10), pants, 0, 0.95, 0, CLOTH).scale.z = 0.7;
  if (!rag) part(body, cyl(0.172 * width, 0.172 * width, 0.035, 10), 0x1a1410, 0, 1.03, 0).scale.z = 0.72;
  const torsoShape = (fem ? [[0.15, 0], [0.14, 0.12], [0.165, 0.3], [0.17, 0.4], [0.19, 0.48], [0.1, 0.52]]
    : [[0.16, 0], [0.165, 0.14], [0.19, 0.3], [0.21, 0.42], [0.215, 0.48], [0.1, 0.53]]).map(([a, b]) => new THREE.Vector2(a, b));
  const torso = part(body, new THREE.LatheGeometry(torsoShape, 10), top, 0, 1.02, 0, CLOTH);
  torso.scale.z = 0.62;
  part(body, cyl(0.06, 0.07, 0.1, 8), skin, 0, 1.57, 0, SMOOTH);
  if (rag) {
    part(body, cyl(0.22, 0.27, 0.62, 10), top, 0, 0.98, 0, CLOTH).scale.z = 0.7;
    part(body, box(0.1, 0.12, 0.02), shade(top), 0.1, 1.08, 0.16);
    part(body, new THREE.TorusGeometry(0.11, 0.05, 6, 12), 0x7a2a1a, 0, 1.52, 0, CLOTH).rotation.x = Math.PI / 2; // scarf
  } else if (guard) {
    for (let k = 0; k < 5; k++) part(body, box(0.42, 0.012, 0.27), 0x1a1a1a, 0, 1.1 + k * 0.09, 0); // plaid
    for (const x of [-0.13, 0.13]) part(body, box(0.05, 0.5, 0.02), 0x5a4a2a, x, 1.25, 0.12); // suspenders
  } else if (r() < 0.45) {
    const jacket = P([0x2a2a2a, 0x3a4a6a, 0x5a3a22, 0x6a1a1a, 0x2a4a3a, 0x8a7a5a]);
    for (const x of [-0.115, 0.115]) part(body, box(0.15, 0.5, 0.05), jacket, x * width, 1.27, 0.115, CLOTH);
    part(body, box(0.44 * width, 0.08, 0.27), jacket, 0, 1.5, 0, CLOTH);
    for (const x of [-0.07, 0.07]) part(body, box(0.05, 0.16, 0.02), shade(jacket), x, 1.46, 0.14).rotation.z = x > 0 ? -0.3 : 0.3;
  } else {
    part(body, box(0.16, 0.04, 0.04), shade(top), 0, 1.52, 0.1);
    if (r() < 0.3) part(body, box(0.12, 0.12, 0.01), P([0xffffff, 0xf0d040, 0x111111]), 0, 1.3, 0.135); // shirt print
  }

  // arms: shoulder -> upper arm -> elbow -> forearm -> hand with thumb
  const sleeve = rag || guard || r() < 0.6 ? top : skin;
  const arms = [-1, 1].map(s => {
    const sh = new THREE.Group(); sh.position.set(s * 0.23 * width, 1.47, 0); body.add(sh);
    part(sh, ball(0.07, 8, 6), top, 0, 0, 0, CLOTH);
    part(sh, cyl(0.062, 0.052, 0.3), top, 0, -0.15, 0, CLOTH);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    part(el, cyl(0.052, 0.042, 0.27), sleeve, 0, -0.135, 0, sleeve === skin ? SMOOTH : CLOTH);
    part(el, box(0.065, 0.09, 0.035), skin, 0, -0.31, 0.005, SMOOTH);
    part(el, box(0.02, 0.05, 0.025), skin, -s * 0.035, -0.295, 0.02, SMOOTH).rotation.z = s * 0.4;
    sh.rotation.z = s * 0.06;
    return { sh, el };
  });

  // head: skull, jaw, ears, nose, eyes (white + iris), brows, lips
  const head = new THREE.Group(); head.position.y = 1.76; body.add(head);
  part(head, ball(0.118), skin, 0, 0.02, 0, SMOOTH).scale.set(0.92, 1.08, 1);
  part(head, ball(0.095, 10, 6), skin, 0, -0.045, 0.02, SMOOTH).scale.set(fem ? 0.88 : 0.98, 0.8, 0.95);
  for (const x of [-1, 1]) {
    part(head, ball(0.028, 6, 5), skin, x * 0.11, 0.0, -0.005, SMOOTH).scale.set(0.5, 1, 0.8);
    part(head, ball(0.019, 8, 6), 0xffffff, x * 0.042, 0.025, 0.098, { roughness: 0.3 }).scale.z = 0.5;
    part(head, ball(0.01, 6, 5), P([0x3a2a1a, 0x2a5a8a, 0x3a6a3a, 0x1a1a1a]), x * 0.042, 0.025, 0.107);
    part(head, box(0.045, 0.011, 0.012), hair, x * 0.043, 0.058, 0.105).rotation.z = x * -0.12;
  }
  part(head, new THREE.ConeGeometry(0.02, 0.05, 5), skin, 0, -0.005, 0.118, SMOOTH).rotation.x = Math.PI / 2 + 0.3;
  part(head, box(0.05, 0.012, 0.012), fem ? 0xb04a4a : 0x9a5a4a, 0, -0.06, 0.098);

  const style = rag ? P(['beanie', 'beanie', 'messy']) : guard ? 'trucker' : fem ? P(['long', 'long', 'bun', 'bob', 'ponytail'])
    : P(['short', 'short', 'buzz', 'cap', 'bald', 'beanie', 'slick', 'curly']);
  const H = (geo, x, y, z) => part(head, geo, hair, x, y, z, CLOTH);
  if (['short', 'long', 'messy', 'bun', 'bob', 'ponytail', 'slick', 'curly', 'buzz'].includes(style)) {
    H(dome(0.126, style === 'buzz' ? 0.42 : 0.55), 0, 0.03, -0.008).scale.set(0.97, style === 'messy' || style === 'curly' ? 1.15 : 1, 1.06);
    if (style === 'long') H(box(0.24, 0.3, 0.08), 0, -0.1, -0.08);
    if (style === 'bob') H(box(0.25, 0.14, 0.2), 0, -0.03, -0.03);
    if (style === 'messy') H(box(0.24, 0.18, 0.1), 0, -0.04, -0.08);
    if (style === 'bun') H(ball(0.05, 8, 6), 0, 0.12, -0.1);
    if (style === 'ponytail') H(cyl(0.03, 0.015, 0.22, 6), 0, -0.04, -0.14).rotation.x = 0.4;
    if (style === 'curly') for (let k = 0; k < 6; k++) H(ball(0.04, 6, 4), Math.cos(k) * 0.09, 0.1, Math.sin(k) * 0.06 - 0.02);
    if (style === 'slick') H(box(0.2, 0.03, 0.08), 0, 0.12, 0.05);
  } else if (style === 'beanie') {
    const c = P([0x8a1a1a, 0x1a3a6a, 0x2a4a2a, 0x555555, 0xc08a20]);
    part(head, dome(0.13, 0.55), c, 0, 0.04, 0, CLOTH).scale.y = 1.25;
    part(head, cyl(0.132, 0.132, 0.045, 12), c, 0, 0.05, 0, CLOTH);
  } else if (style === 'cap' || style === 'trucker') {
    const c = guard ? 0x2a5a2a : P([0xc0392b, 0x2a6ad0, 0x111111, 0x27ae60]);
    part(head, dome(0.128), c, 0, 0.05, 0, CLOTH);
    part(head, box(0.16, 0.015, 0.11), c, 0, 0.06, 0.15).rotation.x = -0.15;
    if (guard) part(head, box(0.13, 0.07, 0.01), 0xf4f1e6, 0, 0.1, 0.12).rotation.x = -0.35;
  }
  // facial hair, glasses
  if (rag || guard || (!fem && r() < 0.25)) {
    const bc = guard ? 0xd8d8d8 : rag ? P([0x6a5a4a, 0x888070, 0x3a2a1a]) : hair;
    part(head, ball(0.085, 8, 6), bc, 0, -0.07, 0.03, CLOTH).scale.set(1, guard || rag ? 1.1 : 0.7, 0.85);
  }
  if (!rag && (guard || r() < 0.18)) {
    part(head, box(0.18, 0.008, 0.008), 0x111111, 0, 0.03, 0.115);
    for (const x of [-0.042, 0.042]) part(head, box(0.05, 0.035, 0.004), 0x88aacc, x, 0.025, 0.113, { transparent: true, opacity: 0.45, roughness: 0.05 });
  }
  if (rag) body.rotation.x = 0.1;
  if (guard) body.rotation.x = 0.06;
  const sc = opts.scale ?? R(0.95, 1.05) * (fem ? 0.95 : 1);
  g.scale.setScalar(sc);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legs, arms, body, head };
  return g;
}

// t = walk phase, walking = moving, k = stride size (1 = normal walk)
export function animatePerson(g, t, walking, k = 1) {
  const { legs, arms, body } = g.userData;
  const sw = walking ? Math.sin(t) * 0.5 * k : 0;
  legs[0].hip.rotation.x = sw; legs[1].hip.rotation.x = -sw;
  legs[0].knee.rotation.x = walking ? Math.max(0, Math.sin(t + 1.2)) * 0.9 * k : 0;
  legs[1].knee.rotation.x = walking ? Math.max(0, Math.sin(t + 1.2 + Math.PI)) * 0.9 * k : 0;
  arms[0].sh.rotation.x = -sw * 0.8; arms[1].sh.rotation.x = sw * 0.8;
  arms[0].el.rotation.x = arms[1].el.rotation.x = walking ? -0.25 : -0.08;
  body.position.y = walking ? Math.abs(Math.cos(t)) * 0.03 * k : Math.sin(performance.now() * 0.0015 + g.id) * 0.004;
}

// Arms forward (holding something / reaching / attacking).
export function poseArms(g, x, elbow = -0.3) {
  for (const a of g.userData.arms) { a.sh.rotation.x = x; a.el.rotation.x = elbow; }
}

// Name tag over a co-op avatar.
export function nameTag(text, color = '#ffd86a') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, sans-serif'; g.textAlign = 'center';
  g.fillStyle = '#000a'; const w = g.measureText(text).width + 24; g.fillRect(128 - w / 2, 10, w, 44);
  g.fillStyle = color; g.fillText(text, 128, 43);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.9, 0.225, 1); s.position.y = 2.15; s.renderOrder = 10;
  return s;
}
