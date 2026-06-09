-- Customizable two-level categories. The top level keeps the stable
-- 'work'/'life' anchor (so tasks.dimension never has to migrate on rename);
-- a category row carries the user-editable display name. Sub-categories hang
-- off a top-level via parent_uuid. Tasks gain an optional subcategory_uuid leaf.
--
-- categories syncs for free: db_sync replicates the whole libSQL DB at the
-- frame level. The two presets use FIXED uuids so every device converges on the
-- same anchor rows instead of creating duplicates after a sync.

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid        TEXT NOT NULL UNIQUE,
  parent_uuid TEXT,                                  -- NULL = top-level anchor
  kind        TEXT NOT NULL CHECK (kind IN ('work', 'life')),
  name        TEXT NOT NULL,
  is_preset   INTEGER NOT NULL DEFAULT 0 CHECK (is_preset IN (0, 1)),
  position    REAL NOT NULL DEFAULT 1000,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_categories_alive
  ON categories(deleted_at, kind, parent_uuid, position);

-- Optional leaf sub-category for a task. NULL = filed directly under the
-- top-level dimension with no sub-division.
ALTER TABLE tasks ADD COLUMN subcategory_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_subcategory
  ON tasks(subcategory_uuid) WHERE subcategory_uuid IS NOT NULL;

-- Seed the two preset top-level anchors with stable, cross-device uuids.
INSERT OR IGNORE INTO categories (uuid, parent_uuid, kind, name, is_preset, position)
VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'work', '工作', 1, 1000),
  ('00000000-0000-4000-8000-000000000002', NULL, 'life', '生活', 1, 2000);
