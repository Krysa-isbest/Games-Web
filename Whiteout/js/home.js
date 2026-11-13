// Whiteout: the shack as a home (build step 3). The stove (fuel, lighting it, the missing pipe), the gaps you
// patch (boards or metal sheets, or snow packed in from outside), the window you board up, the door you fix so
// it closes. How sealed the shack is (k, 0..1) decides how much of the stove's heat it keeps and how much wind
// gets in. Wood dries next to a burning stove and gets wet lying outside.
// Co-op: the host runs it (sim) and sends it (snap); everyone draws it (visuals).
import { clamp } from './state.js';
import { TYPES } from './items.js';
import { DAY } from './island.js';

const W = { wall: 1, roof: 2, window: 2, door: 3 };          // how much each kind of gap matters
export const STOVE_MAX = 1500;                                // seconds of fuel the stove holds

export class Home {
  constructor(wld) {
    this.w = wld; this.sh = wld.shack;
    this.stove = { fuel: 0, lit: false, temp: 0, pipe: false, wet: 0 };      // wet: seconds of wet wood still burning (it smokes)
    this.patch = this.sh.spots.map(() => 0);                   // 0 open, 1 snow, 2 boards
    this.door = 'broken';                                      // broken | open | closed
    this.k = 0; this.air = 0; this.t = 0;
    this.calc();
  }
  calc() {
    let sum = 0, tot = 0;
    this.sh.spots.forEach((s, i) => { const wt = W[s.kind]; tot += wt; sum += wt * (this.patch[i] === 2 ? 1 : this.patch[i] === 1 ? 0.6 : 0); });
    tot += W.door; sum += this.door === 'closed' ? W.door : 0;
    this.k = sum / tot;
  }
  // ---- the host (or solo) ----
  sim(dt, env, events) {
    const st = this.stove;
    if (st.lit) {
      st.fuel -= dt; st.temp += (1 - st.temp) * Math.min(1, dt / 40); st.wet = Math.max(0, Math.min(st.fuel, st.wet - dt));
      if (st.fuel <= 0) { st.fuel = 0; st.lit = false; events.push('out'); }
    } else st.temp = Math.max(0, st.temp - dt / 150);
    // a strong storm tears packed snow out of the walls
    if (env.storm > 0.6) this.patch.forEach((p, i) => { if (p === 1 && Math.random() < dt * 0.004 * env.storm) { this.patch[i] = 0; events.push('blown'); } });
    this.calc();
    // wood dries by the burning stove, and gets wet lying out in the snow
    for (const it of this.w.stash.list.values()) {
      if (!TYPES[it.type].wood || !it.rest) continue;
      const p = it.mesh.position, d = it.data;
      d.dry ??= 1;
      if (this.w.inShack(p)) { if (st.temp > 0.1 && p.distanceTo(this.sh.stove.pos) < 2.6) d.dry = Math.min(1, d.dry + dt / 240 * st.temp * (it.type === 'split' ? 2 : 1)); }
      else if (!this.w.inCabin(p)) d.dry = Math.max(0.1, d.dry - dt / (DAY * 2) * (1 + 2 * env.storm));
    }
  }
  // what wood is worth in the stove: wet wood barely burns
  static value(type, dry = 1) { const t = TYPES[type]; return (t.fuel || 0) * (t.wood ? 0.35 + 0.65 * dry : 1); }
  feed(type, dry) {
    const st = this.stove;
    if (st.fuel >= STOVE_MAX - 30) return false;
    const v = Home.value(type, dry);
    st.fuel = Math.min(STOVE_MAX, st.fuel + v);
    if (TYPES[type].wood && dry < 0.6) st.wet = Math.min(st.fuel, st.wet + v * (1 - dry));      // wet or damp wood smokes while it burns
    return true;
  }
  light() { const st = this.stove; if (st.lit || st.fuel <= 0) return false; st.lit = true; st.temp = Math.max(st.temp, 0.08); return true; }
  fitPipe() { if (this.stove.pipe) return false; this.stove.pipe = true; return true; }
  unmend(i) { if (this.patch[i] !== 1) return false; this.patch[i] = 0; this.calc(); return true; }      // knock packed snow out of a gap
  mend(i, how) { if (i < 0 || i >= this.patch.length || this.patch[i] >= how) return false; this.patch[i] = how; this.calc(); return true; }
  fixDoor() { if (this.door !== 'broken') return false; this.door = 'closed'; this.calc(); return true; }
  toggleDoor() { if (this.door === 'broken') return false; this.door = this.door === 'open' ? 'closed' : 'open'; this.calc(); return true; }
  // ---- co-op ----
  snap() { const s = this.stove; return [Math.round(s.fuel), s.lit ? 1 : 0, Math.round(s.temp * 100) / 100, s.pipe ? 1 : 0, this.patch.join(''), this.door, Math.round(s.wet)]; }
  apply(a) {
    const s = this.stove;
    s.fuel = a[0]; s.lit = !!a[1]; s.temp = a[2]; s.pipe = !!a[3];
    this.patch = String(a[4]).split('').map(Number); this.door = a[5]; s.wet = a[6] || 0;
    this.calc();
  }
  // ---- everyone: how it looks, and how warm the air inside gets ----
  visuals(dt) {
    this.t += dt;
    const st = this.stove, sv = this.sh.stove, t = this.t;
    this.sh.spots.forEach((s, i) => { s.board.visible = this.patch[i] === 2; if (s.snow) s.snow.visible = this.patch[i] === 1; });
    this.sh.door.set(this.door);
    const flick = 0.8 + 0.2 * Math.sin(t * 9) * Math.sin(t * 5.7 + 1) + Math.random() * 0.08;
    sv.glowM.emissiveIntensity = st.temp * (st.lit ? 2.4 * flick : 0.6);
    sv.light.intensity = st.temp * (st.lit ? 4.5 * flick : 0.8);
    sv.pipe.visible = st.pipe;
    sv.chimney.update(dt);
    const out = st.lit && st.pipe ? st.temp * (st.wet > 0 ? 1.8 : 1) : 0, smoky = this.smoky();
    for (const s of sv.chimney.list) s.material.opacity = Math.min(0.75, s.material.opacity * out);
    const inside = smoky ? st.temp * (st.pipe ? 0.5 : 1) : 0;
    for (const s of sv.indoor) { s.material.opacity += (inside * 0.45 * (0.7 + 0.3 * Math.sin(t * 0.7 + s.userData.ph)) - s.material.opacity) * Math.min(1, dt); }
    // the air in the shack: the stove warms it, the gaps let the warmth out
    this.air += (st.temp * (0.15 + 0.85 * this.k) - this.air) * Math.min(1, dt / 25);
  }
  // does it smoke inside? With no pipe, or with wet wood burning (the pipe can't take it all)
  smoky() { const st = this.stove; return st.lit && (!st.pipe || st.wet > 0); }
  // how fast the smoke fills the shack (per second, for the smoke bar)
  smokeRate() { const st = this.stove; return !st.lit ? 0 : !st.pipe ? st.temp / 75 : st.wet > 0 ? st.temp / 160 : 0; }
  // how full the stove is, in words
  status() {
    const st = this.stove, min = Math.round(st.fuel / 60);
    const what = st.lit ? `burning, about ${min} min of wood left` : st.fuel > 0 ? `cold, with about ${min} min of wood in it` : st.temp > 0.05 ? 'going cold, empty' : 'cold and empty';
    return `The stove: ${what}${st.pipe ? '' : ' (no pipe)'}${st.lit && st.wet > 0 ? ', smoking: wet wood' : ''}`;
  }
}
export const sealedText = k => (k > 0.9 ? 'sealed tight' : k > 0.6 ? 'mostly sealed' : k > 0.3 ? 'draughty' : 'full of holes');
void clamp;
