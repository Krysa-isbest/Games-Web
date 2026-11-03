// Story moments between days (Chapter 1). Mostly small things inside the shop (answering machine messages,
// the morning paper), plus four short cutscenes for the big moments. One moment per morning at most.
// Co-op: the host decides when; everyone sees it. A cutscene ends when everyone pressed Skip, or the host did.
// Everything seen can be read / replayed in the computer's Story app.
import * as THREE from 'three';
import { G, ACTIONS, nameOf } from './state.js';
import { part, canvasTex } from './data.js';
import { makePerson, poseArms } from './people.js';
import { setShopPower } from './world.js';
import { playPad } from './music.js';
import { act, broadcast, on, online, isGuest } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const $ = UI.$;

// ---------- cancellable cutscene helpers (Skip ends every wait at once) ----------
let cut = null;
const cwait = ms => new Promise(res => {
  if (!cut || cut.skip) return res();
  const t = setTimeout(res, ms);
  cut.pending.push(() => { clearTimeout(t); res(); });
});
async function say(text, who = '', ms = 3600) {
  if (cut?.skip) return;
  const el = $('story-sub');
  el.innerHTML = (who ? `<b>${who}:</b> ` : '') + text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  await cwait(ms);
}
const clearSub = () => $('story-sub').classList.remove('show');
async function fade(black, ms = 800) {
  const f = $('story-fade');
  f.style.transition = `opacity ${cut?.skip ? 0 : ms}ms`; f.style.opacity = black ? 1 : 0;
  await cwait(ms);
}
function big(html, cls = '') { const b = $('story-big'); b.className = cls; b.innerHTML = html; b.classList.toggle('hidden', !html); }
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function move(cam, keys, ms) { // camera path: [[pos, lookAt], ...]
  const t0 = performance.now();
  const step = () => {
    if (!cut || cut.skip) return;
    const k = Math.min(1, (performance.now() - t0) / ms), seg = (keys.length - 1) * ease(k), i = Math.min(keys.length - 2, Math.floor(seg)), f = seg - i;
    cam.position.lerpVectors(keys[i][0], keys[i + 1][0], f);
    cam.lookAt(keys[i][1].clone().lerp(keys[i + 1][1], f));
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}
function sitPose(m) {
  m.userData.body.position.y = -0.48;
  for (const l of m.userData.legs) { l.hip.rotation.x = -1.45; l.knee.rotation.x = 1.45; }
}
function walk(m, to, ms) { // slide a person along the ground with a walk cycle
  const from = m.position.clone(), t0 = performance.now();
  m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  const step = () => {
    if (!cut || cut.skip) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    m.position.lerpVectors(from, to, k);
    for (const [i, l] of m.userData.legs.entries()) l.hip.rotation.x = Math.sin(performance.now() * 0.009 + i * Math.PI) * 0.5;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

// ---------- the moments ----------
// kind: msg (answering machine) · news (morning paper) · cut (cutscene). when(): may it happen this morning?
export const BEATS = [
  { id: 'msg1', kind: 'msg', title: 'A message from Marty', when: () => G.day >= 2,
    lines: [['Marty (bakery)', 'Chuck? Chuck, it\'s Marty from the bakery. Your sign\'s on again… so you\'re back?'], ['Marty (bakery)', 'Nobody\'s seen you in weeks. Call me. Please.']] },
  { id: 'window', kind: 'cut', title: 'Someone at the window', when: () => G.day >= 3, play: playWindow },
  { id: 'news1', kind: 'news', title: 'BANK BUYS UP ELM STREET', when: () => G.day >= 4,
    text: 'First National Bank has bought three more closed shops on Elm Street this month. "We believe in this neighbourhood," says branch manager R. Graves.' },
  { id: 'flashback', kind: 'cut', title: 'Three weeks earlier', when: () => G.story.pages.length >= 1 && G.day >= 3, play: playFlashback },
  { id: 'msg2', kind: 'msg', title: 'No name, no number', when: () => G.day >= 6,
    lines: [['Unknown', '(breathing)'], ['Unknown', 'You don\'t know what you signed, kid.'], ['', '(click)']] },
  { id: 'news2', kind: 'news', title: 'POWER PLANT FENCE CUT AGAIN', when: () => G.day >= 7,
    text: 'Police warn scavengers away from the old nuclear plant outside town. The site has been closed since the accident and the air is still not safe without a gas mask. "Some of the people who went in never came out," says a guard.' },
  { id: 'diner', kind: 'cut', title: 'A late lunch', when: () => G.day >= 9, play: playDiner },
  { id: 'msg3', kind: 'msg', title: 'A bad line', when: () => G.day >= 11,
    lines: [['?', '(static) …kid? It\'s… (static) …don\'t let them have the book…'], ['?', '…the shop has to stay o— (click)']] },
  { id: 'news3', kind: 'news', title: 'BREAK-INS AT DISTRICT PAWN SHOPS', when: () => G.day >= 13,
    text: 'Three pawn shops were broken into this week. Nothing of value was taken, but in every shop the books were searched. Police have no suspects.' },
  { id: 'brick', kind: 'cut', title: 'STOP DIGGING', when: () => G.day >= 8 && G.debt <= 2500, play: playBrick },
  { id: 'news4', kind: 'news', title: 'FIRST NATIONAL PLANS "PAWN SUPERSTORE"', when: () => G.day >= 16,
    text: 'The bank\'s new company, Graves & Co., has filed plans for a large, modern pawn store downtown. "Small shops had their time," the plans say.' },
];
const beatById = id => BEATS.find(b => b.id === id);

// ---------- host: one moment per morning ----------
let checkT = 2;
export function updateBeats(dt, host) {
  if (!host || (checkT -= dt) > 0) return;
  checkT = 1;
  if (G.intro !== 'done' || (G.tut !== 99 && G.day < 2) || G.phase !== 'prep' || G.world !== 'shop' || G.mode !== 'play' || G.cine || G.paused || UI.panelOpen()) return;
  const S = G.story;
  S.beats ??= [];
  if (S.beatDay === G.day) return;
  const b = BEATS.find(x => !S.beats.includes(x.id) && x.when());
  if (!b) return;
  S.beats.push(b.id); S.beatDay = G.day;
  broadcast({ t: 'beat', id: b.id });
  showBeat(b);
}
on('beat', m => { const b = beatById(m.id); if (b) showBeat(b); });

function showBeat(b, replay = false) {
  if (b.kind === 'cut') return runCut(b, replay);
  if (b.kind === 'msg') return playMessage(b);
  sfx.page();
  UI.openPanel(`<div class="letter news"><h2>📰 The Morning Paper</h2><h3>${b.title}</h3><p>${b.text}</p></div><div class="row"><button id="nw-ok">Put it down</button></div>`);
  $('nw-ok').onclick = () => UI.closePanel();
}

// The answering machine on the counter: subtitles at the bottom, the game keeps going.
async function playMessage(b) {
  let el = $('phone-sub');
  if (!el) { el = document.createElement('div'); el.id = 'phone-sub'; document.body.appendChild(el); }
  sfx.machine();
  for (const [who, text] of b.lines) {
    el.innerHTML = `<small>📞 Answering machine · ${b.title}</small>${who ? `<b>${who}:</b> ` : ''}${text}`;
    el.classList.add('show');
    await new Promise(r => setTimeout(r, 2400 + text.length * 45));
  }
  sfx.machine();
  el.classList.remove('show');
}

// ---------- cutscene runner ----------
const skips = new Set();
async function runCut(b, replay) {
  if (cut) return;
  cut = { id: b.id, skip: false, pending: [], replay };
  skips.clear();
  G.uiOpen = true;
  UI.closePanel(false);
  if (document.pointerLockElement) document.exitPointerLock();
  $('story').classList.remove('hidden'); big('');
  $('story-fade').style.transition = 'none'; $('story-fade').style.opacity = 1;
  $('story-act').innerHTML = `<button id="beat-skip" class="ghost">Skip ⏭</button><div id="beat-wait" class="dim small"></div>`;
  $('beat-skip').onclick = () => {
    $('beat-skip').disabled = true;
    if (cut?.replay || !online()) return skipCut();
    act('beatSkip');
  };
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 300);
  G.cine = { scene: G.scene, camera: cam, update() {} };
  const added = [], undo = [];
  const add = o => { G.scene.add(o); added.push(o); return o; };
  try { await b.play(cam, add, undo); } catch (e) { console.error(e); }
  // back to the game (under black, then fade in)
  clearSub(); big('');
  $('story-act').innerHTML = '';
  $('story-fade').style.transition = 'opacity 300ms'; $('story-fade').style.opacity = 1;
  await new Promise(r => setTimeout(r, 320));
  added.forEach(o => G.scene.remove(o)); undo.forEach(f => f());
  document.body.classList.remove('flashback');
  G.cine = null; G.cineDay = null;
  cut = null;
  $('story-fade').style.transition = 'opacity 700ms'; $('story-fade').style.opacity = 0;
  setTimeout(() => $('story').classList.add('hidden'), 720);
  G.uiOpen = false;
  G.afterCine?.();
}
function skipCut() {
  if (!cut || cut.skip) return;
  cut.skip = true;
  cut.pending.splice(0).forEach(f => f());
}
// Host: the host's Skip ends it for everyone; otherwise it ends when every player pressed Skip.
ACTIONS.beatSkip = pid => {
  if (!cut) return false;
  skips.add(pid);
  const all = Object.keys(G.players).every(p => skips.has(p));
  if (pid === G.me || all) { broadcast({ t: 'beatEnd' }); skipCut(); }
  else { const left = Object.keys(G.players).filter(p => !skips.has(p)).map(nameOf); broadcast({ t: 'beatWait', left }); waitText(left); }
  return true;
};
const waitText = left => { const w = $('beat-wait'); if (w) w.textContent = left.length ? `Skipping when ${left.join(', ')} ${left.length > 1 ? 'skip' : 'skips'} too (or the host does)` : ''; };
on('beatEnd', () => skipCut());
on('beatWait', m => waitText(m.left));

// ---------- the four cutscenes ----------
// 1. Day 3: last night, someone stood at the window with a flashlight, then got into a black car.
async function playWindow(cam, add, undo) {
  G.cineDay = 0.04; setShopPower(0.1); undo.push(() => setShopPower(G.shopEvent === 'powercut' ? 0.45 : 1));
  const man = add(makePerson({ seed: 3131, player: 0x15161a }));
  man.position.set(2.7, 0, 5.6); man.rotation.y = Math.PI;
  poseArms(man, -1.4, -0.3);
  const fl = new THREE.SpotLight(0xfff0d0, 40, 14, 0.3, 0.5, 1.2); fl.position.set(0.15, 1.45, 0.3); fl.target.position.set(0, 1.0, 5); man.add(fl, fl.target);
  const car = add(simpleCar()); car.position.set(12, 0, 9.5);
  cam.position.set(0.2, 1.55, 0.2); cam.lookAt(2.7, 1.6, 5.6);
  big('<small>Last night, 3:12 AM</small>', 'story-small');
  await fade(false, 900);
  move(cam, [[V(0.2, 1.55, 0.2), V(2.7, 1.6, 5.6)], [V(1.4, 1.5, 2.4), V(2.7, 1.6, 5.6)]], 6000);
  await cwait(2200); big('');
  await cwait(2600);
  fl.target.position.set(-2, 0.6, 5); // looks at the counter
  await cwait(1800);
  fl.intensity = 0;
  walk(man, V(11, 0, 7.3), 4500);
  await fade(true, 600);
  cam.position.set(4, 1.7, 13); cam.lookAt(10, 1, 8.5);
  await fade(false, 600);
  await cwait(3600);
  man.visible = false; sfx.door(); await cwait(500); sfx.engine();
  const t0 = performance.now();
  const drive = () => { if (!cut || cut.skip) return; car.position.x += 0.12 + (performance.now() - t0) * 0.0001; if (car.position.x < 50) requestAnimationFrame(drive); };
  drive();
  await say('Someone is watching the shop.', '', 3200);
  await fade(true, 800);
}

// 2. After the first ledger page: Chuck, three weeks ago, alone in the shop at night.
async function playFlashback(cam, add, undo) {
  document.body.classList.add('flashback');
  G.cineDay = 0.06; setShopPower(0.25); undo.push(() => setShopPower(G.shopEvent === 'powercut' ? 0.45 : 1));
  const pad = playPad(); undo.push(() => pad?.stop());
  const chuck = add(makePerson({ seed: 1957, guard: true }));
  chuck.position.set(-4.5, 0, 0.6); chuck.rotation.y = 0;
  poseArms(chuck, -0.9, -1.0);
  const book = add(new THREE.Group()); book.position.set(-4.5, 1.02, 1.05);
  part(book, new THREE.BoxGeometry(0.3, 0.04, 0.4), 0x4a1a10, 0, 0, 0);
  part(book, new THREE.BoxGeometry(0.28, 0.012, 0.38), 0xe8dcb0, 0, 0.025, 0);
  const lamp = new THREE.PointLight(0xffb060, 6, 4); lamp.position.set(-4.2, 1.6, 1.0); add(lamp);
  cam.position.set(-2.6, 1.6, 2.6); cam.lookAt(-4.5, 1.2, 0.9);
  big('<small>Three weeks earlier…</small>', 'story-small');
  await fade(false, 1000);
  move(cam, [[V(-2.6, 1.6, 2.6), V(-4.5, 1.2, 0.9)], [V(-3.4, 1.45, 2.1), V(-4.5, 1.1, 0.9)]], 9000);
  await cwait(1800); big('');
  await say('Graves again. Loan four-four-seven-one. "Interest point eight." Robbery with paperwork.', 'Chuck', 4200);
  sfx.ring(); await cwait(1300); sfx.ring();
  await say('…No. The book stays with me. Tell your friend at the IRS the same.', 'Chuck', 4000);
  sfx.page(); poseArms(chuck, -1.5, -0.4);
  await say('If anything happens, the kid finds these. One page at a time.', 'Chuck', 3800);
  await fade(true, 900);
}

// 3. Day 9: Graves and Agent Pratt at a diner. Nobody is supposed to see this.
async function playDiner(cam, add) {
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x07080c);
  sc.add(new THREE.HemisphereLight(0x8090a0, 0x201810, 0.3));
  const neon = new THREE.PointLight(0xff4060, 6, 8); neon.position.set(-1.4, 2, 0); sc.add(neon);
  const lamp = new THREE.PointLight(0xffd8a0, 8, 5); lamp.position.set(0, 1.9, 0); sc.add(lamp);
  const floorM = new THREE.MeshStandardMaterial({ map: canvasTex(64, 64, (g, w) => { for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { g.fillStyle = (x + y) % 2 ? '#e8e2d0' : '#1a1a1a'; g.fillRect(x * 8, y * 8, 8, 8); } }, [4, 4]) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorM); floor.rotation.x = -Math.PI / 2; sc.add(floor);
  part(sc, new THREE.BoxGeometry(0.1, 3, 8), 0x2a3a3a, -1.9, 1.5, 0); // wall with window
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshBasicMaterial({ map: canvasTex(128, 50, g => {
    g.fillStyle = '#05070c'; g.fillRect(0, 0, 128, 50); for (let i = 0; i < 40; i++) { g.fillStyle = Math.random() < 0.5 ? '#ffcf7a' : '#6a8aff'; g.fillRect(Math.random() * 128, 10 + Math.random() * 40, 2, 2); }
    g.fillStyle = '#ff4060'; g.font = 'bold 12px sans-serif'; g.fillText('DINER', 50, 12);
  }) }));
  win.position.set(-1.84, 1.6, 0); win.rotation.y = Math.PI / 2; sc.add(win);
  part(sc, new THREE.BoxGeometry(1.0, 0.06, 1.4), 0xb02020, 0, 0.78, 0); // table
  part(sc, new THREE.CylinderGeometry(0.06, 0.06, 0.76, 8), 0x888888, 0, 0.38, 0, { metalness: 0.8 });
  for (const z of [-0.95, 0.95]) { part(sc, new THREE.BoxGeometry(1.0, 0.45, 0.5), 0x8a1a1a, 0, 0.23, z); part(sc, new THREE.BoxGeometry(1.0, 0.8, 0.12), 0x8a1a1a, 0, 0.8, z * 1.22); }
  for (const z of [-0.3, 0.3]) { part(sc, new THREE.CylinderGeometry(0.05, 0.04, 0.09, 10), 0xf4f0e8, 0.2, 0.86, z); part(sc, new THREE.CylinderGeometry(0.04, 0.04, 0.01, 10), 0x2a1a10, 0.2, 0.905, z); }
  const graves = makePerson({ seed: 4242, player: 0x23262c }); graves.position.set(0, 0, -0.95); sitPose(graves); poseArms(graves, -1.2, -0.8); sc.add(graves);
  const pratt = makePerson({ seed: 5151, player: 0x4a4636 }); pratt.position.set(0, 0, 0.95); pratt.rotation.y = Math.PI; sitPose(pratt); poseArms(pratt, -1.1, -0.9); sc.add(pratt);
  part(pratt.userData.head, new THREE.CylinderGeometry(0.16, 0.16, 0.02, 14), 0x2a2620, 0, 0.12, 0); // hat brim
  part(pratt.userData.head, new THREE.CylinderGeometry(0.1, 0.11, 0.1, 12), 0x2a2620, 0, 0.17, 0);
  G.cine.scene = sc;
  cam.position.set(1.8, 1.5, 1.8); cam.lookAt(0, 1.1, 0);
  big('<small>The Starlight Diner, across town</small>', 'story-small');
  await fade(false, 900);
  move(cam, [[V(1.8, 1.5, 1.8), V(0, 1.1, 0)], [V(1.3, 1.4, -0.2), V(0, 1.15, 0)]], 13000);
  await cwait(1600); big('');
  await say('The kid paid again. On time. Every Sunday.', 'Agent Pratt', 3600);
  await say('Good. Let them pay.', 'Mr. Graves', 2600);
  await say('And the book?', 'Agent Pratt', 2200);
  await say('If they find it, they\'ll bring it to us. People always come to the bank when they\'re scared.', 'Mr. Graves', 4400);
  await say('And when the loan is paid off?', 'Agent Pratt', 2600);
  await say('Then phase one is done.', 'Mr. Graves', 3000);
  await fade(true, 900);
  void add;
}

// 4. Almost paid off: a brick through the shop window at night, with a note.
async function playBrick(cam, add, undo) {
  G.cineDay = 0.04; setShopPower(0.12); undo.push(() => setShopPower(G.shopEvent === 'powercut' ? 0.45 : 1));
  const brick = add(new THREE.Group());
  part(brick, new THREE.BoxGeometry(0.22, 0.07, 0.11), 0x9a3a22, 0, 0, 0, { roughness: 1 });
  part(brick, new THREE.BoxGeometry(0.12, 0.072, 0.112), 0xf0ead8, 0.02, 0, 0);
  brick.position.set(2.4, 1.6, 7.5);
  const car = add(simpleCar()); car.position.set(-6, 0, 9.5);
  cam.position.set(0.5, 1.5, -1.5); cam.lookAt(2.4, 1.4, 5);
  big('<small>Two nights before the last payment</small>', 'story-small');
  await fade(false, 900);
  await cwait(2000); big('');
  sfx.engine(); await cwait(900);
  // the throw
  const t0 = performance.now(), from = brick.position.clone(), to = V(0.8, 0.04, 1.2);
  sfx.glass();
  await new Promise(res => {
    const step = () => {
      if (!cut || cut.skip) return res();
      const k = Math.min(1, (performance.now() - t0) / 700);
      brick.position.lerpVectors(from, to, k); brick.position.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.5;
      brick.rotation.x += 0.3; brick.rotation.z += 0.2;
      if (k < 1) requestAnimationFrame(step); else res();
    };
    step();
  });
  sfx.thud(); brick.rotation.set(0, 0.4, 0);
  sfx.screech();
  const t1 = performance.now();
  const drive = () => { if (!cut || cut.skip) return; car.position.x += 0.2 + (performance.now() - t1) * 0.00015; if (car.position.x < 50) requestAnimationFrame(drive); };
  drive();
  move(cam, [[V(0.5, 1.5, -1.5), V(0.8, 0.1, 1.2)], [V(0.4, 0.55, 0.5), V(0.8, 0.05, 1.2)]], 2500);
  await cwait(2600);
  big('<div class="win-title small" style="font-family:Georgia,serif">STOP DIGGING.</div>', 'story-big-title');
  await cwait(3200); big('');
  await fade(true, 800);
}

function simpleCar() {
  const g = new THREE.Group();
  const black = { metalness: 0.6, roughness: 0.25 };
  part(g, new THREE.BoxGeometry(4.4, 0.65, 1.85), 0x0a0a0c, 0, 0.6, 0, black);
  part(g, new THREE.BoxGeometry(2.3, 0.6, 1.75), 0x0a0a0c, -0.2, 1.22, 0, black);
  part(g, new THREE.BoxGeometry(2.25, 0.5, 1.77), 0x05080c, -0.2, 1.24, 0, { roughness: 0.05 });
  for (const x of [-1.4, 1.4]) for (const z of [-0.88, 0.88]) part(g, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12), 0x080808, x, 0.36, z).rotation.x = Math.PI / 2;
  for (const z of [-0.6, 0.6]) part(g, new THREE.BoxGeometry(0.05, 0.12, 0.3), 0xff2020, -2.22, 0.75, z, { emissive: 0x800000 });
  return g;
}

