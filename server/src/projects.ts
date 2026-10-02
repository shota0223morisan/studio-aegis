import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { config } from "./config.js";
import { db, newId, now, touchProject } from "./db.js";
import { contentDisposition, decodeOriginalName, IMAGE_EXTS, mimeFor } from "./files.js";
import { fetchOEmbedTitle, parseSpotifyRef } from "./spotify.js";

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
  stored_name: string;
  mime: string;
  size: number;
  note: string;
  created_at: string;
}

const FILE_CATEGORIES = ["client_ref", "deliverable", "other"] as const;

const projectDir = (id: string) => path.join(config.uploadsDir, id);

function serializeProject(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    thumbnailUrl: p.thumbnail ? `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.thumbnail)}` : null,
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

function serializeRef(r: any) {
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

function getProject(id: string) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

/** Loads :id into res.locals.project or 404s. */
function loadProject(req: Request, res: Response, next: NextFunction) {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "案件が見つかりません" });
  res.locals.project = project;
  next();
}

const str = (v: unknown, max = 200_000) => (typeof v === "string" ? v.slice(0, max) : undefined);

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = projectDir(req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(decodeOriginalName(file.originalname)).toLowerCase().replace(/[^.a-z0-9]/g, "");
      cb(null, `${newId()}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 20 },
});

export const projectsRouter = Router();

// ---- Projects -------------------------------------------------------------

const SORTS: Record<string, string> = {
  updated: "updated_at DESC",
  // Prepared for later; the UI only exposes "updated" for now.
  deadline: "deadline IS NULL, deadline ASC, updated_at DESC",
  pinned: "pinned DESC, updated_at DESC",
};

projectsRouter.get("/projects", (req, res) => {
  const order = SORTS[String(req.query.sort)] ?? SORTS.updated;
  const rows = db.prepare(`SELECT * FROM projects ORDER BY ${order}`).all() as unknown as ProjectRow[];
  res.json({ items: rows.map(serializeProject) });
});

projectsRouter.post("/projects", (req, res) => {
  const name = str(req.body?.name, 200)?.trim();
  if (!name) return res.status(400).json({ error: "案件名を入力してください" });
  const id = newId();
  const ts = now();
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, name, ts, ts);
  res.status(201).json(serializeProject(getProject(id)!));
});

projectsRouter.get("/projects/:id", loadProject, (_req, res) => {
  const p = res.locals.project as ProjectRow;
  const refs = db.prepare("SELECT * FROM spotify_refs WHERE project_id = ? ORDER BY position").all(p.id);
  const files = db.prepare("SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC").all(p.id) as unknown as FileRow[];
  res.json({ ...serializeProject(p), refs: refs.map(serializeRef), files: files.map(serializeFile) });
});

projectsRouter.patch("/projects/:id", loadProject, (req, res) => {
  const p = res.locals.project as ProjectRow;
  const b = req.body ?? {};
  const updates: Record<string, string | number | null> = {};

  const name = str(b.name, 200)?.trim();
  if (name !== undefined) {
    if (!name) return res.status(400).json({ error: "案件名を入力してください" });
    updates.name = name;
  }
  if (str(b.structureMemo) !== undefined) updates.structure_memo = str(b.structureMemo)!;
  if (str(b.ideaMemo) !== undefined) updates.idea_memo = str(b.ideaMemo)!;
  if (str(b.spliceLabel, 200) !== undefined) updates.splice_label = str(b.spliceLabel, 200)!;
  if (str(b.spliceUrl, 2000) !== undefined) {
    const url = str(b.spliceUrl, 2000)!.trim();
    if (url && !isHttpUrl(url)) return res.status(400).json({ error: "Splice の URL が不正です" });
    updates.splice_url = url;
  }
  if (b.deadline === null || typeof b.deadline === "string") updates.deadline = b.deadline || null;
  if (typeof b.pinned === "boolean") updates.pinned = b.pinned ? 1 : 0;

  const keys = Object.keys(updates);
  if (keys.length) {
    updates.updated_at = now();
    const cols = Object.keys(updates);
    db.prepare(`UPDATE projects SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
      ...cols.map((c) => updates[c]),
      p.id,
    );
  }
  res.json(serializeProject(getProject(p.id)!));
});

