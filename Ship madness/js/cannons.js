// Deck gun types: what they fire, how fast, how far and how they look. Every gun pair on a ship can have its
// own type (picked in the Garage by clicking the mount on the ship).
import * as THREE from 'three';

// speed m/s, grav = gravity on the shot, reload s, yaw = how far the gun swings either way (rad),
// pmin / pmax = pitch limits, proj = projectile kind (see PSPEC in weapons.js)
export const CANNONS = {
  deckgun: { name: 'Deck gun', short: 'GUN', desc: 'The all-rounder. Explosive shells, a steady reload.', speed: 62, grav: 9.8, reload: 2.6, yaw: 0.85, pmin: -0.12, pmax: 0.5, pitch: 0.12, proj: 'ball', muzzle: 2.1, stats: { dmg: 3, rate: 2, range: 3 } },
  autocannon: { name: 'Autocannon', short: 'AUTO', desc: 'Fast-firing 30 mm. Shreds decks and crews, small holes. Overheats after 14 shots.', speed: 115, grav: 6, reload: 0.2, heat: 14, yaw: 0.95, pmin: -0.15, pmax: 0.6, pitch: 0.05, proj: 'ac', muzzle: 1.7, stats: { dmg: 1, rate: 5, range: 4 } },
  mortar: { name: 'Mortar', short: 'MORT', desc: 'Lobs heavy bombs high over cover. Huge holes, hard to aim.', speed: 40, grav: 9.8, reload: 5.5, yaw: 0.8, pmin: 0.55, pmax: 1.3, pitch: 0.85, proj: 'mortar', muzzle: 0.9, stats: { dmg: 5, rate: 1, range: 2 } },
  rockets: { name: 'Rocket pod', short: 'RKT', desc: 'A salvo of 4 rockets that fly almost straight. Great at long range.', speed: 85, grav: 1.5, reload: 7, salvo: 4, yaw: 0.85, pmin: -0.1, pmax: 0.45, pitch: 0.04, proj: 'rocket', muzzle: 0.9, stats: { dmg: 4, rate: 1, range: 5 } },
  torpedo: { name: 'Torpedo tube', short: 'TORP', desc: 'Runs under the waves and blows a huge hole below the waterline. Slow.', speed: 24, grav: 9.8, reload: 9, yaw: 0.7, pmin: -0.05, pmax: 0.05, pitch: 0, proj: 'torpedo', muzzle: 1.4, stats: { dmg: 5, rate: 1, range: 4 } },
  // warships only: the main gun in a turret on the centre line (bow, and on the big ones the stern too)
  naval: { name: 'Naval gun', short: 'MAIN', desc: "A warship's main gun in a turret: heavy shells, long range, and it turns almost all the way round.", speed: 82, grav: 9.8, reload: 4.2, yaw: 2.35, pmin: -0.1, pmax: 0.55, pitch: 0.1, proj: 'heavy', muzzle: 2.9, turret: true, stats: { dmg: 5, rate: 2, range: 5 } },
};
export const CANNON_IDS = Object.keys(CANNONS).filter(k => !CANNONS[k].turret);     // the ones you can buy for gun pairs
export const cannonOf = c => CANNONS[c?.type] || CANNONS.deckgun;

const grey = new THREE.MeshStandardMaterial({ color: '#7d858c', roughness: 0.5, metalness: 0.6 });
const dark = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.5, metalness: 0.5 });
const olive = new THREE.MeshStandardMaterial({ color: '#56603f', roughness: 0.6, metalness: 0.3 });
const red = new THREE.MeshStandardMaterial({ color: '#a8281c', roughness: 0.5 });
const brass = new THREE.MeshStandardMaterial({ color: '#c9a03c', metalness: 0.8, roughness: 0.3 });

