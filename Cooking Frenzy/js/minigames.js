'use strict';
// Skill minigames on a 2D canvas over the game: chop, flip, stir, season, wash.
// The mouse stays pointer-locked; its movement drives a virtual cursor inside the panel.
// Right-click / Q / Esc cancels. Each one ends with CF.Sync.act(result) and a short result banner.
CF.MG = (() => {
    const G = { active: null };
    const PW = 720, PH = 480;
    let cv, g, dpr = 1, sc = 1, ox = 0, oy = 0, data = null, st = null, endedAt = 0, doneT = 0, result = null, t = 0, flash = 0;
    const cur = { x: PW / 2, y: PH / 2 };
    const has = id => CF.Profile.has(id) && CF.SKILL[id] && CF.Player.role === CF.SKILL[id].role;
    const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
    const GOOD = '#46d17a', OK = '#ffd166', BAD = '#ff6b5b';

    G.init = () => {
        cv = CF.$('#mg');
        g = cv.getContext('2d');
        resize();
        addEventListener('resize', resize);
        document.addEventListener('mousemove', e => {
            if (!G.active || doneT) return;
            const k = (0.55 + 0.45 * CF.settings.sens) / sc;
            const dx = CF.clamp(e.movementX, -200, 200) * k, dy = CF.clamp(e.movementY, -200, 200) * k;
            cur.x = CF.clamp(cur.x + dx, 0, PW);
            cur.y = CF.clamp(cur.y + dy, 0, PH);
            const K = KIND[G.active];
            if (K.move) K.move(dx, dy);
        });
        document.addEventListener('mousedown', e => {
            if (!G.active) return;
            if (e.button === 2) { G.cancel(); return; }
            const K = KIND[G.active];
            if (e.button === 0 && !doneT && K.click) K.click();
        });
        addEventListener('keydown', e => { if (G.active && (e.code === 'KeyQ' || e.code === 'Escape')) G.cancel(); });
    };
    function resize() {
        dpr = Math.min(devicePixelRatio || 1, 2);
        cv.width = Math.round(innerWidth * dpr);
        cv.height = Math.round(innerHeight * dpr);
        sc = Math.min(innerWidth / (PW + 40), innerHeight / (PH + 110), 1.6);
        ox = (innerWidth - PW * sc) / 2;
        oy = (innerHeight - PH * sc) / 2 + 10;
    }

    // true while a minigame runs and for a moment after, so the click that ends one isn't also a grab
    G.busy = () => !!G.active || performance.now() - endedAt < 250;
    G.start = (kind, d) => {
        if (G.active || !KIND[kind] || !d) return false;
        const it = CF.Items.get(d.id);
        if (!it || !KIND[kind].valid(it)) return false;
        data = d; G.active = kind; doneT = 0; result = null; flash = 0;
        cur.x = PW / 2; cur.y = PH / 2;
        st = KIND[kind].build(d, it);
        cv.classList.remove('hidden');
        CF.Audio.play('click');
        return true;
    };
    G.cancel = () => { if (G.active) close(); };
    function close() {
        G.active = null; data = null; st = null; result = null; doneT = 0;
        cv.classList.add('hidden');
        endedAt = performance.now();
    }
    function finish(text, col, a, dur) {
        if (doneT) return;
        result = { text, col, dur: dur || 0.85 };
        doneT = result.dur;
        if (a) CF.Sync.act(a);
        CF.Audio.play(col === GOOD ? 'star' : 'pop');
    }
    G.update = dt => {
        if (!G.active) return;
        t += dt;
        flash = Math.max(0, flash - dt);
        const K = KIND[G.active], it = CF.Items.get(data.id);
        if (doneT) {
            doneT -= dt;
            if (doneT <= 0) { close(); return; }
        } else if (!it || !K.valid(it)) {
            close();
            CF.UI.toast('Minigame cancelled: it moved away.', 'info');
            return;
        }
        K.tick(dt);
        draw();
    };

    // ---------- drawing helpers ----------
    function rr(x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    function txt(s, x, y, size, col, align, font) {
        g.font = `${font || '600'} ${size}px Fredoka, Arial, sans-serif`;
        g.textAlign = align || 'center'; g.textBaseline = 'middle';
        g.fillStyle = col || '#fff';
        g.fillText(s, x, y);
    }
    function title(s) { g.font = `${26}px Bungee, Fredoka, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd166'; g.fillText(s, PW / 2, 34); }
    function hint(s) { txt(s, PW / 2, PH - 22, 15, 'rgba(255,255,255,0.75)', 'center', '500'); }
    function bar(x, y, w, h, f, col, label) {
        rr(x, y, w, h, h / 2); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
        if (f > 0) { rr(x, y, Math.max(h, w * CF.clamp(f, 0, 1)), h, h / 2); g.fillStyle = col; g.fill(); }
        if (label) txt(label, x + w / 2, y + h / 2 + 1, h - 4, '#fff', 'center', '700');
    }
    function draw() {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cv.width, cv.height);
        g.fillStyle = 'rgba(8,12,22,0.55)';
        g.fillRect(0, 0, cv.width, cv.height);
        if (flash > 0) { g.fillStyle = `rgba(255,40,40,${flash})`; g.fillRect(0, 0, cv.width, cv.height); }
        g.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
        rr(0, 0, PW, PH, 26);
        const bg = g.createLinearGradient(0, 0, 0, PH);
        bg.addColorStop(0, '#22345a'); bg.addColorStop(1, '#162238');
        g.fillStyle = bg; g.fill();
        g.lineWidth = 5; g.strokeStyle = '#ffd166'; g.stroke();
        g.save();
        rr(0, 0, PW, PH, 26); g.clip();
        KIND[G.active].draw();
        g.restore();
        if (result) {
            const a = CF.clamp((result.dur - doneT) / 0.16, 0, 1);
            const s = 0.6 + 0.5 * a - 0.1 * Math.max(0, a - 0.7) / 0.3;
            g.save();
            g.translate(PW / 2, PH / 2);
            g.scale(s, s);
            g.rotate(-0.04);
            rr(-250, -42, 500, 84, 20);
            g.fillStyle = 'rgba(16,22,38,0.92)'; g.fill();
            g.lineWidth = 5; g.strokeStyle = result.col; g.stroke();
            g.font = '30px Bungee, Fredoka, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillStyle = result.col; g.fillText(result.text, 0, 3, 470);
            g.restore();
        }
    }

    // ---------- the minigames ----------
    const KIND = {};

    // CHOP: the knife follows the mouse, click on the dashed lines. Don't cut the hand holding the food.
    KIND.chop = {
        build(d, it) {
            const ch = it.def.chop || {};
            const n = Array.isArray(ch.to) ? 1 : CF.clamp(ch.n || 2, 2, 5);
            const x0 = 190, x1 = 530, lines = [];
            for (let i = 1; i <= n; i++) lines.push({ x: x0 + (x1 - x0) * i / (n + 1), cut: false, acc: 0, a: 0 });
            let tol = 13;
            if (has('quickknife')) tol *= 1.9;
            if (CF.Orders.has('knives')) tol *= 1.5;
            return {
                lines, tol, x0: x0 - 50, x1: x1 + 50, ouch: 0, miss: 0, knife: 0,
                col: hex(it.def.cook ? it.def.cook.raw : 0xcccccc), icon: it.def.icon, name: it.def.name.toLowerCase(),
                round: it.def.shape.t === 'sphere', safe: has('quickknife')
            };
        },
        valid: it => it.heldBy === null && !it.container && !!(it.def.chop),
        hand() {
            const l = st.lines.find(x => !x.cut);
            if (!l) return null;
            const gap = st.safe ? 85 : 20 + 30 * (0.5 + 0.5 * Math.sin(t * 2.6));
            return { x: l.x + gap, y: 250 };
        },
        tick(dt) {
            st.knife = Math.max(0, st.knife - dt * 7);
            for (const l of st.lines) if (l.cut) l.a = Math.min(1, l.a + dt * 5);
        },
        click() {
            st.knife = 1;
            const hd = KIND.chop.hand();
            if (hd && Math.abs(cur.x - hd.x) < 22) { st.ouch++; flash = 0.35; CF.Audio.play('ouch'); return; }
            let best = null, bd = 1e9;
            for (const l of st.lines) if (!l.cut) { const dd = Math.abs(l.x - cur.x); if (dd < bd) { bd = dd; best = l; } }
            if (!best) return;
            if (bd <= st.tol) { best.cut = true; best.acc = 1 - (bd / st.tol) * 0.55; CF.Audio.play('chop'); }
            else { st.miss++; CF.Audio.play('thud'); }
            if (st.lines.every(l => l.cut)) {
                const avg = st.lines.reduce((a, l) => a + l.acc, 0) / st.lines.length;
                const q = CF.clamp(avg - st.ouch * 0.15 - st.miss * 0.04, 0.15, 1);
                finish(q >= 0.9 ? 'PERFECT CUTS!' : q >= 0.7 ? 'NICE CUTS!' : q >= 0.45 ? 'A BIT MESSY…' : 'BUTCHERED!', q >= 0.7 ? GOOD : q >= 0.45 ? OK : BAD, { t: 'chop', id: data.id, q: CF.r3(q) });
            }
        },
        draw() {
            title(`✂️ CUT THE ${st.name.toUpperCase()}`);
            // board
            rr(70, 120, 580, 270, 22); g.fillStyle = '#c68d55'; g.fill();
            g.strokeStyle = 'rgba(90,50,20,0.25)'; g.lineWidth = 2;
            for (let i = 0; i < 9; i++) { g.beginPath(); const y = 140 + i * 28; g.moveTo(80, y); g.bezierCurveTo(260, y + 8, 460, y - 8, 640, y + 3); g.stroke(); }
            // food, split at every cut line (pieces slide apart a little)
            const bounds = [st.x0, ...st.lines.map(l => l.x), st.x1];
            const fy0 = 178, fy1 = 322;
            for (let i = 0; i < bounds.length - 1; i++) {
                let off = 0;
                for (let k = 0; k < st.lines.length && k < i; k++) off += st.lines[k].cut ? 7 * st.lines[k].a : 0;
                g.save();
                g.beginPath(); g.rect(bounds[i] + off, fy0 - 20, bounds[i + 1] - bounds[i], fy1 - fy0 + 40); g.clip();
                g.translate(off, 0);
                g.fillStyle = st.col;
                if (st.round) { g.beginPath(); g.ellipse((st.x0 + st.x1) / 2, 250, (st.x1 - st.x0) / 2, 72, 0, 0, Math.PI * 2); g.fill(); }
                else { rr(st.x0, fy0, st.x1 - st.x0, fy1 - fy0, 26); g.fill(); }
                g.fillStyle = 'rgba(255,255,255,0.22)';
                if (st.round) { g.beginPath(); g.ellipse((st.x0 + st.x1) / 2 - 40, 222, 110, 20, -0.1, 0, Math.PI * 2); g.fill(); }
                else { rr(st.x0 + 12, fy0 + 10, st.x1 - st.x0 - 24, 18, 9); g.fill(); }
                g.restore();
            }
            // lines
            for (const l of st.lines) {
                if (l.cut) continue;
                g.fillStyle = 'rgba(255,255,255,0.10)';
                g.fillRect(l.x - st.tol, fy0 - 12, st.tol * 2, fy1 - fy0 + 24);
                g.setLineDash([10, 9]); g.lineWidth = 3; g.strokeStyle = '#fff';
                g.beginPath(); g.moveTo(l.x, fy0 - 18); g.lineTo(l.x, fy1 + 18); g.stroke();
                g.setLineDash([]);
            }
            // the other hand
            const hd = KIND.chop.hand();
            if (hd) {
                g.fillStyle = '#f1c7a0'; g.strokeStyle = '#c99872'; g.lineWidth = 3;
                for (let i = 0; i < 4; i++) { rr(hd.x - 22, hd.y - 44 + i * 22, 30, 17, 8); g.fill(); g.stroke(); }
                g.beginPath(); g.ellipse(hd.x + 20, hd.y, 26, 44, 0, 0, Math.PI * 2); g.fill(); g.stroke();
            }
            // knife
            const kx = cur.x, ky = 90 + st.knife * 70;
            g.fillStyle = '#3a2618'; rr(kx - 9, ky - 50, 18, 56, 6); g.fill();
            g.fillStyle = '#c0c0c0'; rr(kx - 3, ky + 4, 16, 6, 3); g.fill();
            const bl = g.createLinearGradient(kx - 6, 0, kx + 8, 0);
            bl.addColorStop(0, '#eef3f6'); bl.addColorStop(1, '#9aa6ad');
            g.fillStyle = bl;
            g.beginPath(); g.moveTo(kx - 6, ky + 8); g.lineTo(kx + 8, ky + 8); g.lineTo(kx + 8, ky + 190); g.lineTo(kx - 6, ky + 175); g.closePath(); g.fill();
            txt(st.icon, 110, 84, 38, '#fff');
            txt(`Cuts ${st.lines.filter(l => l.cut).length}/${st.lines.length}${st.ouch ? '   🩹 ' + st.ouch : ''}`, PW - 110, 84, 18, '#fff');
            hint('Click on the dashed lines · watch your fingers! · Right-click / Q: cancel');
        }
    };

    // FLIP: a needle swings up and down the power bar, click while it is in the green zone
    KIND.flip = {
        build(d, it) {
            let zone = 0.15;
            if (has('flipper')) zone *= 1.5;
            if (CF.Orders.has('nonstick')) zone *= 1.35;
            const f = it.contents.map(id => CF.Items.get(id)).find(x => x && x.def.sides);
            return { p: 0.05, dir: 1, speed: CF.rand(1.05, 1.35), zone: Math.min(zone, 0.42), c: CF.rand(0.55, 0.7), res: null, anim: 0, col: hex(f && f.def.cook ? f.def.cook.done : 0x8a4a2a) };
        },
        valid: it => it.type === 'pan' && it.contents.some(id => { const f = CF.Items.get(id); return f && f.def.sides; }),
        tick(dt) {
            if (st.res) { st.anim += dt; return; }
            st.p += st.dir * st.speed * dt * (0.8 + 0.5 * st.p);    // faster near the top
            if (st.p >= 1) { st.p = 1; st.dir = -1; } else if (st.p <= 0) { st.p = 0; st.dir = 1; }
        },
        click() {
            const lo = st.c - st.zone / 2, hi = st.c + st.zone / 2;
            const r = st.p < lo ? 'weak' : st.p > hi ? 'wild' : 'good';
            st.res = r;
            CF.Audio.play(r === 'wild' ? 'whoosh' : 'flip');
            finish(r === 'good' ? 'PERFECT FLIP!' : r === 'weak' ? 'TOO SOFT!' : 'WAY TOO HARD!', r === 'good' ? GOOD : r === 'weak' ? OK : BAD, { t: 'flip', id: data.id, r }, 1.0);
        },
        draw() {
            title('🍳 FLIP IT!');
            // burner + pan
            const px = 280, py = 340;
            for (let i = 0; i < 9; i++) {
                const fx = px - 110 + i * 27, fh = 18 + Math.sin(t * 20 + i * 1.7) * 7;
                g.fillStyle = i % 2 ? '#4aa8ff' : '#7cc2ff';
                g.beginPath(); g.moveTo(fx - 8, py + 46); g.quadraticCurveTo(fx, py + 46 - fh * 2, fx + 8, py + 46); g.fill();
            }
            g.fillStyle = '#2b2f35'; g.beginPath(); g.ellipse(px, py, 150, 34, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#16181b'; g.beginPath(); g.ellipse(px, py - 6, 132, 24, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#2b2b2b'; rr(px + 140, py - 12, 150, 22, 10); g.fill();
            // patty
            let fy = py - 16, rot = 0, fx = px, show = true;
            if (st.res) {
                const a = Math.min(1, st.anim / 0.7);
                if (st.res === 'good') { fy = py - 16 - Math.sin(a * Math.PI) * 170; rot = a * Math.PI; }
                else if (st.res === 'weak') { fy = py - 16 - Math.sin(a * Math.PI) * 30; rot = a * 0.4 * Math.sin(a * Math.PI); }
                else { fy = py - 16 - a * 420; fx = px + a * 300; rot = a * 9; show = a < 1; }
            }
            if (show) {
                g.save(); g.translate(fx, fy); g.scale(1, Math.abs(Math.cos(rot)) * 0.8 + 0.2);
                g.fillStyle = st.col; g.beginPath(); g.ellipse(0, 0, 80, 22, 0, 0, Math.PI * 2); g.fill();
                g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.ellipse(-18, -7, 40, 7, 0, 0, Math.PI * 2); g.fill();
                g.restore();
            }
            // power bar
            const bx = 590, by = 80, bh = 320;
            rr(bx - 26, by - 10, 52, bh + 20, 18); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill();
            const gr = g.createLinearGradient(0, by + bh, 0, by);
            gr.addColorStop(0, '#3fa7ff'); gr.addColorStop(0.5, '#ffd166'); gr.addColorStop(1, '#ff4d4d');
            rr(bx - 14, by, 28, bh, 12); g.fillStyle = gr; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
            const zy0 = by + bh - (st.c + st.zone / 2) * bh, zy1 = by + bh - (st.c - st.zone / 2) * bh;
            rr(bx - 20, zy0, 40, zy1 - zy0, 8); g.fillStyle = GOOD; g.fill();
            g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
            const ny = by + bh - st.p * bh;
            g.fillStyle = '#fff';
            g.beginPath(); g.moveTo(bx - 34, ny); g.lineTo(bx - 50, ny - 11); g.lineTo(bx - 50, ny + 11); g.closePath(); g.fill();
            g.fillRect(bx - 26, ny - 2, 52, 4);
            txt('WILD', bx, by - 26, 14, BAD, 'center', '700');
            txt('SOFT', bx, by + bh + 26, 14, '#7cc2ff', 'center', '700');
            hint('Click when the needle is in the GREEN zone · Right-click / Q: cancel');
        }
    };

    // STIR: circle the mouse around the pot. Too slow does nothing, too fast spills.
    KIND.stir = {
        build(d, it) {
            return { prog: 0, last: null, w: 0, ang: 0, inBand: 0, total: 0, spill: false, splashT: 0, drops: [], rate: has('stirpro') ? 0.5 : 0.25, col: it.s.soup ? '#d8432c' : '#8fd3ff' };
        },
        valid: it => it.type === 'pot' && !!(it.s.soup || it.s.water),
        tick(dt) {
            st.drops = st.drops.filter(p => (p.life -= dt) > 0);
            for (const p of st.drops) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; }
            if (doneT) return;
            const cx = PW / 2, cy = 262, dx = cur.x - cx, dy = cur.y - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
            let w = 0;
            if (st.last !== null && r > 35) {
                let da = a - st.last;
                while (da > Math.PI) da -= Math.PI * 2;
                while (da < -Math.PI) da += Math.PI * 2;
                w = Math.abs(da) / Math.max(dt, 1e-3);
                st.ang += da;
            }
            st.last = a;
            st.w = CF.damp(st.w, w, 5, dt);
            st.total += dt;
            if (st.w >= 3 && st.w <= 8.5) { st.prog += st.rate * dt; st.inBand += dt; }
            else if (st.w > 12) {
                st.spill = true;
                st.splashT -= dt;
                if (st.splashT <= 0) {
                    st.splashT = 0.25;
                    CF.Audio.play('splash');
                    for (let i = 0; i < 7; i++) st.drops.push({ x: cx + Math.cos(a) * 150, y: cy + Math.sin(a) * 150, vx: Math.cos(a) * CF.rand(80, 220), vy: CF.rand(-240, -80), life: 0.9 });
                }
            }
            if (st.prog >= 1 || st.total > 16) {
                const q = CF.clamp(st.prog >= 1 ? st.inBand / st.total * 1.25 : st.prog * 0.6, 0, 1);
                finish(st.spill ? 'SPLASHY… BUT STIRRED' : q > 0.75 ? 'SMOOTH STIRRING!' : 'STIRRED!', st.spill ? OK : GOOD, { t: 'stir', id: data.id, q: CF.r3(q), spill: st.spill });
            }
        },
        draw() {
            title('🥄 STIR THE POT');
            const cx = PW / 2, cy = 262;
            g.fillStyle = '#9aa3a8'; g.beginPath(); g.arc(cx, cy, 168, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#c9d1d6'; g.beginPath(); g.arc(cx, cy, 158, 0, Math.PI * 2); g.fill();
            g.fillStyle = st.col; g.beginPath(); g.arc(cx, cy, 146, 0, Math.PI * 2); g.fill();
            // swirl
            g.save(); g.translate(cx, cy); g.rotate(st.ang * 0.6);
            g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 5;
            for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(0, 0, 30 + i * 28, i * 1.4, i * 1.4 + 2.2); g.stroke(); }
            g.restore();
            for (const p of st.drops) { g.fillStyle = st.col; g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.fill(); }
            // wooden spoon at the cursor
            const ax = cur.x - cx, ay = cur.y - cy, al = Math.hypot(ax, ay) || 1;
            g.strokeStyle = '#a0703c'; g.lineWidth = 12; g.lineCap = 'round';
            g.beginPath(); g.moveTo(cur.x, cur.y); g.lineTo(cur.x + ax / al * 110, cur.y + ay / al * 110 - 40); g.stroke();
            g.lineCap = 'butt';
            g.fillStyle = '#c08a52'; g.beginPath(); g.ellipse(cur.x, cur.y, 22, 15, Math.atan2(ay, ax), 0, Math.PI * 2); g.fill();
            // speed gauge
            const gx = 92, gy = 400, w = CF.clamp(st.w / 14, 0, 1);
            g.lineWidth = 14;
            g.strokeStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(gx, gy, 52, Math.PI, Math.PI * 2); g.stroke();
            g.strokeStyle = GOOD; g.beginPath(); g.arc(gx, gy, 52, Math.PI + Math.PI * 3 / 14, Math.PI + Math.PI * 8.5 / 14); g.stroke();
            g.strokeStyle = BAD; g.beginPath(); g.arc(gx, gy, 52, Math.PI + Math.PI * 12 / 14, Math.PI * 2); g.stroke();
            const na = Math.PI + Math.PI * w;
            g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + Math.cos(na) * 48, gy + Math.sin(na) * 48); g.stroke();
            txt('SPEED', gx, gy + 18, 13, '#fff', 'center', '700');
            bar(PW - 230, 70, 190, 22, st.prog, GOOD, Math.round(st.prog * 100) + '%');
            hint('Circle the mouse around the pot · keep the needle in the green · Right-click / Q: cancel');
        }
    };

    // SEASON: shake the mouse up and down over the food, click to stop
    function amountOf(it, key) {
        if (it.type === 'pot' && it.s.soup) return key === 'salt' ? (it.s.ss || 0) : 0;
        if (it.def.cont && !it.def.food) {
            const f = CF.Items.deep(it).filter(x => x.def.food);
            if (f.length) return f.reduce((a, x) => a + (x.s[key] || 0), 0) / f.length;
        }
        return it.s[key] || 0;
    }
    KIND.season = {
        build(d, it) {
            const key = d.tool === 'pepper' ? 'pepper' : 'salt';
            return { key, base: amountOf(it, key), add: 0, travel: 0, sign: 0, grains: [], shake: 0, name: String(d.name || it.def.name).toLowerCase(), icon: it.def.icon };
        },
        valid: it => !!it,
        move(dx, dy) {
            if (doneT || !dy) return;
            const s = Math.sign(dy);
            if (s !== st.sign) {
                if (Math.abs(st.travel) > 16) {
                    st.add += 0.05 + Math.min(Math.abs(st.travel), 140) / 140 * 0.09;
                    st.shake = 1;
                    CF.Audio.play('shake');
                    for (let i = 0; i < 9; i++) st.grains.push({ x: cur.x + CF.rand(-12, 12), y: cur.y + 46, vy: CF.rand(120, 260), life: 1 });
                    if (st.base + st.add >= 3) { KIND.season.click(); return; }
                }
                st.sign = s; st.travel = 0;
            }
            st.travel += dy;
        },
        click() {
            if (st.add < 0.01) { G.cancel(); return; }
            const total = st.base + st.add, good = total >= 0.6 && total <= 1.3;
            finish(good ? 'PERFECTLY SEASONED!' : total < 0.6 ? 'A LITTLE MORE…' : 'WHOA, TOO MUCH!', good ? GOOD : total < 0.6 ? OK : BAD, { t: 'season', id: data.id, tool: data.tool, amt: CF.r3(st.add) });
        },
        tick(dt) {
            st.shake = Math.max(0, st.shake - dt * 6);
            st.grains = st.grains.filter(p => (p.life -= dt) > 0 && p.y < 380);
            for (const p of st.grains) { p.y += p.vy * dt; p.vy += 500 * dt; }
        },
        draw() {
            title(`${st.key === 'salt' ? '🧂 SALT' : '🌶️ PEPPER'} THE ${st.name.toUpperCase()}`);
            // the food on a plate
            g.fillStyle = '#f4f1ea'; g.beginPath(); g.ellipse(320, 395, 190, 42, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#e2ddd2'; g.beginPath(); g.ellipse(320, 393, 150, 30, 0, 0, Math.PI * 2); g.fill();
            txt(st.icon, 320, 360, 70, '#fff');
            for (const p of st.grains) { g.fillStyle = st.key === 'salt' ? '#ffffff' : '#222'; g.fillRect(p.x, p.y, 3, 3); }
            // shaker at the cursor
            const sx = cur.x + (st.shake ? Math.sin(t * 60) * 6 : 0), sy = CF.clamp(cur.y, 120, 300);
            g.save(); g.translate(sx, sy); g.rotate(Math.PI);
            g.fillStyle = st.key === 'salt' ? 'rgba(255,255,255,0.92)' : '#3b2a1f'; rr(-24, -40, 48, 74, 12); g.fill();
            g.fillStyle = '#c9d1d6'; g.beginPath(); g.ellipse(0, -40, 24, 16, 0, Math.PI, Math.PI * 2); g.fill();
            g.restore();
            txt(st.key === 'salt' ? 'S' : 'P', sx, sy - 4, 24, st.key === 'salt' ? '#555' : '#fff', 'center', '700');
            // gauge 0..3 with the ideal band
            const gx = 640, gy0 = 80, gh = 300, y = v => gy0 + gh - CF.clamp(v / 3, 0, 1) * gh;
            rr(gx - 18, gy0, 36, gh, 14); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
            rr(gx - 18, y(1.3), 36, y(0.6) - y(1.3), 6); g.fillStyle = GOOD; g.globalAlpha = 0.7; g.fill(); g.globalAlpha = 1;
            const total = st.base + st.add;
            rr(gx - 12, y(total), 24, gy0 + gh - y(total), 8); g.fillStyle = total > 1.3 ? BAD : '#fff'; g.fill();
            g.fillStyle = '#ffd166'; g.fillRect(gx - 26, y(st.base) - 2, 52, 4);
            txt('IDEAL', gx - 52, (y(1.3) + y(0.6)) / 2, 13, GOOD, 'center', '700');
            hint('Shake the mouse up and down · click to stop · Right-click / Q: cancel');
        }
    };

    // WASH: scrub the dirt layer off with the sponge until it is 95% clean
    function coverage(s) {
        const d = s.dg.getImageData(0, 0, 256, 256).data;
        let n = 0;
        for (let y = 4; y < 256; y += 6) for (let x = 4; x < 256; x += 6) {
            const dx = x - 128, dy = y - 128;
            if (dx * dx + dy * dy > 118 * 118) continue;
            if (d[(y * 256 + x) * 4 + 3] > 40) n++;
        }
        return n;
    }
    KIND.wash = {
        build(d, it) {
            const dirt = document.createElement('canvas');
            dirt.width = dirt.height = 256;
            const dg = dirt.getContext('2d');
            for (let i = 0; i < 24; i++) {
                dg.fillStyle = `rgba(${CF.randi(95, 135)},${CF.randi(65, 95)},${CF.randi(35, 55)},${CF.rand(0.75, 1).toFixed(2)})`;
                dg.beginPath(); dg.ellipse(128 + CF.rand(-78, 78), 128 + CF.rand(-78, 78), CF.rand(16, 44), CF.rand(12, 36), CF.rand(0, 3), 0, Math.PI * 2); dg.fill();
            }
            for (let i = 0; i < 40; i++) {
                dg.fillStyle = CF.choice(['#c0392b', '#e8a63a', '#7fcf4a', '#5a3a22']);
                dg.beginPath(); dg.arc(128 + CF.rand(-90, 90), 128 + CF.rand(-90, 90), CF.rand(2, 5), 0, Math.PI * 2); dg.fill();
            }
            const s = { dirt, dg, base: 1, left: 1, check: 0, scrub: 0, r: has('scrubber') ? 30 : 21, power: has('scrubber') ? 2 : 1, bubbles: [], bowl: it.type === 'bowl' };
            s.base = coverage(s) || 1;
            return s;
        },
        valid: it => !!it.def.dish && !!it.s.dirty,
        move(dx, dy) {
            if (doneT) return;
            // the dish is drawn at (PW/2, 250) with radius 150; the dirt canvas is 256 px for those 300
            const k = 256 / 300, u = (cur.x - (PW / 2 - 150)) * k, v = (cur.y - 100) * k;
            const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
            const dg = st.dg;
            dg.save();
            dg.globalCompositeOperation = 'destination-out';
            dg.globalAlpha = 0.18 * st.power;
            for (let i = 0; i < steps; i++) {
                const f = (i + 1) / steps;
                dg.beginPath(); dg.arc(u - dx * k * (1 - f), v - dy * k * (1 - f), st.r * k, 0, Math.PI * 2); dg.fill();
            }
            dg.restore();
            st.scrub += Math.hypot(dx, dy);
            if (st.scrub > 60) { st.scrub = 0; CF.Audio.play('scrub'); st.bubbles.push({ x: cur.x + CF.rand(-20, 20), y: cur.y + CF.rand(-10, 10), r: CF.rand(5, 12), life: 0.9 }); }
        },
        tick(dt) {
            CF.Stations.runSink(0.4);
            st.bubbles = st.bubbles.filter(b => (b.life -= dt) > 0);
            for (const b of st.bubbles) b.y -= 30 * dt;
            if (doneT) return;
            st.check += dt;
            if (st.check >= 0.15) {
                st.check = 0;
                st.left = coverage(st) / st.base;
                if (st.left <= 0.05) finish('SPARKLING CLEAN!', GOOD, { t: 'wash', id: data.id });
            }
        },
        draw() {
            title(st.bowl ? '🧽 WASH THE BOWL' : '🧽 WASH THE PLATE');
            const cx = PW / 2, cy = 250;
            const wg = g.createLinearGradient(0, 60, 0, PH);
            wg.addColorStop(0, '#5fb7d9'); wg.addColorStop(1, '#2a7fa6');
            rr(40, 64, PW - 80, PH - 120, 24); g.fillStyle = wg; g.fill();
            g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 3;
            for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(cx, cy, 190 + i * 22 + Math.sin(t * 2 + i) * 4, 150 + i * 16, 0, 0, Math.PI * 2); g.stroke(); }
            g.fillStyle = '#fbfaf6'; g.beginPath(); g.arc(cx, cy, 150, 0, Math.PI * 2); g.fill();
            g.fillStyle = st.bowl ? '#e4e0d8' : '#f0ede6'; g.beginPath(); g.arc(cx, cy, st.bowl ? 112 : 118, 0, Math.PI * 2); g.fill();
            g.strokeStyle = st.bowl ? '#ff6b6b' : '#2ec4b6'; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 138, 0, Math.PI * 2); g.stroke();
            g.save();
            g.beginPath(); g.arc(cx, cy, 146, 0, Math.PI * 2); g.clip();
            g.drawImage(st.dirt, cx - 150, cy - 150, 300, 300);
            g.restore();
            for (const b of st.bubbles) { g.strokeStyle = `rgba(255,255,255,${b.life})`; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.stroke(); }
            // sponge
            g.save(); g.translate(cur.x, cur.y); g.rotate(-0.25);
            g.fillStyle = '#ffd84f'; rr(-30, -20, 60, 40, 9); g.fill();
            g.fillStyle = '#3bbf6a'; rr(-30, -20, 60, 12, 6); g.fill();
            g.fillStyle = 'rgba(0,0,0,0.12)';
            for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-18 + (i % 3) * 18, 2 + Math.floor(i / 3) * 10, 2.5, 0, Math.PI * 2); g.fill(); }
            g.restore();
            const clean = CF.clamp((1 - st.left) / 0.95, 0, 1);
            bar(PW / 2 - 140, 72, 280, 22, clean, GOOD, 'Clean ' + Math.round(clean * 100) + '%');
            hint('Rub the sponge over the dirt · Right-click / Q: cancel');
        }
    };

    return G;
})();
