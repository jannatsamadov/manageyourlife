import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Plus, Trash2, FileText, Search, Save, Loader2, Bold, Italic, List, ListOrdered, CheckSquare, Hash, Code, Link2, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold mt-4 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-4 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>');

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">$1</code>');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>');

  html = html.replace(/^- \[x\] (.+)$/gm, '<div class="flex items-center gap-2 my-0.5"><input type="checkbox" checked disabled class="accent-primary" /><span class="line-through text-muted-foreground">$1</span></div>');
  html = html.replace(/^- \[ \] (.+)$/gm, '<div class="flex items-center gap-2 my-0.5"><input type="checkbox" disabled class="accent-primary" /><span>$1</span></div>');

  html = html.replace(/^(\d+)\. (.+)$/gm, '<div class="ml-4 my-0.5"><span class="text-muted-foreground mr-2">$1.</span>$2</div>');
  html = html.replace(/^- (.+)$/gm, '<div class="ml-4 my-0.5"><span class="text-muted-foreground mr-2">•</span>$1</div>');

  html = html.replace(/^---$/gm, '<hr class="my-3 border-border" />');

  html = html.replace(/\$(.+?)\$/g, '<span class="font-mono text-primary bg-primary/5 px-1 rounded">$1</span>');

  html = html.replace(/\n/g, "<br />");

  return html;
}

export default function Notes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
    const { data, error } = await (supabase
        .from("notes" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }) as any);
      if (error) {
        toast({ title: "Failed to load notes", description: error.message, variant: "destructive" });
      } else {
        setNotes((data || []).map((r: any) => ({ id: r.id, title: r.title, content: r.content, updatedAt: r.updated_at })));
      }
      setLoading(false);
    })();
  }, [user]);

  const activeNote = useMemo(() => notes.find((n) => n.id === activeId), [notes, activeId]);

  useEffect(() => {
    if (activeNote) {
      setTitle(activeNote.title);
      setContent(activeNote.content);
    }
  }, [activeId]);

  const saveNote = useCallback(async (id: string, t: string, c: string) => {
    setSaving(true);
    const { error } = await (supabase.from("notes" as any).update({ title: t, content: c, updated_at: new Date().toISOString() } as any).eq("id", id) as any);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      setNotes((prev) => prev.map((n) => n.id === id ? { ...n, title: t, content: c, updatedAt: new Date().toISOString() } : n));
    }
    setSaving(false);
  }, []);

  const debouncedSave = useCallback((id: string, t: string, c: string) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(id, t, c), 800);
  }, [saveNote]);

  const handleContentChange = (val: string) => {
    setContent(val);
    if (activeId) debouncedSave(activeId, title, val);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (activeId) debouncedSave(activeId, val, content);
  };

  const createNote = async () => {
    if (!user) return;
    const { data, error } = await (supabase.from("notes" as any).insert({ user_id: user.id, title: "Untitled", content: "" } as any).select().single() as any);
    if (error) {
      toast({ title: "Failed to create note", description: error.message, variant: "destructive" });
    } else if (data) {
      const note: Note = { id: data.id, title: data.title, content: data.content, updatedAt: data.updated_at };
      setNotes((prev) => [note, ...prev]);
      setActiveId(note.id);
      setTitle(note.title);
      setContent(note.content);
      setPreview(false);
    }
  };

  const deleteNote = async (id: string) => {
    const { error } = await (supabase.from("notes" as any).delete().eq("id", id) as any);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setTitle("");
        setContent("");
      }
    }
  };

  const insertMarkdown = (prefix: string, suffix = "") => {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const newText = content.slice(0, start) + prefix + selected + suffix + content.slice(end);
    setContent(newText);
    if (activeId) debouncedSave(activeId, title, newText);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const filteredNotes = useMemo(() => {
    if (!search) return notes;
    const q = search.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }, [notes, search]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
      <div className="flex h-[calc(100vh-8rem)] rounded-xl border border-border overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 shrink-0 border-r border-border bg-sidebar flex flex-col">
          <div className="p-3 border-b border-border space-y-2">
            <button onClick={createNote} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" /> New Note
            </button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto chat-scroll">
            {filteredNotes.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {search ? "No matching notes" : "No notes yet"}
              </div>
            )}
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                onClick={() => { setActiveId(note.id); setPreview(false); }}
                className={cn(
                  "group flex items-start gap-2 border-b border-border px-3 py-2.5 cursor-pointer transition-colors",
                  activeId === note.id ? "bg-primary/5" : "hover:bg-muted/50"
                )}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{note.title || "Untitled"}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(note.updatedAt)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                  className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Editor */}
        {activeId ? (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Note title"
                className="flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center gap-1">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                {!saving && <Save className="h-3.5 w-3.5 text-primary" />}
                <span className="text-[10px] text-muted-foreground">{saving ? "Saving..." : "Saved"}</span>
              </div>
              <div className="flex rounded-md border border-border overflow-hidden ml-2">
                <button onClick={() => setPreview(false)} className={cn("px-2.5 py-1 text-xs", !preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  Edit
                </button>
                <button onClick={() => setPreview(true)} className={cn("px-2.5 py-1 text-xs", preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  Preview
                </button>
              </div>
            </div>

            {!preview && (
              <div className="flex items-center gap-0.5 border-b border-border px-4 py-1.5 flex-wrap">
                <button onClick={() => insertMarkdown("**", "**")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Bold">
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("*", "*")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Italic">
                  <Italic className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("`", "`")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Code">
                  <Code className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button onClick={() => insertMarkdown("# ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Heading">
                  <Hash className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("- ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Bullet list">
                  <List className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("1. ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Numbered list">
                  <ListOrdered className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("- [ ] ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Todo">
                  <CheckSquare className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button onClick={() => insertMarkdown("[", "](url)")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Link">
                  <Link2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("---\n")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Divider">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => insertMarkdown("$", "$")} className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted font-mono" title="Formula">
                  fx
                </button>
              </div>
            )}

            {preview ? (
              <div
                className="flex-1 overflow-y-auto p-6 prose-sm text-foreground chat-scroll"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            ) : (
              <textarea
                ref={editorRef}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Start writing... Use markdown syntax"
                className="flex-1 resize-none bg-transparent p-6 text-sm leading-relaxed outline-none placeholder:text-muted-foreground font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const start = e.currentTarget.selectionStart;
                    const newContent = content.slice(0, start) + "  " + content.slice(start);
                    setContent(newContent);
                    if (activeId) debouncedSave(activeId, title, newContent);
                    setTimeout(() => {
                      e.currentTarget.setSelectionRange(start + 2, start + 2);
                    }, 0);
                  }
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-lg font-medium text-muted-foreground">Select a note or create a new one</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Supports markdown, todo lists, and formulas</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
