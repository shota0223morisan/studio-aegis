import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { kvGet, kvSet, readJson, type AppEnv, type Ctx, type Env } from "./env";

const COOKIE = "aegis_session";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

let cachedSecret: string | null = null;

/** SESSION_SECRET if given, otherwise a random secret generated once and kept in D1. */
async function sessionSecret(env: Env): Promise<string> {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  let secret = await kvGet<string>(env, "session.secret");
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('session.secret', ?)").bind(JSON.stringify(secret)).run();
    secret = (await kvGet<string>(env, "session.secret"))!;
  }
  cachedSecret = secret;
  return secret;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const isSecure = (c: Ctx) => new URL(c.req.url).protocol === "https:";

const isLocal = (c: Ctx) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(c.req.url).hostname);

/**
 * Fail closed: once deployed, the app refuses to run without APP_PASSWORD (so a forgotten
 * secret never leaves projects and files open on the internet). Local dev is exempt.
 */
export const passwordMissing = (c: Ctx) => !c.env.APP_PASSWORD && !isLocal(c);

export async function isAuthenticated(c: Ctx): Promise<boolean> {
  if (!c.env.APP_PASSWORD) return true;
  const token = getCookie(c, COOKIE);
  if (!token) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig) return false;
  if (!safeEqual(await hmac(await sessionSecret(c.env), expires), sig)) return false;
  return Number(expires) > Date.now();
}

interface Throttle {
  failures: number;
  lockedUntil: number;
}

/** Brute-force brake persisted in D1 (isolates are short-lived, so memory won't do). */
export async function login(c: Ctx) {
  const env = c.env;
  if (!env.APP_PASSWORD) return c.json({ ok: true });
  const throttle = (await kvGet<Throttle>(env, "auth.throttle")) ?? { failures: 0, lockedUntil: 0 };
  if (Date.now() < throttle.lockedUntil) {
    return c.json({ error: "試行回数が多すぎます。少し待ってから再度お試しください。" }, 429);
  }
  const body = await readJson(c);
  const password = typeof body.password === "string" ? body.password : "";
  const secret = await sessionSecret(env);
  if (!safeEqual(await hmac(secret, `pw:${password}`), await hmac(secret, `pw:${env.APP_PASSWORD}`))) {
    throttle.failures += 1;
    if (throttle.failures >= 5) throttle.lockedUntil = Date.now() + Math.min(2 ** (throttle.failures - 5), 300) * 1000;
    await kvSet(env, "auth.throttle", throttle);
    return c.json({ error: "パスワードが違います" }, 401);
  }
  if (throttle.failures) await kvSet(env, "auth.throttle", { failures: 0, lockedUntil: 0 });
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expires = String(Date.now() + maxAge * 1000);
  setCookie(c, COOKIE, `${expires}.${await hmac(secret, expires)}`, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecure(c),
    maxAge,
  });
  return c.json({ ok: true });
}

export function logout(c: Ctx) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (passwordMissing(c)) return c.json({ error: "APP_PASSWORD が設定されていません" }, 503);
  if (await isAuthenticated(c)) return next();
  return c.json({ error: "unauthorized" }, 401);
};
