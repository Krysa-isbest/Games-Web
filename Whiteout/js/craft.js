// Whiteout: the workbench and the crafting book (build step 4). The old owner's notebook lies on the bench in the
// shack: look at the bench, hold the use key, and it opens. Turn its pages (A / D, the arrows, or click a corner).
// Each recipe is a hand-drawn page. Make it: what it needs is laid out on the bench, you work it for a few
// seconds (you hear it), and the thing lies there to pick up. You can only craft at the bench.
// Recipes now: boards from a log, sharpening the axe, a stone axe. One page is torn out: more come from the
// journals of the earlier survivors (later build steps).
// Co-op: what you use comes out of your own things; the host lays the result on the bench (work.js, act 'craft').
import * as THREE from 'three';
import { TYPES, meshFor, DULL } from './items.js';
import { kn, BINDS } from './keys.js';
import * as SFX from './sfx.js';

let H = null;            // helpers from work.js: { act, hint, lock, shout }

// need: what goes on the bench (used up). tool: what you must carry (kept). out: what comes off the bench.
export const RECIPES = {
  boards: { title: 'Boards from a log', need: [['log', 1]], tool: 'axe', out: [['board', 2]], time: 3, sound: 'chop' },
  sharpen: { title: 'Keeping the axe sharp', need: [], tool: 'stone', sharpen: true, time: 3, sound: 'grind' },
  saxe: { title: 'A stone axe', need: [['branch', 2], ['stone', 1]], out: [['saxe', 1]], time: 3.5, sound: 'hammer' },
  picks: { title: 'Ice picks', need: [['branch', 1], ['stone', 2]], out: [['picks', 1]], time: 3, sound: 'hammer' },
};
// the pages, two to a spread
const INK = '#2b2836';
const SPREADS = [
  { left: () => `<h3>Whoever finds this —</h3>
      <p>This was my cabin for eleven winters. If you are reading this, I didn't make it back, and you are as stuck as I was.</p>
      <p>The stove draws badly when the wind is from the south. Keep the axe sharp, and keep it close. <s>The ice on the east side is safe.</s></p>
      <p class="sig">— H. L.</p>`,
    right: () => `<h4>How this book works</h4>
      <p>Find the page. Lay what it asks for on the bench and work it with your hands. That's all there is to it.</p>
      <p>Wood: wet wood smokes and gives nothing. Stack it by the stove a few <s>hours</s> minutes first.</p>
      <p>Gaps: boards from inside hold. Snow packed from outside holds until the next storm.</p>
      <p class="keys">${kn('left')} / ${kn('right')} or the arrows turn the pages · ${kn('use')} or Esc closes</p>` },
  { left: () => page('boards', SKETCH.boards, 'Split along the grain, a log gives two rough boards. Any axe will do it.'),
    right: () => recipeSide('boards', ['Burn them or build with them? A board in the stove is an hour of heat. Nailed over a gap it saves heat every night after.', '<s>Burn them, it\'s cold</s> — no. Patch the walls first.']) },
  { left: () => page('sharpen', SKETCH.whet, 'A dull axe takes twice the blows. Sit at the bench with a good flat stone and work the edge until it bites again.'),
    right: () => recipeSide('sharpen', ['The stone isn\'t used up. Keep one in your pocket.', 'Every tree takes something off the edge. Hitting rocks takes more.']) },
  { left: () => page('saxe', SKETCH.saxe, 'If you lose the axe: two straight branches and a sharp stone, lashed tight.'),
    right: () => recipeSide('saxe', ['It\'s slow, and it won\'t last. But it beats your bare hands.', 'When it falls apart you get the stone back.']) },
  { left: () => page('picks', SKETCH.picks, 'Two short grips with a sharp stone point in each. Keep them in your coat whenever you go out on the sea ice.'),
    right: () => recipeSide('picks', ['If the ice gives way, you have half a minute. Stab the picks into the edge and pull, one hand after the other.', 'Dark ice is thin ice. It groans before it breaks. Get down and crawl off it.', '<s>Alone you won\'t</s> Without picks, nobody climbs out alone.']) },
  { left: () => `<h3>Fish through the ice</h3><svg class="sk" viewBox="0 0 220 210"><g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${SKETCH.fish}</g></svg>
      <p>Chop a hole in the sea ice with the axe, same spot, a few blows. Sit at the hole with the rod.</p>`,
    right: () => `<p>When it bites, reel in, but ease off when the line goes tight or it snaps.</p>
      <p>Out where the water is deep the fish are bigger. They bite better at night, and so does the cold.</p>
      <p class="margin">Cook it on the stove! Raw fish nearly killed me the first winter.</p>
      <p class="margin">The rod is on the bunk. The holes freeze over in a day.</p>` },
  { left: () => `<h3>Water</h3><svg class="sk" viewBox="0 0 220 210"><g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${SKETCH.pot}</g></svg>
      <p>Fill the pot with snow and set it on the stove. A pot of snow gives less water than you'd think.</p>`,
    right: () => `<p>Drink it warm: it puts some heat back in you.</p>
      <p>Don't eat snow. <s>Just a little</s> It cools you from the inside, and out here you can't afford it.</p>
      <p class="margin">The champagne from the plane? Alcohol only feels warm.</p>` },
  { left: () => `<div class="torn"></div><p class="faint">A page has been torn out here. Only the edge is left: <i>"…the bow wants dry yew, cut in the dark of the m…"</i></p>`,
    right: () => `<p class="faint">The next pages are stuck together with something dark.</p><p class="faint">Somebody wrote in the corner, in a different hand: <i>"don't open the barred cabin"</i>.</p>
      <p class="note">More pages may turn up: earlier survivors kept journals.</p>` },
];
// hand-drawn sketches (a wobble filter makes the lines shake like ink)
const SKETCH = {
  boards: `<path d="M30 70 q70 -14 140 0 v34 q-70 14 -140 0z"/><ellipse cx="30" cy="87" rx="9" ry="17"/><path d="M26 80 q4 7 0 14M33 76 q3 11 0 22"/>
    <path d="M40 150 h150 M40 165 h150 M40 150 v15 M190 150 v15 M45 180 h150 M45 195 h150 M45 180 v15 M195 180 v15"/><path d="M100 118 l0 22 m-7 -8 l7 8 7 -8"/>`,
  whet: `<path d="M40 150 q60 -10 120 0 l6 20 q-66 10 -132 0z"/><path d="M60 128 l90 -40 l12 18 l-80 46z"/><path d="M150 88 l25 -10 l8 22 l-21 6"/>
    <path d="M88 168 q20 4 40 0 M70 60 q20 -12 40 0 m-4 -8 l4 8 -9 2"/><path d="M175 60 l10 -6 M182 72 l12 -2 M168 48 l4 -10" stroke-width="1.6"/>`,
  fish: `<ellipse cx="110" cy="150" rx="70" ry="16"/><ellipse cx="110" cy="150" rx="26" ry="7"/><path d="M60 40 l70 60 M130 100 l-6 -2 m6 2 l-1 -6"/><path d="M130 100 q4 30 -20 50" stroke-dasharray="3 4"/>
    <path d="M150 182 q22 -14 44 0 q-22 14 -44 0z M150 182 l-12 -8 v16z"/><circle cx="186" cy="180" r="1.5"/>`,
  pot: `<path d="M60 90 h100 l-8 80 h-84z"/><path d="M58 90 q52 -20 104 0"/><path d="M75 75 q35 -40 70 0" stroke-dasharray="2 5"/><path d="M40 190 h140 M70 190 v-18 M150 190 v-18"/>
    <path d="M90 60 q-6 -14 2 -26 M110 58 q-6 -14 2 -26 M130 60 q-6 -14 2 -26"/>`,
  picks: `<path d="M40 150 l60 -60 M120 150 l60 -60"/><path d="M100 90 l14 -22 l-2 16z M180 90 l14 -22 l-2 16z"/><path d="M40 150 q40 30 80 0" stroke-dasharray="3 4"/>
    <path d="M30 190 q80 -20 160 0"/><path d="M60 186 l10 -12 l6 9 l8 -14 l6 10" stroke-width="1.6"/>`,
  saxe: `<path d="M50 190 l100 -140"/><path d="M58 192 l100 -140"/><path d="M135 45 q30 -14 48 6 q-6 22 -36 20 z"/>
    <path d="M140 64 l14 12 M146 58 l14 12 M152 52 l14 12"/><path d="M30 120 q20 -20 46 -8" stroke-dasharray="4 5"/>`,
};
function page(id, sketch, lead) {
  const r = RECIPES[id];
  return `<h3>${r.title}</h3><svg class="sk" viewBox="0 0 220 210"><g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${sketch}</g></svg><p>${lead}</p>`;
}
function recipeSide(id, notes) {
  return `<div data-recipe="${id}"></div>${notes.map((n, i) => `<p class="${i ? 'margin' : ''}">${n}</p>`).join('')}`;
}

