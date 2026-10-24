// MCP tools (P-18). Every query is filtered by the token owner's user_id (the client is the service role).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { CHILD_KIND, NODE_COLS, loadTree, present } from "./strategy.ts";
import {
  addItem, CAPTURE_SECTIONS, captureItem, editNote, INBOX, inboxNotePath, localTime, moveFile, noteById, readNote, safeName, syncTodos, userTimeZone,
  VaultError, writeNote,
} from "../_shared/vault.ts";

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
// Writes the DB refuses by its own rules (strategy shape, checks, a node of another user) are the caller's mistake.
const checkWrite = <T>({ data, error }: { data: T; error: { code?: string; message: string } | null }) => {
  if (error) {
    if (["P0001", "23514", "23503"].includes(error.code ?? "")) throw new ToolError(error.message);
    throw error;
  }
  return data;
};

const STATUSES = ["idle", "active", "complete", "abandoned"];
const PRIORITIES = ["high", "medium", "low"];
const KINDS = ["idea", "question", "todo", "resource"];
const TASK_COLS = "id, title, description, status, date, deadline, priority, estimated_time, link, node_id, created_at";
const NODE_STATUSES = ["open", "done", "dropped"];
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
  if (a.node_id !== undefined) {
    need(a.node_id === null || isUuid(a.node_id), "node_id: uuid of a goal / mission / step, or null to unlink");
    row.node_id = a.node_id;
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
  node_id: { type: ["string", "null"], description: "Strategy goal / mission / step this task serves (from strategy_tree); null unlinks" },
};

async function ownTask(db: SupabaseClient, userId: string, id: unknown) {
  need(isUuid(id), "task id: uuid");
  const task = check(await db.from("tasks").select(TASK_COLS).eq("user_id", userId).eq("id", id).is("deleted_at", null).maybeSingle());
  need(task, "task not found");
  return task as any;
}

