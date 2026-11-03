// Little social things: pinging a spot for your team (Z), emotes (hold H + 1–4), visible noise rings at night,
// and the free roulette for dead players while they spectate (no money involved).
import * as THREE from 'three';
import { G, rand } from './state.js';
import { itemById, canvasTex } from './data.js';
import { broadcast, on, online } from './net.js';
import { S } from './settings.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const FX = [];
const ray = new THREE.Raycaster();

// ---------- pings ----------
function labelFor(u) {
  if (u.enemy) return ['⚠️', 'Enemy'];
  if (u.loot) return [itemById(u.loot.id).icon, itemById(u.loot.id).name];
  if (u.body) return [itemById(u.body.inst.id).icon, itemById(u.body.inst.id).name];
  if (u.big) return [itemById(u.big.id).icon, itemById(u.big.id).name];
  if (u.crate) return ['📦', 'Locked crate'];
  if (u.hide) return ['🫥', 'Hiding spot'];
  if (u.customer) return ['🙋', 'Customer'];
  if (u.slot?.item) return [itemById(u.slot.item.id).icon, itemById(u.slot.item.id).name];
  if (u.spill) return ['🧽', 'Mess'];
  return ['📍', ''];
}
function marker(scene, x, y, z, icon, label, who) {
  const t = canvasTex(256, 96, g => {
    g.font = '44px serif'; g.textAlign = 'center'; g.fillText(icon, 128, 46);
    g.font = 'bold 20px Segoe UI, sans-serif'; g.fillStyle = '#000a';
    const text = (who ? who + ': ' : '') + label; const w = g.measureText(text).width + 16;
    if (text.trim()) { g.fillRect(128 - w / 2, 58, w, 30); g.fillStyle = '#ffd86a'; g.fillText(text, 128, 80); }
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.2, 0.45, 1); s.position.set(x, y + 0.6, z); s.renderOrder = 20;
  scene.add(s);
  FX.push({ obj: s, scene, t: 0, life: 6, ping: true });
  sfx.ping();
}
export function ping(camera, scene) {
  ray.setFromCamera(new THREE.Vector2(), camera); ray.far = 80;
  const hit = ray.intersectObjects(scene.children, true).find(h => h.object.visible && !h.object.isSprite && h.object.type !== 'Line');
  if (!hit) return;
  let u = hit.object.userData, o = hit.object;
  while (o && !Object.keys(u).length && o.parent) { o = o.parent; u = o.userData; }
  const [icon, label] = labelFor(hit.object.userData.enemy || hit.object.userData.loot ? hit.object.userData : u);
  const p = hit.point;
  marker(scene, p.x, p.y, p.z, icon, label, '');
  if (online()) broadcast({ t: 'ping', w: G.world, x: p.x, y: p.y, z: p.z, icon, label, who: S.name });
}
on('ping', m => { if (m.w === G.world && G.pingScene) marker(G.pingScene(), m.x, m.y, m.z, m.icon, m.label, m.who); });

// ---------- noise rings ----------
export function noiseRing(scene, x, z, r, color = 0xffe080) {
  if (!scene) return;
  const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.raycast = () => {};
  scene.add(m);
  FX.push({ obj: m, scene, t: 0, life: 0.9, ring: Math.min(r, 25) });
}

export function updateFun(dt) {
  for (const f of [...FX]) {
    f.t += dt;
    const k = f.t / f.life;
    if (f.ring) { const s = 0.5 + k * f.ring; f.obj.scale.set(s, s, s); f.obj.material.opacity = 0.55 * (1 - k); }
    if (f.ping) { f.obj.material.opacity = f.t > f.life - 1 ? f.life - f.t : 1; f.obj.position.y += Math.sin(f.t * 4) * 0.002; }
    if (f.t >= f.life) { f.scene.remove(f.obj); FX.splice(FX.indexOf(f), 1); }
  }
}

// ---------- emotes ----------
export const EMOTES = { 1: ['wave', '👋 Wave'], 2: ['point', '👉 Point'], 3: ['sit', '🪑 Sit'], 4: ['dance', '🕺 Dance'] };
export function showEmoteBar(on) {
  const el = UI.$('emote-bar');
  el.innerHTML = Object.entries(EMOTES).map(([k, [, t]]) => `<span>${UI.kbd(k)} ${t}</span>`).join('');
  el.classList.toggle('hidden', !on);
}
// Pose an avatar (also the arms of the local view model never show, so this is for other players).
export function animateEmote(m, e, t) {
  if (!e) return;
  const { arms, legs, body } = m.userData;
  if (e === 'wave') { arms[1].sh.rotation.set(0, 0, 2.6 + Math.sin(t * 9) * 0.35); arms[1].el.rotation.x = -0.3; }
  if (e === 'point') { arms[1].sh.rotation.set(-1.55, 0, 0); arms[1].el.rotation.x = 0; }
  if (e === 'sit') {
    body.position.y = -0.48;
    for (const l of legs) { l.hip.rotation.x = -1.45; l.knee.rotation.x = 1.45; }
  }
  if (e === 'dance') {
    body.rotation.y = Math.sin(t * 6) * 0.4; body.position.y = Math.abs(Math.sin(t * 6)) * 0.08;
    for (const a of arms) { a.sh.rotation.z = (a === arms[0] ? -1 : 1) * (2.2 + Math.sin(t * 6) * 0.4); }
  } else body.rotation.y = 0;
}

// ---------- roulette for the dead (free: fake chips only) ----------
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
let chips = 1000, best = 0, angle = 0, bet = 'red';
export const resetChips = () => { chips = 1000; best = 0; };
export function openRoulette(onClose) {
  const BETS = { red: ['🔴 Red', n => RED.has(n), 2], black: ['⚫ Black', n => n && !RED.has(n), 2], odd: ['Odd', n => n % 2 === 1, 2], even: ['Even', n => n && n % 2 === 0, 2],
    low: ['1–18', n => n >= 1 && n <= 18, 2], high: ['19–36', n => n >= 19, 2], num: ['Number', null, 36] };
  const render = (msg = '') => {
    UI.openPanel(`<h2>💀 Ghost Roulette <small class="dim">free · just for fun</small></h2>
      <div class="roulette"><div class="wheel" id="rl-wheel" style="transform:rotate(${angle}deg)"></div><div class="rl-pin">▼</div></div>
      <p class="center">Chips: <b>${chips.toLocaleString('en-US')}</b> · best win tonight: <b>${best.toLocaleString('en-US')}</b></p>
      <div class="seg rl-bets">${Object.entries(BETS).map(([k, [t]]) => `<button data-bet="${k}" class="${k === bet ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="row"><label class="field">Bet <input id="rl-amt" type="number" min="10" value="${Math.min(100, chips)}"></label>
      ${bet === 'num' ? '<label class="field">on <input id="rl-num" type="number" min="0" max="36" value="17"></label>' : ''}
      <button id="rl-spin" ${chips < 10 ? 'disabled' : ''}>Spin</button><button id="rl-x" class="ghost">Close</button></div>
      <p class="center" id="rl-msg">${msg}</p>`, { esc: () => { UI.closePanel(false); onClose?.(); } });
    document.querySelectorAll('[data-bet]').forEach(b => b.onclick = () => { bet = b.dataset.bet; render(); });
    UI.$('rl-x').onclick = () => { UI.closePanel(false); onClose?.(); };
    UI.$('rl-spin').onclick = () => {
      const amt = Math.max(10, Math.min(chips, Math.round(+UI.$('rl-amt').value || 10)));
      const num = bet === 'num' ? Math.max(0, Math.min(36, Math.round(+UI.$('rl-num').value || 0))) : null;
      chips -= amt;
      const n = Math.floor(rand(0, 37));
      angle += 1440 + rand(0, 360);
      UI.$('rl-wheel').style.transform = `rotate(${angle}deg)`;
      UI.$('rl-spin').disabled = true;
      sfx.spin();
      setTimeout(() => {
        const [, test, pay] = BETS[bet];
        const won = bet === 'num' ? n === num : test(n);
        const win = won ? amt * pay : 0;
        chips += win;
        if (win - amt > best) {
          best = win - amt;
          if (best >= 1000 && online()) G.chatLine?.('💀 ' + S.name, `won ${win.toLocaleString('en-US')} chips at ghost roulette!`, true);
        }
        if (chips < 10) chips = 1000; // the house is generous to ghosts
        won ? sfx.cash() : sfx.bad();
        render(`<b class="${n === 0 ? 'ok' : RED.has(n) ? 'down' : ''}">${n}</b> · ${won ? `<span class="up">You win ${win.toLocaleString('en-US')}!</span>` : 'No luck.'}`);
      }, 2200);
    };
  };
  render();
}
