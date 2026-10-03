import { useState } from "react";
import { api } from "../../lib/api";
import { filled, type Flow, type SimilarSong } from "../../lib/flow";
import { playSong } from "../../lib/play";

/** SIMILAR: songs musically close to the references (Claude's knowledge; key ignored). */
export function SimilarSongs({ projectId, flow, update }: { projectId: string; flow: Flow; update: (fn: (f: Flow) => Flow) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const items = flow.similar?.items ?? [];
  const hasRefs = (flow.refs ?? []).some(filled);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.aiSimilar(projectId, focus);
      update((f) => ({ ...f, similar: r }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "探せませんでした");
    } finally {
      setBusy(false);
    }
  }

  function addToRefs(s: SimilarSong) {
    update((f) => {
      const refs = [...(f.refs ?? [])];
      while (refs.length < 3) refs.push({ title: "", artist: "" });
      const i = refs.findIndex((r) => !filled(r));
      const slot = { title: s.title, artist: s.artist, bpm: s.bpm || undefined };
      if (i >= 0) refs[i] = { ...refs[i], ...slot };
      else refs.push(slot);
      return { ...f, refs };
    });
  }

  return (
    <section className="card">
      <div className="section-head">
        <span className="sec-index">03</span>
        <h2 className="fx-en">SIMILAR</h2>
        <span className="sec-line" />
      </div>
      <div className="similar-bar">
        <input value={focus} placeholder="重視すること(任意)" onChange={(e) => setFocus(e.target.value)} />
        <button className="btn primary small" disabled={busy || !hasRefs} onClick={() => void search()} title={hasRefs ? "" : "まず参考曲を 1 曲以上入れてください"}>
          {busy ? "探しています…" : items.length ? "もう一度探す" : "近い曲を探す"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {items.length > 0 && (
        <ul className="similar-list">
          {items.map((s, i) => (
            <li key={`${s.title}-${i}`} className="similar-row">
              <div className="similar-main">
                <div className="similar-title">
                  {s.title} <span className="muted">— {s.artist}</span>
                  {s.year && <span className="muted small"> ({s.year})</span>}
                </div>
                <div className="similar-why">{s.why}</div>
                <div className="similar-tags">
                  {s.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                  {s.bpm && <span className="bpm">BPM {s.bpm}</span>}
                </div>
              </div>
              <div className="similar-match" title="近さ">
                {s.match}
                <span className="meter">
                  <b style={{ width: `${Math.max(0, Math.min(100, s.match))}%` }} />
                </span>
              </div>
              <div className="similar-actions">
                <button className="chip-btn" onClick={() => void playSong(s.title, s.artist)}>
                  ▶ 聴く
                </button>
                <button className="chip-btn" onClick={() => addToRefs(s)}>
                  ＋ REF に
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