export function initCraft(gm, helpers) {
  H = helpers;
  gm.bookOpen = false; gm.spread = 0; gm.crafting = null;
  const d = gm.dom.root;
  d.insertAdjacentHTML('beforeend', `<div class="book hidden"><svg width="0" height="0" style="position:absolute"><filter id="ink"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></svg>
    <div class="bk"><div class="bk-page left" data-flip="-1"></div><div class="bk-page right" data-flip="1"></div><div class="bk-spine"></div></div>
    <div class="bk-foot"><button class="btn ghost small" data-flip="-1">‹ Back</button><span class="bk-n"></span><button class="btn ghost small" data-flip="1">Next ›</button><button class="btn small" data-close>Close the book</button></div></div>`);
  const q = s => d.querySelector(s);
  Object.assign(gm.dom, { book: q('.book'), bkL: q('.bk-page.left'), bkR: q('.bk-page.right'), bkN: q('.bk-n') });
  gm.dom.book.addEventListener('mousedown', e => {
    e.preventDefault();
    const make = e.target.closest('[data-make]');
    if (make) { if (!make.disabled) startCraft(gm, make.dataset.make); return; }
    if (e.target.closest('[data-close]')) { closeBook(gm); return; }
    const fl = e.target.closest('[data-flip]');
    if (fl) flip(gm, +fl.dataset.flip);
  });
  gm.dom.book.addEventListener('contextmenu', e => e.preventDefault());
}

