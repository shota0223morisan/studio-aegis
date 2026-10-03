import { useEffect, useRef, useState } from "react";
import { api, type MidiClip } from "../../lib/api";
import type { Flow } from "../../lib/flow";
import { KIND_LABELS, MidiClipRow } from "./MidiClipRow";

const KINDS = Object.keys(KIND_LABELS) as MidiClip["kind"][];

/** MIDI for this song: generate with AI, load .mid files, pull from the library; drag into the DAW. */
export function MidiSection({ projectId, flow, index, defaultKind }: { projectId: string; flow: Flow; index: string; defaultKind: MidiClip["kind"] }) {
  const [clips, setClips] = useState<MidiClip[]>([]);
  const [kind, setKind] = useState<MidiClip["kind"]>(defaultKind);
  const [bars, setBars] = useState(4);
  const [section, setSection] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () =>
    api
      .listMidi({ project: projectId })
      .then((r) => setClips(r.items))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, [projectId]);

  const sections = [...new Set((flow.structure ?? []).map((s) => s.name))];

  async function generate() {
    setBusy(true);
    setError(null);
    setComment(null);
    try {
      const r = await api.aiMidi(projectId, { kind, bars, prompt, section });
      setClips((c) => [r.clip, ...c]);
      setComment(r.comment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      try {
        const clip = await api.uploadMidi(f, projectId);
        setClips((c) => [clip, ...c]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込めませんでした");
      }
    }
  }

  return (
    <section className="card midi-card">
      <div className="section-head">
        <span className="sec-index">{index}</span>
        <h2 className="fx-en">MIDI</h2>
        <span className="muted small">AI 生成・保管庫 → そのまま DAW へドラッグ</span>
        <span className="sec-line" />
        <button className="btn ghost small" onClick={() => setPicker((v) => !v)}>
          保管庫から
        </button>
        <button className="btn ghost small" onClick={() => fileInput.current?.click()}>
          .mid を読込
        </button>
        <input ref={fileInput} type="file" accept=".mid,.midi,audio/midi" multiple hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ""))} />
      </div>

      <div className="midi-gen">
        <select value={kind} onChange={(e) => setKind(e.target.value as MidiClip["kind"])} aria-label="種類">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select value={bars} onChange={(e) => setBars(Number(e.target.value))} aria-label="小節数">
          {[1, 2, 4, 8, 16].map((b) => (
            <option key={b} value={b}>
              {b} 小節
            </option>
          ))}
        </select>
        {sections.length > 0 && (
          <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="セクション">
            <option value="">セクション指定なし</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <input value={prompt} placeholder="希望(任意): 例 REF A のサビっぽく、16分のハット" onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && void generate()} />
        <button className="btn primary small" disabled={busy} onClick={() => void generate()}>
          {busy ? "生成中…" : "✦ AI で生成"}
        </button>
      </div>
      <p className="muted small midi-hint">テンポ {flow.analysis?.bpm || "未定(120 で作ります)"}・コード進行・参考曲の「活かす所」を踏まえて作ります。</p>
      {comment && <p className="midi-comment">✦ {comment}</p>}
      {error && <p className="error">{error}</p>}

      {picker && <LibraryPicker projectId={projectId} onPick={(c) => (setClips((x) => [c, ...x]), setPicker(false))} />}

      {clips.length > 0 ? (
        <ul className="midi-list">
          {clips.map((c) => (
            <MidiClipRow
              key={c.id}
              clip={c}
              onRename={async (name) => {
                const u = await api.updateMidi(c.id, { name });
                setClips((x) => x.map((y) => (y.id === u.id ? u : y)));
              }}
              extra={
                <button
                  className="icon-btn danger"
                  title="この曲から外す(保管庫には残ります)"
                  onClick={async () => {
                    await api.updateMidi(c.id, { projectId: null });
                    setClips((x) => x.filter((y) => y.id !== c.id));
                  }}
                >
                  ×
                </button>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="muted small">まだ MIDI はありません。</p>
      )}
    </section>
  );
}

function LibraryPicker({ projectId, onPick }: { projectId: string; onPick: (c: MidiClip) => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [items, setItems] = useState<MidiClip[]>([]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      api
        .listMidi({ q, kind })
        .then((r) => setItems(r.items.filter((c) => c.projectId !== projectId)))
        .catch(() => {});
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, kind, projectId]);
  return (
    <div className="midi-picker">
      <div className="row">
        <input value={q} placeholder="保管庫を検索(名前・曲名)" onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">すべて</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      {items.length ? (
        <ul className="midi-list">
          {items.slice(0, 30).map((c) => (
            <MidiClipRow
              key={c.id}
              clip={c}
              extra={
                <button className="btn small" onClick={async () => onPick(await api.copyMidi(c.id, projectId))}>
                  この曲で使う
                </button>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="muted small">保管庫に MIDI がありません。</p>
      )}
    </div>
  );
}
