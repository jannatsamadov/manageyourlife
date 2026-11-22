import { describe, expect, it } from "vitest";
import type { Item } from "@/core/items";
import { applyFilter, type CustomField, dateBucket, groupItems, makeCtx, patchForGroup, runView, sortItems, totals } from "./query";
import { placeAt } from "./layouts/common";
import { shiftPatch } from "./layouts/TimelineLayout";
import { captureParts } from "../../supabase/functions/_shared/capture-text";

let n = 0;
const item = (p: Partial<Item>): Item => ({
  id: `i${++n}`, workspace_id: "w", number: n, type: "task", title: "t", body: "", status: "todo", parent_id: null, position: n, url: null,
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
  it("an item's #number (#200)", () => {
    expect(titles(`#${a.number}`)).toEqual(["Write chapter 2"]);
    expect(titles(`-#${a.number} type:task`)).toEqual(["Call bank"]);
    expect(titles(`number:>=${d.number}`)).toEqual(["App idea"]);
    expect(titles('"#2"')).toEqual([]); // quoted: plain words
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

describe("custom fields", () => {
  const kind: CustomField = { id: "f1", key: "kind", name: "Kind", kind: "select", position: 0, options: [{ id: "idea", name: "Idea" }, { id: "todo", name: "To-do" }] };
  const urgent: CustomField = { id: "f2", key: "hot", name: "Hot", kind: "checkbox", position: 1, options: [] };
  const x = item({ title: "Inbox one", type: "capture", props: { kind: "idea", hot: true } });
  const y = item({ title: "Inbox two", type: "capture", props: { kind: "todo" } });
  const z = item({ title: "Inbox three", type: "capture" });
  const c2 = makeCtx([x, y, z], now, [kind, urgent]);
  const names = (q: string) => applyFilter([x, y, z], q, c2).map((i) => i.title);
  it("filters by option name or id, none, has / no", () => {
    expect(names("kind:idea")).toEqual(["Inbox one"]);
    expect(names("kind:to-do")).toEqual(["Inbox two"]);
    expect(names("kind:none")).toEqual(["Inbox three"]);
    expect(names("no:kind")).toEqual(["Inbox three"]);
    expect(names("hot:yes")).toEqual(["Inbox one"]);
    expect(names("-hot:yes")).toEqual(["Inbox two", "Inbox three"]);
  });
  it("groups by a select in option order, then none", () => {
    const g = groupItems([z, y, x], "props.kind", c2);
    expect(g.map((k) => [k.key, k.items.length])).toEqual([["idea", 1], ["todo", 1], ["none", 1]]);
  });
  it("sorts by option order and gives the props patch of a group", () => {
    expect(sortItems([z, y, x], [{ field: "props.kind" }], c2).map((i) => i.title)).toEqual(["Inbox one", "Inbox two", "Inbox three"]);
    expect(patchForGroup("props.kind", "todo", c2)).toEqual({ props: { kind: "todo" } });
    expect(patchForGroup("props.hot", "none", c2)).toEqual({ props: { hot: false } });
  });
  it("a deleted field is ignored, its key words again", () => {
    const bare = makeCtx([x], now);
    expect(groupItems([x], "props.kind", bare).map((g) => g.key)).toEqual(["all"]);
    expect(applyFilter([x], "kind:idea", bare)).toEqual([]);
  });
});

describe("moving rows and bars", () => {
  const r = (position: number) => item({ position });
  it("puts a row between its neighbours, or renumbers equal ones", () => {
    expect(placeAt([r(1), r(2)], 1)).toEqual({ position: 1.5 });
    expect(placeAt([r(1), r(2)], 0)).toEqual({ position: 0 });
    expect(placeAt([r(1), r(2)], 2)).toEqual({ position: 3 });
    const same = [r(0), r(0), r(0)];
    expect(placeAt(same, 1)).toEqual({ renumber: [{ id: same[0].id, position: 0 }, { id: same[1].id, position: 2 }, { id: same[2].id, position: 3 }] });
  });
  it("a timeline drag shifts or stretches the right dates", () => {
    const planned = item({ planned_on: "2026-11-20" });
    expect(shiftPatch(planned, "move", 2)).toEqual({ planned_on: "2026-11-22" });
    expect(shiftPatch(planned, "end", 3)).toEqual({ due_on: "2026-11-23" });
    expect(shiftPatch(planned, "start", -1)).toEqual({ start_on: "2026-11-19" });
    const span = item({ planned_on: "2026-11-20", due_on: "2026-11-25" });
    expect(shiftPatch(span, "start", 2)).toEqual({ planned_on: "2026-11-22" });
    expect(shiftPatch(span, "start", 9)).toEqual({ planned_on: "2026-11-25" }); // never past the end
    expect(shiftPatch(span, "move", -1)).toEqual({ planned_on: "2026-11-19", due_on: "2026-11-24" });
  });
});

describe("captures", () => {
  it("first line = title, long ones cut, first link kept", () => {
    expect(captureParts("Buy milk\nand bread")).toEqual({ title: "Buy milk", body: "and bread", url: null });
    expect(captureParts("https://x.com/a watch this", ["— Channel"])).toEqual({ title: "https://x.com/a watch this", body: "— Channel", url: "https://x.com/a" });
    const long = "word ".repeat(60).trim();
    const p = captureParts(long);
    expect(p.title.endsWith("…")).toBe(true);
    expect(p.title.length).toBeLessThanOrEqual(161);
    expect(p.body).toBe(long);
    expect(captureParts("", [], "Photo").title).toBe("Photo");
  });
});
