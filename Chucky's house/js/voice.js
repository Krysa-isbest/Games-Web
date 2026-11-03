// Proximity voice chat. Every pair of players gets its own audio-only WebRTC connection, signalled
// through the game connection (so Direct/Tailscale mode needs no server here either).
// Effects: distance + direction (HRTF), walkie-talkie (band-pass + distortion + squelch, any distance),
// low HP / downed speaker (muffled), low HP / downed / hiding listener (everything muffled).
import * as THREE from 'three';
import { G, me } from './state.js';
import { NET, send, on } from './net.js';
import { S } from './settings.js';
import { audioCtx, sfx } from './sfx.js';

export const VOICE = { stream: null, status: 'off', peers: new Map(), ptt: false, radioKey: false, level: 0, master: null, listener: null, analyser: null };
const _v = new THREE.Vector3();

export async function initMic() {
  if (!navigator.mediaDevices?.getUserMedia) { VOICE.status = 'none'; return VOICE.status; }
  VOICE.status = 'asking';
  try {
    VOICE.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(S.micDevice ? { deviceId: S.micDevice } : {}) },
    });
    VOICE.status = 'on';
    updateMicTrack();
  } catch (e) {
    VOICE.status = e.name === 'NotAllowedError' ? 'denied' : 'none';
  }
  return VOICE.status;
}

function graph() {
  if (VOICE.master) return;
  const ctx = audioCtx();
  VOICE.master = ctx.createGain();
  VOICE.listener = ctx.createBiquadFilter(); VOICE.listener.type = 'lowpass'; VOICE.listener.frequency.value = 20000;
  VOICE.master.connect(VOICE.listener).connect(ctx.destination);
  if (VOICE.stream) {
    VOICE.analyser = ctx.createAnalyser(); VOICE.analyser.fftSize = 256;
    ctx.createMediaStreamSource(VOICE.stream).connect(VOICE.analyser);
  }
  // echo: every voice is sent into one reverb whose "room" follows where you are
  VOICE.echoIn = ctx.createGain();
  VOICE.echo = ctx.createConvolver();
  VOICE.echoWet = ctx.createGain(); VOICE.echoWet.gain.value = 0;
  VOICE.echoIn.connect(VOICE.echo).connect(VOICE.echoWet).connect(VOICE.master);
  VOICE.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = VOICE.noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// Rooms: length of the tail (s), how fast it dies, how loud it is, an early "slap" off close walls.
const ZONES = {
  shop: { len: 0.6, decay: 3.5, wet: 0.22 },
  yard: { len: 0.4, decay: 4, wet: 0.1 },
  alley: { len: 0.5, decay: 3, wet: 0.3, slap: 0.09 },
  junkyard: { len: 1.4, decay: 2.2, wet: 0.12 },
  tiny: { len: 0.14, decay: 6, wet: 0.45 },
  cab: { len: 0.1, decay: 7, wet: 0.2 },
};
const irCache = {};
function impulse(z) {
  return irCache[z] ??= (() => {
    const ctx = audioCtx(), Z = ZONES[z], n = Math.floor(ctx.sampleRate * Z.len), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, Z.decay);
      if (Z.slap) { const s = Math.floor(ctx.sampleRate * Z.slap); for (let i = 0; i < 400 && s + i < n; i++) d[s + i] += (Math.random() * 2 - 1) * 0.8 * (1 - i / 400); }
    }
    return b;
  })();
}
let zoneNow = null;
function zoneFor(my) {
  if (my.hidden !== false && my.hidden != null) return 'tiny';
  if (my.cab) return 'cab';
  if (G.world === 'shop') return my.z < -5 ? 'yard' : 'shop';
  return G.expLoc === 'junkyard' ? 'junkyard' : 'alley';
}
const loopNoise = (ctx, dest) => { const s = ctx.createBufferSource(); s.buffer = VOICE.noise; s.loop = true; s.connect(dest); s.start(); return s; };

