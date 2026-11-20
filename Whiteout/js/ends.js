// Whiteout: getting out (build step 7b, design.md 8). Three ways, and each needs someone out there to come for you:
//  1. The flare gun: once a day something passes the island: a plane (by day or night) or a ship (at night),
//     sometimes close, sometimes far. Fire a flare while it is there and it may be seen: the closer, the darker and
//     the clearer, the better. Three shells on the whole island (finds.js fires them).
//  2. Burn the shack: with your lighter lit (or a torch in your hand), look at the shack's door from outside and hold
//     the use key. It catches, the roof falls in, and it burns as a huge signal for half a day: whatever passes in that
//     time almost surely sees it. If nothing passes, it was your only shelter: the tail section and the tent are left.
//  3. The tower's satellite phone: up the stairs, break the padlock with an axe, read the old hunter's note: the
//     battery is under the shack's floor by the bunk. Fit it, and call when the sky is clear enough for a signal.
// Seen or called: a helicopter comes after about half a day (it waits out a storm) and sets down beside the shack. Climb aboard. Alone, that is the end. In co-op it waits 90 s after the first one is in (or
// until all the living are), then lifts off: the end for everyone, with who made it home.
// The host runs it (`gm.ends`): it goes out with the shared world (g-s), to someone joining, and into the save.
import * as THREE from 'three';
import { G, S, clamp, lerp } from './state.js';
import { kn } from './keys.js';
import { on, send } from './net.js';
import * as ISL from './island.js';
import { smooth, glowTex } from './scene.js';
import * as SFX from './sfx.js';
import { TYPES } from './items.js';
import { LS } from './voice.js';
import { showEnd, wake } from './life.js';
import { clearSave } from './save.js';
import { diaryNote } from './obj.js';

let GE = null, H = null;            // the game, and helpers from work.js: { act, hint, shout }
const DAY = ISL.DAY, BURN = 0.45 * DAY, CATCH = 40, WAIT = 90, COME = 0.5 * DAY;
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion();

export function initEnds(gm, helpers) {
  GE = gm; H = helpers;
  gm.ends ??= { lock: 0, note: 0, bat: 0, floor: 0, burn: -1, out: 0, res: null, abd: [], abdT: -1, bb: 0, seen: -1 };
  gm.endsL = { rolled: new Set(), plane: null, ship: null, heli: null, fire: null, sndP: null, sndR: null, sndF: null, burnDone: false, heliCol: null, said: new Set(), finished: false };
  gm.pad = findPad(gm.world);
  gm.dom.root.insertAdjacentHTML('beforeend', '<div class="gm-rescue hidden"></div>');
  gm.dom.rescue = gm.dom.root.querySelector('.gm-rescue');
}
// where the helicopter sets down: the flat, cleared ground beside the shack, in front and to the right of the door
// (no trees within 17 m of the shack; the rotor clears the roof, the tail points away from it)
function findPad(w) {
  const v = new THREE.Vector3(7, 0, 6.5).applyMatrix4(w.shack.M);
  return v.setY(w.groundY(v.x, v.z));
}

