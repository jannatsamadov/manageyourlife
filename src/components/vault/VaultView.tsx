// Notes (P-21, P-57): one notes system — the Markdown files of the vault (Obsidian on the laptop, the app anywhere).
// List: folders at the side, the note on the right. Gallery: folders as the owner's folder cards, notes as cards; the
// note opens at the side. Notes move by drag and drop onto a folder or from the hover menu.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import NoteCard from "@/components/NoteCard";
import { useVault } from "@/hooks/useVault";
import { folderOf, INBOX, isNote, searchText, type Dir, type VaultFile } from "@/lib/vault";
import FolderCard, { NOTE_DRAG } from "./FolderCard";
import NotePanel from "./NotePanel";
import { NoteDialogs, NoteMenu, type NoteAction } from "./NoteActions";

type Mode = "list" | "gallery";
const remember = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function Icon({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const dragNote = (path: string) => (e: React.DragEvent) => {
  e.dataTransfer.setData(NOTE_DRAG, path);
  e.dataTransfer.effectAllowed = "move";
};

function NoteRow({ f, depth, selected, onOpen, onAction, hint }: {
  f: VaultFile; depth: number; selected: boolean; onOpen: (p: string) => void; onAction: (a: NoteAction, f: VaultFile) => void; hint?: string;
}) {
  return (
    <div
      draggable
      onDragStart={dragNote(f.path)}
      onClick={() => onOpen(f.path)}
      className={cn("group flex cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 text-sm", selected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="min-w-0 flex-1 truncate py-0.5">{f.title}</span>
      {hint && <span className="max-w-[40%] truncate text-[11px] opacity-50">{hint}</span>}
      <NoteMenu file={f} onAction={onAction} />
    </div>
  );
}

function DirRows({ dir, depth, open, toggle, selected, onOpen, onAction, onDrop }: {
  dir: Dir; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null;
  onOpen: (p: string) => void; onAction: (a: NoteAction, f: VaultFile) => void; onDrop: (note: string, folder: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
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
              onDragOver={(e) => { if (e.dataTransfer.types.includes(NOTE_DRAG)) { e.preventDefault(); setOver(d.path); } }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { setOver(null); const p = e.dataTransfer.getData(NOTE_DRAG); if (p) onDrop(p, d.path); }}
              className={cn("flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm text-foreground/90 hover:bg-muted/50", over === d.path && "bg-primary/15 ring-1 ring-primary/40")}
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/60">{d.count}</span>
            </button>
            {expanded && <DirRows dir={d} depth={depth + 1} open={open} toggle={toggle} selected={selected} onOpen={onOpen} onAction={onAction} onDrop={onDrop} />}
          </div>
        );
      })}
      {dir.notes.map((f) => <NoteRow key={f.id} f={f} depth={depth} selected={selected === f.path} onOpen={onOpen} onAction={onAction} />)}
    </>
  );
}

function GalleryNote({ f, onOpen, onAction }: { f: VaultFile; onOpen: (p: string) => void; onAction: (a: NoteAction, f: VaultFile) => void }) {
  const total = f.todo_open + f.todo_done;
  return (
    <div draggable onDragStart={dragNote(f.path)} className="group relative">
      <NoteCard title={f.title} content={f.excerpt ?? ""} updatedAt={f.modified_at} todos={total ? { done: f.todo_done, total } : undefined} onClick={() => onOpen(f.path)} />
      <NoteMenu file={f} onAction={onAction} className="absolute right-2 top-2 bg-card/80" />
    </div>
  );
}

export default function VaultView() {
  const v = useVault();
  // ?folder=Inbox (the old /inbox link) opens that folder; ?open=<path> (the Tasks page) opens that note.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [mode, setMode] = useState<Mode>(() => (!params.get("open") && remember.get("notes.view") === "gallery" ? "gallery" : "list"));
  const [selected, setSelected] = useState<string | null>(() => params.get("open") ?? remember.get("vault.open"));
  const [fresh, setFresh] = useState<string | null>(null); // a note just made here opens in edit mode
  const [asked] = useState(() => params.get("folder") ?? (params.get("open") ? folderOf(params.get("open")!) : null));
  const [open, setOpen] = useState<Set<string>>(() => new Set(asked ? asked.split("/").map((_, i, a) => a.slice(0, i + 1).join("/")) : []));
  const [folder, setFolder] = useState(() => asked ?? remember.get("notes.folder") ?? "");
  const [q, setQ] = useState("");
  const [textHits, setTextHits] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ action: NoteAction; file: VaultFile } | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    remember.set("notes.view", m);
    if (m === "gallery") closeNote(); // the gallery opens a note only when one is clicked
  };
  const goFolder = (path: string) => {
    setFolder(path);
    remember.set("notes.folder", path);
  };
  const openNote = (path: string) => {
    setSelected(path);
    remember.set("vault.open", path);
    setOpen((prev) => {
      const next = new Set(prev);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
  };
  const closeNote = () => {
    setSelected(null);
    remember.set("vault.open", null);
  };
  const toggle = (path: string) => {
    goFolder(path);
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  // "Open in edit mode" is for the first opening only.
  useEffect(() => {
    if (fresh && selected === fresh) setFresh(null);
  }, [fresh, selected]);

  // A remembered note or folder that is gone is forgotten.
  useEffect(() => {
    if (!v.index.data) return;
    if (selected && !v.index.data.some((f) => f.path === selected)) closeNote();
    if (folder && !v.tree.dirs.has(folder)) goFolder("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.index.data]);

  // Search: names in the browser, text in the database, #tag in the index.
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
    return v.files
      .filter((f) => isNote(f.path) && (f.path.toLowerCase().includes(s) || textHits?.has(f.path) || (tag && f.tags.some((t) => t.toLowerCase() === tag))))
      .slice(0, 200);
  }, [q, v.files, textHits]);

  const create = async (name: string, where = mode === "gallery" ? folder : selected ? folderOf(selected) : INBOX) => {
    setNaming(null);
    const path = await v.create(where, name);
    if (path) {
      setFresh(path);
      openNote(path);
    }
  };

  const act = (action: NoteAction, file: VaultFile) => setDialog({ action, file });
  const afterMove = (from: string, to: string | null) => {
    if (to && selected === from) openNote(to);
  };
  const dropNote = async (path: string, to: string) => {
    const f = v.files.find((x) => x.path === path);
    if (f && folderOf(path) !== to) afterMove(path, await v.moveTo(f, to));
  };
  const folders = useMemo(() => [...v.tree.dirs.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "az")), [v.tree]);
  const here = v.tree.dirs.get(folder) ?? v.tree.root;
  const selectedFile = v.files.find((f) => f.path === selected);
  const where = mode === "gallery" ? folder : selected ? folderOf(selected) : INBOX;

  const panel = selected && (
    <NotePanel
      key={selected}
      path={selected}
      file={selectedFile}
      startEdit={fresh === selected}
      inSheet={mode === "gallery"}
      resolve={v.resolve}
      onOpen={openNote}
      onClose={closeNote}
      onAction={act}
    />
  );

  return (
    <TooltipProvider delayDuration={300}>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-xl font-bold text-foreground">Notes</h1>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(["list", "gallery"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={cn("px-2.5 py-1 text-xs font-medium capitalize transition-colors", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground")}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[10rem] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <Icon label={`New note in ${where || "Notes"}`} onClick={() => setNaming("")}><Plus className="h-4 w-4" /></Icon>
        <Icon label="Sync" onClick={() => v.scan.mutate()} disabled={v.scan.isPending}>
          <RefreshCw className={cn("h-4 w-4", v.scan.isPending && "animate-spin")} />
        </Icon>
      </div>
      {naming !== null && (
        <input
          autoFocus
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && naming.trim()) create(naming);
            if (e.key === "Escape") setNaming(null);
          }}
          onBlur={() => !naming.trim() && setNaming(null)}
          placeholder={`${where ? `${where} / ` : ""}Name`}
          className="mb-3 w-full max-w-md rounded-md border border-primary/40 bg-background px-3 py-1.5 text-sm focus:outline-none"
        />
      )}

      {v.index.isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : mode === "list" ? (
        <div className="flex h-[calc(100vh-11rem)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
          <div className={cn("flex w-full shrink-0 flex-col border-r border-border md:w-72", selected && "hidden md:flex")}>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {results ? (
                results.length ? (
                  results.map((f) => <NoteRow key={f.id} f={f} depth={0} selected={selected === f.path} onOpen={openNote} onAction={act} hint={folderOf(f.path)} />)
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">—</div>
                )
              ) : (
                <DirRows dir={v.tree.root} depth={0} open={open} toggle={toggle} selected={selected} onOpen={openNote} onAction={act} onDrop={dropNote} />
              )}
            </div>
          </div>
          <div className={cn("flex min-w-0 flex-1 flex-col", !selected && "hidden md:flex")}>
            {panel || (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <FileText className="h-10 w-10 opacity-20" />
                <span className="text-sm tabular-nums">{v.tree.root.count || ""}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
            {["", ...folder.split("/").filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join("/"))].map((p, i, all) => (
              <span key={p || "/"} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
                <button
                  type="button"
                  onClick={() => goFolder(p)}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes(NOTE_DRAG)) e.preventDefault(); }}
                  onDrop={(e) => { const n = e.dataTransfer.getData(NOTE_DRAG); if (n) dropNote(n, p); }}
                  className={cn("rounded-md px-1.5 py-0.5", i === all.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {p ? p.split("/").pop() : "Notes"}
                </button>
              </span>
            ))}
          </div>
          {results ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {results.map((f) => <GalleryNote key={f.id} f={f} onOpen={openNote} onAction={act} />)}
            </div>
          ) : (
            <>
              {here.dirs.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-4">
                  {here.dirs.map((d) => (
                    <FolderCard
                      key={d.path}
                      dir={d}
                      color={v.colors[d.path]}
                      onOpen={goFolder}
                      onNewNote={(p) => { goFolder(p); setNaming(""); }}
                      onColor={v.setColor}
                      onDropNote={dropNote}
                    />
                  ))}
                </div>
              )}
              {here.notes.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {here.notes.map((f) => <GalleryNote key={f.id} f={f} onOpen={openNote} onAction={act} />)}
                </div>
              )}
            </>
          )}
          <Sheet open={!!selected} onOpenChange={(o) => !o && closeNote()}>
            <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-2xl">
              <SheetTitle className="sr-only">{selectedFile?.title ?? "Note"}</SheetTitle>
              {panel}
            </SheetContent>
          </Sheet>
        </>
      )}

      <NoteDialogs
        open={dialog}
        folders={folders}
        onClose={() => setDialog(null)}
        onRename={async (f, name) => afterMove(f.path, await v.rename(f, name))}
        onMove={async (f, to) => afterMove(f.path, await v.moveTo(f, to))}
        onDelete={async (f) => { if ((await v.trash(f.path)) && selected === f.path) closeNote(); }}
      />
    </TooltipProvider>
  );
}
