import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useLibrary } from "../lib/library";

/** "＋ 新しい曲" inline form: song name + which client it belongs to. */
export function NewSongForm({ clientId, onDone }: { clientId?: string | null; onDone?: () => void }) {
  const { clients, reload } = useLibrary();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [client, setClient] = useState<string>(clientId ?? clients[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim(), client || null);
      await reload();
      onDone?.();
      navigate(`/p/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    }
  }

  return (
    <form className="new-project" onSubmit={submit}>
      {clientId === undefined && (
        <select value={client} onChange={(e) => setClient(e.target.value)} aria-label="取引先">
          <option value="">取引先なし</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input
        autoFocus
        placeholder="曲名(例: 夏 CM 15 秒 / ○○ 新曲)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone?.()}
        maxLength={200}
      />
      <button className="btn primary" disabled={!name.trim()}>
        作成
      </button>
      {onDone && (
        <button type="button" className="btn ghost" onClick={onDone}>
          キャンセル
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
