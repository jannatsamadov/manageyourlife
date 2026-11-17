// Tasks for the pages built on the v1 task shape (Schedule and its calendars, Strategy, the task popup …): items of
// type task seen as the old `Task`, and the old actions on top of the item layer. The pages keep their look; new
// pages use items directly.
import { useCallback, useMemo } from "react";
import { queueCalendarSync } from "@/lib/gcal";
import { type Item, type ItemPatch, type TimeLog, useItemActions, useItems, useTimeLogs, useTimer } from "./items";

export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  estimatedTime: number | null;
  status: "idle" | "active" | "complete" | "abandoned";
  startTime: number | null; // the last timer start
  endTime: number | null; // the last timer stop, or when it was done
  date: string; // planned day ("" / null = not planned)
  deadline: string;
  position: number;
  link: string;
  priority: TaskPriority;
  deletedAt?: string | null;
  nodeId?: string | null; // the strategy node (or other item) it sits in (P-2)
  // When it happens (P-60): an event at a fixed time; time = the event's or the time block's start ("HH:MM", only with
  // a date); deadlineTime = the deadline's time (only with a deadline).
  isEvent?: boolean;
  time?: string | null;
  deadlineTime?: string | null;
}

const V1_STATUS: Record<string, Task["status"]> = {
  todo: "idle", doing: "active", waiting: "idle", someday: "idle", done: "complete", dropped: "abandoned",
};
const V2_STATUS: Record<Task["status"], string> = { idle: "todo", active: "doing", complete: "done", abandoned: "dropped" };
const PRIORITY_OF: Record<number, TaskPriority> = { 1: "high", 2: "high", 3: "medium", 4: "low" };
const PRIORITY_NUM: Record<TaskPriority, number> = { high: 2, medium: 3, low: 4 };

export function itemToTask(i: Item, lastLog?: TimeLog): Task {
  const ended = lastLog?.ended_at ?? (i.status === "done" ? i.done_at : null);
  return {
    id: i.id,
    title: i.title,
    description: i.body,
    estimatedTime: i.estimate_min,
    status: V1_STATUS[i.status] ?? "idle",
    startTime: lastLog ? Date.parse(lastLog.started_at) : null,
    endTime: ended ? Date.parse(ended) : null,
    date: i.planned_on as string,
    deadline: i.due_on ?? "",
    position: i.position,
    link: i.url ?? "",
    priority: i.priority ? PRIORITY_OF[i.priority] : "medium",
    deletedAt: i.deleted_at,
    nodeId: i.parent_id,
    isEvent: i.is_event,
    time: i.planned_time,
    deadlineTime: i.due_time,
  };
}

// Task fields → item columns (the timer fields are actions, not columns).
export function taskPatchToItem(u: Partial<Task>): ItemPatch {
  const p: ItemPatch = {};
  if (u.title !== undefined) p.title = u.title;
  if (u.description !== undefined) p.body = u.description ?? "";
  if (u.status !== undefined) p.status = V2_STATUS[u.status];
  if (u.estimatedTime !== undefined) p.estimate_min = u.estimatedTime && u.estimatedTime > 0 ? u.estimatedTime : null;
  if (u.date !== undefined) p.planned_on = u.date || null;
  if (u.deadline !== undefined) p.due_on = u.deadline || null;
  if (u.position !== undefined) p.position = u.position;
  if (u.link !== undefined) p.url = u.link?.trim() || null;
  if (u.priority !== undefined) p.priority = PRIORITY_NUM[u.priority] ?? 3;
  if (u.nodeId !== undefined) p.parent_id = u.nodeId || null;
  if (u.isEvent !== undefined) p.is_event = !!u.isEvent;
  if (u.time !== undefined) p.planned_time = u.time || null;
  if (u.deadlineTime !== undefined) p.due_time = u.deadlineTime || null;
  return p;
}

// The tasks of the Schedule: task items that are not in the trash and not steps of another task.
export function useTasks() {
  const items = useItems();
  const logs = useTimeLogs();
  const { create, update, updateMany } = useItemActions();
  const timer = useTimer();

  const tasks = useMemo(() => {
    const all = items.data ?? [];
    const taskIds = new Set(all.filter((i) => i.type === "task").map((i) => i.id));
    const last = new Map<string, TimeLog>();
    for (const l of logs.data ?? []) last.set(l.item_id, l); // ordered by start: the last one wins
    return all
      .filter((i) => i.type === "task" && !i.deleted_at && !(i.parent_id && taskIds.has(i.parent_id)))
      .map((i) => itemToTask(i, last.get(i.id)))
      .sort((a, b) => a.position - b.position);
  }, [items.data, logs.data]);

  // Started → the timer runs; done → it stops (P-9).
  const clock = useCallback((id: string, u: Partial<Task>) => {
    if (u.status === "active" && u.startTime) return timer.start(id);
    if (u.endTime) return timer.stop(id);
  }, [timer]);

  const addTask = useCallback(async (t: Omit<Task, "id"> & Partial<Pick<Task, "link" | "priority">>): Promise<Task | undefined> => {
    const saved = await create({
      type: "task",
      ...taskPatchToItem({ ...t, isEvent: !!t.isEvent && !!t.date, time: t.date ? t.time : null, deadlineTime: t.deadline ? t.deadlineTime : null }),
      title: t.title,
    });
    if (!saved) return;
    await clock(saved.id, t);
    queueCalendarSync(saved.id); // its calendar event (with a day) and its Google task
    return itemToTask(saved);
  }, [create, clock]);

  const updateTask = useCallback(async (id: string, u: Partial<Task>) => {
    const patch = taskPatchToItem(u);
    if (Object.keys(patch).length && !(await update(id, patch))) return;
    await clock(id, u);
    queueCalendarSync(id);
  }, [update, clock]);

  // "Abandon" keeps it (dropped); the trash hides it.
  const deleteTask = useCallback((id: string) => updateTask(id, { status: "abandoned" }), [updateTask]);
  const permanentDeleteTask = useCallback(async (id: string) => {
    if (await update(id, { deleted_at: new Date().toISOString() })) queueCalendarSync(id);
  }, [update]);

  const reorderTasks = useCallback(async (_date: string, taskIds: string[]) => {
    await updateMany(taskIds.map((id, i) => ({ id, patch: { position: i } })));
  }, [updateMany]);

  return { tasks, loading: items.isLoading, addTask, updateTask, deleteTask, permanentDeleteTask, reorderTasks };
}
