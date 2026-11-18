import { useRef, useState, type ReactNode } from "react";
import { isDraggingOut, isMidiFile } from "../lib/inputGuards";

/**
 * Drop .mid files onto the wrapped area. While dragging, two targets appear:
 * "そのまま入れる" (one clip per file) and "曲まるごと" (split per instrument).
 */
export function MidiDrop({
  children,
  className,
  onFiles,
  onSong,
}: {
  children: ReactNode;
  className?: string;
  onFiles: (files: File[]) => void;
  onSong?: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files") && !isDraggingOut();
  const take = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setOver(false);
    return Array.from(e.dataTransfer.files).filter(isMidiFile);
  };
  return (
    <div
      className={`midi-drop ${over ? "over" : ""} ${className ?? ""}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        const files = take(e);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="midi-drop-overlay">
          <div
            className="midi-drop-target"
            onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"))}
            onDrop={(e) => {
              const files = take(e);
              if (files.length) onFiles(files);
            }}
          >
            <b>そのまま入れる</b>
            <small>.mid 1 つにつき 1 つの MIDI</small>
          </div>
          {onSong && (
            <div
              className="midi-drop-target song"
              onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"))}
              onDrop={(e) => {
                const [file] = take(e);
                if (file) onSong(file);
              }}
            >
              <b>曲まるごと読込</b>
              <small>楽器ごとに分けて倉庫へ・欄を自動で埋める</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