// ---------- what passes the island: one a day, worked out from the day (the same for everyone) ----------
export function passFor(day) {
  const r = ISL.mulberry(day * 7907 + 17), ship = r() < 0.45;
  const h = ship ? 18 + r() * 11 : 9 + r() * 19, base = (day - 1) * DAY;
  const T0 = h < 16 ? base + (h - 8) * 60 : base + 480 + (h - 16) * 45;
  return { day, ship, T0, dur: ship ? 260 : 75, dist: ship ? 900 + r() * 1500 : 250 + r() * 2300, ang: r() * Math.PI * 2, alt: ship ? 0 : 500 + r() * 400, len: ship ? 2100 : 5200 };
}
export function passAt(T) {
  const day = 1 + Math.floor((T + 360) / DAY);
  for (const d of [day, day - 1]) {
    if (d < 1) continue;
    const ps = passFor(d);
    if (ps.T0 > ISL.T_START + 300 && T >= ps.T0 && T <= ps.T0 + ps.dur) return ps;
  }
  return null;
}
export function passPos(ps, T, out = new THREE.Vector3()) {
  const u = clamp((T - ps.T0) / ps.dur, 0, 1), s = (u - 0.5) * ps.len;
  const nx = Math.cos(ps.ang), nz = Math.sin(ps.ang), dx = -nz, dz = nx;
  return out.set(ISL.SHACK.x + nx * ps.dist + dx * s, ps.ship ? ISL.SEA + 6 : ps.alt, ISL.SHACK.z + nz * ps.dist + dz * s);
}
// how likely a flare is seen from what passes
function seeChance(ps, d, env) {
  const base = d < 900 ? 0.92 : d < 1600 ? 0.7 : d < 2600 ? 0.4 : 0.1;
  return base * (env.light > 0.5 ? 0.65 : 1) * (1 - 0.7 * env.storm) * (1 - 0.6 * (env.fog || 0));
}
// a flare went up somewhere (finds.js, on every screen): the host decides whether it was seen
export function flareUp(gm, pos) {
  const E = gm.ends;
  if (!E || gm.role === 'guest' || E.res) return;
  const ps = passAt(gm.T);
  if (!ps) return;
  const d = passPos(ps, gm.T, _a).distanceTo(pos);
  if (Math.random() < seeChance(ps, d, gm.env)) seen(gm, ps, ps.ship ? 'ship' : 'flare');
  else say(gm, ps.ship ? 'missed-ship' : 'missed-plane');
}
function seen(gm, ps, how) {
  const E = gm.ends;
  if (E.res) return;
  E.res = { how, at: gm.T + COME, land: -1 }; E.seen = ps ? ps.day : -1;
  diaryNote(gm, 'seen');
  say(gm, how === 'phone' ? 'called' : ps?.ship ? 'seen-ship' : 'seen-plane');
}

// ---------- messages for the whole crew ----------
const SAYS = {
  'seen-plane': 'The plane banks and flashes its landing lights. They saw you! Help is coming: stay alive until it gets here.',
  'seen-ship': 'The ship sounds its horn, twice. They saw you! Help is coming: stay alive until it gets here.',
  'missed-plane': 'The flare burns out over the island. The plane flies on: nobody saw it.',
  'missed-ship': 'The flare burns out. The ship\'s lights move on across the dark: nobody saw it.',
  called: 'Through the static, a voice: "Flight 2207? We have your position. A helicopter, as soon as the weather lets us. Hold on." Help is coming.',
  burning: 'The shack is burning. There is no putting it out now: it will burn for half a day.',
  'burnt-out': 'The fire has burned down to embers. Nobody came.',
  heli: 'The thump of rotors: a helicopter, coming down beside the shack! Get aboard.',
};
function say(gm, k) { show(gm, k); if (gm.role === 'host') send('*', { t: 'g-out', k }); }
function show(gm, k) {
  if (!SAYS[k]) return;
  H.hint(gm, 'out-' + k + Math.floor(gm.T), SAYS[k], 9000, true);
  if (k === 'seen-ship') SFX.horn();
  if (k === 'heli' && gm.life?.st === 'sleep') wake(gm, 'heli');
}
on('g-out', m => { const gm = GE; if (gm && gm.ready && gm.role === 'guest') show(gm, m.k); });

