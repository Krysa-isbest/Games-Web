'use strict';
// Global namespace, data tables (items, recipes, shop, upgrades, rush events), helpers and synthesized audio.
// Modules: CF.World (scene + kitchen), CF.Models (meshes), CF.Phys (cannon, host only), CF.Items (all objects),
// CF.Cook (heat, fire), CF.Stations (knobs, oven, sink...), CF.Orders (shift, money, events), CF.MG (minigames),
// CF.Player (local chef), CF.Net (PeerJS), CF.Sync (authority + replication), CF.UI (DOM), CF.Game (boot + loop).
const CF = window.CF = {};

CF.VERSION = '1.4';
CF.rand = (a, b) => a + Math.random() * (b - a);
CF.randi = (a, b) => Math.floor(CF.rand(a, b + 1));
CF.choice = arr => arr[Math.floor(Math.random() * arr.length)];
CF.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
CF.lerp = (a, b, t) => a + (b - a) * t;
CF.damp = (a, b, k, dt) => CF.lerp(a, b, 1 - Math.exp(-k * dt));
CF.r3 = v => Math.round(v * 1000) / 1000;
CF.$ = s => document.querySelector(s);
CF.$$ = s => Array.from(document.querySelectorAll(s));
CF.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
CF.fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
CF.money = v => '$' + Math.round(v);

CF.HAT_COLORS = ['#ff5a5f', '#3fa7ff', '#46d17a', '#ffc93c', '#b77dff', '#ff8fd0'];

// ---------- Settings ----------
// Graphics: gfx = quality preset (low/medium/high/ultra/custom), scale = render resolution,
// shadowQ = shadow resolution off/low/medium/high (1024/2048/4096), soft = soft shadow edges, lights = lamp lights off/on/all,
// reflect = reflections off/low/high, ao = fake ambient shading, aniso = texture filtering, particles = low/high,
// fireLights = fire lights up the room, aa = anti-aliasing (after reload)
// Not in presets: bright = exposure, fpsCap = frame limit (0 = none), fps = FPS counter, bob = head bob
// Audio: vol = sound effects, musicSrc = builtin / mine (the music folder) / off, music = built-in music volume,
// myMusic = volume of your own songs. tutorial = show the first-day tutorial objectives
CF.GFX_PRESETS = {
    low: { scale: 0.75, shadowQ: 'off', soft: false, lights: 'off', reflect: 'off', ao: false, aniso: 1, particles: 'low', fireLights: false, aa: false },
    medium: { scale: 1, shadowQ: 'low', soft: false, lights: 'off', reflect: 'low', ao: true, aniso: 4, particles: 'high', fireLights: true, aa: true },
    high: { scale: 1, shadowQ: 'medium', soft: true, lights: 'on', reflect: 'high', ao: true, aniso: 8, particles: 'high', fireLights: true, aa: true },
    ultra: { scale: 1.25, shadowQ: 'high', soft: true, lights: 'all', reflect: 'high', ao: true, aniso: 16, particles: 'high', fireLights: true, aa: true }
};
CF.GFX_KEYS = Object.keys(CF.GFX_PRESETS.high);
CF.settings = (() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('cf-settings')) || {}; } catch (e) {}
    const s = Object.assign({
        name: 'Chef ' + CF.randi(10, 99), color: CF.randi(0, 5), sens: 1, fov: 75, vol: 0.7, music: 0.4, invertY: false,
        gfx: 'high', bright: 1, fps: false, bob: true, fpsCap: 0, musicSrc: 'mine', myMusic: 0.6, tutorial: true
    }, CF.GFX_PRESETS.high, saved);
    delete s.role;      // v1.3: no more Cook / Waiter roles
    // settings saved before v1.2.1: re-apply the chosen preset, or translate the old shadow levels of a custom setup
    if (!saved.v) {
        if (saved.shadows === false && saved.shadowQ === undefined) { s.shadowQ = 'off'; s.gfx = 'custom'; }
        if (CF.GFX_PRESETS[s.gfx]) Object.assign(s, CF.GFX_PRESETS[s.gfx]);
        else if (saved.shadowQ) {
            s.soft = saved.shadowQ === 'high' || saved.shadowQ === 'ultra';
            s.shadowQ = { ultra: 'high', high: 'medium', medium: 'medium', low: 'low', off: 'off' }[saved.shadowQ] || 'medium';
        }
    }
    // v3: the songs in the music folder are the default music now (the built-in tunes play while there are none)
    if ((saved.v || 0) < 3 && s.musicSrc === 'builtin') s.musicSrc = 'mine';
    s.v = 3;
    delete s.shadows;
    return s;
})();
CF.saveSettings = () => { try { localStorage.setItem('cf-settings', JSON.stringify(CF.settings)); } catch (e) {} };

