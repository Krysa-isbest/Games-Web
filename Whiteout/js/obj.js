// Whiteout: objectives and the diary (step 7e).
// Objectives: a short chain that tells a new player what to do next, one line at the top of the screen (and the whole
// list in the journal, J). Each one is done once (kept in your record, `ob`). In co-op they are shared: whoever does
// one does it for the crew (a guest tells the host, the host sends the list round with the world).
// The diary: every morning the host writes a few lines about the day before (the weather, trees felled, who went
// through the ice, who was carried in from the cold, flares, what was found), for the whole crew to read in the
// journal. It goes out with the shared world and into the save.
import { G, S } from './state.js';
import * as ISL from './island.js';
import { on, send } from './net.js';

let H = null;                      // helpers from game.js: { announce }
export const GOALS = [
  { id: 'out', title: 'Get out of the plane', done: gm => gm.escaped },
  { id: 'shack', title: 'Find shelter: the shack up the hill', done: gm => gm.inShack },
  { id: 'axe', title: 'Find the axe', done: gm => gm.inv.count(t => t === 'axe' || t === 'saxe') > 0 },
  { id: 'wood', title: 'Gather firewood', done: gm => gm.inv.count(t => t === 'log' || t === 'split' || t === 'branch') > 0 || gm.home.stove.fuel > 0 },
  { id: 'pipe', title: 'Find the stove pipe and fit it', done: gm => gm.home.stove.pipe },
  { id: 'fire', title: 'Light the stove', done: gm => gm.home.stove.lit },
  { id: 'patch', title: 'Patch the gaps in the shack', done: gm => gm.home.k >= 0.5 },
  { id: 'water', title: 'Melt snow in the pot for water', done: gm => gm.inv.count(t => t === 'potwater' || t === 'pottea') > 0 },
  { id: 'look', title: 'Explore: the tail section, the camp, the watchtower', done: gm => ['tail', 'camp', 'tower'].every(k => gm.seen?.has(k)) },
  { id: 'help', title: 'Find a way to call for help', done: gm => !!gm.ends?.res },
  { id: 'last', title: 'Stay alive until help comes', done: () => false },
];
export function initObj(gm, helpers) {
  H = helpers;
  gm.ob ??= new Set();
  gm.diary ??= [];
  gm.dayLog = { day: 0, ev: [] };
  gm.objT = 0; GO = gm;
  gm.dom.root.insertAdjacentHTML('beforeend', '<div class="gm-goal hidden"></div>');
  gm.dom.goal = gm.dom.root.querySelector('.gm-goal');
}
export const goalNow = gm => GOALS.find(g => !gm.ob.has(g.id));
export function objTick(gm, dt, env) {
  gm.objTk = (gm.objTk || 0) - dt;
  if (gm.objTk > 0 || !gm.started || gm.waitState) return;
  gm.objTk = 0.5;
  // done ones stay done; when one is done, say what's next
  let changed = false;
  for (const g of GOALS) if (!gm.ob.has(g.id) && g.done(gm)) { gm.ob.add(g.id); changed = true; if (gm.role === 'guest') send('p0', { t: 'g-ob', id: g.id }); }
  if (gm.obSeen !== gm.ob.size) { if (gm.obSeen != null && gm.obSeen < gm.ob.size) changed = true; gm.obSeen = gm.ob.size; }        // (also when the crew did one)
  const next = goalNow(gm);
  const t = next && gm.escaped && gm.life?.st !== 'dead' && !gm.life?.ended ? `▸ ${next.title}` : '';
  if (gm.txt.goal !== t) { gm.txt.goal = t; gm.dom.goal.textContent = t; gm.dom.goal.classList.toggle('hidden', !t); }
  if (changed && next && gm.escaped && next.id !== 'shack') H.announce(gm, 'Next', next.title, 'Objective');
  // the host writes the diary each morning
  if (gm.role !== 'guest') diaryTick(gm, env);
}

// ---------- the diary (the host) ----------
const nm = pid => (pid === G.net.id || pid === 'me' ? S.name : G.lobby.players.find(x => x.id === pid)?.name || 'Someone');
// something happened today worth writing down: k (what), who (a player id or a name)
export function diaryNote(gm, k, who) {
  if (!gm?.dayLog || gm.role === 'guest') return;
  gm.dayLog.ev.push([k, typeof who === 'string' && who.startsWith('p') && who.length <= 3 ? nm(who) : who || S.name]);
}
function diaryTick(gm, env) {
  const D = gm.dayLog;
  if (!D.day) D.day = env.day;
  if (env.day <= D.day || env.hours < 8) return;
  const day = D.day, ev = D.ev;
  D.day = env.day; D.ev = [];
  if (day < 1) return;
  const wx = ISL.dayWeather(day), lines = [['An ordinary day: wind, and storms that came and went.', 'A clear, still day, and a bitter night.', 'Fog all day: we could hardly see each other.', 'A blizzard all day long.'][wx]];
  const count = (k) => { const m = new Map(); for (const [kk, n] of ev) if (kk === k) m.set(n, (m.get(n) || 0) + 1); return m; };
  const people = arr => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  for (const [n, c] of count('tree')) lines.push(`${n} felled ${c > 1 ? c + ' trees' : 'a tree'}.`);
  const who = k => [...new Set(ev.filter(e => e[0] === k).map(e => e[1]))];
  if (who('ice').length) lines.push(`${people(who('ice'))} went through the ice${who('out').length ? `; ${people(who('out'))} got out again` : ''}.`);
  if (who('down').length) lines.push(`${people(who('down'))} collapsed in the cold${who('up').length ? `, and came round again` : ''}.`);
  if (who('dead').length) lines.push(`${people(who('dead'))} died.`);
  const opened = ev.filter(e => e[0] === 'open').length; if (opened) lines.push(`We opened ${opened > 1 ? opened + ' crates and cases' : 'a crate'}.`);
  const fl = ev.filter(e => e[0] === 'flare').length; if (fl) lines.push(fl > 1 ? `${fl} flares went up.` : 'A flare went up.');
  if (ev.some(e => e[0] === 'seen')) lines.push('Somebody saw us. Help is coming.');
  if (ev.some(e => e[0] === 'burn')) lines.push('We burned the shack.');
  if (lines.length === 1) lines.push(gm.coop ? 'Nobody did much but keep warm.' : 'I did little but keep warm.');
  gm.diary.push([day, lines.join(' ')]);
  if (gm.diary.length > 60) gm.diary.shift();
  H.announce(gm, 'The diary', `Day ${day} is written down (the journal, J).`, 'Morning');
}
// the host: a guest did one (the list goes round with the world: work.js sharedSnap, sync.js applyShared)
let GO = null;
export function obGame(gm) { GO = gm; }
on('g-ob', m => { if (GO && GO.role === 'host' && GOALS.some(g => g.id === m.id)) GO.ob.add(m.id); });
export const objRecord = gm => [...(gm.ob || [])];
export function objRestore(gm, list) { if (Array.isArray(list)) for (const k of list) gm.ob.add(String(k)); }
