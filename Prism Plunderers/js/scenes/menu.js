// The scene behind the main menu: dusk over the dead city. A Fink hovers close to the camera and sweeps the
// street with its scan beam, a Prism drop pod glows on the horizon and more Prism drift over the ruins.
import * as THREE from 'three';
import { Engine, disposeTree, fitCamera } from '../core/engine.js';
import { UI } from '../ui/screens.js';
import { rng, damp } from '../core/util.js';
import { Raider } from '../game/raider.js';
import { glowTexture } from '../world/sky.js';
import { showRaidSummary } from '../game/raid.js';
import { P } from '../core/save.js';
import { bus } from '../core/events.js';

// ---------- the workshop (part 8): a room under the ruins, a bench for each station, Pip the rooster ----------
// Built away from the street (the camera cuts to it when the Workshop tab opens). A bench not built yet is a faint
// outline where it will stand.
const WX = -70, WZ = 30;
const BENCH_AT = { gunsmith: [-4.6, -4.1, 0x7a5a3c], medbay: [0.2, -4.3, 0xd6d8d2], gear: [4.8, -4.0, 0x8a3b2b], explosives: [6.6, 0.4, 0x5a6338] };
function buildWorkshop(scene) {
  const g = new THREE.Group();
  g.position.set(WX, 0, WZ);
  scene.add(g);
  const M = (c, r = 0.85, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, flatShading: true });
  const box = (w, h, d, x, y, z, mat, parent = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); parent.add(b); return b; };
  const wall = M(0x3d4250), floor = M(0x4a4a4c, 0.95), dark = M(0x23252b, 0.7, 0.3), wood = M(0x6b5a46);
  box(18, 0.1, 13, 0, -0.05, -0.5, floor);
  box(18, 4.6, 0.3, 0, 2.3, -6.6, wall); box(0.3, 4.6, 13, -8.6, 2.3, -0.5, wall); box(0.3, 4.6, 13, 8.6, 2.3, -0.5, wall);
  box(18, 0.3, 13, 0, 4.6, -0.5, M(0x2a2d36));
  for (const x of [-5, 0, 5]) box(0.3, 0.35, 13, x, 4.3, -0.5, dark);                    // beams
  for (let k = 0; k < 6; k++) box(0.04, 0.04, 12, -6 + k * 2.4, 4.05, -0.5, dark);         // cables
  // work lamps hanging from the beams, warm; a cold light from a doorway on the left
  for (const [x, z] of [[-4, -1.5], [2.5, -2.5], [5.5, 1]]) {
    const lamp = new THREE.Group(); lamp.position.set(x, 3.3, z); g.add(lamp);
    box(0.9, 0.22, 0.55, 0, 0, 0, dark, lamp);
    box(0.8, 0.04, 0.45, 0, -0.12, 0, new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), lamp);
    box(0.02, 1.0, 0.02, 0, 0.6, 0, dark, lamp);
    const l = new THREE.PointLight(0xffc98a, 9, 11, 1.6); l.position.y = -0.4; lamp.add(l);
  }
  const cold = new THREE.PointLight(0x6f7fff, 5, 12, 1.4); cold.position.set(-7.5, 2.6, 2.5); g.add(cold);
  g.add(new THREE.HemisphereLight(0x6a6f88, 0x201a16, 0.35));
  // clutter: an old armchair, crates, a shelf, a speaker
  box(1.0, 0.45, 0.9, -0.6, 0.25, 1.2, M(0x3a3640)); box(1.0, 0.8, 0.22, -0.6, 0.75, 0.8, M(0x3a3640));
  for (const s of [-1, 1]) box(0.18, 0.55, 0.9, -0.6 + s * 0.55, 0.45, 1.2, M(0x3a3640));
  box(0.8, 0.6, 0.6, 1.4, 0.3, 2.2, wood); box(0.6, 0.5, 0.6, 1.5, 0.85, 2.2, wood);
  box(0.4, 2.2, 1.8, -8.2, 1.1, -2.5, dark); for (const y of [0.6, 1.2, 1.8]) box(0.45, 0.05, 1.8, -8.15, y, -2.5, wood);
  box(0.7, 0.9, 0.5, -7.6, 3.2, -5.8, M(0x1a1a1e));
  // the benches: the real one (shown once built) and its outline (until then)
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fb0d8, transparent: true, opacity: 0.12, depthWrite: false });
  const benches = {};
  for (const [id, [x, z, c]] of Object.entries(BENCH_AT)) {
    const real = new THREE.Group(), ghost = new THREE.Group(), side = id === 'explosives';
    for (const [grp, top, leg] of [[real, M(c, 0.7, 0.2), dark], [ghost, ghostMat, ghostMat]]) {
      grp.position.set(x, 0, z); grp.rotation.y = side ? -Math.PI / 2 : 0; g.add(grp);
      box(2.3, 0.08, 0.95, 0, 0.92, 0, top, grp);
      for (const [lx, lz] of [[-1.05, -0.38], [1.05, -0.38], [-1.05, 0.38], [1.05, 0.38]]) box(0.07, 0.9, 0.07, lx, 0.45, lz, leg, grp);
      box(2.1, 0.05, 0.8, 0, 0.3, 0, leg, grp);
    }
    // what lies on a built bench, and its little lamp
    box(0.5, 0.3, 0.35, -0.6, 1.11, -0.15, M(0x4b5058), real); box(0.3, 0.12, 0.2, 0.5, 1.02, 0.1, M(0xb8923a), real);
    box(0.04, 0.5, 0.04, 0.95, 1.2, -0.3, dark, real); box(0.18, 0.1, 0.12, 0.95, 1.47, -0.22, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), real);
    benches[id] = { real, ghost, at: new THREE.Vector3(WX + x, 1, WZ + z) };
  }
  // Pip's pen: a low crate of straw, and Pip
  box(1.8, 0.25, 1.4, -6.2, 0.13, 2.2, wood); box(1.6, 0.06, 1.2, -6.2, 0.27, 2.2, M(0xc9a85a));
  const hen = makeHen();
  g.add(hen);
  const refresh = () => { for (const [id, b] of Object.entries(benches)) { const on = (P.workshop.stations[id] | 0) > 0; b.real.visible = on; b.ghost.visible = !on; } };
  refresh();
  return { g, benches, hen, refresh, home: new THREE.Vector3(WX - 6.2, 0, WZ + 2.2) };
}
function makeHen() {
  const g = new THREE.Group();
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M(0xb5652c));
  body.scale.set(1, 0.85, 1.25); body.position.y = 0.36; g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 5), M(0x2f3a24));
  tail.position.set(0, 0.52, -0.25); tail.rotation.x = -0.9; g.add(tail);
  const head = new THREE.Group(); head.position.set(0, 0.55, 0.2); g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 5), M(0xc8743a)); skull.position.y = 0.06; head.add(skull);
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.13), M(0xd8322a)); comb.position.set(0, 0.17, 0.01); head.add(comb);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), M(0xe0b040)); beak.position.set(0, 0.05, 0.12); beak.rotation.x = Math.PI / 2; head.add(beak);
  const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), M(0xd8322a)); wattle.position.set(0, -0.02, 0.09); head.add(wattle);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4), M(0xe0a040)); leg.position.set(s * 0.07, 0.11, 0); g.add(leg); }
  g.userData = { head };
  return g;
}

