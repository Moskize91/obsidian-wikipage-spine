import type {
  NormalizedViewToken,
  NoteMentionOptions,
  SpecialSyntax,
} from "./types";

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
