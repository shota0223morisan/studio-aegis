import { useEffect, useRef, useState } from "react";
import { setTheme, THEMES, useTheme } from "../lib/theme";

/** Topbar theme switcher. Each option is rendered in its own theme so you can see it before picking. */
export function ThemePicker() {
  const current = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button className="btn ghost small" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        🎨 {THEMES.find((t) => t.id === current)?.name}
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === current}
              data-theme={t.id}
              className={`theme-option ${t.id === current ? "selected" : ""}`}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              {t.name}
              <span className="swatch" aria-hidden>
                {t.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Large previews for the settings screen. */
export function ThemeGallery() {
  const current = useTheme();
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button
          key={t.id}
          data-theme={t.id}
          className={`theme-preview ${t.id === current ? "selected" : ""}`}
          onClick={() => setTheme(t.id)}
          aria-pressed={t.id === current}
        >
          <span className="tp-name">{t.name}</span>
          <span className="tp-card">
            <span className="tp-title">構成・進行イメージ</span>
            <span className="tp-row">
              <span className="tp-btn">保存</span>
              <span className="tp-tag">曲</span>
            </span>
          </span>
          <span className="tp-desc">{t.desc}</span>
        </button>
      ))}
    </div>
  );
}
