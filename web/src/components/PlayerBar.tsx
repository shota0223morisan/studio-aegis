import { useEffect, useState } from "react";
import { useSpotify } from "../lib/SpotifyContext";
import { formatMs } from "../lib/format";

/** Fixed bottom bar for the in-app Spotify (Web Playback SDK) player. */
export function PlayerBar() {
  const { nowPlaying, togglePlay, next, previous, seek, playerError } = useSpotify();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!nowPlaying || nowPlaying.paused) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [nowPlaying]);

  if (!nowPlaying) {
    return playerError ? <div className="player-bar error-bar">{playerError}</div> : null;
  }

  const position = Math.min(
    nowPlaying.duration,
    nowPlaying.position + (nowPlaying.paused ? 0 : Date.now() - nowPlaying.updatedAt),
  );

  return (
    <div className="player-bar">
      {nowPlaying.image && <img src={nowPlaying.image} alt="" className="player-art" />}
      <div className="player-meta">
        <div className="player-title">{nowPlaying.title}</div>
        <div className="player-sub">{nowPlaying.artists}</div>
      </div>
      <div className="player-controls">
        <button className="icon-btn" onClick={previous} aria-label="前へ">
          ⏮
        </button>
        <button className="icon-btn play" onClick={togglePlay} aria-label={nowPlaying.paused ? "再生" : "一時停止"}>
          {nowPlaying.paused ? "▶" : "❚❚"}
        </button>
        <button className="icon-btn" onClick={next} aria-label="次へ">
          ⏭
        </button>
      </div>
      <div className="player-seek">
        <span>{formatMs(position)}</span>
        <input
          type="range"
          min={0}
          max={nowPlaying.duration}
          value={position}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="再生位置"
        />
        <span>{formatMs(nowPlaying.duration)}</span>
      </div>
      {playerError && <div className="player-error">{playerError}</div>}
    </div>
  );
}
