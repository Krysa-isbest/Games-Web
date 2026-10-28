'use strict';
// Rebindable keyboard controls (PC). Stored inside the settings.
PB.Keys = (() => {
    const K = { waiting: null };
    K.DEFAULTS = {
        forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', use: 'KeyE', alt: 'KeyF', rotate: 'KeyR',
        putback: 'KeyQ', throw: 'KeyT', help: 'KeyH', music: 'KeyM', ping: 'KeyG', crouch: 'ControlLeft'
    };
    K.NAMES = {
        forward: 'Walk forward', back: 'Walk back', left: 'Walk left', right: 'Walk right', use: 'Use / interact',
        alt: 'Secondary action / take one', rotate: 'Rotate item', putback: 'Put item back', throw: 'Throw / drop item',
        help: 'Help', music: 'Music on/off', ping: 'Ping (co-op)', crouch: 'Crouch'
    };
    // letters used in on-screen hints -> the action they stand for
    const HINT = { E: 'use', F: 'alt', R: 'rotate', Q: 'putback', T: 'throw', H: 'help', M: 'music', G: 'ping' };
    K.get = a => (PB.Settings.v.keys && PB.Settings.v.keys[a]) || K.DEFAULTS[a];
    K.action = code => Object.keys(K.DEFAULTS).find(a => K.get(a) === code) || null;
    K.label = code => code.replace('ControlLeft', 'L-Ctrl').replace('ControlRight', 'R-Ctrl').replace('ShiftLeft', 'L-Shift').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '↑').replace('Space', 'Space').replace(/^Numpad/, 'Num ');
    K.hint = letter => HINT[letter] ? K.label(K.get(HINT[letter])) : letter;
    K.set = (action, code) => {
        const keys = Object.assign({}, PB.Settings.v.keys || {});
        const other = K.action(code);
        if (other && other !== action) keys[other] = K.get(action); // swap so nothing is left unbound
        keys[action] = code;
        PB.Settings.v.keys = keys;
        PB.Settings.save();
        PB.UI.updateKeysHint();
    };
    K.reset = () => { PB.Settings.v.keys = {}; PB.Settings.save(); PB.UI.updateKeysHint(); };
    return K;
})();

