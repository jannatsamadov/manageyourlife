// Notes as files (P-21): the vault in the app — folder tree, reading view, edit and save back to the file. The laptop
// gets every change at its next sync (rclone, every 10 minutes); a clash keeps both versions.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fileName, folderOf, isNote, loadIndex, resolver, searchText, targetsOf, vault, type VaultFile } from "@/lib/vault";
import Markdown from "./Markdown";

type Dir = { name: string; path: string; dirs: Dir[]; notes: VaultFile[]; count: number };
type Note = { text: string; etag: string };
type Saved = { etag?: string | null; conflict?: boolean };

const OPEN_KEY = "vault.open";
const remembered = () => {
  try { return localStorage.getItem(OPEN_KEY); } catch { return null; }
};

function buildTree(files: VaultFile[]) {
  const root: Dir = { name: "", path: "", dirs: [], notes: [], count: 0 };
  const dirs = new Map([["", root]]);
  const dirOf = (path: string): Dir => {
    let d = dirs.get(path);
    if (!d) {
      d = { name: fileName(path), path, dirs: [], notes: [], count: 0 };
      dirOf(folderOf(path)).dirs.push(d);
      dirs.set(path, d);
    }
    return d;
  };
  for (const f of files) if (isNote(f.path)) dirOf(folderOf(f.path)).notes.push(f);
  const sort = (d: Dir): number => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name, "az"));
    d.notes.sort((a, b) => a.title.localeCompare(b.title, "az"));
    return (d.count = d.notes.length + d.dirs.reduce((s, c) => s + sort(c), 0));
  };
  sort(root);
  return root;
}

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

