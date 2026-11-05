// Modern voxel ships (0.25 m blocks): tugboats to cruise ships. Building, destruction, repair, compartments
// that flood through holes, buoyancy, driving, collisions, fires, the crane and bought deck guns.
import * as THREE from 'three';
import { G, P, clamp, damp, rand, MAP_HALF, isGuest, isHost } from './state.js';
import { waveHeight, NORMAL_TEX, SKY } from './ocean.js';
import { groundHeight, ISLANDS } from './islands.js';
import { FX, voxelMaterial, VOXEL } from './fx.js';
import { sfx } from './sfx.js';

export const VS = VOXEL;           // 0.25 m
const C = 1 / VS;                  // cells per metre

// level = unlock level in FFA / campaign. sup = superstructure from z0 to z1 (fraction of the length);
// each tier: h = height (m), f / b = front / back inset (m), w = width (fraction), win = window style.
// shape: b = bottom width, bow = where the bow starts narrowing, st = stern narrowing.
export const SHIP_TYPES = {
  tug: { name: 'Tugboat', level: 1, L: 16, W: 6, hold: 3, maxGuns: 1, speed: 1.0, turn: 1.45, crew: 2, deck: 'steel', shape: { b: 0.72, bow: 0.5, st: 0.35 },
    sup: { z0: 0.42, z1: 0.74, tiers: [{ h: 2.5, w: 0.42, win: 'rows' }, { h: 2.25, f: 0.5, b: 1.2, w: 0.38, win: 'glass' }] },
    funnel: { z: 0.46, r: 0.38, h: 2.6, n: 2 }, extras: ['fenders', 'bitt'], crane: 0.33, desc: 'Small, tough and cheap. Fenders all round. 1 gun per side.' },
  yacht: { name: 'Motor yacht', level: 3, L: 22, W: 6, hold: 2.75, maxGuns: 2, speed: 1.4, turn: 1.25, crew: 2, deck: 'teak', shape: { b: 0.6, bow: 0.32, st: 0.08 },
    sup: { z0: 0.2, z1: 0.7, tiers: [{ h: 2.5, w: 0.42, win: 'band' }, { h: 2.25, f: 1.8, b: 1.0, w: 0.38, win: 'band' }, { h: 2, f: 3.6, b: 2.2, w: 0.3, win: 'glass' }] },
    arch: true, extras: ['swim', 'sunbeds'], crane: 0.08, desc: 'Fast, sleek, three swept decks. Up to 2 guns per side.' },
  trawler: { name: 'Fishing trawler', level: 5, L: 24, W: 7, hold: 3.5, maxGuns: 2, speed: 1.0, turn: 1.05, crew: 3, deck: 'steel', shape: { b: 0.76, bow: 0.48, st: 0.2 },
    sup: { z0: 0.58, z1: 0.82, tiers: [{ h: 2.75, w: 0.46, win: 'rows' }, { h: 2.5, f: 0.4, b: 0.8, w: 0.42, win: 'glass' }] },
    funnel: { z: 0.6, r: 0.32, h: 3, n: 1 }, extras: ['gantry', 'drum', 'mast'], crane: 0.26, desc: 'Big open work deck, A-frame gantry and net drum. Up to 2 guns per side.' },
  ferry: { name: 'Ferry', level: 8, L: 34, W: 10, hold: 4, maxGuns: 3, speed: 0.95, turn: 0.9, crew: 3, deck: 'steel', shape: { b: 0.82, bow: 0.55, st: 0.05 },
    sup: { z0: 0.14, z1: 0.8, tiers: [{ h: 2.75, w: 0.6, win: 'rows' }, { h: 2.75, f: 1, b: 0.5, w: 0.6, win: 'rows' }, { h: 2.5, f: 3, b: 4, w: 0.56, win: 'glass' }] },
    funnel: { z: 0.28, r: 0.5, h: 3.2, n: 2 }, extras: ['lifeboats', 'ramp'], crane: 0.9, desc: 'Long and roomy, twin funnels, a car ramp. Up to 3 guns per side.' },
  cargo: { name: 'Container ship', level: 12, L: 44, W: 11, hold: 5, maxGuns: 4, speed: 0.8, turn: 0.75, crew: 4, deck: 'steel', shape: { b: 0.9, bow: 0.62, st: 0.04 },
    sup: { z0: 0.04, z1: 0.17, tiers: [{ h: 2.75, w: 0.62, win: 'rows' }, { h: 2.75, w: 0.62, win: 'rows' }, { h: 2.75, w: 0.6, win: 'rows' }, { h: 2.75, w: 0.58, win: 'rows' }, { h: 2.5, f: 0.25, w: 0.82, win: 'glass' }] },
    funnel: { z: 0.06, r: 0.9, h: 3.8, n: 1 }, containers: { to: 0.87, high: 2 }, extras: ['cranes'], crane: 0.92, desc: 'A tall bridge tower and walls of containers. Up to 4 guns per side.' },
  cruise: { name: 'Cruise ship', level: 16, L: 58, W: 13, hold: 5.5, maxGuns: 5, speed: 0.85, turn: 0.7, crew: 5, deck: 'teak', shape: { b: 0.85, bow: 0.6, st: 0.18 },
    sup: { z0: 0.08, z1: 0.84, tiers: [{ h: 2.75, w: 0.72, win: 'rows' }, { h: 2.75, f: 0.6, w: 0.74, win: 'balcony' }, { h: 2.75, f: 1.6, b: 0.4, w: 0.74, win: 'balcony' }, { h: 2.75, f: 3, b: 0.8, w: 0.72, win: 'balcony' }, { h: 2.75, f: 5, b: 2, w: 0.68, win: 'balcony' }, { h: 2.5, f: 7.5, b: 14, w: 0.5, win: 'glass' }] },
    funnel: { z: 0.13, r: 1.1, h: 4.2, n: 1 }, extras: ['lifeboats', 'pool', 'slide'], crane: 0.93, desc: 'A floating city: six decks, a pool and a waterslide. Up to 5 guns per side.' },
};
export const T = { EMPTY: 0, HULL: 1, DECK: 2, BULK: 3, STAIR: 4, CABIN: 5, RAIL: 6, PAINT: 7, ROOF: 8, PORT: 9, CONT: 10 };
const BASE_HP = [0, 4, 3, 3, 2, 3, 2, 4, 3, 2, 3];
const ARMORED = new Set([T.HULL, T.PAINT]);
const LEAK = 0.07;
const SPEEDS = [-5.5, 0, 4, 7.5, 11];   // reverse is half of full ahead
const CONT_COLS = ['#b8382b', '#2f6db3', '#e0a02a', '#3d8a4a', '#8a8f96', '#c8642a', '#5a3d8a', '#d8d4c8'];

export const TEAM_COLORS = {
  enemy: { hull: '#2a2a2e', trim: '#b9b4a8', sail: '#a01e1e' },
  neutral: { hull: '#5a6670', trim: '#e6e2d8', sail: '#d8a020' },
  ghost: { hull: '#141c18', trim: '#2c3a33', sail: '#3dff9e' },
  rival1: { hull: '#1f4e6e', trim: '#f2efe6', sail: '#f0c419' },
  rival2: { hull: '#4b2b4f', trim: '#efe9f5', sail: '#62e0d0' },
  rival3: { hull: '#3e4a2a', trim: '#f3efe2', sail: '#ff8a3a' },
};
export const playerColors = () => ({ hull: P.hull, trim: P.trim, sail: P.sail });
export const SHAPE0 = { b: 0.8, bow: 0.55, st: 0.05 };

export function hullHalf(yN, zN, hw, sh = SHAPE0) {
  let w = hw * (sh.b + (1 - sh.b) * Math.sqrt(clamp(yN, 0, 1)));
  if (zN > sh.bow) { const b = (zN - sh.bow) / (1 - sh.bow); w *= 1 - b * b * 0.92; }
  if (zN < -0.8) { const s = (-zN - 0.8) / 0.2; w *= 1 - s * s * sh.st; }
  return w;
}

