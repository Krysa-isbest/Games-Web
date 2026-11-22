// The five Prism robots: every number that decides how they see, move, fight and break (DESIGN.md section 10).
//
// armor: the share of damage the body shrugs off (low 10 %, medium 30 %, heavy 50 %).
// parts: hit spheres in the model's space (the model faces +z). A part with hp breaks on its own (thrusters);
//        mult multiplies damage there (weak points); armor on a part replaces the body's armor.
// sight / fov / recog: how far it sees, its field of view in degrees, and how long you must be in sight
//        before it recognises you as an enemy. Crouching cuts the sight range.
export const PRISM = {
  fink: {
    name: 'Fink', hp: 200, armor: 0.1, flyer: true, radius: 0.32, eye: [0, 0, 0],
    sight: 30, fov: 360, recog: 0, scan: 3, call: 10, callCooldown: 30, speed: 2, dodgeSpeed: 6.5, alt: 4.5,
    parts: [
      { name: 'body', at: [0, 0.06, 0], r: 0.26 },
      { name: 'thruster', at: [0, -0.24, 0], r: 0.11, hp: 40, armor: 0 },
    ],
    bar: 0.5, loot: 'fink',
  },
  fly: {
    name: 'Fly', hp: 150, armor: 0.1, flyer: true, radius: 0.36, eye: [0, 0, 0.3],
    sight: 34, fov: 240, recog: 2, speed: 6.5, accel: 9, orbit: [8, 15], alt: [2.5, 5],
    lock: 3, shots: 3, shotGap: 0.14, damage: 15, boltSpeed: 42, spread: 1.0, cool: [1.0, 2.5],
    parts: [
      { name: 'body', at: [0, 0, 0], r: 0.3 },
      { name: 'visor', at: [0, 0.02, 0.31], r: 0.1, mult: 1.5, armor: 0 },
      { name: 'thrusterL', at: [0.42, 0, -0.04], r: 0.16, hp: 35, armor: 0 },
      { name: 'thrusterR', at: [-0.42, 0, -0.04], r: 0.16, hp: 35, armor: 0 },
    ],
    bar: 0.45, loot: 'fly',
  },
  swatter: {
    name: 'Swatter', hp: 500, armor: 0.3, flyer: true, radius: 0.7, eye: [0, 0.05, 0.6],
    sight: 42, fov: 240, recog: 2, speed: 4.5, accel: 5, keep: [16, 22], alt: [4, 6],
    lock: 4, shots: [30, 40], rate: 14, damage: 5, spread: 3, spreadGrow: 0.15, overheat: 4, cool: 1.5, hotMult: 1.3,
    parts: [
      { name: 'body', at: [0, 0, 0], r: 0.58 },
      { name: 'visor', at: [0, 0.06, 0.62], r: 0.16, mult: 1.5, armor: 0 },
      { name: 'gun', at: [0, -0.45, 0.35], r: 0.22 },
      { name: 'thrusterL', at: [0.86, 0, -0.05], r: 0.32, hp: 80, armor: 0 },
      { name: 'thrusterR', at: [-0.86, 0, -0.05], r: 0.32, hp: 80, armor: 0 },
    ],
    bar: 0.9, loot: 'swatter',
  },
  scatter: {
    name: 'Scatter', hp: 50, armor: 0.1, flyer: false, radius: 0.26, center: 0.3, eye: [0, 0.32, 0.2],
    sight: 16, fov: 220, recog: 1, speed: 3.6, reach: 7.5, windup: 1, fuse: 0.7, stick: 200, cluster: [60, 120], bombs: [4, 6], spread: 4,
    parts: [{ name: 'body', at: [0, 0.3, 0], r: 0.3 }],
    bar: 0.6, loot: 'scatter',
  },
  roach: {
    name: 'Roach', hp: 1500, armor: 0.5, flyer: false, radius: 1.0, center: 1.05, eye: [0, 0.9, 1.6],
    sight: 40, fov: 160, recog: 5, speed: 2.2, turn: 1.2, flySpeed: 6, keep: [9, 14],
    charge: 3, beam: 5, beamTick: 0.1, beamDamage: 4, beamTurn: 0.9, stompRange: 2.6, stompWind: 2, stompRadius: 2, stompDamage: 100,
    flightEvery: 22, rockets: 5, rocketGap: 1.4, rocketDamage: 50, rocketRadius: 2.5, gasRadius: 4, gasTime: 10, empRadius: 9, empTime: 4,
    parts: [
      { name: 'front', at: [0, 1.0, 0.75], r: 0.78 },
      { name: 'middle', at: [0, 1.05, -0.1], r: 0.82 },
      { name: 'rear', at: [0, 1.0, -0.95], r: 0.75 },
      { name: 'visor', at: [0, 0.9, 1.58], r: 0.24, mult: 1.5, armor: 0 },
      { name: 'hatch', at: [0, 1.65, -0.1], r: 0.42, mult: 2, armor: 0, open: true },   // only while it flies
    ],
    bar: 2.2, loot: 'roach',
  },
};

// Who comes out of a drop pod in the test range (DESIGN: Fly groups, Swatters and Scatters by zone)
export const REINFORCEMENTS = ['fly', 'fly', 'fly', 'swatter'];
