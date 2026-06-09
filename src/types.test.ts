import { describe, it, expect } from "vitest";
import {
  quadrantOf,
  flagsOfQuadrant,
  Quadrant,
  effectiveUrgency,
  effectiveQuadrant,
  isAutoPromoted,
  softDDLEndDate,
  Task,
} from "./types";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  uuid: "00000000-0000-4000-8000-000000000001",
  title: "t",
  description: null,
  dimension: "work",
  subcategory_uuid: null,
  importance: 1,
  urgency: 0,
  position: 1000,
  ddl_type: null,
  ddl_date: null,
  ddl_duration_days: null,
  ddl_set_at: null,
  status: "active",
  tags: null,
  created_at: "2026-04-01T00:00:00Z",
  completed_at: null,
  updated_at: "2026-04-01T00:00:00Z",
  deleted_at: null,
  ...overrides,
});

describe("quadrantOf (math convention: x=urgency, y=importance)", () => {
  it("maps (1, 1) to Q1 (top-right) 重要紧急", () => {
    expect(quadrantOf(1, 1)).toBe("Q1");
  });

  it("maps (1, 0) to Q2 (top-left) 重要不紧急", () => {
    expect(quadrantOf(1, 0)).toBe("Q2");
  });

  it("maps (0, 0) to Q3 (bottom-left) 不重要不紧急", () => {
    expect(quadrantOf(0, 0)).toBe("Q3");
  });

  it("maps (0, 1) to Q4 (bottom-right) 紧急不重要", () => {
    expect(quadrantOf(0, 1)).toBe("Q4");
  });
});

describe("flagsOfQuadrant", () => {
  it.each<[Quadrant, 0 | 1, 0 | 1]>([
    ["Q1", 1, 1],
    ["Q2", 1, 0],
    ["Q3", 0, 0],
    ["Q4", 0, 1],
  ])("converts %s back to importance=%d urgency=%d", (q, imp, urg) => {
    expect(flagsOfQuadrant(q)).toEqual({ importance: imp, urgency: urg });
  });
});

describe("quadrant round-trip", () => {
  it.each<Quadrant>(["Q1", "Q2", "Q3", "Q4"])(
    "%s round-trips through flagsOfQuadrant→quadrantOf",
    (q) => {
      const { importance, urgency } = flagsOfQuadrant(q);
      expect(quadrantOf(importance, urgency)).toBe(q);
    },
  );
});

describe("effectiveUrgency — hard DDL auto-promotion", () => {
  const today = new Date("2026-04-27T10:00:00Z");

  it("keeps stored urgency=1 as 1 regardless of DDL", () => {
    const t = baseTask({ urgency: 1, ddl_type: "hard", ddl_date: "2027-01-01" });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("returns 0 when no DDL set", () => {
    const t = baseTask({ urgency: 0 });
    expect(effectiveUrgency(t, today)).toBe(0);
  });

  it("promotes urgency to 1 when hard DDL is exactly 3 days away", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "hard",
      ddl_date: "2026-04-30",
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("promotes urgency to 1 when hard DDL is 1 day away", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "hard",
      ddl_date: "2026-04-28",
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("promotes urgency to 1 when hard DDL is overdue", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "hard",
      ddl_date: "2026-04-20",
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("does NOT promote when hard DDL is 4 days away", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "hard",
      ddl_date: "2026-05-01",
    });
    expect(effectiveUrgency(t, today)).toBe(0);
  });
});

describe("effectiveUrgency — soft DDL auto-promotion", () => {
  const today = new Date("2026-04-27T10:00:00Z");

  it("promotes when 1-week soft DDL has 1 day left (≥6 of 7 passed)", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-04-21T00:00:00Z",
      ddl_duration_days: 7,
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("does NOT promote when 1-week soft DDL has 2 days left", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-04-22T00:00:00Z",
      ddl_duration_days: 7,
    });
    expect(effectiveUrgency(t, today)).toBe(0);
  });

  it("promotes when 1-month soft DDL has 3 days left (≤ ceil(30*0.1)=3)", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-03-31T00:00:00Z",
      ddl_duration_days: 30,
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("does NOT promote when 1-month soft DDL has 5 days left", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-04-02T00:00:00Z",
      ddl_duration_days: 30,
    });
    expect(effectiveUrgency(t, today)).toBe(0);
  });

  it("promotes when 3-month soft DDL has 9 days left (≤ ceil(90*0.1)=9)", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-02-05T00:00:00Z",
      ddl_duration_days: 90,
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("promotes when soft DDL is overdue", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-03-01T00:00:00Z",
      ddl_duration_days: 30,
    });
    expect(effectiveUrgency(t, today)).toBe(1);
  });

  it("returns 0 when soft DDL is missing ddl_set_at", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: null,
      ddl_duration_days: 30,
    });
    expect(effectiveUrgency(t, today)).toBe(0);
  });
});

describe("effectiveQuadrant", () => {
  const today = new Date("2026-04-27T10:00:00Z");

  it("Q2 (重要不紧急) auto-promotes to Q1 when hard DDL ≤ 3 days", () => {
    const t = baseTask({
      importance: 1,
      urgency: 0,
      ddl_type: "hard",
      ddl_date: "2026-04-29",
    });
    expect(effectiveQuadrant(t, today)).toBe("Q1");
  });

  it("Q3 (不重要不紧急) auto-promotes to Q4 when soft DDL is near end", () => {
    const t = baseTask({
      importance: 0,
      urgency: 0,
      ddl_type: "soft",
      ddl_set_at: "2026-04-21T00:00:00Z",
      ddl_duration_days: 7,
    });
    expect(effectiveQuadrant(t, today)).toBe("Q4");
  });

  it("does not auto-demote when stored urgency is 1", () => {
    const t = baseTask({
      importance: 1,
      urgency: 1,
      ddl_type: "soft",
      ddl_set_at: "2026-04-25T00:00:00Z",
      ddl_duration_days: 90,
    });
    expect(effectiveQuadrant(t, today)).toBe("Q1");
  });
});

describe("isAutoPromoted", () => {
  const today = new Date("2026-04-27T10:00:00Z");

  it("is true when stored urgency=0 but effective=1", () => {
    const t = baseTask({
      urgency: 0,
      ddl_type: "hard",
      ddl_date: "2026-04-29",
    });
    expect(isAutoPromoted(t, today)).toBe(true);
  });

  it("is false when stored urgency=1", () => {
    const t = baseTask({
      urgency: 1,
      ddl_type: "hard",
      ddl_date: "2026-04-29",
    });
    expect(isAutoPromoted(t, today)).toBe(false);
  });

  it("is false when no DDL", () => {
    const t = baseTask({ urgency: 0 });
    expect(isAutoPromoted(t, today)).toBe(false);
  });
});

describe("softDDLEndDate", () => {
  it("computes end date by adding duration days", () => {
    const end = softDDLEndDate({
      ddl_set_at: "2026-04-01T00:00:00Z",
      ddl_duration_days: 30,
    });
    expect(end?.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("returns null when fields missing", () => {
    expect(softDDLEndDate({ ddl_set_at: null, ddl_duration_days: 30 })).toBeNull();
    expect(
      softDDLEndDate({ ddl_set_at: "2026-04-01T00:00:00Z", ddl_duration_days: null }),
    ).toBeNull();
  });
});
