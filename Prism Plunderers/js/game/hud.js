// The in-game HUD: health and shield bars (a pale "ghost" shows the damage just taken, then catches up), the
// stamina bar under the crosshair (only while it is not full), red markers that point to where a hit came
// from, the use prompt with a hold ring, short pop-ups (Dodged, Shield broken), and the low-health pulse.
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { kn } from '../core/input.js';
import { SHIELDS } from './stats.js';
import { fwdX, fwdZ, yawOf } from './move-math.js';
import { ITEMS, RARITY, bagCount, bagValue } from './items.js';
import { PRISM } from './prism/defs.js';
import { $ } from '../core/util.js';
const _p = new THREE.Vector3();

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
        if (!items.length) this.pop('Nothing useful left', '');
        for (const it of items) this.pop(`+${it.n} ${ITEMS[it.id].name}`, 'loot', RARITY[ITEMS[it.id].rarity].color);
      }),
    ];
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
    // the bag
    const c = bagCount(p.bag || []);
    this.set('bag', $('v-bag'), 'text', c ? `Bag: ${c} item${c > 1 ? 's' : ''} · ${bagValue(p.bag).toLocaleString('en-US')} cr` : '');
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

    // crosshair
    this.set('xh', $('xhair'), 'class', 'xhair' + (p.aiming ? ' aim' : '') + (p.dead ? ' off' : ''));

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
