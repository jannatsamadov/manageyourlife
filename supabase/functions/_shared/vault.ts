// Notes as files (P-21, P-57). A user's vault lives in R2 under users/<id>/vault/ (the laptop syncs it with rclone
// bisync); vault_files indexes it — one row per file, with a stable id that survives renames, moves and the trash, so
// task links (note_task_links, subtasks) keep working. Used by the vault function (the app), mcp and telegram-webhook.
import { AwsClient } from "npm:aws4fetch@1.0.20";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const env = (k: string) => Deno.env.get(k)!;
const r2 = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
const BUCKET_NAME = env("R2_BUCKET");
const BUCKET = `${env("R2_ENDPOINT")}/${BUCKET_NAME}`;

export class VaultError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function check<T>(r: { data: T; error: { message: string } | null }) {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// ── keys and paths ──
// S3 wants every byte outside A-Z a-z 0-9 - _ . ~ percent-encoded; "/" separates the parts.
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodeKey = (key: string) => key.split("/").map(rfc3986).join("/");
const objectUrl = (key: string) => `${BUCKET}/${encodeKey(key)}`;
const vaultPrefix = (userId: string) => `users/${userId}/vault/`;
const trashPrefix = (userId: string) => `users/${userId}/trash/vault/`;
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export const isNote = (path: string) => /\.md$/i.test(path);
export const fileName = (path: string) => path.split("/").pop()!;
export const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
const titleOf = (path: string) => (isNote(path) ? fileName(path).replace(/\.md$/i, "") : fileName(path));

// A path inside the vault: forward slashes, no empty / "." / ".." parts.
export function cleanPath(p: unknown) {
  if (typeof p !== "string") throw new VaultError("path: text");
  const path = p.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!path || path.length > 1024 || path.split("/").some((s) => !s.trim() || s === "." || s === "..")) throw new VaultError("path: not a vault path");
  return path;
}