// ---------- Items ----------
// shape: physics collider. h: height when stacked on a plate. cook: t = seconds to reach 1.0 at heat 1.
// cook colors: raw -> done -> burnt. chop: what the cutting board turns it into. cont: container rules.
const COOK = (t, raw, done, burnt, extra) => Object.assign({ t, raw, done, burnt: burnt || 0x2a1a12, burn: 1.35 }, extra || {});
CF.ITEMS = {
    tomato:        { name: 'Tomato',         icon: '🍅', food: true, shape: { t: 'sphere', r: 0.045 }, mass: 0.15, h: 0.08, chop: { to: 'tomato_slice', n: 4 }, cook: COOK(30, 0xe8392b, 0xb8331f) },
    tomato_slice:  { name: 'Tomato Slice',   icon: '🍅', food: true, shape: { t: 'box', s: [0.085, 0.03, 0.085] }, mass: 0.03, h: 0.012, cook: COOK(25, 0xff5340, 0xc2402a) },
    onion:         { name: 'Onion',          icon: '🧅', food: true, shape: { t: 'sphere', r: 0.042 }, mass: 0.12, h: 0.08, chop: { to: 'onion_ring', n: 4 }, cook: COOK(35, 0xd9a35b, 0xa8692e) },
    onion_ring:    { name: 'Onion Rings',    icon: '🧅', food: true, shape: { t: 'box', s: [0.08, 0.03, 0.08] }, mass: 0.02, h: 0.01, cook: COOK(22, 0xf3e7d0, 0xc99449) },
    lettuce:       { name: 'Lettuce',        icon: '🥬', food: true, shape: { t: 'sphere', r: 0.07 }, mass: 0.3, h: 0.12, chop: { to: 'lettuce_leaf', n: 4 }, cook: COOK(18, 0x7fcf4a, 0x6b7d2a) },
    lettuce_leaf:  { name: 'Lettuce Leaf',   icon: '🥬', food: true, shape: { t: 'box', s: [0.11, 0.03, 0.1] }, mass: 0.02, h: 0.012, cook: COOK(14, 0x8fe05a, 0x6b7d2a) },
    potato:        { name: 'Potato',         icon: '🥔', food: true, shape: { t: 'sphere', r: 0.045 }, mass: 0.2, h: 0.08, chop: { to: 'fries', n: 1 }, cook: COOK(60, 0xc49a5a, 0x9c6a32) },
    fries:         { name: 'Fries',          icon: '🍟', food: true, shape: { t: 'box', s: [0.12, 0.05, 0.1] }, mass: 0.1, h: 0.04, cook: COOK(22, 0xf2deaa, 0xe8a63a, 0x3a2412) },
    cheese:        { name: 'Cheese Block',   icon: '🧀', food: true, shape: { t: 'box', s: [0.1, 0.07, 0.08] }, mass: 0.25, h: 0.07, chop: { to: 'cheese_slice', n: 4 }, cook: COOK(40, 0xffd34a, 0xffb52e) },
    cheese_slice:  { name: 'Cheese Slice',   icon: '🧀', food: true, shape: { t: 'box', s: [0.09, 0.03, 0.09] }, mass: 0.02, h: 0.008, cook: COOK(16, 0xffd84f, 0xf7a21f) },
    bun:           { name: 'Bun',            icon: '🍞', food: true, shape: { t: 'sphere', r: 0.055 }, mass: 0.1, h: 0.09, chop: { to: ['bun_bottom', 'bun_top'] }, cook: COOK(40, 0xe0a85a, 0xa8642a) },
    bun_bottom:    { name: 'Bottom Bun',     icon: '🍞', food: true, shape: { t: 'box', s: [0.11, 0.035, 0.11] }, mass: 0.04, h: 0.03, cook: COOK(25, 0xf2d49b, 0xc98d48) },
    bun_top:       { name: 'Top Bun',        icon: '🍞', food: true, shape: { t: 'box', s: [0.11, 0.05, 0.11] }, mass: 0.05, h: 0.05, cook: COOK(30, 0xe0a85a, 0xa8642a) },
    patty:         { name: 'Beef Patty',     icon: '🥩', food: true, shape: { t: 'box', s: [0.1, 0.03, 0.1] }, mass: 0.15, h: 0.025, sides: true, cook: COOK(38, 0xd9545c, 0x6b3a22, 0x1c120c) },
    steak:         { name: 'Steak',          icon: '🥩', food: true, shape: { t: 'box', s: [0.16, 0.035, 0.11] }, mass: 0.3, h: 0.03, sides: true, cook: COOK(50, 0xc93b47, 0x7a4026, 0x1c120c) },
    dough:         { name: 'Dough Ball',     icon: '🫓', food: true, shape: { t: 'sphere', r: 0.055 }, mass: 0.25, h: 0.09, flatten: 'pizza_base', cook: COOK(60, 0xf1dfb6, 0xd6a35a) },
    pizza_base:    { name: 'Pizza',          icon: '🍕', food: true, shape: { t: 'box', s: [0.26, 0.03, 0.26] }, mass: 0.3, h: 0.02, cook: COOK(45, 0xf3e2bd, 0xd9953f, 0x2a1a12, { burn: 1.4 }),
                     cont: { cap: 10, acc: ['tomato_slice', 'cheese_slice', 'salami_slice', 'mushroom_slice', 'onion_ring'], layout: 'top', heat: 1 } },
    salami:        { name: 'Salami',         icon: '🌭', food: true, shape: { t: 'box', s: [0.14, 0.045, 0.045] }, mass: 0.15, h: 0.045, chop: { to: 'salami_slice', n: 4 }, cook: COOK(40, 0xb53a3a, 0x8a2a22) },
    salami_slice:  { name: 'Salami Slice',   icon: '🌭', food: true, shape: { t: 'box', s: [0.06, 0.03, 0.06] }, mass: 0.01, h: 0.006, cook: COOK(22, 0xc4474a, 0x8a2a22) },
    mushroom:      { name: 'Mushroom',       icon: '🍄', food: true, shape: { t: 'sphere', r: 0.035 }, mass: 0.05, h: 0.06, chop: { to: 'mushroom_slice', n: 3 }, cook: COOK(30, 0xeadfcf, 0xa8805a) },
    mushroom_slice:{ name: 'Mushroom Slice', icon: '🍄', food: true, shape: { t: 'box', s: [0.06, 0.03, 0.05] }, mass: 0.01, h: 0.008, cook: COOK(20, 0xefe5d6, 0xa8805a) },
    soup:          { name: 'Tomato Soup',    icon: '🥣', food: true, liquid: true, shape: { t: 'box', s: [0.12, 0.04, 0.12] }, mass: 0.2, h: 0.03, cook: COOK(1, 0xd8432c, 0xc23a22) },
    charcoal:      { name: 'Charred Mess',   icon: '⚫', food: true, shape: { t: 'box', s: [0.08, 0.04, 0.08] }, mass: 0.05, h: 0.03, cook: COOK(1e9, 0x1c1410, 0x1c1410) },

    plate:   { name: 'Plate',       icon: '🍽️', dish: true, fragile: true, shape: { t: 'box', s: [0.26, 0.03, 0.26] }, mass: 0.4, cont: { cap: 8, acc: 'food', layout: 'stack' } },
    bowl:    { name: 'Bowl',        icon: '🥣', dish: true, fragile: true, shape: { t: 'box', s: [0.18, 0.08, 0.18] }, mass: 0.3, cont: { cap: 6, acc: 'food', layout: 'pile' } },
    pan:     { name: 'Frying Pan',  icon: '🍳', shape: { t: 'box', s: [0.28, 0.05, 0.28] }, mass: 1.2, handle: true, cont: { cap: 2, acc: 'food', layout: 'pan', heat: 1 } },
    pot:     { name: 'Soup Pot',    icon: '🍲', shape: { t: 'box', s: [0.28, 0.22, 0.28] }, mass: 1.8, cont: { cap: 6, acc: ['tomato', 'tomato_slice', 'onion', 'onion_ring'], layout: 'pot', heat: 1 } },
    basket:  { name: 'Fryer Basket',icon: '🧺', shape: { t: 'box', s: [0.2, 0.1, 0.2] }, mass: 0.5, handle: true, cont: { cap: 3, acc: 'food', layout: 'pile', heat: 1 } },
    salt:    { name: 'Salt Shaker',   icon: '🧂', tool: 'salt',   shape: { t: 'box', s: [0.05, 0.11, 0.05] }, mass: 0.15 },
    pepper:  { name: 'Pepper Shaker', icon: '🌶️', tool: 'pepper', shape: { t: 'box', s: [0.05, 0.11, 0.05] }, mass: 0.15 },
    ext:     { name: 'Fire Extinguisher', icon: '🧯', tool: 'ext', shape: { t: 'box', s: [0.16, 0.48, 0.16] }, mass: 3 },
    crate:   { name: 'Delivery Crate', icon: '📦', shape: { t: 'box', s: [0.5, 0.34, 0.4] }, mass: 4 },
    // carries up to 4 plates / bowls (clean or dirty); E on a guest serves them the best match from it
    tray:    { name: 'Serving Tray', icon: '🍱', shape: { t: 'box', s: [0.6, 0.03, 0.44] }, mass: 0.8, cont: { cap: 4, acc: ['plate', 'bowl'], layout: 'tray' } }
};
for (const k in CF.ITEMS) CF.ITEMS[k].key = k;
// "tomatoes", "beef patties"... for messages
CF.plural = type => {
    const n = CF.ITEMS[type].name.toLowerCase();
    return { tomato: 'tomatoes', potato: 'potatoes', lettuce: 'lettuce', patty: 'beef patties' }[type] || n + 's';
};

