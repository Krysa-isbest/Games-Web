// F3: the debug overlay (frame times, draw calls, input state, save sizes). Also the small FPS counter.
import { TICK_HZ } from '../core/config.js';
import { Loop } from '../core/loop.js';
import { Engine } from '../core/engine.js';
import { Scenes } from '../core/scenes.js';
import { Input } from '../core/input.js';
import { S, Stores, persistent } from '../core/save.js';
import { bus } from '../core/events.js';
import { $ } from '../core/util.js';

let on = false, next = 0;
const k = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

export const Debug = {
  init() {
    bus.on('input:debug', () => { on = !on; $('debug').classList.toggle('hidden', !on); next = 0; });
  },
  frame() {
    const now = performance.now();
    if (now < next) return;
    next = now + 250;
    const s = Loop.stats, fps = $('fps');
    fps.classList.toggle('hidden', !S.showFps || on);
    if (S.showFps && !on) fps.textContent = s.fps + ' FPS';
    if (!on) return;
    const i = Engine.info, r = Engine.renderer;
    $('debug').textContent = [
      `FPS ${s.fps}   ${s.ms.toFixed(1)} ms   (sim ${s.sim.toFixed(2)}  draw ${s.draw.toFixed(2)})`,
      `tick ${Loop.tick}   ${TICK_HZ} Hz   scene ${Scenes.name || '-'}${Loop.background ? '   background on' : ''}`,
      `draw calls ${i.calls}   tris ${k(i.tris)}   geometries ${i.geo}   textures ${i.tex}`,
      `${r.domElement.width}x${r.domElement.height}   scale ${S.scale.toFixed(2)} x dyn ${Engine.dyn.toFixed(2)}   aa ${Engine.aa}   shadows ${S.shadows}`,
      `input ${Input.context}   mouse ${Input.locked ? 'captured' : 'free'}   fullscreen ${Input.isFullscreen ? 'yes' : 'no'}   key lock ${Input.keysSafe ? 'yes' : 'no'}`,
      `held  ${Input.heldActions().join(' ') || '-'}`,
      `save  ${persistent ? 'browser storage' : 'MEMORY ONLY'}   settings ${Stores.settings.size()} B   profile ${Stores.profile.size()} B`,
    ].join('\n');
  },
};
