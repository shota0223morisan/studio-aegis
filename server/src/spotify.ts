import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { config, spotifyConfigured } from "./config.js";
import { kvDelete, kvGet, kvSet } from "./db.js";
import { parseCookies, setCookie } from "./auth.js";

/**
 * Spotify integration (Authorization Code flow, single user).
 *
 * Tokens live server-side in the kv table so every device shares one connection.
 * The browser only ever receives short-lived access tokens (needed by the Web Playback SDK).
 */

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const TOKEN_KEY = "spotify.tokens";
const API = "https://api.spotify.com/v1";

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  user?: { id: string; display_name: string | null };
}

export type SpotifyKind = "track" | "album" | "playlist" | "episode" | "show" | "artist";
const KINDS: SpotifyKind[] = ["track", "album", "playlist", "episode", "show", "artist"];

/** Accepts open.spotify.com URLs (incl. intl-xx / embed variants), spotify: URIs. */
export function parseSpotifyRef(input: string): { kind: SpotifyKind; id: string } | null {
  const s = input.trim();
  const uri = s.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{10,32})$/);
  if (uri) return { kind: uri[1] as SpotifyKind, id: uri[2] };
  try {
    const url = new URL(s);
    if (!/(^|\.)spotify\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      if ((KINDS as string[]).includes(parts[i]) && /^[A-Za-z0-9]{10,32}$/.test(parts[i + 1])) {
        return { kind: parts[i] as SpotifyKind, id: parts[i + 1] };
      }
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** Title lookup that works without OAuth (Spotify oEmbed). Best effort. */
export async function fetchOEmbedTitle(kind: SpotifyKind, id: string): Promise<string> {
  try {
    const url = `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${kind}/${id}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return "";
    const data = (await res.json()) as { title?: string };
    return data.title ?? "";
  } catch {
    return "";
  }
}

async function tokenRequest(params: Record<string, string>) {
  const basic = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Spotify token error ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
}

let refreshing: Promise<Tokens | null> | null = null;

async function getTokens(): Promise<Tokens | null> {
  const tokens = kvGet<Tokens>(TOKEN_KEY);
  if (!tokens) return null;
  if (tokens.expires_at - 60_000 > Date.now()) return tokens;
  // Coalesce concurrent refreshes.
  refreshing ??= (async () => {
    try {
      const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
      const next: Tokens = {
        ...tokens,
        access_token: r.access_token,
        refresh_token: r.refresh_token ?? tokens.refresh_token,
        expires_at: Date.now() + r.expires_in * 1000,
        scope: r.scope ?? tokens.scope,
      };
      kvSet(TOKEN_KEY, next);
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

class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const tokens = await getTokens();
  if (!tokens) throw new SpotifyError(401, "Spotify未接続です");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = body?.error?.message ?? `Spotify API error ${res.status}`;
    throw new SpotifyError(res.status, msg);
  }
  return body as T;
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      const status = err instanceof SpotifyError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(status).json({ error: message });
    }
  };
}

const img = (images?: { url: string }[]) => images?.[images.length > 1 ? 1 : 0]?.url ?? images?.[0]?.url ?? null;

export const spotifyRouter = Router();

spotifyRouter.get(
  "/status",
  handle(async () => {
    const tokens = spotifyConfigured() ? await getTokens() : null;
    return {
      configured: spotifyConfigured(),
      connected: Boolean(tokens),
      user: tokens?.user ?? null,
      redirectUri: config.spotify.redirectUri,
    };
  }),
);

spotifyRouter.get("/login", (req, res) => {
  if (!spotifyConfigured()) return res.status(400).send("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET が未設定です");
  const state = crypto.randomBytes(16).toString("hex");
  // Same-origin paths only ("//host" or "/\host" would be an open redirect).
  const raw = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
  const returnTo = /^\/(?![\/\\])[^|]*$/.test(raw) ? raw : "/";
  setCookie(res, "aegis_spotify_state", `${state}|${returnTo}`, 600);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.spotify.clientId,
    scope: SCOPES,
    redirect_uri: config.spotify.redirectUri,
    state,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

spotifyRouter.get("/callback", async (req, res) => {
  const [expected, returnTo = "/"] = (parseCookies(req).aegis_spotify_state ?? "").split("|");
  setCookie(res, "aegis_spotify_state", "", 0);
  const back = (status: string) => res.redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}spotify=${status}`);
  if (!expected || req.query.state !== expected) return back("state_mismatch");
  if (typeof req.query.code !== "string") return back(String(req.query.error ?? "denied"));
  try {
    const r = await tokenRequest({
      grant_type: "authorization_code",
      code: req.query.code,
      redirect_uri: config.spotify.redirectUri,
    });
    const tokens: Tokens = {
      access_token: r.access_token,
      refresh_token: r.refresh_token ?? "",
      expires_at: Date.now() + r.expires_in * 1000,
      scope: r.scope,
    };
    kvSet(TOKEN_KEY, tokens);
    try {
      const me = await api<{ id: string; display_name: string | null }>("/me");
      kvSet(TOKEN_KEY, { ...tokens, user: { id: me.id, display_name: me.display_name } });
    } catch {
      /* profile is cosmetic */
    }
    back("connected");
  } catch (err) {
    console.error("[spotify] callback failed", err);
    back("error");
  }
});

spotifyRouter.post("/logout", (_req, res) => {
  kvDelete(TOKEN_KEY);
  res.json({ ok: true });
});

/** Short-lived access token for the Web Playback SDK running in the browser. */
spotifyRouter.get(
  "/token",
  handle(async () => {
    const tokens = await getTokens();
    if (!tokens) throw new SpotifyError(401, "Spotify未接続です");
    return { accessToken: tokens.access_token, expiresAt: tokens.expires_at };
  }),
);

// Development-mode apps (Feb 2026 rules) cap search at limit=10.
spotifyRouter.get(
  "/search",
  handle(async (req) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return { items: [] };
    const type = ["track", "album", "playlist"].includes(String(req.query.type)) ? String(req.query.type) : "track";
    const data = await api<any>(`/search?${new URLSearchParams({ q, type, limit: "10" })}`);
    const bucket = data[`${type}s`]?.items ?? [];
    return {
      items: bucket.filter(Boolean).map((it: any) => ({
        kind: type,
        id: it.id,
        uri: it.uri,
        title: it.name,
        subtitle:
          type === "playlist"
            ? (it.owner?.display_name ?? "")
            : (it.artists ?? []).map((a: any) => a.name).join(", "),
        image: img(type === "track" ? it.album?.images : it.images),
      })),
    };
  }),
);

