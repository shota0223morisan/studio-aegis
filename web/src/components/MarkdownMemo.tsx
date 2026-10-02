import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { saveLabel, useAutosave } from "../lib/useAutosave";

marked.setOptions({ gfm: true, breaks: true });

type Mode = "edit" | "split" | "preview";

/** Markdown note with edit / split / preview modes, autosaved. */
export function MarkdownMemo({
  title,
  subtitle,
  initial,
  save,
  placeholder,
  minHeight,
}: {
  title: string;
  subtitle?: string;
  initial: string;
  save: (value: string) => Promise<unknown>;
  placeholder?: string;
  minHeight?: number;
}) {
  const [text, setText] = useState(initial);
  const [mode, setMode] = useState<Mode>(initial ? "preview" : "edit");
  const autosave = useAutosave(save);

  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);

  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        {subtitle && <span className="muted small">{subtitle}</span>}
        <span className="save-state">{saveLabel(autosave.state)}</span>
        <div className="segmented" role="tablist">
          {(["edit", "split", "preview"] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {{ edit: "編集", split: "分割", preview: "表示" }[m]}
            </button>
          ))}
        </div>
      </div>
      <div className={`md-editor mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            className="memo-textarea"
            style={minHeight ? { minHeight } : undefined}
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              autosave.change(e.target.value);
            }}
            onBlur={() => void autosave.flush()}
          />
        )}
        {mode !== "edit" && (
          <div
            className="markdown"
            onDoubleClick={() => mode === "preview" && setMode("edit")}
            title={mode === "preview" ? "ダブルクリックで編集" : undefined}
          >
            {text.trim() ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="muted">まだ何も書かれていません(ダブルクリックで編集)</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
