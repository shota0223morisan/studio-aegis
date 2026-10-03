import type { MidiClip } from "./api";

/** Tiny WebAudio preview of a MIDI clip (not meant to sound good — just to hear the idea). */
let ctx: AudioContext | null = null;
let stopCurrent: (() => void) | null = null;

export function playClip(clip: MidiClip, onEnd: () => void): () => void {
  stopCurrent?.();
  ctx ??= new AudioContext();
  const ac = ctx;
  void ac.resume();
  const spb = 60 / (clip.bpm || 120);
  const t0 = ac.currentTime + 0.08;
  const out = ac.createGain();
  out.gain.value = 0.35;
  out.connect(ac.destination);
  const noise = noiseBuffer(ac);
  let end = 0;
  for (const track of clip.tracks) {
    const drums = track.channel === 9;
    for (const n of track.notes) {
      const at = t0 + n.s * spb;
      const dur = Math.max(0.05, n.d * spb);
      const vel = n.v / 127;
      end = Math.max(end, at + dur);
      if (drums) drum(ac, out, noise, n.p, at, vel);
      else tone(ac, out, n.p, at, dur, vel, clip.kind === "bass");
    }
  }
  const timer = window.setTimeout(() => stop(), (end - ac.currentTime + 0.3) * 1000);
  function stop() {
    window.clearTimeout(timer);
    out.disconnect();
    if (stopCurrent === stop) stopCurrent = null;
    onEnd();
  }
  stopCurrent = stop;
  return stop;
}

function tone(ac: AudioContext, out: AudioNode, p: number, at: number, dur: number, vel: number, bass: boolean) {
  const osc = ac.createOscillator();
  osc.type = bass ? "sawtooth" : "triangle";
  osc.frequency.value = 440 * 2 ** ((p - 69) / 12);
  const g = ac.createGain();
  const peak = 0.22 * vel;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.01);
  g.gain.setTargetAtTime(peak * 0.6, at + 0.02, 0.1);
  g.gain.setTargetAtTime(0, at + dur, 0.05);
  let node: AudioNode = osc;
  if (bass) {
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    osc.connect(lp);
    node = lp;
  }
  node.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.3);
}

function drum(ac: AudioContext, out: AudioNode, noise: AudioBuffer, p: number, at: number, vel: number) {
  if (p === 35 || p === 36) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    g.gain.setValueAtTime(vel, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + 0.32);
    return;
  }
  const src = ac.createBufferSource();
  src.buffer = noise;
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  const hat = p === 42 || p === 44 || p === 46 || p === 51 || p === 49 || p === 57 || p === 59;
  f.type = hat ? "highpass" : "bandpass";
  f.frequency.value = hat ? 7000 : p === 38 || p === 40 ? 1800 : 400;
  const len = p === 46 || p === 49 || p === 57 ? 0.4 : hat ? 0.05 : 0.18;
  g.gain.setValueAtTime(vel * (hat ? 0.35 : 0.8), at);
  g.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + len + 0.02);
}

let noiseCache: AudioBuffer | null = null;
function noiseBuffer(ac: AudioContext) {
  if (noiseCache) return noiseCache;
  const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseCache = b);
}