// A file name the laptop accepts (Windows) and Obsidian links can reach.
export const safeName = (s: string) => s.trim().replace(/[\\/:*?"<>|#^[\]]+/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/, "").slice(0, 150);

// ── R2 ──
const unquote = (etag: string | null) => (etag ?? "").replaceAll('"', "");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    ENTITIES[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

type Obj = { path: string; etag: string; size: number; modified: string };

async function list(prefix: string) {
  const out: Obj[] = [];
  let token = "";
  do {
    const q = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) q.set("continuation-token", token);
    const res = await r2.fetch(`${BUCKET}?${q}`);
    if (!res.ok) throw new Error(`R2 list ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const get = (tag: string) => unxml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      const key = get("Key");
      if (!key.endsWith("/")) out.push({ path: key.slice(prefix.length), etag: unquote(get("ETag")), size: Number(get("Size")), modified: get("LastModified") });
    }
    token = unxml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "");
  } while (token);
  return out;
}

async function head(key: string) {
  const res = await r2.fetch(objectUrl(key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 head ${res.status}`);
  return unquote(res.headers.get("etag"));
}

async function getText(key: string) {
  const res = await r2.fetch(objectUrl(key));
  if (res.status === 404) throw new VaultError("not found", 404);
  if (!res.ok) throw new Error(`R2 get ${res.status}`);
  return { text: await res.text(), etag: unquote(res.headers.get("etag")) };
}

// rclone reads the modification time from x-amz-meta-mtime, so the laptop copy gets the right time.
async function put(key: string, body: string | ArrayBuffer, contentType: string) {
  const res = await r2.fetch(objectUrl(key), {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType, "x-amz-meta-mtime": (Date.now() / 1000).toFixed(3) },
  });
  if (!res.ok) throw new Error(`R2 put ${res.status}`);
  return unquote(res.headers.get("etag"));
}

async function copy(from: string, to: string) {
  const res = await r2.fetch(objectUrl(to), { method: "PUT", headers: { "x-amz-copy-source": `/${BUCKET_NAME}/${encodeKey(from)}` } });
  if (res.status === 404) throw new VaultError("not found", 404);
  if (!res.ok) throw new Error(`R2 copy ${res.status}`);
}

async function del(key: string) {
  const res = await r2.fetch(objectUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete ${res.status}`);
}

export async function signedUrls(userId: string, paths: string[]) {
  const urls: Record<string, string> = {};
  for (const p of paths) {
    urls[p] = (await r2.sign(`${objectUrl(vaultPrefix(userId) + p)}?X-Amz-Expires=3600`, { aws: { signQuery: true } })).url;
  }
  return urls;
}

// ── what the index keeps of a note ──
export function parse(text: string) {
  const tags = new Set<string>();
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const block = fm?.[1].match(/^tags:[ \t]*(.*)((?:\r?\n[ \t]*-[ \t]*.*)*)/m);
  if (block) {
    const inline = block[1].replace(/[[\]"']/g, "").split(/[,\s]+/);
    const items = [...block[2].matchAll(/-[ \t]*(.+)/g)].map((m) => m[1].replace(/["']/g, "").trim());
    for (const t of [...inline, ...items]) if (t) tags.add(t.replace(/^#/, ""));
  }
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const [, t] of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) if (!/^\d+$/.test(t)) tags.add(t);
  const links = new Set([...text.matchAll(/!?\[\[([^\]|#^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean));
  const excerpt = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]\^[\w-]+$/gm, "")
    .replace(/^#{1,6}\s+|^[ \t]*[-*+] (\[[ xX]\] )?/gm, "")
    .replace(/[*_`>~=]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  return {
    tags: [...tags],
    links: [...links],
    todo_open: (text.match(/^[ \t]*[-*+] \[ \]/gm) ?? []).length,
    todo_done: (text.match(/^[ \t]*[-*+] \[[xX]\]/gm) ?? []).length,
    excerpt,
  };
}

function fields(o: Obj, text: string | null) {
  return {
    etag: o.etag,
    size: o.size,
    modified_at: o.modified,
    title: titleOf(o.path),
    ...(text === null ? { tags: [], links: [], todo_open: 0, todo_done: 0, excerpt: null } : parse(text)),
    body: text,
    indexed_at: new Date().toISOString(),
  };
}

async function liveRows(db: SupabaseClient, userId: string) {
  const rows = new Map<string, { id: string; etag: string }>();
  for (let from = 0; ; from += 1000) {
    const page = check(await db.from("vault_files").select("id, path, etag").eq("user_id", userId).is("trashed_at", null)
      .order("path").range(from, from + 999)) as { id: string; path: string; etag: string }[];
    page.forEach((r) => rows.set(r.path, { id: r.id, etag: r.etag }));
    if (page.length < 1000) return rows;
  }
}

const liveId = async (db: SupabaseClient, userId: string, path: string) =>
  ((check(await db.from("vault_files").select("id").eq("user_id", userId).eq("path", path).is("trashed_at", null).maybeSingle()) as { id: string } | null)?.id ?? null);

async function saveRow(db: SupabaseClient, userId: string, id: string | null, path: string, f: Record<string, unknown>) {
  if (id) {
    check(await db.from("vault_files").update({ path, ...f }).eq("id", id));
    return id;
  }
  return (check(await db.from("vault_files").insert({ user_id: userId, path, ...f }).select("id").single()) as { id: string }).id;
}

async function pool<T>(items: T[], size: number, f: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await f(items[next++]);
  }));
}

// ── operations ──

// Index ← files in R2. Same content at a new path while the old path is gone = a rename / move (the id stays).
// A file gone from R2 (deleted on the laptop) moves to the trash list; restore finds it in R2's trash.
export async function scan(db: SupabaseClient, userId: string) {
  const prefix = vaultPrefix(userId);
  const [objects, live] = await Promise.all([list(prefix), liveRows(db, userId)]);
  const present = new Set(objects.map((o) => o.path));
  const gone = new Map<string, { path: string; id: string }[]>();
  for (const [path, r] of live) if (!present.has(path)) gone.set(r.etag, [...(gone.get(r.etag) ?? []), { path, id: r.id }]);
  const counts = { files: objects.length, added: 0, updated: 0, moved: 0, removed: 0 };

  const fresh: Obj[] = [];
  for (const o of objects.filter((o) => !live.has(o.path))) {
    const from = gone.get(o.etag)?.shift();
    if (!from) {
      fresh.push(o);
      continue;
    }
    check(await db.from("vault_files").update({ path: o.path, title: titleOf(o.path), modified_at: o.modified, indexed_at: new Date().toISOString() }).eq("id", from.id));
    counts.moved++;
  }
  const changed = objects.filter((o) => live.has(o.path) && live.get(o.path)!.etag !== o.etag);
  const inserts: Record<string, unknown>[] = [];
  await pool([...fresh, ...changed], 16, async (o) => {
    const text = isNote(o.path) ? (await getText(prefix + o.path)).text : null;
    const id = live.get(o.path)?.id;
    if (!id) {
      inserts.push({ user_id: userId, path: o.path, ...fields(o, text) });
      return;
    }
    check(await db.from("vault_files").update(fields(o, text)).eq("id", id));
    counts.updated++;
    if (text !== null) await syncTodos(db, userId, id, text);
  });
  for (let i = 0; i < inserts.length; i += 100) check(await db.from("vault_files").insert(inserts.slice(i, i + 100)));
  counts.added = inserts.length;

  const vanished = [...gone.values()].flat().map((r) => r.id);
  for (let i = 0; i < vanished.length; i += 100) {
    check(await db.from("vault_files").update({ trashed_at: new Date().toISOString(), trash_key: null }).in("id", vanished.slice(i, i + 100)));
  }
  counts.removed = vanished.length;

  // Notes indexed before the excerpt existed get one now (nothing to do once all have it).
  const missing = check(await db.from("vault_files").select("id, body").eq("user_id", userId).is("trashed_at", null)
    .is("excerpt", null).not("body", "is", null).limit(2000)) as { id: string; body: string }[];
  await pool(missing, 16, async (r) => {
    check(await db.from("vault_files").update({ excerpt: parse(r.body).excerpt }).eq("id", r.id));
  });
  return counts;
}

