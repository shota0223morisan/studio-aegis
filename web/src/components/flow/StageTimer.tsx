import { useEffect, useState } from "react";
import { elapsed, formatClock, type Flow } from "../../lib/flow";

/** Timebox for a stage: start / pause, and a warning once the planned time is used up. */
export function StageTimer({
  flow,
  stage,
  minutes,
  editable,
  onToggle,
  onNotified,
}: {
  flow: Flow;
  stage: number;
  minutes: number;
  editable: boolean;
  onToggle: () => void;
  onNotified: () => void;
}) {
  const [, tick] = useState(0);
  const running = flow.running?.stage === stage;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const sec = elapsed(flow, stage);
  const limit = minutes * 60;
  const over = limit > 0 && sec > limit;
  const pct = limit > 0 ? Math.min(100, (sec / limit) * 100) : 0;

  // One notification per stage when the timebox runs out.
  useEffect(() => {
    if (!running || !over || flow.notified?.[stage]) return;
    onNotified();
    try {
      new Notification("Studio Aegis — タイムアップ", { body: "予定の時間を使い切りました。仮で決めて次へ進みましょう。", silent: false });
    } catch {
      /* notifications unavailable */
    }
  }, [running, over, stage, flow.notified, onNotified]);

  return (
    <div className={`timebox ${over ? "over" : ""} ${running ? "running" : ""}`}>
      <div className="timebox-top">
        <span className="timebox-t">{formatClock(sec)}</span>
        <small>{limit > 0 ? `/ ${formatClock(limit)}` : "時間制限なし"}</small>
        {editable && (
          <button className={`btn small ${running ? "" : "primary"}`} onClick={onToggle} title={running ? "一時停止" : "このステージの計測を開始"}>
            {running ? "❚❚" : "▶ START"}
          </button>
        )}
      </div>
      {limit > 0 && (
        <div className="timebox-bar">
          <b style={{ width: `${pct}%` }} />
        </div>
      )}
      {over && <div className="timebox-warn">タイムアップ — 仮で決めて次へ</div>}
    </div>
  );
}
