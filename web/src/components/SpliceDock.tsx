import { useEffect, useState } from "react";
import { desktop, type SpliceDownload } from "../lib/desktop";
import { markDragOut } from "../lib/inputGuards";

const AUDIO = /\.(wav|aiff?|mp3|flac|ogg|m4a)$/i;
const KEY = "aegis.spliceDock";
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === "open";
  } catch {
    return false;
  }
};

/**
 * SPLICE TRAY, on every page and outside the page scroll: sounds downloaded in the Splice pane
 * (saved to ~/Music/Session Partner/Splice), newest first; drag one straight into the DAW.
 * Sits at the bottom-left of the main area (next to the Splice pane), folds into a small button,
 * and opens by itself when a new sound arrives.
 */
export function SpliceDock() {
  const [items, setItems] = useState<SpliceDownload[]>([]);
  const [open, setOpen] = useState(readOpen);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.spliceDownloads().then(setItems);
    return desktop.onSpliceDownloaded((rec) => {
      setItems((x) => [rec, ...x.filter((y) => y.path !== rec.path)]);
      setFresh(rec.path);
      setOpen(true);
    });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? "open" : "min");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => setFresh(null), 2400);
    return () => window.clearTimeout(t);
  }, [fresh]);
  if (!desktop) return null;

  if (!open)
    return (
      <button className="splice-fab" onClick={() => setOpen(true)} title="Splice で落とした素材(DAW へドラッグ)">
        <span aria-hidden>◆</span> SPLICE{items.length > 0 && <small>{items.length}</small>}
      </button>
    );

  return (
    <aside className="splice-dock" aria-label="SPLICE TRAY">
      <div className="memo-dock-head">
        <span className="memo-dock-icon" aria-hidden>
          ◆
        </span>
        <b>SPLICE TRAY</b>
        <span className="memo-dock-tools">
          <button className="icon-btn" onClick={() => void desktop!.openSpliceFolder()} title="保存先のフォルダを Finder で開く" aria-label="フォルダを開く">
            ▤
          </button>
          <button className="icon-btn" onClick={() => setOpen(false)} title="しまう(左下のボタンになります)" aria-label="しまう">
            ⌄
          </button>
        </span>
      </div>
      <div className="splice-dock-body">
        {items.length === 0 ? (
          <p className="muted small">左の Splice で素材をダウンロードすると、ここに並びます。ここから DAW へドラッグできます。</p>
        ) : (
          <ul className="splice-list">
            {items.map((d) => (
              <li
                key={d.path}
                className={`splice-item ${AUDIO.test(d.name) ? "" : "other"} ${fresh === d.path ? "fresh" : ""}`}
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
      </div>
    </aside>
  );
}
