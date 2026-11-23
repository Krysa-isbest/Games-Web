// The map (M): The Ruins from above, drawn once from the layout. Streets, buildings (the ones you can enter are
// lighter), the red and yellow zones, the highway, the landmarks, the three extraction points, and you (an arrow
// that turns with the camera). The mouse stays captured; you can keep walking while it is open.
import { $, esc } from '../core/util.js';
import { kn } from '../core/input.js';
import { uiSfx } from '../core/sound.js';

const PX = 1024;

export class MapScreen {
  constructor(L) {
    this.L = L; this.open = false;
    this.root = $('map');
    this.root.innerHTML = '';
    const frame = el('div', 'map-frame', this.root);
    const head = el('header', '', frame);
    head.innerHTML = `<span><small>Map</small><b>The Ruins</b></span><em id="map-where"></em><kbd>${esc(kn('map'))}</kbd>`;
    const view = this.view = el('div', 'map-view', frame);
    const cv = el('canvas', '', view);
    cv.width = PX; cv.height = PX;
    this.me = el('i', 'map-me', view);
    const foot = el('footer', '', frame);
    foot.innerHTML = '<span><i class="lg red"></i>Red zone: the best loot, the most Prism</span><span><i class="lg yellow"></i>Yellow zone</span>' +
      '<span><i class="lg ex"></i>Extraction (opens with the raid rules)</span><span><i class="lg open"></i>Buildings you can enter</span>';
    if (cv.getContext) draw(cv.getContext('2d'), L);
  }
  toggle() { if (this.open) this.close(); else this.show(); }
  show() { this.open = true; this.root.classList.remove('hidden'); uiSfx.click(); }
  close() { if (!this.open) return; this.open = false; this.root.classList.add('hidden'); uiSfx.back(); }
  // where you are and which way you look
  update(p, yaw) {
    if (!this.open) return;
    const h = this.L.half;
    const x = (p.pos.x + h) / (2 * h) * 100, y = (p.pos.z + h) / (2 * h) * 100;
    this.me.style.left = x.toFixed(2) + '%';
    this.me.style.top = y.toFixed(2) + '%';
    this.me.style.transform = `translate(-50%, -50%) rotate(${(-yaw).toFixed(3)}rad)`;
    let best = null, bd = Infinity;
    for (const e of this.L.extracts) { const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z); if (d < bd) { bd = d; best = e; } }
    const t = best ? `Nearest extraction: ${best.name}, ${Math.round(bd)} m` : '';
    if ($('map-where').textContent !== t) $('map-where').textContent = t;
  }
  dispose() { this.close(); this.root.innerHTML = ''; }
}

function el(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; parent.append(e); return e; }

