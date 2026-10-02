import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { desktop, type UpdateInfo } from "../lib/desktop";
import { useSpotify } from "../lib/SpotifyContext";

export function SettingsPage() {
  const spotify = useSpotify();
  const [clientId, setClientId] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    document.title = "設定 — Studio Aegis";
    void desktop?.getInfo().then(setInfo);
  }, []);

  async function saveClientId(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    try {
      await api.spotifySetClientId(clientId.trim());
      await spotify.refreshStatus();
      setClientId("");
      setSaved(clientId.trim() ? "保存しました。右上の「Spotify に接続」から接続してください。" : "Client ID を削除しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  }

  const redirectUri = spotify.status?.redirectUri ?? "";

  return (
    <div className="settings-page">
      <h1>設定</h1>

      <section className="card">
        <div className="section-head">
          <h2>Spotify 連携</h2>
          <span className="muted small">
            {spotify.status?.connected
              ? `接続中: ${spotify.status.user?.display_name ?? "Spotify"}`
              : spotify.status?.configured
                ? "Client ID 設定済み・未接続"
                : "未設定(埋め込みプレイヤーは使えます)"}
          </span>
        </div>
        <ol className="steps">
          <li>
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
              Spotify for Developers
            </a>
            で「Create app」(API は Web API にチェック)
          </li>
          <li>
            Redirect URI に次を登録:
            <div className="copy-row">
              <code>{redirectUri}</code>
              <button className="btn small" onClick={() => void navigator.clipboard.writeText(redirectUri)}>
                コピー
              </button>
            </div>
          </li>
          <li>作成したアプリの Client ID を下に貼り付けて保存(Client Secret は不要)</li>
        </ol>
        <form className="inline-form" onSubmit={saveClientId}>
          <input
            placeholder={spotify.status?.configured ? "新しい Client ID(空で保存すると削除)" : "Client ID(32 文字)"}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <button className="btn primary">保存</button>
        </form>
        {saved && <p className="hint">{saved}</p>}
        {error && <p className="error">{error}</p>}
        <p className="hint small">Spotify の開発者向けルール上、アプリ所有者に Spotify Premium が必要です。</p>
      </section>

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
            {update && !update.available && <span className="muted small">{update.latest ? "最新です" : "確認できませんでした"}</span>}
            {update?.available && (
              <button className="btn primary" onClick={() => update.url && void desktop!.openExternal(update.url)}>
                {update.latest} をダウンロード
              </button>
            )}
          </div>
          <p className="hint small">更新は新しい dmg を入れ直すだけです。データはそのまま残ります。</p>
        </section>
      )}
    </div>
  );
}
