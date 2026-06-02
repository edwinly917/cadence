import { describe, it, expect } from "vitest";
import {
  formatDDL,
  isoWeekKey,
  weekRange,
  formatSoftDDL,
  softDurationLabel,
} from "./ddl";

describe("formatDDL", () => {
  const fixedToday = new Date(2026, 3, 27);

  it("returns '今天' when DDL is the same calendar day", () => {
    const result = formatDDL("2026-04-27", fixedToday);
    expect(result.label).toBe("今天");
    expect(result.daysFromNow).toBe(0);
  });

  it("returns '明天' for next-day DDL", () => {
    const result = formatDDL("2026-04-28", fixedToday);
    expect(result.label).toBe("明天");
    expect(result.daysFromNow).toBe(1);
  });

  it("returns '昨天逾期' for one day overdue", () => {
    const result = formatDDL("2026-04-26", fixedToday);
    expect(result.label).toBe("昨天逾期");
    expect(result.daysFromNow).toBe(-1);
  });

  it("formats N-day overdue correctly", () => {
    const result = formatDDL("2026-04-20", fixedToday);
    expect(result.label).toBe("逾期 7 天");
    expect(result.daysFromNow).toBe(-7);
  });

  it("formats short-future days as 'N 天后'", () => {
    const result = formatDDL("2026-05-02", fixedToday);
    expect(result.label).toBe("5 天后");
    expect(result.daysFromNow).toBe(5);
  });

  it("uses MM-DD format for far-future DDL (>7 days)", () => {
    const result = formatDDL("2026-06-15", fixedToday);
    expect(result.label).toBe("06-15");
    expect(result.daysFromNow).toBe(49);
  });

  it("ignores time component, only compares calendar dates", () => {
    const result = formatDDL("2026-04-27T23:59:59", fixedToday);
    expect(result.label).toBe("今天");
  });
});

describe("isoWeekKey", () => {
  it("produces YYYY-Www format", () => {
    const key = isoWeekKey("2026-04-27");
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("dates within same ISO week share the same key", () => {
    expect(isoWeekKey("2026-04-27")).toBe(isoWeekKey("2026-05-01"));
  });

  it("Sunday belongs to the same ISO week as the preceding Monday", () => {
    expect(isoWeekKey("2026-04-27")).toBe(isoWeekKey("2026-05-03"));
  });

  it("different weeks produce different keys", () => {
    expect(isoWeekKey("2026-04-27")).not.toBe(isoWeekKey("2026-05-04"));
  });
});

describe("softDurationLabel", () => {
  it("returns preset labels for known durations", () => {
    expect(softDurationLabel(7)).toBe("1周内");
    expect(softDurationLabel(14)).toBe("2周内");
    expect(softDurationLabel(30)).toBe("1个月内");
    expect(softDurationLabel(90)).toBe("3个月内");
  });

  it("falls back to '<n>个月内' when divisible by 30", () => {
    expect(softDurationLabel(60)).toBe("2个月内");
  });

  it("falls back to '<n>周内' when divisible by 7", () => {
    expect(softDurationLabel(21)).toBe("3周内");
  });

  it("falls back to '<n>天内' for arbitrary day counts", () => {
    expect(softDurationLabel(5)).toBe("5天内");
  });
});

describe("formatSoftDDL", () => {
  const today = new Date(2026, 3, 27);

  it("computes daysLeft and daysPassed for a 1-month task set 3 days ago", () => {
    const r = formatSoftDDL("2026-04-24T00:00:00Z", 30, today);
    expect(r.daysPassed).toBe(3);
    expect(r.daysLeft).toBe(27);
    expect(r.totalDays).toBe(30);
    expect(r.isOverdue).toBe(false);
    expect(r.durationLabel).toBe("1个月内");
  });

  it("flags isOverdue=true when end date has passed", () => {
    const r = formatSoftDDL("2026-03-01T00:00:00Z", 7, today);
    expect(r.isOverdue).toBe(true);
    expect(r.daysLeft).toBeLessThan(0);
  });

  it("returns 0 daysLeft on the last day", () => {
    const r = formatSoftDDL("2026-04-20T00:00:00Z", 7, today);
    expect(r.daysLeft).toBe(0);
    expect(r.daysPassed).toBe(7);
    expect(r.isOverdue).toBe(false);
  });
});

describe("weekRange", () => {
  it("returns Monday→Sunday range for a week key", () => {
    const { start, end } = weekRange("2026-W18");
    expect(start.getUTCDay()).toBe(1);
    expect(end.getUTCDay()).toBe(0);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(days).toBe(6);
  });

  it("round-trips through isoWeekKey", () => {
    const key = isoWeekKey("2026-04-27");
    const { start } = weekRange(key);
    const startIso = start.toISOString().slice(0, 10);
    expect(isoWeekKey(startIso)).toBe(key);
  });
});
