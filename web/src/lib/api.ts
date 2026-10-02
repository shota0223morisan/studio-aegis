export interface Session {
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

/** Multipart upload with progress (fetch can't report upload progress). */
export function uploadFiles(
  projectId: string,
  category: FileCategory,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<StoredFile[]> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("category", category);
    for (const f of files) fd.append("files", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/files`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: any;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.items);
      else {
        if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        reject(new ApiError(xhr.status, body?.error ?? `アップロードに失敗しました (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "ネットワークエラーでアップロードに失敗しました"));
    xhr.send(fd);
  });
}
