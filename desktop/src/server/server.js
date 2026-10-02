// Local HTTP server for the desktop app: serves the web UI and the /api it talks to.
// Bound to 127.0.0.1 only; every /api call must carry the per-launch session cookie that the
// Electron window holds, so other apps / browsers on the machine can't read or change data.
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const express = require("express");
const { newId, now } = require("./db");
const { createSpotifyRouter, fetchOEmbedTitle, parseSpotifyRef } = require("./spotify");
const { createNotionRouter } = require("./notion");

const FILE_CATEGORIES = ["client_ref", "deliverable", "other"];
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_THUMB_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXT = {
  ".wav": "audio/wav",
  ".wave": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const extOf = (name) => (String(name).toLowerCase().match(/\.[a-z0-9]{1,8}$/) ?? [""])[0];
const mimeFor = (name) => MIME_BY_EXT[extOf(name)] ?? "application/octet-stream";
const str = (v, max = 200_000) => (typeof v === "string" ? v.slice(0, max) : undefined);

function contentDisposition(type, fileName) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {ReturnType<import("./db").openDatabase>} opts.store
 * @param {string} opts.webDir   built web UI (web/dist)
 * @param {number} opts.port
 * @param {string} opts.sessionToken  value of the aegis_session cookie the window carries
 */
function createServer({ store, webDir, port, sessionToken }) {
  const { db, filesDir } = store;
  const origin = `http://127.0.0.1:${port}`;
  const projectDir = (id) => path.join(filesDir, id);
  const app = express();
  app.disable("x-powered-by");

  // Only answer to our own origin (blocks DNS-rebinding style access from web pages).
  app.use((req, res, next) => (req.headers.host === `127.0.0.1:${port}` ? next() : res.status(403).end()));

  app.use("/api", (req, res, next) => {
    const cookie = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith("aegis_session="));
    if (cookie?.slice("aegis_session=".length) === sessionToken) return next();
    res.status(401).json({ error: "unauthorized" });
  });
  app.use("/api", express.json({ limit: "2mb" }));

  // ---- helpers ----
  const touch = (id) => db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), id);
  const getProject = (id) => db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  const getFile = (id) => db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  const getRef = (id) => db.prepare("SELECT * FROM spotify_refs WHERE id = ?").get(id);

  const serializeProject = (p) => ({
    id: p.id,
    name: p.name,
    thumbnailUrl: p.thumbnail ? `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.thumbnail)}` : null,
    clientId: p.client_id ?? null,
    brief: p.brief ?? "",
    structureMemo: p.structure_memo,
    ideaMemo: p.idea_memo,
    spliceUrl: p.splice_url,
    spliceLabel: p.splice_label,
    deadline: p.deadline,
    pinned: Boolean(p.pinned),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  });
  const serializeFile = (f) => ({
    id: f.id,
    category: f.category,
    name: f.original_name,
    mime: f.mime,
    size: f.size,
    note: f.note,
    createdAt: f.created_at,
    url: `/api/files/${f.id}`,
    downloadUrl: `/api/files/${f.id}?download=1`,
  });
  const serializeRef = (r) => ({
    id: r.id,
    kind: r.kind,
    spotifyId: r.spotify_id,
    uri: `spotify:${r.kind}:${r.spotify_id}`,
    title: r.title,
    subtitle: r.subtitle,
    note: r.note,
    position: r.position,
  });

  function loadProject(req, res, next) {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "曲が見つかりません" });
    res.locals.project = project;
    next();
  }

  /** Stream the raw request body (a single file) to disk, enforcing a size cap. */
  async function receiveFile(req, dest, maxBytes) {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error("too large"), { status: 413 });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let received = 0;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) req.destroy(Object.assign(new Error("too large"), { status: 413 }));
    });
    try {
      await pipeline(req, fs.createWriteStream(dest));
    } catch (err) {
      fs.rmSync(dest, { force: true });
      throw err;
    }
    return received;
  }

  // ---- session / settings ----
  app.get("/api/session", (_req, res) =>
    res.json({ spotifyConfigured: Boolean(store.kvGet("spotify.clientId")), maxUploadBytes: MAX_UPLOAD_BYTES }),
  );

  app.use("/api/spotify", createSpotifyRouter(store, { redirectUri: `${origin}/api/spotify/callback` }));
  app.use("/api/notion", createNotionRouter(store));

  // ---- clients (取引先) ----
  const getClient = (id) => db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  const serializeClient = (c) => ({
    id: c.id,
    name: c.name,
    note: c.note,
    position: c.position,
    songCount: c.song_count ?? 0,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  });

  app.get("/api/clients", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS song_count
         FROM clients c ORDER BY c.position, c.created_at`,
      )
      .all();
    res.json({ items: rows.map(serializeClient) });
  });

  app.post("/api/clients", (req, res) => {
    const name = str(req.body?.name, 200)?.trim();
    if (!name) return res.status(400).json({ error: "取引先名を入力してください" });
    const id = newId();
    const ts = now();
    const { pos } = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM clients").get();
    db.prepare("INSERT INTO clients (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, name, pos, ts, ts);
    res.status(201).json(serializeClient(getClient(id)));
  });

  app.patch("/api/clients/:id", (req, res) => {
    const c = getClient(req.params.id);
    if (!c) return res.status(404).json({ error: "取引先が見つかりません" });
    const name = str(req.body?.name, 200)?.trim();
    if (name !== undefined && !name) return res.status(400).json({ error: "取引先名を入力してください" });
    const note = str(req.body?.note, 100_000);
    db.prepare("UPDATE clients SET name = ?, note = ?, updated_at = ? WHERE id = ?").run(name ?? c.name, note ?? c.note, now(), c.id);
    res.json(serializeClient(getClient(c.id)));
  });

  /** Body: { order: clientId[] } */
  app.put("/api/clients/order", (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: "order が必要です" });
    const stmt = db.prepare("UPDATE clients SET position = ? WHERE id = ?");
    order.forEach((id, i) => stmt.run(i, String(id)));
    res.json({ ok: true });
  });

  /** Songs of a deleted client stay, under "取引先なし". */
  app.delete("/api/clients/:id", (req, res) => {
    db.prepare("UPDATE projects SET client_id = NULL WHERE client_id = ?").run(req.params.id);
    db.prepare("DELETE FROM clients WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ---- projects (songs) ----
  const SORTS = {
    updated: "updated_at DESC",
    // Prepared for later; the UI only exposes "updated" for now.
    deadline: "deadline IS NULL, deadline ASC, updated_at DESC",
    pinned: "pinned DESC, updated_at DESC",
  };

  /** ?client=<id> for one client's songs, ?client=none for songs without a client. */
  app.get("/api/projects", (req, res) => {
    const order = SORTS[String(req.query.sort)] ?? SORTS.updated;
    const client = req.query.client;
    const rows =
      client === "none"
        ? db.prepare(`SELECT * FROM projects WHERE client_id IS NULL ORDER BY ${order}`).all()
        : typeof client === "string" && client
          ? db.prepare(`SELECT * FROM projects WHERE client_id = ? ORDER BY ${order}`).all(client)
          : db.prepare(`SELECT * FROM projects ORDER BY ${order}`).all();
    res.json({ items: rows.map(serializeProject) });
  });

  const validClientId = (v) => (typeof v === "string" && v && getClient(v) ? v : null);

  app.post("/api/projects", (req, res) => {
    const name = str(req.body?.name, 200)?.trim();
    if (!name) return res.status(400).json({ error: "曲名を入力してください" });
    const id = newId();
    const ts = now();
    db.prepare("INSERT INTO projects (id, name, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      name,
      validClientId(req.body?.clientId),
      ts,
      ts,
    );
    res.status(201).json(serializeProject(getProject(id)));
  });

  app.get("/api/projects/:id", loadProject, (_req, res) => {
    const p = res.locals.project;
    const refs = db.prepare("SELECT * FROM spotify_refs WHERE project_id = ? ORDER BY position").all(p.id);
    const files = db.prepare("SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC").all(p.id);
    res.json({ ...serializeProject(p), refs: refs.map(serializeRef), files: files.map(serializeFile) });
  });

  app.patch("/api/projects/:id", loadProject, (req, res) => {
    const p = res.locals.project;
    const b = req.body ?? {};
    const updates = {};
    const name = str(b.name, 200)?.trim();
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: "曲名を入力してください" });
      updates.name = name;
    }
    if (str(b.structureMemo) !== undefined) updates.structure_memo = str(b.structureMemo);
    if (str(b.brief) !== undefined) updates.brief = str(b.brief);
    if (b.clientId === null || typeof b.clientId === "string") updates.client_id = validClientId(b.clientId);
    if (str(b.ideaMemo) !== undefined) updates.idea_memo = str(b.ideaMemo);
    if (str(b.spliceLabel, 200) !== undefined) updates.splice_label = str(b.spliceLabel, 200);
    if (str(b.spliceUrl, 2000) !== undefined) {
      const url = str(b.spliceUrl, 2000).trim();
      if (url && !isHttpUrl(url)) return res.status(400).json({ error: "Splice の URL が不正です" });
      updates.splice_url = url;
    }
    if (b.deadline === null || typeof b.deadline === "string") updates.deadline = b.deadline || null;
    if (typeof b.pinned === "boolean") updates.pinned = b.pinned ? 1 : 0;
    if (Object.keys(updates).length) {
      updates.updated_at = now();
      const cols = Object.keys(updates);
      db.prepare(`UPDATE projects SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => updates[c]), p.id);
    }
    res.json(serializeProject(getProject(p.id)));
  });

  app.delete("/api/projects/:id", loadProject, (req, res) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    fs.rmSync(projectDir(req.params.id), { recursive: true, force: true });
    res.json({ ok: true });
  });

  // ---- thumbnail (raw body, ?name=<file name>) ----
  app.put("/api/projects/:id/thumbnail", loadProject, async (req, res, next) => {
    try {
      const p = res.locals.project;
      const ext = extOf(req.query.name);
      if (!IMAGE_EXTS.has(ext)) return res.status(400).json({ error: "画像は png / jpg / webp / gif に対応しています" });
      const stored = `thumb-${newId()}${ext}`;
      await receiveFile(req, path.join(projectDir(p.id), stored), MAX_THUMB_BYTES);
      if (p.thumbnail) fs.rmSync(path.join(projectDir(p.id), p.thumbnail), { force: true });
      db.prepare("UPDATE projects SET thumbnail = ?, updated_at = ? WHERE id = ?").run(stored, now(), p.id);
      res.json(serializeProject(getProject(p.id)));
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/projects/:id/thumbnail", loadProject, (_req, res) => {
    const p = res.locals.project;
    if (p.thumbnail) fs.rmSync(path.join(projectDir(p.id), p.thumbnail), { force: true });
    db.prepare("UPDATE projects SET thumbnail = NULL, updated_at = ? WHERE id = ?").run(now(), p.id);
    res.json(serializeProject(getProject(p.id)));
  });

  app.get("/api/projects/:id/thumbnail", loadProject, (_req, res) => {
    const p = res.locals.project;
    if (!p.thumbnail) return res.status(404).end();
    res.sendFile(path.join(projectDir(p.id), p.thumbnail), { headers: { "Cache-Control": "private, max-age=31536000, immutable" } });
  });

  // ---- Spotify references ----
  app.post("/api/projects/:id/refs", loadProject, async (req, res, next) => {
    try {
      const p = res.locals.project;
      const ref = parseSpotifyRef(req.body?.input);
      if (!ref) return res.status(400).json({ error: "Spotify の URL / URI を認識できませんでした" });
      const title = str(req.body?.title, 300) || (await fetchOEmbedTitle(ref.kind, ref.id));
      const subtitle = str(req.body?.subtitle, 300) ?? "";
      const { pos } = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM spotify_refs WHERE project_id = ?").get(p.id);
      const id = newId();
      db.prepare(
        "INSERT INTO spotify_refs (id, project_id, kind, spotify_id, title, subtitle, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, p.id, ref.kind, ref.id, title, subtitle, pos, now());
      touch(p.id);
      res.status(201).json(serializeRef(getRef(id)));
    } catch (err) {
      next(err);
    }
  });

  app.put("/api/projects/:id/refs/order", loadProject, (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: "order が必要です" });
    const stmt = db.prepare("UPDATE spotify_refs SET position = ? WHERE id = ? AND project_id = ?");
    order.forEach((refId, i) => stmt.run(i, String(refId), req.params.id));
    touch(req.params.id);
    res.json({ ok: true });
  });

  app.patch("/api/projects/:id/refs/:refId", loadProject, (req, res) => {
    const row = db.prepare("SELECT id FROM spotify_refs WHERE id = ? AND project_id = ?").get(req.params.refId, req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    const note = str(req.body?.note, 5000);
    const title = str(req.body?.title, 300);
    if (note !== undefined) db.prepare("UPDATE spotify_refs SET note = ? WHERE id = ?").run(note, row.id);
    if (title !== undefined) db.prepare("UPDATE spotify_refs SET title = ? WHERE id = ?").run(title, row.id);
    touch(req.params.id);
    res.json(serializeRef(getRef(row.id)));
  });

  app.delete("/api/projects/:id/refs/:refId", loadProject, (req, res) => {
    db.prepare("DELETE FROM spotify_refs WHERE id = ? AND project_id = ?").run(req.params.refId, req.params.id);
    touch(req.params.id);
    res.json({ ok: true });
  });

  // ---- files (raw body upload: PUT ?name=&category=) ----
  app.put("/api/projects/:id/files", loadProject, async (req, res, next) => {
    try {
      const p = res.locals.project;
      const name = str(req.query.name, 300)?.trim();
      if (!name) return res.status(400).json({ error: "ファイル名がありません" });
      const category = FILE_CATEGORIES.includes(req.query.category) ? req.query.category : "other";
      const id = newId();
      const stored = `${id}${extOf(name)}`;
      const size = await receiveFile(req, path.join(projectDir(p.id), stored), MAX_UPLOAD_BYTES);
      db.prepare(
        "INSERT INTO files (id, project_id, category, original_name, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, p.id, category, name, stored, mimeFor(name), size, now());
      touch(p.id);
      res.status(201).json(serializeFile(getFile(id)));
    } catch (err) {
      next(err);
    }
  });

  // Range requests (seeking) are handled by res.sendFile.
  app.get("/api/files/:fileId", (req, res) => {
    const f = getFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: "not found" });
    res.setHeader("Content-Disposition", contentDisposition(req.query.download ? "attachment" : "inline", f.original_name));
    res.sendFile(path.join(projectDir(f.project_id), f.stored_name), { headers: { "Content-Type": f.mime }, cacheControl: false });
  });

  app.patch("/api/files/:fileId", (req, res) => {
    const f = getFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: "not found" });
    if (FILE_CATEGORIES.includes(req.body?.category)) db.prepare("UPDATE files SET category = ? WHERE id = ?").run(req.body.category, f.id);
    const note = str(req.body?.note, 5000);
    if (note !== undefined) db.prepare("UPDATE files SET note = ? WHERE id = ?").run(note, f.id);
    const name = str(req.body?.name, 300)?.trim();
    if (name) db.prepare("UPDATE files SET original_name = ? WHERE id = ?").run(name, f.id);
    touch(f.project_id);
    res.json(serializeFile(getFile(f.id)));
  });

  app.delete("/api/files/:fileId", (req, res) => {
    const f = getFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: "not found" });
    db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
    fs.rmSync(path.join(projectDir(f.project_id), f.stored_name), { force: true });
    touch(f.project_id);
    res.json({ ok: true });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  // ---- web UI ----
  app.use(express.static(webDir, { index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(webDir, "index.html")));

  app.use((err, _req, res, _next) => {
    if (err?.status === 413) return res.status(413).json({ error: "ファイルが大きすぎます" });
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "エラーが発生しました" });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
    server.requestTimeout = 0;
  });
}

module.exports = { createServer };
