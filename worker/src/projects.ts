import { Hono, type MiddlewareHandler } from "hono";
import {
  maxUploadBytes,
  newId,
  now,
  readJson,
  str,
  touchProject,
  type AppEnv,
  type Env,
} from "./env";
import { contentDisposition, deletePrefix, extOf, IMAGE_EXTS, mimeFor, serveObject } from "./mime";
import { fetchOEmbedTitle, parseSpotifyRef } from "./spotify";

interface ProjectRow {
  id: string;
  name: string;
  thumbnail: string | null;
  structure_memo: string;
  idea_memo: string;
  splice_url: string;
  splice_label: string;
  deadline: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface FileRow {
  id: string;
  project_id: string;
  category: string;
  original_name: string;
  r2_key: string;
  mime: string;
  size: number;
  note: string;
  created_at: string;
}

interface RefRow {
  id: string;
  kind: string;
  spotify_id: string;
  title: string;
  subtitle: string;
  note: string;
  position: number;
}

const FILE_CATEGORIES = ["client_ref", "deliverable", "other"];
/** R2 multipart: every part except the last must be the same size (min 5 MiB). Stays under the Worker body limit. */
const PART_SIZE = 20 * 1024 * 1024;
const MAX_THUMB_BYTES = 10 * 1024 * 1024;

const prefixFor = (projectId: string) => `projects/${projectId}/`;

function serializeProject(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    thumbnailUrl: p.thumbnail ? `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.thumbnail.split("/").pop()!)}` : null,
    structureMemo: p.structure_memo,
    ideaMemo: p.idea_memo,
    spliceUrl: p.splice_url,
    spliceLabel: p.splice_label,
    deadline: p.deadline,
    pinned: Boolean(p.pinned),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function serializeFile(f: FileRow) {
  return {
    id: f.id,
    category: f.category,
    name: f.original_name,
    mime: f.mime,
    size: f.size,
    note: f.note,
    createdAt: f.created_at,
    url: `/api/files/${f.id}`,
    downloadUrl: `/api/files/${f.id}?download=1`,
  };
}

function serializeRef(r: RefRow) {
  return {
    id: r.id,
    kind: r.kind,
    spotifyId: r.spotify_id,
    uri: `spotify:${r.kind}:${r.spotify_id}`,
    title: r.title,
    subtitle: r.subtitle,
    note: r.note,
    position: r.position,
  };
}

const getProject = (env: Env, id: string) => env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
const getFile = (env: Env, id: string) => env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first<FileRow>();
const getRef = (env: Env, id: string) => env.DB.prepare("SELECT * FROM spotify_refs WHERE id = ?").bind(id).first<RefRow>();

type ProjectEnv = AppEnv & { Variables: { project: ProjectRow } };

/** Loads :id into c.var.project or 404s. */
const loadProject: MiddlewareHandler<ProjectEnv> = async (c, next) => {
  const project = await getProject(c.env, c.req.param("id")!);
  if (!project) return c.json({ error: "案件が見つかりません" }, 404);
  c.set("project", project);
  await next();
};

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const projects = new Hono<ProjectEnv>();

// ---- Projects -------------------------------------------------------------

const SORTS: Record<string, string> = {
  updated: "updated_at DESC",
  // Prepared for later; the UI only exposes "updated" for now.
  deadline: "deadline IS NULL, deadline ASC, updated_at DESC",
  pinned: "pinned DESC, updated_at DESC",
};

projects.get("/projects", async (c) => {
  const order = SORTS[c.req.query("sort") ?? ""] ?? SORTS.updated;
  const { results } = await c.env.DB.prepare(`SELECT * FROM projects ORDER BY ${order}`).all<ProjectRow>();
  return c.json({ items: results.map(serializeProject) });
});

projects.post("/projects", async (c) => {
  const name = str((await readJson(c)).name, 200)?.trim();
  if (!name) return c.json({ error: "案件名を入力してください" }, 400);
  const id = newId();
  const ts = now();
  await c.env.DB.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(id, name, ts, ts).run();
  return c.json(serializeProject((await getProject(c.env, id))!), 201);
});

projects.get("/projects/:id", loadProject, async (c) => {
  const p = c.var.project;
  const [refs, files] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM spotify_refs WHERE project_id = ? ORDER BY position").bind(p.id),
    c.env.DB.prepare("SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC").bind(p.id),
  ]);
  return c.json({
    ...serializeProject(p),
    refs: (refs.results as unknown as RefRow[]).map(serializeRef),
    files: (files.results as unknown as FileRow[]).map(serializeFile),
  });
});

