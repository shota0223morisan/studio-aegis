import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type NotionIdea, type NotionIdeas, type NotionOption } from "../lib/api";
import { desktop } from "../lib/desktop";
import { formatRelative } from "../lib/format";
import { playSong } from "../lib/play";

const PAGE = 12;
// Properties shown as chips (in this order) and as meta text.
const CHIP_PROPS = ["要素", "箇所", "ジャンル"];
const FILTER_PROPS = ["要素", "ジャンル", "状態"];

const options = (idea: NotionIdea, prop: string): NotionOption[] => idea.props[prop]?.options ?? [];
const text = (idea: NotionIdea, prop: string) => idea.props[prop]?.text ?? "";

function openIdea(url: string) {
  if (desktop) void desktop.openInPane("web", url);
  else window.open(url, "_blank", "noreferrer");
}

/** アイデア: the 「🎛 制作アイディア」 Notion database, read-only, with quick filters. */
export function IdeasPanel({ index }: { index?: string }) {
  const [data, setData] = useState<NotionIdeas | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(PAGE);

  async function load(refresh = false) {
    setLoading(true);
    try {
      setData(await api.notionIdeas(refresh));
    } finally {
      setLoading(false);
    }
  }

  async function play(idea: NotionIdea) {
    await playSong(text(idea, "曲"), text(idea, "アーティスト"), text(idea, "位置(mm:ss)"));
  }

  useEffect(() => {
    void load();
  }, []);

  const choices = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const prop of FILTER_PROPS) {
      const set = new Set<string>();
      for (const idea of data?.items ?? []) for (const o of options(idea, prop)) set.add(o.name);
      out[prop] = [...set];
    }
    return out;
  }, [data]);

  const q = query.trim().toLowerCase();
  const items = (data?.items ?? []).filter((idea) => {
    for (const [prop, value] of Object.entries(filters)) {
      if (value && !options(idea, prop).some((o) => o.name === value)) return false;
    }
    if (!q) return true;
    const hay = [idea.title, ...Object.values(idea.props).map((p) => p.text ?? (p.options ?? []).map((o) => o.name).join(" "))]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  return (
    <>
      <div className="section-head">
        {index && <span className="sec-index">{index}</span>}
        <span className="sec-icon" aria-hidden>✦</span>
        <h2>アイデア</h2>
        <span className="muted small">Notion「🎛 制作アイディア」</span>
        <span className="sec-line" aria-hidden />
        {data?.configured && (
          <>
            <button className="btn small ghost" onClick={() => openIdea(data.dbUrl)} title="Notion で開く">
              Notion ↗
            </button>
            <button className="btn small" onClick={() => void load(true)} disabled={loading}>
              {loading ? "更新中…" : "⟳ 更新"}
            </button>
          </>
        )}
      </div>

      {!data ? (
        <p className="muted small">読み込み中…</p>
      ) : !data.configured ? (
        <div className="ideas-setup">
          <p>Notion の「🎛 制作アイディア」をここに表示できます。</p>
          <p className="muted small">
            <Link to="/settings">設定</Link> で Notion のトークンを入れてください(Lyric Machine と同じトークンが使えます)。
          </p>
        </div>
      ) : (
        <>
          <div className="ideas-filters">
            <input placeholder="アイデアを検索" value={query} onChange={(e) => setQuery(e.target.value)} />
            {FILTER_PROPS.map(
              (prop) =>
                choices[prop]?.length > 0 && (
                  <select
                    key={prop}
                    value={filters[prop] ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, [prop]: e.target.value }))}
                    aria-label={prop}
                  >
                    <option value="">{prop}: すべて</option>
                    {choices[prop].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ),
            )}
            <span className="muted small">
              {items.length} 件{data.fetchedAt ? ` · ${formatRelative(new Date(data.fetchedAt).toISOString())}に取得` : ""}
            </span>
          </div>
          {data.error && <p className="error">{data.error}</p>}
          {items.length === 0 ? (
            <p className="muted small">該当するアイデアはありません。</p>
          ) : (
            <ul className="ideas-grid">
              {items.slice(0, shown).map((idea) => (
                <IdeaCard key={idea.id} idea={idea} onPlay={() => void play(idea)} />
              ))}
            </ul>
          )}
          {items.length > shown && (
            <button className="btn small block" onClick={() => setShown((n) => n + PAGE)}>
              さらに表示({items.length - shown} 件)
            </button>
          )}
        </>
      )}
    </>
  );
}

function IdeaCard({ idea, onPlay }: { idea: NotionIdea; onPlay: () => void }) {
  const artist = text(idea, "アーティスト");
  const song = text(idea, "曲");
  const pos = text(idea, "位置(mm:ss)");
  const use = text(idea, "使いどころ(Claude案)");
  const status = options(idea, "状態")[0];
  const playable = Boolean(song);
  return (
    <li className="idea-item">
      <button
        className={`idea-card ${playable ? "playable" : ""}`}
        onClick={() => (playable ? onPlay() : openIdea(idea.url))}
        title={playable ? `YT Music で「${song}」を${pos ? ` ${pos} から` : ""}再生` : "Notion で開く"}
      >
        <span className="idea-top">
          <span className="idea-title">{idea.title || "(無題)"}</span>
          {status && <span className={`ntag n-${status.color} idea-status`}>{status.name}</span>}
        </span>
        <span className="idea-chips">
          {CHIP_PROPS.flatMap((p) => options(idea, p)).map((o, i) => (
            <span key={`${o.name}-${i}`} className={`ntag n-${o.color}`}>
              {o.name}
            </span>
          ))}
        </span>
        {(artist || song) && (
          <span className="idea-ref">
            {playable ? <span className="idea-play">▶</span> : "♪"} {artist}
            {song && ` 「${song}」`}
            {pos && <span className="idea-pos"> {pos}</span>}
          </span>
        )}
        {use && <span className="idea-use">{use}</span>}
      </button>
      <button className="icon-btn idea-notion" onClick={() => openIdea(idea.url)} title="Notion で開く">
        ↗
      </button>
    </li>
  );
}
