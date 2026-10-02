import { useState, type FormEvent } from "react";
import { api, type SpotifyItem, type SpotifyKind, type SpotifyRef } from "../lib/api";
import { useSpotify } from "../lib/SpotifyContext";

const KIND_LABEL: Record<SpotifyKind, string> = {
  track: "曲",
  album: "アルバム",
  playlist: "プレイリスト",
  episode: "エピソード",
  show: "番組",
  artist: "アーティスト",
};

const embedHeight = (kind: SpotifyKind) => (kind === "track" || kind === "episode" ? 152 : 352);

/** リファレンス: Spotify embeds (always) + search / playlists / in-app playback (when connected). */
export function SpotifySection({
  projectId,
  refs,
  onRefsChange,
}: {
  projectId: string;
  refs: SpotifyRef[];
  onRefsChange: (refs: SpotifyRef[]) => void;
}) {
  const spotify = useSpotify();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState(false);

  async function add(value: string, meta?: { title?: string; subtitle?: string }) {
    setBusy(true);
    setError(null);
    try {
      const ref = await api.addRef(projectId, value, meta);
      onRefsChange([...refs, ref]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (input.trim() && (await add(input.trim()))) setInput("");
  }

  async function move(index: number, delta: number) {
    const next = [...refs];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onRefsChange(next);
    await api.reorderRefs(projectId, next.map((r) => r.id));
  }

  async function remove(ref: SpotifyRef) {
    if (!window.confirm(`「${ref.title || ref.uri}」をリファレンスから外しますか?`)) return;
    await api.deleteRef(projectId, ref.id);
    onRefsChange(refs.filter((r) => r.id !== ref.id));
  }

  const connected = Boolean(spotify.status?.connected);

  return (
    <>
      <div className="section-head">
        <h2>リファレンス</h2>
        <span className="muted small">Spotify</span>
        {connected && (
          <button className="btn small" onClick={() => setBrowser((v) => !v)}>
            {browser ? "検索を閉じる" : "Spotify から探す"}
          </button>
        )}
      </div>

      <form className="inline-form" onSubmit={submit}>
        <input
          placeholder="Spotify の曲 / アルバム / プレイリストの URL か URI を貼り付け"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !input.trim()}>
          追加
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {!spotify.status?.configured && (
        <p className="hint">
          埋め込みプレイヤーで再生できます。検索・プレイリスト取得・アプリ内プレイヤーを使うには、サーバーに
          <code>SPOTIFY_CLIENT_ID</code> / <code>SPOTIFY_CLIENT_SECRET</code> を設定してください(README 参照)。
        </p>
      )}
      {spotify.status?.configured && !connected && (
        <p className="hint">右上の「Spotify に接続」で検索・プレイリスト・アプリ内再生(Premium)が使えるようになります。</p>
      )}

      {browser && connected && <SpotifyBrowser existing={refs} onAdd={(item) => add(item.uri, item)} />}

      {refs.length === 0 ? (
        <p className="muted empty-inline">リファレンスはまだありません。</p>
      ) : (
        <ul className="ref-list">
          {refs.map((ref, i) => (
            <li key={ref.id} className="ref-item">
              <iframe
                title={ref.title || ref.uri}
                src={`https://open.spotify.com/embed/${ref.kind}/${ref.spotifyId}?utm_source=generator`}
                height={embedHeight(ref.kind)}
                loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              />
              <div className="ref-side">
                <div className="ref-title">
                  <span className="tag">{KIND_LABEL[ref.kind]}</span> {ref.title || ref.uri}
                </div>
                {ref.subtitle && <div className="muted small">{ref.subtitle}</div>}
                <RefNote projectId={projectId} refItem={ref} />
                <div className="ref-actions">
                  {connected && (
                    <button
                      className={`btn small ${spotify.nowPlaying?.uri === ref.uri ? "primary" : ""}`}
                      onClick={() => void spotify.play(ref.uri)}
                      title={spotify.deviceId ? "アプリ内プレイヤーでフル再生" : "Spotify Connect の再生中デバイスで再生"}
                    >
                      ▶ フル再生
                    </button>
                  )}
                  <a
                    className="btn small ghost"
                    href={`https://open.spotify.com/${ref.kind}/${ref.spotifyId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Spotify で開く
                  </a>
                  <span className="spacer" />
                  <button className="icon-btn" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="上へ">
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    disabled={i === refs.length - 1}
                    onClick={() => void move(i, 1)}
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                  <button className="icon-btn danger" onClick={() => void remove(ref)} aria-label="削除">
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RefNote({ projectId, refItem }: { projectId: string; refItem: SpotifyRef }) {
  const [note, setNote] = useState(refItem.note);
  return (
    <input
      className="ref-note"
      placeholder="メモ(どこを参考にするか など)"
      value={note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => note !== refItem.note && void api.updateRef(projectId, refItem.id, { note })}
    />
  );
}

type Tab = "track" | "album" | "playlist" | "mine";

function SpotifyBrowser({ existing, onAdd }: { existing: SpotifyRef[]; onAdd: (item: SpotifyItem) => Promise<boolean> }) {
  const spotify = useSpotify();
  const [tab, setTab] = useState<Tab>("track");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SpotifyItem[] | null>(null);
  const [openPlaylist, setOpenPlaylist] = useState<SpotifyItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const added = new Set(existing.map((r) => r.uri));

  async function load(fn: () => Promise<{ items: SpotifyItem[] }>) {
    setLoading(true);
    setError(null);
    try {
      setItems((await fn()).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
      setItems(null);
    } finally {
      setLoading(false);
    }
  }

  function switchTab(next: Tab) {
    setTab(next);
    setOpenPlaylist(null);
    setItems(null);
    if (next === "mine") void load(api.spotifyPlaylists);
    else if (q.trim()) void load(() => api.spotifySearch(q.trim(), next));
  }

  return (
    <div className="spotify-browser">
      <div className="segmented">
        {(["track", "album", "playlist", "mine"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => switchTab(t)}>
            {{ track: "曲", album: "アルバム", playlist: "プレイリスト", mine: "マイプレイリスト" }[t]}
          </button>
        ))}
      </div>
      {tab !== "mine" && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) void load(() => api.spotifySearch(q.trim(), tab));
          }}
        >
          <input autoFocus placeholder="曲名・アーティスト名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" disabled={!q.trim()}>
            検索
          </button>
        </form>
      )}
      {openPlaylist && (
        <button
          className="btn ghost small"
          onClick={() => {
            setOpenPlaylist(null);
            void load(api.spotifyPlaylists);
          }}
        >
          ← {openPlaylist.title}
        </button>
      )}
      {loading && <p className="muted small">読み込み中…</p>}
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && <p className="muted small">見つかりませんでした</p>}
      {items && items.length > 0 && (
        <ul className="search-results">
          {items.map((it) => (
            <li key={it.uri}>
              {it.image ? <img src={it.image} alt="" /> : <div className="img-ph" />}
              <div className="sr-meta">
                <div className="sr-title">{it.title}</div>
                <div className="muted small">{it.subtitle}</div>
              </div>
              <button className="icon-btn" title="アプリ内で試聴" onClick={() => void spotify.play(it.uri)}>
                ▶
              </button>
              {tab === "mine" && !openPlaylist && it.kind === "playlist" && (
                <button
                  className="btn small ghost"
                  onClick={() => {
                    setOpenPlaylist(it);
                    void load(() => api.spotifyPlaylistItems(it.id));
                  }}
                >
                  中身
                </button>
              )}
              <button
                className="btn small"
                disabled={added.has(it.uri)}
                onClick={() => void onAdd(it)}
              >
                {added.has(it.uri) ? "追加済み" : "追加"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
