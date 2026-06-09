import { useEffect, useRef, useState } from "react";
import { Dimension } from "@/types";
import { useCategories } from "@/lib/categoriesContext";

export type DimFilter = Dimension | "all";

interface Props {
  dimension: DimFilter;
  subFilter: string | null;
  onChange: (dimension: DimFilter, subFilter: string | null) => void;
}

const KINDS: Dimension[] = ["work", "life"];

// 全部 | 工作▾ | 生活▾ — the caret opens a popover of that top-level's
// sub-categories ("全部工作" + each sub). Labels come from the live category
// tree so renames show up immediately.
export function DimensionFilter({ dimension, subFilter, onChange }: Props) {
  const { labelOf, subsOf } = useCategories();
  const [openKind, setOpenKind] = useState<Dimension | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openKind) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenKind(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openKind]);

  const activeSubName = (kind: Dimension) =>
    subsOf(kind).find((s) => s.uuid === subFilter)?.name;

  return (
    <div ref={ref} className="relative flex rounded-lg bg-gray-100 p-0.5">
      <button
        onClick={() => onChange("all", null)}
        className={`rounded-md px-3 py-1 text-sm transition ${
          dimension === "all"
            ? "bg-white font-medium shadow-sm"
            : "text-gray-600 hover:text-gray-900"
        }`}
        title="全部 ⌘1"
      >
        全部
      </button>

      {KINDS.map((kind, i) => {
        const subs = subsOf(kind);
        const selected = dimension === kind;
        const subName = selected ? activeSubName(kind) : undefined;
        const label = labelOf(kind);
        return (
          <div key={kind} className="relative flex items-center">
            <button
              onClick={() => onChange(kind, null)}
              className={`rounded-md py-1 pl-3 text-sm transition ${
                subs.length > 0 ? "pr-1" : "pr-3"
              } ${
                selected
                  ? "bg-white font-medium shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              title={`${label} ⌘${i + 2}`}
            >
              {label}
              {subName && (
                <span className="text-blue-600"> · {subName}</span>
              )}
            </button>
            {subs.length > 0 && (
              <button
                onClick={() =>
                  setOpenKind((k) => (k === kind ? null : kind))
                }
                className={`rounded-md px-1.5 py-1 text-xs transition ${
                  selected ? "text-gray-500" : "text-gray-400 hover:text-gray-700"
                }`}
                aria-label={`${label}子类`}
                title={`${label}子类`}
              >
                ▾
              </button>
            )}

            {openKind === kind && subs.length > 0 && (
              <div className="absolute left-0 top-full z-30 mt-1 min-w-[7rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    onChange(kind, null);
                    setOpenKind(null);
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                    selected && !subFilter ? "font-medium text-blue-700" : "text-gray-700"
                  }`}
                >
                  全部{label}
                </button>
                {subs.map((s) => (
                  <button
                    key={s.uuid}
                    onClick={() => {
                      onChange(kind, s.uuid);
                      setOpenKind(null);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                      subFilter === s.uuid
                        ? "font-medium text-blue-700"
                        : "text-gray-700"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
