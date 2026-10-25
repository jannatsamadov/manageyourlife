// The vault index (P-57) and the changes the Notes views make: shared by the list, the gallery and the note panel.
import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { buildTree, fileName, folderOf, joinPath, loadIndex, resolver, safeName, scanAll, vault, type VaultFile } from "@/lib/vault";

type Saved = { id?: string; path?: string; etag?: string | null; conflict?: boolean };

export function useVault() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const indexKey = useMemo(() => ["vault-index", user?.id], [user?.id]);
  const index = useQuery({ queryKey: indexKey, queryFn: loadIndex, enabled: !!user, staleTime: 60_000 });
  const files = useMemo(() => index.data ?? [], [index.data]);
  const tree = useMemo(() => buildTree(files), [files]);
  const resolve = useMemo(() => resolver(files), [files]);
  const refresh = () => qc.invalidateQueries({ queryKey: indexKey });

  const colors = useQuery({
    queryKey: ["vault-folders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("vault_folders").select("path, color");
      if (error) throw error;
      return Object.fromEntries(data.filter((r) => r.color).map((r) => [r.path, r.color!]));
    },
  });

  // Index ← files in R2 (picks up what the laptop synced since last time).
  const scan = useMutation({
    mutationFn: scanAll,
    onSuccess: (r) => {
      if (r.added || r.updated || r.moved || r.removed) refresh();
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  useEffect(() => {
    if (user) scan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const fail = (title: string) => (e: unknown) => {
    toast({ title, description: (e as Error).message, variant: "destructive" });
    return null;
  };

  // A new note "name" (may contain "Folder/") in `folder`; " 2", " 3"… if the name is taken.
  const create = async (folder: string, name: string, text = "") => {
    const parts = name.split("/").map(safeName).filter(Boolean);
    const base = parts.pop() || "Untitled";
    const dir = [folder, ...parts].filter(Boolean).join("/");
    for (let n = 1; n < 20; n++) {
      const path = joinPath(dir, `${base}${n > 1 ? ` ${n}` : ""}.md`);
      const r = await vault<Saved>("write", { path, text, etag: null }).catch(fail("Not created"));
      if (!r) return null;
      if (!r.conflict) {
        qc.setQueryData(["vault-note", user?.id, path], { id: r.id, text, etag: r.etag });
        await refresh();
        return path;
      }
    }
    return null;
  };

  const move = async (from: string, to: string) => {
    if (from === to) return from;
    const r = await vault<Saved>("move", { from, to }).catch(fail("Not moved"));
    if (!r) return null;
    await refresh();
    toast({ title: "Moved", description: folderOf(to) || "Notes" });
    return r.path ?? to;
  };
  const moveTo = (f: VaultFile, folder: string) => move(f.path, joinPath(folder, fileName(f.path)));
  const rename = (f: VaultFile, name: string) => move(f.path, joinPath(folderOf(f.path), `${safeName(name) || f.title}.md`));

  const trash = async (path: string) => {
    const r = await vault("trash", { path }).catch(fail("Not deleted"));
    if (!r) return false;
    await refresh();
    toast({ title: "Moved to trash" });
    return true;
  };

  const setColor = async (path: string, color: string | null) => {
    if (!user) return;
    const { error } = await supabase.from("vault_folders").upsert({ user_id: user.id, path, color, updated_at: new Date().toISOString() });
    if (error) return fail("Not saved")(error);
    qc.invalidateQueries({ queryKey: ["vault-folders", user.id] });
  };

  return { user, files, tree, resolve, index, scan, colors: colors.data ?? {}, create, move, moveTo, rename, trash, setColor, refresh };
}
