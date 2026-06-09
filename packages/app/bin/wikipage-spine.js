#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/project-info.ts
var PLUGIN_ID, PACKAGE_NAME;
var init_project_info = __esm({
  "src/core/project-info.ts"() {
    "use strict";
    PLUGIN_ID = "wikipage-spine";
    PACKAGE_NAME = "wikipage-spine";
  }
});

// src/plugin/settings.ts
function getDefaultPluginSettings() {
  return {
    runtimeDir: "",
    databasePath: DEFAULT_DATABASE_PATH,
    entityDir: DEFAULT_ENTITY_DIR,
    preferredLang: "zh",
    noteGlobs: [...DEFAULT_NOTE_GLOBS]
  };
}
function normalizePluginSettings(raw) {
  const defaults = getDefaultPluginSettings();
  return {
    runtimeDir: typeof raw?.runtimeDir === "string" ? normalizePathSetting(raw.runtimeDir) : defaults.runtimeDir,
    databasePath: typeof raw?.databasePath === "string" && raw.databasePath.trim() ? normalizePathSetting(raw.databasePath) : defaults.databasePath,
    entityDir: typeof raw?.entityDir === "string" && raw.entityDir.trim() ? normalizeVaultFolderPath(raw.entityDir) : defaults.entityDir,
    preferredLang: raw?.preferredLang === "en" || raw?.preferredLang === "zh" ? raw.preferredLang : defaults.preferredLang,
    noteGlobs: normalizeNoteGlobs(raw?.noteGlobs, defaults.noteGlobs)
  };
}
function normalizePathSetting(value) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}
function normalizeVaultFolderPath(value) {
  return normalizePathSetting(value).replace(/^\/+/g, "");
}
function normalizeNoteGlobs(raw, fallback) {
  const values = typeof raw === "string" ? raw.split(/\r?\n|,/) : Array.isArray(raw) ? raw : fallback;
  const normalized = values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [...fallback];
}
var DEFAULT_DATABASE_PATH, DEFAULT_ENTITY_DIR, DEFAULT_NOTE_GLOBS;
var init_settings = __esm({
  "src/plugin/settings.ts"() {
    "use strict";
    init_project_info();
    DEFAULT_DATABASE_PATH = `.obsidian/plugins/${PLUGIN_ID}/wikipage-spine.sqlite`;
    DEFAULT_ENTITY_DIR = "wiki";
    DEFAULT_NOTE_GLOBS = ["**/*.md"];
  }
});

