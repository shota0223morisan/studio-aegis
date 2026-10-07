import { useEffect } from "react";

/** Party layer: confetti for clearing a stage / submitting, sparkles for ticking a box. */
const VARS = ["--accent", "--accent-2", "--s1", "--s2", "--s3", "--s4", "--s5"];

function palette(): string[] {
  const cs = getComputedStyle(document.documentElement);
  return VARS.map((v) => cs.getPropertyValue(v).trim()).filter((c) => c && !c.includes("gradient"));
}

function layer(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "fx-layer";
  document.body.appendChild(el);
  return el;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function confetti(amount = 110) {
  if (reduced()) return;
  const colors = palette();
  const el = layer();
  for (let i = 0; i < amount; i++) {
    const p = document.createElement("i");
    p.className = "fx-confetti";
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length] || "#fff";
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 240}px`);
    p.style.setProperty("--rot", `${(Math.random() - 0.5) * 1440}deg`);
    p.style.setProperty("--dur", `${1.6 + Math.random() * 1.6}s`);
    p.style.animationDelay = `${Math.random() * 0.35}s`;
    if (Math.random() < 0.35) p.style.borderRadius = "50%";
    el.appendChild(p);
  }
  window.setTimeout(() => el.remove(), 3800);
}

export function sparkle(x: number, y: number) {
  if (reduced()) return;
  const colors = palette();
  const el = layer();
  for (let i = 0; i < 12; i++) {
    const p = document.createElement("i");
    p.className = "fx-spark";
    const a = (i / 12) * Math.PI * 2;
    const d = 22 + Math.random() * 18;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = colors[i % colors.length] || "#fff";
    p.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    el.appendChild(p);
  }
  window.setTimeout(() => el.remove(), 700);
}

/** Sparkle whenever a checkbox-like control turns on. */
export function useTickSparkles() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest(".gate-box, .card-check, .core-done, .check-text, .gate-label");
      if (!t) return;
      const box = t.matches(".check-text, .gate-label") ? t.parentElement?.querySelector(".gate-box") ?? t : t;
      window.requestAnimationFrame(() =>
        window.setTimeout(() => {
          const on = box.getAttribute("aria-pressed") === "true" || box.classList.contains("on") || box.classList.contains("ok");
          if (!on) return;
          const r = box.getBoundingClientRect();
          sparkle(r.left + r.width / 2, r.top + r.height / 2);
        }, 30),
      );
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
