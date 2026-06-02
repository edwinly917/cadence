import { useEffect, useState } from "react";
import { quadrantOf } from "@/types";
import { PendingItem, listPending, dismissPending } from "@/lib/db";

interface Props {
  refreshKey: number;
  onChanged: () => void;
  onTriage: (item: PendingItem) => void;
}

const Q_LABELS: Record<string, { label: string; cls: string }> = {
  Q1: { label: "重要紧急", cls: "bg-red-100 text-red-700" },
  Q2: { label: "重要不紧急", cls: "bg-blue-100 text-blue-700" },
  Q3: { label: "不重要不紧急", cls: "bg-gray-100 text-gray-600" },
  Q4: { label: "紧急不重要", cls: "bg-yellow-100 text-yellow-700" },
};

function guessQuadrantBadge(item: PendingItem) {
  if (item.guess_importance == null || item.guess_urgency == null) {
    return { label: "未分类", cls: "bg-gray-100 text-gray-400" };
  }
  return Q_LABELS[quadrantOf(item.guess_importance, item.guess_urgency)];
}

function guessDdlText(item: PendingItem): string | null {
  if (item.guess_ddl_type === "hard" && item.guess_ddl_date) {
    return `截止 ${item.guess_ddl_date.slice(0, 10)}`;
  }
  if (item.guess_ddl_type === "soft" && item.guess_ddl_duration_days != null) {
    return `软期限 ${item.guess_ddl_duration_days} 天`;
  }
  return null;
}

export function PendingView({ refreshKey, onChanged, onTriage }: Props) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const refresh = async () => {
    try {
      setError(null);
      setItems(await listPending());
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, [refreshKey]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDismiss = async (id: number) => {
    try {
      await dismissPending(id);
      await refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <p className="mb-4 text-xs text-gray-500">
        这些条目由飞书摄入,但无法明确分类或划定 DDL。补全重要/紧急/截止后整理入象限,或忽略。
      </p>
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
          待定收件箱是空的。飞书摄入的无法归类条目会出现在这里。
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const badge = guessQuadrantBadge(item);
            const ddl = guessDdlText(item);
            const isExpanded = expanded.has(item.id);
            return (
              <div
                key={item.id}
                className="group rounded-md border border-gray-200 bg-white px-3 py-2"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      {item.guess_dimension && (
                        <span className="text-xs text-gray-400">
                          {item.guess_dimension === "work" ? "工作" : "生活"}
                        </span>
                      )}
                      {ddl && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                          {ddl}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">
                        置信度 {Math.round(item.confidence * 100)}%
                      </span>
                    </div>

                    <div className="mt-1 break-words text-sm font-medium text-gray-800">
                      {item.guess_title}
                    </div>
                    {item.guess_description && (
                      <div className="mt-0.5 break-words text-xs text-gray-500">
                        {item.guess_description}
                      </div>
                    )}

                    <div className="mt-1.5 text-xs text-gray-400">
                      <span>
                        来源:{item.source_chat_name ?? item.source_chat_id ?? item.source}
                        {item.source_sender ? ` · ${item.source_sender}` : ""}
                        {item.source_msg_ts ? ` · ${item.source_msg_ts.slice(0, 16)}` : ""}
                      </span>
                    </div>
                    <div
                      className={`mt-1 cursor-pointer rounded bg-gray-50 px-2 py-1 text-xs text-gray-600 ${
                        isExpanded ? "" : "line-clamp-2"
                      }`}
                      onClick={() => toggleExpand(item.id)}
                      title="点击展开/收起原文"
                    >
                      {item.raw_text}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 flex-col gap-2">
                    <button
                      onClick={() => onTriage(item)}
                      className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800"
                    >
                      整理入象限
                    </button>
                    <button
                      onClick={() => handleDismiss(item.id)}
                      className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      忽略
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
