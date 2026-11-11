// Constants every part of the game shares.
export const VERSION = 'Prototype v0.1';
export const BUILD = 'Foundation';

// The simulation runs in fixed steps, so movement, AI and damage behave the same at 30 FPS and at 240 FPS.
export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;
export const MAX_STEPS = 5;        // most steps caught up in one drawn frame, before the backlog is dropped
export const BG_HZ = 20;           // how often the simulation is driven while the tab is hidden (hosts only)

export const STORE = 'prismplunderers.';   // prefix of every key in the browser's storage
export const MAX_PLAYERS = 4;
