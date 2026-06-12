import type { SurfaceMatch } from "../surface-matcher";
import type {
  NormalizedViewChar,
  NormalizedViewSpecial,
  NormalizedViewToken,
  SpecialSyntax,
} from "../view-tokens";

export type {
  NormalizedViewChar,
  NormalizedViewSpecial,
  NormalizedViewToken,
  SpecialSyntax,
} from "../view-tokens";

export interface SurfaceScanner {
  scan(chunks: Iterable<string>): Iterable<SurfaceMatch>;
}

export interface NoteMentionOptions {
  isEntityViewLinkTarget(target: string): boolean;
  resolveEntityViewLinkTarget?: (target: string) => string | undefined;
}

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
  wordBoundarySuspect: boolean;
  resolved: boolean;
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
  wordBoundarySuspect: boolean;
  resolvedEid?: string;
}
