import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import {
  Task,
  Quadrant,
  Dimension,
  DDLType,
  NewTaskInput,
  Category,
  flagsOfQuadrant,
} from "@/types";
import {
  nextPosition,
  positionBefore,
  positionAfter,
  positionBetween,
} from "./positioning";

const DB_URL = "sqlite:cadence.db";

// Minimal DB surface used across this module. Both the plugin-sql Database and
// the libSQL invoke-shim satisfy it, so call sites (db.select/db.execute) stay
// engine-agnostic.
export interface DbLike {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId: number }>;
}

// OFF by default — the app keeps using tauri-plugin-sql until the libSQL engine
// is runtime-verified. Flip with localStorage["cadence.useLibsql"] = "1".
function useLibsql(): boolean {
  try {
    return localStorage.getItem("cadence.useLibsql") === "1";
  } catch {
    return false;
  }
}

// plugin-sql uses $1/$2 placeholders; raw libSQL/SQLite wants ?1/?2.
function toLibsqlSql(sql: string): string {
  return sql.replace(/\$(\d+)/g, "?$1");
}

const libsqlShim: DbLike = {
  select: <T,>(sql: string, params: unknown[] = []) =>
    invoke<T>("db_select", { sql: toLibsqlSql(sql), params }),
  execute: (sql: string, params: unknown[] = []) =>
    invoke<{ rowsAffected: number; lastInsertId: number }>("db_execute", {
      sql: toLibsqlSql(sql),
      params,
    }),
};

let dbInstance: DbLike | null = null;

export async function getDb(): Promise<DbLike> {
  if (useLibsql()) return libsqlShim;
  if (!dbInstance) {
    dbInstance = (await Database.load(DB_URL)) as unknown as DbLike;
  }
  return dbInstance;
}

interface TaskRow {
  id: number;
  uuid: string;
  title: string;
  description: string | null;
  dimension: Dimension;
  subcategory_uuid: string | null;
  importance: number;
  urgency: number;
  position: number;
  ddl_type: "hard" | "soft" | null;
  ddl_date: string | null;
  ddl_duration_days: number | null;
  ddl_set_at: string | null;
  status: "active" | "completed" | "archived";
  tags: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  device_id: string | null;
  deleted_at: string | null;
}

const rowToTask = (r: TaskRow): Task => ({
  ...r,
  importance: (r.importance === 1 ? 1 : 0) as 0 | 1,
  urgency: (r.urgency === 1 ? 1 : 0) as 0 | 1,
});

async function nextPositionInQuadrant(
  db: DbLike,
  dimension: Dimension,
  importance: 0 | 1,
  urgency: 0 | 1,
  excludeId?: number,
): Promise<number> {
  const sql = excludeId
    ? `SELECT MAX(position) as max_pos FROM tasks
        WHERE dimension = $1 AND importance = $2 AND urgency = $3
          AND status = 'active' AND deleted_at IS NULL AND id != $4`
    : `SELECT MAX(position) as max_pos FROM tasks
        WHERE dimension = $1 AND importance = $2 AND urgency = $3
          AND status = 'active' AND deleted_at IS NULL`;
  const params = excludeId
    ? [dimension, importance, urgency, excludeId]
    : [dimension, importance, urgency];
  const rows = await db.select<{ max_pos: number | null }[]>(sql, params);
  return nextPosition(rows[0]?.max_pos);
}

