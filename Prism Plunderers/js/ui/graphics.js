// The Graphics screen (part 7, DESIGN 14.2 and 14.2a "Settings for slower PCs"): a preset, then every setting on
// its own. Each change is saved and applied at once (Engine.applyGraphics: the render size, the shadows, the
// world's distances), except anti-aliasing (a page reload) and the texture quality (the next time a map loads).
// Changing one setting by hand makes the preset Custom.
import { S, saveSettings, applyPreset } from '../core/save.js';
import { Engine, GFX } from '../core/engine.js';
import { $ } from '../core/util.js';
import { UI } from './screens.js';
import { seg, toggle, slider, row, heading } from './widgets.js';

const PRESET_OPTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']];
const m = k => `${k} m`;
let presetBox = null;

export function initGraphics() {
  UI.onOpen('graphics', render);
}

// one setting changed by hand
function changed(key) {
  if (S.preset !== 'custom') { S.preset = 'custom'; saveSettings(); }
  if (presetBox) for (const [i, b] of [...presetBox.children].entries()) b.classList.toggle('on', PRESET_OPTS[i][0] === S.preset);
  Engine.applyGraphics();
  if (key === 'aa') UI.toast('Anti-aliasing changes after you reload the page (F5).');
  if (key === 'textures') UI.toast('Texture quality changes the next time a map loads.');
}
function pickPreset() {
  if (S.preset !== 'custom') applyPreset(S.preset);
  Engine.applyGraphics();
  render();                                                // every row shows the preset's values
}

export function render() {
  const body = $('gx-body');
  body.innerHTML = '';
  presetBox = seg('preset', PRESET_OPTS, pickPreset);
  body.append(
    heading('Preset'),
    row('Quality', presetBox, 'Sets everything below at once. Low is for slower PCs; Ultra needs a strong graphics card.'),
    heading('Screen'),
    row('Render scale', slider('scale', { min: 0.5, max: 1.5, step: 0.05, fmt: v => Math.round(v * 100) + '%' }, changed), 'Below 100 % draws fewer pixels: much faster, a little softer. Above 100 % is sharper and slower.'),
    row('Dynamic resolution', toggle('dynRes', changed), 'Lowers the render scale by itself when the frame rate drops below the target (the cap, or 60), and raises it again when there is room.'),
    row('Frame rate cap', seg('fpsCap', [[0, 'Off'], [30, '30'], [60, '60'], [120, '120'], [144, '144']], changed), 'A cap keeps a fast PC cooler and quieter.'),
    row('Show FPS', toggle('showFps', changed)),
    row('Field of view', slider('fov', { min: 70, max: 110, step: 1, fmt: v => v + '°' }, changed), 'Horizontal, measured on a 16:9 screen.'),
    row('Anti-aliasing', seg('aa', [['off', 'Off'], ['msaa', 'MSAA']], changed), 'Smooths jagged edges. Changes after a page reload.'),
    heading('Shadows'),
    row('Shadow quality', seg('shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']], changed), 'Off is the biggest saving on a slow graphics card.'),
    row('Shadow distance', seg('shadowDist', [['near', 'Near'], ['medium', 'Medium'], ['far', 'Far']], changed), 'How far round you shadows are drawn.'),
    heading('Textures'),
    row('Texture quality', seg('textures', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], changed), 'The size of the road, pavement and ground textures: less graphics memory. Changes the next time a map loads.'),
    row('Texture filtering', seg('aniso', [[1, 'Off'], [4, '4x'], [8, '8x'], [16, '16x']], changed), 'Keeps the roads sharp when you look along them.'),
    row('Ground detail', seg('groundDetail', [['low', 'Low'], ['high', 'High']], changed), 'Low leaves out the oil, cracks, scorch, litter and sand drawn on the ground.'),
    heading('World'),
    row('View distance', seg('view', [['near', 'Near'], ['medium', 'Medium'], ['far', 'Far']], changed), `How far the city is drawn (${m(GFX.view.near)}, ${m(GFX.view.medium)} or ${m(GFX.view.far)}).`),
    row('Detail distance', seg('detail', [['near', 'Near'], ['medium', 'Medium'], ['far', 'Far']], changed), `How far small things and what is inside rooms are drawn (${m(GFX.detail.near)}, ${m(GFX.detail.medium)} or ${m(GFX.detail.far)}).`),
    row('Windows', toggle('panes', changed), 'The glass in about 10,000 windows. Off leaves the frames open.'),
    row('Effects', seg('effects', [['low', 'Low'], ['high', 'High']], changed), 'Sparks and smoke from shots, hits and explosions. Low has about half.'),
  );
}
