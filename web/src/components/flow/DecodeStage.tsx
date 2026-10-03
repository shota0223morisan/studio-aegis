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
          placeholder={"先方から届いた依頼・修正指示を貼り付け\n\n- 尺: \n- 納期: \n- イメージ: \n- リファレンス: "}
        >
          <FilesSection bare only={["client_ref"]} projectId={project.id} files={project.files} maxUploadBytes={session.maxUploadBytes} onFilesChange={onFilesChange} />
        </MarkdownMemo>
        <div className="decode-mission">
          <label>
            <span className="fx-en">MISSION</span>
            <span className="muted small">先方が本当に欲しいものを一言で</span>
          </label>
          <input
            value={flow.mission ?? ""}
            placeholder="例: サビで一気に視界が開ける疾走感。歌が主役で、ギターは控えめ"
            onChange={(e) => update((f) => ({ ...f, mission: e.target.value }))}
          />
        </div>
      </section>

      <RefSlots flow={flow} update={update} files={project.files} />

      <section className="card">
        <div className="section-head">
          <span className="sec-index">04</span>
          <h2 className="fx-en">ANALYSIS</h2>
          <span className="muted small">3 曲から決めること</span>
          <span className="sec-line" />
        </div>
        <div className="analysis-grid">
          <label>
            <span>テンポ(BPM)</span>
            <input value={a.bpm ?? ""} placeholder={suggestBpm(flow) ?? "例: 128"} onChange={(e) => setA({ bpm: e.target.value })} />
          </label>
          <label>
            <span>ビート感</span>
            <input value={a.beat ?? ""} placeholder="例: 4つ打ち+裏ハット / ハーフタイム" onChange={(e) => setA({ beat: e.target.value })} />
          </label>
          <label className="wide">
            <span>構成のヒント</span>
            <input value={a.form ?? ""} placeholder="例: イントロ短め、サビ始まり、間奏でブレイク" onChange={(e) => setA({ form: e.target.value })} />
          </label>
        </div>
      </section>

      <SimilarSongs projectId={project.id} flow={flow} update={update} />
    </>
  );
}

/** Average of the references' BPMs as a hint. */
function suggestBpm(flow: StageProps["flow"]): string | null {
  const bpms = (flow.refs ?? []).map((r) => Number(r.bpm)).filter((n) => n > 0);
  if (!bpms.length) return null;
  return `参考曲の平均: ${Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)}`;
}
