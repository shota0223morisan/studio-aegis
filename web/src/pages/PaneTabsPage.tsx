import { useEffect, useState, type FormEvent } from "react";
import { desktop, type PaneTab } from "../lib/desktop";
import { usePane } from "../lib/usePane";

const TABS: { id: PaneTab; label: string; icon: string; key: string }[] = [
  { id: "spotify", label: "Spotify", icon: "●", key: "⌘1" },
  { id: "amazon", label: "Amazon", icon: "♫", key: "⌘2" },
  { id: "splice", label: "Splice", icon: "◆", key: "⌘3" },
  { id: "web", label: "Web", icon: "◎", key: "⌘4" },
];

const SPOTIFY_HINT =
  "左の Spotify では音が出ません(アプリ内蔵ブラウザに Spotify の再生用 DRM がないため)。\n\n" +
  "検索やプレイリストの操作はここで、音は Mac の Spotify アプリから鳴らします。" +
  "画面下の「デバイスに接続」で Mac の Spotify を選ぶと、ここがリモコンになります。";

/** Tab bar above the left pane (rendered in its own small web view by the desktop app). */
export function PaneTabsPage() {
  const pane = usePane();
  const page = pane ? pane[pane.tab] : null;
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    document.body.classList.add("pane-tabs-body");
  }, []);
  useEffect(() => {
    if (!editing) setAddress(pane?.web?.url ?? "");
  }, [pane?.web?.url, editing]);

  if (!desktop) return null;

  function go(e: FormEvent) {
    e.preventDefault();
    void desktop!.webGo(address);
    setEditing(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  return (
    <div className="pane-tabs">
      <div className="pane-row">
        <div className="pane-tab-list" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={pane?.tab === t.id}
              className={`pane-tab ${t.id} ${pane?.tab === t.id ? "on" : ""}`}
              onClick={() => void desktop!.setPaneTab(t.id)}
              title={`${t.label}(${t.key})`}
            >
              <span className="pane-tab-icon">{t.icon}</span>
              <span className="pane-tab-label">{t.label}</span>
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
      {pane?.tab === "web" && (
        <form className="pane-row address-row" onSubmit={go}>
          <input
            className="address"
            value={address}
            placeholder="URL か検索ワード(Google)"
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
          />
          <button type="button" className="btn small ghost" onClick={() => void desktop!.paneNav("chrome")} title="今のページを Chrome で開く">
            Chrome ↗
          </button>
          <button type="button" className="btn small ghost" onClick={() => void desktop!.paneNav("safari")} title="今のページを Safari で開く">
            Safari ↗
          </button>
        </form>
      )}
    </div>
  );
}
