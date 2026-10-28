// Sound: one-shots, ambient loops that fade with time of day, and positional loops (campfire).
import * as THREE from 'three';
import { BASE } from './assets.js';

const S = BASE + 'assets/sounds/';
const FILES = [
  'ambient/birds_day.ogg', 'ambient/bird_call_1.wav', 'ambient/bird_call_2.wav', 'ambient/bird_night.wav', 'ambient/crickets.wav',
  'ambient/frog.wav', 'ambient/wind_1.ogg', 'ambient/water_loop.ogg', 'ambient/fire_loop.wav', 'ambient/rain_loop.ogg',
  'actions/chop.ogg', 'actions/woodcut.ogg', 'actions/tree_fall.ogg', 'actions/splash_1.ogg', 'actions/splash_2.ogg',
  'actions/pickup.ogg', 'actions/drop.ogg', 'actions/build_creak_1.ogg', 'actions/build_creak_2.ogg', 'actions/build_creak_3.ogg',
  'actions/cage_latch.ogg', 'actions/coins.ogg', 'actions/cloth_1.ogg', 'actions/cloth_2.ogg', 'actions/knife_slice.ogg', 'actions/bubbles.ogg',
  'ui/click.wav', 'ui/hover.wav', 'ui/open_menu.ogg', 'ui/close_menu.ogg', 'ui/toggle_on.wav',
  ...Array.from({ length: 10 }, (_, i) => `footsteps/step_${i}.ogg`),
];

export class Audio {
  constructor() {
    this.listener = null;
    this.buffers = {};
    this.loops = {};
    this.volume = 0.8;
    this.ready = false;
  }

  // must be called from a user gesture (browsers block audio before that)
  async init(camera) {
    if (this.listener) { this.listener.context.resume(); return; }
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.listener.setMasterVolume(this.volume);
    const ctx = this.listener.context;
    await Promise.all(FILES.map(async (f) => {
      try {
        const res = await fetch(S + f);
        this.buffers[f.replace(/\.(ogg|wav)$/, '')] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) { console.warn('sound failed', f, e); }
    }));
    this.ready = true;
    for (const name of ['ambient/birds_day', 'ambient/crickets', 'ambient/wind_1', 'ambient/water_loop']) {
      const a = new THREE.Audio(this.listener);
      if (!this.buffers[name]) continue;
      a.setBuffer(this.buffers[name]); a.setLoop(true); a.setVolume(0); a.play();
      this.loops[name] = a;
    }
  }

  setVolume(v) { this.volume = v; if (this.listener) this.listener.setMasterVolume(v); }

  play(name, vol = 1, rate = 1) {
    if (!this.ready || !this.buffers[name]) return;
    const a = new THREE.Audio(this.listener);
    a.setBuffer(this.buffers[name]); a.setVolume(vol); a.setPlaybackRate(rate * (0.94 + Math.random() * 0.12));
    a.play();
  }

  ui(name) { this.play('ui/' + name, 0.5); }

  footstep(vol) { this.play(`footsteps/step_${Math.floor(Math.random() * 10)}`, vol); }

  loopAt(name, object, vol = 1) {
    if (!this.ready || !this.buffers[name]) return null;
    const a = new THREE.PositionalAudio(this.listener);
    a.setBuffer(this.buffers[name]); a.setLoop(true); a.setRefDistance(2); a.setRolloffFactor(1.6); a.setVolume(vol);
    object.add(a); a.play();
    return a;
  }

  // ambience follows time of day and how close the river is
  update(dt, daylight, riverDist, paused) {
    if (!this.ready) return;
    const set = (n, v) => { const a = this.loops[n]; if (a) a.setVolume(a.getVolume() + (v - a.getVolume()) * Math.min(1, dt * 2)); };
    const k = paused ? 0.3 : 1;
    set('ambient/birds_day', 0.35 * daylight * k);
    set('ambient/crickets', 0.3 * (1 - daylight) * k);
    set('ambient/wind_1', 0.12 * k);
    set('ambient/water_loop', Math.max(0, 1 - riverDist / 30) * 0.5 * k);
    // occasional calls in the canopy
    if (!paused && Math.random() < dt * 0.07) {
      const n = daylight > 0.4 ? (Math.random() < 0.5 ? 'ambient/bird_call_1' : 'ambient/bird_call_2') : (Math.random() < 0.5 ? 'ambient/bird_night' : 'ambient/frog');
      this.play(n, 0.12 + Math.random() * 0.15);
    }
  }
}
