import { describe, expect, it } from "vitest";
import { buildForest, type StrategyNode } from "./strategy";
import type { Task } from "@/context/AppContext";

let n = 0;
const node = (p: Partial<StrategyNode> & { kind: string }): StrategyNode => ({
  id: `n${++n}`, user_id: "u", parent_id: null, title: "x", description: "", status: "open", weight: 1, target_count: null,
  progress: null, due_date: null, done_at: null, position: n, color: null, created_at: "", updated_at: "", ...p,
} as StrategyNode);
const task = (nodeId: string, status: Task["status"]): Task => ({
  id: `t${++n}`, title: "t", description: "", estimatedTime: null, status, startTime: null, endTime: null, date: "", deadline: "",
  position: 0, link: "", priority: "medium", nodeId,
});

describe("strategy progress", () => {
  it("weighted average of children; dropped ones do not count", () => {
    const g = node({ kind: "goal" });
    const big = node({ kind: "mission", parent_id: g.id, weight: 3, status: "done" });
    const small = node({ kind: "mission", parent_id: g.id, weight: 1 });
    const gone = node({ kind: "mission", parent_id: g.id, weight: 5, status: "dropped" });
    const { byId } = buildForest([g, big, small, gone], []);
    expect(byId.get(g.id)!.value).toBeCloseTo(0.75);
    expect(byId.get(big.id)!.done).toBe(true);
  });

  it('"at least N" counts done children out of N, extra ones cap at 100%', () => {
    const m = node({ kind: "mission", target_count: 6 });
    const kids = [1, 2, 3].map(() => node({ kind: "step", parent_id: m.id, status: "done" }));
    let { byId } = buildForest([m, ...kids], []);
    expect(byId.get(m.id)!.value).toBeCloseTo(0.5);
    expect(byId.get(m.id)!.slots).toBe(3);
    const more = [1, 2, 3, 4, 5].map(() => node({ kind: "step", parent_id: m.id, status: "done" }));
    ({ byId } = buildForest([m, ...kids, ...more], []));
    expect(byId.get(m.id)!.value).toBe(1);
    expect(byId.get(m.id)!.slots).toBe(0);
  });

  it("a leaf goes by its tasks (abandoned ignored), else by the value set by hand", () => {
    const s = node({ kind: "step" });
    const hand = node({ kind: "step", progress: 0.4 });
    const { byId } = buildForest([s, hand], [task(s.id, "complete"), task(s.id, "idle"), task(s.id, "abandoned")]);
    expect(byId.get(s.id)!.value).toBeCloseTo(0.5);
    expect(byId.get(hand.id)!.value).toBeCloseTo(0.4);
  });

  it("marked done wins; partial children count partly; colours flow down", () => {
    const a = node({ kind: "area", color: "#123456" });
    const g = node({ kind: "goal", parent_id: a.id });
    const m = node({ kind: "mission", parent_id: g.id, target_count: 2 });
    const half = node({ kind: "step", parent_id: m.id, progress: 0.5 });
    const done = node({ kind: "mission", parent_id: g.id, status: "done" });
    const { byId } = buildForest([a, g, m, half, done], []);
    expect(byId.get(m.id)!.value).toBeCloseTo(0.25);
    expect(byId.get(done.id)!.value).toBe(1);
    expect(byId.get(half.id)!.color).toBe("#123456");
  });
});
