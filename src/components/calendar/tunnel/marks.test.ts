import { describe, expect, it } from "vitest";
import { AREA_COLORS, buildForest, type StrategyNode } from "@/lib/strategy";
import { PATTERNS, levelOf, marksOf, mixOf } from "./marks";

let n = 0;
const node = (p: Partial<StrategyNode> & Pick<StrategyNode, "id" | "kind">): StrategyNode => ({
  parent_id: null, title: p.id, description: "", status: "open", weight: 1, target_count: null, progress: null,
  start_date: null, due_date: null, done_at: null, position: n++, color: null, created_at: "", updated_at: "", ...p,
});

describe("marks (#196)", () => {
  const goals = Array.from({ length: PATTERNS + 1 }, (_, i) => node({ id: `g${i}`, kind: "goal", parent_id: "work" }));
  const { byId } = buildForest(
    [
      node({ id: "research", kind: "area" }),
      node({ id: "phd", kind: "goal", parent_id: "research" }),
      node({ id: "papers", kind: "mission", parent_id: "phd" }),
      node({ id: "work", kind: "area", color: "#123456" }),
      ...goals,
    ],
    [],
  );
  const marks = marksOf(byId);

  it("colours by area, textures by goal; missions take their goal's mark", () => {
    expect(marks.get("research")).toMatchObject({ color: AREA_COLORS[0], pattern: 0, label: "research" });
    expect(marks.get("phd")).toMatchObject({ color: AREA_COLORS[0], pattern: 1, label: "research · phd" });
    expect(marks.get("papers")).toBe(marks.get("phd"));
    expect(marks.get("g0")).toMatchObject({ color: "#123456", pattern: 1 });
    expect(marks.get("g1")!.pattern).toBe(2);
    expect(marks.get(`g${PATTERNS}`)!.pattern).toBe(1); // more goals than textures: they come round again
    expect(marks.get("g0")!.order).toBeGreaterThan(marks.get("papers")!.order);
  });

  it("adds a day up per goal, in the tree's order, no goal last", () => {
    const phd = marks.get("phd")!, work = marks.get("g0")!;
    const parts = mixOf([
      { minutes: null, done: false, mark: null },
      { minutes: 90, done: true, mark: work },
      { minutes: 60, done: true, mark: phd },
      { minutes: null, done: false, mark: phd },
    ]);
    expect(parts.map((p) => [p.mark?.id ?? null, p.planned, p.done])).toEqual([
      ["phd", 90, 60],
      ["g0", 90, 90],
      [null, 30, 0],
    ]);
    expect(levelOf(parts)).toBe(3); // 2.5 h done + half of 1 h open = 3 h
    expect(levelOf([])).toBe(0);
    expect(levelOf(mixOf([{ minutes: 30, done: false, mark: null }]))).toBe(1);
  });
});
