import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useLibrary } from "../lib/library";

const NEW = "__new";

/** "＋ 新しい曲" inline form: song name + which client it belongs to (or a new client, made on the spot). */
export function NewSongForm({ clientId, onDone }: { clientId?: string | null; onDone?: () => void }) {
  const { clients, reload } = useLibrary();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [client, setClient] = useState<string>(clientId ?? clients[0]?.id ?? "");
  const [clientName, setClientName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = client === NEW;
  const ready = !!name.trim() && (!isNew || !!clientName.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      let clientIdToUse = client || null;
      if (isNew) {
        const c = await api.createClient(clientName.trim());
        // If the song fails after this, keep the new client selected so a retry doesn't make it twice.
        setClient(c.id);
        setClientName("");
        clientIdToUse = c.id;
      }
      const p = await api.createProject(name.trim(), clientIdToUse);
      await reload();
      onDone?.();
      navigate(`/p/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
      await reload().catch(() => {});
    } finally {
      setBusy(false);
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
          <option value={NEW}>＋ 新しい取引先…</option>
        </select>
      )}
      {isNew && (
        <input
          className="new-client-name"
          autoFocus
          placeholder="新しい取引先の名前"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setClient(clients[0]?.id ?? ""))}
          maxLength={200}
          aria-label="新しい取引先の名前"
        />
      )}
      <input
        autoFocus={!isNew}
        placeholder="曲名(⌘Enter で作る)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone?.()}
        maxLength={200}
      />
      <button className="btn primary" disabled={!ready || busy}>
        {busy ? "作成中…" : isNew ? "取引先と曲を作成" : "作成"}
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
