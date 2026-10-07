// Production flow: app preferences, AI (Claude Code on the subscription) and the MIDI library.
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Midi } = require("@tonejs/midi");
const { newId, now } = require("./db");
const ai = require("./ai");
const { cachedMixTipsText } = require("./notion");

const PREFS_KEY = "prefs";
const DEFAULT_PREFS = {
  gate: "hard", // hard: a stage can't be left until its checklist is done | soft: allowed, but recorded
  timebox: { 1: 30, 2: 90, 3: 120, 4: 60 }, // minutes per stage (SHIP has none)
  autoLayout: false, // switch the side panes when the stage changes (off: panes stay as they are)
  aiModel: "claude",
};

const STAGES = {
  1: { en: "DECODE", jp: "リファレンス解析", goal: "先方のリファレンスのどこを活かすべきかを言葉にし、ビート・構成・テンポを掴み、参考曲を 3 曲そろえる" },
  2: {
    en: "FRAME",
    jp: "骨組み",
    goal: "構成・何から始めるか・コード進行を決め、ドラム・ベース・ギターかピアノを仮でもいいので早く決め切る。ミックスや細かい音作りには進まない",
  },
  3: { en: "LAYER", jp: "肉付け", goal: "上物(ギター・ストリングス・ピアノ・ブラス・FX など)を、どの参考曲のどこを活かすか決めて足していく。ミックスはまだ" },
  4: { en: "MIXING", jp: "ミックス", goal: "細かい音作りと全体のミックス。本人の Mixing Tips に沿って、書き出し前チェックリストを全部満たす" },
  5: { en: "SHIP", jp: "書き出し・提出", goal: "mp3 で書き出してアプリに入れ、提出して完了" },
};

const MIDI_KINDS = ["drums", "bass", "piano", "guitar", "strings", "brass", "synth", "chords", "melody", "other"];
const MAX_MIDI_BYTES = 5 * 1024 * 1024;
const PPQ = 480;

