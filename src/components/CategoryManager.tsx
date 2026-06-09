import { useState } from "react";
import { Dimension } from "@/types";
import { useCategories } from "@/lib/categoriesContext";
import {
  renameCategory,
  addSubcategory,
  deleteSubcategory,
} from "@/lib/categories";

// 分类管理 — rename the two preset top-level anchors, and add / rename / delete
// their sub-categories. Presets can't be deleted (so tasks never orphan);
// deleting a sub falls its tasks back to the bare top-level.
export function CategoryManager() {
  const { topLevel, subsOf, reload } = useCategories();
  // Per-uuid edit buffers; fall back to the live name when untouched.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newSub, setNewSub] = useState<Record<string, string>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draftOf = (uuid: string, fallback: string) =>
    drafts[uuid] ?? fallback;

  const setDraft = (uuid: string, v: string) =>
    setDrafts((d) => ({ ...d, [uuid]: v }));

  const commitRename = async (uuid: string, current: string) => {
    const next = (drafts[uuid] ?? current).trim();
    if (!next || next === current) {
      setDrafts((d) => {
        const { [uuid]: _drop, ...rest } = d;
        return rest;
      });
      return;
    }
    try {
      await renameCategory(uuid, next);
      setDrafts((d) => {
        const { [uuid]: _drop, ...rest } = d;
        return rest;
      });
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAddSub = async (kind: Dimension) => {
    const name = (newSub[kind] ?? "").trim();
    if (!name) return;
    try {
      await addSubcategory(kind, name);
      setNewSub((n) => ({ ...n, [kind]: "" }));
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (uuid: string) => {
    try {
      await deleteSubcategory(uuid);
      setConfirmId(null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium text-gray-700">分类管理</h3>
      <p className="mt-1 text-xs text-gray-500">
        预设的「工作 / 生活」可改名(如改成「主业 / 自我」),不可删除。每类下可添加子类(如主业 / 副业、自己 / 家庭)。删除子类时,其下任务会回到上层大类。
      </p>

      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {topLevel.map((top) => (
        <div
          key={top.uuid}
          className="mt-4 rounded-md border border-gray-100 bg-gray-50/60 p-3"
        >
          <div className="flex items-center gap-2">
            <input
              value={draftOf(top.uuid, top.name)}
              onChange={(e) => setDraft(top.uuid, e.target.value)}
              onBlur={() => commitRename(top.uuid, top.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="flex-1 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500">
              预设
            </span>
          </div>

          <div className="mt-3 space-y-2 pl-2">
            {subsOf(top.kind).map((sub) => (
              <div key={sub.uuid} className="flex items-center gap-2">
                <span className="text-gray-300">└</span>
                <input
                  value={draftOf(sub.uuid, sub.name)}
                  onChange={(e) => setDraft(sub.uuid, e.target.value)}
                  onBlur={() => commitRename(sub.uuid, sub.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                  }}
                  className="flex-1 rounded border border-gray-300 bg-white px-2.5 py-1 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {confirmId === sub.uuid ? (
                  <>
                    <button
                      onClick={() => handleDelete(sub.uuid)}
                      className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                    >
                      确认删除
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmId(sub.uuid)}
                    className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                    title="删除子类"
                  >
                    删除
                  </button>
                )}
              </div>
            ))}

            <div className="flex items-center gap-2 pl-4">
              <input
                value={newSub[top.kind] ?? ""}
                onChange={(e) =>
                  setNewSub((n) => ({ ...n, [top.kind]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSub(top.kind);
                }}
                placeholder="添加子类…"
                className="flex-1 rounded border border-dashed border-gray-300 bg-white px-2.5 py-1 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={() => handleAddSub(top.kind)}
                className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
