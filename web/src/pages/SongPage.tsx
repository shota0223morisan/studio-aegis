import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, type ProjectDetail, type Session, type StoredFile } from "../lib/api";
import { desktop } from "../lib/desktop";
import { stageChecks, stageMeta, stopTimer, type Flow } from "../lib/flow";
import { formatDate } from "../lib/format";
import { useLibrary } from "../lib/library";
import { useMixTips } from "../lib/mixTips";
import { GateProvider } from "../lib/gate";
import { usePrefs } from "../lib/prefs";
import { saveLabel, useAutosave } from "../lib/useAutosave";
import { Thumb } from "../components/Thumb";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { FilesSection } from "../components/FilesSection";
import { FlowRail } from "../components/flow/FlowRail";
import { StageTimer } from "../components/flow/StageTimer";
import { GatePanel } from "../components/flow/GatePanel";
import { StageMemo } from "../components/flow/StageMemo";
import { AiChat } from "../components/flow/AiChat";
import { DecodeStage } from "../components/flow/DecodeStage";
import { FrameStage } from "../components/flow/FrameStage";
import { LayerStage } from "../components/flow/LayerStage";
import { MixingStage } from "../components/flow/MixingStage";
import { ShipStage } from "../components/flow/ShipStage";
import { Parking, SunoHelper } from "../components/flow/SideTools";

/** One song's workspace, laid out as the 5-stage production flow. */
export function SongPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  // Keyed by id so pending autosaves always go to the song they belong to.
  return <SongWorkspace key={id} id={id} session={session} />;
}

const QUICK: Record<number, string[]> = {
  1: ["先方が本当に欲しいのはどこ？", "3 曲の共通点を整理して", "テンポとビートの方向性は？", "構成案を出して"],
  2: ["コード進行を 3 案", "何から作るのが一番早い？", "このテンポに合うドラムの方向性", "構成を見直して"],
  3: ["足りない上物は？", "参考曲の上物の使い方を分析して", "サビをもっと開かせるには？"],
  4: ["Mixing Tips で今やる順番を", "リファレンスと比べるポイント", "自分の弱点チェックの手順"],
  5: ["提出メールの文面を作って", "書き出し前の最終確認リスト"],
};

