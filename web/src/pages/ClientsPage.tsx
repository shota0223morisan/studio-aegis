import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useLibrary } from "../lib/library";

export function ClientsPage() {
  const { clients, reload } = useLibrary();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  useEffect(() => {
    document.title = "取引先 — Session Partner";
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const c = await api.createClient(name.trim());
    await reload();
    setName("");
    navigate(`/c/${c.id}`);
  }

  async function move(index: number, delta: number) {
    const ids = clients.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    await api.reorderClients(ids);
    await reload();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>取引先</h1>
      </div>
      <form className="new-project" onSubmit={submit}>
        <input placeholder="新しい取引先名(例: ○○レコード / △△広告)" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        <button className="btn primary" disabled={!name.trim()}>
          ＋ 追加
        </button>
      </form>
      {clients.length === 0 ? (
        <p className="muted">取引先はまだありません。</p>
      ) : (
        <ul className="client-list">
          {clients.map((c, i) => (
            <li key={c.id} className="card client-row">
              <Link to={`/c/${c.id}`} className="client-row-main">
                <span className="client-row-name">{c.name}</span>
                <span className="muted small">{c.songCount} 曲</span>
                {c.note && <span className="client-row-note">{c.note.split("\n")[0]}</span>}
              </Link>
              <div className="client-row-actions">
                <button className="icon-btn" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="上へ">
                  ↑
                </button>
                <button className="icon-btn" disabled={i === clients.length - 1} onClick={() => void move(i, 1)} aria-label="下へ">
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
