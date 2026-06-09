import { describe, expect, it } from "vitest";
import type { SurfaceMatch } from "../surface-matcher";
import {
  extractNoteMentions,
  normalizeObsidianView,
  type SurfaceScanner,
} from ".";

const entityLinkOptions = {
  isEntityViewLinkTarget(target: string): boolean {
    return resolveEntityTarget(target) !== undefined;
  },
  resolveEntityViewLinkTarget(target: string): string | undefined {
    return resolveEntityTarget(target);
  },
};

describe("note mentions", () => {
  it("expands managed entity wikilinks into visible text characters", () => {
    const tokens = normalizeObsidianView(
      "见 [[wiki/艾萨克·牛顿|牛顿]]。",
      entityLinkOptions,
    );

    expect(
      tokens
        .map((token) =>
          token.kind === "char" ? token.char : `[${token.syntax}]`,
        )
        .join(""),
    ).toBe("见 牛顿。");
    expect(tokens.every((token) => token.kind === "char")).toBe(true);
  });

  it("expands managed entity markdown links into visible text characters", () => {
    const tokens = normalizeObsidianView(
      "见 [牛顿](wiki/艾萨克·牛顿.md)。",
      entityLinkOptions,
    );

    expect(
      tokens
        .map((token) =>
          token.kind === "char" ? token.char : `[${token.syntax}]`,
        )
        .join(""),
    ).toBe("见 牛顿。");
  });

  it("keeps non-entity special structures as matcher barriers", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 4,
        surface: "北京大学",
        surfaceId: 1,
        qids: ["Q1"],
      }),
    ]);

    const result = extractNoteMentions(
      "北京`大学`",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("resolves isolated unique surface matches", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 2,
        surface: "牛顿",
        surfaceId: 10,
        qids: ["Q935"],
      }),
    ]);

    const result = extractNoteMentions(
      "[牛顿](wiki/艾萨克·牛顿.md)提出理论。",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toMatchObject([
      {
        kind: "resolved",
        text: "牛顿",
        eid: "Q935",
        surfaceId: 10,
      },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("creates conflicts for a single ambiguous surface", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 2,
        surface: "苹果",
        surfaceId: 20,
        qids: ["Q89", "Q312"],
      }),
    ]);

    const result = extractNoteMentions(
      "苹果很好。",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      kind: "conflict",
      text: "苹果",
      matches: [{ text: "苹果", eids: ["Q89", "Q312"] }],
    });
  });

  it("clusters nested and overlapping surfaces into one conflict", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 2,
        surface: "北京",
        surfaceId: 1,
        qids: ["Q956"],
      }),
      surfaceMatch({
        start: 2,
        end: 4,
        surface: "大学",
        surfaceId: 2,
        qids: ["Q3918"],
      }),
      surfaceMatch({
        start: 0,
        end: 4,
        surface: "北京大学",
        surfaceId: 3,
        qids: ["Q3918"],
      }),
    ]);

    const result = extractNoteMentions("北京大学", scanner, entityLinkOptions);

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.text).toBe("北京大学");
    expect(result.conflicts[0]?.matches.map((match) => match.text)).toEqual([
      "北京",
      "北京大学",
      "大学",
    ]);
  });

  it("uses an expanded entity wikilink as a conflict resolution hint", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 2,
        surface: "北京",
        surfaceId: 1,
        qids: ["Q956"],
      }),
      surfaceMatch({
        start: 2,
        end: 4,
        surface: "大学",
        surfaceId: 2,
        qids: ["Q3918"],
      }),
      surfaceMatch({
        start: 0,
        end: 4,
        surface: "北京大学",
        surfaceId: 3,
        qids: ["Q3918"],
      }),
    ]);

    const result = extractNoteMentions(
      "[[wiki/北京]]大学",
      scanner,
      entityLinkOptions,
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.matches).toMatchObject([
      { text: "北京", resolvedEid: "Q956" },
      { text: "北京大学" },
      { text: "大学" },
    ]);
  });

  it("uses adjacent expanded entity wikilinks as independent conflict resolution hints", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 2,
        surface: "北京",
        surfaceId: 1,
        qids: ["Q956"],
      }),
      surfaceMatch({
        start: 2,
        end: 4,
        surface: "大学",
        surfaceId: 2,
        qids: ["Q3918"],
      }),
      surfaceMatch({
        start: 0,
        end: 4,
        surface: "北京大学",
        surfaceId: 3,
        qids: ["Q3918"],
      }),
    ]);

    const result = extractNoteMentions(
      "[[wiki/北京]][[wiki/大学]]",
      scanner,
      entityLinkOptions,
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.matches).toMatchObject([
      { text: "北京", resolvedEid: "Q956" },
      { text: "北京大学" },
      { text: "大学", resolvedEid: "Q3918" },
    ]);
  });

  it("keeps conflict hashes stable across unrelated source markup changes", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 2,
        end: 4,
        surface: "苹果",
        surfaceId: 20,
        qids: ["Q89", "Q312"],
      }),
    ]);

    const first = extractNoteMentions("喜欢苹果。", scanner, entityLinkOptions)
      .conflicts[0];
    const second = extractNoteMentions(
      "喜欢[苹果](wiki/苹果.md)。",
      scanner,
      entityLinkOptions,
    ).conflicts[0];

    expect(first?.hash).toBe(second?.hash);
  });
});

class FakeScanner implements SurfaceScanner {
  constructor(private readonly matches: SurfaceMatch[]) {}

  scan(): Iterable<SurfaceMatch> {
    return this.matches;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveEntityTarget(target: string): string | undefined {
  const entityByPath = new Map([
    ["wiki/艾萨克·牛顿.md", "Q935"],
    ["wiki/艾萨克·牛顿", "Q935"],
    ["wiki/苹果.md", "Q89"],
    ["wiki/苹果", "Q89"],
    ["wiki/北京", "Q956"],
    ["wiki/大学", "Q3918"],
  ]);
  return entityByPath.get(normalizePath(target));
}

function surfaceMatch(input: {
  start: number;
  end: number;
  surface: string;
  surfaceId: number;
  qids: string[];
}): SurfaceMatch {
  return {
    ...input,
    utf16Length: input.end - input.start,
    qidNumbers: input.qids.map((qid) => Number.parseInt(qid.slice(1), 10)),
  };
}
