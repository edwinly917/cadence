import { useEffect, useMemo, useState } from "react";
import { Task, quadrantOf } from "@/types";
import { listArchive, reactivateTask, deleteTask } from "@/lib/db";
import { isoWeekKey, weekRange } from "@/lib/ddl";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  refreshKey: number;
  onChanged: () => void;
}

const Q_LABELS: Record<string, { label: string; cls: string }> = {
  Q1: { label: "重要紧急", cls: "bg-red-100 text-red-700" },
  Q2: { label: "重要不紧急", cls: "bg-blue-100 text-blue-700" },
  Q3: { label: "不重要不紧急", cls: "bg-gray-100 text-gray-600" },
  Q4: { label: "紧急不重要", cls: "bg-yellow-100 text-yellow-700" },
};

function formatWeekTitle(weekKey: string): string {
  const { start, end } = weekRange(weekKey);
  const fmt = (d: Date) =>
    `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${weekKey} · ${fmt(start)} – ${fmt(end)}`;
}

export function ArchiveView({ refreshKey, onChanged }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      const data = await listArchive();
      setTasks(data);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, [refreshKey]);

  const byWeek = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const dateStr = t.completed_at ?? t.updated_at;
      const key = isoWeekKey(dateStr);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    const sortedKeys = [...map.keys()].sort().reverse();
    return sortedKeys.map((k) => ({
      weekKey: k,
      tasks: (map.get(k) ?? []).sort((a, b) =>
        (b.completed_at ?? b.updated_at).localeCompare(
          a.completed_at ?? a.updated_at,
        ),
      ),
    }));
  }, [tasks]);

  const handleReactivate = async (id: number) => {
    try {
      await reactivateTask(id);
      await refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = (task: Task) => {
    setPendingDelete(task);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteTask(target.id);
      await refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {byWeek.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
          还没有归档任务,完成的任务会出现在这里。
        </div>
      ) : (
        <div className="space-y-6">
          {byWeek.map(({ weekKey, tasks: weekTasks }) => (
            <section key={weekKey}>
              <header className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  {formatWeekTitle(weekKey)}
                </h3>
                <span className="text-xs text-gray-400">
                  {weekTasks.length} 项
                </span>
              </header>
              <div className="space-y-2">
                {weekTasks.map((t) => {
                  const q = quadrantOf(t.importance, t.urgency);
                  const meta = Q_LABELS[q];
                  return (
                    <div
                      key={t.id}
                      className="group flex items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${meta.cls}`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-xs text-gray-400">
                            {t.dimension === "work" ? "工作" : "生活"}
                          </span>
                          {t.completed_at && (
                            <span className="text-xs text-gray-400">
                              {t.completed_at.slice(0, 16)}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 break-words text-sm text-gray-800 line-through decoration-gray-300">
                          {t.title}
                        </div>
                        {t.description && (
                          <div className="mt-0.5 line-clamp-2 text-xs text-gray-400">
                            {t.description}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 gap-2 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={() => handleReactivate(t.id)}
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          恢复
                        </button>
                        <button
                          onClick={() => handleDelete(t)}
                          className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        title="永久删除任务"
        message={`确定永久删除「${pendingDelete?.title ?? ""}」？\n此操作不可撤销。`}
        confirmLabel="删除"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
