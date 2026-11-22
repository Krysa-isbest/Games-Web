// Weapon models, built in code. Each faces +z (the barrel forward) and marks the points the animation needs:
//   grip   the right hand            fore   the left hand (on a pistol: the supporting hand)
//   muzzle where shots come out      mag    the magazine (the left hand goes there to reload)
//   butt   the end of the stock, which sits in the shoulder while aiming
import * as THREE from 'three';

const M = (color, rough = 0.5, metal = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const MAT = {
  gun: M(0x2b2d33, 0.42, 0.65), polymer: M(0x3b3c42, 0.85, 0.05), steel: M(0x8a8d94, 0.35, 0.8), rust: M(0x7a3b2a, 0.7, 0.4),
  dark: M(0x18191c, 0.8, 0.1), accent: M(0xffb224, 0.5, 0.2, { emissive: 0xff8a00, emissiveIntensity: 0.25 }),
  coil: new THREE.MeshStandardMaterial({ color: 0xb98aff, emissive: 0x9a5cff, emissiveIntensity: 1.4, roughness: 0.3 }),
  olive: M(0x4b5a3a, 0.7, 0.2),
};

function kit(group, shadows) {
  return (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = shadows;
    group.add(m);
    return m;
  };
}
const pt = (x, y, z) => new THREE.Vector3(x, y, z);

export function makeWeapon(kind, shadows = true) {
  const g = new THREE.Group();
  const add = kit(g, shadows);
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (r1, r2, len, seg = 10) => { const geo = new THREE.CylinderGeometry(r1, r2, len, seg); geo.rotateX(Math.PI / 2); return geo; };
  if (kind === 'pistol') {
    add(B(0.032, 0.1, 0.045), MAT.polymer, 0, -0.035, -0.005, 0.25);           // grip
    add(B(0.036, 0.045, 0.2), MAT.gun, 0, 0.035, 0.06);                         // slide
    add(B(0.03, 0.03, 0.12), MAT.gun, 0, 0.0, 0.07);                            // frame
    add(C(0.011, 0.011, 0.05), MAT.steel, 0, 0.042, 0.175);                     // barrel
    add(B(0.038, 0.01, 0.06), MAT.accent, 0, 0.06, 0.02);                       // the amber stripe
    add(B(0.012, 0.012, 0.012), MAT.steel, 0, 0.064, 0.15);                     // front sight
    add(new THREE.TorusGeometry(0.022, 0.004, 4, 10, Math.PI), MAT.gun, 0, -0.01, 0.045, 0, Math.PI / 2, Math.PI);   // trigger guard
    g.userData = { kind, grip: pt(0, -0.03, -0.005), fore: pt(0.03, -0.045, 0.0), muzzle: pt(0, 0.042, 0.205), mag: pt(0, -0.085, -0.012), butt: pt(0, -0.03, -0.005) };
  } else if (kind === 'carbine') {
    add(B(0.052, 0.08, 0.34), MAT.gun, 0, 0.01, 0.09);                          // receiver
    add(B(0.058, 0.055, 0.2), MAT.polymer, 0, -0.005, 0.34);                    // handguard
    add(C(0.016, 0.016, 0.2), MAT.steel, 0, 0.012, 0.52);                       // barrel
    add(C(0.024, 0.02, 0.06), MAT.gun, 0, 0.012, 0.62);                         // muzzle brake
    add(new THREE.TorusGeometry(0.036, 0.008, 6, 16), MAT.coil, 0, -0.003, 0.3);    // the Prism coil
    add(new THREE.TorusGeometry(0.036, 0.008, 6, 16), MAT.coil, 0, -0.003, 0.39);
    const mag = add(B(0.03, 0.13, 0.06), MAT.polymer, 0, -0.09, 0.12, 0.2);     // magazine (taken out to reload)
    add(B(0.032, 0.1, 0.045), MAT.polymer, 0, -0.07, 0.0, 0.3);                 // pistol grip
    add(B(0.042, 0.075, 0.16), MAT.polymer, 0, -0.015, -0.16);                  // stock
    add(B(0.046, 0.09, 0.02), MAT.dark, 0, -0.02, -0.245);                      // butt pad
    add(B(0.046, 0.035, 0.09), MAT.gun, 0, 0.07, 0.08);                         // sight
    add(B(0.054, 0.012, 0.12), MAT.accent, 0, 0.052, 0.17);
    g.userData = { kind, grip: pt(0, -0.06, 0.0), fore: pt(0, -0.04, 0.19), muzzle: pt(0, 0.012, 0.65), mag: pt(0, -0.11, 0.12), butt: pt(0, -0.015, -0.25),
      magMesh: mag, magBase: mag.position.clone() };
  } else if (kind === 'crowbar') {
    add(C(0.013, 0.013, 0.62, 8), MAT.rust, 0, 0, 0.2);                         // shaft
    add(C(0.013, 0.008, 0.12, 8), MAT.rust, 0, 0.04, 0.53, -0.6);               // the bent end
    add(B(0.03, 0.006, 0.05), MAT.steel, 0, -0.005, -0.12);                     // the flat end
    add(C(0.018, 0.018, 0.12, 8), MAT.polymer, 0, 0, -0.03);                    // tape on the handle
    g.userData = { kind, grip: pt(0, 0, 0), muzzle: pt(0, 0.05, 0.58) };
  } else if (kind === 'grenade') {
    add(new THREE.SphereGeometry(0.045, 12, 10), MAT.olive, 0, 0, 0);
    add(C(0.018, 0.018, 0.03, 8), MAT.steel, 0, 0.045, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.015, 0.004, 4, 10), MAT.steel, 0.02, 0.06, 0);
    g.userData = { kind, grip: pt(0, 0, 0), muzzle: pt(0, 0, 0) };
  }
  return g;
}
export function disposeWeapon(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

// the model kind for an item id
export const MODEL_OF = { scrap_pistol: 'pistol', pulse_carbine: 'carbine', crowbar: 'crowbar', frag_grenade: 'grenade' };
