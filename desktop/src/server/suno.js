// Suno through its official MCP server (https://api.suno.com/mcp), called directly by the app.
//
// - Sign-in: standard MCP OAuth — the app registers itself (dynamic client registration), the
//   user approves in their browser, Suno redirects back to 127.0.0.1, and the refresh token is
//   kept (encrypted with the OS keychain when available). No API key.
// - Calls: JSON-RPC over Streamable HTTP (tools/call), one MCP session reused per launch.
// - Jobs (cover / extend / song from MIDI) run in the background and are kept in kv, so the UI
//   can poll them; results, WAV downloads and stems are saved into the song's files.
const crypto = require("node:crypto");
const fs = require("node:fs");
const express = require("express");
const { newId, now } = require("./db");

const MCP_URL = "https://api.suno.com/mcp";
const RESOURCE_META = "https://api.suno.com/.well-known/oauth-protected-resource/mcp";
const SCOPES = "api:v0 credits:spend download library:read library:write offline_access profile:read";
const KV_CLIENT = "suno.client";
const KV_TOKENS = "suno.tokens";
const KV_JOBS = "suno.jobs";

class SunoError extends Error {
  constructor(message, { needLogin = false, status = 502 } = {}) {
    super(message);
    this.needLogin = needLogin;
    this.status = status;
  }
}

