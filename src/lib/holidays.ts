export type DayKind = "workday" | "weekend" | "holiday" | "makeup";

export interface DayInfo {
  kind: DayKind;
  name?: string;
}

interface HolidayEntry {
  date: string;
  name: string;
}

interface MakeupEntry {
  date: string;
}

const HOLIDAYS_2026: HolidayEntry[] = [
  { date: "2026-01-01", name: "元旦" },
  { date: "2026-01-02", name: "元旦" },
  { date: "2026-01-03", name: "元旦" },

  { date: "2026-02-15", name: "春节" },
  { date: "2026-02-16", name: "除夕" },
  { date: "2026-02-17", name: "春节" },
  { date: "2026-02-18", name: "春节" },
  { date: "2026-02-19", name: "春节" },
  { date: "2026-02-20", name: "春节" },
  { date: "2026-02-21", name: "春节" },
  { date: "2026-02-22", name: "春节" },
  { date: "2026-02-23", name: "春节" },

  { date: "2026-04-04", name: "清明" },
  { date: "2026-04-05", name: "清明" },
  { date: "2026-04-06", name: "清明" },

  { date: "2026-05-01", name: "劳动节" },
  { date: "2026-05-02", name: "劳动节" },
  { date: "2026-05-03", name: "劳动节" },
  { date: "2026-05-04", name: "劳动节" },
  { date: "2026-05-05", name: "劳动节" },

  { date: "2026-06-19", name: "端午" },
  { date: "2026-06-20", name: "端午" },
  { date: "2026-06-21", name: "端午" },

  { date: "2026-09-25", name: "中秋" },
  { date: "2026-09-26", name: "中秋" },
  { date: "2026-09-27", name: "中秋" },

  { date: "2026-10-01", name: "国庆" },
  { date: "2026-10-02", name: "国庆" },
  { date: "2026-10-03", name: "国庆" },
  { date: "2026-10-04", name: "国庆" },
  { date: "2026-10-05", name: "国庆" },
  { date: "2026-10-06", name: "国庆" },
  { date: "2026-10-07", name: "国庆" },
];

const MAKEUP_2026: MakeupEntry[] = [
  { date: "2026-01-04" },
  { date: "2026-02-14" },
  { date: "2026-02-28" },
  { date: "2026-05-09" },
  { date: "2026-09-20" },
  { date: "2026-10-10" },
];

const HOLIDAY_MAP: Map<string, string> = new Map(
  HOLIDAYS_2026.map((h) => [h.date, h.name]),
);
const MAKEUP_SET: Set<string> = new Set(MAKEUP_2026.map((m) => m.date));

const COVERED_YEARS: ReadonlySet<number> = new Set([2026]);

export function hasHolidayData(year: number): boolean {
  return COVERED_YEARS.has(year);
}

function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDayInfo(date: Date): DayInfo {
  const key = toKey(date);
  const holidayName = HOLIDAY_MAP.get(key);
  if (holidayName) return { kind: "holiday", name: holidayName };
  if (MAKEUP_SET.has(key)) return { kind: "makeup" };
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return { kind: "weekend" };
  return { kind: "workday" };
}

export function isWorkday(date: Date): boolean {
  const info = getDayInfo(date);
  return info.kind === "workday" || info.kind === "makeup";
}
