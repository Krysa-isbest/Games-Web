// CHUCK-OS: the shop computer as a little desktop with apps.
import { G, level } from './state.js';
import { ITEMS, itemById, CATS } from './data.js';
import { marketPrice, trend, dueRemaining, weekEnd, INTEREST, INSTALLMENT, BIG_BUY, isAuctionDay, nextAuction, dayName, bidStep, value } from './economy.js';
import { CATALOG, catItem, ownedText } from './shop.js';
import { act, online } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const APPS = {
  market: { icon: '📈', name: 'Market', color: '#3a8a5a' },
  stock: { icon: '📦', name: 'My Stock', color: '#8a6a2a' },
  supplier: { icon: '🚚', name: 'Supplier', color: '#2a6a9a' },
  tools: { icon: '🧰', name: 'Tools & Gear', color: '#9a5a2a' },
  weapons: { icon: '🔫', name: 'Weapons', color: '#6a2a2a' },
  upgrades: { icon: '🏗️', name: 'Upgrades', color: '#5a3a8a' },
  auction: { icon: '🔨', name: 'Auction', color: '#a08020' },
  bank: { icon: '🏦', name: 'Bank', color: '#2a4a7a' },
  stats: { icon: '📊', name: 'Stats', color: '#4a4a5a' },
};
let app = 'market', query = '', cat = 'all', timer = 0;

const row = (icon, name, mid, btn = '') => `<div class="pc-row"><span class="big">${icon}</span><span class="grow">${name}</span>${mid}${btn}</div>`;
const pct = t => `<small class="${t >= 0 ? 'up' : 'down'}">${t >= 0 ? '▲' : '▼'}${Math.abs(t * 100).toFixed(0)}%</small>`;

function shopList(list) {
  return `<div class="list">${list.map(it => {
    const own = ownedText(it), locked = (it.req && !it.req()) || (it.needs && !G.weapons[it.needs]);
    const permit = it.permit && !G.up.permit;
    const have = it.kind === 'gear' ? `<span class="dim">Have ${G.gear[it.gear || it.id]}</span>` : '';
    const btn = own ? '<button disabled>Owned ✓</button>' : locked ? '<button disabled>🔒</button>' : permit ? '<button disabled>📜 Permit</button>'
      : `<button data-buy="${it.id}" class="${it.cost >= BIG_BUY ? 'pricey' : ''}">Buy</button>`;
    return row(it.icon, `<b>${it.name}</b><br><small class="dim">${it.desc}</small>`, `${have}<span class="price">${UI.money(it.cost)}</span>`, btn);
  }).join('')}</div>`;
}