projects.patch("/projects/:id", loadProject, async (c) => {
  const p = c.var.project;
  const b = await readJson(c);
  const updates: Record<string, string | number | null> = {};

  const name = str(b.name, 200)?.trim();
  if (name !== undefined) {
    if (!name) return c.json({ error: "案件名を入力してください" }, 400);
    updates.name = name;
  }
  if (str(b.structureMemo) !== undefined) updates.structure_memo = str(b.structureMemo)!;
  if (str(b.ideaMemo) !== undefined) updates.idea_memo = str(b.ideaMemo)!;
  if (str(b.spliceLabel, 200) !== undefined) updates.splice_label = str(b.spliceLabel, 200)!;
  if (str(b.spliceUrl, 2000) !== undefined) {
    const url = str(b.spliceUrl, 2000)!.trim();
    if (url && !isHttpUrl(url)) return c.json({ error: "Splice の URL が不正です" }, 400);
    updates.splice_url = url;
  }
  if (b.deadline === null || typeof b.deadline === "string") updates.deadline = b.deadline || null;
  if (typeof b.pinned === "boolean") updates.pinned = b.pinned ? 1 : 0;

  if (Object.keys(updates).length) {
    updates.updated_at = now();
    const cols = Object.keys(updates);
    await c.env.DB.prepare(`UPDATE projects SET ${cols.map((col) => `${col} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map((col) => updates[col]), p.id)
      .run();
  }
  return c.json(serializeProject((await getProject(c.env, p.id))!));
});

projects.delete("/projects/:id", loadProject, async (c) => {
  const id = c.var.project.id;
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM files WHERE project_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM spotify_refs WHERE project_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id),
  ]);
  await deletePrefix(c.env.FILES, prefixFor(id));
  return c.json({ ok: true });
});

// ---- Thumbnail ------------------------------------------------------------

