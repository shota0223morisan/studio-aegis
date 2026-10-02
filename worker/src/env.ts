import type { Context } from "hono";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  MAX_UPLOAD_MB?: string;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REDIRECT_URI?: string;
}

export type AppEnv = { Bindings: Env };
export type Ctx = Context<AppEnv>;

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function maxUploadBytes(env: Env) {
  const mb = Number.parseInt(env.MAX_UPLOAD_MB ?? "", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 5120) * 1024 * 1024;
}

export function spotifyConfigured(env: Env) {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

export async function touchProject(env: Env, projectId: string) {
  await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(now(), projectId).run();
}

export async function kvGet<T>(env: Env, key: string): Promise<T | undefined> {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export async function kvSet(env: Env, key: string, value: unknown) {
  await env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
}

export async function kvDelete(env: Env, key: string) {
  await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(key).run();
}

export const str = (v: unknown, max = 200_000) => (typeof v === "string" ? v.slice(0, max) : undefined);

export async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, any>> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, any>) : {};
  } catch {
    return {};
  }
}
