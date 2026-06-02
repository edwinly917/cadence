-- Provenance + dedupe on tasks (nullable so existing rows are untouched).
ALTER TABLE tasks ADD COLUMN source TEXT;            -- 'feishu' | 'manual' | NULL (legacy)
ALTER TABLE tasks ADD COLUMN source_ref TEXT;        -- 'feishu:<message_id>' or thread hash
ALTER TABLE tasks ADD COLUMN ingest_confidence REAL; -- 0..1 from the LLM, NULL if hand-made

-- Idempotent auto-file: never insert the same source message twice as a task.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_ref
  ON tasks(source_ref) WHERE source_ref IS NOT NULL;

-- The 待定 (pending) inbox: candidates the ingest pipeline could not fully classify.
CREATE TABLE IF NOT EXISTS pending_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- dedupe / idempotency
  dedupe_key        TEXT NOT NULL,

  -- raw source provenance (Feishu)
  source            TEXT NOT NULL DEFAULT 'feishu',
  source_chat_id    TEXT,
  source_chat_name  TEXT,
  source_message_id TEXT,
  source_sender     TEXT,
  source_msg_ts     TEXT,            -- ISO8601, derived from Feishu create_time (ms epoch)
  raw_text          TEXT NOT NULL,   -- the message text the candidate came from

  -- LLM guesses (all nullable — that is the whole point of 待定)
  guess_title       TEXT NOT NULL,
  guess_description TEXT,
  guess_dimension   TEXT CHECK (guess_dimension IN ('work', 'life')),
  guess_importance  INTEGER CHECK (guess_importance IN (0, 1)),
  guess_urgency     INTEGER CHECK (guess_urgency IN (0, 1)),
  guess_ddl_type    TEXT CHECK (guess_ddl_type IN ('hard', 'soft')),
  guess_ddl_date    TEXT,
  guess_ddl_duration_days INTEGER,
  confidence        REAL NOT NULL DEFAULT 0,  -- 0..1

  -- triage lifecycle
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'triaged', 'dismissed')),
  triaged_task_id   INTEGER,         -- tasks.id once accepted into a quadrant
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_dedupe
  ON pending_items(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_pending_status
  ON pending_items(status, created_at);
