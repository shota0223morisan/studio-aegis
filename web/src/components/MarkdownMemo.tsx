import { useMemo, useState, type ReactNode } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { saveLabel, useAutosave } from "../lib/useAutosave";
import { AutoTextarea } from "./AutoTextarea";

marked.setOptions({ gfm: true, breaks: true });

/**
 * Markdown note: shows the rendered text, click 「編集」 (or double-click) to edit.
 * Both the editor and the view size themselves to the amount of text.
 */
export function MarkdownMemo({
  title,
  index,
  icon,
  subtitle,
  initial,
  save,
  placeholder,
  children,
}: {
  title: string;
  index?: string;
  icon?: string;
  subtitle?: string;
  initial: string;
  save: (value: string) => Promise<unknown>;
  placeholder?: string;
  children?: ReactNode;
}) {
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(!initial.trim());
  const autosave = useAutosave(save);

  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);

  return (
    <>
      <div className="section-head">
        {index && <span className="sec-index">{index}</span>}
        {icon && <span className="sec-icon" aria-hidden>{icon}</span>}
        <h2>{title}</h2>
        {subtitle && <span className="muted small">{subtitle}</span>}
        <span className="save-state">{saveLabel(autosave.state)}</span>
        <span className="sec-line" aria-hidden />
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={editing} className={editing ? "active" : ""} onClick={() => setEditing(true)}>
            編集
          </button>
          <button role="tab" aria-selected={!editing} className={!editing ? "active" : ""} onClick={() => setEditing(false)}>
            表示
          </button>
        </div>
      </div>
      {editing ? (
        <AutoTextarea
          className="memo-textarea"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            autosave.change(e.target.value);
          }}
          onBlur={() => void autosave.flush()}
        />
      ) : (
        <div className="markdown" onDoubleClick={() => setEditing(true)} title="ダブルクリックで編集">
          {text.trim() ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p className="muted">まだ何も書かれていません(ダブルクリックで編集)</p>}
        </div>
      )}
      {children}
    </>
  );
}
