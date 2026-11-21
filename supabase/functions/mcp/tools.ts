// MCP tools (P-18). The client is the service role: every query is limited to the token owner's workspaces (v2 items,
// P-70) or their own vault. Tool names and fields stay as in v1, so connected clients keep working.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { CHILD_KIND, ITEM_NODE_COLS, loadTree, nodeOut, present } from "./strategy.ts";
import { collectIdeas } from "../_shared/ideas.ts";
import { PRIORITY_NAME, PRIORITY_NUM, type Scope, STRATEGY_TYPES, V1_STATUS, V2_STATUS } from "../_shared/items.ts";
import { editNote, INBOX, moveFile, noteById, readNote, safeName, VaultError, writeNote } from "../_shared/vault.ts";
import { addCapture } from "../_shared/capture.ts";

export type Ctx = { db: SupabaseClient; userId: string; scope: Scope };

export type Tool = {
  name: string;
  title: string;
  description: string;
  scope: "read" | "write";
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  run: (args: any, ctx: Ctx) => Promise<Record<string, unknown>>;
};

// Shown to the caller as a tool error (bad input, not found) instead of a server error.
export class ToolError extends Error {}

const need = (ok: unknown, message: string) => {
  if (!ok) throw new ToolError(message);
};
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const limitOf = (v: unknown, def: number, max: number) => (Number.isInteger(v) ? Math.min(Math.max(v as number, 1), max) : def);
// Characters that would break a PostgREST or() filter.
const searchTerm = (v: unknown) => (typeof v === "string" ? v.replace(/[,()*%\\"]/g, " ").trim() : "");
const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};
// Writes the DB refuses by its own rules (strategy shape, checks, a node of another user) are the caller's mistake.
const checkWrite = <T>({ data, error }: { data: T; error: { code?: string; message: string } | null }) => {
  if (error) {
    if (["P0001", "23514", "23503"].includes(error.code ?? "")) throw new ToolError(error.message);
    throw error;
  }
  return data;
};

const STATUSES = ["idle", "active", "waiting", "someday", "complete", "abandoned"];
const PRIORITIES = ["urgent", "high", "medium", "low"];
const KINDS = ["idea", "question", "todo", "resource"];
const TASK_COLS =
  "id, workspace_id, title, body, status, parent_id, planned_on, planned_time, is_event, due_on, due_time, priority, estimate_min, " +
  "spent_min, url, props, created_at";
const isTime = (v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const NODE_STATUSES = ["open", "done", "dropped"];
const DATE = { type: "string", description: "YYYY-MM-DD" };
const ID = { type: "string", description: "uuid" };

// A task item in the v1 field names of the tools; node_id = the strategy node it sits in, parent_task_id = the task
// it is a step of.
const taskOut = (i: any) => ({
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
  estimated_minutes: i.estimate_min,
  spent_minutes: i.spent_min || undefined,
  link: i.url ?? "",
  node_id: i.parent && STRATEGY_TYPES.includes(i.parent.type) ? i.parent.id : null,
  parent_task_id: i.parent?.type === "task" ? i.parent.id : undefined,
  fields: i.fields,
  created_at: i.created_at,
});

// ── custom fields (the workspace's `fields`, values in items.props; e.g. Who: Me / With AI / AI) ──
type Field = { workspace_id: string; key: string; name: string; kind: string; options: { id: string; name: string }[] };
async function fieldsOf({ db, scope }: Ctx): Promise<Field[]> {
  return check(await db.from("fields").select("workspace_id, key, name, kind, options").in("workspace_id", scope.workspaces).order("position")) as Field[];
}
// An item's custom values by field name, select options by their names: { "Who": "AI" }.
function fieldValues(fields: Field[], item: any) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.workspace_id !== item.workspace_id) continue;
    const v = item.props?.[f.key];
    if (v === null || v === undefined || v === "") continue;
    out[f.name] = f.kind === "select" ? (f.options.find((o) => o.id === v)?.name ?? v) : v;
  }
  return Object.keys(out).length ? out : undefined;
}
// { "Who": "AI" } (field name or key; an option's name or id; null clears) → props keys and values.
function fieldInput(fields: Field[], workspaceId: string, input: unknown): Record<string, unknown> {
  // Some clients send an object as JSON text (an older copy of the schema without this property).
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { /* checked below */ } }
  need(input && typeof input === "object" && !Array.isArray(input), "fields: an object like {\"Who\": \"AI\"}");
  const own = fields.filter((f) => f.workspace_id === workspaceId);
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const f = own.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.key === name);
    need(f, `no field "${name}"; fields: ${own.map((x) => x.name).join(", ") || "none"}`);
    if (raw === null) { out[f!.key] = null; continue; }
    switch (f!.kind) {
      case "select": {
        const o = f!.options.find((x) => x.id === raw || x.name.toLowerCase() === String(raw).toLowerCase());
        need(o, `${f!.name}: one of ${f!.options.map((x) => x.name).join(", ")}`);
        out[f!.key] = o!.id;
        break;
      }
      case "checkbox": need(typeof raw === "boolean", `${f!.name}: true or false`); out[f!.key] = raw; break;
      case "number": need(typeof raw === "number" && Number.isFinite(raw), `${f!.name}: a number`); out[f!.key] = raw; break;
      case "date": need(isDate(raw), `${f!.name}: YYYY-MM-DD`); out[f!.key] = raw; break;
      default: need(typeof raw === "string" && raw.length <= 2000, `${f!.name}: text up to 2000 characters`); out[f!.key] = raw;
    }
  }
  return out;
}
// The parent of each task (PostgREST does not embed a table in itself without a computed relationship).
async function tasksOut(ctx: Ctx, rows: any[]) {
  const ids = [...new Set(rows.map((r) => r.parent_id).filter(Boolean))];
  const parents = ids.length ? check(await ctx.db.from("items").select("id, type, title").in("id", ids)) as any[] : [];
  const byId = new Map(parents.map((p) => [p.id, p]));
  const fields = rows.some((r) => r.props && Object.keys(r.props).length) ? await fieldsOf(ctx) : [];
  return rows.map((r) => taskOut({ ...r, parent: r.parent_id ? byId.get(r.parent_id) ?? null : null, fields: fieldValues(fields, r) }));
}
const taskOutOne = async (ctx: Ctx, row: any) => (await tasksOut(ctx, [row]))[0];
const nodePublic = (i: any) => {
  const { workspace_id: _, ...n } = nodeOut(i);
  return n;
};