const str = (v, max = 20_000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const parseFlow = (p) => {
  try {
    return JSON.parse(p.flow || "{}");
  } catch {
    return {};
  }
};

/** Plain-text summary of a song for the AI. Key is shown but explicitly not to be weighed. */
function songContext(db, project) {
  const f = parseFlow(project);
  const client = project.client_id ? db.prepare("SELECT name FROM clients WHERE id = ?").get(project.client_id)?.name : null;
  const lines = [`曲名: ${project.name}`, `取引先: ${client ?? "なし"}`, `今のステージ: ${project.stage} ${STAGES[project.stage]?.en ?? ""}`];
  if (project.brief?.trim()) lines.push(`\n【先方からの指示】\n${project.brief.trim().slice(0, 4000)}`);
  if (f.mission) lines.push(`\n【先方が本当に欲しいもの(こちらの解釈)】${f.mission}`);
  const refs = (f.refs ?? []).filter((r) => r && (r.title || r.artist));
  if (refs.length) {
    lines.push("\n【参考曲】");
    refs.forEach((r, i) => {
      const meta = [r.bpm && `BPM ${r.bpm}`, r.key && `Key ${r.key}(参考表示のみ・考慮不要)`].filter(Boolean).join(" / ");
      lines.push(`${"ABCDEFG"[i]}: ${r.title || "?"} — ${r.artist || "?"}${meta ? `(${meta})` : ""}${r.use ? `\n   活かす所: ${r.use}` : ""}`);
    });
  }
  const a = f.analysis ?? {};
  if (a.bpm || a.beat || a.form) lines.push(`\n【分析】テンポ: ${a.bpm || "未定"} / ビート: ${a.beat || "-"} / 構成: ${a.form || "-"}`);
  if (f.structure?.length) lines.push(`\n【構成】${f.structure.map((s) => `${s.name}(${s.bars}小節)`).join(" → ")}`);
  if (f.startWith) lines.push(`最初に作るパート: ${f.startWith}`);
  const chords = (f.chords ?? []).filter((c) => c.prog);
  if (chords.length) lines.push(`【コード進行】\n${chords.map((c) => `${c.section}: ${c.prog}`).join("\n")}`);
  const core = f.core ?? {};
  const coreLines = Object.entries(core)
    .filter(([, c]) => c && (c.ref || c.point || c.done))
    .map(([k, c]) => `${k}${c.inst ? `(${c.inst})` : ""}: ${c.done ? "仮決め済み" : "未定"}${c.ref ? ` / 参考 ${c.ref}` : ""}${c.point ? ` ${c.point}` : ""}`);
  if (coreLines.length) lines.push(`【核パート】\n${coreLines.join("\n")}`);
  const parts = (f.parts ?? []).filter((p) => p.name);
  if (parts.length) lines.push(`【上物】\n${parts.map((p) => `${p.name}: ${p.done ? "済" : "未"}${p.ref ? ` / 参考 ${p.ref}` : ""}${p.point ? ` ${p.point}` : ""}`).join("\n")}`);
  const note = f.notes?.[project.stage];
  if (note?.trim()) lines.push(`\n【このステージの本人メモ】\n${note.trim().slice(0, 3000)}`);
  return lines.join("\n");
}

function systemFor(stage, extra = "") {
  const s = STAGES[stage] ?? STAGES[1];
  return [
    "あなたは音楽プロデューサー/作編曲家の相棒「Session Partner」です。日本語で、短く具体的に答えます。",
    "あなたは音源を聴けません。曲名・アーティスト名からの一般的な知識と、本人が書いたメモ・数値だけを根拠にしてください。知らない曲は知らないと言い、でっち上げない。",
    "キー(調)は比較や関連性の判断に使わないでください(本人の方針)。",
    `いまは STAGE ${stage} ${s.en}(${s.jp})。このステージの目的: ${s.goal}。`,
    "目的から外れた作業(例: 骨組みの段階でのミックスや音作りへの深入り)に話が逸れたら、一言で引き戻し、後のステージに回すよう勧めてください。",
    "答えは箇条書き中心、最後に「次にやること」を 1〜3 個。",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}

function createFlowRouter(store) {
  const { db, midiDir } = store;
  const router = express.Router();

  const prefs = () => {
    const saved = store.kvGet(PREFS_KEY) ?? {};
    // "autoLayout" used to default to on; only an explicit choice made since (autoLayoutOn) counts now.
    const { autoLayout: _old, autoLayoutOn, ...rest } = saved;
    return { ...DEFAULT_PREFS, ...rest, autoLayout: autoLayoutOn === true, timebox: { ...DEFAULT_PREFS.timebox, ...(saved.timebox ?? {}) } };
  };
  const getProject = (id) => db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  function loadProject(req, res, next) {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ error: "曲が見つかりません" });
    res.locals.project = p;
    next();
  }
  const aiError = (res, err) => res.status(err instanceof ai.AiError ? 502 : 500).json({ error: err.message || "AI でエラーが起きました" });
  /** Abort the claude process if the window closes / the user cancels. */
  const abortOnClose = (req, res) => {
    const ctl = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) ctl.abort();
    });
    return ctl.signal;
  };

  // ---- preferences ----
  router.get("/prefs", (_req, res) => res.json(prefs()));
  router.put("/prefs", (req, res) => {
    const b = req.body ?? {};
    const next = prefs();
    if (b.gate === "hard" || b.gate === "soft") next.gate = b.gate;
    if (typeof b.autoLayout === "boolean") next.autoLayout = b.autoLayout;
    if (ai.MODELS.includes(b.aiModel)) next.aiModel = b.aiModel;
    if (b.timebox && typeof b.timebox === "object") {
      for (const k of ["1", "2", "3", "4"]) {
        const v = Number(b.timebox[k]);
        if (Number.isFinite(v) && v >= 0 && v <= 24 * 60) next.timebox[k] = Math.round(v);
      }
    }
    const { autoLayout, ...rest } = next;
    store.kvSet(PREFS_KEY, { ...rest, autoLayoutOn: autoLayout });
    res.json(next);
  });

  // ---- the pre-export checklist (shared by every song; ticks are per song) ----
  const MIX_LIST_KEY = "mixChecklist";
  // A memo that isn't tied to any song (the memo dock on home / clients / MIDI / settings).
  router.get("/scratch", (_req, res) => res.json({ text: store.kvGet("scratch") ?? "" }));
  router.put("/scratch", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 200_000) : "";
    store.kvSet("scratch", text);
    res.json({ text });
  });
  router.get("/mix-checklist", (_req, res) => res.json({ items: store.kvGet(MIX_LIST_KEY) ?? null }));
  router.put("/mix-checklist", (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .slice(0, 300)
      .map((it) => ({
        id: str(it?.id, 100) ?? "",
        text: str(it?.text, 500)?.trim() ?? "",
        ...(typeof it?.origin === "string" ? { origin: it.origin.slice(0, 500) } : {}),
        ...(it?.deleted ? { deleted: true } : {}),
      }))
      .filter((it) => it.id && it.text);
    store.kvSet(MIX_LIST_KEY, items);
    res.json({ items });
  });

  // ---- AI ----
  router.get("/ai/status", async (_req, res) => res.json(await ai.status()));

  const serializeMsg = (m) => ({ id: m.id, stage: m.stage, role: m.role, text: m.text, createdAt: m.created_at });

  router.get("/projects/:id/ai", loadProject, (req, res) => {
    const stage = Number(req.query.stage) || res.locals.project.stage;
    const rows = db.prepare("SELECT * FROM ai_messages WHERE project_id = ? AND stage = ? ORDER BY created_at").all(req.params.id, stage);
    res.json({ items: rows.map(serializeMsg) });
  });

  router.delete("/projects/:id/ai", loadProject, (req, res) => {
    db.prepare("DELETE FROM ai_messages WHERE project_id = ? AND stage = ?").run(req.params.id, Number(req.query.stage) || 0);
    res.json({ ok: true });
  });

  /** Chat turn. Streams NDJSON: {type:"text",text} … then {type:"done",message} or {type:"error",error}. */
  router.post("/projects/:id/ai", loadProject, async (req, res) => {
    const p = res.locals.project;
    const text = str(req.body?.text, 8000)?.trim();
    const stage = Number(req.body?.stage) || p.stage;
    if (!text) return res.status(400).json({ error: "メッセージを入力してください" });
    const history = db.prepare("SELECT * FROM ai_messages WHERE project_id = ? AND stage = ? ORDER BY created_at DESC LIMIT 16").all(p.id, stage).reverse();
    const userMsg = { id: newId(), project_id: p.id, stage, role: "user", text, created_at: now() };
    db.prepare("INSERT INTO ai_messages (id, project_id, stage, role, text, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      ...Object.values(userMsg),
    );

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (o) => res.write(`${JSON.stringify(o)}\n`);
    send({ type: "user", message: serializeMsg(userMsg) });

    const convo = history.map((m) => `【${m.role === "user" ? "本人" : "Session Partner"}】\n${m.text.slice(0, 4000)}`).join("\n\n");
    const extra = stage === 4 ? mixTipsNote(store) : "";
    const prompt = `${songContext(db, { ...p, stage })}\n\n${convo ? `--- これまでの会話 ---\n${convo}\n\n` : ""}--- 本人の発言 ---\n${text}`;
    try {
      const out = await ai.run({ system: systemFor(stage, extra), prompt, model: prefs().aiModel, onText: (t) => send({ type: "text", text: t }), signal: abortOnClose(req, res) });
      const reply = { id: newId(), project_id: p.id, stage, role: "assistant", text: out.text.trim() || "(返事が空でした)", created_at: now() };
      db.prepare("INSERT INTO ai_messages (id, project_id, stage, role, text, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(...Object.values(reply));
      send({ type: "done", message: serializeMsg(reply) });
    } catch (err) {
      send({ type: "error", error: err.message });
    }
    res.end();
  });

  /** Songs that are musically close to the references (Claude's knowledge; key ignored). */
  router.post("/projects/:id/ai/similar", loadProject, async (req, res) => {
    const p = res.locals.project;
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              artist: { type: "string" },
              year: { type: "string" },
              bpm: { type: "string", description: "おおよそのテンポ。わからなければ空" },
              why: { type: "string", description: "どこが近いか(日本語・40字以内)" },
              tags: { type: "array", items: { type: "string" }, description: "近い要素: ビート/テンポ/構成/音色/年代/ジャンル など 1〜3 個" },
              match: { type: "integer", description: "近さ 0-100" },
            },
            required: ["title", "artist", "why", "tags", "match"],
          },
        },
      },
      required: ["items"],
    };
    const focus = str(req.body?.focus, 500)?.trim();
    const prompt =
      `${songContext(db, p)}\n\n` +
      "上の参考曲・先方の指示に音楽的に近い、実在する曲を 8 曲挙げてください。" +
      "ビート感・テンポ・構成・音色・アレンジの手法・年代感で近いものを優先し、キー(調)は考慮しないでください。" +
      "すでに参考曲に入っている曲は除く。確実に実在する曲だけ。" +
      (focus ? `\n特に重視すること: ${focus}` : "");
    try {
      const out = await ai.run({ system: systemFor(1), prompt, schema, model: prefs().aiModel, signal: abortOnClose(req, res) });
      // Claude sometimes repeats a song that's already a reference; drop those.
      const norm = (t) => String(t ?? "").toLowerCase().replace(/[\s・'’"()（）「」-]/g, "");
      const have = new Set((parseFlow(p).refs ?? []).map((r) => norm(r?.title)).filter(Boolean));
      const items = (out.structured?.items ?? []).filter((it) => !have.has(norm(it.title))).slice(0, 12);
      res.json({ items, at: now() });
    } catch (err) {
      aiError(res, err);
    }
  });

  /** A style prompt for Suno (waveform generation happens on suno.com in the side pane). */
  router.post("/projects/:id/ai/suno", loadProject, async (req, res) => {
    const p = res.locals.project;
    const schema = {
      type: "object",
      properties: {
        style: { type: "string", description: "Suno の Style 欄に入れる英語のタグ列(カンマ区切り・180 文字以内)" },
        exclude: { type: "string", description: "Exclude styles に入れる英語(なければ空)" },
        note: { type: "string", description: "使い方のひとこと(日本語)" },
      },
      required: ["style", "exclude", "note"],
    };
    const part = str(req.body?.part, 300)?.trim();
    const prompt =
      `${songContext(db, p)}\n\n` +
      `Suno でこの曲の${part ? `「${part}」の` : ""}素材(インスト)を作るためのスタイル指定を作ってください。` +
      "ジャンル・テンポ(BPM)・ビート感・主要楽器・ムードを短い英語タグで。アーティスト名は入れない(Suno が弾くため)。";
    try {
      const out = await ai.run({ system: systemFor(p.stage), prompt, schema, model: prefs().aiModel, signal: abortOnClose(req, res) });
      res.json(out.structured);
    } catch (err) {
      aiError(res, err);
    }
  });

  // ---- MIDI library ----
  const midiPath = (id) => path.join(midiDir, `${id}.mid`);
  const getClip = (id) =>
    db.prepare("SELECT m.*, p.name AS project_name FROM midi_clips m LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?").get(id);
  const serializeClip = (c) => {
    let data = {};
    try {
      data = JSON.parse(c.data);
    } catch {
      /* broken row */
    }
    return {
      id: c.id,
      projectId: c.project_id,
      projectName: c.project_name ?? null,
      name: c.name,
      kind: c.kind,
      bpm: c.bpm,
      bars: c.bars,
      source: c.source,
      prompt: c.prompt,
      tracks: data.tracks ?? [],
      createdAt: c.created_at,
      fileUrl: `/api/midi/${c.id}/file`,
    };
  };
  const insertClip = (clip) => {
    db.prepare(
      "INSERT INTO midi_clips (id, project_id, name, kind, bpm, bars, data, source, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(clip.id, clip.project_id, clip.name, clip.kind, clip.bpm, clip.bars, clip.data, clip.source, clip.prompt, clip.created_at);
    return serializeClip(getClip(clip.id));
  };

  /** ?project=<id> for one song's clips; ?q= / ?kind= to filter the whole library. */
  router.get("/midi", (req, res) => {
    const where = [];
    const args = [];
    if (typeof req.query.project === "string" && req.query.project) {
      where.push("m.project_id = ?");
      args.push(req.query.project);
    }
    if (MIDI_KINDS.includes(req.query.kind)) {
      where.push("m.kind = ?");
      args.push(req.query.kind);
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      where.push("(m.name LIKE ? OR m.prompt LIKE ? OR p.name LIKE ?)");
      const q = `%${req.query.q.trim()}%`;
      args.push(q, q, q);
    }
    const rows = db
      .prepare(
        `SELECT m.*, p.name AS project_name FROM midi_clips m LEFT JOIN projects p ON p.id = m.project_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY m.created_at DESC LIMIT 500`,
      )
      .all(...args);
    res.json({ items: rows.map(serializeClip) });
  });

  router.get("/midi/:clipId/file", (req, res) => {
    const c = getClip(req.params.clipId);
    if (!c || !fs.existsSync(midiPath(c.id))) return res.status(404).json({ error: "not found" });
    const name = `${c.name.replace(/[\\/:*?"<>|]/g, "_")}.mid`;
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(midiPath(c.id), { headers: { "Content-Type": "audio/midi" } });
  });

  router.patch("/midi/:clipId", (req, res) => {
    const c = getClip(req.params.clipId);
    if (!c) return res.status(404).json({ error: "not found" });
    const name = str(req.body?.name, 200)?.trim();
    if (name) db.prepare("UPDATE midi_clips SET name = ? WHERE id = ?").run(name, c.id);
    if (MIDI_KINDS.includes(req.body?.kind)) db.prepare("UPDATE midi_clips SET kind = ? WHERE id = ?").run(req.body.kind, c.id);
    if (req.body?.projectId === null) db.prepare("UPDATE midi_clips SET project_id = NULL WHERE id = ?").run(c.id);
    res.json(serializeClip(getClip(c.id)));
  });

  router.delete("/midi/:clipId", (req, res) => {
    db.prepare("DELETE FROM midi_clips WHERE id = ?").run(req.params.clipId);
    fs.rmSync(midiPath(req.params.clipId), { force: true });
    res.json({ ok: true });
  });

  /** Use a library clip in another song (a copy, so each song keeps its own). Body: { projectId } */
  router.post("/midi/:clipId/copy", (req, res) => {
    const c = getClip(req.params.clipId);
    const target = typeof req.body?.projectId === "string" ? getProject(req.body.projectId) : null;
    if (!c || !target) return res.status(404).json({ error: "not found" });
    const id = newId();
    fs.copyFileSync(midiPath(c.id), midiPath(id));
    const { project_name: _, ...row } = c;
    res.status(201).json(insertClip({ ...row, id, project_id: target.id, created_at: now() }));
  });

  /** Upload a .mid file (raw body, ?name=&project=&kind=). */
  router.put("/midi", async (req, res, next) => {
    try {
      const name = str(req.query.name, 300)?.trim() || "MIDI";
      if (!/\.midi?$/i.test(name)) return res.status(400).json({ error: "MIDI ファイル(.mid)を選んでください" });
      const project = typeof req.query.project === "string" && req.query.project ? getProject(req.query.project) : null;
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_MIDI_BYTES) return res.status(413).json({ error: "MIDI ファイルが大きすぎます" });
        chunks.push(chunk);
      }
      const buf = Buffer.concat(chunks);
      let parsed;
      try {
        parsed = fromMidiFile(buf);
      } catch {
        return res.status(400).json({ error: "MIDI ファイルを読み取れませんでした" });
      }
      const id = newId();
      fs.writeFileSync(midiPath(id), buf);
      const kind = MIDI_KINDS.includes(req.query.kind)
        ? req.query.kind
        : parsed.tracks.length === 1
          ? classifyTrack({ ...parsed.tracks[0], name: `${parsed.tracks[0].name} ${name}` })
          : guessKind(parsed.tracks);
      res.status(201).json(
        insertClip({
          id,
          project_id: project?.id ?? null,
          name: name.replace(/\.midi?$/i, ""),
          kind,
          bpm: parsed.bpm,
          bars: parsed.bars,
          data: JSON.stringify({ tracks: parsed.tracks }),
          source: "upload",
          prompt: "",
          created_at: now(),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /** Save MIDI made in the app (chord-based generation, humanize). Body: { projectId?, name, kind, bpm, bars, tracks } */
  router.post("/midi", (req, res) => {
    const b = req.body ?? {};
    const bpm = Math.max(20, Math.min(400, Number(b.bpm) || 120));
    const bars = Math.max(1, Math.min(512, Math.round(Number(b.bars) || 1)));
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 16).map((t, i) => ({
      name: String(t?.name ?? `Track ${i + 1}`).slice(0, 60),
      channel: Number(t?.channel) === 9 ? 9 : 0,
      notes: normalizeTracks([{ notes: t?.notes, drums: Number(t?.channel) === 9 }], bars * 4)[0].notes,
    }));
    if (!tracks.some((t) => t.notes.length)) return res.status(400).json({ error: "ノートがありません" });
    const project = typeof b.projectId === "string" ? getProject(b.projectId) : null;
    const id = newId();
    fs.writeFileSync(midiPath(id), toMidiFile(tracks, bpm));
    res.status(201).json(
      insertClip({
        id,
        project_id: project?.id ?? null,
        name: str(b.name, 200)?.trim() || "MIDI",
        kind: MIDI_KINDS.includes(b.kind) ? b.kind : guessKind(tracks),
        bpm,
        bars,
        data: JSON.stringify({ tracks }),
        source: str(b.source, 20) === "ai" ? "ai" : "upload",
        prompt: str(b.prompt, 500) ?? "",
        created_at: now(),
      }),
    );
  });

  /**
   * A whole song's MIDI (raw body, ?name=&project=): split into one clip per instrument (from track
   * names / channels), all aligned to bar 1. Returns the clips plus every track for analysis.
   */
  router.put("/midi/import", async (req, res, next) => {
    try {
      const fileName = str(req.query.name, 300)?.trim() || "song.mid";
      if (!/\.midi?$/i.test(fileName)) return res.status(400).json({ error: "MIDI ファイル(.mid)を選んでください" });
      const project = typeof req.query.project === "string" && req.query.project ? getProject(req.query.project) : null;
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_MIDI_BYTES * 4) return res.status(413).json({ error: "MIDI ファイルが大きすぎます" });
        chunks.push(chunk);
      }
      let parsed;
      try {
        parsed = fromMidiFile(Buffer.concat(chunks));
      } catch {
        return res.status(400).json({ error: "MIDI ファイルを読み取れませんでした" });
      }
      const bpm = parsed.bpm || 120;
      const base = project?.name || fileName.replace(/\.midi?$/i, "");
      // Same-instrument tracks with the same name are kept together (e.g. a split drum kit stays one clip).
      const groups = new Map();
      for (const t of parsed.tracks) {
        const kind = classifyTrack(t);
        const key = kind === "drums" ? "drums" : `${kind}:${t.name}`;
        if (!groups.has(key)) groups.set(key, { kind, name: kind === "drums" ? "Drums" : t.name, tracks: [] });
        groups.get(key).tracks.push(t);
      }
      const clips = [];
      for (const g of groups.values()) {
        const id = newId();
        fs.writeFileSync(midiPath(id), toMidiFile(g.tracks, bpm));
        clips.push(
          insertClip({
            id,
            project_id: project?.id ?? null,
            name: `${base} · ${g.name}`,
            kind: g.kind,
            bpm,
            bars: parsed.bars,
            data: JSON.stringify({ tracks: g.tracks }),
            source: "upload",
            prompt: fileName,
            created_at: now(),
          }),
        );
      }
      res.status(201).json({ bpm: parsed.bpm, bars: parsed.bars, clips, tracks: parsed.tracks.map((t) => ({ ...t, kind: classifyTrack(t) })) });
    } catch (err) {
      next(err);
    }
  });

  /** Generate MIDI with Claude. Body: { kind, bars, prompt, section?, refClipId? } */
  router.post("/projects/:id/ai/midi", loadProject, async (req, res) => {
    const p = res.locals.project;
    const kind = MIDI_KINDS.includes(req.body?.kind) ? req.body.kind : "chords";
    const bars = Math.max(1, Math.min(16, Number(req.body?.bars) || 4));
    const ask = str(req.body?.prompt, 2000)?.trim() ?? "";
    const section = str(req.body?.section, 100)?.trim() ?? "";
    const ref = typeof req.body?.refClipId === "string" ? getClip(req.body.refClipId) : null;
    const flow = parseFlow(p);
    const bpm = Number(String(flow.analysis?.bpm ?? "").match(/\d+(\.\d+)?/)?.[0]) || 120;
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "クリップ名(日本語可・短く)" },
        comment: { type: "string", description: "狙いのひとこと(日本語)" },
        tracks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              drums: { type: "boolean", description: "ドラムなら true(General MIDI のドラムマップ・チャンネル 10)" },
              notes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    p: { type: "integer", description: "MIDI ノート番号 0-127" },
                    s: { type: "number", description: "開始位置(拍・4分音符=1、0 始まり)" },
                    d: { type: "number", description: "長さ(拍)" },
                    v: { type: "integer", description: "ベロシティ 1-127" },
                  },
                  required: ["p", "s", "d", "v"],
                },
              },
            },
            required: ["name", "drums", "notes"],
          },
        },
      },
      required: ["name", "comment", "tracks"],
    };
    const KIND_HINT = {
      drums: "ドラムパターン。GM ドラムマップ(36 キック, 38 スネア, 42 クローズドハット, 46 オープンハット, 49 クラッシュ, 51 ライド, 45/47/50 タム)。人間らしいベロシティの揺れを付ける",
      bass: "ベースライン(E1〜G3 あたり)",
      piano: "ピアノ(両手・C2〜C6)。コード進行に沿ったバッキング",
      guitar: "ギター(E2〜E5・ギターで弾けるボイシング)。コード進行に沿ったバッキング/リフ",
      strings: "ストリングス(C3〜C6・白玉や対旋律)",
      brass: "ブラス(C3〜C6・キメやヒット)",
      synth: "シンセ(パッド/リード/アルペジオ)",
      chords: "コード(ボイシング込み・C3〜C5 あたり)。コード進行が決まっていればそれに従う",
      melody: "メロディ/リフ(上物)",
      other: "フレーズ",
    };
    const refNote = ref ? referenceNote(serializeClip(ref)) : "";
    const prompt =
      `${songContext(db, p)}\n\n` +
      `この曲用の MIDI を作ってください。種類: ${KIND_HINT[kind]}。長さ: ${bars} 小節(4/4・合計 ${bars * 4} 拍)。テンポ: ${bpm}。` +
      (section ? `セクション: ${section}。` : "") +
      (ask ? `\n本人の希望: ${ask}` : "") +
      refNote +
      "\nすべてのノートは 0 以上 " + bars * 4 + " 拍未満に収めること。DAW に貼ってそのまま使える、音楽的に自然なものを。";
    try {
      const out = await ai.run({ system: systemFor(p.stage), prompt, schema, model: prefs().aiModel, signal: abortOnClose(req, res) });
      const tracks = normalizeTracks(out.structured?.tracks, bars * 4);
      if (!tracks.some((t) => t.notes.length)) throw new ai.AiError("ノートが 1 つもない MIDI が返ってきました。もう一度試してください");
      const id = newId();
      fs.writeFileSync(midiPath(id), toMidiFile(tracks, bpm));
      res.status(201).json({
        clip: insertClip({
          id,
          project_id: p.id,
          name: str(out.structured?.name, 200)?.trim() || `${kind} ${bars}小節`,
          kind,
          bpm,
          bars,
          data: JSON.stringify({ tracks }),
          source: "ai",
          prompt: [section, ask, ref && `参考: ${ref.name}`].filter(Boolean).join(" / "),
          created_at: now(),
        }),
        comment: str(out.structured?.comment, 1000) ?? "",
      });
    } catch (err) {
      aiError(res, err);
    }
  });

  return router;
}

