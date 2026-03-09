import { useState, useRef, useCallback, useEffect } from "react";
import { X, Save, Loader2, Bold, Italic, List, ListOrdered, CheckSquare, Hash, Code, Link2, Minus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface NoteEditorModalProps {
  note: Note;
  onClose: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (id: string) => void;
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
  html = html.replace(/\n/g, "<br />");
  return html;
}

export default function NoteEditorModal({ note, onClose, onUpdate, onDelete }: NoteEditorModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const saveNote = useCallback(async (t: string, c: string) => {
    setSaving(true);
    const { error } = await (supabase.from("notes" as any).update({ title: t, content: c, updated_at: new Date().toISOString() } as any).eq("id", note.id) as any);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      onUpdate({ ...note, title: t, content: c, updatedAt: new Date().toISOString() });
    }
    setSaving(false);
  }, [note, onUpdate]);

  const debouncedSave = useCallback((t: string, c: string) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(t, c), 800);
  }, [saveNote]);

  const handleContentChange = (val: string) => {
    setContent(val);
    debouncedSave(title, val);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    debouncedSave(val, content);
  };

  const insertMarkdown = (prefix: string, suffix = "") => {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);

    // For line-prefix insertions (lists, headings, todos)
    if (!suffix && (prefix === "- " || prefix === "1. " || prefix === "- [ ] " || prefix === "# " || prefix === "---\n")) {
      const lineStart = content.lastIndexOf("\n", start - 1) + 1;
      const before = content.slice(0, lineStart);
      const after = content.slice(lineStart);
      const newText = before + prefix + after;
      setContent(newText);
      debouncedSave(title, newText);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length, start + prefix.length);
      }, 0);
      return;
    }

    const newText = content.slice(0, start) + prefix + selected + suffix + content.slice(end);
    setContent(newText);
    debouncedSave(title, newText);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  // Handle Enter key for list continuation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const newContent = content.slice(0, start) + "  " + content.slice(start);
      setContent(newContent);
      debouncedSave(title, newContent);
      setTimeout(() => {
        e.currentTarget.setSelectionRange(start + 2, start + 2);
      }, 0);
      return;
    }

    if (e.key === "Enter") {
      const el = e.currentTarget;
      const pos = el.selectionStart;
      const lineStart = content.lastIndexOf("\n", pos - 1) + 1;
      const currentLine = content.slice(lineStart, pos);

      // Continue bullet list
      const bulletMatch = currentLine.match(/^(\s*- )(.*)/);
      if (bulletMatch) {
        if (!bulletMatch[2].trim()) {
          // Empty bullet - remove it
          e.preventDefault();
          const newContent = content.slice(0, lineStart) + content.slice(pos);
          setContent(newContent);
          debouncedSave(title, newContent);
          setTimeout(() => el.setSelectionRange(lineStart, lineStart), 0);
          return;
        }
        e.preventDefault();
        const prefix = bulletMatch[1];
        const insert = "\n" + prefix;
        const newContent = content.slice(0, pos) + insert + content.slice(pos);
        setContent(newContent);
        debouncedSave(title, newContent);
        setTimeout(() => el.setSelectionRange(pos + insert.length, pos + insert.length), 0);
        return;
      }

      // Continue todo list
      const todoMatch = currentLine.match(/^(\s*- \[ \] )(.*)/);
      if (todoMatch) {
        if (!todoMatch[2].trim()) {
          e.preventDefault();
          const newContent = content.slice(0, lineStart) + content.slice(pos);
          setContent(newContent);
          debouncedSave(title, newContent);
          setTimeout(() => el.setSelectionRange(lineStart, lineStart), 0);
          return;
        }
        e.preventDefault();
        const prefix = todoMatch[1];
        const insert = "\n" + prefix;
        const newContent = content.slice(0, pos) + insert + content.slice(pos);
        setContent(newContent);
        debouncedSave(title, newContent);
        setTimeout(() => el.setSelectionRange(pos + insert.length, pos + insert.length), 0);
        return;
      }

      // Continue numbered list
      const numMatch = currentLine.match(/^(\s*)(\d+)\. (.*)/);
      if (numMatch) {
        if (!numMatch[3].trim()) {
          e.preventDefault();
          const newContent = content.slice(0, lineStart) + content.slice(pos);
          setContent(newContent);
          debouncedSave(title, newContent);
          setTimeout(() => el.setSelectionRange(lineStart, lineStart), 0);
          return;
        }
        e.preventDefault();
        const nextNum = parseInt(numMatch[2]) + 1;
        const insert = "\n" + numMatch[1] + nextNum + ". ";
        const newContent = content.slice(0, pos) + insert + content.slice(pos);
        setContent(newContent);
        debouncedSave(title, newContent);
        setTimeout(() => el.setSelectionRange(pos + insert.length, pos + insert.length), 0);
        return;
      }
    }
  };

  // Sync subtasks when todos change
  useEffect(() => {
    if (!user) return;
    const syncSubtasks = async () => {
      const todoRegex = /^- \[( |x)\] (.+)$/gm;
      const todos: { title: string; completed: boolean }[] = [];
      let match;
      while ((match = todoRegex.exec(content)) !== null) {
        todos.push({ title: match[2], completed: match[1] === "x" });
      }

      // Get existing subtasks for this note
      const { data: existing } = await (supabase
        .from("subtasks" as any)
        .select("*")
        .eq("note_id", note.id)
        .order("position", { ascending: true }) as any);

      const existingList = (existing || []) as any[];

      // Sync: update existing, add new, remove deleted
      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        const ex = existingList[i];
        if (ex) {
          if (ex.title !== todo.title || ex.completed !== todo.completed) {
            await (supabase.from("subtasks" as any).update({ title: todo.title, completed: todo.completed, position: i } as any).eq("id", ex.id) as any);
          }
        } else {
          await (supabase.from("subtasks" as any).insert({ user_id: user.id, note_id: note.id, title: todo.title, completed: todo.completed, position: i } as any) as any);
        }
      }
      // Remove extras
      for (let i = todos.length; i < existingList.length; i++) {
        await (supabase.from("subtasks" as any).delete().eq("id", existingList[i].id) as any);
      }
    };

    const timer = setTimeout(syncSubtasks, 1500);
    return () => clearTimeout(timer);
  }, [content, note.id, user]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-4xl h-[85vh] rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Note title"
            className="flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Save className="h-3.5 w-3.5 text-primary" />}
            <span className="text-[10px] text-muted-foreground">{saving ? "Saving..." : "Saved"}</span>
          </div>
          <div className="flex rounded-md border border-border overflow-hidden ml-2">
            <button onClick={() => setPreview(false)} className={`px-2.5 py-1 text-xs ${!preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              Edit
            </button>
            <button onClick={() => setPreview(true)} className={`px-2.5 py-1 text-xs ${preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              Preview
            </button>
          </div>
          <button
            onClick={() => { onDelete(note.id); onClose(); }}
            className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Delete note"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        {!preview && (
          <div className="flex items-center gap-0.5 border-b border-border px-5 py-1.5 flex-wrap">
            <button onClick={() => insertMarkdown("**", "**")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Bold"><Bold className="h-3.5 w-3.5" /></button>
            <button onClick={() => insertMarkdown("*", "*")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Italic"><Italic className="h-3.5 w-3.5" /></button>
            <button onClick={() => insertMarkdown("`", "`")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Code"><Code className="h-3.5 w-3.5" /></button>
            <div className="w-px h-4 bg-border mx-1" />
            <button onClick={() => insertMarkdown("# ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Heading"><Hash className="h-3.5 w-3.5" /></button>
            <button onClick={() => insertMarkdown("- ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Bullet list"><List className="h-3.5 w-3.5" /></button>
            <button onClick={() => insertMarkdown("1. ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></button>
            <button onClick={() => insertMarkdown("- [ ] ")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Todo"><CheckSquare className="h-3.5 w-3.5" /></button>
            <div className="w-px h-4 bg-border mx-1" />
            <button onClick={() => insertMarkdown("[", "](url)")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Link"><Link2 className="h-3.5 w-3.5" /></button>
            <button onClick={() => insertMarkdown("---\n")} className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted" title="Divider"><Minus className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Content */}
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
            onKeyDown={handleKeyDown}
            placeholder="Start writing... Use markdown syntax"
            className="flex-1 resize-none bg-transparent p-6 text-sm leading-relaxed outline-none placeholder:text-muted-foreground font-mono"
          />
        )}
      </div>
    </div>
  );
}
