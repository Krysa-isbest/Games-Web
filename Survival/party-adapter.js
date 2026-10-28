// Party adapter for Divočina. Used by the hub's party lobby (party.js) to work the game's
// own "Hrát s kamarádem" menu: it never changes the game. If the game's menu changes, update the ids here.
(window.PartyAdapters = window.PartyAdapters || {}).survival = {
  max: 3,
  ts: null, // PeerJS only

  async ready(c) {
    await c.wait(() => c.$('#btn-online') && c.get('typeof Peer') === 'function', 60000, 'the game to load');
  },

  open(c) {
    if (c.$('#online').classList.contains('hidden')) c.click('#btn-online');
    c.type('#net-name', c.name);
  },

  async host(c) {
    this.open(c);
    c.click('#btn-host');
    const code = await c.wait(() => { const v = c.$('#host-code').value.trim(); return v.length === 5 && v; }, 30000, 'a room code');
    c.status('Room ' + code + ' is open. Press "Začít hrát" when everyone is in.');
    return code;
  },

  async join(c, code) {
    this.open(c);
    c.type('#join-code', code);
    c.click('#btn-join');
  }
};