function mixTipsNote(store) {
  const tips = cachedMixTipsText(store);
  return tips ? `\n本人の Mixing Tips(Notion)の要点。これに沿って助言する:\n${tips.slice(0, 5000)}` : "";
}

// ---- MIDI conversion (beats ⇄ ticks) ----

function normalizeTracks(raw, maxBeats) {
  return (Array.isArray(raw) ? raw : []).slice(0, 8).map((t, i) => {
    const drums = Boolean(t?.drums);
    const notes = (Array.isArray(t?.notes) ? t.notes : [])
      .map((n) => ({
        p: Math.max(0, Math.min(127, Math.round(Number(n?.p)))),
        s: Math.max(0, Number(n?.s) || 0),
        d: Math.max(0.05, Number(n?.d) || 0.25),
        v: Math.max(1, Math.min(127, Math.round(Number(n?.v) || 96))),
      }))
      .filter((n) => Number.isFinite(n.p) && n.s < maxBeats)
      .map((n) => ({ ...n, d: Math.min(n.d, maxBeats - n.s) }))
      .slice(0, 2000);
    return { name: String(t?.name ?? `Track ${i + 1}`).slice(0, 60), channel: drums ? 9 : 0, notes };
  });
}

function toMidiFile(tracks, bpm) {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  for (const t of tracks) {
    const track = midi.addTrack();
    track.name = t.name;
    track.channel = t.channel;
    for (const n of t.notes) {
      track.addNote({ midi: n.p, ticks: Math.round(n.s * PPQ), durationTicks: Math.max(1, Math.round(n.d * PPQ)), velocity: n.v / 127 });
    }
  }
  return Buffer.from(midi.toArray());
}