// What a raw ingredient becomes when it is chopped or flattened, for the recipe book
CF.PIECES = { tomato: 'tomato_slice', onion: 'onion_ring', lettuce: 'lettuce_leaf', potato: 'fries', cheese: 'cheese_slice', salami: 'salami_slice', mushroom: 'mushroom_slice' };

CF.doneLabel = (c, def) => {
    if (def && def.key === 'charcoal') return 'Charred';
    if (c < 0.12) return 'Raw';
    if (c < 0.45) return 'Undercooked';
    if (c < 0.6) return 'Rare';
    if (c < 0.75) return 'Medium';
    if (c < 0.95) return 'Well done';
    if (c < 1.15) return 'Overcooked';
    return 'Burnt';
};

// ---------- Recipes ----------
// need: components (nested contents are flattened). cook/salt/pepper are ideal ranges. raw: must not be cooked.
CF.RECIPES = {
    burger: {
        name: 'Frenzy Burger', icon: '🍔', dish: 'plate', price: 18, time: 210, start: true,
        need: [{ t: 'bun_bottom' }, { t: 'patty', cook: [0.6, 0.95], salt: [0.5, 1.5] }, { t: 'cheese_slice' }, { t: 'lettuce_leaf', raw: true }, { t: 'tomato_slice', raw: true }, { t: 'bun_top' }],
        vars: [
            { id: 'classic', label: 'Classic' },
            { id: 'nocheese', label: 'No cheese', drop: 'cheese_slice' },
            { id: 'onion', label: '+ Onion rings', add: { t: 'onion_ring' }, price: 2 },
            { id: 'double', label: 'Double patty', add: { t: 'patty', cook: [0.6, 0.95] }, price: 6 }
        ],
        steps: ['Cut a bun in half on a cutting board', 'Cut tomato, lettuce and cheese', 'Fry a patty in a pan, flip it to cook both sides', 'Salt the patty', 'Stack everything on a plate: bun bottom first, bun top last']
    },
    salad: {
        name: 'Crunch Salad', icon: '🥗', dish: 'bowl', price: 13, time: 160, start: true,
        need: [{ t: 'lettuce_leaf', n: 2, raw: true, salt: [0.3, 1.3] }, { t: 'tomato_slice', n: 2, raw: true }, { t: 'onion_ring', raw: true }],
        vars: [{ id: 'classic', label: 'House' }, { id: 'cheesy', label: '+ Cheese', add: { t: 'cheese_slice', raw: true }, price: 2 }],
        steps: ['Cut lettuce, tomatoes and an onion', 'Put 2 lettuce, 2 tomato slices and onion rings in a bowl', 'Season the bowl with a little salt', 'Nothing in a salad should be cooked']
    },
    steak: {
        name: 'Steak & Fries', icon: '🥩', dish: 'plate', price: 32, time: 250, cost: 140,
        need: [{ t: 'steak', cook: [0.6, 0.75], salt: [0.5, 1.5], pepper: [0.4, 1.5] }, { t: 'fries', cook: [0.6, 0.95], salt: [0.3, 1.4] }],
        vars: [
            { id: 'rare', label: 'Rare', cook: [0.45, 0.6] },
            { id: 'medium', label: 'Medium', cook: [0.6, 0.75] },
            { id: 'well', label: 'Well done', cook: [0.75, 0.95] }
        ],
        steps: ['Season the steak with salt AND pepper', 'Fry it in a pan, flip it, hit the doneness the customer asked for', 'Cut a potato into fries', 'Fry them in the fryer basket until golden, then salt them', 'Plate the steak and fries together']
    },
    soup: {
        name: 'Red Storm Soup', icon: '🍲', dish: 'bowl', price: 17, time: 230, cost: 120,
        need: [{ t: 'soup', cook: [0.7, 1.1], salt: [0.5, 1.4] }],
        vars: [{ id: 'classic', label: 'Classic' }],
        steps: ['Fill a pot with water at the sink', 'Add 3 cut tomatoes and 1 cut onion', 'Boil it on a burner and STIR it so it doesn\'t catch', 'Salt the pot', 'Hold an empty bowl and press E on the pot to ladle a portion']
    },
    pizza: {
        name: 'Lava Pizza', icon: '🍕', dish: 'plate', price: 27, time: 270, cost: 200,
        need: [{ t: 'pizza_base', cook: [0.6, 0.92] }, { t: 'tomato_slice', n: 2 }, { t: 'cheese_slice', n: 2 }],
        vars: [
            { id: 'salami', label: 'Salami', add: { t: 'salami_slice', n: 3 } },
            { id: 'funghi', label: 'Funghi', add: { t: 'mushroom_slice', n: 3 } },
            { id: 'margherita', label: 'Margherita', add: { t: 'cheese_slice' }, price: -3 }
        ],
        steps: ['Put a dough ball on a cutting board and press E to flatten it', 'Top it with tomato slices, cheese and the toppings', 'Bake it in the oven with the door CLOSED', 'Slide it onto a plate']
    }
};

