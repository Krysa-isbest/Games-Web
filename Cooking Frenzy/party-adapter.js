// Party adapter for Cooking Frenzy. Used by the hub's party lobby (party.js) to work the game's own
// Host Co-op / Join Co-op menus: it never changes the game. If the game's menu changes, update the ids here.
// The game connects with a PeerJS room code only (no Tailscale code swap).
(window.PartyAdapters = window.PartyAdapters || {}).cooking = {
  max: 4,

  async ready(c) {
    await c.wait(() => c.$('#btn-host') && c.get('!!(window.CF && CF.Game && CF.UI && CF.Game.mode === "menu")'), 90000, 'the game to load');
    await c.sleep(300);
  },

  name(c) { c.type('#chef-name', c.name); },

  // The leader hosts. Whether to continue the saved restaurant is the checkbox in the game's own lobby.
  async host(c) {
    this.name(c);
    c.click('#btn-host');
    // c.wait swallows errors thrown inside the check, so an error comes back as { err }
    const r = await c.wait(() => {
      const err = c.get('CF.Game.lastError');
      if (err) return { err };
      const code = c.get('CF.Sync.mode === "host" && CF.Sync.code');
      return code ? { code } : null;
    }, 40000, 'a room code');
    if (r.err) throw new Error(r.err);
    c.status('Room ' + r.code + ' is open. Start the shift in the lobby when everyone is in.');
    return r.code;
  },

  async join(c, code) {
    this.name(c);
    c.click('#btn-join');
    await c.wait(() => c.visible('#join-code'), 10000, 'the Join window');
    c.type('#join-code', code);
    c.click('#btn-join-go');
    // in = the host welcomed us (lobby or a running kitchen); otherwise the game says what went wrong
    const r = await c.wait(() => {
      const err = c.get('CF.Game.lastError');
      if (err) return { err };
      return c.get('CF.Sync.mode === "client" && CF.Sync.myPid >= 0') ? { ok: true } : null;
    }, 45000, 'the host\'s kitchen');
    if (r.err) throw new Error(r.err);
  }
};
