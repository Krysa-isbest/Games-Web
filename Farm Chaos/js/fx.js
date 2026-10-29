// fx.js — particles, precipitation, building gibs, explosions, flashes, screen shake
'use strict';

class PSystem {
  constructor(n, additive) {
    this.n = n; this.i = 0;
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.C = new Float32Array(n * 3);
    this.S = new Float32Array(n); this.A = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.grow = new Float32Array(n); this.s0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.C, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.S, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.A, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { scale: { value: innerHeight * 0.6 } }, transparent: true, depthWrite: false, vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.15, d)); }`,
    });
    this.pts = new THREE.Points(g, m); this.pts.frustumCulled = false;
    W.scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, life, size, hex, o = {}) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    const k = i * 3; this.P[k] = x; this.P[k + 1] = y; this.P[k + 2] = z; this.V[k] = vx; this.V[k + 1] = vy; this.V[k + 2] = vz;
    _fc.setHex(hex); this.C[k] = _fc.r; this.C[k + 1] = _fc.g; this.C[k + 2] = _fc.b;
    this.life[i] = life; this.max[i] = life; this.s0[i] = size; this.S[i] = size; this.A[i] = o.a !== undefined ? o.a : 1;
    this.grav[i] = o.g || 0; this.drag[i] = o.drag || 0; this.grow[i] = o.grow || 0;
  }
  update(dt) {
    const wx = FX.wind.x, wz = FX.wind.z;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.A[i] !== 0) { this.A[i] = 0; } continue; }
      this.life[i] -= dt; const k = i * 3, dr = Math.max(0, 1 - this.drag[i] * dt);
      this.V[k] = this.V[k] * dr + wx * this.drag[i] * dt * 0.5; this.V[k + 1] = this.V[k + 1] * dr - this.grav[i] * dt; this.V[k + 2] = this.V[k + 2] * dr + wz * this.drag[i] * dt * 0.5;
      for (const a of FX.attractors) { const dx = a.x - this.P[k], dy = a.y - this.P[k + 1], dz = a.z - this.P[k + 2], d2 = dx * dx + dy * dy + dz * dz + 4, f = a.s * 2 * dt / d2 * 30; this.V[k] += dx * f; this.V[k + 1] += dy * f; this.V[k + 2] += dz * f; }
      this.P[k] += this.V[k] * dt; this.P[k + 1] += this.V[k + 1] * dt; this.P[k + 2] += this.V[k + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.S[i] = this.s0[i] * (1 + this.grow[i] * t);
      this.A[i] = (t < 0.1 ? t * 10 : 1) * (1 - t) * (this.life[i] > 0 ? 1 : 0);
    }
    const g = this.pts.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}
const _fc = new THREE.Color();

const FX = {
  wind: new V3(), attractors: [], gibs: [], temps: [], shakeAmt: 0, flashA: 0,
  want: { rain: 0, acid: 0, snow: 0, sand: 0, ash: 0, hail: 0, frogs: 0, fish: 0 },
  init() {
    const n = Math.round(5000 * S.d.particles);
    this.ps = new PSystem(n, false);
    this.pa = new PSystem(Math.round(n * 0.6), true);
    // precipitation lines
    const RN = Math.round(3500 * S.d.particles);
    this.rainN = RN;
    const rg = new THREE.BufferGeometry(); this.rainP = new Float32Array(RN * 6); this.rainSeed = new Float32Array(RN * 3);
    for (let i = 0; i < RN; i++) { this.rainSeed[i * 3] = Math.random() * 50 - 25; this.rainSeed[i * 3 + 1] = Math.random() * 30; this.rainSeed[i * 3 + 2] = Math.random() * 50 - 25; }
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainP, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaac8e8, transparent: true, opacity: 0.55 });
    this.rain = new THREE.LineSegments(rg, this.rainMat); this.rain.frustumCulled = false; W.scene.add(this.rain);
    const sg = new THREE.BufferGeometry(); this.snowP = new Float32Array(RN * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowP, 3).setUsage(THREE.DynamicDrawUsage));
    this.snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false });
    this.snow = new THREE.Points(sg, this.snowMat); this.snow.frustumCulled = false; W.scene.add(this.snow);
    // falling cosmetic objects (hail, frogs, fish)
    this.fallers = {};
    for (const [k, geo, n2] of [['hail', M.hail(), 260], ['frogs', M.frog(), 90], ['fish', M.fish(), 90]]) {
      const im = new THREE.InstancedMesh(geo, M.mat, n2); im.count = 0; im.frustumCulled = false; W.scene.add(im);
      const d = []; for (let i = 0; i < n2; i++) d.push({ x: 0, y: -999, z: 0, vy: 0, r: Math.random() * 6, land: 0 });
      this.fallers[k] = { im, d };
    }
    // decals
    this.decals = [];
    const dg = new THREE.CircleGeometry(1, 14); dg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false; W.scene.add(m); this.decals.push({ m, life: 0 });
    }
    this.light = new THREE.PointLight(0xffa040, 0, 80); W.scene.add(this.light);
    this.flashEl = document.getElementById('flash');
  },
  emit(...a) { this.ps.emit(...a); },
  glow(...a) { this.pa.emit(...a); },
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a * S.d.shake); },
  flash(a, color = '#fff') {
    if (S.d.reduceFlash) a = Math.min(a, 0.25);
    this.flashA = Math.max(this.flashA, a); this.flashEl.style.background = color;
  },
  decal(x, z, r, life = 60) {
    const d = this.decals.reduce((a, b) => a.life < b.life ? a : b);
    d.m.position.set(x, W.height(x, z) + 0.04, z); d.m.scale.setScalar(r); d.m.visible = true; d.life = life; d.max = life;
  },
  // temporary object with a per-frame update; return false from update to remove
  temp(obj, life, update) { if (obj) W.scene.add(obj); this.temps.push({ obj, life, t: 0, update }); },
  explode(x, y, z, size = 1, opt = {}) {
    const n = Math.round(30 * size * S.d.particles);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, u = Math.random() * 2 - 1, s = (3 + Math.random() * 6) * size, r = Math.sqrt(1 - u * u);
      this.glow(x, y + 0.5, z, Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + 2, Math.sin(a) * r * s, 0.5 + Math.random() * 0.5, 1.2 * size, [0xffd060, 0xff8a20, 0xff5010][i % 3], { drag: 2.5, grow: 1.5 });
      this.emit(x, y + 0.5, z, Math.cos(a) * r * s * 0.5, Math.random() * 4 * size + 1, Math.sin(a) * r * s * 0.5, 2 + Math.random() * 2, 1.6 * size, i % 2 ? 0x4a4440 : 0x6a625a, { drag: 1.2, grow: 2.5, g: -0.6 });
      if (i % 2) this.emit(x, y + 0.3, z, Math.cos(a) * s * 0.6, 5 + Math.random() * 6, Math.sin(a) * s * 0.6, 1.4, 0.25, 0x5a4030, { g: 18 });
    }
    this.light.position.set(x, y + 3, z); this.light.intensity = 6 * size; this.light.distance = 40 * size;
    if (!opt.noDecal) this.decal(x, z, 2.2 * size);
    const d = W.camera.position.distanceTo(new V3(x, y, z));
    this.shake(U.clamp(size * 18 / (d + 4), 0, 1.2));
    if (d < 25 * size) this.flash(U.clamp(0.5 * size * (1 - d / (25 * size)), 0, 0.6), '#ffd8a0');
    AU.play(size > 3 ? 'bigboom' : 'explosion', { x, y, z }, Math.min(1.5, 0.6 + size * 0.3));
    // shockwave ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24), new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.3, z);
    this.temp(ring, 0.6, (t) => { ring.scale.setScalar(1 + t * 20 * size); ring.material.opacity = 0.6 * (1 - t / 0.6); });
    // nearby gibs get pushed
    for (const g of this.gibs) { const dx = g.m.position.x - x, dz = g.m.position.z - z, dd = dx * dx + dz * dz; if (dd < 100 * size) { const f = 12 * size / (Math.sqrt(dd) + 1); g.v.x += dx * f * 0.3; g.v.z += dz * f * 0.3; g.v.y += f; } }
  },
  bolt(x, z) {
    const pts = []; let px = x + U.rand(-10, 10), pz = z + U.rand(-10, 10);
    for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new V3(U.lerp(px, x, t) + (i && i < 14 ? U.rand(-2, 2) : 0), 90 * (1 - t) + W.height(x, z), U.lerp(pz, z, t) + (i && i < 14 ? U.rand(-2, 2) : 0))); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf4f0ff }));
    this.temp(line, 0.3, t => { line.visible = Math.floor(t * 30) % 3 !== 1; });
    this.light.position.set(x, 10, z); this.light.intensity = 8; this.light.distance = 120; this.light.color.setHex(0xc0d0ff);
    this.flash(0.35, '#e8eeff');
    for (let i = 0; i < 20; i++) this.glow(x, 0.5, z, U.rand(-6, 6), U.rand(2, 9), U.rand(-6, 6), 0.4, 0.4, 0xd0e0ff, { g: 10 });
    this.decal(x, z, 1.4, 40);
  },
  // a building piece breaks: the piece tumbles away and splinters into chunks
  gibPiece(p, ox, oy, oz, force) {
    p.mesh.updateMatrixWorld();
    const m = new THREE.Mesh(p.mesh.geometry, M.mat);
    p.mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    m.castShadow = true;
    // geometry is in building space -> move pivot to the piece center
    const c = p.center.clone();
    const geoCenter = p.mesh.geometry.boundingSphere.center.clone().applyMatrix4(p.mesh.matrixWorld);
    const piv = new THREE.Group(); piv.position.copy(geoCenter); W.scene.add(piv);
    m.position.sub(geoCenter); piv.add(m);
    const dir = new V3(c.x - ox, c.y - oy, c.z - oz); const dl = dir.length() || 1; dir.multiplyScalar(1 / dl);
    const f = force * (0.6 + Math.random() * 0.6);
    this.addGib(piv, new V3(dir.x * f, Math.abs(dir.y * f) * 0.6 + Math.abs(f) * 0.5 + 2, dir.z * f), p.mesh.geometry.boundingSphere.radius * 0.25);
    const sz = p.box.getSize(new V3());
    const nch = Math.min(5, 2 + Math.floor((sz.x + sz.y + sz.z) / 4));
    for (let i = 0; i < nch; i++) {
      const b = new MB(); b.box(U.rand(0.2, 0.7), U.rand(0.1, 0.4), U.rand(0.3, 1.1), p.color, 0, 0, 0);
      const cm = b.mesh(); cm.position.set(c.x + U.rand(-sz.x, sz.x) * 0.4, c.y + U.rand(-sz.y, sz.y) * 0.4, c.z + U.rand(-sz.z, sz.z) * 0.4);
      W.scene.add(cm);
      this.addGib(cm, new V3(dir.x * f + U.rand(-4, 4), Math.abs(f) * 0.6 + U.rand(2, 8), dir.z * f + U.rand(-4, 4)), 0.2);
    }
    for (let i = 0; i < 12 * S.d.particles; i++) this.emit(c.x, c.y, c.z, U.rand(-3, 3), U.rand(0, 4), U.rand(-3, 3), 1.5, 1.2, 0x9a8a78, { drag: 1.5, grow: 2 });
  },
  addGib(obj, v, hr) {
    this.gibs.push({ m: obj, v, w: new V3(U.rand(-4, 4), U.rand(-4, 4), U.rand(-4, 4)), hr, life: 28 });
    while (this.gibs.length > 240) { const g = this.gibs.shift(); W.scene.remove(g.m); }
  },
  // generic flying debris that is not from a building (crops, animals in cutscenes)
  chunk(x, y, z, hex, v, size = 0.3) {
    const b = new MB(); b.box(size, size, size, hex, 0, 0, 0); const m = b.mesh(); m.position.set(x, y, z); W.scene.add(m);
    this.addGib(m, v, size / 2);
  },
  update(dt) {
    const grav = 22 * (W.env.gravity || 1);
    this.ps.update(dt); this.pa.update(dt);
    // gibs
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i], p = g.m.position;
      g.life -= dt;
      g.v.y -= grav * dt;
      g.v.x += this.wind.x * dt * 0.4; g.v.z += this.wind.z * dt * 0.4;
      for (const a of this.attractors) { const dx = a.x - p.x, dy = a.y - p.y, dz = a.z - p.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.5; const f = a.s * dt * 40 / (d * d + 10); g.v.x += dx * f; g.v.y += dy * f + grav * dt * Math.min(1, a.s / 30); g.v.z += dz * f; if (d < (a.kill || 2)) g.life = Math.min(g.life, 0.01); }
      p.addScaledVector(g.v, dt);
      g.m.rotation.x += g.w.x * dt; g.m.rotation.y += g.w.y * dt; g.m.rotation.z += g.w.z * dt;
      const gy = W.height(p.x, p.z) + g.hr;
      if (p.y < gy) { p.y = gy; if (g.v.y < 0) g.v.y *= -0.3; g.v.x *= 0.75; g.v.z *= 0.75; g.w.multiplyScalar(0.7); }
      if (g.life < 2) p.y -= dt * 0.5;
      if (g.life <= 0) { W.scene.remove(g.m); this.gibs.splice(i, 1); }
    }
    for (let i = this.temps.length - 1; i >= 0; i--) {
      const t = this.temps[i]; t.t += dt;
      const keep = t.update ? t.update(t.t, dt) : true;
      if (t.t >= t.life || keep === false) { if (t.obj) { W.scene.remove(t.obj); t.obj.traverse(o => { if (o.geometry && !o.userData.keepGeo) o.geometry.dispose(); }); } this.temps.splice(i, 1); }
    }
    for (const d of this.decals) if (d.life > 0) { d.life -= dt; d.m.material.opacity = Math.min(0.75, d.life / d.max * 2); if (d.life <= 0) d.m.visible = false; }
    this.light.intensity *= Math.exp(-dt * 6);
    if (this.light.intensity < 0.05) this.light.color.setHex(0xffa040);
    this.flashA *= Math.exp(-dt * (S.d.reduceFlash ? 2 : 3.5));
    this.flashEl.style.opacity = this.flashA.toFixed(3);
    this.shakeAmt *= Math.exp(-dt * 4);
    this.updatePrecip(dt);
  },
  updatePrecip(dt) {
    const w = this.want, cam = W.camera.position;
    const rainAmt = Math.max(w.rain, w.acid);
    this.rainMat.color.setHex(w.acid > w.rain ? 0x9cff4a : 0xaac8e8);
    const nR = Math.floor(this.rainN * U.clamp(rainAmt, 0, 1));
    const P = this.rainP, Sd = this.rainSeed, wx = this.wind.x * 0.05, wz = this.wind.z * 0.05, sp = 28;
    const t = W.timeUniform.value;
    for (let i = 0; i < this.rainN; i++) {
      const k = i * 6;
      if (i >= nR) { P[k + 1] = -999; P[k + 4] = -999; continue; }
      let y = (Sd[i * 3 + 1] - t * sp) % 30; if (y < 0) y += 30;
      const x = cam.x + ((Sd[i * 3] - cam.x + t * this.wind.x * 0.6) % 50 + 75) % 50 - 25, z = cam.z + ((Sd[i * 3 + 2] - cam.z + t * this.wind.z * 0.6) % 50 + 75) % 50 - 25;
      const yy = cam.y - 8 + y;
      P[k] = x; P[k + 1] = yy; P[k + 2] = z; P[k + 3] = x - wx * 0.6; P[k + 4] = yy + 0.7; P[k + 5] = z - wz * 0.6;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.visible = nR > 0;
    if (rainAmt > 0.05) AU.loop('rain', rainAmt * 0.5);
    // snow / sand / ash share the points system
    const pType = w.snow >= w.sand && w.snow >= w.ash ? 'snow' : w.sand >= w.ash ? 'sand' : 'ash';
    const pAmt = Math.max(w.snow, w.sand, w.ash);
    this.snowMat.color.setHex(pType === 'snow' ? 0xffffff : pType === 'sand' ? 0xc9a46a : 0x555050);
    this.snowMat.size = pType === 'snow' ? 0.14 : 0.09;
    const nS = Math.floor(this.rainN * U.clamp(pAmt, 0, 1)), SP = this.snowP, fall = pType === 'snow' ? 2.5 : pType === 'ash' ? 1.5 : 0.5, ws = pType === 'sand' ? 2.5 : 1;
    for (let i = 0; i < this.rainN; i++) {
      const k = i * 3;
      if (i >= nS) { SP[k + 1] = -999; continue; }
      let y = (Sd[k + 1] - t * fall) % 30; if (y < 0) y += 30;
      const sx = Math.sin(t * 0.7 + i) * 0.6;
      SP[k] = cam.x + ((Sd[k] - cam.x + t * this.wind.x * ws + sx) % 50 + 75) % 50 - 25;
      SP[k + 1] = cam.y - 8 + y;
      SP[k + 2] = cam.z + ((Sd[k + 2] - cam.z + t * this.wind.z * ws) % 50 + 75) % 50 - 25;
    }
    this.snow.geometry.attributes.position.needsUpdate = true; this.snow.visible = nS > 0;
    // cosmetic fallers around the camera
    for (const k in this.fallers) {
      const F = this.fallers[k], amt = w[k] || 0, want = Math.floor(F.d.length * U.clamp(amt, 0, 1));
      let n = 0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(1, 1, 1);
      F.d.forEach((d, i) => {
        if (d.y < -500 && i < want) { d.x = cam.x + U.rand(-30, 30); d.z = cam.z + U.rand(-30, 30); d.y = cam.y + U.rand(15, 40); d.vy = -U.rand(8, 16); d.land = 0; }
        if (d.y < -500) return;
        const gy = W.height(d.x, d.z);
        if (d.land > 0) { d.land -= dt; if (k !== 'hail' && Math.random() < dt * 2) { d.vy = 4; d.x += U.rand(-0.5, 0.5); d.z += U.rand(-0.5, 0.5); } if (d.land <= 0) { d.y = -999; return; } }
        d.vy -= 22 * dt; d.y += d.vy * dt;
        if (d.y < gy) { d.y = gy; if (d.vy < -3) { d.vy = k === 'hail' ? -d.vy * 0.3 : 0; if (!d.land) d.land = k === 'hail' ? 2 : 6; if (k !== 'hail' && Math.random() < 0.06) AU.play(k === 'frogs' ? 'croak' : 'splash', d, 0.3); } else d.vy = 0; }
        m.compose(new V3(d.x, d.y, d.z), q.setFromEuler(new THREE.Euler(0, d.r + (k === 'fish' && d.land > 0 ? Math.sin(t * 20 + i) * 0.5 : 0), k === 'fish' && d.land > 0 ? Math.PI / 2 : 0)), sc);
        F.im.setMatrixAt(n++, m);
      });
      F.im.count = n; F.im.instanceMatrix.needsUpdate = true;
    }
    for (const k in w) w[k] = 0;
  },
};
