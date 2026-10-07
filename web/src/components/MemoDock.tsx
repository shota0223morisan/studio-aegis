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
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) !== "min";
  } catch {
    return true;
  }
};

/**
 * 自分用メモ, outside the page scroll. A wide window docks it on the right; a narrow one floats it
 * over the bottom-right corner. Either way it folds into a small button.
 */
export function MemoDock({ tabs, active: activeProp, title = "自分用メモ" }: { tabs: MemoTab[]; active?: string; title?: string }) {
  const [open, setOpen] = useState(readOpen);
  const [active, setActive] = useState(activeProp ?? tabs[0]?.id);
  const slot = useSlot();
  // Follow the page (e.g. the stage being viewed) when it changes.
  useEffect(() => {
    if (activeProp) setActive(activeProp);
  }, [activeProp]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? "open" : "min");
    } catch {
      /* ignore */
    }
  }, [open]);

  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!slot || !tab) return null;
  const filled = tabs.filter((t) => t.value.trim()).length;

  return createPortal(
    open ? (
      <aside className="memo-dock open" aria-label={title}>
        <div className="memo-dock-head">
          <span className="memo-dock-icon" aria-hidden>
            ✎
          </span>
          <b>{title}</b>
          <button className="icon-btn memo-dock-min" onClick={() => setOpen(false)} title="しまう" aria-label="メモをしまう">
            ⌄
          </button>
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
        <span aria-hidden>✎</span> メモ{filled > 0 && <small>{filled}</small>}
      </button>
    ),
    slot,
  );
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