// ---------- the Story app (computer) ----------
export function storyView() {
  const seen = (G.story.beats || []).map(beatById).filter(Boolean);
  const canReplay = !online() || G.phase === 'prep' || G.phase === 'evening';
  const icon = { msg: '📞', news: '📰', cut: '🎬' };
  return `<p class="dim">Everything that happened so far. ${seen.length}/${BEATS.length} story moments in Chapter 1.${online() ? ' Replays only play on your screen.' : ''}</p>
    <div class="list">${seen.map(b => `<div class="pc-row"><span class="big">${icon[b.kind]}</span><span class="grow"><b>${b.title}</b><br><small class="dim">${
      b.kind === 'msg' ? b.lines.map(([w, t]) => (w ? w + ': ' : '') + t).join(' ') : b.kind === 'news' ? b.text : 'Cutscene'}</small></span>
      ${b.kind === 'cut' ? `<button data-replay="${b.id}" ${canReplay ? '' : 'disabled title="Not while the shop is open"'}>▶ Replay</button>` : ''}</div>`).join('') || '<p class="dim">Nothing yet. Come back after a few days.</p>'}</div>`;
}
export function bindStory(body) {
  body.querySelectorAll('[data-replay]').forEach(b => b.onclick = () => { UI.closePanel(false); showBeat(beatById(b.dataset.replay), true); });
}
void isGuest;
