import { createHash } from "node:crypto";
import type { ConflictSurfaceMatch, TextSegment } from "./types";

const CONFLICT_HASH_VERSION = "mention-conflict-v1";
const CONFLICT_CONTEXT_WEIGHT = 30;

export function createConflictHash(input: {
  text: string;
  leftContext: string;
  rightContext: string;
  matches: readonly ConflictSurfaceMatch[];
}): string {
  const body = {
    version: CONFLICT_HASH_VERSION,
    leftContext: input.leftContext,
    text: input.text,
    rightContext: input.rightContext,
    matches: input.matches.map((match) => ({
      text: match.text,
      surfaceId: match.surfaceId,
      eids: match.eids,
    })),
  };

  // 歧义消解可能很昂贵，hash 必须包含候选集合，避免上下文相同但候选已变时误继承旧决策。
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function collectContext(
  segment: TextSegment,
  index: number,
  direction: "left" | "right",
): string {
  const parts: string[] = [];
  let weight = 0;
  let cursor = direction === "left" ? index - 1 : index;
  let pendingWhitespace = false;

  // conflict 的人工或 LLM 消歧成本高，hash 用局部语境让同步尽量继承旧决策。
  while (
    cursor >= 0 &&
    cursor < segment.chars.length &&
    weight < CONFLICT_CONTEXT_WEIGHT
  ) {
    const char = segment.chars[cursor]?.char;
    if (char === undefined) {
      break;
    }

    if (isInvisible(char)) {
      pendingWhitespace = true;
      cursor += direction === "left" ? -1 : 1;
      continue;
    }

    if (pendingWhitespace && weight < CONFLICT_CONTEXT_WEIGHT) {
      appendContextPart(parts, " ", direction);
      weight += 1;
      pendingWhitespace = false;
    }

    appendContextPart(parts, char, direction);
    weight += contextWeight(char);
    cursor += direction === "left" ? -1 : 1;
  }

  if (pendingWhitespace && weight < CONFLICT_CONTEXT_WEIGHT) {
    appendContextPart(parts, " ", direction);
  }

  return parts.join("");
}

function appendContextPart(
  parts: string[],
  value: string,
  direction: "left" | "right",
): void {
  if (direction === "left") {
    parts.unshift(value);
  } else {
    parts.push(value);
  }
}

function contextWeight(char: string): number {
  return isHan(char) ? 3 : 1;
}

function isHan(char: string): boolean {
  return /\p{Script=Han}/u.test(char);
}

function isInvisible(char: string): boolean {
  return /\s/u.test(char);
}
