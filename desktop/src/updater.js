// In-app update ("今すぐ更新"), modeled on Lyric Machine's updater.
//
// 1. Look at the latest GitHub release; if it is newer, download this Mac's .app zip.
// 2. Verify it (sha256 from GitHub, bundle id, version, code signature).
// 3. Quit; a tiny shell script waits for us to exit, swaps the old .app for the new one and
//    relaunches. Data lives outside the .app (Application Support), so nothing is lost.
const { app } = require("electron");
const { spawn, execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = "shota0223morisan/studio-aegis";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const BUNDLE_ID = "dev.studioaegis.desktop";
const ASSET = `Studio-Aegis-${process.arch === "arm64" ? "apple-silicon" : "intel"}.zip`;

// Gets its paths as arguments (nothing interpolated). Copies the new app next to the old one
// first, then renames, so an interruption never leaves a broken app behind.
const INSTALL_SH = `#!/bin/sh
PID="$1"; NEW="$2"; CUR="$3"
DIR="$(dirname "$CUR")"; BAK="$DIR/.SessionPartner-old-$$.app"; STAGE="$DIR/.SessionPartner-new-$$.app"
LOG="$(dirname "$NEW")/install.log"
i=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.5; i=$((i + 1))
  if [ "$i" -gt 120 ]; then echo "app did not quit" >> "$LOG"; exit 1; fi
done
if ! ditto "$NEW" "$STAGE" 2>>"$LOG"; then rm -rf "$STAGE"; open "$CUR"; exit 1; fi
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null
if ! mv "$CUR" "$BAK" 2>>"$LOG"; then rm -rf "$STAGE"; open "$CUR"; exit 1; fi
if mv "$STAGE" "$CUR" 2>>"$LOG"; then rm -rf "$BAK"; echo ok >> "$LOG"; else mv "$BAK" "$CUR"; rm -rf "$STAGE"; fi
open "$CUR"
exit 0
`;

class UpdateError extends Error {}

function parseVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+(?:\.\d+)*)/);
  return m ? m[1].split(".").map(Number) : [];
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a.length || !b.length) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The running .app bundle (null when not packaged, i.e. development). */
function currentBundle() {
  if (!app.isPackaged || process.platform !== "darwin") return null;
  let p = path.dirname(process.execPath);
  while (p !== path.dirname(p)) {
    if (p.endsWith(".app")) return p;
    p = path.dirname(p);
  }
  return null;
}

/** Why the app can't replace itself where it is (null if it can). */
function installProblem(bundle) {
  if (!bundle) return "開発版なので、アプリ内の更新は使えません";
  if (bundle.startsWith("/Volumes/")) return "dmg から直接開いています。「アプリケーション」フォルダに入れてから開いてください";
  if (bundle.includes("/AppTranslocation/")) {
    return "Mac が一時的な場所でアプリを開いています。Finder で Session Partner を「アプリケーション」フォルダに入れ直してから開いてください";
  }
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    return `「${path.dirname(bundle)}」に書き込めないため更新できません`;
  }
  return null;
}

