// v2 items for the server functions (PLAN P-70): the caller's workspaces, the v1 task shape that the MCP task tools
// and the Google bodies still speak (kept identical, so the hashes stored at the last sync still match and nothing is
// sent to Google again at the cut-over), status / priority names, connector rows (item_sources).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

// Where a user's rows are: every workspace they are a member of (read), and their personal one (new rows go there).
export type Scope = { userId: string; workspaces: string[]; home: string };

export async function scopeOf(db: SupabaseClient, userId: string): Promise<Scope> {
  const { data, error } = await db.from("workspace_members").select("workspace_id, workspaces(personal_of)").eq("user_id", userId);
  if (error) throw error;
  const rows = data as unknown as { workspace_id: string; workspaces: { personal_of: string | null } | null }[];
  const home = rows.find((r) => r.workspaces?.personal_of === userId)?.workspace_id;
  if (!home) throw new Error(`no personal workspace for user ${userId}`);
  return { userId, workspaces: rows.map((r) => r.workspace_id), home };
}

// Strategy kinds of v1 (P-2); phase 5 (P-54) widens the strategy to projects, routines, options …
export const STRATEGY_TYPES = ["area", "goal", "mission", "step"];

// Status: v2 has GTD's waiting / someday too; the v1 names are what the task tools and Google speak.
export const V1_STATUS: Record<string, string> = {
  todo: "idle", doing: "active", waiting: "waiting", someday: "someday", done: "complete", dropped: "abandoned",
};
export const V2_STATUS: Record<string, string> = {
  idle: "todo", active: "doing", waiting: "waiting", someday: "someday", complete: "done", abandoned: "dropped",
};
export const PRIORITY_NAME: Record<number, string> = { 1: "urgent", 2: "high", 3: "medium", 4: "low" };
export const PRIORITY_NUM: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4 };

export const SOURCES = "item_sources(source, external_id, container, hash)";
export const TASK_COLS =
  `id, workspace_id, type, title, body, status, parent_id, position, url, planned_on, planned_time, is_event, due_on, due_time, ` +
  `priority, estimate_min, spent_min, done_at, deleted_at, created_at, ${SOURCES}`;

export type Source = { source: string; external_id: string; container: string | null; hash: string | null };
export type ItemRow = {
  id: string; workspace_id: string; type: string; title: string; body: string; status: string; parent_id: string | null;
  position: number; url: string | null; planned_on: string | null; planned_time: string | null; is_event: boolean;
  due_on: string | null; due_time: string | null; priority: number | null; estimate_min: number | null; spent_min: number;
  done_at: string | null; deleted_at: string | null; created_at: string; item_sources?: Source[];
};

export const sourceOf = (item: { item_sources?: Source[] }, source: string) => item.item_sources?.find((s) => s.source === source) ?? null;

// An item as a v1 task: the field names of the MCP task tools and of the Google event / task bodies.
export function v1Task(i: ItemRow) {
  return {
    id: i.id,
    title: i.title,
    description: i.body,
    status: V1_STATUS[i.status] ?? i.status,
    date: i.planned_on,
    start_time: i.planned_time,
    is_event: i.is_event,
    deadline: i.due_on ?? "",
    deadline_time: i.due_time,
    priority: i.priority ? PRIORITY_NAME[i.priority] : null,
    estimated_time: i.estimate_min,
    link: i.url ?? "",
    deleted_at: i.deleted_at,
  };
}

// Remember (or forget, with null) where an item lives in another system.
export async function setSource(
  db: SupabaseClient, itemId: string, source: string,
  row: { external_id: string; container?: string | null; hash?: string | null; url?: string | null; meta?: Record<string, unknown> } | null,
) {
  const { error } = row
    ? await db.from("item_sources").upsert({ item_id: itemId, source, ...row, synced_at: new Date().toISOString() }, { onConflict: "item_id,source" })
    : await db.from("item_sources").delete().eq("item_id", itemId).eq("source", source);
  if (error) throw error;
}

export async function setSourceHash(db: SupabaseClient, itemId: string, source: string, hash: string) {
  const { error } = await db.from("item_sources").update({ hash, synced_at: new Date().toISOString() }).eq("item_id", itemId).eq("source", source);
  if (error) throw error;
}
