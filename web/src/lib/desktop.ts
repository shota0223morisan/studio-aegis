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

export type PaneTab = "spotify" | "amazon" | "splice" | "web";

export interface PanePage {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PaneState {
  open: boolean;
  tab: PaneTab;
  ratio: number;
  spotify: PanePage | null;
  amazon: PanePage | null;
  splice: PanePage | null;
  web: PanePage | null;
}

export interface AegisDesktop {
  isDesktop: true;
  platform: string;
  getPaneState: () => Promise<PaneState>;
  setPaneTab: (tab: PaneTab) => Promise<void>;
  togglePane: (open?: boolean) => Promise<void>;
  openInPane: (tab: PaneTab, url?: string) => Promise<void>;
  paneNav: (action: "back" | "forward" | "reload" | "home" | "external" | "chrome" | "safari") => Promise<void>;
  webGo: (input: string) => Promise<void>;
  paneDrag: (screenX: number) => void;
  paneDragEnd: () => void;
  onPaneState: (cb: (state: PaneState) => void) => () => void;
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
