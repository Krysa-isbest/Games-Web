// Input: the game asks about ACTIONS ("is sprint held?"), never about keys, so every key can be rebound.
//
//   Input.held('sprint')      the key is down right now
//   Input.pressed('reload')   it went down since the last simulation step (true for exactly one step)
//   Input.released('fire')    it came up since the last simulation step
//   Input.active('crouch')    like held, but follows the player's hold / toggle setting (sprint, crouch, aim)
//   Input.move()              WASD as a direction, x = right, y = forward, never longer than 1
//   Input.consumeLook()       mouse movement since the last call, in radians
//
// Actions only answer while the context is 'game' (the mouse is captured). With a menu open they are all
// false, so typing or clicking in a menu never moves the character. Pass raw = true to ask anyway
// (closing the inventory with the inventory key).
//
// A binding is a key code ('KeyW', 'Space'), a mouse button ('Mouse0' left, 'Mouse1' middle, 'Mouse2' right,
// 'Mouse3' / 'Mouse4' side buttons) or the wheel ('WheelUp', 'WheelDown'). Left and right Shift / Ctrl / Alt
// count as the same key.
import { S, makeStore } from './save.js';
import { bus } from './events.js';

export const ACTIONS = {
  forward:    { def: 'KeyW',    name: 'Move forward',           group: 'Movement' },
  left:       { def: 'KeyA',    name: 'Move left',              group: 'Movement' },
  back:       { def: 'KeyS',    name: 'Move backwards',         group: 'Movement' },
  right:      { def: 'KeyD',    name: 'Move right',             group: 'Movement' },
  sprint:     { def: 'Shift',   name: 'Sprint',                 group: 'Movement' },
  jump:       { def: 'Space',   name: 'Jump',                   group: 'Movement' },
  crouch:     { def: 'Control', name: 'Crouch / slide',         group: 'Movement' },
  roll:       { def: 'Alt',     name: 'Dodge roll',             group: 'Movement' },
  fire:       { def: 'Mouse0',  name: 'Shoot / throw / deploy', group: 'Combat' },
  aim:        { def: 'Mouse2',  name: 'Aim',                    group: 'Combat' },
  reload:     { def: 'KeyR',    name: 'Reload',                 group: 'Combat' },
  weapon1:    { def: 'Digit1',  name: 'Weapon 1',               group: 'Combat' },
  weapon2:    { def: 'Digit2',  name: 'Weapon 2',               group: 'Combat' },
  melee:      { def: 'Digit3',  name: 'Melee weapon',           group: 'Combat' },
  unarmed:    { def: 'KeyH',    name: 'Unarmed',                group: 'Combat' },
  interact:   { def: 'KeyE',    name: 'Interact',               group: 'Gear' },
  wheel:      { def: 'KeyQ',    name: 'Item wheel',             group: 'Gear' },
  flashlight: { def: 'KeyF',    name: 'Flashlight',             group: 'Gear' },
  inventory:  { def: 'Tab',     name: 'Inventory',              group: 'Gear' },
  map:        { def: 'KeyM',    name: 'Map',                    group: 'Team' },
  ping:       { def: 'Mouse1',  name: 'Ping',                   group: 'Team' },
};
export const GROUPS = ['Movement', 'Combat', 'Gear', 'Team'];

const DEFAULT_BINDS = { v: 1 };
for (const [a, d] of Object.entries(ACTIONS)) DEFAULT_BINDS[a] = d.def;
const keys = makeStore('keys', DEFAULT_BINDS);
export const BINDS = keys.data;

