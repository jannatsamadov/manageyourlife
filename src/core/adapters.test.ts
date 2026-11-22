import { describe, expect, it } from "vitest";
import type { Item } from "./items";
import { itemToTask, taskPatchToItem } from "./tasks";
import { itemToNode, nodeChangeToItem } from "./strategy";
import { todosOf } from "./notes";

const item = (over: Partial<Item> = {}): Item => ({
  id: "i1", workspace_id: "w", number: 1, type: "task", title: "T", body: "b", status: "todo", parent_id: null, position: 2, url: null, color: null,
  planned_on: null, planned_time: null, is_event: false, start_on: null, due_on: null, due_time: null, done_at: null, archived_at: null,
  deleted_at: null, priority: 3, estimate_min: 30, spent_min: 0, cost_planned: null, cost_spent: null, weight: 1, target_count: null,
  progress: null, props: {}, created_by: null, created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", ...over,
});

describe("task adapter (v1 shape ↔ items)", () => {
  it("maps an item to the v1 task", () => {
    const t = itemToTask(item({ status: "done", done_at: "2026-11-17T10:00:00Z", due_on: "2026-11-20", url: "https://x", priority: 1, parent_id: "g" }));
    expect(t).toMatchObject({ status: "complete", deadline: "2026-11-20", link: "https://x", priority: "high", nodeId: "g", description: "b", estimatedTime: 30 });
    expect(t.endTime).toBe(Date.parse("2026-11-17T10:00:00Z"));
    expect(itemToTask(item({ status: "waiting" })).status).toBe("idle");
    expect(itemToTask(item({ priority: null })).priority).toBe("medium");
  });
  it("uses the last time log for start / end", () => {
    const log = { id: "l", item_id: "i1", workspace_id: "w", user_id: "u", started_at: "2026-11-17T09:00:00Z", ended_at: null, note: "", created_at: "", updated_at: "" };
    expect(itemToTask(item({ status: "doing" }), log)).toMatchObject({ status: "active", startTime: Date.parse(log.started_at), endTime: null });
  });
  it("maps task changes to columns (empty → null)", () => {
    expect(taskPatchToItem({ date: "", deadline: "", link: " ", estimatedTime: 0, status: "abandoned", priority: "low", nodeId: null, time: "" }))
      .toEqual({ planned_on: null, due_on: null, url: null, estimate_min: null, status: "dropped", priority: 4, parent_id: null, planned_time: null });
    expect(taskPatchToItem({ startTime: 1, endTime: 2 })).toEqual({});
  });
});

describe("strategy adapter", () => {
  it("maps both ways", () => {
    const n = itemToNode(item({ type: "goal", status: "doing", start_on: "2026-01-01", due_on: "2026-12-31", weight: 2 }));
    expect(n).toMatchObject({ kind: "goal", status: "open", start_date: "2026-01-01", due_date: "2026-12-31", weight: 2, description: "b" });
    expect(nodeChangeToItem({ status: "open", description: "d", due_date: null, kind: "mission" })).toEqual({ status: "todo", body: "d", due_on: null, type: "mission" });
  });
});

describe("note to-dos", () => {
  it("reads top-level lines and drops block ids", () => {
    expect(todosOf("# x\r\n- [ ] a ^m-4f2a\n- [x] b\n  - [ ] nested\n")).toEqual([{ title: "a", completed: false }, { title: "b", completed: true }]);
  });
});
