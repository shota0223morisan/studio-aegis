import { useRef, useState } from "react";
import { api, type StoredFile } from "../../lib/api";
import { fromAi, scanChords, type ChordScan } from "../../lib/chordScan";
import { chordName, KEY_OPTIONS, parseProgression } from "../../lib/theory";
import { toast } from "../../lib/toast";
import { analyzeAudio } from "../../lib/audio";
import { desktop } from "../../lib/desktop";
import { filled, SLOT_KEYS, spotifySearch, type Flow, type RefSlot } from "../../lib/flow";
import { playSong } from "../../lib/play";
import { CardChecks } from "../../lib/gate";
import { AutoTextarea } from "../AutoTextarea";

export function openSpotify(q: string) {
  if (desktop) void desktop.openInPane("spotify", spotifySearch(q));
  else window.open(spotifySearch(q), "_blank", "noreferrer");
}

/** REF SLOTS: the 3 reference songs (A/B/C, more can be added) and what to take from each. */
export function RefSlots({ flow, update, files, projectId }: { flow: Flow; update: (fn: (f: Flow) => Flow) => void; files: StoredFile[]; projectId: string }) {
  const refs = flow.refs ?? [];
  const count = Math.max(3, refs.length);
  const slots = Array.from({ length: count }, (_, i) => refs[i] ?? { title: "", artist: "" });
  const audio = files.filter((f) => f.mime.startsWith("audio/"));

  const setSlot = (i: number, patch: Partial<RefSlot> | null) =>
    update((f) => {
      const next = [...(f.refs ?? [])];
      while (next.length <= i) next.push({ title: "", artist: "" });
      next[i] = patch === null ? { title: "", artist: "" } : { ...next[i], ...patch };
      // Drop empty slots past the first three.
      while (next.length > 3 && !filled(next[next.length - 1]) && !next[next.length - 1].use) next.pop();
      return { ...f, refs: next };
    });

  return (
    <section className="card">
      <div className="section-head">
        <span className="sec-index">02</span>
        <h2 className="fx-en">REF SLOTS</h2>
        <span className="sec-line" />
        <CardChecks ids={["refs", "use"]} />
        <button className="btn ghost small" onClick={() => setSlot(count, { title: "", artist: "" })} title="4 曲目以降を追加">
          ＋ 枠
        </button>
      </div>
      <div className="ref-slots">
        {slots.map((slot, i) => (
          <Slot key={i} index={i} slot={slot} audio={audio} projectId={projectId} onChange={(p) => setSlot(i, p)} />
        ))}
      </div>
    </section>
  );
}

