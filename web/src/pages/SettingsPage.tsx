import { useEffect, useState, type FormEvent } from "react";
import { api, type NotionStatus } from "../lib/api";
import { STAGES } from "../lib/flow";
import { usePrefs } from "../lib/prefs";
import { desktop, type UpdateInfo } from "../lib/desktop";
import { ThemeGallery } from "../components/ThemePicker";
import { UpdateButton } from "../components/UpdateButton";

export function SettingsPage() {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    document.title = "設定 — Session Partner";
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

      <FlowSettings />

      <AiSettings />

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
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [token, setToken] = useState("");
  const [db, setDb] = useState("");
  const [mixPage, setMixPage] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void api.notionStatus().then((s) => {
      setStatus(s);
      setDb(s.dbUrl);
      setMixPage(s.mixUrl);
    });
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const s = await api.notionSettings({ ...(token.trim() ? { token: token.trim() } : {}), db, mixPage });
      setStatus(s);
      setToken("");
      if (!s.configured) return setMessage("保存しました。トークンも入れると表示されます。");
      setTesting(true);
      const [r, m] = await Promise.all([api.notionIdeas(true), api.notionMix(true)]);
      const errors = [r.error, m.error && `Mixing Tips: ${m.error.replace("「🎛 制作アイディア」", "「🎚️ Mixing Tips」")}`].filter(Boolean);
      setMessage(r.error ? null : `つながりました。アイデア ${r.items.length} 件${m.error ? "" : "・Mixing Tips"}を読み込みました。`);
      if (errors.length) setError(errors.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Notion(アイデア・Mixing Tips)</h2>
        <span className="muted small">{status?.configured ? "接続設定済み" : "未設定"}</span>
      </div>
      <p className="small">
        FRAME・LAYER に「🎛 制作アイディア」データベース、MIXING に「🎚️ Mixing Tips」ページを表示します(読むだけで、Notion 側は変更しません)。Mixing Tips の書き出し前チェックリストが MIXING の鍵になります。
      </p>
      <ol className="steps">
        <li>
          <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
            Notion のインテグレーション
          </a>
          で「新しいインテグレーション」(内部)を作り、トークン(ntn_…)をコピー。<b>Lyric Machine で使っているトークンがあればそれで OK</b>
        </li>
        <li>Notion で「🎛 制作アイディア」と「🎚️ Mixing Tips」を開き、それぞれ右上の「…」→「接続」からそのインテグレーションを追加</li>
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
        <label className="field">
          <span className="muted small">制作アイディア(データベース)の URL</span>
          <input placeholder="データベースの URL" value={db} onChange={(e) => setDb(e.target.value)} />
        </label>
        <label className="field">
          <span className="muted small">Mixing Tips(ページ)の URL</span>
          <input placeholder="ページの URL" value={mixPage} onChange={(e) => setMixPage(e.target.value)} />
        </label>
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

function FlowSettings() {
  const { prefs, update } = usePrefs();
  return (
    <section className="card">
      <div className="section-head">
        <h2>制作フロー</h2>
      </div>
      <div className="settings-rows">
        <div className="settings-row">
          <div>
            <b>ステージの鍵</b>
            <p className="muted small">固い: クリア条件を全部満たすまで次のステージに進めない / ゆるい: 確認のうえ進める(飛ばしたことは記録に残る)</p>
          </div>
          <div className="segmented">
            <button className={prefs.gate === "hard" ? "active" : ""} onClick={() => void update({ gate: "hard" })}>
              🔒 固い
            </button>
            <button className={prefs.gate === "soft" ? "active" : ""} onClick={() => void update({ gate: "soft" })}>
              ゆるい
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <b>制限時間(分)</b>
            <p className="muted small">START を押すと計測。超えると通知して「仮で決めて次へ」と出ます。0 で制限なし</p>
          </div>
          <div className="timebox-inputs">
            {STAGES.slice(0, 4).map((s) => (
              <label key={s.n}>
                <span>{s.en}</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={prefs.timebox[s.n] ?? 0}
                  onChange={(e) => void update({ timebox: { ...prefs.timebox, [s.n]: Number(e.target.value) || 0 } })}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <b>ステージに合わせて左右のパネルを切り替える</b>
            <p className="muted small">DECODE → LISTEN / FRAME・LAYER → BUILD / MIXING → POLISH / SHIP → FOCUS</p>
          </div>
          <div className="segmented">
            <button className={prefs.autoLayout ? "active" : ""} onClick={() => void update({ autoLayout: true })}>
              する
            </button>
            <button className={!prefs.autoLayout ? "active" : ""} onClick={() => void update({ autoLayout: false })}>
              しない
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AiSettings() {
  const { prefs, update } = usePrefs();
  const [status, setStatus] = useState<{ found: boolean; path: string; version: string } | null>(null);
  useEffect(() => {
    void api.aiStatus().then(setStatus);
  }, []);
  return (
    <section className="card">
      <div className="section-head">
        <h2>AI(Claude のサブスク)</h2>
        <span className="muted small">{status ? (status.found ? `Claude Code ${status.version}` : "Claude Code が見つかりません") : "確認中…"}</span>
      </div>
      <p className="small">
        AI の相談・近い曲探し・MIDI 生成・Suno のスタイル作りは、この Mac の Claude Code(<code>claude</code> コマンド)を通して、契約中の Claude のサブスクで動きます(API キー・従量課金なし)。
      </p>
      {status && !status.found && (
        <ol className="steps">
          <li>
            <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
              Claude Code
            </a>
            を入れる
          </li>
          <li>
            ターミナルで <code>claude</code> を起動し、<code>/login</code> でサブスクのアカウントにログイン
          </li>
          <li>このページを開き直して「Claude Code …」と出れば OK</li>
        </ol>
      )}
      <div className="settings-row">
        <div>
          <b>モデル</b>
          <p className="muted small">「既定」はサブスクの既定のモデル</p>
        </div>
        <select value={prefs.aiModel} onChange={(e) => void update({ aiModel: e.target.value as typeof prefs.aiModel })}>
          <option value="claude">既定</option>
          <option value="fable">Fable</option>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet(速い)</option>
        </select>
      </div>
    </section>
  );
}
