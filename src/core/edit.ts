// Changing items from the views and the item drawer, with what has to follow a change: a task's calendar event and
// Google task are synced (as the Schedule does), and closing an item stops its running timer.
// A patch's `props` holds only the custom-field keys to change; they are merged into the item's props here.
import { useCallback } from "react";
import { queueCalendarSync } from "@/lib/gcal";
import type { Json } from "@/integrations/supabase/types";
import { type Item, type ItemPatch, type NewItem, useItemActions, useTimeLogs, useTimer } from "./items";

const withProps = (item: Item, patch: ItemPatch): ItemPatch =>
  patch.props && typeof patch.props === "object" && !Array.isArray(patch.props)
    ? { ...patch, props: { ...(item.props as Record<string, Json> ?? {}), ...(patch.props as Record<string, Json>) } }
    : patch;

export function useItemEdit() {
  const actions = useItemActions();
  const timer = useTimer();
  const logs = useTimeLogs();

  const after = useCallback(async (item: Item, patch: ItemPatch) => {
    if ((patch.status === "done" || patch.status === "dropped") && logs.data?.some((l) => l.item_id === item.id && !l.ended_at)) {
      await timer.stop(item.id);
    }
    if (item.type === "task" || patch.type === "task") queueCalendarSync(item.id);
  }, [timer, logs.data]);

  const change = useCallback(async (item: Item, patch: ItemPatch) => {
    if (!(await actions.update(item.id, withProps(item, patch)))) return false;
    await after(item, patch);
    return true;
  }, [actions, after]);

  // One change to several items (bulk edit, a drag that renumbers a list): all or none are saved.
  const changeMany = useCallback(async (changes: { item: Item; patch: ItemPatch }[]) => {
    if (!changes.length) return true;
    if (!(await actions.updateMany(changes.map(({ item, patch }) => ({ id: item.id, patch: withProps(item, patch) }))))) return false;
    for (const { item, patch } of changes) await after(item, patch);
    return true;
  }, [actions, after]);

  const create = useCallback(async (row: NewItem) => {
    const saved = await actions.create(row);
    if (saved?.type === "task") queueCalendarSync(saved.id);
    return saved;
  }, [actions]);

  const trash = useCallback((item: Item) => change(item, { deleted_at: new Date().toISOString() }), [change]);
  const restore = useCallback((item: Item) => change(item, { deleted_at: null }), [change]);

  return { change, changeMany, create, trash, restore };
}
