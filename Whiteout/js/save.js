// Whiteout: saved games, kept in the browser. One for solo and one for co-op (the host's browser holds it).
// What is in a save is put together in sync.js: the world, and every player's own things by name.
const KEY = { solo: 'whiteout.save.solo', coop: 'whiteout.save.coop' };

export function readSave(kind) {
  try { const s = JSON.parse(localStorage.getItem(KEY[kind])); return s && s.v === 1 && s.world ? s : null; } catch { return null; }
}
export function writeSave(kind, s) {
  try { localStorage.setItem(KEY[kind], JSON.stringify(s)); return true; } catch (e) { console.warn('could not save', e); return false; }
}
// "Day 2 · 09:15, saved 12/11/2026, 18:02"
export function saveLabel(s) {
  let when = '';
  try { when = new Date(s.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch { /* no date */ }
  return `Day ${s.day} · ${s.clock}${when ? ', saved ' + when : ''}`;
}
