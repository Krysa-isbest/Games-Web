'use strict';
/* =====================================================================
   GLOBAL CHAT for Banger Games (bottom-right corner)
   Everyone who has the site open is in the same chat, e.g. to post a
   party code or a link. No account and no database: messages go through
   ntfy.sh, a free public message relay (one topic = one chat room).
   ntfy keeps messages for about 12 hours, so opening the page also shows
   today's earlier messages; at midnight the chat starts empty again.
   It is public: anyone who finds the page can read and write.
   ===================================================================== */
(() => {
  const TOPIC = 'banger-games-hub-chat-q7x3k';
  const URL_ = 'https://ntfy.sh/' + TOPIC;
  const MAX_LEN = 200, COOLDOWN = 4000, KEEP = 150;
  const NET = window.PartyNet || null;
  const CLIENT = Math.random().toString(36).slice(2, 10); // marks my own messages (this tab)

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hhmm = t => new Date(t).toTimeString().slice(0, 5);

  const C = { open: store.get('chat_open', '0') === '1', msgs: [], ids: new Set(), unseen: 0, last: 0, es: null, state: 'connecting', day: midnight(), since: Date.now() - 5000 };

  /* ---------------- Connection ---------------- */
  function connect() {
    if (!window.EventSource) { setState('off'); return; }
    if (C.es) C.es.close();
    const es = C.es = new EventSource(URL_ + '/sse?since=' + Math.floor(C.day / 1000));
    es.onopen = () => setState('live');
    es.onerror = () => {
      if (es.readyState !== 2) { setState('connecting'); return; } // the browser retries by itself
      setState('off');
      setTimeout(() => { if (C.es === es) connect(); }, 30000);
    };
    es.onmessage = e => {
      let d; try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d && d.event === 'message') add(d);
    };
  }
  function add(d) {
    if (!d.id || C.ids.has(d.id)) return; // a reconnect sends today's messages again
    C.ids.add(d.id);
    let p; try { p = JSON.parse(d.message); } catch (e) { return; }
    if (!p || typeof p.m !== 'string' || !p.m.trim()) return;
    const t = (+d.time || 0) * 1000;
    if (t < C.day) return;
    const msg = { t, n: String(p.n || 'Player').slice(0, 16), m: p.m.slice(0, MAX_LEN), me: p.c === CLIENT };
    C.msgs.push(msg);
    C.msgs.sort((a, b) => a.t - b.t);
    if (C.msgs.length > KEEP) C.msgs.splice(0, C.msgs.length - KEEP);
    if (!msg.me && t > C.since && (!C.open || document.hidden)) C.unseen++;
    paint();
  }
  async function sendMsg() {
    const inp = $('gc-msg'), text = inp.value.trim().slice(0, MAX_LEN);
    if (!text) return;
    const wait = C.last + COOLDOWN - Date.now();
    if (wait > 0) { note('Wait ' + Math.ceil(wait / 1000) + ' s before the next message.'); return; }
    C.last = Date.now();
    inp.value = '';
    const name = ($('gc-name').value.trim() || 'Player').slice(0, 16);
    try {
      const r = await fetch(URL_, { method: 'POST', body: JSON.stringify({ n: name, m: text, c: CLIENT }) });
      if (!r.ok) throw new Error(r.status === 429 ? 'Too many messages right now. Wait a minute.' : 'Could not send (error ' + r.status + ').');
    } catch (e) {
      if (!inp.value) inp.value = text;
      note(/^(Too|Could)/.test(e.message) ? e.message : 'Could not send: no connection.');
    }
  }

  /* ---------------- UI ---------------- */
  function build() {
    const el = document.createElement('div');
    el.id = 'gchat';
    el.innerHTML = `<button id="gc-tab" title="Chat with everyone on the site">💬 Chat<b id="gc-n"></b></button>
      <div id="gc-box">
        <div class="gc-head"><b>Everyone</b><i id="gc-st" title=""></i>
          <input id="gc-name" maxlength="16" placeholder="Your name" autocomplete="off" title="Your name (the same as in the party)">
          <button class="pt-x" id="gc-x" title="Hide">×</button></div>
        <p class="gc-note">Public: everyone on the site sees this. It empties every day.</p>
        <div class="gc-list" id="gc-list"></div>
        <p class="gc-warn" id="gc-warn"></p>
        <div class="gc-row"><input id="gc-msg" maxlength="${MAX_LEN}" placeholder="Post a party code or a link…" autocomplete="off"><button class="pt-btn sm" id="gc-send">Send</button></div>
      </div>`;
    document.body.appendChild(el);
    const name = $('gc-name');
    name.value = NET ? NET.name() : store.get('party_name', '');
    name.oninput = () => NET ? NET.setName(name.value) : store.set('party_name', name.value);
    $('gc-tab').onclick = () => setOpen(true);
    $('gc-x').onclick = () => setOpen(false);
    $('gc-send').onclick = sendMsg;
    $('gc-msg').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } };
    $('gc-list').onclick = e => {
      const b = e.target.closest('.gc-code');
      if (!b) return;
      if (!NET || !NET.join(b.dataset.code)) note('Leave your party first, then click the code again.');
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && C.open) { C.unseen = 0; paint(); } });
    setOpen(C.open);
  }
  function setOpen(on) {
    C.open = on;
    store.set('chat_open', on ? '1' : '0');
    document.body.classList.toggle('gc-open', on);
    if (on) { C.unseen = 0; if (NET) $('gc-name').value = NET.name(); }
    paint(true);
    if (on) setTimeout(() => $('gc-msg').focus(), 50);
  }
  function setState(s) {
    C.state = s;
    const st = $('gc-st');
    if (st) { st.className = s; st.title = { live: 'Connected', connecting: 'Connecting…', off: 'Offline: trying again soon' }[s]; }
  }
  let noteTimer = 0;
  function note(text) {
    const w = $('gc-warn');
    w.textContent = text; w.style.display = 'block';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => w.style.display = 'none', 4000);
  }
  // links open in a new tab; party codes get a Join button. So that a shouted word ("GREAT") isn't one,
  // a code needs a digit, or the message says code / party / join, or is nothing but the code.
  function fmt(text) {
    const hint = /\b(code|party|join)\b/i.test(text) || /^\s*\S{5}\s*$/.test(text);
    return text.split(/(\s+)/).map(w => {
      if (/^https?:\/\/\S+$/i.test(w)) return `<a href="${esc(w)}" target="_blank" rel="noopener noreferrer">${esc(w)}</a>`;
      const code = w.replace(/[.,!?:;)]+$/, '');
      if (NET && /^[A-HJ-NP-Z2-9]{5}$/.test(code) && (hint || /\d/.test(code))) return `<button class="gc-code" data-code="${code}" title="Join this party">${code} ▸ Join</button>` + esc(w.slice(code.length));
      return esc(w);
    }).join('');
  }
  function paint(jump) {
    const list = $('gc-list');
    if (!list) return;
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = C.msgs.length
      ? C.msgs.map(c => `<p${c.me ? ' class="me"' : ''}><small>${hhmm(c.t)}</small> <b>${esc(c.n)}</b> ${fmt(c.m)}</p>`).join('')
      : '<p class="gc-empty">No messages today yet.</p>';
    if (jump || atEnd) list.scrollTop = list.scrollHeight;
    const n = $('gc-n');
    n.textContent = C.unseen > 9 ? '9+' : C.unseen || '';
    n.style.display = C.unseen ? '' : 'none';
  }

  // a new day: empty the chat and listen from the new midnight
  setInterval(() => {
    if (midnight() === C.day) return;
    C.day = midnight(); C.msgs = []; C.ids.clear(); C.unseen = 0;
    paint(); connect();
  }, 60000);

  build();
  setState('connecting');
  connect();
})();
