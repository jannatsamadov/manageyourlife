// Changing items from the views and the item drawer, with what has to follow a change: a task's calendar event and
// Google task are synced (as the Schedule does), and closing an item stops its running timer.
import { useCallback } from "react";
import { queueCalendarSync } from "@/lib/gcal";
import { type Item, type ItemPatch, type NewItem, useItemActions, useTimeLogs, useTimer } from "./items";

export function useItemEdit() {
  const actions = useItemActions();
  const timer = useTimer();
  const logs = useTimeLogs();

  const change = useCallback(async (item: Item, patch: ItemPatch) => {
    if (!(await actions.update(item.id, patch))) return false;
    if ((patch.status === "done" || patch.status === "dropped") && logs.data?.some((l) => l.item_id === item.id && !l.ended_at)) {
      await timer.stop(item.id);
    }
    if (item.type === "task" || patch.type === "task") queueCalendarSync(item.id);
    return true;
  }, [actions, timer, logs.data]);

  const create = useCallback(async (row: NewItem) => {
    const saved = await actions.create(row);
    if (saved?.type === "task") queueCalendarSync(saved.id);
    return saved;
  }, [actions]);

  const trash = useCallback((item: Item) => change(item, { deleted_at: new Date().toISOString() }), [change]);
  const restore = useCallback((item: Item) => change(item, { deleted_at: null }), [change]);

  return { change, create, trash, restore };
}
