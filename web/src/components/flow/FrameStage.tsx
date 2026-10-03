import { useState } from "react";
import { SECTION_PRESETS, SLOT_KEYS, START_OPTIONS, STRUCTURE_TEMPLATES, filled, uid, type CorePart, type Flow, type Section } from "../../lib/flow";
import { IdeasPanel } from "../IdeasPanel";
import { MidiSection } from "./MidiSection";
import type { StageProps } from "./types";

const SECTION_CLASS: Record<string, string> = { Intro: "si", Outro: "si", A: "sa", B: "sb", サビ: "ss", 落ちサビ: "ss", 間奏: "sx", Dメロ: "sx" };

/** STAGE 02 FRAME: structure, where to start, chords, and the core three parts decided (even tentatively). */
export function FrameStage({ project, flow, update }: StageProps) {
  return (
    <>
      <StructureCard flow={flow} update={update} />
      <section className="card">
        <div className="section-head">
          <span className="sec-index">02</span>
          <h2 className="fx-en">START & CHORDS</h2>
          <span className="muted small">何から作る? / コード進行</span>
          <span className="sec-line" />
        </div>
        <div className="start-row">
          <span className="muted small">最初に作る</span>
          <div className="segmented">
            {START_OPTIONS.map((o) => (
              <button key={o.id} className={flow.startWith === o.id ? "active" : ""} onClick={() => update((f) => ({ ...f, startWith: o.id }))}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <ChordRows flow={flow} update={update} />
      </section>
      <CoreParts flow={flow} update={update} />
      <MidiSection projectId={project.id} flow={flow} index="04" defaultKind="drums" />
      <section className="card">
        <IdeasPanel index="05" />
      </section>
    </>
  );
}

function StructureCard({ flow, update }: Pick<StageProps, "flow" | "update">) {
  const [editing, setEditing] = useState<string | null>(null);
  const list = flow.structure ?? [];
  const set = (next: Section[]) => update((f) => ({ ...f, structure: next }));
  const totalBars = list.reduce((a, s) => a + (Number(s.bars) || 0), 0);
  const bpm = Number(String(flow.analysis?.bpm ?? "").match(/\d+(\.\d+)?/)?.[0]) || 0;
  const secs = bpm ? Math.round((totalBars * 4 * 60) / bpm) : 0;

  return (
    <section className="card">
      <div className="section-head">
        <span className="sec-index">01</span>
        <h2 className="fx-en">STRUCTURE</h2>
        <span className="muted small">構成</span>
        <span className="sec-line" />
        <select
          className="small"
          value=""
          onChange={(e) => {
            const t = STRUCTURE_TEMPLATES.find((x) => x.label === e.target.value);
            if (t && (!list.length || window.confirm("今の構成を置き換えますか?"))) set(t.sections.map(([name, bars]) => ({ id: uid(), name, bars })));
          }}
        >
          <option value="">テンプレート…</option>
          {STRUCTURE_TEMPLATES.map((t) => (
            <option key={t.label}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="arr-map">
        {list.map((s, i) => (
          <div
            key={s.id}
            className={`arr-blk ${SECTION_CLASS[s.name] ?? "sx"} ${editing === s.id ? "editing" : ""}`}
            style={{ flexGrow: Math.max(1, Number(s.bars) || 1) }}
            onClick={() => setEditing(editing === s.id ? null : s.id)}
          >
            {editing === s.id ? (
              <div className="arr-edit" onClick={(e) => e.stopPropagation()}>
                <input value={s.name} onChange={(e) => set(list.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} aria-label="名前" />
                <input
                  type="number"
                  min={1}
                  value={s.bars}
                  onChange={(e) => set(list.map((x) => (x.id === s.id ? { ...x, bars: Number(e.target.value) || 1 } : x)))}
                  aria-label="小節"
                />
                <div className="arr-tools">
                  <button className="icon-btn" disabled={i === 0} onClick={() => set(move(list, i, -1))} title="前へ">
                    ←
                  </button>
                  <button className="icon-btn" disabled={i === list.length - 1} onClick={() => set(move(list, i, 1))} title="後ろへ">
                    →
                  </button>
                  <button className="icon-btn danger" onClick={() => set(list.filter((x) => x.id !== s.id))} title="削除">
                    ×
                  </button>
                </div>
              </div>
            ) : (
              <>
                {s.name}
                <small>{s.bars}</small>
              </>
            )}
          </div>
        ))}
        {!list.length && <div className="muted small arr-empty">下のボタンかテンプレートから組み立てる</div>}
      </div>
      <div className="arr-add">
        {SECTION_PRESETS.map((name) => (
          <button key={name} className="chip-btn" onClick={() => set([...list, { id: uid(), name, bars: name === "Intro" || name === "Outro" ? 8 : name === "B" || name === "間奏" ? 8 : 16 }])}>
            ＋ {name}
          </button>
        ))}
        <span className="muted small arr-total">
          計 {totalBars} 小節{secs ? ` ≈ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : ""}
        </span>
      </div>
    </section>
  );
}

function move<T>(list: T[], i: number, d: number): T[] {
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(i + d, 0, x);
  return next;
}

function ChordRows({ flow, update }: Pick<StageProps, "flow" | "update">) {
  const names = [...new Set((flow.structure ?? []).map((s) => s.name))];
  const rows = names.length ? names : ["全体"];
  const chords = flow.chords ?? [];
  const get = (section: string) => chords.find((c) => c.section === section)?.prog ?? "";
  const set = (section: string, prog: string) =>
    update((f) => {
      const list = (f.chords ?? []).filter((c) => c.section !== section);
      return { ...f, chords: [...list, { section, prog }] };
    });
  return (
    <div className="chord-rows">
      {rows.map((name) => (
        <label key={name} className="chord-row">
          <span>{name}</span>
          <input value={get(name)} placeholder="例: IVmaj7 - V - iii - vi" onChange={(e) => set(name, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

const CORE: { id: "drums" | "bass" | "harmony"; label: string }[] = [
  { id: "drums", label: "DRUMS" },
  { id: "bass", label: "BASS" },
  { id: "harmony", label: "GTR / PNO" },
];

export function RefSelect({ flow, value, onChange }: { flow: Flow; value?: string; onChange: (v: string) => void }) {
  const refs = flow.refs ?? [];
  return (
    <select className="ref-select" value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="参考曲">
      <option value="">参考 —</option>
      {refs.map((r, i) =>
        filled(r) ? (
          <option key={i} value={SLOT_KEYS[i]}>
            {SLOT_KEYS[i]}: {r.title}
          </option>
        ) : null,
      )}
    </select>
  );
}

function CoreParts({ flow, update }: Pick<StageProps, "flow" | "update">) {
  const core = flow.core ?? {};
  const set = (id: "drums" | "bass" | "harmony", patch: Partial<CorePart>) => update((f) => ({ ...f, core: { ...f.core, [id]: { ...f.core?.[id], ...patch } } }));
  return (
    <section className="card">
      <div className="section-head">
        <span className="sec-index">03</span>
        <h2 className="fx-en">CORE 3</h2>
        <span className="muted small">仮でいいので早く決め切る — どの曲のどこを参考にする?</span>
        <span className="sec-line" />
      </div>
      <div className="core-grid">
        {CORE.map((c) => {
          const part = core[c.id] ?? {};
          return (
            <div key={c.id} className={`core-part ${part.done ? "ok" : ""}`}>
              <div className="core-nm">
                {c.id === "harmony" ? (
                  <div className="segmented">
                    {(["guitar", "piano"] as const).map((inst) => (
                      <button key={inst} className={(part.inst ?? "guitar") === inst ? "active" : ""} onClick={() => set("harmony", { inst })}>
                        {inst === "guitar" ? "GUITAR" : "PIANO"}
                      </button>
                    ))}
                  </div>
                ) : (
                  c.label
                )}
              </div>
              <RefSelect flow={flow} value={part.ref} onChange={(ref) => set(c.id, { ref })} />
              <input value={part.point ?? ""} placeholder="参考にする所(例: Aのサビの裏ハット)" onChange={(e) => set(c.id, { point: e.target.value })} />
              <button className={`btn small core-done ${part.done ? "on" : ""}`} onClick={() => set(c.id, { done: !part.done })}>
                {part.done ? "✓ 仮決め OK" : "仮決めした"}
              </button>
              {part.done && <span className="core-stamp">仮 OK</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
