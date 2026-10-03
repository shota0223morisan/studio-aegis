import { useState } from "react";
import type { NotionBlock, RichText } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { useGate } from "../../lib/gate";
import { useMixChecklist, useMixTips } from "../../lib/mixTips";
import type { StageProps } from "./types";

function openUrl(url: string) {
  if (desktop) void desktop.openInPane("web", url);
  else window.open(url, "_blank", "noreferrer");
}

/** STAGE 04 MIXING: the user's own Mixing Tips (Notion), with the pre-export checklist ticked per song. */
export function MixingStage({ flow, update }: StageProps) {
  const { page, refresh } = useMixTips();
  return (
    <>
      <PreExportCheck flow={flow} update={update} />

      <section className="card notion-page">
        <div className="section-head">
          <span className="sec-index">02</span>
          <span className="sec-icon">{page?.icon || "🎚️"}</span>
          <h2>{page?.title ?? "Mixing Tips"}</h2>
          <span className="sec-line" />
          <button className="btn ghost small" onClick={() => void refresh()}>
            更新
          </button>
          {page?.url && (
            <button className="btn ghost small" onClick={() => openUrl(page.url)}>
              Notion で開く
            </button>
          )}
        </div>
        {page && !page.configured && <p className="muted small">Notion 未接続(設定から)</p>}
        {page?.error && <p className="error small">{page.error}</p>}
        {page?.blocks.length ? <Blocks blocks={page.blocks.filter((b) => b.type !== "to_do")} /> : null}
      </section>
    </>
  );
}

/**
 * The pre-export checklist: shared by every song (order / add / edit / delete / restore), ticked per
 * song. Items parked in earlier stages follow, for this song only.
 */
