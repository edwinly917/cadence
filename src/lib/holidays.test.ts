import { describe, it, expect } from "vitest";
import { getDayInfo, isWorkday, hasHolidayData } from "./holidays";

describe("getDayInfo — 2026 holidays", () => {
  it("元旦 2026-01-01 is holiday", () => {
    expect(getDayInfo(new Date(2026, 0, 1))).toEqual({
      kind: "holiday",
      name: "元旦",
    });
  });

  it("春节 2026-02-17 (正月初一) is holiday", () => {
    expect(getDayInfo(new Date(2026, 1, 17))).toEqual({
      kind: "holiday",
      name: "春节",
    });
  });

  it("除夕 2026-02-16 is named 除夕", () => {
    expect(getDayInfo(new Date(2026, 1, 16))).toEqual({
      kind: "holiday",
      name: "除夕",
    });
  });

  it("国庆 2026-10-01 is holiday", () => {
    expect(getDayInfo(new Date(2026, 9, 1))).toEqual({
      kind: "holiday",
      name: "国庆",
    });
  });
});

describe("getDayInfo — 2026 makeup workdays", () => {
  it("2026-02-14 (Saturday before 春节) is makeup", () => {
    expect(getDayInfo(new Date(2026, 1, 14))).toEqual({ kind: "makeup" });
  });

  it("2026-02-28 (Saturday after 春节) is makeup", () => {
    expect(getDayInfo(new Date(2026, 1, 28))).toEqual({ kind: "makeup" });
  });

  it("2026-09-20 (Sunday before 国庆) is makeup", () => {
    expect(getDayInfo(new Date(2026, 8, 20))).toEqual({ kind: "makeup" });
  });

  it("2026-10-10 (Saturday after 国庆) is makeup", () => {
    expect(getDayInfo(new Date(2026, 9, 10))).toEqual({ kind: "makeup" });
  });
});

describe("getDayInfo — fallback weekend / workday", () => {
  it("a regular Saturday is weekend", () => {
    expect(getDayInfo(new Date(2026, 6, 4))).toEqual({ kind: "weekend" });
  });

  it("a regular Sunday is weekend", () => {
    expect(getDayInfo(new Date(2026, 6, 5))).toEqual({ kind: "weekend" });
  });

  it("a regular Wednesday is workday", () => {
    expect(getDayInfo(new Date(2026, 6, 1))).toEqual({ kind: "workday" });
  });
});

describe("isWorkday", () => {
  it("returns true for makeup workday", () => {
    expect(isWorkday(new Date(2026, 1, 14))).toBe(true);
  });

  it("returns false for holiday", () => {
    expect(isWorkday(new Date(2026, 0, 1))).toBe(false);
  });

  it("returns false for weekend", () => {
    expect(isWorkday(new Date(2026, 6, 4))).toBe(false);
  });

  it("returns true for plain weekday", () => {
    expect(isWorkday(new Date(2026, 6, 1))).toBe(true);
  });
});

describe("hasHolidayData", () => {
  it("knows 2026", () => {
    expect(hasHolidayData(2026)).toBe(true);
  });

  it("does not know 2027 yet", () => {
    expect(hasHolidayData(2027)).toBe(false);
  });
});
