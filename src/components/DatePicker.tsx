import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDayInfo, hasHolidayData } from "@/lib/holidays";
import { buildMonthGrid, sameDay, isoDate } from "@/lib/calendar";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const POPUP_WIDTH = 288;
const POPUP_HEIGHT = 340;
const VIEWPORT_MARGIN = 8;

function parseIso(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function DatePicker({ value, onChange, placeholder = "选择日期" }: Props) {
  const today = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseIso(value), [value]);
  const [viewYear, setViewYear] = useState(
    selected?.getFullYear() ?? today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    selected?.getMonth() ?? today.getMonth(),
  );
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && selected) {
      setViewYear(selected.getFullYear());
      setViewMonth(selected.getMonth());
    }
  }, [open, selected]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      let top = rect.bottom + 4;
      if (left + POPUP_WIDTH + VIEWPORT_MARGIN > vw) {
        left = Math.max(VIEWPORT_MARGIN, vw - POPUP_WIDTH - VIEWPORT_MARGIN);
      }
      if (top + POPUP_HEIGHT + VIEWPORT_MARGIN > vh) {
        top = Math.max(VIEWPORT_MARGIN, rect.top - POPUP_HEIGHT - 4);
      }
      setPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popupRef.current &&
        !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    onChange(isoDate(today));
    setOpen(false);
  };

  const handlePick = (d: Date) => {
    onChange(isoDate(d));
    setOpen(false);
  };

  const dataMissing = !hasHolidayData(viewYear);

  const triggerLabel = value || placeholder;
  const triggerCls = value ? "text-gray-800" : "text-gray-400";

  const popup = open && pos && (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="日期选择"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: POPUP_WIDTH,
      }}
      className="z-[60] rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrevMonth}
          aria-label="上个月"
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          ‹
        </button>
        <div className="text-sm font-medium text-gray-800">
          {viewYear} 年 {viewMonth + 1} 月
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          aria-label="下个月"
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-xs text-gray-400">
        {WEEK_LABELS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d) => {
          const inMonth = d.getMonth() === viewMonth;
          const info = getDayInfo(d);
          const isSelected = selected && sameDay(d, selected);
          const isToday = sameDay(d, today);
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;

          let textCls = "text-gray-700";
          if (!inMonth) textCls = "text-gray-300";
          else if (info.kind === "holiday") textCls = "text-red-600";
          else if (info.kind === "makeup") textCls = "text-orange-600";
          else if (isWeekend) textCls = "text-gray-400";

          const baseCls =
            "flex h-10 cursor-pointer flex-col items-center justify-center rounded text-xs transition";
          const stateCls = isSelected
            ? "bg-blue-500 text-white"
            : isToday
              ? "ring-1 ring-blue-400 hover:bg-gray-100"
              : "hover:bg-gray-100";
          const finalTextCls = isSelected ? "text-white" : textCls;

          const tag =
            info.kind === "holiday"
              ? info.name
              : info.kind === "makeup"
                ? "班"
                : null;

          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => handlePick(d)}
              title={info.name ?? (info.kind === "makeup" ? "调休补班" : "")}
              className={`${baseCls} ${stateCls} ${finalTextCls}`}
            >
              <span className="leading-tight">{d.getDate()}</span>
              {tag && (
                <span
                  className={`text-[10px] leading-tight ${
                    isSelected ? "text-white" : ""
                  }`}
                >
                  {tag}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={goToday}
          className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
        >
          今天
        </button>
        {dataMissing && (
          <span className="text-[10px] text-gray-400">
            {viewYear} 节假日数据待补充
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="选择日期"
        className={`rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 ${triggerCls}`}
      >
        📅 {triggerLabel}
      </button>
      {popup && createPortal(popup, document.body)}
    </>
  );
}
