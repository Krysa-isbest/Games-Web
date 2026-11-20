// The in-game HUD: health and shield bars (a pale "ghost" shows the damage just taken, then catches up), the
// stamina bar under the crosshair (only while it is not full), red markers that point to where a hit came
// from, the use prompt with a hold ring, short pop-ups (Dodged, Shield broken), and the low-health pulse.
import { bus } from '../core/events.js';
import { kn } from '../core/input.js';
import { SHIELDS } from './stats.js';
import { fwdX, fwdZ } from './move-math.js';
import { $ } from '../core/util.js';

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
    this.offs = [
      bus.on('damage', (t, hit, r) => { if (t === this.p) this.onHit(hit, r); }),
      bus.on('player:nostamina', t => { if (t === this.p) this.flash('stam', 'deny'); }),
      bus.on('shield', (t, what) => { if (t === this.p && what === 'restore') this.pop('Shield restored', 'good'); }),
      bus.on('heal', t => { if (t === this.p) this.pop('Healed', 'good'); }),
    ];
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
  pop(text, kind = '') {
    const box = $('hud-pop'), e = document.createElement('div');
    e.className = 'pop ' + kind; e.textContent = text;
    box.append(e);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => e.remove(), 1300);
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
      this.set('st', $('vs-txt'), 'text', sh.broken ? `Broken · needs a ${def.item}` : `${sh.type} · ${Math.round(def.def * 100)}% · ${Math.ceil(sh.hp)}`);
      this.set('sc', $('v-shield'), 'class', 'v-row v-shield' + (sh.broken ? ' broken' : ''));
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
