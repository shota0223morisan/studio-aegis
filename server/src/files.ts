import path from "node:path";

/** Browsers often send empty / odd MIME types for pro-audio formats, so derive from the extension. */
const MIME_BY_EXT: Record<string, string> = {
  ".wav": "audio/wav",
  ".wave": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function mimeFor(fileName: string, reported?: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXT[ext] ?? (reported && reported !== "application/octet-stream" ? reported : "application/octet-stream");
}

export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** multer decodes multipart filenames as latin1; recover UTF-8 (Japanese file names etc). */
export function decodeOriginalName(name: string): string {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}

export function contentDisposition(type: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
