export interface EntityColorValue {
  anchorId: number;
  distance: number;
}

export const ENTITY_FLAG_DISAMBIGUATION = 1;

const POSITIVE_ANCHOR_IDS = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
]);

const NEGATIVE_ANCHOR_IDS = new Set<number>([
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
]);

const MAX_POSITIVE_DISTANCE = 4;
const MAX_NEGATIVE_DISTANCE = 2;

export function shouldReportEntity(input: {
  flags: number;
  colors: Iterable<EntityColorValue>;
}): boolean {
  if ((input.flags & ENTITY_FLAG_DISAMBIGUATION) !== 0) {
    return false;
  }

  let hasPositive = false;
  for (const color of input.colors) {
    if (
      NEGATIVE_ANCHOR_IDS.has(color.anchorId) &&
      color.distance <= MAX_NEGATIVE_DISTANCE
    ) {
      return false;
    }
    if (
      POSITIVE_ANCHOR_IDS.has(color.anchorId) &&
      color.distance > 0 &&
      color.distance <= MAX_POSITIVE_DISTANCE
    ) {
      hasPositive = true;
    }
  }

  // 色卡没有命中正向锚点时，当前 sync 不自动写入；后续 investigate 通道会处理孤立实体。
  return hasPositive;
}
