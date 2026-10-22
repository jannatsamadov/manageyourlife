// MCP tools (P-18). Every query is filtered by the token owner's user_id (the client is the service role).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export type Ctx = { db: SupabaseClient; userId: string };

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

const STATUSES = ["idle", "active", "complete", "abandoned"];
const PRIORITIES = ["high", "medium", "low"];
const TASK_COLS = "id, title, description, status, date, deadline, priority, estimated_time, link, created_at";
const DATE = { type: "string", description: "YYYY-MM-DD" };
const ID = { type: "string", description: "uuid" };

// estimated_time is minutes; the API calls it estimated_minutes.
const taskOut = ({ estimated_time, ...t }: any) => ({ ...t, estimated_minutes: estimated_time });

function taskFields(a: any, creating: boolean) {
  const row: Record<string, unknown> = {};
  if (creating || a.title !== undefined) {
    need(isText(a.title, 500), "title: 1–500 characters");
    row.title = a.title.trim();
  }
  if (a.description !== undefined) {
    need(typeof a.description === "string" && a.description.length <= 20000, "description: text up to 20000 characters");
    row.description = a.description;
  }
  if (a.status !== undefined) {
    need(STATUSES.includes(a.status), `status: one of ${STATUSES.join(", ")}`);
    row.status = a.status;
  }
  if (a.date !== undefined) {
    need(a.date === null || isDate(a.date), "date: YYYY-MM-DD or null (unscheduled)");
    row.date = a.date;
  }
  if (a.deadline !== undefined) {
    need(a.deadline === null || a.deadline === "" || isDate(a.deadline), "deadline: YYYY-MM-DD, or null to clear");
    row.deadline = a.deadline ?? "";
  }
  if (a.estimated_minutes !== undefined) {
    need(a.estimated_minutes === null || (Number.isInteger(a.estimated_minutes) && a.estimated_minutes > 0 && a.estimated_minutes <= 100000), "estimated_minutes: positive whole number or null");
    row.estimated_time = a.estimated_minutes;
  }
  if (a.priority !== undefined) {
    need(PRIORITIES.includes(a.priority), `priority: one of ${PRIORITIES.join(", ")}`);
    row.priority = a.priority;
  }
  if (a.link !== undefined) {
    need(a.link === null || (typeof a.link === "string" && a.link.length <= 2000), "link: URL or null");
    row.link = a.link ?? "";
  }
  return row;
}

const TASK_INPUT = {
  title: { type: "string" },
  description: { type: "string" },
  status: { type: "string", enum: STATUSES },
  date: { ...DATE, description: "Day the task is planned for (YYYY-MM-DD); null = unscheduled" },
  deadline: { ...DATE, description: "Due date (YYYY-MM-DD); null clears it" },
  estimated_minutes: { type: "integer", minimum: 1 },
  priority: { type: "string", enum: PRIORITIES },
  link: { type: "string", description: "Related URL" },
};

async function ownTask(db: SupabaseClient, userId: string, id: unknown) {
  need(isUuid(id), "task id: uuid");
  const task = check(await db.from("tasks").select(TASK_COLS).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle());
  need(task, "task not found");
  return task as any;
}

