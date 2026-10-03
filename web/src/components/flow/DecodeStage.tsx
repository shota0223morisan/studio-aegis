import { api } from "../../lib/api";
import { MarkdownMemo } from "../MarkdownMemo";
import { FilesSection } from "../FilesSection";
import { RefSlots } from "./RefSlots";
import { SimilarSongs } from "./SimilarSongs";
import type { StageProps } from "./types";

/** STAGE 01 DECODE: the brief, what the client really wants, three references. */
export function DecodeStage({ project, flow, update, session, onFilesChange, patchProject }: StageProps) {
  const a = flow.analysis ?? {};
  const setA = (patch: Partial<typeof a>) => update((f) => ({ ...f, analysis: { ...f.analysis, ...patch } }));
  return (
    <>
      <section className="card brief-card">
        <MarkdownMemo
          key={`brief-${project.id}`}
          index="01"
          icon="✉"
          title="先方からの指示"
          initial={project.brief}
          save={async (v) => {
            await api.updateProject(project.id, { brief: v });
            patchProject({ brief: v });
          }}
          placeholder="先方からの依頼・修正指示"
        >
          <FilesSection bare only={["client_ref"]} projectId={project.id} files={project.files} maxUploadBytes={session.maxUploadBytes} onFilesChange={onFilesChange} />
        </MarkdownMemo>
        <div className="decode-mission">
          <label>
            <span className="fx-en">MISSION</span>
          </label>
          <input
            value={flow.mission ?? ""}
            placeholder="先方が本当に欲しいもの"
            onChange={(e) => update((f) => ({ ...f, mission: e.target.value }))}
          />
        </div>
      </section>

      <RefSlots flow={flow} update={update} files={project.files} />

      <section className="card">
        <div className="section-head">
          <span className="sec-index">04</span>
          <h2 className="fx-en">ANALYSIS</h2>
          <span className="sec-line" />
        </div>
        <div className="analysis-grid">
          <label>
            <span>テンポ(BPM)</span>
            <input value={a.bpm ?? ""} placeholder={suggestBpm(flow) ?? ""} onChange={(e) => setA({ bpm: e.target.value })} />
            <RefTempos flow={flow} bpm={a.bpm} onPick={(bpm) => setA({ bpm })} />
          </label>
          <label>
            <span>ビート感</span>
            <input value={a.beat ?? ""} placeholder="" onChange={(e) => setA({ beat: e.target.value })} />
          </label>
          <label className="wide">
            <span>構成のヒント</span>
            <input value={a.form ?? ""} placeholder="" onChange={(e) => setA({ form: e.target.value })} />
          </label>
        </div>
      </section>

      <SimilarSongs projectId={project.id} flow={flow} update={update} />
    </>
  );
}

/** The references' tempos next to the song's, to compare at a glance (click to use one). */
function RefTempos({ flow, bpm, onPick }: { flow: StageProps["flow"]; bpm?: string; onPick: (bpm: string) => void }) {
  const mine = Number(String(bpm ?? "").match(/\d+(\.\d+)?/)?.[0]) || 0;
  const refs = (flow.refs ?? []).map((r, i) => ({ key: "ABCDEFGH"[i], bpm: Number(r.bpm) || 0 })).filter((r) => r.bpm > 0);
  if (!refs.length) return null;
  return (
    <span className="ref-tempos">
      {refs.map((r) => {
        const diff = mine ? Math.round(mine - r.bpm) : null;
        return (
          <button key={r.key} type="button" className="chip-btn" onClick={() => onPick(String(r.bpm))} title="このテンポにする">
            {r.key} {r.bpm}
            {diff !== null && diff !== 0 && <small className={Math.abs(diff) > 15 ? "far" : ""}> {diff > 0 ? `+${diff}` : diff}</small>}
          </button>
        );
      })}
    </span>
  );
}

/** Average of the references' BPMs as a hint. */
function suggestBpm(flow: StageProps["flow"]): string | null {
  const bpms = (flow.refs ?? []).map((r) => Number(r.bpm)).filter((n) => n > 0);
  if (!bpms.length) return null;
  return `参考曲の平均: ${Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)}`;
}
