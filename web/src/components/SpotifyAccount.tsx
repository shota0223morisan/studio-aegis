import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSpotify } from "../lib/SpotifyContext";

const CALLBACK_MESSAGES: Record<string, string> = {
  connected: "Spotify に接続しました",
  state_mismatch: "Spotify 接続に失敗しました(state 不一致)。もう一度お試しください。",
  access_denied: "Spotify 接続がキャンセルされました",
  error: "Spotify 接続に失敗しました。設定画面の Redirect URI が Spotify 側に登録されているか確認してください。",
};

/** Header widget: connect / disconnect Spotify, and surface the OAuth callback result. */
export function SpotifyAccount() {
  const { status, disconnect, refreshStatus } = useSpotify();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get("spotify");
    if (!result) return;
    params.delete("spotify");
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    void refreshStatus();
    if (result !== "connected") window.alert(CALLBACK_MESSAGES[result] ?? `Spotify 接続エラー: ${result}`);
  }, [location, navigate, refreshStatus]);

  if (!status?.configured) return null; // set up from the settings screen
  if (!status.connected) {
    const returnTo = encodeURIComponent(location.pathname);
    return (
      <a className="btn small spotify" href={`/api/spotify/login?returnTo=${returnTo}`}>
        Spotify に接続
      </a>
    );
  }
  return (
    <span className="spotify-user">
      <span className="dot" aria-hidden /> {status.user?.display_name ?? "Spotify"}
      <button
        className="btn ghost small"
        onClick={() => window.confirm("Spotify との接続を解除しますか?") && void disconnect()}
      >
        解除
      </button>
    </span>
  );
}