const glow = (tex, color, scale, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(scale);
  return s;
};

// The Fink stand-in, built from the concept sheet. Prototype white, thruster at the bottom.
// The enemies part replaces it with the real unit.
function makeFink(tex) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf1eef8, roughness: 0.35, metalness: 0.1, flatShading: true });
  const ink = new THREE.LineBasicMaterial({ color: 0x1a1426 });
  const part = (geo, y, mat = white) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    if (mat === white) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), ink));
    g.add(m);
    return m;
  };
  part(new THREE.ConeGeometry(0.8, 1.7, 6), 0.85);
  part(new THREE.CylinderGeometry(0.8, 0.44, 0.5, 6), -0.25);
  part(new THREE.CylinderGeometry(0.44, 0.32, 0.13, 6), -0.565);
  part(new THREE.CylinderGeometry(0.27, 0.2, 0.11, 6), -0.685);
  const flame = part(new THREE.ConeGeometry(0.15, 0.55, 6), -1.0, new THREE.MeshBasicMaterial({ color: 0xeee6ff }));
  flame.rotation.x = Math.PI;
  const halo = glow(tex, 0xa36bff, 1.6);
  halo.position.y = -1.05;
  g.add(halo);
  const light = new THREE.PointLight(0xa36bff, 6, 6, 1.6);
  light.position.y = -1.2;
  g.add(light);
  // the scan beam: a cone of light from the eye, swept over the street
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 9, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.geometry.translate(0, -4.5, 0);                 // the tip sits at the Fink
  const pivot = new THREE.Group();
  pivot.add(beam);
  pivot.position.y = 0.2;
  g.add(pivot);
  g.userData = { flame, halo, light, pivot, beam };
  return g;
}

