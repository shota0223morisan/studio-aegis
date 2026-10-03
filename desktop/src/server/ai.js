// AI through Claude Code (the official `claude` command) on the user's subscription — the same
// approach as Lyric Machine: no API key, no per-token billing.
//
// - Install Claude Code on this Mac and log in once with the subscription (`claude` → /login).
// - Each call starts `claude -p`, streams the answer back and exits. No tools, no CLAUDE.md,
//   no plugins / MCP, nothing saved (a plain Claude used only for this app).
// - An API key in the environment would switch it to pay-as-you-go, so it's never passed down.
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIMEOUT_MS = 6 * 60 * 1000;
const MODELS = ["claude", "fable", "opus", "sonnet"]; // "claude" = the subscription's default model
const NO_AUTH_HINT =
  "Claude Code にログインしていないようです。ターミナルで `claude` を起動し、/login でサブスクのアカウントにログインしてください";
const NOT_FOUND =
  "Claude Code(claude コマンド)が見つかりません。https://claude.com/claude-code の手順で入れて、サブスクでログインしてください";

class AiError extends Error {}

// Apps opened from Finder get a short PATH, so look in the usual install places too.
function searchDirs() {
  const home = os.homedir();
  const dirs = [".local/bin", ".claude/local", ".npm-global/bin", ".volta/bin", ".bun/bin", "bin"].map((d) => path.join(home, d));
  dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  try {
    const nvm = path.join(home, ".nvm/versions/node");
    for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, "bin"));
  } catch {
    /* no nvm */
  }
  return dirs;
}

function findClaude() {
  const fromEnv = process.env.AEGIS_CLAUDE_BIN; // for tests
  if (fromEnv) return fromEnv;
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...searchDirs()];
  for (const d of dirs) {
    const p = path.join(d, "claude");
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function childEnv(binary) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  // The npm build of claude also needs node next to it.
  env.PATH = [path.dirname(binary), ...searchDirs(), env.PATH || "/usr/bin:/bin"].join(path.delimiter);
  env.HOME ??= os.homedir();
  return env;
}

function explain(message) {
  const low = message.toLowerCase();
  if (["login", "log in", "api key", "authentication", "unauthorized", "oauth"].some((k) => low.includes(k))) {
    return `${NO_AUTH_HINT}(${message.slice(0, 200)})`;
  }
  if ((low.includes("rate") && low.includes("limit")) || low.includes("usage limit")) {
    return `サブスクの利用上限に達しました。時間をおいてから使ってください(${message.slice(0, 200)})`;
  }
  return message.slice(0, 500);
}

/**
 * One `claude -p` run.
 * @param {{ system: string, prompt: string, model?: string, schema?: object, onText?: (t: string) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ text: string, structured: any }>}
 */
function run({ system, prompt, model = "claude", schema, onText, signal }) {
  const binary = findClaude();
  if (!binary) return Promise.reject(new AiError(NOT_FOUND));
  const args = [
    "-p",
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--safe-mode", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands",
    "--system-prompt", system,
    "--tools", "",
  ];
  if (MODELS.includes(model) && model !== "claude") args.push("--model", model);
  if (schema) args.push("--json-schema", JSON.stringify(schema));

  // Run in an empty folder so no project files / CLAUDE.md get picked up.
  const cwd = path.join(os.tmpdir(), "studio-aegis-claude");
  fs.mkdirSync(cwd, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: childEnv(binary), stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    let result = null;
    const text = [];
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (child.exitCode === null) child.kill();
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => finish(new AiError("Claude の返事が長すぎて時間切れになりました")), TIMEOUT_MS);
    const onAbort = () => finish(new AiError("中止しました"));
    signal?.addEventListener("abort", onAbort);

    child.on("error", (err) => finish(new AiError(`Claude Code を起動できませんでした: ${err.message}`)));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === "stream_event") {
          const ev = msg.event ?? {};
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
            text.push(ev.delta.text);
            onText?.(ev.delta.text);
          }
        } else if (msg.type === "result") {
          result = msg;
        }
      }
    });
    child.on("close", (code) => {
      if (!result) return finish(new AiError(explain(stderr.trim() || `Claude Code が途中で終了しました(${code})`)));
      if (result.is_error) return finish(new AiError(explain(String(result.result || result.subtype || "Claude でエラーが起きました"))));
      let structured = result.structured_output ?? null;
      if (schema && structured == null) {
        try {
          structured = JSON.parse(String(result.result ?? "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
        } catch {
          return finish(new AiError("Claude の返事を読み取れませんでした(決まった形になっていません)"));
        }
      }
      finish(null, { text: String(result.result ?? "") || text.join(""), structured });
    });
    child.stdin.end(prompt);
  });
}

/** For the settings page: is `claude` installed, and which version. */
function status() {
  const binary = findClaude();
  if (!binary) return Promise.resolve({ found: false, path: "", version: "" });
  return new Promise((resolve) => {
    execFile(binary, ["--version"], { env: childEnv(binary), timeout: 20_000 }, (err, stdout) =>
      resolve({ found: true, path: binary, version: err ? "" : String(stdout).trim() }),
    );
  });
}

module.exports = { run, status, findClaude, AiError, MODELS };
