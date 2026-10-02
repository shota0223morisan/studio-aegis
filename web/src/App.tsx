import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { api, UNAUTHORIZED_EVENT, type Session } from "./lib/api";
import { SpotifyProvider } from "./lib/SpotifyContext";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { PlayerBar } from "./components/PlayerBar";
import { SpotifyAccount } from "./components/SpotifyAccount";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSession(await api.session());
      setError(null);
    } catch {
      setError("サーバーに接続できません");
    }
  }, []);

  useEffect(() => {
    void load();
    const onUnauthorized = () => void load();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [load]);

  if (error) return <div className="center-screen muted">{error}</div>;
  if (!session) return <div className="center-screen muted">読み込み中…</div>;
  if (session.setupRequired) {
    return (
      <div className="center-screen">
        <div className="login">
          <h1 className="brand-lg">Studio Aegis</h1>
          <p>
            パスワードが未設定のため、安全のため停止しています。ターミナルで
            <br />
            <code>npx wrangler secret put APP_PASSWORD</code>
            <br />
            を実行してから、このページを再読み込みしてください。
          </p>
        </div>
      </div>
    );
  }
  if (session.authRequired && !session.authenticated) return <LoginPage onLoggedIn={load} />;

  return (
    <SpotifyProvider>
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            Studio Aegis
          </Link>
          <div className="topbar-right">
            <SpotifyAccount />
            {session.authRequired && (
              <button
                className="btn ghost small"
                onClick={async () => {
                  await api.logout();
                  await load();
                }}
              >
                ログアウト
              </button>
            )}
          </div>
        </header>
        <main className="main">
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/p/:id" element={<ProjectPage session={session} />} />
            <Route path="*" element={<p className="muted">ページが見つかりません</p>} />
          </Routes>
        </main>
        <PlayerBar />
      </div>
    </SpotifyProvider>
  );
}
