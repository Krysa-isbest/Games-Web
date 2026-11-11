// Everything the game remembers, kept in the browser's storage:
//   S  settings  (controls, graphics, audio)
//   P  profile   (credits, stash, loadout, skills, stats)
// Key bindings are a third store, owned by input.js.
//
// Rules that keep old saves working when later parts add things:
//   * new fields get their default value automatically (merge);
//   * a field whose type changed falls back to its default instead of breaking the game;
//   * a save that cannot be read is set aside under "<key>.corrupt", never silently deleted.
import { STORE } from './config.js';
import { bus } from './events.js';

// ---------- storage, with a memory fallback when the browser blocks it ----------
const mem = new Map();
let ls = null;
try { const t = STORE + 'probe'; localStorage.setItem(t, '1'); localStorage.removeItem(t); ls = localStorage; } catch { /* private mode / blocked */ }
export const persistent = !!ls;
const rd = k => { try { return ls ? ls.getItem(STORE + k) : (mem.get(k) ?? null); } catch { return null; } };
const wr = (k, v) => {
  if (!ls) { mem.set(k, v); return true; }
  try { ls.setItem(STORE + k, v); return true; } catch { return false; }
};

const clone = v => JSON.parse(JSON.stringify(v));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// defaults + what was saved. Unknown keys are kept (maps such as skills.nodes, or data from a newer version).
export function merge(def, got) {
  const out = clone(def);
  if (!isObj(got)) return out;
  for (const [k, v] of Object.entries(got)) {
    if (k === '__proto__') continue;
    if (!(k in def)) { out[k] = v; continue; }
    const d = def[k];
    if (isObj(d)) out[k] = merge(d, v);
    else if (d === null || (typeof d === typeof v && Array.isArray(d) === Array.isArray(v))) out[k] = v;
  }
  return out;
}

const stores = [];
// migrate(old) may upgrade a save written by an older version (it reads old.v) before it is merged.
export function makeStore(key, defaults, migrate = null) {
  let parsed = null;
  const raw = rd(key);
  if (raw) { try { parsed = JSON.parse(raw); } catch { wr(key + '.corrupt', raw); } }
  if (parsed && migrate) { try { parsed = migrate(parsed) || parsed; } catch (e) { console.warn('save migration failed', key, e); } }
  const data = merge(defaults, parsed);
  data.v = defaults.v;
  let timer = 0;
  const api = {
    key, data,
    save() {
      clearTimeout(timer); timer = 0;
      const ok = wr(key, JSON.stringify(data));
      if (!ok) bus.emit('save:error', key);
      return ok;
    },
    // for things that change often (pickups, kills): writes at most twice a second
    soon() { if (!timer) timer = setTimeout(api.save, 500); },
    pending: () => !!timer,
    // replaces the contents but keeps the same object, so `S` and `P` stay valid everywhere
    replace(obj) {
      const next = merge(defaults, obj); next.v = defaults.v;
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, next);
      api.save();
      bus.emit('save:reset', key);
    },
    reset() { api.replace(null); },
    size: () => (rd(key) || '').length,
  };
  stores.push(api);
  return api;
}
// nothing is lost when the tab is closed or hidden
function flush() { for (const s of stores) if (s.pending()) s.save(); }
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', flush);
  addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

// ---------- settings ----------
export const SETTINGS_DEFAULTS = {
  v: 1,
  // controls
  sens: 1, aimSens: 0.7, invertY: false, rawMouse: true,
  sprintMode: 'hold', crouchMode: 'hold', aimMode: 'hold',
  fullscreenPlay: true,
  // graphics (the full menu comes with the settings part; the engine already reads these)
  preset: 'high', scale: 1, dynRes: false, fpsCap: 0, fov: 75, aa: 'msaa', shadows: 'high', showFps: false,
  // audio
  vol: 0.8, music: 0.6, sfx: 1, ui: 0.7, ambient: 0.8,
};
export const PRESETS = {
  low: { scale: 0.7, aa: 'off', shadows: 'off' },
  medium: { scale: 0.85, aa: 'msaa', shadows: 'low' },
  high: { scale: 1, aa: 'msaa', shadows: 'high' },
  ultra: { scale: 1, aa: 'msaa', shadows: 'ultra' },
};

