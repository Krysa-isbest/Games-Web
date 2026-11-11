// The scene behind the main menu: a Fink hovering in the dark. Prototype white, thruster at the bottom.
import * as THREE from 'three';
import { Engine, disposeTree, fitCamera } from '../core/engine.js';
import { UI } from '../ui/screens.js';
import { rng, damp } from '../core/util.js';

// A stand-in built from the Fink concept sheet. The enemies part replaces it with the real unit.
function makeFink() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf1eef8, roughness: 0.42, metalness: 0.08, flatShading: true });
  const ink = new THREE.LineBasicMaterial({ color: 0x1a1426 });
  const part = (geo, y, mat = white) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    if (mat === white) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), ink));
    g.add(m);
    return m;
  };
  part(new THREE.ConeGeometry(0.8, 1.7, 6), 0.85);                       // the spire
  part(new THREE.CylinderGeometry(0.8, 0.44, 0.5, 6), -0.25);            // the lower body
  part(new THREE.CylinderGeometry(0.44, 0.32, 0.13, 6), -0.565);         // collar
  part(new THREE.CylinderGeometry(0.27, 0.2, 0.11, 6), -0.685);          // thruster housing
  const flame = part(new THREE.ConeGeometry(0.15, 0.5, 6), -0.99, new THREE.MeshBasicMaterial({ color: 0xe6dcff }));
  flame.rotation.x = Math.PI;                                            // the thruster flame points down
  const glow = new THREE.PointLight(0xa36bff, 9, 7, 1.6);
  glow.position.y = -1.15;
  g.add(glow);
  g.userData = { flame, glow };
  return g;
}

export default function createMenu() {
  const scene = new THREE.Scene();
  const BG = 0x0c0816;
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 7, 26);
  const camera = new THREE.PerspectiveCamera(38, Engine.w / Engine.h, 0.1, 80);

  scene.add(new THREE.HemisphereLight(0xb7a4ff, 0x140c24, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8a4dff, 2.4);
  rim.position.set(4, 1, -5);
  scene.add(rim);

  const fink = makeFink();
  scene.add(fink);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ color: 0x191226, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.2;
  scene.add(floor);
  // the alert rings from the concept sheet, spreading on the ground
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = -2.18;
    m.userData.t = i / 3;
    scene.add(m); rings.push(m);
  }
  // dust
  const R = rng(3000), N = 220, pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pts[i * 3] = R.range(-9, 9); pts[i * 3 + 1] = R.range(-2.2, 5); pts[i * 3 + 2] = R.range(-10, 4); }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xb9a0ff, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(dust);

  let t = 0, mx = 0, my = 0, cx = 0, cy = 0, shift = 1.7;
  const onMove = e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };

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
    },
    frame(dt) {
      t += dt;
      fink.position.set(shift, Math.sin(t * 0.9) * 0.14, 0);
      fink.rotation.y = t * 0.35;
      fink.rotation.z = Math.sin(t * 0.6) * 0.05;
      const f = 0.85 + Math.sin(t * 31) * 0.08 + Math.sin(t * 17) * 0.07;
      fink.userData.flame.scale.set(1, f, 1);
      fink.userData.glow.intensity = 9 * f;
      for (const r of rings) {
        const k = (r.userData.t + t * 0.16) % 1;
        r.position.x = shift;
        r.scale.setScalar(0.6 + k * 6);
        r.material.opacity = 0.34 * (1 - k) * Math.min(1, k * 8);
      }
      dust.rotation.y = t * 0.012;
      cx = damp(cx, mx, 3, dt); cy = damp(cy, my, 3, dt);
      camera.position.set(cx * 0.9, 0.35 - cy * 0.5, 7.2);
      camera.lookAt(shift * 0.45, 0, 0);
    },
    resize(w, h) {
      fitCamera(camera, w, h);
      shift = w / h > 1.25 ? 1.7 : 0;          // beside the menu on a wide window, centred on a narrow one
    },
  };
}