// ---------- every frame ----------
export function endsTick(gm, dt, env) {
  const E = gm.ends, L = gm.endsL, w = gm.world, host = gm.role !== 'guest', T = gm.T, cam = gm.camera;
  if (!E) return;
  // the state, drawn
  w.tower.door.set(!!E.lock);
  w.tower.phone.bat.visible = !!E.bat;
  w.shack.loose.set(!!E.floor);
  // ---- what passes ----
  const ps = passAt(T);
  passVisual(gm, ps, env);
  if (ps && host && !E.res && E.burn >= 0 && T - E.burn >= CATCH && T - E.burn <= BURN && T >= ps.T0 + ps.dur / 2 && !L.rolled.has(ps.day)) {
    L.rolled.add(ps.day);
    const d = passPos(ps, T, _a).distanceTo(w.shack.stove.pos);
    if (Math.random() < (env.light > 0.5 ? 0.85 : 0.97) * (1 - 0.5 * env.storm) * (d < 3000 ? 1 : 0.7)) seen(gm, ps, 'burn');
  }
  if (ps && gm.started) {
    const d = passPos(ps, T, _a).distanceTo(cam.position), hasGun = gm.inv.count(t => t === 'flare') > 0 && gm.inv.count(t => t === 'shells') > 0;
    if (d < 4200 && !E.res) H.hint(gm, 'pass' + ps.day, ps.ship ? `Lights out at sea: a ship!${hasGun ? ' Fire a flare, now.' : ''}` : `The drone of engines: a plane${d < 1600 ? ', low and close' : ', high and far off'}!${hasGun ? ` Fire a flare, now: hold ${kn('primary')} with the flare gun.` : ''}`, 7000, true);
  }
  // ---- the shack burning ----
  burnTick(gm, dt, env);
  // ---- the helicopter ----
  if (host && E.res && E.res.land < 0 && T >= E.res.at && env.storm < 0.5) { E.res.land = T; say(gm, 'heli'); }
  heliTick(gm, dt, env);
  // ---- aboard ----
  const me = E.abd.includes(S.name);
  if (me && !gm.aboard) {
    gm.aboard = true; gm.inp.clear();
    if (gm.life.st === 'sleep') wake(gm, 'heli');
    gm.player.setMode('sleep');
  }
  if (gm.aboard) { gm.player.P.g.visible = false; gm.player.heat = Math.max(gm.player.heat, 70); const hp = heliPos(gm, _v); gm.player.hold(hp.x, hp.y + 0.3, hp.z); }
  if (host && !L.finished && E.abd.length) {
    let alive = gm.life.st === 'dead' ? 0 : 1;
    for (const a of gm.avatars.values()) if ((a.to?.ls ?? 0) !== LS.dead) alive++;
    if (!gm.coop || E.abd.length >= alive || T - E.abdT >= WAIT) finish(gm);
  }
  hudLine(gm, env);
}
// the view from the helicopter while you wait for the others (after the player's own view)
export function endsView(gm) {
  if (!gm.aboard) return;
  const p = gm.player, cam = gm.camera, hp = heliPos(gm, _v), yaw = gm.endsL.heli?.g.rotation.y || 0;
  cam.position.set(hp.x + Math.cos(yaw) * 0.5, hp.y + 1.55, hp.z - Math.sin(yaw) * 0.5);
  cam.rotation.set(clamp(p.pitch, -1, 1), p.yaw, 0);
}
export const heliHere = gm => !!(gm.ends?.res && gm.ends.res.land >= 0);

