import { STAGES, type Check } from "../../lib/flow";

/** The 5-stage rail: done / current / locked, each node opens that stage's view. */
export function FlowRail({
  stage,
  view,
  progress,
  locked,
  submitted,
  onSelect,
}: {
  stage: number;
  view: number;
  progress: (n: number) => Check[];
  locked: (n: number) => boolean;
  submitted: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <div className="flow-rail" role="tablist" aria-label="制作フロー">
      {STAGES.map((s) => {
        const checks = progress(s.n);
        const ok = checks.filter((c) => c.ok).length;
        const pct = s.n < stage || submitted ? 100 : checks.length ? Math.round((ok / checks.length) * 100) : 0;
        const state = s.n < stage || (submitted && s.n === 5) ? "done" : s.n === stage ? "now" : "next";
        const isLocked = locked(s.n);
        return (
          <button
            key={s.n}
            role="tab"
            aria-selected={view === s.n}
            className={`rail-node s${s.n} ${state} ${view === s.n ? "viewing" : ""} ${isLocked ? "locked" : ""}`}
            onClick={() => !isLocked && onSelect(s.n)}
            disabled={isLocked}
            title={isLocked ? `🔒 STAGE ${s.n - 1} をクリアすると開きます` : `${s.en}(${s.jp})`}
          >
            <span className="rail-n">{state === "done" ? "✓" : isLocked ? "🔒" : `0${s.n}`}</span>
            <span className="rail-en">{s.en}</span>
            <span className="rail-jp">
              {s.jp}
              {state === "now" && checks.length > 0 && ` · ${pct}%`}
            </span>
            <span className="rail-bar">
              <b style={{ width: `${pct}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
