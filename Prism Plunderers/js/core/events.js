// A tiny event bus. Modules talk through it so they do not have to import each other.
//
// Events used by the foundation:
//   resize (w, h)        the window changed size
//   gfx                  a graphics setting changed
//   gfx:lost / gfx:restored   the WebGL context was lost / came back
//   scene (name)         a scene finished loading        scene:error (err)
//   input:lock (bool)    the mouse was captured / released
//   input:escape         Esc was pressed
//   input:debug          F3 was pressed
//   input:binds          a key binding changed
//   input:context (ctx)  'game' or 'ui'
//   save:error (key)     the browser refused to store data
//   save:reset (key)     a store was reset or restored from a backup
//   ui (id)              a menu screen opened ('' when all are closed)
export function emitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);      // call the returned function to stop listening
    },
    off(type, fn) { map.get(type)?.delete(fn); },
    emit(type, ...args) {
      const set = map.get(type);
      if (set) for (const fn of [...set]) fn(...args);
    },
  };
}
export const bus = emitter();