const boxGeo = new THREE.BoxGeometry(VS, VS, VS);
export const waterMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uNorm: { value: NORMAL_TEX }, uSun: { value: SKY.sunDir } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uTime; uniform sampler2D uNorm; uniform vec3 uSun; varying vec3 vW;
    void main(){
      vec2 n = (texture2D(uNorm, vW.xz * 0.33 + uTime * 0.05).xy * 2.0 - 1.0) * 0.6 + (texture2D(uNorm, vW.xz * 0.9 - uTime * 0.08).xy * 2.0 - 1.0) * 0.4;
      vec3 N = normalize(vec3(n.x, 1.2, n.y));
      vec3 V = normalize(cameraPosition - vW);
      if (!gl_FrontFacing) {   // seen from under the flood water
        float up = pow(max(-V.y, 0.0), 2.0);
        gl_FragColor = vec4(mix(vec3(0.03, 0.08, 0.07), vec3(0.2, 0.3, 0.25), up) + n.x * 0.03, 0.9);
        #include <colorspace_fragment>
        return;
      }
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 col = mix(vec3(0.025, 0.09, 0.1), vec3(0.22, 0.3, 0.3), fres * 0.8);
      col += vec3(0.9, 0.85, 0.7) * pow(max(dot(reflect(-V, N), uSun), 0.0), 120.0) * 0.35;
      float foam = smoothstep(0.62, 0.92, texture2D(uNorm, vW.xz * 1.2 + uTime * 0.12).z) * 0.18;
      gl_FragColor = vec4(col + foam, 0.87);
      #include <colorspace_fragment>
    }`,
});
const steel = new THREE.MeshStandardMaterial({ color: '#4a4f55', roughness: 0.45, metalness: 0.7 });
const dark = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.5, metalness: 0.5 });
const white = new THREE.MeshStandardMaterial({ color: '#e8e6e0', roughness: 0.6 });
const orange = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.6 });
const rope = new THREE.MeshStandardMaterial({ color: '#b39b6e', roughness: 1 });
const yellow = new THREE.MeshStandardMaterial({ color: '#e0a82a', roughness: 0.5, metalness: 0.35 });
const gunGrey = new THREE.MeshStandardMaterial({ color: '#7d858c', roughness: 0.5, metalness: 0.6 });
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m4 = new THREE.Matrix4();
let uid = 0, signTex = null;

export class Ship {
  constructor(key, o = {}) {
    const def = SHIP_TYPES[key];
    const team = o.team || 'neutral';
    this.id = o.id ?? ++uid; uid = Math.max(uid, this.id); this.key = key; this.def = def; this.team = team; this.name = o.name || def.name;
    this.ghost = !!o.ghost; this.shape = def.shape;
    this.guns = clamp(o.guns ?? 0, 0, def.maxGuns);
    this.armor = o.armor || 0; this.pump = o.pump || 0; this.engine = o.engine || 0; this.hpMult = o.hpMult || 1;
    this.nx = Math.round(def.W * C / 2) * 2; this.nz = Math.round(def.L * C); this.H = Math.round(def.hold * C);
    this.tierH = def.sup.tiers.map(t => Math.round(t.h * C));
    this.ny = Math.max(this.H + 14, this.H + 1 + this.tierH.reduce((s, h) => s + h + 1, 0) + 2);
    this.hw = this.nx * VS / 2; this.hl = this.nz * VS / 2;
    this.deckTop = (this.H + 1) * VS; this.draft = this.H * VS * 0.52;
    this.colors = o.colors || (team === 'player' ? playerColors() : TEAM_COLORS[this.ghost ? 'ghost' : team] || TEAM_COLORS.neutral);
    this.x = o.x || 0; this.z = o.z || 0; this.yaw = o.yaw || 0;
    this.y = -this.draft; this.vy = 0; this.pitch = 0; this.vp = 0; this.roll = 0; this.vr = 0;
    this.speed = 0; this.throttle = 0; this.rudder = 0; this.rudderIn = 0;
    this.driver = null; this.sinking = false; this.sunk = false; this.gone = false; this.sinkT = 0;
    this.lastHitBy = null; this.flood = 0; this.leakRate = 0; this.fires = []; this.fireT = 0;
    this.group = new THREE.Group();
    this.inv = new THREE.Matrix4();
    this.holes = new Set();
    this.bulkHoles = [0, 0];
    this.dirty = false;
    this.build();
    this.buildProps();
    this.updateMatrices();
    G.scene.add(this.group);
  }

  // ---------- grid helpers ----------
  idx(i, j, k) { return i + this.nx * (j + this.ny * k); }
  xOf(i) { return (i - this.nx / 2 + 0.5) * VS; }
  yOf(j) { return (j + 0.5) * VS; }
  zOf(k) { return (k - this.nz / 2 + 0.5) * VS; }
  zAt(m) { return -this.hl + m; }
  cellOf(x, y, z) { return [Math.floor(x / VS + this.nx / 2), Math.floor(y / VS), Math.floor(z / VS + this.nz / 2)]; }
  get(i, j, k) {
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return 0;
    return this.cells[this.idx(i, j, k)];
  }
  solidAt(x, y, z) { const [i, j, k] = this.cellOf(x, y, z); return this.get(i, j, k); }
  ijk(n) { const nx = this.nx, ny = this.ny; return [n % nx, ((n / nx) | 0) % ny, (n / (nx * ny)) | 0]; }
  toLocal(v) { return v.applyMatrix4(this.inv); }
  toWorld(v) { return v.applyMatrix4(this.group.matrixWorld); }
  dirToWorld(v) { return v.transformDirection(this.group.matrixWorld); }
  dirToLocal(v) { return v.transformDirection(this.inv); }
  velocity(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw) * this.speed, this.vy, Math.cos(this.yaw) * this.speed); }
  inBox(lp, m = 0) { return Math.abs(lp.x) < this.hw + m && Math.abs(lp.z) < this.hl + m && lp.y > -m - 0.3 && lp.y < this.ny * VS + m; }
  halfAt(yN, zN) { return hullHalf(yN, zN, this.hw, this.shape); }
  insideHull(lp) {
    if (lp.y < 0 || lp.y > this.deckTop || Math.abs(lp.z) > this.hl) return false;
    return Math.abs(lp.x) < this.halfAt(lp.y / this.deckTop, lp.z / this.hl);
  }
  compOfK(k) { return k <= this.bulks[0] ? 0 : k <= this.bulks[1] ? 1 : 2; }
  compAtLocal(lp) {
    if (!this.insideHull(lp) || lp.y >= this.H * VS) return null;
    const k = Math.floor(lp.z / VS + this.nz / 2);
    if (k === this.bulks[0] || k === this.bulks[1]) return null;
    return this.comps[this.compOfK(k)];
  }
  hpOf(t) { return Math.min(255, Math.round((BASE_HP[t] + (ARMORED.has(t) ? this.armor : 0)) * this.hpMult)); }
  deckEdge(k, side) {
    let edge = side > 0 ? 0 : this.nx - 1;
    for (let i = 0; i < this.nx; i++) if (this.In(i, this.H, k)) { if (side > 0) edge = i; else { edge = i; break; } }
    return this.xOf(edge);
  }
  // how far from the centre line the deck is blocked by the superstructure / containers at row k (metres)
  blockedAt(k) {
    let b = 0;
    for (const t of this.tiers) if (k >= t.k0 && k <= t.k1) b = Math.max(b, t.half * VS);
    if (this.cont && k >= this.cont.k0 && k <= this.cont.k1) b = Math.max(b, this.cont.half * VS);
    return b;
  }

  // ---------- building ----------
  build() {
    const { nx, ny, nz, H, def } = this;
    const N = nx * ny * nz;
    this.cells = new Uint8Array(N); this.orig = new Uint8Array(N); this.hp = new Uint8Array(N); this.shell = new Uint8Array(N);
    this.inst = new Int32Array(N).fill(-1);
    this.contCol = new Uint8Array(N);
    const ins = new Uint8Array(N);
    for (let k = 0; k < nz; k++) for (let j = 0; j <= H; j++) for (let i = 0; i < nx; i++)
      if (Math.abs(this.xOf(i)) <= this.halfAt(this.yOf(j) / this.deckTop, this.zOf(k) / this.hl)) ins[this.idx(i, j, k)] = 1;
    const In = (i, j, k) => i >= 0 && i < nx && k >= 0 && k < nz && j >= 0 && j <= H && ins[this.idx(i, j, k)] === 1;
    this.In = In;
    const mid = nx / 2;
    const set = (i, j, k, t) => { if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) this.orig[this.idx(i, j, k)] = t; };

    // superstructure tiers
    const sup = def.sup;
    let base = H;
    this.tiers = sup.tiers.map((ts, t) => {
      const hc = this.tierH[t];
      const tier = { k0: Math.round(sup.z0 * nz + (ts.b || 0) * C), k1: Math.round(sup.z1 * nz - (ts.f || 0) * C), half: Math.round(ts.w * nx / 2), base, h: hc, win: ts.win || 'rows' };
      base += hc + 1;
      return tier;
    });
    const t0 = this.tiers[0];
    this.cab = t0.k1; this.cabinFront = this.zOf(t0.k1) + VS / 2;
    // stairs down to the hold, inside the first tier just behind its front door
    // wider stairs and a gentler slope (2 blocks forward per step) when the first deck is long enough
    const wide = t0.half >= 9, sw2 = wide ? 3 : 2;
    const stairI = Array.from({ length: sw2 * 2 }, (_, n) => mid - sw2 + n);
    const run = clamp(Math.floor((t0.k1 - t0.k0 - 4) / H), 1, 2), SL = run * H;
    const sk = t0.k1 - 1 - SL;
    this.stair = { k0: sk, k1: sk + SL - 1, run, wide, i0: stairI[0], i1: stairI.at(-1) };
    // bulkheads (kept clear of the stairs)
    const fixB = b => (b >= sk - 2 && b <= sk + SL + 1) ? (sk - 3 > 6 ? sk - 3 : sk + SL + 2) : b;
    let b0 = fixB(Math.round(nz * 0.32)), b1 = fixB(Math.round(nz * 0.66));
    if (b1 - b0 < 8) b1 = Math.min(nz - 6, b0 + 10);
    this.bulks = [b0, b1];
    this.ladK = clamp(t0.k1 + 7, 8, Math.round(nz * 0.8));
    this.craneK = Math.round(nz * def.crane);
    const jd = Math.floor(this.draft / VS);
    this.jd = jd;

    // hull + deck + bulkheads + stairs
    for (let k = 0; k < nz; k++) for (let j = 0; j <= H; j++) for (let i = 0; i < nx; i++) {
      if (!In(i, j, k)) continue;
      const n = this.idx(i, j, k);
      const side = !In(i - 1, j, k) || !In(i + 1, j, k);
      const edge = j === 0 || side || !In(i, j, k - 1) || !In(i, j, k + 1) || !In(i, j - 1, k);
      if (j === H) {
        if (stairI.includes(i) && k >= sk && k < sk + SL) continue;
        set(i, j, k, T.DECK); this.shell[n] = 1; continue;
      }
      if (edge) { set(i, j, k, j < jd ? T.PAINT : T.HULL); this.shell[n] = 1; continue; }
      if (k === b0 || k === b1) { if (!(stairI.includes(i) && j <= 8)) set(i, j, k, T.BULK); continue; }
      if (stairI.includes(i)) { const s = Math.floor((k - sk) / run); if (k >= sk && k < sk + SL && s >= 1 && j <= s) set(i, j, k, T.STAIR); }
    }
    // containers
    if (def.containers) {
      const across = Math.max(1, Math.floor(def.W * 0.72 / 2.5)), cw = 10, cl = 24, ch = 10 * (def.containers.high || 1);
      const k0 = Math.round(nz * 0.24), k1 = Math.round(nz * (def.containers.to || 0.82));
      const rows = Math.floor((k1 - k0) / (cl + 1));
      this.cont = { k0, k1: k0 + rows * (cl + 1), half: across * cw / 2 };
      let col = 0;
      for (let r = 0; r < rows; r++) for (let a = 0; a < across; a++) {
        const ci = mid - (across * cw) / 2 + a * cw, ck = k0 + r * (cl + 1), cc = (col++ * 5 + r) % CONT_COLS.length;
        for (let k = ck; k < ck + cl; k++) for (let j = H + 1; j <= H + ch; j++) for (let i = ci; i < ci + cw; i++) {
          if (!In(i, H, k)) continue;
          const jj = (j - H - 1) % 10, level = Math.floor((j - H - 1) / 10);
          if ((r + a) % 3 === 2 && level > 0) continue;   // a few stacks are only one high
          const wall = i === ci || i === ci + cw - 1 || k === ck || k === ck + cl - 1 || jj === 0 || jj === 9;
          if (wall) { set(i, j, k, T.CONT); this.contCol[this.idx(i, j, k)] = (cc + level * 3) % CONT_COLS.length; }
        }
      }
    }
    // guns: spread along the walkways where there is room
    const cand = [];
    for (let k = Math.round(nz * 0.1); k <= Math.round(nz * 0.8); k += 4) {
      if (Math.abs(k - this.ladK) < 8 || Math.abs(k - this.craneK) < 10) continue;
      const room = Math.min(this.deckEdge(k, 1), -this.deckEdge(k, -1)) - 1.45 - this.blockedAt(k);
      if (room > 0 && this.zOf(k) / this.hl < 0.62) cand.push(k);
    }
    this.gunK = [];
    for (let n = 0; n < this.guns && cand.length; n++) this.gunK.push(cand[Math.min(cand.length - 1, Math.round((n + 0.5) / this.guns * cand.length - 0.5))]);
    // railings: solid bulwark at the bow, posts + top bar elsewhere
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      if (!In(i, H, k)) continue;
      const side = !In(i - 1, H, k) || !In(i + 1, H, k), end = !In(i, H, k - 1) || !In(i, H, k + 1);
      if (!side && !end) continue;
      const zN = this.zOf(k) / this.hl;
      if (side && (Math.abs(k - this.ladK) <= 3 || this.gunK.some(gk => Math.abs(k - gk) <= 3))) continue;
      const solid = zN > 0.7, post = side ? k % 6 === 0 : i % 6 === 0;
      for (let j = H + 1; j <= H + 4; j++) if (solid || post || j === H + 4) set(i, j, k, T.RAIL);
    }
    // a railing around the stairwell (open only at the top, where you step on)
    for (let k = sk - 1; k < sk + SL - 1; k++) for (const i of [stairI[0] - 1, stairI.at(-1) + 1]) {
      if (!In(i, H, k)) continue;
      for (let j = H + 1; j <= H + 4; j++) if (j === H + 4 || k % 4 === 0 || k === sk - 1) set(i, j, k, T.RAIL);
    }
    for (const i of stairI) for (let j = H + 1; j <= H + 4; j++) set(i, j, sk - 1, T.RAIL);
    // superstructure walls, windows, doors, roofs
    this.tiers.forEach((tr, t) => {
      const last = t === this.tiers.length - 1;
      const foot = (i, k) => k >= tr.k0 && k <= tr.k1 && i >= mid - tr.half && i < mid + tr.half && In(i, H, k) && In(i - 2, H, k) && In(i + 2, H, k);
      for (let k = tr.k0; k <= tr.k1; k++) for (let i = 0; i < nx; i++) {
        if (!foot(i, k)) continue;
        if (t > 0 && !this.orig[this.idx(i, tr.base, k)]) set(i, tr.base, k, T.ROOF);   // floor under overhangs (bridge wings)
        const front = !foot(i, k + 1), back = !foot(i, k - 1), sideW = !foot(i - 1, k) || !foot(i + 1, k);
        if (front || back || sideW) for (let j = tr.base + 1; j <= tr.base + tr.h; j++) {
          const jj = j - tr.base;
          const centre = i >= mid - 2 && i <= mid + 1;
          const door = t === 0 && jj <= 8 && (((front || back) && centre) || (sideW && !front && !back && k >= tr.k1 - 7 && k <= tr.k1 - 4));
          if (door) continue;
          const corner = sideW && (front || back), onSide = sideW && !front && !back;
          let win = false;
          if (tr.win === 'glass') win = !corner && jj >= 3 && jj <= tr.h - 2 && (onSide ? k % 6 !== 0 : i % 6 !== 0);
          else if (tr.win === 'band') win = !corner && jj >= 3 && jj <= Math.min(6, tr.h - 2) && (onSide ? k % 12 !== 0 : i % 12 !== 0);
          else if (tr.win === 'balcony') win = jj >= 3 && jj <= Math.min(7, tr.h - 2) && (onSide ? k % 4 !== 0 : i % 4 !== 0);
          else win = jj >= 4 && jj <= Math.min(6, tr.h - 2) && (onSide ? k % 5 !== 0 : i % 4 !== 0);
          void last;
          set(i, j, k, win ? T.PORT : T.CABIN);
        }
        set(i, tr.base + tr.h + 1, k, T.ROOF);
      }
    });

    // instances
    let count = 0;
    for (let n = 0; n < N; n++) if (this.orig[n]) count++;
    const mat = voxelMaterial(this.ghost ? { emissive: new THREE.Color('#0b3a24'), emissiveIntensity: 0.6 } : {});
    this.mesh = new THREE.InstancedMesh(boxGeo, mat, count);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.shellTotal = 0;
    let id = 0;
    for (let n = 0; n < N; n++) {
      const t = this.orig[n];
      if (!t) continue;
      const [i, j, k] = this.ijk(n);
      this.cells[n] = t; this.hp[n] = this.hpOf(t); this.inst[n] = id;
      this.mesh.setMatrixAt(id, m4.makeTranslation(this.xOf(i), this.yOf(j), this.zOf(k)));
      if (this.shell[n]) this.shellTotal++;
      id++;
    }
    this.shellLeft = this.shellTotal;
    this.recolor();
    this.mesh.computeBoundingSphere();
    this.group.add(this.mesh);

    // compartments + their water surfaces
    const ranges = [[1, b0 - 1], [b0 + 1, b1 - 1], [b1 + 1, nz - 2]];
    this.comps = ranges.map(([k0, k1], ci) => {
      const cz = (this.zOf(k0) + this.zOf(k1)) / 2;
      const rows = [];
      for (let j = 1; j < H; j++) {
        const pos = [];
        let area = 0;
        for (let k = k0; k <= k1; k++) {
          let run = -1;
          for (let i = 0; i <= nx; i++) {
            const open = i < nx && In(i, j, k) && !this.orig[this.idx(i, j, k)];
            if (open) { area += VS * VS; if (run < 0) run = i; }
            else if (run >= 0) {
              const x0 = this.xOf(run) - VS / 2, x1 = this.xOf(i - 1) + VS / 2, z0 = this.zOf(k) - VS / 2 - cz, z1 = z0 + VS;
              pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1);
              run = -1;
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        rows.push({ area: Math.max(area, 0.01), geo });
      }
      const cap = rows.reduce((s, r) => s + r.area * VS, 0);
      const water = new THREE.Mesh(rows[0].geo, waterMat);
      water.visible = false; water.renderOrder = 2; water.frustumCulled = false;
      this.group.add(water);
      return { i: ci, k0, k1, cz, rows, cap, vol: 0, level: VS, water, row: 0, name: ['Stern', 'Middle', 'Bow'][ci] };
    });
    this.cap = this.comps.reduce((s, c) => s + c.cap, 0);
    const smid = sk + Math.floor(SL / 2);
    this.openings = [{ lp: new THREE.Vector3(0, this.deckTop - 0.1, this.zOf(smid)), comp: this.compOfK(smid), size: 40 }];
  }

  recolor(colors) {
    if (colors) this.colors = colors;
    const hull = new THREE.Color(this.colors.hull), trim = new THREE.Color(this.colors.trim), stripe = new THREE.Color(this.colors.sail);
    const deck = new THREE.Color(this.ghost ? '#2f3530' : this.def.deck === 'teak' ? '#b08a58' : '#77807a');
    const bulk = new THREE.Color('#5a5f62'), paint = new THREE.Color(this.ghost ? '#16201b' : '#8a2a22');
    const glass = new THREE.Color(this.ghost ? '#3dff9e' : '#1d3442'), roof = trim.clone().multiplyScalar(0.82), boot = new THREE.Color('#1c1c1e');
    const conts = CONT_COLS.map(c => new THREE.Color(c));
    const c = new THREE.Color();
    const H = this.H, teak = this.def.deck === 'teak';
    for (let n = 0; n < this.orig.length; n++) {
      const t = this.orig[n]; if (!t) continue;
      const [i, j, k] = this.ijk(n);
      let jit = 0.95 + (((n * 2654435761) >>> 0) % 1000) / 1000 * 0.07;
      if (t === T.HULL) {
        if (j >= H - 3 && j <= H - 2) c.copy(stripe);
        else if (j <= this.jd + 1) c.copy(boot);
        else c.copy(hull);
      } else if (t === T.PAINT) c.copy(paint);
      else if (t === T.DECK) {
        if (teak) { const plank = i >> 1; c.copy(deck).multiplyScalar((i % 2 ? 1 : 0.9) * (0.92 + ((plank * 7919) % 13) / 100) * ((k + plank * 5) % 16 === 0 ? 0.78 : 1)); }
        else c.copy(deck).multiplyScalar(i % 8 === 0 || k % 10 === 0 ? 0.85 : 1);
        jit = 1;
      } else if (t === T.BULK) c.copy(bulk);
      else if (t === T.STAIR) c.copy(bulk).multiplyScalar(j % 2 ? 0.8 : 1);
      else if (t === T.CABIN) c.copy(trim);
      else if (t === T.RAIL) c.copy(trim);
      else if (t === T.PORT) { c.copy(glass); jit = 1; }
      else if (t === T.CONT) { c.copy(conts[this.contCol[n]]).multiplyScalar(k % 2 ? 0.86 : 1); }
      else c.copy(roof);
      this.mesh.setColorAt(this.inst[n], c.multiplyScalar(jit));
    }
    this.mesh.instanceColor.needsUpdate = true;
    if (this.stripeMat) this.stripeMat.color.set(this.colors.sail);
    if (this.flag) this.flag.material.color.set(this.colors.sail);
  }

  buildProps() {
    const dt = this.deckTop, def = this.def;
    const add = (geo, mat, x, y, z, parent = this.group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const top = this.tiers.at(-1), roofY = (top.base + top.h + 2) * VS;
    this.stripeMat = new THREE.MeshStandardMaterial({ color: this.colors.sail, roughness: 0.5, emissive: this.ghost ? '#0f5' : '#000', emissiveIntensity: this.ghost ? 0.4 : 0 });
    // funnel
    if (def.funnel) {
      const f = def.funnel, fz = this.zOf(Math.round(def.funnel.z * this.nz));
      const xs = f.n === 2 ? [-f.r * 1.4, f.r * 1.4] : [0];
      for (const fx of xs) {
        const fy = (this.topAt(fx, fz) ?? dt);
        const body = add(new THREE.CylinderGeometry(f.r, f.r * 1.15, f.h, 16), this.stripeMat, fx, fy + f.h / 2, fz); body.scale.z = 1.6; body.rotation.x = -0.12;
        const cap = add(new THREE.CylinderGeometry(f.r * 1.02, f.r * 1.02, f.h * 0.16, 16), dark, fx, fy + f.h * 0.93, fz - f.h * 0.05); cap.scale.z = 1.6; cap.rotation.x = -0.12;
        const band = add(new THREE.CylinderGeometry(f.r * 1.03, f.r * 1.03, f.h * 0.1, 16), white, fx, fy + f.h * 0.6, fz - f.h * 0.035); band.scale.z = 1.6; band.rotation.x = -0.12;
        this.smokeLp = new THREE.Vector3(fx, fy + f.h + 0.2, fz - f.h * 0.1);
      }
    }
    this.buildExtras(add, dt, roofY);
    // radar mast on the top tier
    const rz = this.zOf(top.k1) - 1.2;
    add(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), white, 0, roofY + 1.2, rz);
    this.radar = add(new THREE.BoxGeometry(1.6, 0.12, 0.2), dark, 0, roofY + 2.45, rz);
    add(new THREE.BoxGeometry(1.2, 0.08, 0.08), white, 0, roofY + 1.6, rz);
    for (const [s, col] of [[1, '#ff2a2a'], [-1, '#22ff55']]) add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2 }), s * top.half * VS, roofY - 0.1, this.zOf(top.k1));
    if (def.arch) {   // yacht radar arch
      const az = this.zOf(top.k0) + 0.6;
      for (const s of [1, -1]) { const leg = add(new THREE.BoxGeometry(0.2, 1.6, 0.6), white, s * (top.half * VS - 0.3), roofY + 0.7, az); leg.rotation.z = s * 0.25; }
      add(new THREE.BoxGeometry(top.half * VS * 2 - 0.2, 0.25, 0.7), white, 0, roofY + 1.5, az);
    }
    // lifeboats along the sides
    if (def.extras?.includes('lifeboats')) {
      const t1 = this.tiers[1] || this.tiers[0], y = (t1.base + 3) * VS;
      for (let k = t1.k0 + 12; k < t1.k1 - 10; k += 22) for (const s of [1, -1]) {
        const lb = add(new THREE.CapsuleGeometry(0.55, 2.4, 4, 10), orange, s * (t1.half * VS + 0.55), y, this.zOf(k));
        lb.rotation.x = Math.PI / 2; lb.scale.set(1, 1, 0.7);
      }
    }
    // stern flag
    const pole = add(new THREE.CylinderGeometry(0.03, 0.04, 2.6, 6), steel, 0, dt + 1.3, -this.hl + 0.5);
    void pole;
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7, 6, 1), new THREE.MeshStandardMaterial({ color: this.colors.sail, side: THREE.DoubleSide }));
    this.flag.geometry.translate(0, 0, -0.6); this.flag.rotation.y = Math.PI / 2;
    this.flag.position.set(0, dt + 2.3, -this.hl + 0.5);
    this.group.add(this.flag);
    // bow light + anchor
    add(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffe9b0', emissiveIntensity: 2 }), 0, dt + 1.2, this.hl - 0.6);
    this.lampLp = new THREE.Vector3(0, this.deckTop - 0.6, this.zOf(this.stair.k0 + 3));
    // a sign over the stairwell and a lamp bulb you can actually see
    if (!signTex) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#e0a82a'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#1d1f22'; x.fillRect(6, 6, 244, 52);
      x.fillStyle = '#e0a82a'; x.font = 'bold 36px sans-serif'; x.textAlign = 'center'; x.fillText('⬇ HOLD', 128, 45);
      signTex = new THREE.CanvasTexture(c);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
    sign.position.set(0, dt + 2.1, this.zOf(this.stair.k1) + 0.3);
    this.group.add(sign);
    add(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd9a0', emissiveIntensity: 3 }), 0, this.deckTop - 0.35, this.zOf(this.stair.k0 + 3));

    // helm console in front of the superstructure
    const t0 = this.tiers[0];
    const hx = Math.min(1.5, t0.half * VS * 0.6);
    this.wheelLp = new THREE.Vector3(hx, dt, this.cabinFront + 2.0);
    this.driverLp = new THREE.Vector3(hx, dt, this.cabinFront + 0.8);
    const hg = new THREE.Group(); hg.position.copy(this.wheelLp);
    add(new THREE.BoxGeometry(0.8, 0.95, 0.45), white, 0, 0.47, 0, hg);
    const panel = add(new THREE.BoxGeometry(0.78, 0.05, 0.5), dark, 0, 1.0, -0.05, hg); panel.rotation.x = -0.5;
    add(new THREE.BoxGeometry(0.3, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: '#4fd1ff' }), 0, 1.03, -0.12, hg).rotation.x = -0.5;
    this.wheel = new THREE.Group();
    this.wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 18), dark));
    for (let s = 0; s < 3; s++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.02), dark); sp.rotation.z = s * Math.PI / 3; this.wheel.add(sp); }
    this.wheel.position.set(0, 1.12, -0.32); this.wheel.rotation.x = -0.5;
    this.throttleLever = add(new THREE.BoxGeometry(0.04, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: '#d33' }), 0.28, 1.1, -0.05, hg);
    hg.add(this.wheel);
    this.group.add(hg);

    // crane
    const cz = this.zOf(this.craneK);
    // the crane stands on the side opposite the helm so it never blocks the view forward
    const cx = this.craneK > this.tiers[0].k1 ? -Math.min(this.hw * 0.45, Math.abs(this.deckEdge(this.craneK, -1)) - 0.8) : 0;
    this.crane = { base: new THREE.Vector3(cx, dt, cz), yaw: Math.PI / 2, reach: 5, drop: 2, boomH: 4.6, held: null, user: null };
    const cg = new THREE.Group(); cg.position.copy(this.crane.base);
    add(new THREE.CylinderGeometry(0.3, 0.45, this.crane.boomH, 10), yellow, 0, this.crane.boomH / 2, 0, cg);
    this.crane.arm = new THREE.Group(); this.crane.arm.position.y = this.crane.boomH;
    add(new THREE.BoxGeometry(0.9, 0.7, 0.9), yellow, 0, 0.1, -0.3, this.crane.arm);
    add(new THREE.BoxGeometry(0.5, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: '#1d3442', metalness: 0.8, roughness: 0.1 }), 0, 0.2, 0.16, this.crane.arm);
    this.crane.boom = add(new THREE.BoxGeometry(0.3, 0.3, 1), yellow, 0, 0, 0, this.crane.arm);
    this.crane.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), steel);
    this.crane.hook = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 12, Math.PI * 1.4), steel);
    cg.add(this.crane.arm);
    this.group.add(cg, this.crane.cable, this.crane.hook);

    // deck guns (bought)
    this.cannons = [];
    for (const k of this.gunK) for (const side of [1, -1]) {
      const x = this.deckEdge(k, side) - side * 1.0;
      const c = { side, lp: new THREE.Vector3(x, dt, this.zOf(k)), yaw: 0, pitch: 0.12, cd: 0, user: null };
      const g = new THREE.Group();
      add(new THREE.CylinderGeometry(0.42, 0.5, 0.3, 14), gunGrey, 0, 0.15, 0, g);
      const pivot = new THREE.Group(); pivot.position.y = 0.66;
      const turret = add(new THREE.BoxGeometry(0.9, 0.55, 0.85), gunGrey, side * 0.05, -0.05, 0, pivot);
      void turret;
      const front = add(new THREE.BoxGeometry(0.25, 0.4, 0.75), gunGrey, side * 0.55, -0.08, 0, pivot); front.rotation.z = side * 0.4;
      const barrel = add(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 10), dark, side * 1.15, 0, 0, pivot); barrel.rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10).rotateZ(Math.PI / 2), dark, side * 1.95, 0, 0, pivot);
      g.add(pivot); g.position.copy(c.lp);
      c.group = g; c.pivot = pivot;
      this.group.add(g);
      this.cannons.push(c);
    }

    // boarding ladders (steel) on both sides
    this.ladders = [];
    const lz = this.zOf(this.ladK);
    for (const side of [1, -1]) {
      const lx = this.deckEdge(this.ladK, side) + side * (VS / 2 + 0.05);
      const bottom = this.draft - 2.2, len = dt - bottom;
      const lg = new THREE.Group();
      for (const dz of [-0.3, 0.3]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), steel); r.position.set(0, len / 2, dz); lg.add(r); }
      for (let y = 0.3; y < len; y += 0.35) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5), steel); r.rotation.x = Math.PI / 2; r.position.set(0, y, 0); lg.add(r); }
      lg.position.set(lx, bottom, lz);
      this.group.add(lg);
      this.ladders.push({ side, x: lx, z: lz, bottom });
    }
  }

  // type-specific equipment that makes every ship look different
  buildExtras(add, dt, roofY) {
    const ex = this.def.extras || [];
    const rubber = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 });
    const green = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.8 });
    const poolMat = new THREE.MeshStandardMaterial({ color: '#2fb4d8', roughness: 0.1, metalness: 0.2, emissive: '#0a4a5a', emissiveIntensity: 0.4 });
    const roofOf = t => (t.base + t.h + 2) * VS;
    if (ex.includes('fenders')) {
      for (let z = -this.hl + 1; z < this.hl - 1.5; z += 1.3) for (const s of [1, -1]) {
        const k = Math.round(z / VS + this.nz / 2);
        const tyre = add(new THREE.TorusGeometry(0.32, 0.13, 8, 14), rubber, this.deckEdge(k, s) + s * 0.28, dt - 0.55, z);
        tyre.rotation.y = Math.PI / 2;
      }
      add(new THREE.BoxGeometry(1.6, 1.1, 0.5), rubber, 0, dt - 0.2, this.hl - 0.1);
    }
    if (ex.includes('bitt')) {
      const z = this.zAt(1.6);
      for (const s of [1, -1]) add(new THREE.CylinderGeometry(0.16, 0.18, 0.7, 10), steel, s * 0.35, dt + 0.35, z);
      add(new THREE.BoxGeometry(0.9, 0.1, 0.12), steel, 0, dt + 0.6, z);
      const drum = add(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 14), new THREE.MeshStandardMaterial({ color: '#b02a1e' }), 0, dt + 0.45, this.zAt(3)); drum.rotation.z = Math.PI / 2;
    }
    if (ex.includes('swim')) {
      add(new THREE.BoxGeometry(this.hw * 1.5, 0.14, 1.3), white, 0, this.draft + 0.35, -this.hl - 0.6);
      add(new THREE.BoxGeometry(this.hw * 1.2, 0.1, 0.1), steel, 0, this.draft + 0.9, -this.hl - 1.2);
    }
    if (ex.includes('sunbeds')) for (const s of [1, -1]) {
      const bed = add(new THREE.BoxGeometry(0.7, 0.25, 1.9), white, s * 0.55, dt + 0.13, this.zOf(Math.round(this.nz * 0.8)));
      const back = add(new THREE.BoxGeometry(0.7, 0.08, 0.6), white, s * 0.55, dt + 0.4, this.zOf(Math.round(this.nz * 0.8)) - 0.75); back.rotation.x = -0.6;
      void bed;
    }
    if (ex.includes('gantry')) {
      const z = -this.hl + 1.1, h = 5.2, x = this.hw - 0.7;
      const orangeM = new THREE.MeshStandardMaterial({ color: '#e0701e', roughness: 0.5, metalness: 0.3 });
      for (const s of [1, -1]) { const leg = add(new THREE.BoxGeometry(0.3, h, 0.3), orangeM, s * x, dt + h / 2, z); leg.rotation.x = -0.18; }
      add(new THREE.BoxGeometry(x * 2 + 0.3, 0.35, 0.35), orangeM, 0, dt + h - 0.1, z - 0.45);
      for (const s of [1, -1]) add(new THREE.CylinderGeometry(0.15, 0.15, 0.25, 10).rotateZ(Math.PI / 2), steel, s * 1.2, dt + h - 0.5, z - 0.45);
    }
    if (ex.includes('drum')) {
      const drum = add(new THREE.CylinderGeometry(0.75, 0.75, 2.6, 18), green, 0, dt + 0.95, this.zAt(3.1)); drum.rotation.z = Math.PI / 2;
      for (const s of [1, -1]) { const cap = add(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 18), steel, s * 1.32, dt + 0.95, this.zAt(3.1)); cap.rotation.z = Math.PI / 2; }
      add(new THREE.BoxGeometry(2.4, 0.2, 2.2), green, 1.6, dt + 0.1, this.zAt(9));    // nets on deck
    }
    if (ex.includes('mast')) {
      const t = this.tiers.at(-1), y = roofOf(t), z = this.zOf(t.k0) + 0.5;
      add(new THREE.CylinderGeometry(0.1, 0.14, 5, 8), white, 0, y + 2.5, z);
      for (const s of [1, -1]) { const boom = add(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), steel, s * 2.4, y + 2.6, z); boom.rotation.z = s * 1.0; }
    }
    if (ex.includes('ramp')) {
      const ramp = add(new THREE.BoxGeometry(this.hw * 1.1, 2.4, 0.2), steel, 0, dt + 1.0, -this.hl - 0.15); ramp.rotation.x = 0.12;
      for (const s of [1, -1]) add(new THREE.BoxGeometry(0.12, 2.8, 0.12), steel, s * this.hw * 0.58, dt + 1.4, -this.hl + 0.1);
    }
    if (ex.includes('cranes') && this.cont) {
      const yellowM = new THREE.MeshStandardMaterial({ color: '#e0b020', roughness: 0.5, metalness: 0.3 });
      for (const f of [0.38, 0.62]) {
        const z = this.zOf(Math.round(this.cont.k0 + (this.cont.k1 - this.cont.k0) * f));
        add(new THREE.CylinderGeometry(0.45, 0.6, 7, 10), yellowM, this.hw - 1.0, dt + 3.5, z);
        add(new THREE.BoxGeometry(0.9, 1, 0.9), yellowM, this.hw - 1.0, dt + 7.2, z);
        const jib = add(new THREE.BoxGeometry(0.3, 0.3, 9), yellowM, this.hw - 2.6, dt + 8, z + 2.5); jib.rotation.set(-0.35, -0.4, 0);
      }
    }
    if (ex.includes('pool')) {
      const t = this.tiers[4] || this.tiers.at(-2), y = roofOf(t), z = this.zOf(Math.round(t.k0 + 18));
      add(new THREE.BoxGeometry(6, 0.45, 7), white, 0, y + 0.22, z + 3.5);
      add(new THREE.BoxGeometry(5.4, 0.1, 6.4), poolMat, 0, y + 0.42, z + 3.5);
      for (const s of [1, -1]) for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.6, 0.2, 1.7), new THREE.MeshStandardMaterial({ color: ['#e8e2d4', '#2f7ab5'][i % 2] }), s * 3.6, y + 0.1, z + 1 + i * 2.2);
      if (this.def.extras.includes('slide')) {
        const top = this.tiers.at(-1), ty = roofOf(top);
        const pts = [];
        for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 3.2, r = 2.2; pts.push(new THREE.Vector3(Math.cos(a) * r - this.hw * 0.45, ty + 1.5 - i / 40 * (ty + 1.5 - y - 0.6), z + 6 + Math.sin(a) * r)); }
        add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.35, 8, false), new THREE.MeshStandardMaterial({ color: '#ff8a1a', roughness: 0.4, side: THREE.DoubleSide }), 0, 0, 0);
      }
    }
  }

  // crew stand along the walkways
  crewSpots(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = Math.round(this.nz * (0.15 + 0.6 * (i + 0.5) / n));
      const side = i % 2 ? 1 : -1;
      const x = side * Math.max(0.5, Math.min(Math.abs(this.deckEdge(k, side)) - 0.8, this.blockedAt(k) + 0.6));
      out.push(new THREE.Vector3(x, this.deckTop, this.zOf(k)));
    }
    return out;
  }

  // ---------- damage / repair ----------
  removeCell(n, fx = true) {
    const t = this.cells[n];
    if (!t) return;
    this.cells[n] = 0;
    if (isHost()) G.voxOut.push(this.id, n, 0);
    this.mesh.setMatrixAt(this.inst[n], ZERO);
    this.dirty = true;
    if (this.shell[n]) { this.holes.add(n); this.shellLeft--; }
    const [i, j, k] = this.ijk(n);
    if (t === T.BULK) this.bulkHoles[k === this.bulks[0] ? 0 : 1]++;
    if (fx && Math.random() < 0.35 * (G.fxScale ?? 1)) {
      v1.set(this.xOf(i), this.yOf(j), this.zOf(k));
      this.toWorld(v1);
      const col = new THREE.Color(); this.mesh.getColorAt(this.inst[n], col);
      FX.debris(v1.x, v1.y, v1.z, col);
    }
  }
  restoreCell(n) {
    const t = this.orig[n];
    if (!t || this.cells[n]) return false;
    const [i, j, k] = this.ijk(n);
    this.cells[n] = t; this.hp[n] = this.hpOf(t);
    if (isHost()) G.voxOut.push(this.id, n, 1);
    this.mesh.setMatrixAt(this.inst[n], m4.makeTranslation(this.xOf(i), this.yOf(j), this.zOf(k)));
    this.dirty = true;
    if (this.shell[n]) { this.holes.delete(n); this.shellLeft++; }
    if (t === T.BULK) { const b = k === this.bulks[0] ? 0 : 1; this.bulkHoles[b] = Math.max(0, this.bulkHoles[b] - 1); }
    return true;
  }
  damageCell(n, amount, by) {
    if (!this.cells[n] || isGuest()) return false;
    if (by) this.lastHitBy = by;
    if (this.hp[n] > amount) { this.hp[n] -= amount; return false; }
    this.removeCell(n);
    return true;
  }
  damageSphere(wp, radius, power, by, fire = 0) {
    if (isGuest()) return 0;
    const lp = this.toLocal(v2.copy(wp));
    if (!this.inBox(lp, radius + 1)) return 0;
    if (by) this.lastHitBy = by;
    const cx = lp.x, cy = lp.y, cz = lp.z;
    const [ci, cj, ck] = this.cellOf(cx, cy, cz), rc = Math.ceil(radius / VS);
    let removed = 0;
    for (let k = ck - rc; k <= ck + rc; k++) for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (!this.get(i, j, k)) continue;
      const d = Math.hypot(this.xOf(i) - cx, this.yOf(j) - cy, this.zOf(k) - cz);
      if (d > radius) continue;
      if (this.damageCell(this.idx(i, j, k), Math.ceil(power * (1 - d / radius * 0.7)), by)) removed++;
    }
    if (fire && Math.random() < fire) this.ignite(v1.set(cx, cy, cz), true);
    return removed;
  }
  repairAt(wp, radius, max, chance = 1) {
    if (isGuest()) return 0;
    const lp = this.toLocal(v2.copy(wp));
    const [ci, cj, ck] = this.cellOf(lp.x, lp.y, lp.z), rc = Math.ceil(radius / VS);
    const list = [];
    for (let k = ck - rc; k <= ck + rc; k++) for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) continue;
      const n = this.idx(i, j, k);
      if (!this.orig[n] || this.cells[n]) continue;
      const d = Math.hypot(this.xOf(i) - lp.x, this.yOf(j) - lp.y, this.zOf(k) - lp.z);
      if (d <= radius) list.push([d, n]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let fixed = 0;
    for (const [, n] of list) {
      if (fixed >= max) break;
      if (Math.random() > chance) continue;
      if (this.restoreCell(n)) fixed++;
    }
    return fixed;
  }
  // the blocks a repair at this point would restore (for the green preview)
  repairPreview(wp, radius, max) {
    const lp = this.toLocal(v2.copy(wp));
    const [ci, cj, ck] = this.cellOf(lp.x, lp.y, lp.z), rc = Math.ceil(radius / VS);
    const list = [];
    for (let k = ck - rc; k <= ck + rc; k++) for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) continue;
      const n = this.idx(i, j, k);
      if (!this.orig[n] || this.cells[n]) continue;
      const d = Math.hypot(this.xOf(i) - lp.x, this.yOf(j) - lp.y, this.zOf(k) - lp.z);
      if (d <= radius) list.push([d, n]);
    }
    return list.sort((a, b) => a[0] - b[0]).slice(0, max).map(x => x[1]);
  }
  missingNear(wp, radius) {
    const lp = this.toLocal(v2.copy(wp));
    const [ci, cj, ck] = this.cellOf(lp.x, lp.y, lp.z), rc = Math.ceil(radius / VS);
    for (let k = ck - rc; k <= ck + rc; k++) for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) continue;
      const n = this.idx(i, j, k);
      if (this.orig[n] && !this.cells[n] && Math.hypot(this.xOf(i) - lp.x, this.yOf(j) - lp.y, this.zOf(k) - lp.z) <= radius) return true;
    }
    return false;
  }
  repairAll() { for (let n = 0; n < this.orig.length; n++) this.restoreCell(n); this.fires.length = 0; }
  repairFraction(f) {
    for (let n = 0; n < this.orig.length; n++) if (this.orig[n] && !this.cells[n] && Math.random() < f) this.restoreCell(n);
  }
  pumpAll() { for (const c of this.comps) c.vol = 0; this.sinking = false; this.sinkT = 0; }

  // ---------- fire ----------
  topAt(x, z) {
    const [i, , k] = this.cellOf(x, 0, z);
    for (let j = this.ny - 1; j >= 0; j--) if (this.get(i, j, k)) return (j + 1) * VS;
    return null;
  }
  ignite(lp, local = false) {
    if (isGuest()) return;
    if (this.fires.length >= 10 || this.sunk) return;
    const p = local ? lp.clone() : this.toLocal(lp.clone());
    const y = this.topAt(p.x, p.z);
    if (y == null) return;
    p.y = y;
    if (this.fires.some(f => f.lp.distanceTo(p) < 0.8)) return;
    this.fires.push({ lp: p, t: 0 });
  }
  extinguish(wp, radius) {
    const lp = this.toLocal(v1.copy(wp));
    const before = this.fires.length;
    this.fires = this.fires.filter(f => f.lp.distanceTo(lp) > radius);
    return before - this.fires.length;
  }
  updateFires(dt) {
    if (!this.fires.length) return;
    this.fireT -= dt;
    const tick = this.fireT <= 0;
    if (tick) this.fireT = 1.2;
    for (const f of [...this.fires]) {
      f.t += dt;
      const w = this.toWorld(v1.copy(f.lp));
      if (w.y < waveHeight(w.x, w.z) || (G.seaAmp > 1.8 && Math.random() < dt * 0.02)) { this.fires.splice(this.fires.indexOf(f), 1); FX.steam(w.x, w.y, w.z); continue; }
      if (Math.random() < dt * 14) FX.fire(w.x + rand(-0.3, 0.3), w.y + 0.1, w.z + rand(-0.3, 0.3), 1.2);
      if (Math.random() < dt * 3) FX.smoke(w.x, w.y + 1.2, w.z, 0.8, true);
      if (Math.random() < dt * 2) sfx.crackle(w);
      if (tick) {
        const [i, j, k] = this.cellOf(f.lp.x, f.lp.y - 0.1, f.lp.z);
        if (this.get(i, j, k)) this.damageCell(this.idx(i, j, k), 1, null);
        else { const y = this.topAt(f.lp.x, f.lp.z); if (y == null) { this.fires.splice(this.fires.indexOf(f), 1); continue; } f.lp.y = y; }
        if (Math.random() < 0.07 && this.fires.length < 10) this.ignite(v2.set(f.lp.x + rand(-1.5, 1.5), 0, f.lp.z + rand(-1.5, 1.5)), true);
      }
    }
  }

  // ---------- ray cast (Amanatides & Woo) in world space ----------
  raycast(origin, dir, maxDist) {
    const o = this.toLocal(v1.copy(origin)), d = this.dirToLocal(v2.copy(dir));
    const bx = this.hw, by = this.ny * VS, bz = this.hl;
    let t0 = 0, t1 = maxDist;
    for (const [oo, dd, lo, hi] of [[o.x, d.x, -bx, bx], [o.y, d.y, 0, by], [o.z, d.z, -bz, bz]]) {
      if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
      let a = (lo - oo) / dd, b = (hi - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    const t = t0 + 1e-4;
    let [i, j, k] = this.cellOf(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    i = clamp(i, 0, this.nx - 1); j = clamp(j, 0, this.ny - 1); k = clamp(k, 0, this.nz - 1);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const next = (c, s, half, oo, dd) => s === 0 ? Infinity : ((c + (s > 0 ? 1 : 0)) * VS - half - oo) / dd;
    let tx = next(i, sx, bx, o.x, d.x), ty = next(j, sy, 0, o.y, d.y), tz = next(k, sz, bz, o.z, d.z);
    const dx = sx ? VS / Math.abs(d.x) : Infinity, dy = sy ? VS / Math.abs(d.y) : Infinity, dz = sz ? VS / Math.abs(d.z) : Infinity;
    let tc = t0, axis = -1;
    for (let guard = 0; guard < 2000; guard++) {
      if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz || tc > t1) return null;
      const n = this.idx(i, j, k);
      if (this.cells[n]) {
        const normal = new THREE.Vector3(axis === 0 ? -sx : 0, axis === 1 ? -sy : 0, axis === 2 ? -sz : 0);
        if (axis < 0) normal.set(0, 1, 0);
        const point = new THREE.Vector3().copy(origin).addScaledVector(dir, tc);
        return { ship: this, dist: tc, n, point, normal: this.dirToWorld(normal) };
      }
      if (tx < ty && tx < tz) { i += sx; tc = tx; tx += dx; axis = 0; }
      else if (ty < tz) { j += sy; tc = ty; ty += dy; axis = 1; }
      else { k += sz; tc = tz; tz += dz; axis = 2; }
    }
    return null;
  }

  // ---------- simulation ----------
  updateMatrices() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.updateMatrixWorld(true);
    this.inv.copy(this.group.matrixWorld).invert();
  }
  levelOf(c) {
    let rem = c.vol;
    for (let r = 0; r < c.rows.length; r++) {
      const a = c.rows[r].area, rv = a * VS;
      if (rem <= rv || r === c.rows.length - 1) return [(r + 1) * VS + Math.min(rem / a, VS), r];
      rem -= rv;
    }
    return [VS, 0];
  }
  updateFlood(dt) {
    const m = this.group.matrixWorld;
    for (const c of this.comps) {
      [c.level, c.row] = this.levelOf(c);
      v1.set(0, c.level, c.cz).applyMatrix4(m);
      c.levelW = v1.y;
    }
    let leaks = 0;
    const flow = (c, wx, wy, wz, size, inward) => {
      const sea = waveHeight(wx, wz);
      if (wy >= sea) return;
      const head = sea - Math.max(wy, c.levelW);
      if (head <= 0) return;
      const f = LEAK * size * Math.sqrt(head) * dt;
      c.vol += f; leaks += f / dt;
      if (inward && Math.random() < dt * 1.6 * (G.fxScale ?? 1)) FX.spray(wx, wy, wz, inward.x, inward.y, inward.z, Math.min(1.6, 0.6 + head));
    };
    const skip = this.holes.size > 400 ? 2 : 1;
    let n0 = 0;
    for (const n of this.holes) {
      if (skip > 1 && (n0++ % skip)) continue;
      const [i, j, k] = this.ijk(n);
      v1.set(this.xOf(i), this.yOf(j), this.zOf(k)).applyMatrix4(m);
      v3.set(-Math.sign(this.xOf(i)) * 0.6, j === 0 ? 1 : 0.1, 0);
      this.dirToWorld(v3);
      flow(this.comps[this.compOfK(k)], v1.x, v1.y, v1.z, skip, v3);
    }
    for (const o of this.openings) { v1.copy(o.lp).applyMatrix4(m); flow(this.comps[o.comp], v1.x, v1.y, v1.z, o.size, null); }
    this.leakRate = leaks;
    if (this.pump) {
      const rate = [0, 0.6, 1.2, 2][this.pump] * dt, tot = this.comps.reduce((s, c) => s + c.vol, 0);
      if (tot > 0) for (const c of this.comps) c.vol -= rate * c.vol / tot;
    }
    for (let b = 0; b < 2; b++) {
      const a = this.comps[b], c = this.comps[b + 1];
      const diff = a.level - c.level;
      if (Math.abs(diff) < 0.005) continue;
      let f = 3 * (1 + this.bulkHoles[b] * 0.04) * Math.sqrt(Math.abs(diff)) * dt;
      f = Math.min(f, Math.abs(diff) * Math.min(a.rows[0].area, c.rows[0].area) * 0.5);
      if (diff > 0) { a.vol -= f; c.vol += f; } else { a.vol += f; c.vol -= f; }
    }
    for (const c of this.comps) if (c.vol > c.cap) {
      const extra = c.vol - c.cap; c.vol = c.cap;
      const nb = this.comps.filter(o => Math.abs(o.i - c.i) === 1 && o.vol < o.cap);
      for (const o of nb) o.vol += extra / nb.length;
    }
    let tot = 0;
    for (const c of this.comps) { c.vol = Math.max(0, c.vol); tot += c.vol; }
    this.flood = tot / this.cap;
    if (!this.sinking && this.flood > 0.9) { this.sinking = true; this.onSink?.(this); }
  }

  update(dt) {
    if (this.gone) return;
    if (isGuest()) return this.netUpdate(dt);
    const def = this.def;
    if (this.sinking) {
      this.sinkT += dt;
      for (const c of this.comps) c.vol = Math.min(c.cap, c.vol + c.cap * 0.1 * dt);
      this.throttle = 0;
    }
    let target = this.sinking ? 0 : SPEEDS[this.throttle + 1] * def.speed * (1 + this.engine * 0.08) * (1 - this.flood * 0.7);
    if (this.aground > 0 && target > 0) target = 0;            // stuck on the sand: only reverse gets you off
    // slowing down (or braking with S) is much stronger than speeding up; big ships are heavier
    const heavy = clamp(this.hl / 12, 1, 2.2);
    const slowing = Math.abs(target) < Math.abs(this.speed) - 0.05 || Math.sign(target) * Math.sign(this.speed) < 0;
    const rate = (this.brake ? 1.6 : slowing ? 0.9 : 0.4) / Math.sqrt(heavy);
    this.speed = damp(this.speed, this.brake ? Math.min(0, target) : target, rate, dt);
    this.rudder = damp(this.rudder, this.rudderIn, 2.5, dt);
    const sp = this.speed;
    this.yaw -= this.rudder * 0.3 * def.turn * (this.ai ? 0.75 : 1) * clamp(Math.abs(sp) / 5, 0.15, 1) * Math.sign(sp || 1) * dt;
    // knockback from collisions and blasts drifts off
    this.kx = (this.kx || 0) * Math.exp(-0.8 * dt); this.kz = (this.kz || 0) * Math.exp(-0.8 * dt);
    this.x += (Math.sin(this.yaw) * sp + this.kx) * dt;
    this.z += (Math.cos(this.yaw) * sp + this.kz) * dt;
    for (const ax of ['x', 'z']) if (Math.abs(this[ax]) > MAP_HALF) { this[ax] = Math.sign(this[ax]) * MAP_HALF; this.speed *= 0.9; }

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const L = this.hl * 0.7, W = this.hw * 0.8;
    const hB = waveHeight(this.x + fx * L, this.z + fz * L), hS = waveHeight(this.x - fx * L, this.z - fz * L);
    const hP = waveHeight(this.x + rx * W, this.z + rz * W), hR = waveHeight(this.x - rx * W, this.z - rz * W);
    const big = clamp(this.hl / 10, 1, 3);      // big ships rock less
    const sinkOff = Math.pow(this.flood, 1.25) * (this.deckTop - this.draft + 0.8) + (this.sinking ? this.sinkT * this.sinkT * 0.35 : 0);
    const heave = (hB + hS + hP + hR) / 4 - this.draft - sinkOff;
    const [st, , bw] = this.comps;
    const floodPitch = (st.vol / st.cap - bw.vol / bw.cap) * 0.14 + (this.sinking ? -Math.min(0.5, this.sinkT * 0.04) * Math.sign(bw.vol - st.vol || 1) : 0);
    let holeRoll = 0;
    for (const n of this.holes) { const i = n % this.nx, j = ((n / this.nx) | 0) % this.ny; if (this.yOf(j) < this.draft + 0.5) holeRoll += Math.sign(this.xOf(i)); }
    const pitchT = Math.atan2(hB - hS, 2 * L) * 0.85 / Math.sqrt(big) + floodPitch;
    const rollT = Math.atan2(hP - hR, 2 * W) * 0.85 / big - clamp(holeRoll * 0.001 * this.flood * 4, -0.25, 0.25) + this.rudder * sp * 0.006;
    this.vy += ((heave - this.y) * 6 - this.vy * 3) * dt; this.y += this.vy * dt;
    this.vp += ((pitchT - this.pitch) * 5 - this.vp * 3) * dt; this.pitch += this.vp * dt;
    this.vr += ((rollT - this.roll) * 5 - this.vr * 2.6) * dt; this.roll += this.vr * dt;
    this.updateMatrices();
    if (!this.sunk) { this.updateFlood(dt); this.updateFires(dt); }
    if (this.sinking && !this.sunk && this.y + this.deckTop < waveHeight(this.x, this.z) - 3) { this.sunk = true; this.fires.length = 0; this.onSunk?.(this); }
    if (this.sunk && this.y < -50) { this.gone = true; G.scene.remove(this.group); }
    this.updateVisuals(dt);
  }

  // which holes are under the sea right now (for the red leak markers and the ship panel)
  updateLeaks() {
    const m = this.group.matrixWorld;
    this.leakCells = []; this.leakComps = [false, false, false];
    for (const n of this.holes) {
      const [i, j, k] = this.ijk(n);
      if (j >= this.H) continue;
      v1.set(this.xOf(i), this.yOf(j), this.zOf(k)).applyMatrix4(m);
      if (v1.y > waveHeight(v1.x, v1.z) + 0.1) continue;
      this.leakComps[this.compOfK(k)] = true;
      if (this.leakCells.length < 400) this.leakCells.push(n);
    }
  }
  updateVisuals(dt) {
    this.leakT = (this.leakT ?? Math.random() * 0.3) - dt;
    if (this.leakT <= 0) { this.leakT = 0.3; this.updateLeaks(); }
    waterMat.uniforms.uTime.value = G.t;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.pitch, 0, this.roll, 'YXZ')).invert();
    for (const c of this.comps) {
      c.water.visible = c.vol > 0.05 && !this.sunk;
      if (!c.water.visible) continue;
      c.water.geometry = c.rows[Math.min(c.row, c.rows.length - 1)].geo;
      c.water.position.set(0, c.level + Math.sin(G.t * 1.7 + c.i) * 0.015, c.cz);
      c.water.quaternion.copy(tilt);
    }
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
    this.wheel.rotation.z = -this.rudder * 2.5;
    this.throttleLever.rotation.x = -this.throttle * 0.25;
    this.radar.rotation.y += dt * 2;
    if (this.flag) {
      const fp = this.flag.geometry.attributes.position;
      for (let i = 0; i < fp.count; i++) { const z = fp.getZ(i); fp.setX(i, Math.sin(G.t * 6 + z * 3) * 0.12 * (-z / 1.2)); }
      fp.needsUpdate = true;
    }
    if (this.smokeLp && !this.sinking && Math.random() < dt * (1.5 + Math.abs(this.throttle) * 2) * (G.fxScale ?? 1)) { v1.copy(this.smokeLp); this.toWorld(v1); FX.smoke(v1.x, v1.y, v1.z, 0.8, true); }
    const cr = this.crane;
    cr.arm.rotation.y = cr.yaw;
    cr.boom.scale.z = cr.reach; cr.boom.position.z = cr.reach / 2;
    const tip = this.craneTipLocal(v1), hook = this.hookLocal(v2);
    cr.cable.position.set((tip.x + hook.x) / 2, (tip.y + hook.y) / 2 + 0.15, (tip.z + hook.z) / 2);
    cr.cable.scale.y = Math.max(0.05, tip.y - hook.y);
    cr.hook.position.copy(hook);
    for (const c of this.cannons) { c.group.rotation.y = -c.yaw * c.side; c.pivot.rotation.z = c.pitch * c.side; c.cd = Math.max(0, c.cd - dt); }
    if (!this.sinking && Math.abs(this.speed) > 2 && Math.random() < Math.abs(this.speed) * dt * 1.5) {
      const s = Math.random() < 0.5 ? 1 : -1;
      v1.set(s * this.hw * 0.7, this.draft, this.hl * 0.85); this.toWorld(v1);
      FX.foam(v1.x, waveHeight(v1.x, v1.z), v1.z, 0.8);
    }
    if (this.sinking && !this.sunk && Math.random() < dt * 8) {
      v1.set(rand(-this.hw, this.hw), this.deckTop, rand(-this.hl, this.hl)); this.toWorld(v1);
      FX.foam(v1.x, waveHeight(v1.x, v1.z), v1.z, 1.5);
      if (Math.random() < 0.3) FX.splash(v1.x, waveHeight(v1.x, v1.z), v1.z, 0.5);
    }
  }

  // ---------- networking ----------
  netState() {
    const r = v => Math.round(v * 100) / 100, cr = this.crane;
    return [this.id, r(this.x), r(this.y), r(this.z), r(this.yaw), r(this.pitch), r(this.roll), r(this.speed), this.throttle, r(this.rudder),
      this.comps.map(c => r(c.vol)), this.sinking ? 1 : 0, this.sunk ? 1 : 0, this.fires.map(f => [r(f.lp.x), r(f.lp.y), r(f.lp.z)]),
      [r(cr.yaw), r(cr.reach), r(cr.drop)], this.cannons.map(c => [r(c.yaw), r(c.pitch), r(c.cd)]), this.driver?.id ?? null, this.storage?.planks ?? 0, this.team];
  }
  netApply(a) {
    const [, x, y, z, yaw, pitch, roll, speed, thr, rud, vols, sinking, sunk, fires, cr, guns, driver, planks, team] = a;
    this.net = { x, y, z, yaw, pitch, roll, t: 0 };
    this.speed = speed; this.rudder = rud;
    if (driver !== G.net.id) this.throttle = thr;     // when I'm at the helm, my own throttle wins
    vols.forEach((v, i) => { if (this.comps[i]) this.comps[i].vol = v; });
    if (sinking && !this.sinking) { this.sinking = true; this.onSink?.(this); }
    if (sunk && !this.sunk) { this.sunk = true; this.onSunk?.(this); }
    this.fires = fires.map(f => ({ lp: new THREE.Vector3(f[0], f[1], f[2]), t: 0 }));
    if (!this.crane.user || !this.crane.user.isPlayer) { this.crane.yaw = cr[0]; this.crane.reach = cr[1]; this.crane.drop = cr[2]; }
    guns.forEach((g, i) => { const c = this.cannons[i]; if (!c) return; if (c.user !== G.me) { c.yaw = g[0]; c.pitch = g[1]; } c.cd = g[2]; });
    this.driverId = driver;
    if (this.storage) this.storage.planks = planks;
    this.team = team;
  }
  netUpdate(dt) {
    const n = this.net;
    if (n) {
      n.t += dt;
      const ex = Math.min(n.t, 0.25);
      const tx = n.x + Math.sin(n.yaw) * this.speed * ex, tz = n.z + Math.cos(n.yaw) * this.speed * ex;
      const k = Math.min(1, dt * 8);
      if (Math.hypot(tx - this.x, tz - this.z) > 8) { this.x = tx; this.z = tz; this.y = n.y; this.yaw = n.yaw; }
      this.x += (tx - this.x) * k; this.z += (tz - this.z) * k; this.y += (n.y - this.y) * k;
      let dy = n.yaw - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * k; this.pitch += (n.pitch - this.pitch) * k; this.roll += (n.roll - this.roll) * k;
    }
    this.updateMatrices();
    const m = this.group.matrixWorld;
    for (const c of this.comps) { [c.level, c.row] = this.levelOf(c); v1.set(0, c.level, c.cz).applyMatrix4(m); c.levelW = v1.y; }
    let tot = 0; for (const c of this.comps) tot += c.vol; this.flood = tot / this.cap;
    // fire visuals only
    for (const f of this.fires) { if (Math.random() < dt * 10) { const w = this.toWorld(v1.copy(f.lp)); FX.fire(w.x + rand(-0.3, 0.3), w.y + 0.1, w.z + rand(-0.3, 0.3), 1.2); if (Math.random() < 0.2) FX.smoke(w.x, w.y + 1.2, w.z, 0.8, true); } }
    if (this.sunk && this.y < -50) { this.gone = true; G.scene.remove(this.group); }
    this.updateVisuals(dt);
  }
  netSpawn() {
    return { id: this.id, key: this.key, o: { team: this.team, guns: this.guns, armor: this.armor, pump: this.pump, engine: this.engine, ghost: this.ghost, hpMult: this.hpMult, name: this.name, x: this.x, z: this.z, yaw: this.yaw, colors: this.colors } };
  }

  craneTipLocal(out) { const c = this.crane; return out.set(c.base.x + Math.sin(c.yaw) * c.reach, c.base.y + c.boomH, c.base.z + Math.cos(c.yaw) * c.reach); }
  hookLocal(out) { this.craneTipLocal(out); out.y -= this.crane.drop; return out; }
  hookWorld(out = new THREE.Vector3()) { return this.toWorld(this.hookLocal(out)); }
  cannonMuzzle(c, pos = new THREE.Vector3(), dir = new THREE.Vector3()) {
    const dx = c.side * Math.cos(c.yaw), dz = Math.sin(c.yaw);
    dir.set(dx * Math.cos(c.pitch), Math.sin(c.pitch), dz * Math.cos(c.pitch));
    pos.copy(c.lp).add(v3.set(0, 0.66, 0)).addScaledVector(dir, 2.1);
    this.toWorld(pos); this.dirToWorld(dir);
    return [pos, dir];
  }
  stats() { return { hull: this.shellLeft / this.shellTotal, flood: this.flood, leak: this.leakRate, speed: this.speed, throttle: this.throttle, fires: this.fires.length }; }
}

// ---------- ship <-> ship and ship <-> island collisions ----------
// Hulls collide by their real outline. The heavier ship shoves the lighter one, damage is torn out where they
// touch (scaled by impact speed and mass), bows are tougher than sides. Islands: you run aground.
const hitCool = new Map();
const mass = s => s.hl * s.hw * s.def.hold;
function outline(s) {
  const pts = [], n = Math.max(6, Math.round(s.hl / 1.5));
  for (let i = 0; i <= n; i++) {
    const zN = -0.97 + 1.94 * i / n, z = zN * s.hl, w = s.halfAt(0.6, zN) * 0.97;
    pts.push([w, z], [-w, z]);
    if (i === n) pts.push([0, s.hl * 0.99]);
  }
  return pts;
}
const toWorld2 = (s, lx, lz) => [s.x + Math.cos(s.yaw) * lx + Math.sin(s.yaw) * lz, s.z - Math.sin(s.yaw) * lx + Math.cos(s.yaw) * lz];
const toLocal2 = (s, wx, wz) => { const dx = wx - s.x, dz = wz - s.z; return [Math.cos(s.yaw) * dx - Math.sin(s.yaw) * dz, Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz]; };
function impact(s, wx, wz, rel, by, scale) {
  const lz = toLocal2(s, wx, wz)[1];
  const bow = lz / s.hl > 0.75 ? 0.45 : 1;         // the bow is built to take it
  const r = clamp(0.7 + rel * 0.12, 0.8, 2.6);
  s.damageSphere(v3.set(wx, s.y + s.draft + 0.2, wz), r, rel * 1.1 * scale * bow, by, 0.08);
}
export function shipCollisions(dt) {
  const ships = G.ships.filter(s => !s.sunk);
  // islands: run aground
  for (const s of ships) {
    s.aground = Math.max(0, (s.aground || 0) - dt);
    for (const [lx, lz] of outline(s)) {
      const [wx, wz] = toWorld2(s, lx, lz);
      const g = groundHeight(wx, wz);
      if (g < s.y + 0.35) continue;
      const isl = ISLANDS.reduce((a, b) => Math.hypot(b.x - wx, b.z - wz) < Math.hypot(a.x - wx, a.z - wz) ? b : a);
      let nx = s.x - isl.x, nz = s.z - isl.z; const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d;
      const into = -(Math.sin(s.yaw) * s.speed * nx + Math.cos(s.yaw) * s.speed * nz);      // speed towards the island
      s.x += nx * 0.12; s.z += nz * 0.12;
      if (into > 2.5 && !hitCool.get(s.id)) {
        hitCool.set(s.id, 0.7);
        sfx.crash(v1.set(wx, 0, wz)); G.shake = Math.max(G.shake || 0, Math.min(1, into * 0.08));
        s.damageSphere(v1.set(wx, s.y + 0.6, wz), 1.2 + into * 0.08, into * 0.9, null);       // the bottom tears open: leaks
        for (let i = 0; i < 12; i++) FX.debris(wx, s.y + s.draft, wz, new THREE.Color('#c9b07a'), 0.8);
        FX.splash(wx, s.y + s.draft, wz, 1.5);
        G.netFx?.({ k: 'splash', p: [wx, s.y + s.draft, wz], s: 1.5 });
      }
      if (into > 0) { s.speed *= 0.2; s.aground = 1.5; }
      break;
    }
  }
  // ship against ship
  for (let a = 0; a < ships.length; a++) for (let b = a + 1; b < ships.length; b++) {
    const A = ships[a], B = ships[b];
    if (Math.hypot(A.x - B.x, A.z - B.z) > A.hl + B.hl + 2) continue;
    let best = null;
    for (const [P, Q] of [[A, B], [B, A]]) {
      for (const [lx, lz] of outline(P)) {
        const [wx, wz] = toWorld2(P, lx, lz);
        const [qx, qz] = toLocal2(Q, wx, wz);
        if (Math.abs(qz) >= Q.hl) continue;
        const w = Q.halfAt(0.6, qz / Q.hl);
        if (Math.abs(qx) >= w) continue;
        const depth = Math.min(w - Math.abs(qx), Q.hl - Math.abs(qz));
        if (!best || depth > best.depth) {
          // push Q's local normal (sideways, or along its length near the ends) out to the world
          const side = w - Math.abs(qx) < Q.hl - Math.abs(qz);
          const lnx = side ? Math.sign(qx) : 0, lnz = side ? 0 : Math.sign(qz);
          const n = [Math.cos(Q.yaw) * lnx + Math.sin(Q.yaw) * lnz, -Math.sin(Q.yaw) * lnx + Math.cos(Q.yaw) * lnz];  // from Q towards P's point
          best = { depth, wx, wz, P, Q, n };
        }
      }
    }
    if (!best) continue;
    const { P, Q, n, depth, wx, wz } = best;
    const mp = mass(P), mq = mass(Q), tot = mp + mq;
    // separate: the light one moves more
    P.x += n[0] * depth * mq / tot; P.z += n[1] * depth * mq / tot;
    Q.x -= n[0] * depth * mp / tot; Q.z -= n[1] * depth * mp / tot;
    const vp = P.velocity(v1), vq = Q.velocity(v2);
    const rel = -((vp.x - vq.x) * n[0] + (vp.z - vq.z) * n[1]);     // closing speed
    if (rel <= 0) continue;
    // shove: momentum goes into a sideways drift
    P.kx = (P.kx || 0) + n[0] * rel * mq / tot; P.kz = (P.kz || 0) + n[1] * rel * mq / tot;
    Q.kx = (Q.kx || 0) - n[0] * rel * mp / tot; Q.kz = (Q.kz || 0) - n[1] * rel * mp / tot;
    P.speed *= 1 - 0.6 * mq / tot; Q.speed *= 1 - 0.6 * mp / tot;
    P.vr += (Math.random() - 0.5) * rel * 0.02 * mq / tot; Q.vr += (Math.random() - 0.5) * rel * 0.02 * mp / tot;
    const key = Math.min(A.id, B.id) * 100000 + Math.max(A.id, B.id);
    if (rel > 1.8 && !hitCool.get(key)) {
      hitCool.set(key, 0.8);
      sfx.crash(v3.set(wx, 0, wz));
      G.shake = Math.max(G.shake || 0, Math.min(1.2, rel * 0.1));
      impact(P, wx, wz, rel, Q.driver, mq / tot * 2);
      impact(Q, wx, wz, rel, P.driver, mp / tot * 2);
      for (let i = 0; i < 6 + rel * 2; i++) FX.spark(wx, P.y + P.draft + 0.5, wz);
    }
  }
  for (const [k, t] of hitCool) { if (t - dt <= 0) hitCool.delete(k); else hitCool.set(k, t - dt); }
}
export function spawnShip(key, opts) { const s = new Ship(key, opts); G.ships.push(s); G.netHook?.('spawn', 'ship', s); return s; }
export function despawnShip(s) { G.scene.remove(s.group); s.gone = true; G.ships = G.ships.filter(x => x !== s); G.netHook?.('despawn', 'ship', s); }
export function removeGoneShips() { for (let i = G.ships.length - 1; i >= 0; i--) if (G.ships[i].gone) { G.netHook?.('despawn', 'ship', G.ships[i]); G.ships.splice(i, 1); } }
let lamp = null;
export function updateLamps(cam) {
  if (!lamp) { lamp = new THREE.PointLight('#ffb35a', 0, 14, 1.5); G.scene.add(lamp); }
  let best = null, bd = 60;
  for (const s of G.ships) { const d = Math.hypot(s.x - cam.position.x, s.z - cam.position.z); if (!s.sunk && d < bd) { bd = d; best = s; } }
  lamp.intensity = best ? 3.2 : 0;
  if (best) { lamp.color.set(best.ghost ? '#5dffb0' : '#ffd9a0'); lamp.position.copy(best.lampLp); best.toWorld(lamp.position); }
}
