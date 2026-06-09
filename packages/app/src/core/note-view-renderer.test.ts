import { describe, expect, it } from "vitest";
import {
  renderNoteView,
  type NoteViewRenderOptions,
} from "./note-view-renderer";

const renderOptions: NoteViewRenderOptions = {
  isEntityViewLinkTarget(target) {
    return target.startsWith("wiki/");
  },
  entityLinkTarget(eid) {
    return entityTargets.get(eid);
  },
};

const entityTargets = new Map([
  ["Q956", "wiki/北京"],
  ["Q3918", "wiki/北京大学"],
  ["Q大学", "wiki/大学"],
]);

describe("note view renderer", () => {
  it("renders resolved mentions as entity wikilinks", () => {
    const markdown = "北京大学提出了计划。";

    expect(
      renderNoteView(
        markdown,
        {
          resolved: [
            {
              kind: "resolved",
              text: "北京大学",
              eid: "Q3918",
              surfaceId: 1,
              surface: "北京大学",
              sourceStart: 0,
              sourceEnd: 4,
            },
          ],
          conflicts: [],
        },
        renderOptions,
      ),
    ).toBe("[[wiki/北京大学|北京大学]]提出了计划。");
  });

  it("links each entity only once inside one section", () => {
    const markdown = "北京大学和北京大学";

    expect(
      renderNoteView(
        markdown,
        {
          resolved: [
            resolvedMention(0, 4, "北京大学", "Q3918"),
            resolvedMention(5, 9, "北京大学", "Q3918"),
          ],
          conflicts: [],
        },
        renderOptions,
      ),
    ).toBe("[[wiki/北京大学|北京大学]]和北京大学");
  });

  it("resets repeated entity tracking after a thematic break", () => {
    const markdown = "北京大学\n\n---\n\n北京大学";
    const secondStart = markdown.lastIndexOf("北京大学");

    expect(
      renderNoteView(
        markdown,
        {
          resolved: [
            resolvedMention(0, 4, "北京大学", "Q3918"),
            resolvedMention(secondStart, secondStart + 4, "北京大学", "Q3918"),
          ],
          conflicts: [],
        },
        renderOptions,
      ),
    ).toBe("[[wiki/北京大学|北京大学]]\n\n---\n\n[[wiki/北京大学|北京大学]]");
  });

  it("renders resolved conflict matches independently", () => {
    expect(
      renderNoteView(
        "北京大学",
        {
          resolved: [],
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
                conflictMatch(0, 2, "北京", ["Q956"], "Q956"),
                conflictMatch(0, 4, "北京大学", ["Q3918"]),
                conflictMatch(2, 4, "大学", ["Q大学"], "Q大学"),
              ],
            },
          ],
        },
        renderOptions,
      ),
    ).toBe("[[wiki/北京|北京]][[wiki/大学|大学]]");
  });

  it("uses the longest non-overlapping unique match for unresolved conflicts", () => {
    expect(
      renderNoteView(
        "北京大学",
        {
          resolved: [],
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
                conflictMatch(0, 2, "北京", ["Q956"]),
                conflictMatch(2, 4, "大学", ["Q大学"]),
                conflictMatch(0, 4, "北京大学", ["Q3918"]),
              ],
            },
          ],
        },
        renderOptions,
      ),
    ).toBe("[[wiki/北京大学|北京大学]]");
  });

  it("does not apply stale replacements inside protected table syntax", () => {
    const markdown = "|年代|节点|\n|---|---|\n|418|迦太基会议|\n北京大学";
    const start = markdown.indexOf("北京大学");

    expect(
      renderNoteView(
        markdown,
        {
          resolved: [
            resolvedMention(1, 3, "年代", "Q956"),
            resolvedMention(start, start + 4, "北京大学", "Q3918"),
          ],
          conflicts: [],
        },
        renderOptions,
      ),
    ).toBe("|年代|节点|\n|---|---|\n|418|迦太基会议|\n[[wiki/北京大学|北京大学]]");
  });

  it("does not apply stale replacements to markdown emphasis markers", () => {
    expect(
      renderNoteView(
        "**北京大学** 北京大学",
        {
          resolved: [
            resolvedMention(0, 2, "**", "Q956"),
            resolvedMention(2, 6, "北京大学", "Q3918"),
            resolvedMention(9, 13, "北京大学", "Q3918"),
          ],
          conflicts: [],
        },
        renderOptions,
      ),
    ).toBe("**[[wiki/北京大学|北京大学]]** 北京大学");
  });
});

function resolvedMention(
  sourceStart: number,
  sourceEnd: number,
  text: string,
  eid: string,
) {
  return {
    kind: "resolved" as const,
    text,
    eid,
    surfaceId: sourceStart,
    surface: text,
    sourceStart,
    sourceEnd,
  };
}

function conflictMatch(
  sourceStart: number,
  sourceEnd: number,
  text: string,
  eids: string[],
  resolvedEid?: string,
) {
  const match = {
    text,
    surfaceId: sourceStart,
    surface: text,
    sourceStart,
    sourceEnd,
    eids,
  };
  return resolvedEid === undefined ? match : { ...match, resolvedEid };
}