// ---------- Shop ----------
CF.SHOP = [
    { cat: 'Produce', items: [['tomato', 1], ['onion', 1], ['lettuce', 2], ['potato', 1], ['mushroom', 1.5]] },
    { cat: 'Butcher & Dairy', items: [['patty', 3], ['steak', 8], ['salami', 4], ['cheese', 4]] },
    { cat: 'Bakery', items: [['bun', 1], ['dough', 2]] },
    { cat: 'Kitchenware', items: [['plate', 6], ['bowl', 5], ['tray', 8], ['pan', 25], ['pot', 30], ['basket', 20], ['salt', 4], ['pepper', 4], ['ext', 40]] }
];
CF.PRICE = {};
CF.SHOP.forEach(c => c.items.forEach(([k, p]) => { CF.PRICE[k] = p; }));

// ---------- Pantry ----------
// Every raw ingredient has its own bin: produce crates on the storage counter, bakery baskets on the shelf above,
// a chilled deli case on the coral counter. cap = how many fit, start = a new restaurant's stock,
// daily = the free morning delivery. Bought ingredients are put away into the bins (never over cap).
CF.PANTRY = {
    tomato:   { sec: 'produce', cap: 16, start: 5, daily: 2 },
    onion:    { sec: 'produce', cap: 12, start: 3, daily: 1 },
    lettuce:  { sec: 'produce', cap: 10, start: 3, daily: 1 },
    potato:   { sec: 'produce', cap: 12, start: 0, daily: 0 },
    mushroom: { sec: 'produce', cap: 12, start: 0, daily: 0 },
    bun:      { sec: 'bakery',  cap: 16, start: 5, daily: 2 },
    dough:    { sec: 'bakery',  cap: 10, start: 0, daily: 0 },
    patty:    { sec: 'deli',    cap: 16, start: 5, daily: 2 },
    steak:    { sec: 'deli',    cap: 10, start: 0, daily: 0 },
    salami:   { sec: 'deli',    cap: 8,  start: 0, daily: 0 },
    cheese:   { sec: 'deli',    cap: 8,  start: 2, daily: 1 }
};

