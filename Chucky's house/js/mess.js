// Cleaning: spills (coffee, mud, broken glass, chicken mess), the mop / broom / wet-floor sign from the cleaning
// corner, the sink to rinse the mop, wet floors that make customers slip, the stinking full bin, and the
// cleanliness meter (0–100 %) that changes what customers pay, how fast trust grows and how many come.
import * as THREE from 'three';
import { G, ACTIONS, rand, newUid, ensurePlayer, clamp } from './state.js';
import { part, hitMat, canvasTex } from './data.js';
import { STATIC, interactive } from './world.js';
import { trustMods, addTrust } from './economy.js';
import { addJob, mopCap, mopSpeed } from './jobs.js';
import { act, tell } from './net.js';
import { sfx } from './sfx.js';
import * as UI from './ui.js';

export const SPILLS = {
  coffee: { name: 'Spilled coffee', tool: 'mop', weight: 7, r: 0.5, color: '#4a2c14' },
  mud: { name: 'Muddy footprints', tool: 'mop', weight: 5, r: 0.55, color: '#3a2a18' },
  glass: { name: 'Broken glass', tool: 'broom', weight: 9, r: 0.45, color: '#cfe8f0' },
  poop: { name: 'Chicken mess', tool: 'mop', weight: 0, r: 0.35, color: '#6a6a3a' },
};
export const TOOLS = { mop: '🧽 Mop', broom: '🧹 Broom', sign: '⚠️ Wet floor sign' };
const WET_TIME = 25, SIGN_R = 2.6;
const BIN = new THREE.Vector3(-1.6, 0.8, 4.5);
const texCache = {};
let flies = [];

