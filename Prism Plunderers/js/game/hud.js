// The in-game HUD: health and shield bars (a pale "ghost" shows the damage just taken, then catches up), the
// stamina bar under the crosshair (only while it is not full), red markers that point to where a hit came
// from, the use prompt with a hold ring, short pop-ups (Dodged, Shield broken), and the low-health pulse.
// Bottom right: the weapon in your hands with its ammo, your four slots and the quick-use items. The crosshair
// opens up with the weapon's spread.
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { kn } from '../core/input.js';
import { SHIELDS } from './stats.js';
import { fwdX, fwdZ, yawOf, angDiff } from './move-math.js';
import { ITEMS, RARITY } from './items.js';
import { count, weight, MAX_WEIGHT } from './inventory.js';
import { inHand, slotItem, spreadOf } from './weapons.js';
import { PRISM } from './prism/defs.js';
import { $, esc } from '../core/util.js';
const _p = new THREE.Vector3();
// the trade value of the Prism parts (materials and valuables) in the backpack and the safe pocket
const partsValue = inv => [...inv.bag, ...inv.safe].reduce((s, it) => {
  const d = it && ITEMS[it.id];
  return d && (d.cat === 'material' || d.cat === 'valuable') ? s + d.value * it.n : s;
}, 0);
const SLOT_KEYS = [['weapon1', 'weapon1'], ['weapon2', 'weapon2'], ['melee', 'melee'], ['unarmed', 'unarmed']];

const RING = 2 * Math.PI * 16;                       // the prompt ring's circumference (r = 16)

export class Hud {
  constructor(player) {
    this.p = player;
    this.ghostH = 1; this.ghostS = 1; this.ghostWait = 0;
    this.hurt = 0;
    this.stamShow = 0;
    this.last = {};
    this.dirs = [...$('hud-dirs').children].map(e => ({ e, life: 0, from: null }));
    this.nextDir = 0;
    this.detect = [...$('hud-detect').children].map(e => ({ e, on: false }));
    for (const id of ['hud-bars', 'wpn-slots', 'wpn-quick', 'cmp-strip']) $(id).innerHTML = '';     // a second visit starts clean
    $('hud-compass').classList.add('hidden');
    this.cmp = [];
    this.bars = [];
    for (let i = 0; i < 12; i++) {
      const e = document.createElement('div'), f = document.createElement('b');
      e.className = 'ebar';
      e.append(f);
      $('hud-bars').append(e);
      this.bars.push({ e, fill: f, on: false });
    }
    this.alertT = new Map();                          // robot id -> time left showing "!"
    this.hitT = 0;
    // the weapon panel: four slot chips (1, 2, 3, H) and four quick-use chips
    this.slotEls = SLOT_KEYS.map(([slot]) => { const e = document.createElement('i'); e.dataset.s = slot; $('wpn-slots').append(e); return e; });
    this.quickEls = [0, 1, 2, 3].map(() => { const e = document.createElement('i'); $('wpn-quick').append(e); return e; });
    this.offs = [
      bus.on('damage', (t, hit, r) => { if (t === this.p) this.onHit(hit, r); }),
      bus.on('player:nostamina', t => { if (t === this.p) this.flash('stam', 'deny'); }),
      bus.on('shield', (t, what) => { if (t === this.p && what === 'restore') this.pop('Shield restored', 'good'); }),
      bus.on('heal', t => { if (t === this.p) this.pop('Healed', 'good'); }),
      bus.on('prism:alert', r => this.alertT.set(r.id, 1.2)),
      bus.on('prism:dead', r => this.pop(`${PRISM[r.type].name} destroyed`, 'kill')),
      bus.on('prism:break', (r, part) => { if (part.startsWith('thruster')) this.pop('Thruster destroyed', 'weak'); }),
      bus.on('prism:emp', t => { if (t === this.p) this.pop('EMP · shield offline', 'bad'); }),
      bus.on('prism:loot', (t, items) => {
        if (t !== this.p) return;
        if (!items.length) this.pop('Nothing you can carry', '');
        for (const it of items) this.lootPop(it.id, it.n);
      }),
      bus.on('loot:pickup', (t, id, n) => { if (t === this.p) this.lootPop(id, n); }),
      bus.on('loot:full', t => { if (t === this.p) this.pop('Backpack full', 'bad'); }),
      bus.on('use:denied', (t, why) => { if (t === this.p) this.pop(why, 'bad'); }),
      bus.on('use:stopped', t => { if (t === this.p && !t.dead) this.pop('Interrupted', 'bad'); }),
      bus.on('wpn:noammo', t => { if (t === this.p) this.pop('No ammo', 'bad'); }),
    ];
  }
  lootPop(id, n) { this.pop(`+${n} ${ITEMS[id].name}`, 'loot', RARITY[ITEMS[id].rarity].color); }

