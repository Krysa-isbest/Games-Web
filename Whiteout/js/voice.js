// Whiteout: voice chat (build step 6). Your microphone goes to the crew as a WebRTC audio track.
//  * Room codes (PeerJS): everyone calls everyone (a small mesh, at most 4). The calls run over each player's own
//    link to the room server, so they keep going when the host leaves and someone else takes over.
//  * Invite codes (LAN / Tailscale): there is no server to introduce the guests to each other, so the host adds
//    the sound to the links it already has (one renegotiation per guest) and passes each guest's voice on to
//    the others.
// In the game every voice comes from where that player stands (Web Audio, HRTF): quieter and duller with
// distance, and a blizzard swallows it. A downed friend sounds weak and muffled and carries only a few metres.
// The dead only hear each other (and whoever they watch). During the opening cutscene the host's voice comes
// through the plane's radio filter while they hold the radio's push to talk.
// Settings > Audio & voice: on/off, push to talk or open mic, the microphone, its volume, others' volume, noise
// suppression. With no microphone (or no permission) you still hear the others.
import * as THREE from 'three';
import { G, S, lerp } from './state.js';
import { NET, on, send } from './net.js';
import { BINDS } from './keys.js';
import { audioCtx, audioOut } from './audio.js';
import { smooth } from './scene.js';

export const LS = { up: 0, down: 1, dead: 2, swim: 3, sleep: 4, carried: 5 };      // the life states others see (game.js g-p `ls`)
const V = { on: false, ctx: null, peer: null, mic: null, micSrc: null, micGain: null, gate: null, dest: null, track: null, an: null, buf: new Float32Array(512),
  ptt: false, radio: false, level: 0, err: '', retryT: 0, calls: new Map(), peers: new Map(), remote: new Map(), d: new Map(), dTracks: new Map(), timer: 0, h: null };
export const VOICE = V;
let CURVE = null;
const _f = new THREE.Vector3(), _u = new THREE.Vector3();

// ---------- starting and stopping ----------
export async function startVoice() {
  if (V.on || G.net.role === 'solo') return;
  const ctx = audioCtx();
  if (!ctx || !window.RTCPeerConnection) return;
  V.on = true; V.ctx = ctx; V.err = '';
  V.dest = ctx.createMediaStreamDestination();
  V.gate = ctx.createGain(); V.gate.gain.value = 0; V.gate.connect(V.dest);
  V.micGain = ctx.createGain(); V.micGain.gain.value = +S.micVol || 1; V.micGain.connect(V.gate);
  V.an = ctx.createAnalyser(); V.an.fftSize = 512; V.micGain.connect(V.an);
  V.track = V.dest.stream.getAudioTracks()[0];
  NET.onLeave = stopVoice;
  listen();
  if (NET.mode === 'peerjs' && NET.peer) {
    V.peer = NET.peer;
    V.peer.on('call', c => { if (!V.on) return; try { c.answer(V.dest.stream); wireCall(c); } catch (e) { console.warn('[voice] answer failed', e); } });
  }
  if (S.voice) await openMic();
  V.timer = setInterval(gateTick, 50);
  hello();
}
async function openMic() {
  const want = dev => ({ audio: { deviceId: dev ? { exact: dev } : undefined, noiseSuppression: !!S.noise, echoCancellation: true, autoGainControl: true } });
  try {
    try { V.mic = await navigator.mediaDevices.getUserMedia(want(S.mic)); } catch (e) { if (!S.mic) throw e; V.mic = await navigator.mediaDevices.getUserMedia(want('')); }      // the saved microphone is gone: the default one
    if (!V.on) { V.mic.getTracks().forEach(t => t.stop()); V.mic = null; return; }
    V.micSrc = V.ctx.createMediaStreamSource(V.mic); V.micSrc.connect(V.micGain);
  } catch (e) { V.err = 'mic'; console.warn('[voice] no microphone', e); }
}
export function stopVoice() {
  if (!V.on) return;
  V.on = false;
  clearInterval(V.timer);
  unlisten();
  for (const c of V.calls.values()) try { c.close(); } catch { /* closed */ }
  for (const k of [...V.remote.keys()]) dropRemote(k);
  V.mic?.getTracks().forEach(t => t.stop());
  try { V.micSrc?.disconnect(); V.gate?.disconnect(); } catch { /* gone */ }
  Object.assign(V, { peer: null, mic: null, micSrc: null, ptt: false, radio: false, level: 0 });
  V.calls.clear(); V.peers.clear(); V.d.clear(); V.dTracks.clear();
  if (NET.onLeave === stopVoice) NET.onLeave = null;
}
// tell the crew we are here (again, after the host changed)
export function voiceHello() { if (V.on) hello(); }
function hello() {
  if (NET.mode === 'peerjs' && V.peer) send('*', { t: 'v-hi', peer: V.peer.id });
  else if (NET.mode === 'direct') send(G.net.role === 'host' ? '*' : 'p0', { t: 'v-hi' });
}
on('v-hi', (m, from) => {
  if (!V.on || !from || from === G.net.id) return;
  if (NET.mode === 'direct') {
    if (G.net.role === 'host') offerTo(from); else if (!m.re) send('p0', { t: 'v-hi', re: 1 });
    return;
  }
  if (!m.peer || !V.peer || m.peer === V.peer.id) return;
  V.peers.set(m.peer, from);                     // who that voice is (player ids change when the host does)
  if (!m.re) send(from, { t: 'v-hi', peer: V.peer.id, re: 1 });
  if (V.peer.id < m.peer && !V.calls.has(m.peer)) { try { wireCall(V.peer.call(m.peer, V.dest.stream, { metadata: { v: 1 } })); } catch (e) { console.warn('[voice] call failed', e); } }
});

