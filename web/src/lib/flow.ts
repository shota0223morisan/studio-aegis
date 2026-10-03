import type { PanePreset } from "./desktop";
import type { ProjectDetail } from "./api";

/** The 5 stages of a track. */
export const STAGES = [
  { n: 1, en: "DECODE", jp: "リファレンス解析", mission: "先方が「本当に欲しいもの」を言葉にして、参考曲を 3 曲そろえる", preset: "listen" },
  { n: 2, en: "FRAME", jp: "骨組み", mission: "構成とコードを決めて、ドラム・ベース・ギターかピアノを仮で決め切る", preset: "build" },
  { n: 3, en: "LAYER", jp: "肉付け", mission: "上物を、どの曲のどこを活かすか決めて積み上げる", preset: "build" },
  { n: 4, en: "MIXING", jp: "ミックス", mission: "Mixing Tips のチェックリストを全部満たす", preset: "polish" },
  { n: 5, en: "SHIP", jp: "書き出し・提出", mission: "mp3 を書き出して入れ、提出して完了", preset: "focus" },
] as const satisfies readonly { n: number; en: string; jp: string; mission: string; preset: PanePreset }[];

export type StageNo = 1 | 2 | 3 | 4 | 5;
export const stageMeta = (n: number) => STAGES[Math.min(5, Math.max(1, n)) - 1];

export const SLOT_KEYS = "ABCDEFGH";

export interface RefSlot {
  title: string;
  artist: string;
  url?: string;
  fileId?: string;
  bpm?: string;
  bpmAuto?: boolean;
  key?: string; // shown only — never used for comparison
  keyAuto?: boolean;
  use?: string; // 活かす所
}

export interface Section {
  id: string;
  name: string;
  bars: number;
}

export interface CorePart {
  ref?: string; // slot key (A/B/C…) or ""
  point?: string; // どの曲のどこを参考に
  done?: boolean; // 仮決め
  inst?: "guitar" | "piano"; // harmony only
}

export interface LayerPart {
  id: string;
  name: string;
  ref?: string;
  point?: string;
  done?: boolean;
}

export interface ParkedItem {
  id: string;
  text: string;
  from: number;
  done?: boolean;
}

export interface SimilarSong {
  title: string;
  artist: string;
  year?: string;
  bpm?: string;
  why: string;
  tags: string[];
  match: number;
}

export interface Flow {
  mission?: string;
  refs?: RefSlot[];
  analysis?: { bpm?: string; beat?: string; form?: string };
  similar?: { items: SimilarSong[]; at: string };
  structure?: Section[];
  /** Key for chord → MIDI (semitones above C; major, or a minor song's relative major). */
  key?: number;
  startWith?: string;
  chords?: { section: string; prog: string }[];
  core?: { drums?: CorePart; bass?: CorePart; harmony?: CorePart };
  parts?: LayerPart[];
  parked?: ParkedItem[];
  mixChecks?: Record<string, boolean>;
  notes?: Record<string, string>;
  /** Seconds spent per stage (finished runs) + the running timer. */
  timers?: Record<string, number>;
  running?: { stage: number; since: number } | null;
  notified?: Record<string, boolean>;
  /** Soft-lock mode: stages left with open items. */
  overrides?: { stage: number; at: string; missing: string[] }[];
  /** Checks ticked by hand ("決めた", done in the DAW) — keyed "stage:checkId". */
  manual?: Record<string, boolean>;
  stageAt?: Record<string, string>;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Satisfied by what's written in the app (otherwise only by ticking it). */
  auto?: boolean;
  /** Ticked by hand. */
  manual?: boolean;
  /** The written value *is* the tick (e.g. CORE 3 「仮決め」): toggling flips it. */
  self?: boolean;
  sub?: string;
}

/**
 * The user's 書き出し前チェックリスト from Notion's Mixing Tips, used when Notion isn't connected
 * (or the page can't be read) so the MIXING lock still works offline.
 */
export const DEFAULT_MIX_CHECKS = [
  "曲頭から通しで聴いて、テンションが上がるか",
  "各セクションの「主人公」を言えるか",
  "各楽器で 2k をカットしたか",
  "キック・スネアのアタックを EQ で上げていないか",
  "リバーブ／ディレイをバスでまとめてステレオナイザーで広げたか",
  "一番「手前」の楽器と一番「奥」の楽器を即答できるか",
  "ローカットは急スロープで、目立たせたい帯域の手前で切れているか",
  "リファレンスの「どの帯域でどの楽器が出てくるか」を先に分析したか",
];

export const filled = (r?: RefSlot) => Boolean(r && (r.title?.trim() || r.artist?.trim()));

/**
 * What has to be done before leaving a stage. Every item clears either from what's written in the
 * app (auto) or by ticking it by hand — decided in the DAW counts too.
 */
export function stageChecks(n: number, project: ProjectDetail, flow: Flow, mixItems: { id: string; text: string }[]): Check[] {
  const list = autoChecks(n, project, flow, mixItems);
  if (n === 4) return list; // MIXING items are ticked by hand anyway
  return list.map((c) => {
    if (c.self) return { ...c, auto: false, manual: c.ok };
    const manual = Boolean(flow.manual?.[`${n}:${c.id}`]);
    return { ...c, auto: c.ok, manual, ok: c.ok || manual };
  });
}

