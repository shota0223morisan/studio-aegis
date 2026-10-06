import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useLibrary } from "../lib/library";
import { saveLabel, useAutosave } from "../lib/useAutosave";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { SongCard } from "../components/SongCard";
import { NewSongForm } from "../components/NewSongForm";

export function ClientPage() {
  const { id = "" } = useParams();
  const { clients, songs, loaded, reload } = useLibrary();
  const client = clients.find((c) => c.id === id);
  if (!loaded) return <p className="muted">読み込み中…</p>;
  if (!client) return <p className="error">取引先が見つかりません</p>;
  return <ClientView key={client.id} clientId={client.id} name={client.name} note={client.note} songs={songs.filter((s) => s.clientId === id)} reload={reload} />;
}

function ClientView({
  clientId,
  name: initialName,
  note,
  songs,
  reload,
}: {
  clientId: string;
  name: string;
  note: string;
  songs: ReturnType<typeof useLibrary>["songs"];
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(initialName);
  const [creating, setCreating] = useState(false);
  const autosave = useAutosave(async (value: string) => {
    await api.updateClient(clientId, { name: value });
    await reload();
  }, 600);

  useEffect(() => {
    document.title = `${initialName} — Session Partner`;
  }, [initialName]);

  return (
    <div className="page">
      <div className="project-header">
        <div className="project-header-main">
          <div className="crumb">取引先</div>
          <input
            className="title-input"
            value={name}
            maxLength={200}
            aria-label="取引先名"
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) autosave.change(e.target.value.trim());
            }}
          />
          <span className="save-state">{saveLabel(autosave.state)}</span>
        </div>
        <div className="project-header-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            ＋ 曲を追加
          </button>
          <button
            className="btn danger small"
            onClick={async () => {
              if (!window.confirm(`取引先「${initialName}」を削除しますか?\n曲は消えずに「取引先なし」に移ります。`)) return;
              await api.deleteClient(clientId);
              await reload();
              navigate("/clients");
            }}
          >
            取引先を削除
          </button>
        </div>
      </div>

      {creating && <NewSongForm clientId={clientId} onDone={() => setCreating(false)} />}

      <div className="sections">
        <section className="card span-2">
          <MarkdownMemo
            title="取引先メモ"
            subtitle="担当者・連絡先・好み・NG・納品形式など"
            initial={note}
            save={(value) => api.updateClient(clientId, { note: value })}
            placeholder={"- 担当: \n- 連絡: \n- 好きな音: \n- NG: \n- 納品形式: WAV 48kHz/24bit"}
          />
        </section>
      </div>

      <h2 className="section-title">曲({songs.length})</h2>
      {songs.length === 0 ? (
        <p className="muted">まだ曲がありません。「＋ 曲を追加」から始めましょう。</p>
      ) : (
        <ul className="project-grid">
          {songs.map((s) => (
            <li key={s.id}>
              <SongCard song={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
