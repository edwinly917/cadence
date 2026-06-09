import { Category, Dimension } from "@/types";
import { getDb, DbLike } from "./db";
import { nextPosition } from "./positioning";

// Fixed, cross-device uuids for the two preset top-level anchors. Kept in sync
// with migration 005 so every device converges on the same rows.
export const PRESET_UUID: Record<Dimension, string> = {
  work: "00000000-0000-4000-8000-000000000001",
  life: "00000000-0000-4000-8000-000000000002",
};

const DEFAULT_PRESET_NAME: Record<Dimension, string> = {
  work: "工作",
  life: "生活",
};

interface CategoryRow {
  id: number;
  uuid: string;
  parent_uuid: string | null;
  kind: Dimension;
  name: string;
  is_preset: number;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const rowToCategory = (r: CategoryRow): Category => ({
  ...r,
  is_preset: (r.is_preset === 1 ? 1 : 0) as 0 | 1,
});

// Defensive seed: migration 005 already inserts the presets, but a libSQL
// replica created before that migration (or a partial sync) might be missing
// them. INSERT OR IGNORE keeps this idempotent and never clobbers a rename.
async function ensurePresets(db: DbLike): Promise<void> {
  for (const kind of ["work", "life"] as const) {
    await db.execute(
      `INSERT OR IGNORE INTO categories
         (uuid, parent_uuid, kind, name, is_preset, position)
       VALUES ($1, NULL, $2, $3, 1, $4)`,
      [
        PRESET_UUID[kind],
        kind,
        DEFAULT_PRESET_NAME[kind],
        kind === "work" ? 1000 : 2000,
      ],
    );
  }
}

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  await ensurePresets(db);
  const rows = await db.select<CategoryRow[]>(
    `SELECT * FROM categories
      WHERE deleted_at IS NULL
      ORDER BY kind ASC, (parent_uuid IS NOT NULL) ASC, position ASC`,
  );
  return rows.map(rowToCategory);
}

export async function renameCategory(uuid: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名称不能为空");
  const db = await getDb();
  await db.execute(
    `UPDATE categories SET name = $1, updated_at = datetime('now')
     WHERE uuid = $2`,
    [trimmed, uuid],
  );
}

export async function addSubcategory(
  kind: Dimension,
  name: string,
): Promise<Category> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名称不能为空");
  const db = await getDb();
  const rows = await db.select<{ max_pos: number | null }[]>(
    `SELECT MAX(position) AS max_pos FROM categories
      WHERE parent_uuid = $1 AND deleted_at IS NULL`,
    [PRESET_UUID[kind]],
  );
  const uuid = crypto.randomUUID();
  await db.execute(
    `INSERT INTO categories
       (uuid, parent_uuid, kind, name, is_preset, position)
     VALUES ($1, $2, $3, $4, 0, $5)`,
    [uuid, PRESET_UUID[kind], kind, trimmed, nextPosition(rows[0]?.max_pos)],
  );
  const created = await db.select<CategoryRow[]>(
    `SELECT * FROM categories WHERE uuid = $1`,
    [uuid],
  );
  return rowToCategory(created[0]);
}

// Soft-delete a sub-category and orphan-proof its tasks: any task pointing at
// it falls back to the bare top-level (subcategory_uuid → NULL). Preset
// top-level anchors can't be deleted, so this only ever targets a sub.
export async function deleteSubcategory(uuid: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tasks SET subcategory_uuid = NULL, updated_at = datetime('now')
     WHERE subcategory_uuid = $1`,
    [uuid],
  );
  await db.execute(
    `UPDATE categories SET deleted_at = datetime('now'), updated_at = datetime('now')
     WHERE uuid = $1 AND is_preset = 0`,
    [uuid],
  );
}
