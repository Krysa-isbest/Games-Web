// Dresses a panel up as a slab of ice: frost crystals growing in from the edges (drawn behind the text),
// a crust of snow lying on top, icicles hanging underneath that drip now and then.
const dressed = new WeakMap();

export function dressPanel(panel) {
  if (!panel) return;
  let d = dressed.get(panel);
  if (!d) {
    d = { canvas: document.createElement('canvas'), lip: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), ice: document.createElement('div') };
    d.canvas.className = 'ice-frost'; d.lip.setAttribute('class', 'ice-lip'); d.ice.className = 'ice-cicles';
    panel.prepend(d.canvas); panel.append(d.lip, d.ice);
    dressed.set(panel, d);
  }
  const w = panel.offsetWidth, h = panel.offsetHeight;
  if (!w || (d.w === w && d.h === h)) return;
  d.w = w; d.h = h;
  drawFrost(d.canvas, d.w, d.h);
  drawLip(d.lip, d.w);
  drawIcicles(d.ice, d.w);
}

// crystals: branching needles from the edges, thickest in the corners
function drawFrost(c, w, h) {
  const k = Math.min(2, devicePixelRatio || 1);
  c.width = w * k; c.height = h * k;
  const x = c.getContext('2d');
  x.scale(k, k);
  x.clearRect(0, 0, w, h);
  x.lineCap = 'round';
  const branch = (px, py, a, len, depth) => {
    if (depth <= 0 || len < 1.5) return;
    const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
    x.globalAlpha = 0.1 + depth * 0.07; x.lineWidth = depth * 0.42;
    x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    for (let i = 0, n = 2 + (Math.random() * 2 | 0); i < n; i++) {
      const t = 0.25 + Math.random() * 0.7, s = Math.random() < 0.5 ? -1 : 1;
      branch(px + (ex - px) * t, py + (ey - py) * t, a + s * (0.9 + Math.random() * 0.3), len * (0.25 + Math.random() * 0.25), depth - 1);
    }
    branch(ex, ey, a + (Math.random() - 0.5) * 0.5, len * 0.72, depth - 1);
  };
  x.strokeStyle = '#ffffff';
  // short, dense needles along every edge; the corners grow the biggest feathers
  const per = Math.round((w + h) / 5);
  for (let i = 0; i < per; i++) {
    const side = i % 4, r = Math.random(), corner = Math.min(r, 1 - r);
    const reach = (4 + Math.random() * 9) * (corner < 0.12 ? 2.2 - corner * 8 : 1);
    const [px, py, a] = side === 0 ? [r * w, 0, Math.PI / 2] : side === 1 ? [r * w, h, -Math.PI / 2] : side === 2 ? [0, r * h, 0] : [w, r * h, Math.PI];
    branch(px, py, a + (Math.random() - 0.5) * 1.1, reach, 4);
  }
  for (const [cx, cy, a] of [[0, 0, Math.PI / 4], [w, 0, Math.PI * 3 / 4], [0, h, -Math.PI / 4], [w, h, -Math.PI * 3 / 4]])
    for (let i = 0; i < 7; i++) branch(cx, cy, a + (Math.random() - 0.5) * 1.3, 16 + Math.random() * 22, 5);
  // a few star-shaped flakes stuck on the glass
  for (let i = 0; i < Math.round(w * h / 60000); i++) {
    const fx = Math.random() * w, fy = Math.random() * h, s = 3 + Math.random() * 6;
    x.globalAlpha = 0.18; x.lineWidth = 0.7;
    for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3; x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx + Math.cos(a) * s, fy + Math.sin(a) * s); x.stroke(); }
  }
  // rime: a soft white glaze along the rim
  x.globalAlpha = 1;
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.06, 'rgba(255,255,255,0)'); g.addColorStop(0.94, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.4)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const g2 = x.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, 'rgba(255,255,255,0.4)'); g2.addColorStop(0.04, 'rgba(255,255,255,0)'); g2.addColorStop(0.96, 'rgba(255,255,255,0)'); g2.addColorStop(1, 'rgba(255,255,255,0.4)');
  x.fillStyle = g2; x.fillRect(0, 0, w, h);
}

// snow lying on the top edge: soft lumps, deeper towards the middle
function drawLip(svg, w) {
  const h = 18;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
  let d = `M0 ${h} L0 ${h - 4}`;
  for (let x = 0; x <= w; x += 14 + Math.random() * 26) {
    const mid = 1 - Math.abs(x / w - 0.5) * 1.4;
    d += ` Q${x + 8} ${h - 6 - Math.random() * 7 * mid - 3} ${x + 16} ${h - 4 - Math.random() * 3}`;
  }
  d += ` L${w} ${h} Z`;
  svg.innerHTML = `<defs><linearGradient id="snowg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e6f2"/></linearGradient></defs><path d="${d}" fill="url(#snowg)"/>`;
}

// icicles under the bottom edge, a drop of melt water falls from one now and then
function drawIcicles(box, w) {
  box.innerHTML = '';
  let x = 10 + Math.random() * 20;
  while (x < w - 12) {
    const big = Math.random() < 0.18, len = big ? 26 + Math.random() * 34 : 6 + Math.random() * 16, wid = big ? 7 + Math.random() * 5 : 3 + Math.random() * 4;
    const i = document.createElement('i');
    i.style.cssText = `left:${x}px;width:${wid}px;height:${len}px`;
    if (big && Math.random() < 0.6) { const drop = document.createElement('b'); drop.style.animationDelay = (Math.random() * 9).toFixed(1) + 's'; drop.style.animationDuration = (6 + Math.random() * 6).toFixed(1) + 's'; i.append(drop); }
    box.append(i);
    x += wid + (big ? 8 : 2) + Math.random() * (big ? 30 : 14);
  }
}
