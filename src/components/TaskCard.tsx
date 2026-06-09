import { Task, isAutoPromoted } from "@/types";
import { formatDDL, formatSoftDDL } from "@/lib/ddl";
import { useCategories } from "@/lib/categoriesContext";

interface Props {
  task: Task;
  onClick: () => void;
  onComplete: () => void;
}

export function TaskCard({ task, onClick, onComplete }: Props) {
  const { subLabel } = useCategories();
  const subName = subLabel(task.subcategory_uuid);
  const isHard = task.ddl_type === "hard";
  const isSoft = task.ddl_type === "soft";
  const hardDDL = isHard && task.ddl_date ? formatDDL(task.ddl_date) : null;
  const softDDL =
    isSoft && task.ddl_set_at && task.ddl_duration_days != null
      ? formatSoftDDL(task.ddl_set_at, task.ddl_duration_days)
      : null;
  const promoted = isAutoPromoted(task);

  const hardOverdue = hardDDL && hardDDL.daysFromNow < 0;
  const hardUrgent =
    hardDDL && hardDDL.daysFromNow >= 0 && hardDDL.daysFromNow <= 3;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-2 transition hover:border-gray-400 hover:shadow-sm"
    >
      <div className="flex items-start gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onComplete();
          }}
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border border-gray-300 transition hover:border-green-500 hover:bg-green-50"
          aria-label="标记完成"
          title="标记完成"
        />
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm leading-snug text-gray-900">
            {task.title}
          </div>
          {subName && (
            <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
              {subName}
            </span>
          )}
          {task.description && (
            <div className="mt-1 line-clamp-2 text-xs text-gray-500">
              {task.description}
            </div>
          )}
          {(hardDDL || softDDL || promoted) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
              {hardDDL && (
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                    hardOverdue
                      ? "bg-red-100 text-red-700"
                      : hardUrgent
                        ? "bg-orange-100 text-orange-700"
                        : "bg-gray-100 text-gray-700"
                  }`}
                >
                  ⏰ {hardDDL.label}
                </span>
              )}
              {softDDL && (
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                    softDDL.isOverdue
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                  title={`已过 ${softDDL.daysPassed}/${softDDL.totalDays} 天`}
                >
                  📅 {softDDL.durationLabel}
                  {softDDL.isOverdue
                    ? ` · 超期 ${-softDDL.daysLeft} 天`
                    : ` · 剩 ${softDDL.daysLeft} 天`}
                </span>
              )}
              {promoted && (
                <span
                  className="inline-flex items-center rounded bg-orange-50 px-1.5 py-0.5 text-orange-600"
                  title="临近期限,自动升级为紧急"
                >
                  ⚡ 临近
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
