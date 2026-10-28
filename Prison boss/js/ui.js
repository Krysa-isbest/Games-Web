'use strict';
// HTML user interface: HUD, panels (trader, customer, crafting, summary, help), menus.
PB.UI = (() => {
    const U = {};
    const $ = id => document.getElementById(id);
    let panelOpen = false, panelClosable = true, panelOnClose = null, renderFn = null;
    let traderTab = 'buy', pauseAt = 0, hudT = 0, lastPrompt = null;
    const bubbles = {};

    U.init = () => {
        $('btn-new').onclick = () => {
            PB.Audio.init();
            if (PB.Game.hasSave() && !confirm('Start a new game? Your saved progress will be lost.')) return;
            PB.Game.newGame();
        };
        $('btn-continue').onclick = () => { PB.Audio.init(); PB.Game.continueGame(); };
        $('btn-help').onclick = () => U.openHelp();
        $('btn-resume').onclick = () => U.resume();
        $('btn-help2').onclick = () => U.openHelp();
        $('btn-settings').onclick = () => PB.Settings.open();
        // waiting for a new key in the keybinds list: grab the next key press before anything else sees it
        addEventListener('keydown', e => {
            if (!PB.Keys.waiting) return;
            e.preventDefault(); e.stopImmediatePropagation();
            if (e.code !== 'Escape') PB.Keys.set(PB.Keys.waiting, e.code);
            PB.Keys.waiting = null;
            U.refresh();
        }, true);
        U.updateKeysHint();
        $('btn-unstuck').onclick = () => { $('pause').classList.add('hidden'); PB.Player.unstuck(); PB.Player.lock(); };
        $('btn-vr').onclick = () => PB.VR.active ? PB.VR.exit() : PB.VR.enter();
        $('btn-vr2').onclick = () => PB.VR.active ? PB.VR.exit() : PB.VR.enter();
        $('btn-settings2').onclick = () => PB.Settings.open();
        // live sliders in the settings panel
        $('panel-body').addEventListener('input', e => {
            const k = e.target.dataset && e.target.dataset.set;
            if (!k) return;
            PB.Settings.set(k, e.target.value);
            const lbl = e.target.parentElement.querySelector('.set-val');
            if (lbl) lbl.textContent = PB.Settings.fmt(k, e.target.value);
        });
        $('btn-quit').onclick = () => { $('pause').classList.add('hidden'); PB.Game.toMenu(); };
        $('panel-close').onclick = () => U.closePanel();
        $('panel-body').addEventListener('click', e => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            PB.Audio.play('click');
            const fn = U.act[b.dataset.act];
            if (fn) fn(b.dataset.arg);
        });
        addEventListener('keydown', e => {
            if (e.code !== 'Escape') return;
            if (panelOpen) { if (panelClosable) U.closePanel(); }
            else if (!$('pause').classList.contains('hidden') && performance.now() - pauseAt > 300) U.resume();
        });
    };

    U.updateKeysHint = () => {
        const k = a => PB.Keys.label(PB.Keys.get(a));
        $('keys-hint').textContent = `${k('forward')}${k('left')}${k('back')}${k('right')} move · Mouse look · LMB pick/place · ${k('rotate')} rotate · ${k('throw')} throw · ${k('use')} use · ${k('alt')} alt · ${k('putback')} put back · ${k('music')} music · ${k('help')} help · Esc pause`;
    };

    // "Enter VR" buttons only show when VR is switched ON in the settings
    U.updateVRButtons = () => {
        const on = PB.Settings.v.vr;
        ['btn-vr', 'btn-vr2'].forEach(id => {
            const b = $(id);
            if (!b) return;
            b.classList.toggle('hidden', !on);
            b.textContent = PB.VR.active ? '🥽 Exit VR' : PB.VR.supported ? '🥽 Enter VR' : '🥽 VR (no headset found)';
            b.disabled = !PB.VR.supported && !PB.VR.active;
        });
    };

    U.blocking = () => panelOpen || !$('pause').classList.contains('hidden') || !$('menu').classList.contains('hidden');

    // ---------- Menus ----------
    U.showMenu = () => {
        $('menu').classList.remove('hidden');
        $('hud').classList.add('hidden');
        $('btn-continue').classList.toggle('hidden', !PB.Game.hasSave());
    };
    U.hideMenu = () => { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); };
    U.openPause = () => {
        if (U.blocking()) return;
        pauseAt = performance.now();
        PB.Player.unlock();
        $('pause').classList.remove('hidden');
    };
    U.resume = () => { $('pause').classList.add('hidden'); PB.Player.lock(); };
    U.setLocked = l => $('click-to-play').classList.toggle('hidden', l);

    // ---------- Generic panel ----------
    U.panel = (title, render, o = {}) => {
        PB.Player.unlock();
        panelOpen = true;
        panelClosable = o.closable !== false;
        panelOnClose = o.onClose || null;
        renderFn = render;
        $('panel-title').textContent = title;
        $('panel').classList.toggle('wide', !!o.wide);
        $('panel-close').classList.toggle('hidden', !panelClosable);
        $('panel-wrap').classList.remove('hidden');
        U.refresh();
    };
    U.refresh = () => { if (panelOpen && renderFn) $('panel-body').innerHTML = renderFn(); };
    U.closePanel = (relock = true) => {
        if (!panelOpen) return;
        panelOpen = false; renderFn = null;
        $('panel-wrap').classList.add('hidden');
        const cb = panelOnClose; panelOnClose = null;
        if (cb) cb();
        if (relock && PB.Player.enabled && $('menu').classList.contains('hidden')) PB.Player.lock();
    };
    U.isPanelOpen = () => panelOpen;

    // ---------- HUD ----------
    U.toast = (msg, kind = '', dur = 3.2) => {
        const t = document.createElement('div');
        t.className = 'toast ' + kind;
        t.innerHTML = msg;
        $('toasts').appendChild(t);
        while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, dur * 1000);
    };

    U.prompt = (text, active) => {
        if (text !== lastPrompt) { $('prompt').innerHTML = text; lastPrompt = text; }
        $('crosshair').classList.toggle('active', !!active);
    };

    U.setHeld = it => {
        if (!it) { $('held').innerHTML = ''; return; }
        const d = PB.ITEMS[it.type];
        $('held').innerHTML = `<div class="t">${d.icon} ${PB.Items.label(it)}</div>
            <div class="c">${PB.Items.isContraband(it) ? '<span class="bad">CONTRABAND</span> · ' : ''}LMB place · R rotate · Q put back</div>`;
    };

    // No warnings at all: you watch the guards (and their flashlight) walk around the walkway yourself.
    U.warning = () => {
        const w = $('warning');
        w.style.opacity = 0;
        w.classList.remove('on');
    };

    U.update = dt => {
        hudT -= dt;
        if (hudT <= 0) { hudT = 0.2; U.hud(); }
        U.updateBubbles(dt);
    };

    U.hud = () => {
        const s = PB.state;
        if (!s) return;
        $('hud-daynum').textContent = s.day;
        $('hud-clock').textContent = PB.Game.clock();
        $('hud-phase-icon').textContent = s.phase === 'day' ? '☀️' : '🌙';
        $('hud-money').textContent = Math.floor(s.money);
        const r = PB.rankOf(s.rep), cur = PB.RANKS[r], nxt = PB.RANKS[r + 1];
        $('hud-rank').textContent = cur.name;
        $('hud-rep-bar').style.width = (nxt ? (s.rep - cur.rep) / (nxt.rep - cur.rep) * 100 : 100) + '%';
        $('hud-rep-val').textContent = nxt ? `${Math.floor(s.rep)}/${nxt.rep}` : Math.floor(s.rep);
        $('hud-heat-bar').style.width = PB.clamp(s.heat, 0, 100) + '%';
        const ev = PB.Events.current(), ec = $('hud-event');
        // the chip shows today's event plus your active buffs
        const buffs = Object.keys(s.buffs || {}).filter(k => s.buffs[k] > 0 && PB.Game.BUFFS[k]).map(k => PB.Game.BUFFS[k]);
        const txt = [ev ? `${ev.icon} ${ev.name}` : ''].concat(buffs.map(b => `${b.icon} ${b.name}`)).concat(s.protection ? ['🛡️ Protected'] : []).filter(Boolean).join('  ·  ');
        ec.classList.toggle('hidden', !txt);
        if (txt) {
            ec.textContent = txt;
            ec.title = [ev ? ev.desc : ''].concat(buffs.map(b => `${b.name}: ${b.desc}`)).filter(Boolean).join('\n');
            ec.classList.toggle('good', !ev || !!ev.good);
        }
        const np = $('net-ping');
        if (np) {
            const ms = PB.Coop.active ? PB.Coop.pingText() : '';
            np.classList.toggle('hidden', !ms);
            if (ms) np.textContent = ms;
        }
    };

    U.quests = () => {
        const s = PB.state;
        $('quest-tracker').innerHTML = s.quests.map(q => {
            const deliver = !q.kind || q.kind === 'deliver';
            return `<div class="qt"><div class="qh">${q.giver ? '⭐ ' + q.giver : 'Vinnie'}'s job · ${q.days} day${q.days !== 1 ? 's' : ''} left</div>
                ${PB.Game.questIcon(q)} ${PB.Game.questTitle(q)}${deliver ? '' : ` <b>${Math.floor(q.done)}/${q.count}</b>`}
                <div class="qbar"><div style="width:${q.done / q.count * 100}%"></div></div></div>`;
        }).join('');
    };

    // Speech bubbles above characters
    U.bubble = (key, text, posFn, dur = 3, cls = '') => {
        if (bubbles[key]) bubbles[key].el.remove();
        const el = document.createElement('div');
        el.className = 'bubble ' + cls;
        el.textContent = text;
        $('bubbles').appendChild(el);
        // bubbles belong to the area they were said in (cell world vs. canteen)
        const area = key.startsWith('mate') ? 'any' : key.startsWith('lunch') ? 'canteen' : key.startsWith('shop') ? 'workshop'
            : key.startsWith('yard') ? 'yard' : key.startsWith('kitchen') ? 'kitchen' : key.startsWith('esc') ? 'escape' : key.startsWith('ping') ? PB.World.area : 'cell';
        bubbles[key] = { el, posFn, t: dur, area };
    };
    const v3 = new THREE.Vector3();
    const C_mateAway = key => { const m = PB.Coop.mates[key.slice(4)]; return !!(m && m.away); };
    U.updateBubbles = dt => {
        for (const k in bubbles) {
            const b = bubbles[k];
            b.t -= dt;
            if (b.t <= 0) { b.el.remove(); delete bubbles[k]; continue; }
            v3.copy(b.posFn()).project(PB.World.camera);
            const hiddenMate = b.area === 'any' && C_mateAway(k);
            if (v3.z > 1 || hiddenMate || (b.area !== 'any' && b.area !== PB.World.area)) { b.el.style.display = 'none'; continue; }
            b.el.style.display = '';
            b.el.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px';
            b.el.style.top = ((1 - v3.y) / 2 * innerHeight) + 'px';
        }
    };
    U.removeBubble = key => { if (bubbles[key]) { bubbles[key].el.remove(); delete bubbles[key]; } };
    U.clearBubbles = () => { for (const k in bubbles) { bubbles[k].el.remove(); delete bubbles[k]; } };

    // ---------- Actions from panel buttons ----------
    U.act = {
        gfx: g => { PB.Settings.set('gfx', g); U.refresh(); },
        bind: a => { PB.Keys.waiting = a; U.refresh(); },
        adminUnlock: () => { const el = $('admin-code'); PB.Admin.unlock(el ? el.value : ''); U.refresh(); },
        adminTarget: t => { PB.Admin.target = t; U.refresh(); },
        adminSpawn: t => PB.Admin.spawn(t),
        bindReset: () => { PB.Keys.reset(); U.refresh(); },
        vr: on => { PB.Settings.set('vr', !!on); U.refresh(); },
        cmusic: on => { PB.Settings.set('customMusic', !!on); U.refresh(); },
        vrHands: st => { PB.Settings.set('vrHands', st); U.refresh(); },
        crouchMode: m => { PB.Settings.set('crouchMode', m); U.refresh(); },
        tab: t => { traderTab = t; U.refresh(); },
        buy: type => { PB.Game.buy(type); U.refresh(); },
        sell: uid => { PB.Game.sellItem(+uid); U.refresh(); },
        sellAll: () => { PB.Game.sellAll(); U.refresh(); },
        accept: id => { PB.Game.acceptQuest(id); U.refresh(); },
        deliver: id => { PB.Game.deliverQuest(id); U.refresh(); },
        upgrade: id => { PB.Game.buyUpgrade(id); U.refresh(); },
        tierUp: type => { PB.Game.upgradeTier(type); U.refresh(); },
        service: id => { PB.Game.buyService(id); U.refresh(); },
        craft: id => {
            const r = PB.Craft.recipes().find(x => x.id === id);
            if (r && r.ready) { U.closePanel(false); r.start(); }
        },
        give: () => { if (PB.Game.serveCustomer()) U.closePanel(); else U.refresh(); },
        close: () => U.closePanel(),
        ok: () => U.closePanel(),
        toMenu: () => { U.closePanel(false); PB.Game.toMenu(); },
        escapeBack: () => PB.Escape.finish(false),
        escapeMenu: () => PB.Escape.finish(true)
    };

    const row = (icon, name, desc, right, cls = '') =>
        `<div class="row ${cls}"><div class="ic">${icon}</div><div class="info"><div class="nm">${name}</div><div class="ds">${desc}</div></div>${right}</div>`;
    const btn = (label, act, arg, cls = 'green', disabled = false) =>
        `<button class="btn small ${cls}" data-act="${act}" data-arg="${arg}" ${disabled ? 'disabled' : ''}>${label}</button>`;

    // ---------- Trader ----------
    U.openTrader = (tab = 'buy') => {
        if (PB.VR.isOn()) PB.VRUI.anchor('trader'); // in VR: a shop board at the bars
        traderTab = tab;
        U.panel('Vinnie the Trader', renderTrader, { wide: true });
    };

    function renderTrader() {
        const s = PB.state, rank = PB.rankOf(s.rep);
        const tray = PB.Items.onSurface(PB.Game.trayId()).filter(i => PB.ITEMS[i.type].product);
        const tabs = [['buy', '🛒 Buy'], ['sell', '💰 Sell', tray.length], ['quests', '📜 Jobs', s.offers.length], ['upgrades', '🔧 Upgrades']]
            .map(([id, l, n]) => `<div class="tab ${traderTab === id ? 'on' : ''}" data-act="tab" data-arg="${id}">${l}${n ? `<span class="badge">${n}</span>` : ''}</div>`).join('');
        let body = '';
        if (traderTab === 'buy') {
            body = `<div class="note">Bought goods are pushed through your <b>trade slot</b> (the tray in the bars). Stock is limited and refills every morning.
                <b>Upgrade</b> pays Vinnie's supplier for better ingredients: higher quality, and your goods carry the tier (★ sells for much more).</div><div class="rows">`;
            const G = PB.Game, any = PB.Events.val('anyRank', 0);
            for (const [type, d] of Object.entries(PB.ITEMS)) {
                if (!d.price) continue;
                if (rank < d.rank && !any) { body += row('🔒', d.name, `Unlocks at rank <b>${PB.RANKS[d.rank].name}</b>`, '', 'locked'); continue; }
                const left = s.stock[type] || 0, price = G.price(type), t = G.tier(type);
                let up = '';
                if (PB.TIERABLE.includes(type)) {
                    const cost = G.tierUpCost(type);
                    if (cost == null) up = `<div class="qty">max tier</div>`;
                    else if (rank < PB.TIER_RANK[t + 1]) up = `<div class="qty">🔒 ${PB.TIERS[t + 1].star} at ${PB.RANKS[PB.TIER_RANK[t + 1]].name}</div>`;
                    else up = btn(`⬆ ${PB.TIERS[t + 1].star} $${cost}`, 'tierUp', type, 'orange', !G.canTierUp(type));
                }
                body += row(d.icon, (t ? PB.TIERS[t].name + ' ' : '') + d.name + PB.tierStar(t) + (d.contraband ? ' <span class="grade" style="background:#ffc2c2">!</span>' : ''),
                    d.desc + (t ? ` <b>+${PB.tierQuality(t)} quality.</b>` : ''),
                    `<div class="qty">${left} left</div><div class="pr">$${price}</div>${btn('Buy', 'buy', type, 'green', left <= 0 || s.money < price)}${up}`);
            }
            body += '</div>';
        } else if (traderTab === 'sell') {
            const mult = PB.Game.traderMult();
            body = `<div class="note">Put your goods in the <b>trade slot</b> and Vinnie will make an offer. Customers at the bars usually pay more!</div>`;
            if (!tray.length) body += `<div class="empty">Nothing to sell in the trade slot.</div>`;
            else {
                body += '<div class="rows">' + tray.map(it => row(PB.ITEMS[it.type].icon,
                    `${PB.Items.label(it)} ${PB.gradeTag(it.quality)}${PB.tierStar(it.tier)}`, `Quality ${Math.round(it.quality)}%`,
                    `<div class="pr">$${PB.Game.itemValue(it, mult)}</div>${btn('Sell', 'sell', it.uid)}`)).join('') + '</div>';
                const total = tray.reduce((a, it) => a + PB.Game.itemValue(it, mult), 0);
                body += `<div class="center">${btn(`Sell everything for $${total}`, 'sellAll', '', 'orange')}</div>`;
            }
        } else if (traderTab === 'quests') {
            body = `<div class="note">Jobs pay big money and reputation (max 4 at once). Deliveries go through the trade slot; other jobs count by themselves when you do them. ⭐ jobs come from named inmates and have special rewards.</div><div class="rows">`;
            if (!s.quests.length && !s.offers.length) body += `<div class="empty">No jobs right now. Come back tomorrow.</div>`;
            const G = PB.Game, from = q => q.giver ? `<b>⭐ ${q.giver}:</b> ` : '';
            const reward = q => q.reward ? `<br><small>🎁 ${q.reward.upgrade ? PB.UPGRADES.find(u => u.id === q.reward.upgrade).name : q.reward.buff ? G.BUFFS[q.reward.buff].name + ' buff' : q.reward.item ? PB.ITEMS[q.reward.item].name : 'heat -' + -q.reward.heat}</small>` : '';
            s.quests.forEach(q => {
                const deliver = !q.kind || q.kind === 'deliver';
                const have = deliver ? G.trayMatch(q.type, q.minG).reduce((a, i) => a + i.count, 0) : 0;
                body += row(G.questIcon(q), from(q) + G.questTitle(q),
                    `${deliver ? 'Delivered' : 'Done'} ${Math.floor(q.done)}/${q.count} · ${q.days} day${q.days !== 1 ? 's' : ''} left${deliver ? ' · In slot: ' + have : ''}`,
                    `<div class="pr">$${q.money}<br><small>+${q.rep} rep</small>${reward(q)}</div>${deliver ? btn('Deliver', 'deliver', q.id, 'green', !have) : ''}`);
            });
            s.offers.forEach(q => {
                body += row(G.questIcon(q), `<i>Offer:</i> ${from(q)}${G.questTitle(q)}`, `${q.days} days to finish. "${q.line}"`,
                    `<div class="pr">$${q.money}<br><small>+${q.rep} rep</small>${reward(q)}</div>${btn('Accept', 'accept', q.id, 'orange', s.quests.length >= 4)}`, q.giver ? 'unique' : '');
            });
            body += '</div>';
        } else {
            body = '<h4 class="sub">🔧 Cell upgrades</h4><div class="rows">' + PB.UPGRADES.map(u => {
                if (s.upgrades[u.id]) return row(u.icon, u.name, u.desc, '<div class="pr">✔ Owned</div>');
                if (rank < u.rank) return row('🔒', u.name, `Unlocks at rank <b>${PB.RANKS[u.rank].name}</b>`, '', 'locked');
                return row(u.icon, u.name, u.desc, `<div class="pr">$${u.price}</div>${btn('Buy', 'upgrade', u.id, 'green', s.money < u.price)}`);
            }).join('') + '</div>';
            body += '<h4 class="sub">🤝 Services (buy as often as you like)</h4><div class="rows">' + PB.SERVICES.map(sv => {
                if (rank < sv.rank) return row('🔒', sv.name, `Unlocks at rank <b>${PB.RANKS[sv.rank].name}</b>`, '', 'locked');
                const p = PB.Game.servicePrice(sv.id);
                return row(sv.icon, sv.name, sv.desc, `<div class="pr">$${p}</div>${btn('Pay', 'service', sv.id, 'orange', s.money < p)}`);
            }).join('') + '</div>';
        }
        return `<div class="trader-top"><span>💵 $${Math.floor(s.money)}</span><span>⭐ ${PB.RANKS[rank].name}</span></div><div class="tabs">${tabs}</div>${body}`;
    }

    // ---------- Customer ----------
    U.openCustomer = c => {
        U.panel(c.name, () => {
            const r = c.req, d = PB.ITEMS[r.type];
            const have = PB.Game.trayMatch(r.type, r.minG).reduce((a, i) => a + i.count, 0);
            return `<div class="note">"${PB.NPC.requestText(r).replace('\n', ' ')}"</div>
                <div class="rows">${row(d.icon, `${r.count} × ${d.name}`, `Grade ${PB.GRADES[r.minG].g} or better · In your trade slot: <b>${have}</b>`,
                `<div class="pr">$${r.unit * r.count}</div>`)}</div>
                <div class="center">${btn('Hand it over', 'give', '', 'green', have < r.count)} ${btn('Not now', 'close', '', '')}</div>
                <p class="req" style="text-align:center">Put the goods in the trade slot first. He waits about ${Math.ceil(Math.max(0, c.wait))}s more.</p>`;
        });
    };

    // ---------- Crafting ----------
    U.openCraft = () => {
        if (PB.VR.isOn()) PB.VRUI.anchor('desk'); // in VR: a recipe board standing on the desk
        U.panel('Desk Crafting', () => {
            const list = PB.Craft.recipes().map(r => {
                if (r.locked) return row('🔒', r.name, `Unlocks at rank <b>${PB.RANKS[r.rank].name}</b>`, '', 'locked');
                const needs = r.needs.map(n => `<span class="${n.ok ? 'ok' : (n.optional ? '' : 'no')}">${n.ok ? '✔' : '✘'} ${n.label}</span>`).join(' &nbsp; ');
                return row(r.icon, r.name, `<div class="req">${needs}</div>`, btn('Start', 'craft', r.id, 'orange', !r.ready));
            }).join('');
            return `<div class="note">Ingredients and tools must be <b>on the desk</b>. Finished goods land on the desk. Listen for guard footsteps!</div><div class="rows">${list}</div>`;
        });
    };

    // ---------- Summary ----------
    U.openSummary = (d, cb) => {
        U.panel(`Day ${d.day} is over`, () => `
            <div class="summary">
                <div class="box"><h4>💰 Money</h4><div>Earned: $${Math.round(d.earned)}</div><div>Spent: $${Math.round(d.spent)}</div><div>Now: $${Math.floor(PB.state.money)}</div></div>
                <div class="box"><h4>⭐ Reputation</h4><div>${d.rep >= 0 ? '+' : ''}${Math.round(d.rep)} rep</div><div>Rank: ${PB.RANKS[PB.rankOf(PB.state.rep)].name}</div><div>Heat: ${Math.round(PB.state.heat)}</div></div>
                <div class="box"><h4>🔨 Made</h4>${Object.keys(d.made).length ? Object.entries(d.made).map(([t, n]) => `<div>${t === 'brew' ? '🫙 Brews started' : PB.ITEMS[t].icon + ' ' + PB.ITEMS[t].name}: ${n}</div>`).join('') : '<div>Nothing</div>'}</div>
                <div class="box"><h4>🚨 Confiscated</h4>${d.lost.length ? d.lost.map(x => `<div>${x}</div>`).join('') : '<div>Nothing. Clean!</div>'}</div>
            </div>
            ${d.events.map(e => `<div class="note" style="margin-top:12px">${e}</div>`).join('')}
            <div class="center">${btn('Start Day ' + (d.day + 1), 'ok', '', 'orange')}</div>`,
            { closable: false, onClose: cb });
    };

    // ---------- Help ----------
    U.openHelp = () => {
        const wasMenu = !$('menu').classList.contains('hidden');
        U.panel('How to Play', () => `<div class="help">
            <h3>🎯 Goal</h3>
            <p>Craft contraband, sell it and earn reputation until the whole block calls you <b>Prison Boss</b>.</p>
            <h3>🎮 Controls</h3>
            <ul>
                <li><kbd>WASD</kbd> move · <kbd>Mouse</kbd> look (click the game to lock the mouse)</li>
                <li><kbd>LMB</kbd> pick up / place items · <kbd>R</kbd> or <kbd>Wheel</kbd> rotate · <kbd>Q</kbd> put back</li>
                <li>Drop goods onto a matching stack to <b>stack</b> them · <kbd>F</kbd> on a stack takes one off</li>
                <li><kbd>${PB.Keys.label(PB.Keys.get('throw'))}</kbd> throws the item in your hand. It flies, bounces and lands on the nearest free grid spot.</li>
                <li>All keys can be changed in <b>Settings → Keybinds</b>.</li>
                <li><kbd>E</kbd> use (drawers, desk, bed, lamp, toilet, trader) · <kbd>F</kbd> secondary action (poster, mattress)</li>
                <li><kbd>H</kbd> this help · <kbd>M</kbd> music on/off · <kbd>G</kbd> ping a spot (co-op) · <kbd>Esc</kbd> pause / leave a minigame</li>
                <li>If the mouse won't lock (e.g. inside StackBlitz preview), hold <kbd>Right mouse</kbd> to look.</li>
            </ul>
            <h3>🥽 VR (Settings → VR: ON)</h3>
            <ul>
                <li><b>Left stick</b> walk · <b>Right stick</b> snap turn / scroll menus</li>
                <li><b>Grip</b> (either hand): grab what your hand is touching. It glows when it's in reach. Let go to drop it, or swing and let go to throw. Grab a drawer handle and pull it. Grab the poster to lift it.</li>
                <li><b>Trigger</b>: use what your finger touches, or what the right laser points at (doors, lamp, toilet, Vinnie, buttons)</li>
                <li><b>A</b> use · <b>B</b> secondary · <b>X</b> back / wrist tablet (pause, settings, unstuck) · <b>Y</b> wrist info on/off</li>
                <li>Press the red <b>CRAFT</b> button on your desk for the recipe board. Talk to Vinnie for the shop board at the bars. Poke buttons with your finger.</li>
            </ul>
            <h3>☀️ Day</h3>
            <p>Trading time. No crafting and no guards. Vinnie the trader stands at your bars. Buy ingredients, sell goods and take <b>jobs</b>. Other inmates come by with orders and usually pay more. Everything is exchanged through the <b>trade slot</b> in the bars. Sleep in your bed to skip to night.</p>
            <h3>🍽️ Lunch (12:00 – 13:30)</h3>
            <p>Your cell door opens. Walk out (<kbd>E</kbd> on the door) to the canteen and <b>steal</b> things into your 3 pockets: spoons, a pepper grinder, fruit, sugar, bottles. Never do it inside a guard's <b>red view cone</b>. Guards may frisk you on the way out. Eating your lunch lowers your heat.</p>
            <h3>🕳️ The tunnel</h3>
            <p>Lift the <b>poster</b> (<kbd>F</kbd>) and, at night, dig with a <b>spoon</b> in your hand. Scrape left and right. Digging makes <b>rubble</b>: flush it down the toilet (not too much at once, it clogs!). At 60% you can pass items through the hole, at 100% you can crawl into the next cell. If a guard sees the poster up or the rubble, the tunnel gets filled with concrete. In co-op your friend lives in the next cell.</p>
            <h3>🌙 Night</h3>
            <p>Crafting time. Craft at the desk (<kbd>E</kbd>). Guards patrol the corridor. When you hear <b>footsteps</b>, hide all contraband in a <b>closed drawer</b> (or a secret stash) before they look into your cell. Anything visible, even in your hand, gets confiscated and raises your <b>heat</b>. At 100 heat your cell is searched. The lamp at night also annoys them.</p>
            <h3>🔨 Crafting</h3>
            <p>The camera moves to your desk and you handle everything with the mouse: <b>hold LMB</b> to grab things, let go to drop them, <b>shake</b> the mouse to shake, and hold <b>RMB</b> or <b>Space</b> to tip and pour. Tools like the pen, stamp and masher are picked up with a click and dropped with <b>RMB</b>.</p>
            <ul>
                <li>🚬 <b>Cigarettes</b>: tobacco + rolling papers. Grind (one grind = 3 cigarettes; without a stolen pepper grinder you crush by hand for lower quality), lay a paper down, shake tobacco onto it (the shadow shows where it lands), roll it up, lick and seal.</li>
                <li>📑 <b>Forged papers</b>: blank paper + pen (+ stamp). Type the code, sign with the pen, slam the stamp down.</li>
                <li>🍶 <b>Hooch</b>: jug + 3 fruit + sugar. Drop the fruit in, mash it, pour sugar and water, then let it ferment one night (hidden!). Later, pour it into bottles and cork them.</li>
            </ul>
            <p>Your skill in each minigame sets the <b>quality grade</b> (F to S). Better grades sell for much more.</p>
            <p>Later products: 🃏 <b>marked cards</b> (2 blank sheets + pen), 🚬 <b>cigars</b> (premium tobacco), 🍷 <b>fruit wine</b> (4 fruit + full sugar, ferments 2 nights), 🪪 <b>fake IDs</b> (blank paper + passport photo + pen + stamp).</p>
            <h3>📈 Tiers, upgrades & services</h3>
            <p>Next to <b>Buy</b>, the <b>⬆ Upgrade</b> button pays Vinnie's supplier for better ingredients: Fine ★, Premium ★★, Luxury ★★★. They give more quality and your goods carry the tier, so they sell for a lot more. The Upgrades tab also has cell upgrades (floor safe, sewn-in pocket, work lamp, TV, gold chain...) and repeatable services (bribe a guard, protection deal, block party...).</p>
            <h3>🎉 Events</h3>
            <p>Some mornings bring an event: 🏀 <b>Gym day</b> opens the yard (hoops, weights, raking leaves, packages over the fence), 🍳 <b>Kitchen duty</b> lets you cook for the block for money and respect, and many more buffs and troubles (K9 dogs, lockdowns, card tournaments...). ⭐ Named inmates give unique jobs with special rewards.</p>
            <h3>🦆 Sneaking</h3>
            <p><kbd>${PB.Keys.label(PB.Keys.get('crouch'))}</kbd> crouches (toggle or hold in Settings): slower, but guards see you from much less far.</p>
            <p>Progress saves automatically every morning.</p>
            <div class="center">${btn(wasMenu ? 'Back' : 'Got it', 'ok', '', 'orange')}</div></div>`, { wide: true });
    };

    // The ending: cutscene, the police outpost, the drive into the sunrise (escape.js)
    U.ending = () => PB.Escape.start();

    U.victory = () => {
        PB.Audio.play('rank');
        U.panel('PRISON BOSS!', () => `<div class="help" style="text-align:center">
            <div style="font-size:80px">👑</div>
            <h3>The whole block answers to you now.</h3>
            <p>Days served: ${PB.state.day} · Total earned: $${Math.round(PB.state.stats.earned)} · Goods made: ${PB.state.stats.made}</p>
            <p>You can keep playing and keep growing your empire.</p>
            <div class="center">${btn('Keep running the block', 'ok', '', 'orange')}</div></div>`);
    };

    return U;
})();
