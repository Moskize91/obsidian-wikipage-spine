import type { MentionConflict, ResolvedMention } from "./note-mentions";
import { normalizeObsidianView, type ViewTokenOptions } from "./view-tokens";

export interface NoteViewRenderOptions extends ViewTokenOptions {
  entityLinkTarget(eid: string): string | undefined;
}

export interface NoteViewMentions {
  resolved: readonly ResolvedMention[];
  conflicts: readonly MentionConflict[];
}

interface LinkReplacement {
  sourceStart: number;
  sourceEnd: number;
  text: string;
  eid: string;
}

export function renderNoteView(
  markdown: string,
  mentions: NoteViewMentions,
  options: NoteViewRenderOptions,
): string {
  const tokens = normalizeObsidianView(markdown, options);
  const replacements = selectLinkReplacements(mentions);
  const seenEids = new Set<string>();
  let output = "";
  let replacementIndex = 0;
  let consumedSourceEnd = -1;

  for (const token of tokens) {
    let current = replacements[replacementIndex];
    while (current !== undefined && current.sourceEnd <= token.sourceStart) {
      replacementIndex += 1;
      current = replacements[replacementIndex];
    }

    if (token.sourceEnd <= consumedSourceEnd) {
      continue;
    }

    if (token.kind === "special") {
      output += token.raw;
      current = replacements[replacementIndex];
      while (current !== undefined && current.sourceStart < token.sourceEnd) {
        replacementIndex += 1;
        current = replacements[replacementIndex];
      }
      if (token.syntax === "thematic_break") {
        seenEids.clear();
      }
      continue;
    }

    const replacement = replacements[replacementIndex];
    if (
      replacement !== undefined &&
      replacement.sourceStart === token.sourceStart
    ) {
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

function renderReplacement(
  replacement: LinkReplacement,
  seenEids: Set<string>,
  options: NoteViewRenderOptions,
): string {
  const target = options.entityLinkTarget(replacement.eid);
  if (target === undefined || seenEids.has(replacement.eid)) {
    return replacement.text;
  }
  return `[[${target}|${replacement.text}]]`;
}

function selectLinkReplacements(mentions: NoteViewMentions): LinkReplacement[] {
  const replacements = [
    ...mentions.resolved.map((mention) => ({
      sourceStart: mention.sourceStart,
      sourceEnd: mention.sourceEnd,
      text: mention.text,
      eid: mention.eid,
    })),
    ...mentions.conflicts.flatMap((conflict) => conflictReplacements(conflict)),
  ];

  return selectNonOverlapping(replacements).sort(
    (left, right) => left.sourceStart - right.sourceStart,
  );
}

function conflictReplacements(conflict: MentionConflict): LinkReplacement[] {
  const resolved = conflict.matches
    .filter((match) => match.resolvedEid !== undefined)
    .map((match) => ({
      sourceStart: match.sourceStart,
      sourceEnd: match.sourceEnd,
      text: match.text,
      eid: match.resolvedEid as string,
    }));
  if (resolved.length > 0) {
    return selectNonOverlapping(resolved).sort(
      (left, right) => left.sourceStart - right.sourceStart,
    );
  }

  // 冲突解决是高成本动作，未解决前只入库等待用户或 Agent 决策，不能把猜测写回 view。
  return [];
}

function selectNonOverlapping(
  replacements: readonly LinkReplacement[],
): LinkReplacement[] {
  const selected: LinkReplacement[] = [];
  for (const replacement of replacements) {
    if (selected.some((existing) => rangesOverlap(existing, replacement))) {
      continue;
    }
    selected.push(replacement);
  }
  return selected;
}

function rangesOverlap(left: LinkReplacement, right: LinkReplacement): boolean {
  return (
    left.sourceStart < right.sourceEnd && right.sourceStart < left.sourceEnd
  );
}
