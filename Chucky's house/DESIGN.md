# Chucky's House — Design Doc

First-person co-op pawn shop sim + scavenging expeditions. HTML/CSS/JS + Three.js.
Read this first in every session instead of re-explaining the game.

## Rules (from the owner)
- Plain HTML, CSS, JS (Three.js for 3D). Split code into small files (shop.js, expedition.js, net.js, ui.js, ...).
- Never write game files to C:. Project lives in `E:\tomovy hry\HTML hry\Banger\Prototypes\Games web page\Chucky's house`
  (moved there 2026-11-02; the Games web page folder goes on GitHub, and its index.html lists this game: keep the
  card + changelog there up to date).
- Browser storage (localStorage/IndexedDB) for saves is OK.
- Test in **Firefox** only. Never Edge unless told. (Only test when the owner asks.)
- The owner writes in Czech; all in-game text is English.
- Keep the name "Chucky's House".

## Story / Intro
Opening cutscene: player goes bankrupt, takes a loan to buy a pawn shop. Main goal = pay off the loan. Loan grows slowly (interest).

## Loan & failure
- Two ways to pay: **weekly installments** (quota) OR **pay off the full amount early**.
- Missed payments, strikes:
  1. IRS takes some stuff (items/money).
  2. IRS takes a lot of stuff.
  3. Game over: cutscene of the player(s) in prison.
- (The bank gives 2 chances; the IRS enforces them.)

## Players / Networking
- Singleplayer or co-op up to 4.
- Both connection modes, switchable in the Co-op menu:
  - **PeerJS** (easy, uses the public PeerJS server).
  - **Direct code** (no server, works over Tailscale): compressed WebRTC SDP as a long code, e.g. `PB1...` (prefix + base64 of deflated SDP). Two-way swap: host code → joiner pastes → joiner's reply code → host pastes.
- Proximity voice chat (WebRTC audio + Web Audio PannerNode); far players can't be heard. Dead players can spectate.

## Day loop: the shop
- Each day starts in the shop.
- Buy shelf upgrades; move shelves and other furniture with **F** (layout editing).
- **Computer**: buy expedition gear; look up found items → market price (prices change daily); set your own shop price.
- All players press a button to **open the store**, then customers come.
- **Register** (1 player): sell to customers with bargaining. Customers also come to **sell** items (bargain too).
- **Bargaining**: customer patience meter + mood (desperate / greedy / clueless). Push too hard and they leave.
- **Fake & stolen items**: customers may bring fakes; check them with tools bought on the computer (magnifier, UV light...). Stolen goods are cheap, but the police may come.
- **Chores** (other players): pick up trash into the bin; full bin → empty into the dumpster out back; help customers; restock; chase shoplifters; repair broken items to sell higher.
- Roulette wheel / small minigames in the shop as a money sink (later phase).

## Night loop: expeditions
- Pick a location; more unlock with level. Each has its own enemies, loot table, rarity, layout. Start with 2 good ones:
  - **Back Alley**: homeless people.
  - **Abandoned Reactor**: mutated rats.
- Dark, scary atmosphere; flashlights with batteries (bought) are the main light.
- Random **start-of-round event**, shown to everyone: Daytime, Angrier enemies, Thick fog, etc.
- Gear: baseball bat, mine, bear trap, flashlight, batteries, bandage, more.
- Carry weight/slot limit; timer + extraction point.
- **Death**: drop carried loot (others can risk grabbing it); spectate. Revive with a **bandage** (expensive, bought in shop) used on the body, or free revive after the expedition.
- Minigame area for dead/waiting players (low priority).

## Graphics & settings
- **Low poly, sharp/clean by default**, but models must **look good** (careful shapes, good colors, lighting).
- Optional PS1 filter (pixelation / vertex wobble) toggle in settings.
- Quality presets: Low / Medium / High (resolution scale, shadows, fog distance, light count).
- Brightness slider clamped to a narrow range; darkness/fog events ignore brightness so it is never "OP" on low settings.

