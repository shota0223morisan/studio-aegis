#!/usr/bin/env node
// One-time Cloudflare setup for Studio Aegis:
//   1. create the D1 database and R2 bucket (skipped if they already exist)
//   2. write the database id into wrangler.jsonc
//   3. apply DB migrations, build and deploy
//   4. ask for APP_PASSWORD and store it as a Worker secret
//
// Prerequisites: `npx wrangler login` and R2 enabled once in the Cloudflare dashboard.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const DB_NAME = "studio-aegis";
const BUCKET = "studio-aegis-files";
const LOCATION = process.env.CF_LOCATION ?? "apac";

function wrangler(args, { capture = false, interactive = false, allowFail = false } = {}) {
  const res = spawnSync("npx", ["wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: interactive ? "inherit" : ["ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (res.status !== 0 && !allowFail) {
    if (capture) process.stderr.write(res.stderr ?? "");
    console.error(`\n✘ wrangler ${args.join(" ")} が失敗しました`);
    process.exit(1);
  }
  return res;
}

const step = (msg) => console.log(`\n▶ ${msg}`);

step("Cloudflare のログイン状態を確認");
if (wrangler(["whoami"], { capture: true, allowFail: true }).stdout?.includes("not authenticated")) {
  console.error("先に `npx wrangler login` を実行してください。");
  process.exit(1);
}

step(`D1 データベース "${DB_NAME}" を用意`);
const listDbs = () => {
  const stdout = wrangler(["d1", "list", "--json"], { capture: true }).stdout;
  return JSON.parse(stdout.slice(Math.max(0, stdout.search(/^\[/m)))); // skip any warning banner before the JSON
};
let db = listDbs().find((d) => d.name === DB_NAME);
if (!db) {
  wrangler(["d1", "create", DB_NAME, "--location", LOCATION]);
  db = listDbs().find((d) => d.name === DB_NAME);
}
if (!db?.uuid) {
  console.error("D1 データベースの ID を取得できませんでした。");
  process.exit(1);
}
console.log(`  database_id: ${db.uuid}`);

const config = readFileSync(configPath, "utf8");
const patched = config.replace(/("database_id":\s*")[^"]*(")/, `$1${db.uuid}$2`);
if (patched !== config) writeFileSync(configPath, patched);

step(`R2 バケット "${BUCKET}" を用意`);
const bucket = wrangler(["r2", "bucket", "create", BUCKET, "--location", LOCATION], { capture: true, allowFail: true });
const out = `${bucket.stdout}\n${bucket.stderr}`;
if (bucket.status !== 0 && !/already exists|10004/i.test(out)) {
  process.stderr.write(out);
  if (/enable R2|10042/i.test(out)) {
    console.error("\nR2 が未有効です。Cloudflare ダッシュボード → R2 で一度「購入/有効化」(無料枠あり)してから再実行してください。");
  }
  process.exit(1);
}
console.log("  OK");

step("DB マイグレーションを適用");
wrangler(["d1", "migrations", "apply", "DB", "--remote"], { interactive: true });

step("ビルドしてデプロイ");
const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(1);
// Interactive: on a fresh account wrangler asks to register a workers.dev subdomain here.
wrangler(["deploy"], { interactive: true });

step("ログインパスワード (APP_PASSWORD) を設定");
console.log("  未設定のあいだ、アプリは安全のため停止した状態になります。");
wrangler(["secret", "put", "APP_PASSWORD"], { interactive: true });

console.log(`
✔ セットアップ完了
  上に表示された https://studio-aegis.<あなたのサブドメイン>.workers.dev を開いてください。
  Spotify を使う場合は README の「Spotify を有効にする」を参照。
`);
