// The strategy tree (P-2) on items: area / goal / mission / step items seen in the v1 node shape the Strategy page,
// its themes and the Schedule draw (kind, description, open / done / dropped, start_date, due_date).
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Item, type ItemPatch, itemsKey, useItemActions, useItems, useWorkspace } from "./items";
import { STRATEGY_TYPES } from "./types";

export type NodeKind = "area" | "goal" | "mission" | "step";
export type NodeStatus = "open" | "done" | "dropped";

export type StrategyNode = {
  id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  description: string;
  status: NodeStatus;
  weight: number;
  target_count: number | null;
  progress: number | null;
  start_date: string | null;
  due_date: string | null;
  done_at: string | null;
  position: number;
  color: string | null;
  created_at: string;
  updated_at: string;
};
export type NodeChange = Partial<Omit<StrategyNode, "id" | "created_at" | "updated_at" | "done_at">>;

export const isStrategy = (i: Item) => STRATEGY_TYPES.includes(i.type as never);

export const itemToNode = (i: Item): StrategyNode => ({
  id: i.id,
  parent_id: i.parent_id,
  kind: i.type as NodeKind,
  title: i.title,
  description: i.body,
  status: i.status === "done" || i.status === "dropped" ? i.status : "open",
  weight: Number(i.weight),
  target_count: i.target_count,
  progress: i.progress === null ? null : Number(i.progress),
  start_date: i.start_on,
  due_date: i.due_on,
  done_at: i.done_at,
  position: i.position,
  color: i.color,
  created_at: i.created_at,
  updated_at: i.updated_at,
});

export function nodeChangeToItem(c: NodeChange): ItemPatch {
  const p: ItemPatch = {};
  if (c.kind !== undefined) p.type = c.kind;
  if (c.parent_id !== undefined) p.parent_id = c.parent_id;
  if (c.title !== undefined) p.title = c.title;
  if (c.description !== undefined) p.body = c.description;
  if (c.status !== undefined) p.status = c.status === "open" ? "todo" : c.status;
  if (c.weight !== undefined) p.weight = c.weight;
  if (c.target_count !== undefined) p.target_count = c.target_count;
  if (c.progress !== undefined) p.progress = c.progress;
  if (c.start_date !== undefined) p.start_on = c.start_date;
  if (c.due_date !== undefined) p.due_on = c.due_date;
  if (c.position !== undefined) p.position = c.position;
  if (c.color !== undefined) p.color = c.color;
  return p;
}

// All strategy nodes (the tree is built in the browser; trashed ones left out).
export function useStrategyNodes() {
  const items = useItems();
  const data = useMemo(() => items.data?.filter((i) => isStrategy(i) && !i.deleted_at).map(itemToNode), [items.data]);
  return { data, isLoading: items.isLoading, error: items.error };
}

export function useStrategyActions() {
  const qc = useQueryClient();
  const { data: ws } = useWorkspace();
  const actions = useItemActions();

  const create = useCallback(async (row: NodeChange & { kind: NodeKind; title: string }) => {
    const siblings = (qc.getQueryData<Item[]>(itemsKey(ws?.id)) ?? [])
      .filter((i) => isStrategy(i) && i.parent_id === (row.parent_id ?? null));
    const saved = await actions.create({ position: siblings.length, ...nodeChangeToItem(row), type: row.kind, title: row.title });
    return saved && itemToNode(saved);
  }, [qc, ws, actions]);

  const update = useCallback((id: string, change: NodeChange) => actions.update(id, nodeChangeToItem(change)), [actions]);

  // A node and every strategy node below it go in one statement; the tasks inside stay (moved to the top).
  const remove = useCallback((id: string) => {
    const all = (qc.getQueryData<Item[]>(itemsKey(ws?.id)) ?? []).filter(isStrategy);
    const ids = [id];
    for (let k = 0; k < ids.length; k++) ids.push(...all.filter((n) => n.parent_id === ids[k]).map((n) => n.id));
    return actions.remove(ids);
  }, [qc, ws, actions]);

  return { create, update, remove };
}
