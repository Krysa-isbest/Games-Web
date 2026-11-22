// The input snapshot: one plain object per simulation step. The player code only ever sees this object, never
// the keyboard, so a co-op host can later run the same code with a command that came over the network.
import { Input } from '../core/input.js';

const SLOTS = ['weapon1', 'weapon2', 'melee', 'unarmed'];

// extra = what the scene adds: { quick: a quick slot picked on the item wheel (0..3), noFire: the wheel is open }
export function readCommand(cam, extra = {}) {
  const mv = Input.move();
  if (!mv.x && !mv.y) Input.cancel('sprint');          // in toggle mode, stopping ends the sprint
  if (Input.pressed('sprint')) Input.cancel('crouch');  // ...and sprinting stands you up from a toggled crouch
  const fireOk = !extra.noFire;
  return {
    mx: mv.x, my: mv.y,                                 // movement, x = right, y = forward (camera relative)
    yaw: cam.yaw, pitch: cam.pitch,                     // where the camera looks
    sprint: Input.active('sprint'),
    crouch: Input.active('crouch'),
    crouchPressed: Input.pressed('crouch'),
    jump: Input.pressed('jump'),
    roll: Input.pressed('roll'),
    aim: Input.active('aim'),
    interact: Input.held('interact'),
    interactPressed: Input.pressed('interact'),
    fire: fireOk && Input.held('fire'),
    firePressed: fireOk && Input.pressed('fire'),
    reload: Input.pressed('reload'),
    slot: SLOTS.find(s => Input.pressed(s)) || null,    // 1, 2, 3, H: what to hold
    quick: extra.quick ?? -1,                           // use the item in this quick slot
    // the aim ray: from the camera through the crosshair (where shots go)
    aimO: { x: cam.camera.position.x, y: cam.camera.position.y, z: cam.camera.position.z },
    aimD: { x: -Math.sin(cam.yaw) * Math.cos(cam.pitch), y: Math.sin(cam.pitch), z: -Math.cos(cam.yaw) * Math.cos(cam.pitch) },
  };
}

// standing still, doing nothing (dead, paused, in the inventory)
export function idleCommand(cam) {
  return { mx: 0, my: 0, yaw: cam ? cam.yaw : 0, pitch: cam ? cam.pitch : 0, sprint: false, crouch: false, crouchPressed: false,
    jump: false, roll: false, aim: false, interact: false, interactPressed: false, fire: false, firePressed: false,
    reload: false, slot: null, quick: -1, aimO: null, aimD: null };
}
