// Saved views (P-69): rows of the `views` table per page — layout + config (filter, sort, group by, fields). Kept in
// the DB, not the browser, so they are the same on every device; a page's default views are written on its first
// open. Shared with the workspace (owner_id null), like GitHub Projects' views.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useWorkspace } from "@/core/items";
import type { Json } from "@/integrations/supabase/types";
import type { Layout, ViewConfig } from "./query";

export type View = { id: string; name: string; layout: Layout; config: ViewConfig; position: number };
export type ViewSeed = { name: string; layout: Layout; config: ViewConfig };

export const normalizeConfig = (c: Partial<ViewConfig> | null | undefined): ViewConfig => ({
  filter: "", group_by: null, sort: [], fields: ["title"], ...(c ?? {}),
});

type Row = { id: string; name: string; layout: string; config: Json; position: number };
const toView = (r: Row): View => ({ ...r, layout: r.layout as Layout, config: normalizeConfig(r.config as Partial<ViewConfig>) });
const COLS = "id, name, layout, config, position";

export function useViews(page: string, seeds: ViewSeed[]) {
  const { data: ws } = useWorkspace();
  const qc = useQueryClient();
  const key = ["views", ws?.id, page];

  const query = useQuery({
    queryKey: key,
    enabled: !!ws,
    staleTime: Infinity,
    queryFn: async (): Promise<View[]> => {
      const { data, error } = await supabase.from("views").select(COLS).eq("workspace_id", ws!.id).eq("page", page).order("position");
      if (error) throw new Error(error.message);
      if (data.length) return data.map(toView);
      const { data: made, error: e2 } = await supabase.from("views")
        .insert(seeds.map((s, k) => ({ workspace_id: ws!.id, page, name: s.name, layout: s.layout, config: s.config as unknown as Json, position: k })))
        .select(COLS).order("position");
      if (e2) throw new Error(e2.message);
      return made.map(toView);
    },
  });

  const set = (fn: (prev: View[]) => View[]) => qc.setQueryData<View[]>(key, (prev) => fn(prev ?? []));
  const failed = (title: string, message: string) => toast({ title, description: message, variant: "destructive" });

  const save = useCallback(async (id: string, change: Partial<Omit<View, "id">>) => {
    const before = qc.getQueryData<View[]>(key);
    set((prev) => prev.map((v) => (v.id === id ? { ...v, ...change } : v)));
    const { error } = await supabase.from("views").update({ ...change, config: change.config as unknown as Json }).eq("id", id);
    if (error) {
      qc.setQueryData(key, before);
      failed("View not saved", error.message);
    }
  }, [qc, ws, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback(async (seed: ViewSeed): Promise<View | null> => {
    if (!ws) return null;
    const views = qc.getQueryData<View[]>(key) ?? [];
    const position = Math.max(-1, ...views.map((v) => v.position)) + 1;
    const { data, error } = await supabase.from("views")
      .insert({ workspace_id: ws.id, page, name: seed.name, layout: seed.layout, config: seed.config as unknown as Json, position })
      .select(COLS).single();
    if (error) {
      failed("View not added", error.message);
      return null;
    }
    const view = toView(data);
    set((prev) => [...prev, view]);
    return view;
  }, [qc, ws, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useCallback(async (id: string) => {
    const before = qc.getQueryData<View[]>(key);
    set((prev) => prev.filter((v) => v.id !== id));
    const { error } = await supabase.from("views").delete().eq("id", id);
    if (error) {
      qc.setQueryData(key, before);
      failed("View not deleted", error.message);
    }
  }, [qc, ws, page]); // eslint-disable-line react-hooks/exhaustive-deps

  return { views: query.data, isLoading: query.isLoading, error: query.error, save, add, remove };
}
