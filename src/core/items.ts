// v2 data layer (P-70): every item of the user's workspace in one TanStack Query cache, kept fresh by Supabase
// Realtime; writes show at once and are rolled back when the server refuses them. Pages read items through hooks
// (here and in the adapters next to this file), never through Supabase directly. Written so a phone app can reuse it.
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Item = Tables<"items">;
// The DB sets these itself: number (the item's #N in its workspace, #200), done_at, spent_min, the stamps.
export type ItemPatch = Omit<TablesUpdate<"items">, "id" | "workspace_id" | "number" | "created_at" | "updated_at" | "done_at" | "spent_min">;
export type NewItem = Omit<TablesInsert<"items">, "workspace_id" | "number" | "created_by" | "created_at" | "updated_at" | "done_at" | "spent_min"> & { type: string; title: string };
export type TimeLog = Tables<"time_logs">;

const PAGE = 1000; // PostgREST's row limit per request

async function fetchPaged<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// ── workspace ──
// The personal workspace (teams later: a picker and the chosen id here).
export function useWorkspace() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["workspace", user?.id],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("id, name").eq("personal_of", user!.id).single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

// ── items ──
export const itemsKey = (workspaceId?: string) => ["items", workspaceId];

// All items of the workspace, the trashed ones too (the Trash page); a few thousand rows at most for a person.
export function useItems() {
  const { data: ws } = useWorkspace();
  return useQuery({
    queryKey: itemsKey(ws?.id),
    enabled: !!ws,
    queryFn: () => fetchPaged<Item>((from, to) =>
      supabase.from("items").select("*").eq("workspace_id", ws!.id).order("position").order("created_at").range(from, to)),
  });
}

const merge = (rows: Item[] = [], changed: Item[], removed: string[] = []) => {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const c of changed) byId.set(c.id, c);
  for (const id of removed) byId.delete(id);
  return [...byId.values()];
};

