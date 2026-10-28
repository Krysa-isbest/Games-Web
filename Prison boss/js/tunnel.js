'use strict';
// The tunnels between neighbouring cells: digging progress, rubble, the toilet clogging, crawling through.
// Each tunnel (PB.World.TUNNELS) keeps its progress in PB.state[tunnel.key] (0..1).
// 0.6 = items fit through, 1 = you can crawl through.
PB.Tunnel = (() => {
    const T = {};
    const STEP = 0.004, RUBBLE_EVERY = 0.05;

    // E on the hole (poster lifted). side: which wall of the cell (1 = -x, 2 = +x)
    T.action = (cell, side = 1) => {
        const W = PB.World, s = PB.state, P = PB.Player, t = W.tunnelAt(cell, side);
        if (!W.tunnelOn(t) || !W.posterOf(cell, side).lifted) return;
        if (W.tunnelP(t) >= 1) { T.crawl(cell, side); return; }
        // VR: a spoon in the left hand works too (it becomes the digging hand)
        if (P.held2 && P.held2.type === 'spoon' && (!P.held || P.held.type !== 'spoon')) { const a = P.held; P.held = P.held2; P.held2 = a; PB.VR.reparentHeld(); }
        if (!P.held || P.held.type !== 'spoon') {
            PB.UI.toast('You need a spoon in your hand to dig. Steal one at lunch, or buy one from Vinnie.', 'bad', 4);
            return;
        }
        if (s.phase !== 'night') { PB.UI.toast('Too many people around in the day. Dig at night!', 'bad'); return; }
        PB.Mini.start(new PB.DigGame(cell, side));
    };

    T.crawl = (from, side = 1) => {
        const W = PB.World, P = PB.Player, t = W.tunnelAt(from, side), to = W.otherEnd(t, from);
        if (!W.posterOf(to, side).lifted) {
            PB.UI.toast('The poster on the other side is in the way. Ask your friend to lift it.', 'bad', 4);
            return;
        }
        const fade = document.getElementById('fade');
        fade.classList.add('on');
        PB.Audio.play('crumble', { vol: 0.5 });
        setTimeout(() => {
            const H0 = W.HOLES[side], sx = side === 1 ? -1 : 1, c = W.cells[to];
            P.cell = to;
            P.pos.copy(c.toWorld(sx * 1.0, 1.6, (H0.z0 + H0.z1) / 2));
            // face into the room, away from the hole
            P.yaw = c.group.position.x > P.pos.x ? -Math.PI / 2 : Math.PI / 2;
            P.pitch = -0.1;
            fade.classList.remove('on');
            const home = PB.Coop.homeCell();
            PB.UI.toast(to === home ? 'Back in your own cell.' : (PB.Coop.active ? `You crawled into ${PB.Coop.ownerName(to)}'s cell!` : 'You crawled into Mumbles\' cell!'));
        }, 700);
    };

    // Host side: one scrape of the spoon from `cell`. Returns true if the spoon broke.
    T.addDig = (cell, spoon, side = 1) => {
        const s = PB.state, t = PB.World.tunnelAt(cell, side);
        if (!spoon || spoon.type !== 'spoon' || !PB.Items.list.includes(spoon)) return true;
        if (!PB.World.tunnelOn(t)) return false;
        const before = s[t.key] || 0;
        s[t.key] = Math.min(1, before + STEP * (PB.Game.hasBuff('strong') ? 1.5 : 1));
        PB.Game.progress('dig', (s[t.key] - before) * 100);
        let broke = false;
        if (Math.floor(s[t.key] / RUBBLE_EVERY) > Math.floor(before / RUBBLE_EVERY)) {
            if (!PB.Items.spawn('rubble', [cell + 'floor'])) PB.UI.toast('No room on the floor for the rubble!', 'bad');
            PB.Audio.play('crumble');
            spoon.charges--;
            if (spoon.charges <= 0) {
                PB.Items.destroy(spoon);
                PB.UI.toast('🥄 Snap! Your spoon broke.', 'bad', 4);
                broke = true;
            } else PB.Items.rebuild(spoon);
        }
        if (before < 0.6 && s[t.key] >= 0.6) PB.UI.toast('🕳️ You broke through! Small items fit through the hole now.', 'good', 5);
        if (before < 1 && s[t.key] >= 1) PB.UI.toast('🎉 The tunnel is big enough to crawl through!', 'good', 5);
        return broke;
    };

    // Host side: flushing an item down a cell's toilet. Rubble clogs it quickly.
    T.flush = (cell, it) => {
        const c = PB.World.cells[cell];
        if (c.clogged) { PB.Audio.play('clog'); PB.UI.toast('The toilet is clogged! Wait for it to drain.', 'bad'); return false; }
        PB.Items.destroy(it);
        c.clog += it.type === 'rubble' ? 1.4 : 0.5;
        PB.Audio.play('flush');
        if (c.clog >= 4) {
            c.clogged = true;
            PB.Audio.play('clog');
            PB.UI.toast('🚽 Glug… the toilet clogged! Give it some time to drain.', 'bad', 4);
        } else PB.UI.toast(`Flushed ${PB.ITEMS[it.type].name}. Evidence gone!`);
        return true;
    };

    T.update = dt => {
        for (const c of Object.values(PB.World.cells)) {
            c.clog = Math.max(0, c.clog - dt / 10);
            if (c.clogged && c.clog < 1.5) { c.clogged = false; }
        }
    };

    // Solo: Mumbles sometimes leaves a little present in the tunnel overnight
    T.dawnGift = log => {
        if (PB.Coop.active || (PB.state.tunnel || 0) < 0.6 || Math.random() < 0.5) return;
        const type = PB.choice(['fruit', 'rolling', 'blank', 'sugar', 'bottle']);
        if (PB.Items.spawn(type, ['hole'])) log.events.push(`🎁 Mumbles left a ${PB.ITEMS[type].name} in the tunnel for you.`);
    };

    return T;
})();
