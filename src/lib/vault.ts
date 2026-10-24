// Notes as files (P-21): the `vault` function (files in R2) and Obsidian-style name resolution.
import { supabase } from "@/integrations/supabase/client";

export type VaultFile = { path: string; title: string; tags: string[]; modified_at: string; size: number; etag: string; todo_open: number };

export async function vault<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vault", { body: { action, ...args } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return data as T;
}

// The index of the files (no note text: that is read from the file when a note opens).
export async function loadIndex() {
  const out: VaultFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("vault_files")
      .select("path, title, tags, modified_at, size, etag, todo_open")
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
    .ilike("body", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    .limit(300);
  if (error) throw error;
  return new Set(data.map((r) => r.path));
}

export const isNote = (path: string) => /\.md$/i.test(path);
export const isImage = (path: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
export const fileName = (path: string) => path.split("/").pop()!;
export const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

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
