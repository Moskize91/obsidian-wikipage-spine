export interface ViewTokenOptions {
  isEntityViewLinkTarget(target: string): boolean;
  resolveEntityViewLinkTarget?: (target: string) => string | undefined;
}

export type NormalizedViewToken = NormalizedViewChar | NormalizedViewSpecial;

export interface NormalizedViewChar {
  kind: "char";
  char: string;
  sourceStart: number;
  sourceEnd: number;
  expandedEntityEid?: string;
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
  | "thematic_break"
  | "fenced_code"
  | "inline_code"
  | "html"
  | "html_comment"
  | "wikilink"
  | "markdown_link"
  | "markdown_image"
  | "footnote_ref"
  | "footnote_def"
  | "markdown_table"
  | "blockquote"
  | "markdown_emphasis"
  | "obsidian_tag";

export function normalizeObsidianView(
  markdown: string,
  options: ViewTokenOptions,
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
    const blockquote = readBlockquote(markdown, index);
    if (blockquote !== undefined) {
      pushSpecial(tokens, "blockquote", markdown, index, blockquote);
      index = blockquote;
      continue;
    }

    const markdownTable = readMarkdownTable(markdown, index);
    if (markdownTable !== undefined) {
      pushSpecial(tokens, "markdown_table", markdown, index, markdownTable);
      index = markdownTable;
      continue;
    }

    const thematicBreak = readThematicBreak(markdown, index);
    if (thematicBreak !== undefined) {
      pushSpecial(tokens, "thematic_break", markdown, index, thematicBreak);
      index = thematicBreak;
      continue;
    }

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
      const expandedEntityEid = resolveExpandedEntityEid(
        wikilink.target,
        options,
      );
      if (
        !wikilink.embed &&
        (expandedEntityEid !== undefined ||
          options.isEntityViewLinkTarget(wikilink.target))
      ) {
        pushText(
          tokens,
          wikilink.display,
          wikilink.start,
          wikilink.end,
          expandedEntityEid,
        );
      } else {
        pushSpecial(tokens, "wikilink", markdown, wikilink.start, wikilink.end);
      }
      index = wikilink.end;
      continue;
    }

