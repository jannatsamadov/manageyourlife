// Items ↔ notes (P-57, P-70): a link is an item_links row of kind 'note'; a note's "- [ ]" lines are read from the
// file itself (no copies — the note stays their truth; ticking one in the app ticks the line in the note).
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { vault } from "@/lib/vault";
import { useWorkspace } from "./items";

export type LinkedNote = { id: string; title: string; path: string };
export type NoteTodo = { id: string; title: string; completed: boolean; position: number; note_id: string; note_title: string };

const notesKey = (itemId: string) => ["item-notes", itemId];
const itemsOfNoteKey = (noteId: string) => ["note-items", noteId];

// Top-level "- [ ]" / "- [x]" lines; an Obsidian block id at the end is not part of the text.
export const todosOf = (text: string) =>
  [...text.replace(/\r\n/g, "\n").matchAll(/^- \[( |x)\] (.+)$/gm)].map((m) => ({ title: m[2].replace(/\s\^[\w-]+$/, ""), completed: m[1] === "x" }));

export function useItemNotes(itemId: string) {
  return useQuery({
    queryKey: notesKey(itemId),
    queryFn: async () => {
      const { data, error } = await supabase.from("item_links").select("vault_files(id, title, path, trashed_at)").eq("from_id", itemId).eq("kind", "note");
      if (error) throw new Error(error.message);
      return (data as unknown as { vault_files: (LinkedNote & { trashed_at: string | null }) | null }[])
        .map((l) => l.vault_files).filter((n): n is LinkedNote & { trashed_at: string | null } => !!n && !n.trashed_at)
        .map(({ id, title, path }) => ({ id, title, path }));
    },
  });
}

export function useNoteTodos(itemId: string) {
  const notes = useItemNotes(itemId);
  return useQuery({
    queryKey: ["note-todos", itemId, notes.data?.map((n) => n.id).join(",")],
    enabled: !!notes.data,
    queryFn: async () => {
      const lists = await Promise.all((notes.data ?? []).map(async (n) => {
        const { text } = await vault<{ text: string | null }>("read", { path: n.path });
        return todosOf(text ?? "").map((t, k): NoteTodo => ({ id: `${n.id}:${k}`, ...t, position: k, note_id: n.id, note_title: n.title }));
      }));
      return lists.flat();
    },
  });
}

// The items a note is linked to.
export function useNoteItems(noteId: string) {
  return useQuery({
    queryKey: itemsOfNoteKey(noteId),
    queryFn: async () => {
      const { data, error } = await supabase.from("item_links").select("from_id").eq("file_id", noteId).eq("kind", "note");
      if (error) throw new Error(error.message);
      return data.map((l) => l.from_id);
    },
  });
}

export function useNoteLinkActions() {
  const qc = useQueryClient();
  const { data: ws } = useWorkspace();
  const changed = (itemId: string, noteId: string) => {
    qc.invalidateQueries({ queryKey: notesKey(itemId) });
    qc.invalidateQueries({ queryKey: itemsOfNoteKey(noteId) });
  };

  const link = useCallback(async (itemId: string, noteId: string) => {
    if (!ws) return false;
    const { error } = await supabase.from("item_links").insert({ from_id: itemId, file_id: noteId, kind: "note", workspace_id: ws.id });
    if (error && error.code !== "23505") { // 23505: linked already
      toast({ title: "Not linked", description: error.message, variant: "destructive" });
      return false;
    }
    changed(itemId, noteId);
    return true;
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlink = useCallback(async (itemId: string, noteId: string) => {
    const { error } = await supabase.from("item_links").delete().eq("from_id", itemId).eq("file_id", noteId).eq("kind", "note");
    if (error) toast({ title: "Not unlinked", description: error.message, variant: "destructive" });
    changed(itemId, noteId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A note's to-do ticked in the app → the same line in the file (server side, version-checked).
  const toggleTodo = useCallback(async (todo: NoteTodo, completed: boolean, itemId: string) => {
    await vault("toggle_todo", { note_id: todo.note_id, title: todo.title, completed })
      .catch((e: Error) => toast({ title: "Not ticked in the note", description: e.message, variant: "destructive" }));
    qc.invalidateQueries({ queryKey: ["note-todos", itemId] });
  }, [qc]);

  return { link, unlink, toggleTodo };
}