// Secret admin panel (Settings → Admin, code 1234): spawn any item into a player's cell.
PB.Admin = (() => {
    const A = { unlocked: false, target: 'me' };
    A.unlock = code => {
        if (code === '1234') { A.unlocked = true; PB.Audio.play('success'); PB.UI.toast('🔓 Admin panel unlocked.', 'good'); }
        else { PB.Audio.play('bad'); PB.UI.toast('Wrong code.', 'bad'); }
    };
    // the cell of the chosen player: you, or one of your co-op friends (target = their slot)
    A.targetCell = () => {
        if (A.target === 'me' || !PB.Coop.active || !PB.Coop.players[A.target]) return PB.Player.cell;
        return PB.Coop.cellOf(+A.target) || PB.World.CELLS[+A.target];
    };
    A.spawn = type => {
        if (!A.unlocked || !PB.state || !PB.ITEMS[type]) return;
        const cell = A.targetCell();
        if (PB.Coop.isGuest()) PB.Coop.send({ t: 'act', a: 'spawn', type, cell });
        else if (!PB.Items.spawn(type, [cell + 'floor', cell + 'desk', cell + 'shelf'])) { PB.UI.toast('No room to spawn it.', 'bad'); return; }
        PB.Audio.play('pop');
        PB.UI.toast(`Spawned ${PB.ITEMS[type].icon} ${PB.ITEMS[type].name}`);
    };
    A.html = () => {
        if (!A.unlocked) return `<div class="set-row"><label>Admin code</label><input id="admin-code" type="password" maxlength="8" placeholder="••••" autocomplete="off"><button class="btn small" data-act="adminUnlock">Unlock</button></div>`;
        if (!PB.state) return '<p class="set-desc">Start or continue a game to use the spawn menu.</p>';
        const tabs = [['me', 'Me']].concat(PB.Coop.active ? PB.Coop.otherSlots().map(sl => [String(sl), PB.Coop.nameOf(sl)]) : []);
        return `<p class="set-desc">Spawn menu: items appear on the floor of the target player's cell.</p>
            <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${A.target === k ? 'on' : ''}" data-act="adminTarget" data-arg="${k}">🎯 ${l}</div>`).join('')}</div>
            <div class="spawn-grid">${Object.entries(PB.ITEMS).map(([t, d]) => `<button class="btn small" data-act="adminSpawn" data-arg="${t}">${d.icon} ${d.name}</button>`).join('')}</div>`;
    };
    return A;
})();

// Player settings: mouse sensitivity, graphics quality (Low / Medium / High) and volumes. Saved in the browser.
PB.Settings = (() => {
    const S = { v: { sens: 1, gfx: 'high', music: 0.8, sfx: 1, vr: false, customMusic: false, customVol: 0.7, vrHands: 'modern', crouchMode: 'toggle' } };
    const GFX = {
        low:    { label: 'Low',    desc: 'No shadows, lower resolution. For slow computers.' },
        medium: { label: 'Medium', desc: 'Shadows from the sun only, normal resolution.' },
        high:   { label: 'High',   desc: 'Everything on: sharp soft shadows, lamp shadows, full resolution.' }
    };
    let applied = null;

    S.load = () => {
        try { Object.assign(S.v, JSON.parse(localStorage.getItem('pb_settings') || '{}')); } catch (e) {}
        if (!GFX[S.v.gfx]) S.v.gfx = 'high';
    };
    S.save = () => { try { localStorage.setItem('pb_settings', JSON.stringify(S.v)); } catch (e) {} };

    S.set = (k, val) => {
        S.v[k] = (k === 'gfx' || k === 'vrHands' || k === 'crouchMode') ? val : (k === 'vr' || k === 'customMusic') ? !!val : parseFloat(val);
        S.save();
        S.apply();
    };

    S.apply = () => {
        const W = PB.World, r = W.renderer, g = S.v.gfx;
        r.setPixelRatio(g === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : g === 'medium' ? 1 : 0.7);
        r.setSize(innerWidth, innerHeight);
        if (applied !== g) {
            applied = g;
            const shadows = g !== 'low';
            r.shadowMap.enabled = shadows;
            r.shadowMap.type = g === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
            const lights = [[W.sun, shadows, g === 'high' ? 2048 : 1024], [W.cells[''].lampLight, g === 'high', 512]];
            if (PB.Lunch.sun) lights.push([PB.Lunch.sun, shadows, g === 'high' ? 2048 : 1024]);
            lights.forEach(([l, on, size]) => {
                l.castShadow = on;
                if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
                l.shadow.mapSize.set(size, size);
            });
            // changing shadow settings needs every material recompiled
            if (PB.Lunch.scene) PB.Lunch.applyShadows();
            [W.scene, PB.Lunch.scene].forEach(sc => sc && sc.traverse(o => {
                if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; });
            }));
        }
        PB.Audio.setVolume(S.v.sfx);
        PB.Music.setVolume(S.v.music);
        if (!PB.VR.active) r.xr.enabled = !!S.v.vr;
        PB.UI.updateVRButtons();
    };

    S.open = () => PB.UI.panel('Settings', () => {
        const v = S.v;
        const slider = (k, label, min, max, step, fmt) =>
            `<div class="set-row"><label>${label}</label><input type="range" data-set="${k}" min="${min}" max="${max}" step="${step}" value="${v[k]}"><b class="set-val">${fmt(v[k])}</b></div>`;
        const pct = x => Math.round(x * 100) + '%';
        return `<div class="settings">
            <h3>🖱️ Controls</h3>
            ${slider('sens', 'Mouse sensitivity', 0.2, 3, 0.05, x => x.toFixed(2) + '×')}
            <div class="set-row"><label>Crouch</label>
                <div class="tabs" style="margin:0"><div class="tab ${v.crouchMode !== 'hold' ? 'on' : ''}" data-act="crouchMode" data-arg="toggle">Toggle</div><div class="tab ${v.crouchMode === 'hold' ? 'on' : ''}" data-act="crouchMode" data-arg="hold">Hold</div></div></div>
            <p class="set-desc">Toggle is safer with Ctrl: in a normal browser window Ctrl+W closes the tab, so don't hold Ctrl while pressing W (or rebind crouch to C).</p>
            <h3>⌨️ Keybinds</h3>
            <p class="set-desc">Click a key, then press the new key (Esc cancels). Arrow keys always walk too.</p>
            <div class="keybinds">${Object.keys(PB.Keys.DEFAULTS).map(a =>
                `<div class="set-row"><label>${PB.Keys.NAMES[a]}</label><button class="btn small keybtn ${PB.Keys.waiting === a ? 'wait' : ''}" data-act="bind" data-arg="${a}">${PB.Keys.waiting === a ? 'Press a key…' : PB.Keys.label(PB.Keys.get(a))}</button></div>`).join('')}</div>
            <div><button class="btn small" data-act="bindReset">Reset keys to default</button></div>
            <h3>🖥️ Graphics</h3>
            <div class="tabs">${Object.entries(GFX).map(([k, o]) => `<div class="tab ${v.gfx === k ? 'on' : ''}" data-act="gfx" data-arg="${k}">${o.label}</div>`).join('')}</div>
            <p class="set-desc">${GFX[v.gfx].desc}</p>
            <h3>🥽 VR</h3>
            <div class="tabs"><div class="tab ${v.vr ? 'on' : ''}" data-act="vr" data-arg="1">ON</div><div class="tab ${v.vr ? '' : 'on'}" data-act="vr" data-arg="">OFF</div></div>
            <p class="set-desc">${PB.VR.supported
                ? 'A VR headset is available. With VR ON, an <b>Enter VR</b> button appears in the main menu and the pause menu.'
                : 'No VR headset detected in this browser. Open the game in your headset\'s browser (e.g. Meta Quest Browser) or a PC browser with SteamVR running.'}</p>
            <div class="set-row"><label>VR hands</label>
                <div class="tabs" style="margin:0"><div class="tab ${v.vrHands !== 'legacy' ? 'on' : ''}" data-act="vrHands" data-arg="modern">Modern</div><div class="tab ${v.vrHands === 'legacy' ? 'on' : ''}" data-act="vrHands" data-arg="legacy">Legacy</div></div>
            </div>
            <p class="set-desc">Modern: round hands with fingers that curl when you press grip and trigger. Legacy: the old simple blocky hands.</p>
            <h3>🔊 Sound</h3>
            ${slider('music', 'Music volume', 0, 1, 0.05, pct)}
            <div class="set-row"><label>Custom music</label>
                <div class="tabs" style="margin:0"><div class="tab ${v.customMusic ? 'on' : ''}" data-act="cmusic" data-arg="1">ON</div><div class="tab ${v.customMusic ? '' : 'on'}" data-act="cmusic" data-arg="">OFF</div></div>
            </div>
            <p class="set-desc">ON plays the songs from the <b>Music</b> folder (shuffled) instead of the built-in music.</p>
            ${slider('customVol', 'Custom music volume', 0, 1, 0.05, pct)}
            ${slider('sfx', 'Sound effects', 0, 1, 0.05, pct)}
            <h3>🔐 Admin</h3>
            ${PB.Admin.html()}
            <div class="center"><button class="btn small orange" data-act="ok">Done</button></div>
        </div>`;
    });

    S.fmt = (k, val) => k === 'sens' ? (+val).toFixed(2) + '×' : Math.round(val * 100) + '%';
    return S;
})();
