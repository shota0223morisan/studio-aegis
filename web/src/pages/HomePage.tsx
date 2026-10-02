import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "../lib/library";
import { SongCard } from "../components/SongCard";
import { NewSongForm } from "../components/NewSongForm";

export function HomePage() {
  const { clients, songs, loaded } = useLibrary();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    document.title = "Studio Aegis";
  }, []);

  const clientOf = (id: string | null) => clients.find((c) => c.id === id) ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <h1>ワーク</h1>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            ＋ 新しい曲
          </button>
        </div>
      </div>
      {creating && <NewSongForm onDone={() => setCreating(false)} />}

      {!loaded ? (
        <p className="muted">読み込み中…</p>
      ) : songs.length === 0 ? (
        <div className="empty card">
          <h2>はじめかた</h2>
          <ol className="steps start">
            <li>左の「＋ 取引先」で取引先(クライアント)を作る</li>
            <li>取引先の「＋」で曲を追加する(1 曲ごとに作業場ができる)</li>
            <li>曲の画面に「先方からの指示」「こちらのメモ」「アイデア」を書き、リファレンスや音源を置く</li>
            <li>左のパネルで Spotify と Splice をタブで切り替えながら作業</li>
          </ol>
          {clients.length > 0 && (
            <p className="hint">
              取引先は <Link to="/clients">取引先</Link> 画面からも管理できます。
            </p>
          )}
        </div>
      ) : (
        <>
          <h2 className="section-title">最近さわった曲</h2>
          <ul className="project-grid">
            {songs.slice(0, 24).map((s) => (
              <li key={s.id}>
                <SongCard song={s} client={clientOf(s.clientId)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
