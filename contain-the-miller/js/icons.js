// Renders 3D item icons once at startup so the HUD shows the real models.
import * as THREE from 'three';
import { makeTemplate, templateToObject } from './assets.js';

export function renderIcons(game) {
  const A = game.assets;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(128, 128);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(2, 3, 4); scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

  const shoot = (obj, view = [1, 0.7, 1.4], tilt = 0) => {
    const g = new THREE.Group(); g.add(obj); g.rotation.z = tilt; scene.add(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g, true);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const rad = s.length() / 2;
    cam.position.copy(c).add(new THREE.Vector3(...view).normalize().multiplyScalar(rad / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05));
    cam.lookAt(c);
    r.render(scene, cam);
    scene.remove(g);
    return r.domElement.toDataURL('image/png');
  };

  const icons = {};
  icons.stone_axe = shoot(templateToObject(makeTemplate(A.models.stone_axe.scene, { height: 1 })), [0, 0.2, 1], 0.6);
  icons.canteen = shoot(templateToObject(makeTemplate(A.models.canteen.scene, { height: 1 })), [0.6, 0.3, 1]);
  icons.torch = shoot(game.viewmodel.makeTorch(), [1, 0.4, 1], -0.5);
  const f = game.world.pickupFactory;
  icons.banana = shoot(f.banana(), [0.3, 1, 0.8]);
  icons.mango = shoot(f.mango(), [0.5, 0.6, 1]);
  icons.berries = shoot(f.berries(), [0.4, 0.8, 1]);

  // resources
  const bamboo = new THREE.Group();
  const bm = new THREE.MeshStandardMaterial({ color: 0xa9b35c, roughness: 0.5 });
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 10), bm); c.position.x = (i - 1) * 0.13; c.rotation.z = 0.15 * (i - 1); bamboo.add(c); }
  icons.bamboo = shoot(bamboo, [0.4, 0.3, 1], 0.8);
  const wood = new THREE.Group();
  const wm = new THREE.MeshStandardMaterial({ map: A.tex('bark_brown_02', 'color'), roughness: 0.9 });
  const endm = new THREE.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.8 });
  for (const [x, y] of [[-0.13, 0], [0.13, 0], [0, 0.21]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 12), [wm, endm, endm]); c.rotation.z = Math.PI / 2; c.position.set(0, y, x); wood.add(c); }
  icons.wood = shoot(wood, [0.8, 0.4, 1]);
  icons.stone = shoot(templateToObject(makeTemplate(A.models.rock_b.scene, { height: 1 })), [1, 0.8, 1]);
  icons.fiber = shoot(templateToObject(makeTemplate(A.models.fern.scene, { height: 1 })), [0.2, 1, 0.7]);
  r.dispose();
  r.forceContextLoss();
  return icons;
}
