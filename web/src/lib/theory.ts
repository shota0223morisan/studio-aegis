/**
 * Chords for the FRAME stage: one-line input (degrees / roman numerals / chord names), display,
 * chord → MIDI generators, chord detection from MIDI, and humanize.
 *
 * Everything is relative to the song's key (major; a minor song is written from its relative major,
 * e.g. Am → C and "6m 4 5 1"). Degrees default to the diatonic chord: 1=I 2=IIm 3=IIIm 4=IV 5=V 6=VIm 7=VIIm(♭5).
 */
import type { MidiNote } from "./api";

export const NOTE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const KEY_OPTIONS = NOTE_NAMES.map((n, i) => ({ value: i, label: `${n} / ${NOTE_NAMES[(i + 9) % 12]}m` }));

export type Quality = "maj" | "min" | "dim" | "aug" | "sus4" | "sus2";
export type Ext = "" | "7" | "M7" | "6" | "9" | "add9";

export interface Chord {
  /** Root in semitones above the key's tonic (0–11). */
  root: number;
  quality: Quality;
  ext: Ext;
  /** Slash bass, semitones above the tonic. */
  bass?: number;
}

const DIATONIC_ROOT = [0, 2, 4, 5, 7, 9, 11];
const DIATONIC_QUALITY: Quality[] = ["maj", "min", "min", "maj", "maj", "min", "dim"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const INTERVALS: Record<Quality, number[]> = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7] };

const mod12 = (n: number) => ((n % 12) + 12) % 12;

function degreeChord(deg: number, acc: number, quality?: Quality): Chord {
  const root = mod12(DIATONIC_ROOT[deg - 1] + acc);
  // Borrowed chords (♭III, ♭VI, ♭VII, ♭II) are major; #IV is diminished.
  const q = quality ?? (acc < 0 ? "maj" : acc > 0 ? "dim" : DIATONIC_QUALITY[deg - 1]);
  return { root, quality: q, ext: "" };
}

function suffix(text: string): { quality?: Quality; ext: Ext } {
  const t = text.toLowerCase();
  let quality: Quality | undefined;
  let ext: Ext = "";
  if (/^(maj7|m7maj|△7|M7)/.test(text) || /^maj7/.test(t)) ext = "M7";
  else if (/^m7/.test(text)) (quality = "min"), (ext = "7");
  else if (/^m(?!aj)/.test(text)) quality = "min";
  if (/dim|°|o(?!m)/.test(t)) quality = "dim";
  if (/aug|\+/.test(t)) quality = "aug";
  if (/sus4|sus(?!2)/.test(t)) quality = "sus4";
  if (/sus2/.test(t)) quality = "sus2";
  if (!ext) {
    if (/add9/.test(t)) ext = "add9";
    else if (/(^|[^a-z])9/.test(t)) ext = "9";
    else if (/6/.test(t)) ext = "6";
    else if (/7|7th/.test(t)) ext = "7";
  }
  return { quality, ext };
}

/** Normalise Japanese words / symbols to ASCII markers. */
function normalise(text: string): { text: string; postfixAccidentals: boolean } {
  let t = text.normalize("NFKC");
  const postfixAccidentals = /[1-7]\s*(フラット|シャープ)/.test(t);
  t = t
    .replace(/フラット/g, "b")
    .replace(/シャープ/g, "#")
    .replace(/メジャー|メジャ/g, "M")
    .replace(/マイナー/g, "m")
    .replace(/セブンス|セブン/g, "7th")
    .replace(/[♭]/g, "b")
    .replace(/[♯]/g, "#")
    .replace(/[→⇒>、,／|｜]/g, " ")
    .replace(/[–—−ー]/g, "-");
  return { text: t, postfixAccidentals };
}

