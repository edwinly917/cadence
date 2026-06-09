import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Category, Dimension } from "@/types";
import { listCategories, PRESET_UUID } from "./categories";

interface CategoriesContextValue {
  categories: Category[];
  /** The two renamable top-level anchors, ordered work → life. */
  topLevel: Category[];
  /** Sub-categories under a given top-level kind, in display order. */
  subsOf: (kind: Dimension) => Category[];
  /** Display label for a top-level kind (falls back to the built-in name). */
  labelOf: (kind: Dimension) => string;
  /** Display label for a sub-category uuid, or undefined if unknown/deleted. */
  subLabel: (uuid: string | null | undefined) => string | undefined;
  reload: () => Promise<void>;
}

const FALLBACK_LABEL: Record<Dimension, string> = { work: "工作", life: "生活" };

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);

  const reload = useCallback(async () => {
    try {
      setCategories(await listCategories());
    } catch {
      // Keep the last good list; UI falls back to built-in labels.
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<CategoriesContextValue>(() => {
    const topLevel = (["work", "life"] as const)
      .map((kind) =>
        categories.find((c) => c.parent_uuid === null && c.uuid === PRESET_UUID[kind]),
      )
      .filter((c): c is Category => !!c);

    const subsOf = (kind: Dimension) =>
      categories
        .filter((c) => c.parent_uuid === PRESET_UUID[kind])
        .sort((a, b) => a.position - b.position);

    const labelOf = (kind: Dimension) =>
      topLevel.find((c) => c.kind === kind)?.name ?? FALLBACK_LABEL[kind];

    const subLabel = (uuid: string | null | undefined) =>
      uuid ? categories.find((c) => c.uuid === uuid)?.name : undefined;

    return { categories, topLevel, subsOf, labelOf, subLabel, reload };
  }, [categories, reload]);

  return (
    <CategoriesContext.Provider value={value}>
      {children}
    </CategoriesContext.Provider>
  );
}

export function useCategories(): CategoriesContextValue {
  const ctx = useContext(CategoriesContext);
  if (!ctx) {
    throw new Error("useCategories must be used within a CategoriesProvider");
  }
  return ctx;
}
