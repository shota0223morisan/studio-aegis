// Spotify integration for the local app: Authorization Code + PKCE, so only a Client ID is
// needed (no secret). Tokens are kept in the local database.
const crypto = require("node:crypto");
const express = require("express");

const SCOPES = [
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const TOKEN_KEY = "spotify.tokens";
const CLIENT_ID_KEY = "spotify.clientId";
const API = "https://api.spotify.com/v1";
const KINDS = ["track", "album", "playlist", "episode", "show", "artist"];

/** Accepts open.spotify.com URLs (incl. intl-xx / embed variants) and spotify: URIs. */
function parseSpotifyRef(input) {
  const s = String(input ?? "").trim();
  const uri = s.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{10,32})$/);
  if (uri) return { kind: uri[1], id: uri[2] };
  try {
    const url = new URL(s);
    if (!/(^|\.)spotify\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      if (KINDS.includes(parts[i]) && /^[A-Za-z0-9]{10,32}$/.test(parts[i + 1])) return { kind: parts[i], id: parts[i + 1] };
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** Title lookup that works without OAuth (Spotify oEmbed). Best effort. */
async function fetchOEmbedTitle(kind, id) {
  try {
    const url = `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${kind}/${id}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "";
    return (await res.json()).title ?? "";
  } catch {
    return "";
  }
}

class SpotifyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const img = (images) => images?.[images.length > 1 ? 1 : 0]?.url ?? null;

function createSpotifyRouter(store, { redirectUri }) {
  const router = express.Router();
  const pending = new Map(); // state -> { verifier, returnTo, at }
  let refreshing = null;

  const clientId = () => store.kvGet(CLIENT_ID_KEY) || "";

  async function tokenRequest(params) {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId(), ...params }),
    });
    if (!res.ok) throw new Error(`Spotify token error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function getTokens() {
    const tokens = store.kvGet(TOKEN_KEY);
    if (!tokens || !clientId()) return null;
    if (tokens.expires_at - 60_000 > Date.now()) return tokens;
    refreshing ??= (async () => {
      try {
        const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
        const next = {
          ...tokens,
          access_token: r.access_token,
          refresh_token: r.refresh_token ?? tokens.refresh_token, // PKCE refresh tokens rotate
          expires_at: Date.now() + r.expires_in * 1000,
        };
        store.kvSet(TOKEN_KEY, next);
        return next;
      } catch (err) {
        console.error("[spotify] refresh failed", err);
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function api(path, init = {}) {
    const tokens = await getTokens();
    if (!tokens) throw new SpotifyError(401, "Spotify未接続です");
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (res.status === 204) return undefined;
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok) throw new SpotifyError(res.status, body?.error?.message ?? `Spotify API error ${res.status}`);
    return body;
  }

  const handle = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      if (!res.headersSent) res.status(err instanceof SpotifyError ? err.status : 500).json({ error: err.message });
    }
  };

  router.get(
    "/status",
    handle(async () => {
      const tokens = await getTokens();
      return { configured: Boolean(clientId()), connected: Boolean(tokens), user: tokens?.user ?? null, redirectUri };
    }),
  );

  /** Body: { clientId } — saved from the settings screen. Changing it drops the connection. */
  router.put("/client-id", (req, res) => {
    const value = typeof req.body?.clientId === "string" ? req.body.clientId.trim() : "";
    if (value && !/^[0-9a-f]{32}$/i.test(value)) return res.status(400).json({ error: "Client ID は 32 文字の英数字です" });
    if (value !== clientId()) store.kvDelete(TOKEN_KEY);
    if (value) store.kvSet(CLIENT_ID_KEY, value);
    else store.kvDelete(CLIENT_ID_KEY);
    res.json({ ok: true });
  });

  router.get("/login", (req, res) => {
    if (!clientId()) return res.status(400).send("Spotify の Client ID が未設定です(設定画面で入力してください)");
    const raw = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
    const returnTo = /^\/(?![\/\\])/.test(raw) ? raw : "/";
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));
    for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
    pending.set(state, { verifier, returnTo, at: Date.now() });
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId(),
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      code_challenge_method: "S256",
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
    });
    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
  });

  router.get("/callback", async (req, res) => {
    const entry = pending.get(String(req.query.state ?? ""));
    pending.delete(String(req.query.state ?? ""));
    const returnTo = entry?.returnTo ?? "/";
    const back = (status) => res.redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}spotify=${status}`);
    if (!entry) return back("state_mismatch");
    if (typeof req.query.code !== "string") return back(String(req.query.error ?? "denied"));
    try {
      const r = await tokenRequest({
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: redirectUri,
        code_verifier: entry.verifier,
      });
      const tokens = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + r.expires_in * 1000 };
      store.kvSet(TOKEN_KEY, tokens);
      try {
        const me = await api("/me");
        store.kvSet(TOKEN_KEY, { ...tokens, user: { id: me.id, display_name: me.display_name } });
      } catch {
        /* profile is cosmetic */
      }
      back("connected");
    } catch (err) {
      console.error("[spotify] callback failed", err);
      back("error");
    }
  });

  router.post("/logout", (_req, res) => {
    store.kvDelete(TOKEN_KEY);
    res.json({ ok: true });
  });

  // Development-mode apps (Feb 2026 rules) cap search at limit=10.
  router.get(
    "/search",
    handle(async (req) => {
      const q = String(req.query.q ?? "").trim();
      if (!q) return { items: [] };
      const type = ["track", "album", "playlist"].includes(String(req.query.type)) ? String(req.query.type) : "track";
      const data = await api(`/search?${new URLSearchParams({ q, type, limit: "10" })}`);
      return {
        items: (data?.[`${type}s`]?.items ?? []).filter(Boolean).map((it) => ({
          kind: type,
          id: it.id,
          uri: it.uri,
          title: it.name,
          subtitle: type === "playlist" ? (it.owner?.display_name ?? "") : (it.artists ?? []).map((a) => a.name).join(", "),
          image: img(type === "track" ? it.album?.images : it.images),
        })),
      };
    }),
  );

  router.get(
    "/playlists",
    handle(async () => {
      const data = await api("/me/playlists?limit=50");
      return {
        items: (data?.items ?? []).filter(Boolean).map((p) => ({
          kind: "playlist",
          id: p.id,
          uri: p.uri,
          title: p.name,
          subtitle: p.owner?.display_name ?? "",
          image: img(p.images),
        })),
      };
    }),
  );

  router.get(
    "/playlists/:id/items",
    handle(async (req) => {
      const data = await api(`/playlists/${encodeURIComponent(req.params.id)}/items?limit=100`);
      return {
        items: (data?.items ?? [])
          .map((row) => row.item ?? row.track)
          .filter((t) => t?.id)
          .map((t) => ({
            kind: t.type === "episode" ? "episode" : "track",
            id: t.id,
            uri: t.uri,
            title: t.name,
            subtitle: (t.artists ?? []).map((a) => a.name).join(", ") || t.show?.name || "",
            image: img(t.album?.images ?? t.images),
          })),
      };
    }),
  );

  /**
   * Play on the Spotify app via Spotify Connect (the app's Chromium has no Widevine, so the
   * Web Playback SDK can't run in-app). Prefers the active device, then an open desktop app.
   */
  router.post(
    "/play",
    handle(async (req) => {
      const ref = parseSpotifyRef(req.body?.uri);
      if (!ref) throw new SpotifyError(400, "uri が不正です");
      const body =
        ref.kind === "track" || ref.kind === "episode"
          ? { uris: [`spotify:${ref.kind}:${ref.id}`] }
          : { context_uri: `spotify:${ref.kind}:${ref.id}` };
      const { devices = [] } = (await api("/me/player/devices")) ?? {};
      const usable = devices.filter((d) => d.id && !d.is_restricted);
      const pick = usable.find((d) => d.is_active) ?? usable.find((d) => d.type === "Computer") ?? usable[0];
      if (!pick) throw new SpotifyError(404, "再生できるデバイスがありません。Spotify アプリを起動してください");
      await api(`/me/player/play?device_id=${encodeURIComponent(pick.id)}`, { method: "PUT", body: JSON.stringify(body) });
      return { ok: true, device: pick.name };
    }),
  );

  return router;
}

module.exports = { createSpotifyRouter, parseSpotifyRef, fetchOEmbedTitle };
