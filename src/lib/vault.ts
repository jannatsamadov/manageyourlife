// Notes as files (P-21, P-57): the `vault` function (files in R2), the index, folders and Obsidian-style name resolution.
import { supabase } from "@/integrations/supabase/client";

export type VaultFile = {
  id: string;
  path: string;
  title: string;
  tags: string[];
  modified_at: string;
  size: number;
  etag: string;
  todo_open: number;
  todo_done: number;
  excerpt: string | null;
};

export async function vault<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vault", { body: { action, ...args } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return data as T;
}

// Index ← files in R2, in batches (a whole synced folder can arrive at once). Returns what changed in all batches.
export async function scanAll() {
  const total = { added: 0, updated: 0, moved: 0, removed: 0 };
  for (let i = 0; i < 20; i++) {
    const r = await vault<typeof total & { more?: boolean }>("scan");
    total.added += r.added;
    total.updated += r.updated;
    total.moved += r.moved;
    total.removed += r.removed;
    if (!r.more) break;
  }
  return total;
}

// The index of the live files (no note text: that is read from the file when a note opens).
export async function loadIndex() {
  const out: VaultFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("vault_files")
      .select("id, path, title, tags, modified_at, size, etag, todo_open, todo_done, excerpt")
      .is("trashed_at", null)
      .order("path")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Notes whose text contains `q` (searched in the database, not in the browser).
export async function searchText(q: string) {
  const { data, error } = await supabase
    .from("vault_files")
    .select("path")
    .is("trashed_at", null)
    .ilike("body", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    .limit(300);
  if (error) throw error;
  return new Set(data.map((r) => r.path));
}

export const isNote = (path: string) => /\.md$/i.test(path);
export const isImage = (path: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
export const fileName = (path: string) => path.split("/").pop()!;
export const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
// A file name Windows and Obsidian links accept.
export const safeName = (s: string) => s.trim().replace(/[\\/:*?"<>|#^[\]]+/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/, "").slice(0, 150);
export const INBOX = "Inbox"; // new notes from the app and the Inbox page

// Folders of the notes, each with what the gallery shows: counts, latest notes, to-dos, last change, common tag.
export type Dir = {
  name: string;
  path: string;
  dirs: Dir[];
  notes: VaultFile[];
  count: number;
  latest: VaultFile[];
  todoOpen: number;
  todoDone: number;
  modified: string;
  tag: string | null;
};

export function buildTree(files: VaultFile[]) {
  const root: Dir = { name: "", path: "", dirs: [], notes: [], count: 0, latest: [], todoOpen: 0, todoDone: 0, modified: "", tag: null };
  const dirs = new Map([["", root]]);
  const dirOf = (path: string): Dir => {
    let d = dirs.get(path);
    if (!d) {
      d = { name: fileName(path), path, dirs: [], notes: [], count: 0, latest: [], todoOpen: 0, todoDone: 0, modified: "", tag: null };
      dirOf(folderOf(path)).dirs.push(d);
      dirs.set(path, d);
    }
    return d;
  };
  for (const f of files) if (isNote(f.path)) dirOf(folderOf(f.path)).notes.push(f);
  const fill = (d: Dir): VaultFile[] => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name, "az"));
    d.notes.sort((a, b) => a.title.localeCompare(b.title, "az"));
    const all = [...d.notes, ...d.dirs.flatMap(fill)];
    d.count = all.length;
    d.latest = [...all].sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 6);
    d.modified = d.latest[0]?.modified_at ?? "";
    d.todoOpen = all.reduce((s, f) => s + f.todo_open, 0);
    d.todoDone = all.reduce((s, f) => s + f.todo_done, 0);
    const tags = new Map<string, number>();
    all.forEach((f) => f.tags.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1)));
    d.tag = [...tags].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return all;
  };
  fill(root);
  return { root, dirs };
}

// [[name]] like Obsidian: an exact path, else the file name anywhere in the vault (the shortest path wins).
export function resolver(files: VaultFile[]) {
  const byPath = new Map<string, string>(), byName = new Map<string, string>();
  for (const f of files) {
    byPath.set(f.path.toLowerCase(), f.path);
    const name = fileName(f.path).toLowerCase();
    for (const key of isNote(f.path) ? [name, name.slice(0, -3)] : [name]) {
      const prev = byName.get(key);
      if (!prev || f.path.length < prev.length) byName.set(key, f.path);
    }
  }
  return (target: string) => {
    const t = target.trim().replace(/\\/g, "/").toLowerCase();
    return byPath.get(t) ?? byPath.get(`${t}.md`) ?? byName.get(fileName(t)) ?? null;
  };
}

// Files a note points at: [[links]], ![[embeds]] and relative Markdown links / images.
export function targetsOf(text: string) {
  const wiki = [...text.matchAll(/!?\[\[([^\]|#^\n]+)/g)].map((m) => m[1]);
  const plain = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("#"));
  return [...wiki, ...plain.map((u) => { try { return decodeURIComponent(u); } catch { return u; } })];
}

// Folder colours of the gallery: the owner's reference blue first, then the same look in other hues.
export const FOLDER_COLORS: Record<string, { back: string; start: string; end: string; glow: string }> = {
  "#469cf4": { back: "#469cf4", start: "#6db6fb", end: "#3b93ee", glow: "rgba(56, 166, 253, 0.45)" },
  "#34b37a": { back: "#34b37a", start: "#5fd29a", end: "#2aa56c", glow: "rgba(52, 179, 122, 0.45)" },
  "#f2a93b": { back: "#f2a93b", start: "#f8c46a", end: "#ec9a25", glow: "rgba(242, 169, 59, 0.45)" },
  "#f07c3a": { back: "#f07c3a", start: "#f79d65", end: "#ea6c26", glow: "rgba(240, 124, 58, 0.45)" },
  "#ec5f8a": { back: "#ec5f8a", start: "#f585a6", end: "#e44b7a", glow: "rgba(236, 95, 138, 0.45)" },
  "#8b6cf0": { back: "#8b6cf0", start: "#a98ff7", end: "#7c5ae8", glow: "rgba(139, 108, 240, 0.45)" },
  "#64748b": { back: "#64748b", start: "#8796ab", end: "#56657a", glow: "rgba(100, 116, 139, 0.45)" },
};