## Build phases
1. Single-player shop: movement, shelves + F move, computer, pricing, customers, bargaining, trash.
2. One expedition (Back Alley): loot, enemies, extraction, death/bandage.
3. Multiplayer (PeerJS + direct code).
4. Proximity voice, events, more locations, fakes/police, minigames, IRS/prison cutscenes.

## v0.6 design (owner's notes, 2026-11-02, translated from Czech; game text stays English)
- **Only two maps for now**: Back Alley (homeless + rat packs) and Junkyard (one old man with an old
  shotgun, 2–4 dogs by difficulty, hiding spots, big map). Later ideas: Store 2.5 💀, Military base 5 💀.
- **Skull difficulty rolled every day** inside a range so players don't farm the easy map:
  Back Alley 0.5–2, Junkyard 1–3 (half skulls). Skulls scale enemy count/hp/damage/speed/senses, loot quality,
  and make stuns shorter.
- **Weapons** (expensive, computer → Weapons): the weapon TYPE decides: baton / pepper spray / taser STUN,
  bat / revolver / shotgun KILL. Guns need a **gun permit** (also needed to buy/sell weapons from customers or on shelves).
- **Tools** (expensive, computer → Tools & Gear): flashlight, batteries, walkie-talkie, screwdriver, wrench, crowbar, bandage, traps, mines.
- **Big objects** (motorbike, generator, arcade cabinet, AC unit): take apart with tools (minigame: hold on screws,
  click bolts 4×), carry with 2 players, or (owner's choice) **drag slowly alone, which is loud**.
- **Pickup truck** replaces the van: dump your bag into the bed (physics, items stay); bed cargo always gets home.
  Get in the cab to leave; the truck goes when every standing player is in it, or when time runs out.
- **Falling-item physics** (js/physics.js): thrown/dropped items fall, bounce and stay (shop floor is saved).
- **Workshop** (back room, bought): repair broken items (needle minigame) → higher condition.
- **Chicken coop** (bought, more hens buyable): eggs; the first collected egg unlocks the **food stand window**
  (egg stand hatch in the front wall) where street people buy eggs.
- **Daily prices**: every item has a range (e.g. coin $8–12), rolled each morning, shown on the price tag and in Market.
  Each item instance also has a hidden condition `q` (+ broken / fake flags).
- **Magnifier** (3 tiers) estimates an item's worth (±35/15/5 %) and spots fakes (40/75/100 %).
- **Trust** 0 → +100 %: customers pay up to that much more. Grows slowly with fair sales, angry customers lower it.
  (Decorations will raise it a lot later. NOT added yet on purpose.)
- Customers may offer less than the tag; accept or haggle.
- **Register checkout minigame on every sale** (Supermarket-Simulator style): scan barcode → card (type the amount)
  or cash (count change from the drawer). Quick + correct = tip.
- **Auction every Saturday** (Day 6, 13, …): 4 rare lots, live bidding against NPC dealers on the computer.
- **Front door** opens/closes (E). Closed = no new customers.
- **Big purchases (≥ $500) need a second player's approval** in co-op (Y / N). Solo: a confirm dialog.
- **Mic is requested on startup.** Voice: proximity (HRTF), walkie-talkie on B (radio filter + squelch, any distance),
  muffled when the speaker is low HP / down, and when YOU are low HP / down / hiding.
- **Graphics**: "realistic low poly", nice characters (knees, elbows, faces, hands). Very detailed settings:
  preset + resolution scale, view distance, shadows + shadow distance, dynamic light count, city detail,
  NPC detail, fog, texture filtering, AA, pixel filter, brightness, FOV, FPS cap, FPS counter.
- **City outside the shop**: only visible (window, door, over the yard fence), never walkable. Day/night lighting.
- Improved main menu and CHUCK-OS desktop UI (apps: Market, My Stock, Supplier, Tools, Weapons, Upgrades, Auction, Bank, Stats).

## Code map (v0.6)
state (G, ACTIONS, rng) · data (65 items, instances) · economy (prices, trust, auction, loan, skull ranges) ·
settings · sfx · people / creatures (models) · world (shop, yard, workshop, hatch) · city (street view) ·
shelves · trash · physics · customers (+ bargaining) · register (checkout) · shop (catalogue + shop actions) ·
chickens · computer (CHUCK-OS) · minigames · maps (alley/junkyard gen) · enemies (AI) · expedition ·
net (PeerJS + direct codes, RPC) · voice · coop (lobby, sync, avatars, chat, approvals) · ui · main.
**Co-op model:** every change to shared state is an `ACTIONS.x(pid, …)` run on the host via `act()`;
the host broadcasts shop snapshots (`ss`, ~7/s) and expedition snapshots (`xs`, 10/s). Expedition maps,
loot and enemy spawns come from a shared seed, so guests only mirror positions.
**Tailscale note:** the game must be served over HTTP(S) to the other player; the mic (and real IPs in direct
codes) need a secure context or `localhost` — `tailscale serve` gives HTTPS.

## Progress log
- 2026-10-29: Design finalized, folder created.
- 2026-10-29: Phase 1 slice written (untested): index.html, style.css, js/{state,ui,data,customers,main}.js.
  Walkable shop, 4 movable shelves (F/R), 10 low-poly items, E = set price / buy random stock,
  O = open store, customers browse → queue at register → bargain panel (patience, moods). localStorage save.
- 2026-10-29: Phase 1 complete (v0.2, untested). Files: js/{state,settings,sfx,data,world,shelves,trash,economy,customers,computer,ui,main}.js.
  Main menu (3D orbit background), intro cutscene, pause, settings (quality/brightness clamp 0.8-1.25/FOV/sens/volume/pixel filter), controls.
  Day clock 9-18 (DAY_LEN 300s), summary screen. Loan $8000, 0.8%/day interest, $600/week installment; strikes → IRS seizes 25%/60% → prison.
  Computer (CHUCK-OS): Market lookup (daily prices ±15%), Supplier (4 deals/day), Furniture (wood shelf, glass case +20%, bigger bin), Gear (locked), Bank.
  Customers: buyers + sellers (30%), 5 moods, patience, queue timeout, drop trash; trash → bin → bag → dumpster in back yard.
  Price tags on shelves, Q = item back to stock, backstock placement. 13 items. Synth SFX.
- 2026-10-29: v0.3 (untested). New game = 1 empty shelf, no stock, $400.
  people.js: detailed low-poly people (faces, hair styles, hats, beards, jackets, arm swing); ragged variant for homeless.
  Nicer shelf/counter/register models.
  Phase 2: day flow prep → open → closing → summary → EVENING (buy gear, O = night panel) → expedition or sleep → next day prep.
  expedition.js: Back Alley = random maze (21x21 tiles of 3.2 m), lit-window buildings, dumpsters/bags/crates/lamps, 3 fire-barrel camps.
  Events: Quiet Night / Daytime / Angrier / Thick Fog / Blackout. 6-min timer, van extraction (E), 6-slot bag.
  Enemies: homeless (wander → chase with LOS/hearing (running = louder), BFS pathing, melee). Fists/bat (LMB), bear trap, landmine, bandage (+50 HP), flashlight with batteries.
  Death or missing the van = lose carried loot, free revive at the shop. Level/XP (sales + loot); Reactor locked at Lv 3.
  Next: Phase 3 multiplayer (PeerJS + direct code), Abandoned Reactor.
- 2026-11-02: v0.6 (big pass, **untested: the owner asked for no browser test this round**). Built on v0.3 in THIS
  folder (the `HTML hry\Copy\Chucky's house` folder is an abandoned branch, ignore it). Abandoned Reactor removed,
  Junkyard added. Everything in "v0.6 design" above was implemented. Save key is now `chuckys_house_save_v6`
  (old saves ignored). Only static checks were done (every named import resolves); first open is the first real test.
  Things to check first: shop boots + city renders, register checkout, throwing items, expedition start (both maps),
  truck bed dumping, co-op lobby in both modes, voice.
