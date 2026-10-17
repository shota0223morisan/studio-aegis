/**
 * Chord progression of an audio file, estimated in the browser.
 *
 * 1. Tempo and beat grid from the onset envelope (the same tempo estimate the BPM uses).
 * 2. Chroma (12 pitch classes) per frame, plus a separate bass chroma for the root.
 * 3. Per half bar: match major / minor triads, smoothed so chords don't flicker (Viterbi).
 * 4. Key from the overall chroma; chords are stored relative to it (major, or a minor song's
 *    relative major — the same convention as the song's key), so they read as degrees.
 *
 * Rough by nature (no 7ths, inversions only through the bass), so the UI marks it as AUTO.
 */
import { estimateTempo } from "./audio";
import { chordLabel, formatProgression, parseProgression, type Chord } from "./theory";

export interface ChordScan {
  source: "audio" | "ai";
  /** Semitones above C (major, or the relative major of a minor key). */
  key: number;
  minor?: boolean;
  bpm?: number;
  /** Repeating 4-bar progressions, most frequent first. `at` is the first time it's heard (s). */
  patterns?: { prog: string; count: number; at: number }[];
  /** The whole song, 4 bars per row. */
  timeline?: { at: number; prog: string }[];
  /** From the AI: per section. */
  sections?: { name: string; prog: string }[];
  note?: string;
  at: string;
}

const RATE = 11025;
const N = 4096;
const HOP = 1024;
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const mod12 = (n: number) => ((n % 12) + 12) % 12;

export async function scanChords(url: string): Promise<ChordScan> {
  const buf = await (await fetch(url, { credentials: "same-origin" })).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(buf);
  const dur = Math.min(audio.duration, 8 * 60);
  const off = new OfflineAudioContext(1, Math.ceil(dur * RATE), RATE);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start(0, 0, dur);
  const x = (await off.startRendering()).getChannelData(0);
  return analyse(x);
}

