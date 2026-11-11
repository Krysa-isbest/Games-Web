// Shared state, settings (saved in the browser) and small helpers.
export const VERSION = 'Prototype v0.3';

export const G = {
  net: { role: 'solo', id: 'p0' },     // solo | host | guest
  lobby: { players: [], opts: { diff: 'normal', island: 'random', ff: '0' } },
  screen: 'splash',
};

const SKEY = 'whiteout.settings';
export const DEFAULTS = {
  name: 'Survivor', coat: '#b4462e',
  // general
  fov: 80, sens: 1, invertY: false, headBob: true, hints: true, subtitles: true, temp: 'c',
  // graphics
  preset: 'high', scale: 1, shadows: 'high', snow: 'high', fog: 'medium', view: 'far', aa: true, bloom: true, grain: true, frost: true, fps: false,
  // audio
  vol: 0.8, menuMusic: 0.25, music: 0.6, sfx: 1, wind: 0.8, ui: 0.6,
  voice: true, voiceMode: 'ptt', mic: '', micVol: 1, voiceVol: 1, noise: true,
  // controls
  sprintMode: 'hold', crouchMode: 'hold', walkMode: 'hold',
  // network
  netWay: 'peer', custom: false, sHost: '', sPort: 9000, sPath: '/', sSecure: false,
};
export const PRESETS = {
  low: { scale: 0.65, shadows: 'off', snow: 'low', fog: 'low', view: 'near', aa: false, bloom: false, grain: false },
  medium: { scale: 0.85, shadows: 'low', snow: 'medium', fog: 'medium', view: 'mid', aa: true, bloom: true, grain: true },
  high: { scale: 1, shadows: 'high', snow: 'high', fog: 'medium', view: 'far', aa: true, bloom: true, grain: true },
  ultra: { scale: 1, shadows: 'ultra', snow: 'ultra', fog: 'high', view: 'far', aa: true, bloom: true, grain: true },
};
export const S = Object.assign({}, DEFAULTS, load(SKEY));
// the menu song used to start at 60 %: move saved copies of that old default down to the new one
if (!S.v2) { if (S.menuMusic === 0.6) S.menuMusic = DEFAULTS.menuMusic; S.v2 = true; }
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch { /* private mode */ } }
function load(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } }

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