async function ownNote(db: SupabaseClient, userId: string, id: unknown, cols = "id, title, content, created_at, updated_at") {
  need(isUuid(id), "note id: uuid");
  const note = check(await db.from("notes").select(cols).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle());
  need(note, "note not found");
  return note as any;
}

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS: Tool[] = [
  {
    name: "today",
    title: "Today's plan",
    description: "Tasks planned for a day, overdue tasks and the number of unsorted Inbox items. Pass the user's local date.",
    scope: "read",
    inputSchema: { type: "object", properties: { date: { ...DATE, description: "The user's local date; default: today in UTC" } } },
    annotations: READ,
    run: async ({ date }, { db, userId }) => {
      const day = isDate(date) ? date : new Date().toISOString().slice(0, 10);
      const planned = check(await db.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null)
        .eq("date", day).neq("status", "abandoned").order("position"));
      const overdue = check(await db.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null)
        .neq("deadline", "").lt("deadline", day).not("status", "in", "(complete,abandoned)").order("deadline"));
      const { count, error } = await db.from("inbox_items").select("id", { count: "exact", head: true }).eq("user_id", userId).is("sorted_at", null);
      if (error) throw error;
      return { date: day, planned: (planned as any[]).map(taskOut), overdue: (overdue as any[]).map(taskOut), inbox_unsorted: count ?? 0 };
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
        search: { type: "string", description: "Text in title or description" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
    annotations: READ,
    run: async (a, { db, userId }) => {
      let q = db.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null);
      if (a.status !== undefined) {
        need(STATUSES.includes(a.status), `status: one of ${STATUSES.join(", ")}`);
        q = q.eq("status", a.status);
      } else q = q.neq("status", "abandoned");
      if (a.date_from !== undefined) { need(isDate(a.date_from), "date_from: YYYY-MM-DD"); q = q.gte("date", a.date_from); }
      if (a.date_to !== undefined) { need(isDate(a.date_to), "date_to: YYYY-MM-DD"); q = q.lte("date", a.date_to); }
      if (a.unscheduled) q = q.is("date", null);
      const term = searchTerm(a.search);
      if (term) q = q.or(`title.ilike.*${term}*,description.ilike.*${term}*`);
      const rows = check(await q.order("date", { ascending: true, nullsFirst: false }).order("position").limit(limitOf(a.limit, 50, 200)));
      return { tasks: (rows as any[]).map(taskOut) };
    },
  },
  {
    name: "task_get",
    title: "Get a task",
    description: "One task with its subtasks and linked notes.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: READ,
    run: async ({ id }, { db, userId }) => {
      const task = await ownTask(db, userId, id);
      const subtasks = check(await db.from("subtasks").select("id, title, completed, position").eq("user_id", userId).eq("parent_task_id", id).order("position"));
      const links = check(await db.from("note_task_links").select("notes(id, title)").eq("user_id", userId).eq("task_id", id));
      return { ...taskOut(task), subtasks, notes: (links as any[]).map((l) => l.notes).filter(Boolean) };
    },
  },
  {
    name: "task_create",
    title: "Create a task",
    description: "Create a task. Without date it stays unscheduled (in the backlog).",
    scope: "write",
    inputSchema: { type: "object", properties: TASK_INPUT, required: ["title"] },
    annotations: WRITE,
    run: async (a, { db, userId }) => {
      const row = { status: "idle", priority: "medium", ...taskFields(a, true), user_id: userId };
      return taskOut(check(await db.from("tasks").insert(row).select(TASK_COLS).single()));
    },
  },
  {
    name: "task_update",
    title: "Update a task",
    description: "Change any fields of a task: title, description, status (idle/active/complete/abandoned), planned date (null = unscheduled), deadline, estimate, priority, link.",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID, ...TASK_INPUT }, required: ["id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, ...a }, { db, userId }) => {
      await ownTask(db, userId, id);
      const row = taskFields(a, false);
      need(Object.keys(row).length, "nothing to change");
      return taskOut(check(await db.from("tasks").update(row).eq("user_id", userId).eq("id", id).select(TASK_COLS).single()));
    },
  },
  {
    name: "task_trash",
    title: "Move a task to Trash",
    description: "Move a task to the Trash (the user can restore it in the app).",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    run: async ({ id }, { db, userId }) => {
      const task = await ownTask(db, userId, id);
      check(await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id));
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
    run: async ({ task_id, title }, { db, userId }) => {
      await ownTask(db, userId, task_id);
      need(isText(title, 500), "title: 1–500 characters");
      const { count } = await db.from("subtasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("parent_task_id", task_id);
      return check(await db.from("subtasks").insert({ user_id: userId, parent_task_id: task_id, title: title.trim(), position: count ?? 0 })
        .select("id, title, completed, position").single()) as Record<string, unknown>;
    },
  },
  {
    name: "subtask_update",
    title: "Update a subtask",
    description: "Tick / untick or rename a subtask.",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID, completed: { type: "boolean" }, title: { type: "string" } }, required: ["id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, completed, title }, { db, userId }) => {
      need(isUuid(id), "id: uuid");
      const row: Record<string, unknown> = {};
      if (completed !== undefined) { need(typeof completed === "boolean", "completed: true or false"); row.completed = completed; }
      if (title !== undefined) { need(isText(title, 500), "title: 1–500 characters"); row.title = title.trim(); }
      need(Object.keys(row).length, "nothing to change");
      const sub = check(await db.from("subtasks").update(row).eq("user_id", userId).eq("id", id).select("id, title, completed, position").maybeSingle());
      need(sub, "subtask not found");
      return sub as Record<string, unknown>;
    },
  },
  {
    name: "notes_search",
    title: "Search notes",
    description: "Find notes by text in the title or content (Markdown). Without query: the most recently edited notes.",
    scope: "read",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } },
    annotations: READ,
    run: async ({ query, limit }, { db, userId }) => {
      let q = db.from("notes").select("id, title, content, updated_at").eq("user_id", userId).is("deleted_at", null);
      const term = searchTerm(query);
      if (term) q = q.or(`title.ilike.*${term}*,content.ilike.*${term}*`);
      const rows = check(await q.order("updated_at", { ascending: false }).limit(limitOf(limit, 20, 100))) as any[];
      return {
        notes: rows.map(({ content, ...n }) => {
          const at = term ? Math.max(content.toLowerCase().indexOf(term.toLowerCase()) - 80, 0) : 0;
          return { ...n, snippet: content.slice(at, at + 300) };
        }),
      };
    },
  },
  {
    name: "note_get",
    title: "Get a note",
    description: "Full Markdown content of a note and the tasks linked to it.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: READ,
    run: async ({ id }, { db, userId }) => {
      const note = await ownNote(db, userId, id);
      const links = check(await db.from("note_task_links").select("tasks(id, title, status)").eq("user_id", userId).eq("note_id", id));
      return { ...note, tasks: (links as any[]).map((l) => l.tasks).filter(Boolean) };
    },
  },
  {
    name: "note_create",
    title: "Create a note",
    description: "Create a Markdown note (\"- [ ] item\" lines become to-dos in the app).",
    scope: "write",
    inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title"] },
    annotations: WRITE,
    run: async ({ title, content }, { db, userId }) => {
      need(isText(title, 500), "title: 1–500 characters");
      need(content === undefined || (typeof content === "string" && content.length <= 200000), "content: text up to 200000 characters");
      return check(await db.from("notes").insert({ user_id: userId, title: title.trim(), content: content ?? "" })
        .select("id, title, content, created_at, updated_at").single()) as Record<string, unknown>;
    },
  },
  {
    name: "note_update",
    title: "Update a note",
    description: "Rename a note, replace its content, or append text to the end (append keeps what is there).",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { id: ID, title: { type: "string" }, content: { type: "string", description: "New full content" }, append: { type: "string", description: "Text added at the end" } },
      required: ["id"],
    },
    annotations: WRITE,
    run: async ({ id, title, content, append }, { db, userId }) => {
      const note = await ownNote(db, userId, id);
      need(!(content !== undefined && append !== undefined), "use content or append, not both");
      const row: Record<string, unknown> = {};
      if (title !== undefined) { need(isText(title, 500), "title: 1–500 characters"); row.title = title.trim(); }
      if (content !== undefined) { need(typeof content === "string" && content.length <= 200000, "content: text up to 200000 characters"); row.content = content; }
      if (append !== undefined) {
        need(isText(append, 200000), "append: non-empty text");
        row.content = note.content ? `${note.content.replace(/\s+$/, "")}\n\n${append}` : append;
      }
      need(Object.keys(row).length, "nothing to change");
      return check(await db.from("notes").update(row).eq("user_id", userId).eq("id", id).select("id, title, content, updated_at").single()) as Record<string, unknown>;
    },
  },
  {
    name: "note_link_task",
    title: "Link a note to a task",
    description: "Link a note and a task (both show the link in the app).",
    scope: "write",
    inputSchema: { type: "object", properties: { note_id: ID, task_id: ID }, required: ["note_id", "task_id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ note_id, task_id }, { db, userId }) => {
      await ownNote(db, userId, note_id, "id");
      await ownTask(db, userId, task_id);
      check(await db.from("note_task_links").upsert({ user_id: userId, note_id, task_id }, { onConflict: "note_id,task_id", ignoreDuplicates: true }));
      return { note_id, task_id, linked: true };
    },
  },
  {
    name: "inbox_list",
    title: "List the Inbox",
    description: "Unsorted Inbox items (captured from Telegram, Google Tasks, MCP, typed in the app…), newest first.",
    scope: "read",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } } },
    annotations: READ,
    run: async ({ limit }, { db, userId }) => ({
      items: check(await db.from("inbox_items").select("id, source, content, source_url, attachments, created_at")
        .eq("user_id", userId).is("sorted_at", null).order("created_at", { ascending: false }).limit(limitOf(limit, 50, 200))),
    }),
  },
  {
    name: "inbox_add",
    title: "Add to the Inbox",
    description: "Capture something into the Inbox as is, to be sorted later by the user.",
    scope: "write",
    inputSchema: { type: "object", properties: { content: { type: "string" }, url: { type: "string", description: "Link back to the source" } }, required: ["content"] },
    annotations: WRITE,
    run: async ({ content, url }, { db, userId }) => {
      need(isText(content, 20000), "content: 1–20000 characters");
      need(url === undefined || (typeof url === "string" && url.length <= 2000), "url: up to 2000 characters");
      return check(await db.from("inbox_items").insert({ user_id: userId, source: "mcp", content, source_url: url ?? null })
        .select("id, source, content, source_url, created_at").single()) as Record<string, unknown>;
    },
  },
];
