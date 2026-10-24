import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import type { StrategyNode } from "@/lib/strategy";

type NodeInsert = Database["public"]["Tables"]["strategy_nodes"]["Insert"];
type NodeUpdate = Database["public"]["Tables"]["strategy_nodes"]["Update"];

const keyOf = (userId?: string) => ["strategy-nodes", userId];

// All strategy nodes of the user (a few hundred at most; the tree is built in the browser).
export function useStrategyNodes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keyOf(user?.id),
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("strategy_nodes").select("*").order("position").order("created_at");
      if (error) throw error;
      return data as StrategyNode[];
    },
  });
}

// Changes show at once and are undone if the server refuses them.
export function useStrategyActions() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = keyOf(user?.id);

  const failed = useCallback((title: string, error: { message: string }) => {
    toast({ title, description: error.message, variant: "destructive" });
  }, []);

  const create = useCallback(async (row: Omit<NodeInsert, "user_id">) => {
    const siblings = (qc.getQueryData<StrategyNode[]>(key) ?? []).filter((n) => n.parent_id === (row.parent_id ?? null));
    const { data, error } = await supabase.from("strategy_nodes")
      .insert({ position: siblings.length, ...row })
      .select().single();
    if (error) {
      failed("Not saved", error);
      return null;
    }
    qc.setQueryData<StrategyNode[]>(key, (prev = []) => [...prev, data as StrategyNode]);
    return data as StrategyNode;
  }, [qc, key, failed]);

  const update = useCallback(async (id: string, patch: NodeUpdate) => {
    const before = qc.getQueryData<StrategyNode[]>(key);
    qc.setQueryData<StrategyNode[]>(key, (prev = []) => prev.map((n) => (n.id === id ? { ...n, ...patch } as StrategyNode : n)));
    const { data, error } = await supabase.from("strategy_nodes").update(patch).eq("id", id).select().single();
    if (error) {
      qc.setQueryData(key, before);
      failed("Not saved", error);
      return;
    }
    // done_at / updated_at come from the server.
    qc.setQueryData<StrategyNode[]>(key, (prev = []) => prev.map((n) => (n.id === id ? (data as StrategyNode) : n)));
  }, [qc, key, failed]);

  // Deleting a node deletes everything inside it (the DB cascades); linked tasks stay.
  const remove = useCallback(async (id: string) => {
    const before = qc.getQueryData<StrategyNode[]>(key) ?? [];
    const gone = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of before) if (n.parent_id && gone.has(n.parent_id) && !gone.has(n.id)) { gone.add(n.id); grew = true; }
    }
    qc.setQueryData<StrategyNode[]>(key, before.filter((n) => !gone.has(n.id)));
    const { error } = await supabase.from("strategy_nodes").delete().eq("id", id);
    if (error) {
      qc.setQueryData(key, before);
      failed("Not deleted", error);
    }
  }, [qc, key, failed]);

  return { create, update, remove };
}
