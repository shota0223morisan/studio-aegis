import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Project } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Thumb } from "../components/Thumb";

type Sort = "updated" | "deadline" | "pinned";

// Only "updated" is enabled for now; the others are wired server-side for later.
const SORT_OPTIONS: { value: Sort; label: string; enabled: boolean }[] = [
  { value: "updated", label: "最終更新順", enabled: true },
  { value: "deadline", label: "締切順(準備中)", enabled: false },
  { value: "pinned", label: "お気に入り固定(準備中)", enabled: false },
];

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [sort, setSort] = useState<Sort>("updated");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Studio Aegis";
    api
      .listProjects(sort)
      .then((r) => setProjects(r.items))
      .catch((e: Error) => setError(e.message));
  }, [sort]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim());
      navigate(`/p/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    }
  }

  return (
    <div className="projects-page">
      <div className="page-head">
        <h1>案件</h1>
        <div className="page-actions">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="並び順">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={!o.enabled}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={() => setCreating(true)}>
            + 新規案件
          </button>
        </div>
      </div>

      {creating && (
        <form className="new-project" onSubmit={create}>
          <input
            autoFocus
            placeholder="案件名(例: ○○様 新曲 / 2026 春 CM)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            maxLength={200}
          />
          <button className="btn primary" disabled={!name.trim()}>
            作成
          </button>
          <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
            キャンセル
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {projects === null ? (
        <p className="muted">読み込み中…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <p>まだ案件がありません。</p>
          <p className="muted">「+ 新規案件」から最初の案件を作成しましょう。</p>
        </div>
      ) : (
        <ul className="project-grid">
          {projects.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className="project-card">
                <Thumb name={p.name} url={p.thumbnailUrl} />
                <div className="project-card-body">
                  <div className="project-card-name">{p.name}</div>
                  <div className="project-card-date" title={new Date(p.updatedAt).toLocaleString("ja-JP")}>
                    最終更新 {formatRelative(p.updatedAt)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
