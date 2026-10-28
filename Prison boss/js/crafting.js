'use strict';
// Desk crafting recipes. Ingredients must be ON the desk of the cell you're in; the 3D minigames live in mg-*.js.
// Ingredient tiers (bought from Vinnie after upgrading his supplier) raise quality and carry over to the product.
PB.Craft = (() => {
    const K = {};
    const desk = cell => PB.Items.onSurface(cell + 'desk');
    // prefers the highest tier when several fit
    const find = (cell, types, test) => {
        for (const t of types) {
            const it = desk(cell).filter(i => i.type === t && (!test || test(i))).sort((a, b) => (b.tier || 0) - (a.tier || 0))[0];
            if (it) return it;
        }
        return null;
    };
    const jugIn = (cell, state, kind) => desk(cell).find(i => i.type === 'jug' && i.jug.state === state && (!kind || (i.jug.kind || 'hooch') === kind));
    const fruits = cell => desk(cell).filter(i => i.type === 'fruit').sort((a, b) => (b.tier || 0) - (a.tier || 0));
    const here = () => PB.Player.cell;
    const tierOf = items => Math.round(items.reduce((a, i) => a + (i.tier || 0), 0) / Math.max(1, items.length));
    // flat bonuses from cell upgrades
    const upgradeQ = () => {
        const u = PB.state.upgrades;
        return (u.worklamp ? 5 : 0) + (u.tools ? 6 : 0) + (PB.Game.hasBuff('focused') ? 8 : 0) + PB.Events.val('craftQ', 0);
    };
    const finalQ = (q, tier) => PB.clamp(q + upgradeQ() + PB.tierQuality(tier), 0, 100);

    K.recipes = () => {
        const rank = PB.rankOf(PB.state.rep), c = here();
        const premium2 = find(c, ['premium'], i => i.charges >= 2);
        return [
            { id: 'cig', icon: '🚬', name: 'Roll cigarettes', rank: 0, start: K.startCig,
              needs: [{ label: 'Tobacco pouch', ok: !!find(c, ['premium', 'tobacco']) }, { label: 'Rolling papers', ok: !!find(c, ['rolling']) },
                      { label: 'Pepper grinder (optional, +quality)', ok: !!find(c, ['grinder']), optional: true }] },
            { id: 'doc', icon: '📑', name: 'Forge papers', rank: 1, start: K.startDoc,
              needs: [{ label: 'Blank paper', ok: !!find(c, ['blank']) }, { label: 'Fountain pen', ok: !!find(c, ['pen']) }, { label: 'Fake stamp (optional, +40%)', ok: !!find(c, ['stamp']), optional: true }] },
            { id: 'cards', icon: '🃏', name: 'Mark a deck of cards', rank: 1, start: K.startCards,
              needs: [{ label: 'Blank paper (2 sheets)', ok: !!find(c, ['blank'], i => i.charges >= 2) }, { label: 'Fountain pen', ok: !!find(c, ['pen']) }] },
            { id: 'mash', icon: '🫙', name: 'Start a hooch brew', rank: 2, start: K.startMash,
              needs: [{ label: 'Empty brewing jug', ok: !!jugIn(c, 'empty') }, { label: '3× Fruit', ok: fruits(c).length >= 3 }, { label: 'Sugar bag', ok: !!find(c, ['sugar']) }] },
            { id: 'bottle', icon: '🍶', name: 'Bottle the brew', rank: 2, start: K.startBottle,
              needs: [{ label: 'Jug of finished hooch or wine', ok: !!jugIn(c, 'ready') }, { label: 'Empty bottle', ok: !!find(c, ['bottle']) }] },
            { id: 'cigar', icon: '🚬', name: 'Roll cigars', rank: 3, start: K.startCigar,
              needs: [{ label: 'Premium tobacco (2 uses each)', ok: !!premium2 }, { label: 'Rolling papers', ok: !!find(c, ['rolling']) },
                      { label: 'Pepper grinder (optional, +quality)', ok: !!find(c, ['grinder']), optional: true }] },
            { id: 'wine', icon: '🍷', name: 'Start a fruit wine', rank: 4, start: K.startWine,
              needs: [{ label: 'Empty brewing jug', ok: !!jugIn(c, 'empty') }, { label: '4× Fruit', ok: fruits(c).length >= 4 }, { label: 'Full sugar bag (2 uses)', ok: !!find(c, ['sugar'], i => i.charges >= 2) }] },
            { id: 'fakeid', icon: '🪪', name: 'Make a fake ID', rank: 4, start: K.startFakeId,
              needs: [{ label: 'Blank paper', ok: !!find(c, ['blank']) }, { label: 'Passport photo', ok: !!find(c, ['photo']) }, { label: 'Fountain pen', ok: !!find(c, ['pen']) }, { label: 'Fake stamp', ok: !!find(c, ['stamp']) }] },
            { id: 'key', icon: '🔑', name: 'Glue the fake key together', rank: 3, start: () => run('key', 100),
              needs: PB.KEY_PARTS.map(t => ({ label: PB.ITEMS[t].name, ok: !!find(c, [t]) })).concat([{ label: 'Glue (steal it at lunch)', ok: !!find(c, ['glue']) }]) }
        ].map(r => Object.assign(r, { locked: rank < r.rank, ready: PB.state.phase === 'night' && rank >= r.rank && r.needs.every(n => n.ok || n.optional) }));
    };

    // Finished goods are created by whoever owns the world: the host in co-op, otherwise this game.
    const run = (r, q, x = {}) => {
        x.cell = here();
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'produce', r, q, x });
        else K.hostProduce(r, q, x);
    };
    const made = (type, q, tier, extra, c) => {
        const qq = finalQ(q, tier);
        PB.Items.addProduct(type, qq, Object.assign({ tier }, extra), c);
        PB.Game.onMade(type, qq);
    };

    K.hostProduce = (r, q, x) => {
        const I = PB.Items, c = x.cell || '';
        if (r === 'cig') {
            const t = find(c, ['premium', 'tobacco']), p = find(c, ['rolling']);
            if (!t || !p) return;
            const tier = tierOf([t, p]);
            I.consume(t); I.consume(p);
            made('cigarette', q, tier, {}, c);
        } else if (r === 'cigar') {
            const t = find(c, ['premium'], i => i.charges >= 2), p = find(c, ['rolling']);
            if (!t || !p) return;
            const tier = tierOf([t, p]);
            I.consume(t, 2); I.consume(p);
            made('cigar', q, tier, {}, c);
        } else if (r === 'doc') {
            const b = find(c, ['blank']);
            if (!b) return;
            const tier = tierOf([b]);
            I.consume(b);
            made('document', q, tier, { stamped: !!x.stamped }, c);
        } else if (r === 'cards') {
            const b = find(c, ['blank'], i => i.charges >= 2);
            if (!b) return;
            const tier = tierOf([b]);
            I.consume(b, 2);
            made('cards', q, tier, {}, c);
        } else if (r === 'fakeid') {
            const b = find(c, ['blank']), ph = find(c, ['photo']);
            if (!b || !ph || !find(c, ['stamp'])) return;
            const tier = tierOf([b, ph]);
            I.consume(b); I.destroy(ph);
            made('fakeid', q, tier, {}, c);
        } else if (r === 'mash' || r === 'wine') {
            const wine = r === 'wine', jug = jugIn(c, 'empty'), s = find(c, ['sugar'], i => !wine || i.charges >= 2);
            const fr = fruits(c).slice(0, wine ? 4 : 3);
            if (!jug || !s || fr.length < (wine ? 4 : 3)) return;
            const tier = tierOf(fr.concat([s]));
            fr.forEach(f => I.destroy(f));
            I.consume(s, wine ? 2 : 1);
            jug.jug = { state: 'fermenting', quality: q, nights: wine ? 2 : 1, servings: wine ? 3 : 4, kind: wine ? 'wine' : 'hooch', tier };
            I.rebuild(jug);
            PB.Game.onMade('brew', q);
        } else if (r === 'key') {
            const parts = PB.KEY_PARTS.map(t => find(c, [t])), glue = find(c, ['glue']);
            if (parts.some(p => !p) || !glue) return;
            parts.concat(glue).forEach(p => I.destroy(p));
            I.spawn('fakekey', [c + 'desk', c + 'floor']);
            PB.Audio.play('success');
            PB.UI.toast('🔑 The fake key is ready! Hold it and use your cell door at night to escape. Hide it well!', 'good', 7);
        } else if (r === 'bottle') {
            const jug = I.list.find(i => i.uid === x.jug), b = find(c, ['bottle']);
            if (!jug || !b || jug.jug.state !== 'ready') return;
            const kind = jug.jug.kind === 'wine' ? 'wine' : 'hooch', tier = jug.jug.tier || 0;
            I.destroy(b);
            jug.jug.servings--;
            if (jug.jug.servings <= 0) jug.jug = { state: 'empty', quality: 0, nights: 0, servings: 0 };
            I.rebuild(jug);
            made(kind, q, tier, {}, c);
        }
    };

    function cigGame(cigar) {
        const c = here();
        const tob = () => cigar ? find(c, ['premium'], i => i.charges >= 2) : find(c, ['premium', 'tobacco']);
        PB.Mini.start(new PB.CigGame({
            premium: () => { const t = tob(); return !!t && t.type === 'premium'; },
            hasGrinder: () => !!find(c, ['grinder']),
            bonus: () => { const t = tob(); return (t && t.type === 'premium' ? PB.ITEMS.premium.bonus : 0) + (find(c, ['grinder']) ? 8 : 0); },
            canContinue: () => !!tob() && !!find(c, ['rolling']),
            produce: q => run(cigar ? 'cigar' : 'cig', q)
        }));
    }
    K.startCig = () => cigGame(false);
    K.startCigar = () => cigGame(true);

    K.startDoc = () => {
        const c = here();
        PB.Mini.start(new PB.PaperGame({
            hasStamp: () => !!find(c, ['stamp']),
            canContinue: () => !!find(c, ['blank']) && !!find(c, ['pen']),
            produce: (q, stamped) => run('doc', q, { stamped: !!stamped })
        }));
    };
    // marked cards and fake IDs use the same "write + sign" desk minigame
    K.startCards = () => {
        const c = here();
        PB.Mini.start(new PB.PaperGame({
            hasStamp: () => false,
            canContinue: () => !!find(c, ['blank'], i => i.charges >= 2) && !!find(c, ['pen']),
            produce: q => run('cards', q)
        }));
    };
    K.startFakeId = () => {
        const c = here();
        PB.Mini.start(new PB.PaperGame({
            hasStamp: () => true,
            canContinue: () => !!find(c, ['blank']) && !!find(c, ['photo']) && !!find(c, ['pen']) && !!find(c, ['stamp']),
            produce: q => run('fakeid', q)
        }));
    };

    K.startMash = () => PB.Mini.start(new PB.MashGame({ produce: q => run('mash', q) }));
    K.startWine = () => PB.Mini.start(new PB.MashGame({ produce: q => run('wine', q) }));

    K.startBottle = () => {
        const c = here(), jug = jugIn(c, 'ready');
        PB.Mini.start(new PB.BottleGame({
            jugQ: () => jug.jug.quality,
            servings: () => jug.jug.state === 'ready' ? jug.jug.servings : 0,
            canContinue: () => jug.jug.state === 'ready' && jug.jug.servings > 0 && !!find(c, ['bottle']) && PB.Items.list.includes(jug),
            produce: q => run('bottle', q, { jug: jug.uid })
        }));
    };

    return K;
})();
