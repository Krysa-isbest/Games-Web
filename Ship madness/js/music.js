// Music from audio/music (listed in audio/list.json). Slots: menu, sail, battle, boss.
// The right slot plays by itself: battle when an enemy ship is near or a nuke is coming. No files = silence.
import { G, S } from './state.js';

let list = null, slot = '', cur = null, old = null, fade = 0;
export async function initMusic() {
  if (list) return;
  try { list = await (await fetch('audio/list.json', { cache: 'no-store' })).json(); } catch { list = {}; }
}
function pickSlot() {
  if (!G.running) return 'menu';
  if (G.game?.node?.type === 'boss' && G.game.phase === 'sail') return 'boss';
  if (G.nuke) return 'battle';
  const me = G.me;
  if (me) {
    const p = me.worldPos();
    for (const s of G.ships) {
      if (s.sunk || s === me.frame) continue;
      const hostile = s.team === 'enemy' || (s.team !== 'neutral' && s.team !== me.team && G.mode === 'ffa');
      if (hostile && Math.hypot(s.x - p.x, s.z - p.z) < 220) return 'battle';
    }
  }
  return 'sail';
}
function start(sl) {
  const files = list?.music?.[sl] || [];
  old = cur; cur = null; fade = 0;
  if (!files.length) return;
  const a = new Audio('audio/music/' + encodeURIComponent(files[Math.random() * files.length | 0]));
  a.volume = 0;
  a.onended = () => { if (slot === sl) start(sl); };
  a.onerror = () => console.warn('Music file could not load:', a.src);
  a.play().catch(() => {});
  cur = a;
}
export function musicTick(dt) {
  if (!list) return;
  const want = pickSlot();
  // battle music lingers a bit so it doesn't flicker on and off
  if (want !== slot) {
    if (want === 'battle' || (slot === 'battle' ? (G.musicCalm = (G.musicCalm || 0) + dt) > 6 : true)) { slot = want; G.musicCalm = 0; start(slot); }
  } else G.musicCalm = 0;
  fade = Math.min(1, fade + dt / 2.5);
  const v = (S.musicVol ?? 0.5) * S.vol;
  if (cur) cur.volume = Math.min(1, v * fade);
  if (old) { old.volume = Math.max(0, v * (1 - fade)); if (fade >= 1) { old.pause(); old = null; } }
}
