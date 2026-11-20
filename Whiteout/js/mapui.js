// Whiteout: the map, the journal and pings (step 7e).
//  * The map (M): a hand-drawn chart of the island that fills in as you walk (what you have seen within about 60 m is
//    drawn, the rest is blank paper); the shack and the wreck from the start, every place once you have found it,
//    guide ropes, your crew, pings, and you. Kept in your record (`ex`).
//  * The journal (J): the objectives, the diary the host writes every morning, and what you have read (the journals,
//    the hunter's note, the den plan), to open again.
//  * Ping (the middle mouse button): a marker where you look, for the whole crew, for 10 seconds (and on the map).
import * as THREE from 'three';
import { G, S, esc } from './state.js';
import { kn, BINDS } from './keys.js';
import { on, send } from './net.js';
import * as ISL from './island.js';
import { glowTex } from './scene.js';
import * as SFX from './sfx.js';
import { GOALS } from './obj.js';
import { openBook } from './craft.js';

let GM = null, H = null;            // the game, and helpers from game.js: { lock, hint }
const N = 64, CELL = ISL.SIZE / N, PX = 512, _v = new THREE.Vector3();

export function initMapUI(gm, helpers) {
  GM = gm; H = helpers;
  gm.explored ??= new Uint8Array(N * N);
  gm.read ??= new Set();
  gm.pings = []; gm.mapOpen = false; gm.journalOpen = false; gm.exT = 0; gm.jTab = 'goals';
  gm.dom.root.insertAdjacentHTML('beforeend', `<div class="gm-map hidden"><div class="gm-mapbox"><canvas width="${PX}" height="${PX}"></canvas><small>${kn('map')} or Esc closes · the map fills in as you explore</small></div></div>
    <div class="gm-journal hidden"><div class="panel"><header class="p-head"><h2>Journal</h2><span class="p-sub">${kn('journal')} or Esc closes</span></header>
      <div class="seg gj-tabs"><button data-j="goals">Objectives</button><button data-j="diary">Diary</button><button data-j="read">What you read</button></div><div class="gj-body"></div></div></div>`);
  const q = s => gm.dom.root.querySelector(s);
  Object.assign(gm.dom, { map: q('.gm-map'), mapC: q('.gm-map canvas'), journal: q('.gm-journal'), jBody: q('.gj-body') });
  gm.dom.journal.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { gm.jTab = b.dataset.j; renderJournal(gm); });
  gm.dom.jBody.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) { closeJournal(gm, false); openRead(gm, b.dataset.open); } });
}
const uiOpen = gm => gm.mapOpen || gm.journalOpen;
export const mapUIOpen = uiOpen;

// ---------- keys (game.js asks first); true = used ----------
export function mapKey(gm, e) {
  if (e.repeat) return false;
  if (gm.mapOpen && (e.code === 'Escape' || e.code === BINDS.map)) { e.preventDefault(); closeMap(gm); return true; }
  if (gm.journalOpen && (e.code === 'Escape' || e.code === BINDS.journal)) { e.preventDefault(); closeJournal(gm); return true; }
  if (uiOpen(gm)) return true;
  if (!gm.locked || gm.bagOpen || gm.bookOpen || gm.chatOpen) return false;
  if (e.code === BINDS.map) { e.preventDefault(); openMap(gm); return true; }
  if (e.code === BINDS.journal) { e.preventDefault(); openJournal(gm); return true; }
  return false;
}
function openMap(gm) { gm.mapOpen = true; gm.inp.clear(); gm.dom.map.classList.remove('hidden'); drawMap(gm); document.exitPointerLock?.(); SFX.page?.(); }
function closeMap(gm) { gm.mapOpen = false; gm.dom.map.classList.add('hidden'); H.lock(gm); }
function openJournal(gm) { gm.journalOpen = true; gm.inp.clear(); gm.dom.journal.classList.remove('hidden'); renderJournal(gm); document.exitPointerLock?.(); SFX.page?.(); }
function closeJournal(gm, relock = true) { gm.journalOpen = false; gm.dom.journal.classList.add('hidden'); if (relock) H.lock(gm); }
export function closeMapUI(gm) { if (gm.mapOpen) closeMap(gm); if (gm.journalOpen) closeJournal(gm); }

