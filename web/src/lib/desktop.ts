/** Bridge injected by the Studio Aegis desktop app (desktop/src/preload.js). Absent in browsers. */
export interface AegisDesktop {
  isDesktop: true;
  platform: string;
  openSplice: (url: string) => Promise<void>;
  closeSplice: () => Promise<void>;
  isSpliceOpen: () => Promise<boolean>;
  onSplicePanel: (cb: (open: boolean) => void) => () => void;
}

declare global {
  interface Window {
    aegisDesktop?: AegisDesktop;
  }
}

export const desktop: AegisDesktop | undefined = typeof window !== "undefined" ? window.aegisDesktop : undefined;