function fromMidiFile(buf) {
  const midi = new Midi(buf);
  const ppq = midi.header.ppq || PPQ;
  const tracks = midi.tracks
    .filter((t) => t.notes.length)
    .slice(0, 16)
    .map((t, i) => ({
      name: t.name || t.instrument?.name || `Track ${i + 1}`,
      channel: t.channel,
      notes: t.notes.slice(0, 4000).map((n) => ({
        p: n.midi,
        s: +(n.ticks / ppq).toFixed(4),
        d: +(n.durationTicks / ppq).toFixed(4),
        v: Math.round(n.velocity * 127),
      })),
    }));
  const lastBeat = Math.max(0, ...tracks.flatMap((t) => t.notes.map((n) => n.s + n.d)));
  const bpm = midi.header.tempos[0]?.bpm ? Math.round(midi.header.tempos[0].bpm * 100) / 100 : null;
  return { tracks, bpm, bars: Math.max(1, Math.ceil(lastBeat / 4)) };
}

function guessKind(tracks) {
  if (tracks.some((t) => t.channel === 9)) return "drums";
  const notes = tracks.flatMap((t) => t.notes);
  if (!notes.length) return "other";
  const avg = notes.reduce((a, n) => a + n.p, 0) / notes.length;
  const starts = new Map();
  for (const n of notes) starts.set(n.s, (starts.get(n.s) ?? 0) + 1);
  const poly = notes.length / starts.size;
  if (avg < 50) return "bass";
  if (poly >= 2.5) return "chords";
  return "melody";
}

