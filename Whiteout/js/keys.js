// Rebindable controls. Keys and mouse buttons (Mouse0 = left, Mouse1 = middle, Mouse2 = right, Mouse3/4 = side).
export const ACTIONS = {
  forward: { def: 'KeyW', name: 'Walk forward', group: 'Movement' },
  back: { def: 'KeyS', name: 'Walk back', group: 'Movement' },
  left: { def: 'KeyA', name: 'Walk left', group: 'Movement' },
  right: { def: 'KeyD', name: 'Walk right', group: 'Movement' },
  jump: { def: 'Space', name: 'Jump / climb', group: 'Movement' },
  sprint: { def: 'ShiftLeft', name: 'Sprint', group: 'Movement' },
  crouch: { def: 'KeyC', name: 'Crouch', group: 'Movement' },
  walk: { def: 'AltLeft', name: 'Walk slowly (quiet)', group: 'Movement' },
  use: { def: 'KeyE', name: 'Use / pick up', group: 'Actions' },
  primary: { def: 'Mouse0', name: 'Use the item in your hands', group: 'Actions' },
  secondary: { def: 'Mouse2', name: 'Aim / alternate use', group: 'Actions' },
  drop: { def: 'KeyG', name: 'Drop', group: 'Actions' },
  light: { def: 'KeyF', name: 'Flashlight / lighter', group: 'Actions' },
  eat: { def: 'KeyQ', name: 'Eat / drink the held item', group: 'Actions' },
  slot1: { def: 'Digit1', name: 'Hotbar slot 1', group: 'Inventory' },
  slot2: { def: 'Digit2', name: 'Hotbar slot 2', group: 'Inventory' },
  slot3: { def: 'Digit3', name: 'Hotbar slot 3', group: 'Inventory' },
  slot4: { def: 'Digit4', name: 'Hotbar slot 4', group: 'Inventory' },
  slot5: { def: 'Digit5', name: 'Hotbar slot 5', group: 'Inventory' },
  inventory: { def: 'Tab', name: 'Backpack', group: 'Inventory' },
  craft: { def: 'KeyB', name: 'Crafting / building', group: 'Inventory' },
  journal: { def: 'KeyJ', name: 'Journal and notes', group: 'Inventory' },
  map: { def: 'KeyM', name: 'Map', group: 'Inventory' },
  ptt: { def: 'KeyV', name: 'Push to talk', group: 'Crew' },
  ping: { def: 'Mouse1', name: 'Ping a spot', group: 'Crew' },
  chat: { def: 'Enter', name: 'Text chat', group: 'Crew' },
  emote: { def: 'KeyH', name: 'Wave / emote', group: 'Crew' },
};
const KEY = 'whiteout.keys';
export const BINDS = Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.def]));
try { Object.assign(BINDS, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* defaults */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(BINDS)); } catch { /* private mode */ } };
export function setBind(a, code) { BINDS[a] = code; save(); }
export function resetBinds() { for (const [k, a] of Object.entries(ACTIONS)) BINDS[k] = a.def; save(); }

// keys that may share: they are never needed at the same moment
const SHARE = [['ping', 'secondary']];
export function clashes(a) {
  const ok = new Set(SHARE.filter(p => p.includes(a)).flat());
  return Object.keys(BINDS).filter(o => o !== a && BINDS[o] === BINDS[a] && !ok.has(o));
}

const NAMES = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Enter: 'Enter', Backspace: 'Backspace',
  Mouse0: 'Left mouse', Mouse1: 'Middle mouse', Mouse2: 'Right mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\' };
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
export const kn = a => keyName(BINDS[a]);
