import { api, type MidiClip } from "./api";
import { uid, type Flow } from "./flow";
import { detectChords, estimateKey, formatProgression, summarize } from "./theory";

const HARMONY = new Set(["piano", "guitar", "strings", "brass", "synth", "chords"]);
const LAYER_NAMES: Record<string, string> = { strings: "ストリングス", brass: "ブラス", synth: "シンセ", guitar: "ギター", piano: "ピアノ", melody: "メロ" };

/**
 * A whole song's MIDI from the DAW: split into the library per instrument, then fill the song —
 * tempo, key, chord progression per section, the core 3 and the upper parts (all ticked).
 */
export async function importSongMidi(file: File, projectId: string, update: (fn: (f: Flow) => Flow) => void): Promise<{ clips: MidiClip[]; summary: string }> {
  const r = await api.importSongMidi(file, projectId);
  const pitched = r.tracks.filter((t) => t.channel !== 9 && t.kind !== "drums");
  const harmony = pitched.filter((t) => HARMONY.has(t.kind)).flatMap((t) => t.notes);
  const bass = pitched.filter((t) => t.kind === "bass").flatMap((t) => t.notes);
  const kinds = new Set<string>(r.tracks.map((t) => t.kind));
  const done: string[] = [];

  update((f) => {
    const next: Flow = { ...f };
    if (r.bpm && !next.analysis?.bpm?.trim()) {
      next.analysis = { ...next.analysis, bpm: String(Math.round(r.bpm)) };
      done.push(`テンポ ${Math.round(r.bpm)}`);
    }
    const key = next.key ?? estimateKey([...harmony, ...bass]);
    if (next.key === undefined && (harmony.length || bass.length)) next.key = key;
    // Chords: bar by bar, then folded into each section of the structure (or one progression).
    if (harmony.length || bass.length) {
      const perBar = detectChords(harmony.length ? harmony : bass, bass, r.bars, key);
      const chords = [...(next.chords ?? [])];
      const setIfEmpty = (section: string, prog: string) => {
        if (!prog || chords.some((c) => c.section === section && c.prog.trim())) return;
        const i = chords.findIndex((c) => c.section === section);
        if (i >= 0) chords[i] = { section, prog };
        else chords.push({ section, prog });
        done.push(`${section}: ${prog}`);
      };
      const structure = next.structure ?? [];
      if (structure.length) {
        let bar = 0;
        const seen = new Set<string>();
        for (const s of structure) {
          const slice = perBar.slice(bar, bar + s.bars);
          bar += s.bars;
          if (seen.has(s.name)) continue;
          seen.add(s.name);
          setIfEmpty(s.name, formatProgression(summarize(slice)));
        }
      } else setIfEmpty("全体", formatProgression(summarize(perBar.slice(0, 8))));
      next.chords = chords;
    }
    // Core 3 and upper parts present in the MIDI count as decided.
    const core = { ...next.core };
    if (kinds.has("drums")) core.drums = { ...core.drums, done: true };
    if (kinds.has("bass")) core.bass = { ...core.bass, done: true };
    const harmonyInst = kinds.has("piano") ? "piano" : kinds.has("guitar") ? "guitar" : null;
    if (harmonyInst) core.harmony = { ...core.harmony, inst: core.harmony?.inst ?? harmonyInst, done: true };
    next.core = core;
    const parts = [...(next.parts ?? [])];
    for (const k of ["strings", "brass", "synth", "guitar", "piano"]) {
      if (!kinds.has(k) || k === harmonyInst || parts.some((p) => p.name === LAYER_NAMES[k])) continue;
      parts.push({ id: uid(), name: LAYER_NAMES[k], done: true, point: "MIDI 読込" });
    }
    next.parts = parts;
    return next;
  });

  return { clips: r.clips, summary: [`${r.clips.length} トラック → 倉庫`, ...done].join(" / ") };
}
