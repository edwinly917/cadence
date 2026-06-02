import Database from "@tauri-apps/plugin-sql";
import {
  Task,
  Quadrant,
  Dimension,
  NewTaskInput,
  flagsOfQuadrant,
} from "@/types";
import {
  nextPosition,
  positionBefore,
  positionAfter,
  positionBetween,
} from "./positioning";

const DB_URL = "sqlite:cadence.db";
let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load(DB_URL);
  }
  return dbInstance;
}

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  dimension: Dimension;
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
}

const rowToTask = (r: TaskRow): Task => ({
  ...r,
  importance: (r.importance === 1 ? 1 : 0) as 0 | 1,
  urgency: (r.urgency === 1 ? 1 : 0) as 0 | 1,
});

async function nextPositionInQuadrant(
  db: Database,
  dimension: Dimension,
  importance: 0 | 1,
  urgency: 0 | 1,
  excludeId?: number,
): Promise<number> {
  const sql = excludeId
    ? `SELECT MAX(position) as max_pos FROM tasks
        WHERE dimension = $1 AND importance = $2 AND urgency = $3
          AND status = 'active' AND id != $4`
    : `SELECT MAX(position) as max_pos FROM tasks
        WHERE dimension = $1 AND importance = $2 AND urgency = $3
          AND status = 'active'`;
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

  const result = await db.execute(
    `INSERT INTO tasks
       (title, description, dimension, importance, urgency, position,
        ddl_type, ddl_date, ddl_duration_days, ddl_set_at, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.title,
      input.description ?? null,
      input.dimension,
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

export async function listActive(dimension?: Dimension): Promise<Task[]> {
  const db = await getDb();
  const rows = dimension
    ? await db.select<TaskRow[]>(
        `SELECT * FROM tasks
          WHERE status = 'active' AND dimension = $1
          ORDER BY importance DESC, urgency DESC, position ASC`,
        [dimension],
      )
    : await db.select<TaskRow[]>(
        `SELECT * FROM tasks
          WHERE status = 'active'
          ORDER BY importance DESC, urgency DESC, position ASC`,
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
      WHERE status = 'active' AND dimension = $1
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
      WHERE status IN ('completed', 'archived')
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
  await db.execute(`DELETE FROM tasks WHERE id = $1`, [id]);
}

export interface ExportPayload {
  version: 1;
  exportedAt: string;
  tasks: Task[];
}

export async function exportAll(): Promise<ExportPayload> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    `SELECT * FROM tasks ORDER BY id ASC`,
  );
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: rows.map(rowToTask),
  };
}

export async function importTasks(
  payload: ExportPayload,
): Promise<{ inserted: number; skipped: number }> {
  if (payload.version !== 1) {
    throw new Error(`不支持的导出版本: ${payload.version}`);
  }
  const db = await getDb();
  let inserted = 0;
  let skipped = 0;
  for (const t of payload.tasks) {
    try {
      await db.execute(
        `INSERT INTO tasks
           (title, description, dimension, importance, urgency, position,
            ddl_type, ddl_date, ddl_duration_days, ddl_set_at,
            status, tags, created_at, completed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          t.title,
          t.description,
          t.dimension,
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
