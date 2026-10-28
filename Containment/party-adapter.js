// Party adapter for Containment. Used by the hub's party lobby (party.js) to work the game's
// own Co-op menu: it never changes the game. If the game's menu changes, update the ids here.
(window.PartyAdapters = window.PartyAdapters || {}).containment = {
  max: 4,
  ts: 'toggle', // Tailscale = the same room code, with the menu's "Tailscale mode" switched on

  async ready(c) {
    await c.wait(() => c.$('#mpBtn') && c.$('#mpCreate'), 90000, 'the game to load');
    await c.sleep(600);
  },

  async open(c, ts) {
    if (c.$('#mp').classList.contains('off')) c.click('#mpBtn');
    await c.wait(() => !c.$('#mpHome').classList.contains('off'), 10000, 'the Co-op menu');
    c.type('#mpName', c.name);
    const want = c.$('#mpTs button[data-t="' + (ts ? 'on' : 'off') + '"]');
    if (want && want.getAttribute('aria-pressed') !== 'true') want.click();
    if (ts) c.status('Allow the microphone if the game asks (it reveals your Tailscale address).');
    await c.wait(() => { const b = c.$('#mpTs button'); return !b || !b.disabled; }, 60000, 'the Tailscale check');
  },

  // The Create button does nothing until the game's network part has loaded, so keep trying
  async host(c, o) {
    await this.open(c, o.ts);
    for (let i = 0; i < 15; i++) {
      if (c.$('#mpHome').classList.contains('off')) break;
      if (!c.$('#mpCreate').disabled) c.click('#mpCreate');
      try { await c.wait(() => c.$('#mpHome').classList.contains('off'), 3000); break; } catch (e) { if (e.message === 'cancelled') throw e; }
    }
    const code = await c.wait(() => { const t = c.$('#mpTiles').textContent.trim(); return t.length === 5 && t; }, 30000, 'a room code');
    c.status('Room ' + code + ' is open. Pick the difficulty and start the run when everyone is in.');
    return code;
  },

  async join(c, code, o) {
    await this.open(c, o.ts);
    c.type('#mpCode', code);
    for (let i = 0; i < 15; i++) {
      if (c.$('#mpHome').classList.contains('off')) break;
      if (!c.$('#mpJoin').disabled) c.click('#mpJoin');
      try { await c.wait(() => c.$('#mpHome').classList.contains('off'), 4000); break; } catch (e) { if (e.message === 'cancelled') throw e; }
    }
  }
};
