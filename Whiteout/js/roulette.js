// Whiteout: the ghost roulette, brought over from Chucky's House: for the dead and the sleepers, to pass the time
// (design.md 7d / 7f). Fake chips, just for fun, nothing to do with the game. A real European wheel this time:
// the number it stops on under the pin is the number that won (in Chucky's House the wheel only looked random).
// A big win goes into the crew's chat.
import { say } from './lobby.js';
import * as SFX from './sfx.js';

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SEG = 360 / 37;
const BETS = { red: ['Red', n => RED.has(n), 2], black: ['Black', n => n > 0 && !RED.has(n), 2], odd: ['Odd', n => n % 2 === 1, 2], even: ['Even', n => n > 0 && n % 2 === 0, 2],
  low: ['1–18', n => n >= 1 && n <= 18, 2], high: ['19–36', n => n >= 19, 2], num: ['A number', null, 36] };
let chips = 1000, best = 0, angle = 0, bet = 'red', amt = 100, num = 17, spinning = false;
// the angle to turn the wheel to (from where it is now, at least four turns) so that n stops under the pin; and which number is under it
export const spinTo = (n, from) => from + 1440 + (((-(ORDER.indexOf(n) + 0.5) * SEG - from) % 360) + 360) % 360;
export const underPin = ang => ORDER[Math.floor(((((-ang) % 360) + 360) % 360) / SEG) % 37];
const colour = n => (n === 0 ? '#1a7a3a' : RED.has(n) ? '#b02020' : '#141414');

function wheelHtml() {
  const stops = ORDER.map((n, i) => `${colour(n)} ${(i * SEG).toFixed(2)}deg ${((i + 1) * SEG).toFixed(2)}deg`).join(', ');
  const labels = ORDER.map((n, i) => `<span style="transform:rotate(${((i + 0.5) * SEG).toFixed(2)}deg)">${n}</span>`).join('');
  return `<div class="rl-wheel" style="background:conic-gradient(${stops});transform:rotate(${angle}deg)">${labels}<i></i></div>`;
}
export function openRoulette(gm, onClose) {
  if (gm.rouletteOpen) return;
  gm.rouletteOpen = true; gm.inp.clear();
  if (document.pointerLockElement) document.exitPointerLock?.();
  let d = gm.dom.roul;
  if (!d) { d = gm.dom.roul = document.createElement('div'); d.className = 'gm-roul'; gm.dom.root.append(d); }
  d.classList.remove('hidden');
  const close = () => { if (!gm.rouletteOpen) return; gm.rouletteOpen = false; d.classList.add('hidden'); gm.roulClose = null; onClose?.(); };
  gm.roulClose = close;
  const render = (msg = '') => {
    d.innerHTML = `<div class="panel"><header class="p-head"><h2>💀 Ghost roulette</h2><span class="p-sub">Fake chips · just for fun · Esc closes</span></header>
      <div class="rl-box"><div class="rl-pin">▼</div>${wheelHtml()}</div>
      <p class="rl-chips">Chips <b>${chips.toLocaleString('en-US')}</b> · best win <b>${best.toLocaleString('en-US')}</b></p>
      <div class="seg rl-bets">${Object.entries(BETS).map(([k, [t]]) => `<button data-bet="${k}" class="${k === bet ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="rl-row"><label>Bet <input data-amt type="number" min="10" step="10" value="${Math.min(amt, chips)}"></label>
        ${bet === 'num' ? `<label>on <input data-num type="number" min="0" max="36" value="${num}"></label>` : ''}
        <button class="btn primary" data-spin ${spinning || chips < 10 ? 'disabled' : ''}>Spin</button><button class="btn ghost" data-x>Close</button></div>
      <p class="rl-msg">${msg}</p></div>`;
    d.querySelectorAll('[data-bet]').forEach(b => b.onclick = () => { if (spinning) return; bet = b.dataset.bet; render(); });
    d.querySelector('[data-x]').onclick = close;
    d.querySelector('[data-spin]').onclick = () => {
      if (spinning) return;
      amt = Math.max(10, Math.min(chips, Math.round(+d.querySelector('[data-amt]').value || 10)));
      if (bet === 'num') num = Math.max(0, Math.min(36, Math.round(+d.querySelector('[data-num]').value || 0)));
      chips -= amt; spinning = true;
      const n = ORDER[Math.random() * 37 | 0];
      angle = spinTo(n, angle);                                       // stop with that number under the pin
      d.querySelector('[data-spin]').disabled = true;
      d.querySelector('.rl-msg').textContent = 'The ball is rolling…';
      d.querySelector('.rl-chips b').textContent = chips.toLocaleString('en-US');
      const w = d.querySelector('.rl-wheel'); if (w) w.style.transform = `rotate(${angle}deg)`;
      SFX.spin();
      setTimeout(() => {
        spinning = false;
        const [, test, pay] = BETS[bet], won = bet === 'num' ? n === num : test(n), win = won ? amt * pay : 0;
        chips += win;
        if (win - amt > best) { best = win - amt; if (best >= 1000 && gm.coop) say(`💀 won ${win.toLocaleString('en-US')} chips at the ghost roulette!`); }
        if (chips < 10) chips = 1000;                                   // the house is generous to ghosts
        if (won) SFX.cash(); else SFX.nope();
        if (gm.rouletteOpen) render(`<b class="rl-n" style="background:${colour(n)}">${n}</b> ${won ? `You win ${win.toLocaleString('en-US')}!` : 'No luck.'}`);
      }, 2300);
    };
  };
  // draw at the old angle first, so the spin animates from there
  render();
}
export function closeRoulette(gm) { gm.roulClose?.(); }
