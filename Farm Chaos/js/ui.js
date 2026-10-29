// ui.js — HUD, menus, shop, settings, co-op invite panels
'use strict';

const $ = id => document.getElementById(id);
const CROP_ICON = ['🌾', '🥬', '🥕', '🥔', '🍅', '🌽', '🥬', '🍓', '🫑', '🍆', '🌻', '🫐', '🎃', '🥦', '🍉', '🍍', '🐉', '🌶️', '✨', '🍈'];
const FREQS = [[0, 'Off (peaceful)'], [0.4, 'Calm'], [1, 'Normal (chaotic)'], [1.7, 'Very chaotic'], [3, 'INSANE']];
const APOCS = [['off', 'Never'], ['rare', 'Very rare'], ['normal', 'Rare'], ['often', 'Often']];

const UI = {
  modal: null, dirty: true, t: 0, shopTab: 'Seeds', setTab: 'Graphics', logs: [], fpsV: 0,

  // render a small picture of every ripe crop model for the shop and hotbar
  makeIcons() {
    this.icons = [];
    try {
      const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.setSize(96, 96); r.setPixelRatio(1);
      const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x806040, 0.9)); const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(2, 4, 3); sc.add(dl);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      CROPS.forEach((c, i) => {
        const m = new THREE.Mesh(M.cropGeo(i, 3), M.mat); sc.add(m);
        m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox, ctr = bb.getCenter(new V3()), sz = bb.getSize(new V3()).length();
        cam.position.set(ctr.x + sz * 0.7, ctr.y + sz * 0.6, ctr.z + sz * 1.05); cam.lookAt(ctr);
        r.render(sc, cam); this.icons[i] = r.domElement.toDataURL();
        sc.remove(m); m.geometry.dispose();
      });
      r.dispose(); if (r.forceContextLoss) r.forceContextLoss();
    } catch (e) { }
  },
  icon(i, s = 30) { return this.icons && this.icons[i] ? `<img src="${this.icons[i]}" width="${s}" height="${s}" alt="">` : CROP_ICON[i]; },

  init() {
    this.makeIcons();
    this.renderMenu();
    $('game').addEventListener('click', () => { if (G.started && !this.modal && !K.typing) this.lock(); });
    $('clickToPlay').addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && G.started && !this.modal && !K.typing && !(G.final && G.final.phase === 'cutscene')) this.openPause();
      this.updateClickToPlay();
    });
    $('chatIn').addEventListener('keydown', e => {
      if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) Game.request({ k: 'chat', text: t }); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
      e.stopPropagation();
    });
    addEventListener('keydown', e => {
      if (!G.started || K.rebinding || K.typing) return;
      if (e.code === S.d.keys.chat && K.locked && G.mode !== 'solo') { e.preventDefault(); this.openChat(); }
      if (e.code === 'Escape' && this.modal && this.modal !== 'stats') { this.closeModal(); }
    });
  },
  esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  lock() { try { const p = $('game').requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (e) { } AU.init(); },
  updateClickToPlay() { $('clickToPlay').classList.toggle('hidden', !G.started || K.locked || !!this.modal || K.typing || !!(G.final && G.final.phase === 'cutscene') || !$('stats').classList.contains('hidden')); },

  // ---------------- main menu ----------------
  renderMenu() {
    const sw = PLAYER_COLORS.map((c, i) => `<button class="sw ${i === S.d.color ? 'on' : ''}" data-c="${i}" style="background:#${new THREE.Color(c).getHexString()}"></button>`).join('');
    $('menuBox').innerHTML = `
      <h1 class="logo">CHAOS<span>FARM</span></h1>
      <p class="tag">Grow crops. Survive tornadoes, nukes & aliens. With friends.</p>
      <label class="fld">Your name <input id="mName" maxlength="16" value="${this.esc(S.d.name)}"></label>
      <div class="fld">Color <div class="sws">${sw}</div></div>
      <div class="mbtns">
        <button class="big" id="bSolo">🌱 Play solo</button>
        <button class="big" id="bHost">🏠 Host co-op</button>
        <button class="big" id="bJoin">🤝 Join co-op</button>
        <button id="bSet">⚙️ Settings</button>
      </div>
      <p class="tiny">WASD move · Mouse look · Click use tool · E interact · 1–5 tools (4 can, 5 bucket) · F carry animal · R next seed · Q ping · T chat · Tab players</p>`;
    $('mName').oninput = e => { S.d.name = e.target.value.trim() || 'Farmer'; S.save(); };
    document.querySelectorAll('.sw').forEach(b => b.onclick = () => { S.d.color = +b.dataset.c; S.save(); this.renderMenu(); });
    $('bSolo').onclick = () => this.farmSetup('solo');
    $('bHost').onclick = () => this.farmSetup('host');
    $('bJoin').onclick = () => this.joinPanel();
    $('bSet').onclick = () => this.openSettings();
  },
  hostSettingsHtml() {
    return `<div class="hs">
      <label>Event frequency <select id="hFreq">${FREQS.map(([v, l]) => `<option value="${v}" ${v === S.d.host.freq ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Apocalypse (black hole / supernova) <select id="hApoc">${APOCS.map(([v, l]) => `<option value="${v}" ${v === S.d.host.apoc ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="hCalm" ${S.d.host.calmDay1 ? 'checked' : ''}> First day is calm (no events)</label></div>`;
  },
  bindHostSettings() {
    $('hFreq').onchange = e => { S.d.host.freq = +e.target.value; S.save(); };
    $('hApoc').onchange = e => { S.d.host.apoc = e.target.value; S.save(); };
    $('hCalm').onchange = e => { S.d.host.calmDay1 = e.target.checked; S.save(); };
  },
  farmSetup(mode) {
    const has = Game.hasSave();
    this.showModal('setup', `
      <h2>${mode === 'solo' ? '🌱 Solo farm' : '🏠 Host a co-op farm'}</h2>
      ${has ? `<button class="big" id="bCont">▶ Continue farm <small>${Game.saveInfo()}</small></button>` : ''}
      <button class="big" id="bNew">✨ New farm${has ? ' <small>(overwrites your save)</small>' : ''}</button>
      <h3>Chaos settings</h3>${this.hostSettingsHtml()}
      ${mode === 'host' ? '<p class="note">After the farm loads, open the menu (Esc) → <b>Invite friends</b> to get your code. Max 4 players.</p>' : ''}
      <button id="bBack">Back</button>`);
    this.bindHostSettings();
    const go = load => { this.closeModal(); Game.start(mode, load); if (mode === 'host') this.startHosting(); };
    if (has) $('bCont').onclick = () => go(true);
    $('bNew').onclick = () => { if (has && !confirm('Start a new farm? Your current save will be overwritten.')) return; go(false); };
    $('bBack').onclick = () => this.closeModal();
  },
  startHosting() {
    this.hostCode = null; this.hostErr = null;
    NET.hostOnline((code, err) => { this.hostCode = code; this.hostErr = err; if (code) this.log(`🔑 Your invite code: <b>${code}</b> (Esc → Invite friends)`); if (this.modal === 'invite') this.openInvite(); });
  },
  joinPanel() {
    this.showModal('join', `
      <h2>🤝 Join a friend</h2>
      <p class="note">Paste the code your friend sent you. A short <b>FARM-XXXXX</b> code connects online. A long <b>FCD-…</b> code is a direct (Tailscale / LAN) invite.</p>
      <textarea id="jCode" rows="3" placeholder="FARM-ABCDE or FCD-..."></textarea>
      <button class="big" id="bJoinGo">Join</button>
      <div id="jStatus" class="note"></div>
      <button id="bBack">Back</button>`);
    $('bBack').onclick = () => { NET.shutdown(); this.closeModal(); };
    $('bJoinGo').onclick = async () => {
      const code = $('jCode').value.trim(); if (!code) return;
      const st = $('jStatus');
      AU.init();
      if (NET.isDirectCode(code)) {
        st.innerHTML = 'Creating your reply code…';
        try {
          const reply = await NET.joinDirect(code, () => { this.closeModal(); Game.startClient(); });
          st.innerHTML = `Send this <b>reply code</b> back to the host, then wait:<textarea rows="4" readonly id="jReply">${reply}</textarea><button id="bCopyR">📋 Copy reply code</button>`;
          $('bCopyR').onclick = () => this.copy(reply);
        } catch (e) { st.textContent = 'That code did not work: ' + e.message; }
      } else {
        st.textContent = 'Connecting…';
        NET.joinOnline(code, (ok, err) => { if (ok) { st.textContent = 'Connected! Loading the farm…'; this.closeModal(); Game.startClient(); } else st.textContent = err; });
      }
    };
  },
  copy(t) { try { navigator.clipboard.writeText(t); this.toast('Copied!'); } catch (e) { } },

  openInvite() {
    const code = this.hostCode;
    this.showModal('invite', `
      <h2>📨 Invite friends</h2>
      <h3>Online code (easiest)</h3>
      ${code ? `<div class="code">${code}</div><button id="bCopyC">📋 Copy code</button><p class="note">Friends click <b>Join co-op</b> and paste this. Works over the internet.</p>`
        : `<p class="note">${this.hostErr ? this.esc(this.hostErr) : 'Getting a code…'}</p>`}
      <h3>Direct code (Tailscale / LAN, no server)</h3>
      <p class="note">One invite per friend. Optional: type your Tailscale IP (run <b>tailscale ip -4</b>) so friends on your tailnet connect directly.</p>
      <input id="tsIp" placeholder="100.x.y.z (optional)" value="${this.esc(this.tsIp || '')}">
      <button id="bDirect">Create direct invite</button>
      <div id="dirBox"></div>
      <h3>Players (${Object.keys(G.players).length}/${MAX_PLAYERS})</h3>
      <div class="plist">${Object.values(G.players).map(p => `<span style="color:#${new THREE.Color(p.color).getHexString()}">● ${this.esc(p.name)}</span>`).join('')}</div>
      <button id="bClose">Close</button>`);
    if (code) $('bCopyC').onclick = () => this.copy(code);
    $('bClose').onclick = () => this.closeModal(true);
    $('bDirect').onclick = async () => {
      this.tsIp = $('tsIp').value.trim();
      const box = $('dirBox'); box.innerHTML = '<p class="note">Creating invite…</p>';
      try {
        const inv = await NET.directInvite(this.tsIp);
        box.innerHTML = `<p class="note">1. Send this to your friend:</p><textarea rows="3" readonly>${inv}</textarea><button id="bCopyD">📋 Copy invite</button>
          <p class="note">2. Paste their reply code here:</p><textarea id="dAns" rows="3" placeholder="FCA-..."></textarea><button id="bAns">Connect</button><div id="dSt" class="note"></div>`;
        $('bCopyD').onclick = () => this.copy(inv);
        $('bAns').onclick = async () => { try { await NET.acceptAnswer($('dAns').value); $('dSt').textContent = 'Connecting… they will appear in the player list.'; } catch (e) { $('dSt').textContent = 'Error: ' + e.message; } };
      } catch (e) { box.innerHTML = '<p class="note">Error: ' + this.esc(e.message) + '</p>'; }
    };
  },

  // ---------------- pause ----------------
  openPause() {
    if (G.mode === 'solo') G.paused = true;
    const host = G.isHost;
    this.showModal('pause', `
      <h2>${G.mode === 'solo' ? '⏸ Paused' : '☰ Menu'}</h2>
      <button class="big" id="pRes">▶ Resume</button>
      ${G.mode === 'host' ? '<button id="pInv">📨 Invite friends</button>' : ''}
      <button id="pSet">⚙️ Settings</button>
      ${host ? `<h3>Chaos settings</h3>${this.hostSettingsHtml()}` : ''}
      ${host ? '<div class="row"><button id="pSave">💾 Save now</button><button id="pExp">⬇ Export save</button><button id="pImp">⬆ Import save</button></div>' : ''}
      <button id="pQuit">🚪 Quit to main menu</button>
      <p class="tiny">Day ${G.day()} · ${G.mode === 'client' ? 'Connected to host' : G.mode === 'host' ? 'Hosting' : 'Solo'}${G.endless ? ' · Endless mode' : ''}</p>`);
    $('pRes').onclick = () => this.closeModal(true);
    if ($('pInv')) $('pInv').onclick = () => this.openInvite();
    $('pSet').onclick = () => this.openSettings();
    if (host) {
      this.bindHostSettings();
      $('pSave').onclick = () => { Game.save(); this.toast('Saved!'); };
      $('pExp').onclick = () => Game.exportSave();
      $('pImp').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = () => { const f = i.files[0]; if (!f) return; f.text().then(t => { try { const s = JSON.parse(t); localStorage.setItem('farmchaos_save', JSON.stringify(s)); Game.load(s); Game.sendState(); this.toast('Save imported!'); this.closeModal(); } catch (e) { this.toast('That file is not a Chaos Farm save'); } }); }; i.click(); };
    }
    $('pQuit').onclick = () => { if (G.isHost) Game.save(); NET.shutdown(); location.reload(); };
  },

  // ---------------- settings ----------------
  openSettings() {
    const back = G.started ? 'pause' : null;
    const tabs = ['Graphics', 'Controls', 'Keybinds', 'Audio', 'Accessibility'];
    this._fmt = {};
    const rng = (k, label, min, max, step, fmt) => (this._fmt[k] = fmt, '') + `<label class="rng">${label} <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S.d[k]}"><span>${fmt(S.d[k])}</span></label>`;
    const sel = (k, label, opts) => `<label>${label} <select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(S.d[k]) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    const chk = (k, label) => `<label class="chk"><input type="checkbox" data-k="${k}" ${S.d[k] ? 'checked' : ''}> ${label}</label>`;
    const pct = v => Math.round(v * 100) + '%';
    let body = '';
    if (this.setTab === 'Graphics') body = sel('quality', 'Graphics quality', [['low', 'Low (no shadows)'], ['medium', 'Medium'], ['high', 'High']]) + rng('renderScale', 'Render scale', 0.5, 1, 0.05, pct) + rng('viewDist', 'View distance', 120, 500, 10, v => v + ' m') + rng('particles', 'Particle count', 0.25, 2, 0.25, pct) + rng('fov', 'Field of view', 60, 110, 1, v => v + '°') + chk('showFps', 'Show FPS') + '<p class="note">Quality & particle pool size fully apply after reloading the page.</p>';
    else if (this.setTab === 'Controls') body = rng('sens', 'Mouse sensitivity', 0.2, 3, 0.05, v => (+v).toFixed(2)) + chk('invertY', 'Invert mouse Y') + sel('sprintMode', 'Sprint', [['hold', 'Hold'], ['toggle', 'Toggle']]) + sel('crouchMode', 'Crouch', [['hold', 'Hold'], ['toggle', 'Toggle']]) + '<p class="note">Crouching makes the wind push you 70% less.</p>';
    else if (this.setTab === 'Keybinds') body = '<div id="kb"></div><button id="kbReset">Reset to defaults</button>';
    else if (this.setTab === 'Audio') body = rng('vol', 'Master volume', 0, 1, 0.05, pct) + rng('sfxVol', 'Effects', 0, 1.5, 0.05, pct) + rng('warnVol', 'Event warnings & sirens', 0, 1.5, 0.05, pct) + rng('ambVol', 'Ambience', 0, 1.5, 0.05, pct);
    else body = rng('shake', 'Screen shake', 0, 1, 0.05, pct) + chk('reduceFlash', 'Reduce flashing (nukes, lightning, supernova)') + chk('camTilt', 'Camera tilt during events');
    this.showModal('settings', `<h2>⚙️ Settings</h2><div class="tabs">${tabs.map(t => `<button class="${t === this.setTab ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div><div class="setbody">${body}</div><button id="sBack">Back</button>`);
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { this.setTab = b.dataset.t; this.openSettings(); });
    document.querySelectorAll('.setbody [data-k]').forEach(el => {
      const k = el.dataset.k;
      el.oninput = el.onchange = () => {
        S.d[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
        if (el.type === 'range') el.nextElementSibling.textContent = this._fmt[k](S.d[k]);
        S.save(); this.applySettings();
      };
    });
    if (this.setTab === 'Keybinds') { this.renderKeybinds(); $('kbReset').onclick = () => { S.d.keys = Object.assign({}, DEFAULT_KEYS); S.save(); this.renderKeybinds(); }; }
    $('sBack').onclick = () => back ? this.openPause() : this.closeModal();
  },
  applySettings() { W.applyGraphics(); AU.applyVolumes(); W.scene.fog.far = S.d.viewDist; },
  renderKeybinds() {
    const el = $('kb'); if (!el) return;
    const used = {}; for (const a in S.d.keys) used[S.d.keys[a]] = (used[S.d.keys[a]] || 0) + 1;
    el.innerHTML = Object.keys(DEFAULT_KEYS).map(a => `<div class="kbr"><span>${KEY_LABELS[a]}</span><button data-a="${a}" class="${used[S.d.keys[a]] > 1 ? 'clash' : ''} ${K.rebinding === a ? 'wait' : ''}">${K.rebinding === a ? 'press a key…' : K.keyName(S.d.keys[a])}</button></div>`).join('') + (Object.values(used).some(n => n > 1) ? '<p class="warnTxt">⚠ Red keys are bound to more than one action.</p>' : '');
    el.querySelectorAll('button').forEach(b => b.onclick = () => { K.rebinding = b.dataset.a; this.renderKeybinds(); });
  },

  // ---------------- shop ----------------
  openShop() { this.showModal('shop', '<div id="shopBox"></div>'); this.renderShop(); },
  renderShop() {
    const box = $('shopBox'); if (!box) return;
    const tabs = ['Seeds', 'Fields', 'Animals', 'Upgrades', 'Bank'], day = G.day(), m = G.money;
    const upCard = u => {
      const own = G.upgrades[u.id], needPlot = u.plot !== undefined && !G.plots[u.plot], needUp = u.needs && !G.upgrades[u.needs];
      return `<div class="card ${own ? 'owned' : ''} ${u.soon ? 'locked' : ''}"><b>${u.name}</b><small>${u.desc}</small>
        ${own ? '<small>✅ Owned</small>' : u.soon ? '<small>🚜 Coming soon</small>' : needPlot ? '<small>🔒 Buy the field first</small>' : needUp ? `<small>🔒 Needs ${UPGRADES.find(q => q.id === u.needs).name}</small>` : `<button data-buy="upgrade" data-id="${u.id}" ${m < u.cost ? 'disabled' : ''}>Buy ${U.money(u.cost)}</button>`}</div>`;
    };
    let body = '';
    if (this.shopTab === 'Seeds') {
      body = '<div class="grid">' + CROPS.map((c, i) => {
        const lock = c.day > day && !G.endless;
        return `<div class="card ${lock ? 'locked' : ''}"><div class="ic">${this.icon(i, 52)}</div><b>${c.name}</b>
          <small>Seed ${U.money(c.cost)} · sells ${U.money(c.sell)} · ${Math.round(c.grow / 60 * 10) / 10} min</small>
          ${c.chaos ? '<small class="warnTxt">Attracts more chaos!</small>' : c.moon ? '<small>Grows 3× faster in low gravity</small>' : ''}
          <small>You have <b>${G.seeds[i]}</b></small>
          ${lock ? `<small>🔒 Unlocks on day ${c.day}</small>` : `<div class="row">${[1, 10, 50].map(n => `<button data-buy="seed" data-id="${i}" data-n="${n}" ${m < c.cost * n ? 'disabled' : ''}>×${n}</button>`).join('')}</div>`}</div>`;
      }).join('') + '</div>';
    } else if (this.shopTab === 'Fields') {
      body = '<div class="grid">' + PLOTS.map((p, i) => `<div class="card ${G.plots[i] ? 'owned' : ''}"><div class="ic">🌾</div><b>Field ${i + 1}</b><small>8×8 tiles${G.has('gh' + i) ? ' · greenhouse' : ''}</small>
        ${G.plots[i] ? '<small>✅ Owned</small>' : `<button data-buy="plot" data-id="${i}" ${m < p.cost ? 'disabled' : ''}>Buy ${U.money(p.cost)}</button>`}</div>`).join('') + '</div>';
    } else if (this.shopTab === 'Animals') {
      body = '<h3>Animals</h3><div class="grid">' + Object.entries(ANIMAL_SHOP).map(([k, s]) => {
        const n = AN.count(k), cap = AN.capacity(k), full = !AN.freeZone(k);
        return `<div class="card"><div class="ic">${s.icon}</div><b>${s.name}</b><small>${s.desc}</small><small>You have <b>${n}</b> · room for ${cap}</small>
          ${full ? '<small>🔒 Pens are full — buy a pen below</small>' : `<button data-buy="animal" data-id="${k}" ${m < s.cost ? 'disabled' : ''}>Buy ${U.money(s.cost)}</button>`}</div>`;
      }).join('') + '</div><p class="note">New animals are dropped into a pen with room. Carry animals with F and put them down inside another pen to move them there.</p>'
        + '<h3>Pens & animal upgrades</h3><div class="grid">' + UPGRADES.filter(u => u.cat === 'Animals').map(upCard).join('') + '</div>';
    } else if (this.shopTab === 'Upgrades') {
      const cats = [...new Set(UPGRADES.map(u => u.cat))].filter(c => c !== 'Animals');
      body = cats.map(cat => `<h3>${cat}</h3><div class="grid">` + UPGRADES.filter(u => u.cat === cat).map(upCard).join('') + '</div>').join('');
    } else {
      const broken = W.brokenCount(), prem = 200 + 50 * day;
      body = `<div class="bank">
        <div class="big2">Debt: <b>${U.money(G.debt)}</b></div>
        <div class="bar"><div style="width:${Math.max(0, 100 - G.debt / DEBT_START * 100)}%"></div></div>
        <p class="note">Pay off the whole debt to finish the game. Something big happens when you do…</p>
        <div class="row">${[1000, 10000].map(a => `<button data-pay="${a}" ${m < Math.min(a, G.debt) || G.debt <= 0 ? 'disabled' : ''}>Pay ${U.money(a)}</button>`).join('')}<button data-pay="${Math.min(Math.max(0, m), G.debt)}" ${m <= 0 || G.debt <= 0 ? 'disabled' : ''}>Pay ${U.money(Math.min(Math.max(0, m), G.debt))}</button></div>
        <h3>Crop insurance</h3>
        <p class="note">Each morning you pay ${U.money(prem)} and get back 50% of the value of every crop destroyed the day before.</p>
        <button data-ins="${G.insured ? 0 : 1}">${G.insured ? '✅ Insured — cancel' : 'Buy insurance'}</button>
        <h3>Repairs</h3>
        <p class="note">${broken ? `${broken} building pieces are broken. Builders fix them every morning (${U.money(15)} each), or right now:` : 'All buildings are intact. For now.'}</p>
        ${broken ? `<button data-buy="repair" ${m < broken * 15 ? 'disabled' : ''}>Repair now ${U.money(broken * 15)}</button>` : ''}
      </div>`;
    }
    box.innerHTML = `<div class="shopHead"><h2>🛒 Shop</h2><div class="cash">${U.money(m)}</div></div>
      <div class="tabs">${tabs.map(t => `<button class="${t === this.shopTab ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
      <div class="shopBody">${body}</div><button id="shClose">Close (Esc)</button>`;
    box.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { this.shopTab = b.dataset.t; this.renderShop(); });
    box.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => Game.request({ k: 'buy', what: b.dataset.buy, id: b.dataset.buy === 'upgrade' || b.dataset.buy === 'animal' ? b.dataset.id : +b.dataset.id, n: +b.dataset.n || 1 }));
    box.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => Game.request({ k: 'pay', amount: +b.dataset.pay }));
    box.querySelectorAll('[data-ins]').forEach(b => b.onclick = () => Game.request({ k: 'ins', on: b.dataset.ins === '1' }));
    $('shClose').onclick = () => this.closeModal(true);
    this.shopSig = this.sig();
  },
  sig() { return [G.money, G.debt, G.seeds.join(), JSON.stringify(G.upgrades), G.plots.join(), G.insured, W.brokenCount(), AN.list.length].join('|'); },

  // ---------------- modal plumbing ----------------
  showModal(name, html) {
    this.modal = name; $('modal').classList.remove('hidden'); $('modalBox').innerHTML = html; $('modalBox').className = 'm-' + name;
    if (document.pointerLockElement) document.exitPointerLock();
    this.updateClickToPlay();
  },
  closeModal(relock) {
    this.modal = null; $('modal').classList.add('hidden'); $('modalBox').innerHTML = ''; K.rebinding = null;
    if (G.mode === 'solo') G.paused = false;
    if (relock && G.started) this.lock();
    this.updateClickToPlay();
  },
  hideModal() { if (this.modal) this.closeModal(); },
  alert(text, cb) { this.showModal('alert', `<h2>${this.esc(text)}</h2><button class="big" id="aOk">OK</button>`); $('aOk').onclick = () => { this.closeModal(); if (cb) cb(); }; },

  // ---------------- HUD ----------------
  enterGame() {
    $('menu').classList.add('hidden'); this.hud(true);
    this.closeModal(); this.lock(); this.dirty = true;
  },
  hud(on) { $('hud').classList.toggle('hidden', !on); },
  prompt(html) { if (html !== this._prompt) { this._prompt = html; $('prompt').innerHTML = html; $('prompt').style.opacity = html ? 1 : 0; } },
  toast(t) { const el = $('toast'); el.innerHTML = t; el.classList.add('show'); clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 2600); },
  log(html) {
    const el = document.createElement('div'); el.className = 'ln'; el.innerHTML = html; $('log').appendChild(el);
    while ($('log').children.length > 8) $('log').firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 14000); setTimeout(() => el.remove(), 15500);
  },
  fps(v) { this.fpsV = v; },
  hurtFlash(a) { const el = $('hurt'); el.style.opacity = Math.min(0.7, 0.25 + a); clearTimeout(this._ht); this._ht = setTimeout(() => el.style.opacity = 0, 120); },
  showDeath(cause) { $('death').classList.remove('hidden'); $('deathCause').textContent = cause; },
  deathCountdown(t) { $('deathCount').textContent = t > 0 ? `Respawning in ${Math.ceil(t)}…` : ''; },
  hideDeath() { $('death').classList.add('hidden'); },
  eventWarning(e) {
    const el = document.createElement('div'); el.className = 'warnBig ' + e.def.tier;
    el.innerHTML = `<div class="wIc">${e.def.icon}</div><div><b>${e.def.tier === 'minor' ? '' : '⚠ '}${e.def.name}</b><span>${e.def.msg}</span></div>`;
    $('warnings').appendChild(el); setTimeout(() => el.classList.add('fade'), 5500); setTimeout(() => el.remove(), 6500);
    this.renderEvents();
  },
  combo(name) { const el = $('combo'); el.textContent = name; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); },
  renderEvents() { this._evSig = null; },
  radio(lines) { lines.forEach((l, i) => setTimeout(() => { $('radio').textContent = l; $('radio').classList.add('show'); AU.play('radio'); }, i * 3500)); setTimeout(() => $('radio').classList.remove('show'), lines.length * 3500 + 1000); },
  morning(lines) {
    const el = $('report'); el.innerHTML = lines.map(l => `<p>${l}</p>`).join('') + '<small>(click or wait)</small>'; el.classList.add('show');
    clearTimeout(this._rt); this._rt = setTimeout(() => el.classList.remove('show'), 11000);
    el.onclick = () => el.classList.remove('show');
  },
  showStats(s, host) {
    const el = $('stats');
    el.innerHTML = `<h1>💥 THE FARM IS GONE 💥</h1><p>…but you paid off the debt. The government thanks you for your sacrifice.</p>
      <div class="stg"><div><b>${s.days}</b>days survived</div><div><b>${U.money(s.earned)}</b>earned</div><div><b>${s.harvested}</b>crops harvested</div><div><b>${s.destroyed}</b>crops destroyed by chaos</div>
      <div><b>${s.events}</b>disasters</div><div><b>${s.deaths}</b>deaths</div><div><b>${s.abducted}</b>cows abducted</div><div><b>${s.pieces}</b>barn pieces blown up</div></div>
      ${host ? '<button class="big" id="stEnd">♾ Keep playing (endless mode)</button>' : '<p class="note">Waiting for the host to choose…</p>'}
      <button id="stMenu">Main menu</button>`;
    el.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    if (host) $('stEnd').onclick = () => { this.hideStats(); Game.continueEndless(); this.lock(); };
    $('stMenu').onclick = () => { NET.shutdown(); try { localStorage.removeItem('farmchaos_save'); } catch (e) { } location.reload(); };
  },
  hideStats() { $('stats').classList.add('hidden'); },
  openChat() { K.typing = true; $('chat').classList.remove('hidden'); const i = $('chatIn'); i.value = ''; setTimeout(() => i.focus(), 0); },
  closeChat() { K.typing = false; $('chat').classList.add('hidden'); $('chatIn').blur(); },

  setH(id, html) { this._h = this._h || {}; if (this._h[id] !== html) { this._h[id] = html; $(id).innerHTML = html; } },
  update(dt) {
    this.t += dt;
    if (!G.started) return;
    if (this.modal === 'shop' && this.sig() !== this.shopSig) this.renderShop();
    // health
    $('hpFill').style.width = Math.max(0, P.health) + '%';
    $('hpFill').style.background = P.health > 50 ? '#5fd35f' : P.health > 25 ? '#f0b030' : '#e04030';
    $('vignette').style.opacity = P.health < 35 && !P.dead ? (0.35 - P.health / 100) * 2 : 0;
    $('scoreboard').classList.toggle('hidden', !(K.locked && K.down('scoreboard')));
    if (this.t < 0.1 && !this.dirty) return;
    this.t = 0; this.dirty = false;
    const h = G.hour(), hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
    const night = h < 6 || h >= 20;
    this.setH('info', `<div class="day">${night ? '🌙' : '☀️'} Day ${G.day()} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</div>
      <div class="cash">${U.money(G.money)}</div>
      <div class="debt">Debt ${G.endless ? '— none (endless)' : U.money(G.debt)}</div>
      <div class="binI">📦 ${U.money(G.bin)} tomorrow${G.priceMult !== 1 ? ` · <b class="${G.priceMult > 1 ? 'up' : 'down'}">prices ×${G.priceMult}</b>` : ''}</div>`);
    // hotbar
    const tool = ['✋ Hand', '⛏️ Hoe', '🌱 Seeds', `🚿 Can<small>${P.can}/${CAN_MAX()} · 1×1</small>`, `🪣 Bucket<small>${P.bucket}/${BUCKET_MAX()} · 2×2</small>`];
    if (G.has('scythe')) tool[0] = '🪓 Scythe'; if (G.has('widehoe')) tool[1] = '⛏️ Wide hoe';
    const seed = CROPS[P.seedSel];
    this.setH('hotbar', tool.map((t, i) => `<div class="slot ${P.slot === i ? 'on' : ''}"><span class="k">${K.keyName(S.d.keys['slot' + (i + 1)])}</span>${i === 2 ? `${this.icon(P.seedSel, 22)} ${seed.name}<small>${G.seeds[P.seedSel]} seeds · ${K.keyName(S.d.keys.nextSeed)} = next</small>` : t}</div>`).join(''));
    this.setH('pack', `🎒 ${P.packN}/${P.capacity()}`);
    // events
    const evHtml = EV.active.map(e => {
      const lt = G.time - e.t0, warn = lt < e.warn, left = warn ? e.warn - lt : e.dur - (lt - e.warn);
      return `<div class="ev ${warn ? 'warn' : ''} ${e.def.tier}">${e.def.icon} ${e.def.name} <small>${warn ? 'in ' + Math.ceil(left) + 's' : Math.ceil(left) + 's'}</small></div>`;
    }).join('');
    this.setH('events', evHtml);
    // sleep
    const si = G.isHost ? { n: Game.sleepers.size, need: Math.max(1, Math.ceil(Object.keys(G.players).length / 2)), cd: Game.sleepCD } : G.sleepInfo;
    this.setH('sleepInfo', si && si.n > 0 ? `💤 ${si.n}/${si.need} sleeping${si.cd > 0 ? ` — morning in ${Math.ceil(si.cd)}s` : ''}` : '');
    // final timer
    this.setH('finalTimer', G.final && G.final.phase === 'evac' ? `🚁 EVACUATE! ${Math.max(0, Math.ceil(90 - G.final.t))}s` : '');
    $('fps').textContent = S.d.showFps ? this.fpsV + ' FPS' : '';
    // scoreboard
    if (!$('scoreboard').classList.contains('hidden')) {
      $('scoreboard').innerHTML = `<h3>Players</h3>` + Object.values(G.players).map(p => `<div><span style="color:#${new THREE.Color(p.color || 0xffffff).getHexString()}">●</span> ${this.esc(p.name)} ${p.d ? '☠️' : p.s ? '💤' : p.b ? '🛡️ bunker' : ''}</div>`).join('') +
        `<h3>Farm</h3><div>Fields owned: ${G.plots.filter(Boolean).length}/8</div><div>Disasters survived: ${G.stats.events}</div><div>Deaths: ${G.stats.deaths}</div>`;
    }
  },
};
