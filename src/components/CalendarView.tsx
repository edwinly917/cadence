import { useEffect, useMemo, useState } from "react";
import { Task, Dimension, isAutoPromoted } from "@/types";
import { listActive } from "@/lib/db";
import { buildMonthGrid, sameDay, midnight } from "@/lib/calendar";
import { getDayInfo, hasHolidayData } from "@/lib/holidays";

const WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const SOFT_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-pink-100 text-pink-700",
  "bg-sky-100 text-sky-700",
  "bg-lime-100 text-lime-700",
  "bg-indigo-100 text-indigo-700",
] as const;

function softColor(taskId: number): string {
  return SOFT_PALETTE[Math.abs(taskId) % SOFT_PALETTE.length];
}

interface Props {
  dimension: Dimension | "all";
  subFilter?: string | null;
  onEditTask: (task: Task) => void;
  refreshKey: number;
}

interface DayBuckets {
  hard: Task[];
  softStart: Task[];
  softMiddle: Task[];
  softEnd: Task[];
  softSingle: Task[];
}

function softMarkedRange(task: Task): { markStart: Date; end: Date } | null {
  if (task.ddl_type !== "soft" || !task.ddl_set_at || task.ddl_duration_days == null) {
    return null;
  }
  const setAt = new Date(task.ddl_set_at);
  if (isNaN(setAt.getTime())) return null;
  const start = midnight(setAt);
  const end = new Date(start);
  end.setDate(start.getDate() + task.ddl_duration_days);
  const totalDays = task.ddl_duration_days + 1;
  const markedCount = Math.max(2, Math.ceil(totalDays * 0.3));
  const markStart = new Date(start);
  markStart.setDate(start.getDate() + Math.max(0, totalDays - markedCount));
  return { markStart: midnight(markStart), end: midnight(end) };
}

function rampOpacity(day: Date, markStart: Date, end: Date): string {
  const span = Math.round((end.getTime() - markStart.getTime()) / 86400000);
  if (span <= 0) return "opacity-100";
  const offset = Math.round((day.getTime() - markStart.getTime()) / 86400000);
  const ratio = offset / span;
  if (ratio < 0.2) return "opacity-50";
  if (ratio < 0.4) return "opacity-60";
  if (ratio < 0.6) return "opacity-75";
  if (ratio < 0.8) return "opacity-90";
  return "opacity-100";
}

function bucketTasks(day: Date, tasks: Task[]): DayBuckets {
  const hard: Task[] = [];
  const softStart: Task[] = [];
  const softMiddle: Task[] = [];
  const softEnd: Task[] = [];
  const softSingle: Task[] = [];

  for (const t of tasks) {
    if (t.ddl_type === "hard" && t.ddl_date) {
      const target = midnight(new Date(t.ddl_date));
      if (sameDay(target, day)) hard.push(t);
      continue;
    }
    const r = softMarkedRange(t);
    if (!r) continue;
    if (day < r.markStart || day > r.end) continue;
    const isStart = sameDay(day, r.markStart);
    const isEnd = sameDay(day, r.end);
    if (isStart && isEnd) softSingle.push(t);
    else if (isStart) softStart.push(t);
    else if (isEnd) softEnd.push(t);
    else softMiddle.push(t);
  }
  return { hard, softStart, softMiddle, softEnd, softSingle };
}

