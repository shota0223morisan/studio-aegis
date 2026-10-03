import { useState } from "react";
import type { NotionBlock, RichText } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { uid } from "../../lib/flow";
import { useMixTips } from "../../lib/mixTips";
import type { StageProps } from "./types";

function openUrl(url: string) {
  if (desktop) void desktop.openInPane("web", url);
  else window.open(url, "_blank", "noreferrer");
}

/** STAGE 04 MIXING: the user's own Mixing Tips (Notion), with the pre-export checklist ticked per song. */
export function MixingStage({ flow, update }: StageProps) {
  const { page, items, fromNotion, refresh } = useMixTips();
  const [extra, setExtra] = useState("");
  const checks = flow.mixChecks ?? {};
  const toggle = (label: string) => update((f) => ({ ...f, mixChecks: { ...f.mixChecks, [label]: !f.mixChecks?.[label] } }));
  const parked = flow.parked ?? [];

  return (
    <>
      <section className="card mix-checks">
        <div className="section-head">
          <span className="sec-index">01</span>
          <h2 className="fx-en">PRE-EXPORT CHECK</h2>
          <span className="sec-line" />
        </div>
        <ul className="check-list">
          {items.map((label) => (
            <li key={label} className={checks[label] ? "ok" : ""}>
              <button className="gate-box" onClick={() => toggle(label)} aria-pressed={Boolean(checks[label])}>
                {checks[label] ? "✓" : ""}
              </button>
              <span onClick={() => toggle(label)}>{label}</span>
            </li>
          ))}
          {parked.map((p) => (
            <li key={p.id} className={p.done ? "ok" : ""}>
              <button
                className="gate-box"
                onClick={() => update((f) => ({ ...f, parked: (f.parked ?? []).map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)) }))}
                aria-pressed={Boolean(p.done)}
              >
                {p.done ? "✓" : ""}
              </button>
              <span>{p.text}</span>
              <small className="park-to">保留していたこと</small>
            </li>
          ))}
        </ul>
        <form
          className="inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!extra.trim()) return;
            update((f) => ({ ...f, parked: [...(f.parked ?? []), { id: uid(), text: extra.trim(), from: 4 }] }));
            setExtra("");
          }}
        >
          <input value={extra} placeholder="＋ 項目" onChange={(e) => setExtra(e.target.value)} />
        </form>
      </section>

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
