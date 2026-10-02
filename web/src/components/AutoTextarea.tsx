import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** Textarea that grows and shrinks with its content (no inner scrollbar). */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={3} {...props} className={`autosize ${props.className ?? ""}`} />;
}
