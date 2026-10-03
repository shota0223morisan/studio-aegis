import { useState } from "react";
import { api } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { stageMeta, uid, type Flow } from "../../lib/flow";

/** Suno: waveform generation happens on suno.com (side pane); the AI writes the style prompt. */
export function SunoHelper({ projectId }: { projectId: string }) {
  const [part, setPart] = useState("");
  const [out, setOut] = useState<{ style: string; exclude: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      setOut(await api.aiSuno(projectId, part));
    } catch (e) {
      setError(e instanceof Error ? e.message : "作れませんでした");
    } finally {
      setBusy(false);
    }
  }
  async function copyAndOpen() {
    if (!out) return;
    if (desktop) await desktop.copyText(out.style);
    else await navigator.clipboard.writeText(out.style).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    if (desktop) void desktop.setPaneTab("suno");
    else window.open("https://suno.com/create", "_blank", "noreferrer");
  }

  return (
    <section className="card suno-card">
      <div className="section-head">
        <span className="sec-icon">✦</span>
        <h2 className="fx-en">SUNO</h2>
        <span className="muted small">波形の生成</span>
        <span className="sec-line" />
      </div>
      <div className="row">
        <input value={part} placeholder="パート(任意): 例 イントロのギター" onChange={(e) => setPart(e.target.value)} style={{ flex: 1 }} />
        <button className="btn small" disabled={busy} onClick={() => void make()}>
          {busy ? "作成中…" : "スタイルを作る"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {out && (
        <div className="suno-out">
          <code>{out.style}</code>
          {out.exclude && <p className="muted small">Exclude: {out.exclude}</p>}
          {out.note && <p className="muted small">{out.note}</p>}
          <button className="btn small primary" onClick={() => void copyAndOpen()}>
            {copied ? "コピーしました" : "コピーして Suno を開く"}
          </button>
        </div>
      )}
      {!out && (
        <button className="btn ghost small" onClick={() => (desktop ? void desktop.setPaneTab("suno") : window.open("https://suno.com/create", "_blank"))}>
          Suno を開く ↗
        </button>
      )}
    </section>
  );
}

/** PARKING: the urge to mix / tweak sounds goes here and comes back as MIXING checklist items. */
export function Parking({ stage, flow, update }: { stage: number; flow: Flow; update: (fn: (f: Flow) => Flow) => void }) {
  const [text, setText] = useState("");
  const items = flow.parked ?? [];
  return (
    <section className="card park-card">
      <div className="section-head">
        <span className="sec-icon">⏸</span>
        <h2 className="fx-en">PARKING</h2>
        <span className="muted small">ミックス・音作りは後で</span>
        <span className="sec-line" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          update((f) => ({ ...f, parked: [...(f.parked ?? []), { id: uid(), text: text.trim(), from: stage }] }));
          setText("");
        }}
      >
        <input className="park-input" value={text} placeholder="いじりたくなったらここに書いて先へ(例: スネアの抜けが悪い)" onChange={(e) => setText(e.target.value)} />
      </form>
      {items.length > 0 && (
        <ul className="park-list">
          {items.map((p) => (
            <li key={p.id} className={p.done ? "done" : ""}>
              <span>{p.text}</span>
              <span className="park-to">→ MIXING</span>
              <small className="muted">{stageMeta(p.from).en}</small>
              <button className="icon-btn danger" onClick={() => update((f) => ({ ...f, parked: (f.parked ?? []).filter((x) => x.id !== p.id) }))} title="消す">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
