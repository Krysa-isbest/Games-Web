// Shop pacing: weekly shop events, rush hours, and scaling with the number of players.
import { G, pick, rand, playerCount } from './state.js';
import { morningHooks } from './economy.js';

export const SHOP_EVENTS = {
  heatwave: { icon: '🥵', name: 'Heat Wave', desc: 'Everybody wants fans, AC units and blenders today. They pay a lot more for them.' },
  festival: { icon: '🎪', name: 'Street Festival', desc: 'Crowds all day: lots more customers, and lots more trash.' },
  powercut: { icon: '🔌', name: 'Power Cut', desc: 'The card terminal is down, so cash only. The lights flicker.' },
  rain: { icon: '🌧️', name: 'Rainy Day', desc: 'Fewer customers, and they drag mud in. Keep the mop ready.' },
};
export const HOT_ITEMS = ['fan', 'acunit', 'blender'];

// One shop event per week, on a random weekday (not Sunday: payment day).
morningHooks.push(() => {
  const week = Math.ceil(G.day / 7);
  if (G.weekEvent?.week !== week) G.weekEvent = { week, day: (week - 1) * 7 + 1 + (Math.random() * 6 | 0), id: pick(Object.keys(SHOP_EVENTS)) };
  G.shopEvent = G.weekEvent.day === G.day ? G.weekEvent.id : null;
});

export const todayEvent = () => G.shopEvent && SHOP_EVENTS[G.shopEvent] ? { id: G.shopEvent, ...SHOP_EVENTS[G.shopEvent] } : null;
export const isEvent = id => G.shopEvent === id;

// Rush hours: 12:00–13:00 and 16:00–17:00 (G.time = minutes after 9:00).
export const isRush = () => G.phase === 'open' && ((G.time >= 180 && G.time < 240) || (G.time >= 420 && G.time < 480));

// Solo = a calmer shop; 4 players = rush hours really rush.
export const playerScale = () => 0.6 + 0.2 * playerCount();

// The window display: a stocked shelf right behind the shop window brings people in.
export const windowDisplay = () => G.shelves.some(s => s.position.x > 1.2 && s.position.x < 4.6 && s.position.z > 3.2 && s.userData.slots.some(x => x.item));

// Seconds until the next customer.
export function spawnDelay() {
  const busy = (1 + G.trust * 0.5) * playerScale() * (isRush() ? 2.2 : 1) * (isEvent('festival') ? 1.8 : 1) * (isEvent('rain') ? 0.8 : 1)
    * (windowDisplay() ? 1.25 : 1) * (0.6 + 0.5 * G.clean / 100) * (1 + G.decor.length * 0.04);
  return rand(8, 16) / busy;
}
// How messy customers are (trash and spills).
export const messMult = () => (1 + Math.min(1, (G.day - 1) / 20)) * playerScale() * (isRush() ? 1.5 : 1) * (isEvent('festival') ? 1.5 : 1);
export const maxCustomers = () => Math.round(3 + playerCount() + (isRush() ? 2 : 0) + (isEvent('festival') ? 2 : 0));
