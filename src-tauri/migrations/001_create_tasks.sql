CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT,
  dimension     TEXT NOT NULL CHECK (dimension IN ('work', 'life')),
  importance    INTEGER NOT NULL CHECK (importance IN (0, 1)),
  urgency       INTEGER NOT NULL CHECK (urgency IN (0, 1)),
  position      REAL NOT NULL DEFAULT 1000,
  ddl_type      TEXT CHECK (ddl_type IN ('hard', 'soft')),
  ddl_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed', 'archived')),
  tags          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_dimension
  ON tasks(status, dimension);

CREATE INDEX IF NOT EXISTS idx_tasks_quadrant_position
  ON tasks(dimension, importance, urgency, position);

CREATE INDEX IF NOT EXISTS idx_tasks_ddl
  ON tasks(ddl_date) WHERE ddl_date IS NOT NULL;
