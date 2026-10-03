import { useEffect, useRef, useState } from "react";
import { api, type MidiClip } from "../lib/api";
import { KIND_LABELS, MidiClipRow } from "../components/flow/MidiClipRow";

const KINDS = Object.keys(KIND_LABELS) as MidiClip["kind"][];

/** MIDI 倉庫: every clip from every song (AI-generated or loaded), searchable, draggable into the DAW. */
export function VaultPage() {
  const [items, setItems] = useState<MidiClip[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const songInput = useRef<HTMLInputElement>(null);

  async function importSong(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const r = await api.importSongMidi(file);
      setItems((x) => [...r.clips, ...x]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした");
    }
  }

  useEffect(() => {
    document.title = "MIDI 倉庫 — Studio Aegis";
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      api
        .listMidi({ q, kind })
        .then((r) => setItems(r.items))
        .catch(() => {});
    }, 150);
    return () => window.clearTimeout(t);
  }, [q, kind]);

  async function upload(files: FileList | null) {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      try {
        const clip = await api.uploadMidi(f);
        setItems((x) => [clip, ...x]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込めませんでした");
      }
    }
  }

  return (
    <div className="page vault-page">
      <div className="page-head">
        <div>
          <h1>MIDI 倉庫</h1>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => songInput.current?.click()} title="曲の MIDI をトラックごと(楽器ごと)に分けて入れる">
            曲まるごと読込
          </button>
          <button className="btn primary" onClick={() => fileInput.current?.click()}>
            .mid を読み込む
          </button>
        </div>
        <input ref={fileInput} type="file" accept=".mid,.midi,audio/midi" multiple hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ""))} />
        <input ref={songInput} type="file" accept=".mid,.midi,audio/midi" hidden onChange={(e) => (void importSong(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
      <div className="vault-filters">
        <input value={q} placeholder="名前・曲名で検索" onChange={(e) => setQ(e.target.value)} />
        <div className="segmented kind-filter">
          <button className={!kind ? "active" : ""} onClick={() => setKind("")}>
            すべて
          </button>
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {items.length ? (
        <ul className="midi-list vault-list">
          {items.map((c) => (
            <MidiClipRow
              key={c.id}
              clip={c}
              onRename={async (name) => {
                const u = await api.updateMidi(c.id, { name });
                setItems((x) => x.map((y) => (y.id === u.id ? u : y)));
              }}
              extra={
                <>
                  <select
                    className="small"
                    value={c.kind}
                    onChange={async (e) => {
                      const u = await api.updateMidi(c.id, { kind: e.target.value });
                      setItems((x) => x.map((y) => (y.id === u.id ? u : y)));
                    }}
                    aria-label="種類"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-btn danger"
                    title="倉庫から削除"
                    onClick={async () => {
                      if (!window.confirm(`「${c.name}」を削除しますか?(元に戻せません)`)) return;
                      await api.deleteMidi(c.id);
                      setItems((x) => x.filter((y) => y.id !== c.id));
                    }}
                  >
                    ×
                  </button>
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="muted empty">空です</p>
      )}
    </div>
  );
}