// Tool fields (v1 names) → item columns.
function taskFields(a: any, creating: boolean) {
  const row: Record<string, unknown> = {};
  if (creating || a.title !== undefined) {
    need(isText(a.title, 500), "title: 1–500 characters");
    row.title = a.title.trim();
  }
  if (a.description !== undefined) {
    need(typeof a.description === "string" && a.description.length <= 20000, "description: text up to 20000 characters");
    row.body = a.description;
  }
  if (a.status !== undefined) {
    need(STATUSES.includes(a.status), `status: one of ${STATUSES.join(", ")}`);
    row.status = V2_STATUS[a.status];
  }
  if (a.date !== undefined) {
    need(a.date === null || isDate(a.date), "date: YYYY-MM-DD or null (unscheduled)");
    row.planned_on = a.date;
  }
  if (a.deadline !== undefined) {
    need(a.deadline === null || a.deadline === "" || isDate(a.deadline), "deadline: YYYY-MM-DD, or null to clear");
    row.due_on = a.deadline || null;
  }
  // When it happens (P-60): times go with a date / a deadline; the database drops them when those are cleared.
  if (a.start_time !== undefined) {
    need(a.start_time === null || isTime(a.start_time), "start_time: HH:MM (24 h) or null");
    row.planned_time = a.start_time;
  }
  if (a.deadline_time !== undefined) {
    need(a.deadline_time === null || isTime(a.deadline_time), "deadline_time: HH:MM (24 h) or null");
    row.due_time = a.deadline_time;
  }
  if (a.is_event !== undefined) {
    need(typeof a.is_event === "boolean", "is_event: true or false");
    row.is_event = a.is_event;
    if (a.is_event && creating) need(isDate(a.date) && isTime(a.start_time), "an event needs date and start_time");
  }
  if (a.estimated_minutes !== undefined) {
    need(a.estimated_minutes === null || (Number.isInteger(a.estimated_minutes) && a.estimated_minutes > 0 && a.estimated_minutes <= 100000), "estimated_minutes: positive whole number or null");
    row.estimate_min = a.estimated_minutes;
  }
  if (a.priority !== undefined) {
    need(a.priority === null || PRIORITIES.includes(a.priority), `priority: one of ${PRIORITIES.join(", ")}, or null`);
    row.priority = a.priority === null ? null : PRIORITY_NUM[a.priority];
  }
  if (a.link !== undefined) {
    need(a.link === null || (typeof a.link === "string" && a.link.length <= 2000), "link: URL or null");
    row.url = a.link?.trim() || null;
  }
  if (a.node_id !== undefined) {
    need(a.node_id === null || isUuid(a.node_id), "node_id: uuid of an area / goal / mission / step, or null to unlink");
    row.parent_id = a.node_id;
  }
  return row;
}

const TASK_INPUT = {
  title: { type: "string" },
  description: { type: "string" },
  status: { type: "string", enum: STATUSES, description: "waiting = waiting for someone / something; someday = maybe later" },
  date: { ...DATE, description: "Day the task is planned for, or the day of an event (YYYY-MM-DD); null = unscheduled" },
  start_time: { type: ["string", "null"], description: "HH:MM (24 h, user's local time): an event's start, or the time block of a planned task; needs date" },
  is_event: { type: "boolean", description: "true = happens at a fixed time (meeting, exam, conference, call): needs date + start_time, estimated_minutes = its length; synced to Google Calendar as a timed event" },
  deadline: { ...DATE, description: "Due date (YYYY-MM-DD): must be done by then; null clears it" },
  deadline_time: { type: ["string", "null"], description: "HH:MM (24 h) of the deadline; needs deadline" },
  estimated_minutes: { type: "integer", minimum: 1 },
  priority: { type: "string", enum: PRIORITIES },
  link: { type: "string", description: "Related URL" },
  node_id: { type: ["string", "null"], description: "Strategy goal / mission / step this task serves (from strategy_tree); null unlinks" },
  fields: {
    type: "object",
    description: "Custom fields by name, e.g. {\"Who\": \"AI\"} — Who: Me (the user does it) / With AI (the user with an AI) / AI (an AI does it). A select takes an option name; null clears.",
  },
};

// Items of the caller's workspaces only.
const tasksOf = ({ db, scope }: Ctx) =>
  db.from("items").select(TASK_COLS).in("workspace_id", scope.workspaces).eq("type", "task").is("deleted_at", null);

// The unsorted Inbox: capture items (Telegram, inbox_add, the app) that are not done, dropped or trashed.
const capturesOf = ({ db, scope }: Ctx, opts?: { head: boolean }) =>
  db.from("items").select("id, workspace_id, title, body, url, props, created_at, item_sources(source)", opts?.head ? { count: "exact", head: true } : undefined)
    .in("workspace_id", scope.workspaces).eq("type", "capture").is("deleted_at", null).not("status", "in", "(done,dropped)");
// What an Inbox item can become (never a money type: money stays out of MCP).
const SORT_TYPES = ["task", "idea", "project", "routine", "milestone", "option", "obstacle", "area", "goal", "mission", "step"];

async function ownTask(ctx: Ctx, id: unknown) {
  need(isUuid(id), "task id: uuid");
  const task = check(await tasksOf(ctx).eq("id", id).maybeSingle());
  need(task, "task not found");
  return task as any;
}

async function ownNode({ db, scope }: Ctx, id: unknown) {
  need(isUuid(id), "strategy node id: uuid");
  const node = check(await db.from("items").select(ITEM_NODE_COLS).in("workspace_id", scope.workspaces).in("type", STRATEGY_TYPES)
    .is("deleted_at", null).eq("id", id).maybeSingle());
  need(node, "strategy node not found");
  return node as any;
}

// Notes are the files of the user's vault (P-57); a missing note or a bad path is the caller's mistake.
async function inVault<T>(f: () => Promise<T>) {
  try {
    return await f();
  } catch (e) {
    if (e instanceof VaultError) throw new ToolError(e.message);
    throw e;
  }
}

async function ownNote(db: SupabaseClient, userId: string, id: unknown) {
  need(isUuid(id), "note id: uuid");
  return inVault(async () => {
    const { path } = await noteById(db, userId, id);
    const note = await readNote(db, userId, path);
    return { id: note.id!, path, title: path.split("/").pop()!.replace(/\.md$/i, ""), content: note.text };
  });
}

const NOTE_FOLDER = INBOX; // where new notes go unless a folder is given
const notePath = (folder: unknown, title: string) => {
  const dir = typeof folder === "string" ? folder.trim().replace(/^\/+|\/+$/g, "") : NOTE_FOLDER;
  return `${dir ? `${dir}/` : ""}${safeName(title) || "Untitled"}.md`;
};

// ── any item (P-70 item 11, T-113): the generic tools, on the DB's type registry (item_types). Private types (money)
//    never go in or out, and neither do the cost columns. Field names are the item's own (v2) ones. ──
const V2_STATUSES = ["todo", "doing", "waiting", "someday", "done", "dropped"];
const ITEM_COLS =
  "id, workspace_id, type, title, body, status, parent_id, position, url, color, planned_on, planned_time, is_event, start_on, " +
  "due_on, due_time, done_at, priority, estimate_min, spent_min, weight, target_count, progress, props, created_at, updated_at";
