import { describe, it, expect } from "vitest";
import { activityYear, boxesAround, dayNumber, smallerSpan, taskRange, taskSlice } from "./tunnel";
import type { Task } from "@/context/AppContext";
const task = (patch: Partial<Task> = {}): Task => ({ id: "t", title: "Conference", date: "2026-10-31", time: "09:30", estimatedTime: 60,
  deadline: "2026-12-01", description: "", status: "idle", position: 0, link: "", priority: "medium", startTime: null, endTime: null, ...patch });
describe("Tunnel calendar rules", () => {
  it("places tasks at their planned hour, not deadline or actual timer", () => {
    const d = dayNumber("2026-10-31") ?? 0;
    expect(taskRange(task({ startTime: 1 }))?.start).toBeCloseTo(d + 9.5 / 24);
  });
  it("keeps date-less tasks out of dated boxes", () => { expect(taskRange(task({ date: null as unknown as string }))).toBeNull(); });
  it("extends a long duration across day boxes", () => {
    const d = dayNumber("2026-10-31") ?? 0;
    const t = task({ time: "23:00", estimatedTime: 180 });
    expect(taskSlice(t, d, d + 1)?.to).toBe(1);
    expect(taskSlice(t, d + 1, d + 2)?.continuation).toBe(true);
    expect(taskSlice(t, d + 1, d + 2)?.to).toBeCloseTo(2 / 24);
  });
  it("uses precisely 7, 14 and 28 days for the selected boxes", () => {
    const d = dayNumber("2026-10-31") ?? 0;
    for (const [span, days] of [["week", 7], ["fortnight", 14], ["month", 28]] as const) {
      const boxes = boxesAround(d, span, d);
      expect(boxes).toHaveLength(7);
      expect(boxes[1].end - boxes[1].start).toBe(days);
    }
  });
  it("renders 365 year activity tiles and counts completed tasks", () => {
    const tiles = activityYear(2026, [task({ date: "2026-01-01", status: "complete" })]);
    expect(tiles).toHaveLength(365); expect(tiles[0].count).toBe(1); expect(tiles[0].complete).toBe(1);
  });
  it("zooms year to four weeks to week to day", () => {
    expect(smallerSpan("year")).toBe("month"); expect(smallerSpan("month")).toBe("week"); expect(smallerSpan("week")).toBe("day");
  });
  it("does not show abandoned or deleted tasks", () => { expect(taskRange(task({ status: "abandoned" }))).toBeNull(); expect(taskRange(task({ deletedAt: "2026-10-31" }))).toBeNull(); });
  it("rejects invalid dates and does not misread invalid hours", () => {
    expect(dayNumber("2026-02-30")).toBeNull(); expect(taskRange(task({ time: "99:00" }))?.timed).toBe(false);
  });
});