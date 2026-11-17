import { useEffect, useMemo, useState } from "react";
import { Trash2, Undo2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { queueCalendarSync } from "@/lib/gcal";
import { useItemActions, useItems } from "@/core/items";
import { PRIORITIES } from "@/core/types";
import { vault } from "@/lib/vault";
import { toast } from "@/hooks/use-toast";

interface TrashTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  deleted_at: string;
}

interface TrashNote {
  id: string;
  title: string;
  deleted_at: string;
}

export default function Trash() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<TrashNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  // Items in the trash (v2 items, P-70): the item layer has them, newest first.
  const items = useItems();
  const { update, remove } = useItemActions();
  const tasks = useMemo<TrashTask[]>(() => (items.data ?? [])
    .filter((i) => i.deleted_at)
    .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))
    .map((i) => ({ id: i.id, title: i.title, status: i.status, priority: PRIORITIES.find((p) => p.id === i.priority)?.name ?? null, deleted_at: i.deleted_at! })),
  [items.data]);
  const loading = items.isLoading || notesLoading;

  useEffect(() => {
    if (!user) return;
    (async () => {
      setNotesLoading(true);
      // Notes are files now (P-57): the trashed ones of the vault.
      const noteRes = await supabase.from("vault_files").select("id, title, trashed_at").not("trashed_at", "is", null)
        .order("trashed_at", { ascending: false });
      if (!noteRes.error && noteRes.data) setNotes(noteRes.data.map((n) => ({ id: n.id, title: n.title, deleted_at: n.trashed_at! })));
      setNotesLoading(false);
    })();
  }, [user]);

  const restoreTask = async (id: string) => {
    if (await update(id, { deleted_at: null })) queueCalendarSync(id);
  };

  const restoreNote = async (id: string) => {
    try {
      await vault("restore", { id });
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      toast({ title: "Not restored", description: (e as Error).message, variant: "destructive" });
    }
  };

  const wipeTask = (id: string) => remove([id]);

  const wipeNote = async (id: string) => {
    try {
      await vault("purge", { id });
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      toast({ title: "Not deleted", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const empty = tasks.length === 0 && notes.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-2">
        <Trash2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Trash</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Soft-deleted notes and tasks live here. You can restore them or delete permanently.
      </p>

      {empty && (
        <div className="rounded-lg border border-dashed border-border py-10 px-4 text-center text-sm text-muted-foreground">
          Trash is empty.
        </div>
      )}

      {notes.length > 0 && (
        <section className="glass-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Notes</span>
            <span className="text-xs text-muted-foreground">({notes.length})</span>
          </div>
          <div className="space-y-2">
            {notes.map((n) => (
              <div
                key={n.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{n.title || "Untitled note"}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Deleted at{" "}
                    {new Date(n.deleted_at).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <button
                  onClick={() => restoreNote(n.id)}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40"
                >
                  <Undo2 className="h-3 w-3" />
                  Restore
                </button>
                <button
                  onClick={() => wipeNote(n.id)}
                  className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="glass-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Tasks</span>
            <span className="text-xs text-muted-foreground">({tasks.length})</span>
          </div>
          <div className="space-y-2">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{t.title}</span>
                    <span className="text-[10px] rounded px-1.5 py-0.5 bg-muted text-muted-foreground uppercase tracking-wide">
                      {t.status}
                    </span>
                    {t.priority && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                        {t.priority}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Deleted at{" "}
                    {new Date(t.deleted_at).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <button
                  onClick={() => restoreTask(t.id)}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40"
                >
                  <Undo2 className="h-3 w-3" />
                  Restore
                </button>
                <button
                  onClick={() => wipeTask(t.id)}
                  className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

