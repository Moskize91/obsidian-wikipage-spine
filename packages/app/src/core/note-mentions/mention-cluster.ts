import { collectContext, createConflictHash } from "./conflict-hash";
import type {
  MatchCluster,
  MentionConflict,
  PositionedSurfaceMatch,
  ResolvedMention,
  TextSegment,
} from "./types";

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
      resolved.push({
        kind: "resolved",
        text: only.text,
        eid,
        surfaceId: only.match.surfaceId,
        surface: only.match.surface,
        sourceStart: only.sourceStart,
        sourceEnd: only.sourceEnd,
      });
      continue;
    }

    conflicts.push(createMentionConflict(cluster));
  }

  return { resolved, conflicts };
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

function createMentionConflict(cluster: MatchCluster): MentionConflict {
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
  const matches = cluster.matches.map((match) => {
    const conflictMatch = {
      text: match.text,
      surfaceId: match.match.surfaceId,
      surface: match.match.surface,
      sourceStart: match.sourceStart,
      sourceEnd: match.sourceEnd,
      eids: match.match.qids,
    };
    const resolvedEid = resolveExpandedEntityMatch(match);
    return resolvedEid === undefined
      ? conflictMatch
      : { ...conflictMatch, resolvedEid };
  });
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
