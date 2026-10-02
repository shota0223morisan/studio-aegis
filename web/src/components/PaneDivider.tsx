import { useRef } from "react";
import { desktop } from "../lib/desktop";

/** Drag handle on the app's left edge that resizes the desktop app's left pane. */
export function PaneDivider() {
  const dragging = useRef(false);
  if (!desktop) return null;
  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      title="ドラッグで左パネルの幅を変更"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => dragging.current && desktop!.paneDrag(e.screenX)}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove("resizing");
        desktop!.paneDragEnd();
      }}
    />
  );
}
