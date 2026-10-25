// When a task happens (P-60, owner 2026-10-25): an event (fixed time, goes to Google Calendar as a timed event), a
// planned day (optionally a time block), a deadline, or none (it waits in the store). Only "event" is stored as such;
// the others follow from the planned day and the deadline.
import type { Task } from "@/context/AppContext";

export type Timing = "event" | "planned" | "deadline" | null;

export const timingOf = (t: Pick<Task, "isEvent" | "date" | "deadline">): Timing =>
  t.isEvent ? "event" : t.date ? "planned" : t.deadline ? "deadline" : null;

// "13:15" for an event or a time block; nothing for a whole-day task.
export const timeOf = (t: Pick<Task, "time">) => t.time || "";

// The end of a block: "HH:MM" + minutes (clamped to the same day).
export function endOf(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const end = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

// Tasks of a day: timed ones by their time first, the rest in their own order.
export const byTime = (a: Task, b: Task) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.position - b.position;
