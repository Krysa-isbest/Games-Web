// The inventory screen (Tab), laid out like an extraction shooter's: your equipment on the left (shield,
// melee weapon, the two weapon cards), the backpack, quick-use slots and safe pocket in the middle, and a
// container on the right while you search a wreck or a crate. Drag and drop moves things (stacks merge,
// gear swaps), dragging something out of the window drops it on the ground, right-click opens a menu
// (use, equip, split, drop...), shift-click sends it across, double-click uses or equips it.
// The world keeps running while it is open.
//
// Every change goes through apply(op), one door, so a co-op host can check the same operations later.
import { ITEMS, RARITY, CATEGORY } from '../game/items.js';
import { getAt, move, split, removeAt, takeFrom, transfer, takeAll, equipSlotFor, syncShield, accepts, weight, MAX_WEIGHT,
  BAG_SLOTS, QUICK_SLOTS, SAFE_SLOTS, count } from '../game/inventory.js';
import { startUse, cannotUse } from '../game/weapons.js';
import { SHIELDS } from '../game/stats.js';
import { P } from '../core/save.js';
import { bus } from '../core/events.js';
import { kn, BINDS } from '../core/input.js';
import { uiSfx } from '../core/sound.js';
import { $, esc } from '../core/util.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); return e; };
const icon = id => `<svg class="ic"><use href="#it-${ITEMS[id].icon}"/></svg>`;
const refOf = e => e && e.dataset.a ? { a: e.dataset.a, i: e.dataset.a === 'equip' ? e.dataset.i : +e.dataset.i } : null;
const sameRef = (a, b) => !!a && !!b && a.a === b.a && String(a.i) === String(b.i);
const EQUIP_NAMES = { shield: 'Shield', melee: 'Melee', weapon1: 'Weapon 1', weapon2: 'Weapon 2' };
const kg = v => v.toFixed(1);

export class InventoryScreen {
  // world = { drop(p, item) } (the ground loot); onClose = called after the screen closes
  constructor(player, world, { onClose = null } = {}) {
    this.p = player; this.world = world; this.onClose = onClose;
    this.open = false; this.box = null; this.sig = ''; this.drag = null; this.menuRef = null;
    this.root = $('inv');
    this.build();
    this.offs = [
      bus.on('input:escape', () => { if (this.open) { if (this.menuRef) this.hideMenu(); else this.close(); } }),
    ];
    this._key = e => this.onKey(e);
    this._move = e => this.onMove(e);
    this._up = e => this.onUp(e);
    addEventListener('keydown', this._key, true);
  }

