import { describe, it, expect } from "vitest";
import {
  nextPosition,
  positionBefore,
  positionAfter,
  positionBetween,
  needsRenormalize,
  renormalize,
  appendPosition,
  computeReorder,
  POSITION_STEP,
  POSITION_MIN_GAP,
} from "./positioning";

describe("nextPosition", () => {
  it("returns POSITION_STEP for empty quadrant (null)", () => {
    expect(nextPosition(null)).toBe(POSITION_STEP);
  });

  it("returns POSITION_STEP for empty quadrant (undefined)", () => {
    expect(nextPosition(undefined)).toBe(POSITION_STEP);
  });

  it("returns max + STEP for non-empty quadrant", () => {
    expect(nextPosition(5000)).toBe(6000);
  });

  it("handles fractional max positions", () => {
    expect(nextPosition(1234.5)).toBe(2234.5);
  });
});

describe("positionBefore / positionAfter", () => {
  it("positionBefore subtracts STEP", () => {
    expect(positionBefore(2000)).toBe(1000);
  });

  it("positionAfter adds STEP", () => {
    expect(positionAfter(2000)).toBe(3000);
  });

  it("positionBefore can produce negatives — that's OK for ordering", () => {
    expect(positionBefore(500)).toBe(-500);
  });
});

describe("positionBetween (fractional indexing)", () => {
  it("returns midpoint of two positions", () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
  });

  it("can be applied repeatedly to insert in between", () => {
    let lo = 1000;
    const hi = 2000;
    const positions = [lo, hi];
    for (let i = 0; i < 5; i++) {
      const mid = positionBetween(lo, hi);
      positions.push(mid);
      lo = mid;
    }
    const sorted = [...positions].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBeGreaterThan(sorted[i - 1]);
    }
  });

  it("handles equal positions (degenerate case) by returning the same value", () => {
    expect(positionBetween(1000, 1000)).toBe(1000);
  });
});

describe("needsRenormalize", () => {
  it("returns false for well-spaced positions", () => {
    expect(needsRenormalize([1000, 2000, 3000])).toBe(false);
  });

  it("returns false for empty/single arrays", () => {
    expect(needsRenormalize([])).toBe(false);
    expect(needsRenormalize([1000])).toBe(false);
  });

  it("returns true when adjacent gap shrinks below threshold", () => {
    const tooClose = POSITION_MIN_GAP / 2;
    expect(needsRenormalize([1000, 1000 + tooClose])).toBe(true);
  });

  it("returns false when gap is comfortably above threshold", () => {
    expect(needsRenormalize([1000, 1000 + POSITION_MIN_GAP * 10])).toBe(false);
  });

  it("detects collapse caused by repeated midpoint splits", () => {
    let lo = 1000;
    const hi = 2000;
    const positions = [lo, hi];
    for (let i = 0; i < 60; i++) {
      const mid = positionBetween(lo, hi);
      positions.push(mid);
      lo = mid;
    }
    expect(needsRenormalize([...positions].sort((a, b) => a - b))).toBe(true);
  });
});

describe("renormalize", () => {
  it("produces evenly spaced positions starting at STEP", () => {
    expect(renormalize(3)).toEqual([1000, 2000, 3000]);
  });

  it("produces empty array for count=0", () => {
    expect(renormalize(0)).toEqual([]);
  });
});

describe("appendPosition", () => {
  it("returns POSITION_STEP for empty list", () => {
    expect(appendPosition([])).toBe(POSITION_STEP);
  });

  it("returns last + STEP for non-empty list", () => {
    expect(
      appendPosition([
        { id: 1, position: 1000 },
        { id: 2, position: 2500 },
      ]),
    ).toBe(3500);
  });
});

describe("computeReorder", () => {
  const items = [
    { id: 1, position: 1000 },
    { id: 2, position: 2000 },
    { id: 3, position: 3000 },
    { id: 4, position: 4000 },
  ];

  it("returns null for empty list", () => {
    expect(computeReorder([], 1, 0)).toBeNull();
  });

  it("dragging to first slot uses positionBefore (afterId only)", () => {
    const moved = [
      { id: 4, position: 4000 },
      { id: 1, position: 1000 },
      { id: 2, position: 2000 },
      { id: 3, position: 3000 },
    ];
    const result = computeReorder(moved, 4, 0);
    expect(result).toEqual({
      newPosition: 0,
      beforeId: null,
      afterId: 1,
    });
  });

  it("dragging to last slot uses positionAfter (beforeId only)", () => {
    const moved = [
      { id: 2, position: 2000 },
      { id: 3, position: 3000 },
      { id: 4, position: 4000 },
      { id: 1, position: 1000 },
    ];
    const result = computeReorder(moved, 1, 3);
    expect(result).toEqual({
      newPosition: 5000,
      beforeId: 4,
      afterId: null,
    });
  });

  it("dragging to middle uses midpoint of neighbors", () => {
    const moved = [
      { id: 1, position: 1000 },
      { id: 4, position: 4000 },
      { id: 2, position: 2000 },
      { id: 3, position: 3000 },
    ];
    const result = computeReorder(moved, 4, 1);
    expect(result).toEqual({
      newPosition: 1500,
      beforeId: 1,
      afterId: 2,
    });
  });

  it("single-item list returns the item's own position", () => {
    const result = computeReorder([{ id: 1, position: 1234 }], 1, 0);
    expect(result?.newPosition).toBe(1234);
    expect(result?.beforeId).toBeNull();
    expect(result?.afterId).toBeNull();
  });

  it("preserves ordering when dragging task between adjacent positions", () => {
    expect(items[1].position).toBe(2000);
    const result = computeReorder(
      [
        { id: 2, position: 2000 },
        { id: 4, position: 4000 },
        { id: 3, position: 3000 },
      ],
      4,
      1,
    );
    expect(result?.newPosition).toBeGreaterThan(2000);
    expect(result?.newPosition).toBeLessThan(3000);
  });
});
