import { useState, useRef, useCallback, useEffect } from "react";
import { X, Save, Loader2, Bold, Italic, List, ListOrdered, CheckSquare, Hash, Code, Link2, Minus, Trash2, Link } from "lucide-react";
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

interface LinkedTask {
  id: string;
  title: string;
}

interface NoteEditorModalProps {
  note: Note;
  onClose: () => void;
  onUpdate: (note: Note) => void;
  onDelete: (id: string) => void;
}

function renderMarkdown(text: string): string {
  let html = text.
  replace(/&/g, "&amp;").
  replace(/</g, "&lt;").
  replace(/>/g, "&gt;");

  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold mt-4 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-4 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>');
  let todoIndex = 0;
  html = html.replace(/^- \[(x| )\] (.+)$/gm, (_match, state, label) => {
    const checked = state === "x";
    const spanClass = checked ? "line-through text-muted-foreground" : "";
    const htmlLine = `<div class="flex items-center gap-2 my-0.5"><input type="checkbox" data-todo-index="${todoIndex}" class="accent-primary todo-checkbox" ${checked ? "checked" : ""} /><span class="${spanClass}">${label}</span></div>`;
    todoIndex += 1;
    return htmlLine;
  });
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
  const previewRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Link management
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([]);
  const [allTasks, setAllTasks] = useState<LinkedTask[]>([]);
  const [taskSearch, setTaskSearch] = useState("");
  const linkPanelRef = useRef<HTMLDivElement>(null);

  // Fetch linked tasks and all tasks
  useEffect(() => {
    if (!user) return;
    const fetchLinks = async () => {
      const { data: links } = await (supabase.
      from("note_task_links" as any).
      select("task_id").
      eq("note_id", note.id) as any);
      if (links && links.length > 0) {
        const taskIds = links.map((l: any) => l.task_id);
        const { data: tasks } = await supabase.
        from("tasks").
        select("id, title").
        in("id", taskIds).
        is("deleted_at", null);
        setLinkedTasks((tasks || []).map((t: any) => ({ id: t.id, title: t.title })));
      } else {
        setLinkedTasks([]);
      }
    };
    fetchLinks();
  }, [note.id, user]);

  useEffect(() => {
    if (!user || !showLinkPanel) return;
    const fetchAll = async () => {
      const { data } = await supabase.
      from("tasks").
      select("id, title").
      eq("user_id", user.id).
      is("deleted_at", null).
      order("created_at", { ascending: false }).
      limit(100);
      setAllTasks((data || []).map((t: any) => ({ id: t.id, title: t.title })));
    };
    fetchAll();
  }, [user, showLinkPanel]);

  // Close link panel on outside click
  useEffect(() => {
    if (!showLinkPanel) return;
    const handler = (e: MouseEvent) => {
      if (linkPanelRef.current && !linkPanelRef.current.contains(e.target as Node)) {
        setShowLinkPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLinkPanel]);

  const linkTask = useCallback(async (taskId: string) => {
    if (!user) return;
    const already = linkedTasks.find((t) => t.id === taskId);
    if (already) return;
    await (supabase.from("note_task_links" as any).insert({ note_id: note.id, task_id: taskId, user_id: user.id } as any) as any);
    const task = allTasks.find((t) => t.id === taskId);
    if (task) setLinkedTasks((prev) => [...prev, task]);

    // Sync existing todos to the newly linked task
    syncTodosToTask(taskId);
  }, [user, note.id, linkedTasks, allTasks]);

  const unlinkTask = useCallback(async (taskId: string) => {
    await (supabase.from("note_task_links" as any).delete().eq("note_id", note.id).eq("task_id", taskId) as any);
    // Remove subtasks for this note+task combo
    await (supabase.from("subtasks" as any).delete().eq("note_id", note.id).eq("parent_task_id", taskId) as any);
    setLinkedTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, [note.id]);

  const syncTodosToTask = useCallback(async (taskId: string) => {
    if (!user) return;
    const todoRegex = /^- \[( |x)\] (.+)$/gm;
    const todos: {title: string;completed: boolean;}[] = [];
    let match;
    while ((match = todoRegex.exec(content)) !== null) {
      todos.push({ title: match[2], completed: match[1] === "x" });
    }

    const { data: existing } = await (supabase.
    from("subtasks" as any).
    select("*").
    eq("note_id", note.id).
    eq("parent_task_id", taskId).
    order("position", { ascending: true }) as any);
    const existingList = (existing || []) as any[];

    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      const ex = existingList[i];
      if (ex) {
        if (ex.title !== todo.title || ex.completed !== todo.completed) {
          await (supabase.from("subtasks" as any).update({ title: todo.title, completed: todo.completed, position: i } as any).eq("id", ex.id) as any);
        }
      } else {
        await (supabase.from("subtasks" as any).insert({ user_id: user.id, note_id: note.id, parent_task_id: taskId, title: todo.title, completed: todo.completed, position: i } as any) as any);
      }
    }
    for (let i = todos.length; i < existingList.length; i++) {
      await (supabase.from("subtasks" as any).delete().eq("id", existingList[i].id) as any);
    }
  }, [user, content, note.id]);

  const filteredTasks = taskSearch ?
  allTasks.filter((t) => t.title.toLowerCase().includes(taskSearch.toLowerCase()) && !linkedTasks.find((l) => l.id === t.id)) :
  allTasks.filter((t) => !linkedTasks.find((l) => l.id === t.id));

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

  const toggleTodoAtIndex = useCallback((targetIndex: number) => {
    const todoRegex = /^- \[( |x)\] (.+)$/gm;
    let match: RegExpExecArray | null;
    let index = 0;
    let newContent = content;

    while ((match = todoRegex.exec(content)) !== null) {
      if (index === targetIndex) {
        const lineStart = match.index;
        const lineEnd = match.index + match[0].length;
        const completed = match[1] === "x";
        const text = match[2];
        const replacement = `- [${completed ? " " : "x"}] ${text}`;
        newContent = content.slice(0, lineStart) + replacement + content.slice(lineEnd);
        break;
      }
      index += 1;
    }

    if (newContent !== content) {
      setContent(newContent);
      debouncedSave(title, newContent);
    }
  }, [content, debouncedSave, title]);

  const insertMarkdown = (prefix: string, suffix = "") => {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);

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

      const bulletMatch = currentLine.match(/^(\s*- )(.*)/);
      if (bulletMatch) {
        if (!bulletMatch[2].trim()) {
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

  // Sync subtasks to ALL linked tasks when content changes
  useEffect(() => {
    if (!user || linkedTasks.length === 0) return;
    const timer = setTimeout(() => {
      linkedTasks.forEach((lt) => syncTodosToTask(lt.id));
    }, 1500);
    return () => clearTimeout(timer);
  }, [content, linkedTasks, user, syncTodosToTask]);

  // Enable clicking checkboxes in preview
  useEffect(() => {
    if (!preview) return;
    const container = previewRef.current;
    if (!container) return;

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>("input.todo-checkbox[data-todo-index]")
    );

    const handleClick = (ev: Event) => {
      const target = ev.currentTarget as HTMLInputElement;
      const idxAttr = target.getAttribute("data-todo-index");
      if (!idxAttr) return;
      const idx = Number(idxAttr);
      if (Number.isNaN(idx)) return;
      ev.preventDefault();
      toggleTodoAtIndex(idx);
    };

    checkboxes.forEach((cb) => cb.addEventListener("click", handleClick));
    return () => {
      checkboxes.forEach((cb) => cb.removeEventListener("click", handleClick));
    };
  }, [preview, content, toggleTodoAtIndex]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
      
      <div className="w-full max-w-4xl h-[85vh] rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Note title"
            className="flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground" />
          
          <div className="flex items-center gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Save className="h-3.5 w-3.5 text-primary" />}
            <span className="text-[10px] text-muted-foreground">{saving ? "Saving..." : "Saved"}</span>
          </div>

          {/* Link button */}
          <div className="relative">
            <button
              onClick={() => setShowLinkPanel(!showLinkPanel)}
              className={cn(
                "rounded p-1.5 transition-colors",
                linkedTasks.length > 0 ?
                "text-primary bg-primary/10 hover:bg-primary/20" :
                "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={`Linked tasks (${linkedTasks.length})`}>
              
              <Link className="h-4 w-4" />
            </button>
            {linkedTasks.length > 0 &&
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
                {linkedTasks.length}
              </span>
            }

            {/* Link Panel Dropdown */}
            {showLinkPanel &&
            <div
              ref={linkPanelRef}
              className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-border bg-card shadow-xl z-50 overflow-hidden">
              
                <div className="px-3 py-2 border-b border-border">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Link to Tasks</span>
                </div>

                {/* Linked tasks */}
                {linkedTasks.length > 0 &&
              <div className="px-3 py-2 border-b border-border space-y-1">
                    <span className="text-[10px] text-muted-foreground">Linked</span>
                    {linkedTasks.map((t) =>
                <div key={t.id} className="flex items-center gap-2 py-1 group">
                        <Link className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-xs text-foreground flex-1 truncate">{t.title}</span>
                        <button
                    onClick={() => unlinkTask(t.id)}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive">
                    
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                )}
                  </div>
              }

                {/* Search and add */}
                <div className="p-2">
                  <input
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary mb-1"
                  autoFocus />
                
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {filteredTasks.slice(0, 20).map((t) =>
                  <button
                    key={t.id}
                    onClick={() => linkTask(t.id)}
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted truncate">
                    
                        {t.title}
                      </button>
                  )}
                    {filteredTasks.length === 0 &&
                  <p className="text-[10px] text-muted-foreground text-center py-2">No tasks found</p>
                  }
                  </div>
                </div>
              </div>
            }
          </div>

          <div className="flex rounded-md border border-border overflow-hidden ml-1">
            <button onClick={() => setPreview(false)} className={`px-2.5 py-1 text-xs ${!preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              Edit
            </button>
            <button onClick={() => setPreview(true)} className={`px-2.5 py-1 text-xs ${preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              Preview
            </button>
          </div>
          <button
            onClick={() => {onDelete(note.id);onClose();}}
            className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Delete note">
            
            <Trash2 className="h-4 w-4 mx-[10px]" />
          </button>
          

          
        </div>

        {/* Toolbar */}
        {!preview &&
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
        }

        {/* Content */}
        {preview ?
        <div
          ref={previewRef}
          className="flex-1 overflow-y-auto p-6 prose-sm text-foreground chat-scroll"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} /> :


        <textarea
          ref={editorRef}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Start writing... Use markdown syntax"
          className="flex-1 resize-none bg-transparent p-6 text-sm leading-relaxed outline-none placeholder:text-muted-foreground font-mono" />

        }
      </div>
    </div>);

}