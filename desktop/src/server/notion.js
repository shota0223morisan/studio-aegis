// Notion: show the 「🎛 制作アイディア」 database and the 「🎚️ Mixing Tips」 page inside the app (read-only).
// Uses an internal integration token (the same kind Lyric Machine uses) and caches the last
// result so ideas are still visible offline.
const express = require("express");

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";
const TOKEN_KEY = "notion.token";
const DB_KEY = "notion.ideasDb";
const CACHE_KEY = "notion.ideasCache";
const DEFAULT_DB = "f50f0dbd-118d-4d8f-93ec-335563f98702"; // 記録 / 🎛 制作アイディア
const MIX_KEY = "notion.mixPage";
const MIX_CACHE_KEY = "notion.mixCache";
const DEFAULT_MIX_PAGE = "3445efde-9390-80e7-b83d-f88163b68e5e"; // 理論 / 🎚️ Mixing Tips
const FRESH_MS = 5 * 60 * 1000;
const MAX_PAGES = 10; // × 100 rows

class NotionError extends Error {}

/** Database id from a Notion URL or a raw id (32 hex chars, with or without dashes). */
function parseId(text) {
  const m = String(text ?? "").match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) return null;
  const raw = m[0].replace(/-/g, "").toLowerCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

const plain = (rich) => (rich ?? []).map((t) => t.plain_text ?? "").join("").trim();

/** Flatten one Notion property into { type, text?, options? } the UI can render. */
function propValue(p) {
  switch (p?.type) {
    case "title":
    case "rich_text":
      return { type: "text", text: plain(p[p.type]) };
    case "select":
    case "status":
      return { type: "options", options: p[p.type] ? [{ name: p[p.type].name, color: p[p.type].color }] : [] };
    case "multi_select":
      return { type: "options", options: (p.multi_select ?? []).map((o) => ({ name: o.name, color: o.color })) };
    case "number":
      return { type: "text", text: p.number == null ? "" : String(p.number) };
    case "url":
    case "email":
    case "phone_number":
      return { type: "text", text: p[p.type] ?? "" };
    case "checkbox":
      return { type: "text", text: p.checkbox ? "✓" : "" };
    case "date":
      return { type: "text", text: p.date?.start ?? "" };
    case "relation":
      return { type: "count", text: String((p.relation ?? []).length) };
    default:
      return { type: "other", text: "" };
  }
}

async function notion(token, path, body, what = "データベース", name = "🎛 制作アイディア") {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new NotionError("Notion のトークンが違うか、無効になっています(設定で入れ直してください)");
  if (res.status === 403 || res.status === 404) {
    throw new NotionError(`${what}が見つかりません。Notion で「${name}」を開き、右上の「…」→「接続」でインテグレーションを追加してください`);
  }
  if (res.status === 429) throw new NotionError("Notion が混み合っています。少し待ってから更新してください");
  if (!res.ok) throw new NotionError(`Notion エラー (${res.status})`);
  return res.json();
}