// Instrument from the track name (Japanese / English / common DAW abbreviations), then the notes.
const KIND_PATTERNS = [
  ["drums", /drum|kick|snare|hi.?hat|\bhh\b|\bbd\b|\bsd\b|tom|cymbal|crash|ride|perc|kit|ドラム|キック|スネア|ハット|タム|シンバル|パーカッション/i],
  ["bass", /bass|\bbs\b|\bba\b|ベース|808/i],
  ["piano", /piano|\bpf\b|\bpno\b|keys?\b|rhodes|wurli|e\.?\s?p(iano)?\b|\bep\b|organ|clav|ピアノ|オルガン|キーボード|エレピ/i],
  ["guitar", /guitar|\bgtr?\b|\bgt\b|\b[ae]\.?\s?g\b|ギター/i],
  ["strings", /string|\bstr\b|violin|vln|viola|cello|\bvc\b|contrabass|ストリングス|弦|バイオリン|チェロ/i],
  ["brass", /brass|horn|trumpet|\btp\b|trombone|\btb\b|sax|ブラス|ホーン|トランペット|サックス/i],
  ["synth", /synth|pad|lead|pluck|arp|saw|シンセ|パッド|リード/i],
  ["melody", /vocal|\bvo\b|\bvox\b|melody|\bmel\b|guide|ボーカル|ボーカル|歌|メロ|主旋律/i],
];

