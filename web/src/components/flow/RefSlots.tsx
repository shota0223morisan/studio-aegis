import { useState } from "react";
import type { StoredFile } from "../../lib/api";
import { analyzeAudio } from "../../lib/audio";
import { desktop } from "../../lib/desktop";
import { filled, SLOT_KEYS, spotifySearch, ytMusicSearch, type Flow, type RefSlot } from "../../lib/flow";
import { AutoTextarea } from "../AutoTextarea";

export function openListen(where: "ytmusic" | "spotify", q: string) {
  const url = where === "ytmusic" ? ytMusicSearch(q) : spotifySearch(q);
  if (desktop) void desktop.openInPane(where, url);
  else window.open(url, "_blank", "noreferrer");
}

/** REF SLOTS: the 3 reference songs (A/B/C, more can be added) and what to take from each. */
export function RefSlots({ flow, update, files }: { flow: Flow; update: (fn: (f: Flow) => Flow) => void; files: StoredFile[] }) {
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
        <span className="muted small">参考曲 3 曲 — どこを活かすか</span>
        <span className="sec-line" />
        <button className="btn ghost small" onClick={() => setSlot(count, { title: "", artist: "" })} title="4 曲目以降を追加">
          ＋ 枠を追加
        </button>
      </div>
      <div className="ref-slots">
        {slots.map((slot, i) => (
          <Slot key={i} index={i} slot={slot} audio={audio} onChange={(p) => setSlot(i, p)} />
        ))}
      </div>
    </section>
  );
}

function Slot({ index, slot, audio, onChange }: { index: number; slot: RefSlot; audio: StoredFile[]; onChange: (p: Partial<RefSlot> | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
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
    } finally {
      setBusy(null);
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
            <button className="chip-btn" onClick={() => openListen("ytmusic", q)} title="YouTube Music で聴く(アプリ内で音が出ます)">
              YT Music
            </button>
            <button className="chip-btn" onClick={() => openListen("spotify", q)}>
              Spotify
            </button>
          </>
        )}
      </div>
      {file && <audio src={file.url} controls preload="none" className="ref-audio" />}
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
      {error && <p className="error small">{error}</p>}
      <label className="ref-use">
        <span>活かす所</span>
        <AutoTextarea rows={2} value={slot.use ?? ""} placeholder="例: サビ頭の開放感 / ドラムの推進力" onChange={(e) => onChange({ use: e.target.value })} />
      </label>
      {filled(slot) && (
        <button className="icon-btn danger ref-clear" onClick={() => onChange(null)} title="この枠を空にする">
          ×
        </button>
      )}
    </div>
  );
}
