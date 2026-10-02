import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ProjectDetail, type Session } from "../lib/api";
import { formatDate } from "../lib/format";
import { saveLabel, useAutosave } from "../lib/useAutosave";
import { Thumb } from "../components/Thumb";
import { SpotifySection } from "../components/SpotifySection";
import { SpliceSection } from "../components/SpliceSection";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { IdeaMemo } from "../components/IdeaMemo";
import { FilesSection } from "../components/FilesSection";

export function ProjectPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
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

  return (
    <div className="project-page">
      <ProjectHeader
        project={project}
        onChange={patch}
        onDelete={async () => {
          if (!window.confirm(`「${project.name}」を削除しますか?\nメモ・アップロードしたファイルもすべて削除されます。`)) return;
          await api.deleteProject(project.id);
          navigate("/");
        }}
      />

      <div className="sections">
        <section className="card span-2">
          <SpotifySection
            projectId={project.id}
            refs={project.refs}
            onRefsChange={(refs) => patch({ refs })}
          />
        </section>

        <section className="card">
          <SpliceSection project={project} onChange={patch} />
        </section>

        <section className="card">
          <IdeaMemo projectId={project.id} initial={project.ideaMemo} />
        </section>

        <section className="card span-2">
          <MarkdownMemo projectId={project.id} initial={project.structureMemo} />
        </section>

        <section className="card span-2">
          <FilesSection
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

function ProjectHeader({
  project,
  onChange,
  onDelete,
}: {
  project: ProjectDetail;
  onChange: (p: Partial<ProjectDetail>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(project.name);
  const fileInput = useRef<HTMLInputElement>(null);
  const autosave = useAutosave((value: string) => api.updateProject(project.id, { name: value }), 600);

  async function changeThumb(file: File) {
    try {
      const p = await api.setThumbnail(project.id, file);
      onChange({ thumbnailUrl: p.thumbnailUrl, updatedAt: p.updatedAt });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "画像のアップロードに失敗しました");
    }
  }

  return (
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
        <input
          className="title-input"
          value={name}
          maxLength={200}
          aria-label="案件名"
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
          案件を削除
        </button>
      </div>
    </div>
  );
}
