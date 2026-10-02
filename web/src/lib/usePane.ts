import { useEffect, useState } from "react";
import { desktop, type PaneState } from "./desktop";

/** Live state of the desktop app's left pane (null in a plain browser). */
export function usePane(): PaneState | null {
  const [state, setState] = useState<PaneState | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.getPaneState().then(setState);
    return desktop.onPaneState(setState);
  }, []);
  return state;
}
