import { useRef } from "react";
import { desktop, type PaneSide } from "../lib/desktop";

/** Drag handle on the app's left / right edge that resizes that side pane of the desktop app. */
export function PaneDivider({ side }: { side: PaneSide }) {
  const dragging = useRef(false);
  if (!desktop) return null;
  return (
    <div
      className={`pane-divider ${side}`}
      role="separator"
      aria-orientation="vertical"
      title={`ドラッグで${side === "left" ? "左" : "右"}パネルの幅を変更`}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => dragging.current && desktop!.paneDrag(side, e.screenX)}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove("resizing");
        desktop!.paneDragEnd();
      }}
    />
  );
}