function draw(g, L) {
  const h = L.half, k = PX / (2 * h);
  const X = x => (x + h) * k, Y = z => (z + h) * k;
  g.fillStyle = '#2b2620'; g.fillRect(0, 0, PX, PX);
  // sand texture: a few soft blotches
  for (let i = 0; i < 160; i++) {
    const x = (i * 137.5) % PX, y = (i * 263.1) % PX;
    g.fillStyle = i % 2 ? 'rgba(255,230,190,0.025)' : 'rgba(0,0,0,0.05)';
    g.beginPath(); g.arc(x, y, 30 + (i % 7) * 9, 0, Math.PI * 2); g.fill();
  }
  // zones
  for (const z of L.zones) {
    g.fillStyle = z.kind === 'red' ? 'rgba(255,77,61,0.16)' : 'rgba(255,178,36,0.12)';
    g.strokeStyle = z.kind === 'red' ? 'rgba(255,90,80,0.7)' : 'rgba(255,190,70,0.55)';
    g.lineWidth = 2; g.setLineDash([8, 6]);
    g.beginPath(); g.arc(X(z.x), Y(z.z), z.r * k, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.setLineDash([]);
  // blocks (their sidewalks), streets, the plaza, rubble, the crater
  const box = (r, fill) => { g.fillStyle = fill; g.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k); };
  for (const b of L.blocks || []) box(b, '#3a342d');
  for (const s of L.streets || []) box(s, '#4c463e');
  for (const a of L.alleys || []) box(a, '#433d36');
  for (const s of L.squares || []) box(s, '#544c43');
  if (L.plaza) box(L.plaza, '#5a5248');
  for (const r of L.ruins || []) box(r, '#4a4239');
  g.fillStyle = '#1b1715'; g.beginPath(); g.arc(X(L.crater.x), Y(L.crater.z), L.crater.r * k, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(185,138,255,0.8)'; g.lineWidth = 2; g.stroke();
  // buildings
  for (const f of L.footprints) {
    g.fillStyle = f.tower ? '#d8cdb9' : f.open ? '#b5a88f' : '#7c7262';
    g.fillRect(X(f.x0), Y(f.z0), (f.x1 - f.x0) * k, (f.z1 - f.z0) * k);
    if (f.open) { g.strokeStyle = 'rgba(255,178,36,0.45)'; g.lineWidth = 1; g.strokeRect(X(f.x0) + 0.5, Y(f.z0) + 0.5, (f.x1 - f.x0) * k - 1, (f.z1 - f.z0) * k - 1); }
  }
  // the highway, with its broken middle and the ramps at both ends
  const H = L.hwy;
  g.fillStyle = '#6a645a';
  for (const [a, b] of [[-H.end, H.gap[0]], [H.gap[1], H.end]]) g.fillRect(X(a), Y(H.z - H.w / 2), (b - a) * k, H.w * k);
  g.fillStyle = '#5f594f';
  for (const [a, b] of [[-H.foot, -H.end], [H.end, H.foot]]) g.fillRect(X(a), Y(H.z - H.w / 2 + 1), (b - a) * k, (H.w - 2) * k);
  g.fillStyle = '#8a8172'; g.fillRect(X(H.gap[0] + 8), Y(H.z - 6), (H.gap[1] - H.gap[0] - 8) * k, 12 * k);
  // the off-ramps: west down to the street, east broken off (its fallen piece lighter)
  g.fillStyle = '#5f594f';
  if (H.west) g.fillRect(X(H.west.x - H.west.w / 2), Y(H.west.z0), H.west.w * k, (H.west.z1 - H.west.z0) * k);
  if (H.east) {
    g.fillRect(X(H.east.x - H.east.w / 2), Y(H.east.z1), H.east.w * k, (H.east.z0 - H.east.z1) * k);
    g.fillStyle = '#8a8172'; g.fillRect(X(H.east.x - H.east.w / 2 + 0.7), Y(H.east.fallen), (H.east.w - 1.5) * k, (H.east.z1 - H.east.fallen) * k);
  }
  // the Underground Base, and its escape hatch
  const B = L.bunker;
  g.strokeStyle = 'rgba(185,138,255,0.75)'; g.setLineDash([4, 4]); g.lineWidth = 1.5;
  g.strokeRect(X(B.x0), Y(B.z0), (B.x1 - B.x0) * k, (B.z1 - B.z0) * k);
  g.setLineDash([]);
  if (B.exit) { g.fillStyle = '#b98aff'; g.fillRect(X(B.exit.x0) - 2, Y(B.exit.top.z) - 2, 4, 4); }
  // labels: landmarks and extraction points
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const m of L.landmarks) {
    g.font = '700 15px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(m.name.toUpperCase(), X(m.x) + 1, Y(m.z) - 15);
    g.fillStyle = '#f1e8da'; g.fillText(m.name.toUpperCase(), X(m.x), Y(m.z) - 16);
    g.fillStyle = '#f1e8da'; g.beginPath(); g.arc(X(m.x), Y(m.z), 3.5, 0, Math.PI * 2); g.fill();
  }
  for (const e of L.extracts) {
    const x = X(e.x), y = Y(e.z);
    g.fillStyle = '#5dff9b';
    g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.fill();
    g.font = '700 14px "Barlow Condensed", "Arial Narrow", sans-serif';
    const ty = e.z < 0 ? y + 20 : y - 20, tx = Math.max(60, Math.min(PX - 60, x));
    g.fillStyle = '#5dff9b'; g.fillText(e.name.toUpperCase(), tx, ty);
  }
  // north
  g.fillStyle = '#ffb224'; g.font = '800 20px "Barlow Condensed", sans-serif';
  g.fillText('N', PX / 2, 18);
}
