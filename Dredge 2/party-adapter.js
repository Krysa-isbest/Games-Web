// Party adapter for Hollow Tides (Dredge 2). Used by the hub's party lobby (party.js) to work the
// game's own crew menus: it never changes the game. If the game's menu changes, update the ids here.
// The captain (party leader) must be out at sea before the vessel can be opened to the crew.
(window.PartyAdapters = window.PartyAdapters || {}).tides = {
  max: 4,
  ts: 'manual', // Tailscale = the game's "Direct" invite / reply codes, swapped through the party

  async ready(c) {
    await c.wait(() => { const m = c.$('#menu'); return m && !m.classList.contains('hidden') && c.get('typeof Net') === 'object'; }, 120000, 'the game to load');
  },

  // Leader: wait until they've started or loaded a voyage
  async atSea(c) {
    const ok = () => c.get('G.S && G.mode !== "client" && G.state !== "menu"');
    if (!ok()) c.status('Start a New Voyage or load one. Your crew joins automatically once you are at sea.');
    await c.wait(ok, 1e9);
  },

  async host(c) {
    await this.atSea(c);
    const Net = c.get('Net');
    if (!(Net.role === 'host' && Net.mode === 'peer')) Net.hostPeer();
    const code = await c.wait(() => Net.code, 30000, 'a room code');
    c.status('Room ' + code + ' is open. Your crew is boarding…');
    return code;
  },

  async openJoin(c, tab) {
    const panel = c.$('#pJoin');
    if (panel.classList.contains('hidden')) c.click('#mainnav [data-act="join"]');
    await c.wait(() => !c.$('#pJoin').classList.contains('hidden'), 10000, 'the Join a Crew menu');
    c.click('#joinTabs [data-t="' + tab + '"]');
    c.type('#joinName', c.name);
  },

  async join(c, code) {
    await this.openJoin(c, 'code');
    c.type('#joinRoom', code);
    c.click('#btnJoinCode');
  },

  async hostManual(c) {
    await this.atSea(c);
    const Net = c.get('Net');
    if (!(Net.role === 'host' && Net.mode === 'direct')) Net.hostDirect();
  },

  async makeInvite(c) {
    const Net = c.get('Net');
    const before = new Set(Net.invites.map(i => i.id));
    c.status('Making an invite. Allow the microphone if the game asks.');
    await Net.createInvite();
    const inv = await c.wait(() => Net.invites.find(i => !before.has(i.id) && i.code), 30000, 'the invite code');
    return { id: inv.id, code: inv.code };
  },

  async acceptReply(c, inv, reply) {
    const Net = c.get('Net');
    await Net.acceptReply(inv.id, reply);
    // the game drops the invite from its list once the friend is connected
    await c.wait(() => !Net.invites.some(i => i.id === inv.id), 40000, 'your friend to connect');
  },

  async answerInvite(c, invite) {
    await this.openJoin(c, 'direct');
    c.$('#joinAnswer').value = '';
    c.type('#joinOffer', invite);
    c.status('Allow the microphone if the game asks (it reveals your Tailscale address).');
    c.click('#btnMakeAnswer');
    return await c.wait(() => { const v = c.$('#joinAnswer').value; return v && v.startsWith('HT') && v; }, 60000, 'your reply code');
  }
};
