// Note actions (P-57): the hover 3-dot menu and its dialogs — rename, move to a folder (or a new one), delete.
import { useMemo, useState } from "react";
import { FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { folderOf, type VaultFile } from "@/lib/vault";

export type NoteAction = "rename" | "move" | "delete";

export function NoteMenu({ file, onAction, className }: { file: VaultFile; onAction: (a: NoteAction, f: VaultFile) => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Actions"
          onClick={(e) => e.stopPropagation()}
          className={cn("rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100", className)}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onAction("rename", file)}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("move", file)}><FolderInput className="mr-2 h-4 w-4" />Move</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("delete", file)} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One host for the three dialogs; open it with { action, file }.
export function NoteDialogs({ open, folders, onClose, onRename, onMove, onDelete }: {
  open: { action: NoteAction; file: VaultFile } | null;
  folders: string[];
  onClose: () => void;
  onRename: (f: VaultFile, name: string) => void;
  onMove: (f: VaultFile, folder: string) => void;
  onDelete: (f: VaultFile) => void;
}) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const file = open?.file;
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return folders.filter((p) => !q || p.toLowerCase().includes(q)).slice(0, 80);
  }, [folders, filter]);
  const typed = filter.trim().replace(/^\/+|\/+$/g, "");
  const isNew = typed && !folders.some((p) => p.toLowerCase() === typed.toLowerCase());
  const close = () => {
    setName("");
    setFilter("");
    onClose();
  };

  return (
    <>
      <Dialog open={open?.action === "rename"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader>
          <input
            autoFocus
            defaultValue={file?.title}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && file) {
                onRename(file, name || file.title);
                close();
              }
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={open?.action === "move"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Move “{file?.title}”</DialogTitle></DialogHeader>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Folder"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {isNew && (
              <button type="button" onClick={() => { if (file) onMove(file, typed); close(); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-muted/50">
                <FolderPlus className="h-4 w-4 shrink-0" />
                <span className="truncate">{typed}</span>
              </button>
            )}
            {["", ...shown.filter(Boolean)].map((p) => (
              <button
                key={p || "/"}
                type="button"
                disabled={!!file && folderOf(file.path) === p}
                onClick={() => { if (file) onMove(file, p); close(); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 disabled:opacity-40"
              >
                <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{p || "Notes"}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={open?.action === "delete"} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Move “{file?.title}” to trash?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (file) onDelete(file); close(); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
