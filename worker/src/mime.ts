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

export function extOf(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return m ? m[0] : "";
}

export function mimeFor(fileName: string, reported?: string): string {
  return MIME_BY_EXT[extOf(fileName)] ?? (reported && reported !== "application/octet-stream" ? reported : "application/octet-stream");
}

export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function contentDisposition(type: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Serve an R2 object with HTTP Range support (needed for seeking in long WAVs). */
export async function serveObject(bucket: R2Bucket, key: string, req: Request, headers: Record<string, string>) {
  const hasRange = req.headers.has("range");
  let obj: R2ObjectBody | null;
  try {
    obj = (await bucket.get(key, hasRange ? { range: req.headers } : undefined)) as R2ObjectBody | null;
  } catch {
    return new Response("Range Not Satisfiable", { status: 416 });
  }
  if (!obj) return new Response("Not found", { status: 404 });
  const h = new Headers(headers);
  h.set("Accept-Ranges", "bytes");
  h.set("ETag", obj.httpEtag);
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (hasRange && range) {
    const offset = range.suffix !== undefined ? Math.max(0, obj.size - range.suffix) : (range.offset ?? 0);
    const length = Math.min(range.suffix ?? range.length ?? obj.size - offset, obj.size - offset);
    if (offset >= obj.size || length <= 0) {
      return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${obj.size}` } });
    }
    h.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers: h });
}

/** Delete every object under a prefix (used when a project is removed). */
export async function deletePrefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor });
    if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
