import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { Plus, Search, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import NoteCard from "@/components/NoteCard";
import NoteEditorModal from "@/components/NoteEditorModal";

// The vault as files (P-21), loaded only when opened.
const VaultView = lazy(() => import("@/components/vault/VaultView"));
type Mode = "cards" | "files";
const MODE_KEY = "notes.mode";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export default function Notes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [mode, setMode] = useState<Mode>(() => {
    try { return localStorage.getItem(MODE_KEY) === "files" ? "files" : "cards"; } catch { return "cards"; }
  });
  const switchMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* storage blocked */ }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase
        .from("notes" as any)
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null as any)
        .order("updated_at", { ascending: false }) as any);
      if (error) {
        toast({ title: "Failed to load notes", description: error.message, variant: "destructive" });
      } else {
        setNotes((data || []).map((r: any) => ({ id: r.id, title: r.title, content: r.content, updatedAt: r.updated_at })));
      }
      setLoading(false);
    })();
  }, [user]);

  const filteredNotes = useMemo(() => {
    if (!search) return notes;
    const q = search.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }, [notes, search]);

  const createNote = async () => {
    if (!user) return;
    const { data, error } = await (supabase.from("notes" as any).insert({ user_id: user.id, title: "Untitled", content: "", deleted_at: null } as any).select().single() as any);
    if (error) {
      toast({ title: "Failed to create note", description: error.message, variant: "destructive" });
    } else if (data) {
      const note: Note = { id: data.id, title: data.title, content: data.content, updatedAt: data.updated_at };
      setNotes((prev) => [note, ...prev]);
      setEditingNote(note);
    }
  };

  const deleteNote = async (id: string) => {
    const { error } = await (supabase.from("notes" as any).update({ deleted_at: new Date().toISOString() } as any).eq("id", id) as any);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (editingNote?.id === id) setEditingNote(null);
    }
  };

  const handleNoteUpdate = (updated: Note) => {
    setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      {/* Fixed Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border mb-6 pb-4 pt-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">Notes</h1>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(["cards", "files"] as Mode[]).map((m) => (
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
          </div>
          <div className={cn("flex items-center gap-3 flex-1 max-w-md", mode === "files" && "hidden")}>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes..."
                className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              onClick={createNote}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
            >
              <Plus className="h-4 w-4" />
              New Note
            </button>
          </div>
        </div>
      </div>

      {mode === "files" ? (
        <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
          <VaultView />
        </Suspense>
      ) : filteredNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">{search ? "No matching notes" : "No notes yet"}</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Create a note to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              title={note.title}
              content={note.content}
              updatedAt={note.updatedAt}
              onClick={() => setEditingNote(note)}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {editingNote && (
        <NoteEditorModal
          note={editingNote}
          onClose={() => setEditingNote(null)}
          onUpdate={handleNoteUpdate}
          onDelete={deleteNote}
        />
      )}
    </div>
  );
}
