// Shared game state, settings, profile and small helpers.
export const VERSION = 'Prototype v0.6.8';

export const G = {
  scene: null, camera: null, renderer: null, sun: null,
  t: 0, dt: 0, running: false, paused: false, mode: 'menu',
  ships: [], sharks: [], crates: [], bots: [], items: [], c4s: [], players: [],
  me: null,               // the local player
  seaAmp: 1,              // sea state multiplier (admin: calm / normal / storm)
  admin: { open: false, god: false, infAmmo: false, drops: true, everyone: false },
  nuke: null,             // { x, z, t } while a nuke is armed
  dropT: 25,
  game: null,             // the running mode (sandbox / ffa / campaign) object
  net: { role: 'solo', id: 'p0' },   // solo | host | guest; my player id (host = p0)
  voxOut: [],             // host: voxel changes to send this frame
  ff: true,               // friendly fire between players
};
export const isGuest = () => G.net.role === 'guest';
export const isHost = () => G.net.role === 'host';
export const isOnline = () => G.net.role !== 'solo';
let uidN = 1000;
export const nextId = () => ++uidN;
export function bumpId(id) { if (typeof id === 'number' && id > uidN) uidN = id; }

// ---------- settings ----------
const SKEY = 'shipmadness.settings';
export const S = Object.assign({
  sens: 1, invertY: false, fov: 75, showFps: false,
  vol: 0.7, sfxVol: 1, ambVol: 1, musicVol: 0.5, menuVol: 0.6,
  preset: 'high', scale: 1, shadows: 'high', ocean: 'high', particles: 'normal', view: 'far', aa: true,
  voice: true, voiceMode: 'ptt', mic: '', micVol: 1, voiceVol: 1, noise: true,
}, safeLoad(SKEY));
if (typeof S.shadows === 'boolean') S.shadows = S.shadows ? 'high' : 'off';
export const PRESETS = {
  low: { scale: 0.7, shadows: 'off', ocean: 'low', particles: 'low', view: 'near', aa: false },
  medium: { scale: 0.85, shadows: 'low', ocean: 'medium', particles: 'normal', view: 'mid', aa: true },
  high: { scale: 1, shadows: 'high', ocean: 'high', particles: 'normal', view: 'far', aa: true },
  ultra: { scale: 1, shadows: 'ultra', ocean: 'ultra', particles: 'high', view: 'far', aa: true },
};
export function saveSettings() { localStorage.setItem(SKEY, JSON.stringify(S)); }

// ---------- profile ----------
// Every mode has its own level, Ferryman Tokens (FT), unlocks and kit. Sandbox owns everything.
const PKEY = 'shipmadness.profile3';
export const newKit = () => ({
  ship: 'tug',
  ships: { tug: { guns: 0, armor: 0, pump: 0, engine: 0 } },   // modern ships come without guns: buy them
  loadout: { primary: 'smg', secondary: 'pistol', gadget: 'grenade', skill: 'carpenter' },
  att: {},                  // weapon id -> { optic, muzzle, mag, grip }
});
export const newProg = () => ({ xp: 0, ft: 250, owned: ['pistol', 'smg', 'grenade', 'tug', 'carpenter'], kit: newKit() });
export const P = Object.assign({
  name: 'Sailor',
  hull: '#1f3d5c', trim: '#f2f2ee', sail: '#d8392b', shirt: '#2f6fb3',
  prog: { ffa: newProg(), camp: newProg() },
  sandbox: { ...newKit(), ship: 'ferry', ships: { ferry: { guns: 2, armor: 0, pump: 0, engine: 0 } }, loadout: { primary: 'ak', secondary: 'pistol', gadget: 'c4', skill: 'carpenter' } },
}, safeLoad(PKEY));
export function saveProfile() { localStorage.setItem(PKEY, JSON.stringify(P)); }

function safeLoad(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } }

// ---------- helpers ----------
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.random() * arr.length | 0];
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const MAP_HALF = 420;   // the playable ocean is 840 x 840 m
