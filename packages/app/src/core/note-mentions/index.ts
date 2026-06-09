import { collectTextSegments, scanTextSegments } from "./mention-extractor";
import { buildMentions } from "./mention-cluster";
import { normalizeObsidianView } from "./view-normalizer";
import type {
  MentionConflict,
  NoteMentionOptions,
  ResolvedMention,
  SurfaceScanner,
} from "./types";

export { normalizeObsidianView } from "./view-normalizer";
export type {
  ConflictSurfaceMatch,
  MentionConflict,
  NormalizedViewChar,
  NormalizedViewSpecial,
  NormalizedViewToken,
  NoteMentionOptions,
  ResolvedMention,
  SpecialSyntax,
  SurfaceScanner,
} from "./types";

export function extractNoteMentions(
  markdown: string,
  scanner: SurfaceScanner,
  options: NoteMentionOptions,
): { resolved: ResolvedMention[]; conflicts: MentionConflict[] } {
  const tokens = normalizeObsidianView(markdown, options);
  const segments = collectTextSegments(tokens);
  const positionedMatches = scanTextSegments(segments, scanner);
  return buildMentions(positionedMatches);
}
