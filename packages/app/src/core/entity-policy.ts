export interface EntityColorValue {
  anchorId: number;
  distance: number;
}

export const ENTITY_FLAG_DISAMBIGUATION = 1;

const POSITIVE_ANCHOR_MAX_DISTANCE = new Map<number, number>([
  [6, 2], // school of thought
  [8, 1], // technical term
  [9, 1], // religious text
  [12, 1], // literary work
  [14, 1], // university
]);

const NEGATIVE_ANCHOR_IDS = new Set<number>([
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
]);

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
    const maxPositiveDistance = POSITIVE_ANCHOR_MAX_DISTANCE.get(
      color.anchorId,
    );
    if (
      maxPositiveDistance !== undefined &&
      color.distance > 0 &&
      color.distance <= maxPositiveDistance
    ) {
      hasPositive = true;
    }
  }

  // 泛化锚点会把普通词带进来；自动写入只接受近距离、领域性明确的色卡证据。
  // 色卡没有命中正向锚点时，当前 sync 不自动写入；后续 investigate 通道会处理孤立实体。
  return hasPositive;
}
