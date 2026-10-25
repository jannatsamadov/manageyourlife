// Tasks (P-53, owner 2026-10-25): the task store — every to-do written in the files (Obsidian notes, the Projects and
// Documents folders), grouped by project. A tick writes "- [x]" into the file; rows of task tables (TASKS.md) are
// read-only. A folder or file full of other people's to-dos (downloaded repos, course material) can be hidden.
// Ordering by priority comes later (P-58).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CheckCheck, ChevronDown, ChevronRight, Eye, EyeOff, FileText, Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useAppState } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { folderOf, scanAll, vault } from "@/lib/vault";
import { isHidden, itemsOf, loadTodoFiles, projectName, projectOf, type Item, type Todo, type TodoFile } from "@/lib/todos";

type FileGroup = { file: TodoFile; items: Item[] };
type Group = { project: string; files: FileGroup[]; open: number; modified: string };

const remember = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function Icon({ label, onClick, disabled, className, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          disabled={disabled}
          className={cn("rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50", className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// The same line ticked in the cached text, so the page answers before the file is written.
const tick = (body: string, line: number, done: boolean) =>
  body.split("\n").map((l, i) => (i === line ? l.replace(/^([ \t]*[-*+] )\[( |x|X)\]/, `$1[${done ? "x" : " "}]`) : l)).join("\n");

export default function Tasks() {
  const { user } = useAuth();
  const { addTask } = useAppState();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = useMemo(() => ["todo-files", user?.id], [user?.id]);
  const hiddenKey = useMemo(() => ["todos-hidden", user?.id], [user?.id]);

  const files = useQuery({ queryKey: key, queryFn: loadTodoFiles, enabled: !!user, staleTime: 60_000 });
  const hiddenQ = useQuery({
    queryKey: hiddenKey,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("vault_folders").select("path").eq("todos_hidden", true);
      if (error) throw error;
      return new Set(data.map((r) => r.path));
    },
  });
  const hidden = useMemo(() => hiddenQ.data ?? new Set<string>(), [hiddenQ.data]);

  // What the laptop synced since last time.
  const scan = useMutation({
    mutationFn: scanAll,
    onSuccess: (r) => {
      if (r.added || r.updated || r.moved || r.removed) qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  useEffect(() => {
    if (user) scan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(remember.get("tasks.open") ?? "[]")); } catch { return new Set(); }
  });
  const toggle = (project: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(project)) next.add(project);
      remember.set("tasks.open", JSON.stringify([...next]));
      return next;
    });

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const f of files.data ?? []) {
      if (!f.body || isHidden(f.path, hidden)) continue;
      const items = itemsOf(f, f.body).filter((it) => (showDone || !it.done) && (!s || it.text.toLowerCase().includes(s) || f.path.toLowerCase().includes(s)));
      if (!items.length) continue;
      const project = projectOf(f.path);
      const g = map.get(project) ?? { project, files: [], open: 0, modified: "" };
      g.files.push({ file: f, items });
      g.open += items.filter((it) => !it.done).length;
      if (f.modified_at > g.modified) g.modified = f.modified_at;
      map.set(project, g);
    }
    // The projects worked on lately first; inside, the files the same way.
    const list = [...map.values()].sort((a, b) => b.modified.localeCompare(a.modified));
    list.forEach((g) => g.files.sort((a, b) => b.file.modified_at.localeCompare(a.file.modified_at)));
    return list;
  }, [files.data, hidden, q, showDone]);
  const total = groups.reduce((n, g) => n + g.open, 0);

  const setDone = async (t: Todo, done: boolean) => {
    qc.setQueryData<Awaited<ReturnType<typeof loadTodoFiles>>>(key, (old) =>
      old?.map((f) => (f.id === t.file.id && f.body ? { ...f, body: tick(f.body, t.line, done) } : f)));
    try {
      await vault("set_todo", { path: t.file.path, line: t.line, text: t.raw, done });
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    }
    qc.invalidateQueries({ queryKey: key });
  };

  const hide = async (path: string, on: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("vault_folders").upsert({ user_id: user.id, path, todos_hidden: on, updated_at: new Date().toISOString() });
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: hiddenKey });
  };

  // A to-do the user wants to plan → a task in Schedule's Unscheduled list, linked to its note.
  const toSchedule = async (t: Todo) => {
    const saved = await addTask({ title: t.text, description: "", estimatedTime: null, status: "idle", startTime: null, endTime: null, date: "", deadline: "", position: 0, link: "", priority: "medium" });
    if (!saved) return;
    await supabase.from("tasks").update({ linked_note_id: t.file.id }).eq("id", saved.id);
    toast({ title: "Added to Schedule" });
  };

  const openFile = (path: string) => navigate(`/notes?open=${encodeURIComponent(path)}`);

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-xl font-bold text-foreground">Tasks</h1>
        {!files.isLoading && <span className="text-sm tabular-nums text-muted-foreground">{total}</span>}
        <div className="relative ml-auto min-w-[10rem] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <Icon label={showDone ? "Hide done" : "Show done"} onClick={() => setShowDone((v) => !v)} className={cn("p-2", showDone && "bg-primary/10 text-primary")}>
          <CheckCheck className="h-4 w-4" />
        </Icon>
        <Icon label="Sync" onClick={() => scan.mutate()} disabled={scan.isPending} className="p-2">
          <RefreshCw className={cn("h-4 w-4", scan.isPending && "animate-spin")} />
        </Icon>
      </div>

      {files.isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const expanded = open.has(g.project) || !!q.trim();
            const Chevron = expanded ? ChevronDown : ChevronRight;
            const parent = folderOf(g.project);
            return (
              <div key={g.project} className="rounded-xl border border-border bg-card">
                <div role="button" tabIndex={0} onClick={() => toggle(g.project)} onKeyDown={(e) => e.key === "Enter" && toggle(g.project)}
                  className="group flex cursor-pointer items-center gap-2 px-3 py-2">
                  <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{projectName(g.project)}</span>
                  {parent && <span className="truncate text-xs text-muted-foreground/60">{parent}</span>}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{g.open}</span>
                  {g.project && (
                    <Icon label="Hide" onClick={() => hide(g.project, true)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <EyeOff className="h-3.5 w-3.5" />
                    </Icon>
                  )}
                </div>
                {expanded && (
                  <div className="space-y-3 border-t border-border px-3 py-2">
                    {g.files.map(({ file, items }) => {
                      const sub = folderOf(file.path).slice(g.project.length).replace(/^\//, "");
                      return (
                        <div key={file.id}>
                          <div className="group flex items-center gap-1.5 text-xs text-muted-foreground">
                            <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            <button type="button" onClick={() => openFile(file.path)} className="min-w-0 truncate font-medium hover:text-foreground hover:underline">
                              {file.title}
                            </button>
                            {sub && <span className="truncate opacity-60">{sub}</span>}
                            <Icon label="Hide" onClick={() => hide(file.path, true)} className="ml-auto p-1 opacity-0 group-hover:opacity-100 focus:opacity-100">
                              <EyeOff className="h-3 w-3" />
                            </Icon>
                          </div>
                          <ul className="mt-1">
                            {items.map((it) =>
                              it.kind === "todo" ? (
                                <li key={`${it.line}`} className="group flex items-start gap-2 rounded-md py-0.5 pr-1 hover:bg-muted/40" style={{ paddingLeft: 4 + it.depth * 16 }}>
                                  <Checkbox checked={it.done} onCheckedChange={(v) => setDone(it, v === true)} className="mt-0.5" />
                                  <span className={cn("min-w-0 flex-1 text-sm", it.done ? "text-muted-foreground line-through" : "text-foreground")}>{it.text}</span>
                                  {!it.done && (
                                    <Icon label="To Schedule" onClick={() => toSchedule(it)} className="p-1 opacity-0 group-hover:opacity-100 focus:opacity-100">
                                      <CalendarPlus className="h-3.5 w-3.5" />
                                    </Icon>
                                  )}
                                </li>
                              ) : (
                                <li key={`${it.line}`} onClick={() => openFile(file.path)} className="flex cursor-pointer items-start gap-2 rounded-md py-0.5 pl-1 pr-1 hover:bg-muted/40">
                                  <span className={cn("mt-0.5 shrink-0 rounded border px-1 text-[10px] font-medium uppercase", it.done ? "border-border text-muted-foreground" : "border-primary/40 text-primary")}>
                                    {it.status || "—"}
                                  </span>
                                  {it.ref && <span className="mt-px shrink-0 text-xs tabular-nums text-muted-foreground/70">{it.ref}</span>}
                                  <span className={cn("line-clamp-2 min-w-0 flex-1 text-sm", it.done ? "text-muted-foreground" : "text-foreground")}>{it.text}</span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {!groups.length && <div className="py-16 text-center text-sm text-muted-foreground">—</div>}

          {hidden.size > 0 && (
            <div className="pt-4">
              <button type="button" onClick={() => setShowHidden((v) => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                {showHidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Hidden <span className="tabular-nums">{hidden.size}</span>
              </button>
              {showHidden && (
                <ul className="mt-1 space-y-0.5">
                  {[...hidden].sort((a, b) => a.localeCompare(b, "az")).map((p) => (
                    <li key={p} className="group flex items-center gap-2 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/40">
                      <span className="min-w-0 flex-1 truncate">{p}</span>
                      <Icon label="Show" onClick={() => hide(p, false)} className="p-1">
                        <Eye className="h-3 w-3" />
                      </Icon>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