async function fetchIdeas(token, dbId) {
  const items = [];
  let cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await notion(token, `/databases/${dbId}/query`, {
      page_size: 100,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const row of data.results ?? []) {
      if (row.archived || row.in_trash) continue;
      const props = {};
      let title = "";
      for (const [name, p] of Object.entries(row.properties ?? {})) {
        if (p.type === "title") title = plain(p.title);
        else props[name] = propValue(p);
      }
      items.push({ id: row.id, url: row.url, title, createdAt: row.created_time, editedAt: row.last_edited_time, props });
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return items;
}

// ---- pages (Mixing Tips): blocks → a small tree the UI renders ----

const richText = (rich) =>
  (rich ?? []).map((t) => {
    const a = t.annotations ?? {};
    const r = { t: t.plain_text ?? "" };
    if (a.bold) r.b = true;
    if (a.italic) r.i = true;
    if (a.strikethrough) r.s = true;
    if (a.code) r.c = true;
    if (t.href) r.href = t.href;
    return r;
  });

const BLOCK_TYPES = new Set([
  "paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item",
  "to_do", "toggle", "quote", "callout", "divider", "code",
]);

async function fetchBlocks(token, id, depth = 0) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const q = `page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const data = await notion(token, `/blocks/${id}/children?${q}`, undefined, "ページ", "🎚️ Mixing Tips");
    for (const b of data.results ?? []) {
      if (!BLOCK_TYPES.has(b.type) || b.in_trash || b.archived) continue;
      const body = b[b.type] ?? {};
      const block = { id: b.id, type: b.type, text: richText(body.rich_text) };
      if (b.type === "to_do") block.checked = Boolean(body.checked);
      if (b.type.startsWith("heading_") && body.is_toggleable) block.toggle = true;
      if (b.type === "callout" && body.icon?.emoji) block.icon = body.icon.emoji;
      if (b.has_children && depth < 4) block.children = await fetchBlocks(token, b.id, depth + 1);
      if (b.type === "paragraph" && !block.text.length && !block.children?.length) continue; // empty lines
      out.push(block);
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

async function fetchPage(token, id) {
  const page = await notion(token, `/pages/${id}`, undefined, "ページ", "🎚️ Mixing Tips");
  const titleProp = Object.values(page.properties ?? {}).find((p) => p.type === "title");
  return {
    pageId: id,
    url: page.url,
    title: plain(titleProp?.title) || "Mixing Tips",
    icon: page.icon?.emoji ?? "",
    blocks: await fetchBlocks(token, id),
    fetchedAt: Date.now(),
  };
}

const flatten = (blocks, indent = "") =>
  blocks
    .map((b) => {
      const text = b.text.map((t) => t.t).join("");
      const mark = b.type === "to_do" ? "- [ ] " : b.type.startsWith("heading") ? "# " : b.type.endsWith("list_item") ? "- " : "";
      const line = b.type === "divider" ? "---" : `${indent}${mark}${text}`;
      return [line, b.children ? flatten(b.children, `${indent}  `) : ""].filter(Boolean).join("\n");
    })
    .join("\n");

/** The cached Mixing Tips as plain text (for the AI), or "" if never fetched. */
function cachedMixTipsText(store) {
  const cache = store.kvGet(MIX_CACHE_KEY);
  return cache?.blocks ? flatten(cache.blocks) : "";
}

function createNotionRouter(store) {
  const router = express.Router();
  const token = () => store.kvGet(TOKEN_KEY) || "";
  const dbId = () => store.kvGet(DB_KEY) || DEFAULT_DB;
  const dbUrl = () => `https://www.notion.so/${dbId().replace(/-/g, "")}`;
  const mixPage = () => store.kvGet(MIX_KEY) || DEFAULT_MIX_PAGE;
  const mixUrl = () => `https://www.notion.so/${mixPage().replace(/-/g, "")}`;
  const status = () => ({ configured: Boolean(token()), dbId: dbId(), dbUrl: dbUrl(), mixPage: mixPage(), mixUrl: mixUrl() });

  router.get("/status", (_req, res) => res.json(status()));

  /** Body: { token?, db? } — empty token removes it. */
  router.put("/settings", (req, res) => {
    const b = req.body ?? {};
    if (typeof b.token === "string") {
      const t = b.token.trim();
      if (t && !/^(ntn_|secret_)\S{20,}$/.test(t)) return res.status(400).json({ error: "トークンは ntn_ で始まる文字列です" });
      if (t) store.kvSet(TOKEN_KEY, t);
      else store.kvDelete(TOKEN_KEY);
      store.kvDelete(CACHE_KEY);
    }
    if (typeof b.db === "string") {
      const id = b.db.trim() ? parseId(b.db) : DEFAULT_DB;
      if (!id) return res.status(400).json({ error: "Notion のデータベースの URL を入れてください" });
      store.kvSet(DB_KEY, id);
      store.kvDelete(CACHE_KEY);
    }
    if (typeof b.mixPage === "string") {
      const id = b.mixPage.trim() ? parseId(b.mixPage) : DEFAULT_MIX_PAGE;
      if (!id) return res.status(400).json({ error: "Notion のページの URL を入れてください" });
      store.kvSet(MIX_KEY, id);
      store.kvDelete(MIX_CACHE_KEY);
    }
    res.json({ ok: true, ...status() });
  });

  /** The Mixing Tips page, cached like the ideas (?refresh=1 forces a fetch). */
  router.get("/mix", async (req, res) => {
    const cache = store.kvGet(MIX_CACHE_KEY);
    if (!token()) return res.json({ configured: false, blocks: [], url: mixUrl() });
    const fresh = cache && cache.pageId === mixPage() && Date.now() - cache.fetchedAt < FRESH_MS * 2;
    if (fresh && !req.query.refresh) return res.json({ configured: true, ...cache });
    try {
      const next = await fetchPage(token(), mixPage());
      store.kvSet(MIX_CACHE_KEY, next);
      res.json({ configured: true, ...next });
    } catch (err) {
      const message = err instanceof NotionError ? err.message : "Notion に接続できませんでした(オフライン?)";
      res.json({ configured: true, ...(cache?.pageId === mixPage() ? cache : { blocks: [], title: "Mixing Tips" }), url: cache?.url ?? mixUrl(), error: message });
    }
  });

  /** Cached for a few minutes; ?refresh=1 forces a fetch. Falls back to the cache on errors. */
  router.get("/ideas", async (req, res) => {
    const cache = store.kvGet(CACHE_KEY);
    if (!token()) return res.json({ configured: false, items: [], dbUrl: dbUrl() });
    const fresh = cache && cache.dbId === dbId() && Date.now() - cache.fetchedAt < FRESH_MS;
    if (fresh && !req.query.refresh) return res.json({ configured: true, ...cache, dbUrl: dbUrl() });
    try {
      const items = await fetchIdeas(token(), dbId());
      const next = { dbId: dbId(), items, fetchedAt: Date.now() };
      store.kvSet(CACHE_KEY, next);
      res.json({ configured: true, ...next, dbUrl: dbUrl() });
    } catch (err) {
      const message = err instanceof NotionError ? err.message : "Notion に接続できませんでした(オフライン?)";
      res.json({ configured: true, items: cache?.items ?? [], fetchedAt: cache?.fetchedAt ?? null, error: message, dbUrl: dbUrl() });
    }
  });

  return router;
}

module.exports = { createNotionRouter, parseId, propValue, cachedMixTipsText };
