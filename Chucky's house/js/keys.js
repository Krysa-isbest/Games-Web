// Key bindings. Every action has a default key (a physical key position, e.code, or a mouse button: Mouse0/1/2).
// Players can rebind them in Settings → Controls. Hints everywhere use kb('action') so they show YOUR key.
// Labels follow the real keyboard layout: on a Czech QWERTZ keyboard the key at "Z" shows as "Y".

// ctx: 'all' = everywhere, 'shop', 'night'. Same key in 'shop' and 'night' is fine (e.g. F).
export const ACTIONS = {
  forward: { def: 'KeyW', name: 'Move forward', ctx: 'all', group: 'Moving' },
  back: { def: 'KeyS', name: 'Move back', ctx: 'all', group: 'Moving' },
  left: { def: 'KeyA', name: 'Move left', ctx: 'all', group: 'Moving' },
  right: { def: 'KeyD', name: 'Move right', ctx: 'all', group: 'Moving' },
  run: { def: 'ShiftLeft', name: 'Run', ctx: 'all', group: 'Moving' },
  interact: { def: 'KeyE', name: 'Interact / use / serve / pick up', ctx: 'all', group: 'Everyone' },
  attack: { def: 'Mouse0', name: 'Attack · throw · hold to mop', ctx: 'all', group: 'Everyone' },
  ping: { def: 'KeyZ', name: 'Ping a spot for the team', ctx: 'all', group: 'Everyone' },
  emote: { def: 'KeyH', name: 'Emotes (hold, then 1–4)', ctx: 'all', group: 'Everyone' },
  grab: { def: 'KeyG', name: 'Take off shelf / throw / put sign down', ctx: 'shop', group: 'Shop' },
  stock: { def: 'KeyQ', name: 'Shelf item back to stock', ctx: 'shop', group: 'Shop' },
  furniture: { def: 'KeyF', name: 'Pick up / place furniture', ctx: 'shop', group: 'Shop' },
  rotate: { def: 'KeyR', name: 'Rotate furniture', ctx: 'shop', group: 'Shop' },
  open: { def: 'KeyO', name: 'Open the store / head out at night', ctx: 'shop', group: 'Shop' },
  flashlight: { def: 'KeyF', name: 'Flashlight', ctx: 'night', group: 'Night' },
  dismantle: { def: 'KeyX', name: 'Take apart (with tools)', ctx: 'night', group: 'Night' },
  drop: { def: 'KeyG', name: 'Drop a bag item', ctx: 'night', group: 'Night' },
  bag: { def: 'Tab', name: 'Backpack (see, drop or load items)', ctx: 'night', group: 'Night' },
  crouch: { def: 'KeyC', name: 'Crouch', ctx: 'night', group: 'Night' },
  spectate: { def: 'Space', name: 'Spectate next player (down / dead)', ctx: 'night', group: 'Night' },
  roulette: { def: 'KeyR', name: 'Ghost roulette (when dead)', ctx: 'night', group: 'Night' },
  ptt: { def: 'KeyV', name: 'Push to talk', ctx: 'all', group: 'Co-op' },
  radio: { def: 'KeyB', name: 'Talk on the walkie-talkie', ctx: 'all', group: 'Co-op' },
  chat: { def: 'KeyT', name: 'Text chat', ctx: 'all', group: 'Co-op' },
  approve: { def: 'KeyY', name: 'Approve a teammate\'s purchase', ctx: 'all', group: 'Co-op' },
  deny: { def: 'KeyN', name: 'Deny a teammate\'s purchase', ctx: 'all', group: 'Co-op' },
};
const SAVE = 'chuckys_house_keys', LAYOUT = 'chuckys_house_layout';
export const K = {};
let layout = {};
try { layout = JSON.parse(localStorage.getItem(LAYOUT)) || {}; } catch { layout = {}; }
export function loadKeys() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SAVE)) || {}; } catch { saved = {}; }
  for (const [id, a] of Object.entries(ACTIONS)) K[id] = saved[id] || a.def;
}
const saveKeys = () => localStorage.setItem(SAVE, JSON.stringify(K));
loadKeys();

export const is = (id, code) => K[id] === code;

// Learn what each physical key prints on this keyboard (Firefox has no layout API).
addEventListener('keydown', e => {
  if (/^Key[A-Z]$/.test(e.code) && e.key && e.key.length === 1 && /\p{L}/u.test(e.key) && layout[e.code] !== e.key.toUpperCase()) {
    layout[e.code] = e.key.toUpperCase();
    localStorage.setItem(LAYOUT, JSON.stringify(layout));
  }
}, true);
navigator.keyboard?.getLayoutMap?.().then(m => { for (const [code, ch] of m) if (/^Key[A-Z]$/.test(code)) layout[code] = ch.toUpperCase(); }).catch(() => {});

const NAMES = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'AltGr',
  Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: 'LMB', Mouse1: 'Middle mouse', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\' };
export function codeName(code) {
  if (!code) return '—';
  if (layout[code]) return layout[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return NAMES[code] || code;
}
export const keyName = id => codeName(K[id]);
export const kb = id => `<kbd>${keyName(id)}</kbd>`;

// Which actions would clash with giving `id` the key `code`.
const overlap = (a, b) => a === 'all' || b === 'all' || a === b;
export const conflicts = (id, code) => Object.keys(ACTIONS).filter(o => o !== id && K[o] === code && overlap(ACTIONS[o].ctx, ACTIONS[id].ctx));
export function setKey(id, code, swap = true) {
  const old = K[id];
  if (swap) for (const o of conflicts(id, code)) K[o] = old;
  K[id] = code;
  saveKeys();
}
export function resetKeys() { for (const [id, a] of Object.entries(ACTIONS)) K[id] = a.def; saveKeys(); }

// Wait for the next key / mouse button (Esc cancels). Used by the Settings → Controls tab.
export function listenForKey(done) {
  const finish = code => {
    removeEventListener('keydown', kd, true); removeEventListener('mousedown', md, true);
    done(code);
  };
  const kd = e => { e.preventDefault(); e.stopImmediatePropagation(); finish(e.code === 'Escape' ? null : e.code); };
  const md = e => { if (e.target.closest?.('.bind-btn.listening')) return; e.preventDefault(); e.stopImmediatePropagation(); finish('Mouse' + e.button); };
  setTimeout(() => { addEventListener('keydown', kd, true); addEventListener('mousedown', md, true); }, 0);
}
