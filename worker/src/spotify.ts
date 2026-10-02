import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { kvDelete, kvGet, kvSet, readJson, spotifyConfigured, type AppEnv, type Ctx, type Env } from "./env";
import { isSecure } from "./auth";

/**
 * Spotify integration (Authorization Code flow, single user).
 *
 * Tokens live server-side (D1) so every device shares one connection.
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
const STATE_COOKIE = "aegis_spotify_state";
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

const redirectUri = (c: Ctx) => c.env.SPOTIFY_REDIRECT_URI || `${new URL(c.req.url).origin}/api/spotify/callback`;

async function tokenRequest(env: Env, params: Record<string, string>) {
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Spotify token error ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
}

async function getTokens(env: Env): Promise<Tokens | null> {
  const tokens = await kvGet<Tokens>(env, TOKEN_KEY);
  if (!tokens) return null;
  if (tokens.expires_at - 60_000 > Date.now()) return tokens;
  try {
    const r = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    const next: Tokens = {
      ...tokens,
      access_token: r.access_token,
      refresh_token: r.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + r.expires_in * 1000,
      scope: r.scope ?? tokens.scope,
    };
    await kvSet(env, TOKEN_KEY, next);
    return next;
  } catch (err) {
    console.error("[spotify] refresh failed", err);
    return null;
  }
}

class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T = unknown>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const tokens = await getTokens(env);
  if (!tokens) throw new SpotifyError(401, "Spotify未接続です");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) throw new SpotifyError(res.status, body?.error?.message ?? `Spotify API error ${res.status}`);
  return body as T;
}

const img = (images?: { url: string }[]) => images?.[images.length > 1 ? 1 : 0]?.url ?? null;

export const spotify = new Hono<AppEnv>();

spotify.onError((err, c) => {
  const status = err instanceof SpotifyError ? err.status : 500;
  return c.json({ error: err.message }, status as 400);
});

spotify.get("/status", async (c) => {
  const tokens = spotifyConfigured(c.env) ? await getTokens(c.env) : null;
  return c.json({
    configured: spotifyConfigured(c.env),
    connected: Boolean(tokens),
    user: tokens?.user ?? null,
    redirectUri: redirectUri(c),
  });
});

spotify.get("/login", (c) => {
  if (!spotifyConfigured(c.env)) return c.text("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET が未設定です", 400);
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Same-origin paths only ("//host" or "/\host" would be an open redirect).
  const raw = c.req.query("returnTo") ?? "/";
  const returnTo = /^\/(?![\/\\])[^|]*$/.test(raw) ? raw : "/";
  setCookie(c, STATE_COOKIE, `${state}|${returnTo}`, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecure(c),
    maxAge: 600,
  });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.env.SPOTIFY_CLIENT_ID!,
    scope: SCOPES,
    redirect_uri: redirectUri(c),
    state,
  });
  return c.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

spotify.get("/callback", async (c) => {
  const [expected, returnTo = "/"] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  const back = (status: string) => c.redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}spotify=${status}`);
  if (!expected || c.req.query("state") !== expected) return back("state_mismatch");
  const code = c.req.query("code");
  if (!code) return back(c.req.query("error") ?? "denied");
  try {
    const r = await tokenRequest(c.env, { grant_type: "authorization_code", code, redirect_uri: redirectUri(c) });
    const tokens: Tokens = {
      access_token: r.access_token,
      refresh_token: r.refresh_token ?? "",
      expires_at: Date.now() + r.expires_in * 1000,
      scope: r.scope,
    };
    await kvSet(c.env, TOKEN_KEY, tokens);
    try {
      const me = await api<{ id: string; display_name: string | null }>(c.env, "/me");
      await kvSet(c.env, TOKEN_KEY, { ...tokens, user: { id: me.id, display_name: me.display_name } });
    } catch {
      /* profile is cosmetic */
    }
    return back("connected");
  } catch (err) {
    console.error("[spotify] callback failed", err);
    return back("error");
  }
});

spotify.post("/logout", async (c) => {
  await kvDelete(c.env, TOKEN_KEY);
  return c.json({ ok: true });
});

/** Short-lived access token for the Web Playback SDK running in the browser. */
spotify.get("/token", async (c) => {
  const tokens = await getTokens(c.env);
  if (!tokens) throw new SpotifyError(401, "Spotify未接続です");
  return c.json({ accessToken: tokens.access_token, expiresAt: tokens.expires_at });
});

// Development-mode apps (Feb 2026 rules) cap search at limit=10.
spotify.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ items: [] });
  const t = c.req.query("type") ?? "";
  const type = ["track", "album", "playlist"].includes(t) ? t : "track";
  const data = await api<any>(c.env, `/search?${new URLSearchParams({ q, type, limit: "10" })}`);
  const bucket = data?.[`${type}s`]?.items ?? [];
  return c.json({
    items: bucket.filter(Boolean).map((it: any) => ({
      kind: type,
      id: it.id,
      uri: it.uri,
      title: it.name,
      subtitle:
        type === "playlist" ? (it.owner?.display_name ?? "") : (it.artists ?? []).map((a: any) => a.name).join(", "),
      image: img(type === "track" ? it.album?.images : it.images),
    })),
  });
});

spotify.get("/playlists", async (c) => {
  const data = await api<any>(c.env, "/me/playlists?limit=50");
  return c.json({
    items: (data?.items ?? []).filter(Boolean).map((p: any) => ({
      kind: "playlist",
      id: p.id,
      uri: p.uri,
      title: p.name,
      subtitle: p.owner?.display_name ?? "",
      image: img(p.images),
    })),
  });
});

spotify.get("/playlists/:id/items", async (c) => {
  const data = await api<any>(c.env, `/playlists/${encodeURIComponent(c.req.param("id"))}/items?limit=100`);
  return c.json({
    items: (data?.items ?? [])
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
  });
});

/** Start playback of a track/context on a device (usually the in-app Web Playback SDK device). */
spotify.post("/play", async (c) => {
  const { deviceId, uri } = await readJson(c);
  const ref = typeof uri === "string" ? parseSpotifyRef(uri) : null;
  if (!ref) throw new SpotifyError(400, "uri が不正です");
  const body =
    ref.kind === "track" || ref.kind === "episode"
      ? { uris: [`spotify:${ref.kind}:${ref.id}`] }
      : { context_uri: `spotify:${ref.kind}:${ref.id}` };
  let target = typeof deviceId === "string" && deviceId ? deviceId : "";
  if (!target) {
    // No in-browser player (desktop app / iOS): use Spotify Connect. Prefer the active device,
    // then an open Spotify desktop app, so playback works even when nothing is playing yet.
    const { devices = [] } =
      (await api<{ devices?: { id: string | null; is_active: boolean; type: string; is_restricted: boolean }[] }>(
        c.env,
        "/me/player/devices",
      )) ?? {};
    const usable = devices.filter((d) => d.id && !d.is_restricted);
    const pick = usable.find((d) => d.is_active) ?? usable.find((d) => d.type === "Computer") ?? usable[0];
    if (!pick) throw new SpotifyError(404, "再生できるデバイスがありません。Spotify アプリを起動してください");
    target = pick.id!;
  }
  await api(c.env, `/me/player/play?device_id=${encodeURIComponent(target)}`, { method: "PUT", body: JSON.stringify(body) });
  return c.json({ ok: true });
});