export function CalendarView({ dimension, subFilter = null, onEditTask, refreshKey }: Props) {
  const today = useMemo(() => midnight(new Date()), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setError(null);
        const data = await listActive(
          dimension === "all" ? undefined : dimension,
          subFilter,
        );
        if (active) setTasks(data);
      } catch (e) {
        if (active) setError(String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [dimension, subFilter, refreshKey]);

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const goPrevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goNextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const dataMissing = !hasHolidayData(viewYear);

  return (
    <div className="h-full overflow-y-auto p-6">
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrevMonth}
            aria-label="上个月"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            ‹
          </button>
          <div className="min-w-[8rem] text-center text-base font-semibold text-gray-800">
            {viewYear} 年 {viewMonth + 1} 月
          </div>
          <button
            type="button"
            onClick={goNextMonth}
            aria-label="下个月"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            ›
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            今天
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-red-600" /> 硬期限
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-blue-100" /> 软期限（后 30% 渐显）
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-orange-500" /> 临近自动升级
          </span>
          {dataMissing && (
            <span className="text-gray-400">{viewYear} 节假日数据待补充</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {WEEK_LABELS.map((w) => (
          <div
            key={w}
            className="border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-xs font-medium text-gray-500 last:border-r-0"
          >
            {w}
          </div>
        ))}
        {cells.map((d, idx) => {
          const inMonth = d.getMonth() === viewMonth;
          const dayInfo = getDayInfo(d);
          const isToday = sameDay(d, today);
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const buckets = bucketTasks(d, tasks);
          const allSoft = [
            ...buckets.softStart,
            ...buckets.softMiddle,
            ...buckets.softEnd,
            ...buckets.softSingle,
          ];

          let dateCls = "text-gray-700";
          if (!inMonth) dateCls = "text-gray-300";
          else if (dayInfo.kind === "holiday") dateCls = "text-red-600";
          else if (dayInfo.kind === "makeup") dateCls = "text-orange-600";
          else if (isWeekend) dateCls = "text-gray-400";

          const isLastCol = (idx + 1) % 7 === 0;
          const isLastRow = idx >= 35;

          return (
            <div
              key={d.toISOString()}
              className={`flex min-h-[100px] flex-col gap-0.5 border-gray-200 p-1.5 ${
                isLastCol ? "" : "border-r"
              } ${isLastRow ? "" : "border-b"} ${
                inMonth ? "bg-white" : "bg-gray-50"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={`text-sm font-medium ${dateCls} ${
                    isToday
                      ? "rounded bg-blue-500 px-1.5 leading-5 text-white"
                      : ""
                  }`}
                >
                  {d.getDate()}
                </span>
                {dayInfo.kind === "holiday" && inMonth && (
                  <span className="truncate text-[10px] text-red-500">
                    {dayInfo.name}
                  </span>
                )}
                {dayInfo.kind === "makeup" && inMonth && (
                  <span className="text-[10px] text-orange-500">班</span>
                )}
              </div>

              <div className="flex flex-col gap-0.5 overflow-hidden">
                {buckets.hard.map((t) => {
                  const promoted = isAutoPromoted(t);
                  return (
                    <button
                      key={`h-${t.id}`}
                      type="button"
                      onClick={() => onEditTask(t)}
                      title={t.title}
                      className={`truncate rounded bg-red-600 px-1 py-0.5 text-left text-[11px] font-semibold leading-tight text-white ${
                        promoted ? "ring-2 ring-red-300" : "ring-1 ring-red-700"
                      }`}
                    >
                      ⭐ {t.title}
                    </button>
                  );
                })}
                {allSoft.map((t) => {
                  const range = softMarkedRange(t);
                  const promoted = isAutoPromoted(t);
                  const isStart =
                    buckets.softStart.includes(t) || buckets.softSingle.includes(t);
                  const isEnd =
                    buckets.softEnd.includes(t) || buckets.softSingle.includes(t);
                  const radius =
                    isStart && isEnd
                      ? "rounded"
                      : isStart
                        ? "rounded-l"
                        : isEnd
                          ? "rounded-r"
                          : "";
                  const colorCls = promoted
                    ? "bg-orange-500 text-white font-semibold ring-1 ring-orange-700"
                    : `${softColor(t.id)} font-normal`;
                  const opacityCls =
                    promoted || !range ? "" : rampOpacity(d, range.markStart, range.end);
                  const prefix = promoted ? "⭐ " : isStart ? "📅 " : "";
                  return (
                    <button
                      key={`s-${t.id}`}
                      type="button"
                      onClick={() => onEditTask(t)}
                      title={t.title}
                      className={`truncate px-1 py-0.5 text-left text-[11px] leading-tight ${colorCls} ${opacityCls} ${radius}`}
                    >
                      {prefix}
                      {t.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
