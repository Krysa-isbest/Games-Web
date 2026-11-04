// Voice chat settings side: microphone list, mic test with a level meter, push-to-talk state.
// The actual sending of voice comes with online play (WebRTC audio tracks on the same connection).
import { S } from './state.js';
import { down } from './keys.js';

let stream = null, actx = null, analyser = null, buf = null;

export async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Microphone ${i + 1}` }));
  } catch { return []; }
}
export async function startMicTest() {
  stopMicTest();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.mic ? { exact: S.mic } : undefined, noiseSuppression: S.noise, echoCancellation: true, autoGainControl: true } });
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const src = actx.createMediaStreamSource(stream);
  const gain = actx.createGain(); gain.gain.value = S.micVol;
  analyser = actx.createAnalyser(); analyser.fftSize = 512;
  buf = new Uint8Array(analyser.fftSize);
  src.connect(gain); gain.connect(analyser);
  return true;
}
export function micLevel() {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buf);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
  return Math.min(1, peak / 100 * S.micVol);
}
export function stopMicTest() {
  stream?.getTracks().forEach(t => t.stop());
  actx?.close();
  stream = actx = analyser = null;
}
// is the local player talking right now?
export function talking() { return S.voice && (S.voiceMode === 'open' || down('ptt')); }
