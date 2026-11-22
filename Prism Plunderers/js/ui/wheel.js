// The item wheel: hold the wheel key (Q), push the mouse towards one of the four quick-use slots, let go to use
// it (a grenade goes into your hand, ready to throw). The camera stays still while the wheel is open and the
// world keeps going.
import { ITEMS, RARITY } from '../game/items.js';
import { cannotUse } from '../game/weapons.js';
import { kn } from '../core/input.js';
import { $, esc } from '../core/util.js';

const RADIUS = 110;          // how far the pointer can go (px of mouse movement)
const DEAD = 26;             // a small push picks nothing

export class ItemWheel {
  constructor(player) {
    this.p = player; this.open = false; this.sel = -1; this.x = 0; this.y = 0; this.sig = '';
    this.root = $('wheel');
    this.root.innerHTML = '';
    this.segs = [0, 1, 2, 3].map(i => { const s = document.createElement('div'); s.className = 'wh-seg s' + i; this.root.append(s); return s; });
    this.mid = document.createElement('div'); this.mid.className = 'wh-mid'; this.root.append(this.mid);
    this.dot = document.createElement('i'); this.dot.className = 'wh-dot'; this.root.append(this.dot);
  }
  show() {
    this.open = true; this.sel = -1; this.x = this.y = 0; this.sig = '';
    this.root.classList.remove('hidden');
    this.render();
  }
  // dx, dy: mouse movement in pixels since the last frame
  steer(dx, dy) {
    if (!this.open) return;
    this.x += dx; this.y += dy;
    const l = Math.hypot(this.x, this.y);
    if (l > RADIUS) { this.x *= RADIUS / l; this.y *= RADIUS / l; }
    if (l > DEAD) {
      const a = Math.atan2(this.y, this.x);                     // 0 = right, +pi/2 = down (screen)
      this.sel = ((Math.round(a / (Math.PI / 2)) + 1) % 4 + 4) % 4;   // up 0, right 1, down 2, left 3
    }
    this.render();
  }
  // closes the wheel; returns the quick slot picked (0..3) or -1
  hide() {
    if (!this.open) return -1;
    this.open = false;
    this.root.classList.add('hidden');
    const s = this.sel;
    this.sel = -1;
    return s >= 0 && this.p.inv.quick[s] ? s : -1;
  }
  render() {
    const inv = this.p.inv;
    const sig = inv.quick.map(it => it ? it.id + ':' + it.n : '-').join(',') + '|' + this.sel;
    this.dot.style.transform = `translate(${(this.x * 0.9).toFixed(0)}px, ${(this.y * 0.9).toFixed(0)}px)`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.segs.forEach((s, i) => {
      const it = inv.quick[i], def = it && ITEMS[it.id];
      const why = def && def.use ? cannotUse(this.p, it.id) : null;
      s.className = 'wh-seg s' + i + (it ? ' r-' + def.rarity : ' empty') + (i === this.sel ? ' on' : '') + (why ? ' no' : '');
      s.innerHTML = it ? `<svg><use href="#it-${def.icon}"/></svg><b>${it.n}</b><span>${esc(def.name)}</span>` : `<span>Empty</span>`;
    });
    const it = this.sel >= 0 ? inv.quick[this.sel] : null;
    if (it) {
      const def = ITEMS[it.id], why = def.use ? cannotUse(this.p, it.id) : null;
      this.mid.innerHTML = `<b style="color:${RARITY[def.rarity].color}">${esc(def.name)}</b><small>${esc(why || (def.throw ? 'Into your hand, then click to throw' : `${def.use.time} s to use`))}</small>`;
    } else this.mid.innerHTML = `<b>Items</b><small>Move the mouse, let go of ${esc(kn('wheel'))}</small>`;
  }
}
