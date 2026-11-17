import type { Item, ItemPatch } from "@/core/items";
import type { Ctx, Group, ViewConfig } from "../query";

// What every layout gets from the page: the groups (filtered, sorted, grouped already) and the actions.
export type LayoutProps = {
  groups: Group[];
  config: ViewConfig;
  ctx: Ctx;
  kids: Map<string, { open: number; total: number }>; // sub-items per item
  onOpen: (id: string) => void;
  onChange: (item: Item, patch: ItemPatch) => void;
  onAdd: (title: string, groupKey: string) => void;
};

export function kidsOf(items: Item[]) {
  const out = new Map<string, { open: number; total: number }>();
  for (const i of items) {
    if (!i.parent_id || i.deleted_at) continue;
    const k = out.get(i.parent_id) ?? { open: 0, total: 0 };
    k.total++;
    if (i.status !== "done" && i.status !== "dropped") k.open++;
    out.set(i.parent_id, k);
  }
  return out;
}
