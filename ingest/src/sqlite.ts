import Database from "better-sqlite3";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Dimension, DdlType } from "./types.js";

export interface TaskInsert {
  title: string;
  description: string | null;
  dimension: Dimension;
  importance: 0 | 1;
  urgency: 0 | 1;
  ddl_type: DdlType | null;
  ddl_date: string | null;
  ddl_duration_days: number | null;
  ddl_set_at: string | null;
  source_ref: string;
  ingest_confidence: number;
}

export interface PendingInsert {
  dedupe_key: string;
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
  guess_ddl_type: DdlType | null;
  guess_ddl_date: string | null;
  guess_ddl_duration_days: number | null;
  confidence: number;
}

export class CadenceDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(
        `找不到 cadence 数据库: ${dbPath}\n请先至少打开一次 Cadence 应用以创建并迁移数据库。`,
      );
    }
    this.db = new Database(dbPath, { timeout: 5000 });
    this.db.pragma("busy_timeout = 5000");
    // WAL is already enabled by the app; do NOT change journal mode here.
  }

  /**
   * Fail loudly if the app hasn't applied migration 003 yet. The CLI never
   * runs DDL — the Tauri app owns all migrations.
   */
  assertSchema(): void {
    const taskCols = new Set(
      (this.db.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name),
    );
    for (const col of ["source", "source_ref", "ingest_confidence"]) {
      if (!taskCols.has(col)) {
        throw new Error(
          `tasks 表缺少列 "${col}"。请先打开一次 Cadence 应用以运行 migration 003,再重试。`,
        );
      }
    }
    const hasPending = (
      this.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='pending_items'`,
        )
        .get() as { name: string } | undefined
    )?.name;
    if (!hasPending) {
      throw new Error(
        `缺少表 "pending_items"。请先打开一次 Cadence 应用以运行 migration 003,再重试。`,
      );
    }
  }

  /** A source_ref already auto-filed as a task? */
  taskExists(sourceRef: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM tasks WHERE source_ref = ? LIMIT 1`)
      .get(sourceRef);
  }

  /** A dedupe_key already in the pending inbox (any status)? */
  pendingExists(dedupeKey: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM pending_items WHERE dedupe_key = ? LIMIT 1`)
      .get(dedupeKey);
  }

  private nextPosition(
    dimension: Dimension,
    importance: 0 | 1,
    urgency: 0 | 1,
  ): number {
    const row = this.db
      .prepare(
        `SELECT MAX(position) AS m FROM tasks
          WHERE dimension = ? AND importance = ? AND urgency = ? AND status = 'active'`,
      )
      .get(dimension, importance, urgency) as { m: number | null };
    return row.m == null ? 1000 : row.m + 1000;
  }

  insertTask(t: TaskInsert): number {
    const pos = this.nextPosition(t.dimension, t.importance, t.urgency);
    const info = this.db
      .prepare(
        `INSERT INTO tasks
           (uuid, title, description, dimension, importance, urgency, position,
            ddl_type, ddl_date, ddl_duration_days, ddl_set_at,
            status, source, source_ref, ingest_confidence)
         VALUES (@uuid, @title, @description, @dimension, @importance, @urgency, @position,
            @ddl_type, @ddl_date, @ddl_duration_days, @ddl_set_at,
            'active', 'feishu', @source_ref, @ingest_confidence)`,
      )
      .run({ ...t, position: pos, uuid: randomUUID() });
    return Number(info.lastInsertRowid);
  }

  /** Insert a pending row; ON CONFLICT(dedupe_key) DO NOTHING. Returns true if inserted. */
  insertPending(p: PendingInsert): boolean {
    const info = this.db
      .prepare(
        `INSERT INTO pending_items
           (uuid, dedupe_key, source, source_chat_id, source_chat_name,
            source_message_id, source_sender, source_msg_ts, raw_text,
            guess_title, guess_description, guess_dimension,
            guess_importance, guess_urgency, guess_ddl_type,
            guess_ddl_date, guess_ddl_duration_days, confidence)
         VALUES (@uuid, @dedupe_key, 'feishu', @source_chat_id, @source_chat_name,
            @source_message_id, @source_sender, @source_msg_ts, @raw_text,
            @guess_title, @guess_description, @guess_dimension,
            @guess_importance, @guess_urgency, @guess_ddl_type,
            @guess_ddl_date, @guess_ddl_duration_days, @confidence)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run({ ...p, uuid: randomUUID() });
    return info.changes > 0;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
