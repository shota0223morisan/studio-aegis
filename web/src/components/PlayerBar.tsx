import { useSpotify } from "../lib/SpotifyContext";

/** Small bottom toast confirming (or explaining a failed) Spotify playback request. */
export function PlayerBar() {
  const { toast } = useSpotify();
  if (!toast) return null;
  return <div className={`toast ${toast.error ? "error" : ""}`} role="status">{toast.text}</div>;
}