projects.put("/projects/:id/thumbnail", loadProject, async (c) => {
  const p = c.var.project;
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "画像ファイルを選択してください" }, 400);
  const ext = extOf(file.name);
  if (!IMAGE_EXTS.has(ext)) return c.json({ error: "画像は png / jpg / webp / gif に対応しています" }, 400);
  if (file.size > MAX_THUMB_BYTES) return c.json({ error: "画像は 10MB までです" }, 413);
  const key = `${prefixFor(p.id)}thumb-${newId()}${ext}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: mimeFor(file.name) } });
  if (p.thumbnail) await c.env.FILES.delete(p.thumbnail);
  await c.env.DB.prepare("UPDATE projects SET thumbnail = ?, updated_at = ? WHERE id = ?").bind(key, now(), p.id).run();
  return c.json(serializeProject((await getProject(c.env, p.id))!));
});

projects.delete("/projects/:id/thumbnail", loadProject, async (c) => {
  const p = c.var.project;
  if (p.thumbnail) await c.env.FILES.delete(p.thumbnail);
  await c.env.DB.prepare("UPDATE projects SET thumbnail = NULL, updated_at = ? WHERE id = ?").bind(now(), p.id).run();
  return c.json(serializeProject((await getProject(c.env, p.id))!));
});

projects.get("/projects/:id/thumbnail", loadProject, async (c) => {
  const p = c.var.project;
  if (!p.thumbnail) return c.body(null, 404);
  return serveObject(c.env.FILES, p.thumbnail, c.req.raw, {
    "Content-Type": mimeFor(p.thumbnail),
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});

// ---- Spotify references ---------------------------------------------------

projects.post("/projects/:id/refs", loadProject, async (c) => {
  const p = c.var.project;
  const b = await readJson(c);
  const ref = parseSpotifyRef(String(b.input ?? ""));
  if (!ref) return c.json({ error: "Spotify の URL / URI を認識できませんでした" }, 400);
  const title = str(b.title, 300) || (await fetchOEmbedTitle(ref.kind, ref.id));
  const subtitle = str(b.subtitle, 300) ?? "";
  const row = await c.env.DB.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM spotify_refs WHERE project_id = ?")
    .bind(p.id)
    .first<{ pos: number }>();
  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO spotify_refs (id, project_id, kind, spotify_id, title, subtitle, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, p.id, ref.kind, ref.id, title, subtitle, row?.pos ?? 0, now())
    .run();
  await touchProject(c.env, p.id);
  return c.json(serializeRef((await getRef(c.env, id))!), 201);
});

/** Body: { order: refId[] } */
projects.put("/projects/:id/refs/order", loadProject, async (c) => {
  const order: unknown = (await readJson(c)).order;
  if (!Array.isArray(order)) return c.json({ error: "order が必要です" }, 400);
  const stmt = c.env.DB.prepare("UPDATE spotify_refs SET position = ? WHERE id = ? AND project_id = ?");
  if (order.length) await c.env.DB.batch(order.map((refId, i) => stmt.bind(i, String(refId), c.var.project.id)));
  await touchProject(c.env, c.var.project.id);
  return c.json({ ok: true });
});

projects.patch("/projects/:id/refs/:refId", loadProject, async (c) => {
  const b = await readJson(c);
  const refId = c.req.param("refId");
  const existing = await c.env.DB.prepare("SELECT id FROM spotify_refs WHERE id = ? AND project_id = ?")
    .bind(refId, c.var.project.id)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);
  const note = str(b.note, 5000);
  const title = str(b.title, 300);
  if (note !== undefined) await c.env.DB.prepare("UPDATE spotify_refs SET note = ? WHERE id = ?").bind(note, refId).run();
  if (title !== undefined) await c.env.DB.prepare("UPDATE spotify_refs SET title = ? WHERE id = ?").bind(title, refId).run();
  await touchProject(c.env, c.var.project.id);
  return c.json(serializeRef((await getRef(c.env, refId))!));
});

projects.delete("/projects/:id/refs/:refId", loadProject, async (c) => {
  await c.env.DB.prepare("DELETE FROM spotify_refs WHERE id = ? AND project_id = ?").bind(c.req.param("refId"), c.var.project.id).run();
  await touchProject(c.env, c.var.project.id);
  return c.json({ ok: true });
});

// ---- File uploads (chunked, straight into R2 multipart) -------------------
//
// Workers cap request bodies at 100 MB, while WAVs / stem zips can be much larger, so the
// browser sends PART_SIZE chunks: create → PUT parts → complete (or abort).

function uploadKey(c: { var: { project: ProjectRow }; req: { param: (k: string) => string; query: (k: string) => string | undefined } }) {
  const key = c.req.query("key") ?? "";
  const valid = key.startsWith(`${prefixFor(c.var.project.id)}${c.req.param("fileId")}`);
  return valid ? key : null;
}

projects.post("/projects/:id/uploads", loadProject, async (c) => {
  const b = await readJson(c);
  const name = str(b.name, 300)?.trim();
  const size = Number(b.size);
  if (!name) return c.json({ error: "ファイル名がありません" }, 400);
  if (!Number.isFinite(size) || size < 0) return c.json({ error: "サイズが不正です" }, 400);
  const limit = maxUploadBytes(c.env);
  if (size > limit) return c.json({ error: `ファイルサイズが上限 (${Math.round(limit / 1024 / 1024)}MB) を超えています` }, 413);
  const fileId = newId();
  const key = `${prefixFor(c.var.project.id)}${fileId}${extOf(name)}`;
  const mpu = await c.env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: mimeFor(name, str(b.type, 100)) } });
  return c.json({ fileId, key, uploadId: mpu.uploadId, partSize: PART_SIZE });
});

projects.put("/projects/:id/uploads/:fileId/parts/:part", loadProject, async (c) => {
  const key = uploadKey(c);
  const uploadId = c.req.query("uploadId");
  const partNumber = Number.parseInt(c.req.param("part"), 10);
  if (!key || !uploadId || !(partNumber >= 1 && partNumber <= 10000) || !c.req.raw.body) {
    return c.json({ error: "不正なリクエストです" }, 400);
  }
  const mpu = c.env.FILES.resumeMultipartUpload(key, uploadId);
  const part = await mpu.uploadPart(partNumber, c.req.raw.body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

projects.post("/projects/:id/uploads/:fileId/complete", loadProject, async (c) => {
  const key = uploadKey(c);
  const uploadId = c.req.query("uploadId");
  const b = await readJson(c);
  const name = str(b.name, 300)?.trim();
  if (!key || !uploadId || !name || !Array.isArray(b.parts)) return c.json({ error: "不正なリクエストです" }, 400);
  const parts = (b.parts as { partNumber: number; etag: string }[])
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
    .sort((a, z) => a.partNumber - z.partNumber);
  let obj: R2Object;
  try {
    obj = await c.env.FILES.resumeMultipartUpload(key, uploadId).complete(parts);
  } catch (err) {
    console.error("[upload] complete failed", err);
    return c.json({ error: "アップロードの完了処理に失敗しました。もう一度お試しください。" }, 400);
  }
  const category = FILE_CATEGORIES.includes(b.category) ? b.category : "other";
  const fileId = c.req.param("fileId");
  await c.env.DB.prepare(
    "INSERT INTO files (id, project_id, category, original_name, r2_key, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(fileId, c.var.project.id, category, name, key, mimeFor(name, str(b.type, 100)), obj.size, now())
    .run();
  await touchProject(c.env, c.var.project.id);
  return c.json(serializeFile((await getFile(c.env, fileId))!), 201);
});

projects.delete("/projects/:id/uploads/:fileId", loadProject, async (c) => {
  const key = uploadKey(c);
  const uploadId = c.req.query("uploadId");
  if (key && uploadId) await c.env.FILES.resumeMultipartUpload(key, uploadId).abort().catch(() => undefined);
  return c.json({ ok: true });
});

// ---- Files ----------------------------------------------------------------

projects.get("/files/:fileId", async (c) => {
  const f = await getFile(c.env, c.req.param("fileId"));
  if (!f) return c.json({ error: "not found" }, 404);
  return serveObject(c.env.FILES, f.r2_key, c.req.raw, {
    "Content-Type": f.mime,
    "Content-Disposition": contentDisposition(c.req.query("download") ? "attachment" : "inline", f.original_name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
  });
});

projects.patch("/files/:fileId", async (c) => {
  const f = await getFile(c.env, c.req.param("fileId"));
  if (!f) return c.json({ error: "not found" }, 404);
  const b = await readJson(c);
  if (FILE_CATEGORIES.includes(b.category)) {
    await c.env.DB.prepare("UPDATE files SET category = ? WHERE id = ?").bind(b.category, f.id).run();
  }
  const note = str(b.note, 5000);
  if (note !== undefined) await c.env.DB.prepare("UPDATE files SET note = ? WHERE id = ?").bind(note, f.id).run();
  const name = str(b.name, 300)?.trim();
  if (name) await c.env.DB.prepare("UPDATE files SET original_name = ? WHERE id = ?").bind(name, f.id).run();
  await touchProject(c.env, f.project_id);
  return c.json(serializeFile((await getFile(c.env, f.id))!));
});

projects.delete("/files/:fileId", async (c) => {
  const f = await getFile(c.env, c.req.param("fileId"));
  if (!f) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM files WHERE id = ?").bind(f.id).run();
  await c.env.FILES.delete(f.r2_key);
  await touchProject(c.env, f.project_id);
  return c.json({ ok: true });
});