projectsRouter.delete("/projects/:id", loadProject, (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  fs.rmSync(projectDir(req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

// ---- Thumbnail ------------------------------------------------------------

projectsRouter.put("/projects/:id/thumbnail", loadProject, upload.single("file"), (req, res) => {
  const p = res.locals.project as ProjectRow;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "画像ファイルを選択してください" });
  if (!IMAGE_EXTS.has(path.extname(file.filename))) {
    fs.rmSync(file.path, { force: true });
    return res.status(400).json({ error: "画像は png / jpg / webp / gif に対応しています" });
  }
  if (p.thumbnail) fs.rmSync(path.join(projectDir(p.id), p.thumbnail), { force: true });
  db.prepare("UPDATE projects SET thumbnail = ?, updated_at = ? WHERE id = ?").run(file.filename, now(), p.id);
  res.json(serializeProject(getProject(p.id)!));
});

projectsRouter.delete("/projects/:id/thumbnail", loadProject, (_req, res) => {
  const p = res.locals.project as ProjectRow;
  if (p.thumbnail) fs.rmSync(path.join(projectDir(p.id), p.thumbnail), { force: true });
  db.prepare("UPDATE projects SET thumbnail = NULL, updated_at = ? WHERE id = ?").run(now(), p.id);
  res.json(serializeProject(getProject(p.id)!));
});

projectsRouter.get("/projects/:id/thumbnail", loadProject, (_req, res) => {
  const p = res.locals.project as ProjectRow;
  if (!p.thumbnail) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(path.join(projectDir(p.id), p.thumbnail));
});

// ---- Spotify references ---------------------------------------------------

projectsRouter.post("/projects/:id/refs", loadProject, async (req, res, next) => {
  try {
    await addRef(req, res);
  } catch (err) {
    next(err);
  }
});

async function addRef(req: Request, res: Response) {
  const p = res.locals.project as ProjectRow;
  const ref = parseSpotifyRef(String(req.body?.input ?? ""));
  if (!ref) return res.status(400).json({ error: "Spotify の URL / URI を認識できませんでした" });
  const title = str(req.body?.title, 300) || (await fetchOEmbedTitle(ref.kind, ref.id));
  const subtitle = str(req.body?.subtitle, 300) ?? "";
  const { pos } = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM spotify_refs WHERE project_id = ?").get(p.id) as {
    pos: number;
  };
  const id = newId();
  db.prepare(
    "INSERT INTO spotify_refs (id, project_id, kind, spotify_id, title, subtitle, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, p.id, ref.kind, ref.id, title, subtitle, pos, now());
  touchProject(p.id);
  res.status(201).json(serializeRef(db.prepare("SELECT * FROM spotify_refs WHERE id = ?").get(id)));
}

projectsRouter.patch("/projects/:id/refs/:refId", loadProject, (req, res) => {
  const note = str(req.body?.note, 5000);
  const title = str(req.body?.title, 300);
  const row = db.prepare("SELECT * FROM spotify_refs WHERE id = ? AND project_id = ?").get(req.params.refId, req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  if (note !== undefined) db.prepare("UPDATE spotify_refs SET note = ? WHERE id = ?").run(note, req.params.refId);
  if (title !== undefined) db.prepare("UPDATE spotify_refs SET title = ? WHERE id = ?").run(title, req.params.refId);
  touchProject(req.params.id);
  res.json(serializeRef(db.prepare("SELECT * FROM spotify_refs WHERE id = ?").get(req.params.refId)));
});

/** Body: { order: refId[] } */
projectsRouter.put("/projects/:id/refs/order", loadProject, (req, res) => {
  const order: unknown = req.body?.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: "order が必要です" });
  const stmt = db.prepare("UPDATE spotify_refs SET position = ? WHERE id = ? AND project_id = ?");
  order.forEach((refId, i) => stmt.run(i, String(refId), req.params.id));
  touchProject(req.params.id);
  res.json({ ok: true });
});

projectsRouter.delete("/projects/:id/refs/:refId", loadProject, (req, res) => {
  db.prepare("DELETE FROM spotify_refs WHERE id = ? AND project_id = ?").run(req.params.refId, req.params.id);
  touchProject(req.params.id);
  res.json({ ok: true });
});

// ---- Files ----------------------------------------------------------------

projectsRouter.post("/projects/:id/files", loadProject, upload.array("files"), (req, res) => {
  const p = res.locals.project as ProjectRow;
  const category = (FILE_CATEGORIES as readonly string[]).includes(req.body?.category) ? req.body.category : "other";
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: "ファイルを選択してください" });
  const insert = db.prepare(
    "INSERT INTO files (id, project_id, category, original_name, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const created = files.map((f) => {
    const id = newId();
    const name = decodeOriginalName(f.originalname);
    insert.run(id, p.id, category, name, f.filename, mimeFor(name, f.mimetype), f.size, now());
    return serializeFile(db.prepare("SELECT * FROM files WHERE id = ?").get(id) as unknown as FileRow);
  });
  touchProject(p.id);
  res.status(201).json({ items: created });
});

function getFile(id: string) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
}

// Range requests (seeking in long WAVs) are handled by res.sendFile.
projectsRouter.get("/files/:fileId", (req, res) => {
  const f = getFile(req.params.fileId);
  if (!f) return res.status(404).json({ error: "not found" });
  const disposition = req.query.download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", contentDisposition(disposition, f.original_name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path.join(projectDir(f.project_id), f.stored_name), {
    headers: { "Content-Type": f.mime },
    cacheControl: false,
  });
});

projectsRouter.patch("/files/:fileId", (req, res) => {
  const f = getFile(req.params.fileId);
  if (!f) return res.status(404).json({ error: "not found" });
  const category = req.body?.category;
  if ((FILE_CATEGORIES as readonly string[]).includes(category)) {
    db.prepare("UPDATE files SET category = ? WHERE id = ?").run(category, f.id);
  }
  const note = str(req.body?.note, 5000);
  if (note !== undefined) db.prepare("UPDATE files SET note = ? WHERE id = ?").run(note, f.id);
  const name = str(req.body?.name, 300)?.trim();
  if (name) db.prepare("UPDATE files SET original_name = ? WHERE id = ?").run(name, f.id);
  touchProject(f.project_id);
  res.json(serializeFile(getFile(f.id)!));
});

projectsRouter.delete("/files/:fileId", (req, res) => {
  const f = getFile(req.params.fileId);
  if (!f) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
  fs.rmSync(path.join(projectDir(f.project_id), f.stored_name), { force: true });
  touchProject(f.project_id);
  res.json({ ok: true });
});
