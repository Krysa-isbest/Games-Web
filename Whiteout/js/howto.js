// How to play: short illustrated pages. The Controls page always shows your current keys.
import { S } from './state.js';
import { ACTIONS, kn } from './keys.js';
import { ui } from './audio.js';

const $ = id => document.getElementById(id);
const I = {
  plane: '<path d="M2 13l8-2 3-7 2 1-1 6 7 1v2l-7 1 1 6-2 1-3-7-8-2z"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-6 1 1 1 2 2 2 0-2 0-4 1-6z"/>',
  wind: '<path d="M3 8h11a3 3 0 10-3-3M3 12h15a3 3 0 11-3 3M3 16h8"/>',
  house: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/>',
  fish: '<path d="M2 12c4-5 10-5 14 0-4 5-10 5-14 0zM16 12l5-4v8zM7 11h.01"/>',
  bow: '<path d="M5 3c8 3 8 15 0 18M5 3v18M3 12h16M16 9l3 3-3 3"/>',
  skull: '<path d="M12 3a7 7 0 00-7 7c0 3 2 4 2 6v2h10v-2c0-2 2-3 2-6a7 7 0 00-7-7zM9 11h.01M15 11h.01M10 18v3M14 18v3"/>',
  flare: '<path d="M8 21l3-9M14 3l-1 9h4l-6 9M17 4l2-1M19 7l2 0M5 5l-1-1"/>',
  tower: '<path d="M8 21l2-12h4l2 12M7 9h10M9 5h6v4H9zM12 5V2M9 15h6"/>',
  people: '<path d="M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-4 3-6 6-6s6 2 6 6M14 14c3 0 8 1 8 6"/>',
  drop: '<path d="M12 3c3 5 6 8 6 11a6 6 0 01-12 0c0-3 3-6 6-11z"/>',
  thermo: '<path d="M10 4a2 2 0 014 0v10a4 4 0 11-4 0zM12 9v8"/>',
  hammer: '<path d="M14 4l6 6-3 3-6-6zM11 7L3 15l3 3 8-8"/>',
  note: '<path d="M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h4"/>',
  keys: '<path d="M3 7h18v10H3zM7 11h1M10 11h1M13 11h1M16 11h1M8 14h8"/>',
  moon: '<path d="M20 14A8 8 0 1110 4a7 7 0 0010 10z"/>',
  bag: '<path d="M6 8h12l1 13H5zM9 8V6a3 3 0 016 0v2"/>',
  axe: '<path d="M14 4l6 6M5 21l11-11M13 3c-3 1-5 4-4 7l3 1c2-3 2-6 1-8z"/>',
  book: '<path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z"/>',
  log: '<path d="M4 9h13a3 3 0 010 6H4a3 3 0 010-6zM17 12h.01M8 9v6"/>',
  sapling: '<path d="M12 21v-9M12 12c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2-5-6-5 0 3 2 5 6 5zM7 21h10"/>',
  bench: '<path d="M3 10h18v3H3zM5 13v8M19 13v8M8 10V7h3v3M14 10V6l3 1v3"/>',
};
const steps = list => `<ol class="steps">${list.map(s => `<li>${s}</li>`).join('')}</ol>`;
const ico = k => `<svg viewBox="0 0 24 24">${I[k]}</svg>`;
const card = (i, t, p) => `<div class="hc"><div class="hc-i">${ico(i)}</div><div><b>${t}</b><p>${p}</p></div></div>`;
const tip = t => `<div class="tip"><b>Tip</b> ${t}</div>`;

