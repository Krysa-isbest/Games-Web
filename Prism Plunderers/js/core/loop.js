// The main loop.
//   fixed(dt, tick)    the simulation: always the same dt (1/60 s), as many times as real time needs
//   afterStep()        runs after every simulation step (input clears its "pressed" flags here)
//   frame(dt, alpha)   drawing: once per displayed frame. alpha (0..1) is how far we are between the last two
//                      simulation steps, so positions can be blended and motion stays smooth on any monitor.
//
// A browser stops drawing a hidden tab. With Loop.background = true (a host in a raid) the simulation keeps
// running there, driven by a worker timer, so the robots do not freeze for everyone when the host alt-tabs.
import { TICK, MAX_STEPS, BG_HZ } from './config.js';
import { S } from './save.js';

let fixed = () => {}, frame = () => {}, afterStep = () => {};
let raf = 0, last = 0, acc = 0, lastDraw = 0, worker = null;
let fCount = 0, fTime = 0, simAcc = 0, drawAcc = 0;

export const Loop = {
  running: false,
  tick: 0,                // simulation steps since the start
  alpha: 0,
  background: false,
  stats: { fps: 0, ms: 0, sim: 0, draw: 0 },     // FPS, ms per frame, ms of simulation and of drawing per frame

  start(h = {}) {
    if (h.fixed) fixed = h.fixed;
    if (h.frame) frame = h.frame;
    if (h.afterStep) afterStep = h.afterStep;
    if (Loop.running) return;
    Loop.running = true;
    last = fTime = lastDraw = performance.now(); acc = 0;
    raf = requestAnimationFrame(onFrame);
    document.addEventListener('visibilitychange', onVisibility);
  },
  stop() {
    Loop.running = false;
    cancelAnimationFrame(raf);
    background(false);
    document.removeEventListener('visibilitychange', onVisibility);
  },
};

function advance(now, maxSteps) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt < 0) dt = 0; else if (dt > 0.25) dt = 0.25;      // after a freeze, do not try to replay all of it
  acc += dt;
  const t0 = performance.now();
  let n = 0;
  while (acc >= TICK && n < maxSteps) { fixed(TICK, Loop.tick++); afterStep(); acc -= TICK; n++; }
  if (acc >= TICK) acc = 0;                                // too slow to keep up: drop the backlog
  simAcc += performance.now() - t0;
  return dt;
}

function onFrame(now) {
  raf = requestAnimationFrame(onFrame);
  const cap = S.fpsCap | 0;
  if (cap > 0) {
    const min = 1000 / cap, el = now - lastDraw;
    if (el < min - 1) return;
    lastDraw = now - (el % min);
  }
  const dt = advance(now, MAX_STEPS);
  Loop.alpha = acc / TICK;
  const t0 = performance.now();
  frame(dt, Loop.alpha);
  drawAcc += performance.now() - t0;

  fCount++;
  if (now - fTime >= 500) {
    const s = Loop.stats, span = now - fTime;
    s.fps = Math.round(fCount * 1000 / span); s.ms = span / fCount; s.sim = simAcc / fCount; s.draw = drawAcc / fCount;
    fCount = 0; fTime = now; simAcc = drawAcc = 0;
  }
}

function onVisibility() {
  if (document.hidden) { if (Loop.background && Loop.running) background(true); }
  else { background(false); last = performance.now(); }
}
function background(on) {
  if (on && !worker) {
    try {
      const src = 'let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = () => { if (document.hidden && Loop.running) advance(performance.now(), 15); };
    } catch { worker = null; }
  }
  worker?.postMessage(on ? 1000 / BG_HZ : 0);
}
