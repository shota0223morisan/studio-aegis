import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type SpotifyStatus } from "./api";

/**
 * App-wide Spotify state. Full playback goes to the Spotify app via Spotify Connect
 * (the Mac app's built-in browser has no Widevine DRM, which in-page playback needs).
 */

interface Toast {
  text: string;
  error: boolean;
}

interface SpotifyCtx {
  status: SpotifyStatus | null;
  refreshStatus: () => Promise<void>;
  /** Short-lived feedback after a play request. */
  toast: Toast | null;
  play: (uri: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<SpotifyCtx | null>(null);

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.error ? 6000 : 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const play = useCallback(async (uri: string) => {
    try {
      const r = await api.spotifyPlay(uri);
      setToast({ text: `Spotify(${r.device})で再生しました`, error: false });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  }, []);

  const value: SpotifyCtx = {
    status,
    refreshStatus,
    toast,
    play,
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
