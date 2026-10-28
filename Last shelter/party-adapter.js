// Party adapter for Last Shelter. Used by the hub's party lobby (party.js) to work the game's
// own Multiplayer menu: it never changes the game. If the game's menu changes, update the ids here.
(window.PartyAdapters = window.PartyAdapters || {}).shelter = {
  max: 3,
  ts: 'toggle', // Tailscale = the same room code, with the menu's Tailscale mode switched on

  async ready(c) {
    await c.wait(() => c.$('[data-a="lbOpen"]') && c.get('typeof NET') === 'object', 60000, 'the game to load');
  },

  async open(c, ts) {
    if (c.$('#lobbyBox').classList.contains('hide')) c.click('[data-a="lbOpen"]');
    await c.wait(() => !c.$('#lobbyBox').classList.contains('hide') && c.$('#lbName'), 10000, 'the Multiplayer menu');
    if (!!c.get('SET.ts') !== !!ts) c.click('[data-a="lbTs"]');
    if (ts) {
      c.status('Allow the microphone if the game asks (it reveals your Tailscale address).');
      await c.wait(() => c.get('TS.state') !== 'checking', 60000, 'the Tailscale check');
    }
    c.type('#lbName', c.name);
  },

  async host(c, o) {
    await this.open(c, o.ts);
    c.click('[data-a="lbHost"]');
    const code = await c.wait(() => c.get('NET.role') === 'host' && c.get('NET.code'), 30000, 'a room code');
    c.status('Room ' + code + ' is open. Start the game when everyone is in.');
    return code;
  },

  async join(c, code, o) {
    await this.open(c, o.ts);
    c.type('#lbCode', code);
    c.click('[data-a="lbJoin"]');
  }
};
