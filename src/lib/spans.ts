// Long goals and missions as spans of time (P-55, P-62): the spiral draws them beside its calendar line, the tunnel
// as light rails along its ceiling. Shared so both views show the same spans.
import type { TreeNode } from "@/lib/strategy";
import { localDay } from "@/hooks/useGoogleEvents";

const DAY = 86400000;
// Days counted from 1970-01-01 in the user's own calendar (the views use the same count).
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const localDayOf = (timestamp: string) => dayOf(localDay(new Date(timestamp)));

export const LONG_DAYS = 28; // a goal or mission this long (or a goal still open) gets a span
export const OPEN_TAIL = 90; // an open goal fades out this many days after today
export const LANES = 8;

export type Span = { id: string; title: string; color: string; start: number; end: number | null; done: boolean; lane: number };

function walk(t: TreeNode, f: (n: TreeNode) => void) {
  f(t);
  t.children.forEach((c) => walk(c, f));
}

// Start: the start date, else the first sign of the work (created, earliest task).
// End: the day it was done, else the due date, else open (goals only).
export function spansOf(roots: TreeNode[], hidden: Set<string>, today: number): Span[] {
  const spans: Span[] = [];
  const visit = (t: TreeNode) => {
    if (t.node.status === "dropped" || (t.kind === "goal" && hidden.has(t.node.id))) return;
    if (t.kind === "goal" || t.kind === "mission") {
      let first = localDayOf(t.node.created_at);
      walk(t, (n) => n.tasks.forEach((k) => { if (k.date) first = Math.min(first, dayOf(k.date)); }));
      const done = t.node.status === "done";
      const end = done ? localDayOf(t.node.done_at ?? t.node.updated_at) : t.node.due_date ? dayOf(t.node.due_date) : null;
      const start = Math.min(t.node.start_date ? dayOf(t.node.start_date) : first, end ?? Infinity);
      if (end === null ? t.kind === "goal" && start <= today + OPEN_TAIL : end - start >= LONG_DAYS) {
        spans.push({ id: t.node.id, title: t.node.title, color: t.color, start, end, done, lane: 0 });
      }
    }
    if (t.kind === "area" || t.kind === "goal") t.children.forEach(visit);
  };
  roots.forEach(visit);
  // Lanes side by side, a lane reused once its span has ended.
  spans.sort((a, b) => a.start - b.start);
  const ends: number[] = [];
  for (const s of spans) {
    let lane = ends.findIndex((e) => e < s.start);
    if (lane < 0) lane = ends.length < LANES ? ends.length : ends.indexOf(Math.min(...ends));
    ends[lane] = s.end ?? today + OPEN_TAIL;
    s.lane = lane;
  }
  return spans;
}
