import type { Flow, SimilarSong } from "./flow";

export interface Session {
  spotifyConfigured: boolean;
  maxUploadBytes: number;
}

export interface Client {
  id: string;
  name: string;
  note: string;
  position: number;
  songCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A song (曲): one piece of work, optionally under a client. */
export interface Project {
  id: string;
  name: string;
  clientId: string | null;
  brief: string;
  thumbnailUrl: string | null;
  structureMemo: string;
  ideaMemo: string;
  spliceUrl: string;
  spliceLabel: string;
  deadline: string | null;
  pinned: boolean;
  stage: number;
  submittedAt: string | null;
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
  flow: Flow;
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

export interface NotionOption {
  name: string;
  color: string;
}

export interface NotionProp {
  type: "text" | "options" | "count" | "other";
  text?: string;
  options?: NotionOption[];
}

export interface NotionIdea {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  editedAt: string;
  props: Record<string, NotionProp>;
}

export interface NotionIdeas {
  configured: boolean;
  items: NotionIdea[];
  fetchedAt?: number | null;
  error?: string;
  dbUrl: string;
}

export interface Prefs {
  gate: "hard" | "soft";
  timebox: Record<string, number>;
  autoLayout: boolean;
  aiModel: "claude" | "fable" | "opus" | "sonnet";
}

export interface AiMessage {
  id: string;
  stage: number;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface MidiNote {
  p: number;
  s: number;
  d: number;
  v: number;
}

export type MidiKind = "drums" | "bass" | "piano" | "guitar" | "strings" | "brass" | "synth" | "chords" | "melody" | "other";

export interface MidiTrack {
  name: string;
  channel: number;
  notes: MidiNote[];
}

export interface MidiClip {
  id: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  kind: MidiKind;
  bpm: number | null;
  bars: number | null;
  source: "ai" | "upload";
  prompt: string;
  tracks: { name: string; channel: number; notes: MidiNote[] }[];
  createdAt: string;
  fileUrl: string;
}

export interface RichText {
  t: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  c?: boolean;
  href?: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  text: RichText[];
  checked?: boolean;
  toggle?: boolean;
  icon?: string;
  children?: NotionBlock[];
}

export interface NotionPage {
  configured: boolean;
  title?: string;
  icon?: string;
  url: string;
  blocks: NotionBlock[];
  fetchedAt?: number;
  error?: string;
}

export interface NotionStatus {
  configured: boolean;
  dbId: string;
  dbUrl: string;
  mixPage: string;
  mixUrl: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  session: () => request<Session>("/api/session"),

  listClients: () => request<{ items: Client[] }>("/api/clients"),
  createClient: (name: string) => request<Client>("/api/clients", json("POST", { name })),
  updateClient: (id: string, patch: Partial<Pick<Client, "name" | "note">>) => request<Client>(`/api/clients/${id}`, json("PATCH", patch)),
  reorderClients: (order: string[]) => request("/api/clients/order", json("PUT", { order })),
  deleteClient: (id: string) => request(`/api/clients/${id}`, json("DELETE")),

  listProjects: (sort = "updated") => request<{ items: Project[] }>(`/api/projects?sort=${sort}`),
  createProject: (name: string, clientId: string | null) => request<Project>("/api/projects", json("POST", { name, clientId })),
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  updateProject: (id: string, patch: Partial<Project> & { flow?: Flow }) => request<Project>(`/api/projects/${id}`, json("PATCH", patch)),
  deleteProject: (id: string) => request(`/api/projects/${id}`, json("DELETE")),
  setThumbnail: (id: string, file: File) =>
    request<Project>(`/api/projects/${id}/thumbnail?${new URLSearchParams({ name: file.name })}`, { method: "PUT", body: file }),
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

  notionStatus: () => request<NotionStatus>("/api/notion/status"),
  notionSettings: (patch: { token?: string; db?: string; mixPage?: string }) => request<NotionStatus>("/api/notion/settings", json("PUT", patch)),
  notionIdeas: (refresh = false) => request<NotionIdeas>(`/api/notion/ideas${refresh ? "?refresh=1" : ""}`),
  notionMix: (refresh = false) => request<NotionPage>(`/api/notion/mix${refresh ? "?refresh=1" : ""}`),

