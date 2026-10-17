import { desktop } from "../../lib/desktop";
import type { ChordScan } from "../../lib/chordScan";
import { chordName, KEY_OPTIONS, parseProgression } from "../../lib/theory";
import { toast } from "../../lib/toast";

function openSource(url: string) {
  if (desktop) void desktop.openInPane("web", url);
  else window.open(url, "_blank", "noreferrer");
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

async function copy(text: string) {
  try {
    if (desktop) await desktop.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast("コピーしました(骨組みのコード進行の一言入力に貼れます)");
  } catch {
    toast("コピーできませんでした", { error: true });
  }
}

/** The extracted progression: repeating loops (audio) or sections (AI), with chord names. */
export function ChordView({ scan, onSeek, onAi, onAudio, onUse }: { scan: ChordScan; onSeek?: (t: number) => void; onAi?: () => void; onAudio?: () => void; onUse?: (name: string, prog: string) => void }) {
  const names = (prog: string) => parseProgression(prog, scan.key).map((c) => chordName(c, scan.key)).join(" ");
  const keyLabel = KEY_OPTIONS[scan.key]?.label ?? "";
  const rows = scan.source === "audio" ? scan.patterns ?? [] : scan.sections ?? [];
  return (
    <div className="ref-chords">
      <div className="ref-chords-head">
        <b>CHORDS</b>
        <span className={scan.source === "audio" ? "auto" : "ai-badge"}>{scan.source === "audio" ? "AUTO" : "ネット・要確認"}</span>
        {rows.length > 0 && <span className="muted small">Key {keyLabel}</span>}
        <span className="ref-chords-tools">
          {onAi && (
            <button className="link-btn" onClick={onAi} title="この曲のコード進行をネットで調べる">
              ネットで調べる
            </button>
          )}
          {onAudio && (
            <button className="link-btn" onClick={onAudio} title="添付音源から抽出し直す">
              音源から
            </button>
          )}
        </span>
      </div>
      {rows.length === 0 && (
        <p className="muted small">
          {scan.source === "ai" ? "この曲のコード進行は見つかりませんでした。音源を添付すると、そこから抽出できます。" : "くり返す進行が見つかりませんでした。"}
        </p>
      )}
      <ul className="ref-chord-rows">
        {scan.source === "audio"
          ? (scan.patterns ?? []).map((p) => (
              <li key={p.prog}>
                <button className="chord-time" disabled={!onSeek} onClick={() => onSeek?.(p.at)} title={onSeek ? "ここから聴く" : undefined}>
                  {clock(p.at)}
                </button>
                <span className="chord-prog">
                  <b>{p.prog}</b>
                  <small>{names(p.prog)}</small>
                </span>
                <span className="chord-count">×{p.count}</span>
                <button className="link-btn" onClick={() => void copy(p.prog)} title="コピー">
                  コピー
                </button>
              </li>
            ))
          : (scan.sections ?? []).map((s, i) => (
              <li key={i}>
                <span className="chord-sec">{s.name}</span>
                <span className="chord-prog">
                  <b>{s.prog}</b>
                  <small>{names(s.prog)}</small>
                </span>
                {onUse ? (
                  <button className="link-btn" onClick={() => onUse(s.name, s.prog)} title="一言入力に入れる">
                    入れる
                  </button>
                ) : (
                  <button className="link-btn" onClick={() => void copy(`${s.name} ${s.prog}`)} title="コピー">
                    コピー
                  </button>
                )}
              </li>
            ))}
      </ul>
      {scan.source === "ai" && (scan.sections ?? []).length > 1 && (
        <button
          className="link-btn"
          onClick={() =>
            onUse ? (scan.sections ?? []).forEach((s) => onUse(s.name, s.prog)) : void copy((scan.sections ?? []).map((s) => `${s.name}: ${s.prog}`).join(" "))
          }
        >
          {onUse ? "全セクションをまとめて入れる" : "全セクションをまとめてコピー"}
        </button>
      )}
      {scan.note && <p className="muted small">{scan.note}</p>}
      {(scan.sources ?? []).length > 0 && (
        <p className="chord-sources small">
          出典:{" "}
          {(scan.sources ?? []).map((src, i) => (
            <button key={i} className="link-btn" onClick={() => openSource(src.url)} title={src.url}>
              {src.title || new URL(src.url).hostname}
            </button>
          ))}
        </p>
      )}
      {scan.source === "audio" && (scan.timeline ?? []).length > 0 && (
        <details className="chord-timeline">
          <summary>全体の流れ(4 小節ごと)</summary>
          <ul>
            {(scan.timeline ?? []).map((r, i) => (
              <li key={i}>
                <button className="chord-time" disabled={!onSeek} onClick={() => onSeek?.(r.at)}>
                  {clock(r.at)}
                </button>
                <span>{r.prog}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
