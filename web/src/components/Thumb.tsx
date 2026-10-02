import { hueFor } from "../lib/format";

/** Project thumbnail, or a typographic placeholder derived from the name. */
export function Thumb({ name, url, className = "" }: { name: string; url: string | null; className?: string }) {
  if (url) return <img className={`thumb ${className}`} src={url} alt="" loading="lazy" />;
  const hue = hueFor(name);
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <div className={`thumb thumb-placeholder ${className}`} style={{ "--hue": hue } as React.CSSProperties} aria-hidden>
      {initial}
    </div>
  );
}