export async function addTask(input: NewTaskInput): Promise<Task> {
  const db = await getDb();
  const nextPos = await nextPositionInQuadrant(
    db,
    input.dimension,
    input.importance,
    input.urgency,
  );
  const tagsJson = input.tags ? JSON.stringify(input.tags) : null;
  const uuid = crypto.randomUUID();

  const result = await db.execute(
    `INSERT INTO tasks
       (uuid, title, description, dimension, subcategory_uuid, importance, urgency, position,
        ddl_type, ddl_date, ddl_duration_days, ddl_set_at, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      uuid,
      input.title,
      input.description ?? null,
      input.dimension,
      input.subcategory_uuid ?? null,
      input.importance,
      input.urgency,
      nextPos,
      input.ddl_type ?? null,
      input.ddl_date ?? null,
      input.ddl_duration_days ?? null,
      input.ddl_set_at ?? null,
      tagsJson,
    ],
  );

  const rows = await db.select<TaskRow[]>(
    `SELECT * FROM tasks WHERE id = $1`,
    [result.lastInsertId],
  );
  return rowToTask(rows[0]);
}

export async function listActive(
  dimension?: Dimension,
  subcategoryUuid?: string | null,
): Promise<Task[]> {
  const db = await getDb();
  const where = ["status = 'active'", "deleted_at IS NULL"];
  const params: unknown[] = [];
  if (dimension) {
    params.push(dimension);
    where.push(`dimension = $${params.length}`);
  }
  if (subcategoryUuid) {
    params.push(subcategoryUuid);
    where.push(`subcategory_uuid = $${params.length}`);
  }
  const rows = await db.select<TaskRow[]>(
    `SELECT * FROM tasks
      WHERE ${where.join(" AND ")}
      ORDER BY importance DESC, urgency DESC, position ASC`,
    params,
  );
  return rows.map(rowToTask);
}

export async function listByQuadrant(
  dimension: Dimension,
  quadrant: Quadrant,
): Promise<Task[]> {
  const db = await getDb();
  const { importance, urgency } = flagsOfQuadrant(quadrant);
  const rows = await db.select<TaskRow[]>(
    `SELECT * FROM tasks
      WHERE status = 'active' AND deleted_at IS NULL AND dimension = $1
        AND importance = $2 AND urgency = $3
      ORDER BY position ASC`,
    [dimension, importance, urgency],
  );
  return rows.map(rowToTask);
}

export async function listArchive(): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    `SELECT * FROM tasks
      WHERE status IN ('completed', 'archived') AND deleted_at IS NULL
      ORDER BY completed_at DESC, updated_at DESC`,
  );
  return rows.map(rowToTask);
}

export async function completeTask(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tasks SET status = 'completed',
       completed_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = $1`,
    [id],
  );
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  // Soft delete (tombstone) so the deletion propagates across synced devices;
  // physical purge of old tombstones is left to a later GC step.
  await db.execute(
    `UPDATE tasks SET deleted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = $1`,
    [id],
  );
}

export interface ExportPayload {
  // v1: tasks only. v2: also carries the custom category tree + per-task
  // subcategory_uuid. Imports still accept v1 (no categories) for old files.
  version: 1 | 2;
  exportedAt: string;
  tasks: Task[];
  categories?: Category[];
}

export async function exportAll(): Promise<ExportPayload> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    `SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY id ASC`,
  );
  const categories = await db.select<Category[]>(
    `SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY id ASC`,
  );
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    tasks: rows.map(rowToTask),
    categories,
  };
}

export async function importTasks(
  payload: ExportPayload,
): Promise<{ inserted: number; skipped: number }> {
  if (payload.version !== 1 && payload.version !== 2) {
    throw new Error(`不支持的导出版本: ${payload.version}`);
  }
  const db = await getDb();

  // Upsert the category tree first so imported tasks can resolve their
  // subcategory_uuid. Renames win (the import is the user's intent); presets
  // are matched by their fixed uuid so they're updated, not duplicated.
  for (const c of payload.categories ?? []) {
    try {
      await db.execute(
        `INSERT INTO categories
           (uuid, parent_uuid, kind, name, is_preset, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT(uuid) DO UPDATE SET
           parent_uuid = excluded.parent_uuid,
           kind = excluded.kind,
           name = excluded.name,
           position = excluded.position,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
        [
          c.uuid,
          c.parent_uuid,
          c.kind,
          c.name,
          c.is_preset,
          c.position,
          c.created_at,
          c.updated_at,
        ],
      );
    } catch {
      // Non-fatal: a malformed category row shouldn't block task import.
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const t of payload.tasks) {
    try {
      await db.execute(
        `INSERT INTO tasks
           (uuid, title, description, dimension, subcategory_uuid, importance, urgency, position,
            ddl_type, ddl_date, ddl_duration_days, ddl_set_at,
            status, tags, created_at, completed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          t.uuid || crypto.randomUUID(),
          t.title,
          t.description,
          t.dimension,
          t.subcategory_uuid ?? null,
          t.importance,
          t.urgency,
          t.position,
          t.ddl_type,
          t.ddl_date,
          t.ddl_duration_days ?? null,
          t.ddl_set_at ?? null,
          t.status,
          t.tags,
          t.created_at,
          t.completed_at,
          t.updated_at,
        ],
      );
      inserted++;
    } catch {
      skipped++;
    }
  }
  return { inserted, skipped };
}

