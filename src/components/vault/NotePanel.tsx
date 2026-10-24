// One note (P-21, P-57): reading view, edit and save back to the file (version-checked), the tasks it is linked to
// (its "- [ ]" lines become their subtasks) and the hover menu. Reloads when a sync changed the file.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Link2, Loader2, Pencil, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useAppState } from "@/context/AppContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fileName, folderOf, isNote, targetsOf, vault, type VaultFile } from "@/lib/vault";
import { NoteMenu, type NoteAction } from "./NoteActions";

// The reader (Markdown + math) loads with the first opened note, not with the list.
const Markdown = lazy(() => import("./Markdown"));

type Note = { id: string | null; text: string; etag: string };
type Saved = { etag?: string | null; conflict?: boolean };

function Icon({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Tasks this note is linked to; linking turns the note's to-dos into the task's subtasks (server side).
function LinkTasks({ noteId }: { noteId: string }) {
  const { user } = useAuth();
  const { tasks } = useAppState();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const key = ["note-links", noteId];
  const links = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("note_task_links").select("task_id").eq("note_id", noteId);
      if (error) throw error;
      return data.map((r) => r.task_id);
    },
  });
  const linked = new Set(links.data ?? []);
  const live = tasks.filter((t) => !t.deletedAt && t.status !== "abandoned");
  const shown = live.filter((t) => !linked.has(t.id) && (!q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 40);

  const link = async (taskId: string) => {
    if (!user) return;
    const { error } = await supabase.from("note_task_links").insert({ note_id: noteId, task_id: taskId, user_id: user.id });
    if (error) return toast({ title: "Not linked", description: error.message, variant: "destructive" });
    await vault("sync_todos", { note_id: noteId }).catch((e: Error) => toast({ title: "To-dos not copied", description: e.message, variant: "destructive" }));
    qc.invalidateQueries({ queryKey: key });
  };
  const unlink = async (taskId: string) => {
    await supabase.from("note_task_links").delete().eq("note_id", noteId).eq("task_id", taskId);
    await supabase.from("subtasks").delete().eq("note_id", noteId).eq("parent_task_id", taskId);
    qc.invalidateQueries({ queryKey: key });
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" className={cn("flex items-center gap-1 rounded-md p-1.5 transition-colors hover:bg-muted/60", linked.size ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
              <Link2 className="h-4 w-4" />
              {linked.size > 0 && <span className="text-xs tabular-nums">{linked.size}</span>}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Linked tasks</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-2">
        {linked.size > 0 && (
          <div className="mb-2 space-y-0.5 border-b border-border pb-2">
            {live.filter((t) => linked.has(t.id)).map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <button type="button" onClick={() => unlink(t.id)} className="rounded p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Task"
          className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <div className="max-h-60 overflow-y-auto">
          {shown.map((t) => (
            <button key={t.id} type="button" onClick={() => link(t.id)} className="block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted/50">
              {t.title}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function NotePanel({ path, file, startEdit, inSheet, resolve, onOpen, onClose, onAction }: {
  path: string;
  file?: VaultFile;
  startEdit?: boolean; // a note just created: straight into editing
  inSheet?: boolean; // in the gallery's side sheet (its close button sits top right)
  resolve: (target: string) => string | null;
  onOpen: (path: string) => void;
  onClose: () => void;
  onAction: (a: NoteAction, f: VaultFile) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const noteKey = ["vault-note", user?.id, path];
  const note = useQuery({ queryKey: noteKey, queryFn: () => vault<Note>("read", { path }), staleTime: 30_000 });
  const [draft, setDraft] = useState<string | null>(startEdit ? "" : null); // null = reading
  const [conflict, setConflict] = useState<{ etag: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  // Changed by a sync while open → read it again (not while editing).
  useEffect(() => {
    if (file && note.data && file.etag !== note.data.etag && draft === null) note.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.etag]);

  const attachments = useMemo(() => {
    if (!note.data) return [];
    const paths = targetsOf(note.data.text).map(resolve).filter((p): p is string => !!p && !isNote(p));
    return [...new Set(paths)].slice(0, 100);
  }, [note.data, resolve]);
  const urls = useQuery({
    queryKey: ["vault-urls", user?.id, attachments],
    queryFn: () => vault<{ urls: Record<string, string> }>("urls", { paths: attachments }).then((r) => r.urls),
    enabled: attachments.length > 0,
    staleTime: 45 * 60_000,
  });

  const save = async (etag: string | null) => {
    if (draft === null) return;
    setSaving(true);
    try {
      const r = await vault<Saved>("write", { path, text: draft, etag });
      if (r.conflict) {
        setConflict({ etag: r.etag ?? null });
        return;
      }
      qc.setQueryData(noteKey, { ...note.data, text: draft, etag: r.etag });
      setDraft(null);
      setConflict(null);
      qc.invalidateQueries({ queryKey: ["vault-index", user?.id] });
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const crumbs = folderOf(path).split("/").filter(Boolean);
  const noteId = file?.id ?? note.data?.id ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex items-center gap-1 border-b border-border px-2 py-1.5", inSheet && "pr-12")}>
        <button type="button" onClick={onClose} className={cn("rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 md:hidden", inSheet && "hidden")}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">{crumbs.join(" › ")}</div>
        {noteId && <LinkTasks noteId={noteId} />}
        {draft === null ? (
          <Icon label="Edit" onClick={() => note.data && setDraft(note.data.text)} disabled={!note.data}><Pencil className="h-4 w-4" /></Icon>
        ) : (
          <>
            <Icon label="Save (Ctrl+S)" onClick={() => save(note.data?.etag ?? null)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Icon>
            <Icon label="Cancel" onClick={() => { setDraft(null); setConflict(null); }}><X className="h-4 w-4" /></Icon>
          </>
        )}
        {file && <div className="group"><NoteMenu file={file} onAction={onAction} className="opacity-100" /></div>}
      </div>
      {conflict && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          <span className="flex-1">Changed elsewhere</span>
          <button type="button" className="font-medium hover:underline" onClick={() => { setDraft(null); setConflict(null); note.refetch(); }}>Reload</button>
          <button type="button" className="font-medium hover:underline" onClick={() => save(conflict.etag)}>Overwrite</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-8 md:py-6">
        <h1 className="mb-2 break-words text-2xl font-bold text-foreground">{fileName(path).replace(/\.md$/i, "")}</h1>
        {!!file?.tags.length && (
          <div className="mb-4 flex flex-wrap gap-1">
            {file.tags.map((t) => <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">#{t}</span>)}
          </div>
        )}
        {draft !== null ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                save(conflict ? conflict.etag : note.data?.etag ?? null);
              }
            }}
            spellCheck={false}
            className="min-h-[60vh] w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        ) : note.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : note.error ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{(note.error as Error).message}</div>
        ) : (
          note.data && (
            <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <Markdown text={note.data.text} resolve={resolve} urls={urls.data ?? {}} onOpen={onOpen} />
            </Suspense>
          )
        )}
      </div>
    </div>
  );
}