// ---------- planes and ships ----------
function sprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(color, 'rgba(0,0,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.setScalar(size); return s;
}
function passVisual(gm, ps, env) {
  const L = gm.endsL, E = gm.ends;
  for (const k of ['plane', 'ship']) {
    const want = ps && (k === 'ship') === ps.ship;
    if (!want) { if (L[k]) L[k].g.visible = false; continue; }
    if (!L[k]) {
      const g = new THREE.Group(), lights = {};
      if (k === 'plane') {
        const dark = new THREE.MeshBasicMaterial({ color: '#2a2e34' });
        g.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 24), dark), new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 4), dark));
        lights.r = sprite('rgba(255,40,30,1)', 14); lights.r.position.set(-13, 0, 0); lights.gr = sprite('rgba(60,255,90,1)', 14); lights.gr.position.set(13, 0, 0);
        lights.s = sprite('rgba(255,255,255,1)', 30); lights.s.position.set(0, -1.4, 0);
      } else {
        lights.m = sprite('rgba(255,250,235,1)', 18); lights.m.position.set(0, 14, 0);
        lights.r = sprite('rgba(255,40,30,1)', 10); lights.r.position.set(-5, 6, 0); lights.gr = sprite('rgba(60,255,90,1)', 10); lights.gr.position.set(5, 6, 0);
        for (let i = 0; i < 5; i++) { const c = sprite('rgba(255,220,150,1)', 6); c.position.set(-6 + i * 3, 4, 0); g.add(c); }
      }
      for (const s of Object.values(lights)) g.add(s);
      gm.scene.add(g);
      L[k] = { g, lights };
    }
    const o = L[k], t = performance.now() / 1000, seenNow = E.seen === ps.day;
    o.g.visible = true;
    passPos(ps, gm.T, o.g.position);
    const nx = Math.cos(ps.ang), nz = Math.sin(ps.ang);
    o.g.rotation.set(0, Math.atan2(-nz, nx), k === 'plane' && seenNow ? Math.sin(t * 2.2) * 0.4 : 0);       // it rocks its wings when it has seen you
    if (o.lights.s) o.lights.s.visible = (t % (seenNow ? 0.4 : 1.2)) < 0.08;
  }
  // the sound: engines in the sky, a ship's diesel far off
  const d = ps ? passPos(ps, gm.T, _a).distanceTo(gm.camera.position) : 1e9;
  if (ps && !L.sndP) L.sndP = SFX.loop('plane');
  L.sndP?.set(ps ? smooth(4500, 700, d) * (ps.ship ? 0.5 : 1) * (1 - 0.5 * env.storm) : 0, ps?.ship ? 0.6 : 1);
}

// ---------- the burning shack ----------
function burnTick(gm, dt, env) {
  const E = gm.ends, L = gm.endsL, w = gm.world;
  gm.burnHeat = 0;
  if (E.burn < 0) { L.sndF?.set(0); return; }
  const k = gm.T - E.burn;
  if (k >= CATCH && !w.burned) w.burnShack();
  if (k >= CATCH && !L.burnDone) {        // the roof falls in: what was inside is gone, the stove is dead
    L.burnDone = true;
    if (gm.role !== 'guest') for (const it of [...w.stash.list.values()]) { _v.copy(it.mesh.position).applyMatrix4(w.shack.inv); if (Math.abs(_v.x) < 2.6 && Math.abs(_v.z) < 2.0 && _v.y > -0.3 && _v.y < 2.4) w.stash.remove(it.id); }
    const st = gm.home.stove; st.lit = false; st.fuel = 0; st.temp = 0; gm.home.air = 0;
  }
  if (gm.role !== 'guest' && k > BURN && !E.res && !E.out) { E.out = 1; say(gm, 'burnt-out'); }
  const I = k < CATCH ? smooth(0, CATCH, k) : k < BURN ? 1 : Math.max(0, 0.18 * (1 - (k - BURN) / (0.6 * DAY)));
  // fire: flames all over the shack, a column of smoke, light, heat; smoke fills it while it catches
  if (!L.fire && I > 0 && typeof document !== 'undefined') {
    const g = new THREE.Group(), fl = [], sm = [];
    const fmat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,230,160,1)', 'rgba(255,100,20,0.6)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 46; i++) { const s = new THREE.Sprite(fmat.clone()); s.userData = { x: (Math.random() - 0.5) * 5.6, z: (Math.random() - 0.5) * 4.4, y: Math.random() * 2.4, t: Math.random() }; g.add(s); fl.push(s); }
    const smat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,0.7)', 'rgba(255,255,255,0.15)'), color: '#2a2826', transparent: true, depthWrite: false });
    for (let i = 0; i < 34; i++) { const s = new THREE.Sprite(smat.clone()); s.userData = { t: i / 34, ph: Math.random() * 6 }; g.add(s); sm.push(s); }
    const light = new THREE.PointLight('#ff7a2a', 0, 90, 1.5); light.position.set(0, 3, 0); g.add(light);
    g.position.copy(_v.set(0, 0, 0).applyMatrix4(w.shack.M)); g.quaternion.setFromRotationMatrix(w.shack.M);
    gm.scene.add(g);
    L.fire = { g, fl, sm, light };
  }
  if (L.fire) {
    const f = L.fire, t = performance.now() / 1000;
    for (const s of f.fl) {
      const u = s.userData; u.t += dt * 1.3; if (u.t > 1) { u.t -= 1; u.x = (Math.random() - 0.5) * 5.6; u.z = (Math.random() - 0.5) * 4.4; u.y = Math.random() * (k < CATCH ? 1 : 2.4); }
      s.position.set(u.x, u.y + u.t * 2.2 * (0.4 + I), u.z);
      s.scale.setScalar((1.4 * (1 - u.t) + 0.3) * (0.3 + 1.2 * I)); s.material.opacity = (1 - u.t) * 0.9 * Math.min(1, I * 1.5);
    }
    for (const s of f.sm) {
      const u = s.userData; u.t += dt * 0.05; if (u.t > 1) u.t -= 1;
      s.position.set(Math.sin(u.t * 4 + u.ph) * 1.5 + u.t * env.wind * 3 * Math.cos(env.wdir), 2 + u.t * 60, Math.cos(u.t * 3 + u.ph) * 1.5 + u.t * env.wind * 3 * Math.sin(env.wdir));
      s.scale.setScalar(2 + u.t * 14); s.material.opacity = Math.sin(Math.PI * u.t) * 0.75 * Math.min(1, I * 2);
    }
    f.light.intensity = 60 * I * (0.8 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7.3));
  }
  const d = gm.camera.position.distanceTo(w.shack.stove.pos);
  gm.burnHeat = I * smooth(20, 5, d);
  if (I > 0.02 && !L.sndF) L.sndF = SFX.loop('fire');
  L.sndF?.set(I * smooth(70, 4, d));
  if (k < CATCH && w.inShack(gm.player.pos)) { gm.smoke = Math.min(1, gm.smoke + dt * 0.25); gm.smoky = true; }
}

