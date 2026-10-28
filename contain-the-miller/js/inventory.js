// Hotbar (10 slots), raw resources and money.
import { ITEMS, START_HOTBAR, START_RESOURCES } from './data.js';

export class Inventory {
  constructor() { this.reset(); }

  reset() {
    this.slots = START_HOTBAR.map((s) => (s ? { ...s } : null));
    this.resources = { ...START_RESOURCES };
    this.money = 0;
    this.selected = 0;
  }

  get current() { return this.slots[this.selected]; }

  addItem(id, count = 1) {
    const def = ITEMS[id];
    const max = def.stack || 1;
    for (const s of this.slots) {
      if (s && s.id === id && max > 1 && s.count < max) {
        const add = Math.min(count, max - s.count);
        s.count += add; count -= add;
        if (!count) return true;
      }
    }
    while (count > 0) {
      const i = this.slots.findIndex((s) => !s);
      if (i < 0) return false;
      const add = Math.min(count, max);
      this.slots[i] = { id, count: add };
      count -= add;
    }
    return true;
  }

  consumeSelected(n = 1) {
    const s = this.current;
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  addResource(k, n) { this.resources[k] = (this.resources[k] || 0) + n; }

  serialize() { return { slots: this.slots, resources: this.resources, money: this.money, selected: this.selected }; }

  restore(d) {
    this.slots = d.slots.map((s) => (s ? { ...s } : null));
    this.resources = { ...START_RESOURCES, ...d.resources };
    this.money = d.money || 0;
    this.selected = d.selected || 0;
  }
}
