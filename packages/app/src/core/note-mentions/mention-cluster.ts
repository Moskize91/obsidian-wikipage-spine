import { collectContext, createConflictHash } from "./conflict-hash";
import type {
  MatchCluster,
  MentionConflict,
  PositionedSurfaceMatch,
  ResolvedMention,
  TextSegment,
} from "./types";

interface WordSegment {
  segment: string;
  index: number;
}

interface WordSegmenter {
  segment(text: string): Iterable<WordSegment>;
}

export function buildMentions(matches: readonly PositionedSurfaceMatch[]): {
  resolved: ResolvedMention[];
  conflicts: MentionConflict[];
} {
  const clusters = clusterSurfaceMatches(matches);
  const resolved: ResolvedMention[] = [];
  const conflicts: MentionConflict[] = [];

  for (const cluster of clusters) {
    if (
      cluster.matches.length === 1 &&
      cluster.matches[0]?.match.qids.length === 1
    ) {
      const only = cluster.matches[0];
      const eid = only.match.qids[0];
      if (eid === undefined) {
        continue;
      }
      const resolvedEid = resolveExpandedEntityMatch(only);
      resolved.push({
        kind: "resolved",
        text: only.text,
        eid,
        surfaceId: only.match.surfaceId,
        surface: only.match.surface,
        sourceStart: only.sourceStart,
        sourceEnd: only.sourceEnd,
        wordBoundarySuspect: isWordBoundarySuspect(only),
        resolved: resolvedEid === eid,
      });
      continue;
    }

    const conflict = createMentionConflict(cluster);
    if (conflict !== undefined) {
      conflicts.push(conflict);
    }
  }

  return { resolved, conflicts };
}

function isWordBoundarySuspect(match: PositionedSurfaceMatch): boolean {
  if (!needsSegmenterBoundaryCheck(match.text)) {
    return false;
  }

  const boundaries = wordBoundaries(match.segment.text);
  // 词边界只提供弱判定：子串切片非常可疑，但外部消歧可以显式覆盖这个判断。
  return !boundaries.has(match.match.start) || !boundaries.has(match.match.end);
}

function needsSegmenterBoundaryCheck(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Latin}]/u.test(text);
}

const segmenter =
  typeof (Intl as typeof Intl & { Segmenter?: unknown }).Segmenter ===
  "function"
    ? new (
        Intl as typeof Intl & {
          Segmenter: new (
            locales: readonly string[],
            options: { granularity: "word" },
          ) => WordSegmenter;
        }
      ).Segmenter(["zh", "en"], { granularity: "word" })
    : undefined;

function wordBoundaries(text: string): Set<number> {
  const boundaries = new Set([0, text.length]);
  if (segmenter === undefined) {
    return boundaries;
  }
  for (const segment of segmenter.segment(text)) {
    boundaries.add(segment.index);
    boundaries.add(segment.index + segment.segment.length);
  }
  return boundaries;
}

function clusterSurfaceMatches(
  matches: readonly PositionedSurfaceMatch[],
): MatchCluster[] {
  const clusters: MatchCluster[] = [];

  for (const match of matches) {
    const current = clusters[clusters.length - 1];
    if (
      current === undefined ||
      current.segment !== match.segment ||
      match.segmentStart >= current.segmentEnd
    ) {
      clusters.push({
        segment: match.segment,
        segmentStart: match.segmentStart,
        segmentEnd: match.segmentEnd,
        sourceStart: match.sourceStart,
        sourceEnd: match.sourceEnd,
        matches: [match],
      });
      continue;
    }

    // 重叠或嵌套的 surface 只能共同进入一次消歧，不能提前把局部唯一候选拍板。
    current.matches.push(match);
    current.segmentStart = Math.min(current.segmentStart, match.segmentStart);
    current.segmentEnd = Math.max(current.segmentEnd, match.segmentEnd);
    current.sourceStart = Math.min(current.sourceStart, match.sourceStart);
    current.sourceEnd = Math.max(current.sourceEnd, match.sourceEnd);
  }

  return clusters;
}

function createMentionConflict(
  cluster: MatchCluster,
): MentionConflict | undefined {
  const text = sliceSegmentChars(
    cluster.segment,
    cluster.segmentStart,
    cluster.segmentEnd,
  );
  const leftContext = collectContext(
    cluster.segment,
    cluster.segmentStart,
    "left",
  );
  const rightContext = collectContext(
    cluster.segment,
    cluster.segmentEnd,
    "right",
  );
  const matches = cluster.matches.flatMap((match) => {
    const wordBoundarySuspect = isWordBoundarySuspect(match);
    const conflictMatch = {
      text: match.text,
      surfaceId: match.match.surfaceId,
      surface: match.match.surface,
      sourceStart: match.sourceStart,
      sourceEnd: match.sourceEnd,
      eids: match.match.qids,
      wordBoundarySuspect,
    };
    const resolvedEid = resolveExpandedEntityMatch(match);
    if (resolvedEid !== undefined) {
      return [{ ...conflictMatch, resolvedEid }];
    }
    // 词边界判定是弱过滤：默认不让可疑切片参与冲突，但显式 resolved 可以覆盖。
    return wordBoundarySuspect ? [] : [conflictMatch];
  });
  if (matches.length === 0) {
    return undefined;
  }
  const hash = createConflictHash({
    text,
    leftContext,
    rightContext,
    matches,
  });

  return {
    kind: "conflict",
    text,
    hash,
    sourceStart: cluster.sourceStart,
    sourceEnd: cluster.sourceEnd,
    leftContext,
    rightContext,
    matches,
  };
}

function resolveExpandedEntityMatch(
  match: PositionedSurfaceMatch,
): string | undefined {
  const chars = match.segment.chars.slice(match.segmentStart, match.segmentEnd);
  const first = chars[0];
  if (first?.expandedEntityEid === undefined) {
    return undefined;
  }
  const sameExpandedLink = chars.every(
    (char) =>
      char.expandedEntityEid === first.expandedEntityEid &&
      char.sourceStart === first.sourceStart &&
      char.sourceEnd === first.sourceEnd,
  );
  if (!sameExpandedLink) {
    return undefined;
  }
  if (!match.match.qids.includes(first.expandedEntityEid)) {
    return undefined;
  }
  return first.expandedEntityEid;
}

function sliceSegmentChars(
  segment: TextSegment,
  start: number,
  end: number,
): string {
  return segment.chars
    .slice(start, end)
    .map((char) => char.char)
    .join("");
}
