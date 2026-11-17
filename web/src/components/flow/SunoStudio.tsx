import { useEffect, useState } from "react";
import { api, type MidiClip, type StoredFile, type SunoClip, type SunoJob } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { toast } from "../../lib/toast";

const ACTION_LABEL: Record<SunoJob["action"], string> = { cover: "カバー", extend: "続き", midi: "MIDI から曲" };
const STATUS_LABEL: Record<SunoJob["status"], string> = { uploading: "Suno に送っています…", generating: "作っています…", done: "完了", error: "エラー" };

/** Credits left, from account-usage (the shape isn't documented, so look for the likely fields). */
function creditsOf(usage: any): string | null {
  const a = usage?.suno_account ?? usage ?? {};
  const v = a.credits_left ?? a.credits_remaining ?? a.remaining_credits ?? a.credits ?? usage?.credits_left;
  return typeof v === "number" || typeof v === "string" ? String(v) : null;
}

function openSong(url: string) {
  if (desktop) void desktop.openInPane("suno", url);
  else window.open(url, "_blank", "noreferrer");
}

/**
 * Suno, inside the app (official Suno MCP, signed in with the user's Suno account):
 * cover / extend the song's audio, a song from a MIDI clip, then save WAVs and stems into the song.
 */
export function SunoStudio({ projectId, files, onFilesChange }: { projectId: string; files: StoredFile[]; onFilesChange: (files: StoredFile[]) => void }) {
  const [status, setStatus] = useState<{ connected: boolean; usage?: any; error?: string } | null>(null);
  const [jobs, setJobs] = useState<SunoJob[]>([]);
  const [midi, setMidi] = useState<MidiClip[]>([]);
  const [source, setSource] = useState("");
  const [action, setAction] = useState<SunoJob["action"]>("cover");
  const [style, setStyle] = useState("");
  const [description, setDescription] = useState("");
  const [continueAt, setContinueAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const audio = files.filter((f) => f.mime.startsWith("audio/"));
  const results = jobs.flatMap((j) => j.clips.filter((c) => c.status === "complete").map((c) => ({ ...c, jobId: j.id })));
  const isMidi = source.startsWith("midi:");

  const refreshStatus = () =>
    api
      .sunoStatus()
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  const refreshJobs = () =>
    api
      .sunoJobs(projectId)
      .then((r) => setJobs(r.items))
      .catch(() => {});
  useEffect(() => {
    void refreshStatus();
    void refreshJobs();
    api
      .listMidi({ project: projectId })
      .then((r) => setMidi(r.items))
      .catch(() => {});
  }, [projectId]);
  // While something is running, poll.
  const running = jobs.some((j) => j.status === "uploading" || j.status === "generating" || Object.values(j.stems ?? {}).some((g) => g.status === "pending"));
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void refreshJobs(), 4000);
    return () => window.clearInterval(t);
  }, [running, projectId]);
  // Coming back from the browser sign-in.
  useEffect(() => {
    if (status?.connected) return;
    const on = () => void refreshStatus();
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, [status?.connected]);
  useEffect(() => {
    if (isMidi) setAction("midi");
    else if (action === "midi") setAction("cover");
  }, [source]);

  async function connect() {
    try {
      const r = await api.sunoLogin();
      if (!desktop) window.open(r.url, "_blank", "noreferrer");
      toast("ブラウザで Suno にサインインして、許可してください");
    } catch (e) {
      toast(e instanceof Error ? e.message : "接続できませんでした", { error: true });
    }
  }

  async function start() {
    if (!source) return;
    if (!window.confirm("Suno のクレジットを使って作ります(1 回で 2 曲できることがあります)。よいですか？")) return;
    const [kind, id] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
    const clip = results.find((c) => c.id === id);
    setBusy("start");
    try {
      const job = await api.sunoStart(projectId, {
        action,
        ...(kind === "file" ? { fileId: id } : kind === "midi" ? { midiClipId: id } : { clipId: id, clipName: clip?.title }),
        style: action !== "midi" ? style : undefined,
        description: action === "midi" ? description : undefined,
        continueAt: action === "extend" ? Number(continueAt) || undefined : undefined,
      });
      setJobs((x) => [job, ...x]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "始められませんでした", { error: true });
    } finally {
      setBusy(null);
    }
  }

  async function save(jobId: string, clip: { id: string; title: string }, name?: string) {
    setBusy(`dl:${clip.id}`);
    try {
      let r = await api.sunoDownload(jobId, clip.id, { format: "wav", name });
      if (r.requiresCredit) {
        if (!window.confirm("この曲のダウンロードには、Suno のダウンロード回数を 1 つ使います。よいですか？")) return;
        r = await api.sunoDownload(jobId, clip.id, { format: "wav", confirm: true, name });
      }
      if (r.file) {
        toast(`曲のファイルに保存: ${r.file.name}`);
        onFilesChange((await api.getProject(projectId)).files);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存できませんでした", { error: true });
    } finally {
      setBusy(null);
    }
  }

  async function stems(jobId: string, clip: SunoClip, mode: "two" | "twelve") {
    const cost = mode === "two" ? "10" : "50";
    if (!window.confirm(`ステムに分けます(${mode === "two" ? "ボーカル / 伴奏" : "12 パート"})。Suno のクレジットを ${cost} 使います。よいですか？`)) return;
    try {
      const job = await api.sunoStems(jobId, clip.id, mode);
      setJobs((x) => x.map((j) => (j.id === job.id ? job : j)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "ステムに分けられませんでした", { error: true });
    }
  }

  const credits = creditsOf(status?.usage);
  return (
    <section className="card suno-studio">
      <div className="section-head">
        <span className="sec-icon">✦</span>
        <h2 className="fx-en">SUNO STUDIO</h2>
        <span className="sec-line" />
        {status?.connected && <span className="muted small">{credits ? `残り ${credits} クレジット` : "接続済み"}</span>}
      </div>
      {!status ? (
        <p className="muted small">確認中…</p>
      ) : !status.connected ? (
        <div className="suno-connect">
          <p className="small">Suno のアカウントでつなぐと、この曲の音源や MIDI から Suno で曲を作り、WAV やステムをここに保存できます。</p>
          <button className="btn primary small" onClick={() => void connect()}>
            Suno に接続
          </button>
          <span className="muted small">ブラウザが開きます。許可したら、ここに戻ってください。</span>
        </div>
      ) : (
        <>
          <div className="suno-form">
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="元にするもの">
              <option value="">元にする音源・MIDI を選ぶ</option>
              {audio.length > 0 && (
                <optgroup label="この曲の音源">
                  {audio.map((f) => (
                    <option key={f.id} value={`file:${f.id}`}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {midi.length > 0 && (
                <optgroup label="この曲の MIDI">
                  {midi.map((m) => (
                    <option key={m.id} value={`midi:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {results.length > 0 && (
                <optgroup label="Suno で作った曲">
                  {results.map((c) => (
                    <option key={c.id} value={`clip:${c.id}`}>
                      {c.title || c.id}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="segmented" role="tablist">
              {(isMidi ? (["midi"] as const) : (["cover", "extend"] as const)).map((a) => (
                <button key={a} className={action === a ? "active" : ""} onClick={() => setAction(a)}>
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>
            {action === "midi" ? (
              <input value={description} placeholder="どんな曲に？(例: ロックバンドで、このベースを生かして)" onChange={(e) => setDescription(e.target.value)} />
            ) : (
              <input value={style} placeholder="スタイル(例: 90s J-rock, female vocal)" onChange={(e) => setStyle(e.target.value)} />
            )}
            {action === "extend" && (
              <label className="suno-at">
                <span>何秒から続ける</span>
                <input inputMode="decimal" value={continueAt} placeholder="30" onChange={(e) => setContinueAt(e.target.value)} />
              </label>
            )}
            <button className="btn primary small" disabled={!source || busy === "start"} onClick={() => void start()}>
              {busy === "start" ? "送っています…" : "Suno で作る"}
            </button>
          </div>

          {jobs.length > 0 && (
            <ul className="suno-jobs">
              {jobs.map((j) => (
                <li key={j.id} className={`suno-job s-${j.status}`}>
                  <div className="suno-job-head">
                    <b>{ACTION_LABEL[j.action]}</b>
                    <span className="muted small">{j.sourceName}</span>
                    <span className="suno-status">{STATUS_LABEL[j.status]}</span>
                    <button className="icon-btn" title="一覧から消す(Suno の曲は消えません)" onClick={() => void api.sunoDeleteJob(j.id).then(refreshJobs)}>
                      ×
                    </button>
                  </div>
                  {(j.style || j.description) && <p className="muted small">{j.style || j.description}</p>}
                  {j.error && (
                    <p className="error small">
                      {j.error}
                      {j.needLogin && (
                        <button className="link-btn" onClick={() => void connect()}>
                          接続し直す
                        </button>
                      )}
                    </p>
                  )}
                  {j.clips.map((c) => (
                    <div key={c.id} className="suno-clip">
                      <div className="suno-clip-row">
                        <span className="suno-clip-title">{c.title || "(作っています)"}</span>
                        {c.songUrl && (
                          <button className="link-btn" onClick={() => openSong(c.songUrl)} title="Suno で聴く">
                            聴く
                          </button>
                        )}
                        {c.status === "complete" && (
                          <>
                            <button className="link-btn" disabled={busy === `dl:${c.id}`} onClick={() => void save(j.id, c)} title="WAV をこの曲のファイルに保存">
                              {busy === `dl:${c.id}` ? "保存中…" : "WAV 保存"}
                            </button>
                            {!j.stems?.[c.id] && (
                              <select
                                className="chip-select"
                                value=""
                                onChange={(e) => e.target.value && void stems(j.id, c, e.target.value as "two" | "twelve")}
                                title="ステムに分ける"
                              >
                                <option value="">ステム</option>
                                <option value="two">ボーカル / 伴奏(10 クレジット)</option>
                                <option value="twelve">12 パート(50 クレジット)</option>
                              </select>
                            )}
                          </>
                        )}
                        {c.status === "error" && <span className="error small">失敗</span>}
                      </div>
                      {j.stems?.[c.id] && (
                        <div className="suno-stems">
                          {j.stems[c.id].status === "pending" ? (
                            <span className="muted small">ステムに分けています…(1〜2 分)</span>
                          ) : j.stems[c.id].error ? (
                            <span className="error small">{j.stems[c.id].error}</span>
                          ) : (
                            j.stems[c.id].items.map((s) => (
                              <button
                                key={s.id}
                                className="chip-btn"
                                disabled={busy === `dl:${s.id}`}
                                onClick={() => void save(j.id, { id: s.id, title: s.name }, `${c.title} - ${s.name}${s.take ? ` (take ${s.take})` : ""}`)}
                                title="この WAV を保存"
                              >
                                {busy === `dl:${s.id}` ? "…" : `↓ ${s.name}${s.take ? ` ${s.take}` : ""}`}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
