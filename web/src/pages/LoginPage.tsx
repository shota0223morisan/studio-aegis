import { useState, type FormEvent } from "react";
import { api } from "../lib/api";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="login" onSubmit={submit}>
        <h1 className="brand-lg">Studio Aegis</h1>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !password}>
          {busy ? "確認中…" : "ログイン"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
