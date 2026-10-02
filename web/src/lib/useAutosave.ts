import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Debounced autosave. Call `change(value)` on every edit; the latest value is
 * saved `delay` ms after typing stops, and flushed on unmount / tab close.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 800) {
  const [state, setState] = useState<SaveState>("idle");
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setState("saving");
    try {
      await saveRef.current(p.value);
      setState(pending.current ? "dirty" : "saved");
    } catch {
      pending.current ??= p;
      setState("error");
      timer.current = window.setTimeout(() => void flushRef.current(), 3000);
    }
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const change = useCallback(
    (value: T) => {
      pending.current = { value };
      setState("dirty");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
  }, [flush]);

  return { state, change, flush };
}

export function saveLabel(state: SaveState): string {
  return { idle: "", dirty: "編集中…", saving: "保存中…", saved: "保存済み", error: "保存に失敗 — 再試行します" }[state];
}
