export type Dimension = "work" | "life";
export type DDLType = "hard" | "soft";
export type Status = "active" | "completed" | "archived";
export type Quadrant = "Q1" | "Q2" | "Q3" | "Q4";

export interface Task {
  id: number;
  uuid: string;
  title: string;
  description: string | null;
  dimension: Dimension;
  subcategory_uuid: string | null;
  importance: 0 | 1;
  urgency: 0 | 1;
  position: number;
  ddl_type: DDLType | null;
  ddl_date: string | null;
  ddl_duration_days: number | null;
  ddl_set_at: string | null;
  status: Status;
  tags: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export interface NewTaskInput {
  title: string;
  description?: string | null;
  dimension: Dimension;
  subcategory_uuid?: string | null;
  importance: 0 | 1;
  urgency: 0 | 1;
  ddl_type?: DDLType | null;
  ddl_date?: string | null;
  ddl_duration_days?: number | null;
  ddl_set_at?: string | null;
  tags?: string[] | null;
}

// A user-customizable category. Top-level rows (parent_uuid === null) are the
// renamable "工作/生活" anchors; their `kind` is the stable enum value that
// tasks.dimension stores. Sub-categories hang off a top-level via parent_uuid
// and are referenced by tasks.subcategory_uuid.
export interface Category {
  id: number;
  uuid: string;
  parent_uuid: string | null;
  kind: Dimension;
  name: string;
  is_preset: 0 | 1;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const quadrantOf = (
  importance: 0 | 1,
  urgency: 0 | 1,
): Quadrant => {
  if (importance === 1 && urgency === 1) return "Q1";
  if (importance === 1 && urgency === 0) return "Q2";
  if (importance === 0 && urgency === 0) return "Q3";
  return "Q4";
};

export const flagsOfQuadrant = (
  q: Quadrant,
): { importance: 0 | 1; urgency: 0 | 1 } => {
  switch (q) {
    case "Q1":
      return { importance: 1, urgency: 1 };
    case "Q2":
      return { importance: 1, urgency: 0 };
    case "Q3":
      return { importance: 0, urgency: 0 };
    case "Q4":
      return { importance: 0, urgency: 1 };
  }
};

export const HARD_DDL_URGENT_THRESHOLD_DAYS = 3;

export function softDDLEndDate(task: Pick<Task, "ddl_set_at" | "ddl_duration_days">): Date | null {
  if (!task.ddl_set_at || task.ddl_duration_days == null) return null;
  const setAt = new Date(task.ddl_set_at);
  if (isNaN(setAt.getTime())) return null;
  const end = new Date(setAt);
  end.setDate(setAt.getDate() + task.ddl_duration_days);
  return end;
}

function daysUntilCalendar(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function effectiveUrgency(
  task: Pick<
    Task,
    "urgency" | "ddl_type" | "ddl_date" | "ddl_duration_days" | "ddl_set_at"
  >,
  today: Date = new Date(),
): 0 | 1 {
  if (task.urgency === 1) return 1;
  if (!task.ddl_type) return 0;

  if (task.ddl_type === "hard" && task.ddl_date) {
    const target = new Date(task.ddl_date);
    if (isNaN(target.getTime())) return 0;
    const daysLeft = daysUntilCalendar(today, target);
    return daysLeft <= HARD_DDL_URGENT_THRESHOLD_DAYS ? 1 : 0;
  }

  if (task.ddl_type === "soft") {
    const end = softDDLEndDate(task);
    if (!end || task.ddl_duration_days == null) return 0;
    const daysLeft = daysUntilCalendar(today, end);
    const threshold = Math.max(1, Math.ceil(task.ddl_duration_days * 0.1));
    return daysLeft <= threshold ? 1 : 0;
  }

  return 0;
}

export function effectiveQuadrant(
  task: Pick<
    Task,
    | "importance"
    | "urgency"
    | "ddl_type"
    | "ddl_date"
    | "ddl_duration_days"
    | "ddl_set_at"
  >,
  today: Date = new Date(),
): Quadrant {
  return quadrantOf(task.importance, effectiveUrgency(task, today));
}

export function isAutoPromoted(
  task: Pick<
    Task,
    | "urgency"
    | "ddl_type"
    | "ddl_date"
    | "ddl_duration_days"
    | "ddl_set_at"
  >,
  today: Date = new Date(),
): boolean {
  return task.urgency === 0 && effectiveUrgency(task, today) === 1;
}
