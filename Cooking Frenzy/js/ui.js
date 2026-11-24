'use strict';
// Everything on top of the 3D view: HUD (clock, money, event banner, order tickets, role + EXP, prompts,
// held item, throw charge, fire warning), toasts, served popup, chat, recipe book, 3D tickets on the rail,
// and the screens: main menu, join, lobby, loading, pause, settings, how to play, skills, shop, end of day.
CF.UI = (() => {
    const U = { typing: false };
    const $ = CF.$, esc = CF.esc;
    const cache = {};
    let ticketKey = '', ticketT = 0, roleT = 0, railT = 0, servedT = 0, lastPhase = null, confirmCb = null, cart = {};

    const show = (el, on) => { el = typeof el === 'string' ? $(el) : el; if (el) el.classList.toggle('hidden', !on); };
    const isOpen = id => { const el = $('#' + id); return !!el && !el.classList.contains('hidden'); };
    const setHTML = (sel, html) => { if (cache[sel] === html) return; cache[sel] = html; const el = $(sel); if (el) el.innerHTML = html; };
    const setText = (sel, text) => { if (cache[sel] === text) return; cache[sel] = text; const el = $(sel); if (el) el.textContent = text; };
    const cash = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v || 0));
    const price = v => '$' + (Math.round(v * 100) / 100);
    const inPlay = () => CF.Game.mode === 'play';
    const MODALS = ['join', 'lobby', 'loading', 'pause', 'settings', 'howto', 'skills', 'shop', 'summary', 'confirm'];
    const BLOCKING = ['loading', 'pause', 'settings', 'howto', 'skills', 'shop', 'summary', 'confirm'];
    const NEED_MOUSE = ['shop', 'summary', 'settings', 'howto', 'skills', 'confirm', 'loading'];
    U.blocking = () => BLOCKING.some(isOpen);

    function starsHTML(v) {
        let h = '<span class="stars">';
        for (let i = 0; i < 5; i++) h += `<i class="${v >= i + 1 ? 'f' : v >= i + 0.5 ? 'h' : ''}">★</i>`;
        return h + '</span>';
    }
    U.starsHTML = starsHTML;

    // ---------- toasts ----------
    U.toast = (text, kind) => {
        const box = $('#toasts');
        if (!box || !text) return;
        const el = document.createElement('div');
        el.className = 'toast ' + (kind || 'info');
        el.textContent = text;
        box.appendChild(el);
        while (box.children.length > 5) box.removeChild(box.firstChild);
        setTimeout(() => el.classList.add('out'), 4300);
        setTimeout(() => el.remove(), 4900);
    };
    U.message = text => U.toast(text, 'bad');

    // ---------- served popup ----------
    U.served = info => {
        const el = $('#served');
        if (!el || !inPlay()) return;
        const r = CF.RECIPES[info.r];
        el.innerHTML = `<div class="sv-top">Table ${info.table}${info.critic ? ' · 🎩 Critic' : ''}${info.by === null || info.by === undefined ? ' · 🛎️ runner' : ''}</div>`
            + `<div class="sv-dish">${r ? r.icon + ' ' + esc(r.name) : ''}</div>`
            + `<div class="sv-stars">${starsHTML(info.stars)}</div>`
            + `<div class="sv-pay ${info.pay ? '' : 'bad'}">${info.pay ? '+' + cash(info.pay) : 'No pay!'}${info.tip ? ` <small>incl. ${cash(info.tip)} tip</small>` : ''}</div>`
            + (info.notes && info.notes.length ? `<ul>${info.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '');
        el.classList.remove('hidden', 'pop');
        void el.offsetWidth;
        el.classList.add('pop');
        servedT = 4.2;
    };

    // ---------- EXP ----------
    U.xpGain = (n, up) => {
        const box = $('#hud-role');
        if (box && inPlay()) {
            const el = document.createElement('div');
            el.className = 'xp-pop';
            el.textContent = '+' + n + ' XP';
            box.appendChild(el);
            setTimeout(() => el.remove(), 1300);
        }
        if (up) { U.toast(`⭐ Level ${CF.Profile.level()}! You got a skill point. Spend it at the end of the day.`, 'good'); CF.Audio.play('star'); }
        roleT = 0;
    };

    // ---------- chat ----------
    U.chat = (name, color, text) => {
        const log = $('#chat-log');
        if (!log) return;
        const line = document.createElement('div');
        line.className = 'chat-line';
        line.innerHTML = `<b style="color:${esc(color || '#fff')}">${esc(name)}</b> ${esc(text)}`;
        log.appendChild(line);
        while (log.children.length > 30) log.removeChild(log.firstChild);
        setTimeout(() => line.classList.add('old'), 10000);
        CF.Audio.play('tick');
    };
    U.openChat = () => {
        if (!inPlay() || U.blocking() || U.typing) return;
        const inp = $('#chat-input');
        show(inp, true);
        $('#chat').classList.add('open');
        inp.value = '';
        U.typing = true;
        setTimeout(() => inp.focus(), 0);
    };
    function closeChat() {
        const inp = $('#chat-input');
        U.typing = false;
        if (!inp) return;
        show(inp, false);
        $('#chat').classList.remove('open');
        if (document.activeElement === inp) inp.blur();
    }

    // ---------- recipe book (Tab) ----------
    U.toggleBook = () => {
        const el = $('#book');
        const on = el.classList.contains('hidden');
        if (on) renderBook();
        show(el, on);
    };
    function renderBook() {
        const un = CF.Orders.state.unlocks || {};
        let h = '<h2>📖 Recipe Book</h2><div class="book-grid">';
        for (const k in CF.RECIPES) {
            const r = CF.RECIPES[k], ok = !!un[k];
            h += `<div class="recipe ${ok ? '' : 'locked'}"><div class="r-head"><span class="r-ic">${r.icon}</span><div><b>${esc(r.name)}</b><small>${ok ? `${cash(r.price)} · served in a ${r.dish}` : `🔒 Unlock for ${cash(r.cost)} at the end of a day`}</small></div></div>`;
            h += `<div class="r-need">${r.need.map(n => `<span title="${esc(CF.ITEMS[n.t].name)}">${CF.ITEMS[n.t].icon}${n.n > 1 ? '×' + n.n : ''}</span>`).join('')}</div>`;
            h += `<ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
            if (r.vars.length > 1) h += `<div class="r-vars">${r.vars.map(v => `<span>${esc(v.label)}${v.price ? ` (${v.price > 0 ? '+' : '−'}$${Math.abs(v.price)})` : ''}</span>`).join('')}</div>`;
            h += '</div>';
        }
        h += '</div><p class="book-tip">Tab to close · anything that touches the floor gets dirty · burnt food catches fire!</p>';
        $('#book').innerHTML = h;
    }

    // ---------- 3D tickets on the rail over the pass + Eagle Eye tags ----------
    const rail = [], tags = [];
    function spriteSlot(arr, i, w, h, sw, sh, parent) {
        if (!arr[i]) {
            const cvs = document.createElement('canvas');
            cvs.width = w; cvs.height = h;
            const tex = new THREE.CanvasTexture(cvs);
            tex.encoding = THREE.sRGBEncoding;
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: parent !== CF.World.scene }));
            sp.scale.set(sw, sh, 1);
            if (parent === CF.World.scene) sp.renderOrder = 8;
            parent.add(sp);
            arr[i] = { cvs, tex, sp };
        }
        return arr[i];
    }
    function updateRail() {
        const O = CF.Orders;
        const list = O.customers.filter(c => c.st === 'wait').sort((a, b) => a.id - b.id).slice(0, 7);
        list.forEach((c, i) => {
            const r = spriteSlot(rail, i, 128, 160, 0.24, 0.3, CF.World.ticketRail), g = r.cvs.getContext('2d');
            const o = O.orderText(c), seat = CF.World.seats[c.seat], f = CF.clamp(c.pat / c.max, 0, 1);
            g.clearRect(0, 0, 128, 160);
            g.fillStyle = c.critic ? '#ffe9a8' : '#fffdf6';
            g.fillRect(6, 10, 116, 146);
            g.fillStyle = '#9aa3a8'; g.fillRect(44, 0, 40, 16);
            g.fillStyle = '#1d3557'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.font = 'bold 26px Fredoka, Arial'; g.fillText('T' + (seat ? seat.table + 1 : '?'), 64, 36);
            g.font = '46px serif'; g.fillText(o.rec.icon, 64, 84);
            g.font = '600 14px Fredoka, Arial'; g.fillText(o.label || o.rec.name, 64, 116, 110);
            g.fillStyle = '#ddd'; g.fillRect(16, 132, 96, 12);
            g.fillStyle = f > 0.5 ? '#46d17a' : f > 0.25 ? '#ffb02e' : '#ff4d4d'; g.fillRect(16, 132, 96 * f, 12);
            r.tex.needsUpdate = true;
            r.sp.visible = true;
            r.sp.position.set(0, -0.16, -1.2 + i * 0.4);
        });
        for (let i = list.length; i < rail.length; i++) rail[i].sp.visible = false;
    }
    function updateEagle() {
        const O = CF.Orders, on = CF.Profile.has('eagle');
        const dishes = on ? CF.Items.all().filter(it => it.def.dish && !it.s.dirty && it.contents.length && !it.container && it.heldBy === null && CF.World.inZone(CF.World.zones.pass, it.mesh.position)).slice(0, 6) : [];
        let n = 0;
        for (const d of dishes) {
            let best = null, bs = 2.9;
            for (const c of O.customers) if (c.st === 'wait') { const sc = O.score(d, c).stars; if (sc > bs) { bs = sc; best = c; } }
            if (!best) continue;
            const tg = spriteSlot(tags, n++, 96, 96, 0.22, 0.22, CF.World.scene), g = tg.cvs.getContext('2d');
            const seat = CF.World.seats[best.seat];
            g.clearRect(0, 0, 96, 96);
            g.strokeStyle = '#46d17a'; g.lineWidth = 8; g.beginPath(); g.arc(48, 48, 40, 0, Math.PI * 2); g.stroke();
            g.fillStyle = 'rgba(20,40,30,0.75)'; g.beginPath(); g.arc(48, 48, 36, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#fff'; g.font = 'bold 30px Fredoka, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText('T' + (seat ? seat.table + 1 : '?'), 48, 50);
            tg.tex.needsUpdate = true;
            tg.sp.position.set(d.mesh.position.x, d.mesh.position.y + 0.28, d.mesh.position.z);
            tg.sp.visible = true;
        }
        for (let i = n; i < tags.length; i++) tags[i].sp.visible = false;
    }

    // ---------- HUD ----------
    function resetHud() {
        ticketKey = ''; lastPhase = null; servedT = 0;
        for (const k in cache) delete cache[k];
        const t = $('#tickets'); if (t) t.innerHTML = '';
        show('#served', false); show('#hud-event', false); show('#fire-warn', false); show('#charge', false); show('#hold-ring', false);
        for (const r of rail) r.sp.visible = false;
        for (const r of tags) r.sp.visible = false;
        $('#fire-vignette').style.opacity = 0;
    }
    function contentsIcons(it) {
        if (!it.def.cont || !it.contents.length) return '';
        const icons = it.contents.map(id => CF.Items.get(id)).filter(Boolean).map(c => c.def.icon + (c.contents.length ? '<sup>' + c.contents.length + '</sup>' : '')).join('');
        return ` <span class="p-cont">${icons}</span>`;
    }
    function updateTop(s) {
        setText('#hud-day', 'Day ' + s.day);
        const ph = s.phase;
        const label = ph === 'prep' ? 'PREP' : ph === 'open' ? 'OPEN' : ph === 'closing' ? 'LAST ORDERS' : 'CLOSED';
        setText('#hud-phase', label);
        const el = $('#hud-phase');
        if (cache.phaseCls !== ph) { cache.phaseCls = ph; el.className = 'pill phase ' + ph; }
        const time = ph === 'prep' ? s.prep : ph === 'open' ? s.time : ph === 'closing' ? s.closeT : 0;
        setText('#hud-time', ph === 'summary' || (ph === 'prep' && CF.Goals.holdPrep()) ? '--:--' : CF.fmtTime(time));
        setText('#hud-money', cash(s.money));
        $('#hud-money').classList.toggle('neg', s.money < 0);
        setText('#hud-sub', ph === 'prep' ? (CF.Goals.holdPrep() ? 'Prep time: the restaurant opens when you flip the OPEN sign by the pass' : 'Prep time: flip the OPEN sign by the pass when you are ready') : ph === 'closing' ? 'Kitchen closing: finish the last orders!' : '');
        const ev = s.event;
        if (ev && CF.EVENTS[ev.k]) {
            const E = CF.EVENTS[ev.k];
            setHTML('#hud-event', `<span class="ev-ic">${E.icon}</span><div><b>${esc(E.name)}</b><span>${esc(E.desc)}</span></div><em>${Math.max(0, Math.ceil(ev.t))}s</em>`);
            $('#hud-event').style.borderColor = E.col;
            show('#hud-event', true);
        } else show('#hud-event', false);
    }
    function updateTickets(dt) {
        ticketT -= dt;
        if (ticketT > 0) return;
        ticketT = 0.2;
        const O = CF.Orders, box = $('#tickets');
        const list = O.customers.filter(c => c.st === 'wait').sort((a, b) => (a.pat / a.max) - (b.pat / b.max)).slice(0, 8);
        const key = list.map(c => c.id + ':' + (c.greeted ? 1 : 0)).join(',');
        if (key !== ticketKey) {
            ticketKey = key;
            box.innerHTML = list.map(c => {
                const o = O.orderText(c), seat = CF.World.seats[c.seat];
                return `<div class="ticket ${c.critic ? 'critic' : ''}" data-c="${c.id}"><div class="t-top"><span class="t-table">T${seat ? seat.table + 1 : '?'}</span>${c.critic ? '<span class="t-crit">🎩 CRITIC</span>' : ''}${!c.greeted ? '<span class="t-wave" title="Not greeted yet: greet them (E) and they wait longer">👋</span>' : ''}</div>`
                    + `<div class="t-dish"><span>${o.rec.icon}</span><b>${esc(o.rec.name)}</b></div>${o.label ? `<div class="t-var">${esc(o.label)}</div>` : ''}<div class="t-bar"><i></i></div></div>`;
            }).join('');
        }
        for (const el of box.children) {
            const c = O.customers.find(x => x.id === +el.dataset.c);
            if (!c) continue;
            const f = CF.clamp(c.pat / c.max, 0, 1), bar = el.querySelector('i');
            bar.style.width = (f * 100).toFixed(1) + '%';
            bar.style.background = f > 0.5 ? '#46d17a' : f > 0.25 ? '#ffb02e' : '#ff4d4d';
            el.classList.toggle('urgent', f < 0.25);
        }
    }
    function updateRole(dt) {
        roleT -= dt;
        if (roleT > 0) return;
        roleT = 0.5;
        const pr = CF.Profile.progress(), pts = CF.Profile.points();
        setHTML('#role-badge', `<span class="rb">⭐ Chef</span><b>Lv ${pr.level}</b>${pts > 0 ? `<em>+${pts} skill pt</em>` : ''}`);
        $('#xp-fill').style.width = (pr.into / pr.need * 100).toFixed(1) + '%';
    }
    function updatePrompt() {
        const P = CF.Player, pr = P.prompt || {}, tg = P.target, held = P.held ? CF.Items.get(P.held) : null;
        let h = '';
        const keys = [];
        if (P.active && !CF.MG.active) {
            if (tg && tg.kind === 'item') {
                const it = CF.Items.get(tg.id);
                if (it) {
                    const det = CF.Items.details(it, CF.Profile.has('nose'));
                    h += `<div class="p-name">${esc(CF.Items.label(it))}${contentsIcons(it)}</div>${det ? `<div class="p-det">${esc(det)}</div>` : ''}`;
                }
            }
            if (pr.info) h += `<div class="p-info">${esc(pr.info)}</div>`;
            if (!held && tg && (tg.kind === 'item' || (tg.kind === 'st' && (tg.sid === 'plates' || tg.sid === 'bowls')))) keys.push(['LMB', tg.kind === 'item' ? 'Grab' : 'Take one', false]);
            if (pr.e) keys.push(['E', pr.e.text, !!pr.e.none]);
            if (pr.f && (!pr.f.none || tg)) keys.push(['F', pr.f.text, !!pr.f.none]);
            h += keys.map(k => `<div class="p-key ${k[2] ? 'dim' : ''}"><b>${k[0]}</b>${esc(k[1])}</div>`).join('');
        }
        setHTML('#prompt', h);
        let hh = '';
        if (held && P.active && !CF.MG.active) {
            hh = `<div class="h-item">${esc(CF.Items.label(held))}${contentsIcons(held)}</div>`
                + '<div class="h-keys"><span><b>LMB</b> drop</span><span><b>RMB</b> hold to throw</span><span><b>R</b> rotate</span><span><b>Wheel</b> reach</span></div>';
        }
        setHTML('#held', hh);
        const on = !!(tg && (keys.some(k => !k[2])));
        if (cache.cross !== on) { cache.cross = on; $('#crosshair').classList.toggle('on', on); }
        show('#crosshair', P.active && !CF.MG.active);
        // throw charge + hold-E progress
        const ch = P.charge;
        show('#charge', ch >= 0);
        if (ch >= 0) $('#charge-fill').style.width = (CF.clamp(ch / 0.7, 0, 1) * 100).toFixed(0) + '%';
        const he = P.holdE;
        show('#hold-ring', !!he);
        if (he) $('#hold-arc').style.strokeDashoffset = (126 * (1 - CF.clamp(he.t / 1.2, 0, 1))).toFixed(1);
    }
    function updateFire() {
        const fires = CF.Cook.fireCount(), bf = CF.Cook.bigFire || 0;
        $('#fire-vignette').style.opacity = fires ? Math.min(0.85, 0.12 + fires * 0.025 + bf / 12 * 0.5).toFixed(2) : 0;
        let w = '';
        if (bf > 0.5) w = `🔥 KITCHEN FIRE! Put it out or you get shut down in ${Math.max(0, Math.ceil(12 - bf))}s`;
        else if (fires >= 3) w = '🔥 Fire! Grab a red extinguisher and hold F';
        setText('#fire-warn', w);
        show('#fire-warn', !!w);
    }

    U.update = dt => {
        if (!inPlay()) return;
        const s = CF.Orders.state, ph = s.phase;
        if (ph !== lastPhase) {
            if (ph === 'summary') U.showSummary();
            else if (lastPhase === 'summary') {
                show('#summary', false);
                if (!CF.Player.locked && !U.blocking()) showPause(`☀️ Day ${s.day}`, 'Start the day');
            }
            lastPhase = ph;
        }
        updateTop(s);
        updateTickets(dt);
        updateRole(dt);
        updatePrompt();
        updateFire();
        CF.Goals.updateHud();
        if (servedT > 0) { servedT -= dt; if (servedT <= 0) show('#served', false); }
        railT -= dt;
        if (railT <= 0) { railT = 0.4; updateRail(); updateEagle(); }
    };

    // ---------- pause + pointer lock ----------
    // solo only: these screens freeze the kitchen (co-op keeps running)
    U.paused = () => ['pause', 'settings', 'howto', 'skills', 'confirm', 'loading'].some(isOpen);
    function showPause(title, btn) {
        if (!inPlay()) return;
        $('#pause-title').textContent = title || 'Paused';
        $('#btn-resume').textContent = btn || 'Resume';
        const S = CF.Sync;
        $('#pause-sub').textContent = S.mode === 'host' ? `Room code ${S.code} · the kitchen keeps running while you are away`
            : S.mode === 'client' ? 'The kitchen keeps running while you are away'
            : 'The kitchen is paused';
        show('#pause', true);
    }
    U.onLock = () => show('#pause', false);
    U.onUnlock = () => {
        if (!inPlay() || NEED_MOUSE.some(isOpen)) return;
        if (U.typing) closeChat();
        showPause();
    };
    // a mouse panel closed during the game: take the mouse back (the pause screen catches a failed lock)
    function backToGame() {
        if (!inPlay() || NEED_MOUSE.some(isOpen) || isOpen('pause')) return;
        showPause('Paused', 'Resume');
        CF.Player.lock();
    }
    U.loading = (on, text) => {
        if (text) $('#loading-text').textContent = text;
        show('#loading', on);
    };
    U.loaded = () => {
        show('#loading', false);
        if (inPlay() && !CF.Player.locked && !isOpen('summary')) showPause('Ready to cook?', 'Click to start');
    };
    U.joinStatus = text => { $('#join-status').textContent = text || ''; };

    // ---------- main menu + lobby ----------
    U.enterGame = () => {
        for (const id of MODALS) show('#' + id, false);
        show('#menu', false); show('#hud', true); show('#book', false);
        closeChat();
        resetHud();
        showPause('Ready to cook?', 'Click to start');
    };
    U.showMenu = () => {
        for (const id of MODALS) show('#' + id, false);
        show('#hud', false); show('#book', false); show('#menu', true);
        $('#chat-log').innerHTML = '';
        closeChat();
        resetHud();
        refreshMenu();
    };
    function refreshMenu() {
        const sv = CF.Orders.load(), bc = $('#btn-continue');
        if (sv) { bc.innerHTML = `▶ Continue <small>Day ${sv.day} · ${cash(sv.money)}</small>`; show(bc, true); } else show(bc, false);
        $('#hat-colors').innerHTML = CF.HAT_COLORS.map((c, i) => `<button class="sw ${i === CF.settings.color ? 'on' : ''}" data-hat="${i}" style="background:${c}" title="Hat colour"></button>`).join('');
        const pr = CF.Profile.progress(), pts = CF.Profile.points();
        $('#menu-level').innerHTML = `<div class="lv"><b>Level ${pr.level}</b><span>${pr.into}/${pr.need} XP</span></div><div class="xpbar"><i style="width:${(pr.into / pr.need * 100).toFixed(1)}%"></i></div>`
            + (pts > 0 ? `<div class="pts">⭐ ${pts} skill point${pts > 1 ? 's' : ''} to spend!</div>` : '');
        const nm = $('#chef-name');
        if (document.activeElement !== nm) nm.value = CF.settings.name;
    }
    U.showLobby = () => {
        for (const id of MODALS) show('#' + id, false);
        show('#menu', true);
        show('#lobby', true);
        U.updateLobby();
    };
    U.updateLobby = () => {
        if (!isOpen('lobby')) return;
        const S = CF.Sync, host = S.isHost;
        $('#lobby-code').textContent = S.code || '-----';
        const ps = Object.values(S.players).sort((a, b) => a.pid - b.pid);
        let h = '';
        for (const p of ps) {
            h += `<li><span class="dot" style="background:${esc(p.color)}"></span><b>${esc(p.name)}</b>${p.level ? `<span class="tag">⭐ Lv ${p.level}</span>` : ''}${p.pid === 0 ? '<em>host</em>' : ''}${p.pid === S.myPid ? '<em class="you">you</em>' : ''}</li>`;
        }
        for (let i = ps.length; i < 4; i++) h += '<li class="empty">Waiting for a chef…</li>';
        $('#lobby-list').innerHTML = h;
        show('#lobby-host', host);
        show('#lobby-wait', !host);
        const sv = CF.Orders.load();
        show('#lobby-save-row', host && !!sv);
        if (sv) $('#lobby-save-label').textContent = `Continue my saved restaurant (Day ${sv.day}, ${cash(sv.money)})`;
    };

    // ---------- shop (the terminal by the back door) ----------
    const KITS = {
        burger: { label: '🍔 4 burgers', items: { bun: 4, patty: 4, tomato: 1, lettuce: 1, cheese: 1 } },
        salad: { label: '🥗 4 salads', items: { lettuce: 2, tomato: 2, onion: 1 } },
        steak: { label: '🥩 2 steaks', items: { steak: 2, potato: 2 } },
        soup: { label: '🍲 2 soups', items: { tomato: 3, onion: 1 } },
        pizza: { label: '🍕 2 pizzas', items: { dough: 2, tomato: 1, cheese: 1, salami: 1, mushroom: 1 } }
    };
    U.openShop = () => {
        if (!inPlay()) return;
        cart = {};
        renderShop();
        show('#shop', true);
        CF.Player.unlock();
    };
    function cartTotal() {
        let t = 0;
        for (const k in cart) t += (CF.PRICE[k] || 0) * cart[k];
        return Math.round(t * 100) / 100;
    }
    // how many more of an ingredient fit into its pantry bin (counting what is already on the truck)
    const shopMax = k => CF.PANTRY[k] ? CF.Stations.room(k) : 30;
    function renderShop() {
        const money = CF.Orders.state.money, total = cartTotal(), un = CF.Orders.state.unlocks || {}, st = CF.Stations.state;
        let h = `<div class="shop-head"><h2>🛒 Fresh Market</h2><div class="pill money ${money < 0 ? 'neg' : ''}">${cash(money)}</div></div>`;
        h += '<div class="kits"><span>Quick kits</span>' + Object.keys(KITS).filter(k => un[k]).map(k => `<button class="btn small" data-shop="kit" data-k="${k}">${KITS[k].label}</button>`).join('') + '</div>';
        h += '<div class="shop-cats">';
        for (const c of CF.SHOP) {
            h += `<div class="shop-cat"><h3>${esc(c.cat)}</h3>`;
            for (const [k, p] of c.items) {
                const d = CF.ITEMS[k], n = cart[k] || 0, max = shopMax(k);
                let have = '';
                if (CF.PANTRY[k]) {
                    const s = (st.stock || {})[k] || 0, inc = (st.incoming || {})[k] || 0;
                    have = `<small class="have ${s ? '' : 'none'}" title="In the pantry / fits">${s}/${CF.PANTRY[k].cap}${inc ? ` +${inc}🚚` : ''}</small>`;
                } else if (k === 'plate' || k === 'bowl') have = `<small class="have">${st[k + 's']} clean</small>`;
                h += `<div class="shop-row ${n ? 'on' : ''}"><span class="ic">${d.icon}</span><span class="nm">${esc(d.name)}${have}</span><span class="pr">${price(p)}</span><button data-shop="-" data-k="${k}">−</button><b>${n}</b><button data-shop="+" data-k="${k}" ${n >= max ? 'disabled title="The pantry bin is full"' : ''}>+</button></div>`;
            }
            h += '</div>';
        }
        h += `</div><div class="shop-foot"><div class="tot">Total <b class="${total > money ? 'bad' : ''}">${price(total)}</b><small>Arrives in ${CF.Orders.has('express') ? 4 : 12}s · food goes straight into its pantry bin, plates and bowls onto their stacks, cookware onto the table by the back door · Shift+click adds 5</small></div>`
            + `<button class="btn small" data-shop="clear">Clear</button><button class="btn small" data-shop="close">Close</button><button class="btn go" data-shop="order" ${!total || total > money ? 'disabled' : ''}>Order</button></div>`;
        $('#shop-body').innerHTML = h;
    }
    function shopClick(e) {
        const b = e.target.closest('[data-shop]');
        if (!b || b.disabled) return;
        const a = b.dataset.shop, k = b.dataset.k;
        if (a === '+' || a === '-') {
            const n = CF.clamp((cart[k] || 0) + (a === '+' ? 1 : -1) * (e.shiftKey ? 5 : 1), 0, shopMax(k));
            if (n) cart[k] = n; else delete cart[k];
            renderShop();
        } else if (a === 'kit' && KITS[k]) {
            let full = false;
            for (const t in KITS[k].items) {
                const n = Math.min(shopMax(t), (cart[t] || 0) + KITS[k].items[t]);
                if (n < (cart[t] || 0) + KITS[k].items[t]) full = true;
                if (n) cart[t] = n; else delete cart[t];
            }
            if (full) U.toast('Some of it doesn\'t fit in the pantry, so the kit was made smaller.', 'info');
            renderShop();
        } else if (a === 'clear') { cart = {}; renderShop(); }
        else if (a === 'close') { show('#shop', false); backToGame(); }
        else if (a === 'order') {
            const total = cartTotal();
            if (!total) return;
            if (total > CF.Orders.state.money) { U.toast('Not enough money!', 'bad'); return; }
            CF.Sync.act({ t: 'buy', cart: Object.assign({}, cart) });
            CF.Audio.play('cash');
            cart = {};
            show('#shop', false);
            backToGame();
        }
    }

    // ---------- end of day ----------
    U.showSummary = () => {
        if (!inPlay()) return;
        renderSummary();
        show('#summary', true);
        show('#pause', false);
        show('#shop', false);
        if (U.typing) closeChat();
        CF.MG.cancel();
        CF.Player.unlock();
    };
    function renderSummary() {
        const s = CF.Orders.state, st = s.stats || {}, host = CF.Sync.isHost;
        const served = st.served || 0, fails = st.fails || 0, guests = served + fails, rating = guests ? (st.stars || 0) / guests : 0;
        const fire = s.fail === 'fire';
        let h = `<div class="sum-head ${fire ? 'bad' : ''}"><h2>${fire ? '🔥 Kitchen shut down!' : `🌙 Day ${s.day} complete!`}</h2>${fire ? '<p>The fire got out of hand and the fire brigade closed you early (−$50 fine).</p>' : ''}</div>`;
        h += `<div class="sum-rating">${starsHTML(rating)}<span>${rating.toFixed(1)} average from ${guests} guest${guests === 1 ? '' : 's'}</span></div>`;
        const net = (st.earned || 0) + (st.tips || 0) + (st.bonus || 0) - (st.spent || 0) - (st.fines || 0);
        h += '<div class="sum-grid">' + [
            ['🍽️ Served', served], ['😠 Walked out', fails], ['💵 Meals', cash(st.earned)], ['🪙 Tips', cash(st.tips)],
            ['🎁 Bonuses', cash(st.bonus)], ['🛒 Shopping', cash(-(st.spent || 0))], ['🚨 Fines', cash(-(st.fines || 0))], ['💥 Broken', st.broken || 0]
        ].map(([k, v]) => `<div class="sum-stat"><span>${k}</span><b>${v}</b></div>`).join('') + '</div>';
        const best = st.best && CF.RECIPES[st.best.r];
        h += `<div class="sum-money"><span>Today <b class="${net < 0 ? 'bad' : 'good'}">${net < 0 ? '' : '+'}${cash(net)}</b></span><span>Bank <b>${cash(s.money)}</b></span><span>Best day <b>${cash(s.best)}</b></span>`
            + (best ? `<span>Best dish <b>${best.icon} ${esc(best.name)} ${st.best.stars}★</b></span>` : '') + '</div>';
        h += CF.Goals.summaryHTML();
        h += '<div class="sum-cols"><div class="sum-col"><h3>🛠️ Upgrades</h3>' + CF.UPGRADES.map(u => {
            const own = !!(s.upgrades || {})[u.id], can = host && !own && s.money >= u.price;
            return `<div class="shop-up ${own ? 'own' : ''}"><span class="ic">${u.icon}</span><div><b>${esc(u.name)}</b><small>${esc(u.desc)}</small></div><button class="btn small" data-sum="upgrade" data-id="${u.id}" ${can ? '' : 'disabled'}>${own ? '✓ Owned' : cash(u.price)}</button></div>`;
        }).join('') + '</div>';
        h += '<div class="sum-col"><h3>📜 New dishes</h3>' + Object.keys(CF.RECIPES).filter(k => !CF.RECIPES[k].start).map(k => {
            const r = CF.RECIPES[k], own = !!(s.unlocks || {})[k], can = host && !own && s.money >= r.cost;
            return `<div class="shop-up ${own ? 'own' : ''}"><span class="ic">${r.icon}</span><div><b>${esc(r.name)}</b><small>Sells for ${cash(r.price)}</small></div><button class="btn small" data-sum="unlock" data-id="${k}" ${can ? '' : 'disabled'}>${own ? '✓ On the menu' : cash(r.cost)}</button></div>`;
        }).join('');
        const pr = CF.Profile.progress(), pts = CF.Profile.points();
        h += `<h3>🧑‍🍳 You</h3><div class="sum-you"><span>Level ${pr.level} · ${pr.into}/${pr.need} XP</span><button class="btn small ${pts ? 'glow' : ''}" data-sum="skills">Skills${pts ? ` (${pts} pt)` : ''}</button></div></div></div>`;
        if (!host) h += '<p class="note">Only the host buys upgrades and new dishes.</p>';
        h += `<div class="sum-foot"><button class="btn small" data-sum="quit">Quit to menu</button>${host ? `<button class="btn go big" data-sum="next">Start Day ${s.day + 1} ▶</button>` : '<span class="wait">Waiting for the host to start the next day…</span>'}</div>`;
        $('#summary-body').innerHTML = h;
    }
    function summaryClick(e) {
        const b = e.target.closest('[data-sum]');
        if (!b || b.disabled) return;
        const a = b.dataset.sum;
        if (a === 'upgrade') CF.Sync.act({ t: 'upgrade', id: b.dataset.id });
        else if (a === 'unlock') CF.Sync.act({ t: 'unlock', id: b.dataset.id });
        else if (a === 'skills') U.openSkills();
        else if (a === 'next') CF.Sync.act({ t: 'nextDay' });
        else if (a === 'quit') U.confirm('Leave the kitchen and go back to the main menu? Your restaurant is saved.', 'Quit', () => CF.Game.quit());
    }

    // ---------- skills ----------
    U.openSkills = () => { renderSkills(); show('#skills', true); };
    function renderSkills() {
        const pr = CF.Profile.progress(), pts = CF.Profile.points();
        let h = `<div class="sk-head"><div><b>Level ${pr.level}</b> <span>${pr.into}/${pr.need} XP</span></div><div class="pts ${pts ? 'on' : ''}">${pts} skill point${pts === 1 ? '' : 's'}</div></div>`
            + '<p class="note">You get a point every level. Everyone cooks and serves, so every skill you learn always works.</p><div class="sk-cols">';
        for (const cat in CF.SKILL_CATS) {
            const R = CF.SKILL_CATS[cat];
            h += `<div class="sk-col"><h3 style="color:${R.col}">${R.icon} ${R.name}</h3>`;
            for (const s of CF.SKILLS[cat]) {
                const own = CF.Profile.has(s.id), can = !own && pts >= s.cost;
                h += `<div class="skill ${own ? 'own' : ''}"><span class="ic">${s.icon}</span><div><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></div><button class="btn small" data-skill="${s.id}" ${can ? '' : 'disabled'}>${own ? '✓ Learned' : `Learn · ${s.cost} pt`}</button></div>`;
            }
            h += '</div>';
        }
        h += '</div><div class="row end"><button class="btn small" data-skill="reset">Reset skills</button><button class="btn" data-close="skills">Done</button></div>';
        $('#skills-body').innerHTML = h;
    }
    function syncSkills() { if (CF.Sync.mode !== 'off') CF.Sync.act({ t: 'skills', list: CF.Profile.data.skills.slice(), level: CF.Profile.level() }); }
    function refreshAll() {
        if (!inPlay()) refreshMenu();
        if (isOpen('summary')) renderSummary();
        roleT = 0;
    }
    function skillsClick(e) {
        const b = e.target.closest('[data-skill]');
        if (!b || b.disabled) return;
        const id = b.dataset.skill;
        if (id === 'reset') {
            U.confirm('Forget all your skills and get the points back?', 'Reset', () => { CF.Profile.reset(); syncSkills(); renderSkills(); refreshAll(); });
            return;
        }
        if (CF.Profile.buy(id)) { CF.Audio.play('star'); syncSkills(); renderSkills(); refreshAll(); }
    }

    // ---------- settings ----------
    // settings rows: [key, label, kind, ...] kind = range (min, max, step) | select (options) | check
    const SET_UI = [
        ['Graphics', [
            ['gfx', 'Quality preset', 'select', [['low', 'Low (fastest)'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']]],
            ['scale', 'Render scale', 'range', 0.5, 1.5, 0.05],
            ['bright', 'Brightness', 'range', 0.6, 1.5, 0.05],
            ['fpsCap', 'Frame limit', 'select', [[0, 'Unlimited'], [144, '144 FPS'], [120, '120 FPS'], [60, '60 FPS'], [30, '30 FPS']]],
            ['fps', 'Show FPS', 'check']
        ]],
        ['Advanced graphics', [
            ['shadowQ', 'Shadow quality', 'select', [['off', 'Off'], ['low', 'Low (1024)'], ['medium', 'Medium (2048)'], ['high', 'High (4096)']]],
            ['soft', 'Soft shadow edges', 'check'],
            ['lights', 'Lamp lights', 'select', [['off', 'Off (fastest)'], ['on', 'Every other lamp'], ['all', 'All lamps']]],
            ['reflect', 'Reflections', 'select', [['off', 'Off (fastest)'], ['low', 'Subtle'], ['high', 'Full']]],
            ['ao', 'Ambient shading', 'check'],
            ['aniso', 'Texture filtering', 'select', [[1, 'Basic'], [4, '4x'], [8, '8x'], [16, '16x']]],
            ['particles', 'Particles', 'select', [['low', 'Fewer'], ['high', 'All']]],
            ['fireLights', 'Fire lights up the room', 'check'],
            ['aa', 'Anti-aliasing (after reload)', 'check']
        ]],
        ['Controls', [
            ['sens', 'Mouse sensitivity', 'range', 0.2, 3, 0.05],
            ['invertY', 'Invert mouse Y', 'check'],
            ['fov', 'Field of view', 'range', 60, 100, 1],
            ['bob', 'Head bob', 'check']
        ]],
        ['Audio', [
            ['vol', 'Sound effects', 'range', 0, 1, 0.05],
            ['musicSrc', 'Music', 'select', [['builtin', 'Built-in tunes'], ['mine', 'My music (the music folder)'], ['off', 'Off']]],
            ['music', 'Built-in music volume', 'range', 0, 1, 0.05],
            ['myMusic', 'My music volume', 'range', 0, 1, 0.05],
            ['musicBtns', '', 'buttons', [['musicNext', '⏭ Next song'], ['musicReload', '🔄 Look for new songs']]],
            ['musicNote', '', 'note']
        ]],
        ['Gameplay', [
            ['tutorial', 'Tutorial for new chefs', 'check'],
            ['tutBtns', '', 'buttons', [['tutRestart', '🎓 Play the tutorial again']]]
        ]]
    ];
    const GFX_KEYS = CF.GFX_KEYS;
    const fmtSet = (k, v) => k === 'fov' ? Math.round(v) + '°' : k === 'sens' ? (+v).toFixed(2) : Math.round(v * 100) + '%';
    function buildSettings() {
        const body = $('#settings-body');
        body.innerHTML = SET_UI.map(([title, rows]) => `<details class="set-group" open><summary class="set-head">${title}</summary>` + rows.map(r => {
            const [k, label, kind] = r;
            if (kind === 'range') return `<label class="set-row"><span>${label}</span><input type="range" min="${r[3]}" max="${r[4]}" step="${r[5]}" data-set="${k}"><output data-out="${k}"></output></label>`;
            if (kind === 'select') return `<label class="set-row sel"><span>${label}</span><select data-set="${k}">${r[3].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
            if (kind === 'buttons') return `<div class="set-row btns">${r[3].map(([a, t]) => `<button class="btn small" data-act="${a}">${t}</button>`).join('')}</div>`;
            if (kind === 'note') return `<p class="set-info" id="set-${k}"></p>`;
            return `<label class="set-row check"><span>${label}</span><input type="checkbox" data-set="${k}"></label>`;
        }).join('') + '</details>').join('') + '<p class="note set-note">Low = fastest · High = soft shadows and lamp light · Ultra = sharpest shadows and every lamp. Changing an advanced option switches the preset to Custom. Anti-aliasing changes after you reload the page.</p>';
        body.addEventListener('click', e => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const a = b.dataset.act;
            if (a === 'musicNext') { if (CF.MyMusic.playing()) CF.MyMusic.skip(); else U.toast(CF.settings.musicSrc === 'mine' ? 'No songs to skip yet: add some to the music folder.' : 'Pick "My music" first.', 'info'); }
            else if (a === 'musicReload') CF.MyMusic.reload().then(() => U.toast(CF.MyMusic.status, CF.MyMusic.ready() ? 'good' : 'info'));
            else if (a === 'tutRestart') {
                CF.settings.tutorial = true; CF.saveSettings(); syncSettings();
                CF.Goals.restartTutorial();
                U.toast(CF.Game.mode === 'play' && CF.Sync.isHost ? '🎓 The tutorial starts again now.' : '🎓 The tutorial plays again on your next day in the kitchen.', 'good');
            }
            U.refreshMusic();
        });
        const onSet = e => {
            const el = e.target, k = el.dataset.set;
            if (!k) return;
            const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? (el.value !== '' && !isNaN(+el.value) ? +el.value : el.value) : +el.value;
            if (CF.settings[k] === v) return;
            CF.settings[k] = v;
            if (k === 'gfx' && CF.GFX_PRESETS[v]) Object.assign(CF.settings, CF.GFX_PRESETS[v]);
            else if (GFX_KEYS.includes(k)) CF.settings.gfx = 'custom';
            applySetting(k, v);
            CF.saveSettings();
            syncSettings();
        };
        body.addEventListener('input', onSet);
        body.addEventListener('change', onSet);
    }
    function syncSettings() {
        const body = $('#settings-body');
        for (const el of body.querySelectorAll('[data-set]')) {
            const k = el.dataset.set;
            if (el.type === 'checkbox') el.checked = CF.settings[k] !== false && !!CF.settings[k]; else el.value = CF.settings[k];
        }
        for (const o of body.querySelectorAll('[data-out]')) o.textContent = fmtSet(o.dataset.out, CF.settings[o.dataset.out]);
        U.refreshMusic();
    }
    U.openSettings = () => { syncSettings(); show('#settings', true); };
    // the line under the music settings: how many songs, what plays now
    U.refreshMusic = () => {
        const el = $('#set-musicNote');
        if (!el) return;
        const M = CF.MyMusic, src = CF.settings.musicSrc;
        let t = M.status;
        if (src === 'mine' && M.playing() && M.now) t += ' · ▶ ' + M.now;
        else if (src === 'mine' && !M.ready() && M.loaded) t += ' Until then the built-in tunes play.';
        el.textContent = t;
    };
    function applySetting(k, v) {
        if (k === 'fov') { CF.World.camera.fov = v; CF.World.camera.updateProjectionMatrix(); }
        else if (k === 'vol') CF.Audio.setVolume(v);
        else if (k === 'fps') show('#fps', !!v);
        else if (k === 'musicSrc') CF.Music.refresh();
        else if (k === 'myMusic') CF.MyMusic.setVolume(v);
        else if (k === 'gfx' || GFX_KEYS.includes(k) || k === 'bright' || k === 'scale') CF.World.applyGraphics();
    }

    U.confirm = (text, ok, cb) => {
        $('#confirm-text').textContent = text;
        $('#confirm-ok').textContent = ok || 'OK';
        confirmCb = cb;
        show('#confirm', true);
    };

    // ---------- wiring ----------
    function doJoin() {
        const code = $('#join-code').value.trim();
        if (code.length !== 5) { U.joinStatus('The room code has 5 characters.'); return; }
        U.joinStatus('Connecting…');
        CF.Game.join(code);
    }
    U.init = () => {
        const on = (sel, fn) => $(sel).addEventListener('click', fn);
        const nm = $('#chef-name');
        nm.value = CF.settings.name;
        nm.addEventListener('input', () => { CF.settings.name = nm.value.replace(/[<>]/g, '').slice(0, 14); CF.saveSettings(); CF.Game.refreshMenuChef(); });
        nm.addEventListener('keydown', e => e.stopPropagation());
        document.addEventListener('click', e => {
            const hb = e.target.closest('[data-hat]');
            if (hb) { CF.settings.color = +hb.dataset.hat; CF.saveSettings(); refreshMenu(); CF.Game.refreshMenuChef(); CF.Audio.play('click'); return; }
            const c = e.target.closest('[data-close]');
            if (c) { show('#' + c.dataset.close, false); CF.Audio.play('click'); backToGame(); return; }
            if (e.target.closest('button')) CF.Audio.play('click');
        });
        // menu
        on('#btn-continue', () => CF.Game.startSolo(true));
        on('#btn-solo', () => {
            if (CF.Orders.hasSave()) U.confirm('Start a brand new restaurant? Your saved one gets replaced when this first day ends.', 'New restaurant', () => CF.Game.startSolo(false));
            else CF.Game.startSolo(false);
        });
        on('#btn-host', () => CF.Game.hostLobby());
        on('#btn-join', () => { show('#join', true); U.joinStatus(''); setTimeout(() => $('#join-code').focus(), 0); });
        on('#btn-skills', () => U.openSkills());
        on('#btn-settings', () => U.openSettings());
        on('#btn-howto', () => show('#howto', true));
        // join
        const jc = $('#join-code');
        jc.addEventListener('input', () => { jc.value = jc.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
        jc.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') doJoin(); });
        on('#btn-join-go', doJoin);
        // lobby
        on('#btn-copy', () => {
            const code = CF.Sync.code || '';
            try { navigator.clipboard.writeText(code).then(() => U.toast('Room code copied!', 'good'), () => U.toast('Room code: ' + code, 'info')); }
            catch (e) { U.toast('Room code: ' + code, 'info'); }
        });
        on('#btn-start', () => CF.Game.hostStart($('#lobby-save').checked && !!CF.Orders.load()));
        on('#btn-lobby-leave', () => CF.Game.quit());
        // pause
        on('#btn-resume', () => CF.Player.lock());
        $('#pause').addEventListener('click', e => { if (e.target.id === 'pause') CF.Player.lock(); });
        on('#btn-p-settings', () => U.openSettings());
        on('#btn-p-howto', () => show('#howto', true));
        on('#btn-p-quit', () => U.confirm('Leave the kitchen and go back to the main menu?' + (CF.Sync.mode === 'host' ? ' This closes the kitchen for everyone.' : ''), 'Quit', () => CF.Game.quit()));
        // confirm
        on('#confirm-ok', () => { show('#confirm', false); const cb = confirmCb; confirmCb = null; if (cb) cb(); else backToGame(); });
        on('#confirm-cancel', () => { show('#confirm', false); confirmCb = null; backToGame(); });
        // panels
        $('#shop').addEventListener('click', shopClick);
        $('#summary').addEventListener('click', summaryClick);
        $('#skills').addEventListener('click', skillsClick);
        buildSettings();
        // Esc closes the top panel (in the game, Esc first frees the mouse and opens the pause screen)
        addEventListener('keydown', e => {
            if (e.key !== 'Escape' || U.typing) return;
            for (const id of ['confirm', 'settings', 'howto', 'skills', 'join']) {
                if (isOpen(id)) { show('#' + id, false); if (id === 'confirm') confirmCb = null; backToGame(); return; }
            }
            if (isOpen('book')) show('#book', false);
        });
        // chat
        const ci = $('#chat-input');
        ci.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = ci.value.trim();
                if (text) CF.Sync.act({ t: 'chat', text });
                closeChat();
            } else if (e.key === 'Escape') closeChat();
        });
        ci.addEventListener('blur', () => { if (U.typing) closeChat(); });
        refreshMenu();
    };
    U.refreshMenu = refreshMenu;

    return U;
})();