// ---------- Upgrades (bought between shifts) ----------
CF.UPGRADES = [
    { id: 'knives',   icon: '🔪', name: 'Razor Knives',     price: 80,  desc: 'Chopping is far more forgiving.' },
    { id: 'nonstick', icon: '🍳', name: 'Non-stick Pans',   price: 80,  desc: 'Bigger sweet spot when flipping.' },
    { id: 'express',  icon: '🚚', name: 'Express Delivery', price: 100, desc: 'Orders arrive in 4 seconds instead of 12.' },
    { id: 'sprinkler',icon: '💦', name: 'Ceiling Sprinklers', price: 160, desc: 'Fire spreads half as fast and dies out on its own.' },
    { id: 'marketing',icon: '📣', name: 'Neon Billboard',   price: 120, desc: '+20% tips and slightly more customers.' },
    { id: 'patience', icon: '🪑', name: 'Comfy Chairs',     price: 90,  desc: 'Customers wait 25% longer.' },
    { id: 'prepbowls', icon: '🥣', name: 'Prep Bowls',      price: 90,  desc: 'Six fixed bowls by the cutting boards: drop cut ingredients in, take them out later. They keep overnight.' }
];
// what a prep bowl takes: cut pieces (and bun halves)
CF.CUTS = ['tomato_slice', 'onion_ring', 'lettuce_leaf', 'fries', 'cheese_slice', 'salami_slice', 'mushroom_slice', 'bun_bottom', 'bun_top'];

// ---------- Rush events (the Frenzy) ----------
CF.EVENTS = {
    critic:    { name: 'Food Critic',      icon: '🎩', col: '#ffd166', desc: 'A gold ticket! Triple pay if it scores 4 stars or more.' },
    rush:      { name: 'Lunch Rush',       icon: '🏃', col: '#ff6b6b', desc: 'Orders flood in for 45 seconds!' },
    rat:       { name: 'Rat Raid',         icon: '🐀', col: '#a0a0a0', desc: 'A rat is after your food! Hit it with something.' },
    inspector: { name: 'Health Inspector', icon: '📋', col: '#7fd8ff', desc: 'Keep the floor clean and no fires for 30 seconds.' },
    grease:    { name: 'Grease Spill',     icon: '🛢️', col: '#c9a227', desc: 'Slippery floor near the stove!' },
    blackout:  { name: 'Blackout',         icon: '🔦', col: '#6c63ff', desc: 'The lights are out! Burners still work...' }
};

// ---------- EXP and skills (progress is saved per player) ----------
// Everyone cooks AND serves: every job earns EXP and every learned skill always works.
CF.SKILL_CATS = {
    kitchen: { name: 'Kitchen skills', icon: '👨‍🍳', col: '#ff6b5b' },
    service: { name: 'Service skills', icon: '🤵', col: '#2ec4b6' }
};
CF.SKILLS = {
    kitchen: [
        { id: 'quickknife', icon: '🔪', name: 'Quick Knife',    cost: 1, desc: 'Much wider cut zones and the hand stays out of the way.' },
        { id: 'flipper',    icon: '🥞', name: 'Flip Master',    cost: 1, desc: 'Flip sweet spot is 50% bigger.' },
        { id: 'nose',       icon: '👃', name: "Chef's Nose",    cost: 1, desc: 'See exact doneness % and seasoning when looking at food.' },
        { id: 'stirpro',    icon: '🥄', name: 'Smooth Stirrer', cost: 1, desc: 'Stirring fills twice as fast.' },
        { id: 'scrubber',   icon: '🧽', name: 'Dish Wizard',    cost: 1, desc: 'Scrub plates clean twice as fast.' },
        { id: 'mise',       icon: '🧠', name: 'Mise en Place',  cost: 2, desc: 'Chopping gives one extra piece.' },
        { id: 'fireproof',  icon: '🧯', name: 'Firefighter',    cost: 2, desc: 'Extinguisher is twice as strong and fire never makes you drop things.' }
    ],
    service: [
        { id: 'sprinter', icon: '👟', name: 'Sprinter',      cost: 1, desc: '+20% movement speed.' },
        { id: 'charmer',  icon: '😊', name: 'Charmer',       cost: 1, desc: '+30% tips on dishes you carry to the table yourself.' },
        { id: 'greeter',  icon: '👋', name: 'Warm Welcome',  cost: 1, desc: 'Greeted guests wait 40% longer (instead of 20%).' },
        { id: 'busser',   icon: '🧺', name: 'Busser',        cost: 1, desc: '+$4 for every table you clear.' },
        { id: 'eagle',    icon: '🦅', name: 'Eagle Eye',     cost: 1, desc: 'Matching table numbers glow over the plates on the pass.' },
        { id: 'steady',   icon: '🍽️', name: 'Steady Hands',  cost: 2, desc: 'Plates you carry never break.' },
        { id: 'upsell',   icon: '💬', name: 'Upseller',      cost: 2, desc: 'Guests you greet often order a drink: +$5 on their bill.' }
    ]
};
CF.SKILL = {};
for (const r in CF.SKILLS) CF.SKILLS[r].forEach(s => { s.cat = r; CF.SKILL[s.id] = s; });
CF.xpNeed = lvl => 60 + lvl * 40;   // EXP to go from lvl to lvl+1

