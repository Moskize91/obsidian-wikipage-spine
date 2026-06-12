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

  it("keeps footnote references out of entity extraction", () => {
    const scanner = new LiteralScanner(["^1", "1"]);

    const result = extractNoteMentions("见证[^1]", scanner, entityLinkOptions);

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("protects markdown tables as matcher barriers", () => {
    const scanner = new LiteralScanner(["年代", "---", "迦太基会议"]);

    const result = extractNoteMentions(
      "|年代|节点|\n|---|---|\n|418|迦太基会议|\n",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps Obsidian tags out of entity extraction", () => {
    const scanner = new LiteralScanner(["想法"]);

    const result = extractNoteMentions("#想法", scanner, entityLinkOptions);

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps markdown emphasis markers out of entity extraction", () => {
    const scanner = new LiteralScanner(["**"]);

    const result = extractNoteMentions(
      "**不完全对应**",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("protects blockquotes as matcher barriers", () => {
    const scanner = new LiteralScanner(["Augustine"]);

    const result = extractNoteMentions(
      "> Augustine\n\nAugustine",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.sourceStart).toBe(13);
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

  it("ignores scanner matches whose candidate EID list became empty", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 2,
        surface: "牛顿",
        surfaceId: 10,
        qids: [],
      }),
    ]);

    const result = extractNoteMentions("牛顿", scanner, entityLinkOptions);

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("marks isolated single Han character matches as regular unresolved mentions", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 0,
        end: 1,
        surface: "定",
        surfaceId: 11,
        qids: ["Q2217023"],
      }),
    ]);

    const result = extractNoteMentions("定", scanner, entityLinkOptions);

    expect(result.resolved).toMatchObject([
      {
        text: "定",
        eid: "Q2217023",
        wordBoundarySuspect: false,
        resolved: false,
      },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("marks Latin slices inside a larger word as word-boundary suspects", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 13,
        end: 16,
        surface: "Spa",
        surfaceId: 12,
        qids: ["Q1341387"],
      }),
    ]);

    const result = extractNoteMentions(
      "Paul Vincent Spade",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toMatchObject([
      {
        text: "Spa",
        eid: "Q1341387",
        wordBoundarySuspect: true,
        resolved: false,
      },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("marks Han slices across word boundaries as word-boundary suspects", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 1,
        end: 3,
        surface: "中有",
        surfaceId: 13,
        qids: ["Q256585"],
      }),
    ]);

    const result = extractNoteMentions("其中有一句", scanner, entityLinkOptions);

    expect(result.resolved).toMatchObject([
      {
        text: "中有",
        eid: "Q256585",
        wordBoundarySuspect: true,
        resolved: false,
      },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps auto-resolving multi-word technical phrases when edges align", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 6,
        end: 10,
        surface: "经院哲学",
        surfaceId: 14,
        qids: ["Q41679"],
      }),
    ]);

    const result = extractNoteMentions(
      "中世纪神学与经院哲学常常被描述",
      scanner,
      entityLinkOptions,
    );

    expect(result.resolved).toMatchObject([
      {
        kind: "resolved",
        text: "经院哲学",
        eid: "Q41679",
        surfaceId: 14,
        wordBoundarySuspect: false,
        resolved: false,
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
      matches: [
        { text: "苹果", eids: ["Q89", "Q312"], wordBoundarySuspect: false },
      ],
    });
  });

  it("filters word-boundary suspects out of unresolved conflicts", () => {
    const scanner = new FakeScanner([
      surfaceMatch({
        start: 1,
        end: 3,
        surface: "中有",
        surfaceId: 21,
        qids: ["Q256585", "Q999"],
      }),
    ]);

    const result = extractNoteMentions("其中有一句", scanner, entityLinkOptions);

    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
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

class LiteralScanner implements SurfaceScanner {
  constructor(private readonly surfaces: string[]) {}

  scan(texts: Iterable<string>): Iterable<SurfaceMatch> {
    const matches: SurfaceMatch[] = [];
    for (const text of texts) {
      for (const [index, surface] of this.surfaces.entries()) {
        const start = text.indexOf(surface);
        if (start < 0) {
          continue;
        }
        matches.push(
          surfaceMatch({
            start,
            end: start + surface.length,
            surface,
            surfaceId: index + 1,
            qids: [`Q${index + 1}`],
          }),
        );
      }
    }
    return matches;
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