/** Latest release via the API (gives the asset's sha256). */
async function latestFromApi() {
  const res = await fetch(LATEST_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "StudioAegis" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new UpdateError(`GitHub ${res.status}`);
  const data = await res.json();
  const asset = (data.assets ?? []).find((a) => a.name === ASSET);
  return { tag: String(data.tag_name ?? ""), page: data.html_url, asset };
}

/**
 * Fallback when the API is rate-limited: /releases/latest redirects to the tag's page, and
 * assets live at a fixed URL. (No sha256 here; the bundle id / version / signature checks remain.)
 */
async function latestFromRedirect() {
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const page = res.headers.get("location") ?? "";
  const tag = decodeURIComponent(page.split("/releases/tag/")[1] ?? "");
  if (!tag) throw new UpdateError("更新を確認できませんでした(GitHub に接続できません)");
  const url = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${ASSET}`;
  const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const asset = head?.ok ? { browser_download_url: url, size: Number(head.headers.get("content-length")) || 0 } : null;
  return { tag, page, asset };
}

async function check() {
  const current = app.getVersion();
  const { tag, page, asset } = await latestFromApi().catch(() => latestFromRedirect());
  const data = { html_url: page };
  const latest = tag.replace(/^desktop-v/, "");
  const digest = String(asset?.digest ?? "");
  let problem = installProblem(currentBundle());
  if (!asset) problem ??= "この版にはアプリ内更新用のファイルがありません(dmg から入れてください)";
  const available = isNewer(latest, current);
  return {
    current,
    latest,
    available,
    url: data.html_url,
    assetUrl: asset?.browser_download_url ?? null,
    size: asset?.size ?? 0,
    sha256: digest.startsWith("sha256:") ? digest.slice(7) : null,
    canInstall: available && !problem,
    problem,
  };
}

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve(String(stdout).trim()),
    ),
  );

async function download(info, onProgress) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-aegis-update-"));
  const zip = path.join(dir, ASSET);
  const res = await fetch(info.assetUrl, { headers: { "User-Agent": "StudioAegis" } });
  if (!res.ok || !res.body) throw new UpdateError(`ダウンロードに失敗しました (${res.status})`);
  const total = Number(res.headers.get("content-length")) || info.size || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(zip);
  let done = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    done += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    onProgress({ phase: "downloading", done, total });
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  if (info.sha256 && hash.digest("hex") !== info.sha256) throw new UpdateError("ダウンロードしたファイルが壊れています(sha256 が一致しません)");

  onProgress({ phase: "verifying", done, total });
  const extracted = path.join(dir, "app");
  fs.mkdirSync(extracted);
  await run("ditto", ["-x", "-k", zip, extracted]);
  // The zip keeps the old "Studio Aegis.app" folder name so older versions can still update.
  const newApp = ["Studio Aegis.app", "Session Partner.app"].map((n) => path.join(extracted, n)).find((p) => fs.existsSync(p));
  if (!newApp) throw new UpdateError("zip の中にアプリが見つかりません");
  const plist = path.join(newApp, "Contents", "Info.plist");
  const id = await run("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist]);
  const version = await run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist]);
  if (id !== BUNDLE_ID) throw new UpdateError("中身が Session Partner ではありません");
  if (version !== info.latest) throw new UpdateError(`版が合いません(${version} ≠ ${info.latest})`);
  await run("codesign", ["--verify", "--deep", "--strict", newApp]).catch((err) => {
    throw new UpdateError(`アプリの署名が壊れています: ${err.message}`);
  });
  fs.rmSync(zip, { force: true });
  return { dir, newApp };
}

/** Hand off to the install script and quit; the script relaunches the new version. */
function installAndRestart(ready) {
  const bundle = currentBundle();
  const problem = installProblem(bundle);
  if (problem) throw new UpdateError(problem);
  const script = path.join(ready.dir, "install.sh");
  fs.writeFileSync(script, INSTALL_SH, { mode: 0o755 });
  const child = spawn("/bin/sh", [script, String(process.pid), ready.newApp, bundle], { detached: true, stdio: "ignore" });
  child.unref();
  app.quit();
}

/** Download → verify → swap → relaunch, reporting progress along the way. */
async function updateNow(onProgress) {
  const info = await check();
  if (!info.available) throw new UpdateError("すでに最新版です");
  if (!info.canInstall) throw new UpdateError(info.problem ?? "更新できません");
  onProgress({ phase: "downloading", done: 0, total: info.size, version: info.latest });
  const ready = await download(info, (p) => onProgress({ ...p, version: info.latest }));
  onProgress({ phase: "restarting", version: info.latest });
  setTimeout(() => installAndRestart(ready), 600);
}

module.exports = { check, updateNow, isNewer, UpdateError };
