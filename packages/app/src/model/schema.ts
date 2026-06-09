export const MODEL_SCHEMA_VERSION = 1;

export const NOTE_STATUS_VALUES = ["missing", "synced", "modified"] as const;

export type NoteStatus = (typeof NOTE_STATUS_VALUES)[number];

export interface SqlExecutor {
  exec(sql: string): void | Promise<void>;
}

export const MODEL_SCHEMA_SQL = [
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE IF NOT EXISTS model_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `INSERT INTO model_meta (key, value)
    VALUES ('schema_version', '${MODEL_SCHEMA_VERSION}')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'missing'
      CHECK (status IN ('missing', 'synced', 'modified')),
    view_path TEXT NOT NULL UNIQUE,
    view_exists INTEGER NOT NULL DEFAULT 0
      CHECK (view_exists IN (0, 1)),
    view_mtime_unix_ms INTEGER,
    view_size_bytes INTEGER,
    view_hash TEXT,
    view_last_seen_scan_id INTEGER,
    view_last_scanned_at_unix_ms INTEGER,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    CHECK (
      (status = 'missing' AND view_exists = 0)
      OR (status IN ('synced', 'modified') AND view_exists = 1)
    )
  )`,
  `CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    eid TEXT NOT NULL UNIQUE,
    preferred_lang TEXT NOT NULL
      CHECK (preferred_lang IN ('zh', 'en')),
    metadata_complete INTEGER NOT NULL DEFAULT 0
      CHECK (metadata_complete IN (0, 1)),
    metadata_checked_at_unix_ms INTEGER,
    wikipage_url TEXT,
    title TEXT,
    description TEXT,
    summary TEXT,
    image_url TEXT,
    ref_count INTEGER NOT NULL DEFAULT 0
      CHECK (ref_count >= 0),
    view_path TEXT NOT NULL UNIQUE,
    view_mtime_unix_ms INTEGER,
    view_size_bytes INTEGER,
    view_hash TEXT,
    view_last_seen_scan_id INTEGER,
    view_last_scanned_at_unix_ms INTEGER,
    managed_properties_json TEXT NOT NULL DEFAULT '{}',
    managed_properties_hash TEXT,
    user_content_hash TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS notes_status_idx ON notes(status)",
  "CREATE INDEX IF NOT EXISTS notes_view_seen_scan_idx ON notes(view_last_seen_scan_id)",
  "CREATE INDEX IF NOT EXISTS entities_ref_count_idx ON entities(ref_count)",
  "CREATE INDEX IF NOT EXISTS entities_view_seen_scan_idx ON entities(view_last_seen_scan_id)",
] as const;

export const MODEL_QUERY_SQL = {
  selectMissingNotes: "SELECT * FROM notes WHERE status = 'missing' ORDER BY id",
  selectModifiedNotes: "SELECT * FROM notes WHERE status = 'modified' ORDER BY id",
  selectStaleViews:
    "SELECT * FROM notes WHERE view_exists = 1 AND (view_last_seen_scan_id IS NULL OR view_last_seen_scan_id <> ?) ORDER BY id",
  selectUnreferencedEntities: "SELECT * FROM entities WHERE ref_count = 0 ORDER BY id",
  selectStaleEntityViews:
    "SELECT * FROM entities WHERE view_last_seen_scan_id IS NULL OR view_last_seen_scan_id <> ? ORDER BY id",
} as const;

export async function initializeModelDatabase(db: SqlExecutor): Promise<void> {
  for (const statement of MODEL_SCHEMA_SQL) {
    await db.exec(statement);
  }
}
