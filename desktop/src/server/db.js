// Local data store: SQLite (built into Electron's Node) + files on disk.
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function openDatabase(dataDir) {
  fs.mkdirSync(path.join(dataDir, "files"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "midi"), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "aegis.db"));

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      thumbnail       TEXT,              -- file name under files/<project id>/
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
      kind        TEXT NOT NULL,
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

  migrate(db);

  return {
    db,
    filesDir: path.join(dataDir, "files"),
    midiDir: path.join(dataDir, "midi"),
    kvGet(key) {
      const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
      return row ? JSON.parse(row.value) : undefined;
    },
    kvSet(key, value) {
      db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        key,
        JSON.stringify(value),
      );
    },
    kvDelete(key) {
      db.prepare("DELETE FROM kv WHERE key = ?").run(key);
    },
  };
}

/** Schema changes after the first release, applied in order and tracked with PRAGMA user_version. */
const MIGRATIONS = [
  // v1: clients (取引先) → songs, and the client's brief per song
  `
    CREATE TABLE IF NOT EXISTS clients (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
    ALTER TABLE projects ADD COLUMN brief TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS projects_client ON projects(client_id, updated_at);
  `,
  // v2: production flow (stage + per-stage data as JSON), AI conversations, MIDI library
  `
    ALTER TABLE projects ADD COLUMN stage INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE projects ADD COLUMN flow TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE projects ADD COLUMN submitted_at TEXT;
    CREATE TABLE IF NOT EXISTS ai_messages (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage       INTEGER NOT NULL,
      role        TEXT NOT NULL,       -- user | assistant
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_messages_project ON ai_messages(project_id, stage, created_at);
    -- MIDI library: every clip lives here (file at midi/<id>.mid); project_id = the song it belongs to.
    -- Clips of a deleted song stay in the library.
    CREATE TABLE IF NOT EXISTS midi_clips (
      id          TEXT PRIMARY KEY,
      project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'other',  -- drums | bass | chords | melody | other
      bpm         REAL,
      bars        INTEGER,
      data        TEXT NOT NULL DEFAULT '{}',     -- { tracks: [{ name, channel, notes: [{ p, s, d, v }] }] } (beats)
      source      TEXT NOT NULL DEFAULT 'upload', -- ai | upload
      prompt      TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS midi_clips_project ON midi_clips(project_id, created_at);
  `,
];

function migrate(db) {
  const { user_version: version } = db.prepare("PRAGMA user_version").get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

module.exports = { openDatabase, newId, now };