spotifyRouter.get(
  "/playlists",
  handle(async () => {
    const data = await api<any>("/me/playlists?limit=50");
    return {
      items: (data.items ?? []).filter(Boolean).map((p: any) => ({
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

spotifyRouter.get(
  "/playlists/:id/items",
  handle(async (req) => {
    const data = await api<any>(`/playlists/${encodeURIComponent(req.params.id)}/items?limit=100`);
    return {
      items: (data.items ?? [])
        .map((row: any) => row.item ?? row.track)
        .filter((t: any) => t?.id)
        .map((t: any) => ({
          kind: t.type === "episode" ? "episode" : "track",
          id: t.id,
          uri: t.uri,
          title: t.name,
          subtitle: (t.artists ?? []).map((a: any) => a.name).join(", ") || t.show?.name || "",
          image: img(t.album?.images ?? t.images),
        })),
    };
  }),
);

/** Start playback of a track/context on a device (usually the in-app Web Playback SDK device). */
spotifyRouter.post(
  "/play",
  handle(async (req) => {
    const { deviceId, uri } = req.body ?? {};
    const ref = typeof uri === "string" ? parseSpotifyRef(uri) : null;
    if (!ref) throw new SpotifyError(400, "uri が不正です");
    const body =
      ref.kind === "track" || ref.kind === "episode"
        ? { uris: [`spotify:${ref.kind}:${ref.id}`] }
        : { context_uri: `spotify:${ref.kind}:${ref.id}` };
    const qs = typeof deviceId === "string" && deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    await api(`/me/player/play${qs}`, { method: "PUT", body: JSON.stringify(body) });
    return { ok: true };
  }),
);
