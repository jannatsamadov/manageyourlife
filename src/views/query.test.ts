import { describe, expect, it } from "vitest";
import type { Item } from "@/core/items";
import { applyFilter, dateBucket, groupItems, makeCtx, patchForGroup, runView, sortItems, totals } from "./query";

let n = 0;
const item = (p: Partial<Item>): Item => ({
  id: `i${++n}`, workspace_id: "w", type: "task", title: "t", body: "", status: "todo", parent_id: null, position: n, url: null,
  color: null, planned_on: null, planned_time: null, is_event: false, start_on: null, due_on: null, due_time: null, done_at: null,
  archived_at: null, deleted_at: null, priority: null, estimate_min: null, spent_min: 0, cost_planned: null, cost_spent: null,
  weight: 1, target_count: null, progress: null, props: {}, created_by: "u", created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z", ...p,
} as Item);

const now = new Date("2026-11-17T12:00:00");
const thesis = item({ type: "project", title: "Dissertation" });
const a = item({ title: "Write chapter 2", parent_id: thesis.id, priority: 2, due_on: "2026-11-15", estimate_min: 120 });
const b = item({ title: "Buy paper", type: "buy", planned_on: "2026-11-17" });
const c = item({ title: "Call bank", status: "done", planned_on: "2026-11-18", priority: 1 });
const d = item({ title: "App idea", type: "idea", body: "views like github" });
const e = item({ title: "Old", deleted_at: "2026-11-10T00:00:00Z" });
const all = [thesis, a, b, c, d, e];
const ctx = makeCtx(all, now);
const titles = (q: string) => applyFilter(all, q, ctx).map((i) => i.title);

describe("filter", () => {
  it("types, negation and trash", () => {
    expect(titles("type:task")).toEqual(["Write chapter 2", "Call bank"]);
    expect(titles("-type:task,project")).toEqual(["Buy paper", "App idea"]);
    expect(titles("is:trashed")).toEqual(["Old"]);
  });
  it("status words and is:open", () => {
    expect(titles("type:task is:open")).toEqual(["Write chapter 2"]);
    expect(titles("status:done")).toEqual(["Call bank"]);
  });
  it("dates with @today and ranges", () => {
    expect(titles("due:<@today")).toEqual(["Write chapter 2"]);
    expect(titles("day:@today")).toEqual(["Buy paper"]);
    expect(titles("day:@today..@today+1")).toEqual(["Buy paper", "Call bank"]);
    expect(titles("is:overdue")).toEqual(["Write chapter 2"]);
    expect(titles("no:due type:task")).toEqual(["Call bank"]);
  });
  it("priority, parent, numbers and words", () => {
    expect(titles("priority:urgent,high")).toEqual(["Write chapter 2", "Call bank"]);
    expect(titles("in:dissert")).toEqual(["Write chapter 2"]);
    expect(titles("estimate:>=60")).toEqual(["Write chapter 2"]);
    expect(titles("github")).toEqual(["App idea"]);
    expect(titles('"call bank"')).toEqual(["Call bank"]);
    expect(titles("-paper type:buy")).toEqual([]);
  });
  it("unknown keys are words, not errors", () => {
    expect(titles("foo:bar")).toEqual([]);
  });
});

describe("sort and group", () => {
  it("sorts by priority with empty values last", () => {
    expect(sortItems([b, a, c], [{ field: "priority" }], ctx).map((i) => i.title)).toEqual(["Call bank", "Write chapter 2", "Buy paper"]);
    expect(sortItems([b, a, c], [{ field: "priority", desc: true }], ctx).map((i) => i.title)).toEqual(["Write chapter 2", "Call bank", "Buy paper"]);
  });
  it("groups by when into date buckets", () => {
    const g = groupItems([a, b, c, d], "when", ctx);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([["overdue", 1], ["today", 1], ["tomorrow", 1], ["none", 1]]);
    expect(dateBucket("2026-11-30", ctx.today)).toBe("month");
  });
  it("keeps every status column for a board", () => {
    const g = groupItems([a, c], "status", ctx);
    expect(g.map((x) => x.key)).toEqual(["todo", "doing", "waiting", "someday", "done", "dropped"]);
  });
  it("groups by parent with the parent's title", () => {
    const g = groupItems([a, b], "parent", ctx);
    expect(g.map((x) => x.label)).toEqual(["Dissertation", "No parent"]);
  });
  it("a drop into a group gives the patch", () => {
    expect(patchForGroup("status", "done", ctx)).toEqual({ status: "done" });
    expect(patchForGroup("priority", "none", ctx)).toEqual({ priority: null });
    expect(patchForGroup("when", "tomorrow", ctx)).toEqual({ planned_on: "2026-11-18" });
    expect(patchForGroup("when", "later", ctx)).toEqual({});
  });
  it("runs the whole view and sums minutes", () => {
    const g = runView(all, { filter: "type:task", group_by: null, sort: [], fields: [] }, ctx);
    expect(totals(g[0].items)).toEqual({ count: 2, estimate: 120, spent: 0 });
  });
});
