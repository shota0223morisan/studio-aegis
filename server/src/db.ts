import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { config } from "./config.js";

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    thumbnail       TEXT,              -- stored file name under uploads/<id>/
    structure_memo  TEXT NOT NULL DEFAULT '',
    idea_memo       TEXT NOT NULL DEFAULT '',
    splice_url      TEXT NOT NULL DEFAULT '',
    splice_label    TEXT NOT NULL DEFAULT '',
    deadline        TEXT,              -- reserved for "deadline" sort
    pinned          INTEGER NOT NULL DEFAULT 0, -- reserved for "favorites first" sort
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spotify_refs (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,         -- track | album | playlist | episode | show | artist
    spotify_id  TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    subtitle    TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS spotify_refs_project ON spotify_refs(project_id, position);

  CREATE TABLE IF NOT EXISTS files (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category       TEXT NOT NULL,      -- client_ref | deliverable | other
    original_name  TEXT NOT NULL,
    stored_name    TEXT NOT NULL,
    mime           TEXT NOT NULL,
    size           INTEGER NOT NULL,
    note           TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS files_project ON files(project_id, created_at);

  CREATE TABLE IF NOT EXISTS kv (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`);

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function touchProject(projectId: string) {
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
}

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}

export function kvDelete(key: string) {
  db.prepare("DELETE FROM kv WHERE key = ?").run(key);
}
