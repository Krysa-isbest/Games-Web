'use strict';
// Builds the two neighbouring cells (yours + a mirrored neighbour), the corridor, furniture,
// placement surfaces, the tunnel wall and lighting.
// On-screen key hint; shows the player's own key if they rebound it
PB.key = k => `<span class="k">${PB.Keys ? PB.Keys.hint(k) : k}</span>`;

PB.World = (() => {
    const W = { surfaces: {}, interactables: [], colliders: [], cells: {}, nightK: 0, area: 'cell' };
    const C = PB.C, H = 2.7;
    W.NEIGHBOUR_X = -3.4; // the neighbour cell is mirrored around this x, sharing the poster wall
    const COL = {
        wallLow: 0x4f8670, stripe: 0x2a5246, wallHigh: 0xb9ae92,
        corrLow: 0x435d7a, corrStripe: 0x26384f,
        ceil: 0x9a9486, metal: 0x51617a, bars: 0x3a4356, wood: 0xb4733f, woodD: 0x7b4a28, woodL: 0xd59a5f,
        mattress: 0xece4cf, blanket: 0xe8742a, porcelain: 0xf2f5f8, concrete: 0x8e8a84
    };
    let grad;
    const cache = {};

    W.mat = (color, o) => {
        const key = color + (o ? JSON.stringify(o) : '');
        if (!cache[key]) cache[key] = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: grad }, o || {}));
        return cache[key];
    };
    function mesh(geo, color, x, y, z, parent, o) {
        const m = new THREE.Mesh(geo, typeof color === 'object' ? color : W.mat(color, o));
        m.position.set(x, y, z);
        m.castShadow = true; m.receiveShadow = true;
        if (parent) parent.add(m);
        return m;
    }
    W.box = (w, h, d, color, x, y, z, parent, o) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z, parent, o);
    W.cyl = (rt, rb, h, color, x, y, z, parent, seg = 16, o) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, parent, o);
    W.sph = (r, color, x, y, z, parent, seg = 16, o) => mesh(new THREE.SphereGeometry(r, seg, Math.max(8, (seg * 0.75) | 0)), color, x, y, z, parent, o);
    W.grad = () => grad;

    W.canvasTex = (w, h, draw) => {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        draw(cv.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(cv);
        t.userData = { cv };
        return t;
    };

    W.interact = (obj, def) => { obj.userData.interact = def; W.interactables.push(obj); };

    // A grid that items can be placed on. Origin = grid corner, cols along local +x, rows along local +z.
    W.addSurface = (id, name, parent, x, y, z, cols, rows, o = {}) => {
        const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(cols * C, rows * C), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(cols * C / 2, 0.001, rows * C / 2);
        plane.userData.surface = id;
        g.add(plane);
        const pts = [];
        for (let i = 0; i <= cols; i++) pts.push(i * C, 0.004, 0, i * C, 0.004, rows * C);
        for (let j = 0; j <= rows; j++) pts.push(0, 0.004, j * C, cols * C, 0.004, j * C);
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
        lines.visible = false;
        g.add(lines);
        const s = { id, name, cols, rows, group: g, plane, lines, hidden: o.hidden || (() => false), accessible: o.accessible || (() => true) };
        W.surfaces[id] = s;
        return s;
    };
    W.accessiblePlanes = () => Object.values(W.surfaces).filter(s => s.accessible() && W.reachable(s.id)).map(s => s.plane);
    // Up to 4 players, one cell each, in a row along the walkway (west → east):  w_ | n_ | '' | e_
    // The host and the first guest live in the middle cells (two posters / tunnels each),
    // the 3rd and 4th player in the edge cells (one poster). Neighbours are mirror images.
    W.CELLS = ['', 'n_', 'e_', 'w_']; // co-op slot -> cell
    W.players = 1;                    // lobby size of the current game (1 = solo)
    W.cellOf = sid => sid.startsWith('hole') ? 'hole' : sid.startsWith('n_') ? 'n_' : sid.startsWith('e_') ? 'e_' : sid.startsWith('w_') ? 'w_' : '';
    W.cellAtX = x => x < -5.1 ? 'w_' : x < -1.7 ? 'n_' : x < 1.7 ? '' : 'e_';
    // a cell is lived in: solo/2 players use the middle two (Mumbles is the solo neighbour)
    W.cellUsed = c => W.CELLS.indexOf(c) < Math.max(2, W.players);

    // Tunnels between neighbouring cells. side 1 = the poster on a cell's local -x wall, side 2 = local +x wall.
    W.TUNNELS = [
        { id: 'hole', key: 'tunnel', a: '', b: 'n_', side: 1, x: -1.7, need: 1 },
        { id: 'hole_e', key: 'tunnelE', a: '', b: 'e_', side: 2, x: 1.7, need: 3 },
        { id: 'hole_w', key: 'tunnelW', a: 'n_', b: 'w_', side: 2, x: -5.1, need: 4 }
    ];
    W.tunnelOn = t => !!t && t.need <= Math.max(2, W.players);
    W.tunnelAt = (cell, side) => W.TUNNELS.find(t => t.side === side && (t.a === cell || t.b === cell)) || null;
    W.tunnelById = id => W.TUNNELS.find(t => t.id === id) || null;
    W.tunnelP = t => (PB.state && PB.state[t.key]) || 0;
    W.posterOf = (cell, side) => W.cells[cell].sides[side].poster;
    W.otherEnd = (t, cell) => t.a === cell ? t.b : t.a;
    // the tunnel a guard looking into this cell would see (poster up, hole started)
    W.exposedTunnel = cell => W.TUNNELS.find(t => W.tunnelOn(t) && (t.a === cell || t.b === cell)
        && W.posterOf(cell, t.side).lifted && W.tunnelP(t) > 0.01) || null;
    // can you crawl from one cell to another through finished tunnels?
    W.connected = (from, to) => {
        const seen = new Set([from]), todo = [from];
        while (todo.length) {
            const c = todo.shift();
            if (c === to) return true;
            W.TUNNELS.forEach(t => {
                if (!W.tunnelOn(t) || W.tunnelP(t) < 1 || (t.a !== c && t.b !== c)) return;
                const o = W.otherEnd(t, c);
                if (!seen.has(o)) { seen.add(o); todo.push(o); }
            });
        }
        return false;
    };
    W.setPlayers = n => {
        W.players = n;
        for (const k in W.cells) {
            const used = W.cellUsed(k);
            W.cells[k].light.visible = used; W.cells[k].lampLight.visible = used;
        }
    };
    // Which cell a 3D object belongs to (null = corridor / shared). Used so you can't reach through walls.
    W.cellOfObject = o => {
        while (o) {
            if (o.userData && o.userData.interact && o.userData.interact.cell !== undefined) return o.userData.interact.cell;
            for (const k in W.cells) if (W.cells[k].group === o) return k;
            o = o.parent;
        }
        return null;
    };
    W.reachable = sid => {
        const c = W.cellOf(sid);
        if (c !== 'hole') return c === PB.Player.cell;
        const t = W.tunnelById(sid);
        return !!t && (t.a === PB.Player.cell || t.b === PB.Player.cell);
    };
    // other places you can walk to (each is its own scene module with bounds / colliders / interactables)
    const areaMod = () => ({ canteen: PB.Lunch, workshop: PB.Workshop, yard: PB.Yard, kitchen: PB.Kitchen, escape: PB.Escape }[W.area]);
    W.areaBounds = () => W.area === 'cell' ? W.cells[PB.Player.cell].bounds : areaMod().bounds;
    W.areaColliders = () => W.area === 'cell' ? W.colliders : areaMod().colliders;
    W.areaInteractables = () => W.area === 'cell' ? W.interactables : areaMod().interactables;

    // ---------- Init ----------
    W.init = container => {
        const data = new Uint8Array([105, 105, 105, 185, 185, 185, 255, 255, 255]);
        grad = new THREE.DataTexture(data, 3, 1, THREE.RGBFormat);
        grad.minFilter = grad.magFilter = THREE.NearestFilter;
        grad.needsUpdate = true;

        const r = W.renderer = new THREE.WebGLRenderer({ antialias: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        r.setSize(innerWidth, innerHeight);
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(r.domElement);

        W.scene = new THREE.Scene();
        W.scene.background = new THREE.Color(0x0e0b14);
        W.activeScene = W.scene;
        W.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 80);
        W.camera.userData.holder = true;
        // The camera lives in a rig. On a desktop the rig stays at the origin; in VR the rig is
        // moved/turned so the headset's room space lines up with where the player stands.
        W.rig = new THREE.Group();
        W.rig.add(W.camera);
        W.scene.add(W.rig);
        addEventListener('resize', () => {
            W.camera.aspect = innerWidth / innerHeight;
            W.camera.updateProjectionMatrix();
            r.setSize(innerWidth, innerHeight);
        });

        buildLights();
        W.skyMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
        W.tubeMat = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xfff4d6, gradientMap: grad });
        buildCell('', 0, false, [1, 2]);
        buildCell('n_', W.NEIGHBOUR_X, true, [1, 2]);
        buildCell('e_', -W.NEIGHBOUR_X, true, [2]);       // mirror of '' across their shared +x wall
        buildCell('w_', 2 * W.NEIGHBOUR_X, false, [2]);   // mirror of n_ across their shared wall
        buildHole();
        buildCorridor();
        W.setPlayers(1);
    };

    function buildLights() {
        const s = W.scene;
        W.hemi = new THREE.HemisphereLight(0xfff3e0, 0x51476b, 0.7);
        s.add(W.hemi);
        W.sun = new THREE.DirectionalLight(0xfff0c8, 0.9);
        W.sun.position.set(0.1, 6.66, 5.9);
        W.sun.target.position.set(-1.7, 0, 0.2);
        W.sun.castShadow = true;
        W.sun.shadow.mapSize.set(2048, 2048);
        const sc = W.sun.shadow.camera;
        sc.left = -5.5; sc.right = 5.5; sc.top = 5; sc.bottom = -5; sc.near = 1; sc.far = 22;
        W.sun.shadow.bias = -0.0008;
        s.add(W.sun, W.sun.target);
        W.corrLights = [-8, 0, 8].map(x => { // the cell block hall
            const l = new THREE.PointLight(0xfff0d8, 0.6, 18, 1.8);
            l.position.set(x, 2.6, -9.5);
            s.add(l);
            return l;
        });
    }

    // Wall made of boxes so it can have holes and a two-tone paint job.
    function wall(parent, axis, face, out, a0, a1, holes = [], low = COL.wallLow, stripe = COL.stripe) {
        const thick = 0.2;
        const ys = [0, 1.05, 1.13, H], as = [a0, a1];
        holes.forEach(h => { ys.push(h.y0, h.y1); as.push(h.a0, h.a1); });
        const uy = [...new Set(ys)].sort((p, q) => p - q), ua = [...new Set(as)].sort((p, q) => p - q);
        const c = face + out * thick / 2;
        for (let i = 0; i < ua.length - 1; i++) {
            for (let j = 0; j < uy.length - 1; j++) {
                const am = (ua[i] + ua[i + 1]) / 2, ym = (uy[j] + uy[j + 1]) / 2;
                if (holes.some(h => am > h.a0 && am < h.a1 && ym > h.y0 && ym < h.y1)) continue;
                const col = ym < 1.05 ? low : ym < 1.13 ? stripe : COL.wallHigh;
                const len = ua[i + 1] - ua[i], hh = uy[j + 1] - uy[j];
                if (axis === 'x') W.box(thick, hh, len, col, c, ym, am, parent);
                else W.box(len, hh, thick, col, am, ym, c, parent);
            }
        }
    }

    function floorTex(base, line, rx, ry) {
        const t = W.canvasTex(256, 256, (g, w, h) => {
            g.fillStyle = base; g.fillRect(0, 0, w, h);
            for (let i = 0; i < 900; i++) {
                g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.07})`;
                g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
            }
            g.strokeStyle = line; g.lineWidth = 4;
            g.strokeRect(0, 0, w, h);
        });
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        return new THREE.MeshToonMaterial({ color: 0xffffff, map: t, gradientMap: grad });
    }
    W.floorTex = floorTex;

    // A textured plane that reads correctly even inside the mirrored neighbour cell
    function decal(cell, tex, w, h, x, y, z, rotY) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshToonMaterial({ map: tex, gradientMap: grad }));
        m.position.set(x, y, z); m.rotation.y = rotY;
        if (cell.mirror) m.scale.x = -1;
        cell.group.add(m);
        return m;
    }

    // =====================================================================
    // One cell (built in local coordinates; the neighbour is mirrored)
    // =====================================================================
    const HOLE = { z0: -1.0, z1: -0.6, y0: 0.75, y1: 1.3 };   // side 1 (-x wall, behind the bed end)
    const HOLE2 = { z0: -0.65, z1: -0.25, y0: 0.75, y1: 1.3 }; // side 2 (+x wall, between toilet and sink)
    W.HOLE = HOLE;
    W.HOLES = { 1: HOLE, 2: HOLE2 };

    function buildCell(prefix, ox, mirror, sides) {
        const g = new THREE.Group();
        g.position.x = ox;
        if (mirror) g.scale.x = -1;
        W.scene.add(g);
        const cell = {
            prefix, group: g, mirror, drawers: [], clog: 0,
            lamp: { on: false }, mattress: { lifted: false, t: 0 }, brick: { open: false, t: 0 },
            door: { t: 0 }, sides: {}
        };
        [1, 2].forEach(n => { cell.sides[n] = { n, sx: n === 1 ? -1 : 1, hole: W.HOLES[n], poster: { lifted: false, t: 0 }, real: sides.includes(n) }; });
        cell.poster = cell.sides[1].poster;  // (edge cells: a dummy that is never lifted)
        cell.poster2 = cell.sides[2].poster;
        W.cells[prefix] = cell;
        const wx = x => mirror ? ox - x : ox + x;
        const col = (x0, x1, z0, z1) => { const a = wx(x0), b = wx(x1); W.colliders.push({ x0: Math.min(a, b), x1: Math.max(a, b), z0, z1 }); };
        cell.bounds = { x0: Math.min(wx(-1.28), wx(1.28)), x1: Math.max(wx(-1.28), wx(1.28)), z0: -1.76, z1: 1.76 };
        cell.toWorld = (x, y, z) => new THREE.Vector3(wx(x), y, z);
        const id = s => prefix + s;

        // shell
        W.box(3.4, 0.1, 4.4, floorTex('#8a8f9b', '#6b707c', 6, 8), 0, -0.05, 0, g);
        W.box(3.4, 0.1, 4.4, COL.ceil, 0, H + 0.05, 0, g);
        W.box(0.9, 0.05, 0.14, COL.metal, 0, H - 0.03, 0, g);
        W.box(0.8, 0.04, 0.08, W.tubeMat, 0, H - 0.07, 0, g);
        cell.light = new THREE.PointLight(0xfff6e0, 0.5, 6, 2);
        cell.light.position.set(0, 2.45, 0);
        g.add(cell.light);

        wall(g, 'z', 2, 1, -1.7, 1.7, [{ a0: 0.15, a1: 0.65, y0: 2.0, y1: 2.45 }]);
        const holeOf = h => ({ a0: h.z0, a1: h.z1, y0: h.y0, y1: h.y1 });
        wall(g, 'x', -1.5, -1, -2, 2.2, sides.includes(1) ? [holeOf(HOLE)] : []);
        wall(g, 'x', 1.5, 1, -2, 2.2, [{ a0: 0.7, a1: 1.1, y0: 0.2, y1: 0.48 }].concat(sides.includes(2) ? [holeOf(HOLE2)] : []));

        // window
        const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), W.skyMat);
        sky.position.set(0.4, 2.22, 2.6); sky.rotation.y = Math.PI;
        g.add(sky);
        for (let i = 1; i <= 3; i++) W.cyl(0.015, 0.015, 0.45, COL.bars, 0.15 + i * 0.125, 2.225, 2.1, g, 8);

        sides.forEach(n => { buildPlug(cell, cell.sides[n]); buildPoster(cell, cell.sides[n], id); });
        buildBrick(cell, id);
        buildBars(cell, id, col);
        buildFurniture(cell, id, col);

        // a little basketball hoop on the wall for the rubber ball
        const hoop = new THREE.Group(); hoop.position.set(1.34, 2.0, -0.5); g.add(hoop);
        W.box(0.02, 0.34, 0.48, 0xffffff, 0.15, 0.13, 0, hoop);
        W.box(0.022, 0.12, 0.16, 0xe84a3a, 0.145, 0.06, 0, hoop).scale.set(1, 1, 1);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 24), W.mat(0xff7a1f));
        rim.rotation.x = Math.PI / 2; hoop.add(rim);
        W.box(0.04, 0.012, 0.02, 0xff7a1f, 0.12, 0, 0, hoop);
        const net = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.15, 12, 2, true),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 }));
        net.position.y = -0.075; hoop.add(net);
        cell.hoop = cell.toWorld(1.34, 2.0, -0.5);

        cell.calTex = W.canvasTex(256, 300, () => {});
        decal(cell, cell.calTex, 0.34, 0.4, 1.495, 1.6, 1.55, -Math.PI / 2);
        return cell;
    }

    // The concrete plug filling the tunnel hole. Its front face sinks as the tunnel progresses.
    function buildPlug(cell, sd) {
        const g = cell.group, H0 = sd.hole, sx = sd.sx;
        const plug = sd.plug = new THREE.Group();
        g.add(plug);
        const wid = H0.z1 - H0.z0, zc = (H0.z0 + H0.z1) / 2;
        // three paint bands so the wall looks untouched before digging
        sd.plugParts = [
            [H0.y0, 1.05, COL.wallLow], [1.05, 1.13, COL.stripe], [1.13, H0.y1, COL.wallHigh]
        ].map(([a, b, c]) => {
            const m = W.box(0.2, b - a, wid, c, 0, (a + b) / 2, zc, plug);
            m.userData.paint = c;
            return m;
        });
        // dark peephole through the remaining concrete
        sd.peep = W.cyl(0.06, 0.06, 0.42, 0x15111d, sx * 1.7, 1.02, zc, g, 14);
        sd.peep.rotation.z = Math.PI / 2;
        sd.peep.visible = false;
        // tunnel lining (visible once the plug starts sinking)
        W.box(0.42, 0.02, wid, COL.concrete, sx * 1.71, H0.y0 - 0.01, zc, g);
        W.interact(plug, {
            id: cell.prefix + 'plug' + (sd.n === 2 ? '2' : ''),
            prompt: () => {
                const t = W.tunnelAt(cell.prefix, sd.n);
                if (!W.tunnelOn(t) || !sd.poster.lifted || PB.World.area !== 'cell') return null;
                const p = W.tunnelP(t);
                if (p >= 1) return `${PB.key('E')} Crawl through the tunnel`;
                const spoon = PB.Player.held && PB.Player.held.type === 'spoon';
                return spoon ? `${PB.key('E')} Dig with the spoon (${Math.round(p * 100)}%)` : `Hold a spoon to dig (${Math.round(p * 100)}%)`;
            },
            use: () => PB.Tunnel.action(cell.prefix, sd.n)
        });
    }

    function buildPoster(cell, sd, id) {
        const zc = (sd.hole.z0 + sd.hole.z1) / 2;
        const tex = W.canvasTex(256, 360, (g, w, h) => {
            const sky = g.createLinearGradient(0, 0, 0, h);
            sky.addColorStop(0, '#ff7e5f'); sky.addColorStop(0.55, '#feb47b'); sky.addColorStop(0.56, '#2bb3c0'); sky.addColorStop(1, '#127a8a');
            g.fillStyle = sky; g.fillRect(0, 0, w, h);
            g.fillStyle = '#fff3a0'; g.beginPath(); g.arc(w / 2, h * 0.5, 50, Math.PI, 0); g.fill();
            g.fillStyle = '#3b2a1a'; g.fillRect(40, 130, 10, 120);
            g.fillStyle = '#2f7d32';
            for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(45, 130, 50, 12, i * 0.7 - 1.4, 0, Math.PI * 2); g.fill(); }
            g.fillStyle = '#fff'; g.strokeStyle = '#221a2e'; g.lineWidth = 6;
            g.font = 'bold 54px Impact, sans-serif'; g.textAlign = 'center';
            g.strokeText('FREEDOM', w / 2, 70); g.fillText('FREEDOM', w / 2, 70);
            g.font = 'bold 22px sans-serif'; g.fillStyle = '#221a2e';
            g.fillText('wish you were here', w / 2, h - 24);
            g.strokeRect(3, 3, w - 6, h - 6);
        });
        // hinged at the top edge so it swings up and away from the wall
        const pivot = sd.pivot = new THREE.Group();
        pivot.position.set(sd.sx * 1.492, 1.4, zc);
        cell.group.add(pivot);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshToonMaterial({ map: tex, gradientMap: grad, side: THREE.DoubleSide }));
        m.position.set(0, -0.35, 0); m.rotation.y = -sd.sx * Math.PI / 2;
        if (cell.mirror) m.scale.x = -1;
        pivot.add(m);
        if (sd.n === 1) cell.posterPivot = pivot;
        W.interact(pivot, {
            id: id(sd.n === 2 ? 'poster2' : 'poster'), net: true,
            prompt: () => W.tunnelOn(W.tunnelAt(cell.prefix, sd.n)) ? `${PB.key('F')} ${sd.poster.lifted ? 'Put the poster back' : 'Lift the poster'}` : null,
            use: () => togglePoster(cell, sd),
            alt: () => togglePoster(cell, sd)
        });
    }
    function togglePoster(cell, sd) {
        if (!W.tunnelOn(W.tunnelAt(cell.prefix, sd.n))) return;
        sd.poster.lifted = !sd.poster.lifted;
        PB.Audio.play('paper');
    }

    function buildBrick(cell, id) {
        const g = cell.group;
        W.box(0.02, 0.3, 0.42, 0x2a2228, 1.69, 0.34, 0.9, g);
        W.box(0.2, 0.02, 0.4, 0x3a3038, 1.6, 0.2, 0.9, g);
        const cover = cell.brickCover = new THREE.Group();
        cover.position.set(1.53, 0.34, 0.9);
        g.add(cover);
        W.box(0.06, 0.13, 0.4, 0x5a9480, 0, 0.068, 0, cover);
        W.box(0.06, 0.13, 0.4, 0x66a68f, 0, -0.068, 0, cover);
        W.addSurface(id('brick'), 'Loose brick', g, 1.5, 0.211, 0.7, 2, 4, {
            hidden: () => !cell.brick.open,
            accessible: () => cell.brick.open && cell.brick.t > 0.7
        });
        W.interact(cover, {
            id: id('brick'), net: true,
            prompt: () => PB.state.upgrades.brick ? `${PB.key('E')} ${cell.brick.open ? 'Close' : 'Open'} loose brick` : null,
            use: () => { if (!PB.state.upgrades.brick) return; cell.brick.open = !cell.brick.open; PB.Audio.play('drawer', { vol: 0.6 }); }
        });
    }

    function buildBars(cell, id, col) {
        const g = cell.group, geo = new THREE.CylinderGeometry(0.018, 0.018, 1, 8), m = W.mat(COL.bars);
        const door = cell.doorGroup = new THREE.Group();
        g.add(door);
        const bar = (parent, x, y0, y1) => {
            const b = new THREE.Mesh(geo, m);
            b.scale.y = y1 - y0; b.position.set(x, (y0 + y1) / 2, -2);
            b.castShadow = true; parent.add(b);
        };
        for (let x = -1.44; x <= 1.45; x += 0.12) {
            if (x > 0.42 && x < 1.38) bar(door, x, 0.02, H - 0.1);
            else if (x > -1.24 && x < -0.56) { bar(g, x, 0, 0.92); bar(g, x, 1.16, H); }
            else bar(g, x, 0, H);
        }
        W.box(3, 0.06, 0.06, COL.bars, 0, 0.04, -2, g);
        W.box(3, 0.08, 0.08, COL.bars, 0, H - 0.05, -2, g);
        W.box(0.96, 0.05, 0.05, COL.bars, 0.9, 1.7, -2, door);
        W.box(1.6, 0.05, 0.05, COL.bars, -0.7, 1.7, -2, g);
        W.box(0.07, H, 0.07, COL.bars, 0.4, H / 2, -2, g);
        W.box(0.07, H, 0.07, COL.bars, 1.4, H / 2, -2, g);
        W.box(0.12, 0.18, 0.1, 0x2c3242, 0.47, 1.05, -2, door);
        W.box(0.03, 0.05, 0.11, 0xc9a43a, 0.47, 1.03, -2, door);
        // The cell door: lunch, the workshop shift, or (at night, with a fake key) the great escape
        const hasKey = () => PB.Player.heldItems().some(i => i.type === 'fakekey');
        // 3-4 players: Vinnie can't reach every cell at once, so you whistle him over to your bars
        const canWhistle = () => W.players > 2 && PB.NPC.trader.state === 'present' && PB.NPC.traderAt() !== cell.prefix;
        W.interact(door, {
            id: id('door'),
            prompt: () => {
                const s = PB.state;
                if (PB.World.area !== 'cell') return null;
                const wh = canWhistle() ? `   ${PB.key('F')} Whistle for Vinnie 🎵` : '';
                if (s.kitchenOpen) return `${PB.key('E')} Go to kitchen duty 🍳` + wh;
                if (s.lunchOpen) return `${PB.key('E')} Go to lunch 🍽️` + wh;
                if (s.yardOpen) return `${PB.key('E')} Go out to the yard 🏀` + wh;
                if (s.workshopOpen && PB.Workshop.allowed()) return `${PB.key('E')} Go to your workshop shift 🪚` + wh;
                if (s.phase === 'night' && hasKey()) return `${PB.key('E')} Unlock the door with the fake key 🔑`;
                return wh ? wh.trim() : null;
            },
            use: () => {
                const s = PB.state;
                if (s.kitchenOpen) PB.Kitchen.enter();
                else if (s.lunchOpen) PB.Lunch.enter();
                else if (s.yardOpen) PB.Yard.enter();
                else if (s.workshopOpen && PB.Workshop.allowed()) PB.Workshop.enter();
                else if (s.phase === 'night' && hasKey()) PB.Game.escape();
            },
            alt: () => {
                if (!canWhistle()) return;
                PB.Audio.play('whistle');
                if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'whistle', cell: cell.prefix });
                else PB.NPC.callTrader(cell.prefix);
            }
        });
        // trade slot on the left of the bars
        W.box(0.7, 0.05, 0.05, COL.bars, -0.9, 1.17, -2, g);
        W.box(0.7, 0.05, 0.05, COL.bars, -0.9, 0.9, -2, g);
        W.box(0.62, 0.02, 0.66, COL.metal, -0.9, 0.955, -1.975, g);
        W.box(0.62, 0.04, 0.02, COL.metal, -0.9, 0.975, -1.645, g);
        W.addSurface(id('tray'), 'Trade slot', g, -1.2, 0.966, -1.95, 6, 3);
    }

    function buildFurniture(cell, id, col) {
        const g = cell.group;

        // ----- Bed -----
        const bed = new THREE.Group(); g.add(bed);
        [[-1.46, 0.13], [-0.74, 0.13], [-1.46, 1.97], [-0.74, 1.97]].forEach(([x, z]) => W.box(0.05, 0.36, 0.05, COL.metal, x, 0.18, z, bed));
        W.box(0.8, 0.06, 0.05, COL.metal, -1.1, 0.35, 0.13, bed);
        W.box(0.8, 0.06, 0.05, COL.metal, -1.1, 0.35, 1.97, bed);
        W.box(0.05, 0.06, 1.88, COL.metal, -1.46, 0.35, 1.05, bed);
        W.box(0.05, 0.06, 1.88, COL.metal, -0.74, 0.35, 1.05, bed);
        W.box(0.72, 0.02, 1.82, COL.woodD, -1.1, 0.39, 1.05, bed);
        W.box(0.8, 0.35, 0.04, COL.metal, -1.1, 0.62, 1.99, bed);
        const piv = cell.mattressPivot = new THREE.Group();
        piv.position.set(-1.47, 0.4, 1.05);
        bed.add(piv);
        W.box(0.74, 0.14, 1.84, COL.mattress, 0.37, 0.07, 0, piv);
        W.box(0.76, 0.03, 1.2, cell.mirror ? 0x3d7bff : COL.blanket, 0.37, 0.155, -0.3, piv);
        W.box(0.76, 0.03, 0.12, 0xf5f0e6, 0.37, 0.16, 0.33, piv);
        const pillow = W.sph(0.2, 0xffffff, 0.37, 0.19, 0.7, piv);
        pillow.scale.set(1.25, 0.35, 0.7);
        W.addSurface(id('mattress'), 'Under the mattress', g, -1.4, 0.4, 0.55, 6, 9, {
            hidden: () => !cell.mattress.lifted,
            accessible: () => cell.mattress.lifted && cell.mattress.t > 0.7
        });
        W.interact(bed, {
            id: id('bed'), net: true,
            prompt: () => {
                const s = PB.state;
                const what = s.phase !== 'day' ? 'Sleep until morning' : s.time < PB.Game.LUNCH_FROM ? 'Nap until lunch' : 'Sleep until night';
                let p = `${PB.key('E')} ${what}`;
                if (PB.state.upgrades.mattress) p += `   ${PB.key('F')} ${cell.mattress.lifted ? 'Lower' : 'Lift'} mattress`;
                return p;
            },
            use: () => PB.Game.sleep(),
            alt: () => {
                if (!PB.state.upgrades.mattress) return;
                cell.mattress.lifted = !cell.mattress.lifted;
                PB.Audio.play('drawer', { vol: 0.5 });
            }
        });
        col(-1.6, -0.68, 0.08, 2.1);

        // ----- Desk with drawers -----
        const top = W.box(1.04, 0.05, 0.62, COL.wood, 0.4, 0.78, 1.7, g);
        W.box(0.05, 0.76, 0.05, COL.woodD, -0.07, 0.38, 1.43, g);
        W.box(0.05, 0.76, 0.05, COL.woodD, -0.07, 0.38, 1.97, g);
        W.box(0.02, 0.76, 0.6, COL.woodD, 0.44, 0.38, 1.7, g);
        W.box(0.02, 0.76, 0.6, COL.woodD, 0.91, 0.38, 1.7, g);
        W.box(0.47, 0.76, 0.02, COL.woodD, 0.675, 0.38, 1.99, g);
        W.box(0.47, 0.24, 0.02, COL.wood, 0.675, 0.12, 1.41, g);
        W.addSurface(id('desk'), 'Desk', g, -0.1, 0.805, 1.4, 10, 6);
        W.interact(top, {
            id: id('desk'),
            prompt: () => PB.state.phase === 'night' ? `${PB.key('E')} Craft at desk` : 'Crafting only at night',
            use: () => {
                if (PB.state.phase === 'night') PB.UI.openCraft();
                else { PB.Audio.play('bad'); PB.UI.toast('Too risky in daylight. Craft at night!', 'bad'); }
            }
        });
        col(-0.12, 0.93, 1.38, 2.1);

        // VR only: a big red CRAFT button sticking out of the front of the desk
        const cb = cell.craftBtn = new THREE.Group();
        cb.position.set(0.0, 0.74, 1.35); g.add(cb);
        W.box(0.14, 0.06, 0.1, 0x3a3550, 0, 0.03, 0, cb);
        cell.craftCap = W.cyl(0.035, 0.04, 0.03, 0xe84a3a, 0, 0.075, 0, cb, 16); // pushed down by a VR finger
        const lbl = W.canvasTex(256, 96, (cx, w, h) => {
            cx.fillStyle = '#ffd23f'; cx.fillRect(0, 0, w, h);
            cx.fillStyle = '#221a2e'; cx.font = 'bold 64px Impact, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
            cx.fillText('CRAFT', w / 2, h / 2 + 4);
        });
        const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.05), new THREE.MeshBasicMaterial({ map: lbl }));
        lm.position.set(0, 0.03, -0.051); lm.rotation.y = Math.PI;
        if (cell.mirror) lm.scale.x = -1;
        cb.add(lm);
        cb.visible = false;
        W.interact(cb, {
            id: id('craftbtn'),
            prompt: () => PB.VR.isOn() ? 'Press to craft' : null,
            use: () => { PB.Audio.play('click'); PB.UI.openCraft(); }
        });

        const makeDrawer = (did, name, y) => {
            const dg = new THREE.Group(); dg.position.set(0.455, y, 1.42); g.add(dg);
            W.box(0.43, 0.015, 0.53, COL.woodL, 0.215, 0.0075, 0.265, dg);
            W.box(0.015, 0.14, 0.53, COL.woodL, 0.0075, 0.07, 0.265, dg);
            W.box(0.015, 0.14, 0.53, COL.woodL, 0.4225, 0.07, 0.265, dg);
            W.box(0.43, 0.14, 0.015, COL.woodL, 0.215, 0.07, 0.52, dg);
            const front = W.box(0.45, 0.2, 0.025, COL.wood, 0.215, 0.1, -0.0125, dg);
            W.box(0.12, 0.025, 0.03, COL.metal, 0.215, 0.12, -0.04, dg);
            const d = { id: did, name, group: dg, open: false, t: 0, z0: 1.42 };
            cell.drawers.push(d);
            W.addSurface(did, name, dg, 0.015, 0.016, 0.03, 4, 5, { hidden: () => d.t < 0.15, accessible: () => d.t > 0.7 });
            W.interact(front, {
                id: did, net: true,
                prompt: () => `${PB.key('E')} ${d.open ? 'Close' : 'Open'} ${name.toLowerCase()}`,
                use: () => { d.open = !d.open; PB.Audio.play('drawer'); }
            });
        };
        makeDrawer(id('drawerTop'), 'Top drawer', 0.53);
        makeDrawer(id('drawerBot'), 'Bottom drawer', 0.28);

        // ----- Shelf -----
        W.box(1.0, 0.03, 0.22, COL.wood, 0.4, 1.46, 1.89, g);
        W.box(0.03, 0.12, 0.2, COL.metal, -0.05, 1.39, 1.9, g);
        W.box(0.03, 0.12, 0.2, COL.metal, 0.85, 1.39, 1.9, g);
        W.addSurface(id('shelf'), 'Shelf', g, -0.1, 1.475, 1.8, 10, 2);

        // ----- Wall lamp -----
        const lamp = new THREE.Group(); lamp.position.set(1.12, 1.55, 1.95); g.add(lamp);
        W.box(0.06, 0.06, 0.12, COL.metal, 0, 0.05, 0.02, lamp);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.1, 0.12, 16, 1, true), W.mat(0x3e7a5e, { side: THREE.DoubleSide }));
        shade.position.set(0, -0.02, -0.1); lamp.add(shade);
        cell.bulbMat = new THREE.MeshToonMaterial({ color: 0xfff2b0, emissive: 0x000000, gradientMap: grad });
        W.sph(0.035, cell.bulbMat, 0, -0.07, -0.1, lamp, 12);
        cell.lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.16, 16, 1, true), W.mat(0x2b2b38, { side: THREE.DoubleSide }));
        cell.lampShade.position.set(0, -0.06, -0.1); cell.lampShade.visible = false; lamp.add(cell.lampShade);
        cell.lampLight = new THREE.PointLight(0xffb45c, 0, 5, 2);
        cell.lampLight.position.set(1.12, 1.4, 1.8);
        if (!cell.mirror) { cell.lampLight.castShadow = true; cell.lampLight.shadow.mapSize.set(512, 512); cell.lampLight.shadow.bias = -0.002; }
        g.add(cell.lampLight);
        W.interact(lamp, {
            id: id('lamp'), net: true,
            prompt: () => `${PB.key('E')} Turn lamp ${cell.lamp.on ? 'off' : 'on'}`,
            use: () => { cell.lamp.on = !cell.lamp.on; PB.Audio.play('lamp'); }
        });

        // ----- Toilet -----
        const toilet = new THREE.Group(); g.add(toilet);
        W.cyl(0.13, 0.11, 0.36, COL.porcelain, 1.22, 0.18, -1.05, toilet);
        W.cyl(0.2, 0.15, 0.12, COL.porcelain, 1.2, 0.41, -1.05, toilet);
        cell.waterMesh = W.cyl(0.15, 0.15, 0.02, 0x4aa6c9, 1.2, 0.46, -1.05, toilet);
        W.cyl(0.21, 0.21, 0.025, 0xdadfe5, 1.2, 0.48, -1.05, toilet);
        W.box(0.18, 0.34, 0.42, COL.porcelain, 1.4, 0.64, -1.05, toilet);
        W.box(0.2, 0.03, 0.44, 0xdadfe5, 1.4, 0.82, -1.05, toilet);
        W.box(0.04, 0.02, 0.08, COL.metal, 1.3, 0.75, -1.2, toilet);
        W.cyl(0.05, 0.05, 0.1, 0xffffff, 1.4, 0.89, -0.9, toilet, 12);
        W.interact(toilet, {
            id: id('toilet'),
            prompt: () => {
                const h = PB.Player.held;
                if (cell.clogged) return '🚽 Clogged! Wait a bit…';
                return h ? `${PB.key('E')} Flush ${PB.ITEMS[h.type].name}` : `${PB.key('E')} Flush`;
            },
            use: () => PB.Player.flushHeld()
        });
        col(0.96, 1.6, -1.32, -0.78);

        // ----- Sink + mirror -----
        const sink = new THREE.Group(); g.add(sink);
        W.cyl(0.05, 0.07, 0.72, COL.porcelain, 1.36, 0.36, 0.1, sink);
        W.box(0.32, 0.12, 0.42, COL.porcelain, 1.33, 0.8, 0.1, sink);
        W.box(0.24, 0.02, 0.32, 0x8fb8c9, 1.32, 0.86, 0.1, sink);
        W.cyl(0.015, 0.015, 0.14, COL.metal, 1.45, 0.92, 0.1, sink, 8);
        W.box(0.1, 0.02, 0.02, COL.metal, 1.41, 0.98, 0.1, sink);
        W.cyl(0.035, 0.03, 0.09, 0xd9d9e0, 1.42, 0.91, 0.27, sink, 10);
        W.box(0.02, 0.52, 0.4, COL.metal, 1.495, 1.42, 0.1, g);
        W.box(0.02, 0.46, 0.34, new THREE.MeshPhongMaterial({ color: 0xcfeeff, shininess: 120 }), 1.485, 1.42, 0.1, g);
        W.interact(sink, {
            id: id('sink'),
            prompt: () => `${PB.key('E')} Drink some water`,
            use: () => { PB.Audio.play('flush', { vol: 0.35 }); PB.UI.toast('Refreshing. Tastes like pipes.'); }
        });
        col(1.1, 1.6, -0.15, 0.35);

        // ----- Stool -----
        W.cyl(0.16, 0.16, 0.04, COL.wood, -0.4, 0.46, 1.55, g);
        [0, 2.1, 4.2].forEach(a => W.cyl(0.015, 0.02, 0.45, COL.metal, -0.4 + Math.cos(a) * 0.1, 0.22, 1.55 + Math.sin(a) * 0.1, g, 6));
        col(-0.58, -0.22, 1.37, 1.73);

        // ----- Floor safe (upgrade): a steel plate in the floor between the bars and the bed -----
        cell.safe = { open: false, t: 0 };
        const owned = () => !!(PB.state && PB.state.upgrades.safe);
        const safe = cell.safeGroup = new THREE.Group(); safe.position.set(-1.05, 0, -1.25); g.add(safe);
        W.box(0.46, 0.006, 0.46, 0x2a2d36, 0, 0.003, 0, safe);                     // rim
        cell.safeHole = W.box(0.4, 0.004, 0.4, new THREE.MeshBasicMaterial({ color: 0x0c0b10 }), 0, 0.006, 0, safe);
        const lid = cell.safeLid = new THREE.Group(); lid.position.set(0, 0.008, 0.2); safe.add(lid); // hinged at the wall side
        W.box(0.4, 0.012, 0.4, 0x7d8494, 0, 0.006, -0.2, lid);
        W.cyl(0.04, 0.04, 0.012, 0x3a3f4a, 0, 0.016, -0.2, lid, 14);
        W.box(0.06, 0.008, 0.012, 0xc9a43a, 0, 0.024, -0.2, lid);
        W.addSurface(id('safe'), 'Floor safe', g, -1.25, 0.01, -1.45, 4, 4, {
            hidden: () => !owned() || !cell.safe.open,
            accessible: () => owned() && cell.safe.open && cell.safe.t > 0.7
        });
        W.interact(lid, {
            id: id('safe'), net: true,
            prompt: () => owned() ? `${PB.key('E')} ${cell.safe.open ? 'Close' : 'Open'} floor safe` : null,
            use: () => { if (!owned()) return; cell.safe.open = !cell.safe.open; PB.Audio.play('clang', { vol: 0.5 }); }
        });

        // ----- Floor -----
        W.addSurface(id('floor'), 'Floor', g, -0.6, 0.0, -1.6, 16, 26);
        col(-2, 2, -2.3, -1.95);
    }

    // Shared shelf inside each tunnel for passing items (world space, between the two cells)
    function buildHole() {
        W.TUNNELS.forEach(t => {
            const H0 = W.HOLES[t.side];
            W.addSurface(t.id, 'Tunnel', W.scene, t.x - 0.2, H0.y0, H0.z0, 4, 4, {
                hidden: () => !W.tunnelOn(t) || (!W.posterOf(t.a, t.side).lifted && !W.posterOf(t.b, t.side).lifted),
                accessible: () => {
                    const c = PB.Player.cell;
                    if (!W.tunnelOn(t) || W.tunnelP(t) < 0.6 || (c !== t.a && c !== t.b)) return false;
                    const p = W.posterOf(c, t.side);
                    return p.lifted && p.t > 0.7;
                }
            });
        });
    }

    // The cell block. Your two cells are on the UPPER floor: in front of them runs a metal walkway
    // that goes all the way around an open atrium (with a safety net), past every cell. The ground
    // floor is one storey below. Guards come through the door at the east end and walk the whole
    // walkway loop, so you can watch them coming from across the atrium.
    const LOW = -3.2, TOP = 3.4, ZF = -17;
    W.HALL = {
        door: { x: 14.3, z: -2.9 },
        loop: [[-14.2, -2.9], [-14.2, -16.2], [14.2, -16.2], [14.2, -2.9]] // walked after checking our cells
    };
    function buildCorridor() {
        const s = W.scene;
        const dark = new THREE.MeshBasicMaterial({ color: 0x110e17 });
        // metal grating for the walkways
        const grate = W.canvasTex(128, 128, (g, w) => {
            g.fillStyle = '#5c6474'; g.fillRect(0, 0, w, w);
            g.fillStyle = '#3a404c';
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.fillRect(x * 16 + 3, y * 16 + 3, 10, 10);
        });
        grate.wrapS = grate.wrapT = THREE.RepeatWrapping; grate.repeat.set(30, 2);
        const grateMat = new THREE.MeshToonMaterial({ map: grate, gradientMap: grad });
        const grate2 = grate.clone(); grate2.needsUpdate = true; grate2.repeat.set(2, 12);
        const grateMat2 = new THREE.MeshToonMaterial({ map: grate2, gradientMap: grad });
        // walkways: our side, far side, and the two ends
        W.box(30.2, 0.15, 1.7, grateMat, 0, -0.075, -2.85, s);
        W.box(30.2, 0.15, 1.7, grateMat, 0, -0.075, ZF + 0.85, s);
        W.box(1.6, 0.15, 11.6, grateMat2, -14.3, -0.075, -9.5, s);
        W.box(1.6, 0.15, 11.6, grateMat2, 14.3, -0.075, -9.5, s);
        W.box(30, 0.006, 0.07, 0xe8c33a, 0, 0.004, -2.35, s);
        // walkway undersides / steel beams
        [-2.85, ZF + 0.85].forEach(z => W.box(30.2, 0.25, 0.12, COL.metal, 0, -0.27, z - 0.8, s));

        // the atrium: ground floor below, ceiling above, safety net in between
        W.box(30.4, 0.1, 15.2, floorTex('#8f8a80', '#76726a', 15, 8), 0, LOW - 0.05, -9.5, s);
        W.box(30.4, 0.1, 15.2, COL.ceil, 0, TOP + 0.05, -9.5, s);
        const netTex = W.canvasTex(64, 64, (g, w) => { g.clearRect(0, 0, w, w); g.strokeStyle = 'rgba(30,30,36,.9)'; g.lineWidth = 3; g.strokeRect(0, 0, w, w); });
        netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.repeat.set(50, 23);
        const net = new THREE.Mesh(new THREE.PlaneGeometry(25.3, 11.6), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        net.rotation.x = -Math.PI / 2; net.position.set(-0.75, -0.55, -9.5); s.add(net);
        // ceiling beams and pipes
        for (let x = -12; x <= 12; x += 4) W.box(0.25, 0.3, 15, COL.metal, x, TOP - 0.15, -9.5, s);
        [-4.2, -14.8].forEach(z => { const p = W.cyl(0.06, 0.06, 30, 0x7a6a5a, 0, TOP - 0.45, z, s, 8); p.rotation.z = Math.PI / 2; });

        // walls (two-tone, full height from the ground floor to the ceiling)
        const tall = (w, d, x, z, y0, y1) => {
            const lowTop = y0 + 1.1;
            W.box(w, 1.1, d, COL.corrLow, x, y0 + 0.55, z, s);
            W.box(w, 0.08, d, COL.corrStripe, x, lowTop + 0.04, z, s);
            W.box(w, y1 - lowTop - 0.08, d, COL.wallHigh, x, (lowTop + 0.08 + y1) / 2, z, s);
        };
        tall(30.4, 0.2, 0, ZF - 0.1, LOW, TOP);
        tall(0.2, 15.4, -15.2, -9.5, LOW, TOP);
        tall(0.2, 15.4, 15.2, -9.5, LOW, TOP);
        tall(30.4, 0.2, 0, -1.9, LOW, 0);                 // below our walkway
        tall(6.7, 0.2, -11.85, -1.9, 0, TOP);              // our floor, next to the four player cells
        tall(10.1, 0.2, 10.15, -1.9, 0, TOP);
        W.box(13.6, TOP - H, 0.2, COL.wallHigh, -1.7, H + (TOP - H) / 2, -1.9, s); // above the player cells

        // background cells: a dark opening with bars (all bars share one instanced mesh) + a number plate
        const barPos = [];
        let plateNo = 10; // C-06 / C-07 are ours
        const plate = (x, y, z, face, txt) => {
            const t = W.canvasTex(128, 48, g => { g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, 128, 48); g.fillStyle = '#221a2e'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 26); });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), new THREE.MeshToonMaterial({ map: t, gradientMap: grad }));
            m.position.set(x, y, z + face * 0.02); if (face < 0) m.rotation.y = Math.PI; s.add(m);
        };
        const fakeCell = (x, y, z, face) => {
            const d = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.3), dark);
            d.position.set(x, y + 1.15, z + face * 0.01);
            if (face < 0) d.rotation.y = Math.PI;
            s.add(d);
            for (let bx = x - 1.04; bx <= x + 1.05; bx += 0.13) barPos.push([bx, y + 1.15, z + face * 0.05]);
            W.box(2.4, 0.08, 0.08, COL.bars, x, y + 2.32, z + face * 0.05, s);
            W.box(2.4, 0.06, 0.08, COL.bars, x, y + 0.03, z + face * 0.05, s);
            plate(x, y + 2.6, z, face, 'C-' + String(plateNo++).padStart(2, '0'));
        };
        [-12.5, 8.6, 12.6].forEach(x => fakeCell(x, 0, -2, -1));                            // our floor
        [-12.5, -8.5, -4.5, -0.5, 3.5, 7.5, 11.5].forEach(x => fakeCell(x, LOW, -2, -1));  // below us
        [-12, -8, -4, 0, 4, 8, 12].forEach(x => fakeCell(x, 0, ZF, 1));                     // across the atrium
        [-12, -8, -4, 0, 4, 8, 12].forEach(x => fakeCell(x, LOW, ZF, 1));                   // across, below
        [[-6.8, 'C-05'], [-3.4, 'C-06'], [0, 'C-07'], [3.4, 'C-08']].forEach(([x, n]) => plate(x, 2.9, -2, -1, n)); // the player cells
        const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 2.3, 6), W.mat(COL.bars), barPos.length);
        const dm = new THREE.Object3D();
        barPos.forEach((p, i) => { dm.position.set(p[0], p[1], p[2]); dm.updateMatrix(); bars.setMatrixAt(i, dm.matrix); });
        s.add(bars);

        // round railings around the atrium (posts share one instanced mesh)
        const posts = [];
        const rail = (x0, z0, x1, z1) => {
            const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 1.2);
            for (let i = 0; i <= n; i++) posts.push([PB.lerp(x0, x1, i / n), PB.lerp(z0, z1, i / n)]);
            [1.05, 0.55].forEach(y => {
                const r = W.cyl(y > 1 ? 0.03 : 0.018, y > 1 ? 0.03 : 0.018, len, COL.bars, (x0 + x1) / 2, y, (z0 + z1) / 2, s, 8);
                r.rotation.z = Math.PI / 2; r.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
            });
        };
        rail(-13.5, -3.7, 13.5, -3.7);
        rail(-13.5, ZF + 1.7, 13.5, ZF + 1.7);
        rail(-13.5, -3.7, -13.5, ZF + 1.7);
        rail(13.5, -3.7, 13.5, -8.5);
        rail(13.5, -13.8, 13.5, ZF + 1.7);
        // stairs down to the ground floor (hang off the east walkway, inside the atrium)
        for (let i = 0; i < 12; i++) W.box(1.2, 0.27, 0.4, 0x6a7380, 12.8, -0.135 - i * 0.27, -9.1 - i * 0.4, s);
        rail(12.15, -8.9, 12.15, -13.8);
        const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1.05, 6), W.mat(COL.bars), posts.length);
        posts.forEach((p, i) => { dm.position.set(p[0], 0.525, p[1]); dm.updateMatrix(); pm.setMatrixAt(i, dm.matrix); });
        s.add(pm);

        // the guard door at the east end of our walkway
        const door = new THREE.Group(); door.position.set(15.08, 0, W.HALL.door.z); s.add(door);
        W.box(0.12, 2.5, 1.4, 0x5a6a86, 0, 1.25, 0, door);
        W.box(0.13, 0.35, 0.5, 0x1b1f2a, 0, 1.8, 0, door);
        W.box(0.2, 0.12, 1.7, 0xe84a3a, 0, 2.6, 0, door);
        const sign = W.canvasTex(512, 160, (g, w, h) => {
            g.fillStyle = '#f3d23a'; g.fillRect(0, 0, w, h);
            g.strokeStyle = '#221a2e'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
            g.fillStyle = '#221a2e'; g.textAlign = 'center';
            g.font = 'bold 64px Impact, sans-serif'; g.fillText('CELL BLOCK C', w / 2, 76);
            g.font = 'bold 30px sans-serif'; g.fillText('LUNCH 12:00 · WORKSHOP 14:00 · LIGHTS OUT 22:00', w / 2, 130);
        });
        const sm = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), new THREE.MeshToonMaterial({ map: sign, gradientMap: grad }));
        sm.position.set(0, 2.85, ZF + 0.02);
        s.add(sm);

        // ground floor: tables and benches
        [-6, 0, 6].forEach(x => {
            W.box(2.6, 0.06, 0.9, 0xb8b0a0, x, LOW + 0.75, -9.5, s);
            W.box(0.12, 0.72, 0.5, 0x5a6270, x, LOW + 0.36, -9.5, s);
            [-0.7, 0.7].forEach(dz => W.box(2.6, 0.06, 0.32, 0x6f7a8c, x, LOW + 0.45, -9.5 + dz, s));
        });

        // hanging fluorescent lights over the atrium + caged wall lamps + security cameras
        W.fixMat = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xe8f0ff, gradientMap: grad });
        [-8, 0, 8].forEach(x => [-6.5, -12.5].forEach(z => {
            [-0.5, 0.5].forEach(dx => W.cyl(0.006, 0.006, 0.6, 0x222222, x + dx, TOP - 0.3, z, s, 4));
            W.box(1.3, 0.07, 0.25, COL.metal, x, TOP - 0.62, z, s);
            W.box(1.2, 0.04, 0.16, W.fixMat, x, TOP - 0.67, z, s);
        }));
        [-10, -5, 5, 10].forEach(x => { // caged lamps on the far wall
            W.sph(0.07, W.fixMat, x, 2.4, ZF + 0.12, s, 8);
            W.cyl(0.09, 0.09, 0.16, COL.bars, x, 2.4, ZF + 0.12, s, 6).material = W.mat(COL.bars, { wireframe: true });
        });
        [[-14.9, -2.3, 0.6], [14.9, -16.5, -2.5]].forEach(([x, z, ry]) => { // cameras
            const cam = new THREE.Group(); cam.position.set(x, 3.0, z); cam.rotation.y = ry; s.add(cam);
            W.box(0.12, 0.12, 0.3, 0xdddddd, 0, 0, 0.15, cam).rotation.x = 0.4;
            W.cyl(0.04, 0.04, 0.03, 0x111111, 0, -0.06, 0.31, cam, 8).rotation.x = Math.PI / 2 + 0.4;
        });
    }

    W.setDay = n => {
        Object.values(W.cells).forEach(cell => {
            const cv = cell.calTex.userData.cv, g = cv.getContext('2d');
            g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 256, 300);
            g.fillStyle = '#e84a3a'; g.fillRect(0, 0, 256, 70);
            g.fillStyle = '#fff'; g.font = 'bold 42px sans-serif'; g.textAlign = 'center';
            g.fillText('DAY', 128, 52);
            g.fillStyle = '#221a2e'; g.font = 'bold 110px sans-serif';
            g.fillText(String(n), 128, 190);
            g.strokeStyle = '#221a2e'; g.lineWidth = 4;
            const tally = Math.min(n - 1, 20);
            for (let i = 0; i < tally; i++) {
                const grp = Math.floor(i / 5), k = i % 5, x = 30 + grp * 55;
                g.beginPath();
                if (k < 4) { g.moveTo(x + k * 10, 220); g.lineTo(x + k * 10, 280); }
                else { g.moveTo(x - 6, 270); g.lineTo(x + 38, 230); }
                g.stroke();
            }
            g.strokeRect(2, 2, 252, 296);
            cell.calTex.needsUpdate = true;
        });
    };

    // ---------- Per-frame ----------
    // Daytime is dim on purpose: a grey concrete block lit by a small window and old tubes.
    const dayC = { hemi: new THREE.Color(0xe8e0d0), sun: new THREE.Color(0xf0e2c0), sky: new THREE.Color(0x8ab8d6) };
    const nightC = { hemi: new THREE.Color(0x5a6aa8), sun: new THREE.Color(0x8fa8ff), sky: new THREE.Color(0x141a3a) };
    const concreteMat = () => W.mat(COL.concrete);

    W.update = dt => {
        const s = PB.state;
        const night = s && s.phase === 'night' ? 1 : 0;
        const k = W.nightK = PB.damp(W.nightK, night, 2, dt);
        W.hemi.intensity = PB.lerp(0.42, 0.15, k);
        W.hemi.color.copy(dayC.hemi).lerp(nightC.hemi, k);
        W.sun.intensity = PB.lerp(0.55, 0.2, k);
        W.sun.color.copy(dayC.sun).lerp(nightC.sun, k);
        W.skyMat.color.copy(dayC.sky).lerp(nightC.sky, k);
        W.tubeMat.emissive.setScalar(PB.lerp(0.55, 0.05, k));
        W.corrLights.forEach(l => { l.intensity = PB.lerp(0.55, 0.25, k); });
        W.fixMat.emissive.setScalar(PB.lerp(0.6, 0.3, k));

        // solo: the neighbour keeps his poster in sync with yours
        if (s && !PB.Coop.active) W.cells.n_.poster.lifted = W.cells[''].poster.lifted;

        const vr = PB.VR.isOn();
        for (const cell of Object.values(W.cells)) {
            cell.craftBtn.visible = vr;
            cell.light.intensity = PB.lerp(0.32, 0, k);
            const shade = !!(s && s.upgrades.shade);
            cell.lampShade.visible = shade;
            cell.lampLight.intensity = PB.damp(cell.lampLight.intensity, cell.lamp.on ? (shade ? 0.75 : 1.1) : 0, 14, dt);
            cell.bulbMat.emissive.setRGB(cell.lamp.on ? 1 : 0, cell.lamp.on ? 0.8 : 0, cell.lamp.on ? 0.45 : 0);
            cell.drawers.forEach(d => {
                if (d.drag) return; // a VR hand is pulling it
                d.t = PB.damp(d.t, d.open ? 1 : 0, 12, dt);
                d.group.position.z = d.z0 - d.t * 0.4;
            });
            cell.mattress.t = PB.damp(cell.mattress.t, cell.mattress.lifted ? 1 : 0, 9, dt);
            cell.mattressPivot.rotation.z = cell.mattress.t * 1.05;
            cell.brick.t = PB.damp(cell.brick.t, cell.brick.open ? 1 : 0, 9, dt);
            cell.brickCover.position.set(1.53 - cell.brick.t * 0.2, 0.34 - cell.brick.t * 0.19, 0.9 + cell.brick.t * 0.35);
            cell.brickCover.rotation.y = cell.brick.t * 0.5;
            for (const n of [1, 2]) {
                const sd = cell.sides[n];
                if (!sd.real) continue;
                const t = W.tunnelAt(cell.prefix, n), on = W.tunnelOn(t), p = on ? W.tunnelP(t) : 0;
                if (!on) sd.poster.lifted = false;
                sd.pivot.visible = on;
                if (!sd.drag) sd.poster.t = PB.damp(sd.poster.t, sd.poster.lifted ? 1 : 0, 9, dt); // a VR hand may be swinging it
                sd.pivot.rotation.z = -sd.sx * sd.poster.t * 1.45; // swings out into the room, away from the wall
                // tunnel plug sinks into the wall as the tunnel grows (both sides look dug)
                const recess = Math.min(0.2, p * 0.2);
                sd.plug.visible = p < 1;
                sd.plug.scale.x = Math.max(0.001, (0.2 - recess) / 0.2);
                sd.plug.position.x = sd.sx * (1.6 + recess / 2);
                sd.plugParts.forEach(m => { m.material = p > 0 ? concreteMat() : W.mat(m.userData.paint); });
                sd.peep.visible = p >= 0.6 && p < 1;
            }
            const hasSafe = !!(s && s.upgrades.safe);
            cell.safeGroup.visible = hasSafe;
            cell.safe.t = PB.damp(cell.safe.t, cell.safe.open && hasSafe ? 1 : 0, 9, dt);
            cell.safeLid.rotation.x = cell.safe.t * 1.6;
            W.surfaces[cell.prefix + 'safe'].group.visible = cell.safe.t > 0.05; // what's inside sits "below" the floor
            const doorOpen = s && (s.lunchOpen || s.yardOpen || s.kitchenOpen || (s.workshopOpen && PB.Workshop.allowed()));
            cell.door.t = PB.damp(cell.door.t, doorOpen ? 1 : 0, 3, dt);
            cell.doorGroup.position.set(cell.door.t * 0.95, 0, -cell.door.t * 0.08);
            cell.waterMesh.material = W.mat(cell.clogged ? 0x6b5a3a : 0x4aa6c9);
        }
    };

    W.closeAll = () => {
        Object.values(W.cells).forEach(cell => {
            cell.drawers.forEach(d => { d.open = false; });
            cell.mattress.lifted = false;
            cell.brick.open = false;
            cell.poster.lifted = false; cell.poster2.lifted = false; cell.safe.open = false;
            cell.lamp.on = false;
            cell.clog = 0; cell.clogged = false;
        });
    };

    W.render = () => W.renderer.render(W.activeScene, W.camera);

    return W;
})();