// ---------- the book ----------
export function openBook(gm) {
  if (gm.bookOpen) return;
  gm.bookOpen = true; gm.inp.clear();
  gm.dom.book.classList.remove('hidden');
  render(gm);
  SFX.page?.();
  document.exitPointerLock?.();
  H.hint(gm, 'book', 'The old owner\'s crafting book. Not every page is here: earlier survivors\' journals may have more.', 6000);
}
export function closeBook(gm) {
  if (!gm.bookOpen) return;
  gm.bookOpen = false;
  gm.dom.book.classList.add('hidden');
  H.lock(gm);
}
// the keys while the book is open (game.js asks first); true = used
export function bookKey(gm, e) {
  if (!gm.bookOpen) return false;
  const c = e.code;
  if (c === 'Escape' || c === 'Tab' || c === 'KeyE' || c === kn2('use') || c === kn2('inventory')) { e.preventDefault(); closeBook(gm); return true; }
  if (c === 'ArrowLeft' || c === 'KeyA' || c === kn2('left')) { e.preventDefault(); if (!e.repeat) flip(gm, -1); return true; }
  if (c === 'ArrowRight' || c === 'KeyD' || c === kn2('right')) { e.preventDefault(); if (!e.repeat) flip(gm, 1); return true; }
  return true;                 // nothing else does anything while you read
}
const kn2 = a => BINDS[a];
function flip(gm, dir) {
  const n = Math.max(0, Math.min(SPREADS.length - 1, gm.spread + dir));
  if (n === gm.spread || gm.turning) return;
  gm.turning = true; SFX.page?.();
  const out = dir > 0 ? gm.dom.bkR : gm.dom.bkL, inn = dir > 0 ? gm.dom.bkL : gm.dom.bkR;
  out.classList.add(dir > 0 ? 'turn-out-r' : 'turn-out-l');
  setTimeout(() => {
    gm.spread = n; render(gm);
    out.classList.remove('turn-out-r', 'turn-out-l');
    inn.classList.add(dir > 0 ? 'turn-in-l' : 'turn-in-r');
    setTimeout(() => { inn.classList.remove('turn-in-l', 'turn-in-r'); gm.turning = false; }, 230);
  }, 230);
}
export function render(gm) {
  if (!gm.bookOpen) return;
  const s = SPREADS[gm.spread];
  gm.dom.bkL.innerHTML = s.left(); gm.dom.bkR.innerHTML = s.right();
  gm.dom.bkL.classList.toggle('stain', gm.spread === 1); gm.dom.bkR.classList.toggle('stain2', gm.spread === 3);
  gm.dom.bkN.textContent = `${gm.spread * 2 + 1}–${gm.spread * 2 + 2}`;
  const box = gm.dom.bkR.querySelector('[data-recipe]');
  if (box) box.outerHTML = needs(gm, box.dataset.recipe);
  gm.bookShown = gm.inv.ver;
}
// what a recipe needs, what you have, and the button
function needs(gm, id) {
  const r = RECIPES[id], inv = gm.inv, why = canMake(gm, id);
  const row = (icon, txt, ok) => `<li class="${ok ? 'ok' : 'no'}"><i>${icon}</i>${txt}</li>`;
  let h = '<ul class="need">';
  for (const [t, n] of r.need) { const have = inv.count(x => x === t); h += row(TYPES[t].icon, `${n} × ${TYPES[t].short.toLowerCase()} <small>(you have ${have})</small>`, have >= n); }
  if (r.tool === 'axe') h += row('🪓', 'an axe to work it with <small>(kept)</small>', inv.count(t => !!TYPES[t].tool) > 0);
  if (r.sharpen) { h += row('🪓', 'the axe <small>(steel)</small>', inv.count(t => t === 'axe') > 0); h += row('🪨', 'a stone <small>(kept)</small>', inv.count(t => t === 'stone') > 0); }
  h += '</ul>';
  const label = r.sharpen ? 'Sharpen the axe' : 'Make it';
  return h + `<button class="btn primary small bk-make" data-make="${id}" ${why ? 'disabled' : ''}>${label}</button>${why ? `<p class="why">${why}</p>` : ''}`;
}
// '' = you can make it, otherwise why not
export function canMake(gm, id) {
  const r = RECIPES[id], inv = gm.inv;
  if (gm.crafting) return 'You are already working on something.';
  for (const [t, n] of r.need) if (inv.count(x => x === t) < n) return `You need ${n} ${TYPES[t].short.toLowerCase()}${n > 1 ? (t === 'branch' ? 'es' : 's') : ''}.`;
  if (r.tool === 'axe' && !inv.count(t => !!TYPES[t].tool)) return 'You need an axe to work it.';
  if (r.sharpen) {
    const i = inv.slots.findIndex(s => s?.type === 'axe');
    if (i < 0) return 'You need the axe with you. (A stone axe can\'t be sharpened.)';
    if (!inv.count(t => t === 'stone')) return 'You need a stone to sharpen it on.';
    if (inv.slots[i].dry > 0.95) return 'The axe is already sharp.';
  }
  return '';
}

