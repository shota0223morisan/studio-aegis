import { useSyncExternalStore } from "react";

export type ThemeId = "studio" | "mecha" | "rock" | "metal" | "electro" | "cyberpunk" | "jpop";

export const THEMES: { id: ThemeId; name: string; desc: string; swatch: string[] }[] = [
  { id: "studio", name: "STUDIO", desc: "シンプル。Mac のライト/ダークに合わせる", swatch: ["#f6f5f2", "#1a1a1a", "#3b6fd8"] },
  { id: "mecha", name: "MECHA", desc: "Lyric Machine とおそろいの HUD。シアン×マゼンタ", swatch: ["#06080c", "#1fe0ff", "#ff2e93"] },
  { id: "rock", name: "ROCK", desc: "ライブポスター。赤×黒×ハーフトーン", swatch: ["#120f0e", "#e5261c", "#f6c445"] },
  { id: "metal", name: "METAL", desc: "クローム×漆黒×ブラッドレッド", swatch: ["#08080a", "#c9ced6", "#c2272d"] },
  { id: "electro", name: "ELECTRO", desc: "クラブの照明。ネオン×グラデーション", swatch: ["#06051a", "#00e5ff", "#ff2bd6"] },
  { id: "cyberpunk", name: "CYBERPUNK", desc: "夜の街の HUD。イエロー×シアン×走査線", swatch: ["#0a0a10", "#fcee0a", "#00f0ff"] },
  { id: "jpop", name: "JPOP", desc: "パステル×キラキラ×まるっこ", swatch: ["#ffe3f1", "#ff5fa2", "#b18cff"] },
];

const KEY = "aegis.theme";
const EVENT = "aegis:theme";

function read(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    /* storage unavailable */
  }
  return "mecha";
}

/** Apply the saved theme to <html>; call before the first render to avoid a flash. */
export function applySavedTheme() {
  document.documentElement.dataset.theme = read();
}

export function setTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: still apply for this session */
  }
  document.documentElement.dataset.theme = id;
  window.dispatchEvent(new Event(EVENT));
}

// Keep other windows of the app (e.g. the left pane's tab bar) in sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    document.documentElement.dataset.theme = read();
    window.dispatchEvent(new Event(EVENT));
  });
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme as ThemeId) || "mecha");
}