  mixChecklist: () => request<{ items: { id: string; text: string; origin?: string; deleted?: boolean }[] | null }>("/api/mix-checklist"),
  setMixChecklist: (items: { id: string; text: string; origin?: string; deleted?: boolean }[]) => request("/api/mix-checklist", json("PUT", { items })),

  scratch: () => request<{ text: string }>("/api/scratch"),
  setScratch: (text: string) => request<{ text: string }>("/api/scratch", json("PUT", { text })),
  prefs: () => request<Prefs>("/api/prefs"),
  setPrefs: (patch: Partial<Prefs>) => request<Prefs>("/api/prefs", json("PUT", patch)),

  aiStatus: () => request<{ found: boolean; path: string; version: string }>("/api/ai/status"),
  aiMessages: (id: string, stage: number) => request<{ items: AiMessage[] }>(`/api/projects/${id}/ai?stage=${stage}`),
  aiClear: (id: string, stage: number) => request(`/api/projects/${id}/ai?stage=${stage}`, json("DELETE")),
  aiSimilar: (id: string, focus?: string) => request<{ items: SimilarSong[]; at: string }>(`/api/projects/${id}/ai/similar`, json("POST", { focus })),
  aiSuno: (id: string, part?: string) => request<{ style: string; exclude: string; note: string }>(`/api/projects/${id}/ai/suno`, json("POST", { part })),
  aiMidi: (id: string, body: { kind: string; bars: number; prompt: string; section?: string; refClipId?: string }) =>
    request<{ clip: MidiClip; comment: string }>(`/api/projects/${id}/ai/midi`, json("POST", body)),

  listMidi: (params: { project?: string; kind?: string; q?: string }) =>
    request<{ items: MidiClip[] }>(`/api/midi?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])}`),
  updateMidi: (clipId: string, patch: { name?: string; kind?: string; projectId?: null }) => request<MidiClip>(`/api/midi/${clipId}`, json("PATCH", patch)),
  deleteMidi: (clipId: string) => request(`/api/midi/${clipId}`, json("DELETE")),
  copyMidi: (clipId: string, projectId: string) => request<MidiClip>(`/api/midi/${clipId}/copy`, json("POST", { projectId })),
  createMidi: (body: { projectId?: string; name: string; kind: MidiKind; bpm: number; bars: number; tracks: MidiTrack[]; prompt?: string }) =>
    request<MidiClip>("/api/midi", json("POST", body)),
  importSongMidi: (file: File, projectId?: string) =>
    request<{ bpm: number | null; bars: number; clips: MidiClip[]; tracks: (MidiTrack & { kind: MidiKind })[] }>(
      `/api/midi/import?${new URLSearchParams({ name: file.name, ...(projectId ? { project: projectId } : {}) })}`,
      { method: "PUT", body: file },
    ),
  uploadMidi: (file: File, projectId?: string) =>
    request<MidiClip>(`/api/midi?${new URLSearchParams({ name: file.name, ...(projectId ? { project: projectId } : {}) })}`, { method: "PUT", body: file }),

  spotifyStatus: () => request<SpotifyStatus>("/api/spotify/status"),
  spotifyLogout: () => request("/api/spotify/logout", json("POST")),
  spotifySetClientId: (clientId: string) => request("/api/spotify/client-id", json("PUT", { clientId })),
  spotifySearch: (q: string, type: "track" | "album" | "playlist") =>
    request<{ items: SpotifyItem[] }>(`/api/spotify/search?${new URLSearchParams({ q, type })}`),
  spotifyPlaylists: () => request<{ items: SpotifyItem[] }>("/api/spotify/playlists"),
  spotifyPlaylistItems: (playlistId: string) => request<{ items: SpotifyItem[] }>(`/api/spotify/playlists/${playlistId}/items`),
  spotifyPlay: (uri: string) => request<{ ok: true; device: string }>("/api/spotify/play", json("POST", { uri })),
};

/** Upload one file as a raw PUT body, with progress (fetch can't report upload progress). */
function uploadOne(projectId: string, category: FileCategory, file: File, onProgress: (loaded: number) => void): Promise<StoredFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/projects/${projectId}/files?${new URLSearchParams({ name: file.name, category })}`);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: any;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.error ?? `追加に失敗しました (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "ファイルの追加に失敗しました"));
    xhr.send(file);
  });
}

/** Add several files one after another, reporting overall progress as a 0–1 fraction. */
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
