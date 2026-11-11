// Scene manager. A scene is one "place" of the game (menu, test range, later the lobby and the raid):
//
//   {
//     scene, camera,             // what gets drawn (three.js)
//     async enter(params) {},    // build the world, show its HUD
//     exit() {},                 // remove listeners, free memory
//     fixed(dt, tick) {},        // simulation step
//     frame(dt, alpha) {},       // once per drawn frame, before drawing
//     resize(w, h) {},
//   }
//
// Scenes are registered with a function that loads them, so the heavy ones are only downloaded when needed:
//   Scenes.add('raid', () => import('../scenes/raid.js').then(m => m.default()));
import { Engine } from './engine.js';
import { bus } from './events.js';

const registry = new Map();
let cur = null, busy = false, queued = null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const fade = () => document.getElementById('fade');

export const Scenes = {
  add(name, make) { registry.set(name, make); },
  get current() { return cur; },
  get name() { return cur ? cur.name : ''; },
  get busy() { return busy; },

  // fades to black, closes the old scene, opens the new one, fades back in
  async go(name, params = {}) {
    if (busy) { queued = [name, params]; return; }
    busy = true;
    try {
      fade()?.classList.add('on');
      if (cur) {
        await wait(240);
        const old = cur; cur = null;
        try { old.exit?.(); } catch (e) { console.error(e); }
      }
      const make = registry.get(name);
      if (!make) throw new Error('Unknown scene: ' + name);
      const next = await make();
      next.name = name;
      await next.enter?.(params);
      next.resize?.(Engine.w, Engine.h);
      cur = next;
      bus.emit('scene', name);
    } catch (e) {
      console.error(e);
      bus.emit('scene:error', e);
    } finally {
      fade()?.classList.remove('on');
      busy = false;
      if (queued) { const q = queued; queued = null; Scenes.go(q[0], q[1]); }
    }
  },

  fixed(dt, tick) { cur?.fixed?.(dt, tick); },
  frame(dt, alpha) {
    if (!cur) return;
    cur.frame?.(dt, alpha);
    if (cur.scene && cur.camera) Engine.render(cur.scene, cur.camera);
  },
};
bus.on('resize', (w, h) => cur?.resize?.(w, h));
