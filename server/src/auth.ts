import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

const COOKIE = "aegis_session";

function sign(payload: string) {
  return crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res: Response, name: string, value: string, maxAgeSec: number) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (config.secureCookies) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

export function isAuthenticated(req: Request): boolean {
  if (!config.appPassword) return true;
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || !safeEqual(sign(expires), sig)) return false;
  return Number(expires) > Date.now();
}

// Very small brute-force brake: after 5 failures, each attempt waits progressively longer.
let failures = 0;
let lockedUntil = 0;

export function login(req: Request, res: Response) {
  if (!config.appPassword) return res.json({ ok: true });
  if (Date.now() < lockedUntil) {
    return res.status(429).json({ error: "試行回数が多すぎます。少し待ってから再度お試しください。" });
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeEqual(sign(password), sign(config.appPassword))) {
    failures += 1;
    if (failures >= 5) lockedUntil = Date.now() + Math.min(2 ** (failures - 5), 300) * 1000;
    return res.status(401).json({ error: "パスワードが違います" });
  }
  failures = 0;
  const maxAge = config.sessionDays * 24 * 60 * 60;
  const expires = String(Date.now() + maxAge * 1000);
  setCookie(res, COOKIE, `${expires}.${sign(expires)}`, maxAge);
  res.json({ ok: true });
}

export function logout(_req: Request, res: Response) {
  setCookie(res, COOKIE, "", 0);
  res.json({ ok: true });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}