const VIEWS = {
  market: () => `<div class="os-tools"><input id="pc-q" class="search" placeholder="🔍 Search an item…" value="${query}">
    <select id="pc-cat"><option value="all">All categories</option>${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${cat === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="dim small">Today's prices (${dayName()}, Day ${G.day}). Prices change every morning inside each item's range. Real worth also depends on condition.</p>
    <div class="list">${ITEMS.filter(i => (cat === 'all' || i.cat === cat) && i.name.toLowerCase().includes(query.toLowerCase())).map(i =>
      row(i.icon, `${i.name}${i.weapon ? ' <small class="down">permit</small>' : ''}<br><small class="dim">${CATS[i.cat]} · range ${UI.money(i.range[0])}–${UI.money(i.range[1])}</small>`,
        `<span class="price">${UI.money(marketPrice(i.id))} ${pct(trend(i.id))}</span>`)).join('') || '<p class="dim">No results.</p>'}</div>`,

  stock: () => {
    const dealer = i => ['big', 'car', 'scrap'].includes(itemById(i.id).cat);
    return `<p class="dim small">Everything in your stock crates. Big stuff, car parts and scrap can be sold to a dealer here (85 % of worth). ${G.up.workshop ? 'Repair broken items at the workshop bench.' : ''}</p>
    <div class="list">${G.backstock.map(i => { const d = itemById(i.id);
      return row(d.icon, `${d.name}${i.broken ? ' <small class="down">🔧 broken</small>' : ''}${i.fake && i.est?.fake ? ' <small class="down">fake</small>' : ''}<br><small class="dim">${i.est ? `est. ${UI.money(i.est.lo)}–${UI.money(i.est.hi)}` : 'not inspected'} · market ${UI.money(marketPrice(i.id))}</small>`,
        '', `${G.tools.magnifier && !i.est ? `<button data-insp="${i.uid}" class="ghost">🔍</button>` : ''}${dealer(i) ? `<button data-deal="${i.uid}">Sell to dealer</button>` : ''}`);
    }).join('') || '<p class="dim">Your stock is empty.</p>'}</div>`;
  },

  supplier: () => `<p class="dim">Wholesale deals, new every morning. Bought items go to your stock crates.</p>
    <div class="list">${G.deals.map((d, i) => { const it = itemById(d.inst.id);
      return row(it.icon, `${it.name}<br><small class="dim">market ${UI.money(marketPrice(it.id))} · good condition</small>`, `<span class="price">${UI.money(d.cost)}</span>`, `<button data-deal-buy="${i}">Buy</button>`);
    }).join('') || '<p class="dim">Sold out for today.</p>'}</div>`,

  tools: () => `<p class="dim">Gear for night expeditions. Tools are yours for good; the team shares everything.</p>${shopList(CATALOG.tools)}`,
  weapons: () => `<p class="${G.up.permit ? 'ok' : 'down'}">${G.up.permit ? '📜 Gun permit: valid.' : '📜 No gun permit: guns are locked (buy the permit in Upgrades).'}</p>
    <p class="dim small">Batons, pepper spray and tasers <b>stun</b>. Bats and guns <b>kill</b>. Stuns get shorter on high-skull nights.</p>${shopList(CATALOG.weapons)}`,
  upgrades: () => shopList(CATALOG.upgrades),

  auction: () => {
    const A = G.auction;
    if (!isAuctionDay() || !A) return `<div class="center-msg"><div class="huge">🔨</div><h3>The auction house is closed today</h3><p>Auctions happen every <b>Saturday</b>. Next one: <b>Day ${nextAuction()}</b>.</p><p class="dim">Expensive, rare items. You bid against other dealers.</p></div>`;
    if (G.phase === 'evening') return '<div class="center-msg"><h3>The auction is over for today.</h3></div>';
    if (!A.started && A.cur === 0) return `<div class="center-msg"><div class="huge">🔨</div><h3>Saturday Auction</h3>
      <div class="list">${A.lots.map(l => { const d = itemById(l.inst.id); return row(d.icon, d.name, `<span class="dim">starts at ${UI.money(l.bid)}</span>`); }).join('')}</div>
      <div class="row"><button id="au-go">Join the auction ▶</button></div></div>`;
    const lot = A.lots[A.cur];
    if (!lot) return `<div class="center-msg"><h3>All lots are sold.</h3>${A.lots.map(l => `<p>${itemById(l.inst.id).icon} ${itemById(l.inst.id).name}: <b>${l.state === 'sold' && l.leader && l.leader !== 'npc' ? 'YOURS for ' + UI.money(l.bid) : 'went to someone else'}</b></p>`).join('')}</div>`;
    const d = itemById(lot.inst.id), mine = lot.leader && lot.leader !== 'npc';
    return `<div class="auction"><div class="lot-head"><span class="huge">${d.icon}</span><div><h3>Lot ${A.cur + 1}/${A.lots.length}: ${d.name}</h3>
      <small class="dim">market ${UI.money(marketPrice(d.id))} · ${lot.inst.q >= 1.1 ? 'excellent' : lot.inst.q >= 0.95 ? 'good' : 'fair'} condition</small></div></div>
      <div class="bid-big ${mine ? 'up' : ''}">${UI.money(lot.bid)}</div>
      <p>${!lot.leader ? 'No bids yet.' : mine ? '<b class="up">You lead!</b>' : '<b class="down">Another dealer leads.</b>'} · ⏱ ${Math.max(0, Math.ceil(lot.t))} s</p>
      ${UI.meter(lot.t / 30, 'time')}
      <div class="row"><button id="au-bid" ${mine ? 'disabled' : ''}>Bid ${UI.money(lot.leader ? lot.bid + bidStep(lot) : lot.bid)}</button></div></div>`;
  },

  bank: () => { const due = dueRemaining(); return `<div class="bank">
    <div class="dim">Loan balance</div><div class="big-num">${UI.money(G.debt)}</div>
    <div class="dim">${(INTEREST * 100).toFixed(1)}% interest per day</div>
    <p>Weekly installment: <b>${UI.money(INSTALLMENT)}</b>, due at the end of <b>Day ${weekEnd()}</b> (Sunday).<br>
    Paid this week: ${UI.money(G.paidWeek)} · Remaining: <b class="${due ? 'down' : 'up'}">${UI.money(due)}</b></p>
    <p class="dim">IRS strikes: ${G.strikes}/3. Missing a weekly payment means the IRS seizes your stuff. Third strike = prison.</p>
    <div class="row"><button id="pay-due" ${due ? '' : 'disabled'}>Pay installment (${UI.money(Math.min(due, G.money))})</button></div>
    <div class="row"><span class="field"><span>$</span><input id="pay-amt" type="number" min="1" value="100"></span><button id="pay-x" class="ghost">Pay extra</button>
    <button id="pay-all" class="danger">Pay off everything</button></div></div>`; },

  stats: () => `<div class="stats-grid">
    <div><small>Level</small><b>${level()}</b><small class="dim">${G.xp} XP</small></div>
    <div><small>Trust</small><b>+${Math.round(G.trust * 100)}%</b><small class="dim">customers pay more</small></div>
    <div><small>Today's sales</small><b>${UI.money(G.stats.sales)}</b><small class="dim">${G.stats.sold} items</small></div>
    <div><small>Stock</small><b>${G.backstock.length}</b><small class="dim">items in crates</small></div>
    <div><small>Hens</small><b>${G.up.chickens}</b><small class="dim">${G.eggs} eggs</small></div>
    <div><small>Tonight</small><b>${G.night ? UI.skulls(G.night.alley) : '-'}</b><small class="dim">Back Alley</small></div>
    <div><small>Tonight</small><b>${G.night ? UI.skulls(G.night.junkyard) : '-'}</b><small class="dim">Junkyard</small></div>
    </div><p class="dim small">Trust grows slowly with every fair sale. Angry customers lower it.</p>`,
};