CF.Profile = {
    // tutDone = finished the first-day tutorial
    data: Object.assign({ xp: 0, skills: [], days: 0, best: 0, tutDone: false }, (() => { try { return JSON.parse(localStorage.getItem('cf-profile')) || {}; } catch (e) { return {}; } })()),
    save() { try { localStorage.setItem('cf-profile', JSON.stringify(this.data)); } catch (e) {} },
    level() { let l = 1, xp = this.data.xp; while (xp >= CF.xpNeed(l)) { xp -= CF.xpNeed(l); l++; } return l; },
    progress() { let l = 1, xp = this.data.xp; while (xp >= CF.xpNeed(l)) { xp -= CF.xpNeed(l); l++; } return { level: l, into: xp, need: CF.xpNeed(l) }; },
    spent() { return this.data.skills.reduce((a, id) => a + (CF.SKILL[id] ? CF.SKILL[id].cost : 0), 0); },
    points() { return this.level() - 1 - this.spent(); },
    has(id) { return this.data.skills.includes(id); },
    buy(id) {
        const s = CF.SKILL[id];
        if (!s || this.has(id) || this.points() < s.cost) return false;
        this.data.skills.push(id); this.save(); return true;
    },
    reset() { this.data.skills = []; this.save(); },
    // returns true when this gain crossed a level
    gain(xp) { const before = this.level(); this.data.xp += Math.round(xp); this.save(); return this.level() > before; }
};