export async function readNote(db: SupabaseClient, userId: string, path: string) {
  const { text, etag } = await getText(vaultPrefix(userId) + path);
  return { id: await liveId(db, userId, path), path, text, etag };
}

export async function noteById(db: SupabaseClient, userId: string, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new VaultError("note id: uuid");
  const row = check(await db.from("vault_files").select("id, path").eq("user_id", userId).eq("id", id).is("trashed_at", null).maybeSingle()) as
    { id: string; path: string } | null;
  if (!row || !isNote(row.path)) throw new VaultError("note not found", 404);
  return row;
}

// etag: undefined = no check, null = must be a new file, text = must still be that version (else { conflict }).
export async function writeNote(db: SupabaseClient, userId: string, rawPath: unknown, text: string, etag?: string | null) {
  const path = cleanPath(rawPath);
  if (!isNote(path)) throw new VaultError("only .md notes can be written");
  if (text.length > 2_000_000) throw new VaultError("text: up to 2 MB");
  const key = vaultPrefix(userId) + path;
  if (etag !== undefined) {
    const current = await head(key);
    if ((etag ?? null) !== current) return { conflict: true as const, etag: current };
  }
  const o = { path, etag: await put(key, text, "text/markdown; charset=utf-8"), size: new TextEncoder().encode(text).length, modified: new Date().toISOString() };
  const id = await saveRow(db, userId, await liveId(db, userId, path), path, fields(o, text));
  await syncTodos(db, userId, id, text);
  return { id, path, etag: o.etag };
}

// Read → change → write, again if someone else wrote in between. change(null) = the file does not exist yet;
// returning null leaves it as it is.
export async function editNote(db: SupabaseClient, userId: string, path: string, change: (text: string | null) => string | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let current: { text: string; etag: string } | null = null;
    try {
      current = await getText(vaultPrefix(userId) + path);
    } catch (e) {
      if (!(e instanceof VaultError && e.status === 404)) throw e;
    }
    const next = change(current?.text ?? null);
    if (next === null || next === current?.text) return null;
    const r = await writeNote(db, userId, path, next, current?.etag ?? null);
    if (!("conflict" in r)) return r;
  }
  throw new Error("the note keeps changing, try again");
}

// Any file (Telegram photos and documents): stored and indexed.
export async function putFile(db: SupabaseClient, userId: string, rawPath: unknown, body: ArrayBuffer, contentType: string) {
  const path = cleanPath(rawPath);
  const o = { path, etag: await put(vaultPrefix(userId) + path, body, contentType), size: body.byteLength, modified: new Date().toISOString() };
  return saveRow(db, userId, await liveId(db, userId, path), path, fields(o, null));
}

