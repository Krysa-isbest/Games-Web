import * as THREE from 'three';
import { part } from './data.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const ball = (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);
const FUR = { roughness: 0.95 };

// Four-legged animal rig: userData.legs = 4 pivots, body, head, tail.
function quad(g, legLen, legR, color, pts) {
  const legs = pts.map(([x, z]) => {
    const p = new THREE.Group(); p.position.set(x, legLen, z); g.add(p);
    part(p, cyl(legR, legR * 0.8, legLen), color, 0, -legLen / 2, 0, FUR);
    return p;
  });
  return legs;
}

export function makeDog(seed = 0) {
  const g = new THREE.Group();
  const coat = [0x3a2a1a, 0x1a1a1a, 0x8a6a3a, 0x5a4a3a][seed % 4], light = new THREE.Color(coat).lerp(new THREE.Color(0xd8c0a0), 0.4).getHex();
  const legs = quad(g, 0.42, 0.045, coat, [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.28], [0.12, -0.28]]);
  const body = new THREE.Group(); g.add(body);
  part(body, cyl(0.15, 0.13, 0.72, 10), coat, 0, 0.58, 0, FUR).rotation.x = Math.PI / 2;
  part(body, ball(0.15), coat, 0, 0.6, 0.3, FUR);
  part(body, cyl(0.1, 0.14, 0.4, 10), light, 0, 0.53, 0.05, FUR).rotation.x = Math.PI / 2;
  const head = new THREE.Group(); head.position.set(0, 0.78, 0.42); body.add(head);
  part(head, ball(0.12), coat, 0, 0, 0, FUR).scale.set(0.9, 0.9, 1);
  part(head, box(0.1, 0.09, 0.16), light, 0, -0.03, 0.13, FUR);
  part(head, ball(0.025, 6, 5), 0x111111, 0, -0.01, 0.21);
  for (const x of [-0.06, 0.06]) {
    part(head, new THREE.ConeGeometry(0.04, 0.1, 4), coat, x, 0.12, -0.02, FUR).rotation.z = x > 0 ? -0.3 : 0.3;
    part(head, ball(0.017, 6, 5), 0xe0a020, x * 0.8, 0.04, 0.1, { emissive: 0x402000 });
  }
  const jaw = part(head, box(0.08, 0.025, 0.12), 0x5a1a1a, 0, -0.08, 0.12);
  part(body, box(0.22, 0.03, 0.08), 0xa02020, 0, 0.7, 0.35).rotation.x = 0.4; // collar
  const tail = new THREE.Group(); tail.position.set(0, 0.68, -0.36); body.add(tail);
  part(tail, cyl(0.025, 0.012, 0.32), coat, 0, 0.14, -0.06, FUR).rotation.x = -0.5;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legs, body, head, tail, jaw };
  return g;
}

export function makeRat() {
  const g = new THREE.Group();
  const c = 0x4a4038, pink = 0xd89090;
  const legs = quad(g, 0.05, 0.012, c, [[-0.04, 0.07], [0.04, 0.07], [-0.04, -0.07], [0.04, -0.07]]);
  const body = new THREE.Group(); g.add(body);
  part(body, ball(0.08), c, 0, 0.09, 0, FUR).scale.set(0.8, 0.75, 1.5);
  const head = new THREE.Group(); head.position.set(0, 0.1, 0.12); body.add(head);
  part(head, new THREE.ConeGeometry(0.05, 0.12, 7), c, 0, 0, 0.04, FUR).rotation.x = Math.PI / 2;
  part(head, ball(0.012, 5, 4), pink, 0, 0, 0.1);
  for (const x of [-0.03, 0.03]) {
    part(head, ball(0.022, 6, 5), pink, x, 0.04, -0.01).scale.z = 0.3;
    part(head, ball(0.009, 5, 4), 0xff2020, x * 0.9, 0.02, 0.04, { emissive: 0x801010 });
  }
  const tail = new THREE.Group(); tail.position.set(0, 0.08, -0.12); body.add(tail);
  part(tail, cyl(0.008, 0.003, 0.22, 5), pink, 0, 0, -0.1).rotation.x = Math.PI / 2 - 0.2;
  g.userData = { legs, body, head, tail };
  return g;
}

export function makeChicken(seed = 0) {
  const g = new THREE.Group();
  const c = [0xf4efe4, 0xb06a2a, 0x3a2a1a, 0xe8d8b8][seed % 4];
  const legs = [-0.04, 0.04].map(x => {
    const p = new THREE.Group(); p.position.set(x, 0.12, 0); g.add(p);
    part(p, cyl(0.01, 0.01, 0.12, 5), 0xe0a020, 0, -0.06, 0);
    part(p, box(0.04, 0.008, 0.05), 0xe0a020, 0, -0.118, 0.015);
    return p;
  });
  const body = new THREE.Group(); g.add(body);
  part(body, ball(0.1), c, 0, 0.19, 0, FUR).scale.set(0.85, 0.85, 1.15);
  part(body, new THREE.ConeGeometry(0.06, 0.12, 6), c, 0, 0.25, -0.12, FUR).rotation.x = -0.9;
  for (const x of [-0.08, 0.08]) part(body, ball(0.06, 6, 5), c, x, 0.19, -0.01, FUR).scale.set(0.3, 0.7, 1.2);
  const head = new THREE.Group(); head.position.set(0, 0.31, 0.09); body.add(head);
  part(head, ball(0.045), c, 0, 0, 0, FUR);
  part(head, new THREE.ConeGeometry(0.014, 0.04, 4), 0xe0a020, 0, -0.005, 0.055).rotation.x = Math.PI / 2;
  part(head, box(0.012, 0.035, 0.05), 0xd02020, 0, 0.045, 0.005);
  part(head, box(0.01, 0.025, 0.012), 0xd02020, 0, -0.035, 0.04);
  for (const x of [-0.03, 0.03]) part(head, ball(0.008, 5, 4), 0x111111, x, 0.012, 0.03);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legs, body, head };
  return g;
}

// k: stride, t: phase
export function animateQuad(g, t, moving, k = 1) {
  const { legs, body, tail, head } = g.userData;
  const s = moving ? Math.sin(t) * 0.6 * k : 0;
  if (legs.length === 4) {
    legs[0].rotation.x = s; legs[3].rotation.x = s;
    legs[1].rotation.x = -s; legs[2].rotation.x = -s;
  } else { legs[0].rotation.x = s; legs[1].rotation.x = -s; }
  body.position.y = moving ? Math.abs(Math.cos(t)) * 0.02 * k : 0;
  if (tail) tail.rotation.y = Math.sin(t * (moving ? 1.5 : 0.4) + 1) * 0.4;
  if (head && !moving) head.rotation.x = Math.sin(performance.now() * 0.003 + g.id) * 0.08;
}