// ---------- the helicopter ----------
function heliMesh() {
  const g = new THREE.Group(), std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, ...o });
  const orange = std('#d8541e'), white = std('#e8eaec'), dark = std('#1b1f24', { roughness: 0.3, metalness: 0.4 }), glass = std('#20303c', { roughness: 0.1, metalness: 0.5 });
  const part = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; g.add(o); return o; };
  part(new THREE.BoxGeometry(1.9, 1.7, 3.6), orange, 0, 1.45, 0);
  part(new THREE.BoxGeometry(1.92, 0.25, 3.62), white, 0, 1.2, 0);
  part(new THREE.SphereGeometry(1.0, 16, 10), glass, 0, 1.5, 1.9).scale.set(0.95, 0.8, 0.9);
  part(new THREE.BoxGeometry(0.35, 0.4, 4.6), orange, 0, 1.75, -4.0);
  part(new THREE.BoxGeometry(0.1, 1.1, 0.8), orange, 0, 2.3, -6.1);
  const tail = part(new THREE.BoxGeometry(0.05, 1.1, 0.14), dark, 0.18, 2.3, -6.1);
  for (const s of [-1, 1]) { part(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6), dark, s * 0.9, 0.05, 0, Math.PI / 2); for (const z of [-0.9, 0.9]) part(new THREE.BoxGeometry(0.06, 0.6, 0.06), dark, s * 0.85, 0.35, z, 0, 0, s * 0.2); }
  part(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8), dark, 0, 2.5, 0);
  const rotor = new THREE.Group(); rotor.position.set(0, 2.72, 0); g.add(rotor);
  for (const a of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.04, 0.32), dark); b.rotation.y = a; rotor.add(b); }
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,60,40,1)', 'rgba(0,0,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  beacon.position.set(0, 2.45, -1.5); beacon.scale.setScalar(2.5); g.add(beacon);
  const spot = new THREE.SpotLight('#fff4dd', 0, 120, 0.45, 0.5, 1.2); spot.position.set(0, 0.6, 1.6); spot.target.position.set(0, -10, 14); g.add(spot, spot.target);
  return { g, rotor, tail, beacon, spot };
}
// where it is now: flying in over 45 s from the sea, then down on the pad
function heliPos(gm, out) {
  const E = gm.ends, pad = gm.pad;
  if (!E.res || E.res.land < 0) return out.copy(pad);
  const u = clamp((gm.T - E.res.land) / 45, 0, 1), e = 1 - Math.pow(1 - u, 3);
  const dx = pad.x - ISL.SHACK.x, dz = pad.z - ISL.SHACK.z, l = Math.hypot(dx, dz) || 1;
  return out.set(pad.x + dx / l * 900 * (1 - e), pad.y + 160 * Math.pow(1 - u, 1.6) + 0.02, pad.z + dz / l * 900 * (1 - e));
}
function heliTick(gm, dt, env) {
  const E = gm.ends, L = gm.endsL, here = heliHere(gm);
  if (!here) { if (L.heli) L.heli.g.visible = false; L.sndR?.set(0); return; }
  if (!L.heli && typeof document !== 'undefined') { L.heli = heliMesh(); gm.scene.add(L.heli.g); }
  const pad = gm.pad, h = L.heli, p = heliPos(gm, _v), landed = gm.T - E.res.land >= 45;
  if (h) {
    h.g.visible = true; h.g.position.copy(p);
    const dx = ISL.SHACK.x - pad.x, dz = ISL.SHACK.z - pad.z;
    h.g.rotation.set(landed ? 0 : 0.12, Math.atan2(dx, dz), 0);
    h.rotor.rotation.y += dt * 28; h.tail.rotation.x += dt * 40;
    const t = performance.now() / 1000;
    h.beacon.visible = (t % 1) < 0.15;
    h.spot.intensity = gm.env.light < 0.5 ? 900 : 0;
  }
  if (landed && !L.heliCol) L.heliCol = gm.world.phys.createCollider(gm.R.ColliderDesc.cuboid(0.95, 0.85, 1.8).setTranslation(pad.x, pad.y + 1.45, pad.z).setRotation((() => { _q.setFromAxisAngle(_a.set(0, 1, 0), Math.atan2(ISL.SHACK.x - pad.x, ISL.SHACK.z - pad.z)); return { x: _q.x, y: _q.y, z: _q.z, w: _q.w }; })()));
  if (!L.sndR) L.sndR = SFX.loop('rotor');
  L.sndR.set(smooth(1500, 15, gm.camera.position.distanceTo(p)), 1);
}

