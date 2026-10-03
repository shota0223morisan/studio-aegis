import { useMemo, useState, type FormEvent } from "react";
import { NavLink, useMatch, useNavigate } from "react-router-dom";
import { api, type Project } from "../lib/api";
import { useLibrary } from "../lib/library";

/** Left column of the app: clients (取引先) with their songs underneath. */
export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { clients, songs, reload } = useLibrary();
  const navigate = useNavigate();
  const songMatch = useMatch("/p/:id");
  const clientMatch = useMatch("/c/:id");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("aegis.collapsed") || "{}");
    } catch {
      return {};
    }
  });
  const [adding, setAdding] = useState<string | null>(null); // "client" | clientId | "none"
  const [name, setName] = useState("");

  const activeSong = songs.find((s) => s.id === songMatch?.params.id);
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const by = new Map<string | null, Project[]>();
    for (const s of songs) {
      if (q && !s.name.toLowerCase().includes(q)) continue;
      const list = by.get(s.clientId) ?? [];
      list.push(s);
      by.set(s.clientId, list);
    }
    return by;
  }, [songs, q]);

  function toggle(id: string) {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try {
      localStorage.setItem("aegis.collapsed", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value || !adding) return;
    if (adding === "client") {
      const c = await api.createClient(value);
      await reload();
      navigate(`/c/${c.id}`);
    } else {
      const p = await api.createProject(value, adding === "none" ? null : adding);
      await reload();
      navigate(`/p/${p.id}`);
    }
    setAdding(null);
    setName("");
  }

  const addForm = (placeholder: string) => (
    <form className="side-add" onSubmit={submit}>
      <input
        autoFocus
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
        onBlur={() => !name.trim() && setAdding(null)}
        maxLength={200}
      />
    </form>
  );

  if (!open) {
    return (
      <aside className="sidebar closed">
        <button className="icon-btn" onClick={onToggle} title="サイドバーを開く" aria-label="サイドバーを開く">
          »
        </button>
      </aside>
    );
  }

  const unassigned = groups.get(null) ?? [];

  return (
    <aside className="sidebar">
      <div className="side-head">
        <input className="side-search" placeholder="曲を検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="icon-btn" onClick={onToggle} title="サイドバーを閉じる" aria-label="サイドバーを閉じる">
          «
        </button>
      </div>

      <div className="side-scroll">
        {clients.map((c) => {
          const list = groups.get(c.id) ?? [];
          if (q && list.length === 0) return null;
          const isOpen = !collapsed[c.id] || Boolean(q) || activeSong?.clientId === c.id;
          return (
            <div key={c.id} className="side-group">
              <div className={`side-client ${clientMatch?.params.id === c.id ? "on" : ""}`}>
                <button className="side-caret" onClick={() => toggle(c.id)} aria-label={isOpen ? "たたむ" : "開く"}>
                  {isOpen ? "▾" : "▸"}
                </button>
                <NavLink to={`/c/${c.id}`} className="side-client-name">
                  {c.name}
                </NavLink>
                <span className="side-count">{c.songCount}</span>
                <button className="side-plus" title="この取引先に曲を追加" onClick={() => (setAdding(c.id), setName(""))}>
                  ＋
                </button>
              </div>
              {isOpen && (
                <ul className="side-songs">
                  {list.map((s) => (
                    <li key={s.id}>
                      <NavLink to={`/p/${s.id}`} className={({ isActive }) => `side-song ${isActive ? "on" : ""}`}>
                        <span className="side-song-name">{s.name}</span>
                        <StageBadge stage={s.stage} done={Boolean(s.submittedAt)} />
                      </NavLink>
                    </li>
                  ))}
                  {adding === c.id && <li>{addForm("曲名を入力して Enter")}</li>}
                  {list.length === 0 && adding !== c.id && <li className="side-empty">曲はまだありません</li>}
                </ul>
              )}
            </div>
          );
        })}

        {(unassigned.length > 0 || adding === "none") && (
          <div className="side-group">
            <div className="side-client muted-group">
              <span className="side-caret" />
              <span className="side-client-name">取引先なし</span>
              <span className="side-count">{unassigned.length}</span>
            </div>
            <ul className="side-songs">
              {unassigned.map((s) => (
                <li key={s.id}>
                  <NavLink to={`/p/${s.id}`} className={({ isActive }) => `side-song ${isActive ? "on" : ""}`}>
                    <span className="side-song-name">{s.name}</span>
                    <StageBadge stage={s.stage} done={Boolean(s.submittedAt)} />
                  </NavLink>
                </li>
              ))}
              {adding === "none" && <li>{addForm("曲名を入力して Enter")}</li>}
            </ul>
          </div>
        )}

        {clients.length === 0 && songs.length === 0 && (
          <p className="side-empty pad">まずは取引先を追加しましょう。</p>
        )}
      </div>

      <div className="side-foot">
        {adding === "client" ? (
          addForm("取引先名を入力して Enter")
        ) : (
          <button className="btn small block" onClick={() => (setAdding("client"), setName(""))}>
            ＋ 取引先
          </button>
        )}
      </div>
    </aside>
  );
}

/** Stage number in the stage's colour (✓ when submitted). */
function StageBadge({ stage, done }: { stage: number; done: boolean }) {
  return (
    <span className={`stage-badge s${done ? "done" : stage}`} title={done ? "提出済み" : `STAGE 0${stage}`}>
      {done ? "✓" : `0${stage}`}
    </span>
  );
}
