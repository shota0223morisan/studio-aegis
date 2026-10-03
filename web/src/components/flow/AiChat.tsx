import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, type AiMessage } from "../../lib/api";
import { AutoTextarea } from "../AutoTextarea";

let statusPromise: Promise<{ found: boolean }> | null = null;
const aiStatus = () => (statusPromise ??= api.aiStatus().catch(() => ({ found: false })));

const md = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false }) as string);

/** AEGIS AI: a conversation per song × stage, through Claude Code on the subscription. */
export function AiChat({ projectId, stage, quick, placeholder }: { projectId: string; stage: number; quick: string[]; placeholder?: string }) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
    api
      .aiMessages(projectId, stage)
      .then((r) => setMessages(r.items))
      .catch(() => {});
    void aiStatus().then((s) => setFound(s.found));
    return () => abort.current?.abort();
  }, [projectId, stage]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, streaming]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || streaming !== null) return;
    setDraft("");
    setError(null);
    setStreaming("");
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const res = await fetch(`/api/projects/${projectId}/ai`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, text: body }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "user") setMessages((m) => [...m, ev.message]);
          else if (ev.type === "text") setStreaming((acc += ev.text));
          else if (ev.type === "done") setMessages((m) => [...m, ev.message]);
          else if (ev.type === "error") setError(ev.error);
        }
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "送信できませんでした");
    } finally {
      setStreaming(null);
      abort.current = null;
    }
  }

  const html = useMemo(() => (streaming ? md(streaming) : ""), [streaming]);

  return (
    <section className="card ai-card">
      <div className="section-head">
        <span className="sec-icon">✦</span>
        <h2 className="fx-en">AEGIS AI</h2>
        <span className="muted small">Claude(サブスク)</span>
        <span className="sec-line" />
        {messages.length > 0 && (
          <button
            className="btn ghost small"
            onClick={async () => {
              if (!window.confirm("このステージの会話を消しますか?")) return;
              await api.aiClear(projectId, stage);
              setMessages([]);
            }}
          >
            消去
          </button>
        )}
      </div>
      {!found && (
        <p className="ai-warn">
          Claude Code が見つかりません。Mac に Claude Code を入れて、ターミナルで <code>claude</code> → <code>/login</code> でサブスクのアカウントにログインしてください。
        </p>
      )}
      <div className="ai-list" ref={list}>
        {messages.length === 0 && streaming === null && <p className="muted small ai-empty">このステージのことを何でも相談できます。下のボタンからでも。</p>}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ai-msg me">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="ai-msg bot markdown" dangerouslySetInnerHTML={{ __html: md(m.text) }} />
          ),
        )}
        {streaming !== null && (
          <div className="ai-msg bot markdown streaming">
            {streaming ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <span className="ai-thinking">考え中…</span>}
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="ai-quick">
        {quick.map((q) => (
          <button key={q} className="chip-btn" disabled={streaming !== null} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <AutoTextarea
          value={draft}
          rows={1}
          placeholder={placeholder ?? "相談する…(⌘Enter で送信)"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        {streaming !== null ? (
          <button type="button" className="btn small" onClick={() => abort.current?.abort()}>
            止める
          </button>
        ) : (
          <button type="submit" className="btn small primary" disabled={!draft.trim()}>
            送信
          </button>
        )}
      </form>
    </section>
  );
}
