// Ideas from everywhere (P-64, owner 2026-10-25: "ideas come up in different projects and are scattered"): one list
// of every idea in the user's files — Obsidian, Projects, Documents, the Inbox. An idea is
//   a whole note: in an ideas folder (Ideas, İdeyalar …), tagged #idea / #ideya, or linking [[Ideya]];
//   a list item under a heading that names ideas in the plural — "Ideas", "İdeyalar", "Gələcək ideyalar" (Telegram's
//   "## Ideas" in the daily notes too); a singular "The idea" / "Əsas ideya" explains, it is not a list of ideas;
//   a heading marked as an idea: "### P-12 Title — IDEA (…)" (plans), "## #232 Title (2026-10-24, ideya)";
//   a task-table row whose status is IDEA;
//   a list line tagged #idea.
// Used by the vault function (the Ideas page) and MCP.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export type Idea = {
  file_id: string;
  path: string;
  title: string; // of the note
  modified_at: string;
  kind: "note" | "item" | "plan" | "row" | "line";
  text: string;
  detail: string | null; // a whole note's first words
  line: number | null;
};

const IDEAS = /(^|[^\p{L}\p{N}])[iİI]de(?:as|yalar)(?=[^\p{L}\p{N}]|$)/iu; // plural: a section of ideas
const TAG = /(^|\s)#[iİI]de(?:a|ya)\b/giu;

// What a line says: no list mark, checkbox, Telegram time, block id, link brackets or emphasis.
const plain = (s: string) =>
  s
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/^\d{1,2}:\d{2}\s+/, "")
    .replace(/\s\^[\w-]+\s*$/, "")
    .replace(/~~[^~]*~~/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function ideasIn(body: string) {
  const lines = body.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: { line: number; text: string; kind: Idea["kind"] }[] = [];
  let fence = false;
  let section: number | null = null; // level of the ideas heading we are under
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (section !== null && level <= section) section = null;
      const marked = h[2].match(/^(.*?)\s+[—–-]\s+IDEA\b/) ?? h[2].match(/^(.*?)\s*\((?:[^()]*,\s*)?ideya\)\s*$/i);
      if (marked) out.push({ line: i, text: plain(marked[1]), kind: "plan" });
      else if (level >= 2 && IDEAS.test(h[2])) section = level; // a title (#) is the file's name, not a section
      continue;
    }
    // A table with a Status column: its IDEA rows.
    if (l.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = cells(l).map((c) => plain(c).toLowerCase());
      const status = head.indexOf("status");
      const named = head.findIndex((c, k) => k !== status && /^(task|tasks|what|title|nə|tapşırıq|item|idea)$/.test(c));
      const textCol = named >= 0 ? named : head.length > 2 ? 1 : 0;
      let k = i + 2;
      for (; k < lines.length && lines[k].trim().startsWith("|"); k++) {
        const c = cells(lines[k]);
        if (status >= 0 && /^IDEA$/i.test(plain(c[status] ?? ""))) out.push({ line: k, text: plain(c[textCol] ?? ""), kind: "row" });
      }
      i = k - 1;
      continue;
    }
    const item = l.match(/^(\s*)[-*+]\s+(.*)$/);
    if (item) {
      const depth = item[1].replace(/\t/g, "  ").length;
      if (section !== null && depth < 2) out.push({ line: i, text: plain(item[2]), kind: "item" });
      else if (TAG.test(item[2])) out.push({ line: i, text: plain(item[2].replace(TAG, " ")), kind: "line" });
      TAG.lastIndex = 0;
      continue;
    }
  }
  return out.filter((o) => o.text);
}

export async function collectIdeas(db: SupabaseClient, userId: string) {
  const { data, error } = await db.rpc("idea_candidates", { p_user: userId });
  if (error) throw new Error(error.message);
  const ideas: Idea[] = [];
  for (const f of data as { id: string; path: string; title: string; excerpt: string | null; modified_at: string; body: string | null; whole: boolean }[]) {
    const base = { file_id: f.id, path: f.path, title: f.title, modified_at: f.modified_at };
    if (f.whole) {
      ideas.push({ ...base, kind: "note", text: f.title, detail: f.excerpt?.slice(0, 280) || null, line: null });
      continue;
    }
    for (const o of ideasIn(f.body ?? "")) ideas.push({ ...base, kind: o.kind, text: o.text, detail: null, line: o.line });
  }
  ideas.sort((a, b) => b.modified_at.localeCompare(a.modified_at) || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  return ideas;
}
