// Calendar coordinates use UTC day ordinals, not elapsed local milliseconds (DST-safe).
import type { Task } from "@/context/AppContext";

export type TunnelSpan = "day" | "week" | "fortnight" | "month" | "year";
export const SPANS: { id: TunnelSpan; label: string; days: number }[] = [
  { id: "day", label: "Day", days: 1 }, { id: "week", label: "Week", days: 7 },
  { id: "fortnight", label: "2 weeks", days: 14 }, { id: "month", label: "4 weeks", days: 28 },
  { id: "year", label: "Year", days: 365 },
];
export const BOX_LENGTH = 24;
export const NIGHT_GAP = 2;
export const STRIDE = BOX_LENGTH + NIGHT_GAP;
export const DAY_MS = 86_400_000;
export function dayNumber(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const n = Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
  return Number.isFinite(n) && isoDay(n) === iso ? n : null;
}
export const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const localToday = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
};
export function spanDays(span: TunnelSpan) { return SPANS.find(s => s.id === span)?.days ?? 1; }
export function boxStart(day: number, span: TunnelSpan, anchor: number): number {
  if (span === "year") return Math.floor(Date.UTC(new Date(day * DAY_MS).getUTCFullYear(), 0, 1) / DAY_MS);
  if (span === "day") return Math.floor(day);
  return anchor + Math.floor((day - anchor) / spanDays(span)) * spanDays(span);
}
export function boxEnd(start: number, span: TunnelSpan): number {
  if (span === "year") return Math.floor(Date.UTC(new Date(start * DAY_MS).getUTCFullYear() + 1, 0, 1) / DAY_MS);
  return start + spanDays(span);
}
export function boxesAround(day: number, span: TunnelSpan, anchor: number) {
  const first = boxStart(day, span, anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const start = span === "year"
      ? Math.floor(Date.UTC(new Date(first * DAY_MS).getUTCFullYear() + i - 1, 0, 1) / DAY_MS)
      : first + (i - 1) * spanDays(span);
    return { start, end: boxEnd(start, span), index: i - 1 };
  });
}
export function taskRange(task: Task): { start: number; end: number; timed: boolean } | null {
  const day = dayNumber(task.date);
  if (day === null || task.deletedAt || task.status === "abandoned") return null;
  const match = task.time?.match(/^(\d{2}):(\d{2})$/);
  const timed = !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
  const minutes = timed && match ? Number(match[1]) * 60 + Number(match[2]) : 12 * 60;
  const start = day + minutes / 1440;
  return { start, end: start + Math.max(1, task.estimatedTime ?? 30) / 1440, timed };
}
export function taskSlice(task: Task, start: number, end: number) {
  const range = taskRange(task);
  if (!range || range.start >= end || range.end <= start) return null;
  return { task, timed: range.timed, from: Math.max(0, (range.start - start) / (end - start)),
    to: Math.min(1, (range.end - start) / (end - start)), continuation: range.start < start };
}
// A fixed 365-cell activity overview; leap day remains available through day/week zoom.
export function activityYear(year: number, tasks: Task[]) {
  const first = Math.floor(Date.UTC(year, 0, 1) / DAY_MS);
  return Array.from({ length: 365 }, (_, i) => {
    const day = first + i;
    const items = tasks.filter(t => { const r = taskRange(t); return r && r.start < day + 1 && r.end > day; });
    return { day, count: items.length, complete: items.filter(t => t.status === "complete").length, tasks: items };
  });
}
export const smallerSpan = (span: TunnelSpan): TunnelSpan => ({ year: "month", month: "week", fortnight: "week", week: "day", day: "day" } as const)[span];
export const largerSpan = (span: TunnelSpan): TunnelSpan => ({ day: "week", week: "month", fortnight: "month", month: "year", year: "year" } as const)[span];
export const isVideo = (path: string) => /\.(mp4|webm|mov|m4v|ogv)$/i.test(path);