/** Bridge injected by the Studio Aegis Mac app (desktop/src/preload.js). Absent in a plain browser (dev). */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url?: string;
  /** True when the app can replace itself (installed in /Applications etc.). */
  canInstall?: boolean;
  problem?: string | null;
}

export interface UpdateProgress {
  phase: "downloading" | "verifying" | "restarting" | "error";
  done?: number;
  total?: number;
  version?: string;
  error?: string;
}

export type PaneTab = "splice" | "suno" | "web" | "amazon" | "ytmusic" | "spotify";
export type PaneSide = "left" | "right";
export type PanePreset = "listen" | "build" | "polish" | "focus";

export interface PanePage {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PaneSideState {
  open: boolean;
  tab: PaneTab | null;
  ratio: number;
}

export interface PaneState {
  left: PaneSideState;
  right: PaneSideState;
  sides: Record<PaneTab, PaneSide>;
  pages: Record<PaneTab, PanePage | null>;
}

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  url: string;
  source: PaneTab;
}

export interface AegisDesktop {
  isDesktop: true;
  platform: string;
  getPaneState: () => Promise<PaneState>;
  setPaneTab: (tab: PaneTab) => Promise<void>;
  togglePane: (side: PaneSide, open?: boolean) => Promise<void>;
  openInPane: (tab: PaneTab, url?: string) => Promise<void>;
  paneNav: (side: PaneSide, action: "back" | "forward" | "reload" | "home" | "external" | "chrome" | "safari") => Promise<void>;
  webGo: (input: string) => Promise<void>;
  moveTab: (tab: PaneTab) => Promise<void>;
  swapPanes: () => Promise<void>;
  applyPreset: (name: PanePreset) => Promise<void>;
  tabMenu: (tab: PaneTab) => Promise<void>;
  nowPlaying: () => Promise<NowPlaying | null>;
  paneDrag: (side: PaneSide, screenX: number) => void;
  paneDragEnd: () => void;
  onPaneState: (cb: (state: PaneState) => void) => () => void;
  dragMidi: (clipId: string) => void;
  copyText: (text: string) => Promise<void>;
  getInfo: () => Promise<{ version: string; dataDir: string }>;
  openDataFolder: () => Promise<void>;
  exportBackup: () => Promise<{ ok: boolean; path?: string }>;
  checkForUpdate: () => Promise<UpdateInfo>;
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void;
  updateNow: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    aegisDesktop?: AegisDesktop;
  }
}

export const desktop: AegisDesktop | undefined = typeof window !== "undefined" ? window.aegisDesktop : undefined;
