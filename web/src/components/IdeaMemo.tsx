import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../lib/api";
import { saveLabel, useAutosave } from "../lib/useAutosave";

const BULLET = /^(\s*)([-*・]|\d+\.)\s+/;

/**
 * 雑多アイデアメモ: a scratchpad tuned for bullet dumping.
 * Enter continues the current bullet; Enter on an empty bullet ends the list;
 * Tab / Shift+Tab indent.
 */
export function IdeaMemo({ projectId, initial }: { projectId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Caret to restore after a programmatic edit; applied synchronously after the DOM update
  // so fast typing can't land in between.
  const pendingCaret = useRef<number | null>(null);
  const autosave = useAutosave((value: string) => api.updateProject(projectId, { ideaMemo: value }));

  function update(value: string, caret?: number) {
    setText(value);
    autosave.change(value);
    if (caret !== undefined) pendingCaret.current = caret;
  }

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const line = value.slice(lineStart, start);

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && start === end) {
      const m = line.match(BULLET);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[0].trim()) {
        // Empty bullet → remove it and stop the list.
        update(value.slice(0, lineStart) + value.slice(start), lineStart);
        return;
      }
      const marker = /\d+\./.test(m[2]) ? `${Number.parseInt(m[2], 10) + 1}.` : m[2];
      const insert = `\n${m[1]}${marker} `;
      update(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    } else if (e.key === "Tab" && BULLET.test(value.slice(lineStart))) {
      e.preventDefault();
      if (e.shiftKey) {
        const remove = value.slice(lineStart).match(/^ {1,2}/)?.[0].length ?? 0;
        update(value.slice(0, lineStart) + value.slice(lineStart + remove), Math.max(lineStart, start - remove));
      } else {
        update(`${value.slice(0, lineStart)}  ${value.slice(lineStart)}`, start + 2);
      }
    }
  }

  return (
    <>
      <div className="section-head">
        <h2>雑多アイデア</h2>
        <span className="save-state">{saveLabel(autosave.state)}</span>
      </div>
      <textarea
        ref={ref}
        className="memo-textarea idea"
        value={text}
        placeholder={"- 思いついたことをとにかく書く\n- Enter で次の項目、空行で Enter するとリスト終了\n- Tab でインデント"}
        onFocus={() => {
          if (!text) update("- ", 2);
        }}
        onChange={(e) => update(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (text === "- ") update("");
          void autosave.flush();
        }}
      />
    </>
  );
}