const transmitting = () => S.micMode === 'open' || VOICE.ptt || VOICE.radioKey;
export function updateMicTrack() {
  for (const t of VOICE.stream?.getAudioTracks() || []) t.enabled = transmitting();
}
export function setPTT(on) { VOICE.ptt = on; updateMicTrack(); }
export function setRadio(on) {
  if (on && !G.tools.radio) return false;
  if (VOICE.radioKey !== on) sfx.squelch();
  VOICE.radioKey = on; updateMicTrack();
  const p = me(); if (p) p.radio = on;
  return true;
}

function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
  return c;
}

function attach(v, stream) {
  graph();
  const ctx = audioCtx();
  const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {}); // keeps the stream flowing
  const src = ctx.createMediaStreamSource(stream);
  const spk = ctx.createBiquadFilter(); spk.type = 'lowpass'; spk.frequency.value = 20000;
  const prox = ctx.createGain();
  const pan = ctx.createPanner();
  Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1.5, maxDistance: 22, rolloffFactor: 1 });
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.3;
  const shaper = ctx.createWaveShaper(); shaper.curve = distCurve(25);
  const radio = ctx.createGain(); radio.gain.value = 0;
  const an = ctx.createAnalyser(); an.fftSize = 256;
  src.connect(spk);
  spk.connect(prox).connect(pan).connect(VOICE.master);
  pan.connect(VOICE.echoIn);
  spk.connect(bp).connect(shaper).connect(radio).connect(VOICE.master);
  src.connect(an);
  // radio static (grows with distance) and heavy breathing while bleeding out (positional)
  const stBP = ctx.createBiquadFilter(); stBP.type = 'bandpass'; stBP.frequency.value = 2600; stBP.Q.value = 0.8;
  const stat = ctx.createGain(); stat.gain.value = 0;
  loopNoise(ctx, stBP); stBP.connect(stat).connect(VOICE.master);
  const brLP = ctx.createBiquadFilter(); brLP.type = 'lowpass'; brLP.frequency.value = 900;
  const breath = ctx.createGain(); breath.gain.value = 0;
  loopNoise(ctx, brLP); brLP.connect(breath).connect(prox);
  v.chain = { el, src, spk, prox, pan, radio, an, stat, breath, buf: new Uint8Array(an.fftSize) };
}

function peer(pid, initiator) {
  let v = VOICE.peers.get(pid);
  if (v) return v;
  // STUN always: in a mixed game a PeerJS player and a Tailscale player still need a route to each other.
  // Offline it just finds nothing and the local / Tailscale addresses are used.
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  v = { pid, pc, chain: null, iceQ: [], wasRadio: false, level: 0 };
  if (VOICE.stream) for (const t of VOICE.stream.getAudioTracks()) pc.addTrack(t, VOICE.stream);
  else pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = e => { if (e.candidate) send(pid, { t: 'rtc', ice: e.candidate.toJSON() }); };
  pc.ontrack = e => attach(v, e.streams[0] || new MediaStream([e.track]));
  VOICE.peers.set(pid, v);
  if (initiator) (async () => {
    await pc.setLocalDescription(await pc.createOffer());
    send(pid, { t: 'rtc', sdp: pc.localDescription.toJSON() });
  })().catch(e => console.warn('voice offer', e));
  return v;
}

on('rtc', async (m, from) => {
  const v = peer(from, false);
  try {
    if (m.sdp) {
      await v.pc.setRemoteDescription(m.sdp);
      for (const c of v.iceQ.splice(0)) await v.pc.addIceCandidate(c).catch(() => {});
      if (m.sdp.type === 'offer') {
        await v.pc.setLocalDescription(await v.pc.createAnswer());
        send(from, { t: 'rtc', sdp: v.pc.localDescription.toJSON() });
      }
    } else if (m.ice) {
      if (v.pc.remoteDescription) await v.pc.addIceCandidate(m.ice).catch(() => {});
      else v.iceQ.push(m.ice);
    }
  } catch (e) { console.warn('voice signal', e); }
});

// Call whenever the player list changes. The lower id calls the higher one, so each pair connects once.
export function syncVoicePeers() {
  if (NET.role === 'solo') return;
  for (const pid of Object.keys(G.players)) if (pid !== G.me && G.me < pid) peer(pid, true);
  for (const [pid, v] of VOICE.peers) if (!G.players[pid]) { v.pc.close(); v.chain?.el.remove(); VOICE.peers.delete(pid); }
}
export function closeVoice() { for (const v of VOICE.peers.values()) v.pc.close(); VOICE.peers.clear(); }