function SongWorkspace({ id, session }: { id: string; session: Session }) {
  const navigate = useNavigate();
  const { reload } = useLibrary();
  const { prefs } = usePrefs();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState(1);
  const [flash, setFlash] = useState<string | null>(null);
  const flowRef = useRef<Flow>({});
  const flowSave = useAutosave((f: Flow) => api.updateProject(id, { flow: f }), 700);
  const mix = useMixTips(Boolean(project && project.stage >= 4));

  useEffect(() => {
    api
      .getProject(id)
      .then((p) => {
        flowRef.current = p.flow ?? {};
        setProject(p);
        setView(p.stage);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (project) document.title = `${project.name} — Studio Aegis`;
  }, [project?.name]);

  const update = useCallback(
    (fn: (f: Flow) => Flow) => {
      const next = fn(flowRef.current);
      flowRef.current = next;
      setProject((p) => (p ? { ...p, flow: next } : p));
      flowSave.change(next);
    },
    [flowSave.change],
  );

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">読み込み中…</p>;

  const flow = project.flow ?? {};
  const patch = (p: Partial<ProjectDetail>) => setProject((cur) => (cur ? { ...cur, ...p } : cur));
  const checksFor = (n: number) => stageChecks(n, project, flow, mix.items);
  const submitted = Boolean(project.submittedAt);
  const meta = stageMeta(view);
  const current = view === project.stage;
  const props = { project, flow, update, session, onFilesChange: (files: StoredFile[]) => patch({ files }), patchProject: patch };

  async function advance(missing: string[]) {
    if (!project) return;
    const from = project.stage;
    const to = Math.min(5, from + 1);
    let f = flowRef.current;
    const wasRunning = f.running?.stage === from;
    f = stopTimer(f);
    if (missing.length) f = { ...f, overrides: [...(f.overrides ?? []), { stage: from, at: new Date().toISOString(), missing }] };
    f = { ...f, stageAt: { ...f.stageAt, [to]: new Date().toISOString() }, ...(wasRunning ? { running: { stage: to, since: Date.now() } } : {}) };
    flowRef.current = f;
    setProject((p) => (p ? { ...p, flow: f, stage: to } : p));
    setView(to);
    await api.updateProject(project.id, { stage: to, flow: f });
    void reload();
    setFlash(`STAGE 0${from} CLEAR — ${stageMeta(to).en}`);
    window.setTimeout(() => setFlash(null), 2600);
    if (prefs.autoLayout && desktop) void desktop.applyPreset(stageMeta(to).preset);
    document.querySelector(".main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTimer() {
    update((f) => {
      const running = f.running?.stage === view;
      const stopped = stopTimer(f);
      return running ? stopped : { ...stopped, running: { stage: view, since: Date.now() } };
    });
  }

  async function setSubmitted(on: boolean) {
    if (!project) return;
    if (!on && !window.confirm("提出を取り消しますか?")) return;
    const f = stopTimer(flowRef.current);
    flowRef.current = f;
    const submittedAt = on ? new Date().toISOString() : null;
    setProject((p) => (p ? { ...p, flow: f, submittedAt } : p));
    await api.updateProject(project.id, { submittedAt, flow: f });
    void reload();
    if (on) {
      setFlash("TRACK COMPLETE");
      window.setTimeout(() => setFlash(null), 3200);
    }
  }

  const gateChecks = checksFor(view);

  /** Tick a check by hand (MIXING items are the pre-export checklist / parked items). */
  function toggleCheck(c: { id: string; label: string }) {
    if (view === 4) {
      if (c.id.startsWith("park-")) {
        const id = c.id.slice(5);
        update((f) => ({ ...f, parked: (f.parked ?? []).map((p) => (p.id === id ? { ...p, done: !p.done } : p)) }));
      } else update((f) => ({ ...f, mixChecks: { ...f.mixChecks, [c.label]: !f.mixChecks?.[c.label] } }));
      return;
    }
    if (view === 2 && (c.id === "drums" || c.id === "bass" || c.id === "harmony")) {
      const id = c.id;
      update((f) => ({ ...f, core: { ...f.core, [id]: { ...f.core?.[id], done: !f.core?.[id]?.done } } }));
      return;
    }
    const k = `${view}:${c.id}`;
    update((f) => ({ ...f, manual: { ...f.manual, [k]: !f.manual?.[k] } }));
  }
  const memo = <StageMemo stage={view} initial={flow.notes?.[view] ?? ""} onSave={(text) => update((f) => ({ ...f, notes: { ...f.notes, [view]: text } }))} />;

  return (
    <div className={`page song-page flow-page stage-${view}`}>
      <SongHeader
        project={project}
        onChange={patch}
        onDelete={async () => {
          if (!window.confirm(`「${project.name}」を削除しますか?\nメモ・追加したファイルもすべて削除されます(MIDI は倉庫に残ります)。`)) return;
          await api.deleteProject(project.id);
          await reload();
          navigate(project.clientId ? `/c/${project.clientId}` : "/");
        }}
      />

      <FlowRail stage={project.stage} view={view} progress={checksFor} locked={(n) => n > project.stage} submitted={submitted} onSelect={setView} />

      <div className={`mission-bar s${view}`}>
        <div className="mission-text">
          <span className="mission-tag">MISSION 0{view}</span>
          <span className="mission-main">{meta.mission}</span>
          {!current && (
            <span className="mission-viewing">
              STAGE 0{view} を見ています(いまは 0{project.stage})
              <button className="btn ghost small" onClick={() => setView(project.stage)}>
                いまのステージへ
              </button>
            </span>
          )}
          {view >= 2 && view <= 3 && <span className="guard-badge">🔒 MIX・音作りは STAGE 04 まで封印</span>}
        </div>
        {view <= 4 && (
          <StageTimer
            flow={flow}
            stage={view}
            minutes={prefs.timebox[view] ?? 0}
            editable={!submitted}
            onToggle={toggleTimer}
            onNotified={() => update((f) => ({ ...f, notified: { ...f.notified, [view]: true } }))}
          />
        )}
      </div>

      <GateProvider checks={gateChecks} toggle={toggleCheck}>
      <div className="flow-grid">
        <div className="flow-main">
          {view !== 1 && <BriefPeek project={project} session={session} onFilesChange={props.onFilesChange} />}
          {view === 1 && <DecodeStage {...props} />}
          {view === 2 && <FrameStage {...props} />}
          {view === 3 && <LayerStage {...props} />}
          {view === 4 && <MixingStage {...props} />}
          {view === 5 && (
            <ShipStage {...props} onSubmit={(on) => void setSubmitted(on)} canSubmit={checksFor(5).every((c) => c.ok)} onManual={() => toggleCheck({ id: "master", label: "" })} />
          )}
        </div>
        <aside className="flow-side">
          {view < 5 && (
            <GatePanel stage={view} checks={gateChecks} current={current} mode={prefs.gate} onAdvance={(m) => void advance(m)} onToggle={toggleCheck} compact={view === 4} />
          )}
          <AiChat projectId={project.id} stage={view} quick={QUICK[view] ?? []} />
          {(view === 2 || view === 3) && <SunoHelper projectId={project.id} />}
          {(view === 2 || view === 3) && <Parking stage={view} flow={flow} update={update} />}
          {memo}
        </aside>
      </div>

      </GateProvider>

      <details className="card archive">
        <summary>
          <span className="sec-icon">▤</span> 全体メモ・その他のファイル
        </summary>
        <div className="archive-body">
          <MarkdownMemo
            key={`memo-${project.id}`}
            icon="✎"
            title="全体メモ"
            initial={project.structureMemo}
            save={(v) => api.updateProject(project.id, { structureMemo: v })}
            placeholder="ステージに関係ないメモ"
          />
          <FilesSection title="その他のファイル" only={["other"]} projectId={project.id} files={project.files} maxUploadBytes={session.maxUploadBytes} onFilesChange={props.onFilesChange} />
        </div>
      </details>

      {flash && (
        <div className="stage-flash" role="status">
          {flash}
        </div>
      )}
    </div>
  );
}

/** The client's brief, folded, on every stage after DECODE. */
function BriefPeek({ project, session, onFilesChange }: { project: ProjectDetail; session: Session; onFilesChange: (files: StoredFile[]) => void }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(project.brief || "", { async: false }) as string), [project.brief]);
  const first = project.brief.trim().split("\n")[0] ?? "";
  return (
    <details className="card brief-peek">
      <summary>
        <span className="sec-icon">✉</span> <b>先方からの指示</b>
        <span className="muted small brief-first">{first || "(未記入)"}</span>
      </summary>
      <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <FilesSection bare only={["client_ref"]} projectId={project.id} files={project.files} maxUploadBytes={session.maxUploadBytes} onFilesChange={onFilesChange} />
    </details>
  );
}

// Pseudo-random but stable bar timings for the hero's spectrum strip.
const WAVE = Array.from({ length: 64 }, (_, i) => ({
  delay: -((i * 137) % 1000) / 1000,
  duration: 0.55 + ((i * 53) % 70) / 100,
}));

function SongHeader({
  project,
  onChange,
  onDelete,
}: {
  project: ProjectDetail;
  onChange: (p: Partial<ProjectDetail>) => void;
  onDelete: () => void;
}) {
  const { clients, reload } = useLibrary();
  const [name, setName] = useState(project.name);
  const fileInput = useRef<HTMLInputElement>(null);
  const autosave = useAutosave(async (value: string) => {
    await api.updateProject(project.id, { name: value });
    await reload();
  }, 600);
  const client = clients.find((c) => c.id === project.clientId);

  async function changeThumb(file: File) {
    try {
      const p = await api.setThumbnail(project.id, file);
      onChange({ thumbnailUrl: p.thumbnailUrl, updatedAt: p.updatedAt });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "画像の追加に失敗しました");
    }
  }

  return (
    <div className="song-hero">
      <div className="song-hero-bg" style={project.thumbnailUrl ? { backgroundImage: `url(${project.thumbnailUrl})` } : undefined} aria-hidden />
      <div className="project-header">
      <button className="thumb-edit" onClick={() => fileInput.current?.click()} title="サムネイルを変更">
        <Thumb name={project.name} url={project.thumbnailUrl} className="thumb-lg" />
        <span className="thumb-edit-label">変更</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void changeThumb(f);
          e.target.value = "";
        }}
      />
      <div className="project-header-main">
        <div className="crumb">
          {client ? <Link to={`/c/${client.id}`}>{client.name}</Link> : <span>取引先なし</span>}
          <select
            className="crumb-move"
            value={project.clientId ?? ""}
            title="取引先を変更"
            aria-label="取引先を変更"
            onChange={async (e) => {
              const p = await api.updateProject(project.id, { clientId: e.target.value || null });
              onChange({ clientId: p.clientId });
              await reload();
            }}
          >
            <option value="">取引先なし</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <input
          className="title-input"
          value={name}
          maxLength={200}
          aria-label="曲名"
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) {
              autosave.change(e.target.value.trim());
              onChange({ name: e.target.value.trim() });
            }
          }}
        />
        <div className="muted small">
          作成 {formatDate(project.createdAt)} <span className="save-state">{saveLabel(autosave.state)}</span>
        </div>
      </div>
      <div className="project-header-actions">
        {project.thumbnailUrl && (
          <button
            className="btn ghost small"
            onClick={async () => {
              const p = await api.removeThumbnail(project.id);
              onChange({ thumbnailUrl: p.thumbnailUrl });
            }}
          >
            サムネ削除
          </button>
        )}
        <button className="btn danger small" onClick={onDelete}>
          曲を削除
        </button>
      </div>
      </div>
      <div className="song-hero-mark" aria-hidden>
        {[...project.name.trim()][0] ?? ""}
      </div>
      <div className="song-hero-wave" aria-hidden>
        {WAVE.map((w, i) => (
          <i key={i} style={{ animationDelay: `${w.delay}s`, animationDuration: `${w.duration}s` }} />
        ))}
      </div>
      <div className="song-hero-status" aria-hidden>
        <span className="eq">
          <i />
          <i />
          <i />
          <i />
        </span>
        {project.submittedAt ? "COMPLETE" : `STAGE 0${project.stage} · ${stageMeta(project.stage).en}`}
      </div>
    </div>
  );
}
