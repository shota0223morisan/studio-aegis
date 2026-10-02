import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { api, type Session } from "./lib/api";
import { desktop, type UpdateInfo } from "./lib/desktop";
import { SpotifyProvider } from "./lib/SpotifyContext";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PlayerBar } from "./components/PlayerBar";
import { SpotifyAccount } from "./components/SpotifyAccount";
import { ThemePicker } from "./components/ThemePicker";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setError("起動に失敗しました。アプリを開き直してください。"));
    return desktop?.onUpdateAvailable(setUpdate);
  }, []);

  if (error) return <div className="center-screen muted">{error}</div>;
  if (!session) return <div className="center-screen muted">読み込み中…</div>;

  return (
    <SpotifyProvider>
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="eq" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="brand-text">Studio Aegis</span>
          </Link>
          <div className="topbar-right">
            <SpotifyAccount />
            <ThemePicker />
            <NavLink to="/settings" className="btn ghost small">
              設定
            </NavLink>
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
        <main className="main">
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/p/:id" element={<ProjectPage session={session} />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<p className="muted">ページが見つかりません</p>} />
          </Routes>
        </main>
        <PlayerBar />
      </div>
    </SpotifyProvider>
  );
}