const loud = (an, buf) => { an.getByteTimeDomainData(buf); let m = 0; for (const b of buf) m = Math.max(m, Math.abs(b - 128)); return m / 128; };
let localBuf;

export function updateVoice(camera) {
  const my = me();
  if (VOICE.analyser) { localBuf ??= new Uint8Array(VOICE.analyser.fftSize); VOICE.level = transmitting() ? loud(VOICE.analyser, localBuf) : 0; }
  if (my) {
    my.talking = VOICE.level > 0.06;
    // how loud you are for the enemies at night (0 = they can't hear you: setting off, or dead)
    my.vl = S.voiceNoise && !my.dead && G.world === 'exp' ? VOICE.level : 0;
  }
  if (!VOICE.master || !my) return;
  const ctx = audioCtx(), now = ctx.currentTime;
  VOICE.master.gain.setTargetAtTime(S.voiceVol, now, 0.1);
  // the dead hear clearly; bleeding / low HP / hiding muffles what you hear
  const lf = my.dead ? 20000 : my.down ? 450 : my.hp < 30 ? 900 : my.hidden !== false && my.hidden != null ? 1500 : 20000;
  VOICE.listener.frequency.setTargetAtTime(lf, now, 0.2);
  // echo of the room you're in (only while it's switched on in the settings)
  const zone = zoneFor(my);
  if (zone !== zoneNow) { zoneNow = zone; VOICE.echo.buffer = impulse(zone); }
  VOICE.echoWet.gain.setTargetAtTime(S.echo ? ZONES[zone].wet : 0, now, 0.3);
  camera.updateMatrixWorld();
  const t = performance.now() / 1000;
  for (const v of VOICE.peers.values()) {
    const p = G.players[v.pid], c = v.chain;
    if (!p || !c) continue;
    v.level = loud(c.an, c.buf);
    const same = p.world === my.world;
    const dist = Math.hypot(p.x - my.x, p.z - my.z);
    // dead players: the living can't hear them, but the dead hear each other everywhere (like ghosts on a call)
    const ghostChat = p.dead && my.dead, muted = p.dead && !my.dead;
    if (ghostChat) _v.set(0, 0, -1); else camera.worldToLocal(_v.set(p.x, p.y, p.z));
    c.pan.positionX.setTargetAtTime(_v.x, now, 0.05);
    c.pan.positionY.setTargetAtTime(_v.y, now, 0.05);
    c.pan.positionZ.setTargetAtTime(_v.z, now, 0.05);
    c.prox.gain.setTargetAtTime(muted ? 0 : ghostChat ? 1 : same && !p.radio ? 1 : same ? 0.5 : 0, now, 0.08);
    const radioOn = !p.dead && p.radio && G.tools.radio > 0;
    if (radioOn !== v.wasRadio) { v.wasRadio = radioOn; if (radioOn || v.level < 0.5) sfx.squelch(); }
    c.radio.gain.setTargetAtTime(radioOn ? 0.9 : 0, now, 0.03);
    // static on the radio: more crackle the further away they are
    c.stat.gain.setTargetAtTime(radioOn ? Math.min(0.35, 0.03 + dist / 120) * (0.6 + Math.random() * 0.4) : 0, now, 0.05);
    // heavy breathing while bleeding out, weaker as the 30 s run out
    const bleeding = p.down && !p.dead && same && !my.dead;
    const br = bleeding ? 0.22 * (0.3 + 0.7 * Math.min(1, (p.bleed || 0) / 30)) * Math.pow(Math.max(0, Math.sin(t * Math.PI * 0.9)), 2) : 0;
    c.breath.gain.setTargetAtTime(br, now, 0.05);
    c.spk.frequency.setTargetAtTime(p.dead ? 20000 : p.down ? 420 : p.hp < 30 ? 1200 : 20000, now, 0.2);
  }
}

export const speaking = pid => (VOICE.peers.get(pid)?.level || 0) > 0.06;