const ORDERS: Record<string, [string, boolean]> = {
  updated: ["updated_at", false], created: ["created_at", false], planned: ["planned_on", true], due: ["due_on", true],
  priority: ["priority", true], position: ["position", true],
};
const EXCERPT = 280;

// The types an AI may see, from the registry.
async function publicTypes(db: SupabaseClient) {
  const rows = check(await db.from("item_types").select("type, private").order("type")) as { type: string; private: boolean }[];
  return rows.filter((r) => !r.private).map((r) => r.type);
}

// An item in its own field names; empty values left out (fewer tokens); the text cut in lists.
function itemOut(i: any, parent: any, fields: Field[], full: boolean) {
  const out: Record<string, unknown> = { id: i.id, type: i.type, title: i.title, status: i.status };
  const text: string = i.body ?? "";
  if (text) out[full ? "description" : "excerpt"] = full || text.length <= EXCERPT ? text : `${text.slice(0, EXCERPT)}…`;
  if (parent) out.parent = { id: parent.id, type: parent.type, title: parent.title };
  const rest: Record<string, unknown> = {
    priority: i.priority ? PRIORITY_NAME[i.priority] : null, planned_on: i.planned_on, planned_time: i.planned_time,
    is_event: i.is_event || null, start_on: i.start_on, due_on: i.due_on, due_time: i.due_time, estimate_min: i.estimate_min,
    spent_min: i.spent_min || null, url: i.url, color: i.color, weight: Number(i.weight) !== 1 ? Number(i.weight) : null,
    target_count: i.target_count, progress: i.progress === null ? null : Number(i.progress), done_at: i.done_at,
    fields: fieldValues(fields, i),
  };
  for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) out[k] = v;
  out.updated_at = i.updated_at;
  return out;
}
async function itemsOut(ctx: Ctx, rows: any[], types: string[], full = false) {
  const ids = [...new Set(rows.map((r) => r.parent_id).filter(Boolean))];
  const parents = ids.length ? check(await ctx.db.from("items").select("id, type, title").in("id", ids).in("type", types)) as any[] : [];
  const byId = new Map(parents.map((p) => [p.id, p]));
  const fields = rows.some((r) => r.props && Object.keys(r.props).length) ? await fieldsOf(ctx) : [];
  return rows.map((r) => itemOut(r, r.parent_id ? byId.get(r.parent_id) : null, fields, full));
}

async function ownItem(ctx: Ctx, id: unknown, types: string[]) {
  need(isUuid(id), "id: uuid");
  const item = check(await ctx.db.from("items").select(ITEM_COLS).in("workspace_id", ctx.scope.workspaces).in("type", types)
    .is("deleted_at", null).eq("id", id).maybeSingle());
  need(item, "item not found");
  return item as any;
}

// item_update's fields → columns.
function itemPatch(a: any, types: string[]) {
  const row: Record<string, unknown> = {};
  const set = (key: string, ok: (v: any) => boolean, msg: string, map: (v: any) => unknown = (v) => v, col = key) => {
    if (a[key] === undefined) return;
    need(ok(a[key]), `${key}: ${msg}`);
    row[col] = map(a[key]);
  };
  set("title", (v) => isText(v, 500), "1–500 characters", (v) => v.trim());
  set("description", (v) => typeof v === "string" && v.length <= 100000, "text up to 100000 characters", (v) => v, "body");
  set("type", (v) => types.includes(v), `one of ${types.join(", ")}`);
  set("status", (v) => V2_STATUSES.includes(v), `one of ${V2_STATUSES.join(", ")}`);
  set("priority", (v) => v === null || PRIORITIES.includes(v), `one of ${PRIORITIES.join(", ")}, or null`, (v) => (v === null ? null : PRIORITY_NUM[v]));
  for (const k of ["planned_on", "start_on", "due_on"]) set(k, (v) => v === null || isDate(v), "YYYY-MM-DD or null");
  for (const k of ["planned_time", "due_time"]) set(k, (v) => v === null || isTime(v), "HH:MM (24 h) or null");
  set("is_event", (v) => typeof v === "boolean", "true or false");
  set("estimate_min", (v) => v === null || (Number.isInteger(v) && v > 0 && v <= 100000), "positive whole number or null");
  set("url", (v) => v === null || (typeof v === "string" && v.length <= 2000), "URL or null", (v) => v?.trim() || null);
  set("color", (v) => v === null || (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)), "#rrggbb or null");
  set("weight", (v) => typeof v === "number" && v > 0 && v <= 100, "a number above 0, up to 100");
  set("target_count", (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1000), "1–1000 or null");
  set("progress", (v) => v === null || (typeof v === "number" && v >= 0 && v <= 1), "0–1 or null");
  set("parent_id", (v) => v === null || isUuid(v), "uuid or null (no parent)");
  return row;
}

