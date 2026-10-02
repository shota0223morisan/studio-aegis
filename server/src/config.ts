import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

// Load ./.env for non-Docker runs (existing environment variables take precedence).
try {
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch {
  /* no .env */
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, "data"));
fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });

/**
 * Session secret: use SESSION_SECRET when given, otherwise persist a random one
 * in the data dir so logins survive restarts.
 */
function loadSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, ".session-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const port = int(process.env.PORT, 8787);
const publicUrl = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");

export const config = {
  port,
  host: process.env.HOST ?? "0.0.0.0",
  /** Externally reachable origin of the app, used for the Spotify redirect URI. */
  publicUrl,
  secureCookies: publicUrl.startsWith("https://"),
  dataDir,
  uploadsDir: path.join(dataDir, "uploads"),
  dbPath: path.join(dataDir, "aegis.db"),
  webDist: path.join(repoRoot, "web", "dist"),
  /** When set, the whole app requires this password. Strongly recommended when hosted. */
  appPassword: process.env.APP_PASSWORD ?? "",
  sessionSecret: loadSessionSecret(),
  sessionDays: int(process.env.SESSION_DAYS, 30),
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 1024) * 1024 * 1024,
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
    redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? `${publicUrl}/api/spotify/callback`,
  },
};

export const spotifyConfigured = () => Boolean(config.spotify.clientId && config.spotify.clientSecret);