export async function reactivateTask(id: number): Promise<void> {
  const db = await getDb();
  const cur = await db.select<
    { dimension: Dimension; importance: number; urgency: number }[]
  >(`SELECT dimension, importance, urgency FROM tasks WHERE id = $1`, [id]);
  if (cur.length === 0) return;
  const newPos = await nextPositionInQuadrant(
    db,
    cur[0].dimension,
    (cur[0].importance ? 1 : 0) as 0 | 1,
    (cur[0].urgency ? 1 : 0) as 0 | 1,
    id,
  );
  await db.execute(
    `UPDATE tasks SET status = 'active',
       completed_at = NULL,
       position = $1,
       updated_at = datetime('now')
     WHERE id = $2`,
    [newPos, id],
  );
}

export async function moveToQuadrant(
  id: number,
  quadrant: Quadrant,
): Promise<void> {
  const db = await getDb();
  const { importance, urgency } = flagsOfQuadrant(quadrant);
  const dimRows = await db.select<{ dimension: Dimension }[]>(
    `SELECT dimension FROM tasks WHERE id = $1`,
    [id],
  );
  if (dimRows.length === 0) return;
  const newPos = await nextPositionInQuadrant(
    db,
    dimRows[0].dimension,
    importance,
    urgency,
    id,
  );
  await db.execute(
    `UPDATE tasks SET importance = $1, urgency = $2, position = $3,
       updated_at = datetime('now')
     WHERE id = $4`,
    [importance, urgency, newPos, id],
  );
}

export async function reorderInQuadrant(
  id: number,
  beforeId: number | null,
  afterId: number | null,
): Promise<void> {
  const db = await getDb();
  let newPos: number;

  if (beforeId === null && afterId !== null) {
    const after = await db.select<{ position: number }[]>(
      `SELECT position FROM tasks WHERE id = $1`,
      [afterId],
    );
    newPos = positionBefore(after[0].position);
  } else if (beforeId !== null && afterId === null) {
    const before = await db.select<{ position: number }[]>(
      `SELECT position FROM tasks WHERE id = $1`,
      [beforeId],
    );
    newPos = positionAfter(before[0].position);
  } else if (beforeId !== null && afterId !== null) {
    const rows = await db.select<{ id: number; position: number }[]>(
      `SELECT id, position FROM tasks WHERE id IN ($1, $2)`,
      [beforeId, afterId],
    );
    const before = rows.find((r) => r.id === beforeId);
    const after = rows.find((r) => r.id === afterId);
    if (!before || !after) return;
    newPos = positionBetween(before.position, after.position);
  } else {
    return;
  }

  await db.execute(
    `UPDATE tasks SET position = $1, updated_at = datetime('now') WHERE id = $2`,
    [newPos, id],
  );
}

// ---------------------------------------------------------------------------
// 待定 (pending) inbox — rows written by the Feishu ingest CLI that could not
// be auto-filed into a quadrant. The app lists them, lets the user triage one
// into a real task (手动三联入象限), or dismiss it.
// ---------------------------------------------------------------------------

