import { useEffect, useState } from "react";

type Toast = { text: string; error?: boolean; id: number };
let listener: ((t: Toast | null) => void) | null = null;
let timer: number | undefined;
let seq = 0;

/** Show a short message at the bottom of the window (ms: 0 = until the next one). */
export function toast(text: string, opts: { error?: boolean; ms?: number } = {}) {
  window.clearTimeout(timer);
  listener?.({ text, error: opts.error, id: ++seq });
  const ms = opts.ms ?? 3500;
  if (ms) timer = window.setTimeout(() => listener?.(null), ms);
}

export function useToast() {
  const [t, setT] = useState<Toast | null>(null);
  useEffect(() => {
    listener = setT;
    return () => {
      listener = null;
    };
  }, []);
  return t;
}