const ROMAN_RE = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/;
const NAME_RE = /^([A-G])(b|#)?(.*?)(?:\/([A-G])(b|#)?)?$/;
const DEGREE_TOKEN_RE = /^(b|#|M|m)?(b|#)?([1-7])(b|#)?(.*?)(?:\/(b|#)?([1-7]))?$/;

/** One chord token with separators around it ("2m7", "♭7", "IV", "Am7", "1/3", "M6"). */
function parseToken(tok: string, key: number, postfix: boolean): Chord | null {
  if (!tok) return null;
  let m = tok.match(ROMAN_RE);
  if (m) {
    const deg = ROMAN.indexOf(m[2].toUpperCase()) + 1;
    const acc = m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0;
    const lower = m[2] === m[2].toLowerCase();
    const sx = suffix(m[3]);
    return { ...degreeChord(deg, acc, sx.quality ?? (lower ? "min" : "maj")), ext: sx.ext };
  }
  m = tok.match(DEGREE_TOKEN_RE);
  if (m) {
    const pre = m[1];
    const acc =
      (pre === "b" || m[2] === "b" ? -1 : 0) + (pre === "#" || m[2] === "#" ? 1 : 0) + (postfix || !m[5] ? (m[4] === "b" ? -1 : m[4] === "#" ? 1 : 0) : 0);
    const deg = Number(m[3]);
    const sx = suffix((m[4] && !postfix && m[5] ? m[4] : "") + m[5]);
    const forced: Quality | undefined = pre === "M" ? "maj" : pre === "m" ? "min" : undefined;
    const c = { ...degreeChord(deg, acc, forced ?? sx.quality), ext: sx.ext };
    if (m[7]) c.bass = mod12(DIATONIC_ROOT[Number(m[7]) - 1] + (m[6] === "b" ? -1 : m[6] === "#" ? 1 : 0));
    return c;
  }
  m = tok.match(NAME_RE);
  if (m) {
    const root = mod12("C D EF G A B".indexOf(m[1]) + (m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0) - key);
    const sx = suffix(m[3]);
    const c: Chord = { root, quality: sx.quality ?? "maj", ext: sx.ext };
    if (m[4]) c.bass = mod12("C D EF G A B".indexOf(m[4]) + (m[5] === "b" ? -1 : m[5] === "#" ? 1 : 0) - key);
    return c;
  }
  return null;
}

/** "4536" / "453M6" / "6b7b1" (no separators): every digit is a chord. */
function parseCompact(text: string, postfix: boolean): Chord[] {
  const out: Chord[] = [];
  const re = postfix ? /(M|m)?([1-7])(b|#)?(7th)?/g : /(b|#)?(M|m)?(b|#)?([1-7])(7th)?/g;
  for (const m of text.matchAll(re)) {
    if (postfix) {
      const deg = Number(m[2]);
      const acc = m[3] === "b" ? -1 : m[3] === "#" ? 1 : 0;
      out.push({ ...degreeChord(deg, acc, m[1] === "M" ? "maj" : m[1] === "m" ? "min" : undefined), ext: m[4] ? "7" : "" });
    } else {
      const deg = Number(m[4]);
      const acc = (m[1] === "b" || m[3] === "b" ? -1 : 0) + (m[1] === "#" || m[3] === "#" ? 1 : 0);
      out.push({ ...degreeChord(deg, acc, m[2] === "M" ? "maj" : m[2] === "m" ? "min" : undefined), ext: m[5] ? "7" : "" });
    }
  }
  return out;
}

/** Parse one progression ("4536", "IV-V-iii-vi", "Am F C G", "4 5 3m7 6m", "6フラット7フラット1"). */
export function parseProgression(input: string, key = 0): Chord[] {
  const { text, postfixAccidentals } = normalise(input);
  const trimmed = text.trim();
  if (!trimmed) return [];
  const hasSeparators = /[\s-]/.test(trimmed);
  const looksCompact = !hasSeparators && /^[b#Mm1-7]+(7th)?$/.test(trimmed.replace(/7th/g, ""));
  if (looksCompact || (!hasSeparators && /^[b#Mm1-7]+$/.test(trimmed))) return parseCompact(trimmed, postfixAccidentals);
  const out: Chord[] = [];
  for (const tok of trimmed.split(/[\s-]+/).filter(Boolean)) {
    // Three or more bare degrees inside a spaced line ("4536 1645") are still compact;
    // anything shorter is one chord with its suffix ("3m7", "57" = V7, "4M7").
    if (/^([b#]?[1-7][b#]?){3,}$/.test(tok)) out.push(...parseCompact(tok, postfixAccidentals));
    else {
      const c = parseToken(tok, key, postfixAccidentals);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Roman-numeral label: "IV", "VIm", "♭VII", "IIm7", "IVM7", "I/III". */
export function chordLabel(c: Chord): string {
  const idx = DIATONIC_ROOT.indexOf(c.root);
  let base: string;
  if (idx >= 0) base = ROMAN[idx];
  else {
    const up = DIATONIC_ROOT.indexOf(mod12(c.root + 1));
    base = `♭${ROMAN[up]}`;
  }
  const q = c.quality === "min" ? "m" : c.quality === "dim" ? "dim" : c.quality === "aug" ? "aug" : c.quality === "sus4" ? "sus4" : c.quality === "sus2" ? "sus2" : "";
  const label = base + (c.quality === "dim" && c.ext === "7" ? "m7♭5" : q + c.ext);
  return c.bass !== undefined && c.bass !== c.root ? `${label}/${chordLabel({ root: c.bass, quality: "maj", ext: "" })}` : label;
}

/** Chord name in the key: "F", "Em7", "B♭". */
export function chordName(c: Chord, key: number): string {
  const q = c.quality === "min" ? "m" : c.quality === "dim" ? "dim" : c.quality === "aug" ? "aug" : c.quality === "sus4" ? "sus4" : c.quality === "sus2" ? "sus2" : "";
  const name = NOTE_NAMES[mod12(c.root + key)] + (c.quality === "dim" && c.ext === "7" ? "m7♭5" : q + c.ext);
  return c.bass !== undefined && c.bass !== c.root ? `${name}/${NOTE_NAMES[mod12(c.bass + key)]}` : name;
}

export const formatProgression = (chords: Chord[]) => chords.map(chordLabel).join(" - ");

/** Pitch classes (absolute, 0–11) of a chord in a key. */
export function chordTones(c: Chord, key: number): number[] {
  const root = mod12(c.root + key);
  const iv = [...INTERVALS[c.quality]];
  if (c.ext === "7") iv.push(c.quality === "dim" ? 10 : 10);
  if (c.ext === "M7") iv.push(11);
  if (c.ext === "6") iv.push(9);
  if (c.ext === "9") iv.push(10, 14);
  if (c.ext === "add9") iv.push(14);
  return iv.map((i) => (root + i) % 12);
}

// ---- One-line input for several sections ("サビ 4536 A: 1645 B 2536") ----

const SECTION_ALIASES: Record<string, string[]> = {
  A: ["Aメロ", "A"],
  B: ["Bメロ", "B"],
  サビ: ["サビ", "Chorus", "コーラス"],
  Intro: ["イントロ", "Intro"],
  Outro: ["アウトロ", "Outro"],
  間奏: ["間奏", "Interlude"],
  Dメロ: ["Dメロ", "Cメロ"],
  落ちサビ: ["落ちサビ"],
};

/** Split a one-line input into { section → progression text }. Lines without a label go to `fallback`. */
export function splitBySection(input: string, sections: string[], fallback: string): Record<string, string> {
  const text = input.normalize("NFKC");
  const labels: { re: string; name: string }[] = [];
  for (const name of sections) {
    const aliases = new Set([name, ...(SECTION_ALIASES[name] ?? [])]);
    for (const a of aliases) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Single letters (A / B) need a colon so they aren't read as chord names.
      labels.push({ re: a.length === 1 ? `${esc}\\s*[:：]` : `${esc}\\s*[:：]?`, name });
    }
  }
  labels.sort((x, y) => y.re.length - x.re.length);
  if (!labels.length) return { [fallback]: text };
  const re = new RegExp(labels.map((l) => `(${l.re})`).join("|"), "g");
  const out: Record<string, string> = {};
  let last = 0;
  let current = fallback;
  for (const m of text.matchAll(re)) {
    const before = text.slice(last, m.index).trim();
    if (before) out[current] = [out[current], before].filter(Boolean).join(" ");
    const hit = labels.find((_, i) => m[i + 1] !== undefined);
    current = hit?.name ?? fallback;
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) out[current] = [out[current], rest].filter(Boolean).join(" ");
  return out;
}

// ---- Generators: chords → MIDI notes (beats) ----

export type GenStyle = "bass" | "piano" | "strings" | "arp";
export const GEN_STYLES: { id: GenStyle; label: string; kind: "bass" | "piano" | "strings" | "synth" }[] = [
  { id: "bass", label: "ベース", kind: "bass" },
  { id: "piano", label: "ピアノ", kind: "piano" },
  { id: "strings", label: "ストリングス", kind: "strings" },
  { id: "arp", label: "アルペジオ", kind: "synth" },
];

/** Place pitch classes nearest to a target register, keeping voices close to the previous chord. */
function voice(tones: number[], low: number, high: number, prev: number[] | null): number[] {
  const candidates: number[][] = [];
  for (let inv = 0; inv < tones.length; inv++) {
    const order = [...tones.slice(inv), ...tones.slice(0, inv)];
    for (let base = low; base <= high - 7; base++) {
      if (base % 12 !== order[0]) continue;
      const v = [base];
      for (const pc of order.slice(1)) {
        let n = v[v.length - 1] + 1;
        while (n % 12 !== pc) n++;
        v.push(n);
      }
      if (v[v.length - 1] <= high) candidates.push(v);
    }
  }
  if (!candidates.length) return tones.map((pc) => low + ((pc - low % 12 + 12) % 12));
  const center = (low + high) / 2;
  const cost = (v: number[]) =>
    prev ? v.reduce((a, n, i) => a + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0) : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
  return candidates.sort((a, b) => cost(a) - cost(b))[0];
}

export function generate(style: GenStyle, chords: Chord[], key: number, totalBeats: number): MidiNote[] {
  if (!chords.length) return [];
  const len = totalBeats / chords.length;
  const notes: MidiNote[] = [];
  let prev: number[] | null = null;
  chords.forEach((c, i) => {
    const s0 = i * len;
    const tones = chordTones(c, key);
    const rootPc = mod12((c.bass ?? c.root) + key);
    const bassNote = 28 + ((rootPc - 4 + 12) % 12); // E1..D#2
    if (style === "bass") {
      for (let t = 0; t < len - 0.01; t += 0.5) {
        const onBeat = Math.abs(t % 1) < 0.01;
        const p = t + 0.5 >= len - 0.01 && len >= 2 && i < chords.length - 1 ? bassNote + 12 : bassNote;
        notes.push({ p, s: s0 + t, d: 0.45, v: onBeat ? 104 : 84 });
      }
    } else if (style === "piano") {
      const v = voice(tones.slice(0, 4), 52, 76, prev);
      prev = v;
      notes.push({ p: bassNote + 12, s: s0, d: Math.min(len, 4) - 0.05, v: 88 });
      for (let bar = 0; bar < len - 0.01; bar += 4) {
        for (const [off, d, vel] of [
          [0, 1.4, 92],
          [1.5, 0.9, 78],
          [3, 0.9, 84],
        ] as const) {
          if (bar + off >= len - 0.01) continue;
          for (const p of v) notes.push({ p, s: s0 + bar + off, d: Math.min(d, len - bar - off) - 0.03, v: vel });
        }
      }
    } else if (style === "strings") {
      const v = voice([...tones.slice(0, 3), tones[0]], 55, 81, prev);
      prev = v;
      for (const p of v) notes.push({ p, s: s0, d: len - 0.05, v: 78 });
      notes.push({ p: bassNote + 24, s: s0, d: len - 0.05, v: 70 });
    } else {
      const v = voice(tones.slice(0, 4), 60, 79, prev);
      prev = v;
      const pattern = [...v, v[0] + 12, ...v.slice(1).reverse()];
      let k = 0;
      for (let t = 0; t < len - 0.01; t += 0.5) notes.push({ p: pattern[k++ % pattern.length], s: s0 + t, d: 0.45, v: k % 2 ? 90 : 72 });
    }
  });
  return notes;
}

/** Small random timing / velocity / length variation (deterministic per note, so it's repeatable). */
export function humanize(notes: MidiNote[], amount = 1): MidiNote[] {
  const rnd = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };
  return notes.map((n, i) => ({
    p: n.p,
    s: Math.max(0, n.s + rnd(i + 1) * 0.04 * amount),
    d: Math.max(0.05, n.d * (1 + rnd(i + 101) * 0.12 * amount)),
    v: Math.max(1, Math.min(127, Math.round(n.v * (1 + rnd(i + 201) * 0.22 * amount)))),
  }));
}

// ---- Detection: MIDI notes → key, chords per bar ----

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];

export function estimateKey(notes: MidiNote[]): number {
  const h = new Array(12).fill(0);
  for (const n of notes) h[n.p % 12] += n.d;
  let best = 0;
  let bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    // Major and relative minor share the key signature, so major profiles are enough here.
    const score = h.reduce((a, v, pc) => a + v * MAJOR_PROFILE[mod12(pc - k)], 0);
    if (score > bestScore) (bestScore = score), (best = k);
  }
  return best;
}

const TEMPLATES: { q: Quality; ext: Ext; iv: number[] }[] = [
  { q: "maj", ext: "", iv: [0, 4, 7] },
  { q: "min", ext: "", iv: [0, 3, 7] },
  { q: "maj", ext: "7", iv: [0, 4, 7, 10] },
  { q: "maj", ext: "M7", iv: [0, 4, 7, 11] },
  { q: "min", ext: "7", iv: [0, 3, 7, 10] },
  { q: "dim", ext: "", iv: [0, 3, 6] },
  { q: "sus4", ext: "", iv: [0, 5, 7] },
];

/** One chord per bar (null where nothing plays). `harmony` = pitched notes, `bass` = bass-track notes. */
export function detectChords(harmony: MidiNote[], bass: MidiNote[], bars: number, key: number): (Chord | null)[] {
  const out: (Chord | null)[] = [];
  for (let b = 0; b < bars; b++) {
    const s = b * 4;
    const e = s + 4;
    const h = new Array(12).fill(0);
    let low: { p: number; w: number } | null = null;
    for (const n of [...harmony, ...bass]) {
      const ov = Math.min(e, n.s + n.d) - Math.max(s, n.s);
      if (ov <= 0) continue;
      const w = ov * (0.5 + n.v / 127);
      h[n.p % 12] += w;
      if (!low || n.p < low.p) low = { p: n.p, w };
    }
    const bassNotes = bass.filter((n) => Math.min(e, n.s + n.d) - Math.max(s, n.s) > 0);
    const bassPc = bassNotes.length ? bassNotes.sort((x, y) => x.s - y.s)[0].p % 12 : low ? low.p % 12 : null;
    const total = h.reduce((a, v) => a + v, 0);
    if (!total) {
      out.push(null);
      continue;
    }
    let best: { score: number; root: number; t: (typeof TEMPLATES)[number] } | null = null;
    for (let r = 0; r < 12; r++) {
      for (const t of TEMPLATES) {
        const inT = t.iv.reduce((a, i) => a + h[(r + i) % 12], 0);
        let score = inT - 0.55 * (total - inT) - (t.iv.length - 3) * 0.08 * total;
        if (bassPc === r) score += 0.35 * total;
        if (!best || score > best.score) best = { score, root: r, t };
      }
    }
    const c: Chord = { root: mod12(best!.root - key), quality: best!.t.q, ext: best!.t.ext };
    if (bassPc !== null && bassPc !== best!.root && best!.t.iv.some((i) => (best!.root + i) % 12 === bassPc)) c.bass = mod12(bassPc - key);
    out.push(c);
  }
  return out;
}

/** Collapse a bar-by-bar list into a progression: merge repeats, and halve an exact repeat. */
export function summarize(chords: (Chord | null)[]): Chord[] {
  const merged: Chord[] = [];
  for (const c of chords) {
    if (!c) continue;
    const last = merged[merged.length - 1];
    if (!last || chordLabel(last) !== chordLabel(c)) merged.push(c);
  }
  let seq = merged;
  while (seq.length >= 4 && seq.length % 2 === 0) {
    const half = seq.length / 2;
    if (seq.slice(0, half).every((c, i) => chordLabel(c) === chordLabel(seq[half + i]))) seq = seq.slice(0, half);
    else break;
  }
  return seq;
}
