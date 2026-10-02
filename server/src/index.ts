import fs from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { config, spotifyConfigured } from "./config.js";
import { isAuthenticated, login, logout, requireAuth } from "./auth.js";
import { projectsRouter } from "./projects.js";
import { spotifyRouter } from "./spotify.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/session", (req, res) =>
  res.json({
    authRequired: Boolean(config.appPassword),
    authenticated: isAuthenticated(req),
    spotifyConfigured: spotifyConfigured(),
    maxUploadBytes: config.maxUploadBytes,
  }),
);
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);

app.use("/api", requireAuth);
app.use("/api/spotify", spotifyRouter);
app.use("/api", projectsRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// Serve the built frontend (production). In dev, Vite serves it and proxies /api here.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? `ファイルサイズが上限 (${Math.round(config.maxUploadBytes / 1024 / 1024)}MB) を超えています`
        : err.message;
    return res.status(413).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: "サーバーエラーが発生しました" });
};
app.use(onError);

const server = app.listen(config.port, config.host, () => {
  console.log(`Studio Aegis listening on http://${config.host}:${config.port}`);
  console.log(`  data dir:   ${config.dataDir}`);
  console.log(`  public url: ${config.publicUrl}`);
  console.log(`  password:   ${config.appPassword ? "enabled" : "DISABLED (set APP_PASSWORD when exposing to a network)"}`);
  console.log(`  spotify:    ${spotifyConfigured() ? `configured (redirect ${config.spotify.redirectUri})` : "not configured"}`);
});
// Large WAV uploads over slow links can take a while.
server.requestTimeout = 0;