// ---------- room codes: calls ----------
function wireCall(c) {
  if (!c) return;
  V.calls.set(c.peer, c); c.at = performance.now();
  c.on('stream', st => { if (!V.remote.has('c:' + c.peer) || V.remote.get('c:' + c.peer).stream !== st) addRemote('c:' + c.peer, st, () => V.peers.get(c.peer)); });
  const gone = () => { if (V.calls.get(c.peer) === c) { V.calls.delete(c.peer); dropRemote('c:' + c.peer); } };
  c.on('close', gone); c.on('error', gone);
}

// ---------- invite codes: the host's links carry the sound ----------
const SLOTS = ['p0', 'p1', 'p2', 'p3'];
async function offerTo(pid) {
  const pc = NET.pcs.get(pid);
  if (!pc) return;
  let l = V.d.get(pid);
  if (l && l.pc !== pc) { V.d.delete(pid); l = null; }
  if (l && (l.done || performance.now() - l.at < 6000)) return;
  try {
    if (!l) {
      l = { pc, tx: {}, up: null, done: false, at: 0 };
      for (const s of SLOTS) if (s !== pid) l.tx[s] = pc.addTransceiver('audio', { direction: 'sendonly' });
      l.up = pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addEventListener('track', e => { if (e.transceiver === l.up) gotDirect(pid, e.track); });
      V.d.set(pid, l);
    }
    l.at = performance.now();
    await pc.setLocalDescription(await pc.createOffer());
    const map = {};
    for (const [s, t] of Object.entries(l.tx)) map[t.mid] = s;
    send(pid, { t: 'v-offer', sdp: pc.localDescription.sdp, map, up: l.up.mid });
    l.tx.p0?.sender.replaceTrack(V.track).catch(() => {});
    for (const [s, tr] of V.dTracks) if (l.tx[s]) l.tx[s].sender.replaceTrack(tr).catch(() => {});
  } catch (e) { console.warn('[voice] could not add voice to the link', e); V.d.delete(pid); }
}
on('v-answer', async (m, from) => {
  const l = V.d.get(from);
  if (!V.on || !l || !m.sdp) return;
  try { await l.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); l.done = true; } catch (e) { console.warn('[voice] answer rejected', e); }
});
function gotDirect(pid, track) {
  V.dTracks.set(pid, track);
  addRemote('d:' + pid, new MediaStream([track]), () => pid);
  for (const [q, l] of V.d) if (q !== pid && l.tx[pid]) l.tx[pid].sender.replaceTrack(track).catch(() => {});      // pass it on to the others
}
on('v-offer', async m => {
  if (!V.on || NET.mode !== 'direct' || G.net.role !== 'guest' || !m.sdp) return;
  const pc = NET.pcs.get('p0');
  if (!pc) return;
  pc.ontrack = e => { const s = m.map?.[e.transceiver.mid]; if (s && s !== G.net.id) addRemote('d:' + s, new MediaStream([e.track]), () => s); };
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    for (const t of pc.getTransceivers()) if (t.mid === m.up) { t.direction = 'sendonly'; await t.sender.replaceTrack(V.track); }
    await pc.setLocalDescription(await pc.createAnswer());
    send('p0', { t: 'v-answer', sdp: pc.localDescription.sdp });
  } catch (e) { console.warn('[voice] could not answer the voice offer', e); }
});

