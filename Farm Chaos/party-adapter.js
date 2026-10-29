// Party adapter for Chaos Farm. Used by the hub's party lobby (party.js) to work the game's
// own Host co-op / Join co-op menus: it never changes the game. If the game's menu changes, update the ids here.
(window.PartyAdapters = window.PartyAdapters || {}).farm = {
  max: 4,
  ts: 'manual', // Tailscale = the game's "Direct code" invite (FCD-…) / reply (FCA-…), swapped through the party

  async ready(c) {
    await c.wait(() => !c.$('#loading') && c.$('#bHost') && c.get('typeof UI === "object" && typeof NET === "object"'), 90000, 'the game to load');
  },

  name(c) { c.type('#mName', c.name); },

  // Host the farm: the leader's save or a new farm? Only asked when there is a save.
  async startFarm(c) {
    this.name(c);
    c.click('#bHost');
    await c.wait(() => c.$('#bNew'), 10000, 'the Host co-op menu');
    if (c.$('#bCont')) {
      const choice = await c.ask('Chaos Farm', 'You have a saved farm. What should the party play?', [
        { v: 'continue', t: 'Continue my farm', pri: true },
        { v: 'new', t: 'Start a new farm (replaces my save)' }
      ]);
      if (choice === 'continue') c.click('#bCont');
      else {
        // the game asks "are you sure?" with confirm(): the party already asked
        const conf = c.win.confirm;
        c.win.confirm = () => true;
        try { c.click('#bNew'); } finally { c.win.confirm = conf; }
      }
    } else c.click('#bNew');
    await c.wait(() => c.get('G.started'), 20000, 'the farm to start');
  },

  async host(c) {
    await this.startFarm(c);
    // c.wait swallows errors thrown inside the check, so an error comes back as { err }
    const r = await c.wait(() => {
      const err = c.get('UI.hostErr'), code = c.get('UI.hostCode');
      return err ? { err } : code && { code };
    }, 30000, 'a room code');
    if (r.err) throw new Error(r.err);
    const code = r.code;
    c.status('Room ' + code + ' is open. Friends are joining the farm…');
    return code;
  },

  async join(c, code) {
    this.name(c);
    c.click('#bJoin');
    await c.wait(() => c.$('#jCode'), 10000, 'the Join co-op menu');
    c.type('#jCode', code);
    c.click('#bJoinGo');
    // the join window closes once connected; otherwise its status line shows the error
    const r = await c.wait(() => {
      if (!c.$('#jCode')) return { ok: true };
      const st = c.$('#jStatus').textContent.trim();
      return st && !/^Connect/.test(st) && { err: st };
    }, 30000, 'the host\'s farm');
    if (r.err) throw new Error(r.err);
  },

  async hostManual(c) {
    await this.startFarm(c);
  },

  // The game keeps one direct invite open at a time, so the party sends them one friend after another
  async makeInvite(c) {
    if (c.get('UI.modal') !== 'invite') c.get('UI.openInvite()');
    await c.wait(() => c.$('#bDirect'), 10000, 'the Invite friends menu');
    c.$('#dirBox').innerHTML = '';
    c.click('#bDirect');
    const code = await c.wait(() => { const t = c.$('#dirBox textarea[readonly]'); return t && t.value.trim(); }, 30000, 'the invite code');
    return { code };
  },

  async acceptReply(c, inv, reply) {
    const players = () => Object.keys(c.get('G.players') || {}).length;
    const before = players();
    c.type('#dAns', reply);
    c.click('#bAns');
    await c.wait(() => players() > before, 40000, 'your friend to join the farm');
  },

  async answerInvite(c, invite) {
    this.name(c);
    if (!c.$('#jCode')) c.click('#bJoin');
    await c.wait(() => c.$('#jCode'), 10000, 'the Join co-op menu');
    c.type('#jCode', invite);
    c.click('#bJoinGo');
    const r = await c.wait(() => {
      const out = c.$('#jReply');
      if (out && out.value.trim()) return { reply: out.value.trim() };
      const st = c.$('#jStatus').textContent.trim();
      return /did not work/.test(st) && { err: st };
    }, 60000, 'your reply code');
    if (r.err) throw new Error(r.err);
    return r.reply;
  }
};
