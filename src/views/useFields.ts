// Custom fields of the workspace (P-70 "Adding columns later", GitHub Projects' "+ field"): rows of `fields`; the
// values live in items.props[key]. Deleting a field keeps the values in the items (it can be made again).
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useWorkspace } from "@/core/items";
import type { Json } from "@/integrations/supabase/types";
import type { CustomField, CustomKind, FieldOption } from "./query";

const COLS = "id, key, name, kind, options, position, item_types";
type Row = { id: string; key: string; name: string; kind: string; options: Json; position: number; item_types: string[] | null };
const toField = (r: Row): CustomField => ({
  ...r, kind: r.kind as CustomKind, options: Array.isArray(r.options) ? (r.options as unknown as FieldOption[]) : [],
});

// "Due for review" → "due_for_review"; the DB wants ^[a-z][a-z0-9_]{0,40}$ and one key per workspace.
export function keyFor(name: string, taken: string[]) {
  const base = (name.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_").replace(/^[^a-z]+/, "") || "field").slice(0, 36);
  let key = base, n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
}

export function useFields() {
  const { data: ws } = useWorkspace();
  const qc = useQueryClient();
  const key = ["fields", ws?.id];
  const failed = (title: string, message: string) => toast({ title, description: message, variant: "destructive" });

  const query = useQuery({
    queryKey: key,
    enabled: !!ws,
    staleTime: 60_000,
    queryFn: async (): Promise<CustomField[]> => {
      const { data, error } = await supabase.from("fields").select(COLS).eq("workspace_id", ws!.id).order("position");
      if (error) throw new Error(error.message);
      return (data as Row[]).map(toField);
    },
  });

  const add = useCallback(async (f: { name: string; kind: CustomKind; options: FieldOption[] }): Promise<CustomField | null> => {
    if (!ws) return null;
    const list = qc.getQueryData<CustomField[]>(key) ?? [];
    const row = {
      workspace_id: ws.id, key: keyFor(f.name, list.map((x) => x.key)), name: f.name.trim(), kind: f.kind,
      options: f.options as unknown as Json, position: Math.max(0, ...list.map((x) => x.position)) + 1,
    };
    const { data, error } = await supabase.from("fields").insert(row).select(COLS).single();
    if (error) { failed("Field not added", error.message); return null; }
    const made = toField(data as Row);
    qc.setQueryData<CustomField[]>(key, (prev) => [...(prev ?? []), made]);
    return made;
  }, [qc, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (id: string, change: { name?: string; options?: FieldOption[] }) => {
    const before = qc.getQueryData<CustomField[]>(key);
    qc.setQueryData<CustomField[]>(key, (prev) => prev?.map((f) => (f.id === id ? { ...f, ...change } : f)));
    const { error } = await supabase.from("fields").update({ ...change, options: change.options as unknown as Json }).eq("id", id);
    if (error) { qc.setQueryData(key, before); failed("Field not saved", error.message); }
  }, [qc, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useCallback(async (id: string) => {
    const before = qc.getQueryData<CustomField[]>(key);
    qc.setQueryData<CustomField[]>(key, (prev) => prev?.filter((f) => f.id !== id));
    const { error } = await supabase.from("fields").delete().eq("id", id);
    if (error) { qc.setQueryData(key, before); failed("Field not deleted", error.message); }
  }, [qc, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  return { fields: query.data ?? [], isLoading: query.isLoading, add, save, remove };
}

export type FieldActions = Pick<ReturnType<typeof useFields>, "add" | "save" | "remove">;