const ITEM_TYPES_TEXT =
  "area, goal, mission, step (the strategy), project, routine, milestone, option, obstacle, task, idea, capture (the unsorted Inbox)";

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS: Tool[] = [
  {
    name: "today",
    title: "Today's plan",
    description: "Tasks planned for a day, overdue tasks, the number of unsorted Inbox items and of notes in the Inbox folder. Pass the user's local date.",
    scope: "read",
    inputSchema: { type: "object", properties: { date: { ...DATE, description: "The user's local date; default: today in UTC" } } },
    annotations: READ,
    run: async ({ date }, ctx) => {
      const { db, userId } = ctx;
      const day = isDate(date) ? date : new Date().toISOString().slice(0, 10);
      const planned = check(await tasksOf(ctx)
        .eq("planned_on", day).neq("status", "dropped").order("planned_time", { ascending: true, nullsFirst: false }).order("position"));
      const overdue = check(await tasksOf(ctx)
        .not("due_on", "is", null).lt("due_on", day).not("status", "in", "(done,dropped)").order("due_on"));
      const { count, error } = await db.from("vault_files").select("id", { count: "exact", head: true }).eq("user_id", userId)
        .is("trashed_at", null).like("path", `${INBOX}/%`).ilike("path", "%.md");
      if (error) throw error;
      const inbox = await capturesOf(ctx, { head: true });
      return {
        date: day, planned: await tasksOut(ctx, planned as any[]), overdue: await tasksOut(ctx, overdue as any[]),
        inbox_items: inbox.count ?? 0, inbox_notes: count ?? 0,
      };
    },
  },
  {
    name: "tasks_list",
    title: "List tasks",
    description: "Find tasks. Without filters: all tasks except abandoned ones, scheduled first by date. Trashed tasks are never listed.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUSES },
        date_from: { ...DATE, description: "Planned on or after (YYYY-MM-DD)" },
        date_to: { ...DATE, description: "Planned on or before (YYYY-MM-DD)" },
        unscheduled: { type: "boolean", description: "Only tasks without a planned day" },
        node_id: { ...ID, description: "Only tasks directly inside this strategy node (or this task: its steps)" },
        search: { type: "string", description: "Text in title or description" },
        fields: { type: "object", description: "Only tasks with these custom values, e.g. {\"Who\": \"AI\"} for the tasks an AI should do" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
    annotations: READ,
    run: async (a, ctx) => {
      let q = tasksOf(ctx);
      if (a.fields !== undefined) {
        const values = fieldInput(await fieldsOf(ctx), ctx.scope.home, a.fields);
        for (const [key, v] of Object.entries(values)) q = v === null ? q.is(`props->>${key}`, null) : q.eq(`props->>${key}`, String(v));
      }
      if (a.status !== undefined) {
        need(STATUSES.includes(a.status), `status: one of ${STATUSES.join(", ")}`);
        q = q.eq("status", V2_STATUS[a.status]);
      } else q = q.neq("status", "dropped");
      if (a.date_from !== undefined) { need(isDate(a.date_from), "date_from: YYYY-MM-DD"); q = q.gte("planned_on", a.date_from); }
      if (a.date_to !== undefined) { need(isDate(a.date_to), "date_to: YYYY-MM-DD"); q = q.lte("planned_on", a.date_to); }
      if (a.unscheduled) q = q.is("planned_on", null);
      if (a.node_id !== undefined) { need(isUuid(a.node_id), "node_id: uuid"); q = q.eq("parent_id", a.node_id); }
      const term = searchTerm(a.search);
      if (term) q = q.or(`title.ilike.*${term}*,body.ilike.*${term}*`);
      const rows = check(await q.order("planned_on", { ascending: true, nullsFirst: false }).order("position").limit(limitOf(a.limit, 50, 200)));
      return { tasks: await tasksOut(ctx, rows as any[]) };
    },
  },
  {
    name: "task_get",
    title: "Get a task",
    description: "One task with its subtasks and linked notes.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: READ,
    run: async ({ id }, ctx) => {
      const { db } = ctx;
      const task = await ownTask(ctx, id);
      const steps = check(await db.from("items").select("id, title, status, position").eq("parent_id", task.id).eq("type", "task")
        .is("deleted_at", null).order("position")) as any[];
      const subtasks = steps.map(({ status, ...s }) => ({ ...s, completed: status === "done" }));
      const links = check(await db.from("item_links").select("vault_files(id, title, path, trashed_at)").eq("from_id", task.id).eq("kind", "note"));
      const notes = (links as any[]).map((l) => l.vault_files).filter((n) => n && !n.trashed_at).map(({ trashed_at: _, ...n }) => n);
      return { ...(await taskOutOne(ctx, task)), subtasks, notes };
    },
  },
  {
    name: "task_create",
    title: "Create a task",
    description: "Create a task. Pick its kind: an event at a fixed time (is_event + date + start_time: meetings, exams, calls), a planned task (date, optional start_time = time block), a deadline (deadline, optional deadline_time: must be done by), or none (no date, no deadline: it waits in the backlog). node_id links it to a strategy goal / mission / step.",
    scope: "write",
    inputSchema: { type: "object", properties: TASK_INPUT, required: ["title"] },
    annotations: WRITE,
    run: async (a, ctx) => {
      const { db, userId, scope } = ctx;
      const row: Record<string, unknown> = { priority: 3, ...taskFields(a, true), type: "task", workspace_id: scope.home, created_by: userId };
      if (row.parent_id) row.workspace_id = (await ownNode(ctx, row.parent_id)).workspace_id;
      if (a.fields !== undefined) row.props = fieldInput(await fieldsOf(ctx), row.workspace_id as string, a.fields);
      return taskOutOne(ctx, checkWrite(await db.from("items").insert(row).select(TASK_COLS).single()));
    },
  },
  {
    name: "task_update",
    title: "Update a task",
    description: "Change any fields of a task: title, description, status (idle/active/complete/abandoned), planned date (null = unscheduled, which also drops its time and event mark), start_time, is_event, deadline, deadline_time, estimate, priority, link, strategy node (node_id; null unlinks), custom fields (fields, e.g. {\"Who\": \"AI\"}).",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID, ...TASK_INPUT }, required: ["id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, ...a }, ctx) => {
      const { db } = ctx;
      const task = await ownTask(ctx, id);
      const row = taskFields(a, false);
      if (a.fields !== undefined) row.props = { ...(task.props ?? {}), ...fieldInput(await fieldsOf(ctx), task.workspace_id, a.fields) };
      need(Object.keys(row).length, "nothing to change");
      if (row.parent_id) need((await ownNode(ctx, row.parent_id)).workspace_id === task.workspace_id, "that node is in another workspace");
      return taskOutOne(ctx, checkWrite(await db.from("items").update(row).eq("id", task.id).select(TASK_COLS).single()));
    },
  },
  {
    name: "task_trash",
    title: "Move a task to Trash",
    description: "Move a task to the Trash (the user can restore it in the app).",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    run: async ({ id }, ctx) => {
      const task = await ownTask(ctx, id);
      check(await ctx.db.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", task.id));
      return { id, title: task.title, trashed: true };
    },
  },
  {
    name: "subtask_add",
    title: "Add a subtask",
    description: "Add a checklist item to a task.",
    scope: "write",
    inputSchema: { type: "object", properties: { task_id: ID, title: { type: "string" } }, required: ["task_id", "title"] },
    annotations: WRITE,
    run: async ({ task_id, title }, ctx) => {
      const { db, userId } = ctx;
      const task = await ownTask(ctx, task_id);
      need(isText(title, 500), "title: 1–500 characters");
      const { count } = await db.from("items").select("id", { count: "exact", head: true }).eq("parent_id", task.id).eq("type", "task");
      const step = check(await db.from("items").insert({
        workspace_id: task.workspace_id, type: "task", parent_id: task.id, title: title.trim(), position: count ?? 0, created_by: userId,
      }).select("id, title, status, position").single()) as any;
      return { id: step.id, title: step.title, completed: false, position: step.position };
    },
  },
  {
    name: "subtask_update",
    title: "Update a subtask",
    description: "Tick / untick or rename a subtask.",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID, completed: { type: "boolean" }, title: { type: "string" } }, required: ["id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, completed, title }, ctx) => {
      need(isUuid(id), "id: uuid");
      const row: Record<string, unknown> = {};
      if (completed !== undefined) { need(typeof completed === "boolean", "completed: true or false"); row.status = completed ? "done" : "todo"; }
      if (title !== undefined) { need(isText(title, 500), "title: 1–500 characters"); row.title = title.trim(); }
      need(Object.keys(row).length, "nothing to change");
      const sub = check(await ctx.db.from("items").update(row).in("workspace_id", ctx.scope.workspaces).eq("type", "task").eq("id", id)
        .select("id, title, status, position").maybeSingle()) as any;
      need(sub, "subtask not found");
      return { id: sub.id, title: sub.title, completed: sub.status === "done", position: sub.position };
    },
  },
  {
    name: "notes_search",
    title: "Search notes",
    description:
      "Find notes (all of the user's notes: Markdown files in folders, Obsidian style) by text in the name, path or content; " +
      "folder narrows to one folder and its sub-folders. Without query: the most recently changed notes.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, folder: { type: "string", description: "e.g. \"Notes/İdeyalar\"" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    },
    annotations: READ,
    run: async ({ query, folder, limit }, { db, userId }) => {
      let q = db.from("vault_files").select("id, path, title, tags, body, modified_at").eq("user_id", userId).is("trashed_at", null).ilike("path", "%.md");
      const term = searchTerm(query);
      if (term) q = q.or(`path.ilike.*${term}*,body.ilike.*${term}*`);
      if (typeof folder === "string" && folder.trim()) q = q.like("path", `${folder.trim().replace(/^\/+|\/+$/g, "").replace(/[%_\\]/g, "\\$&")}/%`);
      const rows = check(await q.order("modified_at", { ascending: false }).limit(limitOf(limit, 20, 100))) as any[];
      return {
        notes: rows.map(({ body, modified_at, ...n }) => {
          const text = body ?? "";
          const at = term ? Math.max(text.toLowerCase().indexOf(term.toLowerCase()) - 80, 0) : 0;
          return { ...n, updated_at: modified_at, snippet: text.slice(at, at + 300) };
        }),
      };
    },
  },
  {
    name: "ideas_list",
    title: "List ideas",
    description:
      "Every idea in the user's notes and projects in one list: notes in an ideas folder (e.g. Notes/İdeyalar) or tagged #idea, " +
      "items under an \"Ideas\" / \"İdeyalar\" heading (Telegram captures too), plan items marked IDEA, task-table rows with status IDEA. " +
      "Newest first; query filters by text, folder by path prefix.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, folder: { type: "string", description: "e.g. \"Projects/clsmng\"" }, limit: { type: "integer", minimum: 1, maximum: 300, default: 100 } },
    },
    annotations: READ,
    run: async ({ query, folder, limit }, { db, userId }) => {
      const term = typeof query === "string" ? query.trim().toLowerCase() : "";
      const prefix = typeof folder === "string" ? folder.trim().replace(/^\/+|\/+$/g, "") : "";
      const ideas = (await collectIdeas(db, userId))
        .filter((i) => (!term || `${i.text} ${i.detail ?? ""} ${i.path}`.toLowerCase().includes(term)) && (!prefix || i.path.startsWith(`${prefix}/`)))
        .slice(0, limitOf(limit, 100, 300));
      return { ideas: ideas.map(({ file_id, ...i }) => ({ note_id: file_id, ...i })) };
    },
  },
  {
    name: "note_get",
    title: "Get a note",
    description: "Full Markdown content of a note and the tasks linked to it.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: READ,
    run: async ({ id }, { db, userId, scope }) => {
      const note = await ownNote(db, userId, id);
      const links = check(await db.from("item_links").select("items!item_links_from_fkey(id, type, title, status, deleted_at, item_types(private))")
        .in("workspace_id", scope.workspaces).eq("file_id", note.id).eq("kind", "note")) as any[];
      // Private types (money) never reach MCP.
      const tasks = links.map((l) => l.items).filter((i) => i && !i.deleted_at && !i.item_types?.private)
        .map((i) => ({ id: i.id, title: i.title, status: i.type === "task" ? V1_STATUS[i.status] : i.status, ...(i.type === "task" ? {} : { type: i.type }) }));
      return { ...note, tasks };
    },
  },
  {
    name: "note_create",
    title: "Create a note",
    description:
      "Create a Markdown note (a file; the title is its file name) in the folder where it belongs — pick an existing folder " +
      "(see the paths notes_search returns); \"\" = top level. Not the Inbox: that is for the user's own raw captures. " +
      "\"- [ ] item\" lines are to-dos; [[Note name]] links to another note.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" }, folder: { type: "string", description: "Folder path, e.g. \"Projects/Dissertation\"; \"\" = top level" } },
      required: ["title", "folder"],
    },
    annotations: WRITE,
    run: async ({ title, content, folder }, { db, userId }) => {
      need(isText(title, 150), "title: 1–150 characters");
      need(typeof folder === "string", "folder: the folder the note belongs in (\"\" = top level)");
      need(content === undefined || (typeof content === "string" && content.length <= 200000), "content: text up to 200000 characters");
      const r = await inVault(() => writeNote(db, userId, notePath(folder, title), content ?? "", null));
      need(!("conflict" in r), "a note with this name is already in that folder");
      return r as Record<string, unknown>;
    },
  },
  {
    name: "note_update",
    title: "Update a note",
    description:
      "Rename a note, move it to another folder, replace its content, or append text to the end (append keeps what is there).",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        title: { type: "string" },
        folder: { type: "string", description: "Move to this folder (\"\" = top level)" },
        content: { type: "string", description: "New full content" },
        append: { type: "string", description: "Text added at the end" },
      },
      required: ["id"],
    },
    annotations: WRITE,
    run: async ({ id, title, folder, content, append }, { db, userId }) => {
      const note = await ownNote(db, userId, id);
      need(!(content !== undefined && append !== undefined), "use content or append, not both");
      need(title !== undefined || folder !== undefined || content !== undefined || append !== undefined, "nothing to change");
      if (title !== undefined) need(isText(title, 150), "title: 1–150 characters");
      if (content !== undefined) need(typeof content === "string" && content.length <= 200000, "content: text up to 200000 characters");
      if (append !== undefined) need(isText(append, 200000), "append: non-empty text");
      let path = note.path;
      if (title !== undefined || folder !== undefined) {
        const dir = folder !== undefined ? folder : path.split("/").slice(0, -1).join("/");
        path = (await inVault(() => moveFile(db, userId, note.path, notePath(dir, title ?? note.title)))).path;
      }
      if (content !== undefined || append !== undefined) {
        await inVault(() => editNote(db, userId, path, (text) =>
          content !== undefined ? content : text?.trim() ? `${text.replace(/\s+$/, "")}\n\n${append}\n` : `${append}\n`));
      }
      return ownNote(db, userId, id);
    },
  },
  {
    name: "note_link_task",
    title: "Link a note to a task",
    description: "Link a note and a task (both show the link in the app).",
    scope: "write",
    inputSchema: { type: "object", properties: { note_id: ID, task_id: ID }, required: ["note_id", "task_id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ note_id, task_id }, ctx) => {
      const { db, userId } = ctx;
      const note = await ownNote(db, userId, note_id);
      const task = await ownTask(ctx, task_id);
      // The note's "- [ ]" lines stay in the note (no copies; v2 phase 4 makes them items of their own).
      const { error } = await db.from("item_links").insert({ from_id: task.id, file_id: note.id, kind: "note", created_by: userId });
      if (error && error.code !== "23505") checkWrite({ data: null, error }); // 23505: linked already
      return { note_id, task_id, linked: true };
    },
  },
  {
    name: "inbox_list",
    title: "List the Inbox",
    description:
      "The Inbox = everything captured and not sorted yet: items from Telegram, inbox_add and the app (newest first; kind = the " +
      "sender's hint idea / question / todo / resource, or none), plus the notes in the Inbox folder (read one with note_get). " +
      "Sort an item with inbox_sort (make it a task, an idea, a project … under a goal / project, with dates), drop or trash it there.",
    scope: "read",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } } },
    annotations: READ,
    run: async ({ limit }, ctx) => {
      const { db, userId } = ctx;
      const n = limitOf(limit, 50, 200);
      const items = check(await capturesOf(ctx).order("created_at", { ascending: false }).limit(n)) as any[];
      const notes = check(await db.from("vault_files").select("id, path, title, body, modified_at").eq("user_id", userId).is("trashed_at", null)
        .like("path", `${INBOX}/%`).ilike("path", "%.md").order("modified_at", { ascending: false }).limit(n)) as any[];
      return {
        items: items.map((i) => ({
          id: i.id, title: i.title, text: i.body || undefined, link: i.url ?? undefined, kind: i.props?.kind ?? null,
          from: i.item_sources?.[0]?.source ?? "app", created_at: i.created_at,
        })),
        notes: notes.map(({ body, modified_at, ...note }) => ({ ...note, updated_at: modified_at, snippet: (body ?? "").slice(0, 500) })),
      };
    },
  },
  {
    name: "inbox_add",
    title: "Add to the Inbox",
    description:
      "Only when the user asks to drop something into their Inbox as is (the Inbox holds the user's own raw captures). " +
      "Anything you can place yourself, create in its place instead: task_create, note_create in its folder, strategy_add. " +
      "One Inbox item; the first line is its title, the rest its text; kind is a hint for sorting.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        kind: { type: "string", enum: KINDS },
        url: { type: "string", description: "Link back to the source" },
      },
      required: ["content"],
    },
    annotations: WRITE,
    run: async ({ content, kind, url }, { db, userId, scope }) => {
      need(isText(content, 20000), "content: 1–20000 characters");
      need(kind === undefined || KINDS.includes(kind), `kind: one of ${KINDS.join(", ")}`);
      need(url === undefined || (typeof url === "string" && url.length <= 2000), "url: up to 2000 characters");
      const saved = await addCapture(db, {
        workspaceId: scope.home, userId, text: content, more: url ? [url] : [], kind: kind ?? null,
        source: { source: "mcp", external_id: crypto.randomUUID(), url: url ?? null },
      });
      return { id: saved!.id, title: saved!.title, in: "Inbox" };
    },
  },
  {
    name: "inbox_sort",
    title: "Sort an Inbox item",
    description:
      "Sort one Inbox item (from inbox_list): give it its type (task, idea, project …), optionally a parent (a strategy node from " +
      "strategy_tree, a project, a task …; the type decides which parents fit), a title / text, a planned date, a deadline, a " +
      "priority, an estimate. status abandoned = not worth doing; trash = true moves it to the Trash. Ask the user when unsure.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        type: { type: "string", enum: SORT_TYPES },
        parent_id: { type: ["string", "null"], description: "uuid of the item it belongs to; null = none" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: STATUSES },
        date: { ...DATE, description: "Planned day (YYYY-MM-DD)" },
        deadline: { ...DATE, description: "Due date (YYYY-MM-DD)" },
        priority: { type: "string", enum: PRIORITIES },
        estimated_minutes: { type: "integer", minimum: 1 },
        trash: { type: "boolean" },
      },
      required: ["id"],
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, type, parent_id, trash, ...a }, ctx) => {
      const { db } = ctx;
      need(isUuid(id), "id: uuid");
      const item = check(await capturesOf(ctx).eq("id", id).maybeSingle()) as any;
      need(item, "not an unsorted Inbox item (see inbox_list)");
      if (trash) {
        check(await db.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id));
        return { id, title: item.title, trashed: true };
      }
      const row = taskFields(a, false);
      if (type !== undefined) {
        need(SORT_TYPES.includes(type), `type: one of ${SORT_TYPES.join(", ")}`);
        row.type = type;
      }
      if (parent_id !== undefined) {
        need(parent_id === null || isUuid(parent_id), "parent_id: uuid or null");
        if (parent_id) {
          const parent = check(await db.from("items").select("id, type, workspace_id").in("workspace_id", ctx.scope.workspaces)
            .is("deleted_at", null).eq("id", parent_id).maybeSingle()) as any;
          need(parent && SORT_TYPES.includes(parent.type), "parent not found");
          need(parent.workspace_id === item.workspace_id, "that parent is in another workspace");
        }
        row.parent_id = parent_id;
      }
      need(Object.keys(row).length, "nothing to change");
      const saved = checkWrite(await db.from("items").update(row).eq("id", item.id)
        .select("id, type, title, parent_id, status, planned_on, due_on").single()) as any;
      return { ...saved, sorted: saved.type !== "capture" };
    },
  },
  {
    name: "strategy_tree",
    title: "Strategy tree",
    description:
      "The user's strategy: areas of life → goals → missions → steps (steps can nest), with the daily tasks that serve each node. " +
      "progress 0–1 is computed: done = 1; target_count (\"at least N\") counts done children out of N (missing = not created yet); " +
      "otherwise the weight-averaged progress of the children that are not dropped; a node without children goes by its tasks, " +
      "else by progress_by_hand. Pass id for one node's subtree; depth limits the levels returned (deeper ones only counted).",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { id: { ...ID, description: "Start at this node (default: the whole tree)" }, depth: { type: "integer", minimum: 1, maximum: 10, default: 10 } },
    },
    annotations: READ,
    run: async ({ id, depth }, { db, scope }) => {
      const { roots, byId } = await loadTree(db, scope);
      const levels = limitOf(depth, 10, 10);
      if (id !== undefined) {
        need(isUuid(id), "id: uuid");
        const node = byId.get(id);
        need(node, "strategy node not found");
        return present(node!, levels);
      }
      return { tree: roots.map((r) => present(r, levels)) };
    },
  },
  {
    name: "strategy_add",
    title: "Add to the strategy",
    description:
      "Add a node. With parent_id the kind follows the parent (area → goal, goal → mission, mission or step → step). " +
      "Without parent_id: a new area (default) or a goal outside any area (kind: \"goal\"). " +
      "target_count = \"at least N\" children (e.g. 6 articles); weight = share in the parent's progress (default 1); progress (0–1) only for a node with nothing below it.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        parent_id: ID,
        kind: { type: "string", enum: ["area", "goal"], description: "Only without parent_id" },
        title: { type: "string" },
        description: { type: "string" },
        weight: { type: "number", exclusiveMinimum: 0, maximum: 100 },
        target_count: { type: "integer", minimum: 1, maximum: 100 },
        start_date: DATE,
        due_date: DATE,
        progress: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["title"],
    },
    annotations: WRITE,
    run: async (a, ctx) => {
      const { db, userId, scope } = ctx;
      let kind: string;
      let workspace = scope.home;
      if (a.parent_id !== undefined) {
        const parent = await ownNode(ctx, a.parent_id);
        need(a.kind === undefined, "kind: only without parent_id (it follows the parent)");
        kind = CHILD_KIND[parent.type];
        workspace = parent.workspace_id;
      } else {
        need(a.kind === undefined || ["area", "goal"].includes(a.kind), "kind: area or goal");
        kind = a.kind ?? "area";
      }
      let siblings = db.from("items").select("id", { count: "exact", head: true }).eq("workspace_id", workspace).in("type", STRATEGY_TYPES);
      siblings = a.parent_id ? siblings.eq("parent_id", a.parent_id) : siblings.is("parent_id", null);
      const { count } = await siblings;
      const row = { ...nodeFields(a, true), workspace_id: workspace, created_by: userId, parent_id: a.parent_id ?? null, type: kind, position: count ?? 0 };
      return nodePublic(checkWrite(await db.from("items").insert(row).select(ITEM_NODE_COLS).single()));
    },
  },
  {
    name: "strategy_update",
    title: "Update a strategy node",
    description:
      "Change a node: title, description, status (open / done / dropped — done counts as 100 %, dropped stops counting), weight, " +
      "target_count (null clears), start_date / due_date (null clears; start ≤ due), progress (0–1, null clears), or move it under another parent of a fitting kind.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: NODE_STATUSES },
        weight: { type: "number", exclusiveMinimum: 0, maximum: 100 },
        target_count: { type: ["integer", "null"], minimum: 1, maximum: 100 },
        start_date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
        progress: { type: ["number", "null"], minimum: 0, maximum: 1 },
        parent_id: { ...ID, description: "Move under this node" },
      },
      required: ["id"],
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, parent_id, ...a }, ctx) => {
      const node = await ownNode(ctx, id);
      const row = nodeFields(a, false);
      if (parent_id !== undefined) {
        need((await ownNode(ctx, parent_id)).workspace_id === node.workspace_id, "that node is in another workspace");
        row.parent_id = parent_id;
      }
      need(Object.keys(row).length, "nothing to change");
      return nodePublic(checkWrite(await ctx.db.from("items").update(row).eq("id", node.id).select(ITEM_NODE_COLS).single()));
    },
  },
  {
    name: "strategy_delete",
    title: "Delete a strategy node",
    description: "Delete a node AND everything inside it (missions, steps). Linked tasks stay, unlinked. To keep the history, prefer strategy_update status \"dropped\".",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    run: async ({ id }, ctx) => {
      const { db } = ctx;
      const node = await ownNode(ctx, id);
      // The node and every strategy node below it (trashed ones too) go in one statement; the tasks and other items
      // inside them stay, moved to the top (the parent link is cleared by the database).
      const all = check(await db.from("items").select("id, parent_id").eq("workspace_id", node.workspace_id).in("type", STRATEGY_TYPES)) as
        { id: string; parent_id: string | null }[];
      const ids = [node.id];
      for (let i = 0; i < ids.length; i++) ids.push(...all.filter((n) => n.parent_id === ids[i]).map((n) => n.id));
      checkWrite(await db.from("items").delete().in("id", ids));
      return { id, title: node.title, deleted: true, nodes_removed: ids.length };
    },
  },
  {
    name: "items_query",
    title: "Find any items",
    description:
      `Every kind of item, not only tasks: ${ITEM_TYPES_TEXT}. Filter by type, status, parent, dates, text, custom fields; ` +
      "pass id for one item in full with its path and what is inside it. Field names are the items' own (status todo / doing / " +
      "waiting / someday / done / dropped; planned_on = the day it is planned for; due_on = deadline). Trashed items never show. " +
      "For tasks the task tools give the same data in their own field names.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...ID, description: "One item in full: its text, its path to the top, the items inside it" },
        types: { type: "array", items: { type: "string" }, description: `Only these types: ${ITEM_TYPES_TEXT}` },
        status: { type: "array", items: { type: "string", enum: V2_STATUSES } },
        open: { type: "boolean", description: "Only items not done and not dropped" },
        parent_id: { type: "string", description: "Only the items directly inside this item (uuid), or \"none\" for the top level" },
        search: { type: "string", description: "Text in title or description" },
        planned_from: DATE, planned_to: DATE, due_from: DATE, due_to: DATE,
        fields: { type: "object", description: "Only items with these custom values, e.g. {\"Who\": \"AI\"}" },
        order: { type: "string", enum: Object.keys(ORDERS), default: "updated", description: "updated / created: newest first; the others: soonest / first, empty last" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
    annotations: READ,
    run: async (a, ctx) => {
      const { db, scope } = ctx;
      const types = await publicTypes(db);
      if (a.id !== undefined) {
        const item = await ownItem(ctx, a.id, types);
        const inside = check(await db.from("items").select("id, type, title, status").eq("parent_id", item.id).in("type", types)
          .is("deleted_at", null).order("position").limit(200)) as any[];
        const path: { id: string; type: string; title: string }[] = [];
        for (let up = item.parent_id, n = 0; up && n < 20; n++) {
          const p = check(await db.from("items").select("id, type, title, parent_id").eq("id", up).in("type", types).maybeSingle()) as any;
          if (!p) break;
          path.unshift({ id: p.id, type: p.type, title: p.title });
          up = p.parent_id;
        }
        return { ...(await itemsOut(ctx, [item], types, true))[0], path, inside };
      }
      let wanted = types;
      if (a.types !== undefined) {
        need(Array.isArray(a.types) && a.types.length && a.types.every((t: unknown) => types.includes(t as string)), `types: some of ${types.join(", ")}`);
        wanted = a.types;
      }
      let q = db.from("items").select(ITEM_COLS).in("workspace_id", scope.workspaces).in("type", wanted).is("deleted_at", null);
      if (a.status !== undefined) {
        need(Array.isArray(a.status) && a.status.length && a.status.every((s: unknown) => V2_STATUSES.includes(s as string)), `status: some of ${V2_STATUSES.join(", ")}`);
        q = q.in("status", a.status);
      }
      if (a.open) q = q.not("status", "in", "(done,dropped)");
      if (a.parent_id !== undefined) {
        need(a.parent_id === "none" || isUuid(a.parent_id), "parent_id: uuid or \"none\"");
        q = a.parent_id === "none" ? q.is("parent_id", null) : q.eq("parent_id", a.parent_id);
      }
      for (const [k, col, op] of [["planned_from", "planned_on", "gte"], ["planned_to", "planned_on", "lte"], ["due_from", "due_on", "gte"], ["due_to", "due_on", "lte"]] as const) {
        if (a[k] === undefined) continue;
        need(isDate(a[k]), `${k}: YYYY-MM-DD`);
        q = op === "gte" ? q.gte(col, a[k]) : q.lte(col, a[k]);
      }
      if (a.fields !== undefined) {
        const values = fieldInput(await fieldsOf(ctx), scope.home, a.fields);
        for (const [key, v] of Object.entries(values)) q = v === null ? q.is(`props->>${key}`, null) : q.eq(`props->>${key}`, String(v));
      }
      const term = searchTerm(a.search);
      if (term) q = q.or(`title.ilike.*${term}*,body.ilike.*${term}*`);
      need(a.order === undefined || a.order in ORDERS, `order: one of ${Object.keys(ORDERS).join(", ")}`);
      const [col, ascending] = ORDERS[a.order ?? "updated"];
      const rows = check(await q.order(col, { ascending, nullsFirst: false }).order("id").limit(limitOf(a.limit, 50, 200))) as any[];
      return { items: await itemsOut(ctx, rows, types), count: rows.length };
    },
  },
  {
    name: "item_update",
    title: "Update any item",
    description:
      `Change any item found with items_query (${ITEM_TYPES_TEXT}): its fields in items_query's names, its type, its parent ` +
      "(the database refuses a parent its type cannot sit in, and says which fit), custom fields; trash = true moves it to the " +
      "Trash (only when nothing is inside it). Prefer status dropped over the Trash to keep the history. A task's date and time " +
      "changes also go to Google Calendar / Tasks.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", description: ITEM_TYPES_TEXT },
        status: { type: "string", enum: V2_STATUSES },
        parent_id: { type: ["string", "null"], description: "uuid of the item it sits in; null = top level" },
        priority: { type: ["string", "null"], enum: [...PRIORITIES, null] },
        planned_on: { type: ["string", "null"], description: "YYYY-MM-DD: the day it is planned for; null = unscheduled" },
        planned_time: { type: ["string", "null"], description: "HH:MM (24 h, local): an event's start or a time block; needs planned_on" },
        is_event: { type: "boolean", description: "Happens at a fixed time (needs planned_on + planned_time)" },
        start_on: { type: ["string", "null"], description: "YYYY-MM-DD: when a span starts (projects, goals)" },
        due_on: { type: ["string", "null"], description: "YYYY-MM-DD: deadline / due date" },
        due_time: { type: ["string", "null"], description: "HH:MM (24 h) of the deadline; needs due_on" },
        estimate_min: { type: ["integer", "null"], minimum: 1 },
        url: { type: ["string", "null"] },
        color: { type: ["string", "null"], description: "#rrggbb" },
        weight: { type: "number", description: "Share in the parent's progress (default 1)" },
        target_count: { type: ["integer", "null"], description: "\"At least N\" done items inside" },
        progress: { type: ["number", "null"], description: "0–1 by hand, for an item with nothing inside" },
        fields: { type: "object", description: "Custom fields by name, e.g. {\"Who\": \"AI\"}; null clears one" },
        trash: { type: "boolean" },
      },
      required: ["id"],
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, trash, fields, ...a }, ctx) => {
      const { db, scope } = ctx;
      const types = await publicTypes(db);
      const item = await ownItem(ctx, id, types);
      if (trash) {
        const { count, error } = await db.from("items").select("id", { count: "exact", head: true }).eq("parent_id", item.id).is("deleted_at", null);
        if (error) throw error;
        need(!count,"it has items inside: move or trash them first (or set status dropped)");
        check(await db.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id));
        return { id: item.id, title: item.title, trashed: true };
      }
      const row = itemPatch(a, types);
      if (fields !== undefined) row.props = { ...(item.props ?? {}), ...fieldInput(await fieldsOf(ctx), item.workspace_id, fields) };
      need(Object.keys(row).length, "nothing to change");
      if (row.parent_id) {
        const parent = check(await db.from("items").select("id, workspace_id").in("workspace_id", scope.workspaces).in("type", types)
          .is("deleted_at", null).eq("id", row.parent_id).maybeSingle()) as any;
        need(parent, "parent not found");
        need(parent.workspace_id === item.workspace_id, "that parent is in another workspace");
      }
      const saved = checkWrite(await db.from("items").update(row).eq("id", item.id).select(ITEM_COLS).single());
      return (await itemsOut(ctx, [saved], types, true))[0];
    },
  },
];