async function ownNode(db: SupabaseClient, userId: string, id: unknown) {
  need(isUuid(id), "strategy node id: uuid");
  const node = check(await db.from("strategy_nodes").select(NODE_COLS).eq("user_id", userId).eq("id", id).maybeSingle());
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

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS: Tool[] = [
  {
    name: "today",
    title: "Today's plan",
    description: "Tasks planned for a day, overdue tasks and the number of notes waiting in the Inbox folder. Pass the user's local date.",
    scope: "read",
    inputSchema: { type: "object", properties: { date: { ...DATE, description: "The user's local date; default: today in UTC" } } },
    annotations: READ,
    run: async ({ date }, { db, userId }) => {
      const day = isDate(date) ? date : new Date().toISOString().slice(0, 10);
      const planned = check(await db.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null)
        .eq("date", day).neq("status", "abandoned").order("position"));
      const overdue = check(await db.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null)
        .neq("deadline", "").lt("deadline", day).not("status", "in", "(complete,abandoned)").order("deadline"));
      const { count, error } = await db.from("vault_files").select("id", { count: "exact", head: true }).eq("user_id", userId)
        .is("trashed_at", null).like("path", `${INBOX}/%`).ilike("path", "%.md");
      if (error) throw error;
      return { date: day, planned: (planned as any[]).map(taskOut), overdue: (overdue as any[]).map(taskOut), inbox_notes: count ?? 0 };
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
        node_id: { ...ID, description: "Only tasks serving this strategy node" },
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
      if (a.node_id !== undefined) { need(isUuid(a.node_id), "node_id: uuid"); q = q.eq("node_id", a.node_id); }
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
      const links = check(await db.from("note_task_links").select("vault_files(id, title, path, trashed_at)").eq("user_id", userId).eq("task_id", id));
      const notes = (links as any[]).map((l) => l.vault_files).filter((n) => n && !n.trashed_at).map(({ trashed_at: _, ...n }) => n);
      return { ...taskOut(task), subtasks, notes };
    },
  },
  {
    name: "task_create",
    title: "Create a task",
    description: "Create a task. Without date it stays unscheduled (in the backlog). node_id links it to a strategy goal / mission / step.",
    scope: "write",
    inputSchema: { type: "object", properties: TASK_INPUT, required: ["title"] },
    annotations: WRITE,
    run: async (a, { db, userId }) => {
      const row = { status: "idle", priority: "medium", ...taskFields(a, true), user_id: userId };
      if (row.node_id) await ownNode(db, userId, row.node_id);
      return taskOut(checkWrite(await db.from("tasks").insert(row).select(TASK_COLS).single()));
    },
  },
  {
    name: "task_update",
    title: "Update a task",
    description: "Change any fields of a task: title, description, status (idle/active/complete/abandoned), planned date (null = unscheduled), deadline, estimate, priority, link, strategy node (node_id; null unlinks).",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID, ...TASK_INPUT }, required: ["id"] },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ id, ...a }, { db, userId }) => {
      await ownTask(db, userId, id);
      const row = taskFields(a, false);
      need(Object.keys(row).length, "nothing to change");
      if (row.node_id) await ownNode(db, userId, row.node_id);
      return taskOut(checkWrite(await db.from("tasks").update(row).eq("user_id", userId).eq("id", id).select(TASK_COLS).single()));
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
    description:
      "Create a Markdown note (a file; the title is its file name). Goes to the Inbox folder unless folder is given (\"\" = top level). " +
      "\"- [ ] item\" lines are to-dos; [[Note name]] links to another note.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" }, folder: { type: "string", description: "Default \"Inbox\"" } },
      required: ["title"],
    },
    annotations: WRITE,
    run: async ({ title, content, folder }, { db, userId }) => {
      need(isText(title, 150), "title: 1–150 characters");
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
    run: async ({ note_id, task_id }, { db, userId }) => {
      const note = await ownNote(db, userId, note_id);
      await ownTask(db, userId, task_id);
      check(await db.from("note_task_links").upsert({ user_id: userId, note_id, task_id }, { onConflict: "note_id,task_id", ignoreDuplicates: true }));
      await syncTodos(db, userId, note.id, note.content); // the note's "- [ ]" lines become the task's subtasks
      return { note_id, task_id, linked: true };
    },
  },
  {
    name: "inbox_list",
    title: "List the Inbox",
    description:
      "The Inbox = the notes in the Inbox folder, waiting to be sorted: the daily capture notes (Inbox/<date>.md — Telegram and inbox_add, " +
      "sections Ideas / Questions / To-dos / Resources / Notes) and new notes. Newest first, with the start of the text; read one with note_get, " +
      "sort it by moving it (note_update folder) or making tasks.",
    scope: "read",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } } },
    annotations: READ,
    run: async ({ limit }, { db, userId }) => {
      const rows = check(await db.from("vault_files").select("id, path, title, body, modified_at").eq("user_id", userId).is("trashed_at", null)
        .like("path", `${INBOX}/%`).ilike("path", "%.md").order("modified_at", { ascending: false }).limit(limitOf(limit, 50, 200))) as any[];
      return { notes: rows.map(({ body, modified_at, ...n }) => ({ ...n, updated_at: modified_at, snippet: (body ?? "").slice(0, 500) })) };
    },
  },
  {
    name: "inbox_add",
    title: "Add to the Inbox",
    description:
      "Capture something into the Inbox as is, to be sorted later by the user: one item in today's capture note (Inbox/<date>.md), " +
      "under the section of its kind (a to-do becomes a \"- [ ]\" line). Pass the user's local date.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        kind: { type: "string", enum: KINDS },
        url: { type: "string", description: "Link back to the source" },
        date: { ...DATE, description: "The user's local date; default: today in the user's time zone" },
      },
      required: ["content"],
    },
    annotations: WRITE,
    run: async ({ content, kind, url, date }, { db, userId }) => {
      need(isText(content, 20000), "content: 1–20000 characters");
      need(kind === undefined || KINDS.includes(kind), `kind: one of ${KINDS.join(", ")}`);
      need(url === undefined || (typeof url === "string" && url.length <= 2000), "url: up to 2000 characters");
      const now = localTime(new Date(), await userTimeZone(db, userId));
      const path = inboxNotePath(isDate(date) ? date : now.day);
      const section = CAPTURE_SECTIONS[kind ?? "note"];
      const item = captureItem({ kind: kind ?? null, time: now.time, text: content, marker: `mcp${Date.now()}`, more: url ? [url] : [] });
      const saved = await inVault(() => editNote(db, userId, path, (text) => addItem(text, section, item)));
      return { note_id: saved?.id, path, section };
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
    run: async ({ id, depth }, { db, userId }) => {
      const { roots, byId } = await loadTree(db, userId);
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
    run: async (a, { db, userId }) => {
      let kind: string;
      if (a.parent_id !== undefined) {
        const parent = await ownNode(db, userId, a.parent_id);
        need(a.kind === undefined, "kind: only without parent_id (it follows the parent)");
        kind = CHILD_KIND[parent.kind];
      } else {
        need(a.kind === undefined || ["area", "goal"].includes(a.kind), "kind: area or goal");
        kind = a.kind ?? "area";
      }
      let siblings = db.from("strategy_nodes").select("id", { count: "exact", head: true }).eq("user_id", userId);
      siblings = a.parent_id ? siblings.eq("parent_id", a.parent_id) : siblings.is("parent_id", null);
      const { count } = await siblings;
      const row = { ...nodeFields(a, true), user_id: userId, parent_id: a.parent_id ?? null, kind, position: count ?? 0 };
      return checkWrite(await db.from("strategy_nodes").insert(row).select(NODE_COLS).single()) as Record<string, unknown>;
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
    run: async ({ id, parent_id, ...a }, { db, userId }) => {
      await ownNode(db, userId, id);
      const row = nodeFields(a, false);
      if (parent_id !== undefined) {
        await ownNode(db, userId, parent_id);
        row.parent_id = parent_id;
      }
      need(Object.keys(row).length, "nothing to change");
      return checkWrite(await db.from("strategy_nodes").update(row).eq("user_id", userId).eq("id", id).select(NODE_COLS).single()) as Record<string, unknown>;
    },
  },
  {
    name: "strategy_delete",
    title: "Delete a strategy node",
    description: "Delete a node AND everything inside it (missions, steps). Linked tasks stay, unlinked. To keep the history, prefer strategy_update status \"dropped\".",
    scope: "write",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    run: async ({ id }, { db, userId }) => {
      const node = await ownNode(db, userId, id);
      const { byId } = await loadTree(db, userId);
      const count = (n: { children: unknown[] }): number => 1 + (n.children as any[]).reduce((s, c) => s + count(c), 0);
      const removed = count(byId.get(id)!);
      check(await db.from("strategy_nodes").delete().eq("user_id", userId).eq("id", id));
      return { id, title: node.title, deleted: true, nodes_removed: removed };
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
    row.description = a.description;
  }
  if (a.status !== undefined) {
    need(NODE_STATUSES.includes(a.status), `status: one of ${NODE_STATUSES.join(", ")}`);
    row.status = a.status;
  }
  if (a.weight !== undefined) {
    need(typeof a.weight === "number" && a.weight > 0 && a.weight <= 100, "weight: number above 0, up to 100");
    row.weight = a.weight;
  }
  if (a.target_count !== undefined) {
    need(a.target_count === null || (Number.isInteger(a.target_count) && a.target_count >= 1 && a.target_count <= 100), "target_count: 1–100 or null");
    row.target_count = a.target_count;
  }
  for (const k of ["start_date", "due_date"]) {
    if (a[k] === undefined) continue;
    need(a[k] === null || isDate(a[k]), `${k}: YYYY-MM-DD or null`);
    row[k] = a[k];
  }
  if (a.progress !== undefined) {
    need(a.progress === null || (typeof a.progress === "number" && a.progress >= 0 && a.progress <= 1), "progress: 0–1 or null");
    row.progress = a.progress;
  }
  return row;
}