// Changes made anywhere (another tab, the phone, MCP, Telegram, the Google import) come in here. Mounted once.
export function useItemsRealtime() {
  const { data: ws } = useWorkspace();
  const qc = useQueryClient();
  useEffect(() => {
    if (!ws) return;
    const key = itemsKey(ws.id);
    const channel = supabase
      .channel(`items:${ws.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `workspace_id=eq.${ws.id}` },
        (p: RealtimePostgresChangesPayload<Item>) => {
          if (p.eventType === "DELETE") qc.setQueryData<Item[]>(key, (prev) => prev && merge(prev, [], [(p.old as Item).id]));
          else qc.setQueryData<Item[]>(key, (prev) => prev && merge(prev, [p.new as Item]));
        })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ws, qc]);
}

// The DB rules the UI should show at once (the server applies them too): times go with their dates, done_at follows
// the status.
function settle(i: Item): Item {
  const out = { ...i };
  if (!out.planned_on) Object.assign(out, { planned_time: null, is_event: false });
  if (!out.due_on) out.due_time = null;
  out.done_at = out.status === "done" ? out.done_at ?? new Date().toISOString() : null;
  return out;
}

const failed = (title: string, e: unknown) =>
  toast({ title, description: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), variant: "destructive" });

export function useItemActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: ws } = useWorkspace();
  const key = itemsKey(ws?.id);

  // New item: made with a client id, shown at once, replaced by the server's row.
  const create = useCallback(async (row: NewItem): Promise<Item | null> => {
    if (!ws || !user) return null;
    const now = new Date().toISOString();
    const draft = settle({
      id: crypto.randomUUID(), workspace_id: ws.id, number: 0 /* the server's row brings it */, body: "", status: "todo", parent_id: null, position: 0, url: null, color: null,
      planned_on: null, planned_time: null, is_event: false, start_on: null, due_on: null, due_time: null, done_at: null,
      archived_at: null, deleted_at: null, priority: null, estimate_min: null, spent_min: 0, cost_planned: null, cost_spent: null,
      weight: 1, target_count: null, progress: null, props: {}, created_by: user.id, created_at: now, updated_at: now,
      ...row,
    } as Item);
    qc.setQueryData<Item[]>(key, (prev) => merge(prev, [draft]));
    const { data, error } = await supabase.from("items").insert({ ...row, id: draft.id, workspace_id: ws.id, created_by: user.id }).select().single();
    if (error) {
      qc.setQueryData<Item[]>(key, (prev) => merge(prev, [], [draft.id]));
      failed("Not saved", error);
      return null;
    }
    qc.setQueryData<Item[]>(key, (prev) => merge(prev, [data]));
    return data;
  }, [qc, key, ws, user]);

  // Several changes at once (a drag that renumbers a list counts as one); all are undone if one is refused.
  const updateMany = useCallback(async (changes: { id: string; patch: ItemPatch }[]): Promise<boolean> => {
    const before = qc.getQueryData<Item[]>(key);
    const current = new Map((before ?? []).map((i) => [i.id, i]));
    qc.setQueryData<Item[]>(key, (prev) =>
      merge(prev, changes.flatMap(({ id, patch }) => (current.has(id) ? [settle({ ...current.get(id)!, ...patch } as Item)] : []))));
    const results = await Promise.all(changes.map(({ id, patch }) => supabase.from("items").update(patch).eq("id", id).select().single()));
    const error = results.find((r) => r.error)?.error;
    if (error) {
      qc.setQueryData(key, before);
      failed("Not saved", error);
      return false;
    }
    qc.setQueryData<Item[]>(key, (prev) => merge(prev, results.map((r) => r.data!)));
    return true;
  }, [qc, key]);

  const update = useCallback((id: string, patch: ItemPatch) => updateMany([{ id, patch }]), [updateMany]);

  // Deleted for good (the trash is deleted_at): items given in one statement, so a subtree goes at once and what
  // the DB keeps (tasks inside a deleted strategy node) moves to the top.
  const remove = useCallback(async (ids: string[]): Promise<boolean> => {
    const before = qc.getQueryData<Item[]>(key);
    qc.setQueryData<Item[]>(key, (prev) => merge(prev?.map((i) => (i.parent_id && ids.includes(i.parent_id) ? { ...i, parent_id: null } : i)), [], ids));
    const { error } = await supabase.from("items").delete().in("id", ids);
    if (error) {
      qc.setQueryData(key, before);
      failed("Not deleted", error);
      return false;
    }
    return true;
  }, [qc, key]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: key }), [qc, key]);

  return { create, update, updateMany, remove, refresh };
}

// ── time logs (the timer, P-9) ──
export const logsKey = (workspaceId?: string) => ["time_logs", workspaceId];

export function useTimeLogs() {
  const { data: ws } = useWorkspace();
  return useQuery({
    queryKey: logsKey(ws?.id),
    enabled: !!ws,
    queryFn: () => fetchPaged<TimeLog>((from, to) =>
      supabase.from("time_logs").select("*").eq("workspace_id", ws!.id).order("started_at").range(from, to)),
  });
}

// One timer runs per person: starting one stops the other. items.spent_min follows from the DB (and comes back by
// Realtime).
export function useTimer() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: ws } = useWorkspace();
  const key = logsKey(ws?.id);

  const start = useCallback(async (itemId: string) => {
    if (!user || !ws) return;
    const now = new Date().toISOString();
    const stopped = await supabase.from("time_logs").update({ ended_at: now }).eq("user_id", user.id).is("ended_at", null);
    const res = stopped.error ? stopped : await supabase.from("time_logs").insert({ item_id: itemId, started_at: now, workspace_id: ws.id });
    if (res.error) failed("Timer not started", res.error);
    qc.invalidateQueries({ queryKey: key });
  }, [qc, key, user, ws]);

  const stop = useCallback(async (itemId: string) => {
    const { error } = await supabase.from("time_logs").update({ ended_at: new Date().toISOString() }).eq("item_id", itemId).is("ended_at", null);
    if (error) failed("Timer not stopped", error);
    qc.invalidateQueries({ queryKey: key });
  }, [qc, key]);

  return { start, stop };
}