function Slot({ index, slot, audio, projectId, onChange }: { index: number; slot: RefSlot; audio: StoredFile[]; projectId: string; onChange: (p: Partial<RefSlot> | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [chordBusy, setChordBusy] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const key = SLOT_KEYS[index];
  const file = audio.find((f) => f.id === slot.fileId);
  const q = [slot.title, slot.artist].filter(Boolean).join(" ");

  async function fromNowPlaying() {
    setError(null);
    const np = await desktop?.nowPlaying();
    if (!np) return setError("再生中の曲が見つかりません(YT Music / Spotify で曲を開いてから)");
    onChange({ title: np.title, artist: np.artist, url: np.url });
  }

  async function analyze(f: StoredFile) {
    setBusy("解析中…");
    setError(null);
    try {
      const r = await analyzeAudio(f.url);
      onChange({
        fileId: f.id,
        ...(r.bpm ? { bpm: String(r.bpm), bpmAuto: true } : {}),
        ...(r.key ? { key: r.key, keyAuto: true } : {}),
      });
    } catch {
      setError("この音源は解析できませんでした");
      return;
    } finally {
      setBusy(null);
    }
    await extractChords(f);
  }

  /** Chords from the attached audio, or (no audio) from what the AI knows of the song. */
  async function extractChords(f: StoredFile | undefined = file, viaAi = false) {
    setError(null);
    try {
      if (f && !viaAi) {
        setChordBusy("音源からコードを抽出中…");
        onChange({ chords: await scanChords(f.url) });
      } else if (slot.title.trim()) {
        setChordBusy("AI に聞いています…");
        onChange({ chords: fromAi(await api.aiRefChords(projectId, slot.title, slot.artist)) });
      }
    } catch (e) {
      setError(e instanceof Error && viaAi ? e.message : "コードを抽出できませんでした");
    } finally {
      setChordBusy(null);
    }
  }

  return (
    <div className={`ref-slot k${index % 3} ${filled(slot) ? "" : "empty"}`}>
      <span className="ref-key">{key}</span>
      <input className="ref-title" value={slot.title} placeholder="曲名" onChange={(e) => onChange({ title: e.target.value })} />
      <input className="ref-artist" value={slot.artist} placeholder="アーティスト" onChange={(e) => onChange({ artist: e.target.value })} />
      <div className="ref-src">
        {desktop && (
          <button className="chip-btn" onClick={() => void fromNowPlaying()} title="YT Music / Spotify で再生中の曲を入れる">
            ▶ 再生中の曲
          </button>
        )}
        {audio.length > 0 && (
          <select
            className="chip-select"
            value=""
            onChange={(e) => {
              const f = audio.find((x) => x.id === e.target.value);
              if (!f) return;
              if (!slot.title) onChange({ title: f.name.replace(/\.[^.]+$/, ""), fileId: f.id });
              void analyze(f);
            }}
            title="添付音源から BPM・キーを自動で出す"
          >
            <option value="">♪ 添付音源を解析</option>
            {audio.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        {q && (
          <>
            <button className="chip-btn" onClick={() => void playSong(slot.title, slot.artist)} title="YouTube Music で再生(アプリ内で音が出ます)">
              ▶ 聴く
            </button>
            <button className="chip-btn" onClick={() => openSpotify(q)} title="Spotify で探す">
              Spotify
            </button>
          </>
        )}
        {(file || slot.title.trim()) && (
          <button
            className="chip-btn chord-btn"
            disabled={Boolean(chordBusy)}
            onClick={() => void extractChords()}
            title={file ? "添付音源からコード進行を抽出" : "AI に、この曲のコード進行を聞く(知っている曲だけ答えます)"}
          >
            ♪ コード
          </button>
        )}
      </div>
      {file && <audio ref={player} src={file.url} controls preload="none" className="ref-audio" />}
      <dl className="ref-kv">
        <dt>BPM</dt>
        <dd>
          <input value={slot.bpm ?? ""} placeholder="—" onChange={(e) => onChange({ bpm: e.target.value, bpmAuto: false })} />
          {slot.bpmAuto && <span className="auto">AUTO</span>}
        </dd>
        <dt title="表示のみ。関連性・比較には使いません">Key</dt>
        <dd>
          <input value={slot.key ?? ""} placeholder="—" onChange={(e) => onChange({ key: e.target.value, keyAuto: false })} />
          {slot.keyAuto && <span className="auto">AUTO</span>}
        </dd>
      </dl>
      {busy && <p className="muted small">{busy}</p>}
      {chordBusy && <p className="muted small">{chordBusy}</p>}
      {slot.chords && !chordBusy && (
        <ChordView
          scan={slot.chords}
          onSeek={
            slot.chords.source === "audio" && player.current
              ? (t) => {
                  const a = player.current!;
                  a.currentTime = t;
                  void a.play();
                }
              : undefined
          }
          onAi={slot.chords.source === "audio" && slot.title.trim() ? () => void extractChords(undefined, true) : undefined}
          onAudio={slot.chords.source === "ai" && file ? () => void extractChords(file) : undefined}
        />
      )}
      {error && <p className="error small">{error}</p>}
      <label className="ref-use">
        <span>活かす所</span>
        <AutoTextarea rows={2} value={slot.use ?? ""} placeholder="" onChange={(e) => onChange({ use: e.target.value })} />
      </label>
      {filled(slot) && (
        <button className="icon-btn danger ref-clear" onClick={() => onChange(null)} title="この枠を空にする">
          ×
        </button>
      )}
    </div>
  );
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

async function copy(text: string) {
  try {
    if (desktop) await desktop.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast("コピーしました(骨組みのコード進行の一言入力に貼れます)");
  } catch {
    toast("コピーできませんでした", { error: true });
  }
}

/** The extracted progression: repeating loops (audio) or sections (AI), with chord names. */
function ChordView({ scan, onSeek, onAi, onAudio }: { scan: ChordScan; onSeek?: (t: number) => void; onAi?: () => void; onAudio?: () => void }) {
  const names = (prog: string) => parseProgression(prog, scan.key).map((c) => chordName(c, scan.key)).join(" ");
  const keyLabel = KEY_OPTIONS[scan.key]?.label ?? "";
  const rows = scan.source === "audio" ? scan.patterns ?? [] : scan.sections ?? [];
  return (
    <div className="ref-chords">
      <div className="ref-chords-head">
        <b>CHORDS</b>
        <span className={scan.source === "audio" ? "auto" : "ai-badge"}>{scan.source === "audio" ? "AUTO" : "AI・要確認"}</span>
        {rows.length > 0 && <span className="muted small">Key {keyLabel}</span>}
        <span className="ref-chords-tools">
          {onAi && (
            <button className="link-btn" onClick={onAi} title="AI に、この曲のコード進行を聞く">
              AI に聞く
            </button>
          )}
          {onAudio && (
            <button className="link-btn" onClick={onAudio} title="添付音源から抽出し直す">
              音源から
            </button>
          )}
        </span>
      </div>
      {rows.length === 0 && (
        <p className="muted small">
          {scan.source === "ai" ? "この曲のコード進行は分かりませんでした。音源を添付すると、そこから抽出できます。" : "くり返す進行が見つかりませんでした。"}
        </p>
      )}
      <ul className="ref-chord-rows">
        {scan.source === "audio"
          ? (scan.patterns ?? []).map((p) => (
              <li key={p.prog}>
                <button className="chord-time" disabled={!onSeek} onClick={() => onSeek?.(p.at)} title={onSeek ? "ここから聴く" : undefined}>
                  {clock(p.at)}
                </button>
                <span className="chord-prog">
                  <b>{p.prog}</b>
                  <small>{names(p.prog)}</small>
                </span>
                <span className="chord-count">×{p.count}</span>
                <button className="link-btn" onClick={() => void copy(p.prog)} title="コピー">
                  コピー
                </button>
              </li>
            ))
          : (scan.sections ?? []).map((s, i) => (
              <li key={i}>
                <span className="chord-sec">{s.name}</span>
                <span className="chord-prog">
                  <b>{s.prog}</b>
                  <small>{names(s.prog)}</small>
                </span>
                <button className="link-btn" onClick={() => void copy(`${s.name} ${s.prog}`)} title="コピー">
                  コピー
                </button>
              </li>
            ))}
      </ul>
      {scan.source === "ai" && (scan.sections ?? []).length > 1 && (
        <button className="link-btn" onClick={() => void copy((scan.sections ?? []).map((s) => `${s.name}: ${s.prog}`).join(" "))}>
          全セクションをまとめてコピー
        </button>
      )}
      {scan.note && <p className="muted small">{scan.note}</p>}
      {scan.source === "audio" && (scan.timeline ?? []).length > 0 && (
        <details className="chord-timeline">
          <summary>全体の流れ(4 小節ごと)</summary>
          <ul>
            {(scan.timeline ?? []).map((r, i) => (
              <li key={i}>
                <button className="chord-time" disabled={!onSeek} onClick={() => onSeek?.(r.at)}>
                  {clock(r.at)}
                </button>
                <span>{r.prog}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
