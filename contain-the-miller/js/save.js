// Save slots in localStorage. Each slot holds one full game state.
const KEY = 'ctm_save_';
const LAST = 'ctm_last_slot';
export const SLOTS = 3;

function safe(fn, fallback = null) { try { return fn(); } catch { return fallback; } }

export function listSaves() {
  return Array.from({ length: SLOTS }, (_, i) => {
    const raw = safe(() => localStorage.getItem(KEY + i));
    const d = raw ? safe(() => JSON.parse(raw)) : null;
    return d ? { slot: i, savedAt: d.savedAt, day: d.world?.day, money: d.inventory?.money, monkeys: d.monkeys?.filter((m) => m.state === 'caged').length } : { slot: i, empty: true };
  });
}

export function writeSave(slot, data) {
  data.savedAt = Date.now();
  const ok = safe(() => { localStorage.setItem(KEY + slot, JSON.stringify(data)); localStorage.setItem(LAST, String(slot)); return true; }, false);
  return ok;
}

export function readSave(slot) {
  const raw = safe(() => localStorage.getItem(KEY + slot));
  return raw ? safe(() => JSON.parse(raw)) : null;
}

export function deleteSave(slot) { safe(() => localStorage.removeItem(KEY + slot)); }

export function lastSlot() {
  const s = safe(() => localStorage.getItem(LAST));
  if (s === null || s === undefined) return null;
  return readSave(Number(s)) ? Number(s) : null;
}

const SETTINGS_KEY = 'ctm_settings';
export const DEFAULT_SETTINGS = { sensitivity: 1, invertY: false, fov: 75, volume: 0.8, quality: 'medium', showFps: false };

export function loadSettings() {
  const raw = safe(() => localStorage.getItem(SETTINGS_KEY));
  return { ...DEFAULT_SETTINGS, ...(raw ? safe(() => JSON.parse(raw), {}) : {}) };
}

export function saveSettings(s) { safe(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))); }

export function getPref(k, def) { const v = safe(() => localStorage.getItem('ctm_pref_' + k)); return v === null || v === undefined ? def : v; }
export function setPref(k, v) { safe(() => localStorage.setItem('ctm_pref_' + k, v)); }