/** Exposed for tests (works on any mono signal at 11025 Hz). */
export function analyse(x: Float32Array): ChordScan {
  const mid = Math.min(x.length * 0.15, Math.max(0, x.length - 90 * RATE));
  const bpm = estimateTempo(x.subarray(Math.floor(mid), Math.floor(mid + 90 * RATE)), RATE) ?? 120;
  const { chroma, bass, energy } = chromagram(x);
  const fps = RATE / HOP;
  const beat = (60 / bpm) * fps; // frames per beat
  const phase = beatPhase(x, bpm);

  // Half-bar segments on the beat grid.
  const beats: number[] = [];
  for (let t = phase * fps; t < chroma.length; t += beat) beats.push(t);
  const segAvg = (a: number, b: number, src: Float64Array[]) => {
    const out = new Float64Array(12);
    const i0 = Math.max(0, Math.round(a));
    const i1 = Math.min(src.length, Math.round(b));
    for (let i = i0; i < i1; i++) for (let k = 0; k < 12; k++) out[k] += src[i][k];
    return out;
  };
  const beatChroma = beats.map((t) => segAvg(t, t + beat, chroma));
  // Which beat is the downbeat: the offset where the harmony changes most.
  let barOff = 0;
  let bestNov = -1;
  for (let o = 0; o < 4; o++) {
    let nov = 0;
    for (let i = o; i < beatChroma.length; i += 4) if (i > 0) nov += dist(beatChroma[i], beatChroma[i - 1]);
    if (nov > bestNov) (bestNov = nov), (barOff = o);
  }
  // One segment per beat (works even when the tempo is read at half speed); Viterbi keeps it steady.
  const segs: { t: number; c: Float64Array; b: Float64Array; e: number }[] = [];
  // Half-beat steps, so a tempo read at half speed still catches every chord change.
  const step = beat / 2;
  for (let i = barOff; i < beats.length; i++) {
    for (const a of [beats[i], beats[i] + step]) {
      let e = 0;
      for (let k = Math.round(a); k < Math.min(energy.length, Math.round(a + step)); k++) e += energy[k];
      segs.push({ t: a / fps, c: segAvg(a, a + step, chroma), b: segAvg(a, a + step, bass), e: e / Math.max(1, step) });
    }
  }

  const loud = Math.max(...segs.map((s) => s.e), 1e-9);
  const states = 25;
  const emit = segs.map((s) => {
    const c = normalise(s.c);
    const b = normalise(s.b);
    const out = new Float64Array(states);
    for (let r = 0; r < 12; r++) {
      out[r] = triad(c, r, 4) + 0.35 * b[r]; // major
      out[12 + r] = triad(c, r, 3) + 0.35 * b[r]; // minor
    }
    out[24] = s.e < loud * 0.02 ? 2 : 0.2;
    return out;
  });
  const path = viterbi(emit, 0.25);

  // Key: the major key (or relative major) the detected chords fit best; the overall chroma
  // decides major vs minor and breaks ties.
  const total = new Array(12).fill(0);
  for (const s of segs) for (let k = 0; k < 12; k++) total[k] += s.c[k];
  const profile = keyOf(total);
  const FIT: [number, boolean, number][] = [[0, false, 1], [5, false, 0.9], [7, false, 0.9], [9, true, 0.9], [2, true, 0.8], [4, true, 0.7]];
  let key = profile.minor ? mod12(profile.tonic + 3) : profile.tonic;
  let bestFit = -1;
  for (let k = 0; k < 12; k++) {
    let fit = 0;
    for (const st of path) {
      if (st === 24) continue;
      const root = mod12((st % 12) - k);
      const m = FIT.find(([r, minor]) => r === root && minor === st >= 12);
      if (m) fit += m[2];
    }
    if (k === key) fit += 0.5;
    if (fit > bestFit) (bestFit = fit), (key = k);
  }
  const minor = profile.minor && mod12(profile.tonic + 3) === key;
  const chords: (Chord | null)[] = path.map((st) => (st === 24 ? null : { root: mod12((st % 12) - key), quality: st < 12 ? "maj" : "min", ext: "" }));

  // Bars (4 beats = 8 steps) → tokens like "IV" or "IV V".
  const bars: { at: number; token: string }[] = [];
  for (let i = 0; i + 8 <= chords.length; i += 8) {
    // A chord held for less than a beat at a bar edge is spill-over from the next / previous bar.
    const runs: { l: string; n: number }[] = [];
    for (const c of chords.slice(i, i + 8)) {
      const l = c ? chordLabel(c) : "N.C.";
      if (runs.length && runs[runs.length - 1].l === l) runs[runs.length - 1].n++;
      else runs.push({ l, n: 1 });
    }
    const kept = runs.filter((r, k) => r.n >= 2 || runs.length === 1 || (k > 0 && k < runs.length - 1 && r.n >= 2));
    const labels: string[] = [];
    for (const r of kept.length ? kept : runs) if (labels[labels.length - 1] !== r.l) labels.push(r.l);
    bars.push({ at: segs[i].t, token: labels.join(" ") });
  }
  // Drop silence at both ends.
  while (bars.length && bars[0].token === "N.C.") bars.shift();
  while (bars.length && bars[bars.length - 1].token === "N.C.") bars.pop();

  const flat = (tokens: string[]) => {
    const out: string[] = [];
    for (const t of tokens.join(" ").split(" ")) if (out[out.length - 1] !== t) out.push(t);
    // "I V VIm IV I V VIm IV" (a loop heard twice, e.g. tempo read at half speed) → once.
    for (let n = 2; n <= out.length / 2; n++) {
      if (out.length % n === 0 && out.every((t, i) => t === out[i % n])) return out.slice(0, n).join(" - ");
    }
    return out.join(" - ");
  };
  const timeline: { at: number; prog: string }[] = [];
  for (let i = 0; i < bars.length; i += 4) timeline.push({ at: Math.round(bars[i].at), prog: flat(bars.slice(i, i + 4).map((b) => b.token)) });

  // Repeating 4-bar progressions (windows starting on any bar, counted without overlap).
  const counts = new Map<string, { count: number; at: number; last: number }>();
  for (let i = 0; i + 4 <= bars.length; i++) {
    const win = bars.slice(i, i + 4).map((b) => b.token);
    if (win.includes("N.C.")) continue;
    const prog = flat(win);
    if (!prog.includes(" - ")) continue; // one chord for 4 bars isn't a progression
    const c = counts.get(prog);
    if (!c) counts.set(prog, { count: 1, at: bars[i].at, last: i });
    else if (i - c.last >= 4) (c.count += 1), (c.last = i);
  }
  const patterns = [...counts.entries()]
    .filter(([, c]) => c.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || a[1].at - b[1].at)
    .reduce<{ prog: string; count: number; at: number }[]>((acc, [prog, c]) => {
      // Skip rotations of a loop already listed ("I - V - VIm - IV" vs "V - VIm - IV - I").
      if (!acc.some((p) => isRotation(p.prog, prog))) acc.push({ prog, count: c.count, at: Math.round(c.at) });
      return acc;
    }, [])
    .slice(0, 4);

  return { source: "audio", key, minor, bpm: Math.round(bpm), patterns, timeline, at: new Date().toISOString() };
}

