import { useEffect, useState } from "react";
import {
  Task,
  Dimension,
  DDLType,
  Quadrant,
  quadrantOf,
  flagsOfQuadrant,
} from "@/types";
import { addTask, updateTask, deleteTask } from "@/lib/db";
import { SOFT_DURATION_PRESETS, softDurationLabel } from "@/lib/ddl";
import { DatePicker } from "./DatePicker";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  open: boolean;
  task?: Task | null;
  defaultQuadrant?: Quadrant;
  defaultDimension?: Dimension;
  onClose: () => void;
  onSaved: () => void;
}

const QUADRANT_OPTIONS: {
  q: Quadrant;
  label: string;
  cls: string;
}[] = [
  {
    q: "Q2",
    label: "重要不紧急",
    cls: "border-blue-300 bg-blue-50 text-blue-700",
  },
  { q: "Q1", label: "重要紧急", cls: "border-red-300 bg-red-50 text-red-700" },
  {
    q: "Q3",
    label: "不重要不紧急",
    cls: "border-gray-300 bg-gray-100 text-gray-700",
  },
  {
    q: "Q4",
    label: "紧急不重要",
    cls: "border-yellow-300 bg-yellow-50 text-yellow-700",
  },
];

export function TaskForm({
  open,
  task,
  defaultQuadrant,
  defaultDimension,
  onClose,
  onSaved,
}: Props) {
  const editing = !!task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dimension, setDimension] = useState<Dimension>("work");
  const [quadrant, setQuadrant] = useState<Quadrant>("Q2");
  const [ddlType, setDdlType] = useState<DDLType | "none">("none");
  const [ddlDate, setDdlDate] = useState("");
  const [ddlDurationDays, setDdlDurationDays] = useState<number>(30);
  const [originalDurationDays, setOriginalDurationDays] = useState<number | null>(null);
  const [originalSetAt, setOriginalSetAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setDimension(task.dimension);
      setQuadrant(quadrantOf(task.importance, task.urgency));
      setDdlType((task.ddl_type ?? "none") as DDLType | "none");
      setDdlDate(task.ddl_date ? task.ddl_date.slice(0, 10) : "");
      setDdlDurationDays(task.ddl_duration_days ?? 30);
      setOriginalDurationDays(task.ddl_duration_days ?? null);
      setOriginalSetAt(task.ddl_set_at ?? null);
    } else {
      setTitle("");
      setDescription("");
      setDimension(defaultDimension ?? "work");
      setQuadrant(defaultQuadrant ?? "Q2");
      setDdlType("none");
      setDdlDate("");
      setDdlDurationDays(30);
      setOriginalDurationDays(null);
      setOriginalSetAt(null);
    }
  }, [task, open, defaultQuadrant, defaultDimension]);

  if (!open) return null;

  const canSave = title.trim().length > 0 && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const { importance, urgency } = flagsOfQuadrant(quadrant);
      const nowIso = new Date().toISOString();
      const durationChanged =
        ddlType === "soft" && ddlDurationDays !== originalDurationDays;
      const setAtToUse =
        ddlType === "soft"
          ? originalSetAt && !durationChanged
            ? originalSetAt
            : nowIso
          : null;
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        dimension,
        importance,
        urgency,
        ddl_type: ddlType === "none" ? null : ddlType,
        ddl_date: ddlType === "hard" ? ddlDate || null : null,
        ddl_duration_days: ddlType === "soft" ? ddlDurationDays : null,
        ddl_set_at: setAtToUse,
      };
      if (editing && task) {
        await updateTask(task.id, payload);
      } else {
        await addTask(payload);
      }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (!task) return;
    setConfirmingDelete(true);
  };

  const confirmDelete = async () => {
    if (!task) return;
    setConfirmingDelete(false);
    setBusy(true);
    try {
      await deleteTask(task.id);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold">
            {editing ? "编辑任务" : "新建任务"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="任务标题"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSave();
                }
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="可选,可写背景、思路、参考链接"
              className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              维度
            </label>
            <div className="flex gap-2">
              {(["work", "life"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDimension(d)}
                  className={`flex-1 rounded border px-3 py-1.5 text-sm transition ${
                    dimension === d
                      ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {d === "work" ? "工作" : "生活"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              象限
            </label>
            <div className="grid grid-cols-2 gap-2">
              {QUADRANT_OPTIONS.map((opt) => (
                <button
                  key={opt.q}
                  type="button"
                  onClick={() => setQuadrant(opt.q)}
                  className={`rounded border px-3 py-2 text-sm transition ${
                    quadrant === opt.q
                      ? `${opt.cls} font-medium`
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              截止日期
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { v: "none", l: "无" },
                  { v: "soft", l: "软期限" },
                  { v: "hard", l: "硬期限" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setDdlType(opt.v)}
                  className={`rounded border px-3 py-1.5 text-sm transition ${
                    ddlType === opt.v
                      ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.l}
                </button>
              ))}
              {ddlType === "hard" && (
                <DatePicker value={ddlDate} onChange={setDdlDate} />
              )}
            </div>
            {ddlType === "soft" && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {SOFT_DURATION_PRESETS.map((p) => (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => setDdlDurationDays(p.days)}
                      className={`rounded border px-3 py-1 text-xs transition ${
                        ddlDurationDays === p.days
                          ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
                          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>自定义</span>
                  <input
                    type="number"
                    min={1}
                    value={ddlDurationDays}
                    onChange={(e) =>
                      setDdlDurationDays(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span>天</span>
                  <span className="text-gray-400">
                    ({softDurationLabel(ddlDurationDays)})
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  接近期限尾段会自动升级为紧急（剩余 ≤ 总时长的 10%）
                </p>
              </div>
            )}
            {ddlType === "hard" && (
              <p className="mt-1 text-xs text-red-500">
                硬期限到期/逾期会高亮提醒,3 天内自动升级为紧急
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          {editing ? (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {editing ? "保存" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={confirmingDelete}
      title="删除任务"
      message={`确认删除「${task?.title ?? ""}」？`}
      confirmLabel="删除"
      destructive
      onConfirm={confirmDelete}
      onCancel={() => setConfirmingDelete(false)}
    />
    </>
  );
}
