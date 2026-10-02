import { Link } from "react-router-dom";
import type { Client, Project } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Thumb } from "./Thumb";

export function SongCard({ song, client }: { song: Project; client?: Client | null }) {
  return (
    <Link to={`/p/${song.id}`} className="project-card">
      <Thumb name={song.name} url={song.thumbnailUrl} />
      <div className="project-card-body">
        <div className="project-card-name">{song.name}</div>
        <div className="project-card-date" title={new Date(song.updatedAt).toLocaleString("ja-JP")}>
          {client !== undefined && <span className="chip">{client?.name ?? "取引先なし"}</span>}
          {formatRelative(song.updatedAt)}
        </div>
      </div>
    </Link>
  );
}
