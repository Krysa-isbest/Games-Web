// Every number that decides how the raider moves, tires, falls and takes damage. Tune here.

export const MOVE = {
  gravity: 22,         // m/s²
  jog: 4.5,            // normal running speed, m/s
  sprint: 7.0,
  crouch: 2.3,
  aim: 3.0,            // walking while aiming
  aimCrouch: 1.9,
  back: 0.8,           // speed factor when walking backwards while aiming
  accel: 14,           // how fast you reach your speed on the ground (higher = snappier)
  decel: 16,
  air: 2.5,            // control in the air
  turn: 14,            // how fast the body turns to face where you run
  turnSprint: 8,
  jump: 7.2,           // take-off speed: about 1.2 m high
  coyote: 0.12,        // you can still jump this long after running off a ledge
  buffer: 0.12,        // a jump pressed this long before landing still happens
  step: 0.35,          // highest step you walk up without jumping, m
  slope: 46,           // steepest slope you can walk up, degrees
  stick: 2,            // downward speed that keeps the feet on slopes and stairs
  terminal: 40,
};

export const BODY = {
  radius: 0.32,        // the collision capsule
  stand: 1.8,          // heights, m
  crouch: 1.2,
  low: 0.95,           // sliding and rolling
  offset: 0.02,        // the gap the character controller keeps from surfaces
};

export const STAMINA = {
  max: 100,
  regen: 25,           // per second, after the delay
  delay: 1.0,          // seconds after spending before it comes back
  sprint: 14,          // per second
  jump: 8,
  roll: 25,
  slide: 12,
  recover: 35,         // after running dry you cannot sprint until it is back to this
};

export const ROLL = {
  time: 0.62,          // seconds
  speed: 10.5,         // start speed, easing down to `end` (about 3.7 m in total)
  end: 2.2,
  curve: 1.2,
  iFrom: 0.06,         // the dodge window: hits in this part of the roll miss you
  iTo: 0.40,
  cooldown: 0.2,
};

export const SLIDE = {
  minSpeed: 5.5,       // sprint speed needed to start a slide
  boost: 8.2,          // speed at the start of the slide
  friction: 4.5,       // m/s lost per second on flat ground (about 1.1 s and 6 m of slide); slopes steeper than 13° win
  endSpeed: 3.2,
  maxTime: 1.5,
  maxTimeDown: 3.0,    // downhill slides may last longer
  steer: 1.5,
  cooldown: 0.6,
};

export const FALL = {
  safe: 13,            // landing speed (m/s) that does not hurt: about 3.8 m of drop
  hard: 10,            // above this you stumble for a moment
  perMs: 42,           // damage per m/s above `safe`: a 7 m drop costs about 190
};

// The three shields. def = the share of damage taken off your health while the shield holds.
// The shield itself takes the full damage. Light is repaired with a Repair Kit, medium and heavy are
// recharged with a Shield Cell.
export const SHIELDS = {
  light:  { name: 'Light shield',  def: 0.30, hp: 200, restore: 'Repair',   item: 'Repair Kit',  time: 8 },
  medium: { name: 'Medium shield', def: 0.40, hp: 300, restore: 'Recharge', item: 'Shield Cell', time: 4 },
  heavy:  { name: 'Heavy shield',  def: 0.50, hp: 400, restore: 'Recharge', item: 'Shield Cell', time: 4 },
};
export const SHIELD_ORDER = ['light', 'medium', 'heavy'];

export const BASE = { health: 500 };
// Weapon numbers live with the items (items.js), weapon behaviour in weapons.js.

// The player's numbers; m = the skill tree's mods (game/skills.js skillMods; none: the base numbers)
export function playerStats(m = null) {
  m = m || { sprint: 1, regen: 1, rollCost: 1, reload: 1, hold: 1, use: 1, health: 0, stamina: 0, heart: 0 };
  return {
    maxHealth: BASE.health + m.health, maxStamina: STAMINA.max + m.stamina, regen: STAMINA.regen * m.regen, sprintCost: STAMINA.sprint,
    sprint: MOVE.sprint * m.sprint, rollCost: STAMINA.roll * m.rollCost, reload: m.reload, hold: m.hold, use: m.use, heart: m.heart,
  };
}