// src/cli/plugin-config.ts
function resolveVaultDir(value) {
  if (value === void 0 || value.trim() === "") {
    throw new Error("Missing vault. Pass --vault <path> or set VAULT.");
  }
  return (0, import_node_path.resolve)(value);
}
function loadVaultContext(vaultDir) {
  const pluginDir = (0, import_node_path.join)(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
  const manifestPath = (0, import_node_path.join)(pluginDir, "manifest.json");
  const dataPath = (0, import_node_path.join)(pluginDir, "data.json");
  if (!(0, import_node_fs.existsSync)(manifestPath)) {
    throw new Error(
      `WikiPage Spine plugin is not installed in this vault: ${pluginDir}`
    );
  }
  if (!(0, import_node_fs.existsSync)(dataPath)) {
    throw new Error(
      `WikiPage Spine plugin settings are missing: ${dataPath}. Open Obsidian once after installing the plugin.`
    );
  }
  return {
    vaultDir,
    pluginDir,
    settings: normalizePluginSettings(
      JSON.parse((0, import_node_fs.readFileSync)(dataPath, "utf8"))
    )
  };
}
function resolveConfiguredPath(vaultDir, configured) {
  return (0, import_node_path.isAbsolute)(configured) ? configured : (0, import_node_path.join)(vaultDir, configured);
}
function resolveNotePath(vaultDir, note) {
  const absolutePath = (0, import_node_path.isAbsolute)(note) ? (0, import_node_path.resolve)(note) : (0, import_node_path.resolve)(vaultDir, note);
  const vaultPrefix = vaultDir.endsWith(import_node_path.sep) ? vaultDir : `${vaultDir}${import_node_path.sep}`;
  if (absolutePath !== vaultDir && !absolutePath.startsWith(vaultPrefix)) {
    throw new Error(`Note must be inside the vault: ${note}`);
  }
  const viewPath = absolutePath.slice(vaultPrefix.length).replace(/\\/g, "/");
  if (!viewPath.endsWith(".md")) {
    throw new Error(`Note must be a Markdown file: ${viewPath}`);
  }
  return { absolutePath, viewPath };
}
var import_node_fs, import_node_path;
var init_plugin_config = __esm({
  "src/cli/plugin-config.ts"() {
    "use strict";
    import_node_fs = require("fs");
    import_node_path = require("path");
    init_project_info();
    init_settings();
  }
});

// src/core/view-tokens.ts
function normalizeObsidianView(markdown, options) {
  const tokens = [];
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
    const thematicBreak = readThematicBreak(markdown, index);
    if (thematicBreak !== void 0) {
      pushSpecial(tokens, "thematic_break", markdown, index, thematicBreak);
      index = thematicBreak;
      continue;
    }
    const fencedCode = readFencedCode(markdown, index);
    if (fencedCode !== void 0) {
      pushSpecial(tokens, "fenced_code", markdown, index, fencedCode);
      index = fencedCode;
      continue;
    }
    const htmlComment = readDelimited(markdown, index, "<!--", "-->");
    if (htmlComment !== void 0) {
      pushSpecial(tokens, "html_comment", markdown, index, htmlComment);
      index = htmlComment;
      continue;
    }
    const htmlBlock = readHtmlBlock(markdown, index);
    if (htmlBlock !== void 0) {
      pushSpecial(tokens, "html", markdown, index, htmlBlock);
      index = htmlBlock;
      continue;
    }
    const wikilink = readWikilink(markdown, index);
    if (wikilink !== void 0) {
      const expandedEntityEid = resolveExpandedEntityEid(
        wikilink.target,
        options
      );
      if (!wikilink.embed && (expandedEntityEid !== void 0 || options.isEntityViewLinkTarget(wikilink.target))) {
        pushText(
          tokens,
          wikilink.display,
          wikilink.start,
          wikilink.end,
          expandedEntityEid
        );
      } else {
        pushSpecial(tokens, "wikilink", markdown, wikilink.start, wikilink.end);
      }
      index = wikilink.end;
      continue;
    }
    const markdownLink = readMarkdownLink(markdown, index);
    if (markdownLink !== void 0) {
      const expandedEntityEid = resolveExpandedEntityEid(
        markdownLink.target,
        options
      );
      if (!markdownLink.image && (expandedEntityEid !== void 0 || options.isEntityViewLinkTarget(markdownLink.target))) {
        pushText(
          tokens,
          markdownLink.label,
          markdownLink.start,
          markdownLink.end,
          expandedEntityEid
        );
      } else {
        pushSpecial(
          tokens,
          markdownLink.image ? "markdown_image" : "markdown_link",
          markdown,
          markdownLink.start,
          markdownLink.end
        );
      }
      index = markdownLink.end;
      continue;
    }
    const inlineCode = readInlineCode(markdown, index);
    if (inlineCode !== void 0) {
      pushSpecial(tokens, "inline_code", markdown, index, inlineCode);
      index = inlineCode;
      continue;
    }
    const char = readCodePoint(markdown, index);
    tokens.push({
      kind: "char",
      char,
      sourceStart: index,
      sourceEnd: index + char.length
    });
    index += char.length;
  }
  return tokens;
}
function pushSpecial(tokens, syntax, markdown, start, end) {
  tokens.push({
    kind: "special",
    syntax,
    raw: markdown.slice(start, end),
    sourceStart: start,
    sourceEnd: end
  });
}
function pushText(tokens, text, sourceStart, sourceEnd, expandedEntityEid) {
  for (const char of iterateCodePoints(text)) {
    const token = { kind: "char", char, sourceStart, sourceEnd };
    tokens.push(
      expandedEntityEid === void 0 ? token : { ...token, expandedEntityEid }
    );
  }
}
function resolveExpandedEntityEid(target, options) {
  return options.resolveEntityViewLinkTarget?.(target);
}
function readThematicBreak(text, index) {
  if (index > 0 && text[index - 1] !== "\n") {
    return void 0;
  }
  const lineEnd = text.indexOf("\n", index);
  const end = lineEnd < 0 ? text.length : lineEnd + 1;
  const line = text.slice(index, lineEnd < 0 ? text.length : lineEnd);
  if (!isThematicBreakLine(line)) {
    return void 0;
  }
  const previousLineStart = text.lastIndexOf("\n", Math.max(0, index - 2)) + 1;
  const previousLine = index === 0 ? "" : text.slice(previousLineStart, index - 1);
  if (previousLine.trim().length > 0) {
    return void 0;
  }
  return end;
}
function isThematicBreakLine(line) {
  const match = /^ {0,3}([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.exec(line);
  return match !== null;
}
function readCodePoint(text, index) {
  const codePoint = text.codePointAt(index);
  if (codePoint === void 0) {
    return "";
  }
  return String.fromCodePoint(codePoint);
}
function* iterateCodePoints(text) {
  for (const char of text) {
    yield char;
  }
}
function readDelimited(text, index, open, close) {
  if (!text.startsWith(open, index)) {
    return void 0;
  }
  const closeIndex = text.indexOf(close, index + open.length);
  return closeIndex >= 0 ? closeIndex + close.length : text.length;
}
function readFencedCode(text, index) {
  if (index > 0 && text[index - 1] !== "\n") {
    return void 0;
  }
  const marker = text.startsWith("```", index) ? "```" : text.startsWith("~~~", index) ? "~~~" : void 0;
  if (marker === void 0) {
    return void 0;
  }
  const nextLine = text.indexOf("\n", index + marker.length);
  if (nextLine < 0) {
    return text.length;
  }
  const closeNeedle = `
${marker}`;
  const close = text.indexOf(closeNeedle, nextLine + 1);
  if (close < 0) {
    return text.length;
  }
  const closeLineEnd = text.indexOf("\n", close + closeNeedle.length);
  return closeLineEnd < 0 ? text.length : closeLineEnd + 1;
}
function readInlineCode(text, index) {
  if (text[index] !== "`") {
    return void 0;
  }
  let tickCount = 0;
  while (text[index + tickCount] === "`") {
    tickCount += 1;
  }
  const marker = "`".repeat(tickCount);
  const close = text.indexOf(marker, index + tickCount);
  return close >= 0 ? close + tickCount : void 0;
}
function readHtmlBlock(text, index) {
  if (text[index] !== "<" || text.startsWith("<!--", index)) {
    return void 0;
  }
  const open = /^<([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/.exec(text.slice(index));
  if (open === null) {
    return void 0;
  }
  const tag = open[1]?.toLowerCase();
  if (tag === void 0) {
    return void 0;
  }
  const openEnd = index + open[0].length;
  const closeNeedle = `</${tag}>`;
  const close = text.toLowerCase().indexOf(closeNeedle, openEnd);
  if (close < 0) {
    return openEnd;
  }
  return close + closeNeedle.length;
}
function readWikilink(text, index) {
  const embed = text[index] === "!" && text.startsWith("[[", index + 1);
  const start = embed ? index + 1 : index;
  if (!text.startsWith("[[", start)) {
    return void 0;
  }
  const close = text.indexOf("]]", start + 2);
  if (close < 0) {
    return void 0;
  }
  const body = text.slice(start + 2, close);
  const [targetPart, alias] = splitOnce(body, "|");
  const target = targetPart.trim();
  const display = alias ?? displayFromLinkTarget(target);
  return { start: index, end: close + 2, embed, target, display };
}
function readMarkdownLink(text, index) {
  const image = text[index] === "!" && text[index + 1] === "[";
  const labelStart = image ? index + 1 : index;
  if (text[labelStart] !== "[") {
    return void 0;
  }
  const labelEnd = findClosingBracket(text, labelStart, "[", "]");
  if (labelEnd === void 0 || text[labelEnd + 1] !== "(") {
    return void 0;
  }
  const targetEnd = findClosingBracket(text, labelEnd + 1, "(", ")");
  if (targetEnd === void 0) {
    return void 0;
  }
  const rawTarget = text.slice(labelEnd + 2, targetEnd).trim();
  const [target] = splitOnce(rawTarget, " ");
  return {
    start: index,
    end: targetEnd + 1,
    image,
    label: text.slice(labelStart + 1, labelEnd),
    target: decodeLinkTarget(target)
  };
}
function findClosingBracket(text, openIndex, openChar, closeChar) {
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
  return void 0;
}
function splitOnce(text, separator) {
  const index = text.indexOf(separator);
  if (index < 0) {
    return [text, void 0];
  }
  return [text.slice(0, index), text.slice(index + separator.length)];
}
function displayFromLinkTarget(target) {
  const withoutFragment = target.split("#")[0] ?? target;
  const segments = withoutFragment.split("/").filter(Boolean);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] ?? withoutFragment : withoutFragment;
  return lastSegment.replace(/\.md$/i, "");
}
function decodeLinkTarget(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
var init_view_tokens = __esm({
  "src/core/view-tokens.ts"() {
    "use strict";
  }
});

// src/core/note-view-renderer.ts
function renderNoteView(markdown, mentions, options) {
  const tokens = normalizeObsidianView(markdown, options);
  const replacements = selectLinkReplacements(mentions);
  const seenEids = /* @__PURE__ */ new Set();
  let output = "";
  let replacementIndex = 0;
  let consumedSourceEnd = -1;
  for (const token of tokens) {
    if (token.sourceEnd <= consumedSourceEnd) {
      continue;
    }
    if (token.kind === "special") {
      output += token.raw;
      if (token.syntax === "thematic_break") {
        seenEids.clear();
      }
      continue;
    }
    const replacement = replacements[replacementIndex];
    if (replacement !== void 0 && replacement.sourceStart === token.sourceStart) {
      output += renderReplacement(replacement, seenEids, options);
      seenEids.add(replacement.eid);
      consumedSourceEnd = replacement.sourceEnd;
      replacementIndex += 1;
      continue;
    }
    output += token.char;
  }
  return output;
}
function renderReplacement(replacement, seenEids, options) {
  const target = options.entityLinkTarget(replacement.eid);
  if (target === void 0 || seenEids.has(replacement.eid)) {
    return replacement.text;
  }
  return `[[${target}|${replacement.text}]]`;
}
function selectLinkReplacements(mentions) {
  const replacements = [
    ...mentions.resolved.map((mention) => ({
      sourceStart: mention.sourceStart,
      sourceEnd: mention.sourceEnd,
      text: mention.text,
      eid: mention.eid
    })),
    ...mentions.conflicts.flatMap((conflict) => conflictReplacements(conflict))
  ];
  return selectNonOverlapping(replacements).sort(
    (left, right) => left.sourceStart - right.sourceStart
  );
}
function conflictReplacements(conflict) {
  const resolved = conflict.matches.filter((match) => match.resolvedEid !== void 0).map((match) => ({
    sourceStart: match.sourceStart,
    sourceEnd: match.sourceEnd,
    text: match.text,
    eid: match.resolvedEid
  }));
  if (resolved.length > 0) {
    return selectNonOverlapping(resolved).sort(
      (left, right) => left.sourceStart - right.sourceStart
    );
  }
  const candidates = conflict.matches.flatMap((match) => {
    const eid = match.eids.length === 1 ? match.eids[0] : void 0;
    return eid === void 0 ? [] : [
      {
        sourceStart: match.sourceStart,
        sourceEnd: match.sourceEnd,
        text: match.text,
        eid
      }
    ];
  }).sort((left, right) => {
    const lengthDelta = Array.from(right.text).length - Array.from(left.text).length;
    return lengthDelta !== 0 ? lengthDelta : left.sourceStart - right.sourceStart;
  });
  return selectNonOverlapping(candidates).sort(
    (left, right) => left.sourceStart - right.sourceStart
  );
}
function selectNonOverlapping(replacements) {
  const selected = [];
  for (const replacement of replacements) {
    if (selected.some((existing) => rangesOverlap(existing, replacement))) {
      continue;
    }
    selected.push(replacement);
  }
  return selected;
}
function rangesOverlap(left, right) {
  return left.sourceStart < right.sourceEnd && right.sourceStart < left.sourceEnd;
}
var init_note_view_renderer = __esm({
  "src/core/note-view-renderer.ts"() {
    "use strict";
    init_view_tokens();
  }
});

// src/core/note-mentions/mention-extractor.ts
function collectTextSegments(tokens) {
  const segments = [];
  let chars = [];
  for (const token of tokens) {
    if (token.kind === "char") {
      chars.push(token);
      continue;
    }
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
function scanTextSegments(segments, scanner) {
  return segments.flatMap((segment) => scanSegment(segment, scanner));
}
function toTextSegment(chars) {
  return { chars, text: chars.map((char) => char.char).join("") };
}
function scanSegment(segment, scanner) {
  const matches = [];
  for (const match of scanner.scan([segment.text])) {
    const startIndex = findCharIndexAtOffset(segment.chars, match.start);
    const endIndex = findCharIndexAtOffset(segment.chars, match.end);
    if (startIndex === void 0 || endIndex === void 0 || endIndex <= startIndex) {
      continue;
    }
    const startChar = segment.chars[startIndex];
    const endChar = segment.chars[endIndex - 1];
    if (startChar === void 0 || endChar === void 0) {
      continue;
    }
    matches.push({
      match,
      text: segment.text.slice(match.start, match.end),
      segment,
      segmentStart: startIndex,
      segmentEnd: endIndex,
      sourceStart: startChar.sourceStart,
      sourceEnd: endChar.sourceEnd
    });
  }
  return matches.sort(
    (left, right) => left.segmentStart - right.segmentStart || left.segmentEnd - right.segmentEnd
  );
}
function findCharIndexAtOffset(chars, offset) {
  let current = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (current === offset) {
      return index;
    }
    current += chars[index]?.char.length ?? 0;
    if (current > offset) {
      return void 0;
    }
  }
  return current === offset ? chars.length : void 0;
}
var init_mention_extractor = __esm({
  "src/core/note-mentions/mention-extractor.ts"() {
    "use strict";
  }
});

// src/core/note-mentions/conflict-hash.ts
function createConflictHash(input) {
  const body = {
    version: CONFLICT_HASH_VERSION,
    leftContext: input.leftContext,
    text: input.text,
    rightContext: input.rightContext,
    matches: input.matches.map((match) => ({
      text: match.text,
      surfaceId: match.surfaceId,
      eids: match.eids
    }))
  };
  return (0, import_node_crypto.createHash)("sha256").update(JSON.stringify(body)).digest("hex");
}
function collectContext(segment, index, direction) {
  const parts = [];
  let weight = 0;
  let cursor = direction === "left" ? index - 1 : index;
  let pendingWhitespace = false;
  while (cursor >= 0 && cursor < segment.chars.length && weight < CONFLICT_CONTEXT_WEIGHT) {
    const char = segment.chars[cursor]?.char;
    if (char === void 0) {
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
function appendContextPart(parts, value, direction) {
  if (direction === "left") {
    parts.unshift(value);
  } else {
    parts.push(value);
  }
}
function contextWeight(char) {
  return isHan(char) ? 3 : 1;
}
function isHan(char) {
  return new RegExp("\\p{Script=Han}", "u").test(char);
}
function isInvisible(char) {
  return /\s/u.test(char);
}
var import_node_crypto, CONFLICT_HASH_VERSION, CONFLICT_CONTEXT_WEIGHT;
var init_conflict_hash = __esm({
  "src/core/note-mentions/conflict-hash.ts"() {
    "use strict";
    import_node_crypto = require("crypto");
    CONFLICT_HASH_VERSION = "mention-conflict-v1";
    CONFLICT_CONTEXT_WEIGHT = 30;
  }
});

// src/core/note-mentions/mention-cluster.ts
function buildMentions(matches) {
  const clusters = clusterSurfaceMatches(matches);
  const resolved = [];
  const conflicts = [];
  for (const cluster of clusters) {
    if (cluster.matches.length === 1 && cluster.matches[0]?.match.qids.length === 1) {
      const only = cluster.matches[0];
      const eid = only.match.qids[0];
      if (eid === void 0) {
        continue;
      }
      resolved.push({
        kind: "resolved",
        text: only.text,
        eid,
        surfaceId: only.match.surfaceId,
        surface: only.match.surface,
        sourceStart: only.sourceStart,
        sourceEnd: only.sourceEnd
      });
      continue;
    }
    conflicts.push(createMentionConflict(cluster));
  }
  return { resolved, conflicts };
}
function clusterSurfaceMatches(matches) {
  const clusters = [];
  for (const match of matches) {
    const current = clusters[clusters.length - 1];
    if (current === void 0 || current.segment !== match.segment || match.segmentStart >= current.segmentEnd) {
      clusters.push({
        segment: match.segment,
        segmentStart: match.segmentStart,
        segmentEnd: match.segmentEnd,
        sourceStart: match.sourceStart,
        sourceEnd: match.sourceEnd,
        matches: [match]
      });
      continue;
    }
    current.matches.push(match);
    current.segmentStart = Math.min(current.segmentStart, match.segmentStart);
    current.segmentEnd = Math.max(current.segmentEnd, match.segmentEnd);
    current.sourceStart = Math.min(current.sourceStart, match.sourceStart);
    current.sourceEnd = Math.max(current.sourceEnd, match.sourceEnd);
  }
  return clusters;
}
function createMentionConflict(cluster) {
  const text = sliceSegmentChars(
    cluster.segment,
    cluster.segmentStart,
    cluster.segmentEnd
  );
  const leftContext = collectContext(
    cluster.segment,
    cluster.segmentStart,
    "left"
  );
  const rightContext = collectContext(
    cluster.segment,
    cluster.segmentEnd,
    "right"
  );
  const matches = cluster.matches.map((match) => {
    const conflictMatch = {
      text: match.text,
      surfaceId: match.match.surfaceId,
      surface: match.match.surface,
      sourceStart: match.sourceStart,
      sourceEnd: match.sourceEnd,
      eids: match.match.qids
    };
    const resolvedEid = resolveExpandedEntityMatch(match);
    return resolvedEid === void 0 ? conflictMatch : { ...conflictMatch, resolvedEid };
  });
  const hash = createConflictHash({
    text,
    leftContext,
    rightContext,
    matches
  });
  return {
    kind: "conflict",
    text,
    hash,
    sourceStart: cluster.sourceStart,
    sourceEnd: cluster.sourceEnd,
    leftContext,
    rightContext,
    matches
  };
}
function resolveExpandedEntityMatch(match) {
  const chars = match.segment.chars.slice(match.segmentStart, match.segmentEnd);
  const first = chars[0];
  if (first?.expandedEntityEid === void 0) {
    return void 0;
  }
  const sameExpandedLink = chars.every(
    (char) => char.expandedEntityEid === first.expandedEntityEid && char.sourceStart === first.sourceStart && char.sourceEnd === first.sourceEnd
  );
  if (!sameExpandedLink) {
    return void 0;
  }
  if (!match.match.qids.includes(first.expandedEntityEid)) {
    return void 0;
  }
  return first.expandedEntityEid;
}
function sliceSegmentChars(segment, start, end) {
  return segment.chars.slice(start, end).map((char) => char.char).join("");
}
var init_mention_cluster = __esm({
  "src/core/note-mentions/mention-cluster.ts"() {
    "use strict";
    init_conflict_hash();
  }
});

// src/core/note-mentions/view-normalizer.ts
var init_view_normalizer = __esm({
  "src/core/note-mentions/view-normalizer.ts"() {
    "use strict";
    init_view_tokens();
  }
});

// src/core/note-mentions/index.ts
function extractNoteMentions(markdown, scanner, options) {
  const tokens = normalizeObsidianView(markdown, options);
  const segments = collectTextSegments(tokens);
  const positionedMatches = scanTextSegments(segments, scanner);
  return buildMentions(positionedMatches);
}
var init_note_mentions = __esm({
  "src/core/note-mentions/index.ts"() {
    "use strict";
    init_mention_extractor();
    init_mention_cluster();
    init_view_normalizer();
    init_view_normalizer();
  }
});

// src/core/surface-matcher.ts
function readRuntimeManifest(rootDir) {
  return JSON.parse((0, import_node_fs2.readFileSync)((0, import_node_path2.join)(rootDir, "manifest.json"), "utf8"));
}
function validateManifest(manifest) {
  if (manifest.format !== "wikipage-spine-runtime-v1") {
    throw new Error(`unsupported runtime format: ${manifest.format}`);
  }
  if (manifest.endian !== "little") {
    throw new Error(`unsupported runtime endian: ${manifest.endian}`);
  }
  if (manifest.mode !== "charwise") {
    throw new Error(`unsupported runtime mode: ${manifest.mode}`);
  }
  if (manifest.state_record_bytes !== 16) {
    throw new Error(`unsupported state record size: ${manifest.state_record_bytes}`);
  }
  if (manifest.state_output_record_bytes !== 12) {
    throw new Error(`unsupported state output record size: ${manifest.state_output_record_bytes}`);
  }
  if (manifest.qid_index_record_bytes !== 8) {
    throw new Error(`unsupported qid index record size: ${manifest.qid_index_record_bytes}`);
  }
}
function* iterateCodePoints2(chunks) {
  let pendingHighSurrogate = "";
  for (const chunk of chunks) {
    let text = pendingHighSurrogate + chunk;
    pendingHighSurrogate = "";
    if (text.length === 0) {
      continue;
    }
    const last = text.charCodeAt(text.length - 1);
    if (last >= 55296 && last <= 56319) {
      pendingHighSurrogate = text[text.length - 1] ?? "";
      text = text.slice(0, -1);
    }
    for (const char of text) {
      yield char;
    }
  }
  if (pendingHighSurrogate.length > 0) {
    yield pendingHighSurrogate;
  }
}
var import_node_fs2, import_node_path2, ROOT_STATE_ID, INVALID_CODE, SurfaceMatcher, U32Table, RecordTable, CachedFile;
var init_surface_matcher = __esm({
  "src/core/surface-matcher.ts"() {
    "use strict";
    import_node_fs2 = require("fs");
    import_node_path2 = require("path");
    ROOT_STATE_ID = 0;
    INVALID_CODE = 4294967295;
    SurfaceMatcher = class _SurfaceMatcher {
      static exists(rootDir) {
        return (0, import_node_fs2.existsSync)((0, import_node_path2.join)(rootDir, "manifest.json"));
      }
      static open(rootDir, options = {}) {
        return new _SurfaceMatcher(rootDir, options);
      }
      constructor(rootDir, options) {
        this.rootDir = rootDir;
        this.manifest = readRuntimeManifest(rootDir);
        validateManifest(this.manifest);
        this.captureSurface = options.captureSurface ?? true;
        this.captureWindowUtf16 = options.captureWindowUtf16 ?? 4096;
        const blockBytes = options.blockBytes ?? 64 * 1024;
        this.charCodeMap = new U32Table(
          (0, import_node_path2.join)(rootDir, this.manifest.files.char_code_map),
          options.mapCacheBlocks ?? 4,
          blockBytes
        );
        this.states = new RecordTable(
          (0, import_node_path2.join)(rootDir, this.manifest.files.states),
          this.manifest.state_record_bytes,
          options.stateCacheBlocks ?? 64,
          blockBytes
        );
        this.stateOutputs = new RecordTable(
          (0, import_node_path2.join)(rootDir, this.manifest.files.state_outputs),
          this.manifest.state_output_record_bytes,
          options.outputCacheBlocks ?? 16,
          blockBytes
        );
        this.qidIndex = new RecordTable(
          (0, import_node_path2.join)(rootDir, this.manifest.files.qid_index),
          this.manifest.qid_index_record_bytes,
          options.qidCacheBlocks ?? 16,
          blockBytes
        );
        this.qidValues = new U32Table(
          (0, import_node_path2.join)(rootDir, this.manifest.files.qid_values),
          options.qidCacheBlocks ?? 16,
          blockBytes
        );
      }
      *scan(chunks) {
        let stateId = ROOT_STATE_ID;
        let end = 0;
        let recentText = "";
        let recentStart = 0;
        for (const char of iterateCodePoints2(chunks)) {
          stateId = this.nextStateId(stateId, char.codePointAt(0) ?? 0);
          end += char.length;
          if (this.captureSurface) {
            recentText += char;
            if (recentText.length > this.captureWindowUtf16) {
              const excess = recentText.length - this.captureWindowUtf16;
              recentText = recentText.slice(excess);
              recentStart += excess;
            }
          }
          const state = this.readState(stateId);
          for (const output of this.readOutputChain(state.outputPos)) {
            const start = end - output.utf16Length;
            const qidNumbers = this.readQidNumbers(output.surfaceId);
            const surface = this.captureSurface && start >= recentStart ? recentText.slice(start - recentStart, end - recentStart) : void 0;
            const match = {
              start,
              end,
              utf16Length: output.utf16Length,
              surfaceId: output.surfaceId,
              qidNumbers,
              qids: qidNumbers.map((qid) => `Q${qid}`)
            };
            if (surface !== void 0) {
              match.surface = surface;
            }
            yield match;
          }
        }
      }
      scanCharacters(chars) {
        return this.scan(chars);
      }
      close() {
        this.charCodeMap.close();
        this.states.close();
        this.stateOutputs.close();
        this.qidIndex.close();
        this.qidValues.close();
      }
      nextStateId(initialStateId, codePoint) {
        const mappedCode = this.readMappedCode(codePoint);
        if (mappedCode === void 0) {
          return ROOT_STATE_ID;
        }
        let stateId = initialStateId;
        while (true) {
          const childId = this.childStateId(stateId, mappedCode);
          if (childId !== void 0) {
            return childId;
          }
          if (stateId === ROOT_STATE_ID) {
            return ROOT_STATE_ID;
          }
          stateId = this.readState(stateId).fail;
        }
      }
      childStateId(stateId, mappedCode) {
        const base = this.readState(stateId).base;
        if (base === 0) {
          return void 0;
        }
        const childId = (base ^ mappedCode) >>> 0;
        if (childId >= this.manifest.states_len) {
          return void 0;
        }
        return this.readState(childId).check === stateId ? childId : void 0;
      }
      readMappedCode(codePoint) {
        if (codePoint < 0 || codePoint >= this.manifest.mapper_table_len) {
          return void 0;
        }
        const mapped = this.charCodeMap.read(codePoint);
        return mapped === INVALID_CODE ? void 0 : mapped;
      }
      readState(stateId) {
        const offset = this.states.byteOffset(stateId);
        return {
          base: this.states.readU32At(offset),
          check: this.states.readU32At(offset + 4),
          fail: this.states.readU32At(offset + 8),
          outputPos: this.states.readU32At(offset + 12)
        };
      }
      *readOutputChain(outputPos) {
        let current = outputPos;
        while (current !== 0) {
          const outputId = current - 1;
          const offset = this.stateOutputs.byteOffset(outputId);
          const output = {
            surfaceId: this.stateOutputs.readU32At(offset),
            utf16Length: this.stateOutputs.readU32At(offset + 4),
            parentOutputPos: this.stateOutputs.readU32At(offset + 8)
          };
          yield output;
          current = output.parentOutputPos;
        }
      }
      readQidNumbers(surfaceId) {
        const offset = this.qidIndex.byteOffset(surfaceId);
        const qidOffset = this.qidIndex.readU32At(offset);
        const qidLength = this.qidIndex.readU32At(offset + 4);
        const qids = [];
        for (let index = 0; index < qidLength; index += 1) {
          qids.push(this.qidValues.read(qidOffset + index));
        }
        return qids;
      }
    };
    U32Table = class {
      constructor(path, cacheBlocks, blockBytes) {
        this.file = new CachedFile(path, cacheBlocks, blockBytes);
      }
      read(index) {
        return this.file.readU32(index * 4);
      }
      close() {
        this.file.close();
      }
    };
    RecordTable = class {
      constructor(path, recordBytes, cacheBlocks, blockBytes) {
        this.recordBytes = recordBytes;
        this.file = new CachedFile(path, cacheBlocks, blockBytes);
      }
      byteOffset(recordId) {
        return recordId * this.recordBytes;
      }
      readU32At(offset) {
        return this.file.readU32(offset);
      }
      close() {
        this.file.close();
      }
    };
    CachedFile = class {
      constructor(path, maxBlocks, blockBytes) {
        this.maxBlocks = maxBlocks;
        this.blockBytes = blockBytes;
        this.cache = /* @__PURE__ */ new Map();
        this.fd = (0, import_node_fs2.openSync)(path, "r");
        this.size = (0, import_node_fs2.statSync)(path).size;
      }
      readU32(offset) {
        if (offset < 0 || offset + 4 > this.size) {
          throw new Error(`read outside table bounds at byte offset ${offset}`);
        }
        const blockId = Math.floor(offset / this.blockBytes);
        const blockOffset = offset - blockId * this.blockBytes;
        const block = this.readBlock(blockId);
        if (blockOffset + 4 > block.length) {
          const bytes = Buffer.allocUnsafe(4);
          const bytesRead = (0, import_node_fs2.readSync)(this.fd, bytes, 0, 4, offset);
          if (bytesRead !== 4) {
            throw new Error(`short read at byte offset ${offset}`);
          }
          return bytes.readUInt32LE(0);
        }
        return block.readUInt32LE(blockOffset);
      }
      close() {
        (0, import_node_fs2.closeSync)(this.fd);
        this.cache.clear();
      }
      readBlock(blockId) {
        const cached = this.cache.get(blockId);
        if (cached !== void 0) {
          this.cache.delete(blockId);
          this.cache.set(blockId, cached);
          return cached;
        }
        const start = blockId * this.blockBytes;
        const bytesToRead = Math.min(this.blockBytes, this.size - start);
        const block = Buffer.allocUnsafe(bytesToRead);
        const bytesRead = (0, import_node_fs2.readSync)(this.fd, block, 0, bytesToRead, start);
        if (bytesRead !== bytesToRead) {
          throw new Error(`short read at byte offset ${start}`);
        }
        if (this.maxBlocks > 0) {
          this.cache.set(blockId, block);
          while (this.cache.size > this.maxBlocks) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey === void 0) {
              break;
            }
            this.cache.delete(oldestKey);
          }
        }
        return block;
      }
    };
  }
});

// src/model/schema.ts
var MODEL_SCHEMA_VERSION, MODEL_SCHEMA_SQL;
var init_schema = __esm({
  "src/model/schema.ts"() {
    "use strict";
    MODEL_SCHEMA_VERSION = 1;
    MODEL_SCHEMA_SQL = [
      "PRAGMA foreign_keys = ON",
      `CREATE TABLE IF NOT EXISTS model_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
      `INSERT INTO model_meta (key, value)
    VALUES ('schema_version', '${MODEL_SCHEMA_VERSION}')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'missing'
      CHECK (status IN ('missing', 'synced', 'modified')),
    view_path TEXT NOT NULL UNIQUE,
    view_exists INTEGER NOT NULL DEFAULT 0
      CHECK (view_exists IN (0, 1)),
    view_mtime_unix_ms INTEGER,
    view_size_bytes INTEGER,
    view_hash TEXT,
    view_last_seen_scan_id INTEGER,
    view_last_scanned_at_unix_ms INTEGER,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    CHECK (
      (status = 'missing' AND view_exists = 0)
      OR (status IN ('synced', 'modified') AND view_exists = 1)
    )
  )`,
      `CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    eid TEXT NOT NULL UNIQUE,
    preferred_lang TEXT NOT NULL
      CHECK (preferred_lang IN ('zh', 'en')),
    metadata_complete INTEGER NOT NULL DEFAULT 0
      CHECK (metadata_complete IN (0, 1)),
    metadata_checked_at_unix_ms INTEGER,
    wikipage_url TEXT,
    title TEXT,
    description TEXT,
    summary TEXT,
    image_url TEXT,
    ref_count INTEGER NOT NULL DEFAULT 0
      CHECK (ref_count >= 0),
    view_path TEXT NOT NULL UNIQUE,
    view_mtime_unix_ms INTEGER,
    view_size_bytes INTEGER,
    view_hash TEXT,
    view_last_seen_scan_id INTEGER,
    view_last_scanned_at_unix_ms INTEGER,
    managed_properties_json TEXT NOT NULL DEFAULT '{}',
    managed_properties_hash TEXT,
    user_content_hash TEXT,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL
  )`,
      `CREATE TABLE IF NOT EXISTS note_mentions (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL
      REFERENCES notes(id) ON DELETE CASCADE,
    entity_id INTEGER
      REFERENCES entities(id) ON DELETE SET NULL,
    eid TEXT NOT NULL,
    text TEXT NOT NULL,
    surface_id INTEGER NOT NULL,
    surface TEXT,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    CHECK (source_start >= 0 AND source_end > source_start)
  )`,
      `CREATE TABLE IF NOT EXISTS note_mention_conflicts (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL
      REFERENCES notes(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    text TEXT NOT NULL,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    left_context TEXT NOT NULL,
    right_context TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    CHECK (source_start >= 0 AND source_end > source_start)
  )`,
      `CREATE TABLE IF NOT EXISTS note_mention_conflict_matches (
    id INTEGER PRIMARY KEY,
    conflict_id INTEGER NOT NULL
      REFERENCES note_mention_conflicts(id) ON DELETE CASCADE,
    resolved_entity_id INTEGER
      REFERENCES entities(id) ON DELETE SET NULL,
    resolved_eid TEXT,
    text TEXT NOT NULL,
    surface_id INTEGER NOT NULL,
    surface TEXT,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    candidate_eids_json TEXT NOT NULL,
    CHECK (source_start >= 0 AND source_end > source_start)
  )`,
      "CREATE INDEX IF NOT EXISTS notes_status_idx ON notes(status)",
      "CREATE INDEX IF NOT EXISTS notes_view_seen_scan_idx ON notes(view_last_seen_scan_id)",
      "CREATE INDEX IF NOT EXISTS entities_ref_count_idx ON entities(ref_count)",
      "CREATE INDEX IF NOT EXISTS entities_view_seen_scan_idx ON entities(view_last_seen_scan_id)",
      "CREATE INDEX IF NOT EXISTS note_mentions_note_id_idx ON note_mentions(note_id)",
      "CREATE INDEX IF NOT EXISTS note_mentions_eid_idx ON note_mentions(eid)",
      "CREATE INDEX IF NOT EXISTS note_mention_conflicts_note_id_idx ON note_mention_conflicts(note_id)",
      "CREATE INDEX IF NOT EXISTS note_mention_conflicts_hash_idx ON note_mention_conflicts(hash)",
      "CREATE INDEX IF NOT EXISTS note_mention_conflict_matches_conflict_id_idx ON note_mention_conflict_matches(conflict_id)",
      "CREATE INDEX IF NOT EXISTS note_mention_conflict_matches_resolved_eid_idx ON note_mention_conflict_matches(resolved_eid)"
    ];
  }
});

// src/model/index.ts
var init_model = __esm({
  "src/model/index.ts"() {
    "use strict";
    init_schema();
  }
});

// src/cli/model-store.ts
function entityViewPathForEid(entityDir, eid) {
  return entityDir ? `${entityDir}/${eid}.md` : `${eid}.md`;
}
function entityLinkTargetForEid(entityDir, eid) {
  const viewPath = entityViewPathForEid(entityDir, eid);
  return viewPath.endsWith(".md") ? viewPath.slice(0, -3) : viewPath;
}
function collectMentionEids(mentions) {
  return [
    ...mentions.resolved.map((mention) => mention.eid),
    ...mentions.conflicts.flatMap(
      (conflict) => conflict.matches.flatMap(
        (match) => match.resolvedEid === void 0 ? match.eids : [...match.eids, match.resolvedEid]
      )
    )
  ];
}
function applyStoredConflictResolutions(conflicts, stored) {
  const byKey = new Map(
    stored.map((resolution) => [resolutionKey(resolution), resolution])
  );
  for (const conflict of conflicts) {
    for (const match of conflict.matches) {
      if (match.resolvedEid !== void 0) {
        continue;
      }
      const resolution = byKey.get(
        resolutionKey({
          hash: conflict.hash,
          text: match.text,
          surfaceId: match.surfaceId,
          sourceStart: match.sourceStart,
          sourceEnd: match.sourceEnd
        })
      );
      if (resolution !== void 0 && match.eids.includes(resolution.resolvedEid)) {
        match.resolvedEid = resolution.resolvedEid;
      }
    }
  }
}
function ensureEntityViews(vaultDir, entities, preferredLang) {
  for (const entity of entities) {
    const absolutePath = (0, import_node_path3.join)(vaultDir, entity.viewPath);
    if ((0, import_node_fs3.existsSync)(absolutePath)) {
      continue;
    }
    (0, import_node_fs3.mkdirSync)((0, import_node_path3.dirname)(absolutePath), { recursive: true });
    (0, import_node_fs3.writeFileSync)(
      absolutePath,
      `---
EID: ${entity.eid}
PreferredLang: ${preferredLang}
---
`,
      "utf8"
    );
  }
}
function observeFile(path) {
  const stat = (0, import_node_fs3.statSync)(path);
  return {
    mtimeMs: Math.trunc(stat.mtimeMs),
    sizeBytes: stat.size,
    hash: (0, import_node_crypto2.createHash)("sha256").update((0, import_node_fs3.readFileSync)(path)).digest("hex")
  };
}
function resolutionKey(value) {
  return [
    value.hash,
    value.text,
    String(value.surfaceId),
    String(value.sourceStart),
    String(value.sourceEnd)
  ].join("\0");
}
function runTransaction(dbPath, statements) {
  if (statements.length === 0) {
    return;
  }
  runSqlite(
    dbPath,
    [
      "PRAGMA foreign_keys = ON;",
      "BEGIN IMMEDIATE;",
      ...statements.map(terminateSql),
      "COMMIT;"
    ].join("\n")
  );
}
function querySqlite(dbPath, sqlText) {
  const output = runSqlite(dbPath, sqlText, ["-json"]);
  if (output.trim().length === 0) {
    return [];
  }
  return JSON.parse(output);
}
function runSqlite(dbPath, sqlText, extraArgs = []) {
  try {
    return (0, import_node_child_process.execFileSync)("sqlite3", [...extraArgs, dbPath, sqlText], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    const nodeError = error;
    if (nodeError.code === "ENOENT") {
      throw new Error("sqlite3 command is required in PATH.");
    }
    throw error;
  }
}
function recomputeEntityRefCountsSql() {
  return `UPDATE entities SET ref_count = (
    SELECT COUNT(*) FROM note_mentions
    WHERE note_mentions.eid = entities.eid
  ) + (
    SELECT COUNT(*) FROM note_mention_conflict_matches
    WHERE note_mention_conflict_matches.resolved_eid = entities.eid
  )`;
}
function sql(strings, ...values) {
  let output = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    output += sqlValue(values[index]);
    output += strings[index + 1] ?? "";
  }
  return output;
}
function sqlValue(value) {
  if (value === null || value === void 0) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid SQL number: ${value}`);
    }
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}
function terminateSql(statement) {
  const trimmed = statement.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}
var import_node_child_process, import_node_fs3, import_node_crypto2, import_node_path3, ModelStore;
var init_model_store = __esm({
  "src/cli/model-store.ts"() {
    "use strict";
    import_node_child_process = require("child_process");
    import_node_fs3 = require("fs");
    import_node_crypto2 = require("crypto");
    import_node_path3 = require("path");
    init_model();
    ModelStore = class {
      constructor(databasePath) {
        this.databasePath = databasePath;
        (0, import_node_fs3.mkdirSync)((0, import_node_path3.dirname)(databasePath), { recursive: true });
        runSqlite(
          this.databasePath,
          ["PRAGMA foreign_keys = ON", ...MODEL_SCHEMA_SQL].map(terminateSql).join("\n")
        );
      }
      close() {
      }
      ensureNote(viewPath, now) {
        const rows = querySqlite(
          this.databasePath,
          [
            sql`INSERT OR IGNORE INTO notes (
          status, view_path, view_exists, created_at_unix_ms, updated_at_unix_ms
        ) VALUES ('modified', ${viewPath}, 1, ${now}, ${now})`,
            sql`UPDATE notes SET view_exists = 1, updated_at_unix_ms = ${now} WHERE view_path = ${viewPath}`,
            sql`SELECT id FROM notes WHERE view_path = ${viewPath}`
          ].map(terminateSql).join("\n")
        );
        const id = rows[0]?.id;
        if (id === void 0) {
          throw new Error(`Failed to create note row: ${viewPath}`);
        }
        return id;
      }
      readConflictResolutions(noteId) {
        const rows = querySqlite(
          this.databasePath,
          sql`SELECT
          c.hash,
          m.text,
          m.surface_id,
          m.source_start,
          m.source_end,
          m.resolved_eid
        FROM note_mention_conflicts c
        JOIN note_mention_conflict_matches m ON m.conflict_id = c.id
        WHERE c.note_id = ${noteId} AND m.resolved_eid IS NOT NULL`
        );
        return rows.flatMap(
          (row) => row.resolved_eid === null ? [] : [
            {
              hash: row.hash,
              text: row.text,
              surfaceId: row.surface_id,
              sourceStart: row.source_start,
              sourceEnd: row.source_end,
              resolvedEid: row.resolved_eid
            }
          ]
        );
      }
      ensureEntities(eids, settings, now) {
        const entities = /* @__PURE__ */ new Map();
        const uniqueEids = [...new Set(eids)].sort();
        if (uniqueEids.length === 0) {
          return entities;
        }
        runTransaction(
          this.databasePath,
          uniqueEids.map(
            (eid) => sql`INSERT OR IGNORE INTO entities (
          eid, preferred_lang, view_path, created_at_unix_ms, updated_at_unix_ms
        ) VALUES (
          ${eid},
          ${settings.preferredLang},
          ${entityViewPathForEid(settings.entityDir, eid)},
          ${now},
          ${now}
        )`
          )
        );
        const rows = querySqlite(
          this.databasePath,
          `SELECT id, eid, view_path FROM entities WHERE eid IN (${uniqueEids.map(sqlValue).join(", ")})`
        );
        for (const row of rows) {
          entities.set(row.eid, {
            id: row.id,
            eid: row.eid,
            viewPath: row.view_path
          });
        }
        return entities;
      }
      findEntityEidByViewPath(viewPath) {
        return querySqlite(
          this.databasePath,
          sql`SELECT eid FROM entities WHERE view_path = ${viewPath}`
        )[0]?.eid;
      }
      replaceNoteMentions(noteId, mentions, entities, now) {
        const statements = [
          sql`DELETE FROM note_mentions WHERE note_id = ${noteId}`,
          sql`DELETE FROM note_mention_conflicts WHERE note_id = ${noteId}`
        ];
        for (const mention of mentions.resolved) {
          statements.push(sql`INSERT INTO note_mentions (
        note_id, entity_id, eid, text, surface_id, surface,
        source_start, source_end, created_at_unix_ms, updated_at_unix_ms
      ) VALUES (
        ${noteId},
        ${entities.get(mention.eid)?.id},
        ${mention.eid},
        ${mention.text},
        ${mention.surfaceId},
        ${mention.surface},
        ${mention.sourceStart},
        ${mention.sourceEnd},
        ${now},
        ${now}
      )`);
        }
        for (const conflict of mentions.conflicts) {
          statements.push(sql`INSERT INTO note_mention_conflicts (
        note_id, hash, text, source_start, source_end, left_context,
        right_context, created_at_unix_ms, updated_at_unix_ms
      ) VALUES (
        ${noteId},
        ${conflict.hash},
        ${conflict.text},
        ${conflict.sourceStart},
        ${conflict.sourceEnd},
        ${conflict.leftContext},
        ${conflict.rightContext},
        ${now},
        ${now}
      )`);
          if (conflict.matches.length > 0) {
            statements.push(
              `INSERT INTO note_mention_conflict_matches (
            conflict_id, resolved_entity_id, resolved_eid, text, surface_id,
            surface, source_start, source_end, candidate_eids_json
          ) ${conflict.matches.map((match, index) => {
                const resolvedEntity = match.resolvedEid === void 0 ? void 0 : entities.get(match.resolvedEid);
                const prefix = index === 0 ? "SELECT" : "UNION ALL SELECT";
                return `${prefix}
                last_insert_rowid(),
                ${sqlValue(resolvedEntity?.id)},
                ${sqlValue(match.resolvedEid)},
                ${sqlValue(match.text)},
                ${sqlValue(match.surfaceId)},
                ${sqlValue(match.surface)},
                ${sqlValue(match.sourceStart)},
                ${sqlValue(match.sourceEnd)},
                ${sqlValue(JSON.stringify(match.eids))}`;
              }).join("\n")}`
            );
          }
        }
        statements.push(recomputeEntityRefCountsSql());
        runTransaction(this.databasePath, statements);
      }
      markNoteSynced(noteId, observation, now) {
        runSqlite(
          this.databasePath,
          sql`UPDATE notes SET
          status = 'synced',
          view_exists = 1,
          view_mtime_unix_ms = ${observation.mtimeMs},
          view_size_bytes = ${observation.sizeBytes},
          view_hash = ${observation.hash},
          view_last_scanned_at_unix_ms = ${now},
          updated_at_unix_ms = ${now}
        WHERE id = ${noteId}`
        );
      }
    };
  }
});

// src/cli/sync-note.ts
var sync_note_exports = {};
__export(sync_note_exports, {
  syncNote: () => syncNote
});
function syncNote(input) {
  const context = loadVaultContext(input.vaultDir);
  const notePath = resolveNotePath(context.vaultDir, input.note);
  if (!(0, import_node_fs4.existsSync)(notePath.absolutePath)) {
    throw new Error(`Note does not exist: ${notePath.viewPath}`);
  }
  const runtimeDir = resolveConfiguredPath(
    context.vaultDir,
    context.settings.runtimeDir
  );
  if (!context.settings.runtimeDir || !SurfaceMatcher.exists(runtimeDir)) {
    throw new Error(
      `Runtime dataset is not configured or missing manifest.json: ${runtimeDir}`
    );
  }
  const databasePath = resolveConfiguredPath(
    context.vaultDir,
    context.settings.databasePath
  );
  const store = new ModelStore(databasePath);
  const matcher = SurfaceMatcher.open(runtimeDir);
  try {
    const now = Date.now();
    const noteId = store.ensureNote(notePath.viewPath, now);
    const storedResolutions = store.readConflictResolutions(noteId);
    const originalMarkdown = (0, import_node_fs4.readFileSync)(notePath.absolutePath, "utf8");
    const firstMentions = extractMentions(
      originalMarkdown,
      matcher,
      context,
      store,
      storedResolutions
    );
    let renderedMarkdown = renderMarkdownWithMentions(
      originalMarkdown,
      firstMentions,
      context.settings
    );
    let finalMentions = firstMentions;
    for (let pass = 0; pass < 3; pass += 1) {
      const nextMentions = extractMentions(
        renderedMarkdown,
        matcher,
        context,
        store,
        storedResolutions
      );
      const nextRendered = renderMarkdownWithMentions(
        renderedMarkdown,
        nextMentions,
        context.settings
      );
      finalMentions = nextMentions;
      if (nextRendered === renderedMarkdown) {
        break;
      }
      renderedMarkdown = nextRendered;
    }
    const allEntities = store.ensureEntities(
      collectMentionEids(finalMentions),
      context.settings,
      now
    );
    ensureEntityViews(
      context.vaultDir,
      allEntities.values(),
      context.settings.preferredLang
    );
    const rewritten = renderedMarkdown !== originalMarkdown;
    if (rewritten) {
      writeFileAtomically(notePath.absolutePath, renderedMarkdown);
    }
    store.replaceNoteMentions(noteId, finalMentions, allEntities, now);
    store.markNoteSynced(noteId, observeFile(notePath.absolutePath), Date.now());
    return {
      noteId,
      viewPath: notePath.viewPath,
      databasePath,
      rewritten,
      resolvedCount: finalMentions.resolved.length,
      conflictCount: finalMentions.conflicts.length,
      entityCount: allEntities.size
    };
  } finally {
    matcher.close();
    store.close();
  }
}
function extractMentions(markdown, matcher, context, store, storedResolutions) {
  const mentions = extractNoteMentions(markdown, matcher, {
    isEntityViewLinkTarget: (target) => isEntityViewLinkTarget(target, context.settings),
    resolveEntityViewLinkTarget: (target) => resolveEntityViewLinkTarget(target, context.settings, store)
  });
  applyStoredConflictResolutions(mentions.conflicts, storedResolutions);
  return mentions;
}
function renderMarkdownWithMentions(markdown, mentions, settings) {
  return renderNoteView(markdown, mentions, {
    isEntityViewLinkTarget: (target) => isEntityViewLinkTarget(target, settings),
    resolveEntityViewLinkTarget: (target) => resolveEntityViewLinkTarget(target, settings),
    entityLinkTarget: (eid) => entityLinkTargetForEid(settings.entityDir, eid)
  });
}
function isEntityViewLinkTarget(target, settings) {
  return entityViewPathFromLinkTarget(target, settings) !== void 0;
}
function resolveEntityViewLinkTarget(target, settings, store) {
  const viewPath = entityViewPathFromLinkTarget(target, settings);
  if (viewPath === void 0) {
    return void 0;
  }
  const filename = viewPath.split("/").pop() ?? "";
  const eid = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  if (/^Q[1-9][0-9]*$/.test(eid)) {
    return eid;
  }
  return store?.findEntityEidByViewPath(viewPath);
}
function entityViewPathFromLinkTarget(target, settings) {
  const normalized = normalizeObsidianLinkTarget(target);
  const entityDir = settings.entityDir;
  const prefix = entityDir ? `${entityDir}/` : "";
  if (!normalized.startsWith(prefix)) {
    return void 0;
  }
  const rest = normalized.slice(prefix.length);
  if (!rest) {
    return void 0;
  }
  return rest.endsWith(".md") ? normalized : `${normalized}.md`;
}
function normalizeObsidianLinkTarget(target) {
  const withoutFragment = target.split(/[#"^]/, 1)[0] ?? "";
  return withoutFragment.trim().replace(/\\/g, "/").replace(/^\/+/g, "");
}
function writeFileAtomically(path, content) {
  (0, import_node_fs5.mkdirSync)((0, import_node_path4.dirname)(path), { recursive: true });
  const tempPath = `${path}.wikipage-spine.tmp`;
  (0, import_node_fs4.writeFileSync)(tempPath, content, "utf8");
  (0, import_node_fs4.renameSync)(tempPath, path);
}
var import_node_fs4, import_node_path4, import_node_fs5;
var init_sync_note = __esm({
  "src/cli/sync-note.ts"() {
    "use strict";
    import_node_fs4 = require("fs");
    import_node_path4 = require("path");
    import_node_fs5 = require("fs");
    init_note_view_renderer();
    init_note_mentions();
    init_surface_matcher();
    init_model_store();
    init_plugin_config();
  }
});

// src/cli/main.ts
init_project_info();
init_plugin_config();
void main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${PACKAGE_NAME}: ${message}`);
  process.exitCode = 1;
});
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || args.command === void 0) {
    printHelp();
    return;
  }
  const vaultDir = resolveVaultDir(args.vault ?? process.env.VAULT);
  switch (args.command) {
    case "sync-note": {
      if (args.note === void 0) {
        throw new Error("Missing note path. Usage: wikipage-spine sync-note <note.md> --vault <vault>");
      }
      const { syncNote: syncNote2 } = await Promise.resolve().then(() => (init_sync_note(), sync_note_exports));
      const result = syncNote2({ vaultDir, note: args.note });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}
function parseArgs(argv) {
  const positional = [];
  let vault;
  let note;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === void 0) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--vault") {
      vault = readOptionValue(argv, index += 1, "--vault");
      continue;
    }
    if (arg.startsWith("--vault=")) {
      vault = arg.slice("--vault=".length);
      continue;
    }
    if (arg === "--note") {
      note = readOptionValue(argv, index += 1, "--note");
      continue;
    }
    if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }
  return {
    command: positional[0],
    vault,
    note: note ?? positional[1],
    help
  };
}
function readOptionValue(argv, index, name) {
  const value = argv[index];
  if (value === void 0 || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}
function printHelp() {
  console.log(`Usage:
  wikipage-spine sync-note <note.md> --vault <vault>
  VAULT=<vault> wikipage-spine sync-note <note.md>

Commands:
  sync-note   Synchronize one Markdown note through the installed Obsidian plugin settings.`);
}
//# sourceMappingURL=wikipage-spine.js.map