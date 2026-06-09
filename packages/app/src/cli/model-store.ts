import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  statSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { MODEL_SCHEMA_SQL } from "../model";
import type { MentionConflict } from "../core/note-mentions";
import type { NoteViewMentions } from "../core/note-view-renderer";
import type { PluginSettings } from "../plugin/settings";

export interface EntityRecord {
  id: number;
  eid: string;
  viewPath: string;
}

export interface StoredConflictResolution {
  hash: string;
  text: string;
  surfaceId: number;
  sourceStart: number;
  sourceEnd: number;
  resolvedEid: string;
}

export interface NoteObservation {
  mtimeMs: number;
  sizeBytes: number;
  hash: string;
}

type SqlValue = string | number | null | undefined;

interface IdRow {
  id: number;
}

interface EntityRow {
  id: number;
  eid: string;
  view_path: string;
}

interface EidRow {
  eid: string;
}

interface ConflictResolutionRow {
  hash: string;
  text: string;
  surface_id: number;
  source_start: number;
  source_end: number;
  resolved_eid: string | null;
}

export class ModelStore {
  constructor(readonly databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    runSqlite(
      this.databasePath,
      ["PRAGMA foreign_keys = ON", ...MODEL_SCHEMA_SQL].map(terminateSql).join("\n"),
    );
  }

  close(): void {}

