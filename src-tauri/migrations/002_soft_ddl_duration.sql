ALTER TABLE tasks ADD COLUMN ddl_duration_days INTEGER;
ALTER TABLE tasks ADD COLUMN ddl_set_at TEXT;

UPDATE tasks
SET ddl_duration_days = CAST(
    (julianday(date(ddl_date)) - julianday(date(created_at))) AS INTEGER
  ),
    ddl_set_at = created_at
WHERE ddl_type = 'soft'
  AND ddl_date IS NOT NULL
  AND ddl_duration_days IS NULL;
