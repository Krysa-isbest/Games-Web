// Party adapter for Bonk Derby. Used by the hub's party lobby (party.js) to work the game's
// own HOST ONLINE / JOIN menu: it never changes the game. If the game's menu changes, update the ids here.
// PeerJS only (the game's own Network settings handle a custom Tailscale PeerJS server).
(window.PartyAdapters = window.PartyAdapters || {}).bonkderby = {
  max: 4,

  async ready(c) {
    await c.wait(() => c.$('#bHost') && c.$('#bJoin') && c.$('#nameIn'), 90000, 'the game to load');
    await c.sleep(400);
  },

  inLobby(c) { const l = c.$('#lobby'); return l && !l.classList.contains('hidden'); },

  async host(c) {
    if (c.name) c.type('#nameIn', c.name);
    c.click('#bHost');
    await c.wait(() => this.inLobby(c), 30000, 'the room to open');
    const code = await c.wait(() => { const b = c.$('#roomInfo b'); const t = b && b.textContent.trim(); return t && t.length >= 4 && t; }, 10000, 'a room code');
    c.status('Room ' + code + ' is open. Pick the arena and press START when everyone is in.');
    return code;
  },

  async join(c, code) {
    if (c.name) c.type('#nameIn', c.name);
    for (let i = 0; i < 6; i++) {
      c.type('#codeIn', code);
      c.click('#bJoin');
      try { await c.wait(() => this.inLobby(c), 8000); return; } catch (e) { if (e.message === 'cancelled') throw e; }
    }
    throw new Error('Could not join room ' + code);
  }
};
