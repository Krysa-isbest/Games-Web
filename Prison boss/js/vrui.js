'use strict';
// VR menus without rewriting every menu: whatever HTML panel the game is showing (trader, crafting,
// settings, pause, main menu, minigame instructions...) is read from the page and drawn onto a floating
// 3D panel. Pointing the laser at a button and pulling the trigger clicks the real HTML button.
PB.VRUI = (() => {
    const U = { visible: false };
    const CW = 1024, CH = 1024, SIZE = 0.95;
    let W, cv, g, tex, mesh, src = null, dirty = true, rects = [], scrollY = 0, contentH = 0, hover = -1;
    const $ = id => document.getElementById(id);
    const shown = el => el && !el.classList.contains('hidden');

    U.init = () => {
        W = PB.World;
        cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
        g = cv.getContext('2d');
        tex = new THREE.CanvasTexture(cv);
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
        mesh.renderOrder = 998;
        mesh.visible = false;
        // anything changing in the page's menus means the VR panel must be redrawn
        const mo = new MutationObserver(() => { dirty = true; });
        ['panel-wrap', 'pause', 'menu', 'coop', 'mini-panel'].forEach(id =>
            mo.observe($(id), { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled'], characterData: true }));
    };

    // Which page element the panel should mirror right now
    function pickSource() {
        if (!PB.VR.isOn()) return null;
        if (shown($('panel-wrap'))) return { el: $('panel'), title: $('panel-title').textContent, key: 'panel' };
        if (shown($('pause'))) return { el: $('pause'), title: 'Paused', key: 'pause' };
        if (shown($('coop'))) return { el: $('coop'), title: 'Co-op', key: 'coop' };
        if (shown($('menu'))) return { el: $('menu'), title: 'Prison Boss', key: 'menu' };
        if (PB.Mini.active) return { el: $('mini-panel'), title: $('mini-title').textContent, key: 'mini', small: true };
        return null;
    }

    // Where the next panel should appear: 'desk' (recipe board), 'trader' (shop board at the bars), or floating
    let anchor = null;
    U.anchor = kind => { anchor = kind; };

    U.update = dt => {
        const s = pickSource();
        if (!s) { if (mesh.parent) mesh.parent.remove(mesh); mesh.visible = U.visible = false; src = null; anchor = null; return; }
        if (!src || src.key !== s.key || src.title !== s.title) { place(s); scrollY = 0; dirty = true; }
        src = s;
        mesh.visible = U.visible = true;
        if (dirty) { dirty = false; render(); }
    };

    function place(s) {
        const P = PB.Player, cell = W.cells[P.cell];
        // pause menu = a tablet on your left wrist
        if (s.key === 'pause' && PB.VR.hands.left) {
            PB.VR.hands.left.grip.add(mesh);
            mesh.position.set(0, 0.11, 0.1); mesh.rotation.set(-1.0, 0, 0); mesh.scale.setScalar(0.3);
            return;
        }
        if (s.key === 'panel' && anchor && cell && W.area === 'cell') {
            const at = anchor === 'desk' ? [0.4, 1.22, 1.9, 0.4, 1.22, 1.0] : [-0.9, 1.5, -1.8, -0.9, 1.5, -1.0];
            const pos = cell.toWorld(at[0], at[1], at[2]), look = cell.toWorld(at[3], at[4], at[5]);
            W.activeScene.add(mesh);
            mesh.position.copy(pos); mesh.lookAt(look); mesh.scale.setScalar(anchor === 'desk' ? 0.75 : 0.85);
            return;
        }
        W.activeScene.add(mesh);
        floatInFront(s);
    }

    // Float the panel in front of you (the minigame instructions sit low and to the left, out of the way)
    function floatInFront(s) {
        const cam = W.camera;
        cam.updateMatrixWorld();
        const head = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
        fwd.y = 0; fwd.normalize();
        if (s.small) fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.75);
        const pos = head.clone().addScaledVector(fwd, s.small ? 0.85 : 1.15);
        pos.y = head.y - (s.small ? 0.35 : 0.1);
        mesh.position.copy(pos);
        mesh.rotation.set(0, 0, 0);
        mesh.lookAt(head.x, pos.y, head.z);
        mesh.scale.setScalar(s.small ? 0.6 : 1);
    }

    // Press buttons by touching them with your fingertip
    const pokeIn = {};
    U.poke = (tip, side) => {
        if (!U.visible) return;
        mesh.updateMatrixWorld();
        const l = mesh.worldToLocal(tip.clone()), s = mesh.getWorldScale(new THREE.Vector3()).x;
        const inside = Math.abs(l.x) < SIZE / 2 && Math.abs(l.y) < SIZE / 2, depth = l.z * s;
        if (!inside || depth > 0.04 || depth < -0.05) { pokeIn[side] = false; return; }
        if (depth < 0.012 && !pokeIn[side]) {
            pokeIn[side] = true;
            const x = (l.x / SIZE + 0.5) * CW, y = (0.5 - l.y / SIZE) * CH;
            const i = rects.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
            if (i >= 0) U.click({ rect: rects[i] });
        }
    };

    // ---------- Reading the page ----------
    const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    function isHidden(n) { return n.classList && n.classList.contains('hidden'); }
    function collect(el, out) {
        for (const n of el.children) {
            if (isHidden(n) || n.tagName === 'CANVAS' || n.tagName === 'TEXTAREA' || n.id === 'panel-close') continue;
            const cls = n.classList;
            if (n.tagName === 'BUTTON' || (n.dataset && n.dataset.act && !cls.contains('tab'))) {
                out.push({ kind: 'btn', label: text(n), el: n, disabled: n.disabled });
            } else if (cls.contains('tabs')) {
                out.push({ kind: 'tabs', tabs: [...n.children].filter(t => !isHidden(t)).map(t => ({ label: text(t), el: t, on: t.classList.contains('on') })) });
            } else if (cls.contains('row')) {
                out.push({ kind: 'row', icon: text(n.querySelector('.ic')), name: text(n.querySelector('.nm')), desc: text(n.querySelector('.ds')),
                    price: [text(n.querySelector('.qty')), text(n.querySelector('.pr'))].filter(Boolean).join('  '),
                    btns: [...n.querySelectorAll('button')].map(b => ({ label: text(b), el: b, disabled: b.disabled })), locked: cls.contains('locked') });
            } else if (n.tagName === 'INPUT') {
                if (n.type === 'range') out.push({ kind: 'range', el: n });
                else if (n.type === 'checkbox') out.push({ kind: 'check', el: n, label: text(n.parentElement) });
            } else if (['H3', 'H4'].includes(n.tagName) || cls.contains('logo')) {
                out.push({ kind: 'head', text: text(n) });
            } else if (!n.querySelector('button, [data-act], input, .tabs, .row') && text(n)) {
                out.push({ kind: 'text', text: text(n) });
            } else collect(n, out);
        }
        return out;
    }

    // ---------- Drawing ----------
    const INK = '#221a2e';
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function button(x, y, w, h, label, b, on) {
        const i = rects.length;
        rects.push({ x, y, w, h, b });
        rr(x, y, w, h, 14);
        g.fillStyle = b.disabled ? '#bdb6a6' : on ? '#ffd23f' : i === hover ? '#ffb04a' : '#ff8a1f';
        g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
        g.fillStyle = b.disabled ? '#6a5f78' : on ? INK : '#fff';
        g.font = '800 30px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(label.length > 26 ? label.slice(0, 25) + '…' : label, x + w / 2, y + h / 2 + 1);
        g.textAlign = 'left';
    }
    function lines(t, maxW, font) { g.font = font; return PB.VR.wrap(g, t, 0, 0, maxW); }

    function render() {
        if (!src) return;
        const blocks = collect(src.el, []);
        // paper forging: a keypad instead of a keyboard
        const mg = PB.Mini.active;
        if (src.key === 'mini' && mg && mg.code && mg.phase === 'code' && mg.typed < mg.code.length) {
            // the right key plus 7 decoys, in a stable order for this letter
            const need = mg.code[mg.typed], seed = mg.typed * 17 + mg.code.charCodeAt(0);
            const hash = ch => (ch.charCodeAt(0) * 31 + seed * 7) % 101;
            const decoys = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789-'.split('').filter(ch => ch !== need).sort((a, b) => hash(a) - hash(b)).slice(0, 7);
            const keys = decoys.concat(need).sort((a, b) => hash(a) - hash(b));
            blocks.unshift({ kind: 'keys', keys: keys.map(k => ({ label: k, key: k })) });
        }
        rects = [];
        g.clearRect(0, 0, CW, CH);
        rr(6, 6, CW - 12, CH - 12, 40); g.fillStyle = '#fff4d6'; g.fill(); g.lineWidth = 12; g.strokeStyle = INK; g.stroke();
        rr(6, 6, CW - 12, 110, 40); g.fillStyle = '#ff8a1f'; g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = '56px "Luckiest Guy", Impact, sans-serif'; g.textBaseline = 'middle';
        g.lineWidth = 8; g.strokeStyle = INK; g.strokeText(src.title.slice(0, 26), 40, 66); g.fillText(src.title.slice(0, 26), 40, 66);
        g.save();
        g.beginPath(); g.rect(20, 124, CW - 40, CH - 150); g.clip();
        let y = 140 - scrollY;
        const X = 40, WIDTH = CW - 80;
        for (const b of blocks) {
            if (b.kind === 'head') {
                g.fillStyle = INK; g.font = '40px "Luckiest Guy", Impact, sans-serif'; g.textBaseline = 'top';
                g.fillText(b.text.slice(0, 34), X, y); y += 56;
            } else if (b.kind === 'text') {
                g.fillStyle = INK; g.textBaseline = 'top';
                lines(b.text, WIDTH, '700 28px Nunito, sans-serif').forEach(l => { g.fillText(l, X, y); y += 36; });
                y += 8;
            } else if (b.kind === 'btn') {
                button(X, y, Math.min(WIDTH, 560), 74, b.label, b); y += 90;
            } else if (b.kind === 'tabs') {
                const w = Math.min(230, (WIDTH - 10 * (b.tabs.length - 1)) / b.tabs.length);
                b.tabs.forEach((t, i) => button(X + i * (w + 10), y, w, 64, t.label, t, t.on));
                y += 84;
            } else if (b.kind === 'keys') {
                b.keys.forEach((k, i) => button(X + i * 115, y, 100, 90, k.label, k));
                y += 110;
            } else if (b.kind === 'row') {
                const h = 130;
                rr(X, y, WIDTH, h, 18); g.fillStyle = b.locked ? '#e6dcc4' : '#fff'; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
                g.fillStyle = INK; g.textBaseline = 'top';
                g.font = '44px sans-serif'; g.fillText(b.icon, X + 16, y + 30);
                g.font = '800 32px Nunito, sans-serif'; g.fillText(b.name.slice(0, 34), X + 90, y + 14);
                g.font = '700 24px Nunito, sans-serif'; g.fillStyle = '#5a5068';
                lines(b.desc, WIDTH - 420, '700 24px Nunito, sans-serif').slice(0, 2).forEach((l, i) => g.fillText(l, X + 90, y + 56 + i * 28));
                g.fillStyle = INK; g.font = '800 30px Nunito, sans-serif'; g.textAlign = 'right';
                g.fillText(b.price.slice(0, 22), X + WIDTH - (b.btns.length ? 210 : 20), y + 46); g.textAlign = 'left';
                b.btns.forEach((bt, i) => button(X + WIDTH - 190, y + 18 + i * 52, 170, b.btns.length > 1 ? 46 : 92, bt.label, bt));
                y += h + 14;
            } else if (b.kind === 'range') {
                const v = +b.el.value, mn = +b.el.min, mx = +b.el.max, st = +b.el.step || 0.05;
                button(X, y, 90, 70, '−', { el: b.el, range: -st });
                rr(X + 110, y + 20, WIDTH - 330, 30, 15); g.fillStyle = '#fff'; g.fill(); g.stroke();
                rr(X + 110, y + 20, (WIDTH - 330) * (v - mn) / (mx - mn), 30, 15); g.fillStyle = '#ff8a1f'; g.fill();
                button(X + WIDTH - 200, y, 90, 70, '+', { el: b.el, range: st });
                g.fillStyle = INK; g.font = '800 28px Nunito, sans-serif'; g.textBaseline = 'middle';
                g.fillText(b.el.dataset.set ? PB.Settings.fmt(b.el.dataset.set, v) : v, X + WIDTH - 95, y + 36);
                y += 90;
            } else if (b.kind === 'check') {
                button(X, y, Math.min(WIDTH, 700), 64, (b.el.checked ? '☑ ' : '☐ ') + b.label, { el: b.el, check: true });
                y += 80;
            }
        }
        g.restore();
        contentH = y + scrollY - 140;
        if (contentH > CH - 160) { // scroll bar
            const track = CH - 170, bar = Math.max(60, track * (CH - 160) / contentH);
            g.fillStyle = 'rgba(34,26,46,.35)'; g.fillRect(CW - 26, 130 + (track - bar) * scrollY / (contentH - (CH - 160)), 10, bar);
        }
        tex.needsUpdate = true;
    }

    // ---------- Laser interaction ----------
    U.hitTest = ray => {
        if (!U.visible) return null;
        const h = ray.intersectObject(mesh, false)[0];
        if (!h || !h.uv) { if (hover !== -1) { hover = -1; dirty = true; } return null; }
        const x = h.uv.x * CW, y = (1 - h.uv.y) * CH;
        const i = rects.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
        if (i !== hover) { hover = i; dirty = true; }
        return { distance: h.distance, rect: i >= 0 ? rects[i] : null };
    };
    U.click = hit => {
        const r = hit && hit.rect;
        if (!r || r.b.disabled) return;
        const b = r.b;
        PB.Audio.play('click');
        if (b.key) { if (PB.Mini.active && PB.Mini.active.key) PB.Mini.active.key({ key: b.key }); dirty = true; return; }
        if (b.range) {
            const el = b.el;
            el.value = PB.clamp(+el.value + b.range, +el.min, +el.max);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            dirty = true; return;
        }
        if (b.check) { b.el.checked = !b.el.checked; dirty = true; return; }
        b.el.click();
        dirty = true;
    };
    U.scroll = (dy, onPanel) => {
        if (!onPanel || !dy) return;
        const max = Math.max(0, contentH - (CH - 160));
        const ns = PB.clamp(scrollY + dy, 0, max);
        if (ns !== scrollY) { scrollY = ns; dirty = true; }
    };

    return U;
})();
