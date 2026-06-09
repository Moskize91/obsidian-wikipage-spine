import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_SCHEMA_SQL,
  MODEL_SCHEMA_VERSION,
  NOTE_STATUS_VALUES,
  initializeModelDatabase,
} from "./schema";

const sqlite3Available = hasSqlite3();

describe("model schema", () => {
  it("initializes an executor with ordered schema statements", async () => {
    const executed: string[] = [];

    await initializeModelDatabase({
      exec(statement) {
        executed.push(statement);
      },
    });

    expect(executed).toEqual([...MODEL_SCHEMA_SQL]);
    expect(executed.join("\n")).toContain(`'schema_version', '${MODEL_SCHEMA_VERSION}'`);
  });

  it("defines the expected note statuses", () => {
    expect(NOTE_STATUS_VALUES).toEqual(["missing", "synced", "modified"]);
  });

  it.skipIf(!sqlite3Available)("creates a sqlite database with model constraints", () => {
    const dir = mkdtempSync(join(tmpdir(), "wikipage-spine-model-"));
    const dbPath = join(dir, "model.sqlite");

    try {
      runSqlite(dbPath, [
        ...MODEL_SCHEMA_SQL,
        `INSERT INTO notes (
          status,
          view_path,
          view_exists,
          created_at_unix_ms,
          updated_at_unix_ms
        ) VALUES (
          'missing',
          'Missing.md',
          0,
          1,
          1
        )`,
        `INSERT INTO notes (
          status,
          view_path,
          view_exists,
          view_last_seen_scan_id,
          created_at_unix_ms,
          updated_at_unix_ms
        ) VALUES (
          'synced',
          'Notes/User.md',
          1,
          7,
          1,
          1
        )`,
        `INSERT INTO entities (
          eid,
          preferred_lang,
          title,
          summary,
          image_url,
          ref_count,
          view_path,
          created_at_unix_ms,
          updated_at_unix_ms
        ) VALUES (
          'Q2',
          'en',
          'Earth',
          'Third planet from the Sun.',
          'https://example.invalid/earth.jpg',
          0,
          'Entities/Q2.md',
          1,
          1
        )`,
      ]);

      const rows = execFileSync(
        "sqlite3",
        [
          dbPath,
          [
            "SELECT 'note:' || view_path || ':' || status FROM notes ORDER BY view_path;",
            "SELECT 'entity:' || eid || ':' || preferred_lang || ':' || metadata_complete || ':' || COALESCE(wikipage_url, '') FROM entities ORDER BY eid;",
          ].join(" "),
        ],
        { encoding: "utf8" },
      ).trim();

      expect(rows).toBe(
        [
          "note:Missing.md:missing",
          "note:Notes/User.md:synced",
          "entity:Q2:en:0:",
        ].join("\n"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!sqlite3Available)("rejects impossible note states", () => {
    const dir = mkdtempSync(join(tmpdir(), "wikipage-spine-model-"));
    const dbPath = join(dir, "model.sqlite");

    try {
      runSqlite(dbPath, MODEL_SCHEMA_SQL);

      expect(() =>
        runSqlite(dbPath, [
          `INSERT INTO notes (
            status,
            view_path,
            view_exists,
            created_at_unix_ms,
            updated_at_unix_ms
          ) VALUES (
            'synced',
            'Broken.md',
            0,
            1,
            1
          )`,
        ]),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!sqlite3Available)("requires an entity preferred language", () => {
    const dir = mkdtempSync(join(tmpdir(), "wikipage-spine-model-"));
    const dbPath = join(dir, "model.sqlite");

    try {
      runSqlite(dbPath, MODEL_SCHEMA_SQL);

      expect(() =>
        runSqlite(dbPath, [
          `INSERT INTO entities (
            eid,
            view_path,
            created_at_unix_ms,
            updated_at_unix_ms
          ) VALUES (
            'Q4',
            'Entities/Q4.md',
            1,
            1
          )`,
        ]),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function hasSqlite3(): boolean {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runSqlite(dbPath: string, statements: readonly string[]): void {
  execFileSync("sqlite3", [dbPath], {
    input: `${statements.join(";\n")};\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
