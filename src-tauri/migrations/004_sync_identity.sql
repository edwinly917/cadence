-- Multi-device sync identity (Turso/libSQL). Stable UUIDs replace AUTOINCREMENT
-- id as the cross-device merge key; deleted_at tombstones let deletes propagate.
-- All columns nullable so existing rows are untouched until backfilled below.
ALTER TABLE tasks ADD COLUMN uuid TEXT;
ALTER TABLE tasks ADD COLUMN device_id TEXT;
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;

ALTER TABLE pending_items ADD COLUMN uuid TEXT;
ALTER TABLE pending_items ADD COLUMN device_id TEXT;
ALTER TABLE pending_items ADD COLUMN deleted_at TEXT;

-- Backfill v4-style UUIDs for existing rows (pure SQLite, no extension needed).
UPDATE tasks SET uuid =
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
WHERE uuid IS NULL;

UPDATE pending_items SET uuid =
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
WHERE uuid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_uuid ON tasks(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_uuid ON pending_items(uuid);

-- Reads filter on deleted_at; index the common "alive" lookups.
CREATE INDEX IF NOT EXISTS idx_tasks_alive
  ON tasks(status, deleted_at);
