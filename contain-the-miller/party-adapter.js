// Party adapter for Contain the Miller. Used by the hub's party lobby (party.js).
// The game has no co-op yet, so the party only opens it for everyone at the same time
// (each player on their own island). When co-op is added, give this adapter host / join
// steps like the other games' adapters and remove openOnly.
(window.PartyAdapters = window.PartyAdapters || {}).miller = {
  max: 4,
  ts: null,
  openOnly: true,
  note: 'Opened for everyone. Co-op isn\'t in the game yet, so each of you plays your own island.',

  async ready(c) {
    // the island is a big download the first time, so give it plenty of time
    await c.wait(() => { const m = c.$('#menu'); return m && !m.classList.contains('hidden'); }, 300000, 'the island to load');
  }
};