function spillTex(kind) {
  return texCache[kind] ??= canvasTex(128, 128, (g, w) => {
    const k = SPILLS[kind];
    g.clearRect(0, 0, w, w);
    if (kind === 'glass') {
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(220,240,250,${0.5 + Math.random() * 0.5})`;
        const x = 20 + Math.random() * 88, y = 20 + Math.random() * 88, s = 3 + Math.random() * 9;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + Math.random() * s); g.lineTo(x + Math.random() * s, y + s); g.fill();
      }
      return;
    }
    if (kind === 'mud') {
      for (let i = 0; i < 6; i++) {
        const x = 30 + (i % 2) * 34, y = 10 + i * 19;
        g.fillStyle = 'rgba(58,40,24,0.85)';
        g.beginPath(); g.ellipse(x, y, 9, 13, 0.2, 0, 7); g.fill();
        g.beginPath(); g.ellipse(x + 1, y + 16, 6, 6, 0, 0, 7); g.fill();
      }
      return;
    }
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 60);
    grd.addColorStop(0, k.color + 'ee'); grd.addColorStop(0.7, k.color + 'cc'); grd.addColorStop(1, k.color + '00');
    g.fillStyle = grd;
    g.beginPath();
    for (let a = 0; a < 6.3; a += 0.3) { const r = 38 + Math.random() * 20; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.fill();
    if (kind === 'coffee') { g.fillStyle = '#f4f1e6'; g.fillRect(90, 80, 16, 10); }
  });
}

export function spawnSpill(kind, x, z, sid = newUid(), ry = rand(0, 6.28)) {
  if (G.spills.length >= 24) return null;
  const k = SPILLS[kind], g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(k.r * 2, k.r * 2), new THREE.MeshStandardMaterial({ map: spillTex(kind), transparent: true, depthWrite: false, roughness: kind === 'glass' ? 0.1 : 0.3, metalness: kind === 'glass' ? 0.6 : 0 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.006; m.renderOrder = 1;
  g.add(m);
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(k.r, k.r, 0.2, 8), hitMat); hb.position.y = 0.1; g.add(hb);
  const s = { sid, kind, g, x, z };
  g.traverse(o => { o.userData.kind = 'spill'; o.userData.spill = s; });
  G.scene.add(g);
  G.spills.push(s);
  return s;
}
function removeSpill(s) { G.scene.remove(s.g); G.spills.splice(G.spills.indexOf(s), 1); }
export const penMess = () => G.spills.filter(s => s.kind === 'poop').length;

// ---------- wet floor + signs ----------
const wetMat = new THREE.MeshStandardMaterial({ color: 0x9ab8d0, transparent: true, opacity: 0.35, roughness: 0.02, metalness: 0.3, depthWrite: false });
function addWet(x, z, t = WET_TIME) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), wetMat.clone());
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.raycast = () => {};
  G.scene.add(m);
  G.wet.push({ x, z, t, m, slipped: new Set() });
}
function signMesh() {
  const g = new THREE.Group();
  const y = 0xf0c020;
  for (const s of [-1, 1]) { const p = part(g, new THREE.BoxGeometry(0.34, 0.62, 0.02), y, 0, 0.3, s * 0.1); p.rotation.x = -s * 0.3; } // the two boards lean in and meet at the top (an A, not a V)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.3), new THREE.MeshBasicMaterial({ map: canvasTex(64, 70, (c, w, h) => {
    c.fillStyle = '#f0c020'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.font = 'bold 34px sans-serif'; c.textAlign = 'center'; c.fillText('⚠', 32, 36);
    c.font = 'bold 11px sans-serif'; c.fillText('WET FLOOR', 32, 60);
  }) }));
  face.position.set(0, 0.36, 0.115); face.rotation.x = -0.3; g.add(face);
  return g;
}
function addSign(x, z, gid = newUid()) {
  const g = signMesh(); g.position.set(x, 0, z);
  const s = { gid, x, z, g };
  g.traverse(o => { o.userData.kind = 'wetsign'; o.userData.sign = s; });
  G.scene.add(g); G.signs.push(s);
  return s;
}
function removeSign(s) { G.scene.remove(s.g); G.signs.splice(G.signs.indexOf(s), 1); }
const signed = (x, z) => G.signs.some(s => Math.hypot(s.x - x, s.z - z) < SIGN_R);

// ---------- the cleaning corner (left wall, by the back) ----------
export function buildCleaning(scene) {
  const sink = new THREE.Group(); sink.position.set(-6.55, 0, -1.25);
  part(sink, new THREE.BoxGeometry(0.6, 0.85, 0.7), 0xd8dad6, 0, 0.425, 0);
  part(sink, new THREE.BoxGeometry(0.5, 0.12, 0.55), 0x9aa0a8, 0, 0.83, 0, { metalness: 0.6, roughness: 0.3 });
  part(sink, new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), 0xc0c4c8, -0.2, 1.0, 0, { metalness: 0.8 });
  part(sink, new THREE.BoxGeometry(0.2, 0.03, 0.03), 0xc0c4c8, -0.12, 1.14, 0, { metalness: 0.8 });
  interactive(sink, 'sink'); scene.add(sink);
  const closet = new THREE.Group(); closet.position.set(-6.5, 0, -0.25);
  part(closet, new THREE.CylinderGeometry(0.2, 0.17, 0.32, 12), 0xd8a020, 0.05, 0.16, 0.1, { roughness: 0.4 }); // bucket
  part(closet, new THREE.CylinderGeometry(0.18, 0.18, 0.02, 12), 0x5a8ab0, 0.05, 0.3, 0.1, { roughness: 0.05 });
  part(closet, new THREE.CylinderGeometry(0.015, 0.015, 1.3, 6), 0x8a5a2a, -0.05, 0.75, 0.05).rotation.z = 0.15; // mop
  part(closet, new THREE.CylinderGeometry(0.08, 0.1, 0.18, 8), 0xe8e4d8, 0.02, 0.15, 0.05, { roughness: 1 });
  part(closet, new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6), 0x5a3a1a, 0.15, 0.7, -0.2).rotation.z = -0.12; // broom
  part(closet, new THREE.BoxGeometry(0.25, 0.14, 0.06), 0xb08a40, 0.08, 0.1, -0.2);
  const sg = signMesh(); sg.position.set(0.1, 0, -0.45); sg.rotation.y = 0.4; closet.add(sg);
  interactive(closet, 'closet'); scene.add(closet);
  STATIC.push(new THREE.Box3(new THREE.Vector3(-6.9, 0, -1.65), new THREE.Vector3(-6.2, 1.0, 0.25)));
  // flies over a full bin
  flies = Array.from({ length: 6 }, () => { const f = part(scene, new THREE.SphereGeometry(0.012, 4, 3), 0x111111, BIN.x, BIN.y, BIN.z); f.visible = false; return f; });
}

// The mop / broom / sign you hold in first person.
export function toolMesh(tool) {
  const g = new THREE.Group();
  if (tool === 'mop') {
    part(g, new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6), 0x8a5a2a, 0, 0.1, -0.2).rotation.x = 0.9;
    part(g, new THREE.CylinderGeometry(0.07, 0.09, 0.14, 8), 0xe8e4d8, 0, -0.32, -0.55, { roughness: 1 });
  } else if (tool === 'broom') {
    part(g, new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6), 0x5a3a1a, 0, 0.1, -0.2).rotation.x = 0.9;
    part(g, new THREE.BoxGeometry(0.25, 0.08, 0.05), 0xb08a40, 0, -0.32, -0.55);
  } else { const s = signMesh(); s.scale.setScalar(0.6); s.position.set(0, -0.35, -0.2); g.add(s); }
  return g;
}

// ---------- local scrubbing (hold left mouse on a spill) ----------
const progress = new Map();
export function scrubTick(dt, spill) {
  const h = G.players[G.me]?.holding;
  if (h?.kind !== 'tool' || h.tool !== SPILLS[spill.kind].tool) return -1;
  const p = (progress.get(spill.sid) || 0) + dt * 0.55 * mopSpeed(G.me) * (h.tool === 'broom' ? 1.2 : 1);
  if (Math.random() < dt * 4) h.tool === 'mop' ? sfx.mop() : sfx.mop();
  if (p >= 1) { progress.delete(spill.sid); act('cleanSpill', spill.sid); return 1; }
  progress.set(spill.sid, p);
  return p;
}

// ---------- actions (host) ----------
const P = pid => ensurePlayer(pid);
ACTIONS.takeTool = (pid, tool) => { const p = P(pid); if (p.holding || !TOOLS[tool]) return false; p.holding = { kind: 'tool', tool, dirt: 0 }; sfx.pick(); return true; };
ACTIONS.returnTool = pid => { const p = P(pid); if (p.holding?.kind !== 'tool') return false; p.holding = null; sfx.thud(0.4); return true; };
ACTIONS.rinseMop = pid => {
  const h = P(pid).holding;
  if (h?.kind !== 'tool' || h.tool !== 'mop') return false;
  h.dirt = 0; sfx.splash(); tell(pid, 'Mop rinsed. Good as new.');
  return true;
};
ACTIONS.cleanSpill = (pid, sid) => {
  const p = P(pid), h = p.holding, s = G.spills.find(x => x.sid === sid);
  if (!s || h?.kind !== 'tool' || h.tool !== SPILLS[s.kind].tool) return false;
  if (h.tool === 'mop' && h.dirt >= mopCap(pid)) { tell(pid, 'The mop is filthy: rinse it at the sink first.', 'bad'); return false; }
  removeSpill(s);
  if (h.tool === 'mop') { h.dirt++; if (s.kind !== 'poop') addWet(s.x, s.z); }
  addJob(pid, 'cleaner', 6, 'spills');
  G.life.cleaned++;
  return true;
};
ACTIONS.placeSign = (pid, x, z) => {
  const p = P(pid);
  if (p.holding?.kind !== 'tool' || p.holding.tool !== 'sign') return false;
  addSign(x, z); p.holding = null; sfx.thud(0.5);
  return true;
};
ACTIONS.takeSign = (pid, gid) => {
  const p = P(pid), s = G.signs.find(x => x.gid === gid);
  if (!s || p.holding) return false;
  removeSign(s); p.holding = { kind: 'tool', tool: 'sign', dirt: 0 }; sfx.pick();
  return true;
};

// ---------- host simulation ----------
let cleanT = 0;
export function updateMess(dt, host) {
  for (const w of [...G.wet]) {
    if (host) w.t -= dt;
    w.m.material.opacity = 0.35 * clamp(w.t / 6, 0, 1);
    if (w.t <= 0) { G.scene.remove(w.m); G.wet.splice(G.wet.indexOf(w), 1); }
  }
  const full = G.binCount >= G.up.binCap;
  const now = performance.now() / 1000;
  flies.forEach((f, i) => {
    f.visible = full;
    if (full) f.position.set(BIN.x + Math.cos(now * 3 + i * 1.7) * 0.25, BIN.y + 0.15 + Math.sin(now * 5 + i) * 0.12, BIN.z + Math.sin(now * 2.6 + i * 2.1) * 0.25);
  });
  if (!host) return;
  // slips: customers walking across a wet floor with no sign nearby
  for (const w of G.wet) {
    if (signed(w.x, w.z)) continue;
    for (const c of G.customers) {
      if (!c.mesh || c.slip > 0 || !c.walking || w.slipped.has(c.cid)) continue;
      if (Math.hypot(c.mesh.position.x - w.x, c.mesh.position.z - w.z) > 0.9) continue;
      w.slipped.add(c.cid);
      if (Math.random() < 0.4) {
        c.slip = 1.6; c.patience = Math.max(1, (c.patience || 2) - 1);
        addTrust(-0.005); sfx.slip();
        G.alertFn?.('🫧 A customer slipped on the wet floor! Put up a wet-floor sign.');
      }
    }
  }
  if ((cleanT -= dt) <= 0) {
    cleanT = 0.5;
    const mess = G.trash.length * 5 + G.spills.reduce((s, x) => s + SPILLS[x.kind].weight, 0) + (full ? 15 : 0);
    G.clean = clamp(100 - mess, 0, 100);
  }
}

// What buyers pay: 70 % in a pigsty, 110 % in a spotless shop.
export const cleanMult = () => 0.7 + 0.4 * G.clean / 100;
trustMods.push(() => G.clean >= 80 ? 1.3 : G.clean < 40 ? 0.7 : 1);

// ---------- save / sync ----------
export const messSave = () => ({ spills: G.spills.map(s => [s.kind, +s.x.toFixed(2), +s.z.toFixed(2)]), signs: G.signs.map(s => [+s.x.toFixed(2), +s.z.toFixed(2)]) });
export function messLoad(d) {
  for (const [k, x, z] of d?.spills || []) if (SPILLS[k]) spawnSpill(k, x, z);
  for (const [x, z] of d?.signs || []) addSign(x, z);
}
export const messSnap = () => ({
  sp: G.spills.map(s => [s.sid, s.kind, +s.x.toFixed(2), +s.z.toFixed(2)]),
  sg: G.signs.map(s => [s.gid, +s.x.toFixed(2), +s.z.toFixed(2)]),
  wt: G.wet.map(w => [+w.x.toFixed(2), +w.z.toFixed(2), +w.t.toFixed(1)]),
});
export function mirrorMess(d) {
  const sids = new Set(d.sp.map(s => s[0]));
  for (const s of [...G.spills]) if (!sids.has(s.sid)) removeSpill(s);
  for (const [sid, k, x, z] of d.sp) if (!G.spills.some(s => s.sid === sid)) spawnSpill(k, x, z, sid);
  const gids = new Set(d.sg.map(s => s[0]));
  for (const s of [...G.signs]) if (!gids.has(s.gid)) removeSign(s);
  for (const [gid, x, z] of d.sg) if (!G.signs.some(s => s.gid === gid)) addSign(x, z, gid);
  // wet patches: match by position, keep the host's timer
  for (const w of G.wet) w.keep = false;
  for (const [x, z, t] of d.wt) {
    const w = G.wet.find(q => Math.hypot(q.x - x, q.z - z) < 0.05);
    if (w) { w.t = t; w.keep = true; } else { addWet(x, z, t); G.wet[G.wet.length - 1].keep = true; }
  }
  for (const w of [...G.wet]) if (!w.keep) { G.scene.remove(w.m); G.wet.splice(G.wet.indexOf(w), 1); }
}

// The little panel at the cleaning corner.
export function closetPanel() {
  UI.openPanel(`<h2>🧽 Cleaning corner</h2><p class="dim">Mop: coffee, mud and chicken mess (leaves the floor wet for a bit). Broom: broken glass.
    A wet floor without a sign nearby makes customers slip. Rinse a dirty mop at the sink.</p>
    <div class="row">${Object.entries(TOOLS).map(([k, v]) => `<button data-tool="${k}">${v}</button>`).join('')}<button id="cl-x" class="ghost">Close</button></div>`);
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { UI.closePanel(); act('takeTool', b.dataset.tool); });
  UI.$('cl-x').onclick = () => UI.closePanel();
}