// ---------- Audio (all synthesized) ----------
CF.Audio = {
    ctx: null, master: null, noiseBuf: null, loops: {}, listener: null,

    init() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        try {
            const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.master = ctx.createGain();
            this.master.gain.value = CF.settings.vol;
            this.master.connect(ctx.destination);
            const len = ctx.sampleRate * 2;
            this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            // real recordings from music/SFX replace the synthesized loops (the noise stays as the fallback)
            const sizzle = this.loadSample('music/SFX/Sizzling.mp3');
            this.sampleFor = { sizzle: [sizzle, 1, 1.15], fry: [sizzle, 0.82, 1.0] };     // [buffer promise, playback rate, gain]
        } catch (e) { this.ctx = null; }
    },
    samples: {}, sampleFor: {},
    loadSample(url) {
        if (this.samples[url]) return this.samples[url];
        const p = this.samples[url] = { buf: null };
        fetch(url).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(a => new Promise((res, rej) => this.ctx.decodeAudioData(a, res, rej)))
            .then(buf => {
                p.buf = buf;
                // loops already running on the noise switch to the recording
                for (const k in this.sampleFor) if (this.sampleFor[k][0] === p && this.loops[k]) { this.loops[k].stop(); delete this.loops[k]; }
            }).catch(() => {});
        return p;
    },
    setVolume(v) { if (this.master) this.master.gain.value = v; },

    tone(freq, dur, o = {}) {
        const ctx = this.ctx; if (!ctx) return;
        const t = ctx.currentTime + (o.delay || 0);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime((o.vol || 0.2) * (o.gain || 1), t + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(this.master);
        osc.start(t); osc.stop(t + dur + 0.05);
    },

    noise(dur, o = {}) {
        const ctx = this.ctx; if (!ctx) return;
        const t = ctx.currentTime + (o.delay || 0);
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
        src.playbackRate.value = o.rate || 1;
        const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
        f.frequency.setValueAtTime(o.freq || 1000, t);
        if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
        f.Q.value = o.q || 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime((o.vol || 0.3) * (o.gain || 1), t + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(this.master);
        src.start(t, Math.random()); src.stop(t + dur + 0.05);
    },

    // Distance falloff from the local camera
    att(pos) {
        if (!pos || !this.listener) return 1;
        const l = this.listener, x = (pos.x !== undefined ? pos.x : pos[0]) - l.x, y = (pos.y !== undefined ? pos.y : pos[1]) - l.y, z = (pos.z !== undefined ? pos.z : pos[2]) - l.z;
        return CF.clamp(1.6 / (1 + (x * x + y * y + z * z) * 0.12), 0, 1);
    },

    play(name, pos) {
        if (!this.ctx) return;
        const gain = this.att(pos);
        if (gain < 0.02) return;
        const o = { gain };
        switch (name) {
            case 'chop': this.noise(0.07, { ...o, freq: 2600, q: 2, vol: 0.35 }); this.tone(180, 0.08, { ...o, type: 'triangle', vol: 0.25 }); break;
            case 'thud': this.tone(110, 0.12, { ...o, to: 60, type: 'sine', vol: 0.3 }); this.noise(0.05, { ...o, freq: 400, vol: 0.12 }); break;
            case 'clink': this.tone(1800 + Math.random() * 600, 0.15, { ...o, type: 'sine', vol: 0.12 }); this.tone(3100, 0.08, { ...o, vol: 0.05 }); break;
            case 'grab': this.tone(520, 0.06, { ...o, to: 700, type: 'triangle', vol: 0.09 }); break;
            case 'drop': this.tone(400, 0.07, { ...o, to: 300, type: 'triangle', vol: 0.08 }); break;
            case 'whoosh': this.noise(0.25, { ...o, freq: 500, to: 2200, q: 0.7, vol: 0.2, attack: 0.05 }); break;
            case 'ding': this.tone(1320, 1.1, { ...o, vol: 0.25 }); this.tone(2640, 0.6, { ...o, vol: 0.06 }); break;
            case 'cash': this.tone(1046, 0.12, { ...o, type: 'square', vol: 0.07 }); this.tone(1568, 0.3, { ...o, type: 'square', vol: 0.07, delay: 0.09 }); this.noise(0.15, { ...o, freq: 5000, vol: 0.08, delay: 0.05 }); break;
            case 'fail': this.tone(300, 0.25, { ...o, to: 180, type: 'sawtooth', vol: 0.12 }); this.tone(200, 0.35, { ...o, to: 110, type: 'sawtooth', vol: 0.1, delay: 0.18 }); break;
            case 'break': this.noise(0.35, { ...o, freq: 3500, q: 0.8, vol: 0.4 }); for (let i = 0; i < 5; i++) this.tone(2000 + Math.random() * 3000, 0.08, { ...o, vol: 0.08, delay: i * 0.03 }); break;
            case 'splash': this.noise(0.4, { ...o, freq: 900, to: 300, q: 0.6, vol: 0.3 }); break;
            case 'pop': this.tone(300, 0.08, { ...o, to: 900, vol: 0.18 }); break;
            case 'click': this.tone(900, 0.03, { ...o, type: 'square', vol: 0.05 }); break;
            case 'knob': this.tone(600, 0.04, { ...o, type: 'square', vol: 0.06 }); this.noise(0.04, { ...o, freq: 3000, vol: 0.05 }); break;
            case 'door': this.tone(140, 0.3, { ...o, to: 90, type: 'triangle', vol: 0.2 }); this.noise(0.2, { ...o, freq: 700, vol: 0.08 }); break;
            case 'ignite': this.noise(0.6, { ...o, freq: 300, to: 1200, q: 0.5, vol: 0.4, attack: 0.04 }); break;
            case 'alarm': for (let i = 0; i < 3; i++) { this.tone(880, 0.18, { ...o, type: 'square', vol: 0.08, delay: i * 0.4 }); this.tone(660, 0.18, { ...o, type: 'square', vol: 0.08, delay: i * 0.4 + 0.2 }); } break;
            case 'event': this.tone(523, 0.12, { ...o, type: 'triangle', vol: 0.15 }); this.tone(659, 0.12, { ...o, type: 'triangle', vol: 0.15, delay: 0.1 }); this.tone(784, 0.3, { ...o, type: 'triangle', vol: 0.15, delay: 0.2 }); break;
            case 'squeak': this.tone(1800, 0.12, { ...o, to: 2600, type: 'sine', vol: 0.12 }); this.tone(2200, 0.1, { ...o, to: 1500, vol: 0.1, delay: 0.12 }); break;
            case 'shake': this.noise(0.06, { ...o, freq: 6000, q: 1.5, vol: 0.15 }); break;
            case 'scrub': this.noise(0.08, { ...o, freq: 1800 + Math.random() * 800, q: 1, vol: 0.12 }); break;
            case 'flip': this.noise(0.15, { ...o, freq: 900, to: 2000, vol: 0.15 }); this.tone(500, 0.1, { ...o, to: 800, type: 'triangle', vol: 0.08 }); break;
            case 'truck': this.tone(70, 0.8, { ...o, type: 'sawtooth', vol: 0.06, to: 50 }); this.tone(660, 0.12, { ...o, vol: 0.12, delay: 0.5 }); this.tone(660, 0.12, { ...o, vol: 0.12, delay: 0.7 }); break;
            case 'ouch': this.tone(700, 0.2, { ...o, to: 300, type: 'sawtooth', vol: 0.12 }); break;
            case 'star': this.tone(880, 0.15, { ...o, type: 'triangle', vol: 0.12 }); this.tone(1320, 0.25, { ...o, type: 'triangle', vol: 0.1, delay: 0.08 }); break;
            case 'tick': this.tone(1500, 0.03, { ...o, type: 'square', vol: 0.04 }); break;
        }
    },

    // Continuous sounds: sizzle, boil, fryer, fire, spray. Volume 0 fades them out.
    loop(name, vol) {
        if (!this.ctx) return;
        let L = this.loops[name];
        const smp = this.sampleFor[name];
        if (!L && smp && smp[0].buf) {
            // a recorded loop (e.g. the sizzle of meat in a pan)
            if (vol <= 0.001) return;
            const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
            src.buffer = smp[0].buf; src.loop = true; src.playbackRate.value = smp[1];
            g.gain.value = 0; src.connect(g); g.connect(this.master);
            src.start(0, Math.random() * Math.max(0, smp[0].buf.duration - 0.1));
            L = this.loops[name] = { g, cur: 0, k: smp[2], stop() { try { src.stop(); } catch (e) {} g.disconnect(); } };
        }
        if (!L) {
            if (vol <= 0.001) return;
            const ctx = this.ctx;
            const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
            const f = ctx.createBiquadFilter(), g = ctx.createGain();
            const cfg = { sizzle: ['highpass', 3500, 0.6, 1.3], fry: ['bandpass', 2400, 0.5, 1], boil: ['lowpass', 500, 1, 0.6], fire: ['bandpass', 600, 0.4, 0.8], spray: ['highpass', 2000, 0.5, 1.6], hum: ['lowpass', 180, 1, 0.5] }[name] || ['bandpass', 1000, 1, 1];
            f.type = cfg[0]; f.frequency.value = cfg[1]; f.Q.value = cfg[2]; src.playbackRate.value = cfg[3];
            g.gain.value = 0;
            src.connect(f); f.connect(g); g.connect(this.master); src.start();
            // crackle/bubble modulation
            const lfo = ctx.createOscillator(), lg = ctx.createGain();
            lfo.frequency.value = name === 'boil' ? 7 : name === 'fire' ? 11 : 23; lg.gain.value = 0.35;
            const mod = ctx.createGain(); mod.gain.value = 1;
            lfo.connect(lg); lg.connect(mod.gain); lfo.start();
            g.disconnect(); g.connect(mod); mod.connect(this.master);
            L = this.loops[name] = { g, cur: 0, k: 1, stop() { try { src.stop(); lfo.stop(); } catch (e) {} mod.disconnect(); } };
        }
        const target = CF.clamp(vol, 0, 1) * 0.35 * (L.k || 1);
        L.cur = target;
        L.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
    },
    stopLoops() { for (const k in this.loops) this.loop(k, 0); }
};

// ---------- Music: the tiny built-in music box (main menu + shift), or your own songs (CF.MyMusic) ----------
CF.Music = {
    timer: null, step: 0, mode: null, synth: null,
    // what should play now: 'menu' | 'shift'
    play(mode) { this.mode = mode; this.refresh(); },
    // pick the source from the settings (My music falls back to the built-in music while there are no songs)
    refresh() {
        const src = CF.settings.musicSrc || 'builtin', mine = src === 'mine' && CF.MyMusic && CF.MyMusic.ready();
        if (mine) { this.stopSynth(); if (this.mode && CF.Audio.ctx) CF.MyMusic.start(); }
        else {
            if (CF.MyMusic) CF.MyMusic.stop();
            if (src === 'off' || !this.mode) this.stopSynth(); else this.startSynth(this.mode);
        }
    },
    startSynth(mode) {
        if (this.synth === mode && this.timer) return;
        this.stopSynth(); this.synth = mode;
        const A = CF.Audio; if (!A.ctx) return;
        const menu = [[523, 659], [587, 698], [659, 784], [587, 740], [523, 659], [440, 587], [494, 622], [523, 659]];
        const shift = [[392, 494], [440, 523], [392, 494], [349, 440], [392, 494], [523, 659], [494, 587], [440, 523]];
        const seq = mode === 'menu' ? menu : shift;
        const bass = mode === 'menu' ? [131, 147, 165, 147, 131, 110, 123, 131] : [98, 110, 98, 87, 98, 131, 123, 110];
        const tempo = mode === 'menu' ? 0.36 : 0.26;
        this.timer = setInterval(() => {
            const v = CF.settings.music; if (v <= 0 || !A.ctx) return;
            const i = this.step++ % (seq.length * 2), n = seq[Math.floor(i / 2)];
            const note = n[i % 2];
            A.tone(note, tempo * 0.9, { type: 'triangle', vol: 0.05 * v });
            if (i % 2 === 0) A.tone(bass[Math.floor(i / 2)], tempo * 1.8, { type: 'sine', vol: 0.08 * v });
            if (mode !== 'menu' && i % 4 === 2) A.noise(0.04, { freq: 7000, vol: 0.04 * v });
        }, tempo * 1000);
    },
    stopSynth() { if (this.timer) clearInterval(this.timer); this.timer = null; this.synth = null; },
    stop() { this.mode = null; this.refresh(); }
};