function nodeFields(a: any, creating: boolean) {
  const row: Record<string, unknown> = {};
  if (creating || a.title !== undefined) {
    need(isText(a.title, 300), "title: 1–300 characters");
    row.title = a.title.trim();
  }
  if (a.description !== undefined) {
    need(typeof a.description === "string" && a.description.length <= 20000, "description: text up to 20000 characters");
    row.body = a.description;
  }
  if (a.status !== undefined) {
    need(NODE_STATUSES.includes(a.status), `status: one of ${NODE_STATUSES.join(", ")}`);
    row.status = a.status === "open" ? "todo" : a.status;
  }
  if (a.weight !== undefined) {
    need(typeof a.weight === "number" && a.weight > 0 && a.weight <= 100, "weight: number above 0, up to 100");
    row.weight = a.weight;
  }
  if (a.target_count !== undefined) {
    need(a.target_count === null || (Number.isInteger(a.target_count) && a.target_count >= 1 && a.target_count <= 100), "target_count: 1–100 or null");
    row.target_count = a.target_count;
  }
  for (const [k, col] of [["start_date", "start_on"], ["due_date", "due_on"]]) {
    if (a[k] === undefined) continue;
    need(a[k] === null || isDate(a[k]), `${k}: YYYY-MM-DD or null`);
    row[col] = a[k];
  }
  if (a.progress !== undefined) {
    need(a.progress === null || (typeof a.progress === "number" && a.progress >= 0 && a.progress <= 1), "progress: 0–1 or null");
    row.progress = a.progress;
  }
  return row;
}
