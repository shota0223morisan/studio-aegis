import { useState } from "react";
import { api, type MidiClip } from "../../lib/api";
import { toast } from "../../lib/toast";
import { markDragOut } from "../../lib/inputGuards";
import { desktop } from "../../lib/desktop";
import { playClip } from "../../lib/midiPlayer";

export const KIND_LABELS: Record<MidiClip["kind"], string> = {
  drums: "ドラム",
  bass: "ベース",
  piano: "ピアノ",
  guitar: "ギター",
  strings: "ストリングス",
  brass: "ブラス",
  synth: "シンセ",
  chords: "コード",
  melody: "メロ",
  other: "その他",
};

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

/** Ready-made asks for "arrange this clip into a new one", per kind. */
const ARRANGE_PRESETS: Partial<Record<MidiClip["kind"], string[]>> & { default: string[] } = {
  bass: ["ロックで動き回るベースに(経過音・オクターブ・16分のフィル)", "ルートのまま休符とシンコペーションでノリを出す", "ファンク/スラップ寄りに", "ウォーキングベースに", "シンプルに(長めの音・ルート中心)"],
  drums: ["小節の終わりにフィルを足す", "ハーフタイムに", "4つ打ちに", "ゴーストノートを足して人間らしく", "サビ向けに派手に"],
  piano: ["8ビートのバッキングに", "アルペジオに", "16分で刻む", "テンションを足しておしゃれに"],
  guitar: ["8分のパワーコードの刻みに", "カッティングに", "アルペジオに", "リフにする"],
  chords: ["8ビートのバッキングに", "アルペジオに", "テンションを足しておしゃれに", "白玉(長い音)に"],
  strings: ["白玉から動きのある対旋律に", "スタッカートの刻みに", "オクターブ上で華やかに"],
  synth: ["アルペジオに", "16分のシーケンスに", "パッド(長い音)に"],
  default: ["ヒューマナイズ(人間らしく揺らす)", "音数を半分に", "音数を増やして派手に", "1 オクターブ上で"],
};

/** "✦ アレンジ": make a new clip from this one in another style (same length and harmony). */
function ArrangePanel({ clip, onDone }: { clip: MidiClip; onDone: (c: MidiClip, comment: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const totalBars = Math.max(1, clip.bars ?? Math.ceil(Math.max(0, ...clip.tracks.flatMap((t) => t.notes.map((n) => n.s + n.d))) / 4));
  const [range, setRange] = useState({ from: "1", to: String(totalBars) });
  const presets = [...(ARRANGE_PRESETS[clip.kind] ?? []), ...ARRANGE_PRESETS.default];
  const from = Math.max(1, Math.min(totalBars, Number(range.from) || 1));
  const to = Math.max(from, Math.min(totalBars, Number(range.to) || totalBars));
  const span = to - from + 1;
  const calls = span <= 16 ? 1 : Math.ceil(span / 8);
  async function run(ask: string) {
    if (!ask.trim() || busy) return;
    if (calls > 1 && !window.confirm(`${span} 小節あるので、8 小節ずつ ${calls} 回に分けて AI に作ってもらい、つなぎます(数分かかります)。よいですか？`)) return;
    setBusy(true);
    const token = Math.random().toString(36).slice(2);
    const poll = calls > 1 ? window.setInterval(() => void api.arrangeProgress(token).then(setProgress).catch(() => {}), 2000) : undefined;
    try {
      const r = await api.arrangeMidi(clip.id, { prompt: ask.trim(), fromBar: from, toBar: to, token });
      onDone(r.clip, r.comment);
      toast(`新しい MIDI: ${r.clip.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "作れませんでした", { error: true, ms: 8000 });
    } finally {
      window.clearInterval(poll);
      setProgress(null);
      setBusy(false);
    }
  }
  return (
    <div className="arrange-panel" onClick={(e) => e.stopPropagation()}>
      <div className="arrange-presets">
        {presets.map((p) => (
          <button key={p} className="chip-btn" disabled={busy} onClick={() => void run(p)}>
            {p}
          </button>
        ))}
      </div>
      <form
        className="arrange-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <input value={text} placeholder="どう変える?(例: 8分ベタ打ちを、ロックで動き回るベースに)⌘Enter で作る" onChange={(e) => setText(e.target.value)} />
        <button className="btn primary small" disabled={busy || !text.trim()}>
          {busy ? (progress ? `作っています… ${progress.done} / ${progress.total}` : "作っています…") : "✦ 作る"}
        </button>
      </form>
      {totalBars > 8 && (
        <label className="arrange-range">
          <span>範囲</span>
          <input inputMode="numeric" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} disabled={busy} />
          〜
          <input inputMode="numeric" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} disabled={busy} />
          <span>小節目(全 {totalBars} 小節)</span>
          {calls > 1 && <span className="muted">8 小節ずつ {calls} 回に分けて作り、つなぎます</span>}
        </label>
      )}
      <p className="muted small">長さと和音の流れはそのままで、新しい MIDI を別に作ります(元の MIDI は残ります)。</p>
    </div>
  );
}

/** One clip: preview, play, drag into the DAW, download. */
export function MidiClipRow({
  clip,
  extra,
  onRename,
  onArranged,
}: {
  clip: MidiClip;
  extra?: React.ReactNode;
  onRename?: (name: string) => void;
  /** Show "✦ アレンジ"; called with the new clip. */
  onArranged?: (clip: MidiClip, comment: string) => void;
}) {
  const [playing, setPlaying] = useState<null | (() => void)>(null);
  const [name, setName] = useState(clip.name);
  const [arranging, setArranging] = useState(false);
  return (
    <li
      className="midi-row"
      draggable={Boolean(desktop)}
      onDragStart={(e) => {
        if (!desktop) return;
        e.preventDefault();
        markDragOut();
        desktop.dragMidi(clip.id);
      }}
      title={desktop ? "DAW へドラッグ" : undefined}
    >
      <span className={`midi-kind k-${clip.kind}`}>{KIND_LABELS[clip.kind]}</span>
      <div className="midi-main">
        {onRename ? (
          <input
            className="midi-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== clip.name && onRename(name.trim())}
            data-enter="commit"
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
        {onArranged && (
          <button className={`icon-btn ${arranging ? "on" : ""}`} onClick={() => setArranging((v) => !v)} title="アレンジ: この MIDI から別のスタイルの MIDI を作る">
            ✦
          </button>
        )}
        {extra}
      </div>
      {arranging && onArranged && (
        <ArrangePanel
          clip={clip}
          onDone={(c, comment) => {
            setArranging(false);
            onArranged(c, comment);
          }}
        />
      )}
    </li>
  );
}
