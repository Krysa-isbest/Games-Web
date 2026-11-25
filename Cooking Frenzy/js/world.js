'use strict';
// Renderer, lights, the kitchen (static geometry + colliders + station parts + logic zones), dining room and particles.
// Kitchen interior: x -7..7, z -5..5. North = stove line, West = prep + sink, East = serving pass, South = back door + shop.
CF.World = (() => {
    const W = {};
    const CH = W.CH = 0.92;          // counter height
    const D = 0.65;                  // counter depth
    W.colliders = [];                // {min:[x,y,z], max:[x,y,z], id?, floor?}
    W.pickables = [];                // meshes the crosshair can target
    W.stationParts = {};             // sid -> { part: mesh }
    W.zones = {};
    let scene, camera, renderer, hemi, sun, envTex = null;
    const fireLights = [];
    // every light with its normal intensity; blackout dims them (emergency light comes on instead)
    const RIG = [];
    const lamps = [];            // pendant lights: { light, level } (level 1 = 'on', 2 = only on 'all')
    const aoMeshes = [];         // fake ambient-occlusion decals (the "Ambient shading" setting)
    const glowMats = [];         // materials with a faint bounce-light glow (dimmed in a blackout)
    let emergency = null, lampsShown = null, fireShown = null, reflectShown = null, anisoShown = null, blackout = false;
    W.fxScale = 1;               // particle amount (the "Particles" setting)
    // colours are written as sRGB hex; three r128 would use them as linear (washed out), so convert them
    const lin = c => new THREE.Color(c).convertSRGBToLinear();
    const BASE_EXPOSURE = 0.95;
    const SHADOW_SIZE = { off: 0, low: 1024, medium: 2048, high: 4096, ultra: 4096 };
    const HEMI = 0.17, HEMI_NO_ENV = 0.34;      // without reflections the environment's soft fill is gone, the sky light makes up for it

    W.init = (canvas) => {
        renderer = W.renderer = new THREE.WebGLRenderer({ canvas, antialias: CF.settings.aa !== false, powerPreference: 'high-performance' });
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene = W.scene = new THREE.Scene();
        scene.background = lin(0x0d1117);
        camera = W.camera = new THREE.PerspectiveCamera(CF.settings.fov, innerWidth / innerHeight, 0.04, 80);
        camera.position.set(0, 1.7, 2);
        scene.add(camera);

        buildEnvironment();
        buildLights();
        buildKitchen();
        buildDining();
        buildFx();
        W.applyGraphics();
        addEventListener('resize', () => {
            camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
            renderer.setSize(innerWidth, innerHeight);
        });
    };

    // apply the graphics settings. Safe to call any time; only what changed is rebuilt.
    W.applyGraphics = () => {
        const s = CF.settings;
        renderer.setPixelRatio(Math.min(2.5, (window.devicePixelRatio || 1) * (s.scale || 1)));
        renderer.setSize(innerWidth, innerHeight);
        renderer.toneMappingExposure = BASE_EXPOSURE * (s.bright || 1);
        let rebuild = false;
        // shadows: resolution + hard / soft edges
        const size = SHADOW_SIZE[s.shadowQ] === undefined ? 2048 : SHADOW_SIZE[s.shadowQ];
        if (renderer.shadowMap.enabled !== size > 0) { renderer.shadowMap.enabled = size > 0; rebuild = true; }
        const type = s.soft !== false ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        if (size && renderer.shadowMap.type !== type) { renderer.shadowMap.type = type; rebuild = true; }
        if (size && sun.shadow.mapSize.x !== size) {
            sun.shadow.mapSize.set(size, size);
            if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
        }
        // lamp lights and fire light: changing how many lights there are recompiles the shaders, so only when it changes
        const level = s.lights === 'all' ? 2 : s.lights === 'off' ? 0 : 1;
        if (level !== lampsShown) {
            lampsShown = level;
            for (const L of lamps) { if (L.level <= level) scene.add(L.light); else scene.remove(L.light); }
            rebuild = true;
        }
        const fire = s.fireLights !== false;
        if (fire !== fireShown) {
            fireShown = fire;
            for (const l of fireLights) { if (fire) scene.add(l); else scene.remove(l); }
            rebuild = true;
        }
        // reflections: the room environment map (off = cheaper, the sky light fills in)
        const refl = s.reflect || 'high';
        if (refl !== reflectShown) {
            const hadEnv = reflectShown !== 'off' && reflectShown !== null;
            reflectShown = refl;
            scene.environment = refl === 'off' ? null : envTex;
            const k = refl === 'low' ? 0.55 : 1;
            scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if ('envMapIntensity' in m) m.envMapIntensity = k; }); });
            CF.Models.envIntensity = k;
            const hr = RIG.find(r => r.light === hemi);
            hr.base = refl === 'off' ? HEMI_NO_ENV : HEMI;
            hemi.intensity = hr.base * (blackout ? hr.k : 1);
            if (hadEnv !== (refl !== 'off')) rebuild = true;
        }
        // fake ambient occlusion along walls and counters
        for (const m of aoMeshes) m.visible = s.ao !== false;
        // texture filtering (sharper floors and walls at an angle)
        const aniso = Math.min(+s.aniso || 4, renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4);
        if (aniso !== anisoShown) {
            anisoShown = aniso;
            const seen = new Set();
            scene.traverse(o => {
                if (!o.material) return;
                for (const m of [].concat(o.material)) for (const key of ['map', 'bumpMap', 'roughnessMap', 'emissiveMap', 'normalMap']) {
                    const t = m[key];
                    if (t && !seen.has(t)) { seen.add(t); t.anisotropy = aniso; t.needsUpdate = true; }
                }
            });
        }
        W.fxScale = s.particles === 'low' ? 0.45 : 1;
        if (rebuild) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
    };
    W.setShadows = () => W.applyGraphics();
    W.render = () => renderer.render(scene, camera);

    // Image-based light: a dim kitchen with bright lamps and a ceiling glow, so steel and glaze reflect a believable room
    // and the ambient light stays low enough for real shadows (colours here are linear radiance)
    function buildEnvironment() {
        const env = new THREE.Scene();
        const basic = (r, g, b, side) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: side || THREE.FrontSide });
        env.add(new THREE.Mesh(new THREE.BoxGeometry(16, 3.4, 12), basic(0.1, 0.095, 0.086, THREE.BackSide)));
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), basic(0.09, 0.1, 0.095));
        floor.rotation.x = -Math.PI / 2; floor.position.y = -1.65; env.add(floor);
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), basic(0.42, 0.4, 0.37));
        ceil.rotation.x = Math.PI / 2; ceil.position.y = 1.68; env.add(ceil);
        for (const [x, z] of [[-4, 0], [0, -2], [0, 2.5], [4, 0], [-4, -3], [4, -3]]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), basic(9, 7.4, 5.2));
            b.position.set(x, 1.0, z); env.add(b);
        }
        const pm = new THREE.PMREMGenerator(renderer);
        envTex = pm.fromScene(env, 0.04).texture;
        scene.environment = envTex;
        pm.dispose();
    }

    function rig(light, base, blackoutK) { light.intensity = base; RIG.push({ light, base, k: blackoutK === undefined ? 0.04 : blackoutK }); return light; }
    function buildLights() {
        // sky light: a cool-warm fill, with floor bounce lighting the ceiling a little
        hemi = rig(new THREE.HemisphereLight(lin(0xfff4e8), lin(0x7a6e62), HEMI), HEMI, 0.12);
        scene.add(hemi);
        // the ceiling light panels as one overhead key light that casts all the shadows, at an angle so they read
        sun = rig(new THREE.DirectionalLight(lin(0xfff3e4), 1.55), 1.55, 0.02);
        sun.target.position.set(3.6, 0, 0);
        sun.position.set(3.6 + 5.2, 9.5, 3.4);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const s = sun.shadow.camera;
        s.up.set(0, 0, -1);                  // frustum axes along the floor plan
        s.left = -10.9; s.right = 9.9; s.top = 7.3; s.bottom = -6.6; s.near = 1; s.far = 21;   // fits kitchen + dining (x -7..14.3, z -5..5) seen from the light
        sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.005;
        scene.add(sun); scene.add(sun.target);
        // warm light under the hood on the stove, the pink neon in the dining room
        const hood = rig(new THREE.PointLight(lin(0xfff0d8), 0.55, 3.2, 2), 0.55, 0);
        hood.position.set(-0.75, 2.3, -4.35); scene.add(hood);
        const neon = rig(new THREE.PointLight(lin(0xff3d9a), 0.8, 7, 2), 0.8, 0.8);
        neon.position.set(13.2, 2.2, 0); scene.add(neon);
        emergency = new THREE.PointLight(lin(0xff2a1a), 0, 9, 2);
        emergency.position.set(-5, 2.4, 4.6); scene.add(emergency);
        for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(lin(0xff7a2a), 0, 6, 1.6); l.position.set(0, -50, 0); fireLights.push(l); }
    }
    // pendant lamp light (only in the scene when the Lamp lights setting allows it)
    function lampLight(x, y, z, level, power) {
        const l = rig(new THREE.PointLight(lin(0xffc58a), power || 0.45, 5, 2), power || 0.45);
        l.position.set(x, y, z);
        lamps.push({ light: l, level });
    }
    W.setBlackout = on => {
        blackout = on;
        for (const r of RIG) r.light.intensity = r.base * (on ? r.k : 1);
        emergency.intensity = on ? 0.9 : 0;
        scene.background.copy(lin(on ? 0x030405 : 0x0d1117));
        for (const m of glowMats) m.emissiveIntensity = on ? 0.04 : 1;
    };
    W.setFireLights = list => {
        for (let i = 0; i < fireLights.length; i++) {
            const f = list[i], l = fireLights[i];
            if (!f) { l.intensity = 0; l.position.y = -50; continue; }
            l.position.set(f.x, f.y + 0.4, f.z);
            l.intensity = (1.2 + Math.random() * 0.6) * Math.min(1.5, f.i);
        }
    };

    // ---------- Textures (procedural, see CF.Models.pixTex) ----------
    const tex = CF.Models.canvasTex, PX = CF.Models.pixTex;
    const b255 = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const mixv = (a, b, t) => a + (b - a) * t;
    const rgbOut = (o, r, g, b) => { o[0] = b255(r); o[1] = b255(g); o[2] = b255(b); };
    const grayOut = (o, v) => { o[0] = o[1] = o[2] = b255(v); };
    // kitchen floor: 25 cm diner tiles (8 x 8 per 2 m), dirty grout, every tile slightly different, worn edges
    function floorMaps() {
        const { hash, pfbm } = CF.Models.noise;
        const cell = (u, v) => { const tu = u * 8, tv = v * 8, tx = Math.floor(tu), ty = Math.floor(tv), fu = tu - tx, fv = tv - ty; return [tx, ty, Math.min(fu, 1 - fu, fv, 1 - fv)]; };
        const map = PX('k-floor', 512, 512, (u, v, o) => {
            const [tx, ty, e] = cell(u, v), dark = (tx + ty) % 2 === 0, h = hash(tx, ty, 0, 301);
            let r = dark ? 0.12 : 0.88, g = dark ? 0.36 : 0.85, b = dark ? 0.35 : 0.78;
            const k = (0.94 + 0.09 * h) * (0.93 + 0.1 * pfbm(u, v, 32, 32, 302, 3)) * (0.88 + 0.16 * pfbm(u, v, 3, 3, 303, 3));
            r *= k; g *= k; b *= k;
            if (hash(Math.floor(u * 512), Math.floor(v * 512), 0, 304) > 0.982) { r *= 0.8; g *= 0.8; b *= 0.8; }
            const wear = 0.88 + 0.12 * sm(0.03, 0.1, e);
            r *= wear; g *= wear; b *= wear;
            const t = sm(0.018, 0.028, e);
            rgbOut(o, mixv(0.3, r, t), mixv(0.29, g, t), mixv(0.27, b, t));
        }, { srgb: true, repeat: [7, 5] });
        const bump = PX('k-floorBump', 256, 256, (u, v, o) => grayOut(o, sm(0.016, 0.034, cell(u, v)[2]) * 0.85 + 0.15 * pfbm(u, v, 32, 32, 305, 2)), { repeat: [7, 5] });
        const rough = PX('k-floorRough', 256, 256, (u, v, o) => { const e = cell(u, v)[2]; grayOut(o, mixv(0.92, 0.26 + 0.22 * pfbm(u, v, 6, 6, 306, 3), sm(0.018, 0.028, e))); }, { repeat: [7, 5] });
        return { map, bump, rough };
    }
    // walls: glossy white subway tiles (15 x 7.5 cm, running bond); textures cover 1.2 x 0.6 m with world-space UVs
    function wallMaps() {
        const { hash, pfbm } = CF.Models.noise;
        const cell = (u, v) => {
            const tv = v * 8, row = Math.floor(tv), tu = u * 8 + (row % 2) * 0.5, col = Math.floor(tu);
            const fu = tu - col, fv = tv - row;
            return [col, row, Math.min(fu * 2, (1 - fu) * 2, fv, 1 - fv), fv];
        };
        const map = PX('k-wall', 512, 256, (u, v, o) => {
            const [c, r, e, fv] = cell(u, v), k = (0.95 + 0.05 * hash(((c % 8) + 8) % 8, r, 0, 311)) * (0.97 + 0.04 * pfbm(u, v, 8, 4, 312, 3));
            const t = sm(0.02, 0.042, e), top = 1 + 0.03 * sm(0.75, 0.95, fv);
            rgbOut(o, mixv(0.74, 0.96 * k * top, t), mixv(0.73, 0.96 * k * top, t), mixv(0.7, 0.94 * k * top, t));
        }, { srgb: true });
        const bump = PX('k-wallBump', 256, 128, (u, v, o) => grayOut(o, sm(0.015, 0.08, cell(u, v)[2])));
        const rough = PX('k-wallRough', 256, 128, (u, v, o) => grayOut(o, mixv(0.85, 0.12 + 0.08 * pfbm(u, v, 8, 4, 313, 2), sm(0.02, 0.042, cell(u, v)[2]))));
        return { map, bump, rough };
    }
    // ceiling: 60 cm acoustic panels in a white metal grid (texture covers 1.2 x 1.2 m)
    function ceilingMap() {
        const { pfbm, hash } = CF.Models.noise;
        return PX('k-ceil', 256, 256, (u, v, o) => {
            const fu = (u * 2) % 1, fv = (v * 2) % 1, e = Math.min(fu, 1 - fu, fv, 1 - fv);
            let b = 0.84 + 0.05 * pfbm(u, v, 16, 16, 321, 3);
            if (hash(Math.floor(u * 256), Math.floor(v * 256), 0, 322) > 0.9) b -= 0.06;
            b = mixv(0.97, b, sm(0.018, 0.026, e));
            if (e > 0.026 && e < 0.034) b -= 0.1;
            rgbOut(o, b, b * 0.99, b * 0.96);
        }, { srgb: true, repeat: [14 / 1.2, 10 / 1.2] });
    }
    // brushed steel streaks along x (counter tops, hood) as a roughness map
    function brushedMap() {
        const { noise3 } = CF.Models.noise;
        return PX('k-brushX', 16, 512, (u, v, o) => grayOut(o, 0.24 + 0.22 * (noise3(0, v * 900, 0, 331) * 0.6 + noise3(0, v * 120, 0, 332) * 0.4)));
    }
    // dining room: oak planks 20 cm wide, staggered joints (texture covers 2.4 x 2.4 m)
    function woodFloorMaps() {
        const { hash, pfbm, noise3 } = CF.Models.noise;
        const cell = (u, v) => {
            const tv = v * 12, row = Math.floor(tv), off = hash(row, 0, 0, 341) * 0.5, tu = u * 2 + off, col = Math.floor(tu);
            return [row, ((col % 4) + 4) % 4, tu - col, tv - row];
        };
        const map = PX('k-wood', 512, 512, (u, v, o) => {
            const [row, col, fu, fv] = cell(u, v), h = hash(row, col, 0, 342);
            const k = 0.72 + 0.4 * h, grain = 0.5 + 0.5 * Math.sin((fv * 9 + noise3(u * 6, v * 40, 0, 343) * 3 + h * 7) * Math.PI * 2);
            let r = 0.56 * k * (0.86 + 0.14 * grain), g = 0.35 * k * (0.86 + 0.14 * grain), b = 0.19 * k * (0.88 + 0.12 * grain);
            const s2 = 0.92 + 0.12 * pfbm(u, v, 4, 4, 344, 3);
            r *= s2; g *= s2; b *= s2;
            const gap = sm(0.0, 0.035, Math.min(fv, 1 - fv)) * sm(0.0, 0.006, Math.min(fu, 1 - fu));
            rgbOut(o, mixv(0.09, r, gap), mixv(0.055, g, gap), mixv(0.03, b, gap));
        }, { srgb: true, repeat: [7 / 2.4, 10 / 2.4] });
        const bump = PX('k-woodBump', 256, 256, (u, v, o) => { const [, , fu, fv] = cell(u, v); grayOut(o, sm(0.0, 0.05, Math.min(fv, 1 - fv)) * sm(0.0, 0.008, Math.min(fu, 1 - fu))); }, { repeat: [7 / 2.4, 10 / 2.4] });
        return { map, bump };
    }
    // a soft dark gradient for the fake ambient occlusion along walls and under counters
    function aoTex() {
        return PX('k-ao', 8, 64, (u, v, o) => { o[0] = o[1] = o[2] = 0; o[3] = b255(Math.pow(v, 2.2)); }, { srgb: true });
    }
    function aoBlobTex() {
        return PX('k-aoBlob', 64, 64, (u, v, o) => { const r = Math.hypot(u * 2 - 1, v * 2 - 1); o[0] = o[1] = o[2] = 0; o[3] = b255(Math.pow(Math.max(0, 1 - r), 1.6)); }, { srgb: true });
    }
    function stripeTex() {
        return tex(256, 64, (g, w, h) => {
            g.fillStyle = '#ff6b5b'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#ffd166'; for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 32, h); g.lineTo(x + 16, h); g.fill(); }
        }, [8, 1]);
    }

    // ---------- Building helpers ----------
    const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: 0.7 }, o || {}));
    const basicCol = (color, o) => new THREE.MeshBasicMaterial(Object.assign({ color: lin(color) }, o || {}));
    const MAT = {};
    function mats() {
        MAT.steel = CF.Models.mat.steel();
        const fl = floorMaps(), wl = wallMaps(), brushed = brushedMap();
        MAT.counterTop = std(0xd5dbe0, { metalness: 0.8, roughness: 1, roughnessMap: brushed });
        MAT.cabinet = std(0x2ec4b6, { roughness: 0.5, metalness: 0.15 });
        MAT.cabinetDark = std(0x1f8f86, { roughness: 0.5, metalness: 0.15 });
        MAT.coral = std(0xff6b5b, { roughness: 0.45, metalness: 0.1 });
        MAT.dark = std(0x23272b, { roughness: 0.45, metalness: 0.4 });
        MAT.wall = std(0xffffff, { map: wl.map, bumpMap: wl.bump, bumpScale: 0.006, roughness: 1, roughnessMap: wl.rough });
        MAT.floor = std(0xffffff, { map: fl.map, bumpMap: fl.bump, bumpScale: 0.01, roughness: 1, roughnessMap: fl.rough });
        // the ceiling only gets light bounced off the floor: a faint glow stands in for that bounce
        MAT.ceiling = std(0xffffff, { map: ceilingMap(), roughness: 0.92, emissive: lin(0x24221f) });
        glowMats.push(MAT.ceiling);
        MAT.wood = CF.Models.mat.wood();
        MAT.stripe = std(0xffffff, { map: stripeTex(), roughness: 0.6 });
        MAT.glow = new THREE.MeshBasicMaterial({ color: lin(0xfff1c9).multiplyScalar(2.2) });
        MAT.ao = new THREE.MeshBasicMaterial({ map: aoTex(), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        MAT.aoBlob = new THREE.MeshBasicMaterial({ map: aoBlobTex(), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    // texture coordinates in metres (su x sv per texture repeat), so tiles keep their size on every wall
    function worldUV(geo, cx, cy, cz, su, sv) {
        const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
        for (let i = 0; i < P.count; i++) {
            const x = P.getX(i) + cx, y = P.getY(i) + cy, z = P.getZ(i) + cz, nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i));
            if (nx > 0.5) U.setXY(i, z / su, y / sv); else if (ny > 0.5) U.setXY(i, x / su, z / sv); else U.setXY(i, x / su, y / sv);
        }
        U.needsUpdate = true;
    }
    function box(w, h, d, mat, x, y, z, o = {}) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        if (o.uv) worldUV(m.geometry, x, y, z, o.uv[0], o.uv[1]);
        m.castShadow = o.cast !== false; m.receiveShadow = true;
        scene.add(m);
        if (o.col !== false) W.colliders.push({ min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2], id: o.id, floor: o.floor });
        return m;
    }
    // fake ambient occlusion: a dark gradient lying on the floor along an edge, fading out into the room (normal nx, nz)
    function ao(x0, z0, x1, z1, nx, nz, w, a) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        w = w || 0.32;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), a ? MAT.ao.clone() : MAT.ao);
        if (a) m.material.opacity = a;
        m.position.set((x0 + x1) / 2 + nx * w / 2, 0.003, (z0 + z1) / 2 + nz * w / 2);
        m.rotation.set(-Math.PI / 2, Math.atan2(nx, nz), 0, 'YXZ');
        m.renderOrder = 1;
        scene.add(m); aoMeshes.push(m);
    }
    const aoRect = (x0, z0, x1, z1, w, a) => { ao(x0, z1, x1, z1, 0, 1, w, a); ao(x0, z0, x1, z0, 0, -1, w, a); ao(x1, z0, x1, z1, 1, 0, w, a); ao(x0, z0, x0, z1, -1, 0, w, a); };
    function aoBlob(x, z, r, a) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), a ? MAT.aoBlob.clone() : MAT.aoBlob);
        if (a) m.material.opacity = a;
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.renderOrder = 1;
        scene.add(m); aoMeshes.push(m);
    }
    // A counter run from (x0,z0) to (x1,z1) with cabinet body, steel top and kick plate
    function counter(x0, z0, x1, z1, o = {}) {
        const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        box(w, CH - 0.04, d, o.mat || MAT.cabinet, cx, (CH - 0.04) / 2, cz, { col: false });
        box(w + 0.02, 0.04, d + 0.02, MAT.counterTop, cx, CH - 0.02, cz, { col: false });
        W.colliders.push({ min: [x0, 0, z0], max: [x1, CH, z1] });
        // cabinet door lines
        if (!o.plain) {
            const front = o.front || 'z+';
            const n = Math.max(1, Math.round((front[0] === 'z' ? w : d) / 0.6));
            for (let i = 0; i < n; i++) {
                const t = (i + 0.5) / n;
                const hx = front[0] === 'z' ? x0 + w * t : (front === 'x+' ? x1 + 0.005 : x0 - 0.005);
                const hz = front[0] === 'z' ? (front === 'z+' ? z1 + 0.005 : z0 - 0.005) : z0 + d * t;
                const hd = box(front[0] === 'z' ? 0.14 : 0.02, 0.02, front[0] === 'z' ? 0.02 : 0.14, MAT.steel, hx, CH - 0.16, hz, { col: false, cast: false });
                hd.castShadow = false;
            }
        }
    }
    function part(mesh, sid, name) {
        mesh.userData.pick = { kind: 'st', sid, part: name };
        mesh.traverse(c => { c.userData.pick = mesh.userData.pick; });
        W.pickables.push(mesh);
        (W.stationParts[sid] = W.stationParts[sid] || {})[name] = mesh;
        return mesh;
    }
    const zoneBox = (x0, y0, z0, x1, y1, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
    W.inZone = (z, p) => p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];

    function buildKitchen() {
        mats();
        // Floor, walls, ceiling
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), MAT.floor);
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
        W.colliders.push({ min: [-20, -1, -20], max: [20, 0, 20], floor: true, id: 'floor' });
        // the ceiling over the kitchen and dining room: thrown things bounce off it (only physics uses it, never the player)
        W.colliders.push({ min: [-20, 3.2, -20], max: [20, 3.8, 20], id: 'ceiling', noPlayer: true });
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), MAT.ceiling);
        ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2; scene.add(ceil);
        const wall = (w, h, d, x, y, z) => box(w, h, d, MAT.wall, x, y, z, { cast: false, uv: [1.2, 0.6] });
        wall(14.4, 3.2, 0.2, 0, 1.6, -5.1);                         // north
        wall(0.2, 3.2, 10.4, -7.1, 1.6, 0);                         // west
        // east wall with the pass window (z -1.6..1.6, y 1.0..2.3)
        // ...and the staff door to the dining room (z 3.3..4.5)
        wall(0.2, 3.2, 3.4, 7.1, 1.6, -3.3); wall(0.2, 3.2, 1.7, 7.1, 1.6, 2.45); wall(0.2, 3.2, 0.7, 7.1, 1.6, 4.85); wall(0.2, 0.9, 1.2, 7.1, 2.75, 3.9);
        wall(0.2, 1.0, 3.2, 7.1, 0.5, 0); wall(0.2, 0.9, 3.2, 7.1, 2.75, 0);
        // south wall with back door (x -5.6..-4.4)
        wall(1.2, 3.2, 0.2, -6.5, 1.6, 5.1); wall(11.4, 3.2, 0.2, 1.3, 1.6, 5.1); wall(1.2, 0.8, 0.2, -5, 2.8, 5.1);
        // tiled skirting stripe
        for (const [w, d, x, z] of [[14, 0.02, 0, -4.99], [0.02, 10, -6.99, 0], [14, 0.02, 0, 4.99]]) box(w, 0.12, d, MAT.coral, x, 0.06, z, { col: false, cast: false });
        // back door
        // things fixed to the walls don't cast shadows: the one key light shines through the walls and would throw
        // their shadows far across the room
        const door = box(1.1, 2.3, 0.06, std(0x3d5a80, { roughness: 0.5 }), -5, 1.15, 5.12, { col: false, cast: false });
        W.colliders.push({ min: [-5.9, 0, 4.98], max: [-4.4, 2.4, 5.2] });   // the closed back door: nobody (and nothing) falls out
        box(0.1, 0.04, 0.08, MAT.steel, -4.6, 1.1, 5.06, { col: false, cast: false });
        const exit = box(0.5, 0.18, 0.04, basicCol(0x29d37a), -5, 2.55, 5.0, { col: false, cast: false });
        exit.material = new THREE.MeshBasicMaterial({ map: CF.Models.textLabel('DELIVERY', '#fff', '#1f9d55') });
        W.zones.delivery = new THREE.Vector3(-5, 0.4, 4.2);
        W.zones.ratDoor = new THREE.Vector3(-5, 0, 4.9);

        // ===== North: stove line =====
        counter(-6.9, -5, -2.25, -4.35);
        // stove block x -2.25..-0.25
        box(2.0, CH - 0.04, D, MAT.dark, -1.25, (CH - 0.04) / 2, -4.675, { col: false });
        box(2.0, 0.04, D, std(0x1a1c1f, { roughness: 0.35, metalness: 0.4 }), -1.25, CH - 0.02, -4.675, { col: false });
        W.colliders.push({ min: [-2.25, 0, -5], max: [-0.25, CH, -4.35] });
        W.zones.burners = [];
        for (let i = 0; i < 4; i++) {
            const x = -1.95 + i * 0.5, z = -4.7;
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 24), MAT.dark); ring.rotation.x = Math.PI / 2; ring.position.set(x, CH + 0.012, z); scene.add(ring);
            const grate = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.012, 24, 1, true), MAT.dark); grate.position.set(x, CH + 0.012, z); scene.add(grate);
            const flame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 5, 24), new THREE.MeshBasicMaterial({ color: lin(0x4aa8ff).multiplyScalar(2), transparent: true, opacity: 0 }));
            flame.rotation.x = Math.PI / 2; flame.position.set(x, CH + 0.02, z); scene.add(flame);
            const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 14), std(0xeeeeee, { metalness: 0.5, roughness: 0.3 }));
            knob.rotation.x = Math.PI / 2; knob.position.set(x, CH - 0.12, -4.33); knob.castShadow = true; scene.add(knob);
            const tick = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.01), MAT.coral); tick.position.set(0, 0.022, 0.012); knob.add(tick);
            part(knob, 'burner' + i, 'knob');
            const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 12), new THREE.MeshBasicMaterial({ visible: false }));
            hit.position.set(x, CH + 0.02, z); scene.add(hit); part(hit, 'burner' + i, 'top');
            W.zones.burners.push({ x, z, y: CH + 0.012, flame, knob });
        }
        // hood
        box(3.2, 0.5, 1.0, MAT.counterTop, -0.75, 2.75, -4.55, { col: false, cast: false });
        box(3.0, 0.05, 0.9, std(0x8a9399, { metalness: 0.7, roughness: 0.5 }), -0.75, 2.49, -4.55, { col: false, cast: false });
        for (let i = 0; i < 3; i++) { const l = box(0.4, 0.02, 0.15, MAT.glow, -1.9 + i * 1.15, 2.47, -4.5, { col: false, cast: false }); l.castShadow = false; }

        // oven x -0.25..0.75 with a cavity and a drop-down door
        const ox0 = -0.25, ox1 = 0.75;
        box(1.0, 0.16, D, MAT.dark, 0.25, 0.08, -4.675, { col: false });
        box(1.0, CH - 0.74, D, MAT.dark, 0.25, 0.74 + (CH - 0.74) / 2, -4.675, { col: false });
        box(0.05, CH, D, MAT.dark, ox0 + 0.025, CH / 2, -4.675, { col: false }); box(0.05, CH, D, MAT.dark, ox1 - 0.025, CH / 2, -4.675, { col: false });
        box(0.9, 0.58, 0.04, std(0x111316, { roughness: 0.4 }), 0.25, 0.45, -4.98, { col: false });
        W.colliders.push({ min: [ox0, 0, -5], max: [ox1, 0.16, -4.35] }, { min: [ox0, 0.74, -5], max: [ox1, CH, -4.35] },
            { min: [ox0, 0, -5], max: [ox0 + 0.05, CH, -4.35] }, { min: [ox1 - 0.05, 0, -5], max: [ox1, CH, -4.35] }, { min: [ox0, 0, -5], max: [ox1, CH, -4.96] });
        box(1.02, 0.04, D + 0.02, MAT.counterTop, 0.25, CH - 0.02, -4.675, { col: false });
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.01, 0.55), std(0x9aa3a8, { metalness: 0.8, roughness: 0.4, wireframe: true }));
        rack.position.set(0.25, 0.3, -4.68); scene.add(rack);
        W.colliders.push({ min: [ox0 + 0.05, 0.16, -4.96], max: [ox1 - 0.05, 0.3, -4.38] });
        const ovenGlow = new THREE.PointLight(0xff8a3a, 0, 1.2, 2); ovenGlow.position.set(0.25, 0.55, -4.7); scene.add(ovenGlow);
        const doorPivot = new THREE.Group(); doorPivot.position.set(0.25, 0.16, -4.33); scene.add(doorPivot);
        const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.58, 0.04), std(0x2c3035, { metalness: 0.5, roughness: 0.3 }));
        doorMesh.position.set(0, 0.29, 0); doorMesh.castShadow = true; doorPivot.add(doorMesh);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), std(0x331a10, { roughness: 0.1, metalness: 0.2, emissive: 0x000000 }));
        win.position.set(0, 0.32, 0.021); doorMesh.add(win);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.03), MAT.steel); bar.position.set(0, 0.52, 0.05); doorMesh.add(bar);
        part(doorMesh, 'oven', 'door');
        const ovenKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 14), std(0xeeeeee, { metalness: 0.5, roughness: 0.3 }));
        ovenKnob.rotation.x = Math.PI / 2; ovenKnob.position.set(0.25, 0.83, -4.33); scene.add(ovenKnob);
        part(ovenKnob, 'oven', 'knob');
        W.colliders.push({ min: [ox0, 0.16, -4.37], max: [ox1, 0.74, -4.33], id: 'ovenDoor' });
        W.zones.oven = zoneBox(ox0 + 0.05, 0.16, -4.96, ox1 - 0.05, 0.74, -4.37);
        W.oven = { doorPivot, win, glow: ovenGlow };

        // fryer x 0.75..1.55 with a recessed oil vat
        const fx0 = 0.75, fx1 = 1.55;
        box(0.8, CH - 0.04, D, MAT.steel, 1.15, (CH - 0.04) / 2, -4.675, { col: false });
        W.colliders.push({ min: [fx0, 0, -5], max: [fx1, CH - 0.22, -4.35] },
            { min: [fx0, 0, -5], max: [fx0 + 0.12, CH, -4.35] }, { min: [fx1 - 0.12, 0, -5], max: [fx1, CH, -4.35] },
            { min: [fx0, 0, -5], max: [fx1, CH, -4.93] }, { min: [fx0, 0, -4.45], max: [fx1, CH, -4.35] });
        box(0.8, 0.03, 0.08, MAT.steel, 1.15, CH - 0.015, -4.39, { col: false }); box(0.8, 0.03, 0.08, MAT.steel, 1.15, CH - 0.015, -4.96, { col: false });
        box(0.12, 0.03, D, MAT.steel, fx0 + 0.06, CH - 0.015, -4.675, { col: false }); box(0.12, 0.03, D, MAT.steel, fx1 - 0.06, CH - 0.015, -4.675, { col: false });
        // golden oil (it looked grey: metallic + see-through over the dark vat); glows a little warmer when the fryer is on
        const oil = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.48), std(0xe6a72c, { roughness: 0.16, metalness: 0, transparent: true, opacity: 0.96, emissive: lin(0x3a2200) }));
        oil.rotation.x = -Math.PI / 2; oil.position.set(1.15, CH - 0.09, -4.69); scene.add(oil);
        const fswitch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), std(0x29d37a, { emissive: 0x000000 }));
        fswitch.position.set(1.15, CH - 0.12, -4.33); scene.add(fswitch); part(fswitch, 'fryer', 'switch');
        W.zones.fryer = zoneBox(fx0 + 0.12, CH - 0.24, -4.93, fx1 - 0.12, CH + 0.08, -4.45);
        W.fryer = { oil, sw: fswitch };
        counter(1.55, -5, 6.9, -4.35);
        // wall shelf over north counter
        box(3.5, 0.04, 0.3, MAT.wood, -4.6, 1.7, -4.85, { col: true, cast: false });
        box(3.5, 0.04, 0.3, MAT.wood, 4.2, 1.7, -4.85, { col: true, cast: false });

        // ===== West: prep + sink =====
        counter(-7, -4.35, -6.35, -2.7, { front: 'x+' });
        // sink section z -2.7..-1.3 with basin
        box(D, CH - 0.04, 1.4, MAT.cabinetDark, -6.675, (CH - 0.04) / 2, -2.0, { col: false });
        W.colliders.push({ min: [-7, 0, -2.7], max: [-6.35, CH - 0.3, -1.3] },
            { min: [-7, 0, -2.7], max: [-6.35, CH, -2.55] }, { min: [-7, 0, -1.45], max: [-6.35, CH, -1.3] },
            { min: [-7, 0, -2.7], max: [-6.88, CH, -1.3] }, { min: [-6.45, 0, -2.7], max: [-6.35, CH, -1.3] });
        const basin = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.3, 1.1), std(0xb8c2c8, { metalness: 0.85, roughness: 0.25, side: THREE.BackSide }));
        basin.position.set(-6.665, CH - 0.15, -2.0); basin.receiveShadow = true; scene.add(basin);
        for (const [w, d, x, z] of [[D, 0.15, -6.675, -2.625], [D, 0.15, -6.675, -1.375], [0.12, 1.4, -6.94, -2.0], [0.1, 1.4, -6.4, -2.0]]) box(w, 0.04, d, MAT.counterTop, x, CH - 0.02, z, { col: false });
        const tap = new THREE.Group(); tap.position.set(-6.98, CH, -2.0); scene.add(tap);
        const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.35, 10), MAT.steel); tp.position.y = 0.17; tap.add(tp);
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8), MAT.steel); sp.rotation.z = Math.PI / 2; sp.position.set(0.12, 0.34, 0); tap.add(sp);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.3, 6), basicCol(0x9fe0ff, { transparent: true, opacity: 0.6 }));
        water.position.set(0.24, 0.18, 0); water.visible = false; tap.add(water);
        const sinkHit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 1.2), new THREE.MeshBasicMaterial({ visible: false }));
        sinkHit.position.set(-6.66, CH - 0.1, -2.0); scene.add(sinkHit); part(sinkHit, 'sink', 'basin');
        W.zones.sink = zoneBox(-6.9, CH - 0.32, -2.55, -6.43, CH + 0.3, -1.45);
        W.sinkWater = water;
        // dirty dish return (a coral tray) and the rest of the west counter
        counter(-7, -1.3, -6.35, 3.4, { front: 'x+' });
        const tray = box(0.5, 0.03, 0.6, MAT.coral, -6.65, CH + 0.015, -3.5, { col: false });
        part(tray, 'dirty', 'tray');
        W.zones.dirty = new THREE.Vector3(-6.65, CH + 0.1, -3.5);
        // cutting boards
        W.zones.boards = [];
        [[-6.64, -0.4], [-6.64, 1.1], [-0.6, 0.5]].forEach(([x, z], i) => {
            const b = box(0.42, 0.03, 0.55, MAT.wood, x, CH + 0.015, z, { col: true });
            if (i === 2) b.rotation.y = Math.PI / 2;
            part(b, 'board' + i, 'board');
            W.zones.boards.push(zoneBox(x - 0.3, CH, z - 0.32, x + 0.3, CH + 0.3, z + 0.32));
            const knife = new THREE.Group();
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.04), MAT.steel); blade.position.x = 0.1; knife.add(blade);
            const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.025), std(0x1d1f22)); hnd.position.x = -0.05; knife.add(hnd);
            knife.position.set(x + (i === 2 ? 0.25 : 0.05), CH + 0.035, z + (i === 2 ? 0 : 0.24)); knife.rotation.y = i === 2 ? Math.PI / 2 : 0.2;
            knife.traverse(c => { c.castShadow = true; }); scene.add(knife);
        });
        buildPrepBowls();
        // spice shelf
        box(0.25, 0.03, 1.2, MAT.wood, -6.85, 1.45, 2.4, { col: true, cast: false });
        W.zones.spices = [new THREE.Vector3(-6.85, 1.53, 2.15), new THREE.Vector3(-6.85, 1.53, 2.45), new THREE.Vector3(-6.85, 1.53, 2.75)];

        // ===== East: serving pass =====
        counter(6.35, -4.35, 7, -1.6, { front: 'x-' });
        counter(6.35, 1.6, 7, 3.1, { front: 'x-' });
        // pass shelf through the wall
        box(0.95, 0.06, 3.2, MAT.counterTop, 6.75, 1.0, 0, { col: true });
        box(0.6, CH - 0.06, 3.2, MAT.cabinetDark, 6.65, (CH - 0.06) / 2, 0, { col: true });
        const heat = box(0.6, 0.08, 3.0, std(0x3b3f44, { metalness: 0.5 }), 6.75, 2.2, 0, { col: false });
        for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.5), new THREE.MeshBasicMaterial({ color: lin(0xff8a50).multiplyScalar(2) })); l.position.set(6.75, 2.15, -1 + i); scene.add(l); }
        const passLight = rig(new THREE.PointLight(lin(0xffa060), 0.7, 2.6, 2), 0.7, 0.3); passLight.position.set(6.75, 1.9, 0); scene.add(passLight);
        W.zones.pass = zoneBox(6.3, 1.0, -1.6, 7.25, 1.5, 1.6);
        // bell
        const bell = new THREE.Group();
        const bb = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16), MAT.dark); bell.add(bb);
        const bd = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xffd166, { metalness: 0.9, roughness: 0.2 })); bd.position.y = 0.008; bell.add(bd);
        const bk = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), MAT.dark); bk.position.y = 0.055; bell.add(bk);
        bell.position.set(6.45, 1.04, 1.4); bell.traverse(c => { c.castShadow = true; }); scene.add(bell);
        part(bell, 'bell', 'bell');
        // OPEN sign
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        sign.position.set(6.98, 1.75, -2.25); scene.add(sign); part(sign, 'sign', 'sign');
        W.signMesh = sign; W.setSign(false);
        // ticket rail
        box(0.06, 0.04, 3.0, MAT.steel, 6.95, 2.45, 0, { col: false });
        W.ticketRail = new THREE.Group(); W.ticketRail.position.set(6.9, 2.32, 0); scene.add(W.ticketRail);
        // plate + bowl stacks
        W.zones.plates = new THREE.Vector3(6.65, CH, 2.0);
        W.zones.bowls = new THREE.Vector3(6.65, CH, 2.75);
        W.plateStack = new THREE.Group(); W.plateStack.position.copy(W.zones.plates); scene.add(W.plateStack);
        W.bowlStack = new THREE.Group(); W.bowlStack.position.copy(W.zones.bowls); scene.add(W.bowlStack);
        const ph = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), new THREE.MeshBasicMaterial({ visible: false })); ph.position.set(6.65, CH + 0.2, 2.0); scene.add(ph); part(ph, 'plates', 'stack');
        const bh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10), new THREE.MeshBasicMaterial({ visible: false })); bh.position.set(6.65, CH + 0.2, 2.75); scene.add(bh); part(bh, 'bowls', 'stack');

        // ===== South: shop terminal, trash, storage =====
        box(1.2, 0.05, 0.6, MAT.wood, -2.8, 0.8, 4.65, { col: true });
        for (const x of [-3.35, -2.25]) box(0.05, 0.78, 0.55, MAT.dark, x, 0.39, 4.65, { col: true });
        const monitor = new THREE.Group(); monitor.position.set(-2.8, 0.83, 4.75); scene.add(monitor);
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), MAT.dark); stand.position.y = 0.12; monitor.add(stand);
        const scr = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.04), MAT.dark); scr.position.y = 0.45; monitor.add(scr);
        W.terminalScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.34), new THREE.MeshBasicMaterial({ map: terminalTex() }));
        W.terminalScreen.position.set(0, 0.45, -0.022); W.terminalScreen.rotation.y = Math.PI; monitor.add(W.terminalScreen);
        monitor.rotation.y = 0; monitor.traverse(c => { c.castShadow = true; });
        part(scr, 'terminal', 'screen');
        const kb = box(0.45, 0.02, 0.15, MAT.dark, -2.8, 0.835, 4.45, { col: false });
        // trash bin
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.75, 18, 1, true), std(0x3a6ea5, { roughness: 0.5, side: THREE.DoubleSide }));
        bin.position.set(-1.2, 0.375, 4.55); bin.castShadow = true; scene.add(bin);
        const binIn = new THREE.Mesh(new THREE.CircleGeometry(0.25, 18), std(0x111111)); binIn.rotation.x = -Math.PI / 2; binIn.position.set(-1.2, 0.3, 4.55); scene.add(binIn);
        part(bin, 'trash', 'bin');
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; W.colliders.push({ min: [-1.2 + Math.cos(a) * 0.28 - 0.04, 0, 4.55 + Math.sin(a) * 0.28 - 0.04], max: [-1.2 + Math.cos(a) * 0.28 + 0.04, 0.75, 4.55 + Math.sin(a) * 0.28 + 0.04] }); }
        W.colliders.push({ min: [-1.45, 0, 4.3], max: [-0.95, 0.3, 4.8] });
        W.zones.trash = zoneBox(-1.45, 0.28, 4.3, -0.95, 1.0, 4.8);
        // the pantry: produce crates on the storage counter, bakery baskets on the shelf, the deli case on the coral counter
        counter(0.0, 4.35, 4.6, 5.0, { front: 'z-' });
        counter(4.6, 4.35, 6.35, 5.0, { front: 'z-', mat: MAT.coral });
        box(4.4, 0.04, 0.35, MAT.wood, 2.3, 1.55, 4.83, { col: true });
        box(1.7, 0.04, 0.35, MAT.wood, 5.5, 1.55, 4.83, { col: true });
        box(1.7, 0.04, 0.35, MAT.wood, 5.5, 2.0, 4.83, { col: true });
        buildPantry();
        // kitchenware table in the corner by the back door: spare cookware, and bought pans / pots / tools land here
        counter(-7, 3.4, -6.35, 5.0, { front: 'x+' });
        W.zones.ware = [[-6.67, 3.7], [-6.67, 4.1], [-6.67, 4.5], [-6.62, 4.85]].map(([x, z]) => new THREE.Vector3(x, CH, z));
        // empty delivery crates stacked by the door (decoration)
        const crate = CF.Models.item('crate'); crate.position.set(-3.9, 0.17, 4.74); crate.rotation.y = 0.1; scene.add(crate);
        const crate2 = CF.Models.item('crate'); crate2.position.set(-3.88, 0.51, 4.75); crate2.rotation.y = -0.15; scene.add(crate2);
        for (const c of [crate, crate2]) c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        W.colliders.push({ min: [-4.16, 0, 4.53], max: [-3.62, 0.68, 4.97] });
        // extinguisher brackets
        W.zones.extSpots = [new THREE.Vector3(-2.55, 0.26, -4.15), new THREE.Vector3(5.2, 0.26, 4.1)];
        const extSign = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), new THREE.MeshBasicMaterial({ map: CF.Models.textLabel('🧯', '#fff', '#d8262a') }));
        extSign.position.set(-2.55, 1.0, -4.99); scene.add(extSign);

        // ===== Center island =====
        counter(-1.6, -0.2, 1.6, 1.2, { mat: MAT.coral, front: 'z+' });
        box(3.3, 0.06, 0.06, MAT.steel, 0, 2.2, 0.5, { col: false });
        for (let i = 0; i < 5; i++) {
            const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 4, 10), MAT.steel); hook.position.set(-1.4 + i * 0.7, 2.14, 0.5); scene.add(hook);
            const ut = new THREE.Mesh(i % 2 ? new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12) : new THREE.BoxGeometry(0.05, 0.3, 0.01), MAT.steel);
            ut.position.set(-1.4 + i * 0.7, i % 2 ? 1.98 : 1.96, 0.5); if (i % 2) ut.rotation.x = Math.PI / 2; ut.castShadow = true; scene.add(ut);
        }
        // hanging enamel lamps (coral outside, white inside, glowing bulb) - each one really lights the room on High+
        pendants([[-4, 0, 1], [0, -2, 1], [0, 2.5, 1], [4, 0, 1], [-4, -3, 2], [4, -3, 2]], 2.55, 0xff6b5b);
        // recessed ceiling light panels (the overhead key light comes from these)
        const panelMat = new THREE.MeshBasicMaterial({ color: lin(0xfff6e8).multiplyScalar(1.7) }), frame = std(0xe8e8e8, { roughness: 0.4, metalness: 0.3 });
        for (const [x, z] of [[-5.4, -1.4], [-2, 0.9], [2, -0.9], [5.4, 1.4], [-2.4, 3.6], [2.6, 3.6], [-5.4, 2.4], [5.4, -2.4]]) {
            const f = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.03, 0.66), frame); f.position.set(x, 3.19, z); scene.add(f);
            const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), panelMat); pl.rotation.x = Math.PI / 2; pl.position.set(x, 3.172, z); scene.add(pl);
        }
        // fake ambient occlusion: soft darkening where the floor meets walls, counters and the island
        ao(-7, -5, 7, -5, 0, 1); ao(-7, 5, 7, 5, 0, -1); ao(-7, -5, -7, 5, 1, 0); ao(7, -5, 7, 5, -1, 0);
        ao(-7, -4.35, 7, -4.35, 0, 1, 0.26, 0.42); ao(-6.35, -4.35, -6.35, 5.0, 1, 0, 0.26, 0.42);
        aoRect(-4.16, 4.53, -3.62, 4.97, 0.12, 0.32);
        ao(6.35, -4.35, 6.35, -1.6, -1, 0, 0.26, 0.42); ao(6.35, 1.6, 6.35, 3.1, -1, 0, 0.26, 0.42); ao(6.05, -1.6, 6.05, 1.6, -1, 0, 0.24, 0.38);
        ao(0, 4.35, 6.35, 4.35, 0, -1, 0.26, 0.42);
        aoRect(-1.6, -0.2, 1.6, 1.2, 0.28, 0.45);
        aoRect(-3.38, 4.38, -2.22, 4.92, 0.12, 0.3);
        aoBlob(-1.2, 4.55, 0.42, 0.5);
        // grease puddle (event)
        W.grease = new THREE.Mesh(new THREE.CircleGeometry(1.3, 28), std(0x6b4f12, { roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75 }));
        W.grease.rotation.x = -Math.PI / 2; W.grease.position.set(-1.0, 0.006, -3.4); W.grease.visible = false; W.grease.receiveShadow = true; scene.add(W.grease);
        W.zones.grease = { x: -1.0, z: -3.4, r: 1.3 };
        // player spawn points
        W.spawns = [new THREE.Vector3(-2.5, 0, 2.2), new THREE.Vector3(2.5, 0, 2.2), new THREE.Vector3(-2.5, 0, -2.2), new THREE.Vector3(2.5, 0, -2.2)];
    }

    // ---------- Pantry ----------
    // One bin per raw ingredient (see CF.PANTRY). Each shows up to a few real models of what is in stock and has
    // a shelf-edge label with the count. W.pantry[type] = { x, y (bin floor), z, w, d, slots, models, zone, label }.
    W.pantry = {};
    const half = type => { const s = CF.ITEMS[type].shape; return s.t === 'sphere' ? s.r : s.s[1] / 2; };
    function buildPantry() {
        const wicker = std(0xc4975a, { roughness: 0.9 }), rim = std(0x8a5f30, { roughness: 0.7 });
        const crateWood = std(0xb08458, { map: CF.Models.woodTex(), roughness: 0.82 });      // a darker stain than the shelves
        const ice = std(0xeef6fb, { roughness: 0.3 });
        const grid = (xs, zs) => { const out = []; for (const z of zs) for (const x of xs) out.push([x, z]); return out; };
        function bin(type, x, y, z, w, d, style, slots, label) {
            const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
            const piece = (bw, bh, bd, mat, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
            let floor = 0.015;
            if (style === 'crate') {
                piece(w, 0.015, d, crateWood, 0, 0.0075, 0);
                piece(w, 0.08, 0.018, crateWood, 0, 0.055, -d / 2 + 0.009);          // low front so you see in
                piece(w, 0.15, 0.018, crateWood, 0, 0.09, d / 2 - 0.009);
                for (const s of [-1, 1]) piece(0.018, 0.12, d, crateWood, s * (w / 2 - 0.009), 0.075, 0);
            } else if (style === 'basket') {
                piece(w, 0.012, d, wicker, 0, 0.006, 0);
                for (const s of [-1, 1]) { piece(w, 0.07, 0.014, wicker, 0, 0.042, s * (d / 2 - 0.007)); piece(0.014, 0.07, d, wicker, s * (w / 2 - 0.007), 0.042, 0); }
                piece(w + 0.01, 0.012, 0.02, rim, 0, 0.08, -d / 2 + 0.007); piece(w + 0.01, 0.012, 0.02, rim, 0, 0.08, d / 2 - 0.007);
                floor = 0.012;
            } else {                                                                 // deli: steel tray on crushed ice
                piece(w, 0.03, d, MAT.steel, 0, 0.015, 0);
                piece(w - 0.04, 0.02, d - 0.04, ice, 0, 0.035, 0);
                piece(w, 0.07, 0.012, MAT.steel, 0, 0.065, d / 2 - 0.006);
                for (const s of [-1, 1]) piece(0.012, 0.05, d, MAT.steel, s * (w / 2 - 0.006), 0.055, 0);
                floor = 0.045;
            }
            // the ingredients on show (no physics, not pickable: the bin hands out real items)
            const models = slots.map(([sx, sz], k) => {
                const m = CF.Models.item(type);
                m.position.set(sx, floor + half(type), sz);
                m.rotation.y = (k * 2.39) % (Math.PI * 2);
                m.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
                m.visible = false;
                g.add(m);
                return m;
            });
            // click / E target over the whole bin
            const hit = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), new THREE.MeshBasicMaterial({ visible: false }));
            hit.position.set(x, y + 0.15, z); scene.add(hit);
            part(hit, 'pantry', type);
            // shelf-edge label facing the room
            const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 80;
            const tex = new THREE.CanvasTexture(cvs); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
            const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.094), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
            lab.position.set(label[0], label[1], label[2]); lab.rotation.y = Math.PI; scene.add(lab);
            W.pantry[type] = { x, y: y + floor, z, w, d, slots, models, group: g, label: { cvs, tex, mesh: lab }, zone: zoneBox(x - w / 2, y - 0.02, z - d / 2, x + w / 2, y + 0.32, z + d / 2) };
            W.drawPantryLabel(type, 0);
        }
        // produce crates
        ['tomato', 'onion', 'lettuce', 'potato', 'mushroom'].forEach((t, i) => {
            const x = 0.5 + i * 0.9;
            bin(t, x, CH + 0.002, 4.68, 0.8, 0.5, 'crate', grid([-0.22, 0, 0.22], [-0.1, 0.1]), [x, CH - 0.1, 4.343]);
        });
        // bakery baskets on the shelf
        ['bun', 'dough'].forEach((t, i) => {
            const x = 1.85 + i * 0.9;
            bin(t, x, 1.572, 4.83, 0.62, 0.3, 'basket', grid([-0.2, -0.067, 0.067, 0.2], [0]), [x, 1.5, 4.652]);
        });
        // deli case
        ['patty', 'steak', 'salami', 'cheese'].forEach((t, i) => {
            const x = 4.85 + i * 0.42;
            bin(t, x, CH + 0.002, 4.68, 0.38, 0.5, 'deli', [[0, -0.13], [0, 0.0], [0, 0.13]], [x, CH - 0.1, 4.343]);
        });
        // a cool light over the deli case and section signs on the wall
        const strip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.02, 0.04), new THREE.MeshBasicMaterial({ color: lin(0xd8f2ff).multiplyScalar(1.8) }));
        strip.position.set(5.5, 1.515, 4.7); scene.add(strip);
        const sign = (text, sub, col, x, y, wdt) => {
            const t = CF.Models.canvasTex(512, 128, (g, w, h) => {
                g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(4, 4, w - 8, h - 8, 26) : g.rect(4, 4, w - 8, h - 8); g.fill();
                g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
                g.font = 'bold 62px Bungee, Fredoka, Arial'; g.fillText(text, w / 2, h / 2 - (sub ? 12 : -4));
                if (sub) { g.font = '600 26px Fredoka, Arial'; g.fillText(sub, w / 2, h - 26); }
            });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(wdt, wdt / 4), new THREE.MeshBasicMaterial({ map: t }));
            m.position.set(x, y, 4.985); m.rotation.y = Math.PI; scene.add(m);
        };
        sign('PANTRY', 'LMB or E: take one · E: put it back', '#2e8b57', 1.4, 2.2, 1.2);
        sign('DELI', 'meat & cheese', '#1d6fa3', 5.5, 2.42, 0.9);
    }
    // Prep Bowls (upgrade): fixed steel bowls by the cutting boards that store cut pieces of one kind.
    // W.prepBowls[i] = { x, y (floor), z, group, models, type, zone }; shown with W.setPrepBowls(on).
    W.prepBowls = [];
    function buildPrepBowls() {
        const geo = new THREE.LatheGeometry([[0.001, 0], [0.07, 0], [0.092, 0.025], [0.104, 0.068], [0.098, 0.072]].map(p => new THREE.Vector2(p[0], p[1])), 28);
        const mat = std(0xd9dee2, { metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide });
        const spots = [[-1.33, 0.02], [-1.33, 0.47], [-1.33, 0.92], [-6.6, 0.12], [-6.6, 0.42], [-6.6, 0.72]];
        spots.forEach(([x, z], i) => {
            const g = new THREE.Group(); g.position.set(x, CH, z); g.visible = false; scene.add(g);
            const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
            const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12), new THREE.MeshBasicMaterial({ visible: false }));
            hit.position.set(x, CH + 0.08, z); scene.add(hit);
            part(hit, 'prep', String(i));
            W.prepBowls.push({ x, y: CH + 0.006, z, group: g, models: [], type: null, zone: zoneBox(x - 0.11, CH - 0.02, z - 0.11, x + 0.11, CH + 0.28, z + 0.11) });
        });
    }
    let prepShown = false;
    W.setPrepBowls = on => { if (on === prepShown) return; prepShown = on; for (const b of W.prepBowls) b.group.visible = on; };
    // show up to 3 pieces of what a bowl holds
    W.drawPrep = (i, type, n) => {
        const B = W.prepBowls[i]; if (!B) return;
        if (B.type !== type) {
            for (const m of B.models) B.group.remove(m);
            B.models = []; B.type = type;
            if (type) for (let k = 0; k < 3; k++) {
                const m = CF.Models.item(type), sh = CF.ITEMS[type].shape, half = sh.t === 'sphere' ? sh.r : sh.s[1] / 2;
                m.position.set(Math.cos(k * 2.1) * 0.03 * (k ? 1 : 0), 0.008 + half + k * 0.012, Math.sin(k * 2.1) * 0.03 * (k ? 1 : 0));
                m.rotation.y = k * 1.7;
                m.traverse(o => { if (o.isMesh) o.castShadow = false; });
                B.group.add(m); B.models.push(m);
            }
        }
        B.models.forEach((m, k) => { m.visible = k < n; });
    };

    // the count label on a bin's shelf edge
    W.drawPantryLabel = (type, n) => {
        const P = W.pantry[type], def = CF.ITEMS[type], cap = CF.PANTRY[type].cap;
        if (!P) return;
        const g = P.label.cvs.getContext('2d'), w = 256, h = 80;
        g.clearRect(0, 0, w, h);
        g.fillStyle = n ? '#fffdf5' : '#e9e4da';
        g.beginPath(); if (g.roundRect) g.roundRect(2, 2, w - 4, h - 4, 14); else g.rect(2, 2, w - 4, h - 4); g.fill();
        g.fillStyle = n === 0 ? '#9a9a9a' : n <= Math.max(1, cap * 0.2) ? '#e8590c' : '#2b8a3e';
        g.fillRect(2, h - 14, w - 4, 12);
        g.textBaseline = 'middle'; g.textAlign = 'left';
        g.font = '40px serif'; g.fillStyle = '#000'; g.fillText(def.icon, 10, 34);
        g.font = '600 24px Fredoka, Arial'; g.fillStyle = '#1d3557'; g.fillText(def.name, 62, 22, 120);
        g.font = 'bold 28px Fredoka, Arial'; g.fillStyle = n ? '#1d3557' : '#b02a37'; g.fillText(n ? `${n} / ${cap}` : 'EMPTY', 62, 50, 120);
        g.textAlign = 'right'; g.font = '600 18px Fredoka, Arial'; g.fillStyle = '#6c757d'; g.fillText('$' + CF.PRICE[type], w - 12, 22);
        P.label.tex.needsUpdate = true;
        for (let k = 0; k < P.models.length; k++) P.models[k].visible = k < n;
    };

    // pendant lamps: list of [x, z, level]; level 1 lights with "On", level 2 only with "All"
    function pendants(list, y, shadeColor) {
        const outer = std(shadeColor, { roughness: 0.35, metalness: 0.1 }), inner = std(0xf4f1ea, { roughness: 0.6, side: THREE.BackSide });
        const cap = std(0x2a2d31, { roughness: 0.4, metalness: 0.6 });
        const shadeGeo = new THREE.LatheGeometry([[0.225, -0.08], [0.22, -0.07], [0.14, 0.03], [0.06, 0.1], [0.03, 0.12]].map(p => new THREE.Vector2(p[0], p[1])), 24);
        for (const [x, z, level] of list) {
            const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 3.2 - (y + 0.17), 4), cap);
            cord.position.set(x, (3.2 + y + 0.17) / 2, z); scene.add(cord);
            const sh = new THREE.Mesh(shadeGeo, outer); sh.position.set(x, y + 0.05, z); scene.add(sh);
            const si = new THREE.Mesh(shadeGeo, inner); si.position.copy(sh.position); si.scale.setScalar(0.985); scene.add(si);
            const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 12), cap); c.position.set(x, y + 0.18, z); scene.add(c);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), MAT.glow); bulb.position.set(x, y + 0.02, z); scene.add(bulb);
            lampLight(x, y - 0.05, z, level);
        }
    }
    W.setSign = open => {
        W.signMesh.material.map = CF.Models.textLabel(open ? 'OPEN' : 'CLOSED', '#fff', open ? '#1f9d55' : '#d8262a');
        W.signMesh.material.needsUpdate = true;
    };
    function terminalTex() {
        return CF.Models.canvasTex(256, 160, (g, w, h) => {
            const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1d3557'); gr.addColorStop(1, '#2ec4b6');
            g.fillStyle = gr; g.fillRect(0, 0, w, h);
            g.fillStyle = '#fff'; g.font = 'bold 30px Fredoka, Arial'; g.textAlign = 'center';
            g.fillText('FRESH MARKET', w / 2, 60);
            g.font = '20px Fredoka, Arial'; g.fillText('press E to order', w / 2, 105);
            g.fillText('🍅 🧀 🥩 🍞', w / 2, 140);
        });
    }

    // ---------- Dining room (waiters walk in through the saloon doors) ----------
    W.seats = []; W.tables = [];
    function buildDining() {
        const wf = woodFloorMaps();
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 10), std(0xffffff, { map: wf.map, bumpMap: wf.bump, bumpScale: 0.008, roughness: 0.55, metalness: 0.02 }));
        floor.rotation.x = -Math.PI / 2; floor.position.set(10.7, 0, 0); floor.receiveShadow = true; scene.add(floor);
        const dw = std(0x4e3d74, { roughness: 0.85 });
        // dark wood panelling on the lower walls with a rail on top
        const panel = std(0x3a2618, { roughness: 0.6, map: wf.map }), rail = std(0x2a1a10, { roughness: 0.45 });
        for (const [w, d, x, z] of [[0.03, 10, 14.185, 0], [7, 0.03, 10.7, -4.985], [7, 0.03, 10.7, 4.985]]) {
            box(w, 1.0, d, panel, x, 0.5, z, { col: false, cast: false });
            box(w + (w < 0.1 ? 0.03 : 0), 0.05, d + (d < 0.1 ? 0.03 : 0), rail, x, 1.02, z, { col: false, cast: false });
        }
        ao(14.17, -5, 14.17, 5, -1, 0); ao(7.22, -5, 14.2, -5, 0, 1); ao(7.22, 5, 14.2, 5, 0, -1); ao(7.22, -5, 7.22, 5, 1, 0, 0.28, 0.4);
        pendants([[9.2, -3, 1], [9.2, 0, 2], [9.2, 3, 1], [12, -3, 2], [12, 0, 1], [12, 3, 2]], 2.35, 0xc9973f);
        box(0.2, 3.2, 10.4, dw, 14.3, 1.6, 0, { cast: false }); box(7.2, 3.2, 0.2, dw, 10.7, 1.6, -5.1, { cast: false }); box(7.2, 3.2, 0.2, dw, 10.7, 1.6, 5.1, { cast: false });
        // the kitchen wall seen from the dining side
        for (const [d, z] of [[3.4, -3.3], [1.7, 2.45], [0.7, 4.85]]) box(0.02, 3.2, d, dw, 7.21, 1.6, z, { col: false, cast: false });
        // guest entrance
        box(0.06, 2.3, 1.1, std(0x8a5f34, { roughness: 0.6 }), 14.18, 1.15, -4.0, { col: false, cast: false });
        const ent = box(0.04, 0.2, 0.7, new THREE.MeshBasicMaterial({ map: CF.Models.textLabel('WELCOME', '#fff', '#ff3d9a') }), 14.16, 2.5, -4.0, { col: false, cast: false });
        W.entrance = new THREE.Vector3(13.6, 0, -4.2);
        // staff door: two saloon half-doors that swing when someone walks through
        W.doors = [];
        for (const [hz, s] of [[3.3, 1], [4.5, -1]]) {
            const piv = new THREE.Group(); piv.position.set(7.1, 0.45, hz); scene.add(piv);
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.58), std(0xff6b5b, { roughness: 0.5 }));
            p.position.set(0, 0.6, s * 0.29); p.castShadow = true; piv.add(p);
            const port = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), std(0x9fe7ff, { roughness: 0.1 })); port.position.set(0.025, 0.75, s * 0.29); port.rotation.y = Math.PI / 2; piv.add(port);
            W.doors.push({ piv, s, a: 0 });
        }
        const staff = box(0.04, 0.18, 0.9, new THREE.MeshBasicMaterial({ map: CF.Models.textLabel('STAFF', '#fff', '#1d3557') }), 6.98, 2.45, 3.9, { col: false, cast: false });
        const dCeilMat = std(0x3a2f55, { roughness: 0.9, emissive: lin(0x15111d) }); glowMats.push(dCeilMat);
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7, 10), dCeilMat); ceil.rotation.x = Math.PI / 2; ceil.position.set(10.7, 3.2, 0); scene.add(ceil);
        box(0.05, 0.4, 6, MAT.stripe, 14.08, 2.2, 0, { col: false, cast: false });
        // neon sign
        const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: CF.Models.canvasTex(512, 128, (g, w, h) => {
            g.fillStyle = '#120a1e'; g.fillRect(0, 0, w, h);
            g.shadowColor = '#ff3d9a'; g.shadowBlur = 24; g.fillStyle = '#ff7ac0'; g.font = 'bold 86px Bungee, Fredoka, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText('FRENZY', w / 2, h / 2 + 4); g.fillText('FRENZY', w / 2, h / 2 + 4);
        }) }));
        neon.position.set(14.05, 2.2, 0); neon.rotation.y = -Math.PI / 2; scene.add(neon);
        const tableM = std(0xffffff, { roughness: 0.4 }), chairM = std(0xff6b5b, { roughness: 0.5 });
        [[9.2, -3], [9.2, 0], [9.2, 3], [12, -3], [12, 0], [12, 3]].forEach(([x, z], ti) => {
            const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), tableM); t.position.set(x, 0.75, z); t.castShadow = true; t.receiveShadow = true; scene.add(t);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.75, 8), MAT.dark); leg.position.set(x, 0.375, z); leg.castShadow = true; scene.add(leg);
            aoBlob(x, z, 0.75, 0.42);
            const num = new THREE.Sprite(new THREE.SpriteMaterial({ map: CF.Models.textLabel(String(ti + 1), '#fff', '#2ec4b6') }));
            num.scale.set(0.14, 0.14, 1); num.position.set(x, 1.0, z); scene.add(num);
            W.colliders.push({ min: [x - 0.42, 0, z - 0.42], max: [x + 0.42, 0.775, z + 0.42] });
            W.tables.push({ x, z, zone: zoneBox(x - 0.55, 0.74, z - 0.55, x + 0.55, 1.4, z + 0.55) });
            for (const s of [-1, 1]) {
                const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), chairM); c.position.set(x + s * 0.78, 0.45, z); c.castShadow = true; scene.add(c);
                const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.4), chairM); b.position.set(x + s * 0.98, 0.7, z); b.castShadow = true; scene.add(b);
                W.seats.push({ idx: W.seats.length, x: x + s * 0.78, z, face: s > 0 ? -Math.PI / 2 : Math.PI / 2, table: ti, plate: new THREE.Vector3(x + s * 0.24, 0.8, z) });
            }
        });
        // the health inspector stands at the pass while inspecting
        W.inspector = makeDiner(0x7fd8ff, true);
        W.inspector.position.set(7.8, 0, -0.8); W.inspector.rotation.y = -Math.PI / 2; W.inspector.visible = false; scene.add(W.inspector);
    }
    // guests, the critic (gold ticket) and the health inspector (clipboard) are full characters from CF.Models
    function makeDiner(color, clipboard, critic) {
        return CF.Models.person({ color, inspector: !!clipboard, critic: !!critic });
    }
    W.makeDiner = makeDiner;
    // Saloon doors swing open when any chef is close
    W.updateDoors = (positions, dt) => {
        for (const d of W.doors) {
            let want = 0;
            for (const p of positions) {
                const dx = p.x - 7.1, dz = p.z - 3.9;
                if (Math.abs(dx) < 1.1 && Math.abs(dz) < 0.9) want = Math.max(want, (dx < 0 ? 1 : -1) * (1.1 - Math.abs(dx)) * 1.6);
            }
            d.a = CF.damp(d.a, CF.clamp(want, -1.3, 1.3), 8, dt);
            d.piv.rotation.y = d.a * d.s;
        }
    };

    // ---------- Particles ----------
    const P = []; let pIdx = 0;
    const PMAX = 420;
    function buildFx() {
        const blob = CF.Models.blobTex(), flame = CF.Models.flameTex();
        for (let i = 0; i < PMAX; i++) {
            const isFlame = i < 140;
            const m = new THREE.SpriteMaterial({ map: isFlame ? flame : blob, transparent: true, depthWrite: false, blending: isFlame ? THREE.AdditiveBlending : THREE.NormalBlending });
            const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 5; scene.add(s);
            P.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, s0: 0.1, s1: 0.2, a: 1, flame: isFlame });
        }
    }
    let fIdx = 0;
    function emit(flame, x, y, z, o) {
        let p;
        if (flame) { p = P[fIdx]; fIdx = (fIdx + 1) % 140; }
        else { p = P[140 + pIdx]; pIdx = (pIdx + 1) % (PMAX - 140); }
        p.s.position.set(x, y, z); p.s.visible = true;
        p.life = 0; p.max = o.life || 1;
        p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.g = o.g || 0;
        p.s0 = o.s0 || 0.08; p.s1 = o.s1 || 0.2; p.a = o.a === undefined ? 1 : o.a;
        p.s.material.color.set(o.c || 0xffffff);
        p.s.material.opacity = p.a;
    }
    W.fx = (kind, pos, n = 1, o = {}) => {
        const x = pos.x, y = pos.y, z = pos.z;
        if (W.fxScale < 1) n = Math.floor(n * W.fxScale + Math.random());     // fewer particles on Low
        for (let i = 0; i < n; i++) {
            switch (kind) {
                case 'flame': emit(true, x + CF.rand(-0.12, 0.12) * (o.r || 1), y + CF.rand(0, 0.05), z + CF.rand(-0.12, 0.12) * (o.r || 1), { vy: CF.rand(0.5, 1.1), life: CF.rand(0.35, 0.7), s0: 0.16 * (o.s || 1), s1: 0.05, c: 0xffffff }); break;
                case 'smoke': emit(false, x + CF.rand(-0.05, 0.05), y, z + CF.rand(-0.05, 0.05), { vx: CF.rand(-0.1, 0.1), vy: CF.rand(0.3, 0.6), vz: CF.rand(-0.1, 0.1), life: CF.rand(1.5, 2.6), s0: 0.08, s1: 0.6 * (o.s || 1), c: o.c || 0x3a3a3a, a: 0.45 }); break;
                case 'steam': emit(false, x + CF.rand(-0.08, 0.08), y, z + CF.rand(-0.08, 0.08), { vy: CF.rand(0.25, 0.5), vx: CF.rand(-0.05, 0.05), life: CF.rand(1, 1.6), s0: 0.05, s1: 0.3, c: 0xffffff, a: 0.25 }); break;
                case 'spark': emit(false, x, y, z, { vx: CF.rand(-1, 1), vy: CF.rand(1, 2.5), vz: CF.rand(-1, 1), g: -9, life: 0.4, s0: 0.03, s1: 0.01, c: 0xffd27a }); break;
                case 'foam': emit(false, x, y, z, { vx: (o.dx || 0) * CF.rand(3, 5) + CF.rand(-0.4, 0.4), vy: (o.dy || 0) * CF.rand(3, 5) + CF.rand(-0.2, 0.4), vz: (o.dz || 0) * CF.rand(3, 5) + CF.rand(-0.4, 0.4), g: -2, life: CF.rand(0.5, 0.9), s0: 0.05, s1: 0.35, c: 0xf4fbff, a: 0.8 }); break;
                case 'shard': emit(false, x, y, z, { vx: CF.rand(-2, 2), vy: CF.rand(1, 3), vz: CF.rand(-2, 2), g: -9.8, life: 0.7, s0: 0.05, s1: 0.04, c: 0xffffff }); break;
                case 'splash': emit(false, x, y, z, { vx: CF.rand(-1, 1), vy: CF.rand(1, 2.2), vz: CF.rand(-1, 1), g: -9.8, life: 0.6, s0: 0.05, s1: 0.03, c: o.c || 0x9fe0ff, a: 0.9 }); break;
                case 'salt': emit(false, x + CF.rand(-0.02, 0.02), y, z + CF.rand(-0.02, 0.02), { vy: -1.2, g: -4, life: 0.4, s0: 0.012, s1: 0.012, c: o.c || 0xffffff }); break;
                case 'poof': emit(false, x, y, z, { vx: CF.rand(-0.8, 0.8), vy: CF.rand(0.2, 1), vz: CF.rand(-0.8, 0.8), life: 0.6, s0: 0.1, s1: 0.35, c: o.c || 0xfff3c4, a: 0.8 }); break;
                case 'star': emit(false, x, y, z, { vx: CF.rand(-0.6, 0.6), vy: CF.rand(1, 2), vz: CF.rand(-0.6, 0.6), g: -3, life: 0.9, s0: 0.06, s1: 0.02, c: 0xffd166 }); break;
                case 'bubble': emit(false, x + CF.rand(-0.1, 0.1), y, z + CF.rand(-0.1, 0.1), { vy: 0.15, life: 0.35, s0: 0.02, s1: 0.05, c: o.c || 0xffffff, a: 0.7 }); break;
            }
        }
    };
    W.updateFx = dt => {
        for (const p of P) {
            if (!p.s.visible) continue;
            p.life += dt;
            if (p.life >= p.max) { p.s.visible = false; continue; }
            const t = p.life / p.max;
            p.vy += p.g * dt;
            p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
            if (p.s.position.y < 0.01 && p.g) { p.s.position.y = 0.01; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
            const sc = CF.lerp(p.s0, p.s1, t);
            p.s.scale.set(sc, p.flame ? sc * 1.6 : sc, 1);
            p.s.material.opacity = p.a * (p.flame ? 1 - t : (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85));
        }
    };

    // Main-menu camera: slow orbit over the kitchen
    W.menuCam = t => {
        const a = t * 0.06;
        camera.position.set(Math.cos(a) * 4.2, 2.6 + Math.sin(t * 0.2) * 0.2, Math.sin(a) * 3.2);
        camera.lookAt(0, 0.9, -0.5);
    };

    // Colliders the player can bump into (oven door excluded while open)
    W.solid = c => !(c.id === 'ovenDoor' && W.ovenDoorOpen);
    W.ovenDoorOpen = false;
    return W;
})();
