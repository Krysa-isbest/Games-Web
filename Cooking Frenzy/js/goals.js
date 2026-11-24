'use strict';
// Objectives, so you always know what to do next:
//  - the tutorial for new chefs: one step at a time with a bouncing arrow over the next thing to use. It walks
//    through a whole burger, opening up and serving it. While it runs the restaurant only opens when you flip the sign.
//  - three goals every day with cash rewards (serve 6 dishes, greet 4 guests, nobody walks out...).
// The host checks them; everyone sees them (sent with the Orders packet). J hides / shows the panel.
CF.Goals = (() => {
    const G = { tut: -1, daily: [], panel: true };     // tut = tutorial step (-1 = none); daily = [{ id, n, p, st }] st: 0 open, 1 done, 2 failed
    let checkT = 0, marker = null, hudKey = '';
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const all = () => CF.Items.all();
    const anyOf = (...types) => all().some(it => types.includes(it.type));
    const find = t => all().find(it => it.type === t);
    const inPan = t => all().find(it => it.type === t && it.container && (CF.Items.get(it.container) || {}).type === 'pan');
    const above = (it, h) => it ? CF.Items.worldPos(it, v3()).add(v3(0, h || 0.25, 0)) : null;
    const bin = t => { const B = CF.World.pantry[t]; return B ? v3(B.x, B.y + 0.32, B.z) : null; };
    const board = () => { const z = CF.World.zones.boards[2]; return v3((z.min[0] + z.max[0]) / 2, z.min[1] + 0.28, (z.min[2] + z.max[2]) / 2); };
    function burgerBuilt() {
        return all().some(it => {
            if (it.type !== 'plate') return false;
            const st = it.contents.map(id => CF.Items.get(id)).filter(Boolean);
            return st.length >= 3 && st[0].type === 'bun_bottom' && st[st.length - 1].type === 'bun_top' && st.some(f => f.type === 'patty');
        });
    }
    function knob() {
        const pat = inPan('patty'), pan = pat && CF.Items.get(pat.container), B = CF.World.zones.burners;
        let best = B[1], bd = 99;
        if (pan) for (const b of B) { const d = Math.hypot(b.x - pan.mesh.position.x, b.z - pan.mesh.position.z); if (d < bd) { bd = d; best = b; } }
        return best.knob.position.clone().add(v3(0, 0.2, 0.06));
    }
    function guest() {
        const c = CF.Orders.customers.find(x => x.st === 'wait' && x.r === 'burger') || CF.Orders.customers.find(x => x.st === 'wait');
        if (c) return v3(c.x, 2.15, c.z);
        const z = CF.World.zones.pass;
        return v3((z.min[0] + z.max[0]) / 2, 1.45, 0);
    }

    // ---------- the tutorial ----------
    const TUT = [
        { text: 'Take a bun from the bakery basket on the shelf above the produce crates (click it or press E).',
          at: () => bin('bun'), done: () => anyOf('bun', 'bun_bottom', 'bun_top') },
        { text: 'Put the bun on a cutting board and press E to cut it in half.',
          at: () => { const b = find('bun'); return b && b.heldBy === null && !CF.Stations.foodOnBoard(2) ? above(b) : board(); }, done: () => anyOf('bun_bottom') },
        { text: 'Take a beef patty from the deli case and drop it into a frying pan on the stove.',
          at: () => anyOf('patty') ? above(find('pan'), 0.3) : bin('patty'), done: () => !!inPan('patty') },
        { text: 'Turn on the burner under that pan: press E on its knob.',
          at: knob, done: () => { const p = inPan('patty'); return !!p && Math.max(p.s.c[0], p.s.c[1]) > 0.05; } },
        { text: 'When the bottom looks brown, press E on the pan to flip the patty over.',
          at: () => above(inPan('patty') || find('patty'), 0.3), done: () => all().some(it => it.type === 'patty' && it.s.c[0] > 0.25 && it.s.c[1] > 0.25) },
        { text: 'While it fries: take a tomato, a lettuce and a cheese block and cut each one on a board.',
          at: () => !anyOf('tomato_slice') ? bin('tomato') : !anyOf('lettuce_leaf') ? bin('lettuce') : bin('cheese'),
          done: () => anyOf('tomato_slice') && anyOf('lettuce_leaf') && anyOf('cheese_slice') },
        { text: 'Take a clean plate from the stack by the pass (the counter with the heat lamps).',
          at: () => { const z = CF.World.zones.plates; return v3(z.x, z.y + 0.5, z.z); }, done: () => anyOf('plate') },
        { text: 'Stack the burger on the plate: bottom bun, patty, cheese, lettuce, tomato, top bun last. A pinch of salt on the patty (shaker, F) earns more stars.',
          at: () => above(all().find(it => it.type === 'plate' && it.contents.length) || find('plate'), 0.3), done: burgerBuilt },
        { text: 'Flip the sign next to the pass to OPEN the restaurant.',
          at: () => CF.World.signMesh.getWorldPosition(v3()).add(v3(-0.15, 0.4, 0)), done: () => CF.Orders.state.phase !== 'prep' },
        { text: 'A guest wants your burger! Carry the plate to them and press E on them (bigger tip), or put it on the pass and ring the bell.',
          at: guest, done: () => ((CF.Orders.state.stats || {}).served || 0) > 0 }
    ];
    G.TUT_STEPS = TUT.length;
    G.tutorialActive = () => G.tut >= 0;
    G.holdPrep = () => G.tut >= 0;                  // during the tutorial the restaurant opens when you flip the sign
    const tutWanted = () => !CF.Profile.data.tutDone && CF.settings.tutorial !== false;

    // ---------- daily goals ----------
    const okLog = s => (s.log || []).filter(l => !l.fail);
    const POOL = {
        serve:   { text: n => `Serve ${n} dishes`, n: d => Math.min(12, 3 + d), val: s => s.served, reward: 25 },
        earn:    { text: n => `Earn $${n} from meals and tips`, n: d => 60 + 25 * Math.min(d, 8), val: s => Math.floor(s.earned + s.tips), reward: 30 },
        good:    { text: n => `Serve ${n} dishes rated 4★ or better`, n: d => Math.min(8, 2 + Math.floor(d / 2)), val: s => okLog(s).filter(l => l.stars >= 4).length, reward: 30 },
        perfect: { text: () => 'Serve a perfect 5★ dish', n: () => 1, val: s => okLog(s).filter(l => l.stars >= 5).length, reward: 35 },
        greet:   { text: n => `Greet ${n} guests`, n: d => Math.min(6, 2 + Math.floor(d / 2)), val: s => s.greets, reward: 15 },
        hand:    { text: n => `Carry ${n} dishes to the tables yourselves`, n: d => Math.min(6, 2 + Math.floor(d / 2)), val: s => s.hand, reward: 20 },
        wash:    { text: n => `Wash ${n} dirty dishes`, n: d => Math.min(6, 2 + Math.floor(d / 3)), val: s => s.washed, reward: 15 },
        clear:   { text: n => `Clear ${n} tables before the busser does`, n: d => Math.min(6, 2 + Math.floor(d / 2)), val: s => s.cleared, reward: 15 },
        nofail:  { text: () => 'Nobody walks out today', n: () => 1, keep: s => !s.fails, reward: 40 },
        nofire:  { text: () => 'Nothing catches fire today', n: () => 1, keep: s => !s.fires, reward: 30 }
    };
    function goalDef(id) {
        if (POOL[id]) return POOL[id];
        if (id.startsWith('dish:')) {
            const r = id.slice(5), rec = CF.RECIPES[r];
            if (!rec) return null;
            return { text: n => `Serve ${n}× ${rec.icon} ${rec.name} (2★ or better)`, n: d => Math.min(5, 2 + Math.floor(d / 3)), val: s => okLog(s).filter(l => l.r === r && l.stars >= 2).length, reward: 20 };
        }
        return null;
    }
    G.text = g => { const d = goalDef(g.id); return d ? d.text(g.n) : g.id; };
    G.reward = g => { const d = goalDef(g.id); return d ? d.reward : 0; };
    G.isKeep = g => { const d = goalDef(g.id); return !!(d && d.keep); };

    // host: a new day, new goals (and the tutorial if you still need it)
    G.startDay = () => {
        const s = CF.Orders.state, day = s.day;
        const dishes = Object.keys(CF.RECIPES).filter(k => s.unlocks[k]).map(k => 'dish:' + k);
        const first = CF.choice(day <= 1 ? ['serve'] : ['serve', 'earn']);
        let rest = ['good', 'greet', 'hand', 'wash', 'clear', 'nofail', 'nofire', 'perfect', ...dishes, ...dishes].filter(id => id !== first);
        if (day <= 1) rest = rest.filter(id => id !== 'perfect' && id !== 'nofail');
        const pick = [first];
        while (pick.length < 3 && rest.length) {
            const id = CF.choice(rest);
            rest = rest.filter(x => x !== id && !(id.startsWith('dish:') && x.startsWith('dish:')));
            pick.push(id);
        }
        G.daily = pick.map(id => ({ id, n: goalDef(id).n(day), p: 0, st: 0 }));
        G.tut = tutWanted() ? 0 : -1;
        checkT = 0;
    };
    function complete(g, end) {
        const s = CF.Orders.state, r = G.reward(g);
        g.st = 1; g.p = g.n;
        s.money += r;
        if (s.stats) s.stats.bonus += r;
        if (!end) CF.Sync.broadcastToast(`🎯 Goal complete: ${G.text(g)} (+$${r})`, 'good');
    }
    // host: tutorial + goals, a few times a second
    G.update = dt => {
        checkT -= dt;
        if (checkT > 0) return;
        checkT = 0.25;
        const s = CF.Orders.state, st = s.stats;
        if (G.tut >= 0) {
            if (!tutWanted()) G.tut = -1;
            else {
                while (G.tut < TUT.length && TUT[G.tut].done()) G.tut++;
                if (G.tut >= TUT.length) {
                    G.tut = -1;
                    CF.Profile.data.tutDone = true; CF.Profile.save();
                    CF.Sync.broadcastToast('🎓 Tutorial done! Keep the guests happy, restock the pantry at the terminal and chase today\'s goals.', 'good');
                }
            }
        }
        if (!st || s.phase === 'summary') return;
        for (const g of G.daily) {
            if (g.st) continue;
            const d = goalDef(g.id);
            if (!d) continue;
            if (d.keep) {
                if (!d.keep(st)) { g.st = 2; CF.Sync.broadcastToast(`❌ Goal missed: ${G.text(g)}`, 'bad'); }
                continue;
            }
            g.p = Math.min(g.n, d.val(st) | 0);
            if (g.p >= g.n) complete(g, false);
        }
    };
    // host: "keep it up all day" goals pay out at closing time
    G.endDay = () => {
        const st = CF.Orders.state.stats;
        for (const g of G.daily) {
            const d = goalDef(g.id);
            if (g.st || !d || !st) continue;
            if (d.keep) { if (d.keep(st)) complete(g, true); else g.st = 2; }
            else { g.p = Math.min(g.n, d.val(st) | 0); if (g.p >= g.n) complete(g, true); }
        }
    };
    // settings: the tutorial switched on again / restarted
    G.restartTutorial = () => {
        CF.Profile.data.tutDone = false; CF.Profile.save();
        if (CF.Sync.isHost && CF.Game.mode === 'play') G.tut = 0;
    };

    // ---------- network ----------
    G.pack = () => ({ t: G.tut, d: G.daily.map(g => [g.id, g.n, g.p, g.st]) });
    G.unpack = o => {
        if (!o) return;
        G.tut = typeof o.t === 'number' ? o.t : -1;
        G.daily = (o.d || []).map(a => ({ id: String(a[0]), n: a[1] | 0, p: a[2] | 0, st: a[3] | 0 })).filter(g => goalDef(g.id));
    };
    G.reset = () => { G.tut = -1; G.daily = []; hudKey = ''; seenTut = -1; seenSt = {}; if (marker) marker.visible = false; };

    // ---------- what everyone sees: the arrow and the panel ----------
    function makeMarker() {
        const tex = CF.Models.canvasTex(128, 128, (g, w, h) => {
            g.shadowColor = 'rgba(255,209,102,0.9)'; g.shadowBlur = 18;
            g.fillStyle = '#ffd166'; g.strokeStyle = '#3a2a00'; g.lineWidth = 6; g.lineJoin = 'round';
            g.beginPath(); g.moveTo(40, 14); g.lineTo(88, 14); g.lineTo(88, 62); g.lineTo(112, 62); g.lineTo(64, 116); g.lineTo(16, 62); g.lineTo(40, 62); g.closePath();
            g.fill(); g.shadowBlur = 0; g.stroke();
        });
        marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        marker.scale.set(0.2, 0.2, 1);
        marker.renderOrder = 12;
        CF.World.scene.add(marker);
    }
    G.visuals = () => {
        const on = G.tut >= 0 && G.tut < TUT.length && CF.Game.mode === 'play';
        let pos = null;
        if (on) { try { pos = TUT[G.tut].at(); } catch (e) { pos = null; } }
        if (!pos) { if (marker) marker.visible = false; return; }
        if (!marker) makeMarker();
        marker.visible = true;
        marker.position.set(pos.x, pos.y + 0.05 + Math.abs(Math.sin(performance.now() * 0.004)) * 0.08, pos.z);
    };
    G.togglePanel = () => { G.panel = !G.panel; hudKey = ''; };
    // a little sound when a tutorial step or a goal is done (each player hears it on their own)
    let seenTut = -1, seenSt = {};
    function cues() {
        if (G.tut !== seenTut) {
            if (seenTut >= 0) CF.Audio.play(G.tut < 0 ? 'star' : 'pop');     // next step / tutorial finished
            seenTut = G.tut;
        }
        const now = {};
        for (const g of G.daily) {
            now[g.id] = g.st;
            if (seenSt[g.id] === 0 && g.st === 1) CF.Audio.play('star');
            else if (seenSt[g.id] === 0 && g.st === 2) CF.Audio.play('fail');
        }
        seenSt = now;
    }
    G.updateHud = () => {
        const el = CF.$('#goals');
        if (!el) return;
        cues();
        const key = G.panel + '|' + G.tut + '|' + G.daily.map(g => g.id + g.p + g.st).join(',');
        if (key === hudKey) return;
        hudKey = key;
        if (!G.panel) { el.innerHTML = '<div class="g-min"><b>J</b> show goals</div>'; return; }
        let h = '';
        if (G.tut >= 0 && G.tut < TUT.length) h += `<div class="g-tut"><div class="g-h">🎓 Tutorial <span>${G.tut + 1}/${TUT.length}</span></div><p>${CF.esc(TUT[G.tut].text)}</p><small>Follow the yellow arrow · you can turn the tutorial off in Settings</small></div>`;
        if (G.daily.length) {
            h += '<div class="g-day"><div class="g-h">🎯 Today\'s goals</div><ul>' + G.daily.map(g => {
                const keep = G.isKeep(g), cls = g.st === 1 ? 'done' : g.st === 2 ? 'fail' : '';
                const prog = g.st === 1 ? '✓' : g.st === 2 ? '✗' : keep ? 'all day' : `${g.p}/${g.n}`;
                return `<li class="${cls}"><span class="g-t">${CF.esc(G.text(g))}</span><span class="g-p">${prog}</span><em>+$${G.reward(g)}</em></li>`;
            }).join('') + '</ul></div>';
        }
        h += '<div class="g-key"><b>J</b> hide</div>';
        el.innerHTML = h;
    };
    // end-of-day screen
    G.summaryHTML = () => {
        if (!G.daily.length) return '';
        return '<div class="sum-goals"><h3>🎯 Today\'s goals</h3>' + G.daily.map(g =>
            `<div class="sg ${g.st === 1 ? 'done' : 'fail'}"><span>${g.st === 1 ? '✓' : '✗'}</span><b>${CF.esc(G.text(g))}</b><em>${g.st === 1 ? '+$' + G.reward(g) : 'missed'}</em></div>`).join('') + '</div>';
    };
    return G;
})();
