import { setTheme, THEMES, useTheme } from "../lib/theme";

/** One-click theme switch in the header: one dot per theme. */
export function ThemeDots() {
  const current = useTheme();
  return (
    <div className="theme-dots" role="radiogroup" aria-label="デザインテーマ">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={t.id === current}
          title={`${t.name} — ${t.desc}`}
          className={t.id === current ? "on" : ""}
          style={{ background: `linear-gradient(135deg, ${t.swatch[1]} 0 50%, ${t.swatch[2]} 50% 100%)`, outlineColor: t.swatch[1] }}
          onClick={() => setTheme(t.id)}
        />
      ))}
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
            <span className="tp-title">先方からの指示</span>
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