// ---------- profile ----------
export const PROFILE_DEFAULTS = {
  v: 1,
  name: 'Plunderer', color: '#a36bff',
  credits: 0,                                   // Scrap Credits
  stash: [],                                    // [{ id, n }] stackable, or [{ id, n: 1, d: {...} }] for items with their own state
  loadout: { weapon1: null, weapon2: null, melee: null, shield: null, bag: [] },
  skills: { points: 0, nodes: {} },             // nodes: { nodeId: level }
  workshop: { level: 1, known: [] },            // known: recipe ids
  stats: { raids: 0, extracted: 0, deaths: 0, kills: 0, earned: 0 },
  flags: { introSeen: false },
};

export const Stores = {
  settings: makeStore('settings', SETTINGS_DEFAULTS),
  profile: makeStore('profile', PROFILE_DEFAULTS),
};
export const S = Stores.settings.data;
export const P = Stores.profile.data;
export const saveSettings = () => Stores.settings.save();
export const saveProfile = () => Stores.profile.save();
export const saveProfileSoon = () => Stores.profile.soon();

export function applyPreset(name) {
  if (!PRESETS[name]) return;
  Object.assign(S, PRESETS[name], { preset: name });
  saveSettings();
  bus.emit('gfx');
}

// ---------- stash and credits ----------
export const Stash = {
  count(id) { let n = 0; for (const it of P.stash) if (it.id === id) n += it.n; return n; },
  total() { let n = 0; for (const it of P.stash) n += it.n; return n; },
  // d = the item's own state (durability, ammo, attachments). Items with state never stack.
  add(id, n = 1, d = null) {
    if (n <= 0) return;
    if (d) { for (let i = 0; i < n; i++) P.stash.push({ id, n: 1, d: clone(d) }); }
    else {
      const it = P.stash.find(x => x.id === id && !x.d);
      if (it) it.n += n; else P.stash.push({ id, n });
    }
    saveProfileSoon();
  },
  // takes n of an item, or nothing at all if there are not enough. Stacks go first.
  take(id, n = 1) {
    if (n <= 0 || Stash.count(id) < n) return false;
    const order = P.stash.filter(x => x.id === id).sort((a, b) => (a.d ? 1 : 0) - (b.d ? 1 : 0));
    for (const it of order) {
      const k = Math.min(it.n, n);
      it.n -= k; n -= k;
      if (it.n <= 0) P.stash.splice(P.stash.indexOf(it), 1);
      if (n <= 0) break;
    }
    saveProfileSoon();
    return true;
  },
};
export const Credits = {
  add(n) { n = Math.max(0, Math.round(n)); P.credits += n; P.stats.earned += n; saveProfileSoon(); },
  spend(n) { n = Math.round(n); if (n < 0 || P.credits < n) return false; P.credits -= n; saveProfileSoon(); return true; },
};

// ---------- backup codes: move a save between browsers, or from the local copy to the web copy ----------
const TAG = 'PP1.';
const b64 = s => btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
const unb64 = s => decodeURIComponent(Array.from(atob(s), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
export function exportSave() {
  const all = {};
  for (const s of stores) all[s.key] = s.data;
  return TAG + b64(JSON.stringify(all));
}
// returns true when the code was a valid backup. Stores missing from the code are left alone.
export function importSave(code) {
  code = String(code || '').trim();
  if (!code.startsWith(TAG)) return false;
  let all;
  try { all = JSON.parse(unb64(code.slice(TAG.length))); } catch { return false; }
  if (!isObj(all)) return false;
  for (const s of stores) if (isObj(all[s.key])) s.replace(all[s.key]);
  return true;
}
export function resetAll() { for (const s of stores) s.reset(); }
