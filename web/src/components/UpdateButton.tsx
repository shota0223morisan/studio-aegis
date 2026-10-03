import { useEffect, useState } from "react";
import { desktop, type UpdateInfo, type UpdateProgress } from "../lib/desktop";
import { formatBytes } from "../lib/format";

/**
 * 「今すぐ更新」: downloads the new version, swaps the app and relaunches — all automatic.
 * Falls back to the download page when the app can't replace itself.
 */
export function UpdateButton({ info, small = false }: { info: UpdateInfo; small?: boolean }) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  useEffect(() => desktop?.onUpdateProgress(setProgress), []);

  if (!desktop || !info.available) return null;

  if (!info.canInstall) {
    return (
      <>
        <button className={`btn ${small ? "small" : ""}`} onClick={() => info.url && void desktop!.openExternal(info.url)}>
          ダウンロードページを開く
        </button>
        {info.problem && <span className="muted small">{info.problem}</span>}
      </>
    );
  }

  const busy = progress && progress.phase !== "error";
  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null;
  const label =
    progress?.phase === "downloading"
      ? `ダウンロード中 ${pct ?? 0}%${progress.total ? `(${formatBytes(progress.total)})` : ""}`
      : progress?.phase === "verifying"
        ? "確認中…"
        : progress?.phase === "restarting"
          ? "再起動します…"
          : `今すぐ ${info.latest} に更新`;

  return (
    <>
      <button
        className={`btn primary update-btn ${small ? "small" : ""} ${busy ? "busy" : ""}`}
        disabled={Boolean(busy)}
        style={busy && pct !== null ? ({ "--pct": `${pct}%` } as React.CSSProperties) : undefined}
        onClick={() => {
          setProgress({ phase: "downloading", done: 0, total: 0 });
          void desktop!.updateNow();
        }}
      >
        ⬆ {label}
      </button>
      {progress?.phase === "error" && <span className="error small">{progress.error}</span>}
    </>
  );
}
