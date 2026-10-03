import { STAGES, elapsed, formatClock } from "../../lib/flow";
import { usePrefs } from "../../lib/prefs";
import { FilesSection } from "../FilesSection";
import type { StageProps } from "./types";

/** STAGE 05 SHIP: the exported mp3 goes in, then submit — done. */
export function ShipStage({
  project,
  flow,
  session,
  onFilesChange,
  onSubmit,
  canSubmit,
  onManual,
}: StageProps & { onSubmit: (submitted: boolean) => void; canSubmit: boolean; onManual: () => void }) {
  const { prefs } = usePrefs();
  const submitted = Boolean(project.submittedAt);
  const total = STAGES.reduce((a, s) => a + elapsed(flow, s.n), 0);
  const max = Math.max(1, ...STAGES.map((s) => Math.max(elapsed(flow, s.n), (prefs.timebox[s.n] ?? 0) * 60)));

  return (
    <>
      <section className="card ship-drop">
        <FilesSection
          index="01"
          title="書き出した音源"
          only={["deliverable"]}
          projectId={project.id}
          files={project.files}
          maxUploadBytes={session.maxUploadBytes}
          onFilesChange={onFilesChange}
        />
      </section>

      <section className={`ship-submit ${submitted ? "done" : ""}`}>
        {submitted ? (
          <>
            <div>
              <div className="ship-big-text">TRACK COMPLETE</div>
              <div className="muted small">提出済み {new Date(project.submittedAt!).toLocaleString("ja-JP")}</div>
            </div>
            <button className="btn ghost small" onClick={() => onSubmit(false)}>
              提出を取り消す
            </button>
          </>
        ) : (
          <>
            <button className="ship-big" disabled={!canSubmit} onClick={() => onSubmit(true)}>
              SUBMIT ▶
            </button>
            {!canSubmit && (
              <button className="btn small" onClick={onManual}>
                ✓ 書き出した
              </button>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <span className="sec-index">02</span>
          <h2 className="fx-en">TIME LOG</h2>
          <span className="muted small">合計 {formatClock(total)}</span>
          <span className="sec-line" />
        </div>
        <div className="time-log">
          {STAGES.slice(0, 5).map((s) => {
            const sec = elapsed(flow, s.n);
            const plan = (prefs.timebox[s.n] ?? 0) * 60;
            return (
              <div key={s.n} className={`tl-row s${s.n} ${plan && sec > plan ? "over" : ""}`}>
                <span className="tl-name">{s.en}</span>
                <span className="tl-bar">
                  {plan > 0 && <i className="tl-plan" style={{ width: `${(plan / max) * 100}%` }} />}
                  <b style={{ width: `${(sec / max) * 100}%` }} />
                </span>
                <span className="tl-val">
                  {formatClock(sec)}
                  {plan > 0 && <small> / {formatClock(plan)}</small>}
                </span>
              </div>
            );
          })}
        </div>
        {(flow.overrides ?? []).length > 0 && (
          <div className="overrides">
            <div className="muted small">ゆるい鍵で飛ばしたこと</div>
            <ul>
              {flow.overrides!.map((o, i) => (
                <li key={i} className="small">
                  STAGE 0{o.stage}: {o.missing.join(" / ")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
