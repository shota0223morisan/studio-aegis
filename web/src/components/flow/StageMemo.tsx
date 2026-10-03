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

const PLACEHOLDERS: Record<number, string> = {
  1: "聴いて気づいたこと・先方の言葉の解釈・気になるフレーズ…",
  2: "雑多なメモ OK。浮かんだアイディア、試したいこと…",
  3: "上物で試すこと・音色メモ…",
  4: "気になった帯域・プラグイン設定・直すところ…",
  5: "書き出し設定・提出時に伝えること…",
};