// ---------- a voice coming in ----------
function curve() {
  if (CURVE) return CURVE;
  CURVE = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; CURVE[i] = Math.tanh(x * 2.6) / Math.tanh(2.6); }
  return CURVE;
}
function addRemote(key, stream, pid) {
  dropRemote(key);
  const ctx = V.ctx, out = audioOut();
  if (!ctx || !out) return;
  // Chrome only lets a call's sound into Web Audio while a (muted) media element plays it
  const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser(); an.fftSize = 512;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 14000;
  const g = ctx.createGain(); g.gain.value = +S.voiceVol || 1;
  const pan = ctx.createPanner(); Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, rolloffFactor: 0.45, maxDistance: 200 });
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
  const sh = ctx.createWaveShaper(); sh.curve = curve();
  const rg = ctx.createGain(); rg.gain.value = 0;
  src.connect(an); src.connect(lp); lp.connect(g); g.connect(pan); pan.connect(out);
  src.connect(bp); bp.connect(sh); sh.connect(rg); rg.connect(out);
  V.remote.set(key, { key, pid, stream, el, src, an, lp, g, pan, rg, level: 0, radio: false });
  for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => { if (V.remote.get(key)?.stream === stream) dropRemote(key); });
}
function dropRemote(key) {
  const r = V.remote.get(key);
  if (!r) return;
  V.remote.delete(key);
  try { r.src.disconnect(); r.pan.disconnect(); r.rg.disconnect(); r.el.srcObject = null; } catch { /* gone */ }
}
const rms = (an, buf) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };

// ---------- 20 times a second, in the menu, the cutscene and the game: the microphone gate, who is speaking ----------
function gateTick() {
  if (!V.on || !V.ctx) return;
  const t = V.ctx.currentTime, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  const open = V.radio || (S.voice && !!V.micSrc && (S.voiceMode === 'open' ? !typing : V.ptt));
  V.gate.gain.setTargetAtTime(open ? 1 : 0, t, 0.02);
  V.micGain.gain.setTargetAtTime(+S.micVol || 1, t, 0.05);
  V.level = open ? rms(V.an, V.buf) : 0;
  for (const r of V.remote.values()) r.level = rms(r.an, V.buf);
  // clean up the host's links to guests who left
  for (const [pid, l] of V.d) if (NET.pcs.get(pid) !== l.pc) { V.d.delete(pid); V.dTracks.delete(pid); dropRemote('d:' + pid); }
  // now and then: a call that never got through is dropped, and anyone we have no voice from is greeted again
  if (++V.retryT >= 240) {
    V.retryT = 0;
    for (const [id, c] of V.calls) if (!c.open && performance.now() - c.at > 15000) { try { c.close(); } catch { /* never opened */ } V.calls.delete(id); }
    if (V.remote.size < G.lobby.players.length - 1) hello();
  }
}
// who is talking right now: [pid or 'me']
export function speaking() {
  if (!V.on) return [];
  const out = [];
  if (V.level > 0.015) out.push('me');
  for (const r of V.remote.values()) if (r.level > 0.012) { const pid = r.pid(); if (pid) out.push(pid); }
  return out;
}
export const voiceErr = () => V.err;
export const voiceOn = () => V.on;

// ---------- the opening cutscene: the host on the plane's radio ----------
export function radioTalk(onAir) { V.radio = !!onAir; }
export function radioFrom(pid, onAir) { for (const r of V.remote.values()) if (r.pid() === pid) r.radio = !!onAir; }