// keys the game never takes: Esc is pause / back, F3 is the debug overlay, the rest belong to the browser
const RESERVED = new Set(['Escape', 'F3', 'F5', 'F11', 'F12', 'Meta', 'ContextMenu', 'PrintScreen']);
const BROWSER = new Set(['F5', 'F11', 'F12']);
const SIDES = { ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Meta', MetaRight: 'Meta' };
const norm = code => SIDES[code] || code;

const NAMES = {
  Space: 'Space', Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Backspace',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', IntlBackslash: '\\', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel up', WheelDown: 'Wheel down',
  Insert: 'Ins', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn',
};
export function keyName(code) {
  if (!code) return '---';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
export const kn = action => keyName(BINDS[action]);

// ---------- state ----------
const down = new Set();                 // codes that are physically down
const pressedQ = new Set();             // codes that went down since the last step
const releasedQ = new Set();            // codes that came up since the last step
const TOGGLE = { sprint: 'sprintMode', crouch: 'crouchMode', aim: 'aimMode' };
const tog = { sprint: false, crouch: false, aim: false };
let ctx = 'ui', canvas = null, locked = false, lookX = 0, lookY = 0, kbLocked = false;
let cap = null, capArm = 0, swallowClick = 0;
const look = { x: 0, y: 0 }, mv = { x: 0, y: 0 };

const ok = raw => raw || ctx === 'game';
const typing = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function press(code) {
  if (down.has(code)) return;
  down.add(code); pressedQ.add(code);
  if (ctx === 'game') for (const a in TOGGLE) if (BINDS[a] === code && S[TOGGLE[a]] === 'toggle') tog[a] = !tog[a];
}
function release(code) { if (down.delete(code)) releasedQ.add(code); }
function releaseAll() {
  for (const c of down) releasedQ.add(c);
  down.clear(); pressedQ.clear();
  tog.sprint = tog.crouch = tog.aim = false;
}

// ---------- rebinding ----------
// Gives `action` a new key. If another action already uses it, the two swap, so nothing ends up without a key.
export function setBind(action, code) {
  let swapped = null;
  if (code) for (const o of Object.keys(ACTIONS)) if (o !== action && BINDS[o] === code) { BINDS[o] = BINDS[action]; swapped = o; }
  BINDS[action] = code;
  keys.save();
  bus.emit('input:binds');
  return { code, swapped };
}
export function resetBinds() {
  for (const [a, d] of Object.entries(ACTIONS)) BINDS[a] = d.def;
  keys.save();
  bus.emit('input:binds');
}
// actions that share a key with this one (only possible in a hand-edited or imported save)
export const clashes = action => Object.keys(ACTIONS).filter(o => o !== action && BINDS[o] && BINDS[o] === BINDS[action]);
// Waits for the next key, mouse button or wheel move and binds it. Resolves to { code, swapped }, or null if
// cancelled with Esc. Delete or Backspace clears the binding.
export function capture(action) {
  if (cap) finishCapture(null);
  return new Promise(res => { cap = { action, res }; capArm = performance.now() + 150; });
}
export const capturing = () => !!cap;
function finishCapture(code) {
  const c = cap; cap = null;
  if (!c) return;
  c.res(code === null ? null : setBind(c.action, code));
}

// ---------- events ----------
function onKeyDown(e) {
  const code = norm(e.code);
  if (!code) return;
  if (cap) {
    if (BROWSER.has(code)) return;
    e.preventDefault(); e.stopPropagation();
    if (code === 'Escape') finishCapture(null);
    else if (code === 'Delete' || code === 'Backspace') finishCapture('');
    else if (!RESERVED.has(code)) finishCapture(code);
    return;
  }
  if (typing(e.target)) { if (code === 'Escape') e.target.blur(); return; }
  if (code === 'Escape') { if (!e.repeat) bus.emit('input:escape'); return; }
  if (code === 'F3') { e.preventDefault(); if (!e.repeat) bus.emit('input:debug'); return; }
  // In the game the browser gets nothing (Tab, Space, Alt, Ctrl+S, Ctrl+D...). Ctrl+W cannot be stopped from
  // a normal window: only fullscreen with the keyboard lock (see fullscreen below) keeps it away.
  if (ctx === 'game') { if (!BROWSER.has(code)) e.preventDefault(); }
  else if (code === 'Alt') e.preventDefault();                 // Alt alone would focus the browser's menu
  if (!e.repeat) press(code);
}
function onKeyUp(e) {
  const code = norm(e.code);
  if (!code) return;
  if (code === 'Alt') e.preventDefault();
  release(code);
}
function onMouseDown(e) {
  const code = 'Mouse' + e.button;
  if (cap) {
    if (performance.now() < capArm) return;
    e.preventDefault(); e.stopPropagation();
    swallowClick = performance.now() + 400;                     // the click that follows must not press a button
    finishCapture(code);
    return;
  }
  if (!locked && e.target !== canvas) return;                   // clicks on menus are not game input
  if (e.button !== 0) e.preventDefault();                       // no middle-click scrolling, no back / forward
  press(code);
}
function onMouseUp(e) {
  if (e.button >= 3 && (locked || e.target === canvas)) e.preventDefault();
  release('Mouse' + e.button);
}
function onClickCapture(e) {
  if (performance.now() < swallowClick) { swallowClick = 0; e.preventDefault(); e.stopPropagation(); }
}
function onContextMenu(e) { if (locked || e.target === canvas || cap || performance.now() < swallowClick) e.preventDefault(); }
function onWheel(e) {
  if (!e.deltaY) return;
  const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (cap) { if (performance.now() >= capArm) finishCapture(code); return; }
  if (locked) pressedQ.add(code);                               // the wheel has no "held": it is a press only
}
function onMouseMove(e) {
  if (!locked) return;
  const x = e.movementX || 0, y = e.movementY || 0;
  if (Math.abs(x) > 600 || Math.abs(y) > 600) return;           // browsers sometimes report one huge bogus jump
  lookX += x; lookY += y;
}
function onLockChange() {
  locked = !!canvas && document.pointerLockElement === canvas;
  lookX = lookY = 0;
  bus.emit('input:lock', locked);
}
function onFullscreenChange() {
  const kb = navigator.keyboard;
  if (document.fullscreenElement) {
    // With the keyboard lock the game also receives Ctrl+W, Ctrl+T, Ctrl+N and Esc (hold Esc to leave fullscreen).
    if (kb?.lock) kb.lock().then(() => { kbLocked = true; }, () => { kbLocked = false; });
  } else { kb?.unlock?.(); kbLocked = false; }
}

export const Input = {
  init(canvasEl) {
    canvas = canvasEl;
    addEventListener('keydown', onKeyDown, true);
    addEventListener('keyup', onKeyUp, true);
    addEventListener('mousedown', onMouseDown, true);
    addEventListener('mouseup', onMouseUp, true);
    addEventListener('click', onClickCapture, true);
    addEventListener('auxclick', onClickCapture, true);
    addEventListener('contextmenu', onContextMenu, true);
    addEventListener('wheel', onWheel, { passive: true });
    addEventListener('mousemove', onMouseMove);
    addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    bus.on('save:reset', key => { if (key === 'keys') bus.emit('input:binds'); });
  },

  held: (a, raw = false) => ok(raw) && down.has(BINDS[a]),
  pressed: (a, raw = false) => ok(raw) && pressedQ.has(BINDS[a]),
  released: (a, raw = false) => ok(raw) && releasedQ.has(BINDS[a]),
  active(a) {
    const mode = TOGGLE[a];
    return mode && S[mode] === 'toggle' ? ctx === 'game' && tog[a] : Input.held(a);
  },
  // switches a toggled action off (sprint ends when the player stops, aim ends on a weapon swap)
  cancel(a) { if (a in tog) tog[a] = false; },
  // the returned object is reused: read it, do not keep it
  move() {
    let x = (Input.held('right') ? 1 : 0) - (Input.held('left') ? 1 : 0);
    let y = (Input.held('forward') ? 1 : 0) - (Input.held('back') ? 1 : 0);
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    mv.x = x; mv.y = y;
    return mv;
  },
  // radians turned since the last call. scale = extra factor (aim sensitivity). The object is reused.
  consumeLook(scale = 1) {
    const k = 0.0022 * S.sens * scale;
    look.x = lookX * k; look.y = lookY * k * (S.invertY ? -1 : 1);
    lookX = lookY = 0;
    return look;
  },
  // called by the loop after every simulation step: a press is seen by exactly one step
  endTick() { pressedQ.clear(); releasedQ.clear(); },

  get context() { return ctx; },
  setContext(c) {
    if (c === ctx) return;
    ctx = c;
    pressedQ.clear(); releasedQ.clear();
    tog.sprint = tog.crouch = tog.aim = false;
    bus.emit('input:context', c);
  },

  // ---------- mouse capture ----------
  get locked() { return locked; },
  // Needs a click or key press just before it (browser rule). Resolves to true when the mouse was captured.
  async lock() {
    if (!canvas) return false;
    if (document.pointerLockElement === canvas) return true;
    const tryLock = async opts => { const p = opts ? canvas.requestPointerLock(opts) : canvas.requestPointerLock(); if (p?.then) await p; };
    try { await tryLock(S.rawMouse ? { unadjustedMovement: true } : null); }
    catch { try { await tryLock(null); } catch { return false; } }
    return true;
  },
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); },

  // ---------- fullscreen + keyboard lock ----------
  async fullscreen(on = true) {
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
      return true;
    } catch { return false; }
  },
  get isFullscreen() { return !!document.fullscreenElement; },
  // true when browser shortcuts such as Ctrl+W can no longer reach the browser
  get keysSafe() { return kbLocked; },
  // asks "Leave site?" before the tab closes: the safety net for Ctrl+W during a raid
  guard(on) { window.onbeforeunload = on ? e => { e.preventDefault(); e.returnValue = ''; return ''; } : null; },

  // for the debug overlay and the key tester
  heldActions() { return Object.keys(ACTIONS).filter(a => down.has(BINDS[a])); },
};
