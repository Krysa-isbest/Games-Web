// First-time tips: a small card in the corner the first time you get / meet something new. Shown once per player
// (remembered on this computer), never pauses the game. Every tip is also in the Guide app on the computer.
// Texts use kb('action') so they always show the player's own key binds.
import { G, me } from './state.js';
import { kb } from './keys.js';
import { S } from './settings.js';
import { isAuctionDay } from './economy.js';
import { sfx } from './sfx.js';

const SEEN = 'chuckys_house_tips';
let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(SEEN)) || []); } catch { seen = new Set(); }
const remember = () => localStorage.setItem(SEEN, JSON.stringify([...seen]));

// group: Gear · Weapons · Shop · Night · Co-op. when(): checked twice a second (null = only shown by tip(id)).
export const TIPS = {
  // ---------- gear ----------
  flashlight: { group: 'Gear', icon: '🔦', title: 'Flashlight', text: () => `${kb('flashlight')} turns it on at night. Each battery lasts about 2 minutes and is swapped in automatically. Enemies see a lit flashlight from further away.`, when: () => G.tools.flashlight },
  radio: { group: 'Gear', icon: '📻', title: 'Walkie-talkies', text: () => `Hold ${kb('radio')} to talk to the whole team from anywhere, in a crackly radio voice. The further away, the more static.`, when: () => G.tools.radio },
  screwdriver: { group: 'Gear', icon: '🪛', title: 'Screwdriver Set', text: () => `Look at an arcade cabinet or an AC unit at night and press ${kb('dismantle')}. Hold the mouse on each screw. It makes noise!`, when: () => G.tools.screwdriver },
  wrench: { group: 'Gear', icon: '🔧', title: 'Wrench Set', text: () => `${kb('dismantle')} on generators and engines: click each bolt 4×. With the screwdriver too, you can take apart motorbikes.`, when: () => G.tools.wrench },
  crowbar: { group: 'Gear', icon: '🪝', title: 'Crowbar', text: () => `${kb('interact')} on a locked crate at night to pry it open (loud, better loot). It also cracks Rusty's safe twice as fast.`, when: () => G.tools.crowbar },
  bandage: { group: 'Gear', icon: '🩹', title: 'Bandages', text: () => `Select the bandage on the hotbar and press ${kb('attack')} to heal 50 HP. Look at a downed teammate and press ${kb('interact')} to get them back up.`, when: () => G.gear.bandage > 0 },
  trap: { group: 'Gear', icon: '🪤', title: 'Bear Trap', text: () => `Select it on the hotbar and press ${kb('attack')} to put it down in front of you. It holds the next enemy that steps on it.`, when: () => G.gear.trap > 0 },
  mine: { group: 'Gear', icon: '💣', title: 'Landmine', text: () => `Put it down with ${kb('attack')} (hotbar). It blows up anything close, including you, and every enemy around hears it.`, when: () => G.gear.mine > 0 },
  magnifier: { group: 'Gear', icon: '🔍', title: 'Magnifier', text: () => '"🔍 Inspect" appears when you set a price or bargain. It estimates what an item is really worth and can spot fakes. Better magnifiers are more exact.', when: () => G.tools.magnifier > 0 },
  duck: { group: 'Gear', icon: '🦆', title: 'Rubber Duck', text: () => `Take it from the stock crates and throw it (${kb('attack')}) at a friend. It squeaks. That's all. It's perfect.`, when: () => G.backstock.some(i => i.id === 'duck') },
  // ---------- weapons ----------
  bat: { group: 'Weapons', icon: '🏏', title: 'Baseball Bat', text: () => `Slot 1 at night, swing with ${kb('attack')}. Lethal and 2.5× stronger than fists.`, when: () => G.weapons.bat },
  baton: { group: 'Weapons', icon: '🦯', title: 'Police Baton', text: () => `Melee with ${kb('attack')}. It doesn't kill: it stuns. Stuns are shorter on high-skull nights.`, when: () => G.weapons.baton },
  pepper: { group: 'Weapons', icon: '🌶️', title: 'Pepper Spray', text: () => `${kb('attack')} sprays a short cone and stuns everything in it. Each spray uses a charge.`, when: () => G.weapons.pepper },
  taser: { group: 'Weapons', icon: '⚡', title: 'Taser', text: () => `Aim and press ${kb('attack')}: an 8 m stun, the longest one. One cartridge per shot.`, when: () => G.weapons.taser },
  revolver: { group: 'Weapons', icon: '🔫', title: 'Revolver', text: () => `${kb('attack')} to shoot. Lethal and LOUD: everything nearby comes to look. Watch your rounds.`, when: () => G.weapons.revolver },
  shotgun: { group: 'Weapons', icon: '🎯', title: 'Shotgun', text: () => `Devastating up close, weak far away. Very loud. Shells run out fast.`, when: () => G.weapons.shotgun },
  permit: { group: 'Weapons', icon: '📜', title: 'Gun Permit', text: () => 'You can now buy guns, buy weapons from customers and put weapons on your shelves.', when: () => G.up.permit },
  // ---------- shop ----------
  hold: { group: 'Shop', icon: '🤲', title: 'Holding an item', text: () => `${kb('interact')} on an empty shelf slot to put it there, or on the stock crates. ${kb('grab')} or ${kb('attack')} throws it. Fragile things thrown hard break!`, when: () => me()?.holding?.kind === 'item' },
  spill: { group: 'Shop', icon: '🧽', title: 'Spills', text: () => `Customers spill coffee and drag mud in. Get the mop at the cleaning corner (left wall, by the back) and hold ${kb('attack')} on the mess. A clean shop sells for more.`, when: () => G.world === 'shop' && G.spills.some(s => s.kind === 'coffee' || s.kind === 'mud') },
  mop: { group: 'Shop', icon: '🧽', title: 'The mop', text: () => `Hold ${kb('attack')} on a spill. It gets dirty after a few: rinse it at the sink. Mopping leaves the floor wet for a while: customers can slip unless a wet floor sign is nearby.`, when: () => me()?.holding?.tool === 'mop' },
  glass: { group: 'Shop', icon: '🧹', title: 'Broken glass', text: () => `Fragile items break when thrown hard. Sweep the glass with the broom (cleaning corner), ${kb('attack')} held.`, when: () => G.world === 'shop' && G.spills.some(s => s.kind === 'glass') },
  wetsign: { group: 'Shop', icon: '⚠️', title: 'Wet floor sign', text: () => `${kb('grab')} puts it down where you're looking. Anything within a couple of metres is safe to walk on while it's wet.`, when: () => me()?.holding?.tool === 'sign' },
  thief: { group: 'Shop', icon: '🚨', title: 'Shoplifter!', text: () => `Someone grabbed an item and is running for the door. Run (${kb('run')}) and press ${kb('interact')} on them before they get out. Glass cases near the register get robbed less.`, when: () => G.world === 'shop' && G.customers.some(c => c.iconE === '❗') },
  help: { group: 'Shop', icon: '🙋', title: '"Can I see that?"', text: () => `A customer at a shelf wants help. Walk over and press ${kb('interact')} on them: they'll pay more for what they pick.`, when: () => G.world === 'shop' && G.customers.some(c => c.iconE === '🙋') },
  regular: { group: 'Shop', icon: '⭐', title: 'Regulars', text: () => 'Some customers have a name tag: regulars. They remember how you treated them. Rip them off and they come back angry; be fair and they bring better stuff.', when: () => G.world === 'shop' && G.customers.some(c => c.reg) },
  detective: { group: 'Shop', icon: '🕵️', title: 'The detective', text: () => 'He checks your shelves and crates for stolen goods. Anything stolen gets confiscated, and you pay a fine. A good magnifier can tell you what\'s stolen.', when: () => G.world === 'shop' && G.customers.some(c => c.detective) },
  orders: { group: 'Shop', icon: '📋', title: 'Orders', text: () => 'Someone wants a specific item by a certain day (order board on the right wall). Deliver it from your stock on the computer (📋 Orders) for a big bonus.', when: () => G.orders.length > 0 && G.world === 'shop' },
  auction: { group: 'Shop', icon: '🔨', title: 'Saturday auction', text: () => 'Rare, expensive lots today. Open the computer → 🔨 Auction to bid against other dealers.', when: () => isAuctionDay() && G.auction && G.phase !== 'evening' && G.world === 'shop' },
  stand: { group: 'Shop', icon: '🥚', title: 'The egg stand', text: () => `People ring the bell at the window to the right of the shop window. ${kb('interact')} on the window to sell them eggs.`, when: () => G.up.stand },
  coop: { group: 'Shop', icon: '🐔', title: 'Chickens', text: () => `They lay eggs in the yard: ${kb('interact')} to collect. A dirty pen (mop it) means fewer eggs.`, when: () => G.up.coop },
  workshop: { group: 'Shop', icon: '🛠️', title: 'Workshop', text: () => `Go through the door at the back right. ${kb('interact')} on the bench repairs broken items (stop the needle in the green).`, when: () => G.up.workshop },
  register2: { group: 'Shop', icon: '🧾', title: 'Second register', text: () => 'Customers pick the shorter queue. Two cashiers handle rush hours (12–1 and 4–5) much better.', when: () => G.up.register2 },
  decor: { group: 'Shop', icon: '🪴', title: 'Decorations', text: () => 'Each one makes trust grow faster, and a nicer shop pulls in a few more customers.', when: () => G.decor.length > 0 },
  counterRadio: { group: 'Shop', icon: '📻', title: 'The counter radio', text: () => `${kb('interact')} on the radio by the register changes the station or turns it off. Customers like music: trust grows a bit faster.`, when: () => G.world === 'shop' && G.day >= 2 },
  // ---------- night ----------
  night: { group: 'Night', icon: '🛻', title: 'Your first night out', text: () => `Fill your bag, then press ${kb('interact')} at the truck bed to dump it: loot in the truck is safe. Get in the cab (${kb('interact')} at the door) to leave. ${kb('crouch')} crouches (quieter).`, when: () => G.world === 'exp' },
  voice: { group: 'Night', icon: '🗣️', title: 'They can hear you talk', text: () => 'At night enemies hear voice chat: talking carries a few metres, shouting much further, whispering is safe. In a hiding spot you\'re muffled, but if something is right outside, keep quiet! The light-blue ring shows how far your voice goes.', when: () => G.world === 'exp' && S.voiceNoise && Object.keys(G.players).length > 1 },
  noise: { group: 'Night', icon: '🔊', title: 'Noise', text: () => 'Rings show noise you make: running, dragging, shooting, prying. The meter under your bag shows how loud you are right now.', when: () => G.world === 'exp' && seen.has('night') },
  hide: { group: 'Night', icon: '🫥', title: 'Hiding spots', text: () => `${kb('interact')} on a dumpster, wreck or porta-potty to hide. Enemies lose you unless they saw you get in. Dogs can sniff you out.`, when: null },
  big: { group: 'Night', icon: '🏍️', title: 'Big objects', text: () => `${kb('interact')} to carry (with a friend it's quick; alone it's slow and loud) and load it at the truck bed. Or take it apart with tools: ${kb('dismantle')}.`, when: null },
  safe: { group: 'Night', icon: '🗝️', title: 'Rusty\'s safe', text: () => `${kb('interact')} starts cracking it. Stay close. It's loud, and it takes a while (faster with a crowbar).`, when: null },
  down: { group: 'Night', icon: '🩸', title: 'You\'re down', text: () => `You have 30 seconds. A teammate can get you up with a bandage (${kb('interact')} on you). ${kb('spectate')} watches a teammate.`, when: null },
  dead: { group: 'Night', icon: '💀', title: 'You died', text: () => `You're out for the night. Spectate with ${kb('spectate')}, play ghost roulette with ${kb('roulette')} (free), and talk to the other dead: the living can't hear you.`, when: null },
  // ---------- co-op ----------
  ping: { group: 'Co-op', icon: '📍', title: 'Pings & emotes', text: () => `${kb('ping')} marks a spot for your team. Hold ${kb('emote')} and press 1–4 to wave, point, sit or dance.`, when: () => Object.keys(G.players).length > 1 && G.mode === 'play' },
  approve: { group: 'Co-op', icon: '✅', title: 'Big purchases', text: () => `Anything over $500 needs a teammate's OK: ${kb('approve')} approves, ${kb('deny')} denies.`, when: () => !!G.pending },
};

