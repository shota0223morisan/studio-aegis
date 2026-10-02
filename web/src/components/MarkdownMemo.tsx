import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api } from "../lib/api";
import { saveLabel, useAutosave } from "../lib/useAutosave";

marked.setOptions({ gfm: true, breaks: true });

type Mode = "edit" | "split" | "preview";

const PLACEHOLDER = `## 構成
Intro (8) → A (16) → B (8) → サビ (16) → ...

## 進行
| セクション | コード |
|---|---|
| A | IVmaj7 - V - iii - vi |

- BPM: 
- Key: 
- 参考: `;

/** 構成・進行イメージ: Markdown editor with live preview, autosaved. */
export function MarkdownMemo({ projectId, initial }: { projectId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [mode, setMode] = useState<Mode>(initial ? "preview" : "edit");
  const autosave = useAutosave((value: string) => api.updateProject(projectId, { structureMemo: value }));

  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);

  return (
    <>
      <div className="section-head">
        <h2>構成・進行イメージ</h2>
        <span className="save-state">{saveLabel(autosave.state)}</span>
        <div className="segmented" role="tablist">
          {(["edit", "split", "preview"] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {{ edit: "編集", split: "分割", preview: "プレビュー" }[m]}
            </button>
          ))}
        </div>
      </div>
      <div className={`md-editor mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            className="memo-textarea mono"
            value={text}
            placeholder={PLACEHOLDER}
            spellCheck={false}
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