async function buy(catName, id) {
  const it = catItem(catName, id);
  if (it.cost >= BIG_BUY && !online()) {
    if (!await UI.confirmBox(`<h3>${it.icon} ${it.name}</h3><p>Buy this for <b>${UI.money(it.cost)}</b>?</p><p class="dim">You have ${UI.money(G.money)}.</p>`, 'Buy it')) return;
  }
  const r = await act('buy', catName, id, G.camPos);
  if (r?.msg) UI.toast(r.msg, r.ok || r.waiting ? '' : 'bad');
  if (r?.ok && r.sid) { UI.closePanel(); G.startCarry?.(r.sid); return; }
  render();
}

const BIND = {
  market(body) {
    const q = UI.$('pc-q');
    q.oninput = () => { query = q.value; render(); const n = UI.$('pc-q'); n.focus(); n.setSelectionRange(query.length, query.length); };
    UI.$('pc-cat').onchange = e => { cat = e.target.value; render(); };
    void body;
  },
  stock(body) {
    body.querySelectorAll('[data-insp]').forEach(b => b.onclick = async () => { await act('inspectItem', b.dataset.insp); render(); });
    body.querySelectorAll('[data-deal]').forEach(b => b.onclick = async () => { await act('sellToDealer', b.dataset.deal); render(); });
  },
  supplier(body) {
    body.querySelectorAll('[data-deal-buy]').forEach(b => b.onclick = async () => { await act('buyDeal', +b.dataset.dealBuy); render(); });
  },
  tools: body => body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy('tools', b.dataset.buy)),
  weapons: body => body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy('weapons', b.dataset.buy)),
  upgrades: body => body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy('upgrades', b.dataset.buy)),
  auction() {
    if (UI.$('au-go')) UI.$('au-go').onclick = async () => { await act('auctionStart'); render(); };
    if (UI.$('au-bid')) UI.$('au-bid').onclick = async () => { await act('auctionBid'); render(); };
  },
  bank() {
    const after = () => { if (G.debt <= 0) UI.closePanel(false); else render(); };
    UI.$('pay-due').onclick = async () => { await act('payLoan', 'due'); after(); };
    UI.$('pay-x').onclick = async () => { await act('payLoan', 'x', +UI.$('pay-amt').value || 0); after(); };
    UI.$('pay-all').onclick = async () => { await act('payLoan', 'all'); after(); };
  },
};

function render() {
  const body = UI.$('pc-body');
  if (!body) return;
  const scroll = body.querySelector('.list')?.scrollTop || 0;
  document.querySelectorAll('[data-app]').forEach(b => b.classList.toggle('on', b.dataset.app === app));
  UI.$('os-title').innerHTML = `${APPS[app].icon} ${APPS[app].name}`;
  UI.$('os-win').style.setProperty('--app', APPS[app].color);
  body.innerHTML = VIEWS[app]();
  BIND[app]?.(body);
  const l = body.querySelector('.list'); if (l) l.scrollTop = scroll;
  body.querySelectorAll('button').forEach(b => b.addEventListener('click', sfx.click));
  UI.$('os-cash').textContent = UI.money(G.money);
  UI.$('os-clock').textContent = `${dayName()} · Day ${G.day} · ${UI.clock()}`;
  UI.hud();
}

export function openComputer() {
  UI.openPanel(`<div class="os">
    <div class="os-desk">
      <div class="os-icons">${Object.entries(APPS).map(([k, a]) => `<button class="os-icon" data-app="${k}" style="--c:${a.color}"><span>${a.icon}</span>${a.name}${k === 'auction' && isAuctionDay() && G.auction ? '<em>!</em>' : ''}</button>`).join('')}</div>
      <div class="os-win" id="os-win"><div class="os-titlebar"><span id="os-title"></span><span class="os-dots"><i></i><i></i><i id="os-x2"></i></span></div><div class="os-body" id="pc-body"></div></div>
    </div>
    <div class="os-bar"><b class="os-start">▣ CHUCK-OS</b><span class="grow"></span><span id="os-clock"></span><span class="os-cash" id="os-cash"></span><button id="pc-x" class="ghost">Log off ✕</button></div>
  </div>`, { cls: 'pc os-panel' });
  document.querySelectorAll('[data-app]').forEach(b => b.onclick = () => { app = b.dataset.app; render(); });
  UI.$('pc-x').onclick = () => UI.closePanel();
  UI.$('os-x2').onclick = () => UI.closePanel();
  render();
  clearInterval(timer);
  timer = setInterval(() => {
    if (!UI.$('pc-body')) return clearInterval(timer);
    if (app === 'auction' || app === 'stats') render();
    else { UI.$('os-cash').textContent = UI.money(G.money); UI.$('os-clock').textContent = `${dayName()} · Day ${G.day} · ${UI.clock()}`; }
  }, 400);
}

void value;
