// Party adapter for Rooftop Snipers 3D. Used by the hub's party lobby (party.js) to work the game's
// own ONLINE menu: it never changes the game. If the game's menu changes, update the ids here.
(window.PartyAdapters = window.PartyAdapters || {}).rooftop = {
  max: 3,
  ts: null, // PeerJS only

  async ready(c) {
    await c.wait(() => c.$('#online-btn') && c.$('#net-host') && c.get('typeof net') === 'object', 60000, 'the game to load');
  },

  open(c) {
    if (c.$('#online').classList.contains('hidden')) c.click('#online-btn');
  },

  async host(c) {
    this.open(c);
    c.click('#net-host');
    const code = await c.wait(() => { const t = c.$('#net-code').textContent.trim(); return t.length === 5 && t; }, 30000, 'a room code');
    c.status('Room ' + code + ' is open. Start the match (SPUSTIT ZÁPAS) when everyone is in.');
    return code;
  },

  async join(c, code) {
    this.open(c);
    c.type('#net-in', code);
    c.click('#net-join');
  }
};
