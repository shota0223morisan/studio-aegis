// Minimal typings for the Spotify Web Playback SDK (https://sdk.scdn.co/spotify-player.js).
declare namespace Spotify {
  interface Image {
    url: string;
  }
  interface Track {
    uri: string;
    id: string | null;
    name: string;
    duration_ms: number;
    album: { name: string; images: Image[] };
    artists: { name: string; uri: string }[];
  }
  interface PlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    timestamp: number;
    track_window: { current_track: Track | null };
  }
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }
  class Player {
    constructor(init: PlayerInit);
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(event: "ready" | "not_ready", cb: (data: { device_id: string }) => void): boolean;
    addListener(event: "player_state_changed", cb: (state: PlaybackState | null) => void): boolean;
    addListener(
      event: "initialization_error" | "authentication_error" | "account_error" | "playback_error" | "autoplay_failed",
      cb: (err: { message: string }) => void,
    ): boolean;
    getCurrentState(): Promise<PlaybackState | null>;
    togglePlay(): Promise<void>;
    nextTrack(): Promise<void>;
    previousTrack(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    activateElement(): Promise<void>;
  }
}

interface Window {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: typeof Spotify;
}