// ---------- what you can do (work.js findAct asks) ----------
export function endsActs(gm, look, offer) {
  const E = gm.ends, w = gm.world, inv = gm.inv, ht = inv.heldType(), p = gm.player;
  if (!E || gm.aboard) return;
  const T = w.tower;
  { const sc = look(T.door.pos, 2.2, 0.75);
    if (sc && !E.lock) offer(sc + 0.05, ht === 'axe' || ht === 'saxe' ? { id: 'lock', text: 'Break the padlock with the axe', hold: 3.5, go: () => { H.act(gm, { a: 'end', op: 'lock' }); H.shout(gm, 'clank', T.door.pos); } } : { id: 'lockd', text: 'The door is padlocked. An axe would break it', hold: 0 }); }
  { const sc = look(T.note.pos, 1.8, 0.85); if (sc) offer(sc + 0.05, { id: 'note', text: 'Read the note pinned to the wall', hold: 0.5, go: () => readNote(gm) }); }
  { const sc = look(T.phone.pos, 1.9, 0.8);
    if (sc) {
      if (!E.bat) offer(sc + 0.06, ht === 'battery' ? { id: 'bat', text: 'Fit the battery into the satellite phone', hold: 2, go: () => { if (inv.heldType() !== 'battery') return; inv.take(inv.sel, 1); H.act(gm, { a: 'end', op: 'bat' }); SFX.clank(); } } : { id: 'phone0', text: 'A satellite phone. Its battery is gone', hold: 0 });
      else if (E.res) offer(sc + 0.06, { id: 'phone2', text: 'The satellite phone: help is on its way', hold: 0 });
      else offer(sc + 0.06, { id: 'call', text: 'Call for help on the satellite phone', hold: 3, go: () => { if (gm.env.storm > 0.35) { H.hint(gm, 'nosignal' + Math.floor(gm.T), 'Nothing but static: the storm. Try again when the sky clears.', 5000, true); SFX.nope(); } else H.act(gm, { a: 'end', op: 'call' }); } });
    }
  }
  if (!w.burned) {
    const f = w.shack.loose, sc = look(f.pos, 1.9, 0.8);
    if (sc && !E.floor) offer(sc + 0.04, { id: 'floor', text: E.note ? 'Pry up the loose floorboard' : 'A loose floorboard: pry it up', hold: 1.5, go: () => { H.act(gm, { a: 'end', op: 'floor' }); SFX.grab(); } });
    // burning the shack: from outside, with fire in your hand
    const d = w.shack.door, sc2 = look(d.pos, 2.6, 0.75), fire = gm.hands.lit || ht === 'torch';
    if (sc2 && fire && E.burn < 0 && !gm.inShack && gm.escaped) offer(sc2 + 0.08, { id: 'burn', text: 'Set fire to the shack (a signal for anyone out there, and no shelter after)', hold: 5, go: () => { H.act(gm, { a: 'end', op: 'burn' }); H.shout(gm, 'ignite', d.pos); } });
  }
  if (heliHere(gm) && gm.T - E.res.land >= 45 && !E.abd.includes(S.name)) {
    const sc = look(_v.copy(gm.pad).setY(gm.pad.y + 1.4), 6, 0.55);
    if (sc) offer(sc + 0.2, { id: 'board', text: 'Climb aboard the helicopter', hold: 1.5, go: () => H.act(gm, { a: 'end', op: 'board', name: S.name, bb: inv.count(t => t === 'blackbox') > 0 ? 1 : 0 }) });
  }
  void p;
}
function readNote(gm) {
  H.hint(gm, 'note' + Math.floor(gm.T), 'In pencil, in a careful hand: "If you made it up here, you know what this is. It\'s no good without its battery, and the cold up here kills a battery in a week. I took it home. It\'s under the floor, by the head of my bunk. If I\'m not there, use it. — H. L."', 16000, true);
  gm.read?.add('note');
  if (!gm.ends.note) H.act(gm, { a: 'end', op: 'note' });
}
// the host (or solo): what an act does
export function endsApply(gm, a) {
  const E = gm.ends, w = gm.world;
  if (!E) return;
  switch (a.op) {
    case 'lock': E.lock = 1; break;
    case 'note': E.note = 1; break;
    case 'bat': E.bat = 1; break;
    case 'call': if (E.bat && !E.res) seen(gm, null, 'phone'); break;
    case 'floor':
      if (E.floor || w.burned) break;
      E.floor = 1;
      if (!E.batDropped) { E.batDropped = 1; const f = w.shack.loose.pos; w.stash.spawn({ type: 'battery', p: [f.x, f.y + 0.06, f.z], q: [0, 0, 0, 1], rest: true }); }
      break;
    case 'burn': if (E.burn < 0 && !w.burned) { E.burn = gm.T; say(gm, 'burning'); diaryNote(gm, 'burn'); } break;
    case 'board':
      if (!heliHere(gm) || typeof a.name !== 'string') break;
      if (!E.abd.includes(a.name)) E.abd.push(a.name.slice(0, 16));
      if (a.bb) E.bb = 1;
      if (E.abdT < 0) E.abdT = gm.T;
      break;
  }
}

