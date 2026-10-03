import { useState } from "react";
import type { MidiClip } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { playClip } from "../../lib/midiPlayer";

export const KIND_LABELS: Record<MidiClip["kind"], string> = { drums: "ドラム", bass: "ベース", chords: "コード", melody: "メロ/リフ", other: "その他" };

/** Mini piano roll: notes as bars, drums as lanes. */
export function PianoRoll({ clip }: { clip: MidiClip }) {
  const notes = clip.tracks.flatMap((t) => t.notes.map((n) => ({ ...n, drum: t.channel === 9 })));
  if (!notes.length) return <div className="roll empty" />;
  const beats = Math.max((clip.bars ?? 1) * 4, ...notes.map((n) => n.s + n.d));
  const lo = Math.min(...notes.map((n) => n.p));
  const hi = Math.max(...notes.map((n) => n.p));
  const span = Math.max(12, hi - lo + 1);
  return (
    <svg className="roll" viewBox={`0 0 ${beats * 16} ${span * 4}`} preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: Math.floor(beats / 4) + 1 }, (_, i) => (
        <line key={i} x1={i * 64} x2={i * 64} y1={0} y2={span * 4} className="roll-bar" />
      ))}
      {notes.map((n, i) => (
        <rect
          key={i}
          x={n.s * 16}
          y={(hi - n.p) * 4 + (span - (hi - lo + 1)) * 2}
          width={Math.max(1.5, n.d * 16 - 0.6)}
          height={3.2}
          rx={0.8}
          className={n.drum ? "roll-drum" : "roll-note"}
          opacity={0.45 + (n.v / 127) * 0.55}
        />
      ))}
    </svg>
  );
}

/** One clip: preview, play, drag into the DAW, download. */
export function MidiClipRow({ clip, extra, onRename }: { clip: MidiClip; extra?: React.ReactNode; onRename?: (name: string) => void }) {
  const [playing, setPlaying] = useState<null | (() => void)>(null);
  const [name, setName] = useState(clip.name);
  return (
    <li
      className="midi-row"
      draggable={Boolean(desktop)}
      onDragStart={(e) => {
        if (!desktop) return;
        e.preventDefault();
        desktop.dragMidi(clip.id);
      }}
      title={desktop ? "そのまま DAW(Logic / Ableton など)にドラッグできます" : undefined}
    >
      <span className={`midi-kind k-${clip.kind}`}>{KIND_LABELS[clip.kind]}</span>
      <div className="midi-main">
        {onRename ? (
          <input
            className="midi-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== clip.name && onRename(name.trim())}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="midi-name">{clip.name}</span>
        )}
        <span className="midi-meta">
          {clip.bars ?? "?"}小節 · {clip.bpm ? `${Math.round(clip.bpm)} BPM` : "BPM —"} · {clip.source === "ai" ? "AI" : "読込"}
          {clip.projectName && ` · ${clip.projectName}`}
        </span>
        <PianoRoll clip={clip} />
      </div>
      <div className="midi-actions">
        <button
          className="icon-btn"
          onClick={() => {
            if (playing) return playing();
            const stop = playClip(clip, () => setPlaying(null));
            setPlaying(() => stop);
          }}
          title={playing ? "止める" : "試聴(簡易音源)"}
        >
          {playing ? "■" : "▶"}
        </button>
        {desktop && (
          <span className="midi-drag" title="DAW へドラッグ">
            ⠿
          </span>
        )}
        <a className="icon-btn" href={clip.fileUrl} download title=".mid をダウンロード">
          ↓
        </a>
        {extra}
      </div>
    </li>
  );
}
