export interface DDLDisplay {
  label: string;
  daysFromNow: number;
}

export const SOFT_DURATION_PRESETS: { days: number; label: string }[] = [
  { days: 7, label: "1周内" },
  { days: 14, label: "2周内" },
  { days: 30, label: "1个月内" },
  { days: 90, label: "3个月内" },
];

export function softDurationLabel(days: number): string {
  const preset = SOFT_DURATION_PRESETS.find((p) => p.days === days);
  if (preset) return preset.label;
  if (days % 30 === 0) return `${days / 30}个月内`;
  if (days % 7 === 0) return `${days / 7}周内`;
  return `${days}天内`;
}

export interface SoftDDLDisplay {
  durationLabel: string;
  daysLeft: number;
  daysPassed: number;
  totalDays: number;
  isOverdue: boolean;
}

export function formatSoftDDL(
  setAt: string,
  durationDays: number,
  today: Date = new Date(),
): SoftDDLDisplay {
  const setDate = new Date(setAt);
  const endDate = new Date(setDate);
  endDate.setDate(setDate.getDate() + durationDays);
  const todayMid = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const setMid = new Date(
    setDate.getFullYear(),
    setDate.getMonth(),
    setDate.getDate(),
  );
  const endMid = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );
  const daysPassed = Math.round(
    (todayMid.getTime() - setMid.getTime()) / (1000 * 60 * 60 * 24),
  );
  const daysLeft = Math.round(
    (endMid.getTime() - todayMid.getTime()) / (1000 * 60 * 60 * 24),
  );
  return {
    durationLabel: softDurationLabel(durationDays),
    daysLeft,
    daysPassed,
    totalDays: durationDays,
    isOverdue: daysLeft < 0,
  };
}

export function formatDDL(dateStr: string, today: Date = new Date()): DDLDisplay {
  const target = new Date(dateStr);
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetMid = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );
  const diff = Math.round(
    (targetMid.getTime() - todayMid.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff === 0) return { label: "今天", daysFromNow: 0 };
  if (diff === 1) return { label: "明天", daysFromNow: 1 };
  if (diff === -1) return { label: "昨天逾期", daysFromNow: -1 };
  if (diff < 0) return { label: `逾期 ${-diff} 天`, daysFromNow: diff };
  if (diff <= 7) return { label: `${diff} 天后`, daysFromNow: diff };
  return { label: dateStr.slice(5, 10), daysFromNow: diff };
}

export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const target = new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function weekRange(weekKey: string): { start: Date; end: Date } {
  const [yearStr, weekStr] = weekKey.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}
