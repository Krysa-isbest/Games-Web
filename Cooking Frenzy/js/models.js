'use strict';
// Procedural models: food, dishes, cookware, tools, the chefs, the guests and the rat, plus shared textures.
// Contract with items.js (keep it):
//  - every item group is centred on its physics body (CF.ITEMS[type].shape)
//  - userData.tint: materials recoloured by doneness (Items.refresh overwrites their colour)
//  - userData.sides: { top, bottom } materials for two-sided food
//  - userData.top: local height where contents sit (containers)
//  - userData.ceramic: meshes whose material is swapped clean/dirty · userData.liquid: the pot's water/soup
//  - userData.lift: how far the visual sits below the body centre so it rests on surfaces (layouts add it back)
//  - userData.onState(s, c): optional, called by Items.refresh after recolouring (sear marks, melting cheese...)
CF.Models = (() => {
    const M = {};
    const cache = {};
    const shared = (key, make) => cache[key] || (cache[key] = make());
    const PI = Math.PI, TAU = Math.PI * 2;
    const R = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

    // ---------- noise ----------
    function hash(x, y, z, s) {
        let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
        return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
    }
    function noise3(x, y, z, s) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        const xf = x - xi, yf = y - yi, zf = z - zi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
        const c = (i, j, k) => hash(xi + i, yi + j, zi + k, s);
        const x00 = mix(c(0, 0, 0), c(1, 0, 0), u), x10 = mix(c(0, 1, 0), c(1, 1, 0), u);
        const x01 = mix(c(0, 0, 1), c(1, 0, 1), u), x11 = mix(c(0, 1, 1), c(1, 1, 1), u);
        return mix(mix(x00, x10, v), mix(x01, x11, v), w);
    }
    function fbm(x, y, z, s, oct) {
        let a = 0.5, f = 1, t = 0, n = 0;
        for (let i = 0; i < (oct || 3); i++) { t += a * noise3(x * f, y * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.07; }
        return t / n;
    }
    // tileable 2D noise: u, v in 0..1, fx / fy whole numbers of cells
    function pnoise(x, y, px, py, s) {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const m = (a, p) => ((a % p) + p) % p;
        const c = (i, j) => hash(m(xi + i, px), m(yi + j, py), 0, s);
        return mix(mix(c(0, 0), c(1, 0), u), mix(c(0, 1), c(1, 1), u), v);
    }
    function pfbm(u, v, fx, fy, s, oct) {
        let a = 0.5, t = 0, n = 0;
        for (let i = 0; i < (oct || 4); i++) { const k = 1 << i; t += a * pnoise(u * fx * k, v * fy * k, fx * k, fy * k, s + i * 17); n += a; a *= 0.5; }
        return t / n;
    }
    // tileable cellular noise: [nearest distance, cell id, second distance] (distances in cell units)
    function worley(u, v, nx, ny, s) {
        const x = u * nx, y = v * ny, xi = Math.floor(x), yi = Math.floor(y);
        let d1 = 9, d2 = 9, id = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const cx = xi + i, cy = yi + j, wx = ((cx % nx) + nx) % nx, wy = ((cy % ny) + ny) % ny;
            const dx = cx + hash(wx, wy, 1, s) - x, dy = cy + hash(wx, wy, 2, s) - y, d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; id = hash(wx, wy, 3, s); } else if (d < d2) d2 = d;
        }
        return [d1, id, d2];
    }

    // ---------- textures ----------
    M.canvasTex = (w, h, draw, repeat) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 4;
        if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
        return t;
    };
    // per-pixel procedural texture, cached by key. fn(u, v, out) writes 0..255 into out[0..3].
    // Detail maps that multiply a doneness tint are linear (no sRGB decode), colour maps are sRGB.
    function pixTex(key, w, h, fn, o) {
        o = o || {};
        return shared('px-' + key, () => {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data, out = [0, 0, 0, 255];
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                out[3] = 255;
                fn((x + 0.5) / w, 1 - (y + 0.5) / h, out);
                const i = (y * w + x) * 4;
                d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
            }
            g.putImageData(img, 0, 0);
            const t = new THREE.CanvasTexture(c);
            t.encoding = o.srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
            t.anisotropy = 4;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
            return t;
        });
    }
    const b255 = v => Math.round(clamp(v, 0, 1) * 255);
    const gray = (o, v) => { o[0] = o[1] = o[2] = b255(v); };
    const rgb = (o, r, g, b) => { o[0] = b255(r); o[1] = b255(g); o[2] = b255(b); };
    const T = {};
    T.fine = () => pixTex('fine', 128, 128, (u, v, o) => gray(o, pfbm(u, v, 16, 16, 5, 3)));
    T.bumpy = () => pixTex('bumpy', 128, 128, (u, v, o) => gray(o, pfbm(u, v, 6, 6, 6, 4)));
    T.skinTom = () => pixTex('skinTom', 128, 64, (u, v, o) => gray(o, (0.92 + 0.08 * pfbm(u, v, 8, 4, 7, 3)) * (1 - 0.16 * smooth(0.82, 1, v))));
    T.tomFace = () => pixTex('tomFace', 256, 256, (u, v, o) => {
        const x = u * 2 - 1, y = v * 2 - 1, r = Math.hypot(x, y), a = Math.atan2(y, x);
        const sect = TAU / 4, local = Math.abs((((a + PI / 4) % sect) + sect) % sect - sect / 2);
        const width = 0.44 * Math.sin(clamp((r - 0.2) / 0.62, 0, 1) * PI);
        const jelly = smooth(width + 0.05, width - 0.05, local) * smooth(0.18, 0.26, r) * smooth(0.84, 0.78, r);
        let b = mix(0.82, 1.0, jelly);
        b = mix(b, 0.95, smooth(0.24, 0.16, r));                 // pale core
        b = mix(b, 0.86, smooth(0.8, 0.86, r));                  // outer wall
        b = mix(b, 0.66, smooth(0.92, 0.96, r));                 // skin rim
        gray(o, b * (0.94 + 0.06 * fbm(u * 9, v * 9, 0, 11, 3)));
    });
    T.crumb = () => pixTex('crumb', 256, 256, (u, v, o) => {
        const a = worley(u, v, 13, 13, 21)[0], b = worley(u, v, 31, 31, 22)[0];
        let val = 0.98 - 0.3 * smooth(0.3, 0.1, a) - 0.2 * smooth(0.32, 0.12, b);
        gray(o, val * (0.94 + 0.06 * pfbm(u, v, 8, 8, 23, 2)));
    });
    T.meat = () => pixTex('meat', 256, 256, (u, v, o) => {
        const [d1, id, d2] = worley(u, v, 24, 24, 31);
        let b = 0.7 + 0.24 * smooth(0.0, 0.45, d2 - d1);
        if (id > 0.84) b += 0.14 * smooth(0.35, 0.1, d1);        // white fat specks
        gray(o, b * (0.9 + 0.1 * pfbm(u, v, 6, 6, 33, 3)));
    });
    T.marble = () => pixTex('marble', 256, 256, (u, v, o) => {
        const w = pfbm(u, v, 3, 3, 41, 4);
        const line = Math.abs(Math.sin((u * 3 + v * 1 + w * 2.6) * PI * 4));
        const streak = smooth(0.2, 0.0, line) * smooth(0.3, 0.6, pfbm(u, v, 5, 5, 42, 3));
        const fleck = smooth(0.11, 0.03, worley(u, v, 24, 24, 43)[0]) * 0.8;
        gray(o, (0.72 + 0.4 * Math.max(streak, fleck)) * (0.95 + 0.05 * pfbm(u, v, 12, 12, 44, 2)));
    });
    T.cheese = () => pixTex('cheese', 256, 256, (u, v, o) => {
        const [d, id] = worley(u, v, 5, 5, 51);
        const rad = 0.1 + id * 0.17;
        let b = 0.97 + 0.03 * pfbm(u, v, 10, 10, 52, 2);
        if (id > 0.3) { const t = d / rad; b = mix(b, 0.7 + 0.14 * t, smooth(1.05, 0.95, t)); b = mix(b, 1, smooth(0.8, 0.97, t) * smooth(1.08, 0.97, t) * 0.8); }
        gray(o, b);
    });
    T.cheeseBump = () => pixTex('cheeseBump', 256, 256, (u, v, o) => {
        const [d, id] = worley(u, v, 5, 5, 51);
        const rad = 0.1 + id * 0.17;
        gray(o, id > 0.3 ? 0.5 + 0.5 * smooth(0.6, 1.0, d / rad) : 1);
    });
    T.onion = () => pixTex('onion', 256, 128, (u, v, o) => {
        const s = pfbm(u, v * 0.15, 36, 1, 61, 3);
        gray(o, (0.8 + 0.22 * s) * (0.95 + 0.05 * pfbm(u, v, 8, 4, 62, 3)));
    });
    T.potato = () => pixTex('potato', 256, 128, (u, v, o) => {
        let b = 0.82 + 0.16 * pfbm(u, v, 6, 3, 71, 4);
        b -= 0.26 * smooth(0.13, 0.04, worley(u, v, 26, 13, 72)[0]);
        gray(o, b);
    });
    T.leaf = () => pixTex('leaf', 128, 256, (u, v, o) => {     // u across the leaf (rib at 0.5), v from stem to tip
        const x = Math.abs(u - 0.5) * 2;
        const rib = smooth(0.07 * (1 - v * 0.6), 0.0, x);
        const f = (((v * 7 - x * 1.7) % 1) + 1) % 1, side = Math.abs(f - 0.5) * 2;
        const vein = smooth(0.86, 1.0, side) * (1 - x) * 0.7;
        let b = 0.8 + 0.2 * Math.max(rib, vein) + 0.07 * (pfbm(u, v, 4, 8, 81, 3) - 0.5);
        gray(o, b + 0.08 * (1 - v));
    });
    T.flour = () => pixTex('flour', 128, 64, (u, v, o) => {
        let b = 0.9 + 0.06 * pfbm(u, v, 6, 3, 91, 3);
        if (hash(Math.floor(u * 64), Math.floor(v * 32), 0, 92) > 0.94) b = 1;
        gray(o, b);
    });
    T.crust = () => pixTex('crust', 256, 64, (u, v, o) => {
        let b = 0.86 + 0.14 * pfbm(u, v, 12, 3, 101, 3);
        const [d, id] = worley(u, v, 24, 6, 102);
        if (id > 0.62) b = mix(b, 0.55, smooth(0.28, 0.12, d));
        gray(o, b);
    });
    T.sauce = () => pixTex('sauce', 256, 256, (u, v, o) => {
        const n = pfbm(u, v, 5, 5, 111, 4);
        let r = 0.66 + 0.22 * n, g = 0.1 + 0.07 * n, b = 0.05 + 0.03 * n;
        const h = hash(Math.floor(u * 110), Math.floor(v * 110), 0, 112);
        if (h > 0.982) { r = 0.16; g = 0.26; b = 0.07; } else if (h > 0.975) { r = 0.08; g = 0.06; b = 0.04; }
        rgb(o, r, g, b);
    }, { srgb: true });
    T.salami = () => pixTex('salami', 128, 128, (u, v, o) => {
        const [d, id] = worley(u, v, 9, 9, 121);
        let b = 0.78 + 0.08 * pfbm(u, v, 6, 6, 122, 2);
        if (id > 0.55) b = mix(b, 1, smooth(0.34, 0.24, d));
        if (worley(u, v, 13, 13, 123)[0] < 0.09) b = 0.22;
        gray(o, b);
    });
    T.salamiSkin = () => pixTex('salamiSkin', 128, 128, (u, v, o) => {
        let b = 0.78 + 0.18 * pfbm(u, v, 8, 8, 124, 4);
        b = mix(b, 1, smooth(0.6, 0.75, pfbm(u, v, 5, 5, 125, 3)) * 0.6);   // dusty white bloom
        gray(o, b);
    });
    T.mushroom = () => pixTex('mushroom', 128, 256, (u, v, o) => {    // lathe: v 0 = under the cap by the stem, ~0.42 = rim, 1 = top
        let b;
        if (v < 0.4) { const g = Math.abs(Math.sin(u * PI * 90)); b = 0.62 + 0.18 * smooth(0.0, 0.4, v) - 0.14 * smooth(0.7, 1, g); }
        else b = 0.96 - 0.2 * smooth(0.58, 0.72, pfbm(u, v, 10, 5, 131, 3)) + 0.04 * pfbm(u, v, 20, 10, 132, 2) - 0.08 * smooth(0.9, 1, v);
        gray(o, b);
    });
    T.brushed = () => pixTex('brushed', 8, 512, (u, v, o) => gray(o, 0.22 + 0.2 * (noise3(0, v * 700, 0, 141) * 0.6 + noise3(0, v * 90, 0, 142) * 0.4)));
    T.stains = () => pixTex('stains', 256, 256, (u, v, o) => {
        const n = pfbm(u, v, 3, 3, 151, 4), m = pfbm(u, v, 7, 7, 152, 3);
        let r = 0.93, g = 0.9, b = 0.84;
        const sauce = smooth(0.6, 0.66, n) * 0.9, grease = smooth(0.56, 0.6, m) * 0.45;
        r = mix(r, 0.5, sauce); g = mix(g, 0.27, sauce); b = mix(b, 0.14, sauce);
        r = mix(r, 0.76, grease); g = mix(g, 0.66, grease); b = mix(b, 0.46, grease);
        if (hash(Math.floor(u * 90), Math.floor(v * 90), 0, 153) > 0.972) { r = 0.42; g = 0.27; b = 0.14; }
        rgb(o, r, g, b);
    }, { srgb: true });
    T.wire = () => pixTex('wire', 64, 64, (u, v, o) => {
        const gx = Math.abs(((u * 8) % 1) - 0.5), gy = Math.abs(((v * 8) % 1) - 0.5);
        o[0] = o[1] = o[2] = 205;
        o[3] = gx > 0.36 || gy > 0.36 ? 255 : 0;
    }, { srgb: true });
    T.plank = () => pixTex('plank', 256, 128, (u, v, o) => {
        const w = pfbm(u, v, 2, 4, 161, 3);
        const grain = 0.5 + 0.5 * Math.sin((v * 14 + w * 5) * PI);
        let k = (0.9 + 0.1 * pfbm(u, v, 16, 4, 162, 2)) * (0.92 + 0.08 * grain);
        const knot = worley(u, v, 3, 2, 163);
        if (knot[1] > 0.75) k *= 1 - 0.3 * smooth(0.2, 0.05, knot[0]);
        rgb(o, 0.8 * k, 0.6 * k, 0.37 * k);
    }, { srgb: true });
    T.check = () => pixTex('check', 64, 64, (u, v, o) => {     // small houndstooth-ish chef check
        const x = (u * 8) % 1, y = (v * 8) % 1, a = Math.floor(u * 8) % 2, b = Math.floor(v * 8) % 2;
        let on = a ^ b;
        if (!on && x + y > 1.55) on = 1;
        if (on && x + y < 0.45) on = 0;
        gray(o, on ? 0.12 : 0.88);
    }, { srgb: true, repeat: [3, 4] });
    T.weave = () => pixTex('weave', 64, 64, (u, v, o) => gray(o, 0.5 + 0.22 * Math.sin(u * TAU * 16) * Math.sin(v * TAU * 16) + 0.12 * pfbm(u, v, 8, 8, 171, 2)));
    T.knit = () => pixTex('knit', 64, 64, (u, v, o) => gray(o, 0.45 + 0.4 * Math.abs(Math.sin(u * PI * 24 + Math.abs(Math.sin(v * PI * 12)) * 1.2))));
    T.embers = () => pixTex('embers', 128, 128, (u, v, o) => {
        const [d1, , d2] = worley(u, v, 6, 6, 181);
        const glow = smooth(0.09, 0.0, d2 - d1) * (0.45 + 0.55 * pfbm(u, v, 4, 4, 182, 2));
        rgb(o, glow, glow * 0.33, glow * 0.07);
    }, { srgb: true });
    T.fur = () => pixTex('fur', 128, 128, (u, v, o) => gray(o, 0.55 + 0.45 * pfbm(u, v * 0.3, 40, 3, 191, 3)));
    T.soup = () => pixTex('soup', 128, 128, (u, v, o) => {
        const x = u * 2 - 1, y = v * 2 - 1, r = Math.hypot(x, y), a = Math.atan2(y, x);
        const swirl = 0.5 + 0.5 * Math.sin(a * 2 + r * 9 + pfbm(u, v, 4, 4, 201, 3) * 3);
        gray(o, 0.9 + 0.1 * swirl);
    });

    // ---------- geometry helpers ----------
    const V3 = THREE.Vector3;
    const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new V3(), _s = new V3();
    function mtx(x, y, z, rx, ry, rz, sx, sy, sz) {
        sx = sx === undefined ? 1 : sx;
        return new THREE.Matrix4().compose(_p.set(x || 0, y || 0, z || 0), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
    }
    // average the normals of vertices that share a position (hides UV seams on smooth shapes)
    function weld(geo, from, to) {
        const p = geo.attributes.position, n = geo.attributes.normal, map = new Map();
        from = from || 0; to = to === undefined ? p.count : to;
        for (let i = from; i < to; i++) {
            const key = Math.round(p.getX(i) * 1e5) + '_' + Math.round(p.getY(i) * 1e5) + '_' + Math.round(p.getZ(i) * 1e5);
            let e = map.get(key);
            if (!e) map.set(key, e = [0, 0, 0, []]);
            e[0] += n.getX(i); e[1] += n.getY(i); e[2] += n.getZ(i); e[3].push(i);
        }
        for (const e of map.values()) {
            const l = Math.hypot(e[0], e[1], e[2]) || 1;
            for (const i of e[3]) n.setXYZ(i, e[0] / l, e[1] / l, e[2] / l);
        }
        n.needsUpdate = true;
        return geo;
    }
    // move every vertex with f(v) (in place), then rebuild smooth normals
    function displace(geo, f) {
        const p = geo.attributes.position, v = new V3();
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); f(v, i); p.setXYZ(i, v.x, v.y, v.z); }
        p.needsUpdate = true;
        geo.computeVertexNormals();
        return weld(geo);
    }
    function vcolor(geo, f) {      // per-vertex colour multiplier from f(x, y, z) -> [r, g, b]
        const p = geo.attributes.position, c = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { const k = f(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = k[0]; c[i * 3 + 1] = k[1]; c[i * 3 + 2] = k[2]; }
        geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
        return geo;
    }
    // a smooth profile [[r, y], ...] resampled as a Catmull-Rom curve. Walk it so the solid is on your left
    // (start at the bottom on the axis, go round the outside, end at the top on the axis).
    function prof(pts, n) {
        const c = new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1])));
        return c.getPoints(n || pts.length * 4).map(p => new THREE.Vector2(Math.max(0, p.x), p.y));
    }
    const lathe = (pts, seg, n, a0, a1) => new THREE.LatheGeometry(n === 0 ? pts.map(p => new THREE.Vector2(p[0], p[1])) : prof(pts, n), seg || 32, a0 || 0, a1 || TAU);
    // a rounded box: grid lines pushed toward the edges, then every corner made round
    function roundBox(w, h, d, r, s) {
        s = s || 8;
        const geo = new THREE.BoxGeometry(1, 1, 1, s, s, s), p = geo.attributes.position, n = geo.attributes.normal;
        const H = [w / 2, h / 2, d / 2];
        r = Math.min(r, H[0], H[1], H[2]);
        const remap = (c, half) => { const t = Math.abs(c) * 2, k = 1 - r / half; return Math.sign(c) * half * (t < 0.5 ? t / 0.5 * k : k + (t - 0.5) / 0.5 * (1 - k)); };
        for (let i = 0; i < p.count; i++) {
            let x = remap(p.getX(i), H[0]), y = remap(p.getY(i), H[1]), z = remap(p.getZ(i), H[2]);
            const cx = clamp(x, -H[0] + r, H[0] - r), cy = clamp(y, -H[1] + r, H[1] - r), cz = clamp(z, -H[2] + r, H[2] - r);
            let dx = x - cx, dy = y - cy, dz = z - cz;
            const l = Math.hypot(dx, dy, dz);
            if (l > 1e-9) { dx /= l; dy /= l; dz /= l; x = cx + dx * r; y = cy + dy * r; z = cz + dz * r; n.setXYZ(i, dx, dy, dz); }
            p.setXYZ(i, x, y, z);
        }
        return geo;
    }
    // A flat food slab from an outline [[x, z], ...]: rounded edges, groups [side, top, bottom] like a cylinder.
    // o.bt / o.bb: top / bottom edge radius, o.steps: rounding steps, o.disp(v): optional shaping (position based)
    function slab(outline, thick, o) {
        o = o || {};
        let pts = outline.slice();
        let area = 0;
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
        if (area < 0) pts.reverse();
        const n = pts.length, h2 = thick / 2;
        const bt = o.bt === undefined ? thick * 0.3 : o.bt, bb = o.bb === undefined ? bt : o.bb, steps = o.steps || 3;
        const nrm = pts.map((p, i) => {
            const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
            let e1x = p[0] - a[0], e1z = p[1] - a[1], e2x = b[0] - p[0], e2z = b[1] - p[1];
            const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
            let nx = e1z / l1 + e2z / l2, nz = -e1x / l1 - e2x / l2;
            const l = Math.hypot(nx, nz) || 1;
            return [nx / l, nz / l];
        });
        const rings = [];
        for (let k = 0; k <= steps; k++) { const t = k / steps * PI / 2; rings.push([bb * (1 - Math.sin(t)), -h2 + bb * (1 - Math.cos(t))]); }
        for (let k = 0; k <= steps; k++) { const t = k / steps * PI / 2; rings.push([bt * (1 - Math.cos(t)), h2 - bt + bt * Math.sin(t)]); }
        const pos = [], uv = [], idx = [];
        let per = 0;
        const cum = [0];
        for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(per); }
        let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
        for (const p of pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
        const sz = Math.max(maxx - minx, maxz - minz) || 1;
        // wall
        for (let r = 0; r < rings.length; r++) for (let i = 0; i <= n; i++) {
            const k = i % n, ins = rings[r][0];
            pos.push(pts[k][0] - nrm[k][0] * ins, rings[r][1], pts[k][1] - nrm[k][1] * ins);
            uv.push(cum[i] / per, r / (rings.length - 1));
        }
        const wallCount = pos.length / 3;
        for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
            const a = r * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
            idx.push(a, b, d, a, d, c);
        }
        const wallIdx = idx.length;
        // caps
        const cap = (ins, y) => {
            const base = pos.length / 3, contour = [];
            for (let i = 0; i < n; i++) {
                const x = pts[i][0] - nrm[i][0] * ins, z = pts[i][1] - nrm[i][1] * ins;
                pos.push(x, y, z); uv.push((x - minx) / sz, (z - minz) / sz);
                contour.push(new THREE.Vector2(x, z));
            }
            const tris = THREE.ShapeUtils.triangulateShape(contour, []);
            const start = idx.length;
            for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
            return start;
        };
        const topStart = cap(bt, h2), botStart = cap(bb, -h2);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        // orient every part (normal must point out of the slab)
        const P = geo.attributes.position, I = geo.index.array, va = new V3(), vb = new V3(), vc = new V3();
        const faceN = (k) => { va.fromBufferAttribute(P, I[k]); vb.fromBufferAttribute(P, I[k + 1]); vc.fromBufferAttribute(P, I[k + 2]); return vb.sub(va).cross(vc.sub(va)); };
        const flip = (a, b) => { for (let k = a; k < b; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } };
        flip(0, wallIdx);      // the outline is counter-clockwise, so the wall as built faces inward
        if (faceN(topStart).y < 0) flip(topStart, botStart);
        if (faceN(botStart).y > 0) flip(botStart, idx.length);
        if (o.disp) { const v = new V3(); for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); o.disp(v); P.setXYZ(i, v.x, v.y, v.z); } }
        geo.addGroup(0, wallIdx, 0); geo.addGroup(topStart, botStart - topStart, 1); geo.addGroup(botStart, idx.length - botStart, 2);
        geo.computeVertexNormals();
        weld(geo, 0, wallCount);
        return geo;
    }
    // closed outline helpers
    function blobOutline(rx, rz, n, amp, seed, extra) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = i / n * TAU;
            let k = 1 + amp * (noise3(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, seed, 7) - 0.5) * 2;
            if (extra) k *= extra(a);
            out.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
        }
        return out;
    }
    const roundRectOutline = (w, d, r, n) => {
        const out = [], q = n || 6, cs = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, PI / 2], [-w / 2 + r, -d / 2 + r, PI], [w / 2 - r, -d / 2 + r, PI * 1.5]];
        for (const [cx, cz, a0] of cs) for (let i = 0; i <= q; i++) { const a = a0 + i / q * PI / 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
        return out;
    };
    // parametric surface fn(s, t, out) over a grid
    function param(nu, nv, fn) {
        const pos = [], uv = [], idx = [], p = new V3();
        for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const s = i / nu, t = j / nv; fn(s, t, p); pos.push(p.x, p.y, p.z); uv.push(s, t); }
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return geo;
    }
    // a flat strip along +x (len), tapering from w0 to w1, bent by bend(t) -> y
    const ribbon = (len, w0, w1, seg, bend) => param(1, seg, (s, t, p) => p.set(t * len, bend ? bend(t) : 0, (s - 0.5) * mix(w0, w1, t)));
    // a tube along points with a radius profile rad(t)
    function tube(points, rad, seg, rs) {
        const curve = new THREE.CatmullRomCurve3(points.map(p => new V3(p[0], p[1], p[2])));
        seg = seg || 16; rs = rs || 8;
        const geo = new THREE.TubeGeometry(curve, seg, 1, rs, false);
        const P = geo.attributes.position, c = new V3(), v = new V3();
        for (let i = 0; i <= seg; i++) {
            curve.getPointAt(i / seg, c);
            const r = typeof rad === 'function' ? rad(i / seg) : rad;
            for (let j = 0; j <= rs; j++) { const k = i * (rs + 1) + j; v.fromBufferAttribute(P, k).sub(c).multiplyScalar(r).add(c); P.setXYZ(k, v.x, v.y, v.z); }
        }
        P.needsUpdate = true;
        return geo;
    }
    // merge many geometries (same material) into one: list of { geo, m: Matrix4, col: [r, g, b] }
    function merge(list, withColor) {
        let nv = 0, ni = 0;
        for (const e of list) { const c = e.geo.attributes.position.count; nv += c; ni += e.geo.index ? e.geo.index.count : c; }
        const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = withColor ? new Float32Array(nv * 3) : null;
        const ind = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
        const v = new V3(), nm = new THREE.Matrix3();
        let vo = 0, io = 0;
        for (const e of list) {
            const g = e.geo;
            if (!g.attributes.normal) g.computeVertexNormals();
            const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, cnt = P.count;
            if (e.m) nm.getNormalMatrix(e.m);
            const k = e.col || [1, 1, 1];
            for (let i = 0; i < cnt; i++) {
                v.fromBufferAttribute(P, i); if (e.m) v.applyMatrix4(e.m);
                pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
                v.fromBufferAttribute(N, i); if (e.m) v.applyMatrix3(nm).normalize();
                nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
                if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
                if (col) {
                    col[(vo + i) * 3] = k[0] * (C ? C.getX(i) : 1);
                    col[(vo + i) * 3 + 1] = k[1] * (C ? C.getY(i) : 1);
                    col[(vo + i) * 3 + 2] = k[2] * (C ? C.getZ(i) : 1);
                }
            }
            if (g.index) { const I = g.index.array; for (let j = 0; j < I.length; j++) ind[io + j] = I[j] + vo; io += I.length; }
            else { for (let j = 0; j < cnt; j++) ind[io + j] = vo + j; io += cnt; }
            vo += cnt;
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
        out.setIndex(new THREE.BufferAttribute(ind, 1));
        return out;
    }
    // collects parts per material and builds one mesh per material (fewer draw calls)
    class Kit {
        constructor() { this.parts = new Map(); }
        add(geo, mat, m, col) {
            let l = this.parts.get(mat);
            if (!l) this.parts.set(mat, l = []);
            l.push({ geo, m, col });
            return this;
        }
        build(parent, shadow) {
            const out = [];
            for (const [mat, list] of this.parts) {
                const me = new THREE.Mesh(merge(list, !!mat.vertexColors), mat);
                me.castShadow = shadow !== false; me.receiveShadow = true;
                parent.add(me);
                out.push(me);
            }
            return out;
        }
    }
    // random points spread evenly over a surface (area weighted): [{ p, n }]. ok(x, y, z, nx, ny, nz) filters triangles.
    function surfacePoints(geo, count, ok, m4) {
        const P = geo.attributes.position, N = geo.attributes.normal, I = geo.index ? geo.index.array : null;
        const a = new V3(), b = new V3(), c = new V3(), na = new V3(), nb = new V3(), nc = new V3(), tri = [], cdf = [];
        const nt = I ? I.length / 3 : P.count / 3;
        let total = 0;
        for (let t = 0; t < nt; t++) {
            const i0 = I ? I[t * 3] : t * 3, i1 = I ? I[t * 3 + 1] : t * 3 + 1, i2 = I ? I[t * 3 + 2] : t * 3 + 2;
            a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
            na.fromBufferAttribute(N, i0).add(nb.fromBufferAttribute(N, i1)).add(nc.fromBufferAttribute(N, i2)).normalize();
            if (ok && !ok((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, na.x, na.y, na.z)) continue;
            const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
            if (area <= 0) continue;
            total += area; tri.push(i0, i1, i2); cdf.push(total);
        }
        const out = [], nm = m4 ? new THREE.Matrix3().getNormalMatrix(m4) : null;
        for (let k = 0; k < count && total > 0; k++) {
            const r = Math.random() * total;
            let lo = 0, hi = cdf.length - 1;
            while (lo < hi) { const md = (lo + hi) >> 1; if (cdf[md] < r) lo = md + 1; else hi = md; }
            let u = Math.random(), v = Math.random();
            if (u + v > 1) { u = 1 - u; v = 1 - v; }
            const w = 1 - u - v, i0 = tri[lo * 3], i1 = tri[lo * 3 + 1], i2 = tri[lo * 3 + 2];
            const p = a.fromBufferAttribute(P, i0).multiplyScalar(w).add(b.fromBufferAttribute(P, i1).multiplyScalar(u)).add(c.fromBufferAttribute(P, i2).multiplyScalar(v)).clone();
            const n = na.fromBufferAttribute(N, i0).multiplyScalar(w).add(nb.fromBufferAttribute(N, i1).multiplyScalar(u)).add(nc.fromBufferAttribute(N, i2).multiplyScalar(v)).normalize().clone();
            if (m4) { p.applyMatrix4(m4); n.applyMatrix3(nm).normalize(); }
            out.push({ p, n });
        }
        return out;
    }
    // a matrix that stands a small part on a surface point, local y along the normal, random twist
    const _up = new V3(0, 1, 0);
    function onSurface(sp, sx, sy, sz, lift) {
        const q = new THREE.Quaternion().setFromUnitVectors(_up, sp.n).multiply(new THREE.Quaternion().setFromAxisAngle(_up, R(0, TAU)));
        return new THREE.Matrix4().compose(sp.p.clone().addScaledVector(sp.n, lift || 0), q, new V3(sx, sy, sz));
    }
    // a thin strip lying on a lathe surface (painted bands): part 'out' = before the widest point, y in [from, to];
    // part 'in' = after it, radius in [from, to]. Offset off along the surface normal.
    function bandOn(pts, n, part, from, to, off, seg) {
        const P = prof(pts, n);
        let iMax = 0;
        for (let i = 0; i < P.length; i++) if (P[i].x > P[iMax].x) iMax = i;
        const sel = [];
        for (let i = 1; i < P.length - 1; i++) {
            if (part === 'out' ? i > iMax : i < iMax) continue;
            const v = part === 'out' ? P[i].y : P[i].x;
            if (v < from || v > to) continue;
            const tx = P[i + 1].x - P[i - 1].x, ty = P[i + 1].y - P[i - 1].y, l = Math.hypot(tx, ty) || 1;
            sel.push(new THREE.Vector2(P[i].x + ty / l * off, P[i].y - tx / l * off));
        }
        return new THREE.LatheGeometry(sel, seg || 72);
    }
    const planarUV = (geo, size) => { const P = geo.attributes.position, U = geo.attributes.uv; for (let i = 0; i < P.count; i++) U.setXY(i, P.getX(i) / size + 0.5, P.getZ(i) / size + 0.5); U.needsUpdate = true; return geo; };
    const G = {   // small shared unit geometries
        sphereHi: () => shared('g-sphereHi', () => new THREE.SphereGeometry(1, 32, 24)),
        sphere: () => shared('g-sphere', () => new THREE.SphereGeometry(1, 16, 12)),
        sphereLo: () => shared('g-sphereLo', () => new THREE.SphereGeometry(1, 10, 7)),
        ico: () => shared('g-ico', () => new THREE.IcosahedronGeometry(1, 0)),
        cyl: () => shared('g-cyl', () => new THREE.CylinderGeometry(1, 1, 1, 16)),
        cylLo: () => shared('g-cylLo', () => new THREE.CylinderGeometry(1, 1, 1, 8)),
        box: () => shared('g-box', () => new THREE.BoxGeometry(1, 1, 1)),
        rbox: () => shared('g-rbox', () => roundBox(1, 1, 1, 0.22, 6)),
        torus: () => shared('g-torus', () => new THREE.TorusGeometry(1, 0.3, 8, 24))
    };
    const mesh = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x || 0, y || 0, z || 0);
        m.castShadow = true; m.receiveShadow = true;
        return m;
    };

    // ---------- materials ----------
    // colours are written as sRGB hex; three r128 would use them as linear (washed out), so convert them
    const lin = c => (c && c.isColor ? c.clone() : new THREE.Color(c)).convertSRGBToLinear();
    const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: 0.6, metalness: 0 }, o || {}));
    const BROWN = lin(0x3a2414);
    // onState helper: material colour from a (linear) colour a towards b by k
    const towards = (mat, a, b, k) => mat.color.copy(a).lerp(b, k);
    M.mat = {
        steel: () => shared('steel', () => std(0xc9d1d6, { metalness: 0.85, roughness: 0.28 })),
        brushed: () => shared('brushed', () => std(0xd6dce0, { metalness: 0.92, roughness: 0.35, roughnessMap: T.brushed() })),
        darkSteel: () => shared('dsteel', () => std(0x4a5055, { metalness: 0.85, roughness: 0.34, roughnessMap: T.brushed() })),
        nonstick: () => shared('nonstick', () => std(0x1b1d20, { metalness: 0.4, roughness: 0.42, roughnessMap: T.brushed() })),
        chrome: () => shared('chrome', () => std(0xf0f3f5, { metalness: 1, roughness: 0.12 })),
        black: () => shared('black', () => std(0x1d1f22, { roughness: 0.45, metalness: 0.3 })),
        bakelite: () => shared('bakelite', () => std(0x16181a, { roughness: 0.38, metalness: 0.05 })),
        rubber: () => shared('rubber', () => std(0x1a1a1a, { roughness: 0.9 })),
        ceramic: () => shared('ceramic', () => new THREE.MeshPhysicalMaterial({ color: lin(0xfbfaf6), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 })),
        dirtyCeramic: () => shared('dceramic', () => std(0xffffff, { roughness: 0.72, map: T.stains() })),
        wood: () => shared('wood', () => std(0xffffff, { map: M.woodTex(), roughness: 0.75 })),
        red: () => shared('red', () => std(0xd8262a, { roughness: 0.3, metalness: 0.15 })),
        glass: () => shared('glass', () => std(0xeaf4f6, { roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false })),
        skin: () => shared('skin', () => std(0xf1c7a0, { roughness: 0.62 })),
        gold: () => shared('gold', () => std(0xe8b84a, { metalness: 1, roughness: 0.25 }))
    };
    M.woodTex = () => shared('woodTex', () => M.canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#b98a57'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 70; i++) {
            g.strokeStyle = `rgba(${90 + Math.random() * 40},${55 + Math.random() * 25},${25},${0.15 + Math.random() * 0.25})`;
            g.lineWidth = 1 + Math.random() * 3;
            g.beginPath(); const y = Math.random() * h; g.moveTo(0, y);
            for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 4);
            g.stroke();
        }
    }));
    // Soft round sprite used for flames, smoke, steam and sparks
    M.blobTex = () => shared('blob', () => {
        const t = M.canvasTex(64, 64, (g) => {
            const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
            gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        });
        t.encoding = THREE.LinearEncoding;
        return t;
    });
    M.flameTex = () => shared('flame', () => {
        const t = M.canvasTex(64, 128, (g) => {
            const gr = g.createRadialGradient(32, 92, 4, 32, 80, 60);
            gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.25, 'rgba(255,210,70,0.95)'); gr.addColorStop(0.6, 'rgba(255,90,20,0.6)'); gr.addColorStop(1, 'rgba(255,40,0,0)');
            g.fillStyle = gr;
            g.beginPath(); g.moveTo(32, 2); g.bezierCurveTo(60, 50, 64, 90, 32, 126); g.bezierCurveTo(0, 90, 4, 50, 32, 2); g.fill();
        });
        t.encoding = THREE.LinearEncoding;
        return t;
    });
    function textLabel(text, fg, bg) {
        return shared('lab-' + text + fg + bg, () => M.canvasTex(128, 128, (c, w, h) => {
            c.fillStyle = bg; c.fillRect(0, 0, w, h);
            c.fillStyle = fg; c.font = `bold ${text.length > 2 ? 34 : 90}px Fredoka, Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(text, w / 2, h / 2 + 4);
        }));
    }
    M.textLabel = textLabel;

    const tint = (u, color, o) => { const m = std(color, o); u.tint.push(m); return m; };
    const BUILD = {};
    T.sear = () => pixTex('sear', 128, 128, (u, v, o) => {
        const r = Math.hypot(u * 2 - 1, v * 2 - 1);
        const a = smooth(0.38, 0.72, pfbm(u, v, 5, 5, 211, 4)) * 0.85 + smooth(0.25, 0.05, worley(u, v, 9, 9, 212)[0]) * 0.35;
        rgb(o, 0.17, 0.085, 0.04); o[3] = b255(clamp(a, 0, 1) * smooth(1.04, 0.82, r));
    }, { srgb: true });
    T.grill = () => pixTex('grill', 128, 128, (u, v, o) => {
        const r = Math.hypot(u * 2 - 1, v * 2 - 1), line = Math.abs((((u + v) * 5) % 1) - 0.5) * 2;
        const a = smooth(0.8, 0.94, line) * 0.9 + smooth(0.42, 0.75, pfbm(u, v, 5, 5, 213, 4)) * 0.5;
        rgb(o, 0.13, 0.065, 0.03); o[3] = b255(clamp(a, 0, 1) * smooth(1.08, 0.84, r));
    }, { srgb: true });
    T.mushSlice = () => pixTex('mushSlice', 128, 128, (u, v, o) => {
        const x = u * 0.052 - 0.026, z = v * 0.052 - 0.026;
        let b = 0.97 + 0.03 * pfbm(u, v, 8, 8, 221, 2);
        const e = Math.hypot((x - 0.002) / 0.02, z / 0.026);
        if (x > -0.004) b = mix(b, 0.56, smooth(0.8, 0.95, e));
        if (x < 0.0005 && x > -0.0068 && Math.abs(z) > 0.0083) b = 0.42 + 0.2 * Math.abs(Math.sin(z * 1100));
        gray(o, b);
    });

    // ===================== FOOD =====================
    const LEAF = 0x3f8f2f;
    // the green star on top of a tomato
    function calyx(g, y, size, mat) {
        const k = new Kit();
        for (let i = 0; i < 6; i++) {
            const a = i / 6 * TAU + R(-0.2, 0.2), len = size * R(0.85, 1.1);
            k.add(ribbon(len, size * 0.34, size * 0.03, 6, t => -t * t * size * 0.5 + Math.sin(t * PI) * size * 0.07), mat, mtx(0, y, 0, 0, -a, 0));
        }
        k.add(G.sphere(), mat, mtx(0, y + size * 0.04, 0, 0, 0, 0, size * 0.2, size * 0.1, size * 0.2));
        k.add(tube([[0, y, 0], [size * 0.04, y + size * 0.28, 0], [size * 0.15, y + size * 0.5, 0.002]], t => size * (0.11 - 0.035 * t), 6, 6), mat);
        k.build(g);
    }
    BUILD.tomato = (g, u) => {
        const geo = new THREE.SphereGeometry(0.045, 40, 28), seed = R(0, 100);
        displace(geo, v => {
            const r = v.length() || 1, ny = v.y / r, phi = Math.atan2(v.z, v.x);
            const lobe = 1 + 0.03 * Math.cos(5 * phi + seed) * smooth(-0.2, 0.85, ny) * (1 - smooth(0.86, 1, ny));
            v.multiplyScalar(lobe * (1 + 0.014 * (fbm(v.x * 50, v.y * 50, v.z * 50, seed | 0, 2) - 0.5)));
            v.y *= 0.86;
            if (ny > 0.7) v.y -= (ny - 0.7) * 0.02;
            if (ny < -0.9) v.y += (-0.9 - ny) * 0.012;
        });
        g.add(mesh(geo, tint(u, 0xe8392b, { roughness: 0.2, map: T.skinTom(), bumpMap: T.fine(), bumpScale: 0.0004 })));
        const leaf = std(LEAF, { roughness: 0.55, side: THREE.DoubleSide }), green = leaf.color.clone();
        calyx(g, 0.0325, 0.031, leaf);
        u.onState = (s, c) => towards(leaf, green, BROWN, smooth(0.2, 1.1, c));
    };
    BUILD.tomato_slice = (g, u) => {
        const geo = slab(blobOutline(0.042, 0.042, 40, 0.035, R(0, 50)), 0.01, { bt: 0.0016, bb: 0.0016, steps: 2 });
        const skin = tint(u, 0xd82e22, { roughness: 0.25 });
        const flesh = tint(u, 0xff5340, { roughness: 0.28, map: T.tomFace() });
        g.add(mesh(geo, [skin, flesh, flesh]));
        const seedMat = std(0xf1d79a, { roughness: 0.35 }), seedCol = seedMat.color.clone(), k = new Kit();
        for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {      // seeds spread through each jelly pocket
            const r = R(0.013, 0.027), a = (i + 0.5) / 4 * TAU + R(-0.3, 0.3) * (r / 0.027);
            for (const side of [1, -1]) k.add(G.sphereLo(), seedMat, mtx(Math.cos(a) * r, side * 0.0049, Math.sin(a) * r, 0, -a + R(-0.4, 0.4), 0, 0.0015, 0.0006, 0.0025));
        }
        k.build(g, false);
        u.onState = (s, c) => towards(seedMat, seedCol, BROWN, smooth(0.3, 1.3, c) * 0.8);
    };
    BUILD.onion = (g, u) => {
        const geo = lathe([[0, -0.037], [0.012, -0.0365], [0.028, -0.03], [0.039, -0.016], [0.042, 0.0], [0.038, 0.016], [0.027, 0.029], [0.013, 0.039], [0.0045, 0.047], [0.0018, 0.054], [0, 0.056]], 36, 40);
        const seed = R(0, 60) | 0;
        displace(geo, v => { if (Math.hypot(v.x, v.z) > 0.004) { const k = 1 + 0.022 * (noise3(v.x * 70, v.y * 30, v.z * 70, seed) - 0.5); v.x *= k; v.z *= k; } });
        g.add(mesh(geo, tint(u, 0xd9a35b, { roughness: 0.42, map: T.onion(), bumpMap: T.onion(), bumpScale: 0.0005 })));
        const dry = std(0x9b6a34, { roughness: 0.8, side: THREE.DoubleSide }), dryCol = dry.color.clone(), root = std(0xe8dcc0, { roughness: 0.9 }), k = new Kit();
        k.add(tube([[0, 0.051, 0], [0.002, 0.061, 0.001], [0.0055, 0.068, 0.003]], t => 0.0022 * (1 - t * 0.7), 6, 6), dry);
        for (let i = 0; i < 10; i++) {
            const a = i / 10 * TAU + R(0, 0.5), l = R(0.006, 0.012);
            k.add(tube([[Math.cos(a) * 0.002, -0.0355, Math.sin(a) * 0.002], [Math.cos(a) * l * 0.6, -0.039, Math.sin(a) * l * 0.6], [Math.cos(a) * l, -0.0385 + R(-0.002, 0.001), Math.sin(a) * l]], 0.0006, 5, 4), root);
        }
        k.build(g);
        u.onState = (s, c) => towards(dry, dryCol, BROWN, smooth(0.2, 1, c));
    };
    BUILD.onion_ring = (g, u) => {
        const k = new Kit(), m = tint(u, 0xf3e7d0, { roughness: 0.3 });
        [[0.034, 0.0042], [0.0255, 0.0038], [0.017, 0.0034], [0.0095, 0.003]].forEach(([r, t], i) => {
            k.add(new THREE.TorusGeometry(r, t, 8, 44), m, mtx(R(-0.0012, 0.0012) * i, 0, R(-0.0012, 0.0012) * i, PI / 2, 0, 0, 1, 1, 0.72));
        });
        k.build(g);
    };
    // one cupped, ruffled leaf of a lettuce head (spherical shell patch shaped like a leaf)
    function headLeaf(R0, phi0, width, th0, th1, ruff, flare, seed) {
        return param(26, 18, (s, t, p) => {
            const w = 0.3 + 0.7 * Math.sqrt(Math.sin(PI * 0.5 * Math.min(1, t * 1.25)));     // narrow at the stem, wide rounded top
            const e = Math.abs(s - 0.5) * 2;
            const th = mix(th0, th1, t) - 0.18 * e * e * smooth(0.5, 1, t);                   // rounded top edge
            const ph = phi0 + (s - 0.5) * width * w;
            const edge = Math.pow(e, 2.2) * smooth(0.15, 0.7, t) + Math.pow(t, 4) * 0.8;
            const wav = Math.sin(s * 17 + t * 9 + seed) * 0.65 + Math.sin(s * 29 + seed * 2) * 0.35;
            const rr = R0 * (1 + flare * Math.pow(t, 3)) + ruff * edge * wav + R0 * 0.04 * Math.sin(t * PI);
            p.set(rr * Math.sin(th) * Math.cos(ph), -rr * Math.cos(th), rr * Math.sin(th) * Math.sin(ph));
        });
    }
    BUILD.lettuce = (g, u) => {
        const m = tint(u, 0x7fcf4a, { roughness: 0.48, side: THREE.DoubleSide, map: T.leaf(), vertexColors: true });
        const k = new Kit();
        let sd = R(0, 10);
        const layers = [[0.041, 3, 1.9, 0.3, 2.95, 0.0022, 0.05, 1.2], [0.054, 4, 1.75, 0.35, 2.6, 0.0045, 0.1, 1.07], [0.064, 5, 1.6, 0.42, 2.32, 0.0068, 0.14, 0.94]];
        for (const [R0, n, width, th0, th1, ruff, flare, bright] of layers) {
            for (let i = 0; i < n; i++) {
                const geo = headLeaf(R0, i / n * TAU + R(-0.3, 0.3) + R0 * 40, width, th0, th1 + R(-0.15, 0.15), ruff, flare, sd++);
                vcolor(geo, (x, y) => { const q = bright * (1 + 0.22 * smooth(0.0, -0.05, y)); return [q, q, q * 0.95]; });
                k.add(geo, m);
            }
        }
        k.add(G.sphere(), m, mtx(0, -0.012, 0, 0, 0, 0, 0.034), [1.25, 1.25, 1.1]);
        k.build(g);
    };
    BUILD.lettuce_leaf = (g, u) => {
        const seed = R(0, 30);
        const geo = param(18, 14, (s, t, p) => {
            const w = (0.2 + 0.8 * Math.sin(PI * Math.pow(t, 0.8))) * 0.047, e = Math.abs(s - 0.5) * 2;
            const ruff = 0.0035 * e * e * Math.sin(s * 40 + t * 26 + seed) * smooth(0.1, 0.5, t) + 0.003 * Math.pow(t, 4) * Math.sin(s * 30 + seed);
            p.set((t - 0.5) * 0.105, 0.0075 * e * e - 0.003 + ruff + 0.0012 * smooth(0.12, 0, e), (s - 0.5) * 2 * w);
        });
        vcolor(geo, (x) => { const q = 1 + 0.22 * smooth(-0.02, -0.05, x); return [q, q, q * 0.95]; });
        g.add(mesh(geo, tint(u, 0x8fe05a, { roughness: 0.48, side: THREE.DoubleSide, map: T.leaf(), vertexColors: true })));
    };
    BUILD.potato = (g, u) => {
        const geo = new THREE.SphereGeometry(0.045, 32, 22), seed = R(0, 80) | 0;
        const eyes = [];
        for (let i = 0; i < 5; i++) eyes.push(new V3(R(-1, 1), R(-0.5, 1), R(-1, 1)).normalize());
        const d = new V3();
        displace(geo, v => {
            d.copy(v).normalize();
            let k = 1 + 0.09 * (fbm(d.x * 1.6, d.y * 1.6, d.z * 1.6, seed, 3) - 0.5) + 0.02 * (noise3(d.x * 8, d.y * 8, d.z * 8, seed + 5) - 0.5);
            for (const e of eyes) k -= 0.035 * smooth(0.22, 0.0, d.distanceTo(e));
            v.multiplyScalar(k);
            v.x *= 1.16; v.y *= 0.78; v.z *= 0.92;
        });
        g.add(mesh(geo, tint(u, 0xc49a5a, { roughness: 0.85, map: T.potato(), bumpMap: T.bumpy(), bumpScale: 0.0008 })));
    };
    BUILD.fries = (g, u) => {
        const m = tint(u, 0xf2deaa, { roughness: 0.55, vertexColors: true, bumpMap: T.fine(), bumpScale: 0.0004 });
        const base = shared('g-fry', () => vcolor(roundBox(0.011, 0.011, 0.085, 0.0032, 4), (x, y, z) => { const q = 1 - 0.3 * smooth(0.55, 1, Math.abs(z) / 0.0425); return [q, q * 0.96, q * 0.88]; }));
        // a dense heap: lower fries spread wide and flat, the top ones criss-cross at angles
        const k = new Kit();
        for (let i = 0; i < 24; i++) {
            const t = i / 23, rr = Math.sqrt(Math.random()) * 0.034 * (1 - 0.55 * t), ang = R(0, TAU);
            const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr, y = -0.0135 + t * 0.022 + R(-0.002, 0.002);
            k.add(base, m, mtx(x, y, z, R(-0.25, 0.25) * t, R(0, TAU), R(-0.3, 0.3) * t, R(1.0, 1.15), R(1.0, 1.15), R(0.62, 0.9)), [R(0.92, 1.05), R(0.92, 1.0), R(0.86, 1.0)]);
        }
        k.build(g);
    };
    BUILD.cheese = (g, u) => {
        g.add(mesh(roundBox(0.1, 0.07, 0.08, 0.006, 8), tint(u, 0xffd34a, { roughness: 0.46, map: T.cheese(), bumpMap: T.cheeseBump(), bumpScale: 0.0012 })));
    };
    // cheese slice: a thin rounded square that melts (morph target) as it heats up
    BUILD.cheese_slice = (g, u) => {
        const geo = new THREE.BoxGeometry(0.088, 0.0042, 0.088, 14, 1, 14), P = geo.attributes.position, rc = 0.009, hw = 0.044;
        for (let i = 0; i < P.count; i++) {
            let x = P.getX(i), z = P.getZ(i);
            const cx = clamp(x, -hw + rc, hw - rc), cz = clamp(z, -hw + rc, hw - rc), dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
            if (d > rc) { x = cx + dx / d * rc; z = cz + dz / d * rc; }
            const k = 1 + 0.025 * (noise3(x * 50, 0, z * 50, 3) - 0.5);
            P.setXYZ(i, x * k, P.getY(i), z * k);
        }
        geo.computeVertexNormals();
        // melted: the square relaxes into a round, wobbly puddle that droops at the edges
        const melt = new Float32Array(P.count * 3), wob = R(0, 6);
        for (let i = 0; i < P.count; i++) {
            const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), sq = Math.max(Math.abs(x), Math.abs(z)) / hw;
            const rad = 0.05 * (1 + 0.09 * Math.sin(a * 3 + wob) + 0.05 * Math.sin(a * 7 + wob * 2)) * sq;
            melt[i * 3] = Math.cos(a) * rad; melt[i * 3 + 1] = y * 0.7 - 0.008 * smooth(0.55, 1.0, sq); melt[i * 3 + 2] = Math.sin(a) * rad;
        }
        const tmp = new THREE.BufferGeometry();
        tmp.setAttribute('position', new THREE.BufferAttribute(melt, 3));
        tmp.setIndex(geo.index);
        tmp.computeVertexNormals();
        geo.morphAttributes.position = [new THREE.BufferAttribute(melt, 3)];
        geo.morphAttributes.normal = [tmp.attributes.normal];
        const m = tint(u, 0xffd84f, { roughness: 0.42, map: T.cheese(), morphTargets: true, morphNormals: true });
        const me = mesh(geo, m);
        g.add(me);
        u.onState = (s, c) => { const k = smooth(0.15, 0.75, c); me.morphTargetInfluences[0] = k; m.roughness = 0.42 - 0.2 * k; };
    };
    const SEED = lin(0xfff0cf), TOAST = lin(0xc98a3c), FAT = lin(0xf3e3d3), FAT_DONE = lin(0xb57a3c);
    const crustCol = (top, band, bot) => [mix(mix(1, 0.94, top), 1.12, band) * (1 - 0.12 * bot), mix(mix(1, 0.8, top), 1.16, band) * (1 - 0.15 * bot), mix(mix(1, 0.62, top), 1.24, band) * (1 - 0.2 * bot)];
    BUILD.bun = (g, u) => {
        const geo = lathe([[0, -0.04], [0.03, -0.0405], [0.047, -0.037], [0.054, -0.028], [0.0565, -0.014], [0.0555, -0.002], [0.052, 0.012], [0.043, 0.028], [0.029, 0.039], [0.013, 0.0445], [0, 0.0455]], 36, 40);
        displace(geo, v => { const k = 1 + 0.012 * (noise3(v.x * 40, v.y * 40, v.z * 40, 4) - 0.5); v.x *= k; v.z *= k; });
        vcolor(geo, (x, y) => crustCol(smooth(0.0, 0.045, y), smooth(-0.02, -0.009, y) * smooth(0.008, -0.002, y), smooth(-0.03, -0.04, y)));
        g.add(mesh(geo, tint(u, 0xe0a85a, { roughness: 0.48, vertexColors: true, bumpMap: T.fine(), bumpScale: 0.0005 })));
        const seedMat = std(0xfff0cf, { roughness: 0.45 }), k = new Kit();
        for (const sp of surfacePoints(geo, 38, (x, y, z, nx, ny) => y > 0.012 && ny > 0.35)) k.add(G.sphereLo(), seedMat, onSurface(sp, 0.0022, 0.0009, 0.0042, 0.0003));
        k.build(g, false);
        u.onState = (s, c) => towards(seedMat, SEED, TOAST, smooth(0.2, 1.1, c));
    };
    BUILD.bun_bottom = (g, u) => {
        const geo = slab(blobOutline(0.054, 0.054, 40, 0.02, R(0, 40)), 0.028, { bt: 0.0025, bb: 0.009, steps: 4 });
        vcolor(geo, (x, y) => { const k = smooth(0.011, -0.011, y); return [mix(1, 0.98, k), mix(1, 0.74, k), mix(1, 0.5, k)]; });
        const crust = tint(u, 0xf2d49b, { roughness: 0.58, vertexColors: true, bumpMap: T.fine(), bumpScale: 0.0004 });
        const crumb = tint(u, 0xf2d49b, { roughness: 0.85, map: T.crumb(), bumpMap: T.crumb(), bumpScale: 0.0008 });
        g.add(mesh(geo, [crust, crumb, crust]));
    };
    BUILD.bun_top = (g, u) => {
        const dome = lathe([[0.049, -0.0245], [0.054, -0.021], [0.0565, -0.012], [0.0545, 0.0], [0.047, 0.012], [0.034, 0.021], [0.018, 0.0255], [0, 0.0265]], 36, 36);
        displace(dome, v => { const k = 1 + 0.01 * (noise3(v.x * 40, v.y * 40, v.z * 40, 9) - 0.5); v.x *= k; v.z *= k; });
        vcolor(dome, (x, y) => crustCol(smooth(-0.01, 0.026, y), smooth(-0.012, -0.022, y), 0));
        g.add(mesh(dome, tint(u, 0xe0a85a, { roughness: 0.46, vertexColors: true, bumpMap: T.fine(), bumpScale: 0.0005 })));
        const cut = new THREE.CircleGeometry(0.0495, 40);
        cut.rotateX(PI / 2);
        vcolor(cut, () => [1.08, 1.25, 1.55]);      // the crumb is much paler than the golden crust
        g.add(mesh(cut, tint(u, 0xe0a85a, { roughness: 0.85, map: T.crumb(), vertexColors: true }), 0, -0.0244, 0));
        const seedMat = std(0xfff0cf, { roughness: 0.45 }), k = new Kit();
        for (const sp of surfacePoints(dome, 34, (x, y, z, nx, ny) => y > -0.004 && ny > 0.4)) k.add(G.sphereLo(), seedMat, onSurface(sp, 0.0022, 0.0009, 0.0042, 0.0003));
        k.build(g, false);
        u.onState = (s, c) => towards(seedMat, SEED, TOAST, smooth(0.2, 1.1, c));
    };
    // copy of one group of a geometry, pushed out along its normals (sear decals that hug a bumpy surface)
    function groupCopy(geo, gi, off) {
        const gr = geo.groups[gi], I = geo.index.array, P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
        const pos = [], uv = [], map = new Map(), idx = [];
        for (let k = gr.start; k < gr.start + gr.count; k++) {
            const i = I[k];
            let j = map.get(i);
            if (j === undefined) { j = pos.length / 3; map.set(i, j); pos.push(P.getX(i) + N.getX(i) * off, P.getY(i) + N.getY(i) * off, P.getZ(i) + N.getZ(i) * off); uv.push(U.getX(i), U.getY(i)); }
            idx.push(j);
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        out.setIndex(idx);
        out.computeVertexNormals();
        return out;
    }
    function searDecals(g, geo, tex) {
        const mk = gi => {
            const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
            const me = new THREE.Mesh(groupCopy(geo, gi, 0.0003), m);
            me.receiveShadow = true; me.visible = false;
            g.add(me);
            return me;
        };
        return { top: mk(1), bot: mk(2) };
    }
    function searState(sear, top, bot, s) {
        const ct = s.c[s.up] || 0, cb = s.c[1 - s.up] || 0;
        const ot = smooth(0.32, 0.95, ct) * 0.9, ob = smooth(0.32, 0.95, cb) * 0.9;
        sear.top.material.opacity = ot; sear.top.visible = ot > 0.01;
        sear.bot.material.opacity = ob; sear.bot.visible = ob > 0.01;
        top.roughness = mix(0.34, 0.78, smooth(0.1, 0.8, ct));
        bot.roughness = mix(0.34, 0.78, smooth(0.1, 0.8, cb));
    }
    BUILD.patty = (g, u) => {
        const seed = R(0, 99);
        const out = blobOutline(0.05, 0.05, 48, 0.07, seed, a => 1 + 0.015 * Math.sin(a * 9 + seed));
        const geo = slab(out, 0.02, { bt: 0.006, bb: 0.006, steps: 4, disp: v => { const n = fbm(v.x * 90, v.y * 90, v.z * 90, seed | 0, 3) - 0.5; v.y += n * 0.0022 * Math.sign(v.y || 1); const k = 1 + n * 0.03; v.x *= k; v.z *= k; } });
        const mo = () => ({ roughness: 0.5, map: T.meat(), bumpMap: T.meat(), bumpScale: 0.0012 });
        const side = tint(u, 0xd9545c, mo()), top = std(0xd9545c, mo()), bot = std(0xd9545c, mo());
        u.sides = { top, bottom: bot };
        g.add(mesh(geo, [side, top, bot]));
        const sear = searDecals(g, geo, T.sear());
        u.onState = s => searState(sear, top, bot, s);
    };
    BUILD.steak = (g, u) => {
        const seed = R(0, 99);
        const out = blobOutline(0.074, 0.05, 56, 0.06, seed, a => 1 + 0.07 * Math.cos(2 * a + 0.6) - 0.1 * Math.pow(Math.max(0, Math.cos(a - 4.3)), 3));
        const geo = slab(out, 0.026, { bt: 0.007, bb: 0.007, steps: 4, disp: v => { const n = fbm(v.x * 60, v.y * 60, v.z * 60, seed | 0, 3) - 0.5; v.y += n * 0.0018 * Math.sign(v.y || 1); } });
        const mo = () => ({ roughness: 0.45, map: T.marble(), bumpMap: T.bumpy(), bumpScale: 0.0008 });
        const side = tint(u, 0xc93b47, mo()), top = std(0xc93b47, mo()), bot = std(0xc93b47, mo());
        u.sides = { top, bottom: bot };
        g.add(mesh(geo, [side, top, bot]));
        // a cap of fat along the outer edge
        const n = out.length, idx = [];
        for (let i = 0; i < n; i++) { const a = i / n * TAU; if (a > 0.3 && a < 2.7) idx.push(i); }     // along the long curved side
        const fatPts = idx.map(i => { const a = i / n * TAU; return [out[i][0] + Math.cos(a) * 0.0012, 0, out[i][1] + Math.sin(a) * 0.0012]; });
        const fat = std(0xf3e3d3, { roughness: 0.48, bumpMap: T.fine(), bumpScale: 0.0006 });
        const fg = tube(fatPts, t => 0.0062 * Math.pow(Math.sin(PI * clamp(t * 1.08 - 0.04, 0, 1)), 0.5) + 0.0012, 32, 10);
        fg.scale(1, 1.25, 1);
        g.add(mesh(fg, fat));
        const sear = searDecals(g, geo, T.grill());
        u.onState = (s, c) => { searState(sear, top, bot, s); towards(fat, FAT, FAT_DONE, smooth(0.3, 1.1, c)); };
    };
    BUILD.dough = (g, u) => {
        const geo = new THREE.SphereGeometry(0.052, 32, 24), seed = R(0, 50) | 0, d = new V3();
        const fold = R(0, TAU);
        displace(geo, v => {
            d.copy(v).normalize();
            let k = 1 + 0.07 * (fbm(d.x * 1.8, d.y * 1.8, d.z * 1.8, seed, 3) - 0.5);
            const across = d.x * Math.cos(fold) + d.z * Math.sin(fold);       // a soft fold where the dough was tucked
            k -= 0.03 * smooth(0.12, 0.0, Math.abs(across)) * smooth(0.2, 0.8, d.y);
            v.multiplyScalar(k);
            v.y *= 0.76;
            if (v.y < -0.03) v.y = -0.03 + (v.y + 0.03) * 0.25;
        });
        g.add(mesh(geo, tint(u, 0xf1dfb6, { roughness: 0.88, map: T.flour(), bumpMap: T.bumpy(), bumpScale: 0.0006 })));
        const flour = shared('flourDust', () => std(0xfbf8f0, { roughness: 1 })), k = new Kit();
        for (const sp of surfacePoints(geo, 34, (x, y, z, nx, ny) => ny > 0.6)) k.add(G.ico(), flour, onSurface(sp, R(0.0012, 0.0028), 0.0004, R(0.0012, 0.0028), 0.0001));
        k.build(g, false);
    };
    BUILD.pizza_base = (g, u) => {
        const seed = R(0, 99);
        const base = slab(blobOutline(0.121, 0.121, 64, 0.02, seed), 0.008, { bt: 0.002, bb: 0.003, steps: 2 });
        const dough = tint(u, 0xf3e2bd, { roughness: 0.8, map: T.flour(), bumpMap: T.bumpy(), bumpScale: 0.0006 });
        g.add(mesh(base, [dough, dough, dough], 0, -0.003, 0));
        const rim = new THREE.TorusGeometry(0.111, 0.0135, 12, 72);
        rim.rotateX(PI / 2);
        displace(rim, v => {
            const a = Math.atan2(v.z, v.x);
            const puff = 1 + 0.25 * (fbm(Math.cos(a) * 3 + 7, Math.sin(a) * 3 + 7, seed, 5, 3) - 0.5) * 2;
            const cx = Math.cos(a) * 0.111, cz = Math.sin(a) * 0.111;
            v.x = cx + (v.x - cx) * puff; v.z = cz + (v.z - cz) * puff; v.y = v.y * puff * 0.78;
            if (v.y < -0.004) v.y = -0.004 + (v.y + 0.004) * 0.3;
        });
        rim.translate(0, 0.0035, 0);
        g.add(mesh(rim, tint(u, 0xf3e2bd, { roughness: 0.72, map: T.crust(), bumpMap: T.crust(), bumpScale: 0.0012 })));
        const sauce = std(0xffffff, { roughness: 0.38, map: T.sauce() });
        g.add(mesh(slab(blobOutline(0.1, 0.1, 56, 0.05, seed + 3), 0.0016, { bt: 0.0006, bb: 0.0004, steps: 1 }), sauce, 0, 0.0018, 0));
        u.top = 0.0026;
        u.onState = (s, c) => { const k = smooth(0.2, 1.1, c); sauce.color.setRGB(mix(1, 0.62, k), mix(1, 0.5, k), mix(1, 0.45, k)); sauce.roughness = mix(0.38, 0.5, k); };
    };
    BUILD.salami = (g, u) => {
        const geo = lathe([[0, -0.07], [0.006, -0.0695], [0.014, -0.0665], [0.019, -0.06], [0.0215, -0.045], [0.022, 0], [0.0215, 0.045], [0.019, 0.06], [0.014, 0.0665], [0.006, 0.0695], [0, 0.07]], 28, 44);
        displace(geo, v => { const k = 1 + 0.035 * (noise3(v.x * 120, v.y * 30, v.z * 120, 3) - 0.5); v.x *= k; v.z *= k; });
        geo.rotateZ(PI / 2);
        g.add(mesh(geo, tint(u, 0xb53a3a, { roughness: 0.55, map: T.salamiSkin(), bumpMap: T.bumpy(), bumpScale: 0.0008 })));
        const twine = std(0xe9dcc0, { roughness: 0.9 }), k = new Kit();
        const ring = new THREE.TorusGeometry(0.0172, 0.0013, 6, 28);
        ring.rotateY(PI / 2);
        k.add(ring, twine, mtx(0.062, 0, 0));
        k.add(tube([[0.07, 0, 0], [0.077, 0.006, 0], [0.082, 0.001, 0.004], [0.078, -0.004, 0.002]], 0.0011, 10, 5), twine);
        k.build(g);
    };
    BUILD.salami_slice = (g, u) => {
        const h = 0.00225;
        const geo = lathe([[0, -h], [0.006, -h], [0.012, -h], [0.018, -h], [0.0222, -h], [0.0238, -0.0013], [0.0242, 0], [0.0238, 0.0013], [0.0222, h], [0.018, h], [0.012, h], [0.006, h], [0, h]], 28, 0);
        const P = geo.attributes.position, U = geo.attributes.uv;
        for (let i = 0; i < P.count; i++) U.setXY(i, P.getX(i) / 0.05 + 0.5, P.getZ(i) / 0.05 + 0.5);
        vcolor(geo, (x, y, z) => { const r = Math.hypot(x, z), k = smooth(0.0215, 0.0235, r); return [mix(1, 0.62, k), mix(1, 0.5, k), mix(1, 0.5, k)]; });
        const cup = new Float32Array(P.count * 3);
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = Math.hypot(x, z) / 0.0242; cup[i * 3] = x * 0.93; cup[i * 3 + 1] = y + 0.0045 * r * r - 0.001; cup[i * 3 + 2] = z * 0.93; }
        const tmp = new THREE.BufferGeometry();
        tmp.setAttribute('position', new THREE.BufferAttribute(cup, 3));
        tmp.setIndex(geo.index);
        tmp.computeVertexNormals();
        geo.morphAttributes.position = [new THREE.BufferAttribute(cup, 3)];
        geo.morphAttributes.normal = [tmp.attributes.normal];
        const m = tint(u, 0xc4474a, { roughness: 0.5, map: T.salami(), vertexColors: true, morphTargets: true, morphNormals: true });
        const me = mesh(geo, m);
        g.add(me);
        u.onState = (s, c) => { me.morphTargetInfluences[0] = smooth(0.2, 0.9, c); };
    };
    BUILD.mushroom = (g, u) => {
        const cap = lathe([[0.009, -0.003], [0.016, -0.0042], [0.024, -0.0052], [0.031, -0.0062], [0.0345, -0.0035], [0.0355, 0.0015], [0.033, 0.008], [0.027, 0.0145], [0.018, 0.0195], [0.009, 0.0218], [0, 0.0224]], 32, 40);
        displace(cap, v => { const k = 1 + 0.03 * (noise3(v.x * 90, v.y * 40, v.z * 90, 5) - 0.5); v.x *= k; v.z *= k; });
        g.add(mesh(cap, tint(u, 0xeadfcf, { roughness: 0.58, map: T.mushroom() }), 0, 0.004, 0));
        const stem = lathe([[0, -0.0335], [0.0105, -0.033], [0.0118, -0.03], [0.0105, -0.022], [0.0095, -0.01], [0.0098, 0.0], [0, 0.002]], 20, 24);
        g.add(mesh(stem, tint(u, 0xf3ece0, { roughness: 0.65, bumpMap: T.fine(), bumpScale: 0.0004 })));
    };
    BUILD.mushroom_slice = (g, u) => {
        const out = [];
        for (let i = 0; i <= 16; i++) { const a = -PI / 2 + i / 16 * PI; out.push([0.002 + Math.cos(a) * 0.02, Math.sin(a) * 0.026]); }
        out.push([-0.004, 0.024], [-0.004, 0.0085], [-0.0235, 0.0078], [-0.026, 0.0], [-0.0235, -0.0078], [-0.004, -0.0085], [-0.004, -0.024]);
        const geo = slab(out, 0.006, { bt: 0.0012, bb: 0.0012, steps: 2 });
        const inner = new THREE.Group();
        inner.add(mesh(geo, tint(u, 0xefe5d6, { roughness: 0.6, map: T.mushSlice() })));
        g.add(inner);
        u.onState = (s, c) => inner.scale.setScalar(1 - 0.16 * smooth(0.2, 1, c));
    };
    BUILD.soup = (g, u) => {
        g.add(mesh(new THREE.CylinderGeometry(0.0715, 0.07, 0.004, 40, 1), tint(u, 0xd8432c, { roughness: 0.14, map: T.soup() }), 0, 0.0095, 0));
        const cream = std(0xfff6e6, { roughness: 0.3 }), spiral = [];
        for (let i = 0; i <= 30; i++) { const t = i / 30, a = t * TAU * 1.6, r = 0.008 + t * 0.034; spiral.push([Math.cos(a) * r, 0.0117, Math.sin(a) * r]); }
        const k = new Kit();
        k.add(tube(spiral, t => 0.0022 * (1 - t * 0.6), 60, 5), cream);
        const herbs = std(0x3f7f2a, { roughness: 0.6 }), crouton = std(0xd89a48, { roughness: 0.8, bumpMap: T.bumpy(), bumpScale: 0.0008 });
        for (let i = 0; i < 9; i++) { const a = R(0, TAU), r = R(0.01, 0.058); k.add(G.box(), herbs, mtx(Math.cos(a) * r, 0.0117, Math.sin(a) * r, 0, R(0, 3), 0, R(0.003, 0.005), 0.0007, R(0.002, 0.004))); }
        for (let i = 0; i < 3; i++) { const a = R(0, TAU), r = R(0.02, 0.05); k.add(G.rbox(), crouton, mtx(Math.cos(a) * r, 0.0125, Math.sin(a) * r, R(0, 3), R(0, 3), R(0, 3), 0.0085)); }
        k.build(g, false);
    };
    BUILD.charcoal = (g, u) => {
        const geo = new THREE.IcosahedronGeometry(0.04, 3), seed = R(0, 50) | 0, d = new V3();
        displace(geo, v => { d.copy(v).normalize(); v.multiplyScalar(1 + 0.35 * (fbm(d.x * 2.2, d.y * 2.2, d.z * 2.2, seed, 4) - 0.5)); v.y *= 0.45; v.z *= 0.88; });
        g.add(mesh(geo, tint(u, 0x1c1410, { roughness: 0.95, emissive: 0xff5a1a, emissiveIntensity: 0.9, emissiveMap: T.embers(), bumpMap: T.bumpy(), bumpScale: 0.002 })));
        // ash flakes sit on real surface points near the top
        geo.computeBoundingBox();
        const P = geo.attributes.position, top = geo.boundingBox.max.y, ash = std(0x9a948c, { roughness: 1 }), k = new Kit(), spots = [];
        for (let i = 0; i < P.count; i++) if (P.getY(i) > top * 0.72) spots.push(i);
        for (let i = 0; i < 10 && spots.length; i++) { const j = spots[Math.floor(Math.random() * spots.length)]; k.add(G.ico(), ash, mtx(P.getX(j), P.getY(j), P.getZ(j), R(0, 3), R(0, 3), R(0, 3), R(0.002, 0.005), R(0.0008, 0.0014), R(0.002, 0.005))); }
        k.build(g, false);
    };

    // ===================== DISHES, COOKWARE, TOOLS =====================
    const PLATE = [[0, -0.0105], [0.05, -0.0105], [0.068, -0.0108], [0.072, -0.0135], [0.078, -0.015], [0.083, -0.0138], [0.088, -0.0105], [0.105, -0.0055], [0.121, 0.0025], [0.1295, 0.0085], [0.131, 0.0112], [0.1285, 0.0122], [0.1215, 0.0086], [0.106, 0.0], [0.092, -0.0042], [0.07, -0.0046], [0, -0.0046]];
    const BOWL = [[0, -0.0335], [0.03, -0.0335], [0.035, -0.0355], [0.039, -0.04], [0.045, -0.0395], [0.049, -0.036], [0.06, -0.027], [0.073, -0.012], [0.083, 0.006], [0.0885, 0.024], [0.0905, 0.036], [0.0905, 0.0395], [0.0875, 0.0405], [0.0855, 0.037], [0.0825, 0.022], [0.0765, 0.004], [0.0665, -0.012], [0.052, -0.0225], [0.034, -0.0275], [0, -0.0285]];
    BUILD.plate = (g, u) => {
        const me = mesh(planarUV(lathe(PLATE, 48, 64), 0.27), M.mat.ceramic());
        g.add(me);
        u.ceramic = [me];
        const band = shared('plateBandGeo', () => bandOn(PLATE, 64, 'in', 0.1155, 0.1235, 0.0004, 96));
        const bm = shared('plateBand', () => std(0x2ec4b6, { roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -1 }));
        g.add(mesh(band, bm));
        u.top = -0.0044;
    };
    BUILD.bowl = (g, u) => {
        const me = mesh(planarUV(lathe(BOWL, 48, 72), 0.19), M.mat.ceramic());
        g.add(me);
        u.ceramic = [me];
        const band = shared('bowlBandGeo', () => bandOn(BOWL, 72, 'out', 0.012, 0.025, 0.0005, 72));
        g.add(mesh(band, shared('bowlBand', () => std(0xff6b6b, { roughness: 0.28, polygonOffset: true, polygonOffsetFactor: -1 }))));
        u.top = -0.028;
    };
    BUILD.pan = (g, u) => {
        g.add(mesh(lathe([[0, -0.0245], [0.09, -0.0245], [0.103, -0.0235], [0.112, -0.019], [0.12, -0.009], [0.128, 0.006], [0.1345, 0.0205], [0.1365, 0.0235]], 48, 40), M.mat.darkSteel()));
        g.add(mesh(lathe([[0.1365, 0.0235], [0.1345, 0.0248], [0.131, 0.0215], [0.124, 0.0055], [0.116, -0.0075], [0.106, -0.0135], [0.093, -0.0152], [0, -0.0152]], 48, 40), M.mat.nonstick()));
        const disc = new THREE.CircleGeometry(0.088, 40);
        disc.rotateX(PI / 2);
        g.add(mesh(disc, M.mat.brushed(), 0, -0.0247, 0));
        const k = new Kit();
        k.add(roundBox(0.03, 0.016, 0.026, 0.005, 6), M.mat.brushed(), mtx(0.142, 0.009, 0, 0, 0, 0.12));
        for (const z of [-0.007, 0.007]) k.add(G.sphere(), M.mat.brushed(), mtx(0.1275, 0.012, z, 0, 0, 0, 0.0028, 0.0028, 0.0028));
        const hg = lathe([[0, 0], [0.0085, 0.002], [0.009, 0.03], [0.0105, 0.12], [0.0115, 0.165], [0.009, 0.177], [0, 0.18]], 16, 28);
        hg.scale(0.62, 1, 1);
        hg.rotateZ(-PI / 2 + 0.12);
        k.add(hg, M.mat.bakelite(), mtx(0.152, 0.011, 0));
        const eyelet = new THREE.TorusGeometry(0.0055, 0.0016, 6, 16);
        eyelet.rotateX(PI / 2);
        k.add(eyelet, M.mat.brushed(), mtx(0.312, 0.0305, 0));
        k.build(g);
        u.top = -0.0149;
        u.handle = g.children[g.children.length - 1];
    };
    BUILD.pot = (g, u) => {
        g.add(mesh(lathe([[0, -0.11], [0.118, -0.11], [0.128, -0.108], [0.134, -0.102], [0.135, -0.09], [0.135, 0.095], [0.1372, 0.1015], [0.1418, 0.1065], [0.1425, 0.1098], [0.139, 0.1118], [0.1345, 0.1092], [0.1305, 0.1035], [0.129, 0.095], [0.129, -0.091], [0.127, -0.0965], [0.121, -0.0985], [0, -0.0985]], 48, 72), M.mat.brushed()));
        g.add(mesh(new THREE.CylinderGeometry(0.1356, 0.1356, 0.016, 48, 1, true), M.mat.darkSteel(), 0, -0.1, 0));
        const k = new Kit();
        for (const s of [1, -1]) {
            k.add(tube([[s * 0.134, 0.074, -0.036], [s * 0.157, 0.078, -0.031], [s * 0.168, 0.08, 0], [s * 0.157, 0.078, 0.031], [s * 0.134, 0.074, 0.036]], 0.0055, 22, 8), M.mat.brushed());
            for (const z of [-0.036, 0.036]) k.add(G.sphere(), M.mat.brushed(), mtx(s * 0.1345, 0.074, z, 0, 0, 0, 0.0075, 0.0095, 0.0075));
        }
        k.build(g);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(0.1288, 0.1288, 0.006, 48), std(0x8fd3ff, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.82 }));
        water.position.y = 0.04;
        water.visible = false;
        g.add(water);
        u.liquid = water;
        u.top = -0.098;
    };
    BUILD.basket = (g, u) => {
        const W = 0.19, H = 0.094;
        const wire = shared('wireMat', () => { const t = T.wire(); t.repeat.set(2.4, 1.2); return std(0xffffff, { metalness: 0.85, roughness: 0.35, map: t, alphaTest: 0.5, side: THREE.DoubleSide }); });
        const k = new Kit(), plane = (w, h) => new THREE.PlaneGeometry(w, h);
        k.add(plane(W, H), wire, mtx(0, 0, W / 2));
        k.add(plane(W, H), wire, mtx(0, 0, -W / 2, 0, PI, 0));
        k.add(plane(W, H), wire, mtx(W / 2, 0, 0, 0, PI / 2, 0));
        k.add(plane(W, H), wire, mtx(-W / 2, 0, 0, 0, -PI / 2, 0));
        k.add(plane(W, W), wire, mtx(0, -H / 2, 0, -PI / 2, 0, 0));
        k.build(g, false);
        const steel = M.mat.steel(), fk = new Kit(), loop = y => {
            const p = [], h = W / 2, r = 0.012;
            for (const [cx, cz, a0] of [[h - r, h - r, 0], [-h + r, h - r, PI / 2], [-h + r, -h + r, PI], [h - r, -h + r, PI * 1.5]]) for (let i = 0; i <= 4; i++) { const a = a0 + i / 4 * PI / 2; p.push(new V3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); }
            return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p, true), 64, 0.0022, 6, true);
        };
        fk.add(loop(H / 2), steel); fk.add(loop(-H / 2), steel);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) fk.add(G.cylLo(), steel, mtx(sx * (W / 2 - 0.004), 0, sz * (W / 2 - 0.004), 0, 0, 0, 0.002, H, 0.002));
        fk.add(tube([[W / 2, H / 2, -0.03], [W / 2 + 0.03, H / 2 + 0.02, -0.012], [W / 2 + 0.07, H / 2 + 0.03, 0], [W / 2 + 0.2, H / 2 + 0.036, 0]], 0.003, 20, 6), steel);
        fk.add(tube([[W / 2, H / 2, 0.03], [W / 2 + 0.03, H / 2 + 0.02, 0.012], [W / 2 + 0.07, H / 2 + 0.03, 0]], 0.003, 12, 6), steel);
        const grip = lathe([[0, 0], [0.008, 0.003], [0.0095, 0.02], [0.0095, 0.09], [0.0085, 0.098], [0, 0.1]], 14, 20);
        grip.rotateZ(-PI / 2);
        fk.add(grip, M.mat.bakelite(), mtx(W / 2 + 0.115, H / 2 + 0.034, 0, 0, 0, 0.05));
        fk.build(g);
        u.top = -H / 2 + 0.002;
    };
    function shaker(g, u, fill, letter) {
        g.add(mesh(lathe([[0, -0.055], [0.019, -0.055], [0.0235, -0.052], [0.025, -0.045], [0.0225, -0.02], [0.022, 0.0], [0.0235, 0.02], [0.0245, 0.03], [0.022, 0.034], [0.0215, 0.036]], 32, 36), M.mat.glass()));
        g.add(mesh(lathe([[0, -0.0505], [0.0195, -0.0505], [0.0212, -0.045], [0.0198, -0.02], [0.0196, 0.004], [0.012, 0.007], [0, 0.0075]], 24, 24), std(fill, { roughness: 0.95, bumpMap: T.fine(), bumpScale: 0.0006 })));
        g.add(mesh(lathe([[0.0205, 0.033], [0.0232, 0.034], [0.0238, 0.042], [0.0228, 0.047], [0.019, 0.052], [0.011, 0.0555], [0, 0.0565]], 32, 28), M.mat.chrome()));
        const k = new Kit(), hole = shared('shakerHole', () => std(0x1a1a1a, { roughness: 0.6 }));
        for (let i = 0; i < 7; i++) { const a = i / 6 * TAU, r = i === 6 ? 0 : 0.0075; k.add(G.sphereLo(), hole, mtx(Math.cos(a) * r, 0.0558 - (r ? 0.0012 : 0), Math.sin(a) * r, 0, 0, 0, 0.0016, 0.0006, 0.0016)); }
        k.build(g, false);
        const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.0228, 0.0228, 0.022, 24, 1, true, -0.55, 1.1), std(0xffffff, { roughness: 0.5, map: textLabel(letter, '#2a2a2a', '#fff3d6') }));
        lab.position.y = -0.012;
        g.add(lab);
    }
    BUILD.salt = (g, u) => shaker(g, u, 0xfbfbf8, 'S');
    BUILD.pepper = (g, u) => shaker(g, u, 0x3a332e, 'P');
    T.extLabel = () => shared('extLabel', () => M.canvasTex(256, 192, (c, w, h) => {
        c.fillStyle = '#f7f4ec'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#c81e1e'; c.fillRect(0, 0, w, 44);
        c.fillStyle = '#fff'; c.font = 'bold 32px Bungee, Fredoka, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('FIRE', w / 2, 24);
        c.fillStyle = '#1d1d1d'; c.font = 'bold 22px Fredoka, Arial'; c.fillText('EXTINGUISHER', w / 2, 66);
        [['A', '#2f9e44'], ['B', '#d9480f'], ['C', '#1c7ed6']].forEach(([t, col], i) => {
            const x = 58 + i * 70;
            c.fillStyle = col; c.fillRect(x - 24, 88, 48, 40);
            c.fillStyle = '#fff'; c.font = 'bold 30px Fredoka, Arial'; c.fillText(t, x, 110);
        });
        c.fillStyle = '#555';
        for (let i = 0; i < 4; i++) c.fillRect(30, 144 + i * 11, 196 - (i % 2) * 40, 4);
    }));
    T.gauge = () => shared('gauge', () => M.canvasTex(64, 64, (c) => {
        c.fillStyle = '#fafafa'; c.beginPath(); c.arc(32, 32, 30, 0, TAU); c.fill();
        c.lineWidth = 7;
        [['#e03131', 0.75, 1.05], ['#2f9e44', 1.05, 1.95], ['#e03131', 1.95, 2.25]].forEach(([col, a, b]) => { c.strokeStyle = col; c.beginPath(); c.arc(32, 32, 22, a * PI, b * PI); c.stroke(); });
        c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.moveTo(32, 32); c.lineTo(32 + Math.cos(1.6 * PI) * 20, 32 + Math.sin(1.6 * PI) * 20); c.stroke();
        c.fillStyle = '#111'; c.beginPath(); c.arc(32, 32, 4, 0, TAU); c.fill();
    }));
    BUILD.ext = (g, u) => {
        const red = shared('extRed', () => new THREE.MeshPhysicalMaterial({ color: lin(0xc81e1e), roughness: 0.26, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 }));
        g.add(mesh(lathe([[0, -0.235], [0.062, -0.235], [0.07, -0.229], [0.0725, -0.215], [0.0725, 0.11], [0.07, 0.135], [0.058, 0.158], [0.04, 0.171], [0.022, 0.176], [0, 0.177]], 40, 48), red));
        g.add(mesh(new THREE.CylinderGeometry(0.0738, 0.0738, 0.022, 40, 1, true), M.mat.rubber(), 0, -0.225, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.0731, 0.0731, 0.13, 32, 1, true, -0.95, 1.9), std(0xffffff, { roughness: 0.5, map: T.extLabel() }), 0, -0.03, 0));
        const black = M.mat.bakelite(), chrome = M.mat.chrome(), brass = M.mat.gold(), k = new Kit();
        k.add(G.cyl(), brass, mtx(0, 0.186, 0, 0, 0, 0, 0.021, 0.024, 0.021));
        k.add(roundBox(0.042, 0.03, 0.034, 0.008, 6), black, mtx(0, 0.21, 0));
        k.add(roundBox(0.115, 0.009, 0.026, 0.004, 6), chrome, mtx(-0.036, 0.223, 0, 0, 0, -0.04));
        k.add(roundBox(0.105, 0.008, 0.024, 0.0035, 6), chrome, mtx(-0.03, 0.238, 0, 0, 0, 0.2));
        k.add(G.cyl(), chrome, mtx(0.0135, 0.212, 0.0165, PI / 2, 0, 0, 0.0115, 0.006, 0.0115));
        k.add(tube([[0.018, 0.205, -0.012], [0.05, 0.19, -0.032], [0.077, 0.15, -0.038], [0.081, 0.08, -0.042], [0.079, 0.02, -0.046]], 0.0065, 30, 8), M.mat.rubber());
        const horn = lathe([[0, -0.045], [0.012, -0.044], [0.0105, -0.03], [0.0075, -0.005], [0.0065, 0], [0, 0.001]], 16, 18);
        k.add(horn, black, mtx(0.079, 0.02, -0.046));
        k.build(g);
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.0098, 20), std(0xffffff, { roughness: 0.3, map: T.gauge() }));
        face.position.set(0.0135, 0.212, 0.0198);
        g.add(face);
        const pin = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0014, 6, 18), shared('pinYellow', () => std(0xffc928, { roughness: 0.35, metalness: 0.2 })));
        pin.position.set(-0.024, 0.224, 0.02);
        pin.rotation.y = 0.4;
        g.add(pin);
    };
    T.stencil = () => shared('stencil', () => M.canvasTex(256, 96, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = 'rgba(34,64,52,0.85)';
        c.beginPath(); c.arc(40, 48, 26, 0, TAU); c.fill();
        c.fillStyle = 'rgba(200,40,30,0.9)'; c.beginPath(); c.arc(40, 52, 17, 0, TAU); c.fill();
        c.fillStyle = 'rgba(60,130,50,0.95)'; c.fillRect(36, 26, 8, 10);
        c.fillStyle = 'rgba(34,64,52,0.85)'; c.font = 'bold 30px Bungee, Fredoka, Arial'; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText('FRESH', 76, 34); c.font = 'bold 22px Fredoka, Arial'; c.fillText('MARKET · FARM DIRECT', 78, 68);
    }));
    BUILD.crate = (g, u) => {
        const W = 0.5, H = 0.34, D = 0.4;
        const wood = shared('crateWood', () => std(0xffffff, { map: T.plank(), roughness: 0.82, vertexColors: true }));
        const shade = () => { const q = R(0.82, 1.06); return [q, q * R(0.96, 1), q * R(0.92, 1)]; };
        const k = new Kit(), post = 0.034;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(roundBox(post, H, post, 0.004, 4), wood, mtx(sx * (W / 2 - post / 2), 0, sz * (D / 2 - post / 2)), shade());
        for (let i = 0; i < 3; i++) {
            const y = -H / 2 + 0.05 + i * 0.12;
            for (const sz of [-1, 1]) k.add(roundBox(W - 0.012, 0.086, 0.014, 0.003, 4), wood, mtx(0, y, sz * (D / 2 - 0.008), 0, 0, R(-0.008, 0.008)), shade());
            for (const sx of [-1, 1]) k.add(roundBox(0.014, 0.086, D - 0.05, 0.003, 4), wood, mtx(sx * (W / 2 - 0.008), y, 0), shade());
        }
        for (let i = 0; i < 4; i++) k.add(roundBox(W - 0.04, 0.012, 0.086, 0.003, 4), wood, mtx(0, -H / 2 + 0.007, -D / 2 + 0.058 + i * 0.095), shade());
        k.build(g);
        const metal = M.mat.darkSteel(), mk = new Kit();
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            mk.add(G.box(), metal, mtx(sx * (W / 2 - 0.02), H / 2 - 0.03, sz * (D / 2 + 0.0005), 0, 0, 0, 0.05, 0.05, 0.002));
            mk.add(G.box(), metal, mtx(sx * (W / 2 + 0.0005), H / 2 - 0.03, sz * (D / 2 - 0.02), 0, 0, 0, 0.002, 0.05, 0.05));
            for (const dy of [-0.012, 0.012]) mk.add(G.sphereLo(), metal, mtx(sx * (W / 2 - 0.02), H / 2 - 0.03 + dy, sz * (D / 2 + 0.002), 0, 0, 0, 0.003, 0.003, 0.002));
        }
        mk.build(g);
        // paper filling with a few vegetables peeking out
        const paper = shared('cratePaper', () => std(0xc9a87a, { roughness: 0.95, side: THREE.DoubleSide, bumpMap: T.bumpy(), bumpScale: 0.004 }));
        const fill = param(16, 12, (s, t, p) => p.set((s - 0.5) * (W - 0.05), H / 2 - 0.05 + 0.025 * (fbm(s * 4, t * 4, 0, 3, 3) - 0.5) * 2, (t - 0.5) * (D - 0.05)));
        g.add(mesh(fill, paper));
        const veg = [['tomato', -0.12, 0.08], ['tomato', -0.05, 0.11], ['lettuce', 0.1, -0.05], ['onion', -0.1, -0.08], ['bun', 0.15, 0.1]];
        for (const [t, x, z] of veg) {
            const vg = new THREE.Group(), vu = { tint: [], top: 0 };
            BUILD[t](vg, vu);
            vg.position.set(x, H / 2 - 0.045, z);
            vg.rotation.set(R(-0.3, 0.3), R(0, TAU), R(-0.3, 0.3));
            g.add(vg);
        }
        for (const sz of [-1, 1]) {
            const st = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1125), std(0xffffff, { map: T.stencil(), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
            st.position.set(0, -0.01, sz * (D / 2 + 0.0012));
            st.rotation.y = sz > 0 ? 0 : PI;
            g.add(st);
        }
    };

    // ---------- assembling an item: ground it, add dirt specks, wire the state hook ----------
    const NO_GROUND = { soup: 1 }, NO_GRIME = { soup: 1, charcoal: 1 };
    // dirt specks on the upward-facing surface of the item's main mesh (shown when it is dirty)
    function addGrime(inner, u) {
        const main = inner.children.find(c => c.isMesh && !c.material.transparent) || inner.children.find(c => c.isMesh);
        if (!main) return;
        main.updateMatrix();
        const mat = shared('grime', () => std(0x3a2a1c, { roughness: 1 })), dust = shared('grimeDust', () => std(0x6b5a48, { roughness: 1 })), k = new Kit();
        const pts = surfacePoints(main.geometry, 12, (x, y, z, nx, ny) => ny > 0.3, main.matrix);
        pts.forEach((sp, i) => k.add(G.ico(), i % 3 ? mat : dust, onSurface(sp, R(0.0016, 0.0032), R(0.0007, 0.0012), R(0.0016, 0.0032), 0.0004)));
        const built = k.build(inner, false);
        built.forEach(m => { m.visible = false; });
        u.grime = built;
    }
    M.item = (type) => {
        const g = new THREE.Group();
        const u = g.userData = { tint: [], top: 0, lift: 0 };
        const inner = new THREE.Group();
        g.add(inner);
        (BUILD[type] || BUILD.charcoal)(inner, u, type);
        const def = CF.ITEMS[type];
        if (def) {
            inner.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(inner);
            if (def.food && !NO_GRIME[type]) addGrime(inner, u);
            const half = def.shape.t === 'sphere' ? def.shape.r : def.shape.s[1] / 2;
            const sink = box.min.y + half;
            if (!NO_GROUND[type] && sink > 0.0015) { inner.position.y = -sink; u.lift = sink; u.top -= sink; }
        }
        const own = u.onState;
        if (u.grime || own) u.onState = (s, c) => { if (u.grime) for (const m of u.grime) m.visible = !!s.dirty; if (own) own(s, c); };
        return g;
    };

    // ===================== CHARACTERS =====================
    const CH = {
        eyeWhite: () => shared('eyeW', () => std(0xffffff, { roughness: 0.22 })),
        pupil: () => shared('pupil', () => std(0x17120e, { roughness: 0.15 })),
        shine: () => shared('shine', () => new THREE.MeshBasicMaterial({ color: 0xffffff })),
        mouth: () => shared('mouthMat', () => std(0x7a2626, { roughness: 0.5 })),
        sole: () => shared('sole', () => std(0x111111, { roughness: 0.9 }))
    };
    const skinMat = hex => shared('skin-' + hex, () => std(hex, { roughness: 0.6 }));
    const noseMat = hex => shared('nose-' + hex, () => std(new THREE.Color(hex).lerp(new THREE.Color(0xff8a7a), 0.2), { roughness: 0.55 }));
    const hairMat = hex => shared('hair-' + hex, () => std(hex, { roughness: 0.55, bumpMap: T.fur(), bumpScale: 0.0012 }));
    const cloth = (hex, o) => std(hex, Object.assign({ roughness: 0.86, bumpMap: T.weave(), bumpScale: 0.0007 }, o || {}));
    const dampTo = (cur, to, k, dt) => cur + (to - cur) * (1 - Math.exp(-k * dt));
    // eyes, brows and swappable mouths on a head group. Returns setMood('smile'|'neutral'|'frown'|'angry'|'o').
    function face(head, f) {
        const es = f.eye || 1, k = new Kit();
        for (const s of [-1, 1]) {
            k.add(G.sphere(), CH.eyeWhite(), mtx(s * f.ex, f.ey, f.ez, 0, 0, 0, 0.028 * es, 0.032 * es, 0.017 * es));
            k.add(G.sphere(), CH.pupil(), mtx(s * (f.ex - 0.002), f.ey - 0.002, f.ez + 0.012 * es, 0, 0, 0, 0.015 * es, 0.017 * es, 0.008 * es));
            k.add(G.sphereLo(), CH.shine(), mtx(s * (f.ex - 0.007), f.ey + 0.007, f.ez + 0.018 * es, 0, 0, 0, 0.005 * es, 0.005 * es, 0.003));
        }
        k.build(head, false);
        const brows = [];
        for (const s of [-1, 1]) {
            const b = mesh(G.rbox(), f.brow, s * f.ex, f.ey + 0.043 * es, f.ez + 0.003);
            b.scale.set(0.05 * es, 0.012, 0.014);
            b.rotation.x = -0.2;
            b.castShadow = false;
            head.add(b);
            brows.push(b);
        }
        const arc = bend => tube([[-0.028, f.my + bend, f.mz - 0.005], [0, f.my, f.mz + 0.001], [0.028, f.my + bend, f.mz - 0.005]], t => 0.0045 * Math.sin(PI * (0.12 + 0.76 * t)) + 0.0014, 12, 6);
        const mouths = { smile: mesh(arc(0.012), CH.mouth()), neutral: mesh(arc(0.0015), CH.mouth()), frown: mesh(arc(-0.01), CH.mouth()), o: mesh(G.sphere(), CH.mouth()) };
        mouths.o.position.set(0, f.my - 0.002, f.mz - 0.003);
        mouths.o.scale.set(0.012, 0.014, 0.008);
        for (const m in mouths) { mouths[m].castShadow = false; head.add(mouths[m]); }
        let cur = '';
        const setMood = m => {
            if (m === cur) return;
            cur = m;
            const mm = m === 'angry' ? 'frown' : m;
            for (const key in mouths) mouths[key].visible = key === mm;
            const ang = m === 'angry' ? 0.42 : m === 'frown' ? 0.14 : m === 'smile' ? -0.1 : 0;
            brows.forEach((b, i) => { b.rotation.z = (i ? 1 : -1) * ang; b.position.y = f.ey + 0.043 * es - (m === 'angry' ? 0.007 : 0); });
        };
        setMood('smile');
        return setMood;
    }
    // hair styles on a head of radius hr centred at y = hc (face towards +z)
    // a cap of hair whose lower edge depends on direction: high at the forehead, lower at the sides and back
    function hairShell(hr, front, side, back, flare, seed) {
        return param(44, 14, (s, t, p) => {
            const ph = s * TAU, fz = Math.sin(ph), fx = Math.cos(ph);
            const lim = fz > 0 ? mix(side, front, Math.pow(fz, 1.4)) : mix(side, back, Math.pow(-fz, 1.1));
            const th = t * lim;
            const r = hr * (1.07 + 0.04 * (1 - t) * (1 - t) + 0.02 * Math.sin(ph * 11 + seed) * t + flare * smooth(0.65, 1, t) * t);
            p.set(r * Math.sin(th) * fx, r * Math.cos(th), r * Math.sin(th) * fz);
        });
    }
    function hairdo(head, style, mat, hc, hr) {
        const k = new Kit(), sd = R(0, 9);
        const at = mtx(0, hc, -0.003);
        if (style === 'bob') k.add(hairShell(hr, 0.9, 2.05, 2.0, 0.1, sd), mat, at);
        else if (style !== 'bald' && style !== 'beanie' && style !== 'cap') k.add(hairShell(hr, style === 'curly' ? 1.0 : 0.92, 1.45, 1.78, 0, sd), mat, at);
        if (style === 'ponytail') k.add(tube([[0, hc + 0.04, -hr * 0.95], [0, hc - 0.02, -hr * 1.25], [0, hc - 0.12, -hr * 1.2], [0, hc - 0.2, -hr * 1.05]], t => 0.035 * (1 - t * 0.7) + 0.006, 14, 10), mat);
        if (style === 'bun') k.add(G.sphere(), mat, mtx(0, hc + hr * 0.95, -hr * 0.35, 0, 0, 0, 0.055));
        if (style === 'curly') for (let i = 0; i < 18; i++) {
            const th = R(0, 1.15), ph = R(0, TAU);
            if (Math.sin(ph) > 0.55 && th > 0.6) continue;     // keep the face clear
            k.add(G.sphere(), mat, mtx(hr * 1.02 * Math.sin(th) * Math.cos(ph), hc + hr * 1.02 * Math.cos(th), hr * 1.02 * Math.sin(th) * Math.sin(ph), 0, 0, 0, R(0.035, 0.05)));
        }
        if (style === 'spiky') for (let i = 0; i < 12; i++) {
            const th = R(0, 0.9), ph = R(0, TAU), d = new V3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
            const m4 = new THREE.Matrix4().compose(d.clone().multiplyScalar(hr * 1.02).add(new V3(0, hc, 0)), new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d), new V3(0.03, 0.07, 0.03));
            k.add(shared('g-cone', () => new THREE.ConeGeometry(1, 1, 8)), mat, m4);
        }
        k.build(head);
    }
    function headwear(head, kind, col, hc, hr) {
        const k = new Kit();
        if (kind === 'beanie') {
            const m = std(col, { roughness: 0.95, bumpMap: T.knit(), bumpScale: 0.002 });
            k.add(new THREE.SphereGeometry(hr * 1.08, 26, 16, 0, TAU, 0, 1.15), m, mtx(0, hc + 0.012, -0.004, 0, 0, 0, 1, 1.1, 1));
            k.add(new THREE.TorusGeometry(hr * 0.93, 0.019, 8, 32), m, mtx(0, hc + 0.075, -0.004, PI / 2, 0, 0));
            k.add(G.sphere(), m, mtx(0, hc + hr * 1.18, -0.01, 0, 0, 0, 0.035));
        } else if (kind === 'cap') {
            const m = std(col, { roughness: 0.75 });
            k.add(new THREE.SphereGeometry(hr * 1.06, 26, 14, 0, TAU, 0, 1.18), m, mtx(0, hc + 0.008, -0.004));
            k.add(roundBox(0.16, 0.01, 0.12, 0.004, 6), m, mtx(0, hc + 0.07, hr * 0.98, 0.16, 0, 0));
        } else if (kind === 'tophat') {
            const m = std(0x121214, { roughness: 0.45 }), band = M.mat.gold();
            k.add(G.cyl(), m, mtx(0, hc + hr * 0.95 + 0.11, 0, 0, 0, 0, hr * 0.78, 0.2, hr * 0.78));
            k.add(G.cyl(), m, mtx(0, hc + hr * 0.92, 0, 0, 0, 0, hr * 1.35, 0.012, hr * 1.35));
            k.add(G.cyl(), band, mtx(0, hc + hr * 0.95 + 0.03, 0, 0, 0, 0, hr * 0.785, 0.026, hr * 0.785));
        } else if (kind === 'inspector') {
            const m = std(0x1f2d4a, { roughness: 0.7 });
            k.add(G.cyl(), m, mtx(0, hc + hr * 0.82, 0, 0, 0, 0, hr * 1.05, 0.07, hr * 1.05));
            k.add(G.cyl(), m, mtx(0, hc + hr * 0.92, 0.01, 0, 0, 0, hr * 1.18, 0.03, hr * 1.18));
            k.add(roundBox(0.14, 0.012, 0.09, 0.004, 6), shared('visor', () => std(0x111111, { roughness: 0.3 })), mtx(0, hc + hr * 0.72, hr * 1.02, 0.2, 0, 0));
            k.add(roundBox(0.04, 0.03, 0.01, 0.004, 4), M.mat.gold(), mtx(0, hc + hr * 0.84, hr * 1.06));
        }
        k.build(head);
    }
    function glasses(head, ex, ey, ez, col, hr) {
        const m = std(col, { roughness: 0.35, metalness: 0.4 }), k = new Kit();
        hr = hr || 0.15;
        for (const s of [-1, 1]) {
            const ring = new THREE.TorusGeometry(0.03, 0.0035, 6, 20);
            k.add(ring, m, mtx(s * ex, ey, ez + 0.022));
            // temple arm: from the outer edge of the frame, round the side of the head to the ear
            k.add(tube([[s * (ex + 0.029), ey + 0.002, ez + 0.02], [s * hr * 0.99, ey + 0.004, ez - 0.035], [s * hr * 1.0, ey, -0.005], [s * hr * 0.96, ey - 0.012, -0.03]], 0.0028, 12, 5), m);
        }
        k.add(G.box(), m, mtx(0, ey + 0.005, ez + 0.026, 0, 0, 0, 0.034, 0.005, 0.005));
        k.build(head, false);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 18), M.mat.glass());
        for (const s of [-1, 1]) { const l = lens.clone(); l.position.set(s * ex, ey, ez + 0.021); head.add(l); }
    }

    // ---------- the chef (other players, and you on the main menu) ----------
    M.chef = (color) => {
        const col = new THREE.Color(color);
        const g = new THREE.Group(), body = new THREE.Group();
        g.add(body);
        const white = shared('chefWhite', () => cloth(0xf8f7f2, { roughness: 0.88 }));
        const accent = cloth(col, { roughness: 0.72 }), accentDark = cloth(col.clone().multiplyScalar(0.8), { roughness: 0.72 });
        const pants = shared('chefPants', () => std(0xffffff, { roughness: 0.85, map: T.check() }));
        const shoe = shared('chefShoe', () => std(0x1c1c1e, { roughness: 0.42 }));
        const skin = M.mat.skin(), nose = noseMat(0xf1c7a0), dark = hairMat(0x3b2a1f);
        // legs, pivoting at the hip
        const legs = [];
        for (const s of [-1, 1]) {
            const hip = new THREE.Group();
            hip.position.set(s * 0.105, 0.86, 0);
            body.add(hip);
            const k = new Kit();
            k.add(lathe([[0, -0.79], [0.058, -0.785], [0.066, -0.6], [0.074, -0.3], [0.082, -0.06], [0.07, 0], [0, 0.02]], 16, 20), pants);
            k.add(roundBox(0.12, 0.075, 0.26, 0.034, 6), shoe, mtx(0, -0.808, 0.04));
            k.add(roundBox(0.124, 0.016, 0.264, 0.007, 4), CH.sole(), mtx(0, -0.842, 0.04));
            k.build(hip);
            legs.push(hip);
        }
        // jacket, collar, buttons, neckerchief, apron
        const tp = [[0, 0.78], [0.18, 0.78], [0.215, 0.84], [0.238, 0.98], [0.248, 1.16], [0.246, 1.3], [0.225, 1.4], [0.17, 1.47], [0.1, 1.51], [0.07, 1.53], [0, 1.535]];
        const rAt = y => { for (let i = 0; i < tp.length - 1; i++) { const a = tp[i], b = tp[i + 1]; if (y >= a[1] && y <= b[1]) return mix(a[0], b[0], (y - a[1]) / ((b[1] - a[1]) || 1)); } return 0.2; };
        const bk = new Kit();
        bk.add(lathe(tp, 28, 36), white);
        bk.add(lathe([[0.074, 1.495], [0.089, 1.5], [0.091, 1.552], [0.08, 1.56]], 24, 0), white);
        for (const [x, y] of [[0.05, 1.18], [0.05, 1.28], [0.05, 1.38], [0.135, 1.18], [0.135, 1.28], [0.13, 1.38]]) {
            const r = rAt(y), z = Math.sqrt(Math.max(0, r * r - x * x));
            bk.add(G.sphere(), accent, mtx(x, y, z + 0.002, 0, Math.atan2(x, z), 0, 0.012, 0.012, 0.006));
        }
        bk.add(tube([0.85, 0.98, 1.12, 1.26, 1.38, 1.46].map(y => { const r = rAt(y); return [0.02, y, Math.sqrt(r * r - 0.0004) + 0.002]; }), 0.0035, 20, 5), white);
        bk.add(G.sphere(), accent, mtx(0, 1.495, 0.085, 0, 0, 0, 0.032, 0.026, 0.024));
        bk.add(ribbon(0.07, 0.04, 0.012, 4, t => -t * 0.01), accent, mtx(0.005, 1.49, 0.095, 0, PI / 2 + 0.25, -1.1));
        bk.add(ribbon(0.06, 0.036, 0.01, 4, t => -t * 0.01), accent, mtx(-0.005, 1.49, 0.095, 0, PI / 2 - 0.3, -1.25));
        const apron = new THREE.LatheGeometry(prof([[0.274, 0.5], [0.264, 0.7], [0.254, 0.9], [0.251, 1.12]], 16), 24, -1.15, 2.3);
        bk.add(apron, shared('apron-' + col.getHexString(), () => cloth(col, { roughness: 0.75, side: THREE.DoubleSide })));
        bk.add(new THREE.TorusGeometry(0.252, 0.012, 6, 40), accentDark, mtx(0, 1.12, 0, PI / 2, 0, 0, 1, 1, 0.8));
        bk.add(roundBox(0.13, 0.085, 0.014, 0.006, 6), accentDark, mtx(0, 0.82, 0.268, -0.05, 0, 0));
        for (const s of [-1, 1]) bk.add(new THREE.TorusGeometry(0.022, 0.008, 6, 14), accentDark, mtx(s * 0.024, 1.11, -0.255, 0, s * 0.5, 0));
        bk.build(body);
        // arms (pivot at the shoulder): sleeve, cuff, mitten hand with a thumb
        const arms = [];
        for (const s of [-1, 1]) {
            const sh = new THREE.Group();
            sh.position.set(s * 0.265, 1.405, 0);
            body.add(sh);
            const k = new Kit();
            k.add(lathe([[0, -0.52], [0.05, -0.515], [0.058, -0.45], [0.064, -0.25], [0.072, -0.06], [0.07, 0.0], [0.05, 0.05], [0, 0.065]], 14, 22), white, mtx(0, 0, 0, 0, 0, s * 0.05));
            k.add(new THREE.CylinderGeometry(0.058, 0.055, 0.035, 14, 1, true), white, mtx(s * -0.026, -0.505, 0, 0, 0, s * 0.05));
            k.add(G.sphere(), skin, mtx(s * -0.024, -0.575, 0.006, 0, 0, 0, 0.05, 0.06, 0.038));
            k.add(G.sphere(), skin, mtx(s * -0.054, -0.552, 0.03, 0.5, 0, s * 0.6, 0.018, 0.03, 0.017));
            k.build(sh);
            arms.push(sh);
        }
        // head: neck, face, ears, big nose, curly mustache, hair under the hat, the toque
        const head = new THREE.Group();
        head.position.set(0, 1.53, 0);
        body.add(head);
        const hk = new Kit();
        hk.add(G.cyl(), skin, mtx(0, 0.03, 0, 0, 0, 0, 0.062, 0.08, 0.062));
        hk.add(G.sphereHi(), skin, mtx(0, 0.17, 0, 0, 0, 0, 0.168, 0.176, 0.162));
        for (const s of [-1, 1]) hk.add(G.sphere(), skin, mtx(s * 0.163, 0.165, -0.005, 0, 0, 0, 0.03, 0.045, 0.024));
        hk.add(G.sphere(), nose, mtx(0, 0.145, 0.165, 0, 0, 0, 0.036, 0.032, 0.034));
        hk.build(head);
        face(head, { ex: 0.058, ey: 0.19, ez: 0.135, my: 0.098, mz: 0.15, brow: dark });
        const mk = new Kit();
        for (const s of [-1, 1]) mk.add(tube([[0, 0.12, 0.17], [s * 0.03, 0.113, 0.166], [s * 0.06, 0.119, 0.153], [s * 0.076, 0.135, 0.138], [s * 0.069, 0.147, 0.134]], t => 0.0145 * Math.sin(PI * (0.15 + 0.85 * t)) * (1 - 0.55 * t) + 0.003, 16, 8), dark);
        mk.add(new THREE.SphereGeometry(0.173, 24, 14, PI, PI, 0.55, 1.3), dark, mtx(0, 0.17, -0.004));
        for (const s of [-1, 1]) mk.add(G.rbox(), dark, mtx(s * 0.159, 0.178, 0.035, 0, 0, 0, 0.012, 0.045, 0.026));
        const band = new THREE.CylinderGeometry(0.166, 0.162, 0.075, 36, 1, true);
        mk.add(band, accent, mtx(0, 0.293, 0));
        mk.build(head);
        const top = lathe([[0.16, 0.328], [0.19, 0.355], [0.213, 0.405], [0.218, 0.455], [0.2, 0.502], [0.15, 0.527], [0.08, 0.537], [0, 0.539]], 48, 36);
        displace(top, v => { const a = Math.atan2(v.z, v.x), k = 1 + 0.075 * Math.pow(Math.abs(Math.sin(a * 5)), 0.7) * smooth(0.34, 0.42, v.y); v.x *= k; v.z *= k; });
        head.add(mesh(top, white));
        // animation: walk cycle, carrying pose, waving (menu)
        let ph = 0, amp = 0, hold = 0, wave = 0;
        const anim = (o, dt) => {
            amp = dampTo(amp, o.moving ? 1 : 0, 8, dt);
            hold = dampTo(hold, o.held ? 1 : 0, 10, dt);
            wave = dampTo(wave, o.wave ? 1 : 0, 6, dt);
            ph += dt * 9.5 * (0.3 + 0.7 * amp);
            const sw = Math.sin(ph) * 0.55 * amp;
            legs[0].rotation.x = sw; legs[1].rotation.x = -sw;
            arms[0].rotation.x = mix(-sw * 0.75, -1.25, hold);
            arms[1].rotation.x = mix(mix(sw * 0.75, -1.25, hold), 0, wave);
            arms[0].rotation.z = mix(-0.08, -0.02, hold);
            arms[1].rotation.z = mix(mix(0.08, 0.02, hold), 2.5 + Math.sin((o.t || 0) * 7) * 0.35, wave);
            body.position.y = Math.abs(Math.sin(ph)) * 0.03 * amp;
            body.rotation.z = Math.sin(ph) * 0.025 * amp;
            head.rotation.x = -(o.pitch || 0) * 0.35 + Math.sin((o.t || 0) * 1.7) * 0.02;
        };
        g.userData = { legs, arms, head, body, anim };
        return g;
    };

    // ---------- guests (and the critic and the health inspector) ----------
    const SKIN = [0xf8d9be, 0xf1c7a0, 0xe0ac84, 0xc68b62, 0x9a6444, 0x6e4430];
    const HAIR = [0x1b1410, 0x2e2018, 0x4a3122, 0x7a4a26, 0xa8642e, 0xd8b26a, 0xbab4aa];
    const PANTS = [0x2f4f7f, 0x384252, 0xb59a6a, 0x5a4636, 0x1f2633, 0x6b6f75];
    const SHOES = [0x202022, 0xefefef, 0x6b3f22, 0x8a2c2c];
    M.person = (o) => {
        o = o || {};
        const g = new THREE.Group();
        const skinHex = pick(SKIN), skin = skinMat(skinHex), nose = noseMat(skinHex);
        const hairHex = o.critic ? 0xbab4aa : Math.random() < 0.08 ? pick([0xe57fb0, 0x5ab0e0, 0x8a5ad8]) : pick(HAIR), hm = hairMat(hairHex);
        const shirt = cloth(o.critic ? 0xf4f1ea : (o.color === undefined ? 0x4aa3df : o.color));
        const pants = cloth(o.critic ? 0x18191e : o.inspector ? 0x24324a : pick(PANTS));
        const shoeHex = o.critic ? 0x0c0c0c : pick(SHOES), shoe = shared('shoe-' + shoeHex, () => std(shoeHex, { roughness: 0.45 }));
        const coat = o.critic ? cloth(0x1a1b21, { roughness: 0.6 }) : null;
        const longSleeve = o.critic || o.inspector || Math.random() < 0.35;
        const sleeve = coat || shirt;
        const pelvis = new THREE.Group();
        pelvis.position.y = 0.9;
        g.add(pelvis);
        const legs = [];
        for (const s of [-1, 1]) {
            const hip = new THREE.Group();
            hip.position.set(s * 0.095, 0, 0);
            pelvis.add(hip);
            const k = new Kit();
            k.add(lathe([[0, -0.44], [0.06, -0.435], [0.066, -0.3], [0.075, -0.08], [0.07, 0.0], [0, 0.03]], 14, 16), pants);
            k.build(hip);
            const knee = new THREE.Group();
            knee.position.y = -0.43;
            hip.add(knee);
            const k2 = new Kit();
            k2.add(lathe([[0, -0.42], [0.05, -0.41], [0.057, -0.25], [0.063, -0.05], [0.06, 0.02], [0, 0.035]], 14, 16), pants);
            k2.add(roundBox(0.1, 0.07, 0.22, 0.03, 6), shoe, mtx(0, -0.432, 0.035));
            k2.add(roundBox(0.104, 0.014, 0.224, 0.006, 4), CH.sole(), mtx(0, -0.462, 0.035));
            k2.build(knee);
            legs.push({ hip, knee });
        }
        const torso = new THREE.Group();
        pelvis.add(torso);
        const tk = new Kit();
        const tp = [[0, -0.08], [0.17, -0.08], [0.186, -0.02], [0.19, 0.12], [0.205, 0.3], [0.204, 0.42], [0.178, 0.5], [0.11, 0.56], [0.06, 0.585], [0, 0.59]];
        tk.add(lathe(tp, 24, 30), coat || shirt);
        tk.add(new THREE.CylinderGeometry(0.189, 0.187, 0.045, 24, 1, true), shared('belt', () => std(0x2a1d14, { roughness: 0.5 })), mtx(0, -0.05, 0));
        if (o.critic) {      // white shirt front, gold waistcoat below it, gold bow tie
            tk.add(new THREE.CylinderGeometry(0.2075, 0.207, 0.2, 20, 1, true, -0.3, 0.6), shirt, mtx(0, 0.44, 0));
            tk.add(new THREE.CylinderGeometry(0.2075, 0.2, 0.3, 20, 1, true, -0.42, 0.84), cloth(0xd8a93a, { roughness: 0.5 }), mtx(0, 0.19, 0));
            for (let i = 0; i < 3; i++) tk.add(G.sphere(), M.mat.gold(), mtx(0, 0.28 - i * 0.07, 0.209, 0, 0, 0, 0.008, 0.008, 0.004));
            for (const s of [-1, 1]) tk.add(G.sphere(), M.mat.gold(), mtx(s * 0.03, 0.52, 0.16, 0, 0, s * 0.4, 0.035, 0.022, 0.016));
            tk.add(G.sphere(), M.mat.gold(), mtx(0, 0.52, 0.168, 0, 0, 0, 0.014, 0.014, 0.012));
        } else if (Math.random() < 0.5) {
            tk.add(new THREE.TorusGeometry(0.075, 0.012, 6, 24), shirt, mtx(0, 0.565, 0.015, PI / 2 - 0.2, 0, 0));     // collar
        }
        if (o.inspector) {
            tk.add(roundBox(0.045, 0.06, 0.006, 0.003, 4), shared('badge', () => std(0xf8f8f8, { roughness: 0.4 })), mtx(-0.09, 0.38, 0.19, 0, -0.35, 0));
            tk.add(G.cylLo(), shared('pen', () => std(0x2b5fd9, { roughness: 0.3 })), mtx(0.09, 0.4, 0.19, 0.1, 0, 0, 0.005, 0.07, 0.005));
        }
        tk.build(torso);
        const arms = [];
        for (const s of [-1, 1]) {
            const sh = new THREE.Group();
            sh.position.set(s * 0.215, 0.49, 0);
            torso.add(sh);
            const k = new Kit();
            k.add(lathe([[0, -0.29], [0.044, -0.285], [0.049, -0.15], [0.056, -0.02], [0.05, 0.03], [0, 0.05]], 12, 14), longSleeve ? sleeve : skin);
            if (!longSleeve) k.add(lathe([[0, -0.135], [0.053, -0.135], [0.0575, -0.02], [0.052, 0.035], [0, 0.054]], 12, 10), sleeve);
            k.build(sh);
            const el = new THREE.Group();
            el.position.y = -0.28;
            sh.add(el);
            const k2 = new Kit();
            k2.add(lathe([[0, -0.25], [0.037, -0.245], [0.041, -0.12], [0.045, -0.01], [0.04, 0.02], [0, 0.03]], 12, 14), longSleeve ? sleeve : skin);
            k2.add(G.sphere(), skin, mtx(0, -0.285, 0.004, 0, 0, 0, 0.042, 0.05, 0.03));
            k2.add(G.sphere(), skin, mtx(-s * 0.026, -0.268, 0.024, 0.4, 0, -s * 0.5, 0.014, 0.025, 0.013));
            k2.build(el);
            arms.push({ sh, el });
        }
        // a fork in the right hand, shown while eating
        const fork = new THREE.Group(), fk = new Kit(), steel = M.mat.steel();
        fk.add(roundBox(0.012, 0.11, 0.005, 0.002, 4), steel, mtx(0, 0.02, 0));
        for (let i = 0; i < 3; i++) fk.add(G.box(), steel, mtx((i - 1) * 0.0045, 0.092, 0, 0, 0, 0, 0.0018, 0.035, 0.0018));
        fk.build(fork, false);
        fork.position.set(0, -0.3, 0.03);
        fork.rotation.set(1.2, 0, 0);
        fork.visible = false;
        arms[1].el.add(fork);
        if (o.inspector) {      // clipboard held in the left hand
            const cb = new THREE.Group(), k = new Kit();
            k.add(roundBox(0.24, 0.32, 0.012, 0.01, 6), M.mat.wood(), mtx(0, 0, 0));
            k.add(G.box(), shared('paper', () => std(0xfbfaf4, { roughness: 0.9 })), mtx(0, -0.015, 0.0075, 0, 0, 0, 0.21, 0.27, 0.002));
            k.add(roundBox(0.08, 0.03, 0.016, 0.005, 4), M.mat.steel(), mtx(0, 0.15, 0.008));
            k.build(cb);
            cb.position.set(0.07, -0.3, 0.09);
            cb.rotation.set(-1.15, 0, -0.15);
            arms[0].el.add(cb);
        }
        // head
        const head = new THREE.Group();
        head.position.set(0, 0.585, 0);
        torso.add(head);
        const hc = 0.165, hr = 0.15, hk = new Kit();
        hk.add(G.cyl(), skin, mtx(0, 0.03, 0, 0, 0, 0, 0.055, 0.09, 0.055));
        hk.add(G.sphereHi(), skin, mtx(0, hc, 0, 0, 0, 0, hr, hr * 1.05, hr * 0.96));
        for (const s of [-1, 1]) hk.add(G.sphere(), skin, mtx(s * hr * 0.97, hc - 0.005, -0.004, 0, 0, 0, 0.026, 0.04, 0.02));
        hk.add(G.sphere(), nose, mtx(0, hc - 0.012, hr * 0.95, 0, 0, 0, 0.022, 0.024, 0.024));
        hk.build(head);
        const setMood = face(head, { ex: 0.052, ey: hc + 0.02, ez: 0.126, my: hc - 0.064, mz: 0.133, brow: hm, eye: 0.88 });
        let style = pick(['short', 'short', 'bob', 'ponytail', 'bun', 'curly', 'spiky', 'bald', 'beanie', 'cap']);
        if (o.critic || o.inspector) style = o.critic ? 'short' : 'bald';
        hairdo(head, style, hm, hc, hr);
        if (style === 'beanie' || style === 'cap') headwear(head, style, pick([0xd84a4a, 0x2f9e8f, 0xf2b33d, 0x5a5ad8, 0x333333]), hc, hr);
        if (o.critic) {
            headwear(head, 'tophat', 0, hc, hr);
            const mk = new Kit(), gray = hairMat(0xd8d4cc);
            for (const s of [-1, 1]) mk.add(tube([[0, hc - 0.045, hr * 0.93], [s * 0.028, hc - 0.05, hr * 0.9], [s * 0.052, hc - 0.04, hr * 0.82], [s * 0.06, hc - 0.022, hr * 0.78]], t => 0.009 * Math.sin(PI * (0.15 + 0.85 * t)) * (1 - 0.5 * t) + 0.002, 12, 6), gray);
            mk.build(head);
            const mono = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0035, 6, 20), M.mat.gold());
            mono.position.set(0.052, hc + 0.02, 0.15);
            head.add(mono);
            const chain = tube([[0.08, hc + 0.0, 0.14], [0.11, hc - 0.08, 0.12], [0.12, hc - 0.18, 0.1]], 0.0012, 10, 4);
            head.add(mesh(chain, M.mat.gold()));
        }
        if (o.inspector) { headwear(head, 'inspector', 0, hc, hr); glasses(head, 0.052, hc + 0.02, 0.126, 0x222222); }
        else if (!o.critic && Math.random() < 0.25) glasses(head, 0.052, hc + 0.02, 0.126, pick([0x222222, 0x6b3f22, 0x9a1f3f]));
        // animation: walk in, sit, wait (impatient when patience runs low), eat, walk out. c = the customer (null = stand)
        let ph = R(0, 10), amp = 0, sitK = 0, eatT = R(0, 2), lookY = 0, lookTo = 0, lookT = 0, t = R(0, 10);
        const anim = (c, dt) => {
            t += dt;
            const st = c ? c.st : 'stand';
            const walking = st === 'walk' || st === 'leave', sitting = st === 'wait' || st === 'eat';
            sitK = dampTo(sitK, sitting ? 1 : 0, 7, dt);
            amp = dampTo(amp, walking ? 1 : 0, 8, dt);
            ph += dt * 8.2;
            const sw = Math.sin(ph) * 0.45 * amp;
            pelvis.position.y = mix(0.9 + Math.abs(Math.cos(ph)) * 0.022 * amp, 0.53, sitK);
            pelvis.position.z = mix(0, -0.05, sitK);
            legs.forEach((L, i) => {
                const s = i ? -1 : 1;
                L.hip.rotation.x = mix(sw * s, -1.5, sitK);
                L.knee.rotation.x = mix(Math.max(0, Math.sin(ph + (i ? PI : 0))) * 0.55 * amp + 0.05, 1.5, sitK);
            });
            const f = c && c.max ? clamp(c.pat / c.max, 0, 1) : 1;
            let a0 = [-0.06 - sw * 0.0, 0], a1 = [0, 0];
            let mood = 'smile';
            if (sitting) {
                a0 = [-0.55, -1.0]; a1 = [-0.55, -1.0];
                if (st === 'eat') {
                    eatT += dt;
                    const cyc = (eatT % 1.8) / 1.8, lift = Math.sin(clamp(cyc / 0.55, 0, 1) * PI);
                    a1 = [mix(-0.55, -1.05, lift), mix(-1.0, -2.35, lift)];
                    mood = lift > 0.55 ? 'o' : c.happy === false ? 'angry' : 'smile';
                } else {
                    mood = f < 0.25 ? 'angry' : f < 0.5 ? 'neutral' : 'smile';
                    if (f < 0.35) a1[1] += Math.max(0, Math.sin(t * 16)) * 0.18;      // drumming fingers
                }
            } else if (walking) {
                a0 = [-sw * 0.9, -0.2]; a1 = [sw * 0.9, -0.2];
                mood = st === 'leave' && c.happy !== true ? 'angry' : 'smile';
            } else if (o.inspector) {
                a0 = [-0.42, -1.25]; a1 = [-0.55, -1.3 + Math.sin(t * 9) * 0.06];
                mood = 'neutral';
            }
            arms[0].sh.rotation.x = dampTo(arms[0].sh.rotation.x, a0[0], 9, dt);
            arms[0].el.rotation.x = dampTo(arms[0].el.rotation.x, a0[1], 9, dt);
            arms[1].sh.rotation.x = dampTo(arms[1].sh.rotation.x, a1[0], 9, dt);
            arms[1].el.rotation.x = dampTo(arms[1].el.rotation.x, a1[1], 9, dt);
            arms[0].sh.rotation.z = -0.07; arms[1].sh.rotation.z = 0.07;
            setMood(mood);
            fork.visible = st === 'eat';
            // look around now and then (shake the head when really impatient)
            lookT -= dt;
            if (lookT <= 0) { lookT = R(1.5, 4); lookTo = R(-0.6, 0.6); }
            lookY = dampTo(lookY, o.inspector ? Math.sin(t * 0.6) * 0.6 : lookTo, 3, dt);
            head.rotation.y = lookY + (sitting && st === 'wait' && f < 0.2 ? Math.sin(t * 10) * 0.25 : 0);
            head.rotation.x = o.inspector ? 0.25 : st === 'eat' ? 0.15 : 0;
            torso.rotation.x = st === 'eat' ? 0.12 : 0;
        };
        g.userData = { anim, setMood, legs, arms, head, pelvis };
        g.traverse(m => { if (m.isMesh) m.castShadow = true; });
        return g;
    };

    // ---------- the rat ----------
    M.rat = () => {
        const g = new THREE.Group();
        const fur = std(0x8f8883, { roughness: 0.92, vertexColors: true, bumpMap: T.fur(), bumpScale: 0.0015 });
        const pink = shared('ratPink', () => std(0xf2a5ae, { roughness: 0.5 }));
        const eye = shared('ratEye', () => std(0x050505, { roughness: 0.08 }));
        const body = new THREE.Group();
        g.add(body);
        const bg = new THREE.SphereGeometry(1, 24, 16);
        displace(bg, v => { const k = 1 + 0.14 * smooth(0.3, -1, v.z); v.x *= k; v.y *= k; });
        bg.scale(0.062, 0.056, 0.118);
        vcolor(bg, (x, y) => { const b = smooth(-0.01, -0.045, y); return [mix(0.92, 1.35, b), mix(0.92, 1.3, b), mix(0.92, 1.26, b)]; });
        const k = new Kit();
        k.add(bg, fur, mtx(0, 0.07, -0.01));
        const hg = new THREE.SphereGeometry(1, 20, 14);
        hg.scale(0.047, 0.044, 0.062);
        vcolor(hg, (x, y) => { const b = smooth(0.0, -0.03, y); return [mix(0.95, 1.3, b), mix(0.95, 1.26, b), mix(0.95, 1.22, b)]; });
        k.add(hg, fur, mtx(0, 0.083, 0.098));
        const snout = lathe([[0, -0.05], [0.028, -0.045], [0.03, -0.02], [0.022, 0.012], [0.012, 0.03], [0, 0.036]], 16, 20);
        snout.rotateX(PI / 2);
        vcolor(snout, () => [1.05, 1.05, 1.05]);
        k.add(snout, fur, mtx(0, 0.079, 0.15, 0, 0, 0, 1, 0.85, 1));
        k.add(G.sphere(), pink, mtx(0, 0.08, 0.188, 0, 0, 0, 0.0095, 0.008, 0.008));
        for (const s of [-1, 1]) {
            k.add(G.sphere(), eye, mtx(s * 0.026, 0.102, 0.135, 0, 0, 0, 0.0095, 0.0105, 0.0085));
            const ear = new THREE.SphereGeometry(0.03, 14, 10, 0, TAU, 0, 1.25);
            k.add(ear, fur, mtx(s * 0.033, 0.123, 0.088, -0.25, s * 0.35, s * -0.5, 1, 0.5, 1));
            k.add(new THREE.CircleGeometry(0.022, 14), pink, mtx(s * 0.0345, 0.124, 0.0935, -0.25 - PI / 2 + 0.4, s * 0.35, s * -0.5));
            for (let i = 0; i < 3; i++) k.add(tube([[s * 0.014, 0.08, 0.172], [s * 0.04, 0.078 + (i - 1) * 0.008, 0.17], [s * 0.07, 0.074 + (i - 1) * 0.018, 0.162]], 0.0006, 6, 3), shared('whisker', () => std(0xe8e4e0, { roughness: 0.6 })));
        }
        for (const s of [-1, 1]) k.add(G.box(), shared('tooth', () => std(0xfffbe8, { roughness: 0.3 })), mtx(s * 0.003, 0.066, 0.181, 0, 0, 0, 0.005, 0.009, 0.002));
        k.build(body);
        k.parts.clear();
        const shine = new THREE.Mesh(G.sphereLo(), CH.shine());
        for (const s of [-1, 1]) { const sp = shine.clone(); sp.position.set(s * 0.024, 0.106, 0.143); sp.scale.setScalar(0.0028); body.add(sp); }
        // legs
        const feet = [];
        for (const [x, z] of [[-0.035, 0.065], [0.035, 0.065], [-0.04, -0.06], [0.04, -0.06]]) {
            const p = new THREE.Group();
            p.position.set(x, 0.035, z);
            body.add(p);
            const fk = new Kit();
            fk.add(G.cylLo(), fur, mtx(0, -0.015, 0, 0, 0, 0, 0.011, 0.03, 0.011), [1.1, 1.1, 1.1]);
            fk.add(G.sphere(), pink, mtx(0, -0.032, 0.008, 0, 0, 0, 0.012, 0.006, 0.02));
            fk.build(p);
            feet.push(p);
        }
        // tail: a chain of segments that waves
        const tail = [];
        let parent = body;
        for (let i = 0; i < 12; i++) {
            const seg = new THREE.Group();
            seg.position.set(0, i ? 0 : 0.055, i ? -0.022 : -0.125);
            parent.add(seg);
            const r0 = 0.0075 * (1 - i / 12) + 0.0012, r1 = 0.0075 * (1 - (i + 1) / 12) + 0.0012;
            const c = new THREE.CylinderGeometry(r1, r0, 0.023, 7);
            c.rotateX(PI / 2);
            c.translate(0, 0, -0.011);
            seg.add(mesh(c, pink));
            seg.rotation.x = i ? 0.09 : 0.25;
            tail.push(seg);
            parent = seg;
        }
        const mouth = new THREE.Group();
        mouth.position.set(0, 0.062, 0.2);
        body.add(mouth);
        let t = 0, lx = null, lz = 0, speed = 0, carried = null, carryMesh = null;
        g.userData.anim = (dt, r) => {
            t += dt;
            const p = g.position;
            if (lx !== null && dt > 0) speed = dampTo(speed, Math.hypot(p.x - lx, p.z - lz) / dt, 10, dt);
            lx = p.x; lz = p.z;
            const run = clamp(speed / 1.5, 0, 1), cyc = t * 22;
            feet.forEach((f, i) => { f.rotation.x = Math.sin(cyc + (i === 0 || i === 3 ? 0 : PI)) * 0.8 * run; });
            body.position.y = Math.abs(Math.sin(cyc)) * 0.01 * run;
            tail.forEach((s, i) => { s.rotation.y = Math.sin(t * (run ? 14 : 4) - i * 0.55) * (0.12 + 0.12 * run); });
            const want = r && r.carry ? r.carry : null;
            if (want !== carried) {
                if (carryMesh) mouth.remove(carryMesh);
                carryMesh = null; carried = want;
                if (want && CF.ITEMS[want]) {
                    carryMesh = M.item(want);
                    const b = new THREE.Box3().setFromObject(carryMesh), sz = b.getSize(new V3());
                    carryMesh.scale.setScalar(Math.min(1, 0.07 / Math.max(sz.x, sz.y, sz.z, 0.001)));
                    mouth.add(carryMesh);
                }
            }
        };
        return g;
    };

    // Name tag above other players
    M.nameTag = (text, color) => {
        const t = M.canvasTex(512, 128, (c, w, h) => {
            const r = 44, x = 10, y = 14, ww = w - 20, hh = h - 28;
            c.beginPath();
            c.moveTo(x + r, y); c.arcTo(x + ww, y, x + ww, y + hh, r); c.arcTo(x + ww, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + ww, y, r); c.closePath();
            c.fillStyle = 'rgba(14,20,36,0.82)'; c.fill();
            c.lineWidth = 7; c.strokeStyle = color; c.stroke();
            const s = String(text).slice(0, 14);
            let size = 60;
            c.font = `bold ${size}px Fredoka, Arial`;
            while (c.measureText(s).width > ww - 50 && size > 30) { size -= 4; c.font = `bold ${size}px Fredoka, Arial`; }
            c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(s, w / 2, h / 2 + 3);
        });
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
        s.scale.set(0.8, 0.2, 1);
        s.renderOrder = 10;
        return s;
    };
    return M;
})();
