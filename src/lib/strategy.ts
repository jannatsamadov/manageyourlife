// Strategy tree (P-2): area → goal → mission → step (steps nest). Progress is computed here, never stored,
// so every theme (P-24) draws the same numbers: progress in → picture out.
import type { Database } from "@/integrations/supabase/types";
import type { Task } from "@/context/AppContext";

export type StrategyNode = Database["public"]["Tables"]["strategy_nodes"]["Row"];
export type NodeKind = "area" | "goal" | "mission" | "step";
export type NodeStatus = "open" | "done" | "dropped";

export type TreeNode = {
  node: StrategyNode;
  kind: NodeKind;
  parent: TreeNode | null;
  children: TreeNode[]; // dropped ones too (drawn as ghosts), by position
  tasks: Task[]; // linked daily tasks that still count (not abandoned)
  value: number; // 0..1
  done: boolean;
  slots: number; // children still missing to reach target_count
  color: string;
};

export const CHILD_KIND: Record<NodeKind, NodeKind> = { area: "goal", goal: "mission", mission: "step", step: "step" };

// Area colours when none is chosen.
export const AREA_COLORS = ["#7c9cff", "#f5c542", "#ff7aa8", "#4ade80", "#fb923c", "#38bdf8", "#c084fc", "#f87171"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Progress of one node:
//  - marked done → 1
//  - "at least N" (target_count) → done children counted out of N (partial children count partly)
//  - children → weighted average of the children that are not dropped
//  - no children, linked tasks → share of tasks done
//  - nothing below → the value set by hand (0 if none)
function compute(t: TreeNode) {
  t.children.forEach(compute);
  const live = t.children.filter((c) => c.node.status !== "dropped");
  const target = t.node.target_count ?? 0;
  t.slots = Math.max(0, target - live.length);
  let value: number;
  if (t.node.status === "done") value = 1;
  else if (target > 0) value = Math.min(target, live.reduce((s, c) => s + c.value, 0)) / target;
  else if (live.length) {
    const total = live.reduce((s, c) => s + Number(c.node.weight), 0);
    value = live.reduce((s, c) => s + Number(c.node.weight) * c.value, 0) / total;
  } else if (t.tasks.length) value = t.tasks.filter((x) => x.status === "complete").length / t.tasks.length;
  else value = Number(t.node.progress ?? 0);
  t.value = clamp01(value);
  t.done = t.node.status === "done" || t.value >= 0.9999;
}

export function buildForest(nodes: StrategyNode[], tasks: Task[]) {
  const byId = new Map<string, TreeNode>();
  const sorted = [...nodes].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  for (const n of sorted) {
    byId.set(n.id, { node: n, kind: n.kind as NodeKind, parent: null, children: [], tasks: [], value: 0, done: false, slots: 0, color: n.color ?? "" });
  }
  const roots: TreeNode[] = [];
  for (const t of byId.values()) {
    const parent = t.node.parent_id ? byId.get(t.node.parent_id) : undefined;
    if (parent) {
      t.parent = parent;
      parent.children.push(t);
    } else roots.push(t);
  }
  for (const task of tasks) {
    if (task.nodeId && task.status !== "abandoned") byId.get(task.nodeId)?.tasks.push(task);
  }
  // Colours flow down: own colour, else the parent's, else the palette by area order.
  const paint = (t: TreeNode, inherited: string) => {
    t.color = t.node.color ?? inherited;
    t.children.forEach((c) => paint(c, t.color));
  };
  roots.forEach((r, i) => paint(r, AREA_COLORS[i % AREA_COLORS.length]));
  roots.forEach(compute);
  return { roots, byId };
}

// Same id → same random numbers (orbit phase, planet look) on every load.
export function seeded(id: string) {
  let a = 2166136261;
  for (let i = 0; i < id.length; i++) a = Math.imul(a ^ id.charCodeAt(i), 16777619);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Goals, missions and steps below a root, in tree order, indented by level — for a picker.
export function pickList(root: TreeNode) {
  const out: { id: string; label: string }[] = [];
  const walk = (t: TreeNode, depth: number) => {
    if (t.kind !== "area") out.push({ id: t.node.id, label: `${"   ".repeat(depth)}${t.node.title}` });
    t.children.forEach((c) => walk(c, t.kind === "area" ? depth : depth + 1));
  };
  walk(root, 0);
  return out;
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;

// Days left until a due date (negative = overdue), in the user's local calendar.
export function daysLeft(due: string | null) {
  if (!due) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((new Date(`${due}T00:00:00`).getTime() - start) / 86400000);
}
