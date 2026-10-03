import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { desktop, type UpdateInfo } from "../lib/desktop";
import { ThemeGallery } from "../components/ThemePicker";
import { UpdateButton } from "../components/UpdateButton";

export function SettingsPage() {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    document.title = "設定 — Studio Aegis";
    void desktop?.getInfo().then(setInfo);
  }, []);

  return (
    <div className="settings-page">
      <h1>設定</h1>

      <section className="card">
        <div className="section-head">
          <h2>デザインテーマ</h2>
          <span className="muted small">右上の 🎨 からもすぐ切り替えられます</span>
        </div>
        <ThemeGallery />
      </section>

      <NotionSettings />

      {desktop && (
        <section className="card">
          <div className="section-head">
            <h2>データ</h2>
          </div>
          <p className="small">
            案件・メモ・音源はこの Mac の中にだけ保存されています。Time Machine を使っていれば自動でバックアップされます。
          </p>
          {info && (
            <p className="muted small">
              保存場所: <code>{info.dataDir}</code>
            </p>
          )}
          <div className="row">
            <button className="btn" onClick={() => void desktop!.openDataFolder()}>
              Finder で開く
            </button>
            <button className="btn" onClick={() => void desktop!.exportBackup()}>
              バックアップを書き出す…
            </button>
          </div>
        </section>
      )}

      {desktop && (
        <section className="card">
          <div className="section-head">
            <h2>アプリ</h2>
            <span className="muted small">バージョン {info?.version}</span>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                setUpdate(await desktop!.checkForUpdate());
                setChecking(false);
              }}
            >
              {checking ? "確認中…" : "アップデートを確認"}
            </button>
            {update && !update.available && (
              <span className="muted small">{update.latest ? "最新です" : (update.problem ?? "確認できませんでした")}</span>
            )}
            {update?.available && <UpdateButton info={update} />}
          </div>
          <p className="hint small">「今すぐ更新」で新しい版を自動でダウンロードして入れ替え、再起動します。データはそのまま残ります。</p>
        </section>
      )}
    </div>
  );
}

function NotionSettings() {
  const [status, setStatus] = useState<{ configured: boolean; dbUrl: string } | null>(null);
  const [token, setToken] = useState("");
  const [db, setDb] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void api.notionStatus().then((s) => {
      setStatus(s);
      setDb(s.dbUrl);
    });
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const s = await api.notionSettings({ ...(token.trim() ? { token: token.trim() } : {}), db });
      setStatus(s);
      setToken("");
      if (!s.configured) return setMessage("保存しました。トークンも入れると表示されます。");
      setTesting(true);
      const r = await api.notionIdeas(true);
      setMessage(r.error ? null : `つながりました。アイデア ${r.items.length} 件を読み込みました。`);
      if (r.error) setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Notion(アイデア)</h2>
        <span className="muted small">{status?.configured ? "接続設定済み" : "未設定"}</span>
      </div>
      <p className="small">曲の画面の「アイデア」に、Notion の「🎛 制作アイディア」データベースを表示します(読むだけで、Notion 側は変更しません)。</p>
      <ol className="steps">
        <li>
          <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
            Notion のインテグレーション
          </a>
          で「新しいインテグレーション」(内部)を作り、トークン(ntn_…)をコピー。<b>Lyric Machine で使っているトークンがあればそれで OK</b>
        </li>
        <li>Notion で「🎛 制作アイディア」を開き、右上の「…」→「接続」からそのインテグレーションを追加</li>
        <li>下にトークンを貼り付けて保存(データベースの URL は最初から入っています)</li>
      </ol>
      <form className="stack-form" onSubmit={save}>
        <input
          type="password"
          placeholder={status?.configured ? "トークン(変更するときだけ入力)" : "トークン ntn_…"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
        <input placeholder="データベースの URL" value={db} onChange={(e) => setDb(e.target.value)} />
        <div className="row">
          <button className="btn primary" disabled={testing}>
            {testing ? "確認中…" : "保存して接続を確認"}
          </button>
          {status?.configured && (
            <button
              type="button"
              className="btn ghost small"
              onClick={async () => {
                if (!window.confirm("Notion のトークンを削除しますか?")) return;
                setStatus(await api.notionSettings({ token: "" }));
                setMessage("トークンを削除しました");
              }}
            >
              トークンを削除
            </button>
          )}
        </div>
      </form>
      {message && <p className="hint">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
