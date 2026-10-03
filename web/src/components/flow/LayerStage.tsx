import { useState } from "react";
import { LAYER_PRESETS, uid, type LayerPart } from "../../lib/flow";
import { CardChecks } from "../../lib/gate";
import { IdeasPanel } from "../IdeasPanel";
import { RefSelect } from "./FrameStage";
import { MidiSection } from "./MidiSection";
import type { StageProps } from "./types";

/** STAGE 03 LAYER: the upper parts, each with which reference (and where) it draws from. */
export function LayerStage({ project, flow, update }: StageProps) {
  const [custom, setCustom] = useState("");
  const parts = flow.parts ?? [];
  const set = (id: string, patch: Partial<LayerPart>) => update((f) => ({ ...f, parts: (f.parts ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const add = (name: string) => name.trim() && update((f) => ({ ...f, parts: [...(f.parts ?? []), { id: uid(), name: name.trim() }] }));

  return (
    <>
      <section className="card">
        <div className="section-head">
          <span className="sec-index">01</span>
          <h2 className="fx-en">LAYER MAP</h2>
          <span className="sec-line" />
          <CardChecks ids={["parts", "points", "done"]} />
        </div>
        <div className="layer-list">
          {parts.map((p) => (
            <div key={p.id} className={`layer-row ${p.done ? "ok" : ""}`}>
              <input className="layer-name" value={p.name} onChange={(e) => set(p.id, { name: e.target.value })} aria-label="パート" />
              <RefSelect flow={flow} value={p.ref} onChange={(ref) => set(p.id, { ref })} />
              <input value={p.point ?? ""} placeholder="参考にする所" onChange={(e) => set(p.id, { point: e.target.value })} />
              <button className={`btn small ${p.done ? "on core-done" : ""}`} onClick={() => set(p.id, { done: !p.done })}>
                {p.done ? "✓ 入れた" : "未"}
              </button>
              <button className="icon-btn danger" onClick={() => update((f) => ({ ...f, parts: (f.parts ?? []).filter((x) => x.id !== p.id) }))} title="削除">
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="arr-add">
          {LAYER_PRESETS.filter((n) => !parts.some((p) => p.name === n)).map((n) => (
            <button key={n} className="chip-btn" onClick={() => add(n)}>
              ＋ {n}
            </button>
          ))}
          <form
            className="inline-add"
            onSubmit={(e) => {
              e.preventDefault();
              add(custom);
              setCustom("");
            }}
          >
            <input value={custom} placeholder="＋ ほか" onChange={(e) => setCustom(e.target.value)} />
          </form>
        </div>
      </section>
      <MidiSection projectId={project.id} flow={flow} update={update} index="02" defaultKind="strings" />
      <section className="card">
        <IdeasPanel index="03" />
      </section>
    </>
  );
}