// ---------- the end ----------
const HOW = { phone: 'The call from the tower brought them.', flare: 'A plane saw your flare.', ship: 'A ship saw your flare and sent its helicopter.', burn: 'They saw the burning shack from far out.' };
function finish(gm) {
  const E = gm.ends, L = gm.endsL;
  if (L.finished) return;
  L.finished = true;
  const all = [{ name: S.name, dead: gm.life.st === 'dead' }];
  for (const [pid, a] of gm.avatars) all.push({ name: G.lobby.players.find(x => x.id === pid)?.name || '?', dead: (a.to?.ls ?? 0) === LS.dead });
  const env = gm.env, hh = Math.floor(env.hours) % 24, mm = Math.floor((env.hours % 1) * 60);
  const f = { how: E.res.how, abd: E.abd.slice(), all, bb: E.bb, day: env.day, clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
  if (gm.role === 'host') send('*', { t: 'g-fin', f });
  clearSave(gm.coop ? 'coop' : 'solo');                 // the story is over: nothing to continue
  final(gm, f);
}
const list = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
function final(gm, f) {
  if (gm.life.ended) return;
  gm.endsL.finished = true;
  const me = f.abd.includes(S.name), left = f.all.filter(x => !x.dead && !f.abd.includes(x.name)).map(x => x.name), dead = f.all.filter(x => x.dead).map(x => x.name);
  const iDead = dead.includes(S.name);
  const title = me ? 'Rescued' : iDead ? 'The island kept you' : 'Left behind';
  let text = `${HOW[f.how] || ''} On day ${f.day}, at ${f.clock}, the helicopter lifts off the ice.`;
  if (gm.coop) { text += f.abd.length ? ` ${list(f.abd)} made it home.` : ''; if (left.length) text += ` ${list(left)} stayed behind.`; if (dead.length) text += ` ${list(dead)} didn't live to see it.`; }
  else text += ' You made it home.';
  if (f.bb) text += ' The flight recorder came home too: the world will learn what happened to Flight 2207.';
  gm.life.ended = true;
  showEnd(gm, title, text, [['Quit to the menu', () => H.quit(gm)]]);
}
on('g-fin', m => { const gm = GE; if (gm && gm.ready && gm.role === 'guest' && m.f) { clearSave('coop'); final(gm, m.f); } });

// ---------- the line on the HUD ----------
function hudLine(gm, env) {
  const E = gm.ends, d = gm.dom.rescue, T = gm.T;
  let t = '';
  if (E.res && E.res.land < 0) t = T < E.res.at ? `Help is coming · about ${Math.max(1, Math.round((E.res.at - T) / 50))} h` : 'Help is coming · waiting for the storm to pass';
  else if (heliHere(gm)) {
    const left = E.abdT >= 0 ? Math.max(0, Math.ceil(WAIT - (T - E.abdT))) : -1;
    t = gm.aboard ? `Aboard · waiting for the others${left >= 0 && gm.coop ? ` · ${left} s` : ''}` : T - E.res.land < 45 ? 'A helicopter! It is coming down beside the shack' : `The helicopter is down beside the shack · get aboard${left >= 0 ? ` · it leaves in ${left} s` : ''}`;
  } else if (E.burn >= 0 && T - E.burn < BURN) t = 'The shack is burning · a signal for anyone out there';
  if (gm.txt.rescue !== t) { gm.txt.rescue = t; d.textContent = t; d.classList.toggle('hidden', !t); }
}

// ---------- shared and saved (sync.js) ----------
export function endsSnap(gm) {
  const E = gm.ends;
  return E ? { lock: E.lock, note: E.note, bat: E.bat, floor: E.floor, burn: Math.round(E.burn * 10) / 10, out: E.out, res: E.res, abd: E.abd, abdT: E.abdT, bb: E.bb, seen: E.seen, bd: E.batDropped || 0 } : null;
}
export function endsLoad(gm, s) {
  const E = gm.ends;
  if (!E || !s) return;
  Object.assign(E, { lock: s.lock | 0, note: s.note | 0, bat: s.bat | 0, floor: s.floor | 0, burn: typeof s.burn === 'number' ? s.burn : -1, out: s.out | 0, res: s.res || null, abd: Array.isArray(s.abd) ? s.abd : [], abdT: typeof s.abdT === 'number' ? s.abdT : -1, bb: s.bb | 0, seen: s.seen ?? -1, batDropped: s.bd | 0 });
}
void lerp; void TYPES;
