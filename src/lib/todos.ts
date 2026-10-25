// The task store (P-53, owner 2026-10-25): every to-do written in the files — Obsidian notes, the Projects and
// Documents folders — gathered on the Tasks page by project. The files stay the truth: a tick writes "- [x]".
// Two kinds: "- [ ] text" lines (any depth, - * +) and rows of task tables (a Markdown table with a Status column,
// like the projects' TASKS.md), shown read-only.
import { supabase } from "@/integrations/supabase/client";
import { fileName, folderOf } from "@/lib/vault";

export type TodoFile = { id: string; path: string; title: string; modified_at: string };
export type Todo = { kind: "todo"; file: TodoFile; line: number; raw: string; text: string; done: boolean; depth: number };
export type TableTask = { kind: "row"; file: TodoFile; line: number; ref: string; text: string; status: string; done: boolean };
export type Item = Todo | TableTask;

// Files with open to-dos, and task lists by name (their tables have no checkboxes).
export async function loadTodoFiles() {
  const out: (TodoFile & { body: string | null })[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from("vault_files")
      .select("id, path, title, modified_at, body")
      .is("trashed_at", null)
      .or("todo_open.gt.0,path.ilike.%tasks%.md,path.ilike.%todo%.md")
      .order("path")
      .range(from, from + 499);
    if (error) throw error;
    out.push(...data);
    if (data.length < 500) return out;
  }
}

// What a line says, without Markdown marks, block ids and [[link|alias]] brackets.
export const plain = (s: string) =>
  s
    .replace(/\s\^[\w-]+\s*$/, "")
    .replace(/~~[^~]*~~[,;]?/g, "") // struck-out parts are done
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const CHECK = /^([ \t]*)[-*+] \[( |x|X)\] (.*)$/;
const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const CLOSED = /^(done|dropped|abandoned|cancel+ed|wontfix|\d{4}-\d{2}-\d{2})/i;

export function itemsOf(file: TodoFile, body: string): Item[] {
  const lines = body.split("\n").map((l) => l.replace(/\r$/, ""));
  const items: Item[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const m = l.match(CHECK);
    if (m) {
      const text = plain(m[3]);
      if (text) items.push({ kind: "todo", file, line: i, raw: m[3], text, done: m[2] !== " ", depth: Math.floor(m[1].replace(/\t/g, "  ").length / 2) });
      continue;
    }
    // A table: header row, then |---|---|; a Status column makes it a task list.
    if (l.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = cells(l).map((h) => plain(h).toLowerCase());
      const status = head.findIndex((h) => h === "status");
      if (status < 0) continue;
      const named = head.findIndex((h, k) => k !== status && /^(task|tasks|what|title|nə|tapşırıq|item)$/.test(h));
      const textCol = named >= 0 ? named : head.length > 2 ? 1 : 0;
      let k = i + 2;
      for (; k < lines.length && lines[k].trim().startsWith("|"); k++) {
        const c = cells(lines[k]);
        const text = plain(c[textCol] ?? "");
        const st = plain(c[status] ?? "");
        if (text) items.push({ kind: "row", file, line: k, ref: textCol === 0 ? "" : plain(c[0] ?? ""), text, status: st, done: CLOSED.test(st) });
      }
      i = k - 1;
    }
  }
  return items;
}

// The project of a file: its first two folders ("Projects/clsmng", "Notes/Ideas"); files at the top → "".
export const projectOf = (path: string) => folderOf(path).split("/").slice(0, 2).filter(Boolean).join("/");
export const projectName = (project: string) => (project ? fileName(project) : "Vault");

// Hidden on the Tasks page: a folder hides everything under it, a file only itself.
export const isHidden = (path: string, hidden: Set<string>) => {
  for (let p = path; p; p = folderOf(p)) if (hidden.has(p)) return p;
  return null;
};
