import { useEffect, useState } from "react";
import { Trash2, Undo2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { queueCalendarSync } from "@/lib/gcal";

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
  const [tasks, setTasks] = useState<TrashTask[]>([]);
  const [notes, setNotes] = useState<TrashNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [taskRes, noteRes] = await Promise.all([
        supabase
          .from("tasks" as any)
          .select("id,title,status,priority,deleted_at" as any)
          .eq("user_id", user.id)
          .not("deleted_at", "is", null as any)
          .order("deleted_at", { ascending: false }) as any,
        supabase
          .from("notes" as any)
          .select("id,title,deleted_at" as any)
          .eq("user_id", user.id)
          .not("deleted_at", "is", null as any)
          .order("deleted_at", { ascending: false }) as any,
      ]);

      if (!taskRes.error && taskRes.data) setTasks(taskRes.data as TrashTask[]);
      if (!noteRes.error && noteRes.data) setNotes(noteRes.data as TrashNote[]);
      setLoading(false);
    })();
  }, [user]);

  const restoreTask = async (id: string) => {
    const { error } = await (supabase
      .from("tasks" as any)
      .update({ deleted_at: null } as any)
      .eq("id", id) as any);
    if (!error) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      queueCalendarSync(id);
    }
  };

  const restoreNote = async (id: string) => {
    const { error } = await (supabase
      .from("notes" as any)
      .update({ deleted_at: null } as any)
      .eq("id", id) as any);
    if (!error) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
    }
  };

  const wipeTask = async (id: string) => {
    const { error } = await (supabase.from("tasks" as any).delete().eq("id", id) as any);
    if (!error) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const wipeNote = async (id: string) => {
    const { error } = await (supabase.from("notes" as any).delete().eq("id", id) as any);
    if (!error) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
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

