import { useEffect, useRef, useState } from "react";
import { Task, Quadrant, Dimension, quadrantOf } from "@/types";
import { QuadrantBoard } from "@/components/QuadrantBoard";
import { TaskForm, PendingPrefill } from "@/components/TaskForm";
import { ArchiveView } from "@/components/ArchiveView";
import { CalendarView } from "@/components/CalendarView";
import { PendingView } from "@/components/PendingView";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FocusTimer } from "@/components/FocusTimer";
import {
  exportAll,
  importTasks,
  ExportPayload,
  PendingItem,
  countPending,
  triagePendingToTask,
} from "@/lib/db";

type DimFilter = Dimension | "all";
type View = "board" | "calendar" | "archive" | "pending";

const VIEW_LABELS: Record<View, string> = {
  board: "看板",
  calendar: "日历",
  archive: "归档",
  pending: "待定",
};

function App() {
  const [view, setView] = useState<View>("board");
  const [dimension, setDimension] = useState<DimFilter>("all");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [defaultQ, setDefaultQ] = useState<Quadrant>("Q2");
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<ExportPayload | null>(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [triagePrefill, setTriagePrefill] = useState<PendingPrefill | null>(null);
  const [triagingPendingId, setTriagingPendingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    countPending().then(setPendingCount).catch(() => {});
  }, [refreshKey]);

  const clearTriage = () => {
    setTriagingPendingId(null);
    setTriagePrefill(null);
  };

  const handleTriage = (item: PendingItem) => {
    setTriagingPendingId(item.id);
    setTriagePrefill({
      title: item.guess_title,
      description: item.guess_description,
      dimension: item.guess_dimension,
      quadrant:
        item.guess_importance != null && item.guess_urgency != null
          ? quadrantOf(item.guess_importance, item.guess_urgency)
          : null,
      ddlType: item.guess_ddl_type ?? "none",
      ddlDate: item.guess_ddl_date,
      ddlDurationDays: item.guess_ddl_duration_days,
    });
    setEditingTask(null);
    setCreating(true);
  };

  const handleSaved = async (createdTask?: Task) => {
    if (triagingPendingId != null && createdTask) {
      try {
        await triagePendingToTask(triagingPendingId, createdTask.id);
      } catch (e) {
        showToast(`整理失败: ${String(e)}`);
      }
    }
    clearTriage();
    triggerRefresh();
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleNew = () => {
    clearTriage();
    setDefaultQ("Q2");
    setEditingTask(null);
    setCreating(true);
  };

  const handleNewInQuadrant = (q: Quadrant) => {
    clearTriage();
    setDefaultQ(q);
    setEditingTask(null);
    setCreating(true);
  };

  const handleExport = async () => {
    try {
      const payload = await exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `cadence-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`已导出 ${payload.tasks.length} 条任务`);
    } catch (e) {
      showToast(`导出失败: ${String(e)}`);
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as ExportPayload;
      if (!Array.isArray(payload.tasks)) {
        showToast("导入失败: 文件格式无效");
        return;
      }
      setPendingImport(payload);
    } catch (err) {
      showToast(`导入失败: ${String(err)}`);
    }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    const payload = pendingImport;
    setPendingImport(null);
    try {
      const { inserted, skipped } = await importTasks(payload);
      triggerRefresh();
      showToast(`导入完成: 新增 ${inserted},跳过 ${skipped}`);
    } catch (err) {
      showToast(`导入失败: ${String(err)}`);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !inEditable) {
        e.preventDefault();
        handleNew();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "e" &&
        !inEditable
      ) {
        e.preventDefault();
        setView((v) => (v === "board" ? "archive" : "board"));
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !inEditable &&
        ["1", "2", "3"].includes(e.key)
      ) {
        e.preventDefault();
        if (e.key === "1") setDimension("all");
        if (e.key === "2") setDimension("work");
        if (e.key === "3") setDimension("life");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t" && !inEditable) {
        e.preventDefault();
        setTimerOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const formOpen = creating || !!editingTask;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Cadence</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              个人任务管理 · 工作 × 生活 × 四象限
            </p>
          </div>
          <button
            onClick={() => setTimerOpen((v) => !v)}
            className={`hidden rounded border px-2.5 py-1 text-xs transition sm:block ${
              timerOpen
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
            title="心流计时 (⌘T)"
          >
            ⏱ 计时
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden rounded-lg bg-gray-100 p-0.5 sm:flex">
            {(["board", "calendar", "archive", "pending"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition ${
                  view === v
                    ? "bg-white font-medium shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title={`${VIEW_LABELS[v]} (⌘E 在看板/归档间切换)`}
              >
                {VIEW_LABELS[v]}
                {v === "pending" && pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-medium text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          {(view === "board" || view === "calendar") && (
            <div className="flex rounded-lg bg-gray-100 p-0.5">
              {(["all", "work", "life"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDimension(d)}
                  className={`rounded-md px-3 py-1 text-sm transition ${
                    dimension === d
                      ? "bg-white font-medium shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                  title={`${d === "all" ? "全部 ⌘1" : d === "work" ? "工作 ⌘2" : "生活 ⌘3"}`}
                >
                  {d === "all" ? "全部" : d === "work" ? "工作" : "生活"}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              className="hidden rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 sm:block"
              title="从 JSON 文件导入"
            >
              导入
            </button>
            <button
              onClick={handleExport}
              className="hidden rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 sm:block"
              title="导出全部任务为 JSON"
            >
              导出
            </button>
            <button
              onClick={handleNew}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
              title="新建任务 (⌘N)"
            >
              + 新建任务
            </button>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="flex-1 min-h-0 pb-[calc(56px+env(safe-area-inset-bottom))] sm:pb-0">
        {view === "board" && (
          <QuadrantBoard
            dimension={dimension}
            onEditTask={setEditingTask}
            onAddInQuadrant={handleNewInQuadrant}
            refreshKey={refreshKey}
          />
        )}
        {view === "calendar" && (
          <CalendarView
            dimension={dimension}
            onEditTask={setEditingTask}
            refreshKey={refreshKey}
          />
        )}
        {view === "archive" && (
          <ArchiveView refreshKey={refreshKey} onChanged={triggerRefresh} />
        )}
        {view === "pending" && (
          <PendingView
            refreshKey={refreshKey}
            onChanged={triggerRefresh}
            onTriage={handleTriage}
          />
        )}
      </div>

      <MobileTabBar
        view={view}
        pendingCount={pendingCount}
        timerOpen={timerOpen}
        onSelect={setView}
        onToggleTimer={() => setTimerOpen((v) => !v)}
      />

      <TaskForm
        open={formOpen}
        task={editingTask}
        defaultQuadrant={defaultQ}
        defaultDimension={dimension === "all" ? "work" : dimension}
        prefill={triagePrefill}
        onClose={() => {
          setCreating(false);
          setEditingTask(null);
          clearTriage();
        }}
        onSaved={handleSaved}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingImport}
        title="导入任务"
        message={`准备导入 ${pendingImport?.tasks.length ?? 0} 条任务,会追加到现有数据。\n继续吗？`}
        confirmLabel="导入"
        onConfirm={confirmImport}
        onCancel={() => setPendingImport(null)}
      />

      <FocusTimer open={timerOpen} onClose={() => setTimerOpen(false)} />
    </main>
  );
}

export default App;
