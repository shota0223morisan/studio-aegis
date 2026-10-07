import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, type Session } from "./lib/api";
import { desktop, type PanePreset, type PaneState, type UpdateInfo } from "./lib/desktop";
import { LibraryProvider } from "./lib/library";
import { PrefsProvider } from "./lib/prefs";
import { useToast } from "./lib/toast";
import { useFold } from "./lib/fold";
import { useTickSparkles } from "./lib/fx";
import { usePane } from "./lib/usePane";
import { HomePage } from "./pages/HomePage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientPage } from "./pages/ClientPage";
import { SongPage } from "./pages/SongPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VaultPage } from "./pages/VaultPage";
import { PaneTabsPage } from "./pages/PaneTabsPage";
import { ThemeDots } from "./components/ThemePicker";
import { Sidebar } from "./components/Sidebar";
import { UpdateButton } from "./components/UpdateButton";
import { PaneDivider } from "./components/PaneDivider";

export function App() {
  const location = useLocation();
  // The left pane's tab bar is a separate tiny window of the same UI.
  if (location.pathname === "/pane") return <PaneTabsPage />;
  return <Shell />;
}

const NAV = [
  { to: "/", label: "ワーク", end: true },
  { to: "/clients", label: "取引先", end: false },
  { to: "/vault", label: "MIDI", end: false },
  { to: "/settings", label: "設定", end: false },
];

function Shell() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("aegis.sidebar") !== "0");
  // In a narrow window (both side panes open) the sidebar folds and opens over the page instead.
  const narrow = useNarrow(980);
  const [overlay, setOverlay] = useState(false);
  const location = useLocation();
  const pane = usePane();
  const note = useToast();
  useFold();
  useTickSparkles();
  useEffect(() => setOverlay(false), [location.pathname, narrow]);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setError("起動に失敗しました。アプリを開き直してください。"));
    return desktop?.onUpdateAvailable(setUpdate);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("aegis.sidebar", sidebarOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);

  if (error) return <div className="center-screen muted">{error}</div>;
  if (!session) return <div className="center-screen muted">読み込み中…</div>;

  return (
    <PrefsProvider>
    <LibraryProvider>
        <div className="app">
          <div className="world" aria-hidden>
            <div className="world-art" />
          </div>
          {pane?.left.open && <PaneDivider side="left" />}
          {pane?.right.open && <PaneDivider side="right" />}
          <header className="topbar">
            <div className="topbar-left">
              {desktop && (
                <button
                  className={`icon-btn pane-toggle ${pane?.left.open ? "on" : ""}`}
                  onClick={() => void desktop!.togglePane("left")}
                  title={pane?.left.open ? "左パネルを畳む(⌘⇧L)" : "左パネルを開く(⌘⇧L)"}
                  aria-label="左パネルの表示切り替え"
                >
                  ◧
                </button>
              )}
              <Link to="/" className="brand">
                <span className="eq" aria-hidden>
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="brand-text">Session Partner</span>
              </Link>
            </div>
            <nav className="nav">
              {NAV.map((n, i) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : "")}>
                  <small>{String(i + 1).padStart(2, "0")}</small>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="topbar-right">
              {desktop && <PresetSwitch pane={pane} />}
              <ThemeDots />
              {desktop && (
                <button
                  className={`icon-btn pane-toggle ${pane?.right.open ? "on" : ""}`}
                  onClick={() => void desktop!.togglePane("right")}
                  title={pane?.right.open ? "右パネルを畳む(⌘⇧R)" : "右パネルを開く(⌘⇧R)"}
                  aria-label="右パネルの表示切り替え"
                >
                  ◨
                </button>
              )}
            </div>
          </header>
          {update?.available && (
            <div className="update-banner">
              新しいバージョン {update.latest} があります。
              <UpdateButton info={update} small />
              <button className="btn ghost small" onClick={() => setUpdate(null)}>
                あとで
              </button>
            </div>
          )}
          <div className={`body ${narrow ? `narrow ${overlay ? "overlay" : ""}` : sidebarOpen ? "" : "sidebar-closed"}`}>
            <Sidebar open={narrow ? overlay : sidebarOpen} onToggle={() => (narrow ? setOverlay((v) => !v) : setSidebarOpen((v) => !v))} />
            <main className="main">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/c/:id" element={<ClientPage />} />
                <Route path="/p/:id" element={<SongPage session={session} />} />
                <Route path="/vault" element={<VaultPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<p className="muted">ページが見つかりません</p>} />
              </Routes>
            </main>
          </div>
          {note && (
            <div key={note.id} className={`toast ${note.error ? "error" : ""}`} role="status">
              {note.text}
            </div>
          )}
        </div>
    </LibraryProvider>
    </PrefsProvider>
  );
}

function useNarrow(px: number) {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

const PRESETS: { id: PanePreset; label: string; hint: string }[] = [
  { id: "listen", label: "LISTEN", hint: "プレイヤー(YT Music など)だけ" },
  { id: "polish", label: "POLISH", hint: "Splice だけ" },
  { id: "build", label: "BUILD", hint: "左右とも開く" },
  { id: "focus", label: "FOCUS", hint: "両方畳んでアプリだけ(⌘⇧F)" },
];

/** Which preset the panes are in now: the Splice side / the player side open or not. */
function currentPreset(pane: PaneState): PanePreset {
  const spliceOpen = pane[pane.sides.splice].open;
  const playerOpen = pane[pane.sides.ytmusic].open;
  if (pane.sides.splice === pane.sides.ytmusic) {
    const open = pane[pane.sides.splice].open;
    const other = pane[pane.sides.splice === "left" ? "right" : "left"].open;
    return open && other ? "build" : open || other ? "listen" : "focus";
  }
  return spliceOpen && playerOpen ? "build" : spliceOpen ? "polish" : playerOpen ? "listen" : "focus";
}

/** One-click side-pane layouts; the one the panes are in now is highlighted. */
function PresetSwitch({ pane }: { pane: PaneState | null }) {
  const now = pane ? currentPreset(pane) : null;
  return (
    <div className="preset-switch" role="group" aria-label="レイアウト">
      {PRESETS.map((p) => (
        <button key={p.id} className={p.id === now ? "on" : ""} aria-pressed={p.id === now} onClick={() => void desktop!.applyPreset(p.id)} title={p.hint}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
