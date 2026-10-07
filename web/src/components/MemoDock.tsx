import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { saveLabel, useAutosave } from "../lib/useAutosave";
import { api } from "../lib/api";

export interface MemoTab {
  id: string;
  label: string;
  /** Small caption under the label (e.g. the stage name). */
  sub?: string;
  value: string;
  save: (text: string) => Promise<unknown>;
  placeholder?: string;
}

const KEY = "aegis.memoDock";
const LAYOUT_KEY = "aegis.memoLayout";
/** Wide enough to dock the memo as a column on the right (e.g. FOCUS). */
const WIDE = "(min-width: 1480px)";

interface Layout {
  /** On a wide window: float instead of docking. */
  float: boolean;
  w: number;
  h: number;
  dockW: number;
}
const DEFAULT_LAYOUT: Layout = { float: false, w: 340, h: 340, dockW: 340 };

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) !== "min";
  } catch {
    return true;
  }
};
const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

/**
 * 自分用メモ, outside the page scroll. A wide window docks it on the right (× pops it out); a
 * narrow one floats it over the bottom-right corner, sized by dragging its top-left corner.
 * Either way it folds into a small button.
 */
export function MemoDock({ tabs, active: activeProp, title = "自分用メモ" }: { tabs: MemoTab[]; active?: string; title?: string }) {
  const [open, setOpen] = useState(readOpen);
  const [layout, setLayout] = useState<Layout>(() => load(LAYOUT_KEY, DEFAULT_LAYOUT));
  const [active, setActive] = useState(activeProp ?? tabs[0]?.id);
  const wide = useMedia(WIDE);
  const slot = useSlot();
  // Follow the page (e.g. the stage being viewed) when it changes.
  useEffect(() => {
    if (activeProp) setActive(activeProp);
  }, [activeProp]);
  useEffect(() => store(KEY, open ? "open" : "min"), [open]);
  useEffect(() => store(LAYOUT_KEY, JSON.stringify(layout)), [layout]);
  useEffect(() => {
    document.documentElement.style.setProperty("--memo-w", `${layout.dockW}px`);
  }, [layout.dockW]);

  const docked = wide && !layout.float;
  const set = (patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch }));

  /** Drag to resize: the popup from its top-left corner, the docked column from its left edge. */
  function startResize(e: React.PointerEvent, mode: "corner" | "edge") {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const { w, h, dockW } = layout;
    const move = (ev: PointerEvent) => {
      const dx = x0 - ev.clientX;
      const dy = y0 - ev.clientY;
      if (mode === "edge") set({ dockW: clamp(dockW + dx, 260, Math.min(720, window.innerWidth * 0.45)) });
      else set({ w: clamp(w + dx, 260, window.innerWidth - 40), h: clamp(h + dy, 180, window.innerHeight - 90) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("memo-resizing");
    };
    document.body.classList.add("memo-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!slot || !tab) return null;
  const filled = tabs.filter((t) => t.value.trim()).length;

  return createPortal(
    open ? (
      <aside
        className={`memo-dock open ${docked ? "docked" : "floating"}`}
        aria-label={title}
        style={docked ? undefined : { width: Math.min(layout.w, window.innerWidth - 32), height: Math.min(layout.h, window.innerHeight - 90) }}
      >
        {docked ? (
          <div className="memo-resize-edge" onPointerDown={(e) => startResize(e, "edge")} title="ドラッグで幅を変える" />
        ) : (
          <div className="memo-resize-corner" onPointerDown={(e) => startResize(e, "corner")} title="ドラッグで大きさを変える" />
        )}
        <div className="memo-dock-head">
          <span className="memo-dock-icon" aria-hidden>
            ✎
          </span>
          <b>{title}</b>
          <span className="memo-dock-tools">
            {wide && !docked && (
              <button className="icon-btn" onClick={() => set({ float: false })} title="右に固定する" aria-label="右に固定する">
                ⇥
              </button>
            )}
            <button className="icon-btn" onClick={() => setOpen(false)} title="しまう(右下のボタンになります)" aria-label="メモをしまう">
              ⌄
            </button>
            {docked && (
              <button className="icon-btn" onClick={() => set({ float: true })} title="右から外してポップアップにする" aria-label="ポップアップにする">
                ✕
              </button>
            )}
          </span>
        </div>
        {tabs.length > 1 && (
          <div className="memo-dock-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === tab.id}
                className={`${t.id === tab.id ? "on" : ""} ${t.value.trim() ? "has" : ""}`}
                onClick={() => setActive(t.id)}
                title={t.sub}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <DockEditor key={tab.id} tab={tab} />
      </aside>
    ) : (
      <button className="memo-fab" onClick={() => setOpen(true)} title="自分用メモを開く">
        <span aria-hidden>✎</span> メモ{filled > 0 && (tabs.length > 1 ? <small>{filled}</small> : <i className="memo-fab-dot" aria-label="書いてあります" />)}
      </button>
    ),
    slot,
  );
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function DockEditor({ tab }: { tab: MemoTab }) {
  const [text, setText] = useState(tab.value);
  const autosave = useAutosave(tab.save);
  return (
    <div className="memo-dock-body">
      <div className="memo-dock-sub">
        <span>{tab.sub}</span>
        <span className="save-state">{saveLabel(autosave.state)}</span>
      </div>
      <textarea
        className="memo-dock-text"
        value={text}
        placeholder={tab.placeholder ?? "メモ"}
        onChange={(e) => {
          setText(e.target.value);
          autosave.change(e.target.value);
        }}
        onBlur={() => void autosave.flush()}
      />
    </div>
  );
}

function useSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("memo-slot")), []);
  return slot;
}

/** The memo for pages that aren't a song (home, clients, MIDI, settings). */
export function ScratchMemoDock() {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    api.scratch().then((r) => setValue(r.text)).catch(() => setValue(""));
  }, []);
  if (value === null) return null;
  return (
    <MemoDock
      title="ひらめきメモ"
      tabs={[{ id: "scratch", label: "ひらめき", sub: "どの曲にも属さないメモ", value, save: (t) => api.setScratch(t).then((r) => setValue(r.text)), placeholder: "思いついたこと、次にやりたいこと…" }]}
    />
  );
}
