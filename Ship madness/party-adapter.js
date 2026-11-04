// Party adapter for Ship Madness. Used by the hub's party lobby (party.js).
// The game exposes window.ShipMadness (js/lobby.js) for this, so nothing here clicks through menus.
// mixed: one host takes room-code (PeerJS) players AND Tailscale (direct code SM1…) players in the same game.
(window.PartyAdapters = window.PartyAdapters || {}).shipmadness = {
  max: 4,
  ts: 'manual',   // Tailscale = the game's direct code invite / reply, swapped through the party
  mixed: true,

  H(c) { return c.win.ShipMadness; },

  async ready(c) {
    await c.wait(() => this.H(c) && this.H(c).ready(), 90000, 'the game to load');
  },

  // the leader picks what the party plays
  async pickMode(c) {
    return c.ask('Ship Madness', 'What should the party play?', [
      { v: 'ffa', t: '⚔️ Free-for-all', pri: true },
      { v: 'camp', t: '🧭 Co-op campaign' },
      { v: 'sandbox', t: '🏝️ Sandbox' }
    ]);
  },

  // start by itself once everyone is in the game's lobby (or let the leader press START)
  autoStart(c) {
    c.wait(() => this.H(c).players() >= c.size, 120000, 'everyone to board')
      .then(async () => { await c.sleep(1500); c.status('Everyone is aboard. Setting sail!'); this.H(c).start(); })
      .catch(e => { if (e.message !== 'cancelled') c.status('Press START in the game when everyone is in.'); });
  },

  async host(c) {
    const mode = await this.pickMode(c);
    this.H(c).setName(c.name);
    const code = await this.H(c).hostRoom(mode);
    c.status('Room ' + code + ' is open. Friends are boarding…');
    this.autoStart(c);
    return code;
  },

  async hostManual(c) {
    const mode = await this.pickMode(c);
    this.H(c).setName(c.name);
    this.H(c).hostManual(mode);
    this.autoStart(c);
  },

  async join(c, code) {
    this.H(c).setName(c.name);
    await this.H(c).joinRoom(code);
    c.status('Aboard! Waiting for the leader to set sail…');
  },

  // one direct invite at a time; the party sends them one friend after another
  async makeInvite(c) {
    return { code: await this.H(c).makeInvite() };
  },

  async acceptReply(c, inv, reply) {
    const before = this.H(c).players();
    await this.H(c).acceptReply(reply);
    await c.wait(() => this.H(c).players() > before, 40000, 'your friend to board');
  },

  async answerInvite(c, invite) {
    this.H(c).setName(c.name);
    return await this.H(c).answerInvite(invite);
  }
};
