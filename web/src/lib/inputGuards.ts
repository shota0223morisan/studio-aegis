/**
 * App-wide input rules.
 *
 * Enter: Japanese input confirms a conversion with Enter, so a plain Enter must never send.
 * - While composing (IME), Enter is left to the IME and never reaches the app's handlers.
 * - In a one-line field, plain Enter does nothing; ⌘Enter (Ctrl+Enter) sends — the field's form
 *   is submitted, or its own Enter handler runs. Fields marked `data-enter="commit"` (renaming
 *   in place) still take a plain Enter.
 * - In a textarea, Enter is a new line; ⌘Enter goes to the field's own handler.
 *
 * Files: a file dropped anywhere that isn't a drop zone must not make the window open it.
 */
export function installInputGuards() {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement | null;
    if (!t || !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    if (e.isComposing || e.keyCode === 229) {
      e.stopPropagation();
      return;
    }
    const send = e.metaKey || e.ctrlKey;
    if (t instanceof HTMLTextAreaElement) return; // new line, or the field's own ⌘Enter handler
    if (t.type === "checkbox" || t.type === "radio" || t.type === "file") return;
    if (!send) {
      if (t.dataset.enter === "commit") return;
      e.preventDefault(); // no implicit form submission
      e.stopPropagation(); // no "Enter sends" handlers
      return;
    }
    if (t.form) {
      e.preventDefault();
      e.stopPropagation();
      t.form.requestSubmit();
    }
    // Not in a form: the field's own Enter handler gets it.
  };
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files") && !e.defaultPrevented) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    }
  };
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  };
}

export const isMidiFile = (f: File) => /\.midi?$/i.test(f.name) || f.type === "audio/midi" || f.type === "audio/x-midi";

/**
 * A MIDI row being dragged out to the DAW also shows up as "Files" over our own window:
 * remember it, so the drop zones don't open for it. Cleared once the mouse moves again
 * (the renderer gets no mouse events during a native drag).
 */
let draggingOut = false;
export function markDragOut() {
  draggingOut = true;
  const clear = () => {
    draggingOut = false;
    window.removeEventListener("mousemove", clear);
  };
  window.addEventListener("mousemove", clear);
}
export const isDraggingOut = () => draggingOut;
