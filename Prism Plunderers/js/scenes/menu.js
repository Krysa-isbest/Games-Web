// The scene behind the main menu: dusk over the dead city. A Fink hovers close to the camera and sweeps the
// street with its scan beam, a Prism drop pod glows on the horizon and more Prism drift over the ruins.
import * as THREE from 'three';
import { Engine, disposeTree, fitCamera } from '../core/engine.js';
import { UI } from '../ui/screens.js';
import { rng, damp } from '../core/util.js';

// a soft round glow, made from numbers so it needs no canvas
function glowTexture(size = 64) {
  const d = new Uint8Array(size * size * 4), h = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h, a = Math.max(0, 1 - r);
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * a * a * a);
  }
  const t = new THREE.DataTexture(d, size, size);
  t.needsUpdate = true;
  return t;
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
        float s = pow(max(0.0, 1.0 - abs(h - 0.01) * 9.0), 3.0) * smoothstep(0.2, -1.0, vP.z) ;
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

  // ---------- the Fink ----------
  const fink = makeFink(tex);
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

  let t = 0, mx = 0, my = 0, cx = 0, cy = 0, shift = 2.4;
  const onMove = e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
  const tmp = new THREE.Vector3();

  return {
    scene, camera,
    enter() {
      addEventListener('pointermove', onMove);
      document.body.dataset.mode = 'menu';
      UI.reset('main');
    },
    exit() {
      removeEventListener('pointermove', onMove);
      disposeTree(scene);
      tex.dispose();
    },
    frame(dt) {
      t += dt;
      // the Fink bobs, turns, and sweeps the street
      fink.position.set(shift, 3.1 + Math.sin(t * 0.9) * 0.16, 1.5);
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

      cx = damp(cx, mx, 2.5, dt); cy = damp(cy, my, 2.5, dt);
      camera.position.set(cx * 1.4, 2.2 - cy * 0.6 + Math.sin(t * 0.2) * 0.08, 10.5);
      camera.lookAt(shift * 0.35 + cx * 0.5, 3.4, -20);
    },
    resize(w, h) {
      fitCamera(camera, w, h);
      shift = w / h > 1.25 ? 2.6 : 0;          // beside the menu on a wide window, centred on a narrow one
    },
  };
}