function autoChecks(n: number, project: ProjectDetail, flow: Flow, mixItems: { id: string; text: string }[]): Check[] {
  const refs = (flow.refs ?? []).filter(filled);
  switch (n) {
    case 1: {
      const top3 = refs.slice(0, 3);
      return [
        { id: "brief", label: "先方の指示を確認", ok: Boolean(project.brief.trim()) || project.files.some((f) => f.category === "client_ref") },
        { id: "mission", label: "先方が欲しいものを掴んだ", ok: Boolean(flow.mission?.trim()) },
        { id: "refs", label: "参考曲 3 曲", ok: refs.length >= 3, sub: `${Math.min(3, refs.length)} / 3` },
        {
          id: "use",
          label: "活かす所を決めた",
          ok: top3.length >= 3 && top3.every((r) => r.use?.trim()),
          sub: top3.length ? top3.map((r, i) => `${SLOT_KEYS[i]} ${r.use?.trim() ? "✓" : "—"}`).join("  ") : undefined,
        },
        { id: "bpm", label: "テンポ", ok: Boolean(flow.analysis?.bpm?.trim()) },
      ];
    }
    case 2: {
      const core = flow.core ?? {};
      const inst = core.harmony?.inst === "piano" ? "ピアノ" : "ギター";
      return [
        { id: "structure", label: "構成", ok: (flow.structure ?? []).length >= 2 },
        { id: "start", label: "何から作るか", ok: Boolean(flow.startWith) },
        { id: "chords", label: "コード進行", ok: (flow.chords ?? []).some((c) => c.prog.trim()) },
        { id: "drums", label: "ドラム仮決め", ok: Boolean(core.drums?.done), self: true },
        { id: "bass", label: "ベース仮決め", ok: Boolean(core.bass?.done), self: true },
        { id: "harmony", label: `${inst}仮決め`, ok: Boolean(core.harmony?.done), self: true },
      ];
    }
    case 3: {
      const parts = (flow.parts ?? []).filter((p) => p.name.trim());
      return [
        { id: "parts", label: "上物を決めた", ok: parts.length > 0 },
        { id: "points", label: "参考にする所", ok: parts.length > 0 && parts.every((p) => p.point?.trim() || p.ref) },
        { id: "done", label: "上物を入れ終えた", ok: parts.length > 0 && parts.every((p) => p.done), sub: `${parts.filter((p) => p.done).length} / ${parts.length}` },
      ];
    }
    case 4: {
      const checks = flow.mixChecks ?? {};
      // Ticks are keyed by the item's id (older songs: by its text).
      const items: Check[] = mixItems.map((it) => ({ id: `mix-${it.id}`, label: it.text, ok: Boolean(checks[it.id] ?? checks[it.text]) }));
      for (const p of flow.parked ?? []) items.push({ id: `park-${p.id}`, label: p.text, ok: Boolean(p.done), sub: `${stageMeta(p.from).en} で保留` });
      return items;
    }
    case 5:
      return [
        {
          id: "master",
          label: "書き出した(mp3)",
          ok: project.files.some((f) => f.category === "deliverable" && f.mime.startsWith("audio/")),
        },
      ];
    default:
      return [];
  }
}

/** Seconds spent in a stage, including the running timer. */
export function elapsed(flow: Flow, n: number, now = Date.now()): number {
  const base = flow.timers?.[n] ?? 0;
  const run = flow.running?.stage === n ? Math.max(0, (now - flow.running.since) / 1000) : 0;
  return base + run;
}

/** Stop the running timer (folding its time into the stage). */
export function stopTimer(flow: Flow, now = Date.now()): Flow {
  if (!flow.running) return flow;
  const n = flow.running.stage;
  return { ...flow, timers: { ...flow.timers, [n]: elapsed(flow, n, now) }, running: null };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

/** Section presets for the structure builder. */
export const SECTION_PRESETS = ["Intro", "A", "B", "サビ", "間奏", "Dメロ", "落ちサビ", "Outro"];
export const STRUCTURE_TEMPLATES: { label: string; sections: [string, number][] }[] = [
  {
    label: "J-POP 王道",
    sections: [["Intro", 8], ["A", 16], ["B", 8], ["サビ", 16], ["間奏", 8], ["A", 16], ["B", 8], ["サビ", 16], ["Dメロ", 8], ["落ちサビ", 8], ["サビ", 16], ["Outro", 8]],
  },
  { label: "CM 30秒", sections: [["Intro", 2], ["A", 8], ["サビ", 8], ["Outro", 2]] },
  { label: "CM 15秒", sections: [["Intro", 1], ["サビ", 6], ["Outro", 1]] },
  { label: "BGM ループ", sections: [["Intro", 4], ["A", 16], ["B", 16], ["A", 16], ["Outro", 4]] },
];

export const START_OPTIONS = [
  { id: "drums", label: "ドラム" },
  { id: "bass", label: "ベース" },
  { id: "guitar", label: "ギター" },
  { id: "piano", label: "ピアノ" },
  { id: "other", label: "その他" },
];

export const LAYER_PRESETS = ["ギター", "ストリングス", "ピアノ", "ブラス", "シンセ", "FX", "コーラス", "パッド"];

export const ytMusicSearch = (q: string) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;
export const spotifySearch = (q: string) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;
