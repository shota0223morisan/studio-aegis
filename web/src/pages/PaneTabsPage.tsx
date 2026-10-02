import { useEffect } from "react";
import { desktop, type PaneTab } from "../lib/desktop";
import { usePane } from "../lib/usePane";

const TABS: { id: PaneTab; label: string; icon: string }[] = [
  { id: "spotify", label: "Spotify", icon: "●" },
  { id: "splice", label: "Splice", icon: "◆" },
];

const SPOTIFY_HINT =
  "左の Spotify では音が出ません(アプリ内蔵ブラウザに Spotify の再生用 DRM がないため)。\n\n" +
  "検索やプレイリストの操作はここで、音は Mac の Spotify アプリから鳴らします。" +
  "画面下の「デバイスに接続」で Mac の Spotify を選ぶと、ここがリモコンになります。";

/** Tab bar shown above the left pane (rendered in its own small web view by the desktop app). */
export function PaneTabsPage() {
  const pane = usePane();
  useEffect(() => {
    document.body.classList.add("pane-tabs-body");
  }, []);
  if (!desktop) return null;
  const page = pane ? pane[pane.tab] : null;

  return (
    <div className="pane-tabs">
      <div className="pane-tab-list" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={pane?.tab === t.id}
            className={`pane-tab ${t.id} ${pane?.tab === t.id ? "on" : ""}`}
            onClick={() => void desktop!.setPaneTab(t.id)}
          >
            <span className="pane-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="pane-tools">
        <button className="icon-btn" disabled={!page?.canGoBack} onClick={() => void desktop!.paneNav("back")} title="戻る">
          ←
        </button>
        <button className="icon-btn" disabled={!page?.canGoForward} onClick={() => void desktop!.paneNav("forward")} title="進む">
          →
        </button>
        <button className="icon-btn" onClick={() => void desktop!.paneNav("reload")} title="再読み込み">
          {page?.loading ? "…" : "⟳"}
        </button>
        <button className="icon-btn" onClick={() => void desktop!.paneNav("home")} title="ホーム">
          ⌂
        </button>
        <button className="icon-btn" onClick={() => void desktop!.paneNav("external")} title="ブラウザで開く">
          ↗
        </button>
        {pane?.tab === "spotify" && (
          <button className="icon-btn" onClick={() => window.alert(SPOTIFY_HINT)} title="Spotify の再生について">
            ?
          </button>
        )}
        <button className="icon-btn" onClick={() => void desktop!.togglePane(false)} title="左パネルを隠す(⌘⇧L)">
          ✕
        </button>
      </div>
    </div>
  );
}
