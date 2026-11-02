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
}

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
  spk.connect(bp).connect(shaper).connect(radio).connect(VOICE.master);
  src.connect(an);
  v.chain = { el, src, spk, prox, pan, radio, an, buf: new Uint8Array(an.fftSize) };
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
  if (my) my.talking = VOICE.level > 0.06;
  if (!VOICE.master || !my) return;
  const ctx = audioCtx(), now = ctx.currentTime;
  VOICE.master.gain.setTargetAtTime(S.voiceVol, now, 0.1);
  const lf = my.down ? 450 : my.hp < 30 ? 900 : my.hidden ? 1500 : 20000;
  VOICE.listener.frequency.setTargetAtTime(lf, now, 0.2);
  camera.updateMatrixWorld();
  for (const v of VOICE.peers.values()) {
    const p = G.players[v.pid], c = v.chain;
    if (!p || !c) continue;
    v.level = loud(c.an, c.buf);
    const same = p.world === my.world;
    camera.worldToLocal(_v.set(p.x, p.y, p.z));
    c.pan.positionX.setTargetAtTime(_v.x, now, 0.05);
    c.pan.positionY.setTargetAtTime(_v.y, now, 0.05);
    c.pan.positionZ.setTargetAtTime(_v.z, now, 0.05);
    c.prox.gain.setTargetAtTime(same && !p.radio ? 1 : same ? 0.5 : 0, now, 0.08);
    const radioOn = p.radio && G.tools.radio > 0;
    if (radioOn !== v.wasRadio) { v.wasRadio = radioOn; if (radioOn || v.level < 0.5) sfx.squelch(); }
    c.radio.gain.setTargetAtTime(radioOn ? 0.9 : 0, now, 0.03);
    c.spk.frequency.setTargetAtTime(p.down ? 420 : p.hp < 30 ? 1200 : 20000, now, 0.2);
  }
}

export const speaking = pid => (VOICE.peers.get(pid)?.level || 0) > 0.06;
