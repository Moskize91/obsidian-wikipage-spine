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
  `CREATE TABLE IF NOT EXISTS note_mentions (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL
      REFERENCES notes(id) ON DELETE CASCADE,
    entity_id INTEGER
      REFERENCES entities(id) ON DELETE SET NULL,
    eid TEXT NOT NULL,
    text TEXT NOT NULL,
    surface_id INTEGER NOT NULL,
    surface TEXT,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    word_boundary_suspect INTEGER NOT NULL DEFAULT 0
      CHECK (word_boundary_suspect IN (0, 1)),
    resolved INTEGER NOT NULL DEFAULT 0
      CHECK (resolved IN (0, 1)),
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    CHECK (source_start >= 0 AND source_end > source_start)
  )`,
  `CREATE TABLE IF NOT EXISTS note_mention_conflicts (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL
      REFERENCES notes(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    text TEXT NOT NULL,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    left_context TEXT NOT NULL,
    right_context TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    CHECK (source_start >= 0 AND source_end > source_start)
  )`,
  `CREATE TABLE IF NOT EXISTS note_mention_conflict_matches (
    id INTEGER PRIMARY KEY,
    conflict_id INTEGER NOT NULL
      REFERENCES note_mention_conflicts(id) ON DELETE CASCADE,
    resolved_entity_id INTEGER
      REFERENCES entities(id) ON DELETE SET NULL,
    resolved_eid TEXT,
    text TEXT NOT NULL,
    surface_id INTEGER NOT NULL,
    surface TEXT,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    word_boundary_suspect INTEGER NOT NULL DEFAULT 0
      CHECK (word_boundary_suspect IN (0, 1)),
    candidate_eids_json TEXT NOT NULL,
    CHECK (source_start >= 0 AND source_end > source_start)
  )`,
  "CREATE INDEX IF NOT EXISTS notes_status_idx ON notes(status)",
  "CREATE INDEX IF NOT EXISTS notes_view_seen_scan_idx ON notes(view_last_seen_scan_id)",
  "CREATE INDEX IF NOT EXISTS entities_ref_count_idx ON entities(ref_count)",
  "CREATE INDEX IF NOT EXISTS entities_view_seen_scan_idx ON entities(view_last_seen_scan_id)",
  "CREATE INDEX IF NOT EXISTS note_mentions_note_id_idx ON note_mentions(note_id)",
  "CREATE INDEX IF NOT EXISTS note_mentions_eid_idx ON note_mentions(eid)",
  "CREATE INDEX IF NOT EXISTS note_mention_conflicts_note_id_idx ON note_mention_conflicts(note_id)",
  "CREATE INDEX IF NOT EXISTS note_mention_conflicts_hash_idx ON note_mention_conflicts(hash)",
  "CREATE INDEX IF NOT EXISTS note_mention_conflict_matches_conflict_id_idx ON note_mention_conflict_matches(conflict_id)",
  "CREATE INDEX IF NOT EXISTS note_mention_conflict_matches_resolved_eid_idx ON note_mention_conflict_matches(resolved_eid)",
] as const;

export const MODEL_QUERY_SQL = {
  selectMissingNotes: "SELECT * FROM notes WHERE status = 'missing' ORDER BY id",
  selectModifiedNotes: "SELECT * FROM notes WHERE status = 'modified' ORDER BY id",
  selectStaleViews:
    "SELECT * FROM notes WHERE view_exists = 1 AND (view_last_seen_scan_id IS NULL OR view_last_seen_scan_id <> ?) ORDER BY id",
  selectUnreferencedEntities: "SELECT * FROM entities WHERE ref_count = 0 ORDER BY id",
  selectStaleEntityViews:
    "SELECT * FROM entities WHERE view_last_seen_scan_id IS NULL OR view_last_seen_scan_id <> ? ORDER BY id",
  selectNoteMentions: "SELECT * FROM note_mentions WHERE note_id = ? ORDER BY source_start, id",
  selectNoteMentionConflicts:
    "SELECT * FROM note_mention_conflicts WHERE note_id = ? ORDER BY source_start, id",
  selectNoteMentionConflictMatches:
    "SELECT * FROM note_mention_conflict_matches WHERE conflict_id = ? ORDER BY source_start, id",
} as const;

export async function initializeModelDatabase(db: SqlExecutor): Promise<void> {
  for (const statement of MODEL_SCHEMA_SQL) {
    await db.exec(statement);
  }
}
