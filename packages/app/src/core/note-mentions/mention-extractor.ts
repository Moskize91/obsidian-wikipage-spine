import type {
  NormalizedViewChar,
  NormalizedViewToken,
  PositionedSurfaceMatch,
  SurfaceScanner,
  TextSegment,
} from "./types";

export function collectTextSegments(
  tokens: readonly NormalizedViewToken[],
): TextSegment[] {
  const segments: TextSegment[] = [];
  let chars: NormalizedViewChar[] = [];

  for (const token of tokens) {
    if (token.kind === "char") {
      chars.push(token);
      continue;
    }
    // Obsidian 引用最终不能嵌套或跨越特殊语法结构，非实体结构必须截断 surface 匹配。
    if (chars.length > 0) {
      segments.push(toTextSegment(chars));
      chars = [];
    }
  }

  if (chars.length > 0) {
    segments.push(toTextSegment(chars));
  }

  return segments;
}

export function scanTextSegments(
  segments: readonly TextSegment[],
  scanner: SurfaceScanner,
): PositionedSurfaceMatch[] {
  return segments.flatMap((segment) => scanSegment(segment, scanner));
}

function toTextSegment(chars: NormalizedViewChar[]): TextSegment {
  return { chars, text: chars.map((char) => char.char).join("") };
}

function scanSegment(
  segment: TextSegment,
  scanner: SurfaceScanner,
): PositionedSurfaceMatch[] {
  const matches: PositionedSurfaceMatch[] = [];

  for (const match of scanner.scan([segment.text])) {
    if (match.qids.length === 0) {
      continue;
    }
    const startIndex = findCharIndexAtOffset(segment.chars, match.start);
    const endIndex = findCharIndexAtOffset(segment.chars, match.end);
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      endIndex <= startIndex
    ) {
      continue;
    }

    const startChar = segment.chars[startIndex];
    const endChar = segment.chars[endIndex - 1];
    if (startChar === undefined || endChar === undefined) {
      continue;
    }

    matches.push({
      match,
      text: segment.text.slice(match.start, match.end),
      segment,
      segmentStart: startIndex,
      segmentEnd: endIndex,
      sourceStart: startChar.sourceStart,
      sourceEnd: endChar.sourceEnd,
    });
  }

  return matches.sort(
    (left, right) =>
      left.segmentStart - right.segmentStart ||
      left.segmentEnd - right.segmentEnd,
  );
}

function findCharIndexAtOffset(
  chars: readonly NormalizedViewChar[],
  offset: number,
): number | undefined {
  let current = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (current === offset) {
      return index;
    }
    current += chars[index]?.char.length ?? 0;
    if (current > offset) {
      return undefined;
    }
  }
  return current === offset ? chars.length : undefined;
}