  // ---------- building the page once ----------
  build() {
    const r = this.root;
    r.innerHTML = '';
    const head = el('header', 'inv-head', r);
    const t = el('div', 'inv-title', head);
    t.innerHTML = '<small>Raider</small><h2>Inventory</h2>';
    const wt = this.wt = el('div', 'inv-weight', head);
    wt.innerHTML = '<span class="iw-label">Weight</span><b id="inv-wt">0.0</b><span>/ ' + kg(MAX_WEIGHT) + ' kg</span><i><s id="inv-wtbar"></s></i>';
    const cr = el('div', 'inv-cr', head);
    cr.innerHTML = '<svg><use href="#i-cr"/></svg><b id="inv-cr">0</b>';
    this.closeBtn = el('button', 'inv-close', head);
    this.closeBtn.innerHTML = `<kbd>${esc(kn('inventory'))}</kbd>Close`;
    this.closeBtn.addEventListener('click', () => this.close());

    const cols = this.cols = el('div', 'inv-cols', r);
    // equipment
    const eq = el('section', 'inv-col inv-equip', cols);
    el('h4', '', eq).innerHTML = 'Equipment';
    const small = el('div', 'eq-small', eq);
    this.slots = [];
    const mk = (parent, a, i, cls = 'slot') => { const s = el('div', cls, parent); s.dataset.a = a; s.dataset.i = String(i); this.slots.push(s); return s; };
    mk(small, 'equip', 'shield', 'slot eq');
    mk(small, 'equip', 'melee', 'slot eq');
    mk(eq, 'equip', 'weapon1', 'slot card');
    mk(eq, 'equip', 'weapon2', 'slot card');
    // backpack, quick use, safe pocket
    const bag = el('section', 'inv-col inv-bag', cols);
    this.hBag = el('h4', '', bag);
    const g1 = el('div', 'grid', bag);
    for (let i = 0; i < BAG_SLOTS; i++) mk(g1, 'bag', i);
    this.hQuick = el('h4', '', bag);
    const g2 = el('div', 'grid quick', bag);
    for (let i = 0; i < QUICK_SLOTS; i++) mk(g2, 'quick', i);
    this.hSafe = el('h4', '', bag);
    const g3 = el('div', 'grid safe', bag);
    for (let i = 0; i < SAFE_SLOTS; i++) mk(g3, 'safe', i);
    // a container
    const box = this.boxCol = el('section', 'inv-col inv-box hidden', cols);
    const bh = el('div', 'box-head', box);
    this.hBox = el('h4', '', bh);
    this.takeAllBtn = el('button', 'btn small', bh);
    this.takeAllBtn.textContent = 'Take all';
    this.takeAllBtn.addEventListener('click', () => this.apply({ t: 'takeAll' }));
    this.boxGrid = el('div', 'grid', box);
    this.boxSlots = [];
    // the line of hints along the bottom
    const foot = el('footer', 'inv-foot', r);
    foot.innerHTML = '<span><b>Drag</b> move</span><span><b>Right-click</b> options</span><span><b>Shift-click</b> move across</span>' +
      '<span><b>Double-click</b> use / equip</span><span><b>Drag outside</b> drop on the ground</span>';
    // tooltip, menu, the item being dragged
    this.tip = $('inv-tip'); this.menu = $('inv-menu'); this.ghost = $('inv-ghost');

    r.addEventListener('pointerdown', e => this.onDown(e));
    r.addEventListener('dblclick', e => this.onDouble(e));
    r.addEventListener('contextmenu', e => this.onContext(e));
    r.addEventListener('pointerover', e => this.onOver(e));
    r.addEventListener('pointerout', e => { if (!e.relatedTarget || !this.root.contains(e.relatedTarget)) this.hideTip(); });
    this.menu.addEventListener('click', e => this.onMenu(e));
  }
  boxSlotsFor(n) {
    while (this.boxSlots.length < n) {
      const s = el('div', 'slot', this.boxGrid);
      s.dataset.a = 'box'; s.dataset.i = String(this.boxSlots.length);
      this.boxSlots.push(s);
    }
    this.boxSlots.forEach((s, i) => s.classList.toggle('hidden', i >= n));
  }

