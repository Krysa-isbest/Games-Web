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
    let scene, camera, renderer, hemi, sun, fill, warm;
    const fireLights = [];

    W.init = (canvas) => {
        renderer = W.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(innerWidth, innerHeight);
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = CF.settings.shadows;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene = W.scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1b2430);
        camera = W.camera = new THREE.PerspectiveCamera(CF.settings.fov, innerWidth / innerHeight, 0.04, 80);
        camera.position.set(0, 1.7, 2);
        scene.add(camera);

        buildEnvironment();
        buildLights();
        buildKitchen();
        buildDining();
        buildFx();
        addEventListener('resize', () => {
            camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
            renderer.setSize(innerWidth, innerHeight);
        });
    };

    W.setShadows = on => { renderer.shadowMap.enabled = on; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); };
    W.render = () => renderer.render(scene, camera);

    // Reflections for steel: a soft studio-like environment baked with PMREM
    function buildEnvironment() {
        const env = new THREE.Scene();
        const box = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x8090a0, side: THREE.BackSide }));
        env.add(box);
        const panel = (c, x, y, z, w, h, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry || 0; env.add(m); };
        panel(0xffffff, 0, 4.8, 0, 12, 12); env.children[env.children.length - 1].rotation.x = Math.PI / 2;
        panel(0xffe2b8, -9, 2, 0, 8, 4, Math.PI / 2);
        panel(0x9fe7ff, 9, 2, 0, 8, 4, -Math.PI / 2);
        panel(0xffb3a7, 0, 2, -9, 8, 3);
        const pm = new THREE.PMREMGenerator(renderer);
        scene.environment = pm.fromScene(env, 0.03).texture;
        pm.dispose();
    }

    function buildLights() {
        hemi = new THREE.HemisphereLight(0xfff4e6, 0x5a6b78, 0.55); scene.add(hemi);
        sun = new THREE.DirectionalLight(0xfff1dc, 0.75);
        sun.position.set(3, 9, 4); sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const s = sun.shadow.camera; s.left = -9; s.right = 9; s.top = 7; s.bottom = -7; s.near = 1; s.far = 20;
        sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
        scene.add(sun); scene.add(sun.target);
        fill = new THREE.PointLight(0xffe0b0, 0.55, 14, 1.6); fill.position.set(0, 2.8, 0); scene.add(fill);
        warm = new THREE.PointLight(0xff9a5a, 0.5, 8, 1.8); warm.position.set(-1, 2.4, -4); scene.add(warm);
        const neon = new THREE.PointLight(0xff3d9a, 0.9, 9, 1.6); neon.position.set(9.5, 2.4, 0); scene.add(neon);
        for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff7a2a, 0, 6, 1.6); l.position.set(0, -50, 0); scene.add(l); fireLights.push(l); }
    }
    let blackout = false;
    W.setBlackout = on => {
        blackout = on;
        hemi.intensity = on ? 0.06 : 0.55; sun.intensity = on ? 0.02 : 0.75; fill.intensity = on ? 0 : 0.55;
        warm.intensity = on ? 0.15 : 0.5; warm.color.set(on ? 0xff2020 : 0xff9a5a);
        scene.background.set(on ? 0x050608 : 0x1b2430);
    };
    W.setFireLights = list => {
        for (let i = 0; i < fireLights.length; i++) {
            const f = list[i], l = fireLights[i];
            if (!f) { l.intensity = 0; l.position.y = -50; continue; }
            l.position.set(f.x, f.y + 0.4, f.z);
            l.intensity = (1.2 + Math.random() * 0.6) * Math.min(1.5, f.i);
        }
    };

    // ---------- Textures ----------
    const tex = CF.Models.canvasTex;
    function floorTex() {
        return tex(512, 512, (g, w, h) => {
            const n = 8, s = w / n;
            for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
                g.fillStyle = (x + y) % 2 ? '#f2eadb' : '#2a8c86';
                g.fillRect(x * s, y * s, s, s);
                g.fillStyle = 'rgba(0,0,0,0.04)'; for (let k = 0; k < 6; k++) g.fillRect(x * s + Math.random() * s, y * s + Math.random() * s, 3, 3);
            }
            g.strokeStyle = 'rgba(60,50,40,0.35)'; g.lineWidth = 2;
            for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
        }, [7, 5]);
    }
    function wallTex() {
        return tex(256, 256, (g, w, h) => {
            g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, w, h);
            const tw = 64, th = 32;
            for (let y = 0; y < h / th; y++) for (let x = -1; x < w / tw + 1; x++) {
                const ox = (y % 2) * tw / 2;
                const v = 240 + Math.floor(Math.random() * 10);
                g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
                g.fillRect(x * tw + ox + 2, y * th + 2, tw - 4, th - 4);
                g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x * tw + ox + 4, y * th + 4, tw - 12, 3);
            }
        }, [6, 3]);
    }
    function stripeTex() {
        return tex(256, 64, (g, w, h) => {
            g.fillStyle = '#ff6b5b'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#ffd166'; for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 32, h); g.lineTo(x + 16, h); g.fill(); }
        }, [8, 1]);
    }

    // ---------- Building helpers ----------
    const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {}));
    const MAT = {};
    function mats() {
        MAT.steel = CF.Models.mat.steel();
        MAT.counterTop = std(0xd5dbe0, { metalness: 0.75, roughness: 0.3 });
        MAT.cabinet = std(0x2ec4b6, { roughness: 0.55 });
        MAT.cabinetDark = std(0x1f8f86, { roughness: 0.55 });
        MAT.coral = std(0xff6b5b, { roughness: 0.5 });
        MAT.dark = std(0x23272b, { roughness: 0.5, metalness: 0.3 });
        MAT.wall = std(0xffffff, { map: wallTex(), roughness: 0.4 });
        MAT.floor = std(0xffffff, { map: floorTex(), roughness: 0.35, metalness: 0.05 });
        MAT.ceiling = std(0xece7de, { roughness: 0.9 });
        MAT.wood = CF.Models.mat.wood();
        MAT.stripe = std(0xffffff, { map: stripeTex(), roughness: 0.6 });
        MAT.glow = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
    }
    function box(w, h, d, mat, x, y, z, o = {}) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        m.castShadow = o.cast !== false; m.receiveShadow = true;
        scene.add(m);
        if (o.col !== false) W.colliders.push({ min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2], id: o.id, floor: o.floor });
        return m;
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
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), MAT.ceiling);
        ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2; scene.add(ceil);
        const wall = (w, h, d, x, y, z) => box(w, h, d, MAT.wall, x, y, z, { cast: false });
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
        const door = box(1.1, 2.3, 0.06, std(0x3d5a80, { roughness: 0.5 }), -5, 1.15, 5.12, { col: false });
        W.colliders.push({ min: [-5.9, 0, 4.98], max: [-4.4, 2.4, 5.2] });   // the closed back door: nobody (and nothing) falls out
        box(0.1, 0.04, 0.08, MAT.steel, -4.6, 1.1, 5.06, { col: false });
        const exit = box(0.5, 0.18, 0.04, new THREE.MeshBasicMaterial({ color: 0x29d37a }), -5, 2.55, 5.0, { col: false, cast: false });
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
            const flame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 5, 24), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0 }));
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
        box(3.2, 0.5, 1.0, MAT.steel, -0.75, 2.75, -4.55, { col: false });
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
        const oil = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.48), std(0xd9a12a, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 }));
        oil.rotation.x = -Math.PI / 2; oil.position.set(1.15, CH - 0.09, -4.69); scene.add(oil);
        const fswitch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), std(0x29d37a, { emissive: 0x000000 }));
        fswitch.position.set(1.15, CH - 0.12, -4.33); scene.add(fswitch); part(fswitch, 'fryer', 'switch');
        W.zones.fryer = zoneBox(fx0 + 0.12, CH - 0.24, -4.93, fx1 - 0.12, CH + 0.08, -4.45);
        W.fryer = { oil, sw: fswitch };
        counter(1.55, -5, 6.9, -4.35);
        // wall shelf over north counter
        box(3.5, 0.04, 0.3, MAT.wood, -4.6, 1.7, -4.85, { col: true });
        box(3.5, 0.04, 0.3, MAT.wood, 4.2, 1.7, -4.85, { col: true });

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
        const water = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.6 }));
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
        // spice shelf
        box(0.25, 0.03, 1.2, MAT.wood, -6.85, 1.45, 2.4, { col: true });
        W.zones.spices = [new THREE.Vector3(-6.85, 1.53, 2.15), new THREE.Vector3(-6.85, 1.53, 2.45), new THREE.Vector3(-6.85, 1.53, 2.75)];

        // ===== East: serving pass =====
        counter(6.35, -4.35, 7, -1.6, { front: 'x-' });
        counter(6.35, 1.6, 7, 3.1, { front: 'x-' });
        // pass shelf through the wall
        box(0.95, 0.06, 3.2, MAT.counterTop, 6.75, 1.0, 0, { col: true });
        box(0.6, CH - 0.06, 3.2, MAT.cabinetDark, 6.65, (CH - 0.06) / 2, 0, { col: true });
        const heat = box(0.6, 0.08, 3.0, std(0x3b3f44, { metalness: 0.5 }), 6.75, 2.2, 0, { col: false });
        for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.5), new THREE.MeshBasicMaterial({ color: 0xff8a50 })); l.position.set(6.75, 2.15, -1 + i); scene.add(l); }
        const passLight = new THREE.PointLight(0xffa060, 0.5, 2.5, 2); passLight.position.set(6.75, 1.9, 0); scene.add(passLight);
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
        // storage counter + shelves (pans, pots, starter food)
        counter(0.0, 4.35, 4.6, 5.0, { front: 'z-' });
        counter(4.6, 4.35, 6.35, 5.0, { front: 'z-', mat: MAT.coral });
        box(4.4, 0.04, 0.35, MAT.wood, 2.3, 1.55, 4.83, { col: true });
        box(1.7, 0.04, 0.35, MAT.wood, 5.5, 1.55, 4.83, { col: true });
        box(1.7, 0.04, 0.35, MAT.wood, 5.5, 2.0, 4.83, { col: true });
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
        // hanging lamps
        for (const [x, z] of [[-4, 0], [0, -2], [0, 2.5], [4, 0], [-4, -3], [4, -3]]) {
            const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5, 4), MAT.dark); cord.position.set(x, 2.95, z); scene.add(cord);
            const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 18, 1, true), std(0xff6b5b, { side: THREE.DoubleSide, roughness: 0.4 })); shade.position.set(x, 2.62, z); scene.add(shade);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), MAT.glow); bulb.position.set(x, 2.55, z); scene.add(bulb);
        }
        // grease puddle (event)
        W.grease = new THREE.Mesh(new THREE.CircleGeometry(1.3, 28), std(0x6b4f12, { roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75 }));
        W.grease.rotation.x = -Math.PI / 2; W.grease.position.set(-1.0, 0.006, -3.4); W.grease.visible = false; W.grease.receiveShadow = true; scene.add(W.grease);
        W.zones.grease = { x: -1.0, z: -3.4, r: 1.3 };
        // player spawn points
        W.spawns = [new THREE.Vector3(-2.5, 0, 2.2), new THREE.Vector3(2.5, 0, 2.2), new THREE.Vector3(-2.5, 0, -2.2), new THREE.Vector3(2.5, 0, -2.2)];
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
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 10), std(0xffffff, { map: CF.Models.woodTex(), roughness: 0.6 }));
        floor.material.map = floor.material.map.clone(); floor.material.map.repeat.set(4, 6); floor.material.map.wrapS = floor.material.map.wrapT = THREE.RepeatWrapping; floor.material.map.needsUpdate = true;
        floor.rotation.x = -Math.PI / 2; floor.position.set(10.7, 0, 0); floor.receiveShadow = true; scene.add(floor);
        const dw = std(0x3d2c5e, { roughness: 0.8 });
        box(0.2, 3.2, 10.4, dw, 14.3, 1.6, 0, { cast: false }); box(7.2, 3.2, 0.2, dw, 10.7, 1.6, -5.1, { cast: false }); box(7.2, 3.2, 0.2, dw, 10.7, 1.6, 5.1, { cast: false });
        // the kitchen wall seen from the dining side
        for (const [d, z] of [[3.4, -3.3], [1.7, 2.45], [0.7, 4.85]]) box(0.02, 3.2, d, dw, 7.21, 1.6, z, { col: false, cast: false });
        // guest entrance
        box(0.06, 2.3, 1.1, std(0x8a5f34, { roughness: 0.6 }), 14.18, 1.15, -4.0, { col: false });
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
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7, 10), std(0x2a1f40)); ceil.rotation.x = Math.PI / 2; ceil.position.set(10.7, 3.2, 0); scene.add(ceil);
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
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.75, 8), MAT.dark); leg.position.set(x, 0.375, z); scene.add(leg);
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
        const dl = new THREE.PointLight(0xffc48a, 0.8, 10, 1.5); dl.position.set(10.5, 2.8, 0); scene.add(dl);
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