export async function moveFile(db: SupabaseClient, userId: string, rawFrom: unknown, rawTo: unknown) {
  const from = cleanPath(rawFrom), to = cleanPath(rawTo);
  if (from === to) return { path: to };
  if (isNote(from) !== isNote(to)) throw new VaultError("keep the file type");
  const id = await liveId(db, userId, from);
  if (!id) throw new VaultError("not found", 404);
  if ((await liveId(db, userId, to)) || (await head(vaultPrefix(userId) + to))) throw new VaultError("a file with this name is already there", 409);
  await copy(vaultPrefix(userId) + from, vaultPrefix(userId) + to);
  await del(vaultPrefix(userId) + from);
  check(await db.from("vault_files").update({ path: to, title: titleOf(to), indexed_at: new Date().toISOString() }).eq("id", id));
  return { id, path: to };
}

// Into users/<id>/trash/vault/<time>/<path> (the same place rclone puts what the laptop deletes); the row stays, trashed.
export async function trashFile(db: SupabaseClient, userId: string, rawPath: unknown) {
  const path = cleanPath(rawPath);
  const id = await liveId(db, userId, path);
  const key = `${trashPrefix(userId)}${stamp()}/${path}`;
  await copy(vaultPrefix(userId) + path, key);
  await del(vaultPrefix(userId) + path);
  if (id) check(await db.from("vault_files").update({ trashed_at: new Date().toISOString(), trash_key: key }).eq("id", id));
  return { id, path };
}

async function trashKeyOf(userId: string, row: { path: string; trash_key: string | null }) {
  if (row.trash_key) return row.trash_key;
  // Deleted on the laptop: rclone moved it to trash/vault/<time>/<path>; the newest copy wins.
  const keys = (await list(trashPrefix(userId))).map((o) => o.path).filter((p) => p.endsWith(`/${row.path}`)).sort();
  return keys.length ? trashPrefix(userId) + keys[keys.length - 1] : null;
}

export async function restoreFile(db: SupabaseClient, userId: string, id: unknown) {
  const row = check(await db.from("vault_files").select("id, path, trash_key").eq("user_id", userId).eq("id", id).not("trashed_at", "is", null).maybeSingle()) as
    { id: string; path: string; trash_key: string | null } | null;
  if (!row) throw new VaultError("not in the trash", 404);
  const key = await trashKeyOf(userId, row);
  if (!key) throw new VaultError("the file is no longer in the trash", 404);
  let path = row.path;
  for (let n = 1; (await liveId(db, userId, path)) || (await head(vaultPrefix(userId) + path)); n++) {
    path = row.path.replace(/(\.[^./]+)?$/, ` (restored${n > 1 ? ` ${n}` : ""})$1`);
  }
  await copy(key, vaultPrefix(userId) + path);
  await del(key);
  const etag = await head(vaultPrefix(userId) + path);
  check(await db.from("vault_files").update({ path, title: titleOf(path), etag, trashed_at: null, trash_key: null, indexed_at: new Date().toISOString() }).eq("id", row.id));
  return { id: row.id, path };
}

export async function purgeFile(db: SupabaseClient, userId: string, id: unknown) {
  const row = check(await db.from("vault_files").select("id, path, trash_key").eq("user_id", userId).eq("id", id).not("trashed_at", "is", null).maybeSingle()) as
    { id: string; path: string; trash_key: string | null } | null;
  if (!row) throw new VaultError("not in the trash", 404);
  const key = await trashKeyOf(userId, row);
  if (key) await del(key);
  check(await db.from("vault_files").delete().eq("id", row.id));
  return { id: row.id, purged: true };
}

// ── note to-dos ↔ subtasks of linked tasks (P-57; the rule of the old notes: top-level "- [ ]" lines, by position) ──
const TODO = /^- \[( |x)\] (.+)$/gm;
const todosOf = (text: string) =>
  [...text.replace(/\r\n/g, "\n").matchAll(TODO)].map((m) => ({ title: m[2].replace(/\s\^[\w-]+$/, ""), completed: m[1] === "x" }));

export async function syncTodos(db: SupabaseClient, userId: string, noteId: string, text: string) {
  const links = check(await db.from("note_task_links").select("task_id").eq("note_id", noteId)) as { task_id: string }[];
  if (!links.length) return;
  const todos = todosOf(text);
  for (const { task_id } of links) {
    const existing = check(await db.from("subtasks").select("id, title, completed").eq("note_id", noteId).eq("parent_task_id", task_id)
      .order("position")) as { id: string; title: string; completed: boolean }[];
    for (const [i, t] of todos.entries()) {
      const ex = existing[i];
      if (!ex) check(await db.from("subtasks").insert({ user_id: userId, note_id: noteId, parent_task_id: task_id, title: t.title, completed: t.completed, position: i }));
      else if (ex.title !== t.title || ex.completed !== t.completed) {
        check(await db.from("subtasks").update({ title: t.title, completed: t.completed, position: i }).eq("id", ex.id));
      }
    }
    const extra = existing.slice(todos.length).map((s) => s.id);
    if (extra.length) check(await db.from("subtasks").delete().in("id", extra));
  }
}

