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
  // A row dropped at `index` of a group's list (the list without the row): the page sets the group's value and,
  // when the view has no sort, the row's place.
  onMove?: (item: Item, groupKey: string, index: number) => void;
  // Bulk select (table): the chosen rows; shift = select the range from the last one.
  selected?: Set<string>;
  onSelect?: (id: string, shift: boolean) => void;
  onSelectAll?: (ids: string[], on: boolean) => void;
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

// The new `position` of an item put at `index` of an ordered list (positions are fractions, P-70): between its
// neighbours, or — when they are equal — the whole list renumbered.
export function placeAt(list: Item[], index: number): { position: number } | { renumber: { id: string; position: number }[] } {
  const prev = list[index - 1], next = list[index];
  if (!prev && !next) return { position: 0 };
  if (!prev) return { position: next.position - 1 };
  if (!next) return { position: prev.position + 1 };
  if (next.position - prev.position > 1e-6) return { position: (prev.position + next.position) / 2 };
  return { renumber: list.map((i, k) => ({ id: i.id, position: (k < index ? k : k + 1) })) };
}
