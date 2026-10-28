// HUD: stat bars, hotbar, resources, clock/money, prompts, notifications and the build menu.
import { ITEMS, RESOURCES, BUILDABLES } from './data.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.bars = { health: $('sHealth'), stamina: $('sStamina'), hunger: $('sHunger'), thirst: $('sThirst'), oxygen: $('sOxygen') };
    this.hotbarKey = '';
    this.resKey = '';
    this.icons = {};
    this.promptText = '';
    const hb = $('hotbar');
    this.slotEls = [];
    for (let i = 0; i < 10; i++) {
      const d = document.createElement('div');
      d.className = 'hs';
      d.innerHTML = `<span class="n">${(i + 1) % 10}</span><img alt=""><span class="c"></span><div class="dur"><i></i></div>`;
      hb.appendChild(d);
      this.slotEls.push(d);
    }
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  update() {
    const p = this.game.player, inv = this.game.inventory, w = this.game.world;
    for (const k of ['health', 'stamina', 'hunger', 'thirst', 'oxygen']) this.bars[k].style.width = `${Math.max(0, p[k])}%`;
    $('oxyRow').classList.toggle('show', p.oxygen < 99.5);

    const key = JSON.stringify(inv.slots) + inv.selected;
    if (key !== this.hotbarKey) {
      this.hotbarKey = key;
      inv.slots.forEach((s, i) => {
        const el = this.slotEls[i];
        el.classList.toggle('sel', i === inv.selected);
        const img = el.querySelector('img');
        const c = el.querySelector('.c');
        const dur = el.querySelector('.dur');
        if (!s) { img.removeAttribute('src'); img.style.visibility = 'hidden'; c.textContent = ''; dur.style.display = 'none'; el.title = ''; return; }
        const def = ITEMS[s.id];
        img.src = this.icons[s.id] || ''; img.style.visibility = 'visible';
        el.title = def.name;
        c.textContent = s.count > 1 ? s.count : def.kind === 'drink' ? `${s.charges}/${def.charges}` : '';
        if (def.durability) { dur.style.display = 'block'; dur.firstChild.style.width = `${(s.durability / def.durability) * 100}%`; } else dur.style.display = 'none';
      });
    }

    const rk = JSON.stringify(inv.resources);
    if (rk !== this.resKey) {
      this.resKey = rk;
      $('resources').innerHTML = Object.keys(RESOURCES).map((k) =>
        `<div class="res"><img src="${this.icons[k] || ''}" alt=""><div><small>${RESOURCES[k].name}</small><b>${inv.resources[k] || 0}</b></div></div>`).join('');
    }

    const h = Math.floor(w.time), m = Math.floor((w.time - h) * 60);
    $('clock').textContent = `DAY ${w.day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('money').textContent = `$${Math.floor(inv.money)}`;
    const ipm = this.game.building.incomePerMin || 0;
    $('income').textContent = ipm ? `+$${ipm}/min from cages` : '';
    $('nightTint').style.opacity = (1 - w.daylight) * 0.8;
  }

  setPrompt(html) {
    if (html === this.promptText) return;
    this.promptText = html;
    $('prompt').innerHTML = html;
  }

  setHint(t) { $('hint').textContent = t; }

  notify(text, kind = 'info') {
    const box = $('notes');
    // avoid stacking the same message
    if ([...box.children].some((c) => c.textContent === text)) return;
    const d = document.createElement('div');
    d.className = kind; d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 4200);
  }

  flashDamage() {
    const d = $('damage');
    d.style.transition = 'none'; d.style.opacity = 1;
    requestAnimationFrame(() => { d.style.transition = 'opacity 0.8s'; d.style.opacity = 0; });
  }

  // ------------------------------------------------------------------ build menu
  openBuildMenu() {
    const res = this.game.inventory.resources;
    $('buildList').innerHTML = Object.entries(BUILDABLES).map(([id, b]) => {
      const afford = Object.entries(b.cost).every(([k, v]) => (res[k] || 0) >= v);
      const cost = Object.entries(b.cost).map(([k, v]) => `<span class="${(res[k] || 0) >= v ? 'ok' : 'no'}">${RESOURCES[k].name} ${res[k] || 0}/${v}</span>`).join('');
      return `<button class="bcard ${afford ? '' : 'poor'}" data-id="${id}"><h3>${b.name}</h3><p>${b.desc}</p><div class="cost">${cost}</div></button>`;
    }).join('');
    $('buildMenu').classList.remove('hidden');
    $('buildList').querySelectorAll('.bcard').forEach((b) => {
      b.onclick = () => this.game.chooseBuild(b.dataset.id);
      b.onmouseenter = () => this.game.audio.ui('hover');
    });
  }

  closeBuildMenu() { $('buildMenu').classList.add('hidden'); }
}
