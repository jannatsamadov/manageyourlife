// Comments on items (#200): a dated thread of decisions, results and "why it stopped", written here or by an AI
// through the MCP (via = 'mcp'); the AI reads them as the item's history. Only the author changes or deletes one (RLS).
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import { useWorkspace } from "./items";

export type ItemComment = Tables<"item_comments">;

const commentsKey = (itemId: string) => ["item-comments", itemId];

export function useItemComments(itemId: string) {
  return useQuery({
    queryKey: commentsKey(itemId),
    queryFn: async () => {
      const { data, error } = await supabase.from("item_comments").select("*").eq("item_id", itemId).order("created_at");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCommentActions(itemId: string) {
  const qc = useQueryClient();
  const { data: ws } = useWorkspace();
  const settled = useCallback((error: { message: string } | null, title: string) => {
    if (error) toast({ title, description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: commentsKey(itemId) });
    return !error;
  }, [qc, itemId]);

  // workspace_id: the DB takes the item's own; sent only because the row needs one.
  const add = useCallback(async (body: string) => {
    if (!ws) return false;
    const { error } = await supabase.from("item_comments").insert({ item_id: itemId, workspace_id: ws.id, body });
    return settled(error, "Not sent");
  }, [ws, itemId, settled]);

  const edit = useCallback(async (id: string, body: string) => {
    const { error } = await supabase.from("item_comments").update({ body }).eq("id", id);
    return settled(error, "Not saved");
  }, [settled]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("item_comments").delete().eq("id", id);
    return settled(error, "Not deleted");
  }, [settled]);

  return { add, edit, remove };
}