function classifyTrack(t) {
  if (t.channel === 9) return "drums";
  for (const [kind, re] of KIND_PATTERNS) if (re.test(t.name ?? "")) return kind;
  return guessKind([t]);
}

/** A reference clip for the AI: note mapping (drum kit!), feel, and the notes themselves. */
function referenceNote(clip) {
  const notes = clip.tracks.flatMap((t) => t.notes.map((n) => ({ ...n, drum: t.channel === 9 }))).sort((a, b) => a.s - b.s);
  if (!notes.length) return "";
  const pitches = new Map();
  for (const n of notes) pitches.set(n.p, (pitches.get(n.p) ?? 0) + 1);
  const vel = notes.map((n) => n.v);
  const list = notes
    .slice(0, 320)
    .map((n) => `${n.p}@${+n.s.toFixed(3)}:${+n.d.toFixed(3)}:${n.v}`)
    .join(" ");
  return (
    `\n\n【参考 MIDI「${clip.name}」】(${clip.bars ?? "?"} 小節・${clip.bpm ? Math.round(clip.bpm) : "?"} BPM)` +
    `\n使っているノート番号(回数): ${[...pitches].sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}(${c})`).join(", ")}` +
    `\nベロシティ: ${Math.min(...vel)}〜${Math.max(...vel)}` +
    `\nノート(ノート番号@開始拍:長さ:ベロシティ): ${list}${notes.length > 320 ? " …" : ""}` +
    "\nこの参考 MIDI のノート番号の割り当て(特にドラムはこの番号どおりに)・リズムの癖・ベロシティの付け方を踏襲すること。本人の希望が「ヒューマナイズ」「アレンジ」などの場合は、この MIDI を元に作り変える。"
  );
}

module.exports = { createFlowRouter, classifyTrack, STAGES, DEFAULT_PREFS, toMidiFile, fromMidiFile, normalizeTracks };
