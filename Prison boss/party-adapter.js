// Party adapter for Prison Boss. Used by the hub's party lobby (party.js) to work the game's
// own Multiplayer menu: it never changes the game. If the game's menu changes, update the ids here.
(window.PartyAdapters = window.PartyAdapters || {}).prison = {
  max: 4,
  ts: 'manual', // Tailscale = the game's "Code swap" invite / reply codes, swapped through the party

  async ready(c) {
    await c.wait(() => c.$('#btn-coop') && c.get('PB && PB.Coop && PB.Net'), 60000, 'the game to load');
  },

  async open(c, tab) {
    if (c.$('#coop').classList.contains('hidden')) c.click('#btn-coop');
    await c.wait(() => !c.$('#coop').classList.contains('hidden'), 10000, 'the Multiplayer menu');
    c.type('#coop-name', c.name);
    c.type('#coop-size', String(c.size));
    c.click('[data-ctab="' + tab + '"]');
  },

  async host(c) {
    await this.open(c, 'peer');
    c.click('#cp-host');
    const code = await c.wait(() => { const t = c.$('#cp-code').textContent.trim(); return t.length === 5 && !c.$('#cp-code').classList.contains('hidden') && t; }, 30000, 'a room code');
    c.status('Room ' + code + ' is open. Press Start game when everyone is in the lobby.');
    return code;
  },

  async join(c, code) {
    await this.open(c, 'peer');
    c.type('#cp-join-code', code);
    c.click('#cp-join');
  },

  async hostManual(c) {
    await this.open(c, 'manual');
    c.click('[data-mtab="mhost"]');
  },

  // The game keeps one invite open at a time, so the party sends them one friend after another
  async makeInvite(c) {
    c.$('#cm-invite').value = '';
    c.click('#cm-make');
    const code = await c.wait(() => c.$('#cm-invite').value.trim(), 30000, 'the invite code');
    return { code };
  },

  async acceptReply(c, inv, reply) {
    const players = () => Object.keys(c.get('PB.Coop.players') || {}).length;
    const before = players();
    c.type('#cm-reply-in', reply);
    c.click('#cm-connect');
    await c.wait(() => players() > before, 40000, 'your friend to join the lobby');
  },

  async answerInvite(c, invite) {
    await this.open(c, 'manual');
    c.click('[data-mtab="mjoin"]');
    c.$('#cm-reply').value = '';
    c.type('#cm-invite-in', invite);
    c.click('#cm-answer');
    return await c.wait(() => c.$('#cm-reply').value.trim(), 60000, 'your reply code');
  }
};