// ---------- working at the bench ----------
function startCraft(gm, id) {
  const r = RECIPES[id];
  if (canMake(gm, id)) return;
  closeBook(gm);
  const inv = gm.inv, bench = gm.world.shack.bench;
  for (const [t, n] of r.need) inv.use(x => x === t, n);
  // what you used lies on the bench while you work it (your eyes only; the others hear it)
  const meshes = [];
  const lay = r.sharpen ? ['axe', 'stone'] : r.need.flatMap(([t, n]) => Array(n).fill(t));
  lay.forEach((t, k) => {
    const m = meshFor(t), p = bench.lay(-1.4 + (k + 0.5) * (0.9 / lay.length));
    m.position.copy(p); m.position.y += TYPES[t].h || 0.04; m.quaternion.copy(bench.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3 * k));
    gm.scene.add(m); meshes.push(m);
  });
  gm.crafting = { id, t: 0, time: r.time, meshes, beat: 0 };
  gm.inv.ver++;
}
// every frame (work.js)
export function craftTick(gm, dt) {
  if (gm.bookOpen && gm.bookShown !== gm.inv.ver) render(gm);
  const c = gm.crafting;
  if (!c) return;
  const r = RECIPES[c.id], bench = gm.world.shack.bench;
  c.t += dt; c.beat -= dt;
  if (c.beat <= 0) { c.beat = r.sound === 'grind' ? 0.35 : 0.6; H.shout(gm, r.sound === 'grind' ? 'grind' : r.sound, bench.pos); }
  const k = c.t / c.time;
  for (const m of c.meshes) { m.position.x += (Math.random() - 0.5) * 0.004; m.position.z += (Math.random() - 0.5) * 0.004; if (k > 0.75 && !r.sharpen) m.scale.setScalar(Math.max(0.05, 1 - (k - 0.75) * 4)); }
  if (c.t < c.time) return;
  for (const m of c.meshes) gm.scene.remove(m);
  gm.crafting = null;
  if (r.sharpen) {
    const s = gm.inv.slots.find(x => x?.type === 'axe');
    if (s) s.dry = 1;
    gm.inv.ver++;
    H.hint(gm, 'sharpened', 'The edge bites again.', 4000, true);
  } else {
    H.act(gm, { a: 'craft', r: c.id });
    const tool = gm.inv.slots.find(x => x && TYPES[x.type].tool);
    if (r.tool === 'axe' && tool) wearTool(gm, tool, 2);
    H.hint(gm, 'crafted', 'Done. It lies on the bench: pick it up.', 4000);
  }
}
// the host: lay what was made on the bench
export function layOut(gm, id) {
  const r = RECIPES[id], bench = gm.world.shack.bench, s = gm.world.stash;
  if (!r?.out) return;
  let k = 0;
  for (const [t, n] of r.out) for (let i = 0; i < n; i++, k++) s.spawn({ type: t, data: { dry: 1 }, p: bench.outAt(k).toArray(), q: bench.q.toArray(), v: [0, 0, 0] });
}

