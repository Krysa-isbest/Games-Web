// main.js — boot
'use strict';

(function boot() {
  if (typeof THREE === 'undefined') { document.getElementById('loading').textContent = 'Could not load three.js — check your internet connection.'; return; }
  W.init();
  FX.init();
  AN.init();
  P.init();
  Game.init();
  UI.init();
  document.getElementById('loading').remove();
  requestAnimationFrame(frame);

  // ?test=solo&ev=tornado,meteors&t=0.3 — used for automated screenshots
  const q = new URLSearchParams(location.search);
  // ?hosttest=CODE / ?jointest=CODE — two-browser co-op test
  if (q.get('hosttest')) {
    Game.start('host', false); for (let i = 0; i < 8; i++) W.tiles.s[i] = 1;
    NET.hostOnline((code, err) => { UI.hostCode = code; window.__net = code || err; }, q.get('hosttest'));
    setTimeout(() => { Game.request({ k: 'act', a: 'plant', tiles: [0, 1, 2], seed: 0 }); EV.start('meteors'); }, 6000);
    setInterval(() => { document.title = 'H:' + JSON.stringify({ net: window.__net, players: Object.values(G.players).map(p => p.name + '@' + (+p.x).toFixed(1)), money: G.money, ev: EV.active.map(e => e.type) }); }, 500);
  }
  if (q.get('jointest')) {
    S.d.name = 'Friend';
    NET.joinOnline('FARM-' + q.get('jointest'), (ok, err) => { window.__net = ok ? 'joined' : err; if (ok) Game.startClient(); });
    setTimeout(() => { if (G.started) { P.pos.set(5, 0, 5); Game.request({ k: 'buy', what: 'seed', id: 0, n: 10 }); } }, 4000);
    setInterval(() => { document.title = 'C:' + JSON.stringify({ net: window.__net, started: G.started, me: G.myId, players: Object.values(G.players).map(p => p.name), money: G.money, seeds0: G.seeds[0], planted: [W.tiles.c[0], W.tiles.c[1]], ev: EV.active.map(e => e.type + ':' + e.phase), animals: AN.list[0] && AN.list[0].x.toFixed(1) }); }, 500);
  }
  if (q.get('test')) {
    Game.start('solo', false);
    G.time = DAY * (+q.get('t') || 0.15) + DAY * (+q.get('day') || 0);
    Game.lastDay = G.day();
    for (let i = 0; i < 64; i++) { W.tiles.s[i] = 1; W.tiles.c[i] = i % 20; W.tiles.g[i] = 999; W.tiles.st[i] = 3; }
    for (let i = 64; i < 96; i++) { W.tiles.s[i] = 1; W.tiles.c[i] = (i * 7) % 20; W.tiles.g[i] = (i % 4) * 60; W.tiles.st[i] = Game.stageOf(i); }
    G.plots[1] = true; W.refreshPlots(); W.cropsDirty = true;
    const ups = q.get('up'); if (ups) { ups.split(',').forEach(u => G.upgrades[u] = true); W.refreshUpgradeProps(); }
    const cam = q.get('cam');
    if (cam) { const [x, y, z, yaw, pitch] = cam.split(',').map(Number); P.pos.set(x, y, z); P.yaw = yaw; P.pitch = pitch; }
    let evs = q.get('ev');
    if (evs === 'all') evs = Object.keys(EV.defs).join(',');
    if (q.get('endafter')) setTimeout(() => { for (const e of EV.active) e.t0 -= 10000; }, +q.get('endafter'));
    if (q.get('sleep')) setTimeout(() => { Game.sleepUntilMorning(); }, +q.get('sleep'));
    if (evs) setTimeout(() => evs.split(',').forEach(t => { EV.start(t); const e = EV.active[EV.active.length - 1]; if (e && q.get('skipwarn')) e.t0 -= e.warn + (+q.get('skipwarn') || 0); }), 200);
    if (q.get('god')) P.hurt = () => { };
    if (q.get('shop')) setTimeout(() => { G.money = 5000; UI.shopTab = q.get('shop'); UI.openShop(); }, 300);
    window.__test = () => JSON.stringify({ ev: EV.active.map(e => e.type + ':' + e.phase), hp: Math.round(P.health), pos: P.pos.toArray().map(v => +v.toFixed(1)), broken: W.brokenCount(), calls: W.renderer.info.render.calls, tris: W.renderer.info.render.triangles, fps: UI.fpsV });
    setInterval(() => { document.title = 'T:' + window.__test(); }, 500);
  }
})();
