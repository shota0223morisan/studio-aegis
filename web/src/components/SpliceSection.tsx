import { useState, type FormEvent } from "react";
import { api, type ProjectDetail } from "../lib/api";
import { desktop } from "../lib/desktop";

/**
 * Splice Stack link.
 *
 * In-app display was investigated and is not possible: every splice.com page is served with
 * `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self'`, and
 * Splice offers no public embed/oEmbed or third-party web API. So we store the Stack's share
 * URL and open it in a new tab, or in a side window sized to sit next to Studio Aegis.
 *
 * In the desktop app, Splice opens in the left pane's Splice tab instead (a separate web view is a
 * top-level page, so the frame restrictions don't apply).
 */
export function SpliceSection({
  project,
  onChange,
}: {
  project: ProjectDetail;
  onChange: (p: Partial<ProjectDetail>) => void;
}) {
  const [editing, setEditing] = useState(!project.spliceUrl);
  const [url, setUrl] = useState(project.spliceUrl);
  const [label, setLabel] = useState(project.spliceLabel);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const p = await api.updateProject(project.id, { spliceUrl: url.trim(), spliceLabel: label.trim() });
      onChange({ spliceUrl: p.spliceUrl, spliceLabel: p.spliceLabel });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  }

  function openSideWindow() {
    const w = Math.min(560, Math.floor(window.screen.availWidth / 2.5));
    const h = window.screen.availHeight;
    const left = window.screen.availWidth - w;
    window.open(project.spliceUrl, "aegis-splice", `popup=yes,width=${w},height=${h},left=${left},top=0`);
  }

  return (
    <>
      <div className="section-head">
        <h2>Splice</h2>
        <span className="muted small">Stack</span>
        {!editing && (
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            編集
          </button>
        )}
      </div>

      {editing ? (
        <form className="stack-form" onSubmit={save}>
          <input
            type="url"
            placeholder="Splice Stack の共有 URL(https://splice.com/...)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input placeholder="ラベル(任意: 例 ドラム系 Stack)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
          <div className="row">
            <button className="btn primary">保存</button>
            {project.spliceUrl && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setUrl(project.spliceUrl);
                  setLabel(project.spliceLabel);
                  setEditing(false);
                }}
              >
                キャンセル
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <p className="hint">
            Splice の Stack 画面の共有ボタンで発行できるリンクを貼り付けてください。
          </p>
        </form>
      ) : (
        <div className="splice-card">
          <div className="splice-label">{project.spliceLabel || "Splice Stack"}</div>
          <div className="splice-url muted small">{project.spliceUrl}</div>
          {desktop ? (
            <div className="row">
              <button className="btn primary" onClick={() => void desktop!.openInPane("splice", project.spliceUrl)}>
                ◧ 左で開く
              </button>
              <a className="btn ghost" href={project.spliceUrl} target="_blank" rel="noreferrer">
                ブラウザで開く ↗
              </a>
            </div>
          ) : (
            <div className="row">
              <a className="btn primary" href={project.spliceUrl} target="_blank" rel="noreferrer">
                Splice で開く ↗
              </a>
              <button className="btn" onClick={openSideWindow} title="Studio Aegis の横に並べて開きます">
                サイドウィンドウで開く
              </button>
            </div>
          )}
        </div>
      )}
      <p className="hint small">
        {desktop
          ? "※ 左パネルの Splice タブで開きます(⌘2 で切り替え)。Splice へのログインはアプリ内に保存されます。"
          : "※ Splice はページの埋め込み(iframe)を禁止しており、公開 API もないため、ブラウザ版ではアプリ内表示はできません。リンクから開く方式にしています(デスクトップ版ではアプリ内に表示できます)。"}
      </p>
    </>
  );
}
