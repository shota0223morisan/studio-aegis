/** Bridge injected by the Studio Aegis Mac app (desktop/src/preload.js). Absent in a plain browser (dev). */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url?: string;
}

export interface AegisDesktop {
  isDesktop: true;
  platform: string;
  openSplice: (url: string) => Promise<void>;
  closeSplice: () => Promise<void>;
  isSpliceOpen: () => Promise<boolean>;
  onSplicePanel: (cb: (open: boolean) => void) => () => void;
  getInfo: () => Promise<{ version: string; dataDir: string }>;
  openDataFolder: () => Promise<void>;
  exportBackup: () => Promise<{ ok: boolean; path?: string }>;
  checkForUpdate: () => Promise<UpdateInfo>;
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    aegisDesktop?: AegisDesktop;
  }
}

export const desktop: AegisDesktop | undefined = typeof window !== "undefined" ? window.aegisDesktop : undefined;
