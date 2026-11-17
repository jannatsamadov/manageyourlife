// Strategy tree for MCP (P-2) on the v2 items (P-70): area / goal / mission / step items and the tasks inside them.
// The same progress rules as the app (src/lib/strategy.ts) — keep them in step. The tools still speak the v1 node
// shape (kind, description, open / done / dropped, start_date, due_date).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { type Scope, STRATEGY_TYPES, V1_STATUS } from "../_shared/items.ts";

export const ITEM_NODE_COLS = "id, workspace_id, parent_id, type, title, body, status, weight, target_count, progress, start_on, due_on, position";
export const CHILD_KIND: Record<string, string> = { area: "goal", goal: "mission", mission: "step", step: "step" };

type Row = {
  id: string; workspace_id: string; parent_id: string | null; kind: string; title: string; description: string; status: string;
  weight: number; target_count: number | null; progress: number | null; start_date: string | null; due_date: string | null; position: number;
};
type LinkedTask = { id: string; title: string; status: string; date: string | null };
export type Node = Row & { children: Node[]; tasks: LinkedTask[]; value: number; slots: number };

// An item as a v1 strategy node.
// deno-lint-ignore no-explicit-any
export const nodeOut = (i: any): Row => ({
  id: i.id, workspace_id: i.workspace_id, parent_id: i.parent_id, kind: i.type, title: i.title, description: i.body,
  status: i.status === "done" || i.status === "dropped" ? i.status : "open", weight: Number(i.weight), target_count: i.target_count,
  progress: i.progress === null ? null : Number(i.progress), start_date: i.start_on, due_date: i.due_on, position: i.position,
});

// done → 1; "at least N" → done children counted out of N; children → weighted average (dropped ones out);
// leaf → share of its tasks done (abandoned ignored); else the value set by hand.
function compute(t: Node) {
  t.children.forEach(compute);
  const live = t.children.filter((c) => c.status !== "dropped");
  const target = t.target_count ?? 0;
  t.slots = Math.max(0, target - live.length);
  let value: number;
  if (t.status === "done") value = 1;
  else if (target > 0) value = Math.min(target, live.reduce((s, c) => s + c.value, 0)) / target;
  else if (live.length) {
    const total = live.reduce((s, c) => s + Number(c.weight), 0);
    value = live.reduce((s, c) => s + Number(c.weight) * c.value, 0) / total;
  } else if (t.tasks.length) value = t.tasks.filter((x) => x.status === "complete").length / t.tasks.length;
  else value = Number(t.progress ?? 0);
  t.value = Math.min(1, Math.max(0, value));
}

export async function loadTree(db: SupabaseClient, scope: Scope) {
  const nodes = await db.from("items").select(ITEM_NODE_COLS).in("workspace_id", scope.workspaces).in("type", STRATEGY_TYPES)
    .is("deleted_at", null).order("position").order("created_at");
  if (nodes.error) throw nodes.error;
  const tasks = await db.from("items").select("id, title, status, parent_id, planned_on").in("workspace_id", scope.workspaces)
    .eq("type", "task").is("deleted_at", null).not("parent_id", "is", null).neq("status", "dropped");
  if (tasks.error) throw tasks.error;
  const byId = new Map<string, Node>();
  for (const n of nodes.data) byId.set(n.id, { ...nodeOut(n), children: [], tasks: [], value: 0, slots: 0 });
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  for (const t of tasks.data) {
    byId.get(t.parent_id)?.tasks.push({ id: t.id, title: t.title, status: V1_STATUS[t.status] ?? t.status, date: t.planned_on });
  }
  roots.forEach(compute);
  return { roots, byId };
}

// What the client sees: progress rounded, empty fields left out, levels below `depth` only counted.
export function present(n: Node, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { id: n.id, kind: n.kind, title: n.title, status: n.status, progress: Math.round(n.value * 100) / 100 };
  if (Number(n.weight) !== 1) out.weight = Number(n.weight);
  if (n.target_count) out.target_count = n.target_count;
  if (n.slots) out.missing = n.slots;
  if (n.start_date) out.start_date = n.start_date;
  if (n.due_date) out.due_date = n.due_date;
  if (n.progress !== null && !n.children.length && !n.tasks.length) out.progress_by_hand = Number(n.progress);
  if (n.description) out.description = n.description;
  if (n.tasks.length) out.tasks = n.tasks.map(({ id, title, status, date }) => ({ id, title, status, date }));
  if (n.children.length) {
    if (depth > 1) out.children = n.children.map((c) => present(c, depth - 1));
    else out.children_count = n.children.length;
  }
  return out;
}
