import { useEffect, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  Task,
  Quadrant,
  Dimension,
  flagsOfQuadrant,
  effectiveQuadrant,
} from "@/types";
import {
  listActive,
  completeTask,
  moveToQuadrant,
  reorderInQuadrant,
} from "@/lib/db";
import { appendPosition, computeReorder } from "@/lib/positioning";
import { TaskCard } from "./TaskCard";
import { SortableTaskCard } from "./SortableTaskCard";

const QUADRANT_META: Record<
  Quadrant,
  { label: string; subtitle: string; bg: string; border: string; text: string }
> = {
  Q1: {
    label: "重要紧急",
    subtitle: "立即处理",
    bg: "bg-red-50/60",
    border: "border-red-200",
    text: "text-red-700",
  },
  Q2: {
    label: "重要不紧急",
    subtitle: "持续投入",
    bg: "bg-blue-50/60",
    border: "border-blue-200",
    text: "text-blue-700",
  },
  Q3: {
    label: "不重要不紧急",
    subtitle: "考虑放弃",
    bg: "bg-gray-50",
    border: "border-gray-200",
    text: "text-gray-600",
  },
  Q4: {
    label: "紧急不重要",
    subtitle: "授权或快速处理",
    bg: "bg-yellow-50/60",
    border: "border-yellow-200",
    text: "text-yellow-700",
  },
};

const QUADRANTS: Quadrant[] = ["Q1", "Q2", "Q3", "Q4"];
const LAYOUT_ORDER: Quadrant[] = ["Q2", "Q1", "Q3", "Q4"];

interface Props {
  dimension: Dimension | "all";
  onEditTask: (task: Task) => void;
  onAddInQuadrant: (q: Quadrant) => void;
  refreshKey: number;
}

interface QuadrantSectionProps {
  quadrant: Quadrant;
  tasks: Task[];
  onAddInQuadrant: (q: Quadrant) => void;
  onEditTask: (task: Task) => void;
  onComplete: (id: number) => void;
}

function QuadrantSection({
  quadrant,
  tasks,
  onAddInQuadrant,
  onEditTask,
  onComplete,
}: QuadrantSectionProps) {
  const meta = QUADRANT_META[quadrant];
  const { setNodeRef, isOver } = useDroppable({
    id: quadrant,
    data: { type: "quadrant", quadrant },
  });

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg border sm:h-full ${meta.border} ${meta.bg} p-3 sm:p-4 transition ${
        isOver ? "ring-2 ring-blue-300" : ""
      }`}
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h3 className={`font-semibold ${meta.text}`}>{meta.label}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {meta.subtitle} · {tasks.length} 项
          </p>
        </div>
        <button
          onClick={() => onAddInQuadrant(quadrant)}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition hover:bg-white hover:text-gray-700"
          aria-label={`在「${meta.label}」添加任务`}
          title={`在「${meta.label}」添加任务`}
        >
          +
        </button>
      </header>
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 min-h-0 max-h-[45vh] space-y-2 overflow-y-auto pr-1 sm:max-h-none">
          {tasks.length === 0 ? (
            <p className="mt-2 text-xs italic text-gray-400">
              暂无任务,可拖拽其它任务到此或点击右上 + 添加
            </p>
          ) : (
            tasks.map((t) => (
              <SortableTaskCard
                key={t.id}
                task={t}
                onClick={() => onEditTask(t)}
                onComplete={() => onComplete(t.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export function QuadrantBoard({
  dimension,
  onEditTask,
  onAddInQuadrant,
  refreshKey,
}: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const refresh = async () => {
    try {
      setError(null);
      const data = await listActive(
        dimension === "all" ? undefined : dimension,
      );
      setTasks(data);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, [dimension, refreshKey]);

  const handleComplete = async (id: number) => {
    try {
      await completeTask(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const grouped = (q: Quadrant) =>
    tasks
      .filter((t) => effectiveQuadrant(t) === q)
      .sort((a, b) => a.position - b.position);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = Number(active.id);
    const sourceTask = tasks.find((t) => t.id === activeId);
    if (!sourceTask) return;
    const sourceQ = effectiveQuadrant(sourceTask);

    const overId = over.id;
    const overIsQuadrant =
      typeof overId === "string" &&
      (QUADRANTS as string[]).includes(overId);

    let targetQ: Quadrant;
    let overTask: Task | undefined;
    if (overIsQuadrant) {
      targetQ = overId as Quadrant;
    } else {
      overTask = tasks.find((t) => t.id === Number(overId));
      if (!overTask) return;
      targetQ = effectiveQuadrant(overTask);
    }

    if (sourceQ !== targetQ) {
      const { importance, urgency } = flagsOfQuadrant(targetQ);
      const targetSiblings = tasks
        .filter((t) => effectiveQuadrant(t) === targetQ)
        .sort((a, b) => a.position - b.position);
      const newPos = appendPosition(targetSiblings);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, importance, urgency, position: newPos } : t,
        ),
      );
      try {
        await moveToQuadrant(activeId, targetQ);
      } catch (e) {
        setError(String(e));
        refresh();
      }
      return;
    }

    if (!overTask || overTask.id === activeId) return;

    const siblings = tasks
      .filter((t) => effectiveQuadrant(t) === sourceQ)
      .sort((a, b) => a.position - b.position);
    const oldIndex = siblings.findIndex((t) => t.id === activeId);
    const newIndex = siblings.findIndex((t) => t.id === overTask!.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const reordered = arrayMove(siblings, oldIndex, newIndex);
    const finalIdx = reordered.findIndex((t) => t.id === activeId);
    const result = computeReorder(reordered, activeId, finalIdx);
    if (!result) return;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, position: result.newPosition } : t,
      ),
    );
    try {
      await reorderInQuadrant(activeId, result.beforeId, result.afterId);
    } catch (e) {
      setError(String(e));
      refresh();
    }
  };

  return (
    <div className="flex h-full flex-col p-3 sm:p-6">
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="relative flex-1 min-h-0 overflow-y-auto sm:overflow-visible">
          <div className="pointer-events-none absolute -top-2 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full text-xs text-gray-400 sm:block">
            ↑ 重要程度
          </div>
          <div className="pointer-events-none absolute -right-2 top-1/2 z-10 hidden translate-x-full -translate-y-1/2 text-xs text-gray-400 sm:block">
            紧急程度 →
          </div>
          <div className="grid grid-cols-1 gap-3 sm:h-full sm:grid-cols-2 sm:gap-4">
            {LAYOUT_ORDER.map((q) => (
              <QuadrantSection
                key={q}
                quadrant={q}
                tasks={grouped(q)}
                onAddInQuadrant={onAddInQuadrant}
                onEditTask={onEditTask}
                onComplete={handleComplete}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="rotate-1 opacity-90 shadow-lg">
              <TaskCard
                task={activeTask}
                onClick={() => {}}
                onComplete={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
