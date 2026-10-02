import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Client, type Project } from "./api";

/** Clients and songs, shared by the sidebar and pages. Pages call reload() after changing them. */
interface Library {
  clients: Client[];
  songs: Project[];
  loaded: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [songs, setSongs] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [c, s] = await Promise.all([api.listClients(), api.listProjects()]);
    setClients(c.items);
    setSongs(s.items);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <Ctx.Provider value={{ clients, songs, loaded, reload }}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLibrary outside LibraryProvider");
  return ctx;
}
