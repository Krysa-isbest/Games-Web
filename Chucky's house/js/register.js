// Checkout at the register (every sale): scan the barcode, then card (type the amount on the terminal)
// or cash (count the change out of the drawer). Quick and correct = small tip. Mistakes cost money or patience.
import { G, pick, rand } from './state.js';
import { itemById } from './data.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const BILLS = [100, 50, 20, 10, 5, 1];

// opts.cash = power cut (card terminal down) · opts.auto = cashier perk: auto-scan, terminal pre-filled
export function checkout(price, inst, opts = {}) {
  const def = itemById(inst.id);
  const t0 = performance.now();
  let mistakes = 0, lost = 0;
  const card = !opts.cash && Math.random() < 0.55;
  return new Promise(resolve => {
    const finish = () => {
      const fast = (performance.now() - t0) / 1000 < (card ? 9 : 12);
      const tip = !mistakes && fast ? Math.max(1, Math.round(price * rand(0.01, 0.04))) : 0;
      UI.closePanel(false);
      resolve({ lost, tip, mistakes });
    };

    // step 1: scan
    UI.openPanel(`<h2>🧾 Checkout</h2>
      <div class="till"><div class="till-screen" id="t-scr">READY</div>
        <div class="belt"><div class="belt-item"><span class="huge">${def.icon}</span><span>${def.name}</span>
        <button class="barcode" id="t-scan" title="Scan"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><small>${inst.uid.slice(0, 8)}</small></button></div></div></div>
      <p class="dim">Click the barcode (or press ${UI.kbd('Space')}) to scan it.</p>`, { esc: false, cls: 'till-panel' });
    let scanned = false;
    const scan = () => {
      if (scanned) return;
      scanned = true;
      removeEventListener('keydown', key);
      sfx.beep();
      UI.$('t-scr').innerHTML = `${def.name.toUpperCase()} ........ ${UI.money(price)}<br><b>TOTAL ${UI.money(price)}</b>`;
      setTimeout(card ? cardStep : cashStep, 450);
    };
    const key = e => { if (e.code === 'Space') { e.preventDefault(); scan(); } };
    addEventListener('keydown', key);
    UI.$('t-scan').onclick = scan;
    if (opts.auto) setTimeout(scan, 300);

    // step 2a: card terminal
    const cardStep = () => {
      let typed = opts.auto ? String(price) : '';
      UI.openPanel(`<h2>💳 Card payment</h2>
        <p>"${pick(['Card, please.', 'I\'ll pay by card.', 'Tap or chip?', 'Card is fine, right?'])}" Type the total: <b>${UI.money(price)}</b></p>
        <div class="terminal"><div class="term-screen" id="t-disp">$0</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map(k => `<button data-k="${k}" class="${k === 'OK' ? 'ok-key' : k === 'C' ? 'c-key' : ''}">${k}</button>`).join('')}</div></div>
        <p class="dim">You can also type with the number keys, Backspace and Enter.</p>`, { esc: false, cls: 'till-panel' });
      const disp = () => { UI.$('t-disp').textContent = '$' + (typed || '0'); };
      const press = k => {
        sfx.click();
        if (k === 'C') typed = typed.slice(0, -1);
        else if (k === 'OK') {
          if (+typed === price) { cleanup(); sfx.beep(); UI.$('t-disp').textContent = 'APPROVED ✓'; setTimeout(finish, 500); return; }
          mistakes++; sfx.error(); typed = '';
          UI.toast(mistakes >= 3 ? '"Ugh. Just let me do it."' : '"That\'s not the right amount…"', 'bad');
          if (mistakes >= 3) { cleanup(); setTimeout(finish, 300); return; }
        } else if (typed.length < 7) typed += k;
        disp();
      };
      document.querySelectorAll('[data-k]').forEach(b => b.onclick = () => press(b.dataset.k));
      if (typed) disp();
      const kk = e => {
        if (/^Digit\d$|^Numpad\d$/.test(e.code)) press(e.code.slice(-1));
        else if (e.code === 'Backspace') press('C');
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') press('OK');
      };
      const cleanup = () => removeEventListener('keydown', kk);
      addEventListener('keydown', kk);
    };

    // step 2b: cash + change
    const cashStep = () => {
      const steps = [5, 10, 20, 50, 100].filter(s => s > 0);
      let paid = price;
      const step = pick(steps.filter(s => s >= Math.min(20, price)) .concat([price < 100 ? 100 : 50]));
      paid = Math.ceil(price / step) * step;
      if (paid === price && Math.random() < 0.6) paid += pick([5, 10, 20]);
      const due = paid - price;
      let given = [];
      const sum = () => given.reduce((a, b) => a + b, 0);
      const render = () => {
        UI.openPanel(`<h2>💵 Cash payment</h2>
          <p>The customer hands you <b>${UI.money(paid)}</b> for a <b>${UI.money(price)}</b> item.</p>
          <div class="till"><div class="till-screen">PAID ${UI.money(paid)} · TOTAL ${UI.money(price)}<br><b>CHANGE DUE ${UI.money(due)}</b></div></div>
          <div class="drawer">${BILLS.map(b => `<button class="bill b${b}" data-b="${b}">$${b}</button>`).join('')}</div>
          <div class="change">Your change: <b id="t-giv">${UI.money(sum())}</b> <span class="dim">${given.map(b => '$' + b).join(' + ') || '(nothing yet)'}</span></div>
          <div class="row"><button id="t-give">Hand over change</button><button id="t-undo" class="ghost">Undo</button><button id="t-clear" class="ghost">Clear</button></div>`, { esc: false, cls: 'till-panel' });
        document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { sfx.coin(); given.push(+b.dataset.b); render(); });
        UI.$('t-undo').onclick = () => { given.pop(); render(); };
        UI.$('t-clear').onclick = () => { given = []; render(); };
        UI.$('t-give').onclick = () => {
          const s = sum();
          if (s < due) { mistakes++; sfx.error(); UI.toast(`"Hey, you still owe me ${UI.money(due - s)}."`, 'bad'); return; }
          if (s > due) { mistakes++; lost += s - due; UI.toast(`You gave ${UI.money(s - due)} too much. The customer keeps it.`, 'bad'); }
          sfx.drawer();
          finish();
        };
      };
      if (due === 0) { sfx.drawer(); UI.toast('"Exact change, here you go."'); setTimeout(finish, 400); return; }
      render();
    };
  });
}

export const registerBusy = () => G.uiOpen;