  ensureNote(viewPath: string, now: number): number {
    const rows = querySqlite<IdRow>(
      this.databasePath,
      [
        sql`INSERT OR IGNORE INTO notes (
          status, view_path, view_exists, created_at_unix_ms, updated_at_unix_ms
        ) VALUES ('modified', ${viewPath}, 1, ${now}, ${now})`,
        sql`UPDATE notes SET view_exists = 1, updated_at_unix_ms = ${now} WHERE view_path = ${viewPath}`,
        sql`SELECT id FROM notes WHERE view_path = ${viewPath}`,
      ]
        .map(terminateSql)
        .join("\n"),
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`Failed to create note row: ${viewPath}`);
    }
    return id;
  }

  readConflictResolutions(noteId: number): StoredConflictResolution[] {
    const rows = querySqlite<ConflictResolutionRow>(
      this.databasePath,
      sql`SELECT
          c.hash,
          m.text,
          m.surface_id,
          m.source_start,
          m.source_end,
          m.resolved_eid
        FROM note_mention_conflicts c
        JOIN note_mention_conflict_matches m ON m.conflict_id = c.id
        WHERE c.note_id = ${noteId} AND m.resolved_eid IS NOT NULL`,
    );
    return rows.flatMap((row) =>
      row.resolved_eid === null
        ? []
        : [
            {
              hash: row.hash,
              text: row.text,
              surfaceId: row.surface_id,
              sourceStart: row.source_start,
              sourceEnd: row.source_end,
              resolvedEid: row.resolved_eid,
            },
          ],
    );
  }

  ensureEntities(
    eids: Iterable<string>,
    settings: Pick<PluginSettings, "entityDir" | "preferredLang">,
    now: number,
  ): Map<string, EntityRecord> {
    const entities = new Map<string, EntityRecord>();
    const uniqueEids = [...new Set(eids)].sort();
    if (uniqueEids.length === 0) {
      return entities;
    }

    runTransaction(
      this.databasePath,
      uniqueEids.map((eid) =>
        sql`INSERT OR IGNORE INTO entities (
          eid, preferred_lang, view_path, created_at_unix_ms, updated_at_unix_ms
        ) VALUES (
          ${eid},
          ${settings.preferredLang},
          ${entityViewPathForEid(settings.entityDir, eid)},
          ${now},
          ${now}
        )`,
      ),
    );

    const rows = querySqlite<EntityRow>(
      this.databasePath,
      `SELECT id, eid, view_path FROM entities WHERE eid IN (${uniqueEids.map(sqlValue).join(", ")})`,
    );
    for (const row of rows) {
      entities.set(row.eid, {
        id: row.id,
        eid: row.eid,
        viewPath: row.view_path,
      });
    }
    return entities;
  }

  findEntityEidByViewPath(viewPath: string): string | undefined {
    return querySqlite<EidRow>(
      this.databasePath,
      sql`SELECT eid FROM entities WHERE view_path = ${viewPath}`,
    )[0]?.eid;
  }

  replaceNoteMentions(
    noteId: number,
    mentions: NoteViewMentions,
    entities: Map<string, EntityRecord>,
    now: number,
  ): void {
    const statements: string[] = [
      sql`DELETE FROM note_mentions WHERE note_id = ${noteId}`,
      sql`DELETE FROM note_mention_conflicts WHERE note_id = ${noteId}`,
    ];

    for (const mention of mentions.resolved) {
      statements.push(sql`INSERT INTO note_mentions (
        note_id, entity_id, eid, text, surface_id, surface,
        source_start, source_end, created_at_unix_ms, updated_at_unix_ms
      ) VALUES (
        ${noteId},
        ${entities.get(mention.eid)?.id},
        ${mention.eid},
        ${mention.text},
        ${mention.surfaceId},
        ${mention.surface},
        ${mention.sourceStart},
        ${mention.sourceEnd},
        ${now},
        ${now}
      )`);
    }

    for (const conflict of mentions.conflicts) {
      statements.push(sql`INSERT INTO note_mention_conflicts (
        note_id, hash, text, source_start, source_end, left_context,
        right_context, created_at_unix_ms, updated_at_unix_ms
      ) VALUES (
        ${noteId},
        ${conflict.hash},
        ${conflict.text},
        ${conflict.sourceStart},
        ${conflict.sourceEnd},
        ${conflict.leftContext},
        ${conflict.rightContext},
        ${now},
        ${now}
      )`);

      if (conflict.matches.length > 0) {
        statements.push(
          `WITH new_conflict(id) AS (SELECT last_insert_rowid())
          INSERT INTO note_mention_conflict_matches (
            conflict_id, resolved_entity_id, resolved_eid, text, surface_id,
            surface, source_start, source_end, candidate_eids_json
          ) ${conflict.matches
            .map((match, index) => {
              const resolvedEntity =
                match.resolvedEid === undefined
                  ? undefined
                  : entities.get(match.resolvedEid);
              const prefix = index === 0 ? "SELECT" : "UNION ALL SELECT";
              return `${prefix}
                new_conflict.id,
                ${sqlValue(resolvedEntity?.id)},
                ${sqlValue(match.resolvedEid)},
                ${sqlValue(match.text)},
                ${sqlValue(match.surfaceId)},
                ${sqlValue(match.surface)},
                ${sqlValue(match.sourceStart)},
                ${sqlValue(match.sourceEnd)},
                ${sqlValue(JSON.stringify(match.eids))}
                FROM new_conflict`;
            })
            .join("\n")}`,
        );
      }
    }

    statements.push(recomputeEntityRefCountsSql());
    runTransaction(this.databasePath, statements);
  }

  markNoteSynced(noteId: number, observation: NoteObservation, now: number): void {
    runSqlite(
      this.databasePath,
      sql`UPDATE notes SET
          status = 'synced',
          view_exists = 1,
          view_mtime_unix_ms = ${observation.mtimeMs},
          view_size_bytes = ${observation.sizeBytes},
          view_hash = ${observation.hash},
          view_last_scanned_at_unix_ms = ${now},
          updated_at_unix_ms = ${now}
        WHERE id = ${noteId}`,
    );
  }
}

export function entityViewPathForEid(entityDir: string, eid: string): string {
  return entityDir ? `${entityDir}/${eid}.md` : `${eid}.md`;
}

export function entityLinkTargetForEid(entityDir: string, eid: string): string {
  const viewPath = entityViewPathForEid(entityDir, eid);
  return viewPath.endsWith(".md") ? viewPath.slice(0, -3) : viewPath;
}

