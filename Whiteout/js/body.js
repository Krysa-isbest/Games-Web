// Whiteout: a simple low-poly person, the same kind as the passengers in the opening cutscene. Used for your
// own body in first person (you see your coat, legs and boots when you look down) and for your crew.
// The model faces +z; its feet are at y = 0.
import * as THREE from 'three';

const HIP = 0.905;
const SKINS = ['#f1c7a5', '#e0ac85', '#c68c63', '#8d5a3b', '#f5d2b8'], HAIR = ['#3b2a1e', '#1c1410', '#6b4a2a', '#2a2a2a', '#9a9a9a'];
export function lookFor(p) {
  let h = 0;
  for (const c of String((p.id || '') + (p.name || ''))) h = (h * 31 + c.charCodeAt(0)) | 0;
  h = Math.abs(h);
  return { coat: p.coat || '#b4462e', skin: SKINS[h % SKINS.length], hair: HAIR[(h >> 3) % HAIR.length], long: (h >> 6) % 2 === 1 };
}

export function makeBody(look, firstPerson = false) {
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.82 });
  const mc = mat(look.coat || '#b4462e'), ms = mat(look.skin || '#e0b494'), mh = mat(look.hair || '#3b2a1e'), mp = mat(look.pants || '#24272c'), mshoe = mat('#141414'), mglove = mat('#2b2622');
  // in first person your head is only there for its shadow: you are looking out of it
  const ghost = firstPerson ? new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }) : null;
  const g = new THREE.Group(), hips = new THREE.Group(), body = new THREE.Group();
  hips.position.y = HIP; g.add(hips); hips.add(body);
  const box = (w, h, d, m, x, y, z, par) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; par.add(b); return b; };
  box(0.4, 0.3, 0.26, mc, 0, -0.03, 0, body);                  // the coat's hem over the hips
  box(0.4, 0.5, 0.24, mc, 0, 0.32, 0, body);                   // chest
  box(0.43, 0.13, 0.27, mc, 0, 0.5, 0, body);                  // shoulders
  box(0.08, 0.08, 0.08, ghost || ms, 0, 0.6, 0, body);         // neck
  const head = new THREE.Group(); head.position.y = 0.62; body.add(head);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), ghost || ms); hd.scale.set(0.9, 1.08, 1); hd.position.y = 0.13; hd.castShadow = true; head.add(hd);
  const hr = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), ghost || mh); hr.position.set(0, 0.15, -0.012); hr.rotation.x = -0.25; hr.castShadow = true; head.add(hr);
  if (look.long) box(0.22, 0.26, 0.08, ghost || mh, 0, 0.06, -0.085, head);
  const arm = s => {
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.5, 0); body.add(sh); box(0.1, 0.32, 0.11, mc, 0, -0.15, 0, sh);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el); box(0.09, 0.28, 0.1, mc, 0, -0.13, 0, el);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.047, 8, 6), mglove); hand.position.y = -0.3; hand.castShadow = true; el.add(hand);
    return { sh, el };
  };
  const leg = s => {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0, 0.02); hips.add(hip); box(0.15, 0.44, 0.16, mp, 0, -0.22, 0, hip);
    const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn); box(0.13, 0.42, 0.14, mp, 0, -0.21, 0, kn); box(0.12, 0.07, 0.24, mshoe, 0, -0.43, 0.05, kn);
    return { hip, kn };
  };
  return { g, hips, body, head, aL: arm(-1), aR: arm(1), lL: leg(-1), lR: leg(1) };
}

// crouch 0..1, walk = how hard the legs swing, phase = where in the stride, air 0..1 = off the ground,
// hug 0..1 = arms wrapped around yourself against the cold, look = the head's pitch (your crew sees it),
// fp = first person (the chest stays out of the camera)
export function pose(P, k) {
  const cr = k.crouch || 0, wk = k.walk || 0, ph = k.phase || 0, air = k.air || 0, hug = k.hug || 0;
  const sn = Math.sin(ph), sw = sn * 0.55 * wk;
  const a = cr * 1.0 + air * 0.3, b = cr * 2.08 + air * 0.6;                  // a squat: thighs forward, shins back under the hips
  P.lL.hip.rotation.x = -a + sw; P.lR.hip.rotation.x = -a - sw;
  P.lL.kn.rotation.x = b + Math.max(0, -sn) * 0.75 * wk; P.lR.kn.rotation.x = b + Math.max(0, sn) * 0.75 * wk;
  P.hips.position.y = HIP - cr * 0.425 + Math.abs(Math.cos(ph)) * 0.022 * wk;
  P.body.rotation.x = k.fp ? 0 : cr * 0.3;
  P.head.rotation.x = k.look || 0;
  const swA = sw * 0.9 * (1 - hug), lift = hug * 0.75 + cr * 0.2;
  P.aL.sh.rotation.set(-swA - lift, 0, -0.08 + hug * 0.5); P.aR.sh.rotation.set(swA - lift, 0, 0.08 - hug * 0.5);
  P.aL.el.rotation.set(-0.15 - 0.25 * wk - hug * 1.75, 0, hug * 0.85); P.aR.el.rotation.set(-0.15 - 0.25 * wk - hug * 1.75, 0, -hug * 0.85);
}