const PAGES = [
  { id: 'crash', icon: 'plane', name: 'The crash', html: () => `
    <div class="kick">CHAPTER ONE</div><h3>You were never supposed to be here</h3>
    <p class="lead">A private jet full of rich passengers. A storm over the northern sea. Engine failure at 03:14. You wake up in the snow next to the burning wreck, on an island that isn't on any map you know.</p>
    <p>Up the hill there's an old hunters' shack. It's falling apart, but it's the only roof for kilometres. Your money is worth nothing here. Everything you need, you'll find, catch or build.</p>
    <div class="cards">${card('house', 'Make the shack your home', 'Patch it, heat it, stock it. A good shack is the difference between a cold night and your last one.')}${card('moon', 'Survive the nights', 'Days are short. At night the temperature falls hard and the wind gets worse.')}${card('flare', 'Get off the island', 'Three ways out, each with a price. The journals of earlier survivors point the way.')}</div>
    ${tip('The wreck is still burning on the first night: grab what you can from it before the fire and the snow take it.')}` },
  { id: 'heat', icon: 'thermo', name: 'Staying warm', html: () => `
    <div class="kick">BODY HEAT</div><h3>Cold is the thing that kills you</h3>
    <p class="lead">Your body heat is the most important bar on your screen. Out in the open it drains. Wind, wet clothes and the night make it drain faster.</p>
    <div class="cards">${card('flame', 'Fire', 'The shack\'s iron stove eats wood fast. Split logs with the axe; dry wood burns hotter than wet.')}${card('bag', 'Layers', 'Passengers\' coats are pretty, not warm. Better gear is out there: parkas, wool, fur.')}${card('drop', 'Stay dry', 'Snow in your boots, a fall through the ice, a blizzard: wet clothes drop your heat fast. Dry them by the stove.')}${card('thermo', 'Frostbite', 'Stay too cold too long and your hands go numb: you work slower and miss shots.')}</div>
    ${tip(`Crouching (${kn('crouch')}) behind a wall or rock gets you out of the wind and slows the cold down.`)}` },
  { id: 'wind', icon: 'wind', name: 'Wind & the shack', html: () => `
    <div class="kick">SHELTER</div><h3>The shack fights back the wind, if you fix it</h3>
    <p class="lead">Every gap in the walls lets the wind in and the heat out. You can feel it: the frost on your screen gets thicker near a draft.</p>
    <div class="cards">${card('hammer', 'Patch the gaps', 'Boards, cloth, even packed snow seal the walls. The roof leaks too.')}${card('house', 'Close the door', 'Leave it open and the stove fights for nothing. Someone always forgets.')}${card('wind', 'Storms', 'A blizzard can tear off boards you nailed on. Check the walls after every storm.')}${card('moon', 'Snow load', 'Heavy snow on the roof creaks before it breaks. Shovel it off.')}</div>
    ${tip('A warm shack also dries your clothes and keeps your food from freezing.')}` },
  { id: 'food', icon: 'fish', name: 'Food & water', html: () => `
    <div class="kick">HUNGER</div><h3>Eat, drink, keep going</h3>
    <p class="lead">Hunger and thirst drain slowly, but an empty stomach makes the cold hit harder.</p>
    <div class="cards">${card('fish', 'Ice fishing', 'Chop a hole in the sea ice, drop a line and wait. Quiet, cold and safe-ish.')}${card('bow', 'Hunting', 'Hares, birds, and bigger animals inland. Something else hunts out there too.')}${card('flame', 'Cook it', 'Raw meat makes you sick. Cook on the stove or a campfire.')}${card('drop', 'Melt snow', 'Eating snow costs you heat. Melt it in a pot first.')}</div>
    ${tip(`Eat or drink what you hold with ${kn('eat')}. Food from the plane goes off: eat that first.`)}` },
  { id: 'tech', icon: 'bench', name: 'Techniques', html: () => `
    <div class="kick">KNOW-HOW</div><h3>Work smart, waste nothing</h3>
    <p class="lead">Nothing on this island comes back fast. Every log, plank and nail is either warmth tonight or a better shack tomorrow. Choose well.</p>
    <h4 class="ht-sub">${ico('axe')} Your one axe</h4>
    <p>There is only one axe, and it's lying in the shack. It's an item like any other: you carry it, drop it and can lose it.</p>
    <div class="cards">${card('axe', 'Don\'t lose it', 'Dropped in the snow, it gets buried, faster in a storm. Remember where you put it down. Through the ice it\'s gone for good.')}${card('bench', 'Keep it sharp', 'A dull axe works slowly and can break. Sharpen and repair it at the workbench.')}${card('hammer', 'The backup', 'You can make a stone axe at the workbench. It\'s slow and breaks quickly, but it beats your bare hands.')}</div>
    <h4 class="ht-sub">${ico('book')} The workbench and the crafting book</h4>
    <p>You craft only at the workbench in the shack. The worn notebook on it holds the recipes of whoever lived here before: the bow, planks, patches, tools, traps and more.</p>
    ${steps(['Open the book on the workbench and find the recipe.', 'Lay the materials it needs on the bench.', 'Work them: the item takes shape in front of you.'])}
    ${tip('Not every recipe is in the book at the start. Survivors\' notes and journals add new pages.')}
    <h4 class="ht-sub">${ico('log')} Wood and fire</h4>
    <div class="cards">${card('sapling', 'Trees grow back slowly', 'A felled tree leaves a stump with a sapling. It takes 5 days to grow back. The trees near the shack run out first.')}${card('log', 'Dry your wood', 'Fresh wood smokes and barely burns. Stack it by the stove for a while before you need it.')}${card('wind', 'Branches are free', 'Fallen branches and dead wood need no axe. They burn fast, and storms knock more down.')}${card('flame', 'Other fuel', 'Wreck parts, furniture, the leather seats, books and even banknotes burn. Seal fat burns long and hot.')}</div>
    <h4 class="ht-sub">${ico('house')} Building or burning</h4>
    <div class="cards">${card('hammer', 'Burn it or build with it?', 'A plank in the stove is warmth for an hour. The same plank nailed over a gap saves heat every night after.')}${card('bag', 'Store it dry', 'Wood left in the snow gets wet. Keep a woodpile under a roof. Food keeps best somewhere cold but dry.')}${card('bench', 'Take it apart', 'Broken things give some of their materials back at the workbench.')}${card('drop', 'Melt your water', 'Melt snow in a pot on the stove. Eating snow costs body heat.')}</div>
    ${tip('Plan a day ahead: dry tomorrow\'s wood tonight, and never leave the axe where the snow can take it.')}` },
  { id: 'dead', icon: 'skull', name: 'The ones before you', html: () => `
    <div class="kick">SURVIVORS</div><h3>You are not the first</h3>
    <p class="lead">Others were stranded here before you. You'll find what's left of them: frozen camps, collapsed tents, a cabin with the door barred from the inside.</p>
    <div class="cards">${card('bag', 'Better gear', 'Real cold-weather clothes, a rifle, an ice axe, snowshoes. Things the jet never had.')}${card('note', 'Their journals', `They wrote down what they learned, and what went wrong. Read them in your journal (${kn('journal')}).`)}${card('skull', 'What happened to them', 'Some froze. Some didn\'t. Pay attention to how they died.')}</div>
    ${tip('Journals often mark places on your map. Check it after reading.')}` },
  { id: 'escape', icon: 'flare', name: 'Getting out', html: () => `
    <div class="kick">THE END</div><h3>Three ways off the island</h3>
    <p class="lead">Ships pass far out at sea, and a plane flies over now and then. Someone has to see you. Each way out has a price.</p>
    <div class="cards">${card('flare', 'The flare gun', 'The pilot had one. Find it in the wreck, find the shells, and wait for the right moment: you only get a few.')}${card('flame', 'Burn the shack', 'The biggest signal fire on the island. If nobody comes, you\'ve just burned your only shelter.')}${card('tower', 'The tower\'s satellite phone', 'The old watchtower on the far side has a satellite phone. Getting there, and getting in, is the hard part.')}</div>
    ${tip('Rescue takes time to arrive. Whatever you choose, you have to survive until they get there.')}` },
  { id: 'crew', icon: 'people', name: 'Playing together', html: () => `
    <div class="kick">CO-OP · 1–4 PLAYERS</div><h3>Survive together, or freeze alone</h3>
    <p class="lead">Play alone or with up to 3 friends. Host a game with a room code, or with invite codes on your LAN or over Tailscale.</p>
    <div class="cards">${card('people', 'Split the work', 'One chops wood, one fishes, one patches the walls. Somebody watches the stove.')}${card('flame', 'Share the heat', 'Huddle together around the fire. Bodies in a small room keep it warmer.')}${card('wind', 'Voice in the wind', `Voice chat is spatial: in a blizzard your crew can\'t hear you from far away. Push to talk is ${kn('ptt')}.`)}${card('skull', 'Get them back up', 'A frozen friend can be carried back to the stove before it\'s too late.')}</div>
    ${tip('Sleep in shifts: while everyone sleeps the night flies by, but nobody feeds the stove. Out on the sea ice, dark ice is thin: crouch and crawl. If a friend goes through, crawl to the hole and pull.')}` },
  { id: 'controls', icon: 'keys', name: 'Controls', html: () => {
    const groups = {};
    for (const [a, d] of Object.entries(ACTIONS)) (groups[d.group] ||= []).push(a);
    return `<div class="kick">YOUR KEYS</div><h3>Controls</h3>
      <p class="lead">These are your current keys. Change any of them in Settings › Controls. Sprint is set to <b>${S.sprintMode}</b> and crouch to <b>${S.crouchMode}</b>.</p>
      <div class="ctl-grid">${Object.entries(groups).map(([g, list]) => `<div class="ctl-g"><h5>${g}</h5>${list.map(a => `<div class="ctl-r"><span>${ACTIONS[a].name}</span><kbd>${kn(a)}</kbd></div>`).join('')}</div>`).join('')}</div>`;
  } },
];
let page = 'crash';
export function openHowto() {
  $('ht-nav').innerHTML = PAGES.map((p, i) => `<button data-p="${p.id}" class="${p.id === page ? 'on' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${ico(p.icon)}<b>${p.name}</b></button>`).join('');
  $('ht-nav').querySelectorAll('[data-p]').forEach(b => b.onclick = () => { page = b.dataset.p; openHowto(); ui.click(); });
  const i = PAGES.findIndex(p => p.id === page), p = PAGES[i];
  $('ht-page').innerHTML = p.html() + `<div class="ht-foot">${i > 0 ? `<button class="btn ghost" data-go-p="${PAGES[i - 1].id}">‹ ${PAGES[i - 1].name}</button>` : '<span></span>'}${i < PAGES.length - 1 ? `<button class="btn" data-go-p="${PAGES[i + 1].id}">${PAGES[i + 1].name} ›</button>` : ''}</div>`;
  $('ht-page').querySelectorAll('[data-go-p]').forEach(b => b.onclick = () => { page = b.dataset.goP; openHowto(); ui.click(); });
  $('ht-page').scrollTop = 0;
  $('ht-page').classList.remove('in'); void $('ht-page').offsetWidth; $('ht-page').classList.add('in');
}
