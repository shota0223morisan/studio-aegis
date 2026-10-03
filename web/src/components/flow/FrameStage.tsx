import { useState } from "react";
import { api, type MidiKind } from "../../lib/api";
import { SECTION_PRESETS, SLOT_KEYS, START_OPTIONS, STRUCTURE_TEMPLATES, filled, uid, type CorePart, type Flow, type Section } from "../../lib/flow";
import { CardChecks } from "../../lib/gate";
import { midiChanged } from "../../lib/midiEvents";
import { toast } from "../../lib/toast";
import { GEN_STYLES, KEY_OPTIONS, chordName, formatProgression, generate, parseProgression, splitBySection, type GenStyle } from "../../lib/theory";
import { IdeasPanel } from "../IdeasPanel";
import { MidiSection } from "./MidiSection";
import type { StageProps } from "./types";

const SECTION_CLASS: Record<string, string> = { Intro: "si", Outro: "si", A: "sa", B: "sb", サビ: "ss", 落ちサビ: "ss", 間奏: "sx", Dメロ: "sx" };

/** STAGE 02 FRAME: structure, where to start, chords, and the core three parts decided (even tentatively). */
export function FrameStage({ project, flow, update }: StageProps) {
  const bpm = Number(String(flow.analysis?.bpm ?? "").match(/\d+(\.\d+)?/)?.[0]) || 120;
  return (
    <>
      <StructureCard flow={flow} update={update} />
      <section className="card">
        <div className="section-head">
          <span className="sec-index">02</span>
          <h2 className="fx-en">START & CHORDS</h2>
          <span className="sec-line" />
          <CardChecks ids={["start", "chords"]} />
        </div>
        <div className="start-row">
          <span className="muted small">最初に</span>
          <div className="segmented">
            {START_OPTIONS.map((o) => (
              <button key={o.id} className={flow.startWith === o.id ? "active" : ""} onClick={() => update((f) => ({ ...f, startWith: o.id }))}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <ChordRows flow={flow} update={update} projectId={project.id} bpm={bpm} />
      </section>
      <CoreParts flow={flow} update={update} projectId={project.id} />
      <MidiSection projectId={project.id} flow={flow} update={update} index="04" defaultKind="drums" />
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
        <span className="sec-line" />
        <CardChecks ids={["structure"]} />
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

/** Bars of a section (first time it appears in the structure), or 1 bar per chord. */
function sectionBeats(flow: Flow, section: string, chordCount: number) {
  const bars = (flow.structure ?? []).find((s) => s.name === section)?.bars;
  return { bars: bars ?? chordCount, beats: (bars ?? chordCount) * 4 };
}

function ChordRows({ flow, update, projectId, bpm }: Pick<StageProps, "flow" | "update"> & { projectId: string; bpm: number }) {
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const key = flow.key ?? 0;
  const names = [...new Set((flow.structure ?? []).map((s) => s.name))];
  const rows = names.length ? names : ["全体"];
  const chords = flow.chords ?? [];
  const get = (section: string) => chords.find((c) => c.section === section)?.prog ?? "";
  const setMany = (entries: Record<string, string>) =>
    update((f) => {
      const list = (f.chords ?? []).filter((c) => !(c.section in entries));
      return { ...f, chords: [...list, ...Object.entries(entries).map(([section, prog]) => ({ section, prog }))] };
    });

  function applyLine() {
    const parts = splitBySection(line, names, names.includes("サビ") ? "サビ" : rows[0]);
    const entries: Record<string, string> = {};
    for (const [section, text] of Object.entries(parts)) {
      const parsed = parseProgression(text, key);
      if (parsed.length) entries[section] = formatProgression(parsed);
    }
    if (!Object.keys(entries).length) return toast("コード進行を読み取れませんでした", { error: true });
    setMany(entries);
    setLine("");
  }

  async function gen(section: string, style: GenStyle) {
    const parsed = parseProgression(get(section), key);
    if (!parsed.length) return;
    const { bars, beats } = sectionBeats(flow, section, parsed.length);
    const st = GEN_STYLES.find((g) => g.id === style)!;
    setBusy(`${section}:${style}`);
    try {
      await api.createMidi({
        projectId,
        name: `${section === "全体" ? "" : `${section} `}${st.label} ${bars}小節`,
        kind: st.kind as MidiKind,
        bpm,
        bars,
        tracks: [{ name: st.label, channel: 0, notes: generate(style, parsed, key, beats) }],
        prompt: formatProgression(parsed),
      });
      midiChanged();
      toast(`MIDI に追加: ${section} ${st.label}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "作れませんでした", { error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="chord-block">
      <div className="chord-top">
        <select className="small" value={key} onChange={(e) => update((f) => ({ ...f, key: Number(e.target.value) }))} aria-label="キー" title="キー(MIDI を作るときに使う)">
          {KEY_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              Key {k.label}
            </option>
          ))}
        </select>
        <form
          className="chord-line"
          onSubmit={(e) => {
            e.preventDefault();
            applyLine();
          }}
        >
          <input value={line} placeholder="一言で: サビ 4536 A: 1645 B 2536 / 6フラット7フラット1" onChange={(e) => setLine(e.target.value)} />
        </form>
      </div>
      <div className="chord-rows">
        {rows.map((name) => {
          const text = get(name);
          const parsed = parseProgression(text, key);
          return (
            <div key={name} className="chord-row">
              <span>{name}</span>
              <div className="chord-cell">
                <input value={text} placeholder="4536 / IV-V-iii-vi / F G Em Am" onChange={(e) => setMany({ [name]: e.target.value })} />
                {parsed.length > 0 && (
                  <div className="chord-parsed">
                    <span className="chord-names">{parsed.map((c) => chordName(c, key)).join("  ")}</span>
                    <span className="chord-gen">
                      {GEN_STYLES.map((g) => (
                        <button key={g.id} className="chip-btn" disabled={busy !== null} onClick={() => void gen(name, g.id)} title={`このコードで ${g.label} の MIDI を作る`}>
                          {busy === `${name}:${g.id}` ? "…" : `＋${g.label}`}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
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

function CoreParts({ flow, update, projectId }: Pick<StageProps, "flow" | "update"> & { projectId: string }) {
  const core = flow.core ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  async function ai(id: "drums" | "bass" | "harmony", part: CorePart) {
    const kind = id === "harmony" ? (part.inst === "piano" ? "piano" : "guitar") : id;
    const refIdx = part.ref ? SLOT_KEYS.indexOf(part.ref) : -1;
    const ref = refIdx >= 0 ? flow.refs?.[refIdx] : undefined;
    const prompt = [part.point, ref && `参考: ${ref.title}(${ref.artist})`].filter(Boolean).join(" / ");
    setBusy(id);
    try {
      const r = await api.aiMidi(projectId, { kind, bars: 4, prompt });
      midiChanged();
      toast(`MIDI に追加: ${r.clip.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "作れませんでした", { error: true });
    } finally {
      setBusy(null);
    }
  }
  const set = (id: "drums" | "bass" | "harmony", patch: Partial<CorePart>) => update((f) => ({ ...f, core: { ...f.core, [id]: { ...f.core?.[id], ...patch } } }));
  return (
    <section className="card">
      <div className="section-head">
        <span className="sec-index">03</span>
        <h2 className="fx-en">CORE 3</h2>
        <span className="sec-line" />
        <CardChecks ids={["drums", "bass", "harmony"]} />
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
              <input value={part.point ?? ""} placeholder="参考にする所" onChange={(e) => set(c.id, { point: e.target.value })} />
              <div className="core-actions">
                <button className={`btn small core-done ${part.done ? "on" : ""}`} onClick={() => set(c.id, { done: !part.done })}>
                  {part.done ? "✓ 仮決め" : "仮決め"}
                </button>
                <button className="btn small ghost" disabled={busy !== null} onClick={() => void ai(c.id, part)} title="参考にする所をもとに AI で MIDI を作る">
                  {busy === c.id ? "生成中…" : "✦ AI"}
                </button>
              </div>
              {part.done && <span className="core-stamp">仮 OK</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
