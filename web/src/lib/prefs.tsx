import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Prefs } from "./api";

const DEFAULTS: Prefs = { gate: "hard", timebox: { 1: 30, 2: 90, 3: 120, 4: 60 }, autoLayout: true, aiModel: "claude" };

interface PrefsCtx {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => Promise<void>;
}

const Ctx = createContext<PrefsCtx>({ prefs: DEFAULTS, update: async () => {} });

/** App-wide settings (lock strictness, timeboxes, auto layout, AI model). */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    api.prefs().then(setPrefs).catch(() => {});
  }, []);
  const update = useCallback(async (patch: Partial<Prefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setPrefs(await api.setPrefs(patch));
  }, []);
  return <Ctx.Provider value={{ prefs, update }}>{children}</Ctx.Provider>;
}

export const usePrefs = () => useContext(Ctx);
