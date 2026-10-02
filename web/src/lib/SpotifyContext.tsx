import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type SpotifyStatus } from "./api";
import { desktop } from "./desktop";

/**
 * App-wide Spotify state: OAuth connection + an in-browser Web Playback SDK device.
 * Lives above the router so playback keeps going while moving between projects.
 */

interface NowPlaying {
  uri: string;
  title: string;
  artists: string;
  image: string | null;
  paused: boolean;
  position: number;
  duration: number;
  updatedAt: number;
}

interface SpotifyCtx {
  status: SpotifyStatus | null;
  refreshStatus: () => Promise<void>;
  /** Web Playback SDK device id once the in-app player is ready. */
  deviceId: string | null;
  playerError: string | null;
  nowPlaying: NowPlaying | null;
  play: (uri: string) => Promise<void>;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (ms: number) => void;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<SpotifyCtx | null>(null);

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdkPromise ??= new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    s.onerror = () => reject(new Error("Spotify SDK の読み込みに失敗しました"));
    document.body.appendChild(s);
  });
  return sdkPromise;
}

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const player = useRef<Spotify.Player | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.spotifyStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Boot the in-app player once connected. The desktop app's Chromium has no Widevine DRM,
  // which the Web Playback SDK needs, so there playback goes to the Spotify app instead.
  useEffect(() => {
    if (!status?.connected || desktop) return;
    let cancelled = false;
    loadSdk()
      .then(() => {
        if (cancelled || !window.Spotify) return;
        const p = new window.Spotify.Player({
          name: "Studio Aegis",
          volume: 0.8,
          getOAuthToken: (cb) => {
            api
              .spotifyToken()
              .then((t) => cb(t.accessToken))
              .catch(() => setPlayerError("Spotify のトークン取得に失敗しました。再接続してください。"));
          },
        });
        p.addListener("ready", ({ device_id }) => {
          setDeviceId(device_id);
          setPlayerError(null);
        });
        p.addListener("not_ready", () => setDeviceId(null));
        p.addListener("initialization_error", () =>
          setPlayerError("このブラウザはアプリ内再生に未対応です(埋め込みプレイヤーは使えます)"),
        );
        p.addListener("authentication_error", () => setPlayerError("Spotify 認証エラー。再接続してください。"));
        p.addListener("account_error", () => setPlayerError("アプリ内再生には Spotify Premium が必要です"));
        p.addListener("playback_error", (e) => setPlayerError(`再生エラー: ${e.message}`));
        p.addListener("player_state_changed", (state) => {
          const t = state?.track_window.current_track;
          if (!state || !t) return setNowPlaying(null);
          setNowPlaying({
            uri: t.uri,
            title: t.name,
            artists: t.artists.map((a) => a.name).join(", "),
            image: t.album.images[0]?.url ?? null,
            paused: state.paused,
            position: state.position,
            duration: state.duration,
            updatedAt: Date.now(),
          });
        });
        void p.connect();
        player.current = p;
      })
      .catch((e: Error) => setPlayerError(e.message));
    return () => {
      cancelled = true;
      player.current?.disconnect();
      player.current = null;
      setDeviceId(null);
      setNowPlaying(null);
    };
  }, [status?.connected]);

  const play = useCallback(
    async (uri: string) => {
      setPlayerError(null);
      // Must run inside the click handler on mobile/Safari to unlock audio.
      await player.current?.activateElement().catch(() => undefined);
      try {
        // Without a local SDK device this targets the account's active device (Spotify Connect).
        await api.spotifyPlay(uri, deviceId ?? undefined);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPlayerError(deviceId ? msg : `${msg}(Spotify アプリを起動してから再試行してください)`);
      }
    },
    [deviceId],
  );

  const value: SpotifyCtx = {
    status,
    refreshStatus,
    deviceId,
    playerError,
    nowPlaying,
    play,
    togglePlay: () => void player.current?.togglePlay(),
    next: () => void player.current?.nextTrack(),
    previous: () => void player.current?.previousTrack(),
    seek: (ms) => void player.current?.seek(ms),
    disconnect: async () => {
      await api.spotifyLogout();
      await refreshStatus();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSpotify() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSpotify outside SpotifyProvider");
  return ctx;
}
