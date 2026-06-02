import { describe, it, expect } from "vitest";
import { buildMonthGrid, sameDay, midnight, isoDate } from "./calendar";

describe("buildMonthGrid", () => {
  it("returns exactly 42 cells (6 rows × 7 cols)", () => {
    const cells = buildMonthGrid(2026, 3);
    expect(cells).toHaveLength(42);
  });

  it("starts on Monday (week-Monday-first convention)", () => {
    const cells = buildMonthGrid(2026, 3);
    expect(cells[0].getDay()).toBe(1);
  });

  it("includes the first day of the requested month", () => {
    const cells = buildMonthGrid(2026, 3);
    const aprilFirst = cells.find(
      (d) => d.getMonth() === 3 && d.getDate() === 1,
    );
    expect(aprilFirst).toBeDefined();
  });

  it("for April 2026 (1st is Wednesday) starts grid on Mar 30", () => {
    const cells = buildMonthGrid(2026, 3);
    expect(cells[0].getMonth()).toBe(2);
    expect(cells[0].getDate()).toBe(30);
  });

  it("for February 2026 (1st is Sunday) starts grid on Jan 26", () => {
    const cells = buildMonthGrid(2026, 1);
    expect(cells[0].getMonth()).toBe(0);
    expect(cells[0].getDate()).toBe(26);
  });
});

describe("sameDay", () => {
  it("returns true for same calendar day with different times", () => {
    expect(
      sameDay(new Date(2026, 3, 27, 9, 0), new Date(2026, 3, 27, 23, 30)),
    ).toBe(true);
  });

  it("returns false for adjacent days", () => {
    expect(sameDay(new Date(2026, 3, 27), new Date(2026, 3, 28))).toBe(false);
  });
});

describe("midnight", () => {
  it("zeros out time portion", () => {
    const d = midnight(new Date(2026, 3, 27, 14, 30, 45));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe("isoDate", () => {
  it("formats a date as YYYY-MM-DD with zero padding", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(isoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