// Tokens are encrypted with Electron's safeStorage (macOS keychain) when it's there.
function secretBox() {
  let safe = null;
  try {
    const { safeStorage } = require("electron");
    if (safeStorage?.isEncryptionAvailable()) safe = safeStorage;
  } catch {
    /* plain node (tests) */
  }
  return {
    seal: (obj) => (safe ? { enc: safe.encryptString(JSON.stringify(obj)).toString("base64") } : { plain: obj }),
    open: (box) => {
      if (!box) return null;
      if (box.plain) return box.plain;
      try {
        return safe ? JSON.parse(safe.decryptString(Buffer.from(box.enc, "base64"))) : null;
      } catch {
        return null;
      }
    },
  };
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * @param {object} store  app store (kv, db, midiDir)
 * @param {{ redirectUri: string, addFile: (projectId: string, name: string, data: Buffer, category: string) => object, openExternal?: (url: string) => void, fetchImpl?: typeof fetch, mcpUrl?: string }} opts
 */
function createSuno(store, opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const mcpUrl = opts.mcpUrl ?? MCP_URL;
  const box = secretBox();
  let pending = null; // { state, verifier, expires }
  let mcpSession = null;
  let rpcId = 0;
  let meta = null;

  // ---- OAuth ----
  async function authServer() {
    if (meta) return meta;
    const pr = await (await doFetch(opts.resourceMetaUrl ?? RESOURCE_META)).json();
    const issuer = pr.authorization_servers?.[0];
    if (!issuer) throw new SunoError("Suno のサインイン先が見つかりません");
    const u = new URL(issuer);
    const res = await doFetch(`${u.origin}/.well-known/oauth-authorization-server${u.pathname.replace(/\/$/, "")}`);
    meta = await res.json();
    if (!meta.authorization_endpoint || !meta.token_endpoint) throw new SunoError("Suno のサインイン情報を読み取れませんでした");
    return meta;
  }

  async function client() {
    const saved = store.kvGet(KV_CLIENT);
    if (saved?.client_id && saved.redirect === opts.redirectUri) return saved;
    const m = await authServer();
    const res = await doFetch(m.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Session Partner",
        redirect_uris: [opts.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPES,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.client_id) throw new SunoError(`Suno にアプリを登録できませんでした(${res.status})`);
    const c = { client_id: body.client_id, redirect: opts.redirectUri };
    store.kvSet(KV_CLIENT, c);
    return c;
  }

  async function loginUrl() {
    const m = await authServer();
    const c = await client();
    const verifier = b64url(crypto.randomBytes(32));
    const state = b64url(crypto.randomBytes(16));
    pending = { state, verifier, expires: Date.now() + 15 * 60_000 };
    const q = new URLSearchParams({
      response_type: "code",
      client_id: c.client_id,
      redirect_uri: opts.redirectUri,
      scope: SCOPES,
      state,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      resource: mcpUrl,
    });
    return `${m.authorization_endpoint}?${q}`;
  }

  async function tokenRequest(params) {
    const m = await authServer();
    const c = await client();
    const res = await doFetch(m.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.client_id, resource: mcpUrl, ...params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) return null;
    const prev = box.open(store.kvGet(KV_TOKENS)) ?? {};
    const tokens = {
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? prev.refresh_token,
      expires_at: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    };
    store.kvSet(KV_TOKENS, box.seal(tokens));
    return tokens;
  }

  async function finishLogin(code, state) {
    if (!pending || pending.state !== state || pending.expires < Date.now()) throw new SunoError("サインインの有効期限が切れました。もう一度「Suno に接続」から", { status: 400 });
    const { verifier } = pending;
    pending = null;
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: opts.redirectUri, code_verifier: verifier });
    if (!t) throw new SunoError("Suno のサインインを完了できませんでした");
    mcpSession = null;
  }

  async function accessToken(forceRefresh = false) {
    const t = box.open(store.kvGet(KV_TOKENS));
    if (!t) throw new SunoError("Suno に接続していません(設定 → Suno に接続)", { needLogin: true, status: 401 });
    if (!forceRefresh && t.expires_at - Date.now() > 60_000) return t.access_token;
    if (!t.refresh_token) throw new SunoError("Suno の接続が切れました。もう一度接続してください", { needLogin: true, status: 401 });
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    if (!fresh) {
      store.kvSet(KV_TOKENS, null);
      throw new SunoError("Suno の接続が切れました。もう一度接続してください", { needLogin: true, status: 401 });
    }
    return fresh.access_token;
  }

  // ---- MCP (Streamable HTTP, JSON-RPC) ----
  async function post(body, { retried = false } = {}) {
    const token = await accessToken(retried);
    const res = await doFetch(mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(mcpSession ? { "mcp-session-id": mcpSession } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && !retried) return post(body, { retried: true });
    if (res.status === 401) throw new SunoError("Suno の接続が切れました。もう一度接続してください", { needLogin: true, status: 401 });
    if (res.status === 404 && mcpSession && body.method !== "initialize") {
      mcpSession = null; // session expired on the server: start over
      await initialize();
      return post(body, { retried });
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) mcpSession = sid;
    if (body.id === undefined) return null; // notification
    const text = await res.text();
    let msg = null;
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        try {
          const m = JSON.parse(line.slice(5).trim());
          if (m.id === body.id) msg = m;
        } catch {
          /* keep-alive / partial */
        }
      }
    } else {
      try {
        msg = JSON.parse(text);
      } catch {
        /* below */
      }
    }
    if (!msg) throw new SunoError(`Suno からの返事を読み取れませんでした(${res.status})`);
    if (msg.error) throw new SunoError(String(msg.error.message ?? "Suno でエラーが起きました"));
    return msg.result;
  }

  async function initialize() {
    await post({ jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Session Partner", version: "1" } } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Call one Suno tool; returns its structured result (or parsed text). */
  async function call(name, args = {}) {
    if (!mcpSession) await initialize();
    const r = await post({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } });
    const text = (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    let data = r?.structuredContent;
    if (data === undefined) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (r?.isError) {
      const msg = typeof data === "object" && data ? data.error?.message ?? data.message ?? data.error ?? text : text;
      throw new SunoError(String(msg || `${name} が失敗しました`).slice(0, 300));
    }
    return data;
  }

  // ---- jobs ----
  const running = new Set(); // jobs / stem splits being worked on in this launch
  const jobs = () => store.kvGet(KV_JOBS) ?? [];
  const saveJob = (job) => {
    const list = jobs().filter((j) => j.id !== job.id);
    store.kvSet(KV_JOBS, [job, ...list].slice(0, 200));
    return job;
  };
  const getJob = (id) => jobs().find((j) => j.id === id);
  const patchJob = (id, fn) => {
    const j = getJob(id);
    return j ? saveJob(fn(j)) : null;
  };
  const clipOf = (c) => ({
    id: c.id,
    title: c.title ?? "",
    status: c.status ?? "",
    songUrl: c.song_url ?? c.songUrl ?? "",
    imageUrl: c.image_url ?? c.image_large_url ?? "",
    duration: Number(c.duration ?? c.metadata?.duration) || null,
    error: c.error_message ?? c.error ?? undefined,
  });
  const idsOf = (r) => (Array.isArray(r?.clip_ids) && r.clip_ids.length ? r.clip_ids : r?.id ? [r.id] : []);
  const settled = (s) => s === "complete" || s === "error";

  /** Wait (audio-wait, ~50 s per call) until every clip is complete or errored, up to `minutes`. */
  async function waitAll(ids, minutes = 12) {
    const end = Date.now() + minutes * 60_000;
    let clips = [];
    while (Date.now() < end) {
      const r = await call("audio-wait", ids.length > 1 ? { ids, until: "complete" } : { id: ids[0], until: "complete" });
      clips = (Array.isArray(r?.clips) ? r.clips : [r]).filter(Boolean);
      if (clips.length && clips.every((c) => settled(c.status))) break;
    }
    return clips;
  }

  async function uploadAudio(file, title) {
    const s = await call("audio-upload-create", { title });
    if (!s?.upload_url || !s?.id) throw new SunoError("Suno のアップロード先をもらえませんでした");
    const put = await doFetch(s.upload_url, { method: "PUT", body: fs.readFileSync(file) });
    if (!put.ok) throw new SunoError(`Suno に音源を送れませんでした(${put.status})`);
    const done = await call("audio-upload-complete", { id: s.id, title });
    const id = done?.id ?? s.id;
    const [clip] = await waitAll([id], 6);
    if (clip?.status === "error") throw new SunoError("Suno で音源を読み込めませんでした");
    return id;
  }

  async function uploadMidi(file, name) {
    const s = await call("midi-upload-create", {});
    const uploadId = s?.midi_upload_id ?? s?.id;
    if (!s?.upload_url || !uploadId) throw new SunoError("Suno の MIDI アップロード先をもらえませんでした");
    const form = new FormData();
    for (const [k, v] of Object.entries(s.upload_fields ?? {})) form.append(k, String(v));
    form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/midi" }), name);
    const res = await doFetch(s.upload_url, { method: "POST", body: form });
    if (!res.ok) throw new SunoError(`Suno に MIDI を送れませんでした(${res.status})`);
    const done = await call("midi-upload-complete", { id: uploadId });
    return done?.midi_upload_id ?? uploadId;
  }

  /**
   * Start a job in the background. spec: { projectId, action: "cover"|"extend"|"midi",
   *   source: { kind: "file"|"midi"|"clip", path?, name, clipId? }, style?, lyrics?, description?, continueAt?, instrumental? }
   */
  function startJob(spec) {
    const job = saveJob({
      id: newId(),
      projectId: spec.projectId,
      action: spec.action,
      sourceName: spec.source.name,
      style: spec.style ?? "",
      description: spec.description ?? "",
      status: "uploading",
      clips: [],
      stems: {},
      createdAt: now(),
    });
    running.add(job.id);
    void (async () => {
      try {
        let created;
        if (spec.action === "midi") {
          const midiId = await uploadMidi(spec.source.path, spec.source.name);
          patchJob(job.id, (j) => ({ ...j, status: "generating" }));
          created = await call("audio-create", {
            midi_upload_id: midiId,
            ...(spec.description ? { description: spec.description } : {}),
            ...(spec.title ? { title: spec.title } : {}),
          });
        } else {
          const sourceId = spec.source.kind === "clip" ? spec.source.clipId : await uploadAudio(spec.source.path, spec.source.name.replace(/\.[^.]+$/, ""));
          patchJob(job.id, (j) => ({ ...j, status: "generating", sourceClipId: sourceId }));
          if (spec.action === "cover") {
            created = await call("audio-covers-create", {
              id: sourceId,
              ...(spec.style ? { style: spec.style } : {}),
              ...(spec.lyrics ? { lyrics: spec.lyrics } : {}),
            });
          } else {
            created = await call("audio-extensions-create", {
              id: sourceId,
              continue_at: Math.max(0.4, Number(spec.continueAt) || 30),
              ...(spec.style ? { style: spec.style } : {}),
              ...(spec.lyrics ? { lyrics: spec.lyrics } : {}),
              ...(spec.instrumental ? { instrumental: true } : {}),
            });
          }
        }
        let ids = idsOf(created);
        if (!ids.length) throw new SunoError("Suno から曲の ID が返ってきませんでした");
        patchJob(job.id, (j) => ({ ...j, clips: ids.map((id) => ({ id, title: "", status: "queued" })) }));
        let clips = await waitAll(ids);
        // An extension holds only the continuation: join each one with what it continues.
        if (spec.action === "extend") {
          const joined = [];
          for (const c of clips.filter((x) => x.status === "complete")) {
            const full = await call("audio-full-song", { id: c.id });
            if (full?.id) joined.push(full.id);
          }
          if (joined.length) {
            ids = joined;
            clips = await waitAll(joined, 8);
          }
        }
        patchJob(job.id, (j) => ({
          ...j,
          status: clips.some((c) => c.status === "complete") ? "done" : "error",
          clips: clips.map(clipOf),
          error: clips.every((c) => c.status === "error") ? "Suno で曲を作れませんでした" : undefined,
        }));
      } catch (err) {
        patchJob(job.id, (j) => ({ ...j, status: "error", error: err.message, needLogin: Boolean(err.needLogin) }));
      } finally {
        running.delete(job.id);
      }
    })();
    return job;
  }

  /** Save one clip (a result or a stem) as WAV/MP3 into the song's files. */
  async function download(projectId, clipId, { format = "wav", confirm = false, name } = {}) {
    let r;
    for (let i = 0; i < 4; i++) {
      r = await call("audio-download", { id: clipId, format, ...(confirm ? { confirm: true } : {}) });
      if (r?.status !== "processing" && r?.state !== "processing") break;
    }
    if (r?.status === "requires_credit" || r?.requires_credit) return { requiresCredit: true, detail: r?.message ?? "" };
    if (!r?.url) throw new SunoError("Suno からダウンロード先をもらえませんでした");
    const res = await doFetch(r.url);
    if (!res.ok) throw new SunoError(`Suno からダウンロードできませんでした(${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    const base = (name || r.title || clipId).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    return { file: opts.addFile(projectId, `${base}.${format}`, data, "other") };
  }

  function startStems(jobId, clipId, mode) {
    const job = getJob(jobId);
    if (!job) throw new SunoError("見つかりません", { status: 404 });
    patchJob(jobId, (j) => ({ ...j, stems: { ...j.stems, [clipId]: { mode, status: "pending", items: [] } } }));
    const key = `${jobId}:${clipId}`;
    running.add(key);
    void (async () => {
      try {
        const g = await call("audio-stems-create", { id: clipId, mode, idempotency_key: `${jobId}-${clipId}-${mode}` });
        const groupId = g?.id ?? g?.group_id;
        let r = g;
        const end = Date.now() + 10 * 60_000;
        while (r?.status === "pending" && Date.now() < end) {
          await new Promise((ok) => setTimeout(ok, 8000));
          r = await call("audio-stems-retrieve", { id: clipId, group_id: groupId });
        }
        const items = (r?.stems ?? []).map((s) => ({
          id: s.audio_id ?? s.id,
          name: s.name ?? s.stem ?? s.part ?? s.type ?? "stem",
          take: s.take ?? null,
          status: s.status ?? "",
        }));
        patchJob(jobId, (j) => ({ ...j, stems: { ...j.stems, [clipId]: { mode, groupId, status: r?.status ?? "error", items } } }));
      } catch (err) {
        patchJob(jobId, (j) => ({ ...j, stems: { ...j.stems, [clipId]: { mode, status: "error", items: [], error: err.message } } }));
      } finally {
        running.delete(key);
      }
    })();
  }

  // ---- routes (under /api, session cookie already checked) ----
  const router = express.Router();
  const fail = (res, err) => res.status(err instanceof SunoError ? err.status : 500).json({ error: err.message, needLogin: Boolean(err.needLogin) });

  router.get("/suno/status", async (_req, res) => {
    if (!box.open(store.kvGet(KV_TOKENS))) return res.json({ connected: false });
    try {
      res.json({ connected: true, usage: await call("account-usage") });
    } catch (err) {
      if (err.needLogin) return res.json({ connected: false });
      res.json({ connected: true, error: err.message });
    }
  });
  router.post("/suno/login", async (_req, res) => {
    try {
      const url = await loginUrl();
      opts.openExternal?.(url);
      res.json({ url });
    } catch (err) {
      fail(res, err);
    }
  });
  router.post("/suno/logout", (_req, res) => {
    store.kvSet(KV_TOKENS, null);
    mcpSession = null;
    res.json({ ok: true });
  });
  /** Jobs left unfinished when the app was closed: pick up their clips' state from Suno. */
  async function recover(job) {
    const waiting = ["uploading", "generating"].includes(job.status) && !running.has(job.id);
    if (!waiting) return job;
    if (!job.clips?.length) return patchJob(job.id, (j) => ({ ...j, status: "error", error: "アプリを閉じたため中断しました" }));
    try {
      const clips = [];
      for (const c of job.clips) clips.push(clipOf(await call("audio-retrieve", { id: c.id })));
      const done = clips.every((c) => settled(c.status));
      return patchJob(job.id, (j) => ({ ...j, clips, status: done ? (clips.some((c) => c.status === "complete") ? "done" : "error") : j.status }));
    } catch {
      return job;
    }
  }
  router.get("/projects/:id/suno/jobs", async (req, res) => {
    const items = [];
    for (const j of jobs().filter((x) => x.projectId === req.params.id)) items.push(await recover(j));
    res.json({ items });
  });
  router.delete("/suno/jobs/:jobId", (req, res) => {
    store.kvSet(KV_JOBS, jobs().filter((j) => j.id !== req.params.jobId));
    res.json({ ok: true });
  });
  router.post("/projects/:id/suno/jobs", (req, res) => {
    const b = req.body ?? {};
    const action = ["cover", "extend", "midi"].includes(b.action) ? b.action : null;
    if (!action) return res.status(400).json({ error: "何をするかを選んでください" });
    let source;
    if (b.fileId) {
      const f = store.db.prepare("SELECT * FROM files WHERE id = ? AND project_id = ?").get(String(b.fileId), req.params.id);
      if (!f) return res.status(404).json({ error: "音源が見つかりません" });
      source = { kind: "file", path: opts.filePath(f), name: f.original_name };
    } else if (b.midiClipId) {
      const c = store.db.prepare("SELECT * FROM midi_clips WHERE id = ?").get(String(b.midiClipId));
      if (!c) return res.status(404).json({ error: "MIDI が見つかりません" });
      source = { kind: "midi", path: opts.midiPath(c.id), name: `${c.name}.mid` };
    } else if (b.clipId) {
      source = { kind: "clip", clipId: String(b.clipId), name: String(b.clipName ?? "Suno の曲").slice(0, 200) };
    } else return res.status(400).json({ error: "元にする音源か MIDI を選んでください" });
    if (action === "midi" && source.kind !== "midi") return res.status(400).json({ error: "MIDI から曲を作るときは MIDI を選んでください" });
    if (action !== "midi" && source.kind === "midi") return res.status(400).json({ error: "カバー・続きは音源から作ります" });
    const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const job = startJob({
      projectId: req.params.id,
      action,
      source,
      style: text(b.style, 1000),
      lyrics: text(b.lyrics, 5000),
      description: text(b.description, 3000),
      continueAt: Number(b.continueAt),
      instrumental: Boolean(b.instrumental),
    });
    res.status(202).json(job);
  });
  router.post("/suno/jobs/:jobId/clips/:clipId/download", async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "見つかりません" });
    try {
      const fmt = req.body?.format === "mp3" ? "mp3" : "wav";
      res.json(await download(job.projectId, req.params.clipId, { format: fmt, confirm: req.body?.confirm === true, name: typeof req.body?.name === "string" ? req.body.name : undefined }));
    } catch (err) {
      fail(res, err);
    }
  });
  router.post("/suno/jobs/:jobId/clips/:clipId/stems", (req, res) => {
    try {
      startStems(req.params.jobId, req.params.clipId, req.body?.mode === "twelve" ? "twelve" : "two");
      res.status(202).json(getJob(req.params.jobId));
    } catch (err) {
      fail(res, err);
    }
  });

  /** GET /suno/callback (outside /api: the browser that signs in has no app cookie). */
  async function callback(req, res) {
    const page = (title, msg) =>
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:-apple-system,sans-serif;padding:48px;text-align:center"><h2>${title}</h2><p>${msg}</p></body>`;
    try {
      if (req.query.error) throw new SunoError(String(req.query.error_description ?? req.query.error));
      await finishLogin(String(req.query.code ?? ""), String(req.query.state ?? ""));
      res.type("html").send(page("Suno に接続しました", "Session Partner に戻ってください。このタブは閉じて大丈夫です。"));
    } catch (err) {
      res.status(400).type("html").send(page("Suno に接続できませんでした", String(err.message).replace(/</g, "&lt;")));
    }
  }

  return { router, callback, call };
}

module.exports = { createSuno, SunoError };
