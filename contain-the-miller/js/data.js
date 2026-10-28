// Game data: version, items, recipes, monkey species, changelog, credits.
// Everything gameplay-tunable lives here so it can be tweaked without touching the systems.

export const VERSION = 'v0.1.0';

// ---------------------------------------------------------------- items
// kind: tool | food | drink | resource
export const ITEMS = {
  stone_axe: { name: 'Stone Axe', kind: 'tool', model: 'stone_axe', damage: { wood: 1, bamboo: 1, stone: 0.6 }, durability: 250 },
  torch:     { name: 'Torch', kind: 'tool', light: true, durability: 600 },
  canteen:   { name: 'Canteen', kind: 'drink', model: 'canteen', charges: 3, thirst: 30 },
  banana:    { name: 'Banana', kind: 'food', hunger: 12, thirst: 2, stack: 20 },
  mango:     { name: 'Mango', kind: 'food', hunger: 16, thirst: 6, stack: 20 },
  berries:   { name: 'Berries', kind: 'food', hunger: 6, thirst: 3, stack: 30 },
};

export const RESOURCES = {
  bamboo: { name: 'Bamboo' },
  wood:   { name: 'Wood' },
  stone:  { name: 'Stone' },
  fiber:  { name: 'Fiber' },
};

// starting loadout (hotbar slot index -> item)
export const START_HOTBAR = [
  { id: 'stone_axe', durability: 250 },
  { id: 'torch', durability: 600 },
  { id: 'canteen', charges: 1 },
  { id: 'banana', count: 3 },
  null, null, null, null, null, null,
];
export const START_RESOURCES = { bamboo: 0, wood: 0, stone: 0, fiber: 0 };

// ---------------------------------------------------------------- building
// steps: how many "missing parts" the player has to click in the build minigame
export const BUILDABLES = {
  campfire:     { name: 'Campfire', cost: { wood: 4, stone: 5 }, desc: 'Light and warmth at night.', steps: 'campfire' },
  bamboo_cage:  { name: 'Bamboo Cage', cost: { bamboo: 12, wood: 4, fiber: 6 }, desc: 'Holds one monkey. Earns income.', steps: 'cage' },
  bamboo_wall:  { name: 'Bamboo Wall', cost: { bamboo: 6, fiber: 2 }, desc: 'A simple wall section.', steps: 'wall' },
  bamboo_floor: { name: 'Bamboo Floor', cost: { bamboo: 8, fiber: 2 }, desc: 'A raised floor you can stand on.', steps: 'floor' },
  thatch_roof:  { name: 'Thatch Roof', cost: { bamboo: 4, fiber: 8 }, desc: 'Keeps the rain off whatever is below.', steps: 'roof' },
};

// ---------------------------------------------------------------- monkeys
// catch: base chance when fed the favourite food while crouched and unnoticed
export const SPECIES = {
  basic_monkey: {
    name: 'Basic Monkey', biome: 'Forest', model: 'chimp_basic', height: 0.95, tint: 0x5b3f2b,
    favourite: 'berries', accepts: ['banana', 'mango'], catch: 0.7, income: 1,
    senseWalk: 11, senseCrouch: 4.5, scratch: 0.05, speed: 1.1, runSpeed: 4.2,
  },
  chimpanzee: {
    name: 'Chimpanzee', biome: 'Jungle', model: 'chimp_wild', height: 1.35, tint: null,
    favourite: 'mango', accepts: ['banana'], catch: 0.35, income: 5, groupBonus: 1,
    senseWalk: 15, senseCrouch: 6, scratch: 0.35, speed: 1.3, runSpeed: 5.5,
  },
};

// ---------------------------------------------------------------- menu changelog (shown on the main menu)
export const CHANGELOG = [
  'First playable jungle: chop bamboo and trees, gather stone and fiber.',
  'Chimpanzees and Basic Monkeys roam the jungle. Sneak (Ctrl) and feed them to tame them.',
  'Build menu (B) with the rope-lashing build minigame.',
  'Bamboo cages earn slow income for every monkey inside.',
  'Day and night cycle with campfires and torches.',
  'Health, stamina, hunger and thirst. Drink from the river or your canteen.',
];

// ---------------------------------------------------------------- credits (CC-BY models must name their authors)
export const CREDITS = {
  models: [
    ['Male Chimpanzee Hairless: Rigged, Animated', 'Animal Animator', 'c53e8ca04bb54d5e8649d95b437e2ca3', 'repainted with fur colours'],
    ['Chimpanzee', 'Player 1 The SFM Animator', '567d0866b9eb477f9dc03827c47e8566'],
    ['Gorilla', 'VoltVeigh', '67818ed7370d49a1841fd10e527216ba'],
    ['Realsitic Monkey', 'TdoubleU8', '50e4b1da03494429b1265fc095f2c530'],
    ['Spider Monkey', 'SAVIA_Colombia', 'b9a212ba8de846bbadae88ca0fa796b0'],
    ['Free Gorilla', 'Filip', 'ad28003205884841a028e80edb4089ef'],
    ['First Person hands rigged', 'David Fischer', '547a45535f0c4fe787948f7a7a6a88db'],
    ['Stone hammer Axe (Free)', 'wolfgar74', 'a0e76cba79784776b4346e6ae1732472'],
    ['Canteen', 'Multipainkiller Studio', 'af1878eba1a94ef3ae44d67d43fb6f3e'],
    ['MOPED Derbi DS-50 Scooter', 'Scanamatics', '5e3ba0954ffc4a8f853c86cb7fdaa91b'],
    ['Pickup Truck', '00amza', '047615f53e2d45b9a1a2a4dd203d459c'],
    ['Tropical Plants Pack M02P', 'MozzarellaARC', '2f093afb792742438f0f7ba7eaab90f0'],
    ['Banana tree', '1Quad', '3b658ecad29f4d9a9606dbf8fea7c9bb'],
    ['bamboo', 'evolveduk', 'a02bf0e3ffe44617ad49daf3cd94fe59'],
    ['Coiled Rope 2', 'TepidGames', 'e6fe8fedd3d04b1dac3e32e0dd515cbb'],
    ['Bamboo Wall', 'Simon Laisné', '8100079eefbe4b0e9ad3751cd31b2f97'],
    ['Log Wall (game ready asset)', 'Aparicio Silva 3D', '788e9d67d80a4f66bb007605163abf60'],
    ['Modular Wooden Building Kit', 'AspectStudios', '09724f363c2a4947a6f2dc9669d971b7'],
    ['Furnace', 'Tronin Dmitry', '64f344213c084424ba438875e62bd452'],
    ['Medieval Era Chest', 'Geeky_', 'f688f86a0fd346c18a66f582fe0629d8'],
    ['Old wooden chest', 'Yury Misiyuk', '45f93c78e5174036801bfb535c139ac7'],
    ['Door_Wooden_Old', 'Mehdi Shahsavan', '77815b3a55504037aa4641eb9650e9de'],
    ['Wooden Stairs', 'Mehdi Shahsavan', '56271a83e8ff487b84289e39a159d3c5'],
    ['Alchemical laboratory [DRAFT]', 'konstantinlakstigal', 'aa4cbe3fbb824bc8917a501057525cee'],
  ],
  cc0: [
    'Poly Haven (polyhaven.com): plants, rocks, props, tools, textures and skies. CC0.',
    'OpenGameArt (opengameart.org), CC0 sounds by Kenney, isaiah658, Aj_, fvcalderan, kheetor, AntumDeluge, Ylmir, WuxiaScrub, themightyglider, rubberduck, IgnasD.',
  ],
  engine: 'Built with three.js (MIT).',
};