// ---------- every frame ----------
export function mapTick(gm, dt) {
  const p = gm.player;
  gm.exT -= dt;
  if (gm.exT <= 0) {               // what you can see around you goes on the map
    gm.exT = 0.5;
    const cx = Math.floor((p.pos.x + ISL.SIZE / 2) / CELL), cz = Math.floor((p.pos.z + ISL.SIZE / 2) / CELL), r = Math.ceil(60 / CELL);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { if (i * i + j * j > r * r) continue; const x = cx + i, z = cz + j; if (x >= 0 && z >= 0 && x < N && z < N) gm.explored[z * N + x] = 1; }
  }
  // pings fade
  for (const pg of [...gm.pings]) { pg.t -= dt; if (pg.m) pg.m.material.opacity = Math.min(1, pg.t / 2); if (pg.t <= 0) { if (pg.m) gm.scene.remove(pg.m); gm.pings.splice(gm.pings.indexOf(pg), 1); } }
  if (gm.mapOpen) { gm.mapRedraw = (gm.mapRedraw || 0) - dt; if (gm.mapRedraw <= 0) { gm.mapRedraw = 0.25; drawMap(gm); } }
}

// ---------- the map ----------
let BASE = null;
function base(gm) {
  if (BASE) return BASE;
  const c = document.createElement('canvas'); c.width = c.height = PX;
  const x = c.getContext('2d'), img = x.createImageData(PX, PX), w = gm.world, s = ISL.SIZE / PX;
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
    const wx = -ISL.SIZE / 2 + (i + 0.5) * s, wz = -ISL.SIZE / 2 + (j + 0.5) * s, h = w.groundY(wx, wz), k = (j * PX + i) * 4;
    let r, g, b;
    if (h < ISL.SEA) { const d = Math.min(1, (ISL.SEA - h) / 4); r = 196 - d * 30; g = 214 - d * 22; b = 222 - d * 10; }        // the sea ice
    else { const t = Math.min(1, h / 50), sl = w.slopeY(wx, wz); r = 236 - t * 40 - (1 - sl) * 120; g = 228 - t * 42 - (1 - sl) * 115; b = 212 - t * 40 - (1 - sl) * 100; }   // the land, darker up high and on steep banks
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = 'rgba(40,70,45,0.75)';
  for (let t = 0; t < w.trees.length; t += 2) { const tr = w.trees[t]; if (tr.gone) continue; x.fillRect((tr.x + ISL.SIZE / 2) / s - 1, (tr.z + ISL.SIZE / 2) / s - 1, 2, 2); }
  // coast line, ink-like
  x.strokeStyle = 'rgba(60,50,40,0.5)'; x.lineWidth = 1;
  BASE = c;
  return c;
}
const toMap = (x, z) => [(x + ISL.SIZE / 2) / ISL.SIZE * PX, (z + ISL.SIZE / 2) / ISL.SIZE * PX];
function drawMap(gm) {
  const c = gm.dom.mapC, x = c.getContext('2d'), p = gm.player, w = gm.world;
  x.drawImage(base(gm), 0, 0);
  // unexplored: blank paper
  x.fillStyle = '#e6dcc4';
  const cs = PX / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (!gm.explored[j * N + i]) x.fillRect(i * cs - 0.5, j * cs - 0.5, cs + 1, cs + 1);
  // the ropes
  x.strokeStyle = '#8a6a2a'; x.lineWidth = 2; x.setLineDash([4, 3]);
  for (const r of gm.ropes || []) { const [a, b] = toMap(r[1], r[3]), [c2, d] = toMap(r[4], r[6]); x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke(); }
  x.setLineDash([]);
  // places: the shack and the wreck always, the rest once found
  const mark = (px, pz, label, col = '#3a2a1e') => { const [a, b] = toMap(px, pz); x.fillStyle = col; x.beginPath(); x.arc(a, b, 4.5, 0, 6.28); x.fill(); x.font = 'italic 600 13px Georgia, serif'; x.fillStyle = '#2b2218'; x.fillText(label, a + 7, b + 4); };
  mark(ISL.SHACK.x, ISL.SHACK.z, 'The shack', '#a3201c'); mark(ISL.WRECK.x, ISL.WRECK.z, 'The wreck');
  for (const pl of w.places || []) if (gm.seen?.has(pl.id)) mark(pl.pos.x, pl.pos.z, pl.name.replace(/^The /, 'The '));
  // pings, the crew, you
  for (const pg of gm.pings) { const [a, b] = toMap(pg.p.x, pg.p.z); x.strokeStyle = pg.col; x.lineWidth = 2; x.beginPath(); x.arc(a, b, 7, 0, 6.28); x.stroke(); }
  for (const [pid, a] of gm.avatars) { if ((a.to?.ls ?? 0) === 2) continue; const [u, v] = toMap(a.pos.x, a.pos.z), inf = G.lobby.players.find(q => q.id === pid); x.fillStyle = inf?.coat || '#333'; x.beginPath(); x.arc(u, v, 4, 0, 6.28); x.fill(); x.fillStyle = '#2b2218'; x.font = '600 11px Inter, sans-serif'; x.fillText(inf?.name || '', u + 6, v - 4); }
  const [u, v] = toMap(p.pos.x, p.pos.z);
  x.save(); x.translate(u, v); x.rotate(-p.yaw + Math.PI); x.fillStyle = S.coat || '#b4462e'; x.strokeStyle = '#1b1510'; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(0, 9); x.lineTo(-5.5, -6); x.lineTo(0, -3); x.lineTo(5.5, -6); x.closePath(); x.fill(); x.stroke(); x.restore();
  // north
  x.fillStyle = '#2b2218'; x.font = 'italic 700 16px Georgia, serif'; x.fillText('N', PX - 26, 24); x.fillRect(PX - 21, 28, 2, 18);
}