export interface PendingItem {
  id: number;
  uuid: string;
  source: string;
  source_chat_id: string | null;
  source_chat_name: string | null;
  source_message_id: string | null;
  source_sender: string | null;
  source_msg_ts: string | null;
  raw_text: string;
  guess_title: string;
  guess_description: string | null;
  guess_dimension: Dimension | null;
  guess_importance: 0 | 1 | null;
  guess_urgency: 0 | 1 | null;
  guess_ddl_type: DDLType | null;
  guess_ddl_date: string | null;
  guess_ddl_duration_days: number | null;
  confidence: number;
  status: "pending" | "triaged" | "dismissed";
  triaged_task_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface PendingRow {
  id: number;
  uuid: string;
  source: string;
  source_chat_id: string | null;
  source_chat_name: string | null;
  source_message_id: string | null;
  source_sender: string | null;
  source_msg_ts: string | null;
  raw_text: string;
  guess_title: string;
  guess_description: string | null;
  guess_dimension: Dimension | null;
  guess_importance: number | null;
  guess_urgency: number | null;
  guess_ddl_type: "hard" | "soft" | null;
  guess_ddl_date: string | null;
  guess_ddl_duration_days: number | null;
  confidence: number;
  status: "pending" | "triaged" | "dismissed";
  triaged_task_id: number | null;
  created_at: string;
  updated_at: string;
  device_id: string | null;
  deleted_at: string | null;
}

const toBit = (v: number | null): 0 | 1 | null =>
  v == null ? null : ((v === 1 ? 1 : 0) as 0 | 1);

const rowToPending = (r: PendingRow): PendingItem => ({
  ...r,
  guess_importance: toBit(r.guess_importance),
  guess_urgency: toBit(r.guess_urgency),
});

export async function listPending(): Promise<PendingItem[]> {
  const db = await getDb();
  const rows = await db.select<PendingRow[]>(
    `SELECT * FROM pending_items
      WHERE status = 'pending' AND deleted_at IS NULL
      ORDER BY confidence DESC, created_at DESC`,
  );
  return rows.map(rowToPending);
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM pending_items WHERE status = 'pending' AND deleted_at IS NULL`,
  );
  return rows[0]?.n ?? 0;
}

export async function triagePendingToTask(
  pendingId: number,
  taskId: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pending_items
       SET status = 'triaged', triaged_task_id = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [taskId, pendingId],
  );
}

export async function dismissPending(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pending_items
       SET status = 'dismissed', updated_at = datetime('now')
     WHERE id = $1`,
    [id],
  );
}

export async function updateTask(
  id: number,
  patch: Partial<NewTaskInput>,
): Promise<void> {
  const db = await getDb();

  let positionValue: number | undefined;
  if (
    patch.importance !== undefined ||
    patch.urgency !== undefined ||
    patch.dimension !== undefined
  ) {
    const cur = await db.select<
      { dimension: Dimension; importance: number; urgency: number }[]
    >(`SELECT dimension, importance, urgency FROM tasks WHERE id = $1`, [id]);
    if (cur.length === 0) return;

    const newDim = patch.dimension ?? cur[0].dimension;
    const newImp = (patch.importance ?? cur[0].importance) as 0 | 1;
    const newUrg = (patch.urgency ?? cur[0].urgency) as 0 | 1;

    if (
      newImp !== cur[0].importance ||
      newUrg !== cur[0].urgency ||
      newDim !== cur[0].dimension
    ) {
      positionValue = await nextPositionInQuadrant(
        db,
        newDim,
        newImp,
        newUrg,
        id,
      );
    }
  }

  const setParts: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  const passthroughFields: Array<keyof NewTaskInput> = [
    "title",
    "description",
    "dimension",
    "subcategory_uuid",
    "ddl_type",
    "ddl_date",
    "ddl_duration_days",
    "ddl_set_at",
    "importance",
    "urgency",
  ];
  for (const k of passthroughFields) {
    if (patch[k] !== undefined) {
      setParts.push(`${k} = $${pi++}`);
      params.push(patch[k]);
    }
  }
  if (patch.tags !== undefined) {
    setParts.push(`tags = $${pi++}`);
    params.push(patch.tags ? JSON.stringify(patch.tags) : null);
  }
  if (positionValue !== undefined) {
    setParts.push(`position = $${pi++}`);
    params.push(positionValue);
  }

  if (setParts.length === 0) return;

  setParts.push(`updated_at = datetime('now')`);
  params.push(id);

  await db.execute(
    `UPDATE tasks SET ${setParts.join(", ")} WHERE id = $${pi}`,
    params,
  );
}
