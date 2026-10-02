export interface Session {
  /** Deployed without APP_PASSWORD: the server refuses to serve data until it is set. */
  setupRequired: boolean;
  authRequired: boolean;
  authenticated: boolean;
  spotifyConfigured: boolean;
  maxUploadBytes: number;
}

export interface Project {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  structureMemo: string;
  ideaMemo: string;
  spliceUrl: string;
  spliceLabel: string;
  deadline: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SpotifyKind = "track" | "album" | "playlist" | "episode" | "show" | "artist";

export interface SpotifyRef {
  id: string;
  kind: SpotifyKind;
  spotifyId: string;
  uri: string;
  title: string;
  subtitle: string;
  note: string;
  position: number;
}

export type FileCategory = "client_ref" | "deliverable" | "other";

export interface StoredFile {
  id: string;
  category: FileCategory;
  name: string;
  mime: string;
  size: number;
  note: string;
  createdAt: string;
  url: string;
  downloadUrl: string;
}

export interface ProjectDetail extends Project {
  refs: SpotifyRef[];
  files: StoredFile[];
}

export interface SpotifyItem {
  kind: SpotifyKind;
  id: string;
  uri: string;
  title: string;
  subtitle: string;
  image: string | null;
}

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  user: { id: string; display_name: string | null } | null;
  redirectUri: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when any request comes back 401 so the app can show the login screen. */
export const UNAUTHORIZED_EVENT = "aegis:unauthorized";

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/spotify")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  session: () => request<Session>("/api/session"),
  login: (password: string) => request("/api/auth/login", json("POST", { password })),
  logout: () => request("/api/auth/logout", json("POST")),

  listProjects: (sort = "updated") => request<{ items: Project[] }>(`/api/projects?sort=${sort}`),
  createProject: (name: string) => request<Project>("/api/projects", json("POST", { name })),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  updateProject: (id: string, patch: Partial<Project>) => request<Project>(`/api/projects/${id}`, json("PATCH", patch)),
  deleteProject: (id: string) => request(`/api/projects/${id}`, json("DELETE")),
  setThumbnail: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Project>(`/api/projects/${id}/thumbnail`, { method: "PUT", body: fd });
  },
  removeThumbnail: (id: string) => request<Project>(`/api/projects/${id}/thumbnail`, json("DELETE")),

  addRef: (id: string, input: string, meta?: { title?: string; subtitle?: string }) =>
    request<SpotifyRef>(`/api/projects/${id}/refs`, json("POST", { input, ...meta })),
  updateRef: (id: string, refId: string, patch: { note?: string; title?: string }) =>
    request<SpotifyRef>(`/api/projects/${id}/refs/${refId}`, json("PATCH", patch)),
  reorderRefs: (id: string, order: string[]) => request(`/api/projects/${id}/refs/order`, json("PUT", { order })),
  deleteRef: (id: string, refId: string) => request(`/api/projects/${id}/refs/${refId}`, json("DELETE")),

  updateFile: (fileId: string, patch: Partial<Pick<StoredFile, "category" | "note" | "name">>) =>
    request<StoredFile>(`/api/files/${fileId}`, json("PATCH", patch)),
  deleteFile: (fileId: string) => request(`/api/files/${fileId}`, json("DELETE")),

  spotifyStatus: () => request<SpotifyStatus>("/api/spotify/status"),
  spotifyLogout: () => request("/api/spotify/logout", json("POST")),
  spotifyToken: () => request<{ accessToken: string; expiresAt: number }>("/api/spotify/token"),
  spotifySearch: (q: string, type: "track" | "album" | "playlist") =>
    request<{ items: SpotifyItem[] }>(`/api/spotify/search?${new URLSearchParams({ q, type })}`),
  spotifyPlaylists: () => request<{ items: SpotifyItem[] }>("/api/spotify/playlists"),
  spotifyPlaylistItems: (playlistId: string) => request<{ items: SpotifyItem[] }>(`/api/spotify/playlists/${playlistId}/items`),
  spotifyPlay: (uri: string, deviceId?: string) => request("/api/spotify/play", json("POST", { uri, deviceId })),
};

/** PUT one chunk with XHR (fetch can't report upload progress). */
function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<{ partNumber: number; etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: any;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      reject(new ApiError(xhr.status, body?.error ?? `アップロードに失敗しました (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "ネットワークエラーでアップロードに失敗しました"));
    xhr.send(blob);
  });
}

const PART_CONCURRENCY = 3;
const PART_RETRIES = 3;

/**
 * Chunked upload straight into R2 multipart storage (the server never holds a whole file,
 * so multi-GB WAVs / stem zips work). Each chunk is retried a few times on failure.
 */
async function uploadOne(
  projectId: string,
  category: FileCategory,
  file: File,
  onProgress: (loadedBytes: number) => void,
): Promise<StoredFile> {
  const init = await request<{ fileId: string; key: string; uploadId: string; partSize: number }>(
    `/api/projects/${projectId}/uploads`,
    json("POST", { name: file.name, size: file.size, type: file.type, category }),
  );
  const qs = new URLSearchParams({ key: init.key, uploadId: init.uploadId });
  const base = `/api/projects/${projectId}/uploads/${init.fileId}`;
  const count = Math.max(1, Math.ceil(file.size / init.partSize));
  const loaded = new Array<number>(count).fill(0);
  const parts: { partNumber: number; etag: string }[] = [];
  let next = 0;

  async function worker() {
    while (next < count) {
      const index = next++;
      const blob = file.slice(index * init.partSize, Math.min(file.size, (index + 1) * init.partSize));
      for (let attempt = 1; ; attempt++) {
        try {
          parts.push(
            await putPart(`${base}/parts/${index + 1}?${qs}`, blob, (n) => {
              loaded[index] = n;
              onProgress(loaded.reduce((a, b) => a + b, 0));
            }),
          );
          break;
        } catch (e) {
          loaded[index] = 0;
          if (attempt >= PART_RETRIES || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, count) }, worker));
    return await request<StoredFile>(`${base}/complete?${qs}`, json("POST", { name: file.name, type: file.type, category, parts }));
  } catch (e) {
    void request(`${base}?${qs}`, json("DELETE")).catch(() => undefined);
    throw e;
  }
}

/** Upload several files one after another, reporting overall progress as a 0–1 fraction. */
export async function uploadFiles(
  projectId: string,
  category: FileCategory,
  files: File[],
  onProgress: (fraction: number) => void,
  onFileDone?: (file: StoredFile) => void,
): Promise<StoredFile[]> {
  const total = files.reduce((a, f) => a + f.size, 0) || 1;
  let done = 0;
  const created: StoredFile[] = [];
  for (const file of files) {
    const stored = await uploadOne(projectId, category, file, (n) => onProgress(Math.min(1, (done + n) / total)));
    created.push(stored);
    onFileDone?.(stored);
    done += file.size;
  }
  return created;
}