// ---------- in the game, every frame: where each voice comes from ----------
// ghost: I am dead or asleep (I hear the dead too). life(pid) -> { pos, ls } of a crew member, or null.
export function voiceTick(gm, env, ghost, life) {
  if (!V.on || !V.ctx) return;
  const ctx = V.ctx, t = ctx.currentTime, L = ctx.listener, cam = gm.camera;
  cam.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
  if (L.positionX) {
    L.positionX.setTargetAtTime(cam.position.x, t, 0.03); L.positionY.setTargetAtTime(cam.position.y, t, 0.03); L.positionZ.setTargetAtTime(cam.position.z, t, 0.03);
    L.forwardX.setTargetAtTime(_f.x, t, 0.03); L.forwardY.setTargetAtTime(_f.y, t, 0.03); L.forwardZ.setTargetAtTime(_f.z, t, 0.03);
    L.upX.setTargetAtTime(_u.x, t, 0.03); L.upY.setTargetAtTime(_u.y, t, 0.03); L.upZ.setTargetAtTime(_u.z, t, 0.03);
  } else { L.setPosition?.(cam.position.x, cam.position.y, cam.position.z); L.setOrientation?.(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  const vv = +S.voiceVol || 1, storm = env.storm || 0;
  for (const r of V.remote.values()) {
    const who = life(r.pid());
    let vol = vv, f = 14000, x = cam.position.x, y = cam.position.y, z = cam.position.z;
    if (who && who.ls === LS.dead) { if (!ghost) vol = 0; }                       // the dead talk among themselves
    else if (who && who.pos) {
      const weak = who.ls === LS.down || who.ls === LS.carried, d = who.pos.distanceTo(cam.position) - 1.2;
      const range = weak ? 7 : lerp(46, 15, storm) * (who.inShack && !gm.inShack && !ghost ? 0.6 : 1);
      vol *= smooth(range, range * 0.55, d) * (weak ? 0.55 : 1);
      f = weak ? 750 : lerp(14000, 2600, smooth(0, range, d) * (0.35 + 0.65 * storm));
      if (who.ls === LS.swim) f = Math.min(f, 3000);
      x = who.pos.x; y = who.pos.y + (who.ls === LS.up ? 1.6 : 0.4); z = who.pos.z;
    }
    if (r.pan.positionX) { r.pan.positionX.setTargetAtTime(x, t, 0.05); r.pan.positionY.setTargetAtTime(y, t, 0.05); r.pan.positionZ.setTargetAtTime(z, t, 0.05); } else r.pan.setPosition?.(x, y, z);
    r.g.gain.setTargetAtTime(r.radio ? 0 : vol, t, 0.06);
    r.rg.gain.setTargetAtTime(r.radio ? vv * 1.3 : 0, t, 0.06);
    r.lp.frequency.setTargetAtTime(f, t, 0.1);
  }
}
// out of the game (the cutscene, the menu): every voice plain and centred
export function voiceFlat() {
  if (!V.on || !V.ctx) return;
  const ctx = V.ctx, t = ctx.currentTime, L = ctx.listener, vv = +S.voiceVol || 1;
  const lx = L.positionX ? L.positionX.value : 0, ly = L.positionY ? L.positionY.value : 0, lz = L.positionZ ? L.positionZ.value : 0;
  for (const r of V.remote.values()) {
    if (r.pan.positionX) { r.pan.positionX.value = lx; r.pan.positionY.value = ly; r.pan.positionZ.value = lz; }
    r.g.gain.setTargetAtTime(r.radio ? 0 : vv, t, 0.06); r.rg.gain.setTargetAtTime(r.radio ? vv * 1.3 : 0, t, 0.06); r.lp.frequency.setTargetAtTime(14000, t, 0.1);
  }
}

// ---------- push to talk (any key or mouse button from the settings) ----------
function listen() {
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
  const h = V.h = {
    kd: e => { if (e.code === BINDS.ptt && !typing(e)) V.ptt = true; },
    ku: e => { if (e.code === BINDS.ptt) V.ptt = false; },
    md: e => { if ('Mouse' + e.button === BINDS.ptt) V.ptt = true; },
    mu: e => { if ('Mouse' + e.button === BINDS.ptt) V.ptt = false; },
    blur: () => { V.ptt = false; },
  };
  addEventListener('keydown', h.kd, true); addEventListener('keyup', h.ku, true);
  addEventListener('mousedown', h.md, true); addEventListener('mouseup', h.mu, true); addEventListener('blur', h.blur);
}
function unlisten() {
  const h = V.h;
  if (!h) return;
  removeEventListener('keydown', h.kd, true); removeEventListener('keyup', h.ku, true);
  removeEventListener('mousedown', h.md, true); removeEventListener('mouseup', h.mu, true); removeEventListener('blur', h.blur);
  V.h = null;
}