export default function createMenu() {
  const scene = new THREE.Scene();
  const HORIZON = 0x6e4660;
  scene.fog = new THREE.FogExp2(HORIZON, 0.011);
  const camera = new THREE.PerspectiveCamera(42, Engine.w / Engine.h, 0.1, 600);
  const RZ = 2;                               // where the raider stands
  const tex = glowTexture();
  const R = rng(3000);

  // ---------- sky: deep violet above, dusty rose at the horizon, a hot band where the sun went down ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0d0718) }, mid: { value: new THREE.Color(0x3a2350) }, bot: { value: new THREE.Color(HORIZON) }, sun: { value: new THREE.Color(0xffa070) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sun; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = mix(bot, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, top, smoothstep(0.15, 0.6, h));
        float s = pow(max(0.0, 1.0 - abs(h - 0.01) * 9.0), 3.0) * (1.0 - smoothstep(-1.0, 0.2, vP.z));
        c += sun * s * 0.55;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);
  // stars
  {
    const N = 260, p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = R() * Math.PI * 2, y = 0.25 + R() * 0.75, r = Math.sqrt(1 - y * y);
      p[i * 3] = Math.cos(a) * r * 450; p[i * 3 + 1] = y * 450; p[i * 3 + 2] = Math.sin(a) * r * 450;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8ccff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.6, fog: false })));
  }

  // ---------- light ----------
  scene.add(new THREE.HemisphereLight(0x8b78c8, 0x2a1c18, 0.9));
  const sunLight = new THREE.DirectionalLight(0xff9a6a, 1.6);
  sunLight.position.set(-30, 12, -80);
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0x9a7dff, 0.7);
  fill.position.set(20, 10, 30);
  scene.add(fill);

  // ---------- ground: sand over broken asphalt ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x5a4438, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 300), new THREE.MeshStandardMaterial({ color: 0x3a2f2c, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, -120);
  scene.add(road);

  // ---------- the ruins: two rows of broken buildings down the street, one draw call each ----------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
  function ruins(count, place, mat) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
    for (let i = 0; i < count; i++) {
      place(i, pos, scl, e, col);
      mesh.setMatrixAt(i, m4.compose(pos, q.setFromEuler(e), scl));
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
  const concrete = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  ruins(150, (i, p, s, eu, c) => {
    const side = i % 2 ? 1 : -1, z = 6 - Math.floor(i / 2) * 5.2 - R() * 2;
    const tall = R.chance(0.35);
    s.set(R.range(4, 9), tall ? R.range(14, 34) : R.range(3, 13), R.range(4, 7));
    p.set(side * (8 + s.x / 2 + R() * 6), s.y / 2 - (R.chance(0.3) ? R() * 3 : 0), z);
    const lean = R.chance(0.18);
    eu.set(lean ? R.range(-0.12, 0.12) : 0, R.range(-0.15, 0.15), lean ? side * R.range(0.05, 0.2) : 0);
    c.setHSL(0.06 + R() * 0.04, 0.1 + R() * 0.08, 0.2 + R() * 0.14);
  }, concrete);
  // rubble, slabs and wrecks on the street
  ruins(90, (i, p, s, eu, c) => {
    const slab = R.chance(0.4);
    s.set(slab ? R.range(2, 6) : R.range(0.4, 2), slab ? R.range(0.25, 0.6) : R.range(0.3, 1.6), slab ? R.range(1.5, 4) : R.range(0.4, 2));
    p.set(R.range(-14, 14), s.y / 2 - 0.1, 4 - R() * 150);
    if (Math.abs(p.x) < 3.5 && p.z > -9) p.x += p.x < 0 ? -4 : 4;      // keep the space around the raider clear
    eu.set(R.range(-0.3, 0.3), R() * Math.PI, R.range(-0.3, 0.3));
    c.setHSL(0.06, 0.08, 0.16 + R() * 0.14);
  }, concrete);
  // the far skyline, only a silhouette in the haze
  ruins(70, (i, p, s, eu, c) => {
    const a = (i / 70) * Math.PI * 2, d = 170 + R() * 120;
    s.set(R.range(8, 22), R.range(10, 60), R.range(8, 22));
    p.set(Math.cos(a) * d, s.y / 2 - 2, Math.sin(a) * d);
    eu.set(0, R() * Math.PI, R.chance(0.2) ? R.range(-0.15, 0.15) : 0);
    c.setHSL(0.75, 0.15, 0.1);
  }, new THREE.MeshBasicMaterial({ fog: true }));

  // ---------- the drop pod on the horizon: a black crystal pyramid with a beam into the sky ----------
  const pod = new THREE.Group();
  {
    const geo = new THREE.ConeGeometry(16, 30, 4);
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x150c22, roughness: 0.25, metalness: 0.6, flatShading: true }));
    body.position.y = 15; body.rotation.y = Math.PI / 4;
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xb98aff, fog: false })));
    pod.add(body);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 260, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    beam.position.y = 160;
    pod.add(beam);
    const top = glow(tex, 0xc49bff, 30, 0.9); top.position.y = 30; pod.add(top);
    const base = glow(tex, 0xa36bff, 70, 0.5); base.position.y = 3; pod.add(base);
    pod.userData = { beam, top };
  }
  pod.position.set(-26, 0, -150);
  scene.add(pod);
  const sunGlow = glow(tex, 0xff8a5a, 160, 0.5);
  sunGlow.position.set(40, 6, -300);
  scene.add(sunGlow);

  // ---------- distant Prism patrols: glints drifting over the ruins ----------
  const drones = [];
  for (let i = 0; i < 7; i++) {
    const s = glow(tex, i % 3 ? 0xa36bff : 0xffffff, R.range(1.2, 2.4), 0.9);
    s.userData = { x: R.range(-40, 40), y: R.range(10, 28), z: R.range(-140, -40), r: R.range(6, 22), sp: R.range(0.05, 0.16) * (R.chance(0.5) ? 1 : -1), ph: R() * 6.28 };
    scene.add(s); drones.push(s);
  }

  // ---------- your raider, centre stage, lit warm from the front ----------
  const shadowTex = glowTexture(64, true);
  const raider = new Raider({ shadows: false });
  raider.setGear({ weapon1: 'carbine', weapon2: 'pistol', melee: 'crowbar' });    // the starting kit, holstered
  raider.root.position.set(0, 0, RZ);
  raider.root.rotation.y = -0.22;
  scene.add(raider.root);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex, transparent: true, opacity: 0.7, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.set(0, 0.012, RZ); contact.renderOrder = -1;
  scene.add(contact);
  const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
  key.position.set(-2.5, 3.5, RZ + 5);
  key.target = raider.root;
  scene.add(key);
  const rim = new THREE.PointLight(0xa36bff, 5, 6, 1.5);
  rim.position.set(1.3, 2.2, RZ - 1.4);
  scene.add(rim);

  // ---------- the Fink, behind your raider ----------
  const fink = makeFink(tex);
  fink.scale.setScalar(0.8);
  scene.add(fink);
  const scanRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xc49bff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  scanRing.rotation.x = -Math.PI / 2;
  scene.add(scanRing);

  // ---------- dust in the wind ----------
  const DN = 500, dp = new Float32Array(DN * 3);
  for (let i = 0; i < DN; i++) { dp[i * 3] = R.range(-30, 30); dp[i * 3 + 1] = R.range(0, 14); dp[i * 3 + 2] = R.range(-60, 10); }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd9b9a0, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(dust);

  const ws = buildWorkshop(scene);
  let mode = 'lobby', station = 'chicken';
  const wsLook = new THREE.Vector3(WX, 1.1, WZ - 3), wsWant = new THREE.Vector3();
  const offs = [];
  let t = 0, mx = 0, my = 0, cx = 0, cy = 0, look = 0;
  const onMove = e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
  const tmp = new THREE.Vector3();

  return {
    scene, camera,
    enter(params = {}) {
      addEventListener('pointermove', onMove);
      document.body.dataset.mode = 'menu';
      offs.push(
        bus.on('lobby:tab', id => { mode = id === 'workshop' ? 'workshop' : 'lobby'; }),
        bus.on('lobby:station', id => { station = id; }),
        bus.on('lobby:built', () => ws.refresh()),
      );
      UI.reset('main');
      if (params.raid) showRaidSummary(params.raid, UI);    // back from a raid: what you brought out, what you lost
    },
    exit() {
      removeEventListener('pointermove', onMove);
      for (const off of offs) off();
      offs.length = 0;
      disposeTree(scene);
      tex.dispose(); shadowTex.dispose();
    },
    frame(dt) {
      t += dt;
      // your raider breathes, shifts their weight and glances towards the mouse now and then
      raider.root.rotation.y = -0.22 + Math.sin(t * 0.23) * 0.05;
      look = damp(look, mx * 0.9 + Math.sin(t * 0.31) * 0.15, 2, dt);
      raider.update(dt, { mode: 'move', speed: 0, grounded: true, idle: true, lookYaw: look + 0.18, lookPitch: -my * 0.35 + Math.sin(t * 0.5) * 0.05 });

      // the Fink bobs, turns, and sweeps the street behind them
      fink.position.set(1.8, 2.4 + Math.sin(t * 0.9) * 0.16, RZ - 4.2);
      fink.rotation.y = Math.sin(t * 0.25) * 0.6;
      fink.rotation.z = Math.sin(t * 0.6) * 0.05;
      const u = fink.userData, f = 0.85 + Math.sin(t * 31) * 0.08 + Math.sin(t * 17) * 0.07;
      u.flame.scale.set(1, f, 1);
      u.halo.scale.setScalar(1.6 * f);
      u.light.intensity = 6 * f;
      const sweep = Math.sin(t * 0.55) * 0.75;
      u.pivot.rotation.set(0.55 + Math.sin(t * 0.37) * 0.12, -fink.rotation.y + sweep, 0, 'YXZ');
      u.beam.material.opacity = 0.06 + Math.max(0, Math.sin(t * 2.3)) * 0.04;
      // where the beam hits the ground
      tmp.set(0, -9, 0).applyEuler(u.pivot.rotation).add(fink.position);
      const k = fink.position.y / Math.max(0.01, fink.position.y - tmp.y);
      scanRing.position.set(fink.position.x + (tmp.x - fink.position.x) * k, 0.03, fink.position.z + (tmp.z - fink.position.z) * k);
      const pulse = (t * 0.9) % 1;
      scanRing.scale.setScalar(0.6 + pulse * 2.6);
      scanRing.material.opacity = 0.55 * (1 - pulse);

      pod.userData.beam.material.opacity = 0.16 + Math.sin(t * 1.7) * 0.05;
      pod.userData.top.material.opacity = 0.7 + Math.sin(t * 3.1) * 0.2;
      for (const d of drones) {
        const v = d.userData, a = v.ph + t * v.sp;
        d.position.set(v.x + Math.cos(a) * v.r, v.y + Math.sin(t * 0.7 + v.ph) * 1.2, v.z + Math.sin(a) * v.r);
        d.material.opacity = 0.6 + Math.sin(t * 5 + v.ph) * 0.3;
      }
      dust.position.x = ((t * 1.4) % 20) - 10;
      dust.position.y = Math.sin(t * 0.3) * 0.4;

      // Pip wanders round the pen and pecks at the straw
      const ha = t * 0.35, hp = ws.home;
      ws.hen.position.set(hp.x + Math.cos(ha) * 0.45 - WX, 0.28, hp.z + Math.sin(ha) * 0.35 - WZ);
      ws.hen.rotation.y = -ha + Math.PI;
      ws.hen.userData.head.rotation.x = Math.max(0, Math.sin(t * 2.6)) ** 6 * 1.1;

      cx = damp(cx, mx, 2.5, dt); cy = damp(cy, my, 2.5, dt);
      if (mode === 'workshop') {
        // in the workshop: the room from near the door, turning towards the station you picked
        const b = ws.benches[station];
        wsWant.copy(b ? b.at : new THREE.Vector3(WX - 6.2, 0.6, WZ + 2.2));
        wsLook.x = damp(wsLook.x, wsWant.x, 3, dt); wsLook.y = damp(wsLook.y, wsWant.y, 3, dt); wsLook.z = damp(wsLook.z, wsWant.z, 3, dt);
        camera.position.set(WX - 1.5 + cx * 0.4, 2.4 - cy * 0.2, WZ + 5.2);
        camera.lookAt(wsLook);
        return;
      }
      // the camera frames the raider head to boots, and drifts a little with the mouse
      camera.position.set(cx * 0.35, 1.05 - cy * 0.12 + Math.sin(t * 0.2) * 0.02, RZ + 3.5);
      camera.lookAt(cx * 0.1, 0.98, RZ);
    },
    resize(w, h) { fitCamera(camera, w, h); },
  };
}