// the gun model. The pivot turns up / down, the group turns left / right. Barrels point along +x * side.
export function buildMount(type, side) {
  const g = new THREE.Group(), pivot = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const tube = (r0, r1, len, mat, x, y, z, parent) => { const m = add(new THREE.CylinderGeometry(r1, r0, len, 12), mat, x, y, z, parent); m.rotation.z = -side * Math.PI / 2; return m; };
  add(new THREE.CylinderGeometry(0.45, 0.55, 0.3, 16), grey, 0, 0.15, 0);
  pivot.position.y = 0.66;
  if (type === 'autocannon') {
    add(new THREE.BoxGeometry(0.75, 0.5, 0.7), olive, 0, 0, 0, pivot);
    add(new THREE.BoxGeometry(0.4, 0.3, 0.2), dark, -side * 0.2, 0.1, 0.42, pivot);          // ammo box
    for (const dz of [-0.13, 0.13]) tube(0.05, 0.04, 1.4, dark, side * 1.0, 0.04, dz, pivot);
    tube(0.075, 0.075, 0.25, dark, side * 0.42, 0.04, 0, pivot);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.6, 0.06), dark, 0, -0.35, s * 0.3);
  } else if (type === 'mortar') {
    add(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 14), olive, 0, 0.32, 0);
    add(new THREE.SphereGeometry(0.28, 12, 8), olive, 0, 0, 0, pivot);
    tube(0.2, 0.17, 1.1, olive, side * 0.45, 0, 0, pivot);
    tube(0.22, 0.22, 0.12, dark, side * 0.95, 0, 0, pivot);
    for (const s of [-1, 1]) { const leg = add(new THREE.BoxGeometry(0.06, 0.7, 0.06), dark, -side * 0.25, 0.3, s * 0.3); leg.rotation.z = side * 0.5; }
  } else if (type === 'rockets') {
    add(new THREE.BoxGeometry(0.4, 0.5, 0.4), grey, 0, -0.1, 0, pivot);
    const pod = add(new THREE.BoxGeometry(1.1, 0.5, 0.62), red, side * 0.35, 0.18, 0, pivot);
    void pod;
    for (const [dy, dz] of [[0.08, -0.15], [0.08, 0.15], [0.28, -0.15], [0.28, 0.15]]) tube(0.08, 0.08, 0.04, dark, side * 0.91, dy, dz, pivot);
    add(new THREE.BoxGeometry(0.3, 0.25, 0.1), dark, -side * 0.1, 0.1, -0.4, pivot);
  } else if (type === 'torpedo') {
    add(new THREE.BoxGeometry(0.5, 0.35, 1.0), grey, 0, 0.42, 0);
    tube(0.27, 0.27, 2.0, grey, side * 0.4, 0, 0, pivot);
    tube(0.3, 0.3, 0.1, dark, side * 1.38, 0, 0, pivot);
    tube(0.29, 0.29, 0.1, dark, -side * 0.58, 0, 0, pivot);
    add(new THREE.SphereGeometry(0.16, 8, 6), brass, side * 1.44, 0, 0, pivot);       // the warhead peeking out
  } else if (type === 'naval') {
    // a turret: the armoured house turns with the gun (yaw), only the barrel lifts (pitch)
    add(new THREE.CylinderGeometry(1.05, 1.15, 0.36, 22), grey, 0, 0.18, 0);
    const house = add(new THREE.BoxGeometry(1.9, 0.85, 1.6), grey, -side * 0.15, 0.62, 0); house.castShadow = true;
    const slope = add(new THREE.BoxGeometry(0.5, 0.6, 1.5), grey, side * 0.85, 0.55, 0); slope.rotation.z = side * 0.55;
    add(new THREE.BoxGeometry(0.5, 0.25, 0.5), dark, -side * 0.55, 1.12, 0.4);          // the rangefinder hood
    tube(0.14, 0.11, 2.6, dark, side * 1.55, 0, 0, pivot);
    tube(0.17, 0.17, 0.3, dark, side * 2.8, 0, 0, pivot);                               // muzzle brake
    tube(0.2, 0.2, 0.5, grey, side * 0.45, 0, 0, pivot);                                // mantlet
  } else {
    add(new THREE.BoxGeometry(0.9, 0.55, 0.85), grey, side * 0.05, -0.05, 0, pivot);
    const front = add(new THREE.BoxGeometry(0.25, 0.4, 0.75), grey, side * 0.55, -0.08, 0, pivot); front.rotation.z = side * 0.4;
    tube(0.09, 0.07, 1.7, dark, side * 1.15, 0, 0, pivot);
    tube(0.1, 0.1, 0.18, dark, side * 1.95, 0, 0, pivot);
  }
  g.add(pivot);
  return { g, pivot };
}

// a small icon for the Garage mount buttons
export const CANNON_ICON = {
  deckgun: '<svg viewBox="0 0 32 32"><rect x="4" y="16" width="12" height="8" rx="2"/><rect x="14" y="17.5" width="15" height="4" rx="1.5"/><rect x="6" y="24" width="8" height="3"/></svg>',
  autocannon: '<svg viewBox="0 0 32 32"><rect x="4" y="15" width="10" height="9" rx="2"/><rect x="13" y="15.5" width="16" height="2.6" rx="1"/><rect x="13" y="20" width="16" height="2.6" rx="1"/><rect x="6" y="24" width="6" height="3"/></svg>',
  mortar: '<svg viewBox="0 0 32 32"><rect x="12" y="5" width="8" height="17" rx="2" transform="rotate(25 16 16)"/><rect x="6" y="24" width="20" height="3" rx="1"/></svg>',
  rockets: '<svg viewBox="0 0 32 32"><rect x="5" y="11" width="22" height="11" rx="2"/><circle cx="22" cy="14" r="1.8" fill="#1a1408"/><circle cx="22" cy="19" r="1.8" fill="#1a1408"/><circle cx="17" cy="14" r="1.8" fill="#1a1408"/><circle cx="17" cy="19" r="1.8" fill="#1a1408"/><rect x="11" y="22" width="6" height="5"/></svg>',
  torpedo: '<svg viewBox="0 0 32 32"><rect x="3" y="13" width="22" height="7" rx="3.5"/><path d="M25 13 L30 16.5 L25 20z"/><rect x="4" y="11" width="3" height="11"/></svg>',
  naval: '<svg viewBox="0 0 32 32"><path d="M3 25 L7 15 H19 L22 19 V25z"/><rect x="18" y="15.5" width="12" height="3" rx="1.2"/><rect x="2" y="25" width="22" height="3"/></svg>',
};
