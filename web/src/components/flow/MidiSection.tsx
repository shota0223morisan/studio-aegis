import { useEffect, useRef, useState } from "react";
import { api, type MidiClip } from "../../lib/api";
import type { Flow } from "../../lib/flow";
import { MIDI_CHANGED } from "../../lib/midiEvents";
import { importSongMidi } from "../../lib/songImport";
import { humanize } from "../../lib/theory";
import { toast } from "../../lib/toast";
import { KIND_LABELS, MidiClipRow } from "./MidiClipRow";

const KINDS = Object.keys(KIND_LABELS) as MidiClip["kind"][];

/** MIDI for this song: AI (optionally from a reference clip), the library, .mid files, a whole song's MIDI. */
export function MidiSection({
  projectId,
  flow,
  update,
  index,
  defaultKind,
}: {
  projectId: string;
  flow: Flow;
  update: (fn: (f: Flow) => Flow) => void;
  index: string;
  defaultKind: MidiClip["kind"];
}) {
  const [clips, setClips] = useState<MidiClip[]>([]);
  const [library, setLibrary] = useState<MidiClip[] | null>(null);
  const [kind, setKind] = useState<MidiClip["kind"]>(defaultKind);
  const [bars, setBars] = useState(4);
  const [section, setSection] = useState("");
  const [refId, setRefId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const songInput = useRef<HTMLInputElement>(null);

  const load = () =>
    api
      .listMidi({ project: projectId })
      .then((r) => setClips(r.items))
      .catch(() => {});
  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(MIDI_CHANGED, on);
    return () => window.removeEventListener(MIDI_CHANGED, on);
  }, [projectId]);

  const sections = [...new Set((flow.structure ?? []).map((s) => s.name))];

  async function generate() {
    setBusy("ai");
    setComment(null);
    try {
      const r = await api.aiMidi(projectId, { kind, bars, prompt, section, refClipId: refId || undefined });
      setClips((c) => [r.clip, ...c]);
      setComment(r.comment);
    } catch (e) {
      toast(e instanceof Error ? e.message : "生成できませんでした", { error: true, ms: 6000 });
    } finally {
      setBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      try {
        const clip = await api.uploadMidi(f, projectId);
        setClips((c) => [clip, ...c]);
      } catch (e) {
        toast(e instanceof Error ? e.message : "読み込めませんでした", { error: true });
      }
    }
  }

  async function importSong(file: File | undefined) {
    if (!file) return;
    setBusy("song");
    try {
      const r = await importSongMidi(file, projectId, update);
      setClips((c) => [...r.clips, ...c]);
      toast(r.summary, { ms: 7000 });
    } catch (e) {
      toast(e instanceof Error ? e.message : "読み込めませんでした", { error: true });
    } finally {
      setBusy(null);
    }
  }

  async function humanizeClip(c: MidiClip) {
    const clip = await api.createMidi({
      projectId,
      name: `${c.name}(humanize)`,
      kind: c.kind,
      bpm: c.bpm ?? 120,
      bars: c.bars ?? 1,
      tracks: c.tracks.map((t) => ({ ...t, notes: humanize(t.notes) })),
    });
    setClips((x) => [clip, ...x]);
  }

  return (
    <section className="card midi-card">
      <div className="section-head">
        <span className="sec-index">{index}</span>
        <h2 className="fx-en">MIDI</h2>
        <span className="sec-line" />
        <button className="btn ghost small" disabled={busy !== null} onClick={() => songInput.current?.click()} title="DAW から書き出した曲の MIDI → 楽器ごとに倉庫へ・欄を自動で埋める">
          {busy === "song" ? "読込中…" : "曲まるごと読込"}
        </button>
        <button className="btn ghost small" onClick={() => setPicker((v) => !v)}>
          倉庫
        </button>
        <button className="btn ghost small" onClick={() => fileInput.current?.click()}>
          .mid
        </button>
        <input ref={fileInput} type="file" accept=".mid,.midi,audio/midi" multiple hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ""))} />
        <input ref={songInput} type="file" accept=".mid,.midi,audio/midi" hidden onChange={(e) => (void importSong(e.target.files?.[0]), (e.target.value = ""))} />
      </div>

      <div className="midi-gen">
        <select value={kind} onChange={(e) => setKind(e.target.value as MidiClip["kind"])} aria-label="楽器">
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
            <option value="">セクション —</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select
          value={refId}
          onFocus={() => library === null && void api.listMidi({}).then((r) => setLibrary(r.items))}
          onChange={(e) => setRefId(e.target.value)}
          aria-label="参考 MIDI"
          title="この MIDI のノート割り当て・ノリを参考にする(「ヒューマナイズして」など作り変えも可)"
        >
          <option value="">参考 MIDI —</option>
          {(library ?? clips).map((c) => (
            <option key={c.id} value={c.id}>
              {KIND_LABELS[c.kind]} · {c.name}
            </option>
          ))}
        </select>
        <input value={prompt} placeholder="希望(任意)" onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && void generate()} />
        <button className="btn primary small" disabled={busy !== null} onClick={() => void generate()}>
          {busy === "ai" ? "生成中…" : "✦ AI"}
        </button>
      </div>
      {comment && <p className="midi-comment">✦ {comment}</p>}

      {picker && <LibraryPicker projectId={projectId} onPick={(c) => (setClips((x) => [c, ...x]), setPicker(false))} />}

      {clips.length > 0 && (
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
                <>
                  <button className="icon-btn" title="ヒューマナイズ(タイミング・強さを揺らした版を作る)" onClick={() => void humanizeClip(c)}>
                    ≈
                  </button>
                  <button
                    className="icon-btn danger"
                    title="この曲から外す(倉庫には残る)"
                    onClick={async () => {
                      await api.updateMidi(c.id, { projectId: null });
                      setClips((x) => x.filter((y) => y.id !== c.id));
                    }}
                  >
                    ×
                  </button>
                </>
              }
            />
          ))}
        </ul>
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
        <input value={q} placeholder="検索" onChange={(e) => setQ(e.target.value)} />
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
      {items.length ? (
        <ul className="midi-list">
          {items.slice(0, 40).map((c) => (
            <MidiClipRow
              key={c.id}
              clip={c}
              extra={
                <button className="btn small" onClick={async () => onPick(await api.copyMidi(c.id, projectId))}>
                  使う
                </button>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="muted small">倉庫は空です</p>
      )}
    </div>
  );
}