// A subtask ticked in a task → the same line in the note.
export async function toggleTodo(db: SupabaseClient, userId: string, noteId: unknown, title: string, completed: boolean) {
  const { path } = await noteById(db, userId, noteId);
  return editNote(db, userId, path, (text) => {
    if (text === null) return null;
    const lines = text.split("\n");
    const i = lines.findIndex((l) => {
      const m = l.replace(/\r$/, "").match(/^- \[( |x)\] (.+)$/);
      return m && m[2].replace(/\s\^[\w-]+$/, "") === title;
    });
    if (i < 0) return null;
    lines[i] = lines[i].replace(/^- \[( |x)\]/, `- [${completed ? "x" : " "}]`);
    return lines.join("\n");
  });
}

// ── the Inbox (P-49, P-57): the one capture place is the Inbox folder of the notes. Telegram and MCP captures go to
// the day's capture note, Inbox/<date>.md, a section per kind; an item is a list line ending in ^<marker>. ──
export const INBOX = "Inbox";
export const inboxNotePath = (day: string) => `${INBOX}/${day}.md`;
export const CAPTURE_SECTIONS: Record<string, string> = { idea: "Ideas", question: "Questions", todo: "To-dos", resource: "Resources", note: "Notes" };
const HEADINGS = new Set(Object.values(CAPTURE_SECTIONS).map((s) => `## ${s}`));

// The day and time of a moment in the user's own time zone (set by the app; UTC until then).
export function localTime(at: Date, timeZone: string) {
  const format = (tz: string) => ({
    day: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at),
  });
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

export async function userTimeZone(db: SupabaseClient, userId: string) {
  const row = check(await db.from("telegram_links").select("time_zone").eq("user_id", userId).maybeSingle()) as { time_zone: string } | null;
  return row?.time_zone || "UTC";
}

// One captured item: "- 14:32 text ^marker" (a to-do: "- [ ] text ^marker"), more lines indented under it.
export function captureItem(o: { kind: string | null; time: string; text: string; marker: string; checked?: boolean; more?: string[] }) {
  const [first = "", ...rest] = o.text.trim().split(/\r?\n/);
  const head = o.kind === "todo" ? `- [${o.checked ? "x" : " "}] ${first}` : `- ${o.time} ${first}`;
  const lines = [...rest, ...(o.more ?? [])].map((l) => l.trim()).filter(Boolean);
  return [`${head.trimEnd()} ^${o.marker}`, ...lines.map((l) => `  ${l}`)].join("\n");
}

// Line numbers of an item: its first line and the indented lines under it.
function itemRange(lines: string[], marker: string) {
  const start = lines.findIndex((l) => l.trimEnd().endsWith(` ^${marker}`));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^ {2,}\S/.test(lines[end])) end++;
  return { start, end };
}

export const hasItem = (text: string | null, marker: string) => !!text && !!itemRange(text.split("\n"), marker);

export function sectionOfItem(text: string, marker: string) {
  const lines = text.split("\n");
  const r = itemRange(lines, marker);
  if (!r) return null;
  for (let i = r.start; i >= 0; i--) if (HEADINGS.has(lines[i].trim())) return lines[i].trim().slice(3);
  return null;
}

export function addItem(text: string | null, section: string, item: string) {
  const lines = (text ?? "").replace(/\s+$/, "").split("\n").filter((l, i, a) => a.length > 1 || l !== "");
  const heading = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (heading < 0) return [...lines, ...(lines.length ? [""] : []), `## ${section}`, item].join("\n") + "\n";
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2} /.test(lines[end])) end++;
  while (end > heading + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, item);
  return lines.join("\n") + "\n";
}

export function removeItem(text: string, marker: string) {
  const lines = text.split("\n");
  const r = itemRange(lines, marker);
  if (!r) return text;
  lines.splice(r.start, r.end - r.start);
  return lines.join("\n");
}

export function replaceItem(text: string, marker: string, item: string) {
  const lines = text.split("\n");
  const r = itemRange(lines, marker);
  if (!r) return text;
  lines.splice(r.start, r.end - r.start, item);
  return lines.join("\n");
}
