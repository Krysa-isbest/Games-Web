// The input snapshot: one plain object per simulation step. The player code only ever sees this object, never
// the keyboard, so a co-op host can later run the same code with a command that came over the network.
import { Input } from '../core/input.js';

export function readCommand(cam) {
  const mv = Input.move();
  if (!mv.x && !mv.y) Input.cancel('sprint');          // in toggle mode, stopping ends the sprint
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
    fire: Input.held('fire'),
    // the aim ray: from the camera through the crosshair (where shots go)
    aimO: { x: cam.camera.position.x, y: cam.camera.position.y, z: cam.camera.position.z },
    aimD: { x: -Math.sin(cam.yaw) * Math.cos(cam.pitch), y: Math.sin(cam.pitch), z: -Math.cos(cam.yaw) * Math.cos(cam.pitch) },
  };
}

// standing still, doing nothing (dead, paused, or a cutscene)
export function idleCommand(cam) {
  return { mx: 0, my: 0, yaw: cam ? cam.yaw : 0, pitch: cam ? cam.pitch : 0, sprint: false, crouch: false, crouchPressed: false,
    jump: false, roll: false, aim: false, interact: false, interactPressed: false, fire: false, aimO: null, aimD: null };
}
