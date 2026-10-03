/**
 * Tempo (and, for display only, key) of an audio file, estimated in the browser.
 * Tempo: onset-strength envelope of the low end → autocorrelation over 70–180 BPM.
 * Key: average chroma (FFT) matched against Krumhansl profiles. Rough, so the UI marks both as AUTO.
 */
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface AudioAnalysis {
  bpm: number | null;
  key: string | null;
}

export async function analyzeAudio(url: string): Promise<AudioAnalysis> {
  const buf = await (await fetch(url, { credentials: "same-origin" })).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const audio = await ctx.decodeAudioData(buf);
  // Analyse up to 90 s from 15 % into the track (skips quiet intros).
  const rate = 11025;
  const start = Math.min(audio.duration * 0.15, Math.max(0, audio.duration - 90));
  const dur = Math.min(90, audio.duration - start);
  const off = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start(0, start, dur);
  const mono = (await off.startRendering()).getChannelData(0);
  return { bpm: tempo(mono, rate), key: key(mono, rate) };
}

function tempo(x: Float32Array, rate: number): number | null {
  const hop = 128;
  const env: number[] = [];
  let prev = 0;
  let lp = 0;
  for (let i = 0; i + hop <= x.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) {
      lp += 0.08 * (x[j] - lp); // gentle low-pass: kick / bass carry the pulse
      e += lp * lp + 0.25 * x[j] * x[j];
    }
    e = Math.log1p(e * 100);
    env.push(Math.max(0, e - prev)); // onset strength
    prev = e;
  }
  const fps = rate / hop;
  const n = env.length;
  if (n < fps * 8) return null;
  const mean = env.reduce((a, b) => a + b, 0) / n;
  const o = env.map((v) => v - mean);
  let best = 0;
  let bestBpm = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 * fps) / bpm;
    let s = 0;
    for (const k of [1, 2, 4]) {
      const L = lag * k;
      const l0 = Math.floor(L);
      const f = L - l0;
      let acc = 0;
      for (let i = 0; i + l0 + 1 < n; i++) acc += o[i] * (o[i + l0] * (1 - f) + o[i + l0 + 1] * f);
      s += acc / (k === 1 ? 1 : 2);
    }
    // Mild preference for the 90–150 range most pop sits in.
    const w = 1 - 0.15 * Math.min(1, Math.abs(bpm - 120) / 60);
    if (s * w > best) {
      best = s * w;
      bestBpm = bpm;
    }
  }
  return bestBpm ? Math.round(bestBpm) : null;
}

function key(x: Float32Array, rate: number): string | null {
  const N = 4096;
  const chroma = new Array(12).fill(0);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const step = Math.max(N, Math.floor(x.length / 120));
  for (let off = 0; off + N <= x.length; off += step) {
    for (let i = 0; i < N; i++) {
      re[i] = x[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 1; b < N / 2; b++) {
      const f = (b * rate) / N;
      if (f < 55 || f > 2000) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      chroma[((Math.round(midi) % 12) + 12) % 12] += Math.sqrt(re[b] * re[b] + im[b] * im[b]);
    }
  }
  if (!chroma.some((v) => v > 0)) return null;
  let best = -Infinity;
  let name: string | null = null;
  for (let t = 0; t < 12; t++) {
    for (const [profile, suffix] of [
      [MAJOR, ""],
      [MINOR, "m"],
    ] as const) {
      const r = corr(chroma, profile.map((_, i) => profile[(i - t + 12) % 12]));
      if (r > best) {
        best = r;
        name = NAMES[t] + suffix;
      }
    }
  }
  return name;
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
export { tempo as estimateTempo, key as estimateKey };
