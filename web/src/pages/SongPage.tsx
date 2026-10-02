import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type ProjectDetail, type Session } from "../lib/api";
import { formatDate } from "../lib/format";
import { useLibrary } from "../lib/library";
import { saveLabel, useAutosave } from "../lib/useAutosave";
import { Thumb } from "../components/Thumb";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { IdeasPanel } from "../components/IdeasPanel";
import { FilesSection } from "../components/FilesSection";

/** One song's workspace: the client's brief (with attached audio), our notes, Notion ideas, files. */
export function SongPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { reload } = useLibrary();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProject(null);
    setError(null);
    api
      .getProject(id)
      .then(setProject)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (project) document.title = `${project.name} — Studio Aegis`;
  }, [project?.name]);

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">読み込み中…</p>;

  const patch = (p: Partial<ProjectDetail>) => setProject((cur) => (cur ? { ...cur, ...p } : cur));
  const save = (field: "brief" | "structureMemo") => (value: string) => api.updateProject(project.id, { [field]: value });

  return (
    <div className="page song-page">
      <SongHeader
        project={project}
        onChange={patch}
        onDelete={async () => {
          if (!window.confirm(`「${project.name}」を削除しますか?\nメモ・追加したファイルもすべて削除されます。`)) return;
          await api.deleteProject(project.id);
          await reload();
          navigate(project.clientId ? `/c/${project.clientId}` : "/");
        }}
      />

      <div className="sections">
        <section className="card brief-card span-2">
          <MarkdownMemo
            key={`brief-${project.id}`}
            index="01"
            icon="✉"
            title="先方からの指示"
            initial={project.brief}
            save={save("brief")}
            placeholder={"先方から届いた依頼・修正指示を貼り付け(Spotify や YouTube のリンクは左パネルで開けます)\n\n- 尺: \n- 納期: \n- イメージ: \n- 修正: "}
          >
            <FilesSection
              bare
              only={["client_ref"]}
              projectId={project.id}
              files={project.files}
              maxUploadBytes={session.maxUploadBytes}
              onFilesChange={(files) => patch({ files })}
            />
          </MarkdownMemo>
        </section>
        <section className="card span-2">
          <MarkdownMemo
            key={`memo-${project.id}`}
            index="02"
            icon="✎"
            title="こちらのメモ"
            initial={project.structureMemo}
            save={save("structureMemo")}
            placeholder={"## 構成\nIntro (8) → A (16) → B (8) → サビ (16)\n\n## 進行\n| セクション | コード |\n|---|---|\n| A | IVmaj7 - V - iii - vi |\n\n- BPM: \n- Key: "}
          />
        </section>
        <section className="card span-2">
          <IdeasPanel index="03" />
        </section>
        <section className="card span-2">
          <FilesSection
            index="04"
            title="ファイル"
            only={["deliverable", "other"]}
            projectId={project.id}
            files={project.files}
            maxUploadBytes={session.maxUploadBytes}
            onFilesChange={(files) => patch({ files })}
          />
        </section>
      </div>
    </div>
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
        NOW WORKING
      </div>
    </div>
  );
}
