// Rebindable controls. Use down('forward') / hit('use') instead of raw key codes.
import { IN } from './input.js';

export const ACTIONS = {
  forward: { def: 'KeyW', name: 'Move forward / speed up', group: 'Move' },
  back: { def: 'KeyS', name: 'Move back / slow down', group: 'Move' },
  left: { def: 'KeyA', name: 'Move left / steer left', group: 'Move' },
  right: { def: 'KeyD', name: 'Move right / steer right', group: 'Move' },
  jump: { def: 'Space', name: 'Jump / swim up', group: 'Move' },
  sprint: { def: 'ShiftLeft', name: 'Sprint', group: 'Move' },
  crouch: { def: 'KeyC', name: 'Crouch / dive deeper in water', group: 'Move' },
  use: { def: 'KeyE', name: 'Use / take the helm / let go', group: 'Actions' },
  drop: { def: 'KeyG', name: 'Drop what you hold', group: 'Actions' },
  reload: { def: 'KeyR', name: 'Reload', group: 'Combat' },
  detonate: { def: 'KeyF', name: 'Detonate C4', group: 'Combat' },
  slot1: { def: 'Digit1', name: 'Primary weapon', group: 'Combat' },
  slot2: { def: 'Digit2', name: 'Secondary weapon', group: 'Combat' },
  slot3: { def: 'Digit3', name: 'Gadget', group: 'Combat' },
  slot4: { def: 'Digit4', name: 'Special (flare / nuke)', group: 'Combat' },
  slot5: { def: 'Digit5', name: 'Bucket', group: 'Tools' },
  slot6: { def: 'Digit6', name: 'Hammer (fix single blocks)', group: 'Tools' },
  slot7: { def: 'Digit7', name: 'Wrench (fix the engine)', group: 'Tools' },
  anchor: { def: 'KeyR', name: 'Helm: drop / raise the anchor', group: 'Ship' },
  view: { def: 'KeyX', name: 'Helm: chase camera on / off', group: 'Ship' },
  crane: { def: 'KeyC', name: 'Crane: step away from the crane', group: 'Ship' },
  craneDown: { def: 'KeyQ', name: 'Crane: lower the hook', group: 'Ship' },
  craneUp: { def: 'KeyR', name: 'Crane: raise the hook', group: 'Ship' },
  grab: { def: 'Space', name: 'Crane: grab / release', group: 'Ship' },
  chat: { def: 'Enter', name: 'Text chat (online)', group: 'Other' },
  ptt: { def: 'KeyV', name: 'Push to talk (voice chat)', group: 'Other' },
  admin: { def: 'KeyP', name: 'Admin panel (sandbox)', group: 'Other' },
  help: { def: 'KeyH', name: 'Help card', group: 'Other' },
};
const KEY = 'shipmadness.keys';
export const BINDS = Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.def]));
try { Object.assign(BINDS, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* defaults */ }
if (BINDS.craneUp === BINDS.use) BINDS.craneUp = 'KeyR';     // the crane is its own station now: E leaves it

export const kb = a => BINDS[a];
export const down = a => IN.down.has(BINDS[a]);
export const hit = a => IN.hit.has(BINDS[a]);
export function setBind(a, code) { BINDS[a] = code; localStorage.setItem(KEY, JSON.stringify(BINDS)); }
export function resetBinds() { for (const [k, a] of Object.entries(ACTIONS)) BINDS[k] = a.def; localStorage.setItem(KEY, JSON.stringify(BINDS)); }
export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', AltLeft: 'L-Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Enter: 'Enter' }[code] || code;
}
export const kn = a => keyName(BINDS[a]);
