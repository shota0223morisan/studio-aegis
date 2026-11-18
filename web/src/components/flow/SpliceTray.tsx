import { useEffect, useState } from "react";
import { desktop, type SpliceDownload } from "../../lib/desktop";
import { markDragOut } from "../../lib/inputGuards";

const AUDIO = /\.(wav|aiff?|mp3|flac|ogg|m4a)$/i;

/**
 * SPLICE TRAY: sounds downloaded in the Splice pane (saved to ~/Music/Session Partner/Splice),
 * newest first; drag one straight into the DAW.
 */
export function SpliceTray() {
  const [items, setItems] = useState<SpliceDownload[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    void desktop.spliceDownloads().then(setItems);
    return desktop.onSpliceDownloaded((rec) => setItems((x) => [rec, ...x.filter((y) => y.path !== rec.path)]));
  }, []);
  if (!desktop) return null;
  const shown = all ? items : items.slice(0, 8);
  return (
    <section className="card splice-tray">
      <div className="section-head">
        <span className="sec-icon">◆</span>
        <h2 className="fx-en">SPLICE TRAY</h2>
        <span className="sec-line" />
        <button className="btn ghost small" onClick={() => void desktop!.openSpliceFolder()} title="保存先のフォルダを Finder で開く">
          フォルダ
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">左の Splice で素材をダウンロードすると、ここに並びます。ここから DAW へドラッグできます。</p>
      ) : (
        <ul className="splice-list">
          {shown.map((d) => (
            <li
              key={d.path}
              className={`splice-item ${AUDIO.test(d.name) ? "" : "other"}`}
              draggable
              onDragStart={(e) => {
                e.preventDefault();
                markDragOut();
                desktop!.dragSpliceFile(d.path);
              }}
              title="DAW へドラッグ"
            >
              <span className="midi-drag" aria-hidden>
                ⠿
              </span>
              <span className="splice-name">{d.name}</span>
              <button className="icon-btn" onClick={() => void desktop!.revealSpliceFile(d.path)} title="Finder で表示">
                ↗
              </button>
              <button
                className="icon-btn"
                onClick={() => void desktop!.forgetSpliceFile(d.path).then(() => setItems((x) => x.filter((y) => y.path !== d.path)))}
                title="一覧から外す(ファイルは消えません)"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && (
        <button className="link-btn" onClick={() => setAll((v) => !v)}>
          {all ? "少なく表示" : `ほか ${items.length - 8} 個も表示`}
        </button>
      )}
    </section>
  );
}
