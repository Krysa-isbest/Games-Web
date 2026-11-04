// Keyboard + mouse. `down` = held keys, `hit` = pressed this frame (cleared by endFrame()).
export const IN = { down: new Set(), hit: new Set(), mdx: 0, mdy: 0, lmb: false, rmb: false, lmbHit: false, rmbHit: false, wheel: 0, locked: false };

const canvasEl = () => document.querySelector('canvas');

export function initInput() {
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (!IN.down.has(e.code)) IN.hit.add(e.code);
    IN.down.add(e.code);
    if (['Space', 'Tab'].includes(e.code) && IN.locked) e.preventDefault();
  });
  addEventListener('keyup', e => IN.down.delete(e.code));
  addEventListener('blur', () => { IN.down.clear(); IN.lmb = IN.rmb = false; });
  addEventListener('mousemove', e => { if (IN.locked) { IN.mdx += e.movementX; IN.mdy += e.movementY; } });
  addEventListener('mousedown', e => {
    if (!IN.locked) return;
    if (e.button === 0) { IN.lmb = true; IN.lmbHit = true; }
    if (e.button === 2) { IN.rmb = true; IN.rmbHit = true; }
  });
  addEventListener('mouseup', e => { if (e.button === 0) IN.lmb = false; if (e.button === 2) IN.rmb = false; });
  addEventListener('wheel', e => { if (IN.locked) IN.wheel += Math.sign(e.deltaY); }, { passive: true });
  addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { IN.locked = document.pointerLockElement === canvasEl(); IN.onLock?.(IN.locked); });
}
// pointer lock needs a click first; when the browser refuses, the next click on the game locks it
export function lock() {
  const c = canvasEl();
  if (!c || IN.locked) return;
  try { const p = c.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* no user gesture yet */ }
}
export function unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
export function endFrame() { IN.hit.clear(); IN.mdx = IN.mdy = 0; IN.lmbHit = IN.rmbHit = false; IN.wheel = 0; }
export const key = c => IN.down.has(c);
export const pressed = c => IN.hit.has(c);
