export interface EntityColorValue {
  anchorId: number;
  distance: number;
}

export const ENTITY_FLAG_DISAMBIGUATION = 1;

const VETO_NEGATIVE_ANCHOR_IDS = new Set<number>([
  15, // Wikimedia disambiguation page
  16, // part of speech
  17, // grammeme
  21, // punctuation mark
]);

const VETO_NEGATIVE_MAX_DISTANCE = 2;
const MIN_SURVIVAL_SCORE = 0;

const POSITIVE_ANCHOR_WEIGHTS = new Map<number, number>([
  [0, 1], // human
  [1, 4], // academic discipline
  [2, 4], // specialty
  [3, 5], // academic major
  [4, 5], // religious concept
  [5, 6], // philosophical concept
  [6, 5], // school of thought
  [7, 1], // term
  [8, 3], // technical term
  [9, 6], // religious text
  [10, 2], // publication
  [11, 1], // written work
  [12, 4], // literary work
  [13, 2], // organization
  [14, 5], // university
]);

const NEGATIVE_ANCHOR_WEIGHTS = new Map<number, number>([
  [18, 4], // linguistic unit
  [19, 5], // word
  [20, 4], // sign
  [22, 3], // type
  [23, 3], // class
  [24, 3], // type of work
  [25, 3], // type of event
  [26, 3], // type of process
]);

export function shouldReportEntity(input: {
  flags: number;
  colors: Iterable<EntityColorValue>;
}): boolean {
  if ((input.flags & ENTITY_FLAG_DISAMBIGUATION) !== 0) {
    return false;
  }

  let score = 0;
  let hasScoredColor = false;
  for (const color of input.colors) {
    if (
      VETO_NEGATIVE_ANCHOR_IDS.has(color.anchorId) &&
      color.distance <= VETO_NEGATIVE_MAX_DISTANCE
    ) {
      return false;
    }

    const value = colorScore(color);
    if (value !== 0) {
      hasScoredColor = true;
      score += value;
    }
  }

  // 一票否决之外进入生存竞争：必须有微弱正向优势，零提示词和正负刚好抵消都不自动召唤。
  return hasScoredColor && score > MIN_SURVIVAL_SCORE;
}

function colorScore(color: EntityColorValue): number {
  const positiveWeight = POSITIVE_ANCHOR_WEIGHTS.get(color.anchorId);
  if (positiveWeight !== undefined) {
    return positiveWeight * distanceWeight(color.distance);
  }
  const negativeWeight = NEGATIVE_ANCHOR_WEIGHTS.get(color.anchorId);
  if (negativeWeight !== undefined) {
    return -negativeWeight * distanceWeight(color.distance);
  }
  return 0;
}

function distanceWeight(distance: number): number {
  if (distance === 0) {
    return 1.5;
  }
  if (distance <= 1) {
    return 1;
  }
  if (distance <= 2) {
    return 0.7;
  }
  if (distance <= 4) {
    return 0.35;
  }
  return 0.15;
}