export function collectMentionEids(mentions: NoteViewMentions): string[] {
  return [
    ...mentions.resolved.map((mention) => mention.eid),
    ...mentions.conflicts.flatMap((conflict) =>
      conflict.matches.flatMap((match) =>
        match.resolvedEid === undefined
          ? match.eids
          : [...match.eids, match.resolvedEid],
      ),
    ),
  ];
}

export function applyStoredConflictResolutions(
  conflicts: MentionConflict[],
  stored: readonly StoredConflictResolution[],
): void {
  const byKey = new Map(
    stored.map((resolution) => [resolutionKey(resolution), resolution]),
  );
  for (const conflict of conflicts) {
    for (const match of conflict.matches) {
      if (match.resolvedEid !== undefined) {
        continue;
      }
      const resolution = byKey.get(
        resolutionKey({
          hash: conflict.hash,
          text: match.text,
          surfaceId: match.surfaceId,
          sourceStart: match.sourceStart,
          sourceEnd: match.sourceEnd,
        }),
      );
      if (
        resolution !== undefined &&
        match.eids.includes(resolution.resolvedEid)
      ) {
        match.resolvedEid = resolution.resolvedEid;
      }
    }
  }
}

export function ensureEntityViews(
  vaultDir: string,
  entities: Iterable<EntityRecord>,
  preferredLang: PluginSettings["preferredLang"],
): void {
  for (const entity of entities) {
    const absolutePath = join(vaultDir, entity.viewPath);
    if (existsSync(absolutePath)) {
      continue;
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    // 实体 view 归系统托管；第一版还没有异步元数据，所以只写能稳定关联数据库的保留字段。
    writeFileSync(
      absolutePath,
      `---\nEID: ${entity.eid}\nPreferredLang: ${preferredLang}\n---\n`,
      "utf8",
    );
  }
}

export function observeFile(path: string): NoteObservation {
  const stat = statSync(path);
  return {
    mtimeMs: Math.trunc(stat.mtimeMs),
    sizeBytes: stat.size,
    hash: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function resolutionKey(value: {
  hash: string;
  text: string;
  surfaceId: number;
  sourceStart: number;
  sourceEnd: number;
}): string {
  return [
    value.hash,
    value.text,
    String(value.surfaceId),
    String(value.sourceStart),
    String(value.sourceEnd),
  ].join("\0");
}

function runTransaction(dbPath: string, statements: readonly string[]): void {
  if (statements.length === 0) {
    return;
  }
  runSqlite(
    dbPath,
    [
      "PRAGMA foreign_keys = ON;",
      "BEGIN IMMEDIATE;",
      ...statements.map(terminateSql),
      "COMMIT;",
    ].join("\n"),
  );
}

function querySqlite<T>(dbPath: string, sqlText: string): T[] {
  const output = runSqlite(dbPath, sqlText, ["-json"]);
  if (output.trim().length === 0) {
    return [];
  }
  return JSON.parse(output) as T[];
}

function runSqlite(
  dbPath: string,
  sqlText: string,
  extraArgs: readonly string[] = [],
): string {
  try {
    return execFileSync("sqlite3", [...extraArgs, dbPath], {
      encoding: "utf8",
      input: sqlText,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      throw new Error("sqlite3 command is required in PATH.");
    }
    throw error;
  }
}

function recomputeEntityRefCountsSql(): string {
  return `UPDATE entities SET ref_count = (
    SELECT COUNT(*) FROM note_mentions
    WHERE note_mentions.eid = entities.eid
  ) + (
    SELECT COUNT(*) FROM note_mention_conflict_matches
    WHERE note_mention_conflict_matches.resolved_eid = entities.eid
  )`;
}

function sql(
  strings: TemplateStringsArray,
  ...values: readonly SqlValue[]
): string {
  let output = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    output += sqlValue(values[index]);
    output += strings[index + 1] ?? "";
  }
  return output;
}

function sqlValue(value: SqlValue): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid SQL number: ${value}`);
    }
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function terminateSql(statement: string): string {
  const trimmed = statement.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}
