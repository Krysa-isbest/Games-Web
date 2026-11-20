// Whiteout: what the dead left behind to read (build step 7a). The first journal: the cook of the trawler
// Nordstjerna, whose crew camped in the forest to the west and died there, years before the plane came down.
// It is shown in the same book as the crafting book (craft.js, openBook(gm, 'journal')). Its last pages are
// notes on snowshoes and torches: reading it copies them into the crafting book (finds.js, 'learn').
// It hints at what comes later: the flare shells, the lights on the sea, the knocking, the phone in the
// tower that needs a battery, the cabin with boards on its windows.

const entry = (day, text) => `<p class="j-day">${day}</p><p>${text}</p>`;
// step 7e: the old hunter's plan for a winter den in the cave south of the shack (in the old cache there: places.js)
export const PLAN = [
  { left: () => `<h3>The winter den</h3><svg class="sk" viewBox="0 0 220 210"><g fill="none" stroke="#2b2836" stroke-width="2.2" stroke-linecap="round">
      <path d="M20 180 q90 -170 180 0"/><path d="M80 180 v-60 h60 v60"/><path d="M80 140 h60 M80 160 h60"/><path d="M104 180 v-46 h14 v46"/><circle cx="160" cy="70" r="10"/><path d="M40 176 h30 M150 176 h40"/></g></svg>
      <p>If the shack ever goes: the cave behind the drift. — H. L.</p>`,
    right: () => `<ul class="need"><li><i>🪵</i>A wall across the mouth: 5 logs, a gap for the door</li><li><i>🟫</i>A door in the gap: 2 boards</li><li><i>🪨</i>A ring of stones for a fire: 4 stones (the smoke finds the crack in the roof)</li><li><i>🌿</i>A bed of branches: 4 branches</li></ul>
      <p class="j-note">Colder than the shack, and darker. But it doesn't burn down.</p>` },
];
// step 7c: Arne Vik, the skipper, who went up to the tower and never came back to the camp. He found the hunter's note,
// a storm caught him on the way back, and he crawled into the ice cave east of the shack. (In the ice cave: places.js.)
export const JOURNAL2 = [
  { left: () => `<h3>A. Vik</h3><p class="j-sub">Skipper, Nordstjerna. A small black notebook, the pages warped, the pencil pressed hard.</p>`,
    right: () => entry('Day 17', 'The tower. Two hours up the hill, and the stairs half rotten. The cabin was locked, so I broke it. The telephone is there, but dead. The old man left a note: the battery is at home, under the floor by his bunk.') },
  { left: () => entry('Day 17, night', 'The storm caught me halfway back. I could not see my own hands. I found this cave by falling into it. It keeps the wind out better than any tent. If somebody walled up the mouth, a man could live in here.'),
    right: () => entry('Day 18', 'My feet are black. I can\'t walk on them. The ice in here glows blue when the day comes in through the mouth, as if it were lit from inside.') },
  { left: () => entry('Day 20', 'The lights on the sea came closer last night. Close enough to see that there was nobody holding them.') + entry('Day 21', 'Pål and Eskil came looking for me. I heard them call, far off. They went past, towards the cabin with the boards on its windows. Later I heard knocking from that way. I did not call back.'),
    right: () => entry('Day 2?', 'If you are reading this: the battery is under the floor of the shack. Get to the tower. Call. Don\'t wait for a ship, the way we did.') + '<p class="j-sig">— Arne</p><p class="j-note">Tell Kari I tried.</p>' },
];
export const JOURNAL = [
  { left: () => `<h3>Nordstjerna</h3><p class="j-sub">Ship's log, kept by M. Berg, cook,<br>when there was no ship left to log.</p>
      <p class="j-sub">Arne Vik, skipper · Pål · Eskil · Jonas · me</p>`,
    right: () => entry('Day 1', 'The ice took her in the night. Arne says she would have held another week if the wind had turned. We got the tent bags, the flare pistol and four shells, and what food I could carry. Five of us. We walked ashore over the ice in the dark.') },
  { left: () => entry('Day 3', 'Found a hunter\'s shack up on the rise above the bay. Nobody in it. The stove cold, the bunk made, as if he had only stepped out. Arne won\'t sleep in a dead man\'s bed. So we keep to the tents, here in the trees where there is wood. I put a red rag up on a pole so we can find our way back.'),
    right: () => entry('Day 5', 'A plane went over, high and far to the south. Pål fired a flare. Then a second. It never turned. Two shells left. We keep them for a ship, Arne says. For someone close enough to see.') },
  { left: () => entry('Day 8', 'Jonas went through the ice out by the fishing holes. Dark ice, Eskil says: you can see it if you look. We got him out with the boat hook, but he never got warm again.'),
    right: () => entry('Day 9', 'Jonas died in the night. We could not dig in the ground. He is under the snow by the big rock.') + entry('Day 11', 'Lights out on the sea ice at night, low and moving. Not a ship. Arne went out to look and came back and won\'t say what he saw.') },
  { left: () => entry('Day 14', 'Something knocked on the tent pole three times in the night. In the morning there were no tracks. Only ours.'),
    right: () => entry('Day 16', 'Arne says there is a telephone up in the old tower on the hill, the kind that talks to satellites. Its battery is gone. He thinks the old hunter took it, or hid it. He went up to look.') },
  { left: () => entry('Day 19', 'Arne isn\'t back. Pål and Eskil went after him, towards the cabin with the boards on its windows. I stay with the fire.') + '<p class="j-note">If you find this: the last two shells are in the box by the sled. Don\'t waste them on a plane that is too far away.</p>',
    right: () => entry('Day 2?', 'I can\'t feel my hands. The fire won\'t take. I have written down what Arne knew, on the next page, so it isn\'t lost with us.') + '<p class="j-sig">— M.</p>' },
  { left: () => `<h4>Snowshoes</h4><p>Two bent branches for the frame, a board split thin for the cross pieces, lashed tight. In the deep snow in the trees they keep you on top instead of up to your waist.</p>`,
    right: () => `<h4>A torch</h4><p>A dry branch with cloth wound round the end. Anything that burns well soaks it. It gives light, and a little warmth on your hands, and it won\'t last long.</p><p class="j-note">Arne made both at the old man\'s bench in the shack.</p>` },
];