function PreExportCheck({ flow, update }: Pick<StageProps, "flow" | "update">) {
  const list = useMixChecklist();
  const gate = useGate();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const checkOf = (id: string) => gate?.checks.find((c) => c.id === id);
  const parked = flow.parked ?? [];

  function finishEdit(id: string) {
    const text = editText.trim();
    if (text) void list.edit(id, text);
    setEditing(null);
  }

  return (
    <section className="card mix-checks">
      <div className="section-head">
        <span className="sec-index">01</span>
        <h2 className="fx-en">PRE-EXPORT CHECK</h2>
        <span className="sec-line" />
      </div>
      <ul className="check-list" onDragOver={(e) => dragId && e.preventDefault()}>
        {list.items.map((it) => {
          const c = checkOf(`mix-${it.id}`);
          const ok = Boolean(c?.ok);
          return (
            <li
              key={it.id}
              className={`${ok ? "ok" : ""} ${dragId === it.id ? "dragging" : ""} ${overId === it.id && dragId !== it.id ? "drop-before" : ""}`}
              draggable={editing !== it.id}
              onDragStart={(e) => {
                setDragId(it.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(it.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) list.move(dragId, it.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="check-handle" title="ドラッグで並べ替え">
                ⠿
              </span>
              <button className="gate-box" onClick={() => c && gate?.toggle(c)} aria-pressed={ok}>
                {ok ? "✓" : ""}
              </button>
              {editing === it.id ? (
                <input
                  className="check-edit"
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => finishEdit(it.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishEdit(it.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="check-text" onClick={() => c && gate?.toggle(c)} onDoubleClick={() => (setEditing(it.id), setEditText(it.text))}>
                  {it.text}
                </span>
              )}
              <span className="check-tools">
                <button className="icon-btn" title="編集" onClick={() => (setEditing(it.id), setEditText(it.text))}>
                  ✎
                </button>
                <button className="icon-btn danger" title="削除(下の「削除した項目」から戻せます)" onClick={() => void list.remove(it.id)}>
                  ×
                </button>
              </span>
            </li>
          );
        })}
        {dragId && (
          <li
            className={`drop-end ${overId === "__end" ? "drop-before" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverId("__end");
            }}
            onDrop={(e) => {
              e.preventDefault();
              list.move(dragId, null);
              setDragId(null);
              setOverId(null);
            }}
          />
        )}
        {parked.map((p) => (
          <li key={p.id} className={p.done ? "ok" : ""}>
            <span className="check-handle" />
            <button
              className="gate-box"
              onClick={() => update((f) => ({ ...f, parked: (f.parked ?? []).map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)) }))}
              aria-pressed={Boolean(p.done)}
            >
              {p.done ? "✓" : ""}
            </button>
            <span className="check-text">{p.text}</span>
            <small className="park-to">この曲だけ</small>
            <span className="check-tools">
              <button className="icon-btn danger" title="消す" onClick={() => update((f) => ({ ...f, parked: (f.parked ?? []).filter((x) => x.id !== p.id) }))}>
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          void list.add(draft.trim());
          setDraft("");
        }}
      >
        <input value={draft} placeholder="＋ 項目" onChange={(e) => setDraft(e.target.value)} />
      </form>
      {list.deleted.length > 0 && (
        <details className="check-deleted">
          <summary>削除した項目({list.deleted.length})</summary>
          <ul>
            {list.deleted.map((it) => (
              <li key={it.id}>
                <span>{it.text}</span>
                <button className="btn small ghost" onClick={() => void list.restore(it.id)}>
                  戻す
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Rich({ text }: { text: RichText[] }) {
  return (
    <>
      {text.map((t, i) => {
        let node: React.ReactNode = t.t;
        if (t.c) node = <code>{node}</code>;
        if (t.b) node = <b>{node}</b>;
        if (t.i) node = <i>{node}</i>;
        if (t.s) node = <s>{node}</s>;
        if (t.href)
          node = (
            <a
              href={t.href}
              onClick={(e) => {
                e.preventDefault();
                openUrl(t.href!);
              }}
            >
              {node}
            </a>
          );
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

/** A small Notion renderer (headings / toggles / lists / quotes / callouts / code). */
function Blocks({ blocks }: { blocks: NotionBlock[] }) {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
      const type = b.type;
      const items: NotionBlock[] = [];
      while (i < blocks.length && blocks[i].type === type) items.push(blocks[i++]);
      const Tag = type === "bulleted_list_item" ? "ul" : "ol";
      out.push(
        <Tag key={items[0].id}>
          {items.map((it) => (
            <li key={it.id}>
              <Rich text={it.text} />
              {it.children && <Blocks blocks={it.children} />}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    out.push(<Block key={b.id} b={b} />);
    i++;
  }
  return <div className="nb">{out}</div>;
}

function Block({ b }: { b: NotionBlock }) {
  const kids = b.children?.length ? <Blocks blocks={b.children} /> : null;
  if (b.type.startsWith("heading_")) {
    const H = (b.type === "heading_1" ? "h3" : "h4") as "h3" | "h4";
    if (b.toggle || kids) {
      return (
        <details className="nb-toggle">
          <summary>
            <H>
              <Rich text={b.text} />
            </H>
          </summary>
          {kids}
        </details>
      );
    }
    return (
      <H>
        <Rich text={b.text} />
      </H>
    );
  }
  switch (b.type) {
    case "toggle":
      return (
        <details className="nb-toggle">
          <summary>
            <Rich text={b.text} />
          </summary>
          {kids}
        </details>
      );
    case "divider":
      return <hr />;
    case "quote":
      return (
        <blockquote>
          <Rich text={b.text} />
          {kids}
        </blockquote>
      );
    case "callout":
      return (
        <div className="nb-callout">
          <span>{b.icon ?? "💡"}</span>
          <div>
            <Rich text={b.text} />
            {kids}
          </div>
        </div>
      );
    case "code":
      return (
        <pre>
          <code>{b.text.map((t) => t.t).join("")}</code>
        </pre>
      );
    case "to_do":
      return (
        <p className="nb-todo">
          ☐ <Rich text={b.text} />
        </p>
      );
    default:
      return (
        <>
          <p>
            <Rich text={b.text} />
          </p>
          {kids && <div className="nb-indent">{kids}</div>}
        </>
      );
  }
}
