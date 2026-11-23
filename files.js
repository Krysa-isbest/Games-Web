'use strict';
/* =====================================================================
   FILE SHARE for Banger Games (left panel)
   Friends in the same party share files browser to browser, over the
   party connection (party.js, window.PartyNet). Nothing is uploaded:
   the sender's page reads the file from disk only when a friend clicks
   Download, so the sender has to keep the page open.
   A file goes in small pieces, and the sender waits for acknowledgements,
   so a big file can't flood the connection (PeerJS drops JSON messages
   over ~16 KB). Between two guests the pieces pass through the leader.
   ===================================================================== */
(() => {
  const NET = window.PartyNet;
  if (!NET) return;

  const CHUNK = 10 * 1024;              // raw bytes per piece (as base64 in JSON it stays well under 16 KB)
  const WINDOW = 64;                    // pieces on the way before the sender waits for an ack
  const ACK_EVERY = 16;
  const MAX = 500 * 1024 * 1024;        // the receiver holds the whole file in memory
  const STALL_MS = 20000;
  const PREVIEW = /^image\/(png|jpeg|gif|webp)$/;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  const pieces = size => Math.ceil(size / CHUNK);
  const pct = f => Math.min(100, Math.floor(f * 100));
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    return (n / 1073741824).toFixed(1) + ' GB';
  }
  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  }
  function fromB64(s) {
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function icon(name, mime) {
    if (/^image\//.test(mime)) return '🖼️';
    if (/^video\//.test(mime)) return '🎬';
    if (/^audio\//.test(mime)) return '🎵';
    if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return '🗜️';
    return '📄';
  }

  let seq = 0;
  const F = {
    open: store.get('files_open', '0') === '1',
    mine: [],          // files I share: { fid, file, name, size, mime, got: Set of friend ids who downloaded it }
    theirs: [],        // friends' files: { key, fid, owner, ownerName, name, size, mime, st: 'new'|'get'|'done'|'fail', got, n, parts, url, why, at, gone }
    sends: new Map(),  // 'fid|friendId' -> { key, bar, fid, to, item, total, next, acked, busy, stop }
    known: new Set(),  // friends I've already offered my files to
    inParty: false,
    unseen: 0,
    msg: ''
  };
  const findTheirs = (owner, fid) => F.theirs.find(t => t.owner === owner && t.fid === fid);
  const offerOf = m => ({ k: 'offer', fid: m.fid, name: m.name, size: m.size, mime: m.mime });
  const nameOf = id => (NET.members().find(m => m.id === id) || {}).name;

  /* ---------------- Messages from friends ---------------- */
  NET.on('msg', (from, d) => {
    if (!d || typeof d !== 'object' || !from) return;
    switch (d.k) {
      case 'offer': gotOffer(from, d); break;
      case 'unshare': dropOffer(from, String(d.fid || '')); break;
      case 'get': startSend(from, String(d.fid || '')); break;
      case 'ack': {
        const s = F.sends.get(d.fid + '|' + from);
        if (s) { s.acked = Math.max(s.acked, Math.min(s.total, +d.n || 0)); pumpSend(s); }
        break;
      }
      case 'stop': stopSend(from, String(d.fid || '')); break;
      case 'chunk': gotChunk(from, d); break;
      case 'fail': {
        const t = findTheirs(from, String(d.fid || ''));
        if (t && t.st === 'get') failGet(t, String(d.why || 'The download failed.').slice(0, 120));
        break;
      }
    }
  });

  // Party changes: offer my files to newcomers, forget friends who left
  NET.on('change', () => {
    if (!NET.role()) { if (F.inParty) leftParty(); return; }
    if (!F.inParty) { F.inParty = true; paint(); }
    const me = NET.me(), ids = new Set(NET.members().map(m => m.id));
    ids.forEach(id => {
      if (id === me || F.known.has(id)) return;
      F.known.add(id);
      F.mine.forEach(m => NET.send(id, offerOf(m)));
    });
    F.known.forEach(id => { if (!ids.has(id)) { F.known.delete(id); friendGone(id); } });
  });
  // on a phone the two panels would cover each other: opening the party hides the files
  NET.on('open', on => { if (on && innerWidth <= 900 && F.open) setOpen(false); });

  function friendGone(id) {
    F.sends.forEach(s => { if (s.to === id) { s.stop = true; F.sends.delete(s.key); } });
    F.theirs = F.theirs.filter(t => t.owner !== id || t.st === 'done');
    F.theirs.forEach(t => { if (t.owner === id) t.gone = true; });
    paint();
  }
  function leftParty() {
    F.inParty = false;
    F.known.clear();
    F.sends.forEach(s => s.stop = true);
    F.sends.clear();
    F.theirs = F.theirs.filter(t => t.st === 'done');
    F.theirs.forEach(t => t.gone = true);
    F.unseen = 0;
    paint();
  }

  /* ---------------- Receiving ---------------- */
  function gotOffer(from, d) {
    const fid = String(d.fid || '').slice(0, 20), size = Math.max(0, Math.floor(+d.size || 0));
    if (!fid || findTheirs(from, fid)) return;
    F.theirs.unshift({
      key: 'r' + (++seq), fid, owner: from, ownerName: nameOf(from) || 'A friend',
      name: String(d.name || 'file').slice(0, 120), size, mime: String(d.mime || '').slice(0, 80),
      st: 'new', got: 0, n: 0
    });
    if (!F.open) F.unseen++;
    paint();
  }
  function dropOffer(from, fid) {
    const t = findTheirs(from, fid);
    if (!t) return;
    if (t.st === 'done') t.gone = true;
    else F.theirs = F.theirs.filter(x => x !== t);
    paint();
  }
  function download(t) {
    if (t.size > MAX) return failGet(t, 'Too big: files over 500 MB can\'t be shared here.');
    Object.assign(t, { st: 'get', got: 0, n: 0, parts: [], why: '', at: Date.now() });
    if (t.size === 0) return finish(t);
    NET.send(t.owner, { k: 'get', fid: t.fid });
    paint();
  }
  function gotChunk(from, d) {
    const t = findTheirs(from, String(d.fid || ''));
    if (!t || t.st !== 'get' || d.i !== t.n) return; // the channel is ordered: anything else is left over from an old try
    let u8;
    try { u8 = fromB64(String(d.d || '')); } catch (e) { return failGet(t, 'A broken piece arrived.', true); }
    if (t.got + u8.length > t.size) return failGet(t, 'The file came out bigger than announced.', true);
    t.parts.push(u8);
    t.n++; t.got += u8.length; t.at = Date.now();
    if (t.n >= pieces(t.size)) { NET.send(from, { k: 'ack', fid: t.fid, n: t.n }); finish(t); }
    else { if (t.n % ACK_EVERY === 0) NET.send(from, { k: 'ack', fid: t.fid, n: t.n }); paintSoon(); }
  }
  function finish(t) {
    if (t.got !== t.size) return failGet(t, 'Part of the file is missing.', true);
    t.url = URL.createObjectURL(new Blob(t.parts, { type: t.mime || 'application/octet-stream' }));
    t.parts = null;
    t.st = 'done';
    paint();
  }
  function failGet(t, why, tellOwner) {
    if (tellOwner) NET.send(t.owner, { k: 'stop', fid: t.fid });
    Object.assign(t, { st: 'fail', why, parts: null });
    paint();
  }
  function cancelGet(t) {
    NET.send(t.owner, { k: 'stop', fid: t.fid });
    Object.assign(t, { st: 'new', parts: null, got: 0, n: 0 });
    paint();
  }
  function removeTheirs(t) {
    if (t.st === 'get') NET.send(t.owner, { k: 'stop', fid: t.fid });
    if (t.url) URL.revokeObjectURL(t.url);
    F.theirs = F.theirs.filter(x => x !== t);
    paint();
  }
  setInterval(() => {
    const now = Date.now();
    F.theirs.forEach(t => { if (t.st === 'get' && now - t.at > STALL_MS) failGet(t, 'The download stalled. Try again.', true); });
  }, 2000);

  /* ---------------- Sending ---------------- */
  function addFiles(list, folders) {
    const big = [];
    [...list].forEach(file => {
      if (file.size > MAX) { big.push(file.name); return; }
      const m = { fid: uid(), file, name: (file.name || 'file').slice(0, 120), size: file.size, mime: file.type || '', got: new Set() };
      F.mine.unshift(m);
      if (NET.role()) NET.send('*', offerOf(m));
    });
    const msgs = [];
    if (big.length) msgs.push('Too big to share (over 500 MB): ' + big.join(', '));
    if (folders) msgs.push('Folders can\'t be shared. Zip them first, then drop the zip.');
    F.msg = msgs.join(' ');
    paint();
  }
  function unshare(fid) {
    F.mine = F.mine.filter(m => m.fid !== fid);
    F.sends.forEach(s => { if (s.fid === fid) { s.stop = true; F.sends.delete(s.key); } });
    NET.send('*', { k: 'unshare', fid });
    paint();
  }
  function startSend(to, fid) {
    const item = F.mine.find(m => m.fid === fid);
    if (!item) { NET.send(to, { k: 'fail', fid, why: 'That file is no longer shared.' }); return; }
    const key = fid + '|' + to, old = F.sends.get(key);
    if (old) old.stop = true;
    const s = { key, bar: 's' + (++seq), fid, to, item, total: pieces(item.size), next: 0, acked: 0, busy: false, stop: false };
    F.sends.set(key, s);
    paint();
    pumpSend(s);
  }
  function stopSend(from, fid) {
    const s = F.sends.get(fid + '|' + from);
    if (!s) return;
    s.stop = true;
    F.sends.delete(s.key);
    paint();
  }
  async function pumpSend(s) {
    if (s.busy || s.stop) return;
    s.busy = true;
    try {
      while (!s.stop && s.next < s.total && s.next - s.acked < WINDOW) {
        const a = s.next * CHUNK;
        const buf = await s.item.file.slice(a, Math.min(a + CHUNK, s.item.size)).arrayBuffer();
        if (s.stop) break;
        NET.send(s.to, { k: 'chunk', fid: s.fid, i: s.next, d: toB64(new Uint8Array(buf)) });
        s.next++;
      }
    } catch (e) {
      s.stop = true;
      NET.send(s.to, { k: 'fail', fid: s.fid, why: 'The sender\'s browser couldn\'t read the file any more (moved or deleted?).' });
    } finally { s.busy = false; }
    if (!s.stop && s.acked >= s.total) { s.item.got.add(s.to); s.stop = true; }
    if (s.stop) {
      if (F.sends.get(s.key) === s) F.sends.delete(s.key);
      paint();
    } else paintSoon();
  }

  /* ---------------- Panel UI ---------------- */
  function build() {
    const el = document.createElement('aside');
    el.id = 'files';
    el.innerHTML = `<button id="files-tab" title="File share">📁<span>Files</span></button>
      <div class="pt-head"><h3>File share</h3><button class="pt-x" id="files-hide" title="Hide">←</button></div>
      <div class="pt-body" id="files-body"></div>
      <input type="file" id="fs-input" multiple hidden>`;
    document.body.appendChild(el);
    $('files-tab').onclick = () => setOpen(true);
    $('files-hide').onclick = () => setOpen(false);
    $('fs-input').onchange = e => { addFiles(e.target.files, 0); e.target.value = ''; };
    el.addEventListener('click', onClick);
    // dropping files anywhere on the page shares them (the game frame keeps its own drops)
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    let depth = 0;
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; el.classList.add('drag'); if (!F.open) setOpen(true); });
    window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; el.classList.remove('drag'); } });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      el.classList.remove('drag');
      takeDrop(e.dataTransfer);
    });
    window.addEventListener('beforeunload', e => {
      if (F.sends.size) { e.preventDefault(); e.returnValue = ''; } // a friend is still downloading from you
    });
    setOpen(F.open);
  }
  function takeDrop(dt) {
    const files = [];
    let folders = 0;
    const items = dt.items ? [...dt.items].filter(it => it.kind === 'file') : [];
    if (items.length && items[0].webkitGetAsEntry) {
      items.forEach(it => {
        const en = it.webkitGetAsEntry();
        if (en && en.isDirectory) { folders++; return; }
        const f = it.getAsFile();
        if (f) files.push(f);
      });
    } else files.push(...dt.files);
    addFiles(files, folders);
  }
  function setOpen(on) {
    F.open = on;
    store.set('files_open', on ? '1' : '0');
    document.body.classList.toggle('files-open', on);
    if (on) {
      F.unseen = 0;
      if (innerWidth <= 900) NET.setOpen(false);
    }
    paint();
  }
  function onClick(e) {
    const b = e.target.closest('[data-f]');
    if (!b || b.disabled) return;
    const v = b.dataset.f, t = F.theirs.find(x => x.key === b.dataset.k);
    if (v === 'pick') $('fs-input').click();
    else if (v === 'party') NET.setOpen(true);
    else if (v === 'unshare') unshare(b.dataset.id);
    else if (v === 'get' && t) download(t);
    else if (v === 'cancel' && t) cancelGet(t);
    else if (v === 'remove' && t) removeTheirs(t);
    else if (v === 'msgx') { F.msg = ''; paint(); }
  }

  let paintT = 0;
  function paint() {
    clearTimeout(paintT); paintT = 0;
    document.body.classList.toggle('files-new', F.unseen > 0 && !F.open);
    const body = $('files-body');
    if (body) body.innerHTML = html();
  }
  // while files move, only the bars and numbers change: no flicker on the previews
  function paintSoon() { if (!paintT) paintT = setTimeout(tick, 200); }
  function tick() {
    paintT = 0;
    const body = $('files-body');
    if (!body) return;
    const bar = (k, f, text) => {
      const el = body.querySelector(`[data-bar="${k}"]`);
      if (!el) return false;
      el.querySelector('i').style.width = pct(f) + '%';
      el.querySelector('small').textContent = text;
      return true;
    };
    let ok = true;
    F.theirs.forEach(t => { if (t.st === 'get') ok = bar(t.key, t.got / t.size, getText(t)) && ok; });
    F.sends.forEach(s => { ok = bar(s.bar, s.total ? s.acked / s.total : 1, sendText(s)) && ok; });
    if (!ok) paint();
  }
  const getText = t => `${pct(t.got / t.size)}% · ${fmtSize(t.got)} of ${fmtSize(t.size)}`;
  const sendText = s => `Sending to ${nameOf(s.to) || 'a friend'} · ${pct(s.total ? s.acked / s.total : 1)}%`;
  const progHTML = (k, f, text) => `<div class="fs-prog" data-bar="${k}"><div class="fs-bar"><i style="width:${pct(f)}%"></i></div><small>${esc(text)}</small></div>`;

  function html() {
    let h = '';
    if (!NET.role()) h += `<div class="fs-off"><p class="pt-note">Start or join a party first. Your files then go straight to your friends' browsers.</p><button class="pt-btn sm pri" data-f="party">Open the party</button></div>`;
    h += `<div class="fs-drop"><b>Drop files here</b><span>or</span><button class="pt-btn sm" data-f="pick">Choose files</button></div>
      <p class="pt-note">Nothing is uploaded: friends download straight from your browser, so keep this page open while they do. Up to 500 MB per file.</p>`;
    if (F.msg) h += `<p class="pt-err">${esc(F.msg)} <button class="fs-x" data-f="msgx" title="OK">×</button></p>`;

    if (F.mine.length) {
      h += `<div class="pt-sec"><h4>Your files · ${F.mine.length}</h4><ul class="fs-list">`;
      F.mine.forEach(m => {
        const got = [...m.got].map(id => nameOf(id)).filter(Boolean);
        h += `<li class="fs-item"><span class="fs-ico">${icon(m.name, m.mime)}</span><div class="fs-main"><b title="${esc(m.name)}">${esc(m.name)}</b>
          <small>${fmtSize(m.size)}${got.length ? ' · downloaded by ' + esc(got.join(', ')) : ''}</small>`;
        F.sends.forEach(s => { if (s.item === m) h += progHTML(s.bar, s.total ? s.acked / s.total : 1, sendText(s)); });
        h += `</div><button class="fs-x" data-f="unshare" data-id="${esc(m.fid)}" title="Stop sharing">×</button></li>`;
      });
      h += '</ul></div>';
    }

    if (F.theirs.length) {
      h += `<div class="pt-sec"><h4>From friends · ${F.theirs.length}</h4><ul class="fs-list">`;
      F.theirs.forEach(t => {
        const who = nameOf(t.owner) || t.ownerName;
        h += `<li class="fs-item"><span class="fs-ico">${icon(t.name, t.mime)}</span><div class="fs-main"><b title="${esc(t.name)}">${esc(t.name)}</b>
          <small>from ${esc(who)} · ${fmtSize(t.size)}</small>`;
        if (t.st === 'new') h += `<div class="fs-acts"><button class="pt-btn sm pri" data-f="get" data-k="${t.key}">Download</button></div>`;
        else if (t.st === 'get') h += progHTML(t.key, t.got / t.size, getText(t)) + `<div class="fs-acts"><button class="pt-btn sm" data-f="cancel" data-k="${t.key}">Cancel</button></div>`;
        else if (t.st === 'done') {
          if (PREVIEW.test(t.mime)) h += `<img class="fs-prev" src="${t.url}" alt="">`;
          h += `<div class="fs-acts"><a class="pt-btn sm pri" href="${t.url}" download="${esc(t.name)}">Save</a></div>`;
        } else h += `<small class="bad">${esc(t.why)}</small><div class="fs-acts"><button class="pt-btn sm" data-f="get" data-k="${t.key}">Try again</button></div>`;
        h += `</div><button class="fs-x" data-f="remove" data-k="${t.key}" title="Remove from the list">×</button></li>`;
      });
      h += '</ul></div>';
    } else if (NET.role()) h += '<div class="pt-sec"><h4>From friends</h4><p class="pt-note">Files your friends share show up here.</p></div>';
    return h;
  }

  build();
})();
