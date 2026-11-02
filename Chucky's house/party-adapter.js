// Party adapter for Chucky's House. Used by the hub's party lobby (party.js).
// The game exposes window.ChuckysHouse (js/coop.js) for this, so nothing here clicks through menus.
// mixed: one host takes room-code (PeerJS) players AND Tailscale (direct code) players in the same game.
(window.PartyAdapters = window.PartyAdapters || {}).chucky = {
  max: 4,
  ts: 'manual', // Tailscale = the game's direct code (PB1…) invite / reply, swapped through the party
  mixed: true,

  H(c) { return c.win.ChuckysHouse; },

  async ready(c) {
    await c.wait(() => this.H(c) && this.H(c).ready(), 90000, 'the game to load');
  },

  // The leader's save or a new game? Only asked when there is a save. A new game reloads the game.
  async prepare(c) {
    this.H(c).setName(c.name);
    if (!this.H(c).hasSave() || this.H(c).inGame()) return { fresh: false };
    const choice = await c.ask('Chucky\'s House', 'You have a saved game. What should the party play?', [
      { v: 'continue', t: 'Continue my shop', pri: true },
      { v: 'new', t: 'Start a new game (replaces my save)' }
    ]);
    if (choice === 'continue') return { fresh: false };
    const old = this.H(c);
    old.newGame();
    await c.wait(() => { const h = this.H(c); return h && h !== old && h.ready(); }, 90000, 'the new game to load');
    this.H(c).setName(c.name);
    return { fresh: true }; // the intro plays, then the game starts by itself
  },

  async host(c) {
    const { fresh } = await this.prepare(c);
    const code = await this.H(c).hostRoom();
    if (!fresh) this.H(c).startGame();
    c.status('Room ' + code + ' is open. Friends are joining the shop…');
    return code;
  },

  async hostManual(c) {
    const { fresh } = await this.prepare(c);
    if (!fresh) this.H(c).startGame();
  },

  async join(c, code) {
    this.H(c).setName(c.name);
    await this.H(c).joinRoom(code);
  },

  // The game keeps one direct invite open at a time; the party sends them one friend after another.
  async makeInvite(c) {
    return { code: await this.H(c).makeInvite() };
  },

  async acceptReply(c, inv, reply) {
    const before = this.H(c).players();
    await this.H(c).acceptReply(reply);
    await c.wait(() => this.H(c).players() > before, 40000, 'your friend to join the shop');
  },

  async answerInvite(c, invite) {
    this.H(c).setName(c.name);
    return await this.H(c).answerInvite(invite);
  }
};
