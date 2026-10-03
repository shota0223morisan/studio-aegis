import { desktop } from "./desktop";
import { toast } from "./toast";
import { ytMusicSearch } from "./flow";

/** Play a song in the YT Music tab (from the noted position), with a short status toast. */
export async function playSong(title: string, artist = "", position = "") {
  const label = [title, artist].filter(Boolean).join(" — ");
  if (!desktop) {
    window.open(ytMusicSearch(`${title} ${artist}`), "_blank", "noreferrer");
    return;
  }
  toast(`YT Music で「${title}」を探しています…`, { ms: 0 });
  const r = await desktop.playSong({ title, artist, position });
  if (r.ok) toast(`▶ ${label}${r.position ? `(${position} から)` : ""}`);
  else toast(r.message ?? "再生できませんでした", { error: true, ms: 6000 });
}