function chromagram(x: Float32Array) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const pcOf = new Int8Array(N / 2).fill(-1);
  const isBass = new Uint8Array(N / 2);
  for (let b = 1; b < N / 2; b++) {
    const f = (b * RATE) / N;
    if (f < 40 || f > 2000) continue;
    pcOf[b] = mod12(Math.round(69 + 12 * Math.log2(f / 440)));
    if (f < 200) isBass[b] = 1;
  }
  const mag = new Float64Array(N / 2);
  const pre = new Float64Array(N / 2 + 1);
  const chroma: Float64Array[] = [];
  const bass: Float64Array[] = [];
  const energy: number[] = [];
  for (let off = 0; off + N <= x.length; off += HOP) {
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = x[off + i];
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    fft(re, im);
    // Keep only what stands out from the nearby spectrum (tones), not broadband noise / drums.
    for (let b = 0; b < N / 2; b++) mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
    pre[0] = 0;
    for (let b = 0; b < N / 2; b++) pre[b + 1] = pre[b] + mag[b];
    const c = new Float64Array(12);
    const bs = new Float64Array(12);
    for (let b = 1; b < N / 2; b++) {
      const pc = pcOf[b];
      if (pc < 0) continue;
      const lo = Math.max(0, b - 24);
      const hi = Math.min(N / 2, b + 25);
      const local = (pre[hi] - pre[lo]) / (hi - lo);
      const peak = mag[b] - 1.5 * local;
      if (peak <= 0) continue;
      const m = Math.log1p(20 * peak);
      if (isBass[b]) bs[pc] += m;
      else c[pc] += m;
    }
    chroma.push(c);
    bass.push(bs);
    energy.push(e / N);
  }
  return { chroma, bass, energy };
}

/** Beat phase (s): the offset of the beat grid that lines up with the most onsets. */
function beatPhase(x: Float32Array, bpm: number): number {
  const hop = 128;
  const env: number[] = [];
  let prev = 0;
  let lp = 0;
  const end = Math.min(x.length, 60 * RATE);
  for (let i = 0; i + hop <= end; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) {
      lp += 0.08 * (x[j] - lp);
      e += lp * lp + 0.25 * x[j] * x[j];
    }
    e = Math.log1p(e * 100);
    env.push(Math.max(0, e - prev));
    prev = e;
  }
  const fps = RATE / hop;
  const period = (60 / bpm) * fps;
  let best = 0;
  let bestP = 0;
  for (let p = 0; p < period; p += 1) {
    let s = 0;
    for (let t = p; t < env.length; t += period) s += env[Math.round(t)] ?? 0;
    if (s > best) (best = s), (bestP = p);
  }
  return bestP / fps;
}

