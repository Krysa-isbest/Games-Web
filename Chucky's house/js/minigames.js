// Minigames: taking big objects apart (screwdriver: hold on screws · wrench: click bolts round),
// and repairing broken items at the workshop bench (stop the needle in the green zone).
import { G, rand } from './state.js';
import { itemById } from './data.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

const progress = new Map(); // big object id -> fasteners already removed (survives closing the minigame)

// opts: { key, def, tools: ['screwdriver','wrench'], onNoise() } -> Promise<boolean finished>
export function dismantle({ key, def, onNoise }) {
  const need = def.big.tools;
  const has = need.filter(t => G.tools[t]);
  if (has.length < need.length) {
    UI.toast(`You need: ${need.map(t => t === 'wrench' ? '🔧 wrench' : '🪛 screwdriver').join(' + ')}. Or carry it out.`, 'bad');
    return Promise.resolve(false);
  }
  let parts = progress.get(key);
  if (!parts) {
    parts = [];
    const n = 5 + def.big.parts.length;
    for (let i = 0; i < n; i++) parts.push({ kind: need[i % need.length], x: rand(8, 88), y: rand(12, 80), done: false, turn: 0 });
    progress.set(key, parts);
  }
  return new Promise(resolve => {
    let holdT = null;
    const render = () => {
      const left = parts.filter(p => !p.done).length;
      UI.openPanel(`<h2>🛠 Taking apart: ${def.icon} ${def.name}</h2>
        <p class="dim">🪛 Screws: hold the mouse on them. 🔧 Bolts: click 4× to turn them loose. It makes noise: stay alert!</p>
        <div class="dismantle"><div class="dm-art">${def.icon}</div>
        ${parts.map((p, i) => p.done ? '' : `<button class="fastener ${p.kind}" data-i="${i}" style="left:${p.x}%;top:${p.y}%"><span style="transform:rotate(${p.turn * 90}deg)">${p.kind === 'wrench' ? '⬢' : '✚'}</span><i></i></button>`).join('')}
        </div>
        <div class="label">${left} left</div>${UI.meter(1 - left / parts.length)}
        <div class="row"><button id="dm-x" class="ghost">Stop (Esc)</button></div>`, { esc: () => close(false), cls: 'wide' });
      UI.$('dm-x').onclick = () => close(false);
      document.querySelectorAll('.fastener').forEach(b => {
        const p = parts[+b.dataset.i];
        if (p.kind === 'wrench') b.onclick = () => {
          p.turn++; sfx.ratchet(); onNoise?.(5);
          if (p.turn >= 4) { p.done = true; sfx.tap(); check(); } else b.querySelector('span').style.transform = `rotate(${p.turn * 90}deg)`;
        };
        else {
          b.onpointerdown = () => {
            b.classList.add('turning');
            let t = 0;
            holdT = setInterval(() => {
              t += 0.05; sfx.screw();
              b.querySelector('i').style.width = Math.min(100, t / 0.7 * 100) + '%';
              if (t >= 0.7) { clearInterval(holdT); p.done = true; onNoise?.(3); check(); }
            }, 50);
          };
          b.onpointerup = b.onpointerleave = () => { clearInterval(holdT); b.classList.remove('turning'); };
        }
      });
    };
    const check = () => { if (parts.every(p => p.done)) { progress.delete(key); close(true); } else render(); };
    const close = ok => { clearInterval(holdT); UI.closePanel(); resolve(ok); };
    render();
  });
}

// Repair: 5 rounds. Returns a score 0..1 (or null if cancelled).
export function repairGame(inst) {
  const def = itemById(inst.id);
  return new Promise(resolve => {
    let round = 0, score = 0, x = 0, dir = 1, raf = 0, zone = null, speed = 0;
    const next = () => {
      if (round >= 5) return finish();
      const w = rand(12, 22) - round * 1.5;
      zone = { a: rand(10, 90 - w), w };
      speed = 60 + round * 18;
      round++;
      UI.$('rp-zone').style.left = zone.a + '%'; UI.$('rp-zone').style.width = zone.w + '%';
      UI.$('rp-round').textContent = `Round ${round}/5`;
    };
    const hit = () => {
      const c = zone.a + zone.w / 2, d = Math.abs(x - c);
      if (d <= zone.w / 2) { const s = 1 - d / (zone.w / 2) * 0.5; score += s; sfx.ratchet(); UI.$('rp-msg').textContent = s > 0.85 ? 'Perfect!' : 'Good'; }
      else { sfx.error(); UI.$('rp-msg').textContent = 'Missed…'; }
      next();
    };
    const finish = () => { cleanup(); UI.closePanel(false); resolve(score / 5); };
    const cancel = () => { cleanup(); UI.closePanel(); resolve(null); };
    const key = e => { if (e.code === 'Space') { e.preventDefault(); hit(); } };
    const cleanup = () => { cancelAnimationFrame(raf); removeEventListener('keydown', key); };
    UI.openPanel(`<h2>🔧 Repairing: ${def.icon} ${def.name}</h2>
      <p class="dim">Press ${UI.kbd('Space')} or click when the needle is in the green zone. Better work = higher condition.</p>
      <div class="rp-bar" id="rp-bar"><div class="rp-zone" id="rp-zone"></div><div class="rp-needle" id="rp-needle"></div></div>
      <div class="row"><b id="rp-round"></b><span id="rp-msg" class="dim"></span></div>
      <div class="row"><button id="rp-x" class="ghost">Cancel</button></div>`, { esc: cancel });
    UI.$('rp-bar').onclick = hit;
    UI.$('rp-x').onclick = cancel;
    addEventListener('keydown', key);
    let last = performance.now();
    const loop = now => {
      const dt = (now - last) / 1000; last = now;
      x += dir * speed * dt;
      if (x > 100) { x = 100; dir = -1; } if (x < 0) { x = 0; dir = 1; }
      const n = UI.$('rp-needle'); if (n) n.style.left = x + '%';
      raf = requestAnimationFrame(loop);
    };
    next();
    raf = requestAnimationFrame(loop);
  });
}