  // ---------- opening and closing ----------
  show(box = null) {
    this.box = box || null;
    if (box && box.revealed === undefined) { box.revealed = 0; box.revealT = 0; }
    this.open = true;
    this.sig = '';
    this.root.classList.remove('hidden');
    document.body.classList.add('inv-open');
    this.render(true);
    uiSfx.click();
    bus.emit('inv:open', box);
  }
  close() {
    if (!this.open) return;
    this.cancelDrag();
    this.hideMenu(); this.hideTip();
    this.open = false;
    this.root.classList.add('hidden');
    document.body.classList.remove('inv-open');
    uiSfx.back();
    bus.emit('inv:close');
    this.onClose?.();
  }
  onKey(e) {
    if (!this.open) return;
    const code = e.code === 'ShiftLeft' || e.code === 'ShiftRight' ? 'Shift' : e.code;
    if (code === BINDS.inventory || code === 'Tab') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) this.close(); }
  }

  // ---------- every frame while open: the container's search, walking away, redrawing what changed ----------
  update(dt) {
    if (!this.open) return;
    const p = this.p, b = this.box;
    if (p.dead) { this.close(); return; }
    if (b) {
      if (b.pos && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) > (b.reach || 3.2)) { this.box = null; this.hideMenu(); }
      else if (b.revealed < b.slots.length) {                // searching: things turn up one by one
        b.revealT += dt;
        while (b.revealT >= 0.28 && b.revealed < b.slots.length) {
          b.revealT -= 0.28;
          if (b.slots[b.revealed]) uiSfx.hover();
          b.revealed++;
          while (b.revealed < b.slots.length && !b.slots[b.revealed]) b.revealed++;
        }
      }
    }
    this.render();
  }
  // redraws only when something changed
  render(force = false) {
    const p = this.p, inv = p.inv, b = this.box;
    const part = it => it ? `${it.id}:${it.n}:${it.d ? (it.d.ammo ?? '') + '/' + (it.d.hp !== undefined ? Math.ceil(it.d.hp) : '') + (it.d.broken ? 'x' : '') : ''}` : '-';
    const sig = [Object.values(inv.equip).map(part), inv.bag.map(part), inv.quick.map(part), inv.safe.map(part),
      b ? b.id + '|' + b.revealed + '|' + b.slots.map(part) : 'nobox', p.using ? p.using.ref.a + p.using.ref.i : '', P.credits].join(';');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    for (const s of this.slots) this.drawSlot(s, getAt(inv, refOf(s), b));
    const used = arr => arr.filter(Boolean).length;
    this.hBag.innerHTML = `Backpack <span>${used(inv.bag)}/${BAG_SLOTS}</span>`;
    this.hQuick.innerHTML = `Quick use <span>${used(inv.quick)}/${QUICK_SLOTS}</span><em>${esc(kn('wheel'))} item wheel</em>`;
    this.hSafe.innerHTML = `Safe pocket <span>${used(inv.safe)}/${SAFE_SLOTS}</span><em>kept when you die</em>`;
    const w = weight(inv);
    $('inv-wt').textContent = kg(w);
    $('inv-wtbar').style.width = Math.min(100, w / MAX_WEIGHT * 100).toFixed(1) + '%';
    this.wt.classList.toggle('over', w > MAX_WEIGHT);
    $('inv-cr').textContent = (P.credits || 0).toLocaleString('en-US');
    this.boxCol.classList.toggle('hidden', !b);
    this.cols.classList.toggle('with-box', !!b);
    if (b) {
      this.boxSlotsFor(b.slots.length);
      this.hBox.innerHTML = `${esc(b.name)} <span>${used(b.slots)}/${b.slots.length}</span>`;
      this.boxSlots.forEach((s, i) => { if (i < b.slots.length) this.drawSlot(s, i < b.revealed ? b.slots[i] : null, i >= b.revealed); });
      this.takeAllBtn.disabled = !b.slots.some(Boolean) || b.revealed < b.slots.length;
    }
  }
  drawSlot(s, it, searching = false) {
    const ref = refOf(s), card = s.classList.contains('card');
    const using = this.p.using && sameRef(this.p.using.ref, ref);
    s.className = s.className.split(' ').filter(c => c === 'slot' || c === 'card' || c === 'eq' || c === 'hidden').join(' ') +
      (it ? ' full r-' + ITEMS[it.id].rarity : ' empty') + (searching ? ' searching' : '') + (using ? ' using' : '');
    if (searching) { s.innerHTML = '<i class="spin"></i>'; return; }
    if (!it) {
      s.innerHTML = ref.a === 'equip' ? `<span class="hint">${EQUIP_NAMES[ref.i]}</span>` : ref.a === 'quick' ? `<span class="hint">${ref.i + 1}</span>` : '';
      return;
    }
    const def = ITEMS[it.id];
    let extra = '';
    if (def.weapon) {
      const W = def.weapon;
      extra = card
        ? `<span class="c-name">${esc(def.name)}</span><span class="c-ammo"><b>${it.d.ammo}</b>/${W.mag}<em>${esc(ITEMS[W.ammo].name)} · ${count(this.p.inv, W.ammo)}</em></span><span class="c-key">${ref.i === 'weapon1' ? esc(kn('weapon1')) : esc(kn('weapon2'))}</span>`
        : `<i class="bar"><s style="width:${(it.d.ammo / W.mag * 100).toFixed(0)}%"></s></i>`;
    } else if (def.shield) {
      const f = it.d.hp / SHIELDS[it.d.type].hp;
      extra = `<i class="bar sh${it.d.broken ? ' broken' : ''}"><s style="width:${(f * 100).toFixed(0)}%"></s></i>`;
    } else if (it.n > 1 || def.stack > 1) extra = `<b class="n">${it.n}</b>`;
    if (ref.a === 'equip' && ref.i === 'melee' && !card) extra += `<span class="c-key">${esc(kn('melee'))}</span>`;
    s.innerHTML = icon(it.id) + extra + (using ? '<i class="use-ring"></i>' : '');
  }

  // ---------- the one door for every change ----------
  apply(op) {
    const p = this.p, inv = p.inv, box = this.box;
    let ok = false;
    switch (op.t) {
      case 'move': ok = move(inv, op.from, op.to, box); break;
      case 'split': ok = split(inv, op.ref, box); break;
      case 'take': ok = takeFrom(inv, op.ref, box) > 0; break;
      case 'store': ok = !!box && transfer(inv, op.ref, 'box', box); break;
      case 'stow': ok = transfer(inv, op.ref, 'bag', box); break;
      case 'safe': ok = transfer(inv, op.ref, 'safe', box); break;
      case 'quick': ok = transfer(inv, op.ref, 'quick', box); break;
      case 'equip': {
        const it = getAt(inv, op.ref, box), s = it && equipSlotFor(inv, it, p.wpn.active);
        ok = !!s && move(inv, op.ref, { a: 'equip', i: s }, box);
        break;
      }
      case 'use': ok = op.ref.a !== 'box' && startUse(p, op.ref); break;
      case 'drop': {
        const it = getAt(inv, op.ref, box);
        if (it && this.world) { removeAt(inv, op.ref, box); this.world.drop(p, it); ok = true; }
        break;
      }
      case 'takeAll': ok = !!box && box.revealed >= box.slots.length && takeAll(inv, box).length > 0; break;
    }
    syncShield(p);
    if (ok) { if (op.t !== 'use') uiSfx.click(); bus.emit('inv:changed', op); }
    else if (op.t !== 'use') uiSfx.error();
    this.render();
    return ok;
  }

  // ---------- the mouse ----------
  slotAt(x, y) {
    const e = document.elementFromPoint(x, y);
    return e && e.closest ? e.closest('.slot') : null;
  }
  itemOf(s) {
    const ref = refOf(s);
    if (!ref) return null;
    if (ref.a === 'box' && this.box && ref.i >= this.box.revealed) return null;
    return getAt(this.p.inv, ref, this.box);
  }
  onDown(e) {
    if (e.button !== 0) return;
    this.hideMenu();
    const s = e.target.closest && e.target.closest('.slot');
    if (!s || !this.itemOf(s)) return;
    e.preventDefault();
    if (e.shiftKey) { this.quickMove(refOf(s)); return; }
    this.drag = { ref: refOf(s), x: e.clientX, y: e.clientY, on: false, src: s };
    addEventListener('pointermove', this._move);
    addEventListener('pointerup', this._up);
  }
  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.on = true;
      const it = this.itemOf(d.src);
      this.ghost.innerHTML = it ? icon(it.id) + (it.n > 1 ? `<b class="n">${it.n}</b>` : '') : '';
      this.ghost.className = 'inv-ghost' + (it ? ' r-' + ITEMS[it.id].rarity : '');
      d.src.classList.add('lifted');
      this.root.classList.add('dragging');
      this.hideTip();
      // light up where it can go
      for (const s of [...this.slots, ...this.boxSlots]) {
        const r = refOf(s);
        if (sameRef(r, d.ref) || s.classList.contains('hidden') || s.classList.contains('searching')) continue;
        s.classList.toggle('ok', accepts(r, it) && accepts(d.ref, getAt(this.p.inv, r, this.box)));
      }
    }
    if (d.on) {
      this.ghost.style.transform = `translate(${e.clientX - 32}px, ${e.clientY - 32}px)`;
      const over = this.slotAt(e.clientX, e.clientY);
      if (over !== d.over) { d.over?.classList.remove('over'); over?.classList.add('over'); d.over = over; }
      this.root.classList.toggle('drop-out', !over && !this.overPanel(e.clientX, e.clientY));
    }
  }
  onUp(e) {
    const d = this.drag;
    removeEventListener('pointermove', this._move);
    removeEventListener('pointerup', this._up);
    if (!d) return;
    if (d.on) {
      const s = this.slotAt(e.clientX, e.clientY);
      if (s && !s.classList.contains('searching')) { const to = refOf(s); if (!sameRef(to, d.ref)) this.apply({ t: 'move', from: d.ref, to }); }
      else if (!s && !this.overPanel(e.clientX, e.clientY)) this.apply({ t: 'drop', ref: d.ref });
    }
    this.cancelDrag();
  }
  cancelDrag() {
    const d = this.drag;
    this.drag = null;
    removeEventListener('pointermove', this._move);
    removeEventListener('pointerup', this._up);
    if (!d) return;
    d.src.classList.remove('lifted');
    d.over?.classList.remove('over');
    for (const s of [...this.slots, ...this.boxSlots]) s.classList.remove('ok');
    this.root.classList.remove('dragging', 'drop-out');
    this.ghost.className = 'inv-ghost hidden';
  }
  overPanel(x, y) {
    const e = document.elementFromPoint(x, y);
    return !!(e && e.closest && e.closest('.inv-col, .inv-head, .inv-foot'));
  }
  // shift-click: across to the container and back, or between equipment and backpack
  quickMove(ref) {
    if (ref.a === 'box') this.apply({ t: 'take', ref });
    else if (this.box) this.apply({ t: 'store', ref });
    else if (ref.a === 'equip') this.apply({ t: 'stow', ref });
    else this.primary(ref);
  }
  onDouble(e) {
    const s = e.target.closest && e.target.closest('.slot');
    if (s && this.itemOf(s)) this.primary(refOf(s));
  }
  // the obvious thing to do with an item: take it, use it, equip it, or put it away
  primary(ref) {
    const it = getAt(this.p.inv, ref, this.box);
    if (!it) return;
    const def = ITEMS[it.id];
    if (ref.a === 'box') this.apply({ t: 'take', ref });
    else if (def.use) this.apply({ t: 'use', ref });
    else if (ref.a === 'equip') this.apply({ t: 'stow', ref });
    else if (equipSlotFor(this.p.inv, it)) this.apply({ t: 'equip', ref });
  }

  // ---------- the right-click menu ----------
  onContext(e) {
    e.preventDefault();
    const s = e.target.closest && e.target.closest('.slot');
    const it = s && this.itemOf(s);
    if (!it) { this.hideMenu(); return; }
    const ref = refOf(s), def = ITEMS[it.id], acts = [];
    if (ref.a === 'box') acts.push(['take', 'Take']);
    if (def.use && ref.a !== 'box') { const why = cannotUse(this.p, it.id); acts.push(['use', why ? `Use (${why.toLowerCase()})` : `Use (${def.use.time} s)`, !!why]); }
    if (ref.a !== 'equip' && equipSlotFor(this.p.inv, it)) acts.push(['equip', 'Equip']);
    if (ref.a === 'equip') acts.push(['stow', 'Unequip']);
    if (def.quick && ref.a !== 'quick') acts.push(['quick', 'To a quick slot']);
    if (ref.a !== 'safe' && ref.a !== 'box') acts.push(['safe', 'To the safe pocket']);
    if (ref.a !== 'bag' && ref.a !== 'equip' && ref.a !== 'box') acts.push(['stow', 'To the backpack']);
    if (this.box && ref.a !== 'box') acts.push(['store', `Into the ${this.box.name.toLowerCase()}`]);
    if (!it.d && it.n > 1) acts.push(['split', `Split (${Math.floor(it.n / 2)})`]);
    acts.push(['drop', 'Drop on the ground']);
    this.menuRef = ref;
    this.menu.innerHTML = `<header>${esc(def.name)}</header>` + acts.map(([t, label, off]) => `<button data-t="${t}"${off ? ' disabled' : ''}>${esc(label)}</button>`).join('');
    this.menu.classList.remove('hidden');
    const W = innerWidth, H = innerHeight;
    this.menu.style.left = Math.min(e.clientX, W - 230) + 'px';
    this.menu.style.top = Math.min(e.clientY, H - 40 - acts.length * 34) + 'px';
    this.hideTip();
  }
  onMenu(e) {
    const b = e.target.closest && e.target.closest('button');
    if (!b || b.disabled || !this.menuRef) return;
    const ref = this.menuRef;
    this.hideMenu();
    this.apply({ t: b.dataset.t, ref });
  }
  hideMenu() { this.menuRef = null; this.menu.classList.add('hidden'); }

  // ---------- the tooltip ----------
  onOver(e) {
    if (this.drag && this.drag.on) return;
    const s = e.target.closest && e.target.closest('.slot');
    const it = s && this.itemOf(s);
    if (!it) { this.hideTip(); return; }
    this.showTip(it, s);
  }
  showTip(it, s) {
    const def = ITEMS[it.id], R = RARITY[def.rarity];
    const rows = [];
    if (def.weapon) {
      const W = def.weapon;
      rows.push(['Damage', W.damage], ['Fire rate', `${(1 / W.interval).toFixed(1)} / s`], ['Magazine', `${it.d.ammo} / ${W.mag}`], ['Ammo', ITEMS[W.ammo].name], ['Reload', `${W.reload} s`], ['Mode', W.mode === 'auto' ? 'Automatic' : 'Semi-automatic']);
    } else if (def.melee) rows.push(['Damage', def.melee.damage], ['Swing', `${def.melee.swing} s`], ['Reach', `${def.melee.reach} m`]);
    else if (def.shield) {
      const S = SHIELDS[def.shield];
      rows.push(['Defence', `${Math.round(S.def * 100)}%`], ['Shield', `${Math.ceil(it.d.hp)} / ${S.hp}${it.d.broken ? ' (broken)' : ''}`], ['Restored with', S.item]);
    } else if (def.use) {
      if (def.use.heal) rows.push(['Heals', def.use.heal]);
      if (def.use.stamina) rows.push(['Stamina', '+' + def.use.stamina]);
      if (def.use.shield) rows.push(['Shields', def.use.shield.join(', ')]);
      rows.push(['Takes', `${def.use.time} s`]);
    } else if (def.throw) rows.push(['Damage', `${def.throw.damage} within ${def.throw.radius} m`], ['Fuse', `${def.throw.fuse} s`]);
    rows.push(['Weight', `${kg((def.weight || 0) * it.n)} kg`], ['Value', `${(def.value * it.n).toLocaleString('en-US')} cr`]);
    if (def.stack > 1) rows.push(['Stack', `${it.n} / ${def.stack}`]);
    this.tip.innerHTML = `<header style="--rc:${R.color}"><small>${esc(R.name)} · ${esc(CATEGORY[def.cat])}</small><b>${esc(def.name)}</b></header>` +
      `<p>${esc(def.desc || '')}</p><dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>`;
    this.tip.classList.remove('hidden');
    const r = s.getBoundingClientRect ? s.getBoundingClientRect() : { right: 0, left: 0, top: 0 };
    const W = innerWidth, x = r.right + 270 < W ? r.right + 10 : r.left - 270;
    this.tip.style.left = Math.max(8, x) + 'px';
    this.tip.style.top = Math.max(8, Math.min(r.top, innerHeight - 300)) + 'px';
  }
  hideTip() { this.tip.classList.add('hidden'); }

  dispose() {
    this.close();
    for (const off of this.offs) off();
    removeEventListener('keydown', this._key, true);
    this.root.innerHTML = '';
  }
}
