export const POSITION_STEP = 1000;
export const POSITION_MIN_GAP = 0.001;

export function nextPosition(currentMax: number | null | undefined): number {
  return (currentMax ?? 0) + POSITION_STEP;
}

export function positionBefore(firstPos: number): number {
  return firstPos - POSITION_STEP;
}

export function positionAfter(lastPos: number): number {
  return lastPos + POSITION_STEP;
}

export function positionBetween(before: number, after: number): number {
  return (before + after) / 2;
}

export function needsRenormalize(sortedPositions: number[]): boolean {
  for (let i = 1; i < sortedPositions.length; i++) {
    if (sortedPositions[i] - sortedPositions[i - 1] < POSITION_MIN_GAP) {
      return true;
    }
  }
  return false;
}

export function renormalize(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_STEP);
}

export interface PositionedItem {
  id: number;
  position: number;
}

export interface ReorderResult {
  newPosition: number;
  beforeId: number | null;
  afterId: number | null;
}

export function computeReorder(
  sortedSiblings: PositionedItem[],
  activeId: number,
  finalIndex: number,
): ReorderResult | null {
  if (sortedSiblings.length === 0) return null;
  const beforeNeighbor = finalIndex > 0 ? sortedSiblings[finalIndex - 1] : null;
  const afterNeighbor =
    finalIndex < sortedSiblings.length - 1
      ? sortedSiblings[finalIndex + 1]
      : null;

  let newPosition: number;
  if (beforeNeighbor && afterNeighbor) {
    newPosition = positionBetween(
      beforeNeighbor.position,
      afterNeighbor.position,
    );
  } else if (afterNeighbor) {
    newPosition = positionBefore(afterNeighbor.position);
  } else if (beforeNeighbor) {
    newPosition = positionAfter(beforeNeighbor.position);
  } else {
    const self = sortedSiblings.find((s) => s.id === activeId);
    if (!self) return null;
    newPosition = self.position;
  }

  return {
    newPosition,
    beforeId: beforeNeighbor?.id ?? null,
    afterId: afterNeighbor?.id ?? null,
  };
}

export function appendPosition(
  sortedSiblings: PositionedItem[],
): number {
  if (sortedSiblings.length === 0) return POSITION_STEP;
  return positionAfter(sortedSiblings[sortedSiblings.length - 1].position);
}
