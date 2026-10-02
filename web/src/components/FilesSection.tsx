import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, uploadFiles, type FileCategory, type StoredFile } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";

export const CATEGORIES: { value: FileCategory; label: string; hint: string }[] = [
  { value: "client_ref", label: "添付音源", hint: "先方からの参考音源・デモ・指示音声" },
  { value: "deliverable", label: "完成版", hint: "納品ファイル・ミックス/マスター" },
  { value: "other", label: "その他", hint: "ステム・資料など" },
];

const probe = typeof Audio !== "undefined" ? new Audio() : null;
const canPlay = (mime: string) => mime.startsWith("audio/") && Boolean(probe?.canPlayType(mime));

/** ファイル: upload / play / download, grouped by category. */
export function FilesSection({
  projectId,
  files,
  maxUploadBytes,
  onFilesChange,
  only,
  title = "ファイル",
  index,
  bare = false,
}: {
  projectId: string;
  files: StoredFile[];
  maxUploadBytes: number;
  onFilesChange: (files: StoredFile[]) => void;
  /** Limit to these categories (e.g. the brief card shows only client references). */
  only?: FileCategory[];
  title?: string;
  index?: string;
  /** Render without the section header (embedded in another card). */
  bare?: boolean;
}) {
  const filesRef = useRef(files);
  filesRef.current = files;

  // Only one file plays at a time.
  useEffect(() => {
    const onPlay = (e: Event) => {
      if (!(e.target instanceof HTMLAudioElement)) return;
      document.querySelectorAll("audio").forEach((a) => a !== e.target && a.pause());
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  const addFiles = (created: StoredFile[]) => onFilesChange([...created, ...filesRef.current]);

  const cats = CATEGORIES.filter((c) => !only || only.includes(c.value));
  return (
    <>
      {!bare && (
        <div className="section-head">
          {index && <span className="sec-index">{index}</span>}
          <span className="sec-icon" aria-hidden>◉</span>
          <h2>{title}</h2>
          <span className="muted small">1 ファイル最大 {formatBytes(maxUploadBytes)}</span>
          <span className="sec-line" aria-hidden />
        </div>
      )}
      <div className={`file-groups ${bare ? "bare" : ""}`}>
        {cats.map((c) => (
          <FileGroup
            key={c.value}
            projectId={projectId}
            category={c}
            files={files.filter((f) => f.category === c.value)}
            maxUploadBytes={maxUploadBytes}
            onUploaded={addFiles}
            onUpdated={(f) => onFilesChange(filesRef.current.map((x) => (x.id === f.id ? f : x)))}
            onDeleted={(id) => onFilesChange(filesRef.current.filter((x) => x.id !== id))}
          />
        ))}
      </div>
    </>
  );
}

function FileGroup({
  projectId,
  category,
  files,
  maxUploadBytes,
  onUploaded,
  onUpdated,
  onDeleted,
}: {
  projectId: string;
  category: (typeof CATEGORIES)[number];
  files: StoredFile[];
  maxUploadBytes: number;
  onUploaded: (files: StoredFile[]) => void;
  onUpdated: (file: StoredFile) => void;
  onDeleted: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: File[]) {
    if (!list.length) return;
    const tooBig = list.find((f) => f.size > maxUploadBytes);
    if (tooBig) return setError(`「${tooBig.name}」は上限 ${formatBytes(maxUploadBytes)} を超えています`);
    setError(null);
    setProgress(0);
    try {
      // Show each file as soon as it finishes, so a later failure doesn't hide earlier ones.
      await uploadFiles(projectId, category.value, list, setProgress, (f) => onUploaded([f]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setProgress(null);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void upload([...e.dataTransfer.files]);
  }

  return (
    <div className="file-group">
      <div className="file-group-head">
        <h3>{category.label}</h3>
        <span className="muted small">{files.length}</span>
      </div>
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => progress === null && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        {progress !== null ? (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>追加中 {Math.round(progress * 100)}%</span>
          </div>
        ) : (
          <>
            <span>ドロップ or クリックして追加</span>
            <span className="muted small">{category.hint}</span>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={category.value === "other" ? undefined : "audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.zip"}
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {error && <p className="error">{error}</p>}
      <ul className="file-list">
        {files.map((f) => (
          <FileRow key={f.id} file={f} onUpdated={onUpdated} onDeleted={onDeleted} />
        ))}
      </ul>
    </div>
  );
}

function FileRow({
  file,
  onUpdated,
  onDeleted,
}: {
  file: StoredFile;
  onUpdated: (file: StoredFile) => void;
  onDeleted: (id: string) => void;
}) {
  const playable = canPlay(file.mime);
  return (
    <li className="file-row">
      <div className="file-meta">
        <div className="file-name" title={file.name}>
          {file.name}
        </div>
        <div className="muted small">
          {formatBytes(file.size)} · {formatDate(file.createdAt)}
        </div>
      </div>
      {playable ? (
        <audio controls preload="none" src={file.url} />
      ) : file.mime.startsWith("audio/") ? (
        <span className="muted small">このブラウザでは再生できない形式です</span>
      ) : null}
      <div className="file-actions">
        <a className="btn small" href={file.downloadUrl} download={file.name}>
          ダウンロード
        </a>
        <select
          className="small"
          value={file.category}
          aria-label="分類を変更"
          onChange={async (e) => onUpdated(await api.updateFile(file.id, { category: e.target.value as FileCategory }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          className="icon-btn danger"
          aria-label="削除"
          onClick={async () => {
            if (!window.confirm(`「${file.name}」を削除しますか?`)) return;
            await api.deleteFile(file.id);
            onDeleted(file.id);
          }}
        >
          ✕
        </button>
      </div>
    </li>
  );
}
