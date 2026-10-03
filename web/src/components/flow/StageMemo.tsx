import { MarkdownMemo } from "../MarkdownMemo";
import { stageMeta } from "../../lib/flow";

/** 自分用メモ for one stage (stored in the song's flow). */
export function StageMemo({ stage, initial, onSave }: { stage: number; initial: string; onSave: (text: string) => void }) {
  return (
    <section className="card memo-card">
      <MarkdownMemo
        key={stage}
        icon="✎"
        title="自分用メモ"
        subtitle={stageMeta(stage).en}
        initial={initial}
        save={async (v) => onSave(v)}
        placeholder={PLACEHOLDERS[stage] ?? "メモ"}
      />
    </section>
  );
}

const PLACEHOLDERS: Record<number, string> = {};
