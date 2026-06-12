import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NoteViewMentions } from "../core/note-view-renderer";
import { collectMentionEids, ModelStore } from "./model-store";

const sqlite3Available = hasSqlite3();

describe("model store", () => {
  it("collects only effective entity references", () => {
    const mentions: NoteViewMentions = {
      resolved: [
        resolvedMention("Q1", "恩典", false, false),
        resolvedMention("Q2", "Spa", true, false),
        resolvedMention("Q3", "中有", true, true),
      ],
      conflicts: [
        {
          kind: "conflict",
          text: "北京大学",
          hash: "hash",
          sourceStart: 0,
          sourceEnd: 4,
          leftContext: "",
          rightContext: "",
          matches: [
            {
              text: "北京",
              surfaceId: 1,
              surface: "北京",
              sourceStart: 0,
              sourceEnd: 2,
              eids: ["Q4"],
              wordBoundarySuspect: false,
              resolvedEid: "Q4",
            },
          ],
        },
      ],
    };

    expect(collectMentionEids(mentions)).toEqual(["Q1", "Q3", "Q4"]);
  });

  it.skipIf(!sqlite3Available)(
    "stores word-boundary suspects without counting unresolved suspects as references",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "wikipage-spine-model-store-"));
      const dbPath = join(dir, "model.sqlite");

      try {
        const store = new ModelStore(dbPath);
        const now = 1;
        const noteId = store.ensureNote("Notes/User.md", now);
        const entities = store.ensureEntities(
          ["Q1", "Q3"],
          { entityDir: "wiki", preferredLang: "zh" },
          now,
        );
        store.replaceNoteMentions(
          noteId,
          {
            resolved: [
              resolvedMention("Q1", "Spa", true, false),
              resolvedMention("Q3", "中有", true, true),
            ],
            conflicts: [],
          },
          entities,
          now,
        );

        const rows = execFileSync(
          "sqlite3",
          [
            dbPath,
            [
              "SELECT eid || ':' || word_boundary_suspect || ':' || resolved FROM note_mentions ORDER BY eid;",
              "SELECT eid || ':' || ref_count FROM entities ORDER BY eid;",
            ].join(" "),
          ],
          { encoding: "utf8" },
        ).trim();

        expect(rows).toBe(
          ["Q1:1:0", "Q3:1:1", "Q1:0", "Q3:1"].join("\n"),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

function resolvedMention(
  eid: string,
  text: string,
  wordBoundarySuspect: boolean,
  resolved: boolean,
) {
  return {
    kind: "resolved" as const,
    text,
    eid,
    surfaceId: Number(eid.slice(1)),
    surface: text,
    sourceStart: 0,
    sourceEnd: text.length,
    wordBoundarySuspect,
    resolved,
  };
}

function hasSqlite3(): boolean {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