    const markdownLink = readMarkdownLink(markdown, index);
    if (markdownLink !== undefined) {
      // Obsidian 的内部链接不只有 wikilink；托管实体目录里的 Markdown link 也需要被重新判定。
      const expandedEntityEid = resolveExpandedEntityEid(
        markdownLink.target,
        options,
      );
      if (
        !markdownLink.image &&
        (expandedEntityEid !== undefined ||
          options.isEntityViewLinkTarget(markdownLink.target))
      ) {
        pushText(
          tokens,
          markdownLink.label,
          markdownLink.start,
          markdownLink.end,
          expandedEntityEid,
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

    const footnoteDefinition = readFootnoteDefinition(markdown, index);
    if (footnoteDefinition !== undefined) {
      pushSpecial(tokens, "footnote_def", markdown, index, footnoteDefinition);
      index = footnoteDefinition;
      continue;
    }

    const footnoteReference = readFootnoteReference(markdown, index);
    if (footnoteReference !== undefined) {
      pushSpecial(tokens, "footnote_ref", markdown, index, footnoteReference);
      index = footnoteReference;
      continue;
    }

    const inlineCode = readInlineCode(markdown, index);
    if (inlineCode !== undefined) {
      pushSpecial(tokens, "inline_code", markdown, index, inlineCode);
      index = inlineCode;
      continue;
    }

    const emphasisMarker = readMarkdownEmphasisMarker(markdown, index);
    if (emphasisMarker !== undefined) {
      pushSpecial(
        tokens,
        "markdown_emphasis",
        markdown,
        index,
        emphasisMarker,
      );
      index = emphasisMarker;
      continue;
    }

    const obsidianTag = readObsidianTag(markdown, index);
    if (obsidianTag !== undefined) {
      pushSpecial(tokens, "obsidian_tag", markdown, index, obsidianTag);
      index = obsidianTag;
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
  expandedEntityEid?: string,
): void {
  for (const char of iterateCodePoints(text)) {
    const token = { kind: "char" as const, char, sourceStart, sourceEnd };
    tokens.push(
      expandedEntityEid === undefined ? token : { ...token, expandedEntityEid },
    );
  }
}

function resolveExpandedEntityEid(
  target: string,
  options: ViewTokenOptions,
): string | undefined {
  return options.resolveEntityViewLinkTarget?.(target);
}

function readThematicBreak(text: string, index: number): number | undefined {
  if (index > 0 && text[index - 1] !== "\n") {
    return undefined;
  }
  const lineEnd = text.indexOf("\n", index);
  const end = lineEnd < 0 ? text.length : lineEnd + 1;
  const line = text.slice(index, lineEnd < 0 ? text.length : lineEnd);
  if (!isThematicBreakLine(line)) {
    return undefined;
  }

  const previousLineStart = text.lastIndexOf("\n", Math.max(0, index - 2)) + 1;
  const previousLine =
    index === 0 ? "" : text.slice(previousLineStart, index - 1);
  if (previousLine.trim().length > 0) {
    return undefined;
  }

  return end;
}

function isThematicBreakLine(line: string): boolean {
  // section 分割依赖 CommonMark thematic break；保留规范链接是为了避免把 frontmatter 或 setext heading 混进来。
  // https://spec.commonmark.org/0.31.2/#thematic-breaks
  const match = /^ {0,3}([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.exec(line);
  return match !== null;
}

function readBlockquote(text: string, index: number): number | undefined {
  if (!isLineStart(text, index) || !/^ {0,3}>/.test(text.slice(index))) {
    return undefined;
  }
  let end = index;
  let cursor = index;
  while (cursor < text.length) {
    const line = readLine(text, cursor);
    if (line === undefined || !/^ {0,3}>/.test(line.content)) {
      break;
    }
    end = line.end;
    cursor = line.end;
  }
  // 引文往往是外部文本证据；自动改写会让引用内容不再忠于原文。
  // https://spec.commonmark.org/0.31.2/#block-quotes
  return end;
}

function readMarkdownTable(text: string, index: number): number | undefined {
  if (!isLineStart(text, index)) {
    return undefined;
  }
  const header = readLine(text, index);
  if (header === undefined) {
    return undefined;
  }
  if (!isTableContentLine(header.content)) {
    return undefined;
  }
  const delimiter = readLine(text, header.end);
  if (delimiter === undefined || !isTableDelimiterLine(delimiter.content)) {
    return undefined;
  }

  let end = delimiter.end;
  let cursor = delimiter.end;
  while (cursor < text.length) {
    const row = readLine(text, cursor);
    if (row === undefined || !isTableContentLine(row.content)) {
      break;
    }
    end = row.end;
    cursor = row.end;
  }

  // GFM 表格是一整块块级结构；自动插入 wikilink 会改变表格渲染边界，先整体隔离。
  // https://github.github.com/gfm/#tables-extension-
  return end;
}

function readFootnoteDefinition(
  text: string,
  index: number,
): number | undefined {
  if (!isLineStart(text, index)) {
    return undefined;
  }
  const match = /^ {0,3}\[\^[^\]\r\n]+\]:[ \t]*/.exec(text.slice(index));
  // footnote label 是被引用的结构 ID，不是正文 surface；正文部分仍可按普通文本处理。
  // https://github.github.com/gfm/#footnotes-extension-
  return match === null ? undefined : index + match[0].length;
}

function readFootnoteReference(
  text: string,
  index: number,
): number | undefined {
  const match = /^\[\^[^\]\r\n]+\]/.exec(text.slice(index));
  // footnote reference 的 label 不能被实体替换，否则会生成非法 Markdown 引用。
  // https://github.github.com/gfm/#footnotes-extension-
  return match === null ? undefined : index + match[0].length;
}

function readMarkdownEmphasisMarker(
  text: string,
  index: number,
): number | undefined {
  const char = text[index];
  if (char !== "*" && char !== "_") {
    return undefined;
  }
  let end = index;
  while (text[end] === char && end - index < 3) {
    end += 1;
  }
  // emphasis delimiter 是排版结构，不是正文 surface；保留它能避免把粗体/斜体标记改写成链接。
  // https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis
  return end;
}

function readObsidianTag(text: string, index: number): number | undefined {
  if (text[index] !== "#" || !isTagBoundaryBefore(text, index)) {
    return undefined;
  }
  let end = index + 1;
  while (end < text.length && isObsidianTagChar(text[end] ?? "")) {
    end += 1;
  }
  if (end === index + 1) {
    return undefined;
  }
  const body = text.slice(index + 1, end);
  if (!/[^\d/]/u.test(body)) {
    return undefined;
  }
  // Obsidian tag 是检索元数据；把 tag 内部改写成链接会破坏用户已有的分类维度。
  // https://help.obsidian.md/tags
  return end;
}

function readCodePoint(text: string, index: number): string {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) {
    return "";
  }
  return String.fromCodePoint(codePoint);
}

function isLineStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === "\n";
}

function readLine(
  text: string,
  index: number,
): { content: string; end: number } | undefined {
  if (index >= text.length) {
    return undefined;
  }
  const lineEnd = text.indexOf("\n", index);
  if (lineEnd < 0) {
    return { content: text.slice(index), end: text.length };
  }
  return { content: text.slice(index, lineEnd), end: lineEnd + 1 };
}

function isTableContentLine(line: string): boolean {
  return line.trim().length > 0 && hasUnescapedPipe(line);
}

function hasUnescapedPipe(line: string): boolean {
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      return true;
    }
  }
  return false;
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!hasUnescapedPipe(trimmed)) {
    return false;
  }
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTagBoundaryBefore(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text[index - 1] ?? "";
  return /[\s([{:;,，。；：！？]/u.test(previous);
}

function isObsidianTagChar(char: string): boolean {
  return char.length > 0 && !/[\s#\[\]{}()<>.,;:!?，。；：！？]/u.test(char);
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