function NoteRow({ f, depth, selected, onOpen, hint }: { f: VaultFile; depth: number; selected: boolean; onOpen: (p: string) => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(f.path)}
      className={cn("flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm", selected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="min-w-0 flex-1 truncate">{f.title}</span>
      {hint && <span className="max-w-[45%] truncate text-[11px] opacity-50">{hint}</span>}
    </button>
  );
}

function DirView({ dir, depth, open, toggle, selected, onOpen }: {
  dir: Dir; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null; onOpen: (p: string) => void;
}) {
  return (
    <>
      {dir.dirs.map((d) => {
        const expanded = open.has(d.path);
        const Chevron = expanded ? ChevronDown : ChevronRight;
        return (
          <div key={d.path}>
            <button
              type="button"
              onClick={() => toggle(d.path)}
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm text-foreground/90 hover:bg-muted/50"
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/60">{d.count}</span>
            </button>
            {expanded && <DirView dir={d} depth={depth + 1} open={open} toggle={toggle} selected={selected} onOpen={onOpen} />}
          </div>
        );
      })}
      {dir.notes.map((f) => <NoteRow key={f.path} f={f} depth={depth} selected={selected === f.path} onOpen={onOpen} />)}
    </>
  );
}

export default function VaultView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const indexKey = ["vault-index", user?.id];
  const index = useQuery({ queryKey: indexKey, queryFn: loadIndex, enabled: !!user, staleTime: 60_000 });
  const files = useMemo(() => index.data ?? [], [index.data]);
  const resolve = useMemo(() => resolver(files), [files]);
  const tree = useMemo(() => buildTree(files), [files]);

  // Index ← files in R2 (picks up what the laptop synced since last time).
  const scan = useMutation({
    mutationFn: () => vault<{ updated: number; removed: number }>("scan"),
    onSuccess: (r) => {
      if (r.updated || r.removed) qc.invalidateQueries({ queryKey: indexKey });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  useEffect(() => {
    if (user) scan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(remembered);
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [textHits, setTextHits] = useState<Set<string> | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // null = reading
  const [conflict, setConflict] = useState<{ etag: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);

  const toggle = (path: string) => {
    setFolder(path);
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  const openNote = (path: string) => {
    setSelected(path);
    setFolder(folderOf(path));
    setDraft(null);
    setConflict(null);
    try { localStorage.setItem(OPEN_KEY, path); } catch { /* storage blocked */ }
    setOpen((prev) => {
      const next = new Set(prev);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
  };

  // A remembered note that no longer exists is forgotten.
  useEffect(() => {
    if (selected && index.data && !index.data.some((f) => f.path === selected)) setSelected(null);
  }, [index.data, selected]);

  // Search: names in the browser, text in the database.
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) {
      setTextHits(null);
      return;
    }
    const t = setTimeout(() => searchText(s).then(setTextHits).catch(() => setTextHits(null)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    const tag = s.startsWith("#") ? s.slice(1) : null;
    return files
      .filter((f) => isNote(f.path) && (f.path.toLowerCase().includes(s) || textHits?.has(f.path) || (tag && f.tags.some((t) => t.toLowerCase() === tag))))
      .slice(0, 200);
  }, [q, files, textHits]);

  const noteKey = ["vault-note", user?.id, selected];
  const note = useQuery({
    queryKey: noteKey,
    queryFn: () => vault<Note>("read", { path: selected }),
    enabled: !!selected,
    staleTime: 30_000,
  });
  const indexed = files.find((f) => f.path === selected);
  // Changed by a sync while open → read it again (not while editing).
  useEffect(() => {
    if (indexed && note.data && indexed.etag !== note.data.etag && draft === null) note.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexed?.etag]);

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
    if (draft === null || !selected) return;
    setSaving(true);
    try {
      const r = await vault<Saved>("write", { path: selected, text: draft, etag });
      if (r.conflict) {
        setConflict({ etag: r.etag ?? null });
        return;
      }
      qc.setQueryData(noteKey, { text: draft, etag: r.etag });
      setDraft(null);
      setConflict(null);
      qc.invalidateQueries({ queryKey: indexKey });
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const create = async (name: string) => {
    const clean = name.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\.md$/i, "");
    if (!clean) return setNaming(null);
    const path = `${folder ? `${folder}/` : ""}${clean}.md`;
    try {
      const r = await vault<Saved>("write", { path, text: "", etag: null });
      if (r.conflict) return toast({ title: "Already exists" });
      setNaming(null);
      qc.setQueryData(["vault-note", user?.id, path], { text: "", etag: r.etag });
      await qc.invalidateQueries({ queryKey: indexKey });
      openNote(path);
      setDraft("");
    } catch (e) {
      toast({ title: "Not created", description: (e as Error).message, variant: "destructive" });
    }
  };

  const trash = async () => {
    if (!selected) return;
    try {
      await vault("trash", { path: selected });
      setSelected(null);
      qc.invalidateQueries({ queryKey: indexKey });
      toast({ title: "Moved to trash" });
    } catch (e) {
      toast({ title: "Not deleted", description: (e as Error).message, variant: "destructive" });
    }
  };

  const noteCount = useMemo(() => files.filter((f) => isNote(f.path)).length, [files]);
  const crumbs = selected ? folderOf(selected).split("/").filter(Boolean) : [];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-[calc(100vh-11rem)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
        {/* Tree */}
        <div className={cn("flex w-full shrink-0 flex-col border-r border-border md:w-72", selected && "hidden md:flex")}>
          <div className="flex items-center gap-1 border-b border-border p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <Icon label={folder ? `New note in ${folder}` : "New note"} onClick={() => setNaming("")}><Plus className="h-4 w-4" /></Icon>
            <Icon label="Sync" onClick={() => scan.mutate()} disabled={scan.isPending}>
              <RefreshCw className={cn("h-4 w-4", scan.isPending && "animate-spin")} />
            </Icon>
          </div>
          {naming !== null && (
            <input
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create(naming);
                if (e.key === "Escape") setNaming(null);
              }}
              onBlur={() => !naming.trim() && setNaming(null)}
              placeholder={folder ? `${folder} / Name` : "Name"}
              className="mx-2 mt-2 rounded-md border border-primary/40 bg-background px-2 py-1.5 text-sm focus:outline-none"
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {index.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : results ? (
              results.length ? (
                results.map((f) => <NoteRow key={f.path} f={f} depth={0} selected={selected === f.path} onOpen={openNote} hint={folderOf(f.path)} />)
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">—</div>
              )
            ) : (
              <DirView dir={tree} depth={0} open={open} toggle={toggle} selected={selected} onOpen={openNote} />
            )}
          </div>
        </div>

        {/* Note */}
        <div className={cn("flex min-w-0 flex-1 flex-col", !selected && "hidden md:flex")}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileText className="h-10 w-10 opacity-20" />
              <span className="text-sm tabular-nums">{noteCount || ""}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                <button type="button" onClick={() => setSelected(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 md:hidden">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">{crumbs.join(" › ")}</div>
                {draft === null ? (
                  <>
                    <Icon label="Edit" onClick={() => note.data && setDraft(note.data.text)} disabled={!note.data}><Pencil className="h-4 w-4" /></Icon>
                    <Icon label="Delete" onClick={() => setConfirmTrash(true)}><Trash2 className="h-4 w-4" /></Icon>
                  </>
                ) : (
                  <>
                    <Icon label="Save (Ctrl+S)" onClick={() => save(note.data?.etag ?? null)} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Icon>
                    <Icon label="Cancel" onClick={() => { setDraft(null); setConflict(null); }}><X className="h-4 w-4" /></Icon>
                  </>
                )}
              </div>
              {conflict && (
                <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <span className="flex-1">Changed elsewhere</span>
                  <button type="button" className="font-medium hover:underline" onClick={() => { setDraft(null); setConflict(null); note.refetch(); }}>Reload</button>
                  <button type="button" className="font-medium hover:underline" onClick={() => save(conflict.etag)}>Overwrite</button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-8 md:py-6">
                <h1 className="mb-2 break-words text-2xl font-bold text-foreground">{fileName(selected).replace(/\.md$/i, "")}</h1>
                {!!indexed?.tags.length && (
                  <div className="mb-4 flex flex-wrap gap-1">
                    {indexed.tags.map((t) => (
                      <button key={t} type="button" onClick={() => setQ(`#${t}`)} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20">#{t}</button>
                    ))}
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
                  note.data && <Markdown text={note.data.text} resolve={resolve} urls={urls.data ?? {}} onOpen={openNote} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirmTrash} onOpenChange={setConfirmTrash}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{selected ? fileName(selected) : ""}” to trash?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={trash}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
