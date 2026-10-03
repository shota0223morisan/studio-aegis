import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, type NotionBlock, type NotionPage } from "./api";
import { DEFAULT_MIX_CHECKS, uid } from "./flow";

let cache: Promise<NotionPage> | null = null;

const todos = (blocks: NotionBlock[]): string[] =>
  blocks.flatMap((b) => [...(b.type === "to_do" ? [b.text.map((t) => t.t).join("").trim()] : []), ...todos(b.children ?? [])]).filter(Boolean);

/** Notion「Mixing Tips」(cached for the session) and its 書き出し前チェックリスト items. */
export function useMixTips(enabled = true) {
  const [page, setPage] = useState<NotionPage | null>(null);
  const load = useCallback((refresh = false) => {
    if (refresh || !cache) cache = api.notionMix(refresh).catch(() => ({ configured: false, url: "", blocks: [], error: "読み込めませんでした" }));
    return cache.then((p) => {
      setPage(p);
      baseItems = todos(p.blocks);
      emit();
    });
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  const fromNotion = page ? todos(page.blocks) : [];
  return { page, fromNotion: fromNotion.length > 0, refresh: () => load(true) };
}

// ---- The pre-export checklist: the user's own order / edits / deletions over the Notion items ----

export interface MixItem {
  id: string;
  text: string;
  /** The Notion / built-in text it came from (so it isn't added again after an edit). */
  origin?: string;
  deleted?: boolean;
}

let saved: MixItem[] | null | undefined; // undefined = not loaded yet
let baseItems: string[] = [];
let loading: Promise<void> | null = null;
let snapshot: MixItem[] = [];
const listeners = new Set<() => void>();

/** Saved list + any source item not in it yet (appended), or the source items as they are. */
function compute(): MixItem[] {
  const source = baseItems.length ? baseItems : DEFAULT_MIX_CHECKS;
  if (!saved) return source.map((text) => ({ id: `n:${text}`, text, origin: text }));
  const known = new Set(saved.flatMap((it) => [it.origin, it.text]).filter(Boolean));
  return [...saved, ...source.filter((t) => !known.has(t)).map((text) => ({ id: `n:${text}`, text, origin: text }))];
}

function emit() {
  snapshot = compute();
  listeners.forEach((l) => l());
}

function ensureLoaded() {
  if (saved !== undefined || loading) return;
  loading = api
    .mixChecklist()
    .then((r) => {
      saved = r.items;
      emit();
    })
    .catch(() => {
      saved = null;
      emit();
    });
}

async function save(list: MixItem[]) {
  saved = list;
  emit();
  await api.setMixChecklist(list);
}

/** Every song's checklist (ticks stay per song). */
export function useMixChecklist(enabled = true) {
  useEffect(() => {
    if (enabled) ensureLoaded();
  }, [enabled]);
  const all = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
  const list = all.length ? all : compute();
  return {
    items: list.filter((it) => !it.deleted),
    deleted: list.filter((it) => it.deleted),
    add: (text: string) => save([...list, { id: `c:${uid()}`, text }]),
    edit: (id: string, text: string) => save(list.map((it) => (it.id === id ? { ...it, text } : it))),
    remove: (id: string) => save(list.map((it) => (it.id === id ? { ...it, deleted: true } : it))),
    restore: (id: string) => save(list.map((it) => (it.id === id ? { ...it, deleted: false } : it))),
    /** Move `id` to where `beforeId` is (null = to the end), among the visible items. */
    move: (id: string, beforeId: string | null) => {
      const item = list.find((it) => it.id === id);
      if (!item || id === beforeId) return;
      const rest = list.filter((it) => it.id !== id);
      const at = beforeId ? rest.findIndex((it) => it.id === beforeId) : rest.length;
      rest.splice(at < 0 ? rest.length : at, 0, item);
      void save(rest);
    },
  };
}
