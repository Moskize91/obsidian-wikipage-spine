import type { SurfaceMatch } from "../surface-matcher";

export interface SurfaceScanner {
  scan(chunks: Iterable<string>): Iterable<SurfaceMatch>;
}

export interface NoteMentionOptions {
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
  | "fenced_code"
  | "inline_code"
  | "html"
  | "html_comment"
  | "wikilink"
  | "markdown_link"
  | "markdown_image";

export interface TextSegment {
  chars: NormalizedViewChar[];
  text: string;
}

export interface PositionedSurfaceMatch {
  match: SurfaceMatch;
  text: string;
  segment: TextSegment;
  segmentStart: number;
  segmentEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface MatchCluster {
  segment: TextSegment;
  segmentStart: number;
  segmentEnd: number;
  sourceStart: number;
  sourceEnd: number;
  matches: PositionedSurfaceMatch[];
}

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
  resolvedEid?: string;
}
