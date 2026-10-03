import { useCallback, useEffect, useState } from "react";
import { api, type NotionBlock, type NotionPage } from "./api";
import { DEFAULT_MIX_CHECKS } from "./flow";

let cache: Promise<NotionPage> | null = null;

const todos = (blocks: NotionBlock[]): string[] =>
  blocks.flatMap((b) => [...(b.type === "to_do" ? [b.text.map((t) => t.t).join("").trim()] : []), ...todos(b.children ?? [])]).filter(Boolean);

/** Notion「Mixing Tips」(cached for the session) and its 書き出し前チェックリスト items. */
export function useMixTips(enabled = true) {
  const [page, setPage] = useState<NotionPage | null>(null);
  const load = useCallback((refresh = false) => {
    if (refresh || !cache) cache = api.notionMix(refresh).catch(() => ({ configured: false, url: "", blocks: [], error: "読み込めませんでした" }));
    return cache.then(setPage);
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  const fromNotion = page ? todos(page.blocks) : [];
  return { page, items: fromNotion.length ? fromNotion : DEFAULT_MIX_CHECKS, fromNotion: fromNotion.length > 0, refresh: () => load(true) };
}
