import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, type Session } from "./lib/api";
import { desktop, type UpdateInfo } from "./lib/desktop";
import { LibraryProvider } from "./lib/library";
import { usePane } from "./lib/usePane";
import { HomePage } from "./pages/HomePage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientPage } from "./pages/ClientPage";
import { SongPage } from "./pages/SongPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PaneTabsPage } from "./pages/PaneTabsPage";
import { ThemeDots } from "./components/ThemePicker";
import { Sidebar } from "./components/Sidebar";
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
  { to: "/settings", label: "設定", end: false },
];

function Shell() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("aegis.sidebar") !== "0");
  const pane = usePane();

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
    <LibraryProvider>
        <div className="app">
          {pane?.open && <PaneDivider />}
          <header className="topbar">
            <div className="topbar-left">
              {desktop && (
                <button
                  className={`icon-btn pane-toggle ${pane?.open ? "on" : ""}`}
                  onClick={() => void desktop!.togglePane()}
                  title={pane?.open ? "左パネルを隠す(⌘⇧L)" : "左パネルを表示(⌘⇧L)"}
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
                <span className="brand-text">Studio Aegis</span>
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
              <ThemeDots />
            </div>
          </header>
          {update?.available && (
            <div className="update-banner">
              新しいバージョン {update.latest} があります。
              <button className="btn small" onClick={() => update.url && void desktop?.openExternal(update.url)}>
                ダウンロードページを開く
              </button>
              <button className="btn ghost small" onClick={() => setUpdate(null)}>
                あとで
              </button>
            </div>
          )}
          <div className={`body ${sidebarOpen ? "" : "sidebar-closed"}`}>
            <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
            <main className="main">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/c/:id" element={<ClientPage />} />
                <Route path="/p/:id" element={<SongPage session={session} />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<p className="muted">ページが見つかりません</p>} />
              </Routes>
            </main>
          </div>
        </div>
    </LibraryProvider>
  );
}