const queue = [];
let showing = null, hideT = 0, checkT = 0;

// Show a tip now (if this player hasn't seen it). Safe to call often.
export function tip(id) {
  if (!S.tips || seen.has(id) || !TIPS[id] || queue.includes(id) || showing === id) return;
  queue.push(id);
}

export function updateTips(dt) {
  const el = document.getElementById('tip-card');
  if (!el) return;
  const quiet = G.mode !== 'play' || G.cine || (G.intro !== 'done' && G.world === 'shop');
  if ((checkT -= dt) <= 0 && !quiet) {
    checkT = 0.5;
    for (const [id, t] of Object.entries(TIPS)) if (t.when && !seen.has(id) && !queue.includes(id) && showing !== id) { try { if (t.when()) tip(id); } catch { /* not ready yet */ } }
  }
  if (showing && (hideT -= dt) <= 0) { el.classList.add('out'); showing = null; }
  if (!showing && queue.length && !quiet && (hideT -= dt) <= -0.6) {
    const id = queue.shift(), t = TIPS[id];
    seen.add(id); remember();
    el.innerHTML = `<span class="tip-icon">${t.icon}</span><div><small>NEW · ${t.group}</small><b>${t.title}</b><p>${t.text()}</p></div><button class="tip-x" title="Close">✕</button>`;
    el.querySelector('.tip-x').onclick = () => { hideT = 0; };
    el.classList.remove('hidden', 'out'); void el.offsetWidth;
    showing = id; hideT = Math.max(7, t.text().length / 18);
    sfx.ping();
  }
}

export const resetTips = () => { seen.clear(); remember(); };
export const tipSeen = id => seen.has(id);
