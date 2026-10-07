import { stageMeta, type Check } from "../../lib/flow";

/** EXIT GATE: each item clears from what's written, or by ticking it (decided in the DAW). */
export function GatePanel({
  stage,
  checks,
  current,
  mode,
  onAdvance,
  onToggle,
  compact = false,
}: {
  stage: number;
  checks: Check[];
  /** Is this the song's current stage (only then can it be cleared)? */
  current: boolean;
  mode: "hard" | "soft";
  onAdvance: (missing: string[]) => void;
  onToggle: (check: Check) => void;
  /** Only the summary (the checklist itself is on the page). */
  compact?: boolean;
}) {
  const ok = checks.filter((c) => c.ok).length;
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  const clear = missing.length === 0;
  const next = stageMeta(stage + 1);

  return (
    <section className="card gate-card">
      <div className="section-head">
        <span className="sec-icon">◆</span>
        <h2 className="fx-en">EXIT GATE</h2>
        <span className="sec-line" />
        <span className="gate-meter">
          {ok}/{checks.length}
        </span>
      </div>
      {compact ? (
        <div className="gate-summary">
          <span className="gate-meter-bar">
            <b style={{ width: `${checks.length ? (ok / checks.length) * 100 : 0}%` }} />
          </span>
        </div>
      ) : (
        <ul className="gate-list">
          {checks.map((c) => (
            <li key={c.id} className={`${c.ok ? "ok" : ""} ${c.auto ? "is-auto" : ""}`}>
              <button
                className="gate-box"
                onClick={() => !c.auto && onToggle(c)}
                aria-pressed={c.ok}
                aria-label={c.label}
                title={c.auto ? "入力済み" : c.manual ? "チェックを外す" : "決めたらチェック"}
              >
                {c.ok ? "✓" : ""}
              </button>
              <span className="gate-label" onClick={() => !c.auto && onToggle(c)}>
                {c.label}
                {c.sub && <small>{c.sub}</small>}
              </span>
              {c.auto && <span className="gate-tag">入力済</span>}
            </li>
          ))}
        </ul>
      )}
      {current && stage < 5 && (
        <div className="gate-go">
          {clear ? (
            <button className="btn primary gate-btn" onClick={() => onAdvance([])}>
              STAGE 0{stage + 1} {next.en} へ →
            </button>
          ) : mode === "hard" ? (
            <button className="btn gate-btn" disabled>
              🔒 あと {missing.length} 個
            </button>
          ) : (
            <button
              className="btn gate-btn"
              onClick={() => {
                if (window.confirm(`まだ ${missing.length} 個残っています:\n\n・${missing.join("\n・")}\n\nこのまま進みますか?(記録に残ります)`)) onAdvance(missing);
              }}
            >
              未達のまま進む →
            </button>
          )}
        </div>
      )}
    </section>
  );
}