  // where you are (top left): "Test range", "The Ruins · Downtown · red zone"
  setPlace(text) {
    if (this.last.place === text) return;
    const first = this.last.place === undefined;
    this.set('place', $('hud-place'), 'text', text);
    const red = / red zone/.test(text), yellow = / yellow zone/.test(text);
    this.set('placec', $('hud-place'), 'class', 'tag-label' + (red ? ' red' : yellow ? ' yellow' : ''));
    if (!first && (red || yellow)) this.pop(red ? 'Red zone · the best loot, the most Prism' : 'Yellow zone · better loot, more Prism', red ? 'bad' : 'weak');
  }
  // the compass along the top: north, east..., and markers [{ name, short, x, z, kind: 'extract' | 'landmark' }]
  setMarkers(list) {
    const box = $('cmp-strip');
    box.innerHTML = '';
    this.cmp = [];
    const D = [['N', 0], ['NE', -Math.PI / 4], ['E', -Math.PI / 2], ['SE', -Math.PI * 0.75], ['S', Math.PI], ['SW', Math.PI * 0.75], ['W', Math.PI / 2], ['NW', Math.PI / 4]];
    for (const [t, yaw] of D) {
      const e = document.createElement('b');
      e.className = t.length === 1 ? 'cd main' : 'cd'; e.textContent = t;
      box.append(e);
      this.cmp.push({ e, yaw, x: '' });
    }
    for (const m of list) {
      const e = document.createElement('i'), s = document.createElement('span');
      e.className = 'cm ' + m.kind;
      s.textContent = m.short || m.name;
      e.append(s);
      box.append(e);
      this.cmp.push({ e, m, s, x: '' });
    }
    $('hud-compass').classList.remove('hidden');
  }
  updateCompass(camYaw, p) {
    const W = 230, SPAN = 1.25;                         // half width in pixels, half the angle shown
    for (const c of this.cmp) {
      const dx = c.m ? c.m.x - p.pos.x : 0, dz = c.m ? c.m.z - p.pos.z : 0;
      const d = angDiff(camYaw, c.m ? yawOf(dx, dz) : c.yaw);
      const on = Math.abs(d) < SPAN;
      const x = on ? (-d / SPAN * W).toFixed(0) : 'off';
      if (x !== c.x) {
        c.x = x;
        c.e.style.opacity = on ? String((1 - Math.abs(d) / SPAN * 0.7).toFixed(2)) : '0';
        if (on) c.e.style.transform = `translateX(${x}px)`;
      }
      if (c.m && on) {
        const dist = `${c.m.short || c.m.name} · ${Math.round(Math.hypot(dx, dz))} m`;
        if (c.s.textContent !== dist) c.s.textContent = dist;
      }
    }
  }
  // the crosshair's hit marker: 'hit', 'weak' (a weak point or a thruster) or 'kill'
  hitmarker(kind) {
    const e = $('xhit');
    e.className = 'xhit ' + kind;
    void e.offsetWidth;
    e.classList.add('on');
    this.hitT = kind === 'kill' ? 0.35 : 0.14;
  }
  // the Prism side of the HUD: awareness indicators, banners, the Roach's bar, bars over damaged robots
  updatePrism(dt, dir, camera, camYaw) {
    const p = this.p;
    this.hitT -= dt;
    if (this.hitT <= 0) $('xhit').classList.remove('on');
    // robots noticing you: a ring that fills around a "?", turning red "!" when they turn on you
    const fx = fwdX(camYaw), fz = fwdZ(camYaw), rx = -fz, rz = fx;
    for (const [id, t] of this.alertT) { if (t - dt <= 0) this.alertT.delete(id); else this.alertT.set(id, t - dt); }
    const list = dir.robots.filter(r => !r.dead && ((!r.hostile && r.aware > 0.02) || this.alertT.has(r.id)))
      .sort((a, b) => b.aware - a.aware).slice(0, this.detect.length);
    this.detect.forEach((d, i) => {
      const r = list[i];
      if (!r) { if (d.on) { d.e.style.opacity = '0'; d.on = false; } return; }
      d.on = true;
      const dx = r.pos.x - p.pos.x, dz = r.pos.z - p.pos.z;
      const a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      const hot = this.alertT.has(r.id);
      d.e.style.opacity = '1';
      d.e.style.transform = `rotate(${a.toFixed(3)}rad) translateY(-96px) rotate(${(-a).toFixed(3)}rad)`;
      d.e.style.setProperty('--k', hot ? '1' : r.aware.toFixed(3));
      d.e.style.setProperty('--c', hot ? '#ff4d3d' : r.aware > 0.66 ? '#ff8a3d' : '#ffb224');
      d.e.firstChild.textContent = hot ? '!' : '?';
    });
    // banners: a Fink scanning or calling, a drop pod on its way
    let text = '', k = -1, kind = '';
    const fink = dir.robots.find(r => r.type === 'fink' && !r.dead && r.state === 'call') || dir.robots.find(r => r.type === 'fink' && !r.dead && r.state === 'scan' && r.scan > 0.02);
    const pod = dir.pods.find(q => q.phase === 'falling');
    if (pod) { text = 'Drop pod incoming'; kind = 'bad'; }
    else if (fink && fink.state === 'call') { text = `Fink calling reinforcements · ${Math.ceil((1 - fink.call) * PRISM.fink.call)} s`; k = fink.call; kind = 'bad'; }
    else if (fink) { text = 'A Fink is scanning you'; k = fink.scan; kind = 'warn'; }
    if (text) {
      this.set('bt', $('hb-text'), 'text', text);
      this.set('bf', $('hb-fill'), 'width', k >= 0 ? (k * 100).toFixed(1) + '%' : '100%');
      this.set('bc', $('hud-banner'), 'class', 'hud-banner ' + kind + (k < 0 ? ' nobar' : ''));
    } else this.set('bc', $('hud-banner'), 'class', 'hud-banner hidden');
    // the Roach's health bar, while one is after you
    const boss = dir.robots.find(r => r.type === 'roach' && !r.dead && r.hostile && Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z) < 70);
    if (boss) {
      this.set('bsf', $('boss-fill'), 'width', (boss.hp / boss.maxHp * 100).toFixed(1) + '%');
      this.set('bsc', $('hud-boss'), 'class', 'hud-boss' + (boss.mode !== 'walk' ? ' flying' : ''));
      this.set('bsn', $('boss-name'), 'text', boss.mode !== 'walk' ? 'Roach · in flight, the hatch is open' : 'Roach');
    } else this.set('bsc', $('hud-boss'), 'class', 'hud-boss hidden');
    // small bars over robots you have hurt
    let n = 0;
    const W = innerWidth, H = innerHeight;
    for (const r of dir.robots) {
      if (n >= this.bars.length) break;
      if (r.dead || r.hurtT > 3 || r.type === 'roach') continue;
      const d = PRISM[r.type];
      _p.set(r.pos.x, r.pos.y + (d.flyer ? d.bar : d.bar), r.pos.z).project(camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) continue;
      const b = this.bars[n++];
      b.on = true;
      b.e.style.opacity = String(Math.min(1, (3 - r.hurtT) * 2));
      b.e.style.transform = `translate(${((_p.x + 1) / 2 * W).toFixed(0)}px, ${((1 - _p.y) / 2 * H).toFixed(0)}px)`;
      b.fill.style.width = (r.hp / r.maxHp * 100).toFixed(1) + '%';
    }
    for (let i = n; i < this.bars.length; i++) if (this.bars[i].on) { this.bars[i].on = false; this.bars[i].e.style.opacity = '0'; }
    // what the Prism parts you carry are worth, and a warning when you carry too much
    if (p.inv) {
      const w = weight(p.inv), v = partsValue(p.inv);
      const text = w > MAX_WEIGHT ? `Overweight ${w.toFixed(1)} / ${MAX_WEIGHT} kg · slower, no sprint` : v > 0 ? `Prism parts worth ${v.toLocaleString('en-US')} cr` : '';
      this.set('bag', $('v-bag'), 'text', text);
      this.set('bagc', $('v-bag'), 'class', 'v-bag' + (w > MAX_WEIGHT ? ' over' : ''));
    }
  }

  // the weapon panel, the quick-use strip, the item being used, and the crosshair's spread
  updateGear(dt, camera) {
    const p = this.p, w = p.wpn;
    if (!p.inv || !w) return;
    const h = inHand(p);
    let name = '', mode = '', mag = '', res = '', state = '';
    if (w.active === 'throw') {
      const it = p.inv.quick[w.throwSlot];
      name = it ? ITEMS[it.id].name : 'Grenade'; mode = 'Throw'; mag = it ? String(it.n) : '0'; res = 'left';
    } else if (h && h.def.weapon) {
      const W = h.def.weapon, reserve = count(p.inv, W.ammo);
      name = h.def.name; mode = W.mode === 'auto' ? 'Auto' : 'Semi';
      mag = String(h.it.d.ammo); res = String(reserve);
      if (h.it.d.ammo === 0) state = reserve > 0 ? ' empty' : ' dry';
      else if (h.it.d.ammo <= Math.ceil(W.mag * 0.25)) state = ' low';
    } else if (h && h.def.melee) { name = h.def.name; mode = 'Melee'; }
    else { name = w.active === 'unarmed' ? 'Unarmed' : 'Empty slot'; }
    if (w.reloadT > 0) state += ' reloading';
    this.set('wn', $('wpn-name'), 'text', name);
    this.set('wm', $('wpn-mode'), 'text', mode);
    this.set('wa', $('wpn-mag'), 'text', mag);
    this.set('wr', $('wpn-res'), 'text', res);
    this.set('wc', $('wpn'), 'class', 'wpn' + state + (mag === '' ? ' noammo' : ''));
    const rk = w.reloadT > 0 ? 1 - w.reloadT / w.reloadTime : 0;
    this.set('wrl', $('wpn-rlf'), 'width', (rk * 100).toFixed(1) + '%');
    // the four slots
    const now = w.want || w.active;
    this.slotEls.forEach((e, i) => {
      const slot = SLOT_KEYS[i][0], it = slotItem(p, slot);
      const sig = `${slot === now ? 'on' : ''}|${it ? it.id : ''}|${kn(SLOT_KEYS[i][1])}`;
      if (e.dataset.sig === sig) return;
      e.dataset.sig = sig;
      e.className = (slot === now ? 'on' : '') + (it || slot === 'unarmed' ? '' : ' empty');
      e.innerHTML = `<b>${esc(kn(SLOT_KEYS[i][1]))}</b>` + (it ? `<svg><use href="#it-${ITEMS[it.id].icon}"/></svg>` : slot === 'unarmed' ? '<svg><use href="#it-hand"/></svg>' : '');
    });
    // quick use
    this.quickEls.forEach((e, i) => {
      const it = p.inv.quick[i];
      const using = p.using && p.using.ref.a === 'quick' && p.using.ref.i === i, held = w.active === 'throw' && w.throwSlot === i;
      const sig = `${it ? it.id + ':' + it.n : ''}|${using || held ? 'on' : ''}`;
      if (e.dataset.sig === sig) return;
      e.dataset.sig = sig;
      e.className = (it ? 'r-' + ITEMS[it.id].rarity : 'empty') + (using || held ? ' on' : '');
      e.innerHTML = it ? `<svg><use href="#it-${ITEMS[it.id].icon}"/></svg><b>${it.n}</b>` : '';
    });
    // using an item: a bar under the crosshair
    if (p.using) {
      this.set('ut', $('use-text'), 'text', `${ITEMS[p.using.id].name} · ${Math.max(0, p.using.time - p.using.t).toFixed(1)} s`);
      this.set('uf', $('use-fill'), 'width', (Math.min(1, p.using.t / p.using.time) * 100).toFixed(1) + '%');
      this.set('uc', $('usebar'), 'class', 'usebar');
    } else this.set('uc', $('usebar'), 'class', 'usebar hidden');
    // the crosshair opens with the spread (a gun), a single dot otherwise
    let gap = 0;
    if (h && h.def.weapon && camera) {
      const s = spreadOf(p, h.def.weapon), half = camera.fov * Math.PI / 360;
      gap = Math.tan(s * Math.PI / 180) / Math.tan(half) * innerHeight / 2;
    }
    this.set('xg', $('xhair'), '--gap', Math.max(4, Math.min(80, gap + 3)).toFixed(1) + 'px');
    this.set('xl', $('xhair'), 'class', 'xhair' + (p.aiming ? ' aim' : '') + (p.dead ? ' off' : '') + (gap > 0 ? ' lines' : '') +
      (w.reloadT > 0 || p.using || p.sprinting ? ' dim' : '') + (w.dry > 0 ? ' dry' : ''));
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }
  dispose() { for (const off of this.offs) off(); }

  onHit(hit, r) {
    if (r.dodged) { this.pop('Dodged', 'dodge'); return; }
    this.hurt = Math.min(1, this.hurt + 0.18 + (r.health + r.shield * 0.35) / 140);
    this.ghostWait = 0.55;
    if (hit.from) {
      const d = this.dirs[this.nextDir++ % this.dirs.length];
      d.from = { x: hit.from.x, z: hit.from.z };
      d.life = 1.4;
    }
    if (r.broke) this.pop('Shield broken', 'bad');
  }
  pop(text, kind = '', color = '') {
    const box = $('hud-pop'), e = document.createElement('div');
    e.className = 'pop ' + kind; e.textContent = text;
    if (color) e.style.color = color;
    box.append(e);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => e.remove(), kind === 'loot' ? 2200 : 1300);
  }
  flash(id, cls) {
    const e = $(id);
    e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls);
  }
  // writes only what changed, so the page does not redo its layout every frame
  set(key, el, prop, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'class') el.className = value;
    else if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  }

  update(dt, camYaw) {
    const p = this.p;
    // health
    const hp = Math.max(0, p.health / p.maxHealth);
    this.ghostWait -= dt;
    if (hp > this.ghostH) this.ghostH = hp;
    else if (this.ghostWait <= 0) this.ghostH += (hp - this.ghostH) * Math.min(1, dt * 5);
    this.set('hf', $('vh-fill'), 'width', (hp * 100).toFixed(2) + '%');
    this.set('hg', $('vh-ghost'), 'width', (this.ghostH * 100).toFixed(2) + '%');
    this.set('hn', $('vh-num'), 'text', String(Math.ceil(p.health)));
    this.set('hc', $('v-health'), 'class', 'v-row v-health' + (hp < 0.25 ? ' crit' : hp < 0.5 ? ' low' : ''));
    this.set('lo', $('hud-low'), 'class', 'hud-low' + (hp < 0.3 && !p.dead ? ' on' : ''));

    // shield
    const sh = p.shield;
    if (sh) {
      const def = SHIELDS[sh.type], f = sh.hp / def.hp;
      if (f > this.ghostS) this.ghostS = f;
      else if (this.ghostWait <= 0) this.ghostS += (f - this.ghostS) * Math.min(1, dt * 5);
      this.set('sf', $('vs-fill'), 'width', (f * 100).toFixed(2) + '%');
      this.set('sg', $('vs-ghost'), 'width', (this.ghostS * 100).toFixed(2) + '%');
      this.set('ss', $('v-shield'), '--seg', String(def.hp / 50));
      const emp = p.emp > 0 && !sh.broken;
      this.set('st', $('vs-txt'), 'text', sh.broken ? `Broken · needs a ${def.item}` : emp ? `EMP · offline ${Math.ceil(p.emp)} s` : `${sh.type} · ${Math.round(def.def * 100)}% · ${Math.ceil(sh.hp)}`);
      this.set('sc', $('v-shield'), 'class', 'v-row v-shield' + (sh.broken ? ' broken' : emp ? ' emp' : ''));
    } else {
      this.ghostS = 0;
      this.set('sf', $('vs-fill'), 'width', '0%');
      this.set('sg', $('vs-ghost'), 'width', '0%');
      this.set('st', $('vs-txt'), 'text', 'No shield');
      this.set('sc', $('v-shield'), 'class', 'v-row v-shield none');
    }

    // stamina, only while it is not full (and a moment after)
    const st = p.stamina / p.maxStamina;
    this.stamShow = st < 0.995 || p.noStamina > 0 ? 1.2 : Math.max(0, this.stamShow - dt);
    this.set('stw', $('stam-fill'), 'width', (st * 100).toFixed(1) + '%');
    this.set('stc', $('stam'), 'class', 'stam' + (this.stamShow > 0 && !p.dead ? ' on' : '') + (p.winded ? ' winded' : st < 0.25 ? ' low' : ''));

    // use prompt
    if (p.focusText && !p.dead) {
      this.set('pt', $('pr-text'), 'text', p.focusText + (p.focusHold > 0 ? ` (hold ${p.focusHold} s)` : ''));
      this.set('pk', $('pr-key'), 'text', kn('interact'));
      const prog = p.use && p.focusHold > 0 ? Math.min(1, p.use.t / p.focusHold) : 0;
      this.set('pr', $('pr-ring'), 'strokeDashoffset', (RING * (1 - prog)).toFixed(1));
      this.set('pv', $('prompt'), 'class', 'prompt' + (prog > 0 ? ' busy' : ''));
    } else this.set('pv', $('prompt'), 'class', 'prompt hidden');

    // red edges after a hit
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    this.set('hu', $('hud-hurt'), 'opacity', this.hurt.toFixed(3));

    // hit markers, turned to where the hit came from, relative to the camera
    const fx = fwdX(camYaw), fz = fwdZ(camYaw), rx = -fz, rz = fx;
    for (const d of this.dirs) {
      if (d.life <= 0) { if (d.e.style.opacity !== '0') d.e.style.opacity = '0'; continue; }
      d.life -= dt;
      const dx = d.from.x - p.pos.x, dz = d.from.z - p.pos.z;
      const a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      d.e.style.transform = `rotate(${a.toFixed(3)}rad)`;
      d.e.style.opacity = Math.min(1, d.life).toFixed(2);
    }
  }
}