// ---------- the edge of a tool ----------
// a blow costs edge (times: 1 wood, 3 rock or ice); a stone axe falls apart at no edge, and you get the stone back
export function wearTool(gm, slot, times = 1) {
  const t = TYPES[slot.type].tool;
  if (!t) return;
  const was = slot.dry;
  slot.dry = Math.max(0, slot.dry - t.use * times);
  gm.inv.ver++;
  if (t.breaks && slot.dry <= 0) {
    const i = gm.inv.slots.indexOf(slot);
    if (i >= 0) gm.inv.slots[i] = null;
    const left = gm.inv.add('stone', 1);
    if (left) H.hint(gm, 'saxe-gone2', 'The stone axe falls apart.', 4000, true);
    else H.hint(gm, 'saxe-gone', 'The stone axe falls apart. You keep the stone.', 5000, true);
    SFX.clank();
  } else if (!t.breaks && was >= DULL && slot.dry < DULL) {
    H.hint(gm, 'dull', 'The axe is getting dull: it takes twice the blows now. Sharpen it at the workbench with a stone.', 7000, true);
  }
}
// how much one blow does with what you hold
export function blowPower(slot) {
  const t = TYPES[slot?.type]?.tool;
  if (!t) return 0;
  return t.breaks ? t.power : t.power * (slot.dry < DULL ? 0.5 : 1);
}
