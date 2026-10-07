import { createContext, useContext, type ReactNode } from "react";
import type { Check } from "./flow";

/** The EXIT GATE checks of the stage on screen, so each card can show (and tick) its own. */
interface GateCtx {
  checks: Check[];
  toggle: (check: Check) => void;
}

const Ctx = createContext<GateCtx | null>(null);

export function GateProvider({ checks, toggle, children }: GateCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ checks, toggle }}>{children}</Ctx.Provider>;
}

export const useGate = () => useContext(Ctx);

/** Checkboxes in a card's header for the gate items that card covers. */
export function CardChecks({ ids }: { ids: string[] }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const items = ids.map((id) => ctx.checks.find((c) => c.id === id)).filter((c): c is Check => Boolean(c));
  if (!items.length) return null;
  return (
    <span className="card-checks">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`card-check ${c.ok ? "ok" : ""} ${c.auto ? "is-auto" : ""}`}
          onClick={() => !c.auto && ctx.toggle(c)}
          aria-pressed={c.ok}
          title={c.auto ? "入力済み" : c.ok ? "チェックを外す" : "決めたらチェック(EXIT GATE に反映)"}
        >
          <span className="card-check-box">{c.ok ? "✓" : ""}</span>
          {c.label}
        </button>
      ))}
    </span>
  );
}
