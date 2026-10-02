import { Hono } from "hono";
import { isAuthenticated, login, logout, passwordMissing, requireAuth } from "./auth";
import { maxUploadBytes, spotifyConfigured, type AppEnv } from "./env";
import { projects } from "./projects";
import { spotify } from "./spotify";

const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.get("/session", async (c) =>
  c.json({
    setupRequired: passwordMissing(c),
    authRequired: Boolean(c.env.APP_PASSWORD),
    authenticated: await isAuthenticated(c),
    spotifyConfigured: spotifyConfigured(c.env),
    maxUploadBytes: maxUploadBytes(c.env),
  }),
);
app.post("/auth/login", login);
app.post("/auth/logout", logout);

app.use("*", requireAuth);
app.route("/spotify", spotify);
app.route("/", projects);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
});

// Static SPA assets are served by Workers Static Assets (see wrangler.jsonc); only /api/* reaches here.
export default app;
