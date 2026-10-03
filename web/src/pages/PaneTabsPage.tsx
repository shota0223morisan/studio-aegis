import { useEffect, useState, type FormEvent } from "react";
import { desktop, type PaneSide, type PaneTab } from "../lib/desktop";
import { usePane } from "../lib/usePane";

export const PANE_TABS: { id: PaneTab; label: string; icon: string }[] = [
  { id: "splice", label: "Splice", icon: "◆" },
  { id: "suno", label: "Suno", icon: "✦" },
  { id: "web", label: "Web", icon: "◎" },
  { id: "amazon", label: "Amazon", icon: "♫" },
  { id: "ytmusic", label: "YT Music", icon: "▶" },
  { id: "spotify", label: "Spotify", icon: "●" },
];

const SPOTIFY_HINT =
  "この Spotify では音が出ません(アプリ内蔵ブラウザに Spotify の再生用 DRM がないため)。\n\n" +
  "検索やプレイリストの操作はここで、音は Mac の Spotify アプリから鳴らします。" +
  "画面下の「デバイスに接続」で Mac の Spotify を選ぶと、ここがリモコンになります。\n\n" +
  "アプリ内で音を出したいときは YT Music タブを使ってください。";

/** Tab bar above a side pane (rendered in its own small web view by the desktop app: /pane?side=left|right). */
export function PaneTabsPage() {
  const side: PaneSide = new URLSearchParams(window.location.search).get("side") === "right" ? "right" : "left";
  const state = usePane();
  const pane = state?.[side];
  const page = pane?.tab ? state?.pages[pane.tab] : null;
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    document.body.classList.add("pane-tabs-body");
  }, []);
  useEffect(() => {
    if (!editing) setAddress(state?.pages.web?.url ?? "");
  }, [state?.pages.web?.url, editing]);

  if (!desktop || !state) return null;
  const tabs = PANE_TABS.filter((t) => state.sides[t.id] === side);

  function go(e: FormEvent) {
    e.preventDefault();
    void desktop!.webGo(address);
    setEditing(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  const fold = (
    <button className="icon-btn" onClick={() => void desktop!.togglePane(side, false)} title={side === "left" ? "左パネルを畳む(⌘⇧L)" : "右パネルを畳む(⌘⇧R)"}>
      {side === "left" ? "⟨" : "⟩"}
    </button>
  );

  return (
    <div className={`pane-tabs side-${side} ${tabs.length > 3 ? "many" : ""}`}>
      <div className="pane-row">
        {side === "right" && fold}
        <div className="pane-tab-list" role="tablist">
          {tabs.map((t) => {
            const idx = PANE_TABS.findIndex((x) => x.id === t.id) + 1;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={pane?.tab === t.id}
                className={`pane-tab ${t.id} ${pane?.tab === t.id ? "on" : ""}`}
                onClick={() => void desktop!.setPaneTab(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void desktop!.tabMenu(t.id);
                }}
                title={`${t.label}(⌘${idx}) — 右クリックで反対側へ移動`}
              >
                <span className="pane-tab-icon">{t.icon}</span>
                <span className="pane-tab-label">{t.label}</span>
              </button>
            );
          })}
        </div>
        <div className="pane-tools">
          <button className="icon-btn" disabled={!page?.canGoBack} onClick={() => void desktop!.paneNav(side, "back")} title="戻る">
            ←
          </button>
          <button className="icon-btn" disabled={!page?.canGoForward} onClick={() => void desktop!.paneNav(side, "forward")} title="進む">
            →
          </button>
          <button className="icon-btn" onClick={() => void desktop!.paneNav(side, "reload")} title="再読み込み">
            {page?.loading ? "…" : "⟳"}
          </button>
          <button className="icon-btn" onClick={() => void desktop!.paneNav(side, "home")} title="ホーム">
            ⌂
          </button>
          {pane?.tab === "spotify" && (
            <button className="icon-btn" onClick={() => window.alert(SPOTIFY_HINT)} title="Spotify の再生について">
              ?
            </button>
          )}
          {pane?.tab && (
            <button className="icon-btn" onClick={() => void desktop!.moveTab(pane.tab!)} title="このタブを反対側のパネルへ">
              {side === "left" ? "⇥" : "⇤"}
            </button>
          )}
          <button className="icon-btn" onClick={() => void desktop!.swapPanes()} title="左右を入れ替える(⌘⇧S)">
            ⇄
          </button>
          {side === "left" && fold}
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
          <button type="button" className="btn small ghost" onClick={() => void desktop!.paneNav(side, "chrome")} title="今のページを Chrome で開く">
            Chrome ↗
          </button>
          <button type="button" className="btn small ghost" onClick={() => void desktop!.paneNav(side, "safari")} title="今のページを Safari で開く">
            Safari ↗
          </button>
        </form>
      )}
    </div>
  );
}
