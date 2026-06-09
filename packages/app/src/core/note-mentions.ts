import { createHash } from "node:crypto";
import type { SurfaceMatch } from "./surface-matcher";

const CONFLICT_HASH_VERSION = "mention-conflict-v1";
const CONFLICT_CONTEXT_WEIGHT = 30;

export interface SurfaceScanner {
  scan(chunks: Iterable<string>): Iterable<SurfaceMatch>;
}

export interface NoteMentionOptions {
  isEntityViewLinkTarget(target: string): boolean;
}

export type NormalizedViewToken = NormalizedViewChar | NormalizedViewSpecial;

export interface NormalizedViewChar {
  kind: "char";
  char: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface NormalizedViewSpecial {
  kind: "special";
  syntax: SpecialSyntax;
  raw: string;
  sourceStart: number;
  sourceEnd: number;
}

export type SpecialSyntax =
  | "frontmatter"
  | "fenced_code"
  | "inline_code"
  | "html"
  | "html_comment"
  | "wikilink"
  | "markdown_link"
  | "markdown_image";

export interface ResolvedMention {
  kind: "resolved";
  text: string;
  eid: string;
  surfaceId: number;
  surface: string | undefined;
  sourceStart: number;
  sourceEnd: number;
}

export interface MentionConflict {
  kind: "conflict";
  text: string;
  hash: string;
  sourceStart: number;
  sourceEnd: number;
  leftContext: string;
  rightContext: string;
  matches: ConflictSurfaceMatch[];
}

export interface ConflictSurfaceMatch {
  text: string;
  surfaceId: number;
  surface: string | undefined;
  sourceStart: number;
  sourceEnd: number;
  eids: string[];
}

interface TextSegment {
  chars: NormalizedViewChar[];
  text: string;
}

interface PositionedSurfaceMatch {
  match: SurfaceMatch;
  text: string;
  segment: TextSegment;
  segmentStart: number;
  segmentEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

interface MatchCluster {
  segment: TextSegment;
  segmentStart: number;
  segmentEnd: number;
  sourceStart: number;
  sourceEnd: number;
  matches: PositionedSurfaceMatch[];
}

export function extractNoteMentions(
  markdown: string,
  scanner: SurfaceScanner,
  options: NoteMentionOptions,
): { resolved: ResolvedMention[]; conflicts: MentionConflict[] } {
  const tokens = normalizeObsidianView(markdown, options);
  const segments = collectTextSegments(tokens);
  const positionedMatches = segments.flatMap((segment) =>
    scanSegment(segment, scanner),
  );
  const clusters = clusterSurfaceMatches(positionedMatches);
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

export function normalizeObsidianView(
  markdown: string,
  options: NoteMentionOptions,
): NormalizedViewToken[] {
  const tokens: NormalizedViewToken[] = [];
  let index = 0;

  if (markdown.startsWith("---\n")) {
    const end = markdown.indexOf("\n---", 4);
    if (end >= 0) {
      const closeEnd = markdown.startsWith("\n", end + 4) ? end + 5 : end + 4;
      pushSpecial(tokens, "frontmatter", markdown, 0, closeEnd);
      index = closeEnd;
    }
  }

  while (index < markdown.length) {
    const fencedCode = readFencedCode(markdown, index);
    if (fencedCode !== undefined) {
      pushSpecial(tokens, "fenced_code", markdown, index, fencedCode);
      index = fencedCode;
      continue;
    }

    const htmlComment = readDelimited(markdown, index, "<!--", "-->");
    if (htmlComment !== undefined) {
      pushSpecial(tokens, "html_comment", markdown, index, htmlComment);
      index = htmlComment;
      continue;
    }

    const htmlBlock = readHtmlBlock(markdown, index);
    if (htmlBlock !== undefined) {
      pushSpecial(tokens, "html", markdown, index, htmlBlock);
      index = htmlBlock;
      continue;
    }

    const wikilink = readWikilink(markdown, index);
    if (wikilink !== undefined) {
      // 旧的实体链接只能贡献用户看见的文字，不能继承上一次 surface 到 EID 的绑定。
      if (!wikilink.embed && options.isEntityViewLinkTarget(wikilink.target)) {
        pushText(tokens, wikilink.display, wikilink.start, wikilink.end);
      } else {
        pushSpecial(tokens, "wikilink", markdown, wikilink.start, wikilink.end);
      }
      index = wikilink.end;
      continue;
    }

    const markdownLink = readMarkdownLink(markdown, index);
    if (markdownLink !== undefined) {
      // Obsidian 的内部链接不只有 wikilink；托管实体目录里的 Markdown link 也需要被重新判定。
      if (
        !markdownLink.image &&
        options.isEntityViewLinkTarget(markdownLink.target)
      ) {
        pushText(
          tokens,
          markdownLink.label,
          markdownLink.start,
          markdownLink.end,
        );
      } else {
        pushSpecial(
          tokens,
          markdownLink.image ? "markdown_image" : "markdown_link",
          markdown,
          markdownLink.start,
          markdownLink.end,
        );
      }
      index = markdownLink.end;
      continue;
    }

    const inlineCode = readInlineCode(markdown, index);
    if (inlineCode !== undefined) {
      pushSpecial(tokens, "inline_code", markdown, index, inlineCode);
      index = inlineCode;
      continue;
    }

    const char = readCodePoint(markdown, index);
    tokens.push({
      kind: "char",
      char,
      sourceStart: index,
      sourceEnd: index + char.length,
    });
    index += char.length;
  }

  return tokens;
}

function collectTextSegments(
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

function toTextSegment(chars: NormalizedViewChar[]): TextSegment {
  return { chars, text: chars.map((char) => char.char).join("") };
}

function scanSegment(
  segment: TextSegment,
  scanner: SurfaceScanner,
): PositionedSurfaceMatch[] {
  const matches: PositionedSurfaceMatch[] = [];

  for (const match of scanner.scan([segment.text])) {
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
  const matches = cluster.matches.map((match) => ({
    text: match.text,
    surfaceId: match.match.surfaceId,
    surface: match.match.surface,
    sourceStart: match.sourceStart,
    sourceEnd: match.sourceEnd,
    eids: match.match.qids,
  }));
  const hash = hashMentionConflict({
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

function hashMentionConflict(input: {
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

function collectContext(
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

function pushSpecial(
  tokens: NormalizedViewToken[],
  syntax: SpecialSyntax,
  markdown: string,
  start: number,
  end: number,
): void {
  tokens.push({
    kind: "special",
    syntax,
    raw: markdown.slice(start, end),
    sourceStart: start,
    sourceEnd: end,
  });
}

function pushText(
  tokens: NormalizedViewToken[],
  text: string,
  sourceStart: number,
  sourceEnd: number,
): void {
  for (const char of iterateCodePoints(text)) {
    tokens.push({ kind: "char", char, sourceStart, sourceEnd });
  }
}

function readCodePoint(text: string, index: number): string {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) {
    return "";
  }
  return String.fromCodePoint(codePoint);
}

function* iterateCodePoints(text: string): Generator<string> {
  for (const char of text) {
    yield char;
  }
}

function readDelimited(
  text: string,
  index: number,
  open: string,
  close: string,
): number | undefined {
  if (!text.startsWith(open, index)) {
    return undefined;
  }
  const closeIndex = text.indexOf(close, index + open.length);
  return closeIndex >= 0 ? closeIndex + close.length : text.length;
}

function readFencedCode(text: string, index: number): number | undefined {
  if (index > 0 && text[index - 1] !== "\n") {
    return undefined;
  }
  const marker = text.startsWith("```", index)
    ? "```"
    : text.startsWith("~~~", index)
      ? "~~~"
      : undefined;
  if (marker === undefined) {
    return undefined;
  }
  const nextLine = text.indexOf("\n", index + marker.length);
  if (nextLine < 0) {
    return text.length;
  }
  const closeNeedle = `\n${marker}`;
  const close = text.indexOf(closeNeedle, nextLine + 1);
  if (close < 0) {
    return text.length;
  }
  const closeLineEnd = text.indexOf("\n", close + closeNeedle.length);
  return closeLineEnd < 0 ? text.length : closeLineEnd + 1;
}

function readInlineCode(text: string, index: number): number | undefined {
  if (text[index] !== "`") {
    return undefined;
  }
  let tickCount = 0;
  while (text[index + tickCount] === "`") {
    tickCount += 1;
  }
  const marker = "`".repeat(tickCount);
  const close = text.indexOf(marker, index + tickCount);
  return close >= 0 ? close + tickCount : undefined;
}

function readHtmlBlock(text: string, index: number): number | undefined {
  if (text[index] !== "<" || text.startsWith("<!--", index)) {
    return undefined;
  }
  const open = /^<([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/.exec(text.slice(index));
  if (open === null) {
    return undefined;
  }
  const tag = open[1]?.toLowerCase();
  if (tag === undefined) {
    return undefined;
  }
  const openEnd = index + open[0].length;
  const closeNeedle = `</${tag}>`;
  const close = text.toLowerCase().indexOf(closeNeedle, openEnd);
  if (close < 0) {
    return openEnd;
  }
  return close + closeNeedle.length;
}

function readWikilink(
  text: string,
  index: number,
):
  | {
      start: number;
      end: number;
      embed: boolean;
      target: string;
      display: string;
    }
  | undefined {
  const embed = text[index] === "!" && text.startsWith("[[", index + 1);
  const start = embed ? index + 1 : index;
  if (!text.startsWith("[[", start)) {
    return undefined;
  }
  const close = text.indexOf("]]", start + 2);
  if (close < 0) {
    return undefined;
  }
  const body = text.slice(start + 2, close);
  const [targetPart, alias] = splitOnce(body, "|");
  const target = targetPart.trim();
  const display = alias ?? displayFromLinkTarget(target);
  return { start: index, end: close + 2, embed, target, display };
}

function readMarkdownLink(
  text: string,
  index: number,
):
  | {
      start: number;
      end: number;
      image: boolean;
      label: string;
      target: string;
    }
  | undefined {
  const image = text[index] === "!" && text[index + 1] === "[";
  const labelStart = image ? index + 1 : index;
  if (text[labelStart] !== "[") {
    return undefined;
  }
  const labelEnd = findClosingBracket(text, labelStart, "[", "]");
  if (labelEnd === undefined || text[labelEnd + 1] !== "(") {
    return undefined;
  }
  const targetEnd = findClosingBracket(text, labelEnd + 1, "(", ")");
  if (targetEnd === undefined) {
    return undefined;
  }
  const rawTarget = text.slice(labelEnd + 2, targetEnd).trim();
  const [target] = splitOnce(rawTarget, " ");
  return {
    start: index,
    end: targetEnd + 1,
    image,
    label: text.slice(labelStart + 1, labelEnd),
    target: decodeLinkTarget(target),
  };
}

function findClosingBracket(
  text: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function splitOnce(
  text: string,
  separator: string,
): [string, string | undefined] {
  const index = text.indexOf(separator);
  if (index < 0) {
    return [text, undefined];
  }
  return [text.slice(0, index), text.slice(index + separator.length)];
}

function displayFromLinkTarget(target: string): string {
  const withoutFragment = target.split("#")[0] ?? target;
  const segments = withoutFragment.split("/").filter(Boolean);
  const lastSegment =
    segments.length > 0
      ? (segments[segments.length - 1] ?? withoutFragment)
      : withoutFragment;
  return lastSegment.replace(/\.md$/i, "");
}

function decodeLinkTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