function keyOf(chroma: number[]): { tonic: number; minor: boolean } {
  let best = -Infinity;
  let tonic = 0;
  let minor = false;
  for (let t = 0; t < 12; t++) {
    for (const [profile, m] of [
      [MAJOR, false],
      [MINOR, true],
    ] as const) {
      const r = corr(chroma, profile.map((_, i) => profile[mod12(i - t)]));
      if (r > best) (best = r), (tonic = t), (minor = m);
    }
  }
  return { tonic, minor };
}

/** Cosine-like match of a normalised chroma against a triad (root, third, fifth). */
function triad(c: Float64Array, root: number, third: number): number {
  const tones = [root, mod12(root + third), mod12(root + 7)];
  let inside = 0;
  let outside = 0;
  for (let k = 0; k < 12; k++) {
    if (tones.includes(k)) inside += c[k] * (k === root ? 1.1 : 1);
    else outside += c[k];
  }
  return inside / 3 - outside / 9;
}

function viterbi(emit: Float64Array[], penalty: number): number[] {
  if (!emit.length) return [];
  const S = emit[0].length;
  let score = Float64Array.from(emit[0]);
  const back: Int16Array[] = [];
  for (let t = 1; t < emit.length; t++) {
    const next = new Float64Array(S);
    const bp = new Int16Array(S);
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    for (let s = 0; s < S; s++) {
      const stay = score[s];
      const move = score[bestPrev] - penalty;
      if (stay >= move) (next[s] = stay + emit[t][s]), (bp[s] = s);
      else (next[s] = move + emit[t][s]), (bp[s] = bestPrev);
    }
    back.push(bp);
    score = next;
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (score[k] > score[s]) s = k;
  const path = [s];
  for (let t = back.length - 1; t >= 0; t--) path.push((s = back[t][s]));
  return path.reverse();
}

function normalise(v: Float64Array): Float64Array {
  const max = Math.max(...v);
  return max > 0 ? v.map((x) => x / max) : v;
}

function dist(a: Float64Array, b: Float64Array): number {
  const na = normalise(a);
  const nb = normalise(b);
  let d = 0;
  for (let k = 0; k < 12; k++) d += Math.abs(na[k] - nb[k]);
  return d;
}

function isRotation(a: string, b: string): boolean {
  const pa = a.split(" - ");
  const pb = b.split(" - ");
  if (pa.length !== pb.length) return false;
  return pa.some((_, i) => [...pa.slice(i), ...pa.slice(0, i)].join(" - ") === b);
}

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar;
        im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar;
        im[i + j] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** The AI's answer (chord names in the original key) → degrees, like the audio scan. */
export function fromAi(r: { known: boolean; key: string; sections: { name: string; chords: string }[]; note?: string }): ChordScan {
  const at = new Date().toISOString();
  if (!r.known) return { source: "ai", key: 0, sections: [], note: r.note, at };
  const m = r.key.trim().match(/^([A-Ga-g])([#♯b♭]?)(m(?!aj))?/);
  let key: number;
  let minor = false;
  if (m) {
    const tonic = mod12("C D EF G A B".indexOf(m[1].toUpperCase()) + (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0));
    minor = Boolean(m[3]);
    key = minor ? mod12(tonic + 3) : tonic;
  } else {
    // No key given: the major key the chords fit best.
    const all = r.sections.map((s) => s.chords).join(" ");
    let best = -1;
    key = 0;
    for (let k = 0; k < 12; k++) {
      const fit = parseProgression(all, k).filter((c) => [0, 2, 4, 5, 7, 9].includes(c.root)).length;
      if (fit > best) (best = fit), (key = k);
    }
  }
  const sections = r.sections.map((s) => ({ name: s.name, prog: formatProgression(parseProgression(s.chords, key)) })).filter((s) => s.prog);
  return { source: "ai", key, minor, sections, note: r.note, at };
}