// ---------- the journal ----------
function renderJournal(gm) {
  gm.dom.journal.querySelectorAll('[data-j]').forEach(b => b.classList.toggle('on', b.dataset.j === gm.jTab));
  let h = '';
  if (gm.jTab === 'goals') h = '<ul class="gj-goals">' + GOALS.map(g => `<li class="${gm.ob?.has(g.id) ? 'done' : ''}">${gm.ob?.has(g.id) ? '✓' : '○'} ${esc(g.title)}</li>`).join('') + '</ul>';
  else if (gm.jTab === 'diary') h = gm.diary?.length ? gm.diary.slice().reverse().map(([d, t]) => `<p class="gj-day"><b>Day ${d}</b> ${esc(t)}</p>`).join('') : '<p class="gj-none">Nothing written yet. Every morning a page is added about the day before.</p>';
  else {
    const items = [['journal', 'The Nordstjerna\'s log (the camp)'], ['journal2', 'Arne Vik\'s notebook (the ice cave)'], ['note', 'H. L.\'s note (the watchtower)'], ['plan', 'The winter den plan (the cave behind the drift)']].filter(([k]) => gm.read.has(k));
    h = items.length ? items.map(([k, t]) => `<button class="btn small" data-open="${k}">${esc(t)}</button>`).join('') : '<p class="gj-none">Nothing yet. Journals and notes you read are kept here.</p>';
  }
  gm.dom.jBody.innerHTML = h;
}
function openRead(gm, k) {
  if (k === 'note') { H.hint(gm, 'renote' + Math.floor(gm.T), 'In pencil, in a careful hand: "If you made it up here, you know what this is. It\'s no good without its battery, and the cold up here kills a battery in a week. I took it home. It\'s under the floor, by the head of my bunk. If I\'m not there, use it. — H. L."', 14000, true); H.lock(gm); return; }
  openBook(gm, k);
}

// ---------- pings (the middle mouse button) ----------
export function pingHere(gm) {
  const cam = gm.camera, R = gm.R;
  cam.getWorldDirection(_v);
  const ray = new R.Ray({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: _v.x, y: _v.y, z: _v.z });
  const hit = gm.world.phys.castRay(ray, 400, true, undefined, undefined, gm.player.col);
  if (!hit) return;
  const at = cam.position.clone().addScaledVector(_v, hit.timeOfImpact ?? hit.toi);
  addPing(gm, at, S.coat, S.name);
  if (gm.role !== 'solo') send('*', { t: 'g-ping', p: at.toArray().map(v => Math.round(v * 10) / 10), c: S.coat, n: S.name });
}
function addPing(gm, at, col, name) {
  if (gm.pings.length >= 6) { const o = gm.pings.shift(); if (o.m) gm.scene.remove(o.m); }
  let m = null;
  if (typeof document !== 'undefined') {
    m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), color: col || '#ffd86a', blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false }));
    m.position.copy(at).setY(at.y + 0.6); m.scale.setScalar(1.6); gm.scene.add(m);
  }
  gm.pings.push({ p: at.clone(), t: 10, m, col: col || '#ffd86a', name });
  SFX.reel?.();
}
on('g-ping', m => { const gm = GM; if (gm && gm.ready && Array.isArray(m.p)) { addPing(gm, new THREE.Vector3(...m.p), m.c, m.n); H.hint(gm, 'pinged' + Math.floor(performance.now() / 4000), `${m.n || 'Someone'} marked a spot.`, 2500, true); } });

// ---------- kept with you (sync.js) ----------
export function mapRecord(gm) {
  let s = '';
  for (let i = 0; i < N * N; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b |= (gm.explored[i + k] ? 1 : 0) << k; s += String.fromCharCode(b); }
  return { ex: btoa(s), rd: [...(gm.read || [])] };
}
export function mapRestore(gm, rec) {
  try { if (rec.ex) { const s = atob(rec.ex); for (let i = 0; i < s.length; i++) { const b = s.charCodeAt(i); for (let k = 0; k < 8; k++) if (b & (1 << k)) gm.explored[i * 8 + k] = 1; } } } catch { /* a damaged record: start blank */ }
  if (Array.isArray(rec.rd)) for (const k of rec.rd) gm.read.add(String(k));
}
